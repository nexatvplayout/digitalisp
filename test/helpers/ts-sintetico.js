// MPEG-TS de mentira para testes sem FFmpeg: vídeo "MPEG-2" (quadro I a cada 15, com o cabeçalho de sequência 00 00 01 B3)
// e um PES de áudio por quadro, nos PIDs do FFmpeg (0x100 vídeo, 0x101 áudio). Só os cabeçalhos são de verdade: serve para
// o que lê PES, carimbos e quadros I (SlotFeed), não para decodificar.
export const FPS = 30;
export const CLOCK = 90000;

/** Carimbo PES de 33 bits com o prefixo (0010 = só PTS, 0011 = PTS com DTS, 0001 = DTS). */
function stamp(prefix, t) {
  const v = Math.round(t) % 2 ** 33;
  return [(prefix << 4) | (Math.floor(v / 2 ** 30) << 1) | 1, (Math.floor(v / 2 ** 22)) & 0xff, ((Math.floor(v / 2 ** 15) & 0x7f) << 1) | 1, (Math.floor(v / 2 ** 7)) & 0xff, ((v & 0x7f) << 1) | 1];
}
/** Um PES em pacotes TS de 188 bytes: o primeiro com o cabeçalho, os outros só com enchimento. */
export function pes(pid, sid, t, payload, packets, cc) {
  const out = [];
  const head = [0, 0, 1, sid, 0, 0, 0x80, sid >= 0xe0 ? 0xc0 : 0x80, sid >= 0xe0 ? 10 : 5, ...(sid >= 0xe0 ? [...stamp(3, t), ...stamp(1, t)] : stamp(2, t))];
  for (let k = 0; k < packets; k++) {
    const p = Buffer.alloc(188, 0xff);
    p[0] = 0x47; p[1] = (k === 0 ? 0x40 : 0) | (pid >> 8); p[2] = pid & 0xff; p[3] = 0x10 | (cc.n++ & 0xf);
    Buffer.from(k === 0 ? [...head, ...payload] : []).copy(p, 4);
    out.push(p);
  }
  return out;
}

/**
 * "Câmera" de `frames` quadros a 30 q/s a partir do carimbo `t0` (ticks). frames: um Buffer por quadro (vídeo e o áudio
 * dele); dts: o DTS (ticks) de cada quadro; ts: tudo junto. iPackets/pPackets: tamanho dos quadros I e dos outros.
 */
export function camera(frames, { iPackets = 40, pPackets = 8, tag = 'SRC', t0 = CLOCK, a2 = false } = {}) {
  const cv = { n: 0 }; const ca = { n: 0 }; const c2 = { n: 0 }; const out = []; const dts = [];
  for (let n = 0; n < frames; n++) {
    const t = t0 + (n * CLOCK) / FPS;
    const key = n % 15 === 0;
    dts.push(t);
    // a2: a 2ª trilha de áudio (o AC-3 5.1 da mesa com o som 5.1 no ar: PES 0xBD no PID 0x102), também um PES por quadro
    out.push(Buffer.concat([...pes(0x100, 0xe0, t, [0, 0, 1, key ? 0xb3 : 0x00, ...Buffer.from(tag)], key ? iPackets : pPackets, cv),
      ...pes(0x101, 0xc0, t, [0xff, 0xfd, ...Buffer.from(tag)], 2, ca),
      ...(a2 ? pes(0x102, 0xbd, t, [0x0b, 0x77, ...Buffer.from(tag)], 3, c2) : [])]));
  }
  return { frames: out, dts, ts: Buffer.concat(out) };
}
