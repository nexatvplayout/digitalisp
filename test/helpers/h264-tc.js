// Fonte de teste com timecode no SEI pic_timing do H.264 (o que câmeras, ATEM e encoders broadcast mandam). O libx264 não
// escreve timecode: aqui o FFmpeg gera o H.264 cru (Annex B) com pic_struct no VUI (-x264-params pic-struct=1) e este
// módulo troca o pic_timing do x264 (sem relógio) por um com clock_timestamp (SMPTE 12M) quadro a quadro.

/** Escritor de bits (MSB primeiro). */
class Bits {
  constructor() { this.out = []; this.cur = 0; this.n = 0; }
  put(v, len) { for (let i = len - 1; i >= 0; i--) { this.cur = (this.cur << 1) | ((v >> i) & 1); if (++this.n === 8) { this.out.push(this.cur); this.cur = 0; this.n = 0; } } }
  trailing() { this.put(1, 1); while (this.n) this.put(0, 1); return this.out; }
}

/** Prevenção de emulação: 00 00 seguido de 00–03 ganha um 03 no meio. */
function escape(bytes) {
  const out = []; let zeros = 0;
  for (const b of bytes) {
    if (zeros >= 2 && b <= 3) { out.push(3); zeros = 0; }
    out.push(b); zeros = b === 0 ? zeros + 1 : 0;
  }
  return out;
}

/** NAL de SEI pic_timing (pic_struct 0, um clock_timestamp completo; time_offset_length 24, sem HRD). drop: counting_type 4. */
export function picTimingNal({ h, m, s, f }, { drop = false } = {}) {
  const p = new Bits();
  p.put(0, 4); // pic_struct: quadro
  p.put(1, 1); // clock_timestamp_flag
  p.put(0, 2); // ct_type: progressivo
  p.put(0, 1); // nuit_field_based_flag
  p.put(drop ? 4 : 0, 5); // counting_type (4 = drop frame)
  p.put(1, 1); // full_timestamp_flag
  p.put(0, 1); // discontinuity_flag
  p.put(drop ? 1 : 0, 1); // cnt_dropped_flag (o FFmpeg lê o drop frame daqui: ";" no rótulo)
  p.put(f, 8); p.put(s, 6); p.put(m, 6); p.put(h, 5);
  p.put(0, 24); // time_offset
  const payload = p.trailing(); // 65 bits: o payload fecha o byte com 1 e zeros (sei_payload, payload_bit_equal_to_one)
  const body = [1, payload.length, ...payload, 0x80]; // payloadType 1, tamanho, payload, rbsp_trailing_bits
  return Buffer.from([0, 0, 0, 1, 0x06, ...escape(body)]);
}

/** Divide o Annex B em NALs ([início, fim) sem o prefixo). */
function nals(buf) {
  const at = [];
  for (let i = 0; i + 3 <= buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) { at.push(i + 3); i += 2; }
  }
  return at.map((st, k) => {
    let end = k + 1 < at.length ? at[k + 1] - 3 : buf.length;
    while (end > st && buf[end - 1] === 0) end--; // zero do prefixo de 4 bytes
    return buf.subarray(st, end);
  });
}

/**
 * Troca os pic_timing do x264 por timecode quadro a quadro a partir de start ({h,m,s,f}) na taxa nominal `nominal`.
 * Drop frame (29,97/59,94) pula os números 00/01 (04/05 em 59,94) a cada minuto menos nos múltiplos de 10.
 */
export function injectTimecode(annexB, start, { nominal = 30, drop = false } = {}) {
  let { h, m, s, f } = start;
  const dropN = drop ? (nominal >= 60 ? 4 : 2) : 0;
  const parts = [];
  for (const n of nals(annexB)) {
    const type = n[0] & 0x1f;
    if (type === 6 && n[1] === 1) continue; // pic_timing do x264
    if (type === 1 || type === 5) {
      parts.push(picTimingNal({ h, m, s, f }, { drop }));
      if (++f >= nominal) {
        f = 0;
        if (++s >= 60) { s = 0; if (++m >= 60) { m = 0; h = (h + 1) % 24; } if (dropN && m % 10 !== 0) f = dropN; }
      }
    }
    parts.push(Buffer.from([0, 0, 0, 1]), n);
  }
  return Buffer.concat(parts);
}
