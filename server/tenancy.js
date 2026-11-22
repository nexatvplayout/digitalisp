// Multi-cliente (SaaS): clientes (tenants), planos, limites, recursos, suspensão, ciclo de vida da assinatura e
// resolução do cliente nas rotas públicas. Não importa auth.js (auth.js é quem importa este módulo).
import { db, getSetting, setSetting } from './db.js';
import { config, ENV_RESOLUTION } from './config.js';
import { hostTenantId } from './domains.js';
import { normalizeServers } from './ntp.js';
import { isStoppedByOperator } from './operator-stop.js';
import { validCpf, validCnpj, parseDocument, parsePhoneAny, formatPhoneAny } from '../public/shared/br-docs.js';
import { graphicsBytes } from './storage-graphics.js'; // imagens do cliente contam na cota (docs/ARMAZENAMENTO.md)
// funcionalidades por plano (docs/PLATAFORMA.md, "Funcionalidades por plano"): o catálogo, o mesmo do Superadmin e do painel
import * as CAT from '../public/shared/funcionalidades.js';

export const DAY = 24 * 3600 * 1000;
export const HOUR = 3600 * 1000;

/** Limites de um plano (valor null = ilimitado). */
/** installations: computadores com a edição Windows (pendentes + ativos), conferido na central ao criar a instalação. */
export const LIMIT_KEYS = ['channels', 'users', 'storageMB', 'products', 'ingests', 'outputs', 'viewers', 'contentItems', 'installations'];
/**
 * Funcionalidades de um plano (booleanos): as do catálogo (public/shared/funcionalidades.js), por menu do painel. As 10 de
 * antes (LEGACY_FEATURE_KEYS) continuam com o mesmo nome e o mesmo efeito; um plano antigo, que só tem elas gravadas, resolve
 * as novas pela regra legacy do catálogo (o que era livre continua liberado). vod: VOD da Central de conteúdo; audience: Fale
 * com a TV, caixa de mensagens do app e perfis (docs/CONTEUDO.md).
 */
export const FEATURE_KEYS = CAT.FEATURE_KEYS;
export const LEGACY_FEATURE_KEYS = CAT.LEGACY_KEYS;
export const TENANT_STATUS = ['trial', 'active', 'past_due', 'suspended', 'canceled'];
/** Clientes nesses estados não têm o serviço no ar: motores parados, rotas públicas indisponíveis, painel só leitura. */
export const BLOCKED = new Set(['suspended', 'canceled']);
export const DEFAULT_TENANT_ID = 1;
export const UNLIMITED_PLAN = 'ilimitado';

const LIMIT_LABEL = {
  channels: ['canal', 'canais'], users: ['usuário', 'usuários'], storageMB: ['MB de armazenamento', 'MB de armazenamento'],
  products: ['produto', 'produtos'], ingests: ['entrada ao vivo', 'entradas ao vivo'], outputs: ['saída extra por canal', 'saídas extras por canal'],
  viewers: ['espectador simultâneo', 'espectadores simultâneos'], contentItems: ['item de conteúdo', 'itens de conteúdo'],
  installations: ['instalação Windows', 'instalações Windows'],
};
const FEATURE_LABEL = {
  app: 'o app do espectador', shop: 'a loja do app', polls: 'as enquetes', scte: 'a sinalização SCTE-35', graphics: 'os gráficos no ar',
  rtmpIngest: 'a recepção RTMP', customDomain: 'domínios próprios', api: 'o acesso por API',
  vod: 'o VOD e as vitrines manuais do app', audience: 'o Fale com a TV, a caixa de mensagens e os perfis do app',
};
/** "Seu plano X não inclui <isto>": as 10 de antes com o texto de sempre; as do catálogo pelo nome. */
export const featurePhrase = (key) => FEATURE_LABEL[key] || `a funcionalidade "${CAT.featureLabel(key)}"`;

export const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const j = (s, d) => { try { const v = s ? JSON.parse(s) : d; return v ?? d; } catch { return d; } };

/* ------------------------------------------------------------------ relógio e contexto injetáveis (testes) */
let clock = () => Date.now();
export const now = () => clock();
export const setClock = (fn) => { clock = typeof fn === 'function' ? fn : () => Date.now(); };

const ctx = { registry: null, realtime: null, ingest: null };
/** Liga os serviços em tempo de execução (motores, WebSocket, RTMP). Opcional: sem eles, uso de espectadores é 0 e não há motores a parar. */
export const bind = (c) => Object.assign(ctx, c);

/* ------------------------------------------------------------------ cache curto de clientes e planos */
const TTL = 5000;
const tenantCache = new Map();
const planCache = new Map();
export const invalidateTenants = () => { tenantCache.clear(); planCache.clear(); };

export async function getTenant(id) {
  id = Number(id);
  if (!Number.isInteger(id)) return null;
  const hit = tenantCache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.row;
  const row = (await db.get('SELECT * FROM tenants WHERE id = ?', [id])) || null;
  tenantCache.set(id, { at: Date.now(), row });
  return row;
}
export const getTenantBySlug = async (slug) => {
  const row = await db.get('SELECT * FROM tenants WHERE slug = ?', [String(slug || '').trim().toLowerCase()]);
  if (row) tenantCache.set(row.id, { at: Date.now(), row });
  return row || null;
};

/* ------------------------------------------------------------------ planos */
export function cleanLimits(input, { strict = true } = {}) {
  const out = {};
  for (const k of LIMIT_KEYS) {
    const v = input?.[k];
    if (v === undefined || v === null || v === '') { out[k] = null; continue; }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || (k !== 'storageMB' && !Number.isInteger(n))) {
      if (strict) throw fail(400, `Limite inválido para "${k}": use um número inteiro de 0 para cima, ou deixe vazio para ilimitado.`);
      out[k] = null; continue;
    }
    out[k] = n;
  }
  return out;
}
/**
 * O conjunto completo e coerente: todas as chaves do catálogo (inclusive as sempre incluídas). Chave citada vale como veio;
 * ausente segue a regra legacy (plano antigo, pedido antigo: nada muda); sem o item do menu, a de dentro fica fora.
 */
export const cleanFeatures = (input) => CAT.resolveFeatures(input && typeof input === 'object' && !Array.isArray(input) ? input : {});

/* Perfis de funcionalidades (Superadmin → Planos → Perfis; server/funcionalidades.js): um conjunto com nome que os planos
   usam. Plano com perfil: as funcionalidades são as do perfil (mudar o perfil muda todos os planos dele); sem perfil, as
   próprias do plano (personalizado). Os limites são sempre do plano. */
export const profileDto = (row) => row && ({
  id: Number(row.id), code: row.code, name: row.name, description: row.description || '', features: cleanFeatures(j(row.features, {})),
  sort: Number(row.sort) || 0, createdAt: row.created_at, updatedAt: row.updated_at,
});
const planOf = (row, profile = null) => row && ({
  id: row.id, code: row.code, name: row.name, description: row.description, priceCents: Number(row.price_cents), currency: row.currency,
  interval: row.interval, trialDays: row.trial_days, limits: cleanLimits(j(row.limits, {}), { strict: false }),
  features: profile ? profile.features : cleanFeatures(j(row.features, {})), active: Boolean(row.active), public: Boolean(row.public), sort: row.sort,
  gatewayRefs: j(row.gateway_refs, {}), createdAt: row.created_at,
  // perfil ligado (null = funcionalidades próprias); ownFeatures = as próprias gravadas (a base se o perfil sair)
  profileId: profile ? profile.id : null, profile: profile ? { id: profile.id, code: profile.code, name: profile.name } : null,
  ownFeatures: profile ? cleanFeatures(j(row.features, {})) : undefined,
});
/** Perfil ligado a um plano (linha do banco); sem a tabela (banco no meio da migração): sem perfil. */
const profileOfRow = async (row) => (row?.profile_id ? profileDto(await db.get('SELECT * FROM feature_profiles WHERE id = ?', [Number(row.profile_id)]).catch(() => null)) : null);
/** DTO do plano a partir da linha (com o perfil ligado). */
export const planDto = async (row) => (row ? planOf(row, await profileOfRow(row)) : null);

export async function getPlan(id) {
  const hit = planCache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.plan;
  const plan = await planDto(await db.get('SELECT * FROM plans WHERE id = ?', [id]));
  planCache.set(id, { at: Date.now(), plan });
  return plan;
}
export const getPlanByCode = async (code) => planDto(await db.get('SELECT * FROM plans WHERE code = ?', [String(code || '').trim()]));
export async function listPlans() {
  const rows = await db.all('SELECT * FROM plans ORDER BY sort, price_cents, id');
  const ids = [...new Set(rows.map((r) => Number(r.profile_id)).filter((x) => Number.isInteger(x) && x > 0))];
  const profiles = new Map();
  if (ids.length) for (const p of await db.all(`SELECT * FROM feature_profiles WHERE id IN (${ids.map(() => '?').join(',')})`, ids).catch(() => [])) profiles.set(Number(p.id), profileDto(p));
  return rows.map((r) => planOf(r, profiles.get(Number(r.profile_id)) || null));
}

/**
 * O cliente padrão (id 1) da nuvem tem sempre tudo (as funcionalidades; os limites seguem o plano dele). Na edição Windows
 * o cliente único também é o id 1, mas quem decide é a licença da central (o plano "licenca" que o agente grava): lá não.
 */
const defaultHasAll = (tenant) => Number(tenant?.id) === DEFAULT_TENANT_ID && !config.edge?.enabled;
const NO_PLAN = { id: null, code: null, name: 'Sem plano', description: '', priceCents: 0, currency: 'brl', interval: 'month', trialDays: 0, active: false, public: false, gatewayRefs: {}, profileId: null, profile: null };
/** Plano do cliente com limits/features já interpretados. Cliente sem plano válido: limites 0 e nenhum dos 10 recursos de antes (o padrão id 1 cai no Ilimitado). */
export async function effectivePlan(tenant) {
  const plan = tenant?.plan_id ? await getPlan(Number(tenant.plan_id)) : null;
  // os modos (optIn, ex.: o modo prefeitura) só valem ligados de propósito no plano, também para o cliente padrão
  if (plan) return defaultHasAll(tenant) ? { ...plan, features: CAT.allFeaturesWith(plan.features) } : plan;
  if (tenant?.id === DEFAULT_TENANT_ID) {
    const unl = await getPlanByCode(UNLIMITED_PLAN);
    return unl ? { ...unl, features: CAT.everyFeature() } : { ...NO_PLAN, limits: cleanLimits({}), features: CAT.allFeatures() };
  }
  // sem plano válido: nenhum dos 10 recursos de antes (como sempre) e o que era livre continua (a regra legacy do catálogo)
  return { ...NO_PLAN, limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, 0])), features: cleanFeatures({}) };
}

/* ------------------------------------------------------------------ uso */
const n = (v) => Number(v || 0);
export const usageChannels = async (tid) => n((await db.get('SELECT COUNT(*) AS n FROM channels WHERE tenant_id = ?', [tid])).n);
export const usageUsers = async (tid) => n((await db.get('SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?', [tid])).n);
export const usageProducts = async (tid) => n((await db.get('SELECT COUNT(*) AS n FROM products WHERE tenant_id = ?', [tid])).n);
export const usageIngests = async (tid) => n((await db.get('SELECT COUNT(*) AS n FROM ingests WHERE tenant_id = ?', [tid])).n);
export const usageContentItems = async (tid) => n((await db.get('SELECT COUNT(*) AS n FROM content_items WHERE tenant_id = ?', [tid])).n);
export const usageInstallations = async (tid) => n((await db.get("SELECT COUNT(*) AS n FROM edge_installations WHERE tenant_id = ? AND status IN ('pending','active')", [tid])).n);
// Todas as gravações que ocupam armazenamento contam na cota, inclusive Censura e a lixeira dela. usageCensuraBytes continua
// separado apenas para detalhar o consumo. A lixeira da biblioteca, as imagens e os LUTs também contam enquanto existirem.
export const usageStorageBytes = async (tid) => n((await db.get('SELECT CAST(COALESCE(SUM(size), 0) AS BIGINT) AS n FROM media WHERE tenant_id = ?', [tid])).n)
  + n((await db.get('SELECT CAST(COALESCE(SUM(size), 0) AS BIGINT) AS n FROM media_trash WHERE tenant_id = ?', [tid])).n)
  + n((await db.get('SELECT CAST(COALESCE(SUM(size), 0) AS BIGINT) AS n FROM censura_trash WHERE tenant_id = ? AND purged_at IS NULL', [tid])).n)
  + n((await db.get('SELECT CAST(COALESCE(SUM(bytes), 0) AS BIGINT) AS n FROM user_luts WHERE tenant_id = ?', [tid])).n)
  // o 5.1 dos apps (server/vod51.js): o som 5.1 dos programas no VOD (sem a cópia do vídeo desde 18/10) conta no plano (pedido do usuário, 17/10:
  // "Tem que entrar no plano do cliente, pois ele quem vai decidir se o canal terá ou não surround")
  + n((await db.get("SELECT CAST(COALESCE(SUM(bytes), 0) AS BIGINT) AS n FROM vod51 WHERE tenant_id = ? AND status = 'ready'", [tid])).n)
  // o bipe dos apps (server/vod-bipe.js): a cópia dos programas com bipe nos palavrões para o VOD, de quem liga a chave dos canais próprios
  + n((await db.get("SELECT CAST(COALESCE(SUM(bytes), 0) AS BIGINT) AS n FROM vod_bipe WHERE tenant_id = ? AND status = 'ready'", [tid])).n)
  // NEXA Nuvem fica fora da biblioteca e do playout, mas usa a mesma franquia do tenant.
  + n((await db.get("SELECT CAST(COALESCE(SUM(size), 0) AS BIGINT) AS n FROM mam_cloud_objects WHERE tenant_id = ? AND status IN ('ready','deleting')", [tid])).n)
  + await graphicsBytes(tid);
// Detalhe da Censura (já incluído em usageStorageBytes), incluindo a lixeira enquanto o arquivo ainda existe.
export const usageCensuraBytes = async (tid) => n((await db.get('SELECT CAST(COALESCE(SUM(size), 0) AS BIGINT) AS n FROM media WHERE tenant_id = ? AND censura = 1', [tid])).n)
  + n((await db.get('SELECT CAST(COALESCE(SUM(size), 0) AS BIGINT) AS n FROM censura_trash WHERE tenant_id = ? AND purged_at IS NULL', [tid])).n);
export const usageStorageMB = async (tid) => Math.round((await usageStorageBytes(tid)) / 1048576 * 10) / 10;
/** Saídas extras: o limite é POR CANAL, então o uso é o maior número de saídas de um canal do cliente. */
export const usageOutputs = async (tid) => n((await db.get(
  'SELECT COALESCE(MAX(c), 0) AS n FROM (SELECT COUNT(*) AS c FROM outputs o JOIN channels ch ON ch.id = o.channel_id WHERE ch.tenant_id = ? GROUP BY o.channel_id) x', [tid])).n);
export const outputsOfChannel = async (channelId) => n((await db.get('SELECT COUNT(*) AS n FROM outputs WHERE channel_id = ?', [channelId])).n);
export function usageViewers(tid) {
  if (!ctx.registry || !ctx.realtime) return 0;
  return ctx.registry.listFor(tid).reduce((s, e) => s + ctx.realtime.viewers(e.channel.slug), 0);
}

export async function usage(tid) {
  const [channels, users, storageMB, products, ingests, outputs, contentItems, installations] = await Promise.all([
    usageChannels(tid), usageUsers(tid), usageStorageMB(tid), usageProducts(tid), usageIngests(tid), usageOutputs(tid), usageContentItems(tid), usageInstallations(tid),
  ]);
  return { channels, users, storageMB, products, ingests, outputs, viewers: usageViewers(tid), contentItems, installations };
}

const USAGE_OF = {
  channels: usageChannels, users: usageUsers, storageMB: usageStorageMB, products: usageProducts, ingests: usageIngests, outputs: usageOutputs,
  viewers: async (tid) => usageViewers(tid), contentItems: usageContentItems, installations: usageInstallations,
};

/* ------------------------------------------------------------------ limites, recursos e suspensão */
const planInfo = (p) => ({ code: p.code, name: p.name });

/** Lança 402 {code:'limit_reached'} se somar `adding` passar do limite do plano. outputs: passe { channelId }. */
export async function assertLimit(tenantId, key, adding = 1, { channelId, current } = {}) {
  const tenant = await getTenant(tenantId);
  const plan = await effectivePlan(tenant);
  const limit = plan.limits[key];
  if (limit == null) return;
  const used = current ?? (key === 'outputs' && channelId ? await outputsOfChannel(channelId) : await USAGE_OF[key](tenantId));
  if (used + adding > limit) {
    const lab = LIMIT_LABEL[key] || [key, key];
    throw fail(402, `Seu plano ${plan.name} permite até ${limit} ${limit === 1 ? lab[0] : lab[1]}. Faça upgrade em "Plano e uso" para continuar.`, {
      code: 'limit_reached', extra: { code: 'limit_reached', key, limit, usage: used, plan: planInfo(plan) },
    });
  }
}

/** Lança 403 {code:'feature_unavailable'} se o plano não inclui o recurso. */
export async function assertFeature(tenantId, key) {
  const tenant = await getTenant(tenantId);
  const plan = await effectivePlan(tenant);
  if (!plan.features[key]) throw featureError(plan, key);
}
/** O 403 de sempre do recurso fora do plano (também o das guardas do catálogo, server/funcionalidades.js). */
export function featureError(plan, key) {
  return fail(403, `Seu plano ${plan.name} não inclui ${featurePhrase(key)}. Faça upgrade em "Plano e uso".`, {
    code: 'feature_unavailable', extra: { code: 'feature_unavailable', key, label: CAT.featureLabel(key), plan: planInfo(plan) },
  });
}
export const hasFeature = async (tenantId, key) => Boolean((await effectivePlan(await getTenant(tenantId))).features[key]);

export const isBlocked = (tenant) => !tenant || BLOCKED.has(tenant.status);
/**
 * Edição Windows: quem bloqueia é a licença da central, não a cobrança local. O agente (server/edge/agent.js) injeta a
 * mensagem mostrada no 402 (motivo do bloqueio e contato do suporte); null = mensagem padrão da cobrança.
 */
let suspendedMessage = null;
export const setSuspendedMessage = (fn) => { suspendedMessage = typeof fn === 'function' ? fn : null; };
/** 402 {code:'tenant_suspended'}: o cliente está suspenso ou cancelado (escrita bloqueada). */
export function suspendedError(tenant) {
  const custom = suspendedMessage?.(tenant);
  if (custom) return fail(402, custom, { code: 'tenant_suspended', extra: { code: 'tenant_suspended', status: tenant?.status ?? null, license: true } });
  return fail(402, tenant?.status === 'canceled'
    ? 'A assinatura foi cancelada. Escolha um plano em "Plano e uso" para reativar.'
    : 'Sua conta está suspensa. Regularize o pagamento em "Plano e uso" para reativar.', { code: 'tenant_suspended', extra: { code: 'tenant_suspended', status: tenant?.status ?? null } });
}
export async function assertActive(tenantId) {
  const t = await getTenant(tenantId);
  if (isBlocked(t)) throw suspendedError(t);
  return t;
}
/** Cliente que pode ter serviço público (existe e não está suspenso/cancelado). */
export const isServing = async (tenantId) => !isBlocked(await getTenant(tenantId));
/**
 * Espectadores do cliente: suspenso? e o limite de espectadores simultâneos do plano (null = sem limite). O WebSocket do site
 * e do app e a presença das TVs aplicam cada um a sua regra (server/chat.js, docs/ESPECTADORES.md).
 */
export async function viewerPolicy(tenantId) {
  const t = await getTenant(tenantId);
  if (isBlocked(t)) return { blocked: true, limit: null };
  return { blocked: false, limit: (await effectivePlan(t)).limits.viewers ?? null };
}
/** A recepção RTMP deste cliente está liberada? (cliente ativo e plano com rtmpIngest) */
export async function ingestAllowed(tenantId) {
  const t = await getTenant(tenantId);
  return !isBlocked(t) && Boolean((await effectivePlan(t)).features.rtmpIngest);
}

/* ------------------------------------------------------------------ configurações da plataforma */
export const SETTINGS_DEFAULTS = {
  defaultPlanCode: UNLIMITED_PLAN, trialDays: 14, graceDays: 5, activeGateway: 'manual',
  announcement: { active: false, text: '', level: 'info' }, maintenance: { active: false, message: '' },
  platformName: 'NEXA TV', supportEmail: '', periodToleranceHours: 24,
  ntp: { enabled: true, servers: [] }, // servers vazio = padrão do servidor (NIC.br ou NTP_SERVERS); docs/RELOGIO.md
  video: { resolution: null }, // resolução dos canais: null = ENGINE_RESOLUTION do servidor; '720p' ou '1080p'
};
export const RESOLUTIONS = ['720p', '1080p'];
export async function getPlatformSettings() {
  const s = j(await getSetting('platform_settings', ''), {});
  const ntp = { ...SETTINGS_DEFAULTS.ntp, ...s.ntp };
  return {
    ...SETTINGS_DEFAULTS, ...s, announcement: { ...SETTINGS_DEFAULTS.announcement, ...s.announcement }, maintenance: { ...SETTINGS_DEFAULTS.maintenance, ...s.maintenance },
    ntp: { enabled: ntp.enabled !== false, servers: ntp.servers?.length ? ntp.servers : [...config.ntp.servers], defaultServers: [...config.ntp.servers], custom: Boolean(ntp.servers?.length) },
    // env: o padrão do servidor; effective: o que os canais usam agora (muda ao salvar, sem reiniciar o servidor)
    video: { resolution: RESOLUTIONS.includes(s.video?.resolution) ? s.video.resolution : null, env: ENV_RESOLUTION, effective: config.engine.resolution },
  };
}

const txt = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Valida e grava. `gatewayOk(id)` diz se o gateway está configurado (injetado por quem conhece os gateways). */
export async function savePlatformSettings(body, { gatewayOk = () => true } = {}) {
  const cur = await getPlatformSettings();
  const b = body || {};
  const out = { ...cur };
  const int = (v, lo, hi, label) => { const x = Number(v); if (!Number.isInteger(x) || x < lo || x > hi) throw fail(400, `${label}: informe um número inteiro entre ${lo} e ${hi}.`); return x; };
  if (b.defaultPlanCode !== undefined) {
    if (!(await getPlanByCode(b.defaultPlanCode))) throw fail(400, 'O plano padrão não existe.');
    out.defaultPlanCode = String(b.defaultPlanCode);
  }
  if (b.trialDays !== undefined) out.trialDays = int(b.trialDays, 0, 365, 'Dias de teste');
  if (b.graceDays !== undefined) out.graceDays = int(b.graceDays, 0, 90, 'Dias de tolerância');
  if (b.periodToleranceHours !== undefined) out.periodToleranceHours = int(b.periodToleranceHours, 0, 720, 'Tolerância de renovação (horas)');
  if (b.activeGateway !== undefined) {
    const g = String(b.activeGateway);
    if (g !== 'manual' && !['mock', 'stripe', 'asaas'].includes(g)) throw fail(400, 'Gateway desconhecido. Use mock, stripe, asaas ou manual.');
    if (g !== 'manual' && !(await gatewayOk(g))) throw fail(400, `O gateway "${g}" não está configurado no servidor.`);
    out.activeGateway = g;
  }
  if (b.announcement) {
    const a = b.announcement;
    out.announcement = { active: Boolean(a.active), text: txt(a.text, 300), level: a.level === 'warn' ? 'warn' : 'info' };
    if (out.announcement.active && !out.announcement.text) throw fail(400, 'Escreva o texto do aviso para ativá-lo.');
  }
  if (b.maintenance) out.maintenance = { active: Boolean(b.maintenance.active), message: txt(b.maintenance.message, 300) };
  if (b.platformName !== undefined) out.platformName = txt(b.platformName, 60) || SETTINGS_DEFAULTS.platformName;
  if (b.supportEmail !== undefined) {
    const e = txt(b.supportEmail, 120);
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw fail(400, 'E-mail de suporte inválido.');
    out.supportEmail = e;
  }
  if (b.ntp) {
    const n = b.ntp;
    let servers = n.servers === undefined ? (cur.ntp.custom ? cur.ntp.servers : []) : normalizeServers(n.servers);
    if (servers.join(',') === config.ntp.servers.join(',')) servers = []; // igual ao padrão: segue o padrão
    out.ntp = { enabled: n.enabled === undefined ? cur.ntp.enabled : Boolean(n.enabled), servers };
  } else out.ntp = { enabled: cur.ntp.enabled, servers: cur.ntp.custom ? cur.ntp.servers : [] };
  if (b.video) {
    const r = b.video.resolution == null || b.video.resolution === '' ? null : String(b.video.resolution);
    if (r && !RESOLUTIONS.includes(r)) throw fail(400, 'Resolução dos canais: use 720p ou 1080p.');
    out.video = { resolution: r };
  } else out.video = { resolution: cur.video.resolution };
  await setSetting('platform_settings', JSON.stringify(out));
  return getPlatformSettings();
}

/* ------------------------------------------------------------------ início: plano Ilimitado e cliente padrão */
const allTrue = () => CAT.everyFeature(); // o Ilimitado tem tudo, os modos (modo prefeitura) também
const allNull = () => Object.fromEntries(LIMIT_KEYS.map((k) => [k, null]));

/** Garante o plano `ilimitado` (sem limites, todos os recursos) e o cliente id 1. Seguro para rodar a cada boot. */
export async function ensureDefaults() {
  const ts = Date.now();
  let plan = await db.get('SELECT * FROM plans WHERE code = ?', [UNLIMITED_PLAN]);
  if (!plan) {
    const id = await db.insert('INSERT INTO plans(code,name,description,price_cents,currency,interval,trial_days,limits,features,active,public,sort,gateway_refs,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [UNLIMITED_PLAN, 'Ilimitado', 'Sem limites, todos os recursos. Plano do cliente padrão (instalações de um cliente só).', 0, 'brl', 'month', 0, JSON.stringify(allNull()), JSON.stringify(allTrue()), 1, 0, 0, '{}', ts]);
    plan = await db.get('SELECT * FROM plans WHERE id = ?', [id]);
  } else {
    // recursos e limites novos entram sozinhos: o Ilimitado é sempre "tudo liberado" (e nunca segue um perfil)
    await db.run('UPDATE plans SET limits = ?, features = ?, active = 1, profile_id = NULL WHERE id = ?', [JSON.stringify(allNull()), JSON.stringify(allTrue()), plan.id]);
  }
  // os 3 planos sugeridos (Essencial, Profissional, Broadcast) com os perfis: uma vez, inativos e sem preço
  // (server/funcionalidades.js; importado aqui na hora, porque ele importa este módulo)
  try { await (await import('./funcionalidades.js')).seedDrafts(); } catch (err) { console.warn(`[plataforma] planos sugeridos: ${err.message}`); }
  if (!(await db.get('SELECT id FROM tenants WHERE id = ?', [DEFAULT_TENANT_ID]))) {
    await db.run('INSERT INTO tenants(id,slug,name,status,plan_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      [DEFAULT_TENANT_ID, 'default', config.platform.defaultTenantName || 'NEXA TV', 'active', plan.id, ts, ts]);
    // no Postgres o id explícito não avança a sequência: ajusta para o próximo cliente não colidir
    if (db.driver === 'pg') await db.exec("SELECT setval(pg_get_serial_sequence('tenants','id'), GREATEST((SELECT MAX(id) FROM tenants), 1), true)");
    console.log(`[plataforma] Cliente padrão criado (id ${DEFAULT_TENANT_ID}, "${config.platform.defaultTenantName || 'NEXA TV'}", plano ilimitado).`);
  }
  invalidateTenants();
}

/* ------------------------------------------------------------------ clientes */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RESERVED = new Set(['platform', 'api', 'admin', 'www', 'app', 'static', 'hls', 'media', 'thumbs', 'graphics', 'ws']);
export const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
export function validSlug(slug) {
  if (!SLUG_RE.test(slug)) throw fail(400, 'Identificador do cliente inválido: use 1 a 40 letras minúsculas, números e hífen.');
  if (RESERVED.has(slug)) throw fail(400, 'Esse identificador é reservado. Escolha outro.');
  return slug;
}

/* ------------------------------------------------------------------ dados de cobrança: CPF/CNPJ, telefone e endereço */
const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');
// CPF e CNPJ (inclusive o alfanumérico) e telefone: as mesmas regras do painel e do superadmin (public/shared/br-docs.js)
export { validCpf, validCnpj };
/** Documento do cliente: normalizado (dígitos; letras maiúsculas no CNPJ alfanumérico) + tipo. Vazio/null = sem documento. Lança 400 se inválido. */
export function cleanDocument(v) {
  if (v === null || v === undefined || String(v).trim() === '') return { document: null, document_type: null };
  const p = parseDocument(v);
  if (p.error) throw fail(400, p.error);
  return { document: p.value, document_type: p.kind };
}
/** Telefone da emissora: do Brasil (DDD, guardado só com os dígitos, sem 0800) ou internacional começando com + (guardado +dígitos). */
export function cleanPhone(v) {
  const p = parsePhoneAny(v);
  if (p.error) throw fail(400, p.error);
  return p.value || '';
}
const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
/** Endereço opcional {street, number, complement, district, city, state, zip}; devolve JSON texto ou null. */
export function cleanAddress(a) {
  if (a === null || a === undefined || a === '') return null;
  if (typeof a !== 'object' || Array.isArray(a)) throw fail(400, 'Endereço inválido: envie um objeto {street, number, complement, district, city, state, zip}.');
  const t = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const out = { street: t(a.street, 120), number: t(a.number, 20), complement: t(a.complement, 60), district: t(a.district, 80), city: t(a.city, 80), state: t(a.state, 2).toUpperCase(), zip: onlyDigits(a.zip).slice(0, 8) };
  if (out.state && !UFS.has(out.state)) throw fail(400, 'UF inválida (use a sigla do estado, ex.: SP).');
  if (out.zip && out.zip.length !== 8) throw fail(400, 'CEP inválido (8 dígitos).');
  if (!Object.values(out).some(Boolean)) return null;
  return JSON.stringify(out);
}

export async function insertTenant(f) {
  const ts = Date.now();
  const id = await db.insert(`INSERT INTO tenants(slug,name,status,plan_id,contact_name,contact_email,notes,trial_ends_at,current_period_end,grace_until,gateway,gateway_customer,gateway_subscription,cancel_at_period_end,created_at,updated_at,document,document_type,phone,address)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [f.slug, f.name, f.status || 'trial', f.plan_id ?? null, f.contact_name || '', f.contact_email || '', f.notes || '', f.trial_ends_at ?? null, f.current_period_end ?? null, f.grace_until ?? null, f.gateway ?? null, f.gateway_customer ?? null, f.gateway_subscription ?? null, f.cancel_at_period_end ? 1 : 0, ts, ts, f.document ?? null, f.document_type ?? null, f.phone || '', f.address ?? null]);
  invalidateTenants();
  return id;
}

const TENANT_COLS = ['slug', 'name', 'status', 'plan_id', 'contact_name', 'contact_email', 'notes', 'trial_ends_at', 'current_period_end', 'grace_until', 'gateway', 'gateway_customer', 'gateway_subscription', 'cancel_at_period_end', 'document', 'document_type', 'phone', 'address', 'accept_global_content'];
/** Atualiza colunas do cliente. Mudança de status passa por setTenantStatus (para parar/religar motores). */
export async function updateTenant(id, fields) {
  const keys = Object.keys(fields).filter((k) => TENANT_COLS.includes(k));
  if (keys.length) {
    await db.run(`UPDATE tenants SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...keys.map((k) => fields[k] ?? null), Date.now(), id]);
  }
  invalidateTenants();
  return db.get('SELECT * FROM tenants WHERE id = ?', [id]);
}

/** Para (cliente bloqueado) ou religa (voltou a ficar ativo) os motores do cliente e atualiza as chaves RTMP. */
export async function applyRuntime(tenantId, { stop = false, start = false } = {}) {
  const reg = ctx.registry;
  if (reg) {
    for (const e of reg.listFor(tenantId)) {
      // cliente suspenso: a tela de fora do ar vai às saídas (YouTube, SRT, UDP) por alguns segundos antes de o motor parar
      // (engine.js #slateStop), em vez do último quadro do programa congelado nelas
      if (stop && e.engine.running) await e.engine.stop({ slate: true }).catch((err) => console.error(`[${e.channel.slug}] parar motor: ${err.message}`));
      // canal parado pelo operador continua parado quando o cliente volta a ficar ativo; reativado com a tela ainda no ar
      // (engine.stopping), o start cancela a parada
      if (start && e.engine.available && config.engine.autostart && (!e.engine.running || e.engine.stopping) && !isStoppedByOperator(e.channel.slug)) {
        await e.engine.start().catch((err) => console.error(`[${e.channel.slug}] motor não iniciou: ${err.message}`));
      }
    }
  }
  await ctx.ingest?.refreshKeys?.();
}

/** Muda o status do cliente. Ao bloquear, para os motores; ao desbloquear, religa. `extra`: grace_until, notes, etc. */
export async function setTenantStatus(id, status, extra = {}) {
  if (!TENANT_STATUS.includes(status)) throw fail(400, 'Situação inválida.');
  const before = await db.get('SELECT * FROM tenants WHERE id = ?', [id]);
  if (!before) throw fail(404, 'Cliente inexistente.');
  const row = await updateTenant(id, { ...extra, status });
  if (!BLOCKED.has(before.status) && BLOCKED.has(status)) await applyRuntime(id, { stop: true });
  else if (BLOCKED.has(before.status) && !BLOCKED.has(status)) await applyRuntime(id, { start: true });
  else if (before.status !== status) await ctx.ingest?.refreshKeys?.();
  return row;
}

/** Sincroniza motores e chaves RTMP com o estado dos clientes (boot). */
export async function syncAll() {
  const reg = ctx.registry;
  if (reg) {
    const blocked = new Set((await db.all("SELECT id FROM tenants WHERE status IN ('suspended','canceled')")).map((r) => Number(r.id)));
    for (const e of reg.list()) if (blocked.has(e.channel.tenantId) && e.engine.running) await e.engine.stop().catch(() => {});
  }
  await ctx.ingest?.refreshKeys?.();
}

/** Intervalo do plano em ms (aproximado: mês = 30 dias, ano = 365). */
export const intervalMs = (interval) => (interval === 'year' ? 365 : 30) * DAY;
/** Soma um período de cobrança a uma data (mês/ano de calendário). */
export function addInterval(ts, interval, count = 1) {
  const d = new Date(ts);
  if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + count); else d.setUTCMonth(d.getUTCMonth() + count);
  return d.getTime();
}

/* ------------------------------------------------------------------ ciclo de vida (tarefa periódica) */
let lifecycleLog = (msg) => console.log(`[plataforma] ${msg}`);
export const setLifecycleLogger = (fn) => { lifecycleLog = fn; };
/** Chamado quando o ciclo de vida cancela um cliente ao fim do período (billingflow para a cobrança no gateway). */
let cancelHook = null;
export const setCancelHook = (fn) => { cancelHook = fn; };
/** Registrador de auditoria injetado por quem sobe o servidor (a tarefa não conhece auth.js). */
let lifecycleAudit = null;
export const setLifecycleAudit = (fn) => { lifecycleAudit = fn; };

/**
 * trial vencido (sem assinatura) -> past_due com tolerância; past_due com tolerância vencida -> suspended;
 * active com cancelamento agendado e período vencido -> canceled; active com período vencido além da tolerância de renovação -> past_due.
 * Devolve as mudanças feitas. O relógio vem de now() (setClock nos testes).
 */
export async function runLifecycle(ts = now()) {
  const s = await getPlatformSettings();
  const graceMs = s.graceDays * DAY;
  const tolMs = s.periodToleranceHours * HOUR;
  const changes = [];
  const move = async (t, status, reason, extra = {}) => {
    await setTenantStatus(t.id, status, extra);
    changes.push({ tenantId: t.id, slug: t.slug, from: t.status, to: status, reason });
    lifecycleLog(`${t.slug}: ${t.status} -> ${status} (${reason})`);
    await lifecycleAudit?.({ tenantId: t.id, action: `ciclo de vida: ${t.status} -> ${status}`, detail: reason });
  };
  const rows = await db.all("SELECT * FROM tenants WHERE status IN ('trial','active','past_due')");
  for (const t of rows) {
    if (t.status === 'trial') {
      // assinatura confirmada pelo gateway já leva o cliente a "active"; ainda em trial = teste vencido sem pagamento
      // (mesmo que tenha aberto um checkout e desistido, o que deixa gateway_subscription preenchido)
      if (t.trial_ends_at && Number(t.trial_ends_at) <= ts) await move(t, 'past_due', 'período de teste vencido', { grace_until: ts + graceMs });
    } else if (t.status === 'past_due') {
      if (t.grace_until && Number(t.grace_until) <= ts) await move(t, 'suspended', 'tolerância de pagamento vencida');
    } else if (t.status === 'active' && t.current_period_end) {
      const end = Number(t.current_period_end);
      if (t.cancel_at_period_end && end <= ts) { await move(t, 'canceled', 'cancelamento no fim do período', { cancel_at_period_end: 0 }); await cancelHook?.(t); }
      else if (end + tolMs < ts) await move(t, 'past_due', 'período vencido sem renovação', { grace_until: ts + graceMs });
    }
  }
  return changes;
}

let lifecycleTimer = null;
/** Roda a tarefa agora e a cada 10 minutos (timer sem segurar o processo). */
export function startLifecycle(everyMs = 10 * 60 * 1000) {
  const tick = () => runLifecycle().catch((e) => console.error('[plataforma] ciclo de vida:', e.message));
  tick();
  clearInterval(lifecycleTimer);
  lifecycleTimer = setInterval(tick, everyMs);
  lifecycleTimer.unref();
  return lifecycleTimer;
}
export const stopLifecycle = () => clearInterval(lifecycleTimer);

/* ------------------------------------------------------------------ resolução do cliente nas rotas públicas */
/** ?host=<hostname> enviado por uma página do cliente servida em outra origem que a API: só o nome, validado. */
const HOST_HINT = /^(?=.{3,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
export const hostHint = (v) => { const h = String(v ?? '').trim().toLowerCase().replace(/\.$/, ''); return HOST_HINT.test(h) ? h : ''; };

/**
 * query ?tenant= > header x-tenant > (cliente do token de sessão, para o painel) > query ?host= (domínio ATIVO; uma página em
 * outra origem chama a API, então o Host da API não identifica o cliente) > host da requisição (domínio ativo) >
 * cliente padrão (id 1; ou o único cliente ativo). Lança 404 se o slug informado não existe. ignoreGiven: pula query/header (login).
 */
export async function resolveTenant(req, { ignoreGiven = false, tokenTid = null } = {}) {
  const given = ignoreGiven ? '' : String(req.query?.tenant || req.get?.('x-tenant') || '').trim().toLowerCase();
  if (given) {
    const t = await getTenantBySlug(given);
    if (!t) throw fail(404, 'Cliente inexistente.');
    return t;
  }
  if (tokenTid) { const t = await getTenant(tokenTid); if (t) return t; }
  const hinted = ignoreGiven ? '' : hostHint(req.query?.host);
  if (hinted) {
    const tid = await hostTenantId(hinted);
    if (tid) { const t = await getTenant(tid); if (t) return t; }
  }
  const host = String(req.hostname || '').toLowerCase();
  if (host) {
    const tid = await hostTenantId(host);
    if (tid) { const t = await getTenant(tid); if (t) return t; }
  }
  const def = await getTenant(DEFAULT_TENANT_ID);
  if (def) return def;
  const rows = await db.all("SELECT id FROM tenants WHERE status IN ('trial','active','past_due') LIMIT 2");
  return rows.length === 1 ? getTenant(rows[0].id) : null;
}

/**
 * WebSocket "identify" (app fora de um canal): slug do cliente > host (domínio ATIVO do site do cliente) > cliente padrão.
 * Só devolve cliente em serviço (não suspenso/cancelado); senão null.
 */
export async function wsTenantId(slug, { host = '' } = {}) {
  let t = null;
  if (slug) t = await getTenantBySlug(slug);
  else {
    const h = hostHint(host);
    const tid = h ? await hostTenantId(h) : null;
    t = tid ? await getTenant(tid) : await getTenant(DEFAULT_TENANT_ID);
  }
  return t && !isBlocked(t) ? t.id : null;
}

export const listTenantIds = async () => (await db.all('SELECT id FROM tenants ORDER BY id')).map((r) => Number(r.id));

export async function tenantCount() {
  return Number((await db.get('SELECT COUNT(*) AS n FROM tenants')).n);
}

/* ------------------------------------------------------------------ representação para as APIs */
const daysLeft = (ts) => (ts ? Math.ceil((Number(ts) - now()) / DAY) : null);
export function tenantDto(t, plan) {
  return {
    id: t.id, slug: t.slug, name: t.name, status: t.status, planId: t.plan_id ?? null, planCode: plan?.code ?? null, planName: plan?.name ?? null,
    contactName: t.contact_name, contactEmail: t.contact_email, notes: t.notes,
    document: t.document ?? null, documentType: t.document_type ?? null, phone: formatPhoneAny(t.phone), address: j(t.address, null),
    trialEndsAt: t.trial_ends_at ?? null, trialDaysLeft: t.status === 'trial' ? daysLeft(t.trial_ends_at) : null,
    currentPeriodEnd: t.current_period_end ?? null, graceUntil: t.grace_until ?? null, graceDaysLeft: t.status === 'past_due' ? daysLeft(t.grace_until) : null,
    gateway: t.gateway ?? null, hasSubscription: Boolean(t.gateway_subscription), cancelAtPeriodEnd: Boolean(t.cancel_at_period_end),
    createdAt: t.created_at, updatedAt: t.updated_at,
    acceptGlobalContent: t.accept_global_content == null ? true : Boolean(Number(t.accept_global_content)),
  };
}

/**
 * Armazenamento extra ATIVO do cliente, em MB (pacotes aprovados e extras dados pela plataforma; server/storage-quota.js,
 * docs/ARMAZENAMENTO.md): somado à cota do plano enquanto durar. O que venceu (ends_at) ou foi revogado não conta.
 */
export async function extraStorageMB(tenantId, at = now()) {
  return n((await db.get("SELECT CAST(COALESCE(SUM(mb), 0) AS BIGINT) AS n FROM storage_extras WHERE tenant_id = ? AND status = 'active' AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at > ?)", [tenantId, at, at])).n);
}
/** Cota de armazenamento do cliente em MB: a do plano + o extra ativo; null = ilimitada (plano sem limite). */
export async function storageLimitMB(tenantId, plan = null) {
  const p = plan || await effectivePlan(await getTenant(tenantId));
  const base = p.limits.storageMB;
  return base == null ? null : base + await extraStorageMB(tenantId);
}

/* Cota sem corrida (revisão de segurança de 10/10): conferir e gravar acontecem sob uma trava por cliente, e o que já passou
   pela conferência mas ainda não aparece no banco (o envio pelo servidor medindo o vídeo, a imagem subindo para o R2) fica
   RESERVADO em memória até aparecer. Assim, envios em paralelo não passam todos pela mesma folga. O servidor é um processo só
   (os motores dos canais vivem nele), então a trava em memória basta. */
const storageLocks = new Map(); // tenantId -> fim da fila
const reservations = new Map(); // tenantId -> bytes reservados
/** Roda fn() sozinho entre as conferências de cota do cliente (fila por cliente; a vez seguinte espera esta terminar). */
export function withStorageLock(tenantId, fn) {
  const tid = Number(tenantId);
  const prev = storageLocks.get(tid) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  storageLocks.set(tid, tail);
  tail.then(() => { if (storageLocks.get(tid) === tail) storageLocks.delete(tid); });
  return run;
}
/** Bytes reservados agora (conferidos, ainda não gravados) do cliente. */
export const reservedStorageBytes = (tenantId) => reservations.get(Number(tenantId)) || 0;
/**
 * Confere a cota e reserva addBytes até release() (atômico por cliente). usedFn(): o uso de agora, sem as reservas (ex.:
 * usageStorageBytes + os envios diretos abertos). Recusado: o 402 de assertStorage. Chame release() quando o arquivo já
 * aparece no uso (linha gravada, imagem no armazenamento) ou desistiu; chamar duas vezes não faz nada.
 */
export async function reserveStorage(tenantId, addBytes, usedFn) {
  const tid = Number(tenantId);
  const add = Math.max(0, Number(addBytes) || 0);
  return withStorageLock(tid, async () => {
    await assertStorage(tid, await usedFn(), add);
    reservations.set(tid, reservedStorageBytes(tid) + add);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const left = reservedStorageBytes(tid) - add;
      if (left > 0) reservations.set(tid, left); else reservations.delete(tid);
    };
  });
}

/**
 * Upload: some o que o cliente já ocupa (usedBytes) e o que está reservado por outros envios em andamento com o arquivo
 * novo (addBytes) e compara com a cota (o plano + o armazenamento extra ativo). Recusado: 402 limit_reached com as duas
 * saídas (mudar de plano ou comprar extra), que o painel mostra junto do erro. Para conferir e gravar sem corrida, use
 * reserveStorage (ou withStorageLock em volta da conferência e da gravação).
 */
export async function assertStorage(tenantId, usedBytes, addBytes) {
  const plan = await effectivePlan(await getTenant(tenantId));
  if (plan.limits.storageMB == null) return;
  const extra = await extraStorageMB(tenantId);
  const limit = plan.limits.storageMB + extra;
  usedBytes += reservedStorageBytes(tenantId);
  if (usedBytes + addBytes > limit * 1048576) {
    const usedMB = Math.round(usedBytes / 1048576 * 10) / 10;
    throw fail(402, `Seu plano ${plan.name} permite até ${limit} MB de armazenamento${extra ? ` (${plan.limits.storageMB} MB do plano + ${extra} MB de extra)` : ''} (em uso: ${usedMB} MB). Faça upgrade ou compre armazenamento extra em "Plano e uso", ou apague mídia.`, {
      code: 'limit_reached', extra: { code: 'limit_reached', key: 'storageMB', limit, planMB: plan.limits.storageMB, extraMB: extra, usage: usedMB, addMB: Math.round(addBytes / 1048576 * 10) / 10, plan: planInfo(plan), actions: ['plan', 'extra'] },
    });
  }
}
