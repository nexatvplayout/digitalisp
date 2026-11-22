/**
 * Os FFmpeg de fundo PARADOS (SIGSTOP/SIGCONT, só fora do Windows) por mais de um motivo ao mesmo tempo. Antes, cada tarefa parava
 * e soltava o processo dela pelo freio do ar (server/pace-watch.js, server/fundo.js); com o freio de escrita (server/escrita.js,
 * 21/10) são dois motivos para o mesmo processo, e um SIGCONT de um soltaria o que o outro segurou. Aqui cada motivo segura e
 * solta o seu; o processo só volta quando nenhum motivo sobra.
 */
export const CAN_STOP = process.platform !== 'win32';

const holds = new Map(); // pid → Set de motivos

const send = (p, sig) => { if (typeof p?.kill === 'function') p.kill(sig); else process.kill(p.pid, sig); };

/** Segura o processo por `reason` (o 1º motivo manda o SIGSTOP). false: não deu (Windows, processo que já saiu). */
export function stop(p, reason) {
  if (!CAN_STOP || !p?.pid) return false;
  let h = holds.get(p.pid);
  if (h?.has(reason)) return true;
  if (!h) { h = new Set(); holds.set(p.pid, h); }
  if (!h.size) {
    try { send(p, 'SIGSTOP'); } catch { if (!h.size) holds.delete(p.pid); return false; }
  }
  h.add(reason);
  return true;
}

/** Solta o motivo `reason`; sem nenhum motivo, o processo volta (SIGCONT). */
export function cont(p, reason) {
  const h = p?.pid ? holds.get(p.pid) : null;
  if (!h || !h.delete(reason)) return;
  if (h.size) return;
  holds.delete(p.pid);
  try { send(p, 'SIGCONT'); } catch { /* já saiu */ }
}

/** Os motivos que seguram o processo agora. */
export const reasons = (p) => [...(holds.get(p?.pid) || [])];
/** O processo saiu: esquece os motivos dele (o pid pode voltar a ser usado). */
export function forget(p) { if (p?.pid) holds.delete(p.pid); }
