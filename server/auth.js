// Usuários, grupos, permissões, sessões e auditoria (sobre o banco: SQLite ou Postgres), multi-cliente.
// Cada usuário pertence a UM cliente (users.tenant_id) ou à equipe da plataforma (tenant_id NULO). O nome de usuário é único na plataforma inteira.
import { randomBytes } from 'node:crypto';
import { db, getSetting, setSetting } from './db.js';
import { config } from './config.js';
import {
  PERMISSIONS, PERM_IDS, PLATFORM_PERMISSIONS, PLATFORM_PERM_IDS, expandPermissions, cleanPermissions, hashPassword, verifyPassword, DUMMY_HASH,
  checkPasswordPolicy, USERNAME_RE, createSessions,
} from './authcore.js';
import { getTenant, isBlocked, suspendedError, DEFAULT_TENANT_ID, ensureDefaults, listTenantIds } from './tenancy.js';

export { PERMISSIONS, PLATFORM_PERMISSIONS };
export const ADMIN_GROUP = 'Administradores';
export const SUPER_GROUP = 'Super administradores';
/** Perfil pronto "Só ao vivo" (docs/ACESSO.md): só a tela AO VIVO, o plantão e a câmera do próprio aparelho. */
export const LIVE_GROUP = 'Ao vivo (mesa e plantão)';
export const LIVE_GROUP_DESCRIPTION = 'Só a mesa AO VIVO e o plantão: corta câmeras, entra ao vivo e transmite do próprio aparelho. Não mexe na grade, na mídia nem nas configurações.';
export const LIVE_GROUP_PERMISSIONS = ['live.mesa', 'live.plantao'];
const LOCK_AFTER = 5; // falhas seguidas numa conta
const LOCK_MS = 5 * 60 * 1000;
export const IMPERSONATE_MS = 3600 * 1000;

const sessions = createSessions(config.sessionSecret || randomBytes(32).toString('hex'));
const j = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const fail = (status, message) => Object.assign(new Error(message), { status });
const scopeOf = (tenantId) => (tenantId == null ? 'platform' : 'tenant');
/** Fragmento SQL "coluna do cliente" para um cliente ou para a plataforma (NULO). */
const tq = (col, tenantId) => (tenantId == null ? { sql: `${col} IS NULL`, args: [] } : { sql: `${col} = ?`, args: [tenantId] });

/** Grupos criados em cada cliente novo (o Administradores é sempre criado, com todas as permissões). */
const STARTER_GROUPS = [
  // content.manage / audience.manage entram só nos grupos criados a partir desta versão (grupos existentes não fixos não mudam)
  { name: 'Operadores', description: 'Opera o ar: take, pular, standby, entrada ao vivo, vitrine, gráficos, teleprompter e chat; responde os espectadores.', permissions: ['playout.control', 'media.view', 'products.edit', 'graphics.edit', 'chat.moderate', 'audience.manage', 'prompter.control'] },
  { name: 'Programação', description: 'Monta a grade e cuida da biblioteca, dos intervalos, da vitrine e do conteúdo dos apps.', permissions: ['schedule.edit', 'media.edit', 'products.edit', 'graphics.edit', 'content.manage', 'commercial.manage'] },
  { name: 'Visualizadores', description: 'Só acompanha: vê o playout e a biblioteca, sem alterar nada.', permissions: ['playout.view', 'media.view'] },
  { name: LIVE_GROUP, description: LIVE_GROUP_DESCRIPTION, permissions: LIVE_GROUP_PERMISSIONS },
  { name: 'Jornalismo', description: 'Redação: espelhos dos telejornais, laudas, pautas e agências; opera o teleprompter.', permissions: ['news.edit', 'prompter.control', 'media.view'] },
];
/** Grupos da equipe da plataforma (access_groups.tenant_id NULO). O Super administradores é fixo. */
const PLATFORM_GROUPS = [
  { name: SUPER_GROUP, description: 'Acesso total à plataforma. Não pode ser excluído nem reduzido; a plataforma nunca fica sem um superadmin ativo.', permissions: PLATFORM_PERM_IDS, builtin: 1 },
  { name: 'Suporte', description: 'Acompanha clientes e canais, vê a auditoria e entra como cliente para ajudar.', permissions: ['platform.view', 'platform.monitor', 'platform.audit', 'platform.impersonate', 'platform.lab'], builtin: 0 },
  { name: 'Financeiro', description: 'Planos, cobrança, pagamentos e eventos dos gateways.', permissions: ['platform.view', 'platform.billing', 'platform.plans'], builtin: 0 },
];

/* ------------------------------------------------------------------ usuário carregado (com cache curto) */
const cache = new Map();
const TTL = 2000;
export const invalidate = () => cache.clear();

const effective = (groups, scope) => ({
  perms: expandPermissions(groups.flatMap((g) => j(g.permissions, [])), scope),
  // null = todos os canais; senão o conjunto de slugs liberados pelos grupos (a equipe da plataforma não usa canais)
  channels: scope === 'platform' || groups.some((g) => g.channels == null) ? null : new Set(groups.flatMap((g) => j(g.channels, []))),
});

async function loadUser(id, q = db) {
  const hit = q === db ? cache.get(id) : null;
  if (hit && Date.now() - hit.at < TTL) return hit.user;
  const row = await q.get('SELECT * FROM users WHERE id = ?', [id]);
  let user = null;
  if (row) {
    const tenantId = row.tenant_id == null ? null : Number(row.tenant_id);
    const groups = (await q.all('SELECT g.* FROM access_groups g JOIN user_groups ug ON ug.group_id = g.id WHERE ug.user_id = ? ORDER BY g.name', [id]))
      .filter((g) => (g.tenant_id == null ? null : Number(g.tenant_id)) === tenantId); // grupo de outro escopo nunca vale
    user = {
      id: row.id, username: row.username, name: row.name, active: Boolean(row.active), ver: row.token_ver, mustChange: Boolean(row.must_change),
      lastLogin: row.last_login, groups: groups.map((g) => ({ id: g.id, name: g.name })), tenantId, platform: tenantId == null, ...effective(groups, scopeOf(tenantId)),
    };
  }
  if (q === db) cache.set(id, { at: Date.now(), user });
  return user;
}

/** Leitura interna de uma conta já com permissões e escopo de canais efetivos.
 * Integrações de dispositivo usam isto em cada chamada para que troca de senha,
 * desativação ou retirada de um canal revogue o acesso sem confiar no cliente. */
export const getUser = async (id) => loadUser(Number(id));

/**
 * Usuários ativos de um cliente com permissões e canais já calculados, numa consulta só ao banco (lista "entra no ar sem
 * autorização" da mesa AO VIVO). Grupo de outro escopo nunca vale (a mesma regra do loadUser).
 */
export async function tenantUsersAccess(tenantId) {
  const rows = await db.all(`SELECT u.id, u.username, u.name, g.permissions, g.channels, g.tenant_id AS gt
    FROM users u LEFT JOIN user_groups ug ON ug.user_id = u.id LEFT JOIN access_groups g ON g.id = ug.group_id
    WHERE u.tenant_id = ? AND u.active = 1 ORDER BY u.name, u.username`, [tenantId]);
  const byId = new Map();
  for (const r of rows) {
    const id = Number(r.id);
    if (!byId.has(id)) byId.set(id, { id, username: r.username, name: r.name || r.username, groups: [] });
    if (r.permissions != null && Number(r.gt) === Number(tenantId)) byId.get(id).groups.push({ permissions: r.permissions, channels: r.channels });
  }
  return [...byId.values()].map(({ groups, ...u }) => ({ ...u, ...effective(groups, scopeOf(Number(tenantId))) }));
}

/** Dados do usuário para o painel: permissões já expandidas e canais. `tenant`: {id, slug, name, status} do cliente, quando houver. */
export const meDto = (u, tenant = null) => ({
  id: u.id, username: u.username, name: u.name, mustChange: u.mustChange, groups: u.groups,
  permissions: [...u.perms], channels: u.channels ? [...u.channels] : null,
  platform: Boolean(u.platform), tenantId: u.tenantId ?? null, impersonator: u.impersonator ? u.impersonator.username : null,
  tenant: tenant ? { id: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status } : null,
});

const tokenOf = (req) => (req.get('authorization') || '').replace(/^Bearer /i, '') || req.get('x-admin-token');
/** Cliente que o token declara (sem validar o usuário): serve só para escolher o canal padrão em rotas sem slug. */
export const peekTenantId = (req) => sessions.read(tokenOf(req))?.tid ?? null;

/* ------------------------------------------------------------------ "Sair": revogação de UM token (lista por jti) */
/*
 * Por que lista de revogação por token e não token_ver: "Sair" num aparelho não pode derrubar as outras sessões da pessoa
 * (celular do controle, painel no PC). O jti ("uid.nonce" do payload) vai para revoked_tokens com exp = validade do token,
 * no banco (vale entre reinícios e entre réplicas); a tabela é limpa periodicamente (pruneRevoked). "Sair de todos os
 * aparelhos" continua sendo token_ver + 1 (logoutAll).
 * Cache: revogado fica em memória até o processo reiniciar (nunca volta a valer); "não revogado" é relido do banco a cada
 * 2 s (outra réplica que revogou passa a valer aqui em até 2 s, como a troca de senha).
 */
const revokedCache = new Map(); // jti -> { at, revoked }
const REVOKED_TTL = 2000;
async function isRevoked(jti) {
  if (!jti) return false;
  const hit = revokedCache.get(jti);
  if (hit && (hit.revoked || Date.now() - hit.at < REVOKED_TTL)) return hit.revoked;
  const row = await db.get('SELECT 1 AS x FROM revoked_tokens WHERE jti = ?', [jti]);
  if (revokedCache.size > 20000) revokedCache.clear();
  revokedCache.set(jti, { at: Date.now(), revoked: Boolean(row) });
  return Boolean(row);
}

/**
 * Revoga o token DESTA requisição (só ele; as outras sessões do usuário continuam). Devolve true se revogou.
 * Também vale para o token de personificação (sair do painel do cliente encerra a personificação).
 */
export async function revokeRequestToken(req) {
  const t = sessions.read(tokenOf(req));
  if (!t?.jti) return false;
  await db.run('INSERT INTO revoked_tokens(jti, user_id, exp, created_at) VALUES(?,?,?,?) ON CONFLICT(jti) DO NOTHING', [t.jti, t.uid, Number(t.exp), Date.now()]);
  revokedCache.set(t.jti, { at: Date.now(), revoked: true });
  return true;
}

/** "Sair de todos os aparelhos": token_ver + 1 derruba TODOS os tokens do usuário (inclusive o atual). */
export async function logoutAll(userId) {
  await db.run('UPDATE users SET token_ver = token_ver + 1 WHERE id = ?', [userId]);
  invalidate();
}

/** Apaga da lista os tokens que já expiraram (não valeriam de qualquer forma). Devolve quantos saíram. */
export async function pruneRevoked(now = Date.now()) {
  const r = await db.run('DELETE FROM revoked_tokens WHERE exp < ?', [now]);
  for (const [k, v] of revokedCache) if (!v.revoked) revokedCache.delete(k);
  return r.changes;
}

/** Usuário da requisição, ou null se o token é inválido, expirou, foi revogado ou a conta está desativada. */
export async function authenticate(req) {
  const t = sessions.read(tokenOf(req));
  if (!t) return null;
  if (await isRevoked(t.jti)) return null;
  const u = await loadUser(t.uid);
  if (!u || !u.active || u.ver !== t.ver) return null;
  if (t.imp != null) {
    // personificação: a equipe da plataforma age como administrador de UM cliente, por até 1 h
    if (!u.platform || t.imp !== u.id || !u.perms.has('platform.impersonate')) return null;
    const tenant = await getTenant(t.tid);
    if (!tenant) return null;
    return {
      ...u, tenantId: tenant.id, platform: false, impersonator: { id: u.id, username: u.username }, mustChange: false,
      perms: new Set(PERM_IDS), channels: null, groups: [{ id: 0, name: 'Personificação (administrador do cliente)' }],
    };
  }
  return (u.tenantId ?? null) === (t.tid ?? null) ? u : null;
}

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Guarda de rota do painel do CLIENTE: exige sessão e QUALQUER uma das permissões listadas (vazio = só estar logado).
 * Define req.tenantId, recusa usuários da plataforma (sem personificação) e canais de outro cliente, e bloqueia escritas de
 * cliente suspenso/cancelado (402 tenant_suspended; allowSuspended libera, ex.: pagar a fatura).
 */
function guard(perms, { allowMustChange = false, tenantScoped = true, allowSuspended = false } = {}) {
  return async (req, res, next) => {
    try {
      const user = await authenticate(req);
      if (!user) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
      req.user = user; // já aqui, para a auditoria registrar também as tentativas negadas
      req.tenantId = user.tenantId;
      if (user.mustChange && !allowMustChange) return res.status(403).json({ error: 'Troque a senha para continuar.', code: 'must_change' });
      if (tenantScoped && user.platform) return res.status(403).json({ error: 'Esta rota é do painel de um cliente. Entre como um cliente (personificação) para usá-la.', code: 'platform_user' });
      if (perms.length && !perms.some((p) => user.perms.has(p))) return res.status(403).json({ error: 'Você não tem permissão para esta ação.', need: perms });
      if (tenantScoped) {
        if (req.ch && req.ch.tenantId !== user.tenantId) return res.status(403).json({ error: 'Você não tem acesso a este canal.' });
        if (req.ch && user.channels && !user.channels.has(req.ch.slug)) return res.status(403).json({ error: 'Você não tem acesso a este canal.' });
        if (!allowSuspended && WRITE.has(req.method)) {
          const tenant = await getTenant(user.tenantId);
          if (isBlocked(tenant)) {
            const e = suspendedError(tenant);
            return res.status(402).json({ error: e.message, ...e.extra });
          }
        }
      }
      next();
    } catch (err) { next(err); }
  };
}
export const needs = (...perms) => guard(perms);
/** Como needs(), mas continua valendo para cliente suspenso/cancelado (assinar/regularizar o plano). */
needs.allowSuspended = (...perms) => guard(perms, { allowSuspended: true });
export const signedIn = guard([], { allowMustChange: true, tenantScoped: false });

/**
 * Guarda das rotas da PLATAFORMA: needsPlatform(...perms) exige usuário da equipe (sem cliente), recusa token de cliente e
 * personificação, e pede QUALQUER uma das permissões listadas (vazio = só ser da equipe). Ex.: needsPlatform('platform.lab').
 */
export const needsPlatform = (...perms) => async (req, res, next) => {
  try {
    const user = await authenticate(req);
    if (!user) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    req.user = user;
    if (user.mustChange && !req.path.startsWith('/me')) return res.status(403).json({ error: 'Troque a senha para continuar.', code: 'must_change' });
    if (!user.platform || user.impersonator) return res.status(403).json({ error: 'Esta rota é exclusiva da equipe da plataforma.', code: 'not_platform' });
    if (perms.length && !perms.some((p) => user.perms.has(p))) return res.status(403).json({ error: 'Você não tem permissão para esta ação.', need: perms });
    next();
  } catch (err) { next(err); }
};

/** Token de personificação (1 h) para a equipe da plataforma agir como administrador do cliente. */
export function issueImpersonation(platformUser, tenantId) {
  const token = sessions.issue({ id: platformUser.id, ver: platformUser.ver, tenantId }, { imp: platformUser.id, ttlMs: IMPERSONATE_MS });
  return { token, expiresAt: Date.now() + IMPERSONATE_MS };
}
/** Só para testes: emite um token com relógio injetado. */
export const _issueAt = (user, opts) => sessions.issue(user, opts);

/* ------------------------------------------------------------------ auditoria */
let auditCount = 0;
export async function audit(entry) {
  try {
    await db.run('INSERT INTO audit_log(ts, user_id, username, action, detail, status, ip, tenant_id, impersonator) VALUES(?,?,?,?,?,?,?,?,?)', [
      entry.ts ?? Date.now(), entry.userId ?? null, String(entry.username ?? '').slice(0, 64), String(entry.action).slice(0, 120), String(entry.detail ?? '').slice(0, 300), entry.status ?? null, String(entry.ip ?? '').slice(0, 64),
      entry.tenantId ?? null, entry.impersonator ? String(entry.impersonator).slice(0, 64) : null,
    ]);
    if (++auditCount % 200 === 0) await db.run('DELETE FROM audit_log WHERE id <= (SELECT MAX(id) FROM audit_log) - 20000');
  } catch (err) { console.error('[audit]', err.message); }
}

/**
 * Auditoria. Cliente: sempre só as linhas do próprio cliente (tenantId obrigatório).
 * Plataforma: tenantId = 'platform' (só ações da equipe), um id (um cliente) ou vazio (tudo).
 */
export async function listAudit({ tenantId, limit = 200, before = 0, q = '' } = {}) {
  const where = []; const args = [];
  if (tenantId === 'platform') where.push('tenant_id IS NULL');
  else if (tenantId !== undefined && tenantId !== null && tenantId !== '') { where.push('tenant_id = ?'); args.push(Number(tenantId)); }
  if (before) { where.push('id < ?'); args.push(Number(before)); }
  if (q) { where.push('(LOWER(username) LIKE ? OR LOWER(action) LIKE ? OR LOWER(detail) LIKE ?)'); const like = `%${String(q).toLowerCase().slice(0, 60)}%`; args.push(like, like, like); }
  return db.all(`SELECT id, ts, user_id AS "userId", username, action, detail, status, ip, tenant_id AS "tenantId", impersonator FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`, [...args, Math.min(500, Math.max(1, Number(limit) || 200))]);
}

/* ------------------------------------------------------------------ grupos iniciais */
async function ensureGroup(name, description, perms, { tenantId, builtin = 0, channels = null }) {
  const t = tq('tenant_id', tenantId);
  const cur = await db.get(`SELECT id FROM access_groups WHERE name = ? AND ${t.sql}`, [name, ...t.args]);
  if (cur) {
    if (builtin) await db.run('UPDATE access_groups SET permissions = ?, channels = NULL, builtin = 1 WHERE id = ?', [JSON.stringify(perms), cur.id]); // permissões novas entram sozinhas
    return { id: cur.id, created: false };
  }
  const id = await db.insert('INSERT INTO access_groups(name, description, permissions, channels, builtin, created_at, tenant_id) VALUES(?,?,?,?,?,?,?)',
    [name, description, JSON.stringify(perms), channels, builtin, Date.now(), tenantId ?? null]);
  return { id, created: true };
}

/** Cria (se faltarem) os grupos de um cliente: Administradores (fixo, todas as permissões) + os de STARTER_GROUPS. Devolve o id do Administradores. */
export async function createTenantGroups(tenantId) {
  const admin = await ensureGroup(ADMIN_GROUP, 'Acesso total ao sistema, a todos os canais. Não pode ser excluído nem reduzido.', PERM_IDS, { tenantId, builtin: 1 });
  for (const g of STARTER_GROUPS) await ensureGroup(g.name, g.description, cleanPermissions(g.permissions), { tenantId });
  await setSetting(liveSeedKey(tenantId), '1'); // nasceu com o grupo "Ao vivo": a subida não o recria se o cliente apagar
  return admin.id;
}

/*
 * Grupo "Ao vivo (mesa e plantão)" nos clientes que já existiam (ele veio depois dos outros grupos padrão): acrescentado UMA
 * vez por cliente, na subida. A marca fica em settings (como feature_profiles_seeded, server/funcionalidades.js): com ela, o
 * cliente que apagou o grupo não o recebe de volta. Só acrescenta: grupo com esse nome que o cliente já tinha (ou editou)
 * fica como está (ensureGroup não altera grupo que não é fixo). Falha num cliente não derruba a subida nem os outros.
 */
export const liveSeedKey = (tenantId) => `access_group_live_seeded:tenant:${Number(tenantId)}`;
export async function seedLiveGroups() {
  const out = { created: [], skipped: 0 };
  for (const id of await listTenantIds()) {
    try {
      if ((await getSetting(liveSeedKey(id), '')) === '1') { out.skipped += 1; continue; }
      const r = await ensureGroup(LIVE_GROUP, LIVE_GROUP_DESCRIPTION, cleanPermissions(LIVE_GROUP_PERMISSIONS), { tenantId: id });
      await setSetting(liveSeedKey(id), '1');
      if (r.created) out.created.push(id);
    } catch (err) { console.warn(`[acesso] grupo "${LIVE_GROUP}" não semeado no cliente ${id}: ${err.message}`); }
  }
  if (out.created.length) { invalidate(); console.log(`[acesso] Grupo "${LIVE_GROUP}" acrescentado a ${out.created.length} cliente(s).`); }
  return out;
}
/** Id do grupo Administradores do cliente (criando-o se não existir). */
export async function adminGroupOf(tenantId) {
  const admin = await ensureGroup(ADMIN_GROUP, 'Acesso total ao sistema, a todos os canais. Não pode ser excluído nem reduzido.', PERM_IDS, { tenantId, builtin: 1 });
  return admin.id;
}

/* ------------------------------------------------------------------ início: cliente padrão, grupos, administradores e superadmin */
export async function bootstrap() {
  await ensureDefaults();
  // cliente padrão: primeira execução cria os 4 grupos; depois só mantém o Administradores atualizado
  const firstRun = !(await db.get('SELECT id FROM access_groups WHERE tenant_id = ? LIMIT 1', [DEFAULT_TENANT_ID]));
  if (firstRun) await createTenantGroups(DEFAULT_TENANT_ID);
  for (const id of await listTenantIds()) await adminGroupOf(id);
  await seedLiveGroups(); // clientes de antes do grupo "Ao vivo": acrescentado uma vez (idempotente)
  const adminId = await adminGroupOf(DEFAULT_TENANT_ID);
  // instalação local (edição Windows) sem ADMIN_PASSWORD: o primeiro administrador é criado na tela de ativação
  const edgeSetup = config.edge.enabled && !process.env.ADMIN_PASSWORD;
  if (edgeSetup && !(await db.get('SELECT id FROM users LIMIT 1'))) console.log('[acesso] Instalação local sem usuários: crie o administrador na tela de ativação (/setup/).');
  else if (!(await db.get('SELECT id FROM users LIMIT 1'))) {
    const id = await db.insert('INSERT INTO users(username, name, password_hash, active, created_at, tenant_id) VALUES(?,?,?,1,?,?)', [config.adminUser, 'Administrador', await hashPassword(config.adminPassword), Date.now(), DEFAULT_TENANT_ID]);
    await db.run('INSERT INTO user_groups(user_id, group_id) VALUES(?,?)', [id, adminId]);
    console.log(`[acesso] Usuário inicial "${config.adminUser}" criado com a senha de ADMIN_PASSWORD. ADMIN_PASSWORD só semeia este usuário: a partir de agora a senha vive no banco (troque em "Minha conta"; para recuperar o acesso use npm run admin:reset).`);
  }
  await bootstrapPlatform();
}

/** Grupos da plataforma e, se ainda não existir equipe, o superadmin (SUPERADMIN_USER / SUPERADMIN_PASSWORD). Nunca derruba o servidor. */
export async function bootstrapPlatform() {
  let superId = null;
  for (const g of PLATFORM_GROUPS) {
    const r = await ensureGroup(g.name, g.description, g.permissions, { tenantId: null, builtin: g.builtin });
    if (g.name === SUPER_GROUP) superId = r.id;
  }
  // instalação local: a equipe da plataforma age pela central, nunca com usuário neste computador
  if (config.edge.enabled) return;
  if (await db.get('SELECT id FROM users WHERE tenant_id IS NULL LIMIT 1')) return;
  const username = config.platform.superadminUser;
  let password = config.platform.superadminPassword;
  if (!USERNAME_RE.test(username)) { console.warn(`[plataforma] SUPERADMIN_USER inválido ("${username}"): superadmin NÃO criado.`); return; }
  if (config.production) {
    if (!password || password.length < 12) { console.warn('[plataforma] Em produção, defina SUPERADMIN_PASSWORD com 12+ caracteres para criar o superadmin. Superadmin NÃO criado (npm run admin:reset -- --platform <usuario> recupera o acesso).'); return; }
  } else if (!password) password = 'super123456';
  if (await db.get('SELECT id FROM users WHERE username = ?', [username])) { console.warn(`[plataforma] O usuário "${username}" já existe em um cliente (usuário é único na plataforma): superadmin NÃO criado. Troque SUPERADMIN_USER.`); return; }
  try { checkPasswordPolicy(password, { username, production: config.production }); } catch (err) { console.warn(`[plataforma] SUPERADMIN_PASSWORD recusada (${err.message}). Superadmin NÃO criado.`); return; }
  const id = await db.insert('INSERT INTO users(username, name, password_hash, active, created_at, tenant_id) VALUES(?,?,?,1,?,NULL)', [username, 'Superadmin', await hashPassword(password), Date.now()]);
  await db.run('INSERT INTO user_groups(user_id, group_id) VALUES(?,?)', [id, superId]);
  console.log(`[plataforma] Superadmin "${username}" criado${config.platform.superadminPassword ? ' com a senha de SUPERADMIN_PASSWORD' : ` com a senha de desenvolvimento "${password}" (defina SUPERADMIN_PASSWORD)`}. Painel da plataforma: /api/platform/login.`);
}

/** O cliente padrão (instalação local) já tem algum usuário? */
export const hasLocalUsers = async () => Boolean(await db.get('SELECT id FROM users WHERE tenant_id = ? LIMIT 1', [DEFAULT_TENANT_ID]));

/**
 * Edição Windows: cria o primeiro administrador do cliente padrão na tela de ativação. Só funciona enquanto o cliente
 * padrão não tem nenhum usuário; segue a mesma política de senha do resto do sistema.
 */
export async function createInitialAdmin(username, password, name = 'Administrador') {
  const u = String(username || '').trim().toLowerCase();
  if (!USERNAME_RE.test(u)) throw fail(400, 'Usuário inválido: use 3 a 64 caracteres (letras, números, ponto, hífen, sublinhado ou um e-mail).');
  checkPasswordPolicy(String(password || ''), { username: u, production: config.production });
  if (await hasLocalUsers()) throw fail(409, 'Este computador já tem um administrador. Entre pelo painel.');
  if (await db.get('SELECT id FROM users WHERE username = ?', [u])) throw fail(409, 'Esse usuário já existe.');
  const adminId = await adminGroupOf(DEFAULT_TENANT_ID);
  const id = await db.insert('INSERT INTO users(username, name, password_hash, active, created_at, tenant_id) VALUES(?,?,?,1,?,?)', [u, String(name || 'Administrador').slice(0, 80), await hashPassword(password), Date.now(), DEFAULT_TENANT_ID]);
  await db.run('INSERT INTO user_groups(user_id, group_id) VALUES(?,?)', [id, adminId]);
  invalidate();
  await audit({ userId: id, username: u, action: 'ativação', detail: 'administrador inicial criado na tela de ativação', status: 201, tenantId: DEFAULT_TENANT_ID });
  return { id, username: u };
}

/* ------------------------------------------------------------------ login */
/**
 * opts.tenant: cliente (linha de tenants) onde o usuário tenta entrar; opts.platform: login da equipe da plataforma.
 * Usuário de outro cliente (ou da plataforma no login do cliente) recebe o mesmo erro de senha errada e não conta tentativa.
 */
export async function login(username, password, ip, opts = {}) {
  const name = String(username || '').trim().toLowerCase().slice(0, 64);
  const row = name ? await db.get('SELECT * FROM users WHERE username = ?', [name]) : null;
  const rowTenant = row ? (row.tenant_id == null ? null : Number(row.tenant_id)) : undefined;
  const inScope = Boolean(row) && (opts.platform ? rowTenant === null : Boolean(opts.tenant) && rowTenant === opts.tenant.id);
  const auditTenant = opts.platform ? null : (opts.tenant?.id ?? null);
  if (row && inScope && row.locked_until > Date.now()) {
    // o mesmo scrypt de uma tentativa comum: a conta bloqueada não responde mais rápido que a inexistente (a ponte do NEXA
    // MAM troca este 429 pela recusa genérica, e o tempo também não pode dizer que a conta existe)
    await verifyPassword(password ?? '', DUMMY_HASH);
    const min = Math.ceil((row.locked_until - Date.now()) / 60000);
    await audit({ userId: row.id, username: name, action: 'login bloqueado', detail: 'conta bloqueada por tentativas', status: 429, ip, tenantId: auditTenant });
    throw fail(429, `Conta bloqueada por excesso de tentativas. Tente de novo em ${min} min.`);
  }
  const ok = await verifyPassword(password ?? '', row && inScope ? row.password_hash : DUMMY_HASH);
  if (!row || !inScope || !ok || !row.active) {
    if (row && inScope && !ok) {
      const failed = row.failed + 1;
      const lock = failed >= LOCK_AFTER;
      await db.run('UPDATE users SET failed = ?, locked_until = ? WHERE id = ?', [lock ? 0 : failed, lock ? Date.now() + LOCK_MS : 0, row.id]);
    }
    await audit({ userId: inScope ? row?.id : undefined, username: name, action: 'login falhou', detail: row && inScope && !row.active ? 'conta desativada' : row && !inScope ? 'usuário de outro escopo' : 'senha ou usuário incorretos', status: 401, ip, tenantId: auditTenant });
    throw fail(401, inScope && row && !row.active && ok ? 'Esta conta está desativada.' : 'Usuário ou senha incorretos.');
  }
  await db.run('UPDATE users SET failed = 0, locked_until = 0, last_login = ? WHERE id = ?', [Date.now(), row.id]);
  invalidate();
  const user = await loadUser(row.id);
  await audit({ userId: user.id, username: user.username, action: opts.platform ? 'login (plataforma)' : 'login', status: 200, ip, tenantId: auditTenant });
  return { token: sessions.issue(user), user: meDto(user, opts.tenant) };
}

/* ------------------------------------------------------------------ senha */
async function setPasswordRow(q, id, password, { mustChange = false } = {}) {
  await q.run('UPDATE users SET password_hash = ?, token_ver = token_ver + 1, must_change = ?, failed = 0, locked_until = 0 WHERE id = ?', [await hashPassword(password), mustChange ? 1 : 0, id]);
}

/** O próprio usuário troca a senha. Encerra as outras sessões e devolve um token novo. */
export async function changeOwnPassword(userId, current, next) {
  const row = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!row || !(await verifyPassword(current ?? '', row.password_hash))) throw fail(400, 'A senha atual está incorreta.');
  checkPasswordPolicy(next, { username: row.username, production: config.production });
  if (await verifyPassword(next, row.password_hash)) throw fail(400, 'A nova senha precisa ser diferente da atual.');
  await setPasswordRow(db, userId, next);
  invalidate();
  const user = await loadUser(userId);
  return { token: sessions.issue(user), user: meDto(user, user.tenantId != null ? await getTenant(user.tenantId) : null) };
}

/* ------------------------------------------------------------------ usuários (escopo: um cliente, ou a plataforma com tenantId nulo) */
/** Garante que sobra quem administre: cliente = ao menos um usuário ativo com users.manage; plataforma = ao menos um superadmin ativo. */
async function assertAdminRemains(q, tenantId) {
  let r;
  if (tenantId == null) {
    r = await q.get(`SELECT COUNT(DISTINCT u.id) AS n FROM users u JOIN user_groups ug ON ug.user_id = u.id JOIN access_groups g ON g.id = ug.group_id
      WHERE u.active = 1 AND u.tenant_id IS NULL AND g.tenant_id IS NULL AND g.builtin = 1`);
    if (!r || Number(r.n) < 1) throw fail(400, 'A plataforma precisa manter pelo menos um superadmin ativo.');
    return;
  }
  r = await q.get(`SELECT COUNT(DISTINCT u.id) AS n FROM users u JOIN user_groups ug ON ug.user_id = u.id JOIN access_groups g ON g.id = ug.group_id
    WHERE u.active = 1 AND u.tenant_id = ? AND g.tenant_id = ? AND g.permissions LIKE '%"users.manage"%'`, [tenantId, tenantId]);
  if (!r || Number(r.n) < 1) throw fail(400, 'O sistema precisa manter pelo menos um usuário ativo com permissão para gerenciar usuários.');
}

const userRow = (u, groups) => ({
  id: u.id, username: u.username, name: u.name, active: Boolean(u.active), mustChange: Boolean(u.must_change),
  lastLogin: u.last_login, createdAt: u.created_at, locked: u.locked_until > Date.now(), groups: groups.filter((g) => g.user_id === u.id).map((g) => ({ id: g.group_id, name: g.name })),
});

export async function listUsers(tenantId) {
  const t = tq('u.tenant_id', tenantId);
  const [users, links] = await Promise.all([
    db.all(`SELECT u.* FROM users u WHERE ${t.sql} ORDER BY u.username`, t.args),
    db.all(`SELECT ug.user_id, ug.group_id, g.name FROM user_groups ug JOIN access_groups g ON g.id = ug.group_id JOIN users u ON u.id = ug.user_id WHERE ${t.sql} ORDER BY g.name`, t.args),
  ]);
  return users.map((u) => userRow(u, links));
}

async function checkGroupIds(q, ids, tenantId) {
  const list = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
  const t = tq('tenant_id', tenantId);
  for (const id of list) if (!(await q.get(`SELECT id FROM access_groups WHERE id = ? AND ${t.sql}`, [id, ...t.args]))) throw fail(400, 'Grupo inexistente.');
  return list;
}

const cleanName = (s) => {
  const v = String(s ?? '').trim();
  if (!v || v.length > 80) throw fail(400, 'Informe o nome (até 80 caracteres).');
  return v;
};

export async function createUser(body, tenantId = null) {
  const username = String(body.username ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw fail(400, 'Usuário: 3 a 64 caracteres, só letras minúsculas, números, ponto, hífen, sublinhado e @ (e-mail). O usuário é único na plataforma.');
  const name = cleanName(body.name || username);
  checkPasswordPolicy(body.password, { username, production: config.production });
  const hash = await hashPassword(body.password);
  const id = await db.tx(async (t) => {
    if (await t.get('SELECT id FROM users WHERE username = ?', [username])) throw fail(400, 'Já existe um usuário com esse nome.');
    const groupIds = await checkGroupIds(t, body.groupIds, tenantId);
    const uid = await t.insert('INSERT INTO users(username, name, password_hash, active, must_change, created_at, tenant_id) VALUES(?,?,?,?,?,?,?)', [username, name, hash, body.active === false ? 0 : 1, body.mustChange ? 1 : 0, Date.now(), tenantId]);
    for (const g of groupIds) await t.run('INSERT INTO user_groups(user_id, group_id) VALUES(?,?)', [uid, g]);
    return uid;
  });
  invalidate();
  return (await listUsers(tenantId)).find((u) => u.id === id);
}

const inScopeUser = async (q, id, tenantId) => {
  const t = tq('tenant_id', tenantId);
  return q.get(`SELECT * FROM users WHERE id = ? AND ${t.sql}`, [id, ...t.args]);
};

export async function updateUser(id, body, actorId, tenantId = null) {
  await db.tx(async (t) => {
    const row = await inScopeUser(t, id, tenantId);
    if (!row) throw fail(404, 'Usuário inexistente.');
    const sets = []; const args = [];
    if (body.name !== undefined) { sets.push('name = ?'); args.push(cleanName(body.name)); }
    if (body.active !== undefined) {
      if (!body.active && id === actorId) throw fail(400, 'Você não pode desativar a própria conta.');
      sets.push('active = ?'); args.push(body.active ? 1 : 0);
      if (!body.active) sets.push('token_ver = token_ver + 1'); // derruba as sessões abertas
    }
    if (body.unlock) { sets.push('failed = 0', 'locked_until = 0'); }
    if (sets.length) await t.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...args, id]);
    if (body.groupIds !== undefined) {
      const groupIds = await checkGroupIds(t, body.groupIds, tenantId);
      await t.run('DELETE FROM user_groups WHERE user_id = ?', [id]);
      for (const g of groupIds) await t.run('INSERT INTO user_groups(user_id, group_id) VALUES(?,?)', [id, g]);
    }
    await assertAdminRemains(t, tenantId);
  });
  invalidate();
  return (await listUsers(tenantId)).find((u) => u.id === id);
}

export async function resetPassword(id, password, { mustChange = true } = {}, tenantId = null) {
  const row = await inScopeUser(db, id, tenantId);
  if (!row) throw fail(404, 'Usuário inexistente.');
  checkPasswordPolicy(password, { username: row.username, production: config.production });
  await setPasswordRow(db, id, password, { mustChange });
  invalidate();
}

export async function deleteUser(id, actorId, tenantId = null) {
  if (id === actorId) throw fail(400, 'Você não pode excluir a própria conta.');
  await db.tx(async (t) => {
    if (!(await inScopeUser(t, id, tenantId))) throw fail(404, 'Usuário inexistente.');
    await t.run('DELETE FROM user_groups WHERE user_id = ?', [id]);
    await t.run('DELETE FROM users WHERE id = ?', [id]);
    await assertAdminRemains(t, tenantId);
  });
  invalidate();
}

/** Administrador ativo do cliente (o primeiro do grupo Administradores), para redefinir senha pela plataforma. */
export async function tenantAdmins(tenantId) {
  const gid = await adminGroupOf(tenantId);
  return db.all('SELECT u.id, u.username, u.name, u.active FROM users u JOIN user_groups ug ON ug.user_id = u.id WHERE ug.group_id = ? AND u.tenant_id = ? ORDER BY u.active DESC, u.id', [gid, tenantId]);
}

/* ------------------------------------------------------------------ grupos */
const groupDto = (g, members) => ({
  id: g.id, name: g.name, description: g.description, builtin: Boolean(g.builtin),
  permissions: cleanPermissions(j(g.permissions, []), scopeOf(g.tenant_id == null ? null : Number(g.tenant_id))), channels: g.channels == null ? null : j(g.channels, []),
  members: members.filter((m) => m.group_id === g.id).map((m) => ({ id: m.user_id, username: m.username })),
});

export async function listGroups(tenantId) {
  const t = tq('g.tenant_id', tenantId);
  const [groups, members] = await Promise.all([
    db.all(`SELECT g.* FROM access_groups g WHERE ${t.sql} ORDER BY g.builtin DESC, g.name`, t.args),
    db.all(`SELECT ug.group_id, ug.user_id, u.username FROM user_groups ug JOIN users u ON u.id = ug.user_id JOIN access_groups g ON g.id = ug.group_id WHERE ${t.sql} ORDER BY u.username`, t.args),
  ]);
  return groups.map((g) => groupDto(g, members));
}

function cleanGroup(body, knownSlugs, tenantId) {
  const out = {};
  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (n.length < 2 || n.length > 40) throw fail(400, 'Nome do grupo: de 2 a 40 caracteres.');
    out.name = n;
  }
  if (body.description !== undefined) out.description = String(body.description).slice(0, 200);
  if (body.permissions !== undefined) out.permissions = JSON.stringify(cleanPermissions(body.permissions, scopeOf(tenantId)));
  if (body.channels !== undefined && tenantId != null) {
    if (body.channels === null) out.channels = null;
    else {
      const list = [...new Set((Array.isArray(body.channels) ? body.channels : []).map(String))].filter((s) => knownSlugs.includes(s));
      out.channels = JSON.stringify(list);
    }
  }
  return out;
}

export async function createGroup(body, knownSlugs, tenantId = null) {
  const g = cleanGroup({ channels: null, permissions: [], ...body }, knownSlugs, tenantId);
  if (!g.name) throw fail(400, 'Informe o nome do grupo.');
  const t = tq('tenant_id', tenantId);
  if (await db.get(`SELECT id FROM access_groups WHERE name = ? AND ${t.sql}`, [g.name, ...t.args])) throw fail(400, 'Já existe um grupo com esse nome.');
  const id = await db.insert('INSERT INTO access_groups(name, description, permissions, channels, builtin, created_at, tenant_id) VALUES(?,?,?,?,0,?,?)', [g.name, g.description ?? '', g.permissions, g.channels ?? null, Date.now(), tenantId]);
  return (await listGroups(tenantId)).find((x) => x.id === id);
}

export async function updateGroup(id, body, knownSlugs, tenantId = null) {
  await db.tx(async (t) => {
    const tt = tq('tenant_id', tenantId);
    const cur = await t.get(`SELECT * FROM access_groups WHERE id = ? AND ${tt.sql}`, [id, ...tt.args]);
    if (!cur) throw fail(404, 'Grupo inexistente.');
    const g = cleanGroup(body, knownSlugs, tenantId);
    if (cur.builtin) { delete g.permissions; delete g.channels; delete g.name; } // o administrador (ou superadmin) é fixo
    if (g.name && g.name !== cur.name && await t.get(`SELECT id FROM access_groups WHERE name = ? AND ${tt.sql}`, [g.name, ...tt.args])) throw fail(400, 'Já existe um grupo com esse nome.');
    const keys = Object.keys(g);
    if (keys.length) await t.run(`UPDATE access_groups SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => g[k]), id]);
    await assertAdminRemains(t, tenantId);
  });
  invalidate();
  return (await listGroups(tenantId)).find((x) => x.id === id);
}

export async function deleteGroup(id, tenantId = null) {
  await db.tx(async (t) => {
    const tt = tq('tenant_id', tenantId);
    const cur = await t.get(`SELECT * FROM access_groups WHERE id = ? AND ${tt.sql}`, [id, ...tt.args]);
    if (!cur) throw fail(404, 'Grupo inexistente.');
    if (cur.builtin) throw fail(400, tenantId == null ? 'O grupo de superadministradores não pode ser excluído.' : 'O grupo de administradores não pode ser excluído.');
    await t.run('DELETE FROM user_groups WHERE group_id = ?', [id]);
    await t.run('DELETE FROM access_groups WHERE id = ?', [id]);
    await assertAdminRemains(t, tenantId);
  });
  invalidate();
}
