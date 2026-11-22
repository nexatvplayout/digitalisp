// Configuração guiada (primeiros passos), em ordem e com o obrigatório primeiro:
//   GET  /api/guia                 a revenda: os passos e o que já está feito (conta pelo que existe no banco)
//   GET  /api/minha-revenda        a revenda: os próprios dados cadastrais
//   PUT  /api/minha-revenda        a revenda: completa os dados (passo 1); o plano e a situação continuam da plataforma
//   GET  /api/platform/guia        a plataforma: planos com preço, primeira revenda, primeira cobrança
// Um passo só abre quando os obrigatórios anteriores estão feitos (a tela trava os seguintes; o servidor só informa).
import { db } from './db.js';
import * as T from './tenancy.js';
import { loadExtras, saveExtras } from './revendas.js';

const n = async (sql, args = []) => Number((await db.get(sql, args))?.n) || 0;
const j = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** O que falta nos dados da revenda para o passo 1 contar como feito. */
function faltaDados(t, x) {
  const a = j(t.address, {}) || {};
  const falta = [];
  if (!x.fantasia) falta.push('nome fantasia');
  if (!t.document || t.document_type !== 'cnpj') falta.push('CNPJ');
  if (!t.contact_name) falta.push('responsável');
  if (!t.contact_email) falta.push('e-mail');
  if (!t.phone && !x.whatsapp) falta.push('telefone ou WhatsApp');
  if (!x.municipio) falta.push('estado e município');
  if (!a.street || !a.number) falta.push('endereço (rua e número)');
  return falta;
}

export async function guiaRevenda(tenantId) {
  const t = await db.get('SELECT * FROM tenants WHERE id = ?', [tenantId]);
  const x = await loadExtras(tenantId);
  const s = await db.get('SELECT data FROM tvcorp_settings WHERE tenant_id = ?', [tenantId]);
  const logo = Boolean(j(s?.data, {}).logo?.file);
  const [clientes, chaves, telas, midias, itens, grades] = await Promise.all([
    n('SELECT COUNT(*) AS n FROM telas_offices WHERE tenant_id = ?', [tenantId]),
    n('SELECT COUNT(*) AS n FROM telas_keys WHERE tenant_id = ?', [tenantId]),
    n('SELECT COUNT(*) AS n FROM telas_devices WHERE tenant_id = ? AND revoked_at IS NULL', [tenantId]),
    n('SELECT COUNT(*) AS n FROM tvcorp_media WHERE tenant_id = ?', [tenantId]),
    n('SELECT COUNT(*) AS n FROM tvcorp_playlist_items WHERE tenant_id = ?', [tenantId]),
    n('SELECT COUNT(*) AS n FROM tvcorp_schedules WHERE tenant_id = ?', [tenantId]),
  ]);
  const falta = faltaDados(t, x);
  const steps = [
    { id: 'dados', titulo: 'Dados da revenda', obrigatorio: true, feito: !falta.length, falta,
      texto: 'Nome fantasia, CNPJ, responsável, contato e endereço. Aparecem nas faturas e no relatório para o anunciante.' },
    { id: 'logo', titulo: 'Logo da revenda', obrigatorio: true, feito: logo, ir: '#tvcorp/config',
      texto: 'A logo que aparece na abertura das telas, no cadastro da TV e na imagem sem internet. Envie em Configurações → Logomarca.' },
    { id: 'cliente', titulo: 'Primeiro cliente final', obrigatorio: true, feito: clientes > 0, conta: clientes, ir: '#tvcorp/unidades',
      texto: 'O cliente que vai ter as telas (loja, clínica, empresa). Em "Unidades e grupos", clique em "+ Nova unidade".' },
    { id: 'chave', titulo: 'Chave da primeira tela', obrigatorio: true, feito: chaves > 0 || telas > 0, ir: '#tvcorp/telas',
      texto: 'Em "Telas", clique em "+ TV box", escolha o cliente e gere a chave (vale 24 horas, uso único).' },
    { id: 'tela', titulo: 'Instalar o app e ativar a tela', obrigatorio: true, feito: telas > 0, conta: telas, ir: '#tvcorp/instalar',
      texto: 'Instale o app "Telas" na TV box ou na TV Samsung/LG, abra e digite a chave. A tela aparece aqui quando ativar.' },
    { id: 'midia', titulo: 'Primeira mídia', obrigatorio: true, feito: midias > 0, conta: midias, ir: '#tvcorp/midias',
      texto: 'Envie uma imagem ou um vídeo, ou crie a partir de um modelo, em "Mídias".' },
    { id: 'playlist', titulo: 'Playlist', obrigatorio: true, feito: itens > 0, ir: '#tvcorp/playlists',
      texto: 'Monte a sequência do que vai passar (a mídia, o tempo de cada uma) em "Playlists".' },
    { id: 'grade', titulo: 'Grade: o que passa em cada tela', obrigatorio: true, feito: grades > 0, ir: '#tvcorp/grade',
      texto: 'Diga em quais telas e em que horário a playlist passa, em "Grade". Depois disso a tela já mostra o conteúdo.' },
    { id: 'usuarios', titulo: 'Equipe e links de controle', obrigatorio: false, feito: false, ir: '#tvcorp/unidades',
      texto: 'Opcional: o link de controle de cada cliente final, para ele mandar avisos e campanhas sem entrar no painel.' },
  ];
  // em ordem: um passo abre quando todos os obrigatórios anteriores estão feitos
  let aberto = true;
  for (const st of steps) { st.liberado = aberto; if (st.obrigatorio && !st.feito) aberto = false; }
  const obrig = steps.filter((x) => x.obrigatorio);
  return { steps, feitos: obrig.filter((x) => x.feito).length, total: obrig.length, completo: obrig.every((x) => x.feito) };
}

export async function guiaPlataforma() {
  const [planos, revendas, faturas] = await Promise.all([
    n("SELECT COUNT(*) AS n FROM plans WHERE active = 1 AND price_cents > 0 AND code <> 'ilimitado'"),
    n('SELECT COUNT(*) AS n FROM tenants WHERE id <> ?', [T.DEFAULT_TENANT_ID]),
    n('SELECT COUNT(*) AS n FROM isp_faturas'),
  ]);
  const steps = [
    { id: 'senha', titulo: 'Trocar a senha inicial', obrigatorio: true, feito: true, ir: '#conta', texto: 'Feito no primeiro acesso.' },
    { id: 'planos', titulo: 'Preço e módulos dos planos', obrigatorio: true, feito: planos > 0, conta: planos, ir: '#planos',
      texto: 'Defina o preço, o limite de telas e os módulos de pelo menos um plano de revenda e marque "Ativo".' },
    { id: 'revenda', titulo: 'Primeira revenda', obrigatorio: true, feito: revendas > 0, conta: revendas, ir: '#revendas',
      texto: 'Cadastre o primeiro provedor: CNPJ, contato, endereço, plano e forma de cobrança. O e-mail vira o login dele.' },
    { id: 'cobranca', titulo: 'Primeira cobrança', obrigatorio: false, feito: faturas > 0, ir: '#cobrancas',
      texto: 'Gere as mensalidades do mês ou lance uma cobrança avulsa. Boleto e Pix automáticos entram com a empresa de cobrança.' },
    { id: 'mapa', titulo: 'Acompanhar no mapa', obrigatorio: false, feito: false, ir: '#mapa',
      texto: 'Todas as revendas, clientes finais e telas do Brasil, com a situação de cada tela.' },
  ];
  let aberto = true;
  for (const st of steps) { st.liberado = aberto; if (st.obrigatorio && !st.feito) aberto = false; }
  const obrig = steps.filter((x) => x.obrigatorio);
  return { steps, feitos: obrig.filter((x) => x.feito).length, total: obrig.length, completo: obrig.every((x) => x.feito) };
}

/** Os dados da própria revenda (o passo 1), no mesmo formato do superadmin. */
async function minhaRevenda(tenantId) {
  const t = await db.get('SELECT * FROM tenants WHERE id = ?', [tenantId]);
  return { ...T.tenantDto(t, null), ...(await loadExtras(tenantId)) };
}

export function mountGuia(app, { needs, signedIn, needsPlatform, ah }) {
  app.get('/api/guia', signedIn, ah(async (req, res) => {
    if (req.user.tenantId == null) return res.status(400).json({ error: 'Use /api/platform/guia.' });
    res.set('Cache-Control', 'no-store').json(await guiaRevenda(req.user.tenantId));
  }));
  app.get('/api/minha-revenda', signedIn, ah(async (req, res) => {
    if (req.user.tenantId == null) return res.status(400).json({ error: 'Só para revendas.' });
    res.set('Cache-Control', 'no-store').json(await minhaRevenda(req.user.tenantId));
  }));
  app.put('/api/minha-revenda', needs('users.manage'), ah(async (req, res) => {
    const tid = req.tenantId ?? req.user.tenantId;
    const b = req.body || {};
    const f = {};
    if (b.contactName !== undefined) f.contact_name = text(b.contactName, 80);
    if (b.contactEmail !== undefined) { const e = text(b.contactEmail, 120).toLowerCase(); if (e && !EMAIL.test(e)) throw T.fail(400, 'E-mail inválido.'); f.contact_email = e; }
    if (b.phone !== undefined) f.phone = T.cleanPhone(b.phone);
    if (b.address !== undefined) f.address = T.cleanAddress(b.address);
    if (b.document !== undefined) {
      const doc = T.cleanDocument(b.document);
      if (doc.document_type !== 'cnpj') throw T.fail(400, 'Informe o CNPJ da revenda.');
      Object.assign(f, doc);
    }
    if (Object.keys(f).length) await T.updateTenant(tid, f);
    await saveExtras(tid, { fantasia: b.fantasia, whatsapp: b.whatsapp, responsavel: b.contactName, site: b.site, uf: b.uf, municipio: b.municipio, municipioIbge: b.municipioIbge });
    T.invalidateTenants();
    res.locals.audit = 'completou os dados da revenda';
    res.json(await minhaRevenda(tid));
  }));
  app.get('/api/platform/guia', needsPlatform('platform.view'), ah(async (_req, res) => res.set('Cache-Control', 'no-store').json(await guiaPlataforma())));
}
