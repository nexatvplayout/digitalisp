// Canais ao vivo (HLS) de cada conta: o endereço .m3u8 de um canal do NEXA Broadcast, do IPTV do provedor, de uma câmera
// ou de qualquer fonte. A unidade escolhe um (telas_offices.channel_id = isp_hls.id) e a zona de vídeo do layout toca ele.
//   GET    /api/hls            a lista da conta
//   POST   /api/hls            { nome, url }
//   PATCH  /api/hls/:id        { nome?, url?, ativo? }
//   DELETE /api/hls/:id        (as unidades que usavam ficam sem canal)
// O módulo das telas pede channelsOf(conta) de forma SÍNCRONA (validação do cadastro da unidade): a lista fica em memória,
// carregada na subida e refeita a cada mudança.
import { db } from './db.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const porConta = new Map(); // tenant_id -> [{ id, slug, name, url, ativo }]

const dto = (r) => ({ id: Number(r.id), slug: `hls-${r.id}`, name: r.nome, url: r.url, ativo: Boolean(Number(r.ativo)) });
async function recarregar(tenantId) {
  const rows = await db.all('SELECT * FROM isp_hls WHERE tenant_id = ? ORDER BY nome, id', [tenantId]);
  porConta.set(Number(tenantId), rows.map(dto));
}
export async function carregarHls() {
  porConta.clear();
  for (const r of await db.all('SELECT * FROM isp_hls ORDER BY tenant_id, nome, id')) {
    const k = Number(r.tenant_id);
    if (!porConta.has(k)) porConta.set(k, []);
    porConta.get(k).push(dto(r));
  }
}

/** [{ id, slug, name }] dos canais ativos da conta (para o módulo das telas). */
export const channelsOf = (tenantId) => (porConta.get(Number(tenantId)) || []).filter((c) => c.ativo).map(({ id, slug, name }) => ({ id, slug, name }));
/** { slug, hls } do canal da unidade; sem canal escolhido, nenhum (a zona de vídeo passa os vídeos guardados). */
export function streamOf(tenantId, channelId) {
  if (channelId == null) return null;
  const c = (porConta.get(Number(tenantId)) || []).find((x) => x.id === Number(channelId) && x.ativo);
  return c ? { slug: c.slug, hls: c.url } : null;
}

function cleanUrl(v) {
  const u = text(v, 500);
  let p; try { p = new URL(u); } catch { throw fail(400, 'Endereço inválido: cole o link completo do .m3u8 (https://…).'); }
  if (!/^https?:$/.test(p.protocol)) throw fail(400, 'O endereço precisa começar com https:// (ou http://).');
  return p.toString();
}

export function mountHls(app, { needs, ah }) {
  const M = needs('tvcorp.manage');
  app.get('/api/hls', M, ah(async (req, res) => {
    await recarregar(req.tenantId);
    res.set('Cache-Control', 'no-store').json(porConta.get(Number(req.tenantId)) || []);
  }));
  app.post('/api/hls', M, ah(async (req, res) => {
    const b = req.body || {};
    const nome = text(b.nome, 80); if (nome.length < 2) throw fail(400, 'Dê um nome ao canal (ex.: TV do Provedor).');
    const url = cleanUrl(b.url);
    if (Number((await db.get('SELECT COUNT(*) AS n FROM isp_hls WHERE tenant_id = ?', [req.tenantId])).n) >= 100) throw fail(409, 'Limite de 100 canais ao vivo.');
    const id = await db.insert('INSERT INTO isp_hls(tenant_id, nome, url, ativo, created_at) VALUES(?,?,?,?,?)', [req.tenantId, nome, url, 1, Date.now()]);
    await recarregar(req.tenantId);
    res.locals.audit = `cadastrou o canal ao vivo ${nome}`;
    res.status(201).json(dto(await db.get('SELECT * FROM isp_hls WHERE id = ?', [id])));
  }));
  app.patch('/api/hls/:id', M, ah(async (req, res) => {
    const cur = await db.get('SELECT * FROM isp_hls WHERE id = ? AND tenant_id = ?', [Number(req.params.id), req.tenantId]);
    if (!cur) throw fail(404, 'Canal inexistente.');
    const b = req.body || {};
    const nome = b.nome !== undefined ? text(b.nome, 80) : cur.nome; if (nome.length < 2) throw fail(400, 'Nome inválido.');
    const url = b.url !== undefined ? cleanUrl(b.url) : cur.url;
    const ativo = b.ativo !== undefined ? (b.ativo ? 1 : 0) : Number(cur.ativo);
    await db.run('UPDATE isp_hls SET nome = ?, url = ?, ativo = ? WHERE id = ?', [nome, url, ativo, cur.id]);
    await recarregar(req.tenantId);
    res.json(dto(await db.get('SELECT * FROM isp_hls WHERE id = ?', [cur.id])));
  }));
  app.delete('/api/hls/:id', M, ah(async (req, res) => {
    const cur = await db.get('SELECT * FROM isp_hls WHERE id = ? AND tenant_id = ?', [Number(req.params.id), req.tenantId]);
    if (!cur) throw fail(404, 'Canal inexistente.');
    await db.run('UPDATE telas_offices SET channel_id = NULL WHERE tenant_id = ? AND channel_id = ?', [req.tenantId, cur.id]);
    await db.run('DELETE FROM isp_hls WHERE id = ?', [cur.id]);
    await recarregar(req.tenantId);
    res.locals.audit = `apagou o canal ao vivo ${cur.nome}`;
    res.json({ ok: true });
  }));
}
