// Cloudflare API v4: zonas (uma por domínio de cliente, na conta da plataforma) e registros DNS.
// Documentação: https://developers.cloudflare.com/api/resources/zones/ e .../dns/subresources/records/
// Variáveis: CLOUDFLARE_API_TOKEN (permissões Zone:Edit, DNS:Edit e Zone Settings:Edit na conta), CLOUDFLARE_ACCOUNT_ID,
// CLOUDFLARE_PROXIED (opcional, padrão 1), CLOUDFLARE_API_BASE (só testes: servidor falso). Nada aqui foi testado contra a Cloudflare real.
import { requestJson } from './http.js';

export const ENV = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
const conf = () => ({
  token: (process.env.CLOUDFLARE_API_TOKEN || '').trim(),
  account: (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim(),
  base: (process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4').trim().replace(/\/+$/, ''),
});
export const missing = () => ENV.filter((k) => !(process.env[k] || '').trim());
export const configured = () => missing().length === 0;

/** Códigos de erro conhecidos (POST /zones). NÃO CONFIRMADO na documentação oficial: vêm de bibliotecas e relatos públicos. */
export const ZONE_EXISTS_CODES = new Set([1061, 1097]);
/** "não é um domínio registrado" (ex.: subdomínio). NÃO CONFIRMADO na documentação oficial. */
export const NOT_REGISTERED_CODES = new Set([1049]);

const parseError = (j) => ({
  codes: (j?.errors || []).map((e) => Number(e.code)).filter(Number.isFinite),
  message: (j?.errors || []).map((e) => `${e.message}${e.code ? ` (código ${e.code})` : ''}`).join('; ') || null,
});

async function cf(method, path, body) {
  const c = conf();
  if (!c.token) throw Object.assign(new Error('Cloudflare não configurada: defina CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID.'), { status: 503 });
  const json = await requestJson({ provider: 'Cloudflare', url: `${c.base}${path}`, method, token: c.token, body, parseError });
  return json?.result;
}
const enc = encodeURIComponent;

/** Zona com este nome NA CONTA da plataforma (ou null). */
export async function findZone(name) {
  const list = await cf('GET', `/zones?name=${enc(name)}&account.id=${enc(conf().account)}`);
  return (Array.isArray(list) ? list : []).find((z) => String(z.name).toLowerCase() === name) || null;
}
/** Cria a zona (type full). A resposta traz name_servers e status "pending". */
export const createZone = (name) => cf('POST', '/zones', { name, account: { id: conf().account }, type: 'full' });
export const getZone = (id) => cf('GET', `/zones/${enc(id)}`);
export const deleteZone = (id) => cf('DELETE', `/zones/${enc(id)}`);
/** Pede uma nova checagem dos servidores DNS (zona pendente). Limite: 1 por hora em zona Free, 1 a cada 5 min nas pagas. */
export const activationCheck = (id) => cf('PUT', `/zones/${enc(id)}/activation_check`);

export const listRecords = async (zoneId, name) => (await cf('GET', `/zones/${enc(zoneId)}/dns_records?name=${enc(name)}&per_page=100`)) || [];
export const createRecord = (zoneId, rec) => cf('POST', `/zones/${enc(zoneId)}/dns_records`, rec);
export const deleteRecord = (zoneId, id) => cf('DELETE', `/zones/${enc(zoneId)}/dns_records/${enc(id)}`);

/**
 * Proxy (nuvem laranja) nos registros que apontam para o Railway. Padrão LIGADO: a documentação do Railway descreve o
 * domínio atrás do proxy da Cloudflare com SSL/TLS "Full" (não "Full (strict)") e Universal SSL; CLOUDFLARE_PROXIED=0
 * deixa "só DNS" (nuvem cinza), útil se o certificado do Railway travar em "Validating Challenges".
 */
export const proxiedDefault = () => !['0', 'false', 'nao', 'não', 'off'].includes(String(process.env.CLOUDFLARE_PROXIED ?? '1').trim().toLowerCase());

/** SSL/TLS da zona ("full" para o Railway). PATCH /zones/:id/settings/ssl — exige a permissão Zone Settings: Edit. */
export const setSslMode = (zoneId, value = 'full') => cf('PATCH', `/zones/${enc(zoneId)}/settings/ssl`, { value });

/**
 * Garante UM registro {type, name, content}. A/AAAA/CNAME: apaga os conflitantes no mesmo nome (a zona é da plataforma) e
 * aplica o proxy pedido; CNAME no apex é aceito (a Cloudflare faz "CNAME flattening"). TXT só é acrescentado (nunca com proxy).
 */
export async function ensureRecord(zoneId, { type, name, content, ttl = 1, proxied = false }) {
  const current = await listRecords(zoneId, name);
  const same = current.find((r) => r.type === type && String(r.content).toLowerCase() === String(content).toLowerCase());
  const px = type === 'TXT' ? undefined : Boolean(proxied);
  if (type !== 'TXT') {
    for (const r of current) if (['A', 'AAAA', 'CNAME'].includes(r.type) && r !== same) await deleteRecord(zoneId, r.id);
  }
  if (same && (type === 'TXT' || Boolean(same.proxied) === px)) return same;
  if (same) await deleteRecord(zoneId, same.id);
  return createRecord(zoneId, { type, name, content, ttl, ...(type === 'TXT' ? {} : { proxied: px }) });
}

/** Teste de conexão: o token é válido? (GET /user/tokens/verify; token da conta: /accounts/:id/tokens/verify — NÃO CONFIRMADO) */
export async function verifyToken() {
  try {
    return await cf('GET', '/user/tokens/verify');
  } catch (e) {
    if (e.upstreamStatus && conf().account) return cf('GET', `/accounts/${enc(conf().account)}/tokens/verify`);
    throw e;
  }
}
