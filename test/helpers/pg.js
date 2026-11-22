import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpDir, removeDir, untrackDir } from './tmp.js'; // a pasta nexa-pg-* sai no fim mesmo com o teste falhando
import { killTree } from './srv.js';

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

const cleanDir = (dir) => {
  // no Windows os arquivos podem demorar a ser liberados; limpar o temporário nunca deve derrubar o teste (o que sobrar, a
  // saída do processo tenta de novo: tmp.js)
  if (removeDir(dir, { retries: 8, delay: 400 })) untrackDir(dir);
};

// Postgres ainda no ar quando o processo do arquivo sai (o teste falhou ou acabou sem o stop): derrubado ANTES de apagar
// as pastas (prependListener: roda antes da limpeza do tmp.js). Antes, o postgres.exe órfão seguia vivo segurando a
// nexa-pg-* (50–77 MB cada; 727 delas no %TEMP% em 10/10/2026).
const running = new Set();
process.prependListener('exit', () => { for (const p of running) if (p?.pid && p.exitCode === null && !p.signalCode) killTree(p.pid); });

/**
 * Banco descartável: memória compartilhada pequena e sem fsync. Com várias suítes na máquina, os 128 MB que cada instância
 * reserva de saída no Windows (memória comprometida) e as escritas em disco derrubavam ou atrasavam os testes.
 */
const PG_FLAGS = ['-c', 'shared_buffers=16MB', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off'];
const within = (promise, ms, what) => Promise.race([promise, new Promise((_, rej) => { setTimeout(() => rej(new Error(what)), ms).unref(); })]);

/**
 * Plano B para o Windows empacotado (MSIX): o CreateProcess não executa binários dentro da pasta virtualizada do app
 * (spawn dá ENOENT mesmo com o arquivo lá). Copia os binários do embedded-postgres para o temporário REAL do sistema
 * (uma vez, reaproveita nas execuções seguintes) e roda initdb/postgres de lá, com os mesmos parâmetros da biblioteca.
 */
async function startPgFromCopy() {
  const idx = fileURLToPath(import.meta.resolve('@embedded-postgres/windows-x64'));
  const native = path.resolve(path.dirname(idx), '..', 'native');
  const home = path.join(os.tmpdir(), 'nexa-pg-native');
  const bin = (n) => path.join(home, 'bin', n);
  if (!fs.existsSync(bin('postgres.exe')) || !fs.existsSync(bin('initdb.exe'))) {
    // cópia atômica: vários testes rodam em paralelo; quem perder a corrida só descarta a própria cópia
    const part = `${home}.${process.pid}`;
    fs.rmSync(part, { recursive: true, force: true });
    fs.cpSync(native, part, { recursive: true });
    try { fs.renameSync(part, home); } catch { fs.rmSync(part, { recursive: true, force: true }); }
  }
  const dir = tmpDir('nexa-pg');
  const port = await freePort();
  const pwfile = path.join(os.tmpdir(), `pg-pw-${process.pid}-${Date.now()}`);
  fs.writeFileSync(pwfile, 'nexa\n');
  const env = { ...process.env, LC_MESSAGES: 'C' };
  try {
    const init = spawnSync(bin('initdb.exe'), [`--pgdata=${dir}`, '--auth=password', '--username=nexa', `--pwfile=${pwfile}`, '--lc-messages=C', '--no-sync'], { env, encoding: 'utf8' });
    if (init.status !== 0) throw new Error(`initdb falhou: ${init.error?.message || init.stderr}`);
  } finally { fs.rmSync(pwfile, { force: true }); }
  const proc = spawn(bin('postgres.exe'), ['-D', dir, '-p', String(port), ...PG_FLAGS], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  running.add(proc);
  proc.once('exit', () => running.delete(proc));
  await new Promise((resolve, reject) => {
    let log = '';
    const t = setTimeout(() => reject(new Error(`postgres não ficou pronto em 60 s:\n${log}`)), 60000);
    proc.stderr.on('data', (d) => { log += d; if (String(d).includes('ready to accept connections')) { clearTimeout(t); resolve(); } });
    proc.on('close', () => { clearTimeout(t); reject(new Error(`postgres encerrou ao subir:\n${log}`)); });
  });
  const { default: pg } = await import('pg');
  const admin = new pg.Client({ user: 'nexa', password: 'nexa', host: '127.0.0.1', port, database: 'postgres' });
  await admin.connect();
  await admin.query('CREATE DATABASE nexa');
  await admin.end();
  return {
    url: `postgres://nexa:nexa@127.0.0.1:${port}/nexa`,
    async stop() {
      await new Promise((resolve) => {
        if (proc.exitCode !== null) return resolve();
        proc.once('exit', resolve);
        const tk = spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { stdio: 'ignore' });
        tk.on('error', () => { try { proc.kill('SIGKILL'); } catch { /* já saiu */ } });
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* já saiu */ } resolve(); }, 8000).unref();
      });
      // nunca deixa o processo do teste preso ao Postgres (pipe aberto por um filho que sobreviveu)
      proc.stderr?.destroy(); proc.unref();
      cleanDir(dir);
    },
  };
}

/** No Windows empacotado o binário do pacote pode não ser executável de onde está (ENOENT): testa antes, porque a biblioteca não captura esse erro. */
function packagedBinaryRuns() {
  if (process.platform !== 'win32') return true;
  try {
    const idx = fileURLToPath(import.meta.resolve('@embedded-postgres/windows-x64'));
    const r = spawnSync(path.resolve(path.dirname(idx), '..', 'native', 'bin', 'initdb.exe'), ['--version'], { encoding: 'utf8' });
    return !r.error && r.status === 0;
  } catch { return true; }
}

/**
 * Sobe um Postgres de verdade (binário do pacote embedded-postgres) num diretório temporário.
 * Devolve { url, stop }. Serve para testar o driver Postgres sem precisar de Neon nem Docker.
 */
export async function startPg() {
  if (!packagedBinaryRuns()) return startPgFromCopy();
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  let last = null;
  // a porta livre pode ser tomada por outra suíte entre a escolha e a subida (o postgres sai na hora): tenta de novo do zero
  for (let attempt = 1; attempt <= 3; attempt++) {
    const dir = tmpDir('nexa-pg');
    const port = await freePort();
    let log = '';
    const keep = (m) => { log = (log + String(m)).slice(-2000); };
    // persistent: true — com false a biblioteca apaga o diretório dentro do stop() sem tolerar EBUSY do Windows; quem limpa é o cleanDir
    const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'nexa', password: 'nexa', port, persistent: true, initdbFlags: ['--no-sync'], postgresFlags: PG_FLAGS, onLog: keep, onError: keep });
    try {
      await within(pg.initialise(), 120_000, 'initdb não terminou em 120 s');
      await within(pg.start(), 90_000, 'não ficou pronto em 90 s'); // a biblioteca não tem prazo próprio
      await within(pg.createDatabase('nexa'), 60_000, 'CREATE DATABASE não respondeu em 60 s');
      const proc = pg.process; // o postmaster (a biblioteca guarda em .process): derrubado na saída se o teste não parar
      if (proc) {
        running.add(proc); proc.once('exit', () => running.delete(proc));
        // No Windows os filhos do postmaster (backends, io_worker...) herdam os pipes de log; um filho órfão os mantinha
        // abertos e o processo do arquivo nunca terminava (o node --test ficava preso). Os pipes e o processo não seguram
        // o laço: um Postgres que o teste não parou é derrubado pelo gancho de 'exit' acima
        proc.stdout?.unref?.(); proc.stderr?.unref?.(); proc.unref();
      }
      return {
        url: `postgres://nexa:nexa@127.0.0.1:${port}/nexa`,
        async stop() {
          // pg.stop() espera o 'exit' do postmaster: se ele já tinha saído (ou o taskkill falhou), esperaria para sempre
          if (proc && (proc.exitCode !== null || proc.signalCode)) pg.process = undefined; // já saiu: a biblioteca não espera
          else proc?.ref();
          await within(pg.stop(), 15_000, 'stop do Postgres sem resposta').catch(() => {});
          if (proc) {
            if (proc.exitCode === null && !proc.signalCode) killTree(proc.pid);
            proc.stdout?.destroy(); proc.stderr?.destroy(); proc.unref();
          }
          cleanDir(dir);
        },
      };
    } catch (err) {
      last = new Error(`Postgres embutido não subiu (tentativa ${attempt} de 3): ${err?.message || 'o processo saiu ao subir'}\n${log}`);
      await pg.stop().catch(() => {});
      cleanDir(dir);
    }
  }
  throw last;
}
