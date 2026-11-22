// Medidas do laço de eventos e do tempo do processo, sem node:test: servem também dentro de uma Worker thread (onde não
// há os ganchos async do test runner). CPU da thread principal x parede, relógio do processo e retrato da máquina.
import os from 'node:os';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** CPU (ms) desta thread, a do laço de eventos (numa Worker, a da Worker). Sem threadCpuUsage (Node < 23.9): a do processo. */
export const cpuMs = () => { const u = process.threadCpuUsage ? process.threadCpuUsage() : process.cpuUsage(); return (u.user + u.system) / 1000; };

/* ------------------------------------------------------------------ retrato da máquina */
const tempos = () => {
  let idle = 0; let total = 0;
  for (const c of os.cpus()) { const t = c.times; idle += t.idle; total += t.user + t.nice + t.sys + t.idle + t.irq; }
  return { idle, total, at: performance.now() };
};
const amostras = []; // { at, ocupado (0..1) } dos últimos ~30 s
let amostrador = null;
function amostrar() {
  if (amostrador) return;
  let ultima = tempos();
  amostrador = setInterval(() => {
    const t = tempos(); const dt = t.total - ultima.total;
    if (dt > 0) amostras.push({ at: t.at, ocupado: 1 - (t.idle - ultima.idle) / dt });
    ultima = t;
    if (amostras.length > 60) amostras.shift();
  }, 500);
  amostrador.unref();
}

/** CPU ocupada da máquina (0..1) nos últimos `ms`: média e pico. null antes da primeira amostra. */
export function ocupacao(ms = 10_000) {
  amostrar();
  const desde = performance.now() - ms;
  const xs = amostras.filter((a) => a.at >= desde).map((a) => a.ocupado);
  if (!xs.length) return null;
  return { media: xs.reduce((s, x) => s + x, 0) / xs.length, pico: Math.max(...xs) };
}

/** Uma linha sobre a carga da máquina, para as mensagens de falha por tempo. */
export function retrato(extra = '') {
  const o = ocupacao();
  const cpu = o ? `CPU da máquina ${Math.round(o.media * 100)}% (pico ${Math.round(o.pico * 100)}%) nos últimos 10 s` : 'CPU da máquina ainda sem amostra';
  return `carga: ${cpu}, ${(os.freemem() / 2 ** 30).toFixed(1)} GB de RAM livres${extra ? `; ${extra}` : ''}`;
}

/* ------------------------------------------------------------------ laço de eventos e relógio do processo */
/**
 * Mede o laço de eventos em fatias (uma volta do intervalo de `passo` ms): a parede de cada fatia e a CPU que a thread
 * principal gastou nela. Bloqueio = CPU da fatia (o próprio código segurando o laço); fome = parede sem CPU além do passo
 * (o SO não deu vez ao processo: máquina ocupada), só nas fatias que passam de `limiar` ms além do passo (o temporizador
 * do Windows atrasa até ~16 ms à toa). No Windows a CPU da thread anda em degraus de ~15,6 ms.
 */
export function medidor({ passo = 5, limiar = 40 } = {}) {
  amostrar();
  const bloqueios = [];
  const m = { paradaMax: 0, bloqueioMax: 0, fomeMax: 0, fomeTotal: 0 };
  let w = performance.now(); let c = cpuMs();
  const iv = setInterval(() => {
    const w1 = performance.now(); const c1 = cpuMs();
    const parede = w1 - w; const cpu = Math.min(c1 - c, parede);
    w = w1; c = c1;
    const fome = parede > passo + limiar ? Math.max(0, parede - passo - cpu) : 0;
    bloqueios.push(cpu);
    m.paradaMax = Math.max(m.paradaMax, parede);
    m.bloqueioMax = Math.max(m.bloqueioMax, cpu);
    m.fomeMax = Math.max(m.fomeMax, fome);
    m.fomeTotal += fome;
  }, passo);
  return Object.assign(m, {
    parar() { clearInterval(iv); },
    /** Percentil p (0–100) do bloqueio por fatia, em ms de CPU. */
    percentil(p) {
      if (!bloqueios.length) return 0;
      const s = [...bloqueios].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
    },
    resumo() {
      return `laço: maior parada ${Math.round(m.paradaMax)} ms de parede, maior bloqueio ${Math.round(m.bloqueioMax)} ms de CPU desta thread, `
        + `até ${Math.round(m.fomeMax)} ms seguidos sem CPU (${Math.round(m.fomeTotal)} ms no total) · ${retrato()}`;
    },
  });
}

/**
 * Relógio do processo: a parede menos o tempo em que o processo ficou sem CPU (fatias bem além do passo sem CPU da thread
 * principal). Numa máquina livre anda igual ao Date.now; numa ocupada, o tempo em que o SO deixou o processo parado não
 * conta. Serve de `now` para o código testado (o SlotFeed aceita um) e de ritmo para o próprio teste (dormir/ate).
 */
export function relogioProcesso({ passo = 5, limiar = 40 } = {}) {
  const ancora = Date.now() - performance.now();
  let w = performance.now(); let c = cpuMs(); let parado = 0;
  const acerta = () => {
    const w1 = performance.now(); const gap = w1 - w;
    if (gap < passo) return;
    const c1 = cpuMs();
    if (gap > passo + limiar) parado += Math.max(0, gap - passo - (c1 - c));
    w = w1; c = c1;
  };
  const iv = setInterval(acerta, passo);
  iv.unref();
  const now = () => { acerta(); return ancora + performance.now() - parado; };
  const ate = async (t) => { while (now() < t) await sleep(Math.max(1, Math.min(2 * passo, t - now()))); };
  return {
    now,
    ate,
    dormir: (ms) => ate(now() + ms),
    /** ms de parede descontados até agora (o processo sem CPU). */
    get parado() { acerta(); return parado; },
    fechar() { clearInterval(iv); },
  };
}
