/* NEXA Telas: a imagem de reserva sem conexão (contrato telas-contrato.md §7.3 "offline.image", 14/11). A prefeitura sobe
   uma imagem por nível (padrão da prefeitura, grupo ou repartição, os mesmos níveis dos vídeos guardados); quando a internet
   cai e não há vídeo guardado, a TV box mostra essa imagem em vez de ficar preta.

     Painel da Prefeitura   GET    /api/prefeitura/offline-image                  (as imagens de cada nível; também no GET /api/prefeitura/offline)
                            GET    /api/prefeitura/offline-image/:scope/:scopeId  (a imagem, para a miniatura)
                            PUT    /api/prefeitura/offline-image/:scope/:scopeId  (corpo: a imagem crua, JPEG, PNG ou WebP até 15 MB)
                            DELETE /api/prefeitura/offline-image/:scope/:scopeId
     Link da repartição     GET|PUT|DELETE /api/reparticao/offline-image[/file] (só o nível da própria repartição; só o gestor)

   O que a pessoa sobe é conferido pelo conteúdo (não pela extensão) e vira um JPEG 1920×1080 sem metadados, cobrindo o quadro
   (corta as sobras, sem distorcer), de até 2 MB. Fica no armazenamento do projeto com nome sorteado ("telasimg-<uuid>.jpg");
   trocar ou remover apaga o arquivo anterior. A tela recebe a do nível mais específico: repartição > grupo(s) > padrão. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import { db } from './db.js';
import * as C from './telas-core.js';
import { sniffImage, encodeJpeg } from './telas-desaparecidos.js';

const { fail, line } = C;
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const OFFLINE_IMAGE = Object.freeze({ width: 1920, height: 1080, maxBytes: 2 * 1024 * 1024, uploadBytes: 15 * 1024 * 1024 });
export const IMAGE_PREFIX = 'telasimg-';
export const IMAGE_RE = /^telasimg-[0-9a-f-]{36}\.jpg$/;
export const IMAGE_SCOPES = Object.freeze(['default', 'group', 'office']);
const TOO_BIG = 'A imagem passa de 15 MB. Escolha outra.';

/**
 * A imagem enviada vira o JPEG que vai às telas: 1920×1080 cobrindo o quadro, sem metadados, até 2 MB (baixa a qualidade até
 * caber). Arquivo que não é imagem: 400.
 */
export async function prepareOfflineImage(buf, { ffmpeg, checkImage = null }) {
  const kind = sniffImage(buf);
  if (!kind) throw fail(400, 'Use uma imagem JPEG, PNG ou WebP.');
  if (buf.length > OFFLINE_IMAGE.uploadBytes) throw fail(413, TOO_BIG);
  if (checkImage) { try { checkImage(buf); } catch { throw fail(400, 'Imagem grande demais (até 16 megapixels) ou num formato que não dá para conferir.'); } }
  if (!ffmpeg) throw fail(503, 'O servidor está sem o FFmpeg para preparar a imagem.');
  const { width: w, height: h } = OFFLINE_IMAGE;
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},setsar=1,format=yuvj420p`;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nexa-telasimg-'));
  try {
    const input = path.join(dir, 'in'); const output = path.join(dir, 'out.jpg');
    await fs.promises.writeFile(input, buf);
    for (const q of [2, 4, 6, 9, 13, 18, 24, 31]) {
      try { await encodeJpeg(ffmpeg, input, output, kind, w, q, vf); } catch { throw fail(400, 'Não foi possível ler esta imagem. Tente outra.'); }
      const out = await fs.promises.readFile(output);
      if (out.length > 0 && out.length <= OFFLINE_IMAGE.maxBytes) return out;
    }
    throw fail(400, 'Não foi possível preparar esta imagem dentro de 2 MB. Tente outra.');
  } finally { await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

/** offline.image do contrato, ou null se algo estiver fora do formato (o app ignoraria). */
export function imageContract(row, url) {
  if (!row || !IMAGE_RE.test(String(row.file || ''))) return null;
  const bytes = Number(row.bytes);
  if (!/^[0-9a-f]{64}$/.test(String(row.sha256 || '')) || !(bytes >= 1 && bytes <= OFFLINE_IMAGE.maxBytes) || !/^https:\/\//i.test(String(url || ''))) return null;
  return { url, sha256: row.sha256, bytes };
}
/** A linha do nível mais específico que tem imagem: a repartição, depois os grupos da tela (na ordem), depois o padrão. */
export function pickImage(rows, { officeId, groupIds = [] }) {
  const at = (scope, id) => rows.find((r) => r.scope === scope && Number(r.scope_id) === Number(id)) || null;
  return at('office', officeId) || groupIds.map((g) => at('group', g)).find(Boolean) || at('default', 0);
}
const dto = (r) => ({ scope: r.scope, scopeId: Number(r.scope_id), bytes: Number(r.bytes), createdBy: r.created_by || '', createdAt: Number(r.created_at) });
const scopeText = (scope, scopeId) => (scope === 'default' ? 'padrão da prefeitura' : `${scope === 'group' ? 'grupo' : 'repartição'} #${scopeId}`);

/**
 * deps: cached(key, fn) e forget(tenantId) (as leituras guardadas de server/telas.js), own(tabela, id, tenantId, nome) (404
 * fora do cliente), now e images: { dir, ffmpeg, checkImage(buf), put(nome), remove(nome), url(nome, req) -> endereço
 * público, read(nome) -> Buffer, list?() -> [{ name, mtime }] }.
 */
export function createImagemOffline({ cached, forget, own, images, now = () => Date.now() }) {
  const fileOf = (name) => path.join(images.dir, name);
  async function dropFile(name) {
    if (!name || !IMAGE_RE.test(name)) return;
    try { await images.remove(name); } catch (err) { console.warn(`[telas] imagem de reserva antiga não saiu do armazenamento (${String(err?.message || err).slice(0, 120)})`); }
    await fs.promises.rm(fileOf(name), { force: true }).catch(() => {});
  }
  const rowsOf = (tenantId) => cached(`offimg:${tenantId}`, () => db.all('SELECT * FROM telas_offline_image WHERE tenant_id = ?', [tenantId]));
  /** offline.image de uma tela (ou null). */
  async function imageFor(tenantId, { officeId, groupIds = [] }, req) {
    const rows = await rowsOf(tenantId);
    if (!rows.length) return null;
    const r = pickImage(rows, { officeId, groupIds });
    return r ? imageContract(r, images.url(r.file, req)) : null;
  }
  const list = async (tenantId) => (await db.all('SELECT * FROM telas_offline_image WHERE tenant_id = ? ORDER BY scope, scope_id', [tenantId])).map(dto);
  /** O nível, conferido: grupo e repartição só deste cliente (o de outro cliente é "não encontrado"). */
  async function scopeOf(tenantId, scope, scopeId) {
    if (!IMAGE_SCOPES.includes(scope)) throw fail(400, 'Nível inválido (padrão da prefeitura, grupo ou repartição).');
    if (scope === 'default') return { scope, scopeId: 0 };
    const row = await own(scope === 'group' ? 'telas_groups' : 'telas_offices', scopeId, tenantId, scope === 'group' ? 'Grupo' : 'Repartição');
    return { scope, scopeId: Number(row.id) };
  }
  const rowAt = (tenantId, scope, scopeId) => db.get('SELECT * FROM telas_offline_image WHERE tenant_id = ? AND scope = ? AND scope_id = ?', [tenantId, scope, scopeId]);
  /** Prepara, guarda e troca a imagem do nível; o arquivo anterior sai do armazenamento. */
  async function store(tenantId, scope, scopeId, buf, by) {
    const out = await prepareOfflineImage(buf, images);
    const name = `${IMAGE_PREFIX}${randomUUID()}.jpg`;
    await fs.promises.mkdir(images.dir, { recursive: true });
    await fs.promises.writeFile(fileOf(name), out);
    try { await images.put(name); } catch { await fs.promises.rm(fileOf(name), { force: true }).catch(() => {}); throw fail(502, 'Não foi possível guardar a imagem agora. Tente de novo.'); }
    const sha = createHash('sha256').update(out).digest('hex');
    const prev = await rowAt(tenantId, scope, scopeId);
    try {
      await db.run(`INSERT INTO telas_offline_image(tenant_id,scope,scope_id,file,sha256,bytes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT (tenant_id, scope, scope_id) DO UPDATE SET file = excluded.file, sha256 = excluded.sha256, bytes = excluded.bytes, created_by = excluded.created_by, created_at = excluded.created_at`,
      [tenantId, scope, scopeId, name, sha, out.length, line(by, 64), now()]);
    } catch (err) { await dropFile(name); throw err; }
    forget(tenantId);
    if (prev && prev.file !== name) await dropFile(prev.file);
    return { scope, scopeId, bytes: out.length, sha256: sha };
  }
  async function remove(tenantId, scope, scopeId) {
    const prev = await rowAt(tenantId, scope, scopeId);
    if (!prev) return false;
    await db.run('DELETE FROM telas_offline_image WHERE tenant_id = ? AND scope = ? AND scope_id = ?', [tenantId, scope, scopeId]);
    forget(tenantId);
    await dropFile(prev.file);
    return true;
  }
  async function read(tenantId, scope, scopeId) {
    const r = await rowAt(tenantId, scope, scopeId);
    if (!r) throw fail(404, 'Este nível não tem imagem.');
    try { return await images.read(r.file); } catch { throw fail(404, 'A imagem não está disponível agora.'); }
  }

  const rawBody = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: OFFLINE_IMAGE.uploadBytes });
  const tooBig = (err, _req, res, next) => (err?.type === 'entity.too.large' ? res.status(413).json({ error: TOO_BIG }) : next(err));
  const needBody = (req) => { if (!Buffer.isBuffer(req.body) || !req.body.length) throw fail(415, 'Envie a imagem (JPEG, PNG ou WebP) no corpo do pedido.'); return req.body; };
  const sendJpeg = (res, buf) => res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' }).send(buf);

  /** Painel da Prefeitura: qualquer nível do cliente. M: os middlewares do painel; who(req): o usuário. */
  function mountPanel(app, { M, who }) {
    const base = '/api/prefeitura/offline-image';
    const at = (req) => scopeOf(req.tenantId, req.params.scope, req.params.scope === 'default' ? 0 : req.params.scopeId);
    app.get(base, M, ah(async (req, res) => res.set('Cache-Control', 'no-store').json({ limits: OFFLINE_IMAGE, images: await list(req.tenantId) })));
    app.get(`${base}/:scope/:scopeId`, M, ah(async (req, res) => { const s = await at(req); sendJpeg(res, await read(req.tenantId, s.scope, s.scopeId)); }));
    app.put(`${base}/:scope/:scopeId`, M, rawBody, tooBig, ah(async (req, res) => {
      const s = await at(req);
      const out = await store(req.tenantId, s.scope, s.scopeId, needBody(req), who(req));
      res.locals.audit = `prefeitura: imagem sem internet (${scopeText(s.scope, s.scopeId)}) enviada (${Math.round(out.bytes / 1024)} KB)`;
      res.set('Cache-Control', 'no-store').json(out);
    }));
    app.delete(`${base}/:scope/:scopeId`, M, ah(async (req, res) => {
      const s = await at(req);
      if (!(await remove(req.tenantId, s.scope, s.scopeId))) throw fail(404, 'Este nível não tem imagem.');
      res.locals.audit = `prefeitura: imagem sem internet (${scopeText(s.scope, s.scopeId)}) removida`;
      res.json({ ok: true });
    }));
  }
  /** Link de controle da repartição: só o nível da própria repartição. guard: sessão + gestor; note: a auditoria do link. */
  function mountOffice(app, { guard, note }) {
    const base = '/api/reparticao/offline-image';
    const mine = (req) => ({ tenantId: Number(req.tenantId), officeId: Number(req.office.id) });
    app.get(base, guard, ah(async (req, res) => {
      const { tenantId, officeId } = mine(req);
      const r = await rowAt(tenantId, 'office', officeId);
      res.set('Cache-Control', 'no-store').json({ limits: OFFLINE_IMAGE, image: r ? dto(r) : null });
    }));
    app.get(`${base}/file`, guard, ah(async (req, res) => { const { tenantId, officeId } = mine(req); sendJpeg(res, await read(tenantId, 'office', officeId)); }));
    app.put(base, guard, rawBody, tooBig, ah(async (req, res) => {
      const { tenantId, officeId } = mine(req);
      const out = await store(tenantId, 'office', officeId, needBody(req), req.by);
      await note(req, `PUT ${base}`, `prefeitura: imagem sem internet da repartição "${req.office.name}" enviada (${Math.round(out.bytes / 1024)} KB) pelo link de controle`);
      res.set('Cache-Control', 'no-store').json(out);
    }));
    app.delete(base, guard, ah(async (req, res) => {
      const { tenantId, officeId } = mine(req);
      if (!(await remove(tenantId, 'office', officeId))) throw fail(404, 'Esta repartição não tem imagem.');
      await note(req, `DELETE ${base}`, `prefeitura: imagem sem internet da repartição "${req.office.name}" removida pelo link de controle`);
      res.json({ ok: true });
    }));
  }

  /** A repartição ou o grupo foi excluído (dentro da transação): a linha sai; o arquivo, a limpeza tira (prune). */
  const dropScope = (x, tenantId, scope, scopeId) => x.run('DELETE FROM telas_offline_image WHERE tenant_id = ? AND scope = ? AND scope_id = ?', [tenantId, scope, scopeId]);
  /** Limpeza: os arquivos "telasimg-" que nenhuma linha cita (nível excluído, cliente excluído, envio que falhou no meio). */
  async function prune(t = now()) {
    if (!images.list) return;
    try {
      const used = new Set((await db.all('SELECT file FROM telas_offline_image')).map((r) => r.file));
      for (const f of await images.list()) if (IMAGE_RE.test(f.name) && !used.has(f.name) && (!f.mtime || t - f.mtime > 3600_000)) await dropFile(f.name);
    } catch { /* a listagem falhou: fica para a próxima volta */ }
  }
  return { imageFor, list, store, remove, read, mountPanel, mountOffice, dropScope, prune };
}
