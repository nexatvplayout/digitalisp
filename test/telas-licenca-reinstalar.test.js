// NEXA Telas: a licença sobrevive à reinstalação do app (docs/TELAS.md §32, server/telas.js POST /api/telas/recover). A
// ativação guarda o resumo do hwid (SHA-256 do ANDROID_ID + pacote, calculado no app); o app reinstalado manda o hwid e a
// MESMA tela ganha um token novo (o antigo para de valer), com "Instalação recuperada" no painel e na auditoria. Outro hwid
// não pega; tela revogada ou excluída não volta; ativar de novo no mesmo aparelho passa o vínculo para a tela nova; app
// antigo (sem hwid) segue ativando; freio por IP; o hwid cru não fica no banco nem na auditoria. SQLite (com a migração
// aditiva sobre a tabela de antes) e Postgres.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { boot, cleanup, api, platformLogin, newTenant } from './helpers/srv.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const ENV = { TELAS_ACTIVATE_PER_IP: '50', TELAS_RECOVER_PER_IP: '20', PUBLIC_HLS_URL: 'https://hls.exemplo.test' };
const HW1 = sha('android-id-1|br.com.nexatv.telas');
const HW2 = sha('android-id-2|br.com.nexatv.telas');
const HW3 = sha('android-id-3|br.com.nexatv.telas');
const HW4 = sha('android-id-4|br.com.nexatv.telas');

/** O roteiro nos dois bancos. dump() devolve o que o banco guarda em telas_devices e audit_log (texto), para procurar o hwid cru. */
async function roteiro(s, dump) {
  const anon = api(s.base);
  const bearer = (token) => (method, url, body) => anon(method, url, body, { authorization: `Bearer ${token}` });
  const P = api(s.base, await platformLogin(s.base));
  const prof = await P('POST', '/api/platform/feature-profiles', { name: 'pref', code: 'pref', features: { prefeitura: true } });
  assert.equal(prof.status, 201, JSON.stringify(prof.data));
  assert.equal((await P('POST', '/api/platform/plans', { code: 'p-pref', name: 'pref', priceCents: 0, profileId: prof.data.id, limits: { channels: 1 } })).status, 201);
  const A = await newTenant(P, s.base, { slug: 'lic-a', planCode: 'p-pref', status: 'active' });
  const B = await newTenant(P, s.base, { slug: 'lic-b', planCode: 'p-pref', status: 'active' });
  for (const [T, slug] of [[A, 'lic-a-tv'], [B, 'lic-b-tv']]) assert.equal((await T.api('POST', '/api/channels', { name: 'TV', slug })).status, 201);
  const post = async (T, url, body, want = 201) => { const r = await T.api('POST', url, body); assert.equal(r.status, want, `${url}: ${JSON.stringify(r.data)}`); return r.data; };
  const escola = await post(A, '/api/prefeitura/offices', { name: 'Escola Central', type: 'escola' });
  const ubsB = await post(B, '/api/prefeitura/offices', { name: 'UBS do B', type: 'ubs' });
  const activate = async (T, o, name, device) => {
    const k = await post(T, '/api/prefeitura/keys', { officeId: o.id, name });
    const r = await anon('POST', '/api/telas/activate', { key: k.key, device });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  };
  const recover = (hwid, device = { model: 'TV Box', android: '11', appVersion: '1.2.14' }) => anon('POST', '/api/telas/recover', { hwid, device });
  const devOf = async (T, id) => (await T.api('GET', '/api/prefeitura')).data.devices.find((d) => d.id === id);

  /* ---------------------------------------------------------------- ativar guarda o vínculo; reinstalar recupera */
  const d1 = await activate(A, escola, 'Recepção', { model: 'TV Box', android: '11', appVersion: '1.2.13', hwid: HW1.toUpperCase() });
  const b1 = await activate(B, ubsB, 'Sala de espera B', { model: 'TV Box B', hwid: HW2 });
  assert.equal((await bearer(d1.token)('GET', '/api/telas/config')).status, 200);
  assert.equal((await devOf(A, d1.deviceId)).recoveredAt, null, 'nunca recuperada');

  for (const bad of [undefined, '', 'abc', HW1.slice(1), `${HW1.slice(0, 63)}z`, 12345]) assert.equal((await anon('POST', '/api/telas/recover', { hwid: bad })).status, 400, `hwid ${bad}`);
  assert.equal((await recover(HW3)).status, 404, 'aparelho que nunca foi ativado: tela da chave');

  const r1 = await recover(HW1, { model: 'TV Box', android: '11', appVersion: '1.2.14' });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.deepEqual(Object.keys(r1.data).sort(), ['channel', 'deviceId', 'name', 'token'], 'o mesmo formato da ativação');
  assert.equal(r1.data.deviceId, d1.deviceId, 'a MESMA tela');
  assert.equal(r1.data.name, 'Recepção');
  assert.equal(r1.data.channel, d1.channel);
  assert.notEqual(r1.data.token, d1.token, 'token novo');
  assert.equal((await bearer(d1.token)('GET', '/api/telas/config')).status, 401, 'o token antigo para de valer');
  assert.equal((await bearer(d1.token)('POST', '/api/telas/heartbeat', { rev: 'x' })).status, 401);
  assert.equal((await bearer(r1.data.token)('GET', '/api/telas/config')).status, 200, 'o novo vale');
  assert.equal((await bearer(b1.token)('GET', '/api/telas/config')).status, 200, 'a tela do outro cliente não muda');
  const seen = await devOf(A, d1.deviceId);
  assert.ok(seen.recoveredAt > 0, 'o painel mostra "Instalação recuperada em"');
  assert.equal(seen.appVersion, '1.2.14', 'a versão do app reinstalado');
  assert.equal(seen.revokedAt, null);
  assert.equal(await devOf(B, d1.deviceId), undefined, 'o outro cliente não vê');

  // de novo (reinstalou outra vez): outro token, e o da 1ª recuperação também cai
  const r2 = await recover(HW1);
  assert.equal(r2.status, 200);
  assert.equal(r2.data.deviceId, d1.deviceId);
  assert.equal((await bearer(r1.data.token)('GET', '/api/telas/config')).status, 401);
  // o hwid do outro cliente devolve a tela DELE (o vínculo é por aparelho, o cliente vem da tela)
  const rb = await recover(HW2);
  assert.equal(rb.status, 200);
  assert.equal(rb.data.deviceId, b1.deviceId);
  assert.notEqual(rb.data.deviceId, d1.deviceId);

  /* ---------------------------------------------------------------- o mesmo aparelho ativado de novo com outra chave */
  const d2 = await activate(A, escola, 'Recepção nova', { model: 'TV Box', hwid: HW1 });
  const r3 = await recover(HW1);
  assert.equal(r3.status, 200);
  assert.equal(r3.data.deviceId, d2.deviceId, 'o vínculo passa para a tela nova');
  assert.equal((await bearer(r2.data.token)('GET', '/api/telas/config')).status, 200, 'a tela de antes não é mexida (só perde o vínculo)');

  /* ---------------------------------------------------------------- revogada ou excluída não volta */
  assert.equal((await A.api('POST', `/api/prefeitura/devices/${d2.deviceId}/revoke`, {})).status, 200);
  assert.equal((await recover(HW1)).status, 404, 'revogada: não volta sozinha (e a de antes já não tem o vínculo)');
  assert.equal((await A.api('DELETE', `/api/prefeitura/devices/${d2.deviceId}`)).status, 200);
  assert.equal((await recover(HW1)).status, 404, 'excluída');
  const d3 = await activate(A, escola, 'Corredor', { model: 'TV Box', hwid: HW3 });
  assert.equal((await A.api('POST', `/api/prefeitura/devices/${d3.deviceId}/revoke`, {})).status, 200);
  assert.equal((await A.api('DELETE', `/api/prefeitura/devices/${d3.deviceId}`)).status, 200);
  assert.equal((await recover(HW3)).status, 404, 'revogada e excluída');
  // a chave nova no mesmo aparelho depois da revogação: volta a ter vínculo
  const d4 = await activate(A, escola, 'Corredor de novo', { hwid: HW3 });
  assert.equal((await recover(HW3)).data.deviceId, d4.deviceId);

  /* ---------------------------------------------------------------- app antigo, sem hwid, segue ativando */
  const old = await activate(A, escola, 'App antigo', { model: 'TV Box', appVersion: '1.2.13' });
  assert.equal((await bearer(old.token)('GET', '/api/telas/config')).status, 200);
  // o app atualizado manda o hwid no sinal de vida: a tela ativada antes do vínculo ganha o vínculo (uma vez)
  const hb = (tok, hwid) => bearer(tok)('POST', '/api/telas/heartbeat', { rev: 'x', state: 'playing', source: 'hls', appVersion: '1.2.14', uptimeSec: 5, net: 'wifi', lastError: null, locked: true, hwid });
  assert.equal((await hb(old.token, 'lixo')).status, 200, 'hwid malformado no sinal de vida: ignorado');
  assert.equal((await hb(old.token, HW4)).status, 200);
  assert.equal((await hb(rb.data.token, HW4)).status, 200, 'a tela que já tem vínculo não troca');
  const r4 = await recover(HW4);
  assert.equal(r4.status, 200);
  assert.equal(r4.data.deviceId, old.deviceId);
  assert.equal((await bearer(rb.data.token)('GET', '/api/telas/config')).status, 200, 'e segue com o próprio vínculo e token');
  assert.equal((await activate(A, escola, 'hwid lixo', { hwid: 'nao-e-hash' })).deviceId > 0, true, 'hwid malformado na ativação: ignorado');

  /* ---------------------------------------------------------------- auditoria e o que o banco guarda */
  const audit = JSON.stringify((await A.api('GET', '/api/audit?limit=500')).data);
  assert.match(audit, /reativada sozinha após reinstalação do app em \\"Escola Central\\"/);
  const raw = await dump();
  for (const h of [HW1, HW2, HW3, HW4]) {
    assert.ok(!raw.includes(h) && !raw.includes(h.toUpperCase()), 'o hwid cru não fica no banco nem na auditoria');
    assert.ok(!audit.includes(h));
  }
  assert.ok(raw.includes(sha(`telas-hwid:${HW3}`)), 'só o resumo do hwid');
  assert.ok(!audit.includes(r3.data.token) && !s.out().includes(r3.data.token), 'o token não vai a log');

  /* ---------------------------------------------------------------- freio por IP */
  let limited = 0;
  for (let i = 0; i < 25; i++) if ((await recover(HW2)).status === 429) limited++;
  assert.ok(limited > 0, 'freio por IP e por minuto');
}

test('SQLite: a licença sobrevive à reinstalação; migração aditiva das colunas sobre a tabela de antes', { timeout: 300000 }, async () => {
  let s = await boot(ENV);
  const dataDir = s.dataDir;
  const file = path.join(dataDir, 'playout.db');
  try {
    await roteiro(s, async () => {
      const db = new DatabaseSync(file, { timeout: 15000, readOnly: true });
      try { return JSON.stringify([db.prepare('SELECT * FROM telas_devices').all(), db.prepare('SELECT * FROM audit_log').all()]); } finally { db.close(); }
    });
    await s.stop();
    // a tabela volta ao que era antes desta versão (sem hwid_hash e recovered_at, sem o índice)
    const db = new DatabaseSync(file, { timeout: 15000 });
    db.exec('DROP INDEX IF EXISTS idx_telas_devices_hwid');
    for (const c of ['hwid_hash', 'recovered_at']) db.exec(`ALTER TABLE telas_devices DROP COLUMN ${c}`);
    db.close();
    s = await boot({ ...ENV, DATA_DIR: dataDir });
    const after = new DatabaseSync(file, { timeout: 15000, readOnly: true });
    const cols = after.prepare('PRAGMA table_info(telas_devices)').all();
    for (const c of ['hwid_hash', 'recovered_at']) assert.ok(cols.some((x) => x.name === c && x.notnull === 0), `${c} de volta, aceitando NULL`);
    assert.ok(after.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_telas_devices_hwid'").get(), 'o índice volta');
    after.close();
    assert.equal((await api(s.base)('POST', '/api/telas/recover', { hwid: HW1 })).status, 404, 'as telas de antes ficam sem vínculo até ativar de novo');
  } finally { await s.stop(); cleanup(dataDir); }
});

test('Postgres: o mesmo roteiro (as colunas e o índice nascem no banco)', { timeout: 300000 }, async (t) => {
  const { startPg } = await import('./helpers/pg.js');
  const { createPg } = await import('../server/db/pg.js');
  let pgs;
  try { pgs = await startPg(); } catch (err) { t.skip(`Postgres embutido indisponível: ${err.message}`); return; }
  let s = null; let db = null; let dataDir = null;
  try {
    s = await boot({ ...ENV, DATABASE_URL: pgs.url });
    dataDir = s.dataDir;
    db = await createPg(pgs.url, { max: 2 });
    await roteiro(s, async () => JSON.stringify([await db.all('SELECT * FROM telas_devices'), await db.all('SELECT * FROM audit_log')]));
    const cols = await db.all("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'telas_devices' AND column_name IN ('hwid_hash', 'recovered_at') ORDER BY column_name");
    assert.deepEqual(cols.map((c) => [c.column_name, c.data_type]), [['hwid_hash', 'text'], ['recovered_at', 'bigint']]);
    assert.ok((await db.get("SELECT to_regclass('idx_telas_devices_hwid') AS r")).r, 'o índice');
    // banco de antes (sem as colunas): sobem de novo por ADD COLUMN IF NOT EXISTS, duas vezes sem erro
    await s.stop(); s = null;
    await db.exec('DROP INDEX IF EXISTS idx_telas_devices_hwid');
    await db.exec('ALTER TABLE telas_devices DROP COLUMN hwid_hash');
    await db.exec('ALTER TABLE telas_devices DROP COLUMN recovered_at');
    for (let i = 0; i < 2; i++) { const d = await createPg(pgs.url, { max: 2 }); await d.close(); }
    assert.equal((await db.all("SELECT column_name FROM information_schema.columns WHERE table_name = 'telas_devices' AND column_name IN ('hwid_hash', 'recovered_at')")).length, 2);
  } finally {
    if (db) await db.close().catch(() => {});
    if (s) await s.stop();
    if (dataDir) cleanup(dataDir);
    await pgs.stop().catch(() => {});
  }
});
