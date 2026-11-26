#!/usr/bin/env node
/*
 * Servidor falso da API do aparelho, para testar o player de apps-tv/comum num navegador comum.
 * Só Node, sem dependências. Não é o servidor do DIGITAL ISP: só imita o contrato (/api/telas/*).
 *
 *   node apps-tv/teste/servidor-falso.js [--porta=8787]
 *   abra http://localhost:8787/?servidor=http://localhost:8787   (a tela)
 *   abra http://localhost:8787/teste/painel                       (o "painel": aprovar o código, trocar a grade, cortar a rede)
 *
 * O que imita:
 *   POST /api/telas/pair, GET /api/telas/pair/:id   código mostrado na TV (proposta; ver apps-tv/LEIAME.md)
 *   POST /api/telas/activate, /recover               o contrato atual (chave digitada)
 *   GET  /api/telas/config (ETag/304), POST /heartbeat, POST /commands/:id/done
 *   GET  /midia/*                                    arquivos com Range (206), para o download por pedaços
 * Controles de teste (/teste/*): aprovar, grade A/B com virada em N minutos, rede ligada/desligada, arquivo
 * corrompido (sha256 que não confere), lentidão, comando, alerta.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { itensTipos, fotoSvg } = require('./tipos.js');
const REPO = path.join(__dirname, '..', '..');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const PORTA = Number(args.porta || process.env.PORTA || 8787);
const COMUM = path.join(__dirname, '..', 'comum');
const PASTA_MIDIA = path.join(__dirname, '.midia');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const rnd = (n) => crypto.randomBytes(n).toString('base64url');
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codigo = () => { let s = ''; const b = crypto.randomBytes(8); for (const x of b) s += ALFABETO[x % 32]; return s.slice(0, 4) + '-' + s.slice(4); };

// ------------------------------------------------------------------ mídia de teste

function svg(cor, texto, sub) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
<rect width="1920" height="1080" fill="${cor}"/><circle cx="1600" cy="260" r="180" fill="rgba(255,255,255,.18)"/>
<text x="120" y="560" font-family="Arial" font-size="150" font-weight="700" fill="#fff">${texto}</text>
<text x="120" y="700" font-family="Arial" font-size="60" fill="#fff" opacity=".85">${sub}</text></svg>`);
}

function logoSvg() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300" viewBox="0 0 900 300">
<rect x="10" y="40" width="220" height="220" rx="40" fill="#0ea5e9"/><path d="M70 110h100M70 150h100M70 190h60" stroke="#fff" stroke-width="18" stroke-linecap="round"/>
<text x="260" y="175" font-family="Arial" font-size="96" font-weight="800" fill="#fff">Provedor X</text>
<text x="264" y="235" font-family="Arial" font-size="40" fill="#7dd3fc">internet e telas</text></svg>`);
}

const midia = {}; // nome → { buf, tipo }
function addMidia(nome, buf, tipo) { midia[nome] = { buf, tipo }; }

function prepararMidia() {
  addMidia('logo-revenda.svg', logoSvg(), 'image/svg+xml');
  addMidia('oferta-a.svg', svg('#7c3aed', 'Oferta da manhã', 'Grade A · conteúdo do cliente'), 'image/svg+xml');
  addMidia('oferta-b.svg', svg('#059669', 'Promoção da tarde', 'Grade B · trocou no horário'), 'image/svg+xml');
  addMidia('cardapio.svg', svg('#dc2626', 'Cardápio do dia', 'Prato feito R$ 24,90'), 'image/svg+xml');
  addMidia('sem-internet.svg', svg('#334155', 'Voltamos já', 'imagem sem internet da revenda'), 'image/svg+xml');
  addMidia('foto-ana.svg', fotoSvg('#93c5fd', 'Ana'), 'image/svg+xml');
  addMidia('foto-marcos.svg', fotoSvg('#fca5a5', 'Marcos'), 'image/svg+xml');
  // vídeo: gerado uma vez com o FFmpeg, se houver (sem áudio). Sem FFmpeg, a grade fica só com imagens.
  const ff = [process.env.FFMPEG, 'C:/Projetos/nexa-ferramentas/ffmpeg-5.1.2/ffmpeg.exe', 'ffmpeg'].filter(Boolean);
  const destino = path.join(PASTA_MIDIA, 'video-teste.mp4');
  if (!fs.existsSync(destino)) {
    fs.mkdirSync(PASTA_MIDIA, { recursive: true });
    for (const bin of ff) {
      try {
        execFileSync(bin, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=8',
          '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', destino], { stdio: 'ignore', timeout: 60000 });
        break;
      } catch (e) { /* próximo */ }
    }
  }
  if (fs.existsSync(destino)) addMidia('video-teste.mp4', fs.readFileSync(destino), 'video/mp4');
}

function arquivo(nome) {
  const m = midia[nome];
  if (!m) return null;
  return { url: `${BASE}/midia/${nome}`, sha256: sha(m.buf), bytes: m.buf.length, type: m.tipo };
}

// ------------------------------------------------------------------ estado

const BASE = `http://localhost:${PORTA}`;
const est = {
  pares: new Map(),   // pairId → { code, expiresAt, device, aprovado: null | { deviceId, token } }
  chaves: new Map(),  // chave → usada?
  telas: new Map(),   // token → { deviceId, name, hwid, ultimo, sinais }
  hwids: new Map(),   // hwid → deviceId
  comandos: [],       // { id, type, deviceId }
  alertas: [],
  rede: true,
  corromper: null,    // nome do arquivo servido com bytes trocados
  lentidao: 0,        // ms por pedaço de 64 KB
  grade: { viradaEm: (minutoAgora() + 360) % 1440 }, // A nas 6 h antes da virada (minuto do dia), B depois
  versao: 1,
  novidade: null,     // imagem nova publicada pelo /teste/nova-imagem (entra na grade B)
  semPar: false,
  tipos: null,        // 'lateral' (vídeo 75% + playlist 25%) | 'cheia' (playlist na tela toda): um item de cada tipo
  tema: { color: '#6d28d9', mode: 'dark' }, // signage.brand.color/mode (o tema dos slides)
  aoVivo: null,       // endereço mandado em stream.hls (/teste/aovivo?url=…; "video" = o mp4 de teste)      // true = como o servidor de produção sem /api/telas/pair (a TV cai na chave digitada)
  log: []
};
let proxId = 1;

function registrar(msg) { est.log.push(new Date().toISOString().slice(11, 19) + ' ' + msg); est.log = est.log.slice(-60); console.log(msg); }

function minutoAgora() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function tzLocal() { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'; }

/** A grade com um item de cada tipo (teste visual contra a prévia do painel). */
function blocoTipos() {
  const lateral = est.tipos === 'lateral';
  if (est.tipos === 'hdmi') {
    // "HDMI + lateral + barra": a entrada HDMI da TV à esquerda, a playlist à direita e a faixa embaixo
    const tipos = itensTipos(arquivo, Math.floor(Date.now() / 3600000) * 3600000);
    return { id: 'grade-tipos', layout: { orientation: 'land', background: '#0b1220', zones: [
      { id: 'tv', kind: 'hdmi', x: 0, y: 0, w: 70, h: 88 },
      { id: 'lado', kind: 'playlist', x: 70, y: 0, w: 30, h: 88 },
      { id: 'bar', kind: 'ticker', x: 0, y: 88, w: 100, h: 12 }] }, days: [], from: 0, to: 1440,
      zones: { lado: tipos.filter((t) => t.kind === 'slide').slice(0, 3) } };
  }
  if (est.tipos === 'senha') {
    // a chamada de senha: a zona de senha ao lado da playlist (consultório)
    const tipos = itensTipos(arquivo, Math.floor(Date.now() / 3600000) * 3600000);
    return { id: 'grade-tipos', layout: { orientation: 'land', background: '#0b1220', zones: [
      { id: 'queue', kind: 'queue', x: 0, y: 0, w: 40, h: 100 },
      { id: 'main', kind: 'playlist', x: 40, y: 0, w: 60, h: 100 }] }, days: [], from: 0, to: 1440,
      zones: { main: tipos.filter((t) => t.kind === 'slide').slice(0, 3) } };
  }
  if (est.tipos === 'clima') {
    // a zona de clima (o clima da tela, sem itens) ao lado do vídeo
    return { id: 'grade-tipos', layout: { orientation: 'land', background: '#0b1220', zones: [
      { id: 'main', x: 0, y: 0, w: 60, h: 88, kind: midia['video-teste.mp4'] ? 'video' : 'playlist' },
      { id: 'clima', x: 60, y: 0, w: 40, h: 88, kind: 'weather' },
      { id: 'bar', kind: 'ticker', x: 0, y: 88, w: 100, h: 12 }] }, days: [], from: 0, to: 1440, zones: {} };
  }
  if (est.tipos === 'provedor') {
    // o layout 4 da produção ("Provedor com onda e avaliações"), na ordem em que o servidor manda: o ticker primeiro e o
    // vídeo (com formato) por último; a zona "reviews" é um widget sem widget escolhido (sem itens)
    return { id: 'grade-tipos', layout: { orientation: 'land', background: '#0b1220', zones: [
      { id: 'bar', kind: 'ticker', x: 0, y: 88, w: 100, h: 12 },
      { id: 'qr', kind: 'qr', x: 65, y: 4, w: 33, h: 40, title: 'Assine pelo celular', qr: 'https://exemplo.com.br/', shape: 'cantos' },
      { id: 'reviews', kind: 'widget', x: 65, y: 47, w: 33, h: 38, shape: 'cantos' },
      { id: 'main', kind: 'video', x: 0, y: 0, w: 63, h: 88, shape: 'onda-dir', edge: { color: '#29d3e5', width: 1 } }] },
      days: [], from: 0, to: 1440, zones: {} };
  }
  if (est.tipos === 'formas') {
    // zonas com recorte (zone.shape) e filete (zone.edge): o vídeo à esquerda, a playlist em onda entrando nele, o relógio
    // num círculo e o clima numa pílula por cima
    const tipos = itensTipos(arquivo, Math.floor(Date.now() / 3600000) * 3600000);
    return { id: 'grade-tipos', layout: { orientation: 'land', background: '#0b1220', zones: [
      { id: 'main', x: 0, y: 0, w: 62, h: 88, kind: midia['video-teste.mp4'] ? 'video' : 'playlist' },
      { id: 'faixa', x: 0, y: 88, w: 100, h: 12, kind: 'ticker' },
      { id: 'lado', x: 52, y: 0, w: 48, h: 88, kind: 'playlist', shape: 'onda-esq', edge: { color: '#29d3e5', width: 0.8 } },
      { id: 'hora', x: 3, y: 4, w: 14, h: 25, kind: 'widget', overlay: true, opacity: 60, shape: 'circulo', edge: { color: '#f5b31c', width: 0.5 } },
      { id: 'clima', x: 66, y: 66, w: 30, h: 18, kind: 'widget', overlay: true, opacity: 80, shape: 'pilula', edge: { color: '#ffffff', width: 0.3 } }] },
      days: [], from: 0, to: 1440,
      zones: { main: [], lado: tipos.filter((t) => t.kind === 'slide').slice(10, 14), hora: tipos.filter((t) => t.id === 'wclka'), clima: tipos.filter((t) => t.id === 'wwx') } };
  }
  if (est.tipos === 'sobre') {
    // zonas por cima (overlay) sobre o vídeo/playlist: relógio e clima no canto, com o vidro translúcido
    const tipos = itensTipos(arquivo, Math.floor(Date.now() / 3600000) * 3600000);
    return { id: 'grade-tipos', layout: { orientation: 'land', background: '#0b1220', zones: [
      { id: 'main', x: 0, y: 0, w: 100, h: 88, kind: midia['video-teste.mp4'] ? 'video' : 'playlist' },
      { id: 'faixa', x: 0, y: 88, w: 100, h: 12, kind: 'ticker' },
      { id: 'hora', x: 2, y: 3, w: 20, h: 16, kind: 'widget', overlay: true, opacity: 60 },
      { id: 'clima', x: 76, y: 3, w: 22, h: 30, kind: 'widget', overlay: true, opacity: 40 }] }, days: [], from: 0, to: 1440,
      zones: { main: tipos.filter((t) => t.kind === 'image' || t.kind === 'slide').slice(0, 3), hora: tipos.filter((t) => t.id === 'wclk'), clima: tipos.filter((t) => t.id === 'wwx') } };
  }
  const zones = lateral
    ? [{ id: 'main', x: 0, y: 0, w: 75, h: 100, kind: midia['video-teste.mp4'] ? 'video' : 'playlist' }, { id: 'right', x: 75, y: 0, w: 25, h: 100, kind: 'playlist' }]
    : [{ id: 'right', x: 0, y: 0, w: 100, h: 100, kind: 'playlist' }];
  // a rádio de fundo (/teste/radio?ligar=1): só no layout sem vídeo; o "stream" é o áudio do vídeo de teste
  const audio = est.radio && !zones.some((z) => z.kind === 'video') && midia['video-teste.mp4']
    ? { kind: 'radio', id: '1', name: 'Rádio de teste', url: `${est.base || ''}/midia/video-teste.mp4`, codec: 'AAC', bitrate: 128, volume: 70 } : undefined;
  return { id: 'grade-tipos', layout: { orientation: 'land', background: '#0b1220', zones, ...(audio ? { audio } : {}) }, days: [], from: 0, to: 1440,
    // a hora dos dados presa na hora cheia: senão o rev mudaria a cada sinal de vida (o servidor real segura 15 min)
    zones: { right: itensTipos(arquivo, Math.floor(Date.now() / 3600000) * 3600000), main: [] } };
}

function montarConfig(tela) {
  const virada = est.grade.viradaEm;
  const inicioA = (virada - 360 + 1440) % 1440;
  const zonas = [
    { id: 'main', x: 0, y: 0, w: 70, h: 88, kind: midia['video-teste.mp4'] ? 'video' : 'playlist' },
    { id: 'lado', x: 70, y: 0, w: 30, h: 88, kind: 'playlist' },
    { id: 'faixa', x: 0, y: 88, w: 100, h: 12, kind: 'ticker' }
  ];
  const img = (n, s) => Object.assign({ id: 'm-' + n, kind: 'image', seconds: s || 6 }, arquivo(n));
  const blocoA = {
    id: 'grade-a', layout: { orientation: 'land', background: '#0b1220', zones: zonas },
    days: [], from: inicioA, to: virada,
    zones: {
      main: midia['video-teste.mp4'] ? [] : [img('oferta-a.svg')],
      lado: [img('oferta-a.svg'), { id: 'p-boasvindas', kind: 'slide', seconds: 6, template: 'comunicado', fields: { label: 'Aviso', title: 'Bem-vindo!', text: 'Horário de hoje: 8h às 18h' } }, img('cardapio.svg')]
    }
  };
  const blocoB = {
    id: 'grade-b', layout: { orientation: 'land', background: '#062016', zones: [
      { id: 'cheia', x: 0, y: 0, w: 100, h: 88, kind: 'playlist' },
      { id: 'faixa', x: 0, y: 88, w: 100, h: 12, kind: 'ticker' }] },
    days: [], from: virada, to: inicioA,
    zones: { cheia: [img('oferta-b.svg', 8)].concat(est.novidade ? [img(est.novidade, 8)] : [], [{ id: 'p-relogio', kind: 'clock', seconds: 5 }]) }
  };
  const cfg = {
    rev: '',
    device: { name: tela.name },
    brand: { name: 'Provedor X', logo: arquivo('logo-revenda.svg'), color: '#0ea5e9', background: '#020617' },
    stream: { hls: est.aoVivo, volume: 100, muted: true },
    // o clima da tela no formato do servidor (server/weather.js): /teste/clima?cond=clear|partly|cloudy|fog|rain|storm|nada
    weather: est.clima === 'nada' ? null : { provider: 'teste', source: 'INMET', hasNow: true, place: { ibge: '3304557', city: 'Rio de Janeiro', uf: 'RJ' },
      updatedAt: Math.floor(Date.now() / 3600000) * 3600000,
      now: { temp: 27, text: { clear: 'Céu limpo', partly: 'Parcialmente nublado', cloudy: 'Nublado', fog: 'Neblina', rain: 'Chuva', storm: 'Tempestade' }[est.clima || 'clear'], cond: est.clima || 'clear' },
      today: { min: 21, max: 31, text: 'Sol', cond: est.clima || 'clear' },
      icon: est.clima || 'clear',
      ...(est.climaFoto ? { art: arquivo('oferta-b.svg'), artPort: arquivo('foto-ana.svg') } : {}),
      days: [{ date: '2026-11-24', weekday: 'ter', min: 20, max: 30, text: 'Chuva', cond: 'rain' }, { date: '2026-11-25', weekday: 'qua', min: 19, max: 28, text: 'Nublado', cond: 'cloudy' }, { date: '2026-11-26', weekday: 'qui', min: 21, max: 32, text: 'Sol', cond: 'clear' }] },
    ticker: Object.assign({ items: ['Programação versão ' + est.versao, 'Ofertas válidas enquanto durar o estoque'], speed: 60 },
      // o estilo da faixa e o de cada aviso (public/shared/faixa.js), ligado por /teste/faixa?estilo=1
      est.faixaEstilo ? { style: { color: '#fde68a', bg: '#7f1d1d', bold: true, italic: false, size: 60, font: 'condensada', sep: 'estrela', label: 'URGENTE', labelColor: '#7f1d1d', labelBg: '#fde68a' },
        rich: [{ text: 'Programação versão ' + est.versao, color: '#ffffff', bold: true }, { text: 'Ofertas válidas enquanto durar o estoque', italic: true }] } : {}),
    offline: {
      items: midia['video-teste.mp4'] ? [arquivo('video-teste.mp4')] : [],
      image: arquivo('sem-internet.svg')
    },
    signage: { tz: tzLocal(), brand: { logo: arquivo('logo-revenda.svg'), color: est.tema.color, mode: est.tema.mode },
      // o conjunto de telas (/teste/conjunto?modo=wall|menu&cols=2&rows=1&pos=2&moldura=2): só quando ligado
      ...(est.conjunto ? { wall: est.conjunto } : {}),
      blocks: (est.tipos ? [blocoTipos()] : []).concat([blocoA, blocoB]), fallback: 'grade-a' },
    versao: est.versao
  };
  cfg.rev = sha(Buffer.from(JSON.stringify(cfg))).slice(0, 12);
  return cfg;
}

// ------------------------------------------------------------------ http

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-None-Match, Range, Accept');
  res.setHeader('Access-Control-Expose-Headers', 'Date, ETag, Content-Range, Content-Length');
}

function json(res, status, corpo, extra) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra || {}));
  res.end(corpo === undefined ? '' : JSON.stringify(corpo));
}

function lerCorpo(req) {
  return new Promise((ok) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { ok(null); } });
  });
}

function telaDo(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  return m ? est.telas.get(m[1]) : null;
}

function novaTela(device, nome) {
  const token = rnd(32);
  const t = { deviceId: proxId++, name: nome || 'Tela ' + (est.telas.size + 1), device, ultimo: null, sinais: 0 };
  est.telas.set(token, t);
  if (device && /^[0-9a-f]{64}$/.test(device.hwid || '')) est.hwids.set(device.hwid, t.deviceId);
  return { token, t };
}

const ESTATICOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

function arquivoDe(res, pasta, rel) {
  const alvo = path.normalize(path.join(pasta, decodeURIComponent(rel)));
  if (!alvo.startsWith(pasta) || !fs.existsSync(alvo) || fs.statSync(alvo).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': ESTATICOS[path.extname(alvo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(alvo).pipe(res);
}

function estatico(req, res, caminho) {
  const rel = caminho === '/' ? 'index.html' : decodeURIComponent(caminho.slice(1));
  const alvo = path.normalize(path.join(COMUM, rel));
  if (!alvo.startsWith(COMUM) || !fs.existsSync(alvo) || fs.statSync(alvo).isDirectory()) { res.writeHead(404); return res.end('não achei'); }
  res.writeHead(200, { 'Content-Type': ESTATICOS[path.extname(alvo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(alvo).pipe(res);
}

function servirMidia(req, res, nome) {
  const m = midia[nome];
  if (!m) { res.writeHead(404); return res.end(); }
  let buf = m.buf;
  if (est.corromper === nome) { buf = Buffer.from(buf); buf[buf.length >> 1] ^= 0xff; } // mesmo tamanho, hash outro
  let ini = 0, fim = buf.length - 1, status = 200;
  const r = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  if (r) { ini = +r[1]; fim = r[2] ? Math.min(+r[2], buf.length - 1) : buf.length - 1; status = 206; }
  if (ini > fim) { res.writeHead(416, { 'Content-Range': `bytes */${buf.length}` }); return res.end(); }
  const cab = { 'Content-Type': m.tipo, 'Content-Length': fim - ini + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600' };
  if (status === 206) cab['Content-Range'] = `bytes ${ini}-${fim}/${buf.length}`;
  res.writeHead(status, cab);
  const parte = buf.subarray(ini, fim + 1);
  if (!est.lentidao) return res.end(parte);
  let o = 0;
  (function passo() {
    if (!est.rede) return res.destroy();
    if (o >= parte.length) return res.end();
    res.write(parte.subarray(o, o + 65536)); o += 65536;
    setTimeout(passo, est.lentidao);
  })();
}

async function api(req, res, url) {
  const p = url.pathname;
  if (p === '/api/telas/pair' && req.method === 'POST') {
    if (est.semPar) return json(res, 404, { error: 'Rota inexistente' });
    const b = await lerCorpo(req);
    const pairId = rnd(24);
    const par = { code: codigo(), expiresAt: Date.now() + 10 * 60000, device: b && b.device, aprovado: null };
    est.pares.set(pairId, par);
    registrar(`código ${par.code} pedido por ${(b && b.device && b.device.model) || '?'}`);
    return json(res, 200, { pairId, code: par.code, expiresAt: par.expiresAt, pollSec: 2 });
  }
  let m = /^\/api\/telas\/pair\/([\w-]+)$/.exec(p);
  if (m && req.method === 'GET') {
    const par = est.pares.get(m[1]);
    if (!par || par.expiresAt < Date.now()) return json(res, 404, { error: 'Código vencido' });
    if (!par.aprovado) return json(res, 202, { status: 'waiting' });
    est.pares.delete(m[1]); // uso único: a resposta com o token sai uma vez
    return json(res, 200, par.aprovado);
  }
  if (p === '/api/telas/activate' && req.method === 'POST') {
    const b = await lerCorpo(req);
    const k = String((b && b.key) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const chave = k.slice(0, 4) + '-' + k.slice(4);
    if (!est.chaves.has(chave) || est.chaves.get(chave)) return json(res, 404, { error: 'Chave inexistente, usada ou vencida' });
    est.chaves.set(chave, true);
    const { token, t } = novaTela(b.device);
    registrar(`tela ${t.deviceId} ativada pela chave ${chave}`);
    return json(res, 200, { deviceId: t.deviceId, token, channel: null, name: t.name });
  }
  if (p === '/api/telas/recover' && req.method === 'POST') {
    const b = await lerCorpo(req);
    const id = b && est.hwids.get(b.hwid);
    if (!id) return json(res, 404, { error: 'Sem tela' });
    for (const [tok, t] of est.telas) if (t.deviceId === id) {
      est.telas.delete(tok);
      const novo = rnd(32);
      est.telas.set(novo, t);
      return json(res, 200, { deviceId: t.deviceId, token: novo, channel: null, name: t.name });
    }
    return json(res, 404, { error: 'Sem tela' });
  }
  const tela = telaDo(req);
  if (p.startsWith('/api/telas/') && !tela) return json(res, 401, { error: 'Token inválido' });
  if (p === '/api/telas/config' && req.method === 'GET') {
    const cfg = montarConfig(tela);
    const inm = (req.headers['if-none-match'] || '').replace(/"/g, '');
    if (inm && inm === cfg.rev) { res.writeHead(304, { ETag: `"${cfg.rev}"` }); return res.end(); }
    return json(res, 200, cfg, { ETag: `"${cfg.rev}"` });
  }
  // a chamada de senha (§10): /teste/chamar?senha=A002&guiche=Consult%C3%B3rio%203 chama; GET /api/telas/queue devolve o estado
  if (p === '/api/telas/queue') return json(res, 200, est.fila || { current: null, last: [] });
  if (p === '/api/telas/heartbeat' && req.method === 'POST') {
    const b = (await lerCorpo(req)) || {};
    tela.ultimo = Object.assign({ em: Date.now() }, b);
    tela.sinais++;
    const cmds = est.comandos.filter((c) => c.deviceId === tela.deviceId);
    est.comandos = est.comandos.filter((c) => c.deviceId !== tela.deviceId);
    return json(res, 200, { rev: montarConfig(tela).rev, commands: cmds.map((c) => ({ id: c.id, type: c.type })), alerts: est.alertas, ...(est.codigos ? { codes: est.codigos } : {}) });
  }
  m = /^\/api\/telas\/commands\/(\d+)\/done$/.exec(p);
  if (m && req.method === 'POST') {
    const b = await lerCorpo(req);
    registrar(`comando ${m[1]}: ${b && b.ok ? 'ok' : 'não'} (${b && b.detail})`);
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'Rota inexistente' });
}

function painel(res) {
  const telas = [...est.telas.values()].map((t) => {
    const u = t.ultimo || {};
    return `<tr><td>${t.deviceId}</td><td>${t.name}</td><td>${u.em ? Math.round((Date.now() - u.em) / 1000) + ' s' : '—'}</td><td>${u.state || ''}</td><td>${u.rev || ''}</td><td>${u.pending ? JSON.stringify(u.pending) : ''}</td><td>${u.platform || ''}</td><td>${u.plays ? u.plays.length + ' itens' : ''}</td></tr>`;
  }).join('');
  const pares = [...est.pares.entries()].filter(([, v]) => !v.aprovado && v.expiresAt > Date.now())
    .map(([, v]) => `<li><b>${v.code}</b> <a href="/teste/aprovar?code=${v.code}">aprovar</a></li>`).join('') || '<li>nenhum</li>';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Painel falso</title>
<style>body{font:15px system-ui;margin:20px;background:#f8fafc}td,th{border:1px solid #cbd5e1;padding:4px 8px}a{margin-right:10px}</style>
<h2>Painel falso (teste do app de TV)</h2>
<p>Rede: <b>${est.rede ? 'ligada' : 'DESLIGADA'}</b> · <a href="/teste/rede?on=${est.rede ? 0 : 1}">${est.rede ? 'cortar a rede' : 'religar a rede'}</a>
 Versão da programação: <b>${est.versao}</b> · <a href="/teste/nova-versao">publicar versão nova</a> <a href="/teste/nova-imagem">publicar imagem nova</a> <a href="/teste/nova-imagem?corrompida=1">publicar imagem nova corrompida</a>
 Grade: vira de A para B às ${Math.floor(est.grade.viradaEm / 60)}:${String(est.grade.viradaEm % 60).padStart(2, '0')} · <a href="/teste/grade?em=1">virar daqui a 1 min</a> <a href="/teste/grade?em=2">2 min</a></p>
<p>Corromper: ${est.corromper || 'nada'} · <a href="/teste/corromper">parar de corromper</a>
 · Lentidão: ${est.lentidao} ms · <a href="/teste/lento?ms=150">lento</a> <a href="/teste/lento?ms=0">normal</a>
 · <a href="/teste/alerta">alerta</a> <a href="/teste/alerta?fim=1">tirar alerta</a> · <a href="/teste/chave">gerar chave</a></p>
<h3>Códigos esperando</h3><ul>${pares}</ul>
<h3>Telas</h3><table><tr><th>id</th><th>nome</th><th>último sinal</th><th>estado</th><th>rev</th><th>chegando</th><th>plataforma</th><th>exibição</th></tr>${telas}</table>
<h3>Chaves</h3><p>${[...est.chaves.entries()].map(([k, u]) => k + (u ? ' (usada)' : '')).join(', ') || '—'}</p>
<h3>Registro</h3><pre>${est.log.slice().reverse().join('\n')}</pre>`);
}

function controle(req, res, url) {
  const q = url.searchParams;
  const p = url.pathname;
  const volta = (dados) => {
    if ((req.headers.accept || '').includes('text/html')) { res.writeHead(302, { Location: '/teste/painel' }); return res.end(); }
    return json(res, 200, dados || { ok: true });
  };
  if (p === '/teste/painel') return painel(res);
  if (p === '/teste/estado') return json(res, 200, { telas: [...est.telas.values()], pares: [...est.pares.values()], rede: est.rede, versao: est.versao });
  if (p === '/teste/aprovar') {
    for (const par of est.pares.values()) if (par.code === q.get('code') && !par.aprovado) {
      const { token, t } = novaTela(par.device);
      par.aprovado = { deviceId: t.deviceId, token, channel: null, name: t.name, brand: { name: 'Provedor X', logo: arquivo('logo-revenda.svg') } };
      registrar(`código ${par.code} aprovado → tela ${t.deviceId}`);
      return volta({ ok: true, deviceId: t.deviceId });
    }
    return json(res, 404, { error: 'código não encontrado' });
  }
  if (p === '/teste/aovivo') {
    const u = q.get('url');
    est.aoVivo = !u ? null : (u === 'video' ? `${BASE}/midia/video-teste.mp4` : u);
    registrar('ao vivo: ' + (est.aoVivo || 'nenhum'));
    return volta();
  }
  if (p === '/teste/tipos') { est.tipos = ['lateral', 'cheia', 'sobre', 'formas', 'provedor', 'clima', 'hdmi', 'senha'].includes(q.get('modo')) ? q.get('modo') : null; est.versao++; registrar('todos os tipos: ' + (est.tipos || 'desligado')); return volta(); }
  if (p === '/teste/tema') { est.tema = { color: q.get('cor') || '#6d28d9', mode: q.get('modo') === 'light' ? 'light' : 'dark' }; est.versao++; return volta(); }
  if (p === '/teste/itens.json') return json(res, 200, { itens: itensTipos(arquivo, Date.now()), tema: est.tema, tz: tzLocal() });
  if (p === '/teste/previa-painel' || p === '/teste/previa-tv' || p === '/teste/comparar') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(paginaComparar(p, q));
  }
  if (p === '/teste/sem-par') { est.semPar = q.get('on') !== '0'; registrar('pareamento ' + (est.semPar ? 'desligado (chave digitada)' : 'ligado')); return volta(); }
  if (p === '/teste/chave') { const k = codigo(); est.chaves.set(k, false); registrar('chave ' + k); return volta({ key: k }); }
  // o código de emergência da tela interna (§17): /teste/codigo?on=1 dispara o Código Azul; on=0 encerra
  if (p === '/teste/codigo') { est.codigos = q.get('on') === '0' ? [] : [{ id: Date.now(), code: 'azul', label: 'Código Azul', meaning: 'Parada cardiorrespiratória', color: '#1565c0', textColor: '#ffffff', place: 'Observação, leito 4', firedAt: Date.now(), until: Date.now() + 30 * 60000 }]; registrar('código ' + (est.codigos.length ? 'disparado' : 'encerrado')); return volta(); }
  if (p === '/teste/chamar') { const ant = est.fila && est.fila.current; est.fila = { current: { id: Date.now(), ticket: q.get('senha') || 'A001', desk: q.get('guiche') || 'Guichê 1', at: Date.now() }, last: ant ? [ant, ...((est.fila && est.fila.last) || [])].slice(0, 12) : [] }; registrar('senha ' + est.fila.current.ticket); return volta(); }
  if (p === '/teste/rede') { est.rede = q.get('on') !== '0'; registrar('rede ' + (est.rede ? 'ligada' : 'desligada')); return volta(); }
  if (p === '/teste/nova-imagem') {
    est.versao++;
    est.novidade = `novidade-${est.versao}.svg`;
    addMidia(est.novidade, svg('#0369a1', 'Novidade ' + est.versao, 'chegou inteira e conferida'), 'image/svg+xml');
    est.corromper = q.get('corrompida') ? est.novidade : null;
    registrar(`imagem nova ${est.novidade}${est.corromper ? ' (servida corrompida)' : ''}`);
    return volta();
  }
  if (p === '/teste/nova-versao') { est.versao++; registrar('versão ' + est.versao); return volta(); }
  if (p === '/teste/grade') { est.grade.viradaEm = (minutoAgora() + Number(q.get('em') || 1)) % 1440; est.versao++; registrar('grade vira às minuto ' + est.grade.viradaEm); return volta(); }
  if (p === '/teste/corromper') { est.corromper = q.get('nome') || null; return volta(); }
  if (p === '/teste/lento') { est.lentidao = Number(q.get('ms') || 0); return volta(); }
  if (p === '/teste/comando') { for (const t of est.telas.values()) est.comandos.push({ id: proxId++, type: q.get('tipo') || 'reload', deviceId: t.deviceId }); return volta(); }
  if (p === '/teste/conjunto') {
    const cols = Number(q.get('cols') || 2), rows = Number(q.get('rows') || 1), pos = Number(q.get('pos') || 1), mb = Number(q.get('moldura') || 0);
    est.conjunto = q.get('modo') ? { id: 7, name: 'Parede da vitrine', mode: q.get('modo') === 'wall' ? 'wall' : 'menu', cols, rows, pos,
      col: (pos - 1) % cols, row: Math.floor((pos - 1) / cols), orientation: 'land', bezel: { x: mb, y: mb }, sync: q.get('sync') !== '0',
      epoch: Date.UTC(2026, 0, 1) } : null;
    est.versao++; registrar('conjunto: ' + (est.conjunto ? `${est.conjunto.mode} ${cols}×${rows} pos ${pos}` : 'desligado'));
    return volta();
  }
  if (p === '/teste/radio') { est.radio = q.get('ligar') === '1'; est.base = `http://${req.headers.host}`; est.versao++; return volta(); }
  if (p === '/teste/clima') { est.clima = q.get('cond') || 'clear'; est.climaFoto = q.get('foto') === '1'; est.versao++; return volta(); }
  if (p === '/teste/faixa') { est.faixaEstilo = q.get('estilo') === '1'; est.versao++; return volta(); }
  if (p === '/teste/alerta') {
    // como o servidor real manda (contrato §9): level 'info' | 'warn' | 'critical', header opcional
    const nivel = ['info', 'warn', 'critical'].includes(q.get('nivel')) ? q.get('nivel') : 'critical';
    est.alertas = q.get('fim') ? [] : [Object.assign({ id: proxId++, level: nivel, sound: true, title: nivel === 'critical' ? 'EVACUAÇÃO IMEDIATA' : 'Alerta de teste',
      text: 'Mensagem em tela cheia enviada pelo painel.\nSiga as orientações da brigada.', until: Date.now() + 5 * 60000 }, q.get('cabeca') ? { header: q.get('cabeca') } : {})];
    return volta();
  }
  res.writeHead(404); res.end();
}

/*
 * Teste visual lado a lado: à esquerda o desenho do PAINEL (o módulo original public/shared/tvcorp-previa.js, com o CSS
 * original e container queries), à direita o da TV (o tela.js do app com a prévia gerada para o Chromium 53). Os dois
 * recebem o mesmo item, com as mesmas imagens; a única preparação é a que o app faz (imagens locais, dias sem acidente
 * pela data).
 */
const PREPARAR = `function preparar(o, porSha) {
  o = JSON.parse(JSON.stringify(o));
  var sha = function (v) { return v && typeof v === 'object' && v.sha256 ? v.sha256 : null; };
  if (o.kind === 'slide' && o.fields) Object.keys(o.fields).forEach(function (k) { var h = sha(o.fields[k]); if (h) { if (!o.image) o.image = porSha[h]; delete o.fields[k]; } });
  if (o.kind === 'post') { var hp = sha(o.image) || sha(o.media); o.image = hp ? porSha[hp] : null; }
  if (o.kind === 'birthdays') o.people = o.people.map(function (p) { var q = JSON.parse(JSON.stringify(p)); var h = sha(p.photo); if (h) q.photo = porSha[h]; else delete q.photo; return q; });
  if (o.kind === 'safety' && o.since) delete o.days;
  return o;
}`;

function paginaComparar(p, q) {
  const i = Number(q.get('i') || 0);
  if (p === '/teste/previa-painel') {
    return `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/painel/shared/tvcorp-previa.css">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#c{width:100vw;height:100vh;container-type:size}#c>*{width:100%;height:100%}</style>
<div id="c" class="tvc-z"></div>
<script type="module">
import { itemPreview } from '/painel/shared/tvcorp-previa.js';
${PREPARAR}
const r = await fetch('/teste/itens.json').then((x) => x.json());
const it = r.itens[${i}];
const porSha = {};
for (const o of r.itens) for (const v of [o, o.image, o.media, ...(o.fields ? Object.values(o.fields) : []), ...((o.people || []).map((x) => x.photo))]) if (v && v.sha256) porSha[v.sha256] = v.url;
document.getElementById('c').append(itemPreview(preparar(it, porSha), { theme: r.tema }));
</script>`;
  }
  if (p === '/teste/previa-tv') {
    return `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/estilo.css"><link rel="stylesheet" href="/previa.css"><link rel="stylesheet" href="/previa-tv.css">
<style>body{cursor:auto}</style>
<div id="conteudo"></div>
<script src="/js/sha256.js"></script><script src="/js/nucleo.js"></script><script src="/js/previa.js"></script><script src="/js/tela.js"></script>
<script>
fetch('/teste/itens.json').then(function (x) { return x.json(); }).then(function (r) {
  var it = JSON.parse(JSON.stringify(r.itens[${i}])); it.seconds = 300;
  var cfg = { rev: 'x', brand: { name: 'Provedor X' }, signage: { tz: r.tz, brand: { color: r.tema.color, mode: r.tema.mode },
    blocks: [{ id: 'b', layout: { zones: [{ id: 'z', x: 0, y: 0, w: 100, h: 100, kind: 'playlist' }] }, zones: { z: [it] } }] } };
  var prog = TelasNucleo.lerConfig(cfg, { teste: true });
  var urls = {};
  TelasNucleo.arquivosDoPacote(prog).forEach(function (f) { urls[f.sha256] = f.url; });
  var tela = TelasTela.criar(document.getElementById('conteudo'), {
    url: function (s) { return Promise.resolve(urls[s] || null); }, agora: function () { return Date.now(); },
    online: function () { return true; }, mudo: true, volume: 0, aoExibir: function () {}, aoErro: function (m) { document.title = 'ERRO ' + m; }
  });
  if (!prog.blocos.length) { document.body.textContent = 'item recusado pelo app'; return; }
  tela.mostrar(prog, prog.blocos[0]);
});
</script>`;
  }
  const w = Number(q.get('w') || 480), h = Number(q.get('h') || 270);
  const n = itensTipos(arquivo, Date.now());
  const linhas = n.map((it, k) => `<tr><td>${k}<br><b>${it.kind}</b><br>${it.template || it.category || ''}</td>
<td><iframe src="/teste/previa-painel?i=${k}" width="${w}" height="${h}"></iframe></td><td><iframe src="/teste/previa-tv?i=${k}" width="${w}" height="${h}"></iframe></td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Painel × TV</title>
<style>body{font:14px system-ui;margin:12px;background:#f1f5f9}td{vertical-align:top;padding:4px 8px}iframe{border:1px solid #94a3b8;background:#000}th{text-align:left}</style>
<p>Esquerda: prévia do painel (código original). Direita: app de TV (mesmo código, gerado para o Chromium 53). Zona ${w}×${h}.
<a href="?w=480&h=270">larga</a> · <a href="?w=320&h=640">lateral</a> · <a href="?w=960&h=540">grande</a></p>
<table><tr><th>item</th><th>painel</th><th>TV</th></tr>${linhas}</table>`;
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, BASE);
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (url.pathname.startsWith('/teste/')) return controle(req, res, url);
  // "rede cortada": a API e os arquivos somem (o app da TV fica, como no aparelho, onde ele é local)
  if (!est.rede && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/midia/'))) return req.socket.destroy();
  if (url.pathname.startsWith('/api/')) return api(req, res, url).catch((e) => json(res, 500, { error: e.message }));
  if (url.pathname.startsWith('/midia/')) return servirMidia(req, res, decodeURIComponent(url.pathname.slice(7)));
  // o código original do painel, para o teste lado a lado
  if (url.pathname.startsWith('/painel/shared/')) return arquivoDe(res, path.join(REPO, 'public', 'shared'), url.pathname.slice(15));
  if (url.pathname.startsWith('/tvcorp/arte/')) return arquivoDe(res, path.join(REPO, 'public', 'tvcorp', 'arte'), url.pathname.slice(13));
  // a tela aberta sem ?servidor= procuraria o servidor de produção: aponta para este
  if (url.pathname === '/' && !url.searchParams.get('servidor')) { res.writeHead(302, { Location: '/?servidor=' + encodeURIComponent(BASE) }); return res.end(); }
  return estatico(req, res, url.pathname);
});

prepararMidia();
// o desenho da prévia do painel para a TV (comum/js/previa.js e previa.css): gera se faltar ou se a fonte mudou
try { require('../scripts/previa.js').gerar({ seNecessario: true }); } catch (e) { console.warn('prévia não gerada: ' + e.message); }
if (require.main === module) {
  servidor.listen(PORTA, () => console.log(`servidor falso em ${BASE}  (tela: ${BASE}/?servidor=${BASE}  painel: ${BASE}/teste/painel)`));
}
module.exports = { servidor, est, PORTA, BASE, montarConfig };
