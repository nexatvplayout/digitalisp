/* TV Corporativa, pacote B: as fontes de dados de fora (docs/TV-CORPORATIVA.md §2.3, §5.4 e §7.3).
   Só as fontes permitidas: notícias de agências públicas com crédito (Agência Brasil, Agência Senado, Agência Câmara, gov.br)
   e o RSS da própria empresa (https); cotações pela AwesomeAPI e pela PTAX do Banco Central; o clima pelo server/weather.js
   (o provedor do Superadmin, injetado como weatherOf); o trânsito só no Rio (server/transito-rio.js, injetado como
   trafficOf), nas outras cidades avisos escritos. Indicadores lidos de planilha publicada como CSV ou de JSON (https).

   A busca é sempre no servidor, em segundo plano, pelo safeFetch de server/web/net.js (só https aqui, prazo, teto de 2 MB,
   nada de rede interna). O app nunca busca fora. O texto sai limpo de HTML e de caracteres de controle; o painel, a página
   do celular e o app escrevem como texto.

   Nada aqui guarda: fetchFeed(feed) -> o cache (os itens prontos) ou lança; fetchKpiValue(kpi) -> o número ou lança.
   server/tvcorp-dados.js guarda, segura e serve. */
import { safeFetch } from './web/net.js';
import { fail, line, cleanHttpsUrl } from './tvcorp-rh.js';

export const FEED_KINDS = Object.freeze({ rss: 'Notícias (RSS)', quotes: 'Cotações', weather: 'Clima', traffic: 'Trânsito' });
export const FEED_LIMITS = Object.freeze({ feeds: 50, name: 60, refreshMin: 15, refreshMax: 1440, items: 15, title: 160, staleMs: 6 * 3600_000, maxBytes: 2 * 1024 * 1024, timeoutMs: 10_000, trafficLines: 10, trafficLine: 120 });

/**
 * As agências públicas com uso livre e crédito obrigatório (§7.3). Nada de portal comercial (pede contrato de licença).
 * Os endereços são conferidos pelo "Testar" do painel; se um mudar, troca-se aqui.
 */
export const NEWS_CATALOG = Object.freeze([
  { key: 'agencia-brasil', name: 'Agência Brasil', credit: 'Agência Brasil (EBC) · licença CC BY', url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml' },
  { key: 'agencia-senado', name: 'Agência Senado', credit: 'Agência Senado', url: 'https://www12.senado.leg.br/noticias/feed/todasnoticias/RSS' },
  { key: 'agencia-camara', name: 'Agência Câmara', credit: 'Agência Câmara de Notícias', url: 'https://www.camara.leg.br/noticias/rss/ultimas-noticias' },
  { key: 'gov-br', name: 'gov.br', credit: 'gov.br · Governo Federal', url: 'https://www.gov.br/pt-br/noticias/RSS' },
]);
const NEWS = new Map(NEWS_CATALOG.map((n) => [n.key, n]));

/** Moedas aceitas (AwesomeAPI: pares contra o real; PTAX: as moedas do boletim do Banco Central). */
export const CURRENCIES = Object.freeze({ USD: 'Dólar americano', EUR: 'Euro', GBP: 'Libra esterlina', ARS: 'Peso argentino', JPY: 'Iene', CNY: 'Yuan', CHF: 'Franco suíço', CAD: 'Dólar canadense', AUD: 'Dólar australiano', BTC: 'Bitcoin' });
export const PTAX_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD']);
export const QUOTE_PROVIDERS = Object.freeze({ awesome: 'AwesomeAPI', ptax: 'Banco Central do Brasil (PTAX)' });

/* ------------------------------------------------------------------ a configuração de cada fonte */
const intIn = (v, min, max, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
/**
 * A fonte digitada no painel -> { name, config, refresh_min, enabled }. partial = PATCH (kind não muda).
 *   rss      { source: 'agencia-brasil' | … | 'own', url (só 'own', https) }
 *   quotes   { provider: 'awesome' | 'ptax', currencies: ['USD', 'EUR'] }
 *   weather  { ibge, city, uf, offices: [ids] (vazio = todas as unidades) }
 *   traffic  { mode: 'rio' | 'texto', lines: ['…'] (texto) }
 */
export function cleanFeed(kind, b, { partial = false, cur = null } = {}) {
  if (!Object.hasOwn(FEED_KINDS, kind)) throw fail(400, 'Tipo de fonte inválido.');
  const has = (k) => b && Object.prototype.hasOwnProperty.call(b, k);
  const out = {};
  if (!partial || has('name')) {
    const name = line(b?.name, FEED_LIMITS.name) || (kind === 'rss' && NEWS.get(b?.config?.source)?.name) || FEED_KINDS[kind];
    out.name = name;
  }
  if (!partial || has('refreshMin')) out.refresh_min = intIn(b?.refreshMin, FEED_LIMITS.refreshMin, FEED_LIMITS.refreshMax, kind === 'weather' ? 30 : kind === 'quotes' ? 30 : 60);
  if (!partial || has('enabled')) out.enabled = b?.enabled === false ? 0 : 1;
  if (!partial || has('config')) {
    const c = b?.config && typeof b.config === 'object' ? b.config : {};
    if (kind === 'rss') {
      const source = c.source ?? 'own';
      if (source === 'own') out.config = { source, url: cleanHttpsUrl(c.url, 'Endereço do RSS') || (() => { throw fail(400, 'Endereço do RSS: informe o endereço https:// do feed da empresa.'); })(), credit: line(c.credit, 60) };
      else if (NEWS.has(source)) out.config = { source };
      else throw fail(400, 'Fonte de notícias fora da lista permitida.');
    } else if (kind === 'quotes') {
      const provider = c.provider ?? 'awesome';
      if (!Object.hasOwn(QUOTE_PROVIDERS, provider)) throw fail(400, 'Fonte de cotações inválida.');
      const allowed = provider === 'ptax' ? PTAX_CURRENCIES : Object.keys(CURRENCIES);
      const list = Array.isArray(c.currencies) ? [...new Set(c.currencies.map((x) => String(x).toUpperCase()))] : ['USD', 'EUR'];
      if (!list.length || list.length > 8 || list.some((x) => !allowed.includes(x))) throw fail(400, `Moedas: escolha de 1 a 8 entre ${allowed.join(', ')}.`);
      out.config = { provider, currencies: list };
    } else if (kind === 'weather') {
      const ibge = Number(c.ibge);
      if (!Number.isInteger(ibge) || ibge < 1000000 || ibge > 9999999) throw fail(400, 'Clima: escolha o estado e o município.');
      const offices = Array.isArray(c.offices) ? [...new Set(c.offices.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500) : [];
      out.config = { ibge, city: line(c.city, 80), uf: line(c.uf, 2).toUpperCase(), offices };
    } else {
      const mode = c.mode === 'rio' ? 'rio' : 'texto';
      const lines = mode === 'texto' ? (Array.isArray(c.lines) ? c.lines : String(c.lines ?? '').split('\n')).map((x) => line(x, FEED_LIMITS.trafficLine)).filter(Boolean).slice(0, FEED_LIMITS.trafficLines) : [];
      if (mode === 'texto' && !lines.length) throw fail(400, 'Trânsito: escreva ao menos um aviso (fora do Rio de Janeiro não há fonte automática).');
      out.config = { mode, lines };
    }
  } else if (cur) out.config = cur;
  return out;
}
/** O crédito que vai à tela ("Fonte: …"). */
export function feedCredit(kind, config) {
  if (kind === 'rss') return config.source === 'own' ? (config.credit || 'Comunicação da empresa') : NEWS.get(config.source)?.credit || 'Notícias';
  if (kind === 'quotes') return QUOTE_PROVIDERS[config.provider] || 'Cotações';
  return '';
}

/* ------------------------------------------------------------------ as buscas */
const DEFAULT_UA = 'NEXA-Telas/1.0 (+TV corporativa)';
/** GET https pelo safeFetch (sem rede interna, prazo e teto). Devolve o texto; HTTP de erro lança. */
async function getText(url, { fetcher = safeFetch, accept = '*/*' } = {}) {
  if (!/^https:\/\//i.test(String(url))) throw fail(400, 'Só endereços https://.');
  const r = await fetcher(url, { timeout: FEED_LIMITS.timeoutMs, maxBytes: FEED_LIMITS.maxBytes, signal: AbortSignal.timeout(FEED_LIMITS.timeoutMs + 5000), headers: { accept, 'user-agent': DEFAULT_UA } });
  if (r.status >= 400) throw fail(502, `A fonte respondeu com erro (HTTP ${r.status}).`);
  return r.text();
}
let parseFeedImpl = null;
/** O leitor de RSS/Atom do gerador de caracteres (server/web/fontes.js), carregado só quando precisa. */
async function loadParseFeed() {
  if (!parseFeedImpl) parseFeedImpl = (await import('./web/fontes.js')).parseFeed;
  return parseFeedImpl;
}
const pad = (n) => String(n).padStart(2, '0');
const bcbDate = (ms) => { const d = new Date(ms - 3 * 3600_000); return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${d.getUTCFullYear()}`; }; // MM-DD-AAAA, hora de Brasília
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/**
 * Busca uma fonte e devolve o que fica guardado em tvcorp_feeds.cache. deps (os testes trocam tudo):
 *   fetcher(url, opts) (o safeFetch), parseFeed(xml, max), weatherOf(ibge) (server/weather.js), trafficOf(ibge) (Rio), now().
 */
export async function fetchFeed(feed, deps = {}) {
  const { fetcher = safeFetch, weatherOf = null, trafficOf = null, now = () => Date.now() } = deps;
  const config = typeof feed.config === 'string' ? JSON.parse(feed.config || '{}') : feed.config || {};
  const t = now();
  if (feed.kind === 'rss') {
    const url = config.source === 'own' ? config.url : NEWS.get(config.source)?.url;
    if (!url) throw fail(400, 'Fonte de notícias fora da lista permitida.');
    const parse = deps.parseFeed || (await loadParseFeed());
    const feedData = parse(await getText(url, { fetcher, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' }), FEED_LIMITS.items);
    const items = (feedData.items || []).map((i) => ({
      title: line(i.title, FEED_LIMITS.title), at: Number.isFinite(i.date) ? i.date : null,
      link: /^https:\/\//i.test(String(i.link || '')) ? String(i.link).slice(0, 500) : null,
      // a foto da manchete (o servidor baixa uma cópia: server/noticias-img.js)
      ...(/^https?:\/\//i.test(String(i.image || '')) ? { image: String(i.image).slice(0, 500) } : {}),
    })).filter((i) => i.title.length >= 3).slice(0, FEED_LIMITS.items);
    if (!items.length) throw fail(502, 'Nenhuma notícia encontrada: o endereço é mesmo um feed RSS ou Atom?');
    return { source: feedCredit('rss', config), at: t, items };
  }
  if (feed.kind === 'quotes') {
    const list = config.currencies || ['USD'];
    if (config.provider === 'ptax') {
      const items = [];
      for (const code of list) {
        const q = `@moeda='${code}'&@dataInicial='${bcbDate(t - 7 * 86400_000)}'&@dataFinalCotacao='${bcbDate(t)}'&$format=json&$top=100`;
        const j = JSON.parse(await getText(`https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?${q}`, { fetcher, accept: 'application/json' }));
        const rows = Array.isArray(j?.value) ? j.value : [];
        const last = rows.filter((r) => num(r.cotacaoVenda) != null).sort((a, b) => String(a.dataHoraCotacao).localeCompare(String(b.dataHoraCotacao))).pop();
        if (!last) continue;
        const at = Date.parse(String(last.dataHoraCotacao).replace(' ', 'T') + '-03:00');
        items.push({ code, name: CURRENCIES[code], buy: num(last.cotacaoCompra), sell: num(last.cotacaoVenda), change: null, at: Number.isFinite(at) ? at : null, bulletin: line(last.tipoBoletim, 30) });
      }
      if (!items.length) throw fail(502, 'O Banco Central não devolveu cotação para as moedas escolhidas.');
      return { source: QUOTE_PROVIDERS.ptax, note: 'Valores de referência', at: t, items };
    }
    const pairs = list.map((c) => `${c}-BRL`);
    const j = JSON.parse(await getText(`https://economia.awesomeapi.com.br/json/last/${pairs.join(',')}`, { fetcher, accept: 'application/json' }));
    const items = list.map((code) => {
      const x = j?.[`${code}BRL`];
      if (!x || num(x.bid) == null) return null;
      return { code, name: CURRENCIES[code], buy: num(x.bid), sell: num(x.ask), change: num(x.pctChange), at: num(x.timestamp) ? num(x.timestamp) * 1000 : null };
    }).filter(Boolean);
    if (!items.length) throw fail(502, 'A fonte não devolveu nenhuma das moedas escolhidas.');
    return { source: QUOTE_PROVIDERS.awesome, note: 'Valores de referência', at: t, items };
  }
  if (feed.kind === 'weather') {
    if (!weatherOf) throw fail(503, 'O clima está sem fonte no servidor (Superadmin → Integrações → Clima).');
    const f = await weatherOf(config.ibge);
    const today = f?.today || {};
    const temp = num(f?.now?.temp) ?? num(today.max) ?? num(today.min);
    if (temp == null) throw fail(502, 'Sem previsão para este município agora.');
    return {
      source: line(f.source, 40), at: t, city: line(f.place?.city || config.city, 80), uf: line(f.place?.uf || config.uf, 2),
      tempC: Math.round(temp), min: num(today.min) == null ? null : Math.round(num(today.min)), max: num(today.max) == null ? null : Math.round(num(today.max)),
      text: line(f.now?.text || today.text, 60), cond: line(f.now?.cond || today.cond, 20) || 'unknown', hasNow: Boolean(f.now),
      days: (Array.isArray(f.days) ? f.days : []).slice(0, 5).map((d) => ({ date: line(d.date, 10), min: num(d.min), max: num(d.max), text: line(d.text, 60), cond: line(d.cond, 20) || 'unknown' })),
    };
  }
  if (feed.kind === 'traffic') {
    if (config.mode === 'rio') {
      if (!trafficOf) throw fail(503, 'O trânsito automático só existe no Rio de Janeiro.');
      const r = await trafficOf('3304557');
      if (!r || !r.ok) throw fail(502, 'O Centro de Operações Rio não respondeu agora.');
      return { source: line(r.source?.name, 80), at: t, items: (r.items || []).slice(0, FEED_LIMITS.items).map((i) => ({ title: line(`${i.road ? `${i.road}: ` : ''}${i.status || ''}`, FEED_LIMITS.title), at: num(i.at) })).filter((i) => i.title) };
    }
    return { source: '', at: t, items: (config.lines || []).map((title) => ({ title, at: null })) };
  }
  throw fail(400, 'Tipo de fonte inválido.');
}

/* ------------------------------------------------------------------ indicadores */
export const KPI_LIMITS = Object.freeze({ kpis: 200, name: 60, unit: 12, refreshMin: 15, refreshMax: 1440, points: 400, bands: 4, keepDays: 400 });
export const KPI_SOURCES = Object.freeze({ manual: 'Digitado no painel', csv: 'Planilha publicada (CSV)', json: 'Endereço JSON', api: 'Sistema da empresa (API)' });
export const KPI_BANDS = Object.freeze(['ok', 'warn', 'bad']);

/** Número escrito do jeito do Brasil ("1.234,5", "82%", "R$ 10,00") ou do jeito do sistema ("1234.5"). null se não for. */
export function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').replace(/[R$%\s ]/g, '').trim();
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
/** "B2" -> { row: 1, col: 1 } (zero-based). */
export function parseCell(v) {
  const m = /^([A-Z]{1,3})(\d{1,6})$/i.exec(String(v ?? '').trim());
  if (!m) return null;
  const col = m[1].toUpperCase().split('').reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0) - 1;
  return { row: Number(m[2]) - 1, col };
}
/** O caminho no JSON ("dados.vendas.0.total"). */
export function atPath(obj, path) {
  let v = obj;
  for (const seg of String(path || '').split('.').filter(Boolean)) {
    if (v == null) return undefined;
    v = Array.isArray(v) && /^\d+$/.test(seg) ? v[Number(seg)] : Object.hasOwn(Object(v), seg) ? v[seg] : undefined;
  }
  return v;
}
/**
 * Faixas de cor: [{ from: % da meta, band: 'ok'|'warn'|'bad' }] em ordem crescente de from. Vazio = as de fábrica:
 * para cima (quanto mais, melhor): abaixo de 80% vermelho, de 80% a 99% amarelo, 100% ou mais verde. Para baixo (quanto
 * menos, melhor: acidentes, perdas): até 100% verde, até 120% amarelo, acima vermelho.
 */
export function cleanBands(v) {
  if (v == null || (Array.isArray(v) && !v.length)) return [];
  if (!Array.isArray(v) || v.length > KPI_LIMITS.bands) throw fail(400, `Faixas de cor: no máximo ${KPI_LIMITS.bands}.`);
  const out = v.map((b) => {
    const from = Number(b?.from);
    if (!Number.isFinite(from) || from < 0 || from > 1000 || !KPI_BANDS.includes(b?.band)) throw fail(400, 'Faixa de cor: "a partir de" (0 a 1000% da meta) e a cor (ok, warn ou bad).');
    return { from: Math.round(from * 10) / 10, band: b.band };
  }).sort((a, b) => a.from - b.from);
  return out;
}
export function kpiBand({ value, target, direction = 'up', bands = [] }) {
  const v = num(value); const tg = num(target);
  if (v == null || tg == null || tg === 0) return null;
  const pct = (v / tg) * 100;
  const list = bands.length ? bands : direction === 'down'
    ? [{ from: 0, band: 'ok' }, { from: 100.0001, band: 'warn' }, { from: 120.0001, band: 'bad' }]
    : [{ from: 0, band: 'bad' }, { from: 80, band: 'warn' }, { from: 100, band: 'ok' }];
  let out = list[0].band;
  for (const b of list) if (pct >= b.from) out = b.band;
  return out;
}
/**
 * O indicador digitado -> as colunas. partial = PATCH. source_cfg: csv { url, cell: 'B2' } | json { url, path }.
 * Nunca dado individual de funcionário (o painel avisa; ranking só por equipe, unidade ou turno).
 */
export function cleanKpi(b, { partial = false } = {}) {
  const has = (k) => b && Object.prototype.hasOwnProperty.call(b, k);
  const out = {};
  if (!partial || has('name')) {
    const n = line(b?.name, KPI_LIMITS.name);
    if (n.length < 2) throw fail(400, `Nome do indicador: 2 a ${KPI_LIMITS.name} caracteres.`);
    out.name = n;
  }
  if (!partial || has('unit')) out.unit = line(b?.unit, KPI_LIMITS.unit);
  if (!partial || has('target')) { const tg = b?.target == null || b.target === '' ? null : parseNumber(b.target); if (b?.target != null && b.target !== '' && tg == null) throw fail(400, 'Meta: um número.'); out.target = tg; }
  if (!partial || has('direction')) { const d = b?.direction ?? 'up'; if (!['up', 'down'].includes(d)) throw fail(400, 'Direção: up (quanto mais, melhor) ou down (quanto menos, melhor).'); out.direction = d; }
  if (!partial || has('bands')) out.bands = JSON.stringify(cleanBands(b?.bands));
  if (!partial || has('officeId')) { const o = b?.officeId; out.office_id = o == null || o === '' ? null : (Number.isInteger(Number(o)) && Number(o) > 0 ? Number(o) : (() => { throw fail(400, 'Unidade inválida.'); })()); }
  if (!partial || has('refreshMin')) out.refresh_min = intIn(b?.refreshMin, KPI_LIMITS.refreshMin, KPI_LIMITS.refreshMax, 60);
  if (!partial || has('source') || has('sourceCfg')) {
    const source = b?.source ?? 'manual';
    if (!Object.hasOwn(KPI_SOURCES, source)) throw fail(400, 'Fonte do indicador inválida.');
    out.source = source;
    const c = b?.sourceCfg && typeof b.sourceCfg === 'object' ? b.sourceCfg : {};
    if (source === 'csv') {
      const cell = parseCell(c.cell);
      if (!cell) throw fail(400, 'Planilha: diga a célula, por exemplo B2.');
      out.source_cfg = JSON.stringify({ url: cleanHttpsUrl(c.url, 'Endereço da planilha') || (() => { throw fail(400, 'Planilha: informe o endereço https:// do CSV publicado.'); })(), cell: String(c.cell).toUpperCase() });
    } else if (source === 'json') {
      const path = line(c.path, 120);
      if (!/^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/.test(path)) throw fail(400, 'JSON: diga o caminho do número, por exemplo dados.total.');
      out.source_cfg = JSON.stringify({ url: cleanHttpsUrl(c.url, 'Endereço do JSON') || (() => { throw fail(400, 'JSON: informe o endereço https://.'); })(), path });
    } else out.source_cfg = '{}';
  }
  if (has('value')) { const v = b.value == null || b.value === '' ? null : parseNumber(b.value); if (b.value != null && b.value !== '' && v == null) throw fail(400, 'Valor: um número.'); out.value = v; }
  return out;
}
/** Lê o número de um indicador de planilha (CSV) ou JSON. deps.fetcher = o safeFetch (os testes trocam). */
export async function fetchKpiValue(kpi, deps = {}) {
  const { fetcher = safeFetch, parseCsv } = deps;
  const cfg = typeof kpi.source_cfg === 'string' ? JSON.parse(kpi.source_cfg || '{}') : kpi.source_cfg || {};
  if (kpi.source === 'csv') {
    const body = await getText(cfg.url, { fetcher, accept: 'text/csv, text/plain' });
    const cell = parseCell(cfg.cell);
    const rows = parseCsv(body, { maxRows: (cell?.row ?? 0) + 2 });
    const v = parseNumber(rows[cell.row]?.[cell.col]);
    if (v == null) throw fail(502, `A célula ${cfg.cell} da planilha não tem um número.`);
    return v;
  }
  if (kpi.source === 'json') {
    let j;
    try { j = JSON.parse(await getText(cfg.url, { fetcher, accept: 'application/json' })); } catch (e) { if (e.status) throw e; throw fail(502, 'A resposta não é JSON.'); }
    const v = parseNumber(atPath(j, cfg.path));
    if (v == null) throw fail(502, `O caminho "${cfg.path}" não tem um número.`);
    return v;
  }
  throw fail(400, 'Este indicador não é lido de fora.');
}
