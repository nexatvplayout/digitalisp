// DIGITAL ISP · a PERMUTA: a revenda marca telas do cliente final como permuta e vincula mídias ou playlists dela (da
// biblioteca da revenda) como propaganda obrigatória. Nas telas da permuta (ou em todas as telas do cliente, se a revenda
// escolher) esses itens entram na zona de playlist maior de cada layout, intercalados com a programação do cliente.
// O cliente final vê o aviso mas não remove: os itens são da revenda e entram na montagem do /config (server/tvcorp.js).
// Guardado numa configuração por cliente final, sem mexer em tabela.
import { getSetting, setSetting } from './db.js';

const key = (t) => `tvcorp.permuta.${Number(t)}`;
const cache = new Map();
export const PERMUTA_MAX_ITENS = 30;

const ids = (v, max) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, max);

/** A permuta limpa: { on, scope: 'permuta' (só as telas marcadas) | 'all', devices, items: [{ kind: media|playlist, id }] }. */
export function limparPermuta(v = {}) {
  const seen = new Set();
  const items = (Array.isArray(v.items) ? v.items : []).map((x) => ({ kind: x?.kind === 'playlist' ? 'playlist' : 'media', id: Number(x?.id) }))
    .filter((x) => Number.isInteger(x.id) && x.id > 0 && !seen.has(`${x.kind}:${x.id}`) && seen.add(`${x.kind}:${x.id}`)).slice(0, PERMUTA_MAX_ITENS);
  return { on: Boolean(v.on), scope: v.scope === 'all' ? 'all' : 'permuta', devices: ids(v.devices, 2000), items };
}

export async function lerPermuta(clienteId) {
  const t = Number(clienteId);
  if (cache.has(t)) return cache.get(t);
  let v = null; try { v = JSON.parse(await getSetting(key(t), 'null')); } catch { /* nada guardado */ }
  const p = limparPermuta(v || {});
  cache.set(t, p);
  return p;
}

export async function salvarPermuta(clienteId, body) {
  const p = limparPermuta(body);
  await setSetting(key(clienteId), JSON.stringify(p));
  cache.set(Number(clienteId), p);
  return p;
}

/** A tela recebe a propaganda? (permuta ligada, com itens, e a tela marcada, ou "todas as telas"). */
export const telaNaPermuta = (p, deviceId) => Boolean(p?.on && p.items.length && (p.scope === 'all' || p.devices.includes(Number(deviceId))));

/**
 * Intercala a propaganda (ads) na programação do cliente (mine), espalhada por igual, sem passar de max itens: corta
 * itens do cliente, nunca a propaganda.
 */
export function intercalar(mine, ads, max) {
  const a = ads.slice(0, max);
  const c = mine.slice(0, Math.max(0, max - a.length));
  if (!c.length) return a;
  if (!a.length) return c;
  const out = []; let j = 0;
  for (let i = 0; i < c.length; i++) {
    out.push(c[i]);
    while (j < a.length && (i + 1) >= ((j + 1) * c.length) / a.length) out.push(a[j++]);
  }
  while (j < a.length) out.push(a[j++]);
  return out;
}

/** A zona que recebe a propaganda: a zona de playlist maior do layout (ou null, se o layout não tem). */
export function zonaDaPermuta(zones) {
  let best = null;
  for (const z of zones || []) if (z.kind === 'playlist' && (!best || z.w * z.h > best.w * best.h)) best = z;
  return best;
}
