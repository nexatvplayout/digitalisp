// Endereço completo do cliente final (unidade) e o ponto no mapa calculado sozinho a partir dele:
//   GET /api/cep/:cep                     preenche rua, bairro, município e UF pelo CEP (ViaCEP, consultado pelo servidor)
//   GET /api/localizar?rua&numero&bairro&municipio&uf   latitude e longitude do endereço (OpenStreetMap; sem achar a rua,
//                                         o centro do município), com a precisão de onde veio
//   GET /api/unidades/enderecos           os endereços estruturados das unidades da revenda (para abrir o formulário)
//   PUT /api/unidades/:id/endereco        grava o endereço estruturado (CEP, rua, número, bairro, UF e município do IBGE)
// O texto do endereço, a latitude e a longitude da unidade continuam no cadastro dela (telas_offices); aqui fica a parte
// estruturada, numa tabela própria (isp_unidade_endereco), para não mexer na tabela herdada.
import { db } from './db.js';
import { getJson } from './web/net.js';
import { geocode } from './web/fontes.js';
import { cleanBrPlace } from './br-places.js';

const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const digits = (v) => String(v ?? '').replace(/\D/g, '');
const fail = (status, message) => Object.assign(new Error(message), { status });
const UF_NOME = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };

const cepCache = new Map();

export function mountEnderecos(app, { needs, ah, geocodeAddress }) {
  app.get('/api/cep/:cep', needs('tvcorp.manage'), ah(async (req, res) => {
    const cep = digits(req.params.cep);
    if (cep.length !== 8) throw fail(400, 'CEP com 8 dígitos.');
    let r = cepCache.get(cep);
    if (!r) {
      let d;
      try { d = await getJson(`https://viacep.com.br/ws/${cep}/json/`, { timeout: 6000, maxBytes: 64 * 1024 }); } catch { throw fail(502, 'Não foi possível consultar o CEP agora. Preencha o endereço à mão.'); }
      if (!d || d.erro) throw fail(404, 'CEP não encontrado.');
      r = { cep, rua: d.logradouro || '', bairro: d.bairro || '', municipio: d.localidade || '', uf: d.uf || '', municipioIbge: d.ibge ? Number(d.ibge) : null };
      if (cepCache.size > 2000) cepCache.clear();
      cepCache.set(cep, r);
    }
    res.json(r);
  }));

  app.get('/api/localizar', needs('tvcorp.manage'), ah(async (req, res) => {
    const q = req.query;
    const uf = text(q.uf, 2).toUpperCase(); const municipio = text(q.municipio, 80);
    if (!uf || !municipio) throw fail(400, 'Escolha a UF e o município.');
    const rua = [text(q.rua, 120), text(q.numero, 20)].filter(Boolean).join(', ');
    const linha = [rua, text(q.bairro, 80)].filter(Boolean).join(', ');
    if (linha && geocodeAddress) {
      try {
        const found = await geocodeAddress(linha, { city: { name: municipio, uf } });
        const hit = found.find((x) => Number.isFinite(Number(x.lat)));
        if (hit) return res.json({ lat: Number(hit.lat), lng: Number(hit.lng), precisao: 'endereco', nome: hit.name });
      } catch { /* cai no município */ }
    }
    try {
      const list = await geocode(municipio);
      const hit = list.find((x) => x.pais === 'Brasil' && x.estado === UF_NOME[uf]) || list.find((x) => x.pais === 'Brasil');
      if (hit) return res.json({ lat: Number(hit.lat), lng: Number(hit.lon), precisao: 'municipio', nome: `${municipio}/${uf}` });
    } catch { /* sem rede */ }
    throw fail(404, 'Não foi possível achar o ponto agora. Preencha a latitude e a longitude à mão.');
  }));

  app.get('/api/unidades/enderecos', needs('tvcorp.manage'), ah(async (req, res) => {
    const rows = await db.all('SELECT * FROM isp_unidade_endereco WHERE tenant_id = ?', [req.tenantId]);
    res.set('Cache-Control', 'no-store').json(Object.fromEntries(rows.map((r) => [r.office_id, {
      cep: r.cep, rua: r.rua, numero: r.numero, complemento: r.complemento, bairro: r.bairro, uf: r.uf, municipio: r.municipio,
      municipioIbge: r.municipio_ibge != null ? Number(r.municipio_ibge) : null, precisao: r.precisao,
    }])));
  }));

  app.put('/api/unidades/:id/endereco', needs('tvcorp.manage'), ah(async (req, res) => {
    const id = Number(req.params.id);
    const o = Number.isInteger(id) ? await db.get('SELECT id FROM telas_offices WHERE id = ? AND tenant_id = ?', [id, req.tenantId]) : null;
    if (!o) throw fail(404, 'Unidade inexistente.');
    const b = req.body || {};
    let p; try { p = cleanBrPlace({ uf: b.uf, city: b.municipio, cityIbge: b.municipioIbge ?? null }); } catch (e) { throw fail(400, e.message); }
    const cep = digits(b.cep);
    if (cep && cep.length !== 8) throw fail(400, 'CEP com 8 dígitos.');
    const v = [cep, text(b.rua, 120), text(b.numero, 20), text(b.complemento, 60), text(b.bairro, 80), p.uf || '', p.city || '', p.city_ibge, ['endereco', 'municipio', 'manual'].includes(b.precisao) ? b.precisao : null, Date.now()];
    const cur = await db.get('SELECT office_id FROM isp_unidade_endereco WHERE office_id = ?', [id]);
    if (cur) await db.run('UPDATE isp_unidade_endereco SET cep=?, rua=?, numero=?, complemento=?, bairro=?, uf=?, municipio=?, municipio_ibge=?, precisao=?, updated_at=? WHERE office_id = ?', [...v, id]);
    else await db.run('INSERT INTO isp_unidade_endereco(cep, rua, numero, complemento, bairro, uf, municipio, municipio_ibge, precisao, updated_at, office_id, tenant_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [...v, id, req.tenantId]);
    res.json({ ok: true });
  }));
}
