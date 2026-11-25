/**
 * A escrita das tarefas de fundo no volume, sem segurar o ar (21/10, 21:20–21:22). O volume de rede em /data recebia ao mesmo tempo
 * o arquivo novo do bipe (o programa de 1,8 GB copiado com as trilhas novas), as conversões dos ~9 vídeos enviados em 2 min e os
 * downloads do cache; o cache de páginas chegou a 1,6 GB sujos. Com as páginas sujas acima do limite do kernel, TODO processo e
 * TODA thread que escreve no volume fica presa no freio do kernel (balance_dirty_pages) até o disco lento descarregar o que está
 * sujo: a thread principal do Node numa gravação síncrona de poucos bytes (o laço parado 4,7 s e 21,8 s) e as threads do
 * threadpool nas assíncronas (o HLS e o resto esperando atrás delas). O kernel só freia quem escreve depois que o sujo já está
 * alto (gigabytes num contêiner com dezenas de GB), e aí descarregar leva dezenas de segundos num disco de rede.
 *
 * O freio de escrita (createWriteGovernor) mantém o sujo de cada tarefa pequeno: a cada GOV_EVERY_MS ele mede quanto cada escritor
 * de fundo já sujou (no Linux, /proc/<pid>/io write_bytes: as páginas que o processo sujou, mesmo regravando o mesmo arquivo; em
 * qualquer sistema, o crescimento dos arquivos de saída) e, passando de BUDGET_BYTES desde a última descarga, PARA o processo
 * (SIGSTOP, server/pausa.js, só fora do Windows), descarrega os arquivos dele (fdatasync, no threadpool) e o solta. Na metade do
 * orçamento já começa uma descarga sem parar ninguém (o disco começa a gravar antes). O escritor anda na velocidade real do disco,
 * nunca mais que ~BUDGET_BYTES à frente dele, e o sujo do volume não chega ao limite do kernel. A descarga lenta (o disco
 * ocupado) encolhe o orçamento (até 1/4): menos fila no disco que o alimentador do ar também lê.
 *
 * Os escritores do próprio Node (o download do cache, server/storage.js) usam o SyncedWriter: a mesma descarga a cada
 * BUDGET_BYTES, com a contrapressão do stream (o download espera a descarga).
 *
 * E os diários das tarefas (state.json do bipe, do 5.1 convertido, da normalização...) passam a ser gravados sem I/O síncrono na
 * thread principal (createStateFile: um por vez, sempre o mais novo; quem precisa espera a promessa).
 *
 * FUNDO_ESCRITA=0 desliga o freio de escrita; FUNDO_ESCRITA_MB muda o orçamento (32 MB).
 */
import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import * as pausa from './pausa.js';

const envNum = (k, d) => { const s = String(process.env[k] ?? '').trim(); const v = Number(s); return s !== '' && Number.isFinite(v) ? v : d; };
const MB = 1024 * 1024;
/** Quanto um escritor de fundo pode sujar (bytes) antes de parar para descarregar (FUNDO_ESCRITA_MB). */
export const BUDGET_BYTES = Math.max(4, envNum('FUNDO_ESCRITA_MB', 32)) * MB;
/** De quanto em quanto tempo (ms) o freio de escrita mede os escritores. */
export const GOV_EVERY_MS = 250;
/** O freio de escrita ligado (FUNDO_ESCRITA=0 desliga). */
export const GOVERNOR_ON = process.env.FUNDO_ESCRITA !== '0';
const LINUX = process.platform === 'linux';

const n1 = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
// MB = MiB aqui (o orçamento é FUNDO_ESCRITA_MB × 1024²)
const size = (b) => (b >= 1024 * MB ? `${n1(b / (1024 * MB))} GB` : `${Math.round(b / MB)} MB`);
const dur = (ms) => (ms >= 1000 ? `${n1(ms / 1000)} s` : `${Math.round(ms)} ms`);

/** Bytes que o processo sujou no cache de páginas desde que nasceu (/proc/<pid>/io write_bytes), ou null (fora do Linux). */
export async function procWritten(pid) {
  if (!LINUX || !pid) return null;
  try {
    const t = await fs.promises.readFile(`/proc/${pid}/io`, 'utf8');
    const m = /^write_bytes:\s*(\d+)/m.exec(t);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

/**
 * Descarrega no disco o que está sujo do arquivo (fdatasync), sem segurar a thread principal (no threadpool). No Linux basta abrir
 * para leitura; no Windows o FlushFileBuffers pede escrita ('r+', sem truncar). false: não deu (o arquivo saiu, ou outro
 * processo o abriu sem compartilhar).
 */
export async function syncFile(file) {
  let fh = null;
  try {
    fh = await fs.promises.open(file, process.platform === 'win32' ? 'r+' : 'r');
    await fh.datasync();
    return true;
  } catch { return false; } finally { await fh?.close().catch(() => {}); }
}

async function sizes(files) {
  let total = 0;
  for (const f of files) { try { total += (await fs.promises.stat(f)).size; } catch { /* ainda não existe, ou já saiu */ } }
  return total;
}

/**
 * O freio de escrita. track(proc, { files, label, pause }) acompanha um escritor de fundo (o ChildProcess do FFmpeg; files: os
 * arquivos que ele escreve, ou () => lista; pause: false para quem nunca pode parar, como uma gravação ao vivo: só descarrega) e
 * devolve { untrack }. Para quando o processo sai (evento 'close'/'exit'). Os testes trocam o relógio, a medida, a descarga e a
 * parada.
 */
export function createWriteGovernor({
  budget = BUDGET_BYTES, everyMs = GOV_EVERY_MS, enabled = GOVERNOR_ON, canPause = pausa.CAN_STOP,
  written = procWritten, measureFiles = sizes, sync = syncFile, stop = pausa.stop, cont = pausa.cont,
  now = Date.now, log = (l) => console.log(l),
} = {}) {
  const writers = new Set();
  let timer = null; let seq = 0;
  const totals = { syncs: 0, syncedBytes: 0, pausedMs: 0, worstSyncMs: 0 };

  /** O orçamento agora para este escritor: encolhe quando a última descarga foi lenta (o disco ocupado). */
  const budgetOf = (w) => Math.max(budget / 4, Math.min(budget, (budget * 1000) / Math.max(1000, w.lastSyncMs || 0)));

  async function produced(w) {
    const files = typeof w.files === 'function' ? await Promise.resolve(w.files()).catch(() => []) : w.files;
    // write_bytes conta desde que o processo nasceu (acompanhado logo depois de subir); os arquivos de saída, desde zero
    const [io, sz] = await Promise.all([w.proc?.pid ? written(w.proc.pid) : null, measureFiles(files || [])]);
    return { bytes: Math.max(io ?? 0, sz), files: files || [] };
  }

  async function flush(w, bytes, files, { pause }) {
    const t0 = now();
    const paused = pause && w.pause && canPause && stop(w.proc, 'escrita');
    w.state = paused ? 'parado descarregando' : 'descarregando';
    try { for (const f of files) await sync(f); } finally {
      if (paused) cont(w.proc, 'escrita');
      const ms = now() - t0;
      w.lastSyncMs = ms; w.worstSyncMs = Math.max(w.worstSyncMs, ms); w.syncs += 1;
      if (paused) { w.pausedMs += ms; totals.pausedMs += ms; }
      totals.syncs += 1; totals.syncedBytes += Math.max(0, bytes - w.mark); totals.worstSyncMs = Math.max(totals.worstSyncMs, ms);
      w.mark = Math.max(w.mark, bytes);
      w.state = null;
      if (ms >= 10_000 && !w.slowLogged) { w.slowLogged = true; log(`[escrita] ${w.label}: descarregar ${size(budget)} no disco levou ${dur(ms)} (o volume está lento; o escritor anda no ritmo dele)`); }
    }
  }

  async function check(w) {
    if (w.busy || w.done) return;
    w.busy = true;
    try {
      const p = await produced(w);
      w.bytes = p.bytes;
      const pending = p.bytes - w.mark;
      const b = budgetOf(w);
      if (pending >= b) await flush(w, p.bytes, p.files, { pause: true });
      else if (pending >= b / 2) await flush(w, p.bytes, p.files, { pause: false });
    } catch { /* o processo saiu no meio */ } finally { w.busy = false; }
  }

  function tick() { for (const w of writers) check(w); }

  function ensureTimer() {
    if (timer || !writers.size) return;
    timer = setInterval(tick, everyMs); timer.unref?.();
  }

  return {
    budget,
    enabled,
    /** Acompanha um escritor de fundo. Devolve { untrack }. Desligado (FUNDO_ESCRITA=0): nada. */
    track(proc, { files = [], label = 'tarefa de fundo', pause = true } = {}) {
      if (!enabled || !proc) return { untrack() {} };
      const w = { id: ++seq, proc, files, label, pause, mark: 0, bytes: 0, syncs: 0, lastSyncMs: 0, worstSyncMs: 0, pausedMs: 0, busy: false, done: false, state: null, since: now() };
      writers.add(w);
      const untrack = () => {
        if (w.done) return;
        w.done = true; writers.delete(w);
        pausa.cont(proc, 'escrita');
        if (!writers.size) { clearInterval(timer); timer = null; }
      };
      proc.once?.('close', untrack); proc.once?.('exit', untrack);
      ensureTimer();
      return { untrack, writer: w };
    },
    tick, // os testes
    /** Confere um escritor agora e espera (os testes). */
    async checkAll() { await Promise.all([...writers].map((w) => check(w))); },
    status() {
      return {
        enabled, budget, writers: [...writers].map((w) => ({ label: w.label, pid: w.proc?.pid ?? null, bytes: w.bytes, synced: w.mark, syncs: w.syncs, lastSyncMs: w.lastSyncMs, worstSyncMs: w.worstSyncMs, pausedMs: w.pausedMs, state: w.state })),
        ...totals,
      };
    },
    /** A linha para o log do laço e o "[memória]": quem escreve, quanto, e quem está parado descarregando. '' sem escritor. */
    line() {
      if (!writers.size) return '';
      const list = [...writers].slice(0, 4).map((w) => `${w.label} ${size(w.bytes)}${w.syncs ? `, ${w.syncs} descarga(s) (a última ${dur(w.lastSyncMs)})` : ''}${w.state ? `, ${w.state} agora` : ''}`);
      return `freio de escrita (${size(budget)}): ${list.join('; ')}`;
    },
    stop() { clearInterval(timer); timer = null; for (const w of [...writers]) { w.done = true; pausa.cont(w.proc, 'escrita'); } writers.clear(); },
  };
}

/** O freio de escrita do servidor (um só: as tarefas de fundo, a conversão, o bipe...). */
export const writeGovernor = createWriteGovernor();

/**
 * Um arquivo gravado pelo Node em pedaços, com uma descarga no disco (fdatasync) a cada `budget` bytes, esperada antes do pedaço
 * seguinte: o download do cache (server/storage.js) nunca fica mais que ~budget à frente do disco. Mesmos eventos do
 * fs.createWriteStream ('finish', 'close', 'error'). flags: 'w' ou 'a'.
 */
export class SyncedWriter extends Writable {
  constructor(file, { flags = 'w', budget = BUDGET_BYTES, sync = GOVERNOR_ON, onSync = null } = {}) {
    super({ highWaterMark: 1 * MB });
    Object.assign(this, { file, flags, budget, doSync: sync, onSync });
    this.fh = null; this.since = 0; this.bytesWritten = 0; this.syncs = 0;
  }
  _construct(cb) { fs.promises.open(this.file, this.flags).then((fh) => { this.fh = fh; cb(); }, cb); }
  _write(chunk, _enc, cb) { this.#put(chunk).then(() => cb(), cb); }
  async #put(chunk) {
    for (let off = 0; off < chunk.length;) {
      const { bytesWritten } = await this.fh.write(chunk, off, chunk.length - off, null);
      if (!bytesWritten) throw new Error('gravação sem avanço');
      off += bytesWritten;
    }
    this.bytesWritten += chunk.length; this.since += chunk.length;
    if (this.doSync && this.since >= this.budget) {
      this.since = 0;
      const t0 = Date.now();
      await this.fh.datasync();
      this.syncs += 1;
      this.onSync?.(Date.now() - t0);
    }
  }
  _destroy(err, cb) {
    const fh = this.fh; this.fh = null;
    if (!fh) { cb(err); return; }
    fh.close().then(() => cb(err), () => cb(err));
  }
}

/**
 * O diário de uma tarefa (state.json) sem I/O síncrono: save(obj) copia o estado agora (JSON) e grava no threadpool (arquivo
 * temporário + rename, como antes), um por vez e sempre o mais novo; a promessa resolve (true, ou false com o erro no log)
 * quando uma gravação com este estado, ou um mais novo, terminou. flush() espera o que falta.
 */
export function createStateFile(file, { log = (l) => console.warn(l) } = {}) {
  let pending = null; let waiters = []; let running = null; let lastError = null;
  async function loop() {
    while (pending != null) {
      const text = pending; pending = null;
      const ws = waiters; waiters = [];
      let ok = true;
      try { await writeFileAtomic(file, text); lastError = null; } catch (err) {
        ok = false;
        if (lastError !== err.code) log(`[diário] ${path.basename(path.dirname(file))}/${path.basename(file)}: não gravou (${err.message})`);
        lastError = err.code || 'erro';
      }
      for (const r of ws) r(ok);
    }
    running = null;
  }
  return {
    file,
    save(obj) {
      pending = JSON.stringify(obj);
      const p = new Promise((r) => waiters.push(r));
      if (!running) running = loop();
      return p;
    },
    flush() { return running ? running.then(() => (pending != null ? this.flush() : undefined)) : Promise.resolve(); },
    get lastError() { return lastError; },
  };
}

/** Grava o arquivo inteiro de uma vez (temporário + rename: quem lê nunca vê a metade), sem I/O síncrono. */
export async function writeFileAtomic(file, data, opts = undefined) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await fs.promises.writeFile(tmp, data, opts);
    await fs.promises.rename(tmp, file);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Apaga sem segurar o laço (um arquivo de GB num volume leva segundos); erro: segue. */
export const rmQuiet = (p, recursive = false) => fs.promises.rm(p, { force: true, recursive }).catch(() => {});

/** O arquivo existe? Sem I/O síncrono (no threadpool). */
export const exists = (p) => fs.promises.access(p).then(() => true, () => false);

/** Tamanho do arquivo (0 se não existe), sem I/O síncrono. */
export const sizeOfAsync = (p) => fs.promises.stat(p).then((s) => s.size, () => 0);
