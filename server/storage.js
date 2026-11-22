import fs from 'node:fs';
import path from 'node:path';
import { Transform, pipeline } from 'node:stream';
import { config } from './config.js';
import { roomFor, noSpace } from './diskbudget.js';
import { readsHttps } from './ffcaps.js';
import { SyncedWriter } from './escrita.js'; // o download do cache descarrega no disco a cada 32 MB (21/10: o sujo do volume segurava o laço)

/**
 * Armazenamento de arquivos do playout, com dois drivers:
 *   - local: tudo em DATA_DIR (media/, thumbs/, graphics/)
 *   - r2   : Cloudflare R2 (API S3). O disco local vira CACHE: o FFmpeg lê de arquivos locais,
 *            então ensureLocal() baixa do R2 na primeira vez e reaproveita depois.
 *
 * Os arquivos são sempre endereçados por (tipo, nome): tipo ∈ media | thumbs | graphics | fonts | captions.
 * No R2 a chave é "<tipo>/<nome>".
 */
// luts: só o servidor lê (sem rota pública); lojadocs: documentos dos títulos da Loja (cue-sheet do ECAD, CPB…), só pela API
export const KINDS = { media: config.mediaDir, thumbs: config.thumbsDir, graphics: config.graphicsDir, fonts: config.fontsDir, captions: config.captionsDir, luts: config.lutsDir, lojadocs: config.lojaDocsDir, cueaudio: config.cueAudioDir };

/*
 * Loja de conteúdos (docs/LOJA.md). Os vídeos da Loja são do tipo "media", com nome próprio:
 *   lj-<32 hex>.<ext>          o arquivo de um título (o canônico)
 *   ljp-<32 hex>.mp4           a prévia (os primeiros 20%, baixa resolução)
 *   lj-<32 hex>-l<id>.<ext>    o apelido da mídia licenciada na biblioteca de um canal (licença <id>): media.filename é
 *                              único, então cada licença tem o seu nome, mas todos apontam para o MESMO arquivo, sem cópia
 * No armazenamento ficam sob "loja/" (R2: no bucket da Loja, R2_STORE_BUCKET, ou no prefixo loja/ do bucket principal) e
 * nunca saem por URL pública: url() devolve null, a rota /media/:file não os entrega e remove() só apaga o canônico quando a
 * própria Loja pede ({ store: true }); o apelido de um canal nunca apaga nada. No disco local o cache é um só por arquivo
 * (o canônico), compartilhado pelos canais que licenciaram.
 */
export const STORE_FILE_RE = /^(ljp?-[0-9a-f]{32})(?:-l(\d{1,12}))?(\.[a-z0-9]{2,5})$/;
/** O nome é de um arquivo da Loja (canônico, prévia ou apelido de licença)? */
export const isStoreFile = (name) => STORE_FILE_RE.test(String(name ?? ''));
/** Apelido de licença ("lj-<hex>-l<id>.mp4")? */
export const isStoreAlias = (name) => Boolean(STORE_FILE_RE.exec(String(name ?? ''))?.[2]);
/** Nome canônico do arquivo da Loja ("lj-<hex>.mp4") a partir de um apelido; null se não é da Loja. */
export const storeCanonical = (name) => { const m = STORE_FILE_RE.exec(String(name ?? '')); return m ? `${m[1]}${m[3]}` : null; };
/** Arquivo protegido pela Loja: sem URL pública e sem remoção fora da Loja. */
const storeKind = (kind, name) => kind === 'lojadocs' || (kind === 'media' && isStoreFile(name));

const localPath = (kind, name) => {
  if (!KINDS[kind] || !/^[\w.-]+$/.test(name)) throw new Error('arquivo inválido');
  return path.join(KINDS[kind], kind === 'media' ? storeCanonical(name) || name : name);
};
const keyOf = (kind, name) => (kind === 'lojadocs' ? `loja/docs/${name}` : kind === 'media' && isStoreFile(name) ? `loja/${storeCanonical(name)}` : `${kind}/${name}`);
/**
 * O contrário de keyOf: a chave de um objeto do bucket → { kind, name }, ou null se a chave não é de um arquivo do app (outro
 * prefixo, subpasta, apelido de licença ou nome da Loja fora de loja/). Só devolve o par se keyOf(kind, name) der a MESMA
 * chave: a limpeza do bucket (server/storage-inventory.js) nunca apaga um objeto pelo nome errado.
 */
export function kindOfKey(key) {
  const k = String(key ?? '');
  let m = /^loja\/docs\/([\w.-]+)$/.exec(k);
  let out = m ? { kind: 'lojadocs', name: m[1] } : null;
  if (!out && (m = /^loja\/([\w.-]+)$/.exec(k)) && isStoreFile(m[1]) && !isStoreAlias(m[1])) out = { kind: 'media', name: m[1] };
  if (!out && (m = /^(media|thumbs|graphics|fonts|captions|luts)\/([\w.-]+)$/.exec(k))) out = { kind: m[1], name: m[2] };
  return out && keyOf(out.kind, out.name) === k ? out : null;
}

const MIME = { '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.vob': 'video/mpeg', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.ttf': 'font/ttf', '.otf': 'font/otf', '.vtt': 'text/vtt', '.ts': 'video/mp2t' };
const mimeOf = (name) => MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
// NEXA Nuvem não aceita chave escolhida pelo MAM. Estas são as únicas chaves que as operações privadas abaixo reconhecem;
// o tenant e o sufixo aleatório são criados pelo Broadcast em server/mam-cloud.js.
// A pasta do canal é defesa em profundidade: a autorização continua no banco,
// mas os objetos privados novos também não dividem o mesmo prefixo lógico.
const MAM_CLOUD_KEY = /^mam-cloud\/t[1-9]\d*\/(?:c[1-9]\d*\/)?mc_[a-f0-9]{32}(?:\.[a-z0-9]{1,12})?$/i;
const mamCloudKey = (key) => MAM_CLOUD_KEY.test(String(key || ''));
const MAM_CLOUD_PREFIX = /^mam-cloud\/(?:t[1-9]\d*\/)?$/i;

/** Teto que vale agora para um download (bytes/s; 0 = sem teto): o menor entre o dele (rate) e o de prioridade (cap). */
const rateOf = (limit) => {
  const r = Number(limit.rate) || 0;
  const c = Number(typeof limit.cap === 'function' ? limit.cap() : limit.cap) || 0;
  return r > 0 && c > 0 ? Math.min(r, c) : r || c;
};

/**
 * Leitura com teto de vazão (bytes/s), para quem baixa em segundo plano sem disputar a rede com o ar (legendas por IA,
 * docs/LEGENDAS.md). `limit.rate` pode mudar no meio (0 = sem teto): outro pedido do MESMO arquivo sem teto (o motor
 * precisando dele para o ar) solta o freio do download em andamento, que ele passa a esperar. `limit.cap` (número ou
 * função): o teto de prioridade, que esse pedido NÃO solta (a leitura do ar pelo bucket, R2Storage.yieldTo). Balde de
 * fichas: o teto pode mudar a qualquer hora (subir, cair, sair) sem rajada nem espera acumulada.
 */
/**
 * O freio do ar no meio de um envio ao R2 (21/10: o envio do bipe de 1,8 GB seguia com o ar a 0,30×): cada pedaço espera enquanto
 * hold() disser um motivo (conferido a cada pollMs); o envio continua de onde parou quando o freio solta. signal: cancela.
 */
export function holdGate(hold, { signal = null, pollMs = 1000 } = {}) {
  return new Transform({
    transform(chunk, _enc, cb) {
      const go = () => {
        if (signal?.aborted) { cb(signal.reason instanceof Error ? signal.reason : new Error('envio cancelado')); return; }
        let why = null;
        try { why = hold(); } catch { why = null; }
        if (!why) { cb(null, chunk); return; }
        const t = setTimeout(go, pollMs); t.unref?.();
      };
      go();
    },
  });
}

export function throttleStream(limit) {
  let next = 0; // instante (ms) a partir do qual o próximo pedaço pode passar
  return new Transform({
    transform(chunk, _enc, cb) {
      const go = () => {
        const rate = rateOf(limit);
        const now = Date.now();
        if (!(rate > 0)) { next = now; return cb(null, chunk); }
        if (next <= now + 1) { next = Math.max(next, now) + (chunk.length / rate) * 1000; return cb(null, chunk); }
        limit.waitedAt = now; // o freio segurou: a vazão deste download agora é a do teto, não a da rede (R2Storage.linkRate)
        setTimeout(go, Math.min(next - now, 250)); // confere o teto de novo a cada 250 ms (pode ter sido solto)
      };
      go();
    },
  });
}

const fmtNum = (x, d) => x.toFixed(d).replace('.', ',');
/** "1,2 GB", "812 MB" (10^6 / 10^9 bytes): o andamento de um download nos logs e na Saúde do sinal. Exportada para o motor. */
export const fmtSize = (b) => (b >= 1e9 ? `${fmtNum(b / 1e9, 1)} GB` : `${fmtNum(b / 1e6, b < 10e6 ? 1 : 0)} MB`);
// download do R2 para o cache (ensureLocal): sem um byte por DL_STALL_MS = parado; até DL_TRIES tentativas, cada uma retomando
// (Range) do que já está no disco, com espera crescente entre elas
const DL_STALL_MS = 60_000;
// a parte do teto de prioridade (yieldTo) que fica com o download do arquivo que o ar lê pelo bucket (#yieldShare)
const YIELD_AIR_SHARE = 0.75;
const DL_TRIES = 5;
const DL_RETRY_MS = [2000, 5000, 15000, 30000];
// PRÉVIA do Playout (prefer, docs/TROCA-DE-ITEM.md "TAKE de um arquivo frio"): o download do item preparado leva CUE_SHARE da
// rede que sobra depois da leitura do ar pelo bucket; sem leitura do ar pelo bucket, os outros downloads dividem o resto do
// link medido (CUE_LINK_GUESS bytes/s enquanto não há medida), nunca abaixo de CUE_MIN_BPS
const CUE_SHARE = 0.75;
const CUE_LINK_GUESS = 1024 * 1024;
const CUE_MIN_BPS = 64 * 1024;
// vazão até o bucket (linkRate): janelas de LINK_WIN_MS com download em andamento; vale a média das janelas livres (sem o freio
// segurando todos os downloads) dos últimos LINK_RECENT_MS, dentro de LINK_KEEP_MS
const LINK_WIN_MS = 2000;
const LINK_RECENT_MS = 30_000;
const LINK_KEEP_MS = 10 * 60_000;
// andamento de cada download (o "~1 min" da PRÉVIA): a vazão dele medida a cada DL_RATE_MS
const DL_RATE_MS = 2000;
const COPY_MAX = 5 * 1024 ** 3; // teto do CopyObject (5 GiB): acima disso, a cópia vai em partes
const COPY_PART = 512 * 1024 ** 2; // tamanho de cada parte da cópia em partes
/** "812 MB em 74,2 s (10,9 MB/s)": tamanho, tempo e vazão de um download do bucket (MB = 10^6 bytes). Exportada para os testes. */
export const downloadStats = (bytes, ms) => {
  const mb = bytes / 1e6; const s = Math.max(ms, 1) / 1000;
  return `${fmtNum(mb, mb < 10 ? 1 : 0)} MB em ${fmtNum(s, 1)} s (${fmtNum(mb / s, 1)} MB/s)`;
};

/**
 * Arquivos na pasta local de um tipo que começam com `prefix` (sem as partes de download em andamento):
 * [{ name, at, mtimeMs, size }] (at = mtimeMs = última gravação, ms; os dois nomes servem às varreduras do mural e do fundo;
 * size em bytes: o medidor de armazenamento soma as imagens de cada cliente, server/storage-graphics.js).
 */
async function listLocal(kind, prefix) {
  let names = [];
  try { names = (await fs.promises.readdir(KINDS[kind])).filter((n) => n.startsWith(prefix) && !n.includes('.part-')); } catch { return []; }
  const out = [];
  for (const name of names) {
    const st = await fs.promises.stat(path.join(KINDS[kind], name)).catch(() => null);
    if (st?.isFile()) out.push({ name, at: st.mtimeMs, mtimeMs: st.mtimeMs, size: st.size });
  }
  return out;
}

class LocalStorage {
  driver = 'local';
  /** Arquivo já está em KINDS[kind]; nada a enviar. */
  async put() {}
  async ensureLocal(kind, name) { return localPath(kind, name); }
  downloading() { return null; } // nada baixa: o arquivo já está no disco
  downloads() { return []; }
  yieldTo() {} // nada a ceder: não há download (R2Storage.yieldTo)
  yielding() { return false; }
  prefer() {} // a PRÉVIA não tem o que baixar (R2Storage.prefer)
  linkRate() { return null; } // sem bucket: nada a medir (R2Storage.linkRate)
  async remove(kind, name, { store = false } = {}) {
    if (storeKind(kind, name) && (!store || isStoreAlias(name))) return; // arquivo da Loja: só a Loja apaga, e nunca pelo apelido
    await fs.promises.rm(localPath(kind, name), { force: true }); markLocal(kind, name, false); // assíncrono: arquivo de GB não trava o laço
  }
  /**
   * Copia o arquivo para outro nome do mesmo tipo (não sobrescreve). Vídeo: tenta um link físico antes (o arquivo da Loja
   * criado a partir da biblioteca da plataforma não duplica o espaço no disco; apagar um não apaga o outro).
   */
  async copy(kind, from, to) {
    const src = localPath(kind, from); const dst = localPath(kind, to);
    if (kind === 'media') { try { await fs.promises.link(src, dst); return; } catch (e) { if (e.code === 'EEXIST') throw e; } }
    await fs.promises.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
  }
  async exists(kind, name) { return isCached(kind, name); }
  async listLocal(kind, prefix = '') { return listLocal(kind, prefix); }
  /** Saúde do armazenamento (painel de recursos): a pasta da mídia aceita gravação? Lança erro se não. */
  async ping() { await fs.promises.access(config.mediaDir, fs.constants.W_OK); return { detail: 'pasta da mídia gravável' }; }
  /** Rota do servidor que entrega o arquivo (estática). */
  // nome que já é endereço (miniatura ou fundo de um vídeo copiado da nuvem na edição Windows, server/edge/copy.js): como está
  url(kind, name) { return isUrl(name) ? name : storeKind(kind, name) ? null : `/${kind}/${name}`; }
  async signedUrl() { return null; }
  async prune() {}
  /** Tamanho do arquivo (ou null). */
  async head(kind, name) { try { return { size: (await fs.promises.stat(localPath(kind, name))).size, etag: null }; } catch { return null; } }
  /** Arquivos de um tipo que começam com `prefix`: [{ name, at, mtimeMs }] (varreduras de órfãos e de prazo). */
  async list(kind, prefix = '') { return listLocal(kind, prefix); }
  // Envio direto do navegador (multipart com URLs assinadas) só existe no R2: no disco local o upload passa pelo servidor.
  async createMultipart() { throw new Error('Envio direto disponível só com o armazenamento R2.'); }
  async presignPart() { throw new Error('Envio direto disponível só com o armazenamento R2.'); }
  async completeMultipart() { throw new Error('Envio direto disponível só com o armazenamento R2.'); }
  async listParts() { return []; }
  async abortMultipart() {}
  // O arquivo de NEXA Nuvem nunca passa pelo disco local, nem tem uma rota pública. Sem R2, a API recusa a abertura antes de
  // reservar bytes ou devolver uma URL.
  async createMamCloudMultipart() { throw new Error('NEXA Nuvem requer armazenamento R2.'); }
  async presignMamCloudPart() { throw new Error('NEXA Nuvem requer armazenamento R2.'); }
  async completeMamCloudMultipart() { throw new Error('NEXA Nuvem requer armazenamento R2.'); }
  async listMamCloudParts() { return []; }
  async abortMamCloudMultipart() {}
  async signedMamCloudGet() { throw new Error('NEXA Nuvem requer armazenamento R2.'); }
  async headMamCloud() { return null; }
  async removeMamCloud() {}
  async listMamCloudObjects() { return { objects: [], truncated: false }; }

  /*
   * Conferência do armazenamento (server/storage-inventory.js): no disco local o "bucket" são as pastas de cada tipo, com as
   * mesmas chaves do R2 (keyOf). Partes de download e arquivos em escrita (".part") ficam de fora.
   */
  buckets() { return ['local']; }
  async inventory() {
    const objects = [];
    for (const kind of Object.keys(KINDS)) {
      let names = [];
      try { names = await fs.promises.readdir(KINDS[kind]); } catch { continue; }
      for (const name of names) {
        if (!/^[\w.-]+$/.test(name) || name.includes('.part')) continue;
        const st = await fs.promises.stat(path.join(KINDS[kind], name)).catch(() => null); // saiu no meio: null
        if (st?.isFile()) objects.push({ key: keyOf(kind, name), size: st.size, at: st.mtimeMs });
      }
    }
    return { objects, truncated: false };
  }
  async multipartUploads() { return { uploads: [], truncated: false }; }
  async multipartBytes() { return 0; }
  async abortMultipartKey() {}
  async headKey({ key }) {
    const loc = kindOfKey(key);
    if (!loc) return null;
    try { const st = await fs.promises.stat(localPath(loc.kind, loc.name)); return { size: st.size, at: st.mtimeMs }; } catch { return null; }
  }
  /** Apaga o arquivo da chave (só chaves de arquivo do app: kindOfKey). */
  async removeKey({ key }) {
    const loc = kindOfKey(key);
    if (!loc) throw new Error('chave fora dos arquivos do app');
    await fs.promises.rm(localPath(loc.kind, loc.name), { force: true });
  }
}

class R2Storage {
  driver = 'r2';

  constructor(cfg) {
    this.cfg = cfg;
    this.client = null;
    this.inflight = new Map(); // downloads em andamento (evita baixar duas vezes o mesmo arquivo)
    this.limits = new Map(); // teto de vazão de cada download em andamento ({ rate } em bytes/s; 0 = sem teto)
    this.progress = new Map(); // andamento de cada download (downloading(): a Saúde do sinal mostra o do programa no ar)
    this.yields = new Map(); // quem lê o ar pelo bucket agora (o motor de cada canal) -> { cap: teto (bytes/s) da soma dos downloads, key: o arquivo que ele lê } (yieldTo)
    this.cues = new Map(); // arquivo da PRÉVIA (prefer): chave -> até quando (ms) o download dele vem antes dos outros
    // vazão medida até o bucket (linkRate): a janela aberta { at, bytes, keys } e as fechadas [{ at, ms, bytes, free }]
    this.meter = { win: null, samples: [] };
    this.stallMs = DL_STALL_MS; // os testes encurtam
    this.retryMs = DL_RETRY_MS;
    this.copyMax = COPY_MAX; // os testes encurtam (cópia em partes sem um arquivo de 5 GB)
    this.copyPart = COPY_PART;
  }

  /** Bucket e chave de um arquivo: os da Loja vão para o bucket da Loja (R2_STORE_BUCKET), se houver. */
  #loc(kind, name) { return { Bucket: storeKind(kind, name) && this.cfg.storeBucket ? this.cfg.storeBucket : this.cfg.bucket, Key: keyOf(kind, name) }; }
  /** Chave privada, opaca e criada pelo Broadcast para o arquivo de NEXA Nuvem. */
  #mamCloudLoc(key) {
    if (!mamCloudKey(key)) throw new Error('chave inválida de NEXA Nuvem');
    return { Bucket: this.cfg.bucket, Key: String(key) };
  }

  async #sdk() {
    if (this.client) return this.client;
    const { S3Client } = await import('@aws-sdk/client-s3');
    const { endpoint, accessKeyId, secretAccessKey, bucket } = this.cfg;
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error('R2 incompleto: defina R2_ACCOUNT_ID (ou R2_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY e R2_BUCKET.');
    }
    this.client = new S3Client({
      region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: this.cfg.forcePathStyle ?? false,
      // As versões novas do SDK da AWS adicionam checksums em streaming (aws-chunked) que o R2 não aceita:
      // só calcular quando o serviço exige (correção recomendada pela Cloudflare para o R2).
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    return this.client;
  }

  /**
   * Envia o arquivo local para o R2 (multipart automático para arquivos grandes). signal (opcional): abortar cancela o
   * envio (o multipart pela metade é descartado no R2) e a promessa rejeita — a fila da censura usa no tempo máximo.
   * onProgress(enviados, total) (opcional): a cada parte que sobe (o andamento do 5.1 convertido da Mídia).
   */
  async put(kind, name, { signal, onProgress = null, hold = null } = {}) {
    signal?.throwIfAborted();
    const { Upload } = await import('@aws-sdk/lib-storage');
    const client = await this.#sdk();
    const file = localPath(kind, name);
    // hold (opcional): o freio do ar no meio do envio (holdGate); sem o caminho do arquivo no stream, o SDK manda o total como
    // desconhecido no andamento (onProgress(enviados, null))
    const src = fs.createReadStream(file);
    const body = hold ? pipeline(src, holdGate(hold, { signal }), () => {}) : src;
    const abortController = new AbortController();
    const onAbort = () => { abortController.abort(); body.destroy(); src.destroy(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const upload = new Upload({
      client, queueSize: 3, partSize: 16 * 1024 * 1024, abortController,
      params: { ...this.#loc(kind, name), Body: body, ContentType: mimeOf(name) },
    });
    if (onProgress) upload.on('httpUploadProgress', (p) => onProgress(Number(p?.loaded) || 0, Number(p?.total) || null));
    try { await upload.done(); } finally { signal?.removeEventListener('abort', onAbort); }
  }

  /**
   * Garante o arquivo no disco local (cache). Devolve o caminho. room (opcional, { minFree }): antes de gravar, confere se o
   * arquivo cabe deixando a reserva do ar (server/diskbudget.js); não cabendo, desiste sem escrever nada (erro 507). Quem
   * só LÊ o arquivo (probe, conversão, loudness) usa readInput, que nem baixa. maxBytesPerSec (opcional): baixa com teto de
   * vazão (tarefa de segundo plano); um pedido do mesmo arquivo sem teto, no meio, solta o freio (throttleStream).
   */
  async ensureLocal(kind, name, { room = null, maxBytesPerSec = 0, priority = false } = {}) {
    const dest = localPath(kind, name);
    // sem I/O síncrono (18/10, 23:50: com o volume novo em /data, o processo travou ~20 s no TAKE de um arquivo fora do cache)
    const have = await fs.promises.stat(dest).catch(() => null);
    if (have) { await fs.promises.utimes(dest, new Date(), have.mtime).catch(() => {}); return dest; }
    const k = keyOf(kind, name);
    if (this.inflight.has(k) && !(maxBytesPerSec > 0)) { const l = this.limits.get(k); if (l) l.rate = 0; }
    if (!this.inflight.has(k)) {
      const t0 = Date.now();
      // cap: a parte deste download no teto de prioridade (yieldTo), que um pedido sem teto do mesmo arquivo não solta
      // priority: fora do teto de prioridade (o cache aquecido dos itens curtos, com o próprio teto em maxBytesPerSec); só a
      // PRÉVIA do Playout passa na frente dele (#cueRest)
      const limit = { rate: maxBytesPerSec > 0 ? Number(maxBytesPerSec) : 0, cap: priority ? () => this.#cueRest(k) : () => this.#yieldShare(k) };
      this.limits.set(k, limit);
      // rate: a vazão deste download agora (bytes/s, a cada DL_RATE_MS; o "~1 min" da PRÉVIA); key: a janela da vazão até o bucket
      const prog = { bytes: 0, total: null, since: t0, attempt: 1, error: null, rate: null, mark: null, key: k };
      this.progress.set(k, prog);
      this.#meterCut(); // um download a mais: a janela da vazão recomeça (linkRate)
      this.inflight.set(k, (async () => {
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const client = await this.#sdk();
        const tmp = `${dest}.part-${process.pid}`;
        let etag = null;
        for (let attempt = 1; ; attempt++) {
          prog.attempt = attempt;
          if (prog.total && prog.bytes >= prog.total) break; // tudo já estava no disco (caiu depois do último byte)
          const from = prog.bytes; // retomada: do que já está no disco
          try {
            const out = await this.#get(client, GetObjectCommand, k, from, etag, this.#loc(kind, name).Bucket);
            // retomada que o bucket não aceitou (devolveu o objeto inteiro): recomeça do zero
            const m = /^bytes (\d+)-/.exec(String(out.ContentRange || ''));
            const start = from > 0 && m && Number(m[1]) === from ? from : 0;
            prog.bytes = start; prog.mark = null;
            prog.total = start + (Number(out.ContentLength) || 0);
            etag ??= out.ETag || null;
            if (room && attempt === 1 && !(await roomFor(prog.total, { dir: path.dirname(dest), minFree: room.minFree })).ok) {
              out.Body?.destroy?.();
              throw noSpace(`Sem espaço no servidor para baixar este arquivo agora (${Math.round(prog.total / 1e6)} MB): os canais no ar vêm antes.`);
            }
            await this.#save(out.Body, tmp, start, limit, prog);
            break;
          } catch (err) {
            prog.bytes = (await fs.promises.stat(tmp).catch(() => null))?.size ?? 0; // o que chegou ao disco
            const status = err?.$metadata?.httpStatusCode;
            if (status === 412) { prog.bytes = 0; etag = null; } // o objeto mudou no bucket: baixa de novo do zero
            // sem volta: o arquivo não existe, sem permissão, sem espaço
            const final = err?.code === 'ENOSPC_GUARD' || err?.code === 'ENOSPC' || status === 403 || status === 404 || err?.name === 'NoSuchKey';
            if (final || attempt >= DL_TRIES) { await fs.promises.rm(tmp, { force: true }).catch(() => {}); throw err; }
            const wait = this.retryMs[Math.min(attempt - 1, this.retryMs.length - 1)];
            prog.error = String(err?.message || err).slice(0, 160);
            console.warn(`[storage] ${k}: download interrompido em ${fmtSize(prog.bytes)} de ${prog.total ? fmtSize(prog.total) : '?'} (${prog.error}); nova tentativa em ${fmtNum(wait / 1000, 0)} s, de onde parou (${attempt + 1}ª de ${DL_TRIES})`);
            await new Promise((r) => setTimeout(r, wait));
          }
        }
        await fs.promises.rename(tmp, dest); markLocal(kind, name, true);
        // todo download do bucket vai ao log (Deploy Logs do Railway): na partida a frio é ele que segura o ar (docs/DEPLOY.md)
        const size = (await fs.promises.stat(dest).catch(() => null))?.size ?? prog.bytes;
        console.log(`[storage] ${k}: ${downloadStats(size, Date.now() - t0)}${prog.attempt > 1 ? ` (${prog.attempt} tentativas)` : ''}`);
      })().catch((err) => {
        console.warn(`[storage] ${k}: download falhou em ${fmtNum((Date.now() - t0) / 1000, 1)} s${prog.attempt > 1 ? ` e ${prog.attempt} tentativas` : ''} (${String(err?.message || err).slice(0, 160)})`);
        throw err;
      }).finally(() => { this.#meterCut(); this.inflight.delete(k); this.limits.delete(k); this.progress.delete(k); }));
    }
    await this.inflight.get(k);
    return dest;
  }

  /** Os downloads em andamento agora (o log "[laço] travou", server/laco.js): [{ key, bytes, total, attempt }], sem I/O. */
  downloads() { return [...this.progress].map(([key, p]) => ({ key, bytes: p.bytes, total: p.total, attempt: p.attempt })); }

  /** Download em andamento de um arquivo: { bytes, total, since, attempt, error } (bytes no disco; total do objeto) ou null. */
  downloading(kind, name) { return this.progress.get(keyOf(kind, name)) ?? null; }

  /**
   * A leitura do ar pelo bucket tem a rede primeiro (16/10, docs/DEPLOY.md "Partida a frio"): depois de um deploy, o download
   * do arquivo no ar (e o do cache aquecido) disputava o link com o FFmpeg que lê o mesmo objeto por Range, e a saída caía
   * abaixo do tempo real até o cartão. Enquanto um motor lê o ar pelo bucket, ele diz aqui o teto (bytes/s) que TODOS os
   * downloads do servidor somados podem usar; com mais de um motor lendo, vale o menor. 0 = esse motor não lê mais.
   */
  yieldTo(owner, bytesPerSec, name = null) {
    if (bytesPerSec > 0) this.yields.set(owner, { cap: Number(bytesPerSec), key: name ? keyOf('media', name) : null }); else this.yields.delete(owner);
  }

  /** Algum motor lendo o ar pelo bucket agora (o cache aquecido espera para começar outro arquivo). */
  yielding() { return this.yields.size > 0; }

  /**
   * PRÉVIA do Playout (21/10, docs/TROCA-DE-ITEM.md "TAKE de um arquivo frio"): o download deste arquivo vem antes dos outros
   * (o cache aquecido, as tarefas de fundo) por `ttlMs` (o painel repete o pedido enquanto o item estiver na PRÉVIA); a leitura
   * do ar pelo bucket continua na frente de tudo (#yieldShare). Vale também para o download que já estava em andamento: o teto
   * de cada download é conferido a cada pedaço. ttlMs 0 = solta.
   */
  prefer(kind, name, ttlMs) {
    const k = keyOf(kind, name);
    if (ttlMs > 0) this.cues.set(k, Date.now() + ttlMs); else this.cues.delete(k);
  }

  /** Os arquivos da PRÉVIA com download em andamento agora (os vencidos saem). */
  #cueKeys() {
    const now = Date.now(); const out = new Set();
    for (const [k, until] of this.cues) { if (until <= now) this.cues.delete(k); else if (this.inflight.has(k)) out.add(k); }
    return out;
  }

  /**
   * Parte do download `k` no teto de prioridade; 0 = sem teto. O download do arquivo que o ar lê pelo bucket (o que tira o ar da
   * internet) leva YIELD_AIR_SHARE do teto; os outros (o cache aquecido, a troca de item seguinte) dividem o resto. Sem ele em
   * andamento, todos dividem o teto igual. 18/10: dividido igual, o download de 1,04 GB do arquivo do ar não terminou em 20 min.
   * PRÉVIA (prefer, 21/10): o arquivo do item preparado leva CUE_SHARE do que sobra depois do ar; sem leitura do ar pelo bucket
   * (sem teto de prioridade), os outros downloads dividem o resto do link medido e ela leva a rede que sobrar.
   */
  #yieldShare(k) {
    if (!this.yields.size) return this.#cueRest(k);
    const cue = this.#cueKeys();
    const cap = Math.min(...[...this.yields.values()].map((y) => y.cap));
    const air = new Set([...this.yields.values()].map((y) => y.key).filter((x) => x && this.inflight.has(x)));
    const n = Math.max(1, this.inflight.size);
    if (air.has(k)) return air.size >= n ? cap / n : (cap * YIELD_AIR_SHARE) / air.size;
    // o que sobra do ar: a PRÉVIA primeiro (o arquivo da PRÉVIA que é o do ar já está acima), os outros dividem o resto
    const pool = air.size ? cap * (1 - YIELD_AIR_SHARE) : cap;
    const pre = [...cue].filter((x) => !air.has(x));
    const rest = Math.max(0, n - air.size - pre.length);
    if (!pre.length) return pool / Math.max(1, rest);
    const share = rest ? CUE_SHARE : 1;
    return pre.includes(k) ? (pool * share) / pre.length : (pool * (1 - share)) / Math.max(1, rest);
  }

  /**
   * Teto do download `k` com a PRÉVIA baixando, fora do teto de prioridade (ninguém lendo o ar pelo bucket, ou os curtos do cache
   * aquecido): os que não são da PRÉVIA dividem (1 − CUE_SHARE) do link medido, nunca abaixo de CUE_MIN_BPS; 0 = sem teto.
   */
  #cueRest(k) {
    const cue = this.#cueKeys();
    if (!cue.size || cue.has(k)) return 0;
    // conferido a cada pedaço de cada download: a medida da vazão vale por 1 s
    const now = Date.now();
    if (!this.linkMemo || now - this.linkMemo.at > 1000) this.linkMemo = { at: now, bps: this.linkRate(now)?.bps || 0 };
    const link = this.linkMemo.bps || CUE_LINK_GUESS;
    return Math.max(CUE_MIN_BPS, link * (1 - CUE_SHARE)) / Math.max(1, this.inflight.size - cue.size);
  }

  /**
   * Vazão até o bucket medida pelos downloads (a PRÉVIA diz se a leitura pelo bucket acompanha o tempo real; o painel e o log
   * mostram): { bps, at, free, samples } ou null sem medida. free = de janelas em que ao menos um download andou sem o freio
   * (então a soma é o que a rede deu); false = só janelas com o freio segurando todos (a soma é um mínimo, não a rede). Os
   * downloads lentos de propósito (o teto de prioridade, as tarefas de fundo) não puxam a medida para baixo.
   */
  linkRate(now = Date.now()) {
    const m = this.meter;
    const open = m.win && now - m.win.at >= 1000 ? [this.#meterSample(m.win, now)] : [];
    const all = [...m.samples, ...open].filter((s) => now - s.at - s.ms <= LINK_KEEP_MS);
    const free = all.filter((s) => s.free);
    if (free.length) {
      // as janelas livres mais novas, até LINK_RECENT_MS somados (a rede de agora, não a da última hora)
      let ms = 0; let bytes = 0; let n = 0;
      for (let i = free.length - 1; i >= 0 && ms < LINK_RECENT_MS; i--) { ms += free[i].ms; bytes += free[i].bytes; n++; }
      return { bps: (bytes * 1000) / Math.max(1, ms), at: free[free.length - 1].at + free[free.length - 1].ms, free: true, samples: n };
    }
    if (!all.length) return null;
    const best = all.reduce((a, s) => ((s.bytes / s.ms) > (a.bytes / a.ms) ? s : a));
    return { bps: (best.bytes * 1000) / Math.max(1, best.ms), at: best.at + best.ms, free: false, samples: all.length };
  }

  /** A janela da vazão até o bucket fechada agora: { at, ms, bytes, free } (free: um download dela andou sem o freio). */
  #meterSample(w, now) {
    const free = [...w.keys].some((k) => { const l = this.limits.get(k); return !(l?.waitedAt >= w.at); });
    return { at: w.at, ms: Math.max(1, now - w.at), bytes: w.bytes, free };
  }

  /** Bytes que chegaram do bucket para o download `k` (a janela fecha a cada LINK_WIN_MS). */
  #meterData(k, n) {
    const m = this.meter; const now = Date.now();
    if (!m.win) m.win = { at: now, bytes: 0, keys: new Set() };
    m.win.bytes += n; m.win.keys.add(k);
    if (now - m.win.at >= LINK_WIN_MS) this.#meterCut(now);
  }

  /**
   * Fecha a janela da vazão (um download começou ou acabou, ou passou LINK_WIN_MS): a soma dos downloads muda de regime. Janela
   * curta demais (menos de 1 s) ou sem download não conta.
   */
  #meterCut(now = Date.now()) {
    const m = this.meter; const w = m.win;
    m.win = this.inflight.size ? { at: now, bytes: 0, keys: new Set() } : null;
    if (!w || now - w.at < 1000 || !w.keys.size) return;
    m.samples.push(this.#meterSample(w, now));
    while (m.samples.length && (m.samples.length > 400 || now - m.samples[0].at > LINK_KEEP_MS)) m.samples.shift();
  }

  /** Vazão de um download agora (prog.rate, bytes/s): a cada DL_RATE_MS, metade da medida nova e metade da anterior. */
  #dlRate(prog) {
    const now = Date.now();
    if (!prog.mark) { prog.mark = { t: now, b: prog.bytes }; return; }
    const dt = now - prog.mark.t;
    if (dt < DL_RATE_MS) return;
    const r = (Math.max(0, prog.bytes - prog.mark.b) * 1000) / dt;
    prog.rate = prog.rate == null ? r : prog.rate * 0.5 + r * 0.5;
    prog.mark = { t: now, b: prog.bytes };
  }

  /**
   * GetObject (a partir do byte `from`, se > 0, só se o objeto ainda for o mesmo: If-Match), com prazo para a resposta: o SDK
   * não tem prazo próprio, e um pedido sem resposta pendurava o download (e todo play do arquivo) para sempre.
   */
  async #get(client, GetObjectCommand, key, from, etag, bucket = this.cfg.bucket) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.stallMs);
    try {
      return await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, ...(from > 0 ? { Range: `bytes=${from}-`, ...(etag ? { IfMatch: etag } : {}) } : {}) }), { abortSignal: ac.signal });
    } catch (err) {
      if (ac.signal.aborted) throw new Error(`o bucket não respondeu em ${fmtNum(this.stallMs / 1000, 0)} s`);
      throw err;
    } finally { clearTimeout(timer); }
  }

  /**
   * Grava o corpo do objeto em `tmp` (a partir de `start`: acrescenta) contando os bytes em `prog`. Corpo parado por
   * stallMs (o socket mudo, sem erro nem fim: em 14/10 o download de 3 GB do programa no ar ficou assim mais de 1 h e
   * todo play caiu na leitura pela internet) = erro: a próxima tentativa retoma de onde o disco parou.
   */
  #save(body, tmp, start, limit, prog) {
    return new Promise((resolve, reject) => {
      // a cada 32 MB, uma descarga no disco antes do pedaço seguinte (server/escrita.js): o download nunca deixa gigabytes sujos
      // no cache de páginas do volume (21/10: com 1,6 GB sujos, toda gravação no volume, até a de poucos bytes, ficava presa)
      const ws = new SyncedWriter(tmp, { flags: start > 0 ? 'a' : 'w' });
      let timer = null; let failed = null;
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => body.destroy(new Error(`download parado: ${fmtNum(this.stallMs / 1000, 0)} s sem dados`)), this.stallMs); };
      const fail = (err) => { if (failed) return; failed = err; clearTimeout(timer); body.destroy?.(); ws.destroy(); };
      ws.on('close', () => { clearTimeout(timer); if (failed) reject(failed); });
      ws.on('finish', () => { clearTimeout(timer); if (!failed) resolve(); });
      ws.on('error', fail);
      body.on('error', fail);
      body.on('data', (c) => { prog.bytes += c.length; this.#dlRate(prog); this.#meterData(prog.key, c.length); arm(); });
      arm();
      // sempre pelo freio: o teto de prioridade (yieldTo) pode entrar no meio do download
      const th = throttleStream(limit); th.on('error', fail); body.pipe(th).pipe(ws);
    });
  }

  async remove(kind, name, { store = false } = {}) {
    if (storeKind(kind, name) && (!store || isStoreAlias(name))) return; // arquivo da Loja: só a Loja apaga, e nunca pelo apelido
    await fs.promises.rm(localPath(kind, name), { force: true }); markLocal(kind, name, false); // assíncrono: arquivo de GB não trava o laço
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await (await this.#sdk()).send(new DeleteObjectCommand(this.#loc(kind, name)));
  }

  /**
   * Copia o objeto para outro nome do mesmo tipo dentro do armazenamento (CopyObject, sem baixar nada) e o cache local, se
   * houver. Acima de 5 GiB (o teto do CopyObject) copia em partes (UploadPartCopy), também sem baixar.
   */
  async copy(kind, from, to) {
    const { CopyObjectCommand } = await import('@aws-sdk/client-s3');
    const src = this.#loc(kind, from); const dst = this.#loc(kind, to);
    const source = `${src.Bucket}/${src.Key.split('/').map(encodeURIComponent).join('/')}`;
    const size = kind === 'media' ? (await this.head(kind, from))?.size ?? 0 : 0;
    if (size > this.copyMax) await this.#copyParts(source, dst, size);
    else await (await this.#sdk()).send(new CopyObjectCommand({ ...dst, CopySource: source }));
    const local = localPath(kind, from);
    // cache: só conveniência. Sem I/O síncrono; o copyFile de uma vez sujaria o arquivo inteiro no cache de páginas: em pedaços,
    // com a descarga do SyncedWriter
    if (await isCached(kind, from)) await copyLocal(local, localPath(kind, to)).catch(() => {});
  }

  /**
   * Objetos "<tipo>/<prefix>…" do bucket (ListObjectsV2, todas as páginas até 100 mil): [{ name, at, mtimeMs }] (at = mtimeMs =
   * última gravação, ms; varreduras de órfãos e de prazo).
   */
  async list(kind, prefix = '') {
    if (!KINDS[kind]) throw new Error('arquivo inválido');
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const client = await this.#sdk();
    const out = [];
    let token;
    do {
      const r = await client.send(new ListObjectsV2Command({ Bucket: this.#loc(kind, prefix).Bucket, Prefix: keyOf(kind, prefix), ContinuationToken: token }));
      for (const o of r.Contents || []) {
        const name = String(o.Key || '').slice(keyOf(kind, '').length); // "<tipo>/" (documentos da Loja: "loja/docs/")
        const at = o.LastModified ? new Date(o.LastModified).getTime() : Date.now();
        if (/^[\w.-]+$/.test(name)) out.push({ name, at, mtimeMs: at, size: Number(o.Size) || 0 });
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token && out.length < 100_000);
    return out;
  }

  async exists(kind, name) {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    try { await (await this.#sdk()).send(new HeadObjectCommand(this.#loc(kind, name))); return true; } catch { return false; }
  }

  /**
   * Saúde do armazenamento (painel de recursos): o bucket responde ao HeadBucket? Lança erro se não. Com prazo (o cliente
   * S3 é o mesmo das mídias do ar: um pedido pendurado não pode segurar um socket). Token sem permissão para o HeadBucket
   * (403) devolve { unchecked: true }: não dá para checar, o que não quer dizer que o bucket esteja fora.
   */
  async ping({ timeoutMs = 10_000 } = {}) {
    const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
    try {
      await (await this.#sdk()).send(new HeadBucketCommand({ Bucket: this.cfg.bucket }), { abortSignal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if (e?.$metadata?.httpStatusCode === 403 || e?.name === 'AccessDenied' || e?.name === 'Forbidden') return { unchecked: true, detail: 'o token do R2 não tem permissão para o HeadBucket (o envio e a leitura das mídias não dependem disso)' };
      if (e?.name === 'AbortError' || e?.name === 'TimeoutError') throw new Error(`o bucket não respondeu em ${Math.round(timeoutMs / 1000)} s`);
      throw e;
    }
    return { detail: 'o bucket respondeu' };
  }

  /** URL para o navegador: domínio público do bucket, se houver; senão a rota do servidor (que redireciona). */
  url(kind, name) { return isUrl(name) ? name : storeKind(kind, name) ? null : this.cfg.publicBaseUrl ? `${this.cfg.publicBaseUrl}/${keyOf(kind, name)}` : `/${kind}/${name}`; }

  /** URL assinada de curta duração (bucket privado). */
  async signedUrl(kind, name, seconds = 300) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    return getSignedUrl(await this.#sdk(), new GetObjectCommand(this.#loc(kind, name)), { expiresIn: seconds });
  }

  /** Cópias no disco deste servidor (o cache do R2) que começam com `prefix`. */
  async listLocal(kind, prefix = '') { return listLocal(kind, prefix); }

  /** Tamanho e ETag do objeto no bucket (null se não existe). */
  async head(kind, name) {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    try {
      const out = await (await this.#sdk()).send(new HeadObjectCommand(this.#loc(kind, name)));
      return { size: Number(out.ContentLength), etag: out.ETag || null };
    } catch (err) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey') return null;
      throw err;
    }
  }

  /*
   * Envio direto do navegador ao bucket (docs/CONVERSAO.md, "Envio direto"): o servidor abre um multipart do S3 e assina
   * uma URL de PUT por parte. A assinatura amarra método, chave, uploadId e número da parte: a URL não serve para mais
   * nada, expira sozinha e nenhuma credencial sai do servidor.
   */
  async createMultipart(kind, name) {
    const { CreateMultipartUploadCommand } = await import('@aws-sdk/client-s3');
    const out = await (await this.#sdk()).send(new CreateMultipartUploadCommand({ ...this.#loc(kind, name), ContentType: mimeOf(name) }));
    if (!out.UploadId) throw new Error('o armazenamento não devolveu o UploadId');
    return out.UploadId;
  }

  async presignPart(kind, name, uploadId, partNumber, seconds = 3600) {
    const { UploadPartCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    return getSignedUrl(await this.#sdk(), new UploadPartCommand({ ...this.#loc(kind, name), UploadId: uploadId, PartNumber: partNumber }), { expiresIn: seconds });
  }

  /** parts: [{ partNumber, etag }] em ordem crescente. */
  async completeMultipart(kind, name, uploadId, parts) {
    const { CompleteMultipartUploadCommand } = await import('@aws-sdk/client-s3');
    await (await this.#sdk()).send(new CompleteMultipartUploadCommand({
      ...this.#loc(kind, name), UploadId: uploadId,
      MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }));
  }

  /** Cópia em partes (UploadPartCopy) de um objeto acima do teto do CopyObject. Falhou no meio: descarta as partes. */
  async #copyParts(source, dst, size) {
    const { CreateMultipartUploadCommand, UploadPartCopyCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } = await import('@aws-sdk/client-s3');
    const client = await this.#sdk();
    const { UploadId } = await client.send(new CreateMultipartUploadCommand({ ...dst, ContentType: mimeOf(dst.Key) }));
    try {
      const parts = [];
      for (let start = 0, n = 1; start < size; start += this.copyPart, n++) {
        const end = Math.min(size, start + this.copyPart) - 1;
        const r = await client.send(new UploadPartCopyCommand({ ...dst, UploadId, PartNumber: n, CopySource: source, CopySourceRange: `bytes=${start}-${end}` }));
        parts.push({ PartNumber: n, ETag: r.CopyPartResult?.ETag });
      }
      await client.send(new CompleteMultipartUploadCommand({ ...dst, UploadId, MultipartUpload: { Parts: parts } }));
    } catch (err) {
      await client.send(new AbortMultipartUploadCommand({ ...dst, UploadId })).catch(() => {});
      throw err;
    }
  }

  /** Descarta as partes já enviadas (o bucket deixa de cobrar por elas). */
  /** Partes já recebidas pelo bucket: [{ partNumber, size, etag }] (ListParts, todas as páginas). */
  async listParts(kind, name, uploadId) {
    const { ListPartsCommand } = await import('@aws-sdk/client-s3');
    const client = await this.#sdk();
    const out = [];
    let marker;
    do {
      const r = await client.send(new ListPartsCommand({ ...this.#loc(kind, name), UploadId: uploadId, PartNumberMarker: marker }));
      for (const p of r.Parts || []) out.push({ partNumber: Number(p.PartNumber), size: Number(p.Size), etag: p.ETag || null });
      marker = r.IsTruncated ? r.NextPartNumberMarker : undefined;
    } while (marker && out.length < 20000);
    return out;
  }

  async abortMultipart(kind, name, uploadId) {
    const { AbortMultipartUploadCommand } = await import('@aws-sdk/client-s3');
    await (await this.#sdk()).send(new AbortMultipartUploadCommand({ ...this.#loc(kind, name), UploadId: uploadId }));
  }

  /*
   * NEXA Nuvem: mesmas primitivas multipart privadas da biblioteca, porém sem expor uma chave arbitrária ou um bucket ao
   * chamador. O módulo MAM só recebe URLs temporárias de uma sessão que ele próprio abriu; os dados de R2 continuam aqui.
   */
  async createMamCloudMultipart({ key, contentType = 'application/octet-stream' }) {
    const { CreateMultipartUploadCommand } = await import('@aws-sdk/client-s3');
    const out = await (await this.#sdk()).send(new CreateMultipartUploadCommand({ ...this.#mamCloudLoc(key), ContentType: contentType }));
    if (!out.UploadId) throw new Error('o armazenamento não devolveu o UploadId');
    return out.UploadId;
  }

  async presignMamCloudPart({ key, uploadId, partNumber, seconds = 900 }) {
    const { UploadPartCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    return getSignedUrl(await this.#sdk(), new UploadPartCommand({ ...this.#mamCloudLoc(key), UploadId: uploadId, PartNumber: partNumber }), { expiresIn: seconds });
  }

  async completeMamCloudMultipart({ key, uploadId, parts }) {
    const { CompleteMultipartUploadCommand } = await import('@aws-sdk/client-s3');
    await (await this.#sdk()).send(new CompleteMultipartUploadCommand({
      ...this.#mamCloudLoc(key), UploadId: uploadId,
      MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }));
  }

  async listMamCloudParts({ key, uploadId }) {
    const { ListPartsCommand } = await import('@aws-sdk/client-s3');
    const client = await this.#sdk(); const out = []; let marker;
    do {
      const page = await client.send(new ListPartsCommand({ ...this.#mamCloudLoc(key), UploadId: uploadId, PartNumberMarker: marker }));
      for (const part of page.Parts || []) out.push({ partNumber: Number(part.PartNumber), size: Number(part.Size), etag: part.ETag || null });
      marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    } while (marker && out.length < 20_000);
    return out;
  }

  async abortMamCloudMultipart({ key, uploadId }) {
    const { AbortMultipartUploadCommand } = await import('@aws-sdk/client-s3');
    await (await this.#sdk()).send(new AbortMultipartUploadCommand({ ...this.#mamCloudLoc(key), UploadId: uploadId }));
  }

  async signedMamCloudGet({ key, seconds = 300 }) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    return getSignedUrl(await this.#sdk(), new GetObjectCommand(this.#mamCloudLoc(key)), { expiresIn: seconds });
  }

  async headMamCloud({ key }) {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    try {
      const out = await (await this.#sdk()).send(new HeadObjectCommand(this.#mamCloudLoc(key)));
      return { size: Number(out.ContentLength) || 0, etag: out.ETag || null, at: out.LastModified ? new Date(out.LastModified).getTime() : null };
    } catch (err) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async removeMamCloud({ key }) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await (await this.#sdk()).send(new DeleteObjectCommand(this.#mamCloudLoc(key)));
  }

  /** Lista apenas o prefixo privado de NEXA Nuvem para a limpeza conservadora de órfãos; nunca é rota pública. */
  async listMamCloudObjects({ prefix = 'mam-cloud/', max = 10_000 } = {}) {
    if (!MAM_CLOUD_PREFIX.test(String(prefix || ''))) throw new Error('prefixo inválido de NEXA Nuvem');
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const client = await this.#sdk(); const objects = []; let token;
    const cap = Math.max(1, Math.min(100_000, Number(max) || 10_000));
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: Math.min(1000, cap - objects.length) }));
      for (const item of page.Contents || []) {
        const key = String(item.Key || '');
        if (mamCloudKey(key)) objects.push({ key, size: Number(item.Size) || 0, at: item.LastModified ? new Date(item.LastModified).getTime() : null });
      }
      token = page.IsTruncated && objects.length < cap ? page.NextContinuationToken : undefined;
    } while (token);
    return { objects, truncated: Boolean(token) };
  }

  /*
   * Conferência do bucket (server/storage-inventory.js, docs/ARMAZENAMENTO.md "Conferir o bucket"). Listar (ListObjectsV2,
   * ListMultipartUploads, ListParts) é operação classe A, cobrada a cada 1.000 pedidos: só a tela da plataforma pede, com
   * cache, e nunca um timer. Apagar (DeleteObject, AbortMultipartUpload) não é cobrado no R2.
   */
  /** Buckets deste armazenamento: o principal e o da Loja (R2_STORE_BUCKET), se houver. */
  buckets() { return [...new Set([this.cfg.bucket, this.cfg.storeBucket].filter(Boolean))]; }

  /** Todos os objetos do bucket (sem prefixo, todas as páginas, até `max`): { objects: [{ key, size, at }], truncated }. */
  async inventory({ bucket = this.cfg.bucket, max = 1_000_000 } = {}) {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const client = await this.#sdk();
    const objects = [];
    let token;
    do {
      const r = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }));
      for (const o of r.Contents || []) objects.push({ key: String(o.Key || ''), size: Number(o.Size) || 0, at: o.LastModified ? new Date(o.LastModified).getTime() : null });
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token && objects.length < max);
    return { objects, truncated: Boolean(token) };
  }

  /** Envios em partes nunca concluídos nem abortados (ocupam espaço no R2): { uploads: [{ key, uploadId, at }], truncated }. */
  async multipartUploads({ bucket = this.cfg.bucket, max = 10_000 } = {}) {
    const { ListMultipartUploadsCommand } = await import('@aws-sdk/client-s3');
    const client = await this.#sdk();
    const uploads = [];
    let KeyMarker; let UploadIdMarker; let more = false;
    do {
      const r = await client.send(new ListMultipartUploadsCommand({ Bucket: bucket, KeyMarker, UploadIdMarker }));
      for (const u of r.Uploads || []) uploads.push({ key: String(u.Key || ''), uploadId: String(u.UploadId || ''), at: u.Initiated ? new Date(u.Initiated).getTime() : null });
      more = Boolean(r.IsTruncated) && Boolean(r.NextKeyMarker || r.NextUploadIdMarker);
      KeyMarker = r.NextKeyMarker; UploadIdMarker = r.NextUploadIdMarker;
    } while (more && uploads.length < max);
    return { uploads, truncated: more };
  }

  /** Bytes já recebidos por um envio em partes (ListParts, todas as páginas). */
  async multipartBytes({ bucket = this.cfg.bucket, key, uploadId }) {
    const { ListPartsCommand } = await import('@aws-sdk/client-s3');
    const client = await this.#sdk();
    let bytes = 0; let n = 0; let marker;
    do {
      const r = await client.send(new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }));
      for (const p of r.Parts || []) { bytes += Number(p.Size) || 0; n++; }
      marker = r.IsTruncated ? r.NextPartNumberMarker : undefined;
    } while (marker && n < 20000);
    return bytes;
  }

  async abortMultipartKey({ bucket = this.cfg.bucket, key, uploadId }) {
    const { AbortMultipartUploadCommand } = await import('@aws-sdk/client-s3');
    await (await this.#sdk()).send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
  }

  /** Tamanho e data do objeto EXATO (HeadObject; classe B), ou null se não existe. */
  async headKey({ bucket = this.cfg.bucket, key }) {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    try {
      const out = await (await this.#sdk()).send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { size: Number(out.ContentLength) || 0, at: out.LastModified ? new Date(out.LastModified).getTime() : null };
    } catch (err) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey') return null;
      throw err;
    }
  }

  /** Apaga o objeto EXATO (bucket e chave da listagem) e a cópia do cache local, se a chave for de um arquivo do app. */
  async removeKey({ bucket = this.cfg.bucket, key }) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await (await this.#sdk()).send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    const loc = kindOfKey(key);
    if (loc) await fs.promises.rm(localPath(loc.kind, loc.name), { force: true }).catch(() => {});
  }

  /** Mantém o cache de mídia abaixo do limite, descartando os menos usados. `inUse`: nomes que não podem sair. */
  async prune(inUse = new Set()) {
    inUse = new Set([...inUse].map((n) => storeCanonical(n) || n)); // mídia licenciada da Loja: o cache é o arquivo canônico
    const dir = config.mediaDir;
    // assíncrona (18/10: apagar um arquivo de GB num volume pode levar segundos, e o laço do servidor é o de todos os canais)
    const names = await fs.promises.readdir(dir).catch(() => []);
    const files = [];
    for (const f of names) {
      if (f.includes('.part-')) continue;
      const st = await fs.promises.stat(path.join(dir, f)).catch(() => null);
      if (st?.isFile()) files.push({ f, st });
    }
    let total = files.reduce((s, x) => s + x.st.size, 0);
    for (const x of files.sort((a, b) => a.st.atimeMs - b.st.atimeMs)) {
      if (total <= this.cfg.cacheMaxBytes) break;
      if (inUse.has(x.f)) continue;
      await fs.promises.rm(path.join(dir, x.f), { force: true }).then(() => { localMemo.delete(path.join(dir, x.f)); }, () => {});
      total -= x.st.size;
    }
  }
}

export const createStorage = (cfg = config.storage) => (cfg.driver === 'r2' ? new R2Storage(cfg) : new LocalStorage());
export const storage = createStorage();

export const isUrl = (p) => /^https?:\/\//i.test(String(p || ''));
/**
 * Vídeo que mora no armazenamento da nuvem e toca pela URL, sem cópia no disco: na edição Windows os dados copiados da
 * central trazem só o índice da biblioteca (server/edge/copy.js). Aceita a linha de media (source_url) ou o item do motor
 * (sourceUrl); entrada ao vivo não conta (lá source_url é o endereço do sinal).
 */
export const remoteUrlOf = (m) => {
  const u = m && m.kind !== 'live' ? m.source_url ?? m.sourceUrl : null;
  return isUrl(u) ? u : null;
};
/** Entrada do FFmpeg para um vídeo da biblioteca: a URL (vídeo da nuvem) ou o arquivo local (no R2, baixado para o cache). */
export const mediaInput = async (m) => remoteUrlOf(m) || storage.ensureLocal('media', m.filename ?? m.file);
/*
 * O arquivo já está no disco (o cache do R2)? Só olha, não baixa nada. O motor pergunta no meio do fluxo do ar (o próximo item
 * está no cache? o TAKE abre do disco?), numa função síncrona: a resposta vem da memória (LOCAL_MEMO_MS), mantida pelas conferências
 * assíncronas (isCached, a PRÉVIA e o cache aquecido conferem a cada poucos segundos), pelos downloads que terminam e pelas
 * remoções; a memória vencida responde o que sabe e confere de novo em segundo plano. Só a 1ª pergunta de um arquivo que ninguém
 * conferiu ainda olha o disco na hora (uma consulta de nome, sem gravação: nunca espera o freio de escrita do kernel).
 */
const LOCAL_MEMO_MS = 1500;
const localMemo = new Map(); // caminho → { ok, at }
const memo = (p, ok) => { localMemo.set(p, { ok, at: Date.now() }); if (localMemo.size > 5000) localMemo.delete(localMemo.keys().next().value); return ok; };
export const cachedLocal = (kind, name) => {
  let p;
  try { p = localPath(kind, name); } catch { return false; }
  const m = localMemo.get(p);
  if (m) {
    if (Date.now() - m.at > LOCAL_MEMO_MS) fs.promises.access(p).then(() => memo(p, true), () => memo(p, false));
    return m.ok;
  }
  try { return memo(p, fs.existsSync(p)); } catch { return false; }
};
/** O mesmo, sem I/O síncrono (a PRÉVIA e o TAKE automático conferem a cada poucos segundos: num volume lento, o existsSync segura o laço). */
export const isCached = async (kind, name) => {
  let p;
  try { p = localPath(kind, name); } catch { return false; }
  try { await fs.promises.access(p); return memo(p, true); } catch { return memo(p, false); }
};
/** O arquivo entrou ou saiu do cache (download terminado, remoção): a memória do cachedLocal na hora. */
export const markLocal = (kind, name, ok) => { try { memo(localPath(kind, name), ok); } catch { /* nome inválido */ } };

/** Copia um arquivo local em pedaços, com a descarga do SyncedWriter (sem sujar o arquivo inteiro de uma vez no cache de páginas). */
export function copyLocal(from, to) {
  return new Promise((resolve, reject) => {
    pipeline(fs.createReadStream(from), new SyncedWriter(to, { flags: 'w' }), (err) => (err ? reject(err) : resolve()));
  });
}

export const READ_URL_TTL = 24 * 3600; // s: só a conversão (#run): a de 20 GB leva horas e o FFmpeg refaz o pedido (Range) ao reconectar
export const READ_URL_TTL_SHORT = 3600; // s: probe, miniatura, legendas e loudness (leituras curtas)
/**
 * Entrada de LEITURA para o FFmpeg/ffprobe sem baixar nada: a cópia local, se já houver; no R2, uma URL assinada (o FFmpeg
 * lê por HTTP com Range, inclusive o índice no fim de um MP4); no disco local, o próprio caminho. A URL assinada nunca vai
 * a log nem ao navegador (redactUrl). `store`: outro armazenamento (testes).
 */
export async function readInput(kind, name, { seconds = READ_URL_TTL_SHORT, store = storage, minFree = config.record.minFreeBytes } = {}) {
  const local = localPath(kind, name);
  if (await fs.promises.access(local).then(() => true, () => false)) return local;
  const url = await store.signedUrl(kind, name, seconds);
  if (!url) return local;
  // FFmpeg sem TLS não lê a URL do R2: baixa o original, mas só se couber acima da reserva do ar (senão erro 507)
  if (/^https:/i.test(url) && !(await readsHttps())) return store.ensureLocal(kind, name, { room: { minFree } });
  return url;
}
/**
 * Texto de erro/log sem a assinatura: "https://host/bucket/media/x.mp4?…". Também os parâmetros X-Amz-* soltos (um trecho de
 * stderr cortado no meio da URL, sem o "https://").
 */
export const redactUrl = (s) => String(s ?? '')
  .replace(/(https?:\/\/[^\s?"']+)\?[^\s"']*/gi, '$1?…')
  .replace(/(X-Amz-[A-Za-z-]+)=[^&\s"']+/g, '$1=…');
export { R2Storage, LocalStorage, keyOf };
