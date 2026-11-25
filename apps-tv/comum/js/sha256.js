/*
 * SHA-256 em JavaScript puro, por partes (o arquivo pode ser conferido enquanto chega, sem caber inteiro na memória).
 * As TVs antigas não têm crypto.subtle fora de https, e o app roda de file:// (Tizen) ou do pacote (webOS): por isso
 * o app não depende dele. Sem sintaxe nova (roda no Chromium 53 do webOS 4 e no 56 do Tizen 4).
 *
 * Uso: var h = TelasSha256.criar(); h.update(uint8array); ...; h.hex()  →  "e3b0c442..."
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.TelasSha256 = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function Sha256() {
    this.h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    this.w = new Uint32Array(64);
    this.buf = new Uint8Array(64);
    this.bufLen = 0;
    this.total = 0; // bytes (até 2^53, sobra para qualquer arquivo)
    this.fim = false;
  }

  Sha256.prototype._bloco = function (d, o) {
    var w = this.w, h = this.h, i, t1, t2, s0, s1;
    for (i = 0; i < 16; i++) w[i] = (d[o + i * 4] << 24) | (d[o + i * 4 + 1] << 16) | (d[o + i * 4 + 2] << 8) | d[o + i * 4 + 3];
    for (i = 16; i < 64; i++) {
      s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    var a = h[0], b = h[1], c = h[2], e = h[4], f = h[5], g = h[6], hh = h[7], dd = h[3];
    for (i = 0; i < 64; i++) {
      s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      t1 = (hh + s1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (dd + t1) | 0; dd = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + dd) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  };

  /** Mais bytes (Uint8Array ou ArrayBuffer). */
  Sha256.prototype.update = function (dados) {
    if (this.fim) throw new Error('sha256: já terminado');
    var d = dados instanceof Uint8Array ? dados : new Uint8Array(dados);
    var i = 0, n = d.length;
    this.total += n;
    if (this.bufLen > 0) {
      while (i < n && this.bufLen < 64) this.buf[this.bufLen++] = d[i++];
      if (this.bufLen === 64) { this._bloco(this.buf, 0); this.bufLen = 0; }
    }
    while (i + 64 <= n) { this._bloco(d, i); i += 64; }
    while (i < n) this.buf[this.bufLen++] = d[i++];
    return this;
  };

  /** O resultado em hexadecimal minúsculo. Depois disto o objeto não aceita mais dados. */
  Sha256.prototype.hex = function () {
    if (!this.fim) {
      var bits = this.total * 8;
      var hi = Math.floor(bits / 0x100000000), lo = bits >>> 0;
      this.buf[this.bufLen++] = 0x80;
      if (this.bufLen > 56) {
        while (this.bufLen < 64) this.buf[this.bufLen++] = 0;
        this._bloco(this.buf, 0);
        this.bufLen = 0;
      }
      while (this.bufLen < 56) this.buf[this.bufLen++] = 0;
      var b = this.buf;
      b[56] = hi >>> 24; b[57] = hi >>> 16; b[58] = hi >>> 8; b[59] = hi;
      b[60] = lo >>> 24; b[61] = lo >>> 16; b[62] = lo >>> 8; b[63] = lo;
      this._bloco(b, 0);
      this.fim = true;
    }
    var s = '';
    for (var i = 0; i < 8; i++) s += ('00000000' + (this.h[i] >>> 0).toString(16)).slice(-8);
    return s;
  };

  function utf8(texto) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(texto);
    var s = unescape(encodeURIComponent(texto)), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  return {
    criar: function () { return new Sha256(); },
    /** Hash de uma vez: bytes ou texto (UTF-8). */
    de: function (dados) { return new Sha256().update(typeof dados === 'string' ? utf8(dados) : dados).hex(); }
  };
});
