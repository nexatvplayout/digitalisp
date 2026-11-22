// NEXA Telas, fases 3 e 4 no servidor de verdade (server/telas-senha.js, server/telas-conteudo.js; contrato §7): a chamada de
// senha de ponta a ponta (filas, emissão pela recepção e pelo totem, guichê: chamar, repetir, encaminhar, não compareceu,
// finalizar, risco), a chamada na tela pelo SSE em menos de 2 s, o isolamento (a tela da repartição A nunca recebe a chamada
// da B, nem a de outro cliente), o token do totem (só emite senha; freio por repartição), a numeração que recomeça no dia
// seguinte, o relatório e o CSV, os cartões (limites e o cartão do dia), o clima pela fonte do servidor, os vídeos guardados
// só com o SHA-256, a aprovação da SECOM, o modo eleitoral, a ponte do EAS, a tela desligada e a exclusão.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { boot, cleanup, api, platformLogin, newTenant, sleep } from './helpers/srv.js';

const rawDb = (dataDir) => new DatabaseSync(path.join(dataDir, 'playout.db'), { timeout: 15000 });
const spDay = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const spWeekday = () => ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(new Date())];

/** Abre o text/event-stream da tela e guarda os eventos (e os comentários) com a hora em que chegaram. */
async function openStream(base, token) {
  const ctl = new AbortController();
  const res = await fetch(`${base}/api/telas/queue/stream`, { headers: { authorization: `Bearer ${token}` }, signal: ctl.signal });
  const events = []; let closed = false;
  if (res.status !== 200) return { status: res.status, events, close: () => ctl.abort() };
  (async () => {
    const dec = new TextDecoder(); let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          if (block.startsWith(':')) { events.push({ comment: block.slice(1).trim(), at: Date.now() }); continue; }
          const ev = /^event: (.+)$/m.exec(block)?.[1]; const data = /^data: (.+)$/m.exec(block)?.[1];
          events.push({ event: ev, data: data ? JSON.parse(data) : null, at: Date.now() });
        }
      }
    } catch { /* fechada */ }
    closed = true;
  })();
  const wait = async (pred, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const e = events.find(pred); if (e) return e; await sleep(20); } return null; };
  return { status: 200, type: res.headers.get('content-type'), events, wait, closed: () => closed, close: () => ctl.abort() };
}
/** INMET de mentira (WEATHER_INMET_BASE): a previsão de hoje para qualquer município. */
function fakeInmet() {
  const state = { hits: 0, max: 29 };
  const srv = http.createServer((req, res) => {
    state.hits++;
    const code = req.url.split('/').pop();
    const [y, m, d] = spDay().split('-');
    const p = (resumo) => ({ resumo, temp_min: 21, temp_max: state.max, umidade_min: 50, umidade_max: 90, int_vento: 'Fraco', dir_vento: 'S' });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ [code]: { [`${d}/${m}/${y}`]: { manha: p('Parcialmente nublado'), tarde: p('Parcialmente nublado'), noite: p('Parcialmente nublado') } } }));
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ state, url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) })));
}

test('NEXA Telas fases 3 e 4: senha em tempo real, totem, cartões, clima, vídeos guardados, aprovação, modo eleitoral, EAS e tela desligada', { timeout: 420000 }, async () => {
  const inmet = await fakeInmet();
  const s = await boot({ PUBLIC_HLS_URL: 'https://hls.exemplo.test', PLATFORM_PUBLIC_URL: 'https://painel.exemplo.test', WEATHER_INMET_BASE: inmet.url, TELAS_TOTEM_PER_MIN: '6', TELAS_ACTIVATE_PER_IP: '50' });
  const streams = [];
  try {
    const anon = api(s.base);
    const bearer = (token) => (method, url, body, headers = {}) => anon(method, url, body, { authorization: `Bearer ${token}`, ...headers });
    const P = api(s.base, await platformLogin(s.base));
    const prof = await P('POST', '/api/platform/feature-profiles', { name: 'Prefeitura', code: 'prefeitura', features: { prefeitura: true, eas: true } });
    assert.equal(prof.status, 201, JSON.stringify(prof.data));
    assert.equal((await P('POST', '/api/platform/plans', { code: 'p-pref', name: 'Prefeitura', priceCents: 0, profileId: prof.data.id, limits: { channels: 1 } })).status, 201);
    const A = await newTenant(P, s.base, { slug: 'pref-a', planCode: 'p-pref', status: 'active' });
    const B = await newTenant(P, s.base, { slug: 'pref-b', planCode: 'p-pref', status: 'active' });
    assert.equal((await A.api('POST', '/api/channels', { name: 'TV A', slug: 'pref-a-tv' })).status, 201);
    assert.equal((await B.api('POST', '/api/channels', { name: 'TV B', slug: 'pref-b-tv' })).status, 201);
    const post = async (T, url, body, want = 201) => { const r = await T.api('POST', url, body); assert.equal(r.status, want, `${url}: ${JSON.stringify(r.data)}`); return r.data; };
    const activate = async (T, officeId, name) => {
      const k = await post(T, '/api/prefeitura/keys', { officeId, name });
      const a = await anon('POST', '/api/telas/activate', { key: k.key, device: { model: 'B13', android: '13', appVersion: '1.1.0' } });
      assert.equal(a.status, 200, JSON.stringify(a.data));
      return { ...a.data, call: bearer(a.data.token) };
    };
    const link = async (T, officeId, password) => {
      const l = await post(T, `/api/prefeitura/offices/${officeId}/link`, { password });
      const r = await anon('POST', '/api/reparticao/login', { token: l.url.split('/').pop(), password });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return bearer(r.data.session);
    };
    const db = rawDb(s.dataDir);

    /* ---------------------------------------------------------------- cadastro: UBS, UPA (risco), escola e a prefeitura B */
    const ubs = await post(A, '/api/prefeitura/offices', { name: 'UBS Centro', type: 'ubs' });
    const upa = await post(A, '/api/prefeitura/offices', { name: 'UPA Norte', type: 'upa' });
    const escola = await post(A, '/api/prefeitura/offices', { name: 'Escola Sul', type: 'escola' });
    const defesa = await post(A, '/api/prefeitura/offices', { name: 'Defesa Civil', type: 'defesa-civil' });
    const ubsB = await post(B, '/api/prefeitura/offices', { name: 'UBS da outra cidade', type: 'ubs' });
    assert.equal(ubs.modules.senha, true, 'a chamada de senha deixou de ser "em breve": nasce ligada na UBS');
    assert.equal(escola.modules.senha, false); assert.equal(escola.modules.merenda, true);
    const tUbs = await activate(A, ubs.id, 'UBS, recepção');
    const tUpa = await activate(A, upa.id, 'UPA, espera');
    const tEsc = await activate(A, escola.id, 'Escola, pátio');
    const tB = await activate(B, ubsB.id, 'UBS B');
    const U = await link(A, ubs.id, 'senha-da-ubs-2026');
    const Up = await link(A, upa.id, 'senha-da-upa-2026');
    const E = await link(A, escola.id, 'senha-da-escola-26');
    const Ub = await link(B, ubsB.id, 'senha-da-ubs-b-26');

    /* ---------------------------------------------------------------- configuração: queue no /config e o layout queue */
    let cfg = (await tUbs.call('GET', '/api/telas/config')).data;
    assert.deepEqual(cfg.queue, { enabled: true, voice: true, title: 'Atendimento', showName: false, pair: [] });
    assert.equal(cfg.weather, null); assert.deepEqual(cfg.cards, []); assert.deepEqual(cfg.offline, { items: [], image: null });
    assert.deepEqual((await tEsc.call('GET', '/api/telas/config')).data.queue, { enabled: false, voice: false, title: null, showName: false, pair: [] });
    assert.equal((await A.api('PATCH', `/api/prefeitura/offices/${ubs.id}`, { config: { layout: 'queue', widgets: ['clock', 'queue'] } })).status, 200);
    assert.equal((await A.api('PATCH', `/api/prefeitura/offices/${escola.id}`, { config: { layout: 'queue' } })).status, 200);
    await sleep(2100);
    assert.equal((await tUbs.call('GET', '/api/telas/config')).data.layout, 'queue');
    assert.equal((await tEsc.call('GET', '/api/telas/config')).data.layout, 'full', 'sem a chamada de senha ligada, o layout queue não vai à tela');
    const rev0 = (await tUbs.call('GET', '/api/telas/config')).data.rev;
    assert.equal((await U('PUT', '/api/reparticao/queue/config', { title: 'Recepção da UBS', showName: true, ratio: 2 })).status, 200);
    await sleep(2100);
    cfg = (await tUbs.call('GET', '/api/telas/config')).data;
    assert.deepEqual(cfg.queue, { enabled: true, voice: true, title: 'Recepção da UBS', showName: true, pair: [] }); assert.notEqual(cfg.rev, rev0, 'a configuração da senha muda o rev');

    /* ---------------------------------------------------------------- filas */
    const geral = (await U('POST', '/api/reparticao/queue/services', { name: 'Atendimento geral', prefix: 'a' })).data;
    assert.equal(geral.prefix, 'A'); assert.equal(geral.priority, true);
    const vac = (await U('POST', '/api/reparticao/queue/services', { name: 'Vacina', prefix: 'V', priority: false })).data;
    assert.equal((await U('POST', '/api/reparticao/queue/services', { name: 'Confunde', prefix: 'AP' })).status, 409, '"AP" confunde com a prioritária da fila A');
    assert.equal((await U('POST', '/api/reparticao/queue/services', { name: 'Torta', prefix: 'A1' })).status, 400);
    assert.equal((await U('POST', '/api/reparticao/queue/services', { name: 'X', prefix: 'X' })).status, 400);
    // o painel vê e mexe nas mesmas filas; de outro cliente, 404
    const pv = await A.api('GET', `/api/prefeitura/offices/${ubs.id}/queue`);
    assert.equal(pv.status, 200); assert.deepEqual(pv.data.services.map((x) => x.prefix), ['A', 'V']); assert.equal(pv.data.config.title, 'Recepção da UBS');
    assert.equal((await B.api('GET', `/api/prefeitura/offices/${ubs.id}/queue`)).status, 404);
    assert.equal((await B.api('POST', `/api/prefeitura/offices/${ubs.id}/queue/services`, { name: 'Invasora', prefix: 'Z' })).status, 404);
    assert.equal((await Ub('PATCH', `/api/reparticao/queue/services/${geral.id}`, { name: 'Invadida' })).status, 404, 'a sessão de outra repartição não alcança a fila');
    // escola: módulo desligado
    assert.equal((await E('POST', '/api/reparticao/queue/tickets', { serviceId: geral.id })).status, 403);
    const svcB = (await Ub('POST', '/api/reparticao/queue/services', { name: 'Geral B', prefix: 'A' })).data;

    /* ---------------------------------------------------------------- tempo real: a chamada chega à tela em menos de 2 s */
    const sUbs = await openStream(s.base, tUbs.token); const sUpa = await openStream(s.base, tUpa.token); const sB = await openStream(s.base, tB.token);
    streams.push(sUbs, sUpa, sB);
    assert.equal(sUbs.status, 200); assert.match(sUbs.type, /text\/event-stream/);
    assert.equal((await openStream(s.base, 'A'.repeat(43))).status, 401, 'sem token válido não há stream');
    const first = await sUbs.wait((e) => e.event === 'state');
    assert.deepEqual(first.data, { current: null, last: [], waiting: { total: 0, byRisk: null, avgWaitMin: null }, serving: [],
      byService: [{ id: geral.id, name: 'Atendimento geral', color: '#2563eb', current: null, waiting: 0 }, { id: vac.id, name: 'Vacina', color: '#16a34a', current: null, waiting: 0 }] }, 'ao conectar: o estado inteiro (com as filas do §15)');
    // emissão pela recepção: o nome inteiro nunca é guardado
    const issue = async (S2, body, want = 201) => { const r = await S2('POST', '/api/reparticao/queue/tickets', body); assert.equal(r.status, want, JSON.stringify(r.data)); return r.data.ticket; };
    const n1 = await issue(U, { serviceId: geral.id, name: 'Maria Aparecida da Silva' });
    assert.equal(n1.code, 'A001'); assert.equal(n1.name, 'Maria S.');
    const n2 = await issue(U, { serviceId: geral.id }); const n3 = await issue(U, { serviceId: geral.id });
    const p1 = await issue(U, { serviceId: geral.id, priority: 1, name: 'José' }); const p2 = await issue(U, { serviceId: geral.id, priority: 2 });
    assert.deepEqual([n2.code, n3.code, p1.code, p2.code], ['A002', 'A003', 'AP001', 'AP002']);
    assert.equal((await issue(U, { serviceId: vac.id })).code, 'V001');
    assert.equal((await U('POST', '/api/reparticao/queue/tickets', { serviceId: vac.id, priority: 1 })).status, 400, 'fila sem prioritária');
    assert.equal((await U('POST', '/api/reparticao/queue/tickets', { serviceId: svcB.id })).status, 404, 'fila de outro cliente');
    assert.equal((await U('POST', '/api/reparticao/queue/tickets', { serviceId: geral.id, risk: 'verde' })).status, 400, 'UBS não usa a classificação de risco');
    const dump = JSON.stringify(db.prepare('SELECT * FROM telas_queue_tickets').all());
    assert.ok(!dump.includes('Aparecida') && !dump.includes('Silva'), 'só o nome reduzido entra no banco');
    const st = await sUbs.wait((e) => e.event === 'state' && e.data.waiting.total === 6);
    assert.ok(st, 'o state chega quando o waiting muda'); assert.equal(st.data.waiting.byRisk, null);
    // a ordem prevista: 80+ primeiro, depois 2 normais para cada prioritária (a recepção vê a fila na ordem de chamada)
    const ov = (await U('GET', '/api/reparticao/queue')).data;
    assert.deepEqual(ov.waiting.map((t) => t.code), ['AP002', 'A001', 'A002', 'AP001', 'A003', 'V001']);

    const t0 = Date.now();
    const c1 = await U('POST', '/api/reparticao/queue/call', { desk: 'Guichê 3', serviceId: geral.id });
    assert.equal(c1.status, 200, JSON.stringify(c1.data)); assert.equal(c1.data.ticket.code, 'AP002');
    const ev1 = await sUbs.wait((e) => e.event === 'call' && e.data.ticket === 'AP002', 2000);
    assert.ok(ev1, 'a chamada chegou à tela');
    assert.ok(ev1.at - t0 < 2000, `a chamada levou ${ev1.at - t0} ms (o alvo é menos de 2 s)`);
    assert.deepEqual(Object.keys(ev1.data).sort(), ['at', 'desk', 'id', 'name', 'priority', 'risk', 'service', 'ticket']);
    assert.equal(ev1.data.desk, 'Guichê 3'); assert.equal(ev1.data.priority, true); assert.equal(ev1.data.name, null);
    assert.equal(ev1.data.risk, null, '§13: UBS não usa a classificação de risco');
    // repetir: o MESMO id, com repeat: true
    const rp = await U('POST', `/api/reparticao/queue/tickets/${p2.id}/repeat`);
    assert.equal(rp.status, 200);
    const ev1r = await sUbs.wait((e) => e.event === 'call' && e.data.repeat === true, 2000);
    assert.equal(ev1r.data.id, ev1.data.id); assert.equal(ev1r.data.ticket, 'AP002');
    // próxima: A001 (com o nome reduzido, porque a repartição ligou "mostrar o nome"); a AP002 do guichê CONTINUA em atendimento
    // (14/11, do dono: chamar a próxima não encerra a anterior; ela fica embaixo na TV até Finalizar)
    const c2 = (await U('POST', '/api/reparticao/queue/call', { desk: 'Guichê 3', serviceId: geral.id })).data;
    assert.equal(c2.ticket.code, 'A001'); assert.equal(c2.call.name, 'Maria S.');
    assert.equal(db.prepare('SELECT status FROM telas_queue_tickets WHERE id = ?').get(p2.id).status, 'called');
    assert.equal((await U('POST', '/api/reparticao/queue/call', { desk: 'Guichê 1', serviceId: geral.id })).data.ticket.code, 'A002');
    assert.equal((await U('POST', '/api/reparticao/queue/call', { desk: 'Guichê 2', serviceId: geral.id })).data.ticket.code, 'AP001', 'depois de 2 normais, a prioritária');
    // GET /api/telas/queue: a atual, as últimas (sem a atual, a mais nova primeiro) e quem espera
    const q = (await tUbs.call('GET', '/api/telas/queue')).data;
    assert.equal(q.current.ticket, 'AP001'); assert.equal(q.current.name, 'José');
    assert.deepEqual(q.last.map((x) => x.ticket), ['A002', 'A001', 'AP002']);
    assert.deepEqual(q.waiting, { total: 2, byRisk: null, avgWaitMin: 0 });
    // §12: quem ainda está em atendimento (sem a atual, a mais nova primeiro), com a AP002 que o Guichê 3 chamou antes da A001
    assert.deepEqual(q.serving.map((x) => [x.ticket, x.desk]), [['A002', 'Guichê 1'], ['A001', 'Guichê 3'], ['AP002', 'Guichê 3']]);
    assert.equal((await U('POST', `/api/reparticao/queue/tickets/${p2.id}/finish`)).status, 200, 'a anterior do guichê sai com Finalizar');
    assert.deepEqual(Object.keys(q.serving[0]).sort(), ['at', 'desk', 'id', 'name', 'priority', 'risk', 'service', 'ticket']);
    assert.ok(await sUbs.wait((e) => e.event === 'state' && e.data.serving?.map((x) => x.ticket).join() === 'A002,A001', 2000), 'o state leva o serving quando muda');
    // não compareceu, encaminhar (mantém a prioridade), finalizar
    assert.equal((await U('POST', `/api/reparticao/queue/tickets/${n2.id}/noshow`)).status, 200);
    assert.ok(await sUbs.wait((e) => e.event === 'state' && e.data.serving?.map((x) => x.ticket).join() === 'A001', 2000), 'não compareceu: sai do serving e vai um state');
    assert.equal((await U('POST', `/api/reparticao/queue/tickets/${n1.id}/finish`)).status, 200);
    assert.ok(await sUbs.wait((e) => e.event === 'state' && e.data.serving?.length === 0 && e.data.waiting.total === 2, 2000), 'finalizar: sai do serving e vai um state (sem mudar o waiting)');
    assert.deepEqual((await tUbs.call('GET', '/api/telas/queue')).data.serving, []);
    assert.equal((await U('POST', `/api/reparticao/queue/tickets/${n2.id}/noshow`)).status, 409);
    const fw = await U('POST', `/api/reparticao/queue/tickets/${p1.id}/forward`, { serviceId: vac.id });
    assert.equal(fw.status, 200); assert.equal(fw.data.ticket.code, 'AP001'); assert.equal(fw.data.ticket.priority, 1); assert.equal(fw.data.ticket.status, 'waiting'); assert.equal(fw.data.ticket.serviceId, vac.id);
    assert.equal((await U('POST', `/api/reparticao/queue/tickets/${p1.id}/forward`, { serviceId: svcB.id })).status, 404);
    // na fila da vacina: a encaminhada (prioritária) passa à frente da V001 e é uma chamada NOVA (outro id)
    const c5 = (await U('POST', '/api/reparticao/queue/call', { desk: 'Sala de vacina', serviceId: vac.id })).data;
    assert.equal(c5.ticket.code, 'AP001'); assert.ok(c5.call.id > ev1.data.id); assert.equal(c5.call.repeat, undefined);
    // voltar à fila (14/11): a senha chamada volta a esperar e pode ser chamada de novo; esperando, não volta de novo
    assert.equal((await U('POST', `/api/reparticao/queue/tickets/${p1.id}/requeue`)).status, 200);
    assert.equal(db.prepare('SELECT status FROM telas_queue_tickets WHERE id = ?').get(p1.id).status, 'waiting');
    assert.equal((await U('POST', `/api/reparticao/queue/tickets/${p1.id}/requeue`)).status, 409);
    assert.equal((await U('POST', '/api/reparticao/queue/call', { desk: 'Sala de vacina', ticketId: p1.id })).data.ticket.code, 'AP001', 'chamada de novo pelo "Chamar esta"');
    assert.equal((await U('POST', `/api/reparticao/queue/tickets/${p1.id}/finish`)).status, 200);
    assert.equal((await U('POST', '/api/reparticao/queue/call', {})).status, 400, 'o guichê precisa de nome');
    assert.equal((await Ub('POST', `/api/reparticao/queue/tickets/${n3.id}/cancel`)).status, 404, 'senha de outra repartição');
    assert.equal((await Ub('POST', '/api/reparticao/queue/call', { desk: 'Guichê B' })).status, 404, 'ninguém esperando na B');

    /* ---------------------------------------------------------------- isolamento: A nunca recebe B, UBS nunca recebe UPA */
    const tri = (await Up('POST', '/api/reparticao/queue/services', { name: 'Triagem', prefix: 'T' })).data;
    const med = (await Up('POST', '/api/reparticao/queue/services', { name: 'Atendimento médico', prefix: 'M', priority: false })).data;
    const u1 = (await Up('POST', '/api/reparticao/queue/tickets', { serviceId: tri.id })).data.ticket;
    const u2 = (await Up('POST', '/api/reparticao/queue/tickets', { serviceId: tri.id })).data.ticket;
    const u3 = (await Up('POST', '/api/reparticao/queue/tickets', { serviceId: tri.id, risk: 'amarelo' })).data.ticket;
    assert.equal((await Ub('POST', '/api/reparticao/queue/tickets', { serviceId: svcB.id })).data.ticket.code, 'A001');
    assert.equal((await Ub('POST', '/api/reparticao/queue/call', { desk: 'Guichê B' })).data.ticket.code, 'A001');
    assert.ok(await sB.wait((e) => e.event === 'call' && e.data.desk === 'Guichê B', 2000), 'a tela da B recebe a chamada da B');
    // triagem: a cor; encaminhar mantém o risco; a ordem é a da cor (vermelho antes do amarelo, que chegou antes)
    assert.equal((await Up('POST', `/api/reparticao/queue/tickets/${u1.id}/risk`, { risk: 'verde' })).status, 200);
    assert.equal((await Up('POST', `/api/reparticao/queue/tickets/${u2.id}/risk`, { risk: 'vermelho', name: 'Paulo Roberto Lima' })).data.ticket.name, 'Paulo L.');
    assert.equal((await Up('POST', `/api/reparticao/queue/tickets/${u2.id}/risk`, { risk: 'roxo' })).status, 400);
    for (const t of [u1, u2, u3]) assert.equal((await Up('POST', `/api/reparticao/queue/tickets/${t.id}/forward`, { serviceId: med.id })).data.ticket.risk, t === u1 ? 'verde' : t === u2 ? 'vermelho' : 'amarelo');
    const qUpa = (await tUpa.call('GET', '/api/telas/queue')).data;
    assert.deepEqual(qUpa.waiting.byRisk, { vermelho: 1, laranja: 0, amarelo: 1, verde: 1, azul: 0 }); assert.equal(qUpa.waiting.total, 3);
    const order = [];
    for (let i = 0; i < 3; i++) order.push((await Up('POST', '/api/reparticao/queue/call', { desk: 'Consultório 2', serviceId: med.id })).data.ticket.code);
    assert.deepEqual(order, [u2.code, u3.code, u1.code], 'vermelho, amarelo, verde');
    assert.ok(await sUpa.wait((e) => e.event === 'call' && e.data.desk === 'Consultório 2', 2000));
    await sleep(300);
    const calls = (st2) => st2.events.filter((e) => e.event === 'call');
    assert.ok(calls(sUbs).every((e) => ['Guichê 3', 'Guichê 1', 'Guichê 2', 'Sala de vacina'].includes(e.data.desk)), 'a tela da UBS só recebeu chamadas da UBS');
    assert.ok(calls(sUpa).every((e) => e.data.desk === 'Consultório 2'), 'a tela da UPA só recebeu chamadas da UPA');
    assert.ok(calls(sB).every((e) => e.data.desk === 'Guichê B'), 'a tela do outro cliente só recebeu as dele');
    assert.ok(!JSON.stringify(sB.events).includes('Maria') && !JSON.stringify(sUpa.events).includes('Guichê 3'));
    assert.equal(calls(sUpa).find((e) => e.data.ticket === u2.code).data.name, null, 'a UPA não ligou "mostrar o nome"');
    // §13: a cor do risco vai na chamada da UPA (vermelho, amarelo, verde, na ordem chamada) e no estado
    assert.deepEqual([u2, u3, u1].map((t) => calls(sUpa).find((e) => e.data.ticket === t.code).data.risk), ['vermelho', 'amarelo', 'verde']);
    const qRisk = (await tUpa.call('GET', '/api/telas/queue')).data;
    assert.equal(qRisk.current.risk, 'verde'); assert.deepEqual(qRisk.serving.map((x) => x.risk), ['amarelo', 'vermelho']);
    assert.equal((await tB.call('GET', '/api/telas/queue')).data.current.ticket, 'A001');
    // no máximo 2 conexões por tela: a 3ª derruba a mais antiga; a tela revogada perde a conexão
    const x1 = await openStream(s.base, tEsc.token); const x2 = await openStream(s.base, tEsc.token); const x3 = await openStream(s.base, tEsc.token);
    streams.push(x1, x2, x3);
    await sleep(400);
    assert.equal(x1.closed(), true, 'a conexão mais antiga da tela caiu'); assert.equal(x2.closed(), false); assert.equal(x3.closed(), false);
    assert.equal((await A.api('POST', `/api/prefeitura/devices/${tEsc.deviceId}/revoke`)).status, 200);
    await sleep(400);
    assert.equal(x2.closed() && x3.closed(), true, 'revogar a tela fecha o tempo real dela');
    assert.equal((await tEsc.call('GET', '/api/telas/queue')).status, 401);

    /* ---------------------------------------------------------------- totem: token próprio, só emite senha, com freio */
    assert.equal((await E('POST', '/api/reparticao/queue/totem')).status, 403, 'sem a chamada de senha não há totem');
    const tot = await U('POST', '/api/reparticao/queue/totem');
    assert.equal(tot.status, 201); assert.match(tot.data.url, /^https:\/\/painel\.exemplo\.test\/reparticao\/[A-Za-z0-9_-]{43}\/totem$/);
    const totemToken = tot.data.url.split('/').at(-2);
    assert.equal(db.prepare('SELECT totem_hash FROM telas_office_extras WHERE office_id = ?').get(ubs.id).totem_hash, createHash('sha256').update(totemToken).digest('hex'), 'no banco só o SHA-256 do token do totem');
    const page = await fetch(`${s.base}/reparticao/${totemToken}/totem`);
    assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /default-src 'none'/); assert.match(await page.text(), /totem\.js/);
    for (const f of ['totem.js', 'totem.css']) assert.equal((await fetch(`${s.base}/reparticao/${f}`)).status, 200, f);
    const Tm = bearer(totemToken);
    const info = await Tm('GET', '/api/totem');
    assert.equal(info.status, 200); assert.deepEqual(info.data.services.map((x) => x.name), ['Atendimento geral', 'Vacina']); assert.equal(info.data.office, 'UBS Centro');
    assert.ok(!/waiting|Maria|desk/.test(JSON.stringify(info.data)), 'o totem não vê a fila');
    const tk = await Tm('POST', '/api/totem/tickets', { serviceId: geral.id, priority: 1, name: 'Fulano de Tal', risk: 'vermelho' });
    assert.equal(tk.status, 201, JSON.stringify(tk.data)); assert.deepEqual(Object.keys(tk.data).sort(), ['at', 'office', 'priority', 'service', 'ticket', 'title']); assert.equal(tk.data.ticket, 'AP003');
    const row = db.prepare("SELECT * FROM telas_queue_tickets WHERE code = 'AP003' AND office_id = ?").get(ubs.id);
    assert.equal(row.name, null); assert.equal(row.risk, null); assert.equal(row.origin, 'totem', 'o totem não registra nome nem risco');
    // o token do totem não abre nada além do totem; o link de controle e o token da tela não emitem pelo totem
    for (const [m, url] of [['GET', '/api/reparticao/state'], ['GET', '/api/reparticao/queue'], ['POST', '/api/reparticao/queue/call'], ['GET', '/api/telas/config'], ['GET', '/api/telas/queue']]) assert.equal((await Tm(m, url, m === 'POST' ? { desk: 'x' } : undefined)).status, 401, `${m} ${url} com o token do totem`);
    assert.equal((await anon('POST', '/api/reparticao/login', { token: totemToken, password: 'senha-da-ubs-2026' })).status, 401, 'o token do totem não é o link de controle');
    assert.equal((await bearer(tUbs.token)('POST', '/api/totem/tickets', { serviceId: geral.id })).status, 401);
    assert.equal((await anon('GET', '/api/totem')).status, 401);
    assert.equal((await Tm('POST', '/api/totem/tickets', { serviceId: svcB.id })).status, 404, 'fila de outra repartição');
    // freio: 6 por minuto nesta repartição (TELAS_TOTEM_PER_MIN do teste; em produção 30)
    const codes = [];
    for (let i = 0; i < 8; i++) codes.push((await Tm('POST', '/api/totem/tickets', { serviceId: vac.id })).status);
    assert.deepEqual(codes, [201, 201, 201, 201, 429, 429, 429, 429], 'já tinham saído 2 (a AP003 e a recusada por fila): o freio conta o pedido');
    // gerar de novo derruba o endereço anterior; desligar derruba tudo
    const tot2 = (await A.api('POST', `/api/prefeitura/offices/${ubs.id}/queue/totem`)).data.url.split('/').at(-2);
    assert.equal((await Tm('GET', '/api/totem')).status, 401); assert.equal((await bearer(tot2)('GET', '/api/totem')).status, 200);
    assert.equal((await U('DELETE', '/api/reparticao/queue/totem')).status, 200);
    assert.equal((await bearer(tot2)('GET', '/api/totem')).status, 401);

    /* ---------------------------------------------------------------- o dia seguinte: a numeração recomeça e a fila de ontem não conta */
    const yesterday = spDay(Date.now() - 86400000);
    db.prepare('UPDATE telas_queue_tickets SET day = ? WHERE office_id = ?').run(yesterday, ubs.id);
    db.prepare('UPDATE telas_queue_calls SET day = ? WHERE office_id = ?').run(yesterday, ubs.id);
    const q2 = (await tUbs.call('GET', '/api/telas/queue')).data;
    assert.deepEqual({ ...q2, byService: q2.byService.map((x) => [x.name, x.current, x.waiting]) }, { current: null, last: [], waiting: { total: 0, byRisk: null, avgWaitMin: null }, serving: [], byService: [['Atendimento geral', null, 0], ['Vacina', null, 0]] }, 'dia novo: painel limpo (as filas sem chamada)');
    assert.equal((await issue(U, { serviceId: geral.id })).code, 'A001', 'a numeração recomeça do 001');
    assert.equal((await issue(U, { serviceId: geral.id, priority: 1 })).code, 'AP001');
    assert.equal((await U('POST', `/api/reparticao/queue/tickets/${n3.id}/cancel`)).status, 404, 'a senha de ontem não é mais alcançada');
    // relatório: por repartição, fila e dia; o CSV; de outro cliente nada
    const rep = await A.api('GET', `/api/prefeitura/queue/report?from=${yesterday}&to=${spDay()}`);
    assert.equal(rep.status, 200, JSON.stringify(rep.data));
    const rowG = rep.data.rows.find((r) => r.day === yesterday && r.service === 'Atendimento geral');
    assert.ok(rowG, JSON.stringify(rep.data.rows)); assert.equal(rowG.office, 'UBS Centro'); assert.equal(rowG.issued, 5); assert.equal(rowG.noshow, 1); assert.equal(rowG.priority, 2);
    assert.ok(rowG.avgWaitMin != null && rowG.avgWaitMin >= 0);
    assert.ok(rep.data.rows.some((r) => r.office === 'UPA Norte' && r.service === 'Atendimento médico' && r.issued === 3));
    assert.ok(rep.data.rows.every((r) => r.office !== 'UBS da outra cidade'));
    const csv = await A.api('GET', `/api/prefeitura/queue/report?from=${yesterday}&to=${spDay()}&format=csv`);
    assert.match(csv.headers.get('content-type'), /text\/csv/); assert.match(csv.data, /Dia;Repartição;Fila;Letra;Senhas emitidas/); assert.match(csv.data, /UBS Centro;Atendimento geral;A;5/);
    assert.equal((await B.api('GET', '/api/prefeitura/queue/report')).data.rows.length, 1);
    assert.equal((await A.api('GET', `/api/prefeitura/queue/report?officeId=${ubsB.id}`)).status, 404);

    /* ---------------------------------------------------------------- cartões: limites, o cartão do dia e o isolamento */
    const wd = spWeekday();
    const c = async (S2, body, want = 201) => { const r = await S2('POST', '/api/reparticao/cards', body); assert.equal(r.status, want, JSON.stringify(r.data)); return r.data; };
    const E2 = await link(A, escola.id, 'senha-da-escola-27'); // a tela da escola foi revogada; o link continua
    const tEsc2 = await activate(A, escola.id, 'Escola, pátio 2');
    const hoje = await c(E2, { kind: 'merenda', lines: 'Arroz, feijão, frango\nFruta: banana', weekday: wd });
    assert.equal(hoje.title, 'Merenda de hoje');
    await c(E2, { kind: 'merenda', title: 'Outro dia', lines: ['Macarrão'], weekday: (wd + 1) % 7 });
    await c(E2, { kind: 'unidade', title: `${'A'.repeat(70)}`, lines: [`${'b'.repeat(100)}`, 'Secretaria: 8h às 17h\u0000'], sort: -1, seconds: 20 });
    await c(E2, { kind: 'calendario', lines: ['Reunião de pais'], dateFrom: '2020-01-01', dateTo: '2020-01-02' });
    assert.equal((await E2('POST', '/api/reparticao/cards', { kind: 'vagas', lines: ['x'] })).status, 403, 'vagas é módulo do SINE, não da escola');
    assert.equal((await E2('POST', '/api/reparticao/cards', { kind: 'merenda', lines: Array(9).fill('x') })).status, 400);
    assert.equal((await U('PATCH', `/api/reparticao/cards/${hoje.id}`, { title: 'Invadido' })).status, 404, 'cartão de outra repartição');
    assert.equal((await B.api('GET', `/api/prefeitura/offices/${escola.id}/cards`)).status, 404);
    assert.equal((await A.api('GET', `/api/prefeitura/offices/${escola.id}/cards`)).data.cards.length, 4);
    await sleep(2100);
    cfg = (await tEsc2.call('GET', '/api/telas/config')).data;
    assert.deepEqual(cfg.cards.map((x) => x.title), ['A'.repeat(60), 'Merenda de hoje'], 'só os de hoje: a merenda do outro dia e o calendário vencido não vão');
    assert.deepEqual(cfg.cards[1], { id: `merenda-${hoje.id}`, title: 'Merenda de hoje', lines: ['Arroz, feijão, frango', 'Fruta: banana'], seconds: 10 });
    assert.equal(cfg.cards[0].lines[0].length, 90); assert.equal(cfg.cards[0].lines[1], 'Secretaria: 8h às 17h'); assert.equal(cfg.cards[0].seconds, 20);
    assert.deepEqual((await tUbs.call('GET', '/api/telas/config')).data.cards, [], 'a UBS não recebe os cartões da escola');

    /* ---------------------------------------------------------------- clima: a fonte do servidor, a cidade da prefeitura */
    assert.equal((await A.api('PUT', '/api/prefeitura/defaults', { cidade: { uf: 'RJ', city: 'Cidade Inexistente' } })).status, 400);
    const dc = await A.api('PUT', '/api/prefeitura/defaults', { cidade: { uf: 'RJ', city: 'Niterói' } });
    assert.equal(dc.status, 200, JSON.stringify(dc.data)); assert.deepEqual(dc.data.cidade, { uf: 'RJ', city: 'Niterói', ibge: 3303302 });
    await sleep(2100);
    await tUbs.call('GET', '/api/telas/config'); // a 1ª configuração dispara a busca em segundo plano (não espera o provedor)
    let wth = null;
    for (let i = 0; i < 40 && !wth; i++) { await sleep(250); wth = (await tUbs.call('GET', '/api/telas/config')).data.weather; }
    assert.ok(wth, 'o clima chegou'); assert.deepEqual(Object.keys(wth).sort(), ['at', 'city', 'condition', 'icon', 'tempC']);
    assert.equal(wth.city, 'Niterói'); assert.equal(wth.tempC, 29); assert.equal(wth.icon, 'partly'); assert.equal(wth.condition, 'Parcialmente nublado');
    // a previsão muda lá fora: a tela segue com o mesmo objeto e o mesmo rev (no máximo uma troca a cada 30 min)
    inmet.state.max = 35; const hits = inmet.state.hits;
    const revW = (await tUbs.call('GET', '/api/telas/config')).data.rev;
    await sleep(2500);
    const again = (await tUbs.call('GET', '/api/telas/config')).data;
    assert.equal(again.rev, revW); assert.deepEqual(again.weather, wth); assert.equal(inmet.state.hits, hits, 'nenhuma consulta nova ao provedor');
    assert.equal((await tB.call('GET', '/api/telas/config')).data.weather, null, 'prefeitura sem cidade: sem clima');

    /* ---------------------------------------------------------------- vídeos guardados: só com o SHA-256 calculado */
    const mediaDir = path.join(s.dataDir, 'media');
    const bytes = randomBytes(300_000);
    fs.writeFileSync(path.join(mediaDir, 'institucional-a.mp4'), bytes); fs.writeFileSync(path.join(mediaDir, 'vacina-a.mp4'), Buffer.from('vídeo da vacina'));
    const ins = db.prepare("INSERT INTO media(title, filename, kind, duration, size, created_at, tenant_id, status) VALUES(?,?,?,?,?,?,?,'ready')");
    const m1 = Number(ins.run('Vídeo institucional', 'institucional-a.mp4', 'program', 30, bytes.length, Date.now(), A.id).lastInsertRowid);
    const m2 = Number(ins.run('Campanha de vacinação', 'vacina-a.mp4', 'program', 20, Buffer.byteLength('vídeo da vacina'), Date.now(), A.id).lastInsertRowid);
    const m3 = Number(ins.run('Sumido do disco', 'nao-existe.mp4', 'program', 20, 1234, Date.now(), A.id).lastInsertRowid);
    const mB = Number(ins.run('Vídeo da outra prefeitura', 'video-b.mp4', 'program', 20, 10, Date.now(), B.id).lastInsertRowid);
    const lib = (await A.api('GET', '/api/prefeitura/offline')).data;
    assert.deepEqual(lib.media.map((m) => m.title).sort(), ['Campanha de vacinação', 'Sumido do disco', 'Vídeo institucional'], 'só os vídeos prontos DESTE cliente');
    assert.equal((await A.api('PUT', '/api/prefeitura/offline', { scope: 'default', items: [{ mediaId: mB }] })).status, 400, 'vídeo de outro cliente = inexistente');
    assert.equal((await A.api('PUT', '/api/prefeitura/offline', { scope: 'office', scopeId: ubsB.id, items: [] })).status, 404);
    assert.equal((await A.api('PUT', '/api/prefeitura/offline', { scope: 'default', items: Array.from({ length: 11 }, () => ({ mediaId: m1 })) })).status, 400);
    assert.equal((await A.api('PUT', '/api/prefeitura/offline', { scope: 'default', items: [{ mediaId: m2 }, { mediaId: m3 }] })).status, 200);
    assert.equal((await A.api('PUT', '/api/prefeitura/offline', { scope: 'office', scopeId: ubs.id, items: [{ mediaId: m1, class: 'institucional' }] })).status, 200);
    let off = [];
    for (let i = 0; i < 60 && off.length < 2; i++) { await sleep(500); off = (await tUbs.call('GET', '/api/telas/config')).data.offline.items; }
    assert.deepEqual(off, [
      { url: 'https://painel.exemplo.test/media/vacina-a.mp4', sha256: createHash('sha256').update('vídeo da vacina').digest('hex'), bytes: Buffer.byteLength('vídeo da vacina') },
      { url: 'https://painel.exemplo.test/media/institucional-a.mp4', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length },
    ], 'o padrão da prefeitura e depois a repartição; o vídeo sem hash (arquivo sumido) não vai');
    assert.equal((await tUpa.call('GET', '/api/telas/config')).data.offline.items.length, 1, 'a UPA só recebe o do padrão');
    assert.deepEqual((await tB.call('GET', '/api/telas/config')).data.offline.items, []);
    const libNow = (await A.api('GET', '/api/prefeitura/offline')).data.items;
    assert.equal(libNow.find((x) => x.mediaId === m3).hash, 'pending'); assert.equal(libNow.find((x) => x.mediaId === m1).hash, 'ok');
    // o arquivo trocado (outro tamanho): o hash antigo deixa de valer até o novo
    db.prepare('UPDATE media SET size = size + 1 WHERE id = ?').run(m2);
    await sleep(2100);
    assert.ok(!(await tUbs.call('GET', '/api/telas/config')).data.offline.items.some((x) => /vacina/.test(x.url)), 'hash de outro tamanho não é mandado');

    /* ---------------------------------------------------------------- aprovação da SECOM (desligada de fábrica) */
    const Dc = await link(A, defesa.id, 'senha-da-defesa-26');
    const d0 = (await A.api('GET', '/api/prefeitura')).data.defaults;
    assert.equal(d0.approval, false); assert.equal(d0.eas, true); assert.equal(d0.electoral, null);
    const direct = await U('PUT', '/api/reparticao/avisos', { items: ['Aviso direto, sem aprovação.'] });
    assert.equal(direct.status, 200); assert.deepEqual(direct.data.items, ['Aviso direto, sem aprovação.']);
    assert.equal((await A.api('PUT', '/api/prefeitura/defaults', { approval: true })).data.approval, true);
    await sleep(2100);
    // avisos, cartão e alerta pelo link: esperam
    const pa = await U('PUT', '/api/reparticao/avisos', { items: ['Campanha de vacinação até sexta.', '[institucional] Nova ala inaugurada pelo prefeito.'] });
    assert.equal(pa.status, 202, JSON.stringify(pa.data)); assert.equal(pa.data.pending, true); assert.deepEqual(pa.data.items, ['Aviso direto, sem aprovação.'], 'o que está nas telas fica como está');
    const pc = await E2('POST', '/api/reparticao/cards', { kind: 'unidade', title: 'Matrículas', lines: ['De 1 a 15 de dezembro'] });
    assert.equal(pc.status, 202); assert.equal(pc.data.pending, true);
    const pe = await E2('PATCH', `/api/reparticao/cards/${hoje.id}`, { lines: ['Sopa de legumes'] });
    assert.equal(pe.status, 202);
    const pal = await U('POST', '/api/reparticao/alerts', { title: 'Falta de água', text: 'Atendimento suspenso.', level: 'warn', durationMin: 30, scope: { kind: 'office' } });
    assert.equal(pal.status, 202, JSON.stringify(pal.data)); assert.equal(pal.data.pending, true);
    // Defesa Civil: sai na hora, marcado
    const dAl = await Dc('POST', '/api/reparticao/alerts', { title: 'Defesa Civil', text: 'Chuva forte.', level: 'critical', confirmExtreme: true, durationMin: 30, scope: { kind: 'city' } });
    assert.equal(dAl.status, 201, JSON.stringify(dAl.data)); assert.equal(dAl.data.alert.flag, 'sem-aprovacao');
    await sleep(2100);
    let hb = (await tUbs.call('POST', '/api/telas/heartbeat', { state: 'playing' })).data;
    assert.deepEqual(hb.alerts.map((x) => x.title), ['Defesa Civil'], 'o da Defesa Civil já está na tela; o da UBS espera');
    assert.deepEqual((await tUbs.call('GET', '/api/telas/config')).data.ticker.items, ['Aviso direto, sem aprovação.']);
    assert.equal((await tEsc2.call('GET', '/api/telas/config')).data.cards.length, 2);
    // a repartição vê o que espera; o painel escreve direto (sem esperar)
    const stU = (await U('GET', '/api/reparticao/state')).data;
    assert.equal(stU.approval.on, true); assert.deepEqual(stU.approval.requests.map((x) => `${x.kind}:${x.status}`).sort(), ['alert:pending', 'avisos:pending']);
    assert.equal((await A.api('POST', `/api/prefeitura/offices/${escola.id}/cards`, { kind: 'unidade', title: 'Do painel', lines: ['direto'] })).status, 201);
    const list = (await A.api('GET', '/api/prefeitura/approvals')).data;
    assert.equal(list.enabled, true); assert.equal(list.pending.length, 4);
    assert.deepEqual(list.pending.map((x) => x.kind), ['avisos', 'card', 'card', 'alert']);
    assert.equal(list.pending[0].office, 'UBS Centro'); assert.equal(list.pending[0].requestedBy, 'repartição: UBS Centro'); assert.equal(list.pending[0].class, 'institucional');
    assert.ok(list.history.some((x) => x.status === 'auto' && /Defesa Civil/.test(x.summary)), 'o alerta que saiu sem aprovação fica marcado na lista');
    assert.equal((await A.api('GET', '/api/prefeitura/badge')).data.approvals, 4);
    assert.equal((await B.api('GET', '/api/prefeitura/approvals')).data.pending.length, 0);
    const [aAv, aNew, aEdit, aAl] = list.pending;
    assert.equal((await B.api('POST', `/api/prefeitura/approvals/${aAv.id}/approve`)).status, 404, 'pedido de outro cliente');
    assert.equal((await A.api('POST', `/api/prefeitura/approvals/${aAv.id}/approve`)).status, 200);
    assert.equal((await A.api('POST', `/api/prefeitura/approvals/${aAv.id}/reject`)).status, 409, 'já decidido');
    assert.equal((await A.api('POST', `/api/prefeitura/approvals/${aNew.id}/reject`, { note: 'Fora do padrão.' })).status, 200);
    assert.equal((await A.api('POST', `/api/prefeitura/approvals/${aEdit.id}/approve`)).status, 200);
    assert.equal((await A.api('POST', `/api/prefeitura/approvals/${aAl.id}/approve`)).status, 200);
    await sleep(2100);
    assert.deepEqual((await tUbs.call('GET', '/api/telas/config')).data.ticker.items, ['Campanha de vacinação até sexta.', 'Nova ala inaugurada pelo prefeito.']);
    const cardsNow = (await tEsc2.call('GET', '/api/telas/config')).data.cards;
    assert.deepEqual(cardsNow.find((x) => x.id === `merenda-${hoje.id}`).lines, ['Sopa de legumes']); assert.ok(!cardsNow.some((x) => x.title === 'Matrículas'), 'o recusado não vai');
    hb = (await tUbs.call('POST', '/api/telas/heartbeat', { state: 'playing' })).data;
    assert.deepEqual(hb.alerts.map((x) => x.title).sort(), ['Defesa Civil', 'Falta de água']);
    assert.ok(hb.alerts.find((x) => x.title === 'Falta de água').until - Date.now() > 29 * 60000, 'o prazo conta a partir da aprovação');
    const stE = (await E2('GET', '/api/reparticao/state')).data.approval.requests;
    assert.ok(stE.some((x) => x.status === 'rejected' && x.note === 'Fora do padrão.'), 'a repartição vê a recusa e o motivo');
    const audit = db.prepare("SELECT username, detail FROM audit_log WHERE tenant_id = ? AND detail LIKE '%pedido #%'").all(A.id);
    assert.ok(audit.some((r) => /APROVADO/.test(r.detail) && /repartição: UBS Centro/.test(r.detail) && r.username === A.username), 'auditoria: quem pediu e quem aprovou');
    assert.ok(audit.some((r) => /RECUSADO/.test(r.detail)) && audit.some((r) => /enviad[oa]s? para aprovação/.test(r.detail)));
    const dec = db.prepare('SELECT status, requested_by, decided_by, decided_at FROM telas_approvals WHERE id = ?').get(aAv.id);
    assert.equal(dec.status, 'approved'); assert.equal(dec.decided_by, A.username); assert.ok(dec.decided_at > 0);
    assert.equal((await A.api('PUT', '/api/prefeitura/defaults', { approval: false })).data.approval, false);

    /* ---------------------------------------------------------------- modo eleitoral: o institucional fica retido (não é apagado) */
    assert.equal((await A.api('PUT', '/api/prefeitura/defaults', { electoral: { from: '2030-08-16', to: '2030-10-27' } })).data.electoralOn, false, 'fora do período');
    assert.equal((await A.api('POST', `/api/prefeitura/offices/${escola.id}/cards`, { kind: 'unidade', title: 'Obra entregue', lines: ['Quadra nova'], class: 'institucional' })).status, 201);
    const instAl = await A.api('POST', '/api/prefeitura/alerts', { title: 'Inauguração', text: 'Hoje, 18h.', level: 'info', durationMin: 60, scope: { kind: 'city' }, class: 'institucional' });
    assert.equal(instAl.status, 201); assert.equal(instAl.data.alert.class, 'institucional');
    assert.equal((await A.api('POST', '/api/prefeitura/alerts', { title: 'X', text: '', level: 'info', durationMin: 60, scope: { kind: 'city' }, class: 'propaganda' })).status, 400);
    await sleep(2100);
    const before = { ticker: (await tUbs.call('GET', '/api/telas/config')).data.ticker.items, cards: (await tEsc2.call('GET', '/api/telas/config')).data.cards.map((x) => x.title), off: (await tUbs.call('GET', '/api/telas/config')).data.offline.items.length, alerts: (await tUbs.call('POST', '/api/telas/heartbeat', { state: 'playing' })).data.alerts.map((x) => x.title).sort() };
    assert.ok(before.ticker.includes('Nova ala inaugurada pelo prefeito.') && before.cards.includes('Obra entregue') && before.off === 1 && before.alerts.includes('Inauguração'));
    const el = await A.api('PUT', '/api/prefeitura/defaults', { electoral: { from: spDay(Date.now() - 86400000), to: spDay(Date.now() + 86400000) } });
    assert.equal(el.data.electoralOn, true);
    await sleep(2100);
    const during = (await tUbs.call('GET', '/api/telas/config')).data;
    assert.deepEqual(during.ticker.items, ['Campanha de vacinação até sexta.'], 'o aviso institucional não vai');
    assert.deepEqual(during.offline.items, [], 'o vídeo institucional não vai');
    assert.ok(!(await tEsc2.call('GET', '/api/telas/config')).data.cards.some((x) => x.title === 'Obra entregue'));
    assert.deepEqual((await tUbs.call('POST', '/api/telas/heartbeat', { state: 'playing' })).data.alerts.map((x) => x.title).sort(), ['Defesa Civil', 'Falta de água']);
    assert.equal((await U('GET', '/api/reparticao/state')).data.electoral.on, true);
    assert.equal((await A.api('GET', '/api/prefeitura/approvals')).data.electoral.on, true);
    // nada foi apagado: o painel ainda vê tudo, e fora do período volta sozinho
    assert.ok((await A.api('GET', `/api/prefeitura/offices/${escola.id}/cards`)).data.cards.some((x) => x.title === 'Obra entregue' && x.class === 'institucional'));
    assert.ok((await A.api('GET', '/api/prefeitura')).data.offices.find((o) => o.id === ubs.id).config.tickerItems.includes('[institucional] Nova ala inaugurada pelo prefeito.'));
    assert.equal((await A.api('PUT', '/api/prefeitura/defaults', { electoral: null })).data.electoralOn, false);
    await sleep(2100);
    assert.deepEqual((await tUbs.call('GET', '/api/telas/config')).data.ticker.items, before.ticker);
    assert.ok((await tUbs.call('POST', '/api/telas/heartbeat', { state: 'playing' })).data.alerts.some((x) => x.title === 'Inauguração'));

    /* ---------------------------------------------------------------- EAS: o alerta de emergência do canal nas telas */
    assert.equal((await A.api('PUT', '/api/c/pref-a-tv/eas', { enabled: true, sources: { defesaCivil: false, inmet: false }, areas: [{ uf: 'RJ', city: 'Niterói', ibge: '3303302' }] })).status, 200);
    const man = await A.api('POST', '/api/c/pref-a-tv/eas/manual', { event: 'Chuvas intensas', severity: 'Severe', description: 'Chuva forte nas próximas horas.', durationMin: 30 });
    assert.equal(man.status, 201, JSON.stringify(man.data));
    hb = (await tUbs.call('POST', '/api/telas/heartbeat', { state: 'playing' })).data;
    const easAl = hb.alerts.find((x) => x.id >= 1_000_000_000);
    assert.ok(easAl, JSON.stringify(hb.alerts)); assert.equal(easAl.level, 'critical'); assert.equal(easAl.title, 'Chuvas intensas'); assert.match(easAl.text, /Chuva forte/);
    assert.deepEqual(Object.keys(easAl).sort(), ['id', 'level', 'sound', 'text', 'title', 'until']); assert.ok(easAl.until > Date.now());
    assert.ok(!(await tB.call('POST', '/api/telas/heartbeat', { state: 'playing' })).data.alerts.some((x) => x.id >= 1_000_000_000), 'o EAS do canal de A não vai às telas de B');
    // o teste do sistema não vai às telas; desligado no padrão da prefeitura, nenhum vai
    assert.equal((await A.api('POST', '/api/c/pref-a-tv/eas/test', {})).status, 201);
    assert.equal((await tUbs.call('POST', '/api/telas/heartbeat', { state: 'playing' })).data.alerts.filter((x) => x.id >= 1_000_000_000).length, 1);
    assert.equal((await A.api('PUT', '/api/prefeitura/defaults', { eas: false })).data.eas, false);
    await sleep(2100);
    assert.equal((await tUbs.call('POST', '/api/telas/heartbeat', { state: 'playing' })).data.alerts.filter((x) => x.id >= 1_000_000_000).length, 0);

    /* ---------------------------------------------------------------- tela desligada: o selo e a disponibilidade */
    db.prepare('UPDATE telas_devices SET last_seen = ? WHERE id = ?').run(Date.now() - 10 * 60000, tUpa.deviceId);
    const badge = (await A.api('GET', '/api/prefeitura/badge')).data;
    assert.equal(badge.off, 1, 'uma tela sem sinal há mais de 2 minutos'); assert.equal(badge.approvals, 0);
    assert.equal((await B.api('GET', '/api/prefeitura/badge')).data.off, 0);
    const av = await A.api('GET', '/api/prefeitura/availability');
    assert.equal(av.status, 200); assert.ok(Array.isArray(av.data.devices));

    /* ---------------------------------------------------------------- nada de segredo nem de nome inteiro no log e na auditoria */
    const logs = `${s.out()}\n${JSON.stringify(db.prepare('SELECT * FROM audit_log').all())}`;
    for (const secret of [totemToken, tot2, tUbs.token, 'Aparecida', 'Roberto', 'senha-da-ubs-2026']) assert.ok(!logs.includes(secret), `no log ou na auditoria: ${secret.slice(0, 8)}…`);
    const details = db.prepare('SELECT detail FROM audit_log WHERE tenant_id = ?').all(A.id).map((r) => r.detail || '').join('\n');
    assert.ok(/fila "Atendimento geral"/.test(details) && /chamada de senha de "UBS Centro" configurada/.test(details) && /totem de senhas de "UBS Centro"/.test(details) && /cartão Merenda/.test(details) && /vídeos guardados/.test(details), 'as mudanças ficam na auditoria');

    /* ---------------------------------------------------------------- modo desligado e exclusão */
    assert.equal((await P('PATCH', `/api/platform/feature-profiles/${prof.data.id}`, { features: { prefeitura: false }, confirm: true })).status, 200);
    await sleep(300);
    assert.equal((await tUbs.call('GET', '/api/telas/queue')).status, 403);
    assert.equal((await U('GET', '/api/reparticao/queue')).status, 401);
    assert.equal((await A.api('GET', '/api/prefeitura/approvals')).status, 403);
    assert.equal((await P('PATCH', `/api/platform/feature-profiles/${prof.data.id}`, { features: { prefeitura: true, eas: true }, confirm: true })).status, 200);
    await sleep(300);
    // excluir a repartição leva as filas, as senhas, os cartões e os vídeos dela
    assert.equal((await A.api('POST', `/api/prefeitura/devices/${tUpa.deviceId}/revoke`)).status, 200);
    assert.equal((await A.api('DELETE', `/api/prefeitura/offices/${upa.id}`)).status, 200);
    for (const tb of ['telas_queue_services', 'telas_queue_tickets', 'telas_queue_calls', 'telas_office_extras', 'telas_cards']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${tb} WHERE office_id = ?`).get(upa.id).n, 0, tb);
    db.close();
  } finally {
    for (const st of streams) st.close();
    await s.stop(); await inmet.close(); cleanup(s.dataDir);
  }
});
