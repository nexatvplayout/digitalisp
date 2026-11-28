// Funcionalidades por plano no servidor (docs/PLATAFORMA.md, "Funcionalidades por plano"): as guardas das rotas tiradas do
// catálogo (public/shared/funcionalidades.js), a guarda da configuração do canal, o filtro das tarefas de fundo, os perfis de
// funcionalidades do Superadmin (/api/platform/feature-profiles) e os 3 planos sugeridos (rascunhos inativos, com o preço do site).
//
// A guarda das rotas é UMA só (createPlanGate, montada em server/index.js antes das rotas): o catálogo diz quais rotas cada
// funcionalidade guarda e o cliente de cada pedido é resolvido como a própria rota resolve (o canal pelo endereço; senão o
// cliente do token e o do pedido público, ?tenant= / domínio). Ela só RECUSA (403 feature_unavailable, o mesmo do feature()
// de sempre, com o atalho para "Plano e uso" no painel); a permissão do usuário continua com o needs() de cada rota.
import * as CAT from '../public/shared/funcionalidades.js';
import * as T from './tenancy.js';
import { db, getSetting, setSetting } from './db.js';
import { config } from './config.js';

export { CAT };
const { fail } = T;

/* ------------------------------------------------------------------ as guardas das rotas */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "MÉTODOS CAMINHO" do catálogo -> { methods: Set|null, re }. Ver a legenda em public/shared/funcionalidades.js. */
export function compileRoute(spec) {
  const m = String(spec).trim().match(/^(\S+)\s+(\S+)$/);
  if (!m) throw new Error(`rota do catálogo inválida: ${spec}`);
  const methods = m[1] === '*' ? null : new Set(m[1].toUpperCase().split('|'));
  let p = m[2];
  let prefix = false;
  if (p.endsWith('*')) { prefix = true; p = p.slice(0, -1); if (p.endsWith('/')) p = p.slice(0, -1); }
  let re = '';
  if (p.startsWith('[ch]')) { re += '/api(?:/c/(?<ch>[^/]+))?'; p = p.slice(4); }
  for (const seg of p.split('/').filter(Boolean)) {
    if (seg === '{ch}') re += '/(?<ch>[^/]+)';
    else if (seg.startsWith(':')) re += '/[^/]+';
    else re += `/${esc(seg)}`;
  }
  re += prefix ? '(?:/.*)?' : '/?';
  return { methods, re: new RegExp(`^${re}$`, 'i') };
}
const bodyHas = (body, want) => Object.entries(want).some(([k, list]) => body && typeof body === 'object' && list.some((v) => body[k] === v));

/** Todas as regras do catálogo, compiladas: [{ key, spec, methods, re, body, bodyNot }]. */
export const RULES = CAT.FEATURES.flatMap((f) => [...(f.routes || []).map((r) => [r, false]), ...(f.clienteRoutes || []).map((r) => [r, true])].map(([r, soCliente]) => {
  const o = typeof r === 'string' ? { r } : r;
  // soCliente: a regra só vale para o plano do cliente final (clienteRoutes no catálogo)
  return { key: f.key, spec: o.r, ...compileRoute(o.r), body: o.body || null, bodyNot: o.bodyNot || null, soCliente };
}));
/** Primeiro trecho dos caminhos guardados (api, prompter, cg-out…): o resto dos pedidos passa direto. */
const HEADS = new Set(RULES.map((r) => (r.spec.split(/\s+/)[1].startsWith('[ch]') ? 'api' : r.spec.split(/\s+/)[1].split('/')[1].toLowerCase())));

/** As funcionalidades que o pedido toca: [{ key, slug }] (slug: o canal do endereço, quando a regra tem). */
export function routeHits(method, path, body) {
  const m = method === 'HEAD' ? 'GET' : String(method).toUpperCase();
  const out = [];
  for (const r of RULES) {
    if (r.methods && !r.methods.has(m)) continue;
    const x = r.re.exec(path);
    if (!x) continue;
    if (r.body && !bodyHas(body, r.body)) continue;
    if (r.bodyNot && bodyHas(body, r.bodyNot)) continue;
    let slug = x.groups?.ch || null;
    if (slug) { try { slug = decodeURIComponent(slug); } catch { /* como veio */ } }
    out.push({ key: r.key, slug, soCliente: r.soCliente });
  }
  return out;
}

/**
 * Middleware da guarda (antes das rotas, depois do parser de JSON). deps: channelTenant(slug) -> id do cliente do canal ou
 * null; peekTenantId(req) -> cliente do token (sem validar o usuário; o needs() valida depois); resolveTenant(req, opts) ->
 * o cliente do pedido público (o de pubTenant e do roteador dos canais).
 */
export function createPlanGate({ channelTenant, peekTenantId, resolveTenant }) {
  return async (req, res, next) => {
    try {
      if (req.method === 'OPTIONS') return next();
      const head = String(req.path.split('/')[1] || '').toLowerCase();
      if (!HEADS.has(head)) return next();
      const hits = routeHits(req.method, req.path, req.body);
      if (!hits.length) return next();
      const tok = peekTenantId(req);
      let pub; // o cliente do pedido público, só quando preciso
      const seen = new Set();
      for (const h of hits) {
        // o Painel da Prefeitura é sempre com sessão: sem token, a própria rota responde 401 (não o plano do cliente padrão)
        if (h.key === 'prefeitura' && tok == null) continue;
        let tids;
        if (h.slug) {
          const ct = channelTenant(h.slug);
          if (ct == null) continue; // canal inexistente: a rota responde
          if (tok != null && Number(tok) !== Number(ct)) continue; // canal de outro cliente: a rota recusa (sem contar o plano dele)
          tids = [Number(ct)];
        } else {
          if (pub === undefined) pub = await resolveTenant(req, { tokenTid: tok }).then((t) => t?.id ?? null, () => null);
          // o do token E o do pedido: um ?tenant= de outro cliente não fura a guarda do próprio plano
          tids = [...new Set([tok, pub].filter((x) => x != null).map(Number))];
        }
        for (const tid of tids) {
          if (seen.has(`${tid}|${h.key}`)) continue;
          seen.add(`${tid}|${h.key}`);
          const t = await T.getTenant(tid);
          if (!t) continue;
          const plan = await T.effectivePlan(t);
          if (h.soCliente && !String(plan.code || '').startsWith('cliente-')) continue; // só o plano do cliente final
          if (!plan.features[h.key]) {
            const e = T.featureError(plan, h.key);
            return res.status(403).json({ error: e.message, ...e.extra });
          }
        }
      }
      next();
    } catch (err) { next(err); }
  };
}

/* ------------------------------------------------------------------ a configuração do canal (PUT /config) */
const getPath = (o, path) => path.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o);
function delPath(o, path) {
  const ks = path.split('.');
  let v = o;
  for (const k of ks.slice(0, -1)) { if (!v || typeof v !== 'object') return; v = v[k]; }
  if (v && typeof v === 'object') delete v[ks[ks.length - 1]];
}
const hasPath = (o, path) => {
  const ks = path.split('.');
  let v = o;
  for (const k of ks.slice(0, -1)) { if (!v || typeof v !== 'object') return false; v = v[k]; }
  return Boolean(v) && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, ks[ks.length - 1]);
};
/** Corpo sem nada que mude (só objetos vazios). */
export const emptyDeep = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.values(v).every(emptyDeep) : v === undefined);

/**
 * As chaves da configuração que só LIGAM com a funcionalidade (catálogo: config). Ligar sem o plano: a chave sai do corpo e
 * vai para refused (o resto do pedido vale, como o SCTE-35 do Aplicar da tela de Áudio); desligar sempre pode, e o que já
 * estava ligado e veio igual não conta como mudança. Devolve { body, refused: [{key, code, error}], error } (error: o 403
 * para quando não sobrou nada no pedido).
 */
export async function gateConfig(tenantId, body, cur) {
  const plan = await T.effectivePlan(await T.getTenant(tenantId));
  let out = body;
  const refused = [];
  let error = null;
  for (const f of CAT.FEATURES) {
    if (!f.config || plan.features[f.key]) continue;
    for (const p of f.config) {
      if (!hasPath(body, p)) continue;
      if (!getPath(body, p) || Boolean(getPath(cur, p))) continue; // desligando, ou já estava ligado
      if (out === body) out = structuredClone(body);
      delPath(out, p);
      const e = T.featureError(plan, f.key);
      error ||= e;
      if (!refused.some((r) => r.key === f.key)) refused.push({ key: f.key, code: 'feature_unavailable', error: e.message });
    }
  }
  return { body: out, refused, error: refused.length && emptyDeep(out) ? error : null };
}

/* ------------------------------------------------------------------ tarefas de fundo */
/** Só os clientes com a funcionalidade (Set de ids): as tarefas de fundo não trabalham para quem não tem. */
export async function withFeature(ids, key) {
  const out = new Set();
  for (const id of ids || []) if (await T.hasFeature(Number(id), key).catch(() => false)) out.add(Number(id));
  return out;
}

/* ------------------------------------------------------------------ app do espectador */
/** As chaves de "features" do app (site, celular, TVs) que o plano desliga: { chave: false }. */
export function appMask(features) {
  const out = {};
  for (const f of CAT.FEATURES) {
    if (features?.[f.key]) continue;
    for (const k of f.app || []) if (/^[a-z][a-zA-Z0-9]*$/.test(k)) out[k] = false;
  }
  return out;
}

/* ------------------------------------------------------------------ perfis de funcionalidades */
const CODE_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const slugCode = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const j = (s, d) => { try { const v = s ? JSON.parse(s) : d; return v ?? d; } catch { return d; } };

/** Só as escolhíveis, coerentes (as sempre incluídas não se gravam: valem sempre). */
export const storedFeatures = (input) => {
  const r = T.cleanFeatures(input);
  return Object.fromEntries(CAT.FEATURE_KEYS.map((k) => [k, Boolean(r[k])]));
};

/** Planos e clientes de cada perfil: { profileId: { plans: [...], tenants: n, tenantList: [...] } }. */
async function usageByProfile() {
  const plans = await db.all('SELECT id, code, name, active, profile_id FROM plans WHERE profile_id IS NOT NULL');
  const tenants = await db.all('SELECT t.id, t.slug, t.name, t.status, t.plan_id FROM tenants t JOIN plans p ON p.id = t.plan_id WHERE p.profile_id IS NOT NULL ORDER BY t.id');
  const out = new Map();
  const of = (pid) => { if (!out.has(pid)) out.set(pid, { plans: [], tenants: 0, tenantList: [] }); return out.get(pid); };
  const planProfile = new Map(plans.map((p) => [Number(p.id), Number(p.profile_id)]));
  for (const p of plans) of(Number(p.profile_id)).plans.push({ id: Number(p.id), code: p.code, name: p.name, active: Boolean(p.active) });
  for (const t of tenants) {
    const u = of(planProfile.get(Number(t.plan_id)));
    u.tenants++;
    if (u.tenantList.length < 50) u.tenantList.push({ id: Number(t.id), slug: t.slug, name: t.name, status: t.status });
  }
  return out;
}
const emptyUse = () => ({ plans: [], tenants: 0, tenantList: [] });

export async function listProfiles() {
  const rows = await db.all('SELECT * FROM feature_profiles ORDER BY sort, id');
  const use = await usageByProfile();
  return rows.map((r) => ({ ...T.profileDto(r), ...(use.get(Number(r.id)) || emptyUse()) }));
}
export async function getProfile(id) {
  const row = await db.get('SELECT * FROM feature_profiles WHERE id = ?', [Number(id)]);
  if (!row) return null;
  return { ...T.profileDto(row), ...((await usageByProfile()).get(Number(row.id)) || emptyUse()) };
}

function profileInput(b, cur = null) {
  const out = {};
  if (!cur || b.name !== undefined) { const n = text(b.name, 60); if (n.length < 2) throw fail(400, 'Nome do perfil: 2 a 60 caracteres.'); out.name = n; }
  if (!cur || b.code !== undefined) {
    const code = String(b.code ?? '').trim().toLowerCase() || slugCode(out.name || cur?.name);
    if (!CODE_RE.test(code)) throw fail(400, 'Código do perfil: 2 a 40 caracteres (letras minúsculas, números, hífen e sublinhado).');
    out.code = code;
  }
  if (b.description !== undefined) out.description = text(b.description, 300);
  if (b.features !== undefined) {
    if (!b.features || typeof b.features !== 'object' || Array.isArray(b.features)) throw fail(400, 'Funcionalidades: envie um objeto { chave: true/false }.');
    // perfil novo: o que não veio fica FORA (o perfil é escolhido 1 a 1); a regra legacy é só para os planos antigos
    out.features = JSON.stringify(storedFeatures({ ...Object.fromEntries(CAT.FEATURE_KEYS.map((k) => [k, false])), ...(cur ? j(cur.features, {}) : {}), ...b.features }));
  } else if (!cur) out.features = JSON.stringify(storedFeatures(Object.fromEntries(CAT.FEATURE_KEYS.map((k) => [k, false]))));
  if (b.sort !== undefined) { const s = Number(b.sort); if (!Number.isInteger(s)) throw fail(400, 'Ordem (sort): número inteiro.'); out.sort = s; }
  return out;
}

export async function createProfile(b) {
  const f = profileInput(b || {});
  if (await db.get('SELECT id FROM feature_profiles WHERE code = ?', [f.code])) throw fail(409, 'Já existe um perfil com esse código.');
  const ts = Date.now();
  const id = await db.insert('INSERT INTO feature_profiles(code,name,description,features,sort,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
    [f.code, f.name, f.description ?? '', f.features, f.sort ?? 0, ts, ts]);
  T.invalidateTenants();
  return getProfile(id);
}

/**
 * Altera o perfil. Mudar as funcionalidades de um perfil em uso muda o que os clientes dos planos dele veem: sem confirm,
 * 409 { code: 'confirm_required', affected: { plans, tenants } } (o Superadmin mostra quantos e pede a confirmação).
 */
export async function updateProfile(id, b, { confirm = false } = {}) {
  const cur = await db.get('SELECT * FROM feature_profiles WHERE id = ?', [Number(id)]);
  if (!cur) throw fail(404, 'Perfil inexistente.');
  const f = profileInput(b || {}, cur);
  if (f.code && f.code !== cur.code && await db.get('SELECT id FROM feature_profiles WHERE code = ? AND id <> ?', [f.code, cur.id])) throw fail(409, 'Já existe um perfil com esse código.');
  const changes = f.features !== undefined && f.features !== JSON.stringify(storedFeatures(j(cur.features, {})));
  if (changes && !confirm) {
    const u = (await usageByProfile()).get(Number(cur.id)) || emptyUse();
    if (u.tenants > 0) {
      const err = fail(409, `Este perfil está em ${u.plans.length} plano(s) com ${u.tenants} cliente(s): a mudança vale na hora para todos eles. Confirme para salvar.`, {
        code: 'confirm_required', extra: { code: 'confirm_required', affected: { plans: u.plans, tenants: u.tenants, tenantList: u.tenantList }, diff: diffFeatures(j(cur.features, {}), j(f.features, {})) },
      });
      throw err;
    }
  }
  const keys = Object.keys(f);
  if (keys.length) await db.run(`UPDATE feature_profiles SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...keys.map((k) => f[k]), Date.now(), cur.id]);
  T.invalidateTenants();
  return { profile: await getProfile(cur.id), changedFeatures: changes ? diffFeatures(j(cur.features, {}), j(f.features, {})) : null };
}

/** O que muda entre dois conjuntos: { on: [chaves que passam a valer], off: [que deixam de valer] } (já resolvidos). */
export function diffFeatures(a, b) {
  const x = T.cleanFeatures(a); const y = T.cleanFeatures(b);
  return { on: CAT.FEATURE_KEYS.filter((k) => !x[k] && y[k]), off: CAT.FEATURE_KEYS.filter((k) => x[k] && !y[k]) };
}

export async function duplicateProfile(id, b = {}) {
  const cur = await db.get('SELECT * FROM feature_profiles WHERE id = ?', [Number(id)]);
  if (!cur) throw fail(404, 'Perfil inexistente.');
  let code = String(b.code || '').trim().toLowerCase();
  if (!code) {
    const base = `${cur.code}-copia`.slice(0, 36);
    code = base;
    for (let i = 2; await db.get('SELECT id FROM feature_profiles WHERE code = ?', [code]); i++) code = `${base}-${i}`;
  }
  return createProfile({ code, name: b.name || `${cur.name} (cópia)`.slice(0, 60), description: cur.description, features: j(cur.features, {}), sort: Number(cur.sort) || 0 });
}

export async function deleteProfile(id) {
  const cur = await db.get('SELECT * FROM feature_profiles WHERE id = ?', [Number(id)]);
  if (!cur) throw fail(404, 'Perfil inexistente.');
  const plans = await db.all('SELECT code, name FROM plans WHERE profile_id = ?', [cur.id]);
  if (plans.length) throw fail(409, `O perfil está em ${plans.length} plano(s) (${plans.map((p) => p.name).join(', ')}). Troque o perfil desses planos (ou deixe-os com funcionalidades próprias) antes de excluir.`, { code: 'in_use', extra: { code: 'in_use', plans } });
  await db.run('DELETE FROM feature_profiles WHERE id = ?', [cur.id]);
  T.invalidateTenants();
  return cur;
}

/** Rotas do Superadmin (dentro do roteador /api/platform; A = needsPlatform). Ler: platform.view; mudar: platform.plans. */
export function mountFeatureProfiles(r, { A, ah, aud }) {
  const idOf = (req) => { const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) throw fail(400, 'Id inválido.'); return id; };
  r.get('/feature-profiles', A('platform.view'), ah(async (_req, res) => res.json(await listProfiles())));
  r.get('/feature-profiles/:id', A('platform.view'), ah(async (req, res) => {
    const p = await getProfile(idOf(req));
    if (!p) throw fail(404, 'Perfil inexistente.');
    res.json(p);
  }));
  r.post('/feature-profiles', A('platform.plans'), ah(async (req, res) => {
    const p = await createProfile(req.body || {});
    aud(res, null, `criou o perfil de funcionalidades ${p.code}`);
    res.status(201).json(p);
  }));
  r.patch('/feature-profiles/:id', A('platform.plans'), ah(async (req, res) => {
    const out = await updateProfile(idOf(req), req.body || {}, { confirm: req.body?.confirm === true });
    const d = out.changedFeatures;
    aud(res, null, `alterou o perfil de funcionalidades ${out.profile.code}${d ? ` (liberou: ${d.on.join(', ') || 'nada'}; tirou: ${d.off.join(', ') || 'nada'}; ${out.profile.tenants} cliente(s))` : ''}`.slice(0, 300));
    res.json({ ...out.profile, changedFeatures: d });
  }));
  r.post('/feature-profiles/:id/duplicate', A('platform.plans'), ah(async (req, res) => {
    const p = await duplicateProfile(idOf(req), req.body || {});
    aud(res, null, `duplicou o perfil de funcionalidades #${req.params.id} como ${p.code}`);
    res.status(201).json(p);
  }));
  r.delete('/feature-profiles/:id', A('platform.plans'), ah(async (req, res) => {
    const cur = await deleteProfile(idOf(req));
    aud(res, null, `excluiu o perfil de funcionalidades ${cur.code}`);
    res.json({ ok: true });
  }));
}

/* ------------------------------------------------------------------ os 3 planos de revenda sugeridos (rascunhos) */
// Planos do DIGITAL ISP: o principal é o número de telas. Preços em branco (o dono ainda não definiu): nascem inativos.
const GB = 1024;
const on = (...keys) => Object.fromEntries(keys.map((k) => [k, true]));
const INICIAL = on('mapa', 'alertas', 'aprovacao', 'templates', 'dados', 'paginas', 'marcaPropria');
const PROFISSIONAL = { ...INICIAL, ...on('aoVivo', 'indicadores', 'rh', 'celular', 'senhas', 'relatorioAnunciante', 'avisosWhatsapp') };
const COMPLETO = Object.fromEntries(CAT.FEATURE_KEYS.map((k) => [k, !CAT.BY_KEY[k].optIn])); // tudo, menos os modos especiais
export const DRAFTS = [
  { code: 'revenda-inicial', name: 'Revenda Inicial', sort: 10, priceCents: 0, features: INICIAL,
    description: 'Até 50 telas e 20 clientes finais: telas, mapa, alertas, aprovação, templates, notícias e clima, páginas e marca própria.',
    limits: { telas: 50, clientes: 20, users: 5, storageMB: 20 * GB } },
  { code: 'revenda-profissional', name: 'Revenda Profissional', sort: 20, priceCents: 0, features: PROFISSIONAL,
    description: 'Até 200 telas e 100 clientes finais: o Inicial + ao vivo, indicadores, RH, envio pelo celular, senhas, relatório para anunciante e WhatsApp.',
    limits: { telas: 200, clientes: 100, users: 15, storageMB: 100 * GB } },
  { code: 'revenda-completa', name: 'Revenda Completa', sort: 30, priceCents: 0, features: COMPLETO,
    description: 'Até 1.000 telas e clientes finais sem limite: todos os módulos, inclusive a API e os webhooks.',
    limits: { telas: 1000, clientes: null, users: 50, storageMB: 500 * GB } },
];
/** Rascunhos do NEXA Broadcast que o primeiro boot do DIGITAL ISP chegou a criar: saem se ninguém os usa. */
const NEXA_DRAFTS = ['essencial', 'profissional', 'broadcast'];
const SEED_KEY = 'feature_profiles_seeded_digitalisp';

/**
 * Cria UMA vez os 3 perfis e os 3 planos sugeridos: inativos, privados, com o preço do site (R$ 990 / 1.990 / 3.490 por mês), 1 canal, cada plano
 * ligado ao seu perfil. Código já usado: aquele fica como está. A marca em settings impede que voltem depois de apagados.
 */
export async function seedDrafts() {
  if (config.edge?.enabled) return { seeded: false }; // edição Windows: o plano vem da licença da central
  if ((await getSetting(SEED_KEY, '')) === '1') return { seeded: false };
  // limpeza única: os rascunhos do NEXA (inativos, sem revenda e criados pela semeadura antiga) saem com o perfil deles
  for (const code of NEXA_DRAFTS) {
    const p = await db.get('SELECT id, active FROM plans WHERE code = ?', [code]);
    if (p && !Number(p.active) && !(await db.get('SELECT id FROM tenants WHERE plan_id = ? LIMIT 1', [p.id]))) await db.run('DELETE FROM plans WHERE id = ?', [p.id]);
    const fp = await db.get('SELECT id FROM feature_profiles WHERE code = ?', [code]);
    if (fp && !(await db.get('SELECT id FROM plans WHERE profile_id = ? LIMIT 1', [fp.id]))) await db.run('DELETE FROM feature_profiles WHERE id = ?', [fp.id]);
  }
  const ts = Date.now();
  const made = { profiles: [], plans: [] };
  for (const d of DRAFTS) {
    let prof = await db.get('SELECT * FROM feature_profiles WHERE code = ?', [d.code]);
    if (!prof) {
      const id = await db.insert('INSERT INTO feature_profiles(code,name,description,features,sort,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
        [d.code, d.name, d.description, JSON.stringify(storedFeatures({ ...Object.fromEntries(CAT.FEATURE_KEYS.map((k) => [k, false])), ...d.features })), d.sort, ts, ts]);
      prof = { id };
      made.profiles.push(d.code);
    }
    if (!(await db.get('SELECT id FROM plans WHERE code = ?', [d.code]))) {
      await db.insert('INSERT INTO plans(code,name,description,price_cents,currency,interval,trial_days,limits,features,active,public,sort,gateway_refs,created_at,profile_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [d.code, d.name, `${d.description} Rascunho sugerido com o preço do site: revise e ative.`.slice(0, 300), d.priceCents || 0, 'brl', 'month', 0, JSON.stringify(T.cleanLimits(d.limits)),
          JSON.stringify(storedFeatures({ ...Object.fromEntries(CAT.FEATURE_KEYS.map((k) => [k, false])), ...d.features })), 0, 0, d.sort, '{}', ts, Number(prof.id)]);
      made.plans.push(d.code);
    }
  }
  await setSetting(SEED_KEY, '1');
  T.invalidateTenants();
  if (made.profiles.length || made.plans.length) console.log(`[plataforma] Planos de revenda sugeridos criados (${made.plans.join(', ') || 'nenhum'}), inativos e sem preço: revise e ative no superadmin.`);
  return { seeded: true, ...made };
}
