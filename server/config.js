import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { NIC_BR, normalizeServers } from './ntp.js';
import { asService } from './sysexe.js'; // serviço do Windows (SYSTEM): nada de procurar programa pelo PATH

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Resolve um binário: variável de ambiente > PATH do sistema > pacote npm (*-static). Como serviço do Windows (SYSTEM) o PATH
 * fica de fora (server/sysexe.js): o serviço define FFMPEG_PATH/FFPROBE_PATH; sem eles, o pacote npm.
 */
function resolveBinary(envVar, name, npmPackage, pick = (m) => m) {
  if (process.env[envVar]) return process.env[envVar];
  if (!asService()) {
    const probe = spawnSync(name, ['-version'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) return name;
  }
  try {
    const p = pick(require(npmPackage));
    if (p && fs.existsSync(p)) return p;
  } catch { /* pacote opcional ausente */ }
  return null;
}

const dataDir = process.env.DATA_DIR || path.join(root, 'data');
/** Edição Windows: o build grava edge-build.json (versão, endereço da central, chave pública fixada) na raiz do app. */
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const build = readJson(path.join(root, 'edge-build.json')) || {};
const pkgVersion = readJson(path.join(root, 'package.json'))?.version || '0.0.0';
const edgeOn = process.env.EDGE_MODE === '1';
/**
 * Chave das sessões numa instalação local sem SESSION_SECRET: gerada uma vez e guardada em DATA_DIR (os operadores não
 * são deslogados a cada reinício do serviço). Na nuvem continua valendo só a variável.
 */
function edgeSessionSecret() {
  const file = path.join(dataDir, 'session.key');
  try { const s = fs.readFileSync(file, 'utf8').trim(); if (s.length >= 32) return s; } catch { /* primeira vez */ }
  const s = randomBytes(32).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}
const X264_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
if (process.env.TRANSCODE_PRESET && !X264_PRESETS.includes(process.env.TRANSCODE_PRESET)) {
  console.warn(`[conversão] TRANSCODE_PRESET="${process.env.TRANSCODE_PRESET}" inválido; usando "faster". Valores: ${X264_PRESETS.join(', ')}.`);
}
if (process.env.ENGINE_PRESET && !X264_PRESETS.includes(process.env.ENGINE_PRESET)) {
  console.warn(`[motor] ENGINE_PRESET="${process.env.ENGINE_PRESET}" inválido; usando "veryfast". Valores: ${X264_PRESETS.join(', ')}.`);
}

/**
 * Preset do x264 no alimentador do motor (ENGINE_PRESET). Padrão "veryfast": com o "faster" a CPU do Railway virou gargalo
 * (buracos nas trocas de item) para um ganho pequeno de imagem (VMAF +0,3 a +0,4). Use "faster" só com CPU sobrando
 * (~25% a mais por canal). Dos presets mais lentos que o "veryfast", o lookahead fica nos 10 quadros dele: o padrão do
 * "faster" (20) atrasa ~0,33 s a saída de cada alimentador novo, ou seja, cada troca de item.
 */
export function enginePreset(value) {
  const preset = X264_PRESETS.includes(value) ? value : 'veryfast';
  return { preset, lookahead: X264_PRESETS.indexOf(preset) > X264_PRESETS.indexOf('veryfast') ? 10 : null };
}

/**
 * Resolução de saída do canal (ENGINE_RESOLUTION): "720p" (padrão, 2,8 Mb/s) ou "1080p" (6 Mb/s, ~2× a CPU por canal).
 * Vale para o motor, a mesa, a conversão no upload e o importador (o "padrão do canal"); gráficos e cartelas já escalam
 * pelo quadro. A conversão no upload limita a taxa do arquivo guardado (maxrate) na mesma proporção.
 */
export function engineResolution(value) {
  const v = String(value ?? '').trim().toLowerCase().replace(/p$/, '');
  if (v === '1080') return { resolution: '1080p', width: 1920, height: 1080, videoBitrate: '6000k', bufsize: '12000k', fileMaxrate: '10M', fileBufsize: '20M' };
  return { resolution: '720p', width: 1280, height: 720, videoBitrate: '2800k', bufsize: '5600k', fileMaxrate: '6M', fileBufsize: '12M' };
}
if (process.env.ENGINE_RESOLUTION && !['720', '1080'].includes(String(process.env.ENGINE_RESOLUTION).trim().toLowerCase().replace(/p$/, ''))) {
  console.warn(`[motor] ENGINE_RESOLUTION="${process.env.ENGINE_RESOLUTION}" inválido; usando "720p". Valores: 720p, 1080p.`);
}
const RES = engineResolution(process.env.ENGINE_RESOLUTION);
/** Taxa de arquivo da Censura. Aceita "2800k", "2.8M" ou o número em kb/s. */
function archiveRate(envVar, fallback, { minKbps, maxKbps }) {
  const raw = process.env[envVar];
  if (raw == null || String(raw).trim() === '') return fallback;
  const m = /^(\d+(?:\.\d+)?)\s*([kKmM]?)$/.exec(String(raw).trim());
  const kbps = m ? Number(m[1]) * (m[2].toLowerCase() === 'm' ? 1000 : 1) : NaN;
  if (!Number.isFinite(kbps) || kbps < minKbps || kbps > maxKbps) {
    console.warn(`[censura] ${envVar}="${raw}" inválido; usando ${fallback}.`);
    return fallback;
  }
  return `${Math.round(kbps)}k`;
}
const rateKbps = (rate) => Number(/^([\d.]+)k$/i.exec(String(rate))?.[1]) || 0;
/**
 * Altura máxima do arquivo de retenção da Censura (CENSURA_ARCHIVE_MAX_HEIGHT, padrão 720; pedido do usuário, 13/10: "baixe
 * a gravação da censura para 720p"). Mantém a proporção e nunca amplia (1920×1080 → 1280×720; 720p ou menos fica como
 * está). 0 ou "off" = sem teto (a resolução do ar). Valores: 360, 480, 540, 720, 1080, 1440, 2160.
 */
export function archiveMaxHeight(value) {
  const raw = String(value ?? '').trim().toLowerCase().replace(/p$/, '');
  if (raw === '') return 720;
  if (raw === '0' || raw === 'off') return 0;
  const n = Number(raw);
  return [360, 480, 540, 720, 1080, 1440, 2160].includes(n) ? n : null;
}
let CENSURA_ARCHIVE_MAX_HEIGHT = archiveMaxHeight(process.env.CENSURA_ARCHIVE_MAX_HEIGHT);
if (CENSURA_ARCHIVE_MAX_HEIGHT == null) {
  console.warn(`[censura] CENSURA_ARCHIVE_MAX_HEIGHT="${process.env.CENSURA_ARCHIVE_MAX_HEIGHT}" inválido; usando 720. Valores: 360, 480, 540, 720, 1080, 1440, 2160 ou 0 (sem teto).`);
  CENSURA_ARCHIVE_MAX_HEIGHT = 720;
}
/** Taxas padrão do arquivo pela altura máxima (H.264 "faster", programa de TV): 720p ≈ 1,5 Mb/s; sem teto/1080p, 2,8 Mb/s. */
export function archiveRatesFor(maxHeight) {
  const h = Number(maxHeight) || 0;
  if (h && h <= 480) return { video: '900k', maxrate: '1200k' };
  if (h && h <= 540) return { video: '1100k', maxrate: '1500k' };
  if (h && h <= 720) return { video: '1500k', maxrate: '2000k' };
  return { video: '2800k', maxrate: '3600k' };
}
const ARCHIVE_RATES = archiveRatesFor(CENSURA_ARCHIVE_MAX_HEIGHT);
const CENSURA_ARCHIVE_VIDEO_BITRATE = archiveRate('CENSURA_ARCHIVE_VIDEO_BITRATE', ARCHIVE_RATES.video, { minKbps: 500, maxKbps: 12000 });
let CENSURA_ARCHIVE_MAXRATE = archiveRate('CENSURA_ARCHIVE_MAXRATE', ARCHIVE_RATES.maxrate, { minKbps: 500, maxKbps: 16000 });
if (rateKbps(CENSURA_ARCHIVE_MAXRATE) < rateKbps(CENSURA_ARCHIVE_VIDEO_BITRATE)) {
  console.warn(`[censura] CENSURA_ARCHIVE_MAXRATE menor que CENSURA_ARCHIVE_VIDEO_BITRATE; usando ${CENSURA_ARCHIVE_VIDEO_BITRATE}.`);
  CENSURA_ARCHIVE_MAXRATE = CENSURA_ARCHIVE_VIDEO_BITRATE;
}
const CENSURA_ARCHIVE_AUDIO_BITRATE = archiveRate('CENSURA_ARCHIVE_AUDIO_BITRATE', '128k', { minKbps: 64, maxKbps: 320 });
const CENSURA_ARCHIVE_PRESET = X264_PRESETS.includes(process.env.CENSURA_ARCHIVE_PRESET) ? process.env.CENSURA_ARCHIVE_PRESET : 'faster';
if (process.env.CENSURA_ARCHIVE_PRESET && CENSURA_ARCHIVE_PRESET !== process.env.CENSURA_ARCHIVE_PRESET) {
  console.warn(`[censura] CENSURA_ARCHIVE_PRESET="${process.env.CENSURA_ARCHIVE_PRESET}" inválido; usando "faster".`);
}
const CENSURA_ARCHIVE_MODE = ['encode', 'copy'].includes(String(process.env.CENSURA_ARCHIVE_MODE || 'encode').toLowerCase())
  ? String(process.env.CENSURA_ARCHIVE_MODE || 'encode').toLowerCase() : 'encode';
if (process.env.CENSURA_ARCHIVE_MODE && CENSURA_ARCHIVE_MODE !== String(process.env.CENSURA_ARCHIVE_MODE).toLowerCase()) {
  console.warn(`[censura] CENSURA_ARCHIVE_MODE="${process.env.CENSURA_ARCHIVE_MODE}" inválido; usando "encode".`);
}
/** Resolução do ambiente (ENGINE_RESOLUTION): vale enquanto o superadmin não escolher outra em Configurações. */
export const ENV_RESOLUTION = RES.resolution;
const IMPORT_HEIGHT_FROM_ENV = [360, 480, 720, 1080, 1440, 2160].includes(Number(process.env.IMPORT_MAX_HEIGHT));

/**
 * Formato da mesa AO VIVO: a escolha do canal (mesa.resolution, 720p por padrão; pedido do usuário, 09/10: "720p nativo,
 * podendo chavear para Full HD"), nunca maior que o teto do servidor (MESA_RESOLUTION, padrão 1080p) nem que a saída do
 * canal. Em 720p com o canal em 1080p, o alimentador do motor amplia a saída da mesa; em Full HD o programa da mesa sai
 * em 1080p nativo. O mixer de 12 entradas em 1080p custa bem mais CPU (docs/MESA.md, "Resolução da mesa").
 */
export const MESA_CEILING = engineResolution(process.env.MESA_RESOLUTION || '1080p').resolution;
export const mesaFormat = (choice = '720p') => {
  const r = engineResolution(choice === '1080p' && MESA_CEILING === '1080p' ? '1080p' : '720p');
  return { resolution: r.height >= 1080 && config.engine.height >= 1080 ? '1080p' : '720p', width: Math.min(r.width, config.engine.width), height: Math.min(r.height, config.engine.height), fps: config.engine.fps };
};
/** Formato das pontes das câmeras do app: 720p (a câmera do /control pede 1280×720); na mesa em Full HD, o mixer amplia. */
export const cameraFormat = () => mesaFormat('720p');

/**
 * Troca a resolução do canal com o servidor rodando (superadmin → Configurações → Vídeo dos canais). Vale para o que
 * nascer depois: alimentadores, mesa, conversões e importações novas; os motores no ar são reiniciados por quem chama.
 * null = volta ao ENGINE_RESOLUTION. Devolve a resolução efetiva.
 */
export function applyEngineResolution(value) {
  const r = engineResolution(value ?? ENV_RESOLUTION);
  Object.assign(config.engine, { resolution: r.resolution, width: r.width, height: r.height, videoBitrate: r.videoBitrate, bufsize: r.bufsize });
  Object.assign(config.transcode, { maxrate: r.fileMaxrate, bufsize: r.fileBufsize });
  if (!IMPORT_HEIGHT_FROM_ENV) config.importer.maxHeight = r.height;
  return r.resolution;
}

/** GOP fixo do alimentador (s): um quadro-chave a cada 2 s (videoEncodeArgs em server/engine.js). */
export const GOP_SECONDS = 2;
/**
 * Janela da playlist ao vivo (s): o que o espectador pode voltar e a folga do player para reconectar sem perder o ponto.
 * 30 s (era 20): o modo Estável do site toca ~14 s atrás da borda e sobe até 24 s depois de travamentos; com 20 s sobrariam
 * só 6 s antes de o ponto sair da janela. Custo: a playlist fica com 15 entradas (bytes, não pedidos). docs/LATENCIA.md
 */
export const HLS_WINDOW_SECONDS = 30;

/**
 * Duração do segmento HLS (HLS_SEGMENT_SECONDS, padrão 2) e o tamanho da playlist. O segmentador só corta em quadro-chave:
 * a duração precisa ser múltiplo do GOP de 2 s, senão os segmentos alternam (com 3 s saem 4 + 2 + 4 + 2…). Valor fora de
 * 1–6 fica no limite e um valor ímpar desce para o múltiplo de 2 abaixo (1 vira 2, 3 vira 2, 5 vira 4): menos atraso.
 * Segmento de 1 s exigiria GOP de 1 s (o dobro de quadros-chave, imagem pior no mesmo bitrate) e não é oferecido.
 * A playlist guarda ~30 s (15 × 2 s), nunca menos de 6 segmentos. docs/LATENCIA.md
 */
export function hlsTiming(value) {
  const raw = value === undefined || value === null || String(value).trim() === '' ? NaN : Number(value);
  const want = Number.isFinite(raw) ? Math.min(6, Math.max(1, raw)) : 2;
  const segmentSeconds = Math.max(GOP_SECONDS, Math.floor(want / GOP_SECONDS) * GOP_SECONDS);
  if (Number.isFinite(raw) && segmentSeconds !== raw) {
    console.warn(`[motor] HLS_SEGMENT_SECONDS="${value}" vira ${segmentSeconds} s: precisa ser múltiplo do GOP de ${GOP_SECONDS} s, entre 2 e 6.`);
  } else if (value !== undefined && value !== null && String(value).trim() !== '' && !Number.isFinite(raw)) {
    console.warn(`[motor] HLS_SEGMENT_SECONDS="${value}" inválido; usando 2 s.`);
  }
  return { segmentSeconds, listSize: Math.max(6, Math.ceil(HLS_WINDOW_SECONDS / segmentSeconds)), gopSeconds: GOP_SECONDS, viewerLatencySec: viewerLatencySec(segmentSeconds) };
}

/**
 * Atraso típico do espectador (s) com o player padrão: o alvo do hls.js (6 s, ou 2,5 segmentos se forem maiores) mais o
 * segmento que ainda está sendo gravado. Com 2 s: 8 s (medido: 6,9 s no computador e 8,4 s no celular, em rede local).
 * É quanto o servidor espera para mandar ao chat/vitrine o que dispara (produtos), para casar com o vídeo.
 */
export const viewerLatencySec = (segmentSeconds) => Math.max(6, 2.5 * segmentSeconds) + segmentSeconds;
/**
 * Atraso do espectador no modo Estável, o padrão do site e do app (public/viewer/player-core.js, sync 14 s): o alvo mais o
 * segmento sendo gravado. Com 2 s: 16 s. Os comentários por programa trocam nessa hora (server/comentarios.js).
 */
export const stableLatencySec = (segmentSeconds) => Math.max(14, 2.5 * segmentSeconds) + segmentSeconds;

/**
 * Porta HTTP: HTTP_PORT > PORT > 3000. Nunca a mesma da entrada RTMP: no Railway, criar um TCP Proxy na 1935
 * pode fazer o PORT injetado virar 1935, e aí o site e o RTMP disputam a porta (site fora do ar, RTMP sem subir).
 */
function httpPort() {
  const port = Number(process.env.HTTP_PORT || process.env.PORT || 3000);
  const rtmp = Number(process.env.RTMP_PORT || 1935);
  if (process.env.RTMP_INGEST !== '0' && port === rtmp) {
    const alt = rtmp === 8080 ? 3000 : 8080;
    console.warn(`[http] A porta HTTP (${port}) é a mesma da entrada RTMP (RTMP_PORT=${rtmp}). Usando ${alt}; defina HTTP_PORT para escolher outra.`);
    return alt;
  }
  return port;
}

export const config = {
  root,
  port: httpPort(),
  demoMode: process.env.DEMO_MODE === '1',
  // só semeiam o primeiro usuário (grupo Administradores); depois disso a senha vive no banco
  adminUser: (process.env.ADMIN_USER || 'admin').trim().toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',

  // Plataforma multi-cliente (SaaS). Ver docs/PLATAFORMA.md.
  platform: {
    // equipe da plataforma: criada UMA vez, se ainda não houver nenhum usuário da plataforma
    superadminUser: (process.env.SUPERADMIN_USER || 'superadmin').trim().toLowerCase(),
    superadminPassword: process.env.SUPERADMIN_PASSWORD || '',
    // nome do cliente padrão (id 1) criado no primeiro boot
    defaultTenantName: (process.env.PLATFORM_DEFAULT_TENANT_NAME || 'NEXA TV').trim(),
    // host da plataforma (alvo do CNAME dos domínios dos clientes), ex.: tv.minhaplataforma.com
    host: (process.env.PLATFORM_HOST || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, ''),
    // URL pública (para voltar do checkout); vazio = derivada do Host da requisição
    publicUrl: (process.env.PLATFORM_PUBLIC_URL || '').replace(/\/$/, ''),
  },

  dataDir,
  dbFile: path.join(dataDir, 'playout.db'),
  // MEDIA_DIR: a biblioteca de vídeos pode ficar noutro disco (edição Windows: a pasta escolhida no instalador)
  mediaDir: process.env.MEDIA_DIR ? path.resolve(process.env.MEDIA_DIR) : path.join(dataDir, 'media'),
  thumbsDir: path.join(dataDir, 'thumbs'),
  // HLS_DIR: os segmentos e as playlists do ar (muitos arquivos pequenos, gravados e renomeados a cada 2 s, por canal e por
  // trilha) fora do DATA_DIR quando ele é um volume. 18/10, 23:29: com o volume do Railway em /data, o seg51 saiu cada vez mais
  // atrasado (2 s, depois 10 s). A imagem Docker usa /hls, no disco do contêiner (Dockerfile); sem a variável, DATA_DIR/hls
  hlsDir: process.env.HLS_DIR ? path.resolve(process.env.HLS_DIR) : path.join(dataDir, 'hls'),
  // HLS das câmeras dos Gadgets (server/camhls.js): com HLS_DIR, junto do HLS do ar ("_cam" não é slug de canal)
  camHlsDir: process.env.HLS_DIR ? path.join(path.resolve(process.env.HLS_DIR), '_cam') : path.join(dataDir, 'camhls'),
  graphicsDir: path.join(dataDir, 'graphics'),
  fontsDir: path.join(dataDir, 'fonts'), // fontes importadas no gerador de caracteres (TTF/OTF)
  lutsDir: path.join(dataDir, 'luts-cliente'), // LUTs de cor enviados pelo cliente, comprimidos (server/user-luts.js; o FFmpeg lê a cópia aberta em DATA_DIR/luts)
  captionsDir: path.join(dataDir, 'captions'), // WebVTT extraído do Closed Caption embutido nos vídeos (server/captions.js)
  lojaDocsDir: path.join(dataDir, 'loja-docs'), // documentos dos títulos da Loja (cue-sheet do ECAD, CPB, CRT): só pela API (docs/LOJA.md)
  cueAudioDir: path.join(dataDir, 'cue-audio'), // áudio de referência das obras da cue sheet (server/cue-sheet.js): só pela API (docs/CUE-SHEET.md)
  recordDir: path.join(dataDir, 'recordings'), // gravações do ao vivo em andamento (server/recorder.js); fora do cache de mídia
  importDir: path.join(dataDir, 'imports'), // downloads de "importar por link" em andamento (server/importer.js)
  freezeDir: path.join(dataDir, 'freeze'),
  // arquivos pequenos e passageiros do ar (o grafo grande do bipe no próprio ar, o quadro congelado do item, os textos que o
  // drawtext relê a cada quadro, o tom e os textos do alerta): FORA do volume (21/10: a gravação de um deles no volume cheio de
  // páginas sujas segurava o laço do servidor na troca de item). No Linux (o contêiner, o servidor próprio), no disco do
  // contêiner, numa pasta por DATA_DIR (um servidor por pasta); no Windows (a edição Windows), no DATA_DIR, que já é o disco local
  airTmpDir: process.env.AIR_TMP_DIR ? path.resolve(process.env.AIR_TMP_DIR)
    : process.platform === 'win32' ? path.join(dataDir, 'ar-tmp') : path.join(os.tmpdir(), `nexa-ar-${createHash('sha1').update(path.resolve(dataDir)).digest('hex').slice(0, 10)}`),

  // Postgres (Neon, Railway…). Sem DATABASE_URL o app usa SQLite em DATA_DIR/playout.db.
  databaseUrl: process.env.DATABASE_URL || null,

  // Armazenamento de mídia, miniaturas e imagens de gráficos.
  //   local -> arquivos em DATA_DIR (desenvolvimento, ou um servidor com volume persistente)
  //   r2    -> Cloudflare R2 (API S3); o disco local vira apenas cache para o FFmpeg
  storage: {
    driver: process.env.STORAGE_DRIVER === 'r2' ? 'r2' : 'local',
    bucket: process.env.R2_BUCKET || '',
    endpoint: process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : ''),
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    // domínio público do bucket (opcional). Sem ele, o servidor redireciona para URLs assinadas de curta duração.
    publicBaseUrl: (process.env.R2_PUBLIC_URL || '').replace(/\/$/, ''),
    cacheMaxBytes: Number(process.env.CACHE_MAX_GB || 20) * 1024 ** 3,
    // endereçamento "path" (endpoint/bucket/chave): S3 compatíveis locais e testes. O R2 usa o padrão (bucket no host).
    forcePathStyle: process.env.R2_FORCE_PATH_STYLE === '1',
    // o FFmpeg lê o original no bucket só por HTTPS (-protocol_whitelist, server/ffcaps.js); R2_READ_HTTP=1 libera http
    // para o S3 falso dos testes. Opção explícita: nunca decidida pela URL
    readHttp: process.env.R2_READ_HTTP === '1',
    // Loja de conteúdos (docs/LOJA.md): bucket SEM domínio público para os vídeos, prévias e documentos da Loja. Vazio = o
    // prefixo loja/ do bucket principal (aí a regra da Cloudflare que bloqueia /loja/* no domínio público é obrigatória)
    storeBucket: process.env.R2_STORE_BUCKET || '',
  },

  // Rede: o app do espectador/painel pode estar em outro domínio (Vercel).
  http: {
    corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean),
    appOrigins: process.env.APP_CORS === '0' ? [] : ['https://localhost', 'capacitor://localhost'],
    trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false,
    // base pública do HLS (ex.: https://tv.seudominio.com atrás do Cloudflare). Vazio = mesma origem da API.
    publicHlsBase: (process.env.PUBLIC_HLS_URL || '').replace(/\/$/, ''),
    // Console da plataforma (superadmin + laboratório) hospedado em OUTRO domínio (projeto Vercel próprio, ex.:
    // https://console.suaplataforma.com.br). Entram no CORS e são as ÚNICAS origens de navegador aceitas em /api/platform/*
    // (além da mesma origem). Ver docs/PLATAFORMA.md, "Console em site separado".
    consoleOrigins: (process.env.CONSOLE_ORIGINS || '').split(',').map((x) => x.trim().replace(/\/+$/, '')).filter(Boolean),
  },
  production: process.env.NODE_ENV === 'production',
  // painel por /_v/<versão>/ (server/assets.js): padrão ligado em produção; ASSET_VERSIONING=0/1 força
  assetVersioning: process.env.ASSET_VERSIONING ? process.env.ASSET_VERSIONING !== '0' : process.env.NODE_ENV === 'production',

  // 20 GB por arquivo: cabe ~1 h de ProRes Proxy/HQ 1080p ou um programa longo de câmera (H.264/HEVC 50–100 Mb/s), no
  // multipart do R2 com partes de 16 MiB (1.280 partes). O disco não limita: a conversão lê o original do R2 por URL
  // assinada, sem baixá-lo, e confere o espaço livre antes de gravar o convertido (docs/CONVERSAO.md, "Arquivos grandes")
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 20480) * 1024 * 1024,
  // extensões do envio: lista fixa, sem variável de ambiente (a -format_whitelist de toda leitura de mídia de cliente sai
  // dela, server/ffcaps.js). .vob = DVD (MPEG-PS, lido só pelo demuxer "mpeg"), que só entra convertido (media.js MUST_CONVERT)
  allowedExt: ['.mp4', '.mkv', '.mov', '.m4v', '.webm', '.vob'],

  ffmpeg: resolveBinary('FFMPEG_PATH', 'ffmpeg', 'ffmpeg-static'),
  ffprobe: resolveBinary('FFPROBE_PATH', 'ffprobe', 'ffprobe-static', (m) => m.path),
  // Atualizado por server/accelerator.js depois de uma sondagem explícita. O padrão CPU evita mudar os argumentos
  // existentes antes de NVENC estar comprovadamente disponível no host/contêiner.
  accelerator: {
    requestedMode: 'auto', policy: 'auto', effectiveMode: 'cpu', available: false, fallback: false, restartRequired: false,
    encoder: { requestedMode: 'auto', encoder: 'libx264', effectiveMode: 'cpu' },
    filters: { requestedMode: 'auto', effectiveMode: 'cpu', filters: [], zeroCopy: false },
    capabilities: null,
  },

  // Recepção RTMP (ATEM, OBS, encoders). Em nuvem, libere a porta TCP no firewall.
  ingest: {
    enabled: process.env.RTMP_INGEST !== '0',
    port: Number(process.env.RTMP_PORT || 1935),
    // endereço que o operador copia no ATEM/OBS. No Railway a porta externa do TCP Proxy difere da interna:
    // PUBLIC_RTMP_URL=rtmp://ingest.seudominio.com:12345/live
    publicUrl: (process.env.PUBLIC_RTMP_URL || '').replace(/\/$/, ''),
  },

  engine: {
    autostart: process.env.ENGINE_AUTOSTART !== '0',
    // segmento HLS de 2 s (HLS_SEGMENT_SECONDS) e playlist de ~30 s: segmentSeconds, listSize e gopSeconds (hlsTiming)
    ...hlsTiming(process.env.HLS_SEGMENT_SECONDS),
    // ENGINE_RESOLUTION=720p (padrão) ou 1080p: resolution, width, height, videoBitrate e bufsize (engineResolution)
    resolution: RES.resolution,
    width: RES.width,
    height: RES.height,
    fps: 30,
    videoBitrate: RES.videoBitrate,
    bufsize: RES.bufsize,
    ...enginePreset(process.env.ENGINE_PRESET),
    // threads do x264 por alimentador (ENGINE_THREADS, padrão 8; 0 = automático). 14/10: com 4, um show em 1080p (multidão,
    // luzes, movimento) saía a ~0,7× do tempo real no Railway e o ar engasgava a madrugada toda; o VOD do mesmo arquivo não
    // (lá ninguém recodifica). O automático (1,5 × núcleos visíveis) é o
    // que mais atrasa o 1º quadro de cada alimentador novo (~1,3 s contra ~0,2 s com 4, decodificador e filtros em 2) e,
    // num contêiner que enxerga os núcleos do host inteiro, ainda gasta mais RAM. docs/TROCA-DE-ITEM.md
    // legenda do ao vivo pelo WebVTT nos apps (GET /epg airLagMs): quanto a saída sai depois da grade (ms), o ponto de partida
    // do app até ele se acertar pelo 608. Medido em 15/10 na produção: 4,64 s (tv/web/app.js AIR; muda a cada partida do motor)
    airLagMs: Math.min(30000, Math.max(0, Math.round(Number(process.env.AIR_LAG_MS) || 4600))),
    threads: process.env.ENGINE_THREADS === '0' ? null : Math.min(16, Math.max(1, Math.floor(Number(process.env.ENGINE_THREADS) || 8))),
  },

  // Conversão no upload para o padrão do canal (docs/CONVERSAO.md): paga uma vez ao entrar na biblioteca, não a cada exibição.
  transcode: {
    enabled: process.env.TRANSCODE !== '0',
    concurrency: Math.max(1, Math.floor(Number(process.env.TRANSCODE_CONCURRENCY) || 1)), // um vídeo por vez: os canais no ar vêm antes
    threads: Math.max(1, Math.floor(Number(process.env.TRANSCODE_THREADS) || 2)),
    preset: X264_PRESETS.includes(process.env.TRANSCODE_PRESET) ? process.env.TRANSCODE_PRESET : 'faster',
    keepOriginal: process.env.TRANSCODE_KEEP_ORIGINAL === '1',
    // CRF 20 (era 19; TRANSCODE_CRF, 16 a 28). maxrate/bufsize são o TETO do canal: cada vídeo recodificado leva o seu, até
    // 1,1× a taxa do original (videoRateCap em server/transcode.js; 14/10: o CRF 19 quase dobrava fontes já comprimidas)
    crf: Math.min(28, Math.max(16, Math.round(Number(process.env.TRANSCODE_CRF) || 20))),
    maxrate: RES.fileMaxrate, bufsize: RES.fileBufsize, audioBitrate: '192k',
    // 29,97 fps com o resto no padrão: o vídeo é copiado e o motor passa para 30 no ar (TRANSCODE_COPY_NTSC=0 recodifica)
    copyNtsc: process.env.TRANSCODE_COPY_NTSC !== '0',
    // Conversão retomável (docs/CONVERSAO.md, "Conversão retomável"; 22/10: um show de 2 h voltou a 0% num deploy no meio). O
    // vídeo recodificado sai em pedaços de TRANSCODE_PIECE_SECONDS (padrão 120 s, de 10 a 600) em DATA_DIR/conv-parts, e um
    // reinício continua do último pedaço completo. Só para vídeos a partir de TRANSCODE_RESUME_MIN_SECONDS (padrão 600 s = 10 min;
    // 0 = todos); os mais curtos seguem no arquivo único de sempre. TRANSCODE_RESUME=0 desliga (tudo no arquivo único)
    resume: process.env.TRANSCODE_RESUME !== '0',
    pieceSeconds: Math.min(600, Math.max(10, Math.round(Number(process.env.TRANSCODE_PIECE_SECONDS) || 120))),
    resumeMinSeconds: Math.max(0, Number.isFinite(Number(process.env.TRANSCODE_RESUME_MIN_SECONDS)) && String(process.env.TRANSCODE_RESUME_MIN_SECONDS ?? '').trim() !== ''
      ? Number(process.env.TRANSCODE_RESUME_MIN_SECONDS) : 600),
  },

  // Acervo inflado (server/reconvert-inflated.js, docs/CONVERSAO.md "Acervo já inflado"): o arquivo do ar que a conversão antiga
  // deixou com a taxa de vídeo acima de 1,3× a do original (ficha técnica) é recodificado de volta a ela (teto = 1,05× o
  // original), com o áudio copiado. Ligado (pedido do usuário, 14/10); RECONVERT_INFLATED=0 desliga (o status mostra a conta)
  reconvertInflated: {
    enabled: process.env.RECONVERT_INFLATED !== '0',
    maxCpu: Math.min(95, Math.max(20, Math.floor(Number(process.env.RECONVERT_INFLATED_MAX_CPU) || 70))),
    threads: Math.min(2, Math.max(1, Math.floor(Number(process.env.RECONVERT_INFLATED_THREADS) || 2))),
  },

  // Reembutir a legenda 608 (server/reembutir-608.js, docs/LEGENDAS.md "Reembutir depois do atraso acumulado"): os arquivos
  // embutidos desde 12/10 com a agenda que acumulava atraso recebem o 608 de novo, do WebVTT guardado (sem transcrever). Em
  // segundo plano, um por vez; REEMBED_608=0 desliga. Não começa (e pausa) com a CPU acima de REEMBED_608_MAX_CPU %.
  reembed608: {
    enabled: process.env.REEMBED_608 !== '0',
    maxCpu: Math.min(95, Math.max(20, Math.floor(Number(process.env.REEMBED_608_MAX_CPU) || 70))),
  },

  // Volume do VOD igual ao do ar (server/vod-normalize.js, docs/LOUDNESS.md): o arquivo que o catálogo toca é trocado por um
  // com o áudio já normalizado no alvo do ar (vídeo copiado). Em segundo plano, um por vez, prioridade baixa; VOD_NORMALIZE=0
  // desliga. Não começa (e pausa no Linux) com a CPU acima de VOD_NORMALIZE_MAX_CPU %.
  vodNormalize: {
    enabled: process.env.VOD_NORMALIZE !== '0',
    maxCpu: Math.min(95, Math.max(20, Math.floor(Number(process.env.VOD_NORMALIZE_MAX_CPU) || 70))),
    // teto de leitura do arquivo em vezes o tempo real (o vídeo é copiado: sem teto, lê do R2 tão rápido quanto a rede deixa)
    readRate: process.env.VOD_NORMALIZE_READRATE === '0' ? 0 : Math.min(200, Math.max(2, Number(process.env.VOD_NORMALIZE_READRATE) || 20)),
  },

  // Gravação do ao vivo (server/recorder.js). O disco é o mesmo do HLS e do cache: os limites protegem o canal no ar.
  record: {
    maxMinutes: Math.min(24 * 60, Math.max(1, Math.floor(Number(process.env.RECORD_MAX_MINUTES) || 120))), // teto por gravação
    minFreeBytes: Math.max(0.2, Number(process.env.RECORD_MIN_FREE_GB) || 1.5) * 1024 ** 3, // abaixo disso (já contando o remux) para tudo
    maxPerTenant: Math.max(1, Math.floor(Number(process.env.RECORD_MAX_PER_TENANT) || 2)),
    maxServer: Math.max(1, Math.floor(Number(process.env.RECORD_MAX_SERVER) || 4)),
  },

  // Módulo Censura (server/censura.js, docs/CENSURA.md): todo ao vivo que vai ao ar é gravado na biblioteca ("ao vivo").
  // CENSURA=0 desliga no servidor inteiro (ex.: desenvolvimento); por canal, channels.config.censura.enabled.
  censura: {
    enabled: process.env.CENSURA !== '0',
    segmentMinutes: Math.min(24 * 60, Math.max(5, Math.floor(Number(process.env.CENSURA_SEGMENT_MINUTES) || 60))), // ao vivo longo vira partes
    // O tap copia o MPEG-TS sem peso enquanto o ao vivo está no ar. Depois, uma fila compacta o MP4 de retenção (em no
    // máximo 720p desde 13/10) para não cobrar o bitrate da transmissão durante toda a guarda.
    archiveMode: CENSURA_ARCHIVE_MODE,
    archiveVideoBitrate: CENSURA_ARCHIVE_VIDEO_BITRATE,
    archiveMaxrate: CENSURA_ARCHIVE_MAXRATE,
    archiveBufsize: `${Math.round(rateKbps(CENSURA_ARCHIVE_MAXRATE) * 2)}k`,
    archiveAudioBitrate: CENSURA_ARCHIVE_AUDIO_BITRATE,
    archivePreset: CENSURA_ARCHIVE_PRESET,
    archiveThreads: Math.min(4, Math.max(1, Math.floor(Number(process.env.CENSURA_ARCHIVE_THREADS) || 2))),
    archiveMaxHeight: CENSURA_ARCHIVE_MAX_HEIGHT, // 720: o arquivo guardado sai em no máximo 1280×720 (só no modo encode)
    // Recompactação das gravações antigas acima da altura máxima (server/censura-recompact.js): automática, uma por vez,
    // com prioridade baixa; CENSURA_RECOMPACT=0 desliga. Não começa (e pausa no Linux) com a CPU acima de MAX_CPU %.
    recompact: process.env.CENSURA_RECOMPACT !== '0',
    recompactMaxCpu: Math.min(95, Math.max(20, Math.floor(Number(process.env.CENSURA_RECOMPACT_MAX_CPU) || 75))),
  },

  // Importar por link (server/importer.js): YouTube, Facebook, Instagram… baixados pelo yt-dlp e convertidos como um upload.
  // Acervo (docs/ACERVO.md): músicas, fundos animados e vinhetas gerados por código e instalados na biblioteca do cliente
  acervo: {
    enabled: process.env.ACERVO !== '0',
    concurrency: Math.min(4, Math.max(1, Math.floor(Number(process.env.ACERVO_CONCURRENCY) || 1))), // vídeos gerados ao mesmo tempo no servidor
    maxPerTenant: 400, // na fila por cliente (cabe o acervo inteiro)
    dailyPerTenant: Math.max(1, Math.floor(Number(process.env.ACERVO_DAILY_PER_TENANT) || 150)), // itens gerados por cliente em 24 h (fila + prontos)
    fundoSeconds: 60, // duração mínima do arquivo de um fundo animado (o loop se repete até passar disso)
  },

  importer: {
    // a imagem Docker traz o binário oficial (versão fixa no Dockerfile). Como serviço do Windows (SYSTEM), só pelo caminho
    // completo em YTDLP_PATH (nexa.env): sem ele, a importação fica indisponível em vez de procurar "yt-dlp" pelo PATH
    bin: process.env.YTDLP_PATH || (asService() ? '' : 'yt-dlp'),
    maxMinutes: Math.min(24 * 60, Math.max(1, Math.floor(Number(process.env.IMPORT_MAX_MINUTES) || 180))), // vídeo mais longo aceito
    maxHeight: [360, 480, 720, 1080, 1440, 2160].includes(Number(process.env.IMPORT_MAX_HEIGHT)) ? Number(process.env.IMPORT_MAX_HEIGHT) : RES.height, // = padrão do canal
    concurrency: Math.max(1, Math.floor(Number(process.env.IMPORT_CONCURRENCY) || 1)), // downloads ao mesmo tempo no servidor
    maxPerTenant: Math.max(1, Math.floor(Number(process.env.IMPORT_MAX_PER_TENANT) || 3)), // na fila ou baixando, por cliente
    // sem bytes novos por este tempo, encerra a árvore inteira do downloader; evita uma vaga presa indefinidamente
    stallMs: Math.min(10 * 60_000, Math.max(30_000, Math.floor(Number(process.env.IMPORT_STALL_SECONDS) || 120) * 1000)),
    maxQueue: 30,
  },

  // Relógio por NTP (docs/RELOGIO.md). Liga/desliga e servidores ficam no superadmin; aqui, a chave geral e os padrões.
  // Desligado sob o executor de testes do Node (NODE_TEST_CONTEXT): os testes não dependem de rede.
  ntp: {
    enabled: process.env.NTP_SYNC !== '0' && !process.env.NODE_TEST_CONTEXT,
    servers: process.env.NTP_SERVERS ? normalizeServers(process.env.NTP_SERVERS) : NIC_BR,
    intervalMin: Math.min(1440, Math.max(1, Math.floor(Number(process.env.NTP_INTERVAL_MIN) || 15))),
  },

  // clipes e canais de demonstração: ligados em desenvolvimento, desligados em produção (a menos que SEED_DEMO=1)
  seedDemo: process.env.SEED_DEMO ? process.env.SEED_DEMO === '1' : process.env.NODE_ENV !== 'production',

  // chave que assina as sessões do painel. Com ela fixa, as sessões sobrevivem a deploys e réplicas.
  sessionSecret: process.env.SESSION_SECRET || (edgeOn ? edgeSessionSecret() : ''),

  // versão deste servidor (o build da edição Windows carimba a do instalador)
  version: build.version || pkgVersion,

  // Monitor da máquina (Telemetria → Máquina e a faixa do topo; docs/TELEMETRIA.md): CPU, memória e commit, discos, rede,
  // GPU, ping e processos DESTE computador. Liga sozinho na edição Windows; num servidor próprio de um cliente só,
  // MACHINE_MONITOR=1. Nunca na nuvem compartilhada (a máquina é de todos os clientes): no Railway fica desligado mesmo com a
  // variável, e com mais de um cliente no banco as rotas somem (server/maquina.js). Desligado sob o executor de testes (o
  // coletor abre PowerShell e ping): os testes ligam com MACHINE_MONITOR=1 quando precisam.
  machine: {
    enabled: !process.env.RAILWAY_DEPLOYMENT_ID && !process.env.RAILWAY_REPLICA_ID // só existem dentro do Railway (o RAILWAY_PROJECT_ID pode estar no servidor próprio, para os domínios)
      && (process.env.MACHINE_MONITOR ? process.env.MACHINE_MONITOR === '1' : edgeOn && !process.env.NODE_TEST_CONTEXT),
  },

  // Retransmissão da Análise Espectral do NEXA Scopes (celular fora da rede → computador; server/espectral-nuvem.js,
  // docs/ESPECTRAL-NUVEM.md): ligada na nuvem; desligada na edição Windows (o NEXA Scopes fala com nexa.tv.br).
  // ESPECTRAL_NUVEM=0/1 força.
  scopesEspectral: {
    enabled: process.env.ESPECTRAL_NUVEM ? process.env.ESPECTRAL_NUVEM !== '0' : !edgeOn,
  },

  // Edição Windows (docs/WINDOWS.md): instalação local controlada pela central. EDGE_MODE=1 liga o agente de licença.
  edge: {
    enabled: edgeOn,
    // central que controla esta instalação (licença, mensagens, comandos, atualizações)
    central: String(process.env.EDGE_CENTRAL_URL || build.central || 'https://api.nexa.tv.br').trim().replace(/\/+$/, ''),
    // chaves públicas da central fixadas no build ou na variável (separadas por vírgula); vazio = fixada na ativação
    publicKeys: String(process.env.EDGE_PUBLIC_KEY || build.publicKey || '').split(',').map((s) => s.trim()).filter(Boolean),
    // de onde a atualização pode ser baixada (prefixo da URL); vazio = qualquer https assinado pela central
    releasePrefix: String(process.env.EDGE_RELEASE_URL_PREFIX ?? build.releasePrefix ?? '').trim(),
    // domínio público dos arquivos de mídia da nuvem (R2_PUBLIC_URL da central): de onde os vídeos copiados tocam e as imagens
    // são baixadas (server/edge/copy.js). Aceito ao lado da origem da central e da do prefixo das versões.
    mediaUrl: String(process.env.EDGE_MEDIA_URL ?? build.mediaUrl ?? 'https://midia.nexa.tv.br').trim().replace(/\/+$/, ''),
    // impressão digital (SHA-1) do certificado que assina o instalador; definida = só roda instalador com essa assinatura válida
    installerSigner: String(process.env.EDGE_INSTALLER_SIGNER ?? build.installerSigner ?? '').replace(/\s+/g, '').toUpperCase(),
    // só testes: intervalo da conversa com a central (ms) no lugar do que a central pede
    syncMs: Math.max(0, Number(process.env.EDGE_SYNC_MS) || 0),
    updatesDir: path.join(dataDir, 'updates'),
    // rodando como serviço do Windows (o instalador define): "reiniciar o serviço" sai do processo e o serviço sobe de novo
    service: process.env.EDGE_SERVICE === '1',
    // a tela de ativação aceita só o próprio computador; 1 libera pela rede (servidor sem tela, sob sua conta e risco)
    remoteSetup: process.env.EDGE_SETUP_REMOTE === '1',
    // só testes: baixa e confere a atualização, mas não executa o instalador
    updateDryRun: process.env.EDGE_UPDATE_DRY_RUN === '1',
    // central em http:// (só desenvolvimento e testes; em produção a central é sempre https)
    allowHttp: process.env.EDGE_ALLOW_HTTP === '1',
  },
};

for (const o of config.http.consoleOrigins) {
  if (!/^https?:\/\/[^/\s]+$/.test(o)) throw new Error(`CONSOLE_ORIGINS: "${o}" não é uma origem completa (use https://console.seudominio.com, sem caminho).`);
}
/**
 * SUPERADMIN_UI: o servidor da API também serve /superadmin e /lab? Padrão: 1 em desenvolvimento; em produção, 0 quando
 * CONSOLE_ORIGINS está definido (o console mora no próprio domínio) e 1 quando não está (instalação de um servidor só).
 */
config.http.superadminUi = process.env.SUPERADMIN_UI
  ? process.env.SUPERADMIN_UI !== '0'
  : !(config.production && config.http.consoleOrigins.length);
// instalação local: quem controla é o superadmin da central; o computador não tem console da plataforma
if (config.edge.enabled) config.http.superadminUi = false;

if (config.production) {
  // instalação local: o primeiro administrador é criado na tela de ativação (/setup/), não por variável
  const pw = process.env.ADMIN_PASSWORD;
  if (config.edge.enabled ? pw && pw.length < 12 : !pw || pw.length < 12) {
    throw new Error('Em produção defina ADMIN_PASSWORD com pelo menos 12 caracteres.');
  }
  config.demoMode = false; // nunca mostra a senha na tela de login em produção
}
if (config.edge.enabled && !/^https:\/\//.test(config.edge.central) && !(config.edge.allowHttp || !config.production)) {
  throw new Error(`EDGE_CENTRAL_URL precisa ser https:// em produção (recebido: ${config.edge.central}).`);
}

for (const d of [config.dataDir, config.mediaDir, config.thumbsDir, config.hlsDir, config.graphicsDir, config.fontsDir, config.lutsDir, config.captionsDir, config.lojaDocsDir, config.cueAudioDir, config.recordDir, config.importDir, config.freezeDir]) {
  fs.mkdirSync(d, { recursive: true });
}

/** Fonte para drawtext (slate / clipes demo). Opcional. */
export function findFont() {
  const candidates = [
    'C:/Windows/Fonts/arialbd.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  ];
  return candidates.find((f) => fs.existsSync(f)) || null;
}

/** Escapa um valor para uso dentro de um filtergraph do FFmpeg. */
export const ffEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\u2019").replace(/%/g, '\\%');
