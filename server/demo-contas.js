// Layouts de DEMONSTRAÇÃO por conta (DIGITAL ISP): a seção no fim da aba Layouts com os 20 prontos para mostrar ao cliente
// (public/shared/tvcorp-demos.js). Só aparece nas contas ligadas pelo superadmin; sem nada guardado, só a conta principal
// (a do dono da plataforma). A lista fica numa configuração, sem mexer em tabela.
import { getSetting, setSetting } from './db.js';
import { DEFAULT_TENANT_ID } from './tenancy.js';

const KEY = 'demo.contas';
let cache = null;

/** Os ids das contas com a demonstração ligada. */
export async function contasComDemo() {
  if (cache) return cache;
  let ids = [DEFAULT_TENANT_ID];
  try { const v = JSON.parse(await getSetting(KEY, 'null')); if (Array.isArray(v)) ids = v.map(Number).filter((n) => Number.isInteger(n) && n > 0); } catch { /* o padrão */ }
  cache = new Set(ids);
  return cache;
}
export const demoLigada = async (tenantId) => (await contasComDemo()).has(Number(tenantId));

/** Liga (true) ou desliga (false) a demonstração de uma conta. */
export async function ligarDemo(tenantId, on) {
  const s = new Set(await contasComDemo());
  if (on) s.add(Number(tenantId)); else s.delete(Number(tenantId));
  await setSetting(KEY, JSON.stringify([...s].sort((a, b) => a - b)));
  cache = s;
}
