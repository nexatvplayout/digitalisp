// Prefeitura · Repartições (vindo do NEXA Broadcast): o assistente e a ficha (server/telas.js, server/telas-acesso.js, docs/TELAS.md). O link e a senha
// do painel da repartição guardados também cifrados (AES-256-GCM) para o "olho" do Painel da Prefeitura: a senha sorteada
// (forte e legível), o login que continua pelo resumo, só quem tem prefeitura.manage revela (e fica na auditoria), a
// repartição antiga sem cifra ("gere uma nova") e a migração aditiva das colunas novas sobre um banco com a tabela antiga.
// O vínculo automático da TV box (a chave da repartição) e o "Alcance dos alertas" das repartições de emergência: a Defesa
// Civil nasce com todas as telas e o alerta dela chega à TV box de outra repartição; o de uma repartição comum não chega;
// com o EAS marcado, o alerta vai também ao ar do canal (sem repetir nas telas) e sai do ar junto.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { boot, cleanup, api, platformLogin, newTenant } from './helpers/srv.js';
import { canal, usuario } from './helpers/prefeitura.js'; // DIGITAL ISP: canal ao vivo (HLS) e usuário de permissão limitada
import { createSealer, newOfficePassword, PASS_ALPHABET } from '../server/telas-acesso.js';
import { reachOf, reachScope, scopeHits, defaultReach } from '../public/shared/telas-tipos.js';

const ENV = { TELAS_LINK_LOGIN_PER_IP: '500', TELAS_ACTIVATE_PER_IP: '50', PUBLIC_HLS_URL: 'https://hls.exemplo.test', EAS_LEAD_MS: '200', EAS_IDAP_URL: 'https://127.0.0.1:9/cap', EAS_INMET_URL: 'https://127.0.0.1:9/rss' };
const PASS_RE = new RegExp(`^[${PASS_ALPHABET}]{4}(-[${PASS_ALPHABET}]{4}){3}$`);

test('cifra do link e da senha: volta igual, outra chave ou texto adulterado = null; senha sorteada legível', () => {
  const a = createSealer({ secret: () => 'segredo-a' }); const b = createSealer({ secret: () => 'segredo-b' });
  const s = a.seal('k7pq-xm4t-9wcd-hr2e');
  assert.match(s, /^v1:/); assert.ok(!s.includes('k7pq'));
  assert.equal(a.unseal(s), 'k7pq-xm4t-9wcd-hr2e');
  assert.notEqual(a.seal('x'), a.seal('x'), 'iv novo a cada vez');
  assert.equal(b.unseal(s), null, 'SESSION_SECRET trocado: ilegível');
  const raw = Buffer.from(s.slice(3), 'base64'); raw[raw.length - 1] ^= 1;
  assert.equal(a.unseal(`v1:${raw.toString('base64')}`), null, 'adulterado');
  for (const v of [null, '', 'abc', 'v1:', 'v1:AAAA']) assert.equal(a.unseal(v), null);
  const seen = new Set();
  for (let i = 0; i < 200; i++) { const p = newOfficePassword(); assert.match(p, PASS_RE); assert.ok(!/[01oil]/i.test(p.replace(/-/g, '')) || !/[0O1lIi]/.test(p)); seen.add(p); }
  assert.equal(seen.size, 200);
  assert.ok(!/[0o1li]/.test(PASS_ALPHABET), 'sem caracteres que se confundem');
});

test('alcance: a Defesa Civil nasce com todas; as outras de emergência com as próprias; tipo comum sempre só as próprias', () => {
  assert.equal(reachOf('defesa-civil', null).mode, 'all');
  assert.equal(reachOf('seguranca', null).mode, 'own');
  assert.equal(reachOf('escola', JSON.stringify({ mode: 'all' })).mode, 'own', 'tipo fora da lista não ganha alcance');
  assert.deepEqual(reachOf('policia-militar', '{"mode":"pick","regions":[3,"3",-1],"groups":[7],"eas":true}'), { mode: 'pick', regions: [3], groups: [7], eas: true });
  assert.deepEqual(reachOf('defesa-civil', 'lixo'), defaultReach('defesa-civil'));
  const all = reachScope({ mode: 'all', regions: [], groups: [] }, 5);
  assert.ok(scopeHits(all, { officeId: 99, regionId: null, groups: [] }));
  const pick = reachScope({ mode: 'pick', regions: [2], groups: [9] }, 5);
  assert.ok(scopeHits(pick, { officeId: 5, regionId: null, groups: [] }), 'a própria repartição');
  assert.ok(scopeHits(pick, { officeId: 8, regionId: 2, groups: [] }), 'a região');
  assert.ok(scopeHits(pick, { officeId: 8, regionId: 1, groups: [9] }), 'o grupo');
  assert.ok(!scopeHits(pick, { officeId: 8, regionId: 1, groups: [4] }));
  assert.ok(!scopeHits(reachScope({ mode: 'own' }, 5), { officeId: 8, regionId: 1, groups: [] }));
});

async function setup(s) {
  const anon = api(s.base);
  const P = api(s.base, await platformLogin(s.base));
  const prof = await P('POST', '/api/platform/feature-profiles', { name: 'Prefeitura', code: 'prefeitura', features: { prefeitura: true } });
  assert.equal(prof.status, 201, JSON.stringify(prof.data));
  assert.equal((await P('POST', '/api/platform/plans', { code: 'p-rep', name: 'Prefeitura', priceCents: 0, profileId: prof.data.id, limits: { channels: 1 } })).status, 201);
  const A = await newTenant(P, s.base, { slug: 'rep-a', planCode: 'p-rep', status: 'active' });
  const B = await newTenant(P, s.base, { slug: 'rep-b', planCode: 'p-rep', status: 'active' });
  await canal(A.api, 'TV A'); // DIGITAL ISP: o canal ao vivo (HLS) no lugar do canal do NEXA
  const post = async (T, url, body, want = 201) => { const r = await T.api('POST', url, body); assert.equal(r.status, want, `${url}: ${JSON.stringify(r.data)}`); return r.data; };
  return { anon, P, A, B, post };
}

async function roteiro(s) {
  const { anon, A, B, post } = await setup(s);
  const bearer = (token) => (m, u, b) => anon(m, u, b, { authorization: `Bearer ${token}` });
  const login = (url, password, username = '') => anon('POST', '/api/reparticao/login', { token: url.split('/').pop(), username, password });
  const centro = await post(A, '/api/prefeitura/regions', { name: 'Centro' });
  const dc = await post(A, '/api/prefeitura/offices', { name: 'Defesa Civil', type: 'defesa-civil', config: { layout: 'ticker' } });
  const guarda = await post(A, '/api/prefeitura/offices', { name: 'Guarda Municipal', type: 'seguranca' });
  const escola = await post(A, '/api/prefeitura/offices', { name: 'Escola Norte', type: 'escola', config: { layout: 'side' } });
  const ubs = await post(A, '/api/prefeitura/offices', { name: 'UBS Centro', type: 'ubs', regionId: centro.id });
  assert.equal(escola.config.layout, 'side', 'o layout escolhido no assistente fica na repartição');
  assert.deepEqual([dc.reach.mode, guarda.reach.mode, escola.hasReach, dc.access.password], ['all', 'own', false, false]);

  /* ---- o link e a senha: sorteada, login pelo resumo, o olho */
  const gen = await post(A, `/api/prefeitura/offices/${dc.id}/link`, { generate: true });
  assert.match(gen.password, PASS_RE); assert.match(gen.url, /\/reparticao\/[A-Za-z0-9_-]{32,64}$/);
  assert.deepEqual(gen.office.access, { link: true, password: true, passwordVisible: true });
  assert.equal((await login(gen.url, gen.password)).status, 200, 'entra com a senha sorteada');
  assert.equal((await login(gen.url, 'errada-de-proposito')).status, 401);
  const seen = await A.api('POST', `/api/prefeitura/offices/${dc.id}/access`, {});
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.data, { state: 'ok', url: gen.url, password: gen.password, users: false });
  const ov = (await A.api('GET', '/api/prefeitura')).data;
  assert.ok(!JSON.stringify(ov).includes(gen.password) && !JSON.stringify(ov).includes(gen.url.split('/').pop()), 'a leitura geral não leva a senha nem o link');
  assert.ok(!/link_enc|pass_enc|v1:/.test(JSON.stringify(ov)));
  // no banco: o resumo da senha (scrypt) e a cifra; nada em claro
  const db = new DatabaseSync(path.join(s.dataDir, 'digitalisp.db'), { timeout: 15000, readOnly: true });
  const row = db.prepare('SELECT link_pass, pass_enc, link_enc, link_hash FROM telas_offices WHERE id = ?').get(dc.id);
  assert.match(row.link_pass, /^scrypt\$/); assert.match(row.pass_enc, /^v1:/); assert.match(row.link_enc, /^v1:/);
  assert.ok(!Object.values(row).some((v) => String(v).includes(gen.password)));
  const audit = db.prepare("SELECT username, detail FROM audit_log WHERE detail LIKE '%revelado%' ORDER BY id DESC").all();
  assert.ok(audit.some((x) => /link e senha do painel da repartição "Defesa Civil" revelado/.test(x.detail)), JSON.stringify(audit));
  db.close();
  // só quem administra a prefeitura revela
  await usuario(s, A.id, { username: 'semtelas.r', password: 'senha-sem-telas-123', permissions: ['tvcorp.manage'] });
  const V = api(s.base, (await anon('POST', '/api/admin/login', { tenant: 'rep-a', username: 'semtelas.r', password: 'senha-sem-telas-123' })).data.token);
  assert.equal((await V('POST', `/api/prefeitura/offices/${dc.id}/access`, {})).status, 403);
  assert.equal((await B.api('POST', `/api/prefeitura/offices/${dc.id}/access`, {})).status, 404, 'outro cliente');
  assert.equal((await anon('POST', `/api/prefeitura/offices/${dc.id}/access`, {})).status, 401);
  const DC = bearer((await login(gen.url, gen.password)).data.session);
  assert.equal((await DC('POST', `/api/prefeitura/offices/${dc.id}/access`, {})).status, 401, 'a sessão da repartição não revela');
  // senha escrita à mão também fica visível; gerar de novo troca e devolve a nova
  const linkG = await post(A, `/api/prefeitura/offices/${guarda.id}/link`, { password: 'senha-da-guarda-26' });
  assert.equal(linkG.password, undefined, 'a escrita à mão não volta na resposta');
  assert.equal((await A.api('POST', `/api/prefeitura/offices/${guarda.id}/access`, {})).data.password, 'senha-da-guarda-26');
  const again = await A.api('PUT', `/api/prefeitura/offices/${guarda.id}/link/password`, { generate: true });
  assert.equal(again.status, 200); assert.match(again.data.password, PASS_RE);
  assert.equal((await login(linkG.url, 'senha-da-guarda-26')).status, 401, 'a de antes não vale');
  assert.equal((await login(linkG.url, again.data.password)).status, 200);
  // com usuários: o link continua visível, a senha única não existe mais
  const linkU = await post(A, `/api/prefeitura/offices/${ubs.id}/link`, { generate: true });
  await post(A, `/api/prefeitura/offices/${ubs.id}/users`, { username: 'gestor.ubs', password: 'senha-do-gestor-26' });
  const accU = (await A.api('POST', `/api/prefeitura/offices/${ubs.id}/access`, {})).data;
  assert.deepEqual([accU.state, accU.password, accU.url], ['users', null, linkU.url]);
  assert.equal((await A.api('PUT', `/api/prefeitura/offices/${ubs.id}/link/password`, { generate: true })).status, 409);
  const U = bearer((await login(linkU.url, 'senha-do-gestor-26', 'gestor.ubs')).data.session);
  // sem link: 'none'; desligar o link apaga a cifra
  assert.equal((await A.api('POST', `/api/prefeitura/offices/${escola.id}/access`, {})).data.state, 'none');
  const linkE = await post(A, `/api/prefeitura/offices/${escola.id}/link`, { generate: true });
  const E = bearer((await login(linkE.url, linkE.password)).data.session);

  /* ---- o vínculo automático: a chave da repartição (pelo painel da prefeitura ou pelo da repartição) */
  const activate = async (key) => { const r = await anon('POST', '/api/telas/activate', { key, device: { model: 'TV Box de teste', android: '11', appVersion: '1.2.0' } }); assert.equal(r.status, 200, JSON.stringify(r.data)); return { ...r.data, T: bearer(r.data.token) }; };
  const boxEscola = await activate((await post(A, '/api/prefeitura/keys', { officeId: escola.id, name: 'Escola, pátio' })).key);
  const boxUbs = await activate((await U('POST', '/api/reparticao/keys', { name: 'UBS, recepção' })).data.key);
  const boxGuarda = await activate((await post(A, '/api/prefeitura/keys', { officeId: guarda.id })).key);
  const devs = (await A.api('GET', '/api/prefeitura')).data.devices;
  assert.deepEqual([boxEscola, boxUbs, boxGuarda].map((b) => devs.find((d) => d.id === b.deviceId).officeId), [escola.id, ubs.id, guarda.id], 'cada TV box nasce vinculada à repartição da chave');
  // e continua podendo ser movida pelo painel da prefeitura
  assert.equal((await A.api('PATCH', `/api/prefeitura/devices/${boxGuarda.deviceId}`, { officeId: guarda.id })).status, 200);

  /* ---- o alcance dos alertas */
  const hb = async (box) => (await box.T('POST', '/api/telas/heartbeat', { rev: 'x', state: 'playing', source: 'hls', appVersion: '1.2.0', uptimeSec: 60, net: 'wifi', lastError: null, locked: true })).data;
  const titles = async (box) => (await hb(box)).alerts.map((a) => a.title);
  const stDc = (await DC('GET', '/api/reparticao/state')).data;
  assert.ok(stDc.alertScopes.includes('reach')); assert.deepEqual([stDc.reach.mode, stDc.reach.text], ['all', 'todas as TV box da prefeitura']);
  assert.equal((await A.api('PUT', `/api/prefeitura/offices/${escola.id}/reach`, { mode: 'all' })).status, 409, 'escola não tem alcance');
  assert.equal((await E('GET', '/api/reparticao/state')).data.reach, undefined);
  // a Defesa Civil com "todas as telas": chega à escola, à UBS e à guarda, no mesmo sinal de vida
  const pv = await DC('POST', '/api/reparticao/alerts/preview', { scope: { kind: 'reach', all: false, offices: [] } });
  assert.equal(pv.data.total, 3, 'o pedido não escolhe o alcance: vale o da ficha');
  const sent = await DC('POST', '/api/reparticao/alerts', { title: 'Chuva forte', text: 'Evite áreas alagadas.', level: 'warn', durationMin: 30, scope: { kind: 'reach' } });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  assert.deepEqual([sent.data.alert.scope.kind, sent.data.alert.scope.all, sent.data.reach.total], ['reach', true, 3]);
  assert.equal(sent.data.eas, undefined, 'sem o EAS marcado, só as telas');
  const now = await Promise.all([boxEscola, boxUbs, boxGuarda].map(titles));
  assert.ok(now.every((t) => t.includes('Chuva forte')), JSON.stringify(now));
  // um alerta de repartição comum (a escola, só as próprias telas) não chega às outras; e ela não usa o alcance
  assert.equal((await E('POST', '/api/reparticao/alerts', { title: 'Do pátio', level: 'info', durationMin: 10, scope: { kind: 'reach' } })).status, 403);
  assert.equal((await E('POST', '/api/reparticao/alerts', { title: 'Saída antecipada', level: 'info', durationMin: 10, scope: { kind: 'office' } })).status, 201);
  assert.ok((await titles(boxEscola)).includes('Saída antecipada'));
  assert.ok(!(await titles(boxUbs)).includes('Saída antecipada') && !(await titles(boxGuarda)).includes('Saída antecipada'));
  // a Guarda (só as próprias, de fábrica): o alcance é a própria repartição; a prefeitura liga a região do Centro
  const G = bearer((await login(linkG.url, again.data.password)).data.session);
  assert.equal((await G('GET', '/api/reparticao/state')).data.reach.mode, 'own');
  assert.equal((await G('POST', '/api/reparticao/alerts', { title: 'Só a guarda', level: 'warn', durationMin: 10, scope: { kind: 'reach' } })).status, 201);
  assert.ok((await titles(boxGuarda)).includes('Só a guarda') && !(await titles(boxUbs)).includes('Só a guarda'));
  assert.equal((await A.api('PUT', `/api/prefeitura/offices/${guarda.id}/reach`, { mode: 'pick' })).status, 400, 'pick sem nada');
  assert.equal((await A.api('PUT', `/api/prefeitura/offices/${guarda.id}/reach`, { mode: 'pick', regions: [999999] })).status, 400, 'região de ninguém');
  const rG = await A.api('PUT', `/api/prefeitura/offices/${guarda.id}/reach`, { mode: 'pick', regions: [centro.id] });
  assert.equal(rG.status, 200, JSON.stringify(rG.data)); assert.equal(rG.data.preview.total, 2);
  assert.equal((await B.api('PUT', `/api/prefeitura/offices/${guarda.id}/reach`, { mode: 'all' })).status, 404);
  assert.equal((await G('POST', '/api/reparticao/alerts', { title: 'Centro e guarda', level: 'warn', durationMin: 10, scope: { kind: 'reach' } })).status, 201);
  assert.ok((await titles(boxUbs)).includes('Centro e guarda') && (await titles(boxGuarda)).includes('Centro e guarda') && !(await titles(boxEscola)).includes('Centro e guarda'));

  /* ---- "também no ar dos canais" (EAS do NEXA): o DIGITAL ISP não tem canal no ar; a marca fica guardada e o alerta vai só às telas */
  assert.equal((await A.api('PUT', `/api/prefeitura/offices/${dc.id}/reach`, { mode: 'all', eas: true })).status, 200);
  const sev = await DC('POST', '/api/reparticao/alerts', { title: 'Alagamento no centro', text: 'Procure abrigo.', level: 'warn', durationMin: 20, scope: { kind: 'reach' } });
  assert.equal(sev.status, 201, JSON.stringify(sev.data)); assert.equal(sev.data.eas, undefined, 'sem canal no ar: nada além das telas');
  const hbE = await hb(boxEscola);
  assert.equal(hbE.alerts.filter((a) => /Alagamento/.test(a.title)).length, 1, 'nas telas uma vez');
  assert.equal((await DC('POST', `/api/reparticao/alerts/${sev.data.alert.id}/cancel`, {})).status, 200);
}

test('SQLite: senha sorteada e o olho, vínculo automático da TV box e o alcance dos alertas', { timeout: 300000 }, async () => {
  const s = await boot(ENV);
  try { await roteiro(s); } finally { await s.stop(); cleanup(s.dataDir); }
});

// DIGITAL ISP: o banco já nasce com link_enc, pass_enc e alert_reach e não migra bancos de versões antigas do NEXA
test('migração: telas_offices sem as colunas novas (banco no ar); sobem por ADD COLUMN, a senha de antes entra e o olho pede gerar de novo', { timeout: 300000, skip: 'sem bancos antigos do NEXA para migrar' }, async () => {
  let s = await boot(ENV);
  const dataDir = s.dataDir;
  try {
    const { A, post } = await setup(s);
    const dc = await post(A, '/api/prefeitura/offices', { name: 'Defesa Civil Antiga', type: 'defesa-civil' });
    const link = await post(A, `/api/prefeitura/offices/${dc.id}/link`, { password: 'senha-antiga-da-dc' });
    await s.stop();
    // a tabela volta ao que era antes desta versão (sem link_enc, pass_enc e alert_reach)
    const db = new DatabaseSync(path.join(dataDir, 'digitalisp.db'), { timeout: 15000 });
    for (const c of ['link_enc', 'pass_enc', 'alert_reach']) db.exec(`ALTER TABLE telas_offices DROP COLUMN ${c}`);
    const cols = () => db.prepare('PRAGMA table_info(telas_offices)').all().map((c) => c.name);
    assert.ok(!cols().includes('pass_enc'));
    db.close();
    s = await boot({ ...ENV, DATA_DIR: dataDir });
    const after = new DatabaseSync(path.join(dataDir, 'digitalisp.db'), { timeout: 15000, readOnly: true });
    const now = after.prepare('PRAGMA table_info(telas_offices)').all();
    for (const c of ['link_enc', 'pass_enc', 'alert_reach']) assert.ok(now.some((x) => x.name === c && x.notnull === 0), `${c} de volta, aceitando NULL`);
    assert.deepEqual({ ...after.prepare('SELECT name, pass_enc, alert_reach FROM telas_offices WHERE id = ?').get(dc.id) }, { name: 'Defesa Civil Antiga', pass_enc: null, alert_reach: null });
    after.close();
    const adm = api(s.base, (await api(s.base)('POST', '/api/admin/login', { tenant: A.slug, username: A.username, password: A.password })).data.token);
    const o = (await adm('GET', '/api/prefeitura')).data.offices.find((x) => x.id === dc.id);
    assert.deepEqual([o.reach.mode, o.access.password, o.access.passwordVisible, o.access.link], ['all', true, false, false], 'a Defesa Civil antiga ganha "todas as telas"; a senha existe mas não dá para ver');
    assert.equal((await api(s.base)('POST', '/api/reparticao/login', { token: link.url.split('/').pop(), username: '', password: 'senha-antiga-da-dc' })).status, 200, 'a senha de antes entra (o resumo)');
    assert.deepEqual((await adm('POST', `/api/prefeitura/offices/${dc.id}/access`, {})).data, { state: 'legacy', url: null, password: null, users: false });
    const fresh = await adm('POST', `/api/prefeitura/offices/${dc.id}/link`, { generate: true });
    assert.equal(fresh.status, 201);
    assert.deepEqual((await adm('POST', `/api/prefeitura/offices/${dc.id}/access`, {})).data, { state: 'ok', url: fresh.data.url, password: fresh.data.password, users: false });
  } finally { await s.stop(); cleanup(dataDir); }
});
