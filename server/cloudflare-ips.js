// Faixas de IP publicadas pela Cloudflare (de onde ela fala com o servidor de origem). Usadas por server/clientip.js: o
// cabeçalho CF-Connecting-IP só vale quando o salto que chegou ao servidor é da Cloudflare; quem fala direto com o domínio
// do Railway e forja o cabeçalho continua identificado pelo próprio IP.
//
// Atualizar: node scripts/update-cloudflare-ips.mjs (busca https://api.cloudflare.com/client/v4/ips e reescreve a lista
// abaixo). Sem novo deploy: CLOUDFLARE_IP_RANGES="faixa,faixa,…" substitui a lista inteira.
import net from 'node:net';

// conferida em 2026-10-08 contra https://www.cloudflare.com/ips-v4, /ips-v6 e a API (etag 38f79d050aa027e3be3865e495dcc9bc)
// início da lista (gerada por scripts/update-cloudflare-ips.mjs)
export const CLOUDFLARE_IPV4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20',
  '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];
export const CLOUDFLARE_IPV6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];
// fim da lista

/** "a.b.c.d/n" ou "x::/n" -> [endereço, prefixo, família] ou null. */
export function parseCidr(cidr) {
  const m = String(cidr || '').trim().match(/^([^/\s]+)\/(\d{1,3})$/);
  if (!m) return null;
  const family = net.isIP(m[1]);
  const bits = Number(m[2]);
  if (!family || bits > (family === 4 ? 32 : 128)) return null;
  return [m[1], bits, family === 4 ? 'ipv4' : 'ipv6'];
}

/** Lista de bloqueio do Node (net.BlockList) com as faixas; entradas inválidas saem com aviso. */
export function buildRanges(list) {
  const bl = new net.BlockList();
  for (const c of list) {
    const p = parseCidr(c);
    if (!p) { console.warn(`[cloudflare] faixa de IP inválida ignorada: "${c}"`); continue; }
    bl.addSubnet(p[0], p[1], p[2]);
  }
  return bl;
}

let cached = null;
/** Faixas em uso: CLOUDFLARE_IP_RANGES (substitui tudo) ou a lista embutida. */
export function cloudflareRanges() {
  if (!cached) {
    const env = String(process.env.CLOUDFLARE_IP_RANGES || '').split(/[\s,]+/).filter(Boolean);
    cached = buildRanges(env.length ? env : [...CLOUDFLARE_IPV4, ...CLOUDFLARE_IPV6]);
  }
  return cached;
}

/** O endereço (IPv4, IPv6 ou IPv4 mapeado em IPv6) está numa faixa da Cloudflare? */
export function isCloudflareIp(ip, ranges = cloudflareRanges()) {
  let a = String(ip || '').trim();
  if (a.startsWith('::ffff:') && net.isIPv4(a.slice(7))) a = a.slice(7);
  const family = net.isIP(a);
  if (!family) return false;
  return ranges.check(a, family === 4 ? 'ipv4' : 'ipv6');
}
