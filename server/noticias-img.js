// DIGITAL ISP · as fotos das notícias (RSS): o servidor baixa a foto de cada manchete (enclosure, media:content ou a
// primeira <img> do resumo), guarda uma cópia pelo hash e a TV baixa daqui ({ url, sha256, bytes }, como as outras
// imagens do contrato). Assim cada notícia passa sozinha na tela, com a foto em tela cheia e a faixa com a manchete.
// Só JPG, PNG ou WebP de até 3 MB; as cópias somem 3 dias depois da última vez que alguma fonte as usou.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeFetch } from './web/net.js';

export const NEWS_IMG_RE = /^[0-9a-f]{64}\.(?:jpg|png|webp)$/;
export const NEWS_IMG_LIMITS = Object.freeze({ maxBytes: 3 * 1024 * 1024, timeoutMs: 10_000, keepMs: 3 * 86400_000, perFeed: 15, concurrent: 3, failMs: 6 * 3600_000 });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** O tipo da imagem pelos primeiros bytes (não pelo cabeçalho do site). */
export function sniffImage(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.subarray(0, 8).equals(PNG)) return 'png';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

// toJpeg(buf) -> JPEG: a foto em WebP vira JPEG (as TVs mais antigas não desenham WebP; o resto das imagens já é JPEG)
export function createNewsImages({ dir, fetcher = safeFetch, now = Date.now, toJpeg = null } = {}) {
  const failed = new Map(); // endereço -> quando falhou (não tenta de novo por 6 h)
  const known = new Map(); // endereço -> { file, sha256, bytes }
  let ready = null;
  const ensureDir = () => (ready ||= fs.mkdir(dir, { recursive: true }).catch(() => {}));

  async function fetchOne(url) {
    if (known.has(url)) {
      const k = known.get(url);
      // ainda no disco? (marca o uso para a limpeza)
      const ok = await fs.utimes(path.join(dir, k.file), new Date(), new Date()).then(() => true).catch(() => false);
      if (ok) return k;
      known.delete(url);
    }
    const f = failed.get(url);
    if (f && now() - f < NEWS_IMG_LIMITS.failMs) return null;
    try {
      const r = await fetcher(url, { timeout: NEWS_IMG_LIMITS.timeoutMs, maxBytes: NEWS_IMG_LIMITS.maxBytes, headers: { accept: 'image/jpeg, image/png, image/webp' } });
      if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
      let buf = r.body;
      let ext = sniffImage(buf);
      if (!ext) throw new Error('não é JPG, PNG nem WebP');
      if (ext === 'webp' && toJpeg) { buf = await toJpeg(buf); ext = sniffImage(buf); if (ext !== 'jpg') throw new Error('a conversão do WebP falhou'); }
      const sha256 = createHash('sha256').update(buf).digest('hex');
      const file = `${sha256}.${ext}`;
      await ensureDir();
      const full = path.join(dir, file);
      const there = await fs.stat(full).then((s) => s.size === buf.length).catch(() => false);
      if (!there) await fs.writeFile(full, buf);
      else await fs.utimes(full, new Date(), new Date()).catch(() => {});
      const out = { file, sha256, bytes: buf.length };
      known.set(url, out);
      while (known.size > 5000) known.delete(known.keys().next().value);
      return out;
    } catch {
      failed.set(url, now());
      while (failed.size > 5000) failed.delete(failed.keys().next().value);
      return null;
    }
  }

  /** As manchetes da fonte com a cópia da foto em img: { file, sha256, bytes } (sem foto, fica sem). */
  async function enrich(items) {
    const list = Array.isArray(items) ? items.map((i) => ({ ...i })) : [];
    const todo = list.slice(0, NEWS_IMG_LIMITS.perFeed).filter((i) => /^https?:\/\//i.test(String(i.image || '')));
    let next = 0;
    const worker = async () => { while (next < todo.length) { const it = todo[next++]; const got = await fetchOne(it.image); if (got) it.img = got; } };
    await Promise.all(Array.from({ length: NEWS_IMG_LIMITS.concurrent }, worker));
    return list;
  }

  /** O arquivo guardado (para a rota /tvcorp/noticia/:nome), ou null. */
  async function read(name) {
    if (!NEWS_IMG_RE.test(String(name))) return null;
    return fs.readFile(path.join(dir, name)).catch(() => null);
  }

  /** Apaga as cópias que nenhuma busca usou nos últimos 3 dias. */
  async function prune() {
    const names = await fs.readdir(dir).catch(() => []);
    for (const n of names) {
      if (!NEWS_IMG_RE.test(n)) continue;
      const full = path.join(dir, n);
      const st = await fs.stat(full).catch(() => null);
      if (st && now() - st.mtimeMs > NEWS_IMG_LIMITS.keepMs) await fs.unlink(full).catch(() => {});
    }
    for (const [u, k] of known) if (!NEWS_IMG_RE.test(k.file)) known.delete(u);
  }

  return { enrich, read, prune, dir };
}
