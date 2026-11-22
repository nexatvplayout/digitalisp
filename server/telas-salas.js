/* NEXA Telas · salas e consultórios, grupos com round robin, etapas, pedidos de apoio, QR do acompanhante, espera estimada e
   indicadores (docs/TELAS.md §26 a §31). As regras sem banco ficam em telas-salas-core.js. Este módulo nasce dentro de
   createSenha (server/telas-senha.js), que entrega as operações da fila (chamar, finalizar, encaminhar…): a ordem de
   chamada continua sendo uma só (rankQueue) e a garantia de "duas salas nunca levam a mesma senha" continua sendo a do
   "tirar de esperando" (só quem muda a senha de waiting para called a chama).

   Rotas, além das de <base> (o link e o painel; ver operations):
     A sala (/reparticao/<token da sala>/sala; token próprio por sala, só chama e dá andamento NAQUELA sala)
       GET  /api/sala                       a sala, a senha dela e quem espera nas filas do grupo (sem nomes)
       POST /api/sala/call                  Chamar paciente (a próxima pela ordem do Manchester, nas filas do grupo)
       POST /api/sala/repeat|noshow|finish|requeue|forward   a senha da sala
       POST /api/sala/state                 Disponível ou Pausa
       POST /api/sala/tickets/:id/risk      Reavaliar (a cor de quem espera e passou do tempo-alvo)
       POST /api/sala/support               Preciso de: maqueiro, limpeza… · POST /api/sala/support/:id/cancel
     O apoio (/reparticao/<token do apoio>/apoio; o celular do setor de apoio)
       GET  /api/apoio · POST /api/apoio/:id/accept|done
     A TV box (token do aparelho): GET /api/telas/support (os pedidos abertos da repartição dela, para as telas internas)
     O acompanhante (/senha/<token opaco>, do QR do cupom): GET /api/acompanhar
*/
import path from 'node:path';
import { db } from './db.js';
import { config } from './config.js';
import { createLimiter, ipKey } from './ratelimit.js';
import * as C from './telas-core.js';
import * as S from './telas-senha-core.js';
import * as R from './telas-salas-core.js';
import { RISK_KEYS } from '../public/shared/telas-tipos.js';
import { roomKindLabel, stageModeLabel, SALAS_LIMITS as L, SUPPORT_STATUS } from '../public/shared/telas-salas.js';

const { fail, line, idOf, sha256 } = C;
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const num = (v) => (v == null ? null : Number(v));
const PAGE = path.join(config.root, 'public', 'reparticao');
const KEEP_MS = 90 * 86400_000;

/**
 * deps (de createSenha): now, today, queueOf(o), extrasOf, saveExtras, servicesOf, ticketOf, needOn, enabledFor, changed(o,
 * cfg), publicUrl(req), available(tenantId), audit, ipOf, timers, ops: { callNext, close, forward, repeat, requeue, triage }.
 */
export function createSalas(deps) {
  const { now, today, queueOf, extrasOf, saveExtras, servicesOf, ticketOf, needOn, enabledFor, changed, publicUrl, available, ipOf, timers } = deps;
  const ops = deps.ops;
  const T = (o) => Number(o.tenant_id);

  /* ---------------------------------------------------------------- configuração da UPA e leitura das salas */
  const upaOf = async (o) => R.upaConfigOf((await extrasOf(T(o), Number(o.id))).data.upa, o.type);
  const roomsOf = (o) => db.all('SELECT * FROM telas_rooms WHERE tenant_id = ? AND office_id = ? ORDER BY sort, id', [T(o), o.id]);
  const groupsOf = (o) => db.all('SELECT * FROM telas_room_groups WHERE tenant_id = ? AND office_id = ? ORDER BY sort, id', [T(o), o.id]);
  async function roomOf(o, id, { active = false } = {}) {
    const r = await db.get('SELECT * FROM telas_rooms WHERE id = ? AND tenant_id = ? AND office_id = ?', [idOf(id, 'Sala'), T(o), o.id]);
    if (!r || (active && !Number(r.active))) throw fail(404, 'Sala não encontrada.');
    return r;
  }
  async function groupOf(o, id) {
    const g = await db.get('SELECT * FROM telas_room_groups WHERE id = ? AND tenant_id = ? AND office_id = ?', [idOf(id, 'Grupo'), T(o), o.id]);
    if (!g) throw fail(404, 'Grupo não encontrado.');
    return g;
  }
  /** As filas que a sala atende: as do grupo dela; sem grupo, todas (null). */
  async function servicesForRoom(o, room) {
    if (room.group_id == null) return null;
    const g = await db.get('SELECT services FROM telas_room_groups WHERE id = ? AND tenant_id = ?', [room.group_id, T(o)]);
    const ids = g ? R.servicesOfGroup(g) : [];
    return ids.length ? ids : null;
  }
  const linksOf = async (o) => new Map((await db.all("SELECT kind, ref_id, created_at FROM telas_access WHERE tenant_id = ? AND office_id = ?", [T(o), o.id])).map((r) => [`${r.kind}:${Number(r.ref_id)}`, Number(r.created_at)]));
  const roomDto = (r, links, tickets = new Map()) => ({
    id: Number(r.id), name: r.name, kind: r.kind, kindLabel: roomKindLabel(r.kind), groupId: num(r.group_id), active: Boolean(Number(r.active)),
    state: r.state, stateAt: Number(r.state_at), sort: Number(r.sort) || 0, link: links?.has(`sala:${Number(r.id)}`) ? { on: true, at: links.get(`sala:${Number(r.id)}`) } : { on: false },
    ticket: r.ticket_id != null && tickets.get(Number(r.ticket_id))?.status === 'called' ? { id: Number(r.ticket_id), code: tickets.get(Number(r.ticket_id)).code } : null,
  });
  const groupDto = (g) => ({ id: Number(g.id), name: g.name, serviceIds: R.servicesOfGroup(g), auto: Boolean(Number(g.auto)), sort: Number(g.sort) || 0 });

  /* ---------------------------------------------------------------- a linha do tempo da senha (indicadores) */
  async function event(o, ticketId, kind, { serviceId = null, room = null, risk = null } = {}) {
    await db.run('INSERT INTO telas_queue_events(tenant_id,office_id,ticket_id,day,kind,service_id,room_id,room_kind,risk,at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [T(o), o.id, ticketId, today(), kind, serviceId, room ? room.id : null, room ? room.kind : null, risk, now()]);
  }
  /**
   * A chegada confirmada ("Paciente chegou") de cada senha chamada: id -> a hora, só a confirmação DESTA chamada (a hora
   * do "chegou" é a partir de called_at; quem voltou à fila e foi chamado de novo precisa confirmar de novo).
   */
  async function arrivalsOf(o, called) {
    if (!called.length) return new Map();
    const ids = called.map((t) => Number(t.id));
    const rows = await db.all(`SELECT ticket_id, MAX(at) AS at FROM telas_queue_events WHERE tenant_id = ? AND office_id = ? AND kind = 'arrive' AND ticket_id IN (${ids.map(() => '?').join(',')}) GROUP BY ticket_id`, [T(o), o.id, ...ids]);
    const at = new Map(rows.map((r) => [Number(r.ticket_id), Number(r.at)]));
    const out = new Map();
    for (const t of called) { const a = at.get(Number(t.id)); if (a != null && a >= Number(t.called_at)) out.set(Number(t.id), a); }
    return out;
  }
  /** Para callNext: as filas das etapas do profissional da sala e o nome da etapa de uma fila. */
  async function callRules(o) {
    const flow = (await upaOf(o)).flow;
    const pro = R.proServices(flow);
    if (!pro.length) return { pro, stageName: () => '' };
    const names = new Map((await servicesOf(T(o), o.id)).map((s) => [Number(s.id), s.name]));
    return { pro, stageName: (sid) => R.stageOf(flow, sid, names)?.name || names.get(Number(sid)) || '' };
  }
  /** "Paciente chegou": a confirmação da senha chamada (pela sala ou pelo painel). Entra na linha do tempo, sem dado pessoal. */
  async function arrive(o, tk) {
    needOn(o);
    if (tk.status !== 'called') throw fail(409, 'Esta senha não está chamada agora.');
    if ((await arrivalsOf(o, [tk])).has(Number(tk.id))) throw fail(409, 'A chegada desta senha já foi confirmada.');
    const room = await db.get("SELECT * FROM telas_rooms WHERE tenant_id = ? AND office_id = ? AND ticket_id = ? AND state = 'busy' ORDER BY state_at DESC", [T(o), o.id, tk.id]);
    await event(o, Number(tk.id), 'arrive', { serviceId: Number(tk.service_id), room: room || null, risk: tk.risk || null });
    const t = now();
    return { ticket: { id: Number(tk.id), code: tk.code, status: 'called' }, arrivedAt: t, callState: 'arrived', waitMin: Math.round((t - Number(tk.called_at)) / 6000) / 10 };
  }
  /** Há consultório cadastrado? (a 1ª chamada médica é a do consultório; sem nenhum, é a 1ª chamada). */
  const hasDoctorRooms = async (o) => Boolean(await db.get("SELECT id FROM telas_rooms WHERE tenant_id = ? AND office_id = ? AND kind = 'consultorio'", [T(o), o.id]));
  /** As senhas de hoje que já foram chamadas pelo médico (id -> hora). */
  async function doctorCalls(o, { day = today(), hasDoc = null } = {}) {
    const doc = hasDoc ?? (await hasDoctorRooms(o));
    const rows = doc
      ? await db.all("SELECT ticket_id, MIN(at) AS at FROM telas_queue_events WHERE tenant_id = ? AND office_id = ? AND day = ? AND kind = 'call' AND room_kind = 'consultorio' GROUP BY ticket_id", [T(o), o.id, day])
      : await db.all('SELECT id AS ticket_id, first_called_at AS at FROM telas_queue_tickets WHERE tenant_id = ? AND office_id = ? AND day = ? AND first_called_at IS NOT NULL', [T(o), o.id, day]);
    return new Map(rows.map((r) => [Number(r.ticket_id), Number(r.at)]));
  }

  /* ---------------------------------------------------------------- o que a fila ganha (overview e o estado das telas) */
  /** Os que passaram do tempo-alvo: [{ id, code, risk, overMin }], o mais atrasado primeiro. */
  async function overdueList(o, cfg, waiting, docs = null) {
    if (!cfg.risk) return [];
    const d = docs || (await doctorCalls(o));
    const t = now();
    return waiting.map((w) => ({ id: Number(w.id), code: w.code, risk: w.risk, overMin: R.overdueMin({ status: 'waiting', risk: w.risk, issuedAt: Number(w.issued_at) }, { targets: cfg.targets, now: t, doctorAt: d.get(Number(w.id)) ?? null }) }))
      .filter((x) => x.overMin != null).sort((a, b) => RISK_KEYS.indexOf(a.risk) - RISK_KEYS.indexOf(b.risk) || b.overMin - a.overMin);
  }
  /** A espera estimada por cor (a média das últimas horas, da emissão à 1ª chamada médica). */
  async function estimate(o, upa) {
    const since = now() - upa.estimateHours * 3600_000;
    const doc = await hasDoctorRooms(o);
    const rows = doc
      ? await db.all(`SELECT t.risk, t.issued_at, MIN(e.at) AS at FROM telas_queue_events e JOIN telas_queue_tickets t ON t.id = e.ticket_id AND t.tenant_id = e.tenant_id
          WHERE e.tenant_id = ? AND e.office_id = ? AND e.kind = 'call' AND e.room_kind = 'consultorio' AND e.at >= ? GROUP BY t.id, t.risk, t.issued_at`, [T(o), o.id, since])
      : await db.all('SELECT risk, issued_at, first_called_at AS at FROM telas_queue_tickets WHERE tenant_id = ? AND office_id = ? AND first_called_at >= ?', [T(o), o.id, since]);
    return R.estimateOf(rows.filter((r) => r.risk).map((r) => ({ risk: r.risk, waitMs: Number(r.at) - Number(r.issued_at) })), { text: upa.estimateText, hours: upa.estimateHours });
  }
  /**
   * O que entra no estado das telas (GET /api/telas/queue e o "state" do SSE), sem dados pessoais. Campos novos, só quando
   * valem (a repartição sem a classificação de risco recebe o estado como antes): overdue (quem passou do tempo-alvo: o
   * código da senha, a cor e os minutos acima) e estimate (a espera estimada por cor e os textos).
   */
  async function snapshotExtra(o, cfg, waitingRows) {
    const out = {};
    if (cfg.risk) out.overdue = R.overdueDto(await overdueList(o, cfg, waitingRows));
    const upa = await upaOf(o);
    if (upa.estimate) out.estimate = await estimate(o, upa);
    return out;
  }
  /** Para o overview (Atendimento, Recepção): as etapas, as salas, os grupos e o atraso de cada senha. */
  async function overviewExtra(o, cfg, tickets, services) {
    const [rooms, groups, upa, links, docs, openSupport] = await Promise.all([roomsOf(o), groupsOf(o), upaOf(o), linksOf(o), doctorCalls(o), db.all("SELECT * FROM telas_support WHERE tenant_id = ? AND office_id = ? AND status IN ('open','accepted') ORDER BY id", [T(o), o.id])]);
    const names = new Map(services.map((s) => [Number(s.id), s.name]));
    const late = new Map((await overdueList(o, cfg, tickets.filter((t) => t.status === 'waiting'), docs)).map((x) => [x.id, x.overMin]));
    const byId = new Map(tickets.map((t) => [Number(t.id), t]));
    const arrived = await arrivalsOf(o, tickets.filter((t) => t.status === 'called'));
    return {
      perTicket: (t) => {
        const a = arrived.get(Number(t.id)) ?? null;
        return { overMin: late.get(Number(t.id)) ?? null, stage: R.stageOf(upa.flow, t.service_id ?? t.serviceId, names), arrivedAt: a, callState: R.callStateOf(t, a, upa.confirm) };
      },
      extra: {
        rooms: rooms.map((r) => roomDto(r, links, byId)), groups: groups.map(groupDto),
        upa: { ...upa, supportLink: links.has('apoio:0') ? { on: true, at: links.get('apoio:0') } : { on: false } },
        support: openSupport.map(supportDto),
        overdue: late.size,
      },
    };
  }

  /* ---------------------------------------------------------------- ganchos da fila (chamados por telas-senha.js) */
  /** Chamar numa sala: a sala resolve o nome (o "guichê" na tela) e as filas (as do grupo). */
  async function forCall(o, roomId) {
    const room = await roomOf(o, roomId, { active: true });
    return { room, desk: room.name, serviceIds: await servicesForRoom(o, room) };
  }
  /** Depois da chamada: a sala fica Ocupada com a senha; a chamada entra na linha do tempo. */
  async function called(o, tk, room) {
    if (room) await db.run("UPDATE telas_rooms SET state = 'busy', state_at = ?, ticket_id = ? WHERE id = ? AND tenant_id = ?", [now(), tk.id, room.id, T(o)]);
    await event(o, Number(tk.id), 'call', { serviceId: Number(tk.service_id), room, risk: tk.risk || null });
  }
  /**
   * A senha saiu da sala (finalizada, não compareceu, voltou à fila, encaminhada): a sala volta a Disponível (e, se o
   * grupo distribui sozinho, recebe a próxima). "Não compareceu" entra na linha do tempo com a sala (indicadores).
   */
  async function released(o, ticketId, { status = null, ticket = null } = {}) {
    const rooms = await db.all("SELECT * FROM telas_rooms WHERE tenant_id = ? AND office_id = ? AND ticket_id = ? AND state = 'busy'", [T(o), o.id, ticketId]);
    if (status === 'noshow') await event(o, Number(ticketId), 'noshow', { serviceId: ticket ? Number(ticket.service_id) : null, room: rooms[0] || null, risk: ticket?.risk || null });
    for (const r of rooms) await db.run("UPDATE telas_rooms SET state = 'available', state_at = ?, ticket_id = NULL WHERE id = ? AND tenant_id = ? AND ticket_id = ?", [now(), r.id, T(o), ticketId]);
    if (rooms.length) dispatchSoon(o);
  }
  const triaged = (o, tk, risk, before) => (risk && risk !== before ? event(o, Number(tk.id), 'triage', { serviceId: Number(tk.service_id), risk }) : null);

  /* ---------------------------------------------------------------- modo automático: round robin entre as salas disponíveis */
  const locks = new Map(); // "cliente:repartição" -> a promessa da última distribuição (uma por vez por repartição)
  /**
   * Distribui quem espera entre as salas DISPONÍVEIS dos grupos com o automático ligado: a sala livre há mais tempo
   * primeiro. A sala é reservada antes (só quem a tira de "available" usa) e a senha é tirada de "esperando" pela mesma
   * chamada de sempre (ops.callNext): duas salas nunca levam a mesma senha. Sem ninguém esperando, a sala volta como estava.
   */
  function dispatch(o) {
    const k = `${T(o)}:${Number(o.id)}`;
    const run = (locks.get(k) || Promise.resolve()).then(() => dispatchNow(o)).catch((err) => console.warn('[telas] salas, automático:', err.message));
    locks.set(k, run);
    run.finally(() => { if (locks.get(k) === run) locks.delete(k); });
    return run;
  }
  const dispatchSoon = (o) => { dispatch(o); };
  async function dispatchNow(o) {
    if (!enabledFor(o)) return 0;
    // §31 (20/11): as filas que cada grupo distribui: as das etapas no Automático e, com o automático do grupo, as que não
    // são do profissional da sala
    const flow = (await upaOf(o)).flow;
    const groups = (await groupsOf(o)).map((g) => ({ g, only: R.autoServices(R.servicesOfGroup(g), Boolean(Number(g.auto)), flow) })).filter((x) => x.only.length);
    let n = 0;
    for (const { g, only } of groups) {
      const rooms = R.roundRobin(await db.all('SELECT * FROM telas_rooms WHERE tenant_id = ? AND office_id = ? AND group_id = ?', [T(o), o.id, g.id]));
      for (const room of rooms) {
        const claim = await db.run("UPDATE telas_rooms SET state = 'busy' WHERE id = ? AND tenant_id = ? AND state = 'available'", [room.id, T(o)]);
        if (claim.changes !== 1) continue;
        try {
          await ops.callNext(o, { roomId: room.id }, { by: `automático: ${room.name}`.slice(0, 64), actor: 'auto', only });
          n += 1;
        } catch (err) {
          // ninguém esperando (ou a fila mudou): a sala volta a Disponível com a hora de antes (não perde a vez)
          await db.run("UPDATE telas_rooms SET state = 'available', state_at = ? WHERE id = ? AND tenant_id = ? AND state = 'busy' AND (ticket_id IS NULL OR ticket_id = ?)", [room.state_at, room.id, T(o), room.ticket_id ?? -1]);
          if (![404, 409].includes(err.status)) throw err;
          break; // sem ninguém para este grupo: as outras salas dele também ficariam sem
        }
      }
    }
    return n;
  }
  /**
   * A cada 30 s: as repartições com grupo de salas (cobre a senha que entrou por outro caminho). Todas as que têm grupo,
   * porque o automático também vem da etapa (§31); dispatchNow descarta logo as que não distribuem nada.
   */
  async function tick() {
    const rows = await db.all('SELECT DISTINCT tenant_id, office_id FROM telas_room_groups');
    for (const r of rows) {
      const o = await db.get('SELECT * FROM telas_offices WHERE id = ? AND tenant_id = ?', [r.office_id, r.tenant_id]);
      if (o && (await available(Number(o.tenant_id)).catch(() => false))) await dispatch(o);
    }
  }
  const tickTimer = timers ? setInterval(() => { tick().catch((err) => console.warn('[telas] salas, automático:', err.message)); }, 30_000) : null;
  tickTimer?.unref?.();

  /* ---------------------------------------------------------------- pedidos de apoio */
  const supportDto = (x) => ({
    id: Number(x.id), roomId: num(x.room_id), room: x.room_name, kind: x.kind, status: x.status, statusLabel: SUPPORT_STATUS[x.status] || x.status,
    createdAt: Number(x.created_at), acceptedBy: x.accepted_by || null, acceptedAt: num(x.accepted_at), doneAt: num(x.done_at),
    waitMin: x.accepted_at != null ? Math.round((Number(x.accepted_at) - Number(x.created_at)) / 60000) : null,
  });
  /** Os pedidos de hoje (abertos primeiro) para o painel e o apoio. */
  async function supportList(o) {
    const since = Date.parse(`${today()}T03:00:00Z`);
    const rows = await db.all("SELECT * FROM telas_support WHERE tenant_id = ? AND office_id = ? AND (status IN ('open','accepted') OR created_at >= ?) ORDER BY id DESC LIMIT 100", [T(o), o.id, since]);
    const rank = { open: 0, accepted: 1, done: 2, cancelled: 3 };
    return rows.sort((a, b) => rank[a.status] - rank[b.status] || Number(b.id) - Number(a.id)).map(supportDto);
  }
  async function supportNew(o, room, kind, by) {
    needOn(o);
    const upa = await upaOf(o);
    const k = upa.support.find((x) => x.toLowerCase() === line(kind, L.supportKind).toLowerCase());
    if (!k) throw fail(400, 'Escolha um pedido da lista.');
    const open = await db.get("SELECT id FROM telas_support WHERE tenant_id = ? AND office_id = ? AND room_id = ? AND kind = ? AND status IN ('open','accepted')", [T(o), o.id, room.id, k]);
    if (open) throw fail(409, `Já há um pedido de ${k.toLowerCase()} aberto desta sala.`);
    const n = Number((await db.get("SELECT COUNT(*) AS n FROM telas_support WHERE tenant_id = ? AND office_id = ? AND status IN ('open','accepted')", [T(o), o.id])).n);
    if (n >= 200) throw fail(429, 'Pedidos de apoio demais abertos nesta repartição.');
    const id = await db.insert('INSERT INTO telas_support(tenant_id,office_id,room_id,room_name,kind,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)', [T(o), o.id, room.id, room.name, k, 'open', line(by, 64), now()]);
    return supportDto(await db.get('SELECT * FROM telas_support WHERE id = ?', [id]));
  }
  /** Aceitar, concluir ou cancelar (só o que ainda está aberto; dois cliques no mesmo pedido: só um vale). */
  async function supportMove(o, id, to, who, { roomId = null } = {}) {
    const x = await db.get('SELECT * FROM telas_support WHERE id = ? AND tenant_id = ? AND office_id = ?', [idOf(id, 'Pedido'), T(o), o.id]);
    if (!x || (roomId != null && Number(x.room_id) !== Number(roomId))) throw fail(404, 'Pedido não encontrado.');
    const t = now(); const w = line(who, L.supportWho) || 'apoio';
    let r;
    if (to === 'accepted') r = await db.run("UPDATE telas_support SET status = 'accepted', accepted_by = ?, accepted_at = ? WHERE id = ? AND tenant_id = ? AND status = 'open'", [w, t, x.id, T(o)]);
    else if (to === 'done') r = await db.run("UPDATE telas_support SET status = 'done', done_at = ?, accepted_by = COALESCE(accepted_by, ?), accepted_at = COALESCE(accepted_at, ?) WHERE id = ? AND tenant_id = ? AND status IN ('open','accepted')", [t, w, t, x.id, T(o)]);
    else r = await db.run("UPDATE telas_support SET status = 'cancelled', done_at = ? WHERE id = ? AND tenant_id = ? AND status IN ('open','accepted')", [t, x.id, T(o)]);
    if (r.changes !== 1) throw fail(409, 'Este pedido já mudou (outra pessoa aceitou ou concluiu).');
    return supportDto(await db.get('SELECT * FROM telas_support WHERE id = ?', [x.id]));
  }

  /* ---------------------------------------------------------------- endereços próprios (sala e apoio): só o SHA-256 */
  async function newLink(o, kind, refId, by) {
    const token = C.newToken();
    await db.run('DELETE FROM telas_access WHERE office_id = ? AND tenant_id = ? AND kind = ? AND ref_id = ?', [o.id, T(o), kind, refId]);
    await db.run('INSERT INTO telas_access(tenant_id,office_id,kind,ref_id,token_hash,created_by,created_at) VALUES(?,?,?,?,?,?,?)', [T(o), o.id, kind, refId, sha256(token), line(by, 64), now()]);
    return token;
  }
  const dropLink = (o, kind, refId) => db.run('DELETE FROM telas_access WHERE office_id = ? AND tenant_id = ? AND kind = ? AND ref_id = ?', [o.id, T(o), kind, refId]);

  /* ---------------------------------------------------------------- QR do acompanhante */
  /** Na emissão: o token opaco (aparece só no cupom; no banco, o SHA-256), que vence no fim do dia. */
  async function followFor(o, ticket, req) {
    const upa = await upaOf(o);
    if (!upa.follow || !req) return null;
    const token = C.newToken();
    await db.run('INSERT INTO telas_follow(ticket_id,tenant_id,office_id,token_hash,expires_at) VALUES(?,?,?,?,?)', [ticket.id, T(o), o.id, sha256(token), R.endOfDay(ticket.day)]);
    return `${publicUrl(req)}/senha/${token}`;
  }

  /* ---------------------------------------------------------------- indicadores */
  async function indicators(o, { from, to, by }) {
    const [tickets, calls, events, doc, cfg, rooms] = await Promise.all([
      db.all('SELECT id, day, issued_at, first_called_at, called_at, done_at, status, risk FROM telas_queue_tickets WHERE tenant_id = ? AND office_id = ? AND day >= ? AND day <= ?', [T(o), o.id, from, to]),
      db.all('SELECT ticket_id, desk, at FROM telas_queue_calls WHERE tenant_id = ? AND office_id = ? AND day >= ? AND day <= ?', [T(o), o.id, from, to]),
      db.all("SELECT ticket_id, kind, room_id, room_kind, at FROM telas_queue_events WHERE tenant_id = ? AND office_id = ? AND day >= ? AND day <= ? AND kind IN ('triage','call','arrive','noshow')", [T(o), o.id, from, to]),
      hasDoctorRooms(o), queueOf(o), roomsOf(o),
    ]);
    const roomNames = new Map(rooms.map((r) => [Number(r.id), r.name]));
    return { from, to, ...R.indicatorsOf({ tickets, calls, events, targets: cfg.targets, by, hasDoctorRooms: doc, roomNames }), doctorRooms: doc };
  }

  /* ---------------------------------------------------------------- as rotas de <base> (o link e o painel) */
  /**
   * reg(method, sub, fn) como em telas-senha.js. desk: true = o atendente também alcança (DESK_OPS); o resto é do gestor.
   */
  function operations(reg) {
    const desk = new Set();
    const r = (method, sub, fn, d = false) => { if (d) desk.add(`${method} ${sub}`); reg(method, sub, fn); };
    r('get', '/rooms', async ({ o }) => {
      const [rooms, groups, upa, links, services] = await Promise.all([roomsOf(o), groupsOf(o), upaOf(o), linksOf(o), servicesOf(T(o), o.id)]);
      const tk = new Map((await db.all("SELECT id, code, status FROM telas_queue_tickets WHERE tenant_id = ? AND office_id = ? AND day = ? AND status = 'called'", [T(o), o.id, today()])).map((t) => [Number(t.id), t]));
      return { body: { rooms: rooms.map((x) => roomDto(x, links, tk)), groups: groups.map(groupDto), upa: { ...upa, supportLink: links.has('apoio:0') ? { on: true, at: links.get('apoio:0') } : { on: false } }, services: services.map((s) => ({ id: Number(s.id), name: s.name, active: Boolean(s.active) })) } };
    }, true);
    r('post', '/rooms', async ({ o, body }) => {
      needOn(o);
      const all = await roomsOf(o);
      if (all.length >= L.rooms) throw fail(409, `Limite de ${L.rooms} salas por repartição.`);
      const x = R.cleanRoom(body, null, (await groupsOf(o)).map((g) => Number(g.id)));
      if (all.some((y) => y.name.toLowerCase() === x.name.toLowerCase())) throw fail(409, `Já há uma sala "${x.name}".`);
      const id = await db.insert('INSERT INTO telas_rooms(tenant_id,office_id,name,kind,group_id,active,state,state_at,sort,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', [T(o), o.id, x.name, x.kind, x.groupId, x.active, 'available', now(), x.sort, now()]);
      dispatchSoon(o);
      return { status: 201, body: roomDto(await db.get('SELECT * FROM telas_rooms WHERE id = ?', [id])), log: `prefeitura: sala "${x.name}" (${roomKindLabel(x.kind)}) criada em "${o.name}"` };
    });
    r('patch', '/rooms/:rid', async ({ o, body, params }) => {
      const cur = await roomOf(o, params.rid);
      const x = R.cleanRoom(body, cur, (await groupsOf(o)).map((g) => Number(g.id)));
      if ((await roomsOf(o)).some((y) => Number(y.id) !== Number(cur.id) && y.name.toLowerCase() === x.name.toLowerCase())) throw fail(409, `Já há uma sala "${x.name}".`);
      await db.run('UPDATE telas_rooms SET name = ?, kind = ?, group_id = ?, active = ?, sort = ? WHERE id = ? AND tenant_id = ?', [x.name, x.kind, x.groupId, x.active, x.sort, cur.id, T(o)]);
      dispatchSoon(o);
      return { body: roomDto(await db.get('SELECT * FROM telas_rooms WHERE id = ?', [cur.id])), log: `prefeitura: sala "${x.name}" de "${o.name}" alterada` };
    });
    r('delete', '/rooms/:rid', async ({ o, params }) => {
      const cur = await roomOf(o, params.rid);
      await db.run('DELETE FROM telas_rooms WHERE id = ? AND tenant_id = ?', [cur.id, T(o)]);
      await dropLink(o, 'sala', Number(cur.id));
      return { body: { ok: true }, log: `prefeitura: sala "${cur.name}" de "${o.name}" removida (o endereço dela deixou de valer)` };
    });
    r('post', '/rooms/:rid/state', async ({ o, params, body }) => ({ body: await setState(o, await roomOf(o, params.rid, { active: true }), body?.state) }), true);
    // o endereço da sala: aparece UMA vez (só o hash fica); gerar de novo derruba o anterior
    r('post', '/rooms/:rid/link', async ({ o, params, req, by }) => {
      needOn(o);
      const cur = await roomOf(o, params.rid);
      const token = await newLink(o, 'sala', Number(cur.id), by);
      return { status: 201, body: { url: `${publicUrl(req)}/reparticao/${token}/sala` }, log: `prefeitura: endereço da sala "${cur.name}" de "${o.name}" gerado (o anterior deixou de valer)`, noStore: true };
    });
    r('delete', '/rooms/:rid/link', async ({ o, params }) => {
      const cur = await roomOf(o, params.rid);
      await dropLink(o, 'sala', Number(cur.id));
      return { body: { ok: true }, log: `prefeitura: endereço da sala "${cur.name}" de "${o.name}" revogado` };
    });
    r('post', '/room-groups', async ({ o, body }) => {
      needOn(o);
      if ((await groupsOf(o)).length >= L.groups) throw fail(409, `Limite de ${L.groups} grupos por repartição.`);
      const g = R.cleanGroup(body, null, (await servicesOf(T(o), o.id)).map((s) => Number(s.id)));
      const id = await db.insert('INSERT INTO telas_room_groups(tenant_id,office_id,name,services,auto,sort,created_at) VALUES(?,?,?,?,?,?,?)', [T(o), o.id, g.name, JSON.stringify(g.services), g.auto, g.sort, now()]);
      dispatchSoon(o);
      return { status: 201, body: groupDto(await db.get('SELECT * FROM telas_room_groups WHERE id = ?', [id])), log: `prefeitura: grupo de salas "${g.name}" criado em "${o.name}"${g.auto ? ' (automático)' : ''}` };
    });
    r('patch', '/room-groups/:gid', async ({ o, body, params }) => {
      const cur = await groupOf(o, params.gid);
      const g = R.cleanGroup(body, cur, (await servicesOf(T(o), o.id)).map((s) => Number(s.id)));
      await db.run('UPDATE telas_room_groups SET name = ?, services = ?, auto = ?, sort = ? WHERE id = ? AND tenant_id = ?', [g.name, JSON.stringify(g.services), g.auto, g.sort, cur.id, T(o)]);
      dispatchSoon(o);
      return { body: groupDto({ ...cur, name: g.name, services: JSON.stringify(g.services), auto: g.auto, sort: g.sort }), log: `prefeitura: grupo de salas "${g.name}" de "${o.name}" alterado${g.auto ? ' (automático ligado)' : ''}` };
    });
    r('delete', '/room-groups/:gid', async ({ o, params }) => {
      const cur = await groupOf(o, params.gid);
      await db.run('UPDATE telas_rooms SET group_id = NULL WHERE group_id = ? AND tenant_id = ? AND office_id = ?', [cur.id, T(o), o.id]);
      await db.run('DELETE FROM telas_room_groups WHERE id = ? AND tenant_id = ?', [cur.id, T(o)]);
      return { body: { ok: true }, log: `prefeitura: grupo de salas "${cur.name}" de "${o.name}" removido (as salas ficaram sem grupo)` };
    });
    r('put', '/upa', async ({ o, body }) => {
      const x = await extrasOf(T(o), Number(o.id));
      const services = await servicesOf(T(o), o.id);
      const upa = R.cleanUpaConfig(body, x.data.upa, o.type, services.map((s) => Number(s.id)));
      // "Tudo pela recepção" também desliga o automático dos grupos (nada é chamado sozinho); antes de gravar as etapas
      if (body?.preset === 'recepcao') await db.run('UPDATE telas_room_groups SET auto = 0 WHERE tenant_id = ? AND office_id = ?', [T(o), o.id]);
      await saveExtras(T(o), Number(o.id), { data: { ...x.data, upa } });
      await changed(o, await queueOf(o));
      dispatchSoon(o);
      const [groups, rooms] = await Promise.all([groupsOf(o), roomsOf(o)]);
      const warnings = R.flowWarnings(upa.flow, groups, rooms, new Map(services.map((s) => [Number(s.id), s.name])));
      const modes = upa.flow.map((s) => `${s.name || services.find((y) => Number(y.id) === s.serviceId)?.name || '?'}: ${stageModeLabel(s.mode)}`).join(', ');
      const preset = body?.preset === 'recepcao' ? ' — atalho "Tudo pela recepção"' : body?.preset === 'profissionais' ? ' — atalho "Profissionais chamam"' : '';
      return { body: { upa, warnings }, log: `prefeitura: etapas, apoio, QR do acompanhante e espera estimada de "${o.name}" configurados (${upa.flow.length} etapas${modes ? ` [${modes}]` : ''}${preset}; confirmação de chegada ${upa.confirm ? 'exigida' : 'opcional'}; QR ${upa.follow ? 'ligado' : 'desligado'}${upa.follow && upa.followRisk ? ' com a cor' : ''}; espera estimada ${upa.estimate ? 'ligada' : 'desligada'})` };
    });
    // "Paciente chegou" pelo painel (a sala sem celular; a recepção confirma)
    r('post', '/tickets/:tid/arrive', async ({ o, params }) => ({ body: await arrive(o, await ticketOf(o, params.tid)) }), true);
    r('post', '/tickets/:tid/next-stage', async ({ o, params }) => {
      const tk = await ticketOf(o, params.tid);
      const services = await servicesOf(T(o), o.id);
      const st = R.stageOf((await upaOf(o)).flow, tk.service_id, new Map(services.map((s) => [Number(s.id), s.name])));
      if (!st) throw fail(409, 'Esta senha não está numa etapa do fluxo (configure as etapas em Salas e consultórios).');
      if (!st.next) throw fail(409, 'Esta já é a última etapa: finalize o atendimento.');
      const out = await ops.forward(o, tk.id, { serviceId: st.next.serviceId });
      return { body: { ...out, stage: st.next.name } };
    }, true);
    // pedidos de apoio: o painel vê, aceita, conclui e cancela; o gestor gera o endereço do apoio
    r('get', '/support', async ({ o }) => ({ body: { requests: await supportList(o), kinds: (await upaOf(o)).support } }), true);
    for (const [sub, to] of [['accept', 'accepted'], ['done', 'done'], ['cancel', 'cancelled']]) {
      r('post', `/support/:sid/${sub}`, async ({ o, params, by }) => ({ body: await supportMove(o, params.sid, to, by) }), true);
    }
    r('post', '/support-link', async ({ o, req, by }) => {
      needOn(o);
      const token = await newLink(o, 'apoio', 0, by);
      return { status: 201, body: { url: `${publicUrl(req)}/reparticao/${token}/apoio` }, log: `prefeitura: endereço do apoio de "${o.name}" gerado (o anterior deixou de valer)`, noStore: true };
    });
    r('delete', '/support-link', async ({ o }) => { await dropLink(o, 'apoio', 0); return { body: { ok: true }, log: `prefeitura: endereço do apoio de "${o.name}" revogado` }; });
    r('get', '/indicators', async ({ o, req }) => {
      const t = today();
      const to = S.cleanDay(req.query.to) || t;
      let from = S.cleanDay(req.query.from) || S.addDays(to, -6);
      if (from > to) throw fail(400, 'Indicadores: o primeiro dia vem depois do último.');
      if (from < S.addDays(t, -90)) from = S.addDays(t, -90); // o histórico é de 90 dias
      const by = R.PERIODS.includes(req.query.by) ? req.query.by : 'day';
      const ind = await indicators(o, { from, to, by });
      if (req.query.format === 'csv') return { csv: R.indicatorsCsv(ind, { office: o.name, from, to }), filename: `indicadores-${from}-a-${to}.csv`, log: `prefeitura: indicadores de "${o.name}" exportados (${from} a ${to})` };
      return { body: ind };
    });
    return desk;
  }
  /** Disponível ou Pausa (Ocupada é o sistema que põe, ao chamar). Disponível com gente esperando: o automático chama. */
  async function setState(o, room, state) {
    if (!['available', 'pause'].includes(state)) throw fail(400, 'Situação da sala: Disponível ou Pausa.');
    await db.run('UPDATE telas_rooms SET state = ?, state_at = ? WHERE id = ? AND tenant_id = ?', [state, now(), room.id, T(o)]);
    if (state === 'available') await dispatch(o);
    const r = await db.get('SELECT * FROM telas_rooms WHERE id = ?', [room.id]);
    return { room: { id: Number(r.id), name: r.name, state: r.state, stateAt: Number(r.state_at) } };
  }

  /* ---------------------------------------------------------------- as páginas sem login: sala, apoio e acompanhante */
  const noStore = (res) => res.set('Cache-Control', 'no-store');
  function mountPages(app, { headers }) {
    const page = (file, type) => (_req, res) => { res.set({ ...headers, 'Content-Type': type }).sendFile(path.join(PAGE, file)); };
    for (const f of ['sala.js', 'sala.css', 'apoio.js', 'acompanhar.js', 'acompanhar.css']) app.get(`/reparticao/${f}`, page(f, f.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8'));
    app.get('/reparticao/:token([A-Za-z0-9_-]{32,64})/sala', page('sala.html', 'text/html; charset=utf-8'));
    app.get('/reparticao/:token([A-Za-z0-9_-]{32,64})/apoio', page('apoio.html', 'text/html; charset=utf-8'));
    app.get('/senha/:token([A-Za-z0-9_-]{32,64})', page('acompanhar.html', 'text/html; charset=utf-8'));

    const perOffice = createLimiter({ windowMs: 60_000, max: Number(process.env.TELAS_SALA_PER_MIN) || 240, maxKeys: 50_000 });
    const perIp = createLimiter({ windowMs: 60_000, max: Number(process.env.TELAS_SALA_PER_IP_MIN) || 240, maxKeys: 100_000 });
    /** Token de uma sala (ou do apoio) -> a repartição e a sala. O mesmo 401 para token inexistente, revogado, sala
     *  desativada, módulo ou modo desligados. */
    const access = (kind, gone) => ah(async (req, res, next) => {
      noStore(res);
      const tok = /^Bearer ([A-Za-z0-9_-]{32,64})$/.exec(req.get('authorization') || '')?.[1];
      const x = tok ? await db.get('SELECT * FROM telas_access WHERE token_hash = ? AND kind = ?', [sha256(tok), kind]) : null;
      const o = x ? await db.get('SELECT * FROM telas_offices WHERE id = ? AND tenant_id = ?', [x.office_id, x.tenant_id]) : null;
      const room = o && kind === 'sala' ? await db.get('SELECT * FROM telas_rooms WHERE id = ? AND tenant_id = ? AND office_id = ? AND active = 1', [x.ref_id, x.tenant_id, o.id]) : null;
      if (!o || (kind === 'sala' && !room) || !enabledFor(o) || !(await available(Number(o.tenant_id)))) return res.status(401).json({ error: gone });
      if (!perOffice.hit(`${kind}:${o.id}`) || !perIp.hit(ipKey(ipOf(req) || '-'))) return res.status(429).json({ error: 'Muitos pedidos em pouco tempo. Aguarde um instante.' });
      req.office = o; req.room = room; req.tenantId = Number(o.tenant_id);
      next();
    });
    const sala = access('sala', 'Endereço da sala desligado. Peça um endereço novo ao responsável da repartição.');
    const apoio = access('apoio', 'Endereço do apoio desligado. Peça um endereço novo ao responsável da repartição.');
    const byRoom = (room) => `sala: ${room.name}`.slice(0, 64);

    /** O que a sala vê: ela, a senha dela (com o nome reduzido, se houver), quem espera nas filas do grupo (sem nomes). */
    app.get('/api/sala', sala, ah(async (req, res) => {
      const o = req.office; const room = req.room; const cfg = await queueOf(o); const upa = await upaOf(o);
      const ids = await servicesForRoom(o, room);
      const services = await servicesOf(T(o), o.id); const names = new Map(services.map((s) => [Number(s.id), s.name]));
      const day = today();
      const all = await db.all("SELECT * FROM telas_queue_tickets WHERE tenant_id = ? AND office_id = ? AND day = ? AND status IN ('waiting','called')", [T(o), o.id, day]);
      const calls = await db.all('SELECT priority, risk FROM telas_queue_calls WHERE tenant_id = ? AND office_id = ? AND day = ? ORDER BY id DESC LIMIT 30', [T(o), o.id, day]);
      const waiting = all.filter((t) => t.status === 'waiting' && (!ids || ids.includes(Number(t.service_id))));
      const ranked = S.rankQueue(waiting.map((t) => ({ id: Number(t.id), priority: Number(t.priority) || 0, risk: t.risk || null, queuedAt: Number(t.queued_at), issuedAt: Number(t.issued_at) })),
        { ratio: cfg.ratio, useRisk: cfg.risk, targets: cfg.targets, ageBoost: cfg.ageBoost, escalate: cfg.escalate, now: now(), sinceP: S.sinceLastPriority(calls.filter((c) => !(cfg.risk && c.risk))) });
      const late = new Map((await overdueList(o, cfg, waiting)).map((x) => [x.id, x.overMin]));
      const byId = new Map(all.map((t) => [Number(t.id), t]));
      const cur = room.ticket_id != null ? byId.get(Number(room.ticket_id)) : null;
      const mine = cur && cur.status === 'called' ? cur : null;
      const st = mine ? R.stageOf(upa.flow, mine.service_id, names) : null;
      const arrivedAt = mine ? (await arrivalsOf(o, [mine])).get(Number(mine.id)) ?? null : null;
      const lastCall = mine ? await db.get('SELECT repeats, shown_at FROM telas_queue_calls WHERE tenant_id = ? AND office_id = ? AND ticket_id = ? ORDER BY id DESC LIMIT 1', [T(o), o.id, mine.id]) : null;
      res.json({
        serverTime: now(), office: o.name, title: cfg.title, risk: cfg.risk, targets: cfg.targets, confirm: upa.confirm,
        room: { id: Number(room.id), name: room.name, kind: room.kind, kindLabel: roomKindLabel(room.kind), state: room.state, stateAt: Number(room.state_at) },
        current: mine ? {
          id: Number(mine.id), code: mine.code, service: names.get(Number(mine.service_id)) || '', serviceId: Number(mine.service_id), priority: Number(mine.priority) || 0, risk: cfg.risk ? mine.risk || null : null, name: mine.name || null, calledAt: num(mine.called_at), stage: st,
          arrivedAt, callState: R.callStateOf(mine, arrivedAt, upa.confirm), repeats: Number(lastCall?.repeats) || 0, shownAt: num(lastCall?.shown_at),
        } : null,
        waiting: waiting.length,
        queue: ranked.slice(0, 30).map((x) => { const t = byId.get(x.t.id); return { id: Number(t.id), code: t.code, service: names.get(Number(t.service_id)) || '', priority: Number(t.priority) || 0, risk: cfg.risk ? t.risk || null : null, issuedAt: Number(t.issued_at), overMin: late.get(Number(t.id)) ?? null, reason: x.reason }; }),
        forward: services.filter((s) => s.active && (!mine || Number(s.id) !== Number(mine.service_id))).map((s) => ({ id: Number(s.id), name: s.name })),
        support: { kinds: upa.support, mine: (await db.all("SELECT * FROM telas_support WHERE tenant_id = ? AND office_id = ? AND room_id = ? AND (status IN ('open','accepted') OR created_at >= ?) ORDER BY id DESC LIMIT 10", [T(o), o.id, room.id, now() - 3600_000])).map(supportDto) },
      });
    }));
    app.post('/api/sala/call', sala, ah(async (req, res) => {
      // um paciente por vez na sala: o de agora sai (Finalizar, Encaminhar, Não compareceu, Voltar à fila) antes do próximo
      const cur = await db.get('SELECT ticket_id FROM telas_rooms WHERE id = ? AND tenant_id = ?', [req.room.id, req.tenantId]);
      if (cur?.ticket_id != null && (await db.get("SELECT id FROM telas_queue_tickets WHERE id = ? AND tenant_id = ? AND status = 'called'", [cur.ticket_id, req.tenantId]))) throw fail(409, 'Há um paciente nesta sala. Finalize ou encaminhe antes de chamar o próximo.');
      const out = await ops.callNext(req.office, { roomId: req.room.id }, { by: byRoom(req.room), actor: 'sala' });
      res.json(out);
    }));
    /** As ações na senha DESTA sala (a última chamada nela e ainda em atendimento): nada de id de outra senha. */
    const mineOf = async (req) => {
      const r = await db.get('SELECT ticket_id FROM telas_rooms WHERE id = ? AND tenant_id = ?', [req.room.id, req.tenantId]);
      const t = r?.ticket_id != null ? await db.get("SELECT * FROM telas_queue_tickets WHERE id = ? AND tenant_id = ? AND office_id = ? AND status = 'called'", [r.ticket_id, req.tenantId, req.office.id]) : null;
      if (!t) throw fail(409, 'Nenhum paciente em atendimento nesta sala.');
      return t;
    };
    const onMine = (sub, fn) => app.post(`/api/sala/${sub}`, sala, ah(async (req, res) => res.json(await fn(req.office, await mineOf(req), req.body || {}))));
    /** Com a confirmação exigida (§31), Finalizar e Encaminhar só depois do "Paciente chegou". */
    const needArrived = async (o, t) => {
      if (!(await upaOf(o)).confirm) return;
      if (!(await arrivalsOf(o, [t])).has(Number(t.id))) throw fail(409, 'Primeiro confirme a chegada (Paciente chegou) ou marque Não compareceu.');
    };
    onMine('arrive', (o, t) => arrive(o, t));
    onMine('repeat', (o, t) => ops.repeat(o, t.id));
    onMine('finish', async (o, t) => { await needArrived(o, t); return ops.close(o, t.id, 'done'); });
    onMine('noshow', (o, t) => ops.close(o, t.id, 'noshow'));
    onMine('requeue', (o, t) => ops.requeue(o, t.id));
    onMine('forward', async (o, t, b) => {
      await needArrived(o, t);
      if (b.next) {
        const services = await servicesOf(T(o), o.id);
        const st = R.stageOf((await upaOf(o)).flow, t.service_id, new Map(services.map((s) => [Number(s.id), s.name])));
        if (!st?.next) throw fail(409, 'Não há próxima etapa para esta senha.');
        return { ...(await ops.forward(o, t.id, { serviceId: st.next.serviceId })), stage: st.next.name };
      }
      return ops.forward(o, t.id, { serviceId: b.serviceId });
    });
    app.post('/api/sala/state', sala, ah(async (req, res) => res.json(await setState(req.office, req.room, req.body?.state))));
    // Reavaliar: a sala reclassifica a cor de quem espera nas filas dela e passou do tempo-alvo (nada mais da triagem)
    app.post('/api/sala/tickets/:id/risk', sala, ah(async (req, res) => {
      const o = req.office; const cfg = await queueOf(o);
      if (!cfg.risk) throw fail(400, 'Esta repartição não usa a classificação de risco.');
      const tk = await ticketOf(o, req.params.id);
      const ids = await servicesForRoom(o, req.room);
      if (tk.status !== 'waiting' || (ids && !ids.includes(Number(tk.service_id)))) throw fail(409, 'Só dá para reavaliar quem espera nas filas desta sala.');
      if (!(await overdueList(o, cfg, [tk])).length) throw fail(409, 'Esta senha ainda está dentro do tempo-alvo.');
      const out = await ops.triage(o, tk.id, { risk: S.cleanRisk(req.body?.risk) }, { by: byRoom(req.room) });
      res.json(out);
    }));
    app.post('/api/sala/support', sala, ah(async (req, res) => res.status(201).json(await supportNew(req.office, req.room, req.body?.kind, byRoom(req.room)))));
    app.post('/api/sala/support/:sid/cancel', sala, ah(async (req, res) => res.json(await supportMove(req.office, req.params.sid, 'cancelled', byRoom(req.room), { roomId: req.room.id }))));

    /* o apoio: vê os pedidos de hoje, aceita e conclui (o nome de quem aceitou é o que a pessoa escreveu no celular) */
    app.get('/api/apoio', apoio, ah(async (req, res) => res.json({ serverTime: now(), office: req.office.name, requests: await supportList(req.office) })));
    app.post('/api/apoio/:sid/accept', apoio, ah(async (req, res) => res.json(await supportMove(req.office, req.params.sid, 'accepted', req.body?.who))));
    app.post('/api/apoio/:sid/done', apoio, ah(async (req, res) => res.json(await supportMove(req.office, req.params.sid, 'done', req.body?.who))));

    /* o acompanhante: o QR do cupom. Sem nome, sem queixa; a cor só com "mostrar a cor" ligado; vence no fim do dia */
    const followIp = createLimiter({ windowMs: 60_000, max: Number(process.env.TELAS_FOLLOW_PER_IP_MIN) || 60, maxKeys: 100_000 });
    app.get('/api/acompanhar', ah(async (req, res) => {
      noStore(res); res.set('X-Robots-Tag', 'noindex, nofollow');
      if (!followIp.hit(ipKey(ipOf(req) || '-'))) return res.status(429).json({ error: 'Muitos pedidos em pouco tempo. Aguarde um instante.' });
      const GONE = 'Este acompanhamento terminou (ele vale só no dia da senha).';
      const tok = /^Bearer ([A-Za-z0-9_-]{32,64})$/.exec(req.get('authorization') || '')?.[1];
      const f = tok ? await db.get('SELECT * FROM telas_follow WHERE token_hash = ?', [sha256(tok)]) : null;
      const o = f && Number(f.expires_at) > now() ? await db.get('SELECT * FROM telas_offices WHERE id = ? AND tenant_id = ?', [f.office_id, f.tenant_id]) : null;
      const t = o ? await db.get('SELECT * FROM telas_queue_tickets WHERE id = ? AND tenant_id = ? AND office_id = ?', [f.ticket_id, f.tenant_id, o.id]) : null;
      if (!o || !t || !enabledFor(o) || !(await available(Number(o.tenant_id)))) return res.status(401).json({ error: GONE });
      res.json(await followView(o, t));
    }));
  }
  /** A página do acompanhante: a posição aproximada, a etapa e "foi chamada: Consultório 3". Nunca o nome nem a queixa. */
  async function followView(o, t) {
    const cfg = await queueOf(o); const upa = await upaOf(o);
    const services = await servicesOf(T(o), o.id); const names = new Map(services.map((s) => [Number(s.id), s.name]));
    const st = R.stageOf(upa.flow, t.service_id, names);
    let ahead = null;
    if (t.status === 'waiting') {
      const day = t.day;
      const [waiting, calls] = await Promise.all([
        db.all("SELECT id, priority, risk, queued_at, issued_at FROM telas_queue_tickets WHERE tenant_id = ? AND office_id = ? AND day = ? AND status = 'waiting' AND service_id = ?", [T(o), o.id, day, t.service_id]),
        db.all('SELECT priority, risk FROM telas_queue_calls WHERE tenant_id = ? AND office_id = ? AND day = ? AND service_id = ? ORDER BY id DESC LIMIT 30', [T(o), o.id, day, t.service_id]),
      ]);
      const ranked = S.rankQueue(waiting.map((w) => ({ id: Number(w.id), priority: Number(w.priority) || 0, risk: w.risk || null, queuedAt: Number(w.queued_at), issuedAt: Number(w.issued_at) })),
        { ratio: cfg.ratio, useRisk: cfg.risk, targets: cfg.targets, ageBoost: cfg.ageBoost, escalate: cfg.escalate, now: now(), sinceP: S.sinceLastPriority(calls.filter((c) => !(cfg.risk && c.risk))) });
      ahead = Math.max(0, ranked.findIndex((x) => x.t.id === Number(t.id)));
    }
    const STATUS = { waiting: 'Aguardando a chamada', called: 'Chamada', done: 'Atendimento concluído', noshow: 'Não compareceu à chamada', cancelled: 'Senha cancelada', expired: 'Senha encerrada' };
    const est = t.status === 'waiting' && upa.estimate ? await estimate(o, upa) : null;
    return {
      serverTime: now(), office: o.name, code: t.code, status: t.status, statusLabel: STATUS[t.status] || t.status,
      stage: st ? { name: st.name, index: st.index, total: st.total } : { name: names.get(Number(t.service_id)) || '', index: null, total: null },
      position: R.positionText(ahead), ahead,
      calledTo: t.status === 'called' ? t.desk || null : null, calledAt: t.status === 'called' ? num(t.called_at) : null,
      risk: upa.followRisk && cfg.risk && RISK_KEYS.includes(t.risk) ? t.risk : null,
      estimate: est && (est.light || est.text) ? { light: est.light, text: est.text } : null,
    };
  }

  /* ---------------------------------------------------------------- a TV box: os pedidos abertos (para as telas internas) */
  function mountDevice(app, { device, officeOfDev }) {
    app.get('/api/telas/support', device, ah(async (req, res) => {
      const o = officeOfDev(req.dev);
      if (!enabledFor(o)) return res.json({ requests: [] });
      const rows = await db.all("SELECT * FROM telas_support WHERE tenant_id = ? AND office_id = ? AND status IN ('open','accepted') ORDER BY id LIMIT 50", [T(o), o.id]);
      res.json({ serverTime: now(), requests: rows.map((x) => ({ id: Number(x.id), room: x.room_name, kind: x.kind, status: x.status, at: Number(x.created_at), acceptedAt: num(x.accepted_at) })) });
    }));
  }

  /* ---------------------------------------------------------------- limpeza e exclusão */
  async function prune(t = now()) {
    await db.run('DELETE FROM telas_queue_events WHERE at < ?', [t - KEEP_MS]);
    await db.run('DELETE FROM telas_support WHERE created_at < ?', [t - KEEP_MS]);
    await db.run('DELETE FROM telas_follow WHERE expires_at < ?', [t]);
    // o dia acabou: a sala que ficou Ocupada com a senha de ontem volta a Disponível
    await db.run("UPDATE telas_rooms SET state = 'available', state_at = ?, ticket_id = NULL WHERE state = 'busy' AND ticket_id IN (SELECT id FROM telas_queue_tickets WHERE status NOT IN ('called'))", [t]);
  }
  async function dropOffice(x, tenantId, officeId) {
    for (const tb of ['telas_rooms', 'telas_room_groups', 'telas_access', 'telas_support', 'telas_queue_events', 'telas_follow']) await x.run(`DELETE FROM ${tb} WHERE office_id = ? AND tenant_id = ?`, [officeId, tenantId]);
  }

  return {
    operations, mountPages, mountDevice, prune, dropOffice, forCall, called, released, triaged, followFor, snapshotExtra, overviewExtra, dispatch, upaOf, callRules, arrive,
    stop() { clearInterval(tickTimer); },
  };
}
