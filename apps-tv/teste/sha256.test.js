'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const Sha = require('../comum/js/sha256.js');

const ref = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('vetores conhecidos', () => {
  assert.equal(Sha.de(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(Sha.de('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(Sha.de('00ff1234'), ref('00ff1234')); // o vetor do PIN do contrato
  assert.equal(Sha.de('ação é çã'), ref(Buffer.from('ação é çã', 'utf8')));
});

test('igual ao do Node em qualquer tamanho e em pedaços de qualquer tamanho', () => {
  for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 128, 1000, 65537, 300000]) {
    const b = crypto.randomBytes(n);
    const h = Sha.criar();
    let o = 0;
    while (o < n) { const k = 1 + Math.floor(Math.random() * 7000); h.update(b.subarray(o, o + k)); o += k; }
    assert.equal(h.hex(), ref(b), 'tamanho ' + n);
    assert.equal(Sha.de(new Uint8Array(b)), ref(b));
  }
});

test('aceita ArrayBuffer e não aceita dados depois do fim', () => {
  const b = crypto.randomBytes(100);
  const h = Sha.criar().update(b.buffer.slice(b.byteOffset, b.byteOffset + 100));
  assert.equal(h.hex(), ref(b));
  assert.equal(h.hex(), ref(b)); // repetir o hex dá o mesmo
  assert.throws(() => h.update(new Uint8Array(1)));
});
