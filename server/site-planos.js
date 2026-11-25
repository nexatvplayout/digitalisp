// Os planos das revendas no site (GET /api/site/planos, sem login): todos os que o superadmin montou em Planos e módulos,
// menos o Ilimitado (o plano interno do cliente padrão) e os que ele desmarcou em "Mostrar no site". Só o que o site
// mostra: nome, descrição, preço, limites e os módulos liberados. Os ocultos ficam numa configuração (lista de códigos),
// sem mexer na tabela de planos.
import { getSetting, setSetting } from './db.js';
import * as T from './tenancy.js';
import * as CAT from '../public/shared/funcionalidades.js';

const HIDDEN_KEY = 'site.planos.ocultos';

/** Os códigos dos planos que o superadmin tirou do site. */
export async function hiddenCodes() {
  try { const v = JSON.parse(await getSetting(HIDDEN_KEY, '[]')); return new Set(Array.isArray(v) ? v.map(String) : []); } catch { return new Set(); }
}
/** Mostrar (true) ou tirar (false) um plano do site. */
export async function setSiteVisible(code, visible) {
  const s = await hiddenCodes();
  if (visible) s.delete(String(code)); else s.add(String(code));
  await setSetting(HIDDEN_KEY, JSON.stringify([...s].sort()));
}

/** O plano como o site mostra (nada de códigos internos de cobrança; sem a nota de rascunho dos planos sugeridos). */
export const sitePlan = (p) => ({
  code: p.code, name: p.name, description: String(p.description || '').replace(/\s*Rascunho sugerido com o preço do site: revise e ative\.?\s*$/, '').trim(),
  priceCents: p.priceCents, interval: p.interval, trialDays: p.trialDays,
  limits: Object.fromEntries(T.LIMIT_KEYS.map((k) => [k, p.limits?.[k] ?? null])),
  modules: CAT.FEATURE_KEYS.filter((k) => p.features?.[k]).map((k) => CAT.featureLabel(k)),
});

/** Os planos do site, na ordem do superadmin (ordem e preço). */
export async function sitePlans() {
  const hidden = await hiddenCodes();
  return (await T.listPlans()).filter((p) => p.code !== T.UNLIMITED_PLAN && !hidden.has(p.code)).map(sitePlan);
}
