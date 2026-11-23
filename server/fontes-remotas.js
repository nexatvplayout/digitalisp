// DIGITAL ISP · fontes que o gadget busca sozinho: a agenda pública do Google Agenda ou do Outlook (endereço .ics) e a
// planilha publicada do Google (CSV) para o cardápio e a tabela de preços. Busca só https público (safeFetch: sem rede
// interna), guarda em memória por 15 min e, se a fonte cair, continua com o que já tinha. A tela nunca espera mais que 4 s.
import { localParts, localToUtc, addDays, DEFAULT_TZ } from './tz.js';

export const REMOTE = Object.freeze({ ttlMs: 15 * 60_000, waitMs: 4000, maxBytes: 2 * 1024 * 1024, agendaDays: 45, maxEvents: 200 });

/** Endereço aceito: https público. webcal:// (o "endereço secreto" do Google e o link do Outlook) vira https://. */
export function cleanRemoteUrl(v, what) {
  let s = String(v ?? '').trim();
  if (!s) return '';
  if (/^webcal:\/\//i.test(s)) s = `https://${s.slice(9)}`;
  let u; try { u = new URL(s); } catch { throw Object.assign(new Error(`${what}: endereço inválido.`), { status: 400 }); }
  if (u.protocol !== 'https:') throw Object.assign(new Error(`${what}: use um endereço https://.`), { status: 400 });
  if (s.length > 1000) throw Object.assign(new Error(`${what}: endereço longo demais.`), { status: 400 });
  return u.toString();
}

/** A planilha do Google: o link de compartilhar (…/edit) vira o de baixar em CSV (…/export?format=csv). */
export function sheetCsvUrl(url) {
  const m = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)\/(?:edit|view)?[^#]*(?:#gid=(\d+))?/.exec(url);
  if (m && !/\/pub\?|output=csv|format=csv/.test(url)) return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${m[2] ? `&gid=${m[2]}` : ''}`;
  return url;
}

/* ------------------------------------------------------------------ cache */
const cache = new Map(); // url -> { at, data, busy }
/**
 * O dado da fonte: fresco (menos de 15 min) sai na hora; velho dispara a busca e sai o velho; sem nada, espera até 4 s.
 * load(url) -> dado (texto já interpretado). null se nunca deu certo.
 */
export async function remoteCached(url, load, { now = Date.now() } = {}) {
  if (cache.size > 5000) cache.clear();
  const c = cache.get(url);
  const refresh = () => {
    const cur = cache.get(url) || { at: 0, data: null };
    if (cur.busy) return cur.busy;
    cur.busy = load(url).then((data) => { cache.set(url, { at: Date.now(), data }); return data; })
      .catch(() => { cache.set(url, { ...cur, at: Date.now() - REMOTE.ttlMs + 60_000, busy: null }); return cur.data; }); // erro: tenta de novo em 1 min
    cache.set(url, cur);
    return cur.busy;
  };
  if (c && c.data != null && now - c.at < REMOTE.ttlMs) return c.data;
  const p = refresh();
  if (c && c.data != null) return c.data;
  return Promise.race([p, new Promise((r) => setTimeout(() => r(null), REMOTE.waitMs))]);
}
export const forgetRemote = (url) => cache.delete(url);

/* ------------------------------------------------------------------ iCal (.ics) */
const unfold = (s) => String(s).replace(/\r?\n[ \t]/g, '');
const unescape = (v) => String(v || '').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
function prop(line) {
  const i = line.indexOf(':'); if (i < 0) return null;
  const head = line.slice(0, i); const value = line.slice(i + 1);
  const [name, ...params] = head.split(';');
  return { name: name.toUpperCase(), params: Object.fromEntries(params.map((p) => { const [k, v] = p.split('='); return [String(k).toUpperCase(), String(v || '').replace(/^"|"$/g, '')]; })), value };
}
/** "20261123T090000" (+ TZID ou Z) ou "20261123" (dia inteiro) -> { ms, allDay } */
function icsTime(p, tz) {
  const v = String(p?.value || '').trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const ymd = { year: +m[1], month: +m[2], day: +m[3] };
  if (!m[4]) return { ms: localToUtc(ymd, 0, tz), allDay: true };
  const sec = +m[4] * 3600 + +m[5] * 60 + +(m[6] || 0);
  if (m[7]) return { ms: Date.UTC(ymd.year, ymd.month - 1, ymd.day) + sec * 1000, allDay: false };
  let zone = p.params?.TZID || tz;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch { zone = tz; }
  return { ms: localToUtc(ymd, sec, zone), allDay: false };
}
const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
/** As ocorrências de um evento com RRULE (diária, semanal, mensal, anual) entre from e to (ms). */
function expand(start, rule, from, to, tz, exdates) {
  const r = Object.fromEntries(String(rule).split(';').map((x) => x.split('=')).map(([k, v]) => [k.toUpperCase(), v]));
  const freq = r.FREQ; const step = Math.max(1, Number(r.INTERVAL) || 1);
  const until = r.UNTIL ? icsTime({ value: r.UNTIL }, tz)?.ms ?? Infinity : Infinity;
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const base = localParts(start, tz); const sec = base.sec;
  const byday = r.BYDAY ? r.BYDAY.split(',').map((d) => WD[d.slice(-2)]).filter((d) => d != null) : null;
  const out = []; let n = 0;
  const push = (ymd) => {
    const ms = localToUtc(ymd, sec, tz);
    if (ms < start || ms > until || n >= count) return false;
    n++;
    if (ms >= from && ms <= to && !exdates.has(ms)) out.push(ms);
    return true;
  };
  let day = { year: base.year, month: base.month, day: base.day };
  for (let i = 0; i < 2000 && out.length < 400; i++) {
    const ms0 = localToUtc(day, sec, tz);
    if (ms0 > to || ms0 > until || n >= count) break;
    if (freq === 'DAILY') { push(day); day = addDays(day, step); }
    else if (freq === 'WEEKLY') {
      const days = byday?.length ? byday : [new Date(Date.UTC(base.year, base.month - 1, base.day)).getUTCDay()];
      const wd = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
      const sunday = addDays(day, -wd);
      for (const d of [...days].sort()) push(addDays(sunday, d));
      day = addDays(sunday, 7 * step);
    } else if (freq === 'MONTHLY') { push(day); const m = day.month - 1 + step; day = { year: day.year + Math.floor(m / 12), month: (m % 12) + 1, day: base.day }; }
    else if (freq === 'YEARLY') { push(day); day = { ...day, year: day.year + step }; }
    else break;
  }
  return out;
}
/**
 * Os eventos de um .ics de hoje (from) até days dias depois, no fuso tz: [{ date AAAA-MM-DD, time? HH:MM, end? HH:MM, title,
 * place? }] em ordem. Eventos cancelados saem; os repetidos (RRULE) são abertos.
 */
export function icsEvents(text, { tz = DEFAULT_TZ, from = Date.now(), days = REMOTE.agendaDays } = {}) {
  const lines = unfold(text).split(/\r?\n/);
  const start0 = localToUtc(localParts(from, tz), 0, tz);
  const to = start0 + days * 86400_000;
  const out = [];
  let ev = null;
  for (const l of lines) {
    if (/^BEGIN:VEVENT/i.test(l)) { ev = { ex: new Set() }; continue; }
    if (/^END:VEVENT/i.test(l)) {
      if (ev?.start && ev.status !== 'CANCELLED' && !ev.recurId) {
        const dur = ev.end ? ev.end.ms - ev.start.ms : 0;
        const times = ev.rrule ? expand(ev.start.ms, ev.rrule, start0, to, tz, ev.ex) : (ev.start.ms + Math.max(dur, 0) >= start0 && ev.start.ms <= to ? [ev.start.ms] : []);
        for (const ms of times) {
          const a = localParts(Math.max(ms, ev.start.allDay ? ms : ms), tz); const b = dur > 0 ? localParts(ms + dur, tz) : null;
          const hm = (p) => `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
          const date = `${a.year}-${String(a.month).padStart(2, '0')}-${String(a.day).padStart(2, '0')}`;
          out.push({ date, ...(ev.start.allDay ? {} : { time: hm(a), ...(b ? { end: hm(b) } : {}) }), title: (ev.title || 'Compromisso').slice(0, 80), ...(ev.place ? { place: ev.place.slice(0, 60) } : {}), _ms: ms });
        }
      }
      ev = null; continue;
    }
    if (!ev) continue;
    const p = prop(l); if (!p) continue;
    if (p.name === 'DTSTART') ev.start = icsTime(p, tz);
    else if (p.name === 'DTEND') ev.end = icsTime(p, tz);
    else if (p.name === 'SUMMARY') ev.title = unescape(p.value);
    else if (p.name === 'LOCATION') ev.place = unescape(p.value);
    else if (p.name === 'RRULE') ev.rrule = p.value;
    else if (p.name === 'STATUS') ev.status = p.value.trim().toUpperCase();
    else if (p.name === 'RECURRENCE-ID') ev.recurId = true; // a exceção de um repetido: fica a regra (simples e seguro)
    else if (p.name === 'EXDATE') for (const v of p.value.split(',')) { const t = icsTime({ value: v, params: p.params }, tz); if (t) ev.ex.add(t.ms); }
  }
  return out.sort((x, y) => x._ms - y._ms).slice(0, REMOTE.maxEvents).map(({ _ms, ...e }) => e);
}

/* ------------------------------------------------------------------ planilha (CSV) do cardápio e da tabela de preços */
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const DIAS = { dom: 0, domingo: 0, seg: 1, segunda: 1, ter: 2, terca: 2, qua: 3, quarta: 3, qui: 4, quinta: 4, sex: 5, sexta: 5, sab: 6, sabado: 6 };
/**
 * As linhas da planilha -> { days: { '0'..'6': [{ name, price?, note? }] } }. Colunas pelo nome do cabeçalho (sem acento):
 * item|prato|produto|nome, preco|valor, descricao|obs, dia. Sem a coluna dia (ou dia vazio): vale todos os dias.
 * Dia aceita "seg", "segunda", "seg-feira", vários separados por vírgula ou "todos".
 */
export function sheetMenu(rows, { parseNumber = (v) => Number(String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) } = {}) {
  if (!Array.isArray(rows) || rows.length < 2) return { days: {} };
  const head = rows[0].map(norm);
  const col = (...names) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const ci = col('item', 'prato', 'produto', 'nome'); const cp = col('preco', 'valor'); const cd = col('descricao', 'obs', 'detalhe'); const cw = col('dia');
  if (ci < 0) return { days: {} };
  const days = {};
  for (const r of rows.slice(1)) {
    const name = String(r[ci] || '').trim().slice(0, 60); if (!name) continue;
    const raw = cp >= 0 ? String(r[cp] || '').trim() : '';
    const price = raw ? parseNumber(raw) : null;
    const note = cd >= 0 ? String(r[cd] || '').trim().slice(0, 60) : '';
    const item = { name, ...(Number.isFinite(price) && price >= 0 ? { price } : {}), ...(note ? { note } : {}) };
    const dw = cw >= 0 ? norm(r[cw]) : '';
    const list = !dw || dw === 'todos' || dw === 'todo dia' ? [0, 1, 2, 3, 4, 5, 6] : dw.split(/[,/;]/).map((x) => DIAS[x.trim().replace(/-?feira$/, '').trim()]).filter((x) => x != null);
    for (const w of list) { const k = String(w); (days[k] ||= []); if (days[k].length < 30) days[k].push(item); }
  }
  return { days };
}
