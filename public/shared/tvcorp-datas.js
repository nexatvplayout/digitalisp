// TV Corporativa: datas comemorativas (docs/TV-CORPORATIVA.md §2.2 e §7.3). Lista fixa no código, sem consulta externa:
// os feriados nacionais, as datas do calendário corporativo e as campanhas do mês. O cliente escolhe quais aparecem
// (tvcorp_settings.data.dates = lista de chaves; vazio = as de fábrica, marcadas `on`). Usado no servidor
// (server/tvcorp-dados.js) e no painel (prévia). Funções puras: datas em { year, month, day } ou 'AAAA-MM-DD', sem fuso.
//
// kind: 'feriado' (feriado nacional), 'facultativo' (ponto facultativo), 'corporativa' (data do calendário da empresa),
// 'campanha' (o mês inteiro: Outubro Rosa etc.). Datas móveis pela Páscoa (Carnaval, Sexta-feira Santa, Corpus Christi)
// e pelo n-ésimo domingo do mês (Dia das Mães, Dia dos Pais).

export const DATE_KINDS = Object.freeze({ feriado: 'Feriado nacional', facultativo: 'Ponto facultativo', corporativa: 'Data comemorativa', campanha: 'Campanha do mês' });

/** O catálogo. fixed: [mês, dia]; easter: dias a partir da Páscoa; nthSunday: [mês, n]; month: o mês inteiro. */
export const DATES = Object.freeze([
  { key: 'ano-novo', name: 'Confraternização Universal', kind: 'feriado', fixed: [1, 1], on: true },
  { key: 'carnaval', name: 'Carnaval', kind: 'facultativo', easter: -47, on: true },
  { key: 'mulher', name: 'Dia Internacional da Mulher', kind: 'corporativa', fixed: [3, 8], on: true },
  { key: 'consumidor', name: 'Dia do Consumidor', kind: 'corporativa', fixed: [3, 15], on: false },
  { key: 'agua', name: 'Dia Mundial da Água', kind: 'corporativa', fixed: [3, 22], on: false },
  { key: 'sexta-santa', name: 'Sexta-feira Santa', kind: 'feriado', easter: -2, on: true },
  { key: 'pascoa', name: 'Páscoa', kind: 'corporativa', easter: 0, on: true },
  { key: 'saude', name: 'Dia Mundial da Saúde', kind: 'corporativa', fixed: [4, 7], on: false },
  { key: 'tiradentes', name: 'Tiradentes', kind: 'feriado', fixed: [4, 21], on: true },
  { key: 'seguranca-trabalho', name: 'Dia Mundial da Segurança e Saúde no Trabalho', kind: 'corporativa', fixed: [4, 28], on: true },
  { key: 'trabalho', name: 'Dia do Trabalhador', kind: 'feriado', fixed: [5, 1], on: true },
  { key: 'maes', name: 'Dia das Mães', kind: 'corporativa', nthSunday: [5, 2], on: true },
  { key: 'meio-ambiente', name: 'Dia Mundial do Meio Ambiente', kind: 'corporativa', fixed: [6, 5], on: true },
  { key: 'corpus-christi', name: 'Corpus Christi', kind: 'facultativo', easter: 60, on: true },
  { key: 'prevencao-acidentes', name: 'Dia Nacional de Prevenção de Acidentes do Trabalho', kind: 'corporativa', fixed: [7, 27], on: true },
  { key: 'pais', name: 'Dia dos Pais', kind: 'corporativa', nthSunday: [8, 2], on: true },
  { key: 'independencia', name: 'Independência do Brasil', kind: 'feriado', fixed: [9, 7], on: true },
  { key: 'cliente', name: 'Dia do Cliente', kind: 'corporativa', fixed: [9, 15], on: false },
  { key: 'secretariado', name: 'Dia do Profissional de Secretariado', kind: 'corporativa', fixed: [9, 30], on: false },
  { key: 'aparecida', name: 'Nossa Senhora Aparecida', kind: 'feriado', fixed: [10, 12], on: true },
  { key: 'criancas', name: 'Dia das Crianças', kind: 'corporativa', fixed: [10, 12], on: true },
  { key: 'professor', name: 'Dia do Professor', kind: 'corporativa', fixed: [10, 15], on: false },
  { key: 'servidor', name: 'Dia do Servidor Público', kind: 'facultativo', fixed: [10, 28], on: false },
  { key: 'finados', name: 'Finados', kind: 'feriado', fixed: [11, 2], on: true },
  { key: 'republica', name: 'Proclamação da República', kind: 'feriado', fixed: [11, 15], on: true },
  { key: 'consciencia-negra', name: 'Dia Nacional de Zumbi e da Consciência Negra', kind: 'feriado', fixed: [11, 20], on: true },
  { key: 'natal', name: 'Natal', kind: 'feriado', fixed: [12, 25], on: true },
  { key: 'janeiro-branco', name: 'Janeiro Branco (saúde mental)', kind: 'campanha', month: 1, on: false },
  { key: 'abril-verde', name: 'Abril Verde (segurança no trabalho)', kind: 'campanha', month: 4, on: true },
  { key: 'maio-amarelo', name: 'Maio Amarelo (segurança no trânsito)', kind: 'campanha', month: 5, on: false },
  { key: 'setembro-amarelo', name: 'Setembro Amarelo (valorização da vida)', kind: 'campanha', month: 9, on: true },
  { key: 'outubro-rosa', name: 'Outubro Rosa (câncer de mama)', kind: 'campanha', month: 10, on: true },
  { key: 'novembro-azul', name: 'Novembro Azul (saúde do homem)', kind: 'campanha', month: 11, on: true },
]);
export const DATE_KEYS = Object.freeze(DATES.map((d) => d.key));
export const DEFAULT_DATE_KEYS = Object.freeze(DATES.filter((d) => d.on).map((d) => d.key));

const pad = (n) => String(n).padStart(2, '0');
export const ymd = ({ year, month, day }) => `${year}-${pad(month)}-${pad(day)}`;
export function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() + 1 !== Number(m[2]) || d.getUTCDate() !== Number(m[3])) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}
const fromUtc = (d) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
export const addDays = ({ year, month, day }, n) => fromUtc(new Date(Date.UTC(year, month - 1, day + n)));

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function easter(year) {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100; const d = Math.floor(b / 4); const e = b % 4;
  const f = Math.floor((b + 8) / 25); const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}
function nthSunday(year, month, n) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return { year, month, day: 1 + ((7 - first) % 7) + 7 * (n - 1) };
}

/** As datas de um ano: [{ key, name, kind, date: 'AAAA-MM-DD', until?: 'AAAA-MM-DD' (campanha: o último dia do mês) }]. */
export function datesOfYear(year, keys = null) {
  const want = keys ? new Set(keys) : null;
  const out = [];
  for (const d of DATES) {
    if (want && !want.has(d.key)) continue;
    let at; let until = null;
    if (d.fixed) at = { year, month: d.fixed[0], day: d.fixed[1] };
    else if (d.easter != null) at = addDays(easter(year), d.easter);
    else if (d.nthSunday) at = nthSunday(year, d.nthSunday[0], d.nthSunday[1]);
    else if (d.month) { at = { year, month: d.month, day: 1 }; until = fromUtc(new Date(Date.UTC(year, d.month, 0))); } // dia 0 do mês seguinte = o último deste
    out.push({ key: d.key, name: d.name, kind: d.kind, date: ymd(at), ...(until ? { until: ymd(until) } : {}) });
  }
  return out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

/** As escolhidas que valem no dia (campanha: o mês inteiro). day = 'AAAA-MM-DD'. */
export function datesOn(day, keys = DEFAULT_DATE_KEYS) {
  const p = parseYmd(day);
  if (!p) return [];
  return datesOfYear(p.year, keys).filter((d) => (d.until ? d.date <= day && day <= d.until : d.date === day));
}

/** As próximas datas (sem campanhas) de day até day + days (inclusive), na ordem. */
export function upcomingDates(day, days = 30, keys = DEFAULT_DATE_KEYS) {
  const p = parseYmd(day);
  if (!p) return [];
  const end = ymd(addDays(p, Math.max(0, Math.min(366, days))));
  const all = [...datesOfYear(p.year, keys), ...datesOfYear(p.year + 1, keys)];
  return all.filter((d) => !d.until && d.date >= day && d.date <= end);
}

/** Lista de chaves limpa (só as do catálogo, sem repetir). null/indefinido = as de fábrica. */
export function cleanDateKeys(v) {
  if (v == null) return [...DEFAULT_DATE_KEYS];
  if (!Array.isArray(v)) return [...DEFAULT_DATE_KEYS];
  return [...new Set(v.map(String).filter((k) => DATE_KEYS.includes(k)))];
}
