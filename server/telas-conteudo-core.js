// NEXA Telas, fases 3 e 4 (docs/TELAS.md; contrato telas-contrato.md §7.1): as regras sem banco do conteúdo que vai além dos
// avisos. Os cartões de informação (limpeza e o que vale hoje), a classificação do conteúdo e o modo eleitoral (a janela em
// America/Sao_Paulo), o clima no formato do contrato (com o rev segurado por 30 min), os vídeos guardados, a ponte com o
// alerta de emergência do canal (EAS) e a disponibilidade das telas. O banco e as rotas ficam em server/telas-conteudo.js.
import { fail, line } from './telas-core.js';
import { localDay, cleanDay } from './telas-senha-core.js';
import { LIMITS, CARD_KIND, CARD_KIND_KEYS, CONTENT_CLASS_KEYS, ALERT_TYPE, ALERT_CATEGORY_KEYS, alertHeader, issuerOf, issuerHeader, splitAviso, markAviso } from '../public/shared/telas-tipos.js';
import { text as cleanText } from './telas-core.js';

/* ------------------------------------------------------------------ tipos de aviso: o texto sugerido que a prefeitura trocou */
/**
 * O que a prefeitura trocou no texto sugerido dos tipos de aviso (o catálogo é o padrão; só a diferença fica guardada):
 * { idDoTipo: { title, text } }. Tipo desconhecido ou igual ao catálogo sai; null ou vazio = tudo de fábrica (devolve null).
 */
export function cleanAlertTexts(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw fail(400, 'Textos dos tipos de aviso: envie { tipo: { title, text } }.');
  const out = {};
  for (const [id, o] of Object.entries(v)) {
    const t = ALERT_TYPE[id];
    if (!t || id === 'outro' || !o || typeof o !== 'object') continue;
    const title = line(o.title, LIMITS.alertTitle); const text = cleanText(o.text, LIMITS.alertText);
    if (title.length < 2) throw fail(400, `Tipo de aviso "${t.name}": o título sugerido precisa de 2 letras ou mais.`);
    if (title !== t.title || text !== t.text) out[id] = { title, text };
  }
  return Object.keys(out).length ? out : null;
}
/** O guardado, sem derrubar nada se estiver fora do formato. */
export function alertTextsOf(stored) { try { return cleanAlertTexts(stored) || {}; } catch { return {}; } }
/**
 * A categoria, o tipo e a marca de teste que vieram com o alerta (contrato §9). Tudo opcional: sem categoria, o alerta é
 * como os de antes. O tipo, se vier, tem de ser da categoria; a categoria "teste" marca o teste.
 */
export function cleanAlertKind(b) {
  const category = b?.category == null || b.category === '' ? null : b.category;
  if (category === null) return { category: null, kind: null, test: false };
  if (!ALERT_CATEGORY_KEYS.includes(category)) throw fail(400, 'Categoria do aviso inválida.');
  const kind = b?.kind == null || b.kind === '' ? null : b.kind;
  if (kind !== null && ALERT_TYPE[kind]?.category !== category) throw fail(400, 'Tipo de aviso inválido para a categoria.');
  return { category, kind, test: category === 'teste' };
}
/**
 * O `header` do contrato §9 para um alerta novo. issuer: { kind: 'defesa-civil' | 'office' | 'panel', name }. A Defesa
 * Civil e o Painel da Prefeitura (com categoria) levam a gravidade ("ALERTA SEVERO · DEFESA CIVIL"); as outras repartições
 * só ganham "AVISO · <nome>" no nível informativo (no resto, o cabeçalho do app, como antes). Teste: "TESTE DO SISTEMA".
 */
export function headerFor({ level, test = false, category = null, issuer }) {
  if (test) return alertHeader({ level, test: true });
  if (issuer?.kind === 'defesa-civil') return alertHeader({ level, issuer: 'Defesa Civil' });
  // as repartições emissoras (Defesa Civil, Segurança, Polícia Civil e Militar) assinam pelo tipo: "ALERTA · GUARDA MUNICIPAL"
  if (issuer?.type && issuerOf(issuer.type)) return issuerHeader(issuer.type, level);
  if (issuer?.kind === 'panel') return category ? alertHeader({ level, issuer: 'Prefeitura' }) : null;
  return level === 'info' && issuer?.name ? alertHeader({ level, issuer: issuer.name }) : null;
}

/* ------------------------------------------------------------------ classificação e modo eleitoral */
export const DEFAULT_CLASS = 'utilidade';
export function cleanClass(v) {
  if (v == null || v === '') return DEFAULT_CLASS;
  if (!CONTENT_CLASS_KEYS.includes(v)) throw fail(400, 'Classificação inválida (utilidade pública, institucional ou emergência).');
  return v;
}
/** O período eleitoral da prefeitura: { from, to } em dias (AAAA-MM-DD, os dois incluídos) ou null (desligado). */
export function cleanElectoral(v) {
  if (v == null || v === '' || v === false) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw fail(400, 'Modo eleitoral: envie { from, to } (AAAA-MM-DD).');
  if ((v.from == null || v.from === '') && (v.to == null || v.to === '')) return null;
  const from = cleanDay(v.from); const to = cleanDay(v.to);
  if (!from || !to) throw fail(400, 'Modo eleitoral: informe o primeiro e o último dia (AAAA-MM-DD).');
  if (to < from) throw fail(400, 'Modo eleitoral: o último dia vem antes do primeiro.');
  if ((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000 > 366) throw fail(400, 'Modo eleitoral: o período passa de um ano.');
  return { from, to };
}
/** O modo eleitoral vale agora? Do primeiro dia às 00:00 ao último às 23:59:59, no horário de Brasília. */
export function electoralOn(e, now = Date.now()) {
  if (!e || !e.from || !e.to) return false;
  const { day } = localDay(now);
  return day >= e.from && day <= e.to;
}
/** Retido agora? (institucional durante o período eleitoral). */
export const withheld = (cls, electoral) => Boolean(electoral) && cls === 'institucional';
/** Os avisos (texto rolante) como a tela recebe: sem a marca da classificação e sem os institucionais no período eleitoral. */
export function tickerTexts(items, electoral = false) {
  return (Array.isArray(items) ? items : []).map(splitAviso).filter((a) => !withheld(a.class, electoral)).map((a) => a.text).filter(Boolean);
}
/** Um aviso guardado: o texto limpo com a marca canônica da classificação ("[institucional] …"). */
export function cleanAviso(v, max) {
  const a = splitAviso(line(v, max + 20));
  const t = line(a.text, max);
  return t ? markAviso(t, a.class) : '';
}

/* ------------------------------------------------------------------ cartões de informação (contrato §7.1) */
/** As linhas do cartão: lista ou texto com quebras; até 8 de até 90 (a linha longa é cortada; linha a mais é recusada). */
export function cleanLines(v) {
  const raw = Array.isArray(v) ? v : String(v ?? '').split(/\r?\n/);
  const out = raw.map((x) => line(x, LIMITS.cardLine)).filter(Boolean);
  if (out.length > LIMITS.cardLines) throw fail(400, `Cartão: no máximo ${LIMITS.cardLines} linhas.`);
  return out;
}
/**
 * O cartão que o painel (ou a página da repartição) mandou. kinds: os tipos que a repartição usa (officeCardKinds).
 * weekday: 0 (domingo) a 6 ou null (todo dia); dateFrom/dateTo: AAAA-MM-DD ou null.
 */
export function cleanCard(b, cur = null, { kinds = CARD_KIND_KEYS } = {}) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw fail(400, 'Cartão: envie os campos.');
  const has = (k) => b[k] !== undefined;
  const kind = has('kind') ? b.kind : cur?.kind;
  if (!CARD_KIND[kind]) throw fail(400, 'Tipo de cartão inválido.');
  if (!kinds.includes(kind)) throw fail(403, `O módulo de "${CARD_KIND[kind].label}" está desligado nesta repartição.`);
  const title = has('title') || !cur ? line(b.title, LIMITS.cardTitle) || CARD_KIND[kind].title : cur.title;
  const lines = has('lines') || !cur ? cleanLines(b.lines) : cur.lines;
  if (!lines.length) throw fail(400, 'Cartão: escreva ao menos uma linha.');
  let weekday = cur?.weekday ?? null;
  if (has('weekday')) {
    weekday = b.weekday == null || b.weekday === '' ? null : Number(b.weekday);
    if (weekday != null && !(Number.isInteger(weekday) && weekday >= 0 && weekday <= 7)) throw fail(400, 'Dia da semana: de 0 (domingo) a 6 (sábado).');
    if (weekday === 7) weekday = 0;
  }
  const day = (k, old) => { if (!has(k)) return old ?? null; if (b[k] == null || b[k] === '') return null; const d = cleanDay(b[k]); if (!d) throw fail(400, 'Cartão: data inválida (AAAA-MM-DD).'); return d; };
  const dateFrom = day('dateFrom', cur?.dateFrom); const dateTo = day('dateTo', cur?.dateTo);
  if (dateFrom && dateTo && dateTo < dateFrom) throw fail(400, 'Cartão: o último dia vem antes do primeiro.');
  const sort = has('sort') ? Math.round(Number(b.sort)) : Number(cur?.sort) || 0;
  if (!Number.isInteger(sort) || Math.abs(sort) > 100000) throw fail(400, 'Ordem do cartão inválida.');
  const seconds = has('seconds') ? Math.round(Number(b.seconds)) : Number(cur?.seconds) || LIMITS.cardSeconds;
  if (!(seconds >= LIMITS.cardSecondsMin && seconds <= LIMITS.cardSecondsMax)) throw fail(400, `Tempo do cartão: de ${LIMITS.cardSecondsMin} a ${LIMITS.cardSecondsMax} segundos.`);
  return { kind, title, lines, weekday, dateFrom, dateTo, sort, seconds, class: has('class') ? cleanClass(b.class) : cur?.class || DEFAULT_CLASS };
}
const parseLines = (s) => { try { const v = typeof s === 'string' ? JSON.parse(s) : s; return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
/** Linha do banco -> o cartão do painel. */
export const cardFromRow = (r) => ({
  id: Number(r.id), officeId: Number(r.office_id), kind: r.kind, title: r.title, lines: parseLines(r.lines), weekday: r.weekday == null ? null : Number(r.weekday),
  dateFrom: r.date_from || null, dateTo: r.date_to || null, sort: Number(r.sort) || 0, seconds: Number(r.seconds) || LIMITS.cardSeconds, class: r.class || DEFAULT_CLASS,
  createdBy: r.created_by || '', updatedAt: r.updated_at == null ? null : Number(r.updated_at),
});
/** O cartão vale neste dia? (o dia da semana dele, se tiver, e o período, se tiver). */
export const cardActive = (c, { day, weekday }) => (c.weekday == null || c.weekday === weekday) && (!c.dateFrom || c.dateFrom <= day) && (!c.dateTo || c.dateTo >= day);
/**
 * Os cartões que a tela recebe hoje (contrato §7.1): os do dia, dos tipos que a repartição usa, sem os institucionais no
 * período eleitoral, na ordem (sort, id), até 12. id = "<tipo>-<número>".
 */
export function cardsFor(cards, { now = Date.now(), kinds = CARD_KIND_KEYS, electoral = false } = {}) {
  const today = localDay(now);
  return cards.filter((c) => kinds.includes(c.kind) && cardActive(c, today) && !withheld(c.class, electoral) && c.lines.length)
    .sort((a, b) => a.sort - b.sort || a.id - b.id).slice(0, LIMITS.cardsSent)
    .map((c) => ({ id: `${c.kind}-${c.id}`, title: line(c.title, LIMITS.cardTitle), lines: c.lines.slice(0, LIMITS.cardLines).map((l) => line(l, LIMITS.cardLine)), seconds: c.seconds }));
}

/* ------------------------------------------------------------------ clima (contrato §7.1 "weather") */
export const WEATHER_HOLD_MS = 30 * 60_000;
const ICONS = ['clear', 'cloudy', 'partly', 'rain', 'storm', 'fog'];
/**
 * A previsão do servidor (server/weather.js forecast()) no formato do contrato. tempC: a temperatura de agora quando a fonte
 * informa; senão (INMET) a máxima de hoje (ou a mínima, sem a máxima). Sem número: null (a tela fica sem clima).
 */
export function weatherContract(f, at = Date.now()) {
  if (!f || typeof f !== 'object') return null;
  const t = f.now?.temp ?? f.today?.max ?? f.today?.min;
  if (t == null || t === '' || !Number.isFinite(Number(t))) return null;
  const cond = f.now?.cond || f.today?.cond;
  return { city: line(f.place?.city, 60), tempC: Math.round(Number(t)), condition: line(f.now?.text || f.today?.text, 60), icon: ICONS.includes(cond) ? cond : 'cloudy', at };
}
/**
 * O clima de cada cidade, segurado: a tela recebe o MESMO objeto (com o mesmo `at`) por holdMs, e só então o servidor busca
 * de novo (em segundo plano: a configuração nunca espera o provedor). Assim o rev da configuração não muda por causa do
 * clima mais que uma vez a cada 30 min. fetch(key) -> a previsão (ou lança).
 */
export function createWeatherHold({ fetch, now = () => Date.now(), holdMs = WEATHER_HOLD_MS, retryMs = 5 * 60_000, max = 500 }) {
  const held = new Map(); // cidade -> { value, at (da última busca que deu certo), triedAt, busy }
  async function refresh(key, h) {
    h.busy = true; h.triedAt = now();
    try {
      const v = weatherContract(await fetch(key), now());
      if (v) { h.value = v; h.at = v.at; } else if (h.at && now() - h.at > 6 * 3600_000) h.value = null; // previsão velha demais: some
    } catch { if (h.at && now() - h.at > 6 * 3600_000) h.value = null; } finally { h.busy = false; }
  }
  return {
    /** O clima guardado da cidade (ou null) agora; dispara a busca em segundo plano quando venceu. */
    get(key) {
      if (key == null || key === '') return null;
      let h = held.get(key);
      if (!h) { if (held.size >= max) held.delete(held.keys().next().value); h = { value: null, at: 0, triedAt: 0, busy: false, p: null }; held.set(key, h); }
      const t = now();
      const due = h.at ? t - h.at >= holdMs && t - h.triedAt >= retryMs : t - h.triedAt >= retryMs || !h.triedAt;
      if (due && !h.busy) h.p = refresh(key, h);
      return h.value;
    },
    /** Espera a busca em curso (testes e a 1ª configuração depois de escolher a cidade). */
    async settle(key) { await held.get(key)?.p; return held.get(key)?.value ?? null; },
    clear() { held.clear(); },
  };
}

/* ------------------------------------------------------------------ vídeos guardados (offline.items) */
/**
 * O que a tela recebe em offline.items: só vídeo com endereço https, tamanho e SHA-256 já calculado (sem o hash o item
 * espera), sem os institucionais no período eleitoral, sem repetir, até LIMITS.offlineSent.
 * rows: [{ mediaId, url, sha256, bytes, class }] na ordem (padrão, grupos, repartição).
 */
export function offlineItems(rows, { electoral = false } = {}) {
  const seen = new Set(); const out = [];
  for (const r of rows) {
    if (seen.has(r.mediaId) || withheld(r.class, electoral)) continue;
    if (!/^[0-9a-f]{64}$/.test(String(r.sha256 || '')) || !(Number(r.bytes) > 0) || !/^https:\/\//i.test(String(r.url || ''))) continue;
    seen.add(r.mediaId);
    out.push({ url: r.url, sha256: r.sha256, bytes: Number(r.bytes) });
    if (out.length >= LIMITS.offlineSent) break;
  }
  return out;
}

/* ------------------------------------------------------------------ alerta de emergência do canal (EAS) nas telas */
/** Os ids dos alertas que vêm do EAS do canal ficam acima disto (cabem em 32 bits e nunca batem com os de telas_alerts). */
export const EAS_ID_BASE = 1_000_000_000;
/**
 * O alerta do EAS no ar como um alerta `critical` do contrato §3. a: { id, event, headline, description, instruction,
 * areas, endAt, expires, tone }. Alerta de teste não vai às telas (quem chama filtra).
 */
export function easAlert(a, now = Date.now()) {
  const until = [a.endAt, a.expires].map(Number).find((x) => Number.isFinite(x) && x > now) || now + 10 * 60_000;
  const body = [a.headline, a.description, a.instruction].map((s) => String(s ?? '').trim()).filter(Boolean).join('\n');
  return {
    id: EAS_ID_BASE + (Number(a.id) % EAS_ID_BASE), title: line(a.event || 'Alerta de emergência', LIMITS.alertTitle),
    text: body.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, ' ').slice(0, LIMITS.alertText), level: 'critical', sound: Boolean(a.tone), until: Math.round(until),
  };
}

/* ------------------------------------------------------------------ disponibilidade (tela desligada) */
/**
 * Quanto tempo a tela ficou no ar numa janela. events: as mudanças de situação em ordem ({ status: 'on'|'warn'|'off', at });
 * a situação no começo da janela é a da última mudança antes dela. O tempo antes da primeira mudança conhecida não conta
 * (a tela ainda não existia). Devolve { pct (0 a 100, uma casa) | null, onMs, observedMs }.
 */
export function availability(events, { from, to }) {
  let state = null; let cursor = from; let on = 0; let observed = 0;
  const step = (until) => { if (state && until > cursor) { observed += until - cursor; if (state === 'on') on += until - cursor; } cursor = Math.max(cursor, until); };
  for (const e of events) {
    const at = Number(e.at);
    if (at <= from) { state = e.status; continue; }
    if (at >= to) break;
    step(at); state = e.status; cursor = at;
  }
  step(to);
  return { pct: observed > 0 ? Math.round((on / observed) * 1000) / 10 : null, onMs: on, observedMs: observed };
}
/** "há 3 h", "há 2 dias" (para o e-mail e a auditoria). */
export const agoText = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 90 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} dias`; };
