/* NEXA Telas · comunicação interna (docs/TELAS.md §25; contrato §17): as regras sem banco. Os tipos de aviso interno, o
   catálogo de fábrica dos códigos de emergência hospitalar, a limpeza do que o painel e o celular mandam e a chave de quem
   leu (nome ou matrícula, sem acento nem diferença de maiúsculas). Nada daqui fala de paciente: só de funcionários. */
import { fail, line, text } from './telas-core.js';
import { CODE_COLORS, codeColorKey } from '../public/shared/telas-tipos.js';

export const INT_LIMITS = Object.freeze({
  sectors: 40, sectorName: 60, staff: 300, staffName: 60, title: 80, body: 600, activeNotices: 60, sent: 12,
  codes: 12, codeKey: 20, codeLabel: 40, meaning: 80, place: 80, reader: 60, minutesMax: 720, secondsMin: 5, secondsMax: 120,
  noticeMaxMs: 60 * 86400_000, noticeMinMs: 60_000,
});

/** Os tipos de aviso interno (o rótulo vai à tela como a linha de cima do cartão). */
export const INT_KINDS = Object.freeze([
  { key: 'aviso', label: 'Aviso da direção' },
  { key: 'escala', label: 'Escala do plantão' },
  { key: 'treinamento', label: 'Treinamento' },
  { key: 'protocolo', label: 'Protocolo' },
  { key: 'aniversariantes', label: 'Aniversariantes' },
]);
export const INT_KIND_KEYS = INT_KINDS.map((k) => k.key);
export const intKindLabel = (k) => INT_KINDS.find((x) => x.key === k)?.label || 'Aviso';

/** Os códigos de emergência de fábrica (a repartição troca, tira e acrescenta). fg: a cor do texto sobre a cor do código. */
export const DEFAULT_CODES = Object.freeze([
  { key: 'azul', label: 'Código Azul', meaning: 'Parada cardiorrespiratória', color: '#1565c0' },
  { key: 'vermelho', label: 'Código Vermelho', meaning: 'Incêndio', color: '#c62828' },
  { key: 'rosa', label: 'Código Rosa', meaning: 'Bebê ou criança desaparecida (sequestro)', color: '#d81b60' },
  { key: 'laranja', label: 'Código Laranja', meaning: 'Múltiplas vítimas ou desastre', color: '#ef6c00' },
  { key: 'cinza', label: 'Código Cinza', meaning: 'Agressão ou pessoa violenta', color: '#616161' },
  { key: 'amarelo', label: 'Código Amarelo', meaning: 'Ameaça de bomba', color: '#f9a825' },
].map((c) => Object.freeze(c)));
/** Quanto tempo o código fica nas telas sem ninguém encerrar (minutos; 0 = só quando alguém encerrar). */
export const DEFAULT_CODE_MIN = 30;

const HEX = /^#[0-9a-f]{6}$/i;
/** Texto escuro ou claro sobre a cor (luminância relativa). */
export function textOn(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return '#ffffff';
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return lum > 0.4 ? '#1a1a1a' : '#ffffff';
}

/** A lista de códigos que a repartição grava: [{ key, label, meaning, color }], 1 a 12, sem chave repetida. */
export function cleanCodes(v) {
  if (!Array.isArray(v) || !v.length) throw fail(400, 'Códigos: envie ao menos um.');
  if (v.length > INT_LIMITS.codes) throw fail(400, `Códigos: no máximo ${INT_LIMITS.codes}.`);
  const seen = new Set();
  return v.map((c, i) => {
    const label = line(c?.label, INT_LIMITS.codeLabel);
    if (label.length < 2) throw fail(400, `Código ${i + 1}: o nome tem de 2 a ${INT_LIMITS.codeLabel} letras.`);
    const key = (line(c?.key, INT_LIMITS.codeKey) || label).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^c[oó]digo\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, INT_LIMITS.codeKey);
    if (!key) throw fail(400, `Código ${i + 1}: nome inválido.`);
    if (seen.has(key)) throw fail(400, `Código "${label}" repetido.`);
    seen.add(key);
    const raw = String(c?.color || '').trim().toLowerCase();
    const color = CODE_COLORS.find((x) => x.hex === raw || x.key === raw)?.hex;
    if (!HEX.test(raw) && !color) throw fail(400, `Código "${label}": escolha uma cor da lista.`);
    if (!color) throw fail(400, `Código "${label}": a cor precisa ser uma da lista (${CODE_COLORS.map((x) => x.label.toLowerCase()).join(', ')}).`);
    return { key, label, meaning: line(c?.meaning, INT_LIMITS.meaning), color };
  });
}
export function cleanCodeMinutes(v) {
  const n = Math.round(Number(v));
  if (!(n >= 0 && n <= INT_LIMITS.minutesMax)) throw fail(400, `Tempo do código na tela: 0 (até encerrar) a ${INT_LIMITS.minutesMax} minutos.`);
  return n;
}

/** Nome ou matrícula de quem leu: uma linha, 2 a 60 letras. */
export function cleanReader(v) {
  const r = line(v, INT_LIMITS.reader);
  if (r.length < 2) throw fail(400, 'Escreva o seu nome ou a matrícula (ao menos 2 letras).');
  return r;
}
/** A chave de comparação: sem acento, minúsculas, espaços juntos ("José  da Silva" = "jose da silva"). */
export const readerKey = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** A lista de funcionários do setor (opcional): um nome ou matrícula por item, sem repetir, até 300. */
export function cleanStaff(v) {
  if (v == null || v === '') return [];
  const list = Array.isArray(v) ? v : String(v).split(/\r?\n/);
  const out = []; const seen = new Set();
  for (const raw of list) {
    const n = line(raw, INT_LIMITS.staffName);
    if (n.length < 2 || seen.has(readerKey(n))) continue;
    seen.add(readerKey(n)); out.push(n);
  }
  if (out.length > INT_LIMITS.staff) throw fail(400, `Lista de funcionários: no máximo ${INT_LIMITS.staff} por setor.`);
  return out;
}
export function cleanSectorName(v) {
  const n = line(v, INT_LIMITS.sectorName);
  if (n.length < 2) throw fail(400, `Nome do setor: 2 a ${INT_LIMITS.sectorName} letras.`);
  return n;
}

/** O aviso interno: { kind, title, body, sectors (ids; vazio = todos), seconds, startsAt, until }. */
export function cleanNotice(b, { now = Date.now() } = {}) {
  const kind = b?.kind == null || b.kind === '' ? 'aviso' : String(b.kind);
  if (!INT_KIND_KEYS.includes(kind)) throw fail(400, 'Tipo de aviso interno inválido.');
  const title = line(b?.title, INT_LIMITS.title);
  if (title.length < 2) throw fail(400, `Título: 2 a ${INT_LIMITS.title} letras.`);
  const body = text(b?.text ?? b?.body, INT_LIMITS.body);
  const sectors = Array.isArray(b?.sectors) ? [...new Set(b.sectors.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, INT_LIMITS.sectors) : [];
  const seconds = b?.seconds == null || b.seconds === '' ? 15 : Math.round(Number(b.seconds));
  if (!(seconds >= INT_LIMITS.secondsMin && seconds <= INT_LIMITS.secondsMax)) throw fail(400, `Segundos na tela: ${INT_LIMITS.secondsMin} a ${INT_LIMITS.secondsMax}.`);
  const startsAt = b?.startsAt == null || b.startsAt === '' ? now : Math.round(Number(b.startsAt));
  if (!Number.isFinite(startsAt) || startsAt < now - 60_000 || startsAt > now + 30 * 86400_000) throw fail(400, 'Início do aviso inválido.');
  let until;
  if (b?.until != null && b.until !== '') until = Math.round(Number(b.until));
  else if (b?.days != null && b.days !== '') until = Math.max(startsAt, now) + Number(b.days) * 86400_000;
  else until = Math.max(startsAt, now) + 7 * 86400_000;
  if (!Number.isFinite(until) || until - Math.max(startsAt, now) < INT_LIMITS.noticeMinMs) throw fail(400, 'A validade do aviso precisa ser de ao menos 1 minuto.');
  if (until - startsAt > INT_LIMITS.noticeMaxMs) throw fail(400, 'O aviso interno vale no máximo 60 dias.');
  return { kind, title, body, sectors, seconds, startsAt, until };
}

/** O aviso vale para o setor? sectors vazio = todos os setores; tela sem setor recebe todos os avisos da repartição. */
export const noticeHits = (sectors, sectorId) => sectorId == null || !sectors.length || sectors.includes(Number(sectorId));

/** O código no formato do contrato (§17.2) e da página do celular. */
export const codeDto = (c) => ({
  id: Number(c.id), code: c.code, label: c.label, meaning: c.meaning || '', color: c.color, textColor: textOn(c.color), colorKey: codeColorKey(c.color), place: c.place || '',
  firedAt: Number(c.fired_at), until: c.until_at == null ? null : Number(c.until_at),
});
/** Em vigor agora: não encerrado e dentro do tempo (null = até encerrar). */
export const codeActive = (c, t) => !c.closed_at && (c.until_at == null || Number(c.until_at) > t);
