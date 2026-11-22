// Pastas temporárias dos testes (os.tmpdir()/nexa-*): criadas com mkdtemp e APAGADAS no fim, mesmo com o teste falhando.
// Em 10/10/2026 o %TEMP% do usuário tinha 12.989 pastas nexa-* (4,4 GB só nas 2.000 primeiras) e o C: chegou a 1,9 GB
// livres: o DATA_DIR criado no topo de cada arquivo de teste nunca era apagado, e um processo morto pelo prazo não
// chegava ao finally.
//   - tmpDir('nexa-troca', t?): cria; apaga no t.after (com t) e, de qualquer jeito, na saída do processo do arquivo.
//   - trackDir(dir): registra uma pasta criada de outro jeito (servidor de teste, Postgres) para apagar na saída.
//   - removeDir(dir): apaga sem seguir junções nem links (fs.rm trata a junção como link: remove só ela; conferido no
//     Windows com o Node 24) e diz se sumiu.
// Arquivo ainda aberto no Windows (o SQLite do próprio processo, um filho que demorou a sair) não deixa apagar na saída: um
// faxineiro destacado espera este processo terminar e tenta de novo por até 1 min. Processo morto à força não roda nada
// disso: scripts/limpar-temp-testes.mjs apaga as sobras antigas antes de cada suíte.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TMP_NAME_RE = /^nexa-[A-Za-z0-9-]+$/;
const dirs = new Set();

/** Apaga a pasta (sem seguir junções/links). true se ela não existe mais. */
export function removeDir(dir, { retries = 4, delay = 200 } = {}) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: retries, retryDelay: delay }); } catch { /* aberta: fica para depois */ }
  return !fs.existsSync(dir);
}

/**
 * Pasta nova em os.tmpdir() com o prefixo (ex.: 'nexa-troca' → nexa-troca-AbC123), apagada no fim. t: o contexto do
 * teste (opcional) → apaga no t.after; sem t (topo do arquivo), na saída do processo.
 */
export function tmpDir(prefix, t = null) {
  const base = String(prefix).replace(/-+$/, '');
  if (!TMP_NAME_RE.test(base)) throw new Error(`prefixo de pasta temporária inválido: ${prefix} (use nexa-…)`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${base}-`));
  dirs.add(dir);
  if (t?.after) t.after(() => { if (removeDir(dir)) dirs.delete(dir); });
  return dir;
}

/** Registra uma pasta criada fora daqui para apagar na saída do processo. Devolve a própria pasta. */
export function trackDir(dir) {
  if (dir) dirs.add(path.resolve(dir));
  return dir;
}
/** Já apagou (ou outro vai apagar): sai do registro. */
export function untrackDir(dir) { if (dir) dirs.delete(path.resolve(dir)); }

// faxineiro: espera o processo pai sair (os arquivos abertos dele soltam) e apaga, tentando por até 1 min
const JANITOR = `
const fs = require('node:fs');
const [pid, ...list] = process.argv.slice(1);
const alive = () => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 600 && alive(); i++) await sleep(100);
  for (let k = 0; k < 30 && list.some((d) => fs.existsSync(d)); k++) {
    for (const d of list) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
    await sleep(2000);
  }
})();
`;

process.on('exit', () => {
  // na saída: sem esperar (handler síncrono); o que estiver aberto vai para o faxineiro
  const left = [...dirs].filter((d) => !removeDir(d, { retries: 0 }));
  if (!left.length) return;
  try {
    spawn(process.execPath, ['-e', JANITOR, String(process.pid), ...left], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch { /* sem faxineiro: o script de limpeza pega depois */ }
});
