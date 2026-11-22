// NEXA Telas · TV Corporativa, pacote A (docs/TV-CORPORATIVA.md §3.1, §4 e §5): o servidor do conteúdo, da grade e da
// exibição (server/tvcorp.js) montado num express mínimo, nos dois bancos (SQLite e Postgres em UTF8), com o FFmpeg de
// verdade. Mídias (imagem preparada sem metadados, slide de modelo), playlists, layouts, grade e a prévia; a chave
// `signage` (só na unidade corporativa, itens resolvidos, dados segurados 15 min, logomarca); o `plays` e as horas em
// exibição (o que a tela não recebeu é ignorado); relatórios e CSV; histórico de comandos; aprovação pelo link da unidade;
// a chave de integração; isolamento entre clientes; arquivos apagados ao trocar e a limpeza; auditoria sem segredos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import express from 'express';
import ffmpegStatic from 'ffmpeg-static';
import { tmpDir } from './helpers/tmp.js';
import { createSqlite } from '../server/db/sqlite.js';
import { createPg } from '../server/db/pg.js';
import { tvcorpDDL, TVCORP_TABLES, TVCORP_IDENTITY } from '../server/db/schema-tvcorp.js';
import { createTvcorp, MEDIA_RE, LOGO_RE } from '../server/tvcorp.js';

const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic;
const API_TOKEN = 'CHAVE-DE-INTEGRACAO-SECRETA-0123456789abcdef';
const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Uma imagem de teste feita pelo FFmpeg (PNG ou JPEG com um comentário/metadado que tem de sumir). */
function makeImage(dir, name, { w = 800, h = 600, color = 'red', meta = false } = {}) {
  const out = path.join(dir, name);
  const args = ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}`, '-frames:v', '1'];
  const r = spawnSync(FFMPEG, [...args, out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const buf = fs.readFileSync(out);
  if (!meta) return buf;
  // um comentário JPEG (segmento COM) logo depois do início: o que vai às telas tem de sair sem ele
  const text = Buffer.from('GPS-SEGREDO-DA-FOTO');
  return Buffer.concat([buf.subarray(0, 2), Buffer.from([0xff, 0xfe, 0, text.length + 2]), text, buf.subarray(2)]);
}

async function seed(db) {
  const t = Date.now();
  const ins = (sql, p) => db.insert(sql, p).then(Number);
  const office = (tid, name, type, region = null) => ins('INSERT INTO telas_offices(tenant_id,name,type,region_id,created_at) VALUES(?,?,?,?,?)', [tid, name, type, region, t]);
  const device = (tid, oid, name, lastSeen) => ins('INSERT INTO telas_devices(tenant_id,office_id,name,token_hash,last_seen,state,created_at) VALUES(?,?,?,?,?,?,?)', [tid, oid, name, sha(`${name}-${tid}`), lastSeen, 'playing', t]);
  const region = await ins('INSERT INTO telas_regions(tenant_id,name,created_at) VALUES(?,?,?)', [1, 'Sul', t]);
  const fab = await office(1, 'Fábrica Jundiaí', 'fabrica', region);
  const rec = await office(1, 'Recepção Matriz', 'recepcao');
  const esc = await office(1, 'Escola Municipal', 'escola');
  const offB = await office(2, 'Filial do B', 'filial');
  const now = Date.now();
  const dFab = await device(1, fab, 'TV do refeitório', now);
  const dRec = await device(1, rec, 'TV da recepção', now - 3600_000);
  const dEsc = await device(1, esc, 'TV da escola', now);
  const dB = await device(2, offB, 'TV do B', now);
  const group = await ins('INSERT INTO telas_groups(tenant_id,name,created_at) VALUES(?,?,?)', [1, 'Painéis de produção', t]);
  await db.run('INSERT INTO telas_group_devices(group_id,device_id,tenant_id,created_at) VALUES(?,?,?,?)', [group, dFab, 1, t]);
  const groupB = await ins('INSERT INTO telas_groups(tenant_id,name,created_at) VALUES(?,?,?)', [2, 'Grupo do B', t]);
  const card = await ins('INSERT INTO telas_cards(tenant_id,office_id,kind,title,lines,created_at) VALUES(?,?,?,?,?,?)', [1, fab, 'escala', 'Turnos da semana', JSON.stringify(['1º turno: 6h às 14h', '2º turno: 14h às 22h']), t]);
  const cmd1 = await ins('INSERT INTO telas_commands(tenant_id,device_id,type,created_by,created_at,sent_at,done_at,ok) VALUES(?,?,?,?,?,?,?,?)', [1, dFab, 'reload', 'ana', now - 60_000, now - 50_000, now - 40_000, 1]);
  await ins('INSERT INTO telas_commands(tenant_id,device_id,type,created_by,created_at) VALUES(?,?,?,?,?)', [1, dRec, 'screenshot', 'ana', now - 30_000]);
  await ins('INSERT INTO telas_commands(tenant_id,device_id,type,created_by,created_at) VALUES(?,?,?,?,?)', [2, dB, 'reboot', 'bia', now - 30_000]);
  await db.run('INSERT INTO telas_api_keys(office_id,tenant_id,token_hash,created_by,created_at) VALUES(?,?,?,?,?)', [rec, 1, sha(API_TOKEN), 'ana', t]);
  return { region, fab, rec, esc, offB, dFab, dRec, dEsc, dB, group, groupB, card, cmd1 };
}

async function roteiro(db, label) {
  await db.exec(tvcorpDDL(db.driver === 'pg' ? 'pg' : 'sqlite'));
  await db.exec(tvcorpDDL(db.driver === 'pg' ? 'pg' : 'sqlite')); // idempotente
  const S = await seed(db);
  const dir = tmpDir('nexa-tvcorp-gfx');
  const imgDir = tmpDir('nexa-tvcorp-img');
  const removed = []; const audits = []; let forgot = 0;
  let clock = Date.now();
  const storage = {
    dir,
    put: async () => {},
    remove: async (name) => { removed.push(name); },
    url: (name) => `https://cdn.exemplo.test/graphics/${name}`,
    read: (name) => fs.promises.readFile(path.join(dir, name)),
    list: async () => (await fs.promises.readdir(dir)).map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs })),
  };
  let dataCalls = 0; let postMedia = null; let postCtx = null;
  const features = new Map([[1, new Set(['tvcorp', 'api'])], [2, new Set(['tvcorp'])]]);
  const make = () => createTvcorp({
    db, storage, ffmpeg: FFMPEG, now: () => clock, timers: false,
    forget: () => { forgot++; },
    audit: async (e) => { audits.push(JSON.stringify(e)); },
    dataFor: async (tenantId, officeId, ref, ctx) => {
      dataCalls++;
      if (ref.kind === 'birthdays') return { kind: 'birthdays', people: [{ name: 'Ana S.', day: 20, month: 11, sector: 'Financeiro' }], calls: dataCalls };
      if (ref.ref_kind === 'post' && ref.ref_id == null) { postCtx = ctx; return [{ id: 'p1', kind: 'post', category: 'rh', title: 'Um', body: 'Texto', mediaId: postMedia }, { id: 'p2', kind: 'post', category: 'aviso', title: 'Dois', mediaId: 999999 }, { kind: 'mapa' }]; }
      return null;
    },
    labelFor: async (tenantId, kind, id) => (kind === 'post' ? `Comunicado ${id}` : null),
    hasFeature: async (tid, key) => features.get(Number(tid))?.has(key) ?? false,
  });
  const tv = make();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { res.on('finish', () => { if (res.locals.audit) audits.push(res.locals.audit); }); next(); });
  const needs = (perm) => (req, res, next) => {
    const tid = Number(req.get('x-tenant'));
    if (!tid) return res.status(401).json({ error: 'sem sessão' });
    if (perm !== 'tvcorp.manage' || req.get('x-perm') === 'none') return res.status(403).json({ error: 'sem permissão' });
    req.tenantId = tid; req.user = { username: tid === 1 ? 'ana' : 'bia', channels: req.get('x-channels') ? [1] : null };
    return next();
  };
  // o link da unidade: a sessão já conferida (o telas.js faz isso); aqui, pela unidade no cabeçalho
  const guard = async (req, res, next) => {
    const oid = Number(req.get('x-office'));
    const o = oid ? await db.get('SELECT * FROM telas_offices WHERE id = ?', [oid]) : null;
    if (!o) return res.status(401).json({ error: 'sem sessão' });
    req.tenantId = Number(o.tenant_id); req.office = o; req.by = `repartição: ${o.name} (gestor)`;
    return next();
  };
  const mountAll = (x) => { x.mount(app, { needs }); x.mountOffice(app, { guard, note: async (req, action, detail) => { audits.push(detail); } }); };
  // um app só, mas o módulo pode ser trocado (reinício): as rotas chamam o módulo da vez
  const live = express.Router();
  app.use((req, res, next) => live(req, res, next));
  mountAll({ mount: (a, o) => tv.mount(live, o), mountOffice: (a, o) => tv.mountOffice(live, o) });
  app.use((err, _req, res, _next) => res.status(err.status || 400).json({ error: err.message, ...(err.extra || {}) }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { tenant = 1, body, raw, type, headers = {} } = {}) => {
    const h = { ...(tenant ? { 'x-tenant': String(tenant) } : {}), ...headers };
    let payload;
    if (raw) { payload = raw; h['content-type'] = type || 'application/octet-stream'; } else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    const res = await fetch(`${base}${url}`, { method, headers: h, body: payload });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : ct.startsWith('text/') ? await res.text() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  };
  const ok = async (method, url, opts, want = 200) => { const r = await call(method, url, opts); assert.equal(r.status, want, `${label} ${method} ${url}: ${JSON.stringify(r.data).slice(0, 300)}`); return r.data; };
  const devRow = (id) => db.get('SELECT * FROM telas_devices WHERE id = ?', [id]);
  const offRow = (id) => db.get('SELECT * FROM telas_offices WHERE id = ?', [id]);
  const signage = async (devId, x = tv) => { const d = await devRow(devId); const o = await offRow(d.office_id); return x.signageFor(d.tenant_id, d, o, await x.groupIdsOf(Number(d.tenant_id), d.id, o.type)); };

  try {
    /* ---------------------------------------------------------------- guarda e leitura geral */
    assert.equal((await call('GET', '/api/tvcorp', { tenant: 0 })).status, 401);
    assert.equal((await call('GET', '/api/tvcorp', { headers: { 'x-perm': 'none' } })).status, 403);
    assert.equal((await call('GET', '/api/tvcorp', { headers: { 'x-channels': '1' } })).status, 403, 'acesso limitado a alguns canais não entra');
    const g0 = await ok('GET', '/api/tvcorp');
    assert.deepEqual(g0.offices.map((o) => o.name).sort(), ['Fábrica Jundiaí', 'Recepção Matriz'], 'só as unidades corporativas');
    assert.deepEqual(g0.devices.map((d) => d.id).sort((a, b) => a - b), [S.dFab, S.dRec]);
    assert.equal(g0.settings.tz, 'America/Sao_Paulo');

    /* ---------------------------------------------------------------- mídias */
    const png = makeImage(imgDir, 'a.png', { w: 800, h: 600 });
    const jpgMeta = makeImage(imgDir, 'b.jpg', { w: 640, h: 960, color: 'blue', meta: true });
    assert.ok(jpgMeta.includes(Buffer.from('GPS-SEGREDO')), 'a foto enviada tem o comentário');
    const img = await ok('POST', '/api/tvcorp/media/image?title=Campanha%20de%20vacina%C3%A7%C3%A3o&seconds=15', { raw: png, type: 'image/png' }, 201);
    postMedia = img.id;
    assert.equal(img.kind, 'image'); assert.equal(img.width, 1920); assert.equal(img.height, 1080); assert.equal(img.seconds, 15); assert.equal(img.status, 'ok');
    assert.equal(img.title, 'Campanha de vacinação');
    const imgRow = await db.get('SELECT * FROM tvcorp_media WHERE id = ?', [img.id]);
    assert.match(imgRow.file, MEDIA_RE);
    const file = fs.readFileSync(path.join(dir, imgRow.file));
    assert.equal(file[0], 0xff); assert.equal(file[1], 0xd8);
    assert.equal(sha(file), imgRow.sha256); assert.equal(file.length, Number(imgRow.bytes));
    const port = await ok('POST', '/api/tvcorp/media/image?orientation=port&fit=contain&bg=ffffff', { raw: jpgMeta, type: 'image/jpeg' }, 201);
    assert.deepEqual([port.width, port.height], [1080, 1920]);
    const portFile = fs.readFileSync(path.join(dir, (await db.get('SELECT file FROM tvcorp_media WHERE id = ?', [port.id])).file));
    assert.ok(!portFile.includes(Buffer.from('GPS-SEGREDO')), 'sem metadados');
    assert.equal((await call('POST', '/api/tvcorp/media/image', { raw: Buffer.from('não sou imagem, sou texto puro'), type: 'image/png' })).status, 400);
    assert.equal((await call('POST', '/api/tvcorp/media/image', {})).status, 415);
    assert.equal((await call('POST', '/api/tvcorp/media/image?fit=esticar', { raw: png, type: 'image/png' })).status, 400);
    const got = await call('GET', `/api/tvcorp/media/${img.id}/file`);
    assert.equal(got.status, 200); assert.equal(got.headers.get('content-type'), 'image/jpeg'); assert.equal(sha(got.data), imgRow.sha256);

    const slide = await ok('POST', '/api/tvcorp/media', { body: { template: 'comunicado', seconds: 12, fields: { title: 'Férias coletivas', text: 'De 22/12 a 05/01.\nBoas festas!', image: img.id, qr: 'https://rh.exemplo.test/ferias' } } }, 201);
    assert.equal(slide.kind, 'slide'); assert.equal(slide.title, 'Férias coletivas'); assert.equal(slide.fields.image, img.id);
    assert.equal((await call('POST', '/api/tvcorp/media', { body: { template: 'comunicado', fields: { title: 'T', qr: 'http://inseguro.exemplo' } } })).status, 400);
    assert.equal((await call('POST', '/api/tvcorp/media', { body: { template: 'comunicado', fields: { title: 'T', image: slide.id } } })).status, 400, 'slide não cita slide');
    const imgB = await ok('POST', '/api/tvcorp/media/image', { tenant: 2, raw: png, type: 'image/png' }, 201);
    assert.equal((await call('POST', '/api/tvcorp/media', { body: { template: 'comunicado', fields: { title: 'T', image: imgB.id } } })).status, 404, 'imagem de outro cliente');
    assert.equal((await call('POST', '/api/tvcorp/media', { body: { template: 'comunicado', officeId: S.offB, fields: { title: 'T' } } })).status, 404, 'unidade de outro cliente');
    const old = await ok('POST', '/api/tvcorp/media', { body: { template: 'qr', fields: { title: 'Pesquisa', qr: 'https://pesquisa.exemplo.test' } } }, 201);
    const patched = await ok('PATCH', `/api/tvcorp/media/${slide.id}`, { body: { title: 'Férias de fim de ano', fields: { title: 'Férias coletivas', text: 'De 22/12 a 05/01.', image: img.id, variant: 'light' } } });
    assert.equal(patched.title, 'Férias de fim de ano'); assert.equal(patched.fields.variant, 'light');
    // isolamento das mídias
    for (const [m, u] of [['GET', `/api/tvcorp/media/${img.id}`], ['GET', `/api/tvcorp/media/${img.id}/file`], ['PATCH', `/api/tvcorp/media/${img.id}`], ['DELETE', `/api/tvcorp/media/${img.id}`]]) {
      assert.equal((await call(m, u, { tenant: 2, body: m === 'PATCH' ? { title: 'roubo' } : undefined })).status, 404, `${m} ${u} de outro cliente`);
    }
    assert.equal((await ok('GET', '/api/tvcorp/media', { tenant: 2 })).media.length, 1);

    /* ---------------------------------------------------------------- playlists */
    const pl = await ok('POST', '/api/tvcorp/playlists', { body: { name: 'Lateral da fábrica' } }, 201);
    const yesterday = new Date(clock - 86_400_000 * 2).toISOString().slice(0, 10);
    const items = [
      { refKind: 'media', refId: img.id, seconds: 10 },
      { refKind: 'media', refId: slide.id, seconds: 12 },
      { refKind: 'birthdays', params: { period: 'week' } },
      { refKind: 'card', refId: S.card },
      { refKind: 'media', refId: old.id, validTo: yesterday },
      { refKind: 'media', refId: port.id, timeFrom: '11:00', timeTo: '14:00' },
      { refKind: 'posts' },
    ];
    const plFull = await ok('PUT', `/api/tvcorp/playlists/${pl.id}/items`, { body: { items } });
    assert.equal(plFull.items.length, 7); assert.equal(plFull.items[5].timeFrom, 660);
    assert.equal((await call('PUT', `/api/tvcorp/playlists/${pl.id}/items`, { body: { items: [{ refKind: 'media', refId: imgB.id }] } })).status, 404, 'mídia de outro cliente');
    assert.equal((await call('PUT', `/api/tvcorp/playlists/${pl.id}/items`, { tenant: 2, body: { items: [] } })).status, 404, 'playlist de outro cliente');
    assert.equal((await call('GET', `/api/tvcorp/playlists/${pl.id}`, { tenant: 2 })).status, 404);
    const pl2 = await ok('POST', '/api/tvcorp/playlists', { body: { name: 'Só a imagem', shuffle: true } }, 201);
    await ok('PUT', `/api/tvcorp/playlists/${pl2.id}/items`, { body: [{ refKind: 'media', refId: img.id }] });

    /* ---------------------------------------------------------------- layouts */
    const lay = await ok('POST', '/api/tvcorp/layouts', { body: { factoryKey: 'video-lateral-barra', name: 'L da fábrica' } }, 201);
    assert.deepEqual(lay.zones.map((z) => z.id), ['main', 'right', 'bar']);
    const layFull = await ok('POST', '/api/tvcorp/layouts', { body: { factoryKey: 'so-conteudo', background: '#102030' } }, 201);
    assert.equal((await call('POST', '/api/tvcorp/layouts', { body: { name: 'Ruim', zones: [{ id: 'a', kind: 'video', x: 0, y: 0, w: 60, h: 100 }, { id: 'b', kind: 'playlist', x: 50, y: 0, w: 50, h: 100 }] } })).status, 400);
    assert.equal((await call('GET', `/api/tvcorp/layouts/${lay.id}`, { tenant: 2 })).status, 404);

    /* ---------------------------------------------------------------- grade */
    const sched = await ok('POST', '/api/tvcorp/schedules', { body: { name: 'Dia útil da fábrica', layoutId: lay.id, zonePlaylists: { right: pl.id }, scope: { kind: 'offices', offices: [S.fab] }, days: [0, 1, 2, 3, 4, 5, 6], timeFrom: 0, timeTo: 1440, priority: 10 } }, 201);
    assert.deepEqual(sched.scope, { kind: 'offices', offices: [S.fab] });
    assert.equal((await call('POST', '/api/tvcorp/schedules', { body: { name: 'Zona errada', layoutId: lay.id, zonePlaylists: { main: pl.id } } })).status, 400, 'a zona de vídeo não recebe playlist');
    assert.equal((await call('POST', '/api/tvcorp/schedules', { body: { name: 'Zona que não há', layoutId: lay.id, zonePlaylists: { nada: pl.id } } })).status, 400);
    assert.equal((await call('POST', '/api/tvcorp/schedules', { body: { name: 'Alcance alheio', layoutId: lay.id, scope: { kind: 'offices', offices: [S.offB] } } })).status, 404);
    assert.equal((await call('POST', '/api/tvcorp/schedules', { body: { name: 'Grupo alheio', layoutId: lay.id, scope: { kind: 'groups', groups: [S.groupB] } } })).status, 404);
    assert.equal((await call('POST', '/api/tvcorp/schedules', { tenant: 2, body: { name: 'Layout alheio', layoutId: lay.id } })).status, 404);
    const padrao = await ok('POST', '/api/tvcorp/schedules', { body: { name: 'Padrão da empresa', layoutId: layFull.id, zonePlaylists: { main: pl2.id }, scope: { kind: 'all' } } }, 201);
    assert.equal((await call('PUT', '/api/tvcorp/settings', { body: { defaultSchedule: 999999 } })).status, 404);
    const st = await ok('PUT', '/api/tvcorp/settings', { body: { defaultSchedule: padrao.id, theme: { color: '#1D4ED8', mode: 'dark' } } });
    assert.equal(st.settings.defaultSchedule, padrao.id);

    /* ---------------------------------------------------------------- signage */
    const callsBefore = dataCalls;
    const sg = await signage(S.dFab);
    assert.equal(sg.tz, 'America/Sao_Paulo');
    assert.deepEqual(sg.brand, { logo: null, color: '#1d4ed8', mode: 'dark' });
    assert.deepEqual(sg.blocks.map((b) => b.id), [`s${sched.id}`, `s${padrao.id}`]);
    assert.equal(sg.fallback, `s${padrao.id}`);
    const b0 = sg.blocks[0];
    assert.deepEqual(b0.layout.zones.map((z) => z.kind), ['video', 'playlist', 'ticker']);
    assert.deepEqual(b0.days, [0, 1, 2, 3, 4, 5, 6]); assert.equal(b0.from, 0); assert.equal(b0.to, 1440);
    const right = b0.zones.right;
    assert.deepEqual(right.map((i) => i.id), [`m${img.id}`, `m${slide.id}`, 'w:birthdays', `c${S.card}`, `m${port.id}`, 'p1', 'p2'], 'vencido fora; os comunicados de "todos" com o id de cada um; item de tipo estranho fora');
    assert.deepEqual(right[0], { id: `m${img.id}`, kind: 'image', seconds: 10, url: `https://cdn.exemplo.test/graphics/${imgRow.file}`, sha256: imgRow.sha256, bytes: Number(imgRow.bytes), fit: 'contain' });
    assert.equal(right[1].kind, 'slide'); assert.equal(right[1].template, 'comunicado');
    assert.deepEqual(right[1].fields.image, { url: `https://cdn.exemplo.test/graphics/${imgRow.file}`, sha256: imgRow.sha256, bytes: Number(imgRow.bytes) }, 'a imagem do slide vira arquivo do contrato');
    assert.equal(right[2].kind, 'birthdays'); assert.equal(right[2].people[0].name, 'Ana S.');
    assert.deepEqual(right[3].fields, { title: 'Turnos da semana', text: '1º turno: 6h às 14h\n2º turno: 14h às 22h', lines: ['1º turno: 6h às 14h', '2º turno: 14h às 22h'] });
    assert.equal(right[4].from, 660); assert.equal(right[4].to, 840);
    assert.deepEqual(right[5].image, right[0].url ? { url: right[0].url, sha256: right[0].sha256, bytes: right[0].bytes } : null, 'o mediaId do comunicado vira o arquivo');
    assert.equal('mediaId' in right[5], false); assert.equal('image' in right[6], false, 'mídia que não existe: sem imagem');
    assert.equal(postCtx.deviceId, S.dFab); assert.deepEqual(postCtx.groupIds, [S.group]);
    assert.equal(dataCalls - callsBefore, 2, 'aniversariantes e comunicados');
    // o mesmo /config de novo: o mesmo objeto (o rev não muda) e os provedores não são chamados
    assert.deepEqual(await signage(S.dFab), sg); assert.equal(dataCalls - callsBefore, 2);
    clock += 16 * 60_000;
    await signage(S.dFab); assert.equal(dataCalls - callsBefore, 4, 'depois de 15 min busca de novo');
    tv.forgetData(1); await signage(S.dFab); assert.equal(dataCalls - callsBefore, 6, 'o pacote B avisa que mudou');
    // a recepção: só a grade da empresa (padrão); a escola (modo prefeitura): nada
    assert.deepEqual((await signage(S.dRec)).blocks.map((b) => b.id), [`s${padrao.id}`]);
    assert.equal(await signage(S.dEsc), null, 'tela da prefeitura sem signage');
    assert.equal(await signage(S.dB), null, 'outro cliente, sem grade');

    /* ---------------------------------------------------------------- logomarca */
    const logoPng = makeImage(imgDir, 'logo.png', { w: 1024, h: 400, color: 'green' });
    const lg = await ok('PUT', '/api/tvcorp/settings/logo', { raw: logoPng, type: 'image/png' });
    assert.ok(lg.settings.logo.bytes > 0);
    const logoFile = JSON.parse((await db.get('SELECT data FROM tvcorp_settings WHERE tenant_id = 1')).data).logo.file;
    assert.match(logoFile, LOGO_RE);
    const lbuf = fs.readFileSync(path.join(dir, logoFile));
    assert.equal(lbuf.readUInt32BE(0), 0x89504e47); assert.equal(lbuf.readUInt32BE(16), 512, 'largura 512 (sem passar)');
    assert.equal((await signage(S.dFab)).brand.logo.url, `https://cdn.exemplo.test/graphics/${logoFile}`);
    await ok('PUT', '/api/tvcorp/settings/logo', { raw: logoPng, type: 'image/png' });
    assert.ok(removed.includes(logoFile) && !fs.existsSync(path.join(dir, logoFile)), 'trocar apaga a anterior');
    await ok('DELETE', '/api/tvcorp/settings/logo');
    assert.equal((await signage(S.dFab)).brand.logo, null);
    assert.equal((await call('GET', '/api/tvcorp/settings/logo')).status, 404);

    /* ---------------------------------------------------------------- plays e horas */
    const dFab = await devRow(S.dFab);
    const beat = (body = {}, x = tv, ctx = {}) => x.recordPlays(1, dFab, body, ctx);
    assert.deepEqual(await beat(), { accepted: 0, ignored: 0 });
    clock += 30_000;
    const r1 = await beat({ plays: [{ ref: `m${img.id}`, n: 3, sec: 30 }, { ref: 'm999999', n: 5, sec: 5 }, { ref: 'nada', n: 1 }, { ref: 'w:birthdays', n: 1, sec: 12 }] });
    assert.deepEqual(r1, { accepted: 2, ignored: 2 }, 'só o que a tela recebeu');
    clock += 30_000;
    await beat({ plays: [{ ref: `m${img.id}`, n: 3, sec: 30 }] });
    clock += 10 * 60_000;
    await beat(); // depois de um buraco de 10 min: não soma o buraco
    // reinício do servidor: o módulo novo refaz a lista do que a tela recebeu
    const tv2 = make(); // outra instância (as rotas seguem na primeira)
    clock += 30_000;
    const r2 = await beat({ plays: [{ ref: `m${slide.id}`, n: 2, sec: 24 }] }, tv2, { office: await offRow(dFab.office_id), groups: [S.group] });
    assert.equal(r2.accepted, 1);
    const day = (await ok('GET', '/api/tvcorp/summary')).day;
    const playsRows = await db.all('SELECT * FROM tvcorp_plays WHERE tenant_id = 1 ORDER BY ref_kind, ref_id');
    assert.deepEqual(playsRows.map((r) => [r.ref_kind, Number(r.ref_id), Number(r.plays), Number(r.seconds), r.day]), [['birthdays', 0, 1, 12, day], ['media', img.id, 6, 60, day], ['media', slide.id, 2, 24, day]]);
    assert.equal(Number((await db.get('SELECT on_sec FROM tvcorp_hours WHERE tenant_id = 1 AND device_id = ?', [S.dFab])).on_sec), 60, '30 s + 30 s; o buraco de 10 min e o reinício não contam');
    // relatório de exibição
    const rep = await ok('GET', `/api/tvcorp/reports/plays?from=${day}&to=${day}`);
    assert.deepEqual(rep.rows.map((r) => [r.name, r.plays, r.seconds, r.devices]), [['Campanha de vacinação', 6, 60, 1], ['Férias de fim de ano', 2, 24, 1], ['Aniversariantes', 1, 12, 1]]);
    const repDev = await ok('GET', '/api/tvcorp/reports/plays?by=device');
    assert.deepEqual(repDev.rows.map((r) => [r.name, r.office, r.plays]), [['TV do refeitório', 'Fábrica Jundiaí', 9]]);
    const repOff = await ok('GET', '/api/tvcorp/reports/plays?by=office');
    assert.deepEqual(repOff.rows.map((r) => [r.name, r.devices, r.plays]), [['Fábrica Jundiaí', 1, 9]]);
    const csv = await call('GET', `/api/tvcorp/reports/plays?format=csv&from=${day}&to=${day}`);
    assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.headers.get('content-disposition'), /relatorio-de-exibicao-item/);
    assert.ok(csv.data.replace(/^﻿/, '').startsWith('Item;Tipo;Vezes na tela'), 'o BOM o fetch tira; o toCsv é conferido em tvcorp.test.js');
    assert.match(csv.data, /Campanha de vacinação;media;6;60;0 h 01 min;1/);
    assert.equal((await call('GET', '/api/tvcorp/reports/plays?by=mes')).status, 400);
    assert.equal((await call('GET', '/api/tvcorp/reports/plays?from=2020-01-01&to=2026-01-01')).status, 400);
    assert.deepEqual((await ok('GET', '/api/tvcorp/reports/plays', { tenant: 2 })).rows, [], 'outro cliente não vê');
    const hours = await ok('GET', '/api/tvcorp/reports/hours');
    assert.equal(hours.total, 60); assert.equal(hours.rows[0].name, 'TV do refeitório');
    assert.match((await call('GET', '/api/tvcorp/reports/hours?format=csv')).data, /TV do refeitório;Fábrica Jundiaí;1;60;0 h 01 min/);

    /* ---------------------------------------------------------------- o que a tela mostra agora, resumo, comandos */
    const nowFab = await ok('GET', `/api/tvcorp/devices/${S.dFab}/now`);
    assert.equal(nowFab.block.id, sched.id); assert.equal(nowFab.block.name, 'Dia útil da fábrica');
    assert.ok(nowFab.zones.right.some((i) => i.id === `m${slide.id}` && i.title === 'Férias coletivas'));
    assert.deepEqual(nowFab.lastPlays.items.map((i) => i.name), ['Campanha de vacinação']);
    assert.equal((await call('GET', `/api/tvcorp/devices/${S.dFab}/now`, { tenant: 2 })).status, 404);
    await db.run('UPDATE telas_devices SET last_seen = ? WHERE id = ?', [clock - 10_000, S.dFab]); // o sinal de vida (no relógio do teste)
    const sum = await ok('GET', '/api/tvcorp/summary');
    assert.equal(sum.devices.total, 2); assert.equal(sum.devices.on, 1); assert.equal(sum.devices.off, 1);
    assert.deepEqual(sum.off.map((d) => d.name), ['TV da recepção']);
    assert.equal(sum.hours.today, 60); assert.equal(sum.hours.days30, 60); assert.equal(sum.itemsNow, 0, 'o último plays desta instância tem mais de 10 min'); assert.equal(sum.devices.showing, 0);
    clock -= 60_000; // de volta para dentro dos 10 min do último plays
    const sumNow = await ok('GET', '/api/tvcorp/summary');
    assert.equal(sumNow.itemsNow, 1); assert.equal(sumNow.devices.showing, 1);
    clock += 60_000;
    assert.equal(sum.media.total, 4); assert.equal(sum.pending, 0);
    assert.deepEqual(await ok('GET', '/api/tvcorp/badge'), { off: 1, pending: 0 });
    const cmds = await ok('GET', '/api/tvcorp/commands');
    assert.deepEqual(cmds.commands.map((c) => [c.device, c.type, c.result]).sort(), [['TV da recepção', 'screenshot', 'Aguardando a tela'], ['TV do refeitório', 'reload', 'Feito']]);
    assert.deepEqual((await ok('GET', `/api/tvcorp/commands?deviceId=${S.dFab}`)).commands.map((c) => c.id), [S.cmd1]);
    assert.equal((await call('GET', `/api/tvcorp/commands?deviceId=${S.dB}`)).status, 404, 'tela de outro cliente');
    assert.equal((await ok('GET', '/api/tvcorp/commands', { tenant: 2 })).commands.length, 1);

    /* ---------------------------------------------------------------- prévia da grade */
    const pv = await ok('POST', '/api/tvcorp/schedules/preview', { body: { name: 'Plantão da recepção', layoutId: lay.id, zonePlaylists: { right: pl2.id }, scope: { kind: 'devices', devices: [S.dRec] }, priority: 50 } });
    assert.equal(pv.devices, 1); assert.equal(pv.winsNow, 1); assert.equal(pv.list[0].name, 'TV da recepção');
    const pv2 = await ok('POST', '/api/tvcorp/schedules/preview', { body: { id: sched.id, priority: 0 } });
    assert.equal(pv2.devices, 1); assert.equal(pv2.list[0].now.draft, true, 'a mudança vale para a tela da fábrica');
    assert.equal((await ok('GET', `/api/tvcorp/schedules/${sched.id}`)).priority, 10, 'a prévia não grava');

    /* ---------------------------------------------------------------- aprovação pelo link da unidade */
    await ok('PUT', '/api/tvcorp/settings', { body: { approval: true } });
    const asFab = { tenant: 0, headers: { 'x-office': String(S.fab) } };
    const pend = await ok('POST', '/api/reparticao/tvcorp/media', { ...asFab, body: { template: 'reconhecimento', fields: { title: 'Equipe do mês', name: 'Turno B' } } }, 201);
    assert.equal(pend.status, 'pending'); assert.equal(pend.officeId, S.fab);
    const pendImg = await ok('POST', '/api/reparticao/tvcorp/media/image?title=Foto%20do%20evento', { ...asFab, raw: png, type: 'image/png' }, 201);
    assert.equal(pendImg.status, 'pending');
    assert.equal((await call('POST', '/api/reparticao/tvcorp/media', { ...asFab, body: { template: 'comunicado', fields: { title: 'T', image: img.id } } })).status, 404, 'a unidade cita só imagens dela');
    assert.equal((await call('DELETE', `/api/reparticao/tvcorp/media/${img.id}`, asFab)).status, 404, 'mídia da empresa: a unidade não apaga');
    assert.equal((await ok('GET', '/api/reparticao/tvcorp/media', asFab)).media.length, 2);
    assert.equal((await ok('GET', '/api/reparticao/tvcorp/media', { tenant: 0, headers: { 'x-office': String(S.rec) } })).media.length, 0);
    await ok('PUT', `/api/tvcorp/playlists/${pl2.id}/items`, { body: [{ refKind: 'media', refId: img.id }, { refKind: 'media', refId: pend.id }] });
    const ids = async () => (await signage(S.dRec)).blocks[0].zones.main.map((i) => i.id);
    assert.deepEqual(await ids(), [`m${img.id}`], 'pendente não vai às telas');
    const apr = await ok('GET', '/api/tvcorp/approvals');
    assert.equal(apr.approvals.filter((a) => a.status === 'pending').length, 2);
    assert.equal((await ok('GET', '/api/tvcorp/badge')).pending, 2);
    const aSlide = apr.approvals.find((a) => a.refId === pend.id);
    assert.equal(aSlide.office, 'Fábrica Jundiaí'); assert.equal(aSlide.media.title, 'Equipe do mês');
    assert.equal((await call('POST', `/api/tvcorp/approvals/${aSlide.id}/decide`, { tenant: 2, body: { approve: true } })).status, 404);
    assert.equal((await call('POST', `/api/tvcorp/approvals/${aSlide.id}/decide`, { body: { approve: false } })).status, 400, 'devolver pede o motivo');
    await ok('POST', `/api/tvcorp/approvals/${aSlide.id}/decide`, { body: { approve: true } });
    assert.equal((await call('POST', `/api/tvcorp/approvals/${aSlide.id}/decide`, { body: { approve: true } })).status, 409);
    assert.deepEqual((await ids()).sort(), [`m${img.id}`, `m${pend.id}`].sort());
    const aImg = apr.approvals.find((a) => a.refId === pendImg.id);
    await ok('POST', `/api/tvcorp/approvals/${aImg.id}/decide`, { body: { approve: false, note: 'Foto fora de foco' } });
    assert.equal((await ok('GET', `/api/tvcorp/media/${pendImg.id}`)).status, 'rejected');
    await ok('DELETE', `/api/reparticao/tvcorp/media/${pendImg.id}`, asFab);
    await ok('PUT', '/api/tvcorp/settings', { body: { approval: false } });

    /* ---------------------------------------------------------------- chave de integração */
    const bearer = (tok) => ({ tenant: 0, headers: { authorization: `Bearer ${tok}` } });
    assert.equal((await call('POST', '/api/tvcorp-api/media/image', { ...bearer('x'.repeat(40)), raw: png, type: 'image/png' })).status, 401);
    const bi = await ok('POST', '/api/tvcorp-api/media/image?title=Painel%20de%20vendas', { ...bearer(API_TOKEN), raw: png, type: 'image/png' }, 201);
    assert.equal(bi.officeId, S.rec); assert.equal(bi.status, 'ok');
    const biFile = (await db.get('SELECT file FROM tvcorp_media WHERE id = ?', [bi.id])).file;
    const bi2 = await ok('POST', `/api/tvcorp-api/media/image?id=${bi.id}`, { ...bearer(API_TOKEN), raw: makeImage(imgDir, 'c.png', { color: 'yellow' }), type: 'image/png' }, 200);
    assert.equal(bi2.id, bi.id); assert.notEqual(bi2.sha256, bi.sha256);
    assert.ok(!fs.existsSync(path.join(dir, biFile)) && removed.includes(biFile), 'trocar apaga a anterior');
    assert.equal((await call('POST', `/api/tvcorp-api/media/image?id=${img.id}`, { ...bearer(API_TOKEN), raw: png, type: 'image/png' })).status, 404, 'só as mídias da própria unidade');
    features.get(1).delete('api');
    assert.equal((await call('POST', '/api/tvcorp-api/media/image', { ...bearer(API_TOKEN), raw: png, type: 'image/png' })).status, 403, 'sem a integração no plano');
    features.get(1).add('api');

    /* ---------------------------------------------------------------- apagar */
    assert.equal((await call('DELETE', `/api/tvcorp/playlists/${pl.id}`)).status, 409, 'playlist na grade');
    assert.equal((await call('DELETE', `/api/tvcorp/layouts/${lay.id}`)).status, 409, 'layout na grade');
    const slideFile = (await db.get('SELECT file FROM tvcorp_media WHERE id = ?', [port.id])).file;
    await ok('DELETE', `/api/tvcorp/media/${port.id}`);
    assert.ok(!fs.existsSync(path.join(dir, slideFile)) && removed.includes(slideFile));
    assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM tvcorp_playlist_items WHERE ref_kind = 'media' AND ref_id = ?", [port.id])).n), 0, 'sai das playlists');
    await ok('DELETE', `/api/tvcorp/schedules/${padrao.id}`);
    assert.equal((await ok('GET', '/api/tvcorp')).settings.defaultSchedule, null, 'a grade padrão apagada sai da configuração');
    assert.equal(await signage(S.dRec), null, 'sem grade para a recepção');
    await ok('DELETE', `/api/tvcorp/schedules/${sched.id}`);
    await ok('DELETE', `/api/tvcorp/playlists/${pl.id}`);
    await ok('DELETE', `/api/tvcorp/layouts/${lay.id}`);
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM tvcorp_playlist_items WHERE playlist_id = ?', [pl.id])).n), 0);

    /* ---------------------------------------------------------------- limpeza */
    const orphan = 'tvcmedia-00000000-0000-4000-8000-000000000000.jpg';
    fs.writeFileSync(path.join(dir, orphan), 'x');
    const oldT = new Date(Date.now() - 2 * 3600_000); fs.utimesSync(path.join(dir, orphan), oldT, oldT);
    const fresh = 'tvclogo-00000000-0000-4000-8000-000000000001.png';
    fs.writeFileSync(path.join(dir, fresh), 'x');
    await db.run('INSERT INTO tvcorp_plays(tenant_id,device_id,day,ref_kind,ref_id,plays,seconds) VALUES(?,?,?,?,?,?,?)', [1, S.dFab, '2024-01-01', 'media', 1, 1, 1]);
    await tv.prune(Date.now());
    assert.ok(!fs.existsSync(path.join(dir, orphan)), 'órfão antigo sai');
    assert.ok(fs.existsSync(path.join(dir, fresh)), 'órfão de menos de 1 h fica (envio no meio)');
    assert.ok(fs.existsSync(path.join(dir, imgRow.file)), 'o que está em uso fica');
    assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM tvcorp_plays WHERE day = '2024-01-01'")).n), 0, 'mais de 400 dias sai');

    /* ---------------------------------------------------------------- auditoria e tabelas */
    const all = audits.join('\n');
    assert.ok(audits.some((a) => /tv corporativa: imagem "Campanha de vacinação"/.test(a)));
    assert.ok(audits.some((a) => /chave de integração de \\?"Recepção Matriz/.test(a)));
    assert.ok(audits.some((a) => /aguardando aprovação/.test(a)));
    assert.ok(!all.includes(API_TOKEN) && !all.includes(sha(API_TOKEN)), 'sem a chave na auditoria');
    assert.ok(forgot > 10, 'cada mudança avisa o telas.js (rev)');
    for (const tbl of TVCORP_TABLES) assert.ok(await db.get(`SELECT COUNT(*) AS n FROM ${tbl}`), tbl);
    assert.ok(TVCORP_IDENTITY.every((x) => TVCORP_TABLES.includes(x)));
  } finally {
    tv.stop();
    await new Promise((r) => server.close(r));
  }
}

test('TV Corporativa (pacote A) no SQLite', { timeout: 240_000 }, async (t) => {
  const dir = tmpDir('nexa-tvcorp-sqlite', t);
  const db = createSqlite(path.join(dir, 'digitalisp.db'));
  try { await roteiro(db, 'sqlite'); } finally { await db.close(); }
});

test('TV Corporativa (pacote A) no Postgres (banco em UTF8)', { timeout: 300_000 }, async (t) => {
  const { startPg } = await import('./helpers/pg.js');
  let pgSrv;
  try { pgSrv = await startPg(); } catch (err) { t.skip(`Postgres embutido indisponível: ${err.message}`); return; }
  let db = null;
  try {
    const { default: pgLib } = await import('pg');
    const admin = new pgLib.Client({ connectionString: pgSrv.url });
    await admin.connect();
    await admin.query("CREATE DATABASE tvc ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0");
    await admin.end();
    db = await createPg(pgSrv.url.replace(/\/nexa$/, '/tvc'), { max: 4 });
    await roteiro(db, 'pg');
  } finally {
    await db?.close().catch(() => {});
    await pgSrv.stop();
  }
});
