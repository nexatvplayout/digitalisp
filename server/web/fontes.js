// Fontes da internet usadas pelas telas: leitura de RSS/Atom e busca de cidade (Open-Meteo, sem chave).
// Tirado do gerador de caracteres do NEXA Broadcast (server/cg/sources.js, c51d2469), só a parte que as telas usam.
import { getJson } from './net.js';


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
