// NEXA Telas, os painéis de senha do §15 no servidor de verdade: as chaves novas gravadas pelo painel e pelo link da
// repartição, o tema (cor e claro/escuro) por repartição e por tela, as duas filas do queue-duo, o nome da fila em cada
// chamada e byService no GET /api/telas/queue; sem a chamada de senha a tela recebe "full".
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, cleanup, api, platformLogin, newTenant, sleep } from './helpers/srv.js';
import { canal, usuario } from './helpers/prefeitura.js'; // DIGITAL ISP: canal ao vivo (HLS) e usuário de permissão limitada

test('Prefeitura §15: layouts de senha novos, tema, duas filas e byService', { timeout: 240000 }, async () => {
  const s = await boot({ PUBLIC_HLS_URL: 'https://hls.exemplo.test', PLATFORM_PUBLIC_URL: 'https://painel.exemplo.test', TELAS_ACTIVATE_PER_IP: '50' });
  try {
    const anon = api(s.base);
    const bearer = (token) => (method, url, body, headers = {}) => anon(method, url, body, { authorization: `Bearer ${token}`, ...headers });
    const P = api(s.base, await platformLogin(s.base));
    const prof = await P('POST', '/api/platform/feature-profiles', { name: 'Prefeitura', code: 'prefeitura', features: { prefeitura: true } });
    assert.equal(prof.status, 201, JSON.stringify(prof.data));
    assert.equal((await P('POST', '/api/platform/plans', { code: 'p-pref', name: 'Prefeitura', priceCents: 0, profileId: prof.data.id, limits: { channels: 1 } })).status, 201);
    const A = await newTenant(P, s.base, { slug: 'pref-l', planCode: 'p-pref', status: 'active' });
    await canal(A.api, 'TV'); // DIGITAL ISP: o canal ao vivo (HLS) no lugar do canal do NEXA
    const post = async (url, body) => { const r = await A.api('POST', url, body); assert.equal(r.status, 201, `${url}: ${JSON.stringify(r.data)}`); return r.data; };
    const activate = async (officeId, name) => {
      const k = await post('/api/prefeitura/keys', { officeId, name });
      const a = await anon('POST', '/api/telas/activate', { key: k.key, device: { model: 'B13', android: '11', appVersion: '1.2.5' } });
      assert.equal(a.status, 200, JSON.stringify(a.data));
      return { ...a.data, call: bearer(a.data.token) };
    };
    const upa = await post('/api/prefeitura/offices', { name: 'UPA Norte', type: 'upa' });
    const escola = await post('/api/prefeitura/offices', { name: 'Escola Sul', type: 'escola' });
    const tUpa = await activate(upa.id, 'UPA, espera');
    const tEsc = await activate(escola.id, 'Escola, pátio');
    const l = await post(`/api/prefeitura/offices/${upa.id}/link`, { password: 'senha-da-upa-2026' });
    const r = await anon('POST', '/api/reparticao/login', { token: l.url.split('/').pop(), password: 'senha-da-upa-2026' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const U = bearer(r.data.session);

    // o painel grava as chaves novas; tema inválido é 400; sem a senha ligada a tela recebe "full"
    assert.equal((await A.api('PATCH', `/api/prefeitura/offices/${upa.id}`, { config: { layout: 'queue-grid', theme: { color: 'verde', mode: 'light' } } })).status, 200);
    assert.equal((await A.api('PATCH', `/api/prefeitura/offices/${escola.id}`, { config: { layout: 'queue-duo' } })).status, 200);
    assert.equal((await A.api('PATCH', `/api/prefeitura/offices/${upa.id}`, { config: { theme: { color: '#123456' } } })).status, 400);
    assert.equal((await A.api('PATCH', `/api/prefeitura/offices/${upa.id}`, { config: { layout: 'queue-nada' } })).status, 400);
    await sleep(2100);
    let cfg = (await tUpa.call('GET', '/api/telas/config')).data;
    assert.equal(cfg.layout, 'queue-grid'); assert.deepEqual(cfg.theme, { color: '#15803d', mode: 'light' }); assert.deepEqual(cfg.queue.pair, []);
    const esc = (await tEsc.call('GET', '/api/telas/config')).data;
    assert.equal(esc.layout, 'full', 'escola sem a chamada de senha'); assert.deepEqual(esc.theme, { color: '#1d4ed8', mode: 'dark' }, 'o tema de fábrica');

    // o link da repartição: o formato e o tema das telas dela; a tela pode ter o seu
    const put = await U('PUT', '/api/reparticao/avisos', { layout: 'queue-duo', theme: { color: 'vinho', mode: 'dark' } });
    assert.equal(put.status, 200, JSON.stringify(put.data)); assert.equal(put.data.layout, 'queue-duo'); assert.deepEqual(put.data.theme, { color: '#9f1239', mode: 'dark' });
    assert.deepEqual((await U('GET', '/api/reparticao/state')).data.theme, { color: '#9f1239', mode: 'dark' }, 'o estado da página traz o tema');
    // filas e as duas do queue-duo
    const svc = async (name, prefix) => { const x = await U('POST', '/api/reparticao/queue/services', { name, prefix }); assert.equal(x.status, 201, JSON.stringify(x.data)); return x.data; };
    const clin = await svc('Clínica geral', 'C'); const tri = await svc('Triagem', 'T'); await svc('Raio X', 'R');
    assert.equal((await U('PUT', '/api/reparticao/queue/config', { pair: [1, 2, 3] })).status, 400);
    assert.equal((await U('PUT', '/api/reparticao/queue/config', { pair: [tri.id, clin.id] })).status, 200);
    await sleep(2100);
    cfg = (await tUpa.call('GET', '/api/telas/config')).data;
    assert.equal(cfg.layout, 'queue-duo'); assert.deepEqual(cfg.queue.pair, [tri.id, clin.id]); assert.deepEqual(cfg.theme, { color: '#9f1239', mode: 'dark' });
    const devs = (await U('GET', '/api/reparticao/devices')).data.devices;
    assert.equal((await U('PATCH', `/api/reparticao/devices/${devs[0].id}`, { config: { theme: { color: 'grafite', mode: 'light' } } })).status, 200);
    await sleep(2100);
    assert.deepEqual((await tUpa.call('GET', '/api/telas/config')).data.theme, { color: '#334155', mode: 'light' }, 'a tela vence a repartição');

    // a chamada leva o nome da fila; byService traz cada fila ativa com a cor, a última chamada e quem espera
    const issue = async (serviceId, risk) => { const x = await U('POST', '/api/reparticao/queue/tickets', { serviceId, risk }); assert.equal(x.status, 201, JSON.stringify(x.data)); return x.data.ticket; };
    await issue(clin.id, 'amarelo'); await issue(clin.id, 'verde'); await issue(tri.id, null);
    const c1 = await U('POST', '/api/reparticao/queue/call', { desk: 'Consultório 2', serviceId: clin.id });
    assert.equal(c1.status, 200, JSON.stringify(c1.data)); assert.equal(c1.data.call.service, 'Clínica geral'); assert.equal(c1.data.call.risk, 'amarelo');
    const q = (await tUpa.call('GET', '/api/telas/queue')).data;
    assert.equal(q.current.service, 'Clínica geral');
    assert.deepEqual(q.byService.map((x) => [x.name, x.color, x.current?.ticket ?? null, x.waiting]), [['Clínica geral', '#2563eb', c1.data.call.ticket, 1], ['Triagem', '#16a34a', null, 1], ['Raio X', '#d97706', null, 0]]);
    assert.equal(q.byService[0].current.risk, 'amarelo', 'a cor do risco também por fila');
    const rep = await U('POST', `/api/reparticao/queue/tickets/${c1.data.ticket.id}/repeat`);
    assert.equal(rep.status, 200, JSON.stringify(rep.data)); assert.equal(rep.data.call.service, 'Clínica geral', 'a repetição também leva a fila');
    // desativar a fila tira do byService
    assert.equal((await U('PATCH', `/api/reparticao/queue/services/${tri.id}`, { active: false })).status, 200);
    assert.deepEqual((await tUpa.call('GET', '/api/telas/queue')).data.byService.map((x) => x.name), ['Clínica geral', 'Raio X']);
  } finally { await s.stop(); cleanup(s.dataDir); }
});
