/* NEXA Telas, fases 3 e 4 (docs/TELAS.md §11 a §16; contrato telas-contrato.md §7.1): o conteúdo além dos avisos. As regras
   sem banco ficam em telas-conteudo-core.js; aqui, o banco, as tarefas de fundo e as rotas:

     cartões de informação   <base>/cards[/:cid]  (o link: /api/reparticao · o painel: /api/prefeitura/offices/:id)
     aprovação da SECOM      GET /api/prefeitura/approvals · POST …/:id/approve · POST …/:id/reject
     vídeos guardados        GET /api/prefeitura/offline · PUT /api/prefeitura/offline (por nível: padrão, grupo, repartição)
     tela desligada          GET /api/prefeitura/availability · GET /api/prefeitura/badge (o selo do menu)

   e o que a configuração de cada tela leva: o clima (segurado por 30 min), os cartões de hoje, os vídeos com o SHA-256 pronto
   e, no sinal de vida, o alerta de emergência do canal (EAS). O cliente vem sempre da credencial. */
import { createHash } from 'node:crypto';
import { db } from './db.js';
import * as C from './telas-core.js';
import * as K from './telas-conteudo-core.js';
import { localDay } from './telas-senha-core.js';
import { cleanBrPlace } from './br-places.js';
import { officeModules, officeCardKinds, CARD_KIND, LIMITS, OFFLINE_MS, deviceStatus, classLabel, isExternal } from '../public/shared/telas-tipos.js';

const { fail, line, idOf } = C;
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const j = C.parseJson;
const num = (v) => (v == null ? null : Number(v));
const marks = (list) => list.map(() => '?').join(',');
export const EVENTS_KEEP_DAYS = 100;
export const HASH_TRIES = 5;

/* ------------------------------------------------------------------ o que a prefeitura define a mais (no padrão da prefeitura) */
export const SETTINGS_DEFAULTS = Object.freeze({ cidade: null, electoral: null, approval: false, eas: true, notify: { offline: false, afterMin: 10 } });
/** O guardado com o de fábrica no que falta (valor guardado fora do formato = o de fábrica). */
export function settingsOf(v) {
  const s = v && typeof v === 'object' ? v : {};
  let electoral = null; try { electoral = K.cleanElectoral(s.electoral); } catch { /* guardado fora do formato */ }
  const c = s.cidade;
  const after = Math.round(Number(s.notify?.afterMin));
  return {
    cidade: c && typeof c === 'object' && Number.isInteger(Number(c.ibge)) && c.city ? { uf: String(c.uf || ''), city: String(c.city), ibge: Number(c.ibge) } : null,
    electoral, approval: s.approval === true, eas: s.eas !== false,
    notify: { offline: s.notify?.offline === true, afterMin: after >= 5 && after <= 1440 ? after : SETTINGS_DEFAULTS.notify.afterMin },
  };
}
/** O que o painel mandou por cima do guardado (campo ausente fica como está). */
export function cleanSettings(b, cur) {
  const out = { ...settingsOf(cur) };
  if (!b || typeof b !== 'object') return out;
  if (b.cidade !== undefined) {
    if (b.cidade === null || b.cidade === '') out.cidade = null;
    else {
      let p; try { p = cleanBrPlace({ uf: b.cidade.uf, city: b.cidade.city, cityIbge: b.cidade.ibge }); } catch (e) { throw fail(400, `Cidade: ${e.message}`); }
      if (!p.city_ibge) throw fail(400, 'Cidade: escolha o estado e o município.');
      out.cidade = { uf: p.uf, city: p.city, ibge: Number(p.city_ibge) };
    }
  }
  if (b.electoral !== undefined) out.electoral = K.cleanElectoral(b.electoral);
  for (const k of ['approval', 'eas']) if (b[k] !== undefined) { if (typeof b[k] !== 'boolean') throw fail(400, `"${k}" é verdadeiro ou falso.`); out[k] = b[k]; }
  if (b.notify !== undefined) {
    const n = b.notify || {};
    const after = n.afterMin === undefined ? out.notify.afterMin : Math.round(Number(n.afterMin));
    if (!(after >= 5 && after <= 1440)) throw fail(400, 'Aviso de tela desligada: de 5 minutos a 24 horas.');
    out.notify = { offline: n.offline === undefined ? out.notify.offline : Boolean(n.offline), afterMin: after };
  }
  return out;
}

/**
 * deps: loadDefaults(tenantId) -> { extra }, cached(key, fn) e forget(tenantId) (as leituras guardadas de server/telas.js),
 * available(tenantId), channelsOf(tenantId), weatherOf(ibge) -> previsão (server/weather.js), easAiring(tenantId),
 * mediaUrl(filename, req) -> endereço público do vídeo, openMedia({ filename }) -> stream de leitura, hold() -> motivo para
 * as tarefas de fundo esperarem (ou null), notify(tenantId, ev) -> o aviso por e-mail que o servidor já tem (ou null),
 * applyAvisos(tenantId, officeId, items) e createAlert(tenantId, alerta, { by, officeId }) (server/telas.js).
 */
export function createConteudo({
  loadDefaults, cached, forget, available, channelsOf = () => [], weatherOf = null, easAiring = () => [], mediaUrl = () => null, openMedia = null, hold = () => null,
  notify = null, applyAvisos, createAlert, missing = null, listImages = async () => [], audit = async () => {}, now = () => Date.now(), timers = true, hashBytesPerSec = (Number(process.env.TELAS_HASH_MBPS) || 8) * 1e6,
}) {
  const electoralNow = async (tenantId) => K.electoralOn((await loadDefaults(tenantId)).extra.electoral, now());

  /* ---------------------------------------------------------------- clima */
  const weather = K.createWeatherHold({ fetch: async (ibge) => { if (!weatherOf) throw new Error('sem clima'); return weatherOf(ibge); }, now });
  /** O clima da cidade da prefeitura (contrato §7.1) ou null: sem cidade, sem fonte configurada ou sem previsão ainda. */
  const weatherFor = (def) => (def.extra.cidade && weatherOf ? weather.get(def.extra.cidade.ibge) : null);

  /* ---------------------------------------------------------------- cartões */
  const cardsOfOffice = (tenantId, officeId) => cached(`crd:${officeId}:${tenantId}`, async () => (await db.all('SELECT * FROM telas_cards WHERE tenant_id = ? AND office_id = ? ORDER BY sort, id', [tenantId, officeId])).map(K.cardFromRow));
  const kindsOf = (o) => officeCardKinds(officeModules(o.type, j(o.modules, {})));
  /** Os cartões de hoje para as telas da repartição (contrato §7.1). */
  async function cardsFor(tenantId, o, electoral) {
    return K.cardsFor(await cardsOfOffice(tenantId, Number(o.id)), { now: now(), kinds: kindsOf(o), electoral });
  }
  const cardCols = (c) => [c.kind, c.title, JSON.stringify(c.lines), c.weekday, c.dateFrom, c.dateTo, c.sort, c.seconds, c.class];
  async function insertCard(tenantId, officeId, c, by) {
    const n = Number((await db.get('SELECT COUNT(*) AS n FROM telas_cards WHERE tenant_id = ? AND office_id = ?', [tenantId, officeId])).n);
    if (n >= LIMITS.cardsPerOffice) throw fail(409, `Limite de ${LIMITS.cardsPerOffice} cartões por repartição.`);
    const id = await db.insert('INSERT INTO telas_cards(tenant_id,office_id,kind,title,lines,weekday,date_from,date_to,sort,seconds,class,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', [tenantId, officeId, ...cardCols(c), line(by, 64), now()]);
    forget(tenantId);
    return K.cardFromRow(await db.get('SELECT * FROM telas_cards WHERE id = ?', [id]));
  }
  async function updateCard(tenantId, officeId, id, c) {
    const r = await db.run('UPDATE telas_cards SET kind = ?, title = ?, lines = ?, weekday = ?, date_from = ?, date_to = ?, sort = ?, seconds = ?, class = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND office_id = ?', [...cardCols(c), now(), id, tenantId, officeId]);
    if (!r.changes) throw fail(404, 'Cartão não encontrado.');
    forget(tenantId);
    return K.cardFromRow(await db.get('SELECT * FROM telas_cards WHERE id = ?', [id]));
  }
  const cardOf = async (o, id) => {
    const r = await db.get('SELECT * FROM telas_cards WHERE id = ? AND tenant_id = ? AND office_id = ?', [idOf(id, 'Cartão'), o.tenant_id, o.id]);
    if (!r) throw fail(404, 'Cartão não encontrado.');
    return K.cardFromRow(r);
  };
  const cardText = (c) => `${CARD_KIND[c.kind]?.label || c.kind}: "${c.title}"`;

  /* ---------------------------------------------------------------- aprovação da SECOM */
  const approvalOn = async (tenantId) => (await loadDefaults(tenantId)).extra.approval === true;
  const approvalDto = (a, offices = null) => ({
    id: Number(a.id), officeId: Number(a.office_id), office: offices?.get(Number(a.office_id)) ?? undefined, kind: a.kind, refId: num(a.ref_id), payload: j(a.payload, {}), class: a.class, summary: a.summary,
    status: a.status, requestedBy: a.requested_by, requestedAt: Number(a.requested_at), decidedBy: a.decided_by || null, decidedAt: num(a.decided_at), note: a.note || null,
  });
  /**
   * Guarda um pedido (aguardando aprovação). O pedido novo dos avisos da repartição, ou do mesmo cartão, substitui o que
   * ainda esperava. status 'auto' = saiu na hora e ficou marcado (o alerta da Defesa Civil).
   */
  async function request(tenantId, officeId, { kind, refId = null, payload, cls = K.DEFAULT_CLASS, summary, by, status = 'pending' }) {
    const t = now();
    if (status === 'pending' && (kind === 'avisos' || (kind === 'card' && refId != null))) {
      await db.run(`UPDATE telas_approvals SET status = 'superseded', decided_at = ? WHERE tenant_id = ? AND office_id = ? AND kind = ? AND status = 'pending'${kind === 'card' ? ' AND ref_id = ?' : ''}`, kind === 'card' ? [t, tenantId, officeId, kind, refId] : [t, tenantId, officeId, kind]);
    }
    const id = await db.insert('INSERT INTO telas_approvals(tenant_id,office_id,kind,ref_id,payload,class,summary,status,requested_by,requested_at,decided_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [tenantId, officeId, kind, refId, JSON.stringify(payload), cls, line(summary, 200), status, line(by, 64), t, status === 'auto' ? t : null]);
    return approvalDto(await db.get('SELECT * FROM telas_approvals WHERE id = ?', [id]));
  }
  /** Os pedidos recentes de uma repartição (a página de controle mostra o que espera e o que foi recusado). */
  const requestsOf = async (tenantId, officeId) => (await db.all("SELECT * FROM telas_approvals WHERE tenant_id = ? AND office_id = ? AND status IN ('pending','rejected','approved') ORDER BY id DESC LIMIT 20", [tenantId, officeId])).map((a) => approvalDto(a));
  /** Aplica o pedido aprovado (os avisos na repartição, o cartão, o alerta com o prazo contado a partir de agora). */
  async function apply(tenantId, a) {
    const p = j(a.payload, {}); const officeId = Number(a.office_id);
    const o = await db.get('SELECT * FROM telas_offices WHERE id = ? AND tenant_id = ?', [officeId, tenantId]);
    if (!o) throw fail(409, 'A repartição deste pedido não existe mais. Recuse o pedido.');
    if (a.kind === 'avisos') return applyAvisos(tenantId, officeId, p.items);
    if (a.kind === 'card') {
      const c = K.cleanCard(p, null, { kinds: kindsOf(o) });
      if (a.ref_id == null) return insertCard(tenantId, officeId, c, a.requested_by);
      return updateCard(tenantId, officeId, Number(a.ref_id), c);
    }
    if (a.kind === 'alert') {
      const t = now(); const dur = Math.max(60_000, Number(p.until) - Number(p.startsAt));
      const startsAt = Math.max(Number(p.startsAt) || t, t);
      return createAlert(tenantId, { ...p, startsAt, until: startsAt + dur }, { by: a.requested_by, officeId, cls: a.class, info: p.info && typeof p.info === 'object' ? p.info : null });
    }
    if (a.kind === 'missing' && missing) return missing.activate(tenantId, Number(a.ref_id)); // o caso que esperava entra no ar
    throw fail(400, 'Pedido de tipo desconhecido.');
  }

  /* ---------------------------------------------------------------- classificação dos alertas (modo eleitoral) */
  async function setAlertMeta(tenantId, alertId, { cls = K.DEFAULT_CLASS, flag = null }) {
    await db.run('INSERT INTO telas_alert_meta(alert_id,tenant_id,class,flag) VALUES(?,?,?,?) ON CONFLICT (alert_id) DO UPDATE SET class = excluded.class, flag = excluded.flag', [alertId, tenantId, cls, flag]);
  }

  /* ---------------------------------------------------------------- vídeos guardados */
  const OFFLINE_SCOPES = ['default', 'group', 'office'];
  const MEDIA_OK = "m.status = 'ready' AND m.kind <> 'live' AND m.size > 0 AND m.censura = 0";
  const hashState = (r) => (r.h_sha && r.h_file === r.m_file && Number(r.h_bytes) === Number(r.m_size) ? 'ok' : r.h_file === r.m_file && Number(r.h_tries) >= HASH_TRIES ? 'error' : 'pending');
  const offlineRows = (tenantId) => cached(`off:${tenantId}`, () => db.all(`SELECT f.*, m.title AS m_title, m.filename AS m_file, m.size AS m_size, h.sha256 AS h_sha, h.filename AS h_file, h.bytes AS h_bytes, h.tries AS h_tries, h.error AS h_error
    FROM telas_offline f JOIN media m ON m.id = f.media_id AND m.tenant_id = f.tenant_id AND ${MEDIA_OK}
    LEFT JOIN telas_media_hashes h ON h.media_id = f.media_id AND h.tenant_id = f.tenant_id
    WHERE f.tenant_id = ? ORDER BY f.sort, f.id`, [tenantId]));
  /** offline.items de uma tela: o padrão da prefeitura, depois os grupos dela (na ordem) e a repartição. */
  async function offlineFor(tenantId, { officeId, groupIds = [] }, req, electoral) {
    const rows = await offlineRows(tenantId);
    if (!rows.length) return [];
    const pick = (scope, id) => rows.filter((r) => r.scope === scope && Number(r.scope_id) === Number(id));
    const mine = [...pick('default', 0), ...groupIds.flatMap((g) => pick('group', g)), ...pick('office', officeId)];
    return K.offlineItems(mine.map((r) => ({ mediaId: Number(r.media_id), class: r.class, bytes: Number(r.m_size), sha256: hashState(r) === 'ok' ? r.h_sha : null, url: mediaUrl(r.m_file, req) })), { electoral });
  }
  /** O SHA-256 de um vídeo, em segundo plano: um por vez, com teto de leitura e parando enquanto o ar está sem folga. */
  let hashing = false;
  const sleep = (ms) => new Promise((r) => { setTimeout(r, ms).unref?.(); });
  async function hashOne(m) {
    const h = createHash('sha256'); let bytes = 0; const t0 = Date.now();
    const stream = await openMedia({ id: Number(m.id), filename: m.filename, size: Number(m.size) });
    try {
      for await (const chunk of stream) {
        h.update(chunk); bytes += chunk.length;
        // o ar primeiro: espera o freio das tarefas de fundo soltar; e nunca lê mais rápido que o teto
        for (let i = 0; hold() && i < 1800; i++) await sleep(2000);
        const ahead = (bytes / hashBytesPerSec) * 1000 - (Date.now() - t0);
        if (ahead > 50) await sleep(Math.min(ahead, 2000));
      }
    } finally { stream.destroy?.(); }
    if (bytes !== Number(m.size)) throw new Error(`tamanho lido (${bytes}) diferente do esperado (${m.size})`);
    return h.digest('hex');
  }
  /** Um vídeo escolhido ainda sem o hash (ou trocado por outro arquivo): calcula e guarda. Devolve quantos calculou. */
  async function hashPending({ max = 1 } = {}) {
    if (hashing || !openMedia) return 0;
    hashing = true; let done = 0;
    try {
      for (; done < max;) {
        if (hold()) break;
        const m = await db.get(`SELECT DISTINCT m.id, m.tenant_id, m.filename, m.size FROM telas_offline f JOIN media m ON m.id = f.media_id AND m.tenant_id = f.tenant_id AND ${MEDIA_OK}
          LEFT JOIN telas_media_hashes h ON h.media_id = m.id
          WHERE h.media_id IS NULL OR h.filename <> m.filename OR h.bytes <> m.size OR (h.sha256 IS NULL AND h.tries < ? AND COALESCE(h.updated_at, 0) < ?) LIMIT 1`, [HASH_TRIES, now() - 10 * 60_000]);
        if (!m) break;
        const tenantId = Number(m.tenant_id); const t = now();
        const prev = await db.get('SELECT filename, bytes, tries FROM telas_media_hashes WHERE media_id = ?', [m.id]);
        const tries = prev && prev.filename === m.filename && Number(prev.bytes) === Number(m.size) ? Number(prev.tries) || 0 : 0;
        const save = (sha, error) => db.run(`INSERT INTO telas_media_hashes(media_id,tenant_id,filename,bytes,sha256,error,tries,hashed_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
          ON CONFLICT (media_id) DO UPDATE SET tenant_id = excluded.tenant_id, filename = excluded.filename, bytes = excluded.bytes, sha256 = excluded.sha256, error = excluded.error, tries = excluded.tries, hashed_at = excluded.hashed_at, updated_at = excluded.updated_at`,
        [m.id, tenantId, m.filename, Number(m.size), sha, error, sha ? 0 : tries + 1, sha ? now() : null, now()]);
        if (!(await available(tenantId).catch(() => false))) { await save(null, 'modo prefeitura desligado'); continue; }
        try { await save(await hashOne(m), null); done++; console.log(`[telas] vídeo guardado #${m.id}: SHA-256 calculado (${Math.round(Number(m.size) / 1e6)} MB em ${Math.round((now() - t) / 1000)} s)`); } catch (err) {
          // sem endereço assinado no log: só o motivo, cortado
          await save(null, String(err?.message || err).replace(/https?:\/\/\S+/g, '(endereço)').slice(0, 200));
          console.warn(`[telas] vídeo guardado #${m.id}: SHA-256 falhou (tentativa ${tries + 1} de ${HASH_TRIES})`);
        }
        forget(tenantId);
      }
    } finally { hashing = false; }
    return done;
  }

  /* ---------------------------------------------------------------- alerta de emergência do canal (EAS) */
  /** Os alertas do EAS no ar no canal da repartição, como alertas `critical` (só leitura do estado do EAS). */
  function easFor(tenantId, officeChannelId, def) {
    if (def.extra.eas === false) return [];
    let list; try { list = easAiring(tenantId) || []; } catch { return []; }
    if (!list.length) return [];
    const channels = channelsOf(tenantId);
    const ch = (officeChannelId != null && channels.find((c) => c.id === Number(officeChannelId))) || channels[0];
    // o que uma repartição de emergência pôs no ar do canal (fromTelas) já está nas telas pelo próprio alerta: não repete
    return ch ? list.filter((a) => Number(a.channelId) === ch.id && !a.fromTelas).map((a) => K.easAlert(a, now())) : [];
  }

  /* ---------------------------------------------------------------- tela desligada: histórico, disponibilidade e aviso */
  const known = new Map(); // tela -> { status, at } (a última situação gravada)
  const told = new Set(); // telas com o aviso de "desligada" já enviado
  let primed = false;
  const statusOfRow = (d, t) => { const s = deviceStatus({ lastSeen: num(d.last_seen), state: d.state }, t); return s === 'never' ? null : s; };
  /** A cada minuto: grava a mudança de situação de cada tela (no ar, ligada sem imagem, desligada) e manda os avisos. */
  async function checkDevices(t = now()) {
    if (!primed) {
      for (const r of await db.all('SELECT device_id, status, at FROM telas_device_events WHERE id IN (SELECT MAX(id) FROM telas_device_events GROUP BY device_id)')) known.set(Number(r.device_id), { status: r.status, at: Number(r.at) });
    }
    const rows = await db.all(`SELECT d.id, d.tenant_id, d.name, d.last_seen, d.state, o.name AS o_name FROM telas_devices d LEFT JOIN telas_offices o ON o.id = d.office_id AND o.tenant_id = d.tenant_id
      WHERE d.revoked_at IS NULL AND d.last_seen IS NOT NULL`);
    const live = new Map(); const defs = new Map(); let changes = 0;
    const setting = async (tenantId) => { if (!defs.has(tenantId)) defs.set(tenantId, (await loadDefaults(tenantId)).extra.notify); return defs.get(tenantId); };
    for (const d of rows) {
      const id = Number(d.id); const tenantId = Number(d.tenant_id);
      const st = statusOfRow(d, t); if (!st) continue;
      const prev = known.get(id);
      if (!prev || prev.status !== st) {
        // desligada: a hora é a do último sinal + o prazo (quando de fato passou a contar como desligada)
        const at = st === 'off' ? Math.min(t, Number(d.last_seen) + OFFLINE_MS) : t;
        await db.run('INSERT INTO telas_device_events(tenant_id,device_id,status,at) VALUES(?,?,?,?)', [tenantId, id, st, at]);
        known.set(id, { status: st, at }); changes++;
      }
      if (!notify) continue;
      const cur = known.get(id);
      if (cur.status === 'off') {
        if (told.has(id)) continue;
        const n = await setting(tenantId);
        if (t - cur.at < n.afterMin * 60_000) continue;
        told.add(id);
        // na 1ª volta depois de subir, quem já passou do prazo há mais de 2 voltas conta como avisado (sem repetir o e-mail a cada reinício)
        if (!primed && t - cur.at > n.afterMin * 60_000 + 150_000) continue;
        if (!live.has(tenantId)) live.set(tenantId, await available(tenantId).catch(() => false));
        if (!n.offline || !live.get(tenantId)) continue;
        Promise.resolve(notify(tenantId, { at: t, level: 'critico', kind: 'alarm_start', point: `tela-${id}`, alarm: 'desligada', pointLabel: 'NEXA Telas', message: `Tela "${d.name}"${d.o_name ? ` (${d.o_name})` : ''} desligada há ${K.agoText(t - cur.at)}` })).catch(() => {});
      } else if (told.delete(id) && cur.status === 'on') {
        const n = await setting(tenantId);
        if (n.offline) Promise.resolve(notify(tenantId, { at: t, level: 'ok', kind: 'alarm_end', was: 'critico', point: `tela-${id}`, alarm: 'desligada', pointLabel: 'NEXA Telas', message: `Tela "${d.name}"${d.o_name ? ` (${d.o_name})` : ''} voltou ao ar` })).catch(() => {});
      }
    }
    primed = true;
    return changes;
  }
  /** Por tela: a disponibilidade em 7 e 30 dias e desde quando está desligada. */
  async function availabilityOf(tenantId, t = now()) {
    const from30 = t - 30 * 86400_000;
    const [before, events] = await Promise.all([
      db.all('SELECT device_id, status, at FROM telas_device_events WHERE tenant_id = ? AND id IN (SELECT MAX(id) FROM telas_device_events WHERE tenant_id = ? AND at <= ? GROUP BY device_id)', [tenantId, tenantId, from30]),
      db.all('SELECT device_id, status, at FROM telas_device_events WHERE tenant_id = ? AND at > ? ORDER BY device_id, at, id', [tenantId, from30]),
    ]);
    const by = new Map();
    const push = (r) => { const k = Number(r.device_id); if (!by.has(k)) by.set(k, []); by.get(k).push({ status: r.status, at: Number(r.at) }); };
    before.forEach(push); events.forEach(push);
    const out = [];
    for (const [id, list] of by) {
      const last = list[list.length - 1];
      out.push({ id, d7: K.availability(list, { from: t - 7 * 86400_000, to: t }).pct, d30: K.availability(list, { from: from30, to: t }).pct, status: last.status, since: last.at });
    }
    return out;
  }
  /** O selo do menu Prefeitura: telas desligadas (que já deram sinal) e pedidos aguardando aprovação. */
  async function badge(tenantId, t = now()) {
    const [off, pend] = await Promise.all([
      db.get('SELECT COUNT(*) AS n FROM telas_devices WHERE tenant_id = ? AND revoked_at IS NULL AND last_seen IS NOT NULL AND last_seen < ?', [tenantId, t - OFFLINE_MS]),
      db.get("SELECT COUNT(*) AS n FROM telas_approvals WHERE tenant_id = ? AND status = 'pending'", [tenantId]),
    ]);
    return { off: Number(off.n), approvals: Number(pend.n) };
  }

  /* ---------------------------------------------------------------- rotas: cartões (no link e no painel) */
  /** reg(method, sub, fn): fn({ o, body, params, by, via }) -> { status?, body, log? }; via = 'link' | 'panel'. */
  function cardOperations(reg) {
    reg('get', '', async ({ o }) => ({ body: { kinds: kindsOf(o), cards: await cardsOfOffice(Number(o.tenant_id), Number(o.id)), limits: { cards: LIMITS.cardsPerOffice, title: LIMITS.cardTitle, lines: LIMITS.cardLines, line: LIMITS.cardLine } } }));
    const write = async ({ o, body, params, by, via }, cur) => {
      const tenantId = Number(o.tenant_id);
      const c = K.cleanCard(body, cur, { kinds: kindsOf(o) });
      // pelo link de controle, com a aprovação da SECOM ligada: o cartão espera (o que já está nas telas fica como está)
      if (via === 'link' && (await approvalOn(tenantId))) {
        const a = await request(tenantId, Number(o.id), { kind: 'card', refId: cur ? cur.id : null, payload: c, cls: c.class, summary: cardText(c), by });
        return { status: 202, body: { pending: true, approval: a }, log: `prefeitura: cartão ${cardText(c)} de "${o.name}" enviado para aprovação` };
      }
      const card = cur ? await updateCard(tenantId, Number(o.id), cur.id, c) : await insertCard(tenantId, Number(o.id), c, by);
      return { status: cur ? 200 : 201, body: card, log: `prefeitura: cartão ${cardText(c)} de "${o.name}" ${cur ? 'alterado' : 'criado'}${c.class !== K.DEFAULT_CLASS ? ` (${classLabel(c.class)})` : ''}` };
    };
    reg('post', '', (x) => write(x, null));
    reg('patch', '/:cid', async (x) => write(x, await cardOf(x.o, x.params.cid)));
    reg('delete', '/:cid', async ({ o, params }) => {
      const cur = await cardOf(o, params.cid);
      await db.run('DELETE FROM telas_cards WHERE id = ? AND tenant_id = ? AND office_id = ?', [cur.id, o.tenant_id, o.id]);
      await db.run("UPDATE telas_approvals SET status = 'superseded', decided_at = ? WHERE tenant_id = ? AND kind = 'card' AND ref_id = ? AND status = 'pending'", [now(), o.tenant_id, cur.id]);
      forget(Number(o.tenant_id));
      return { body: { ok: true }, log: `prefeitura: cartão ${cardText(cur)} de "${o.name}" excluído` };
    });
  }
  /** A fila da SECOM: o que espera e o histórico recente, com o nome, o tipo e o formato da tela de cada repartição. */
  /**
   * Quem decide o quê. O pedido de um emissor conveniado (órgão de fora) é do CCO: a Segurança decide; a SECOM só decide se
   * a prefeitura não tem repartição de Segurança. Os pedidos das repartições da prefeitura (aprovação geral ligada), as
   * duas decidem. viewer: o tipo da repartição que está vendo (null = o Painel da Prefeitura, que decide tudo).
   */
  const canDecide = (viewer, officeType, hasCco) => viewer == null || !isExternal(officeType) || viewer === 'seguranca' || !hasCco;
  async function listApprovals(tenantId, viewer = null) {
    const [rows, offices, def] = await Promise.all([
      db.all("SELECT * FROM telas_approvals WHERE tenant_id = ? AND status <> 'superseded' ORDER BY id DESC LIMIT 300", [tenantId]),
      db.all('SELECT id, name, type, config FROM telas_offices WHERE tenant_id = ?', [tenantId]),
      loadDefaults(tenantId),
    ]);
    const names = new Map(offices.map((o) => [Number(o.id), o.name]));
    const info = new Map(offices.map((o) => [Number(o.id), { officeType: o.type, officeLayout: j(o.config, {}).layout || def.config.layout || 'full' }]));
    const hasCco = offices.some((o) => o.type === 'seguranca');
    const list = rows.map((a) => ({ ...approvalDto(a, names), ...(info.get(Number(a.office_id)) || {}) })).filter((a) => canDecide(viewer, a.officeType, hasCco)).map((a) => ({ ...a, external: isExternal(a.officeType) }));
    return { serverTime: now(), enabled: def.extra.approval, electoral: { ...(def.extra.electoral || {}), on: K.electoralOn(def.extra.electoral, now()) }, pending: list.filter((a) => a.status === 'pending').reverse(), history: list.filter((a) => a.status !== 'pending').slice(0, 100) };
  }
  /** Aprova ou recusa um pedido (o mesmo no Painel da Prefeitura e no link da SECOM). Devolve o texto da auditoria. */
  async function decideApproval(tenantId, id, status, { by, note: why, viewer = null }) {
    const a = await db.get('SELECT * FROM telas_approvals WHERE id = ? AND tenant_id = ?', [idOf(id), tenantId]);
    if (!a) throw fail(404, 'Pedido não encontrado.');
    if (viewer != null) {
      const from = await db.get('SELECT type FROM telas_offices WHERE id = ? AND tenant_id = ?', [a.office_id, tenantId]);
      const hasCco = Boolean(await db.get("SELECT id FROM telas_offices WHERE tenant_id = ? AND type = 'seguranca' LIMIT 1", [tenantId]));
      if (!canDecide(viewer, from?.type, hasCco)) throw fail(403, 'O pedido de um emissor conveniado é decidido pela Segurança (CCO).');
    }
    // só quem tira o pedido de "aguardando" o decide (dois cliques, duas pessoas: um só vale)
    const r = await db.run("UPDATE telas_approvals SET status = ?, decided_by = ?, decided_at = ?, note = ? WHERE id = ? AND tenant_id = ? AND status = 'pending'", [status, line(by, 64), now(), line(why, 200) || null, a.id, tenantId]);
    if (r.changes !== 1) throw fail(409, 'Este pedido já foi decidido.');
    // o caso de desaparecido ou a cartela devolvidos: o registro fica como devolvido e a foto é apagada
    if (status === 'rejected' && a.kind === 'missing' && missing) await missing.reject(tenantId, Number(a.ref_id), by);
    if (status === 'approved') {
      try { await apply(tenantId, a); } catch (err) {
        await db.run("UPDATE telas_approvals SET status = 'pending', decided_by = NULL, decided_at = NULL, note = NULL WHERE id = ? AND tenant_id = ?", [a.id, tenantId]);
        throw err;
      }
    }
    forget(tenantId);
    return `prefeitura: pedido #${a.id} (${a.kind}: ${a.summary}) pedido por ${a.requested_by} ${status === 'approved' ? 'APROVADO' : 'RECUSADO'}${why ? `: ${line(why, 120)}` : ''}`;
  }

  /** office: a sessão do link; gestor: sessão + papel gestor; secom: gestor de uma repartição do tipo SECOM. */
  function mountOffice(app, { gestor, approver, note }) {
    cardOperations((method, sub, fn) => app[method](`/api/reparticao/cards${sub}`, gestor, ah(async (req, res) => {
      if (isExternal(req.office.type)) return res.status(403).json({ error: 'O emissor conveniado não tem cartões nem avisos: só emite o que o convênio permite.' });
      const out = await fn({ o: req.office, body: req.body || {}, params: req.params, by: req.by, via: 'link' });
      if (out.log) await note(req, `${method.toUpperCase()} /api/reparticao/cards`, `${out.log} pelo link de controle`, out.status || 200);
      res.status(out.status || 200).json(out.body);
    })));
    /* ---- a fila de aprovação dentro do link da SECOM: os pedidos de TODAS as repartições do cliente */
    app.get('/api/reparticao/approvals', approver, ah(async (req, res) => res.set('Cache-Control', 'no-store').json(await listApprovals(req.tenantId, req.office.type))));
    const decide = (status) => ah(async (req, res) => {
      if (status === 'rejected' && line(req.body?.note, 200).length < 3) throw fail(400, 'Escreva o motivo da devolução.');
      const log = await decideApproval(req.tenantId, req.params.id, status, { by: req.by, note: req.body?.note, viewer: req.office.type });
      await note(req, `POST /api/reparticao/approvals/${status === 'approved' ? 'approve' : 'reject'}`, `${log} pelo link ${req.office.type === 'seguranca' ? 'da Segurança (CCO)' : 'da SECOM'}`);
      res.json({ ok: true, status });
    });
    app.post('/api/reparticao/approvals/:id/approve', approver, decide('approved'));
    app.post('/api/reparticao/approvals/:id/reject', approver, decide('rejected'));
  }

  function mountPanel(app, { M, own, who }) {
    cardOperations((method, sub, fn) => app[method](`/api/prefeitura/offices/:id/cards${sub}`, M, ah(async (req, res) => {
      const o = await own('telas_offices', req.params.id, req.tenantId, 'Repartição');
      const out = await fn({ o, body: req.body || {}, params: req.params, by: who(req), via: 'panel' });
      if (out.log) res.locals.audit = out.log;
      res.status(out.status || 200).json(out.body);
    })));

    /* ---- aprovações */
    app.get('/api/prefeitura/approvals', M, ah(async (req, res) => res.set('Cache-Control', 'no-store').json(await listApprovals(req.tenantId))));
    const decide = (status) => ah(async (req, res) => {
      res.locals.audit = await decideApproval(req.tenantId, req.params.id, status, { by: who(req), note: req.body?.note });
      res.json({ ok: true, status });
    });
    app.post('/api/prefeitura/approvals/:id/approve', M, decide('approved'));
    app.post('/api/prefeitura/approvals/:id/reject', M, decide('rejected'));

    /* ---- vídeos guardados */
    const scopeOf = async (b, tenantId) => {
      const scope = b?.scope;
      if (!OFFLINE_SCOPES.includes(scope)) throw fail(400, 'Nível inválido (padrão da prefeitura, grupo ou repartição).');
      if (scope === 'default') return { scope, scopeId: 0 };
      const row = await own(scope === 'group' ? 'telas_groups' : 'telas_offices', b.scopeId, tenantId, scope === 'group' ? 'Grupo' : 'Repartição');
      return { scope, scopeId: Number(row.id) };
    };
    app.get('/api/prefeitura/offline', M, ah(async (req, res) => {
      const [rows, media, images] = await Promise.all([
        offlineRows(req.tenantId),
        db.all(`SELECT m.id, m.title, m.size, m.duration FROM media m WHERE m.tenant_id = ? AND ${MEDIA_OK} ORDER BY m.title LIMIT 1000`, [req.tenantId]),
        listImages(req.tenantId), // a imagem sem internet de cada nível (server/telas-imagem-offline.js)
      ]);
      res.set('Cache-Control', 'no-store').json({
        limits: { perScope: LIMITS.offlinePerScope, sent: LIMITS.offlineSent },
        items: rows.map((r) => ({ id: Number(r.id), scope: r.scope, scopeId: Number(r.scope_id), mediaId: Number(r.media_id), title: r.m_title, bytes: Number(r.m_size), class: r.class, hash: hashState(r), error: hashState(r) === 'error' ? r.h_error || 'falha ao ler o arquivo' : null })),
        media: media.map((m) => ({ id: Number(m.id), title: m.title, bytes: Number(m.size), duration: Number(m.duration) || 0 })),
        images,
      });
    }));
    app.put('/api/prefeitura/offline', M, ah(async (req, res) => {
      const { scope, scopeId } = await scopeOf(req.body, req.tenantId);
      if (!Array.isArray(req.body?.items) || req.body.items.length > LIMITS.offlinePerScope) throw fail(400, `Vídeos guardados: no máximo ${LIMITS.offlinePerScope} por nível.`);
      const items = req.body.items.map((x) => ({ mediaId: idOf(x?.mediaId, 'Vídeo'), cls: K.cleanClass(x?.class) }));
      const ids = [...new Set(items.map((x) => x.mediaId))];
      if (ids.length !== items.length) throw fail(400, 'Vídeo repetido na lista.');
      if (ids.length) {
        // só vídeo pronto DESTE cliente (mídia de outro cliente = inexistente)
        const ok = await db.all(`SELECT m.id FROM media m WHERE m.tenant_id = ? AND ${MEDIA_OK} AND m.id IN (${marks(ids)})`, [req.tenantId, ...ids]);
        if (ok.length !== ids.length) throw fail(400, 'Vídeo inexistente na biblioteca (ou ainda não está pronto).');
      }
      const t = now();
      await db.tx(async (x) => {
        await x.run('DELETE FROM telas_offline WHERE tenant_id = ? AND scope = ? AND scope_id = ?', [req.tenantId, scope, scopeId]);
        let i = 0;
        for (const it of items) await x.run('INSERT INTO telas_offline(tenant_id,scope,scope_id,media_id,class,sort,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)', [req.tenantId, scope, scopeId, it.mediaId, it.cls, i++, who(req), t]);
      });
      forget(req.tenantId);
      res.locals.audit = `prefeitura: vídeos guardados (${scope === 'default' ? 'padrão da prefeitura' : `${scope === 'group' ? 'grupo' : 'repartição'} #${scopeId}`}): ${items.length} vídeo(s)`;
      hashPending({ max: 3 }).catch(() => {}); // começa já (em segundo plano); o resto, na volta de cada minuto
      res.json({ ok: true, count: items.length });
    }));

    /* ---- tela desligada */
    app.get('/api/prefeitura/availability', M, ah(async (req, res) => res.set('Cache-Control', 'no-store').json({ serverTime: now(), devices: await availabilityOf(req.tenantId) })));
    app.get('/api/prefeitura/badge', M, ah(async (req, res) => res.set('Cache-Control', 'no-store').json(await badge(req.tenantId))));
  }

  /* ---------------------------------------------------------------- limpeza e exclusões */
  async function prune(t = now()) {
    // o histórico das telas: 100 dias, mas a última situação de cada tela fica (é o ponto de partida da disponibilidade)
    await db.run('DELETE FROM telas_device_events WHERE at < ? AND id NOT IN (SELECT MAX(id) FROM telas_device_events GROUP BY device_id)', [t - EVENTS_KEEP_DAYS * 86400_000]);
    await db.run("DELETE FROM telas_approvals WHERE status <> 'pending' AND requested_at < ?", [t - 365 * 86400_000]);
    // hash de vídeo que saiu de todas as listas (ou da biblioteca)
    await db.run('DELETE FROM telas_media_hashes WHERE media_id NOT IN (SELECT media_id FROM telas_offline)');
    await db.run('DELETE FROM telas_offline WHERE media_id NOT IN (SELECT id FROM media)');
  }
  async function dropOffice(x, tenantId, officeId) {
    await x.run('DELETE FROM telas_cards WHERE office_id = ? AND tenant_id = ?', [officeId, tenantId]);
    await x.run("DELETE FROM telas_approvals WHERE office_id = ? AND tenant_id = ? AND status = 'pending'", [officeId, tenantId]);
    await x.run("DELETE FROM telas_offline WHERE tenant_id = ? AND scope = 'office' AND scope_id = ?", [tenantId, officeId]);
  }
  const dropGroup = (x, tenantId, groupId) => x.run("DELETE FROM telas_offline WHERE tenant_id = ? AND scope = 'group' AND scope_id = ?", [tenantId, groupId]);
  async function dropDevice(x, tenantId, deviceId) {
    await x.run('DELETE FROM telas_device_events WHERE device_id = ? AND tenant_id = ?', [deviceId, tenantId]);
    known.delete(Number(deviceId)); told.delete(Number(deviceId));
  }

  const minute = timers ? setInterval(() => {
    checkDevices().catch((err) => console.warn('[telas] telas desligadas:', err.message));
    hashPending({ max: 2 }).catch((err) => console.warn('[telas] vídeos guardados:', err.message));
  }, 60_000) : null;
  minute?.unref?.();

  return {
    mountOffice, mountPanel, electoralNow, weatherFor, weather, cardsFor, offlineFor, easFor, approvalOn, request, requestsOf, setAlertMeta,
    checkDevices, availabilityOf, badge, hashPending, prune, dropOffice, dropGroup, dropDevice,
    stop() { clearInterval(minute); },
  };
}
