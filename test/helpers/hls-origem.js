// Origem HLS de teste parecida com a do relato de 14/10 (Wowza, docs/MESA.md "Fonte HLS"): segmentos de 10 s, 3 na lista ao
// vivo, H.264 High com AAC 44,1 kHz, áudio e vídeo defasados e uma trilha de dados ID3 (timed_id3) ANTES do vídeo e do
// áudio (índice 0). A origem responde devagar (cada pedido espera ttfbMs) e um pedido da lista pode travar (hangMs).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const TS = 188;
const ID3_PID = 0x102;

/** CRC-32 do MPEG-2 (tabelas PSI): polinômio 0x04C11DB7, sem reflexão, começa em 0xFFFFFFFF. */
export function crc32mpeg(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    crc = (crc ^ (b << 24)) >>> 0;
    for (let k = 0; k < 8; k++) crc = (crc & 0x80000000 ? ((crc << 1) ^ 0x04c11db7) : crc << 1) >>> 0;
  }
  return crc >>> 0;
}

const stamp = (prefix, t) => {
  const v = Math.round(t) % 2 ** 33;
  return [(prefix << 4) | (Math.floor(v / 2 ** 30) << 1) | 1, Math.floor(v / 2 ** 22) & 0xff, ((Math.floor(v / 2 ** 15) & 0x7f) << 1) | 1, Math.floor(v / 2 ** 7) & 0xff, ((v & 0x7f) << 1) | 1];
};
const syncsafe = (n) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];

/** Um pacote TS com um PES de ID3 (TXXX "nexa" = texto) no carimbo t (ticks de 90 kHz). */
function id3Packet(t, cc, text) {
  const value = Buffer.from(`\u0003nexa\u0000${text}`, 'latin1');
  const frame = Buffer.concat([Buffer.from('TXXX'), Buffer.from(syncsafe(value.length)), Buffer.from([0, 0]), value]);
  const tag = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, ...syncsafe(frame.length)]), frame]);
  const pes = Buffer.concat([Buffer.from([0, 0, 1, 0xbd, 0, 0, 0x84, 0x80, 5, ...stamp(2, t)]), tag]);
  pes.writeUInt16BE(pes.length - 6, 4);
  const p = Buffer.alloc(TS, 0xff);
  p[0] = 0x47; p[1] = 0x40 | (ID3_PID >> 8); p[2] = ID3_PID & 0xff; p[3] = 0x30 | (cc & 0xf);
  const af = TS - 4 - 1 - pes.length; // campo de adaptação só com enchimento: o PES termina no fim do pacote
  p[4] = af; if (af > 0) p[5] = 0x00;
  pes.copy(p, 5 + af);
  return p;
}

/** A PMT com a trilha ID3 (stream_type 0x15 com o descritor de metadados "ID3 ") como a PRIMEIRA do programa. */
function pmtWithId3(p) {
  const out = Buffer.from(p);
  const sec = 5 + out[4];
  const len = ((out[sec + 1] & 0x0f) << 8) | out[sec + 2];
  const infoLen = ((out[sec + 10] & 0x0f) << 8) | out[sec + 11];
  const esAt = sec + 12 + infoLen;
  const end = sec + 3 + len - 4; // antes do CRC
  const desc = [0x26, 13, 0xff, 0xff, 0x49, 0x44, 0x33, 0x20, 0xff, 0x49, 0x44, 0x33, 0x20, 0x00, 0x0f];
  const entry = Buffer.from([0x15, 0xe0 | (ID3_PID >> 8), ID3_PID & 0xff, 0xf0 | (desc.length >> 8), desc.length & 0xff, ...desc]);
  const body = Buffer.concat([out.subarray(sec, esAt), entry, out.subarray(esAt, end)]);
  const newLen = body.length - 3 + 4;
  body[1] = (body[1] & 0xf0) | ((newLen >> 8) & 0x0f); body[2] = newLen & 0xff;
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32mpeg(body));
  const sect = Buffer.concat([body, crc]);
  if (sec + sect.length > TS) throw new Error('PMT não cabe num pacote');
  out.fill(0xff, sec); sect.copy(out, sec);
  return out;
}

/** Põe a trilha ID3 nos segmentos (na ordem): a PMT ganha a trilha e um PES de ID3 entra antes de cada 25º quadro. */
export function addId3(files) {
  const cc = { n: 0 };
  let frames = 0;
  for (const f of files) {
    const ts = fs.readFileSync(f);
    let pmtPid = null;
    const out = [];
    for (let o = 0; o + TS <= ts.length; o += TS) {
      const p = ts.subarray(o, o + TS);
      const pid = ((p[1] & 0x1f) << 8) | p[2];
      const pusi = p[1] & 0x40;
      if (pid === 0 && pusi) { const sec = 5 + p[4]; for (let k = sec + 8; k + 4 <= sec + 3 + (((p[sec + 1] & 0x0f) << 8) | p[sec + 2]) - 4; k += 4) { if (((p[k] << 8) | p[k + 1]) !== 0) { pmtPid = ((p[k + 2] & 0x1f) << 8) | p[k + 3]; break; } } }
      if (pmtPid != null && pid === pmtPid && pusi) { out.push(pmtWithId3(p)); continue; }
      if (pid === 0x100 && pusi) {
        const af = (p[3] >> 4) & 3; const i = af & 2 ? 5 + p[4] : 4;
        if (p[i] === 0 && p[i + 1] === 0 && p[i + 2] === 1 && p[i + 3] >= 0xe0 && p[i + 3] <= 0xef) {
          if (frames % 25 === 0) {
            const b = p[i + 9]; const pts = ((b >> 1) & 7) * 2 ** 30 + ((p[i + 10] << 7) | (p[i + 11] >> 1)) * 2 ** 15 + ((p[i + 12] << 7) | (p[i + 13] >> 1));
            out.push(id3Packet(pts, cc.n++, `quadro ${frames}`));
          }
          frames += 1;
        }
      }
      out.push(p);
    }
    fs.writeFileSync(f, Buffer.concat(out));
  }
}

/**
 * Gera o HLS da origem em `dir`: `secs` s de vídeo 640x360 a 25 q/s (H.264 High, quadro-chave a cada 2 s) e tom AAC 44,1 kHz,
 * com o vídeo `avOffset` s atrás do áudio (o áudio começa antes), em segmentos de `seg` s, com a trilha ID3 na frente.
 * Devolve [{ file, name, dur }].
 */
export function hlsSource(ff, dir, { secs = 100, seg = 10, avOffset = 0.35, id3 = true } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync(ff, ['-y', '-v', 'error', '-itsoffset', String(avOffset), '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25', '-f', 'lavfi', '-i', 'sine=f=440:sample_rate=44100',
    '-t', String(secs), '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'superfast', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', '50', '-keyint_min', '50', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '2', '-f', 'hls', '-hls_time', String(seg), '-hls_list_size', '0', '-hls_segment_filename', path.join(dir, 'seg%03d.ts'), path.join(dir, 'origem.m3u8')],
  { timeout: 120000, killSignal: 'SIGKILL', windowsHide: true });
  const list = fs.readFileSync(path.join(dir, 'origem.m3u8'), 'utf8').split(/\r?\n/);
  const segs = [];
  for (let i = 0; i < list.length; i++) {
    const m = /^#EXTINF:([\d.]+)/.exec(list[i]);
    if (m) segs.push({ name: list[i + 1].trim(), file: path.join(dir, list[i + 1].trim()), dur: Number(m[1]) });
  }
  if (id3) addId3(segs.map((s) => s.file));
  return segs;
}

/**
 * Origem "ao vivo": no instante e (s desde a subida), a lista tem os 3 segmentos até o mais novo publicado (2 + e/seg, como
 * uma lista que já estava no ar). Cada resposta espera ttfbMs (origem longe e lenta); o pedido de lista número hangAt (1 = o
 * primeiro) espera hangMs (a recarga que travou no 5.1.2). Devolve { url, close, requests }.
 */
/*
 * variants: com N > 0, também uma lista mestra (master.m3u8) com N variantes (v0/…, vN-1/; alturas em heights), todas com
 * os mesmos segmentos; cada pedido guarda o caminho (path) e a resposta traz master.
 * stall(ms): a origem para de responder por ms (a partir de agora): todo pedido que chega ou ainda espera nesse intervalo só
 * é respondido no fim dele (rede ou origem travada; o relógio da origem segue e os segmentos novos continuam saindo).
 */
export async function hlsOrigin(segs, { seg = 10, ttfbMs = 0, hangAt = 0, hangMs = 0, variants = 0, heights = [] } = {}) {
  const t0 = Date.now();
  const requests = [];
  let lists = 0;
  let stallUntil = 0;
  const newest = () => Math.min(segs.length - 1, 2 + Math.floor((Date.now() - t0) / 1000 / seg));
  const srv = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const name = pathname.split('/').pop();
    let wait = ttfbMs;
    if (name === 'index.m3u8') { lists += 1; if (lists === hangAt) wait = hangMs; }
    // cada pedido: quando chegou (s desde a subida), quanto esperou e como terminou (status ou 'desistiu': o cliente fechou antes)
    const r = { name, path: pathname, at: Math.round((Date.now() - t0) / 100) / 10, waitMs: Math.max(wait, stallUntil - Date.now()), status: null, sock: req.socket.remotePort };
    requests.push(r);
    res.on('finish', () => { r.status = res.statusCode; });
    let timer = null;
    const answer = () => {
      const left = stallUntil - Date.now();
      if (left > 0) { timer = setTimeout(answer, left); return; } // a origem travou no meio da espera: só no fim da trava
      respond();
    };
    const respond = () => {
      if (name === 'master.m3u8' && variants) {
        const body = ['#EXTM3U', ...Array.from({ length: variants }, (_, i) => [`#EXT-X-STREAM-INF:BANDWIDTH=${(i + 1) * 1_000_000}${heights[i] ? `,RESOLUTION=${Math.round((heights[i] * 16) / 9)}x${heights[i]}` : ''}`, `v${i}/index.m3u8`]).flat(), ''].join('\n');
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'content-length': Buffer.byteLength(body) });
        res.end(body);
        return;
      }
      if (name === 'index.m3u8') {
        const n = newest(); const first = Math.max(0, n - 2);
        const body = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${seg + 1}`, `#EXT-X-MEDIA-SEQUENCE:${first}`, '#EXT-X-DISCONTINUITY-SEQUENCE:0',
          ...segs.slice(first, n + 1).flatMap((s) => [`#EXTINF:${s.dur.toFixed(1)},`, s.name]), ''].join('\n');
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-cache', 'content-length': Buffer.byteLength(body) });
        res.end(body);
        return;
      }
      const k = segs.findIndex((s) => s.name === name);
      if (k < 0 || k > newest()) { res.writeHead(404); res.end(); return; }
      const body = fs.readFileSync(segs[k].file);
      res.writeHead(200, { 'content-type': 'video/mp2t', 'content-length': body.length });
      res.end(body);
    };
    timer = setTimeout(answer, wait);
    res.on('close', () => { if (!res.writableEnded) { clearTimeout(timer); r.status = 'desistiu'; } }); // quem pediu desistiu antes da resposta
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${srv.address().port}/live/index.m3u8`, master: `http://127.0.0.1:${srv.address().port}/live/master.m3u8`, requests,
    /** s desde a subida da origem (o mesmo relógio de requests[].at) */
    elapsed: () => (Date.now() - t0) / 1000,
    stall: (ms) => { stallUntil = Date.now() + ms; },
    close: () => { srv.closeAllConnections?.(); srv.close(); },
  };
}
