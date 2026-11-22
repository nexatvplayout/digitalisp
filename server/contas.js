// Contas do DIGITAL ISP: plataforma → revenda → cliente final.
// O cliente final é uma conta própria (um tenant), filha da revenda (isp_conta.revenda_id): as telas, as unidades, as
// mídias, as playlists e a grade dele ficam separados dos outros clientes pelo próprio tenant_id, sem mudar os módulos
// herdados. A revenda enxerga e administra os clientes dela de cima (server/revenda.js).
//
// Plano do cliente: o que a revenda criou (isp_planos_cliente), sempre dentro do plano da revenda com a plataforma:
//   módulos = os do plano do cliente E os do plano da revenda; limites = os do plano do cliente.
import { db } from './db.js';
import * as T from './tenancy.js';
import * as CAT from '../public/shared/funcionalidades.js';

const TTL = 5000;
const cache = new Map();
const j = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

/** { tipo: 'revenda'|'cliente', revendaId, pessoa, planoClienteId } (sem linha = revenda). */
export async function contaOf(tenantId) {
  const id = Number(tenantId);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const r = await db.get('SELECT * FROM isp_conta WHERE tenant_id = ?', [id]);
  const v = r ? { tipo: r.tipo, revendaId: r.revenda_id != null ? Number(r.revenda_id) : null, pessoa: r.pessoa, planoClienteId: r.plano_cliente_id != null ? Number(r.plano_cliente_id) : null }
    : { tipo: 'revenda', revendaId: null, pessoa: 'pj', planoClienteId: null };
  cache.set(id, { at: Date.now(), v });
  if (cache.size > 5000) cache.clear();
  return v;
}
export const forgetConta = (id) => (id == null ? cache.clear() : cache.delete(Number(id)));
export const isCliente = async (tenantId) => (await contaOf(tenantId)).tipo === 'cliente';
/** O cliente é desta revenda? */
export const ehDaRevenda = async (revendaId, clienteId) => { const c = await contaOf(clienteId); return c.tipo === 'cliente' && c.revendaId === Number(revendaId); };

/** Os ids dos clientes da revenda. */
export const clientesDe = async (revendaId) => (await db.all("SELECT tenant_id FROM isp_conta WHERE tipo = 'cliente' AND revenda_id = ?", [revendaId])).map((r) => Number(r.tenant_id));

export const planoClienteDto = (p) => p && ({
  id: Number(p.id), nome: p.nome, descricao: p.descricao, telas: p.telas != null ? Number(p.telas) : null, usuarios: p.usuarios != null ? Number(p.usuarios) : null,
  storageMB: p.storage_mb != null ? Number(p.storage_mb) : null, modulos: j(p.modulos, {}), precoCents: Number(p.preco_cents) || 0, ativo: Boolean(Number(p.ativo)), sort: Number(p.sort) || 0,
});

/** O plano efetivo do cliente final (o gancho do tenancy.effectivePlan). Revenda: null (segue o plano dela). */
export async function planoDoCliente(tenant, basePlan) {
  const c = await contaOf(tenant.id);
  if (c.tipo !== 'cliente') return null;
  const rev = c.revendaId ? await T.getTenant(c.revendaId) : null;
  const pr = rev ? await basePlan(rev) : null; // o plano da revenda com a plataforma
  const p = c.planoClienteId ? planoClienteDto(await db.get('SELECT * FROM isp_planos_cliente WHERE id = ? AND revenda_id = ?', [c.planoClienteId, c.revendaId])) : null;
  const revF = pr?.features || {};
  const features = {};
  for (const k of CAT.ALL_KEYS) {
    const f = CAT.BY_KEY[k];
    features[k] = f.core ? true : Boolean(revF[k]) && Boolean(p?.modulos?.[k]);
  }
  // a revenda suspensa ou sem plano derruba os clientes dela junto (as rotas recusam; a TV mostra a imagem sem conexão)
  return {
    id: null, code: p ? `cliente-${p.id}` : 'cliente-sem-plano', name: p ? p.nome : 'Sem plano', description: p?.descricao || '',
    priceCents: p?.precoCents || 0, currency: 'brl', interval: 'month', trialDays: 0, active: Boolean(p?.ativo), public: false, gatewayRefs: {},
    profileId: null, profile: null,
    limits: { telas: p ? p.telas : 0, clientes: 0, users: p ? p.usuarios : 1, storageMB: p ? p.storageMB : 0 },
    features,
    revenda: rev ? { id: Number(rev.id), name: rev.name, status: rev.status } : null,
  };
}

/** Telas (não revogadas) e chaves ainda válidas de uma conta. */
async function telasDe(tenantIds) {
  if (!tenantIds.length) return { telas: 0, chaves: 0 };
  const q = tenantIds.map(() => '?').join(',');
  const telas = Number((await db.get(`SELECT COUNT(*) AS n FROM telas_devices WHERE revoked_at IS NULL AND tenant_id IN (${q})`, tenantIds)).n) || 0;
  const chaves = Number((await db.get(`SELECT COUNT(*) AS n FROM telas_keys WHERE used_at IS NULL AND expires_at > ? AND tenant_id IN (${q})`, [Date.now(), ...tenantIds])).n) || 0;
  return { telas, chaves };
}

/**
 * Pode cadastrar mais uma tela nesta conta? Confere o plano do cliente (telas dele) e o plano da revenda (a soma das telas
 * de todos os clientes dela mais as dela mesma). Lança 402 limit_reached com a frase para a tela.
 */
export async function assertNovaTela(tenantId) {
  const tid = Number(tenantId);
  const c = await contaOf(tid);
  const tenant = await T.getTenant(tid);
  const plan = await T.effectivePlan(tenant);
  const lim = plan.limits?.telas;
  if (lim != null) {
    const u = await telasDe([tid]);
    if (u.telas + u.chaves >= lim) throw Object.assign(new Error(`O plano ${plan.name} permite até ${lim} tela(s), contando as chaves ainda não usadas. Fale com a sua revenda para aumentar.`), { status: 402, code: 'limit_reached' });
  }
  const revId = c.tipo === 'cliente' ? c.revendaId : tid;
  if (revId) {
    const rev = await T.getTenant(revId);
    const pr = rev ? await T.effectivePlan(rev) : null;
    const limR = pr?.limits?.telas;
    if (limR != null) {
      const u = await telasDe([revId, ...(await clientesDe(revId))]);
      if (u.telas + u.chaves >= limR) throw Object.assign(new Error(`A revenda chegou ao limite de ${limR} telas do plano ${pr.name}. ${c.tipo === 'cliente' ? 'Fale com a sua revenda.' : 'Fale com a DIGITAL ISP para aumentar o plano.'}`), { status: 402, code: 'limit_reached' });
    }
  }
}

/** Uso de telas da revenda: as dela e as dos clientes, contra o limite do plano dela. */
export async function usoRevenda(revendaId) {
  const ids = [revendaId, ...(await clientesDe(revendaId))];
  const u = await telasDe(ids);
  const rev = await T.getTenant(revendaId);
  const pr = rev ? await T.effectivePlan(rev) : null;
  const vendidas = Number((await db.get(`SELECT COALESCE(SUM(p.telas), 0) AS n FROM isp_conta c JOIN isp_planos_cliente p ON p.id = c.plano_cliente_id WHERE c.tipo = 'cliente' AND c.revenda_id = ?`, [revendaId])).n) || 0;
  return { telas: u.telas, chaves: u.chaves, limite: pr?.limits?.telas ?? null, vendidas, clientes: ids.length - 1, limiteClientes: pr?.limits?.clientes ?? null, plano: pr ? { code: pr.code, name: pr.name, features: pr.features } : null };
}

export function bindContas() {
  T.setPlanHook(planoDoCliente);
}
