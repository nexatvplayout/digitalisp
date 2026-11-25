// NEXA Telas: salas e consultórios de uma UPA no servidor de verdade, nos dois bancos (server/telas-salas.js, docs/TELAS.md
// §26 a §31). Salas e grupos (validação, isolamento), "Chamar paciente" na ordem do Manchester pelas filas do grupo, duas e
// três salas chamando ao mesmo tempo (nunca a mesma senha), o automático em round robin (a sala livre há mais tempo
// primeiro), o endereço da sala (uma vez, só o hash, revogar, gerar de novo, freio, CSP, sem nomes da fila, quem chamou como
// "sala: <nome>"), as etapas (a mesma senha com a cor e a prioridade), o pedido de apoio (sala, painel, apoio, TV box), o
// tempo-alvo (o vermelho já passou; Reavaliar), o QR do acompanhante (sem nome, sem cor, com a sala da chamada), a espera
// estimada e os indicadores (JSON e CSV).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, cleanup, api, platformLogin, newTenant, sleep } from './helpers/srv.js';
import { canal, usuario, auditoria } from './helpers/prefeitura.js'; // DIGITAL ISP: canal ao vivo (HLS) e usuário de permissão limitada

const ENV = { TELAS_LINK_LOGIN_PER_IP: '500', TELAS_ACTIVATE_PER_IP: '50', TELAS_SALA_PER_MIN: '400', PUBLIC_HLS_URL: 'https://hls.exemplo.test', PLATFORM_PUBLIC_URL: 'https://painel.exemplo.test' };

async function roteiro(s) {
  const anon = api(s.base);
  const bearer = (token) => (method, url, body, headers = {}) => anon(method, url, body, { authorization: `Bearer ${token}`, ...headers });
  const P = api(s.base, await platformLogin(s.base));
  const prof = await P('POST', '/api/platform/feature-profiles', { name: 'Prefeitura', code: 'prefeitura', features: { prefeitura: true } });
  assert.equal((await P('POST', '/api/platform/plans', { code: 'p-pref', name: 'Prefeitura', priceCents: 0, profileId: prof.data.id, limits: { channels: 1 } })).status, 201);
  const A = await newTenant(P, s.base, { slug: 'upa-a', planCode: 'p-pref', status: 'active' });
  const B = await newTenant(P, s.base, { slug: 'upa-b', planCode: 'p-pref', status: 'active' });
  await canal(A.api, 'TV A'); // DIGITAL ISP: o canal ao vivo (HLS) no lugar do canal do NEXA
  const post = async (X, url, body, want = 201) => { const r = await X('POST', url, body); assert.equal(r.status, want, `${url}: ${JSON.stringify(r.data)}`); return r.data; };
  const PA = (m, u, b) => A.api(m, u, b);
  const upa = await post(PA, '/api/prefeitura/offices', { name: 'UPA Centro', type: 'upa' });
  const ubs = await post(PA, '/api/prefeitura/offices', { name: 'UBS Norte', type: 'ubs' });
  const upaB = await post((m, u, b) => B.api(m, u, b), '/api/prefeitura/offices', { name: 'UPA do B', type: 'upa' });
  const enter = async (o, username, role = 'gestor') => {
    await post(PA, `/api/prefeitura/offices/${o.id}/users`, { username, role, password: `senha-de-${username}-2026` });
    const link = (await post(PA, `/api/prefeitura/offices/${o.id}/link`, {})).url.split('/').pop();
    const r = await anon('POST', '/api/reparticao/login', { token: link, username, password: `senha-de-${username}-2026` });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return Object.assign(bearer(r.data.session), { link });
  };
  const G = await enter(upa, 'gestor.upa');
  await post(PA, `/api/prefeitura/offices/${upa.id}/users`, { username: 'recepcao', role: 'atendente', password: 'senha-da-recepcao-2026' });
  const At = bearer((await anon('POST', '/api/reparticao/login', { token: G.link, username: 'recepcao', password: 'senha-da-recepcao-2026' })).data.session);
  const Q = '/api/reparticao/queue';

  /* ---------------------------------------------------------------- filas, etapas e salas */
  const svc = {};
  for (const [k, name, prefix] of [['rec', 'Recepção', 'R'], ['cla', 'Classificação', 'C'], ['cli', 'Clínico geral', 'A'], ['med', 'Medicação', 'M']]) svc[k] = (await post(G, `${Q}/services`, { name, prefix })).id;
  const cfg0 = (await G('GET', `${Q}/rooms`)).data;
  assert.deepEqual([cfg0.rooms, cfg0.groups, cfg0.upa.follow, cfg0.upa.followRisk, cfg0.upa.support, cfg0.upa.flow], [[], [], true, false, ['Maqueiro', 'Limpeza', 'Segurança', 'Enfermagem'], []], 'o QR nasce ligado na UPA, sem a cor');
  assert.equal((await G('PUT', `${Q}/upa`, { flow: [{ name: 'Recepção', serviceId: svc.rec }, { name: '', serviceId: svc.rec }] })).status, 400, 'duas etapas na mesma fila');
  assert.equal((await G('PUT', `${Q}/upa`, { flow: [{ name: 'X', serviceId: 999999 }] })).status, 400, 'fila de fora');
  const flow = [{ name: 'Recepção', serviceId: svc.rec }, { name: 'Classificação', serviceId: svc.cla }, { name: 'Consultório', serviceId: svc.cli }, { name: '', serviceId: svc.med }];
  assert.equal((await G('PUT', `${Q}/upa`, { flow })).status, 200);
  assert.equal((await G('POST', `${Q}/room-groups`, { name: 'Clínico geral', serviceIds: [] })).status, 400, 'grupo sem fila');
  const otherSvc = (await post((m, u, b) => B.api(m, u, b), `/api/prefeitura/offices/${upaB.id}/queue/services`, { name: 'Fila do B', prefix: 'B' })).id;
  assert.equal((await G('POST', `${Q}/room-groups`, { name: 'Intrusa', serviceIds: [otherSvc] })).status, 400, 'fila de outro cliente');
  const gCli = await post(G, `${Q}/room-groups`, { name: 'Clínico geral', serviceIds: [svc.cli] });
  const gCla = await post(G, `${Q}/room-groups`, { name: 'Classificação', serviceIds: [svc.cla] });
  assert.equal((await G('POST', `${Q}/rooms`, { name: 'Sala X', kind: 'cozinha' })).status, 400, 'tipo inválido');
  assert.equal((await G('POST', `${Q}/rooms`, { name: 'Sala X', groupId: 999999 })).status, 400, 'grupo de fora');
  const room = {};
  for (const n of [1, 2, 3]) room[n] = await post(G, `${Q}/rooms`, { name: `Consultório ${n}`, kind: 'consultorio', groupId: gCli.id });
  room.cla = await post(G, `${Q}/rooms`, { name: 'Classificação 1', kind: 'classificacao', groupId: gCla.id });
  room.med = await post(G, `${Q}/rooms`, { name: 'Medicação', kind: 'medicacao' });
  assert.equal((await G('POST', `${Q}/rooms`, { name: 'consultório 1', kind: 'consultorio' })).status, 409, 'nome repetido');
  assert.equal(room[1].state, 'available');
  // quem alcança: o atendente vê e usa as salas, não cria; outro cliente não vê
  assert.equal((await At('GET', `${Q}/rooms`)).status, 200);
  for (const [m, u, b] of [['POST', `${Q}/rooms`, { name: 'Y' }], ['PATCH', `${Q}/rooms/${room[1].id}`, { name: 'Y' }], ['POST', `${Q}/rooms/${room[1].id}/link`, {}], ['PUT', `${Q}/upa`, {}], ['GET', `${Q}/indicators`], ['POST', `${Q}/support-link`, {}]]) assert.equal((await At(m, u, b)).status, 403, `atendente: ${m} ${u}`);
  assert.equal((await B.api('PATCH', `/api/prefeitura/offices/${upa.id}/queue/rooms/${room[1].id}`, { name: 'Z' })).status, 404, 'outro cliente');
  assert.equal((await B.api('POST', `/api/prefeitura/offices/${upaB.id}/queue/call`, { roomId: room[1].id })).status, 404, 'a sala de outro cliente não chama');
  // o Painel da Prefeitura vê as mesmas salas
  assert.deepEqual((await PA('GET', `/api/prefeitura/offices/${upa.id}/queue/rooms`)).data.rooms.map((r) => r.name), ['Consultório 1', 'Consultório 2', 'Consultório 3', 'Classificação 1', 'Medicação']);

  /* ---------------------------------------------------------------- Chamar paciente: pelas filas do grupo, na ordem do Manchester */
  const issue = async (serviceId, extra = {}) => (await post(G, `${Q}/tickets`, { serviceId, ...extra })).ticket;
  const t1 = await issue(svc.cli, { risk: 'verde', name: 'Joana Pereira Lima' });
  const t2 = await issue(svc.cli, { risk: 'amarelo' });
  const t3 = await issue(svc.rec, { name: 'Outro Paciente Teste' }); // fila de fora do grupo
  const c1 = await post(G, `${Q}/call`, { roomId: room[1].id }, 200);
  assert.deepEqual([c1.ticket.code, c1.call.desk, c1.room.name], [t2.code, 'Consultório 1', 'Consultório 1'], 'o amarelo antes do verde; o nome da sala vai à tela');
  let rooms = (await G('GET', `${Q}/rooms`)).data.rooms;
  assert.deepEqual([rooms[0].state, rooms[0].ticket?.code], ['busy', t2.code], 'a sala fica Ocupada com a senha');
  // atendente escolhe a sala na lista; o campo desk de sempre segue valendo
  const c2 = await post(At, `${Q}/call`, { roomId: room[2].id }, 200);
  assert.equal(c2.ticket.code, t1.code);
  assert.equal((await G('POST', `${Q}/call`, { roomId: room[3].id })).status, 404, 'ninguém esperando nas filas do grupo (a da recepção não é dele)');
  const cd = await post(G, `${Q}/call`, { desk: 'Guichê 9' }, 200);
  assert.equal(cd.ticket.code, t3.code, 'o guichê digitado continua');
  // finalizar libera a sala; Não compareceu também
  assert.equal((await G('POST', `${Q}/tickets/${c1.ticket.id}/finish`)).status, 200);
  rooms = (await G('GET', `${Q}/rooms`)).data.rooms;
  assert.deepEqual([rooms[0].state, rooms[0].ticket], ['available', null]);
  // concorrência: três salas chamando ao mesmo tempo com duas senhas esperando: duas levam uma cada, nunca a mesma
  const w1 = await issue(svc.cli); const w2 = await issue(svc.cli);
  const race = await Promise.all([1, 2, 3].map((n) => G('POST', `${Q}/call`, { roomId: room[n].id })));
  const okCalls = race.filter((r) => r.status === 200).map((r) => r.data.ticket.code).sort();
  assert.deepEqual(okCalls, [w1.code, w2.code].sort(), `duas chamadas, senhas diferentes: ${JSON.stringify(race.map((r) => [r.status, r.data.ticket?.code]))}`);
  assert.equal(race.filter((r) => r.status !== 200).length, 1); assert.ok([404, 409].includes(race.find((r) => r.status !== 200).status));
  for (const r of race.filter((x) => x.status === 200)) assert.equal((await G('POST', `${Q}/tickets/${r.data.ticket.id}/finish`)).status, 200);
  await G('POST', `${Q}/tickets/${c2.ticket.id}/finish`);

  /* ---------------------------------------------------------------- automático: round robin, a sala livre há mais tempo primeiro */
  // Pausa não recebe; a ordem de liberação define a vez: 3, depois 1 (o 2 em pausa)
  assert.equal((await At('POST', `${Q}/rooms/${room[2].id}/state`, { state: 'pause' })).status, 200);
  assert.equal((await G('POST', `${Q}/rooms/${room[3].id}/state`, { state: 'busy' })).status, 400, 'Ocupada é o sistema que põe');
  await G('POST', `${Q}/rooms/${room[3].id}/state`, { state: 'available' }); await sleep(20);
  await G('POST', `${Q}/rooms/${room[1].id}/state`, { state: 'available' });
  assert.equal((await G('PATCH', `${Q}/room-groups/${gCli.id}`, { auto: true })).status, 200);
  const a1 = await issue(svc.cli); const a2 = await issue(svc.cli); const a3 = await issue(svc.cli);
  const until = async (fn, ms = 8000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(150); } };
  rooms = await until(async () => { const r = (await G('GET', `${Q}/rooms`)).data.rooms; return r[0].ticket && r[2].ticket ? r : null; });
  assert.ok(rooms, 'o automático distribuiu');
  assert.deepEqual([rooms[2].ticket.code, rooms[0].ticket.code, rooms[1].state], [a1.code, a2.code, 'pause'], 'Consultório 3 (livre há mais tempo) leva a primeira; o 2 em pausa não recebe');
  assert.equal((await G('GET', Q)).data.waiting.map((t) => t.code).includes(a3.code), true, 'a terceira espera: não há sala livre');
  // a sala que finaliza recebe a próxima sozinha
  await G('POST', `${Q}/tickets/${rooms[2].ticket.id}/finish`);
  rooms = await until(async () => { const r = (await G('GET', `${Q}/rooms`)).data.rooms; return r[2].ticket?.code === a3.code ? r : null; });
  assert.ok(rooms, 'a sala livre chamou a que esperava');
  assert.equal((await G('PATCH', `${Q}/room-groups/${gCli.id}`, { auto: false })).status, 200);
  for (const r of rooms.filter((x) => x.ticket)) await G('POST', `${Q}/tickets/${r.ticket.id}/finish`);
  await G('POST', `${Q}/rooms/${room[2].id}/state`, { state: 'available' });

  /* ---------------------------------------------------------------- o endereço da sala */
  const lk = await post(G, `${Q}/rooms/${room[2].id}/link`, {});
  assert.match(lk.url, /^https:\/\/painel\.exemplo\.test\/reparticao\/[A-Za-z0-9_-]{43}\/sala$/);
  const st = lk.url.split('/').at(-2); const Sx = bearer(st);
  assert.equal((await G('GET', `${Q}/rooms`)).data.rooms[1].link.on, true);
  assert.ok(!JSON.stringify((await G('GET', `${Q}/rooms`)).data).includes(st), 'o endereço não volta');
  const page = await fetch(`${s.base}/reparticao/${st}/sala`);
  assert.equal(page.status, 200); const csp = page.headers.get('content-security-policy');
  assert.match(csp, /default-src 'none'/); assert.ok(!/unsafe-inline|https?:/.test(csp)); assert.equal(page.headers.get('x-frame-options'), 'DENY');
  for (const f of ['sala.js', 'sala.css', 'apoio.js', 'acompanhar.js', 'acompanhar.css']) assert.equal((await fetch(`${s.base}/reparticao/${f}`)).status, 200, f);
  const n1 = await issue(svc.cli, { risk: 'azul', name: 'Maria Aparecida da Silva' });
  const n2 = await issue(svc.cli, { risk: 'laranja', name: 'Carlos Alberto Souza' });
  let sv = (await Sx('GET', '/api/sala')).data;
  assert.deepEqual([sv.room.name, sv.room.kind, sv.current, sv.waiting, sv.queue.map((x) => x.code)], ['Consultório 2', 'consultorio', null, 2, [n2.code, n1.code]]);
  assert.ok(!/Maria|Carlos/.test(JSON.stringify(sv)), 'a sala não lê a fila com os nomes');
  const sc = await Sx('POST', '/api/sala/call', {});
  assert.equal(sc.status, 200); assert.equal(sc.data.call.desk, 'Consultório 2'); assert.equal(sc.data.ticket.code, n2.code);
  sv = (await Sx('GET', '/api/sala')).data;
  assert.deepEqual([sv.current.code, sv.current.name, sv.current.stage.name, sv.current.stage.next.name, sv.room.state], [n2.code, 'Carlos S.', 'Consultório', 'Medicação', 'busy'], 'a senha da sala com o nome reduzido e a etapa');
  assert.ok(!/Maria/.test(JSON.stringify(sv)));
  const calls = (await G('GET', Q)).data.calls;
  assert.equal(calls.find((c) => c.ticket === n2.code).by, 'sala: Consultório 2', 'quem chamou: a sala');
  assert.equal((await Sx('POST', '/api/sala/repeat', {})).status, 200);
  // §31 (20/11): na UPA a chegada é exigida de fábrica: Encaminhar e Finalizar só depois do "Paciente chegou"
  assert.deepEqual([sv.confirm, sv.current.callState, sv.current.arrivedAt], [true, 'called', null]);
  assert.equal((await Sx('POST', '/api/sala/call', {})).status, 409, 'um paciente por vez na sala');
  assert.equal((await Sx('POST', '/api/sala/forward', { next: true })).status, 409, 'sem o chegou, não encaminha');
  assert.equal((await Sx('POST', '/api/sala/finish', {})).status, 409, 'sem o chegou, não finaliza');
  assert.equal((await Sx('GET', '/api/sala')).data.current.repeats, 1, 'Chamar de novo contou');
  const arr = await Sx('POST', '/api/sala/arrive', {});
  assert.equal(arr.status, 200, JSON.stringify(arr.data)); assert.equal(arr.data.callState, 'arrived');
  assert.equal((await Sx('POST', '/api/sala/arrive', {})).status, 409, 'confirmar duas vezes');
  assert.equal((await G('GET', Q)).data.serving.find((t) => t.code === n2.code).callState, 'arrived', 'o Atendimento vê que chegou');
  // Encaminhar para a próxima etapa: a mesma senha, com a cor e a prioridade
  const fw = await Sx('POST', '/api/sala/forward', { next: true });
  assert.equal(fw.status, 200, JSON.stringify(fw.data));
  assert.deepEqual([fw.data.ticket.code, fw.data.ticket.risk, fw.data.ticket.serviceId, fw.data.ticket.status, fw.data.stage], [n2.code, 'laranja', svc.med, 'waiting', 'Medicação']);
  assert.equal((await Sx('POST', '/api/sala/finish', {})).status, 409, 'a sala ficou sem paciente');
  assert.equal((await Sx('GET', '/api/sala')).data.room.state, 'available');
  // pelo painel: a próxima etapa da recepção é a classificação; da última, 409
  const r1 = await issue(svc.rec);
  const ns = await post(G, `${Q}/tickets/${r1.id}/next-stage`, {}, 200);
  assert.deepEqual([ns.ticket.serviceId, ns.stage], [svc.cla, 'Classificação']);
  const ov = (await G('GET', Q)).data;
  assert.deepEqual(ov.waiting.find((t) => t.code === r1.code).stage, { name: 'Classificação', index: 1, total: 4, mode: 'recepcao', next: { name: 'Consultório', serviceId: svc.cli, mode: 'recepcao' } }, 'a etapa atual em cada senha');
  assert.equal((await G('POST', `${Q}/tickets/${n2.id}/next-stage`)).status, 409, 'a última etapa');
  // a sala só alcança a sala: nada mais abre com o token dela
  for (const [m, url] of [['GET', '/api/reparticao/state'], ['GET', Q], ['GET', '/api/guiche'], ['GET', '/api/totem'], ['GET', '/api/apoio'], ['GET', '/api/telas/config'], ['POST', '/api/totem/tickets']]) assert.equal((await Sx(m, url, m === 'GET' ? undefined : {})).status, 401, `sala: ${m} ${url}`);
  assert.equal((await anon('POST', '/api/sala/tickets', { serviceId: svc.cli }, { authorization: `Bearer ${st}` })).status, 404, 'a sala não emite senha');

  /* ---------------------------------------------------------------- pedido de apoio */
  assert.equal((await Sx('POST', '/api/sala/support', { kind: 'Pizza' })).status, 400);
  const sp = await post(Sx, '/api/sala/support', { kind: 'maqueiro' });
  assert.deepEqual([sp.kind, sp.room, sp.status], ['Maqueiro', 'Consultório 2', 'open']);
  assert.equal((await Sx('POST', '/api/sala/support', { kind: 'Maqueiro' })).status, 409, 'o mesmo pedido aberto não repete');
  const key = await post(PA, '/api/prefeitura/keys', { officeId: upa.id, name: 'UPA, corredor' });
  const tv = bearer((await anon('POST', '/api/telas/activate', { key: key.key, device: { model: 'TV Box' } })).data.token);
  const ts = (await tv('GET', '/api/telas/support')).data;
  assert.deepEqual(ts.requests.map((x) => [x.room, x.kind, x.status]), [['Consultório 2', 'Maqueiro', 'open']]);
  assert.deepEqual(Object.keys(ts.requests[0]).sort(), ['acceptedAt', 'at', 'id', 'kind', 'room', 'status'], 'para as telas internas: sem nomes');
  assert.equal((await G('POST', `${Q}/support-link`)).status, 201);
  const ap = await post(G, `${Q}/support-link`, {}); const apt = ap.url.split('/').at(-2); const Ap = bearer(apt);
  assert.match(ap.url, /\/reparticao\/[A-Za-z0-9_-]{43}\/apoio$/);
  assert.equal((await Ap('GET', '/api/apoio')).data.requests[0].kind, 'Maqueiro');
  assert.equal((await Ap('GET', '/api/sala')).status, 401, 'o apoio não é sala');
  await sleep(30);
  const acc = await post(Ap, `/api/apoio/${sp.id}/accept`, { who: 'José do apoio' }, 200);
  assert.deepEqual([acc.status, acc.acceptedBy, typeof acc.waitMin], ['accepted', 'José do apoio', 'number']);
  assert.equal((await Ap('POST', `/api/apoio/${sp.id}/accept`, { who: 'Outro' })).status, 409, 'dois aceites: só um vale');
  assert.equal((await post(At, `${Q}/support/${sp.id}/done`, {}, 200)).status, 'done', 'o painel conclui');
  assert.deepEqual((await tv('GET', '/api/telas/support')).data.requests, [], 'concluído sai das telas');
  assert.equal((await G('GET', `${Q}/support`)).data.requests[0].status, 'done');
  const sp2 = await post(Sx, '/api/sala/support', { kind: 'Limpeza' });
  assert.equal((await Sx('POST', `/api/sala/support/${sp2.id}/cancel`, {})).status, 200);
  assert.equal((await G('DELETE', `${Q}/support-link`)).status, 200); assert.equal((await Ap('GET', '/api/apoio')).status, 401);

  /* ---------------------------------------------------------------- tempo-alvo (o vermelho já passou) e Reavaliar */
  const red = await issue(svc.cli, { risk: 'vermelho' });
  await sleep(30);
  const ov2 = (await G('GET', Q)).data;
  assert.equal(ov2.waiting.find((t) => t.code === red.code).overMin, 0, 'o vermelho esperando já passou do alvo');
  assert.equal(ov2.waiting.find((t) => t.code === n1.code).overMin, null, 'o azul de agora está dentro do alvo');
  assert.equal(ov2.overdue, 1);
  const q = (await tv('GET', '/api/telas/queue')).data;
  assert.deepEqual(q.overdue, { total: 1, byRisk: { vermelho: 1, laranja: 0, amarelo: 0, verde: 0, azul: 0 }, tickets: [{ ticket: red.code, risk: 'vermelho', overMin: 0 }] }, 'o estado das telas diz quem passou, sem dados pessoais');
  assert.ok(!/Maria|Carlos|Joana/.test(JSON.stringify(q)));
  assert.equal((await Sx('POST', `/api/sala/tickets/${n1.id}/risk`, { risk: 'verde' })).status, 409, 'dentro do alvo não se reavalia pela sala');
  assert.equal((await Sx('POST', `/api/sala/tickets/${red.id}/risk`, { risk: 'roxo' })).status, 400);
  assert.equal((await Sx('POST', `/api/sala/tickets/${red.id}/risk`, { risk: 'laranja' })).status, 200, 'Reavaliar');
  assert.equal((await tv('GET', '/api/telas/queue')).data.overdue.total, 0);
  assert.equal((await Sx('POST', `/api/sala/tickets/${r1.id}/risk`, { risk: 'azul' })).status, 409, 'fila de fora da sala');

  /* ---------------------------------------------------------------- QR do acompanhante */
  const qi = await post(G, `${Q}/tickets`, { serviceId: svc.cli, name: 'Ana Beatriz Rocha', risk: 'verde' });
  assert.match(qi.follow, /^https:\/\/painel\.exemplo\.test\/senha\/[A-Za-z0-9_-]{43}$/);
  const ft = qi.follow.split('/').pop(); const F = bearer(ft);
  const fp = await fetch(`${s.base}/senha/${ft}`);
  assert.equal(fp.status, 200); assert.match(fp.headers.get('content-security-policy'), /default-src 'none'/); assert.equal(fp.headers.get('referrer-policy'), 'no-referrer');
  let fv = (await F('GET', '/api/acompanhar')).data;
  assert.deepEqual([fv.code, fv.status, fv.stage.name, fv.risk, fv.calledTo, typeof fv.position], [qi.ticket.code, 'waiting', 'Consultório', null, null, 'string']);
  assert.ok(!/Ana|Beatriz|Rocha|verde/i.test(JSON.stringify(fv)), 'sem nome e sem a cor');
  assert.deepEqual(Object.keys(fv).sort(), ['ahead', 'calledAt', 'calledTo', 'code', 'estimate', 'office', 'position', 'risk', 'serverTime', 'stage', 'status', 'statusLabel']);
  assert.equal((await G('PUT', `${Q}/upa`, { followRisk: true, estimate: true, estimateText: 'Casos leves: UBS Norte, Rua A, 10.' })).status, 200);
  assert.equal((await F('GET', '/api/acompanhar')).data.risk, 'verde', 'com "mostrar a cor" ligado');
  await G('POST', `${Q}/rooms/${room[3].id}/state`, { state: 'available' });
  const qc = await post(G, `${Q}/call`, { roomId: room[3].id, ticketId: qi.ticket.id }, 200);
  fv = (await F('GET', '/api/acompanhar')).data;
  assert.deepEqual([fv.status, fv.calledTo], ['called', 'Consultório 3'], '"foi chamada: Consultório 3"');
  assert.equal((await anon('GET', '/api/acompanhar')).status, 401); assert.equal((await bearer('x'.repeat(43))('GET', '/api/acompanhar')).status, 401);
  // o totem também entrega o QR (na UPA); na UBS (QR desligado de fábrica), o totem responde como antes
  const tt = (await post(G, `${Q}/totem`, {})).url.split('/').at(-2);
  const tk = await bearer(tt)('POST', '/api/totem/tickets', { serviceId: svc.rec });
  assert.equal(tk.status, 201); assert.match(tk.data.follow, /\/senha\//);
  const U = await enter(ubs, 'gestor.ubs');
  const us = (await post(U, `${Q}/services`, { name: 'Atendimento', prefix: 'A' })).id;
  const ut = (await post(U, `${Q}/totem`, {})).url.split('/').at(-2);
  assert.deepEqual(Object.keys((await bearer(ut)('POST', '/api/totem/tickets', { serviceId: us })).data).sort(), ['at', 'office', 'priority', 'service', 'ticket', 'title']);

  /* ---------------------------------------------------------------- espera estimada (a média das últimas horas por cor) */
  const est = (await tv('GET', '/api/telas/queue')).data.estimate;
  assert.equal(est.hours, 3); assert.equal(est.text, 'Casos leves: UBS Norte, Rua A, 10.');
  assert.equal(est.light, 'Casos verdes e azuis: cerca de 5 min de espera', 'o verde chamado no consultório agora há pouco');
  assert.equal(typeof est.byRisk.verde, 'number');
  await G('POST', `${Q}/tickets/${qc.ticket.id}/finish`);

  /* ---------------------------------------------------------------- §31 (20/11): quem chama cada etapa e a chegada confirmada */
  svc.ex = (await post(G, `${Q}/services`, { name: 'Exames', prefix: 'X' })).id;
  svc.rv = (await post(G, `${Q}/services`, { name: 'Reavaliação', prefix: 'V' })).id;
  const flow2 = [...flow.map((x) => ({ ...x })), { name: 'Exames', serviceId: svc.ex, mode: 'auto' }, { name: 'Reavaliação', serviceId: svc.rv, mode: 'sala' }];
  assert.equal((await G('PUT', `${Q}/upa`, { flow: [{ serviceId: svc.rv, mode: 'robo' }] })).status, 400, 'modo inválido');
  const w0 = await G('PUT', `${Q}/upa`, { flow: flow2 });
  // a Medicação (sala sem grupo) atende todas as filas: a etapa do profissional tem quem chame; a automática, não
  assert.equal(w0.status, 200); assert.deepEqual(w0.data.warnings, ['Exames: nenhum grupo com sala ativa atende esta fila; o automático não terá para onde mandar.']);
  assert.equal((await At('PUT', `${Q}/upa`, { preset: 'recepcao' })).status, 403, 'o atendente não muda o fluxo');
  const gEx = await post(G, `${Q}/room-groups`, { name: 'Exames', serviceIds: [svc.ex] }); // automático do grupo desligado: quem distribui é a etapa
  const gRv = await post(G, `${Q}/room-groups`, { name: 'Reavaliação', serviceIds: [svc.rv] });
  room.ex1 = await post(G, `${Q}/rooms`, { name: 'Exames 1', kind: 'exames', groupId: gEx.id }); await sleep(15);
  room.ex2 = await post(G, `${Q}/rooms`, { name: 'Exames 2', kind: 'exames', groupId: gEx.id });
  room.rv = await post(G, `${Q}/rooms`, { name: 'Reavaliação 1', kind: 'reavaliacao', groupId: gRv.id });
  assert.deepEqual((await G('PUT', `${Q}/upa`, { flow: flow2 })).data.warnings, [], 'com as salas, nada a avisar');
  assert.deepEqual((await G('GET', `${Q}/rooms`)).data.upa.flow.map((x) => x.mode), ['recepcao', 'recepcao', 'recepcao', 'recepcao', 'auto', 'sala']);
  // Profissional da sala: a recepção não chama; o gestor chama por exceção (com registro)
  const v1 = await issue(svc.rv, { risk: 'vermelho', name: 'Paciente Reavaliar' });
  let ovr = (await G('GET', Q)).data.waiting.find((t) => t.code === v1.code);
  assert.deepEqual([ovr.awaitPro, ovr.stage.mode], [true, 'sala'], 'aguardando o profissional');
  assert.equal((await At('POST', `${Q}/call`, { roomId: room.rv.id })).status, 409, 'a "próxima" da recepção não pega a etapa do profissional');
  assert.equal((await At('POST', `${Q}/call`, { desk: 'Guichê 9', serviceId: svc.rv })).status, 403);
  assert.equal((await At('POST', `${Q}/call`, { desk: 'Guichê 9', ticketId: v1.id })).status, 403, 'nem com "Chamar esta"');
  const gen = await At('POST', `${Q}/call`, { desk: 'Guichê 7' });
  assert.ok(gen.status !== 200 || gen.data.ticket.code !== v1.code, 'o vermelho da reavaliação fica para o profissional');
  if (gen.status === 200) await At('POST', `${Q}/tickets/${gen.data.ticket.id}/finish`);
  const exc = await post(G, `${Q}/call`, { roomId: room.rv.id, ticketId: v1.id }, 200);
  assert.deepEqual([exc.exception, exc.stage, exc.ticket.code], [true, 'Reavaliação', v1.code], 'o gestor chama por exceção');
  assert.ok(JSON.stringify(await auditoria(s, A.id)).includes(`senha ${v1.code} da etapa \\"Reavaliação\\" (chamada pelo profissional da sala) chamada por exceção`), 'a exceção vai ao log');
  assert.equal((await G('POST', `${Q}/tickets/${v1.id}/requeue`)).status, 200);
  // a página da sala chama, confirma a chegada, chama de novo e finaliza; a sala volta a Disponível
  const Sv = bearer((await post(G, `${Q}/rooms/${room.rv.id}/link`, {})).url.split('/').at(-2));
  assert.equal((await Sv('POST', '/api/sala/call', {})).data.ticket.code, v1.code, 'o profissional chama');
  let svr = (await Sv('GET', '/api/sala')).data;
  assert.deepEqual([svr.current.code, svr.current.callState, svr.current.stage.mode, svr.room.state], [v1.code, 'called', 'sala', 'busy']);
  assert.equal((await G('GET', Q)).data.serving.find((t) => t.code === v1.code).callState, 'called', 'no Atendimento: chamado');
  await sleep(30);
  assert.equal((await Sv('POST', '/api/sala/repeat', {})).status, 200, 'Chamar de novo');
  assert.equal((await Sv('POST', '/api/sala/finish', {})).status, 409);
  assert.equal((await Sv('POST', '/api/sala/arrive', {})).status, 200);
  svr = (await Sv('GET', '/api/sala')).data;
  assert.deepEqual([svr.current.callState, typeof svr.current.arrivedAt, svr.current.repeats], ['arrived', 'number', 1]);
  assert.equal((await Sv('POST', '/api/sala/finish', {})).status, 200);
  assert.deepEqual([(await Sv('GET', '/api/sala')).data.room.state, (await Sv('GET', '/api/sala')).data.current], ['available', null], 'Finalizar devolve a sala a Disponível');
  const v2 = await issue(svc.rv);
  assert.equal((await Sv('POST', '/api/sala/call', {})).data.ticket.code, v2.code);
  assert.equal((await Sv('POST', '/api/sala/noshow', {})).status, 200, 'Não compareceu');
  assert.equal((await Sv('GET', '/api/sala')).data.room.state, 'available');
  // Automático por etapa: as salas Disponíveis do grupo recebem na vez, sem o automático do grupo
  const x1 = await issue(svc.ex); const x2 = await issue(svc.ex); const x3 = await issue(svc.ex);
  rooms = await until(async () => { const r = (await G('GET', `${Q}/rooms`)).data.rooms; const a = r.find((y) => y.id === room.ex1.id); const b = r.find((y) => y.id === room.ex2.id); return a.ticket && b.ticket ? [a, b] : null; });
  assert.ok(rooms, 'a etapa automática distribuiu');
  assert.deepEqual([rooms[0].ticket.code, rooms[1].ticket.code], [x1.code, x2.code], 'Exames 1 (livre há mais tempo) leva a primeira');
  assert.ok((await G('GET', Q)).data.waiting.some((t) => t.code === x3.code), 'a terceira espera');
  assert.match((await G('GET', Q)).data.calls.find((c) => c.ticket === x1.code).by, /^automático: Exames 1/);
  // a etapa do profissional nunca é automática, nem com o automático do grupo ligado
  assert.equal((await G('PATCH', `${Q}/room-groups/${gRv.id}`, { auto: true })).status, 200);
  const v3 = await issue(svc.rv); await sleep(600);
  assert.ok((await G('GET', Q)).data.waiting.some((t) => t.code === v3.code), 'continua esperando o profissional');
  // o painel confirma a chegada (a sala sem celular)
  assert.equal((await At('POST', `${Q}/tickets/${x2.id}/arrive`)).status, 200);
  assert.equal((await At('POST', `${Q}/tickets/${x2.id}/arrive`)).status, 409);
  assert.equal((await At('POST', `${Q}/tickets/${x3.id}/arrive`)).status, 409, 'só quem está chamado');
  assert.equal((await G('GET', Q)).data.serving.find((t) => t.code === x2.code).callState, 'arrived');
  // Encaminhar na sala: a sala volta a Disponível e, na etapa automática, recebe a próxima sozinha
  const Sx1 = bearer((await post(G, `${Q}/rooms/${room.ex1.id}/link`, {})).url.split('/').at(-2));
  assert.equal((await Sx1('POST', '/api/sala/arrive', {})).status, 200);
  const fx = await Sx1('POST', '/api/sala/forward', { next: true });
  assert.deepEqual([fx.status, fx.data.stage, fx.data.ticket.serviceId], [200, 'Reavaliação', svc.rv]);
  assert.ok(await until(async () => (await Sx1('GET', '/api/sala')).data.current?.code === x3.code), 'a sala livre recebeu a próxima');
  // sem a confirmação exigida, a sala finaliza direto
  assert.equal((await G('PUT', `${Q}/upa`, { confirm: false })).status, 200);
  const sx1 = (await Sx1('GET', '/api/sala')).data;
  assert.deepEqual([sx1.confirm, sx1.current.callState], [false, 'serving']);
  assert.equal((await Sx1('POST', '/api/sala/finish', {})).status, 200);
  assert.equal((await G('PUT', `${Q}/upa`, { confirm: true })).status, 200);
  // os atalhos: "Tudo pela recepção" (e o automático dos grupos desligado); "Profissionais chamam"
  const p1 = await G('PUT', `${Q}/upa`, { preset: 'recepcao' });
  assert.deepEqual(p1.data.upa.flow.map((x) => x.mode), ['recepcao', 'recepcao', 'recepcao', 'recepcao', 'recepcao', 'recepcao']);
  assert.ok((await G('GET', `${Q}/rooms`)).data.groups.every((g) => !g.auto), 'nenhum grupo no automático');
  const cv = await post(At, `${Q}/call`, { desk: 'Guichê 7', ticketId: v3.id }, 200);
  assert.equal(cv.exception, undefined, 'pela recepção, a recepção chama');
  for (const id of [cv.ticket.id, x2.id, x1.id]) await G('POST', `${Q}/tickets/${id}/cancel`);
  const p2 = await G('PUT', `${Q}/upa`, { preset: 'profissionais' });
  assert.deepEqual(p2.data.upa.flow.map((x) => x.mode), ['recepcao', 'sala', 'sala', 'sala', 'sala', 'sala']);
  assert.equal((await G('PUT', `${Q}/upa`, { preset: 'recepcao' })).status, 200);

  /* ---------------------------------------------------------------- indicadores */
  const ind = (await G('GET', `${Q}/indicators`)).data;
  assert.ok(ind.totals.issued >= 12, JSON.stringify(ind.totals)); assert.equal(ind.doctorRooms, true);
  assert.ok(ind.byRoom.some((r) => r.room === 'Consultório 1' && r.calls >= 2), JSON.stringify(ind.byRoom));
  assert.equal(ind.byHour.length, 24); assert.equal(ind.byRisk.length, 6);
  assert.ok(ind.totals.arrived >= 4, `chegadas: ${JSON.stringify(ind.totals)}`); assert.equal(typeof ind.totals.callToArriveMin, 'number', 'chamada–chegada');
  const irv = ind.byRoom.find((r) => r.room === 'Reavaliação 1');
  assert.deepEqual([irv.calls, irv.arrived, irv.noshow, typeof irv.callToArriveMin], [3, 1, 1, 'number'], `por sala: ${JSON.stringify(irv)}`);
  assert.equal(typeof ind.totals.doorToDoctorMin, 'number'); assert.equal(typeof ind.totals.doorToTriageMin, 'number', 'a hora da cor dada pela sala conta como classificação');
  assert.equal((await G('GET', `${Q}/indicators?by=month`)).data.periods[0].key.length, 7);
  const csvRes = await fetch(`${s.base}${Q}/indicators?format=csv&by=week`, { headers: { authorization: `Bearer ${(await anon('POST', '/api/reparticao/login', { token: G.link, username: 'gestor.upa', password: 'senha-de-gestor.upa-2026' })).data.session}` } });
  assert.equal(csvRes.status, 200); assert.match(csvRes.headers.get('content-type'), /text\/csv/);
  const raw = Buffer.from(await csvRes.arrayBuffer());
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM para o Excel');
  const csv = raw.toString('utf8').slice(1);
  assert.ok(csv.startsWith('Indicadores · UPA Centro'), csv.slice(0, 80)); assert.match(csv, /Sala;Consultório 1;\d+/); assert.ok(!/Maria|Carlos|Joana|Ana B/.test(csv));
  assert.equal((await PA('GET', `/api/prefeitura/offices/${upa.id}/queue/indicators?by=week`)).status, 200, 'o painel também');

  /* ---------------------------------------------------------------- revogar, gerar de novo, freio */
  const lk2 = await post(G, `${Q}/rooms/${room[2].id}/link`, {});
  assert.equal((await Sx('GET', '/api/sala')).status, 401, 'o endereço de antes deixou de valer');
  const S2 = bearer(lk2.url.split('/').at(-2));
  assert.equal((await S2('GET', '/api/sala')).status, 200);
  assert.equal((await G('DELETE', `${Q}/rooms/${room[2].id}/link`)).status, 200); assert.equal((await S2('GET', '/api/sala')).status, 401, 'revogado');
  const S3 = bearer((await post(G, `${Q}/rooms/${room[1].id}/link`, {})).url.split('/').at(-2));
  assert.equal((await G('PATCH', `${Q}/rooms/${room[1].id}`, { active: false })).status, 200); assert.equal((await S3('GET', '/api/sala')).status, 401, 'sala desativada');
  await G('PATCH', `${Q}/rooms/${room[1].id}`, { active: true });
  let limited = false;
  for (let i = 0; i < 450 && !limited; i++) limited = (await S3('GET', '/api/sala')).status === 429;
  assert.ok(limited, 'freio por minuto');
  assert.ok(!s.out().includes(lk.url.split('/').at(-2)) && !s.out().includes(ft), 'os endereços não vão para o log');
}

test('SQLite: salas e consultórios, round robin, endereço da sala, apoio, tempo-alvo, QR do acompanhante e indicadores', { timeout: 400000 }, async () => {
  const s = await boot(ENV);
  try { await roteiro(s); } finally { await s.stop(); cleanup(s.dataDir); }
});

test('Postgres: o mesmo roteiro (as tabelas novas nascem no banco)', { timeout: 400000 }, async (t) => {
  const { startPg } = await import('./helpers/pg.js');
  const { createPg } = await import('../server/db/pg.js');
  let pgs;
  try { pgs = await startPg(); } catch (err) { t.skip(`Postgres embutido indisponível: ${err.message}`); return; }
  let s = null; let db = null;
  try {
    s = await boot({ ...ENV, DATABASE_URL: pgs.url });
    await roteiro(s);
    db = await createPg(pgs.url, { max: 2 });
    const cols = await db.all("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('telas_rooms', 'telas_access', 'telas_follow', 'telas_queue_events')");
    const type = (tb, c) => cols.find((x) => x.table_name === tb && x.column_name === c)?.data_type;
    assert.deepEqual([type('telas_rooms', 'state_at'), type('telas_access', 'token_hash'), type('telas_follow', 'expires_at'), type('telas_queue_events', 'ticket_id')], ['bigint', 'text', 'bigint', 'bigint']);
    assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM telas_access WHERE length(token_hash) <> 64")).n), 0, 'só o SHA-256');
  } finally {
    if (db) await db.close().catch(() => {});
    if (s) { await s.stop(); cleanup(s.dataDir); }
    await pgs.stop().catch(() => {});
  }
});
