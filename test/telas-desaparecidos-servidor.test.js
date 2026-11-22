// NEXA Telas: pessoas desaparecidas (contrato do aparelho §8 e §11) e o endereço do guichê, no servidor de verdade e nos dois
// bancos (server/telas-desaparecidos.js, server/telas-senha.js). O caso só entra com a autorização marcada; os campos da
// autorização nunca saem em rota do aparelho; o alcance é o dos alertas (tela fora do alcance não recebe); no máximo 5 no ar;
// a foto é conferida pelo conteúdo, recodificada em JPEG sem metadados e apagada ao encerrar; o vencido encerra sozinho; o
// atendente, a repartição sem alcance amplo e o outro cliente não alcançam; o QR code só com https, tel:+ ou sms:+ (o da
// repartição, o padrão da prefeitura e o do caso). O guichê: token próprio que só chama e dá andamento à senha.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { boot, cleanup, api, platformLogin, newTenant } from './helpers/srv.js';

const ENV = { TELAS_LINK_LOGIN_PER_IP: '500', TELAS_ACTIVATE_PER_IP: '50', PUBLIC_HLS_URL: 'https://hls.exemplo.test', PLATFORM_PUBLIC_URL: 'https://painel.exemplo.test', STORAGE_DRIVER: 'local' };
/** PNG de verdade (um desenho, não a foto de alguém) com um bloco de texto escondido, como o EXIF de um celular. */
function png(w = 1600, h = 1200, hidden = 'GPS -22.906847,-43.172897 Celular de teste') {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; const inHead = (x - w / 2) ** 2 + (y - h * 0.4) ** 2 < (h * 0.2) ** 2; raw[i] = inHead ? 230 : (x * 7 + y * 3) % 251; raw[i + 1] = inHead ? 190 : (x * 5) % 241; raw[i + 2] = inHead ? 150 : (y * 11) % 239; }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('tEXt', Buffer.from(`Comment\0${hidden}`, 'latin1')), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** As dimensões de um JPEG (o primeiro SOF). */
function jpegSize(b) { for (let i = 2; i + 9 < b.length;) { if (b[i] !== 0xff) return null; const m = b[i + 1]; const len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; i += 2 + len; } return null; }

async function roteiro(s) {
  const anon = api(s.base);
  const bearer = (token) => (method, url, body, headers = {}) => anon(method, url, body, { authorization: `Bearer ${token}`, ...headers });
  const P = api(s.base, await platformLogin(s.base));
  const prof = await P('POST', '/api/platform/feature-profiles', { name: 'Prefeitura', code: 'prefeitura', features: { prefeitura: true } });
  assert.equal((await P('POST', '/api/platform/plans', { code: 'p-pref', name: 'Prefeitura', priceCents: 0, profileId: prof.data.id, limits: { channels: 1 } })).status, 201);
  const A = await newTenant(P, s.base, { slug: 'des-a', planCode: 'p-pref', status: 'active' });
  const B = await newTenant(P, s.base, { slug: 'des-b', planCode: 'p-pref', status: 'active' });
  assert.equal((await A.api('POST', '/api/channels', { name: 'TV A', slug: 'des-a-tv' })).status, 201);
  assert.equal((await B.api('POST', '/api/channels', { name: 'TV B', slug: 'des-b-tv' })).status, 201);
  const post = async (T, url, body, want = 201) => { const r = await T.api('POST', url, body); assert.equal(r.status, want, `${url}: ${JSON.stringify(r.data)}`); return r.data; };
  const centro = await post(A, '/api/prefeitura/regions', { name: 'Centro' }); const norte = await post(A, '/api/prefeitura/regions', { name: 'Norte' });
  const dc = await post(A, '/api/prefeitura/offices', { name: 'Defesa Civil', type: 'defesa-civil' });
  const secom = await post(A, '/api/prefeitura/offices', { name: 'SECOM', type: 'secom' });
  const ubs = await post(A, '/api/prefeitura/offices', { name: 'UBS Centro', type: 'ubs', lat: -22.9, lng: -43.2, regionId: centro.id });
  const escola = await post(A, '/api/prefeitura/offices', { name: 'Escola Norte', type: 'escola', lat: -22.8, lng: -43.3, regionId: norte.id });
  const ubsB = await post(B, '/api/prefeitura/offices', { name: 'UBS do B', type: 'ubs' }); const dcB = await post(B, '/api/prefeitura/offices', { name: 'Defesa Civil do B', type: 'defesa-civil' });
  const enter = async (T, o, username, role = 'gestor') => {
    await post(T, `/api/prefeitura/offices/${o.id}/users`, { username, role, password: `senha-de-${username}-2026` });
    const link = (await post(T, `/api/prefeitura/offices/${o.id}/link`, {})).url.split('/').pop();
    const r = await anon('POST', '/api/reparticao/login', { token: link, username, password: `senha-de-${username}-2026` });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return Object.assign(bearer(r.data.session), { session: r.data.session, link });
  };
  const D = await enter(A, dc, 'plantao'); const S = await enter(A, secom, 'comunicacao'); const U = await enter(A, ubs, 'gestor.ubs'); const Db = await enter(B, dcB, 'plantao');
  await post(A, `/api/prefeitura/offices/${dc.id}/users`, { username: 'apoio', role: 'atendente', password: 'senha-do-apoio-2026' });
  const Da = bearer((await anon('POST', '/api/reparticao/login', { token: D.link, username: 'apoio', password: 'senha-do-apoio-2026' })).data.session);
  const activate = async (T, o, name) => { const k = await post(T, '/api/prefeitura/keys', { officeId: o.id, name }); const r = await anon('POST', '/api/telas/activate', { key: k.key, device: { model: 'TV Box de teste' } }); assert.equal(r.status, 200); return bearer(r.data.token); };
  const T1 = await activate(A, ubs, 'UBS, recepção'); const T2 = await activate(A, escola, 'Escola, pátio'); const T3 = await activate(B, ubsB, 'UBS do B');
  const hb = async (T) => { const r = await T('POST', '/api/telas/heartbeat', { rev: 'x', state: 'playing', source: 'hls', appVersion: '1.2.0', uptimeSec: 60, net: 'wifi', lastError: null, locked: true }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  assert.deepEqual((await hb(T1)).missing, []);

  /* ---------------------------------------------------------------- quem alcança: só o gestor da Defesa Civil e da SECOM, e o painel */
  for (const [X, why] of [[U, 'repartição sem alcance amplo'], [Da, 'atendente']]) {
    for (const [m, url, body] of [['GET', '/api/reparticao/missing'], ['POST', '/api/reparticao/missing', { name: 'x' }], ['PUT', '/api/reparticao/missing/qr', { qr: null }], ['POST', '/api/reparticao/missing/1/close', {}], ['GET', '/api/reparticao/missing/1/photo']]) assert.equal((await X(m, url, body)).status, 403, `${why}: ${m} ${url}`);
    assert.equal((await fetch(`${s.base}/api/reparticao/missing/photo`, { method: 'POST', headers: { authorization: `Bearer ${X === U ? U.session : 'x'}`, 'content-type': 'image/png' }, body: png(64, 64) })).status, X === U ? 403 : 401, `${why}: foto`);
  }
  assert.equal((await anon('GET', '/api/reparticao/missing')).status, 401); assert.equal((await anon('GET', '/api/prefeitura/missing')).status, 401);
  assert.equal((await S('GET', '/api/reparticao/missing')).status, 200, 'a SECOM também cadastra');

  /* ---------------------------------------------------------------- a foto: pelo conteúdo, JPEG sem metadados, até 1280 px e 600 KB */
  const upload = (session, body, type = 'image/png', base = '/api/reparticao') => fetch(`${s.base}${base}/missing/photo`, { method: 'POST', headers: { ...(base === '/api/reparticao' ? { authorization: `Bearer ${session}` } : { 'x-admin-token': session }), 'content-type': type }, body });
  assert.equal((await upload(D.session, Buffer.from('<html>não sou foto</html>'), 'image/jpeg')).status, 400, 'arquivo que não é imagem');
  assert.equal((await upload(D.session, Buffer.from('GIF89a' + 'x'.repeat(200)), 'image/png')).status, 400, 'GIF com o tipo trocado');
  assert.equal((await upload(D.session, Buffer.alloc(6 * 1024 * 1024, 1), 'image/png')).status, 413, 'acima de 5 MB');
  assert.equal((await upload(D.session, png(), 'text/plain')).status, 415, 'tipo de envio que não é imagem');
  const up = await upload(D.session, png());
  assert.equal(up.status, 201); const ph = await up.json();
  assert.match(ph.photo, /^desap-[0-9a-f-]{36}\.jpg$/); assert.ok(ph.bytes > 0 && ph.bytes <= 600 * 1024, `${ph.bytes} bytes`);
  const stored = fs.readFileSync(path.join(s.dataDir, 'graphics', ph.photo));
  assert.deepEqual([stored[0], stored[1], stored[2]], [0xff, 0xd8, 0xff], 'JPEG'); assert.deepEqual(jpegSize(stored), { w: 1280, h: 960 }, 'lado maior até 1280 px, sem distorcer');
  assert.ok(!stored.includes(Buffer.from('GPS -22.906847')) && !stored.includes(Buffer.from('Celular de teste')) && !stored.includes(Buffer.from('Exif')), 'os dados escondidos na foto saem');

  /* ---------------------------------------------------------------- criar: a autorização é obrigatória */
  const caso = { kind: 'crianca', name: 'Ana Teste', age: 8, since: '2026-01-10', lastSeen: 'Praça de teste, 16h', description: 'Blusa amarela', reportNo: 'BO 123/2026', authName: 'Mãe de teste', authRelation: 'familiar', authOk: true, scope: { kind: 'regions', regions: [centro.id] }, photo: ph.photo };
  for (const [patch, why] of [[{ authOk: false }, 'sem a confirmação'], [{ authOk: undefined }, 'confirmação ausente'], [{ reportNo: '' }, 'sem o registro'], [{ authName: '' }, 'sem quem autorizou'], [{ authRelation: 'amigo' }, 'vínculo'], [{ scope: { kind: 'regions', regions: [999999] } }, 'região de outro cliente']]) {
    assert.equal((await D('POST', '/api/reparticao/missing', { ...caso, ...patch })).status, 400, why);
  }
  assert.deepEqual((await hb(T1)).missing, [], 'pedido recusado não deixa nada no ar');
  assert.equal((await Db('POST', '/api/reparticao/missing', { ...caso, scope: { kind: 'city' } })).status, 400, 'a foto enviada é do cliente que enviou');
  const c1 = await D('POST', '/api/reparticao/missing', caso);
  assert.equal(c1.status, 201, JSON.stringify(c1.data));
  assert.deepEqual([c1.data.name, c1.data.hasPhoto, c1.data.status, c1.data.reach, c1.data.reportNo, c1.data.officeId, c1.data.createdBy], ['Ana Teste', true, 'active', { total: 1, online: 1, offices: 1 }, 'BO 123/2026', dc.id, 'repartição: Defesa Civil (plantao)']);
  assert.ok(!JSON.stringify(c1.data).includes('desap-'), 'o nome do arquivo não volta');
  assert.equal((await D('POST', '/api/reparticao/missing', { ...caso, name: 'Outra' })).status, 400, 'a mesma foto não serve a dois casos');

  /* ---------------------------------------------------------------- o sinal de vida: só o que aparece na tela, só no alcance */
  const m1 = (await hb(T1)).missing;
  assert.equal(m1.length, 1);
  assert.deepEqual(Object.keys(m1[0]).sort(), ['age', 'bannerSec', 'contact', 'description', 'everyMin', 'fullSec', 'id', 'kind', 'lastSeen', 'name', 'photo', 'show', 'since', 'until']);
  assert.deepEqual([m1[0].kind, m1[0].name, m1[0].age, m1[0].since, m1[0].contact, m1[0].show, m1[0].fullSec, m1[0].bannerSec, m1[0].everyMin], ['crianca', 'Ana Teste', 8, '2026-01-10', 'Ligue 199 ou 190', 'both', 15, 20, 10]);
  assert.equal(m1[0].photo.url, `https://painel.exemplo.test/graphics/${ph.photo}`); assert.match(m1[0].photo.sha256, /^[0-9a-f]{64}$/); assert.equal(m1[0].photo.bytes, ph.bytes);
  assert.ok(m1[0].until - Date.now() > 6.9 * 86400e3 && m1[0].until - Date.now() <= 7 * 86400e3 + 5000, 'validade padrão: 7 dias');
  assert.deepEqual((await hb(T2)).missing, [], 'a escola está fora do alcance'); assert.deepEqual((await hb(T3)).missing, [], 'o outro cliente não recebe');
  // nada da autorização em rota nenhuma do aparelho (nem na configuração, nem na fila)
  for (const r of [await hb(T1), (await T1('GET', '/api/telas/config')).data, (await T1('GET', '/api/telas/queue')).data]) assert.ok(!/BO 123|Mãe de teste|familiar|reportNo|authName/.test(JSON.stringify(r)), 'a autorização nunca vai ao aparelho');
  // a foto pública é o JPEG guardado; a do operador sai só com a sessão
  const pub = await fetch(`${s.base}/graphics/${ph.photo}`);
  assert.equal(pub.status, 200); assert.equal(pub.headers.get('cache-control'), 'no-store'); assert.ok(Buffer.from(await pub.arrayBuffer()).equals(stored));
  const mine = await fetch(`${s.base}/api/reparticao/missing/${c1.data.id}/photo`, { headers: { authorization: `Bearer ${D.session}` } });
  assert.equal(mine.status, 200); assert.equal(mine.headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(`${s.base}/api/reparticao/missing/${c1.data.id}/photo`, { headers: { authorization: `Bearer ${Db.session}` } })).status, 404, 'outro cliente não abre a foto');
  // isolamento: o outro cliente não vê, não edita, não encerra
  assert.deepEqual((await Db('GET', '/api/reparticao/missing')).data.active, []); assert.deepEqual((await B.api('GET', '/api/prefeitura/missing')).data.active, []);
  assert.equal((await Db('PATCH', `/api/reparticao/missing/${c1.data.id}`, { name: 'Invadido' })).status, 404); assert.equal((await B.api('POST', `/api/prefeitura/missing/${c1.data.id}/close`, {})).status, 404);
  // a SECOM e o painel veem os casos do cliente
  assert.deepEqual((await S('GET', '/api/reparticao/missing')).data.active.map((m) => m.name), ['Ana Teste']);
  assert.deepEqual((await A.api('GET', '/api/prefeitura/missing')).data.active.map((m) => [m.name, m.authName]), [['Ana Teste', 'Mãe de teste']]);

  /* ---------------------------------------------------------------- editar, renovar e trocar a foto */
  const ed = await D('PATCH', `/api/reparticao/missing/${c1.data.id}`, { description: 'Blusa amarela e mochila rosa', scope: { kind: 'city' }, days: 30, everyMin: 5, show: 'banner' });
  assert.equal(ed.status, 200, JSON.stringify(ed.data)); assert.deepEqual([ed.data.description, ed.data.reach.total, ed.data.everyMin, ed.data.show, ed.data.reportNo], ['Blusa amarela e mochila rosa', 2, 5, 'banner', 'BO 123/2026']);
  assert.equal((await hb(T2)).missing.length, 1, 'agora a cidade toda');
  assert.equal((await D('PATCH', `/api/reparticao/missing/${c1.data.id}`, { days: 31 })).status, 400, 'validade máxima: 30 dias');
  assert.equal((await D('PATCH', `/api/reparticao/missing/${c1.data.id}`, { authOk: false })).status, 400, 'a confirmação não se desmarca');
  const ph2 = await (await upload(D.session, png(400, 800))).json();
  assert.equal((await D('PATCH', `/api/reparticao/missing/${c1.data.id}`, { photo: ph2.photo })).status, 200);
  assert.equal(fs.existsSync(path.join(s.dataDir, 'graphics', ph.photo)), false, 'a foto de antes sai do armazenamento');
  assert.equal((await fetch(`${s.base}/graphics/${ph.photo}`)).status, 404);
  assert.equal((await hb(T1)).missing[0].photo.url, `https://painel.exemplo.test/graphics/${ph2.photo}`);

  /* ---------------------------------------------------------------- o QR code de contato (§11): validação, repartição × prefeitura × caso */
  const qrOf = async (T) => (await hb(T)).missing.map((m) => m.qr || null);
  assert.deepEqual(await qrOf(T1), [null], 'sem destino configurado: sem QR code');
  for (const bad of [{ kind: 'url', value: 'http://exemplo.test/form' }, { kind: 'url', value: 'javascript:alert(1)' }, { kind: 'url', value: 'data:text/html,x' }, { kind: 'url', value: 'intent://x#Intent;end' }, { kind: 'url', value: 'texto solto' }, { kind: 'url', value: 'https://usuario:senha@exemplo.test/' },
    { kind: 'url', value: `https://exemplo.test/${'a'.repeat(300)}` }, { kind: 'whatsapp', value: '21 99999-0000 ramal x' }, { kind: 'whatsapp', value: '123' }, { kind: 'tel', value: '1234' }, { kind: 'tel', value: '+55 (21) abc' }, { kind: 'fax', value: '552133330000' }, { kind: 'sms', value: '1'.repeat(16) }]) {
    const r = await D('PUT', '/api/reparticao/missing/qr', { qr: bad });
    assert.equal(r.status, 400, JSON.stringify(bad)); assert.match(r.data.error, /QR code/);
  }
  assert.deepEqual(await qrOf(T1), [null], 'recusado não grava nada');
  // o padrão da prefeitura vale para a repartição que não definiu o dela
  const pq = await A.api('PUT', '/api/prefeitura/missing/qr', { qr: { kind: 'tel', value: '+55 (21) 3333-0000' } });
  assert.equal(pq.status, 200, JSON.stringify(pq.data)); assert.deepEqual(pq.data.qr, { kind: 'tel', value: '552133330000', data: 'tel:+552133330000', label: 'Aponte a câmera e fale agora' });
  assert.deepEqual(await qrOf(T1), [{ data: 'tel:+552133330000', label: 'Aponte a câmera e fale agora' }]);
  const dq = await D('PUT', '/api/reparticao/missing/qr', { qr: { kind: 'whatsapp', value: '55 21 99999-0000', label: 'Fale com a Defesa Civil' } });
  assert.equal(dq.status, 200); assert.equal(dq.data.qr.data, 'https://wa.me/5521999990000');
  assert.deepEqual(await qrOf(T1), [{ data: 'https://wa.me/5521999990000', label: 'Fale com a Defesa Civil' }], 'o da repartição que cadastrou vence o da prefeitura');
  const lst = (await D('GET', '/api/reparticao/missing')).data;
  assert.deepEqual([lst.qr.own.kind, lst.qr.inherited.data, lst.active[0].qrShown.data], ['whatsapp', 'tel:+552133330000', 'https://wa.me/5521999990000']);
  assert.equal((await S('GET', '/api/reparticao/missing')).data.qr.own, null, 'a SECOM não definiu o dela');
  assert.equal((await Db('GET', '/api/reparticao/missing')).data.qr.inherited, null, 'o padrão é de cada cliente');
  // o caso: outro destino só nele, ou sem QR code
  assert.equal((await D('PATCH', `/api/reparticao/missing/${c1.data.id}`, { qr: { mode: 'custom', kind: 'url', value: 'http://inseguro.test' } })).status, 400);
  assert.equal((await D('PATCH', `/api/reparticao/missing/${c1.data.id}`, { qr: { mode: 'custom', kind: 'url', value: 'https://prefeitura.exemplo.test/desaparecidos?caso=1', label: 'Mande uma informação' } })).status, 200);
  assert.deepEqual(await qrOf(T1), [{ data: 'https://prefeitura.exemplo.test/desaparecidos?caso=1', label: 'Mande uma informação' }]);
  assert.equal((await D('PATCH', `/api/reparticao/missing/${c1.data.id}`, { qr: { mode: 'off' } })).status, 200);
  assert.deepEqual(await qrOf(T1), [null]); assert.ok(!('qr' in (await hb(T1)).missing[0]), 'desligado: o campo nem vai');
  assert.equal((await D('PATCH', `/api/reparticao/missing/${c1.data.id}`, { qr: { mode: 'default' } })).status, 200);
  assert.equal((await D('PUT', '/api/reparticao/missing/qr', { qr: null })).status, 200);
  assert.deepEqual(await qrOf(T1), [{ data: 'tel:+552133330000', label: 'Aponte a câmera e fale agora' }], 'sem o da repartição, volta o da prefeitura');
  // gravar o padrão da prefeitura (outra coisa) não apaga o QR code padrão
  assert.equal((await A.api('PUT', '/api/prefeitura/defaults', { approval: true })).status, 200);
  assert.deepEqual(await qrOf(T1), [{ data: 'tel:+552133330000', label: 'Aponte a câmera e fale agora' }]);

  /* ---------------------------------------------------------------- emergência: não espera a SECOM nem o período eleitoral; teto de 5 */
  const day = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
  assert.equal((await A.api('PUT', '/api/prefeitura/defaults', { electoral: { from: day(-2), to: day(30) } })).status, 200);
  const semFoto = { ...caso, photo: undefined, scope: { kind: 'city' } };
  const c2 = await S('POST', '/api/reparticao/missing', { ...semFoto, kind: 'idoso', name: 'José Teste', age: 81 });
  assert.equal(c2.status, 201, 'com a aprovação ligada e no período eleitoral, o caso sai na hora'); assert.equal(c2.data.hasPhoto, false);
  assert.deepEqual((await hb(T1)).missing.map((m) => [m.name, m.photo]), [['José Teste', null], ['Ana Teste', (await hb(T1)).missing[1].photo]], 'do mais novo para o mais antigo; sem foto: null');
  const c3 = await A.api('POST', '/api/prefeitura/missing', { ...semFoto, name: 'Caso do painel', scope: { kind: 'office', office: escola.id } });
  assert.equal(c3.status, 201, JSON.stringify(c3.data)); assert.equal(c3.data.officeId, null);
  assert.deepEqual((await hb(T2)).missing.map((m) => m.name), ['Caso do painel', 'José Teste', 'Ana Teste']); assert.equal((await hb(T1)).missing.length, 2, 'o caso do painel foi só para a escola');
  for (const n of [4, 5]) assert.equal((await D('POST', '/api/reparticao/missing', { ...semFoto, name: `Caso ${n}` })).status, 201);
  const sixth = await D('POST', '/api/reparticao/missing', { ...semFoto, name: 'Caso 6' });
  assert.equal(sixth.status, 409); assert.match(sixth.data.error, /5 casos no ar/);
  assert.equal((await A.api('POST', '/api/prefeitura/missing', { ...semFoto, name: 'Caso 6 pelo painel' })).status, 409, 'o teto é do cliente');
  assert.equal((await Db('POST', '/api/reparticao/missing', { ...semFoto, name: 'Caso do B' })).status, 201, 'cada cliente tem o seu teto');
  assert.equal((await hb(T2)).missing.length, 5, 'no máximo 5 por tela');

  /* ---------------------------------------------------------------- encerrar: sai do sinal de vida e a foto é apagada na hora */
  assert.equal((await D('POST', `/api/reparticao/missing/${c1.data.id}/close`, { reason: 'vencido' })).status, 400, '"vencido" é só do servidor');
  const cl = await D('POST', `/api/reparticao/missing/${c1.data.id}/close`, { reason: 'localizado' });
  assert.equal(cl.status, 200, JSON.stringify(cl.data));
  assert.ok(!(await hb(T1)).missing.some((m) => m.name === 'Ana Teste'), 'some do sinal de vida');
  assert.equal(fs.existsSync(path.join(s.dataDir, 'graphics', ph2.photo)), false, 'a foto é apagada do armazenamento');
  assert.equal((await fetch(`${s.base}/graphics/${ph2.photo}`)).status, 404);
  assert.equal((await D('POST', `/api/reparticao/missing/${c1.data.id}/close`, {})).status, 409); assert.equal((await D('PATCH', `/api/reparticao/missing/${c1.data.id}`, { name: 'Depois' })).status, 409);
  const closed = (await D('GET', '/api/reparticao/missing')).data.closed.find((m) => m.id === c1.data.id);
  assert.deepEqual([closed.status, closed.closeReason, closed.hasPhoto, closed.closedBy, closed.reportNo], ['closed', 'localizado', false, 'repartição: Defesa Civil (plantao)', 'BO 123/2026'], 'o registro em texto fica');
  assert.equal((await A.api('POST', `/api/prefeitura/missing/${c2.data.id}/close`, { reason: 'encerrado' })).status, 200, 'o painel encerra o caso de qualquer repartição');
  // vencido: o prazo passa e o caso encerra sozinho
  const curto = await D('POST', '/api/reparticao/missing', { ...semFoto, name: 'Vence logo', until: Date.now() + 61500 });
  assert.equal(curto.status, 201, JSON.stringify(curto.data));
  assert.ok((await hb(T1)).missing.some((m) => m.name === 'Vence logo'));
  await new Promise((r) => setTimeout(r, 63000));
  assert.ok(!(await hb(T1)).missing.some((m) => m.name === 'Vence logo'), 'passado o prazo, não vai mais');
  const venc = (await D('GET', '/api/reparticao/missing')).data.closed.find((m) => m.id === curto.data.id);
  assert.deepEqual([venc.closeReason, venc.closedBy], ['vencido', 'sistema']);

  /* ---------------------------------------------------------------- auditoria: só o nome e o número do registro */
  const audit = JSON.stringify((await A.api('GET', '/api/audit?limit=500')).data);
  for (const want of [/pessoa desaparecida \\"Ana Teste\\" \(registro BO 123\/2026\) no ar: 1 tela\(s\), com foto pelo link de controle/, /caso de pessoa desaparecida \\"Ana Teste\\" \(registro BO 123\/2026\) encerrado \(pessoa localizada\); a foto foi apagada/, /QR code de contato dos casos de pessoa desaparecida definido \(tel\) no padrão da prefeitura/]) assert.match(audit, want);
  assert.ok(!/Mãe de teste|Blusa amarela|Praça de teste|5521999990000/.test(audit), 'nada do conteúdo sensível além do nome e do registro');

  /* ---------------------------------------------------------------- o endereço do guichê: só chama e dá andamento à senha */
  assert.equal((await U('POST', '/api/reparticao/queue/services', { name: 'Atendimento', prefix: 'A' })).status, 201);
  const svc = (await U('GET', '/api/reparticao/queue')).data.services[0];
  assert.equal((await D('POST', '/api/reparticao/queue/guiche')).status, 403, 'sem a chamada de senha não há guichê');
  const g = await U('POST', '/api/reparticao/queue/guiche');
  assert.equal(g.status, 201, JSON.stringify(g.data)); assert.match(g.data.url, /^https:\/\/painel\.exemplo\.test\/reparticao\/[A-Za-z0-9_-]{43}\/guiche$/);
  const gt = g.data.url.split('/').at(-2); const Gx = bearer(gt);
  assert.equal((await U('GET', '/api/reparticao/queue')).data.guiche.on, true);
  const page = await fetch(`${s.base}/reparticao/${gt}/guiche`);
  assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /default-src 'none'/); assert.ok(!/unsafe-inline|https?:/.test(page.headers.get('content-security-policy')));
  for (const f of ['guiche.js', 'guiche.css']) assert.equal((await fetch(`${s.base}/reparticao/${f}`)).status, 200, f);
  for (let i = 0; i < 3; i++) assert.equal((await U('POST', '/api/reparticao/queue/tickets', { serviceId: svc.id, name: `Pessoa Numero ${i}` })).status, 201);
  const gv = (await Gx('GET', '/api/guiche')).data;
  assert.deepEqual([gv.office, gv.waiting, gv.services.map((x) => x.name), gv.serving], ['UBS Centro', 3, ['Atendimento'], []]);
  assert.ok(!/Pessoa Numero/.test(JSON.stringify(gv)), 'o guichê não lê a fila com os nomes');
  const call = await Gx('POST', '/api/guiche/call', { desk: 'Guichê 2' });
  assert.equal(call.status, 200, JSON.stringify(call.data)); assert.equal(call.data.ticket.code, 'A001');
  assert.equal((await Gx('POST', `/api/guiche/tickets/${call.data.ticket.id}/repeat`, {})).status, 200);
  assert.equal((await Gx('GET', '/api/guiche')).data.serving[0].desk, 'Guichê 2');
  assert.equal((await Gx('POST', `/api/guiche/tickets/${call.data.ticket.id}/finish`, {})).status, 200);
  const call2 = (await Gx('POST', '/api/guiche/call', { desk: 'Guichê 2' })).data;
  assert.equal((await Gx('POST', `/api/guiche/tickets/${call2.ticket.id}/noshow`, {})).status, 200);
  assert.equal((await Gx('POST', '/api/guiche/tickets/999999/finish', {})).status, 404);
  // o token do guichê não abre mais nada: nem a página de controle, nem o totem, nem o aparelho; e não emite senha
  for (const [m, url] of [['GET', '/api/reparticao/state'], ['GET', '/api/reparticao/queue'], ['POST', '/api/reparticao/queue/tickets'], ['GET', '/api/totem'], ['POST', '/api/totem/tickets'], ['GET', '/api/telas/config'], ['GET', '/api/prefeitura']]) assert.equal((await Gx(m, url, m === 'GET' ? undefined : {})).status, 401, `${m} ${url}`);
  assert.equal((await anon('POST', '/api/reparticao/login', { token: gt, username: 'gestor.ubs', password: 'senha-de-gestor.ubs-2026' })).status, 401, 'o token do guichê não é o link');
  assert.equal((await anon('POST', '/api/guiche/tickets', { serviceId: svc.id }, { authorization: `Bearer ${gt}` })).status, 404, 'não há rota de emitir senha');
  assert.equal((await bearer(U.link)('GET', '/api/guiche')).status, 401, 'o link de controle não é o endereço do guichê');
  assert.equal((await anon('GET', '/api/guiche')).status, 401);
  // gerar outro derruba o anterior; o painel também gera; desligar
  const g2 = await A.api('POST', `/api/prefeitura/offices/${ubs.id}/queue/guiche`, {});
  assert.equal(g2.status, 201); assert.equal((await Gx('GET', '/api/guiche')).status, 401, 'o endereço de antes deixou de valer');
  const G2 = bearer(g2.data.url.split('/').at(-2)); assert.equal((await G2('GET', '/api/guiche')).status, 200);
  assert.equal((await B.api('POST', `/api/prefeitura/offices/${ubs.id}/queue/guiche`, {})).status, 404, 'outro cliente não gera');
  assert.equal((await U('DELETE', '/api/reparticao/queue/guiche')).status, 200); assert.equal((await G2('GET', '/api/guiche')).status, 401);
  assert.ok(!s.out().includes(gt), 'o token do guichê não vai para o log');
}

test('SQLite: pessoas desaparecidas (autorização, alcance, foto, teto, encerrar, vencido, QR code) e o endereço do guichê', { timeout: 400000 }, async () => {
  const s = await boot(ENV);
  try { await roteiro(s); } finally { await s.stop(); cleanup(s.dataDir); }
});

test('Postgres: o mesmo roteiro (as tabelas dos casos e do guichê nascem no banco)', { timeout: 400000 }, async (t) => {
  const { startPg } = await import('./helpers/pg.js');
  const { createPg } = await import('../server/db/pg.js');
  let pgs;
  try { pgs = await startPg(); } catch (err) { t.skip(`Postgres embutido indisponível: ${err.message}`); return; }
  let s = null; let db = null;
  try {
    s = await boot({ ...ENV, DATABASE_URL: pgs.url });
    await roteiro(s);
    db = await createPg(pgs.url, { max: 2 });
    const cols = await db.all("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('telas_missing', 'telas_guiche')");
    const type = (tb, c) => cols.find((x) => x.table_name === tb && x.column_name === c)?.data_type;
    assert.deepEqual([type('telas_missing', 'tenant_id'), type('telas_missing', 'until_at'), type('telas_missing', 'photo_bytes'), type('telas_missing', 'qr_mode'), type('telas_guiche', 'office_id'), type('telas_guiche', 'token_hash')], ['bigint', 'bigint', 'bigint', 'text', 'bigint', 'text']);
    assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM telas_missing WHERE status <> 'active' AND photo_file IS NOT NULL")).n), 0, 'caso encerrado não guarda foto');
  } finally {
    if (db) await db.close().catch(() => {});
    if (s) { await s.stop(); cleanup(s.dataDir); }
    await pgs.stop().catch(() => {});
  }
});
