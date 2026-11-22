// Área da plataforma (equipe DIGITAL ISP): login da equipe, revendas e planos das revendas.
// Base enxuta tirada do server/platform.js do NEXA Broadcast (c51d2469), sem canal, mídia, censura nem cobrança.
// A cobrança (boleto e Pix pelo sistema, ou por fora) entra no passo 3 (PASSAGEM.md).
import express from 'express';
import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import * as access from './auth.js';
import { needsPlatform } from './auth.js';
import * as T from './tenancy.js';
import { PLATFORM_PERMISSIONS, checkPasswordPolicy, USERNAME_RE } from './authcore.js';
import { clientIp } from './clientip.js';
import { mountFeatureProfiles, storedFeatures } from './funcionalidades.js';
import { mountRevendas, saveExtras, loadExtras, extrasDto } from './revendas.js';

const { fail } = T;
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const idParam = (req) => { const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) throw fail(400, 'Id inválido.'); return id; };
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const randomPassword = () => {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...randomBytes(16)].map((b) => abc[b % abc.length]).join('');
};

async function tenantOr404(id) {
  const t = await T.getTenant(id);
  if (!t) throw fail(404, 'Revenda inexistente.');
  return t;
}

/** Telas, unidades (clientes finais) e usuários de cada revenda, numa consulta por tabela. */
/** Por revenda: as telas dela e dos clientes finais dela, quantos clientes finais e quantos usuários. */
const NAO_CLIENTE = "id NOT IN (SELECT tenant_id FROM isp_conta WHERE tipo = 'cliente')";
const REVENDA_DE = "COALESCE((SELECT c.revenda_id FROM isp_conta c WHERE c.tenant_id = x.tenant_id AND c.tipo = 'cliente'), x.tenant_id)";
async function countsByTenant() {
  const m = (rows) => new Map(rows.map((x) => [Number(x.r), Number(x.n)]));
  const [telas, unidades, usuarios] = await Promise.all([
    db.all(`SELECT ${REVENDA_DE} AS r, COUNT(*) AS n FROM telas_devices x WHERE x.revoked_at IS NULL GROUP BY 1`),
    db.all("SELECT revenda_id AS r, COUNT(*) AS n FROM isp_conta WHERE tipo = 'cliente' GROUP BY revenda_id"),
    db.all('SELECT tenant_id AS r, COUNT(*) AS n FROM users WHERE tenant_id IS NOT NULL GROUP BY tenant_id'),
  ]);
  return { telas: m(telas), unidades: m(unidades), usuarios: m(usuarios) };
}

export function mountPlataforma(app) {
  const r = express.Router();
  const A = (...p) => needsPlatform(...p);
  const aud = (res, tenantId, detail) => { if (tenantId != null) res.locals.auditTenant = tenantId; if (detail) res.locals.audit = detail; };

  /* ------------------------------------------------------------------ login e conta da equipe */
  const fails = new Map();
  r.post('/login', ah(async (req, res) => {
    const ip = clientIp(req);
    const recent = (fails.get(ip) || []).filter((t) => Date.now() - t < 10 * 60 * 1000);
    if (recent.length >= 20) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    try {
      res.json(await access.login(req.body?.username, req.body?.password, ip, { platform: true }));
    } catch (err) {
      if (err.status === 401) fails.set(ip, [...recent, Date.now()]);
      throw err;
    }
  }));
  r.get('/me', A(), (req, res) => res.json({ ...access.meDto(req.user), catalog: PLATFORM_PERMISSIONS.map(({ id, label, area }) => ({ id, label, area })), env: config.production ? 'production' : 'development' }));
  r.post('/me/password', A(), ah(async (req, res) => {
    res.locals.audit = 'troca da própria senha';
    res.json(await access.changeOwnPassword(req.user.id, req.body?.current, req.body?.next));
  }));
  r.post('/logout', ah(async (req, res) => {
    const user = await access.authenticate(req);
    if (!user) return res.json({ ok: true, revoked: false });
    if (!user.platform || user.impersonator) return res.status(403).json({ error: 'Esta rota é só da equipe da plataforma. Para sair do painel da revenda use POST /api/me/logout.', code: 'not_platform' });
    req.user = user;
    res.json({ ok: true, revoked: await access.revokeRequestToken(req) });
  }));

  /* ------------------------------------------------------------------ visão geral */
  r.get('/overview', A('platform.view'), ah(async (_req, res) => {
    const n = async (sql) => Number((await db.get(sql))?.n) || 0;
    res.json({
      revendas: await n(`SELECT COUNT(*) AS n FROM tenants WHERE ${NAO_CLIENTE}`),
      unidades: await n("SELECT COUNT(*) AS n FROM isp_conta WHERE tipo = 'cliente'"),
      telas: await n('SELECT COUNT(*) AS n FROM telas_devices WHERE revoked_at IS NULL'),
    });
  }));

  /* ------------------------------------------------------------------ revendas */
  r.get('/tenants', A('platform.view'), ah(async (req, res) => {
    const where = []; const args = [];
    if (req.query.status) { where.push('t.status = ?'); args.push(String(req.query.status)); }
    if (req.query.q) { const like = `%${text(req.query.q, 60).toLowerCase()}%`; where.push('(LOWER(t.name) LIKE ? OR LOWER(t.slug) LIKE ? OR LOWER(t.contact_email) LIKE ?)'); args.push(like, like, like); }
    where.push(`t.${NAO_CLIENTE}`); // os clientes finais aparecem dentro da revenda deles
    const rows = await db.all(`SELECT t.* FROM tenants t WHERE ${where.join(' AND ')} ORDER BY t.id`, args);
    const plans = new Map((await T.listPlans()).map((p) => [p.id, p]));
    const c = await countsByTenant();
    const ex = new Map((await db.all('SELECT * FROM isp_revenda')).map((x) => [Number(x.tenant_id), x]));
    res.json(rows.map((t) => ({
      ...T.tenantDto(t, plans.get(Number(t.plan_id))),
      ...extrasDto(ex.get(Number(t.id))),
      uso: { telas: c.telas.get(Number(t.id)) || 0, unidades: c.unidades.get(Number(t.id)) || 0, usuarios: c.usuarios.get(Number(t.id)) || 0 },
    })));
  }));

  async function uniqueSlug(base) {
    let slug = T.slugify(base) || 'revenda';
    if (slug.length < 2) slug = `${slug}-1`;
    for (let i = 1; await db.get('SELECT id FROM tenants WHERE slug = ?', [slug]); i++) slug = `${T.slugify(base).slice(0, 36)}-${i + 1}`;
    return slug;
  }

  r.post('/tenants', A('platform.tenants'), ah(async (req, res) => {
    const b = req.body || {};
    const name = text(b.name, 80);
    if (name.length < 2) throw fail(400, 'Informe o nome da revenda (2 a 80 caracteres).');
    const slug = b.slug ? T.validSlug(String(b.slug).trim().toLowerCase()) : await uniqueSlug(name);
    if (await db.get('SELECT id FROM tenants WHERE slug = ?', [slug])) throw fail(409, 'Já existe uma revenda com esse identificador.');
    const settings = await T.getPlatformSettings();
    const plan = await T.getPlanByCode(b.planCode || settings.defaultPlanCode);
    if (!plan || !plan.active) throw fail(400, 'Plano inexistente ou inativo.');
    const contactEmail = text(b.contactEmail, 120).toLowerCase();
    if (contactEmail && !EMAIL.test(contactEmail)) throw fail(400, 'E-mail de contato inválido.');
    const adminUsername = String(b.adminUsername || contactEmail || '').trim().toLowerCase();
    if (!USERNAME_RE.test(adminUsername)) throw fail(400, 'Informe o usuário do administrador da revenda (3 a 64 caracteres; pode ser um e-mail).');
    if (await db.get('SELECT id FROM users WHERE username = ?', [adminUsername])) throw fail(400, 'Já existe um usuário com esse nome (o usuário é único na plataforma).');
    const generated = !b.adminPassword;
    const adminPassword = generated ? randomPassword() : String(b.adminPassword);
    checkPasswordPolicy(adminPassword, { username: adminUsername, production: config.production });
    const status = b.status === 'active' ? 'active' : 'trial';
    const ts = T.now();
    const trialDays = plan.trialDays > 0 ? plan.trialDays : settings.trialDays;
    // a revenda é sempre pessoa jurídica: CNPJ obrigatório
    const doc = T.cleanDocument(b.document);
    if (doc.document_type !== 'cnpj') throw fail(400, 'Informe o CNPJ da revenda (a revenda é sempre pessoa jurídica).');
    const id = await T.insertTenant({
      slug, name, status, plan_id: plan.id, contact_name: text(b.contactName, 80), contact_email: contactEmail, notes: text(b.notes, 1000),
      ...doc, phone: T.cleanPhone(b.phone), address: T.cleanAddress(b.address),
      trial_ends_at: status === 'trial' ? ts + trialDays * T.DAY : null,
    });
    try {
      await saveExtras(id, b);
      const adminGroup = await access.createTenantGroups(id);
      await access.createUser({ username: adminUsername, name: text(b.contactName, 80) || adminUsername, password: adminPassword, mustChange: b.mustChange !== false, groupIds: [adminGroup] }, id);
    } catch (err) { // desfaz o cadastro pela metade
      await db.run('DELETE FROM user_groups WHERE group_id IN (SELECT id FROM access_groups WHERE tenant_id = ?)', [id]);
      await db.run('DELETE FROM users WHERE tenant_id = ?', [id]);
      await db.run('DELETE FROM access_groups WHERE tenant_id = ?', [id]);
      await db.run('DELETE FROM isp_revenda WHERE tenant_id = ?', [id]);
      await db.run('DELETE FROM tenants WHERE id = ?', [id]);
      T.invalidateTenants();
      throw err;
    }
    aud(res, id, `criou a revenda ${slug} (plano ${plan.code})`);
    res.status(201).json({
      tenant: { ...T.tenantDto(await T.getTenant(id), plan), ...(await loadExtras(id)) },
      admin: { username: adminUsername, password: generated ? adminPassword : null, mustChange: b.mustChange !== false, note: generated ? 'Senha gerada: mostrada só desta vez.' : 'Senha definida por você.' },
    });
  }));

  r.get('/tenants/:id', A('platform.view'), ah(async (req, res) => {
    const t = await tenantOr404(idParam(req));
    const plan = await T.effectivePlan(t);
    const c = await countsByTenant();
    res.json({ ...T.tenantDto(t, plan), ...(await loadExtras(t.id)), plan, admins: await access.tenantAdmins(t.id),
      uso: { telas: c.telas.get(Number(t.id)) || 0, unidades: c.unidades.get(Number(t.id)) || 0, usuarios: c.usuarios.get(Number(t.id)) || 0 } });
  }));

  r.patch('/tenants/:id', A('platform.tenants'), ah(async (req, res) => {
    const t = await tenantOr404(idParam(req));
    const b = req.body || {};
    const f = {};
    if (b.name !== undefined) { const name = text(b.name, 80); if (name.length < 2) throw fail(400, 'Nome inválido.'); f.name = name; }
    if (b.contactName !== undefined) f.contact_name = text(b.contactName, 80);
    if (b.contactEmail !== undefined) { const e = text(b.contactEmail, 120).toLowerCase(); if (e && !EMAIL.test(e)) throw fail(400, 'E-mail de contato inválido.'); f.contact_email = e; }
    if (b.notes !== undefined) f.notes = text(b.notes, 1000);
    if (b.phone !== undefined) f.phone = T.cleanPhone(b.phone);
    if (b.address !== undefined) f.address = T.cleanAddress(b.address);
    if (b.document !== undefined) {
      const doc = T.cleanDocument(b.document);
      if (doc.document_type !== 'cnpj') throw fail(400, 'Informe o CNPJ da revenda (a revenda é sempre pessoa jurídica).');
      Object.assign(f, doc);
    }
    if (b.planCode !== undefined) {
      const plan = await T.getPlanByCode(b.planCode);
      if (!plan || !plan.active) throw fail(400, 'Plano inexistente ou inativo.');
      f.plan_id = plan.id;
    }
    if (Object.keys(f).length) await T.updateTenant(t.id, f);
    await saveExtras(t.id, b);
    if (b.status !== undefined) {
      if (!T.TENANT_STATUS.includes(b.status)) throw fail(400, 'Situação inválida.');
      await T.setTenantStatus(t.id, b.status);
    }
    T.invalidateTenants();
    aud(res, t.id, `alterou a revenda ${t.slug}`);
    const fresh = await T.getTenant(t.id);
    res.json({ ...T.tenantDto(fresh, await T.effectivePlan(fresh)), ...(await loadExtras(t.id)) });
  }));

  r.post('/tenants/:id/impersonate', A('platform.impersonate'), ah(async (req, res) => {
    const t = await tenantOr404(idParam(req));
    aud(res, t.id, `entrou no painel da revenda ${t.slug}`);
    res.json(access.issueImpersonation(req.user, t.id));
  }));

  /* ------------------------------------------------------------------ perfis de funcionalidades e planos das revendas */
  // Herdados do NEXA (c51d2469). O plano por número de telas, os planos dos clientes finais e a cobrança vêm no passo 3.
  mountFeatureProfiles(r, { A, ah, aud });
  mountRevendas(r, { A, ah, aud }); // mapa do Brasil e cobranças das revendas (server/revendas.js)
  /** Perfil pedido no plano: profileId (número; null = funcionalidades próprias) ou profileCode. undefined = não mexe. */
  const profileOf = async (b) => {
    if (b.profileId === undefined && b.profileCode === undefined) return undefined;
    if (b.profileId === null || b.profileCode === null || b.profileCode === '') return null;
    const row = b.profileId !== undefined
      ? await db.get('SELECT id FROM feature_profiles WHERE id = ?', [Number(b.profileId)])
      : await db.get('SELECT id FROM feature_profiles WHERE code = ?', [String(b.profileCode).trim().toLowerCase()]);
    if (!row) throw fail(400, 'Perfil de funcionalidades inexistente.');
    return Number(row.id);
  };
  const planInput = (b, cur = null) => {
    const out = {};
    if (!cur || b.code !== undefined) {
      const code = String(b.code ?? '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(code)) throw fail(400, 'Código do plano: 2 a 40 caracteres (letras minúsculas, números, hífen e sublinhado).');
      out.code = code;
    }
    if (!cur || b.name !== undefined) { const n = text(b.name, 60); if (n.length < 2) throw fail(400, 'Nome do plano: 2 a 60 caracteres.'); out.name = n; }
    if (b.description !== undefined) out.description = text(b.description, 300);
    if (b.priceCents !== undefined || !cur) { const p = Number(b.priceCents ?? 0); if (!Number.isInteger(p) || p < 0 || p > 100_000_000) throw fail(400, 'Preço (priceCents): inteiro em centavos, 0 ou mais.'); out.price_cents = p; }
    if (b.currency !== undefined) { const c = String(b.currency).toLowerCase(); if (!/^[a-z]{3}$/.test(c)) throw fail(400, 'Moeda: código de 3 letras (ex.: brl).'); out.currency = c; }
    if (b.interval !== undefined) { if (!['month', 'year'].includes(b.interval)) throw fail(400, 'Intervalo: month ou year.'); out.interval = b.interval; }
    if (b.trialDays !== undefined) { const d = Number(b.trialDays); if (!Number.isInteger(d) || d < 0 || d > 365) throw fail(400, 'Dias de teste: 0 a 365.'); out.trial_days = d; }
    if (b.limits !== undefined) out.limits = JSON.stringify(T.cleanLimits(b.limits));
    else if (!cur) out.limits = JSON.stringify(T.cleanLimits({}));
    if (b.features !== undefined) out.features = JSON.stringify(storedFeatures(b.features));
    else if (!cur) out.features = JSON.stringify(storedFeatures({}));
    if (b.active !== undefined) out.active = b.active ? 1 : 0;
    if (b.public !== undefined) out.public = b.public ? 1 : 0;
    if (b.sort !== undefined) { const s = Number(b.sort); if (!Number.isInteger(s)) throw fail(400, 'Ordem (sort): número inteiro.'); out.sort = s; }
    return out;
  };

  r.get('/plans', A('platform.view'), ah(async (_req, res) => res.json(await T.listPlans())));
  r.post('/plans', A('platform.plans'), ah(async (req, res) => {
    const f = planInput(req.body || {});
    const profileId = await profileOf(req.body || {});
    if (await db.get('SELECT id FROM plans WHERE code = ?', [f.code])) throw fail(409, 'Já existe um plano com esse código.');
    const id = await db.insert('INSERT INTO plans(code,name,description,price_cents,currency,interval,trial_days,limits,features,active,public,sort,gateway_refs,created_at,profile_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [f.code, f.name, f.description ?? '', f.price_cents, f.currency ?? 'brl', f.interval ?? 'month', f.trial_days ?? 0, f.limits, f.features, f.active ?? 1, f.public ?? 1, f.sort ?? 0, '{}', Date.now(), profileId ?? null]);
    T.invalidateTenants();
    aud(res, null, `criou o plano ${f.code}${profileId ? ` (perfil #${profileId})` : ''}`);
    res.status(201).json(await T.planDto(await db.get('SELECT * FROM plans WHERE id = ?', [id])));
  }));
  r.patch('/plans/:id', A('platform.plans'), ah(async (req, res) => {
    const cur = await db.get('SELECT * FROM plans WHERE id = ?', [idParam(req)]);
    if (!cur) throw fail(404, 'Plano inexistente.');
    const b = req.body || {};
    if (cur.code === T.UNLIMITED_PLAN && (b.limits !== undefined || b.features !== undefined || b.code !== undefined || b.active === false || (b.profileId != null || (b.profileCode != null && b.profileCode !== '')))) throw fail(400, 'O plano Ilimitado é fixo: não dá para mudar código, limites ou recursos, nem desativá-lo.');
    const f = planInput(b, cur);
    const profileId = await profileOf(b);
    if (profileId !== undefined) f.profile_id = profileId;
    if (f.code && f.code !== cur.code && await db.get('SELECT id FROM plans WHERE code = ?', [f.code])) throw fail(409, 'Já existe um plano com esse código.');
    const keys = Object.keys(f);
    if (keys.length) await db.run(`UPDATE plans SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => f[k]), cur.id]);
    T.invalidateTenants();
    aud(res, null, `alterou o plano ${cur.code}: ${keys.join(', ')}`);
    res.json(await T.planDto(await db.get('SELECT * FROM plans WHERE id = ?', [cur.id])));
  }));
  r.delete('/plans/:id', A('platform.plans'), ah(async (req, res) => {
    const cur = await db.get('SELECT * FROM plans WHERE id = ?', [idParam(req)]);
    if (!cur) throw fail(404, 'Plano inexistente.');
    if (cur.code === T.UNLIMITED_PLAN) throw fail(400, 'O plano Ilimitado não pode ser excluído.');
    const n = Number((await db.get('SELECT COUNT(*) AS n FROM tenants WHERE plan_id = ?', [cur.id])).n);
    if (n) throw fail(409, `Há ${n} revenda(s) neste plano. Mude o plano delas antes de excluir (ou apenas desative o plano).`);
    if ((await T.getPlatformSettings()).defaultPlanCode === cur.code) throw fail(409, 'Este é o plano padrão das novas revendas. Troque o plano padrão antes de excluir.');
    await db.run('DELETE FROM plans WHERE id = ?', [cur.id]);
    T.invalidateTenants();
    aud(res, null, `excluiu o plano ${cur.code}`);
    res.json({ ok: true });
  }));

  app.use('/api/platform', r);
}
