// Clima dos gadgets do app NEXA de TV (docs/APP-AGREGADOR.md, "Gadgets"). A fonte é escolhida no superadmin (Integrações →
// "Clima (gadgets do app de TV)") e vale na hora, sem reiniciar: um adaptador por provedor, todos no mesmo formato para a TV
// (forecast(), abaixo) e com o nome da fonte para a tela.
//
// O servidor só consulta o provedor para as cidades que algum espectador pediu (o código do IBGE da "Sua região" ou da
// região do canal), com cache por município (WEATHER_CACHE_MS, 30 min), uma consulta por vez por cidade, prazo, teto de
// corpo, de consultas simultâneas, de consultas por hora (WEATHER_CALLS_PER_HOUR) e de cidades guardadas. Sem dado, a TV
// recebe o motivo e não mostra número nenhum. A chave do provedor (quando há) fica cifrada na tabela settings
// (AES-256-GCM, com uma chave tirada de SESSION_SECRET): nunca volta ao navegador, nem vai para log ou auditoria.
//
// Provedores:
//   inmet       INMET, previsão por município (apiprevmet3, sem chave). Não tem "agora": hoje (o período do dia: manhã,
//               tarde ou noite) com mínima e máxima, umidade e vento descritos, e os próximos dias.
//   openmeteo   Open-Meteo, plano comercial (API Standard, com chave): agora, chance de chuva, vento em km/h e 5 dias. As
//               coordenadas vêm do geocodificador do próprio Open-Meteo (nome do município + estado).
//   climatempo  só o encaixe: sem adaptador até haver a documentação oficial da API (aparece "em breve" e não é aceito).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';
import { getSetting, setSetting } from './db.js';
import { municipio } from './br-places.js';
import { UFS } from '../public/shared/br-docs.js';
import { createLimiter } from './ratelimit.js';

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const envInt = (k, d) => { const v = Number(process.env[k]); return process.env[k] !== undefined && Number.isFinite(v) && v >= 0 ? v : d; };
const envUrl = (k, d) => String(process.env[k] || d).replace(/\/+$/, '');
const CACHE_MS = envInt('WEATHER_CACHE_MS', 30 * 60_000);
const ERR_MS = Math.min(CACHE_MS || 5 * 60_000, 5 * 60_000); // falha do provedor: pergunta de novo em até 5 min
const MAX_CITIES = envInt('WEATHER_MAX_CITIES', 2000) || 2000;
const CALLS_PER_HOUR = envInt('WEATHER_CALLS_PER_HOUR', 1200) || 1200; // pedidos ao provedor (o geocodificador conta)
// cidade nova (fora do cache) só usa 70% da cota da hora: o resto fica para renovar as cidades que já estão no cache, e um
// pedido anônimo com códigos do IBGE variados não esgota o clima de todo mundo. E cada IP pede no máximo
// WEATHER_NEW_PER_IP_HOUR cidades novas por hora (as que já estão no cache não contam)
const NEW_SHARE = 0.7;
const NEW_PER_IP = envInt('WEATHER_NEW_PER_IP_HOUR', 30) || 30;
const newCities = createLimiter({ windowMs: 3_600_000, max: NEW_PER_IP, maxKeys: 100_000 });
const CONCURRENT = envInt('WEATHER_CONCURRENT', 4) || 4;
const QUEUE_MAX = envInt('WEATHER_QUEUE_MAX', 64);
const TIMEOUT_MS = envInt('WEATHER_TIMEOUT_MS', 10_000) || 10_000;
const MAX_BYTES = 2 << 20; // a resposta do INMET tem ~250 KB por município (traz ícones em base64)
const UA = `DIGITAL-ISP/${config.version || '0'} (+https://www.digitalisp.com.br)`;
const SAMPLE = 5300108; // Brasília: a cidade do "Testar"

export const PROVIDERS = [
  { id: 'inmet', label: 'INMET', source: 'INMET', ready: true, needsKey: false, hasNow: false,
    note: 'Instituto Nacional de Meteorologia: previsão por município, sem chave. Não informa a temperatura de agora: a TV mostra a mínima e a máxima de hoje e dos próximos dias.' },
  { id: 'openmeteo', label: 'Open-Meteo', source: 'Open-Meteo', ready: true, needsKey: true, hasNow: true,
    note: 'Plano comercial (API Standard) com chave: temperatura de agora, chance de chuva e vento. O plano gratuito é só para uso não comercial.' },
  { id: 'climatempo', label: 'Climatempo', source: 'Climatempo', ready: false, needsKey: true, hasNow: true,
    note: 'Em breve: o adaptador entra quando houver a documentação oficial da API (contrato comercial com a Climatempo).' },
];
const PROVIDER = new Map(PROVIDERS.map((p) => [p.id, p]));
const DEFAULT_PROVIDER = 'inmet';

/* ------------------------------------------------------------------ configuração (settings) e a chave cifrada */
const CFG_KEY = 'weather_config';
let cfgMemo = null;
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
async function loadConfig() {
  if (cfgMemo) return cfgMemo;
  const raw = parse(await getSetting(CFG_KEY)) || {};
  const keys = {};
  for (const p of PROVIDERS) if (p.needsKey && raw.keys && typeof raw.keys[p.id] === 'string') keys[p.id] = raw.keys[p.id];
  const keyAt = {};
  for (const id of Object.keys(keys)) keyAt[id] = Number(raw.keyAt?.[id]) || null;
  cfgMemo = { provider: PROVIDER.get(raw.provider)?.ready ? raw.provider : DEFAULT_PROVIDER, keys, keyAt, updatedAt: Number(raw.updatedAt) || null };
  return cfgMemo;
}
const sealKey = () => (config.sessionSecret ? createHash('sha256').update(`nexa-weather-key:${config.sessionSecret}`).digest() : null);
function seal(plain) {
  const k = sealKey();
  if (!k) throw fail(400, 'O servidor precisa de SESSION_SECRET para guardar a chave cifrada.');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`;
}
/** A chave em claro, ou null (sem chave, ou SESSION_SECRET mudou e ela ficou ilegível). */
function unseal(s) {
  const k = sealKey();
  if (!k || typeof s !== 'string' || !s.startsWith('v1:')) return null;
  try {
    const b = Buffer.from(s.slice(3), 'base64');
    const d = createDecipheriv('aes-256-gcm', k, b.subarray(0, 12), { authTagLength: 16 });
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch { return null; }
}

/** Estado para o superadmin: nunca a chave, só se está definida e se ainda dá para ler. */
export async function weatherConfig() {
  const c = await loadConfig();
  return {
    provider: c.provider,
    providers: PROVIDERS.map((p) => ({
      id: p.id, label: p.label, source: p.source, ready: p.ready, needsKey: p.needsKey, hasNow: p.hasNow, note: p.note,
      keySet: Boolean(c.keys[p.id]), keyReadable: c.keys[p.id] ? unseal(c.keys[p.id]) != null : null, keyAt: c.keyAt[p.id] || null,
    })),
    updatedAt: c.updatedAt, canSeal: Boolean(sealKey()),
    cities: cache.size, callsLastHour: callsInWindow(), limits: { cacheMin: Math.round(CACHE_MS / 60_000), callsPerHour: CALLS_PER_HOUR, cities: MAX_CITIES },
  };
}

const KEY_RE = /^[\x21-\x7e]{8,200}$/; // chave de API: caracteres visíveis, sem espaço
/**
 * Troca a fonte e/ou uma chave: { provider?, key?, keyFor? }. key: texto = define; null ou '' = apaga; ausente = mantém.
 * keyFor = de qual provedor é a chave (padrão: o escolhido), para guardar ou apagar a chave de uma fonte que não está em
 * uso. Vale na hora e limpa o cache. Devolve o que mudou (para a auditoria, sem a chave).
 */
export async function setWeatherConfig(body) {
  const b = body && typeof body === 'object' ? body : {};
  const c = await loadConfig();
  const provider = b.provider === undefined ? c.provider : String(b.provider);
  const p = PROVIDER.get(provider);
  if (!p) throw fail(400, `Fonte desconhecida. Use ${PROVIDERS.map((x) => x.id).join(', ')}.`);
  if (!p.ready) throw fail(400, `${p.label}: em breve (ainda sem adaptador).`);
  const keys = { ...c.keys }; const keyAt = { ...c.keyAt };
  let keyChange = null;
  const kf = b.keyFor === undefined ? provider : String(b.keyFor);
  const kp = PROVIDER.get(kf);
  if (b.key !== undefined) {
    if (!kp) throw fail(400, 'keyFor: fonte desconhecida.');
    if (!kp.needsKey) throw fail(400, `${kp.label} não usa chave.`);
    if (b.key === null || b.key === '') {
      if (kf === provider && p.needsKey) throw fail(400, `${kp.label} está em uso: troque a fonte antes de apagar a chave.`);
      if (keys[kf]) keyChange = 'removed';
      delete keys[kf]; delete keyAt[kf];
    } else {
      const k = typeof b.key === 'string' ? b.key.trim() : '';
      if (!KEY_RE.test(k)) throw fail(400, 'Chave inválida: de 8 a 200 caracteres, sem espaços.');
      keys[kf] = seal(k); keyAt[kf] = Date.now(); keyChange = 'set';
    }
  }
  if (p.needsKey && !keys[provider]) throw fail(400, `${p.label} precisa da chave do plano comercial.`);
  const next = { provider, keys, keyAt, updatedAt: Date.now() };
  await setSetting(CFG_KEY, JSON.stringify(next));
  const providerChanged = provider !== c.provider;
  cfgMemo = next;
  clearWeatherCache();
  return { provider, providerChanged, keyChange, keyFor: kf };
}

/* ------------------------------------------------------------------ cache, freios e HTTP */
const cache = new Map(); // `${provider}|${ibge}` -> { at, ok, data | err }; a ordem do Map é a do uso (LRU)
const inflight = new Map();
const coords = new Map(); // ibge -> { lat, lon } (geocodificador do Open-Meteo)
let generation = 0;
let calls = []; // instantes dos pedidos ao provedor na última hora
let running = 0;
const queue = [];
export function clearWeatherCache() { generation++; cache.clear(); inflight.clear(); }
function callsInWindow() { const t = Date.now(); calls = calls.filter((x) => t - x < 3_600_000); return calls.length; }
const takeCall = () => { if (callsInWindow() >= CALLS_PER_HOUR) return false; calls.push(Date.now()); return true; };
/** Ainda cabe uma cidade nova nesta hora? (a reserva da cota é das renovações) */
const newCityRoom = () => callsInWindow() < Math.floor(CALLS_PER_HOUR * NEW_SHARE);
function remember(key, v) {
  cache.delete(key);
  cache.set(key, v);
  while (cache.size > MAX_CITIES) cache.delete(cache.keys().next().value);
}
/** Uma vaga entre as consultas simultâneas ao provedor (fila curta; cheia = "tente depois"). */
function slot() {
  if (running < CONCURRENT) { running++; return Promise.resolve(); }
  if (queue.length >= QUEUE_MAX) return Promise.reject(fail(503, 'Clima ocupado agora.', { code: 'busy' }));
  return new Promise((resolve) => queue.push(resolve));
}
function release() { const next = queue.shift(); if (next) next(); else running--; }

/** GET com prazo, sem seguir redirecionamento e com teto de corpo. Nunca põe o endereço (que pode ter a chave) num erro. */
async function getJson(url, what) {
  if (!takeCall()) throw fail(503, 'Limite de consultas de clima por hora atingido.', { code: 'limit' });
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error', headers: { accept: 'application/json', 'user-agent': UA } });
  } catch { throw fail(502, `${what} não respondeu (rede ou tempo esgotado).`, { code: 'unavailable' }); }
  const chunks = []; let size = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      let r;
      try { r = await reader.read(); } catch { throw fail(502, `${what}: a resposta foi interrompida.`, { code: 'unavailable' }); }
      if (r.done) break;
      size += r.value.length;
      if (size > MAX_BYTES) { reader.cancel().catch(() => {}); throw fail(502, `${what}: resposta grande demais.`, { code: 'unavailable' }); }
      chunks.push(r.value);
    }
  }
  if (res.status === 401 || res.status === 403) throw fail(502, `${what} recusou a chave (HTTP ${res.status}).`, { code: 'key' });
  if (res.status === 429) throw fail(502, `${what}: limite do plano atingido (HTTP 429).`, { code: 'unavailable' });
  if (res.status !== 200) throw fail(502, `${what} respondeu HTTP ${res.status}.`, { code: 'unavailable' });
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(502, `${what}: resposta que não é JSON.`, { code: 'unavailable' }); }
}

/* ------------------------------------------------------------------ formato comum */
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const text = (v, max = 120) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const temp = (v) => { const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN; return Number.isFinite(n) && n > -60 && n < 65 ? Math.round(n) : null; };
const pct = (v) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null; };
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const weekdayOf = (iso) => WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
/** Data e hora de agora em Brasília (os provedores falam no fuso do município; o app é do Brasil). */
function brNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
/** Condição do texto do provedor: clear, partly, cloudy, fog, rain, storm ou unknown (a TV escolhe o desenho). */
export function condOf(s) {
  const t = fold(s);
  if (/trovoad|tempestade|raio|granizo/.test(t)) return 'storm';
  if (/chuv|garoa|pancada/.test(t)) return 'rain';
  if (/nevoeiro|nevoa|neblina|bruma/.test(t)) return 'fog';
  if (/poucas nuvens|parcialmente|sol entre nuvens|nuvens esparsas|predominio de sol/.test(t)) return 'partly';
  if (/nuvens|nublado|encoberto/.test(t)) return 'cloudy';
  if (/claro|limpo|sol|ensolarado/.test(t)) return 'clear';
  return 'unknown';
}

/* ------------------------------------------------------------------ INMET */
const INMET_BASE = () => envUrl('WEATHER_INMET_BASE', 'https://apiprevmet3.inmet.gov.br');
const hhmm = (s) => { const m = /^(\d{1,2})h(\d{2})$/.exec(String(s || '').trim()); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };
const PERIODS = ['manha', 'tarde', 'noite'];
const filled = (o) => o && typeof o === 'object' && (temp(o.temp_max) != null || temp(o.temp_min) != null || text(o.resumo));
/** Resposta do apiprevmet3 -> formato comum (exportada para os testes). */
export function parseInmet(j, place, clock = brNow()) {
  const root = j && typeof j === 'object' ? j[String(place.code)] : null;
  if (!root || typeof root !== 'object') throw fail(502, 'INMET: sem previsão para este município.', { code: 'no-data' });
  const days = [];
  for (const [k, v] of Object.entries(root)) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(k);
    if (!m || !v || typeof v !== 'object') continue;
    const date = `${m[3]}-${m[2]}-${m[1]}`;
    const split = PERIODS.some((p) => v[p] && typeof v[p] === 'object');
    const parts = split ? PERIODS.map((p) => (filled(v[p]) ? { p, x: v[p] } : null)).filter(Boolean) : (filled(v) ? [{ p: null, x: v }] : []);
    if (!parts.length) continue;
    const mins = parts.map((q) => temp(q.x.temp_min)).filter((n) => n != null);
    const maxs = parts.map((q) => temp(q.x.temp_max)).filter((n) => n != null);
    days.push({ date, parts, min: mins.length ? Math.min(...mins) : null, max: maxs.length ? Math.max(...maxs) : null });
  }
  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  const upcoming = days.filter((d) => d.date >= clock.date);
  if (!upcoming.length) throw fail(502, 'INMET: sem previsão para este município.', { code: 'no-data' });
  const [d0, ...rest] = upcoming;
  // o período de agora (manhã até 12 h, tarde até 18 h, noite); se faltar, o que houver
  const want = clock.hour < 12 ? 'manha' : clock.hour < 18 ? 'tarde' : 'noite';
  const part = (d0.date === clock.date && d0.parts.find((q) => q.p === want)) || d0.parts.find((q) => q.p === 'tarde') || d0.parts[0];
  const x = part.x;
  const hum = [pct(x.umidade_min), pct(x.umidade_max)];
  const wind = [text(x.int_vento, 40), text(x.dir_vento, 12)].filter(Boolean).join(', ');
  const dayText = (d) => text((d.parts.find((q) => q.p === 'tarde') || d.parts[0]).x.resumo);
  return {
    now: null,
    today: {
      date: d0.date, weekday: weekdayOf(d0.date), period: part.p, min: d0.min, max: d0.max, text: text(x.resumo), cond: condOf(x.resumo),
      humidity: hum[0] != null && hum[1] != null ? { min: hum[0], max: hum[1] } : null, wind: wind || null, rainPct: null,
      sunrise: hhmm(x.nascer), sunset: hhmm(x.ocaso),
    },
    days: rest.slice(0, 4).map((d) => ({ date: d.date, weekday: weekdayOf(d.date), min: d.min, max: d.max, text: dayText(d), cond: condOf(dayText(d)), rainPct: null })),
  };
}
const inmet = {
  async fetch(place) {
    return parseInmet(await getJson(`${INMET_BASE()}/previsao/${place.code}`, 'INMET'), place);
  },
};

/* ------------------------------------------------------------------ Open-Meteo (plano comercial) */
const OM_BASE = () => envUrl('WEATHER_OPENMETEO_BASE', 'https://customer-api.open-meteo.com');
const OM_GEO = () => envUrl('WEATHER_OPENMETEO_GEO_BASE', 'https://customer-geocoding-api.open-meteo.com');
/** Códigos WMO do Open-Meteo -> texto em português e condição. */
const WMO = [
  [[0], 'Céu limpo', 'clear'], [[1], 'Predomínio de sol', 'partly'], [[2], 'Parcialmente nublado', 'partly'], [[3], 'Nublado', 'cloudy'],
  [[45, 48], 'Nevoeiro', 'fog'], [[51, 53, 55, 56, 57], 'Garoa', 'rain'], [[61], 'Chuva fraca', 'rain'], [[63], 'Chuva moderada', 'rain'],
  [[65], 'Chuva forte', 'rain'], [[66, 67], 'Chuva congelante', 'rain'], [[71, 73, 75, 77, 85, 86], 'Neve', 'cloudy'],
  [[80], 'Pancadas de chuva fracas', 'rain'], [[81], 'Pancadas de chuva', 'rain'], [[82], 'Pancadas de chuva fortes', 'rain'],
  [[95], 'Trovoadas', 'storm'], [[96, 99], 'Trovoadas com granizo', 'storm'],
];
const WMO_MAP = new Map(WMO.flatMap(([codes, t, c]) => codes.map((n) => [n, { t, c }])));
const wmo = (n) => WMO_MAP.get(Number(n)) || { t: '', c: 'unknown' };
/** Resposta do /v1/forecast -> formato comum (exportada para os testes). */
export function parseOpenMeteo(j, clock = brNow()) {
  const d = j && j.daily;
  if (!d || !Array.isArray(d.time) || !d.time.length) throw fail(502, 'Open-Meteo: resposta sem previsão.', { code: 'no-data' });
  const days = d.time.map((date, i) => {
    const w = wmo(d.weather_code?.[i]);
    return { date: String(date).slice(0, 10), weekday: weekdayOf(String(date).slice(0, 10)), min: temp(d.temperature_2m_min?.[i]), max: temp(d.temperature_2m_max?.[i]), text: w.t, cond: w.c, rainPct: pct(d.precipitation_probability_max?.[i]) };
  }).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.date >= clock.date);
  if (!days.length) throw fail(502, 'Open-Meteo: resposta sem previsão.', { code: 'no-data' });
  const c = j.current || {};
  const cw = wmo(c.weather_code);
  const nowTemp = temp(c.temperature_2m);
  const wind = Number(c.wind_speed_10m);
  const [d0, ...rest] = days;
  return {
    now: nowTemp == null ? null : { temp: nowTemp, text: cw.t, cond: cw.c, windKmh: Number.isFinite(wind) && wind >= 0 && wind < 400 ? Math.round(wind) : null, rainPct: d0.rainPct },
    today: { ...d0, period: null, humidity: null, wind: null, sunrise: null, sunset: null },
    days: rest.slice(0, 4),
  };
}
async function geocode(place, key) {
  const hit = coords.get(place.code);
  if (hit) return hit;
  const q = new URLSearchParams({ name: place.name, count: '20', language: 'pt', format: 'json', countryCode: 'BR', apikey: key });
  const j = await getJson(`${OM_GEO()}/v1/search?${q}`, 'Open-Meteo (geocodificador)');
  const state = fold(UFS[place.uf]); const name = fold(place.name);
  const list = Array.isArray(j?.results) ? j.results.filter((r) => r && r.country_code === 'BR' && Number.isFinite(r.latitude) && Number.isFinite(r.longitude)) : [];
  // só o município pedido (nome e estado iguais): outro lugar da mesma UF mostraria o clima errado com o nome certo
  const r = list.find((x) => fold(x.admin1) === state && fold(x.name) === name);
  if (!r) throw fail(502, 'Open-Meteo: município não encontrado no geocodificador.', { code: 'no-data' });
  const c = { lat: Math.round(r.latitude * 1e4) / 1e4, lon: Math.round(r.longitude * 1e4) / 1e4 };
  if (coords.size > 6000) coords.clear();
  coords.set(place.code, c);
  return c;
}
const openmeteo = {
  async fetch(place, key) {
    if (!key) throw fail(503, 'Open-Meteo sem chave.', { code: 'key' });
    const { lat, lon } = await geocode(place, key);
    const q = new URLSearchParams({
      latitude: String(lat), longitude: String(lon), timezone: 'America/Sao_Paulo', forecast_days: '5', apikey: key,
      current: 'temperature_2m,weather_code,wind_speed_10m', daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    });
    return parseOpenMeteo(await getJson(`${OM_BASE()}/v1/forecast?${q}`, 'Open-Meteo'));
  },
};

const ADAPTERS = { inmet, openmeteo };

/* ------------------------------------------------------------------ previsão (o que a TV recebe) */
/**
 * Previsão do município (código do IBGE), do cache ou do provedor escolhido:
 * { provider, source, hasNow, place: { ibge, city, uf }, updatedAt, now, today, days }. Lança { status, code } quando não há
 * dado (code: 'place', 'limit', 'busy', 'unavailable', 'no-data', 'key'); a resposta velha serve enquanto o provedor falha.
 * who = quem pede (IP; o freio de cidades novas por hora); sem ele (o "Testar"), sem esse freio.
 */
export async function forecast(ibge, { fresh = false, who = null } = {}) {
  const place = municipio(ibge);
  if (!place) throw fail(400, 'Cidade fora da lista do IBGE.', { code: 'place' });
  const c = await loadConfig();
  const p = PROVIDER.get(c.provider);
  const adapter = ADAPTERS[p.id];
  const key = `${p.id}|${place.code}`;
  const hit = cache.get(key);
  const t = Date.now();
  if (!fresh && hit && t - hit.at < (hit.ok ? CACHE_MS : ERR_MS)) {
    remember(key, hit);
    if (hit.ok) return hit.data;
    throw hit.err;
  }
  if (!fresh && inflight.has(key)) return inflight.get(key);
  // cidade fora do cache: freio por IP e só a parte da cota que não é das renovações
  if (!hit && !fresh) {
    if (!newCityRoom()) throw fail(503, 'Limite de consultas de clima por hora atingido.', { code: 'limit' });
    if (who && !newCities.hit(String(who))) throw fail(429, 'Muitas cidades novas pedidas por este endereço. Tente mais tarde.', { code: 'limit' });
  }
  const gen = generation;
  const stale = hit && hit.ok ? hit.data : null;
  const run = (async () => {
    let got = false; // a vaga só é devolvida se foi pega (fila cheia rejeita antes)
    try {
      await slot();
      got = true;
      const keyPlain = p.needsKey ? unseal(c.keys[p.id]) : null;
      const body = await adapter.fetch(place, keyPlain);
      const data = { provider: p.id, source: p.source, hasNow: p.hasNow, place: { ibge: String(place.code), city: place.name, uf: place.uf }, updatedAt: Date.now(), ...body };
      if (gen === generation) remember(key, { at: Date.now(), ok: true, data });
      return data;
    } catch (e) {
      const err = e.status ? e : fail(502, 'Clima indisponível.', { code: 'unavailable' });
      if (stale) {
        // provedor fora: a resposta velha continua valendo para todos por ERR_MS (depois pergunta de novo)
        if (gen === generation) remember(key, { at: Date.now() - CACHE_MS + ERR_MS, ok: true, data: stale });
        return stale;
      }
      if (gen === generation && err.code !== 'limit' && err.code !== 'busy') remember(key, { at: Date.now(), ok: false, err });
      throw err;
    } finally {
      if (got) release();
      if (inflight.get(key) === run) inflight.delete(key);
    }
  })();
  if (!fresh) inflight.set(key, run);
  return run;
}

/** "Testar" do superadmin: a previsão de Brasília pela fonte escolhida, sem cache. Nunca devolve a chave. */
export async function testWeather() {
  const c = await loadConfig();
  const p = PROVIDER.get(c.provider);
  if (p.needsKey && !unseal(c.keys[p.id])) return { ok: false, message: `${p.label}: chave ${c.keys[p.id] ? 'ilegível (SESSION_SECRET mudou): salve a chave de novo' : 'não definida'}.` };
  const t0 = Date.now();
  try {
    const f = await forecast(SAMPLE, { fresh: true });
    const d = f.today;
    const now = f.now ? `agora ${f.now.temp}°C, ` : '';
    return { ok: true, message: `${p.label} respondeu: Brasília, ${now}hoje ${d.min ?? '?'}° a ${d.max ?? '?'}°${d.text ? ` (${d.text})` : ''}.`, latencyMs: Date.now() - t0 };
  } catch (e) { return { ok: false, message: e.message, latencyMs: Date.now() - t0 }; }
}

/** Nome da fonte escolhida (para a TV escrever "Fonte: …" mesmo antes da previsão chegar). */
export async function weatherSource() {
  const p = PROVIDER.get((await loadConfig()).provider);
  return { provider: p.id, source: p.source, hasNow: p.hasNow };
}
/** Só para os testes: esquece a configuração lida (outra base de dados). */
export function resetWeatherForTests() { cfgMemo = null; coords.clear(); calls = []; clearWeatherCache(); }
/** Só para os testes: quantas consultas simultâneas e na fila agora. */
export const weatherQueueForTests = () => ({ running, queued: queue.length, inflight: inflight.size });
