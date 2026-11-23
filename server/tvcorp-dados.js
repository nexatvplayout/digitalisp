/* TV Corporativa, pacote B: fontes de dados, RH, indicadores, widgets e o celular do funcionário
   (docs/TV-CORPORATIVA.md §2.3 a §2.5, §3.2, §5 e §7; tabelas em server/db/schema-tvcorp-dados.js).

   createTvcorpDados({ db, … }) devolve:
     mount(app, deps)             tudo o que vier em deps: mountPanel (needs), mountMobile (sempre), mountOffice (office,
                                  gestorOnly, note), mountApi (apiKey)
     dataFor(tenantId, officeId, ref, ctx?)  o item pronto para o `signage` (contrato §4.1) ou null; { kind: 'post' } sem id
                                  devolve a LISTA dos comunicados em vigor (um item por comunicado). Injetado no
                                  createTvcorp do pacote A. Nunca busca fora: só lê o que a busca em segundo plano guardou.
     tick()  busca as fontes e os indicadores vencidos (o relógio chama a cada minuto; timers: false nos testes)
     prune(), dropOffice(x, tenantId, officeId), pending(tenantId), readFile(name), stop()

   Rotas
     Painel (tvcorp.manage)   /api/tvcorp/feeds*, /people*, /posts*, /kpis*, /widgets*, /mobile*, /suggestions*, /dados/pending
     Celular (token do link)  GET /tvc/<token> (a página, CSP estrita), GET /api/tvc, POST /api/tvc/ack/:postId,
                              POST /api/tvc/suggest, PUT /api/tvc/suggest/:id/image. O token SÓ no cabeçalho Authorization
                              (nunca no endereço da API); só o SHA-256 no banco; o endereço aparece uma vez.
     Link da unidade (F11)    /api/reparticao/tvcorp* (o gestor: comunicados e aniversariantes da própria unidade, as telas dela)
     Integração (chave)       POST /api/tvcorp-api/posts, POST /api/tvcorp-api/kpis/:id/value

   Isolamento: o cliente vem SEMPRE da credencial (sessão do painel, token do celular, sessão do link, chave de integração);
   unidade, grupo, tela, pessoa, comunicado ou indicador de outro cliente = 404. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createLimiter, ipKey } from './ratelimit.js';
import { localParts, validTz } from './tz.js';
import * as R from './tvcorp-rh.js';
import * as F from './tvcorp-fontes.js';
import { DATES, DATE_KINDS, cleanDateKeys, datesOn, upcomingDates } from '../public/shared/tvcorp-datas.js';

const { fail, line, idOf, sha256 } = R;
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const j = (s, d) => { if (s == null || s === '') return d; if (typeof s === 'object') return s; try { return JSON.parse(s); } catch { return d; } };
const num = (v) => (v == null ? null : Number(v));
const pad = (n) => String(n).padStart(2, '0');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TVC_PAGE_DIR = path.join(ROOT, 'public', 'tvc');

/** Cabeçalhos da página do celular (/tvc/<token>): nada de inline, nada de fora, sem referência, fora da busca. */
export const TVC_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
export const TVC_HEADERS = Object.freeze({
  'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': TVC_CSP,
});
/** Tipos de unidade corporativa (§5.1). O coordenador pode trocar pelo `corp: true` do catálogo (isCorpOffice). */
export const CORP_OFFICE_TYPES = Object.freeze(['matriz', 'filial', 'fabrica', 'loja', 'cd', 'refeitorio', 'recepcao', 'ambulatorio', 'treinamento', 'corp-outro']);
export const DADOS_LIMITS = Object.freeze({ widgets: 100, mobile: 50, feedTestsPerMin: 10, fetchPerTenantHour: 240, concurrent: 3, photoBytes: 15 * 1024 * 1024, suggestImageBytes: 5 * 1024 * 1024, suggestKeepDays: 180, imageWindowMs: 10 * 60_000 });
export const FILE_RE = /^tvc(pessoa|sug)-[0-9a-f-]{36}\.jpg$/;

/* ------------------------------------------------------------------ widgets (contador, dias sem acidente, relógio mundial, cardápio) */
export const WIDGET_KINDS = Object.freeze({
  countdown: 'Contador regressivo', safety: 'Dias sem acidente', worldclock: 'Relógio mundial', menu: 'Cardápio',
  // DIGITAL ISP (os gadgets da tela)
  weather: 'Clima e previsão', clock: 'Relógio', agenda: 'Agenda e salas', reviews: 'Avaliações e depoimentos',
  dashboard: 'Painel de indicadores', directions: 'Como chegar', web: 'Página da internet',
});
/** Os limites dos gadgets novos. */
export const GADGET_LIMITS = Object.freeze({ agendaEvents: 40, agendaShown: 6, reviews: 12, dashboardKpis: 6, webRefreshMin: 5, webRefreshMax: 1440 });
/** Os fusos do relógio mundial (lista fixa: o cliente escolhe daqui). */
export const WORLD_ZONES = Object.freeze([
  { tz: 'America/Sao_Paulo', label: 'Brasília' }, { tz: 'America/Manaus', label: 'Manaus' }, { tz: 'America/Noronha', label: 'Fernando de Noronha' },
  { tz: 'America/Rio_Branco', label: 'Rio Branco' }, { tz: 'America/New_York', label: 'Nova York' }, { tz: 'America/Chicago', label: 'Chicago' },
  { tz: 'America/Los_Angeles', label: 'Los Angeles' }, { tz: 'America/Mexico_City', label: 'Cidade do México' }, { tz: 'America/Buenos_Aires', label: 'Buenos Aires' },
  { tz: 'America/Santiago', label: 'Santiago' }, { tz: 'America/Bogota', label: 'Bogotá' }, { tz: 'Europe/London', label: 'Londres' },
  { tz: 'Europe/Lisbon', label: 'Lisboa' }, { tz: 'Europe/Madrid', label: 'Madri' }, { tz: 'Europe/Paris', label: 'Paris' }, { tz: 'Europe/Berlin', label: 'Berlim' },
  { tz: 'Europe/Moscow', label: 'Moscou' }, { tz: 'Africa/Johannesburg', label: 'Joanesburgo' }, { tz: 'Asia/Dubai', label: 'Dubai' }, { tz: 'Asia/Kolkata', label: 'Nova Délhi' },
  { tz: 'Asia/Shanghai', label: 'Xangai' }, { tz: 'Asia/Tokyo', label: 'Tóquio' }, { tz: 'Asia/Singapore', label: 'Singapura' }, { tz: 'Australia/Sydney', label: 'Sydney' },
]);
const ZONE = new Map(WORLD_ZONES.map((z) => [z.tz, z]));
const WEEK = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/**
 * O widget digitado -> { name, data }.
 *   countdown   { title, at (epoch ms), until? (epoch ms: o fim), text }
 *   weather     { feedId? (a fonte de clima; sem ela, a da unidade), days (1 a 4 dias de previsão) }
 *   clock       { face: digital | analog, tz (um fuso da lista ou vazio = o da empresa), label, seconds, date }
 *   agenda      { title, events: [{ date AAAA-MM-DD, time? HH:MM, end? HH:MM, title, place }] } (a tela mostra de hoje em diante)
 *   reviews     { title, items: [{ name, text, stars 1-5 }], qr? (https: onde avaliar) }
 *   dashboard   { title, kpis: [ids] } (de 1 a 6 indicadores lado a lado)
 *   directions  { title, address, reference, hours, phone, qr? (https: o link do mapa) }
 *   web         { url (https), refreshMin (0 = não recarrega) }
 *   safety      { title, lastAccident ('AAAA-MM-DD'), record (dias), goal (dias) }
 *   worldclock  { zones: ['America/Sao_Paulo', …] (até 6, da lista) }
 *   menu        { title, days: { '1': [{ name, price?, note? }], … } (0 = domingo; até 12 itens por dia), showPrice }
 */
export function cleanWidget(kind, b, { partial = false, cur = null } = {}) {
  if (!Object.hasOwn(WIDGET_KINDS, kind)) throw fail(400, 'Tipo de widget inválido.');
  const out = {};
  const has = (k) => b && Object.prototype.hasOwnProperty.call(b, k);
  if (!partial || has('name')) out.name = line(b?.name, 60) || WIDGET_KINDS[kind];
  if (partial && !has('data')) return out;
  const d = b?.data && typeof b.data === 'object' ? b.data : {};
  if (kind === 'countdown') {
    const at = Math.round(Number(d.at));
    if (!Number.isFinite(at) || at < 946684800000) throw fail(400, 'Contador: a data e a hora do evento.');
    const title = line(d.title, 60);
    if (title.length < 2) throw fail(400, 'Contador: o nome do evento.');
    // o fim (opcional): depois de começar, a tela conta quanto falta para terminar
    const until = d.until == null || d.until === '' ? null : Math.round(Number(d.until));
    if (until != null && (!Number.isFinite(until) || until <= at)) throw fail(400, 'Contador: o fim vem depois do começo.');
    out.data = { title, at, text: line(d.text, 120), ...(until != null ? { until } : {}) };
  } else if (kind === 'safety') {
    const last = R.cleanYmd(d.lastAccident);
    if (!last) throw fail(400, 'Dias sem acidente: a data do último acidente.');
    const record = d.record == null || d.record === '' ? 0 : Math.round(Number(d.record));
    const goal = d.goal == null || d.goal === '' ? null : Math.round(Number(d.goal));
    if (!Number.isInteger(record) || record < 0 || record > 36500 || (goal != null && (!Number.isInteger(goal) || goal < 1 || goal > 36500))) throw fail(400, 'Dias sem acidente: recorde e meta em dias.');
    out.data = { title: line(d.title, 60) || 'Dias sem acidente', lastAccident: last, record, goal };
  } else if (kind === 'worldclock') {
    const zones = Array.isArray(d.zones) ? [...new Set(d.zones.map(String))] : [];
    if (!zones.length || zones.length > 6 || zones.some((z) => !ZONE.has(z))) throw fail(400, 'Relógio mundial: de 1 a 6 cidades da lista.');
    out.data = { zones };
  } else if (kind === 'weather') {
    const feedId = d.feedId == null || d.feedId === '' ? null : idOf(d.feedId, 'Clima: fonte');
    out.data = { ...(feedId ? { feedId } : {}), days: Math.min(4, Math.max(1, Math.round(Number(d.days) || 4))), title: line(d.title, 60) };
  } else if (kind === 'clock') {
    const tz = d.tz == null || d.tz === '' ? '' : String(d.tz);
    if (tz && !ZONE.has(tz)) throw fail(400, 'Relógio: escolha um fuso da lista.');
    out.data = { face: d.face === 'analog' ? 'analog' : 'digital', tz, label: line(d.label, 40), seconds: d.seconds === true, date: d.date !== false };
  } else if (kind === 'agenda') {
    const list = Array.isArray(d.events) ? d.events : [];
    if (list.length > GADGET_LIMITS.agendaEvents) throw fail(400, `Agenda: no máximo ${GADGET_LIMITS.agendaEvents} compromissos.`);
    const hm = (v, what) => { if (v == null || v === '') return null; if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v))) throw fail(400, `Agenda: ${what} no formato HH:MM.`); return String(v); };
    const events = list.map((e) => {
      const date = R.cleanYmd(e?.date); const title = line(e?.title, 80);
      if (!date) throw fail(400, 'Agenda: cada compromisso precisa da data.');
      if (title.length < 2) throw fail(400, 'Agenda: cada compromisso precisa do nome.');
      const time = hm(e?.time, 'o horário'); const end = hm(e?.end, 'o fim');
      return { date, ...(time ? { time } : {}), ...(end ? { end } : {}), title, ...(line(e?.place, 60) ? { place: line(e.place, 60) } : {}) };
    }).sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`));
    out.data = { title: line(d.title, 60) || 'Agenda', events };
  } else if (kind === 'reviews') {
    const list = Array.isArray(d.items) ? d.items : [];
    if (!list.length || list.length > GADGET_LIMITS.reviews) throw fail(400, `Avaliações: de 1 a ${GADGET_LIMITS.reviews}.`);
    const items = list.map((x) => {
      const text = line(x?.text, 200); if (text.length < 2) throw fail(400, 'Avaliações: escreva o depoimento.');
      const stars = Math.round(Number(x?.stars ?? 5));
      return { name: line(x?.name, 40) || 'Cliente', text, stars: Math.min(5, Math.max(1, Number.isFinite(stars) ? stars : 5)) };
    });
    const qr = d.qr ? R.cleanHttpsUrl(d.qr, 'Avaliações: endereço do QR') : null;
    out.data = { title: line(d.title, 60) || 'O que dizem os clientes', items, ...(qr ? { qr } : {}) };
  } else if (kind === 'dashboard') {
    const ids = Array.isArray(d.kpis) ? [...new Set(d.kpis.map((x) => idOf(x, 'Painel: indicador')))] : [];
    if (!ids.length || ids.length > GADGET_LIMITS.dashboardKpis) throw fail(400, `Painel: escolha de 1 a ${GADGET_LIMITS.dashboardKpis} indicadores.`);
    out.data = { title: line(d.title, 60) || 'Indicadores', kpis: ids };
  } else if (kind === 'directions') {
    const address = line(d.address, 120); if (address.length < 4) throw fail(400, 'Como chegar: escreva o endereço.');
    const qr = d.qr ? R.cleanHttpsUrl(d.qr, 'Como chegar: link do mapa') : null;
    out.data = { title: line(d.title, 60) || 'Como chegar', address, reference: line(d.reference, 120), hours: line(d.hours, 80), phone: line(d.phone, 30), ...(qr ? { qr } : {}) };
  } else if (kind === 'web') {
    const url = R.cleanHttpsUrl(d.url, 'Página: endereço');
    if (!url) throw fail(400, 'Página: informe o endereço https://.');
    const r = Math.round(Number(d.refreshMin) || 0);
    out.data = { url, refreshMin: r <= 0 ? 0 : Math.min(GADGET_LIMITS.webRefreshMax, Math.max(GADGET_LIMITS.webRefreshMin, r)) };
  } else {
    const days = {};
    for (let w = 0; w < 7; w++) {
      const list = Array.isArray(d.days?.[w]) ? d.days[w] : Array.isArray(d.days?.[String(w)]) ? d.days[String(w)] : [];
      if (list.length > 12) throw fail(400, 'Cardápio: no máximo 12 itens por dia.');
      const items = list.map((x) => ({ name: line(typeof x === 'string' ? x : x?.name, 60), ...(x?.price != null && x.price !== '' ? { price: F.parseNumber(x.price) } : {}), ...(x?.note ? { note: line(x.note, 60) } : {}) })).filter((x) => x.name);
      if (items.some((x) => Object.hasOwn(x, 'price') && (x.price == null || x.price < 0))) throw fail(400, 'Cardápio: preço em reais (um número).');
      if (items.length) days[String(w)] = items;
    }
    out.data = { title: line(d.title, 60) || 'Cardápio do dia', days, showPrice: d.showPrice === true };
  }
  if (cur && !out.data) out.data = cur;
  return out;
}

const SOURCE_SAFE = (s) => line(s, 80);
const MASC = new Set(['Comunicado', 'Indicador', 'Widget', 'Endereço', 'Grupo']);

export function createTvcorpDados({
  db, audit = async () => {}, ipOf = (req) => req.ip, publicUrl = () => '', available = async () => true,
  weatherOf = null, trafficOf = null, fetcher = undefined, parseFeed = undefined, settingsOf = null,
  isCorpOffice = (o) => CORP_OFFICE_TYPES.includes(o?.type), files = {}, photoUrl = null,
  now = () => Date.now(), tz = 'America/Sao_Paulo', timers = true, tickMs = 60_000, pageDir = TVC_PAGE_DIR, log = (m) => console.warn(m),
}) {
  if (!db) throw new Error('createTvcorpDados: falta o db.');
  const fileDir = files.dir || null;
  const prepareImage = files.prepare || (async (buf) => {
    const [{ preparePhoto }, { config }] = await Promise.all([import('./telas-desaparecidos.js'), import('./config.js')]);
    return preparePhoto(buf, { ffmpeg: config.ffmpeg });
  });
  const noStore = (res) => res.set('Cache-Control', 'no-store');
  const fetchDeps = () => ({ fetcher, parseFeed, weatherOf, trafficOf, now });

  /* ---------------------------------------------------------------- dia local, configuração do cliente */
  const dayOf = (ms, zone = tz) => { const p = localParts(ms, zone); return { ymd: `${p.year}-${pad(p.month)}-${pad(p.day)}`, weekday: p.weekday }; };
  /** tvcorp_settings (pacote A) ou settingsOf: { approval, fullNames, dates, tz }. Sem a tabela, os de fábrica. */
  async function settings(tenantId) {
    let d = {};
    try {
      if (settingsOf) d = (await settingsOf(tenantId)) || {};
      else d = j((await db.get('SELECT data FROM tvcorp_settings WHERE tenant_id = ?', [tenantId]))?.data, {});
    } catch { d = {}; }
    return { approval: d.approval === true, fullNames: d.fullNames === true, dates: cleanDateKeys(d.dates), tz: validTz(d.tz) ? d.tz : tz };
  }

  /* ---------------------------------------------------------------- donos e alcances */
  async function own(table, id, tenantId, what) {
    const row = await db.get(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ?`, [idOf(id, what), tenantId]);
    if (!row) throw fail(404, `${what} não encontrad${MASC.has(what) ? 'o' : 'a'}.`);
    return row;
  }
  const officeOk = async (tenantId, id) => { if (id != null) await own('telas_offices', id, tenantId, 'Unidade'); };
  const SCOPE_TABLE = { offices: ['telas_offices', 'Unidade'], groups: ['telas_groups', 'Grupo'], regions: ['telas_regions', 'Região'], devices: ['telas_devices', 'Tela'] };
  async function scopeOk(tenantId, scope, scopeData) {
    if (scope === 'all') return;
    const ids = j(scopeData, {}).ids || [];
    const [table, what] = SCOPE_TABLE[scope];
    const rows = await db.all(`SELECT id FROM ${table} WHERE tenant_id = ? AND id IN (${ids.map(() => '?').join(',')})`, [tenantId, ...ids]);
    if (rows.length !== ids.length) throw fail(404, `${what} não encontrad${MASC.has(what) ? 'o' : 'a'}.`);
  }
  const count = async (sql, args) => Number((await db.get(sql, args)).n);
  const under = async (sql, args, max, msg) => { if ((await count(sql, args)) >= max) throw fail(409, msg); };

  /* ---------------------------------------------------------------- arquivos (foto da pessoa, imagem da sugestão) */
  async function putFile(prefix, buf) {
    if (!fileDir) throw fail(503, 'O servidor está sem a pasta das imagens da TV corporativa.');
    const name = `tvc${prefix}-${randomUUID()}.jpg`;
    await fs.promises.mkdir(fileDir, { recursive: true });
    await fs.promises.writeFile(path.join(fileDir, name), buf);
    return name;
  }
  const removeFile = async (name) => { if (fileDir && FILE_RE.test(String(name || ''))) await fs.promises.rm(path.join(fileDir, name), { force: true }).catch(() => {}); };
  /** O arquivo (para a rota que o coordenador monta para a TV box, e para o painel). null se o nome não é nosso. */
  const readFile = async (name) => (fileDir && FILE_RE.test(String(name || '')) ? fs.promises.readFile(path.join(fileDir, name)).catch(() => null) : null);
  async function imageFrom(buf, maxBytes) {
    if (!Buffer.isBuffer(buf) || !buf.length) throw fail(400, 'Envie a imagem no corpo do pedido.');
    if (buf.length > maxBytes) throw fail(413, `A imagem passa de ${Math.round(maxBytes / 1048576)} MB.`);
    if (!sniffImage(buf)) throw fail(400, 'Use uma imagem JPEG, PNG ou WebP.');
    const out = await prepareImage(buf, { width: 1280, height: 1280 });
    if (!Buffer.isBuffer(out) || sniffImage(out) !== 'jpg') throw fail(400, 'Não foi possível preparar esta imagem. Tente outra.');
    return out;
  }

  /* ---------------------------------------------------------------- busca das fontes em segundo plano */
  const inflight = new Map(); // `f<id>` | `k<id>` -> promessa
  const perTenantHour = createLimiter({ windowMs: 3_600_000, max: Number(process.env.TVCORP_FETCH_PER_HOUR) || DADOS_LIMITS.fetchPerTenantHour, maxKeys: 50_000, now });
  /** Busca uma fonte agora (uma por vez por fonte). Guarda o resultado bom; o erro fica na fonte e o último bom continua. */
  function refreshFeed(row, { force = false } = {}) {
    const k = `f${row.id}`;
    if (inflight.has(k)) return inflight.get(k);
    if (!force && !perTenantHour.hit(String(row.tenant_id))) return Promise.resolve({ ok: false, error: 'Limite de buscas por hora atingido.' });
    const p = (async () => {
      const t = now();
      await db.run('UPDATE tvcorp_feeds SET tried_at = ? WHERE id = ?', [t, row.id]);
      try {
        const cache = await F.fetchFeed(row, fetchDeps());
        await db.run('UPDATE tvcorp_feeds SET cache = ?, fetched_at = ?, last_error = NULL WHERE id = ?', [JSON.stringify(cache), now(), row.id]);
        return { ok: true, cache };
      } catch (e) {
        const msg = line(e?.status ? e.message : (e?.code === 'EPRIVATE' ? e.message : `Fonte indisponível: ${e?.message || 'erro'}`), 200);
        await db.run('UPDATE tvcorp_feeds SET last_error = ? WHERE id = ?', [msg, row.id]);
        return { ok: false, error: msg };
      } finally { inflight.delete(k); }
    })();
    inflight.set(k, p);
    return p;
  }
  function refreshKpi(row, { force = false } = {}) {
    const k = `k${row.id}`;
    if (inflight.has(k)) return inflight.get(k);
    if (!force && !perTenantHour.hit(String(row.tenant_id))) return Promise.resolve({ ok: false, error: 'Limite de buscas por hora atingido.' });
    const p = (async () => {
      const t = now();
      await db.run('UPDATE tvcorp_kpis SET tried_at = ? WHERE id = ?', [t, row.id]);
      try {
        const value = await F.fetchKpiValue(row, { fetcher, parseCsv: R.parseCsv });
        await setKpiValue(row, value, now());
        return { ok: true, value };
      } catch (e) {
        const msg = line(e?.status || e?.code === 'EPRIVATE' ? e.message : `Fonte indisponível: ${e?.message || 'erro'}`, 200);
        await db.run('UPDATE tvcorp_kpis SET last_error = ? WHERE id = ?', [msg, row.id]);
        return { ok: false, error: msg };
      } finally { inflight.delete(k); }
    })();
    inflight.set(k, p);
    return p;
  }
  async function setKpiValue(row, value, at) {
    await db.run('UPDATE tvcorp_kpis SET value = ?, updated_at = ?, last_error = NULL WHERE id = ? AND tenant_id = ?', [value, at, row.id, row.tenant_id]);
    // a série: no máximo um ponto por minuto (o mais novo vale)
    await db.run('DELETE FROM tvcorp_kpi_points WHERE tenant_id = ? AND kpi_id = ? AND at > ?', [row.tenant_id, row.id, at - 60_000]);
    await db.run('INSERT INTO tvcorp_kpi_points(tenant_id,kpi_id,at,value) VALUES(?,?,?,?)', [row.tenant_id, row.id, at, value]);
  }
  /** As fontes e os indicadores vencidos (no máximo DADOS_LIMITS.concurrent buscas de uma vez). */
  async function tick() {
    const t = now();
    const feeds = await db.all('SELECT * FROM tvcorp_feeds WHERE enabled = 1 AND (tried_at IS NULL OR tried_at + refresh_min * 60000 <= ?) ORDER BY tried_at LIMIT 30', [t]);
    const kpis = await db.all("SELECT * FROM tvcorp_kpis WHERE source IN ('csv','json') AND (tried_at IS NULL OR tried_at + refresh_min * 60000 <= ?) ORDER BY tried_at LIMIT 30", [t]);
    const jobs = [...feeds.map((f) => () => refreshFeed(f)), ...kpis.map((k) => () => refreshKpi(k))];
    const run = async () => { for (let job = jobs.shift(); job; job = jobs.shift()) await job(); };
    await Promise.all(Array.from({ length: DADOS_LIMITS.concurrent }, run));
  }
  let busy = false;
  const timer = timers ? setInterval(() => { if (busy) return; busy = true; tick().catch((e) => log(`[tvcorp] fontes: ${e.message}`)).finally(() => { busy = false; }); }, tickMs) : null;
  timer?.unref?.();

  /* ---------------------------------------------------------------- DTOs */
  const feedDto = (f) => {
    const cache = j(f.cache, null);
    return {
      id: Number(f.id), kind: f.kind, kindLabel: F.FEED_KINDS[f.kind], name: f.name, config: j(f.config, {}), refreshMin: Number(f.refresh_min), enabled: Boolean(Number(f.enabled)),
      fetchedAt: num(f.fetched_at), triedAt: num(f.tried_at), lastError: f.last_error || null, stale: !f.fetched_at || now() - Number(f.fetched_at) > F.FEED_LIMITS.staleMs,
      credit: F.feedCredit(f.kind, j(f.config, {})), preview: cache,
    };
  };
  const personDto = (p, full = false) => ({
    id: Number(p.id), name: p.name, display: R.displayName(p.name, full), sector: p.sector || '', officeId: num(p.office_id),
    birthday: p.bday_day && p.bday_month ? { day: Number(p.bday_day), month: Number(p.bday_month) } : null, hireDate: p.hire_date || null,
    photo: Boolean(p.photo), photoConsent: Boolean(Number(p.photo_consent)), active: Boolean(Number(p.active)),
  });
  const postStatus = (p, t) => (p.status === 'pending' ? 'aguardando aprovação' : p.status === 'rejected' ? 'devolvido' : p.valid_to != null && Number(p.valid_to) <= t ? 'vencido' : p.valid_from != null && Number(p.valid_from) > t ? 'agendado' : 'em vigor');
  const postDto = (p, acks = 0) => ({
    id: Number(p.id), officeId: num(p.office_id), category: p.category, categoryLabel: R.POST_CATEGORIES[p.category] || p.category, title: p.title, text: p.body || '',
    qr: p.qr_url || null, mediaId: num(p.media_id), scope: R.postScopeOf(p), validFrom: num(p.valid_from), validTo: num(p.valid_to), needsAck: Boolean(Number(p.needs_ack)),
    status: p.status, situation: postStatus(p, now()), reason: p.reason || null, createdBy: p.created_by || '', via: p.created_via || 'painel', createdAt: Number(p.created_at), acks: Number(acks),
  });
  const kpiDto = (k, points = null) => {
    const bands = j(k.bands, []);
    return {
      id: Number(k.id), officeId: num(k.office_id), name: k.name, unit: k.unit || '', value: num(k.value), target: num(k.target), direction: k.direction, bands,
      band: F.kpiBand({ value: k.value, target: k.target, direction: k.direction, bands }), source: k.source, sourceCfg: j(k.source_cfg, {}), refreshMin: Number(k.refresh_min),
      updatedAt: num(k.updated_at), lastError: k.last_error || null, ...(points ? { points: points.map((p) => ({ at: Number(p.at), value: Number(p.value) })) } : {}),
    };
  };
  const widgetDto = (w) => ({ id: Number(w.id), kind: w.kind, kindLabel: WIDGET_KINDS[w.kind], name: w.name, data: j(w.data, {}), updatedAt: num(w.updated_at) });
  const suggestionDto = (s) => ({ id: Number(s.id), officeId: num(s.office_id), kind: s.kind, kindLabel: R.SUGGESTION_KINDS[s.kind] || s.kind, text: s.text, who: s.who || '', anonymous: !s.who, image: Boolean(s.media_file), status: s.status, reason: s.reason || null, decidedBy: s.decided_by || null, decidedAt: num(s.decided_at), createdAt: Number(s.created_at) });
  async function ackCounts(tenantId, ids) {
    if (!ids.length) return new Map();
    const rows = await db.all(`SELECT post_id, COUNT(*) AS n FROM tvcorp_post_acks WHERE tenant_id = ? AND post_id IN (${ids.map(() => '?').join(',')}) GROUP BY post_id`, [tenantId, ...ids]);
    return new Map(rows.map((r) => [Number(r.post_id), Number(r.n)]));
  }

  /* ---------------------------------------------------------------- pessoas e comunicados (painel e link da unidade) */
  async function savePerson(tenantId, cur, p) {
    const t = now();
    if (cur) {
      await db.run(`UPDATE tvcorp_people SET ${Object.keys(p).map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND tenant_id = ?`, [...Object.values(p), t, cur.id, tenantId]);
      if (cur.photo && p.photo_consent === 0) { // retirou o consentimento: a foto sai do armazenamento na hora
        await removeFile(cur.photo); await db.run('UPDATE tvcorp_people SET photo = NULL, photo_sha = NULL, photo_bytes = NULL WHERE id = ?', [cur.id]); }
      return cur.id;
    }
    return db.insert('INSERT INTO tvcorp_people(tenant_id,office_id,name,sector,bday_day,bday_month,hire_date,photo_consent,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [tenantId, p.office_id ?? null, p.name, p.sector ?? '', p.bday_day ?? null, p.bday_month ?? null, p.hire_date ?? null, p.photo_consent ?? 0, p.active ?? 1, t, t]);
  }
  async function deletePerson(tenantId, p) {
    await db.run('DELETE FROM tvcorp_people WHERE id = ? AND tenant_id = ?', [p.id, tenantId]);
    await removeFile(p.photo);
  }
  /** A planilha: pessoa com o mesmo nome (sem acento) na mesma unidade é atualizada; o resto entra. */
  async function importPeople(tenantId, csv, { forceOffice = null } = {}) {
    const offices = await db.all('SELECT id, name FROM telas_offices WHERE tenant_id = ?', [tenantId]);
    const byName = new Map(offices.map((o) => [R.whoKey(o.name), Number(o.id)]));
    const ids = new Set(offices.map((o) => Number(o.id)));
    const officeOf = (s) => (forceOffice ? forceOffice : /^\d+$/.test(s) && ids.has(Number(s)) ? Number(s) : byName.get(R.whoKey(s)) ?? null);
    const { rows, errors } = R.importPeopleCsv(csv, { officeOf, today: dayOf(now()).ymd });
    const existing = await db.all('SELECT id, name, office_id FROM tvcorp_people WHERE tenant_id = ?', [tenantId]);
    const key = (name, office) => `${R.whoKey(name)}|${office ?? ''}`;
    const have = new Map(existing.map((p) => [key(p.name, num(p.office_id)), p]));
    const total = existing.length;
    let added = 0; let updated = 0;
    await db.tx(async (x) => {
      const t = now();
      for (const { person } of rows) {
        if (forceOffice) person.office_id = forceOffice;
        const cur = have.get(key(person.name, person.office_id));
        if (cur) {
          // a planilha não liga o consentimento de quem já está (só o painel) e coluna vazia não apaga o que já havia
          const { photo_consent: _c, ...all } = person;
          const upd = Object.fromEntries(Object.entries(all).filter(([, v]) => v != null && v !== ''));
          await x.run(`UPDATE tvcorp_people SET ${Object.keys(upd).map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND tenant_id = ?`, [...Object.values(upd), t, cur.id, tenantId]);
          updated++;
        } else {
          if (total + added >= R.RH_LIMITS.people) throw fail(409, `Limite de ${R.RH_LIMITS.people} pessoas atingido.`);
          const id = await x.insert('INSERT INTO tvcorp_people(tenant_id,office_id,name,sector,bday_day,bday_month,hire_date,photo_consent,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            [tenantId, person.office_id ?? null, person.name, person.sector, person.bday_day, person.bday_month, person.hire_date, person.photo_consent, person.active, t, t]);
          have.set(key(person.name, person.office_id), { id, name: person.name, office_id: person.office_id });
          added++;
        }
      }
    });
    return { added, updated, errors: errors.slice(0, 200), errorCount: errors.length };
  }
  async function createPost(tenantId, b, { by, via, officeId = null, pending = false, allowedScopes }) {
    const p = R.cleanPost(b, { now: now(), allowedScopes });
    await scopeOk(tenantId, p.scope, p.scope_data);
    await under('SELECT COUNT(*) AS n FROM tvcorp_posts WHERE tenant_id = ? AND status <> ? AND (valid_to IS NULL OR valid_to > ?)', [tenantId, 'rejected', now()], R.RH_LIMITS.posts, `No máximo ${R.RH_LIMITS.posts} comunicados em vigor. Encerre os que já não valem.`);
    const t = now();
    const id = await db.insert('INSERT INTO tvcorp_posts(tenant_id,office_id,category,title,body,media_id,qr_url,scope,scope_data,valid_from,valid_to,needs_ack,status,created_by,created_via,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [tenantId, officeId, p.category, p.title, p.body, p.media_id, p.qr_url, p.scope, p.scope_data, p.valid_from, p.valid_to, p.needs_ack, pending ? 'pending' : 'ok', line(by, 120), via, t, t]);
    return db.get('SELECT * FROM tvcorp_posts WHERE id = ?', [id]);
  }
  async function deletePost(tenantId, id) {
    await db.tx(async (x) => {
      await x.run('DELETE FROM tvcorp_post_acks WHERE tenant_id = ? AND post_id = ?', [tenantId, id]);
      await x.run('DELETE FROM tvcorp_posts WHERE id = ? AND tenant_id = ?', [id, tenantId]);
    });
  }
  async function acksOf(tenantId, post) {
    const rows = await db.all('SELECT who, at FROM tvcorp_post_acks WHERE tenant_id = ? AND post_id = ? ORDER BY at', [tenantId, post.id]);
    return { post: postDto(post, rows.length), acks: rows.map((r) => ({ who: r.who, at: Number(r.at) })), total: rows.length };
  }

  /* ================================================================ painel (tvcorp.manage) */
  function mountPanel(app, { needs }) {
    const all = (req, res, next) => (req.user?.channels ? res.status(403).json({ error: 'A TV Corporativa pede acesso a todos os canais do cliente.' }) : next());
    const M = [needs('tvcorp.manage'), all, (req, res, next) => { noStore(res); next(); }];
    const who = (req) => req.user?.username || '';
    const P = '/api/tvcorp';
    const tests = createLimiter({ windowMs: 60_000, max: DADOS_LIMITS.feedTestsPerMin, maxKeys: 50_000, now });
    const csvBody = express.text({ type: ['text/csv', 'text/plain', 'application/csv'], limit: R.RH_LIMITS.importBytes });
    const imageBody = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: DADOS_LIMITS.photoBytes });

    /* ----- fontes */
    app.get(`${P}/feeds`, M, ah(async (req, res) => {
      const rows = await db.all('SELECT * FROM tvcorp_feeds WHERE tenant_id = ? ORDER BY kind, name, id', [req.tenantId]);
      res.json({
        catalog: { kinds: F.FEED_KINDS, news: F.NEWS_CATALOG.map(({ key, name, credit }) => ({ key, name, credit })), currencies: F.CURRENCIES, ptax: F.PTAX_CURRENCIES, providers: F.QUOTE_PROVIDERS },
        feeds: rows.map(feedDto),
      });
    }));
    app.post(`${P}/feeds`, M, ah(async (req, res) => {
      const kind = req.body?.kind;
      const f = F.cleanFeed(kind, req.body);
      if (kind === 'weather') for (const id of f.config.offices) await officeOk(req.tenantId, id);
      await under('SELECT COUNT(*) AS n FROM tvcorp_feeds WHERE tenant_id = ?', [req.tenantId], F.FEED_LIMITS.feeds, `Limite de ${F.FEED_LIMITS.feeds} fontes atingido.`);
      const t = now();
      const id = await db.insert('INSERT INTO tvcorp_feeds(tenant_id,kind,name,config,refresh_min,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)', [req.tenantId, kind, f.name, JSON.stringify(f.config), f.refresh_min, f.enabled, t, t]);
      const row = await db.get('SELECT * FROM tvcorp_feeds WHERE id = ?', [id]);
      if (f.enabled) refreshFeed(row).catch(() => {}); // a primeira busca já, em segundo plano
      res.locals.audit = `tvcorp: fonte "${f.name}" (${F.FEED_KINDS[kind]}) criada (#${id})`;
      res.status(201).json(feedDto(row));
    }));
    app.patch(`${P}/feeds/:id`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_feeds', req.params.id, req.tenantId, 'Fonte');
      const f = F.cleanFeed(cur.kind, req.body, { partial: true });
      if (cur.kind === 'weather' && f.config) for (const id of f.config.offices) await officeOk(req.tenantId, id);
      const set = { ...f, ...(f.config ? { config: JSON.stringify(f.config) } : {}) };
      const changedSource = f.config && JSON.stringify(f.config) !== JSON.stringify(j(cur.config, {}));
      if (changedSource) Object.assign(set, { cache: null, fetched_at: null, tried_at: null, last_error: null });
      if (Object.keys(set).length) await db.run(`UPDATE tvcorp_feeds SET ${Object.keys(set).map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND tenant_id = ?`, [...Object.values(set), now(), cur.id, req.tenantId]);
      const row = await db.get('SELECT * FROM tvcorp_feeds WHERE id = ?', [cur.id]);
      if (changedSource && Number(row.enabled)) refreshFeed(row).catch(() => {});
      res.locals.audit = `tvcorp: fonte "${row.name}" alterada (#${cur.id})`;
      res.json(feedDto(row));
    }));
    app.delete(`${P}/feeds/:id`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_feeds', req.params.id, req.tenantId, 'Fonte');
      await db.run('DELETE FROM tvcorp_feeds WHERE id = ? AND tenant_id = ?', [cur.id, req.tenantId]);
      res.locals.audit = `tvcorp: fonte "${cur.name}" apagada (#${cur.id})`;
      res.json({ ok: true });
    }));
    app.post(`${P}/feeds/:id/test`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_feeds', req.params.id, req.tenantId, 'Fonte');
      if (!tests.hit(String(req.tenantId))) throw fail(429, 'Muitos testes em pouco tempo. Aguarde um minuto.');
      const r = await refreshFeed(cur, { force: true });
      res.json({ ...r, feed: feedDto(await db.get('SELECT * FROM tvcorp_feeds WHERE id = ?', [cur.id])) });
    }));

    /* ----- pessoas */
    app.get(`${P}/people`, M, ah(async (req, res) => {
      const s = await settings(req.tenantId);
      const args = [req.tenantId]; let where = 'tenant_id = ?';
      if (req.query.officeId) { where += ' AND office_id = ?'; args.push(idOf(req.query.officeId, 'Unidade')); }
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200)); const offset = Math.max(0, Number(req.query.offset) || 0);
      const q = R.whoKey(req.query.q || '');
      let rows = await db.all(`SELECT * FROM tvcorp_people WHERE ${where} ORDER BY name, id`, args);
      if (q) rows = rows.filter((p) => R.whoKey(`${p.name} ${p.sector}`).includes(q));
      const t = dayOf(now(), s.tz).ymd;
      res.json({
        total: rows.length, people: rows.slice(offset, offset + limit).map((p) => personDto(p, s.fullNames)),
        today: R.birthdaysIn(rows, t, 1).map((p) => personDto(p, s.fullNames)), week: R.birthdaysIn(rows, t, 7).map((p) => ({ ...personDto(p, s.fullNames), date: p.date })),
        tenure: R.tenureIn(rows, t, 30).map((p) => ({ ...personDto(p, s.fullNames), years: p.years, date: p.date })), welcome: R.newHires(rows, t, 30).map((p) => personDto(p, s.fullNames)),
      });
    }));
    app.post(`${P}/people`, M, ah(async (req, res) => {
      const p = R.cleanPerson(req.body, { today: dayOf(now()).ymd });
      await officeOk(req.tenantId, p.office_id);
      await under('SELECT COUNT(*) AS n FROM tvcorp_people WHERE tenant_id = ?', [req.tenantId], R.RH_LIMITS.people, `Limite de ${R.RH_LIMITS.people} pessoas atingido.`);
      const id = await savePerson(req.tenantId, null, p);
      res.locals.audit = `tvcorp: pessoa #${id} cadastrada (aniversariantes)`; // sem o nome na auditoria
      res.status(201).json(personDto(await db.get('SELECT * FROM tvcorp_people WHERE id = ?', [id])));
    }));
    app.patch(`${P}/people/:id`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_people', req.params.id, req.tenantId, 'Pessoa');
      const p = R.cleanPerson(req.body, { partial: true, today: dayOf(now()).ymd });
      if ('office_id' in p) await officeOk(req.tenantId, p.office_id);
      if (Object.keys(p).length) await savePerson(req.tenantId, cur, p);
      res.locals.audit = `tvcorp: pessoa #${cur.id} alterada${p.photo_consent === 0 && cur.photo ? ' (consentimento da foto retirado: foto apagada)' : ''}`;
      res.json(personDto(await db.get('SELECT * FROM tvcorp_people WHERE id = ?', [cur.id])));
    }));
    app.delete(`${P}/people/:id`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_people', req.params.id, req.tenantId, 'Pessoa');
      await deletePerson(req.tenantId, cur);
      res.locals.audit = `tvcorp: pessoa #${cur.id} apagada`;
      res.json({ ok: true });
    }));
    app.post(`${P}/people/import`, M, csvBody, ah(async (req, res) => {
      const csv = typeof req.body === 'string' ? req.body : typeof req.body?.csv === 'string' ? req.body.csv : '';
      const out = await importPeople(req.tenantId, csv);
      res.locals.audit = `tvcorp: planilha de pessoas importada (${out.added} nova(s), ${out.updated} atualizada(s), ${out.errorCount} linha(s) com erro)`;
      res.json(out);
    }));
    app.get(`${P}/people/export`, M, ah(async (req, res) => {
      const rows = await db.all('SELECT * FROM tvcorp_people WHERE tenant_id = ? ORDER BY name, id', [req.tenantId]);
      const offices = new Map((await db.all('SELECT id, name FROM telas_offices WHERE tenant_id = ?', [req.tenantId])).map((o) => [Number(o.id), o.name]));
      res.locals.audit = `tvcorp: planilha de pessoas exportada (${rows.length})`;
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="aniversariantes.csv"' }).send(R.peopleCsv(rows, (id) => offices.get(id) || ''));
    }));
    app.put(`${P}/people/:id/photo`, M, imageBody, ah(async (req, res) => {
      const cur = await own('tvcorp_people', req.params.id, req.tenantId, 'Pessoa');
      if (!Number(cur.photo_consent)) throw fail(409, 'Marque antes "A pessoa autorizou a foto na TV".');
      const jpg = await imageFrom(req.body, DADOS_LIMITS.photoBytes);
      const name = await putFile('pessoa', jpg);
      await db.run('UPDATE tvcorp_people SET photo = ?, photo_sha = ?, photo_bytes = ?, updated_at = ? WHERE id = ? AND tenant_id = ?', [name, sha256Buf(jpg), jpg.length, now(), cur.id, req.tenantId]);
      await removeFile(cur.photo);
      res.locals.audit = `tvcorp: foto da pessoa #${cur.id} enviada (com consentimento)`;
      res.json(personDto(await db.get('SELECT * FROM tvcorp_people WHERE id = ?', [cur.id])));
    }));
    app.delete(`${P}/people/:id/photo`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_people', req.params.id, req.tenantId, 'Pessoa');
      await db.run('UPDATE tvcorp_people SET photo = NULL, photo_sha = NULL, photo_bytes = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?', [now(), cur.id, req.tenantId]);
      await removeFile(cur.photo);
      res.locals.audit = `tvcorp: foto da pessoa #${cur.id} apagada`;
      res.json({ ok: true });
    }));
    app.get(`${P}/people/:id/photo`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_people', req.params.id, req.tenantId, 'Pessoa');
      const buf = Number(cur.photo_consent) ? await readFile(cur.photo) : null;
      if (!buf) throw fail(404, 'Sem foto.');
      res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' }).send(buf);
    }));

    /* ----- comunicados */
    app.get(`${P}/posts`, M, ah(async (req, res) => {
      const args = [req.tenantId]; let where = 'tenant_id = ?';
      if (req.query.status && ['ok', 'pending', 'rejected'].includes(req.query.status)) { where += ' AND status = ?'; args.push(req.query.status); }
      const rows = await db.all(`SELECT * FROM tvcorp_posts WHERE ${where} ORDER BY id DESC LIMIT 500`, args);
      const acks = await ackCounts(req.tenantId, rows.map((p) => Number(p.id)));
      res.json({ categories: R.POST_CATEGORIES, posts: rows.map((p) => postDto(p, acks.get(Number(p.id)) || 0)) });
    }));
    app.post(`${P}/posts`, M, ah(async (req, res) => {
      const officeId = req.body?.officeId == null || req.body.officeId === '' ? null : idOf(req.body.officeId, 'Unidade');
      await officeOk(req.tenantId, officeId);
      const row = await createPost(req.tenantId, req.body, { by: who(req), via: 'painel', officeId });
      res.locals.audit = `tvcorp: comunicado "${row.title}" (${R.POST_CATEGORIES[row.category]}) publicado (#${row.id})`;
      res.status(201).json(postDto(row));
    }));
    app.patch(`${P}/posts/:id`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_posts', req.params.id, req.tenantId, 'Comunicado');
      const p = R.cleanPost(req.body, { partial: true, now: now() });
      if ('scope' in p) await scopeOk(req.tenantId, p.scope, p.scope_data);
      if (Object.keys(p).length) await db.run(`UPDATE tvcorp_posts SET ${Object.keys(p).map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND tenant_id = ?`, [...Object.values(p), now(), cur.id, req.tenantId]);
      const row = await db.get('SELECT * FROM tvcorp_posts WHERE id = ?', [cur.id]);
      res.locals.audit = `tvcorp: comunicado "${row.title}" alterado (#${cur.id})`;
      res.json(postDto(row, (await ackCounts(req.tenantId, [cur.id])).get(Number(cur.id)) || 0));
    }));
    app.delete(`${P}/posts/:id`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_posts', req.params.id, req.tenantId, 'Comunicado');
      await deletePost(req.tenantId, cur.id);
      res.locals.audit = `tvcorp: comunicado "${cur.title}" apagado (#${cur.id})`;
      res.json({ ok: true });
    }));
    app.get(`${P}/posts/:id/acks`, M, ah(async (req, res) => res.json(await acksOf(req.tenantId, await own('tvcorp_posts', req.params.id, req.tenantId, 'Comunicado')))));
    app.post(`${P}/posts/:id/decide`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_posts', req.params.id, req.tenantId, 'Comunicado');
      if (cur.status !== 'pending') throw fail(409, 'Este comunicado não está aguardando aprovação.');
      const approve = req.body?.approve === true;
      const reason = line(req.body?.reason, 200);
      if (!approve && reason.length < 3) throw fail(400, 'Diga o motivo da devolução.');
      await db.run('UPDATE tvcorp_posts SET status = ?, reason = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?', [approve ? 'ok' : 'rejected', approve ? null : reason, who(req), now(), now(), cur.id, req.tenantId]);
      res.locals.audit = `tvcorp: comunicado "${cur.title}" ${approve ? 'aprovado' : 'devolvido'} (#${cur.id})`;
      res.json(postDto(await db.get('SELECT * FROM tvcorp_posts WHERE id = ?', [cur.id])));
    }));

    /* ----- indicadores */
    app.get(`${P}/kpis`, M, ah(async (req, res) => {
      const rows = await db.all('SELECT * FROM tvcorp_kpis WHERE tenant_id = ? ORDER BY name, id', [req.tenantId]);
      res.json({ sources: F.KPI_SOURCES, note: 'Nunca use dado individual de funcionário: ranking só por equipe, unidade ou turno.', kpis: rows.map((k) => kpiDto(k)) });
    }));
    app.get(`${P}/kpis/:id`, M, ah(async (req, res) => {
      const k = await own('tvcorp_kpis', req.params.id, req.tenantId, 'Indicador');
      const from = now() - Math.min(400, Math.max(1, Number(req.query.days) || 30)) * 86400_000;
      res.json(kpiDto(k, await db.all('SELECT at, value FROM tvcorp_kpi_points WHERE tenant_id = ? AND kpi_id = ? AND at >= ? ORDER BY at LIMIT 5000', [req.tenantId, k.id, from])));
    }));
    app.post(`${P}/kpis`, M, ah(async (req, res) => {
      const k = F.cleanKpi(req.body);
      await officeOk(req.tenantId, k.office_id);
      await under('SELECT COUNT(*) AS n FROM tvcorp_kpis WHERE tenant_id = ?', [req.tenantId], F.KPI_LIMITS.kpis, `Limite de ${F.KPI_LIMITS.kpis} indicadores atingido.`);
      const t = now();
      const id = await db.insert('INSERT INTO tvcorp_kpis(tenant_id,office_id,name,unit,target,direction,bands,source,source_cfg,refresh_min,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        [req.tenantId, k.office_id, k.name, k.unit, k.target, k.direction, k.bands, k.source, k.source_cfg, k.refresh_min, t, null]);
      let row = await db.get('SELECT * FROM tvcorp_kpis WHERE id = ?', [id]);
      if (k.value != null) { await setKpiValue(row, k.value, now()); row = await db.get('SELECT * FROM tvcorp_kpis WHERE id = ?', [id]); }
      if (['csv', 'json'].includes(k.source)) refreshKpi(row).catch(() => {});
      res.locals.audit = `tvcorp: indicador "${k.name}" criado (#${id})`;
      res.status(201).json(kpiDto(row));
    }));
    app.patch(`${P}/kpis/:id`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_kpis', req.params.id, req.tenantId, 'Indicador');
      const { value, ...k } = F.cleanKpi(req.body, { partial: true });
      if ('office_id' in k) await officeOk(req.tenantId, k.office_id);
      if ('source' in k && k.source !== cur.source || 'source_cfg' in k && k.source_cfg !== cur.source_cfg) Object.assign(k, { tried_at: null, last_error: null });
      if (Object.keys(k).length) await db.run(`UPDATE tvcorp_kpis SET ${Object.keys(k).map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND tenant_id = ?`, [...Object.values(k), cur.id, req.tenantId]);
      if (value !== undefined && value != null) await setKpiValue(cur, value, now());
      res.locals.audit = `tvcorp: indicador "${k.name || cur.name}" alterado (#${cur.id})`;
      res.json(kpiDto(await db.get('SELECT * FROM tvcorp_kpis WHERE id = ?', [cur.id])));
    }));
    app.delete(`${P}/kpis/:id`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_kpis', req.params.id, req.tenantId, 'Indicador');
      await db.tx(async (x) => {
        await x.run('DELETE FROM tvcorp_kpi_points WHERE tenant_id = ? AND kpi_id = ?', [req.tenantId, cur.id]);
        await x.run('DELETE FROM tvcorp_kpis WHERE id = ? AND tenant_id = ?', [cur.id, req.tenantId]);
      });
      res.locals.audit = `tvcorp: indicador "${cur.name}" apagado (#${cur.id})`;
      res.json({ ok: true });
    }));
    app.post(`${P}/kpis/:id/value`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_kpis', req.params.id, req.tenantId, 'Indicador');
      const v = F.parseNumber(req.body?.value);
      if (v == null) throw fail(400, 'Valor: um número.');
      await setKpiValue(cur, v, now());
      res.locals.audit = `tvcorp: indicador "${cur.name}" = ${v} (#${cur.id})`;
      res.json(kpiDto(await db.get('SELECT * FROM tvcorp_kpis WHERE id = ?', [cur.id])));
    }));
    app.post(`${P}/kpis/:id/test`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_kpis', req.params.id, req.tenantId, 'Indicador');
      if (!['csv', 'json'].includes(cur.source)) throw fail(409, 'Só os indicadores de planilha ou JSON são lidos de fora.');
      if (!tests.hit(String(req.tenantId))) throw fail(429, 'Muitos testes em pouco tempo. Aguarde um minuto.');
      const r = await refreshKpi(cur, { force: true });
      res.json({ ...r, kpi: kpiDto(await db.get('SELECT * FROM tvcorp_kpis WHERE id = ?', [cur.id])) });
    }));

    /* ----- widgets */
    app.get(`${P}/widgets`, M, ah(async (req, res) => {
      res.json({ kinds: WIDGET_KINDS, zones: WORLD_ZONES, widgets: (await db.all('SELECT * FROM tvcorp_widgets WHERE tenant_id = ? ORDER BY kind, name, id', [req.tenantId])).map(widgetDto) });
    }));
    app.post(`${P}/widgets`, M, ah(async (req, res) => {
      const kind = req.body?.kind;
      const w = cleanWidget(kind, req.body);
      await under('SELECT COUNT(*) AS n FROM tvcorp_widgets WHERE tenant_id = ?', [req.tenantId], DADOS_LIMITS.widgets, `Limite de ${DADOS_LIMITS.widgets} widgets atingido.`);
      const t = now();
      const id = await db.insert('INSERT INTO tvcorp_widgets(tenant_id,kind,name,data,created_at,updated_at) VALUES(?,?,?,?,?,?)', [req.tenantId, kind, w.name, JSON.stringify(w.data), t, t]);
      res.locals.audit = `tvcorp: widget "${w.name}" (${WIDGET_KINDS[kind]}) criado (#${id})`;
      res.status(201).json(widgetDto(await db.get('SELECT * FROM tvcorp_widgets WHERE id = ?', [id])));
    }));
    app.patch(`${P}/widgets/:id`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_widgets', req.params.id, req.tenantId, 'Widget');
      const w = cleanWidget(cur.kind, req.body, { partial: true });
      const set = { ...w, ...(w.data ? { data: JSON.stringify(w.data) } : {}) };
      if (Object.keys(set).length) await db.run(`UPDATE tvcorp_widgets SET ${Object.keys(set).map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND tenant_id = ?`, [...Object.values(set), now(), cur.id, req.tenantId]);
      res.locals.audit = `tvcorp: widget "${w.name || cur.name}" alterado (#${cur.id})`;
      res.json(widgetDto(await db.get('SELECT * FROM tvcorp_widgets WHERE id = ?', [cur.id])));
    }));
    app.delete(`${P}/widgets/:id`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_widgets', req.params.id, req.tenantId, 'Widget');
      await db.run('DELETE FROM tvcorp_widgets WHERE id = ? AND tenant_id = ?', [cur.id, req.tenantId]);
      res.locals.audit = `tvcorp: widget "${cur.name}" apagado (#${cur.id})`;
      res.json({ ok: true });
    }));

    /* ----- endereço do celular e caixa de sugestões */
    const mobileDto = (m) => ({ id: Number(m.id), name: m.name, officeId: num(m.office_id), createdBy: m.created_by || '', createdAt: Number(m.created_at), revokedAt: num(m.revoked_at), active: !m.revoked_at });
    app.get(`${P}/mobile`, M, ah(async (req, res) => res.json({ links: (await db.all('SELECT * FROM tvcorp_mobile WHERE tenant_id = ? ORDER BY id DESC LIMIT 200', [req.tenantId])).map(mobileDto) })));
    app.post(`${P}/mobile`, M, ah(async (req, res) => {
      const officeId = req.body?.officeId == null || req.body.officeId === '' ? null : idOf(req.body.officeId, 'Unidade');
      const office = officeId ? await own('telas_offices', officeId, req.tenantId, 'Unidade') : null;
      const name = line(req.body?.name, 60) || (office ? office.name : 'Toda a empresa');
      await under('SELECT COUNT(*) AS n FROM tvcorp_mobile WHERE tenant_id = ? AND revoked_at IS NULL', [req.tenantId], DADOS_LIMITS.mobile, `No máximo ${DADOS_LIMITS.mobile} endereços ativos. Desligue os que não usa.`);
      const token = R.newToken();
      const id = await db.insert('INSERT INTO tvcorp_mobile(tenant_id,office_id,token_hash,name,created_by,created_at) VALUES(?,?,?,?,?,?)', [req.tenantId, officeId, sha256(token), name, who(req), now()]);
      res.locals.audit = `tvcorp: endereço do celular "${name}" gerado (#${id})`;
      res.status(201).json({ ...mobileDto(await db.get('SELECT * FROM tvcorp_mobile WHERE id = ?', [id])), url: `${publicUrl(req)}/tvc/${token}` });
    }));
    app.delete(`${P}/mobile/:id`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_mobile', req.params.id, req.tenantId, 'Endereço');
      await db.run('UPDATE tvcorp_mobile SET token_hash = NULL, revoked_at = ? WHERE id = ? AND tenant_id = ?', [now(), cur.id, req.tenantId]);
      res.locals.audit = `tvcorp: endereço do celular "${cur.name}" desligado (#${cur.id})`;
      res.json({ ok: true });
    }));
    app.get(`${P}/suggestions`, M, ah(async (req, res) => {
      const args = [req.tenantId]; let where = 'tenant_id = ?';
      if (req.query.status && ['pending', 'ok', 'rejected'].includes(req.query.status)) { where += ' AND status = ?'; args.push(req.query.status); }
      res.json({ kinds: R.SUGGESTION_KINDS, suggestions: (await db.all(`SELECT * FROM tvcorp_suggestions WHERE ${where} ORDER BY id DESC LIMIT 500`, args)).map(suggestionDto) });
    }));
    app.get(`${P}/suggestions/:id/file`, M, ah(async (req, res) => {
      const s = await own('tvcorp_suggestions', req.params.id, req.tenantId, 'Sugestão');
      const buf = await readFile(s.media_file);
      if (!buf) throw fail(404, 'Sem imagem.');
      res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' }).send(buf);
    }));
    app.post(`${P}/suggestions/:id/decide`, M, ah(async (req, res) => {
      const s = await own('tvcorp_suggestions', req.params.id, req.tenantId, 'Sugestão');
      if (s.status !== 'pending') throw fail(409, 'Esta sugestão já foi respondida.');
      const approve = req.body?.approve === true;
      let post = null;
      // aprovar "como comunicado": vira um comunicado já publicado (o texto da pessoa, o título escolhido no painel)
      if (approve && req.body?.post && typeof req.body.post === 'object') post = await createPost(req.tenantId, { text: s.text, ...req.body.post }, { by: who(req), via: 'celular', officeId: num(s.office_id) });
      await db.run('UPDATE tvcorp_suggestions SET status = ?, reason = ?, decided_by = ?, decided_at = ? WHERE id = ? AND tenant_id = ?', [approve ? 'ok' : 'rejected', approve ? null : line(req.body?.reason, 200) || null, who(req), now(), s.id, req.tenantId]);
      res.locals.audit = `tvcorp: sugestão #${s.id} ${approve ? 'aceita' : 'recusada'}${post ? ` e publicada como comunicado #${post.id}` : ''}`;
      res.json({ suggestion: suggestionDto(await db.get('SELECT * FROM tvcorp_suggestions WHERE id = ?', [s.id])), ...(post ? { post: postDto(post) } : {}) });
    }));
    app.delete(`${P}/suggestions/:id`, M, ah(async (req, res) => {
      const s = await own('tvcorp_suggestions', req.params.id, req.tenantId, 'Sugestão');
      await db.run('DELETE FROM tvcorp_suggestions WHERE id = ? AND tenant_id = ?', [s.id, req.tenantId]);
      await removeFile(s.media_file);
      res.locals.audit = `tvcorp: sugestão #${s.id} apagada`;
      res.json({ ok: true });
    }));
    app.get(`${P}/dados/pending`, M, ah(async (req, res) => res.json(await pending(req.tenantId))));
    app.get(`${P}/dados/catalog`, M, ah(async (_req, res) => res.json({
      categories: R.POST_CATEGORIES, suggestionKinds: R.SUGGESTION_KINDS, feedKinds: F.FEED_KINDS, news: F.NEWS_CATALOG.map(({ key, name, credit }) => ({ key, name, credit })),
      currencies: F.CURRENCIES, ptax: F.PTAX_CURRENCIES, quoteProviders: F.QUOTE_PROVIDERS, kpiSources: F.KPI_SOURCES, widgetKinds: WIDGET_KINDS, zones: WORLD_ZONES,
      dates: DATES.map(({ key, name, kind, on }) => ({ key, name, kind, kindLabel: DATE_KINDS[kind], on })), limits: { ...R.RH_LIMITS, ...DADOS_LIMITS },
    })));
  }

  /** O que espera o painel: comunicados aguardando aprovação e sugestões novas. */
  async function pending(tenantId) {
    return {
      posts: await count("SELECT COUNT(*) AS n FROM tvcorp_posts WHERE tenant_id = ? AND status = 'pending'", [tenantId]),
      suggestions: await count("SELECT COUNT(*) AS n FROM tvcorp_suggestions WHERE tenant_id = ? AND status = 'pending'", [tenantId]),
    };
  }

  /* ================================================================ o celular do funcionário (/tvc/<token>) */
  async function mobileState(m, whoName) {
    const tenantId = Number(m.tenant_id); const officeId = num(m.office_id);
    const s = await settings(tenantId); const t = now(); const day = dayOf(t, s.tz);
    const office = officeId ? await db.get('SELECT id, name FROM telas_offices WHERE id = ? AND tenant_id = ?', [officeId, tenantId]) : null;
    const posts = (await db.all("SELECT * FROM tvcorp_posts WHERE tenant_id = ? AND status = 'ok' ORDER BY id DESC LIMIT 500", [tenantId]))
      .filter((p) => R.postActive(p, t) && R.postHits(p, { officeId })).slice(0, 50);
    const acked = whoName && posts.length ? new Map((await db.all(`SELECT post_id, at FROM tvcorp_post_acks WHERE tenant_id = ? AND who_key = ? AND post_id IN (${posts.map(() => '?').join(',')})`, [tenantId, R.whoKey(whoName), ...posts.map((p) => p.id)])).map((r) => [Number(r.post_id), Number(r.at)])) : new Map();
    const people = await peopleOf(tenantId, officeId);
    const widgets = (await db.all('SELECT * FROM tvcorp_widgets WHERE tenant_id = ? ORDER BY id', [tenantId])).map(widgetDto);
    return {
      serverTime: t, today: day.ymd, name: m.name, office: office?.name || null,
      posts: posts.map((p) => ({ id: Number(p.id), category: p.category, header: R.POST_CATEGORIES[p.category] || 'Comunicado', title: p.title, text: p.body || '', qr: p.qr_url || null, needsAck: Boolean(Number(p.needs_ack)), ackedAt: acked.get(Number(p.id)) ?? null, createdAt: Number(p.created_at) })),
      birthdays: R.birthdaysIn(people, day.ymd, 7).slice(0, 60).map((p) => ({ name: R.displayName(p.name, s.fullNames), day: Number(p.bday_day), month: Number(p.bday_month), sector: p.sector || '', today: p.date === day.ymd })),
      tenure: R.tenureIn(people, day.ymd, 7).slice(0, 30).map((p) => ({ name: R.displayName(p.name, s.fullNames), years: p.years, text: R.yearsText(p.years), date: p.date })),
      welcome: R.newHires(people, day.ymd, 15).slice(0, 30).map((p) => ({ name: R.displayName(p.name, s.fullNames), sector: p.sector || '' })),
      events: widgets.filter((w) => w.kind === 'countdown' && w.data.at > t - 86400_000).map((w) => ({ title: w.data.title, at: w.data.at, text: w.data.text || '' })).sort((a, b) => a.at - b.at).slice(0, 10),
      dates: upcomingDates(day.ymd, 30, s.dates).slice(0, 10).map((d) => ({ name: d.name, date: d.date, kind: DATE_KINDS[DATES.find((x) => x.key === d.key)?.kind] || '' })),
      campaigns: datesOn(day.ymd, s.dates).filter((d) => d.until).map((d) => d.name),
      menu: widgets.filter((w) => w.kind === 'menu').map((w) => menuToday(w, day)).filter(Boolean),
      safety: widgets.filter((w) => w.kind === 'safety').map((w) => safetyOf(w, day.ymd)),
      suggest: { kinds: R.SUGGESTION_KINDS, max: R.RH_LIMITS.suggestion },
    };
  }

  function mountMobile(app, { headers = TVC_HEADERS } = {}) {
    const page = (file, type) => (_req, res) => { res.set({ ...headers, 'Content-Type': type }).sendFile(path.join(pageDir, file)); };
    app.get('/tvc/tvc.js', page('tvc.js', 'text/javascript; charset=utf-8'));
    app.get('/tvc/tvc.css', page('tvc.css', 'text/css; charset=utf-8'));
    app.get('/tvc/:token([A-Za-z0-9_-]{32,64})', page('index.html', 'text/html; charset=utf-8'));
    const readPerIp = createLimiter({ windowMs: 60_000, max: Number(process.env.TVC_READ_PER_IP_MIN) || 60, maxKeys: 100_000, now });
    const writePerIp = createLimiter({ windowMs: 60_000, max: Number(process.env.TVC_WRITE_PER_IP_MIN) || 10, maxKeys: 100_000, now });
    const suggestPerLink = createLimiter({ windowMs: 3_600_000, max: Number(process.env.TVC_SUGGEST_PER_LINK_HOUR) || 60, maxKeys: 50_000, now });
    const GONE = 'Endereço desligado. Peça o endereço novo à comunicação da empresa.';
    const guard = (limiter) => ah(async (req, res, next) => {
      noStore(res);
      if (!limiter.hit(ipKey(ipOf(req) || '-'))) return res.status(429).json({ error: 'Muitos pedidos em pouco tempo. Aguarde um minuto.' });
      const tok = /^Bearer ([A-Za-z0-9_-]{32,64})$/.exec(req.get('authorization') || '')?.[1];
      const m = tok ? await db.get('SELECT * FROM tvcorp_mobile WHERE token_hash = ? AND revoked_at IS NULL', [sha256(tok)]) : null;
      const office = m?.office_id ? await db.get('SELECT * FROM telas_offices WHERE id = ? AND tenant_id = ?', [m.office_id, m.tenant_id]) : null;
      if (!m || (m.office_id && !office) || !(await available(Number(m.tenant_id)))) return res.status(401).json({ error: GONE });
      req.mobile = m; req.tenantId = Number(m.tenant_id);
      next();
    });
    const whoOf = (req) => { try { const w = decodeURIComponent(req.get('x-tvc-who') || ''); return w.trim() ? R.cleanWho(w) : null; } catch { return null; } };
    app.get('/api/tvc', guard(readPerIp), ah(async (req, res) => res.json(await mobileState(req.mobile, whoOf(req)))));
    app.post('/api/tvc/ack/:postId', guard(writePerIp), ah(async (req, res) => {
      const w = R.cleanWho(req.body?.who); const t = now();
      const p = await db.get('SELECT * FROM tvcorp_posts WHERE id = ? AND tenant_id = ?', [idOf(req.params.postId, 'Comunicado'), req.tenantId]);
      if (!p || !Number(p.needs_ack) || !R.postActive(p, t) || !R.postHits(p, { officeId: num(req.mobile.office_id) })) throw fail(404, 'Comunicado não encontrado (encerrado ou de outra unidade).');
      await db.run('INSERT INTO tvcorp_post_acks(tenant_id,post_id,who,who_key,at) VALUES(?,?,?,?,?) ON CONFLICT (post_id, who_key) DO NOTHING', [req.tenantId, p.id, w, R.whoKey(w), t]);
      const r = await db.get('SELECT at FROM tvcorp_post_acks WHERE post_id = ? AND who_key = ?', [p.id, R.whoKey(w)]);
      res.json({ ok: true, ackedAt: Number(r.at) });
    }));
    app.post('/api/tvc/suggest', guard(writePerIp), ah(async (req, res) => {
      const s = R.cleanSuggestion(req.body);
      if (!suggestPerLink.hit(String(req.mobile.id))) throw fail(429, 'Muitas sugestões por este endereço. Tente mais tarde.');
      await under("SELECT COUNT(*) AS n FROM tvcorp_suggestions WHERE tenant_id = ? AND status = 'pending'", [req.tenantId], R.RH_LIMITS.suggestionsPending, 'A caixa de sugestões está cheia. Tente mais tarde.');
      const id = await db.insert('INSERT INTO tvcorp_suggestions(tenant_id,office_id,mobile_id,kind,text,who,status,created_at) VALUES(?,?,?,?,?,?,?,?)', [req.tenantId, num(req.mobile.office_id), req.mobile.id, s.kind, s.text, s.who, 'pending', now()]);
      // a auditoria sem IP (a sugestão é anônima por padrão) e sem o texto
      await audit({ username: `celular: ${line(req.mobile.name, 40)}`.slice(0, 64), action: 'POST /api/tvc/suggest', detail: `tvcorp: ${R.SUGGESTION_KINDS[s.kind].toLowerCase()} recebida pelo celular (#${id}${s.who ? '' : ', anônima'})`, status: 201, ip: null, tenantId: req.tenantId });
      res.status(201).json({ id: Number(id), image: true });
    }));
    const imageBody = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: DADOS_LIMITS.suggestImageBytes });
    app.put('/api/tvc/suggest/:id/image', guard(writePerIp), imageBody, ah(async (req, res) => {
      const s = await db.get('SELECT * FROM tvcorp_suggestions WHERE id = ? AND tenant_id = ? AND mobile_id = ?', [idOf(req.params.id, 'Sugestão'), req.tenantId, req.mobile.id]);
      if (!s || s.status !== 'pending' || s.media_file || now() - Number(s.created_at) > DADOS_LIMITS.imageWindowMs) throw fail(404, 'Sugestão não encontrada (ou a imagem já foi enviada).');
      const jpg = await imageFrom(req.body, DADOS_LIMITS.suggestImageBytes);
      const name = await putFile('sug', jpg);
      await db.run('UPDATE tvcorp_suggestions SET media_file = ? WHERE id = ? AND media_file IS NULL', [name, s.id]);
      res.json({ ok: true });
    }));
  }

  /* ================================================================ link da unidade (família F11) */
  function mountOffice(app, { office, gestorOnly, note }) {
    const corp = (req, res, next) => (isCorpOffice(req.office) ? next() : res.status(403).json({ error: 'Esta aba é das unidades da TV Corporativa.' }));
    const G = [office, gestorOnly, corp];
    const P = '/api/reparticao/tvcorp';
    const csvBody = express.text({ type: ['text/csv', 'text/plain', 'application/csv'], limit: R.RH_LIMITS.importBytes });
    const mine = async (req, table, id, what) => {
      const row = await own(table, id, req.tenantId, what);
      if (Number(row.office_id) !== Number(req.office.id)) throw fail(404, `${what} não encontrad${MASC.has(what) ? 'o' : 'a'}.`);
      return row;
    };
    app.get(P, G, ah(async (req, res) => {
      const s = await settings(req.tenantId); const t = now(); const day = dayOf(t, s.tz).ymd;
      const [people, posts, devices] = await Promise.all([
        db.all('SELECT * FROM tvcorp_people WHERE tenant_id = ? AND office_id = ? ORDER BY name, id', [req.tenantId, req.office.id]),
        db.all('SELECT * FROM tvcorp_posts WHERE tenant_id = ? AND office_id = ? ORDER BY id DESC LIMIT 200', [req.tenantId, req.office.id]),
        db.all('SELECT id, name, last_seen FROM telas_devices WHERE tenant_id = ? AND office_id = ? AND revoked_at IS NULL ORDER BY name, id', [req.tenantId, req.office.id]),
      ]);
      const acks = await ackCounts(req.tenantId, posts.map((p) => Number(p.id)));
      res.json({
        serverTime: t, today: day, office: { id: Number(req.office.id), name: req.office.name }, approval: s.approval, categories: R.POST_CATEGORIES,
        people: people.map((p) => personDto(p, s.fullNames)), birthdaysWeek: R.birthdaysIn(people, day, 7).map((p) => ({ ...personDto(p, s.fullNames), date: p.date })),
        posts: posts.map((p) => postDto(p, acks.get(Number(p.id)) || 0)),
        devices: devices.map((d) => ({ id: Number(d.id), name: d.name, lastSeen: num(d.last_seen), online: d.last_seen != null && t - Number(d.last_seen) < 120_000 })),
      });
    }));
    app.post(`${P}/posts`, G, ah(async (req, res) => {
      const s = await settings(req.tenantId);
      const row = await createPost(req.tenantId, { ...req.body, scope: { kind: 'all' } }, { by: req.by, via: 'unidade', officeId: Number(req.office.id), pending: s.approval });
      await note(req, 'POST /api/reparticao/tvcorp/posts', `tvcorp: comunicado "${row.title}" ${s.approval ? 'enviado para aprovação' : 'publicado'} na unidade (#${row.id})`, s.approval ? 202 : 201);
      res.status(s.approval ? 202 : 201).json(postDto(row));
    }));
    app.patch(`${P}/posts/:id`, G, ah(async (req, res) => {
      const cur = await mine(req, 'tvcorp_posts', req.params.id, 'Comunicado');
      const s = await settings(req.tenantId);
      const { scope: _s, scope_data: _d, ...p } = R.cleanPost(req.body, { partial: true, now: now() });
      if (s.approval) Object.assign(p, { status: 'pending', reason: null }); // mexeu: volta para a aprovação
      if (Object.keys(p).length) await db.run(`UPDATE tvcorp_posts SET ${Object.keys(p).map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND tenant_id = ?`, [...Object.values(p), now(), cur.id, req.tenantId]);
      await note(req, 'PATCH /api/reparticao/tvcorp/posts', `tvcorp: comunicado "${cur.title}" alterado na unidade (#${cur.id})`);
      res.json(postDto(await db.get('SELECT * FROM tvcorp_posts WHERE id = ?', [cur.id])));
    }));
    app.delete(`${P}/posts/:id`, G, ah(async (req, res) => {
      const cur = await mine(req, 'tvcorp_posts', req.params.id, 'Comunicado');
      await deletePost(req.tenantId, cur.id);
      await note(req, 'DELETE /api/reparticao/tvcorp/posts', `tvcorp: comunicado "${cur.title}" apagado na unidade (#${cur.id})`);
      res.json({ ok: true });
    }));
    app.get(`${P}/posts/:id/acks`, G, ah(async (req, res) => res.json(await acksOf(req.tenantId, await mine(req, 'tvcorp_posts', req.params.id, 'Comunicado')))));
    app.post(`${P}/people`, G, ah(async (req, res) => {
      const p = R.cleanPerson({ ...req.body, officeId: req.office.id }, { today: dayOf(now()).ymd });
      p.photo_consent = 0; // a foto é só pelo painel da empresa
      await under('SELECT COUNT(*) AS n FROM tvcorp_people WHERE tenant_id = ?', [req.tenantId], R.RH_LIMITS.people, `Limite de ${R.RH_LIMITS.people} pessoas atingido.`);
      const id = await savePerson(req.tenantId, null, p);
      await note(req, 'POST /api/reparticao/tvcorp/people', `tvcorp: pessoa #${id} cadastrada na unidade`, 201);
      res.status(201).json(personDto(await db.get('SELECT * FROM tvcorp_people WHERE id = ?', [id])));
    }));
    app.patch(`${P}/people/:id`, G, ah(async (req, res) => {
      const cur = await mine(req, 'tvcorp_people', req.params.id, 'Pessoa');
      const { office_id: _o, photo_consent: _c, ...p } = R.cleanPerson(req.body, { partial: true, today: dayOf(now()).ymd });
      if (req.body?.photoConsent === false) p.photo_consent = 0; // retirar o consentimento vale de qualquer lugar
      if (Object.keys(p).length) await savePerson(req.tenantId, cur, p);
      await note(req, 'PATCH /api/reparticao/tvcorp/people', `tvcorp: pessoa #${cur.id} alterada na unidade`);
      res.json(personDto(await db.get('SELECT * FROM tvcorp_people WHERE id = ?', [cur.id])));
    }));
    app.delete(`${P}/people/:id`, G, ah(async (req, res) => {
      const cur = await mine(req, 'tvcorp_people', req.params.id, 'Pessoa');
      await deletePerson(req.tenantId, cur);
      await note(req, 'DELETE /api/reparticao/tvcorp/people', `tvcorp: pessoa #${cur.id} apagada na unidade`);
      res.json({ ok: true });
    }));
    app.post(`${P}/people/import`, G, csvBody, ah(async (req, res) => {
      const csv = typeof req.body === 'string' ? req.body : typeof req.body?.csv === 'string' ? req.body.csv : '';
      const out = await importPeople(req.tenantId, csv, { forceOffice: Number(req.office.id) });
      await note(req, 'POST /api/reparticao/tvcorp/people/import', `tvcorp: planilha importada na unidade (${out.added} nova(s), ${out.updated} atualizada(s))`);
      res.json(out);
    }));
  }

  /* ================================================================ integração (chave de API do cliente) */
  function mountApi(app, { apiKey }) {
    const perTenant = createLimiter({ windowMs: 60_000, max: Number(process.env.TVCORP_API_PER_MIN) || 60, maxKeys: 50_000, now });
    const A = [apiKey, (req, res, next) => { noStore(res); return perTenant.hit(String(req.tenantId)) ? next() : res.status(429).json({ error: 'Muitos pedidos por minuto.' }); }];
    const by = (req) => `api${req.apiName ? `: ${line(req.apiName, 40)}` : ''}`;
    app.post('/api/tvcorp-api/posts', A, ah(async (req, res) => {
      const officeId = req.apiOfficeId ?? (req.body?.officeId == null || req.body.officeId === '' ? null : idOf(req.body.officeId, 'Unidade'));
      await officeOk(req.tenantId, officeId);
      const s = await settings(req.tenantId);
      const row = await createPost(req.tenantId, req.body, { by: by(req), via: 'api', officeId, pending: s.approval && req.apiOfficeId != null });
      await audit({ username: by(req).slice(0, 64), action: 'POST /api/tvcorp-api/posts', detail: `tvcorp: comunicado "${row.title}" publicado pela integração (#${row.id})`, status: 201, ip: ipOf(req), tenantId: req.tenantId });
      res.status(201).json(postDto(row));
    }));
    app.post('/api/tvcorp-api/kpis/:id/value', A, ah(async (req, res) => {
      const k = await own('tvcorp_kpis', req.params.id, req.tenantId, 'Indicador');
      if (!['api', 'manual'].includes(k.source)) throw fail(409, 'Este indicador é lido de uma planilha ou JSON: mude a fonte para "Sistema da empresa (API)".');
      const v = F.parseNumber(req.body?.value);
      if (v == null) throw fail(400, 'Valor: um número.');
      const at = req.body?.at == null ? now() : Math.round(Number(req.body.at));
      if (!Number.isFinite(at) || at > now() + 300_000 || at < now() - 400 * 86400_000) throw fail(400, 'Hora do valor inválida.');
      await setKpiValue(k, v, at);
      res.json(kpiDto(await db.get('SELECT * FROM tvcorp_kpis WHERE id = ?', [k.id])));
    }));
  }

  /* ================================================================ dataFor: os itens prontos para o signage */
  async function peopleOf(tenantId, officeId, scope = 'office') {
    return officeId && scope !== 'all'
      ? db.all('SELECT * FROM tvcorp_people WHERE tenant_id = ? AND active = 1 AND (office_id = ? OR office_id IS NULL) ORDER BY name, id', [tenantId, officeId])
      : db.all('SELECT * FROM tvcorp_people WHERE tenant_id = ? AND active = 1 ORDER BY name, id', [tenantId]);
  }
  const photoOf = (p) => (photoUrl && p.photo && Number(p.photo_consent) && /^[0-9a-f]{64}$/.test(p.photo_sha || '') ? (() => { const url = photoUrl(p.photo); return /^https:\/\//.test(url || '') ? { url, sha256: p.photo_sha, bytes: Number(p.photo_bytes) } : null; })() : null);
  function menuToday(w, day) {
    const items = w.data.days?.[String(day.weekday)] || [];
    if (!items.length) return null;
    return { title: w.data.title || 'Cardápio do dia', day: day.ymd, weekday: WEEK[day.weekday], items: items.map((x) => ({ name: x.name, ...(w.data.showPrice && x.price != null ? { price: x.price } : {}), ...(x.note ? { note: x.note } : {}) })) };
  }
  function safetyOf(w, ymd) {
    const last = w.data.lastAccident;
    const days = Math.max(0, Math.round((Date.UTC(...ymd.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0))) - Date.UTC(...last.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)))) / 86400_000));
    return { title: w.data.title || 'Dias sem acidente', days, record: Math.max(Number(w.data.record) || 0, days), goal: w.data.goal ?? null, since: last };
  }
  const fresh = (f) => f && Number(f.enabled) && f.fetched_at && now() - Number(f.fetched_at) <= F.FEED_LIMITS.staleMs ? j(f.cache, null) : null;
  const refOf = (ref) => {
    if (typeof ref === 'string') { const [kind, id] = ref.split(':'); return { kind, id: id ? Number(id) : null, params: {} }; }
    return { kind: ref?.kind ?? ref?.ref_kind, id: ref?.id ?? ref?.ref_id ?? null, params: j(ref?.params, {}) || {} };
  };
  /**
   * O item de um "automático" da playlist (contrato §4.1), pronto, ou null (sem dado: o item sai da playlist). ref:
   * 'birthdays' | 'welcome' | 'tenure' | 'dates' | 'news:<id>' | 'quotes:<id>' | 'weather[:<id>]' | 'traffic:<id>' |
   * 'kpi:<id>' | 'post[:<id>]' | 'widget:<id>' | 'menu[:<id>]', ou { kind|ref_kind, id|ref_id, params }. ctx (opcional,
   * para o alcance dos comunicados): { deviceId, groupIds, regionId }. 'post' sem id devolve a LISTA (item[]).
   */
  async function dataFor(tenantId, officeId, ref, ctx = {}) {
    tenantId = Number(tenantId); officeId = officeId == null ? null : Number(officeId);
    const { kind, id, params } = refOf(ref);
    const s = await settings(tenantId); const t = now(); const day = dayOf(t, s.tz);
    const max = (d, hi) => Math.min(hi, Math.max(1, Number(params.max) || d));
    switch (kind) {
      case 'birthdays': {
        const range = ['day', 'week', 'month'].includes(params.range) ? params.range : 'day';
        const span = range === 'day' ? 1 : range === 'week' ? 7 : new Date(Date.UTC(+day.ymd.slice(0, 4), +day.ymd.slice(5, 7), 0)).getUTCDate() - +day.ymd.slice(8) + 1;
        const list = R.birthdaysIn(await peopleOf(tenantId, officeId, params.scope), day.ymd, span).slice(0, max(30, 60));
        if (!list.length) return null;
        return {
          id: `w:birthdays${range === 'day' ? '' : `-${range}`}`, kind: 'birthdays', title: range === 'day' ? 'Aniversariantes do dia' : range === 'week' ? 'Aniversariantes da semana' : 'Aniversariantes do mês',
          people: list.map((p) => { const ph = photoOf(p); return { name: R.displayName(p.name, s.fullNames), day: Number(p.bday_day), month: Number(p.bday_month), sector: p.sector || '', initials: R.initials(p.name), ...(ph ? { photo: ph } : {}) }; }),
        };
      }
      case 'welcome': {
        const list = R.newHires(await peopleOf(tenantId, officeId, params.scope), day.ymd, Math.min(90, Number(params.days) || 30)).slice(0, 8);
        if (!list.length) return null;
        return { id: 'w:welcome', kind: 'slide', template: 'boas-vindas', fields: { title: list.length === 1 ? 'Seja bem-vindo(a)!' : 'Sejam bem-vindos!', text: list.map((p) => `${R.displayName(p.name, s.fullNames)}${p.sector ? ` · ${p.sector}` : ''}`).join('\n') } };
      }
      case 'tenure': {
        const list = R.tenureIn(await peopleOf(tenantId, officeId, params.scope), day.ymd, Math.min(31, Number(params.days) || 7)).slice(0, 8);
        if (!list.length) return null;
        return { id: 'w:tenure', kind: 'slide', template: 'reconhecimento', fields: { title: 'Tempo de casa', text: list.map((p) => `${R.displayName(p.name, s.fullNames)} · ${R.yearsText(p.years)}`).join('\n') } };
      }
      case 'dates': {
        const list = datesOn(day.ymd, s.dates).sort((a, b) => Number(Boolean(a.until)) - Number(Boolean(b.until))); // a data do dia antes da campanha do mês
        if (!list.length) return null;
        return { id: `w:dates-${day.ymd}`, kind: 'slide', template: 'data-comemorativa', fields: { title: list[0].name, text: list.slice(1, 8).map((d) => d.name).join('\n') } };
      }
      case 'news': case 'quotes': case 'traffic': {
        if (!id) return null;
        const f = await db.get('SELECT * FROM tvcorp_feeds WHERE id = ? AND tenant_id = ? AND kind = ?', [id, tenantId, kind === 'news' ? 'rss' : kind]);
        const c = fresh(f);
        if (!c || !c.items?.length) return null;
        if (kind === 'quotes') return { id: `q${id}`, kind: 'quotes', source: SOURCE_SAFE(c.source), note: c.note || 'Valores de referência', at: c.at, items: c.items.map((i) => ({ label: i.code, name: i.name, value: i.sell ?? i.buy, change: i.change ?? null, prefix: 'R$ ', decimals: i.code === 'JPY' ? 4 : i.code === 'BTC' ? 0 : 2, at: i.at ?? null })) };
        return { id: `${kind === 'news' ? 'n' : 't'}${id}`, kind: 'news', title: kind === 'traffic' ? 'Trânsito' : f.name, source: SOURCE_SAFE(c.source), at: c.at, items: c.items.slice(0, max(8, 15)).map((i) => ({ title: i.title, source: SOURCE_SAFE(c.source), at: i.at ?? null, ...(i.link ? { qr: i.link } : {}) })) };
      }
      case 'weather': {
        let f = null;
        if (id) f = await db.get("SELECT * FROM tvcorp_feeds WHERE id = ? AND tenant_id = ? AND kind = 'weather'", [id, tenantId]);
        else {
          const list = await db.all("SELECT * FROM tvcorp_feeds WHERE tenant_id = ? AND kind = 'weather' AND enabled = 1 ORDER BY id", [tenantId]);
          f = list.find((x) => officeId != null && (j(x.config, {}).offices || []).includes(officeId)) || list.find((x) => !(j(x.config, {}).offices || []).length) || null;
        }
        const c = fresh(f);
        if (!c) return null;
        return { id: `c${f.id}`, kind: 'weather', city: c.city, uf: c.uf, tempC: c.tempC, min: c.min, max: c.max, text: c.text, cond: c.cond, hasNow: c.hasNow, source: SOURCE_SAFE(c.source), at: c.at, days: c.days || [] };
      }
      case 'kpi': {
        if (!id) return null;
        const k = await db.get('SELECT * FROM tvcorp_kpis WHERE id = ? AND tenant_id = ?', [id, tenantId]);
        if (!k || k.value == null || (k.office_id != null && officeId != null && Number(k.office_id) !== officeId)) return null;
        const pts = await db.all('SELECT value FROM tvcorp_kpi_points WHERE tenant_id = ? AND kpi_id = ? ORDER BY at DESC LIMIT 30', [tenantId, id]);
        const d = kpiDto(k);
        return { id: `k${id}`, kind: 'kpi', name: d.name, value: d.value, target: d.target, unit: d.unit, band: d.band, direction: d.direction, at: d.updatedAt, points: pts.map((p) => Number(p.value)).reverse() };
      }
      case 'post': {
        const ctxFull = { officeId, ...ctx };
        const toItem = (p) => ({ id: `p${p.id}`, kind: 'post', category: p.category, header: R.POST_CATEGORIES[p.category] || 'Comunicado', template: p.category, title: p.title, body: p.body || '', date: Number(p.created_at), ...(p.qr_url ? { qr: p.qr_url } : {}), ...(p.media_id ? { mediaId: Number(p.media_id) } : {}), needsAck: Boolean(Number(p.needs_ack)) });
        if (id) {
          const p = await db.get('SELECT * FROM tvcorp_posts WHERE id = ? AND tenant_id = ?', [id, tenantId]);
          return p && R.postActive(p, t) && R.postHits(p, ctxFull) ? toItem(p) : null;
        }
        const cats = Array.isArray(params.categories) ? params.categories : null;
        const list = (await db.all("SELECT * FROM tvcorp_posts WHERE tenant_id = ? AND status = 'ok' ORDER BY id DESC LIMIT 500", [tenantId]))
          .filter((p) => R.postActive(p, t) && R.postHits(p, ctxFull) && (!cats || cats.includes(p.category))).slice(0, max(20, 60)).map(toItem);
        return list.length ? list : null;
      }
      case 'widget': case 'menu': case 'countdown': case 'safety': case 'worldclock': {
        let w = null;
        if (id) w = await db.get('SELECT * FROM tvcorp_widgets WHERE id = ? AND tenant_id = ?', [id, tenantId]);
        else if (kind !== 'widget') w = await db.get('SELECT * FROM tvcorp_widgets WHERE tenant_id = ? AND kind = ? ORDER BY id LIMIT 1', [tenantId, kind]);
        if (!w || (kind !== 'widget' && w.kind !== kind)) return null;
        const d = widgetDto(w);
        if (d.kind === 'menu') { const m = menuToday(d, day); return m ? { id: `m${d.id}`, kind: 'menu', ...m } : null; }
        if (d.kind === 'countdown') return (d.data.until || d.data.at) > t - 86400_000 ? { id: `w${d.id}`, kind: 'countdown', title: d.data.title, target: d.data.at, ...(d.data.until ? { until: d.data.until } : {}), text: d.data.text || '' } : null;
        if (d.kind === 'safety') return { id: `w${d.id}`, kind: 'safety', ...safetyOf(d, day.ymd) };
        if (d.kind === 'worldclock') return { id: `w${d.id}`, kind: 'worldclock', clocks: d.data.zones.map((z) => ({ tz: z, label: ZONE.get(z)?.label || z })) };
        // DIGITAL ISP: os gadgets novos
        if (d.kind === 'weather') {
          const wx = await dataFor(tenantId, officeId, { kind: 'weather', id: d.data.feedId || null, params: {} });
          return wx ? { ...wx, id: `w${d.id}`, ...(d.data.title ? { title: d.data.title } : {}), days: (wx.days || []).slice(0, d.data.days || 4) } : null;
        }
        if (d.kind === 'clock') return { id: `w${d.id}`, kind: 'clock', face: d.data.face, tz: d.data.tz || s.tz, label: d.data.label || '', seconds: Boolean(d.data.seconds), date: d.data.date !== false };
        if (d.kind === 'agenda') {
          const next = (d.data.events || []).filter((e) => e.date >= day.ymd).slice(0, GADGET_LIMITS.agendaShown);
          return next.length ? { id: `w${d.id}`, kind: 'agenda', title: d.data.title, today: day.ymd, events: next } : null;
        }
        if (d.kind === 'reviews') return { id: `w${d.id}`, kind: 'reviews', title: d.data.title, items: d.data.items, ...(d.data.qr ? { qr: d.data.qr } : {}) };
        if (d.kind === 'dashboard') {
          const items = [];
          for (const kid of d.data.kpis || []) { const k = await dataFor(tenantId, officeId, { kind: 'kpi', id: kid, params: {} }); if (k) items.push({ name: k.name, value: k.value, target: k.target, unit: k.unit, band: k.band }); }
          return items.length ? { id: `w${d.id}`, kind: 'dashboard', title: d.data.title, items } : null;
        }
        if (d.kind === 'directions') return { id: `w${d.id}`, kind: 'directions', ...d.data };
        if (d.kind === 'web') return { id: `w${d.id}`, kind: 'web', url: d.data.url, refreshMin: d.data.refreshMin || 0 };
        return null;
      }
      default: return null;
    }
  }

  /* ================================================================ limpeza */
  async function prune(t = now()) {
    const old = await db.all('SELECT id, media_file FROM tvcorp_suggestions WHERE created_at < ?', [t - DADOS_LIMITS.suggestKeepDays * 86400_000]);
    for (const s of old) { await removeFile(s.media_file); await db.run('DELETE FROM tvcorp_suggestions WHERE id = ?', [s.id]); }
    await db.run('DELETE FROM tvcorp_kpi_points WHERE at < ?', [t - F.KPI_LIMITS.keepDays * 86400_000]);
    const gone = t - 400 * 86400_000;
    await db.run('DELETE FROM tvcorp_post_acks WHERE post_id IN (SELECT id FROM tvcorp_posts WHERE valid_to IS NOT NULL AND valid_to < ?)', [gone]);
    await db.run('DELETE FROM tvcorp_posts WHERE valid_to IS NOT NULL AND valid_to < ?', [gone]);
    // sugestão que pediu imagem e nunca a mandou: nada a limpar (a linha fica sem arquivo); arquivos sem dono na pasta:
    if (fileDir) {
      const names = await fs.promises.readdir(fileDir).catch(() => []);
      const ours = names.filter((n) => FILE_RE.test(n));
      if (ours.length) {
        const used = new Set([...(await db.all('SELECT photo AS f FROM tvcorp_people WHERE photo IS NOT NULL')), ...(await db.all('SELECT media_file AS f FROM tvcorp_suggestions WHERE media_file IS NOT NULL'))].map((r) => r.f));
        for (const n of ours) {
          if (used.has(n)) continue;
          const st = await fs.promises.stat(path.join(fileDir, n)).catch(() => null);
          if (st && t - st.mtimeMs > 3600_000) await removeFile(n); // uma hora de folga (envio em andamento)
        }
      }
    }
  }
  /** A unidade saiu: as pessoas, os comunicados, os indicadores e os endereços do celular dela. x = a transação. */
  async function dropOffice(x, tenantId, officeId) {
    const photos = await x.all('SELECT photo FROM tvcorp_people WHERE tenant_id = ? AND office_id = ? AND photo IS NOT NULL', [tenantId, officeId]);
    await x.run('DELETE FROM tvcorp_post_acks WHERE tenant_id = ? AND post_id IN (SELECT id FROM tvcorp_posts WHERE tenant_id = ? AND office_id = ?)', [tenantId, tenantId, officeId]);
    await x.run('DELETE FROM tvcorp_posts WHERE tenant_id = ? AND office_id = ?', [tenantId, officeId]);
    await x.run('DELETE FROM tvcorp_people WHERE tenant_id = ? AND office_id = ?', [tenantId, officeId]);
    await x.run('DELETE FROM tvcorp_kpi_points WHERE tenant_id = ? AND kpi_id IN (SELECT id FROM tvcorp_kpis WHERE tenant_id = ? AND office_id = ?)', [tenantId, tenantId, officeId]);
    await x.run('DELETE FROM tvcorp_kpis WHERE tenant_id = ? AND office_id = ?', [tenantId, officeId]);
    await x.run('UPDATE tvcorp_mobile SET token_hash = NULL, revoked_at = ? WHERE tenant_id = ? AND office_id = ? AND revoked_at IS NULL', [now(), tenantId, officeId]);
    for (const p of photos) await removeFile(p.photo); // depois do commit seria o ideal; a limpeza de órfãos cobre a falha
  }

  function mount(app, deps = {}) {
    if (deps.needs) mountPanel(app, deps);
    mountMobile(app, deps);
    if (deps.office && deps.gestorOnly && deps.note) mountOffice(app, deps);
    if (deps.apiKey) mountApi(app, deps);
  }

  return {
    mount, mountPanel, mountMobile, mountOffice, mountApi, dataFor, tick, prune, dropOffice, pending, readFile, refreshFeed, refreshKpi, settings,
    stop() { clearInterval(timer); },
  };
}

/** Tipo real da imagem pelos primeiros bytes (a extensão e o Content-Type não valem nada). */
export function sniffImage(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.readUInt32BE(0) === 0x89504e47) return 'png';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}
const sha256Buf = (buf) => createHash('sha256').update(buf).digest('hex');
