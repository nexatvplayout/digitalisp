// DIGITAL ISP · o estilo do texto rolante (a faixa de avisos): o da faixa inteira e o de cada aviso.
// Usado pelo servidor (validação e o JSON da tela), pelo painel (o editor e a prévia rolando) e pelos apps das TVs.
//
// Faixa (config.tickerStyle, por empresa, unidade ou tela; a velocidade continua em config.tickerSpeed):
//   { color, bg: '#RRGGBB', bold, italic: bool, size: 30-90 (% da altura da faixa), font: 'sans'|'serif'|'condensada'|'mono',
//     sep: 'ponto'|'barra'|'traco'|'estrela'|'nada', label: 'AVISOS' (até 20 letras; vazio = sem etiqueta), labelColor, labelBg }
// Aviso: a marca de estilo no começo do texto guardado, depois da marca da classificação ("[institucional] "):
//   "{c=#ff3b30;b;i} Texto" (cor, negrito, itálico; cada parte é opcional). O app antigo recebe só o texto, sem a marca.

export const TICKER_FONTS = Object.freeze([
  { key: 'sans', label: 'Padrão (sem serifa)', css: 'system-ui, "Segoe UI", Roboto, Arial, sans-serif' },
  { key: 'serif', label: 'Com serifa', css: 'Georgia, "Times New Roman", serif' },
  { key: 'condensada', label: 'Condensada', css: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif' },
  { key: 'mono', label: 'Máquina de escrever', css: '"Courier New", Consolas, monospace' },
]);
export const TICKER_SEPS = Object.freeze([
  { key: 'ponto', label: '•', text: '•' },
  { key: 'barra', label: '|', text: '|' },
  { key: 'traco', label: '—', text: '—' },
  { key: 'estrela', label: '★', text: '★' },
  { key: 'nada', label: 'Nenhum (só espaço)', text: '' },
]);
export const TICKER_STYLE_DEFAULT = Object.freeze({ color: '#ffffff', bg: '#0b1e3a', bold: true, italic: false, size: 52, font: 'sans', sep: 'ponto', label: '', labelColor: '#ffffff', labelBg: '#1d4ed8' });
export const TICKER_SIZE = Object.freeze({ min: 30, max: 90 });

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v, d) => (HEX.test(String(v || '')) ? String(v).toLowerCase() : d);
const FONT_KEYS = new Set(TICKER_FONTS.map((f) => f.key));
const SEP_KEYS = new Set(TICKER_SEPS.map((s) => s.key));

/** O estilo da faixa limpo (o que faltar ou vier errado fica no padrão). null/undefined → null (sem estilo próprio). */
export function cleanTickerStyle(v) {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return null;
  const D = TICKER_STYLE_DEFAULT;
  const size = Math.round(Number(v.size));
  return {
    color: hex(v.color, D.color), bg: hex(v.bg, D.bg),
    bold: v.bold === undefined ? D.bold : Boolean(v.bold), italic: Boolean(v.italic),
    size: Number.isFinite(size) ? Math.min(TICKER_SIZE.max, Math.max(TICKER_SIZE.min, size)) : D.size,
    font: FONT_KEYS.has(v.font) ? v.font : D.font,
    sep: SEP_KEYS.has(v.sep) ? v.sep : D.sep,
    label: String(v.label ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 20),
    labelColor: hex(v.labelColor, D.labelColor), labelBg: hex(v.labelBg, D.labelBg),
  };
}

const MARK = /^\{([^{}]{0,40})\}\s?/;
/** Separa a marca de estilo do aviso: { text, color?, bold?, italic? }. */
export function parseAvisoStyle(s) {
  const str = String(s ?? '');
  const m = MARK.exec(str);
  if (!m) return { text: str };
  const out = { text: str.slice(m[0].length) };
  for (const part of m[1].split(';').map((x) => x.trim().toLowerCase())) {
    if (part === 'b') out.bold = true;
    else if (part === 'i') out.italic = true;
    else if (part.startsWith('c=') && HEX.test(part.slice(2))) out.color = part.slice(2);
  }
  return out;
}
/** Põe a marca de estilo no texto (sem estilo: o texto como está). */
export function markAvisoStyle({ text, color, bold, italic }) {
  const parts = [color && HEX.test(color) ? `c=${color.toLowerCase()}` : '', bold ? 'b' : '', italic ? 'i' : ''].filter(Boolean);
  return parts.length ? `{${parts.join(';')}} ${String(text ?? '')}` : String(text ?? '');
}
/** O texto sem a marca de estilo (o que o app antigo mostra). */
export const plainAviso = (s) => parseAvisoStyle(s).text;
export const sepText = (key) => (TICKER_SEPS.find((s) => s.key === key) || TICKER_SEPS[0]).text;
export const fontCss = (key) => (TICKER_FONTS.find((f) => f.key === key) || TICKER_FONTS[0]).css;
