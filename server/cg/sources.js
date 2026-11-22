import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { db } from '../db.js';
import { SOCIAL_TYPES, PLATFORM_COLOR, PLACAR_STATS, placarExtras } from '../../public/cg/model.js';
import { safeFetch, getJson } from './net.js';
import { now as nowMs } from './time.js';
import { esporteDe, melhorDe, setState, voleiPonto, tenisPonto, tenisPontos, parciaisTxt } from '../../public/cg/placar-regras.js';
import { tseValues } from './tse.js'; // apuração do TSE (fonte "eleicao")

/**
 * Fontes de dados do gerador de caracteres de UM canal. Cada fonte vira um objeto em `dados.<id>` nos vínculos {{…}}:
 *
 *   placar     {casa:{nome,sigla,cor,logo,gols,pontos,sets,games,faltas,tempos,saque}, fora:{…}, periodo, extra, relogio,
 *              esporte, parciais, parciaisTxt, setAtual, vencedor}   (relogio corre sozinho no quadro; regras por esporte
 *              em public/cg/placar-regras.js)
 *   manual     {<chave>: valor, …}                                                      (o operador muda ao vivo)
 *   rss        {titulo, items:[{title, summary, link, date, image}]}
 *   json       o valor no caminho escolhido (lista vira {items:[…]})
 *   clima      {cidade, temp, sensacao, umidade, vento, condicao, icone, min, max, dias:[…]}     Open-Meteo, sem chave
 *   cotacoes   {items:[{codigo, nome, compra, venda, variacao, alta, baixa, hora}], USD:{…}, …}  AwesomeAPI, sem chave
 *   eleicao    {cargo, turno, apuradasTxt, candidatos:[…], c1, c2…, brancos, nulos, ufs:{SP:{cor, valor}}}  TSE (server/cg/tse.js)
 *   chats      {messages:[{id, plataforma, autor, avatar, texto, valor, at, status}], auto, ultima}
 *
 * Chats (NEXA, YouTube, Twitch, Facebook, X, Instagram, webhook) passam por moderação: chegam como "new" e só aparecem
 * no ar quando aprovados (ou na hora, com moderação automática). Erros ficam no status da fonte; o ar não para.
 */
const MAX_MESSAGES = 200;
const clean = (s, max = 500) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

/* ------------------------------------------------------------------ RSS / Atom */
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', middot: '·', bull: '•', ordf: 'ª', ordm: 'º', deg: '°',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', atilde: 'ã', otilde: 'õ', Atilde: 'Ã', Otilde: 'Õ',
  acirc: 'â', ecirc: 'ê', ocirc: 'ô', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô', agrave: 'à', Agrave: 'À', ccedil: 'ç', Ccedil: 'Ç', uuml: 'ü', Uuml: 'Ü', ntilde: 'ñ', Ntilde: 'Ñ',
};
export const decodeEntities = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return ''; } }
  return NAMED[e] ?? m;
});
// feeds costumam trazer o HTML escapado (&lt;p&gt;): tira as tags, decodifica e tira de novo as que apareceram
const stripTags = (s) => s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
const stripHtml = (s) => decodeEntities(stripTags(decodeEntities(stripTags(String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))))).replace(/\s+/g, ' ').trim();

function tag(block, names) {
  for (const n of names) {
    const re = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i');
    const m = block.match(re);
    if (m) return m[1];
  }
  return '';
}
const attr = (block, tagRe, name) => { const m = block.match(new RegExp(`<${tagRe}\\b[^>]*\\b${name}=["']([^"']+)["']`, 'i')); return m ? decodeEntities(m[1]) : ''; };

/** Lê um feed RSS 2.0 ou Atom (tolerante: feeds reais costumam ter HTML escapado, CDATA e namespaces de mídia). */
export function parseFeed(xml, max = 15) {
  const text = String(xml);
  const blocks = text.match(/<item[\s>][\s\S]*?<\/item>/gi) || text.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const channel = text.replace(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi, '');
  const items = blocks.slice(0, max).map((b) => {
    const rawDesc = tag(b, ['description', 'summary', 'content:encoded', 'content']);
    const descHtml = decodeEntities(rawDesc.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
    const link = stripHtml(tag(b, ['link'])) || attr(b, 'link', 'href');
    const image = attr(b, 'enclosure', 'url') || attr(b, 'media:content', 'url') || attr(b, 'media:thumbnail', 'url') || (descHtml.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? '');
    const date = Date.parse(stripHtml(tag(b, ['pubDate', 'published', 'updated', 'dc:date'])));
    return { title: stripHtml(tag(b, ['title'])).slice(0, 300), summary: stripHtml(rawDesc).slice(0, 600), link: link.slice(0, 500), image: /^https?:\/\//i.test(image) ? image.slice(0, 500) : '', date: Number.isFinite(date) ? date : null };
  }).filter((i) => i.title);
  return { titulo: stripHtml(tag(channel, ['title'])).slice(0, 200), items };
}

/* ------------------------------------------------------------------ clima (códigos WMO do Open-Meteo) */
const WMO = {
  0: ['Céu limpo', '☀️'], 1: ['Predomínio de sol', '🌤️'], 2: ['Parcialmente nublado', '⛅'], 3: ['Nublado', '☁️'], 45: ['Nevoeiro', '🌫️'], 48: ['Nevoeiro', '🌫️'],
  51: ['Garoa fraca', '🌦️'], 53: ['Garoa', '🌦️'], 55: ['Garoa forte', '🌧️'], 56: ['Garoa congelante', '🌧️'], 57: ['Garoa congelante', '🌧️'],
  61: ['Chuva fraca', '🌦️'], 63: ['Chuva', '🌧️'], 65: ['Chuva forte', '🌧️'], 66: ['Chuva congelante', '🌧️'], 67: ['Chuva congelante', '🌧️'],
  71: ['Neve fraca', '🌨️'], 73: ['Neve', '🌨️'], 75: ['Neve forte', '❄️'], 77: ['Grãos de neve', '🌨️'], 80: ['Pancadas de chuva', '🌦️'], 81: ['Pancadas de chuva', '🌧️'],
  82: ['Pancadas de chuva fortes', '⛈️'], 85: ['Pancadas de neve', '🌨️'], 86: ['Pancadas de neve', '🌨️'], 95: ['Trovoadas', '⛈️'], 96: ['Trovoadas com granizo', '⛈️'], 99: ['Trovoadas com granizo', '⛈️'],
};
export const weatherText = (code) => WMO[code] || ['—', ''];

export async function geocode(q) {
  const r = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(String(q).slice(0, 80))}&count=5&language=pt&format=json`, { timeout: 8000 });
  return (r.results || []).map((x) => ({ nome: x.name, estado: x.admin1 || '', pais: x.country || '', lat: x.latitude, lon: x.longitude }));
}

/** ID do vídeo a partir de um link do YouTube (watch?v=, youtu.be/, /live/, /shorts/) ou do próprio ID. */
export function youtubeId(s) {
  const v = String(s || '').trim();
  const m = v.match(/(?:v=|youtu\.be\/|\/live\/|\/shorts\/|\/embed\/)([\w-]{11})/) || v.match(/^([\w-]{11})$/);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ hub */
export class SourceHub extends EventEmitter {
  /** Palavras proibidas (server/palavras-proibidas.js): (id do canal, { name, text }) -> { name, text } mascarados; o servidor liga. */
  static mask = null;
  /** @param {{channelId:number, tenantId?:number, secretOf:(id:string)=>string|null}} opts */
  constructor({ channelId, tenantId = null, secretOf }) {
    super();
    this.channelId = channelId;
    this.tenantId = tenantId; // cliente do canal: fila justa e teto de fontes da apuração do TSE
    this.secretOf = secretOf;
    this.defs = new Map();      // id -> definição (projeto)
    this.values = new Map();    // id -> valores atuais
    this.status = new Map();    // id -> {ok, error, updatedAt, next}
    this.runners = new Map();   // id -> {timer, ws, key}
    this.runtime = { manual: {}, placar: {}, social: {}, cursors: {}, muralFotos: {} }; // muralFotos: arquivo -> envio (apagar em 7 dias)
    this.active = false;
    this.snapshotCache = null;
  }

  /** Estado do operador (placar, valores manuais, mensagens moderadas) salvo junto com o estado do ar. */
  exportState() {
    const social = {};
    for (const [id, v] of this.values) if (v?.messages) social[id] = v.messages.slice(-80);
    return { manual: this.runtime.manual, placar: this.runtime.placar, social, cursors: this.runtime.cursors, muralFotos: this.runtime.muralFotos };
  }
  restore(s = {}) {
    this.runtime.manual = s.manual || {};
    this.runtime.placar = s.placar || {};
    this.runtime.cursors = s.cursors || {};
    this.runtime.muralFotos = s.muralFotos && typeof s.muralFotos === 'object' ? s.muralFotos : {};
    // `ultima` só de aprovada ou que já foi ao ar: um pendente nunca aparece na saída pública depois de reiniciar
    for (const [id, msgs] of Object.entries(s.social || {})) if (Array.isArray(msgs)) this.values.set(id, { messages: msgs, auto: false, ultima: msgs.filter((m) => m?.status === 'approved' || m?.status === 'aired').at(-1) || null });
  }

  /** Aplica as definições do projeto; com active=false (CG desligado) nada consulta a internet. */
  sync(sources, active) {
    this.active = active;
    const ids = new Set(sources.map((s) => s.id));
    for (const id of [...this.defs.keys()]) if (!ids.has(id)) { this.#stop(id); this.defs.delete(id); this.values.delete(id); this.status.delete(id); }
    for (const s of sources) {
      const prev = this.defs.get(s.id);
      this.defs.set(s.id, s);
      const key = JSON.stringify([s.type, s.enabled, s.interval, s.config, this.secretOf(s.id) ? 1 : 0]);
      const run = this.runners.get(s.id);
      // placar e valores manuais não consultam nada: só recalculam a partir do projeto + estado do operador
      if (!active || !s.enabled || s.type === 'placar' || s.type === 'manual') { this.#stop(s.id); this.#local(s); continue; }
      if (run && run.key === key && prev) { this.#local(s); continue; }
      this.#stop(s.id);
      this.#local(s);
      this.#start(s, key);
    }
    this.#changed();
  }

  /** Fontes que não dependem de rede (placar e manual) recalculadas a partir da definição + estado do operador. */
  #local(s) {
    if (s.type === 'manual') this.values.set(s.id, { ...s.config.values, ...(this.runtime.manual[s.id] || {}) });
    else if (s.type === 'placar') this.values.set(s.id, this.#placarValues(s));
    else if (SOCIAL_TYPES.has(s.type)) {
      const v = this.values.get(s.id) || { messages: [] };
      v.auto = s.moderation === 'auto';
      if (s.type === 'mural') v.aprovadas = muralApproved(v.messages || []); // também depois de um reinício
      this.values.set(s.id, v);
    }
  }

  #placarValues(s) {
    const r = this.runtime.placar[s.id] || {};
    const c = s.config;
    // esporte: futebol/futsal/handebol/basquete/outro somam gols; vôlei e tênis contam pontos dentro de sets (r.jogo)
    const esporte = c.sport || 'futebol';
    const e = esporteDe(esporte);
    const jogo = setState(r.jogo);
    const tl = esporte === 'tenis' ? tenisPontos(jogo) : null;
    const team = (cfg, side) => {
      const gols = r[side]?.gols ?? 0;
      return {
        nome: cfg.name, sigla: cfg.short || cfg.name.slice(0, 3).toUpperCase(), cor: cfg.color, logo: cfg.logo, gols,
        pontos: e.sets ? (tl ? tl[side] : jogo.pts[side]) : gols, sets: jogo.sets[side], games: jogo.games[side],
        faltas: r[side]?.faltas ?? 0, tempos: r[side]?.tempos ?? 0, saque: Boolean(e.saque && jogo.saque === side),
        parciais: jogo.parciais.map((p) => p[side]).join('  '), // os sets já jogados, na linha do time
      };
    };
    const clock = r.relogio || { run: false, at: 0, base: c.clockDir === 'down' ? c.clockLimit : 0 };
    // partida (Composer): campeonato, estádio, acréscimo, estatísticas, pênaltis e elencos (public/cg/model.js)
    const { elencos, tecnicos, ...x } = placarExtras(c, r);
    return {
      casa: { ...team(c.home, 'casa'), tecnico: tecnicos.casa, elenco: elencos.casa }, fora: { ...team(c.away, 'fora'), tecnico: tecnicos.fora, elenco: elencos.fora },
      periodo: r.periodo ?? c.period, extra: r.extra ?? c.extra,
      esporte, esporteNome: e.label, melhorDe: melhorDe(esporte, c.bestOf), setAtual: Math.min(7, jogo.parciais.length + 1), parciais: jogo.parciais,
      parciaisTxt: parciaisTxt(jogo.parciais), tiebreak: jogo.tb, vencedor: jogo.fim || '', sacando: e.saque ? jogo.saque || '' : '',
      vencedorNome: jogo.fim ? (jogo.fim === 'casa' ? c.home.name : c.away.name) : '',
      relogio: { __clock: 1, run: Boolean(clock.run), at: clock.at, base: clock.base, dir: c.clockDir, limit: c.clockDir === 'up' ? c.clockLimit : 0 },
      ...x,
    };
  }

  #stop(id) {
    const r = this.runners.get(id);
    if (!r) return;
    r.stopped = true;
    clearTimeout(r.timer);
    try { r.ws?.close(); } catch { /* já fechado */ }
    this.runners.delete(id);
  }

  stopAll() { for (const id of [...this.runners.keys()]) this.#stop(id); }

  #start(s, key) {
    const r = { key, timer: null, ws: null, stopped: false, fails: 0 };
    this.runners.set(s.id, r);
    if (s.type === 'twitch') return this.#twitch(s, r);
    const poller = this[`poll_${s.type}`];
    if (!poller) return;
    const loop = async () => {
      if (r.stopped) return;
      let wait = s.interval * 1000;
      try {
        const res = await poller.call(this, s);
        if (r.stopped) return;
        r.fails = 0;
        this.status.set(s.id, { ok: true, error: null, updatedAt: nowMs() });
        if (res?.wait) wait = Math.max(wait, res.wait);
      } catch (e) {
        if (r.stopped) return;
        r.fails++;
        wait = Math.min(600_000, wait * 2 ** Math.min(r.fails, 4));
        this.status.set(s.id, { ok: false, error: String(e.message || e).slice(0, 240), updatedAt: this.status.get(s.id)?.updatedAt || null });
        this.emit('status', s.id);
      }
      this.status.get(s.id).next = nowMs() + wait;
      r.timer = setTimeout(loop, wait);
      r.timer.unref?.();
    };
    r.timer = setTimeout(loop, 50);
    r.timer.unref?.();
  }

  /** Atualiza agora (botão "Testar"/"Atualizar" do painel). */
  async refresh(id) {
    const s = this.defs.get(id);
    if (!s) throw Object.assign(new Error('Fonte inexistente.'), { status: 404 });
    const poller = this[`poll_${s.type}`];
    if (!poller) return this.values.get(id);
    try {
      await poller.call(this, s);
      this.status.set(id, { ok: true, error: null, updatedAt: nowMs() });
    } catch (e) {
      this.status.set(id, { ok: false, error: String(e.message || e).slice(0, 240), updatedAt: this.status.get(id)?.updatedAt || null });
      throw e;
    }
    return this.values.get(id);
  }

  #set(id, v) { this.values.set(id, v); this.#changed(id); }
  #changed(id) { this.snapshotCache = null; this.emit('change', id); }

  /** Objeto `dados` do renderizador (recriado só quando algo muda). */
  snapshot() {
    if (!this.snapshotCache) this.snapshotCache = Object.fromEntries(this.values);
    return this.snapshotCache;
  }

  statusList() {
    return [...this.defs.values()].map((s) => {
      const st = this.status.get(s.id) || {};
      const v = this.values.get(s.id);
      return {
        id: s.id, type: s.type, enabled: s.enabled, running: this.runners.has(s.id), ok: st.ok ?? null, error: st.error || null, updatedAt: st.updatedAt || null, next: st.next || null,
        count: v?.messages ? v.messages.length : Array.isArray(v?.items) ? v.items.length : null,
        pending: v?.messages ? v.messages.filter((m) => m.status === 'new').length : null,
      };
    });
  }

  /* ---------------------------------------------------------------- operador: placar e valores manuais */
  placar(id, cmd, arg = {}) {
    const s = this.defs.get(id);
    if (!s || s.type !== 'placar') throw Object.assign(new Error('Placar inexistente.'), { status: 404 });
    const r = (this.runtime.placar[id] ||= {});
    const now = nowMs();
    const cur = this.#placarValues(s).relogio;
    const secs = () => { const el = cur.base + (cur.run ? ((now - cur.at) / 1000) * (cur.dir === 'down' ? -1 : 1) : 0); return Math.max(0, cur.dir === 'up' && cur.limit ? Math.min(cur.limit, el) : el); };
    const side = arg.team === 'fora' ? 'fora' : 'casa';
    switch (cmd) {
      // gols: só o número de gols muda (faltas e pedidos de tempo do time ficam)
      case 'gol': r[side] = { ...r[side], gols: Math.max(0, Math.min(999, (r[side]?.gols ?? 0) + (Number(arg.delta) || 1))) }; break;
      case 'gols': r[side] = { ...r[side], gols: Math.max(0, Math.min(999, Math.round(Number(arg.value) || 0))) }; break;
      // ponto conforme o esporte (public/cg/placar-regras.js): +1/+2/+3 no basquete; no vôlei e no tênis o ponto fecha game,
      // set e partida sozinho, e −1 desfaz o último ponto
      case 'ponto': {
        const esporte = s.config.sport || 'futebol';
        const e = esporteDe(esporte);
        const delta = Math.max(-3, Math.min(3, Math.round(Number(arg.delta) || 1)));
        if (!e.sets) { r[side] = { ...r[side], gols: Math.max(0, Math.min(999, (r[side]?.gols ?? 0) + delta)) }; break; }
        if (delta < 0) { const prev = (r.hist ||= []).pop(); if (prev) r.jogo = prev; break; }
        (r.hist ||= []).push(setState(r.jogo));
        if (r.hist.length > 40) r.hist.shift();
        const opts = { esporte, sets: s.config.bestOf };
        r.jogo = esporte === 'tenis' ? tenisPonto(r.jogo, side, opts) : voleiPonto(r.jogo, side, opts);
        break;
      }
      case 'desfazer': { const prev = (r.hist ||= []).pop(); if (prev) r.jogo = prev; break; }
      case 'saque': r.jogo = { ...setState(r.jogo), saque: arg.team === 'fora' || arg.team === 'casa' ? side : setState(r.jogo).saque === 'casa' ? 'fora' : 'casa' }; break;
      // correções à mão: sets e games do time (sem regra), faltas e pedidos de tempo
      case 'set': case 'game': {
        const j = setState(r.jogo);
        const k = cmd === 'set' ? 'sets' : 'games';
        j[k][side] = Math.max(0, Math.min(cmd === 'set' ? 7 : 99, j[k][side] + (Math.round(Number(arg.delta)) || 1)));
        r.jogo = j;
        break;
      }
      case 'falta': case 'tempo': {
        const k = cmd === 'falta' ? 'faltas' : 'tempos';
        const v = arg.value != null && arg.value !== '' ? Number(arg.value) : (r[side]?.[k] ?? 0) + (Number(arg.delta) || 1);
        r[side] = { ...r[side], [k]: Math.max(0, Math.min(99, Math.round(Number.isFinite(v) ? v : 0))) };
        break;
      }
      case 'periodo': r.periodo = clean(arg.value, 20); break;
      case 'extra': r.extra = clean(arg.value, 80); break;
      case 'iniciar': r.relogio = { run: true, at: now, base: secs() }; break;
      case 'parar': r.relogio = { run: false, at: now, base: secs() }; break;
      case 'zerar': r.relogio = { run: false, at: now, base: s.config.clockDir === 'down' ? s.config.clockLimit : 0 }; for (const k of ['casa', 'fora', 'periodo', 'stats', 'posse', 'pen', 'acrescimo', 'jogo', 'hist']) delete r[k]; break;
      // partida (Composer): estatística (+delta ou valor), posse da casa em %, acréscimo em minutos e disputa de pênaltis
      case 'stat': {
        const key = String(arg.key || '');
        if (!PLACAR_STATS.some(([k]) => k === key) || key === 'posse') throw Object.assign(new Error('Estatística inválida.'), { status: 400 });
        const st = ((r.stats ||= {})[side] ||= {});
        const v = arg.value != null && arg.value !== '' ? Number(arg.value) : (Number(st[key]) || 0) + (Number(arg.delta) || 1);
        st[key] = Math.max(0, Math.min(999, Math.round(Number.isFinite(v) ? v : 0)));
        break;
      }
      case 'posse': r.posse = Math.max(0, Math.min(100, Math.round(Number(arg.value) || 0))); break;
      case 'acrescimo': r.acrescimo = Math.max(0, Math.min(99, Math.round(Number(arg.value) || 0))); break;
      // o controle remoto manda texto (?value=0): '0', 'false', 'off', 'nao' e vazio desligam
      case 'penaltis': r.pen = { ...(r.pen || {}), ativo: arg.value === true || (arg.value !== false && !['', '0', 'false', 'off', 'nao', 'não'].includes(String(arg.value ?? '').trim().toLowerCase())) }; break;
      case 'penalti': {
        const res = arg.value === 'x' ? 'x' : arg.value === 'g' ? 'g' : null;
        const pen = (r.pen ||= { ativo: true });
        const list = (pen[side] ||= []);
        if (res && list.length < 30) list.push(res); else if (!res) list.pop(); // sem resultado = desfaz a última cobrança do time
        break;
      }
      case 'penaltisZerar': r.pen = { ativo: Boolean(r.pen?.ativo) }; break;
      case 'relogio': r.relogio = { run: Boolean(cur.run), at: now, base: Math.max(0, Math.min(36000, Number(arg.value) || 0)) }; break;
      default: throw Object.assign(new Error('Comando de placar inválido.'), { status: 400 });
    }
    this.#set(id, this.#placarValues(s));
    return this.values.get(id);
  }

  setManual(id, values = {}) {
    const s = this.defs.get(id);
    if (!s || s.type !== 'manual') throw Object.assign(new Error('Fonte de valores manuais inexistente.'), { status: 404 });
    const cur = (this.runtime.manual[id] ||= {});
    for (const [k, v] of Object.entries(values).slice(0, 100)) if (/^[A-Za-z0-9_.-]{1,40}$/.test(k)) cur[k] = String(v ?? '').slice(0, 2000);
    this.#local(s); this.#changed(id);
    return this.values.get(id);
  }

  /* ---------------------------------------------------------------- chats: moderação e entrada */
  #addMessages(id, list, { initial = false } = {}) {
    const s = this.defs.get(id);
    if (!s) return 0;
    const v = this.values.get(id) || { messages: [] };
    const seen = new Set(v.messages.map((m) => m.id));
    const now = nowMs();
    let added = 0;
    for (const m of list) {
      if (!m.texto && !m.imagem && !m.media) continue;
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const auto = s.moderation === 'auto';
      // palavras proibidas: o que vai ao ar (aprovado na hora ou pela moderação) já entra mascarado, autor e texto
      const sh = SourceHub.mask && (m.autor || m.texto) ? SourceHub.mask(this.channelId, { name: m.autor || '', text: m.texto || '' }) : null;
      const approved = auto && !m.manual;
      v.messages.push({ ...m, ...(sh ? { autor: m.autor ? sh.name : m.autor, texto: m.texto ? sh.text : m.texto } : {}), status: approved ? 'approved' : 'new', shownAt: approved ? now : null, cor: PLATFORM_COLOR[m.plataforma] || '#ffb224' });
      added++;
    }
    if (!added) return 0;
    v.messages.sort((a, b) => (a.at || 0) - (b.at || 0));
    if (v.messages.length > MAX_MESSAGES) {
      // mural: o estouro tira primeiro as pendentes e rejeitadas mais antigas (uma enxurrada não apaga o que já foi aprovado)
      const over = v.messages.length - MAX_MESSAGES;
      const order = s.type === 'mural' ? [...v.messages.filter((m) => m.status === 'new' || m.status === 'rejected'), ...v.messages.filter((m) => m.status !== 'new' && m.status !== 'rejected')] : v.messages;
      const out = new Set(order.slice(0, over));
      for (const old of out) this.#dropMuralAsset(old); // a mídia sai junto com a mensagem
      v.messages = v.messages.filter((m) => !out.has(m));
    }
    v.auto = s.moderation === 'auto';
    v.ultima = v.messages.filter((m) => m.status !== 'rejected' && m.status !== 'new').at(-1) || null;
    if (s.type === 'mural') v.aprovadas = muralApproved(v.messages);
    this.values.set(id, { ...v });
    this.#changed(id);
    if (!initial) this.emit('messages', id, added);
    return added;
  }

  moderate(id, msgId, status) {
    const v = this.values.get(id);
    const m = v?.messages?.find((x) => x.id === msgId);
    if (!m) throw Object.assign(new Error('Mensagem não encontrada.'), { status: 404 });
    if (!['approved', 'rejected', 'aired', 'new'].includes(status)) throw Object.assign(new Error('Status inválido.'), { status: 400 });
    m.status = status;
    if (status === 'approved' || status === 'aired') m.shownAt = nowMs();
    if (status === 'rejected') this.#dropMuralAsset(m); // mural: mídia rejeitada some na hora
    v.ultima = v.messages.filter((x) => x.status === 'approved' || x.status === 'aired').at(-1) || null;
    if (this.defs.get(id)?.type === 'mural') v.aprovadas = muralApproved(v.messages);
    this.values.set(id, { ...v });
    this.#changed(id);
    return m;
  }

  clearMessages(id) {
    const v = this.values.get(id);
    if (v?.messages) {
      for (const m of v.messages) this.#dropMuralAsset(m);
      this.values.set(id, { ...v, messages: [], ultima: null, ...(v.aprovadas ? { aprovadas: [] } : {}) });
      this.#changed(id);
    }
  }

  /** Repassa a máscara por mensagens ainda guardadas quando uma palavra é incluída depois do envio. */
  remoderate(mask = SourceHub.mask) {
    if (typeof mask !== 'function') return 0;
    let total = 0;
    for (const [id, v] of this.values) {
      if (!v?.messages) continue;
      let changed = false;
      for (const m of v.messages) {
        const sh = mask(this.channelId, { name: m.autor || '', text: m.texto || '' });
        const autor = m.autor ? sh.name : m.autor;
        const texto = m.texto ? sh.text : m.texto;
        if (autor === m.autor && texto === m.texto) continue;
        m.autor = autor; m.texto = texto; changed = true; total++;
      }
      if (!changed) continue;
      if (this.defs.get(id)?.type === 'mural') v.aprovadas = muralApproved(v.messages);
      this.values.set(id, { ...v });
      this.#changed(id);
    }
    return total;
  }

  /* ---------------------------------------------------------------- mural ao vivo (server/cg/mural.js) */
  /**
   * Envio do público já validado (texto limpo, foto recodificada em graphics/). Entra na fila de moderação da fonte (ou já
   * aprovado, se o canal ligou a aprovação automática). Devolve { id, status }.
   */
  ingestMural(id, { autor, texto, imagem = '', media = '', mediaType = '', consentAt, manual = false, sourceIp = '', device = '', clientKind = '' }) {
    const s = this.defs.get(id);
    if (!s || s.type !== 'mural') throw Object.assign(new Error('Mural inexistente.'), { status: 404 });
    const msgId = `mural:${nowMs().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    if (imagem) this.runtime.muralFotos[imagem] = nowMs();
    if (media) this.runtime.muralFotos[media] = nowMs();
    const added = this.#addMessages(id, [{
      id: msgId, plataforma: 'mural', autor: clean(autor, 80), texto: clean(texto, 600), imagem, media, mediaType,
      manual: Boolean(manual), avatar: imagem, consentAt: Number(consentAt) || nowMs(), at: nowMs(),
      // Estes campos não entram em `muralApproved` nem na saída pública do CG.
      sourceIp: clean(sourceIp, 80), device: clean(device, 80), clientKind: clean(clientKind, 40),
    }]);
    if (!added) { if (imagem || media) this.#dropMuralAsset({ imagem, media }); throw Object.assign(new Error('Mensagem vazia.'), { status: 400 }); }
    const m = this.values.get(id).messages.find((x) => x.id === msgId);
    return { id: msgId, status: m?.status || 'new' };
  }

  /** Mensagens do mural na fila (para o limite de pendentes por canal). */
  muralPending(id) { return (this.values.get(id)?.messages || []).filter((m) => m.status === 'new').length; }

  /**
   * Prazo das fotos e mensagens do mural (7 dias): mensagens mais velhas saem da fila e do rodízio, e toda foto do índice
   * mais velha é apagada (inclusive a de mensagem que já tinha saído por limite ou reinício). Devolve quantas fotos saíram.
   */
  expireMural(maxAgeMs = 7 * 24 * 3600 * 1000, now = nowMs()) {
    const limit = now - maxAgeMs;
    let n = 0;
    const dropped = new Set();
    for (const [id, v] of this.values) {
      if (this.defs.get(id)?.type !== 'mural' || !v?.messages) continue;
      const keep = v.messages.filter((m) => (m.at || 0) >= limit);
      if (keep.length === v.messages.length) continue;
      for (const m of v.messages) { const f = m.imagem || m.media; if ((m.at || 0) < limit && this.#dropMuralAsset(m)) { n++; dropped.add(f); } }
      this.values.set(id, { ...v, messages: keep, aprovadas: muralApproved(keep), ultima: keep.filter((x) => x.status === 'approved' || x.status === 'aired').at(-1) || null });
      this.#changed(id);
    }
    // fotos só no índice: mais velhas que o prazo, ou marcadas para apagar (0) e ainda não confirmadas pelo armazenamento
    for (const [file, at] of Object.entries(this.runtime.muralFotos)) if (at < limit && !dropped.has(file) && this.#dropMuralAsset({ imagem: file })) n++;
    return n;
  }

  /**
   * Tira a foto de uma mensagem do mural (rejeição, limite, prazo): sai do índice e o gerenciador apaga o arquivo. Só apaga
   * arquivo que este canal mesmo recebeu pelo mural (índice muralFotos): um "imagem" vindo de webhook não apaga nada.
   */
  #dropMuralAsset(m) {
    const file = m?.imagem || m?.media;
    if (!file || !Object.hasOwn(this.runtime.muralFotos, file)) return false;
    // marcada para apagar (0): só sai do índice quando o armazenamento confirmar (photoGone); se o apagar falhar, a
    // próxima varredura (expireMural) tenta de novo
    this.runtime.muralFotos[file] = 0;
    if (m.imagem === file) m.imagem = '';
    if (m.media === file) m.media = '';
    if (m.avatar === file) m.avatar = '';
    this.emit('dropPhoto', file);
    return true;
  }

  /** O armazenamento apagou a foto: sai do índice. */
  photoGone(file) {
    if (Object.hasOwn(this.runtime.muralFotos, file)) delete this.runtime.muralFotos[file];
  }

  /** Fotos do mural deste canal ainda no índice (para apagar tudo quando o canal é excluído). */
  muralFiles() { return Object.keys(this.runtime.muralFotos); }

  /** Webhook (outras plataformas, automações, robôs de chat): mensagens e/ou valores. */
  ingest(id, body) {
    const s = this.defs.get(id);
    if (!s || s.type !== 'webhook') throw Object.assign(new Error('Fonte inexistente.'), { status: 404 });
    const one = (b) => ({
      id: `hook:${clean(b.id, 80) || `${nowMs()}-${Math.random().toString(36).slice(2, 8)}`}`,
      plataforma: clean(b.platform || b.plataforma || 'webhook', 20).toLowerCase(),
      autor: clean(b.author || b.autor || b.name || b.user || '', 60),
      avatar: /^https?:\/\//i.test(String(b.avatar || '')) ? String(b.avatar).slice(0, 500) : '',
      texto: clean(b.text || b.texto || b.message || b.mensagem || '', 500),
      valor: clean(b.amount || b.valor || '', 30),
      at: Number(b.at) || nowMs(),
    });
    let added = 0;
    if (Array.isArray(body?.messages)) added = this.#addMessages(id, body.messages.slice(0, 50).map(one));
    else if (body && (body.text || body.texto || body.message || body.mensagem)) added = this.#addMessages(id, [one(body)]);
    if (body?.values && typeof body.values === 'object' && !Array.isArray(body.values)) {
      const v = this.values.get(id) || { messages: [] };
      const vals = {};
      for (const [k, x] of Object.entries(body.values).slice(0, 100)) if (/^[A-Za-z0-9_]{1,40}$/.test(k) && k !== 'messages') vals[k] = typeof x === 'object' ? x : String(x ?? '').slice(0, 2000);
      this.values.set(id, { ...v, ...vals });
      this.#changed(id);
    }
    this.status.set(id, { ok: true, error: null, updatedAt: nowMs() });
    return { added };
  }

  /* ---------------------------------------------------------------- consultas (uma por tipo) */
  async poll_rss(s) {
    if (!s.config.url) throw new Error('Informe o endereço do feed.');
    const r = await safeFetch(s.config.url, { headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }, maxBytes: 4 * 1024 * 1024 });
    if (r.status >= 400) throw new Error(`O feed respondeu HTTP ${r.status}.`);
    const feed = parseFeed(r.text(), s.config.max);
    if (!feed.items.length) throw new Error('Nenhum item encontrado: o endereço é mesmo um feed RSS ou Atom?');
    this.#set(s.id, feed);
  }

  async poll_json(s) {
    if (!s.config.url) throw new Error('Informe o endereço da API.');
    const data = await getJson(s.config.url, { headers: { accept: 'application/json' }, maxBytes: 1024 * 1024 });
    let v = data;
    for (const seg of s.config.path.split('.').filter(Boolean)) v = v == null ? undefined : Array.isArray(v) && /^\d+$/.test(seg) ? v[Number(seg)] : v[seg];
    if (v === undefined) throw new Error(`Caminho "${s.config.path}" não existe na resposta.`);
    this.#set(s.id, Array.isArray(v) ? { items: v.slice(0, 200) } : v && typeof v === 'object' ? v : { value: v });
  }

  async poll_clima(s) {
    const { lat, lon, city } = s.config;
    const q = `latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=7`;
    const d = await getJson(`https://api.open-meteo.com/v1/forecast?${q}`, { timeout: 10000 });
    const c = d.current || {};
    const [condicao, icone] = weatherText(c.weather_code);
    const dias = (d.daily?.time || []).slice(0, 7).map((day, i) => ({ data: day, min: d.daily.temperature_2m_min[i], max: d.daily.temperature_2m_max[i], condicao: weatherText(d.daily.weather_code[i])[0], icone: weatherText(d.daily.weather_code[i])[1] }));
    this.#set(s.id, {
      cidade: city, temp: c.temperature_2m, sensacao: c.apparent_temperature, umidade: c.relative_humidity_2m, vento: c.wind_speed_10m,
      condicao, icone, codigo: c.weather_code, dia: c.is_day === 1, min: dias[0]?.min ?? null, max: dias[0]?.max ?? null, dias,
    });
  }

  async poll_cotacoes(s) {
    const pairs = s.config.pairs.split(',').map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z0-9]{2,8}-[A-Z0-9]{2,8}$/.test(x)).slice(0, 12);
    if (!pairs.length) throw new Error('Informe pares como USD-BRL,EUR-BRL.');
    const d = await getJson(`https://economia.awesomeapi.com.br/json/last/${pairs.join(',')}`, { timeout: 10000 });
    const items = pairs.map((p) => {
      const x = d[p.replace('-', '')];
      if (!x) return null;
      return { codigo: x.code, par: p, nome: x.name, compra: Number(x.bid), venda: Number(x.ask), variacao: Number(x.pctChange), alta: Number(x.high), baixa: Number(x.low), hora: Number(x.timestamp) * 1000 || null };
    }).filter(Boolean);
    if (!items.length) throw new Error('A API não devolveu nenhum dos pares pedidos.');
    this.#set(s.id, { items, ...Object.fromEntries(items.map((i) => [i.codigo, i])) });
  }

  /** Apuração do TSE: o arquivo oficial da abrangência e, com o mapa, as 27 UFs (guardados 20 s para todos os canais). */
  async poll_eleicao(s) {
    const v = await tseValues(s.config, { tenant: this.tenantId, key: `${this.channelId}:${s.id}` });
    this.#set(s.id, v);
    return v.mapaIndisponivel ? { wait: 5 * 60000 } : null; // nenhuma UF respondeu: espaça as consultas
  }

  async poll_nexachat(s) {
    const cur = this.runtime.cursors[s.id];
    const rows = cur == null
      ? (await db.all('SELECT id, name, text, created_at FROM chat WHERE channel_id=? AND product_id IS NULL ORDER BY id DESC LIMIT 15', [this.channelId])).reverse()
      : await db.all('SELECT id, name, text, created_at FROM chat WHERE channel_id=? AND product_id IS NULL AND id > ? ORDER BY id LIMIT 100', [this.channelId, cur]);
    if (rows.length) this.runtime.cursors[s.id] = rows[rows.length - 1].id;
    else if (cur == null) this.runtime.cursors[s.id] = 0;
    this.#addMessages(s.id, rows.map((r) => ({ id: `nexa:${r.id}`, plataforma: 'nexa', autor: clean(r.name, 60), avatar: '', texto: clean(r.text, 500), at: Number(r.created_at) })), { initial: cur == null });
    return { wait: Math.max(2000, s.interval * 1000) };
  }

  async poll_youtube(s) {
    const key = this.secretOf(s.id);
    if (!key) throw new Error('Informe a chave da API do YouTube (YouTube Data API v3).');
    const vid = youtubeId(s.config.video);
    if (!vid) throw new Error('Informe o link ou o ID do vídeo ao vivo.');
    const st = (this.runtime.cursors[s.id] ||= {});
    if (st.video !== vid || !st.chat) {
      const v = await getJson(`https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${vid}&key=${encodeURIComponent(key)}`);
      const chat = v.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
      if (!chat) throw new Error('Este vídeo não tem chat ao vivo ativo (a live terminou ou ainda não começou).');
      Object.assign(st, { video: vid, chat, page: null });
    }
    let d;
    try {
      d = await getJson(`https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${encodeURIComponent(st.chat)}&part=snippet,authorDetails&maxResults=200${st.page ? `&pageToken=${encodeURIComponent(st.page)}` : ''}&key=${encodeURIComponent(key)}`);
    } catch (e) { if (e.status === 403 || e.status === 404) st.chat = null; throw e; }
    const first = !st.page;
    st.page = d.nextPageToken || st.page;
    const list = (d.items || []).filter((i) => i.snippet?.displayMessage || i.snippet?.superChatDetails).map((i) => ({
      id: `yt:${i.id}`, plataforma: 'youtube', autor: clean(i.authorDetails?.displayName, 60), avatar: i.authorDetails?.profileImageUrl || '',
      // canal do autor no YouTube: os comentários unificados (server/comentarios.js) leem daqui e banem por ele
      autorId: /^UC[A-Za-z0-9_-]{22}$/.test(String(i.authorDetails?.channelId || '')) ? `youtube:${i.authorDetails.channelId}` : '',
      texto: clean(i.snippet.displayMessage || i.snippet.superChatDetails?.userComment || '', 500), valor: clean(i.snippet.superChatDetails?.amountDisplayString || '', 30),
      at: Date.parse(i.snippet.publishedAt) || nowMs(),
    }));
    this.#addMessages(s.id, first ? list.slice(-15) : list, { initial: first });
    // a própria API diz quanto esperar; respeitar isso também economiza a cota diária da chave
    return { wait: Number(d.pollingIntervalMillis) || 0 };
  }

  async poll_facebook(s) {
    const token = this.secretOf(s.id);
    if (!token) throw new Error('Informe o token de acesso da página.');
    if (!/^\d{5,30}$/.test(s.config.live)) throw new Error('Informe o ID numérico do vídeo ao vivo.');
    const d = await getJson(`https://graph.facebook.com/v19.0/${s.config.live}/comments?fields=id,message,created_time,from{name,picture}&order=reverse_chronological&live_filter=no_filter&limit=50&access_token=${encodeURIComponent(token)}`);
    const first = !this.runtime.cursors[s.id];
    this.runtime.cursors[s.id] = 1;
    this.#addMessages(s.id, (d.data || []).map((c) => ({
      id: `fb:${c.id}`, plataforma: 'facebook', autor: clean(c.from?.name || 'Facebook', 60), avatar: c.from?.picture?.data?.url || '', texto: clean(c.message, 500), at: Date.parse(c.created_time) || nowMs(),
    })), { initial: first });
  }

  async poll_x(s) {
    const token = this.secretOf(s.id);
    if (!token) throw new Error('Informe o bearer token da API do X.');
    if (!s.config.query.trim()) throw new Error('Informe a busca (ex.: #MinhaTV -is:retweet).');
    const st = (this.runtime.cursors[s.id] ||= {});
    const q = new URLSearchParams({ query: s.config.query, max_results: '25', 'tweet.fields': 'created_at,author_id', expansions: 'author_id', 'user.fields': 'name,username,profile_image_url' });
    if (st.since) q.set('since_id', st.since);
    const d = await getJson(`https://api.x.com/2/tweets/search/recent?${q}`, { headers: { authorization: `Bearer ${token}` } });
    const users = new Map((d.includes?.users || []).map((u) => [u.id, u]));
    if (d.meta?.newest_id) st.since = d.meta.newest_id;
    this.#addMessages(s.id, (d.data || []).map((tw) => {
      const u = users.get(tw.author_id) || {};
      return { id: `x:${tw.id}`, plataforma: 'x', autor: clean(u.name ? `${u.name} @${u.username}` : 'X', 80), avatar: u.profile_image_url || '', texto: clean(tw.text, 500), at: Date.parse(tw.created_at) || nowMs() };
    }));
  }

  async poll_instagram(s) {
    const token = this.secretOf(s.id);
    if (!token) throw new Error('Informe o token de acesso do Instagram (Graph API).');
    const user = s.config.user;
    if (!/^\d{5,30}$/.test(user)) throw new Error('Informe o ID numérico da conta profissional do Instagram.');
    const g = (p) => getJson(`https://graph.facebook.com/v19.0/${p}${p.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`);
    let list = [];
    if (s.config.mode === 'hashtag') {
      const tagName = s.config.hashtag.replace(/^#/, '').trim();
      if (!tagName) throw new Error('Informe a hashtag.');
      const h = await g(`ig_hashtag_search?user_id=${user}&q=${encodeURIComponent(tagName)}`);
      const hid = h.data?.[0]?.id;
      if (!hid) throw new Error('Hashtag não encontrada.');
      const d = await g(`${hid}/recent_media?user_id=${user}&fields=id,caption,media_url,permalink,timestamp&limit=25`);
      list = (d.data || []).map((m) => ({ id: `ig:${m.id}`, plataforma: 'instagram', autor: `#${tagName}`, avatar: '', imagem: m.media_url || '', texto: clean(m.caption, 500), at: Date.parse(m.timestamp) || nowMs() }));
    } else if (s.config.mode === 'live') {
      const live = await g(`${user}/live_media?fields=id`);
      const lid = live.data?.[0]?.id;
      if (!lid) throw new Error('A conta não está ao vivo agora.');
      const d = await g(`${lid}/comments?fields=id,text,username,timestamp`);
      list = (d.data || []).map((c) => ({ id: `igc:${c.id}`, plataforma: 'instagram', autor: clean(`@${c.username}`, 60), avatar: '', texto: clean(c.text, 500), at: Date.parse(c.timestamp) || nowMs() }));
    } else {
      const d = await g(`${user}/media?fields=id,caption,media_url,thumbnail_url,permalink,timestamp,username&limit=25`);
      list = (d.data || []).map((m) => ({ id: `ig:${m.id}`, plataforma: 'instagram', autor: clean(`@${m.username || ''}`, 60), avatar: '', imagem: m.thumbnail_url || m.media_url || '', texto: clean(m.caption, 500), at: Date.parse(m.timestamp) || nowMs() }));
    }
    const first = !this.runtime.cursors[s.id];
    this.runtime.cursors[s.id] = 1;
    this.#addMessages(s.id, list, { initial: first });
  }

  /** Twitch: IRC por WebSocket em modo anônimo (só leitura, sem token). */
  #twitch(s, r) {
    const chan = s.config.channel.toLowerCase().replace(/^#/, '').trim();
    if (!/^[a-z0-9_]{2,25}$/.test(chan)) { this.status.set(s.id, { ok: false, error: 'Informe o nome do canal da Twitch.', updatedAt: null }); return; }
    const connect = () => {
      if (r.stopped) return;
      const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
      r.ws = ws;
      ws.on('open', () => {
        ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
        ws.send('PASS SCHMOOPIIE');
        ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
        ws.send(`JOIN #${chan}`);
        this.status.set(s.id, { ok: true, error: null, updatedAt: nowMs() });
        this.emit('status', s.id);
      });
      // linha malformada não pode derrubar o servidor (exceção num evento do WebSocket seria não tratada)
      ws.on('message', (raw) => { try { onLines(raw); } catch (e) { console.warn(`[cg] Twitch: linha ignorada (${e.message})`); } });
      const onLines = (raw) => {
        for (const line of raw.toString().split('\r\n')) {
          if (!line) continue;
          if (line.startsWith('PING')) { ws.send(line.replace('PING', 'PONG')); continue; }
          const m = line.match(/^(?:@(\S+) )?:(\w+)!\S+ PRIVMSG #\S+ :(.*)$/);
          if (!m) continue;
          const tags = Object.fromEntries((m[1] || '').split(';').map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
          this.#addMessages(s.id, [{
            id: `tw:${tags.id || `${nowMs()}${Math.random()}`}`, plataforma: 'twitch', autor: clean(tags['display-name'] || m[2], 60), avatar: '',
            texto: clean(m[3].replace(/^\u0001ACTION (.*)\u0001$/, '$1'), 500), valor: tags.bits ? `${tags.bits} bits` : '', at: Number(tags['tmi-sent-ts']) || nowMs(),
          }]);
        }
        const st = this.status.get(s.id); if (st) st.updatedAt = nowMs();
      };
      ws.on('close', () => { if (!r.stopped) r.timer = setTimeout(connect, 5000); });
      ws.on('error', (e) => { this.status.set(s.id, { ok: false, error: `Twitch: ${e.message}`, updatedAt: null }); });
    };
    connect();
  }
}

/** Aprovadas e já exibidas do mural, mais novas primeiro (até 30): o que o rodízio do ar percorre. */
function muralApproved(messages) {
  // Vídeo e áudio ficam exclusivamente na fila manual: nunca vão para o
  // rodízio do GC, mesmo se alguém os aprovar.
  return messages.filter((m) => !m.media && (m.status === 'approved' || m.status === 'aired') && (m.texto || m.imagem)).slice(-30).reverse()
    .map((m) => ({ id: m.id, autor: m.autor, texto: m.texto, imagem: m.imagem, at: m.at }));
}
