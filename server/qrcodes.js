// DIGITAL ISP · Gerenciador de QR Code: o QR dinâmico aponta para um endereço curto (/q/<código>) e o destino muda sem
// trocar o código impresso ou na tela. Destino: um link, uma mídia ou uma playlist (as mesmas das telas, numa página para o
// celular). Cada leitura conta por dia (sem guardar quem leu). Cores e logo do QR ficam com o QR; geração em massa por lista.
//
// Painel (tvcorp.manage):  GET/POST /api/qrcodes · PATCH/DELETE /api/qrcodes/:id · POST /api/qrcodes/lote
// Público:                 GET /q/:code (redireciona ou abre a página) · GET /q/:code/conteudo · GET /q/:code/arquivo/:mediaId
import express from 'express';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import { createLimiter } from './ratelimit.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const CODE_RE = /^[a-z0-9]{6,12}$/;
const HEX = /^#[0-9a-f]{6}$/i;
export const QR_LIMITS = Object.freeze({ porConta: 500, lote: 200, nome: 80 });
const novoCodigo = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; const b = randomBytes(8); let s = ''; for (const x of b) s += a[x % a.length]; return s; };
const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10); // dia em Brasília (UTC-3)

function limparDestino(b, cur = {}) {
  const tipo = b.tipo ?? cur.tipo ?? 'link';
  if (!['link', 'midia', 'playlist'].includes(tipo)) throw fail(400, 'Destino: link, mídia ou playlist.');
  let alvo = b.alvo ?? cur.alvo;
  if (tipo === 'link') {
    let u; try { u = new URL(String(alvo || '').trim()); } catch { throw fail(400, 'Link: um endereço completo, começando com https://.'); }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.href.length > 1000) throw fail(400, 'Link: um endereço http(s) completo.');
    alvo = u.href;
  } else {
    alvo = String(Number(alvo));
    if (!(Number(alvo) > 0)) throw fail(400, tipo === 'midia' ? 'Escolha a mídia.' : 'Escolha a playlist.');
  }
  return { tipo, alvo };
}
const limparEstilo = (b, cur = {}) => ({
  cor: HEX.test(b.cor ?? '') ? b.cor.toLowerCase() : cur.cor || '#000000',
  fundo: HEX.test(b.fundo ?? '') ? b.fundo.toLowerCase() : cur.fundo || '#ffffff',
  logo: b.logo === undefined ? Boolean(cur.logo) : Boolean(b.logo),
});

export function mountQrcodes(app, { needs, publicUrl, tvcorpFile = null, ipOf = (req) => req.ip }) {
  const M = needs('tvcorp.manage');
  const base = (req) => `${publicUrl(req)}/q/`;
  const dto = async (r, req) => {
    const dias = await db.all('SELECT dia, n FROM isp_qr_dias WHERE qr_id = ? ORDER BY dia DESC LIMIT 30', [r.id]);
    return {
      id: Number(r.id), codigo: r.codigo, nome: r.nome, tipo: r.tipo, alvo: r.alvo, link: `${base(req)}${r.codigo}`,
      estilo: JSON.parse(r.estilo || '{}'), ativo: Number(r.ativo) === 1, leituras: Number(r.leituras) || 0,
      dias: dias.map((d) => ({ dia: d.dia, n: Number(d.n) })), criadoEm: Number(r.criado_em), ultimaLeitura: r.ultima_leitura ? Number(r.ultima_leitura) : null,
    };
  };
  const confereAlvo = async (tenantId, d) => {
    if (d.tipo === 'midia' && !(await db.get("SELECT id FROM tvcorp_media WHERE id = ? AND tenant_id = ? AND status = 'ok'", [Number(d.alvo), tenantId]))) throw fail(404, 'Mídia não encontrada (ou ainda não publicada).');
    if (d.tipo === 'playlist' && !(await db.get('SELECT id FROM tvcorp_playlists WHERE id = ? AND tenant_id = ?', [Number(d.alvo), tenantId]))) throw fail(404, 'Playlist não encontrada.');
  };
  const own = async (req) => {
    const r = await db.get('SELECT * FROM isp_qr WHERE id = ? AND tenant_id = ?', [Number(req.params.id), req.tenantId]);
    if (!r) throw fail(404, 'QR code não encontrado.');
    return r;
  };
  async function criar(tenantId, b) {
    const nome = String(b.nome || '').trim().slice(0, QR_LIMITS.nome) || 'QR code';
    const d = limparDestino(b); await confereAlvo(tenantId, d);
    let codigo; for (let i = 0; i < 5; i++) { codigo = novoCodigo(); if (!(await db.get('SELECT id FROM isp_qr WHERE codigo = ?', [codigo]))) break; }
    const t = Date.now();
    return db.insert('INSERT INTO isp_qr(tenant_id, codigo, nome, tipo, alvo, estilo, ativo, leituras, criado_em, atualizado_em) VALUES(?,?,?,?,?,?,1,0,?,?)',
      [tenantId, codigo, nome, d.tipo, d.alvo, JSON.stringify(limparEstilo(b.estilo || {})), t, t]);
  }
  const conta = async (tenantId) => Number((await db.get('SELECT COUNT(*) AS n FROM isp_qr WHERE tenant_id = ?', [tenantId])).n);

  app.get('/api/qrcodes', M, ah(async (req, res) => {
    const rows = await db.all('SELECT * FROM isp_qr WHERE tenant_id = ? ORDER BY id DESC', [req.tenantId]);
    res.set('Cache-Control', 'no-store').json({ qrcodes: await Promise.all(rows.map((r) => dto(r, req))), max: QR_LIMITS.porConta, base: base(req) });
  }));
  app.post('/api/qrcodes', M, express.json({ limit: '8kb' }), ah(async (req, res) => {
    if ((await conta(req.tenantId)) >= QR_LIMITS.porConta) throw fail(400, `No máximo ${QR_LIMITS.porConta} QR codes por conta.`);
    const id = await criar(req.tenantId, req.body || {});
    res.locals.audit = `qr code #${id} criado`;
    res.status(201).json(await dto(await db.get('SELECT * FROM isp_qr WHERE id = ?', [id]), req));
  }));
  /* em massa: [{ nome, alvo (link) }] — por exemplo, um QR por mesa, por produto ou por loja */
  app.post('/api/qrcodes/lote', M, express.json({ limit: '256kb' }), ah(async (req, res) => {
    const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
    if (!itens.length) throw fail(400, 'Mande a lista: uma linha por QR (nome e link).');
    if (itens.length > QR_LIMITS.lote) throw fail(400, `No máximo ${QR_LIMITS.lote} por vez.`);
    if ((await conta(req.tenantId)) + itens.length > QR_LIMITS.porConta) throw fail(400, `Passa do limite de ${QR_LIMITS.porConta} QR codes da conta.`);
    const erros = []; const ids = [];
    for (const [i, it] of itens.entries()) {
      try { ids.push(await criar(req.tenantId, { nome: it.nome, tipo: 'link', alvo: it.alvo, estilo: req.body.estilo || {} })); } catch (e) { erros.push(`Linha ${i + 1}: ${e.message}`); }
    }
    res.locals.audit = `qr codes em massa: ${ids.length} criados`;
    res.status(201).json({ criados: ids.length, erros });
  }));
  app.patch('/api/qrcodes/:id', M, express.json({ limit: '8kb' }), ah(async (req, res) => {
    const cur = await own(req); const b = req.body || {};
    const d = b.tipo !== undefined || b.alvo !== undefined ? limparDestino(b, cur) : { tipo: cur.tipo, alvo: cur.alvo };
    await confereAlvo(req.tenantId, d);
    const nome = b.nome !== undefined ? String(b.nome).trim().slice(0, QR_LIMITS.nome) || cur.nome : cur.nome;
    const estilo = b.estilo !== undefined ? limparEstilo(b.estilo, JSON.parse(cur.estilo || '{}')) : JSON.parse(cur.estilo || '{}');
    const ativo = b.ativo === undefined ? Number(cur.ativo) : b.ativo ? 1 : 0;
    await db.run('UPDATE isp_qr SET nome = ?, tipo = ?, alvo = ?, estilo = ?, ativo = ?, atualizado_em = ? WHERE id = ?', [nome, d.tipo, d.alvo, JSON.stringify(estilo), ativo, Date.now(), cur.id]);
    res.locals.audit = `qr code #${cur.id} alterado (destino: ${d.tipo})`;
    res.json(await dto(await db.get('SELECT * FROM isp_qr WHERE id = ?', [cur.id]), req));
  }));
  app.delete('/api/qrcodes/:id', M, ah(async (req, res) => {
    const cur = await own(req);
    await db.run('DELETE FROM isp_qr_dias WHERE qr_id = ?', [cur.id]);
    await db.run('DELETE FROM isp_qr WHERE id = ?', [cur.id]);
    res.locals.audit = `qr code #${cur.id} apagado`;
    res.json({ ok: true });
  }));

  /* ---------------------------------------------------------------- público: a leitura do QR */
  const porIp = createLimiter({ windowMs: 60_000, max: 120, maxKeys: 100_000 });
  const pagina = path.join(config.root, 'public', 'q', 'index.html');
  const doCodigo = async (code) => (CODE_RE.test(code) ? db.get('SELECT * FROM isp_qr WHERE codigo = ? AND ativo = 1', [code]) : null);
  app.get('/q/:code', ah(async (req, res) => {
    const r = await doCodigo(String(req.params.code || '').toLowerCase());
    if (!r) return res.status(404).type('text/plain; charset=utf-8').send('QR code não encontrado ou desligado.');
    if (porIp.hit(ipOf(req))) { // a mesma pessoa lendo sem parar não infla a conta
      const dia = hoje();
      await db.run('UPDATE isp_qr SET leituras = leituras + 1, ultima_leitura = ? WHERE id = ?', [Date.now(), r.id]);
      await db.run('INSERT INTO isp_qr_dias(qr_id, dia, n) VALUES(?,?,1) ON CONFLICT (qr_id, dia) DO UPDATE SET n = isp_qr_dias.n + 1', [r.id, dia]);
    }
    res.set('Cache-Control', 'no-store');
    if (r.tipo === 'link') return res.redirect(302, r.alvo);
    res.sendFile(pagina);
  }));
  /* o conteúdo da página do celular: a mídia ou os itens de mídia da playlist (imagens, vídeos e slides) */
  app.get('/q/:code/conteudo', ah(async (req, res) => {
    const r = await doCodigo(String(req.params.code || '').toLowerCase());
    if (!r || r.tipo === 'link') return res.status(404).json({ error: 'Não encontrado.' });
    // a ordem e o tempo de cada item, como na tela (a página do celular passa um por vez)
    const rows = r.tipo === 'midia' ? [{ ref_id: Number(r.alvo), seconds: null }]
      : await db.all("SELECT ref_id, seconds FROM tvcorp_playlist_items WHERE playlist_id = ? AND tenant_id = ? AND ref_kind = 'media' ORDER BY sort, id", [Number(r.alvo), r.tenant_id]);
    const ids = rows.map((x) => Number(x.ref_id)); const secs = new Map(rows.map((x) => [Number(x.ref_id), Number(x.seconds) || null]));
    const itens = [];
    for (const id of ids.slice(0, 40)) {
      const m = await db.get("SELECT id, kind, title, template, fields FROM tvcorp_media WHERE id = ? AND tenant_id = ? AND status = 'ok'", [id, r.tenant_id]);
      if (!m) continue;
      const f = JSON.parse(m.fields || '{}');
      const seconds = Math.min(60, Math.max(4, secs.get(id) || 8));
      if (m.kind === 'slide') itens.push({ kind: 'slide', seconds, title: m.title, template: m.template, fields: f, image: f.image ? `/q/${r.codigo}/arquivo/${Number(f.image)}` : null });
      else itens.push({ kind: m.kind, seconds, title: m.title, url: `/q/${r.codigo}/arquivo/${m.id}`, ...(m.kind === 'video' && f.poster ? { poster: `/q/${r.codigo}/arquivo/${m.id}?poster=1` } : {}) });
    }
    const pl = r.tipo === 'playlist' ? await db.get('SELECT name FROM tvcorp_playlists WHERE id = ?', [Number(r.alvo)]) : null;
    const t = await db.get('SELECT name FROM tenants WHERE id = ?', [r.tenant_id]);
    res.set('Cache-Control', 'no-store').json({ titulo: r.nome || pl?.name || '', empresa: t?.name || '', itens });
  }));
  /* o arquivo de uma mídia que o QR mostra (só as dele: a própria mídia, os itens da playlist e a foto de um slide deles) */
  app.get('/q/:code/arquivo/:mediaId', ah(async (req, res) => {
    const r = await doCodigo(String(req.params.code || '').toLowerCase());
    if (!r || r.tipo === 'link' || !tvcorpFile) return res.status(404).end();
    const mid = Number(req.params.mediaId);
    const permitidos = new Set(r.tipo === 'midia' ? [Number(r.alvo)] : (await db.all("SELECT ref_id FROM tvcorp_playlist_items WHERE playlist_id = ? AND tenant_id = ? AND ref_kind = 'media'", [Number(r.alvo), r.tenant_id])).map((x) => Number(x.ref_id)));
    for (const id of [...permitidos]) { const s = await db.get("SELECT fields FROM tvcorp_media WHERE id = ? AND kind = 'slide'", [id]); const img = s ? JSON.parse(s.fields || '{}').image : null; if (img) permitidos.add(Number(img)); }
    if (!permitidos.has(mid)) return res.status(404).end();
    return tvcorpFile(r.tenant_id, mid, { poster: req.query.poster === '1' }, req, res);
  }));
}
