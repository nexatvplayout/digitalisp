// Módulo Prefeitura por conta (DIGITAL ISP): o superadmin liga o Painel da Prefeitura para uma conta (a revenda ou um
// cliente final dela), uma por uma. Por padrão fica desligado em todas: nenhum plano liga o módulo sozinho para todos os
// clientes (o Ilimitado também não). A lista das contas ligadas fica numa configuração, sem mexer em tabela.
import { getSetting, setSetting } from './db.js';

const KEY = 'prefeitura.contas';
let cache = null;

/** Os ids das contas com o módulo ligado pelo superadmin. */
export async function contasComPrefeitura() {
  if (cache) return cache;
  let ids = [];
  try { const v = JSON.parse(await getSetting(KEY, '[]')); if (Array.isArray(v)) ids = v.map(Number).filter((n) => Number.isInteger(n) && n > 0); } catch { /* lista vazia */ }
  cache = new Set(ids);
  return cache;
}
export const prefeituraLigada = async (tenantId) => (await contasComPrefeitura()).has(Number(tenantId));

/** Liga (true) ou desliga (false) o módulo de uma conta. */
export async function ligarPrefeitura(tenantId, on) {
  const s = new Set(await contasComPrefeitura());
  if (on) s.add(Number(tenantId)); else s.delete(Number(tenantId));
  await setSetting(KEY, JSON.stringify([...s].sort((a, b) => a - b)));
  cache = s;
}
