// Servidor do DIGITAL ISP: plataforma → revendas → clientes finais → telas.
// Independente do NEXA Broadcast: sem canal, motor, RTMP, censura ou mesa. Os módulos das telas (server/telas*.js) e da
// TV Corporativa (server/tvcorp*.js) vieram do NEXA (c51d2469) e são montados aqui com o que eles pedem.
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { config } from './config.js';
import { db } from './db.js';
import * as access from './auth.js';
import { needs, signedIn, needsPlatform } from './auth.js';
import * as tenancy from './tenancy.js';
import { storage, readInput, isUrl } from './storage.js';
import { clientIp } from './clientip.js';
import { clock } from './ntp.js';
import { mountPlataforma } from './plataforma.js';
import { mountGuia } from './guia.js';
import { createTvcorp } from './tvcorp.js';
import { createTvcorpDados, FILE_RE as TVC_FILE_RE } from './tvcorp-dados.js';
import { createTelas } from './telas.js';
import { createGeocoder } from './telas-geocode.js';
import { geocode } from './web/fontes.js';
import { getJson as netGetJson } from './web/net.js';

const bootedAt = Date.now();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const pub = (p) => path.join(config.root, 'public', p);

/* ------------------------------------------------------------------ banco, acessos e relógio */
await access.bootstrap();
{
  const { ntp } = await tenancy.getPlatformSettings();
  clock.configure({ enabled: config.ntp.enabled && ntp.enabled, servers: ntp.servers, intervalMin: config.ntp.intervalMin });
  tenancy.setClock(clock.now);
}

const app = express();
const server = http.createServer(app);
if (config.http.trustProxy) app.set('trust proxy', config.http.trustProxy);
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
// CORS da API das telas: os apps de TV (Samsung/Tizen, LG/webOS) rodam do pacote, sem origem web própria. A tela se
// identifica pelo token (Authorization: Bearer), nunca por cookie, então liberar qualquer origem aqui não expõe sessão.
app.use('/api/telas', (req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, Range',
    'Access-Control-Expose-Headers': 'Date, ETag',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Max-Age': '600',
  });
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

if (config.platform.canonicalHost) {
  const canon = config.platform.canonicalHost;
  app.use((req, res, next) => (req.hostname === canon.replace(/^www\./, '') ? res.redirect(301, `https://${canon}${req.originalUrl}`) : next()));
}

app.get('/healthz', (_req, res) => res.json({ ok: true, uptime: Math.round((Date.now() - bootedAt) / 1000) }));
app.get('/readyz', ah(async (_req, res) => { await db.get('SELECT 1 AS ok'); res.json({ ok: true }); }));

/* ------------------------------------------------------------------ auditoria */
// o sinal de vida e a captura das telas chegam a cada 30 s por aparelho: só ruído no log
const NOT_AUDITED = new Set(['/admin/login', '/platform/login', '/telas/heartbeat', '/telas/screenshot']);
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || NOT_AUDITED.has(req.path.replace(/\/+$/, '').toLowerCase())) return next();
  const where = req.originalUrl.split('?')[0];
  res.on('finish', () => {
    if (!req.user) return;
    const tenantId = req.user.platform ? (res.locals.auditTenant ?? null) : req.user.tenantId;
    access.audit({ userId: req.user.id, username: req.user.username, action: `${req.method} ${where}`, detail: res.locals.audit, status: res.statusCode, ip: clientIp(req), tenantId, impersonator: req.user.impersonator?.username });
  });
  next();
});

/* ------------------------------------------------------------------ login da revenda e conta */
const fails = new Map();
app.post('/api/admin/login', ah(async (req, res) => {
  const ip = clientIp(req);
  const recent = (fails.get(ip) || []).filter((t) => Date.now() - t < 10 * 60 * 1000);
  if (recent.length >= 20) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  try {
    // a revenda entra pelo e-mail (o usuário é único na plataforma inteira): a revenda é a do próprio usuário.
    // "tenant" (identificador) ainda é aceito para scripts; sem usuário conhecido, vale o endereço (domínio da revenda)
    const username = String(req.body?.username || config.adminUser).trim().toLowerCase().slice(0, 64);
    const slug = String(req.body?.tenant ?? '').trim().toLowerCase();
    const owner = slug ? null : await db.get('SELECT tenant_id FROM users WHERE username = ? AND tenant_id IS NOT NULL', [username]);
    const tenant = slug ? await tenancy.getTenantBySlug(slug)
      : owner ? await tenancy.getTenant(Number(owner.tenant_id)) : await tenancy.resolveTenant(req, { ignoreGiven: true });
    res.json(await access.login(username, req.body?.password, ip, { tenant }));
  } catch (err) {
    if (err.status === 401) fails.set(ip, [...recent, Date.now()]);
    throw err;
  }
}));
app.get('/api/me', signedIn, ah(async (req, res) => {
  const tenant = req.user.tenantId != null ? await tenancy.getTenant(req.user.tenantId) : null;
  const plan = tenant ? await tenancy.effectivePlan(tenant) : null;
  const catalog = (req.user.platform ? access.PLATFORM_PERMISSIONS : access.PERMISSIONS).map(({ id, label, area }) => ({ id, label, area }));
  res.json({
    ...access.meDto(req.user, tenant),
    tenant: tenant ? { id: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status } : null,
    plan: plan ? { code: plan.code, name: plan.name } : null,
    planFeatures: plan?.features || {},
    catalog,
  });
}));
app.post('/api/me/password', signedIn, ah(async (req, res) => {
  res.locals.audit = 'troca da própria senha';
  res.json(await access.changeOwnPassword(req.user.id, req.body?.current, req.body?.next));
}));
app.post('/api/me/logout', ah(async (req, res) => {
  const user = await access.authenticate(req).catch(() => null);
  if (user) req.user = user;
  res.json({ ok: true, revoked: user ? await access.revokeRequestToken(req) : false });
}));

mountPlataforma(app);
mountGuia(app, { needs, signedIn, needsPlatform, ah }); // configuração guiada (server/guia.js)

/* ------------------------------------------------------------------ telas e TV Corporativa */
const publicOrigin = (req) => config.platform.publicUrl || `${req.protocol}://${req.get('host')}`;
const telasGeocoder = createGeocoder({ getJson: netGetJson, fallback: geocode });
const tvcorpOn = async (tenantId) => (await tenancy.isServing(tenantId)) && ((await tenancy.hasFeature(tenantId, 'tvcorp').catch(() => false)) || (await tenancy.hasFeature(tenantId, 'prefeitura').catch(() => false)));

/** Arquivos de imagem guardados em graphics/ com um prefixo próprio (mídia da TV Corporativa, imagem sem internet…). */
const graphicsFiles = (...prefixes) => ({
  dir: config.graphicsDir, ffmpeg: config.ffmpeg,
  put: (name) => storage.put('graphics', name),
  remove: (name) => storage.remove('graphics', name),
  url: (name, req) => { const u = storage.url('graphics', name); return !u ? null : isUrl(u) ? u : `${req ? publicOrigin(req) : config.platform.publicUrl || ''}${u}`; },
  read: async (name) => {
    const src = await readInput('graphics', name);
    if (!isUrl(src)) return fs.promises.readFile(src);
    const r = await fetch(src);
    if (!r.ok) throw new Error(`armazenamento respondeu ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  },
  list: async () => (await Promise.all(prefixes.map((p) => storage.list('graphics', p)))).flat().map((f) => ({ name: f.name, mtime: f.mtimeMs })),
});

const tvcorpDados = createTvcorpDados({
  db, audit: access.audit, ipOf: clientIp, publicUrl: publicOrigin, available: tvcorpOn,
  weatherOf: null, // o clima volta no passo de conteúdo (fonte própria do DIGITAL ISP)
  files: { dir: path.join(config.dataDir, 'telas', 'tvcorp') },
  photoUrl: (name) => (config.platform.publicUrl ? `${config.platform.publicUrl}/tvcorp/foto/${name}` : null),
});
async function tvcorpLabel(tenantId, kind, id) {
  if (!id) return null;
  const t = { post: ['tvcorp_posts', 'title'], posts: ['tvcorp_posts', 'title'], kpi: ['tvcorp_kpis', 'name'], widget: ['tvcorp_widgets', 'name'], news: ['tvcorp_feeds', 'name'], quotes: ['tvcorp_feeds', 'name'], weather: ['tvcorp_feeds', 'name'], traffic: ['tvcorp_feeds', 'name'] }[kind];
  return t ? (await db.get(`SELECT ${t[1]} AS n FROM ${t[0]} WHERE id = ? AND tenant_id = ?`, [id, tenantId]))?.n ?? null : null;
}
let telas = null;
const tvcorp = createTvcorp({
  db, storage: graphicsFiles('tvcmedia-', 'tvclogo-'), ffmpeg: config.ffmpeg,
  dataFor: tvcorpDados.dataFor, labelFor: tvcorpLabel,
  refExists: async (tenantId, kind, id) => Boolean(await tvcorpLabel(tenantId, kind, id)),
  hasFeature: (tid, key) => tenancy.hasFeature(tid, key),
  pendingOther: async (tenantId) => { const p = await tvcorpDados.pending(tenantId); return (p.posts || 0) + (p.suggestions || 0); },
  forget: (tenantId) => telas?.forget(tenantId),
  audit: access.audit, ipOf: clientIp,
});
telas = createTelas({
  tvcorp, tvcorpDados,
  streamOf: () => null, // sem canal próprio: o ao vivo de uma zona é um endereço HLS (NEXA Broadcast ou qualquer outro)
  channelsOf: () => [],
  geocode, geocodeAddress: telasGeocoder.find, audit: access.audit, ipOf: clientIp, publicUrl: publicOrigin,
  mediaUrl: (filename, req) => { const u = storage.url('media', filename); return !u ? null : isUrl(u) ? u : `${publicOrigin(req)}${u}`; },
  openMedia: async (m) => {
    const src = await readInput('media', m.filename);
    if (!isUrl(src)) return fs.createReadStream(src);
    const r = await fetch(src);
    if (!r.ok || !r.body) throw new Error(`armazenamento respondeu ${r.status}`);
    return Readable.fromWeb(r.body);
  },
  photos: graphicsFiles('desap-'),
  offlineImages: graphicsFiles('telasimg-'),
});
telas.mount(app, { needs });
tvcorp.mount(app, { needs });
const tvcorpApiKey = ah(async (req, res, next) => {
  const tok = /^Bearer ([A-Za-z0-9_-]{32,64})$/.exec(req.get('authorization') || '')?.[1];
  const k = tok ? await db.get('SELECT office_id, tenant_id FROM telas_api_keys WHERE token_hash = ?', [createHash('sha256').update(tok).digest('hex')]) : null;
  const o = k ? await db.get('SELECT id, tenant_id, name FROM telas_offices WHERE id = ? AND tenant_id = ?', [k.office_id, k.tenant_id]) : null;
  if (!o) return res.status(401).json({ error: 'Chave de integração inválida.' });
  const tid = Number(o.tenant_id);
  if (!(await tenancy.hasFeature(tid, 'tvcorp').catch(() => false)) || !(await tenancy.hasFeature(tid, 'api').catch(() => false))) return res.status(403).json({ error: 'A TV Corporativa ou a integração por API não estão no plano.', code: 'feature_unavailable' });
  req.tenantId = tid; req.apiOfficeId = Number(o.id); req.apiName = o.name;
  return next();
});
tvcorpDados.mount(app, { needs, apiKey: tvcorpApiKey });
app.get('/tvcorp/foto/:name', ah(async (req, res) => {
  const name = String(req.params.name || '');
  const row = TVC_FILE_RE.test(name) && name.startsWith('tvcpessoa-') ? await db.get('SELECT tenant_id FROM tvcorp_people WHERE photo = ? AND photo_consent = 1', [name]) : null;
  const buf = row && (await tvcorpOn(Number(row.tenant_id))) ? await tvcorpDados.readFile(name) : null;
  if (!buf) return res.status(404).end();
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' }).send(buf);
}));

/* ------------------------------------------------------------------ arquivos guardados e páginas */
app.get('/graphics/:name', ah(async (req, res) => {
  const name = String(req.params.name || '');
  if (!/^[a-z0-9][a-z0-9._-]{0,120}$/i.test(name) || name.includes('..')) return res.status(404).end();
  const src = await readInput('graphics', name).catch(() => null);
  if (!src) return res.status(404).end();
  if (isUrl(src)) return res.redirect(302, src);
  if (!fs.existsSync(src)) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=86400').sendFile(src, { dotfiles: 'allow' });
}));
app.use('/marca', express.static(path.join(config.root, 'marca'), { maxAge: '1h' }));
// o painel tem duas portas: /admin/ (revendas) e /superadmin/ (equipe da plataforma); main.js vê a porta pelo endereço
// o navegador sempre confere os arquivos do painel pelo ETag (304 quando não mudou): uma atualização nunca deixa a página
// nova com o código velho guardado (22/11: o botão Entrar não fazia nada com o main.js antigo no cache)
// Arquivos do painel por endereço com versão (/_v/<versão>/admin/…, /_v/<versão>/shared/…): a Cloudflare guarda .js e .css
// no navegador por 4 h mesmo com no-cache, então cada atualização (cada subida do servidor) usa um endereço novo e a
// página nunca mistura o código velho com o novo. O index.html sai na hora, sem cache, já apontando para a versão.
const noCache = (res) => res.setHeader('Cache-Control', 'no-cache');
const ASSET_VER = Date.now().toString(36);
const longCache = { maxAge: '30d', immutable: true };
app.use(`/_v/${ASSET_VER}/admin`, express.static(pub('admin'), longCache));
app.use(`/_v/${ASSET_VER}/shared`, express.static(pub('shared'), longCache));
app.use('/_v/:ver', (_req, res) => res.status(404).set('Cache-Control', 'no-store').end()); // versão antiga: recarregue
const panelHtml = fs.readFileSync(pub('admin/index.html'), 'utf8')
  .replace(/(href|src)="(?!\/|https?:)([^"]+\.(?:css|js))"/g, `$1="/_v/${ASSET_VER}/admin/$2"`)
  .replace(/(href|src)="\/shared\//g, `$1="/_v/${ASSET_VER}/shared/`);
const sendPanel = (_req, res) => res.set({ 'Cache-Control': 'no-cache', 'Content-Type': 'text/html; charset=utf-8' }).send(panelHtml);
for (const door of ['/admin', '/superadmin']) {
  app.get([`${door}/`, `${door}/index.html`], sendPanel);
}
const panelStatic = express.static(pub('admin'), { setHeaders: noCache }); // outros arquivos pelo endereço antigo
app.use('/admin', panelStatic);
app.use('/superadmin', panelStatic);
const cacheAge = config.production ? '5m' : 0; // em desenvolvimento, sempre o arquivo novo
app.use('/shared', express.static(pub('shared'), { setHeaders: noCache }));
app.use('/tvcorp', express.static(pub('tvcorp'), { maxAge: cacheAge }));
// o site institucional (site/) na raiz: www.digitalisp.com.br vem deste servidor pelo túnel, com o painel em /admin e /superadmin
app.use(express.static(path.join(config.root, 'site'), { maxAge: cacheAge, index: 'index.html' }));

/* ------------------------------------------------------------------ erros */
app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota inexistente.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 500) console.error(`[erro] ${req.method} ${req.originalUrl}: ${err.stack || err.message}`);
  if (res.headersSent) return;
  const body = { error: status >= 500 && config.production ? 'Erro interno.' : err.message || 'Erro.' };
  if (err.code && typeof err.code === 'string') body.code = err.code;
  res.status(status).json(body);
});

server.listen(config.port, config.http.host || undefined, () => {
  console.log(`DIGITAL ISP no ar na porta ${config.port} (${config.databaseUrl ? 'Postgres' : `SQLite em ${config.dbFile}`}, armazenamento ${config.storage.driver}).`);
  console.log(`  Painel: http://${config.http.host || "localhost"}:${config.port}/admin/`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });
