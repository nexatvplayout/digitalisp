import pg from 'pg';
import { pgDDL, pgMigrate, pgIndexes } from './schema.js';

// BIGINT (int8) chega como texto: ids, epoch e contagens cabem com folga em Number (< 2^53).
pg.types.setTypeParser(20, (v) => Number(v));

/** Converte placeholders "?" em $1, $2… (o SQL do app é escrito com "?" para os dois drivers). */
export const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

/** Cria o esquema (idempotente), com lock consultivo para duas réplicas subindo juntas não brigarem. */
export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    try {
      await client.query(pgDDL);
      await client.query(pgMigrate);
      await client.query(pgIndexes);
    } finally {
      await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    }
  } finally { client.release(); }
}

/**
 * Driver Postgres (Neon, Railway Postgres, qualquer Postgres 13+).
 * Neon: use a URL com sslmode=require. Com o pooler do Neon (PgBouncer em modo transação) funciona,
 * pois nenhuma instrução preparada nomeada nem estado de sessão é usado.
 */
export async function createPg(connectionString, { max = Number(process.env.DB_POOL_MAX || 8) } = {}) {
  const pool = new pg.Pool({ connectionString, max, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[db] erro no pool:', e.message));
  await migrate(pool);

  const exec = (client) => ({
    driver: 'pg',
    async get(sql, params = []) { return (await client.query(toPg(sql), params)).rows[0]; },
    async all(sql, params = []) { return (await client.query(toPg(sql), params)).rows; },
    async run(sql, params = []) { return { changes: (await client.query(toPg(sql), params)).rowCount }; },
    async insert(sql, params = []) { return (await client.query(`${toPg(sql)} RETURNING id`, params)).rows[0].id; },
    async exec(sql) { await client.query(sql); },
  });

  const api = {
    ...exec(pool),
    raw: pool,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(exec(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* conexão já quebrada */ }
        throw e;
      } finally { client.release(); }
    },
    async close() { await pool.end(); },
  };
  return api;
}
