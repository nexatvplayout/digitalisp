/* NEXA Telas · comunicação interna de UPA e hospital (docs/TELAS.md §25; contrato telas-contrato.md §17).

   Telas internas: o Painel da Prefeitura ou o gestor da repartição marca uma TV box como interna (posto de enfermagem,
   repouso, copa, vestiário) e escolhe o setor dela. Só a tela interna de uma repartição com o módulo "interna" ligado recebe
   o conteúdo interno: `internal` no /config (os avisos da direção, a escala, treinamentos, protocolos, aniversariantes) e
   `codes` no sinal de vida e no tempo real (os códigos de emergência hospitalar). A tela pública não recebe NADA disso:
   nem a chave `internal`, nem `codes`, nem a conexão de tempo real dos códigos.

   Avisos com "Li": cada setor tem um endereço para o celular (/interno/<token>, sem app e sem login): o funcionário escreve
   o nome ou a matrícula uma vez (fica no aparelho), lê os avisos do setor e toca em Li. O painel mostra quem leu, quando, e
   quem falta (pela lista de funcionários do setor, se houver). O endereço de disparo (outro token) também dispara e encerra
   códigos. Os dois só em SHA-256 no banco; gerar outro derruba o anterior; desligar apaga.

   Códigos de emergência: Azul, Vermelho, Rosa, Laranja, Cinza, Amarelo (lista editável por repartição). Disparo pelo painel
   (qualquer papel) ou pelo endereço de disparo, com o local ("Observação, leito 4"). Vão às telas internas e aos celulares
   com a página do setor aberta, até alguém encerrar ou o tempo da repartição acabar. Tudo no log (quem disparou, quem
   encerrou, quando). Nada de dado de paciente em campo nenhum.

   Rotas:
     TV box (token do aparelho)  GET /api/telas/internal/stream    text/event-stream: "codes" ao ligar e a cada mudança, ": ping" 20 s
     Celular (token do setor)     GET /interno/<token>, POST /api/interno/state, POST /api/interno/notices/:id/read,
                                  GET /api/interno/stream (SSE lido por fetch: o token vai no cabeçalho, nunca no endereço),
                                  POST /api/interno/codes, POST /api/interno/codes/:id/close (só o endereço de disparo)
     Repartição (sessão do link)  GET/POST /api/reparticao/codes, POST /api/reparticao/codes/:id/close (qualquer papel);
                                  /api/reparticao/interna* (o gestor: setores, endereços, avisos, quem leu, códigos, telas)
     Painel da Prefeitura         PATCH /api/prefeitura/devices/:id/internal { internal, sectorId } */
import path from 'node:path';
import { db } from './db.js';
import { config } from './config.js';
import * as C from './telas-core.js';
import { createLimiter, ipKey } from './ratelimit.js';
import { officeModules } from '../public/shared/telas-tipos.js';
import {
  INT_LIMITS, INT_KINDS, intKindLabel, DEFAULT_CODES, DEFAULT_CODE_MIN, cleanCodes, cleanCodeMinutes, cleanReader, readerKey, cleanStaff, cleanSectorName,
  cleanNotice, noticeHits, codeDto, codeActive,
} from './telas-interna-core.js';

const { fail, line, idOf, sha256 } = C;
const j = C.parseJson;
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const num = (v) => (v == null ? null : Number(v));
const PAGE = path.join(config.root, 'public', 'reparticao');
const PING_MS = 20_000;
export const INT_KEEP_DAYS = 90;

/** A repartição liga a comunicação interna (módulo "interna"). */
export const internaOn = (o) => Boolean(o && officeModules(o.type ?? o.o_type, j(o.modules ?? o.o_modules, {})).interna);

export function createInterna({ available, audit = async () => {}, ipOf = (req) => req.ip, publicUrl = () => '', forget = () => {}, now = () => Date.now(), timers = true, pingMs = PING_MS }) {
  const noStore = (res) => res.set('Cache-Control', 'no-store');

  /* ---------------------------------------------------------------- o catálogo de códigos da repartição (telas_office_extras.data) */
  async function codeSettings(tenantId, officeId) {
    const d = j((await db.get('SELECT data FROM telas_office_extras WHERE office_id = ? AND tenant_id = ?', [officeId, tenantId]))?.data, {});
    let codes = DEFAULT_CODES.map((c) => ({ ...c }));
    try { if (Array.isArray(d.intCodes) && d.intCodes.length) codes = cleanCodes(d.intCodes); } catch { /* guardado fora do formato: os de fábrica */ }
    const minutes = Number.isInteger(d.intCodeMin) && d.intCodeMin >= 0 && d.intCodeMin <= INT_LIMITS.minutesMax ? d.intCodeMin : DEFAULT_CODE_MIN;
    return { codes, minutes };
  }
  async function saveCodeSettings(tenantId, officeId, { codes, minutes }) {
    const cur = await db.get('SELECT data FROM telas_office_extras WHERE office_id = ? AND tenant_id = ?', [officeId, tenantId]);
    const data = j(cur?.data, {}); data.intCodes = codes; data.intCodeMin = minutes;
    if (cur) await db.run('UPDATE telas_office_extras SET data = ?, updated_at = ? WHERE office_id = ? AND tenant_id = ?', [JSON.stringify(data), now(), officeId, tenantId]);
    else await db.run('INSERT INTO telas_office_extras(office_id,tenant_id,data,updated_at) VALUES(?,?,?,?)', [officeId, tenantId, JSON.stringify(data), now()]);
  }

  /* ---------------------------------------------------------------- tempo real: as telas internas e os celulares de cada repartição */
  const conns = new Map(); // "cliente:repartição" -> Set { res, deviceId?, sectorId? }
  const keyOf = (tenantId, officeId) => `${Number(tenantId)}:${Number(officeId)}`;
  const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  function drop(k, c) {
    const set = conns.get(k);
    if (set) { set.delete(c); if (!set.size) conns.delete(k); }
    try { c.res.end(); } catch { /* já fechada */ }
  }
  const write = (k, c, s) => { try { c.res.write(s); } catch { drop(k, c); } };
  function open(req, res, tenantId, officeId, extra) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.(); req.socket?.setNoDelay?.(true);
    const k = keyOf(tenantId, officeId);
    const c = { res, ...extra };
    if (c.deviceId) { // no máximo 2 por tela: a mais antiga cai
      const mine = [...(conns.get(k) || [])].filter((x) => x.deviceId === c.deviceId);
      while (mine.length >= 2) drop(k, mine.shift());
    }
    if (!conns.has(k)) conns.set(k, new Set());
    conns.get(k).add(c);
    const gone = () => drop(k, c);
    req.on('close', gone); res.on('error', gone);
    write(k, c, ': ok\n\n');
    return c;
  }
  async function activeCodes(tenantId, officeId) {
    const t = now();
    return (await db.all('SELECT * FROM telas_int_codes WHERE tenant_id = ? AND office_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 20', [tenantId, officeId])).filter((c) => codeActive(c, t)).map(codeDto);
  }
  async function publish(tenantId, officeId) {
    const k = keyOf(tenantId, officeId);
    if (!conns.has(k)) return;
    const s = frame('codes', { codes: await activeCodes(tenantId, officeId) });
    for (const c of [...(conns.get(k) || [])]) write(k, c, s);
  }
  /** A tela deixou de ser interna (ou foi revogada, ou mudou de repartição): a conexão dos códigos cai. */
  function kick(deviceId) { for (const [k, set] of [...conns]) for (const c of [...set]) if (c.deviceId === Number(deviceId)) drop(k, c); }
  /** Setor apagado ou endereço trocado: os celulares dele caem (a página relê e mostra que o endereço mudou). */
  function kickSector(sectorId) { for (const [k, set] of [...conns]) for (const c of [...set]) if (c.sectorId === Number(sectorId)) drop(k, c); }
  // o ": ping" e o fim pelo tempo: o código vencido sai das telas na volta seguinte (até 20 s; o app também confere o until)
  async function tick() {
    for (const [k, set] of conns) for (const c of [...set]) write(k, c, ': ping\n\n');
    const t = now();
    const due = await db.all('SELECT id, tenant_id, office_id FROM telas_int_codes WHERE closed_at IS NULL AND until_at IS NOT NULL AND until_at <= ?', [t]);
    for (const c of due) {
      const r = await db.run("UPDATE telas_int_codes SET closed_at = until_at, closed_by = '(tempo esgotado)' WHERE id = ? AND closed_at IS NULL", [c.id]);
      if (r.changes) await publish(Number(c.tenant_id), Number(c.office_id));
    }
  }
  const timer = timers ? setInterval(() => { tick().catch((err) => console.warn('[telas] interna:', err.message)); }, pingMs) : null;
  timer?.unref?.();

  /* ---------------------------------------------------------------- o que a TV box interna recebe */
  const isInternal = (dev) => Number(dev.internal) === 1 && internaOn(dev);
  /** contractConfig.internal: null na tela pública (a chave nem vai). */
  async function internalFor(dev) {
    if (!isInternal(dev)) return null;
    const tenantId = Number(dev.tenant_id); const t = now();
    const sector = dev.sector_id ? await db.get('SELECT id, name FROM telas_int_sectors WHERE id = ? AND tenant_id = ? AND office_id = ?', [dev.sector_id, tenantId, dev.office_id]) : null;
    const rows = await db.all('SELECT * FROM telas_int_notices WHERE tenant_id = ? AND office_id = ? AND cancelled_at IS NULL AND starts_at <= ? AND until_at > ? ORDER BY id DESC LIMIT 200', [tenantId, dev.office_id, t, t]);
    const notices = rows.filter((n) => noticeHits(j(n.sectors, []), sector ? Number(sector.id) : null)).slice(0, INT_LIMITS.sent)
      .map((n) => ({ id: Number(n.id), kind: n.kind, header: intKindLabel(n.kind).toUpperCase(), title: n.title, text: n.body || '', seconds: Number(n.seconds) || 15, until: Number(n.until_at) }));
    return { sector: sector?.name ?? null, notices };
  }
  /** O sinal de vida: os códigos em vigor (só a tela interna; a pública recebe undefined e a chave não vai). */
  const codesFor = async (dev) => (isInternal(dev) ? activeCodes(Number(dev.tenant_id), Number(dev.office_id)) : undefined);

  function mountDevice(app, { device }) {
    app.get('/api/telas/internal/stream', device, ah(async (req, res) => {
      const dev = req.dev;
      // tela pública: a conexão abre e só recebe o ping (o app não insiste num erro); nada de código vai a ela
      const c = open(req, res, Number(dev.tenant_id), isInternal(dev) ? Number(dev.office_id) : -Number(dev.id), { deviceId: Number(dev.id) });
      if (isInternal(dev)) write(keyOf(dev.tenant_id, dev.office_id), c, frame('codes', { codes: await activeCodes(Number(dev.tenant_id), Number(dev.office_id)) }));
    }));
  }

  /* ---------------------------------------------------------------- disparar e encerrar (o painel, o endereço de disparo) */
  const firePerOffice = createLimiter({ windowMs: 60_000, max: Number(process.env.TELAS_CODES_PER_MIN) || 10, maxKeys: 50_000 });
  async function fire(o, b, { by, via }) {
    const tenantId = Number(o.tenant_id);
    const { codes, minutes } = await codeSettings(tenantId, o.id);
    const def = codes.find((c) => c.key === String(b?.code || ''));
    if (!def) throw fail(400, 'Escolha um código da lista.');
    const place = line(b?.place, INT_LIMITS.place);
    if (!firePerOffice.hit(String(o.id))) throw fail(429, 'Muitos códigos em pouco tempo. Aguarde um instante.');
    const t = now();
    const id = await db.insert('INSERT INTO telas_int_codes(tenant_id,office_id,code,label,color,meaning,place,fired_by,fired_via,fired_at,until_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [tenantId, o.id, def.key, def.label, def.color, def.meaning, place, line(by, 120), via, t, minutes ? t + minutes * 60_000 : null]);
    await publish(tenantId, o.id);
    const row = await db.get('SELECT * FROM telas_int_codes WHERE id = ?', [id]);
    // DIGITAL ISP: quantas TVs recebem (só as internas da repartição, com o módulo ligado): zero = quem disparou fica sabendo
    const reach = internaOn(o) ? Number((await db.get('SELECT COUNT(*) AS n FROM telas_devices WHERE tenant_id = ? AND office_id = ? AND internal = 1 AND revoked_at IS NULL', [tenantId, o.id]))?.n || 0) : 0;
    return { code: { ...codeDto(row), reach }, log: `prefeitura: ${def.label.toUpperCase()} disparado em "${o.name}"${place ? ` (${place})` : ''} (#${id}, ${via})` };
  }
  async function close(o, id, { by }) {
    const tenantId = Number(o.tenant_id); const cid = idOf(id, 'Código');
    const cur = await db.get('SELECT * FROM telas_int_codes WHERE id = ? AND tenant_id = ? AND office_id = ?', [cid, tenantId, o.id]);
    if (!cur) throw fail(404, 'Código não encontrado.');
    if (!codeActive(cur, now())) throw fail(409, 'Este código já foi encerrado.');
    await db.run('UPDATE telas_int_codes SET closed_at = ?, closed_by = ? WHERE id = ? AND closed_at IS NULL', [now(), line(by, 120), cid]);
    await publish(tenantId, o.id);
    return { log: `prefeitura: ${cur.label.toUpperCase()} encerrado em "${o.name}" (#${cid})` };
  }
  async function codeLog(tenantId, officeId) {
    const t = now();
    const rows = await db.all('SELECT * FROM telas_int_codes WHERE tenant_id = ? AND office_id = ? ORDER BY id DESC LIMIT 60', [tenantId, officeId]);
    return rows.map((c) => ({ ...codeDto(c), active: codeActive(c, t), firedBy: c.fired_by || '', via: c.fired_via || 'painel', closedAt: num(c.closed_at) ?? (c.until_at != null && Number(c.until_at) <= t ? Number(c.until_at) : null), closedBy: c.closed_by || (c.until_at != null && Number(c.until_at) <= t ? '(tempo esgotado)' : null) }));
  }

  /* ---------------------------------------------------------------- o celular do funcionário (/interno/<token>) */
  function mountStaff(app, { headers }) {
    const page = (file, type) => (_req, res) => { res.set({ ...headers, 'Content-Type': type }).sendFile(path.join(PAGE, file)); };
    app.get('/interno/interno.js', page('interno.js', 'text/javascript; charset=utf-8'));
    app.get('/interno/interno.css', page('interno.css', 'text/css; charset=utf-8'));
    app.get('/interno/:token([A-Za-z0-9_-]{32,64})', page('interno.html', 'text/html; charset=utf-8'));
    const perIp = createLimiter({ windowMs: 60_000, max: Number(process.env.TELAS_INTERNO_PER_IP_MIN) || 120, maxKeys: 100_000 });
    const perSector = createLimiter({ windowMs: 60_000, max: Number(process.env.TELAS_INTERNO_PER_SECTOR_MIN) || 600, maxKeys: 50_000 });
    const GONE = 'Endereço desligado. Peça o endereço novo do setor à direção.';
    /** Token do setor -> o setor, a repartição e se pode disparar. O mesmo 401 para tudo o que não vale. */
    const staff = ah(async (req, res, next) => {
      noStore(res);
      if (!perIp.hit(ipKey(ipOf(req) || '-'))) return res.status(429).json({ error: 'Muitos pedidos em pouco tempo. Aguarde um minuto.' });
      const tok = /^Bearer ([A-Za-z0-9_-]{32,64})$/.exec(req.get('authorization') || '')?.[1];
      const h = tok ? sha256(tok) : null;
      const s = h ? await db.get('SELECT * FROM telas_int_sectors WHERE read_hash = ? OR fire_hash = ?', [h, h]) : null;
      const o = s ? await db.get('SELECT * FROM telas_offices WHERE id = ? AND tenant_id = ?', [s.office_id, s.tenant_id]) : null;
      if (!o || !internaOn(o) || !(await available(Number(o.tenant_id)))) return res.status(401).json({ error: GONE });
      if (!perSector.hit(String(s.id))) return res.status(429).json({ error: 'Muitos pedidos neste setor. Aguarde um minuto.' });
      req.sector = s; req.office = o; req.tenantId = Number(o.tenant_id); req.canFire = s.fire_hash === h;
      next();
    });
    const log = (req, action, detail, status = 200) => audit({ username: `repartição: ${o_name(req)} (celular, ${line(req.sector.name, 30)})`.slice(0, 64), action, detail, status, ip: ipOf(req), tenantId: req.tenantId });
    const o_name = (req) => line(req.office.name, 40);
    app.post('/api/interno/state', staff, ah(async (req, res) => {
      const s = req.sector; const o = req.office; const t = now();
      const reader = typeof req.body?.reader === 'string' && req.body.reader.trim() ? cleanReader(req.body.reader) : null;
      const rows = await db.all('SELECT * FROM telas_int_notices WHERE tenant_id = ? AND office_id = ? AND cancelled_at IS NULL AND starts_at <= ? AND until_at > ? ORDER BY id DESC LIMIT 200', [req.tenantId, o.id, t, t]);
      const mine = rows.filter((n) => noticeHits(j(n.sectors, []), Number(s.id))).slice(0, 50);
      const reads = reader && mine.length ? await db.all(`SELECT notice_id, read_at FROM telas_int_reads WHERE tenant_id = ? AND reader_key = ? AND notice_id IN (${mine.map(() => '?').join(',')})`, [req.tenantId, readerKey(reader), ...mine.map((n) => n.id)]) : [];
      const readAt = new Map(reads.map((r) => [Number(r.notice_id), Number(r.read_at)]));
      const staffList = j(s.staff, []);
      res.json({
        serverTime: t, office: o.name, sector: s.name, canFire: req.canFire,
        staffList: staffList.length > 0, known: reader ? (!staffList.length || staffList.some((x) => readerKey(x) === readerKey(reader))) : null,
        notices: mine.map((n) => ({ id: Number(n.id), kind: n.kind, kindLabel: intKindLabel(n.kind), title: n.title, text: n.body || '', until: Number(n.until_at), createdAt: Number(n.created_at), readAt: readAt.get(Number(n.id)) ?? null })),
        codes: await activeCodes(req.tenantId, o.id),
        catalog: req.canFire ? (await codeSettings(req.tenantId, o.id)).codes : [],
      });
    }));
    app.post('/api/interno/notices/:id/read', staff, ah(async (req, res) => {
      const reader = cleanReader(req.body?.reader); const t = now();
      const n = await db.get('SELECT * FROM telas_int_notices WHERE id = ? AND tenant_id = ? AND office_id = ?', [idOf(req.params.id, 'Aviso'), req.tenantId, req.office.id]);
      if (!n || n.cancelled_at || Number(n.until_at) <= t || Number(n.starts_at) > t || !noticeHits(j(n.sectors, []), Number(req.sector.id))) throw fail(404, 'Aviso não encontrado (encerrado ou de outro setor).');
      await db.run('INSERT INTO telas_int_reads(notice_id,tenant_id,reader_key,reader,sector_id,read_at) VALUES(?,?,?,?,?,?) ON CONFLICT (notice_id, reader_key) DO NOTHING', [n.id, req.tenantId, readerKey(reader), reader, req.sector.id, t]);
      const r = await db.get('SELECT read_at FROM telas_int_reads WHERE notice_id = ? AND reader_key = ?', [n.id, readerKey(reader)]);
      res.json({ ok: true, readAt: Number(r.read_at) });
    }));
    app.get('/api/interno/stream', staff, ah(async (req, res) => {
      const c = open(req, res, req.tenantId, req.office.id, { sectorId: Number(req.sector.id) });
      write(keyOf(req.tenantId, req.office.id), c, frame('codes', { codes: await activeCodes(req.tenantId, req.office.id) }));
    }));
    const firer = (req, res, next) => (req.canFire ? next() : res.status(403).json({ error: 'Este endereço só lê os avisos. Para disparar um código, use o endereço de disparo do setor.' }));
    app.post('/api/interno/codes', staff, firer, ah(async (req, res) => {
      const reader = typeof req.body?.reader === 'string' && req.body.reader.trim() ? cleanReader(req.body.reader) : '';
      const out = await fire(req.office, req.body, { by: `${req.sector.name}${reader ? ` · ${reader}` : ''} (celular)`, via: 'celular' });
      await log(req, 'POST /api/interno/codes', out.log, 201);
      res.status(201).json(out.code);
    }));
    app.post('/api/interno/codes/:id/close', staff, firer, ah(async (req, res) => {
      const reader = typeof req.body?.reader === 'string' && req.body.reader.trim() ? cleanReader(req.body.reader) : '';
      const out = await close(req.office, req.params.id, { by: `${req.sector.name}${reader ? ` · ${reader}` : ''} (celular)` });
      await log(req, 'POST /api/interno/codes/close', out.log);
      res.json({ ok: true });
    }));
  }

  /* ---------------------------------------------------------------- o painel da repartição */
  const sectorDto = (s) => ({ id: Number(s.id), name: s.name, staff: j(s.staff, []), read: { on: Boolean(s.read_hash), at: num(s.read_at) }, fire: { on: Boolean(s.fire_hash), at: num(s.fire_at) } });
  async function overview(tenantId, o) {
    const t = now();
    const [sectors, notices, devices, settings] = await Promise.all([
      db.all('SELECT * FROM telas_int_sectors WHERE tenant_id = ? AND office_id = ? ORDER BY name, id', [tenantId, o.id]),
      db.all('SELECT * FROM telas_int_notices WHERE tenant_id = ? AND office_id = ? AND (cancelled_at IS NULL OR created_at > ?) AND until_at > ? ORDER BY id DESC LIMIT 100', [tenantId, o.id, t - 7 * 86400_000, t - 7 * 86400_000]),
      db.all('SELECT id, name, internal, sector_id, last_seen FROM telas_devices WHERE tenant_id = ? AND office_id = ? AND revoked_at IS NULL ORDER BY name, id', [tenantId, o.id]),
      codeSettings(tenantId, o.id),
    ]);
    const reads = notices.length ? await db.all(`SELECT notice_id, reader, reader_key, sector_id, read_at FROM telas_int_reads WHERE tenant_id = ? AND notice_id IN (${notices.map(() => '?').join(',')}) ORDER BY read_at`, [tenantId, ...notices.map((n) => n.id)]) : [];
    const sname = new Map(sectors.map((s) => [Number(s.id), s.name]));
    return {
      serverTime: t, kinds: INT_KINDS, catalog: settings.codes, minutes: settings.minutes, sectors: sectors.map(sectorDto),
      devices: devices.map((d) => ({ id: Number(d.id), name: d.name, internal: Number(d.internal) === 1, sectorId: num(d.sector_id), lastSeen: num(d.last_seen) })),
      notices: notices.map((n) => {
        const targets = j(n.sectors, []);
        const mine = reads.filter((r) => Number(r.notice_id) === Number(n.id));
        // quem falta: a lista de funcionários dos setores do aviso (todos os setores, se o aviso é para todos)
        const pool = sectors.filter((s) => !targets.length || targets.includes(Number(s.id))).flatMap((s) => j(s.staff, []).map((name) => ({ name, sector: s.name })));
        const keys = new Set(mine.map((r) => r.reader_key));
        const missing = pool.filter((p, i) => !keys.has(readerKey(p.name)) && pool.findIndex((q) => readerKey(q.name) === readerKey(p.name)) === i);
        return {
          id: Number(n.id), kind: n.kind, kindLabel: intKindLabel(n.kind), title: n.title, text: n.body || '', sectors: targets, sectorNames: targets.map((id) => sname.get(id) || `setor #${id}`),
          seconds: Number(n.seconds), startsAt: Number(n.starts_at), until: Number(n.until_at), createdBy: n.created_by || '', createdAt: Number(n.created_at),
          cancelledAt: num(n.cancelled_at), status: n.cancelled_at ? 'encerrado' : Number(n.until_at) <= t ? 'vencido' : Number(n.starts_at) > t ? 'agendado' : 'em vigor',
          reads: mine.map((r) => ({ reader: r.reader, sector: sname.get(Number(r.sector_id)) || '', at: Number(r.read_at) })),
          expected: pool.length ? new Set(pool.map((p) => readerKey(p.name))).size : null, missing: missing.map((m) => m.name).slice(0, 300),
        };
      }),
    };
  }
  const sectorOf = async (tenantId, officeId, id) => {
    const s = await db.get('SELECT * FROM telas_int_sectors WHERE id = ? AND tenant_id = ? AND office_id = ?', [idOf(id, 'Setor'), tenantId, officeId]);
    if (!s) throw fail(404, 'Setor não encontrado.');
    return s;
  };
  async function sectorIdsOk(tenantId, officeId, ids) {
    if (!ids.length) return;
    const rows = await db.all(`SELECT id FROM telas_int_sectors WHERE tenant_id = ? AND office_id = ? AND id IN (${ids.map(() => '?').join(',')})`, [tenantId, officeId, ...ids]);
    if (rows.length !== ids.length) throw fail(400, 'Setor inexistente.');
  }
  /** Marca a tela como interna (ou pública) e o setor dela. A mesma regra no painel da repartição e no da prefeitura. */
  async function setDeviceInternal(tenantId, dev, b) {
    const internal = b?.internal === true;
    let sectorId = b?.sectorId == null || b.sectorId === '' ? null : idOf(b.sectorId, 'Setor');
    if (!internal) sectorId = null;
    if (sectorId) await sectorOf(tenantId, dev.office_id, sectorId);
    await db.run('UPDATE telas_devices SET internal = ?, sector_id = ? WHERE id = ? AND tenant_id = ?', [internal ? 1 : 0, sectorId, dev.id, tenantId]);
    kick(dev.id); // a conexão dos códigos recomeça do jeito novo (a pública não recebe nada)
    forget(tenantId);
    return { id: Number(dev.id), internal, sectorId };
  }

  function mountOffice(app, { office, gestorOnly, note }) {
    const on = (req, res, next) => (internaOn(req.office) ? next() : res.status(403).json({ error: 'A comunicação interna está desligada nesta repartição (a prefeitura liga em Repartições → Editar → Módulos).' }));
    const any = [office, on];
    const gestor = [office, gestorOnly, on];
    const P = '/api/reparticao/interna';
    // os códigos: qualquer papel vê, dispara e encerra (o atendente da recepção também precisa)
    app.get('/api/reparticao/codes', any, ah(async (req, res) => {
      const s = await codeSettings(req.tenantId, req.office.id);
      res.json({ serverTime: now(), catalog: s.codes, minutes: s.minutes, active: await activeCodes(req.tenantId, req.office.id), log: await codeLog(req.tenantId, req.office.id) });
    }));
    app.post('/api/reparticao/codes', any, ah(async (req, res) => {
      const out = await fire(req.office, req.body, { by: req.by, via: 'painel' });
      await note(req, 'POST /api/reparticao/codes', out.log, 201);
      res.status(201).json(out.code);
    }));
    app.post('/api/reparticao/codes/:id/close', any, ah(async (req, res) => {
      const out = await close(req.office, req.params.id, { by: req.by });
      await note(req, 'POST /api/reparticao/codes/close', out.log);
      res.json({ ok: true });
    }));
    // o gestor: setores, endereços, avisos, quem leu, a lista de códigos e as telas internas
    app.get(P, gestor, ah(async (req, res) => res.json(await overview(req.tenantId, req.office))));
    app.post(`${P}/sectors`, gestor, ah(async (req, res) => {
      const name = cleanSectorName(req.body?.name); const staffList = cleanStaff(req.body?.staff);
      if (Number((await db.get('SELECT COUNT(*) AS n FROM telas_int_sectors WHERE tenant_id = ? AND office_id = ?', [req.tenantId, req.office.id])).n) >= INT_LIMITS.sectors) throw fail(409, `No máximo ${INT_LIMITS.sectors} setores.`);
      const id = await db.insert('INSERT INTO telas_int_sectors(tenant_id,office_id,name,staff,created_at) VALUES(?,?,?,?,?)', [req.tenantId, req.office.id, name, JSON.stringify(staffList), now()]);
      await note(req, 'POST /api/reparticao/interna/sectors', `prefeitura: setor interno "${name}" criado (${staffList.length} funcionário(s) na lista)`, 201);
      res.status(201).json(sectorDto(await sectorOf(req.tenantId, req.office.id, id)));
    }));
    app.patch(`${P}/sectors/:id`, gestor, ah(async (req, res) => {
      const s = await sectorOf(req.tenantId, req.office.id, req.params.id);
      const name = req.body?.name === undefined ? s.name : cleanSectorName(req.body.name);
      const staffList = req.body?.staff === undefined ? j(s.staff, []) : cleanStaff(req.body.staff);
      await db.run('UPDATE telas_int_sectors SET name = ?, staff = ?, updated_at = ? WHERE id = ?', [name, JSON.stringify(staffList), now(), s.id]);
      forget(req.tenantId);
      await note(req, 'PATCH /api/reparticao/interna/sectors', `prefeitura: setor interno "${name}" alterado (${staffList.length} funcionário(s) na lista)`);
      res.json(sectorDto(await sectorOf(req.tenantId, req.office.id, s.id)));
    }));
    app.delete(`${P}/sectors/:id`, gestor, ah(async (req, res) => {
      const s = await sectorOf(req.tenantId, req.office.id, req.params.id);
      await db.tx(async (x) => {
        await x.run('UPDATE telas_devices SET sector_id = NULL WHERE tenant_id = ? AND office_id = ? AND sector_id = ?', [req.tenantId, req.office.id, s.id]);
        await x.run('DELETE FROM telas_int_sectors WHERE id = ?', [s.id]);
      });
      kickSector(s.id); forget(req.tenantId);
      await note(req, 'DELETE /api/reparticao/interna/sectors', `prefeitura: setor interno "${s.name}" apagado`);
      res.json({ ok: true });
    }));
    // o endereço do celular: "read" (ler e marcar Li) ou "fire" (também disparar códigos). Aparece UMA vez.
    app.post(`${P}/sectors/:id/link/:kind(read|fire)`, gestor, ah(async (req, res) => {
      const s = await sectorOf(req.tenantId, req.office.id, req.params.id);
      const token = C.newToken(); const col = req.params.kind === 'fire' ? 'fire' : 'read';
      await db.run(`UPDATE telas_int_sectors SET ${col}_hash = ?, ${col}_at = ? WHERE id = ?`, [sha256(token), now(), s.id]);
      kickSector(s.id);
      await note(req, 'POST /api/reparticao/interna/sectors/link', `prefeitura: endereço ${col === 'fire' ? 'de disparo de códigos' : 'de leitura dos avisos'} do setor "${s.name}" gerado (o anterior deixou de valer)`, 201);
      res.status(201).json({ url: `${publicUrl(req)}/interno/${token}`, kind: col });
    }));
    app.delete(`${P}/sectors/:id/link/:kind(read|fire)`, gestor, ah(async (req, res) => {
      const s = await sectorOf(req.tenantId, req.office.id, req.params.id);
      const col = req.params.kind === 'fire' ? 'fire' : 'read';
      await db.run(`UPDATE telas_int_sectors SET ${col}_hash = NULL, ${col}_at = NULL WHERE id = ?`, [s.id]);
      kickSector(s.id);
      await note(req, 'DELETE /api/reparticao/interna/sectors/link', `prefeitura: endereço ${col === 'fire' ? 'de disparo' : 'de leitura'} do setor "${s.name}" desligado`);
      res.json({ ok: true });
    }));
    app.post(`${P}/notices`, gestor, ah(async (req, res) => {
      const n = cleanNotice(req.body, { now: now() });
      await sectorIdsOk(req.tenantId, req.office.id, n.sectors);
      const t = now();
      if (Number((await db.get('SELECT COUNT(*) AS n FROM telas_int_notices WHERE tenant_id = ? AND office_id = ? AND cancelled_at IS NULL AND until_at > ?', [req.tenantId, req.office.id, t])).n) >= INT_LIMITS.activeNotices) throw fail(409, `No máximo ${INT_LIMITS.activeNotices} avisos internos em vigor. Encerre os que já não valem.`);
      const id = await db.insert('INSERT INTO telas_int_notices(tenant_id,office_id,kind,title,body,sectors,seconds,starts_at,until_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        [req.tenantId, req.office.id, n.kind, n.title, n.body, JSON.stringify(n.sectors), n.seconds, n.startsAt, n.until, line(req.by, 120), t]);
      forget(req.tenantId);
      await note(req, 'POST /api/reparticao/interna/notices', `prefeitura: aviso interno "${n.title}" (${intKindLabel(n.kind)}) publicado (#${id})`, 201);
      res.status(201).json({ id: Number(id) });
    }));
    app.post(`${P}/notices/:id/cancel`, gestor, ah(async (req, res) => {
      const n = await db.get('SELECT * FROM telas_int_notices WHERE id = ? AND tenant_id = ? AND office_id = ?', [idOf(req.params.id, 'Aviso'), req.tenantId, req.office.id]);
      if (!n) throw fail(404, 'Aviso não encontrado.');
      if (!n.cancelled_at) await db.run('UPDATE telas_int_notices SET cancelled_at = ?, cancelled_by = ? WHERE id = ?', [now(), line(req.by, 120), n.id]);
      forget(req.tenantId);
      await note(req, 'POST /api/reparticao/interna/notices/cancel', `prefeitura: aviso interno "${n.title}" encerrado (#${n.id})`);
      res.json({ ok: true });
    }));
    app.put(`${P}/codes`, gestor, ah(async (req, res) => {
      const codes = cleanCodes(req.body?.codes); const minutes = cleanCodeMinutes(req.body?.minutes ?? DEFAULT_CODE_MIN);
      await saveCodeSettings(req.tenantId, req.office.id, { codes, minutes });
      await note(req, 'PUT /api/reparticao/interna/codes', `prefeitura: lista de códigos de emergência alterada (${codes.length} código(s), ${minutes ? `${minutes} min na tela` : 'até encerrar'})`);
      res.json({ catalog: codes, minutes });
    }));
    app.patch(`${P}/devices/:id`, gestor, ah(async (req, res) => {
      const dev = await db.get('SELECT * FROM telas_devices WHERE id = ? AND tenant_id = ? AND office_id = ? AND revoked_at IS NULL', [idOf(req.params.id, 'Tela'), req.tenantId, req.office.id]);
      if (!dev) throw fail(404, 'Tela não encontrada.');
      const out = await setDeviceInternal(req.tenantId, dev, req.body);
      await note(req, 'PATCH /api/reparticao/interna/devices', `prefeitura: tela "${dev.name}" (#${dev.id}) marcada como ${out.internal ? 'INTERNA (só funcionários)' : 'pública'}`);
      res.json(out);
    }));
  }

  function mountPanel(app, { M, own }) {
    app.patch('/api/prefeitura/devices/:id/internal', M, ah(async (req, res) => {
      const dev = await own('telas_devices', req.params.id, req.tenantId, 'Tela');
      const out = await setDeviceInternal(req.tenantId, dev, req.body);
      res.locals.audit = `prefeitura: tela "${dev.name}" (#${dev.id}) marcada como ${out.internal ? 'INTERNA (só funcionários)' : 'pública'}`;
      res.json(out);
    }));
    app.get('/api/prefeitura/offices/:id/sectors', M, ah(async (req, res) => {
      const o = await own('telas_offices', req.params.id, req.tenantId, 'Repartição');
      res.json({ on: internaOn(o), sectors: (await db.all('SELECT id, name FROM telas_int_sectors WHERE tenant_id = ? AND office_id = ? ORDER BY name, id', [req.tenantId, o.id])).map((s) => ({ id: Number(s.id), name: s.name })) });
    }));
  }

  async function prune(t = now()) {
    const old = t - INT_KEEP_DAYS * 86400_000;
    await db.run('DELETE FROM telas_int_reads WHERE notice_id IN (SELECT id FROM telas_int_notices WHERE until_at < ? OR (cancelled_at IS NOT NULL AND cancelled_at < ?))', [old, old]);
    await db.run('DELETE FROM telas_int_notices WHERE until_at < ? OR (cancelled_at IS NOT NULL AND cancelled_at < ?)', [old, old]);
    await db.run('DELETE FROM telas_int_codes WHERE fired_at < ? AND (closed_at IS NOT NULL OR (until_at IS NOT NULL AND until_at < ?))', [old, t]);
  }
  /** A repartição saiu: setores, avisos, leituras e códigos. x = a transação. */
  async function dropOffice(x, tenantId, officeId) {
    await x.run('DELETE FROM telas_int_reads WHERE tenant_id = ? AND notice_id IN (SELECT id FROM telas_int_notices WHERE tenant_id = ? AND office_id = ?)', [tenantId, tenantId, officeId]);
    await x.run('DELETE FROM telas_int_notices WHERE tenant_id = ? AND office_id = ?', [tenantId, officeId]);
    await x.run('DELETE FROM telas_int_codes WHERE tenant_id = ? AND office_id = ?', [tenantId, officeId]);
    await x.run('DELETE FROM telas_int_sectors WHERE tenant_id = ? AND office_id = ?', [tenantId, officeId]);
  }
  return {
    mountDevice, mountStaff, mountOffice, mountPanel, internalFor, codesFor, kick, prune, dropOffice, tick,
    stats: () => ({ conns: [...conns.values()].reduce((a, s) => a + s.size, 0) }),
    stop() { clearInterval(timer); for (const [k, set] of [...conns]) for (const c of [...set]) drop(k, c); },
  };
}
