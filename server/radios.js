// DIGITAL ISP · rádios do Brasil como som de fundo dos layouts sem o vídeo do canal (loja, recepção, academia).
// A lista (server/radios-br.json, ~1.200 rádios) veio do NEXA Broadcast e é gerada a partir do Radio Browser
// (https://www.radio-browser.info), base comunitária e aberta: o stream e o nome apontam para os servidores das próprias
// rádios; nada de áudio de terceiros passa por aqui.
//
// GET /api/radios                     a lista compacta para o painel escolher (gêneros, estados e rádios)
// GET /api/tvcorp/layouts/:id/radio   a rádio de fundo do layout ({ station } ou { station: null })
// PUT /api/tvcorp/layouts/:id/radio   { station: id | null, volume? 10-100 } (só layout sem zona de vídeo)
// audioOf(tenantId, layoutId) -> o bloco layout.audio do JSON da tela, ou null
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

export const RADIOS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'radios-br.json');
let LIST = null;
function list() {
  if (LIST) return LIST;
  try {
    const j = JSON.parse(fs.readFileSync(RADIOS_FILE, 'utf8'));
    LIST = { genres: j.genres || [], states: j.states || [], stations: j.stations || [], source: j.source || '', updatedAt: j.updatedAt || null };
  } catch { LIST = { genres: [], states: [], stations: [], source: '', updatedAt: null }; }
  LIST.byId = new Map(LIST.stations.map((s) => [String(s.id), s]));
  return LIST;
}
export const stationOf = (id) => list().byId.get(String(id)) || null;

const byLayout = new Map(); // layoutId -> { tenantId, station, volume }
export async function loadRadios() {
  byLayout.clear();
  for (const r of await db.all('SELECT layout_id, tenant_id, station, volume FROM isp_layout_radio')) byLayout.set(Number(r.layout_id), { tenantId: Number(r.tenant_id), station: String(r.station), volume: Number(r.volume) || 100 });
}

/** O bloco de áudio do layout para a tela: a rádio de fundo, se o layout tem uma (e ela ainda está na lista). */
export function audioOf(tenantId, layoutId) {
  const r = byLayout.get(Number(layoutId));
  if (!r || r.tenantId !== Number(tenantId)) return null;
  const s = stationOf(r.station);
  if (!s?.u) return null;
  return { kind: 'radio', id: String(s.id), name: s.n, url: s.u, codec: s.k || null, bitrate: s.b || null, volume: r.volume };
}

const fail = (status, message) => Object.assign(new Error(message), { status });

export function mountRadios(app, { needs, signedIn, ah, onChange = () => {} }) {
  const M = needs('tvcorp.manage');
  app.get('/api/radios', signedIn, (req, res) => {
    const l = list();
    res.set('Cache-Control', 'private, max-age=3600').json({
      source: l.source, updatedAt: l.updatedAt, genres: l.genres, states: l.states,
      stations: l.stations.map((s) => ({ id: s.id, n: s.n, g: s.g, uf: s.uf || null, k: s.k || null, b: s.b || null, https: /^https:/i.test(s.u || '') ? s.u : null })),
    });
  });
  const ownLayout = async (req) => {
    const id = Number(req.params.id);
    const lay = Number.isInteger(id) ? await db.get('SELECT id, zones FROM tvcorp_layouts WHERE id = ? AND tenant_id = ?', [id, req.tenantId]) : null;
    if (!lay) throw fail(404, 'Layout não encontrado.');
    return lay;
  };
  app.get('/api/tvcorp/layouts/:id/radio', M, ah(async (req, res) => {
    const lay = await ownLayout(req);
    const r = byLayout.get(Number(lay.id));
    const s = r ? stationOf(r.station) : null;
    res.set('Cache-Control', 'no-store').json({ station: s ? { id: s.id, n: s.n, g: s.g, uf: s.uf || null } : null, volume: r?.volume ?? 100 });
  }));
  app.put('/api/tvcorp/layouts/:id/radio', M, ah(async (req, res) => {
    const lay = await ownLayout(req);
    const b = req.body || {};
    const station = b.station == null || b.station === '' ? null : String(b.station);
    if (station) {
      if (!stationOf(station)) throw fail(400, 'Rádio não encontrada na lista.');
      let zones = []; try { zones = JSON.parse(lay.zones || '[]'); } catch { /* sem zonas */ }
      if (zones.some((z) => z.kind === 'video')) throw fail(400, 'Este layout tem o vídeo do canal ao vivo: a rádio de fundo é para layouts sem vídeo.');
      if (zones.some((z) => z.kind === 'hdmi')) throw fail(400, 'Este layout tem a entrada HDMI da TV, que já traz o som dela: a rádio de fundo é para layouts sem HDMI.');
    }
    const volume = Math.min(100, Math.max(10, Math.round(Number(b.volume) || 100)));
    await db.run('DELETE FROM isp_layout_radio WHERE layout_id = ?', [lay.id]);
    if (station) await db.run('INSERT INTO isp_layout_radio(layout_id, tenant_id, station, volume) VALUES(?,?,?,?)', [lay.id, req.tenantId, station, volume]);
    if (station) byLayout.set(Number(lay.id), { tenantId: Number(req.tenantId), station, volume }); else byLayout.delete(Number(lay.id));
    onChange(req.tenantId);
    res.locals.audit = station ? `rádio de fundo do layout #${lay.id}: ${stationOf(station).n}` : `rádio de fundo do layout #${lay.id} retirada`;
    res.json({ ok: true });
  }));
}
