// Fuso horário do canal (docs/AGENDA.md). O contêiner roda em UTC: nada no servidor pode usar os métodos "locais" do Date
// (getHours, getDay, setHours…) para falar da hora do canal. Tudo aqui passa pelo Intl (o ICU embutido no Node), que não
// depende do tzdata do sistema e conhece o horário de verão de cada fuso, inclusive o histórico.
//   - tzOffsetSec / clockBase: diferença do fuso para o UTC e a base do relógio do cartão do plantão (o motor desenha a hora
//     do canal com %{pts:gmtime}); vieram de server/plantao-card.js, que agora importa daqui.
//   - localParts: o instante em data/hora local do canal (dia da semana, segundos desde a meia-noite).
//   - localToUtc: o contrário, "seg 08:00 no fuso do canal" → instante UTC. Horário de verão: hora que não existe (o relógio
//     pula de 00:00 para 01:00) empurra para frente, como o Temporal 'compatible' (00:30 vira 01:30); hora que se repete
//     (o relógio volta de 00:00 para 23:00) usa a primeira vez.
// Funções puras (sem banco nem relógio); formatadores do Intl guardados por fuso (criar um custa caro e o EPG pergunta muito).

/** Fuso padrão dos canais e do relógio do cartão do plantão (Brasília). */
export const DEFAULT_TZ = 'America/Sao_Paulo';

const fmts = new Map();
function fmt(tz) {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    if (fmts.size > 200) fmts.clear(); // fusos vêm da configuração dos canais: poucos, mas nunca cresce sem limite
    fmts.set(tz, f);
  }
  return f;
}

/** O fuso existe para o Intl (nome IANA, ex.: "America/Sao_Paulo", "America/Manaus", "UTC")? */
export function validTz(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { fmt(tz); return true; } catch { return false; }
}

/** Data e hora de parede (números) do instante ms no fuso tz. */
function wall(ms, tz) {
  const p = {};
  for (const x of fmt(tz).formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return p;
}

/** Diferença do fuso para o UTC (segundos) no instante ms. Ex.: Brasília = −10800. */
export function tzOffsetSec(ms, tz = DEFAULT_TZ) {
  const p = wall(ms, tz);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 1000);
}

/** Base do relógio do drawtext: segundos de época já no fuso, somados ao pts do quadro (que começa em 0 no cartão). */
export const clockBase = (nowMs, tz = DEFAULT_TZ) => Math.floor(nowMs / 1000) + tzOffsetSec(nowMs, tz);

/**
 * Base do relógio queimado no ar com milissegundos (texto para o drawtext: %{pts:gmtime:<base>:%H}): `airMs` é o instante
 * de parede do pts 0 do alimentador (o mesmo t0 do alerta de emergência e do PROGRAM-DATE-TIME do HLS), já no fuso tz.
 */
export const airClockBase = (airMs, tz = DEFAULT_TZ) => (airMs / 1000 + tzOffsetSec(airMs, tz)).toFixed(3);

/**
 * Fuso do canal: channels.config.schedule.tz (Configurações → Fuso horário; a agenda usa o mesmo), ou Brasília. É a fonte
 * única de todo relógio queimado no ar (barras, erro, standby, fora do ar, cartões do plantão) e das horas da agenda.
 */
export const channelTz = (cfg) => (validTz(cfg?.schedule?.tz) ? cfg.schedule.tz : DEFAULT_TZ);

/**
 * O instante ms na hora local do canal: { year, month (1–12), day, weekday (0 = domingo), sec (desde a meia-noite local,
 * com a fração), hour, minute, second }.
 */
export function localParts(ms, tz = DEFAULT_TZ) {
  const p = wall(ms, tz);
  const frac = (((ms % 1000) + 1000) % 1000) / 1000;
  return {
    year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second,
    weekday: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(),
    sec: p.hour * 3600 + p.minute * 60 + p.second + frac,
  };
}

/** Data de calendário somada de n dias ({ year, month, day } → idem), sem fuso: a conta é no calendário. */
export function addDays({ year, month, day }, n) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Dia da semana (0 = domingo) de uma data de calendário. */
export const weekdayOf = ({ year, month, day }) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();

/**
 * Instante UTC (ms) de "data local + sec desde a meia-noite local" no fuso tz. sec pode passar de 86400 (a conta segue no
 * relógio de parede do dia seguinte). Duas passadas: o deslocamento de um dia antes e o de um dia depois dão os dois
 * candidatos; vale o que, lido de volta no fuso, dá a hora pedida. Os dois valem = hora repetida: a primeira (o menor).
 * Nenhum vale = hora inexistente: o deslocamento de antes da mudança, que empurra para depois do pulo.
 */
export function localToUtc({ year, month, day }, sec, tz = DEFAULT_TZ) {
  const guess = Date.UTC(year, month - 1, day) + Math.round(sec * 1000); // a hora de parede lida como se fosse UTC
  const before = tzOffsetSec(guess - 86400_000, tz);
  const after = tzOffsetSec(guess + 86400_000, tz);
  const cands = [...new Set([guess - before * 1000, guess - after * 1000])];
  // o deslocamento é sempre de segundos inteiros: o candidato certo, somado a ele, volta exatamente à hora de parede pedida
  const ok = cands.filter((t) => t + tzOffsetSec(t, tz) * 1000 === guess);
  if (ok.length) return Math.min(...ok);
  return guess - before * 1000;
}

/** Meia-noite local (ms UTC) do dia local que contém ms. */
export function startOfLocalDay(ms, tz = DEFAULT_TZ) {
  const p = localParts(ms, tz);
  return localToUtc(p, 0, tz);
}
