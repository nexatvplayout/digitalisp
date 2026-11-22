// De onde vem o aviso que a TV mostra (server/telas-core.js tickerOrigin), na mesma precedência da configuração efetiva.
// 14/11: o dono apagou o aviso da repartição e ele continuou na TV: a lista vazia da repartição devolve a vez ao aviso da
// prefeitura (ou o grupo/a própria tela vencem). O painel da repartição passa a dizer de onde vem e onde se tira.
import test from 'node:test';
import assert from 'node:assert/strict';

const C = await import('../server/telas-core.js');

test('a origem do aviso segue a precedência: tela > grupos > repartição > prefeitura', () => {
  const defaults = { tickerItems: ['Aviso da prefeitura'] };
  const office = { tickerItems: ['Aviso da UPA'] };
  const base = { defaults, office, officeType: 'upa', modules: null, groups: [], device: {} };
  assert.deepEqual(C.tickerOrigin(base), { from: 'reparticao', groups: [], items: ['Aviso da UPA'] });
  assert.equal(C.tickerOrigin({ ...base, office: {} }).from, 'prefeitura', 'lista vazia da repartição: o aviso da prefeitura volta');
  assert.deepEqual(C.tickerOrigin({ ...base, office: {}, defaults: {} }), { from: 'nenhum', groups: [], items: [] });
  const g = C.tickerOrigin({ ...base, groups: [{ name: 'Saúde', config: { tickerItems: ['Do grupo'] } }, { name: 'Sem avisos', config: {} }] });
  assert.deepEqual(g, { from: 'grupo', groups: ['Saúde'], items: ['Do grupo'] });
  assert.equal(C.tickerOrigin({ ...base, device: { tickerItems: ['Da tela'] } }).from, 'tela');
  // módulo de avisos desligado na repartição: os dela não contam
  assert.equal(C.tickerOrigin({ ...base, modules: { avisos: false } }).from, 'prefeitura');
});

test('a origem bate com a configuração efetiva (os mesmos avisos chegam à TV)', () => {
  const cases = [
    { defaults: { tickerItems: ['P'] }, office: {}, groups: [], device: {} },
    { defaults: { tickerItems: ['P'] }, office: { tickerItems: ['R'] }, groups: [], device: {} },
    { defaults: {}, office: { tickerItems: ['R'] }, groups: [{ name: 'G', config: { tickerItems: ['G1', 'G2'] } }], device: {} },
    { defaults: {}, office: { tickerItems: ['R'] }, groups: [], device: { tickerItems: ['T'] } },
  ];
  for (const c of cases) {
    const eff = C.effectiveConfig({ defaults: c.defaults, office: c.office, officeType: 'upa', groups: c.groups.map((x) => x.config), device: c.device });
    assert.deepEqual(C.tickerOrigin({ ...c, officeType: 'upa' }).items, eff.tickerItems, JSON.stringify(c));
  }
});
