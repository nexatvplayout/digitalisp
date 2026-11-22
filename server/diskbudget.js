import fs from 'node:fs';
import path from 'node:path';

/**
 * Reserva única de disco para o que ainda VAI ser escrito no volume de dados (o mesmo do HLS dos canais e do cache):
 * gravações do ao vivo (server/recorder.js: o remux do .ts para MP4), importações por link (server/importer.js: o resto do
 * download e a conversão) e a conversão de vídeos (server/transcode.js: o arquivo convertido em escrita). Cada uma registra
 * uma função que diz quantos bytes ainda faltam escrever; quem decide começar ou parar algo desconta o total de TODAS,
 * então uma não aperta o disco contando só com o próprio espaço.
 */
const claims = new Map(); // chave -> () => bytes que ainda faltam escrever

/** Registra a reserva; devolve a função que a libera. */
export function claim(key, bytesLeft) {
  claims.set(key, bytesLeft);
  return () => { if (claims.get(key) === bytesLeft) claims.delete(key); };
}

/**
 * A reserva de quem escreve os arquivos `files` até `total` bytes, sem I/O síncrono (21/10: o fs.statSync do arquivo em escrita a
 * cada conta da reserva era uma chamada síncrona no volume ocupado): o que já está escrito vem de um stat assíncrono, a cada
 * REFRESH_MS e antes de cada roomFor (o que roomFor devolve é exato). Entre um e outro, a conta usa o último (a reserva fica um
 * pouco maior: o lado seguro). Devolve a função que libera.
 * Um item de `files` que é uma PASTA conta a soma dos arquivos dela (um nível): a conversão retomável escreve os pedaços numa
 * pasta (server/conversao-pedacos.js), com nomes que só aparecem durante a escrita, e os já escritos (inclusive os de antes de
 * um reinício) descontam da reserva.
 */
const REFRESH_MS = 2000;
const bytesOf = async (f) => {
  const s = await fs.promises.stat(f).catch(() => null);
  if (!s) return 0;
  if (!s.isDirectory()) return s.size;
  let n = 0;
  for (const e of await fs.promises.readdir(f, { withFileTypes: true }).catch(() => [])) {
    if (e.isFile()) n += await fs.promises.stat(path.join(f, e.name)).then((x) => x.size, () => 0);
  }
  return n;
};
export function claimFiles(key, total, files) {
  const st = { written: 0, at: 0, pending: null };
  const measure = async () => {
    let n = 0;
    for (const f of files) n += await bytesOf(f);
    st.written = n; st.at = Date.now();
  };
  // fresh: uma medida que COMEÇA agora (o roomFor); sem ele, a que já está em andamento serve
  const refresh = (fresh = false) => {
    if (st.pending && !fresh) return st.pending;
    const p = (st.pending ? st.pending.then(measure) : measure()).catch(() => {}).finally(() => { if (st.pending === p) st.pending = null; });
    st.pending = p;
    return p;
  };
  const fn = () => { if (Date.now() - st.at > REFRESH_MS) refresh(); return Math.max(0, Number(total) - st.written); };
  fn.refresh = refresh;
  claims.set(key, fn);
  const timer = setInterval(refresh, REFRESH_MS); timer.unref?.();
  return () => { clearInterval(timer); if (claims.get(key) === fn) claims.delete(key); };
}

/** Tira a reserva da chave (outra tarefa assumiu a mesma escrita: a conversão de uma importação, por exemplo). */
export function dropClaim(key) { claims.delete(key); }

/** O que ainda falta escrever só das reservas com este prefixo na chave (ex.: 'tc:' = as conversões de envio). */
export function claimedBytes(prefix) {
  let n = 0;
  for (const [key, fn] of claims) if (String(key).startsWith(prefix)) { try { n += Math.max(0, Number(fn()) || 0); } catch { /* reserva quebrada */ } }
  return n;
}

/** Soma do que ainda falta escrever (recorder + importer + conversão). */
export function pendingBytes() {
  let n = 0;
  for (const fn of claims.values()) { try { n += Math.max(0, Number(fn()) || 0); } catch { /* reserva quebrada não trava a conta */ } }
  return n;
}

/** statfs substituível nos testes ("sem espaço" sem encher o disco de verdade). */
export const disk = { statfs: (dir) => fs.promises.statfs(dir) };

/** Bytes livres no disco de `dir` para este processo; null quando não dá para saber (o chamador segue sem conferir). */
export async function freeBytesOf(dir) {
  try { const s = await disk.statfs(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

/**
 * Cabe escrever `bytes` no disco de `dir` deixando a reserva do ar (`minFree`: o HLS dos canais, o banco) e o que as outras
 * tarefas ainda vão escrever? { ok, free, room } — room = quanto ainda dá para escrever sem invadir a reserva (Infinity
 * quando o sistema não informa o espaço).
 */
export async function roomFor(bytes, { dir, minFree }) {
  // as reservas por arquivo (claimFiles) com o tamanho de agora
  await Promise.all([...claims.values()].map((fn) => fn.refresh?.(true)));
  const free = await freeBytesOf(dir);
  if (free == null) return { ok: true, free: null, room: Infinity };
  const room = free - pendingBytes() - minFree;
  return { ok: room >= bytes, free, room };
}

/** Erro "sem espaço" com status 507 e código próprio (a conversão e as rotas mostram a mensagem como está). */
export const noSpace = (message) => Object.assign(new Error(message), { status: 507, code: 'ENOSPC_GUARD', userMessage: message, expose: true });
