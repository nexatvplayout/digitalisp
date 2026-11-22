/* TV Corporativa, pacote B: regras de RH e comunicação interna, sem banco (docs/TV-CORPORATIVA.md §2.4, §3.2 e §7.2).
   Aniversariantes (SÓ dia e mês: o ano nunca é guardado, nem vindo da planilha), tempo de casa pela data de admissão,
   boas-vindas aos novos, comunicados com validade e alcance, o "Li" e as sugestões do celular. Tudo puro e testável:
   server/tvcorp-dados.js guarda e serve.

   Privacidade (LGPD, §7.2): o nome vai às telas reduzido (primeiro nome + inicial do último sobrenome), a não ser que a
   empresa escolha o nome completo; a foto só com o consentimento marcado; o "Li" guarda só o que a pessoa escreveu. */
import { createHash, randomBytes } from 'node:crypto';

export const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra || {}) });
export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
/** Uma linha de texto limpa: sem controle, sem quebra, espaços juntos, cortada. */
export const line = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Texto com quebras de linha (no máximo uma linha em branco seguida). */
export const text = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
export const idOf = (v, what = 'Id') => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw fail(400, `${what} inválido.`); return n; };
const optId = (v, what) => (v == null || v === '' ? null : idOf(v, what));
const pad = (n) => String(n).padStart(2, '0');

export const RH_LIMITS = Object.freeze({
  name: 60, sector: 40, people: 20_000, importRows: 20_000, importBytes: 4 * 1024 * 1024,
  postTitle: 60, postBody: 280, postLines: 8, posts: 2_000, who: 60, qr: 500,
  suggestion: 500, suggestionsPending: 5_000, postMaxDays: 366,
});

/** Categorias dos comunicados (§3.2) e o cabeçalho que vai à tela. */
export const POST_CATEGORIES = Object.freeze({
  comunicado: 'Comunicado', rh: 'Recursos Humanos', beneficio: 'Benefícios', 'boas-vindas': 'Boas-vindas', reconhecimento: 'Reconhecimento',
  seguranca: 'Segurança do trabalho', vaga: 'Vaga interna', evento: 'Evento', aviso: 'Aviso',
});
export const POST_CATEGORY_KEYS = Object.freeze(Object.keys(POST_CATEGORIES));
export const SUGGESTION_KINDS = Object.freeze({ sugestao: 'Sugestão', conteudo: 'Conteúdo para as telas', pesquisa: 'Resposta de pesquisa' });
/** Alcance do comunicado: o mesmo formato dos alertas da prefeitura (scope + scope_data). */
export const POST_SCOPES = Object.freeze(['all', 'offices', 'groups', 'regions', 'devices']);

/* ------------------------------------------------------------------ datas */
/** 'AAAA-MM-DD' de verdade ou null. */
export function cleanYmd(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() + 1 === +m[2] && d.getUTCDate() === +m[3] ? m[0] : null;
}
const validDayMonth = (day, month) => Number.isInteger(day) && Number.isInteger(month) && month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(2024, month, 0)).getUTCDate(); // 2024: o 29/02 vale
const ymdParts = (s) => { const [y, m, d] = s.split('-').map(Number); return { year: y, month: m, day: d }; };
const ymdOf = ({ year, month, day }) => `${year}-${pad(month)}-${pad(day)}`;
const addDays = (s, n) => { const p = ymdParts(s); const d = new Date(Date.UTC(p.year, p.month - 1, p.day + n)); return ymdOf({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }); };
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Aniversário digitado ou vindo da planilha -> { day, month } (o ano, se vier, é DESCARTADO). Aceita "20/11", "20/11/1990",
 * "20-11", "1990-11-20", "20.11.90". Vazio -> null. Fora do calendário -> lança.
 */
export function parseBirthday(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let day; let month;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) { month = +m[2]; day = +m[3]; } else {
    m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(s);
    if (!m) throw fail(400, 'Aniversário: use dia/mês, por exemplo 20/11.');
    day = +m[1]; month = +m[2];
  }
  if (!validDayMonth(day, month)) throw fail(400, 'Aniversário: dia ou mês fora do calendário.');
  return { day, month };
}
/** Data de admissão: "AAAA-MM-DD" ou "dd/mm/aaaa" -> 'AAAA-MM-DD'. Vazio -> null. */
export function parseHireDate(v, { today = null } = {}) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let out = cleanYmd(s);
  if (!out) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
    out = m ? cleanYmd(`${m[3]}-${pad(+m[2])}-${pad(+m[1])}`) : null;
  }
  if (!out) throw fail(400, 'Admissão: use dia/mês/ano, por exemplo 03/02/2020.');
  if (out < '1950-01-01' || (today && out > addDays(today, 366))) throw fail(400, 'Admissão: data fora do esperado.');
  return out;
}

/* ------------------------------------------------------------------ pessoas */
/** Nome comparável (sem acento, minúsculas, espaços juntos): a chave do "Li" e da conferência de repetidos. */
export const whoKey = (s) => line(s, 120).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PARTICLES = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'van', 'von']);
/**
 * O nome que vai à tela: "Ana Souza Lima" -> "Ana L." (primeiro nome + inicial do último sobrenome, como na chamada de
 * senha). full = a empresa escolheu o nome completo.
 */
export function displayName(name, full = false) {
  const n = line(name, RH_LIMITS.name);
  if (full) return n;
  const parts = n.split(' ').filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  const last = [...parts.slice(1)].reverse().find((p) => !PARTICLES.has(p.toLowerCase())) || '';
  return last ? `${parts[0]} ${last[0].toUpperCase()}.` : parts[0];
}
/** Iniciais (o app desenha quando não há foto). */
export const initials = (name) => { const p = line(name, 60).split(' ').filter((x) => x && !PARTICLES.has(x.toLowerCase())); return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); };

/**
 * Pessoa digitada no painel ou no link da unidade. partial = PATCH (só o que veio). Devolve as colunas.
 * Nunca há ano: { bday_day, bday_month }.
 */
export function cleanPerson(b, { partial = false, today = null } = {}) {
  const out = {};
  const has = (k) => b && Object.prototype.hasOwnProperty.call(b, k);
  if (!partial || has('name')) {
    const name = line(b?.name, RH_LIMITS.name);
    if (name.length < 2) throw fail(400, `Nome: 2 a ${RH_LIMITS.name} caracteres.`);
    out.name = name;
  }
  if (!partial || has('sector')) out.sector = line(b?.sector, RH_LIMITS.sector);
  if (!partial || has('birthday')) {
    const bd = typeof b?.birthday === 'object' && b?.birthday ? (validDayMonth(Number(b.birthday.day), Number(b.birthday.month)) ? { day: Number(b.birthday.day), month: Number(b.birthday.month) } : (() => { throw fail(400, 'Aniversário: dia ou mês fora do calendário.'); })()) : parseBirthday(b?.birthday);
    out.bday_day = bd ? bd.day : null; out.bday_month = bd ? bd.month : null;
  }
  if (!partial || has('hireDate')) out.hire_date = parseHireDate(b?.hireDate, { today });
  if (!partial || has('officeId')) out.office_id = optId(b?.officeId, 'Unidade');
  if (!partial || has('photoConsent')) out.photo_consent = b?.photoConsent === true ? 1 : 0;
  if (!partial || has('active')) out.active = b?.active === false ? 0 : 1;
  return out;
}

/* ------------------------------------------------------------------ CSV */
/** Lê CSV (vírgula, ponto e vírgula ou tabulação, descoberto pela 1ª linha; aspas duplas; BOM). Devolve linhas de campos. */
export function parseCsv(input, { maxRows = RH_LIMITS.importRows + 1 } = {}) {
  const s = String(input ?? '').replace(/^﻿/, '');
  const first = s.slice(0, s.search(/\r?\n/) >>> 0 || s.length);
  const counts = [';', ',', '\t'].map((c) => [c, first.split(c).length]);
  const sep = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      if (rows.length >= maxRows) return rows;
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}
const HEADERS = {
  name: ['nome', 'name', 'funcionario', 'colaborador', 'nome completo'],
  birthday: ['aniversario', 'nascimento', 'data de nascimento', 'dia/mes', 'birthday', 'niver'],
  sector: ['setor', 'departamento', 'area', 'equipe', 'sector'],
  hireDate: ['admissao', 'data de admissao', 'contratacao', 'entrada', 'hire_date'],
  office: ['unidade', 'filial', 'office', 'local'],
  consent: ['foto autorizada', 'consentimento', 'autorizou foto', 'consent'],
};
const norm = (s) => whoKey(s).replace(/[^a-z/ _]/g, '').trim();
/**
 * Planilha de pessoas -> { rows: [{ line, person }], errors: [{ line, error }] }. Cabeçalho reconhecido pelos nomes
 * (Nome, Aniversário, Setor, Admissão, Unidade); sem cabeçalho, a ordem Nome; Aniversário; Setor; Admissão. O ANO do
 * aniversário é descartado aqui, antes de qualquer gravação. officeOf(texto) -> id da unidade ou null (nome ou número).
 */
export function importPeopleCsv(csv, { officeOf = () => null, today = null } = {}) {
  if (String(csv ?? '').length > RH_LIMITS.importBytes) throw fail(413, 'A planilha passa de 4 MB.');
  const all = parseCsv(csv);
  if (!all.length) throw fail(400, 'A planilha está vazia.');
  let col = { name: 0, birthday: 1, sector: 2, hireDate: 3, office: -1, consent: -1 };
  let start = 0;
  const head = all[0].map(norm);
  if (head.some((h) => Object.values(HEADERS).some((names) => names.includes(h)))) {
    col = Object.fromEntries(Object.entries(HEADERS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
    start = 1;
    if (col.name < 0) throw fail(400, 'A planilha precisa da coluna Nome.');
  }
  if (all.length - start > RH_LIMITS.importRows) throw fail(413, `No máximo ${RH_LIMITS.importRows} pessoas por planilha.`);
  const rows = []; const errors = [];
  for (let i = start; i < all.length; i++) {
    const r = all[i]; const at = (k) => (col[k] >= 0 ? r[col[k]] ?? '' : '');
    try {
      const officeText = line(at('office'), 80);
      const officeId = officeText ? officeOf(officeText) : null;
      if (officeText && !officeId) throw fail(400, `Unidade "${officeText}" não encontrada.`);
      const consent = /^(s|sim|x|1|yes|true)$/i.test(line(at('consent'), 5));
      const person = cleanPerson({ name: at('name'), birthday: at('birthday'), sector: at('sector'), hireDate: at('hireDate'), officeId, photoConsent: consent, active: true }, { today });
      rows.push({ line: i + 1, person });
    } catch (e) { errors.push({ line: i + 1, error: e.message }); }
  }
  return { rows, errors };
}
/** Campo de CSV: aspas quando precisa e sem fórmula (=, +, -, @ no começo viram texto para a planilha). */
export const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** As pessoas em CSV (separado por ponto e vírgula, com BOM para abrir certo no Excel). Aniversário só dia/mês. */
export function peopleCsv(rows, officeName = () => '') {
  const out = ['Nome;Setor;Aniversário;Admissão;Unidade;Foto autorizada;Ativo'];
  for (const p of rows) {
    const bd = p.bday_day && p.bday_month ? `${pad(p.bday_day)}/${pad(p.bday_month)}` : '';
    const hd = p.hire_date ? p.hire_date.split('-').reverse().join('/') : '';
    out.push([p.name, p.sector, bd, hd, p.office_id ? officeName(Number(p.office_id)) : '', Number(p.photo_consent) ? 'sim' : 'não', Number(p.active) ? 'sim' : 'não'].map(csvCell).join(';'));
  }
  return `﻿${out.join('\r\n')}\r\n`;
}

/* ------------------------------------------------------------------ aniversariantes, tempo de casa e novos */
/**
 * Quem faz aniversário de day até day + days - 1 (inclusive a virada do ano). 29/02 em ano que não é bissexto: no dia 28.
 * Devolve as pessoas na ordem do dia, com { day, month, date: 'AAAA-MM-DD' (do ano corrente da janela) }.
 */
export function birthdaysIn(people, day, days = 1) {
  const want = new Map();
  for (let i = 0; i < Math.max(1, days); i++) {
    const d = addDays(day, i); const p = ymdParts(d);
    want.set(`${p.month}-${p.day}`, d);
    if (p.month === 2 && p.day === 28 && !isLeap(p.year)) want.set('2-29', d);
  }
  const out = [];
  for (const x of people) {
    if (!Number(x.active ?? 1) || !x.bday_day || !x.bday_month) continue;
    const date = want.get(`${Number(x.bday_month)}-${Number(x.bday_day)}`);
    if (date) out.push({ ...x, date });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.name).localeCompare(String(b.name), 'pt-BR')));
}
/** Anos completos de casa no dia (null sem admissão ou no futuro). */
export function yearsOfHouse(hireDate, day) {
  if (!cleanYmd(hireDate) || !cleanYmd(day) || hireDate > day) return null;
  const [hy, hm, hd] = hireDate.split('-').map(Number); const [y, m, d] = day.split('-').map(Number);
  return y - hy - (m < hm || (m === hm && d < hd) ? 1 : 0);
}
/** Aniversário de casa (1 ano ou mais) na janela: [{ ...pessoa, years, date }]. */
export function tenureIn(people, day, days = 7) {
  const end = addDays(day, Math.max(1, days) - 1);
  const out = [];
  for (const x of people) {
    if (!Number(x.active ?? 1) || !cleanYmd(x.hire_date)) continue;
    const [, hm, hd] = x.hire_date.split('-').map(Number);
    for (const y of new Set([+day.slice(0, 4), +end.slice(0, 4)])) {
      const date = cleanYmd(`${y}-${pad(hm)}-${pad(hd)}`) || `${y}-02-28`;
      const years = yearsOfHouse(x.hire_date, date);
      if (date >= day && date <= end && years >= 1) { out.push({ ...x, years, date }); break; }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
/** Admitidos nos últimos days dias (boas-vindas). */
export function newHires(people, day, days = 30) {
  const from = addDays(day, -Math.max(0, days));
  return people.filter((x) => Number(x.active ?? 1) && cleanYmd(x.hire_date) && x.hire_date >= from && x.hire_date <= day).sort((a, b) => (a.hire_date < b.hire_date ? 1 : -1));
}
export const yearsText = (n) => (n === 1 ? '1 ano de casa' : `${n} anos de casa`);

/* ------------------------------------------------------------------ comunicados */
/** Endereço do QR: só https, sem usuário/senha, até 500 caracteres. Vazio -> null. */
export function cleanHttpsUrl(v, what = 'Endereço do QR') {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let u; try { u = new URL(s); } catch { throw fail(400, `${what}: endereço inválido.`); }
  if (u.protocol !== 'https:' || u.username || u.password) throw fail(400, `${what}: use um endereço https://.`);
  if (u.href.length > RH_LIMITS.qr) throw fail(400, `${what}: endereço longo demais.`);
  return u.href;
}
const idList = (v, what) => {
  if (!Array.isArray(v) || !v.length || v.length > 500) throw fail(400, `${what}: escolha ao menos um.`);
  return [...new Set(v.map((x) => idOf(x, what)))];
};
/** Alcance: { kind: 'all' } ou { kind: 'offices'|'groups'|'regions'|'devices', ids: [...] }. city (dos alertas) = all. */
export function cleanPostScope(s, allowed = POST_SCOPES) {
  const kind = s == null ? 'all' : s.kind === 'city' ? 'all' : s.kind;
  if (!allowed.includes(kind)) throw fail(400, 'Alcance do comunicado inválido.');
  if (kind === 'all') return { kind };
  const names = { offices: 'Unidades', groups: 'Grupos', regions: 'Regiões', devices: 'Telas' };
  return { kind, ids: idList(s.ids ?? s[kind], names[kind]) };
}
/**
 * Comunicado digitado (painel, link da unidade, API). partial = PATCH. Título até 60, texto até 280 e 8 linhas, validade
 * de no máximo 1 ano, QR só https. Devolve as colunas (scope e scope_data prontos).
 */
export function cleanPost(b, { partial = false, now = Date.now(), allowedScopes = POST_SCOPES } = {}) {
  const out = {};
  const has = (k) => b && Object.prototype.hasOwnProperty.call(b, k);
  if (!partial || has('category')) {
    const c = b?.category ?? 'comunicado';
    if (!POST_CATEGORY_KEYS.includes(c)) throw fail(400, 'Categoria do comunicado inválida.');
    out.category = c;
  }
  if (!partial || has('title')) {
    const t = line(b?.title, RH_LIMITS.postTitle);
    if (t.length < 2) throw fail(400, `Título: 2 a ${RH_LIMITS.postTitle} caracteres.`);
    out.title = t;
  }
  if (!partial || has('text')) {
    const body = text(b?.text, RH_LIMITS.postBody);
    if (body.split('\n').length > RH_LIMITS.postLines) throw fail(400, `Texto: no máximo ${RH_LIMITS.postLines} linhas.`);
    out.body = body;
  }
  if (!partial || has('qr')) out.qr_url = cleanHttpsUrl(b?.qr);
  if (!partial || has('mediaId')) out.media_id = optId(b?.mediaId, 'Mídia');
  if (!partial || has('needsAck')) out.needs_ack = b?.needsAck === true ? 1 : 0;
  if (!partial || has('scope')) { const sc = cleanPostScope(b?.scope, allowedScopes); out.scope = sc.kind; out.scope_data = JSON.stringify(sc.ids ? { ids: sc.ids } : {}); }
  if (!partial || has('validFrom') || has('validTo')) {
    const vf = b?.validFrom == null || b.validFrom === '' ? null : Math.round(Number(b.validFrom));
    const vt = b?.validTo == null || b.validTo === '' ? null : Math.round(Number(b.validTo));
    if (vf != null && (!Number.isFinite(vf) || vf < now - 366 * 86400_000)) throw fail(400, 'Início da validade inválido.');
    if (vt != null && (!Number.isFinite(vt) || vt <= (vf ?? now - 60_000))) throw fail(400, 'O fim da validade precisa ser depois do início.');
    if (vt != null && vt - (vf ?? now) > RH_LIMITS.postMaxDays * 86400_000) throw fail(400, 'O comunicado vale no máximo 1 ano.');
    if (!partial || has('validFrom')) out.valid_from = vf;
    if (!partial || has('validTo')) out.valid_to = vt;
  }
  return out;
}
/** Vale agora: aprovado, dentro da validade. */
export const postActive = (p, t) => p.status === 'ok' && (p.valid_from == null || Number(p.valid_from) <= t) && (p.valid_to == null || Number(p.valid_to) > t);
const scopeIds = (p) => { try { const d = typeof p.scope_data === 'string' ? JSON.parse(p.scope_data) : p.scope_data; return Array.isArray(d?.ids) ? d.ids.map(Number) : []; } catch { return []; } };
/**
 * O comunicado pega a tela/unidade? ctx: { officeId, groupIds, regionId, deviceId }. Comunicado da unidade (office_id)
 * só vale na própria unidade. Sem tela (o celular), os alcances por grupo e por tela valem para a unidade da tela citada
 * só quando o ctx traz os grupos/telas; no celular da empresa (sem unidade) vale tudo o que é "all".
 */
export function postHits(p, ctx = {}) {
  const officeId = ctx.officeId == null ? null : Number(ctx.officeId);
  if (p.office_id != null && Number(p.office_id) !== officeId) return false;
  const ids = scopeIds(p);
  switch (p.scope) {
    case 'all': return true;
    case 'offices': return officeId != null && ids.includes(officeId);
    case 'regions': return ctx.regionId != null && ids.includes(Number(ctx.regionId));
    case 'groups': return (ctx.groupIds || []).some((g) => ids.includes(Number(g)));
    case 'devices': return ctx.deviceId != null && ids.includes(Number(ctx.deviceId));
    default: return false;
  }
}
export const postScopeOf = (p) => ({ kind: p.scope, ...(p.scope === 'all' ? {} : { ids: scopeIds(p) }) });

/** Quem tocou em "Li": o nome ou a matrícula que a pessoa escreveu (2 a 60). */
export function cleanWho(v) {
  const w = line(v, RH_LIMITS.who);
  if (w.length < 2) throw fail(400, 'Escreva o seu nome ou a matrícula (ao menos 2 letras).');
  return w;
}

/** Sugestão do celular: { kind, text (até 500), who ('' = anônima) }. */
export function cleanSuggestion(b) {
  const kind = b?.kind ?? 'sugestao';
  if (!Object.hasOwn(SUGGESTION_KINDS, kind)) throw fail(400, 'Tipo inválido.');
  const t = text(b?.text, RH_LIMITS.suggestion);
  if (t.length < 3) throw fail(400, 'Escreva ao menos 3 letras.');
  return { kind, text: t, who: b?.anonymous === false ? line(b?.who, RH_LIMITS.who) : '' };
}
