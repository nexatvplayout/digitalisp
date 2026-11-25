'use strict';
/* A entrada HDMI pela janela de TV da Samsung (comum/js/hdmi.js), com uma tizen.tvwindow de mentira. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const N = require('../comum/js/nucleo.js');

function carregar(tizen) {
  const ctx = vm.createContext({ TelasNucleo: N, tizen });
  ctx.self = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'comum', 'js', 'hdmi.js'), 'utf8'), ctx);
  return ctx.TelasHdmi.criar();
}

function tizenFalsa(vs, log) {
  return {
    systeminfo: { getPropertyValue: (p, ok) => { log.push(['prop', p]); ok(vs); } },
    tvwindow: {
      setSource: (src, ok, erro, janela) => { log.push(['setSource', src.type, src.number, janela]); ok(); },
      show: (ok, erro, ret, janela, z) => { log.push(['show', ret.join(' '), janela, z]); ok(); },
      hide: (ok, erro, janela) => { log.push(['hide', janela]); ok(); }
    }
  };
}

test('HDMI: lista as entradas da TV, mostra a escolhida no retângulo da zona (atrás da página) e esconde', async () => {
  const log = [];
  const vs = { connected: [{ type: 'HDMI', number: 2 }], disconnected: [{ type: 'HDMI', number: 1 }] };
  const h = carregar(tizenFalsa(vs, log));
  assert.equal(h.disponivel(), true);
  const lista = await new Promise((ok) => h.entradas(ok));
  assert.deepEqual(lista, [{ n: 1, conectada: false }, { n: 2, conectada: true }]);
  const r = await new Promise((ok) => h.mostrar(2, { x: 0, y: 0, w: 70, h: 88 }, ok));
  assert.deepEqual(r, { ok: true, conectada: true });
  assert.deepEqual(log.filter((l) => l[0] !== 'prop'), [['setSource', 'HDMI', 2, 'MAIN'], ['show', '0% 0% 70% 88%', 'MAIN', 'BEHIND']]);
  h.esconder();
  assert.deepEqual(log[log.length - 1], ['hide', 'MAIN']);
});

test('HDMI: entrada sem cabo avisa (conectada false); falha da API volta o motivo; sem a API, indisponível', async () => {
  const log = [];
  const h = carregar(tizenFalsa({ connected: [], disconnected: [{ type: 'HDMI', number: 1 }] }, log));
  assert.equal((await new Promise((ok) => h.mostrar(1, { x: 0, y: 0, w: 100, h: 100 }, ok))).conectada, false);
  const ruim = tizenFalsa({ connected: [{ type: 'HDMI', number: 1 }] }, []);
  ruim.tvwindow.setSource = (src, ok, erro) => erro({ message: 'NotSupportedError' });
  const r = await new Promise((ok) => carregar(ruim).mostrar(1, { x: 0, y: 0, w: 50, h: 50 }, ok));
  assert.equal(r.ok, false);
  assert.match(r.motivo, /setSource: NotSupportedError/);
  const sem = carregar(undefined);
  assert.equal(sem.disponivel(), false);
  assert.equal((await new Promise((ok) => sem.mostrar(1, { x: 0, y: 0, w: 50, h: 50 }, ok))).ok, false);
});
