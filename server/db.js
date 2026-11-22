import { config } from './config.js';
import { createSqlite } from './db/sqlite.js';
import { createPg } from './db/pg.js';

/**
 * Banco de dados do playout. API única e assíncrona, dois drivers:
 *   - DATABASE_URL definida  -> Postgres (Neon, Railway, …)
 *   - caso contrário         -> SQLite em DATA_DIR/playout.db
 *
 *   await db.get(sql, [params])      uma linha (ou undefined)
 *   await db.all(sql, [params])      várias linhas
 *   await db.run(sql, [params])      {changes}
 *   await db.insert(sql, [params])   id gerado
 *   await db.tx(async (t) => {...})  transação (t tem a mesma API)
 *
 * Escreva SQL com "?" e aliases entre aspas quando precisar de maiúsculas ("startedAt"): o Postgres
 * converte identificadores sem aspas para minúsculas.
 */
export const db = config.databaseUrl ? await createPg(config.databaseUrl) : createSqlite(config.dbFile);

export const getSetting = async (key, fallback = null) => {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : fallback;
};

export const setSetting = (key, value) => db.run(
  'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  [key, String(value)],
);

/** Atalho: executa fn dentro de uma transação. */
export const tx = (fn) => db.tx(fn);
