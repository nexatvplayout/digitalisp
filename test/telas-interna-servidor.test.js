// NEXA Telas: comunicação interna de UPA e hospital (docs/TELAS.md §25, contrato §16 e §17), no servidor de verdade e nos
// dois bancos (server/telas-interna.js). A tela interna recebe os avisos internos (pelo setor) e os códigos de emergência no
// /config, no sinal de vida e no tempo real; a tela PÚBLICA não recebe nada interno (nem a chave). O celular do funcionário
// lê e marca "Li" pelo endereço do setor; o painel vê quem leu e quem falta. O endereço de leitura não dispara; o de
// disparo dispara e encerra. Isolamento por repartição e por cliente, módulo desligado, auditoria sem token, freio, e o som
// da chamada de senha (callSound) na precedência do painel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, cleanup, api, platformLogin, newTenant, sleep } from './helpers/srv.js';
import { canal, usuario, auditoria } from './helpers/prefeitura.js'; // DIGITAL ISP: canal ao vivo (HLS) e usuário de permissão limitada

const ENV = { TELAS_LINK_LOGIN_PER_IP: '500', TELAS_ACTIVATE_PER_IP: '50', PUBLIC_HLS_URL: 'https://hls.exemplo.test', PLATFORM_PUBLIC_URL: 'https://painel.exemplo.test', STORAGE_DRIVER: 'local' };
const SECRET = 'SEGREDO-INTERNO-DA-DIRECAO';

async function openStream(base, url, token) {
  const ctl = new AbortController();
  const res = await fetch(`${base}${url}`, { headers: { authorization: `Bearer ${token}` }, signal: ctl.signal });
  const events = [];
  if (res.status !== 200) return { status: res.status, events, close: () => ctl.abort() };
  (async () => {
    const dec = new TextDecoder(); let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          if (block.startsWith(':')) continue;
          const ev = /^event: (.+)$/m.exec(block)?.[1]; const data = /^data: (.+)$/m.exec(block)?.[1];
          events.push({ event: ev, data: data ? JSON.parse(data) : null });
        }
      }
    } catch { /* fechada */ }
  })();
  const wait = async (pred, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const e = events.find(pred); if (e) return e; await sleep(20); } return null; };
  return { status: 200, events, wait, close: () => ctl.abort() };
}

async function roteiro(s) {
  const anon = api(s.base);
  const bearer = (token) => (method, url, body, headers = {}) => anon(method, url, body, { authorization: `Bearer ${token}`, ...headers });
  const P = api(s.base, await platformLogin(s.base));
  const r0 = await P('POST', '/api/platform/feature-profiles', { name: 'pref', code: 'pref', features: { prefeitura: true } });
  assert.equal(r0.status, 201, JSON.stringify(r0.data));
  assert.equal((await P('POST', '/api/platform/plans', { code: 'p-pref', name: 'pref', priceCents: 0, profileId: r0.data.id, limits: { channels: 1 } })).status, 201);
  const A = await newTenant(P, s.base, { slug: 'int-a', planCode: 'p-pref', status: 'active' });
  const B = await newTenant(P, s.base, { slug: 'int-b', planCode: 'p-pref', status: 'active' });
  for (const [T, slug] of [[A, 'int-a-tv'], [B, 'int-b-tv']]) await canal(T.api, 'TV');
  const post = async (T, url, body, want = 201) => { const r = await T.api('POST', url, body); assert.equal(r.status, want, `${url}: ${JSON.stringify(r.data)}`); return r.data; };
  const upa = await post(A, '/api/prefeitura/offices', { name: 'UPA Centro', type: 'upa' });
  const ubs = await post(A, '/api/prefeitura/offices', { name: 'UBS Norte', type: 'ubs' });
  const hospB = await post(B, '/api/prefeitura/offices', { name: 'Hospital do B', type: 'hospital' });
  assert.deepEqual([upa.modules.interna, ubs.modules.interna, hospB.modules.interna], [true, false, true], 'nasce ligada na UPA e no hospital');
  const links = new Map();
  const enter = async (T, o, username, role = 'gestor') => {
    await post(T, `/api/prefeitura/offices/${o.id}/users`, { username, role, password: `senha-de-${username}-2026` });
    if (!links.has(o.id)) links.set(o.id, (await post(T, `/api/prefeitura/offices/${o.id}/link`, {})).url.split('/').pop());
    const r = await anon('POST', '/api/reparticao/login', { token: links.get(o.id), username, password: `senha-de-${username}-2026` });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return bearer(r.data.session);
  };
  const G = await enter(A, upa, 'direcao.upa'); const At = await enter(A, upa, 'recepcao.upa', 'atendente'); const Ub = await enter(A, ubs, 'gestor.ubs'); const Gb = await enter(B, hospB, 'direcao.b');
  const activate = async (T, o, name) => { const k = await post(T, '/api/prefeitura/keys', { officeId: o.id, name }); const r = await anon('POST', '/api/telas/activate', { key: k.key, device: { model: 'TV Box de teste' } }); assert.equal(r.status, 200); return Object.assign(bearer(r.data.token), { id: r.data.deviceId, token: r.data.token }); };
  const T1 = await activate(A, upa, 'Posto de enfermagem'); const T2 = await activate(A, upa, 'Recepção (público)'); const T3 = await activate(A, ubs, 'UBS recepção');
  const hb = async (T) => { const r = await T('POST', '/api/telas/heartbeat', { rev: 'x', state: 'playing', source: 'hls', appVersion: '1.2.7', uptimeSec: 60, net: 'wifi', lastError: null, locked: true }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  const cfg = async (T) => (await T('GET', '/api/telas/config')).data;

  /* ---------------------------------------------------------------- o som da chamada (contrato §16) */
  const c0 = await cfg(T2);
  assert.deepEqual(c0.callSound, { mode: null, volume: 100 }, 'de fábrica o painel não define: vale o escolhido no aparelho (sem escolha, bipe + falada)');
  assert.equal('internal' in c0, false);
  assert.equal((await A.api('PATCH', `/api/prefeitura/devices/${T2.id}`, { config: { callSound: { mode: 'grito', volume: 50 } } })).status, 400);
  assert.equal((await A.api('PATCH', `/api/prefeitura/offices/${upa.id}`, { config: { callSound: { mode: 'beep', volume: 60 } } })).status, 200);
  assert.deepEqual((await cfg(T2)).callSound, { mode: 'beep', volume: 60 }, 'a repartição define');
  const devs = (await G('GET', '/api/reparticao/devices')).data.devices;
  const d2 = devs.find((d) => d.id === T2.id);
  assert.equal((await G('PATCH', `/api/reparticao/devices/${d2.id}`, { config: { callSound: { mode: 'voice', volume: 80 } } })).status, 200, 'o gestor define por tela');
  assert.deepEqual((await cfg(T2)).callSound, { mode: 'voice', volume: 80 }, 'a tela vence a repartição');
  assert.equal((await G('PATCH', `/api/reparticao/devices/${d2.id}`, { config: { callSound: { mode: null, volume: 40 } } })).status, 200);
  assert.deepEqual((await cfg(T2)).callSound, { mode: 'beep', volume: 40 }, 'campo a campo: o modo da repartição, o volume da tela');

  /* ---------------------------------------------------------------- telas internas, setores e avisos */
  assert.equal((await At('GET', '/api/reparticao/interna')).status, 403, 'o atendente não administra a comunicação interna');
  assert.equal((await Ub('GET', '/api/reparticao/interna')).status, 403, 'módulo desligado na UBS');
  assert.equal((await Ub('GET', '/api/reparticao/codes')).status, 403);
  const posto = (await G('POST', '/api/reparticao/interna/sectors', { name: 'Posto de enfermagem', staff: 'Ana Souza\nBruno Lima\n123456\nana souza' })).data;
  assert.deepEqual(posto.staff, ['Ana Souza', 'Bruno Lima', '123456'], 'sem repetir (sem diferenciar maiúsculas)');
  const copa = (await G('POST', '/api/reparticao/interna/sectors', { name: 'Copa' })).data;
  assert.equal((await G('PATCH', `/api/reparticao/interna/devices/${T1.id}`, { internal: true, sectorId: posto.id })).status, 200);
  assert.equal((await G('PATCH', `/api/reparticao/interna/devices/${T3.id}`, { internal: true })).status, 404, 'tela de outra repartição');
  assert.equal((await Gb('PATCH', `/api/reparticao/interna/devices/${T1.id}`, { internal: false })).status, 404, 'outro cliente');
  const sB = (await Gb('POST', '/api/reparticao/interna/sectors', { name: 'Setor do B' })).data;
  assert.equal((await G('PATCH', `/api/reparticao/interna/devices/${T1.id}`, { internal: true, sectorId: sB.id })).status, 404, 'setor de outro cliente');
  assert.equal((await G('POST', '/api/reparticao/interna/notices', { title: 'Reunião', sectors: [sB.id] })).status, 400, 'setor de outro cliente no aviso');
  const n1 = (await G('POST', '/api/reparticao/interna/notices', { kind: 'aviso', title: 'Reunião da equipe', text: `${SECRET}\nSexta, 14h, auditório.`, days: 3 })).data;
  const n2 = (await G('POST', '/api/reparticao/interna/notices', { kind: 'escala', title: 'Escala da copa', text: 'SO-COPA', sectors: [copa.id] })).data;
  assert.equal((await G('POST', '/api/reparticao/interna/notices', { kind: 'fofoca', title: 'x' })).status, 400);
  const ci = await cfg(T1);
  assert.equal(ci.internal.sector, 'Posto de enfermagem');
  assert.deepEqual(ci.internal.notices.map((n) => [n.id, n.kind, n.header, n.title]), [[n1.id, 'aviso', 'AVISO DA DIREÇÃO', 'Reunião da equipe']], 'só os avisos do setor da tela (o da copa não)');
  assert.match(ci.internal.notices[0].text, new RegExp(SECRET));
  // a tela PÚBLICA e a de outra repartição: nada interno, em rota nenhuma
  for (const T of [T2, T3]) {
    const c = await cfg(T); const h = await hb(T);
    assert.equal('internal' in c, false, 'sem a chave internal');
    assert.equal('codes' in h, false, 'sem a chave codes');
    for (const x of [c, h, (await T('GET', '/api/telas/queue')).data]) assert.ok(!JSON.stringify(x).includes(SECRET) && !JSON.stringify(x).includes('SO-COPA'), 'conteúdo interno não vaza');
  }
  assert.deepEqual((await hb(T1)).codes, [], 'a tela interna recebe a lista (vazia)');

  /* ---------------------------------------------------------------- o celular: leitura com "Li" */
  const readUrl = (await G('POST', `/api/reparticao/interna/sectors/${posto.id}/link/read`, {})).data.url;
  assert.match(readUrl, /^https:\/\/painel\.exemplo\.test\/interno\/[A-Za-z0-9_-]{43}$/);
  const readTok = readUrl.split('/').pop();
  const page = await fetch(`${s.base}/interno/${readTok}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'; script-src 'self'; style-src 'self'/);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  const html = await page.text();
  assert.ok(!/<script>|style="|onclick=/i.test(html), 'sem script nem estilo inline');
  assert.equal((await fetch(`${s.base}/interno/interno.js`)).status, 200);
  const R = bearer(readTok);
  assert.equal((await anon('POST', '/api/interno/state', {})).status, 401);
  const st0 = (await R('POST', '/api/interno/state', { reader: 'Ana Souza' })).data;
  assert.deepEqual([st0.office, st0.sector, st0.canFire, st0.known, st0.catalog], ['UPA Centro', 'Posto de enfermagem', false, true, []]);
  assert.deepEqual(st0.notices.map((n) => [n.id, n.readAt]), [[n1.id, null]]);
  assert.equal((await R('POST', `/api/interno/notices/${n1.id}/read`, {})).status, 400, 'o nome é obrigatório');
  assert.equal((await R('POST', `/api/interno/notices/${n2.id}/read`, { reader: 'Ana Souza' })).status, 404, 'aviso de outro setor');
  const li = await R('POST', `/api/interno/notices/${n1.id}/read`, { reader: 'ana  SOUZA' });
  assert.equal(li.status, 200); assert.ok(li.data.readAt > 0);
  assert.equal((await R('POST', `/api/interno/notices/${n1.id}/read`, { reader: 'Ana Souza' })).data.readAt, li.data.readAt, 'ler de novo não muda a hora');
  assert.ok((await R('POST', '/api/interno/state', { reader: 'Ana Souza' })).data.notices[0].readAt > 0);
  assert.equal((await R('POST', '/api/interno/state', { reader: 'Visitante' })).data.known, false, 'fora da lista do setor');
  const ov = (await G('GET', '/api/reparticao/interna')).data;
  const on1 = ov.notices.find((n) => n.id === n1.id);
  assert.deepEqual([on1.reads.length, on1.reads[0].reader, on1.reads[0].sector, on1.expected, on1.missing], [1, 'ana  SOUZA'.replace(/\s+/g, ' '), 'Posto de enfermagem', 3, ['Bruno Lima', '123456']]);
  assert.equal((await R('POST', '/api/interno/codes', { code: 'azul', place: 'Leito 1' })).status, 403, 'o endereço de leitura não dispara');

  /* ---------------------------------------------------------------- códigos de emergência */
  const st1 = await openStream(s.base, '/api/telas/internal/stream', T1.token);
  const st2 = await openStream(s.base, '/api/telas/internal/stream', T2.token);
  assert.equal(st1.status, 200); assert.equal(st2.status, 200);
  assert.deepEqual((await st1.wait((e) => e.event === 'codes')).data.codes, []);
  const fireUrl = (await G('POST', `/api/reparticao/interna/sectors/${posto.id}/link/fire`, {})).data.url;
  const F = bearer(fireUrl.split('/').pop());
  const phone = await openStream(s.base, '/api/interno/stream', fireUrl.split('/').pop());
  assert.equal(phone.status, 200);
  const stF = (await F('POST', '/api/interno/state', {})).data;
  assert.equal(stF.canFire, true); assert.deepEqual(stF.catalog.map((c) => c.key), ['azul', 'vermelho', 'rosa', 'laranja', 'cinza', 'amarelo']);
  assert.equal((await F('POST', '/api/interno/codes', { code: 'roxo' })).status, 400);
  const t0 = Date.now();
  const az = await F('POST', '/api/interno/codes', { code: 'azul', place: 'Observação, leito 4', reader: 'Bruno Lima' });
  assert.equal(az.status, 201, JSON.stringify(az.data));
  assert.deepEqual([az.data.label, az.data.meaning, az.data.place, az.data.color, az.data.textColor], ['Código Azul', 'Parada cardiorrespiratória', 'Observação, leito 4', '#1565c0', '#ffffff']);
  assert.ok(az.data.until - az.data.firedAt === 30 * 60_000, '30 min de fábrica');
  const ev = await st1.wait((e) => e.event === 'codes' && e.data.codes.length === 1, 3000);
  assert.ok(ev, 'a tela interna recebe no tempo real'); assert.ok(Date.now() - t0 < 2000, 'em menos de 2 s');
  assert.ok(await phone.wait((e) => e.event === 'codes' && e.data.codes.some((c) => c.id === az.data.id), 3000), 'o celular do setor também');
  await sleep(300);
  assert.equal(st2.events.filter((e) => e.event === 'codes').length, 0, 'a tela pública não recebe evento nenhum');
  assert.deepEqual((await hb(T1)).codes.map((c) => [c.label, c.place]), [['Código Azul', 'Observação, leito 4']]);
  for (const T of [T2, T3]) { const h = await hb(T); assert.equal('codes' in h, false); assert.ok(!/C[oó]digo Azul|leito 4/i.test(JSON.stringify(h))); }
  // o atendente da recepção vê, dispara e encerra; o painel de outra repartição e de outro cliente não alcança
  const cs = (await At('GET', '/api/reparticao/codes')).data;
  assert.deepEqual([cs.active.length, cs.log[0].firedBy, cs.log[0].via], [1, 'Posto de enfermagem · Bruno Lima (celular)', 'celular']);
  assert.equal((await Gb('POST', `/api/reparticao/codes/${az.data.id}/close`, {})).status, 404);
  assert.equal((await Ub('POST', `/api/reparticao/codes/${az.data.id}/close`, {})).status, 403);
  const vm = await At('POST', '/api/reparticao/codes', { code: 'vermelho', place: 'Copa' });
  assert.equal(vm.status, 201);
  assert.equal((await hb(T1)).codes.length, 2);
  assert.equal((await At('POST', `/api/reparticao/codes/${az.data.id}/close`, {})).status, 200);
  assert.equal((await At('POST', `/api/reparticao/codes/${az.data.id}/close`, {})).status, 409);
  assert.ok(await st1.wait((e) => e.event === 'codes' && e.data.codes.length === 1 && e.data.codes[0].code === 'vermelho', 3000), 'encerrar sai na hora');
  assert.equal((await F('POST', `/api/interno/codes/${vm.data.id}/close`, {})).status, 200, 'o endereço de disparo encerra');
  assert.deepEqual((await hb(T1)).codes, []);
  const lg = (await G('GET', '/api/reparticao/codes')).data.log;
  assert.deepEqual(lg.map((c) => [c.label, c.active, Boolean(c.closedAt), c.closedBy]), [['Código Vermelho', false, true, 'Posto de enfermagem (celular)'], ['Código Azul', false, true, 'repartição: UPA Centro (recepcao.upa)']]);
  // a lista editável e "até encerrar"
  assert.equal((await G('PUT', '/api/reparticao/interna/codes', { codes: [{ label: 'Código Azul', meaning: 'PCR', color: '#1565c0' }, { label: 'Código Branco', meaning: 'Falta de energia', color: '#eeeeee' }], minutes: 0 })).status, 200);
  assert.equal((await G('PUT', '/api/reparticao/interna/codes', { codes: [{ label: 'X', color: 'azul' }] })).status, 400);
  const br = (await G('POST', '/api/reparticao/codes', { code: 'branco' })).data;
  assert.deepEqual([br.label, br.until, br.textColor], ['Código Branco', null, '#1a1a1a']);
  await G('POST', `/api/reparticao/codes/${br.id}/close`, {});
  st1.close(); st2.close(); phone.close();

  /* ---------------------------------------------------------------- a tela volta a ser pública; endereços desligados */
  assert.equal((await A.api('PATCH', `/api/prefeitura/devices/${T1.id}/internal`, { internal: false })).status, 200, 'o painel da prefeitura também marca');
  const back = await cfg(T1);
  assert.equal('internal' in back, false); assert.ok(!JSON.stringify(back).includes(SECRET));
  assert.equal('codes' in (await hb(T1)), false);
  assert.equal((await A.api('PATCH', `/api/prefeitura/devices/${T1.id}/internal`, { internal: true, sectorId: copa.id })).status, 200);
  assert.deepEqual((await cfg(T1)).internal.notices.map((n) => n.id).sort(), [n1.id, n2.id].sort(), 'a copa recebe o seu e o de todos');
  assert.equal((await B.api('PATCH', `/api/prefeitura/devices/${T1.id}/internal`, { internal: false })).status, 404, 'outro cliente');
  assert.equal((await G('DELETE', `/api/reparticao/interna/sectors/${posto.id}/link/read`)).status, 200);
  assert.equal((await R('POST', '/api/interno/state', {})).status, 401, 'endereço desligado');
  assert.equal((await G('POST', `/api/reparticao/interna/notices/${n1.id}/cancel`, {})).status, 200);
  assert.deepEqual((await cfg(T1)).internal.notices.map((n) => n.id), [n2.id]);
  // auditoria: as ações, sem token de endereço
  const audit = JSON.stringify(await auditoria(s, A.id));
  for (const want of [/CÓDIGO AZUL disparado em \\"UPA Centro\\" \(Observação, leito 4\)/, /CÓDIGO AZUL encerrado/, /aviso interno \\"Reunião da equipe\\" \(Aviso da direção\) publicado/, /marcada como INTERNA/]) assert.match(audit, want);
  assert.ok(!audit.includes(readTok) && !audit.includes(fireUrl.split('/').pop()), 'o token não vai à auditoria');
}

test('SQLite: telas internas, avisos com Li, códigos de emergência e o som da chamada', { timeout: 300000 }, async () => {
  const s = await boot(ENV);
  try { await roteiro(s); } finally { await s.stop(); cleanup(s.dataDir); }
});

test('Postgres: o mesmo roteiro (as tabelas e as colunas novas nascem no banco)', { timeout: 300000 }, async (t) => {
  const { startPg } = await import('./helpers/pg.js');
  const { createPg } = await import('../server/db/pg.js');
  let pgs;
  try { pgs = await startPg(); } catch (err) { t.skip(`Postgres embutido indisponível: ${err.message}`); return; }
  let s = null; let db = null;
  try {
    s = await boot({ ...ENV, DATABASE_URL: pgs.url });
    await roteiro(s);
    db = await createPg(pgs.url, { max: 2 });
    const cols = await db.all("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('telas_devices', 'telas_int_sectors', 'telas_int_codes')");
    const type = (tb, c) => cols.find((x) => x.table_name === tb && x.column_name === c)?.data_type;
    assert.deepEqual([type('telas_devices', 'internal'), type('telas_devices', 'sector_id'), type('telas_int_sectors', 'read_hash'), type('telas_int_codes', 'fired_at')], ['integer', 'bigint', 'text', 'bigint']);
    for (const r of await db.all('SELECT read_hash, fire_hash FROM telas_int_sectors')) for (const h of [r.read_hash, r.fire_hash]) if (h) assert.match(h, /^[0-9a-f]{64}$/, 'só o SHA-256');
  } finally {
    if (db) await db.close().catch(() => {});
    if (s) { await s.stop(); cleanup(s.dataDir); }
    await pgs.stop().catch(() => {});
  }
});
