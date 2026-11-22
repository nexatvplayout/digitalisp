// O volume lento dos testes (21/10, 21:20–21:22: o laço do servidor parado 4,7 s e 21,8 s com 1,6 GB sujos no cache e o volume de
// rede em /data gravando as conversões, o bipe e o cache). Sem FUSE nem cgroup no Windows, a emulação fica no próprio processo:
// dentro de `dir` (o DATA_DIR do teste), toda operação que GRAVA ou mexe nos nomes (criar, escrever, renomear, apagar, criar
// pasta, copiar, sincronizar) fica presa como no freio de páginas sujas do kernel (balance_dirty_pages) e no diário do ext4:
//   - síncrona (fs.*Sync): a thread que chamou fica PRESA `syncMs` (Atomics.wait), como a thread principal do Node no kernel;
//   - assíncrona (fs.promises, callbacks, FileHandle, os streams): uma thread do threadpool do libuv fica presa `asyncMs` antes da
//     operação de verdade (uma leitura num pipe que o "disco", noutra thread, só responde depois do prazo), como a thread do
//     threadpool presa no kernel. Com o threadpool cheio, os outros pedidos (o HLS, o DNS) esperam atrás, como na produção.
// As leituras e as consultas (stat, readdir, access) seguem rápidas (no volume de verdade, o que está no cache não espera).
// exclude: caminhos que não ficam lentos (o SQLite do teste: na produção o banco é o Postgres, fora do volume).
// Dois jeitos de esperar:
//   - constante (storm: null): cada operação espera syncMs/asyncMs;
//   - tempestades (storm: { everyMs, lengthMs }): o freio do kernel de verdade. Fora da tempestade nada espera; dentro dela, a
//     operação que chega fica presa ATÉ ELA ACABAR (o balance_dirty_pages segura quem suja página enquanto o sujo do volume está
//     acima do limite, e solta todos juntos quando o disco descarrega). 21/10: 4,7 s às 21:20:38 e 21,8 s às 21:21:12.
// Uso: const disco = await slowDisk({ dir, syncMs, asyncMs, storm, exclude }); disco.on(); ...; disco.off(); disco.stats(); disco.close()
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { Worker } from 'node:worker_threads';

const WIN = process.platform === 'win32';
const SYNC_WRITE = ['writeFileSync', 'appendFileSync', 'renameSync', 'rmSync', 'unlinkSync', 'rmdirSync', 'mkdirSync', 'copyFileSync', 'cpSync',
  'linkSync', 'symlinkSync', 'truncateSync', 'utimesSync', 'mkdtempSync'];
const SYNC_FD = ['writeSync', 'writevSync', 'fsyncSync', 'fdatasyncSync', 'ftruncateSync'];
const CB_WRITE = ['writeFile', 'appendFile', 'rename', 'rm', 'unlink', 'rmdir', 'mkdir', 'copyFile', 'cp', 'link', 'symlink', 'truncate', 'utimes', 'mkdtemp'];
const CB_FD = ['write', 'writev', 'fsync', 'fdatasync', 'ftruncate'];
const P_WRITE = ['writeFile', 'appendFile', 'rename', 'rm', 'unlink', 'rmdir', 'mkdir', 'copyFile', 'cp', 'link', 'symlink', 'truncate', 'utimes', 'mkdtemp'];
const FH_WRITE = ['write', 'writev', 'writeFile', 'appendFile', 'datasync', 'sync', 'truncate'];
const writeFlags = (flags) => flags != null && (typeof flags === 'number' ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)) !== 0 : /[wa+]/.test(String(flags)));

/** O "disco": uma Worker que segura uma thread do threadpool por N ms (pipe nomeado no Windows, FIFO no resto). */
async function startDisk(slots) {
  const base = WIN ? `\\\\.\\pipe\\nexa-disco-${process.pid}-${Date.now().toString(36)}` : fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-disco-'));
  const fifos = [];
  if (!WIN) {
    for (let i = 0; i < slots; i++) { const f = path.join(base, `f${i}`); const r = spawnSync('mkfifo', [f]); if (r.status !== 0) throw new Error('mkfifo indisponível'); fifos.push(f); }
  }
  const servers = WIN ? Math.ceil(slots / 4) : 0; // cada servidor de pipe aceita poucas conexões pendentes: vários
  const w = new Worker(`
const net = require('node:net'); const fs = require('node:fs');
const { workerData, parentPort } = require('node:worker_threads');
if (workerData.win) {
  let up = 0;
  for (let i = 0; i < workerData.servers; i++) {
    net.createServer((s) => { s.once('data', (d) => { setTimeout(() => s.end(Buffer.from([1])), d.readUInt32LE(0)); }); s.on('error', () => {}); })
      .listen(workerData.base + '-' + i, () => { if (++up === workerData.servers) parentPort.postMessage('ok'); });
  }
} else {
  parentPort.on('message', ({ fifo, ms }) => setTimeout(() => { try { const fd = fs.openSync(fifo, 'w'); fs.writeSync(fd, Buffer.from([1])); fs.closeSync(fd); } catch {} }, ms));
  parentPort.postMessage('ok');
}`, { eval: true, workerData: { win: WIN, base, servers } });
  await new Promise((r, j) => { w.once('message', r); w.once('error', j); });
  w.unref();
  const free = fifos.slice();
  const waiting = [];
  let rr = 0;
  // fs original (as funções do módulo antes do disco lento): a leitura presa não pode passar pelo próprio disco lento
  const open = fs.promises.open;
  return {
    async hold(ms) {
      if (WIN) {
        const name = `${base}-${rr++ % servers}`;
        let fh;
        for (let k = 0; ; k++) { try { fh = await open(name, 'r+'); break; } catch (e) { if (e.code !== 'EBUSY' || k > 2000) throw e; await new Promise((r) => setTimeout(r, 2)); } }
        try { const b = Buffer.alloc(4); b.writeUInt32LE(Math.max(0, Math.round(ms)), 0); await fh.write(b); await fh.read(Buffer.alloc(1), 0, 1, null); } finally { await fh.close().catch(() => {}); }
        return;
      }
      const fifo = free.pop() ?? await new Promise((r) => waiting.push(r));
      try {
        w.postMessage({ fifo, ms: Math.max(0, Math.round(ms)) });
        const fh = await open(fifo, 'r'); // presa no threadpool até o "disco" abrir para escrever
        try { await fh.read(Buffer.alloc(1), 0, 1, null); } finally { await fh.close().catch(() => {}); }
      } finally { const next = waiting.shift(); if (next) next(fifo); else free.push(fifo); }
    },
    async close() { await w.terminate().catch(() => {}); if (!WIN) fs.rmSync(base, { recursive: true, force: true }); },
  };
}

export async function slowDisk({ dir, syncMs = 1000, asyncMs = 1000, storm = null, exclude = [], slots = 64, active = true } = {}) {
  const root = path.resolve(dir);
  const ex = exclude.map((p) => path.resolve(p));
  const inside = (p) => {
    if (p == null || typeof p === 'number') return false;
    let s;
    try { s = path.resolve(p instanceof URL ? p.pathname : Buffer.isBuffer(p) ? p.toString() : String(p)); } catch { return false; }
    if (!(s === root || s.startsWith(root + path.sep))) return false;
    return !ex.some((e) => s === e || s.startsWith(`${e}-`) || s.startsWith(e + path.sep));
  };
  const fds = new Set(); // fds abertas para escrever dentro do volume
  const disk = await startDisk(slots);
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const st = { on: active, since: performance.now(), sync: { n: 0, ms: 0, worst: 0, ops: {} }, async: { n: 0, ms: 0, worst: 0, ops: {} } };
  const orig = [];
  const put = (obj, name, fn) => { if (typeof obj[name] !== 'function') return; orig.push([obj, name, obj[name]]); obj[name] = fn(obj[name]); };
  /** Quanto a operação que chega agora espera (ms). */
  const waitOf = (base) => {
    if (!storm) return base;
    const phase = (performance.now() - st.since) % storm.everyMs;
    return phase < storm.lengthMs ? storm.lengthMs - phase : 0;
  };
  const count = (o, name, ms) => { o.n += 1; o.ms += ms; o.worst = Math.max(o.worst, ms); o.ops[name] = (o.ops[name] || 0) + 1; };

  const stall = (name) => {
    if (!st.on) return;
    const ms = waitOf(syncMs);
    if (!(ms > 0)) return;
    const t0 = performance.now();
    Atomics.wait(sleeper, 0, 0, ms);
    count(st.sync, name, performance.now() - t0);
  };
  const hold = async (name) => {
    if (!st.on) return;
    const ms = waitOf(asyncMs);
    if (!(ms > 0)) return;
    const t0 = performance.now();
    await disk.hold(ms);
    count(st.async, name, performance.now() - t0);
  };
  const statOrig = fs.statSync;
  // mkdir de uma pasta que já existe não chega ao disco (o kernel acha o nome antes): só a que cria espera
  const touches = (args, n = '') => (inside(args[0]) || inside(args[1])) && !(/^mkdir/.test(n) && statOrig(args[0], { throwIfNoEntry: false }));

  // síncronas
  for (const n of SYNC_WRITE) put(fs, n, (o) => function (...a) { if (touches(a, n)) stall(n); return o.apply(this, a); });
  put(fs, 'openSync', (o) => function (...a) { const slow = inside(a[0]) && writeFlags(a[1]); if (slow) stall('openSync'); const fd = o.apply(this, a); if (slow) fds.add(fd); return fd; });
  put(fs, 'closeSync', (o) => function (...a) { fds.delete(a[0]); return o.apply(this, a); });
  for (const n of SYNC_FD) put(fs, n, (o) => function (...a) { if (fds.has(a[0])) stall(n); return o.apply(this, a); });
  // callbacks (os streams usam estas)
  const later = (n, o) => function (...a) { const cb = a[a.length - 1]; if (typeof cb !== 'function') return o.apply(this, a); hold(n).then(() => o.apply(this, a), cb); };
  for (const n of CB_WRITE) put(fs, n, (o) => function (...a) { return touches(a, n) ? later(n, o).apply(this, a) : o.apply(this, a); });
  put(fs, 'open', (o) => function (...a) {
    const cb = a[a.length - 1];
    if (!(inside(a[0]) && writeFlags(typeof a[1] === 'function' ? 'r' : a[1])) || typeof cb !== 'function') return o.apply(this, a);
    const wrapped = [...a.slice(0, -1), (err, fd) => { if (!err) fds.add(fd); cb(err, fd); }];
    hold('open').then(() => o.apply(this, wrapped), cb);
  });
  put(fs, 'close', (o) => function (...a) { fds.delete(a[0]); return o.apply(this, a); });
  for (const n of CB_FD) put(fs, n, (o) => function (...a) { return fds.has(a[0]) ? later(n, o).apply(this, a) : o.apply(this, a); });
  // promessas
  const P = fs.promises;
  for (const n of P_WRITE) put(P, n, (o) => async function (...a) { if (touches(a, n)) await hold(`promises.${n}`); return o.apply(this, a); });
  put(P, 'open', (o) => async function (...a) {
    const slow = inside(a[0]) && writeFlags(a[1] ?? 'r');
    if (slow) await hold('promises.open');
    const fh = await o.apply(this, a);
    if (slow) fds.add(fh.fd);
    return fh;
  });
  // FileHandle (o protótipo é o mesmo para todas)
  const probeFile = path.join(os.tmpdir(), `nexa-disco-fh-${process.pid}.txt`);
  fs.writeFileSync(probeFile, 'x');
  const fh0 = await P.open(probeFile, 'r');
  const FH = Object.getPrototypeOf(fh0);
  await fh0.close(); fs.rmSync(probeFile, { force: true });
  for (const n of FH_WRITE) put(FH, n, (o) => async function (...a) { if (fds.has(this.fd)) await hold(`fh.${n}`); return o.apply(this, a); });
  put(FH, 'close', (o) => function (...a) { fds.delete(this.fd); return o.apply(this, a); });
  syncBuiltinESMExports();

  return {
    on() { if (!st.on) { st.on = true; st.since = performance.now(); } },
    off() { st.on = false; },
    get active() { return st.on; },
    stats() { return JSON.parse(JSON.stringify({ sync: st.sync, async: st.async })); },
    reset() { st.sync = { n: 0, ms: 0, worst: 0, ops: {} }; st.async = { n: 0, ms: 0, worst: 0, ops: {} }; },
    /** Segura uma thread do threadpool por ms (o teste simula um pedido preso no volume). */
    hold: (ms) => disk.hold(ms),
    async close() {
      for (const [obj, name, fn] of orig.reverse()) obj[name] = fn;
      syncBuiltinESMExports();
      await disk.close();
    },
  };
}
