// NEXA Telas: a imagem de reserva sem conexão (contrato telas-contrato.md §7.3 "offline.image", server/telas-imagem-offline.js).
// null sem imagem; a do nível mais específico (repartição > grupo > padrão); só https, SHA-256 de 64 hex e até 2 MB; o que a
// pessoa sobe vira JPEG 1920×1080; trocar ou remover apaga o arquivo; o rev muda; um cliente não alcança o outro; a
// repartição só mexe na dela (e só o gestor). Nos dois bancos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { boot, cleanup, api, platformLogin, newTenant } from './helpers/srv.js';
import { imageContract, pickImage, OFFLINE_IMAGE } from '../server/telas-imagem-offline.js';

const ENV = { TELAS_LINK_LOGIN_PER_IP: '500', TELAS_ACTIVATE_PER_IP: '50', PUBLIC_HLS_URL: 'https://hls.exemplo.test', PLATFORM_PUBLIC_URL: 'https://painel.exemplo.test', STORAGE_DRIVER: 'local' };
const SHA = 'a'.repeat(64);

/** PNG de verdade (um desenho em degradê), w×h, com a cor de base c. */
function png(w, h, c = 0) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; raw[i] = (x + c) % 256; raw[i + 1] = (y * 2 + c) % 256; raw[i + 2] = (x + y + c * 3) % 256; }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('tEXt', Buffer.from('Comment\0Dado escondido de teste', 'latin1')), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function jpegSize(b) { for (let i = 2; i + 9 < b.length;) { if (b[i] !== 0xff) return null; const m = b[i + 1]; const len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; i += 2 + len; } return null; }

test('contrato: só https, SHA-256 de 64 hex, de 1 byte a 2 MB e nome do armazenamento; senão null', () => {
  const ok = { file: 'telasimg-123e4567-e89b-12d3-a456-426614174000.jpg', sha256: SHA, bytes: 1000 };
  assert.deepEqual(imageContract(ok, 'https://cdn.exemplo.test/x.jpg'), { url: 'https://cdn.exemplo.test/x.jpg', sha256: SHA, bytes: 1000 });
  assert.equal(imageContract(null, 'https://x'), null);
  assert.equal(imageContract(ok, 'http://cdn.exemplo.test/x.jpg'), null, 'http não vai');
  assert.equal(imageContract(ok, null), null, 'sem endereço público');
  assert.equal(imageContract({ ...ok, sha256: 'abc' }, 'https://x'), null);
  assert.equal(imageContract({ ...ok, bytes: 0 }, 'https://x'), null);
  assert.equal(imageContract({ ...ok, bytes: OFFLINE_IMAGE.maxBytes + 1 }, 'https://x'), null, 'acima de 2 MB');
  assert.equal(imageContract({ ...ok, file: '../segredo.jpg' }, 'https://x'), null);
});

test('precedência: repartição > grupos da tela (na ordem) > padrão da prefeitura', () => {
  const rows = [{ scope: 'default', scope_id: 0, n: 'p' }, { scope: 'group', scope_id: 7, n: 'g7' }, { scope: 'group', scope_id: 9, n: 'g9' }, { scope: 'office', scope_id: 3, n: 'o3' }];
  assert.equal(pickImage(rows, { officeId: 3, groupIds: [7] }).n, 'o3');
  assert.equal(pickImage(rows, { officeId: 4, groupIds: [9, 7] }).n, 'g9');
  assert.equal(pickImage(rows, { officeId: 4, groupIds: [8] }).n, 'p');
  assert.equal(pickImage(rows.slice(1), { officeId: 4, groupIds: [] }), null);
  assert.equal(pickImage([], { officeId: 3 }), null);
});

async function roteiro(s) {
  const anon = api(s.base);
  const bearer = (token) => (method, url, body, headers = {}) => anon(method, url, body, { authorization: `Bearer ${token}`, ...headers });
  const P = api(s.base, await platformLogin(s.base));
  const prof = await P('POST', '/api/platform/feature-profiles', { name: 'Prefeitura', code: 'prefeitura', features: { prefeitura: true } });
  assert.equal((await P('POST', '/api/platform/plans', { code: 'p-pref', name: 'Prefeitura', priceCents: 0, profileId: prof.data.id, limits: { channels: 1 } })).status, 201);
  const A = await newTenant(P, s.base, { slug: 'img-a', planCode: 'p-pref', status: 'active' });
  const B = await newTenant(P, s.base, { slug: 'img-b', planCode: 'p-pref', status: 'active' });
  assert.equal((await A.api('POST', '/api/channels', { name: 'TV A', slug: 'img-a-tv' })).status, 201);
  assert.equal((await B.api('POST', '/api/channels', { name: 'TV B', slug: 'img-b-tv' })).status, 201);
  const post = async (T, url, body, want = 201) => { const r = await T.api('POST', url, body); assert.equal(r.status, want, `${url}: ${JSON.stringify(r.data)}`); return r.data; };
  const ubs = await post(A, '/api/prefeitura/offices', { name: 'UBS Centro', type: 'ubs' });
  const escola = await post(A, '/api/prefeitura/offices', { name: 'Escola Norte', type: 'escola' });
  const ubsB = await post(B, '/api/prefeitura/offices', { name: 'UBS do B', type: 'ubs' });
  const activate = async (T, o, name) => { const k = await post(T, '/api/prefeitura/keys', { officeId: o.id, name }); const r = await anon('POST', '/api/telas/activate', { key: k.key, device: { model: 'TV Box de teste' } }); assert.equal(r.status, 200); return Object.assign(bearer(r.data.token), { id: r.data.deviceId }); };
  const T1 = await activate(A, ubs, 'UBS, recepção'); const T2 = await activate(A, escola, 'Escola, pátio'); const T3 = await activate(B, ubsB, 'UBS do B');
  const grupo = await post(A, '/api/prefeitura/groups', { name: 'Escolas da zona norte', deviceIds: [T2.id] });
  const cfg = async (T) => { const r = await T('GET', '/api/telas/config'); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  const fileOf = (url) => path.join(s.dataDir, 'graphics', decodeURIComponent(new URL(url).pathname.split('/').pop()));

  /* ---------------------------------------------------------------- sem imagem: null (e a chave existe) */
  const c0 = await cfg(T1);
  assert.ok('image' in c0.offline); assert.equal(c0.offline.image, null); assert.deepEqual(c0.offline.items, []);
  assert.equal((await cfg(T3)).offline.image, null);

  /* ---------------------------------------------------------------- o envio: tipo real, tamanho, quem */
  const up = (T, url, body, type = 'image/png', method = 'PUT') => fetch(`${s.base}${url}`, { method, headers: { 'x-admin-token': T.token, 'content-type': type }, body });
  assert.equal((await up(A, '/api/prefeitura/offline-image/default/0', Buffer.from('<html>não sou imagem</html>'.repeat(5)), 'image/jpeg')).status, 400, 'não é imagem');
  assert.equal((await up(A, '/api/prefeitura/offline-image/default/0', Buffer.from('GIF89a' + 'x'.repeat(200)))).status, 400, 'GIF com o tipo trocado');
  assert.equal((await up(A, '/api/prefeitura/offline-image/default/0', png(64, 36), 'text/plain')).status, 415, 'tipo de envio que não é imagem');
  assert.equal((await up(A, '/api/prefeitura/offline-image/default/0', Buffer.alloc(16 * 1024 * 1024, 1))).status, 413, 'acima de 15 MB');
  assert.equal((await up(A, '/api/prefeitura/offline-image/planeta/1', png(64, 36))).status, 400, 'nível inválido');
  assert.equal((await fetch(`${s.base}/api/prefeitura/offline-image/default/0`, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: png(64, 36) })).status, 401, 'sem login');

  // o padrão da prefeitura: 1600×1200 vira 1920×1080 cobrindo (corta as sobras), sem o dado escondido
  const r1 = await up(A, '/api/prefeitura/offline-image/default/0', png(1600, 1200, 10));
  assert.equal(r1.status, 200, await r1.clone().text()); const o1 = await r1.json();
  assert.ok(o1.bytes > 0 && o1.bytes <= 2 * 1024 * 1024);
  const c1 = await cfg(T1);
  assert.notEqual(c1.rev, c0.rev, 'o rev muda com a imagem');
  const img1 = c1.offline.image;
  assert.match(img1.url, /^https:\/\//); assert.match(img1.sha256, /^[0-9a-f]{64}$/); assert.ok(img1.bytes >= 1 && img1.bytes <= 2 * 1024 * 1024);
  const f1 = fileOf(img1.url); const b1 = fs.readFileSync(f1);
  assert.deepEqual([b1[0], b1[1], b1[2]], [0xff, 0xd8, 0xff], 'JPEG'); assert.deepEqual(jpegSize(b1), { w: 1920, h: 1080 });
  assert.equal(createHash('sha256').update(b1).digest('hex'), img1.sha256, 'o SHA-256 confere'); assert.equal(b1.length, img1.bytes);
  assert.ok(!b1.includes(Buffer.from('Dado escondido')), 'sem metadados');
  assert.deepEqual((await cfg(T2)).offline.image, img1, 'a escola (sem imagem no grupo) recebe a do padrão');
  assert.equal((await cfg(T3)).offline.image, null, 'o outro cliente não recebe');
  const rev1 = (await cfg(T1)).rev; assert.equal(rev1, c1.rev, 'o rev é estável');

  /* ---------------------------------------------------------------- grupo e repartição (mais específicos) */
  assert.equal((await up(A, `/api/prefeitura/offline-image/group/${grupo.id}`, png(1280, 720, 80))).status, 200);
  const g = (await cfg(T2)).offline.image;
  assert.notEqual(g.sha256, img1.sha256, 'a escola, no grupo, recebe a do grupo'); assert.deepEqual((await cfg(T1)).offline.image, img1, 'a UBS segue com a do padrão');
  assert.equal((await up(A, `/api/prefeitura/offline-image/office/${escola.id}`, png(800, 600, 160))).status, 200);
  const e = (await cfg(T2)).offline.image;
  assert.ok(e.sha256 !== g.sha256 && e.sha256 !== img1.sha256, 'a repartição vence o grupo');

  // a lista no painel (rota própria e junto dos vídeos guardados)
  const list = (await A.api('GET', '/api/prefeitura/offline-image')).data.images;
  assert.deepEqual(list.map((x) => `${x.scope}:${x.scopeId}`).sort(), ['default:0', `group:${grupo.id}`, `office:${escola.id}`].sort());
  assert.equal((await A.api('GET', '/api/prefeitura/offline')).data.images.length, 3);
  const thumb = await fetch(`${s.base}/api/prefeitura/offline-image/default/0`, { headers: { 'x-admin-token': A.token } });
  assert.equal(thumb.status, 200); assert.equal(thumb.headers.get('content-type'), 'image/jpeg'); assert.equal(Buffer.from(await thumb.arrayBuffer()).length, img1.bytes);

  /* ---------------------------------------------------------------- isolamento entre clientes */
  assert.equal((await up(B, `/api/prefeitura/offline-image/office/${escola.id}`, png(64, 36))).status, 404, 'repartição de outro cliente');
  assert.equal((await up(B, `/api/prefeitura/offline-image/group/${grupo.id}`, png(64, 36))).status, 404, 'grupo de outro cliente');
  assert.equal((await B.api('DELETE', `/api/prefeitura/offline-image/office/${escola.id}`)).status, 404);
  assert.equal((await B.api('DELETE', '/api/prefeitura/offline-image/default/0')).status, 404, 'o padrão do B está vazio (o do A não é dele)');
  assert.equal((await fetch(`${s.base}/api/prefeitura/offline-image/office/${escola.id}`, { headers: { 'x-admin-token': B.token } })).status, 404);
  assert.deepEqual((await B.api('GET', '/api/prefeitura/offline-image')).data.images, []);
  assert.ok(fs.existsSync(f1), 'nada do A saiu');

  /* ---------------------------------------------------------------- trocar apaga a anterior; o rev muda */
  assert.equal((await up(A, '/api/prefeitura/offline-image/default/0', png(1920, 1080, 200))).status, 200);
  const c2 = await cfg(T1);
  assert.notEqual(c2.offline.image.sha256, img1.sha256); assert.notEqual(c2.rev, rev1);
  assert.ok(!fs.existsSync(f1), 'a imagem anterior saiu do armazenamento');

  /* ---------------------------------------------------------------- a repartição, pelo link de controle (só a dela, só o gestor) */
  let link = null;
  const enter = async (o, username, role) => {
    await post(A, `/api/prefeitura/offices/${o.id}/users`, { username, role, password: `senha-de-${username}-2026` });
    link ||= (await post(A, `/api/prefeitura/offices/${o.id}/link`, {})).url.split('/').pop(); // um link só (gerar outro derruba as sessões)
    const r = await anon('POST', '/api/reparticao/login', { token: link, username, password: `senha-de-${username}-2026` });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return Object.assign(bearer(r.data.session), { session: r.data.session });
  };
  const U = await enter(ubs, 'gestor.ubs', 'gestor');
  const rep = (X, method, body, type = 'image/png') => fetch(`${s.base}/api/reparticao/offline-image`, { method, headers: { authorization: `Bearer ${X.session}`, 'content-type': type }, body });
  assert.deepEqual((await U('GET', '/api/reparticao/offline-image')).data.image, null);
  assert.equal((await rep(U, 'PUT', png(1024, 768, 33))).status, 200);
  const o = (await cfg(T1)).offline.image;
  assert.notEqual(o.sha256, c2.offline.image.sha256, 'a UBS recebe a dela');
  assert.equal((await U('GET', '/api/reparticao/offline-image')).data.image.scope, 'office');
  assert.equal((await fetch(`${s.base}/api/reparticao/offline-image/file`, { headers: { authorization: `Bearer ${U.session}` } })).status, 200);
  assert.equal((await A.api('GET', '/api/prefeitura/offline-image')).data.images.filter((x) => x.scope === 'office' && x.scopeId === ubs.id).length, 1, 'o painel vê a da repartição');
  const fo = fileOf(o.url); assert.ok(fs.existsSync(fo));
  const At = await enter(ubs, 'atendente.ubs', 'atendente');
  assert.equal((await rep(At, 'PUT', png(64, 36))).status, 403, 'o atendente não troca');
  assert.equal((await At('DELETE', '/api/reparticao/offline-image')).status, 403);
  assert.equal((await anon('GET', '/api/reparticao/offline-image')).status, 401);

  /* ---------------------------------------------------------------- remover apaga o arquivo e volta ao nível de cima */
  assert.equal((await U('DELETE', '/api/reparticao/offline-image')).status, 200);
  assert.ok(!fs.existsSync(fo), 'remover apaga o arquivo');
  assert.deepEqual((await cfg(T1)).offline.image, c2.offline.image, 'sem a da repartição, volta a do padrão');
  assert.equal((await U('DELETE', '/api/reparticao/offline-image')).status, 404);
  const fd = fileOf(c2.offline.image.url);
  assert.equal((await A.api('DELETE', '/api/prefeitura/offline-image/default/0')).status, 200);
  assert.ok(!fs.existsSync(fd));
  const cEnd = await cfg(T1);
  assert.equal(cEnd.offline.image, null); assert.notEqual(cEnd.rev, c2.rev);

  // excluir o grupo leva a linha da imagem; a limpeza tira o arquivo que ninguém cita
  const fg = fileOf(g.url);
  assert.equal((await A.api('DELETE', `/api/prefeitura/groups/${grupo.id}`)).status, 200);
  assert.equal((await A.api('GET', '/api/prefeitura/offline-image')).data.images.filter((x) => x.scope === 'group').length, 0);
  assert.ok(fs.existsSync(fg), 'o arquivo espera a limpeza');
}

test('SQLite: a imagem sem internet (níveis, precedência, isolamento, troca e remoção)', { timeout: 300000 }, async () => {
  const s = await boot(ENV);
  try { await roteiro(s); } finally { await s.stop(); cleanup(s.dataDir); }
});

test('Postgres: o mesmo roteiro (a tabela nasce no banco)', { timeout: 300000 }, async (t) => {
  const { startPg } = await import('./helpers/pg.js');
  const { createPg } = await import('../server/db/pg.js');
  let pgs;
  try { pgs = await startPg(); } catch (err) { t.skip(`Postgres embutido indisponível: ${err.message}`); return; }
  let s = null; let db = null;
  try {
    s = await boot({ ...ENV, DATABASE_URL: pgs.url });
    await roteiro(s);
    db = await createPg(pgs.url, { max: 2 });
    const cols = await db.all("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'telas_offline_image'");
    const type = (c) => cols.find((x) => x.column_name === c)?.data_type;
    assert.deepEqual([type('tenant_id'), type('scope_id'), type('bytes'), type('file'), type('sha256')], ['bigint', 'bigint', 'bigint', 'text', 'text']);
  } finally {
    if (db) await db.close().catch(() => {});
    if (s) { await s.stop(); cleanup(s.dataDir); }
    await pgs.stop().catch(() => {});
  }
});
