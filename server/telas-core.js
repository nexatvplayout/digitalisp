// NEXA Telas (docs/TELAS.md): as regras sem banco do modo prefeitura. Chaves de acesso, tokens e PIN, a limpeza do que o
// painel manda, a configuração que a TV box recebe (precedência: tela > grupos > repartição > padrão da prefeitura), o alcance
// dos alertas, a sessão do link de controle e o lugar das capturas em disco. O banco e as rotas ficam em server/telas.js.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import {
  LAYOUT_KEYS, isQueueLayout, THEME_COLORS, THEME_MODES, THEME_DEFAULT, WIDGET_KEYS, EXIT_KEYS, DEFAULT_EXIT_SEQ, LIMITS, ALERT_LEVEL_KEYS, MODULE_KEYS, OFFICE_TYPE_KEYS, OFFICE_ROLE_KEYS, officeModules,
} from '../public/shared/telas-tipos.js';
import { checkPasswordPolicy } from './authcore.js';
import { cleanAviso, tickerTexts, tickerRich } from './telas-conteudo-core.js';
import { cleanTickerStyle } from '../public/shared/faixa.js'; // a classificação dos avisos e o modo eleitoral (usados só dentro das funções)

export const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra ? { extra } : {}) });
export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
export const settingsKey = (tenantId) => `telas:${Number(tenantId)}`;
const j = (s, d) => { try { const v = s ? JSON.parse(s) : d; return v ?? d; } catch { return d; } };
export const parseJson = j;

/** Texto de uma linha: sem caracteres de controle, espaços juntos, até max. */
export const line = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Texto com quebras de linha (o corpo do alerta): sem os outros caracteres de controle, até max. */
export const text = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

/* ------------------------------------------------------------------ chave de acesso, token do aparelho e do link */
/** 32 símbolos sem os que se confundem (I, O, 0, 1): 8 caracteres = 40 bits, uso único, 24 h. */
export const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const KEY_LEN = 8;
export const KEY_TTL_MS = 24 * 3600 * 1000;
export const newKey = () => Array.from({ length: KEY_LEN }, () => KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]).join('');
export const formatKey = (k) => `${k.slice(0, 4)}-${k.slice(4)}`;
/** "abcd-efgh", "ABCD EFGH", "ABCDEFGH" -> "ABCDEFGH"; fora do formato: null (400 no ativar). */
export function normalizeKey(v) {
  if (typeof v !== 'string' || v.length > 32) return null;
  const k = v.toUpperCase().replace(/[\s-]/g, '');
  if (k.length !== KEY_LEN) return null;
  for (const c of k) if (!KEY_ALPHABET.includes(c)) return null;
  return k;
}
/** Token opaco (32 bytes): o do aparelho e o do link de controle. No banco fica só o SHA-256. */
export const newToken = () => randomBytes(32).toString('base64url');
export const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

/* ------------------------------------------------------------------ PIN e sequência de saída */
export const PIN_RE = new RegExp(`^\\d{${LIMITS.pinMin},${LIMITS.pinMax}}$`);
/** O aparelho confere: SHA-256 (hex) do TEXTO em UTF-8 "sal em hexadecimal" + "dígitos do PIN" (o texto do sal, não os bytes
 *  dele; contrato §2 e §6). Ex.: sal "00ff", PIN "1234" -> sha256("00ff1234"). */
export const pinHash = (salt, pin) => sha256(`${salt}${pin}`);
/** PIN de 6 dígitos sorteado: a repartição nunca fica sem PIN (com o hash vazio a sequência de saída abriria os ajustes). */
export const randomPin = () => String(randomInt(1000000)).padStart(6, '0');
export function pinRecord(pin) {
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) throw fail(400, `PIN: ${LIMITS.pinMin} a ${LIMITS.pinMax} dígitos.`);
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: pinHash(salt, pin) };
}

/* ------------------------------------------------------------------ configuração (o que se guarda) */
/** Padrão de fábrica: o que vale sem nada escolhido na prefeitura, na repartição, no grupo ou na tela. */
export const FACTORY = Object.freeze({
  layout: 'full', tickerItems: [], tickerSpeed: 60, tickerStyle: null, tickerNews: null, // tickerNews: { feeds: [ids das fontes de notícias], max } (as manchetes entram na faixa); tickerStyle: cores, negrito, itálico, tamanho, fonte, separador e etiqueta da faixa (public/shared/faixa.js)
  widgets: ['clock'], qrUrl: null, sideTitle: null,
  pin: null, exitSeq: DEFAULT_EXIT_SEQ, backup: null, volume: 100, muted: false, schedule: null,
  captions: { on: false, lang: null }, // contrato §14: as legendas da programação (desligadas de fábrica)
  theme: THEME_DEFAULT, // contrato §15: a cor principal e o claro/escuro dos painéis de senha novos
  // contrato §16: o som da chamada de senha. mode null = o painel não definiu (vale o escolhido no app; sem ele, "both")
  callSound: { mode: null, volume: 100 },
});
/** Som da chamada de senha (§16): bipe, falada ou bipe + falada (o padrão do app). */
export const CALL_SOUND_MODES = Object.freeze(['beep', 'voice', 'both']);
/** { mode, volume } do som da chamada. mode null/'' = não define (o app decide); volume da fala de 0 a 100 (padrão 100). */
export function cleanCallSound(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw fail(400, 'Som da chamada: envie { mode, volume }.');
  const mode = v.mode == null || v.mode === '' ? null : String(v.mode);
  if (mode !== null && !CALL_SOUND_MODES.includes(mode)) throw fail(400, 'Som da chamada: bipe (beep), falada (voice) ou bipe + falada (both).');
  const volume = v.volume == null || v.volume === '' ? 100 : Math.round(Number(v.volume));
  if (!(volume >= 0 && volume <= 100)) throw fail(400, 'Volume da fala: 0 a 100.');
  if (mode === null && volume === 100) return undefined; // nada definido: herda do nível de cima
  return { mode, volume };
}
/** Idiomas de legenda que o painel oferece (os dos apps, public/shared/i18n/lang); null = o do canal (o CC do ar). */
export const CAPTION_LANGS = Object.freeze(['pt', 'en', 'es', 'fr', 'de', 'it', 'zh-CN', 'ja', 'ko', 'ru', 'ar']);
/** { on, lang } das legendas (§14). lang fora da lista: 400; ausente/vazio: null (o idioma do canal). */
export function cleanCaptions(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw fail(400, 'Legendas: envie { on, lang }.');
  if (typeof v.on !== 'boolean') throw fail(400, 'Legendas: "on" é verdadeiro ou falso.');
  const lang = v.lang == null || v.lang === '' ? null : String(v.lang);
  if (lang !== null && !CAPTION_LANGS.includes(lang)) throw fail(400, `Legendas: idioma "${lang.slice(0, 10)}" desconhecido.`);
  return { on: v.on, lang };
}
/** { color, mode } do tema (§15): a cor de THEME_COLORS (o hex ou a chave: azul, verde…) e dark | light. */
export function cleanTheme(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw fail(400, 'Tema: envie { color, mode }.');
  const c = String(v.color ?? THEME_DEFAULT.color).trim().toLowerCase();
  const color = THEME_COLORS.find((x) => x.hex === c || x.key === c)?.hex;
  if (!color) throw fail(400, `Tema: cor fora da lista (${THEME_COLORS.map((x) => x.label.toLowerCase()).join(', ')}).`);
  const mode = v.mode == null || v.mode === '' ? THEME_DEFAULT.mode : String(v.mode);
  if (!THEME_MODES.some((m) => m.key === mode)) throw fail(400, 'Tema: claro (light) ou escuro (dark).');
  return { color, mode };
}
export const HEARTBEAT_SEC = 10; // DIGITAL ISP (26/11/2026): a mudança do painel chega à TV em até ~10 s (antes 30)
const CONFIG_KEYS = Object.keys(FACTORY);
/** O que um grupo define: só os avisos e o layout. */
export const GROUP_CONFIG_KEYS = ['layout', 'tickerItems'];

const httpUrl = (v, what) => {
  const s = String(v ?? '').trim();
  if (s.length > 500) throw fail(400, `${what}: endereço longo demais.`);
  let u; try { u = new URL(s); } catch { throw fail(400, `${what}: endereço inválido.`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw fail(400, `${what}: use um endereço http(s).`);
  if (u.username || u.password) throw fail(400, `${what}: endereço sem usuário e senha.`);
  return u.toString();
};
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
function cleanSchedule(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw fail(400, 'Horário da TV: envie { tvOn, tvOff, days }.');
  if (!HHMM.test(v.tvOn) || !HHMM.test(v.tvOff)) throw fail(400, 'Horário da TV: use HH:MM (ex.: 07:00 e 19:00).');
  if (v.tvOn === v.tvOff) throw fail(400, 'Horário da TV: ligar e desligar na mesma hora.');
  // dias da semana: 0 = domingo … 6 = sábado (7 também é domingo), no fuso do aparelho; lista vazia = todos os dias (contrato §6)
  if (v.days != null && !Array.isArray(v.days)) throw fail(400, 'Horário da TV: os dias são uma lista de 0 (domingo) a 6 (sábado).');
  const raw = (v.days || []).map(Number);
  if (raw.some((d) => !Number.isInteger(d) || d < 0 || d > 7)) throw fail(400, 'Horário da TV: os dias vão de 0 (domingo) a 6 (sábado).');
  const days = [...new Set(raw.map((d) => d % 7))].sort((a, b) => a - b);
  return { tvOn: v.tvOn, tvOff: v.tvOff, days };
}
export function cleanTicker(v) {
  if (!Array.isArray(v)) throw fail(400, 'Avisos: envie uma lista de textos.');
  const items = v.map((x) => cleanAviso(x, LIMITS.tickerItem)).filter(Boolean); // com a marca da classificação, se houver: "[institucional] …"
  if (items.length > LIMITS.tickerItems) throw fail(400, `Avisos: no máximo ${LIMITS.tickerItems}.`);
  return items;
}
const CLEAN = {
  layout: (v) => { if (!LAYOUT_KEYS.includes(v)) throw fail(400, 'Layout inválido.'); return v; },
  tickerItems: cleanTicker,
  tickerNews: (v) => {
    if (typeof v !== 'object' || Array.isArray(v)) throw fail(400, 'Manchetes na faixa: envie { feeds, max }.');
    const feeds = [...new Set((Array.isArray(v.feeds) ? v.feeds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 10);
    const max = Math.min(15, Math.max(1, Math.round(Number(v.max) || 6)));
    return feeds.length ? { feeds, max } : undefined;
  },
  tickerStyle: (v) => { if (typeof v !== 'object' || Array.isArray(v)) throw fail(400, 'Estilo da faixa inválido.'); return cleanTickerStyle(v) || undefined; },
  tickerSpeed: (v) => { const n = Math.round(Number(v)); if (!(n >= LIMITS.tickerSpeedMin && n <= LIMITS.tickerSpeedMax)) throw fail(400, `Velocidade dos avisos: ${LIMITS.tickerSpeedMin} a ${LIMITS.tickerSpeedMax}.`); return n; },
  widgets: (v) => { if (!Array.isArray(v)) throw fail(400, 'Lateral: envie a lista de blocos.'); return WIDGET_KEYS.filter((k) => v.includes(k)); },
  qrUrl: (v) => httpUrl(v, 'QR code'),
  sideTitle: (v) => line(v, 60) || undefined,
  pin: (v) => pinRecord(v),
  exitSeq: (v) => {
    if (!Array.isArray(v) || v.length < LIMITS.exitSeqMin || v.length > LIMITS.exitSeqMax || !v.every((k) => EXIT_KEYS.includes(k))) throw fail(400, `Sequência de saída: ${LIMITS.exitSeqMin} a ${LIMITS.exitSeqMax} teclas (${EXIT_KEYS.join(', ')}).`);
    return [...v];
  },
  backup: (v) => httpUrl(v, 'Sinal reserva (HLS)'),
  volume: (v) => { const n = Math.round(Number(v)); if (!(n >= 0 && n <= 100)) throw fail(400, 'Volume: 0 a 100.'); return n; },
  muted: (v) => Boolean(v),
  schedule: cleanSchedule,
  captions: cleanCaptions,
  theme: cleanTheme,
  callSound: cleanCallSound,
};
const emptyValue = (v) => v === null || v === '' || v === undefined || (Array.isArray(v) && !v.length);

/**
 * Junta o que o painel mandou ao que está guardado. Campo ausente: fica como está. null, '' ou lista vazia: sai (volta a
 * herdar do nível de cima). keys: os campos que este nível aceita (o grupo só layout e avisos). O PIN chega em texto e só o
 * sal e o hash ficam.
 */
export function mergeConfig(cur, input, keys = CONFIG_KEYS) {
  const out = { ...(cur && typeof cur === 'object' ? cur : {}) };
  for (const k of Object.keys(out)) if (!keys.includes(k)) delete out[k];
  if (input === undefined || input === null) return out;
  if (typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'Configuração inválida.');
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(input, k)) continue;
    if (emptyValue(input[k])) { delete out[k]; continue; }
    const v = CLEAN[k](input[k]);
    if (v === undefined || (Array.isArray(v) && !v.length)) delete out[k]; else out[k] = v;
  }
  return out;
}
/**
 * Atualização do app (opcional, por prefeitura; contrato §2): { url (só https), sha256 do APK, versionCode }. null tira.
 */
export function cleanUpdate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw fail(400, 'Atualização do app: envie { url, sha256, versionCode }.');
  const url = httpUrl(v.url, 'Atualização do app');
  if (!url.startsWith('https://')) throw fail(400, 'Atualização do app: o endereço do APK precisa ser https.');
  const hash = String(v.sha256 ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) throw fail(400, 'Atualização do app: o SHA-256 do APK tem 64 caracteres hexadecimais.');
  const code = Number(v.versionCode);
  if (!Number.isInteger(code) || code < 1 || code > 2100000000) throw fail(400, 'Atualização do app: versionCode é um número inteiro positivo.');
  return { url, sha256: hash, versionCode: code };
}
/** O que o painel lê de volta: tudo menos o PIN (só "tem PIN"). */
export function configDto(stored) {
  const { pin, ...rest } = stored && typeof stored === 'object' ? stored : {};
  return { ...rest, hasPin: Boolean(pin?.hash) };
}

/**
 * A configuração efetiva de uma tela. Precedência por campo: tela > grupos > repartição > padrão da prefeitura > fábrica.
 * Grupos (na ordem deles): os avisos de todos os grupos que têm avisos, um depois do outro; o layout do primeiro grupo que
 * define um. Repartição com o módulo "avisos" desligado: os avisos dela não contam.
 */
export function effectiveConfig({ defaults = {}, office = {}, officeType = 'outro', modules = null, groups = [], device = {} }) {
  const mods = officeModules(officeType, modules);
  const off = { ...office };
  if (!mods.avisos) delete off.tickerItems;
  const grp = {};
  const items = groups.flatMap((g) => (Array.isArray(g?.tickerItems) ? g.tickerItems : []));
  if (items.length) grp.tickerItems = items.slice(0, LIMITS.tickerItems * 3);
  const lay = groups.find((g) => g?.layout)?.layout;
  if (lay) grp.layout = lay;
  // o som da chamada campo a campo: o modo do nível mais específico que escolheu um; o volume, do que definiu um
  const sounds = [device, off, defaults].map((x) => x?.callSound).filter((x) => x && typeof x === 'object');
  const callSound = { mode: sounds.find((x) => x.mode)?.mode ?? null, volume: sounds.find((x) => Number.isFinite(x.volume))?.volume ?? 100 };
  return { ...FACTORY, ...defaults, ...off, ...grp, ...device, callSound };
}

/**
 * De onde vêm os avisos (texto rolante) que uma tela recebe, na mesma precedência de effectiveConfig: a própria tela > os
 * grupos > a repartição (com o módulo de avisos) > o padrão da prefeitura. Para o painel da repartição explicar por que um
 * aviso "não sai": a lista vazia da repartição não apaga, ela devolve a vez ao nível de cima.
 *   -> { from: 'tela' | 'grupo' | 'reparticao' | 'prefeitura' | 'nenhum', groups: [nomes], items: [avisos guardados] }
 */
export function tickerOrigin({ defaults = {}, office = {}, officeType = 'outro', modules = null, groups = [], device = {} }) {
  const has = (x) => Array.isArray(x?.tickerItems) && x.tickerItems.length > 0;
  if (has(device)) return { from: 'tela', groups: [], items: device.tickerItems };
  const gs = groups.filter((g) => has(g?.config));
  if (gs.length) return { from: 'grupo', groups: gs.map((g) => g.name || ''), items: gs.flatMap((g) => g.config.tickerItems).slice(0, LIMITS.tickerItems * 3) };
  if (officeModules(officeType, modules).avisos && has(office)) return { from: 'reparticao', groups: [], items: office.tickerItems };
  if (has(defaults)) return { from: 'prefeitura', groups: [], items: defaults.tickerItems };
  return { from: 'nenhum', groups: [], items: [] };
}

/**
 * O JSON do contrato (telas-contrato.md §2 e §7.1), sem o rev. Fases 3 e 4: weather (o clima segurado por 30 min, ou null),
 * cards (os cartões de informação de hoje), queue (a chamada de senha da repartição) e offline (os vídeos guardados com o
 * SHA-256 pronto, e a imagem de reserva do nível mais específico). electoral: no período eleitoral os avisos institucionais ficam retidos. Sem a chamada de senha ligada, o
 * layout "queue" vira "full" e o bloco "queue" sai da lateral.
 */
export function contractConfig({ eff, device, office, region, stream, update = null, weather = null, cards = [], queue = null, offline = [], offlineImage = null, electoral = false, internal = null, signage = null }) {
  // pair (§15): as duas filas do layout queue-duo, escolhidas na repartição (lista vazia = as duas primeiras filas ativas)
  const pair = Array.isArray(queue?.pair) ? queue.pair.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 2) : [];
  const q = queue && queue.enabled ? { enabled: true, voice: Boolean(queue.voice), title: queue.title || 'Atendimento', showName: Boolean(queue.showName), pair } : { enabled: false, voice: false, title: null, showName: false, pair: [] };
  return {
    device: { id: Number(device.id), name: device.name, office: office.name, officeType: office.type, region: region?.name ?? null },
    stream: { hls: stream?.hls ?? null, backup: eff.backup ?? null, volume: eff.volume, muted: Boolean(eff.muted), ...(stream?.youtube?.page ? { youtube: { page: stream.youtube.page } } : {}) },
    layout: isQueueLayout(eff.layout) && !q.enabled ? 'full' : eff.layout, // "queue" e os do §15 só com a senha ligada
    // items: só o texto (o app antigo); style e rich: o estilo da faixa e o de cada aviso (os apps novos; o antigo ignora)
    ticker: { items: tickerTexts(eff.tickerItems, electoral), speed: eff.tickerSpeed, style: eff.tickerStyle || null, rich: tickerRich(eff.tickerItems, electoral) },
    side: { widgets: (eff.widgets || []).filter((w) => w !== 'queue' || q.enabled), qrUrl: eff.qrUrl ?? null, title: eff.sideTitle ?? null },
    lock: { pinHash: eff.pin?.hash ?? null, pinSalt: eff.pin?.salt ?? null, exitSeq: eff.exitSeq },
    offline: { items: offline, image: offlineImage || null }, // image: a imagem de reserva sem conexão (§7.3, 14/11) ou null
    schedule: eff.schedule ?? null,
    heartbeatSec: HEARTBEAT_SEC,
    weather: weather || null,
    cards,
    queue: q,
    captions: { on: Boolean(eff.captions?.on), lang: eff.captions?.lang ?? null }, // §14
    theme: { color: eff.theme?.color || THEME_DEFAULT.color, mode: eff.theme?.mode || THEME_DEFAULT.mode }, // §15
    callSound: { mode: CALL_SOUND_MODES.includes(eff.callSound?.mode) ? eff.callSound.mode : null, volume: Number.isFinite(eff.callSound?.volume) ? eff.callSound.volume : 100 }, // §16
    // §17: SÓ na tela marcada como interna (posto de enfermagem, repouso, copa…); a tela pública nunca recebe esta chave
    ...(internal ? { internal } : {}),
    // TV Corporativa (docs/TV-CORPORATIVA.md §4.1): só na tela de unidade corporativa com uma grade que a pega
    ...(signage ? { signage } : {}),
    ...(update ? { update: { url: update.url, sha256: update.sha256, versionCode: update.versionCode } } : {}), // só quando a prefeitura define
  };
}
export const revOf = (cfg) => sha256(JSON.stringify(cfg)).slice(0, 12);

/* ------------------------------------------------------------------ cadastro (o que o painel manda) */
export const COLOR_RE = /^#[0-9a-f]{6}$/i;
export const cleanColor = (v) => { if (emptyValue(v)) return null; if (!COLOR_RE.test(v)) throw fail(400, 'Cor: use o formato #rrggbb.'); return String(v).toLowerCase(); };
export function cleanName(v, what = 'Nome') {
  const n = line(v, LIMITS.name);
  if (n.length < 2) throw fail(400, `${what}: 2 a ${LIMITS.name} caracteres.`);
  return n;
}
/** Ponto no mapa: os dois juntos ou nenhum. */
export function cleanPoint(lat, lng) {
  if (emptyValue(lat) && emptyValue(lng)) return { lat: null, lng: null };
  const a = Number(lat); const b = Number(lng);
  if (emptyValue(lat) || emptyValue(lng) || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) throw fail(400, 'Ponto no mapa inválido (latitude e longitude).');
  return { lat: Math.round(a * 1e6) / 1e6, lng: Math.round(b * 1e6) / 1e6 };
}
export const cleanOfficeType = (v) => { if (!OFFICE_TYPE_KEYS.includes(v)) throw fail(400, 'Tipo de repartição inválido.'); return v; };
export function cleanModules(v, type) {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw fail(400, 'Módulos: envie { chave: true/false }.');
  const out = {};
  for (const k of MODULE_KEYS) if (typeof v[k] === 'boolean') out[k] = v[k];
  return officeModules(type, out);
}
export const idOf = (v, what = 'Id') => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw fail(400, `${what} inválido.`); return n; };
const idList = (v, what) => {
  if (!Array.isArray(v) || !v.length || v.length > 200) throw fail(400, `${what}: escolha ao menos um.`);
  return [...new Set(v.map((x) => idOf(x, what)))];
};

/**
 * O alerta que o painel (ou o link de controle) mandou. allowed: os alcances que quem manda pode usar. Devolve os campos
 * limpos; os ids do alcance (regiões, grupos, repartição) são conferidos no banco por quem chama.
 */
export function cleanAlert(b, { now = Date.now(), allowed }) {
  const title = line(b?.title, LIMITS.alertTitle);
  if (title.length < 2) throw fail(400, `Título do alerta: 2 a ${LIMITS.alertTitle} caracteres.`);
  const body = text(b?.text, LIMITS.alertText);
  const level = b?.level ?? 'info';
  if (!ALERT_LEVEL_KEYS.includes(level)) throw fail(400, 'Nível do alerta inválido.');
  const startsAt = b?.startsAt == null ? now : Number(b.startsAt);
  if (!Number.isFinite(startsAt) || startsAt < now - 60000 || startsAt > now + 30 * 86400000) throw fail(400, 'Início do alerta inválido.');
  let until;
  if (b?.until != null) until = Number(b.until);
  else if (b?.durationMin != null) until = Math.max(startsAt, now) + Number(b.durationMin) * 60000;
  if (!Number.isFinite(until)) throw fail(400, 'Diga por quanto tempo o alerta fica nas telas (duração ou até quando).');
  until = Math.round(until);
  if (until - Math.max(startsAt, now) < LIMITS.alertMinMs) throw fail(400, 'O alerta precisa ficar ao menos 1 minuto.');
  if (until - startsAt > LIMITS.alertMaxMs) throw fail(400, 'O alerta fica no máximo 7 dias.');
  return { title, body, level, sound: Boolean(b?.sound), startsAt: Math.round(startsAt), until, scope: cleanScope(b?.scope, allowed) };
}
export function cleanScope(s, allowed) {
  const kind = s?.kind;
  if (!allowed.includes(kind)) throw fail(allowed.length && typeof kind === 'string' ? 403 : 400, 'Alcance do alerta inválido para este acesso.');
  if (kind === 'city') return { kind };
  if (kind === 'regions') return { kind, regions: idList(s.regions, 'Regiões') };
  if (kind === 'groups') return { kind, groups: idList(s.groups, 'Grupos') };
  if (kind === 'office') return { kind, office: idOf(s.office, 'Repartição') };
  // o alcance da prefeitura (montado pelo servidor a partir da ficha da repartição; o pedido só diz { kind: 'reach' })
  if (kind === 'reach') {
    const ids = (a) => (Array.isArray(a) ? [...new Set(a.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500) : []);
    return { kind, all: s.all === true, offices: ids(s.offices), regions: ids(s.regions), groups: ids(s.groups) };
  }
  const p = cleanPoint(s.lat, s.lng);
  const meters = Math.round(Number(s.meters));
  if (p.lat == null || !(meters >= LIMITS.radiusMin && meters <= LIMITS.radiusMax)) throw fail(400, `Raio: um ponto no mapa e de ${LIMITS.radiusMin} m a ${LIMITS.radiusMax / 1000} km.`);
  return { kind, lat: p.lat, lng: p.lng, meters };
}
/** scope + scope_data (colunas) <-> objeto do alcance. */
export const scopeToRow = ({ kind, ...data }) => ({ scope: kind, scope_data: JSON.stringify(data) });
export const scopeFromRow = (row) => ({ kind: row.scope, ...j(row.scope_data, {}) });

/* ------------------------------------------------------------------ sinal de vida (o que o aparelho manda) */
export const STATES = ['playing', 'buffering', 'offline-content', 'error', 'idle'];
export const SOURCES = ['hls', 'backup', 'offline'];
export const NETS = ['wifi', 'ethernet', 'none'];
const oneOf = (v, list) => (list.includes(v) ? v : null);
export function cleanHeartbeat(b) {
  const up = Number(b?.uptimeSec);
  return {
    rev: typeof b?.rev === 'string' ? b.rev.slice(0, 32) : null,
    state: oneOf(b?.state, STATES), source: oneOf(b?.source, SOURCES), net: oneOf(b?.net, NETS),
    appVersion: line(b?.appVersion, 40), uptimeSec: Number.isFinite(up) && up >= 0 ? Math.min(Math.round(up), 4e9) : null,
    lastError: b?.lastError == null ? null : line(b.lastError, 300) || null,
    locked: typeof b?.locked === 'boolean' ? (b.locked ? 1 : 0) : null,
  };
}
export const cleanDeviceInfo = (d) => ({ model: line(d?.model, 80), android: line(d?.android, 40), appVersion: line(d?.appVersion, 40), serial: line(d?.serial, 80) });
/**
 * Identidade do aparelho para a licença sobreviver à reinstalação do app (docs/TELAS.md §32): o app manda o hwid, um
 * SHA-256 em hexa do ANDROID_ID + nome do pacote (nunca o ANDROID_ID cru). Fora disso, null (sem vínculo).
 */
export const cleanHwid = (v) => (typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v) ? v.toLowerCase() : null);
/** O que o banco guarda: o resumo do hwid (quem lê o banco não tem o que mandar ao /recover). */
export const hwidHash = (hwid) => sha256(`telas-hwid:${hwid}`);

/* ------------------------------------------------------------------ captura da tela */
export const SHOT_MAX = 400 * 1024;
/** JPEG de verdade: começa em FF D8 FF e termina em FF D9. */
export const isJpeg = (buf) => Buffer.isBuffer(buf) && buf.length >= 100 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
export const shotsRoot = () => path.join(config.dataDir, 'telas', 'shots');
/** DATA_DIR/telas/shots/<cliente>/<tela>.jpg: o caminho sai só de dois inteiros (nada do pedido entra no nome). */
export function shotFile(tenantId, deviceId) {
  const t = Number(tenantId); const d = Number(deviceId);
  if (!Number.isInteger(t) || t < 1 || !Number.isInteger(d) || d < 1) throw fail(400, 'Captura inválida.');
  return path.join(shotsRoot(), String(t), `${d}.jpg`);
}
export async function saveShot(tenantId, deviceId, buf) {
  const file = shotFile(tenantId, deviceId);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const part = `${file}.${randomBytes(4).toString('hex')}.part`;
  await fs.promises.writeFile(part, buf);
  await fs.promises.rename(part, file);
  return file;
}
export const removeShot = (tenantId, deviceId) => fs.promises.rm(shotFile(tenantId, deviceId), { force: true });
export async function removeTenantShots(tenantId) {
  const t = Number(tenantId);
  if (!Number.isInteger(t) || t < 1) return;
  await fs.promises.rm(path.join(shotsRoot(), String(t)), { recursive: true, force: true });
}

/* ------------------------------------------------------------------ sessão do link de controle da repartição */
export const OFFICE_SESSION_MS = 8 * 3600 * 1000;
/**
 * Sessão assinada do link de controle: "r1.<repartição>.<versão do link>.<validade>.<assinatura>". Vale só para aquela
 * repartição; trocar a senha, gerar outro link ou desligar o link sobe a versão e derruba as sessões abertas.
 */
export function createOfficeSessions(secret = config.sessionSecret || randomBytes(32).toString('hex')) {
  const key = createHmac('sha256', String(secret)).update('nexa-telas:reparticao').digest();
  const sig = (p) => createHmac('sha256', key).update(p).digest('base64url');
  const same = (p, s) => { const a = Buffer.from(sig(p)); const b = Buffer.from(s); return a.length === b.length && timingSafeEqual(a, b); };
  return {
    /** user: { id, ver } = a sessão de um usuário da repartição ("r2…"); sem ele, a da senha única do link ("r1…"). */
    sign(officeId, ver, now = Date.now(), user = null) {
      const exp = now + OFFICE_SESSION_MS;
      const p = user ? `r2.${Number(officeId)}.${Number(ver)}.${Number(user.id)}.${Number(user.ver)}.${exp}` : `r1.${Number(officeId)}.${Number(ver)}.${exp}`;
      return { token: `${p}.${sig(p)}`, exp };
    },
    read(token, now = Date.now()) {
      const t = String(token || '');
      const m = /^(r1\.(\d{1,15})\.(\d{1,9})\.(\d{10,16}))\.([A-Za-z0-9_-]{43})$/.exec(t);
      if (m) {
        if (!same(m[1], m[5]) || Number(m[4]) <= now) return null;
        return { officeId: Number(m[2]), ver: Number(m[3]), exp: Number(m[4]) };
      }
      const u = /^(r2\.(\d{1,15})\.(\d{1,9})\.(\d{1,15})\.(\d{1,9})\.(\d{10,16}))\.([A-Za-z0-9_-]{43})$/.exec(t);
      if (!u || !same(u[1], u[7]) || Number(u[6]) <= now) return null;
      return { officeId: Number(u[2]), ver: Number(u[3]), userId: Number(u[4]), userVer: Number(u[5]), exp: Number(u[6]) };
    },
  };
}

/* ------------------------------------------------------------------ usuários do painel da repartição */
/** Usuário: 3 a 40 letras minúsculas, números, ponto, hífen ou sublinhado, começando por letra ou número (único na repartição). */
export const OFFICE_USER_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;
export const OFFICE_USERS_MAX = 50;
export function cleanOfficeUsername(v) {
  const u = String(v ?? '').trim().toLowerCase();
  if (!OFFICE_USER_RE.test(u)) throw fail(400, 'Usuário: 3 a 40 caracteres, só letras minúsculas, números, ponto, hífen ou sublinhado.');
  return u;
}
export function cleanOfficeRole(v) {
  if (!OFFICE_ROLE_KEYS.includes(v)) throw fail(400, 'Papel inválido (gestor ou atendente).');
  return v;
}
/** A senha do usuário da repartição: a regra mínima do projeto (authcore.checkPasswordPolicy) e o teto do link. */
export function cleanOfficePassword(v, username, production = false) {
  if (typeof v !== 'string') throw fail(400, 'Defina a senha do usuário.');
  if (v.length > LIMITS.linkPasswordMax) throw fail(400, `Senha: no máximo ${LIMITS.linkPasswordMax} caracteres.`);
  try { checkPasswordPolicy(v, { username, production }); } catch (e) { throw fail(400, e.message); }
  return v;
}
/** Quem fez, para a auditoria: "repartição: <nome> (<usuário>)"; sem usuário (a senha única do link), só o nome. */
export const officeActor = (officeName, username = '') => `repartição: ${line(officeName, 64)}${username ? ` (${username})` : ''}`.slice(0, 120);
/**
 * O que o gestor da repartição pode definir numa tela dela. Ficam com a prefeitura: o PIN e a sequência de saída (a trava
 * do aparelho) e os avisos próprios da tela (os avisos da repartição passam pela aprovação da SECOM; os da tela, não).
 */
export const OFFICE_DEVICE_CONFIG_KEYS = Object.freeze(['layout', 'tickerSpeed', 'tickerStyle', 'tickerNews', 'widgets', 'qrUrl', 'sideTitle', 'backup', 'volume', 'muted', 'schedule', 'captions', 'theme', 'callSound']);
