/**
 * Freio simples em memória (janela deslizante por chave): curtidas, chat e pontos (XP) do site do espectador.
 * `hit(chave)` conta um pedido e diz se ainda cabe; `peek(chave)` só conta quantos houve na janela. As chaves vazias somem
 * sozinhas (limpeza a cada janela), então a memória fica proporcional a quem pediu nos últimos instantes.
 */
export function createLimiter({ windowMs, max, maxKeys = Infinity, now = () => Date.now() }) {
  const hits = new Map(); // chave -> instantes dos pedidos na janela
  const prune = (list, t) => { while (list.length && t - list[0] >= windowMs) list.shift(); };
  const timer = setInterval(() => {
    const t = now();
    for (const [k, list] of hits) { prune(list, t); if (!list.length) hits.delete(k); }
  }, Math.max(1000, windowMs));
  timer.unref?.();
  return {
    /**
     * Conta o pedido e devolve true se ainda cabe na janela (o que passa do limite não é contado). Com maxKeys, a memória do
     * freio tem teto mesmo com milhões de endereços IPv6 diferentes: com o mapa cheio, a chave nova ENTRA e sai a usada há
     * mais tempo (o mapa fica na ordem do último uso). Antes a chave nova era recusada, e um /48 de túnel que enchesse o
     * mapa com /64 deixava todo IP novo da plataforma barrado até a janela passar.
     */
    hit(key, cost = 1) {
      const t = now();
      let list = hits.get(key);
      if (list) hits.delete(key); // volta para o fim (o mais recente)
      else {
        list = [];
        if (hits.size >= maxKeys) hits.delete(hits.keys().next().value); // a usada há mais tempo
      }
      prune(list, t);
      hits.set(key, list);
      if (list.length + cost > max) return false;
      for (let i = 0; i < cost; i++) list.push(t);
      return true;
    },
    /** Quantos pedidos a chave fez na janela. */
    peek(key) { const list = hits.get(key); if (!list) return 0; prune(list, now()); return list.length; },
    /** Quanto ainda cabe na janela. */
    left(key) { return Math.max(0, max - this.peek(key)); },
    size: () => hits.size,
    stop: () => clearInterval(timer),
  };
}

/**
 * Chave de IP para os freios: IPv4 como está (inclusive o IPv4 mapeado em IPv6, ::ffff:1.2.3.4) e IPv6 agrupado pelo
 * prefixo /64 (a rede de um cliente; um /64 tem 2^64 endereços, então um freio por endereço IPv6 não segura ninguém).
 * Vale em TODOS os freios por IP do site do espectador: curtidas, chat, reações e pontos.
 */
export function ipKey(ip) {
  let s = String(ip || '').trim().toLowerCase();
  if (!s) return '-';
  const z = s.indexOf('%'); if (z >= 0) s = s.slice(0, z); // zona (fe80::1%eth0)
  const m4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (m4) return m4[1];
  if (!s.includes(':')) return s;
  // expande o "::" e fica com os 4 primeiros grupos (64 bits)
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  if (t.length && t[t.length - 1].includes('.')) t.splice(-1, 1, '0', '0'); // IPv4 embutido no fim: não entra no /64
  const groups = tail !== undefined ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map((g) => (g || '0').replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
