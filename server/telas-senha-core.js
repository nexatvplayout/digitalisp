// NEXA Telas, chamada de senha (docs/TELAS.md §10; contrato telas-contrato.md §7.2): as regras sem banco. O dia da numeração
// (America/Sao_Paulo), o código da senha, a redução do nome (LGPD: primeiro nome + inicial do último), a ordem de chamada
// (risco, depois chegada; prioridade legal intercalada com as normais, 80+ na frente das outras prioridades) e o resumo de
// quem espera. O banco e as rotas ficam em server/telas-senha.js.
import { fail, line } from './telas-core.js';
import { LIMITS, RISK_KEYS, RISK_OFFICE_TYPES, serviceColor } from '../public/shared/telas-tipos.js';
import { TRIAGE_TARGETS, levelOf } from '../public/shared/triagem-catalogo.js';

export const TZ = 'America/Sao_Paulo';
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** O dia, o dia da semana (0 = domingo) e a hora de um instante em America/Sao_Paulo (como o resto do servidor). */
export function localDay(ms = Date.now()) {
  const p = Object.fromEntries(DAY_FMT.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, weekday: WD[p.weekday], hour: Number(p.hour), minute: Number(p.minute) };
}
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 'AAAA-MM-DD' de verdade (31/02 não passa) ou null. */
export function cleanDay(v) {
  const s = String(v ?? '').trim();
  if (!DAY_RE.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}
/** O dia seguinte/anterior de 'AAAA-MM-DD' (n dias). */
export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/* ------------------------------------------------------------------ configuração da fila da repartição */
export const QUEUE_DEFAULTS = Object.freeze({ title: 'Atendimento', voice: true, showName: false, ratio: 2, print: false, ageBoost: true, escalate: true });
/** As cores com tempo-alvo editável (o vermelho é sempre imediato) e os limites, em minutos. */
export const TARGET_KEYS = ['laranja', 'amarelo', 'verde', 'azul'];
export const TARGET_MIN = 1; export const TARGET_MAX = 1440;
/** Os tempos-alvo guardados, com o de fábrica (Manchester: 10, 60, 120, 240 min) no que falta ou não vale. */
export function targetsOf(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const out = { vermelho: 0 };
  for (const k of TARGET_KEYS) { const n = Math.round(Number(s[k])); out[k] = n >= TARGET_MIN && n <= TARGET_MAX ? n : TRIAGE_TARGETS[k]; }
  return out;
}
/** A configuração guardada com o de fábrica no que falta. risk: a classificação por cor nasce ligada na UPA e no hospital. */
export function queueConfigOf(stored, officeType) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const ratio = Math.round(Number(s.ratio));
  return {
    title: line(s.title, LIMITS.queueTitle) || QUEUE_DEFAULTS.title,
    voice: typeof s.voice === 'boolean' ? s.voice : QUEUE_DEFAULTS.voice,
    showName: typeof s.showName === 'boolean' ? s.showName : QUEUE_DEFAULTS.showName,
    ratio: ratio >= LIMITS.queueRatioMin && ratio <= LIMITS.queueRatioMax ? ratio : QUEUE_DEFAULTS.ratio,
    print: typeof s.print === 'boolean' ? s.print : QUEUE_DEFAULTS.print,
    risk: typeof s.risk === 'boolean' ? s.risk : RISK_OFFICE_TYPES.includes(officeType),
    targets: targetsOf(s.targets),
    ageBoost: typeof s.ageBoost === 'boolean' ? s.ageBoost : QUEUE_DEFAULTS.ageBoost,
    escalate: typeof s.escalate === 'boolean' ? s.escalate : QUEUE_DEFAULTS.escalate,
    pair: cleanPair(s.pair, false), // §15: as duas filas do layout queue-duo ([] = as duas primeiras ativas)
  };
}
/** As duas filas do queue-duo (§15): até 2 ids distintos. strict: o que veio do painel (erro em vez de descartar). */
export function cleanPair(v, strict = true) {
  if (v == null || v === '') return [];
  if (!Array.isArray(v)) { if (strict) throw fail(400, 'Duas filas: envie a lista com até 2 filas.'); return []; }
  const ids = v.filter((x) => x != null && x !== '').map(Number);
  if (ids.some((n) => !Number.isInteger(n) || n < 1)) { if (strict) throw fail(400, 'Duas filas: fila inválida.'); return []; }
  const out = [...new Set(ids)];
  if (out.length > 2) { if (strict) throw fail(400, 'Duas filas: escolha no máximo 2.'); return out.slice(0, 2); }
  return out;
}
/** O que o painel (ou a página da repartição) mandou, por cima do guardado. Campo ausente fica como está. */
export function cleanQueueConfig(b, stored, officeType) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw fail(400, 'Chamada de senha: envie a configuração.');
  const cur = queueConfigOf(stored, officeType);
  const out = { ...cur };
  if (b.title !== undefined) out.title = line(b.title, LIMITS.queueTitle) || QUEUE_DEFAULTS.title;
  for (const k of ['voice', 'showName', 'print', 'risk', 'ageBoost', 'escalate']) if (b[k] !== undefined) { if (typeof b[k] !== 'boolean') throw fail(400, `Chamada de senha: "${k}" é verdadeiro ou falso.`); out[k] = b[k]; }
  if (b.pair !== undefined) out.pair = cleanPair(b.pair);
  if (b.ratio !== undefined) {
    const n = Math.round(Number(b.ratio));
    if (!(n >= LIMITS.queueRatioMin && n <= LIMITS.queueRatioMax)) throw fail(400, `Intercalação: de ${LIMITS.queueRatioMin} a ${LIMITS.queueRatioMax} senhas normais para cada prioritária.`);
    out.ratio = n;
  }
  if (b.targets !== undefined) {
    if (!b.targets || typeof b.targets !== 'object' || Array.isArray(b.targets)) throw fail(400, 'Tempos-alvo: envie os minutos de cada cor.');
    const t = { ...cur.targets };
    for (const k of TARGET_KEYS) if (b.targets[k] !== undefined) {
      const n = Number(b.targets[k]);
      if (!Number.isInteger(n) || n < TARGET_MIN || n > TARGET_MAX) throw fail(400, `Tempo-alvo do ${k}: de ${TARGET_MIN} a ${TARGET_MAX} minutos.`);
      t[k] = n;
    }
    for (let i = 1; i < TARGET_KEYS.length; i++) if (t[TARGET_KEYS[i]] < t[TARGET_KEYS[i - 1]]) throw fail(400, `Tempo-alvo: o ${TARGET_KEYS[i]} não pode ser menor que o ${TARGET_KEYS[i - 1]} (a cor menos grave espera mais).`);
    out.targets = t;
  }
  return out;
}

/* ------------------------------------------------------------------ filas (serviços) */
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Letra(s) da senha: 1 a 3 letras A-Z (acentos e minúsculas viram a letra). */
export function cleanPrefix(v) {
  const p = fold(v).toUpperCase().replace(/[^A-Z]/g, '');
  if (!p || p.length > LIMITS.queuePrefix || p.length !== String(v ?? '').trim().length) throw fail(400, `Letra da senha: de 1 a ${LIMITS.queuePrefix} letras (A a Z).`);
  return p;
}
/** O serviço que o painel mandou (cur = o guardado, numa alteração). */
export function cleanService(b, cur = null) {
  const has = (k) => b && b[k] !== undefined;
  const name = has('name') || !cur ? line(b?.name, LIMITS.queueServiceName) : cur.name;
  if (name.length < 2) throw fail(400, `Nome da fila: 2 a ${LIMITS.queueServiceName} caracteres.`);
  const sort = has('sort') ? Math.round(Number(b.sort)) : Number(cur?.sort) || 0;
  if (!Number.isInteger(sort) || Math.abs(sort) > 100000) throw fail(400, 'Ordem da fila inválida.');
  return {
    name, prefix: has('prefix') || !cur ? cleanPrefix(b?.prefix) : cur.prefix,
    priority: has('priority') ? (b.priority ? 1 : 0) : cur ? (cur.priority ? 1 : 0) : 1,
    sort, active: has('active') ? (b.active ? 1 : 0) : cur ? (cur.active ? 1 : 0) : 1,
  };
}
/** Os códigos que um serviço usa: a letra (normais) e a letra + P (prioritárias). */
const codesOf = (s) => (s.priority ? [s.prefix, `${s.prefix}P`] : [s.prefix]);
/** Dois serviços da mesma repartição não podem dar a mesma senha ("A" prioritária = "AP"; outra fila "AP" confundiria). */
export function prefixClash(service, others) {
  const mine = codesOf(service);
  return others.find((o) => codesOf(o).some((c) => mine.includes(c))) || null;
}
/** O código da senha: letra(s) + P (prioritária) + número com 3 dígitos (A001, AP002; passa de 999 sem cortar). */
export const ticketCode = (prefix, priority, seq) => `${prefix}${priority > 0 ? 'P' : ''}${String(seq).padStart(3, '0')}`;
/** A letra do código (o que vem antes do número): a numeração do dia é por letra. */
export const codeLetters = (prefix, priority) => `${prefix}${priority > 0 ? 'P' : ''}`;

export function cleanPriority(v, service) {
  const n = v === true ? 1 : v == null || v === false || v === '' ? 0 : Number(v);
  if (![0, 1, 2].includes(n)) throw fail(400, 'Prioridade inválida (0 normal, 1 preferencial/60+, 2 = 80 anos ou mais).');
  if (n > 0 && !service.priority) throw fail(400, 'Esta fila não tem senha prioritária.');
  return n;
}
export function cleanRisk(v) {
  if (v == null || v === '') return null;
  if (!RISK_KEYS.includes(v)) throw fail(400, `Classificação de risco inválida (${RISK_KEYS.join(', ')}).`);
  return v;
}
export function cleanDesk(v) {
  const d = line(v, LIMITS.queueDesk);
  if (d.length < 1) throw fail(400, 'Diga o nome do guichê ou do consultório (ex.: Guichê 3).');
  return d;
}

/* ------------------------------------------------------------------ nome (LGPD) */
const PARTICLES = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'del', 'della', 'van', 'von', 'jr', 'junior', 'júnior', 'filho', 'filha', 'neto', 'neta', 'sobrinho']);
const cap = (w) => w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1).toLocaleLowerCase('pt-BR');
/**
 * O nome que pode ir a uma tela: o primeiro nome e a inicial do último sobrenome ("Maria Aparecida da Silva" -> "Maria S.").
 * É a ÚNICA forma guardada e mostrada: o nome inteiro não entra no banco, não vai a log nem à tela. Sem letras: null.
 */
export function reduceName(v) {
  const words = line(v, 200).replace(/[^\p{L}\s'-]/gu, ' ').split(/\s+/).map((w) => w.replace(/^['-]+|['-]+$/g, '')).filter(Boolean);
  if (!words.length) return null;
  const first = cap(words[0]).slice(0, 24);
  const rest = words.slice(1).filter((w) => !PARTICLES.has(w.toLocaleLowerCase('pt-BR')));
  const last = rest[rest.length - 1];
  return last ? `${first} ${last.charAt(0).toLocaleUpperCase('pt-BR')}.` : first;
}

/* ------------------------------------------------------------------ ordem de chamada */
/*
 * A regra (docs/TELAS.md §10, "Ordem de chamada"), numa conta só:
 *   1. Triadas (com a classificação de risco ligada): pela cor do Protocolo de Manchester.
 *      - Vermelho: imediato, sempre o próximo, à frente de tudo; entre vermelhos, quem chegou antes. Nunca espera proporção.
 *      - As outras cores têm um tempo-alvo (fábrica: laranja 10, amarelo 60, verde 120, azul 240 min). "Atraso relativo" =
 *        espera ÷ tempo-alvo (1 = chegou no alvo). A espera conta desde a emissão da senha (a chegada à unidade): encaminhar
 *        para outra fila não zera o relógio da cor.
 *      - Nível: laranja 1, amarelo 2, verde 3, azul 4. Com "o atraso sobe de nível" (escalate), verde e azul sobem um nível
 *        a cada tempo-alvo vencido, até o nível do amarelo (nunca passam um laranja): um verde há 2 h passa o amarelo que
 *        acabou de chegar; um azul há 4 h vira nível verde, há 8 h nível amarelo. Sem fome.
 *      - No mesmo nível: o maior atraso relativo primeiro (é o "mais antigo" quando a cor é a mesma). Com "a idade acelera"
 *        (ageBoost), o atraso do 80+ conta 1,5x e o do preferencial/60+ 1,25x; empate: 80+, depois preferencial, depois chegada.
 *   2. Sem triagem (ou repartição sem risco): ordem de chegada, com a prioridade legal intercalada: depois de `ratio`
 *      normais seguidas, a vez é de uma preferencial, se houver; entre as preferenciais, 80+ primeiro (Lei 13.466/2017),
 *      depois por chegada. No começo do dia a preferencial sai na frente. Com o risco ligado, quem tem cor vem antes.
 * rankQueue devolve a fila inteira na ordem, com o MOTIVO de cada posição (o painel mostra na lista "Esperando").
 */
export const AGE_BOOST = Object.freeze({ 0: 1, 1: 1.25, 2: 1.5 });
const LEVEL_NAME = { 1: 'laranja', 2: 'amarelo', 3: 'verde', 4: 'azul' };
const riskRank = (r) => { const i = RISK_KEYS.indexOf(r); return i < 0 ? RISK_KEYS.length : i; };
const byArrival = (a, b) => a.queuedAt - b.queuedAt || a.id - b.id;
const sinceOf = (t) => (t.issuedAt != null && Number.isFinite(Number(t.issuedAt)) ? Number(t.issuedAt) : Number(t.queuedAt));
const mins = (ms) => Math.max(0, Math.round(ms / 60000)); // como o painel arredonda a espera
const prioWord = (p) => (p === 2 ? '80+' : p > 0 ? 'preferencial' : '');
/**
 * Quantas senhas normais foram chamadas desde a última prioritária. calls: as chamadas do dia, a mais nova primeiro
 * ({ priority }). Sem nenhuma prioritária ainda: Infinity (a prioritária está "devendo": é a próxima).
 */
export function sinceLastPriority(calls) {
  let n = 0;
  for (const c of calls) { if (Number(c.priority) > 0) return n; n++; }
  return Infinity;
}
/** Ordena as triadas e escreve o motivo de cada uma. */
function rankTriaged(list, { now, targets, ageBoost, escalate }) {
  const rows = list.map((t) => {
    const since = sinceOf(t); const wait = Math.max(0, now - since); const rank = riskRank(t.risk); const p = Number(t.priority) || 0;
    const name = levelOf(t.risk)?.color.toLowerCase() || t.risk;
    if (rank === 0) return { t, level: 0, since, key: 0, p, reason: `vermelho: imediato (há ${mins(wait)} min)` };
    const T = Math.max(1, Number(targets?.[t.risk]) || TRIAGE_TARGETS[t.risk]);
    const rel = wait / (T * 60000);
    const level = escalate && rank > 2 ? Math.max(2, rank - Math.floor(rel)) : rank;
    const boost = ageBoost ? AGE_BOOST[p] || 1 : 1;
    let reason = `${name} há ${mins(wait)} min${rel >= 1 ? `: passou do alvo de ${T} min` : ` (alvo ${T} min)`}`;
    if (level < rank) reason += `, sobe ao nível do ${LEVEL_NAME[level]}`;
    if (boost > 1) reason += ` · ${prioWord(p)} acelera`;
    return { t, level, since, key: rel * boost, p, reason };
  });
  rows.sort((a, b) => a.level - b.level
    || (a.level === 0 ? 0 : b.key - a.key || b.p - a.p)
    || a.since - b.since || a.t.id - b.t.id);
  return rows.map(({ t, reason }) => ({ t, reason, kind: 'risk' }));
}
/**
 * A fila inteira na ordem em que será chamada, com o motivo: [{ t, reason, kind ('risk' | 'priority' | 'arrival') }].
 * waiting: [{ id, priority (0, 1, 2), risk, queuedAt, issuedAt? }]. opts: ratio, sinceP (normais desde a última
 * preferencial), useRisk, now, targets (minutos por cor), ageBoost, escalate.
 */
export function rankQueue(waiting, opts = {}) {
  const { ratio = 2, useRisk = false, now = Date.now(), targets = TRIAGE_TARGETS, ageBoost = true, escalate = true } = opts;
  const triaged = useRisk ? waiting.filter((t) => t.risk && RISK_KEYS.includes(t.risk)) : [];
  const rest = waiting.filter((t) => !triaged.includes(t));
  const out = rankTriaged(triaged, { now, targets, ageBoost, escalate });
  const pre = useRisk ? 'sem triagem · ' : '';
  const prio = rest.filter((t) => t.priority > 0).sort((a, b) => b.priority - a.priority || byArrival(a, b));
  const normal = rest.filter((t) => !(t.priority > 0)).sort(byArrival);
  let sinceP = opts.sinceP ?? Infinity;
  while (prio.length || normal.length) {
    if (prio.length && (sinceP >= ratio || !normal.length)) {
      const t = prio.shift(); sinceP = 0;
      out.push({ t, kind: 'priority', reason: `${pre}${t.priority === 2 ? '80+: prioridade especial, à frente das outras preferenciais' : 'preferencial'}${normal.length ? ` (1 a cada ${ratio} normais)` : ''}` });
    } else {
      out.push({ t: normal.shift(), kind: 'arrival', reason: `${pre}ordem de chegada` }); sinceP += 1;
    }
  }
  return out;
}
/** A próxima senha (a primeira de rankQueue) ou null. */
export function pickNext(waiting, opts = {}) {
  if (!waiting.length) return null;
  return rankQueue(waiting, opts)[0].t;
}
/** A fila inteira na ordem em que seria chamada (a prévia da recepção). */
export const orderAll = (waiting, opts = {}) => rankQueue(waiting, opts).map((x) => x.t);

/* ------------------------------------------------------------------ o que a tela recebe (contrato §7.2) */
/** Uma chamada como o contrato manda: o nome só com "mostrar o nome" ligado na repartição (e já reduzido); a cor do risco (§13). */
export const callDto = (c, { showName = false, risk = false } = {}) => ({
  id: Number(c.id), ticket: c.code, desk: c.desk || '', name: showName && c.name ? c.name : null, priority: Number(c.priority) > 0, at: Number(c.at),
  // §13: a cor da classificação de risco, só na repartição que usa a classificação (senão null)
  risk: risk && RISK_KEYS.includes(c.risk) ? c.risk : null,
  // §15: o nome da fila (serviço) da senha; null quando não se sabe
  service: c.service ? String(c.service) : null,
});
/** Quantas filas a tela recebe em byService (§15). */
export const BY_SERVICE_MAX = 12;
/**
 * byService do contrato (§15): as filas ATIVAS na ordem da repartição (sort, id), cada uma com a cor (pela posição), a última
 * chamada do dia (no formato de current) e quantas esperam. services: as filas; lastCalls: a última chamada de cada fila
 * ({ service_id, … }); waiting: as senhas esperando ({ service_id }); dto: a chamada -> objeto do contrato.
 */
export function byServiceOf(services, lastCalls, waiting, dto) {
  const calls = new Map(lastCalls.map((c) => [Number(c.service_id), c]));
  const count = new Map();
  for (const t of waiting) count.set(Number(t.service_id), (count.get(Number(t.service_id)) || 0) + 1);
  return services.filter((s) => Number(s.active) !== 0).slice(0, BY_SERVICE_MAX).map((s, i) => ({
    id: Number(s.id), name: s.name, color: serviceColor(i),
    current: calls.has(Number(s.id)) ? dto({ ...calls.get(Number(s.id)), service: s.name }) : null,
    waiting: count.get(Number(s.id)) || 0,
  }));
}
/** Quantas senhas em atendimento a tela recebe (contrato §12). */
export const SERVING_MAX = 8;
/**
 * serving do contrato (§12): das chamadas das senhas ainda em atendimento (a mais nova primeiro), a última de cada senha,
 * sem a senha da chamada atual, até SERVING_MAX.
 */
export function servingOf(openCalls, current) {
  const seen = new Set(current ? [Number(current.ticket_id)] : []);
  const out = [];
  for (const c of openCalls) {
    const t = Number(c.ticket_id);
    if (seen.has(t)) continue;
    seen.add(t); out.push(c);
    if (out.length >= SERVING_MAX) break;
  }
  return out;
}
/**
 * waiting do contrato. waiting: as senhas esperando ({ risk, queuedAt }); waits: as esperas (ms) das últimas chamadas do
 * dia (primeira chamada − emissão). byRisk só com a classificação de risco; avgWaitMin null sem nenhuma chamada ainda.
 */
export function waitingDto(waiting, waits, { useRisk = false } = {}) {
  const byRisk = useRisk ? Object.fromEntries(RISK_KEYS.map((k) => [k, waiting.filter((t) => t.risk === k).length])) : null;
  const ok = waits.filter((w) => Number.isFinite(w) && w >= 0);
  return { total: waiting.length, byRisk, avgWaitMin: ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length / 60000) : null };
}
/** Linha do CSV (campos com ; " ou quebra entre aspas; começo com = + - @ leva apóstrofo: fórmula no Excel). */
export const csvField = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const csvLine = (cols) => cols.map(csvField).join(';');
