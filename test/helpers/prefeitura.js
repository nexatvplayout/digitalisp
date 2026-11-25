// Ajudantes dos testes da prefeitura (modo órgão público) no modelo do DIGITAL ISP.
// Os testes vieram do NEXA Broadcast, onde a prefeitura tinha um canal no ar (POST /api/channels) e o painel tinha as telas de
// usuários, grupos e auditoria. Aqui o canal é um canal ao vivo (HLS) da conta, e os usuários de permissão limitada e a
// auditoria vão direto ao banco do servidor de teste (SQLite ou o Postgres embutido, conforme o boot).
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { hashPassword } from '../../server/authcore.js';

/**
 * Cadastra um canal ao vivo (HLS) na conta: { id, slug: 'hls-<id>', name, url }. O endereço fica no formato do canal do NEXA
 * (https://hls.exemplo.test/hls/<slug>/index.m3u8), para as conferências do endereço do vídeo seguirem iguais.
 */
export async function canal(T, name) {
  const r = await T('POST', '/api/hls', { nome: name, url: 'https://hls.exemplo.test/hls/novo/index.m3u8' });
  if (r.status !== 201) throw new Error(`canal ${name}: ${r.status} ${JSON.stringify(r.data)}`);
  const u = await T('PATCH', `/api/hls/${r.data.id}`, { url: `https://hls.exemplo.test/hls/${r.data.slug}/index.m3u8` });
  if (u.status !== 200) throw new Error(`canal ${name}: ${u.status} ${JSON.stringify(u.data)}`);
  return u.data;
}

/** Roda fn(q) no banco do servidor s (q(sql, params) -> { rows, id }), SQLite ou Postgres; placeholders "?". */
async function noBanco(s, fn) {
  if (s.databaseUrl) {
    const c = new pg.Client({ connectionString: s.databaseUrl });
    await c.connect();
    try {
      return await fn(async (sql, params = []) => {
        let i = 0;
        const r = await c.query(sql.replace(/\?/g, () => `$${++i}`), params);
        return { rows: r.rows, id: r.rows[0]?.id != null ? Number(r.rows[0].id) : null };
      });
    } finally { await c.end(); }
  }
  const db = new DatabaseSync(path.join(s.dataDir, 'digitalisp.db'), { timeout: 15000 });
  try {
    return await fn(async (sql, params = []) => {
      const st = db.prepare(sql.replace(/ RETURNING id$/, ''));
      if (/^\s*select/i.test(sql)) return { rows: st.all(...params), id: null };
      return { rows: [], id: Number(st.run(...params).lastInsertRowid) };
    });
  } finally { db.close(); }
}

/**
 * Um usuário da conta com um grupo próprio (as permissões dadas), gravado como o cadastro faria. channels: a restrição a
 * canais do grupo (lista de slugs), como no NEXA.
 */
export async function usuario(s, tenantId, { username, password, permissions = [], channels = null, name = username }) {
  const hash = await hashPassword(password);
  return noBanco(s, async (q) => {
    const t = Date.now();
    const g = await q('INSERT INTO access_groups(name, description, permissions, channels, builtin, created_at, tenant_id) VALUES(?,?,?,?,?,?,?) RETURNING id',
      [`Grupo ${username}`, '', JSON.stringify(permissions), channels ? JSON.stringify(channels) : null, 0, t, tenantId]);
    const u = await q('INSERT INTO users(username, name, password_hash, active, must_change, created_at, tenant_id) VALUES(?,?,?,?,?,?,?) RETURNING id',
      [username, name, hash, 1, 0, t, tenantId]);
    await q('INSERT INTO user_groups(user_id, group_id) VALUES(?,?)', [u.id, g.id]);
    return { id: u.id, groupId: g.id };
  });
}

/** As linhas da auditoria da conta (o que a tela de auditoria do NEXA mostrava; o DIGITAL ISP não tem essa tela). */
export async function auditoria(s, tenantId) {
  return noBanco(s, async (q) => (await q('SELECT ts, username, action, detail, status FROM audit_log WHERE tenant_id = ? ORDER BY id DESC', [tenantId])).rows);
}
