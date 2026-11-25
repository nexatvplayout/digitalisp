// IP de quem fez o pedido, para freios por IP e para a auditoria.
// A Cloudflare põe o IP real em CF-Connecting-IP. O cabeçalho só vale quando o salto (req.ip) é de confiança:
//   - TRUST_PROXY ligado e o salto nas faixas publicadas da Cloudflare (server/cloudflare-ips.js); ou
//   - CF_TUNNEL=1 e o salto é a própria máquina (o cloudflared do túnel entrega os pedidos em 127.0.0.1; o servidor
//     escuta só no loopback, então ninguém de fora chega por ali para forjar o cabeçalho).
// Sem isso, atrás do túnel todo mundo pareceria 127.0.0.1 e um freio por IP bloquearia todos juntos.
import net from 'node:net';
import { config } from './config.js';
import { isCloudflareIp, cloudflareRanges } from './cloudflare-ips.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function clientIp(req, { trustProxy = config.http.trustProxy, tunnel = config.http.cfTunnel, ranges = null } = {}) {
  const hop = req.ip || req.socket?.remoteAddress;
  const trusted = (tunnel && LOOPBACK.has(hop)) || (trustProxy && isCloudflareIp(hop, ranges || cloudflareRanges()));
  if (trusted) {
    const cf = String(req.get?.('cf-connecting-ip') || '').trim();
    if (net.isIP(cf)) return cf;
  }
  return hop;
}
