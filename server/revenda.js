// Painel da REVENDA (o provedor): a gestão do negócio dela. Rotas /api/revenda/*:
//   GET    /resumo                     clientes, telas (no ar, fora), uso do plano, receita e cobranças vencidas
//   GET    /clientes                   os clientes finais (conta própria de cada um)
//   POST   /clientes                   cadastra o cliente: a conta, o administrador (o e-mail é o login) e o plano
//   GET    /clientes/:id               um cliente, com o acesso
//   PATCH  /clientes/:id               dados, plano, cobrança, situação
//   POST   /clientes/:id/entrar        abre o painel do cliente (1 h), para ajudar
//   POST   /clientes/:id/senha         nova senha inicial do administrador do cliente (mostrada uma vez)
//   GET|POST|PATCH|DELETE /planos      os planos da revenda para os clientes (telas, módulos, preço)
//   GET    /faturas  POST /faturas  POST /faturas/gerar-mes  POST /faturas/:id/pagar|cancelar
//   GET    /telas                      todas as telas dos clientes (e as da revenda), com a situação e o ponto
//   GET    /marca  (público: /api/marca/:slug)   o nome e a logo da revenda para a entrada do cliente
import express from 'express';
import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import * as T from './tenancy.js';
import * as access from './auth.js';
import { config } from './config.js';
import { checkPasswordPolicy, USERNAME_RE, hashPassword } from './authcore.js';
import * as CAT from '../public/shared/funcionalidades.js';
import { contaOf, forgetConta, ehDaRevenda, clientesDe, planoClienteDto, usoRevenda } from './contas.js';
import { saveExtras, loadExtras, extrasDto } from './revendas.js';
import { storage, isUrl } from './storage.js';

const { fail } = T;
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ONLINE_MS = 2 * 60_000;
const j = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const randomPassword = () => { const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return [...randomBytes(14)].map((b) => abc[b % abc.length]).join(''); };
const STATUS_OK = ['active', 'suspended', 'canceled'];
const REF_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const idParam = (req) => { const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) throw fail(400, 'Id inválido.'); return id; };

/** Só a revenda (não o cliente final, nem a revenda aberta como cliente). */
const soRevenda = ah(async (req, _res, next) => {
  const c = await contaOf(req.tenantId);
  if (c.tipo !== 'revenda') throw fail(403, 'Esta área é da revenda.');
  next();
});

async function clienteDaRevenda(req) {
  const id = idParam(req);
  if (!(await ehDaRevenda(req.tenantId, id))) throw fail(404, 'Cliente inexistente.');
  return T.getTenant(id);
}

async function planoDaRevenda(revendaId, planoId) {
  if (planoId == null || planoId === '') return null;
  const p = await db.get('SELECT * FROM isp_planos_cliente WHERE id = ? AND revenda_id = ?', [Number(planoId), revendaId]);
  if (!p) throw fail(400, 'Plano inexistente.');
  return planoClienteDto(p);
}

/** A situação de uma tela pelo último sinal de vida. */
const situacao = (lastSeen, now) => (!lastSeen ? 'nunca' : now - Number(lastSeen) <= ONLINE_MS ? 'no-ar' : 'fora');

async function clienteDto(t, extrasRow = null, planos = null, uso = null) {
  const c = await contaOf(t.id);
  const plano = c.planoClienteId ? (planos?.get(c.planoClienteId) || planoClienteDto(await db.get('SELECT * FROM isp_planos_cliente WHERE id = ?', [c.planoClienteId]))) : null;
  return {
    ...T.tenantDto(t, null), ...(extrasRow ? extrasDto(extrasRow) : await loadExtras(t.id)),
    pessoa: c.pessoa, planoId: c.planoClienteId, plano: plano ? { id: plano.id, nome: plano.nome, telas: plano.telas, precoCents: plano.precoCents, prefeitura: Boolean(plano.modulos?.prefeitura) } : null,
    // o módulo Prefeitura de fato (o plano do cliente ou o superadmin, conta por conta)
    prefeitura: Boolean((await T.effectivePlan(t))?.features?.prefeitura),
    uso: uso || null,
  };
}

/** O endereço de entrada do cliente (com a marca da revenda). */
/** O endereço de entrada de uma conta: o do cliente é dele (/c/<cliente>); a entrada mostra a marca da revenda. */
const linkCliente = (t) => `${config.platform.publicUrl || ''}/c/${t.slug}`;

/** O e-mail já é login de alguém ou contato de outra conta (revenda ou cliente)? */
async function emailEmUso(email, { excetoTenant = null, excetoUser = null } = {}) {
  const u = await db.get('SELECT id FROM users WHERE username = ?', [email]);
  if (u && Number(u.id) !== Number(excetoUser)) return true;
  const t = await db.get('SELECT id FROM tenants WHERE LOWER(contact_email) = ? AND id <> ?', [email, excetoTenant ?? 0]);
  return Boolean(t);
}

export function mountRevenda(app, { needs, signedIn }) {
  const r = express.Router();
  const R = [needs('users.manage'), soRevenda];

  /* ------------------------------------------------------------------ resumo */
  r.get('/resumo', ...R, ah(async (req, res) => {
    const rid = req.tenantId; const now = Date.now();
    const ids = await clientesDe(rid);
    const all = [rid, ...ids]; const q = all.map(() => '?').join(',');
    const devs = await db.all(`SELECT last_seen FROM telas_devices WHERE revoked_at IS NULL AND tenant_id IN (${q})`, all);
    const st = { 'no-ar': 0, fora: 0, nunca: 0 };
    for (const d of devs) st[situacao(d.last_seen, now)]++;
    const receita = Number((await db.get(`SELECT COALESCE(SUM(COALESCE(x.valor_cents, p.preco_cents, 0)), 0) AS n FROM isp_conta c
      JOIN tenants t ON t.id = c.tenant_id LEFT JOIN isp_revenda x ON x.tenant_id = c.tenant_id LEFT JOIN isp_planos_cliente p ON p.id = c.plano_cliente_id
      WHERE c.tipo = 'cliente' AND c.revenda_id = ? AND t.status = 'active'`, [rid])).n) || 0;
    const hoje = new Date().toISOString().slice(0, 10);
    const venc = await db.get("SELECT COUNT(*) AS n, COALESCE(SUM(valor_cents), 0) AS v FROM isp_faturas_cliente WHERE revenda_id = ? AND status = 'aberta' AND vencimento < ?", [rid, hoje]);
    const uso = await usoRevenda(rid);
    res.set('Cache-Control', 'no-store').json({ clientes: ids.length, telas: { total: devs.length, ...st }, uso, receitaMensalCents: receita, vencidas: { n: Number(venc.n) || 0, valorCents: Number(venc.v) || 0 } });
  }));

  /* ------------------------------------------------------------------ clientes */
  r.get('/clientes', ...R, ah(async (req, res) => {
    const ids = await clientesDe(req.tenantId);
    if (!ids.length) return res.json([]);
    const q = ids.map(() => '?').join(',');
    const [rows, ex, planos, tel, uni] = await Promise.all([
      db.all(`SELECT * FROM tenants WHERE id IN (${q}) ORDER BY name`, ids),
      db.all(`SELECT * FROM isp_revenda WHERE tenant_id IN (${q})`, ids),
      db.all('SELECT * FROM isp_planos_cliente WHERE revenda_id = ?', [req.tenantId]),
      db.all(`SELECT tenant_id, last_seen FROM telas_devices WHERE revoked_at IS NULL AND tenant_id IN (${q})`, ids),
      db.all(`SELECT tenant_id, COUNT(*) AS n FROM telas_offices WHERE tenant_id IN (${q}) GROUP BY tenant_id`, ids),
    ]);
    const exM = new Map(ex.map((x) => [Number(x.tenant_id), x]));
    const plM = new Map(planos.map((p) => [Number(p.id), planoClienteDto(p)]));
    const now = Date.now();
    const usoM = new Map();
    for (const d of tel) { const k = Number(d.tenant_id); const u = usoM.get(k) || { telas: 0, noAr: 0, unidades: 0 }; u.telas++; if (situacao(d.last_seen, now) === 'no-ar') u.noAr++; usoM.set(k, u); }
    for (const u of uni) { const k = Number(u.tenant_id); const x = usoM.get(k) || { telas: 0, noAr: 0, unidades: 0 }; x.unidades = Number(u.n); usoM.set(k, x); }
    res.set('Cache-Control', 'no-store').json(await Promise.all(rows.map((t) => clienteDto(t, exM.get(Number(t.id)) || {}, plM, usoM.get(Number(t.id)) || { telas: 0, noAr: 0, unidades: 0 }))));
  }));

  async function uniqueSlug(base) {
    let slug = T.slugify(base) || 'cliente';
    if (slug.length < 2) slug = `${slug}-1`;
    for (let i = 1; await db.get('SELECT id FROM tenants WHERE slug = ?', [slug]); i++) slug = `${T.slugify(base).slice(0, 34)}-${i + 1}`;
    return slug;
  }

  function dadosCliente(b, { criando = false } = {}) {
    const f = {};
    if (criando || b.name !== undefined) { const name = text(b.name, 80); if (name.length < 2) throw fail(400, 'Informe o nome do cliente (2 a 80 caracteres).'); f.name = name; }
    if (b.contactName !== undefined) f.contact_name = text(b.contactName, 80);
    if (b.contactEmail !== undefined) { const e = text(b.contactEmail, 120).toLowerCase(); if (e && !EMAIL.test(e)) throw fail(400, 'E-mail inválido.'); f.contact_email = e; }
    if (b.phone !== undefined) f.phone = T.cleanPhone(b.phone);
    if (b.address !== undefined) f.address = T.cleanAddress(b.address);
    if (b.notes !== undefined) f.notes = text(b.notes, 1000);
    if (b.document !== undefined) Object.assign(f, T.cleanDocument(b.document));
    return f;
  }

  r.post('/clientes', ...R, ah(async (req, res) => {
    const rid = req.tenantId; const b = req.body || {};
    const uso = await usoRevenda(rid);
    if (uso.limiteClientes != null && uso.clientes >= uso.limiteClientes) throw fail(402, `O seu plano permite até ${uso.limiteClientes} clientes finais. Fale com a DIGITAL ISP para aumentar.`);
    const f = dadosCliente(b, { criando: true });
    const pessoa = b.pessoa === 'pf' ? 'pf' : 'pj';
    if (f.document_type && f.document_type !== (pessoa === 'pf' ? 'cpf' : 'cnpj')) throw fail(400, pessoa === 'pf' ? 'Pessoa física: informe o CPF.' : 'Pessoa jurídica: informe o CNPJ.');
    const plano = await planoDaRevenda(rid, b.planoId);
    const email = text(b.contactEmail, 120).toLowerCase();
    if (!EMAIL.test(email)) throw fail(400, 'Informe o e-mail do cliente: é o login dele.');
    if (!USERNAME_RE.test(email)) throw fail(400, 'E-mail inválido para login.');
    if (await emailEmUso(email)) throw fail(409, 'Esse e-mail já é usado por outra conta (de uma revenda ou de outro cliente). Use outro e-mail.');
    const rev = await T.getTenant(rid);
    const id = await T.insertTenant({ ...f, slug: await uniqueSlug(f.name), status: 'active', plan_id: rev.plan_id, contact_email: email });
    try {
      await db.run('INSERT INTO isp_conta(tenant_id, tipo, revenda_id, pessoa, plano_cliente_id, created_at) VALUES(?,?,?,?,?,?)', [id, 'cliente', rid, pessoa, plano?.id ?? null, Date.now()]);
      forgetConta(id);
      await saveExtras(id, { fantasia: b.fantasia, whatsapp: b.whatsapp, responsavel: b.contactName, uf: b.uf, municipio: b.municipio, municipioIbge: b.municipioIbge, cobranca: b.cobranca || {} });
      const adminGroup = await access.createTenantGroups(id);
      const password = randomPassword();
      await access.createUser({ username: email, name: text(b.contactName, 80) || f.name, password, mustChange: true, groupIds: [adminGroup] }, id);
      res.locals.audit = `cadastrou o cliente final ${f.name}`;
      const novo = await T.getTenant(id);
      res.status(201).json({ cliente: await clienteDto(novo), acesso: { link: linkCliente(novo), login: email, senha: password } });
    } catch (err) {
      await db.run('DELETE FROM user_groups WHERE group_id IN (SELECT id FROM access_groups WHERE tenant_id = ?)', [id]);
      await db.run('DELETE FROM users WHERE tenant_id = ?', [id]);
      await db.run('DELETE FROM access_groups WHERE tenant_id = ?', [id]);
      await db.run('DELETE FROM isp_revenda WHERE tenant_id = ?', [id]);
      await db.run('DELETE FROM isp_conta WHERE tenant_id = ?', [id]);
      await db.run('DELETE FROM tenants WHERE id = ?', [id]);
      forgetConta(id); T.invalidateTenants();
      throw err;
    }
  }));

  r.get('/clientes/:id', ...R, ah(async (req, res) => {
    const t = await clienteDaRevenda(req);
    const admins = await access.tenantAdmins(t.id);
    res.set('Cache-Control', 'no-store').json({ ...(await clienteDto(t)), acesso: { link: linkCliente(t), logins: admins.map((a) => a.username) } });
  }));

  r.patch('/clientes/:id', ...R, ah(async (req, res) => {
    const t = await clienteDaRevenda(req); const b = req.body || {};
    const f = dadosCliente(b);
    if (f.contact_email !== undefined && f.contact_email !== String(t.contact_email || '').toLowerCase()) {
      const novo = f.contact_email;
      if (!EMAIL.test(novo)) throw fail(400, 'Informe o e-mail do cliente: é o login dele.');
      const admins = await access.tenantAdmins(t.id);
      const login = admins.find((a) => a.username === String(t.contact_email || '').toLowerCase()) || admins[0];
      if (await emailEmUso(novo, { excetoTenant: t.id, excetoUser: login?.id })) throw fail(409, 'Esse e-mail já é usado por outra conta. Use outro e-mail.');
      if (login) { await db.run('UPDATE users SET username = ? WHERE id = ? AND tenant_id = ?', [novo, login.id, t.id]); access.invalidate(); }
    } else delete f.contact_email;
    // o endereço de entrada do cliente (/c/<identificador>): a revenda personaliza
    if (b.slug !== undefined && String(b.slug).trim().toLowerCase() !== t.slug) {
      const slug = T.validSlug(String(b.slug).trim().toLowerCase());
      if (await db.get('SELECT id FROM tenants WHERE slug = ? AND id <> ?', [slug, t.id])) throw fail(409, 'Esse endereço já é usado por outra conta. Escolha outro.');
      f.slug = slug;
    }
    const c = await contaOf(t.id);
    const pessoa = b.pessoa === undefined ? c.pessoa : (b.pessoa === 'pf' ? 'pf' : 'pj');
    if (f.document_type && f.document_type !== (pessoa === 'pf' ? 'cpf' : 'cnpj')) throw fail(400, pessoa === 'pf' ? 'Pessoa física: informe o CPF.' : 'Pessoa jurídica: informe o CNPJ.');
    if (Object.keys(f).length) await T.updateTenant(t.id, f);
    const plano = b.planoId !== undefined ? await planoDaRevenda(req.tenantId, b.planoId) : undefined;
    await db.run('UPDATE isp_conta SET pessoa = ?, plano_cliente_id = ? WHERE tenant_id = ?', [pessoa, plano === undefined ? c.planoClienteId : plano?.id ?? null, t.id]);
    forgetConta(t.id);
    await saveExtras(t.id, { fantasia: b.fantasia, whatsapp: b.whatsapp, responsavel: b.contactName, uf: b.uf, municipio: b.municipio, municipioIbge: b.municipioIbge, cobranca: b.cobranca || {} });
    if (b.status !== undefined) {
      if (!STATUS_OK.includes(b.status)) throw fail(400, 'Situação inválida.');
      await T.updateTenant(t.id, { status: b.status });
    }
    T.invalidateTenants();
    res.locals.audit = `alterou o cliente final ${t.name}`;
    res.json(await clienteDto(await T.getTenant(t.id)));
  }));

  r.post('/clientes/:id/entrar', ...R, ah(async (req, res) => {
    const t = await clienteDaRevenda(req);
    res.locals.audit = `abriu o painel do cliente ${t.name}`;
    res.json(access.issueRevendaAccess(req.user, t.id));
  }));

  r.post('/clientes/:id/senha', ...R, ah(async (req, res) => {
    const t = await clienteDaRevenda(req);
    const admins = await access.tenantAdmins(t.id);
    const u = admins[0];
    if (!u) throw fail(404, 'O cliente não tem administrador.');
    const password = randomPassword();
    checkPasswordPolicy(password, { username: u.username, production: config.production });
    await access.resetPassword(u.id, password, { mustChange: true }, t.id);
    res.locals.audit = `gerou nova senha para o cliente ${t.name}`;
    res.json({ login: u.username, senha: password });
  }));

  /* ------------------------------------------------------------------ planos da revenda */
  const planoInput = (b, revFeatures) => {
    const nome = text(b.nome, 60); if (nome.length < 2) throw fail(400, 'Nome do plano: 2 a 60 caracteres.');
    const int = (v, k) => { if (v === '' || v == null) return null; const x = Number(v); if (!Number.isInteger(x) || x < 0) throw fail(400, `${k}: número inteiro de 0 para cima (vazio = ilimitado).`); return x; };
    const preco = Number(b.precoCents ?? 0); if (!Number.isInteger(preco) || preco < 0) throw fail(400, 'Preço inválido.');
    const mods = {}; for (const k of CAT.FEATURE_KEYS) mods[k] = Boolean(b.modulos?.[k]) && Boolean(revFeatures[k]); // só o que a revenda tem
    return { nome, descricao: text(b.descricao, 300), telas: int(b.telas, 'Telas'), usuarios: int(b.usuarios, 'Usuários'), storage_mb: int(b.storageMB, 'Armazenamento'), modulos: JSON.stringify(mods), preco_cents: preco, ativo: b.ativo === false ? 0 : 1 };
  };
  r.get('/planos', ...R, ah(async (req, res) => {
    const rows = await db.all('SELECT * FROM isp_planos_cliente WHERE revenda_id = ? ORDER BY sort, preco_cents, id', [req.tenantId]);
    const uso = await usoRevenda(req.tenantId);
    const cont = new Map((await db.all("SELECT plano_cliente_id AS p, COUNT(*) AS n FROM isp_conta WHERE tipo = 'cliente' AND revenda_id = ? GROUP BY plano_cliente_id", [req.tenantId])).map((x) => [Number(x.p), Number(x.n)]));
    const disponiveis = CAT.SECTIONS.map((s) => ({ secao: s.label, modulos: s.menus.filter((m) => !m.optIn || uso.plano?.features?.[m.key]).map((m) => ({ key: m.key, label: m.label, desc: m.desc, core: Boolean(m.core), liberado: Boolean(m.core || uso.plano?.features?.[m.key]) })) }));
    res.set('Cache-Control', 'no-store').json({ planos: rows.map((p) => ({ ...planoClienteDto(p), clientes: cont.get(Number(p.id)) || 0 })), disponiveis, uso });
  }));
  r.post('/planos', ...R, ah(async (req, res) => {
    const uso = await usoRevenda(req.tenantId);
    const f = planoInput(req.body || {}, uso.plano?.features || {});
    const id = await db.insert('INSERT INTO isp_planos_cliente(revenda_id, nome, descricao, telas, usuarios, storage_mb, modulos, preco_cents, ativo, sort, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [req.tenantId, f.nome, f.descricao, f.telas, f.usuarios, f.storage_mb, f.modulos, f.preco_cents, f.ativo, 0, Date.now()]);
    res.locals.audit = `criou o plano ${f.nome} para os clientes`;
    res.status(201).json(planoClienteDto(await db.get('SELECT * FROM isp_planos_cliente WHERE id = ?', [id])));
  }));
  r.patch('/planos/:id', ...R, ah(async (req, res) => {
    const cur = await db.get('SELECT * FROM isp_planos_cliente WHERE id = ? AND revenda_id = ?', [idParam(req), req.tenantId]);
    if (!cur) throw fail(404, 'Plano inexistente.');
    const uso = await usoRevenda(req.tenantId);
    const f = planoInput({ ...planoClienteDto(cur), ...(req.body || {}) }, uso.plano?.features || {});
    await db.run('UPDATE isp_planos_cliente SET nome=?, descricao=?, telas=?, usuarios=?, storage_mb=?, modulos=?, preco_cents=?, ativo=? WHERE id = ?', [f.nome, f.descricao, f.telas, f.usuarios, f.storage_mb, f.modulos, f.preco_cents, f.ativo, cur.id]);
    T.invalidateTenants();
    res.locals.audit = `alterou o plano ${f.nome} dos clientes`;
    res.json(planoClienteDto(await db.get('SELECT * FROM isp_planos_cliente WHERE id = ?', [cur.id])));
  }));
  r.delete('/planos/:id', ...R, ah(async (req, res) => {
    const cur = await db.get('SELECT * FROM isp_planos_cliente WHERE id = ? AND revenda_id = ?', [idParam(req), req.tenantId]);
    if (!cur) throw fail(404, 'Plano inexistente.');
    const n = Number((await db.get('SELECT COUNT(*) AS n FROM isp_conta WHERE plano_cliente_id = ?', [cur.id])).n);
    if (n) throw fail(409, `Há ${n} cliente(s) neste plano. Mude o plano deles antes (ou só desative o plano).`);
    await db.run('DELETE FROM isp_planos_cliente WHERE id = ?', [cur.id]);
    res.json({ ok: true });
  }));

  /* ------------------------------------------------------------------ cobranças da revenda para os clientes */
  const faturaDto = (f, names) => ({
    id: Number(f.id), clienteId: Number(f.cliente_id), cliente: names.get(Number(f.cliente_id)) || null, referencia: f.referencia, descricao: f.descricao,
    valorCents: Number(f.valor_cents), vencimento: f.vencimento, status: f.status, modo: f.modo, vencida: f.status === 'aberta' && f.vencimento < new Date().toISOString().slice(0, 10),
    pagoEm: f.pago_em != null ? Number(f.pago_em) : null, pagoValorCents: f.pago_valor_cents != null ? Number(f.pago_valor_cents) : null, pagoForma: f.pago_forma || null, obs: f.obs,
  });
  const nomes = async (rid) => { const ids = await clientesDe(rid); if (!ids.length) return new Map(); return new Map((await db.all(`SELECT id, name FROM tenants WHERE id IN (${ids.map(() => '?').join(',')})`, ids)).map((t) => [Number(t.id), t.name])); };
  r.get('/faturas', ...R, ah(async (req, res) => {
    const where = ['revenda_id = ?']; const args = [req.tenantId];
    if (['aberta', 'paga', 'cancelada'].includes(req.query.status)) { where.push('status = ?'); args.push(req.query.status); }
    const rows = await db.all(`SELECT * FROM isp_faturas_cliente WHERE ${where.join(' AND ')} ORDER BY vencimento DESC, id DESC LIMIT 500`, args);
    const nm = await nomes(req.tenantId);
    const list = rows.map((f) => faturaDto(f, nm));
    const sum = (fn) => list.filter(fn).reduce((s, f) => s + f.valorCents, 0);
    res.set('Cache-Control', 'no-store').json({ faturas: list, totais: { abertoCents: sum((f) => f.status === 'aberta'), vencidoCents: sum((f) => f.vencida), pagoCents: list.filter((f) => f.status === 'paga').reduce((s, f) => s + (f.pagoValorCents ?? f.valorCents), 0) } });
  }));
  r.post('/faturas', ...R, ah(async (req, res) => {
    const b = req.body || {};
    const cid = Number(b.clienteId);
    if (!(await ehDaRevenda(req.tenantId, cid))) throw fail(404, 'Cliente inexistente.');
    const valor = Number(b.valorCents); if (!Number.isInteger(valor) || valor <= 0) throw fail(400, 'Valor inválido.');
    if (!DATE_RE.test(String(b.vencimento || ''))) throw fail(400, 'Vencimento inválido.');
    const ref = `avulsa-${Date.now()}`;
    const id = await db.insert('INSERT INTO isp_faturas_cliente(revenda_id, cliente_id, referencia, descricao, valor_cents, vencimento, status, modo, created_at, created_by) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [req.tenantId, cid, ref, text(b.descricao, 120) || 'Cobrança avulsa', valor, b.vencimento, 'aberta', 'fora', Date.now(), req.user.username]);
    res.status(201).json(faturaDto(await db.get('SELECT * FROM isp_faturas_cliente WHERE id = ?', [id]), await nomes(req.tenantId)));
  }));
  r.post('/faturas/gerar-mes', ...R, ah(async (req, res) => {
    const ref = String(req.body?.referencia || ''); if (!REF_RE.test(ref)) throw fail(400, 'Referência: o mês, AAAA-MM.');
    const out = { criadas: [], puladas: [] };
    for (const cid of await clientesDe(req.tenantId)) {
      const t = await T.getTenant(cid);
      if (!t || t.status !== 'active') continue;
      if (await db.get('SELECT id FROM isp_faturas_cliente WHERE cliente_id = ? AND referencia = ?', [cid, ref])) { out.puladas.push({ id: cid, name: t.name, motivo: 'já tem' }); continue; }
      const x = await loadExtras(cid); const c = await contaOf(cid);
      const p = c.planoClienteId ? await db.get('SELECT preco_cents FROM isp_planos_cliente WHERE id = ?', [c.planoClienteId]) : null;
      const valor = x.cobranca.valorCents ?? (p ? Number(p.preco_cents) : 0);
      if (!valor) { out.puladas.push({ id: cid, name: t.name, motivo: 'sem valor' }); continue; }
      await db.insert('INSERT INTO isp_faturas_cliente(revenda_id, cliente_id, referencia, descricao, valor_cents, vencimento, status, modo, created_at, created_by) VALUES(?,?,?,?,?,?,?,?,?,?)',
        [req.tenantId, cid, ref, `Mensalidade ${ref}`, valor, `${ref}-${String(x.cobranca.diaVencimento).padStart(2, '0')}`, 'aberta', x.cobranca.modo, Date.now(), req.user.username]);
      out.criadas.push({ id: cid, name: t.name, valorCents: valor });
    }
    res.json(out);
  }));
  const minhaFatura = async (req) => { const f = await db.get('SELECT * FROM isp_faturas_cliente WHERE id = ? AND revenda_id = ?', [idParam(req), req.tenantId]); if (!f) throw fail(404, 'Fatura inexistente.'); if (f.status !== 'aberta') throw fail(409, 'Só uma fatura aberta.'); return f; };
  r.post('/faturas/:id/pagar', ...R, ah(async (req, res) => {
    const f = await minhaFatura(req); const b = req.body || {};
    await db.run("UPDATE isp_faturas_cliente SET status = 'paga', pago_em = ?, pago_valor_cents = ?, pago_forma = ? WHERE id = ?", [Date.now(), Number(b.valorCents) || Number(f.valor_cents), text(b.forma, 40) || 'Pix', f.id]);
    res.json({ ok: true });
  }));
  r.post('/faturas/:id/cancelar', ...R, ah(async (req, res) => {
    const f = await minhaFatura(req);
    await db.run("UPDATE isp_faturas_cliente SET status = 'cancelada' WHERE id = ?", [f.id]);
    res.json({ ok: true });
  }));

  /* ------------------------------------------------------------------ telas de todos os clientes */
  r.get('/telas', ...R, ah(async (req, res) => {
    const rid = req.tenantId; const ids = [rid, ...(await clientesDe(rid))]; const q = ids.map(() => '?').join(',');
    const now = Date.now();
    const [devs, offs, ts] = await Promise.all([
      db.all(`SELECT id, tenant_id, office_id, name, lat, lng, last_seen, created_at FROM telas_devices WHERE revoked_at IS NULL AND tenant_id IN (${q}) ORDER BY name`, ids),
      db.all(`SELECT id, tenant_id, name, lat, lng FROM telas_offices WHERE tenant_id IN (${q})`, ids),
      db.all(`SELECT id, name FROM tenants WHERE id IN (${q})`, ids),
    ]);
    const om = new Map(offs.map((o) => [Number(o.id), o])); const tm = new Map(ts.map((t) => [Number(t.id), t.name]));
    const num = (v) => (v == null ? null : Number(v));
    res.set('Cache-Control', 'no-store').json({
      serverTime: now,
      telas: devs.map((d) => { const o = om.get(Number(d.office_id)); return { id: Number(d.id), clienteId: Number(d.tenant_id), cliente: Number(d.tenant_id) === rid ? '(da revenda)' : tm.get(Number(d.tenant_id)), unidade: o?.name || null, name: d.name, lat: d.lat != null ? Number(d.lat) : num(o?.lat), lng: d.lng != null ? Number(d.lng) : num(o?.lng), lastSeen: num(d.last_seen), status: situacao(d.last_seen, now) }; }),
      unidades: offs.map((o) => ({ id: Number(o.id), clienteId: Number(o.tenant_id), cliente: tm.get(Number(o.tenant_id)), name: o.name, lat: num(o.lat), lng: num(o.lng) })),
    });
  }));

  app.use('/api/revenda', r);

  /* ------------------------------------------------------------------ a conta de quem entrou (o painel escolhe o menu) */
  app.get('/api/conta', signedIn, ah(async (req, res) => {
    if (req.user.tenantId == null) return res.json({ tipo: 'plataforma' });
    const c = await contaOf(req.user.tenantId);
    const out = { tipo: c.tipo, pessoa: c.pessoa, impersonador: req.user.impersonator?.username || null };
    if (c.tipo === 'cliente' && c.revendaId) { const rev = await T.getTenant(c.revendaId); out.revenda = rev ? { id: Number(rev.id), name: rev.name, slug: rev.slug, marca: await marcaDe(rev) } : null; }
    else { const rev = await T.getTenant(req.user.tenantId); out.marca = rev ? await marcaDe(rev) : null; out.link = null; }
    res.set('Cache-Control', 'no-store').json(out);
  }));

  /* ------------------------------------------------------------------ marca da revenda (pública: a entrada do cliente) */
  app.get('/api/marca/:slug', ah(async (req, res) => {
    const t = await T.getTenantBySlug(String(req.params.slug || '').toLowerCase());
    const c = t ? await contaOf(t.id) : null;
    const rev = !t ? null : c.tipo === 'cliente' ? await T.getTenant(c.revendaId) : t;
    if (!rev) return res.status(404).json({ error: 'Endereço inexistente.' });
    res.set('Cache-Control', 'public, max-age=300').json(await marcaDe(rev));
  }));
}

/** O nome e a logo da revenda (a logomarca enviada em Telas e conteúdo → Configurações). */
export async function marcaDe(rev) {
  const s = await db.get('SELECT data FROM tvcorp_settings WHERE tenant_id = ?', [rev.id]);
  const file = j(s?.data, {}).logo?.file;
  const x = await loadExtras(rev.id);
  let logo = null;
  if (file) { const u = storage.url('graphics', file); logo = !u ? null : isUrl(u) ? u : u; }
  return { nome: x.fantasia || rev.name, logo, cor: null };
}
