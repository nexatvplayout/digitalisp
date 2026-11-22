// NEXA Telas no Postgres (server/db/schema-telas.js, server/telas.js; docs/TELAS.md): as tabelas nascem no banco novo e voltam
// no banco de antes (aditivas e idempotentes, com os índices únicos dos hashes), e o roteiro do SQLite roda no dialeto do
// Postgres com o servidor de verdade: ativar (RETURNING id, uso único), a configuração com grupos, o sinal de vida com os
// alertas por grupo e por raio (DOUBLE PRECISION), a entrega gravada uma vez (ON CONFLICT), o link de controle e a exclusão
// do cliente. Textos sem emoji: o cluster do teste nasce no código de página do Windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tmpDir } from './helpers/tmp.js'; // pastas nexa-* apagadas no fim, mesmo com o teste falhando
import { boot, cleanup, api, platformLogin, newTenant } from './helpers/srv.js';

process.env.DATA_DIR = tmpDir('nexa-telaspg');
const { createPg } = await import('../server/db/pg.js');
const { startPg } = await import('./helpers/pg.js');
const { TELAS_TABLES } = await import('../server/db/schema-telas.js');
const sha = (s) => createHash('sha256').update(s).digest('hex');

test('Postgres: tabelas do NEXA Telas no banco novo e no de antes (idempotente); ativar, grupos, alertas, entregas, link e exclusão', { timeout: 300000 }, async (t) => {
  let pgs;
  try { pgs = await startPg(); } catch (err) { t.skip(`Postgres embutido indisponível: ${err.message}`); return; }
  let db = null; let s = null;
  try {
    // 1) banco novo: as tabelas, os tipos e os índices únicos dos hashes
    db = await createPg(pgs.url, { max: 2 });
    for (const tb of TELAS_TABLES) assert.ok((await db.get(`SELECT to_regclass('${tb}') AS r`)).r, `tabela ${tb}`);
    const cols = await db.all("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name LIKE 'telas_%' OR table_name LIKE 'tvcorp_%'");
    const type = (tb, c) => cols.find((x) => x.table_name === tb && x.column_name === c)?.data_type;
    assert.equal(type('telas_offices', 'lat'), 'double precision'); assert.equal(type('telas_devices', 'last_seen'), 'bigint'); assert.equal(type('telas_alerts', 'scope_data'), 'text');
    for (const tb of TELAS_TABLES) assert.equal(type(tb, 'tenant_id'), 'bigint', `${tb}.tenant_id`);
    const idx = (await db.all("SELECT indexname, indexdef FROM pg_indexes WHERE tablename LIKE 'telas_%'"));
    for (const i of ['idx_telas_devices_token', 'idx_telas_offices_link']) assert.match(idx.find((x) => x.indexname === i)?.indexdef || '', /UNIQUE/, `índice único ${i}`);
    assert.ok(idx.some((x) => /UNIQUE/.test(x.indexdef) && /telas_keys/.test(x.indexdef) && /key_hash/.test(x.indexdef)), 'chave de acesso única pelo hash');
    const pk = await db.all("SELECT conrelid::regclass::text AS tb, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE contype = 'p' AND conrelid::regclass::text IN ('telas_group_devices', 'telas_alert_deliveries')");
    assert.ok(pk.some((c) => c.tb === 'telas_group_devices' && /PRIMARY KEY \(group_id, device_id\)/.test(c.d)), JSON.stringify(pk));
    assert.ok(pk.some((c) => c.tb === 'telas_alert_deliveries' && /PRIMARY KEY \(alert_id, device_id\)/.test(c.d)), JSON.stringify(pk));
    // 2) volta ao banco de antes (sem as tabelas) e sobe duas vezes: elas voltam, sem erro; o resto fica
    await db.exec(TELAS_TABLES.map((tb) => `DROP TABLE IF EXISTS ${tb}`).join('; '));
    await db.close(); db = null;
    for (let i = 0; i < 2; i++) { const d = await createPg(pgs.url, { max: 2 }); await d.close(); }
    db = await createPg(pgs.url, { max: 2 });
    for (const tb of [...TELAS_TABLES, 'channels', 'feature_profiles']) assert.ok((await db.get(`SELECT to_regclass('${tb}') AS r`)).r, `tabela ${tb}`);

    // 3) o servidor de verdade sobre o Postgres
    s = await boot({ DATABASE_URL: pgs.url, PUBLIC_HLS_URL: 'https://hls.exemplo.test' });
    const anon = api(s.base);
    const dev = (token) => (method, url, body, headers = {}) => anon(method, url, body, { authorization: `Bearer ${token}`, ...headers });
    const P = api(s.base, await platformLogin(s.base));
    const prof = await P('POST', '/api/platform/feature-profiles', { name: 'Prefeitura', code: 'prefeitura', features: { prefeitura: true } });
    assert.equal(prof.status, 201, JSON.stringify(prof.data));
    assert.equal((await P('POST', '/api/platform/plans', { code: 'p-pref', name: 'Prefeitura', priceCents: 0, profileId: prof.data.id, limits: { channels: 1 } })).status, 201);
    const A = await newTenant(P, s.base, { slug: 'pg-pref', planCode: 'p-pref', status: 'active' });
    assert.equal((await A.api('POST', '/api/channels', { name: 'TV Prefeitura', slug: 'pg-pref-tv' })).status, 201);
    const post = async (url, body) => { const r = await A.api('POST', url, body); assert.equal(r.status, 201, `${url}: ${JSON.stringify(r.data)}`); return r.data; };
    const region = await post('/api/prefeitura/regions', { name: 'Centro', color: '#2266cc' });
    const escola = await post('/api/prefeitura/offices', { name: 'Escola Centro', type: 'escola', lat: -22.9068, lng: -43.1729, regionId: region.id });
    const upa = await post('/api/prefeitura/offices', { name: 'UPA Norte', type: 'upa', lat: -22.8, lng: -43.3 });
    assert.match(escola.generatedPin, /^\d{6}$/); assert.equal(typeof escola.id, 'number'); assert.equal(escola.lat, -22.9068, 'latitude volta como número');
    const act = async (officeId, name) => {
      const k = await post('/api/prefeitura/keys', { officeId, name });
      const a = await anon('POST', '/api/telas/activate', { key: k.key, device: { model: 'B13', android: '13', appVersion: '1.0.0' } });
      assert.equal(a.status, 200, JSON.stringify(a.data)); assert.equal(typeof a.data.deviceId, 'number');
      assert.equal((await anon('POST', '/api/telas/activate', { key: k.key })).status, 404, 'uso único no Postgres');
      return a.data;
    };
    const d1 = await act(escola.id, 'Escola Centro, sala'); const d2 = await act(upa.id, '');
    assert.equal(d1.channel, 'pg-pref-tv');
    assert.equal((await db.get('SELECT token_hash FROM telas_devices WHERE id = ?', [d1.deviceId])).token_hash, sha(d1.token));
    const T1 = dev(d1.token); const T2 = dev(d2.token);
    // grupos: manual e automático; precedência dos avisos
    const gAuto = await post('/api/prefeitura/groups', { name: 'Escolas', officeType: 'escola', sort: 2, config: { tickerItems: ['Volta as aulas dia 3.'] } });
    const gMan = await post('/api/prefeitura/groups', { name: 'Campanha', sort: 1, config: { tickerItems: ['Campanha do agasalho.'], layout: 'lbar' }, deviceIds: [d1.deviceId, d2.deviceId] });
    assert.deepEqual(gMan.deviceIds.sort(), [d1.deviceId, d2.deviceId].sort());
    const c1 = (await T1('GET', '/api/telas/config')).data;
    assert.deepEqual([c1.ticker.items, c1.layout, c1.device.region], [['Campanha do agasalho.', 'Volta as aulas dia 3.'], 'lbar', 'Centro']);
    assert.equal(c1.lock.pinHash, sha(`${c1.lock.pinSalt}${escola.generatedPin}`));
    assert.equal((await T1('GET', '/api/telas/config', undefined, { 'if-none-match': c1.rev })).status, 304);
    assert.deepEqual((await T2('GET', '/api/telas/config')).data.ticker.items, ['Campanha do agasalho.']);
    // sinal de vida e alertas por grupo, raio e região
    const hb = (T) => T('POST', '/api/telas/heartbeat', { rev: 'x', state: 'playing', source: 'hls', appVersion: '1.0.0', uptimeSec: 5000000000, net: 'wifi', lastError: null, locked: true });
    assert.equal((await hb(T1)).status, 200); assert.equal((await hb(T2)).status, 200);
    const send = async (title, scope) => post('/api/prefeitura/alerts', { title, text: 'Texto do alerta.', level: 'critical', sound: true, confirmExtreme: true, durationMin: 20, scope });
    const a1 = await send('Escolas', { kind: 'groups', groups: [gAuto.id] });
    const a2 = await send('Raio', { kind: 'radius', lat: -22.9068, lng: -43.1729, meters: 1500 });
    await send('Regiao', { kind: 'regions', regions: [region.id] });
    const a4 = await send('Cidade', { kind: 'city' });
    assert.ok(a2.alert.id > a1.alert.id && a4.alert.id > a2.alert.id, 'ids crescentes');
    assert.deepEqual(a1.reach, { total: 1, online: 1, offices: 1 }); assert.deepEqual(a4.reach, { total: 2, online: 2, offices: 2 });
    assert.deepEqual((await hb(T1)).data.alerts.map((a) => a.title).sort(), ['Cidade', 'Escolas', 'Raio', 'Regiao']);
    assert.deepEqual((await hb(T2)).data.alerts.map((a) => a.title), ['Cidade']);
    await hb(T1); // a entrega não duplica (chave alerta + tela)
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM telas_alert_deliveries WHERE alert_id = ?', [a4.alert.id])).n), 2);
    const det = (await A.api('GET', `/api/prefeitura/alerts/${a4.alert.id}`)).data;
    assert.deepEqual(det.deliveries.map((x) => x.name).sort(), ['Escola Centro, sala', 'UPA Norte']);
    assert.equal((await A.api('POST', `/api/prefeitura/alerts/${a4.alert.id}/cancel`)).status, 200);
    assert.deepEqual((await hb(T2)).data.alerts, []);
    const list = (await A.api('GET', '/api/prefeitura/alerts')).data;
    assert.equal(list.history.find((a) => a.id === a4.alert.id).delivered, 2); assert.equal(list.active.length, 3);
    // comandos e a situação
    const cmd = await post(`/api/prefeitura/devices/${d1.deviceId}/commands`, { type: 'reload' });
    assert.deepEqual((await hb(T1)).data.commands, [{ id: cmd.id, type: 'reload' }]); assert.deepEqual((await hb(T1)).data.commands, []);
    assert.equal((await T1('POST', `/api/telas/commands/${cmd.id}/done`, { ok: true })).status, 200);
    const st = (await A.api('GET', '/api/prefeitura/status')).data.devices.find((d) => d.id === d1.deviceId);
    assert.equal(typeof st.lastSeen, 'number'); assert.equal(st.locked, true); assert.equal(st.state, 'playing');
    // link de controle
    const link = await post(`/api/prefeitura/offices/${escola.id}/link`, { password: 'senha-da-escola-26' });
    const token = link.url.split('/').pop();
    assert.equal((await anon('POST', '/api/reparticao/login', { token, password: 'senha-errada-12' })).status, 401);
    const ok = await anon('POST', '/api/reparticao/login', { token, password: 'senha-da-escola-26' });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    const U = dev(ok.data.session);
    assert.deepEqual((await U('GET', '/api/reparticao/state')).data.devices.map((d) => d.name), ['Escola Centro, sala']);
    assert.equal((await U('PUT', '/api/reparticao/avisos', { items: ['Reuniao de pais na sexta.'] })).status, 200);
    assert.equal((await U('POST', '/api/reparticao/alerts', { title: 'Fora', durationMin: 5, scope: { kind: 'city' } })).status, 403);
    assert.equal((await U('POST', '/api/reparticao/alerts', { title: 'Da escola', durationMin: 5, scope: { kind: 'office' } })).status, 201);
    // fases 3 e 4 no dialeto do Postgres: a senha (numeração por dia com o índice único, ON CONFLICT do totem), a ordem pelo
    // risco na UPA, o relatório (somas em BIGINT), o cartão do dia, a aprovação, os vídeos guardados e a disponibilidade
    const types = await db.all("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('telas_queue_tickets','telas_queue_calls','telas_office_extras','telas_cards','telas_media_hashes','telas_device_events')");
    const ty = (tb, c) => types.find((x) => x.table_name === tb && x.column_name === c)?.data_type;
    assert.equal(ty('telas_queue_tickets', 'issued_at'), 'bigint'); assert.equal(ty('telas_queue_calls', 'shown_at'), 'bigint'); assert.equal(ty('telas_media_hashes', 'bytes'), 'bigint'); assert.equal(ty('telas_cards', 'weekday'), 'integer');
    const idx2 = await db.all("SELECT indexname, indexdef FROM pg_indexes WHERE tablename LIKE 'telas_%'");
    for (const i of ['idx_telas_queue_tickets_code', 'idx_telas_office_extras_totem', 'idx_telas_offline_item']) assert.match(idx2.find((x) => x.indexname === i)?.indexdef || '', /UNIQUE/, `índice único ${i}`);
    const upaLink = await post(`/api/prefeitura/offices/${upa.id}/link`, { password: 'senha-da-upa-2026' });
    const Up = dev((await anon('POST', '/api/reparticao/login', { token: upaLink.url.split('/').pop(), password: 'senha-da-upa-2026' })).data.session);
    const svc = await Up('POST', '/api/reparticao/queue/services', { name: 'Atendimento', prefix: 'M' });
    assert.equal(svc.status, 201, JSON.stringify(svc.data)); assert.equal(typeof svc.data.id, 'number');
    assert.equal((await Up('PUT', '/api/reparticao/queue/config', { title: 'UPA', ratio: 2 })).status, 200);
    assert.equal((await Up('PUT', '/api/reparticao/queue/config', { showName: true })).status, 200, 'a 2ª gravação atualiza a mesma linha');
    const issued = await Promise.all([1, 2, 3, 4].map((i) => Up('POST', '/api/reparticao/queue/tickets', { serviceId: svc.data.id, name: `Pessoa Numero ${i}` })));
    assert.deepEqual(issued.map((r) => r.status), [201, 201, 201, 201]);
    assert.deepEqual(issued.map((r) => r.data.ticket.code).sort(), ['M001', 'M002', 'M003', 'M004'], 'quatro emissões ao mesmo tempo: quatro números diferentes');
    const byCode = Object.fromEntries(issued.map((r) => [r.data.ticket.code, r.data.ticket]));
    assert.equal(byCode.M001.name, 'Pessoa N.');
    assert.equal((await Up('POST', `/api/reparticao/queue/tickets/${byCode.M003.id}/risk`, { risk: 'laranja' })).status, 200);
    assert.equal((await Up('POST', `/api/reparticao/queue/tickets/${byCode.M002.id}/risk`, { risk: 'verde' })).status, 200);
    const called = await Up('POST', '/api/reparticao/queue/call', { desk: 'Consultorio 1' });
    assert.equal(called.status, 200, JSON.stringify(called.data)); assert.equal(called.data.ticket.code, 'M003', 'laranja antes do verde e de quem não foi triado');
    assert.equal(typeof called.data.call.id, 'number');
    const qd = (await T2('GET', '/api/telas/queue')).data;
    assert.equal(qd.current.ticket, 'M003'); assert.equal(qd.current.name, 'Pessoa N.'); assert.deepEqual(qd.waiting.byRisk, { vermelho: 0, laranja: 0, amarelo: 0, verde: 1, azul: 0 }); assert.equal(qd.waiting.total, 3);
    assert.equal((await Up('POST', `/api/reparticao/queue/tickets/${byCode.M003.id}/finish`)).status, 200);
    const rep = (await A.api('GET', '/api/prefeitura/queue/report')).data;
    assert.equal(rep.rows.length, 1); assert.deepEqual([rep.rows[0].issued, rep.rows[0].called, rep.rows[0].served, typeof rep.rows[0].avgWaitMin], [4, 1, 1, 'number']);
    const tot = await Up('POST', '/api/reparticao/queue/totem'); assert.equal(tot.status, 201);
    const tot2 = await Up('POST', '/api/reparticao/queue/totem'); assert.equal(tot2.status, 201);
    const Tm = dev(tot2.data.url.split('/').at(-2));
    assert.equal((await dev(tot.data.url.split('/').at(-2))('GET', '/api/totem')).status, 401); assert.equal((await Tm('POST', '/api/totem/tickets', { serviceId: svc.data.id })).data.ticket, 'M005');
    const card = await U('POST', '/api/reparticao/cards', { kind: 'merenda', lines: ['Arroz e feijao'] });
    assert.equal(card.status, 201, JSON.stringify(card.data));
    assert.equal((await A.api('PUT', '/api/prefeitura/defaults', { approval: true, electoral: { from: '2030-08-16', to: '2030-10-27' } })).status, 200);
    await new Promise((r) => { setTimeout(r, 2100); });
    assert.deepEqual((await T1('GET', '/api/telas/config')).data.cards.map((c) => c.title), ['Merenda de hoje']);
    assert.equal((await U('POST', '/api/reparticao/cards', { kind: 'unidade', lines: ['Secretaria aberta'] })).status, 202);
    const pend = (await A.api('GET', '/api/prefeitura/approvals')).data.pending;
    assert.equal(pend.length, 1); assert.equal((await A.api('POST', `/api/prefeitura/approvals/${pend[0].id}/approve`)).status, 200);
    assert.equal((await A.api('GET', `/api/prefeitura/offices/${escola.id}/cards`)).data.cards.length, 2);
    const inst = await A.api('POST', '/api/prefeitura/alerts', { title: 'Institucional', durationMin: 5, scope: { kind: 'city' }, class: 'institucional' });
    assert.equal(inst.status, 201); assert.equal(inst.data.alert.class, 'institucional');
    assert.equal((await A.api('PUT', '/api/prefeitura/offline', { scope: 'default', items: [] })).status, 200);
    assert.deepEqual((await A.api('GET', '/api/prefeitura/offline')).data.items, []);
    assert.equal((await A.api('GET', '/api/prefeitura/availability')).status, 200);
    assert.deepEqual(Object.keys((await A.api('GET', '/api/prefeitura/badge')).data).sort(), ['approvals', 'off']);
    // revogar e excluir o cliente: tudo sai
    assert.equal((await A.api('POST', `/api/prefeitura/devices/${d2.deviceId}/revoke`)).status, 200);
    assert.equal((await T2('GET', '/api/telas/config')).status, 401);
    const del = await P('DELETE', `/api/platform/tenants/${A.id}`, { confirm: 'pg-pref' });
    assert.equal(del.status, 200, JSON.stringify(del.data));
    for (const tb of TELAS_TABLES) assert.equal(Number((await db.get(`SELECT COUNT(*) AS n FROM ${tb} WHERE tenant_id = ?`, [A.id])).n), 0, `${tb} do cliente excluído`);
    assert.equal((await T1('GET', '/api/telas/config')).status, 401);
  } finally {
    if (s) { await s.stop(); cleanup(s.dataDir); }
    if (db) await db.close().catch(() => {});
    await pgs.stop().catch(() => {});
  }
});
