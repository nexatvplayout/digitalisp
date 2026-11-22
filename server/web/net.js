import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';

/**
 * Busca HTTP para as fontes de dados do gerador de caracteres (RSS, JSON, clima, cotações, redes sociais, imagens).
 * Quem configura a URL é o cliente da plataforma: sem proteção, o servidor viraria uma ponte para a rede interna (SSRF:
 * metadados da nuvem, banco, painéis locais). Por isso o endereço é conferido DEPOIS da resolução DNS, no próprio
 * `lookup` da conexão (não há janela para "DNS rebinding"), redirecionamentos são seguidos à mão e conferidos de novo,
 * e a resposta tem tempo e tamanho máximos. CG_ALLOW_PRIVATE_FETCH=1 libera a rede interna (laboratório/desenvolvimento).
 */
const allowPrivate = () => process.env.CG_ALLOW_PRIVATE_FETCH === '1';

function v4Private(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

/** IPv6 em 8 grupos de 16 bits (aceita "::" e o IPv4 no fim, ex.: ::ffff:127.0.0.1). null se não for IPv6 válido. */
export function ipv6Groups(s) {
  if (!net.isIPv6(s)) return null;
  let str = s;
  const v4 = str.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[1].split('.').map(Number);
    str = `${str.slice(0, -v4[1].length)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const [head, tail] = str.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const groups = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return groups.length === 8 ? groups.map((g) => parseInt(g || '0', 16)) : null;
}
const v4From = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * Endereço de rede interna, reservado, de documentação, multicast ou loopback (IPv4 e IPv6). O IPv6 é expandido para
 * 16 bytes: o parser de URL reescreve [::ffff:127.0.0.1] como ::ffff:7f00:1, então o IPv4 embutido é testado em todos os
 * prefixos que o carregam (mapeado ::ffff:0:0/96, compatível ::/96, NAT64 64:ff9b::/96 e 64:ff9b:1::/48, 6to4 2002::/16)
 * e o Teredo (2001::/32) é recusado inteiro.
 */
export function isPrivateIp(ip) {
  const s = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (net.isIPv4(s)) return v4Private(s);
  const g = ipv6Groups(s);
  if (!g) return true;
  const zero = (a, b) => g.slice(a, b).every((x) => x === 0);
  if (zero(0, 4)) {
    // primeiros 64 bits zerados não são unicast global: só valem o IPv4 mapeado (::ffff:a.b.c.d) e o traduzido
    // (::ffff:0:a.b.c.d), conferidos pelo IPv4; o resto (::, ::1, ::a.b.c.d compatível…) é recusado
    if (g[4] === 0 && g[5] === 0xffff) return v4Private(v4From(g[6], g[7]));
    if (g[4] === 0xffff && g[5] === 0) return v4Private(v4From(g[6], g[7]));
    return true;
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) return zero(2, 6) ? v4Private(v4From(g[6], g[7])) : true; // NAT64 (e 64:ff9b:1::/48)
  if (g[0] === 0x2002) return v4Private(v4From(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentação
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 (site-local, obsoleto)
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x100 && zero(1, 4)) return true; // 100::/64 (descarte)
  return false;
}

const blocked = () => Object.assign(new Error('Endereço não permitido: a fonte aponta para a rede interna do servidor.'), { code: 'EPRIVATE', status: 400 });

export function guardedLookup(hostname, opts, cb) {
  dns.lookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = allowPrivate() ? addrs : addrs.filter((a) => !isPrivateIp(a.address));
    if (!ok.length) return cb(blocked());
    if (opts && opts.all) return cb(null, ok);
    return cb(null, ok[0].address, ok[0].family);
  });
}

/**
 * GET/POST com proteções. Devolve { status, headers, body: Buffer, text(), json() }.
 * timeout: inatividade da conexão e prazo da leitura do corpo. signal (opcional, ex.: AbortSignal.timeout(15000)): prazo
 * TOTAL que cobre conexão, cabeçalho e corpo (um servidor que solta 1 byte a cada poucos segundos não segura a busca).
 * @param {string} url
 */
export async function safeFetch(url, { method = 'GET', headers = {}, body = null, timeout = 10000, maxBytes = 2 * 1024 * 1024, redirects = 3, signal = null } = {}) {
  if (signal?.aborted) throw Object.assign(new Error('Tempo esgotado ao buscar a fonte.'), { code: 'ETIMEDOUT' });
  let u;
  try { u = new URL(String(url)); } catch { throw Object.assign(new Error('URL inválida.'), { status: 400 }); }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('Use um endereço http:// ou https://.'), { status: 400 });
  if (u.username || u.password) throw Object.assign(new Error('URL com usuário/senha não é aceita.'), { status: 400 });
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !allowPrivate() && isPrivateIp(host)) throw blocked();
  if (/^(localhost|.*\.localhost|.*\.internal|.*\.local)$/i.test(host) && !allowPrivate()) throw blocked();
  const lib = u.protocol === 'https:' ? https : http;
  const res = await new Promise((resolve, reject) => {
    const req = lib.request(u, {
      method, lookup: guardedLookup, timeout, ...(signal ? { signal } : {}),
      headers: { 'user-agent': 'NEXA-TV-CG/1.0 (+gerador de caracteres)', accept: '*/*', 'accept-encoding': 'gzip, deflate, br', ...headers },
    }, resolve);
    req.on('timeout', () => req.destroy(Object.assign(new Error('Tempo esgotado ao buscar a fonte.'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    res.resume();
    if (redirects <= 0) throw new Error('Redirecionamentos demais.');
    return safeFetch(new URL(res.headers.location, u).toString(), { method: method === 'POST' ? 'GET' : method, headers, timeout, maxBytes, redirects: redirects - 1, signal });
  }
  const enc = String(res.headers['content-encoding'] || '').toLowerCase();
  const stream = enc === 'gzip' ? res.pipe(zlib.createGunzip()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
  const chunks = [];
  let size = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { res.destroy(); reject(new Error('Tempo esgotado ao ler a resposta.')); }, timeout);
    const onAbort = () => { clearTimeout(timer); res.destroy(); reject(new Error('Tempo esgotado ao ler a resposta.')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    stream.on('close', () => signal?.removeEventListener('abort', onAbort));
    stream.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { clearTimeout(timer); res.destroy(); reject(new Error(`Resposta maior que ${Math.round(maxBytes / 1024)} KB.`)); return; }
      chunks.push(c);
    });
    stream.on('end', () => { clearTimeout(timer); resolve(); });
    stream.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
  const buf = Buffer.concat(chunks);
  return {
    status: res.statusCode, headers: res.headers, body: buf,
    text: () => buf.toString('utf8'),
    json: () => JSON.parse(buf.toString('utf8')),
  };
}

/** GET de JSON com erro legível quando o serviço responde com falha. */
export async function getJson(url, opts) {
  const r = await safeFetch(url, opts);
  let data = null;
  try { data = r.json(); } catch { /* corpo não é JSON */ }
  if (r.status >= 400) {
    const msg = data?.error?.message || data?.message || data?.detail || data?.title || `HTTP ${r.status}`;
    throw Object.assign(new Error(String(msg).slice(0, 200)), { status: r.status, data });
  }
  if (data == null) throw new Error('A resposta não é JSON.');
  return data;
}
