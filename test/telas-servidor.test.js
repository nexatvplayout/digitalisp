// NEXA Telas no servidor de verdade (server/telas.js, docs/TELAS.md): o modo prefeitura ligado pelo perfil de funcionalidades
// do Superadmin (e só por ele: o cliente padrão e o "tudo" não o ligam), a permissão prefeitura.manage, a API da TV box
// exatamente como no contrato (ativar com chave de uso único e 24 h, configuração com rev/ETag e a precedência tela > grupos >
// repartição > padrão, sinal de vida com os comandos entregues uma vez e os alertas pelo alcance: cidade, regiões, grupos
// manuais e automáticos, repartição e raio; token revogado = 401; captura com teto e assinatura JPEG), o isolamento entre
// clientes em cada rota, o link de controle da repartição (senha errada, sessão que só vale para a própria repartição, o
// alcance por tipo, link gerado de novo derruba a sessão) e o freio do ativar.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { boot, cleanup, api, platformLogin, newTenant } from './helpers/srv.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const rawDb = (dataDir) => new DatabaseSync(path.join(dataDir, 'digitalisp.db'), { timeout: 15000 });
/** JPEG mínimo de mentira com a assinatura certa (FF D8 FF … FF D9). */
const jpeg = (n = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 0x41), Buffer.from([0xff, 0xd9])]);
const leaks = (v) => /token_hash|key_hash|link_hash|link_pass|"pin"|"salt"|scrypt\$/.test(JSON.stringify(v));

test('NEXA Telas: modo prefeitura pelo perfil, TV box pelo contrato, grupos, alertas por alcance, isolamento e link de controle', { timeout: 300000 }, async () => {
  // sem APK do app no servidor (TELAS_APP_DIR que não existe): o update só vem do padrão da prefeitura
  const s = await boot({ TELAS_ACTIVATE_PER_IP: '14', PUBLIC_HLS_URL: 'https://hls.exemplo.test', TELAS_APP_DIR: path.join(os.tmpdir(), 'nexa-telas-sem-apk-nao-existe') });
  try {
    const anon = api(s.base);
    const dev = (token) => (method, url, body, headers = {}) => anon(method, url, body, { authorization: `Bearer ${token}`, ...headers });
    const P = api(s.base, await platformLogin(s.base));

    /* ---------------------------------------------------------------- o modo: só ligado de propósito */
    const adminToken = (await anon('POST', '/api/admin/login', { password: 'senha-inicial-longa' })).data.token;
    const D = api(s.base, adminToken); // cliente padrão (plano Ilimitado: tudo ligado, o modo prefeitura também)
    const meD = (await D('GET', '/api/me')).data;
    assert.equal(meD.planFeatures.prefeitura, true, 'o Ilimitado vem com todas as funcionalidades, o modo prefeitura também');
    assert.equal(meD.plan.code, 'ilimitado', 'o painel usa o código para manter o Comercial no Ilimitado');
    assert.equal(meD.planFeatures.comercial, true);
    assert.ok(meD.permissions.includes('prefeitura.manage'), 'Administradores recebem a permissão nova');
    const off = await D('GET', '/api/prefeitura');
    assert.equal(off.status, 200, JSON.stringify(off.data));

    const prof = await P('POST', '/api/platform/feature-profiles', { name: 'Prefeitura', code: 'prefeitura', features: { prefeitura: true, comercial: true, eas: true } });
    assert.equal(prof.status, 201, JSON.stringify(prof.data));
    assert.equal(prof.data.features.prefeitura, true);
    const plan = await P('POST', '/api/platform/plans', { code: 'p-pref', name: 'Prefeitura', priceCents: 0, profileId: prof.data.id, limits: { channels: 1 } });
    assert.equal(plan.status, 201, JSON.stringify(plan.data));
    const A = await newTenant(P, s.base, { slug: 'pref-a', planCode: 'p-pref', status: 'active' });
    const B = await newTenant(P, s.base, { slug: 'pref-b', planCode: 'p-pref', status: 'active' });
    assert.equal((await A.api('POST', '/api/channels', { name: 'TV Prefeitura A', slug: 'pref-a-tv' })).status, 201);
    assert.equal((await B.api('POST', '/api/channels', { name: 'TV Prefeitura B', slug: 'pref-b-tv' })).status, 201);
    const meA = (await A.api('GET', '/api/me')).data;
    assert.equal(meA.planFeatures.prefeitura, true);
    assert.equal(meA.planFeatures.comercial, true, 'os dados do Comercial ficam: só o menu some no painel');

    // permissão: sem prefeitura.manage, 403; grupo limitado a um canal também não entra
    const first = await A.api('GET', '/api/prefeitura');
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.deepEqual([first.data.regions, first.data.offices, first.data.devices, first.data.groups, first.data.keys], [[], [], [], [], []]);
    assert.equal(first.data.channels.length, 1);
    const slugA = first.data.channels[0].slug;
    const vis = (await A.api('POST', '/api/groups', { name: 'Sem telas', permissions: ['playout.view'] })).data;
    assert.equal((await A.api('POST', '/api/users', { username: 'semtelas.a', name: 'Sem', password: 'senha-sem-telas-123', groupIds: [vis.id] })).status, 201);
    const V = api(s.base, (await anon('POST', '/api/admin/login', { tenant: 'pref-a', username: 'semtelas.a', password: 'senha-sem-telas-123' })).data.token);
    assert.equal((await V('GET', '/api/prefeitura')).status, 403);
    const lim = (await A.api('POST', '/api/groups', { name: 'Telas de um canal', permissions: ['prefeitura.manage'], channels: [slugA] })).data;
    assert.equal((await A.api('POST', '/api/users', { username: 'umcanal.a', name: 'Um', password: 'senha-um-canal-1234', groupIds: [lim.id] })).status, 201);
    const L = api(s.base, (await anon('POST', '/api/admin/login', { tenant: 'pref-a', username: 'umcanal.a', password: 'senha-um-canal-1234' })).data.token);
    assert.equal((await L('GET', '/api/prefeitura')).status, 403);
    { const r = await anon('GET', '/api/prefeitura'); assert.equal(r.status, 401, `sem sessão: recusa (${r.status} ${JSON.stringify(r.data)})`); }
    assert.equal((await anon('GET', '/api/prefeitura?tenant=pref-a')).status, 401, 'no cliente com o modo: pede a sessão');

    /* ---------------------------------------------------------------- cadastro */
    const post = async (T, url, body, want = 201) => { const r = await T.api('POST', url, body); assert.equal(r.status, want, `${url}: ${JSON.stringify(r.data)}`); return r.data; };
    const centro = await post(A, '/api/prefeitura/regions', { name: 'Centro', color: '#2266CC' });
    const norte = await post(A, '/api/prefeitura/regions', { name: 'Zona Norte' });
    assert.equal(centro.color, '#2266cc');
    assert.equal((await A.api('POST', '/api/prefeitura/regions', { name: 'x' })).status, 400);
    // a prefeitura inteira: PIN padrão, avisos gerais e o centro do mapa
    const defs = await A.api('PUT', '/api/prefeitura/defaults', { config: { pin: '4321', tickerItems: ['Aviso geral da prefeitura.'], layout: 'ticker' }, city: { name: 'Cidade Exemplo', lat: -22.9, lng: -43.2, zoom: 12 } });
    assert.equal(defs.status, 200, JSON.stringify(defs.data));
    assert.equal(defs.data.config.hasPin, true); assert.ok(!leaks(defs.data), 'o PIN não volta');
    assert.equal((await A.api('PUT', '/api/prefeitura/defaults', { config: { pin: '12' } })).status, 400);
    assert.equal((await A.api('PUT', '/api/prefeitura/defaults', { config: { backup: 'javascript:alert(1)' } })).status, 400);

    const ubs = await post(A, '/api/prefeitura/offices', { name: 'UBS Centro', type: 'ubs', address: 'Rua Um, 10', lat: -22.9, lng: -43.2, regionId: centro.id, respName: 'Maria', respContact: 'maria@exemplo.test' });
    const escola = await post(A, '/api/prefeitura/offices', { name: 'Escola Norte', type: 'escola', lat: -22.8, lng: -43.25, regionId: norte.id, config: { tickerItems: ['Reunião de pais na sexta.'] } });
    const defesa = await post(A, '/api/prefeitura/offices', { name: 'Defesa Civil', type: 'defesa-civil' });
    assert.deepEqual(Object.entries(ubs.modules).filter(([, v]) => v).map(([k]) => k), ['avisos', 'senha', 'panico'], 'a UBS nasce com os avisos, a senha e o botão de pânico'); assert.equal(ubs.link.on, false);
    assert.equal((await A.api('POST', '/api/prefeitura/offices', { name: 'Tipo torto', type: 'banco' })).status, 400);
    assert.equal((await A.api('POST', '/api/prefeitura/offices', { name: 'Meio ponto', type: 'ubs', lat: -22 })).status, 400);

    /* ---------------------------------------------------------------- chave de acesso e ativação */
    const k1 = await post(A, '/api/prefeitura/keys', { officeId: ubs.id, name: 'UBS Centro, recepção' });
    assert.match(k1.key, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.ok(k1.expiresAt - Date.now() > 23.9 * 3600e3 && k1.expiresAt - Date.now() <= 24 * 3600e3 + 5000);
    const listed = (await A.api('GET', '/api/prefeitura')).data;
    assert.equal(listed.keys.length, 1); assert.equal(listed.keys[0].key, undefined, 'a chave só aparece ao gerar'); assert.ok(!leaks(listed));
    const db = rawDb(s.dataDir);
    assert.equal(db.prepare('SELECT key_hash FROM telas_keys WHERE id = ?').get(k1.id).key_hash, sha(k1.key.replace('-', '')), 'no banco fica só o SHA-256 da chave');

    assert.equal((await anon('POST', '/api/telas/activate', { key: 'curta' })).status, 400);
    assert.equal((await anon('POST', '/api/telas/activate', { key: 'ABCD-EFG1' })).status, 400, '1 não é do alfabeto');
    assert.equal((await anon('POST', '/api/telas/activate', {})).status, 400);
    const unknown = await anon('POST', '/api/telas/activate', { key: 'ZZZZ-2222' });
    assert.equal(unknown.status, 404);
    // minúsculas e sem hífen valem
    const act = await anon('POST', '/api/telas/activate', { key: k1.key.replace('-', '').toLowerCase(), device: { model: 'B13', android: '13', appVersion: '1.0.0', serial: 'S1' } });
    assert.equal(act.status, 200, JSON.stringify(act.data));
    assert.deepEqual(Object.keys(act.data).sort(), ['channel', 'deviceId', 'name', 'token']);
    assert.equal(act.data.name, 'UBS Centro, recepção'); assert.equal(act.data.channel, slugA); assert.ok(act.data.token.length >= 43);
    const T1 = dev(act.data.token);
    assert.equal(db.prepare('SELECT token_hash FROM telas_devices WHERE id = ?').get(act.data.deviceId).token_hash, sha(act.data.token), 'no banco fica só o SHA-256 do token');
    const again = await anon('POST', '/api/telas/activate', { key: k1.key });
    assert.equal(again.status, 404, 'uso único'); assert.equal(again.data.error, unknown.data.error, 'mesma mensagem para inexistente, usada e vencida');
    // vencida (24 h)
    const k2 = await post(A, '/api/prefeitura/keys', { officeId: escola.id });
    db.prepare('UPDATE telas_keys SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, k2.id);
    assert.equal((await anon('POST', '/api/telas/activate', { key: k2.key })).status, 404, 'chave vencida');
    const k3 = await post(A, '/api/prefeitura/keys', { officeId: escola.id });
    const act2 = await anon('POST', '/api/telas/activate', { key: k3.key, device: { model: 'B13' } });
    assert.equal(act2.data.name, 'Escola Norte', 'sem nome na chave: o da repartição');
    const T2 = dev(act2.data.token);
    assert.equal((await anon('GET', '/api/telas/config')).status, 401);
    assert.equal((await dev('x'.repeat(43))('GET', '/api/telas/config')).status, 401);

    /* ---------------------------------------------------------------- configuração: contrato, rev/ETag e precedência */
    let c1 = await T1('GET', '/api/telas/config');
    assert.equal(c1.status, 200, JSON.stringify(c1.data));
    assert.deepEqual(Object.keys(c1.data).sort(), ['callSound', 'captions', 'cards', 'device', 'heartbeatSec', 'layout', 'lock', 'offline', 'queue', 'rev', 'schedule', 'side', 'stream', 'theme', 'ticker', 'weather']);
    assert.deepEqual(c1.data.device, { id: act.data.deviceId, name: 'UBS Centro, recepção', office: 'UBS Centro', officeType: 'ubs', region: 'Centro' });
    assert.match(c1.data.stream.hls, new RegExp(`^https://hls\\.exemplo\\.test/hls/${slugA}/.+\\.m3u8$`));
    assert.deepEqual([c1.data.stream.backup, c1.data.stream.volume, c1.data.stream.muted, c1.data.heartbeatSec, c1.data.schedule], [null, 100, false, 30, null]);
    // padrão da prefeitura: layout, avisos gerais e o PIN (só o sal e o hash)
    assert.equal(c1.data.layout, 'ticker'); assert.deepEqual(c1.data.ticker, { items: ['Aviso geral da prefeitura.'], speed: 60, style: null, rich: [{ text: 'Aviso geral da prefeitura.' }] });
    assert.equal(c1.data.lock.pinHash, sha(`${c1.data.lock.pinSalt}4321`)); assert.deepEqual(c1.data.lock.exitSeq, ['UP', 'UP', 'DOWN', 'DOWN', 'OK']);
    assert.ok(!JSON.stringify(c1.data).includes('4321'), 'o PIN não vai ao aparelho');
    assert.equal(c1.headers.get('etag'), `"${c1.data.rev}"`); assert.equal(c1.headers.get('cache-control'), 'no-store');
    assert.equal((await T1('GET', '/api/telas/config', undefined, { 'if-none-match': `"${c1.data.rev}"` })).status, 304);
    assert.equal((await T1('GET', '/api/telas/config', undefined, { 'if-none-match': c1.data.rev })).status, 304, 'o rev puro também vale');
    // repartição > padrão
    assert.deepEqual((await T2('GET', '/api/telas/config')).data.ticker.items, ['Reunião de pais na sexta.']);
    const patch = async (url, body) => { const r = await A.api('PATCH', url, body); assert.equal(r.status, 200, `${url}: ${JSON.stringify(r.data)}`); return r.data; };
    await patch(`/api/prefeitura/offices/${ubs.id}`, { config: { tickerItems: ['Vacina até sexta.'], layout: 'side', pin: '777777' } });
    const c2 = (await T1('GET', '/api/telas/config', undefined, { 'if-none-match': `"${c1.data.rev}"` }));
    assert.equal(c2.status, 200, 'mudou a configuração: rev novo'); assert.notEqual(c2.data.rev, c1.data.rev);
    assert.deepEqual([c2.data.layout, c2.data.ticker.items], ['side', ['Vacina até sexta.']]);
    assert.equal(c2.data.lock.pinHash, sha(`${c2.data.lock.pinSalt}777777`), 'PIN da repartição no lugar do padrão');
    // grupos > repartição: avisos de todos os grupos com avisos, na ordem; layout do primeiro grupo que define
    const gSaude = await post(A, '/api/prefeitura/groups', { name: 'Saúde', sort: 2, config: { tickerItems: ['Campanha da saúde.'], layout: 'lbar' }, deviceIds: [act.data.deviceId] });
    const gTodos = await post(A, '/api/prefeitura/groups', { name: 'Campanha', sort: 1, description: 'Todas as telas da campanha', color: '#ff0000', config: { tickerItems: ['Campanha do agasalho.'] }, deviceIds: [act.data.deviceId, act2.data.deviceId] });
    const gEscolas = await post(A, '/api/prefeitura/groups', { name: 'Escolas', officeType: 'escola', sort: 3, config: { tickerItems: ['Volta às aulas dia 3.'] } });
    assert.deepEqual([gSaude.deviceIds, gTodos.deviceIds.sort(), gEscolas.deviceIds, gEscolas.officeType], [[act.data.deviceId], [act.data.deviceId, act2.data.deviceId].sort(), [], 'escola']);
    assert.equal((await A.api('POST', '/api/prefeitura/groups', { name: 'Auto torto', officeType: 'ubs', deviceIds: [act.data.deviceId] })).status, 400, 'automático não tem telas à mão');
    assert.equal((await A.api('POST', '/api/prefeitura/groups', { name: 'Fora', deviceIds: [999999] })).status, 400);
    assert.equal((await A.api('POST', '/api/prefeitura/groups', { name: 'PIN no grupo', config: { pin: '1234' } })).data.config.pin, undefined, 'o grupo só define avisos e layout');
    let c3 = (await T1('GET', '/api/telas/config')).data;
    assert.deepEqual(c3.ticker.items, ['Campanha do agasalho.', 'Campanha da saúde.'], 'ordem dos grupos (sort)');
    assert.equal(c3.layout, 'lbar', 'o primeiro grupo que define layout');
    const c3b = (await T2('GET', '/api/telas/config')).data;
    assert.deepEqual(c3b.ticker.items, ['Campanha do agasalho.', 'Volta às aulas dia 3.'], 'grupo manual + automático pelo tipo da repartição');
    assert.equal(c3b.layout, 'ticker', 'nenhum grupo dela define layout: o da repartição, senão o padrão');
    // tela > grupos
    const d1 = await patch(`/api/prefeitura/devices/${act.data.deviceId}`, { config: { tickerItems: ['Só nesta tela.'], layout: 'full', backup: 'https://reserva.exemplo.test/x.m3u8', pin: '0000' }, lat: -22.95, lng: -43.21 });
    assert.equal(d1.config.hasPin, true); assert.ok(!leaks(d1)); assert.deepEqual(d1.groups.sort(), [gSaude.id, gTodos.id].sort());
    c3 = (await T1('GET', '/api/telas/config')).data;
    assert.deepEqual([c3.layout, c3.ticker.items, c3.stream.backup], ['full', ['Só nesta tela.'], 'https://reserva.exemplo.test/x.m3u8']);
    assert.equal(c3.lock.pinHash, sha(`${c3.lock.pinSalt}0000`));
    // tirar o que a tela define: volta a herdar (grupos)
    await patch(`/api/prefeitura/devices/${act.data.deviceId}`, { config: { tickerItems: null, layout: null, backup: null, pin: null } });
    c3 = (await T1('GET', '/api/telas/config')).data;
    assert.deepEqual([c3.layout, c3.ticker.items, c3.stream.backup], ['lbar', ['Campanha do agasalho.', 'Campanha da saúde.'], null]);
    // os grupos da tela pelo cadastro dela (só os manuais)
    assert.equal((await A.api('PATCH', `/api/prefeitura/devices/${act.data.deviceId}`, { groups: [gEscolas.id] })).status, 400, 'automático não se escolhe à mão');
    assert.deepEqual((await patch(`/api/prefeitura/devices/${act.data.deviceId}`, { groups: [gSaude.id] })).groups, [gSaude.id]);
    assert.deepEqual((await T1('GET', '/api/telas/config')).data.ticker.items, ['Campanha da saúde.']);
    assert.deepEqual((await patch(`/api/prefeitura/devices/${act.data.deviceId}`, { groups: [gSaude.id, gTodos.id] })).groups.sort(), [gSaude.id, gTodos.id].sort());
    // grupos automáticos por tipo em uso (ubs, defesa-civil; escola já tem)
    const auto = await post(A, '/api/prefeitura/groups/auto', {});
    assert.deepEqual(auto.created.sort(), ['defesa-civil', 'ubs']);
    assert.deepEqual((await post(A, '/api/prefeitura/groups/auto', {})).created, [], 'uma vez só por tipo');

    /* ---------------------------------------------------------------- sinal de vida, situação, comandos */
    const hb = (T, extra = {}) => T('POST', '/api/telas/heartbeat', { rev: 'x', state: 'playing', source: 'hls', appVersion: '1.0.1', uptimeSec: 60, net: 'wifi', lastError: null, locked: true, ...extra });
    let h = await hb(T1);
    assert.equal(h.status, 200, JSON.stringify(h.data));
    assert.deepEqual(Object.keys(h.data).sort(), ['alerts', 'commands', 'missing', 'rev']);
    assert.deepEqual([h.data.commands, h.data.alerts], [[], []]); assert.equal(h.data.rev, (await T1('GET', '/api/telas/config')).data.rev);
    let st = (await A.api('GET', '/api/prefeitura/status')).data;
    const live1 = st.devices.find((d) => d.id === act.data.deviceId);
    assert.deepEqual([live1.state, live1.source, live1.net, live1.appVersion, live1.locked], ['playing', 'hls', 'wifi', '1.0.1', true]);
    assert.ok(Date.now() - live1.lastSeen < 10000 && live1.onlineSince <= live1.lastSeen);
    assert.equal(st.devices.find((d) => d.id === act2.data.deviceId).lastSeen, null, 'a outra nunca deu sinal');
    await hb(T1, { state: 'inventado', lastError: 'x'.repeat(1000) });
    st = (await A.api('GET', '/api/prefeitura/status')).data;
    assert.equal(st.devices.find((d) => d.id === act.data.deviceId).state, null); assert.equal(st.devices.find((d) => d.id === act.data.deviceId).lastError.length, 300);
    assert.equal(st.devices.find((d) => d.id === act.data.deviceId).onlineSince, live1.onlineSince, 'ligada sem parar: o "desde" não muda');
    // comandos: entregues uma vez, e só à tela certa
    assert.equal((await A.api('POST', `/api/prefeitura/devices/${act.data.deviceId}/commands`, { type: 'formatar' })).status, 400);
    const cmd = await post(A, `/api/prefeitura/devices/${act.data.deviceId}/commands`, { type: 'screenshot' });
    assert.equal((await post(A, `/api/prefeitura/devices/${act.data.deviceId}/commands`, { type: 'screenshot' })).id, cmd.id, 'o mesmo comando na fila não empilha');
    await post(A, `/api/prefeitura/devices/${act.data.deviceId}/commands`, { type: 'reload' });
    assert.deepEqual((await hb(T2)).data.commands, []);
    h = await hb(T1);
    assert.deepEqual(h.data.commands.map((c) => c.type), ['screenshot', 'reload']); assert.equal(h.data.commands[0].id, cmd.id);
    assert.deepEqual((await hb(T1)).data.commands, [], 'cada comando sai uma vez');
    assert.equal((await T2('POST', `/api/telas/commands/${cmd.id}/done`, { ok: true })).status, 404, 'comando de outra tela');
    assert.equal((await T1('POST', `/api/telas/commands/${cmd.id}/done`, { ok: true, detail: 'feito' })).status, 200);
    assert.deepEqual({ ...db.prepare('SELECT ok, detail FROM telas_commands WHERE id = ?').get(cmd.id) }, { ok: 1, detail: 'feito' });

    /* ---------------------------------------------------------------- captura da tela */
    assert.equal((await T1('POST', '/api/telas/screenshot', Buffer.from('não é jpeg, mas tem bytes suficientes para passar do tamanho mínimo exigido pelo servidor, ou quase isso, quem sabe'), { 'content-type': 'image/jpeg' })).status, 400);
    assert.equal((await T1('POST', '/api/telas/screenshot', jpeg(), { 'content-type': 'image/png' })).status, 415);
    assert.equal((await T1('POST', '/api/telas/screenshot', jpeg(410 * 1024), { 'content-type': 'image/jpeg' })).status, 413, 'teto de 400 KB');
    assert.equal((await anon('POST', '/api/telas/screenshot', jpeg(), { 'content-type': 'image/jpeg' })).status, 401);
    const shot = jpeg(3000);
    assert.equal((await T1('POST', '/api/telas/screenshot', shot, { 'content-type': 'image/jpeg' })).status, 204);
    const file = path.join(s.dataDir, 'telas', 'shots', String(A.id), `${act.data.deviceId}.jpg`);
    assert.ok(fs.readFileSync(file).equals(shot), 'a captura fica em DATA_DIR/telas/shots/<cliente>/<tela>.jpg');
    const got = await fetch(`${s.base}/api/prefeitura/devices/${act.data.deviceId}/screenshot`, { headers: { 'x-admin-token': A.token } });
    assert.equal(got.status, 200); assert.equal(got.headers.get('content-type'), 'image/jpeg'); assert.ok(Buffer.from(await got.arrayBuffer()).equals(shot));
    assert.equal((await A.api('GET', `/api/prefeitura/devices/${act2.data.deviceId}/screenshot`)).status, 404, 'sem captura ainda');
    assert.equal((await A.api('GET', '/api/prefeitura/devices/..%2f..%2f1/screenshot')).status, 400, 'o id é sempre um inteiro');
    assert.ok((await A.api('GET', '/api/prefeitura/status')).data.devices.find((d) => d.id === act.data.deviceId).shotAt > 0);

    /* ---------------------------------------------------------------- alertas pelo alcance (com a prévia) */
    const alertsOf = async (T) => (await hb(T)).data.alerts.map((a) => a.title).sort();
    const send = async (title, scope, extra = {}) => post(A, '/api/prefeitura/alerts', { title, text: `Texto de ${title}`, level: 'warn', sound: true, durationMin: 30, scope, ...extra });
    const pv = async (scope) => (await A.api('POST', '/api/prefeitura/alerts/preview', { scope })).data;
    assert.deepEqual(await pv({ kind: 'city' }), { total: 2, online: 2, offices: 2 });
    assert.deepEqual(await pv({ kind: 'regions', regions: [centro.id] }), { total: 1, online: 1, offices: 1 });
    assert.deepEqual(await pv({ kind: 'groups', groups: [gEscolas.id] }), { total: 1, online: 1, offices: 1 });
    assert.deepEqual(await pv({ kind: 'groups', groups: [gEscolas.id, gSaude.id] }), { total: 2, online: 2, offices: 2 });
    assert.deepEqual(await pv({ kind: 'office', office: defesa.id }), { total: 0, online: 0, offices: 0 });
    // raio: a tela 1 tem ponto próprio (-22.95, -43.21); a 2 usa o da repartição (-22.8, -43.25): ~16,6 km uma da outra
    assert.deepEqual(await pv({ kind: 'radius', lat: -22.95, lng: -43.21, meters: 1000 }), { total: 1, online: 1, offices: 1 });
    assert.deepEqual(await pv({ kind: 'radius', lat: -22.95, lng: -43.21, meters: 20000 }), { total: 2, online: 2, offices: 2 });
    assert.equal((await A.api('POST', '/api/prefeitura/alerts/preview', { scope: { kind: 'radius', lat: -22.95, lng: -43.21, meters: 5 } })).status, 400);
    assert.equal((await A.api('POST', '/api/prefeitura/alerts/preview', { scope: { kind: 'regions', regions: [999999] } })).status, 400);
    assert.equal((await A.api('POST', '/api/prefeitura/alerts', { title: 'Sem tempo', scope: { kind: 'city' } })).status, 400, 'duração ou até quando');
    assert.equal((await A.api('POST', '/api/prefeitura/alerts', { title: 'Longo', durationMin: 60 * 24 * 8, scope: { kind: 'city' } })).status, 400, 'no máximo 7 dias');

    const aCity = await send('Cidade', { kind: 'city' });
    const aNext = await send('Centro', { kind: 'regions', regions: [centro.id] });
    assert.ok(aNext.alert.id > aCity.alert.id, 'o id cresce com a criação: o app trata o maior id como o mais novo');
    assert.deepEqual(aCity.reach, { total: 2, online: 2, offices: 2 }); assert.equal(aCity.alert.status, 'em vigor');
    await send('Escolas', { kind: 'groups', groups: [gEscolas.id] });
    await send('Campanha', { kind: 'groups', groups: [gTodos.id] });
    await send('Só a UBS', { kind: 'office', office: ubs.id });
    await send('Perto', { kind: 'radius', lat: -22.95, lng: -43.21, meters: 1000 });
    await send('Agendado', { kind: 'city' }, { startsAt: Date.now() + 3600e3, durationMin: 10 });
    assert.deepEqual(await alertsOf(T1), ['Campanha', 'Centro', 'Cidade', 'Perto', 'Só a UBS']);
    assert.deepEqual(await alertsOf(T2), ['Campanha', 'Cidade', 'Escolas']);
    const one = (await hb(T1)).data.alerts.find((a) => a.title === 'Cidade');
    assert.deepEqual(Object.keys(one).sort(), ['id', 'level', 'sound', 'text', 'title', 'until']);
    assert.deepEqual([one.id, one.text, one.level, one.sound], [aCity.alert.id, 'Texto de Cidade', 'warn', true]);
    assert.ok(Math.abs(one.until - (Date.now() + 30 * 60000)) < 15000);
    // tela que sai do grupo deixa de receber o alerta do grupo
    await patch(`/api/prefeitura/groups/${gTodos.id}`, { deviceIds: [act.data.deviceId] });
    assert.deepEqual(await alertsOf(T2), ['Cidade', 'Escolas']);
    // encerrar: some da lista; o histórico guarda as entregas
    assert.equal((await A.api('POST', `/api/prefeitura/alerts/${aCity.alert.id}/cancel`)).status, 200);
    assert.deepEqual(await alertsOf(T2), ['Escolas']);
    const al = (await A.api('GET', '/api/prefeitura/alerts')).data;
    assert.deepEqual(al.active.map((a) => a.title).sort(), ['Agendado', 'Campanha', 'Centro', 'Escolas', 'Perto', 'Só a UBS']);
    const hist = al.history.find((a) => a.id === aCity.alert.id);
    assert.deepEqual([hist.status, hist.delivered, hist.cancelledBy], ['encerrado', 2, A.username]);
    const det = (await A.api('GET', `/api/prefeitura/alerts/${aCity.alert.id}`)).data;
    assert.deepEqual(det.deliveries.map((d) => d.name).sort(), ['Escola Norte', 'UBS Centro, recepção']);

    /* ---------------------------------------------------------------- isolamento entre clientes */
    const bOffice = await post(B, '/api/prefeitura/offices', { name: 'UPA do B', type: 'upa', lat: -22.95, lng: -43.21 });
    const bKey = await post(B, '/api/prefeitura/keys', { officeId: bOffice.id });
    const bAct = (await anon('POST', '/api/telas/activate', { key: bKey.key })).data;
    const TB = dev(bAct.token);
    // B não tem PIN padrão: a repartição nasce com um PIN sorteado, mostrado UMA vez; o aparelho nunca recebe o hash vazio
    assert.match(bOffice.generatedPin, /^\d{6}$/); assert.equal(ubs.generatedPin, undefined, 'com PIN padrão na prefeitura, nada é sorteado');
    let cb = (await TB('GET', '/api/telas/config')).data;
    assert.equal(cb.lock.pinHash, sha(`${cb.lock.pinSalt}${bOffice.generatedPin}`));
    assert.ok(!JSON.stringify((await B.api('GET', '/api/prefeitura')).data).includes(bOffice.generatedPin), 'depois de criado, o PIN não volta');
    assert.equal((await B.api('PATCH', `/api/prefeitura/offices/${bOffice.id}`, { config: { pin: null } })).status, 200);
    const cb2 = (await TB('GET', '/api/telas/config')).data;
    assert.match(cb2.lock.pinHash, /^[0-9a-f]{64}$/, 'PIN tirado sem padrão: a repartição ganha outro sorteado, nunca vazio'); assert.notEqual(cb2.lock.pinHash, cb.lock.pinHash);
    assert.equal((await TB('GET', '/api/telas/config')).data.rev, cb2.rev, 'o PIN sorteado fica gravado: o rev não muda a cada leitura');
    const np = await post(B, `/api/prefeitura/offices/${bOffice.id}/pin`, {});
    assert.match(np.pin, /^\d{6}$/);
    cb = (await TB('GET', '/api/telas/config')).data;
    assert.equal(cb.lock.pinHash, sha(`${cb.lock.pinSalt}${np.pin}`), '"PIN novo": sorteado e mostrado uma vez');
    assert.equal((await A.api('POST', `/api/prefeitura/offices/${bOffice.id}/pin`, {})).status, 404, 'PIN de repartição de outro cliente');
    // horário da TV: 0 = domingo … 6 = sábado (7 também domingo); atualização do app só por https
    assert.equal('update' in cb, false);
    const sch = await B.api('PUT', '/api/prefeitura/defaults', { config: { schedule: { tvOn: '07:00', tvOff: '19:00', days: [7, 1, 5] } }, update: { url: 'https://dl.exemplo.test/telas.apk', sha256: 'b'.repeat(64), versionCode: 7 } });
    assert.equal(sch.status, 200, JSON.stringify(sch.data));
    cb = (await TB('GET', '/api/telas/config')).data;
    assert.deepEqual(cb.schedule, { tvOn: '07:00', tvOff: '19:00', days: [0, 1, 5] });
    assert.deepEqual(cb.update, { url: 'https://dl.exemplo.test/telas.apk', sha256: 'b'.repeat(64), versionCode: 7 });
    assert.equal((await B.api('PUT', '/api/prefeitura/defaults', { update: { url: 'http://dl.exemplo.test/telas.apk', sha256: 'b'.repeat(64), versionCode: 8 } })).status, 400, 'APK só por https');
    assert.equal((await B.api('PUT', '/api/prefeitura/defaults', { update: null, config: { schedule: null } })).status, 200);
    cb = (await TB('GET', '/api/telas/config')).data;
    assert.equal('update' in cb, false); assert.equal(cb.schedule, null);
    assert.equal('update' in (await T1('GET', '/api/telas/config')).data, false, 'a atualização de B não vale em A');
    const bView = (await B.api('GET', '/api/prefeitura')).data;
    assert.deepEqual([bView.offices.length, bView.devices.length, bView.regions.length, bView.groups.length], [1, 1, 0, 0], 'B só vê o que é dele');
    assert.deepEqual((await hb(TB)).data.alerts, [], 'alertas de A (inclusive o raio no mesmo ponto) não chegam à tela de B');
    assert.equal((await TB('GET', '/api/telas/config')).data.ticker.items.length, 0, 'padrão de A não vale em B');
    for (const [method, url, body] of [
      ['PATCH', `/api/prefeitura/offices/${ubs.id}`, { name: 'Invadida' }], ['DELETE', `/api/prefeitura/offices/${ubs.id}`], ['POST', `/api/prefeitura/offices/${ubs.id}/link`, { password: 'senha-do-link-1' }],
      ['PATCH', `/api/prefeitura/devices/${act.data.deviceId}`, { name: 'Invadida' }], ['POST', `/api/prefeitura/devices/${act.data.deviceId}/revoke`], ['POST', `/api/prefeitura/devices/${act.data.deviceId}/commands`, { type: 'reboot' }],
      ['GET', `/api/prefeitura/devices/${act.data.deviceId}/screenshot`], ['PATCH', `/api/prefeitura/regions/${centro.id}`, { name: 'Invadida' }], ['DELETE', `/api/prefeitura/groups/${gSaude.id}`],
      ['GET', `/api/prefeitura/alerts/${aCity.alert.id}`], ['POST', `/api/prefeitura/alerts/${aCity.alert.id}/cancel`], ['DELETE', `/api/prefeitura/keys/${k2.id}`], ['POST', '/api/prefeitura/keys', { officeId: ubs.id }],
    ]) assert.equal((await B.api(method, url, body)).status, 404, `${method} ${url} de outro cliente`);
    for (const scope of [{ kind: 'regions', regions: [centro.id] }, { kind: 'groups', groups: [gSaude.id] }, { kind: 'office', office: ubs.id }]) {
      assert.equal((await B.api('POST', '/api/prefeitura/alerts', { title: 'Vazado', durationMin: 5, scope })).status, 400, `alcance com ids de outro cliente: ${scope.kind}`);
    }
    assert.equal((await B.api('POST', '/api/prefeitura/offices', { name: 'Região alheia', type: 'ubs', regionId: centro.id })).status, 404);
    assert.equal((await B.api('POST', '/api/prefeitura/groups', { name: 'Tela alheia', deviceIds: [act.data.deviceId] })).status, 400);
    assert.equal((await B.api('PATCH', `/api/prefeitura/devices/${bAct.deviceId}`, { groups: [gSaude.id] })).status, 400);
    assert.equal((await B.api('PATCH', `/api/prefeitura/devices/${bAct.deviceId}`, { officeId: ubs.id })).status, 404);
    await post(B, '/api/prefeitura/alerts', { title: 'Do B', durationMin: 5, scope: { kind: 'city' } });
    assert.ok(!(await alertsOf(T1)).includes('Do B')); assert.deepEqual(await alertsOf(TB), ['Do B']);
    assert.equal((await A.api('GET', '/api/prefeitura')).data.offices.find((o) => o.id === ubs.id).name, 'UBS Centro');

    /* ---------------------------------------------------------------- link de controle da repartição */
    assert.equal((await A.api('POST', `/api/prefeitura/offices/${ubs.id}/link`, {})).status, 400, 'o link pede a senha');
    assert.equal((await A.api('POST', `/api/prefeitura/offices/${ubs.id}/link`, { password: 'curta' })).status, 400);
    const link = await post(A, `/api/prefeitura/offices/${ubs.id}/link`, { password: 'senha-da-ubs-2026' });
    assert.match(link.url, /\/reparticao\/[A-Za-z0-9_-]{43}$/); assert.equal(link.office.link.on, true); assert.ok(!leaks(link.office));
    const linkToken = link.url.split('/').pop();
    assert.equal(db.prepare('SELECT link_hash FROM telas_offices WHERE id = ?').get(ubs.id).link_hash, sha(linkToken));
    assert.ok(!leaks((await A.api('GET', '/api/prefeitura')).data), 'nada de hash nem do link na leitura do painel');
    // a página: CSP sem inline e sem nada de fora
    const page = await fetch(link.url.replace(/^https?:\/\/[^/]+/, s.base));
    assert.equal(page.status, 200);
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /default-src 'none'/); assert.match(csp, /script-src 'self'(;|$)/); assert.ok(!/unsafe-inline|https?:/.test(csp), csp);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer'); assert.equal(page.headers.get('cache-control'), 'no-store');
    const html = await page.text();
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>|\son[a-z]+=|style=/i.test(html), 'sem script nem estilo inline');
    assert.equal((await fetch(`${s.base}/reparticao/curto`)).status, 404);
    // senha errada, link errado, mesma resposta
    const bad1 = await anon('POST', '/api/reparticao/login', { token: linkToken, password: 'senha-errada-123' });
    const bad2 = await anon('POST', '/api/reparticao/login', { token: 'A'.repeat(43), password: 'senha-da-ubs-2026' });
    assert.deepEqual([bad1.status, bad2.status], [401, 401]); assert.equal(bad1.data.error, bad2.data.error);
    assert.equal((await anon('POST', '/api/reparticao/login', { token: { $ne: 1 }, password: ['x'] })).status, 401);
    const ok = await anon('POST', '/api/reparticao/login', { token: linkToken, password: 'senha-da-ubs-2026' });
    assert.equal(ok.status, 200, JSON.stringify(ok.data)); assert.deepEqual(ok.data.office, { name: 'UBS Centro', type: 'ubs' });
    const U = dev(ok.data.session);
    const us = (await U('GET', '/api/reparticao/state')).data;
    assert.deepEqual(us.devices.map((d) => d.name), ['UBS Centro, recepção'], 'só as telas da própria repartição');
    assert.deepEqual([us.devices[0].status, us.alertScopes, us.regions, us.groups, us.avisos.items], ['on', ['office'], [], [], ['Vacina até sexta.']]);
    assert.ok(!leaks(us));
    // a sessão do link não abre o painel nem a API da TV box, e a sessão do painel não abre o link
    assert.equal((await U('GET', '/api/prefeitura?tenant=pref-a')).status, 401); assert.equal((await U('GET', '/api/telas/config')).status, 401);
    assert.equal((await A.api('GET', '/api/reparticao/state')).status, 401); assert.equal((await T1('GET', '/api/reparticao/state')).status, 401);
    // avisos e layout pela repartição: a tela dela muda (a tela está nos grupos; tira dos grupos para ver o da repartição)
    await patch(`/api/prefeitura/devices/${act.data.deviceId}`, { groups: [] });
    const before = (await T1('GET', '/api/telas/config')).data;
    const put = await U('PUT', '/api/reparticao/avisos', { items: ['  Fechado no feriado.  ', '', 'Vacina sábado.'], layout: 'ticker', pin: '1111', backup: 'https://x.test/a.m3u8' });
    assert.equal(put.status, 200, JSON.stringify(put.data)); assert.deepEqual(put.data, { items: ['Fechado no feriado.', 'Vacina sábado.'], layout: 'ticker', theme: null });
    const after = (await T1('GET', '/api/telas/config')).data;
    assert.deepEqual([after.ticker.items, after.layout], [['Fechado no feriado.', 'Vacina sábado.'], 'ticker']);
    assert.deepEqual([after.lock, after.stream.backup], [before.lock, null], 'o link não mexe em PIN nem no sinal reserva');
    assert.equal((await U('PUT', '/api/reparticao/avisos', { layout: 'fila' })).status, 400);
    assert.equal((await U('PUT', '/api/reparticao/avisos', { items: Array(21).fill('x') })).status, 400);
    // alcance pelo tipo: a UBS só alcança as próprias telas
    for (const scope of [{ kind: 'city' }, { kind: 'regions', regions: [centro.id] }, { kind: 'groups', groups: [gEscolas.id] }, { kind: 'radius', lat: -22.9, lng: -43.2, meters: 5000 }]) {
      assert.equal((await U('POST', '/api/reparticao/alerts', { title: 'Fora do alcance', durationMin: 5, scope })).status, 403, `UBS com ${scope.kind}`);
      assert.equal((await U('POST', '/api/reparticao/alerts/preview', { scope })).status, 403);
    }
    // "office" é sempre a própria: o id de outra repartição no pedido não conta
    assert.deepEqual((await U('POST', '/api/reparticao/alerts/preview', { scope: { kind: 'office', office: escola.id } })).data, { total: 1, online: 1, offices: 1 });
    const ua = await U('POST', '/api/reparticao/alerts', { title: 'Aviso da UBS', text: 'Sem médico hoje.', level: 'info', durationMin: 10, scope: { kind: 'office', office: escola.id } });
    assert.equal(ua.status, 201, JSON.stringify(ua.data)); assert.deepEqual(ua.data.alert.scope, { kind: 'office', office: ubs.id });
    assert.ok((await alertsOf(T1)).includes('Aviso da UBS')); assert.ok(!(await alertsOf(T2)).includes('Aviso da UBS'));
    // Defesa Civil: cidade, regiões e grupos
    const dl = await post(A, `/api/prefeitura/offices/${defesa.id}/link`, { password: 'senha-da-defesa-26' });
    const Dc = dev((await anon('POST', '/api/reparticao/login', { token: dl.url.split('/').pop(), password: 'senha-da-defesa-26' })).data.session);
    const ds = (await Dc('GET', '/api/reparticao/state')).data;
    assert.deepEqual(ds.alertScopes, ['reach', 'city', 'regions', 'groups', 'office', 'radius']); assert.deepEqual(ds.devices, []);
    assert.deepEqual(ds.regions.map((r) => r.name), ['Centro', 'Zona Norte']); assert.ok(ds.groups.some((g) => g.name === 'Escolas'));
    assert.deepEqual((await Dc('POST', '/api/reparticao/alerts/preview', { scope: { kind: 'groups', groups: [gEscolas.id] } })).data, { total: 1, online: 1, offices: 1 });
    const da = await Dc('POST', '/api/reparticao/alerts', { title: 'Chuva forte', text: 'Evite áreas de risco.', level: 'critical', sound: true, confirmExtreme: true, durationMin: 60, scope: { kind: 'regions', regions: [norte.id] } });
    assert.equal(da.status, 201, JSON.stringify(da.data));
    assert.ok((await alertsOf(T2)).includes('Chuva forte')); assert.ok(!(await alertsOf(T1)).includes('Chuva forte'));
    // o raio no mapa também vale no link de quem alcança a cidade (a contagem, sem criar o alerta); Extremo pede a confirmação
    assert.equal((await Dc('POST', '/api/reparticao/alerts/preview', { scope: { kind: 'radius', lat: -22.9, lng: -43.2, meters: 5000 } })).status, 200, 'o raio no link da Defesa Civil');
    assert.equal((await Dc('POST', '/api/reparticao/alerts', { title: 'Sem confirmar', level: 'critical', durationMin: 5, scope: { kind: 'city' } })).status, 400, 'Extremo sem a confirmação a mais');
    assert.equal((await Dc('POST', '/api/reparticao/alerts', { title: 'Do B', durationMin: 5, scope: { kind: 'regions', regions: [999999] } })).status, 400);
    // uma repartição não encerra o alerta da outra nem o do painel; encerra o próprio
    assert.equal((await U('POST', `/api/reparticao/alerts/${da.data.alert.id}/cancel`)).status, 404);
    assert.equal((await Dc('POST', `/api/reparticao/alerts/${ua.data.alert.id}/cancel`)).status, 404);
    assert.deepEqual((await U('GET', '/api/reparticao/state')).data.alerts.map((a) => a.title), ['Aviso da UBS'], 'a repartição só vê os alertas dela');
    assert.equal((await U('POST', `/api/reparticao/alerts/${ua.data.alert.id}/cancel`)).status, 200);
    assert.ok(!(await alertsOf(T1)).includes('Aviso da UBS'));
    // trocar a senha, gerar outro link ou desligar: a sessão aberta cai e o link antigo deixa de valer
    assert.equal((await A.api('PUT', `/api/prefeitura/offices/${ubs.id}/link/password`, { password: 'outra-senha-da-ubs' })).status, 200);
    assert.equal((await U('GET', '/api/reparticao/state')).status, 401, 'senha trocada derruba a sessão');
    assert.equal((await anon('POST', '/api/reparticao/login', { token: linkToken, password: 'senha-da-ubs-2026' })).status, 401);
    const U2s = (await anon('POST', '/api/reparticao/login', { token: linkToken, password: 'outra-senha-da-ubs' })).data.session;
    const link2 = await post(A, `/api/prefeitura/offices/${ubs.id}/link`, {});
    assert.notEqual(link2.url, link.url);
    assert.equal((await dev(U2s)('GET', '/api/reparticao/state')).status, 401, 'link gerado de novo derruba a sessão');
    assert.equal((await anon('POST', '/api/reparticao/login', { token: linkToken, password: 'outra-senha-da-ubs' })).status, 401, 'o link antigo não vale');
    assert.equal((await anon('POST', '/api/reparticao/login', { token: link2.url.split('/').pop(), password: 'outra-senha-da-ubs' })).status, 200, 'gerar de novo sem senha mantém a senha');
    assert.equal((await A.api('DELETE', `/api/prefeitura/offices/${defesa.id}/link`)).status, 200);
    assert.equal((await Dc('GET', '/api/reparticao/state')).status, 401, 'link desligado');
    // sessão forjada (outra repartição no token) não passa pela assinatura
    const forged = U2s.replace(/^r1\.\d+\./, `r1.${escola.id}.`);
    assert.equal((await dev(forged)('GET', '/api/reparticao/state')).status, 401);

    /* ---------------------------------------------------------------- auditoria: tudo registrado, sem segredos */
    const audit = db.prepare('SELECT username, action, detail FROM audit_log WHERE tenant_id = ?').all(A.id).map((r) => ({ ...r }));
    for (const want of [/chave de acesso gerada/, /tela ".+" \(#\d+\) ativada/, /alerta "Cidade"/, /alerta "Cidade" encerrado/, /link de controle de "UBS Centro" gerado/, /entrada pelo link de controle/, /avisos da repartição alterados pelo link/, /alerta "Chuva forte" \(critical\) pelo link/, /grupo "Saúde" criado/, /comando screenshot/]) {
      assert.ok(audit.some((r) => want.test(r.detail || '')), `auditoria sem ${want}`);
    }
    const dump = JSON.stringify(audit) + s.out();
    for (const secret of [act.data.token, k1.key, k1.key.replace('-', ''), linkToken, 'senha-da-ubs-2026', ok.data.session, '777777']) assert.ok(!dump.includes(secret), `segredo no log ou na auditoria: ${secret.slice(0, 6)}…`);
    assert.ok(!/\/api\/telas\/heartbeat/.test(s.out()), 'o sinal de vida não enche o log');

    /* ---------------------------------------------------------------- revogar, excluir, modo desligado */
    assert.equal((await A.api('DELETE', `/api/prefeitura/devices/${act2.data.deviceId}`)).status, 409, 'excluir só depois de revogar');
    assert.equal((await A.api('DELETE', `/api/prefeitura/offices/${escola.id}`)).status, 409, 'repartição com tela ativa');
    assert.equal((await A.api('POST', `/api/prefeitura/devices/${act2.data.deviceId}/revoke`)).status, 200);
    const rev = await T2('GET', '/api/telas/config');
    assert.equal(rev.status, 401, 'token revogado: o app volta à tela da chave'); assert.equal((await hb(T2)).status, 401);
    assert.equal(db.prepare('SELECT token_hash FROM telas_devices WHERE id = ?').get(act2.data.deviceId).token_hash, null);
    assert.equal((await A.api('DELETE', `/api/prefeitura/offices/${escola.id}`)).status, 200, 'só com telas revogadas: sai com elas');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM telas_devices WHERE id = ?').get(act2.data.deviceId).n, 0);
    assert.equal((await A.api('DELETE', `/api/prefeitura/regions/${centro.id}`)).status, 200);
    assert.equal((await T1('GET', '/api/telas/config')).data.device.region, null, 'região excluída: a repartição fica sem região');
    // o Superadmin tira o modo do perfil: o painel recusa, a tela recebe 403 (guarda o token), o link e a ativação fecham
    const kOff = await post(A, '/api/prefeitura/keys', { officeId: ubs.id });
    const upd = await P('PATCH', `/api/platform/feature-profiles/${prof.data.id}`, { features: { prefeitura: false }, confirm: true });
    assert.equal(upd.status, 200, JSON.stringify(upd.data));
    assert.equal((await A.api('GET', '/api/prefeitura')).status, 403);
    const gone = await T1('GET', '/api/telas/config');
    assert.equal(gone.status, 403, 'modo desligado não é token revogado'); assert.equal((await hb(T1)).status, 403);
    assert.equal((await anon('POST', '/api/telas/activate', { key: kOff.key })).status, 404);
    assert.equal((await anon('POST', '/api/reparticao/login', { token: link2.url.split('/').pop(), password: 'outra-senha-da-ubs' })).status, 401);
    assert.equal((await P('PATCH', `/api/platform/feature-profiles/${prof.data.id}`, { features: { prefeitura: true }, confirm: true })).status, 200);
    assert.equal((await T1('GET', '/api/telas/config')).status, 200, 'ligado de novo: a mesma tela volta sem nova chave');

    /* ---------------------------------------------------------------- freio do ativar (14 por IP em 10 min neste teste) */
    let limited = 0;
    for (let i = 0; i < 16; i++) if ((await anon('POST', '/api/telas/activate', { key: 'ZZZZ-3333' })).status === 429) limited++;
    assert.ok(limited >= 6, `o freio por IP segura as tentativas (${limited} recusadas)`);
    assert.equal((await anon('POST', '/api/telas/activate', { key: kOff.key })).status, 429, 'chave boa também espera');

    /* ---------------------------------------------------------------- excluir o cliente apaga tudo, inclusive as capturas */
    db.close();
    const del = await P('DELETE', `/api/platform/tenants/${A.id}`, { confirm: 'pref-a' });
    if (del.status === 200) {
      const db2 = rawDb(s.dataDir);
      for (const tb of ['telas_regions', 'telas_offices', 'telas_devices', 'telas_groups', 'telas_group_devices', 'telas_keys', 'telas_commands', 'telas_alerts', 'telas_alert_deliveries']) {
        assert.equal(db2.prepare(`SELECT COUNT(*) AS n FROM ${tb} WHERE tenant_id = ?`).get(A.id).n, 0, `${tb} do cliente excluído`);
        if (tb === 'telas_offices') assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM telas_offices WHERE tenant_id = ?').get(B.id).n, 1, 'o outro cliente fica');
      }
      db2.close();
      assert.ok(!fs.existsSync(file), 'a captura sai com o cliente');
    } else assert.fail(`excluir o cliente: ${del.status} ${JSON.stringify(del.data)}`);
  } finally { await s.stop(); cleanup(s.dataDir); }
});
