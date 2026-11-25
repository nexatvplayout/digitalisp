'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { criarFila } = require('../comum/js/fila.js');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function arq(nome, conteudo) { const b = Buffer.from(conteudo || nome); return { url: 'https://x/' + nome, sha256: sha(b), bytes: b.length, _b: b }; }

/** Um "servidor" e um "disco" falsos. `defeito(nome, tentativa)` → 'rede' | 'semrede' | 'corrompido' | null */
function ambiente(defeito) {
  const disco = new Set(), descartados = [], pedidos = {}, rodadas = [];
  let simultaneos = 0, pico = 0;
  return {
    disco, descartados, pedidos, get pico() { return pico; },
    rodadas,
    baixar(f, prog, tentativa) {
      pedidos[f.url] = (pedidos[f.url] || 0) + 1;
      rodadas.push(tentativa);
      simultaneos++; pico = Math.max(pico, simultaneos);
      return new Promise((ok, falha) => setTimeout(() => {
        simultaneos--;
        const d = defeito && defeito(f.url.split('/').pop(), pedidos[f.url]);
        if (d === 'rede') return falha(new Error('HTTP 503'));
        if (d === 'semrede') { const e = new Error('sem conexão'); e.semRede = true; return falha(e); }
        prog(f.bytes);
        const b = d === 'corrompido' ? Buffer.from(f._b).fill(0) : f._b;
        ok({ bytes: b.length, sha256: sha(b) });
      }, 5));
    },
    aceitar(f) { disco.add(f.sha256); return Promise.resolve(); },
    descartar(f) { descartados.push(f.sha256); return Promise.resolve(); }
  };
}
const semEspera = () => Promise.resolve();

test('baixa tudo, um arquivo por sha256, com no máximo N ao mesmo tempo', async () => {
  const amb = ambiente();
  const a = arq('a'), b = arq('b'), c = arq('c'), d = arq('d'), copia = Object.assign({}, a, { url: 'https://outro/a' });
  const estados = [];
  const fila = criarFila(Object.assign({}, amb, { concorrencia: 2, esperar: semEspera, aoMudar: (s) => estados.push(s) }));
  fila.adicionar([a, b, c, d, copia]);
  assert.equal(fila.estado().total, 4);
  const r = await fila.executar();
  assert.deepEqual(r.falharam, []);
  assert.equal(r.prontos.length, 4);
  assert.equal(amb.disco.size, 4);
  assert.ok(amb.pico <= 2, 'pico ' + amb.pico);
  const fim = estados[estados.length - 1];
  assert.equal(fim.prontos, 4);
  assert.equal(fim.bytesFeitos, fim.bytesTotal);
});

test('sha256 que não confere: descarta, baixa de novo do zero e só aceita o certo', async () => {
  const amb = ambiente((nome, n) => (nome === 'b' && n === 1 ? 'corrompido' : null));
  const a = arq('a'), b = arq('b', 'conteúdo de b');
  const fila = criarFila(Object.assign({}, amb, { esperar: semEspera }));
  fila.adicionar([a, b]);
  const r = await fila.executar();
  assert.equal(r.prontos.length, 2);
  assert.deepEqual(amb.descartados, [b.sha256]);
  assert.equal(amb.pedidos[b.url], 2);
  // a 2ª tentativa avisa quem baixa (para passar por cima do cache HTTP)
  assert.ok(amb.rodadas.includes(2));
});

test('sempre corrompido: falha depois das tentativas e nunca entra no disco', async () => {
  const amb = ambiente((nome) => (nome === 'b' ? 'corrompido' : null));
  const a = arq('a'), b = arq('b');
  const fila = criarFila(Object.assign({}, amb, { tentativas: 3, esperar: semEspera }));
  fila.adicionar([a, b]);
  const r = await fila.executar();
  assert.deepEqual(r.prontos, [a.sha256]);
  assert.equal(r.falharam.length, 1);
  assert.equal(r.falharam[0].sha256, b.sha256);
  assert.match(r.falharam[0].motivo, /sha256/);
  assert.ok(!amb.disco.has(b.sha256));
  assert.equal(amb.pedidos[b.url], 3);
});

test('tamanho errado também é recusado', async () => {
  const amb = ambiente();
  const a = arq('a');
  const mentira = Object.assign({}, a, { bytes: a.bytes + 1 });
  const fila = criarFila(Object.assign({}, amb, { tentativas: 1, esperar: semEspera }));
  fila.adicionar([mentira]);
  const r = await fila.executar();
  assert.equal(r.falharam.length, 1);
  assert.match(r.falharam[0].motivo, /tamanho/);
});

test('erro de rede espera e tenta de novo, com espera crescente', async () => {
  const amb = ambiente((nome, n) => (n <= 2 ? 'rede' : null));
  const esperas = [];
  const fila = criarFila(Object.assign({}, amb, { esperar: (ms) => { esperas.push(ms); return Promise.resolve(); } }));
  fila.adicionar([arq('a')]);
  const r = await fila.executar();
  assert.equal(r.prontos.length, 1);
  assert.deepEqual(esperas, [5000, 10000]);
});

test('sem rede: a fila para inteira sem gastar tentativas e continua depois', async () => {
  let rede = false;
  const amb = ambiente(() => (rede ? null : 'semrede'));
  const fila = criarFila(Object.assign({}, amb, { tentativas: 1, concorrencia: 1, esperar: semEspera }));
  const lista = [arq('a'), arq('b'), arq('c')];
  fila.adicionar(lista);
  const r1 = await fila.executar();
  assert.equal(r1.semRede, true);
  assert.equal(r1.prontos.length, 0);
  assert.equal(r1.falharam.length, 0, 'sem rede não é falha do arquivo');
  assert.equal(Object.keys(amb.pedidos).length, 1, 'parou no primeiro');
  rede = true;
  const r2 = await fila.executar();
  assert.equal(r2.prontos.length, 3);
  assert.equal(r2.semRede, false);
});
