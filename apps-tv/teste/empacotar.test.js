'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { main } = require('../scripts/empacotar.js');

function lerAr(buf) {
  assert.equal(buf.subarray(0, 8).toString(), '!<arch>\n');
  const out = {};
  let o = 8;
  while (o < buf.length) {
    const nome = buf.subarray(o, o + 16).toString().trim().replace(/\/$/, '');
    const tam = Number(buf.subarray(o + 48, o + 58).toString().trim());
    assert.equal(buf.subarray(o + 58, o + 60).toString(), '`\n');
    out[nome] = buf.subarray(o + 60, o + 60 + tam);
    o += 60 + tam + (tam % 2);
  }
  return out;
}

function lerTar(gz) {
  const buf = zlib.gunzipSync(gz), out = {};
  let o = 0;
  while (o + 512 <= buf.length) {
    const h = buf.subarray(o, o + 512);
    if (h.every((b) => b === 0)) break;
    let soma = 0;
    for (let i = 0; i < 512; i++) soma += i >= 148 && i < 156 ? 32 : h[i];
    assert.equal(parseInt(h.subarray(148, 156).toString(), 8), soma, 'checksum do tar');
    const prefixo = h.subarray(345, 500).toString().replace(/\0.*$/s, '');
    const nome = (prefixo ? prefixo + '/' : '') + h.subarray(0, 100).toString().replace(/\0.*$/s, '');
    const tam = parseInt(h.subarray(124, 136).toString(), 8);
    out[nome] = buf.subarray(o + 512, o + 512 + tam);
    o += 512 + Math.ceil(tam / 512) * 512;
  }
  return out;
}

test('webOS: .ipk com control, data, appinfo, packageinfo e o player inteiro, com o servidor escolhido', () => {
  const saida = fs.mkdtempSync(path.join(os.tmpdir(), 'telas-pacote-'));
  try {
    const r = main(['webos', '--saida=' + saida, '--servidor=https://app.exemplo.com.br']);
    const membros = lerAr(fs.readFileSync(r.webos.ipk));
    assert.deepEqual(Object.keys(membros), ['debian-binary', 'control.tar.gz', 'data.tar.gz']);
    assert.equal(membros['debian-binary'].toString(), '2.0\n');
    const control = lerTar(membros['control.tar.gz'])['./control'].toString();
    assert.match(control, /^Package: br\.com\.digitalisp\.telas$/m);
    assert.match(control, /^Architecture: all$/m);
    const dados = lerTar(membros['data.tar.gz']);
    const base = './usr/palm/applications/br.com.digitalisp.telas/';
    const info = JSON.parse(dados[base + 'appinfo.json']);
    assert.equal(info.title, 'Telas');
    assert.ok(dados[base + 'index.html']);
    assert.ok(dados[base + 'icon.png'].subarray(1, 4).toString() === 'PNG');
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'comum', 'js'))) assert.ok(dados[base + 'js/' + f], f);
    assert.match(dados[base + 'js/config-padrao.js'].toString(), /app\.exemplo\.com\.br/);
    assert.ok(dados['./usr/palm/packages/br.com.digitalisp.telas/packageinfo.json']);
  } finally { fs.rmSync(saida, { recursive: true, force: true }); }
});

test('Tizen: pasta pronta para assinar, com config.xml, ícone e a webapis do aparelho no index', () => {
  const saida = fs.mkdtempSync(path.join(os.tmpdir(), 'telas-pacote-'));
  try {
    const r = main(['tizen', '--saida=' + saida]);
    assert.equal(r.tizen.wgt, null, 'sem perfil, não assina');
    const app = r.tizen.pasta;
    const xml = fs.readFileSync(path.join(app, 'config.xml'), 'utf8');
    assert.match(xml, /<name>Telas<\/name>/);
    assert.match(xml, /package="[A-Za-z0-9]{10}"/);
    assert.match(fs.readFileSync(path.join(app, 'index.html'), 'utf8'), /\$WEBAPIS\/webapis\/webapis\.js/);
    assert.equal(fs.readFileSync(path.join(app, 'icon.png')).subarray(1, 4).toString(), 'PNG');
    // o servidor padrão continua o do repositório
    assert.equal(fs.readFileSync(path.join(app, 'js', 'config-padrao.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '..', 'comum', 'js', 'config-padrao.js'), 'utf8'));
  } finally { fs.rmSync(saida, { recursive: true, force: true }); }
});

test('servidor http é recusado no pacote', () => {
  const saida = fs.mkdtempSync(path.join(os.tmpdir(), 'telas-pacote-'));
  try { assert.throws(() => main(['webos', '--saida=' + saida, '--servidor=http://x']), /https/); } finally { fs.rmSync(saida, { recursive: true, force: true }); }
});
