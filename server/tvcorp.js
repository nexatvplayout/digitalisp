/* NEXA Telas · TV Corporativa, pacote A (docs/TV-CORPORATIVA.md §3.1, §4 e §5): o servidor do conteúdo, da grade e da
   exibição. As regras sem banco ficam em tvcorp-core.js, a imagem e a logomarca em tvcorp-midia.js e o catálogo em
   public/shared/tvcorp-tipos.js. A TV box continua falando só com /api/telas/* (server/telas.js): o coordenador põe a chave
   `signage` no /config pelo signageFor() daqui e repassa o `plays` do sinal de vida ao recordPlays().

   Painel (sessão do painel, tvcorp.manage, acesso a todos os canais; a guarda do plano "* /api/tvcorp*" é do catálogo)
     GET    /api/tvcorp                         tudo de uma vez: configurações, unidades, grupos, telas, layouts, playlists, grades
     GET    /api/tvcorp/badge                   o selo do menu: telas desligadas e pedidos aguardando
     GET    /api/tvcorp/summary                 o Resumo
     PUT    /api/tvcorp/settings                tema, fuso, aprovação, grade padrão, categorias, datas comemorativas
     GET|PUT|DELETE /api/tvcorp/settings/logo   a logomarca (PUT com a imagem crua no corpo)
     GET|POST /api/tvcorp/media, POST /api/tvcorp/media/image (imagem crua), GET|PATCH|DELETE /api/tvcorp/media/:id (imagem: PATCH { page } guarda o desenho do construtor de páginas),
       PUT /api/tvcorp/media/:id/image (troca a imagem), GET /api/tvcorp/media/:id/file
     GET|POST /api/tvcorp/playlists, GET|PATCH|DELETE /api/tvcorp/playlists/:id, PUT /api/tvcorp/playlists/:id/items
     GET|POST /api/tvcorp/layouts, GET|PATCH|DELETE /api/tvcorp/layouts/:id
     GET|POST /api/tvcorp/schedules, GET|PATCH|DELETE /api/tvcorp/schedules/:id, POST /api/tvcorp/schedules/preview
     GET    /api/tvcorp/devices/:id/now         o que a tela está mostrando agora
     GET    /api/tvcorp/commands                o histórico dos comandos enviados às telas
     GET    /api/tvcorp/reports/plays|hours     relatório de exibição e horas em exibição (format=csv para planilha)
     GET    /api/tvcorp/approvals, POST /api/tvcorp/approvals/:id/decide   a fila de aprovação da TV Corporativa
   Link da unidade (mountOffice: sessão do link + gestor; só a própria unidade; vai para a aprovação quando ligada)
     GET|POST /api/reparticao/tvcorp/media, POST /api/reparticao/tvcorp/media/image, GET …/:id/file, DELETE …/:id
   Integração (chave de integração da unidade, telas_api_keys; funcionalidades tvcorp e api no plano)
     POST   /api/tvcorp-api/media/image         publica (ou troca, com ?id=) uma imagem, por exemplo o painel de BI

   O cliente vem sempre da credencial; mídia, playlist, layout, grade, unidade, grupo ou tela de outro cliente = 404. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import {
  TVC_LIMITS as L, TVC_SLIDE_MODEL, TVC_REF_KIND, TVC_APPROVAL_KINDS, TVC_PLAYLIST_ZONES, TVC_ART, isTvcOfficeType, itemRef, parseItemRef, slideOrientOf,
} from '../public/shared/tvcorp-tipos.js';
import { deviceStatus } from '../public/shared/telas-tipos.js';
import * as K from './tvcorp-core.js';
import { prepareMediaImage, prepareLogo } from './tvcorp-midia.js';
import { VIDEO, convertVideo, receiveUpload, enqueue } from './tvcorp-video.js';
import { cleanPage } from '../public/shared/pagina.js';
import { intercalar, zonaDaPermuta } from './tvcorp-permuta.js';

const { fail, line, idOf, parseJson: j } = K;
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const num = (v) => (v == null ? null : Number(v));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const MEDIA_PREFIX = 'tvcmedia-';
export const LOGO_PREFIX = 'tvclogo-';
export const MEDIA_RE = /^tvcmedia-[0-9a-f-]{36}\.(?:jpg|mp4)$/; // .mp4: o vídeo próprio da playlist (tvcorp-video.js)
export const LOGO_RE = /^tvclogo-[0-9a-f-]{36}\.png$/;
const CACHE_MS = 30_000;
const SENT_KEEP_MS = 48 * 3600_000;
const BEAT_GAP_MS = 120_000;
const PRUNE_MS = 6 * 3600_000;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const AUTO_LABEL = { birthdays: 'Aniversariantes', news: 'Notícias', quotes: 'Cotações', posts: 'Comunicados em vigor' };

/**
 * deps:
 *   db           o banco (server/db.js: get, all, run, insert, tx)
 *   storage      os arquivos em graphics/: { dir, put(nome), remove(nome), url(nome, req) -> endereço público (https para a
 *                tela), read(nome) -> Buffer, list?() -> [{ name, mtime }] }
 *   ffmpeg       o caminho do FFmpeg (config.ffmpeg); checkImage(buf) opcional (16 MP pelo cabeçalho, server/cg/env.js)
 *   dataFor      (tenantId, officeId, { kind, id, params }) -> item | [itens] | null: os itens automáticos (pacote B)
 *   labelFor     (tenantId, refKind, refId) -> nome | null: o nome de comunicado, indicador, widget e fonte nos relatórios (B)
 *   refExists    (tenantId, refKind, refId) -> bool: confere o id de comunicado, indicador, widget e fonte na playlist (B)
 *   decideOther  (tenantId, approvalRow, approve, by, note): aprovação dos tipos que não são deste pacote (tvc-post, B)
 *   hasFeature   (tenantId, chave) -> bool: a rota da chave de integração só monta com ele (tvcorp e api no plano)
 *   pendingOther (tenantId) -> número: o que espera fora da fila deste pacote (comunicados e sugestões do pacote B), no selo e no Resumo
 *   forget       (tenantId): a configuração das telas mudou (server/telas.js refaz o rev)
 *   artFile      (chave, req) -> { url, sha256, bytes } | null: a foto de fundo do slide (fields.art), que vai como fields.artFile
 *   audit        (entrada) da auditoria (server/auth.js), para as rotas sem sessão do painel; ipOf(req)
 */
export function createTvcorp({
  db, storage, ffmpeg = null, checkImage = null, dataFor = null, labelFor = null, refExists = null, decideOther = null, hasFeature = null, pendingOther = null,
  forget = () => {}, audit = async () => {}, ipOf = (req) => req.ip, now = () => Date.now(), timers = true, artFile = null,
  audioOf = null, // (tenantId, layoutId) -> o bloco layout.audio (a rádio de fundo) ou null
  storageCheck = null, // (tenantId, bytes): o 402 do armazenamento do plano antes de aceitar um vídeo
  weatherArt = null, // (cond, req) -> { art, artPort }: a foto de fundo do item de clima
  originOf = null, // (req) -> https://site: completa os endereços relativos dos itens (a foto da notícia)
  widgetFallback = null, // (tenantId, sample) -> id de um gadget do cliente: a zona de gadget sem gadget escolhido não fica vazia na TV
  rodizio = null, // DIGITAL ISP: o rodízio de DEMONSTRAÇÃO (server/tvcorp-demo-rodizio.js): { layoutDe, ler, salvar, ligada }
  permuta = null, // DIGITAL ISP: a PERMUTA (server/tvcorp-permuta.js): async (tenantId, deviceId) -> { revendaId, items } | null
}) {
  if (!db) throw new Error('createTvcorp: falta o banco');
  const noStore = (res) => res.set('Cache-Control', 'no-store');
  const hold = K.createHold({ now });

  /* ================================================================ leituras guardadas por cliente */
  const cache = new Map(); // tenantId -> { at, data }
  function changed(tenantId) { cache.delete(Number(tenantId)); try { forget(Number(tenantId)); } catch { /* o telas.js refaz depois */ } }
  const wallDto = (r) => ({ id: Number(r.id), name: r.name, data: j(r.data, {}), createdAt: Number(r.created_at), updatedAt: num(r.updated_at) });
  /** Os dados do dia a dia de um cliente (30 s, ou até a próxima mudança). */
  async function load(tenantId) {
    const id = Number(tenantId); const t = now();
    const c = cache.get(id);
    if (c && t - c.at < CACHE_MS) return c.data;
    const [srow, layouts, schedules, playlists, items, media, walls] = await Promise.all([
      db.get('SELECT data FROM tvcorp_settings WHERE tenant_id = ?', [id]),
      db.all('SELECT * FROM tvcorp_layouts WHERE tenant_id = ?', [id]),
      db.all('SELECT * FROM tvcorp_schedules WHERE tenant_id = ?', [id]),
      db.all('SELECT * FROM tvcorp_playlists WHERE tenant_id = ?', [id]),
      db.all('SELECT * FROM tvcorp_playlist_items WHERE tenant_id = ? ORDER BY playlist_id, sort, id', [id]),
      db.all('SELECT * FROM tvcorp_media WHERE tenant_id = ?', [id]),
      db.all('SELECT * FROM tvcorp_walls WHERE tenant_id = ?', [id]),
    ]);
    const data = {
      settings: j(srow?.data, {}),
      layouts: new Map(layouts.map((r) => [Number(r.id), layoutDto(r)])),
      schedules: schedules.map(scheduleDto),
      playlists: new Map(playlists.map((r) => [Number(r.id), { ...playlistDto(r), items: [] }])),
      media: new Map(media.map((r) => [Number(r.id), r])),
      walls: walls.map(wallDto),
    };
    for (const it of items) data.playlists.get(Number(it.playlist_id))?.items.push(itemDto(it));
    cache.set(id, { at: t, data });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return data;
  }
  const settingsOf = async (tenantId) => j((await db.get('SELECT data FROM tvcorp_settings WHERE tenant_id = ?', [tenantId]))?.data, {});
  async function saveSettings(tenantId, data) {
    await db.run(`INSERT INTO tvcorp_settings(tenant_id,data,updated_at) VALUES(?,?,?)
      ON CONFLICT (tenant_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`, [tenantId, JSON.stringify(data), now()]);
    changed(tenantId);
  }
  const tzOf = (settings) => settings?.tz || K.DEFAULT_TZ;

  /* ================================================================ DTOs */
  function mediaDto(r) {
    return {
      id: Number(r.id), officeId: num(r.office_id), kind: r.kind, title: r.title, template: r.template || null, fields: j(r.fields, {}), seconds: Number(r.seconds),
      status: r.status, width: num(r.width), height: num(r.height), bytes: num(r.bytes), sha256: r.sha256 || null,
      file: r.kind === 'image' ? `/api/tvcorp/media/${Number(r.id)}/file` : null,
      poster: r.kind === 'video' && j(r.fields, {}).poster ? `/api/tvcorp/media/${Number(r.id)}/poster` : null, createdBy: r.created_by || '', createdAt: Number(r.created_at), updatedAt: num(r.updated_at),
    };
  }
  function playlistDto(r) {
    return { id: Number(r.id), officeId: num(r.office_id), name: r.name, description: r.description || '', shuffle: Number(r.shuffle) === 1, sort: Number(r.sort) || 0, createdAt: Number(r.created_at), updatedAt: num(r.updated_at) };
  }
  function itemDto(r) {
    return {
      id: Number(r.id), refKind: r.ref_kind, refId: num(r.ref_id) || null, params: j(r.params, {}), seconds: Number(r.seconds) || L.secondsDefault, sort: Number(r.sort) || 0,
      validFrom: r.valid_from || null, validTo: r.valid_to || null, days: K.daysOf(r.days), timeFrom: num(r.time_from), timeTo: num(r.time_to),
    };
  }
  function layoutDto(r) {
    return { id: Number(r.id), name: r.name, orientation: r.orientation, zones: j(r.zones, []), background: r.background || null, factoryKey: r.factory_key || null, createdAt: Number(r.created_at), updatedAt: num(r.updated_at) };
  }
  function scheduleDto(r) {
    return {
      id: Number(r.id), name: r.name, layoutId: Number(r.layout_id), zonePlaylists: j(r.zone_playlists, {}), scope: K.scopeFromRow(r), days: K.daysOf(r.days),
      timeFrom: Number(r.time_from), timeTo: Number(r.time_to), dateFrom: r.date_from || null, dateTo: r.date_to || null, priority: Number(r.priority) || 0,
      status: r.status, createdBy: r.created_by || '', createdAt: Number(r.created_at), updatedAt: num(r.updated_at),
    };
  }

  /* ================================================================ conferências */
  async function own(table, id, tenantId, what) {
    const n = Number(id);
    const row = Number.isInteger(n) && n > 0 ? await db.get(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ?`, [n, tenantId]) : null;
    if (!row) throw fail(404, `${what} não encontrad${/^(Layout|Grupo|Pedido|Conjunto)/.test(what) ? 'o' : 'a'}.`);
    return row;
  }
  async function under(table, tenantId, max, what) {
    if (Number((await db.get(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ?`, [tenantId])).n) >= max) throw fail(409, `Limite de ${max} ${what} atingido.`);
  }
  async function assertScope(tenantId, scope) {
    const map = { regions: ['telas_regions', 'Região'], offices: ['telas_offices', 'Unidade'], groups: ['telas_groups', 'Grupo'], devices: ['telas_devices', 'Tela'] };
    const m = map[scope.kind];
    if (!m) return;
    for (const id of scope[scope.kind]) await own(m[0], id, tenantId, m[1]);
  }
  /** As imagens citadas num slide: do cliente e imagens de verdade (slide não cita slide). */
  async function assertSlideMedia(tenantId, ids) {
    for (const id of ids) {
      const r = await own('tvcorp_media', id, tenantId, 'Imagem do slide');
      if (r.kind !== 'image') throw fail(400, 'O campo de imagem do slide aceita só imagens da biblioteca.');
    }
  }
  async function cleanScheduleFull(tenantId, b, cur) {
    const s = K.cleanSchedule(b, cur);
    const lay = layoutDto(await own('tvcorp_layouts', s.layoutId, tenantId, 'Layout'));
    const zoneIds = new Set(lay.zones.map((z) => z.id));
    for (const [z, p] of Object.entries(s.zonePlaylists)) {
      if (!zoneIds.has(z)) throw fail(400, `O layout "${lay.name}" não tem a zona "${z}".`);
      if (!TVC_PLAYLIST_ZONES.includes(lay.zones.find((x) => x.id === z).kind)) throw fail(400, `A zona "${z}" não recebe playlist.`);
      await own('tvcorp_playlists', p, tenantId, 'Playlist');
    }
    await assertScope(tenantId, s.scope);
    return s;
  }

  /* ================================================================ arquivos */
  const fileOf = (name) => path.join(storage.dir, name);
  async function dropFile(name) {
    if (!name || !(MEDIA_RE.test(name) || LOGO_RE.test(name))) return;
    try { await storage.remove(name); } catch (err) { console.warn(`[tvcorp] arquivo antigo não saiu do armazenamento (${String(err?.message || err).slice(0, 120)})`); }
    await fs.promises.rm(fileOf(name), { force: true }).catch(() => {});
  }
  async function keepFile(name, buf) {
    await fs.promises.mkdir(storage.dir, { recursive: true });
    await fs.promises.writeFile(fileOf(name), buf);
    try { await storage.put(name); } catch { await fs.promises.rm(fileOf(name), { force: true }).catch(() => {}); throw fail(502, 'Não foi possível guardar o arquivo agora. Tente de novo.'); }
  }
  async function keepPath(name, src) {
    await fs.promises.mkdir(storage.dir, { recursive: true });
    await fs.promises.copyFile(src, fileOf(name));
    try { await storage.put(name); } catch { await fs.promises.rm(fileOf(name), { force: true }).catch(() => {}); throw fail(502, 'Não foi possível guardar o arquivo agora. Tente de novo.'); }
  }
  async function readFile(name) {
    try { return await storage.read(name); } catch { throw fail(404, 'O arquivo não está disponível agora.'); }
  }
  const rawBody = (limit) => express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit });
  const tooBig = (err, _req, res, next) => (err?.type === 'entity.too.large' ? res.status(413).json({ error: 'O arquivo é grande demais. Escolha outro.' }) : next(err));
  const needBody = (req) => { if (!Buffer.isBuffer(req.body) || !req.body.length) throw fail(415, 'Envie a imagem (JPEG, PNG ou WebP) no corpo do pedido.'); return req.body; };
  const sendFile = (res, buf, type) => res.set({ 'Content-Type': type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' }).send(buf);

  /* ================================================================ mídias */
  async function approvalOn(tenantId) { return Boolean((await settingsOf(tenantId)).approval); }
  async function requestApproval(tenantId, officeId, kind, refId, summary, by) {
    await db.insert('INSERT INTO telas_approvals(tenant_id,office_id,kind,ref_id,payload,summary,status,requested_by,requested_at) VALUES(?,?,?,?,?,?,?,?,?)',
      [tenantId, officeId || 0, kind, refId, '{}', line(summary, 200), 'pending', line(by, 64), now()]);
  }
  /** Imagem nova (ou troca da imagem de uma mídia que já existe, mantendo o id nas playlists). */
  async function storeImage(tenantId, buf, { officeId = null, title = '', seconds = null, opts = {}, by = '', status = 'ok', replace = null, caption = '' }) {
    const o = K.cleanImageOptions(opts);
    const out = await prepareMediaImage(buf, { ffmpeg, checkImage, ...o });
    const name = `${MEDIA_PREFIX}${randomUUID()}.jpg`;
    await keepFile(name, out.buf);
    const sha = sha256(out.buf); const t = now();
    try {
      if (replace) {
        await db.run('UPDATE tvcorp_media SET file = ?, sha256 = ?, bytes = ?, width = ?, height = ?, updated_at = ?' + (title ? ', title = ?' : '') + ' WHERE id = ? AND tenant_id = ?',
          [name, sha, out.buf.length, out.width, out.height, t, ...(title ? [title] : []), replace.id, tenantId]);
        changed(tenantId);
        await dropFile(replace.file);
        return Number(replace.id);
      }
      await under('tvcorp_media', tenantId, L.media, 'mídias');
      const id = Number(await db.insert('INSERT INTO tvcorp_media(tenant_id,office_id,kind,title,file,sha256,bytes,width,height,template,fields,seconds,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [tenantId, officeId, 'image', title || 'Imagem', name, sha, out.buf.length, out.width, out.height, null, JSON.stringify(caption ? { caption: line(caption, L.title) } : {}), K.cleanSeconds(seconds), status, line(by, 64), t, t]));
      changed(tenantId);
      return id;
    } catch (err) { await dropFile(name); throw err; }
  }
  async function createSlide(tenantId, b, { officeId = null, by = '', status = 'ok' }) {
    const template = b?.template;
    const { fields, mediaIds } = K.cleanSlide(template, b?.fields);
    await assertSlideMedia(tenantId, mediaIds);
    await under('tvcorp_media', tenantId, L.media, 'mídias');
    const title = line(b?.title, L.title) || fields.title || TVC_SLIDE_MODEL[template].label;
    const t = now();
    const id = Number(await db.insert('INSERT INTO tvcorp_media(tenant_id,office_id,kind,title,file,sha256,bytes,width,height,template,fields,seconds,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [tenantId, officeId, 'slide', title, null, null, null, null, null, template, JSON.stringify(fields), K.cleanSeconds(b?.seconds), status, line(by, 64), t, t]));
    changed(tenantId);
    return id;
  }
  /** Apaga a mídia: some das playlists e o arquivo sai do armazenamento. */
  async function removeMedia(tenantId, row) {
    await db.tx(async (x) => {
      await x.run("DELETE FROM tvcorp_playlist_items WHERE tenant_id = ? AND ref_kind = 'media' AND ref_id = ?", [tenantId, row.id]);
      await x.run('DELETE FROM tvcorp_media WHERE id = ? AND tenant_id = ?', [row.id, tenantId]);
      await x.run("UPDATE telas_approvals SET status = 'superseded', decided_at = ? WHERE tenant_id = ? AND kind = 'tvc-media' AND ref_id = ? AND status = 'pending'", [now(), tenantId, row.id]);
    });
    changed(tenantId);
    await dropFile(row.file);
    if (row.kind === 'video') await dropFile(j(row.fields, {}).poster);
  }
  const officeNameOf = async (tenantId, officeId) => (officeId ? (await db.get('SELECT name FROM telas_offices WHERE id = ? AND tenant_id = ?', [officeId, tenantId]))?.name || null : null);

  /* ================================================================ o que vai à tela (signage) */
  /** Os grupos da tela: os manuais (telas_group_devices) e os automáticos do tipo da unidade. */
  async function groupIdsOf(tenantId, deviceId, officeType) {
    const rows = await db.all(`SELECT g.id FROM telas_groups g WHERE g.tenant_id = ? AND (g.office_type = ? OR g.id IN (SELECT group_id FROM telas_group_devices WHERE device_id = ? AND tenant_id = ?))`,
      [tenantId, officeType ?? '', deviceId, tenantId]);
    return rows.map((r) => Number(r.id));
  }
  const fileUrl = (name, req) => { try { return storage.url(name, req); } catch { return null; } };
  /** A imagem da biblioteca no formato do contrato, ou null (pendente, devolvida, apagada ou sem endereço https). */
  function imageFile(media, id, req) {
    const r = media.get(Number(id));
    if (!r || r.kind !== 'image' || r.status !== 'ok' || !MEDIA_RE.test(String(r.file || ''))) return null;
    return K.fileContract(fileUrl(r.file, req), r.sha256, r.bytes);
  }
  /** Os itens de um item da playlist (zero, um ou vários: "todos os comunicados em vigor"). */
  async function itemsOf(tenantId, officeId, it, data, req, at = null) {
    const ref = itemRef(it.refKind, it.refId);
    const when = K.itemWhen(it);
    if (it.refKind === 'media') {
      const r = data.media.get(Number(it.refId));
      if (!r || r.status !== 'ok') return [];
      if (r.kind === 'image') {
        const f = imageFile(data.media, r.id, req);
        const caption = line(j(r.fields, {}).caption, L.title);
        return f ? [{ id: ref, kind: 'image', seconds: it.seconds, ...f, ...(caption ? { caption } : {}), fit: 'contain', ...when }] : [];
      }
      if (r.kind === 'video') {
        // o vídeo próprio: toca inteiro (a duração é a do arquivo); sound: o som do vídeo (desligado se não foi escolhido)
        if (!MEDIA_RE.test(String(r.file || ''))) return [];
        const f = K.fileContract(fileUrl(r.file, req), r.sha256, r.bytes);
        const fx = j(r.fields, {});
        return f ? [{ id: ref, kind: 'video', seconds: Number(r.seconds) || it.seconds, ...f, width: num(r.width), height: num(r.height), sound: Boolean(fx.sound), fit: 'contain', ...when }] : [];
      }
      const model = TVC_SLIDE_MODEL[r.template];
      if (!model) return [];
      const fields = { ...j(r.fields, {}) };
      for (const f of model.fields) {
        if (f.type !== 'media' || fields[f.key] == null) continue;
        const file = imageFile(data.media, fields[f.key], req);
        if (file) fields[f.key] = file; else { if (f.required) return []; delete fields[f.key]; }
      }
      // os campos derivados que o app desenha: as linhas do texto, os pratos do cardápio e o número do indicador
      const lines = fields.text ? fields.text.split('\n').filter(Boolean) : [];
      if (r.template === 'cardapio') fields.items = lines;
      else if (lines.length > 1) fields.lines = lines;
      // a foto de fundo (fields.art = foto-*): o arquivo vai junto, para o app baixar, guardar e desenhar atrás do texto com o
      // véu escuro (Android: o desenho nativo; contrato combinado com a sessão do app, 22/11/2026). Arte SVG: sem arquivo.
      if (fields.art && artFile) {
        const a = TVC_ART[fields.art]; const raw = a?.photo ? artFile(fields.art, req) : null;
        const file = raw ? K.fileContract(raw.url, raw.sha256, raw.bytes) : null;
        if (file) fields.artFile = { ...file, photo: true, tone: a.tone === 'light' ? 'light' : 'dark' };
      }
      if (r.template === 'indicador') fields.kpi = { value: fields.value, ...(fields.target ? { target: fields.target } : {}), ...(fields.unit ? { unit: fields.unit } : {}) };
      return [{ id: ref, kind: 'slide', seconds: it.seconds, template: r.template, fields, ...when }];
    }
    if (it.refKind === 'card') {
      const c = await hold.get(`${tenantId}:card:${it.refId}`, () => db.get('SELECT * FROM telas_cards WHERE id = ? AND tenant_id = ?', [it.refId, tenantId]));
      if (!c) return [];
      const lines = j(c.lines, []).map((x) => (typeof x === 'string' ? x : x?.text || [x?.label, x?.value].filter(Boolean).join(': '))).filter(Boolean);
      return [{ id: ref, kind: 'slide', seconds: it.seconds, template: 'comunicado', fields: { title: line(c.title, L.title), text: K.text(lines.join('\n'), L.text), lines: lines.slice(0, L.textLines).map((x) => line(x, L.title)) }, ...when }];
    }
    if (!dataFor) return [];
    // o pedido ao pacote B: { ref_kind, ref_id, params } ("posts" = a lista dos comunicados em vigor = post sem id). O
    // alcance dos comunicados depende da tela: a chave segurada leva a tela nesses casos
    const kindB = it.refKind === 'posts' ? 'post' : it.refKind;
    const perDevice = kindB === 'post' && at ? `:d${at.deviceId}` : '';
    const ctx = at ? { deviceId: at.deviceId, groupIds: at.groupIds, regionId: at.regionId } : {};
    const got = await hold.get(`${tenantId}:${officeId ?? 0}:${it.refKind}:${it.refId ?? 0}:${JSON.stringify(it.params || {})}${perDevice}`,
      () => dataFor(tenantId, officeId, { ref_kind: kindB, ref_id: it.refId ?? null, params: it.params || {}, kind: kindB, id: it.refId ?? null }, ctx));
    const list = (Array.isArray(got) ? got : got ? [got] : []).map(K.cleanProvided).filter(Boolean);
    return list.map((x0) => {
      const x = { ...x0 };
      // comunicado com imagem da biblioteca: o pacote B manda o id (mediaId); a tela recebe o arquivo { url, sha256, bytes }
      if (x.mediaId != null) { const f = imageFile(data.media, x.mediaId, req); delete x.mediaId; if (f) x.image = f; }
      if (typeof x.image?.url === 'string' && x.image.url.startsWith('/')) { const o = originOf && req ? originOf(req) : null; if (o) x.image = { ...x.image, url: `${o}${x.image.url}` }; else delete x.image; }
      const own = x.id != null && parseItemRef(x.id) ? String(x.id) : null;
      return { ...x, id: own || ref, seconds: Number.isInteger(x.seconds) && x.seconds >= L.secondsMin && x.seconds <= L.secondsMax ? x.seconds : it.seconds, ...when };
    });
  }
  /** O bloco do contrato para uma grade (null se o layout sumiu). */
  async function blockOf(tenantId, officeId, s, data, req, { fallback = false, seed = '', at = null } = {}) {
    const lay = data.layouts.get(Number(s.layoutId));
    if (!lay) return null;
    const layout = {
      orientation: lay.orientation, background: K.COLOR_RE.test(String(lay.background || '')) ? lay.background : '#000000',
      zones: lay.zones.map(({ hint, ...z }) => ({ ...z })),
    };
    // a rádio de fundo (layout sem vídeo do canal): o app toca o stream no volume da tela; o app antigo ignora
    const audio = audioOf ? audioOf(tenantId, lay.id) : null;
    if (audio && !layout.zones.some((z) => z.kind === 'video' || z.kind === 'hdmi')) layout.audio = audio;
    const zones = {};
    // a playlist escolhida no layout é o padrão da zona; a da grade (ou da programação da tela) vence
    const zp = { ...Object.fromEntries(lay.zones.filter((z) => z.playlist != null).map((z) => [z.id, z.playlist])), ...K.zonePlaylistsFor(lay.zones, s.zonePlaylists) };
    const today = K.localParts(now(), tzOf(data.settings)).day;
    for (const [zone, pid] of Object.entries(zp)) {
      const pl = data.playlists.get(Number(pid));
      if (!pl) continue;
      const out = [];
      for (const it of pl.items) {
        if (!K.itemInWindow(it, today)) continue;
        out.push(...await itemsOf(tenantId, officeId, it, data, req, at));
        if (out.length >= L.itemsPerZone) break;
      }
      // o mesmo id duas vezes na zona (comunicado citado sozinho e em "todos"): fica o primeiro
      const seen = new Set();
      const uniq = out.filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
      zones[zone] = (pl.shuffle ? K.dayShuffle(uniq, `${seed}:${today}:${pid}`) : uniq).slice(0, L.itemsPerZone);
    }
    // o gadget escolhido direto na zona do layout (contador, dias sem acidente, relógio mundial): sem playlist
    for (const z of lay.zones) {
      if (zones[z.id]?.length) continue;
      // zona de gadget sem gadget escolhido (ou com um que sumiu): vai o gadget do cliente do mesmo tipo, ou outro que ele tenha
      const ids = [];
      if (z.widget != null) ids.push(Number(z.widget));
      if (z.kind === 'widget' && widgetFallback) {
        const alt = await Promise.resolve(widgetFallback(tenantId, z.sample || null)).catch(() => null);
        if (alt != null && !ids.includes(Number(alt))) ids.push(Number(alt));
      }
      for (const wid of ids) {
        const items = await itemsOf(tenantId, officeId, { refKind: 'widget', refId: wid, seconds: L.secondsMax, params: {} }, data, req, at);
        if (items.length) { zones[z.id] = items; break; }
      }
    }
    // DIGITAL ISP: a zona do tipo Notícias mostra só notícias. Da playlist dela ficam as notícias; sem nenhuma (ou sem
    // playlist), entram sozinhas as notícias de todas as fontes de notícias ligadas da empresa, uma por vez com a foto
    for (const z of lay.zones.filter((x) => x.kind === 'news')) {
      const own = (zones[z.id] || []).filter((x) => x.kind === 'news');
      if (own.length) { zones[z.id] = own; continue; }
      const feeds = await db.all("SELECT id FROM tvcorp_feeds WHERE tenant_id = ? AND kind = 'rss' AND enabled = 1 ORDER BY id", [tenantId]).catch(() => []);
      const out = [];
      for (const f of feeds) out.push(...await itemsOf(tenantId, officeId, { refKind: 'news', refId: Number(f.id), seconds: 12, params: {} }, data, req, at));
      if (out.length) zones[z.id] = out.slice(0, L.itemsPerZone); else delete zones[z.id];
    }
    // DIGITAL ISP: todo slide tem as duas versões (deitado e em pé): a zona escolhe (slideOrientOf). Só a zona bem mais larga
    // que alta (1,3:1 ou mais, na tela de verdade) recebe o deitado; a quadrada ou alta, o em pé, com a letra no tamanho certo.
    for (const z of lay.zones) {
      const list = zones[z.id]; if (!list?.length) continue;
      const orient = slideOrientOf(z, lay.orientation); // DIGITAL ISP: zona quase quadrada também recebe o slide em pé
      zones[z.id] = list.map((it) => {
        if (it.kind === 'slide' && it.fields && it.fields.orient !== orient) return { ...it, fields: { ...it.fields, orient } };
        if (it.kind === 'weather' && weatherArt && !it.art) { const a = weatherArt(it.cond, req); return a ? { ...it, ...a } : it; }
        return it;
      });
    }
    return {
      id: `s${s.id}`, layout,
      days: fallback || !s.days.length ? ALL_DAYS : s.days,
      from: fallback ? 0 : s.timeFrom, to: fallback ? 1440 : s.timeTo,
      dateFrom: fallback ? null : s.dateFrom, dateTo: fallback ? null : s.dateTo,
      zones,
    };
  }
  /** A resolução sem montar os itens: as grades que pegam a tela, o bloco de agora e o relógio. */
  async function resolveFor(tenantId, at, extra = null) {
    const data = await load(tenantId);
    const tz = tzOf(data.settings);
    const parts = K.localParts(now(), tz);
    let schedules = extra ? [...data.schedules.filter((s) => s.id !== extra.id), extra] : data.schedules;
    // o rodízio de DEMONSTRAÇÃO: por cima de tudo nesta tela, o layout da vez (troca sozinho a cada intervalo)
    const dz = rodizio && at?.deviceId ? await rodizio.layoutDe(tenantId, at.deviceId, now(), (id) => data.layouts.has(Number(id))).catch(() => null) : null;
    if (dz) schedules = [...schedules, { id: 9_000_000 + dz.pos, name: 'Demonstração (rodízio)', layoutId: dz.layoutId, zonePlaylists: {}, scope: { kind: 'devices', devices: [Number(at.deviceId)] }, days: [], timeFrom: 0, timeTo: 1440, dateFrom: null, dateTo: null, priority: L.priorityMax + 1, status: 'ok' }];
    const { blocks, fallback } = K.resolveBlocks(schedules, at, { today: parts.day, fallbackId: data.settings.defaultSchedule ?? null });
    return { data, tz, parts, blocks, fallback, current: K.blockNow(blocks, fallback, parts) };
  }
  const sent = new Map(); // "tenant:tela" -> Map(ref -> quando foi mandado)
  function remember(tenantId, deviceId, signage) {
    const key = `${tenantId}:${deviceId}`; const t = now();
    const m = sent.get(key) || new Map();
    for (const b of signage?.blocks || []) for (const items of Object.values(b.zones)) for (const it of items) m.set(it.id, t);
    for (const [r, at] of m) if (t - at > SENT_KEEP_MS) m.delete(r);
    sent.delete(key); sent.set(key, m);
    while (sent.size > 50_000) sent.delete(sent.keys().next().value);
  }
  /**
   * A chave `signage` do /config (contrato §4.1) para uma tela, ou null (nenhuma grade pega a tela: a chave não vai).
   * device: a linha de telas_devices (id, tenant_id, office_id); office: a linha de telas_offices (type, region_id);
   * groups: os ids (ou as linhas) dos grupos da tela; opts.req: o pedido (para o endereço público dos arquivos).
   * Só para a tela de unidade corporativa (tipo do catálogo corporativo); as outras recebem null.
   */
  async function signageFor(tenantId, device, office, groups = [], { req = null } = {}) {
    const tid = Number(tenantId);
    if (!device || !office || !isTvcOfficeType(office.type)) return null;
    const at = { deviceId: Number(device.id), officeId: Number(office.id ?? device.office_id), regionId: num(office.region_id), groupIds: (groups || []).map((g) => Number(typeof g === 'object' ? g.id : g)) };
    const { data, tz, blocks, fallback } = await resolveFor(tid, at);
    if (!blocks.length && !fallback) { remember(tid, at.deviceId, null); return null; }
    const out = [];
    for (const s of blocks) { const b = await blockOf(tid, at.officeId, s, data, req, { seed: at.deviceId, at }); if (b) out.push(b); }
    let fb = null;
    if (fallback) { fb = await blockOf(tid, at.officeId, fallback, data, req, { fallback: true, seed: at.deviceId, at }); if (fb) out.push(fb); }
    if (!out.length) { remember(tid, at.deviceId, null); return null; }
    await comPropaganda(tid, at, out, req);
    K.applyCaps(out);
    const st = K.settingsDto(data.settings);
    const logo = data.settings.logo && LOGO_RE.test(String(data.settings.logo.file || '')) ? K.fileContract(fileUrl(data.settings.logo.file, req), data.settings.logo.sha256, data.settings.logo.bytes, L.logoBytes) : null;
    // a tela num conjunto (cardápio por tela ou videowall): a posição dela e as contas comuns (o app antigo ignora)
    const wall = data.walls.map((w) => K.wallFor(w, at.deviceId)).find(Boolean) || null;
    const signage = { tz, brand: { logo, color: st.theme.color, mode: st.theme.mode }, blocks: out, fallback: fb ? fb.id : null, ...(wall ? { wall } : {}) };
    remember(tid, at.deviceId, signage);
    return signage;
  }

  /**
   * DIGITAL ISP · a PERMUTA: a propaganda obrigatória da revenda (mídias e playlists da biblioteca dela) na zona de playlist
   * maior de cada bloco, intercalada com a programação do cliente. Os ids levam a revenda (r<id>-m12): não se confundem
   * com os itens do cliente. Qualquer falha deixa a programação do cliente como está.
   */
  async function comPropaganda(tid, at, blocks, req) {
    if (!permuta) return;
    let p = null; try { p = await permuta(tid, at.deviceId); } catch { p = null; }
    if (!p?.revendaId || !p.items?.length) return;
    const rid = Number(p.revendaId);
    const rdata = await load(rid);
    const today = K.localParts(now(), tzOf(rdata.settings)).day;
    const ads = [];
    for (const x of p.items) {
      if (x.kind === 'media') {
        const m = rdata.media.get(Number(x.id));
        if (m) ads.push(...await itemsOf(rid, null, { refKind: 'media', refId: Number(x.id), seconds: Number(m.seconds) || L.secondsDefault, params: {} }, rdata, req));
      } else {
        const pl = rdata.playlists.get(Number(x.id));
        for (const it of pl?.items || []) {
          if (it.refKind !== 'media' || !K.itemInWindow(it, today)) continue; // da revenda vão só as mídias (imagem, vídeo, slide)
          ads.push(...await itemsOf(rid, null, it, rdata, req));
        }
      }
    }
    const seen = new Set();
    const lista = ads.map((a) => ({ ...a, id: `r${rid}-${a.id}` })).filter((a) => (seen.has(a.id) ? false : seen.add(a.id)));
    if (!lista.length) return;
    for (const b of blocks) {
      const z = zonaDaPermuta(b.layout.zones);
      if (!z) continue;
      const orient = slideOrientOf(z, b.layout.orientation);
      const meus = lista.map((it) => (it.kind === 'slide' && it.fields && it.fields.orient !== orient ? { ...it, fields: { ...it.fields, orient } } : it));
      b.zones[z.id] = intercalar(b.zones[z.id] || [], meus, L.itemsPerZone);
    }
  }

  /* ================================================================ sinal de vida: plays e horas em exibição */
  const lastBeat = new Map(); // "tenant:tela" -> quando
  const lastPlays = new Map(); // "tenant:tela" -> { at, list }
  /**
   * Chamado a CADA sinal de vida aceito da tela (com ou sem `plays`): soma o tempo ligada em tvcorp_hours e o `plays` em
   * tvcorp_plays (só os itens que a tela recebeu nas últimas 48 h; o resto é ignorado). device: a linha de telas_devices;
   * body: o corpo do sinal de vida ({ plays, playsDay }); ctx: { office, groups, req } para refazer a lista do que a tela
   * recebeu depois de o servidor reiniciar. Devolve { accepted, ignored }.
   */
  async function recordPlays(tenantId, device, body = {}, ctx = {}) {
    const tid = Number(tenantId); const did = Number(device?.id);
    if (!Number.isInteger(did) || did < 1) return { accepted: 0, ignored: 0 };
    const t = now();
    const settings = (await load(tid)).settings;
    const today = K.localParts(t, tzOf(settings)).day;
    const key = `${tid}:${did}`;
    const prev = lastBeat.get(key);
    lastBeat.delete(key); lastBeat.set(key, t);
    while (lastBeat.size > 50_000) lastBeat.delete(lastBeat.keys().next().value);
    if (prev && t - prev > 0 && t - prev <= BEAT_GAP_MS) {
      await db.run(`INSERT INTO tvcorp_hours(tenant_id,device_id,day,on_sec) VALUES(?,?,?,?)
        ON CONFLICT (tenant_id, device_id, day) DO UPDATE SET on_sec = tvcorp_hours.on_sec + excluded.on_sec`, [tid, did, today, Math.round((t - prev) / 1000)]);
    }
    const { day, list } = K.cleanPlays(body, { today });
    if (!list.length) return { accepted: 0, ignored: Array.isArray(body?.plays) ? body.plays.length : 0 };
    if (!sent.has(key) && ctx.office) await signageFor(tid, device, ctx.office, ctx.groups || [], { req: ctx.req || null }).catch(() => null);
    const okRefs = sent.get(key) || new Map();
    const good = list.filter((p) => okRefs.has(p.ref));
    for (const p of good) {
      await db.run(`INSERT INTO tvcorp_plays(tenant_id,device_id,day,ref_kind,ref_id,plays,seconds) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT (tenant_id, device_id, day, ref_kind, ref_id) DO UPDATE SET plays = tvcorp_plays.plays + excluded.plays, seconds = tvcorp_plays.seconds + excluded.seconds`,
      [tid, did, day, p.refKind, p.refId, p.n, p.sec]);
    }
    if (good.length) { lastPlays.delete(key); lastPlays.set(key, { at: t, list: good.map((p) => ({ ref: p.ref, n: p.n, sec: p.sec })) }); }
    while (lastPlays.size > 50_000) lastPlays.delete(lastPlays.keys().next().value);
    return { accepted: good.length, ignored: (Array.isArray(body?.plays) ? body.plays.length : 0) - good.length };
  }

  /* ================================================================ nomes nos relatórios */
  async function namesFor(tenantId, rows) {
    const data = await load(tenantId);
    const out = new Map();
    for (const r of rows) {
      const k = `${r.ref_kind}:${Number(r.ref_id)}`;
      if (out.has(k)) continue;
      let name = null;
      if (r.ref_kind === 'media') name = data.media.get(Number(r.ref_id))?.title ?? null;
      else if (r.ref_kind === 'card') name = (await db.get('SELECT title FROM telas_cards WHERE id = ? AND tenant_id = ?', [r.ref_id, tenantId]))?.title ?? null;
      else if (labelFor) { try { name = await labelFor(tenantId, r.ref_kind, Number(r.ref_id) || null); } catch { name = null; } }
      if (!name) name = AUTO_LABEL[r.ref_kind] && !Number(r.ref_id) ? AUTO_LABEL[r.ref_kind] : `${TVC_REF_KIND[r.ref_kind]?.label || r.ref_kind} #${Number(r.ref_id)}${r.ref_kind === 'media' ? ' (apagada)' : ''}`;
      out.set(k, line(name, 120));
    }
    return out;
  }
  /** Início do dia local (epoch ms) no fuso. */
  function dayStart(day, tz) {
    let guess = Date.parse(`${day}T00:00:00Z`);
    for (let i = 0; i < 3; i++) {
      const p = K.localParts(guess, tz);
      const wall = Date.parse(`${p.day}T00:00:00Z`) + p.minute * 60_000;
      const diff = wall - Date.parse(`${day}T00:00:00Z`);
      if (!diff) break;
      guess -= diff;
    }
    return guess;
  }

  /* ================================================================ resumo */
  async function corpDevices(tenantId) {
    const rows = await db.all(`SELECT d.id, d.name, d.office_id, d.last_seen, d.state, d.revoked_at, d.online_since, d.android, o.name AS office_name, o.type AS office_type
      FROM telas_devices d JOIN telas_offices o ON o.id = d.office_id AND o.tenant_id = d.tenant_id WHERE d.tenant_id = ? AND d.revoked_at IS NULL ORDER BY d.id`, [tenantId]);
    return rows.filter((r) => isTvcOfficeType(r.office_type)).map((r) => ({
      id: Number(r.id), name: r.name, officeId: Number(r.office_id), office: r.office_name, lastSeen: num(r.last_seen), system: r.android || '',
      status: deviceStatus({ revokedAt: num(r.revoked_at), lastSeen: num(r.last_seen), state: r.state }, now()),
    }));
  }
  const pendingCount = async (tenantId) => (pendingOther ? Number(await Promise.resolve(pendingOther(tenantId)).catch(() => 0)) || 0 : 0) + Number((await db.get(`SELECT COUNT(*) AS n FROM telas_approvals WHERE tenant_id = ? AND status = 'pending' AND kind IN (${TVC_APPROVAL_KINDS.map(() => '?').join(',')})`, [tenantId, ...TVC_APPROVAL_KINDS])).n);
  async function summary(tenantId) {
    const data = await load(tenantId);
    const tz = tzOf(data.settings);
    const today = K.localParts(now(), tz).day;
    const devs = await corpDevices(tenantId);
    const count = (s) => devs.filter((d) => d.status === s).length;
    const sumFrom = async (from) => Number((await db.get('SELECT COALESCE(SUM(on_sec), 0) AS s FROM tvcorp_hours WHERE tenant_id = ? AND day >= ? AND day <= ?', [tenantId, from, today])).s);
    const t = now(); const refs = new Set(); let showing = 0;
    for (const d of devs) {
      const lp = lastPlays.get(`${tenantId}:${d.id}`);
      if (lp && t - lp.at < 10 * 60_000) { showing++; for (const p of lp.list) refs.add(p.ref); }
    }
    const media = [...data.media.values()];
    return {
      devices: { total: devs.length, on: count('on'), warn: count('warn'), off: count('off'), never: count('never'), showing },
      off: devs.filter((d) => d.status === 'off').sort((a, b) => (a.lastSeen || 0) - (b.lastSeen || 0)).slice(0, 100).map((d) => ({ id: d.id, name: d.name, office: d.office, since: d.lastSeen })),
      itemsNow: refs.size,
      hours: { today: await sumFrom(today), days7: await sumFrom(K.addDays(today, -6)), days30: await sumFrom(K.addDays(today, -29)) },
      media: { total: media.length, images: media.filter((m) => m.kind === 'image').length, slides: media.filter((m) => m.kind === 'slide').length, pending: media.filter((m) => m.status === 'pending').length },
      playlists: data.playlists.size, layouts: data.layouts.size, schedules: data.schedules.length,
      pending: await pendingCount(tenantId),
      day: today, tz,
    };
  }

  /* ================================================================ aprovação */
  async function decide(tenantId, approvalId, approve, by, note = '') {
    const a = await db.get(`SELECT * FROM telas_approvals WHERE id = ? AND tenant_id = ? AND kind IN (${TVC_APPROVAL_KINDS.map(() => '?').join(',')})`, [approvalId, tenantId, ...TVC_APPROVAL_KINDS]);
    if (!a) throw fail(404, 'Pedido não encontrado.');
    if (a.status !== 'pending') throw fail(409, 'Este pedido já foi decidido.');
    const status = approve ? 'ok' : 'rejected';
    if (a.kind === 'tvc-media') await db.run('UPDATE tvcorp_media SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?', [status, now(), a.ref_id, tenantId]);
    else if (a.kind === 'tvc-schedule') await db.run('UPDATE tvcorp_schedules SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?', [status, now(), a.ref_id, tenantId]);
    else if (decideOther) await decideOther(tenantId, a, approve, by, note);
    else throw fail(409, 'Este tipo de pedido é decidido em outra tela.');
    await db.run('UPDATE telas_approvals SET status = ?, decided_by = ?, decided_at = ?, note = ? WHERE id = ? AND tenant_id = ?', [approve ? 'approved' : 'rejected', line(by, 64), now(), line(note, 200) || null, a.id, tenantId]);
    changed(tenantId);
    return { id: Number(a.id), kind: a.kind, refId: num(a.ref_id), status: approve ? 'approved' : 'rejected' };
  }

  /* ================================================================ limpeza (de 6 em 6 h) */
  /** Arquivos tvcmedia-/tvclogo- que nenhuma linha cita (há mais de 1 h) e o relatório com mais de 400 dias. */
  async function prune(t = now()) {
    const cut = K.localParts(t - L.keepDays * 86_400_000, K.DEFAULT_TZ).day;
    await db.run('DELETE FROM tvcorp_plays WHERE day < ?', [cut]).catch(() => {});
    await db.run('DELETE FROM tvcorp_hours WHERE day < ?', [cut]).catch(() => {});
    if (!storage.list) return;
    try {
      const used = new Set((await db.all('SELECT file FROM tvcorp_media WHERE file IS NOT NULL')).map((r) => r.file));
      for (const r of await db.all("SELECT fields FROM tvcorp_media WHERE kind = 'video'")) { const p = j(r.fields, {}).poster; if (p) used.add(p); }
      for (const s of await db.all('SELECT data FROM tvcorp_settings')) { const f = j(s.data, {}).logo?.file; if (f) used.add(f); }
      for (const f of await storage.list()) {
        if ((MEDIA_RE.test(f.name) || LOGO_RE.test(f.name)) && !used.has(f.name) && (!f.mtime || t - f.mtime > 3600_000)) await dropFile(f.name);
      }
    } catch { /* a listagem falhou: fica para a próxima volta */ }
  }
  const timer = timers ? setInterval(() => { prune().catch((err) => console.warn('[tvcorp] limpeza:', err.message)); }, PRUNE_MS) : null;
  timer?.unref?.();

  /** A unidade foi excluída (dentro da transação x): as mídias e playlists dela saem (os arquivos, a limpeza tira). */
  async function dropOffice(x, tenantId, officeId) {
    const pls = await x.all('SELECT id FROM tvcorp_playlists WHERE tenant_id = ? AND office_id = ?', [tenantId, officeId]);
    for (const p of pls) await x.run('DELETE FROM tvcorp_playlist_items WHERE tenant_id = ? AND playlist_id = ?', [tenantId, p.id]);
    await x.run('DELETE FROM tvcorp_playlists WHERE tenant_id = ? AND office_id = ?', [tenantId, officeId]);
    const ms = await x.all('SELECT id FROM tvcorp_media WHERE tenant_id = ? AND office_id = ?', [tenantId, officeId]);
    for (const m of ms) await x.run("DELETE FROM tvcorp_playlist_items WHERE tenant_id = ? AND ref_kind = 'media' AND ref_id = ?", [tenantId, m.id]);
    await x.run('DELETE FROM tvcorp_media WHERE tenant_id = ? AND office_id = ?', [tenantId, officeId]);
    cache.delete(Number(tenantId));
  }
  /** Os dados de fonte (pacote B) mudaram: o próximo /config busca de novo, sem esperar os 15 min. */
  function forgetData(tenantId) { hold.clear(`${Number(tenantId)}:`); changed(tenantId); }

  /* ================================================================ rotas do painel */
  function mountPanel(app, { needs }) {
    const all = (req, res, next) => (req.user?.channels ? res.status(403).json({ error: 'A TV Corporativa pede acesso a todos os canais do cliente.' }) : next());
    const M = [needs('tvcorp.manage'), all];
    const who = (req) => req.user?.username || '';
    const B = '/api/tvcorp';

    /* ---- tudo de uma vez */
    app.get(B, M, ah(async (req, res) => {
      const tid = req.tenantId;
      const data = await load(tid);
      const [offices, groups, regions, devs] = await Promise.all([
        db.all('SELECT id, name, type, region_id FROM telas_offices WHERE tenant_id = ? ORDER BY name', [tid]),
        db.all('SELECT id, name, color, office_type FROM telas_groups WHERE tenant_id = ? ORDER BY sort, name', [tid]),
        db.all('SELECT id, name, color FROM telas_regions WHERE tenant_id = ? ORDER BY name', [tid]),
        corpDevices(tid),
      ]);
      noStore(res).json({
        settings: K.settingsDto(data.settings), limits: L,
        offices: offices.filter((o) => isTvcOfficeType(o.type)).map((o) => ({ id: Number(o.id), name: o.name, type: o.type, regionId: num(o.region_id) })),
        groups: groups.map((g) => ({ id: Number(g.id), name: g.name, color: g.color || null, officeType: g.office_type || null })),
        regions: regions.map((r) => ({ id: Number(r.id), name: r.name, color: r.color || null })),
        devices: devs,
        layouts: [...data.layouts.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
        walls: data.walls,
        playlists: [...data.playlists.values()].map(({ items, ...p }) => ({ ...p, items: items.length })).sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name, 'pt-BR')),
        schedules: data.schedules.map((s) => ({ ...s, isDefault: Number(data.settings.defaultSchedule) === s.id })).sort((a, b) => K.blockOrder(a, b)),
        media: { total: data.media.size },
      });
    }));
    app.get(`${B}/badge`, M, ah(async (req, res) => {
      const devs = await corpDevices(req.tenantId);
      noStore(res).json({ off: devs.filter((d) => d.status === 'off').length, pending: await pendingCount(req.tenantId) });
    }));
    app.get(`${B}/summary`, M, ah(async (req, res) => noStore(res).json(await summary(req.tenantId))));

    /* ---- configurações e logomarca */
    app.put(`${B}/settings`, M, ah(async (req, res) => {
      const cur = await settingsOf(req.tenantId);
      const next = K.cleanSettings(req.body || {}, cur);
      if (next.defaultSchedule != null) await own('tvcorp_schedules', next.defaultSchedule, req.tenantId, 'Grade padrão');
      await saveSettings(req.tenantId, next);
      res.locals.audit = 'tv corporativa: configurações salvas';
      noStore(res).json({ settings: K.settingsDto(next) });
    }));
    app.get(`${B}/settings/logo`, M, ah(async (req, res) => {
      const f = (await settingsOf(req.tenantId)).logo?.file;
      if (!f) throw fail(404, 'A empresa ainda não tem logomarca.');
      sendFile(res, await readFile(f), 'image/png');
    }));
    app.put(`${B}/settings/logo`, M, rawBody(L.logoUploadBytes), tooBig, ah(async (req, res) => {
      const png = await prepareLogo(needBody(req), { ffmpeg, checkImage });
      const name = `${LOGO_PREFIX}${randomUUID()}.png`;
      await keepFile(name, png);
      const cur = await settingsOf(req.tenantId);
      const prev = cur.logo?.file;
      try { await saveSettings(req.tenantId, { ...cur, logo: { file: name, sha256: sha256(png), bytes: png.length, at: now() } }); } catch (err) { await dropFile(name); throw err; }
      if (prev && prev !== name) await dropFile(prev);
      res.locals.audit = `tv corporativa: logomarca enviada (${Math.round(png.length / 1024)} KB)`;
      noStore(res).json({ settings: K.settingsDto(await settingsOf(req.tenantId)) });
    }));
    app.delete(`${B}/settings/logo`, M, ah(async (req, res) => {
      const cur = await settingsOf(req.tenantId);
      if (!cur.logo) throw fail(404, 'A empresa ainda não tem logomarca.');
      const prev = cur.logo.file; delete cur.logo;
      await saveSettings(req.tenantId, cur);
      await dropFile(prev);
      res.locals.audit = 'tv corporativa: logomarca removida';
      res.json({ ok: true });
    }));

    /* ---- mídias */
    const officeIdOf = async (v, tid) => (v == null || v === '' ? null : Number((await own('telas_offices', v, tid, 'Unidade')).id));
    app.get(`${B}/media`, M, ah(async (req, res) => {
      const q = req.query || {};
      let rows = [...(await load(req.tenantId)).media.values()];
      if (q.kind) rows = rows.filter((r) => r.kind === q.kind);
      if (q.status) rows = rows.filter((r) => r.status === q.status);
      if (q.officeId === 'company') rows = rows.filter((r) => r.office_id == null);
      else if (q.officeId) rows = rows.filter((r) => Number(r.office_id) === Number(q.officeId));
      rows.sort((a, b) => Number(b.id) - Number(a.id));
      noStore(res).json({ media: rows.map(mediaDto) });
    }));
    app.get(`${B}/media/:id`, M, ah(async (req, res) => noStore(res).json(mediaDto(await own('tvcorp_media', req.params.id, req.tenantId, 'Mídia')))));
    app.get(`${B}/media/:id/file`, M, ah(async (req, res) => {
      const r = await own('tvcorp_media', req.params.id, req.tenantId, 'Mídia');
      if (r.kind !== 'image' || !r.file) throw fail(404, 'Esta mídia não tem arquivo (é um slide).');
      sendFile(res, await readFile(r.file), 'image/jpeg');
    }));
    app.post(`${B}/media`, M, ah(async (req, res) => {
      const officeId = await officeIdOf(req.body?.officeId, req.tenantId);
      const id = await createSlide(req.tenantId, req.body || {}, { officeId, by: who(req) });
      const r = await own('tvcorp_media', id, req.tenantId, 'Mídia');
      res.locals.audit = `tv corporativa: slide "${r.title}" (#${id}, modelo ${r.template}) criado`;
      noStore(res).status(201).json(mediaDto(r));
    }));
    /* o vídeo próprio: o corpo é o arquivo (até 500 MB); a resposta sai logo e a conversão corre na fila do servidor */
    app.post(`${B}/media/video`, M, ah(async (req, res) => {
      const q = req.query || {};
      const officeId = await officeIdOf(q.officeId, req.tenantId);
      if (!VIDEO.types.includes(String(req.headers['content-type'] || '').split(';')[0].trim())) throw fail(415, 'Envie um vídeo MP4, MOV, WebM ou AVI.');
      await under('tvcorp_media', req.tenantId, L.media, 'mídias');
      const declared = Number(req.headers['content-length']) || 0;
      if (storageCheck) await storageCheck(req.tenantId, declared);
      const up = await receiveUpload(req);
      const t = now(); const title = line(q.title, L.title) || 'Vídeo';
      const sound = q.sound === '1' || q.sound === 'true';
      const id = Number(await db.insert('INSERT INTO tvcorp_media(tenant_id,office_id,kind,title,file,sha256,bytes,width,height,template,fields,seconds,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [req.tenantId, officeId, 'video', title, null, null, up.bytes, null, null, null, JSON.stringify({ sound, processing: true }), 10, 'processing', line(who(req), 64), t, t]));
      const tenantId = req.tenantId;
      enqueue(async () => {
        try {
          const out = await convertVideo(ffmpeg, up.file, up.dir);
          const name = `${MEDIA_PREFIX}${randomUUID()}.mp4`; const pname = out.poster ? `${MEDIA_PREFIX}${randomUUID()}.jpg` : null;
          await keepPath(name, out.mp4); if (pname) await keepPath(pname, out.poster);
          const st = await fs.promises.stat(out.mp4); const sha = createHash('sha256').update(await fs.promises.readFile(out.mp4)).digest('hex');
          const row = await db.get('SELECT fields FROM tvcorp_media WHERE id = ? AND tenant_id = ?', [id, tenantId]);
          if (!row) { await dropFile(name); await dropFile(pname); return; } // apagado enquanto convertia
          const fx = { ...j(row.fields, {}), poster: pname }; delete fx.processing;
          await db.run('UPDATE tvcorp_media SET file = ?, sha256 = ?, bytes = ?, width = ?, height = ?, seconds = ?, fields = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
            [name, sha, st.size, out.width, out.height, out.seconds, JSON.stringify(fx), 'ok', now(), id, tenantId]);
          changed(tenantId);
        } catch (err) {
          const row = await db.get('SELECT fields FROM tvcorp_media WHERE id = ? AND tenant_id = ?', [id, tenantId]).catch(() => null);
          if (row) await db.run('UPDATE tvcorp_media SET status = ?, fields = ?, bytes = 0, updated_at = ? WHERE id = ? AND tenant_id = ?', ['error', JSON.stringify({ ...j(row.fields, {}), processing: false, error: err?.status ? err.message : 'Não foi possível converter este vídeo.' }), now(), id, tenantId]).catch(() => {});
          if (!err?.status) console.warn(`[tvcorp] vídeo #${id} não converteu (${String(err?.message || err).slice(0, 160)})`);
        } finally { await fs.promises.rm(up.dir, { recursive: true, force: true }).catch(() => {}); }
      });
      res.locals.audit = `tv corporativa: vídeo "${title}" (#${id}) enviado (${Math.round(up.bytes / 1048576)} MB)`;
      noStore(res).status(202).json(mediaDto(await own('tvcorp_media', id, req.tenantId, 'Mídia')));
    }));
    app.get(`${B}/media/:id/poster`, M, ah(async (req, res) => {
      const r = await own('tvcorp_media', req.params.id, req.tenantId, 'Mídia');
      const p = r.kind === 'video' ? j(r.fields, {}).poster : null;
      if (!p) throw fail(404, 'Este vídeo ainda não tem miniatura.');
      sendFile(res, await readFile(p), 'image/jpeg');
    }));
    app.post(`${B}/media/image`, M, rawBody(L.uploadBytes), tooBig, ah(async (req, res) => {
      const q = req.query || {};
      const officeId = await officeIdOf(q.officeId, req.tenantId);
      const id = await storeImage(req.tenantId, needBody(req), { officeId, title: line(q.title, L.title), caption: q.caption, seconds: q.seconds, opts: q, by: who(req) });
      const r = await own('tvcorp_media', id, req.tenantId, 'Mídia');
      res.locals.audit = `tv corporativa: imagem "${r.title}" (#${id}) enviada (${Math.round(Number(r.bytes) / 1024)} KB)`;
      noStore(res).status(201).json(mediaDto(r));
    }));
    app.put(`${B}/media/:id/image`, M, rawBody(L.uploadBytes), tooBig, ah(async (req, res) => {
      const cur = await own('tvcorp_media', req.params.id, req.tenantId, 'Mídia');
      if (cur.kind !== 'image') throw fail(400, 'Só a imagem tem arquivo para trocar.');
      await storeImage(req.tenantId, needBody(req), { opts: req.query || {}, replace: cur });
      const r = await own('tvcorp_media', cur.id, req.tenantId, 'Mídia');
      res.locals.audit = `tv corporativa: imagem "${r.title}" (#${r.id}) trocada`;
      noStore(res).json(mediaDto(r));
    }));
    app.patch(`${B}/media/:id`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_media', req.params.id, req.tenantId, 'Mídia');
      const b = req.body || {};
      const title = b.title !== undefined ? (line(b.title, L.title) || cur.title) : cur.title;
      const seconds = b.seconds !== undefined && cur.kind !== 'video' ? K.cleanSeconds(b.seconds) : Number(cur.seconds); // o vídeo dura o que o arquivo dura
      const officeId = b.officeId !== undefined ? await officeIdOf(b.officeId, req.tenantId) : num(cur.office_id);
      let fields = cur.fields; let template = cur.template;
      if (cur.kind === 'slide' && (b.fields !== undefined || b.template !== undefined)) {
        template = b.template ?? cur.template;
        const out = K.cleanSlide(template, b.fields !== undefined ? b.fields : j(cur.fields, {}));
        await assertSlideMedia(req.tenantId, out.mediaIds.filter((x) => x !== Number(cur.id)));
        if (out.mediaIds.includes(Number(cur.id))) throw fail(400, 'O slide não pode citar a si mesmo.');
        fields = JSON.stringify(out.fields);
      }
      if (cur.kind === 'video' && b.sound !== undefined) fields = JSON.stringify({ ...j(cur.fields, {}), sound: Boolean(b.sound) });
      if (cur.kind === 'image' && (b.caption !== undefined || b.page !== undefined)) {
        // a legenda e o desenho da página do construtor (fields.page: só para abrir e editar de novo; a TV recebe o JPEG)
        const fx = { ...j(cur.fields, {}) };
        if (b.caption !== undefined) { const c = line(b.caption, L.title); if (c) fx.caption = c; else delete fx.caption; }
        if (b.page !== undefined) {
          if (b.page === null) delete fx.page;
          else { const pg = cleanPage(b.page); if (!pg) throw fail(400, 'O desenho da página veio fora do formato.'); fx.page = pg; }
        }
        fields = JSON.stringify(fx);
      }
      await db.run('UPDATE tvcorp_media SET title = ?, seconds = ?, office_id = ?, fields = ?, template = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
        [title, seconds, officeId, fields, template, now(), cur.id, req.tenantId]);
      changed(req.tenantId);
      res.locals.audit = `tv corporativa: mídia "${title}" (#${cur.id}) alterada`;
      noStore(res).json(mediaDto(await own('tvcorp_media', cur.id, req.tenantId, 'Mídia')));
    }));
    app.delete(`${B}/media/:id`, M, ah(async (req, res) => {
      const cur = await own('tvcorp_media', req.params.id, req.tenantId, 'Mídia');
      await removeMedia(req.tenantId, cur);
      res.locals.audit = `tv corporativa: mídia "${cur.title}" (#${cur.id}) apagada`;
      res.json({ ok: true });
    }));

    /* ---- playlists */
    const fullPlaylist = async (tid, id) => {
      const p = playlistDto(await own('tvcorp_playlists', id, tid, 'Playlist'));
      p.items = (await db.all('SELECT * FROM tvcorp_playlist_items WHERE tenant_id = ? AND playlist_id = ? ORDER BY sort, id', [tid, p.id])).map(itemDto);
      return p;
    };
    app.get(`${B}/playlists`, M, ah(async (req, res) => {
      const data = await load(req.tenantId);
      noStore(res).json({ playlists: [...data.playlists.values()].sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name, 'pt-BR')) });
    }));
    app.get(`${B}/playlists/:id`, M, ah(async (req, res) => noStore(res).json(await fullPlaylist(req.tenantId, req.params.id))));
    app.post(`${B}/playlists`, M, ah(async (req, res) => {
      const p = K.cleanPlaylist(req.body || {});
      const officeId = await officeIdOf(req.body?.officeId, req.tenantId);
      await under('tvcorp_playlists', req.tenantId, L.playlists, 'playlists');
      const t = now();
      const id = Number(await db.insert('INSERT INTO tvcorp_playlists(tenant_id,office_id,name,description,shuffle,sort,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
        [req.tenantId, officeId, p.name, p.description, p.shuffle ? 1 : 0, p.sort, t, t]));
      changed(req.tenantId);
      res.locals.audit = `tv corporativa: playlist "${p.name}" (#${id}) criada`;
      noStore(res).status(201).json(await fullPlaylist(req.tenantId, id));
    }));
    app.patch(`${B}/playlists/:id`, M, ah(async (req, res) => {
      const cur = playlistDto(await own('tvcorp_playlists', req.params.id, req.tenantId, 'Playlist'));
      const p = K.cleanPlaylist(req.body || {}, cur);
      const officeId = req.body?.officeId !== undefined ? await officeIdOf(req.body.officeId, req.tenantId) : cur.officeId;
      await db.run('UPDATE tvcorp_playlists SET name = ?, description = ?, shuffle = ?, sort = ?, office_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
        [p.name, p.description, p.shuffle ? 1 : 0, p.sort, officeId, now(), cur.id, req.tenantId]);
      changed(req.tenantId);
      res.locals.audit = `tv corporativa: playlist "${p.name}" (#${cur.id}) alterada`;
      noStore(res).json(await fullPlaylist(req.tenantId, cur.id));
    }));
    app.put(`${B}/playlists/:id/items`, M, ah(async (req, res) => {
      const cur = playlistDto(await own('tvcorp_playlists', req.params.id, req.tenantId, 'Playlist'));
      const items = K.cleanItems(Array.isArray(req.body) ? req.body : req.body?.items);
      for (const [i, it] of items.entries()) {
        if (it.refKind === 'media') await own('tvcorp_media', it.refId, req.tenantId, `Item ${i + 1}: a mídia`);
        else if (it.refKind === 'card') await own('telas_cards', it.refId, req.tenantId, `Item ${i + 1}: o cartão`);
        else if (it.refId && refExists && !(await refExists(req.tenantId, it.refKind, it.refId))) throw fail(404, `Item ${i + 1}: cadastro não encontrado.`);
      }
      await db.tx(async (x) => {
        await x.run('DELETE FROM tvcorp_playlist_items WHERE tenant_id = ? AND playlist_id = ?', [req.tenantId, cur.id]);
        for (const [i, it] of items.entries()) {
          await x.insert('INSERT INTO tvcorp_playlist_items(tenant_id,playlist_id,ref_kind,ref_id,params,seconds,sort,valid_from,valid_to,days,time_from,time_to) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            [req.tenantId, cur.id, it.refKind, it.refId, JSON.stringify(it.params), it.seconds, i, it.validFrom, it.validTo, K.daysText(it.days), it.timeFrom, it.timeTo]);
        }
        await x.run('UPDATE tvcorp_playlists SET updated_at = ? WHERE id = ? AND tenant_id = ?', [now(), cur.id, req.tenantId]);
      });
      changed(req.tenantId);
      res.locals.audit = `tv corporativa: playlist "${cur.name}" (#${cur.id}) com ${items.length} itens`;
      noStore(res).json(await fullPlaylist(req.tenantId, cur.id));
    }));
    app.delete(`${B}/playlists/:id`, M, ah(async (req, res) => {
      const cur = playlistDto(await own('tvcorp_playlists', req.params.id, req.tenantId, 'Playlist'));
      const using = (await load(req.tenantId)).schedules.filter((s) => Object.values(s.zonePlaylists).map(Number).includes(cur.id));
      if (using.length) throw fail(409, `A playlist está na grade: ${using.slice(0, 5).map((s) => `"${s.name}"`).join(', ')}. Tire de lá antes de apagar.`);
      await db.tx(async (x) => {
        await x.run('DELETE FROM tvcorp_playlist_items WHERE tenant_id = ? AND playlist_id = ?', [req.tenantId, cur.id]);
        await x.run('DELETE FROM tvcorp_playlists WHERE id = ? AND tenant_id = ?', [cur.id, req.tenantId]);
      });
      changed(req.tenantId);
      res.locals.audit = `tv corporativa: playlist "${cur.name}" (#${cur.id}) apagada`;
      res.json({ ok: true });
    }));

    /* ---- layouts */
    app.get(`${B}/layouts`, M, ah(async (req, res) => noStore(res).json({ layouts: [...(await load(req.tenantId)).layouts.values()] })));
    app.get(`${B}/layouts/:id`, M, ah(async (req, res) => noStore(res).json(layoutDto(await own('tvcorp_layouts', req.params.id, req.tenantId, 'Layout')))));
    app.post(`${B}/layouts`, M, ah(async (req, res) => {
      const l = K.cleanLayout(req.body || {});
      await under('tvcorp_layouts', req.tenantId, L.layouts, 'layouts');
      const t = now();
      const id = Number(await db.insert('INSERT INTO tvcorp_layouts(tenant_id,name,orientation,zones,background,factory_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
        [req.tenantId, l.name, l.orientation, JSON.stringify(l.zones), l.background, l.factoryKey, t, t]));
      changed(req.tenantId);
      res.locals.audit = `tv corporativa: layout "${l.name}" (#${id}) criado`;
      noStore(res).status(201).json(layoutDto(await own('tvcorp_layouts', id, req.tenantId, 'Layout')));
    }));
    app.patch(`${B}/layouts/:id`, M, ah(async (req, res) => {
      const cur = layoutDto(await own('tvcorp_layouts', req.params.id, req.tenantId, 'Layout'));
      const l = K.cleanLayout({ ...(req.body || {}), factoryKey: undefined }, cur);
      await db.run('UPDATE tvcorp_layouts SET name = ?, orientation = ?, zones = ?, background = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
        [l.name, l.orientation, JSON.stringify(l.zones), l.background, now(), cur.id, req.tenantId]);
      changed(req.tenantId);
      res.locals.audit = `tv corporativa: layout "${l.name}" (#${cur.id}) alterado`;
      noStore(res).json(layoutDto(await own('tvcorp_layouts', cur.id, req.tenantId, 'Layout')));
    }));
    app.delete(`${B}/layouts/:id`, M, ah(async (req, res) => {
      const cur = layoutDto(await own('tvcorp_layouts', req.params.id, req.tenantId, 'Layout'));
      const using = (await load(req.tenantId)).schedules.filter((s) => s.layoutId === cur.id);
      if (using.length) throw fail(409, `O layout está na grade: ${using.slice(0, 5).map((s) => `"${s.name}"`).join(', ')}. Troque o layout de lá antes de apagar.`);
      await db.run('DELETE FROM tvcorp_layouts WHERE id = ? AND tenant_id = ?', [cur.id, req.tenantId]);
      changed(req.tenantId);
      res.locals.audit = `tv corporativa: layout "${cur.name}" (#${cur.id}) apagado`;
      res.json({ ok: true });
    }));

    /* ---- conjuntos de telas (DIGITAL ISP) */
    // as telas do conjunto: do cliente, não revogadas e fora de outro conjunto
    const checkWallDevices = async (tenantId, data, selfId = null) => {
      const ids = data.cells.map((c) => c.deviceId);
      if (!ids.length) return;
      const rows = await db.all(`SELECT id FROM telas_devices WHERE tenant_id = ? AND revoked_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, [tenantId, ...ids]);
      if (rows.length !== ids.length) throw fail(404, 'Tela não encontrada.');
      const other = (await load(tenantId)).walls.find((w) => w.id !== selfId && w.data.cells.some((c) => ids.includes(c.deviceId)));
      if (other) throw fail(409, `Uma das telas já está no conjunto "${other.name}". Tire de lá antes.`);
      if (data.layoutId) await own('tvcorp_layouts', data.layoutId, tenantId, 'Layout');
    };
    app.get(`${B}/walls`, M, ah(async (req, res) => noStore(res).json({ walls: (await load(req.tenantId)).walls })));
    app.post(`${B}/walls`, M, ah(async (req, res) => {
      const w = K.cleanWall(req.body || {}, null, { now: now() });
      await under('tvcorp_walls', req.tenantId, L.layouts, 'conjuntos');
      await checkWallDevices(req.tenantId, w.data);
      const t = now();
      const id = Number(await db.insert('INSERT INTO tvcorp_walls(tenant_id,name,data,created_at,updated_at) VALUES(?,?,?,?,?)', [req.tenantId, w.name, JSON.stringify(w.data), t, t]));
      changed(req.tenantId);
      res.locals.audit = `tv corporativa: conjunto de telas "${w.name}" (#${id}) criado`;
      noStore(res).status(201).json(wallDto(await own('tvcorp_walls', id, req.tenantId, 'Conjunto')));
    }));
    app.patch(`${B}/walls/:id`, M, ah(async (req, res) => {
      const cur = wallDto(await own('tvcorp_walls', req.params.id, req.tenantId, 'Conjunto'));
      const w = K.cleanWall(req.body || {}, cur, { now: now() });
      await checkWallDevices(req.tenantId, w.data, cur.id);
      await db.run('UPDATE tvcorp_walls SET name = ?, data = ?, updated_at = ? WHERE id = ? AND tenant_id = ?', [w.name, JSON.stringify(w.data), now(), cur.id, req.tenantId]);
      changed(req.tenantId);
      res.locals.audit = `tv corporativa: conjunto de telas "${w.name}" (#${cur.id}) alterado`;
      noStore(res).json(wallDto(await own('tvcorp_walls', cur.id, req.tenantId, 'Conjunto')));
    }));
    app.delete(`${B}/walls/:id`, M, ah(async (req, res) => {
      const cur = wallDto(await own('tvcorp_walls', req.params.id, req.tenantId, 'Conjunto'));
      await db.run('DELETE FROM tvcorp_walls WHERE id = ? AND tenant_id = ?', [cur.id, req.tenantId]);
      changed(req.tenantId);
      res.locals.audit = `tv corporativa: conjunto de telas "${cur.name}" (#${cur.id}) apagado`;
      res.json({ ok: true });
    }));

    /* ---- o rodízio de DEMONSTRAÇÃO (só nas contas com a demonstração ligada) */
    const soDemo = ah(async (req, res, next) => { if (!rodizio || !(await rodizio.ligada(req.tenantId))) return res.status(403).json({ error: 'A demonstração não está ligada nesta conta.' }); next(); });
    app.get(`${B}/demo-rodizio`, M, soDemo, ah(async (req, res) => noStore(res).json(await rodizio.ler(req.tenantId))));
    app.put(`${B}/demo-rodizio`, M, soDemo, ah(async (req, res) => {
      const r = await rodizio.salvar(req.tenantId, req.body || {}, now());
      changed(req.tenantId);
      res.locals.audit = r.on ? `tv corporativa: demonstração ligada (${r.layoutIds.length} layouts, a cada ${r.seconds} s, ${r.devices.length ? `${r.devices.length} tela(s)` : 'todas as telas'})` : 'tv corporativa: demonstração desligada';
      noStore(res).json(r);
    }));

    /* ---- grade */
    const scheduleRow = (s) => { const sc = K.scopeToRow(s.scope); return [s.name, s.layoutId, JSON.stringify(s.zonePlaylists), sc.scope, sc.scope_data, K.daysText(s.days), s.timeFrom, s.timeTo, s.dateFrom, s.dateTo, s.priority]; };
    app.get(`${B}/schedules`, M, ah(async (req, res) => {
      const data = await load(req.tenantId);
      noStore(res).json({ schedules: data.schedules.map((s) => ({ ...s, isDefault: Number(data.settings.defaultSchedule) === s.id })).sort(K.blockOrder) });
    }));
    app.get(`${B}/schedules/:id`, M, ah(async (req, res) => noStore(res).json(scheduleDto(await own('tvcorp_schedules', req.params.id, req.tenantId, 'Grade')))));
    app.post(`${B}/schedules/preview`, M, ah(async (req, res) => {
      const b = req.body || {};
      const cur = b.id ? scheduleDto(await own('tvcorp_schedules', b.id, req.tenantId, 'Grade')) : null;
      const draft = { ...(await cleanScheduleFull(req.tenantId, b.schedule || b, cur)), id: cur ? cur.id : Number.MAX_SAFE_INTEGER, status: 'ok' };
      const devs = await db.all(`SELECT d.id, d.name, d.office_id, o.name AS office_name, o.type AS office_type, o.region_id FROM telas_devices d
        JOIN telas_offices o ON o.id = d.office_id AND o.tenant_id = d.tenant_id WHERE d.tenant_id = ? AND d.revoked_at IS NULL ORDER BY d.id`, [req.tenantId]);
      const list = [];
      for (const d of devs) {
        if (!isTvcOfficeType(d.office_type)) continue;
        const at = { deviceId: Number(d.id), officeId: Number(d.office_id), regionId: num(d.region_id), groupIds: await groupIdsOf(req.tenantId, d.id, d.office_type) };
        const r = await resolveFor(req.tenantId, at, draft);
        const hit = r.blocks.some((s) => s.id === draft.id) || r.fallback?.id === draft.id;
        if (!hit) continue;
        list.push({ id: Number(d.id), name: d.name, office: d.office_name, now: r.current ? { id: r.current.id === draft.id ? null : r.current.id, name: r.current.name, draft: r.current.id === draft.id } : null });
      }
      noStore(res).json({ devices: list.length, winsNow: list.filter((d) => d.now?.draft).length, list: list.slice(0, 500) });
    }));
    app.post(`${B}/schedules`, M, ah(async (req, res) => {
      const s = await cleanScheduleFull(req.tenantId, req.body || {}, null);
      await under('tvcorp_schedules', req.tenantId, L.schedules, 'grades');
      const t = now();
      const id = Number(await db.insert('INSERT INTO tvcorp_schedules(name,layout_id,zone_playlists,scope,scope_data,days,time_from,time_to,date_from,date_to,priority,tenant_id,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [...scheduleRow(s), req.tenantId, 'ok', line(who(req), 64), t, t]));
      changed(req.tenantId);
      res.locals.audit = `tv corporativa: grade "${s.name}" (#${id}) criada`;
      noStore(res).status(201).json(scheduleDto(await own('tvcorp_schedules', id, req.tenantId, 'Grade')));
    }));
    app.patch(`${B}/schedules/:id`, M, ah(async (req, res) => {
      const cur = scheduleDto(await own('tvcorp_schedules', req.params.id, req.tenantId, 'Grade'));
      const s = await cleanScheduleFull(req.tenantId, req.body || {}, cur);
      await db.run('UPDATE tvcorp_schedules SET name = ?, layout_id = ?, zone_playlists = ?, scope = ?, scope_data = ?, days = ?, time_from = ?, time_to = ?, date_from = ?, date_to = ?, priority = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
        [...scheduleRow(s), now(), cur.id, req.tenantId]);
      changed(req.tenantId);
      res.locals.audit = `tv corporativa: grade "${s.name}" (#${cur.id}) alterada`;
      noStore(res).json(scheduleDto(await own('tvcorp_schedules', cur.id, req.tenantId, 'Grade')));
    }));
    app.delete(`${B}/schedules/:id`, M, ah(async (req, res) => {
      const cur = scheduleDto(await own('tvcorp_schedules', req.params.id, req.tenantId, 'Grade'));
      await db.run('DELETE FROM tvcorp_schedules WHERE id = ? AND tenant_id = ?', [cur.id, req.tenantId]);
      await db.run("UPDATE telas_approvals SET status = 'superseded', decided_at = ? WHERE tenant_id = ? AND kind = 'tvc-schedule' AND ref_id = ? AND status = 'pending'", [now(), req.tenantId, cur.id]);
      const st = await settingsOf(req.tenantId);
      if (Number(st.defaultSchedule) === cur.id) { st.defaultSchedule = null; await saveSettings(req.tenantId, st); }
      changed(req.tenantId);
      res.locals.audit = `tv corporativa: grade "${cur.name}" (#${cur.id}) apagada`;
      res.json({ ok: true });
    }));

    /* ---- o que a tela mostra agora */
    app.get(`${B}/devices/:id/now`, M, ah(async (req, res) => {
      const d = await own('telas_devices', req.params.id, req.tenantId, 'Tela');
      const o = await db.get('SELECT * FROM telas_offices WHERE id = ? AND tenant_id = ?', [d.office_id, req.tenantId]);
      const groups = await groupIdsOf(req.tenantId, d.id, o?.type);
      const at = { deviceId: Number(d.id), officeId: Number(d.office_id), regionId: num(o?.region_id), groupIds: groups };
      const r = await resolveFor(req.tenantId, at);
      let zones = null;
      if (r.current && o && isTvcOfficeType(o.type)) {
        const b = await blockOf(req.tenantId, at.officeId, r.current, r.data, req, { fallback: r.fallback?.id === r.current.id, seed: at.deviceId, at });
        // full=1: os itens inteiros, como a TV recebe (a prévia "Ver a tela agora" monta com eles)
        const full = req.query.full === '1';
        if (b) zones = Object.fromEntries(Object.entries(b.zones).map(([z, items]) => [z, items.map((it) => (full ? it : { id: it.id, kind: it.kind, seconds: it.seconds, title: it.fields?.title || it.title || it.name || null }))]));
      }
      const lp = lastPlays.get(`${req.tenantId}:${d.id}`);
      const names = lp ? await namesFor(req.tenantId, lp.list.map((p) => { const x = parseItemRef(p.ref); return { ref_kind: x.refKind, ref_id: x.refId }; })) : new Map();
      noStore(res).json({
        device: { id: Number(d.id), name: d.name, corp: Boolean(o && isTvcOfficeType(o.type)) },
        block: r.current ? { id: r.current.id, name: r.current.name, priority: r.current.priority, layoutId: r.current.layoutId, fallback: r.fallback?.id === r.current.id } : null,
        zones,
        lastPlays: lp ? { at: lp.at, items: lp.list.map((p) => { const x = parseItemRef(p.ref); return { ...p, name: names.get(`${x.refKind}:${x.refId}`) || p.ref }; }) } : null,
        lastBeat: lastBeat.get(`${req.tenantId}:${d.id}`) ?? num(d.last_seen),
      });
    }));

    /* ---- a prévia ao vivo de um layout: os itens que a TV recebe, montados pelo mesmo blockOf (sem escolher nada no painel).
       layoutId (salvo) ou layout (o do editor, ainda não salvo); zonePlaylists (a grade sendo editada) ou a grade que usa o
       layout; sem grade, as playlists escolhidas no próprio layout. */
    app.post(`${B}/layouts/ao-vivo`, M, ah(async (req, res) => {
      const b = req.body || {};
      const data = await load(req.tenantId);
      let layoutId = b.layoutId != null && b.layoutId !== '' ? Number(b.layoutId) : null;
      let layouts = data.layouts;
      if (b.layout && typeof b.layout === 'object') {
        const l = K.cleanLayout({ name: 'Prévia', ...b.layout, factoryKey: undefined });
        // o do editor (pode ter mudança ainda não salva) no lugar do salvo: a mesma rádio e a mesma grade
        if (!layoutId || !layouts.has(layoutId)) layoutId = -1;
        layouts = new Map(data.layouts).set(layoutId, { id: layoutId, name: l.name, orientation: l.orientation, zones: l.zones, background: l.background });
      } else if (!layoutId || !layouts.has(layoutId)) throw fail(404, 'Layout não encontrado.');
      const grade = b.zonePlaylists ? null : data.schedules.find((s) => Number(s.layoutId) === Number(b.layoutId ?? -2)) || null;
      const s = { id: 0, name: 'Prévia', days: [], timeFrom: 0, timeTo: 1440, dateFrom: null, dateTo: null, priority: 0, layoutId, zonePlaylists: b.zonePlaylists && typeof b.zonePlaylists === 'object' ? b.zonePlaylists : (grade?.zonePlaylists || {}) };
      const blk = await blockOf(req.tenantId, null, s, { ...data, layouts }, req, { seed: 'previa' });
      noStore(res).json({ zones: blk?.zones || {}, audio: blk?.layout?.audio || null, grade: grade ? { id: grade.id, name: grade.name } : null });
    }));

    /* ---- histórico dos comandos */
    app.get(`${B}/commands`, M, ah(async (req, res) => {
      const q = req.query || {};
      const tz = tzOf(await settingsOf(req.tenantId));
      const today = K.localParts(now(), tz).day;
      const { from, to } = K.cleanPeriod({ from: q.from, to: q.to || today }, today);
      const deviceId = q.deviceId ? Number((await own('telas_devices', q.deviceId, req.tenantId, 'Tela')).id) : null;
      const rows = await db.all(`SELECT c.*, d.name AS device_name FROM telas_commands c LEFT JOIN telas_devices d ON d.id = c.device_id AND d.tenant_id = c.tenant_id
        WHERE c.tenant_id = ? AND c.created_at >= ? AND c.created_at < ?${deviceId ? ' AND c.device_id = ?' : ''} ORDER BY c.id DESC LIMIT 1000`,
      [req.tenantId, dayStart(from, tz), dayStart(K.addDays(to, 1), tz), ...(deviceId ? [deviceId] : [])]);
      noStore(res).json({
        from, to,
        commands: rows.map((c) => ({
          id: Number(c.id), deviceId: Number(c.device_id), device: c.device_name || `Tela #${Number(c.device_id)}`, type: c.type, by: c.created_by || '', at: Number(c.created_at),
          sentAt: num(c.sent_at), doneAt: num(c.done_at), ok: c.ok == null ? null : Number(c.ok) === 1, detail: c.detail || null,
          // o app antigo responde "Comando desconhecido nesta versão do app": a TV não sabe fazer, não é falha dela
          result: c.done_at ? (Number(c.ok) === 1 ? 'Feito' : /desconhecido/i.test(c.detail || '') ? 'Não suportado por esta versão do app' : 'Falhou') : c.sent_at ? 'Entregue à tela' : 'Aguardando a tela',
        })),
      });
    }));

    /* ---- relatórios */
    const sendCsv = (res, name, cols, rows) => res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' }).send(K.toCsv(cols, rows));
    app.get(`${B}/reports/plays`, M, ah(async (req, res) => {
      const q = req.query || {};
      const tz = tzOf(await settingsOf(req.tenantId));
      const { from, to } = K.cleanPeriod(q, K.localParts(now(), tz).day);
      const by = q.by || 'item';
      if (!['item', 'device', 'office'].includes(by)) throw fail(400, 'Agrupar por item, tela ou unidade.');
      let rows;
      if (by === 'item') {
        const raw = await db.all(`SELECT ref_kind, ref_id, SUM(plays) AS n, SUM(seconds) AS sec, COUNT(DISTINCT device_id) AS devices FROM tvcorp_plays
          WHERE tenant_id = ? AND day >= ? AND day <= ? GROUP BY ref_kind, ref_id`, [req.tenantId, from, to]);
        const names = await namesFor(req.tenantId, raw);
        rows = raw.map((r) => ({ ref: itemRef(r.ref_kind, Number(r.ref_id)), kind: r.ref_kind, refId: Number(r.ref_id) || null, name: names.get(`${r.ref_kind}:${Number(r.ref_id)}`), plays: Number(r.n), seconds: Number(r.sec), devices: Number(r.devices) }));
      } else {
        const raw = await db.all(`SELECT p.device_id, d.name AS device_name, d.office_id, o.name AS office_name, SUM(p.plays) AS n, SUM(p.seconds) AS sec, COUNT(DISTINCT p.day) AS days
          FROM tvcorp_plays p LEFT JOIN telas_devices d ON d.id = p.device_id AND d.tenant_id = p.tenant_id LEFT JOIN telas_offices o ON o.id = d.office_id AND o.tenant_id = p.tenant_id
          WHERE p.tenant_id = ? AND p.day >= ? AND p.day <= ? GROUP BY p.device_id, d.name, d.office_id, o.name`, [req.tenantId, from, to]);
        if (by === 'device') rows = raw.map((r) => ({ deviceId: Number(r.device_id), name: r.device_name || `Tela #${Number(r.device_id)} (apagada)`, office: r.office_name || '', plays: Number(r.n), seconds: Number(r.sec), days: Number(r.days) }));
        else {
          const acc = new Map();
          for (const r of raw) {
            const k = r.office_id == null ? 0 : Number(r.office_id);
            const cur = acc.get(k) || { officeId: k || null, name: r.office_name || 'Telas apagadas', plays: 0, seconds: 0, devices: 0 };
            cur.plays += Number(r.n); cur.seconds += Number(r.sec); cur.devices++;
            acc.set(k, cur);
          }
          rows = [...acc.values()];
        }
      }
      rows.sort((a, b) => b.plays - a.plays || b.seconds - a.seconds);
      if (q.format === 'csv') {
        const time = (r) => ({ ...r, time: K.hoursText(r.seconds) });
        const cols = by === 'item'
          ? [{ key: 'name', label: 'Item' }, { key: 'kind', label: 'Tipo' }, { key: 'plays', label: 'Vezes na tela' }, { key: 'seconds', label: 'Segundos na tela' }, { key: 'time', label: 'Tempo na tela' }, { key: 'devices', label: 'Telas' }]
          : by === 'device'
            ? [{ key: 'name', label: 'Tela' }, { key: 'office', label: 'Unidade' }, { key: 'plays', label: 'Vezes na tela' }, { key: 'seconds', label: 'Segundos na tela' }, { key: 'time', label: 'Tempo na tela' }, { key: 'days', label: 'Dias com exibição' }]
            : [{ key: 'name', label: 'Unidade' }, { key: 'devices', label: 'Telas' }, { key: 'plays', label: 'Vezes na tela' }, { key: 'seconds', label: 'Segundos na tela' }, { key: 'time', label: 'Tempo na tela' }];
        return sendCsv(res, `relatorio-de-exibicao-${by}-${from}-a-${to}.csv`, cols, rows.map(time));
      }
      noStore(res).json({ from, to, by, rows });
    }));
    app.get(`${B}/reports/hours`, M, ah(async (req, res) => {
      const q = req.query || {};
      const tz = tzOf(await settingsOf(req.tenantId));
      const { from, to } = K.cleanPeriod(q, K.localParts(now(), tz).day);
      const raw = await db.all(`SELECT h.device_id, d.name AS device_name, o.name AS office_name, SUM(h.on_sec) AS sec, COUNT(*) AS days
        FROM tvcorp_hours h LEFT JOIN telas_devices d ON d.id = h.device_id AND d.tenant_id = h.tenant_id LEFT JOIN telas_offices o ON o.id = d.office_id AND o.tenant_id = h.tenant_id
        WHERE h.tenant_id = ? AND h.day >= ? AND h.day <= ? GROUP BY h.device_id, d.name, o.name`, [req.tenantId, from, to]);
      const rows = raw.map((r) => ({ deviceId: Number(r.device_id), name: r.device_name || `Tela #${Number(r.device_id)} (apagada)`, office: r.office_name || '', seconds: Number(r.sec), days: Number(r.days) }))
        .sort((a, b) => b.seconds - a.seconds);
      const total = rows.reduce((s, r) => s + r.seconds, 0);
      if (q.format === 'csv') {
        return sendCsv(res, `horas-em-exibicao-${from}-a-${to}.csv`, [{ key: 'name', label: 'Tela' }, { key: 'office', label: 'Unidade' }, { key: 'days', label: 'Dias ligada' }, { key: 'seconds', label: 'Segundos ligada' }, { key: 'time', label: 'Tempo ligada' }],
          rows.map((r) => ({ ...r, time: K.hoursText(r.seconds) })));
      }
      noStore(res).json({ from, to, total, rows });
    }));

    /* ---- aprovação */
    app.get(`${B}/approvals`, M, ah(async (req, res) => {
      const rows = await db.all(`SELECT a.*, o.name AS office_name FROM telas_approvals a LEFT JOIN telas_offices o ON o.id = a.office_id AND o.tenant_id = a.tenant_id
        WHERE a.tenant_id = ? AND a.kind IN (${TVC_APPROVAL_KINDS.map(() => '?').join(',')}) ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END, a.id DESC LIMIT 200`, [req.tenantId, ...TVC_APPROVAL_KINDS]);
      const data = await load(req.tenantId);
      noStore(res).json({
        approvals: rows.map((a) => ({
          id: Number(a.id), kind: a.kind, refId: num(a.ref_id), office: a.office_name || null, summary: a.summary, status: a.status, requestedBy: a.requested_by, requestedAt: Number(a.requested_at),
          decidedBy: a.decided_by || null, decidedAt: num(a.decided_at), note: a.note || null,
          media: a.kind === 'tvc-media' && data.media.get(Number(a.ref_id)) ? mediaDto(data.media.get(Number(a.ref_id))) : undefined,
        })),
      });
    }));
    app.post(`${B}/approvals/:id/decide`, M, ah(async (req, res) => {
      const approve = req.body?.approve === true;
      if (!approve && req.body?.approve !== false) throw fail(400, 'Diga se aprova (approve: true) ou devolve (approve: false).');
      const note = line(req.body?.note, 200);
      if (!approve && note.length < 3) throw fail(400, 'Escreva o motivo da devolução.');
      const out = await decide(req.tenantId, idOf(req.params.id, 'Pedido'), approve, who(req), note);
      res.locals.audit = `tv corporativa: pedido #${out.id} (${out.kind}) ${approve ? 'aprovado' : 'devolvido'}`;
      noStore(res).json(out);
    }));
  }

  /* ================================================================ link da unidade (F11) */
  /** guard: a sessão do link da unidade + gestor (req.tenantId, req.office, req.by); note(req, ação, detalhe): a auditoria. */
  function mountOffice(app, { guard, note }) {
    const B = '/api/reparticao/tvcorp/media';
    const mine = (req) => ({ tid: Number(req.tenantId), oid: Number(req.office.id) });
    const ownOffice = async (req) => {
      const { tid, oid } = mine(req);
      const r = await own('tvcorp_media', req.params.id, tid, 'Mídia');
      if (Number(r.office_id) !== oid) throw fail(404, 'Mídia não encontrada.');
      return r;
    };
    app.get(B, guard, ah(async (req, res) => {
      const { tid, oid } = mine(req);
      const rows = await db.all('SELECT * FROM tvcorp_media WHERE tenant_id = ? AND office_id = ? ORDER BY id DESC LIMIT 500', [tid, oid]);
      noStore(res).json({ approval: await approvalOn(tid), media: rows.map(mediaDto) });
    }));
    app.get(`${B}/:id/file`, guard, ah(async (req, res) => {
      const r = await ownOffice(req);
      if (r.kind !== 'image' || !r.file) throw fail(404, 'Esta mídia não tem arquivo (é um slide).');
      sendFile(res, await readFile(r.file), 'image/jpeg');
    }));
    app.post(`${B}/image`, guard, rawBody(L.uploadBytes), tooBig, ah(async (req, res) => {
      const { tid, oid } = mine(req);
      const status = (await approvalOn(tid)) ? 'pending' : 'ok';
      const q = req.query || {};
      const id = await storeImage(tid, needBody(req), { officeId: oid, title: line(q.title, L.title), caption: q.caption, seconds: q.seconds, opts: q, by: req.by, status });
      const r = await own('tvcorp_media', id, tid, 'Mídia');
      if (status === 'pending') await requestApproval(tid, oid, 'tvc-media', id, `Imagem "${r.title}" de ${req.office.name}`, req.by);
      await note(req, `POST ${B}/image`, `tv corporativa: imagem "${r.title}" (#${id}) enviada pelo link da unidade "${req.office.name}"${status === 'pending' ? ' (aguardando aprovação)' : ''}`);
      noStore(res).status(201).json(mediaDto(r));
    }));
    app.post(B, guard, ah(async (req, res) => {
      const { tid, oid } = mine(req);
      const status = (await approvalOn(tid)) ? 'pending' : 'ok';
      // a unidade cita só imagens dela no slide
      const { mediaIds } = K.cleanSlide(req.body?.template, req.body?.fields);
      for (const m of mediaIds) { const r = await own('tvcorp_media', m, tid, 'Imagem do slide'); if (Number(r.office_id) !== oid) throw fail(404, 'Imagem do slide não encontrada.'); }
      const id = await createSlide(tid, req.body || {}, { officeId: oid, by: req.by, status });
      const r = await own('tvcorp_media', id, tid, 'Mídia');
      if (status === 'pending') await requestApproval(tid, oid, 'tvc-media', id, `Slide "${r.title}" de ${req.office.name}`, req.by);
      await note(req, `POST ${B}`, `tv corporativa: slide "${r.title}" (#${id}) criado pelo link da unidade "${req.office.name}"${status === 'pending' ? ' (aguardando aprovação)' : ''}`);
      noStore(res).status(201).json(mediaDto(r));
    }));
    app.delete(`${B}/:id`, guard, ah(async (req, res) => {
      const r = await ownOffice(req);
      await removeMedia(Number(req.tenantId), r);
      await note(req, `DELETE ${B}/:id`, `tv corporativa: mídia "${r.title}" (#${r.id}) apagada pelo link da unidade "${req.office.name}"`);
      res.json({ ok: true });
    }));
  }

  /* ================================================================ chave de integração */
  function mountApi(app) {
    if (!hasFeature) return;
    const perKey = new Map(); // chave -> [quando...] (30 por minuto)
    const hit = (k) => {
      const t = now(); const list = (perKey.get(k) || []).filter((x) => t - x < 60_000);
      if (list.length >= 30) return false;
      list.push(t); perKey.delete(k); perKey.set(k, list);
      while (perKey.size > 10_000) perKey.delete(perKey.keys().next().value);
      return true;
    };
    const keyAuth = ah(async (req, res, next) => {
      const tok = /^Bearer ([A-Za-z0-9_-]{32,64})$/.exec(req.get('authorization') || '')?.[1];
      const k = tok ? await db.get('SELECT office_id, tenant_id FROM telas_api_keys WHERE token_hash = ?', [sha256(tok)]) : null;
      const o = k ? await db.get('SELECT id, tenant_id, name, type FROM telas_offices WHERE id = ? AND tenant_id = ?', [k.office_id, k.tenant_id]) : null;
      if (!o) return res.status(401).json({ error: 'Chave de integração inválida.' });
      const tid = Number(o.tenant_id);
      if (!(await hasFeature(tid, 'tvcorp')) || !(await hasFeature(tid, 'api'))) return res.status(403).json({ error: 'A TV Corporativa ou a integração por API não estão no plano.', code: 'feature_unavailable' });
      if (!hit(sha256(tok))) return res.status(429).json({ error: 'Muitos envios. Aguarde um minuto.' });
      req.tenantId = tid; req.office = o; req.by = line(`integração: ${o.name}`, 64);
      return next();
    });
    app.post('/api/tvcorp-api/media/image', keyAuth, rawBody(L.uploadBytes), tooBig, ah(async (req, res) => {
      const q = req.query || {};
      const tid = req.tenantId; const oid = Number(req.office.id);
      let replace = null;
      if (q.id) {
        replace = await own('tvcorp_media', q.id, tid, 'Mídia');
        if (Number(replace.office_id) !== oid || replace.kind !== 'image') throw fail(404, 'Mídia não encontrada.');
      }
      const id = await storeImage(tid, needBody(req), { officeId: oid, title: line(q.title, L.title), caption: q.caption, seconds: q.seconds, opts: q, by: req.by, replace });
      const r = await own('tvcorp_media', id, tid, 'Mídia');
      await audit({ username: req.by, action: 'POST /api/tvcorp-api/media/image', detail: `tv corporativa: imagem "${r.title}" (#${id}) ${replace ? 'trocada' : 'enviada'} pela chave de integração de "${req.office.name}"`, status: replace ? 200 : 201, ip: ipOf(req), tenantId: tid });
      noStore(res).status(replace ? 200 : 201).json(mediaDto(r));
    }));
  }

  /** Monta as rotas do painel e da chave de integração (a do link da unidade é mountOffice, com a guarda do telas.js). */
  function mount(app, { needs }) {
    mountPanel(app, { needs });
    mountApi(app);
  }

  return {
    mount, mountPanel, mountOffice, mountApi,
    signageFor, recordPlays, summary, decide, prune, dropOffice, forgetData,
    /** O arquivo do contrato ({ url, sha256, bytes }) de uma imagem da biblioteca, ou null (pendente, apagada, outro cliente). */
    mediaFileFor: async (tenantId, mediaId, req = null) => imageFile((await load(tenantId)).media, mediaId, req),
    groupIdsOf, stop: () => { if (timer) clearInterval(timer); },
  };
}
