// "Localizar no mapa" das repartições (server/telas-geocode.js): a busca de endereços presa ao município, a fila de um
// pedido por vez, a resposta guardada e a volta ao geocodificador antigo. Sem internet: o getJson é de mentira.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeocoder, addressQuery, nominatimUrl } from '../server/telas-geocode.js';

const RIO = { name: 'Rio de Janeiro', uf: 'RJ' };
const BOX = { south: -23.08, west: -43.8, north: -22.74, east: -43.1 };

test('o texto da busca leva a cidade e a UF, sem repetir a cidade que a pessoa já escreveu', () => {
  assert.equal(addressQuery('Rua Barbosa da Silva, 80', RIO), 'Rua Barbosa da Silva, 80, Rio de Janeiro, RJ, Brasil');
  assert.equal(addressQuery('  Rua  X, 10 - rio de janeiro ', RIO), 'Rua X, 10 - rio de janeiro, Brasil');
  assert.equal(addressQuery('Rua X, 10'), 'Rua X, 10');
  assert.equal(addressQuery('a'.repeat(300), RIO).startsWith('a'.repeat(120) + ','), true, 'texto cortado em 120');
  const u = new URL(nominatimUrl('Rua X, Rio de Janeiro, RJ, Brasil', BOX));
  assert.equal(u.origin + u.pathname, 'https://nominatim.openstreetmap.org/search');
  assert.deepEqual([u.searchParams.get('countrycodes'), u.searchParams.get('bounded'), u.searchParams.get('viewbox'), u.searchParams.get('format'), u.searchParams.get('limit')],
    ['br', '1', '-43.8,-22.74,-43.1,-23.08', 'jsonv2', '5']);
  assert.equal(new URL(nominatimUrl('Rua X')).searchParams.get('viewbox'), null);
});

test('acha o endereço dentro do município, guarda a resposta e identifica o cliente sem dado pessoal', async () => {
  const calls = [];
  const getJson = async (url, opts) => { calls.push({ url, opts }); return [{ display_name: 'Rua Barbosa da Silva, Riachuelo, Rio de Janeiro', lat: '-22.899', lon: '-43.2537' }, { display_name: 'sem ponto', lat: 'x', lon: '1' }]; };
  const g = createGeocoder({ getJson, gapMs: 0 });
  const r = await g.find('Rua Barbosa da Silva, 80', { city: RIO, bbox: BOX });
  assert.deepEqual(r, [{ name: 'Rua Barbosa da Silva, Riachuelo, Rio de Janeiro', lat: -22.899, lng: -43.2537 }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].opts.headers['user-agent'], /^NEXA-Broadcast/); assert.doesNotMatch(calls[0].opts.headers['user-agent'], /@/);
  assert.equal(new URL(calls[0].url).searchParams.get('q'), 'Rua Barbosa da Silva, 80, Rio de Janeiro, RJ, Brasil');
  await g.find('Rua Barbosa da Silva, 80', { city: RIO, bbox: BOX });
  assert.equal(calls.length, 1, 'a mesma busca não vai de novo ao serviço');
});

test('sem resultado na caixa tenta sem ela; sem nada, cai no geocodificador antigo; falha de tudo vira erro', async () => {
  const seen = [];
  const getJson = async (url) => { seen.push(new URL(url).searchParams.get('bounded')); return new URL(url).searchParams.get('bounded') ? [] : [{ display_name: 'Rua Y, Niterói', lat: -22.88, lon: -43.1 }]; };
  assert.deepEqual(await createGeocoder({ getJson, gapMs: 0 }).find('Rua Y', { city: RIO, bbox: BOX }), [{ name: 'Rua Y, Niterói', lat: -22.88, lng: -43.1 }]);
  assert.deepEqual(seen, ['1', null]);
  const old = async (q) => [{ nome: q, estado: 'Rio de Janeiro', pais: 'Brasil', lat: -22.9, lon: -43.2 }];
  assert.deepEqual(await createGeocoder({ getJson: async () => [], fallback: old, gapMs: 0 }).find('Riachuelo', { city: RIO }), [{ name: 'Riachuelo, Rio de Janeiro, Brasil', lat: -22.9, lng: -43.2 }]);
  // o serviço de endereços fora do ar: o antigo ainda responde
  assert.equal((await createGeocoder({ getJson: async () => { throw new Error('fora'); }, fallback: old, gapMs: 0 }).find('Centro', { city: RIO })).length, 1);
  await assert.rejects(createGeocoder({ getJson: async () => { throw new Error('fora'); }, gapMs: 0 }).find('Centro', { city: RIO }), /fora/);
  assert.deepEqual(await createGeocoder({ getJson: async () => [], gapMs: 0 }).find('nada', { city: RIO }), [], 'sem resultado e sem erro: lista vazia');
});

test('um pedido por vez, com o intervalo entre eles', async () => {
  let running = 0; let peak = 0; const at = [];
  const getJson = async () => { running++; peak = Math.max(peak, running); at.push(Date.now()); await new Promise((r) => { setTimeout(r, 10); }); running--; return [{ display_name: 'x', lat: 1, lon: 1 }]; };
  const g = createGeocoder({ getJson, gapMs: 60 });
  await Promise.all(['a', 'b', 'c'].map((q) => g.find(`Rua ${q}`)));
  assert.equal(peak, 1, 'nunca dois pedidos juntos');
  assert.ok(at[1] - at[0] >= 50 && at[2] - at[1] >= 50, JSON.stringify(at.map((t) => t - at[0])));
});
