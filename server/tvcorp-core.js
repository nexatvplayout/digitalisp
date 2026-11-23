// NEXA Telas · TV Corporativa, pacote A (docs/TV-CORPORATIVA.md §4 e §5.4): as regras sem banco. A limpeza do que o painel
// manda (layout por zonas, slide de modelo, playlist e itens, grade e alcance, configurações), a resolução da grade (qual
// bloco vale em cada tela, por prioridade, especificidade e data), a montagem da chave `signage` do /config e a leitura do
// `plays` do sinal de vida. O banco e as rotas ficam em server/tvcorp.js; o catálogo em public/shared/tvcorp-tipos.js.
import { qrKind } from '../public/shared/qr-conteudo.js';
import {
  TVC_LIMITS as L, TVC_ZONE, TVC_ZONE_KEYS, TVC_ZONE_ID_RE, TVC_PLAYLIST_ZONES, TVC_ORIENTATION_KEYS, TVC_LAYOUT_MODEL, TVC_SLIDE_MODEL,
  TVC_REF_KIND, TVC_SCOPE, TVC_SCOPE_KEYS, TVC_ITEM_KINDS, TVC_FIT_KEYS, TVC_POST_CATEGORY_KEYS, itemRef, parseItemRef, tvcScopeHits,
} from '../public/shared/tvcorp-tipos.js';

export const DEFAULT_TZ = 'America/Sao_Paulo';
export const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra ? { extra } : {}) });
export const parseJson = (s, d) => { try { const v = s ? JSON.parse(s) : d; return v ?? d; } catch { return d; } };
/** Texto de uma linha: sem caracteres de controle, espaços juntos, até max. */
export const line = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Texto com quebras de linha (até `lines` linhas), sem os outros caracteres de controle, até max. */
export function text(v, max, lines = L.textLines) {
  const s = String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/[ \t]+/g, ' ')
    .split('\n').map((x) => x.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return s.split('\n').slice(0, lines).join('\n').slice(0, max).trim();
}
export const idOf = (v, what = 'Id') => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw fail(400, `${what} inválido.`); return n; };
const optId = (v, what) => (v == null || v === '' ? null : idOf(v, what));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o ?? {}, k);
export const COLOR_RE = /^#[0-9a-f]{6}$/i;
export function cleanColor(v, what = 'Cor') { if (!COLOR_RE.test(String(v ?? ''))) throw fail(400, `${what}: use o formato #rrggbb.`); return String(v).toLowerCase(); }
export function cleanName(v, what = 'Nome', max = L.name) {
  const s = line(v, max);
  if (s.length < 2) throw fail(400, `${what}: de 2 a ${max} caracteres.`);
  return s;
}
/** Endereço https (sem usuário e senha no endereço), até 500 caracteres. */
/** O conteúdo de um QR code: endereço https, Wi-Fi (WIFI:…) ou cartão de contato (BEGIN:VCARD…), até 600 letras. */
export function cleanQrData(v, what = 'QR code') {
  const s = String(v ?? '').replace(/\r\n/g, '\n').trim();
  if (/^WIFI:/i.test(s) || /^BEGIN:VCARD/i.test(s)) {
    if (s.length > 600 || !qrKind(s)) throw fail(400, `${what}: o Wi-Fi ou o contato está incompleto. Monte de novo pelo painel.`);
    return s;
  }
  return cleanUrl(s, what);
}
export function cleanUrl(v, what = 'Endereço') {
  const s = String(v ?? '').trim();
  let u = null;
  try { u = new URL(s); } catch { /* inválido */ }
  if (!u || u.protocol !== 'https:' || u.username || u.password || s.length > L.url || /\s/.test(s)) throw fail(400, `${what}: use um endereço https:// completo (até ${L.url} caracteres).`);
  return u.href;
}
export function cleanSeconds(v, def = L.secondsDefault) {
  if (v == null || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < L.secondsMin || n > L.secondsMax) throw fail(400, `Tempo na tela: de ${L.secondsMin} a ${L.secondsMax} segundos.`);
  return n;
}

/* ------------------------------------------------------------------ dias e horas no fuso da empresa */
export function cleanTz(v) {
  const s = String(v ?? '');
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(s)) throw fail(400, 'Fuso horário inválido.');
  try { new Intl.DateTimeFormat('en-US', { timeZone: s }); } catch { throw fail(400, 'Fuso horário inválido.'); }
  return s;
}
const fmtCache = new Map();
function fmtOf(tz) {
  if (!fmtCache.has(tz)) fmtCache.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }));
  return fmtCache.get(tz);
}
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** { day: 'AAAA-MM-DD', weekday: 0..6, minute: 0..1439 } no fuso. */
export function localParts(t, tz = DEFAULT_TZ) {
  const p = Object.fromEntries(fmtOf(tz).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, weekday: WD[p.weekday], minute: Number(p.hour) * 60 + Number(p.minute) };
}
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function validDay(s) {
  if (!DAY_RE.test(String(s ?? ''))) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function cleanDay(v, what = 'Data') {
  if (v == null || v === '') return null;
  if (!validDay(v)) throw fail(400, `${what}: use AAAA-MM-DD.`);
  return v;
}
export function addDays(day, n) { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const weekdayOf = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();
export const daySpan = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86_400_000);
/** Dias da semana: lista de 0..6 (ou "1,2,3"); vazio = todo dia. Devolve a lista ordenada sem repetir. */
export function cleanDays(v) {
  if (v == null || v === '') return [];
  const list = Array.isArray(v) ? v : String(v).split(',');
  const out = [...new Set(list.map((x) => (typeof x === 'string' && x.trim() === '' ? NaN : Number(x))))];
  if (out.some((n) => !Number.isInteger(n) || n < 0 || n > 6)) throw fail(400, 'Dias da semana: de 0 (domingo) a 6 (sábado).');
  out.sort((a, b) => a - b);
  return out.length === 7 ? [] : out;
}
export const daysText = (list) => (list || []).join(',');
export const daysOf = (s) => { try { return cleanDays(s); } catch { return []; } };
/** Minuto do dia (0 a 1440) a partir de número ou "HH:MM". */
export function cleanMinute(v, def, what = 'Horário') {
  if (v == null || v === '') return def;
  let n = v;
  if (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v)) { const [h, m] = v.split(':').map(Number); n = h * 60 + m; if (m > 59) n = NaN; }
  n = Number(n);
  if (!Number.isInteger(n) || n < 0 || n > 1440) throw fail(400, `${what}: de 00:00 a 24:00.`);
  return n;
}

/* ------------------------------------------------------------------ layout por zonas */
const cleanPct = (v, what) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 100) throw fail(400, `${what}: números inteiros de 0 a 100 (em % da tela).`); return n; };
/** Uma zona (contrato §4.1): id, posição em % e o tipo; os campos próprios do tipo (texto fixo, QR, rótulo). */
export function cleanZone(z, i = 0) {
  const what = `Zona ${i + 1}`;
  const id = String(z?.id ?? '');
  if (!TVC_ZONE_ID_RE.test(id)) throw fail(400, `${what}: o nome curto usa letras minúsculas, números e hífen (até 16).`);
  const kind = z?.kind;
  if (!TVC_ZONE_KEYS.includes(kind)) throw fail(400, `${what}: tipo de zona inválido.`);
  const x = cleanPct(z.x, what); const y = cleanPct(z.y, what); const w = cleanPct(z.w, what); const h = cleanPct(z.h, what);
  if (w < L.zoneMinPct || h < L.zoneMinPct) throw fail(400, `${what}: largura e altura de pelo menos ${L.zoneMinPct}% da tela.`);
  if (x + w > 100 || y + h > 100) throw fail(400, `${what}: passa da borda da tela.`);
  const out = { id, kind, x, y, w, h };
  const params = TVC_ZONE[kind].params || [];
  if (params.includes('title')) { const t = line(z.title, L.label); if (t) out.title = t; }
  if (params.includes('text')) { const t = line(z.text, L.zoneText); if (t) out.text = t; }
  if (params.includes('qr') && z.qr) out.qr = cleanQrData(z.qr, `${what}, QR code`);
  if (kind === 'qr' && !out.qr) throw fail(400, `${what}: diga o endereço do QR code.`);
  // o gadget (contador, dias sem acidente, relógio mundial) escolhido direto no layout: o id do bloco do cliente
  if (params.includes('widget') && z.widget != null && z.widget !== '') out.widget = idOf(z.widget, `${what}, gadget`);
  // DIGITAL ISP: a zona por cima das outras (widget sobre a imagem), com o fundo translúcido (opacity, 0 a 100 %)
  if (z.overlay === true) {
    if (kind === 'video') throw fail(400, `${what}: o vídeo não pode ficar por cima das outras zonas.`);
    out.overlay = true;
    const op = z.opacity == null || z.opacity === '' ? 60 : Math.round(Number(z.opacity));
    if (!Number.isFinite(op) || op < 0 || op > 100) throw fail(400, `${what}: a opacidade do fundo vai de 0 a 100.`);
    out.opacity = op;
  }
  if (TVC_PLAYLIST_ZONES.includes(kind) && z.hint && TVC_REF_KIND[z.hint]) out.hint = z.hint;
  return out;
}
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** As zonas: de 1 a 6, ids sem repetir, no máximo um vídeo, sem uma zona por cima da outra. */
export function cleanZones(list) {
  if (!Array.isArray(list) || !list.length) throw fail(400, 'O layout precisa de pelo menos uma zona.');
  if (list.length > L.zones) throw fail(400, `No máximo ${L.zones} zonas por layout.`);
  const zones = list.map(cleanZone);
  if (new Set(zones.map((z) => z.id)).size !== zones.length) throw fail(400, 'Duas zonas com o mesmo nome curto.');
  if (zones.filter((z) => z.kind === 'video').length > L.videoZones) throw fail(400, 'No máximo uma zona de vídeo por layout.');
  // a de cima pode ficar sobre a de baixo; duas da mesma camada, não
  for (let i = 0; i < zones.length; i++) for (let k = i + 1; k < zones.length; k++) {
    if (Boolean(zones[i].overlay) === Boolean(zones[k].overlay) && overlap(zones[i], zones[k])) throw fail(400, `As zonas "${zones[i].id}" e "${zones[k].id}" estão uma por cima da outra.`);
  }
  // a ordem é a de desenhar: primeiro a camada de baixo, depois a de cima
  return [...zones.filter((z) => !z.overlay), ...zones.filter((z) => z.overlay)];
}
/** Fundo do layout: só uma cor (#rrggbb); o app não desenha imagem de fundo. */
export function cleanBackground(v) {
  if (v == null || v === '') return null;
  return cleanColor(v, 'Cor de fundo');
}
/** O layout que o painel mandou (cur: o guardado, numa edição; factoryKey sem zonas: copia o modelo de fábrica). */
export function cleanLayout(b, cur = null) {
  const model = b?.factoryKey != null && b.factoryKey !== '' ? TVC_LAYOUT_MODEL[b.factoryKey] : null;
  if (b?.factoryKey != null && b.factoryKey !== '' && !model) throw fail(400, 'Modelo de layout inválido.');
  const base = cur || (model ? { name: model.label, orientation: model.orientation, zones: model.zones, background: model.background, factoryKey: model.key } : null);
  if (!base && !has(b, 'zones')) throw fail(400, 'Escolha um modelo de layout ou mande as zonas.');
  const name = has(b, 'name') ? cleanName(b.name, 'Nome do layout') : cleanName(base?.name, 'Nome do layout');
  const orientation = has(b, 'orientation') ? b.orientation : base?.orientation ?? 'land';
  if (!TVC_ORIENTATION_KEYS.includes(orientation)) throw fail(400, 'Orientação inválida (deitada ou em pé).');
  const zones = cleanZones(has(b, 'zones') ? b.zones : base.zones);
  const background = has(b, 'background') ? cleanBackground(b.background) : base?.background ?? null;
  return { name, orientation, zones, background, factoryKey: model ? model.key : cur?.factoryKey ?? null };
}

/* ------------------------------------------------------------------ slide de modelo */
/**
 * Os campos do slide pelo modelo (catálogo). Devolve { fields, mediaIds } (as imagens citadas, para quem chama conferir
 * que são do cliente). Campo obrigatório vazio: 400. Campo fora do modelo: some.
 */
export function cleanSlide(template, input) {
  const model = TVC_SLIDE_MODEL[template];
  if (!model) throw fail(400, 'Modelo de slide inválido.');
  const fields = {}; const mediaIds = [];
  for (const f of model.fields) {
    const v = input?.[f.key];
    if (v == null || v === '') { if (f.required) throw fail(400, `${f.label}: campo obrigatório neste modelo.`); continue; }
    switch (f.type) {
      case 'line': { const s = line(v, f.max || L.title); if (s) fields[f.key] = s; break; }
      case 'text': { const s = text(v, f.max || L.text); if (s) fields[f.key] = s; break; }
      case 'url': fields[f.key] = cleanUrl(v, f.label); break;
      case 'media': { const id = idOf(typeof v === 'object' ? v.id : v, f.label); fields[f.key] = id; mediaIds.push(id); break; }
      case 'date': fields[f.key] = cleanDay(v, f.label); break;
      case 'datetime': {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(v)) || !validDay(String(v).slice(0, 10)) || Number(String(v).slice(11, 13)) > 23 || Number(String(v).slice(14, 16)) > 59) throw fail(400, `${f.label}: use AAAA-MM-DDTHH:MM.`);
        fields[f.key] = String(v); break;
      }
      case 'color': fields[f.key] = cleanColor(v, f.label); break;
      case 'choice': if (!f.options.includes(v)) throw fail(400, `${f.label}: opção inválida.`); fields[f.key] = v; break;
      default: break;
    }
    if (f.required && (fields[f.key] == null || fields[f.key] === '')) throw fail(400, `${f.label}: campo obrigatório neste modelo.`);
  }
  return { fields, mediaIds };
}

/* ------------------------------------------------------------------ playlist e itens */
export function cleanPlaylist(b, cur = null) {
  return {
    name: has(b, 'name') || !cur ? cleanName(b?.name, 'Nome da playlist') : cur.name,
    description: has(b, 'description') ? line(b.description, L.description) : cur?.description ?? '',
    shuffle: has(b, 'shuffle') ? Boolean(b.shuffle) : Boolean(cur?.shuffle),
    sort: has(b, 'sort') ? Math.max(-1e6, Math.min(1e6, Math.round(Number(b.sort) || 0))) : Number(cur?.sort) || 0,
  };
}
/** Os parâmetros de um item automático (quantos nomes, que período): só números e chaves curtas. */
function cleanParams(p) {
  if (p == null) return {};
  if (typeof p !== 'object' || Array.isArray(p)) throw fail(400, 'Parâmetros do item inválidos.');
  const out = {};
  for (const [k, v] of Object.entries(p).slice(0, 10)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,23}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = line(v, 60);
    else if (Array.isArray(v)) out[k] = v.filter((x) => Number.isInteger(x) || typeof x === 'string').slice(0, 20).map((x) => (typeof x === 'string' ? line(x, 40) : x));
  }
  return out;
}
/** Um item da playlist: o que é (e o id do cadastro), o tempo, a validade, os dias e a faixa de horário. */
export function cleanItem(it, i = 0) {
  const what = `Item ${i + 1}`;
  const k = TVC_REF_KIND[it?.refKind];
  if (!k) throw fail(400, `${what}: tipo de item inválido.`);
  const refId = k.needsId ? idOf(it.refId, `${what}: o cadastro`) : optId(it.refId, `${what}: a fonte`);
  const validFrom = cleanDay(it.validFrom, `${what}: início`); const validTo = cleanDay(it.validTo, `${what}: fim`);
  if (validFrom && validTo && validTo < validFrom) throw fail(400, `${what}: o fim vem antes do início.`);
  const timeFrom = it.timeFrom == null || it.timeFrom === '' ? null : cleanMinute(it.timeFrom, null, `${what}: horário`);
  const timeTo = it.timeTo == null || it.timeTo === '' ? null : cleanMinute(it.timeTo, null, `${what}: horário`);
  if ((timeFrom == null) !== (timeTo == null)) throw fail(400, `${what}: diga o horário de início e de fim (ou nenhum).`);
  if (timeFrom != null && timeFrom === timeTo) throw fail(400, `${what}: o horário de início e de fim são iguais.`);
  return { refKind: it.refKind, refId, params: cleanParams(it.params), seconds: cleanSeconds(it.seconds), validFrom, validTo, days: cleanDays(it.days), timeFrom, timeTo };
}
export function cleanItems(list) {
  if (!Array.isArray(list)) throw fail(400, 'Mande a lista de itens.');
  if (list.length > L.playlistItems) throw fail(400, `No máximo ${L.playlistItems} itens por playlist.`);
  return list.map(cleanItem);
}

/* ------------------------------------------------------------------ alcance e grade */
const idList = (v, what) => {
  if (!Array.isArray(v) || !v.length) throw fail(400, `${what}: escolha pelo menos um.`);
  const ids = [...new Set(v.map((x) => idOf(x, what)))];
  if (ids.length > 500) throw fail(400, `${what}: no máximo 500.`);
  return ids;
};
/** O alcance da grade: all, regions, offices, groups ou devices (com a lista de ids). "city" (dos alertas) vale como all. */
export function cleanTvcScope(s) {
  const kind = s?.kind === 'city' ? 'all' : s?.kind;
  if (!TVC_SCOPE_KEYS.includes(kind)) throw fail(400, 'Alcance inválido.');
  if (kind === 'all') return { kind };
  const list = TVC_SCOPE[kind].list;
  return { kind, [list]: idList(s[list], TVC_SCOPE[kind].label) };
}
export const scopeToRow = ({ kind, ...data }) => ({ scope: kind, scope_data: JSON.stringify(data) });
export const scopeFromRow = (row) => ({ kind: row.scope, ...parseJson(row.scope_data, {}) });
export const scopeSpec = (scope) => TVC_SCOPE[scope?.kind]?.spec ?? -1;

/** A grade que o painel mandou (cur: a guardada, numa edição). Os ids (layout, playlists, alcance) o servidor confere. */
export function cleanSchedule(b, cur = null) {
  const get = (k, d) => (has(b, k) ? b[k] : cur ? cur[k] : d);
  const name = cleanName(get('name'), 'Nome da grade');
  const layoutId = idOf(get('layoutId'), 'Layout');
  const zp = get('zonePlaylists', {});
  if (!zp || typeof zp !== 'object' || Array.isArray(zp)) throw fail(400, 'Playlists das zonas inválidas.');
  const zonePlaylists = {};
  for (const [z, p] of Object.entries(zp)) {
    if (!TVC_ZONE_ID_RE.test(z)) throw fail(400, 'Zona inválida nas playlists.');
    if (p == null || p === '') continue;
    zonePlaylists[z] = idOf(p, `Playlist da zona "${z}"`);
  }
  const scope = cleanTvcScope(get('scope', { kind: 'all' }));
  const days = cleanDays(get('days', []));
  const timeFrom = cleanMinute(get('timeFrom', 0), 0, 'Início da faixa');
  const timeTo = cleanMinute(get('timeTo', 1440), 1440, 'Fim da faixa');
  if (timeFrom === timeTo || (timeFrom === 1440)) throw fail(400, 'Faixa de horário vazia.');
  const dateFrom = cleanDay(get('dateFrom', null), 'Início do período'); const dateTo = cleanDay(get('dateTo', null), 'Fim do período');
  if (dateFrom && dateTo && dateTo < dateFrom) throw fail(400, 'O período termina antes de começar.');
  const pr = Number(get('priority', 0));
  if (!Number.isInteger(pr) || pr < L.priorityMin || pr > L.priorityMax) throw fail(400, `Prioridade: de ${L.priorityMin} a ${L.priorityMax}.`);
  return { name, layoutId, zonePlaylists, scope, days, timeFrom, timeTo, dateFrom, dateTo, priority: pr };
}
/** As zonas do layout que pedem playlist; as playlists apontadas para outra zona são descartadas (a zona sumiu do layout). */
export function zonePlaylistsFor(zones, zonePlaylists) {
  const ok = new Set(zones.filter((z) => TVC_PLAYLIST_ZONES.includes(z.kind)).map((z) => z.id));
  return Object.fromEntries(Object.entries(zonePlaylists || {}).filter(([z]) => ok.has(z)));
}

/* ------------------------------------------------------------------ configurações da empresa */
export const THEME_MODES = Object.freeze(['dark', 'light']);
/** O que se guarda em tvcorp_settings.data (fora a logomarca, que tem rota própria). */
export function cleanSettings(b, cur = {}) {
  const out = { ...cur };
  if (has(b, 'theme')) {
    const t = b.theme || {};
    out.theme = { color: t.color == null || t.color === '' ? null : cleanColor(t.color, 'Cor da empresa'), mode: THEME_MODES.includes(t.mode) ? t.mode : 'dark' };
  }
  if (has(b, 'tz')) out.tz = cleanTz(b.tz);
  if (has(b, 'approval')) out.approval = Boolean(b.approval);
  if (has(b, 'fullNames')) out.fullNames = Boolean(b.fullNames);
  if (has(b, 'defaultSchedule')) out.defaultSchedule = optId(b.defaultSchedule, 'Grade padrão');
  if (has(b, 'categories')) {
    if (!Array.isArray(b.categories)) throw fail(400, 'Categorias inválidas.');
    out.categories = [...new Set(b.categories)].filter((c) => TVC_POST_CATEGORY_KEYS.includes(c));
  }
  if (has(b, 'dates')) {
    if (!Array.isArray(b.dates) || b.dates.length > 200) throw fail(400, 'Datas comemorativas inválidas.');
    out.dates = [...new Set(b.dates.map(String))].filter((d) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(d));
  }
  return out;
}
export function settingsDto(data) {
  const d = data || {};
  return {
    theme: { color: d.theme?.color ?? null, mode: d.theme?.mode === 'light' ? 'light' : 'dark' },
    tz: d.tz || DEFAULT_TZ, approval: Boolean(d.approval), fullNames: Boolean(d.fullNames), defaultSchedule: d.defaultSchedule ?? null,
    categories: Array.isArray(d.categories) ? d.categories : [...TVC_POST_CATEGORY_KEYS], dates: Array.isArray(d.dates) ? d.dates : [],
    logo: d.logo ? { bytes: Number(d.logo.bytes) || 0, sha256: d.logo.sha256, at: d.logo.at ?? null } : null,
  };
}
/** Opções da imagem enviada: orientação, cobrir ou encaixar e a cor do fundo do encaixe. */
export function cleanImageOptions(q = {}) {
  const orientation = q.orientation == null || q.orientation === '' ? 'land' : q.orientation;
  if (!TVC_ORIENTATION_KEYS.includes(orientation)) throw fail(400, 'Orientação inválida (deitada ou em pé).');
  const fit = q.fit == null || q.fit === '' ? 'cover' : q.fit;
  if (!TVC_FIT_KEYS.includes(fit)) throw fail(400, 'Encaixe inválido (cobrir ou mostrar inteira).');
  const bg = q.bg == null || q.bg === '' ? '#000000' : cleanColor(String(q.bg).startsWith('#') ? q.bg : `#${q.bg}`, 'Cor do fundo');
  return { orientation, fit, bg };
}

/* ------------------------------------------------------------------ a resolução da grade */
/** Um minuto vale na faixa? Faixa que vira a noite (from > to): de from até 24:00 no dia e de 00:00 até to no seguinte. */
function minutesOn(block, offset, day) {
  // devolve os intervalos [a, b) em minutos da janela (0 = 00:00 de hoje) em que o bloco vale, vindos do dia `day` (offset)
  const okDay = (!block.dateFrom || day >= block.dateFrom) && (!block.dateTo || day <= block.dateTo) && (!block.days.length || block.days.includes(weekdayOf(day)));
  if (!okDay) return [];
  const base = offset * 1440;
  if (block.timeFrom < block.timeTo) return [[base + block.timeFrom, base + block.timeTo]];
  return [[base + block.timeFrom, base + 1440], [base + 1440, base + 1440 + block.timeTo]];
}
/**
 * A ordem da grade: maior prioridade; empate = a mais específica (tela > grupo > unidade > região > empresa); depois a mais
 * nova (o maior id).
 */
export const blockOrder = (a, b) => (b.priority - a.priority) || (scopeSpec(b.scope) - scopeSpec(a.scope)) || (Number(b.id) - Number(a.id));
/**
 * As grades que valem para a tela hoje e amanhã (today: o dia local), na ordem da grade. Corta o que nunca apareceria: um
 * bloco é mandado só se, em algum minuto de hoje ou de amanhã, ele está entre os `blocksActive` (2) primeiros que valem
 * naquele minuto (o 2º é a reserva quando a playlist do 1º está vazia ou o layout falha). No máximo `blocksSent` blocos.
 * at: { deviceId, officeId, regionId, groupIds }. fallbackId: a grade padrão da empresa (vai sempre, se pega a tela).
 */
export function resolveBlocks(schedules, at, { today, fallbackId = null, active = L.blocksActive, max = L.blocksSent } = {}) {
  const hits = schedules.filter((s) => s.status === 'ok' && tvcScopeHits(s.scope, at)).sort(blockOrder);
  const cover = new Uint8Array(2 * 1440);
  const out = []; let fallback = null;
  for (const s of hits) {
    if (fallbackId != null && Number(s.id) === Number(fallbackId)) { fallback = s; continue; }
    let useful = false; const spans = [];
    for (const off of [-1, 0, 1]) for (const [a, b] of minutesOn(s, off, addDays(today, off))) {
      const lo = Math.max(0, a); const hi = Math.min(2 * 1440, b);
      if (lo < hi) spans.push([lo, hi]);
    }
    for (const [lo, hi] of spans) for (let m = lo; m < hi; m++) if (cover[m] < active) { useful = true; break; }
    if (!useful) continue;
    for (const [lo, hi] of spans) for (let m = lo; m < hi; m++) if (cover[m] < 255) cover[m]++;
    out.push(s);
    if (out.length >= max - (fallbackId != null ? 1 : 0)) break;
  }
  return { blocks: out, fallback };
}
/** O bloco que vale agora (o mesmo critério do app): o 1º da lista cujo dia e faixa valem; nenhum = o fallback. */
export function blockNow(blocks, fallback, { day, minute }) {
  const yesterday = addDays(day, -1);
  for (const s of blocks) {
    const spans = [...minutesOn(s, -1, yesterday), ...minutesOn(s, 0, day)];
    if (spans.some(([a, b]) => minute >= a && minute < b)) return s;
  }
  return fallback || null;
}

/* ------------------------------------------------------------------ montagem do signage */
/** O item vale em algum momento entre hoje e amanhã? (validade e dias; a faixa de horário vai ao app). */
export function itemInWindow(it, today) {
  const tomorrow = addDays(today, 1);
  if (it.validTo && it.validTo < today) return false;
  if (it.validFrom && it.validFrom > tomorrow) return false;
  if (it.days?.length && ![today, tomorrow].some((d) => (!it.validFrom || d >= it.validFrom) && (!it.validTo || d <= it.validTo) && it.days.includes(weekdayOf(d)))) return false;
  return true;
}
/** As restrições do item que o app confere sozinho (só quando há): dias, faixa e período. */
/** As entradas do item na tela: corte seco (padrão), esmaecer, deslizar ou aproximar; e o zoom lento na foto (Ken Burns). */
export const TRANSITIONS = Object.freeze(['fade', 'slide', 'zoom']);
export function itemWhen(it) {
  const out = {};
  if (TRANSITIONS.includes(it.params?.transition)) out.transition = it.params.transition;
  if (it.params?.kenburns === true) out.kenburns = true;
  if (it.days?.length) out.days = it.days;
  if (it.timeFrom != null) { out.from = it.timeFrom; out.to = it.timeTo; }
  if (it.validFrom) out.dateFrom = it.validFrom;
  if (it.validTo) out.dateTo = it.validTo;
  return out;
}
/** Embaralha de um jeito que só muda de um dia para o outro (o rev fica parado no dia). */
export function dayShuffle(list, seed) {
  let h = 2166136261;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const rnd = () => { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [a[i], a[k]] = [a[k], a[i]]; }
  return a;
}
export const FILE_RE = /^https:\/\//i;
/** Um arquivo no formato do contrato ({ url https, sha256, bytes }) ou null. */
export function fileContract(url, sha256, bytes, maxBytes = L.imageBytes) {
  const n = Number(bytes);
  if (!FILE_RE.test(String(url || '')) || !/^[0-9a-f]{64}$/.test(String(sha256 || '')) || !(n >= 1 && n <= maxBytes)) return null;
  return { url, sha256, bytes: n };
}
/** Confere um item vindo dos provedores (pacote B): tipo conhecido, sem chaves estranhas de controle. */
export function cleanProvided(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item) || !TVC_ITEM_KINDS.includes(item.kind)) return null;
  return item;
}
/**
 * Aplica os tetos do contrato a todos os blocos: 60 itens por zona e, nos arquivos, 200 arquivos e 80 MB somados (um item
 * com arquivo que estoura o teto sai). Muda os blocos no lugar e devolve { files, bytes }.
 */
export function applyCaps(blocks) {
  const seen = new Map();
  const filesOf = (it) => {
    const out = [];
    const take = (f) => { if (f && typeof f === 'object' && typeof f.url === 'string' && f.sha256) out.push(f); };
    if (it.kind === 'image') take(it);
    take(it.image); take(it.media);
    for (const v of Object.values(it.fields || {})) take(v);
    for (const p of [...(it.people || []), ...(it.fields?.people || [])]) take(p?.photo);
    return out;
  };
  let bytes = 0;
  for (const b of blocks) {
    for (const [z, items] of Object.entries(b.zones)) {
      const kept = [];
      for (const it of items) {
        if (kept.length >= L.itemsPerZone) break;
        const fresh = filesOf(it).filter((f) => !seen.has(f.sha256));
        const add = fresh.reduce((s, f) => s + f.bytes, 0);
        if (fresh.length && (seen.size + fresh.length > L.cacheFiles || bytes + add > L.cacheBytes)) continue;
        for (const f of fresh) seen.set(f.sha256, f.bytes);
        bytes += add; kept.push(it);
      }
      b.zones[z] = kept;
    }
  }
  return { files: seen.size, bytes };
}

/* ------------------------------------------------------------------ dados segurados (o rev não muda a cada minuto) */
/** Guarda o resultado de fn(key) por holdMs (o mesmo objeto). Erro: o último bom continua; sem ele, null. */
export function createHold({ holdMs = L.holdMs, now = () => Date.now(), max = 5000 } = {}) {
  const map = new Map();
  return {
    async get(key, fn) {
      const t = now(); const cur = map.get(key);
      if (cur && t - cur.at < holdMs) return cur.value;
      let value = null;
      try { value = await fn(); } catch { value = cur ? cur.value : null; }
      map.delete(key); map.set(key, { value, at: t });
      while (map.size > max) map.delete(map.keys().next().value);
      return value;
    },
    clear(prefix = '') { for (const k of [...map.keys()]) if (k.startsWith(prefix)) map.delete(k); },
    get size() { return map.size; },
  };
}

/* ------------------------------------------------------------------ plays do sinal de vida (contrato §4.3) */
/**
 * O `plays` que o app mandou: até 100 entradas { ref, n, sec }, somadas por ref; ref fora do formato some. day: o
 * playsDay (AAAA-MM-DD) se for hoje ou ontem, senão hoje. Devolve { day, list: [{ ref, refKind, refId, n, sec }] }.
 */
export function cleanPlays(body, { today }) {
  const raw = Array.isArray(body?.plays) ? body.plays.slice(0, L.playsPerBeat) : [];
  const yesterday = addDays(today, -1);
  const day = body?.playsDay === today || body?.playsDay === yesterday ? body.playsDay : today;
  const acc = new Map();
  for (const p of raw) {
    const r = parseItemRef(p?.ref);
    const n = Number(p?.n); const sec = Number(p?.sec ?? 0);
    if (!r || !Number.isInteger(n) || n < 0 || n > L.playsMaxN || !Number.isFinite(sec) || sec < 0) continue;
    const key = String(p.ref);
    const cur = acc.get(key) || { ref: key, ...r, n: 0, sec: 0 };
    cur.n = Math.min(L.playsMaxN, cur.n + n); cur.sec = Math.min(L.playsMaxSec, cur.sec + Math.round(sec));
    acc.set(key, cur);
  }
  return { day, list: [...acc.values()].filter((x) => x.n > 0 || x.sec > 0) };
}

/* ------------------------------------------------------------------ relatórios */
/** CSV para planilha brasileira: separado por ponto e vírgula, com BOM, sem fórmula (célula que começa com = + - @ ganha '). */
export function toCsv(cols, rows) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[cols.map((c) => cell(c.label)), ...rows.map((r) => cols.map((c) => cell(r[c.key])))].map((r) => r.join(';')).join('\r\n')}\r\n`;
}
/** Período do relatório: from e to (AAAA-MM-DD); sem eles, os últimos 30 dias; no máximo 400 dias. */
export function cleanPeriod(q, today) {
  const to = cleanDay(q?.to, 'Até') || today;
  const from = cleanDay(q?.from, 'De') || addDays(to, -29);
  if (from > to) throw fail(400, 'O período termina antes de começar.');
  if (daySpan(from, to) >= L.reportDays) throw fail(400, `Período de no máximo ${L.reportDays} dias.`);
  return { from, to };
}
export const hoursText = (sec) => `${Math.floor(sec / 3600)} h ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')} min`;

export { itemRef, parseItemRef };
