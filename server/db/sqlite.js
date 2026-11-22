import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { sqliteDDL, sqliteIndexes } from './schema.js';

/** Acima disto (no Windows) o SQLite costuma falhar com "unable to open database file": MAX_PATH = 260, menos "-wal"/"-shm". */
export const WIN_SQLITE_PATH_MAX = 240;

/**
 * Aviso para o log de boot quando o caminho do banco é longo demais para o SQLite no Windows (null se está tudo bem).
 * Acontece em pastas temporárias/de sincronização muito aninhadas (ex.: AppData\Roaming\...\scratch-...).
 */
export function sqlitePathWarning(file, platform = process.platform) {
  const full = path.resolve(String(file));
  if (platform !== 'win32' || full.length <= WIN_SQLITE_PATH_MAX) return null;
  return `[db] AVISO: o caminho do banco SQLite tem ${full.length} caracteres (${full}). No Windows o SQLite não abre arquivos com caminho acima de ~${WIN_SQLITE_PATH_MAX} caracteres e falha com "unable to open database file". `
    + 'Use um DATA_DIR curto, por exemplo DATA_DIR=C:\\digitalisp-dados (ou C:\\t\\pol para testes), ou defina DATABASE_URL para usar Postgres.';
}

/**
 * Driver SQLite (desenvolvimento local, testes e instalações de um servidor só).
 * Expõe a mesma API assíncrona do driver Postgres: get, all, run, insert, exec, tx.
 * O node:sqlite é síncrono por baixo; aqui apenas devolvemos promessas.
 */
export function createSqlite(file) {
  const warning = sqlitePathWarning(file);
  if (warning) console.warn(warning);
  let raw;
  try {
    raw = new DatabaseSync(file);
    // a abertura é preguiçosa em alguns casos: o primeiro comando também pode falhar pelo caminho
    raw.exec('PRAGMA user_version');
  } catch (err) {
    if (warning) throw new Error(`Não foi possível abrir o banco SQLite (${err.message}): o caminho é longo demais para o Windows. Use um DATA_DIR curto, por exemplo DATA_DIR=C:\\digitalisp-dados.`);
    if (/unable to open/i.test(err.message)) throw new Error(`Não foi possível abrir o banco SQLite em ${path.resolve(String(file))} (${err.message}). Confira se a pasta existe e tem permissão de escrita, ou defina outro DATA_DIR.`);
    throw err;
  }
  // busy_timeout: outro processo no mesmo arquivo (npm run admin:reset com o servidor no ar) espera em vez de falhar
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  raw.exec(sqliteDDL); // banco novo do DIGITAL ISP: o esquema já nasce na forma final (server/db/schema.js)
  raw.exec(sqliteIndexes);

  let lock = Promise.resolve(); // serializa transações: o SQLite tem uma única conexão

  const api = {
    driver: 'sqlite',
    raw,
    async get(sql, params = []) { return raw.prepare(sql).get(...params); },
    async all(sql, params = []) { return raw.prepare(sql).all(...params); },
    async run(sql, params = []) { const r = raw.prepare(sql).run(...params); return { changes: Number(r.changes) }; },
    async insert(sql, params = []) { const r = raw.prepare(sql).run(...params); return Number(r.lastInsertRowid); },
    async exec(sql) { raw.exec(sql); },
    async tx(fn) {
      const prev = lock;
      let release;
      lock = new Promise((r) => { release = r; });
      await prev;
      try {
        raw.exec('BEGIN');
        const out = await fn(api);
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        try { raw.exec('ROLLBACK'); } catch { /* já revertido */ }
        throw e;
      } finally { release(); }
    },
    async close() { raw.close(); },
  };
  return api;
}
