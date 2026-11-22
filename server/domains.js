// Domínio próprio da revenda (white-label): o painel e os links de controle no endereço dela (ex.: telas.provedor.com.br).
// Por enquanto só a leitura: qual revenda atende um Host. O cadastro e a verificação voltam quando a hospedagem de produção
// estiver decidida (PASSAGEM.md); a automação Cloudflare + Railway do NEXA Broadcast não veio.
import { db } from './db.js';

const CACHE_MS = 30_000;
const hostCache = new Map();

/** A revenda dona de um domínio verificado (com ou sem www), ou null. */
export async function hostTenantId(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h || h.length > 253) return null;
  const hit = hostCache.get(h);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.tid;
  const bare = h.startsWith('www.') ? h.slice(4) : null;
  const row = await db.get("SELECT tenant_id FROM domains WHERE status = 'verified' AND (hostname = ? OR (include_www = 1 AND hostname = ?))", [h, bare ?? h]);
  const tid = row ? Number(row.tenant_id) : null;
  hostCache.set(h, { at: Date.now(), tid });
  if (hostCache.size > 2000) hostCache.clear();
  return tid;
}

export const invalidateHosts = () => hostCache.clear();
