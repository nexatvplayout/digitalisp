// Os planos das revendas no site (GET /api/site/planos, sem login): os que o superadmin montou em Planos e módulos e
// deixou ativos e "Mostrar no site". Só o que o site mostra: nome, descrição, preço, limites e os módulos liberados.
import * as T from './tenancy.js';
import * as CAT from '../public/shared/funcionalidades.js';

/** O plano como o site mostra (nada de códigos internos de cobrança). */
export const sitePlan = (p) => ({
  code: p.code, name: p.name, description: String(p.description || '').replace(/\s*Rascunho sugerido com o preço do site: revise e ative\.?\s*$/, '').trim(), priceCents: p.priceCents, interval: p.interval, trialDays: p.trialDays,
  limits: Object.fromEntries(T.LIMIT_KEYS.map((k) => [k, p.limits?.[k] ?? null])),
  modules: CAT.FEATURE_KEYS.filter((k) => p.features?.[k]).map((k) => CAT.featureLabel(k)),
});

/** Os planos à venda: ativos, públicos, sem o Ilimitado (o plano interno do cliente padrão), na ordem do superadmin. */
export const sitePlans = async () => (await T.listPlans()).filter((p) => p.active && p.public && p.code !== T.UNLIMITED_PLAN).map(sitePlan);
