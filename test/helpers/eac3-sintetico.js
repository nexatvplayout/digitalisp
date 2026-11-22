// Material de teste do repasse do 7.1 e do som imersivo (server/som71.js, docs/SOM-51.md "Fase 4"). O FFmpeg não grava E-AC-3
// 7.1 nem com o JOC, e não há amostra real na máquina: aqui os quadros E-AC-3 que o FFmpeg grava (5.1 e estéreo) são
// reescritos no nível do bit, seguindo a ETSI TS 102 366 (anexo E) e o que o codificador do FFmpeg grava
// (libavcodec/eac3enc.c ff_eac3_output_frame_header):
//   - withJoc: o quadro independente ganha o addbsi do som imersivo (flag_ec3_extension_type_a = 1 e o índice de
//     complexidade), como o de um master de verdade. Os blocos de áudio continuam os mesmos (o decodificador toca o 5.1).
//   - asDependent: o quadro estéreo vira a subtrilha dependente (strmtyp 1) com o mapa de canais das traseiras (Lrs/Rrs): sai
//     o "converter exponent strategy" (só existe na independente) e entra o chanmap. Intercalado com o 5.1, o FFmpeg decodifica
//     o 7.1 (5.1 + as traseiras).
// O tamanho do quadro (frmsiz) cresce para caber os bits novos (a folga vai antes do auxdatae, que o decodificador procura de
// trás para frente) e o CRC (crc2) é refeito. Só para os testes: nada daqui vai para o servidor.
import { parseFrame, syncframes } from '../../server/som71.js';

const toBits = (buf) => { const a = new Uint8Array(buf.length * 8); for (let i = 0; i < a.length; i++) a[i] = (buf[i >> 3] >> (7 - (i & 7))) & 1; return a; };
const fromBits = (bits) => { const out = Buffer.alloc(bits.length / 8); for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >> 3] |= 0x80 >> (i & 7); return out; };
const num = (n, v) => { const a = []; for (let i = n - 1; i >= 0; i--) a.push((v >> i) & 1); return a; };
const read = (bits, at, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 2 + bits[at + i]; return v; };

/** CRC-16 do AC-3 (polinômio 0x8005, começa em 0, sem reflexão). */
export function crc16(buf, from = 0, to = buf.length) {
  let crc = 0;
  for (let i = from; i < to; i++) {
    crc ^= buf[i] << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
/** O crc2 que o quadro tem e o que deveria ter (os bytes 2 até o fim menos 2). */
export const crcOf = (frame) => ({ stored: frame.readUInt16BE(frame.length - 2), want: crc16(frame, 2, frame.length - 2) });

/**
 * Remonta o quadro: os bits novos (sem os 18 do fim: auxdatae, encinfo e crc2) + a folga até fechar em 16 bits + o fim antigo
 * (auxdatae, encinfo) + o crc2 novo; o frmsiz (bits 21–31) passa a ser o tamanho novo.
 */
function rebuild(body, tail2) {
  const len = Math.ceil((body.length + 18) / 16) * 16;
  const bits = new Uint8Array(len);
  bits.set(body, 0);
  bits.set(tail2, len - 18);
  const words = len / 16;
  bits.set(num(11, words - 1), 21);
  const out = fromBits(bits);
  out.writeUInt16BE(crc16(out, 2, out.length - 2), out.length - 2);
  return out;
}

/** O quadro E-AC-3 independente com o addbsi do som imersivo (flag_ec3_extension_type_a e complexity_index_type_a). */
export function withJoc(frame, complexity = 16) {
  const f = parseFrame(frame);
  if (!f || f.ac3 || f.addbsiAt == null) throw new Error('não é um quadro E-AC-3 independente');
  const bits = toBits(frame);
  if (bits[f.addbsiAt] !== 0) throw new Error('o quadro já tem addbsi');
  if (bits[bits.length - 18] !== 0) throw new Error('quadro com auxdata');
  const body = [...bits.subarray(0, f.addbsiAt), 1, ...num(6, 1), ...num(8, 1), ...num(8, complexity), ...bits.subarray(f.addbsiAt + 1, bits.length - 18)];
  return rebuild(Uint8Array.from(body), bits.subarray(bits.length - 18, bits.length - 16));
}

/**
 * O quadro E-AC-3 estéreo do FFmpeg como subtrilha dependente (strmtyp 1) com o mapa de canais chanmap (padrão: o par Lrs/Rrs,
 * as traseiras do 7.1). Lê o audfrm do codificador do FFmpeg (expstre, os acoplamentos, as estratégias de expoente) até o
 * "converter exponent strategy", que sai.
 */
export function asDependent(frame, chanmap = 0x0200) {
  const f = parseFrame(frame);
  if (!f || f.ac3 || f.strmtyp !== 0 || f.acmod !== 2 || f.lfeon || f.blocks !== 6) throw new Error('quero o quadro estéreo independente de 6 blocos do FFmpeg');
  const bits = toBits(frame);
  if (bits[bits.length - 18] !== 0) throw new Error('quadro com auxdata');
  // BSI: dialnorm (45), compre (50) [compr]; o chanmap entra depois dele
  let p = 50;
  const compre = bits[p]; p += 1 + (compre ? 8 : 0);
  const at = p;
  if (bits[p] || bits[p + 1]) throw new Error('o FFmpeg gravou mixmdate/infomdate: fora do esperado');
  if (p + 2 !== f.addbsiAt || bits[f.addbsiAt]) throw new Error('addbsi inesperado');
  // audfrm (eac3enc.c): expstre, ahte, 10 bits de chaves, cplinu e as estratégias de acoplamento, as de expoente
  let q = f.addbsiAt + 1;
  const expstre = bits[q]; q += 2;
  q += 10;
  const cplinu = [bits[q]]; q += 1;
  for (let b = 1; b < 6; b++) { const strat = bits[q]; q += 1; if (strat) { cplinu[b] = bits[q]; q += 1; } else cplinu[b] = cplinu[b - 1]; }
  if (!expstre) {
    const cplOn = cplinu.some(Boolean);
    q += (2 - (cplOn ? 0 : 1) + 1) * 5; // frmcplexpstr (com acoplamento) e um por canal
  } else for (let b = 0; b < 6; b++) q += (2 - (cplinu[b] ? 0 : 1) + 1) * 2;
  const conv = q; // 5 bits por canal (2): o converter exponent strategy, só da independente
  const body = [...bits.subarray(0, 16), 0, 1, ...bits.subarray(18, at), 1, ...num(16, chanmap), ...bits.subarray(at, conv), ...bits.subarray(conv + 10, bits.length - 18)];
  return rebuild(Uint8Array.from(body), bits.subarray(bits.length - 18, bits.length - 16));
}

/** Os quadros de um E-AC-3 cru. */
export const framesOf = (buf) => [...syncframes(buf)].map((f) => buf.subarray(f.off, f.off + f.size));

/** E-AC-3 cru com o som imersivo: cada quadro independente com o addbsi do JOC. */
export const jocStream = (raw, complexity = 16) => Buffer.concat(framesOf(raw).map((fr) => withJoc(fr, complexity)));

/** E-AC-3 cru 7.1: cada quadro do 5.1 seguido da subtrilha dependente com as traseiras (do estéreo, quadro a quadro). */
export function stream71(raw51, raw20) {
  const a = framesOf(raw51); const b = framesOf(raw20);
  const out = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) out.push(a[i], asDependent(b[i]));
  return Buffer.concat(out);
}

export { toBits, read };
