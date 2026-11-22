// NEXA Telas · TV Corporativa, pacote A (docs/TV-CORPORATIVA.md §5.4 "Arquivos"): a imagem da biblioteca e a logomarca
// pelo FFmpeg, no mesmo caminho da imagem sem internet (server/telas-imagem-offline.js). O arquivo é conferido pelo
// conteúdo (não pela extensão), passa por um FFmpeg de uma thread, com teto de pixels, e sai sem metadados:
//   - imagem: JPEG 1920×1080 (deitada) ou 1080×1920 (em pé), cobrindo o quadro (corta as sobras) ou inteira com fundo, até
//     2 MB (a qualidade baixa até caber);
//   - logomarca: PNG com transparência, até 512×512 (sem aumentar), até 512 KB.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { TVC_LIMITS as L, TVC_FRAMES } from '../public/shared/tvcorp-tipos.js';
import { fail } from './tvcorp-core.js';

const FFMPEG_MS = 20_000;
const MAX_PIXELS = 4096 * 4096;
const PIPE = { jpg: 'jpeg_pipe', png: 'png_pipe', webp: 'webp_pipe' };

/** O tipo pelo conteúdo: 'jpg', 'png', 'webp' ou null. */
export function sniffImage(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.readUInt32BE(0) === 0x89504e47) return 'png';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}
export const isPng = (b) => Buffer.isBuffer(b) && b.length > 8 && b.readUInt32BE(0) === 0x89504e47;

/** Um quadro de saída (JPEG ou PNG) a partir do arquivo de entrada, com o filtro vf. */
function encode(ffmpeg, input, output, kind, vf, outArgs) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-nostats', '-v', 'error', '-y', '-filter_threads', '1', '-max_pixels', String(MAX_PIXELS), '-threads', '1',
      '-f', PIPE[kind], '-i', input, '-frames:v', '1', '-vf', vf, '-map_metadata', '-1', '-threads', '1', ...outArgs, '-f', 'image2', output],
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-600); });
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* já saiu */ } }, FFMPEG_MS);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); if (code === 0) resolve(); else reject(new Error(err.trim().split('\n').pop() || `ffmpeg saiu com ${code}`)); });
  });
}

async function withTemp(buf, fn) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nexa-tvcmidia-'));
  try {
    const input = path.join(dir, 'in');
    await fs.promises.writeFile(input, buf);
    return await fn(input, dir);
  } finally { await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

function precheck(buf, { ffmpeg, checkImage, maxBytes, what }) {
  const kind = sniffImage(buf);
  if (!kind) throw fail(400, 'Use uma imagem JPEG, PNG ou WebP.');
  if (buf.length > maxBytes) throw fail(413, `${what} passa de ${Math.round(maxBytes / 1024 / 1024)} MB. Escolha outra.`);
  if (checkImage) { try { checkImage(buf); } catch { throw fail(400, 'Imagem grande demais (até 16 megapixels) ou num formato que não dá para conferir.'); } }
  if (!ffmpeg) throw fail(503, 'O servidor está sem o FFmpeg para preparar a imagem.');
  return kind;
}

/**
 * A imagem enviada vira o JPEG das telas. opts: { ffmpeg, checkImage?, orientation: 'land'|'port', fit: 'cover'|'contain',
 * bg: '#rrggbb' }. Devolve { buf, width, height }. Arquivo que não é imagem: 400; grande demais: 413.
 */
export async function prepareMediaImage(buf, { ffmpeg, checkImage = null, orientation = 'land', fit = 'cover', bg = '#000000' } = {}) {
  const kind = precheck(buf, { ffmpeg, checkImage, maxBytes: L.uploadBytes, what: 'A imagem' });
  const { width: w, height: h } = TVC_FRAMES[orientation] || TVC_FRAMES.land;
  const color = `0x${String(bg).replace('#', '')}`;
  const vf = fit === 'contain'
    ? `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${color},setsar=1,format=yuvj420p`
    : `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},setsar=1,format=yuvj420p`;
  return withTemp(buf, async (input, dir) => {
    const output = path.join(dir, 'out.jpg');
    for (const q of [2, 4, 6, 9, 13, 18, 24, 31]) {
      try { await encode(ffmpeg, input, output, kind, vf, ['-c:v', 'mjpeg', '-q:v', String(q)]); } catch { throw fail(400, 'Não foi possível ler esta imagem. Tente outra.'); }
      const out = await fs.promises.readFile(output);
      if (out.length > 0 && out.length <= L.imageBytes) return { buf: out, width: w, height: h };
    }
    throw fail(400, 'Não foi possível preparar esta imagem dentro de 2 MB. Tente outra.');
  });
}

/** A logomarca: PNG com transparência, até 512×512 (sem aumentar), sem metadados, até 512 KB. Devolve o PNG. */
export async function prepareLogo(buf, { ffmpeg, checkImage = null } = {}) {
  const kind = precheck(buf, { ffmpeg, checkImage, maxBytes: L.logoUploadBytes, what: 'A logomarca' });
  const s = L.logoSide;
  return withTemp(buf, async (input, dir) => {
    const output = path.join(dir, 'out.png');
    for (const side of [s, 384, 256]) {
      const vf = `scale='min(${side},iw)':'min(${side},ih)':force_original_aspect_ratio=decrease:flags=lanczos,setsar=1,format=rgba`;
      try { await encode(ffmpeg, input, output, kind, vf, ['-c:v', 'png', '-compression_level', '9']); } catch { throw fail(400, 'Não foi possível ler esta logomarca. Tente outra.'); }
      const out = await fs.promises.readFile(output);
      if (isPng(out) && out.length <= L.logoBytes) return out;
    }
    throw fail(400, 'Não foi possível preparar esta logomarca dentro de 512 KB. Tente uma imagem mais simples.');
  });
}
