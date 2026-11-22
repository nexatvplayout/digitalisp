// Superadmin do DIGITAL ISP: os dados completos da revenda, o mapa do Brasil (revendas, clientes finais e telas) e as
// cobranças da plataforma para as revendas (faturas mensais, pelo sistema ou por fora). Montado em /api/platform.
//
// Cobrança: "fora" = a plataforma lança a fatura e registra o pagamento à mão (Pix, transferência, boleto de outro banco);
// "sistema" = a fatura sai com boleto/Pix gerado pela empresa de cobrança. A empresa ainda não foi escolhida: por
// enquanto toda fatura é registrada como "fora", e o campo gateway_id/link fica para a integração.
import { db } from './db.js';
import * as T from './tenancy.js';
import { cleanBrPlace } from './br-places.js';
import { geocode } from './web/fontes.js';
import { onlyDigits, validCpf } from '../public/shared/br-docs.js';

const { fail } = T;
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v) => (v == null || v === '' ? null : Number(v));
const ONLINE_MS = 2 * 60_000; // a tela manda sinal de vida a cada 30 s: 2 min sem sinal = fora do ar
const UF_NOME = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
  GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba',
  PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

/* ------------------------------------------------------------------ dados da revenda */
export const extrasDto = (r) => ({
  fantasia: r?.fantasia || '', whatsapp: r?.whatsapp || '', responsavel: r?.responsavel || '', respCpf: r?.resp_cpf || '', site: r?.site || '',
  uf: r?.uf || '', municipio: r?.municipio || '', municipioIbge: r?.municipio_ibge != null ? Number(r.municipio_ibge) : null,
  lat: r?.lat != null ? Number(r.lat) : null, lng: r?.lng != null ? Number(r.lng) : null,
  cobranca: { modo: r?.cobranca_modo || 'fora', diaVencimento: Number(r?.dia_vencimento) || 10, valorCents: r?.valor_cents != null ? Number(r.valor_cents) : null },
});
export const loadExtras = async (tenantId) => extrasDto(await db.get('SELECT * FROM isp_revenda WHERE tenant_id = ?', [tenantId]));

/** O ponto do município no mapa (busca de cidade sem chave; falhou = sem ponto, nunca impede o cadastro). */
async function pointOf(municipio, uf) {
  try {
    const list = await geocode(municipio);
    const hit = list.find((x) => x.pais === 'Brasil' && x.estado === UF_NOME[uf]) || list.find((x) => x.pais === 'Brasil');
    return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
  } catch { return null; }
}

/** Grava os dados completos que vieram no corpo (só os citados mudam). */
export async function saveExtras(tenantId, b = {}) {
  const cur = await db.get('SELECT * FROM isp_revenda WHERE tenant_id = ?', [tenantId]);
  const v = { ...extrasDto(cur) };
  if (b.fantasia !== undefined) v.fantasia = text(b.fantasia, 80);
  if (b.whatsapp !== undefined) { const w = onlyDigits(b.whatsapp); if (w && (w.length < 10 || w.length > 13)) throw fail(400, 'WhatsApp inválido: DDD e número.'); v.whatsapp = w; }
  if (b.responsavel !== undefined) v.responsavel = text(b.responsavel, 80);
  if (b.respCpf !== undefined) { const c = onlyDigits(b.respCpf); if (c && !validCpf(c)) throw fail(400, 'CPF do responsável inválido.'); v.respCpf = c; }
  if (b.site !== undefined) v.site = text(b.site, 120);
  let moved = false;
  if (b.uf !== undefined || b.municipio !== undefined || b.municipioIbge !== undefined) {
    let p; try { p = cleanBrPlace({ uf: b.uf ?? v.uf, city: b.municipio ?? v.municipio, cityIbge: b.municipioIbge ?? null }); } catch (e) { throw fail(400, e.message); }
    moved = p.city_ibge !== v.municipioIbge;
    v.uf = p.uf || ''; v.municipio = p.city || ''; v.municipioIbge = p.city_ibge;
  }
  if ((moved || v.lat == null) && v.municipio) { const pt = await pointOf(v.municipio, v.uf); v.lat = pt?.lat ?? null; v.lng = pt?.lng ?? null; }
  if (!v.municipio) { v.lat = null; v.lng = null; }
  const c = b.cobranca || {};
  if (c.modo !== undefined) { if (!['fora', 'sistema'].includes(c.modo)) throw fail(400, 'Forma de cobrança: "fora" ou "sistema".'); v.cobranca.modo = c.modo; }
  if (c.diaVencimento !== undefined) { const d = Number(c.diaVencimento); if (!Number.isInteger(d) || d < 1 || d > 28) throw fail(400, 'Dia do vencimento: de 1 a 28.'); v.cobranca.diaVencimento = d; }
  if (c.valorCents !== undefined) { const x = num(c.valorCents); if (x != null && (!Number.isInteger(x) || x < 0)) throw fail(400, 'Valor mensal inválido.'); v.cobranca.valorCents = x; }
  const row = [v.fantasia, v.whatsapp, v.responsavel, v.respCpf, v.site, v.uf, v.municipio, v.municipioIbge, v.lat, v.lng, v.cobranca.modo, v.cobranca.diaVencimento, v.cobranca.valorCents, Date.now()];
  if (cur) await db.run('UPDATE isp_revenda SET fantasia=?, whatsapp=?, responsavel=?, resp_cpf=?, site=?, uf=?, municipio=?, municipio_ibge=?, lat=?, lng=?, cobranca_modo=?, dia_vencimento=?, valor_cents=?, updated_at=? WHERE tenant_id=?', [...row, tenantId]);
  else await db.run('INSERT INTO isp_revenda(fantasia, whatsapp, responsavel, resp_cpf, site, uf, municipio, municipio_ibge, lat, lng, cobranca_modo, dia_vencimento, valor_cents, updated_at, tenant_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [...row, tenantId]);
  return v;
}

/* ------------------------------------------------------------------ faturas */
const STATUS = ['aberta', 'paga', 'cancelada'];
const REF_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const faturaDto = (f, names = new Map()) => ({
  id: Number(f.id), tenantId: Number(f.tenant_id), revenda: names.get(Number(f.tenant_id)) || null, referencia: f.referencia, descricao: f.descricao,
  valorCents: Number(f.valor_cents), vencimento: f.vencimento, status: f.status, modo: f.modo,
  vencida: f.status === 'aberta' && f.vencimento < new Date().toISOString().slice(0, 10),
  pagoEm: f.pago_em != null ? Number(f.pago_em) : null, pagoValorCents: f.pago_valor_cents != null ? Number(f.pago_valor_cents) : null, pagoForma: f.pago_forma || null,
  obs: f.obs, link: f.link || null, createdAt: Number(f.created_at), createdBy: f.created_by,
});
const tenantNames = async () => new Map((await db.all('SELECT id, name FROM tenants')).map((t) => [Number(t.id), t.name]));
/** O valor mensal da revenda: o combinado com ela ou, sem ele, o preço do plano. */
async function monthlyOf(t) {
  const x = await loadExtras(t.id);
  if (x.cobranca.valorCents != null) return x.cobranca.valorCents;
  const plan = t.plan_id ? await T.getPlan(Number(t.plan_id)) : null;
  return plan ? (plan.interval === 'year' ? Math.round(plan.priceCents / 12) : plan.priceCents) : 0;
}

/* ------------------------------------------------------------------ rotas */
export function mountRevendas(r, { A, ah, aud }) {
  /* mapa do Brasil: revendas (pelo município), clientes finais e telas, com o estado de cada tela */
  r.get('/mapa', A('platform.view'), ah(async (_req, res) => {
    const now = Date.now();
    const [tenants, extras, offices, devices] = await Promise.all([
      db.all('SELECT id, name, slug, status FROM tenants ORDER BY name'),
      db.all('SELECT tenant_id, fantasia, uf, municipio, lat, lng FROM isp_revenda'),
      db.all('SELECT id, tenant_id, name, type, lat, lng FROM telas_offices'),
      db.all('SELECT id, tenant_id, office_id, name, lat, lng, last_seen FROM telas_devices WHERE revoked_at IS NULL'),
    ]);
    const ex = new Map(extras.map((x) => [Number(x.tenant_id), x]));
    const off = new Map(offices.map((o) => [Number(o.id), o]));
    const n = (v) => (v == null ? null : Number(v));
    res.json({
      serverTime: now, onlineMs: ONLINE_MS,
      revendas: tenants.map((t) => { const x = ex.get(Number(t.id)) || {}; return { id: Number(t.id), name: t.name, fantasia: x.fantasia || '', status: t.status, uf: x.uf || '', municipio: x.municipio || '', lat: n(x.lat), lng: n(x.lng) }; }),
      clientes: offices.map((o) => ({ id: Number(o.id), tenantId: Number(o.tenant_id), name: o.name, lat: n(o.lat), lng: n(o.lng) })),
      telas: devices.map((d) => {
        const o = off.get(Number(d.office_id));
        const seen = n(d.last_seen);
        return {
          id: Number(d.id), tenantId: Number(d.tenant_id), clienteId: n(d.office_id), cliente: o?.name || null, name: d.name,
          lat: d.lat != null ? Number(d.lat) : n(o?.lat), lng: d.lng != null ? Number(d.lng) : n(o?.lng),
          lastSeen: seen, status: !seen ? 'nunca' : now - seen <= ONLINE_MS ? 'no-ar' : 'fora',
        };
      }),
    });
  }));

  /* faturas */
  r.get('/faturas', A('platform.view'), ah(async (req, res) => {
    const where = []; const args = [];
    if (req.query.status && STATUS.includes(req.query.status)) { where.push('status = ?'); args.push(req.query.status); }
    if (req.query.tenant) { where.push('tenant_id = ?'); args.push(Number(req.query.tenant)); }
    const rows = await db.all(`SELECT * FROM isp_faturas ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY vencimento DESC, id DESC LIMIT 500`, args);
    const names = await tenantNames();
    const list = rows.map((f) => faturaDto(f, names));
    const sum = (fn) => list.filter(fn).reduce((s, f) => s + f.valorCents, 0);
    res.json({ faturas: list, totais: { abertoCents: sum((f) => f.status === 'aberta'), vencidoCents: sum((f) => f.vencida), pagoCents: list.filter((f) => f.status === 'paga').reduce((s, f) => s + (f.pagoValorCents ?? f.valorCents), 0) } });
  }));

  r.post('/faturas', A('platform.billing'), ah(async (req, res) => {
    const b = req.body || {};
    const t = await T.getTenant(Number(b.tenantId));
    if (!t) throw fail(404, 'Revenda inexistente.');
    const valor = num(b.valorCents);
    if (!Number.isInteger(valor) || valor <= 0) throw fail(400, 'Informe o valor (em centavos, maior que zero).');
    if (!DATE_RE.test(String(b.vencimento || ''))) throw fail(400, 'Vencimento inválido (AAAA-MM-DD).');
    const ref = b.referencia ? String(b.referencia) : `avulsa-${Date.now()}`;
    if (b.referencia && !REF_RE.test(ref)) throw fail(400, 'Referência: o mês, AAAA-MM.');
    if (await db.get('SELECT id FROM isp_faturas WHERE tenant_id = ? AND referencia = ?', [t.id, ref])) throw fail(409, `Já existe fatura de ${ref} para esta revenda.`);
    const id = await db.insert('INSERT INTO isp_faturas(tenant_id, referencia, descricao, valor_cents, vencimento, status, modo, obs, created_at, created_by) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [t.id, ref, text(b.descricao, 120) || (b.referencia ? `Mensalidade ${ref}` : 'Cobrança avulsa'), valor, b.vencimento, 'aberta', 'fora', text(b.obs, 300), Date.now(), req.user.username]);
    aud(res, t.id, `lançou a fatura #${id} (${ref}) de ${t.slug}`);
    res.status(201).json(faturaDto(await db.get('SELECT * FROM isp_faturas WHERE id = ?', [id]), await tenantNames()));
  }));

  /* gera as mensalidades de um mês para as revendas ativas (as que já têm a do mês ficam como estão) */
  r.post('/faturas/gerar-mes', A('platform.billing'), ah(async (req, res) => {
    const ref = String(req.body?.referencia || '');
    if (!REF_RE.test(ref)) throw fail(400, 'Referência: o mês, AAAA-MM.');
    const out = { criadas: [], puladas: [] };
    for (const t of await db.all("SELECT * FROM tenants WHERE status IN ('active', 'past_due') ORDER BY id")) {
      if (await db.get('SELECT id FROM isp_faturas WHERE tenant_id = ? AND referencia = ?', [t.id, ref])) { out.puladas.push({ id: Number(t.id), name: t.name, motivo: 'já tem' }); continue; }
      const valor = await monthlyOf(t);
      if (!valor) { out.puladas.push({ id: Number(t.id), name: t.name, motivo: 'sem valor' }); continue; }
      const x = await loadExtras(t.id);
      const venc = `${ref}-${String(x.cobranca.diaVencimento).padStart(2, '0')}`;
      await db.insert('INSERT INTO isp_faturas(tenant_id, referencia, descricao, valor_cents, vencimento, status, modo, created_at, created_by) VALUES(?,?,?,?,?,?,?,?,?)',
        [t.id, ref, `Mensalidade ${ref}`, valor, venc, 'aberta', 'fora', Date.now(), req.user.username]);
      out.criadas.push({ id: Number(t.id), name: t.name, valorCents: valor });
    }
    aud(res, null, `gerou as mensalidades de ${ref}: ${out.criadas.length} criada(s)`);
    res.json(out);
  }));

  r.post('/faturas/:id/pagar', A('platform.billing'), ah(async (req, res) => {
    const f = await db.get('SELECT * FROM isp_faturas WHERE id = ?', [Number(req.params.id)]);
    if (!f) throw fail(404, 'Fatura inexistente.');
    if (f.status !== 'aberta') throw fail(409, 'Só uma fatura aberta pode ser paga.');
    const b = req.body || {};
    const valor = b.valorCents == null || b.valorCents === '' ? Number(f.valor_cents) : Number(b.valorCents);
    if (!Number.isInteger(valor) || valor <= 0) throw fail(400, 'Valor pago inválido.');
    const quando = b.data && DATE_RE.test(b.data) ? Date.parse(`${b.data}T12:00:00-03:00`) : Date.now();
    await db.run("UPDATE isp_faturas SET status = 'paga', pago_em = ?, pago_valor_cents = ?, pago_forma = ?, obs = ? WHERE id = ?",
      [quando, valor, text(b.forma, 40) || 'Pix', text(b.obs ?? f.obs, 300), f.id]);
    aud(res, Number(f.tenant_id), `registrou o pagamento da fatura #${f.id}`);
    res.json(faturaDto(await db.get('SELECT * FROM isp_faturas WHERE id = ?', [f.id]), await tenantNames()));
  }));

  r.post('/faturas/:id/cancelar', A('platform.billing'), ah(async (req, res) => {
    const f = await db.get('SELECT * FROM isp_faturas WHERE id = ?', [Number(req.params.id)]);
    if (!f) throw fail(404, 'Fatura inexistente.');
    if (f.status !== 'aberta') throw fail(409, 'Só uma fatura aberta pode ser cancelada.');
    await db.run("UPDATE isp_faturas SET status = 'cancelada', obs = ? WHERE id = ?", [text(req.body?.obs ?? f.obs, 300), f.id]);
    aud(res, Number(f.tenant_id), `cancelou a fatura #${f.id}`);
    res.json(faturaDto(await db.get('SELECT * FROM isp_faturas WHERE id = ?', [f.id]), await tenantNames()));
  }));
}
