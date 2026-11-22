// Domínios dos clientes. Dois modos (docs/PLATAFORMA.md, seção "Domínios"):
//
//  • AUTOMÁTICO (Cloudflare + Railway configurados no servidor): ao adicionar cliente.com.br a plataforma (a) cria a ZONA
//    na conta Cloudflare da plataforma (ou reaproveita a que já existe nela), (b) cria o(s) domínio(s) personalizado(s) no
//    SERVIÇO do Railway que serve a API, o site, o painel e os apps web, (c) cria na zona os registros que o Railway pede
//    (CNAME — no apex a Cloudflare faz "CNAME flattening" — e o TXT de verificação; proxy ligado com SSL/TLS "Full", ou
//    só DNS com CLOUDFLARE_PROXIED=0) e (d) grava tudo no banco. O cliente recebe só os DOIS servidores DNS para o Registro.br.
//    Uma tarefa periódica (e o botão "verificar agora") acompanha: zona "active" na Cloudflare + certificado emitido no
//    Railway = domínio ATIVO (status 'verified'), e só então ele resolve o cliente pelo Host da requisição.
//    Remover tira do Railway, APAGA a zona na Cloudflare e apaga do banco. Falha no meio do cadastro desfaz o que foi criado.
//  • MANUAL (sem as integrações, ex.: desenvolvimento): verificação por DNS — TXT `_nexa-verify.<host>` ou CNAME para
//    PLATFORM_HOST — como antes.
//
// A antiga integração "Cloudflare for SaaS" (custom hostnames na zona CLOUDFLARE_ZONE_ID) foi SUBSTITUÍDA pela zona por
// domínio; só sobrou a limpeza do custom hostname ao remover domínios antigos que tinham cf_id.
import dns from 'node:dns';
import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import * as cf from './providers/cloudflare.js';
import * as railway from './providers/railway.js';
import { requestJson } from './providers/http.js';

const fail = (status, message) => Object.assign(new Error(message), { status });

export const DOMAIN_KINDS = ['viewer', 'panel', 'api'];
export const VERIFY_PREFIX = '_nexa-verify';
const MIN = 60_000;
const HOUR = 60 * MIN;
/** Próxima checagem automática por situação. */
export const CHECK_EVERY = { pending: 10 * MIN, dns_active: 5 * MIN, verified: 6 * HOUR, error: HOUR, transient: 5 * MIN };
/** activation_check da Cloudflare: zona Free aceita 1 por hora (pagas: 1 a cada 5 min). */
const ACTIVATION_EVERY = HOUR;

/* ------------------------------------------------------------------ pontos de injeção (testes) */
let resolver = { resolveTxt: (h) => dns.promises.resolveTxt(h), resolveCname: (h) => dns.promises.resolveCname(h) };
/** Troca o resolvedor DNS ({ resolveTxt(host) -> string[][], resolveCname(host) -> string[] }). Sem argumento, volta ao padrão. */
export const setResolver = (r) => {
  resolver = r || { resolveTxt: (h) => dns.promises.resolveTxt(h), resolveCname: (h) => dns.promises.resolveCname(h) };
};
let hostOverride = null;
export const setPlatformHost = (h) => { hostOverride = h == null ? null : String(h).toLowerCase(); };
export const platformHost = () => hostOverride ?? config.platform.host ?? '';
let clock = () => Date.now();
/** Relógio do acompanhamento automático (testes). Sem argumento, volta ao relógio real. */
export const setDomainClock = (fn) => { clock = typeof fn === 'function' ? fn : () => Date.now(); };
const now = () => clock();

/** Modo automático = Cloudflare E Railway configurados. Faltando qualquer variável, os domínios novos usam o modo manual. */
export const autoMode = () => cf.configured() && railway.configured();

/* ------------------------------------------------------------------ cache host -> cliente (30 s) e origens ativas (CORS) */
const CACHE_MS = 30_000;
const hostCache = new Map();
let activeHosts = new Set();
/** Hosts ATIVOS (status verified, + www quando incluído), para o CORS e o WebSocket aceitarem o domínio do cliente quando
 *  uma página dele chama a API em outra origem (no Railway o caso normal é a mesma origem, que não precisa de CORS). */
export async function refreshActiveHosts() {
  const rows = await db.all("SELECT hostname, include_www FROM domains WHERE status = 'verified'");
  const s = new Set();
  for (const r of rows) { s.add(r.hostname); if (Number(r.include_www)) s.add(`www.${r.hostname}`); }
  activeHosts = s;
  return s;
}
export const invalidateDomains = () => { hostCache.clear(); refreshActiveHosts().catch(() => {}); };
/** Origem (https://host[:porta]) de um domínio ATIVO de cliente? Síncrono (usa a lista em memória). */
export function isActiveOrigin(origin) {
  try {
    const u = new URL(String(origin));
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !config.production)) return false;
    return activeHosts.has(u.hostname.toLowerCase());
  } catch { return false; }
}

/** Cliente dono deste host (só domínio ATIVO: status verified; www.<domínio> casa quando o domínio inclui o www) ou null. */
export async function hostTenantId(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h || h.length > 253) return null;
  const hit = hostCache.get(h);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.tid;
  const bare = h.startsWith('www.') ? h.slice(4) : null;
  const row = await db.get("SELECT tenant_id FROM domains WHERE status = 'verified' AND (hostname = ? OR (include_www = 1 AND hostname = ?))", [h, bare ?? h]);
  const tid = row ? Number(row.tenant_id) : null;
  hostCache.set(h, { at: Date.now(), tid });
  if (hostCache.size > 2000) hostCache.clear();
  return tid;
}

/* ------------------------------------------------------------------ validação do nome */
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/** Normaliza (minúsculas, sem ponto final) e valida. Rejeita esquema, caminho, porta, IP, localhost e o domínio da própria plataforma. */
export function validateHostname(raw) {
  let h = String(raw ?? '').trim().toLowerCase();
  if (!h) throw fail(400, 'Informe o domínio.');
  if (/[\s/\\?#@:]/.test(h)) throw fail(400, 'Informe só o nome do domínio (ex.: tv.suaempresa.com.br), sem https://, caminho, porta ou espaços.');
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (h.length > 253) throw fail(400, 'Domínio longo demais.');
  if (/^\d+(\.\d+){3}$/.test(h)) throw fail(400, 'Use um nome de domínio, não um endereço IP.');
  if (h === 'localhost' || h.endsWith('.localhost')) throw fail(400, 'Domínio inválido.');
  const labels = h.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !TLD.test(labels.at(-1))) throw fail(400, 'Domínio inválido. Exemplo: tv.suaempresa.com.br.');
  const own = platformHost();
  if (own && (h === own || h.endsWith(`.${own}`))) throw fail(400, 'Esse domínio pertence à própria plataforma.');
  return h;
}

/**
 * Domínio registrável (o que tem servidores DNS no registro): cliente.com.br, cliente.com, cliente.art.br…
 * Heurística SEM a Public Suffix List completa: em TLD de país (2 letras), uma segunda parte comum (com, net, org, art,
 * blog, eco, edu, ind, inf, tv, app…) conta como sufixo. Serve para recusar subdomínio no modo automático.
 */
const SLD = new Set(['com', 'net', 'org', 'gov', 'edu', 'co', 'ac', 'art', 'blog', 'eco', 'ind', 'inf', 'tv', 'app', 'dev', 'log', 'med', 'adv', 'eng', 'arq', 'tur',
  'emp', 'esp', 'rec', 'srv', 'tmp', 'vet', 'wiki', 'agr', 'fm', 'am', 'radio', 'coop', 'mus', 'not', 'ntr', 'psi', 'seg', 'etc', 'far', 'fot', 'imb', 'jor', 'leg',
  'lel', 'mil', 'jus', 'mp', 'pro', 'bio', 'tec', 'ong', 'nom', 'ltd', 'plc', 'gob', 'gub', 'net', 'or', 'ne', 'go', 'lg', 'id', 'sch', 'ind', 'abc', 'bmd', 'cim',
  'cng', 'cnt', 'ecn', 'flog', 'geo', 'ggf', 'jab', 'mat', 'odo', 'ppg', 'pro', 'qsl', 'slg', 'taxi', 'teo', 'trd', 'vlog', 'zlg', 'des', 'det', 'bib', 'cri', 'fst', 'b']);
export function registrableDomain(h) {
  const labels = String(h).split('.');
  const tld = labels.at(-1);
  const n = labels.length >= 3 && /^[a-z]{2}$/.test(tld) && SLD.has(labels.at(-2)) ? 3 : 2;
  return labels.slice(-n).join('.');
}

/* ------------------------------------------------------------------ representação */
const parseNs = (s) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a.map(String).slice(0, 2) : []; } catch { return []; } };
export const registroBrInstruction = (ns) => (ns.length >= 2 ? `No Registro.br, em DNS → Alterar servidores DNS, coloque: ${ns[0]} e ${ns[1]}` : null);

const LABELS = {
  auto: {
    pending: ['Aguardando a troca dos DNS no Registro.br', 'wait'],
    dns_active: ['DNS ativo, aguardando o certificado do Railway', 'wait'],
    verified: ['Ativo', 'ok'],
    error: ['Erro', 'err'],
  },
  manual: {
    pending: ['Aguardando o registro DNS (TXT ou CNAME)', 'wait'],
    failed: ['Registro DNS não encontrado', 'err'],
    verified: ['Ativo', 'ok'],
  },
};

export function domainDto(r) {
  const mode = r.mode === 'auto' ? 'auto' : 'manual';
  const [label, level] = LABELS[mode][r.status] || [r.status, 'wait'];
  const err = mode === 'auto' ? (r.provider_error ?? null) : (r.last_error ?? null);
  const base = {
    id: r.id, tenantId: r.tenant_id, hostname: r.hostname, kind: r.kind, mode, status: r.status,
    statusLabel: r.status === 'error' ? `Erro: ${err || 'falha nos provedores'}` : label, statusLevel: level,
    includeWww: Boolean(Number(r.include_www)), verifiedAt: r.verified_at ?? null, lastCheckAt: r.last_check_at ?? null, lastError: err,
    nextCheckAt: r.next_check_at ?? null, createdAt: r.created_at, warning: r.warning ?? null,
  };
  if (mode === 'auto') {
    const ns = parseNs(r.name_servers);
    return {
      ...base, nameServers: ns, instruction: registroBrInstruction(ns), instructions: null,
      cloudflare: { status: r.cf_status || null }, railway: { verified: Boolean(Number(r.railway_verified)), status: r.railway_status || null },
    };
  }
  const own = platformHost();
  return {
    ...base, nameServers: [], instruction: null, verifyToken: r.verify_token, cloudflare: null, railway: null, legacyCloudflare: Boolean(r.cf_id),
    instructions: {
      txt: { type: 'TXT', name: `${VERIFY_PREFIX}.${r.hostname}`, value: r.verify_token },
      cname: { type: 'CNAME', name: r.hostname, value: own || null },
    },
  };
}

/* ------------------------------------------------------------------ integrações (estado e teste de conexão) */
export function integrationsStatus() {
  const cfm = cf.missing(); const rm = railway.missing();
  const someSet = cfm.length < cf.ENV.length || rm.length < railway.ENV.length;
  const auto = !cfm.length && !rm.length;
  return {
    mode: auto ? 'auto' : 'manual',
    cloudflare: { configured: !cfm.length, missing: cfm, proxied: cf.proxiedDefault(), testBase: Boolean(process.env.CLOUDFLARE_API_BASE) },
    railway: { configured: !rm.length, missing: rm, tokenKind: railway.tokenKind(), testBase: Boolean(process.env.RAILWAY_API_BASE) },
    legacySaas: Boolean((process.env.CLOUDFLARE_ZONE_ID || '').trim()),
    warning: someSet && !auto ? `Integração incompleta (faltam: ${[...cfm, ...rm].join(', ')}). Enquanto isso, os domínios novos usam o modo manual (TXT/CNAME).` : null,
  };
}

/** Testa a conexão: Cloudflare GET /user/tokens/verify; Railway: consulta do projeto (ou projectToken). Nunca devolve o token. */
export async function testIntegration(id) {
  const st = integrationsStatus();
  if (id === 'cloudflare') {
    if (!st.cloudflare.configured) return { ok: false, message: `Faltam as variáveis: ${st.cloudflare.missing.join(', ')}.` };
    try {
      const r = await cf.verifyToken();
      const ok = String(r?.status || '').toLowerCase() === 'active';
      return { ok, message: ok ? 'Token da Cloudflare válido e ativo.' : `Token da Cloudflare com status "${r?.status ?? 'desconhecido'}".` };
    } catch (e) { return { ok: false, message: e.message }; }
  }
  if (id === 'railway') {
    if (!st.railway.configured) return { ok: false, message: `Faltam as variáveis: ${st.railway.missing.join(', ')}.` };
    try {
      const p = await railway.testConnection();
      return { ok: true, message: `Projeto do Railway encontrado: ${p?.name || 'ok'}.` };
    } catch (e) { return { ok: false, message: e.message }; }
  }
  throw fail(404, 'Integração desconhecida. Use cloudflare ou railway.');
}

/* ------------------------------------------------------------------ operações */
export async function listDomains({ tenantId } = {}) {
  const rows = tenantId == null
    ? await db.all('SELECT d.*, t.slug AS tenant_slug, t.name AS tenant_name FROM domains d LEFT JOIN tenants t ON t.id = d.tenant_id ORDER BY d.id DESC')
    : await db.all('SELECT * FROM domains WHERE tenant_id = ? ORDER BY id DESC', [tenantId]);
  return rows.map((r) => ({ ...domainDto(r), ...(r.tenant_slug !== undefined ? { tenantSlug: r.tenant_slug, tenantName: r.tenant_name } : {}) }));
}

export async function getDomain(id) {
  return (await db.get('SELECT * FROM domains WHERE id = ?', [id])) || null;
}

const namesOf = (row) => (Number(row.include_www) ? [row.hostname, `www.${row.hostname}`] : [row.hostname]);
const isNotFound = (e) => Boolean(e?.notFound) || e?.upstreamStatus === 404 || (e?.codes || []).some((c) => [1001, 7003, 'NOT_FOUND'].includes(c));
const parseIds = (s) => { try { const o = JSON.parse(s || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };

/**
 * Cadastra o domínio. Modo automático: cria zona + domínio no Railway + registros e devolve o domínio com os DOIS servidores
 * DNS (nameServers + instruction). Modo manual: devolve as instruções TXT/CNAME. O campo `mode` diz qual foi usado.
 */
export async function addDomain({ tenantId, hostname, kind = 'viewer', includeWww = false }) {
  let h = validateHostname(hostname);
  if (!DOMAIN_KINDS.includes(kind)) throw fail(400, 'Tipo de domínio inválido. Use viewer, panel ou api.');
  const auto = autoMode();
  let www = false;
  if (auto) {
    if (h.startsWith('www.')) { h = validateHostname(h.slice(4)); www = true; }
    www = www || Boolean(includeWww);
    const apex = registrableDomain(h);
    if (apex !== h) throw fail(400, `Informe o domínio registrado (ex.: ${apex}), sem subdomínio: a configuração automática cria na Cloudflare a zona do domínio inteiro, e é ele que tem os servidores DNS no Registro.br.`);
    if (await db.get('SELECT id FROM domains WHERE hostname IN (?, ?)', [h, `www.${h}`])) throw fail(409, 'Esse domínio já está cadastrado.');
  } else if (await db.get('SELECT id FROM domains WHERE hostname = ? OR (include_www = 1 AND ? = hostname)', [h, h.startsWith('www.') ? h.slice(4) : h])) {
    throw fail(409, 'Esse domínio já está cadastrado.');
  }
  const token = `nexa-${randomBytes(16).toString('hex')}`;
  let id;
  try {
    id = await db.insert('INSERT INTO domains(tenant_id,hostname,kind,status,verify_token,created_at,mode,include_www) VALUES(?,?,?,?,?,?,?,?)',
      [tenantId, h, kind, 'pending', token, Date.now(), auto ? 'auto' : 'manual', www ? 1 : 0]);
  } catch (e) {
    if (/unique|duplicate/i.test(e.message)) throw fail(409, 'Esse domínio já está cadastrado.');
    throw e;
  }
  if (auto) await provision(id, h, www);
  invalidateDomains();
  return domainDto(await getDomain(id));
}

/** (a) zona, (b) domínio(s) no serviço do Railway, (c) registros DNS que o Railway pede, (d) banco. Erro: desfaz o que ESTA chamada criou. */
async function provision(id, h, www) {
  const created = { zone: null, railway: [] };
  const names = www ? [h, `www.${h}`] : [h];
  const warnings = [];
  try {
    // (a) zona na conta da plataforma: reaproveita a existente; em outra conta = erro claro
    let zone = await cf.findZone(h);
    if (!zone) {
      try {
        zone = await cf.createZone(h);
        created.zone = zone?.id || null;
      } catch (e) {
        if ((e.codes || []).some((c) => cf.ZONE_EXISTS_CODES.has(c))) {
          throw fail(409, `O domínio ${h} já está em outra conta da Cloudflare. O dono dessa conta precisa remover o site de lá (ou fale com o suporte da plataforma).`);
        }
        if ((e.codes || []).some((c) => cf.NOT_REGISTERED_CODES.has(c))) throw fail(400, `A Cloudflare recusou ${h}: não parece um domínio registrado. Confira o nome no Registro.br.`);
        throw e;
      }
    }
    if (!zone?.id) throw fail(502, 'A Cloudflare não devolveu o identificador da zona.');
    const ns = (zone.name_servers || []).slice(0, 2);
    await db.run('UPDATE domains SET cf_zone_id = ?, cf_status = ?, name_servers = ? WHERE id = ?', [zone.id, zone.status || 'pending', JSON.stringify(ns), id]);

    // SSL/TLS "Full" na zona (exigência do Railway com o proxy da Cloudflare). Sem a permissão Zone Settings: vira aviso.
    if (cf.proxiedDefault()) {
      await cf.setSslMode(zone.id, 'full').catch((e) => warnings.push(`Não foi possível pôr o SSL/TLS da zona em "Full" (${e.message}); ajuste no painel da Cloudflare.`));
    }

    // (b) domínio(s) no serviço do Railway (que serve API, site, painel e apps web)
    const rw = {};
    for (const n of names) {
      try {
        rw[n] = await railway.createCustomDomain(n);
        created.railway.push(rw[n].id);
      } catch (e) {
        const mine = e.exists ? await railway.findCustomDomain(n).catch(() => null) : null;
        if (mine?.id) { rw[n] = mine; continue; } // já estava NESTE serviço: reaproveita
        if (e.exists) throw fail(409, `O Railway recusou ${n}: ele já está em uso em outro serviço ou projeto do Railway. ${e.message}`);
        throw e;
      }
      if (!rw[n]?.id) throw fail(502, `O Railway não devolveu o identificador do domínio ${n}.`);
    }

    // (c) registros que o Railway pede (CNAME — no apex a Cloudflare faz CNAME flattening — e o TXT de verificação)
    const proxied = cf.proxiedDefault();
    for (const n of names) {
      const recs = railway.requiredRecords(rw[n], h);
      if (!recs.some((r) => r.type === 'CNAME' || r.type === 'A')) throw fail(502, `O Railway não informou o destino (CNAME) de ${n}.`);
      for (const r of recs) await cf.ensureRecord(zone.id, { ...r, proxied: r.type === 'TXT' ? false : proxied });
    }

    // (d) banco
    const ids = Object.fromEntries(names.map((n) => [n, rw[n].id]));
    await db.run('UPDATE domains SET railway_ids = ?, railway_status = ?, railway_verified = 0, status = ?, provider_error = NULL, warning = ?, next_check_at = ? WHERE id = ?',
      [JSON.stringify(ids), String(rw[h].status?.certificateStatus || 'pendente'), 'pending', warnings.join(' ') || null, now() + (zone.status === 'active' ? 0 : CHECK_EVERY.pending), id]);
    if (zone.status === 'active') await checkDomain(id).catch(() => {});
  } catch (err) {
    const left = [];
    for (const rid of [...created.railway].reverse()) await railway.deleteCustomDomain(rid).catch((e) => { if (!isNotFound(e)) left.push(`Railway (${rid}): ${e.message}`); });
    if (created.zone) await cf.deleteZone(created.zone).catch((e) => { if (!isNotFound(e)) left.push(`Cloudflare (zona ${h}): ${e.message}`); });
    await db.run('DELETE FROM domains WHERE id = ?', [id]);
    invalidateDomains();
    const tail = left.length ? ` ATENÇÃO: não foi possível desfazer tudo (${left.join('; ')}); remova à mão.` : ' Nada ficou criado: corrija e tente de novo.';
    console.warn(`[domínios] cadastro de ${h} falhou: ${err.message}${left.length ? ` | sobrou: ${left.join('; ')}` : ''}`);
    throw Object.assign(new Error(`Não foi possível configurar ${h}: ${err.message}${tail}`), { status: err.status && err.status < 500 ? err.status : 502 });
  }
}

const clean = (v) => String(v).replace(/\.$/, '').toLowerCase();
const notFoundCode = (e) => ['ENODATA', 'ENOTFOUND', 'ENOENT', 'ESERVFAIL'].includes(e?.code);

/** MODO MANUAL: confere o DNS — TXT `_nexa-verify.<host>` com o token OU CNAME do host apontando para PLATFORM_HOST. */
export async function verifyDomain(id) {
  const row = await getDomain(id);
  if (!row) throw fail(404, 'Domínio inexistente.');
  if (row.mode === 'auto') return checkDomain(id, { force: true });
  let ok = false;
  const problems = [];
  try {
    const txt = await resolver.resolveTxt(`${VERIFY_PREFIX}.${row.hostname}`);
    ok = txt.some((rec) => (Array.isArray(rec) ? rec.join('') : String(rec)).trim() === row.verify_token);
    if (!ok) problems.push('o TXT existe, mas o valor não confere');
  } catch (e) { if (!notFoundCode(e)) problems.push(`falha ao consultar o TXT (${e.code || e.message})`); else problems.push('TXT não encontrado'); }
  const own = platformHost();
  if (!ok && own) {
    try {
      const names = await resolver.resolveCname(row.hostname);
      ok = names.some((n) => clean(n) === own);
      if (!ok) problems.push(`o CNAME aponta para outro destino (${names.map(clean).join(', ')})`);
    } catch (e) { problems.push(notFoundCode(e) ? 'CNAME não encontrado' : `falha ao consultar o CNAME (${e.code || e.message})`); }
  }
  const ts = Date.now();
  if (ok) await db.run("UPDATE domains SET status = 'verified', verified_at = ?, last_check_at = ?, last_error = NULL WHERE id = ?", [ts, ts, id]);
  else {
    const how = `Crie o registro TXT ${VERIFY_PREFIX}.${row.hostname} com o valor ${row.verify_token}${own ? ` ou um CNAME de ${row.hostname} para ${own}` : ''}.`;
    await db.run("UPDATE domains SET status = 'failed', last_check_at = ?, last_error = ? WHERE id = ?", [ts, `${problems.join('; ')}. ${how}`.slice(0, 500), id]);
  }
  invalidateDomains();
  return domainDto(await getDomain(id));
}

const lastActivation = new Map(); // zona -> instante do último activation_check (limite da Cloudflare)

/**
 * Consulta os provedores e atualiza a situação ("verificar agora" e tarefa periódica). Modo manual: verificação por DNS.
 * Automático: zona pending -> pede activation_check (no máx. 1/h); zona active -> Railway: certificado emitido ->
 * 'verified' (ativo), senão 'dns_active'. Falha de rede/provedor: guarda o erro e mantém a situação.
 */
export async function checkDomain(id, { force = false } = {}) {
  const row = await getDomain(id);
  if (!row) throw fail(404, 'Domínio inexistente.');
  if (row.mode !== 'auto') return verifyDomain(id);
  const ts = now();
  const save = async (fields) => {
    const keys = Object.keys(fields);
    await db.run(`UPDATE domains SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => fields[k]), id]);
    invalidateDomains();
    return domainDto(await getDomain(id));
  };
  const hard = (msg) => save({ status: 'error', provider_error: msg.slice(0, 500), last_check_at: ts, next_check_at: ts + CHECK_EVERY.error, verified_at: null });
  const soft = (e) => save({ provider_error: `Falha temporária ao consultar os provedores: ${e.message}`.slice(0, 500), last_check_at: ts, next_check_at: ts + CHECK_EVERY.transient });
  if (!autoMode()) return save({ provider_error: 'As integrações da Cloudflare e do Railway não estão configuradas neste servidor.', last_check_at: ts, next_check_at: ts + CHECK_EVERY.error });
  if (!row.cf_zone_id) return hard('O domínio não tem zona na Cloudflare. Remova e adicione de novo.');

  let zone;
  try { zone = await cf.getZone(row.cf_zone_id); } catch (e) {
    if (isNotFound(e)) return hard('A zona deste domínio não existe mais na Cloudflare. Remova o domínio e adicione de novo.');
    return soft(e);
  }
  const fields = { cf_status: zone?.status || null, last_check_at: ts };
  const ns = (zone?.name_servers || []).slice(0, 2);
  if (ns.length) fields.name_servers = JSON.stringify(ns);
  if (zone?.status === 'moved') return save({ ...fields, status: 'error', verified_at: null, next_check_at: ts + CHECK_EVERY.error, provider_error: 'Os servidores DNS do domínio deixaram de apontar para a Cloudflare. No Registro.br, volte a colocar os dois servidores DNS indicados.' });
  if (zone?.status !== 'active') {
    const last = lastActivation.get(row.cf_zone_id) || 0;
    if (force || ts - last >= ACTIVATION_EVERY) {
      lastActivation.set(row.cf_zone_id, ts);
      await cf.activationCheck(row.cf_zone_id).catch(() => {}); // limitado pela Cloudflare (1/h em zona Free): erro não importa
    }
    return save({ ...fields, status: 'pending', verified_at: null, provider_error: null, next_check_at: ts + CHECK_EVERY.pending });
  }

  // zona ativa: Railway (certificado do domínio). "verificar agora" também reaplica os registros que o Railway pede.
  const ids = parseIds(row.railway_ids);
  let issued = false; let failed = null; let certText = null; let wwwNote = null;
  try {
    for (const n of namesOf(row)) {
      if (!ids[n]) return hard(`${n} não tem domínio no Railway. Remova o domínio e adicione de novo.`);
      let cd;
      try { cd = await railway.getCustomDomain(ids[n]); } catch (e) {
        if (isNotFound(e)) return hard(`${n} não está mais no serviço do Railway. Remova o domínio e adicione de novo.`);
        throw e;
      }
      if (force) for (const r of railway.requiredRecords(cd, row.hostname)) await cf.ensureRecord(row.cf_zone_id, { ...r, proxied: r.type === 'TXT' ? false : cf.proxiedDefault() });
      const ok = railway.certificateIssued(cd);
      if (n === row.hostname) { issued = ok; certText = cd?.status?.certificateStatus || null; if (railway.certificateFailed(cd)) failed = `O Railway não conseguiu emitir o certificado de ${n} (${certText}).`; } else if (!ok) wwwNote = `${n} ainda sem certificado`;
    }
  } catch (e) { return soft(e); }
  if (failed) return save({ ...fields, railway_verified: 0, railway_status: certText, status: 'dns_active', provider_error: `${failed} Tente "Verificar agora"; se persistir, desligue o proxy (CLOUDFLARE_PROXIED=0) ou veja o painel do Railway.`, verified_at: null, next_check_at: ts + CHECK_EVERY.dns_active });
  const active = issued;
  return save({
    ...fields, railway_verified: issued ? 1 : 0,
    railway_status: `${certText || 'sem status'}${wwwNote ? `; ${wwwNote}` : ''}`,
    status: active ? 'verified' : 'dns_active', provider_error: null,
    verified_at: active ? (row.status === 'verified' && row.verified_at ? row.verified_at : ts) : null,
    next_check_at: ts + (active ? CHECK_EVERY.verified : CHECK_EVERY.dns_active),
  });
}

/* ------------------------------------------------------------------ remoção */
async function legacySaasRemove(row) {
  const token = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const zone = (process.env.CLOUDFLARE_ZONE_ID || '').trim();
  if (!token || !zone || !row.cf_id) return;
  const base = (process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4').replace(/\/+$/, '');
  await requestJson({ provider: 'Cloudflare', method: 'DELETE', token, url: `${base}/zones/${encodeURIComponent(zone)}/custom_hostnames/${encodeURIComponent(row.cf_id)}` });
}

/**
 * Remove: automático -> tira do Railway e APAGA a zona na Cloudflare, depois apaga do banco. Se um provedor falhar o domínio
 * continua cadastrado (502, tente de novo: o que já saiu é ignorado), exceto com force (exclusão do cliente), que apaga mesmo
 * assim e devolve o aviso.
 */
export async function removeDomain(id, { force = false } = {}) {
  const row = await getDomain(id);
  if (!row) throw fail(404, 'Domínio inexistente.');
  const problems = [];
  if (row.mode === 'auto') {
    const ids = parseIds(row.railway_ids);
    if (railway.configured()) {
      for (const n of [...namesOf(row)].reverse()) {
        if (ids[n]) await railway.deleteCustomDomain(ids[n]).catch((e) => { if (!isNotFound(e)) problems.push(`Railway ${n}: ${e.message}`); });
      }
    } else if (Object.keys(ids).length) problems.push('Railway não configurado: o domínio não foi tirado do serviço');
    // a zona só é apagada depois que o Railway soltou o domínio (ou na exclusão forçada do cliente)
    if (row.cf_zone_id && (!problems.length || force)) {
      if (cf.configured()) await cf.deleteZone(row.cf_zone_id).catch((e) => { if (!isNotFound(e)) problems.push(`Cloudflare: ${e.message}`); });
      else problems.push('Cloudflare não configurada: a zona não foi apagada');
    }
    if (problems.length && !force) {
      await db.run('UPDATE domains SET provider_error = ? WHERE id = ?', [`Remoção incompleta: ${problems.join('; ')}`.slice(0, 500), id]);
      throw fail(502, `Não foi possível remover ${row.hostname} em todos os provedores: ${problems.join('; ')}. O domínio continua cadastrado; tente de novo.`);
    }
  } else if (row.cf_id) {
    await legacySaasRemove(row).catch((e) => problems.push(`Cloudflare: ${e.message}`));
  }
  const warning = problems.length ? problems.join('; ') : null;
  if (warning) console.warn(`[domínios] remoção de ${row.hostname} com aviso: ${warning}`);
  await db.run('DELETE FROM domains WHERE id = ?', [id]);
  invalidateDomains();
  return { ok: true, warning };
}

/** Apaga todos os domínios de um cliente (exclusão do cliente). Tenta limpar os provedores, sem falhar por eles. */
export async function removeTenantDomains(tenantId) {
  for (const r of await db.all('SELECT id FROM domains WHERE tenant_id = ?', [tenantId])) await removeDomain(r.id, { force: true }).catch(() => {});
  invalidateDomains();
}

/* ------------------------------------------------------------------ acompanhamento automático */
let running = false;
/** Checa os domínios automáticos com checagem vencida (no máx. 25 por rodada). Devolve as mudanças de situação. */
export async function runDomainMonitor(ts = now()) {
  if (running) return [];
  running = true;
  const changes = [];
  try {
    if (!autoMode()) return changes;
    const rows = await db.all("SELECT id, hostname, status FROM domains WHERE mode = 'auto' AND (next_check_at IS NULL OR next_check_at <= ?) ORDER BY id LIMIT 25", [ts]);
    for (const r of rows) {
      try {
        const d = await checkDomain(r.id);
        if (d.status !== r.status) { changes.push({ id: r.id, hostname: r.hostname, from: r.status, to: d.status }); console.log(`[domínios] ${r.hostname}: ${r.status} -> ${d.status}`); }
      } catch (e) { console.warn(`[domínios] checar ${r.hostname}: ${e.message}`); }
    }
  } finally {
    running = false;
    await refreshActiveHosts().catch(() => {});
  }
  return changes;
}

let monitorTimer = null;
/** Roda agora e a cada minuto (cada domínio tem a própria próxima checagem). Timer sem segurar o processo. */
export function startDomainMonitor(everyMs = 60_000) {
  const tick = () => runDomainMonitor().catch((e) => console.error('[domínios] acompanhamento:', e.message));
  refreshActiveHosts().catch(() => {});
  tick();
  clearInterval(monitorTimer);
  monitorTimer = setInterval(tick, everyMs);
  monitorTimer.unref();
  return monitorTimer;
}
export const stopDomainMonitor = () => clearInterval(monitorTimer);
