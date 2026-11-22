// Relógio da plataforma sincronizado por NTP (docs/RELOGIO.md). O contêiner não pode acertar o relógio do sistema, então o
// servidor mede a diferença para os servidores NTP (SNTP, RFC 4330) e soma essa diferença à hora que a grade, o EPG, o
// plantão, o serverTime dos apps e o PROGRAM-DATE-TIME do HLS usam. A correção é gradual (no máximo 20 ms por segundo):
// a hora nunca anda para trás nem dá saltos no ar. Padrão: servidores do NTP.br (NIC.br), editáveis no superadmin.
import dgram from 'node:dgram';
import net from 'node:net';

/** NTP.br (NIC.br): a.st1–d.st1 são stratum 1; a/b/c.ntp.br são os endereços gerais do projeto. */
export const NIC_BR = ['a.st1.ntp.br', 'b.st1.ntp.br', 'c.st1.ntp.br', 'd.st1.ntp.br', 'a.ntp.br', 'b.ntp.br', 'c.ntp.br'];
const NTP_EPOCH = 2208988800; // segundos entre 1900 (NTP) e 1970 (Unix)
const SLEW_MS_PER_S = 20;     // correção gradual: o relógio corre até 2 % mais rápido ou mais devagar até alcançar
const STEP_MS = 10_000;       // diferença maior que isso: o relógio estava muito errado, corrige de uma vez
const MAX_SERVERS = 8;

/** "host", "host:porta" ou "[ipv6]:porta" -> { host, port }; null se inválido. */
export function parseServer(s) {
  const v = String(s ?? '').trim();
  const m = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/i.exec(v) || (net.isIPv6(v) ? [v, v, null] : /^([a-z0-9.-]+)(?::(\d{1,5}))?$/i.exec(v));
  if (!m) return null;
  const host = m[1].toLowerCase();
  const port = m[2] ? Number(m[2]) : 123;
  if (port < 1 || port > 65535) return null;
  if (!net.isIP(host) && !/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(host)) return null;
  return { host, port };
}

/** Lista (array ou texto com vírgulas/linhas) -> servidores válidos, sem repetição. Lança com a primeira entrada inválida. */
export function normalizeServers(input) {
  const list = (Array.isArray(input) ? input : String(input ?? '').split(/[\s,;]+/)).map((x) => String(x).trim()).filter(Boolean);
  const out = [];
  for (const s of list) {
    const p = parseServer(s);
    if (!p) throw Object.assign(new Error(`Servidor NTP inválido: "${s.slice(0, 80)}". Use um nome (a.st1.ntp.br) ou host:porta.`), { status: 400 });
    const key = p.port === 123 ? p.host : `${p.host.includes(':') ? `[${p.host}]` : p.host}:${p.port}`;
    if (!out.includes(key)) out.push(key);
  }
  if (out.length > MAX_SERVERS) throw Object.assign(new Error(`Informe no máximo ${MAX_SERVERS} servidores NTP.`), { status: 400 });
  return out;
}

const readTs = (buf, at) => (buf.readUInt32BE(at) - NTP_EPOCH) * 1000 + (buf.readUInt32BE(at + 4) * 1000) / 2 ** 32;
function writeTs(buf, at, ms) {
  const s = Math.floor(ms / 1000);
  buf.writeUInt32BE((s + NTP_EPOCH) >>> 0, at);
  buf.writeUInt32BE(Math.floor(((ms - s * 1000) / 1000) * 2 ** 32) >>> 0, at + 4);
}

/** Uma consulta SNTP. Resolve { server, offsetMs, delayMs, stratum } ou rejeita (tempo esgotado, resposta inválida). */
export function sntpQuery(server, { timeoutMs = 3000, now = Date.now } = {}) {
  const p = parseServer(server);
  if (!p) return Promise.reject(new Error(`servidor inválido: ${server}`));
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket(net.isIPv6(p.host) ? 'udp6' : 'udp4');
    const req = Buffer.alloc(48);
    req[0] = 0x23; // LI 0, versão 4, modo 3 (cliente)
    let t1 = null;
    let done = false;
    const end = (err, val) => { if (done) return; done = true; clearTimeout(timer); try { sock.close(); } catch { /* já fechado */ } if (err) reject(err); else resolve(val); };
    const timer = setTimeout(() => end(new Error('sem resposta (tempo esgotado)')), timeoutMs);
    const netErr = (e) => end(new Error(e.code === 'ENOTFOUND' ? 'nome não encontrado (DNS)' : e.message));
    sock.on('error', netErr);
    sock.on('message', (msg) => {
      const t4 = now();
      if (t1 === null) return; // nada perguntado ainda
      if (msg.length < 48) return end(new Error('resposta curta'));
      const li = msg[0] >> 6; const mode = msg[0] & 7; const stratum = msg[1];
      if (mode !== 4) return end(new Error('resposta não é de servidor NTP'));
      if (stratum === 0) return end(new Error(`servidor recusou (${msg.toString('ascii', 12, 16).replace(/\0/g, '')})`)); // kiss-o'-death
      if (li === 3 || stratum > 15) return end(new Error('servidor sem sincronismo'));
      if (!msg.subarray(24, 32).equals(req.subarray(40, 48))) return end(new Error('resposta não corresponde à pergunta'));
      const t2 = readTs(msg, 32); const t3 = readTs(msg, 40);
      end(null, { server, offsetMs: ((t2 - t1) + (t3 - t4)) / 2, delayMs: Math.max(0, (t4 - t1) - (t3 - t2)), stratum });
    });
    // t1 no instante em que a pergunta sai: com o socket já conectado, o send() envia na hora. Antes o t1 era marcado e a
    // pergunta só saía depois do bind e da resolução do endereço (process.nextTick): na subida do servidor, com o laço de
    // eventos ocupado ~0,5 s pela inicialização, ela saía esse tanto depois do t1 e a diferença medida vinha ~0,25 s acima
    // (16/10: 3236 ms para um servidor 3000 ms à frente; test/ntp.test.js)
    sock.connect(p.port, p.host, (e) => {
      if (e) { netErr(e); return; }
      if (done) return;
      t1 = now();
      writeTs(req, 40, t1); // o servidor devolve isto no campo "originate": confere que a resposta é desta pergunta
      sock.send(req, (err) => { if (err) netErr(err); });
    });
  });
}

/**
 * Relógio corrigido. `base` é o relógio do sistema e `query` a consulta (injetáveis nos testes).
 * now() = base() + diferença aplicada; a diferença aplicada caminha até a medida a SLEW_MS_PER_S.
 */
export function createClock({ query = sntpQuery, base = Date.now, log = console } = {}) {
  let slew = { from: 0, to: 0, at: 0 };
  let cfg = { enabled: false, servers: [...NIC_BR], intervalMs: 15 * 60_000 };
  let last = null; // última medida aceita
  let lastAttemptAt = null; let lastError = null; let errors = []; let good = 0; // sincronizações boas desde configure()
  let timer = null; let running = null;

  const offset = () => {
    const d = slew.to - slew.from;
    const max = (SLEW_MS_PER_S * Math.max(0, base() - slew.at)) / 1000;
    return Math.abs(d) <= max ? slew.to : slew.from + Math.sign(d) * max;
  };
  const setOffset = (target) => {
    const cur = offset();
    slew = { from: Math.abs(target - cur) > STEP_MS ? target : cur, to: target, at: base() };
    if (Math.abs(target - cur) > STEP_MS) log.warn?.(`[ntp] relógio do sistema ${Math.round(target)} ms fora: corrigido de uma vez.`);
  };

  async function sync() {
    if (running) return running;
    running = (async () => {
      lastAttemptAt = base();
      const settled = await Promise.allSettled(cfg.servers.map((s) => query(s)));
      errors = settled.map((r, i) => (r.status === 'rejected' ? { server: cfg.servers[i], error: r.reason?.message || String(r.reason) } : null)).filter(Boolean);
      const ok = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      if (!ok.length) {
        lastError = cfg.servers.length ? `Nenhum servidor NTP respondeu (${errors.map((e) => `${e.server}: ${e.error}`).join('; ')}).` : 'Nenhum servidor NTP configurado.';
        return false;
      }
      // a amostra de menor atraso de rede é a mais confiável (o erro máximo do offset é metade do atraso)
      const best = ok.reduce((a, b) => (b.delayMs < a.delayMs ? b : a));
      last = { ...best, at: base(), responses: ok.length };
      lastError = null; good++;
      setOffset(best.offsetMs);
      return true;
    })().finally(() => { running = null; schedule(); });
    return running;
  }

  function schedule() {
    clearTimeout(timer);
    if (!cfg.enabled) return;
    // falhou, ou ainda nas 3 primeiras (a da subida do servidor costuma pegar atraso alto): de novo em 1 min; depois, no intervalo
    timer = setTimeout(() => { sync().catch(() => {}); }, lastError || good < 3 ? 60_000 : cfg.intervalMs);
    timer.unref?.();
  }

  return {
    now: () => Math.round(base() + offset()), // inteiro, como o Date.now()
    offset,
    sync,
    /** Liga/desliga e troca os servidores; sincroniza na hora quando ligado. */
    configure({ enabled = cfg.enabled, servers = cfg.servers, intervalMin } = {}) {
      cfg = { enabled: Boolean(enabled), servers: normalizeServers(servers), intervalMs: intervalMin ? Math.round(intervalMin * 60_000) : cfg.intervalMs };
      clearTimeout(timer); good = 0;
      if (cfg.enabled) sync().catch(() => {});
      else { last = null; lastError = null; errors = []; setOffset(0); }
    },
    stop() { clearTimeout(timer); cfg = { ...cfg, enabled: false }; },
    /** Consulta cada servidor sem aplicar nada (botão "Testar" do superadmin). */
    async probe(servers = cfg.servers) {
      const list = normalizeServers(servers);
      const res = await Promise.allSettled(list.map((s) => query(s)));
      const r1 = (x) => Math.round(x * 10) / 10;
      return list.map((server, i) => (res[i].status === 'fulfilled'
        ? { server, ok: true, offsetMs: r1(res[i].value.offsetMs), delayMs: r1(res[i].value.delayMs), stratum: res[i].value.stratum }
        : { server, ok: false, error: res[i].reason?.message || String(res[i].reason) }));
    },
    status() {
      const at = base();
      return {
        enabled: cfg.enabled, servers: [...cfg.servers], intervalMin: Math.round(cfg.intervalMs / 60_000),
        synced: Boolean(last), stale: Boolean(last) && at - last.at > 3 * cfg.intervalMs,
        offsetMs: Math.round(offset() * 10) / 10, measuredOffsetMs: last ? Math.round(last.offsetMs * 10) / 10 : null,
        delayMs: last ? Math.round(last.delayMs * 10) / 10 : null, stratum: last?.stratum ?? null, server: last?.server ?? null,
        responses: last?.responses ?? 0, lastSyncAt: last?.at ?? null, lastAttemptAt, error: lastError, errors,
        now: Math.round(at + offset()),
      };
    },
  };
}

/**
 * O FFmpeg escreve o PROGRAM-DATE-TIME do HLS com o relógio do sistema; aqui ele passa para a hora corrigida (a mesma dos
 * horários de SCTE-35 e do EPG). Sem diferença medida, o texto sai como veio.
 */
export function shiftProgramDateTime(text, offsetMs) {
  if (!(Math.abs(offsetMs) >= 1)) return text;
  return text.replace(/^#EXT-X-PROGRAM-DATE-TIME:(.+)$/gm, (line, v) => {
    const t = Date.parse(v.trim());
    return Number.isFinite(t) ? `#EXT-X-PROGRAM-DATE-TIME:${new Date(Math.round(t + offsetMs)).toISOString()}` : line;
  });
}

/** Relógio único do servidor. Sem configure() (testes, NTP desligado) é o próprio relógio do sistema. */
export const clock = createClock();
