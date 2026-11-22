// Testes sob carga: nesta máquina várias sessões rodam a suíte ao mesmo tempo (CPU a 100%, dezenas de FFmpeg). Aqui ficam
// a trava entre processos que põe os testes pesados em fila (FFmpeg em tempo real, laço de eventos medido), a espera ativa
// por condição e o relógio de mídia de um MPEG-TS. As medidas do laço, o relógio do processo (o tempo em que o processo de
// fato rodou, não a parede) e o retrato da carga ficam em laco.js (sem node:test, servem numa Worker) e saem daqui também.
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pesStart } from '../../server/mesa-ts.js';
import { retrato, sleep } from './laco.js';

export { cpuMs, medidor, ocupacao, relogioProcesso, retrato, sleep } from './laco.js';

/**
 * Espera ativa por uma condição (em vez de dormir um tempo fixo). O prazo é só contra travar: estoura dizendo o que se
 * esperava, o estado no momento (info) e a carga da máquina.
 */
export async function esperar(cond, { ms = 30_000, oque = 'a condição', info = null, passo = 25 } = {}) {
  const fim = performance.now() + ms;
  for (;;) {
    if (await cond()) return;
    if (performance.now() > fim) throw new Error(`tempo esgotado (${Math.round(ms / 1000)} s) esperando ${oque}${info ? `: ${info()}` : ''} · ${retrato()}`);
    await sleep(passo);
  }
}

/** Relógio de mídia de um MPEG-TS que vai chegando: segundos de vídeo (pelo DTS) desde o primeiro quadro. */
export function relogioTs() {
  let resto = Buffer.alloc(0); let primeiro = null; let ultimo = null;
  return {
    push(chunk) {
      const buf = resto.length ? Buffer.concat([resto, chunk]) : chunk;
      let o = 0;
      while (o + 188 <= buf.length) {
        if (buf[o] !== 0x47) { o += 1; continue; } // fora de sincronismo: procura o próximo pacote
        const s = pesStart(buf, o);
        if (s?.kind === 'v') { primeiro ??= s.dts; ultimo = s.dts; }
        o += 188;
      }
      resto = Buffer.from(buf.subarray(o));
    },
    get segundos() { return primeiro == null ? 0 : ((ultimo - primeiro + 2 ** 33) % 2 ** 33) / 90000; },
  };
}

/* ------------------------------------------------------------------ trava dos testes pesados */
const TRAVA = path.join(os.tmpdir(), 'nexa-testes-pesados.trava');
/** Até quanto esperar a vez antes de seguir sem a trava (dono preso em outra sessão: melhor rodar do que parar a suíte). */
export const ESPERA_MAX = 15 * 60_000;

const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };
const ler = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** Tira a trava de um dono morto ou vencido sem derrubar a de quem acabou de pegar: confere o id depois de mover. */
function tomar(velho) {
  const tmp = `${TRAVA}.${process.pid}.${Date.now()}`;
  try { fs.renameSync(TRAVA, tmp); } catch { return; }
  const movido = ler(tmp);
  if (movido && movido.id !== velho.id) { try { fs.linkSync(tmp, TRAVA); } catch { /* outro já pegou de novo: fica a dele */ } }
  try { fs.rmSync(tmp, { force: true }); } catch { /* o SO limpa o temporário */ }
}

/**
 * Pega a vez dos testes pesados: um por vez nesta máquina, entre arquivos e entre suítes (arquivo exclusivo no temporário
 * do sistema). Dono morto ou com o prazo vencido perde a vez. Devolve { soltar, esperou }.
 */
export async function trava(nome, prazoMs, { t = null } = {}) {
  const eu = { pid: process.pid, nome, id: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`, ate: Date.now() + prazoMs + 60_000 };
  const t0 = performance.now();
  let dono = null;
  for (;;) {
    try {
      fs.writeFileSync(TRAVA, JSON.stringify(eu), { flag: 'wx' });
      break;
    } catch (err) {
      if (!['EEXIST', 'EPERM', 'EBUSY'].includes(err.code)) {
        t?.diagnostic(`trava dos testes pesados indisponível (${err.code}): seguindo sem ela`);
        return { soltar() {}, esperou: performance.now() - t0 };
      }
    }
    dono = ler(TRAVA);
    if (dono && (!vivo(dono.pid) || Date.now() > dono.ate)) { tomar(dono); continue; }
    if (performance.now() - t0 > ESPERA_MAX) {
      t?.diagnostic(`a vez dos testes pesados não veio em ${ESPERA_MAX / 60_000} min (com pid ${dono?.pid ?? '?'}: "${dono?.nome ?? '?'}"): seguindo sem a trava`);
      return { soltar() {}, esperou: performance.now() - t0 };
    }
    await sleep(200 + Math.random() * 200);
  }
  const esperou = performance.now() - t0;
  if (esperou > 1000) t?.diagnostic(`esperou ${(esperou / 1000).toFixed(1)} s pela vez dos testes pesados (antes: pid ${dono?.pid ?? '?'}, "${dono?.nome ?? '?'}")`);
  let solto = false;
  const soltar = () => {
    if (solto) return;
    solto = true;
    process.off('exit', soltar);
    if (ler(TRAVA)?.id === eu.id) { try { fs.unlinkSync(TRAVA); } catch { /* já saiu */ } }
  };
  process.on('exit', soltar);
  return { soltar, esperou };
}

/**
 * test() de um teste pesado: espera a vez (trava) e só então conta o prazo dele. `timeout` é o tempo do teste em si; o
 * test() recebe esse tempo mais a espera máxima pela vez.
 */
export function testePesado(nome, { timeout = 120_000, ...opts } = {}, fn) {
  return test(nome, { ...opts, timeout: timeout + ESPERA_MAX + 5000 }, async (t) => {
    const vez = await trava(nome, timeout, { t });
    t.signal?.addEventListener('abort', vez.soltar, { once: true });
    let timer = null;
    try {
      return await Promise.race([
        fn(t),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`tempo esgotado: ${timeout / 1000} s de teste (sem contar a espera pela vez) · ${retrato()}`)), timeout); }),
      ]);
    } finally { clearTimeout(timer); vez.soltar(); }
  });
}
