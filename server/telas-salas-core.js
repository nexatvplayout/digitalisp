// NEXA Telas · salas e consultórios, grupos com round robin, etapas, tempo-alvo, espera estimada, QR do acompanhante e
// indicadores (docs/TELAS.md §26 a §31): as regras sem banco. O banco e as rotas ficam em server/telas-salas.js.
//
// Privacidade de saúde: nada aqui recebe ou devolve queixa, sintoma ou tipo do problema. Só a cor do risco, as horas e o
// nome da sala. O que vai a página pública (o QR do acompanhante) nunca leva nome.
import { fail, line } from './telas-core.js';
import { RISK_KEYS } from '../public/shared/telas-tipos.js';
import { ROOM_KIND_KEYS, SUPPORT_DEFAULT, STAGE_MODE_KEYS, SALAS_LIMITS as L } from '../public/shared/telas-salas.js';
import { TRIAGE_TARGETS } from '../public/shared/triagem-catalogo.js';
import { addDays, localDay, csvLine } from './telas-senha-core.js';

const bool = (v, k) => { if (typeof v !== 'boolean') throw fail(400, `"${k}" é verdadeiro ou falso.`); return v; };
const intOr = (v, d) => { const n = Math.round(Number(v)); return Number.isInteger(n) ? n : d; };

/* ------------------------------------------------------------------ salas e grupos */
/** A sala que o painel mandou (cur = a guardada, numa alteração). groupIds: os grupos que existem nesta repartição. */
export function cleanRoom(b, cur = null, groupIds = []) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw fail(400, 'Sala: envie os dados.');
  const has = (k) => b[k] !== undefined;
  const name = has('name') || !cur ? line(b.name, L.roomName) : cur.name;
  if (name.length < 1) throw fail(400, `Nome da sala: de 1 a ${L.roomName} caracteres (ex.: Consultório 3).`);
  const kind = has('kind') || !cur ? String(b.kind ?? 'sala') : cur.kind;
  if (!ROOM_KIND_KEYS.includes(kind)) throw fail(400, 'Tipo de sala inválido.');
  let groupId = cur ? (cur.group_id == null ? null : Number(cur.group_id)) : null;
  if (has('groupId')) {
    groupId = b.groupId == null || b.groupId === '' ? null : Number(b.groupId);
    if (groupId != null && !groupIds.includes(groupId)) throw fail(400, 'Grupo não encontrado nesta repartição.');
  }
  const active = has('active') ? (bool(b.active, 'active') ? 1 : 0) : cur ? (Number(cur.active) ? 1 : 0) : 1;
  const sort = has('sort') ? intOr(b.sort, 0) : intOr(cur?.sort, 0);
  if (Math.abs(sort) > 100000) throw fail(400, 'Ordem da sala inválida.');
  return { name, kind, groupId, active, sort };
}
/** O grupo de salas: nome, as filas que ele atende (ids desta repartição) e o modo automático (round robin). */
export function cleanGroup(b, cur = null, serviceIds = []) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw fail(400, 'Grupo: envie os dados.');
  const has = (k) => b[k] !== undefined;
  const name = has('name') || !cur ? line(b.name, L.groupName) : cur.name;
  if (name.length < 2) throw fail(400, `Nome do grupo: de 2 a ${L.groupName} caracteres (ex.: Clínico geral).`);
  let services = cur ? servicesOfGroup(cur) : [];
  if (has('serviceIds')) {
    if (!Array.isArray(b.serviceIds)) throw fail(400, 'Filas do grupo: envie a lista.');
    services = [...new Set(b.serviceIds.map(Number))];
    if (services.some((n) => !serviceIds.includes(n))) throw fail(400, 'Fila do grupo não encontrada nesta repartição.');
    if (services.length > L.groupServices) throw fail(400, `Até ${L.groupServices} filas por grupo.`);
  }
  if (!services.length) throw fail(400, 'Escolha ao menos uma fila que o grupo atende.');
  const auto = has('auto') ? (bool(b.auto, 'auto') ? 1 : 0) : cur ? (Number(cur.auto) ? 1 : 0) : 0;
  const sort = has('sort') ? intOr(b.sort, 0) : intOr(cur?.sort, 0);
  return { name, services, auto, sort };
}
/** As filas guardadas de um grupo (JSON), sem quebrar com o estranho. */
export function servicesOfGroup(g) {
  try { const v = JSON.parse(g?.services || '[]'); return Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []; } catch { return []; }
}
/**
 * Round robin: a ordem em que as salas DISPONÍVEIS recebem pacientes no modo automático. A que está livre há mais tempo
 * primeiro (state_at menor); empate pela ordem e pelo id. Só as ativas e disponíveis.
 */
export function roundRobin(rooms) {
  return rooms.filter((r) => Number(r.active) && r.state === 'available')
    .sort((a, b) => Number(a.state_at) - Number(b.state_at) || Number(a.sort) - Number(b.sort) || Number(a.id) - Number(b.id));
}

/* ------------------------------------------------------------------ configuração da UPA (data.upa em telas_office_extras) */
export const UPA_DEFAULTS = Object.freeze({ follow: false, followRisk: false, estimate: false, estimateHours: 3, estimateText: '' });
const HEALTH = ['upa', 'hospital'];
const modeOk = (m) => (STAGE_MODE_KEYS.includes(m) ? m : 'recepcao');
/**
 * O guardado com o de fábrica: o QR do acompanhante nasce ligado na UPA e no hospital (sem a cor); a confirmação de
 * chegada ("Paciente chegou" antes de Finalizar ou Encaminhar na página da sala) também. Cada etapa leva quem a chama
 * (mode: recepcao, sala, auto; o guardado antes de 20/11, sem mode, é recepção).
 */
export function upaConfigOf(stored, officeType) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const hours = intOr(s.estimateHours, UPA_DEFAULTS.estimateHours);
  return {
    follow: typeof s.follow === 'boolean' ? s.follow : HEALTH.includes(officeType),
    followRisk: typeof s.followRisk === 'boolean' ? s.followRisk : false,
    estimate: typeof s.estimate === 'boolean' ? s.estimate : false,
    estimateHours: hours >= L.estimateHoursMin && hours <= L.estimateHoursMax ? hours : UPA_DEFAULTS.estimateHours,
    estimateText: line(s.estimateText, L.estimateText),
    support: cleanSupportKinds(s.support, false),
    flow: Array.isArray(s.flow) ? s.flow.filter((x) => x && Number.isInteger(Number(x.serviceId))).map((x) => ({ name: line(x.name, L.stageName), serviceId: Number(x.serviceId), mode: modeOk(x.mode) })).slice(0, L.flowStages) : [],
    confirm: typeof s.confirm === 'boolean' ? s.confirm : HEALTH.includes(officeType),
  };
}
/**
 * Os atalhos da aba Salas e consultórios: 'recepcao' (tudo pela recepção: toda etapa no modo Recepção; a rota também
 * desliga o automático dos grupos) e 'profissionais' (a 1ª etapa, a recepção, segue com a recepção; as outras, com o
 * profissional da sala).
 */
export const PRESETS = ['recepcao', 'profissionais'];
export function presetFlow(flow, preset) {
  if (!PRESETS.includes(preset)) throw fail(400, 'Atalho desconhecido.');
  return flow.map((s, i) => ({ ...s, mode: preset === 'recepcao' || i === 0 ? 'recepcao' : 'sala' }));
}
/** O pedido do painel por cima do guardado (campo ausente fica como está). serviceIds: as filas da repartição (para as etapas). */
export function cleanUpaConfig(b, stored, officeType, serviceIds = []) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw fail(400, 'Envie a configuração.');
  const out = upaConfigOf(stored, officeType);
  for (const k of ['follow', 'followRisk', 'estimate', 'confirm']) if (b[k] !== undefined) out[k] = bool(b[k], k);
  if (b.estimateHours !== undefined) {
    const n = Number(b.estimateHours);
    if (!Number.isInteger(n) || n < L.estimateHoursMin || n > L.estimateHoursMax) throw fail(400, `Espera estimada: de ${L.estimateHoursMin} a ${L.estimateHoursMax} horas.`);
    out.estimateHours = n;
  }
  if (b.estimateText !== undefined) out.estimateText = line(b.estimateText, L.estimateText);
  if (b.support !== undefined) out.support = cleanSupportKinds(b.support);
  if (b.flow !== undefined) out.flow = cleanFlow(b.flow, serviceIds, out.flow);
  if (b.preset !== undefined) out.flow = presetFlow(out.flow, b.preset);
  return out;
}
/** A lista do "Preciso de:" (até 12, de 2 a 30 letras, sem repetir). strict: do painel (erro em vez de descartar). */
export function cleanSupportKinds(v, strict = true) {
  if (v == null) return [...SUPPORT_DEFAULT];
  if (!Array.isArray(v)) { if (strict) throw fail(400, 'Pedidos de apoio: envie a lista.'); return [...SUPPORT_DEFAULT]; }
  const out = [];
  for (const x of v) {
    const s = line(x, L.supportKind);
    if (s.length < 2) { if (strict) throw fail(400, `Pedido de apoio: de 2 a ${L.supportKind} letras.`); continue; }
    if (!out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  if (out.length > L.supportKinds) { if (strict) throw fail(400, `Até ${L.supportKinds} tipos de apoio.`); return out.slice(0, L.supportKinds); }
  return out;
}
/**
 * As etapas do atendimento: [{ name, serviceId, mode }], cada uma numa fila diferente desta repartição, até 8. mode
 * ausente fica o que estava guardado para a mesma fila (prev; o painel antigo não manda), senão recepção.
 */
export function cleanFlow(v, serviceIds, prev = []) {
  if (!Array.isArray(v)) throw fail(400, 'Etapas: envie a lista.');
  if (v.length > L.flowStages) throw fail(400, `Até ${L.flowStages} etapas.`);
  const out = [];
  for (const x of v) {
    const serviceId = Number(x?.serviceId);
    if (!serviceIds.includes(serviceId)) throw fail(400, 'Etapa: escolha uma fila desta repartição.');
    if (out.some((o) => o.serviceId === serviceId)) throw fail(400, 'Duas etapas não podem usar a mesma fila.');
    let mode = x?.mode;
    if (mode === undefined || mode === null) mode = prev.find((p) => p.serviceId === serviceId)?.mode || 'recepcao';
    if (!STAGE_MODE_KEYS.includes(mode)) throw fail(400, 'Quem chama a etapa: Recepção, Profissional da sala ou Automático.');
    out.push({ name: line(x?.name, L.stageName), serviceId, mode });
  }
  return out;
}
/** A etapa em que a senha está (a da fila dela) e a próxima: { index, name, mode, next } ou null fora das etapas. */
export function stageOf(flow, serviceId, names = new Map()) {
  const i = flow.findIndex((s) => s.serviceId === Number(serviceId));
  if (i < 0) return null;
  const nm = (s) => s.name || names.get(s.serviceId) || `Etapa ${flow.indexOf(s) + 1}`;
  const nx = flow[i + 1] || null;
  return { index: i, total: flow.length, name: nm(flow[i]), mode: modeOk(flow[i].mode), next: nx ? { name: nm(nx), serviceId: nx.serviceId, mode: modeOk(nx.mode) } : null };
}
/** Quem chama a fila: o modo da etapa dela (fora das etapas: recepção, como sempre). */
export const modeOf = (flow, serviceId) => modeOk(flow.find((s) => s.serviceId === Number(serviceId))?.mode);
/** As filas que só o profissional chama (pela página da sala): a recepção não as chama sem ser gestor. */
export const proServices = (flow) => flow.filter((s) => s.mode === 'sala').map((s) => s.serviceId);
/**
 * As filas que o automático distribui num grupo: as das etapas no modo Automático e, com o automático do grupo ligado
 * (o de antes de 20/11), as outras filas dele que não são do profissional.
 */
export function autoServices(groupServices, groupAuto, flow) {
  return groupServices.filter((sid) => { const m = modeOf(flow, sid); return m === 'auto' || (groupAuto && m !== 'sala'); });
}
/**
 * As etapas que ninguém consegue chamar do jeito escolhido (aviso ao salvar): Profissional da sala sem sala ativa que
 * atenda a fila; Automático sem grupo com sala ativa que a atenda. groups: [{ id, services }]; rooms: [{ group_id, active }].
 */
export function flowWarnings(flow, groups, rooms, names = new Map()) {
  const act = rooms.filter((r) => Number(r.active));
  const groupsOf = (sid) => groups.filter((g) => servicesOfGroup(g).includes(sid));
  const roomsFor = (sid) => act.filter((r) => (r.group_id == null ? true : groupsOf(sid).some((g) => Number(g.id) === Number(r.group_id))));
  const out = [];
  flow.forEach((s, i) => {
    const nm = s.name || names.get(s.serviceId) || `Etapa ${i + 1}`;
    if (s.mode === 'sala' && !roomsFor(s.serviceId).length) out.push(`${nm}: nenhuma sala ativa atende esta fila; só o gestor conseguirá chamar.`);
    if (s.mode === 'auto' && !groupsOf(s.serviceId).some((g) => act.some((r) => Number(r.group_id) === Number(g.id)))) out.push(`${nm}: nenhum grupo com sala ativa atende esta fila; o automático não terá para onde mandar.`);
  });
  return out;
}
/**
 * A situação da chamada de uma senha: 'called' (chamada, esperando a pessoa chegar; só com a confirmação exigida),
 * 'arrived' (chegou: confirmada) ou 'serving' (em atendimento, sem confirmação exigida). null para quem não está chamado.
 */
export function callStateOf(t, arrivedAt, confirm) {
  if ((t.status ?? 'called') !== 'called') return null;
  if (arrivedAt != null) return 'arrived';
  return confirm ? 'called' : 'serving';
}

/* ------------------------------------------------------------------ tempo-alvo do Manchester */
/**
 * Passou do tempo-alvo? Só quem espera, com cor, e ainda sem a 1ª chamada médica (doctorAt: a chamada num consultório;
 * sem consultório cadastrado, a 1ª chamada). O vermelho tem alvo 0: espera de qualquer tamanho já passou. Devolve os
 * minutos acima do alvo (>= 0) ou null.
 */
export function overdueMin(t, { targets = TRIAGE_TARGETS, now = Date.now(), doctorAt = null } = {}) {
  if (t.status !== 'waiting' || !t.risk || !RISK_KEYS.includes(t.risk) || doctorAt != null) return null;
  const T = t.risk === 'vermelho' ? 0 : Math.max(1, Number(targets?.[t.risk]) || TRIAGE_TARGETS[t.risk]);
  const wait = now - Number(t.issuedAt ?? t.issued_at);
  return wait > T * 60000 ? Math.floor((wait - T * 60000) / 60000) : null;
}
/** O resumo para as telas (sem dados pessoais: só o código da senha, a cor e os minutos acima do alvo). */
export function overdueDto(list) {
  const byRisk = Object.fromEntries(RISK_KEYS.map((k) => [k, 0]));
  for (const x of list) byRisk[x.risk] += 1;
  return { total: list.length, byRisk, tickets: list.slice(0, 12).map((x) => ({ ticket: x.code, risk: x.risk, overMin: x.overMin })) };
}

/* ------------------------------------------------------------------ espera estimada (média móvel por cor) */
/**
 * samples: [{ risk, waitMs }] das senhas chamadas pelo médico nas últimas horas. byRisk: minutos médios por cor (null sem
 * amostra); light: a média dos casos verdes e azuis juntos (o texto "Casos verdes e azuis: cerca de X min").
 */
export function estimateOf(samples, { text = '', hours = 3 } = {}) {
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length / 60000) : null);
  const ok = samples.filter((s) => Number.isFinite(s.waitMs) && s.waitMs >= 0);
  const byRisk = Object.fromEntries(RISK_KEYS.map((k) => [k, avg(ok.filter((s) => s.risk === k).map((s) => s.waitMs))]));
  const lightMin = avg(ok.filter((s) => s.risk === 'verde' || s.risk === 'azul').map((s) => s.waitMs));
  const light = lightMin == null ? null : `Casos verdes e azuis: cerca de ${roundWait(lightMin)} min de espera`;
  return { hours, byRisk, lightMin, light, text: text || null };
}
/** A espera "arredondada para gente": até 20 min de 5 em 5, depois de 10 em 10, acima de 2 h de 30 em 30. */
export const roundWait = (m) => (m <= 20 ? Math.max(5, Math.ceil(m / 5) * 5) : m <= 120 ? Math.ceil(m / 10) * 10 : Math.ceil(m / 30) * 30);

/* ------------------------------------------------------------------ QR do acompanhante */
/** O fim do dia da senha em America/Sao_Paulo (UTC-3, sem horário de verão desde 2019): o QR vale até a meia-noite. */
export const endOfDay = (day) => Date.parse(`${addDays(day, 1)}T03:00:00Z`);
/** A posição aproximada para a página pública ("é a próxima", "cerca de N antes"), sem número exato longe da frente. */
export function positionText(ahead) {
  if (ahead == null) return null;
  if (ahead <= 0) return 'É a próxima a ser chamada.';
  if (ahead <= 3) return `${ahead} ${ahead === 1 ? 'pessoa' : 'pessoas'} antes.`;
  const r = ahead <= 10 ? Math.round(ahead / 2) * 2 : Math.round(ahead / 5) * 5;
  return `Cerca de ${r} pessoas antes.`;
}

/* ------------------------------------------------------------------ indicadores */
export const PERIODS = ['day', 'week', 'month'];
/** A chave do período de um dia: o próprio dia, a segunda-feira da semana ou o mês. */
export function periodOf(day, by) {
  if (by === 'month') return day.slice(0, 7);
  if (by === 'week') { const wd = new Date(`${day}T12:00:00Z`).getUTCDay(); return addDays(day, -((wd + 6) % 7)); }
  return day;
}
const avgMin = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length / 6000) / 10 : null);
/**
 * Os indicadores de uma repartição num intervalo. tickets: as senhas (issued_at, first_called_at, called_at, done_at,
 * status, risk, day); calls: as chamadas (desk, at, ticket_id); events: a linha do tempo (kind 'triage', 'call', 'arrive' ou
 * 'noshow', com room_kind e room_id). targets: os tempos-alvo. Porta–classificação: da emissão à 1ª cor dada; porta–médico:
 * da emissão à 1ª chamada num consultório (sem consultório cadastrado, à 1ª chamada). Chamada–chegada (20/11): de cada
 * chamada ao 1º "Paciente chegou" depois dela; por sala, com quantos chegaram e quantos não compareceram (roomNames: id da
 * sala -> o nome; a sala removida sai como "(sala removida)").
 */
export function indicatorsOf({ tickets, calls, events, targets = TRIAGE_TARGETS, by = 'day', hasDoctorRooms = false, roomNames = new Map() }) {
  const triageAt = new Map(); const doctorAt = new Map();
  for (const e of [...events].sort((a, b) => Number(a.at) - Number(b.at))) {
    const id = Number(e.ticket_id);
    if (e.kind === 'triage' && !triageAt.has(id)) triageAt.set(id, Number(e.at));
    if (e.kind === 'call' && e.room_kind === 'consultorio' && !doctorAt.has(id)) doctorAt.set(id, Number(e.at));
  }
  const doc = (t) => (hasDoctorRooms ? doctorAt.get(Number(t.id)) : t.first_called_at == null ? undefined : Number(t.first_called_at));
  const blank = () => ({ issued: 0, served: 0, noshow: 0, triage: [], doctor: [], late: 0 });
  const add = (acc, t) => {
    acc.issued += 1;
    if (t.status === 'done') acc.served += 1;
    if (t.status === 'noshow') acc.noshow += 1;
    const tri = triageAt.get(Number(t.id)); if (tri != null) acc.triage.push(tri - Number(t.issued_at));
    const d = doc(t);
    if (d != null) {
      acc.doctor.push(d - Number(t.issued_at));
      if (t.risk && RISK_KEYS.includes(t.risk)) { const T = t.risk === 'vermelho' ? 0 : Number(targets[t.risk]) || TRIAGE_TARGETS[t.risk]; if (d - Number(t.issued_at) > T * 60000) acc.late += 1; }
    }
    return acc;
  };
  const fin = (k, a) => ({ key: k, issued: a.issued, served: a.served, noshow: a.noshow, doorToTriageMin: avgMin(a.triage), doorToDoctorMin: avgMin(a.doctor), late: a.late });
  const total = blank(); const per = new Map(); const color = new Map([...RISK_KEYS, 'sem'].map((k) => [k, blank()]));
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, issued: 0, calls: 0 }));
  for (const t of tickets) {
    add(total, t);
    const p = periodOf(t.day, by); if (!per.has(p)) per.set(p, blank()); add(per.get(p), t);
    add(color.get(t.risk && RISK_KEYS.includes(t.risk) ? t.risk : 'sem'), t);
    hours[localDay(Number(t.issued_at)).hour].issued += 1;
  }
  const rooms = new Map();
  const roomOf = (k) => { if (!rooms.has(k)) rooms.set(k, { room: k, calls: 0, arrived: 0, noshow: 0, toArrive: [] }); return rooms.get(k); };
  for (const c of calls) {
    hours[localDay(Number(c.at)).hour].calls += 1;
    roomOf(c.desk || '(sem sala)').calls += 1;
  }
  // chamada–chegada: cada chamada (evento 'call') casa com o 1º "chegou" depois dela (a mesma chamada não conta duas vezes)
  const byTicket = new Map();
  for (const e of [...events].sort((a, b) => Number(a.at) - Number(b.at))) {
    if (!['call', 'arrive', 'noshow'].includes(e.kind)) continue;
    const id = Number(e.ticket_id); if (!byTicket.has(id)) byTicket.set(id, []); byTicket.get(id).push(e);
  }
  // por sala só o que aconteceu numa sala cadastrada (o guichê digitado conta no total)
  const roomFor = (e) => (e.room_id == null ? null : roomOf(roomNames.get(Number(e.room_id)) || '(sala removida)'));
  const toArrive = []; let arrived = 0;
  for (const list of byTicket.values()) {
    let lastCall = null;
    for (const e of list) {
      if (e.kind === 'call') lastCall = e;
      else if (e.kind === 'arrive' && lastCall) {
        const ms = Number(e.at) - Number(lastCall.at);
        arrived += 1; toArrive.push(ms);
        const r = roomFor(e); if (r) { r.arrived += 1; r.toArrive.push(ms); }
        lastCall = null;
      } else if (e.kind === 'noshow') { const r = roomFor(e); if (r) r.noshow += 1; lastCall = null; }
    }
  }
  return {
    by, totals: { ...fin('total', total), arrived, callToArriveMin: avgMin(toArrive) },
    periods: [...per.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([k, a]) => fin(k, a)),
    byRisk: [...color.entries()].map(([k, a]) => fin(k, a)),
    byRoom: [...rooms.values()].sort((a, b) => b.calls - a.calls || b.arrived - a.arrived).map((r) => ({ room: r.room, calls: r.calls, arrived: r.arrived, noshow: r.noshow, callToArriveMin: avgMin(r.toArrive) })),
    byHour: hours,
  };
}
const n1 = (v) => (v == null ? '' : String(v).replace('.', ','));
const RISK_WORD = { vermelho: 'Vermelho', laranja: 'Laranja', amarelo: 'Amarelo', verde: 'Verde', azul: 'Azul', sem: 'Sem cor' };
/** O CSV dos indicadores (uma seção por bloco, separador ;, com o BOM para o Excel abrir os acentos). */
export function indicatorsCsv(ind, { office = '', from = '', to = '' } = {}) {
  const head = ['Seção', 'Chave', 'Senhas', 'Atendidas', 'Não compareceram', 'Porta–classificação (min)', 'Porta–médico (min)', 'Acima do tempo-alvo'];
  const row = (sec, label, x) => csvLine([sec, label, x.issued, x.served, x.noshow, n1(x.doorToTriageMin), n1(x.doorToDoctorMin), x.late]);
  const lines = [csvLine([`Indicadores · ${office}`, `${from} a ${to}`]), csvLine(head), row('Total', 'Total', ind.totals)];
  for (const p of ind.periods) lines.push(row(ind.by === 'month' ? 'Mês' : ind.by === 'week' ? 'Semana (segunda)' : 'Dia', p.key, p));
  for (const c of ind.byRisk) lines.push(row('Cor', RISK_WORD[c.key] || c.key, c));
  lines.push(csvLine(['Seção', 'Chave', 'Chegaram', 'Chamada–chegada (min)']));
  lines.push(csvLine(['Chamada–chegada', 'Total', ind.totals.arrived ?? 0, n1(ind.totals.callToArriveMin)]));
  lines.push(csvLine(['Seção', 'Sala', 'Chamadas', 'Chegaram', 'Não compareceram', 'Chamada–chegada (min)']));
  for (const r of ind.byRoom) lines.push(csvLine(['Sala', r.room, r.calls, r.arrived ?? 0, r.noshow ?? 0, n1(r.callToArriveMin)]));
  lines.push(csvLine(['Seção', 'Hora', 'Senhas emitidas', 'Chamadas']));
  for (const h of ind.byHour) lines.push(csvLine(['Hora', `${String(h.hour).padStart(2, '0')}h`, h.issued, h.calls]));
  return `﻿${lines.join('\r\n')}\r\n`;
}
