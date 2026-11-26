/* NEXA Telas, chamada de senha (docs/TELAS.md §10; contrato telas-contrato.md §7.2). As regras sem banco ficam em
   telas-senha-core.js; aqui, o banco, o tempo real e as rotas. Quatro portas, cada uma com a credencial dela:

   A TV box (token do aparelho; só a fila da repartição DELE)
     GET  /api/telas/queue                 a senha atual, as últimas e quem espera
     GET  /api/telas/queue/stream          text/event-stream: call, state e ": ping" a cada 20 s

   A página de controle da repartição (sessão do link) e o Painel da Prefeitura (prefeitura.manage), as mesmas operações:
     <base>                                GET o resumo (filas, configuração, quem espera, quem está sendo atendido, totem)
     <base>/config                         PUT título, voz, mostrar o nome, intercalação, impressão no totem, risco
     <base>/services[/:sid]                POST, PATCH, DELETE as filas (nome, letra, prioridade)
     <base>/totem                          POST gera o endereço do totem (aparece uma vez) · DELETE desliga
     <base>/tickets                        POST emite a senha (recepção)
     <base>/call                           POST chamar a próxima (de uma fila, se pedida) para um guichê
     <base>/tickets/:tid/repeat|forward|noshow|finish|risk|cancel|priority
                                           (priority: normal, preferencial/60+ ou 80+ de quem espera; o código não muda)
     <base>/call com { ticketId }          "Chamar esta": aquela senha, fora da ordem (no log da repartição)
   com <base> = /api/reparticao/queue (o link) ou /api/prefeitura/offices/:id/queue (o painel).
     GET  /api/prefeitura/queue/report     senhas, espera e atendimento por repartição, fila e dia (JSON ou CSV)

   O totem (/reparticao/<token do totem>/totem; token próprio, que SÓ emite senha)
     GET  /api/totem                       a repartição e as filas (Authorization: Bearer <token do totem>)
     POST /api/totem/tickets               emite a senha (freio por repartição e por IP)

   O cliente e a repartição vêm sempre da credencial. O nome da pessoa só entra já reduzido (primeiro nome + inicial) e o
   motivo do atendimento não existe em campo nenhum. */
import path from 'node:path';
import { db } from './db.js';
import { config } from './config.js';
import { createLimiter, ipKey } from './ratelimit.js';
import * as C from './telas-core.js';
import * as S from './telas-senha-core.js';
import { createSalas } from './telas-salas.js'; // salas e consultórios, etapas, apoio, QR do acompanhante, indicadores (§26 a §31)
import { officeModules, LIMITS, RISK_KEYS, typeLabel } from '../public/shared/telas-tipos.js';

const { fail, line, idOf, sha256 } = C;
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const j = C.parseJson;
const num = (v) => (v == null ? null : Number(v));
const PAGE = path.join(config.root, 'public', 'reparticao');
export const PING_MS = 20_000;
export const STREAMS_PER_DEVICE = 2;
export const KEEP_DAYS = 90;

const serviceDto = (s) => ({ id: Number(s.id), name: s.name, prefix: s.prefix, priority: Boolean(s.priority), sort: Number(s.sort) || 0, active: Boolean(s.active) });
const ticketDto = (t) => ({
  id: Number(t.id), code: t.code, serviceId: Number(t.service_id), priority: Number(t.priority) || 0, risk: t.risk || null, name: t.name || null, status: t.status, desk: t.desk || null,
  origin: t.origin, issuedAt: Number(t.issued_at), queuedAt: Number(t.queued_at), calledAt: num(t.called_at),
});
const waitingOf = (rows) => rows.map((t) => ({ id: Number(t.id), priority: Number(t.priority) || 0, risk: t.risk || null, queuedAt: Number(t.queued_at), issuedAt: num(t.issued_at) }));
const PRIO_WORD = ['normal', 'preferencial (60+)', '80 anos ou mais'];

/**
 * deps: available(tenantId) (o modo prefeitura vale?), audit(entry), ipOf(req), publicUrl(req), now(), timers.
 */
export function createSenha({ available, audit = async () => {}, ipOf = (req) => req.ip, publicUrl, now = () => Date.now(), timers = true, pingMs = PING_MS }) {
  const today = () => S.localDay(now()).day;
  /** As opções da ordem de chamada (S.rankQueue): a configuração da repartição e as chamadas do dia (a mais nova primeiro). */
  const rankOpts = (cfg, calls) => ({ ratio: cfg.ratio, useRisk: cfg.risk, targets: cfg.targets, ageBoost: cfg.ageBoost, escalate: cfg.escalate, now: now(), sinceP: S.sinceLastPriority(calls.filter((c) => !(cfg.risk && c.risk))) });
  const enabledFor = (o) => Boolean(officeModules(o.type, j(o.modules, {})).senha);

  /* ---------------------------------------------------------------- o que a repartição ganhou depois (telas_office_extras) */
  async function extrasOf(tenantId, officeId) {
    const r = await db.get('SELECT * FROM telas_office_extras WHERE office_id = ? AND tenant_id = ?', [officeId, tenantId]);
    return { data: j(r?.data, {}), totemHash: r?.totem_hash || null, totemAt: num(r?.totem_at) };
  }
  async function saveExtras(tenantId, officeId, patch) {
    const cur = await db.get('SELECT office_id FROM telas_office_extras WHERE office_id = ? AND tenant_id = ?', [officeId, tenantId]);
    const t = now();
    if (!cur) await db.run('INSERT INTO telas_office_extras(office_id,tenant_id,data,totem_hash,totem_at,updated_at) VALUES(?,?,?,?,?,?)', [officeId, tenantId, JSON.stringify(patch.data ?? {}), patch.totemHash ?? null, patch.totemAt ?? null, t]);
    else {
      const sets = []; const vals = [];
      if (patch.data !== undefined) { sets.push('data = ?'); vals.push(JSON.stringify(patch.data)); }
      if (patch.totemHash !== undefined) { sets.push('totem_hash = ?', 'totem_at = ?'); vals.push(patch.totemHash, patch.totemAt ?? null); }
      await db.run(`UPDATE telas_office_extras SET ${sets.join(', ')}, updated_at = ? WHERE office_id = ? AND tenant_id = ?`, [...vals, t, officeId, tenantId]);
    }
  }
  /** A configuração da fila da repartição (com o de fábrica) e se a chamada de senha está ligada. */
  async function queueOf(o) {
    const x = await extrasOf(Number(o.tenant_id), Number(o.id));
    const g = await db.get('SELECT created_at FROM telas_guiche WHERE office_id = ? AND tenant_id = ?', [o.id, o.tenant_id]);
    return { enabled: enabledFor(o), ...S.queueConfigOf(x.data.queue, o.type), totem: { on: Boolean(x.totemHash), at: x.totemAt }, guiche: { on: Boolean(g), at: num(g?.created_at) } };
  }
  const servicesOf = (tenantId, officeId) => db.all('SELECT * FROM telas_queue_services WHERE tenant_id = ? AND office_id = ? ORDER BY sort, id', [tenantId, officeId]);
  const needOn = (o) => { if (!enabledFor(o)) throw fail(403, 'A chamada de senha está desligada nesta repartição (o módulo liga no Painel da Prefeitura, em Repartições).'); };

  /* ---------------------------------------------------------------- tempo real (as telas da repartição) */
  const streams = new Map(); // "cliente:repartição" -> Set de conexões { res, deviceId, tenantId, officeId }
  const byDevice = new Map(); // tela -> conexões (a mais nova no fim)
  const lastState = new Map(); // "cliente:repartição" -> JSON do waiting + serving mandado por último
  const stateSig = (snap) => JSON.stringify([snap.waiting, snap.serving, snap.byService, snap.overdue, snap.estimate]);
  const keyOf = (tenantId, officeId) => `${Number(tenantId)}:${Number(officeId)}`;
  const write = (c, text) => { try { c.res.write(text); return true; } catch { drop(c); return false; } };
  const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  function drop(c) {
    const set = streams.get(keyOf(c.tenantId, c.officeId));
    if (set) { set.delete(c); if (!set.size) { streams.delete(keyOf(c.tenantId, c.officeId)); lastState.delete(keyOf(c.tenantId, c.officeId)); } }
    const list = byDevice.get(c.deviceId);
    if (list) { const i = list.indexOf(c); if (i >= 0) list.splice(i, 1); if (!list.length) byDevice.delete(c.deviceId); }
    try { c.res.end(); } catch { /* já fechada */ }
  }
  const publish = (tenantId, officeId, event, data) => { const text = frame(event, data); for (const c of [...(streams.get(keyOf(tenantId, officeId)) || [])]) write(c, text); };
  /** Derruba as conexões de uma tela (revogada, excluída ou passada para outra repartição). */
  function kick(deviceId) { for (const c of [...(byDevice.get(Number(deviceId)) || [])]) drop(c); }
  /** A cada 20 s: o ": ping" do contrato. A cada 3 pings, confere no banco se cada tela ligada ainda é daquela repartição. */
  let pings = 0;
  async function ping() {
    for (const set of streams.values()) for (const c of [...set]) write(c, ': ping\n\n');
    if (++pings % 3 || !byDevice.size) return;
    const ids = [...byDevice.keys()];
    const ok = new Map();
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      for (const r of await db.all(`SELECT id, tenant_id, office_id FROM telas_devices WHERE revoked_at IS NULL AND id IN (${part.map(() => '?').join(',')})`, part)) ok.set(Number(r.id), keyOf(r.tenant_id, r.office_id));
    }
    const live = new Map();
    for (const [id, list] of [...byDevice]) for (const c of [...list]) {
      if (ok.get(id) !== keyOf(c.tenantId, c.officeId)) { drop(c); continue; }
      if (!live.has(c.tenantId)) live.set(c.tenantId, await available(c.tenantId).catch(() => true));
      if (!live.get(c.tenantId)) drop(c);
    }
    for (const k of [...streams.keys()]) {
      const [tenantId, officeId] = k.split(':').map(Number);
      const o = await db.get('SELECT * FROM telas_offices WHERE id = ? AND tenant_id = ?', [officeId, tenantId]);
      if (o && enabledFor(o)) await changed(o, await queueOf(o));
    }
  }
  const pingTimer = timers ? setInterval(() => { ping().catch((err) => console.warn('[telas] senha, ping:', err.message)); }, pingMs) : null;
  pingTimer?.unref?.();

  /* ---------------------------------------------------------------- o que a tela recebe (GET /api/telas/queue) */
  /**
   * { current, last (até 5, sem a current, a mais nova primeiro), waiting } do contrato §7.2 e serving (§12): as chamadas
   * das senhas ainda em atendimento (chamadas e não finalizadas, não-compareceu nem encaminhadas), sem a da current, a mais
   * nova primeiro, até SERVING_MAX. A última chamada de cada senha (a repetição conta como a mesma).
   */
  async function snapshot(tenantId, officeId, cfg, o = null) {
    const day = today();
    const [calls, waiting, waits, open, services, perService] = await Promise.all([
      db.all('SELECT * FROM telas_queue_calls WHERE tenant_id = ? AND office_id = ? AND day = ? ORDER BY shown_at DESC, id DESC LIMIT 13', [tenantId, officeId, day]),
      db.all("SELECT id, code, service_id, priority, risk, queued_at, issued_at FROM telas_queue_tickets WHERE tenant_id = ? AND office_id = ? AND day = ? AND status = 'waiting'", [tenantId, officeId, day]),
      db.all('SELECT issued_at, first_called_at FROM telas_queue_tickets WHERE tenant_id = ? AND office_id = ? AND day = ? AND first_called_at IS NOT NULL ORDER BY first_called_at DESC LIMIT 10', [tenantId, officeId, day]),
      db.all(`SELECT c.* FROM telas_queue_calls c JOIN telas_queue_tickets t ON t.id = c.ticket_id AND t.tenant_id = c.tenant_id
        WHERE c.tenant_id = ? AND c.office_id = ? AND c.day = ? AND t.status = 'called' ORDER BY c.shown_at DESC, c.id DESC LIMIT 60`, [tenantId, officeId, day]),
      servicesOf(tenantId, officeId),
      // §15: a última chamada do dia de cada fila (a maior id; a repetição não cria chamada nova)
      db.all('SELECT * FROM telas_queue_calls WHERE id IN (SELECT MAX(id) FROM telas_queue_calls WHERE tenant_id = ? AND office_id = ? AND day = ? GROUP BY service_id)', [tenantId, officeId, day]),
    ]);
    const names = new Map(services.map((x) => [Number(x.id), x.name]));
    const dto = (c) => S.callDto({ ...c, at: c.shown_at, service: names.get(Number(c.service_id)) || null }, cfg);
    return {
      current: calls[0] ? dto(calls[0]) : null, last: calls.slice(1, 13).map(dto),
      waiting: S.waitingDto(waitingOf(waiting), waits.map((w) => Number(w.first_called_at) - Number(w.issued_at)), { useRisk: cfg.risk }),
      serving: S.servingOf(open, calls[0]).map(dto),
      byService: S.byServiceOf(services, perService, waiting, dto), // §15
      // §28 e §30: overdue (quem passou do tempo-alvo, só com a classificação de risco) e estimate (a espera estimada, se ligada)
      ...(o ? await salas.snapshotExtra(o, cfg, waiting) : {}),
    };
  }
  const EMPTY = { current: null, last: [], waiting: { total: 0, byRisk: null, avgWaitMin: null }, serving: [], byService: [] };
  /** Depois de qualquer mudança: a chamada (se houve) na hora e o "state" quando o waiting mudou. */
  async function changed(o, cfg, call = null) {
    const tenantId = Number(o.tenant_id); const officeId = Number(o.id);
    if (call) publish(tenantId, officeId, 'call', call);
    if (!streams.has(keyOf(tenantId, officeId))) return;
    const snap = await snapshot(tenantId, officeId, cfg, o);
    const sig = stateSig(snap);
    if (lastState.get(keyOf(tenantId, officeId)) === sig) return;
    lastState.set(keyOf(tenantId, officeId), sig);
    publish(tenantId, officeId, 'state', snap);
  }

  /* ---------------------------------------------------------------- senhas */
  const ticketOf = async (o, id) => {
    const t = await db.get('SELECT * FROM telas_queue_tickets WHERE id = ? AND tenant_id = ? AND office_id = ? AND day = ?', [idOf(id, 'Senha'), o.tenant_id, o.id, today()]);
    if (!t) throw fail(404, 'Senha não encontrada (ou de outro dia).');
    return t;
  };
  const serviceOf = async (o, id, { active = true } = {}) => {
    const s = await db.get('SELECT * FROM telas_queue_services WHERE id = ? AND tenant_id = ? AND office_id = ?', [idOf(id, 'Fila'), o.tenant_id, o.id]);
    if (!s || (active && !s.active)) throw fail(404, 'Fila não encontrada.');
    return s;
  };
  /** Emite a senha: a numeração é por letra e por dia (o índice único segura duas emissões ao mesmo tempo). */
  async function issue(o, b, { origin, by, req = null }) {
    needOn(o);
    const tenantId = Number(o.tenant_id); const cfg = await queueOf(o);
    const svc = await serviceOf(o, b?.serviceId);
    const priority = S.cleanPriority(b?.priority, svc);
    const risk = origin === 'totem' ? null : S.cleanRisk(b?.risk);
    if (risk && !cfg.risk) throw fail(400, 'Esta repartição não usa a classificação de risco.');
    const name = origin === 'totem' ? null : S.reduceName(b?.name); // só a forma reduzida é guardada (LGPD)
    const day = today(); const t = now();
    const waiting = Number((await db.get("SELECT COUNT(*) AS n FROM telas_queue_tickets WHERE tenant_id = ? AND office_id = ? AND day = ? AND status = 'waiting'", [tenantId, o.id, day])).n);
    if (waiting >= LIMITS.queueWaitingMax) throw fail(429, 'Há senhas demais esperando nesta repartição.');
    const letters = S.codeLetters(svc.prefix, priority);
    const like = Array.from({ length: 10 }, (_, d) => `${letters}${d}%`);
    let id = null; let code = null;
    for (let i = 0; i < 8 && !id; i++) {
      const m = Number((await db.get(`SELECT MAX(seq) AS m FROM telas_queue_tickets WHERE tenant_id = ? AND office_id = ? AND day = ? AND (${like.map(() => 'code LIKE ?').join(' OR ')})`, [tenantId, o.id, day, ...like])).m) || 0;
      code = S.ticketCode(svc.prefix, priority, m + 1);
      try {
        id = await db.insert('INSERT INTO telas_queue_tickets(tenant_id,office_id,service_id,day,code,seq,priority,risk,name,status,origin,issued_by,issued_at,queued_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [tenantId, o.id, svc.id, day, code, m + 1, priority, risk, name, 'waiting', origin, line(by, 64), t, t]);
      } catch (err) { if (i === 7) throw err; }
    }
    const row = await db.get('SELECT * FROM telas_queue_tickets WHERE id = ?', [id]);
    if (risk) await salas.triaged(o, row, risk, null); // já classificada na recepção: a hora da cor é a da emissão
    const follow = await salas.followFor(o, row, req); // §29: o QR do acompanhante (só no cupom; o token não fica)
    await changed(o, cfg);
    salas.dispatch(o); // §27: o automático do grupo
    return { ticket: ticketDto(row), service: serviceDto(svc), office: o.name, title: cfg.title, at: t, ...(follow ? { follow } : {}) };
  }
  /**
   * Chamar a próxima para um guichê (de uma fila, se pedida), na ordem de S.rankQueue. Com b.ticketId, "Chamar esta": aquela
   * senha, fora da ordem (quem chamou e quando ficam na chamada e no log da repartição; manual: true na resposta).
   */
  /**
   * actor (20/11, quem chama por etapa): 'gestor' e 'desk' (o painel e o guichê), 'sala' (a página da sala), 'auto' (o
   * automático). O painel e o guichê não pegam as senhas das etapas do profissional da sala na "próxima"; com ticketId ou
   * serviceId numa delas, o gestor chama por exceção (exception: true, vai ao log) e o atendente recebe 403. only: as filas
   * a que o automático se limita.
   */
  async function callNext(o, b, { by, actor = 'desk', only: limit = null }) {
    needOn(o);
    const tenantId = Number(o.tenant_id); const cfg = await queueOf(o);
    // §26: chamar numa sala (roomId): o nome da sala vai à tela como o guichê, e as filas são as do grupo dela
    const room = b?.roomId != null && b.roomId !== '' ? await salas.forCall(o, b.roomId) : null;
    const desk = room ? room.desk : S.cleanDesk(b?.desk);
    const manual = b?.ticketId != null && b.ticketId !== '' ? await ticketOf(o, b.ticketId) : null;
    if (manual && manual.status !== 'waiting') throw fail(409, `A senha ${manual.code} não está esperando (já foi chamada ou encerrada).`);
    const svc = manual || b?.serviceId == null || b.serviceId === '' ? null : await serviceOf(o, b.serviceId, { active: false });
    const day = today(); const t = now();
    // §31: as etapas do profissional da sala ficam fora da "próxima" do painel; chamar uma delas é exceção do gestor
    const rules = ['sala', 'auto'].includes(actor) ? { pro: [] } : await salas.callRules(o);
    const target = manual ? Number(manual.service_id) : svc ? Number(svc.id) : null;
    let exception = false;
    if (target != null && rules.pro.includes(target)) {
      if (actor !== 'gestor') throw fail(403, `A etapa "${rules.stageName(target)}" é chamada pelo profissional, na página da sala. Peça ao gestor para chamar por exceção.`);
      exception = true;
    }
    const exclude = exception ? [] : rules.pro;
    let only = svc ? [Number(svc.id)] : room?.serviceIds && !manual ? room.serviceIds : null;
    if (limit) only = (only || limit).filter((x) => limit.includes(x));
    if (only && !only.length) throw fail(404, `Ninguém esperando para ${desk}.`);
    const where = `tenant_id = ? AND office_id = ? AND day = ?${only ? ` AND service_id IN (${only.map(() => '?').join(',')})` : ''}`;
    const args = only ? [tenantId, o.id, day, ...only] : [tenantId, o.id, day];
    const whereW = `${where}${exclude.length ? ` AND service_id NOT IN (${exclude.map(() => '?').join(',')})` : ''}`;
    const argsW = [...args, ...exclude];
    let picked = null;
    for (let i = 0; i < 5 && !picked; i++) {
      const [waiting, calls] = await Promise.all([
        db.all(`SELECT id, priority, risk, queued_at, issued_at FROM telas_queue_tickets WHERE ${whereW} AND status = 'waiting'`, argsW),
        db.all(`SELECT priority, risk FROM telas_queue_calls WHERE ${where} ORDER BY id DESC LIMIT 30`, args),
      ]);
      const next = manual ? (waiting.some((t) => Number(t.id) === Number(manual.id)) ? { id: Number(manual.id) } : null) : S.pickNext(waitingOf(waiting), rankOpts(cfg, calls));
      if (manual && !next) throw fail(409, `A senha ${manual.code} acabou de ser chamada por outro guichê.`);
      if (!next && exclude.length) {
        const n = Number((await db.get(`SELECT COUNT(*) AS n FROM telas_queue_tickets WHERE ${where} AND status = 'waiting'`, args)).n);
        if (n) throw fail(409, 'Quem espera aqui está numa etapa chamada pelo profissional da sala (pela página da sala). O gestor pode chamar por exceção em "Chamar esta".');
      }
      if (!next) throw fail(404, svc ? `Ninguém esperando em "${svc.name}".` : room?.serviceIds ? `Ninguém esperando para ${room.desk}.` : 'Ninguém esperando.');
      // só quem tira a senha de "esperando" a chama (dois guichês no mesmo instante: cada um leva uma)
      const r = await db.run("UPDATE telas_queue_tickets SET status = 'called', desk = ?, called_at = ?, first_called_at = COALESCE(first_called_at, ?) WHERE id = ? AND tenant_id = ? AND status = 'waiting'", [desk, t, t, next.id, tenantId]);
      if (r.changes === 1) picked = next.id;
    }
    if (!picked) throw fail(409, 'A fila mudou agora há pouco. Tente de novo.');
    // 14/11, do dono: chamar a próxima NÃO encerra a anterior do guichê; ela fica "em atendimento" (na TV, embaixo) até
    // Finalizar, Não compareceu ou Encaminhar. O dia que acaba encerra quem ficou (o fechamento do dia, mais abaixo)
    const tk = await db.get('SELECT * FROM telas_queue_tickets WHERE id = ?', [picked]);
    const callId = await db.insert('INSERT INTO telas_queue_calls(tenant_id,office_id,ticket_id,service_id,day,code,desk,name,priority,risk,called_by,at,shown_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [tenantId, o.id, tk.id, tk.service_id, day, tk.code, desk, tk.name, tk.priority, tk.risk, line(by, 64), t, t]);
    const svcName = (await db.get('SELECT name FROM telas_queue_services WHERE id = ? AND tenant_id = ?', [tk.service_id, tenantId]))?.name || null;
    const call = S.callDto({ id: callId, code: tk.code, desk, name: tk.name, priority: tk.priority, risk: tk.risk, at: t, service: svcName }, cfg);
    await salas.called(o, tk, room?.room || null); // a sala fica Ocupada; a chamada entra na linha do tempo (indicadores)
    await changed(o, cfg, call);
    return { ticket: ticketDto(tk), call, ...(manual ? { manual: true } : {}), ...(exception ? { exception: true, stage: rules.stageName(Number(tk.service_id)) } : {}), ...(room ? { room: { id: Number(room.room.id), name: room.room.name } } : {}) };
  }
  /** Mudar a prioridade legal de uma senha que espera (normal, preferencial/60+, 80+). O código impresso não muda. */
  async function setPriority(o, id, b) {
    needOn(o);
    const tk = await ticketOf(o, id);
    if (tk.status !== 'waiting') throw fail(409, 'Só dá para mudar a prioridade de quem está esperando.');
    const svc = await serviceOf(o, tk.service_id, { active: false });
    const priority = S.cleanPriority(b?.priority, svc);
    const from = Number(tk.priority) || 0;
    if (priority !== from) await db.run("UPDATE telas_queue_tickets SET priority = ? WHERE id = ? AND tenant_id = ? AND status = 'waiting'", [priority, tk.id, o.tenant_id]);
    await changed(o, await queueOf(o));
    return { ticket: ticketDto({ ...tk, priority }), from, changed: priority !== from };
  }
  /** Repetir: a mesma chamada de novo na tela (mesmo id, repeat: true). */
  async function repeat(o, id) {
    needOn(o);
    const tk = await ticketOf(o, id); const cfg = await queueOf(o);
    if (tk.status !== 'called') throw fail(409, 'Só dá para repetir a senha que está sendo chamada.');
    const c = await db.get('SELECT * FROM telas_queue_calls WHERE tenant_id = ? AND office_id = ? AND ticket_id = ? ORDER BY id DESC LIMIT 1', [o.tenant_id, o.id, tk.id]);
    if (!c) throw fail(409, 'Esta senha ainda não foi chamada.');
    const t = now();
    await db.run('UPDATE telas_queue_calls SET repeats = repeats + 1, shown_at = ? WHERE id = ? AND tenant_id = ?', [t, c.id, o.tenant_id]);
    const svcName = (await db.get('SELECT name FROM telas_queue_services WHERE id = ? AND tenant_id = ?', [c.service_id, o.tenant_id]))?.name || null;
    const call = { ...S.callDto({ ...c, at: t, service: svcName }, cfg), repeat: true };
    await changed(o, cfg, call);
    return { ticket: ticketDto(tk), call };
  }
  /** Fim de uma senha chamada (ou esperando, no cancelar): done, noshow, cancelled. */
  async function close(o, id, status) {
    needOn(o);
    const tk = await ticketOf(o, id);
    const from = status === 'cancelled' ? ['waiting', 'called'] : ['called'];
    if (!from.includes(tk.status)) throw fail(409, status === 'cancelled' ? 'Esta senha já foi encerrada.' : 'Esta senha não está sendo atendida agora.');
    await db.run(`UPDATE telas_queue_tickets SET status = ?, done_at = ? WHERE id = ? AND tenant_id = ? AND status IN (${from.map(() => '?').join(',')})`, [status, now(), tk.id, o.tenant_id, ...from]);
    await changed(o, await queueOf(o));
    await salas.released(o, Number(tk.id), { status, ticket: tk }); // "não compareceu" entra na linha do tempo, com a sala
    return { ticket: ticketDto({ ...tk, status }) };
  }
  /**
   * Voltar à fila (14/11, do dono): a senha chamada volta a esperar na MESMA fila, no lugar de antes (a chegada e a cor não
   * mudam), para ser chamada de novo depois (a pessoa não estava, foi ao banheiro, o consultório errado chamou).
   */
  async function requeue(o, id) {
    needOn(o);
    const tk = await ticketOf(o, id);
    if (tk.status !== 'called') throw fail(409, 'Esta senha não está sendo atendida agora.');
    await db.run("UPDATE telas_queue_tickets SET status = 'waiting', desk = NULL WHERE id = ? AND tenant_id = ? AND status = 'called'", [tk.id, o.tenant_id]);
    await changed(o, await queueOf(o));
    await salas.released(o, Number(tk.id));
    return { ticket: ticketDto({ ...tk, status: 'waiting', desk: null }) };
  }
  /** Encaminhar para outra fila: a mesma senha, com a prioridade e o risco dela, volta a esperar (entra agora na outra fila). */
  async function forward(o, id, b) {
    needOn(o);
    const tk = await ticketOf(o, id);
    if (!['called', 'waiting'].includes(tk.status)) throw fail(409, 'Esta senha já foi encerrada.');
    const svc = await serviceOf(o, b?.serviceId);
    if (Number(svc.id) === Number(tk.service_id)) throw fail(400, 'Escolha outra fila.');
    await db.run("UPDATE telas_queue_tickets SET service_id = ?, status = 'waiting', desk = NULL, queued_at = ? WHERE id = ? AND tenant_id = ?", [svc.id, now(), tk.id, o.tenant_id]);
    await changed(o, await queueOf(o));
    await salas.released(o, Number(tk.id));
    salas.dispatch(o);
    return { ticket: ticketDto(await db.get('SELECT * FROM telas_queue_tickets WHERE id = ?', [tk.id])) };
  }
  /** A triagem: a cor do risco e, se quiser, o primeiro nome (reduzido aqui). */
  async function triage(o, id, b) {
    needOn(o);
    const tk = await ticketOf(o, id); const cfg = await queueOf(o);
    if (!['called', 'waiting'].includes(tk.status)) throw fail(409, 'Esta senha já foi encerrada.');
    if (b?.risk !== undefined && !cfg.risk) throw fail(400, 'Esta repartição não usa a classificação de risco.');
    const risk = b?.risk !== undefined ? S.cleanRisk(b.risk) : tk.risk;
    const name = b?.name !== undefined ? S.reduceName(b.name) : tk.name;
    await db.run('UPDATE telas_queue_tickets SET risk = ?, name = ? WHERE id = ? AND tenant_id = ?', [risk, name, tk.id, o.tenant_id]);
    await salas.triaged(o, tk, risk, tk.risk); // a hora da classificação (porta–classificação); só a cor, nunca o motivo
    await changed(o, cfg);
    return { ticket: ticketDto({ ...tk, risk, name }) };
  }

  const salas = createSalas({ now, today, queueOf, extrasOf, saveExtras, servicesOf, ticketOf, needOn, enabledFor, changed, publicUrl, available, audit, ipOf, timers,
    ops: { callNext, close, forward, repeat, requeue, triage } });

  /** O resumo para a recepção e o guichê: as filas, quem espera (na ordem em que será chamado), quem está sendo atendido. */
  async function overview(o) {
    const tenantId = Number(o.tenant_id); const cfg = await queueOf(o); const day = today();
    const [services, tickets, calls] = await Promise.all([
      servicesOf(tenantId, o.id),
      db.all("SELECT * FROM telas_queue_tickets WHERE tenant_id = ? AND office_id = ? AND day = ? AND status IN ('waiting','called') ORDER BY queued_at, id", [tenantId, o.id, day]),
      db.all('SELECT * FROM telas_queue_calls WHERE tenant_id = ? AND office_id = ? AND day = ? ORDER BY shown_at DESC, id DESC LIMIT 30', [tenantId, o.id, day]),
    ]);
    const waiting = tickets.filter((t) => t.status === 'waiting');
    const ranked = S.rankQueue(waitingOf(waiting), rankOpts(cfg, calls));
    const byId = new Map(waiting.map((t) => [Number(t.id), t]));
    const up = await salas.overviewExtra(o, cfg, tickets, services); // §26 a §28: salas, grupos, etapas, apoio e o atraso
    // §31: a etapa (com quem a chama) e, de quem está chamado, a situação: chamado, chegou, em atendimento
    const more = (t) => { const x = up.perTicket(t); return { overMin: x.overMin, stage: x.stage ? { name: x.stage.name, index: x.stage.index, total: x.stage.total, mode: x.stage.mode, next: x.stage.next } : null, ...(t.status === 'called' ? { arrivedAt: x.arrivedAt, callState: x.callState } : {}), ...(t.status === 'waiting' && x.stage?.mode === 'sala' ? { awaitPro: true } : {}) }; };
    return {
      ...up.extra,
      serverTime: now(), day, enabled: cfg.enabled, config: { title: cfg.title, voice: cfg.voice, showName: cfg.showName, ratio: cfg.ratio, print: cfg.print, risk: cfg.risk, targets: cfg.targets, ageBoost: cfg.ageBoost, escalate: cfg.escalate }, totem: cfg.totem, guiche: cfg.guiche,
      services: services.map(serviceDto), risks: RISK_KEYS,
      waiting: ranked.map((x) => ({ ...ticketDto(byId.get(x.t.id)), reason: x.reason, why: x.kind, ...more(byId.get(x.t.id)) })), serving: tickets.filter((t) => t.status === 'called').map((t) => ({ ...ticketDto(t), ...more(t) })),
      calls: calls.slice(0, 8).map((c) => ({ id: Number(c.id), ticket: c.code, desk: c.desk, by: c.called_by || '', at: Number(c.shown_at), repeats: Number(c.repeats) || 0, serviceId: Number(c.service_id), priority: Number(c.priority) > 0, risk: cfg.risk && c.risk ? c.risk : null })),
    };
  }

  /* ---------------------------------------------------------------- as operações, montadas no link e no painel */
  /**
   * reg(method, sub, fn): fn({ o, body, params, by }) -> { status?, body, log? }. o = a repartição (a da sessão do link ou a
   * do :id do painel, conferida por quem monta). log = o texto da auditoria (as senhas em si ficam nas tabelas, com quem
   * emitiu e quem chamou: uma linha de auditoria por senha encheria o registro).
   */
  function operations(reg) {
    reg('get', '', async ({ o }) => ({ body: await overview(o) }));
    reg('put', '/config', async ({ o, body }) => {
      const x = await extrasOf(Number(o.tenant_id), Number(o.id));
      const cfg = S.cleanQueueConfig(body, x.data.queue, o.type);
      await saveExtras(Number(o.tenant_id), Number(o.id), { data: { ...x.data, queue: cfg } });
      return { body: { config: cfg }, log: `prefeitura: chamada de senha de "${o.name}" configurada (intercalação ${cfg.ratio}:1${cfg.risk ? `, com classificação de risco (alvos ${S.TARGET_KEYS.map((k) => `${k} ${cfg.targets[k]}`).join(', ')} min${cfg.escalate ? ', atraso sobe de nível' : ''}${cfg.ageBoost ? ', idade acelera' : ''})` : ''}${cfg.showName ? ', nome na tela' : ''})`, rev: true };
    });
    reg('post', '/services', async ({ o, body }) => {
      const all = await servicesOf(o.tenant_id, o.id);
      if (all.length >= LIMITS.queueServices) throw fail(409, `Limite de ${LIMITS.queueServices} filas por repartição.`);
      const s = S.cleanService(body);
      const clash = S.prefixClash(s, all);
      if (clash) throw fail(409, `A letra "${s.prefix}" confunde com a da fila "${clash.name}" (a prioritária leva um P depois da letra).`);
      const id = await db.insert('INSERT INTO telas_queue_services(tenant_id,office_id,name,prefix,priority,sort,active,created_at) VALUES(?,?,?,?,?,?,?,?)', [o.tenant_id, o.id, s.name, s.prefix, s.priority, s.sort, s.active, now()]);
      return { status: 201, body: serviceDto({ ...s, id }), log: `prefeitura: fila "${s.name}" (letra ${s.prefix}) criada em "${o.name}"` };
    });
    reg('patch', '/services/:sid', async ({ o, body, params }) => {
      const cur = await serviceOf(o, params.sid, { active: false });
      const s = S.cleanService(body, cur);
      const clash = S.prefixClash(s, (await servicesOf(o.tenant_id, o.id)).filter((x) => Number(x.id) !== Number(cur.id)));
      if (clash) throw fail(409, `A letra "${s.prefix}" confunde com a da fila "${clash.name}" (a prioritária leva um P depois da letra).`);
      await db.run('UPDATE telas_queue_services SET name = ?, prefix = ?, priority = ?, sort = ?, active = ? WHERE id = ? AND tenant_id = ?', [s.name, s.prefix, s.priority, s.sort, s.active, cur.id, o.tenant_id]);
      return { body: serviceDto({ ...s, id: cur.id }), log: `prefeitura: fila "${s.name}" de "${o.name}" alterada` };
    });
    reg('delete', '/services/:sid', async ({ o, params }) => {
      const cur = await serviceOf(o, params.sid, { active: false });
      if (await db.get("SELECT id FROM telas_queue_tickets WHERE tenant_id = ? AND service_id = ? AND day = ? AND status IN ('waiting','called')", [o.tenant_id, cur.id, today()])) throw fail(409, 'Há senhas desta fila esperando ou em atendimento: encaminhe ou encerre antes (ou desative a fila).');
      // a fila com histórico fica desativada (o relatório ainda a nomeia); sem senha nenhuma, sai
      if (await db.get('SELECT id FROM telas_queue_tickets WHERE tenant_id = ? AND service_id = ?', [o.tenant_id, cur.id])) await db.run('UPDATE telas_queue_services SET active = 0 WHERE id = ? AND tenant_id = ?', [cur.id, o.tenant_id]);
      else await db.run('DELETE FROM telas_queue_services WHERE id = ? AND tenant_id = ?', [cur.id, o.tenant_id]);
      return { body: { ok: true }, log: `prefeitura: fila "${cur.name}" de "${o.name}" removida` };
    });
    // o endereço do totem aparece UMA vez (só o hash fica); gerar de novo derruba o anterior
    reg('post', '/totem', async ({ o, req }) => {
      needOn(o);
      const token = C.newToken();
      await saveExtras(Number(o.tenant_id), Number(o.id), { totemHash: sha256(token), totemAt: now() });
      return { status: 201, body: { url: `${publicUrl(req)}/reparticao/${token}/totem` }, log: `prefeitura: endereço do totem de senhas de "${o.name}" gerado (o anterior deixou de valer)`, noStore: true };
    });
    reg('delete', '/totem', async ({ o }) => {
      await saveExtras(Number(o.tenant_id), Number(o.id), { totemHash: null, totemAt: null });
      return { body: { ok: true }, log: `prefeitura: totem de senhas de "${o.name}" desligado` };
    });
    // o endereço do guichê: como o do totem, aparece UMA vez (só o hash fica); gerar de novo derruba o anterior. Ele só
    // chama, repete, marca "não compareceu", finaliza e encaminha (mountGuiche)
    reg('post', '/guiche', async ({ o, req, by }) => {
      needOn(o);
      const token = C.newToken();
      await db.run('DELETE FROM telas_guiche WHERE office_id = ? AND tenant_id = ?', [o.id, o.tenant_id]);
      await db.run('INSERT INTO telas_guiche(office_id,tenant_id,token_hash,created_by,created_at) VALUES(?,?,?,?,?)', [o.id, o.tenant_id, sha256(token), line(by, 64), now()]);
      return { status: 201, body: { url: `${publicUrl(req)}/reparticao/${token}/guiche` }, log: `prefeitura: endereço do guichê de "${o.name}" gerado (o anterior deixou de valer)`, noStore: true };
    });
    reg('delete', '/guiche', async ({ o }) => {
      await db.run('DELETE FROM telas_guiche WHERE office_id = ? AND tenant_id = ?', [o.id, o.tenant_id]);
      return { body: { ok: true }, log: `prefeitura: endereço do guichê de "${o.name}" desligado` };
    });
    reg('post', '/tickets', async ({ o, body, by, req }) => ({ status: 201, body: await issue(o, body, { origin: 'recepcao', by, req }) }));
    reg('post', '/call', async ({ o, body, by, req }) => {
      // o painel da prefeitura (sem papel) e o gestor do link: 'gestor'; o atendente: 'desk'
      const out = await callNext(o, body, { by, actor: req?.role && req.role !== 'gestor' ? 'desk' : 'gestor' });
      const log = out.exception
        ? `prefeitura: senha ${out.ticket.code} da etapa "${out.stage}" (chamada pelo profissional da sala) chamada por exceção para ${out.call.desk} em "${o.name}"`
        : out.manual ? `prefeitura: senha ${out.ticket.code} chamada fora da ordem ("Chamar esta") para ${out.call.desk} em "${o.name}"` : null;
      return { body: out, log };
    });
    reg('post', '/tickets/:tid/priority', async ({ o, params, body }) => {
      const out = await setPriority(o, params.tid, body);
      return { body: { ticket: out.ticket }, log: out.changed ? `prefeitura: senha ${out.ticket.code} de "${o.name}" passou de ${PRIO_WORD[out.from]} para ${PRIO_WORD[out.ticket.priority]}` : null };
    });
    reg('post', '/tickets/:tid/repeat', async ({ o, params }) => ({ body: await repeat(o, params.tid) }));
    reg('post', '/tickets/:tid/finish', async ({ o, params }) => ({ body: await close(o, params.tid, 'done') }));
    reg('post', '/tickets/:tid/noshow', async ({ o, params }) => ({ body: await close(o, params.tid, 'noshow') }));
    reg('post', '/tickets/:tid/requeue', async ({ o, params }) => ({ body: await requeue(o, params.tid) }));
    reg('post', '/tickets/:tid/cancel', async ({ o, params }) => ({ body: await close(o, params.tid, 'cancelled') }));
    reg('post', '/tickets/:tid/forward', async ({ o, params, body }) => ({ body: await forward(o, params.tid, body) }));
    reg('post', '/tickets/:tid/risk', async ({ o, params, body }) => ({ body: await triage(o, params.tid, body) }));
    salas.operations(reg); // §26 a §31: salas, grupos, etapas, apoio, indicadores
  }

  /* ---------------------------------------------------------------- relatório (90 dias) */
  async function report(tenantId, { from, to, officeId = null }) {
    const args = [tenantId, from, to]; let extra = '';
    if (officeId != null) { extra = ' AND t.office_id = ?'; args.push(officeId); }
    const rows = await db.all(`SELECT t.day, t.office_id, t.service_id, COUNT(*) AS issued,
        SUM(CASE WHEN t.priority > 0 THEN 1 ELSE 0 END) AS priority,
        SUM(CASE WHEN t.first_called_at IS NOT NULL THEN 1 ELSE 0 END) AS called,
        SUM(CASE WHEN t.first_called_at IS NOT NULL THEN t.first_called_at - t.issued_at ELSE 0 END) AS wait_ms,
        SUM(CASE WHEN t.status = 'done' AND t.called_at IS NOT NULL AND t.done_at IS NOT NULL THEN 1 ELSE 0 END) AS served,
        SUM(CASE WHEN t.status = 'done' AND t.called_at IS NOT NULL AND t.done_at IS NOT NULL THEN t.done_at - t.called_at ELSE 0 END) AS service_ms,
        SUM(CASE WHEN t.status = 'noshow' THEN 1 ELSE 0 END) AS noshow
      FROM telas_queue_tickets t WHERE t.tenant_id = ? AND t.day >= ? AND t.day <= ?${extra}
      GROUP BY t.day, t.office_id, t.service_id ORDER BY t.day DESC, t.office_id, t.service_id`, args);
    const [offices, services] = await Promise.all([
      db.all('SELECT id, name FROM telas_offices WHERE tenant_id = ?', [tenantId]),
      db.all('SELECT id, name, prefix FROM telas_queue_services WHERE tenant_id = ?', [tenantId]),
    ]);
    const on = new Map(offices.map((x) => [Number(x.id), x.name])); const sn = new Map(services.map((x) => [Number(x.id), x]));
    const min = (ms, n) => (Number(n) > 0 ? Math.round(Number(ms) / Number(n) / 6000) / 10 : null);
    return rows.map((r) => ({
      day: r.day, officeId: Number(r.office_id), office: on.get(Number(r.office_id)) || `repartição #${r.office_id} (excluída)`,
      serviceId: Number(r.service_id), service: sn.get(Number(r.service_id))?.name || `fila #${r.service_id}`, prefix: sn.get(Number(r.service_id))?.prefix || '',
      issued: Number(r.issued), priority: Number(r.priority), called: Number(r.called), served: Number(r.served), noshow: Number(r.noshow),
      avgWaitMin: min(r.wait_ms, r.called), avgServiceMin: min(r.service_ms, r.served),
    }));
  }
  const reportCsv = (rows) => `﻿${[S.csvLine(['Dia', 'Repartição', 'Fila', 'Letra', 'Senhas emitidas', 'Prioritárias', 'Chamadas', 'Atendidas', 'Não compareceram', 'Espera média (min)', 'Atendimento médio (min)']),
    ...rows.map((r) => S.csvLine([r.day, r.office, r.service, r.prefix, r.issued, r.priority, r.called, r.served, r.noshow, r.avgWaitMin == null ? '' : String(r.avgWaitMin).replace('.', ','), r.avgServiceMin == null ? '' : String(r.avgServiceMin).replace('.', ',')]))].join('\r\n')}\r\n`;

  /* ---------------------------------------------------------------- rotas */
  const noStore = (res) => res.set('Cache-Control', 'no-store');
  const send = (res, out) => {
    if (out.csv != null) return noStore(res).set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${out.filename || 'dados.csv'}"`, 'X-Content-Type-Options': 'nosniff' }).send(out.csv);
    if (out.noStore) noStore(res);
    res.status(out.status || 200).json(out.body);
  };

  /** A TV box: device = o middleware do token (req.dev com a repartição dela). */
  function mountDevice(app, { device }) {
    const officeOfDev = (dev) => ({ id: Number(dev.office_id), tenant_id: Number(dev.tenant_id), type: dev.o_type, modules: dev.o_modules, name: dev.o_name });
    app.get('/api/telas/queue', device, ah(async (req, res) => {
      const o = officeOfDev(req.dev);
      if (!enabledFor(o)) return res.json(EMPTY);
      res.json(await snapshot(o.tenant_id, o.id, await queueOf(o), o));
    }));
    salas.mountDevice(app, { device, officeOfDev }); // GET /api/telas/support: os pedidos de apoio abertos (telas internas)
    app.get('/api/telas/queue/stream', device, ah(async (req, res) => {
      const o = officeOfDev(req.dev);
      const c = { res, deviceId: Number(req.dev.id), tenantId: o.tenant_id, officeId: o.id };
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders?.();
      req.socket?.setNoDelay?.(true);
      // no máximo STREAMS_PER_DEVICE por tela: a mais antiga cai (o app reconectou sem fechar a de antes)
      const list = byDevice.get(c.deviceId) || [];
      while (list.length >= STREAMS_PER_DEVICE) drop(list[0]);
      byDevice.set(c.deviceId, [...(byDevice.get(c.deviceId) || []), c]);
      const k = keyOf(c.tenantId, c.officeId);
      if (!streams.has(k)) streams.set(k, new Set());
      streams.get(k).add(c);
      const gone = () => drop(c);
      req.on('close', gone); res.on('error', gone);
      write(c, ': ok\n\n');
      // o estado de agora (o app também chama o GET ao reconectar); repartição sem a senha ligada: a conexão fica, sem eventos
      if (enabledFor(o)) { const snap = await snapshot(o.tenant_id, o.id, await queueOf(o), o); lastState.set(k, stateSig(snap)); write(c, frame('state', snap)); }
    }));
  }

  /** A página de controle: office = o middleware da sessão do link (req.office); note = a auditoria da repartição. */
  /** O que o atendente alcança (a tela do guichê e a recepção): ver a fila, emitir, chamar e dar andamento à senha. A
   *  triagem, as filas, o totem e a configuração são do gestor. */
  const DESK_OPS = new Set(['get ', 'post /tickets', 'post /call', 'post /tickets/:tid/repeat', 'post /tickets/:tid/finish', 'post /tickets/:tid/noshow', 'post /tickets/:tid/requeue','post /tickets/:tid/cancel', 'post /tickets/:tid/forward', 'post /tickets/:tid/priority',
    // §26 a §28: o atendente escolhe a sala, muda Disponível/Pausa, encaminha para a próxima etapa e cuida dos pedidos de apoio
    'get /rooms', 'post /rooms/:rid/state', 'post /tickets/:tid/next-stage', 'get /support', 'post /support/:sid/accept', 'post /support/:sid/done', 'post /support/:sid/cancel',
    // §31 (20/11): o "chegou" da senha chamada (quando a sala confirma pelo painel)
    'post /tickets/:tid/arrive']);
  function mountOffice(app, { office, note, bump }) {
    operations((method, sub, fn) => app[method](`/api/reparticao/queue${sub}`, office, ah(async (req, res) => {
      const desk = req.role && req.role !== 'gestor';
      if (desk && !DESK_OPS.has(`${method} ${sub}`)) return res.status(403).json({ error: 'O seu usuário só alcança a chamada de senha (Atendimento e Recepção).' });
      const body = req.body || {};
      if (desk && method === 'post' && sub === '/tickets') delete body.risk; // a cor de risco é da triagem (gestor)
      const out = await fn({ o: req.office, body, params: req.params, by: req.by || `repartição: ${req.office.name}`, req });
      if (out.log) await note(req, `${method.toUpperCase()} /api/reparticao/queue${sub.replace(/:\w+/g, '*')}`, `${out.log} pelo link de controle`, out.status || 200);
      if (out.rev) bump(req.tenantId);
      send(res, out);
    })));
  }

  /** O painel: M = prefeitura.manage + todos os canais; own = a repartição do :id NESTE cliente. */
  function mountPanel(app, { M, own, who, bump }) {
    operations((method, sub, fn) => app[method](`/api/prefeitura/offices/:id/queue${sub}`, M, ah(async (req, res) => {
      const o = await own('telas_offices', req.params.id, req.tenantId, 'Repartição');
      const out = await fn({ o, body: req.body || {}, params: req.params, by: who(req), req });
      if (out.log) res.locals.audit = out.log;
      if (out.rev) bump(req.tenantId);
      send(res, out);
    })));
    app.get('/api/prefeitura/queue/report', M, ah(async (req, res) => {
      const t = S.localDay(now()).day;
      const to = S.cleanDay(req.query.to) || t;
      let from = S.cleanDay(req.query.from) || S.addDays(to, -6);
      if (from > to) throw fail(400, 'Relatório: o primeiro dia vem depois do último.');
      if (from < S.addDays(t, -KEEP_DAYS)) from = S.addDays(t, -KEEP_DAYS); // o histórico é de 90 dias
      const officeId = req.query.officeId ? Number((await own('telas_offices', req.query.officeId, req.tenantId, 'Repartição')).id) : null;
      const rows = await report(req.tenantId, { from, to, officeId });
      if (req.query.format === 'csv') {
        res.locals.audit = `prefeitura: relatório das senhas exportado (${from} a ${to})`;
        return noStore(res).set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="senhas-${from}-a-${to}.csv"`, 'X-Content-Type-Options': 'nosniff' }).send(reportCsv(rows));
      }
      const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
      noStore(res).json({ from, to, keepDays: KEEP_DAYS, rows, totals: { issued: sum('issued'), called: sum('called'), served: sum('served'), noshow: sum('noshow') } });
    }));
  }

  /** O totem: a página pública e a API dele, com o token próprio (só emite senha). */
  function mountTotem(app, { headers }) {
    const perOffice = createLimiter({ windowMs: 60_000, max: Number(process.env.TELAS_TOTEM_PER_MIN) || 30, maxKeys: 50_000 });
    const perIp = createLimiter({ windowMs: 60_000, max: Number(process.env.TELAS_TOTEM_PER_IP_MIN) || 60, maxKeys: 100_000 });
    const page = (file, type) => (_req, res) => { res.set({ ...headers, 'Content-Type': type }).sendFile(path.join(PAGE, file)); };
    app.get('/reparticao/totem.js', page('totem.js', 'text/javascript; charset=utf-8'));
    app.get('/reparticao/totem.css', page('totem.css', 'text/css; charset=utf-8'));
    app.get('/reparticao/:token([A-Za-z0-9_-]{32,64})/totem', page('totem.html', 'text/html; charset=utf-8'));
    /** Token do totem -> a repartição (req.office). O mesmo 401 para token inexistente, totem desligado, módulo ou modo desligados. */
    const totem = ah(async (req, res, next) => {
      noStore(res);
      const tok = /^Bearer ([A-Za-z0-9_-]{32,64})$/.exec(req.get('authorization') || '')?.[1];
      const x = tok ? await db.get('SELECT office_id, tenant_id FROM telas_office_extras WHERE totem_hash = ?', [sha256(tok)]) : null;
      const o = x ? await db.get('SELECT * FROM telas_offices WHERE id = ? AND tenant_id = ?', [x.office_id, x.tenant_id]) : null;
      if (!o || !enabledFor(o) || !(await available(Number(o.tenant_id)))) return res.status(401).json({ error: 'Totem desligado. Peça à recepção um endereço novo.' });
      req.office = o; req.tenantId = Number(o.tenant_id);
      next();
    });
    app.get('/api/totem', totem, ah(async (req, res) => {
      const o = req.office; const cfg = await queueOf(o);
      const services = (await servicesOf(req.tenantId, o.id)).filter((s) => s.active);
      res.json({ office: o.name, officeType: typeLabel(o.type), title: cfg.title, print: cfg.print, services: services.map((s) => ({ id: Number(s.id), name: s.name, priority: Boolean(s.priority) })) });
    }));
    app.post('/api/totem/tickets', totem, ah(async (req, res) => {
      if (!perOffice.hit(String(req.office.id)) || !perIp.hit(ipKey(ipOf(req) || '-'))) return res.status(429).json({ error: 'Muitas senhas em pouco tempo. Aguarde um instante ou procure a recepção.' });
      const out = await issue(req.office, { serviceId: req.body?.serviceId, priority: req.body?.priority }, { origin: 'totem', by: 'totem', req });
      // o totem só vê a senha que acabou de emitir: nada da fila, de nomes ou de outras senhas
      res.status(201).json({ ticket: out.ticket.code, service: out.service.name, priority: out.ticket.priority > 0, office: out.office, title: out.title, at: out.at, ...(out.follow ? { follow: out.follow } : {}) });
    }));
  }

  /**
   * O guichê: a página enxuta do atendente e a API dela, com o token próprio. Só chama a próxima, repete, marca "não
   * compareceu", finaliza e encaminha: não emite senha, não lê a fila com nomes, não abre a página de controle.
   */
  function mountGuiche(app, { headers }) {
    const perOffice = createLimiter({ windowMs: 60_000, max: Number(process.env.TELAS_GUICHE_PER_MIN) || 240, maxKeys: 50_000 });
    const perIp = createLimiter({ windowMs: 60_000, max: Number(process.env.TELAS_GUICHE_PER_IP_MIN) || 240, maxKeys: 100_000 });
    const page = (file, type) => (_req, res) => { res.set({ ...headers, 'Content-Type': type }).sendFile(path.join(PAGE, file)); };
    app.get('/reparticao/guiche.js', page('guiche.js', 'text/javascript; charset=utf-8'));
    app.get('/reparticao/guiche.css', page('guiche.css', 'text/css; charset=utf-8'));
    app.get('/reparticao/:token([A-Za-z0-9_-]{32,64})/guiche', page('guiche.html', 'text/html; charset=utf-8'));
    /** Token do guichê -> a repartição. O mesmo 401 para token inexistente, endereço desligado, módulo ou modo desligados. */
    const guiche = ah(async (req, res, next) => {
      noStore(res);
      const tok = /^Bearer ([A-Za-z0-9_-]{32,64})$/.exec(req.get('authorization') || '')?.[1];
      const x = tok ? await db.get('SELECT office_id, tenant_id FROM telas_guiche WHERE token_hash = ?', [sha256(tok)]) : null;
      const o = x ? await db.get('SELECT * FROM telas_offices WHERE id = ? AND tenant_id = ?', [x.office_id, x.tenant_id]) : null;
      if (!o || !enabledFor(o) || !(await available(Number(o.tenant_id)))) return res.status(401).json({ error: 'Endereço do guichê desligado. Peça um endereço novo ao responsável da repartição.' });
      if (!perOffice.hit(String(o.id)) || !perIp.hit(ipKey(ipOf(req) || '-'))) return res.status(429).json({ error: 'Muitos pedidos em pouco tempo. Aguarde um instante.' });
      req.office = o; req.tenantId = Number(o.tenant_id);
      next();
    });
    const by = (o) => `repartição: ${o.name} (guichê)`.slice(0, 64);
    const names = (services) => new Map(services.map((s) => [Number(s.id), s.name]));
    /** O que o guichê vê: as filas, quantos esperam e as senhas em atendimento (para achar a do próprio guichê). */
    app.get('/api/guiche', guiche, ah(async (req, res) => {
      const o = req.office; const v = await overview(o); const n = names(v.services);
      res.json({
        serverTime: v.serverTime, office: o.name, title: v.config.title, waiting: v.waiting.length, risk: v.config.risk,
        // a fila na ordem de chamada, com o motivo, para o "Chamar esta" (sem nomes: o guichê não lê a fila com nomes)
        queue: v.waiting.slice(0, 40).map((t) => ({ id: t.id, code: t.code, serviceId: t.serviceId, service: n.get(t.serviceId) || '', priority: t.priority, risk: t.risk, queuedAt: t.queuedAt, reason: t.reason })),
        services: v.services.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name })),
        serving: v.serving.map((t) => ({ id: t.id, code: t.code, desk: t.desk, serviceId: t.serviceId, service: n.get(t.serviceId) || '', priority: t.priority, name: t.name, calledAt: t.calledAt, risk: t.risk || null })),
        // DIGITAL ISP: as salas e consultórios da repartição, para o guichê escolher o nome dele sem digitar
        rooms: (await db.all('SELECT name FROM telas_rooms WHERE tenant_id = ? AND office_id = ? AND active = 1 ORDER BY sort, id', [o.tenant_id, o.id]).catch(() => [])).map((r) => r.name).filter(Boolean).slice(0, 60),
      });
    }));
    app.post('/api/guiche/call', guiche, ah(async (req, res) => {
      const out = await callNext(req.office, req.body || {}, { by: by(req.office) });
      if (out.manual) await audit({ username: by(req.office), action: 'POST /api/guiche/call', detail: `prefeitura: senha ${out.ticket.code} chamada fora da ordem ("Chamar esta") para ${out.call.desk} em "${req.office.name}" pelo endereço do guichê`, status: 200, ip: ipOf(req), tenantId: req.tenantId });
      res.json(out);
    }));
    const onTicket = (sub, fn) => app.post(`/api/guiche/tickets/:tid/${sub}`, guiche, ah(async (req, res) => res.json(await fn(req.office, req.params.tid, req.body || {}))));
    onTicket('repeat', (o, id) => repeat(o, id));
    onTicket('finish', (o, id) => close(o, id, 'done'));
    onTicket('noshow', (o, id) => close(o, id, 'noshow'));
    onTicket('requeue', (o, id) => requeue(o, id));
    onTicket('forward', (o, id, b) => forward(o, id, b));
    // DIGITAL ISP: a classificação de risco pelo guichê (a cor só; o nome continua fora do alcance do guichê)
    onTicket('risk', (o, id, b) => triage(o, id, { risk: b?.risk ?? null }));
  }

  /* ---------------------------------------------------------------- limpeza: 90 dias de histórico; senhas de ontem saem da fila */
  async function prune(t = now()) {
    await db.run('DELETE FROM telas_queue_tickets WHERE issued_at < ?', [t - KEEP_DAYS * 86400_000]);
    await db.run('DELETE FROM telas_queue_calls WHERE at < ?', [t - KEEP_DAYS * 86400_000]);
    // quem ficou esperando ou em atendimento num dia que já acabou: encerrada sem atendimento (o dia novo começa do 001)
    await db.run("UPDATE telas_queue_tickets SET status = 'expired', done_at = ? WHERE status IN ('waiting','called') AND day < ?", [t, S.localDay(t).day]);
    await salas.prune(t);
  }
  /** A repartição saiu (ou o cliente): as filas, as senhas e o totem dela. x = a transação. */
  async function dropOffice(x, tenantId, officeId) {
    for (const tb of ['telas_queue_calls', 'telas_queue_tickets', 'telas_queue_services']) await x.run(`DELETE FROM ${tb} WHERE office_id = ? AND tenant_id = ?`, [officeId, tenantId]);
    await x.run('DELETE FROM telas_office_extras WHERE office_id = ? AND tenant_id = ?', [officeId, tenantId]);
    await x.run('DELETE FROM telas_guiche WHERE office_id = ? AND tenant_id = ?', [officeId, tenantId]);
    await salas.dropOffice(x, tenantId, officeId);
  }
  /** O bloco `queue` da configuração da tela (contrato §7.1). */
  const contractQueue = async (o) => { const q = await queueOf(o); return { enabled: q.enabled, voice: q.voice, title: q.title, showName: q.showName, pair: q.pair || [] }; };

  return {
    mountDevice, mountOffice, mountPanel, mountTotem, mountGuiche, mountSalaPages: (app, opts) => salas.mountPages(app, opts), salas, prune, dropOffice, contractQueue, queueOf, kick, snapshot, issue, callNext, overview, report,
    stats: () => ({ streams: [...streams.values()].reduce((a, s) => a + s.size, 0), devices: byDevice.size }),
    stop() { clearInterval(pingTimer); salas.stop(); for (const set of [...streams.values()]) for (const c of [...set]) drop(c); },
  };
}
