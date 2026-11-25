// DIGITAL ISP · vídeo próprio na playlist (comercial da loja, institucional, treinamento): o arquivo enviado é conferido pelo
// conteúdo, vira um MP4 H.264 + AAC que toda TV toca (até 1920×1080 deitado ou 1080×1920 em pé, 30 quadros, início rápido)
// e ganha uma miniatura JPEG. Um vídeo por vez no servidor (fila), com prazo; o envio não espera a conversão.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fail } from './tvcorp-core.js';

export const VIDEO = Object.freeze({
  uploadBytes: 500 * 1024 * 1024, // o arquivo enviado
  maxSeconds: 10 * 60, // o que passa disso é cortado
  convertMs: 30 * 60 * 1000, // prazo da conversão
  types: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/x-msvideo', 'application/octet-stream'],
});

/** O tipo pelo conteúdo: 'mp4' (MP4/MOV), 'webm' (WebM/MKV), 'avi' ou null. */
export function sniffVideo(head) {
  if (!Buffer.isBuffer(head) || head.length < 12) return null;
  if (head.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  if (head.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'AVI ') return 'avi';
  return null;
}

function run(ffmpeg, args, ms) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* já saiu */ } }, ms);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, err }); });
  });
}

/** O que o FFmpeg diz do arquivo: duração (s), largura e altura do vídeo (já com a rotação do celular aplicada). */
export function probeText(err) {
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
  const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null;
  const v = /Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/.exec(err);
  let width = v ? Number(v[1]) : null; let height = v ? Number(v[2]) : null;
  const rot = /rotate\s*:\s*(-?\d+)|rotation of (-?\d+(?:\.\d+)?) degrees/.exec(err);
  const deg = rot ? Math.abs(Math.round(Number(rot[1] ?? rot[2]))) % 180 : 0;
  if (deg === 90 && width && height) [width, height] = [height, width];
  return { duration, width, height };
}

/**
 * Converte o vídeo de input (caminho) para out.mp4 + poster.jpg em dir. Devolve { mp4, poster, width, height, seconds }.
 * Erro com a mensagem para a pessoa (arquivo sem vídeo, corrompido, conversão longa demais).
 */
export async function convertVideo(ffmpeg, input, dir) {
  if (!ffmpeg) throw fail(503, 'O servidor está sem o FFmpeg para preparar o vídeo.');
  const info = probeText((await run(ffmpeg, ['-hide_banner', '-i', input], 30_000)).err);
  if (!info.width || !info.height) throw fail(400, 'Não achei imagem de vídeo neste arquivo. Envie um MP4, MOV ou WebM.');
  const port = info.height > info.width;
  const [W, H] = port ? [1080, 1920] : [1920, 1080];
  const mp4 = path.join(dir, 'out.mp4');
  const vf = `scale=w='min(${W},iw)':h='min(${H},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=yuv420p`;
  const r = await run(ffmpeg, ['-hide_banner', '-nostats', '-v', 'error', '-y', '-i', input, '-t', String(VIDEO.maxSeconds),
    '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'high', '-level', '4.1',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-map_metadata', '-1', '-movflags', '+faststart', '-threads', '2', mp4], VIDEO.convertMs);
  if (r.code !== 0) throw fail(400, 'Não foi possível converter este vídeo. Tente exportar de novo em MP4 (H.264).');
  const out = probeText((await run(ffmpeg, ['-hide_banner', '-i', mp4], 30_000)).err);
  const poster = path.join(dir, 'poster.jpg');
  const at = Math.min(1, Math.max(0, (out.duration || 0) / 2));
  await run(ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-ss', String(at), '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', poster], 60_000);
  if (!fs.existsSync(poster)) await run(ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', poster], 60_000);
  return { mp4, poster: fs.existsSync(poster) ? poster : null, width: out.width || W, height: out.height || H, seconds: Math.max(1, Math.ceil(out.duration || info.duration || 1)) };
}

/** Grava o corpo do pedido (stream) num arquivo temporário, com teto de tamanho. Devolve { dir, file, bytes, kind }. */
export async function receiveUpload(req, maxBytes = VIDEO.uploadBytes) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'digitalisp-video-'));
  const file = path.join(dir, 'in');
  const declared = Number(req.headers['content-length']);
  if (declared > maxBytes) { await fs.promises.rm(dir, { recursive: true, force: true }); throw fail(413, `O vídeo passa de ${Math.round(maxBytes / 1048576)} MB.`); }
  let bytes = 0; let head = Buffer.alloc(0);
  try {
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(file);
      req.on('data', (c) => {
        bytes += c.length;
        if (head.length < 16) head = Buffer.concat([head, c]).subarray(0, 16);
        if (bytes > maxBytes) { req.destroy(); ws.destroy(); reject(fail(413, `O vídeo passa de ${Math.round(maxBytes / 1048576)} MB.`)); return; }
        if (!ws.write(c)) { req.pause(); ws.once('drain', () => req.resume()); }
      });
      req.on('end', () => ws.end(resolve));
      req.on('error', reject); ws.on('error', reject);
    });
  } catch (err) { await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {}); throw err; }
  const kind = sniffVideo(head);
  if (!bytes || !kind) { await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {}); throw fail(415, 'Envie um vídeo MP4, MOV, WebM ou AVI.'); }
  return { dir, file, bytes, kind };
}

/** A fila: um vídeo convertido por vez no servidor inteiro (a conversão usa a CPU). */
let tail = Promise.resolve();
export function enqueue(job) {
  const run2 = tail.then(job, job);
  tail = run2.catch(() => {});
  return run2;
}
