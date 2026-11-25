// NEXA Telas: o painel de cada repartição com usuário e senha, no servidor de verdade e nos dois bancos (server/telas.js,
// docs/TELAS.md). Os usuários (criar, a regra da senha, entrar, a mesma resposta para usuário e senha errados, o freio por
// usuário, a senha única do link que deixa de valer no primeiro usuário, sessão que cai com a troca de senha, de papel e
// de situação), o papel atendente barrado em tudo o que é do gestor, o controle das TV box restrito à repartição (tela de
// outra repartição e de outro cliente = inexistente), a aprovação e o aviso geral pelo link da SECOM (e só dela), o raio
// e o mapa só para quem alcança a cidade, o catálogo de tipos de aviso com a gravidade (header, category e test no sinal
// de vida só quando cabem; Extremo com a confirmação) e a auditoria com "repartição: <nome> (<usuário>)".
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, cleanup, api, platformLogin, newTenant } from './helpers/srv.js';
import { canal, usuario, auditoria } from './helpers/prefeitura.js'; // DIGITAL ISP: canal ao vivo (HLS) e usuário de permissão limitada

const leaks = (v) => /token_hash|key_hash|link_hash|link_pass|"pass"|"pin"|"salt"|scrypt\$/.test(JSON.stringify(v));
const ENV = { TELAS_LINK_LOGIN_PER_IP: '500', TELAS_LINK_LOGIN_PER_USER: '6', TELAS_ACTIVATE_PER_IP: '50', PUBLIC_HLS_URL: 'https://hls.exemplo.test' };

async function roteiro(s) {
  const anon = api(s.base);
  const bearer = (token) => (method, url, body, headers = {}) => anon(method, url, body, { authorization: `Bearer ${token}`, ...headers });
  const P = api(s.base, await platformLogin(s.base));
  const prof = await P('POST', '/api/platform/feature-profiles', { name: 'Prefeitura', code: 'prefeitura', features: { prefeitura: true } });
  assert.equal(prof.status, 201, JSON.stringify(prof.data));
  assert.equal((await P('POST', '/api/platform/plans', { code: 'p-pref', name: 'Prefeitura', priceCents: 0, profileId: prof.data.id, limits: { channels: 1 } })).status, 201);
  const A = await newTenant(P, s.base, { slug: 'ctl-a', planCode: 'p-pref', status: 'active' });
  const B = await newTenant(P, s.base, { slug: 'ctl-b', planCode: 'p-pref', status: 'active' });
  await canal(A.api, 'TV A'); // DIGITAL ISP: o canal ao vivo (HLS) no lugar do canal do NEXA
  await canal(B.api, 'TV B'); // DIGITAL ISP: o canal ao vivo (HLS) no lugar do canal do NEXA
  const post = async (T, url, body, want = 201) => { const r = await T.api('POST', url, body); assert.equal(r.status, want, `${url}: ${JSON.stringify(r.data)}`); return r.data; };
  const centro = await post(A, '/api/prefeitura/regions', { name: 'Centro' });
  const ubs = await post(A, '/api/prefeitura/offices', { name: 'UBS Centro', type: 'ubs', lat: -22.9, lng: -43.2, regionId: centro.id, address: 'Rua Um, 10', respName: 'Responsável de teste' });
  const escola = await post(A, '/api/prefeitura/offices', { name: 'Escola Norte', type: 'escola', lat: -22.8, lng: -43.25 });
  const secom = await post(A, '/api/prefeitura/offices', { name: 'SECOM', type: 'secom' });
  const dc = await post(A, '/api/prefeitura/offices', { name: 'Defesa Civil', type: 'defesa-civil' });
  const ubsB = await post(B, '/api/prefeitura/offices', { name: 'UBS do B', type: 'ubs', lat: -22.9, lng: -43.2 });
  const secomB = await post(B, '/api/prefeitura/offices', { name: 'SECOM do B', type: 'secom' });
  const users = (o) => `/api/prefeitura/offices/${o.id}/users`;
  const login = (token, username, password) => anon('POST', '/api/reparticao/login', { token, username, password });
  const enter = async (token, username, password) => { const r = await login(token, username, password); assert.equal(r.status, 200, `${username}: ${JSON.stringify(r.data)}`); return bearer(r.data.session); };

  /* ---------------------------------------------------------------- a senha única do link (antes dos usuários) */
  assert.equal((await A.api('POST', `/api/prefeitura/offices/${ubs.id}/link`, {})).status, 400, 'sem usuários, o link pede a senha');
  const linkUbs = (await post(A, `/api/prefeitura/offices/${ubs.id}/link`, { password: 'senha-unica-da-ubs' })).url.split('/').pop();
  const legacy = await login(linkUbs, '', 'senha-unica-da-ubs');
  assert.equal(legacy.status, 200); assert.equal(legacy.data.user, undefined, 'a senha única não tem usuário');
  const L = bearer(legacy.data.session);
  const stL = (await L('GET', '/api/reparticao/state')).data;
  assert.deepEqual([stL.role, stL.user, stL.office.family], ['gestor', null, 'senha']);
  assert.equal((await login(linkUbs, 'alguem', 'senha-unica-da-ubs')).status, 401, 'sem usuários, o campo Usuário fica vazio');

  /* ---------------------------------------------------------------- usuários: criar, a regra da senha, o isolamento */
  assert.deepEqual((await A.api('GET', users(ubs))).data.users, []);
  for (const [body, why] of [
    [{ username: 'ab', password: 'senha-boa-123' }, 'usuário curto'], [{ username: 'Com Espaço', password: 'senha-boa-123' }, 'usuário com espaço'],
    [{ username: 'ana.gestora', password: 'curta' }, 'senha curta'], [{ username: 'ana.gestora', password: '12345678' }, 'senha comum'], [{ username: 'ana.gestora', password: 'ana.gestora' }, 'senha igual ao usuário'],
    [{ username: 'ana.gestora' }, 'sem senha'], [{ username: 'ana.gestora', password: 'senha-boa-123', role: 'prefeito' }, 'papel inexistente'],
  ]) assert.equal((await A.api('POST', users(ubs), body)).status, 400, why);
  const ana = await post(A, users(ubs), { username: 'Ana.Gestora', name: 'Ana', role: 'gestor', password: 'senha-da-ana-2026' });
  assert.deepEqual([ana.username, ana.role, ana.active], ['ana.gestora', 'gestor', true]); assert.ok(!leaks(ana), 'a senha não volta');
  const joao = await post(A, users(ubs), { username: 'joao.guiche', name: 'João', role: 'atendente', password: 'senha-do-joao-2026' });
  assert.equal((await A.api('POST', users(ubs), { username: 'ana.gestora', password: 'outra-senha-2026' })).status, 409, 'usuário repetido na mesma repartição');
  await post(A, users(escola), { username: 'ana.gestora', name: 'Outra Ana', password: 'senha-da-escola-26' });
  const listed = (await A.api('GET', users(ubs))).data;
  assert.deepEqual(listed.users.map((u) => u.username), ['ana.gestora', 'joao.guiche']); assert.ok(!leaks(listed));
  assert.equal((await A.api('GET', '/api/prefeitura')).data.offices.find((o) => o.id === ubs.id).users, 2);
  assert.ok(!leaks((await A.api('GET', '/api/prefeitura')).data));
  // outro cliente não lê, não cria e não mexe nos usuários desta repartição
  assert.equal((await B.api('GET', users(ubs))).status, 404);
  assert.equal((await B.api('POST', users(ubs), { username: 'invasor', password: 'senha-do-invasor-1' })).status, 404);
  assert.equal((await B.api('PATCH', `${users(ubs)}/${ana.id}`, { password: 'trocada-pelo-b-123' })).status, 404);
  assert.equal((await A.api('PATCH', `${users(escola)}/${ana.id}`, { role: 'atendente' })).status, 404, 'o usuário é de outra repartição');
  assert.equal((await B.api('DELETE', `${users(ubsB)}/${ana.id}`)).status, 404);
  assert.equal((await anon('GET', users(ubs))).status, 401);

  /* ---------------------------------------------------------------- com o primeiro usuário, a senha única deixa de valer */
  assert.equal((await L('GET', '/api/reparticao/state')).status, 401, 'a sessão aberta com a senha única caiu');
  assert.equal((await login(linkUbs, '', 'senha-unica-da-ubs')).status, 401, 'a senha única não entra mais');
  const linkUbs2 = (await post(A, `/api/prefeitura/offices/${ubs.id}/link`, {})).url.split('/').pop(); // com usuários, o link não pede senha
  assert.equal((await login(linkUbs, 'ana.gestora', 'senha-da-ana-2026')).status, 401, 'o link de antes não vale');
  const okAna = await login(linkUbs2, 'ANA.gestora ', 'senha-da-ana-2026');
  assert.equal(okAna.status, 200, JSON.stringify(okAna.data));
  assert.deepEqual(okAna.data.user, { username: 'ana.gestora', name: 'Ana', role: 'gestor' }); assert.deepEqual(okAna.data.office, { name: 'UBS Centro', type: 'ubs' }); assert.ok(!leaks(okAna.data));
  const G = bearer(okAna.data.session);
  // a mesma resposta para usuário inexistente, senha errada, link errado e usuário de outra repartição
  const bad = await Promise.all([login(linkUbs2, 'ana.gestora', 'senha-errada-123'), login(linkUbs2, 'ninguem', 'senha-da-ana-2026'), login('A'.repeat(43), 'ana.gestora', 'senha-da-ana-2026'), login(linkUbs2, '', 'senha-da-ana-2026'), login(linkUbs2, { $ne: 1 }, ['x'])]);
  assert.deepEqual(bad.map((r) => r.status), [401, 401, 401, 401, 401]); assert.equal(new Set(bad.map((r) => r.data.error)).size, 1, 'uma mensagem só');
  const linkEscola = (await post(A, `/api/prefeitura/offices/${escola.id}/link`, {})).url.split('/').pop();
  assert.equal((await login(linkEscola, 'ana.gestora', 'senha-da-ana-2026')).status, 401, 'a senha da Ana da UBS não entra na escola');
  assert.equal((await login(linkUbs2, 'ana.gestora', 'senha-da-escola-26')).status, 401);
  const E = await enter(linkEscola, 'ana.gestora', 'senha-da-escola-26');
  // o freio por usuário: depois de 6 tentativas em 10 min, nem a senha certa entra (os outros usuários seguem entrando)
  await post(A, users(ubs), { username: 'freio.teste', password: 'senha-do-freio-2026' });
  for (let i = 0; i < 6; i++) assert.equal((await login(linkUbs2, 'freio.teste', 'errada-de-proposito')).status, 401);
  assert.equal((await login(linkUbs2, 'freio.teste', 'senha-do-freio-2026')).status, 401, 'freio por usuário');
  const J = await enter(linkUbs2, 'joao.guiche', 'senha-do-joao-2026');

  /* ---------------------------------------------------------------- o atendente: só Atendimento e Recepção */
  const stJ = (await J('GET', '/api/reparticao/state')).data;
  assert.deepEqual(Object.keys(stJ).sort(), ['modules', 'office', 'panic', 'role', 'serverTime', 'user'], 'nada de avisos, alertas, telas nem pedidos (só a senha e o botão de pânico)');
  assert.deepEqual([stJ.role, stJ.user.username, stJ.modules], ['atendente', 'joao.guiche', { senha: true }]);
  const svc = await G('POST', '/api/reparticao/queue/services', { name: 'Atendimento geral', prefix: 'A' });
  assert.equal(svc.status, 201, JSON.stringify(svc.data));
  assert.equal((await J('GET', '/api/reparticao/queue')).status, 200);
  const tk = await J('POST', '/api/reparticao/queue/tickets', { serviceId: svc.data.id, name: 'Pessoa de Teste' });
  assert.equal(tk.status, 201, JSON.stringify(tk.data));
  const called = await J('POST', '/api/reparticao/queue/call', { desk: 'Guichê 1' });
  assert.equal(called.status, 200, JSON.stringify(called.data)); assert.equal(called.data.ticket.code, 'A001');
  assert.equal((await J('POST', `/api/reparticao/queue/tickets/${tk.data.ticket.id}/repeat`)).status, 200);
  assert.equal((await J('POST', `/api/reparticao/queue/tickets/${tk.data.ticket.id}/finish`)).status, 200);
  for (const [m, url, body] of [
    ['PUT', '/api/reparticao/avisos', { items: ['Do atendente.'] }], ['POST', '/api/reparticao/alerts', { title: 'Do atendente', durationMin: 5, scope: { kind: 'office' } }], ['POST', '/api/reparticao/alerts/preview', { scope: { kind: 'office' } }],
    ['GET', '/api/reparticao/cards'], ['POST', '/api/reparticao/cards', { kind: 'unidade', lines: ['x'] }], ['GET', '/api/reparticao/devices'], ['POST', '/api/reparticao/keys', {}],
    ['PUT', '/api/reparticao/queue/config', { title: 'X' }], ['POST', '/api/reparticao/queue/services', { name: 'Outra', prefix: 'B' }], ['DELETE', `/api/reparticao/queue/services/${svc.data.id}`], ['POST', '/api/reparticao/queue/totem'],
    ['POST', `/api/reparticao/queue/tickets/${tk.data.ticket.id}/risk`, { risk: 'verde' }], ['GET', '/api/reparticao/approvals'], ['GET', '/api/reparticao/mapa'], ['PUT', '/api/reparticao/geral', { items: [] }], ['GET', '/api/reparticao/missing'],
  ]) assert.equal((await J(m, url, body)).status, 403, `atendente em ${m} ${url}`);

  /* ---------------------------------------------------------------- a sessão cai com a troca de papel, de senha e de situação */
  assert.equal((await A.api('PATCH', `${users(ubs)}/${joao.id}`, { role: 'gestor' })).status, 200);
  assert.equal((await J('GET', '/api/reparticao/queue')).status, 401, 'o papel mudou: entra de novo');
  const J2 = await enter(linkUbs2, 'joao.guiche', 'senha-do-joao-2026');
  assert.equal((await J2('GET', '/api/reparticao/devices')).status, 200, 'agora é gestor');
  assert.equal((await A.api('PATCH', `${users(ubs)}/${joao.id}`, { password: 'senha-nova-do-joao-1' })).status, 200);
  assert.equal((await J2('GET', '/api/reparticao/state')).status, 401, 'a senha mudou');
  assert.equal((await login(linkUbs2, 'joao.guiche', 'senha-do-joao-2026')).status, 401);
  const J3 = await enter(linkUbs2, 'joao.guiche', 'senha-nova-do-joao-1');
  assert.equal((await A.api('PATCH', `${users(ubs)}/${joao.id}`, { active: false })).status, 200);
  assert.equal((await J3('GET', '/api/reparticao/state')).status, 401, 'desativado');
  assert.equal((await login(linkUbs2, 'joao.guiche', 'senha-nova-do-joao-1')).status, 401);
  assert.equal((await A.api('PATCH', `${users(ubs)}/${joao.id}`, { active: true, name: 'João da Recepção' })).status, 200);
  const J4 = await enter(linkUbs2, 'joao.guiche', 'senha-nova-do-joao-1');
  assert.equal((await A.api('DELETE', `${users(ubs)}/${joao.id}`)).status, 200);
  assert.equal((await J4('GET', '/api/reparticao/state')).status, 401, 'apagado');
  assert.equal((await G('GET', '/api/reparticao/state')).status, 200, 'a sessão dos outros usuários segue');
  // sessão forjada com o id de outro usuário não passa pela assinatura
  const parts = okAna.data.session.split('.'); parts[4] = String(Number(parts[4]) + 1);
  assert.equal((await bearer(parts.join('.'))('GET', '/api/reparticao/state')).status, 401);

  /* ---------------------------------------------------------------- controle das TV box: só as da própria repartição */
  const kUbs = await G('POST', '/api/reparticao/keys', { name: 'Recepção' });
  assert.equal(kUbs.status, 201, JSON.stringify(kUbs.data)); assert.match(kUbs.data.key, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/); assert.equal(kUbs.data.officeId, ubs.id);
  const kForged = await G('POST', '/api/reparticao/keys', { name: 'Forjada', officeId: escola.id });
  assert.equal(kForged.data.officeId, ubs.id, 'a chave nasce na repartição da sessão, não na do pedido');
  const activate = async (key) => { const r = await anon('POST', '/api/telas/activate', { key, device: { model: 'TV Box de teste', android: '11', appVersion: '1.2.0' } }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  const d1 = await activate(kUbs.data.key);
  const d2 = await activate((await post(A, '/api/prefeitura/keys', { officeId: escola.id, name: 'Escola, pátio' })).key);
  const d3 = await activate((await post(B, '/api/prefeitura/keys', { officeId: ubsB.id, name: 'UBS do B' })).key);
  const T1 = bearer(d1.token); const T2 = bearer(d2.token);
  const hb = (T) => T('POST', '/api/telas/heartbeat', { rev: 'x', state: 'playing', source: 'hls', appVersion: '1.2.0', uptimeSec: 60, net: 'wifi', lastError: null, locked: true });
  assert.equal((await hb(T1)).status, 200); assert.equal((await hb(T2)).status, 200);
  const devs = (await G('GET', '/api/reparticao/devices')).data;
  assert.deepEqual(devs.devices.map((d) => [d.id, d.name, d.officeId]), [[d1.deviceId, 'Recepção', ubs.id]], 'só as telas desta repartição'); assert.ok(!leaks(devs));
  assert.deepEqual(devs.keys.map((k) => k.deviceName), ['Forjada']);
  // o que o gestor define na tela: nome, formato, volume, horário; o PIN e os avisos próprios da tela ficam com a prefeitura
  const pt = await G('PATCH', `/api/reparticao/devices/${d1.deviceId}`, { name: 'Recepção da UBS', officeId: escola.id, groups: [1], lat: 1, lng: 1, config: { layout: 'side', volume: 40, muted: true, schedule: { tvOn: '07:00', tvOff: '19:00', days: [1, 2, 3, 4, 5] }, pin: '9999', exitSeq: ['OK', 'OK', 'OK', 'OK'], tickerItems: ['Da tela.'] } });
  assert.equal(pt.status, 200, JSON.stringify(pt.data));
  assert.deepEqual([pt.data.name, pt.data.officeId, pt.data.lat, pt.data.config.layout, pt.data.config.volume, pt.data.config.hasPin, pt.data.config.tickerItems, pt.data.config.exitSeq], ['Recepção da UBS', ubs.id, null, 'side', 40, false, undefined, undefined]);
  const cfg = (await T1('GET', '/api/telas/config')).data;
  assert.deepEqual([cfg.layout, cfg.stream.volume, cfg.stream.muted, cfg.schedule, cfg.device.name], ['side', 40, true, { tvOn: '07:00', tvOff: '19:00', days: [1, 2, 3, 4, 5] }, 'Recepção da UBS']);
  assert.equal((await G('PATCH', `/api/reparticao/devices/${d1.deviceId}`, { config: { volume: 500 } })).status, 400);
  // tela de outra repartição e de outro cliente: inexistente em toda rota
  for (const id of [d2.deviceId, d3.deviceId, 999999]) {
    for (const [m, url, body] of [['PATCH', '', { name: 'Invadida' }], ['POST', '/commands', { type: 'reboot' }], ['GET', '/screenshot'], ['POST', '/revoke'], ['DELETE', '']]) assert.equal((await G(m, `/api/reparticao/devices/${id}${url}`, body)).status, 404, `${m} ${url} na tela ${id}`);
  }
  assert.equal((await E('GET', '/api/reparticao/devices')).data.devices[0].name, 'Escola, pátio', 'a tela da escola não foi tocada');
  assert.equal((await hb(T2)).status, 200, 'e segue no ar');
  // comandos, captura e a chave: os da própria repartição
  assert.equal((await G('POST', `/api/reparticao/devices/${d1.deviceId}/commands`, { type: 'formatar' })).status, 400);
  const cmd = await G('POST', `/api/reparticao/devices/${d1.deviceId}/commands`, { type: 'screenshot' });
  assert.equal(cmd.status, 201); assert.deepEqual((await hb(T1)).data.commands.map((c) => c.type), ['screenshot']);
  assert.equal((await G('GET', `/api/reparticao/devices/${d1.deviceId}/screenshot`)).status, 404, 'ainda sem captura');
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 0x41), Buffer.from([0xff, 0xd9])]);
  assert.equal((await fetch(`${s.base}/api/telas/screenshot`, { method: 'POST', headers: { authorization: `Bearer ${d1.token}`, 'content-type': 'image/jpeg' }, body: jpeg })).status, 204);
  const shot = await fetch(`${s.base}/api/reparticao/devices/${d1.deviceId}/screenshot`, { headers: { authorization: `Bearer ${okAna.data.session}` } });
  assert.equal(shot.status, 200); assert.equal(shot.headers.get('content-type'), 'image/jpeg'); assert.ok(Buffer.from(await shot.arrayBuffer()).equals(jpeg));
  assert.equal((await E('GET', `/api/reparticao/devices/${d1.deviceId}/screenshot`)).status, 404, 'a escola não vê a captura da UBS');
  assert.equal((await E('DELETE', `/api/reparticao/keys/${devs.keys[0].id}`)).status, 404, 'chave de outra repartição');
  assert.equal((await G('DELETE', `/api/reparticao/keys/${devs.keys[0].id}`)).status, 200);
  // o formato da repartição (aba Telas) e desvincular
  assert.equal((await G('PUT', '/api/reparticao/avisos', { layout: 'ticker' })).status, 200);
  assert.equal((await G('DELETE', `/api/reparticao/devices/${d1.deviceId}`)).status, 409, 'revogue antes de excluir');
  assert.equal((await G('POST', `/api/reparticao/devices/${d1.deviceId}/revoke`)).status, 200);
  assert.equal((await hb(T1)).status, 401, 'a tela desvinculada volta à tela da chave');
  assert.equal((await G('PATCH', `/api/reparticao/devices/${d1.deviceId}`, { name: 'Depois' })).status, 409);
  assert.equal((await G('DELETE', `/api/reparticao/devices/${d1.deviceId}`)).status, 200);
  assert.deepEqual((await G('GET', '/api/reparticao/devices')).data.devices, []);
  const d4 = await activate((await G('POST', '/api/reparticao/keys', { name: 'Farmácia' })).data.key);
  const T4 = bearer(d4.token); assert.equal((await hb(T4)).status, 200);

  /* ---------------------------------------------------------------- SECOM: a fila de aprovação e o aviso geral pelo link dela */
  await post(A, users(secom), { username: 'comunicacao', name: 'Equipe da SECOM', password: 'senha-da-secom-2026' });
  await post(A, users(secom), { username: 'estagio', role: 'atendente', password: 'senha-do-estagio-26' });
  const linkSecom = (await post(A, `/api/prefeitura/offices/${secom.id}/link`, {})).url.split('/').pop();
  const S = await enter(linkSecom, 'comunicacao', 'senha-da-secom-2026');
  const Sa = await enter(linkSecom, 'estagio', 'senha-do-estagio-26');
  await post(B, users(secomB), { username: 'comunicacao', password: 'senha-da-secom-do-b' });
  const Sb = await enter((await post(B, `/api/prefeitura/offices/${secomB.id}/link`, {})).url.split('/').pop(), 'comunicacao', 'senha-da-secom-do-b');
  assert.equal((await A.api('PUT', '/api/prefeitura/defaults', { approval: true })).status, 200);
  const req1 = await E('PUT', '/api/reparticao/avisos', { items: ['Reunião de pais na quinta, 19h.'] });
  assert.equal(req1.status, 202, JSON.stringify(req1.data));
  const req2 = await G('POST', '/api/reparticao/cards', { kind: 'unidade', title: 'Horário', lines: ['Das 7h às 17h'] });
  assert.equal(req2.status, 202);
  const fila = (await S('GET', '/api/reparticao/approvals')).data;
  assert.deepEqual(fila.pending.map((a) => [a.office, a.kind, a.officeType]), [['Escola Norte', 'avisos', 'escola'], ['UBS Centro', 'card', 'ubs']], 'os pedidos de TODAS as repartições do cliente');
  assert.equal(fila.pending[0].requestedBy, 'repartição: Escola Norte (ana.gestora)'); assert.ok(fila.pending[0].officeLayout); assert.ok(!leaks(fila));
  for (const X of [G, E, Sa]) { assert.equal((await X('GET', '/api/reparticao/approvals')).status, 403); assert.equal((await X('POST', `/api/reparticao/approvals/${fila.pending[0].id}/approve`)).status, 403); }
  assert.deepEqual((await Sb('GET', '/api/reparticao/approvals')).data.pending, [], 'a SECOM de outro cliente não vê');
  assert.equal((await Sb('POST', `/api/reparticao/approvals/${fila.pending[0].id}/approve`)).status, 404);
  assert.equal((await S('POST', `/api/reparticao/approvals/${fila.pending[1].id}/reject`, {})).status, 400, 'devolver pede o motivo');
  assert.equal((await S('POST', `/api/reparticao/approvals/${fila.pending[1].id}/reject`, { note: 'Confirme o horário de sábado.' })).status, 200);
  assert.equal((await S('POST', `/api/reparticao/approvals/${fila.pending[0].id}/approve`)).status, 200);
  assert.equal((await S('POST', `/api/reparticao/approvals/${fila.pending[0].id}/approve`)).status, 409, 'um pedido se decide uma vez');
  assert.deepEqual((await E('GET', '/api/reparticao/state')).data.avisos.items, ['Reunião de pais na quinta, 19h.'], 'aprovado: os avisos valem');
  assert.deepEqual((await T2('GET', '/api/telas/config')).data.ticker.items, ['Reunião de pais na quinta, 19h.']);
  const stG = (await G('GET', '/api/reparticao/state')).data;
  assert.deepEqual(stG.approval.requests.map((r) => [r.status, r.note, r.decidedBy]), [['rejected', 'Confirme o horário de sábado.', 'repartição: SECOM (comunicacao)']]);
  assert.deepEqual((await G('GET', '/api/reparticao/cards')).data.cards, [], 'devolvido: nada foi às telas');
  assert.equal((await A.api('PUT', '/api/prefeitura/defaults', { approval: false })).status, 200);
  // o aviso geral: os avisos do padrão da prefeitura (valem nas telas sem avisos mais específicos)
  const stS = (await S('GET', '/api/reparticao/state')).data;
  assert.deepEqual([stS.general.items, stS.office.family, stS.alertScopes], [[], 'comando', ['city', 'regions', 'groups', 'office', 'radius']]);
  for (const X of [G, E, Sa]) assert.equal((await X('PUT', '/api/reparticao/geral', { items: ['Invasão.'] })).status, 403);
  assert.equal((await S('PUT', '/api/reparticao/geral', { items: 'texto' })).status, 400);
  const ger = await S('PUT', '/api/reparticao/geral', { items: ['Ouvidoria: 156.', '[institucional] Obra entregue.'] });
  assert.equal(ger.status, 200, JSON.stringify(ger.data));
  const defs = (await A.api('GET', '/api/prefeitura')).data.defaults;
  assert.deepEqual(defs.config.tickerItems, ['Ouvidoria: 156.', '[institucional] Obra entregue.']); assert.equal(defs.approval, false, 'o resto do padrão fica como estava');
  assert.deepEqual((await T4('GET', '/api/telas/config')).data.ticker.items, ['Ouvidoria: 156.', 'Obra entregue.'], 'a UBS não tem avisos próprios: mostra o geral');
  assert.deepEqual((await T2('GET', '/api/telas/config')).data.ticker.items, ['Reunião de pais na quinta, 19h.'], 'a escola tem os dela');
  assert.deepEqual((await Sb('GET', '/api/reparticao/state')).data.general.items, [], 'o aviso geral é de cada cliente');

  /* ---------------------------------------------------------------- Defesa Civil: o mapa, o raio, o catálogo e a gravidade */
  await post(A, users(dc), { username: 'plantao', name: 'Plantão', password: 'senha-da-defesa-2026' });
  const D = await enter((await post(A, `/api/prefeitura/offices/${dc.id}/link`, {})).url.split('/').pop(), 'plantao', 'senha-da-defesa-2026');
  const mapa = (await D('GET', '/api/reparticao/mapa')).data;
  assert.deepEqual(mapa.offices.map((o) => o.name).sort(), ['Defesa Civil', 'Escola Norte', 'SECOM', 'UBS Centro'], 'só as repartições deste cliente');
  assert.deepEqual(Object.keys(mapa.offices[0]).sort(), ['devices', 'groups', 'id', 'lat', 'lng', 'name', 'online', 'regionId', 'type'], 'nada de endereço nem de responsável');
  assert.ok(!/Rua Um|Responsável de teste/.test(JSON.stringify(mapa)));
  assert.deepEqual(mapa.offices.find((o) => o.name === 'UBS Centro').devices, 1);
  for (const X of [G, E]) assert.equal((await X('GET', '/api/reparticao/mapa')).status, 403);
  const raio = { kind: 'radius', lat: -22.9, lng: -43.2, meters: 2000 };
  assert.deepEqual((await D('POST', '/api/reparticao/alerts/preview', { scope: raio })).data, { total: 1, online: 1, offices: 1 });
  for (const X of [G, E]) { assert.equal((await X('POST', '/api/reparticao/alerts/preview', { scope: raio })).status, 403, 'o raio é só de quem alcança a cidade'); assert.equal((await X('POST', '/api/reparticao/alerts', { title: 'Raio', durationMin: 5, scope: raio })).status, 403); }
  const alertsOf = async (T) => (await hb(T)).data.alerts;
  const sev = await D('POST', '/api/reparticao/alerts', { category: 'meteorologico', kind: 'chuva-intensa', title: 'Chuva intensa no Centro', text: 'Evite sair.', level: 'warn', durationMin: 30, scope: raio });
  assert.equal(sev.status, 201, JSON.stringify(sev.data));
  assert.deepEqual([sev.data.alert.category, sev.data.alert.kind, sev.data.alert.test, sev.data.alert.header], ['meteorologico', 'chuva-intensa', false, 'ALERTA SEVERO · DEFESA CIVIL']);
  const a4 = (await alertsOf(T4)).find((a) => a.title === 'Chuva intensa no Centro');
  assert.deepEqual([a4.level, a4.header, a4.category, a4.test], ['warn', 'ALERTA SEVERO · DEFESA CIVIL', 'meteorologico', undefined], 'no sinal de vida: header e category; test só no teste');
  assert.deepEqual(await alertsOf(T2), [], 'a escola está fora do raio');
  assert.equal((await D('POST', '/api/reparticao/alerts', { category: 'geologico', kind: 'chuva-intensa', title: 'Torto', durationMin: 5, scope: { kind: 'city' } })).status, 400, 'o tipo não é da categoria');
  assert.equal((await D('POST', '/api/reparticao/alerts', { category: 'inventada', title: 'Torto', durationMin: 5, scope: { kind: 'city' } })).status, 400);
  // Extremo: o nível máximo pede a confirmação a mais, no link da Defesa Civil e no Painel da Prefeitura
  const ext = { category: 'geologico', kind: 'deslizamento', title: 'Risco de deslizamento', level: 'critical', sound: true, durationMin: 30, scope: { kind: 'city' } };
  const noOk = await D('POST', '/api/reparticao/alerts', ext);
  assert.equal(noOk.status, 400); assert.match(noOk.data.error, /nível máximo/);
  assert.equal((await A.api('POST', '/api/prefeitura/alerts', { title: 'Pelo painel', level: 'critical', durationMin: 5, scope: { kind: 'city' } })).status, 400);
  const extOk = await D('POST', '/api/reparticao/alerts', { ...ext, confirmExtreme: true });
  assert.equal(extOk.status, 201); assert.equal(extOk.data.alert.header, 'ALERTA EXTREMO · DEFESA CIVIL');
  // teste e simulação: marcado, com o título começando por "TESTE:" e o cabeçalho próprio
  const tst = await D('POST', '/api/reparticao/alerts', { category: 'teste', kind: 'simulado', title: 'Simulado da Defesa Civil', text: 'Não há perigo real.', level: 'info', durationMin: 10, scope: { kind: 'city' } });
  assert.equal(tst.status, 201); assert.deepEqual([tst.data.alert.title, tst.data.alert.test, tst.data.alert.header], ['TESTE: Simulado da Defesa Civil', true, 'TESTE DO SISTEMA']);
  const t2 = (await alertsOf(T2)).find((a) => a.id === tst.data.alert.id);
  assert.deepEqual([t2.title, t2.header, t2.category, t2.test], ['TESTE: Simulado da Defesa Civil', 'TESTE DO SISTEMA', 'teste', true]);
  // alerta como os de antes (sem categoria): nenhum campo novo no sinal de vida; outra repartição no informativo: "AVISO · nome"
  const old = await A.api('POST', '/api/prefeitura/alerts', { title: 'Alerta de antes', level: 'warn', durationMin: 5, scope: { kind: 'city' } });
  assert.equal(old.status, 201, JSON.stringify(old.data));
  assert.deepEqual(Object.keys((await alertsOf(T2)).find((a) => a.id === old.data.alert.id)).sort(), ['id', 'level', 'sound', 'text', 'title', 'until']);
  const panel = await A.api('POST', '/api/prefeitura/alerts', { category: 'saude', kind: 'surto', title: 'Alerta de saúde', level: 'critical', confirmExtreme: true, durationMin: 5, scope: { kind: 'office', office: escola.id } });
  assert.equal(panel.status, 201); assert.equal(panel.data.alert.header, 'ALERTA EXTREMO · PREFEITURA');
  const ubsAl = await G('POST', '/api/reparticao/alerts', { title: 'Sem médico hoje', level: 'info', category: 'saude', kind: 'surto', durationMin: 5, scope: { kind: 'office' } });
  assert.equal(ubsAl.status, 201); assert.deepEqual([ubsAl.data.alert.header, ubsAl.data.alert.category], ['AVISO · UBS CENTRO', null], 'o catálogo é de quem alcança a cidade');
  const ubsWarn = await G('POST', '/api/reparticao/alerts', { title: 'Atenção na UBS', level: 'critical', durationMin: 5, scope: { kind: 'office' } });
  assert.equal(ubsWarn.status, 201, 'as outras repartições seguem como antes'); assert.equal(ubsWarn.data.alert.header, null);
  // o texto sugerido que a prefeitura troca: só a diferença fica guardada; a Defesa Civil recebe
  assert.equal((await A.api('PUT', '/api/prefeitura/defaults', { alertTexts: { vendaval: { title: 'V', text: 'x' } } })).status, 400);
  const tx = await A.api('PUT', '/api/prefeitura/defaults', { alertTexts: { vendaval: { title: 'Vento forte na cidade', text: 'Fique em casa.' }, inventado: { title: 'Não existe', text: 'x' }, granizo: { title: 'Chuva de granizo', text: 'Risco de granizo. Abrigue-se em local coberto, afaste-se das janelas e guarde o veículo se puder.' } } });
  assert.equal(tx.status, 200, JSON.stringify(tx.data));
  assert.deepEqual(tx.data.alertTexts, { vendaval: { title: 'Vento forte na cidade', text: 'Fique em casa.' } }, 'tipo desconhecido e texto igual ao catálogo não ficam');
  assert.deepEqual((await D('GET', '/api/reparticao/state')).data.alertTexts, tx.data.alertTexts);
  assert.equal((await G('GET', '/api/reparticao/state')).data.alertTexts, undefined);
  assert.deepEqual((await A.api('PUT', '/api/prefeitura/defaults', { alertTexts: null })).data.alertTexts, {});

  /* ---------------------------------------------------------------- a auditoria leva quem fez */
  const audit = JSON.stringify(await auditoria(s, A.id));
  for (const want of [/repartição: UBS Centro \(ana\.gestora\)/, /repartição: SECOM \(comunicacao\)/, /repartição: Defesa Civil \(plantao\)/, /usuário \\"ana\.gestora\\" \(gestor\) criado no painel da repartição \\"UBS Centro\\" \(a senha única do link deixou de valer\)/,
    /usuário \\"joao\.guiche\\" do painel da repartição \\"UBS Centro\\": senha trocada/, /comando screenshot para a tela .* pelo painel da repartição/, /tela \\"Recepção da UBS\\" \(#\d+\) revogada pelo painel da repartição/,
    /APROVADO pelo link da SECOM/, /RECUSADO: Confirme o horário de sábado\. pelo link da SECOM/, /aviso geral da prefeitura alterado pela SECOM/, /entrada pelo link de controle da repartição \(usuário ana\.gestora, gestor\)/]) assert.match(audit, want);
  assert.ok(!/senha-da-ana-2026|senha-nova-do-joao-1|senha-unica-da-ubs/.test(audit), 'nenhuma senha na auditoria');
  assert.ok(!/senha-da-ana-2026|senha-nova-do-joao-1|senha-unica-da-ubs/.test(s.out()), 'nenhuma senha no log do servidor');
  // excluir a repartição leva os usuários dela
  assert.equal((await A.api('DELETE', `/api/prefeitura/offices/${secom.id}`)).status, 200);
  assert.equal((await S('GET', '/api/reparticao/state')).status, 401);
}

test('SQLite: usuários da repartição, papel atendente, controle das TV box, aprovação pelo link da SECOM, raio, mapa e tipos de aviso', { timeout: 300000 }, async () => {
  const s = await boot(ENV);
  try { await roteiro(s); } finally { await s.stop(); cleanup(s.dataDir); }
});

test('Postgres: o mesmo roteiro (a tabela dos usuários e a do tipo do alerta nascem no banco)', { timeout: 300000 }, async (t) => {
  const { startPg } = await import('./helpers/pg.js');
  const { createPg } = await import('../server/db/pg.js');
  let pgs;
  try { pgs = await startPg(); } catch (err) { t.skip(`Postgres embutido indisponível: ${err.message}`); return; }
  let s = null; let db = null;
  try {
    s = await boot({ ...ENV, DATABASE_URL: pgs.url });
    await roteiro(s);
    db = await createPg(pgs.url, { max: 2 });
    const cols = await db.all("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('telas_office_users', 'telas_alert_info')");
    const type = (tb, c) => cols.find((x) => x.table_name === tb && x.column_name === c)?.data_type;
    assert.deepEqual([type('telas_office_users', 'tenant_id'), type('telas_office_users', 'office_id'), type('telas_office_users', 'pass'), type('telas_alert_info', 'alert_id')], ['bigint', 'bigint', 'text', 'bigint']);
    for (const u of await db.all('SELECT username, pass FROM telas_office_users')) { assert.match(u.pass, /^scrypt\$/, 'só o resumo cifrado da senha'); assert.equal(u.username, u.username.toLowerCase()); }
  } finally {
    if (db) await db.close().catch(() => {});
    if (s) { await s.stop(); cleanup(s.dataDir); }
    await pgs.stop().catch(() => {});
  }
});
