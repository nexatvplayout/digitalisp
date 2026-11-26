// DIGITAL ISP · o rodízio de DEMONSTRAÇÃO (aba Telas, botão "DEMONSTRAÇÃO", só nas contas com a demonstração ligada:
// server/demo-contas.js). Ligado, as telas escolhidas (ou todas) trocam de layout sozinhas, na ordem da lista, a cada
// intervalo. O servidor escolhe o layout pela hora (sem tarefa em segundo plano): a TV percebe a troca no sinal de vida.
// Guardado numa configuração por conta, sem mexer em tabela.
import { getSetting, setSetting } from './db.js';
import { demoLigada } from './demo-contas.js';

export const RODIZIO_MIN_S = 10;
export const RODIZIO_MAX_S = 3600;
const key = (t) => `tvcorp.demo.rodizio.${Number(t)}`;
const cache = new Map();

const ids = (v, max) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, max);

/** O rodízio limpo: { on, seconds, layoutIds, devices (vazio = todas as telas), startedAt }. */
export function limparRodizio(v = {}, t = Date.now()) {
  const s = Math.round(Number(v.seconds));
  return {
    on: Boolean(v.on),
    seconds: Number.isFinite(s) ? Math.min(RODIZIO_MAX_S, Math.max(RODIZIO_MIN_S, s)) : 30,
    layoutIds: ids(v.layoutIds, 300),
    devices: ids(v.devices, 2000),
    startedAt: Number.isFinite(Number(v.startedAt)) && Number(v.startedAt) > 0 ? Number(v.startedAt) : t,
  };
}

export async function lerRodizio(tenantId) {
  const t = Number(tenantId);
  if (cache.has(t)) return cache.get(t);
  let v = null; try { v = JSON.parse(await getSetting(key(t), 'null')); } catch { /* nada guardado */ }
  const r = limparRodizio(v || { on: false });
  cache.set(t, r);
  return r;
}

export async function salvarRodizio(tenantId, body, t = Date.now()) {
  const r = limparRodizio({ ...body, startedAt: t }, t); // ligar (ou mudar) recomeça do primeiro layout
  if (r.on && r.layoutIds.length < 2) { const e = new Error('Escolha pelo menos 2 layouts para o rodízio.'); e.status = 400; throw e; }
  await setSetting(key(tenantId), JSON.stringify(r));
  cache.set(Number(tenantId), r);
  return r;
}

/** O layout que a tela mostra agora no rodízio ({ layoutId, pos }), ou null (desligado ou tela fora do rodízio). */
export async function layoutDoRodizio(tenantId, deviceId, t = Date.now(), existe = () => true) {
  const r = await lerRodizio(tenantId);
  if (!r.on || r.layoutIds.length < 1) return null;
  if (r.devices.length && !r.devices.includes(Number(deviceId))) return null;
  if (!(await demoLigada(tenantId))) return null;
  const lista = r.layoutIds.filter(existe); // um layout apagado sai da roda
  if (!lista.length) return null;
  const pos = Math.floor(Math.max(0, t - r.startedAt) / (r.seconds * 1000)) % lista.length;
  return { layoutId: lista[pos], pos };
}
