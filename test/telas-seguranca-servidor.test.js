// NEXA Telas: segurança pública (contrato do aparelho §10), no servidor de verdade e nos dois bancos (server/telas.js,
// server/telas-seguranca.js, server/telas-desaparecidos.js). O botão de pânico silencioso (não aparece em rota nenhuma do
// aparelho; chega ao CCO e ao painel; sem CCO não finge que enviou; freio); os emissores conveniados (Polícia Civil e
// Militar): não leem telas, avisos nem cartões de ninguém, o envio fica pendente e não chega ao sinal de vida até o CCO
// aprovar, "emitir direto" libera o alerta e nunca a cartela; a fila do CCO e a da SECOM; a cartela policial com as travas
// (procedimento, matrícula, mandado, a frase fixa, 15 dias); a chave de integração (hash, revogação, escopo, plano).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { boot, cleanup, api, platformLogin, newTenant } from './helpers/srv.js';

const ENV = { TELAS_LINK_LOGIN_PER_IP: '500', TELAS_ACTIVATE_PER_IP: '50', TELAS_ALERTS_PER_OFFICE: '14', PUBLIC_HLS_URL: 'https://hls.exemplo.test', PLATFORM_PUBLIC_URL: 'https://painel.exemplo.test', STORAGE_DRIVER: 'local' };

async function roteiro(s, { sqlite = false } = {}) {
  const anon = api(s.base);
  const bearer = (token) => (method, url, body, headers = {}) => anon(method, url, body, { authorization: `Bearer ${token}`, ...headers });
  const P = api(s.base, await platformLogin(s.base));
  const prof = async (code, features) => { const r = await P('POST', '/api/platform/feature-profiles', { name: code, code, features }); assert.equal(r.status, 201, JSON.stringify(r.data)); assert.equal((await P('POST', '/api/platform/plans', { code: `p-${code}`, name: code, priceCents: 0, profileId: r.data.id, limits: { channels: 1 } })).status, 201); };
  await prof('pref-api', { prefeitura: true, api: true }); await prof('pref-sem', { prefeitura: true });
  const A = await newTenant(P, s.base, { slug: 'seg-a', planCode: 'p-pref-api', status: 'active' });
  const B = await newTenant(P, s.base, { slug: 'seg-b', planCode: 'p-pref-api', status: 'active' });
  const Cx = await newTenant(P, s.base, { slug: 'seg-c', planCode: 'p-pref-sem', status: 'active' });
  for (const [T, slug] of [[A, 'seg-a-tv'], [B, 'seg-b-tv'], [Cx, 'seg-c-tv']]) assert.equal((await T.api('POST', '/api/channels', { name: 'TV', slug })).status, 201);
  const post = async (T, url, body, want = 201) => { const r = await T.api('POST', url, body); assert.equal(r.status, want, `${url}: ${JSON.stringify(r.data)}`); return r.data; };
  const office = (T, name, type, extra = {}) => post(T, '/api/prefeitura/offices', { name, type, ...extra });
  const centro = await post(A, '/api/prefeitura/regions', { name: 'Centro' });
  const ubs = await office(A, 'UBS Centro', 'ubs', { lat: -22.9, lng: -43.2, regionId: centro.id, address: 'Rua Um, 10' });
  const escola = await office(A, 'Escola Norte', 'escola', { lat: -22.8, lng: -43.3 });
  const terminal = await office(A, 'Terminal Central', 'terminal');
  const secom = await office(A, 'SECOM', 'secom'); const dc = await office(A, 'Defesa Civil', 'defesa-civil');
  const pm = await office(A, 'Polícia Militar', 'policia-militar'); const pc = await office(A, 'Polícia Civil', 'policia-civil');
  assert.deepEqual([pm.modules.avisos, pm.modules.panico, ubs.modules.panico, escola.modules.panico, terminal.modules.panico], [false, false, true, true, false]);
  const links = new Map(); // um link por repartição (gerar outro derrubaria a sessão do usuário anterior)
  const enter = async (T, o, username, role = 'gestor') => {
    await post(T, `/api/prefeitura/offices/${o.id}/users`, { username, role, password: `senha-de-${username}-2026` });
    if (!links.has(o.id)) links.set(o.id, (await post(T, `/api/prefeitura/offices/${o.id}/link`, {})).url.split('/').pop());
    const link = links.get(o.id);
    const r = await anon('POST', '/api/reparticao/login', { token: link, username, password: `senha-de-${username}-2026` });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return Object.assign(bearer(r.data.session), { session: r.data.session, link });
  };
  const U = await enter(A, ubs, 'gestor.ubs'); const Ua = await enter(A, ubs, 'guiche.ubs', 'atendente'); const E = await enter(A, escola, 'gestor.escola'); const Tm = await enter(A, terminal, 'gestor.terminal');
  const S = await enter(A, secom, 'comunicacao'); const D = await enter(A, dc, 'plantao'); const PM = await enter(A, pm, 'cabo.teste'); const PC = await enter(A, pc, 'delegacia');
  const activate = async (T, o, name) => { const k = await post(T, '/api/prefeitura/keys', { officeId: o.id, name }); const r = await anon('POST', '/api/telas/activate', { key: k.key, device: { model: 'TV Box de teste' } }); assert.equal(r.status, 200); return bearer(r.data.token); };
  const T1 = await activate(A, ubs, 'UBS, recepção'); const T2 = await activate(A, escola, 'Escola, pátio');
  const hb = async (T) => { const r = await T('POST', '/api/telas/heartbeat', { rev: 'x', state: 'playing', source: 'hls', appVersion: '1.2.0', uptimeSec: 60, net: 'wifi', lastError: null, locked: true }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  await hb(T1); await hb(T2);

  /* ---------------------------------------------------------------- botão de pânico: sem CCO não finge que enviou */
  const semCco = await Ua('POST', '/api/reparticao/panic', {});
  assert.equal(semCco.status, 409, JSON.stringify(semCco.data)); assert.match(semCco.data.error, /não tem uma repartição de Segurança/);
  assert.deepEqual((await Ua('GET', '/api/reparticao/panic/mine')).data.sent, [], 'nada foi gravado'); assert.equal((await Ua('GET', '/api/reparticao/panic/mine')).data.receiver, false);
  assert.deepEqual((await A.api('GET', '/api/prefeitura/panic')).data.open, []);
  const cco = await office(A, 'Guarda Municipal (CCO)', 'seguranca');
  const G = await enter(A, cco, 'operador.cco');
  const stUa = (await Ua('GET', '/api/reparticao/state')).data;
  assert.deepEqual([stUa.panic, stUa.role], [true, 'atendente'], 'o atendente também tem o botão');
  assert.equal((await Tm('GET', '/api/reparticao/state')).data.panic, false);
  assert.equal((await Tm('POST', '/api/reparticao/panic', {})).status, 403, 'módulo desligado no terminal');
  assert.equal((await anon('POST', '/api/reparticao/panic', {})).status, 401);
  const p1 = await Ua('POST', '/api/reparticao/panic', {});
  assert.equal(p1.status, 201, JSON.stringify(p1.data)); assert.ok(p1.data.id > 0 && p1.data.sentAt > 0);
  // silencioso: nada em rota nenhuma do aparelho
  for (const r of [await hb(T1), (await T1('GET', '/api/telas/config')).data, (await T1('GET', '/api/telas/queue')).data, await hb(T2)]) assert.ok(!/p[aâ]nic/i.test(JSON.stringify(r)), 'o pânico não aparece em tela nenhuma');
  assert.deepEqual((await hb(T1)).alerts, []);
  // chega ao CCO e ao painel, com a repartição, o endereço, o ponto e quem acionou
  const oc = (await G('GET', '/api/reparticao/panic')).data;
  assert.equal(oc.open.length, 1);
  assert.deepEqual([oc.open[0].office, oc.open[0].officeType, oc.open[0].address, oc.open[0].lat, oc.open[0].lng, oc.open[0].sentBy, oc.open[0].status], ['UBS Centro', 'ubs', 'Rua Um, 10', -22.9, -43.2, 'repartição: UBS Centro (guiche.ubs)', 'novo']);
  assert.equal((await A.api('GET', '/api/prefeitura/panic')).data.open.length, 1);
  // só a Segurança (e o painel) recebe: as outras repartições, o atendente da própria e o outro cliente, não
  const ccoB = await office(B, 'CCO do B', 'seguranca'); const Gb = await enter(B, ccoB, 'operador.cco');
  for (const X of [U, Ua, E, S, D, PM, PC]) assert.equal((await X('GET', '/api/reparticao/panic')).status, 403);
  assert.deepEqual((await Gb('GET', '/api/reparticao/panic')).data.open, [], 'o CCO de outro cliente não vê');
  assert.equal((await Gb('POST', `/api/reparticao/panic/${p1.data.id}/ack`, {})).status, 404); assert.equal((await B.api('POST', `/api/prefeitura/panic/${p1.data.id}/close`, { note: 'invasão' })).status, 404);
  assert.equal((await U('POST', `/api/reparticao/panic/${p1.data.id}/ack`, {})).status, 403);
  // recebido e encerrado: quem acionou vê a hora
  assert.equal((await Ua('GET', '/api/reparticao/panic/mine')).data.sent[0].ackAt, null);
  const ack = await G('POST', `/api/reparticao/panic/${p1.data.id}/ack`, {});
  assert.equal(ack.status, 200); assert.deepEqual([ack.data.status, ack.data.ackBy], ['recebido', 'repartição: Guarda Municipal (CCO) (operador.cco)']);
  assert.ok((await Ua('GET', '/api/reparticao/panic/mine')).data.sent[0].ackAt > 0);
  assert.equal((await G('POST', `/api/reparticao/panic/${p1.data.id}/close`, {})).status, 400, 'encerrar pede a nota');
  const cl = await G('POST', `/api/reparticao/panic/${p1.data.id}/close`, { note: 'Viatura no local. Situação normalizada.' });
  assert.equal(cl.status, 200); assert.equal(cl.data.status, 'encerrado');
  assert.equal((await G('POST', `/api/reparticao/panic/${p1.data.id}/close`, { note: 'de novo' })).status, 409);
  // freio: 3 por minuto por repartição (o primeiro já contou); a escola tem o freio dela
  assert.equal((await U('POST', '/api/reparticao/panic', {})).status, 201); assert.equal((await Ua('POST', '/api/reparticao/panic', {})).status, 201);
  assert.equal((await U('POST', '/api/reparticao/panic', {})).status, 429);
  const p4 = await E('POST', '/api/reparticao/panic', {});
  assert.equal(p4.status, 201);
  assert.equal((await A.api('POST', `/api/prefeitura/panic/${p4.data.id}/ack`, {})).status, 200, 'o painel também marca recebido');
  assert.equal((await A.api('POST', `/api/prefeitura/panic/${p4.data.id}/close`, { note: 'Alarme falso, conferido por telefone.' })).status, 200);
  assert.deepEqual((await G('GET', '/api/reparticao/panic')).data.closed.map((p) => p.office).sort(), ['Escola Norte', 'UBS Centro']);

  /* ---------------------------------------------------------------- emissor conveniado: não lê nada de ninguém */
  const stPm = (await PM('GET', '/api/reparticao/state')).data;
  assert.deepEqual([stPm.office.external, stPm.office.family, stPm.direct, stPm.network, stPm.devices, stPm.alertScopes], [true, 'policia-militar', false, undefined, [], ['reach', 'city', 'regions', 'groups', 'office', 'radius']]);
  assert.deepEqual((await PM('GET', '/api/reparticao/devices')).data.devices, [], 'não vê telas de ninguém');
  for (const [m, url, body] of [['GET', '/api/reparticao/cards'], ['POST', '/api/reparticao/cards', { kind: 'unidade', lines: ['x'] }], ['PUT', '/api/reparticao/avisos', { items: ['Aviso da PM.'] }], ['GET', '/api/reparticao/approvals'], ['PUT', '/api/reparticao/geral', { items: [] }], ['GET', '/api/reparticao/missing'], ['POST', '/api/reparticao/missing', { name: 'x' }], ['POST', '/api/reparticao/queue/totem'], ['POST', '/api/reparticao/queue/guiche']]) {
    assert.equal((await PM(m, url, body)).status, 403, `PM em ${m} ${url}`);
  }
  const mapa = (await PM('GET', '/api/reparticao/mapa')).data;
  assert.deepEqual(Object.keys(mapa.offices[0]).sort(), ['id', 'lat', 'lng', 'name', 'regionId', 'type'], 'o órgão de fora recebe só o nome e o ponto: sem a contagem de telas');
  assert.ok(Object.keys((await G('GET', '/api/reparticao/mapa')).data.offices[0]).includes('devices'));

  /* ---------------------------------------------------------------- o envio do emissor espera o CCO */
  const raio = { kind: 'radius', lat: -22.9, lng: -43.2, meters: 2000 };
  const alertOf = async (T, title) => (await hb(T)).alerts.find((a) => a.title === title) || null;
  assert.equal((await PM('POST', '/api/reparticao/alerts', { title: 'Sem categoria', durationMin: 10, scope: raio })).status, 400, 'o emissor escolhe a categoria e o tipo');
  assert.equal((await PM('POST', '/api/reparticao/alerts', { category: 'meteorologico', kind: 'vendaval', title: 'Vento', durationMin: 10, scope: raio })).status, 403, 'categoria que não é do órgão');
  assert.equal((await PC('POST', '/api/reparticao/alerts', { category: 'transito', kind: 'desvio', title: 'Desvio', durationMin: 10, scope: raio })).status, 403, 'a Polícia Civil só Segurança pública');
  assert.equal((await PM('POST', '/api/reparticao/alerts', { category: 'seguranca', kind: 'evacuacao-predio', title: 'Evacuação', level: 'critical', durationMin: 10, scope: raio })).status, 400, 'Extremo pede a confirmação');
  const pend = await PM('POST', '/api/reparticao/alerts', { category: 'seguranca', kind: 'ocorrencia', title: 'Ocorrência em andamento: evite a área', text: 'Evite a região do Centro. Siga as orientações dos agentes.', level: 'warn', durationMin: 30, scope: raio });
  assert.equal(pend.status, 202, JSON.stringify(pend.data)); assert.equal(pend.data.pending, true);
  assert.equal(await alertOf(T1, 'Ocorrência em andamento: evite a área'), null, 'pendente: não chega ao sinal de vida');
  assert.deepEqual((await PM('GET', '/api/reparticao/state')).data.approval.requests.map((r) => [r.kind, r.status]), [['alert', 'pending']], 'o emissor vê o próprio envio esperando');
  // a fila é do CCO; com CCO cadastrado, a SECOM não decide o pedido do emissor
  const fila = (await G('GET', '/api/reparticao/approvals')).data;
  assert.deepEqual(fila.pending.map((a) => [a.office, a.kind, a.external]), [['Polícia Militar', 'alert', true]]);
  assert.deepEqual((await S('GET', '/api/reparticao/approvals')).data.pending, [], 'a SECOM não vê o pedido do emissor quando há CCO');
  assert.equal((await S('POST', `/api/reparticao/approvals/${fila.pending[0].id}/approve`, {})).status, 403);
  for (const X of [U, D, PM, PC]) assert.equal((await X('POST', `/api/reparticao/approvals/${fila.pending[0].id}/approve`, {})).status, 403);
  assert.equal((await Gb('POST', `/api/reparticao/approvals/${fila.pending[0].id}/approve`, {})).status, 404, 'o CCO de outro cliente');
  assert.equal((await G('POST', `/api/reparticao/approvals/${fila.pending[0].id}/approve`, {})).status, 200);
  const al = await alertOf(T1, 'Ocorrência em andamento: evite a área');
  assert.deepEqual([al.level, al.header, al.category], ['warn', 'ALERTA SEVERO · POLÍCIA MILITAR', 'seguranca'], 'aprovado: vai às telas com a linha de cima do emissor');
  assert.equal(await alertOf(T2, 'Ocorrência em andamento: evite a área'), null, 'a escola está fora do raio');
  // devolvido com o motivo: nada vai às telas e o emissor lê o motivo
  const pend2 = await PM('POST', '/api/reparticao/alerts', { category: 'transito', kind: 'bloqueio-via', title: 'Via bloqueada', durationMin: 30, scope: { kind: 'city' } });
  assert.equal(pend2.status, 202);
  assert.equal((await G('POST', `/api/reparticao/approvals/${pend2.data.approval.id}/reject`, { note: 'Informe o trecho bloqueado.' })).status, 200);
  assert.equal(await alertOf(T1, 'Via bloqueada'), null);
  assert.ok((await PM('GET', '/api/reparticao/state')).data.approval.requests.some((r) => r.status === 'rejected' && r.note === 'Informe o trecho bloqueado.'));
  // o próprio CCO emite na hora, com a linha de cima dele
  const gAl = await G('POST', '/api/reparticao/alerts', { category: 'transito', kind: 'interdicao', title: 'Via interditada', level: 'info', durationMin: 10, scope: { kind: 'city' } });
  assert.equal(gAl.status, 201, JSON.stringify(gAl.data)); assert.equal(gAl.data.alert.header, 'ALERTA · GUARDA MUNICIPAL');
  assert.equal((await G('POST', '/api/reparticao/alerts', { category: 'seguranca', kind: 'area-isolada', title: 'Área isolada', level: 'critical', confirmExtreme: true, durationMin: 10, scope: raio })).data.alert.header, 'ALERTA EXTREMO · GUARDA MUNICIPAL');

  /* ---------------------------------------------------------------- "pode emitir direto": libera o alerta, nunca a cartela */
  assert.equal((await A.api('PUT', `/api/prefeitura/offices/${ubs.id}/issuer`, { direct: true })).status, 409, 'só o emissor conveniado tem a opção');
  assert.equal((await B.api('PUT', `/api/prefeitura/offices/${pm.id}/issuer`, { direct: true })).status, 404);
  assert.equal((await A.api('PUT', `/api/prefeitura/offices/${pm.id}/issuer`, { direct: 'sim' })).status, 400);
  assert.equal((await A.api('PUT', `/api/prefeitura/offices/${pm.id}/issuer`, { direct: true })).status, 200);
  assert.equal((await A.api('GET', `/api/prefeitura/offices/${pm.id}/users`)).data.office.direct, true);
  const dir = await PM('POST', '/api/reparticao/alerts', { category: 'transito', kind: 'bloqueio-via', title: 'Via bloqueada no Centro', level: 'info', durationMin: 10, scope: raio });
  assert.equal(dir.status, 201, JSON.stringify(dir.data)); assert.deepEqual([dir.data.alert.header, dir.data.alert.flag], ['ALERTA · POLÍCIA MILITAR', 'sem-aprovacao']);
  assert.ok(await alertOf(T1, 'Via bloqueada no Centro'));
  assert.equal((await A.api('PUT', `/api/prefeitura/offices/${pc.id}/issuer`, { direct: true })).status, 200);

  /* ---------------------------------------------------------------- cartela policial: as travas */
  const cartela = { kind: 'informacao', infoHeader: 'informacoes', name: '', description: 'Quem viu o veículo na Rua de Teste no dia 10?', reportNo: 'IP 123/2026', authName: 'Matrícula 0001', scope: { kind: 'city' } };
  for (const [patch, why] of [[{ reportNo: '' }, 'sem o procedimento'], [{ authName: '' }, 'sem a matrícula'], [{ infoHeader: 'livre' }, 'cabeçalho fora da lista'], [{ infoHeader: 'procurado' }, '"procurado" sem o mandado'], [{ days: 16 }, 'mais de 15 dias']]) {
    assert.equal((await PC('POST', '/api/reparticao/missing', { ...cartela, ...patch })).status, 400, why);
  }
  for (const X of [D, G, S]) assert.equal((await X('POST', '/api/reparticao/missing', cartela)).status, 403, 'a cartela é só da Polícia Civil');
  assert.equal((await A.api('POST', '/api/prefeitura/missing', cartela)).status, 403, 'nem o painel cadastra cartela policial');
  const ct = await PC('POST', '/api/reparticao/missing', { ...cartela, infoHeader: 'procurado', name: 'Fulano de Teste', warrantNo: 'MP 55/2026', days: 15 });
  assert.equal(ct.status, 202, 'a cartela espera SEMPRE a aprovação, mesmo com o emitir direto ligado'); assert.equal(ct.data.pending, true);
  assert.deepEqual((await hb(T1)).missing, [], 'pendente: não chega ao sinal de vida');
  const desap = { kind: 'adulto', name: 'Pessoa de Teste', reportNo: 'BO 9/2026', authName: 'Familiar de teste', authRelation: 'familiar', authOk: true, scope: { kind: 'city' } };
  const dd = await PC('POST', '/api/reparticao/missing', desap);
  assert.equal(dd.status, 201, 'com o emitir direto, o desaparecido da Polícia Civil vai às telas na hora'); assert.deepEqual((await hb(T1)).missing.map((m) => m.name), ['Pessoa de Teste']);
  assert.equal((await A.api('PUT', `/api/prefeitura/offices/${pc.id}/issuer`, { direct: false })).status, 200);
  const dd2 = await PC('POST', '/api/reparticao/missing', { ...desap, name: 'Outra Pessoa de Teste' });
  assert.equal(dd2.status, 202, 'sem o emitir direto, o desaparecido também espera');
  const lstPc = (await PC('GET', '/api/reparticao/missing')).data;
  assert.deepEqual([lstPc.active.map((m) => m.name), lstPc.pending.map((m) => m.name).sort()], [['Pessoa de Teste'], ['Fulano de Teste', 'Outra Pessoa de Teste']]);
  // a fila do CCO traz a cartela e o caso; aprova a cartela e devolve o caso
  const fila2 = (await G('GET', '/api/reparticao/approvals')).data.pending.filter((a) => a.kind === 'missing');
  assert.equal(fila2.length, 2); assert.ok(!/Matrícula 0001|IP 123|MP 55/.test(JSON.stringify(fila2)), 'a fila não leva a matrícula nem o procedimento');
  const reqCt = fila2.find((a) => a.refId === ct.data.id); const reqDd = fila2.find((a) => a.refId === dd2.data.id);
  assert.equal((await G('POST', `/api/reparticao/approvals/${reqCt.id}/approve`, {})).status, 200);
  const item = (await hb(T1)).missing.find((m) => m.kind === 'informacao');
  assert.deepEqual([item.header, item.name, item.lastSeen, item.description, item.contact, item.age, item.since, item.photo], ['PROCURADO PELA JUSTIÇA', 'Fulano de Teste', '', 'Não aborde. Ligue 190 ou 181. Quem viu o veículo na Rua de Teste no dia 10?', 'Disque Denúncia 181 · sigilo garantido', null, null, null]);
  assert.ok(item.until - Date.now() <= 15 * 86400e3 + 5000);
  assert.ok(!/Matrícula 0001|IP 123|MP 55|warrant|authName|reportNo/.test(JSON.stringify(await hb(T1))), 'a matrícula, o procedimento e o mandado nunca vão às telas');
  assert.equal((await PC('PATCH', `/api/reparticao/missing/${ct.data.id}`, { description: 'Pode abordar. Não aborde. Ligue 190 ou 181. Texto novo.', lastSeen: 'Pode abordar.' })).status, 200);
  const edited = (await hb(T1)).missing.find((m) => m.kind === 'informacao');
  assert.deepEqual([edited.description, edited.lastSeen], ['Não aborde. Ligue 190 ou 181. Pode abordar. Texto novo.', ''], 'a frase fixa abre sempre o texto, uma vez só, e não sai');
  assert.equal((await G('POST', `/api/reparticao/approvals/${reqDd.id}/reject`, { note: 'Falta a foto.' })).status, 200);
  const after = (await PC('GET', '/api/reparticao/missing')).data;
  assert.deepEqual([after.pending, after.closed.find((m) => m.id === dd2.data.id).status], [[], 'rejected'], 'devolvido: o emissor vê a situação');
  assert.ok(!(await hb(T1)).missing.some((m) => m.name === 'Outra Pessoa de Teste'));
  // o emissor só vê e só mexe nos próprios envios; a Defesa Civil e o CCO veem todos
  const dcCase = await D('POST', '/api/reparticao/missing', { ...desap, name: 'Caso da Defesa Civil' });
  assert.equal(dcCase.status, 201);
  assert.ok(!(await PC('GET', '/api/reparticao/missing')).data.active.some((m) => m.name === 'Caso da Defesa Civil'));
  assert.equal((await PC('POST', `/api/reparticao/missing/${dcCase.data.id}/close`, {})).status, 404); assert.equal((await PC('PATCH', `/api/reparticao/missing/${dcCase.data.id}`, { name: 'Invadido' })).status, 404);
  assert.deepEqual((await G('GET', '/api/reparticao/missing')).data.active.map((m) => m.name).sort(), ['Caso da Defesa Civil', 'Fulano de Teste', 'Pessoa de Teste'], 'o CCO vê e encerra qualquer caso');
  assert.equal((await G('POST', `/api/reparticao/missing/${ct.data.id}/close`, { reason: 'encerrado' })).status, 200);

  /* ---------------------------------------------------------------- sem CCO, a SECOM decide o pedido do emissor; com a aprovação geral, as duas decidem */
  const pcB0 = await office(B, 'Polícia Civil do B', 'policia-civil'); const PCb = await enter(B, pcB0, 'delegacia');
  const C2 = api(s.base, Cx.token);
  const secomC = (await C2('POST', '/api/prefeitura/offices', { name: 'SECOM do C', type: 'secom' })).data; const pmC = (await C2('POST', '/api/prefeitura/offices', { name: 'PM do C', type: 'policia-militar' })).data;
  const Sc = await enter(Cx, secomC, 'comunicacao'); const PMc = await enter(Cx, pmC, 'cabo.teste');
  const pc3 = await PMc('POST', '/api/reparticao/alerts', { category: 'seguranca', kind: 'area-isolada', title: 'Área isolada', durationMin: 10, scope: { kind: 'city' } });
  assert.equal(pc3.status, 202);
  assert.deepEqual((await Sc('GET', '/api/reparticao/approvals')).data.pending.map((a) => a.office), ['PM do C'], 'sem repartição de Segurança, a SECOM vê');
  assert.equal((await Sc('POST', `/api/reparticao/approvals/${pc3.data.approval.id}/approve`, {})).status, 200);
  assert.equal((await A.api('PUT', '/api/prefeitura/defaults', { approval: true })).status, 200);
  const av = await E('PUT', '/api/reparticao/avisos', { items: ['Reunião de pais na quinta.'] });
  assert.equal(av.status, 202);
  assert.deepEqual([(await S('GET', '/api/reparticao/approvals')).data.pending.map((a) => a.office), (await G('GET', '/api/reparticao/approvals')).data.pending.map((a) => a.office)], [['Escola Norte'], ['Escola Norte']], 'o pedido de uma repartição da prefeitura: a SECOM e o CCO veem');
  assert.equal((await G('POST', `/api/reparticao/approvals/${av.data.approval.id}/approve`, {})).status, 200);
  assert.equal((await S('POST', `/api/reparticao/approvals/${av.data.approval.id}/approve`, {})).status, 409, 'vale quem decidiu primeiro');
  assert.equal((await S('GET', '/api/reparticao/approvals')).data.history.find((a) => a.id === av.data.approval.id).decidedBy, 'repartição: Guarda Municipal (CCO) (operador.cco)', 'fica registrado quem aprovou');
  // com a aprovação geral ligada, o CCO segue emitindo na hora (como a Defesa Civil)
  assert.equal((await G('POST', '/api/reparticao/alerts', { category: 'transito', kind: 'desvio', title: 'Desvio no trânsito', level: 'info', durationMin: 5, scope: { kind: 'city' } })).status, 201);
  assert.equal((await A.api('PUT', '/api/prefeitura/defaults', { approval: false })).status, 200);

  /* ---------------------------------------------------------------- a chave de integração (API) do emissor conveniado */
  const keyUrl = (o) => `/api/prefeitura/offices/${o.id}/api-key`;
  assert.equal((await A.api('GET', keyUrl(ubs))).status, 409, 'só o emissor conveniado tem chave');
  assert.equal((await A.api('POST', keyUrl(ubs), {})).status, 409); assert.equal((await B.api('POST', keyUrl(pm), {})).status, 404);
  assert.equal((await C2('POST', keyUrl(pmC), {})).status, 403, 'o plano sem o Acesso por API não gera a chave'); assert.equal((await C2('GET', keyUrl(pmC))).data.allowed, false);
  assert.deepEqual([(await A.api('GET', keyUrl(pm))).data.on, (await A.api('GET', keyUrl(pm))).data.allowed], [false, true]);
  const k1 = await A.api('POST', keyUrl(pm), {});
  assert.equal(k1.status, 201, JSON.stringify(k1.data)); assert.match(k1.data.key, /^[A-Za-z0-9_-]{43}$/); assert.equal(k1.data.endpoint, 'https://painel.exemplo.test/api/telas-emissor/alerts');
  if (sqlite) {
    const db = new DatabaseSync(path.join(s.dataDir, 'digitalisp.db'), { timeout: 15000 });
    assert.equal(db.prepare('SELECT token_hash FROM telas_api_keys WHERE office_id = ?').get(pm.id).token_hash, createHash('sha256').update(k1.data.key).digest('hex'), 'no banco, só o SHA-256 da chave');
    db.close();
  }
  assert.ok(!JSON.stringify((await A.api('GET', keyUrl(pm))).data).includes(k1.data.key), 'a chave só aparece ao gerar');
  const K = bearer(k1.data.key);
  assert.equal((await anon('GET', '/api/telas-emissor/alerts')).status, 401); assert.equal((await bearer('A'.repeat(43))('GET', '/api/telas-emissor/alerts')).status, 401);
  assert.equal((await bearer(PM.session)('GET', '/api/telas-emissor/alerts')).status, 401, 'a sessão do link não é a chave');
  for (const [m, url] of [['GET', '/api/reparticao/state'], ['GET', '/api/reparticao/missing'], ['GET', '/api/prefeitura'], ['GET', '/api/telas/config'], ['GET', '/api/guiche']]) assert.equal((await K(m, url)).status, 401, `a chave não abre ${url}`);
  // a mesma validação, a mesma aprovação e o mesmo freio do link
  assert.equal((await K('POST', '/api/telas-emissor/alerts', { title: 'Sem categoria', durationMin: 10, scope: { kind: 'city' } })).status, 400);
  assert.equal((await K('POST', '/api/telas-emissor/alerts', { category: 'saude', kind: 'surto', title: 'Fora do órgão', durationMin: 10, scope: { kind: 'city' } })).status, 403);
  assert.equal((await K('POST', '/api/telas-emissor/alerts', { category: 'transito', kind: 'desvio', title: 'Raio torto', durationMin: 10, scope: { kind: 'radius', lat: 95, lng: 0, meters: 500 } })).status, 400);
  assert.equal((await K('POST', '/api/telas-emissor/alerts', { category: 'transito', kind: 'desvio', title: 'Região de outro', durationMin: 10, scope: { kind: 'regions', regions: [999999] } })).status, 400);
  const ka = await K('POST', '/api/telas-emissor/alerts', { category: 'transito', kind: 'bloqueio-via', title: 'Bloqueio pela API', text: 'Evite o trecho.', level: 'warn', durationMin: 15, scope: { kind: 'radius', lat: -22.9, lng: -43.2, meters: 1500 } });
  assert.equal(ka.status, 201, JSON.stringify(ka.data)); assert.deepEqual([ka.data.alert.header, ka.data.alert.createdBy, ka.data.reach.total], ['ALERTA SEVERO · POLÍCIA MILITAR', 'repartição: Polícia Militar (API)', 1]);
  assert.ok(await alertOf(T1, 'Bloqueio pela API'));
  assert.equal((await A.api('PUT', `/api/prefeitura/offices/${pm.id}/issuer`, { direct: false })).status, 200);
  const kp = await K('POST', '/api/telas-emissor/alerts', { category: 'seguranca', kind: 'ocorrencia', title: 'Pela API, esperando', durationMin: 15, scope: { kind: 'city' } });
  assert.equal(kp.status, 202, 'sem o emitir direto, o envio pela chave também espera o CCO'); assert.equal(await alertOf(T1, 'Pela API, esperando'), null);
  const mine = (await K('GET', '/api/telas-emissor/alerts')).data;
  assert.ok(mine.alerts.some((a) => a.title === 'Bloqueio pela API') && mine.alerts.every((a) => a.officeId === pm.id), 'só os alertas do próprio emissor');
  assert.ok(mine.requests.some((r) => r.status === 'pending')); assert.ok(!mine.alerts.some((a) => a.title === 'Via interditada'));
  assert.equal((await K('POST', `/api/telas-emissor/alerts/${gAl.data.alert.id}/cancel`, {})).status, 404, 'alerta de outra repartição');
  assert.equal((await K('POST', `/api/telas-emissor/alerts/${ka.data.alert.id}/cancel`, {})).status, 200); assert.equal(await alertOf(T1, 'Bloqueio pela API'), null);
  assert.ok((await A.api('GET', keyUrl(pm))).data.lastUsed > 0, 'a data do último uso');
  // gerar outra derruba a de antes; revogar; a chave do emissor de outro cliente não alcança este
  const k2 = await A.api('POST', keyUrl(pm), {});
  assert.equal((await K('GET', '/api/telas-emissor/alerts')).status, 401, 'a chave de antes deixou de valer');
  const K2 = bearer(k2.data.key); assert.equal((await K2('GET', '/api/telas-emissor/alerts')).status, 200);
  // o mesmo freio do link: os alertas da repartição somam, venham do link ou da chave (14 em 10 min neste teste)
  let froze = false;
  for (let i = 0; i < 16 && !froze; i++) froze = (await K2('POST', '/api/telas-emissor/alerts', { category: 'transito', kind: 'desvio', title: 'Freio', durationMin: 5, scope: { kind: 'city' } })).status === 429;
  assert.ok(froze, 'freio por repartição também na chave de integração');
  assert.equal((await PM('POST', '/api/reparticao/alerts', { category: 'transito', kind: 'desvio', title: 'Freio pelo link', durationMin: 5, scope: { kind: 'city' } })).status, 429, 'e o link da mesma repartição está no mesmo freio');
  const kb = await B.api('POST', keyUrl(pcB0), {});
  assert.equal(kb.status, 201); assert.ok(!(await bearer(kb.data.key)('GET', '/api/telas-emissor/alerts')).data.alerts.length, 'o emissor do B só vê os dele');
  assert.equal((await A.api('DELETE', keyUrl(pm))).status, 200); assert.equal((await K2('GET', '/api/telas-emissor/alerts')).status, 401, 'revogada');
  void PCb;

  /* ---------------------------------------------------------------- auditoria e log sem segredo */
  const audit = JSON.stringify((await A.api('GET', '/api/audit?limit=500')).data);
  for (const want of [/BOTÃO DE PÂNICO acionado em \\"UBS Centro\\"/, /RECEBIDO pela Segurança/, /ENCERRADO pela Segurança/, /ENCERRADO pelo Painel da Prefeitura/, /LIBERADO para emitir alertas direto/, /pelo link da Segurança \(CCO\)/, /chave de integração do emissor conveniado \\"Polícia Militar\\" gerada/, /pela chave de integração/, /cartela policial \\"PROCURADO PELA JUSTIÇA\\" \(procedimento IP 123\/2026\) enviada para a aprovação do CCO/, /repartição: Polícia Militar \(API\)/]) assert.match(audit, want);
  assert.ok(!audit.includes(k1.data.key) && !audit.includes(k2.data.key) && !s.out().includes(k1.data.key), 'a chave não vai para a auditoria nem para o log');
  assert.ok(!/Matrícula 0001/.test(audit), 'a matrícula fica só no registro do caso');
}

test('SQLite: botão de pânico, emissores conveniados, aprovação do CCO, cartela policial e chave de integração', { timeout: 400000 }, async () => {
  const s = await boot(ENV);
  try { await roteiro(s, { sqlite: true }); } finally { await s.stop(); cleanup(s.dataDir); }
});

test('Postgres: o mesmo roteiro (as tabelas do pânico e da chave de integração nascem no banco)', { timeout: 400000 }, async (t) => {
  const { startPg } = await import('./helpers/pg.js');
  const { createPg } = await import('../server/db/pg.js');
  let pgs;
  try { pgs = await startPg(); } catch (err) { t.skip(`Postgres embutido indisponível: ${err.message}`); return; }
  let s = null; let db = null;
  try {
    s = await boot({ ...ENV, DATABASE_URL: pgs.url });
    await roteiro(s);
    db = await createPg(pgs.url, { max: 2 });
    const cols = await db.all("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('telas_panic', 'telas_api_keys', 'telas_missing')");
    const type = (tb, c) => cols.find((x) => x.table_name === tb && x.column_name === c)?.data_type;
    assert.deepEqual([type('telas_panic', 'tenant_id'), type('telas_panic', 'sent_at'), type('telas_api_keys', 'office_id'), type('telas_api_keys', 'token_hash'), type('telas_missing', 'warrant_no'), type('telas_missing', 'header')], ['bigint', 'bigint', 'bigint', 'text', 'text', 'text']);
    for (const k of await db.all('SELECT token_hash FROM telas_api_keys')) assert.match(k.token_hash, /^[0-9a-f]{64}$/, 'só o SHA-256 da chave');
  } finally {
    if (db) await db.close().catch(() => {});
    if (s) { await s.stop(); cleanup(s.dataDir); }
    await pgs.stop().catch(() => {});
  }
});
