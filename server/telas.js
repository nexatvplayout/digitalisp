/* NEXA Telas, o modo prefeitura (docs/TELAS.md): a rede de TV box das repartições (escolas, UBS, UPA, hospitais, CRAS…),
   sem comerciais. As regras sem banco ficam em telas-core.js e o catálogo em public/shared/telas-tipos.js; aqui, o banco e
   as rotas. Três portas, cada uma com a sua credencial:

   A TV box (contrato em nexa-ferramentas/telas-contrato.md; token do aparelho em Authorization: Bearer)
     POST /api/telas/activate              chave de acesso de uso único -> token (freio por IP)
     POST /api/telas/recover               app reinstalado: o hwid do aparelho -> token novo da MESMA tela (freio por IP; §32)
     GET  /api/telas/config                a configuração, com rev e If-None-Match -> 304
     POST /api/telas/heartbeat             sinal de vida -> rev, comandos e os alertas em vigor PARA esta tela
     POST /api/telas/commands/:id/done     o comando foi executado
     POST /api/telas/screenshot            captura da tela (JPEG até 400 KB)

   O Painel da Prefeitura (sessão do painel, prefeitura.manage, acesso a todos os canais; a guarda do plano pelo catálogo)
     /api/prefeitura                       GET tudo de uma vez · /status GET o estado das telas (o mapa relê a cada 10 s)
     /api/prefeitura/defaults              PUT o padrão da prefeitura
     /api/prefeitura/municipio             GET, PUT e DELETE o município da prefeitura (UF + código do IBGE) e o contorno dele,
                                           buscado na malha do IBGE e guardado; POST …/outline tenta o contorno de novo
     /api/prefeitura/regions|offices|groups|devices|keys|alerts   o cadastro, as chaves, os comandos e os alertas
     /api/prefeitura/geocode               GET "Localizar no mapa" (o geocodificador do gerador de caracteres)

   O link de controle da repartição (/reparticao/<link> + senha; sessão própria que só vale para AQUELA repartição)
     POST /api/reparticao/login            link + senha -> sessão (freio por IP e por link)
     GET  /api/reparticao/state            as telas da repartição, os avisos e o que ela pode alcançar
     PUT  /api/reparticao/avisos           os avisos e o layout da repartição
     POST /api/reparticao/alerts[/preview] alerta: só as próprias telas; SECOM e Defesa Civil também cidade, regiões e grupos
     POST /api/reparticao/alerts/:id/cancel

   Em toda consulta o cliente (tenant_id) vem da credencial, nunca do pedido. Token, chave, link e PIN: só o hash no banco,
   nada disso em log nem em resposta depois de criado. */
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { db, getSetting, setSetting } from './db.js';
import { config } from './config.js';
import * as T from './tenancy.js';
import { hashPassword, verifyPassword, DUMMY_HASH } from './authcore.js';
import { createLimiter, ipKey } from './ratelimit.js';
import * as C from './telas-core.js';
import { createAppStore } from './telas-app.js'; // o APK do app das telas servido pelo servidor (o update de fábrica)
import { createSenha } from './telas-senha.js'; // chamada de senha (contrato §7.2)
import { createConteudo, settingsOf, cleanSettings } from './telas-conteudo.js'; // cartões, clima, vídeos guardados, aprovação, modo eleitoral, EAS e tela desligada
import { electoralOn, withheld, cleanClass, DEFAULT_CLASS, cleanAlertTexts, alertTextsOf, cleanAlertKind, headerFor } from './telas-conteudo-core.js';
import { createDesaparecidos } from './telas-desaparecidos.js'; // pessoas desaparecidas (contrato §8)
import { createImagemOffline } from './telas-imagem-offline.js'; // a imagem de reserva sem conexão (offline.image, §7.3)
import { createSeguranca } from './telas-seguranca.js'; // botão de pânico e a chave de integração dos emissores conveniados
import { createInterna } from './telas-interna.js'; // comunicação interna: telas internas, avisos com "Li" e códigos de emergência (§25)
import { cleanBrPlace } from './br-places.js'; // a lista de municípios do IBGE (a mesma do seletor UF/Município do painel)
import { createMalha } from './telas-malha.js'; // o contorno do município (malha do IBGE), conferido e simplificado
import { validBbox } from '../public/shared/telas-geo.js';
import { createSealer, newOfficePassword } from './telas-acesso.js'; // o link e a senha do painel da repartição cifrados (o "olho")
import {
  OFFICE_TYPE, OFFICE_TYPE_KEYS, typeLabel, COMMAND_KEYS, LIMITS, OFFLINE_MS, LAYOUT_KEYS, officeModules, officeAlertScopes, scopeHits, deviceStatus, splitAviso, isWide, familyOf, isExternal, issuerOf, alertCategoriesOf, APPROVER_TYPES,
  hasReach, reachOf, reachScope, reachText, REACH_MODES,
} from '../public/shared/telas-tipos.js';

const { fail, line, idOf, sha256 } = C;
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const j = C.parseJson;
const FEATURE = 'prefeitura';
const FEATURE_CORP = 'tvcorp'; // a TV Corporativa (docs/TV-CORPORATIVA.md): a TV box vale com um dos dois modos
/** O Painel da Prefeitura servido também para a TV Corporativa: o que é só da prefeitura fica fora de /api/tvcorp/rede. */
const REDE_BASE = '/api/tvcorp/rede';
const REDE_SKIP = [/^\/api\/tvcorp\/rede\/municipio/, /^\/api\/tvcorp\/rede\/missing/, /^\/api\/tvcorp\/rede\/offices\/:id\/reach/];
/** Um app que registra as rotas /api/prefeitura/* como /api/tvcorp/rede/* (e ignora as outras, já montadas). */
function redeApp(app) {
  const out = Object.create(app);
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
    out[m] = (p, ...h) => {
      if (typeof p !== 'string' || !p.startsWith('/api/prefeitura')) return out;
      const np = REDE_BASE + p.slice('/api/prefeitura'.length);
      if (!REDE_SKIP.some((r) => r.test(np))) app[m](np, ...h);
      return out;
    };
  }
  return out;
}
const PAGE = path.join(config.root, 'public', 'reparticao');
/** Os arquivos da página de controle (cada um sai com os cabeçalhos dela; nada mais da pasta é servido por aqui). */
const PAGE_FILES = ['reparticao.js', 'reparticao.css', 'rep-base.js', 'rep-senha.js', 'rep-cartoes.js', 'rep-alertas.js', 'rep-telas.js', 'rep-secom.js', 'rep-desaparecidos.js', 'rep-seguranca.js', 'rep-interna.js', 'rep-salas.js', 'rep-tvcorp.js'];
const num = (v) => (v == null ? null : Number(v));
const marks = (list) => list.map(() => '?').join(',');
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && Object.prototype.hasOwnProperty.call(o, k)).map((k) => [k, o[k]]));
/** Troca só os campos de keys na config guardada (os outros ficam como estão). */
const patchConfig = (cur, input, keys) => {
  const rest = Object.fromEntries(Object.entries(cur || {}).filter(([k]) => !keys.includes(k)));
  return { ...rest, ...C.mergeConfig(pick(cur, keys), input, keys) };
};

/* ------------------------------------------------------------------ DTOs (nenhum leva hash, token, chave ou PIN) */
const regionDto = (r) => ({ id: Number(r.id), name: r.name, color: r.color || null });
const officeDto = (o) => ({
  id: Number(o.id), name: o.name, type: o.type, address: o.address || '', lat: num(o.lat), lng: num(o.lng), regionId: num(o.region_id),
  respName: o.resp_name || '', respContact: o.resp_contact || '', modules: officeModules(o.type, j(o.modules, {})), config: C.configDto(j(o.config, {})),
  channelId: num(o.channel_id), link: { on: Boolean(o.link_hash), at: num(o.link_at) }, createdAt: num(o.created_at),
  // o "olho": se o link e a senha podem ser mostrados (guardados cifrados); o texto só sai em POST …/access (auditado)
  access: { link: Boolean(o.link_hash && o.link_enc), password: Boolean(o.link_pass), passwordVisible: Boolean(o.link_pass && o.pass_enc) },
  reach: reachOf(o.type, o.alert_reach), hasReach: hasReach(o.type),
  ...(o.n_users === undefined ? {} : { users: Number(o.n_users) || 0 }), // quantos usuários o painel da repartição tem (só na leitura geral)
});
const liveOf = (d) => ({
  lastSeen: num(d.last_seen), onlineSince: num(d.online_since), state: d.state || null, source: d.source || null, net: d.net || null, lastError: d.last_error || null,
  uptimeSec: num(d.uptime_sec), locked: d.locked == null ? null : Boolean(d.locked), appVersion: d.app_version || '', revSeen: d.rev_seen || null, shotAt: num(d.shot_at),
});
const deviceDto = (d, groups = []) => ({
  id: Number(d.id), name: d.name, officeId: Number(d.office_id), lat: num(d.lat), lng: num(d.lng), model: d.model || '', android: d.android || '', serial: d.serial || '',
  ...liveOf(d), revokedAt: num(d.revoked_at), createdAt: num(d.created_at), config: C.configDto(j(d.config, {})), groups,
  internal: Number(d.internal) === 1, sectorId: num(d.sector_id), // comunicação interna (§25)
  recoveredAt: num(d.recovered_at), // a última vez que a tela se reativou sozinha depois de reinstalar o app (§32)
});
const groupDto = (g, deviceIds = []) => ({
  id: Number(g.id), name: g.name, color: g.color || null, description: g.description || '', officeType: g.office_type || null, sort: Number(g.sort) || 0,
  config: pick(j(g.config, {}), C.GROUP_CONFIG_KEYS), deviceIds,
});
const alertStatus = (a, t) => (a.cancelled_at ? 'encerrado' : t >= Number(a.until_at) ? 'terminado' : t < Number(a.starts_at) ? 'agendado' : 'em vigor');
const alertDto = (a, t, delivered = 0) => ({
  class: a.m_class || DEFAULT_CLASS, flag: a.m_flag || null,
  category: a.i_category || null, kind: a.i_kind || null, test: Boolean(Number(a.i_test)), header: a.i_header || null,
  id: Number(a.id), title: a.title, text: a.body || '', level: a.level, sound: Boolean(a.sound), scope: C.scopeFromRow(a), startsAt: Number(a.starts_at), until: Number(a.until_at),
  createdBy: a.created_by || '', officeId: num(a.office_id), cancelledAt: num(a.cancelled_at), cancelledBy: a.cancelled_by || null, createdAt: Number(a.created_at),
  status: alertStatus(a, t), delivered,
});

/**
 * deps: streamOf(tenantId, channelId, req) -> { slug, hls } do canal da repartição (ou do primeiro canal do cliente);
 * channelsOf(tenantId) -> [{ id, slug, name }]; geocode(q); audit(entry) (server/auth.js); ipOf(req); publicUrl(req).
 */
export function createTelas({
  streamOf, channelsOf, geocode, geocodeAddress = null, audit = async () => {}, ipOf = (req) => req.ip, publicUrl, now = () => Date.now(), timers = true,
  // fases 3 e 4: weatherOf(ibge) (server/weather.js), easAiring(tenantId) (o EAS no ar, só leitura), mediaUrl(arquivo, req) e
  // openMedia({ filename }) (os vídeos guardados), hold() (o freio das tarefas de fundo) e notify(tenantId, evento) (o aviso por e-mail)
  weatherOf = null, easAiring = () => [], mediaUrl = () => null, openMedia = null, hold = () => null, notify = null,
  // appStore: o APK do app das telas (server/telas-app.js); nos testes, uma pasta de mentira
  appStore = createAppStore(),
  // as fotos dos casos de pessoa desaparecida (server/telas-desaparecidos.js): { dir, ffmpeg, checkImage, put, remove, url, read, list }
  photos = { dir: path.join(config.dataDir, 'telas', 'desaparecidos'), ffmpeg: config.ffmpeg, put: async () => {}, remove: async () => {}, url: () => null, read: (name) => fs.promises.readFile(path.join(config.dataDir, 'telas', 'desaparecidos', name)) },
  // a imagem de reserva sem conexão (server/telas-imagem-offline.js): o mesmo formato de photos (prefixo "telasimg-")
  offlineImages = { dir: path.join(config.dataDir, 'telas', 'imagens'), ffmpeg: config.ffmpeg, put: async () => {}, remove: async () => {}, url: () => null, read: (name) => fs.promises.readFile(path.join(config.dataDir, 'telas', 'imagens', name)) },
  // o contorno do município: { fetchOutline(código) }. TELAS_IBGE_URL troca o endereço da malha (testes: um servidor local;
  // http só vale para a própria máquina e fora de produção)
  malha = createMalha({ base: process.env.TELAS_IBGE_URL || undefined, allowHttp: !config.production, timeoutMs: Number(process.env.TELAS_IBGE_TIMEOUT_MS) || 8000 }),
  // o alerta de uma repartição de emergência também no ar dos canais (o "Alcance dos alertas" com o EAS marcado):
  // easSend(tenantId, { title, text, level, durationMin, org }, by) -> [{ channelId, id }] e easStop(tenantId, lista, by)
  // (server/index.js, pelo EasHub.manual e takeOff); sem eles, o alcance só vale para as telas
  easSend = null, easStop = null,
  sealer = createSealer(), // a cifra do link e da senha do painel da repartição (server/telas-acesso.js)
  // TV Corporativa (docs/TV-CORPORATIVA.md): tvcorp = createTvcorp (signageFor, recordPlays, mountOffice, dropOffice) e
  // tvcorpDados = createTvcorpDados (mountOffice, dropOffice, prune); sem eles, tudo como antes
  tvcorp = null, tvcorpDados = null,
}) {
  const sessions = C.createOfficeSessions();
  let municipioApi = null; // preenchido em mountPanel (as rotas do município)
  const available = async (tenantId) => (await T.isServing(tenantId)) && ((await T.hasFeature(tenantId, FEATURE).catch(() => false)) || (await T.hasFeature(tenantId, FEATURE_CORP).catch(() => false)));

  /* ---------------------------------------------------------------- leituras guardadas por instantes (o sinal de vida) */
  const SHORT_MS = 2000;
  const memo = new Map(); // chave -> { at, p }
  const cached = (key, fn) => {
    const hit = memo.get(key); const t = Date.now();
    if (hit && t - hit.at < SHORT_MS) return hit.p;
    if (memo.size > 5000) memo.clear();
    const p = fn(); memo.set(key, { at: t, p }); p.catch(() => memo.delete(key));
    return p;
  };
  const forget = (tenantId) => { for (const k of memo.keys()) if (k.endsWith(`:${tenantId}`)) memo.delete(k); };

  /** O padrão da prefeitura: { config (guardada, com o PIN em hash), city: { name, lat, lng, zoom } | null }. */
  const loadDefaults = (tenantId) => cached(`def:${tenantId}`, async () => {
    const v = j(await getSetting(C.settingsKey(tenantId), ''), {});
    let update = null; try { update = C.cleanUpdate(v.update); } catch { /* guardado fora do formato: sem atualização */ }
    // extra: a cidade do clima, o modo eleitoral, a aprovação da SECOM, a ponte com o EAS e o aviso de tela desligada
    return { config: v.config && typeof v.config === 'object' ? v.config : {}, city: v.city && Number.isFinite(v.city.lat) && Number.isFinite(v.city.lng) ? v.city : null, update, extra: settingsOf(v), alertTexts: alertTextsOf(v.alertTexts), missingQr: v.missingQr && typeof v.missingQr === 'object' ? v.missingQr : null }; // alertTexts: o texto sugerido dos tipos de aviso que a prefeitura trocou
  });
  // o alerta com a classificação dele (modo eleitoral) e a marca "sem aprovação" (telas_alert_meta)
  // … e o tipo de aviso, a marca de teste e a linha de cima (telas_alert_info, contrato §9; alerta de antes: sem linha)
  const ALERT_SQL = `SELECT a.*, m.class AS m_class, m.flag AS m_flag, i.category AS i_category, i.kind AS i_kind, i.test AS i_test, i.header AS i_header FROM telas_alerts a
    LEFT JOIN telas_alert_meta m ON m.alert_id = a.id AND m.tenant_id = a.tenant_id LEFT JOIN telas_alert_info i ON i.alert_id = a.id AND i.tenant_id = a.tenant_id`;
  const loadGroups = (tenantId) => cached(`grp:${tenantId}`, () => db.all('SELECT * FROM telas_groups WHERE tenant_id = ? ORDER BY sort, id', [tenantId]));
  const loadAlerts = (tenantId) => cached(`alr:${tenantId}`, () => db.all(`${ALERT_SQL} WHERE a.tenant_id = ? AND a.cancelled_at IS NULL AND a.until_at > ? ORDER BY a.id`, [tenantId, now()]));

  /** Os grupos de uma tela, na ordem deles: os manuais em que ela está e os automáticos do tipo da repartição dela. */
  const groupsFor = (groups, manualIds, officeType) => groups.filter((g) => (g.office_type ? g.office_type === officeType : manualIds.has(Number(g.id))));

  /** Todas as telas não revogadas do cliente com o que o alcance de um alerta olha (repartição, região, ponto e grupos). */
  async function targets(tenantId) {
    const [devs, groups, links] = await Promise.all([
      db.all(`SELECT d.id, d.name, d.office_id, d.lat, d.lng, d.last_seen, d.state, o.name AS o_name, o.type AS o_type, o.region_id AS o_region, o.lat AS o_lat, o.lng AS o_lng
        FROM telas_devices d JOIN telas_offices o ON o.id = d.office_id AND o.tenant_id = d.tenant_id WHERE d.tenant_id = ? AND d.revoked_at IS NULL`, [tenantId]),
      loadGroups(tenantId),
      db.all('SELECT group_id, device_id FROM telas_group_devices WHERE tenant_id = ?', [tenantId]),
    ]);
    const manual = new Map();
    for (const l of links) { const k = Number(l.device_id); if (!manual.has(k)) manual.set(k, new Set()); manual.get(k).add(Number(l.group_id)); }
    return devs.map((d) => ({
      id: Number(d.id), name: d.name, officeId: Number(d.office_id), office: d.o_name, regionId: num(d.o_region),
      lat: d.lat != null && d.lng != null ? Number(d.lat) : num(d.o_lat), lng: d.lat != null && d.lng != null ? Number(d.lng) : num(d.o_lng),
      groups: groupsFor(groups, manual.get(Number(d.id)) || new Set(), d.o_type).map((g) => Number(g.id)), lastSeen: num(d.last_seen), state: d.state || null,
    }));
  }
  /** Quantas telas o alcance pega e quantas estão ligadas agora (a prévia antes de mandar). */
  async function preview(tenantId, scope) {
    const hit = (await targets(tenantId)).filter((d) => scopeHits(scope, d));
    const t = now();
    return { total: hit.length, online: hit.filter((d) => d.lastSeen && t - d.lastSeen <= OFFLINE_MS).length, offices: new Set(hit.map((d) => d.officeId)).size };
  }
  /** Os ids do alcance existem NESTE cliente (região, grupo ou repartição de outro cliente = inexistente). */
  async function assertScope(tenantId, scope) {
    const all = async (table, ids, what) => {
      const rows = await db.all(`SELECT id FROM ${table} WHERE tenant_id = ? AND id IN (${marks(ids)})`, [tenantId, ...ids]);
      if (rows.length !== ids.length) throw fail(400, `${what} inexistente.`);
    };
    if (scope.kind === 'regions') await all('telas_regions', scope.regions, 'Região');
    if (scope.kind === 'groups') await all('telas_groups', scope.groups, 'Grupo');
    if (scope.kind === 'office') await all('telas_offices', [scope.office], 'Repartição');
  }
  /** info: { category, kind, test, header } (contrato §9) ou null (o alerta como os de antes). */
  async function createAlert(tenantId, a, { by, officeId = null, cls = DEFAULT_CLASS, flag = null, info = null }) {
    await assertScope(tenantId, a.scope);
    const { scope, scope_data } = C.scopeToRow(a.scope);
    const t = now();
    // o teste nunca passa por real: o título gravado começa com "TESTE:"
    const title = info?.test && !/^TESTE\b/i.test(a.title) ? `TESTE: ${a.title}`.slice(0, LIMITS.alertTitle) : a.title;
    const id = await db.insert('INSERT INTO telas_alerts(tenant_id,title,body,level,sound,scope,scope_data,starts_at,until_at,created_by,office_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      [tenantId, title, a.body, a.level, a.sound ? 1 : 0, scope, scope_data, a.startsAt, a.until, line(by, 64), officeId, t]);
    if (cls !== DEFAULT_CLASS || flag) await conteudo.setAlertMeta(tenantId, id, { cls, flag });
    if (info && (info.category || info.header || info.test)) {
      await db.run('INSERT INTO telas_alert_info(alert_id,tenant_id,category,kind,test,header) VALUES(?,?,?,?,?,?)', [id, tenantId, info.category || null, info.kind || null, info.test ? 1 : 0, info.header ? line(info.header, 60) : null]);
    }
    forget(tenantId);
    const eas = await alertToEas(tenantId, Number(id), { ...a, title }, { officeId, info, by, t });
    return { alert: alertDto(await db.get(`${ALERT_SQL} WHERE a.id = ? AND a.tenant_id = ?`, [id, tenantId]), t), reach: await preview(tenantId, a.scope), ...(eas ? { eas } : {}) };
  }
  /**
   * O alerta de uma repartição de emergência para o "Alcance da prefeitura" com o EAS marcado na ficha: também no ar de
   * todos os canais do cliente com os Alertas de emergência ligados, pelo alerta manual do EAS (só Severo e Extremo; aviso
   * e teste nunca; alerta agendado para depois também não). Devolve { channels, error? } ou null (não era o caso).
   */
  const easSent = new Map(); // id do alerta -> [{ channelId, id }] (para encerrar junto; some num reinício: o EAS sai no fim do tempo)
  async function alertToEas(tenantId, alertId, a, { officeId, info, by, t }) {
    if (!easSend || !officeId || a.scope?.kind !== 'reach' || a.level === 'info' || info?.test || a.startsAt > t + 60000) return null;
    const o = await db.get('SELECT name, type, alert_reach FROM telas_offices WHERE id = ? AND tenant_id = ?', [officeId, tenantId]);
    if (!o || !reachOf(o.type, o.alert_reach).eas) return null;
    try {
      const list = (await easSend(tenantId, { title: a.title, text: a.body || '', level: a.level, durationMin: Math.max(1, Math.min(1440, Math.round((a.until - Math.max(t, a.startsAt)) / 60000))), org: issuerOf(o.type) || o.name }, by)) || [];
      if (list.length) { if (easSent.size > 5000) easSent.clear(); easSent.set(alertId, list); }
      return { channels: list.length };
    } catch (err) { return { channels: 0, error: line(err?.message || 'O alerta de emergência do canal não saiu.', 200) }; }
  }
  async function cancelAlert(tenantId, id, { by, officeId = undefined }) {
    const cur = await db.get(`SELECT * FROM telas_alerts WHERE id = ? AND tenant_id = ?${officeId === undefined ? '' : ' AND office_id = ?'}`, officeId === undefined ? [id, tenantId] : [id, tenantId, officeId]);
    if (!cur) throw fail(404, 'Alerta não encontrado.');
    const t = now();
    if (!cur.cancelled_at && t < Number(cur.until_at)) await db.run('UPDATE telas_alerts SET cancelled_at = ?, cancelled_by = ? WHERE id = ? AND tenant_id = ?', [t, line(by, 64), cur.id, tenantId]);
    forget(tenantId);
    // encerrado nas telas: sai também do ar dos canais (o que este alerta pôs lá)
    const onAir = easSent.get(Number(cur.id));
    if (onAir && easStop) { easSent.delete(Number(cur.id)); await Promise.resolve(easStop(tenantId, onAir, by)).catch(() => {}); }
    return cur;
  }
  /** Os avisos da repartição passam a ser estes (o pedido aprovado pela SECOM). */
  async function applyAvisos(tenantId, officeId, items) {
    const o = await db.get('SELECT config FROM telas_offices WHERE id = ? AND tenant_id = ?', [officeId, tenantId]);
    if (!o) throw fail(404, 'Repartição não encontrada.');
    const cfg = patchConfig(j(o.config, {}), { tickerItems: items }, ['tickerItems']);
    await db.run('UPDATE telas_offices SET config = ?, updated_at = ? WHERE id = ? AND tenant_id = ?', [JSON.stringify(cfg), now(), officeId, tenantId]);
    forget(tenantId);
    return cfg.tickerItems || [];
  }
  const senha = createSenha({ available, audit, ipOf, publicUrl, now, timers });
  const conteudo = createConteudo({
    loadDefaults, cached, forget, available, channelsOf, weatherOf, easAiring, mediaUrl, openMedia, hold, notify, audit, now, timers,
    applyAvisos, createAlert: (tenantId, a, opts) => createAlert(tenantId, a, opts),
    listImages: (tenantId) => offImg.list(tenantId), // a imagem sem internet de cada nível, junto da lista dos vídeos guardados
    // o caso de desaparecido (ou a cartela policial) de um emissor conveniado, que espera o CCO
    missing: { activate: (tenantId, id) => desap.activate(tenantId, id), reject: (tenantId, id, by) => desap.reject(tenantId, id, by) },
  });
  // "Acesso por API" do plano (a funcionalidade "api" do catálogo): sem ela, a chave de integração não é gerada nem aceita
  const seguranca = createSeguranca({ available, audit, ipOf, now, apiAllowed: (tenantId) => T.hasFeature(tenantId, 'api').catch(() => false) });
  const interna = createInterna({ available, audit, ipOf, publicUrl, forget: (tenantId) => forget(tenantId), now, timers });
  const desap = createDesaparecidos({
    cached, forget, preview, assertScope, photos, now, timers,
    requestApproval: (tenantId, officeId, opts) => conteudo.request(tenantId, officeId, opts), issuerDirect: (tenantId, officeId) => issuerDirect(tenantId, officeId),
    // o QR code padrão da prefeitura fica no padrão da prefeitura (a mesma linha de settings; só a chave missingQr muda)
    tenantQr: {
      get: async (tenantId) => (await loadDefaults(tenantId)).missingQr,
      set: async (tenantId, setting) => {
        const raw = j(await getSetting(C.settingsKey(tenantId), ''), {});
        if (setting) raw.missingQr = setting; else delete raw.missingQr;
        await setSetting(C.settingsKey(tenantId), JSON.stringify(raw));
        forget(tenantId);
      },
    },
  });
  const offImg = createImagemOffline({ cached, forget, own: (...a) => own(...a), images: offlineImages, now });
  const scopeText = (s) => ({ city: 'cidade toda', regions: `${s.regions?.length} região(ões)`, groups: `${s.groups?.length} grupo(s)`, office: `repartição #${s.office}`, radius: `raio de ${s.meters} m`, reach: s.all ? 'alcance da prefeitura: todas as TV box' : `alcance da prefeitura: a repartição, ${s.regions?.length || 0} região(ões) e ${s.groups?.length || 0} grupo(s)` }[s.kind] || s.kind);
  /**
   * O alcance da prefeitura de uma repartição, pronto para o alerta: as regiões e os grupos que sumiram depois de marcados
   * saem (o alerta não falha por eles).
   */
  async function officeReach(tenantId, o) {
    const r = reachOf(o.type, o.alert_reach);
    if (r.mode === 'pick') {
      const has = async (table, ids) => (ids.length ? (await db.all(`SELECT id FROM ${table} WHERE tenant_id = ? AND id IN (${marks(ids)})`, [tenantId, ...ids])).map((x) => Number(x.id)) : []);
      r.regions = await has('telas_regions', r.regions); r.groups = await has('telas_groups', r.groups);
    }
    return r;
  }

  /* ---------------------------------------------------------------- o que se faz numa tela: a mesma regra no Painel da
     Prefeitura (qualquer tela do cliente) e no painel da repartição (só as telas dela; quem chama já conferiu de quem é) */
  const own = async (table, id, tenantId, what) => {
    const row = await db.get(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ?`, [idOf(id), tenantId]);
    if (!row) throw fail(404, `${what} não encontrada.`);
    return row;
  };
  async function dropDevice(x, tenantId, id) {
    await x.run('DELETE FROM telas_group_devices WHERE device_id = ? AND tenant_id = ?', [id, tenantId]);
    await x.run('DELETE FROM telas_commands WHERE device_id = ? AND tenant_id = ?', [id, tenantId]);
    await conteudo.dropDevice(x, tenantId, id); // o histórico de disponibilidade
    await x.run('DELETE FROM telas_devices WHERE id = ? AND tenant_id = ?', [id, tenantId]);
    senha.kick(id); // a conexão de tempo real da chamada de senha
    interna.kick(id); // e a dos códigos de emergência
  }
  /** Os grupos MANUAIS da tela passam a ser estes (os automáticos seguem o tipo da repartição). */
  async function setDeviceGroups(x, tenantId, deviceId, ids) {
    const want = [...new Set((Array.isArray(ids) ? ids : []).map((v) => idOf(v, 'Grupo')))];
    if (want.length) {
      const ok = await x.all(`SELECT id FROM telas_groups WHERE tenant_id = ? AND office_type IS NULL AND id IN (${marks(want)})`, [tenantId, ...want]);
      if (ok.length !== want.length) throw fail(400, 'Grupo inexistente (ou automático: os automáticos seguem o tipo da repartição).');
    }
    await x.run('DELETE FROM telas_group_devices WHERE device_id = ? AND tenant_id = ?', [deviceId, tenantId]);
    for (const g of want) await x.run('INSERT INTO telas_group_devices(group_id,device_id,tenant_id,created_at) VALUES(?,?,?,?)', [g, deviceId, tenantId, now()]);
  }
  /**
   * Altera a tela. full (o Painel da Prefeitura): também a repartição, o ponto no mapa e os grupos, e todos os campos da
   * configuração. Sem full (o gestor da repartição): só o nome e os campos de keys; o resto do pedido não conta.
   */
  async function patchDevice(tenantId, cur, b, { full = false, keys = null } = {}) {
    const name = b.name === undefined ? cur.name : C.cleanName(b.name, 'Nome da tela');
    const officeId = full && b.officeId !== undefined ? (await own('telas_offices', b.officeId, tenantId, 'Repartição')).id : cur.office_id;
    const p = full && (b.lat !== undefined || b.lng !== undefined) ? C.cleanPoint(b.lat, b.lng) : { lat: num(cur.lat), lng: num(cur.lng) };
    const cfg = JSON.stringify(keys ? patchConfig(j(cur.config, {}), b.config, keys) : C.mergeConfig(j(cur.config, {}), b.config));
    await db.tx(async (x) => {
      await x.run('UPDATE telas_devices SET name = ?, office_id = ?, lat = ?, lng = ?, config = ? WHERE id = ? AND tenant_id = ?', [name, officeId, p.lat, p.lng, cfg, cur.id, tenantId]);
      if (full && b.groups !== undefined) await setDeviceGroups(x, tenantId, cur.id, b.groups);
    });
    forget(tenantId);
    if (Number(officeId) !== Number(cur.office_id)) { // mudou de repartição: a chamada de senha e os códigos da outra não são dela
      senha.kick(cur.id); interna.kick(cur.id);
      await db.run('UPDATE telas_devices SET sector_id = NULL WHERE id = ? AND tenant_id = ?', [cur.id, tenantId]); // o setor era da outra
    }
    const groups = (await db.all('SELECT group_id FROM telas_group_devices WHERE device_id = ? AND tenant_id = ?', [cur.id, tenantId])).map((r) => Number(r.group_id));
    return deviceDto(await db.get('SELECT * FROM telas_devices WHERE id = ? AND tenant_id = ?', [cur.id, tenantId]), groups);
  }
  async function queueCommand(tenantId, cur, type, by) {
    if (cur.revoked_at) throw fail(409, 'A tela está revogada.');
    if (!COMMAND_KEYS.includes(type)) throw fail(400, 'Comando inválido.');
    const t = now();
    // o mesmo comando ainda na fila: não empilha (dois cliques em "Reiniciar" = um reinício)
    const same = await db.get('SELECT id FROM telas_commands WHERE device_id = ? AND tenant_id = ? AND type = ? AND sent_at IS NULL AND created_at > ?', [cur.id, tenantId, type, t - 10 * 60_000]);
    const id = same ? same.id : await db.insert('INSERT INTO telas_commands(tenant_id,device_id,type,created_by,created_at) VALUES(?,?,?,?,?)', [tenantId, cur.id, type, line(by, 64), t]);
    return { id: Number(id), type, queued: true };
  }
  async function revokeDevice(tenantId, cur) {
    // o vínculo com o aparelho (hwid) sai junto: a tela revogada não volta sozinha numa reinstalação (§32)
    await db.run('UPDATE telas_devices SET token_hash = NULL, hwid_hash = NULL, revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND tenant_id = ?', [now(), cur.id, tenantId]);
    senha.kick(cur.id); interna.kick(cur.id);
    forget(tenantId);
  }
  async function deleteDevice(tenantId, cur) {
    if (!cur.revoked_at) throw fail(409, 'Revogue a tela antes de excluir.');
    await db.tx((x) => dropDevice(x, tenantId, cur.id));
    await C.removeShot(tenantId, cur.id).catch(() => {});
  }
  /** Chave de acesso de uso único (24 h) para uma TV box nova, já ligada à repartição. A chave aparece UMA vez. */
  async function newAccessKey(tenantId, office, rawName, by) {
    const t = now();
    if (Number((await db.get('SELECT COUNT(*) AS n FROM telas_keys WHERE tenant_id = ? AND used_at IS NULL AND expires_at > ?', [tenantId, t])).n) >= 500) throw fail(409, 'Há chaves de acesso demais esperando uso. Apague as que não vai usar.');
    const name = line(rawName, LIMITS.name);
    let key; let id;
    for (let i = 0; i < 5 && !id; i++) {
      key = C.newKey();
      try { id = await db.insert('INSERT INTO telas_keys(tenant_id,office_id,device_name,key_hash,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?,?)', [tenantId, office.id, name, sha256(key), t + C.KEY_TTL_MS, line(by, 64), t]); } catch (err) { if (i === 4) throw err; }
    }
    return { id: Number(id), key: C.formatKey(key), officeId: Number(office.id), deviceName: name, expiresAt: t + C.KEY_TTL_MS };
  }
  const keyDto = (k) => ({ id: Number(k.id), officeId: Number(k.office_id), deviceName: k.device_name || '', expiresAt: Number(k.expires_at), createdBy: k.created_by || '', createdAt: Number(k.created_at) });
  async function sendShot(res, tenantId, cur) {
    const file = C.shotFile(tenantId, cur.id);
    if (!cur.shot_at || !(await fs.promises.stat(file).catch(() => null))) return res.status(404).json({ error: 'Esta tela ainda não mandou captura.' });
    return res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' }).sendFile(file, { dotfiles: 'allow' });
  }

  /* ---------------------------------------------------------------- emissor conveniado: "pode emitir direto, sem aprovação" */
  const issuerDirect = async (tenantId, officeId) => j((await db.get('SELECT data FROM telas_office_extras WHERE office_id = ? AND tenant_id = ?', [officeId, tenantId]))?.data, {}).direct === true;
  async function setIssuerDirect(tenantId, officeId, on) {
    const cur = await db.get('SELECT data FROM telas_office_extras WHERE office_id = ? AND tenant_id = ?', [officeId, tenantId]);
    const data = j(cur?.data, {}); if (on) data.direct = true; else delete data.direct;
    if (cur) await db.run('UPDATE telas_office_extras SET data = ?, updated_at = ? WHERE office_id = ? AND tenant_id = ?', [JSON.stringify(data), now(), officeId, tenantId]);
    else await db.run('INSERT INTO telas_office_extras(office_id,tenant_id,data,updated_at) VALUES(?,?,?,?)', [officeId, tenantId, JSON.stringify(data), now()]);
  }

  /* ---------------------------------------------------------------- os usuários do painel da repartição */
  const officeUserDto = (u) => ({ id: Number(u.id), username: u.username, name: u.name || '', role: u.role, active: Boolean(u.active), lastLogin: num(u.last_login), createdAt: Number(u.created_at) });
  const usersOf = (tenantId, officeId) => db.all('SELECT * FROM telas_office_users WHERE tenant_id = ? AND office_id = ? ORDER BY username', [tenantId, officeId]);
  const hasUsers = async (tenantId, officeId) => Boolean(await db.get('SELECT id FROM telas_office_users WHERE tenant_id = ? AND office_id = ? LIMIT 1', [tenantId, officeId]));

  /* ================================================================ a TV box */
  const DEVICE_SQL = `SELECT d.*, o.name AS o_name, o.type AS o_type, o.region_id AS o_region, o.lat AS o_lat, o.lng AS o_lng, o.modules AS o_modules, o.config AS o_config,
    o.channel_id AS o_channel, r.name AS r_name
    FROM telas_devices d JOIN telas_offices o ON o.id = d.office_id AND o.tenant_id = d.tenant_id
    LEFT JOIN telas_regions r ON r.id = o.region_id AND r.tenant_id = d.tenant_id`;
  const noStore = (res) => res.set('Cache-Control', 'no-store');

  /** Token do aparelho -> a tela (req.dev). 401 = revogado ou desconhecido (o app apaga o token); 403 = modo desligado. */
  const device = ah(async (req, res, next) => {
    noStore(res);
    const tok = /^Bearer ([A-Za-z0-9_-]{32,64})$/.exec(req.get('authorization') || '')?.[1];
    const row = tok ? await db.get(`${DEVICE_SQL} WHERE d.token_hash = ?`, [sha256(tok)]) : null;
    if (!row || row.revoked_at) return res.status(401).json({ error: 'Token inválido ou revogado.', code: 'revoked' });
    if (!(await available(Number(row.tenant_id)))) return res.status(403).json({ error: 'O NEXA Telas não está disponível para esta prefeitura.', code: 'unavailable' });
    req.dev = row; req.tenantId = Number(row.tenant_id);
    next();
  });

  /** Os grupos da tela (com a config de cada um), na ordem deles. */
  async function deviceGroups(dev) {
    const groups = await loadGroups(Number(dev.tenant_id));
    if (!groups.length) return [];
    const manual = groups.some((g) => !g.office_type)
      ? new Set((await db.all('SELECT group_id FROM telas_group_devices WHERE tenant_id = ? AND device_id = ?', [dev.tenant_id, dev.id])).map((r) => Number(r.group_id))) : new Set();
    return groupsFor(groups, manual, dev.o_type);
  }
  /** O PIN da repartição; sem nenhum, grava um sorteado (só o sal e o hash) e devolve. */
  async function ensureOfficePin(tenantId, officeId) {
    const o = await db.get('SELECT config FROM telas_offices WHERE id = ? AND tenant_id = ?', [officeId, tenantId]);
    const cfg = j(o?.config, {});
    if (cfg.pin?.hash) return cfg.pin;
    cfg.pin = C.pinRecord(C.randomPin());
    await db.run('UPDATE telas_offices SET config = ? WHERE id = ? AND tenant_id = ?', [JSON.stringify(cfg), officeId, tenantId]);
    return cfg.pin;
  }
  /** A configuração do contrato para esta tela, com o rev. */
  /**
   * DIGITAL ISP: sem a cidade nas Configurações, o clima da tela vem da fonte Clima (Notícias e dados) da unidade dela (ou a
   * que vale para todas as unidades). Sem fonte ou sem previsão ainda: null (a zona de clima espera a próxima busca).
   */
  async function weatherOfFeed(tenantId, officeId) {
    if (!weatherOf) return null;
    const list = await cached(`wxf:${tenantId}`, () => db.all("SELECT config FROM tvcorp_feeds WHERE tenant_id = ? AND kind = 'weather' AND enabled = 1 ORDER BY id", [tenantId]).catch(() => []));
    const cfgs = list.map((r) => j(r.config, {}) || {}).filter((c) => /^\d{7}$/.test(String(c.ibge || '')));
    const c = cfgs.find((x) => officeId != null && (x.offices || []).map(Number).includes(officeId)) || cfgs.find((x) => !(x.offices || []).length) || null;
    return c ? conteudo.weather.get(String(c.ibge)) : null;
  }
  async function configFor(dev, req, groups = null) {
    const tenantId = Number(dev.tenant_id);
    const g = groups || await deviceGroups(dev);
    const def = await loadDefaults(tenantId);
    const eff = C.effectiveConfig({
      defaults: def.config, office: j(dev.o_config, {}), officeType: dev.o_type, modules: j(dev.o_modules, {}),
      groups: g.map((x) => j(x.config, {})), device: j(dev.config, {}),
    });
    // o aparelho nunca recebe o hash vazio (a sequência de saída abriria os ajustes sem PIN): sem PIN em nenhum nível, a
    // repartição ganha um sorteado (ninguém o conhece; o painel gera outro e mostra uma vez em Repartições)
    if (!eff.pin?.hash) eff.pin = await ensureOfficePin(tenantId, dev.office_id);
    // fases 3 e 4 (contrato §7.1): o clima segurado, os cartões de hoje, a chamada de senha e os vídeos guardados; no
    // período eleitoral o que é institucional fica retido
    const o = { id: Number(dev.office_id), tenant_id: tenantId, type: dev.o_type, modules: dev.o_modules, name: dev.o_name };
    const electoral = electoralOn(def.extra.electoral, now());
    const [cards, queue, offline, offlineImage, internal] = await Promise.all([
      conteudo.cardsFor(tenantId, o, electoral), senha.contractQueue(o),
      conteudo.offlineFor(tenantId, { officeId: o.id, groupIds: g.map((x) => Number(x.id)) }, req, electoral),
      offImg.imageFor(tenantId, { officeId: o.id, groupIds: g.map((x) => Number(x.id)) }, req), // repartição > grupos > padrão
      interna.internalFor(dev), // §17: só a tela interna (a pública recebe null e a chave não vai)
    ]);
    // TV Corporativa (§4.1): a grade por zonas, só na tela de unidade corporativa que alguma grade pega (senão null: a chave não vai)
    const signage = tvcorp ? await tvcorp.signageFor(tenantId, { id: dev.id, tenant_id: tenantId, office_id: dev.office_id }, { id: Number(dev.office_id), type: dev.o_type, region_id: dev.o_region }, g.map((x) => Number(x.id)), { req })
      .catch((err) => { console.warn('[telas] tv corporativa:', err.message); return null; }) : null;
    const cfg = C.contractConfig({
      eff, device: dev, office: { name: dev.o_name, type: dev.o_type }, region: dev.r_name ? { name: dev.r_name } : null,
      stream: await streamOf(tenantId, num(dev.o_channel), req, Number(dev.id)), // DIGITAL ISP: a tela pode ter o canal dela
      // a atualização: a da prefeitura, se ela definiu; senão o APK servido por este servidor (§23 do docs/TELAS.md)
      update: def.update || appStore.update(publicUrl(req)),
      weather: conteudo.weatherFor(def) || await weatherOfFeed(tenantId, num(dev.office_id)), cards, queue, offline, offlineImage, electoral, internal, signage,
    });
    // DIGITAL ISP: as manchetes das fontes de notícias escolhidas entram na faixa, depois dos avisos (o app antigo lê items)
    if (eff.tickerNews?.feeds?.length && tvcorpDados?.headlines) {
      const news = await tvcorpDados.headlines(tenantId, eff.tickerNews.feeds, eff.tickerNews.max).catch(() => []);
      if (news.length) cfg.ticker = { ...cfg.ticker, items: [...cfg.ticker.items, ...news.map((x) => x.text)], rich: [...(cfg.ticker.rich || []), ...news] };
    }
    return { rev: C.revOf(cfg), ...cfg };
  }

  const activatePerIp = createLimiter({ windowMs: 10 * 60_000, max: Number(process.env.TELAS_ACTIVATE_PER_IP) || 20, maxKeys: 100_000 });
  const recoverPerIp = createLimiter({ windowMs: 60_000, max: Number(process.env.TELAS_RECOVER_PER_IP) || 6, maxKeys: 100_000 });
  const shotsPerDevice = createLimiter({ windowMs: 60_000, max: 12, maxKeys: 50_000 });
  const delivered = new Map(); // "alerta:tela" -> última gravação (a entrega é gravada na 1ª vez e de 5 em 5 min)
  const DELIVERY_EVERY = 5 * 60_000;

  function mountDevice(app) {
    appStore.mount(app, { publicUrl });
    const BAD_KEY = 'Chave de acesso inexistente, já usada ou vencida.';
    app.post('/api/telas/activate', ah(async (req, res) => {
      noStore(res);
      if (!activatePerIp.hit(ipKey(ipOf(req) || '-'))) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
      const key = C.normalizeKey(req.body?.key);
      if (!key) return res.status(400).json({ error: 'Chave de acesso malformada (8 letras e números).' });
      const t = now();
      const k = await db.get('SELECT * FROM telas_keys WHERE key_hash = ?', [sha256(key)]);
      if (!k || k.used_at || Number(k.expires_at) <= t) return res.status(404).json({ error: BAD_KEY });
      const tenantId = Number(k.tenant_id);
      const office = await db.get('SELECT * FROM telas_offices WHERE id = ? AND tenant_id = ?', [k.office_id, tenantId]);
      if (!office || !(await available(tenantId))) return res.status(404).json({ error: BAD_KEY });
      const n = Number((await db.get('SELECT COUNT(*) AS n FROM telas_devices WHERE tenant_id = ? AND revoked_at IS NULL', [tenantId])).n);
      if (n >= LIMITS.devices) return res.status(404).json({ error: BAD_KEY });
      // uso único de verdade: só quem marca a chave como usada segue (dois aparelhos com a mesma chave: um só entra)
      if ((await db.run('UPDATE telas_keys SET used_at = ? WHERE id = ? AND used_at IS NULL', [t, k.id])).changes !== 1) return res.status(404).json({ error: BAD_KEY });
      const info = C.cleanDeviceInfo(req.body?.device);
      const hwid = C.cleanHwid(req.body?.device?.hwid);
      const token = C.newToken();
      const name = k.device_name || office.name;
      // o aparelho pertence a uma tela só: a ativação nova tira o vínculo de qualquer tela anterior dele (§32)
      if (hwid) await db.run('UPDATE telas_devices SET hwid_hash = NULL WHERE hwid_hash = ?', [C.hwidHash(hwid)]);
      const id = await db.insert('INSERT INTO telas_devices(tenant_id,office_id,name,token_hash,model,android,app_version,serial,created_at,hwid_hash) VALUES(?,?,?,?,?,?,?,?,?,?)',
        [tenantId, office.id, name, sha256(token), info.model, info.android, info.appVersion, info.serial, t, hwid ? C.hwidHash(hwid) : null]);
      await db.run('UPDATE telas_keys SET used_device = ? WHERE id = ?', [id, k.id]);
      const stream = await streamOf(tenantId, num(office.channel_id), req);
      await audit({ username: 'tela', action: 'POST /api/telas/activate', detail: `NEXA Telas: tela "${name}" (#${id}) ativada em "${office.name}"${info.model ? `, ${info.model}` : ''}`, status: 200, ip: ipOf(req), tenantId });
      res.json({ deviceId: Number(id), token, channel: stream?.slug ?? null, name });
    }));

    /* App reinstalado (§32): sem nada guardado, o app manda o hwid do aparelho. Havendo uma tela ATIVA ligada a ele, ganha
       um token NOVO (o anterior para de valer: uma instalação viva por tela) e a resposta é a mesma da ativação. Tela
       revogada ou excluída não tem vínculo (revokeDevice apaga o hwid), então não volta. Sem tela: 404 e o app pede a chave. */
    const NO_DEVICE = 'Nenhuma tela ativa ligada a este aparelho.';
    app.post('/api/telas/recover', ah(async (req, res) => {
      noStore(res);
      if (!recoverPerIp.hit(ipKey(ipOf(req) || '-'))) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
      const hwid = C.cleanHwid(req.body?.hwid);
      if (!hwid) return res.status(400).json({ error: 'Identificação do aparelho malformada.' });
      const hash = C.hwidHash(hwid);
      const cur = await db.get('SELECT * FROM telas_devices WHERE hwid_hash = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1', [hash]);
      if (!cur) return res.status(404).json({ error: NO_DEVICE });
      const tenantId = Number(cur.tenant_id);
      const office = await db.get('SELECT * FROM telas_offices WHERE id = ? AND tenant_id = ?', [cur.office_id, tenantId]);
      if (!office || !(await available(tenantId))) return res.status(404).json({ error: NO_DEVICE });
      const info = C.cleanDeviceInfo(req.body?.device);
      const token = C.newToken();
      const t = now();
      const r = await db.run('UPDATE telas_devices SET token_hash = ?, recovered_at = ?, model = ?, android = ?, app_version = ? WHERE id = ? AND tenant_id = ? AND hwid_hash = ? AND revoked_at IS NULL',
        [sha256(token), t, info.model || cur.model || '', info.android || cur.android || '', info.appVersion || cur.app_version || '', cur.id, tenantId, hash]);
      if (r.changes !== 1) return res.status(404).json({ error: NO_DEVICE }); // revogada entre a leitura e a troca
      senha.kick(cur.id); interna.kick(cur.id); // o tempo real aberto com o token antigo cai
      forget(tenantId);
      const stream = await streamOf(tenantId, num(office.channel_id), req);
      await audit({ username: 'tela', action: 'POST /api/telas/recover', detail: `NEXA Telas: tela "${cur.name}" (#${cur.id}) reativada sozinha após reinstalação do app em "${office.name}"${info.model ? `, ${info.model}` : ''}`, status: 200, ip: ipOf(req), tenantId });
      res.json({ deviceId: Number(cur.id), token, channel: stream?.slug ?? null, name: cur.name });
    }));

    app.get('/api/telas/config', device, ah(async (req, res) => {
      const cfg = await configFor(req.dev, req);
      const tag = `"${cfg.rev}"`;
      res.set('ETag', tag);
      const inm = String(req.get('if-none-match') || '').split(',').map((s) => s.trim().replace(/^W\//, '').replace(/^"|"$/g, ''));
      if (inm.includes(cfg.rev)) return res.status(304).end();
      res.json(cfg);
    }));

    app.post('/api/telas/heartbeat', device, ah(async (req, res) => {
      const dev = req.dev; const tenantId = req.tenantId; const t = now();
      const hb = C.cleanHeartbeat(req.body);
      const since = dev.last_seen && dev.online_since && t - Number(dev.last_seen) <= OFFLINE_MS ? Number(dev.online_since) : t;
      await db.run('UPDATE telas_devices SET last_seen = ?, online_since = ?, state = ?, source = ?, net = ?, last_error = ?, uptime_sec = ?, locked = ?, rev_seen = ?, app_version = ? WHERE id = ? AND tenant_id = ?',
        [t, since, hb.state, hb.source, hb.net, hb.lastError, hb.uptimeSec, hb.locked, hb.rev, hb.appVersion || dev.app_version || '', dev.id, tenantId]);
      // a TV box ativada antes do vínculo (§32) manda o hwid no sinal de vida: a tela ganha o vínculo uma vez (nunca troca o que já tem)
      const hw = C.cleanHwid(req.body?.hwid);
      if (hw && !dev.hwid_hash) {
        await db.run('UPDATE telas_devices SET hwid_hash = NULL WHERE hwid_hash = ?', [C.hwidHash(hw)]);
        await db.run('UPDATE telas_devices SET hwid_hash = ? WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL', [C.hwidHash(hw), dev.id, tenantId]);
      }
      const groups = await deviceGroups(dev);
      const cfg = await configFor(dev, req, groups);
      // TV Corporativa (§4.3): as horas ligada e o `plays` (o que a tela mostrou desde o último sinal de vida aceito)
      if (tvcorp) await tvcorp.recordPlays(tenantId, dev, req.body || {}, { office: { id: Number(dev.office_id), type: dev.o_type, region_id: dev.o_region }, groups: groups.map((x) => Number(x.id)), req })
        .catch((err) => console.warn('[telas] relatório de exibição:', err.message));
      // comandos: cada um é entregue UMA vez (um reboot repetido a cada sinal de vida prenderia o aparelho); o que não saiu em 10 min vence
      const cmds = await db.all('SELECT id, type FROM telas_commands WHERE device_id = ? AND tenant_id = ? AND sent_at IS NULL AND created_at > ? ORDER BY id', [dev.id, tenantId, t - 10 * 60_000]);
      if (cmds.length) await db.run(`UPDATE telas_commands SET sent_at = ? WHERE tenant_id = ? AND sent_at IS NULL AND id IN (${marks(cmds)})`, [t, tenantId, ...cmds.map((c) => c.id)]);
      // alertas em vigor PARA esta tela: cidade, a região da repartição, os grupos dela, a repartição ou o raio
      const me = {
        officeId: Number(dev.office_id), regionId: num(dev.o_region), groups: groups.map((g) => Number(g.id)),
        lat: dev.lat != null && dev.lng != null ? Number(dev.lat) : num(dev.o_lat), lng: dev.lat != null && dev.lng != null ? Number(dev.lng) : num(dev.o_lng),
      };
      // no período eleitoral, o alerta institucional fica retido (não é apagado)
      const def = await loadDefaults(tenantId);
      const electoral = electoralOn(def.extra.electoral, t);
      const alerts = (await loadAlerts(tenantId)).filter((a) => !a.cancelled_at && Number(a.starts_at) <= t && t < Number(a.until_at) && !withheld(a.m_class || DEFAULT_CLASS, electoral) && scopeHits(C.scopeFromRow(a), me));
      for (const a of alerts) {
        const k = `${a.id}:${dev.id}`;
        if (t - (delivered.get(k) || 0) < DELIVERY_EVERY) continue;
        if (delivered.size > 100_000) delivered.clear();
        delivered.set(k, t);
        await db.run('INSERT INTO telas_alert_deliveries(alert_id,device_id,tenant_id,first_at,last_at) VALUES(?,?,?,?,?) ON CONFLICT (alert_id, device_id) DO UPDATE SET last_at = excluded.last_at', [a.id, dev.id, tenantId, t, t]);
      }
      res.json({
        rev: cfg.rev, commands: cmds.map((c) => ({ id: Number(c.id), type: c.type })),
        // + o alerta de emergência que está no ar no canal da repartição (EAS), como `critical` (ids acima de 1 bilhão)
        // header, category e test (contrato §9) só entram quando o alerta os tem: o de antes sai exatamente como antes
        alerts: [...alerts.map((a) => ({
          id: Number(a.id), title: a.title, text: a.body || '', level: a.level, sound: Boolean(a.sound), until: Number(a.until_at),
          ...(a.i_header ? { header: a.i_header } : {}), ...(a.i_category ? { category: a.i_category } : {}), ...(Number(a.i_test) ? { test: true } : {}),
        })), ...conteudo.easFor(tenantId, num(dev.o_channel), def)],
        // pessoas desaparecidas (contrato §8): os casos em vigor PARA esta tela; não passam pela aprovação nem pelo modo eleitoral
        missing: await desap.forDevice(tenantId, me, req),
        // códigos de emergência hospitalar (§17.2): SÓ na tela interna; na pública a chave não vai
        ...(await interna.codesFor(dev).then((codes) => (codes === undefined ? {} : { codes }))),
      });
    }));

    app.post('/api/telas/commands/:id/done', device, ah(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(404).json({ error: 'Comando inexistente.' });
      const r = await db.run('UPDATE telas_commands SET done_at = ?, ok = ?, detail = ? WHERE id = ? AND device_id = ? AND tenant_id = ? AND done_at IS NULL',
        [now(), req.body?.ok === false ? 0 : 1, line(req.body?.detail, 200) || null, id, req.dev.id, req.tenantId]);
      if (!r.changes && !(await db.get('SELECT id FROM telas_commands WHERE id = ? AND device_id = ? AND tenant_id = ?', [id, req.dev.id, req.tenantId]))) return res.status(404).json({ error: 'Comando inexistente.' });
      res.json({ ok: true });
    }));

    // o corpo só é lido depois do token; fora de image/jpeg nada é lido
    app.post('/api/telas/screenshot', device, (req, res, next) => {
      if (Number(req.get('content-length')) > C.SHOT_MAX) return res.status(413).json({ error: 'Captura grande demais (até 400 KB).' });
      if (!shotsPerDevice.hit(String(req.dev.id))) return res.status(429).json({ error: 'Capturas demais. Aguarde um minuto.' });
      next();
    }, express.raw({ type: 'image/jpeg', limit: C.SHOT_MAX }), ah(async (req, res) => {
      if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: 'Envie a captura como image/jpeg.' });
      if (!C.isJpeg(req.body)) return res.status(400).json({ error: 'A captura não é um JPEG válido.' });
      await C.saveShot(req.tenantId, req.dev.id, req.body);
      await db.run('UPDATE telas_devices SET shot_at = ? WHERE id = ? AND tenant_id = ?', [now(), req.dev.id, req.tenantId]);
      res.status(204).end();
    }));
    senha.mountDevice(app, { device }); // GET /api/telas/queue e /api/telas/queue/stream (contrato §7.2)
    interna.mountDevice(app, { device }); // GET /api/telas/internal/stream (os códigos de emergência, só na tela interna)
  }

  /* ================================================================ o Painel da Prefeitura */
  function mountPanel(app, { needs }) {
    // a rede de telas é do cliente inteiro (todas as repartições, todos os canais): grupo limitado a alguns canais não entra
    const all = (req, res, next) => (req.user?.channels ? res.status(403).json({ error: 'O Painel da Prefeitura pede acesso a todos os canais do cliente.' }) : next());
    const M = [needs('prefeitura.manage'), all];
    const who = (req) => req.user?.username || '';
    const under = async (table, tenantId, max, what) => {
      if (Number((await db.get(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ?`, [tenantId])).n) >= max) throw fail(409, `Limite de ${max} ${what} atingido.`);
    };
    const regionIdOf = async (v, tenantId) => (v == null || v === '' ? null : Number((await own('telas_regions', v, tenantId, 'Região')).id));
    const channelIdOf = (v, tenantId) => {
      if (v == null || v === '') return null;
      const id = idOf(v, 'Canal');
      if (!channelsOf(tenantId).some((c) => c.id === id)) throw fail(400, 'Canal inexistente.');
      return id;
    };

    /* ---- o município da prefeitura (uma linha por cliente) e o contorno dele. O painel recebe o contorno já guardado: quem
       fala com o IBGE é só o servidor, e só com o código do município */
    const loadMunicipio = (tenantId) => db.get('SELECT * FROM telas_municipio WHERE tenant_id = ?', [tenantId]);
    const municipioDto = (m) => {
      if (!m) return null;
      const bbox = { south: num(m.south), west: num(m.west), north: num(m.north), east: num(m.east) };
      const polygons = m.outline ? j(m.outline, null) : null;
      const ok = Array.isArray(polygons) && polygons.length > 0 && validBbox(bbox);
      return {
        ibge: Number(m.ibge), name: m.name, uf: m.uf, bbox: ok ? bbox : null,
        outline: { status: ok ? 'ok' : 'missing', polygons: ok ? polygons : null, points: ok ? Number(m.outline_points) || 0 : 0, at: ok ? num(m.outline_at) : null, error: m.outline_error || null, triedAt: num(m.tried_at) },
        updatedAt: Number(m.updated_at), updatedBy: m.updated_by || '',
      };
    };
    /** Busca o contorno e guarda (só se o município ainda é o mesmo). Falha do IBGE: fica o erro e o que já havia. */
    async function pullOutline(tenantId, ibge, geo = null) {
      let got = null; let error = null;
      // geo: o contorno que o painel buscou no IBGE (o IBGE não responde a servidores fora do Brasil); passa pelo mesmo crivo
      try { got = geo ? malha.fromGeo(geo, 'O contorno enviado é', { brazil: true }) : await malha.fetchOutline(ibge); } catch (err) { error = line(err?.message || 'Não foi possível buscar o contorno.', 200); }
      const t = now();
      if (got) {
        await db.run('UPDATE telas_municipio SET south = ?, west = ?, north = ?, east = ?, outline = ?, outline_points = ?, outline_at = ?, outline_error = NULL, tried_at = ? WHERE tenant_id = ? AND ibge = ?',
          [got.bbox.south, got.bbox.west, got.bbox.north, got.bbox.east, JSON.stringify(got.polygons), got.points, t, t, tenantId, ibge]);
      } else await db.run('UPDATE telas_municipio SET outline_error = ?, tried_at = ? WHERE tenant_id = ? AND ibge = ?', [error, t, tenantId, ibge]);
      return Boolean(got);
    }
    const outlinePerTenant = createLimiter({ windowMs: 60_000, max: 6, maxKeys: 10_000 });
    const outlineSentPerTenant = createLimiter({ windowMs: 60_000, max: 12, maxKeys: 10_000 }); // o contorno que o painel manda: freio próprio
    app.get('/api/prefeitura/municipio', M, ah(async (req, res) => noStore(res).json({ municipio: municipioDto(await loadMunicipio(req.tenantId)) })));
    /**
     * Grava o município do cliente e busca o contorno. O município é TRAVADO no primeiro cadastro: o painel do cliente
     * só grava enquanto não há nenhum; trocar ou tirar é do Superadmin (/api/platform/tenants/:id/telas-municipio).
     */
    const LOCKED = 'O município da prefeitura já foi definido e fica travado. Só a equipe da plataforma (Superadmin) pode trocar.';
    async function setMunicipio(tenantId, b, by, { locked = false } = {}) {
      const code = b.ibge == null || b.ibge === '' ? null : Number(b.ibge);
      if (code != null && !(Number.isInteger(code) && code >= 1000000 && code <= 9999999)) throw fail(400, 'Município: código do IBGE inválido (7 dígitos).');
      let p; try { p = cleanBrPlace({ uf: b.uf, city: b.city, cityIbge: code }); } catch (e) { throw fail(400, `Município: ${e.message}`); }
      if (!p.city_ibge) throw fail(400, 'Município: escolha o estado e o município.');
      const cur = await loadMunicipio(tenantId);
      if (locked && cur && Number(cur.ibge) !== p.city_ibge) throw fail(403, LOCKED, { code: 'municipio_locked' });
      const t = now();
      if (!cur || Number(cur.ibge) !== p.city_ibge) {
        // município novo: o contorno do anterior não vale mais
        await db.run(`INSERT INTO telas_municipio(tenant_id,ibge,name,uf,updated_by,updated_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT (tenant_id) DO UPDATE SET ibge = excluded.ibge, name = excluded.name, uf = excluded.uf, south = NULL, west = NULL, north = NULL, east = NULL,
            outline = NULL, outline_points = 0, outline_at = NULL, outline_error = NULL, tried_at = NULL, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        [tenantId, p.city_ibge, p.city, p.uf, by, t]);
      }
      const had = cur && Number(cur.ibge) === p.city_ibge && cur.outline;
      const ok = had ? true : await pullOutline(tenantId, p.city_ibge);
      forget(tenantId);
      return { place: p, ok, municipio: municipioDto(await loadMunicipio(tenantId)) };
    }
    app.put('/api/prefeitura/municipio', M, ah(async (req, res) => {
      const r = await setMunicipio(req.tenantId, req.body || {}, who(req), { locked: true });
      res.locals.audit = `prefeitura: município das telas definido: ${r.place.city}/${r.place.uf} (${r.ok ? 'contorno guardado' : 'contorno indisponível agora'}); fica travado`;
      noStore(res).json({ municipio: r.municipio });
    }));
    municipioApi = {
      get: async (tenantId) => municipioDto(await loadMunicipio(tenantId)),
      set: setMunicipio,
      async clear(tenantId) { const cur = await loadMunicipio(tenantId); await db.run('DELETE FROM telas_municipio WHERE tenant_id = ?', [tenantId]); forget(tenantId); return cur; },
    };
    /** "Tentar de novo": busca o contorno outra vez (o município fica como está). */
    app.post('/api/prefeitura/municipio/outline', M, ah(async (req, res) => {
      const cur = await loadMunicipio(req.tenantId);
      if (!cur) throw fail(409, 'Escolha o município da prefeitura antes.');
      if (!(req.body?.geojson && typeof req.body.geojson === 'object' ? outlineSentPerTenant : outlinePerTenant).hit(String(req.tenantId))) throw fail(429, 'Muitas tentativas seguidas. Aguarde um minuto.');
      const geo = req.body?.geojson && typeof req.body.geojson === 'object' ? req.body.geojson : null;
      const ok = await pullOutline(req.tenantId, Number(cur.ibge), geo);
      forget(req.tenantId);
      res.locals.audit = `prefeitura: contorno de ${cur.name}/${cur.uf} ${geo ? (ok ? 'buscado pelo painel e guardado' : 'buscado pelo painel e recusado') : ok ? 'buscado de novo e guardado' : 'buscado de novo, sem resposta do IBGE'}`;
      noStore(res).json({ ok, municipio: municipioDto(await loadMunicipio(req.tenantId)) });
    }));
    app.delete('/api/prefeitura/municipio', M, ah(async () => { throw fail(403, LOCKED, { code: 'municipio_locked' }); }));

    const defaultsDto = (def, t = now()) => ({ config: C.configDto(def.config), city: def.city, update: def.update, ...def.extra, alertTexts: def.alertTexts || {}, electoralOn: electoralOn(def.extra.electoral, t), weatherReady: Boolean(weatherOf) });
    async function overview(tenantId, req = null) {
      const t = now();
      const [def, regions, offices, groups, links, devices, keys, city] = await Promise.all([
        loadDefaults(tenantId),
        db.all('SELECT * FROM telas_regions WHERE tenant_id = ? ORDER BY name', [tenantId]),
        db.all('SELECT o.*, (SELECT COUNT(*) FROM telas_office_users u WHERE u.office_id = o.id AND u.tenant_id = o.tenant_id) AS n_users FROM telas_offices o WHERE o.tenant_id = ? ORDER BY o.name', [tenantId]),
        db.all('SELECT * FROM telas_groups WHERE tenant_id = ? ORDER BY sort, id', [tenantId]),
        db.all('SELECT group_id, device_id FROM telas_group_devices WHERE tenant_id = ?', [tenantId]),
        db.all('SELECT * FROM telas_devices WHERE tenant_id = ? ORDER BY name, id', [tenantId]),
        db.all('SELECT * FROM telas_keys WHERE tenant_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC', [tenantId, t]),
        loadMunicipio(tenantId),
      ]);
      const byDev = new Map(); const byGroup = new Map();
      for (const l of links) {
        const d = Number(l.device_id); const g = Number(l.group_id);
        if (!byDev.has(d)) byDev.set(d, []); byDev.get(d).push(g);
        if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(d);
      }
      return {
        serverTime: t, offlineMs: OFFLINE_MS, defaults: defaultsDto(def, t), appLatest: req ? appStore.info(publicUrl(req)) : null, channels: channelsOf(tenantId), municipio: municipioDto(city),
        regions: regions.map(regionDto), offices: offices.map(officeDto), groups: groups.map((g) => groupDto(g, byGroup.get(Number(g.id)) || [])),
        devices: devices.map((d) => deviceDto(d, byDev.get(Number(d.id)) || [])),
        keys: keys.map(keyDto),
      };
    }

    app.get('/api/prefeitura', M, ah(async (req, res) => noStore(res).json(await overview(req.tenantId, req))));
    app.get('/api/prefeitura/status', M, ah(async (req, res) => {
      const t = now();
      const rows = await db.all('SELECT id, last_seen, online_since, state, source, net, last_error, uptime_sec, locked, app_version, rev_seen, shot_at FROM telas_devices WHERE tenant_id = ? AND revoked_at IS NULL', [req.tenantId]);
      const alerts = (await loadAlerts(req.tenantId)).filter((a) => Number(a.starts_at) <= t && t < Number(a.until_at)).length;
      noStore(res).json({ serverTime: t, alerts, devices: rows.map((d) => ({ id: Number(d.id), ...liveOf(d) })) });
    }));
    app.get('/api/prefeitura/geocode', M, ah(async (req, res) => {
      const q = line(req.query.q, 120);
      if (q.length < 3) throw fail(400, 'Escreva ao menos 3 letras do endereço ou da cidade.');
      // endereço com rua e número: a busca de endereços (server/telas-geocode.js), presa ao município da prefeitura
      if (geocodeAddress) {
        const m = municipioDto(await loadMunicipio(req.tenantId));
        let found;
        try { found = await geocodeAddress(q, { city: m ? { name: m.name, uf: m.uf } : null, bbox: m?.bbox || null }); } catch { throw fail(502, 'Não foi possível consultar o mapa agora. Arraste o ponto à mão.'); }
        return res.json({ results: found.slice(0, 5) });
      }
      let results;
      try { results = await geocode(q); } catch { throw fail(502, 'Não foi possível consultar o mapa agora. Arraste o ponto à mão.'); }
      res.json({ results: results.map((r) => ({ name: [r.nome, r.estado, r.pais].filter(Boolean).join(', '), lat: r.lat, lng: r.lon })) });
    }));

    app.put('/api/prefeitura/defaults', M, ah(async (req, res) => {
      const cur = await loadDefaults(req.tenantId);
      const extra = cleanSettings(req.body, cur.extra);
      const next = { config: C.mergeConfig(cur.config, req.body?.config), city: cur.city, update: req.body?.update === undefined ? cur.update : C.cleanUpdate(req.body.update), ...extra };
      // o texto sugerido dos tipos de aviso: só o que a prefeitura trocou fica guardado (null volta tudo ao catálogo)
      const texts = req.body?.alertTexts === undefined ? cur.alertTexts : cleanAlertTexts(req.body.alertTexts) || {};
      if (Object.keys(texts).length) next.alertTexts = texts;
      if (cur.missingQr) next.missingQr = cur.missingQr; // o QR code padrão dos casos de pessoa desaparecida (aba Desaparecidos)
      if (req.body?.city !== undefined) {
        if (req.body.city === null) next.city = null;
        else {
          const p = C.cleanPoint(req.body.city.lat, req.body.city.lng);
          if (p.lat == null) throw fail(400, 'Centro do mapa: escolha um ponto.');
          const z = Math.round(Number(req.body.city.zoom));
          next.city = { name: line(req.body.city.name, 80), lat: p.lat, lng: p.lng, zoom: z >= 3 && z <= 18 ? z : 12 };
        }
      }
      await setSetting(C.settingsKey(req.tenantId), JSON.stringify(next));
      forget(req.tenantId);
      const b = req.body || {};
      const notes = [
        b.electoral !== undefined ? (extra.electoral ? `modo eleitoral de ${extra.electoral.from} a ${extra.electoral.to}` : 'modo eleitoral desligado') : '',
        b.approval !== undefined ? `aprovação da SECOM ${extra.approval ? 'ligada' : 'desligada'}` : '', b.eas !== undefined ? `alerta de emergência do canal nas telas ${extra.eas ? 'ligado' : 'desligado'}` : '',
        b.alertTexts !== undefined ? `texto sugerido de ${Object.keys(texts).length} tipo(s) de aviso trocado` : '',
        b.cidade !== undefined ? (extra.cidade ? `cidade do clima: ${extra.cidade.city}/${extra.cidade.uf}` : 'sem cidade do clima') : '', b.notify !== undefined ? `aviso de tela desligada ${extra.notify.offline ? `ligado (${extra.notify.afterMin} min)` : 'desligado'}` : '',
      ].filter(Boolean);
      res.locals.audit = `prefeitura: padrão das telas alterado${req.body?.config?.pin ? ' (PIN novo)' : ''}${req.body?.update !== undefined ? (next.update ? ` (atualização do app: versão ${next.update.versionCode})` : ' (sem atualização do app)') : ''}${notes.length ? ` (${notes.join('; ')})` : ''}`;
      res.json(defaultsDto({ config: next.config, city: next.city, update: next.update, extra, alertTexts: texts }));
    }));

    /* ---- regiões */
    app.post('/api/prefeitura/regions', M, ah(async (req, res) => {
      await under('telas_regions', req.tenantId, LIMITS.regions, 'regiões');
      const name = C.cleanName(req.body?.name, 'Nome da região');
      const id = await db.insert('INSERT INTO telas_regions(tenant_id,name,color,created_at) VALUES(?,?,?,?)', [req.tenantId, name, C.cleanColor(req.body?.color), now()]);
      res.locals.audit = `prefeitura: região "${name}" criada`;
      res.status(201).json(regionDto(await db.get('SELECT * FROM telas_regions WHERE id = ?', [id])));
    }));
    app.patch('/api/prefeitura/regions/:id', M, ah(async (req, res) => {
      const cur = await own('telas_regions', req.params.id, req.tenantId, 'Região');
      const name = req.body?.name === undefined ? cur.name : C.cleanName(req.body.name, 'Nome da região');
      const color = req.body?.color === undefined ? cur.color : C.cleanColor(req.body.color);
      await db.run('UPDATE telas_regions SET name = ?, color = ? WHERE id = ? AND tenant_id = ?', [name, color, cur.id, req.tenantId]);
      forget(req.tenantId);
      res.locals.audit = `prefeitura: região "${name}" alterada`;
      res.json(regionDto({ ...cur, name, color }));
    }));
    app.delete('/api/prefeitura/regions/:id', M, ah(async (req, res) => {
      const cur = await own('telas_regions', req.params.id, req.tenantId, 'Região');
      await db.tx(async (x) => {
        await x.run('UPDATE telas_offices SET region_id = NULL WHERE region_id = ? AND tenant_id = ?', [cur.id, req.tenantId]);
        await x.run('DELETE FROM telas_regions WHERE id = ? AND tenant_id = ?', [cur.id, req.tenantId]);
      });
      forget(req.tenantId);
      res.locals.audit = `prefeitura: região "${cur.name}" excluída`;
      res.json({ ok: true });
    }));

    /* ---- repartições */
    async function readOffice(b, tenantId, cur = null) {
      const has = (k) => b[k] !== undefined;
      const type = has('type') ? C.cleanOfficeType(b.type) : cur?.type || 'outro';
      const p = has('lat') || has('lng') ? C.cleanPoint(b.lat, b.lng) : { lat: num(cur?.lat), lng: num(cur?.lng) };
      return {
        name: has('name') || !cur ? C.cleanName(b.name, 'Nome da repartição') : cur.name, type,
        address: has('address') ? line(b.address, LIMITS.address) : cur?.address || '', lat: p.lat, lng: p.lng,
        region_id: has('regionId') ? await regionIdOf(b.regionId, tenantId) : num(cur?.region_id),
        resp_name: has('respName') ? line(b.respName, LIMITS.contact) : cur?.resp_name || '', resp_contact: has('respContact') ? line(b.respContact, LIMITS.contact) : cur?.resp_contact || '',
        modules: JSON.stringify(has('modules') ? C.cleanModules(b.modules, type) : officeModules(type, cur ? j(cur.modules, {}) : null)),
        config: JSON.stringify(C.mergeConfig(cur ? j(cur.config, {}) : {}, b.config)),
        channel_id: has('channelId') ? channelIdOf(b.channelId, tenantId) : num(cur?.channel_id),
      };
    }
    app.post('/api/prefeitura/offices', M, ah(async (req, res) => {
      await under('telas_offices', req.tenantId, LIMITS.offices, 'repartições');
      const o = await readOffice(req.body || {}, req.tenantId);
      // sem PIN na repartição nem no padrão da prefeitura: sorteia um e mostra UMA vez na resposta (só o hash fica)
      let generatedPin = null;
      if (!j(o.config, {}).pin?.hash && !(await loadDefaults(req.tenantId)).config.pin?.hash) {
        generatedPin = C.randomPin();
        o.config = JSON.stringify({ ...j(o.config, {}), pin: C.pinRecord(generatedPin) });
      }
      const id = await db.insert('INSERT INTO telas_offices(tenant_id,channel_id,name,type,address,lat,lng,region_id,resp_name,resp_contact,modules,config,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [req.tenantId, o.channel_id, o.name, o.type, o.address, o.lat, o.lng, o.region_id, o.resp_name, o.resp_contact, o.modules, o.config, now()]);
      res.locals.audit = `prefeitura: repartição "${o.name}" criada (${typeLabel(o.type)})${generatedPin ? ' com PIN sorteado' : ''}`;
      noStore(res).status(201).json({ ...officeDto(await db.get('SELECT * FROM telas_offices WHERE id = ?', [id])), ...(generatedPin ? { generatedPin } : {}) });
    }));
    app.patch('/api/prefeitura/offices/:id', M, ah(async (req, res) => {
      const cur = await own('telas_offices', req.params.id, req.tenantId, 'Repartição');
      const o = await readOffice(req.body || {}, req.tenantId, cur);
      await db.run('UPDATE telas_offices SET channel_id = ?, name = ?, type = ?, address = ?, lat = ?, lng = ?, region_id = ?, resp_name = ?, resp_contact = ?, modules = ?, config = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
        [o.channel_id, o.name, o.type, o.address, o.lat, o.lng, o.region_id, o.resp_name, o.resp_contact, o.modules, o.config, now(), cur.id, req.tenantId]);
      forget(req.tenantId);
      res.locals.audit = `prefeitura: repartição "${o.name}" alterada${req.body?.config?.pin ? ' (PIN novo)' : ''}`;
      res.json(officeDto(await db.get('SELECT * FROM telas_offices WHERE id = ?', [cur.id])));
    }));
    app.delete('/api/prefeitura/offices/:id', M, ah(async (req, res) => {
      const cur = await own('telas_offices', req.params.id, req.tenantId, 'Repartição');
      if (await db.get('SELECT id FROM telas_devices WHERE office_id = ? AND tenant_id = ? AND revoked_at IS NULL', [cur.id, req.tenantId])) throw fail(409, 'A repartição tem telas ativas: revogue as telas ou passe-as para outra repartição antes.');
      const gone = await db.all('SELECT id FROM telas_devices WHERE office_id = ? AND tenant_id = ?', [cur.id, req.tenantId]);
      await db.tx(async (x) => {
        for (const d of gone) await dropDevice(x, req.tenantId, d.id);
        await x.run('DELETE FROM telas_keys WHERE office_id = ? AND tenant_id = ?', [cur.id, req.tenantId]);
        await x.run('DELETE FROM telas_office_users WHERE office_id = ? AND tenant_id = ?', [cur.id, req.tenantId]);
        await seguranca.dropOffice(x, req.tenantId, cur.id); // os acionamentos do pânico e a chave de integração
        await interna.dropOffice(x, req.tenantId, cur.id); // setores, avisos internos, leituras e códigos
        await senha.dropOffice(x, req.tenantId, cur.id); // as filas, as senhas e o totem
        await conteudo.dropOffice(x, req.tenantId, cur.id); // os cartões, os pedidos esperando e os vídeos guardados da repartição
        await offImg.dropScope(x, req.tenantId, 'office', cur.id); // a imagem sem internet (o arquivo sai na limpeza)
        if (tvcorp) await tvcorp.dropOffice(x, req.tenantId, cur.id); // TV Corporativa: as mídias e playlists da unidade
        if (tvcorpDados) await tvcorpDados.dropOffice(x, req.tenantId, cur.id); // pessoas, comunicados, indicadores e endereços do celular
        await x.run('DELETE FROM telas_offices WHERE id = ? AND tenant_id = ?', [cur.id, req.tenantId]);
      });
      for (const d of gone) await C.removeShot(req.tenantId, d.id).catch(() => {});
      forget(req.tenantId);
      res.locals.audit = `prefeitura: repartição "${cur.name}" excluída`;
      res.json({ ok: true });
    }));

    /** PIN novo sorteado para a repartição, mostrado UMA vez (para quem perdeu o PIN ou herdou um sorteado que ninguém viu). */
    app.post('/api/prefeitura/offices/:id/pin', M, ah(async (req, res) => {
      const cur = await own('telas_offices', req.params.id, req.tenantId, 'Repartição');
      const pin = C.randomPin();
      await db.run('UPDATE telas_offices SET config = ?, updated_at = ? WHERE id = ? AND tenant_id = ?', [JSON.stringify({ ...j(cur.config, {}), pin: C.pinRecord(pin) }), now(), cur.id, req.tenantId]);
      forget(req.tenantId);
      res.locals.audit = `prefeitura: PIN novo sorteado para a repartição "${cur.name}"`;
      noStore(res).status(201).json({ pin });
    }));

    /* ---- link de controle da repartição: o endereço aparece UMA vez (só o hash fica); a senha é à parte */
    const linkPassword = (v) => {
      if (typeof v !== 'string' || v.length < LIMITS.linkPasswordMin || v.length > LIMITS.linkPasswordMax) throw fail(400, `Senha do link: ${LIMITS.linkPasswordMin} a ${LIMITS.linkPasswordMax} caracteres.`);
      return v;
    };
    /**
     * A senha nova do link: a escrita pelo painel ({ password }) ou uma sorteada pelo servidor ({ generate: true }, forte e
     * legível, server/telas-acesso.js). Devolve { hash, enc, plain } ou null (o pedido não troca a senha). Nos dois casos
     * ela fica também cifrada, para o "olho" do painel; o login confere pelo hash.
     */
    const newLinkPass = async (b) => {
      const plain = b?.generate === true ? newOfficePassword() : b?.password != null && b.password !== '' ? linkPassword(b.password) : null;
      return plain ? { hash: await hashPassword(plain), enc: sealer.seal(plain), plain, generated: b?.generate === true } : null;
    };
    app.post('/api/prefeitura/offices/:id/link', M, ah(async (req, res) => {
      const cur = await own('telas_offices', req.params.id, req.tenantId, 'Repartição');
      const users = await hasUsers(req.tenantId, cur.id);
      // gerar de novo sem mandar senha: a senha de antes continua; com usuários cadastrados, o link não tem senha própria
      // (quem entra é o usuário) e a sorteada não se aplica
      const np = users ? null : await newLinkPass(req.body);
      const pass = np ? np.hash : cur.link_pass;
      if (!pass && !users) throw fail(400, 'Defina a senha do link de controle (ou cadastre um usuário do painel da repartição).');
      const token = C.newToken();
      await db.run('UPDATE telas_offices SET link_hash = ?, link_pass = ?, link_enc = ?, pass_enc = ?, link_ver = link_ver + 1, link_at = ? WHERE id = ? AND tenant_id = ?',
        [sha256(token), users ? null : pass, sealer.seal(token), users ? null : np ? np.enc : cur.pass_enc, now(), cur.id, req.tenantId]);
      res.locals.audit = `prefeitura: link de controle de "${cur.name}" ${cur.link_hash ? 'gerado de novo (o anterior deixou de valer)' : 'gerado'}${np?.generated ? ' com senha sorteada' : np ? ' com senha nova' : ''}`;
      noStore(res).status(201).json({ url: `${publicUrl(req)}/reparticao/${token}`, ...(np?.generated ? { password: np.plain } : {}), office: officeDto(await db.get('SELECT * FROM telas_offices WHERE id = ?', [cur.id])) });
    }));
    app.put('/api/prefeitura/offices/:id/link/password', M, ah(async (req, res) => {
      const cur = await own('telas_offices', req.params.id, req.tenantId, 'Repartição');
      if (!cur.link_hash) throw fail(409, 'Esta repartição não tem link de controle. Gere o link primeiro.');
      if (await hasUsers(req.tenantId, cur.id)) throw fail(409, 'Esta repartição entra com usuário e senha (aba Usuários): a senha única do link não vale mais.');
      const np = await newLinkPass(req.body?.generate === true ? req.body : { password: linkPassword(req.body?.password) });
      await db.run('UPDATE telas_offices SET link_pass = ?, pass_enc = ?, link_ver = link_ver + 1 WHERE id = ? AND tenant_id = ?', [np.hash, np.enc, cur.id, req.tenantId]);
      res.locals.audit = `prefeitura: senha do link de controle de "${cur.name}" ${np.generated ? 'sorteada de novo' : 'trocada'} (as sessões abertas caíram)`;
      noStore(res).json({ ok: true, ...(np.generated ? { password: np.plain } : {}) });
    }));
    app.delete('/api/prefeitura/offices/:id/link', M, ah(async (req, res) => {
      const cur = await own('telas_offices', req.params.id, req.tenantId, 'Repartição');
      await db.run('UPDATE telas_offices SET link_hash = NULL, link_pass = NULL, link_enc = NULL, pass_enc = NULL, link_ver = link_ver + 1, link_at = NULL WHERE id = ? AND tenant_id = ?', [cur.id, req.tenantId]);
      res.locals.audit = `prefeitura: link de controle de "${cur.name}" desligado`;
      res.json({ ok: true });
    }));
    /**
     * O "olho": o link e a senha do painel da repartição em claro, para quem administra a prefeitura (prefeitura.manage).
     * POST (não GET) para ficar no log de auditoria, com quem revelou e quando. state: 'ok' (link e senha), 'users' (a
     * repartição entra com usuário e senha: só o link), 'legacy' (definidos antes desta versão, ou a chave do servidor mudou:
     * gere de novo para poder ver), 'none' (sem link).
     */
    app.post('/api/prefeitura/offices/:id/access', M, ah(async (req, res) => {
      const cur = await own('telas_offices', req.params.id, req.tenantId, 'Repartição');
      const users = await hasUsers(req.tenantId, cur.id);
      const token = cur.link_hash ? sealer.unseal(cur.link_enc) : null;
      const url = token && C.TOKEN_RE.test(token) && sha256(token) === cur.link_hash ? `${publicUrl(req)}/reparticao/${token}` : null; // o cifrado de um link antigo não serve
      const password = !users && cur.link_pass ? sealer.unseal(cur.pass_enc) : null;
      const state = !cur.link_hash ? 'none' : !url ? 'legacy' : users ? 'users' : password ? 'ok' : 'legacy';
      res.locals.audit = `prefeitura: ${[url ? 'link' : '', password ? 'senha' : ''].filter(Boolean).join(' e ') || 'nada'} do painel da repartição "${cur.name}" revelado(s) no painel${state === 'legacy' ? ' (definidos antes: não dá para mostrar)' : ''}`;
      noStore(res).json({ state, url, password, users });
    }));
    /** O "Alcance dos alertas" de uma repartição de emergência (Defesa Civil, Segurança, Polícias). */
    app.put('/api/prefeitura/offices/:id/reach', M, ah(async (req, res) => {
      const cur = await own('telas_offices', req.params.id, req.tenantId, 'Repartição');
      if (!hasReach(cur.type)) throw fail(409, 'Só as repartições de emergência (Defesa Civil, Segurança e as Polícias) têm o alcance dos alertas.');
      const b = req.body || {};
      if (!REACH_MODES.some((m) => m.key === b.mode)) throw fail(400, 'Alcance: só as telas da repartição, todas as TV box, ou regiões e grupos.');
      if (b.eas !== undefined && typeof b.eas !== 'boolean') throw fail(400, '"eas" é verdadeiro ou falso.');
      const r = reachOf(cur.type, { mode: b.mode, regions: b.regions, groups: b.groups, eas: b.eas === true });
      if (r.mode === 'pick') {
        if (!r.regions.length && !r.groups.length) throw fail(400, 'Escolha ao menos uma região ou um grupo (ou "Todas as TV box").');
        if (r.regions.length) await assertScope(req.tenantId, { kind: 'regions', regions: r.regions });
        if (r.groups.length) await assertScope(req.tenantId, { kind: 'groups', groups: r.groups });
      }
      await db.run('UPDATE telas_offices SET alert_reach = ?, updated_at = ? WHERE id = ? AND tenant_id = ?', [JSON.stringify(r), now(), cur.id, req.tenantId]);
      forget(req.tenantId);
      const d = await overviewLists(req.tenantId);
      res.locals.audit = `prefeitura: alcance dos alertas de "${cur.name}": ${reachText(r, d)}${r.eas ? '; também no ar dos canais (alerta de emergência)' : ''}`;
      res.json({ reach: r, text: reachText(r, d), preview: await preview(req.tenantId, reachScope(r, cur.id)) });
    }));
    const overviewLists = async (tenantId) => ({ regions: await db.all('SELECT id, name FROM telas_regions WHERE tenant_id = ?', [tenantId]), groups: await db.all('SELECT id, name FROM telas_groups WHERE tenant_id = ?', [tenantId]) });

    /* ---- chaves de acesso: a chave aparece UMA vez (só o hash fica), vale 24 h e uma tela */
    app.post('/api/prefeitura/keys', M, ah(async (req, res) => {
      const office = await own('telas_offices', req.body?.officeId, req.tenantId, 'Repartição');
      const k = await newAccessKey(req.tenantId, office, req.body?.name, who(req));
      res.locals.audit = `prefeitura: chave de acesso gerada para "${office.name}"${k.deviceName ? ` (${k.deviceName})` : ''}`;
      noStore(res).status(201).json(k);
    }));
    app.delete('/api/prefeitura/keys/:id', M, ah(async (req, res) => {
      const r = await db.run('DELETE FROM telas_keys WHERE id = ? AND tenant_id = ? AND used_at IS NULL', [idOf(req.params.id), req.tenantId]);
      if (!r.changes) throw fail(404, 'Chave não encontrada.');
      res.locals.audit = 'prefeitura: chave de acesso apagada antes do uso';
      res.json({ ok: true });
    }));

    /* ---- telas (as regras em patchDevice, queueCommand, revokeDevice, deleteDevice e sendShot, acima) */
    app.patch('/api/prefeitura/devices/:id', M, ah(async (req, res) => {
      const cur = await own('telas_devices', req.params.id, req.tenantId, 'Tela');
      const out = await patchDevice(req.tenantId, cur, req.body || {}, { full: true });
      res.locals.audit = `prefeitura: tela "${out.name}" (#${cur.id}) alterada${req.body?.config?.pin ? ' (PIN novo)' : ''}`;
      res.json(out);
    }));
    app.post('/api/prefeitura/devices/:id/revoke', M, ah(async (req, res) => {
      const cur = await own('telas_devices', req.params.id, req.tenantId, 'Tela');
      await revokeDevice(req.tenantId, cur);
      res.locals.audit = `prefeitura: tela "${cur.name}" (#${cur.id}) revogada (o aparelho volta à tela da chave)`;
      res.json({ ok: true });
    }));
    app.delete('/api/prefeitura/devices/:id', M, ah(async (req, res) => {
      const cur = await own('telas_devices', req.params.id, req.tenantId, 'Tela');
      await deleteDevice(req.tenantId, cur);
      res.locals.audit = `prefeitura: tela "${cur.name}" (#${cur.id}) excluída`;
      res.json({ ok: true });
    }));
    app.post('/api/prefeitura/devices/:id/commands', M, ah(async (req, res) => {
      const cur = await own('telas_devices', req.params.id, req.tenantId, 'Tela');
      const out = await queueCommand(req.tenantId, cur, req.body?.type, who(req));
      res.locals.audit = `prefeitura: comando ${out.type} para a tela "${cur.name}" (#${cur.id})`;
      res.status(201).json(out);
    }));
    app.get('/api/prefeitura/devices/:id/screenshot', M, ah(async (req, res) => sendShot(res, req.tenantId, await own('telas_devices', req.params.id, req.tenantId, 'Tela'))));

    /* ---- emissor conveniado (Polícia Civil e Militar): "pode emitir direto, sem aprovação" (desligado de fábrica) */
    app.put('/api/prefeitura/offices/:id/issuer', M, ah(async (req, res) => {
      const o = await own('telas_offices', req.params.id, req.tenantId, 'Repartição');
      if (!isExternal(o.type)) throw fail(409, 'Só um emissor conveniado (Polícia Civil ou Militar) tem esta opção.');
      if (typeof req.body?.direct !== 'boolean') throw fail(400, '"direct" é verdadeiro ou falso.');
      await setIssuerDirect(req.tenantId, o.id, req.body.direct);
      res.locals.audit = `prefeitura: emissor conveniado "${o.name}" ${req.body.direct ? 'LIBERADO para emitir alertas direto, sem aprovação' : 'volta a esperar a aprovação do CCO'}`;
      res.json({ direct: req.body.direct });
    }));

    /* ---- usuários do painel da repartição (usuário + senha; a senha só em scrypt, nunca devolvida) */
    const ownUser = async (o, id) => {
      const u = await db.get('SELECT * FROM telas_office_users WHERE id = ? AND office_id = ? AND tenant_id = ?', [idOf(id, 'Usuário'), o.id, o.tenant_id]);
      if (!u) throw fail(404, 'Usuário não encontrado.');
      return u;
    };
    app.get('/api/prefeitura/offices/:id/users', M, ah(async (req, res) => {
      const o = await own('telas_offices', req.params.id, req.tenantId, 'Repartição');
      noStore(res).json({ office: { id: Number(o.id), name: o.name, link: { on: Boolean(o.link_hash), at: num(o.link_at) }, legacyPassword: Boolean(o.link_pass), external: isExternal(o.type), direct: isExternal(o.type) ? await issuerDirect(req.tenantId, o.id) : false }, users: (await usersOf(req.tenantId, o.id)).map(officeUserDto), max: C.OFFICE_USERS_MAX });
    }));
    app.post('/api/prefeitura/offices/:id/users', M, ah(async (req, res) => {
      const o = await own('telas_offices', req.params.id, req.tenantId, 'Repartição');
      const b = req.body || {};
      const username = C.cleanOfficeUsername(b.username);
      const role = C.cleanOfficeRole(b.role ?? 'gestor');
      const pass = await hashPassword(C.cleanOfficePassword(b.password, username, config.production));
      const all = await usersOf(req.tenantId, o.id);
      if (all.length >= C.OFFICE_USERS_MAX) throw fail(409, `Limite de ${C.OFFICE_USERS_MAX} usuários por repartição.`);
      if (all.some((u) => u.username === username)) throw fail(409, 'Já existe um usuário com esse nome nesta repartição.');
      let id;
      try { id = await db.insert('INSERT INTO telas_office_users(tenant_id,office_id,username,name,pass,role,active,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)', [req.tenantId, o.id, username, line(b.name, LIMITS.name), pass, role, 1, who(req), now()]); } catch { throw fail(409, 'Já existe um usuário com esse nome nesta repartição.'); }
      // o primeiro usuário aposenta a senha única do link: ela é apagada e as sessões abertas com ela caem
      if (!all.length) await db.run('UPDATE telas_offices SET link_pass = NULL, pass_enc = NULL, link_ver = link_ver + 1 WHERE id = ? AND tenant_id = ?', [o.id, req.tenantId]);
      res.locals.audit = `prefeitura: usuário "${username}" (${role}) criado no painel da repartição "${o.name}"${all.length ? '' : ' (a senha única do link deixou de valer)'}`;
      noStore(res).status(201).json(officeUserDto(await db.get('SELECT * FROM telas_office_users WHERE id = ? AND tenant_id = ?', [id, req.tenantId])));
    }));
    app.patch('/api/prefeitura/offices/:id/users/:uid', M, ah(async (req, res) => {
      const o = await own('telas_offices', req.params.id, req.tenantId, 'Repartição');
      const u = await ownUser(o, req.params.uid);
      const b = req.body || {};
      const name = b.name === undefined ? u.name : line(b.name, LIMITS.name);
      const role = b.role === undefined ? u.role : C.cleanOfficeRole(b.role);
      const active = b.active === undefined ? Number(u.active) : (b.active ? 1 : 0);
      const pass = b.password === undefined || b.password === '' ? u.pass : await hashPassword(C.cleanOfficePassword(b.password, u.username, config.production));
      // senha, papel ou situação mudaram: a sessão aberta desse usuário cai
      const bump = pass !== u.pass || role !== u.role || active !== Number(u.active);
      await db.run('UPDATE telas_office_users SET name = ?, role = ?, active = ?, pass = ?, ver = ver + ?, updated_at = ? WHERE id = ? AND tenant_id = ?', [name, role, active, pass, bump ? 1 : 0, now(), u.id, req.tenantId]);
      const what = [pass !== u.pass ? 'senha trocada' : '', role !== u.role ? `papel: ${role}` : '', active !== Number(u.active) ? (active ? 'reativado' : 'desativado') : '', name !== u.name ? 'nome alterado' : ''].filter(Boolean).join(', ') || 'sem mudança';
      res.locals.audit = `prefeitura: usuário "${u.username}" do painel da repartição "${o.name}": ${what}`;
      noStore(res).json(officeUserDto(await db.get('SELECT * FROM telas_office_users WHERE id = ? AND tenant_id = ?', [u.id, req.tenantId])));
    }));
    app.delete('/api/prefeitura/offices/:id/users/:uid', M, ah(async (req, res) => {
      const o = await own('telas_offices', req.params.id, req.tenantId, 'Repartição');
      const u = await ownUser(o, req.params.uid);
      await db.run('DELETE FROM telas_office_users WHERE id = ? AND tenant_id = ?', [u.id, req.tenantId]);
      res.locals.audit = `prefeitura: usuário "${u.username}" do painel da repartição "${o.name}" apagado`;
      res.json({ ok: true });
    }));

    /* ---- grupos de telas: manuais (as telas escolhidas) ou automáticos por tipo de repartição */
    function readGroup(b, cur = null) {
      const has = (k) => b[k] !== undefined;
      let officeType = cur?.office_type || null;
      if (has('officeType')) {
        officeType = b.officeType == null || b.officeType === '' ? null : b.officeType;
        if (officeType && !OFFICE_TYPE_KEYS.includes(officeType)) throw fail(400, 'Tipo de repartição inválido.');
      }
      const sort = has('sort') ? Math.round(Number(b.sort)) : Number(cur?.sort) || 0;
      if (!Number.isInteger(sort) || Math.abs(sort) > 100000) throw fail(400, 'Ordem do grupo inválida.');
      return {
        name: has('name') || !cur ? C.cleanName(b.name, 'Nome do grupo') : cur.name, color: has('color') ? C.cleanColor(b.color) : cur?.color || null,
        description: has('description') ? line(b.description, LIMITS.description) : cur?.description || '', office_type: officeType, sort,
        config: JSON.stringify(C.mergeConfig(cur ? j(cur.config, {}) : {}, b.config, C.GROUP_CONFIG_KEYS)),
      };
    }
    async function setGroupDevices(x, tenantId, groupId, ids) {
      const want = [...new Set((Array.isArray(ids) ? ids : []).map((v) => idOf(v, 'Tela')))];
      if (want.length) {
        const ok = await x.all(`SELECT id FROM telas_devices WHERE tenant_id = ? AND id IN (${marks(want)})`, [tenantId, ...want]);
        if (ok.length !== want.length) throw fail(400, 'Tela inexistente.');
      }
      await x.run('DELETE FROM telas_group_devices WHERE group_id = ? AND tenant_id = ?', [groupId, tenantId]);
      for (const d of want) await x.run('INSERT INTO telas_group_devices(group_id,device_id,tenant_id,created_at) VALUES(?,?,?,?)', [groupId, d, tenantId, now()]);
    }
    const groupOut = async (id, tenantId) => groupDto(await db.get('SELECT * FROM telas_groups WHERE id = ? AND tenant_id = ?', [id, tenantId]),
      (await db.all('SELECT device_id FROM telas_group_devices WHERE group_id = ? AND tenant_id = ?', [id, tenantId])).map((r) => Number(r.device_id)));
    app.post('/api/prefeitura/groups', M, ah(async (req, res) => {
      await under('telas_groups', req.tenantId, LIMITS.groups, 'grupos');
      const g = readGroup(req.body || {});
      if (g.office_type && req.body?.deviceIds?.length) throw fail(400, 'Grupo automático não tem telas escolhidas à mão: ele segue o tipo da repartição.');
      const id = await db.tx(async (x) => {
        const gid = await x.insert('INSERT INTO telas_groups(tenant_id,name,color,description,office_type,sort,config,created_at) VALUES(?,?,?,?,?,?,?,?)', [req.tenantId, g.name, g.color, g.description, g.office_type, g.sort, g.config, now()]);
        if (!g.office_type && req.body?.deviceIds !== undefined) await setGroupDevices(x, req.tenantId, gid, req.body.deviceIds);
        return gid;
      });
      forget(req.tenantId);
      res.locals.audit = `prefeitura: grupo "${g.name}" criado (${g.office_type ? `automático: ${typeLabel(g.office_type)}` : 'manual'})`;
      res.status(201).json(await groupOut(id, req.tenantId));
    }));
    /** Um grupo automático para cada tipo de repartição em uso que ainda não tem o seu. */
    app.post('/api/prefeitura/groups/auto', M, ah(async (req, res) => {
      const used = (await db.all('SELECT DISTINCT type FROM telas_offices WHERE tenant_id = ?', [req.tenantId])).map((r) => r.type).filter((k) => OFFICE_TYPE[k]);
      const have = new Set((await db.all('SELECT office_type FROM telas_groups WHERE tenant_id = ? AND office_type IS NOT NULL', [req.tenantId])).map((r) => r.office_type));
      const made = [];
      for (const k of OFFICE_TYPE_KEYS.filter((x) => used.includes(x) && !have.has(x))) {
        await under('telas_groups', req.tenantId, LIMITS.groups, 'grupos');
        await db.insert('INSERT INTO telas_groups(tenant_id,name,description,office_type,sort,config,created_at) VALUES(?,?,?,?,?,?,?)', [req.tenantId, OFFICE_TYPE[k].short, `Todas as telas de ${OFFICE_TYPE[k].label}.`, k, 0, '{}', now()]);
        made.push(k);
      }
      forget(req.tenantId);
      res.locals.audit = `prefeitura: ${made.length} grupo(s) automático(s) por tipo criado(s)`;
      res.status(201).json({ created: made });
    }));
    app.patch('/api/prefeitura/groups/:id', M, ah(async (req, res) => {
      const cur = await own('telas_groups', req.params.id, req.tenantId, 'Grupo');
      const g = readGroup(req.body || {}, cur);
      if (g.office_type && req.body?.deviceIds?.length) throw fail(400, 'Grupo automático não tem telas escolhidas à mão: ele segue o tipo da repartição.');
      await db.tx(async (x) => {
        await x.run('UPDATE telas_groups SET name = ?, color = ?, description = ?, office_type = ?, sort = ?, config = ? WHERE id = ? AND tenant_id = ?', [g.name, g.color, g.description, g.office_type, g.sort, g.config, cur.id, req.tenantId]);
        if (g.office_type) await x.run('DELETE FROM telas_group_devices WHERE group_id = ? AND tenant_id = ?', [cur.id, req.tenantId]);
        else if (req.body?.deviceIds !== undefined) await setGroupDevices(x, req.tenantId, cur.id, req.body.deviceIds);
      });
      forget(req.tenantId);
      res.locals.audit = `prefeitura: grupo "${g.name}" alterado`;
      res.json(await groupOut(cur.id, req.tenantId));
    }));
    app.delete('/api/prefeitura/groups/:id', M, ah(async (req, res) => {
      const cur = await own('telas_groups', req.params.id, req.tenantId, 'Grupo');
      await db.tx(async (x) => {
        await x.run('DELETE FROM telas_group_devices WHERE group_id = ? AND tenant_id = ?', [cur.id, req.tenantId]);
        await conteudo.dropGroup(x, req.tenantId, cur.id); // os vídeos guardados do grupo
        await offImg.dropScope(x, req.tenantId, 'group', cur.id); // e a imagem sem internet dele
        await x.run('DELETE FROM telas_groups WHERE id = ? AND tenant_id = ?', [cur.id, req.tenantId]);
      });
      forget(req.tenantId);
      res.locals.audit = `prefeitura: grupo "${cur.name}" excluído`;
      res.json({ ok: true });
    }));

    /* ---- alertas */
    const PANEL_SCOPES = ['city', 'regions', 'groups', 'office', 'radius'];
    app.get('/api/prefeitura/alerts', M, ah(async (req, res) => {
      const t = now();
      const rows = await db.all(`${ALERT_SQL} WHERE a.tenant_id = ? ORDER BY a.id DESC LIMIT 200`, [req.tenantId]);
      const counts = new Map((await db.all('SELECT alert_id, COUNT(*) AS n FROM telas_alert_deliveries WHERE tenant_id = ? GROUP BY alert_id', [req.tenantId])).map((r) => [Number(r.alert_id), Number(r.n)]));
      const list = rows.map((a) => alertDto(a, t, counts.get(Number(a.id)) || 0));
      const live = (a) => a.status === 'em vigor' || a.status === 'agendado';
      noStore(res).json({ serverTime: t, active: list.filter(live), history: list.filter((a) => !live(a)) });
    }));
    app.get('/api/prefeitura/alerts/:id', M, ah(async (req, res) => {
      const a = await db.get(`${ALERT_SQL} WHERE a.id = ? AND a.tenant_id = ?`, [idOf(req.params.id), req.tenantId]);
      if (!a) throw fail(404, 'Alerta não encontrado.');
      const del = await db.all(`SELECT x.device_id, x.first_at, x.last_at, d.name AS d_name, o.name AS o_name FROM telas_alert_deliveries x
        LEFT JOIN telas_devices d ON d.id = x.device_id AND d.tenant_id = x.tenant_id LEFT JOIN telas_offices o ON o.id = d.office_id AND o.tenant_id = x.tenant_id
        WHERE x.alert_id = ? AND x.tenant_id = ? ORDER BY x.first_at`, [a.id, req.tenantId]);
      noStore(res).json({
        ...alertDto(a, now(), del.length), reach: await preview(req.tenantId, C.scopeFromRow(a)),
        deliveries: del.map((r) => ({ deviceId: Number(r.device_id), name: r.d_name || `tela #${r.device_id} (excluída)`, office: r.o_name || '', firstAt: Number(r.first_at), lastAt: Number(r.last_at) })),
      });
    }));
    app.post('/api/prefeitura/alerts/preview', M, ah(async (req, res) => {
      const scope = C.cleanScope(req.body?.scope, PANEL_SCOPES);
      await assertScope(req.tenantId, scope);
      res.json(await preview(req.tenantId, scope));
    }));
    app.post('/api/prefeitura/alerts', M, ah(async (req, res) => {
      const a = C.cleanAlert(req.body, { now: now(), allowed: PANEL_SCOPES });
      const cls = cleanClass(req.body?.class);
      // o tipo de aviso e a gravidade (contrato §9): Extremo é o nível máximo e pede a confirmação a mais
      const kind = cleanAlertKind(req.body);
      if (a.level === 'critical' && req.body?.confirmExtreme !== true) throw fail(400, 'Extremo é o nível máximo, só para risco iminente à vida ou ao patrimônio. Confirme o envio do alerta EXTREMO.', { code: 'confirm_extreme' });
      const info = { ...kind, header: headerFor({ level: a.level, test: kind.test, category: kind.category, issuer: { kind: 'panel' } }) };
      const out = await createAlert(req.tenantId, a, { by: who(req), cls, info });
      res.locals.audit = `prefeitura: alerta "${a.title}" (${a.level}${cls !== DEFAULT_CLASS ? `, ${cls}` : ''}) para ${scopeText(a.scope)}: ${out.reach.total} tela(s), ${out.reach.online} ligada(s)`;
      res.status(201).json(out);
    }));
    app.post('/api/prefeitura/alerts/:id/cancel', M, ah(async (req, res) => {
      const cur = await cancelAlert(req.tenantId, idOf(req.params.id), { by: who(req) });
      res.locals.audit = `prefeitura: alerta "${cur.title}" encerrado`;
      res.json({ ok: true });
    }));
    const bump = (tenantId) => forget(tenantId);
    // pessoas desaparecidas: /api/prefeitura/missing* (qualquer alcance, como os alertas do painel)
    desap.mount(app, '/api/prefeitura', M, (req) => ({ tenantId: req.tenantId, officeId: null, office: null, allowed: PANEL_SCOPES, fixScope: (s) => s, by: who(req) }), (req, res, out) => { if (out.log) res.locals.audit = out.log; });
    seguranca.mountPanel(app, { M, own, who, publicUrl }); // /api/prefeitura/panic* e a chave de integração do emissor conveniado
    interna.mountPanel(app, { M, own }); // marcar a tela como interna e os setores da repartição
    senha.mountPanel(app, { M, own, who, bump }); // /api/prefeitura/offices/:id/queue* e /api/prefeitura/queue/report
    conteudo.mountPanel(app, { M, own, who }); // cartões, aprovações, vídeos guardados, disponibilidade e o selo do menu
    offImg.mountPanel(app, { M, who }); // /api/prefeitura/offline-image* (a imagem sem internet de cada nível)
  }

  /* ================================================================ o link de controle da repartição */
  function mountOffice(app) {
    const BAD = 'Link, usuário ou senha inválidos.';
    const loginPerIp = createLimiter({ windowMs: 10 * 60_000, max: Number(process.env.TELAS_LINK_LOGIN_PER_IP) || 10, maxKeys: 100_000 });
    const loginPerLink = createLimiter({ windowMs: 10 * 60_000, max: Number(process.env.TELAS_LINK_LOGIN_PER_LINK) || 60, maxKeys: 50_000 });
    const loginPerUser = createLimiter({ windowMs: 10 * 60_000, max: Number(process.env.TELAS_LINK_LOGIN_PER_USER) || 8, maxKeys: 100_000 });
    const alertsPerOffice = createLimiter({ windowMs: 10 * 60_000, max: Number(process.env.TELAS_ALERTS_PER_OFFICE) || 10, maxKeys: 50_000 });
    // a auditoria leva quem fez: "repartição: <nome> (<usuário>)"
    const note = (req, action, detail, status = 200) => audit({ username: req.by.slice(0, 64), action, detail, status, ip: ipOf(req), tenantId: req.tenantId });

    // a página (sem login): o link vem no endereço; script e estilo saem daqui mesmo (CSP sem inline, sem nada de fora)
    const HEADERS = {
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
    };
    const sendPage = (file, type) => (_req, res) => { res.set({ ...HEADERS, 'Content-Type': type }).sendFile(path.join(PAGE, file)); };
    for (const f of PAGE_FILES) app.get(`/reparticao/${f}`, sendPage(f, f.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8'));
    app.get('/reparticao/:token([A-Za-z0-9_-]{32,64})', sendPage('index.html', 'text/html; charset=utf-8'));
    senha.mountTotem(app, { headers: HEADERS }); // /reparticao/<token do totem>/totem e /api/totem (só emite senha)
    senha.mountGuiche(app, { headers: HEADERS }); // /reparticao/<token do guichê>/guiche e /api/guiche (só chama e dá andamento)
    senha.mountSalaPages(app, { headers: HEADERS }); // §26 a §29: /reparticao/<token>/sala, /reparticao/<token>/apoio e /senha/<token> (o QR do acompanhante)

    app.post('/api/reparticao/login', ah(async (req, res) => {
      noStore(res);
      if (!loginPerIp.hit(ipKey(ipOf(req) || '-'))) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
      const token = typeof req.body?.token === 'string' && C.TOKEN_RE.test(req.body.token) ? req.body.token : null;
      const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
      const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase().slice(0, 64) : '';
      const hash = token ? sha256(token) : null;
      const row = hash ? await db.get('SELECT * FROM telas_offices WHERE link_hash = ?', [hash]) : null;
      // repartição COM usuários: só usuário + senha (a senha única do link deixou de valer). SEM nenhum: a senha do link,
      // com o campo Usuário vazio. Em todo caso uma conferência de senha só, do mesmo custo, e a mesma resposta
      let user = null; let stored = DUMMY_HASH; let open = false;
      if (row && (await hasUsers(Number(row.tenant_id), row.id))) {
        if (username) user = await db.get('SELECT * FROM telas_office_users WHERE office_id = ? AND tenant_id = ? AND username = ?', [row.id, row.tenant_id, username]);
        if (user && Number(user.active)) { stored = user.pass; open = true; } else user = null;
      } else if (row && !username && row.link_pass) { stored = row.link_pass; open = true; }
      // freios por link e por usuário (toda tentativa conta, certa ou errada)
      if (hash && !loginPerLink.hit(hash)) open = false;
      if (hash && username && !loginPerUser.hit(`${hash}:${username}`)) open = false;
      const ok = (await verifyPassword(password, open ? stored : DUMMY_HASH)) && open && (await available(Number(row.tenant_id)));
      if (!ok) return res.status(401).json({ error: BAD });
      const s = sessions.sign(row.id, row.link_ver, now(), user ? { id: user.id, ver: user.ver } : null);
      if (user) await db.run('UPDATE telas_office_users SET last_login = ? WHERE id = ? AND tenant_id = ?', [now(), user.id, row.tenant_id]);
      await audit({ username: C.officeActor(row.name, user?.username).slice(0, 64), action: 'POST /api/reparticao/login', detail: `prefeitura: entrada pelo link de controle da repartição${user ? ` (usuário ${user.username}, ${user.role})` : ''}`, status: 200, ip: ipOf(req), tenantId: Number(row.tenant_id) });
      res.json({ session: s.token, exp: s.exp, office: { name: row.name, type: row.type }, ...(user ? { user: { username: user.username, name: user.name || '', role: user.role } } : {}) });
    }));

    /**
     * Sessão do link -> a repartição (req.office), quem entrou (req.officeUser, ou null na senha única do link), o papel
     * (req.role) e o nome para a auditoria (req.by). Só ela: nada do pedido escolhe outra repartição nem outro cliente.
     */
    const GONE = 'Sessão encerrada. Entre de novo com a senha.';
    const office = ah(async (req, res, next) => {
      noStore(res);
      const s = sessions.read(/^Bearer (\S{20,200})$/.exec(req.get('authorization') || '')?.[1], now());
      const row = s ? await db.get('SELECT * FROM telas_offices WHERE id = ?', [s.officeId]) : null;
      if (!row || !row.link_hash || Number(row.link_ver) !== s.ver || !(await available(Number(row.tenant_id)))) return res.status(401).json({ error: GONE });
      let user = null;
      if (s.userId != null) {
        // a sessão de um usuário: ele ainda existe NESTA repartição, está ativo e não mudou de senha nem de papel
        user = await db.get('SELECT * FROM telas_office_users WHERE id = ? AND office_id = ? AND tenant_id = ?', [s.userId, row.id, row.tenant_id]);
        if (!user || !Number(user.active) || Number(user.ver) !== s.userVer) return res.status(401).json({ error: GONE });
      } else if (!row.link_pass || (await hasUsers(Number(row.tenant_id), row.id))) return res.status(401).json({ error: GONE }); // a senha única só vale sem usuários
      req.office = row; req.tenantId = Number(row.tenant_id);
      req.officeUser = user ? { id: Number(user.id), username: user.username, name: user.name || '', role: user.role } : null;
      req.role = user ? user.role : 'gestor';
      req.by = C.officeActor(row.name, user?.username);
      next();
    });
    /** Só o gestor (o atendente alcança apenas a chamada de senha: Atendimento e Recepção). */
    const gestorOnly = (req, res, next) => (req.role === 'gestor' ? next() : res.status(403).json({ error: 'O seu usuário só alcança a chamada de senha (Atendimento e Recepção).' }));
    const gestor = [office, gestorOnly];
    /** Só o gestor de uma repartição de alcance amplo (SECOM e Defesa Civil). */
    const wide = [office, gestorOnly, (req, res, next) => (isWide(req.office.type) ? next() : res.status(403).json({ error: 'Só a SECOM e a Defesa Civil alcançam a cidade.' }))];
    /** Só o gestor da SECOM. */
    const secom = [office, gestorOnly, (req, res, next) => (req.office.type === 'secom' ? next() : res.status(403).json({ error: 'Só a SECOM alcança isto.' }))];
    /** Quem aprova o que espera: o gestor da SECOM ou da Segurança (CCO). */
    const approver = [office, gestorOnly, (req, res, next) => (APPROVER_TYPES.includes(req.office.type) ? next() : res.status(403).json({ error: 'Só a SECOM e a Segurança (CCO) aprovam.' }))];
    // + 'reach' nas repartições de emergência: o "Alcance da prefeitura" marcado na ficha (Defesa Civil: todas as TV box)
    const scopesOf = (o) => [...(hasReach(o.type) ? ['reach'] : []), ...officeAlertScopes(o.type)];
    /**
     * O alcance pedido pelo link: "office" é sempre a PRÓPRIA repartição (o id do pedido não conta); "reach" é o que a
     * prefeitura marcou na ficha (nada do pedido além do kind conta).
     */
    const scopeFor = async (o, raw) => {
      const s = raw && typeof raw === 'object' ? raw : {};
      if (s.kind === 'office') return { kind: 'office', office: Number(o.id) };
      if (s.kind === 'reach' && hasReach(o.type)) return reachScope(await officeReach(Number(o.tenant_id), o), o.id);
      return s;
    };
    const officeScope = (req) => scopeFor(req.office, req.body?.scope);

    app.get('/api/reparticao/state', office, ah(async (req, res) => {
      const o = req.office; const t = now(); const tid = req.tenantId;
      const head = { serverTime: t, office: { name: o.name, type: o.type, typeLabel: typeLabel(o.type), family: familyOf(o.type), external: isExternal(o.type) }, user: req.officeUser, role: req.role, panic: Boolean(officeModules(o.type, j(o.modules, {})).panico) };
      // o atendente só recebe o que a tela do guichê usa: nada de avisos, alertas, cartões nem telas
      if (req.role !== 'gestor') { const m = officeModules(o.type, j(o.modules, {})); return res.json({ ...head, modules: { senha: m.senha, ...(m.interna ? { interna: true } : {}) } }); }
      const direct = isExternal(o.type) ? await issuerDirect(tid, o.id) : undefined;
      const wide = scopesOf(o).includes('city');
      const [devs, region, regions, groups, alerts] = await Promise.all([
        db.all('SELECT id, name, last_seen, online_since, state, revoked_at, config FROM telas_devices WHERE office_id = ? AND tenant_id = ? AND revoked_at IS NULL ORDER BY name, id', [o.id, tid]),
        o.region_id ? db.get('SELECT name FROM telas_regions WHERE id = ? AND tenant_id = ?', [o.region_id, tid]) : null,
        wide ? db.all('SELECT id, name FROM telas_regions WHERE tenant_id = ? ORDER BY name', [tid]) : [],
        wide ? db.all('SELECT id, name FROM telas_groups WHERE tenant_id = ? ORDER BY sort, id', [tid]) : [],
        db.all(`${ALERT_SQL} WHERE a.tenant_id = ? AND a.office_id = ? ORDER BY a.id DESC LIMIT 30`, [tid, o.id]),
      ]);
      const cfg = j(o.config, {});
      const def = await loadDefaults(tid);
      const mods = officeModules(o.type, j(o.modules, {}));
      // de onde vêm os avisos que cada tela recebe agora (a lista vazia da repartição devolve a vez à prefeitura)
      const tickerOf = new Map();
      for (const d of devs) {
        const gs = await deviceGroups({ id: d.id, tenant_id: tid, o_type: o.type });
        const r = C.tickerOrigin({ defaults: def.config, office: cfg, officeType: o.type, modules: j(o.modules, {}), groups: gs.map((g) => ({ name: g.name, config: j(g.config, {}) })), device: j(d.config, {}) });
        tickerOf.set(Number(d.id), { from: r.from, groups: r.groups, items: r.items.map((x) => splitAviso(x).text) });
      }
      // a rede inteira (quantas telas e quantas no ar) só para quem alcança a cidade; os modelos prontos de alerta também
      let network = null;
      if (wide && !isExternal(o.type)) { const all = await targets(tid); network = { total: all.length, online: all.filter((d) => d.lastSeen && t - d.lastSeen <= OFFLINE_MS).length, offices: new Set(all.map((d) => d.officeId)).size }; }
      res.json({
        ...head, office: { ...head.office, region: region?.name ?? null },
        ...(wide ? { ...(network ? { network } : {}), alertTexts: def.alertTexts } : {}), ...(direct === undefined ? {} : { direct }),
        // a SECOM escreve o aviso geral da prefeitura (os avisos do padrão: valem nas telas sem avisos mais específicos)
        ...(o.type === 'secom' ? { general: { items: def.config.tickerItems || [], max: LIMITS.tickerItems, maxLength: LIMITS.tickerItem } } : {}),
        avisos: { enabled: officeModules(o.type, j(o.modules, {})).avisos, items: cfg.tickerItems || [], max: LIMITS.tickerItems, maxLength: LIMITS.tickerItem },
        layout: cfg.layout || null, layouts: LAYOUT_KEYS, theme: cfg.theme || null,
        devices: devs.map((d) => ({ id: Number(d.id), name: d.name, lastSeen: num(d.last_seen), onlineSince: num(d.online_since), state: d.state || null, status: deviceStatus({ lastSeen: num(d.last_seen), state: d.state }, t), ticker: tickerOf.get(Number(d.id)) || null })),
        alertScopes: scopesOf(o), regions: regions.map((r) => ({ id: Number(r.id), name: r.name })), groups: groups.map((g) => ({ id: Number(g.id), name: g.name })),
        // o "Alcance da prefeitura" (repartição de emergência): o que a ficha marcou, em palavras, e se vai também ao ar do canal
        ...(hasReach(o.type) ? { reach: await (async () => { const r = await officeReach(tid, o); const names = { regions: await db.all('SELECT id, name FROM telas_regions WHERE tenant_id = ?', [tid]), groups: await db.all('SELECT id, name FROM telas_groups WHERE tenant_id = ?', [tid]) }; return { mode: r.mode, eas: r.eas, text: reachText(r, names), scope: reachScope(r, o.id) }; })() } : {}),
        alerts: alerts.map((a) => alertDto(a, t)),
        // fases 3 e 4: o que mais a repartição usa, a aprovação da SECOM (o que espera e o que foi recusado) e o período eleitoral
        modules: mods, approval: { on: def.extra.approval || isExternal(o.type), direct: ['defesa-civil', 'seguranca'].includes(o.type), requests: await conteudo.requestsOf(tid, Number(o.id)) },
        electoral: { on: electoralOn(def.extra.electoral, t), ...(def.extra.electoral || {}) },
      });
    }));
    app.put('/api/reparticao/avisos', gestor, ah(async (req, res) => {
      const o = req.office; const b = req.body || {};
      const input = {};
      if (b.items !== undefined) {
        if (!officeModules(o.type, j(o.modules, {})).avisos) throw fail(403, 'Os avisos desta repartição estão desligados pela prefeitura.');
        input.tickerItems = b.items;
      }
      if (b.layout !== undefined) input.layout = b.layout;
      if (b.theme !== undefined) input.theme = b.theme; // §15: a cor e o claro/escuro dos painéis de senha
      // com a aprovação da SECOM ligada, os avisos escritos pelo link esperam (o formato da tela não é conteúdo: vale na hora)
      let pending = null;
      if (input.tickerItems !== undefined && (await conteudo.approvalOn(req.tenantId))) {
        const items = C.cleanTicker(Array.isArray(input.tickerItems) ? input.tickerItems : []);
        delete input.tickerItems;
        if (JSON.stringify(items) !== JSON.stringify(j(o.config, {}).tickerItems || [])) {
          pending = await conteudo.request(req.tenantId, Number(o.id), { kind: 'avisos', payload: { items }, cls: items.some((x) => splitAviso(x).class === 'institucional') ? 'institucional' : DEFAULT_CLASS, summary: `${items.length} aviso(s): ${items.map((x) => splitAviso(x).text).join(' · ')}`, by: req.by });
        }
      }
      const cfg = patchConfig(j(o.config, {}), input, ['layout', 'tickerItems', 'theme']);
      await db.run('UPDATE telas_offices SET config = ?, updated_at = ? WHERE id = ? AND tenant_id = ?', [JSON.stringify(cfg), now(), o.id, req.tenantId]);
      forget(req.tenantId);
      await note(req, 'PUT /api/reparticao/avisos', pending ? `prefeitura: avisos da repartição enviados para aprovação pelo link de controle (pedido #${pending.id})` : `prefeitura: avisos da repartição alterados pelo link de controle (${(cfg.tickerItems || []).length} aviso(s)${cfg.layout ? `, layout ${cfg.layout}` : ''})`, pending ? 202 : 200);
      res.status(pending ? 202 : 200).json({ items: cfg.tickerItems || [], layout: cfg.layout || null, theme: cfg.theme || null, ...(pending ? { pending: true, approval: pending } : {}) });
    }));
    app.post('/api/reparticao/alerts/preview', gestor, ah(async (req, res) => {
      const scope = C.cleanScope(await officeScope(req), scopesOf(req.office));
      await assertScope(req.tenantId, scope);
      res.json(await preview(req.tenantId, scope));
    }));
    /**
     * O alerta de uma repartição (pelo link de controle ou pela chave de integração de um emissor conveniado): a mesma
     * validação, o mesmo freio, a mesma aprovação e a mesma auditoria. Devolve { status, body, log }.
     */
    async function officeAlert(o, body, { by, via = 'pelo link de controle' }) {
      const tenantId = Number(o.tenant_id); const officeId = Number(o.id);
      const a = C.cleanAlert({ ...body, scope: await scopeFor(o, body?.scope) }, { now: now(), allowed: scopesOf(o) });
      if (!alertsPerOffice.hit(String(officeId))) throw fail(429, 'Alertas demais em pouco tempo. Aguarde alguns minutos.');
      const cls = cleanClass(body?.class);
      // o tipo de aviso e a gravidade (contrato §9 e §10): o catálogo é das repartições emissoras (Defesa Civil, Segurança,
      // Polícia Civil e Militar), cada uma com as categorias dela; nelas, Extremo pede a confirmação a mais. As outras
      // repartições seguem como antes (só ganham "AVISO · nome" no informativo)
      const emitter = Boolean(issuerOf(o.type));
      const kind = emitter ? cleanAlertKind(body) : { category: null, kind: null, test: false };
      const cats = alertCategoriesOf(o.type);
      if (isExternal(o.type) && !kind.category) throw fail(400, 'Escolha a categoria e o tipo do aviso.');
      if (kind.category && cats && !cats.includes(kind.category)) throw fail(403, 'Esta categoria de aviso não é do seu órgão.');
      if (emitter && a.level === 'critical' && body?.confirmExtreme !== true) throw fail(400, 'Extremo é o nível máximo, só para risco iminente à vida ou ao patrimônio. Confirme o envio do alerta EXTREMO.', { code: 'confirm_extreme' });
      const info = { ...kind, header: headerFor({ level: a.level, test: kind.test, category: kind.category, issuer: { kind: 'office', type: o.type, name: line(o.name, 48) } }) };
      // quem espera: o emissor conveniado (órgão de fora) espera o CCO, a não ser que a prefeitura o tenha liberado para
      // emitir direto; com a aprovação da SECOM ligada, as repartições comuns esperam. A Defesa Civil e a Segurança não
      // esperam (urgente: sai na hora, marcado "sem aprovação")
      const approval = await conteudo.approvalOn(tenantId);
      const external = isExternal(o.type);
      const waits = external ? !(await issuerDirect(tenantId, officeId)) : approval && !['defesa-civil', 'seguranca'].includes(o.type);
      if (waits) {
        await assertScope(tenantId, a.scope);
        const p = await conteudo.request(tenantId, officeId, { kind: 'alert', payload: { ...a, info }, cls, summary: `alerta "${a.title}" (${a.level}) para ${scopeText(a.scope)}`, by });
        return { status: 202, body: { pending: true, approval: p, reach: await preview(tenantId, a.scope) }, log: `prefeitura: alerta "${a.title}" (${a.level}) enviado para aprovação ${via} (pedido #${p.id})` };
      }
      const out = await createAlert(tenantId, a, { by, officeId, cls, flag: approval || external ? 'sem-aprovacao' : null, info });
      if (approval || external) await conteudo.request(tenantId, officeId, { kind: 'alert', refId: out.alert.id, payload: a, cls, summary: `alerta "${a.title}" (${a.level}) para ${scopeText(a.scope)}: saiu na hora (${external ? 'emissor liberado para emitir direto' : typeLabel(o.type)})`, by, status: 'auto' });
      return { status: 201, body: out, log: `prefeitura: alerta "${a.title}" (${a.level}) ${via}, para ${scopeText(a.scope)}: ${out.reach.total} tela(s)${approval || external ? ` (${external ? 'emissor liberado' : typeLabel(o.type)}: sem esperar a aprovação)` : ''}${out.eas ? `; alerta de emergência no ar de ${out.eas.channels} canal(is)${out.eas.error ? ` (${out.eas.error})` : ''}` : ''}` };
    }
    app.post('/api/reparticao/alerts', gestor, ah(async (req, res) => {
      const out = await officeAlert(req.office, req.body || {}, { by: req.by });
      await note(req, 'POST /api/reparticao/alerts', out.log, out.status);
      res.status(out.status).json(out.body);
    }));
    app.post('/api/reparticao/alerts/:id/cancel', gestor, ah(async (req, res) => {
      // só os alertas que ESTA repartição mandou
      const cur = await cancelAlert(req.tenantId, idOf(req.params.id), { by: req.by, officeId: Number(req.office.id) });
      await note(req, 'POST /api/reparticao/alerts/cancel', `prefeitura: alerta "${cur.title}" encerrado pelo link de controle`);
      res.json({ ok: true });
    }));

    /* ---- as TV box da repartição: tudo o que o Painel da Prefeitura faz numa tela, só nas telas DESTA repartição (a
       repartição vem da sessão e entra em toda consulta; tela de outra repartição ou de outro cliente = inexistente) */
    const ownDevice = async (req) => {
      const d = await db.get('SELECT * FROM telas_devices WHERE id = ? AND tenant_id = ? AND office_id = ?', [idOf(req.params.id, 'Tela'), req.tenantId, req.office.id]);
      if (!d) throw fail(404, 'Tela não encontrada.');
      return d;
    };
    app.get('/api/reparticao/devices', gestor, ah(async (req, res) => {
      const t = now(); const o = req.office;
      const [devs, keys, groups, links, avail] = await Promise.all([
        db.all('SELECT * FROM telas_devices WHERE office_id = ? AND tenant_id = ? ORDER BY name, id', [o.id, req.tenantId]),
        db.all('SELECT * FROM telas_keys WHERE office_id = ? AND tenant_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC', [o.id, req.tenantId, t]),
        loadGroups(req.tenantId),
        db.all('SELECT l.group_id, l.device_id FROM telas_group_devices l JOIN telas_devices d ON d.id = l.device_id AND d.tenant_id = l.tenant_id WHERE l.tenant_id = ? AND d.office_id = ?', [req.tenantId, o.id]),
        conteudo.availabilityOf(req.tenantId, t),
      ]);
      const manual = new Map();
      for (const l of links) { const k = Number(l.device_id); if (!manual.has(k)) manual.set(k, new Set()); manual.get(k).add(Number(l.group_id)); }
      const av = new Map(avail.map((a) => [a.id, a]));
      res.json({
        serverTime: t, offlineMs: OFFLINE_MS, layout: j(o.config, {}).layout || null, layouts: LAYOUT_KEYS, commands: COMMAND_KEYS,
        // os grupos da tela: só o nome (quem põe a tela num grupo é a prefeitura)
        devices: devs.map((d) => ({ ...deviceDto(d), groups: groupsFor(groups, manual.get(Number(d.id)) || new Set(), o.type).map((g) => g.name), d7: av.get(Number(d.id))?.d7 ?? null, d30: av.get(Number(d.id))?.d30 ?? null })),
        keys: keys.map(keyDto),
      });
    }));
    app.patch('/api/reparticao/devices/:id', gestor, ah(async (req, res) => {
      const cur = await ownDevice(req);
      if (cur.revoked_at) throw fail(409, 'A tela está revogada.');
      const out = await patchDevice(req.tenantId, cur, req.body || {}, { keys: C.OFFICE_DEVICE_CONFIG_KEYS });
      await note(req, 'PATCH /api/reparticao/devices', `prefeitura: tela "${out.name}" (#${cur.id}) alterada pelo painel da repartição`);
      res.json({ ...out, groups: undefined });
    }));
    app.post('/api/reparticao/devices/:id/commands', gestor, ah(async (req, res) => {
      const cur = await ownDevice(req);
      const out = await queueCommand(req.tenantId, cur, req.body?.type, req.by);
      await note(req, 'POST /api/reparticao/devices/commands', `prefeitura: comando ${out.type} para a tela "${cur.name}" (#${cur.id}) pelo painel da repartição`, 201);
      res.status(201).json(out);
    }));
    app.get('/api/reparticao/devices/:id/screenshot', gestor, ah(async (req, res) => sendShot(res, req.tenantId, await ownDevice(req))));
    app.post('/api/reparticao/devices/:id/revoke', gestor, ah(async (req, res) => {
      const cur = await ownDevice(req);
      await revokeDevice(req.tenantId, cur);
      await note(req, 'POST /api/reparticao/devices/revoke', `prefeitura: tela "${cur.name}" (#${cur.id}) revogada pelo painel da repartição (o aparelho volta à tela da chave)`);
      res.json({ ok: true });
    }));
    app.delete('/api/reparticao/devices/:id', gestor, ah(async (req, res) => {
      const cur = await ownDevice(req);
      await deleteDevice(req.tenantId, cur);
      await note(req, 'DELETE /api/reparticao/devices', `prefeitura: tela "${cur.name}" (#${cur.id}) excluída pelo painel da repartição`);
      res.json({ ok: true });
    }));
    // a chave de ativação de uma TV box nova, já vinculada a ESTA repartição (o pedido não escolhe outra)
    const keysPerOffice = createLimiter({ windowMs: 10 * 60_000, max: 20, maxKeys: 50_000 });
    app.post('/api/reparticao/keys', gestor, ah(async (req, res) => {
      if (!keysPerOffice.hit(String(req.office.id))) return res.status(429).json({ error: 'Chaves demais em pouco tempo. Aguarde alguns minutos.' });
      const k = await newAccessKey(req.tenantId, req.office, req.body?.name, req.by);
      await note(req, 'POST /api/reparticao/keys', `prefeitura: chave de acesso gerada para "${req.office.name}"${k.deviceName ? ` (${k.deviceName})` : ''} pelo painel da repartição`, 201);
      res.status(201).json(k);
    }));
    app.delete('/api/reparticao/keys/:id', gestor, ah(async (req, res) => {
      const r = await db.run('DELETE FROM telas_keys WHERE id = ? AND tenant_id = ? AND office_id = ? AND used_at IS NULL', [idOf(req.params.id), req.tenantId, req.office.id]);
      if (!r.changes) throw fail(404, 'Chave não encontrada.');
      await note(req, 'DELETE /api/reparticao/keys', 'prefeitura: chave de acesso apagada antes do uso pelo painel da repartição');
      res.json({ ok: true });
    }));

    /* ---- o mapa do alcance (SECOM e Defesa Civil): o contorno guardado do município, as regiões e as repartições do cliente
       com o ponto, o tipo e quantas telas têm. Nada além disso: nem endereço, nem responsável, nem dado de aparelho */
    app.get('/api/reparticao/mapa', wide, ah(async (req, res) => {
      const tid = req.tenantId; const t = now(); const ext = isExternal(req.office.type); // órgão de fora: só o nome e o ponto das repartições
      const [m, regions, offices, devs] = await Promise.all([
        municipioApi.get(tid),
        db.all('SELECT id, name, color FROM telas_regions WHERE tenant_id = ? ORDER BY name', [tid]),
        db.all('SELECT id, name, type, lat, lng, region_id FROM telas_offices WHERE tenant_id = ? ORDER BY name', [tid]),
        targets(tid),
      ]);
      const by = new Map();
      for (const d of devs) {
        const x = by.get(d.officeId) || { devices: 0, online: 0, groups: new Set() };
        x.devices++; if (d.lastSeen && t - d.lastSeen <= OFFLINE_MS) x.online++;
        for (const g of d.groups) x.groups.add(g);
        by.set(d.officeId, x);
      }
      res.json({
        serverTime: t,
        municipio: m ? { name: m.name, uf: m.uf, bbox: m.bbox, polygons: m.outline.polygons } : null,
        regions: regions.map(regionDto),
        offices: offices.map((o) => { const x = by.get(Number(o.id)); const base = { id: Number(o.id), name: o.name, type: o.type, lat: num(o.lat), lng: num(o.lng), regionId: num(o.region_id) }; return ext ? base : { ...base, devices: x?.devices || 0, online: x?.online || 0, groups: x ? [...x.groups] : [] }; }),
      });
    }));

    /* ---- o aviso geral da prefeitura, escrito pela SECOM no link dela: são os avisos do padrão da prefeitura (valem nas
       telas que não têm avisos mais específicos: da repartição, do grupo ou da própria tela) */
    app.put('/api/reparticao/geral', secom, ah(async (req, res) => {
      const items = C.cleanTicker(Array.isArray(req.body?.items) ? req.body.items : null);
      const raw = j(await getSetting(C.settingsKey(req.tenantId), ''), {});
      raw.config = patchConfig(raw.config && typeof raw.config === 'object' ? raw.config : {}, { tickerItems: items }, ['tickerItems']);
      await setSetting(C.settingsKey(req.tenantId), JSON.stringify(raw));
      forget(req.tenantId);
      await note(req, 'PUT /api/reparticao/geral', `prefeitura: aviso geral da prefeitura alterado pela SECOM no link de controle (${items.length} aviso(s))`);
      res.json({ items: raw.config.tickerItems || [] });
    }));

    // pessoas desaparecidas: /api/reparticao/missing* (só o gestor da Defesa Civil e da SECOM; "office" = a própria repartição)
    const cases = [...wide, (req, res, next) => (req.office.type === 'policia-militar' ? res.status(403).json({ error: 'A Polícia Militar emite alertas; desaparecidos e cartelas são da Polícia Civil, da Defesa Civil, da Segurança e da SECOM.' }) : next())];
    desap.mount(app, '/api/reparticao', cases,
      (req) => ({ tenantId: req.tenantId, officeId: Number(req.office.id), office: req.office, allowed: scopesOf(req.office), fixScope: (s) => (s && s.kind === 'office' ? { kind: 'office', office: Number(req.office.id) } : s), by: req.by }),
      async (req, res, out, action) => { if (out.log) await note(req, action, `${out.log} pelo link de controle`, out.status || 200); });

    seguranca.mountOffice(app, { office, gestorOnly, note }); // /api/reparticao/panic* (o botão de pânico e as ocorrências do CCO)
    interna.mountStaff(app, { headers: HEADERS }); // /interno/<token> e /api/interno* (o celular do funcionário: avisos com "Li" e códigos)
    interna.mountOffice(app, { office, gestorOnly, note }); // /api/reparticao/codes* e /api/reparticao/interna*
    // a chave de integração do emissor conveniado: só alertas, pelo mesmo caminho do link
    seguranca.mountApi(app, {
      officeAlert,
      alertsOf: async (o) => {
        const t = now();
        const rows = await db.all(`${ALERT_SQL} WHERE a.tenant_id = ? AND a.office_id = ? ORDER BY a.id DESC LIMIT 50`, [o.tenant_id, o.id]);
        return { serverTime: t, alerts: rows.map((a) => alertDto(a, t)), requests: (await conteudo.requestsOf(Number(o.tenant_id), Number(o.id))).filter((r) => r.kind === 'alert').map((r) => ({ id: r.id, status: r.status, summary: r.summary, requestedAt: r.requestedAt, decidedAt: r.decidedAt, note: r.note })) };
      },
      cancelOf: (o, id, by) => cancelAlert(Number(o.tenant_id), idOf(id), { by, officeId: Number(o.id) }),
    });
    senha.mountOffice(app, { office, note, bump: (tenantId) => forget(tenantId) }); // /api/reparticao/queue* (recepção e guichê)
    conteudo.mountOffice(app, { office, gestor, secom, approver, note }); // /api/reparticao/cards* e /api/reparticao/approvals* (SECOM)
    // a imagem sem internet da própria repartição (o emissor conveniado não tem telas próprias para isso)
    // TV Corporativa (família F11): mídias, comunicados e aniversariantes da própria unidade corporativa
    if (tvcorp) tvcorp.mountOffice(app, { guard: gestor, note });
    if (tvcorpDados) tvcorpDados.mountOffice(app, { office, gestorOnly, note });
    offImg.mountOffice(app, { guard: [...gestor, (req, res, next) => (isExternal(req.office.type) ? res.status(403).json({ error: 'O emissor conveniado só emite o que o convênio permite.' }) : next())], note });
  }

  /* ---------------------------------------------------------------- limpeza: chaves vencidas e comandos antigos */
  async function prune(t = now()) {
    await db.run('DELETE FROM telas_keys WHERE expires_at < ?', [t - 7 * 86400_000]);
    await db.run('DELETE FROM telas_commands WHERE created_at < ?', [t - 30 * 86400_000]);
    await senha.prune(t); // senhas e chamadas: 90 dias; as de ontem saem da fila
    await conteudo.prune(t);
    await desap.prune(t);
    await offImg.prune(t); // as imagens sem internet que nenhum nível cita
    await interna.prune(t); // avisos internos, leituras e códigos: 90 dias
    if (tvcorpDados) await tvcorpDados.prune(t).catch((err) => console.warn('[telas] tv corporativa:', err.message)); // sugestões, séries e arquivos sem dono
    await seguranca.prune(t); // o histórico do botão de pânico: 90 dias // casos vencidos, encerrados há mais de 90 dias e fotos que ninguém cita
    await db.run('DELETE FROM telas_alert_info WHERE alert_id NOT IN (SELECT id FROM telas_alerts)');
  }
  // a virada do dia: as senhas de ontem que ficaram esperando saem da fila (a numeração recomeça pelo dia, não por isto)
  if (timers) setInterval(() => senha.prune().catch((err) => console.warn('[telas] senhas:', err.message)), 15 * 60_000).unref?.();
  if (timers) setInterval(() => prune().catch((err) => console.warn('[telas] limpeza:', err.message)), 6 * 3600_000).unref?.();

  return {
    mount(app, deps) {
      mountDevice(app); mountPanel(app, deps); mountOffice(app);
      // a rede de telas da TV Corporativa: as mesmas rotas do painel em /api/tvcorp/rede/* com tvcorp.manage (a guarda do
      // plano "* /api/tvcorp*" é a funcionalidade tvcorp); município, desaparecidos e o alcance de emergência ficam fora
      if (tvcorp) mountPanel(redeApp(app), { ...deps, needs: (p) => deps.needs(p === 'prefeitura.manage' ? 'tvcorp.manage' : p) });
    },
    forget, prune, preview, targets, configFor, senha, conteudo, desap, offImg,
    /** O município de um cliente, para o Superadmin trocar ou tirar (o painel do cliente só define na primeira vez). */
    get municipio() { return municipioApi; },
    interna,
    stop() { senha.stop(); conteudo.stop(); desap.stop(); interna.stop(); tvcorp?.stop?.(); tvcorpDados?.stop?.(); },
  };
}
