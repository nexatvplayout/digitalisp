// Receptor RTMP de teste (o papel do aparelho que recebe a Saída RTMP do canal: decodificador, player, servidor RTMP).
// Aceita uma publicação por conexão, quantas vierem (a saída que cai e volta), e guarda cada mensagem de áudio, vídeo e
// dados como chegou: tipo, carimbo do RTMP (ms), quadro-chave, cabeçalhos de sequência (SPS/PPS, AudioSpecificConfig) e a
// hora de chegada. O protocolo (handshake, chunks, connect/createStream/publish) é o do node-media-server, que já é
// dependência do servidor (entrada RTMP, server/ingest.js); aqui só a parte de quem recebe, sem repassar nada.
import fs from 'node:fs';
import net from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Rtmp = require('node-media-server/src/protocol/rtmp.js');
const AMF = require('node-media-server/src/protocol/amf.js');

/** Tipos de mensagem do FLV/RTMP. */
export const AUDIO = 8;
export const VIDEO = 9;
export const DATA = 18;

/** Uma mensagem recebida: { type, dts, pts, key, seqHeader, data, at }. */
function tagOf(p) {
  const data = Buffer.from(p.data.subarray(0, p.size));
  const t = { type: p.codec_type, dts: p.dts, pts: p.pts, key: false, seqHeader: false, data, at: Date.now() };
  if (t.type === VIDEO) { t.key = (data[0] >> 4) === 1; t.seqHeader = (data[0] & 0x0f) === 7 && data[1] === 0; }
  if (t.type === AUDIO) t.seqHeader = (data[0] >> 4) === 10 && data[1] === 0;
  return t;
}

/**
 * Sobe o receptor em 127.0.0.1, numa porta livre. Devolve { port, conns, close() }; cada conexão:
 * { n, at, closedAt, stream, tags[], cmds[] } (cmds: os comandos do RTMP na ordem, connect … publish … FCUnpublish,
 * deleteStream: os dois últimos só chegam quando quem envia fecha a sessão direito).
 */
export async function rtmpReceiver() {
  const conns = [];
  const sockets = new Set();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    const c = { n: conns.length + 1, at: Date.now(), closedAt: null, stream: null, tags: [], cmds: [] };
    conns.push(c);
    const r = new Rtmp();
    const invoke = r.invokeHandler.bind(r);
    r.invokeHandler = () => {
      try {
        const pk = r.parserPacket;
        c.cmds.push(AMF.decodeAmf0Cmd(pk.payload.subarray(pk.header.type === 17 ? 1 : 0, pk.header.length)).cmd);
      } catch { /* comando ilegível: só não entra na lista */ }
      return invoke();
    };
    r.onOutputCallback = (b) => { if (!sock.destroyed) sock.write(b); };
    r.onConnectCallback = (req) => { c.stream = `${req.app}/${req.name}`; };
    r.onPacketCallback = (p) => { if (p.codec_type === AUDIO || p.codec_type === VIDEO || p.codec_type === DATA) c.tags.push(tagOf(p)); };
    sock.on('data', (d) => { try { if (r.parserData(d) != null) sock.destroy(); } catch { sock.destroy(); } });
    sock.on('close', () => { c.closedAt = Date.now(); sockets.delete(sock); });
    sock.on('error', () => {});
  });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address();
  return {
    port,
    conns,
    close: () => new Promise((res) => { for (const s of sockets) s.destroy(); server.close(() => res()); }),
  };
}

/** SPS e PPS do cabeçalho de sequência AVC (AVCDecoderConfigurationRecord) em hex, mais perfil e nível. */
export function avcConfig(tag) {
  const d = tag.data;
  let o = 10;
  const nSps = d[o] & 0x1f; o += 1;
  const sps = [];
  for (let i = 0; i < nSps; i++) { const n = d.readUInt16BE(o); sps.push(d.subarray(o + 2, o + 2 + n).toString('hex')); o += 2 + n; }
  const nPps = d[o]; o += 1;
  const pps = [];
  for (let i = 0; i < nPps; i++) { const n = d.readUInt16BE(o); pps.push(d.subarray(o + 2, o + 2 + n).toString('hex')); o += 2 + n; }
  return { profile: d[6], level: d[8], sps, pps };
}

/** NALs de um quadro AVC do FLV (comprimentos de 4 bytes): os tipos (5 = IDR, 7 = SPS, 8 = PPS, 6 = SEI, 1 = fatia). */
export function nalTypes(tag) {
  const out = [];
  const d = tag.data;
  for (let o = 5; o + 4 <= d.length;) {
    const n = d.readUInt32BE(o);
    if (n <= 0 || o + 4 + n > d.length) break;
    out.push(d[o + 4] & 0x1f);
    o += 4 + n;
  }
  return out;
}

/** Grava as mensagens como um arquivo FLV (o que o aparelho decodificaria), com os carimbos como chegaram. */
export function writeFlv(file, tags) {
  const parts = [Buffer.from([0x46, 0x4c, 0x56, 0x01, 0x05, 0, 0, 0, 9, 0, 0, 0, 0])];
  for (const t of tags) {
    const h = Buffer.alloc(11);
    h[0] = t.type;
    h.writeUIntBE(t.data.length, 1, 3);
    h.writeUIntBE(t.dts & 0xffffff, 4, 3);
    h[7] = (t.dts >>> 24) & 0xff;
    const prev = Buffer.alloc(4);
    prev.writeUInt32BE(11 + t.data.length);
    parts.push(h, t.data, prev);
  }
  fs.writeFileSync(file, Buffer.concat(parts));
}
