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
import { createPlanGate } from './funcionalidades.js';
import { storage, readInput, isUrl } from './storage.js';
import { clientIp } from './clientip.js';
import { clock } from './ntp.js';
import { mountPlataforma } from './plataforma.js';
import { mountGuia } from './guia.js';
import { mountEnderecos } from './enderecos.js';
import { bindContas, assertNovaTela, contaOf, clientesDe } from './contas.js';
import { lerPermuta, telaNaPermuta } from './tvcorp-permuta.js'; // a PERMUTA: a propaganda obrigatória da revenda nas telas do cliente final
import { mountRevenda } from './revenda.js';
import { mountIntegracoes } from './integracoes.js';
import { mountDominios, entradaDoDominio } from './dominios.js';
import { mountQrcodes } from './qrcodes.js';
import { hostTenantId } from './domains.js';
import { mountRadios, loadRadios, audioOf } from './radios.js';
import { mountMunicipio } from './prefeitura.js';
import { mountHls, carregarHls, channelsOf as hlsChannels, streamOf as hlsStream } from './hls.js';
import { createTvcorp } from './tvcorp.js';
import { TVC_ART } from '../public/shared/tvcorp-tipos.js';
import { createTvcorpDados, FILE_RE as TVC_FILE_RE } from './tvcorp-dados.js';
import { createTelas } from './telas.js';
import { createGeocoder } from './telas-geocode.js';
import { geocode } from './web/fontes.js';
import { getJson as netGetJson } from './web/net.js';
import { createNewsImages } from './noticias-img.js'; // a cópia da foto de cada notícia (uma por vez na tela)
import { prepareMediaImage } from './tvcorp-midia.js'; // a foto da notícia em WebP vira JPEG
import { forecast as weatherForecast } from './weather.js'; // o clima das telas (Open-Meteo/INMET, com cache e cota)
import { sitePlans } from './site-planos.js'; // os planos ativos e públicos no site (GET /api/site/planos)
import { demoLigada } from './demo-contas.js';
import { layoutDoRodizio, lerRodizio, salvarRodizio } from './tvcorp-demo-rodizio.js'; // o rodízio de DEMONSTRAÇÃO na aba Telas // os layouts de demonstração, só nas contas ligadas

const bootedAt = Date.now();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const pub = (p) => path.join(config.root, 'public', p);

/* ------------------------------------------------------------------ banco, acessos e relógio */
bindContas(); // o plano do cliente final sai do plano que a revenda criou (server/contas.js)
await access.bootstrap();
await carregarHls(); // os canais ao vivo (HLS) de cada conta, em memória (server/hls.js)
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
// guardas do catálogo de funcionalidades (public/shared/funcionalidades.js, routes): 403 feature_unavailable para a conta cujo
// plano não tem o módulo (hoje: o Painel da Prefeitura, /api/prefeitura*). A permissão do usuário segue no needs() de cada rota
app.use(createPlanGate({ channelTenant: () => null, peekTenantId: access.peekTenantId, resolveTenant: tenancy.resolveTenant }));
// pedido lento (mais de 400 ms) vai para o log: "[lento] GET /api/tvcorp 1234 ms" (o sinal de vida das telas fica de fora)
app.use((req, res, next) => {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms > 400 && !req.path.startsWith('/api/telas/')) console.log(`[lento] ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Math.round(ms)} ms`);
  });
  next();
});

if (config.platform.canonicalHost) {
  const canon = config.platform.canonicalHost;
  app.use((req, res, next) => (req.hostname === canon.replace(/^www\./, '') ? res.redirect(301, `https://${canon}${req.originalUrl}`) : next()));
}

// a versão no ar (scripts/publicar.sh grava VERSAO a cada publicação): o rodapé do menu do painel mostra
const pkgVersion = (() => { try { return JSON.parse(fs.readFileSync(path.join(config.root, 'package.json'), 'utf8')).version || '0.1.0'; } catch { return '0.1.0'; } })();
const VERSAO = (() => { try { const [n, commit, em] = fs.readFileSync(path.join(config.root, 'VERSAO'), 'utf8').trim().split('|'); return { numero: `${pkgVersion.split('.').slice(0, 2).join('.')}.${n}`, commit, em }; } catch { return { numero: `${pkgVersion} (local)`, commit: null, em: new Date(bootedAt).toISOString() }; } })();
app.get('/api/versao', (_req, res) => res.set('Cache-Control', 'no-cache').json(VERSAO));
app.get('/api/site/planos', ah(async (_req, res) => res.set('Cache-Control', 'public, max-age=60').json({ plans: await sitePlans() })));
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
    // os layouts de demonstração no fim da aba Layouts (server/demo-contas.js): só nas contas ligadas
    demoLayouts: tenant ? await demoLigada(tenant.id) : false,
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
mountIntegracoes(app, { needsPlatform });
mountDominios(app, { needs, needsPlatform });
// gerenciador de QR code (server/qrcodes.js): o QR dinâmico /q/<código>, a página do celular e as leituras
mountQrcodes(app, {
  needs, publicUrl: (req) => publicOrigin(req), ipOf: clientIp, // publicOrigin vem mais abaixo: a seta adia a leitura
  tvcorpFile: async (tid, mid, { poster }, _req, res) => {
    const m = await db.get('SELECT kind, file, fields FROM tvcorp_media WHERE id = ? AND tenant_id = ?', [mid, tid]);
    let name = m?.file; if (poster) { try { name = JSON.parse(m?.fields || '{}').poster; } catch { name = null; } }
    if (!name) return res.status(404).end();
    const src = await readInput('graphics', name).catch(() => null);
    if (!src) return res.status(404).end();
    if (isUrl(src)) return res.redirect(302, src);
    return res.set('Cache-Control', 'public, max-age=3600').sendFile(src, { dotfiles: 'allow' });
  },
});
app.use('/qpagina', express.static(pub('q'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') })); // domínio próprio da revenda e do cliente (server/dominios.js) // superadmin: de onde vêm clima, cotações, notícias, CEP, mapa e rádios (server/integracoes.js)
mountGuia(app, { needs, signedIn, needsPlatform, ah }); // configuração guiada (server/guia.js)
mountRevenda(app, { needs, signedIn, onPermuta: (tid) => telas?.forget(tid), novaChave: (...a) => telas.novaChave(...a) }); // as telas sobem depois: a chave chega por função
mountHls(app, { needs, ah, onChange: (tid) => telas?.forget(tid) }); // canais ao vivo (HLS) (server/hls.js)
mountRadios(app, { needs, signedIn, ah, onChange: (tid) => telas?.forget(tid) }); // rádio de fundo dos layouts sem vídeo (server/radios.js)
await loadRadios();

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

const newsImages = createNewsImages({ dir: path.join(config.dataDir, 'telas', 'noticias'), toJpeg: (buf) => prepareMediaImage(buf, { ffmpeg: config.ffmpeg, orientation: 'land', fit: 'cover' }).then((o) => o.buf) });
setInterval(() => { newsImages.prune().catch(() => {}); }, 3600_000).unref();
const tvcorpDados = createTvcorpDados({
  forget: (tenantId) => telas?.forget(tenantId), // tirar uma notícia da programação muda o que as telas recebem
  newsImages, newsImageUrl: (file) => `${config.platform.publicUrl || ''}/tvcorp/noticia/${file}`, // sem o endereço público: relativo (tvcorp.js completa pelo pedido)
  db, audit: access.audit, ipOf: clientIp, publicUrl: publicOrigin, available: tvcorpOn,
  weatherOf: (ibge) => weatherForecast(ibge),
  files: { dir: path.join(config.dataDir, 'telas', 'tvcorp') },
  photoUrl: (name) => (config.platform.publicUrl ? `${config.platform.publicUrl}/tvcorp/foto/${name}` : null),
});
async function tvcorpLabel(tenantId, kind, id) {
  if (!id) return null;
  const t = { post: ['tvcorp_posts', 'title'], posts: ['tvcorp_posts', 'title'], kpi: ['tvcorp_kpis', 'name'], widget: ['tvcorp_widgets', 'name'], news: ['tvcorp_feeds', 'name'], quotes: ['tvcorp_feeds', 'name'], weather: ['tvcorp_feeds', 'name'], traffic: ['tvcorp_feeds', 'name'] }[kind];
  return t ? (await db.get(`SELECT ${t[1]} AS n FROM ${t[0]} WHERE id = ? AND tenant_id = ?`, [id, tenantId]))?.n ?? null : null;
}
/**
 * A foto de fundo de um slide (public/tvcorp/arte/foto-*.jpg) no formato de arquivo do contrato, para o app baixar e guardar
 * como as outras mídias: { url, sha256, bytes }. Só as fotos (o Android não abre SVG; sem ela, o fundo sai da paleta).
 * A impressão digital é calculada uma vez por arquivo.
 */
const artSums = new Map();
function artFileOf(key, req) {
  const a = TVC_ART[key];
  if (!a?.photo || !/^foto-[a-z0-9-]+$/.test(key)) return null;
  if (!artSums.has(key)) {
    try { const buf = fs.readFileSync(pub(`tvcorp/arte/${key}.jpg`)); artSums.set(key, { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length }); } catch { artSums.set(key, null); }
  }
  const s = artSums.get(key);
  return s ? { url: `${req ? publicOrigin(req) : config.platform.publicUrl || ''}/tvcorp/arte/${key}.jpg`, ...s } : null;
}
/**
 * DIGITAL ISP: a foto de fundo do clima (GPT Image, public/tvcorp/arte/clima-<tempo>-<land|port>.jpg) no formato de arquivo do
 * contrato: { art (deitada), artPort (em pé) }; a TV usa a da forma da zona, em cover, com um véu escuro por cima.
 */
const CLIMA_CONDS = ['clear', 'partly', 'cloudy', 'fog', 'rain', 'storm'];
// de noite (18h às 5h59, hora de Brasília) a foto noturna do mesmo tempo (clima-<tempo>-noite-<forma>.jpg), se existir
const noiteAgora = () => { const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(new Date())) % 24; return h >= 18 || h < 6; };
function climaArtOf(cond, req) {
  if (!CLIMA_CONDS.includes(cond)) return null;
  const noite = noiteAgora();
  const one = (o) => (noite && arte(`clima-${cond}-noite-${o}`)) || arte(`clima-${cond}-${o}`);
  const arte = (key) => {
    if (!artSums.has(key)) {
      try { const buf = fs.readFileSync(pub(`tvcorp/arte/${key}.jpg`)); artSums.set(key, { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length }); } catch { artSums.set(key, null); }
    }
    const s = artSums.get(key); const base = req ? publicOrigin(req) : config.platform.publicUrl || '';
    return s && /^https:\/\//.test(base) ? { url: `${base}/tvcorp/arte/${key}.jpg`, ...s } : null;
  };
  const art = one('land'); const artPort = one('port');
  return art || artPort ? { ...(art ? { art } : {}), ...(artPort ? { artPort } : {}) } : null;
}
let telas = null;
const tvcorp = createTvcorp({
  db, storage: graphicsFiles('tvcmedia-', 'tvclogo-'), ffmpeg: config.ffmpeg, artFile: artFileOf,
  audioOf, // a rádio de fundo do layout (server/radios.js)
  weatherArt: climaArtOf, // a foto de fundo do item de clima
  originOf: (req) => publicOrigin(req), // o endereço do site no pedido (completa a foto da notícia)
  // a zona de gadget vazia: o gadget do cliente do mesmo tipo; senão relógio, clima, ou o primeiro que houver
  widgetFallback: async (tenantId, sample) => {
    const rows = await db.all('SELECT id, kind FROM tvcorp_widgets WHERE tenant_id = ? ORDER BY id', [tenantId]);
    const pick = (k) => rows.find((r) => r.kind === k)?.id;
    return pick(sample) ?? pick('clock') ?? pick('weather') ?? rows[0]?.id ?? null;
  },
  storageCheck: async (tenantId, bytes) => tenancy.assertStorage(tenantId, await tenancy.usageStorageBytes(tenantId), bytes),
  dataFor: tvcorpDados.dataFor, labelFor: tvcorpLabel,
  refExists: async (tenantId, kind, id) => Boolean(await tvcorpLabel(tenantId, kind, id)),
  hasFeature: (tid, key) => tenancy.hasFeature(tid, key),
  pendingOther: async (tenantId) => { const p = await tvcorpDados.pending(tenantId); return (p.posts || 0) + (p.suggestions || 0); },
  // a revenda mudou a biblioteca dela: as telas dos clientes finais com a propaganda da permuta também recebem de novo
  forget: (tenantId) => { telas?.forget(tenantId); clientesDe(tenantId).then((ids) => ids.forEach((c) => telas?.forget(c))).catch(() => {}); },
  audit: access.audit, ipOf: clientIp,
  // o rodízio de DEMONSTRAÇÃO da aba Telas (só nas contas com a demonstração ligada)
  rodizio: { layoutDe: layoutDoRodizio, ler: lerRodizio, salvar: salvarRodizio, ligada: demoLigada },
  // a PERMUTA: só no cliente final, nas telas marcadas (ou em todas), com os itens que a revenda vinculou
  permuta: async (tenantId, deviceId) => {
    const p = await lerPermuta(tenantId);
    if (!telaNaPermuta(p, deviceId)) return null;
    const c = await contaOf(tenantId);
    return c.tipo === 'cliente' && c.revendaId ? { revendaId: c.revendaId, items: p.items } : null;
  },
});
telas = createTelas({
  weatherArt: climaArtOf, // a foto de fundo de cada tempo (config.weather.art/artPort)
  tvcorp, tvcorpDados,
  // o ao vivo da zona de vídeo: o canal HLS que a unidade escolheu (NEXA Broadcast, IPTV do provedor, câmera…)
  // prefeitura (modo órgão público): a repartição sem canal escolhido toca o primeiro canal ao vivo da conta, como o canal da
  // prefeitura no NEXA; a TV Corporativa sem canal segue sem vídeo ao vivo
  streamOf: async (tenantId, channelId, req, deviceId) => hlsStream(tenantId, channelId, req, deviceId)
    ?? (await tenancy.hasFeature(tenantId, 'prefeitura').catch(() => false) ? hlsStream(tenantId, hlsChannels(tenantId)[0]?.id ?? null, req) : null),
  channelsOf: (tenantId) => hlsChannels(tenantId),
  geocode, geocodeAddress: telasGeocoder.find, audit: access.audit, ipOf: clientIp, publicUrl: publicOrigin,
  weatherOf: (ibge) => weatherForecast(ibge),
  // os vídeos guardados da prefeitura são as mídias das telas (tvcorp_media, arquivos tvcmedia-* em graphics/)
  mediaUrl: (filename, req) => { const u = storage.url('graphics', filename); return !u ? null : isUrl(u) ? u : `${publicOrigin(req)}${u}`; },
  openMedia: async (m) => {
    const src = await readInput('graphics', m.filename);
    if (!isUrl(src)) return fs.createReadStream(src);
    const r = await fetch(src);
    if (!r.ok || !r.body) throw new Error(`armazenamento respondeu ${r.status}`);
    return Readable.fromWeb(r.body);
  },
  photos: graphicsFiles('desap-'),
  offlineImages: graphicsFiles('telasimg-'),
});
// limite de telas (plano do cliente e plano da revenda) antes de gerar a chave de uma tela nova
app.post(['/api/tvcorp/rede/keys', '/api/prefeitura/keys'], needs('tvcorp.manage', 'prefeitura.manage'), ah(async (req, _res, next) => { await assertNovaTela(req.tenantId); next(); }));
telas.mount(app, { needs });
mountEnderecos(app, { needs, signedIn, ah, geocodeAddress: telasGeocoder.find }); // CEP, ponto no mapa e endereço da unidade (server/enderecos.js)
tvcorp.mount(app, { needs });
mountMunicipio(app, { telas, needs, needsPlatform, ah }); // o município da prefeitura: só a plataforma e a revenda dela trocam ou tiram (server/prefeitura.js)
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
// a foto da notícia (pelo hash; pública como as artes: é a foto que a fonte já publicou)
app.get('/tvcorp/noticia/:name', ah(async (req, res) => {
  const name = String(req.params.name || '');
  const buf = await newsImages.read(name);
  if (!buf) return res.status(404).end();
  const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  res.set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff' }).send(buf);
}));
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
  // a foto de um caso de pessoa desaparecida (server/telas-desaparecidos.js): sem cache em lugar nenhum, para sumir de fato
  // quando o caso é encerrado
  const noStore = name.startsWith('desap-');
  if (noStore) res.set('Cache-Control', 'no-store');
  if (isUrl(src)) return res.redirect(302, src);
  if (!fs.existsSync(src)) return res.status(404).end();
  if (!noStore) res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(src, { dotfiles: 'allow', ...(noStore ? { cacheControl: false } : {}) });
}));
app.get('/vendor/hls.mjs', (_req, res) => res.set('Cache-Control', 'public, max-age=86400').type('application/javascript').sendFile(path.join(config.root, 'node_modules', 'hls.js', 'dist', 'hls.min.mjs'))); // prévia do HLS no painel
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
// O painel em POUCOS arquivos: os ~50 módulos juntados na subida (esbuild-wasm, puro JS) em ~8 pedaços, em
// DATA_DIR/painel/<versão>/. Pelo túnel, muitos pedidos ao mesmo tempo travavam alguns por segundos (22/11: 40 arquivos
// chegaram a 11 s); com 8, não. Se a junção falhar, o painel segue com os módulos soltos, todos pedidos de uma vez.
const jsDe = (dir, base) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? jsDe(path.join(dir, e.name), `${base}${e.name}/`) : e.name.endsWith('.js') ? [`${base}${e.name}`] : []));
let bundle = null; // [nomes dos arquivos] da versão juntada
if (process.env.PANEL_BUNDLE !== '0') {
  const outdir = path.join(config.dataDir, 'painel', ASSET_VER);
  try {
    const esbuild = await import('esbuild-wasm');
    const r = await esbuild.build({
      entryPoints: [pub('admin/main.js')], bundle: true, format: 'esm', splitting: true, minify: true, outdir,
      external: ['/vendor/*'], metafile: true, logLevel: 'silent', target: ['es2020'],
    });
    fs.copyFileSync(pub('shared/municipios-ibge.json'), path.join(outdir, 'municipios-ibge.json')); // uf-city.js busca ao lado dele
    bundle = Object.keys(r.metafile.outputs).filter((k) => k.endsWith('.js')).map((k) => path.basename(k));
    app.use(`/_v/${ASSET_VER}/painel`, express.static(outdir, longCache));
    // as versões antigas juntadas saem (fica só a atual)
    for (const d of fs.readdirSync(path.dirname(outdir))) if (d !== ASSET_VER) fs.rmSync(path.join(path.dirname(outdir), d), { recursive: true, force: true });
    console.log(`[painel] ${bundle.length} arquivos juntados em ${outdir}`);
  } catch (err) { bundle = null; console.warn(`[painel] sem a junção dos módulos (${err.message}); seguem soltos`); }
}
const preloads = (bundle ? bundle.map((n) => `/_v/${ASSET_VER}/painel/${n}`) : [...jsDe(pub('admin'), `/_v/${ASSET_VER}/admin/`), ...jsDe(pub('shared'), `/_v/${ASSET_VER}/shared/`)])
  .map((u) => `  <link rel="modulepreload" href="${u}">`).join('\n');
let panelHtml = fs.readFileSync(pub('admin/index.html'), 'utf8')
  .replace(/(href|src)="(?!\/|https?:)([^"]+\.(?:css|js))"/g, `$1="/_v/${ASSET_VER}/admin/$2"`)
  .replace(/(href|src)="\/shared\//g, `$1="/_v/${ASSET_VER}/shared/`)
  .replace('</head>', `${preloads}\n</head>`);
if (bundle) panelHtml = panelHtml.replace(`src="/_v/${ASSET_VER}/admin/main.js"`, `src="/_v/${ASSET_VER}/painel/main.js"`);
app.use('/_v/:ver', (_req, res) => res.status(404).set('Cache-Control', 'no-store').end()); // versão antiga: recarregue
const sendPanel = (_req, res) => res.set({ 'Cache-Control': 'no-cache', 'Content-Type': 'text/html; charset=utf-8' }).send(panelHtml);
app.get(['/c/:slug', '/c/:slug/'], sendPanel); // a entrada do cliente final, com a marca da revenda
for (const door of ['/admin', '/superadmin']) {
  app.get([`${door}/`, `${door}/index.html`], sendPanel);
}
const panelStatic = express.static(pub('admin'), { setHeaders: noCache }); // outros arquivos pelo endereço antigo
app.use('/admin', panelStatic);
app.use('/superadmin', panelStatic);
const cacheAge = config.production ? '5m' : 0; // em desenvolvimento, sempre o arquivo novo
app.use('/shared', express.static(pub('shared'), { setHeaders: noCache }));
app.use('/tvcorp', express.static(pub('tvcorp'), { maxAge: cacheAge }));
// domínio próprio (white-label): a raiz do endereço do cliente abre a entrada com a marca dele, não o site da DIGITAL ISP
app.get(['/', '/index.html'], ah(async (req, res, next) => {
  const h = String(req.hostname || '').toLowerCase();
  if (!h || /(^|\.)digitalisp\.com\.br$/.test(h) || h === 'localhost' || /^[\d.]+$/.test(h) || h.includes(':')) return next();
  const tid = await hostTenantId(h);
  return tid ? res.redirect(302, await entradaDoDominio(tid)) : next();
}));
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
  // o que a rota mandou junto com o erro (fail(status, msg, extra) do módulo das telas: o código, a fila cheia, o limite…)
  if (status < 500 && err.extra && typeof err.extra === 'object') Object.assign(body, err.extra, { error: body.error });
  res.status(status).json(body);
});

// "localhost" no túnel pode virar ::1 (IPv6) antes de 127.0.0.1: escutando só no IPv4, o túnel batia primeiro na porta
// recusada. Escuta também no ::1, que continua sendo só a própria máquina
if (config.http.host === '127.0.0.1') http.createServer(app).listen(config.port, '::1').on('error', (e) => console.warn(`[http] ::1 indisponível (${e.code})`));
server.listen(config.port, config.http.host || undefined, () => {
  console.log(`DIGITAL ISP no ar na porta ${config.port} (${config.databaseUrl ? 'Postgres' : `SQLite em ${config.dbFile}`}, armazenamento ${config.storage.driver}).`);
  console.log(`  Painel: http://${config.http.host || "localhost"}:${config.port}/admin/`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });
