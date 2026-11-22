/* Endereço de comando de um FFmpeg com o filtro zmq/azmq (o mixer da mesa AO VIVO e o ganho da saída no alimentador que
   lê a câmera pelo stdin). O zmq do FFmpeg não tem autenticação: quem conecta manda comando a qualquer filtro do grafo
   (deixar o canal mudo, ou um drawtext "reinit textfile=/proc/self/environ" que mostraria o ambiente no ar). Revisão de
   segurança de 10/10: socket ipc numa pasta privada (0700) por FFmpeg, apagada no fim; só o usuário do servidor abre.

   Rede de segurança: na partida, uma prova real (zmqMode) sobe um FFmpeg curto com o azmq num caminho ipc, com o mesmo
   escape do motor e do mixer, e manda um comando. Respondeu: ipc no processo inteiro. Falhou (FFmpeg/libzmq sem ipc, como
   no Windows, /tmp sem permissão, escape): tcp em 127.0.0.1 no processo inteiro, como antes. Um "Could not bind" com ipc em
   operação também passa o processo para tcp (ipcFailed). O log do servidor diz qual ficou valendo. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';
import { ZmqReq } from './zmq-req.js';

/** Porta livre em 127.0.0.1 (modo tcp; a porta fica livre até o bind do FFmpeg, e quem perde a corrida sobe de novo). */
export const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

/**
 * O endereço escapado para o valor de uma opção de filtro (que vai entre aspas simples no grafo): o grafo tira as aspas e
 * a opção ainda separa por ":" e trata "\" como escape, então ":" e "\" ganham "\" na frente. Espaço passa como está.
 */
export const filterAddr = (bind) => String(bind).replace(/[\\:]/g, (c) => `\\${c}`);

/** O FFmpeg saiu porque o filtro zmq/azmq não abriu o endereço (porta tomada no Windows, ipc sem suporte, pasta sumida)? */
export const zmqBindFailed = (stderr) => /Could not bind ZMQ socket|Address already in use/i.test(String(stderr || ''));

/** Caminho de socket que o libzmq aceita: curto (sun_path ~107) e sem aspas simples (o valor vai entre aspas no grafo). */
const okSock = (p) => p.length <= 100 && !p.includes("'");

// pastas de socket ainda não apagadas: o que sobrar sai na saída do processo (síncrono). Antes, a prova da partida apagava
// a dela num setTimeout com unref, e um servidor que saía logo (os testes) deixava uma nexa-zmq-* vazia a cada subida
const open = new Set();
process.on('exit', () => { for (const d of open) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* fica para o SO */ } } });

/**
 * Endereço ipc numa pasta nova com 0700 (no temporário do sistema; caminho longo ou com aspas: /tmp). Lança se não der. Sem I/O
 * síncrono (21/10): sobe com cada alimentador, no laço do servidor.
 */
export async function ipcEndpoint({ tmp = os.tmpdir() } = {}) {
  for (const base of [tmp, ...(process.platform === 'win32' ? [] : ['/tmp'])]) {
    if (!okSock(path.join(base, 'nexa-zmq-XXXXXX', 's'))) continue;
    const dir = await fs.promises.mkdtemp(path.join(base, 'nexa-zmq-')); // mkdtemp já cria com 0700; o chmod garante com qualquer umask
    open.add(dir);
    await fs.promises.chmod(dir, 0o700);
    const sock = path.join(dir, 's');
    return {
      kind: 'ipc', bind: `ipc://${sock}`, connect: { path: sock }, dir,
      // o FFmpeg pode ainda segurar o socket por um instante (Windows): tenta de novo; o que sobrar sai na saída do processo
      cleanup() { fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).then(() => open.delete(dir), () => { /* fica para a saída */ }); },
    };
  }
  throw new Error('sem pasta temporária curta para o socket ipc');
}

/** Endereço tcp em 127.0.0.1 numa porta livre. */
export async function tcpEndpoint() {
  const port = await freePort();
  return { kind: 'tcp', bind: `tcp://127.0.0.1:${port}`, connect: { port }, dir: null, cleanup() {} };
}

/**
 * A prova: um FFmpeg curto com o azmq num caminho ipc (o mesmo escape do motor e do mixer) e um comando de verdade pelo
 * ZmqReq. { ok } ou { ok: false, reason }.
 */
export async function probeIpc({ ffmpeg = config.ffmpeg, timeoutMs = 6000 } = {}) {
  if (!ffmpeg) return { ok: false, reason: 'sem FFmpeg' };
  let ep;
  try { ep = await ipcEndpoint(); } catch (e) { return { ok: false, reason: e.message }; }
  let p = null; let z = null;
  try {
    p = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '5',
      '-af', `azmq=bind_address='${filterAddr(ep.bind)}',volume@prova=volume=1`, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-600); });
    const exited = new Promise((_, rej) => { p.on('error', (e) => rej(e)); p.on('close', () => rej(new Error(err.trim().split(/\r?\n/).find((l) => /bind|zmq|error/i.test(l)) || err.trim().split(/\r?\n/).pop() || 'o FFmpeg saiu antes de responder'))); });
    exited.catch(() => {});
    z = new ZmqReq(ep.connect, { timeoutMs });
    setTimeout(() => z?.connect(), 300);
    const reply = await Promise.race([z.send('volume@prova volume 0.5'), exited, new Promise((_, rej) => setTimeout(() => rej(new Error(`sem resposta em ${timeoutMs / 1000} s`)), timeoutMs))]);
    if (!/^0\b/.test(String(reply))) return { ok: false, reason: `resposta inesperada: ${String(reply).slice(0, 80)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e).replace(/\s+/g, ' ').slice(0, 200) };
  } finally {
    z?.close();
    // a pasta sai quando o FFmpeg soltar o socket (fechou); se o servidor sair antes, a saída do processo apaga (open)
    if (!p || p.exitCode !== null || p.signalCode) ep.cleanup();
    else { p.once('close', () => ep.cleanup()); try { p.kill('SIGKILL'); } catch { /* já saiu */ } }
  }
}

let mode = null; let modeP = null; let why = null; // why: o motivo do último "ipc falhou"
/** Para o diagnóstico (Recursos e custos): { mode: 'ipc' | 'tcp' | null (ainda não testado), reason }. */
export const zmqState = () => ({ mode, reason: why });
/** ipc ou tcp para o processo inteiro (a prova roda uma vez; a primeira chamada, na partida do servidor, registra no log). */
export function zmqMode({ probe = probeIpc, log = (l) => console.log(l) } = {}) {
  modeP ||= (async () => {
    const r = await probe().catch((e) => ({ ok: false, reason: e.message }));
    if (mode === null) { // (ipcFailed em operação durante a prova ganha)
      mode = r.ok ? 'ipc' : 'tcp';
      if (!r.ok) why = String(r.reason || '').slice(0, 160);
      log(r.ok ? '[zmq] ipc ok' : `[zmq] ipc falhou (${r.reason}) → tcp 127.0.0.1`);
    }
    return mode;
  })();
  return modeP;
}
/** Em operação, um "Could not bind" com ipc: o processo passa para tcp na próxima subida (motor e mixer). */
export function ipcFailed(reason = '') {
  if (mode === 'tcp') return;
  mode = 'tcp'; modeP = Promise.resolve('tcp'); why = `em operação: ${String(reason).replace(/\s+/g, ' ').slice(0, 140)}`;
  console.log(`[zmq] ipc falhou em operação (${String(reason).replace(/\s+/g, ' ').slice(0, 160)}) → tcp 127.0.0.1`);
}
/** Testes: esquece o modo (null) ou fixa um. */
export const _setZmqMode = (m = null) => { mode = m; why = null; modeP = m ? Promise.resolve(m) : null; };

/**
 * Um endereço novo: { kind: 'ipc'|'tcp', bind (para o filtro), connect (para o ZmqReq: { path } ou { port }), dir,
 * cleanup() }. modo: o do processo (zmqMode); os testes podem fixar.
 */
export async function zmqEndpoint({ mode: forced = null } = {}) {
  const m = forced || await zmqMode();
  if (m === 'ipc') { try { return await ipcEndpoint(); } catch { /* sem pasta: tcp desta vez */ } }
  return tcpEndpoint();
}
