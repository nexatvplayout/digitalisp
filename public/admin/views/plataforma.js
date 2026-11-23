// Superadmin do DIGITAL ISP (/superadmin/): revendas com o cadastro completo, planos e módulos, cobranças e o mapa do Brasil.
// A equipe da plataforma vê tudo. Rotas: /api/platform/* (server/plataforma.js e server/revendas.js).
import { $, el, api, toast, guard } from '../lib.js';
import { ufCityPicker } from '../../shared/uf-city.js';
import * as CAT from '../../shared/funcionalidades.js';
import { createMap } from '../telas-mapa.js';
import { ligarCep } from '../cep.js';

const brl = (c) => (c == null ? '—' : (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const toCents = (v) => { const s = String(v ?? '').trim().replace(/\./g, '').replace(',', '.'); if (!s) return null; const n = Math.round(Number(s) * 100); return Number.isFinite(n) ? n : NaN; };
const centsToInput = (c) => (c == null ? '' : (Number(c) / 100).toFixed(2).replace('.', ','));
const STATUS = { trial: 'Em teste', active: 'Ativa', past_due: 'Em atraso', suspended: 'Suspensa', canceled: 'Cancelada' };
const kpi = (n, label) => el('div', { class: 'card kpi' }, el('b', { text: String(n) }), el('span', { class: 'dim', text: label }));
const field = (label, input, { full = false, hint = '' } = {}) => el('label', { class: `rv-f${full ? ' full' : ''}` }, el('span', { text: label }), input, hint ? el('small', { class: 'dim', text: hint }) : null);
const inp = (name, value = '', attrs = {}) => el('input', { name, value: value ?? '', ...attrs });
const fmtDoc = (d) => (d && d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d || '');
const fmtPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : p || ''; };

/* ================================================================== revendas */
export async function paintRevendas(root) {
  root.replaceChildren(el('p', { class: 'dim', text: 'Carregando…' }));
  const [ov, list, plans] = await Promise.all([api('/api/platform/overview'), api('/api/platform/tenants'), api('/api/platform/plans')]);
  const q = el('input', { type: 'search', placeholder: 'Buscar por nome, CNPJ, cidade ou e-mail', class: 'rv-search' });
  const tbody = el('tbody');
  const draw = () => {
    const s = q.value.trim().toLowerCase();
    const rows = list.filter((t) => !s || [t.name, t.fantasia, t.document, t.municipio, t.uf, t.contactEmail, t.slug].some((x) => String(x || '').toLowerCase().includes(s)));
    tbody.replaceChildren(...rows.map((t) => el('tr', { class: 'rv-row', tabindex: 0, onclick: () => openForm(t), onkeydown: (e) => { if (e.key === 'Enter') openForm(t); } },
      el('td', {}, el('b', { text: t.fantasia || t.name }), t.fantasia ? el('div', { class: 'dim small', text: t.name }) : null),
      el('td', { text: t.municipio ? `${t.municipio}/${t.uf}` : '—' }),
      el('td', { text: t.planName || '—' }),
      el('td', {}, el('span', { class: `rv-st ${t.status}`, text: STATUS[t.status] || t.status })),
      el('td', { class: 'num', text: String(t.uso?.unidades ?? 0) }),
      el('td', { class: 'num', text: String(t.uso?.telas ?? 0) }),
      el('td', { text: t.cobranca?.modo === 'sistema' ? 'Pelo sistema' : 'Por fora' }))));
    if (!rows.length) tbody.replaceChildren(el('tr', {}, el('td', { colspan: 7, class: 'dim', text: s ? 'Nada encontrado.' : 'Nenhuma revenda ainda.' })));
  };
  q.addEventListener('input', draw);
  const box = el('div', { id: 'rvForm' });
  function openForm(t = null) { box.replaceChildren(revendaForm(t, plans, async () => { await paintRevendas(root); })); box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  root.replaceChildren(
    el('div', { class: 'kpis' }, kpi(ov.revendas, 'revendas'), kpi(ov.unidades, 'clientes finais'), kpi(ov.telas, 'telas')),
    el('div', { class: 'card', style: 'margin-top:16px' },
      el('div', { class: 'rv-bar' }, q, el('button', { class: 'primary', type: 'button', text: '+ Nova revenda', onclick: () => openForm(null) })),
      el('div', { class: 'rv-scroll' }, el('table', { class: 'rv-table' },
        el('thead', {}, el('tr', {}, ...['Revenda', 'Cidade', 'Plano', 'Situação', 'Clientes finais', 'Telas', 'Cobrança'].map((h) => el('th', { text: h })))), tbody))),
    box);
  draw();
}

function revendaForm(t, plans, done) {
  const editing = Boolean(t);
  const a = t?.address || {};
  const active = plans.filter((p) => p.active || p.code === t?.planCode);
  const place = ufCityPicker({ uf: t?.uf || '', cityIbge: t?.municipioIbge ?? null, city: t?.municipio || '', idPrefix: 'rv' });
  const f = el('form', { class: 'card rv-form', novalidate: true });
  const sec = (title, ...kids) => el('fieldset', { class: 'rv-sec' }, el('legend', { text: title }), el('div', { class: 'rv-grid2' }, ...kids));
  f.append(
    el('div', { class: 'rv-form-head' }, el('h3', { text: editing ? `Revenda: ${t.fantasia || t.name}` : 'Nova revenda' }),
      el('button', { type: 'button', class: 'small', text: 'Fechar', onclick: () => f.remove() })),
    sec('Empresa',
      field('Razão social', inp('name', t?.name, { required: true, maxlength: 80 })),
      field('Nome fantasia', inp('fantasia', t?.fantasia, { maxlength: 80 })),
      field('CNPJ', inp('document', fmtDoc(t?.document), { required: true, inputmode: 'numeric', placeholder: '00.000.000/0000-00' })),
      field('Site', inp('site', t?.site, { placeholder: 'www.provedor.com.br' })),
      field('Identificador (endereço dos clientes)', inp('slug', t?.slug, { maxlength: 40, pattern: '[a-z0-9][a-z0-9-]{0,39}', placeholder: 'ex.: meuprovedor' }), { hint: `Os clientes desta revenda entram em ${location.origin}/c/<identificador>. Vazio = sai do nome.` })),
    sec('Contato',
      field('Responsável', inp('contactName', t?.contactName, { maxlength: 80 })),
      field('CPF do responsável', inp('respCpf', t?.respCpf, { inputmode: 'numeric' })),
      field('E-mail', inp('contactEmail', t?.contactEmail, { type: 'email', required: !editing }), { hint: editing ? '' : 'É também o login do administrador da revenda.' }),
      field('Telefone', inp('phone', fmtPhone(t?.phone), { inputmode: 'tel', placeholder: '(21) 3333-4444' })),
      field('WhatsApp', inp('whatsapp', fmtPhone(t?.whatsapp), { inputmode: 'tel', placeholder: '(21) 99999-8888' }))),
    sec('Endereço',
      field('CEP', inp('zip', a.zip, { inputmode: 'numeric', maxlength: 9 })),
      field('Rua', inp('street', a.street, { maxlength: 120 })),
      field('Número', inp('number', a.number, { maxlength: 20 })),
      field('Complemento', inp('complement', a.complement, { maxlength: 60 })),
      field('Bairro', inp('district', a.district, { maxlength: 80 })),
      place.ufField || place.ufF || el('span'), place.cityField || place.cityF || el('span')),
    sec('Plano e cobrança',
      field('Plano', el('select', { name: 'planCode' }, ...(active.length ? active : plans).map((p) => el('option', { value: p.code, text: `${p.name}${p.active ? '' : ' (inativo)'}`, selected: p.code === t?.planCode })))),
      field('Situação', el('select', { name: 'status' }, ...Object.entries(STATUS).map(([k, v]) => el('option', { value: k, text: v, selected: k === (t?.status || 'active') })))),
      field('Forma de cobrança', el('select', { name: 'modo' },
        el('option', { value: 'fora', text: 'Por fora (eu registro o pagamento)', selected: t?.cobranca?.modo !== 'sistema' }),
        el('option', { value: 'sistema', text: 'Pelo sistema (boleto e Pix)', selected: t?.cobranca?.modo === 'sistema' }))),
      field('Dia do vencimento', inp('dia', t?.cobranca?.diaVencimento ?? 10, { type: 'number', min: 1, max: 28 })),
      field('Valor mensal (R$)', inp('valor', centsToInput(t?.cobranca?.valorCents), { inputmode: 'decimal', placeholder: 'vazio = o preço do plano' }))),
    field('Observações', el('textarea', { name: 'notes', rows: 2, maxlength: 1000, text: t?.notes || '' }), { full: true }),
    el('div', { class: 'rv-actions' }, el('button', { class: 'primary', type: 'submit', text: editing ? 'Salvar' : 'Cadastrar revenda' }),
      editing ? el('button', { type: 'button', text: 'Nova senha de acesso', onclick: guard(async () => {
        if (!confirm('Gerar uma senha nova para o administrador desta revenda? A senha atual deixa de valer.')) return;
        const r = await api(`/api/platform/tenants/${t.id}/senha`, { method: 'POST', body: {} });
        f.querySelector('.rv-out').replaceChildren(el('div', { class: 'card' }, el('h3', { text: 'Nova senha da revenda' }),
          el('p', {}, 'Entrada: ', el('b', { text: `${location.origin}/admin/` }), ' com o e-mail ', el('b', { text: r.login }), '.'),
          el('p', { class: 'hint', text: 'Senha nova (mostrada só agora; a revenda troca no primeiro acesso):' }), el('p', { class: 'rv-secret', text: r.senha })));
      }) }) : null),
    el('div', { class: 'rv-out' }));
  ligarCep({ cep: f.elements.zip, rua: f.elements.street, bairro: f.elements.district, numero: f.elements.number, place });
  f.addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const p = place.value();
    const valor = toCents(v.valor);
    if (Number.isNaN(valor)) { toast('Valor mensal inválido.', true); return; }
    const body = {
      name: v.name, fantasia: v.fantasia, document: v.document, site: v.site, ...(v.slug ? { slug: v.slug.trim().toLowerCase() } : {}), contactName: v.contactName, respCpf: v.respCpf, responsavel: v.contactName,
      contactEmail: v.contactEmail, phone: v.phone, whatsapp: v.whatsapp,
      address: { zip: v.zip, street: v.street, number: v.number, complement: v.complement, district: v.district, city: p.city || '', state: p.uf || '' },
      uf: p.uf || '', municipio: p.city || '', municipioIbge: p.cityIbge,
      planCode: v.planCode, status: v.status, notes: v.notes,
      cobranca: { modo: v.modo, diaVencimento: Number(v.dia) || 10, valorCents: valor },
    };
    if (editing) {
      await api(`/api/platform/tenants/${t.id}`, { method: 'PATCH', body });
      toast('Revenda salva.');
      await done();
    } else {
      const r = await api('/api/platform/tenants', { method: 'POST', body: { ...body, adminUsername: v.contactEmail } });
      toast(`Revenda ${r.tenant.name} cadastrada.`);
      await done();
      if (r.admin.password) {
        $('#rvForm')?.replaceChildren(el('div', { class: 'card' }, el('h3', { text: 'Acesso da revenda' }),
          el('p', {}, 'Entrada: ', el('b', { text: `${location.origin}/admin/` }), ' com o e-mail ', el('b', { text: r.admin.username }), '.'),
          el('p', { class: 'hint', text: 'Senha inicial (mostrada só agora; a revenda troca no primeiro acesso):' }), el('p', { class: 'rv-secret', text: r.admin.password })));
      }
    }
  }));
  return f;
}

/* ================================================================== planos e módulos */
export async function paintPlanos(root) {
  root.replaceChildren(el('p', { class: 'dim', text: 'Carregando…' }));
  const plans = await api('/api/platform/plans');
  const LIMITS = [['telas', 'Telas'], ['clientes', 'Clientes finais'], ['users', 'Usuários'], ['storageMB', 'Armazenamento (MB)']];
  const card = (p) => {
    const fixed = p.code === 'ilimitado';
    const feats = { ...p.features };
    const mods = el('div', { class: 'pl-mods' }, ...CAT.SECTIONS.map((s) => el('div', { class: 'pl-sec' }, el('h4', { text: s.label }),
      ...s.menus.map((m) => el('label', { class: 'pl-mod', title: m.desc || '' },
        el('input', { type: 'checkbox', name: `m_${m.key}`, checked: m.core || Boolean(feats[m.key]), disabled: m.core || fixed }),
        el('span', {}, el('b', { text: m.label }), m.core ? el('em', { class: 'dim', text: ' sempre incluído' }) : null, el('small', { class: 'dim', text: m.desc || '' })))))));
    const f = el('form', { class: 'card pl-card' },
      el('div', { class: 'pl-head' },
        el('div', {}, el('h3', { text: p.name }), el('span', { class: 'dim mono small', text: p.code })),
        el('label', { class: 'pl-active' }, el('input', { type: 'checkbox', name: 'active', checked: p.active, disabled: fixed }), ' Ativo (pode ser vendido)')),
      el('div', { class: 'rv-grid2' },
        field('Nome', inp('name', p.name, { maxlength: 60 })),
        field('Preço mensal (R$)', inp('price', centsToInput(p.priceCents), { inputmode: 'decimal' })),
        field('Descrição', inp('description', p.description, { maxlength: 300 }), { full: true }),
        ...LIMITS.map(([k, label]) => field(label, inp(`l_${k}`, p.limits?.[k] ?? '', { type: 'number', min: 0, placeholder: 'ilimitado', disabled: fixed })))),
      el('h4', { class: 'pl-mtitle', text: 'Módulos liberados' }), mods,
      el('div', { class: 'rv-actions' }, el('span', { class: 'pl-dirty', text: 'Alterações não salvas', hidden: true }), el('button', { class: 'primary', type: 'submit', text: 'Salvar plano' })));
    // o que foi mexido e ainda não salvo fica marcado (e nada redesenha este cartão por cima do que está sendo digitado)
    const marcar = (sujo) => { f.classList.toggle('dirty', sujo); f.querySelector('.pl-dirty').hidden = !sujo; };
    f.addEventListener('input', (e) => { if (e.isTrusted) marcar(true); });
    f.addEventListener('change', (e) => { if (e.isTrusted) marcar(true); });
    f.addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      const price = toCents(v.price);
      if (Number.isNaN(price)) { toast('Preço inválido.', true); return; }
      const body = { name: v.name, description: v.description, priceCents: price ?? 0 };
      if (!fixed) {
        body.active = f.active.checked;
        body.limits = Object.fromEntries(LIMITS.map(([k]) => [k, v[`l_${k}`] === '' || v[`l_${k}`] == null ? null : Number(v[`l_${k}`])]));
        body.features = Object.fromEntries(CAT.FEATURE_KEYS.map((k) => [k, Boolean(f[`m_${k}`]?.checked)]));
        body.profileId = null; // os módulos ficam no próprio plano
      }
      await api(`/api/platform/plans/${p.id}`, { method: 'PATCH', body });
      marcar(false);
      toast(`Plano ${v.name} salvo.`);
    }));
    return f;
  };
  const novo = el('form', { class: 'card rv-form' }, el('h3', { text: 'Novo plano' }),
    el('div', { class: 'rv-grid2' }, field('Nome', inp('name', '', { required: true, maxlength: 60 })), field('Código', inp('code', '', { required: true, pattern: '[a-z0-9][a-z0-9_-]{1,39}', placeholder: 'ex.: revenda-500' }))),
    el('div', { class: 'rv-actions' }, el('button', { class: 'primary', type: 'submit', text: 'Criar plano' })));
  novo.addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(novo));
    const novoPlano = await api('/api/platform/plans', { method: 'POST', body: { code: v.code.trim().toLowerCase(), name: v.name, priceCents: 0, active: false } });
    // só acrescenta o cartão do plano novo: os outros cartões (e o que estiver digitado neles) ficam como estão
    const c = card(novoPlano);
    novo.before(c);
    novo.reset();
    c.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('Plano criado: ajuste o preço, os limites e os módulos e salve.');
  }));
  root.replaceChildren(
    el('p', { class: 'hint', text: 'Os planos são das revendas. O principal é o número de telas. Plano inativo não aparece para novas revendas.' }),
    ...plans.map(card), novo);
}

/* ================================================================== cobranças */
export async function paintCobrancas(root) {
  root.replaceChildren(el('p', { class: 'dim', text: 'Carregando…' }));
  const st = root.dataset.status || '';
  const [data, revendas] = await Promise.all([api(`/api/platform/faturas${st ? `?status=${st}` : ''}`), api('/api/platform/tenants')]);
  const FST = { aberta: 'Aberta', paga: 'Paga', cancelada: 'Cancelada' };
  const filtro = el('select', { onchange: (e) => { root.dataset.status = e.target.value; paintCobrancas(root); } },
    ...[['', 'Todas'], ['aberta', 'Abertas'], ['paga', 'Pagas'], ['cancelada', 'Canceladas']].map(([k, v]) => el('option', { value: k, text: v, selected: k === st })));
  const mes = new Date(); const ref = `${mes.getFullYear()}-${String(mes.getMonth() + 1).padStart(2, '0')}`;
  const gerar = el('form', { class: 'rv-bar' },
    el('label', {}, 'Mês ', el('input', { type: 'month', name: 'ref', value: ref })),
    el('button', { type: 'submit', class: 'primary', text: 'Gerar mensalidades do mês' }));
  gerar.addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    const r = await api('/api/platform/faturas/gerar-mes', { method: 'POST', body: { referencia: gerar.ref.value } });
    toast(`${r.criadas.length} mensalidade(s) criada(s)${r.puladas.length ? `; ${r.puladas.length} revenda(s) pulada(s) (já tinha ou sem valor)` : ''}.`);
    await paintCobrancas(root);
  }));
  const avulsa = el('form', { class: 'card rv-form' }, el('h3', { text: 'Lançar cobrança' }),
    el('div', { class: 'rv-grid2' },
      field('Revenda', el('select', { name: 'tenantId', required: true }, ...revendas.map((t) => el('option', { value: t.id, text: t.fantasia || t.name })))),
      field('Descrição', inp('descricao', '', { placeholder: 'ex.: Instalação de 10 telas' })),
      field('Valor (R$)', inp('valor', '', { required: true, inputmode: 'decimal' })),
      field('Vencimento', inp('vencimento', '', { type: 'date', required: true }))),
    el('div', { class: 'rv-actions' }, el('button', { class: 'primary', type: 'submit', text: 'Lançar' })));
  avulsa.addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(avulsa));
    const valor = toCents(v.valor);
    if (!valor || Number.isNaN(valor)) { toast('Valor inválido.', true); return; }
    await api('/api/platform/faturas', { method: 'POST', body: { tenantId: Number(v.tenantId), descricao: v.descricao, valorCents: valor, vencimento: v.vencimento } });
    toast('Cobrança lançada.');
    await paintCobrancas(root);
  }));
  const pagar = (f) => guard(async () => {
    const forma = prompt(`Forma do pagamento de ${brl(f.valorCents)} (${f.revenda}):`, 'Pix');
    if (forma == null) return;
    await api(`/api/platform/faturas/${f.id}/pagar`, { method: 'POST', body: { forma } });
    toast('Pagamento registrado.');
    await paintCobrancas(root);
  });
  const cancelar = (f) => guard(async () => {
    if (!confirm(`Cancelar a fatura de ${brl(f.valorCents)} de ${f.revenda}?`)) return;
    await api(`/api/platform/faturas/${f.id}/cancelar`, { method: 'POST', body: {} });
    toast('Fatura cancelada.');
    await paintCobrancas(root);
  });
  const rows = data.faturas.map((f) => el('tr', {},
    el('td', { text: f.revenda || `#${f.tenantId}` }), el('td', { text: f.descricao }), el('td', { class: 'num', text: brl(f.valorCents) }),
    el('td', { text: f.vencimento.split('-').reverse().join('/') }),
    el('td', {}, el('span', { class: `rv-st ${f.vencida ? 'past_due' : f.status === 'paga' ? 'active' : f.status === 'cancelada' ? 'canceled' : 'trial'}`, text: f.vencida ? 'Vencida' : FST[f.status] })),
    el('td', { text: f.pagoEm ? `${new Date(f.pagoEm).toLocaleDateString('pt-BR')} · ${f.pagoForma || ''}` : '' }),
    el('td', {}, f.status === 'aberta' ? el('span', { class: 'rv-btns' }, el('button', { type: 'button', class: 'small', text: 'Registrar pagamento', onclick: pagar(f) }), el('button', { type: 'button', class: 'small', text: 'Cancelar', onclick: cancelar(f) })) : null)));
  root.replaceChildren(
    el('div', { class: 'kpis' }, kpi(brl(data.totais.abertoCents), 'em aberto'), kpi(brl(data.totais.vencidoCents), 'vencido'), kpi(brl(data.totais.pagoCents), 'recebido (na lista)')),
    el('p', { class: 'hint', text: 'Boleto e Pix automáticos entram quando a empresa de cobrança for escolhida. Até lá, as faturas são lançadas aqui e o pagamento recebido por fora é registrado à mão.' }),
    el('div', { class: 'card' }, gerar),
    el('div', { class: 'card', style: 'margin-top:16px' }, el('div', { class: 'rv-bar' }, el('h3', { text: 'Faturas' }), filtro),
      el('div', { class: 'rv-scroll' }, el('table', { class: 'rv-table' },
        el('thead', {}, el('tr', {}, ...['Revenda', 'Descrição', 'Valor', 'Vencimento', 'Situação', 'Pago em', ''].map((h) => el('th', { text: h })))),
        el('tbody', {}, ...(rows.length ? rows : [el('tr', {}, el('td', { colspan: 7, class: 'dim', text: 'Nenhuma fatura.' }))]))))),
    avulsa);
}

/* ================================================================== mapa do Brasil */
let map = null;
export async function paintMapa(root) {
  root.replaceChildren(el('p', { class: 'dim', text: 'Carregando…' }));
  const d = await api('/api/platform/mapa');
  const rev = new Map(d.revendas.map((r) => [r.id, r]));
  const filtroRev = el('select', {}, el('option', { value: '', text: 'Todas as revendas' }), ...d.revendas.map((r) => el('option', { value: r.id, text: r.fantasia || r.name })));
  const filtroSt = el('select', {}, ...[['', 'Todas as telas'], ['no-ar', 'No ar'], ['fora', 'Fora do ar'], ['nunca', 'Nunca conectou']].map(([k, v]) => el('option', { value: k, text: v })));
  const mostrar = el('select', {}, ...[['telas', 'Telas'], ['clientes', 'Clientes finais'], ['revendas', 'Revendas']].map(([k, v]) => el('option', { value: k, text: v })));
  const box = el('div', { class: 'pf-mapbox mp-map' });
  const side = el('div', { class: 'pf-side-card mp-side' }, el('p', { class: 'dim', text: 'Clique num ponto para ver os detalhes.' }));
  const cont = (st) => d.telas.filter((t) => t.status === st).length;
  const semPonto = el('p', { class: 'dim small' });
  root.replaceChildren(
    el('div', { class: 'kpis' }, kpi(d.revendas.length, 'revendas'), kpi(d.clientes.length, 'clientes finais'), kpi(cont('no-ar'), 'telas no ar'), kpi(cont('fora'), 'telas fora do ar'), kpi(cont('nunca'), 'nunca conectaram')),
    el('div', { class: 'rv-bar', style: 'margin-top:16px' }, mostrar, filtroRev, filtroSt),
    el('div', { class: 'pf-mapwrap', style: 'margin-top:12px' }, box, el('div', {}, side, semPonto)));
  map?.destroy?.();
  map = createMap(box, { onPin: (id) => detalhe(id) });
  const CLS = { 'no-ar': 'on', fora: 'off', nunca: 'never' };
  let atual = [];
  function pins() {
    const r = Number(filtroRev.value) || null; const st = filtroSt.value; const what = mostrar.value;
    filtroSt.disabled = what !== 'telas';
    let items = [];
    if (what === 'telas') items = d.telas.filter((t) => (!r || t.tenantId === r) && (!st || t.status === st)).map((t) => ({ id: `t${t.id}`, lat: t.lat, lng: t.lng, status: CLS[t.status], title: `${t.name} · ${t.cliente || ''}`, ref: t, kind: 'tela' }));
    if (what === 'clientes') items = d.clientes.filter((c) => !r || c.tenantId === r).map((c) => ({ id: `c${c.id}`, lat: c.lat, lng: c.lng, status: 'none', title: c.name, ref: c, kind: 'cliente' }));
    if (what === 'revendas') items = d.revendas.filter((x) => !r || x.id === r).map((x) => ({ id: `r${x.id}`, lat: x.lat, lng: x.lng, status: x.status === 'active' ? 'on' : 'warn', title: x.fantasia || x.name, ref: x, kind: 'revenda' }));
    const com = items.filter((p) => p.lat != null && p.lng != null);
    atual = com;
    map.setPins(com.map(({ id, lat, lng, status, title }) => ({ id, lat, lng, status, title })));
    semPonto.textContent = items.length > com.length ? `${items.length - com.length} sem localização (sem endereço ou ponto no cadastro).` : '';
    if (com.length) map.fit(com); else map.setView(-14.2, -51.9, 4);
  }
  function detalhe(id) {
    const p = atual.find((x) => x.id === id);
    if (!p) return;
    const x = p.ref;
    const revenda = rev.get(p.kind === 'revenda' ? x.id : x.tenantId);
    const linha = (k, v) => (v ? el('div', {}, el('span', { class: 'dim', text: `${k}: ` }), el('span', { text: v })) : null);
    side.replaceChildren(
      el('b', { text: p.kind === 'tela' ? x.name : p.kind === 'cliente' ? x.name : x.fantasia || x.name }),
      linha('Tipo', { tela: 'Tela', cliente: 'Cliente final', revenda: 'Revenda' }[p.kind]),
      p.kind !== 'revenda' ? linha('Revenda', revenda ? revenda.fantasia || revenda.name : '') : linha('Cidade', x.municipio ? `${x.municipio}/${x.uf}` : ''),
      p.kind === 'tela' ? linha('Cliente final', x.cliente) : null,
      p.kind === 'tela' ? linha('Situação', { 'no-ar': 'No ar', fora: 'Fora do ar', nunca: 'Nunca conectou' }[x.status]) : null,
      p.kind === 'tela' && x.lastSeen ? linha('Último sinal', new Date(x.lastSeen).toLocaleString('pt-BR')) : null,
      p.kind === 'revenda' ? linha('Situação', STATUS[x.status] || x.status) : null,
      p.kind === 'revenda' ? linha('Telas', String(d.telas.filter((t) => t.tenantId === x.id).length)) : null);
  }
  for (const s of [filtroRev, filtroSt, mostrar]) s.addEventListener('change', pins);
  pins();
}
export const leaveMapa = () => { map?.destroy?.(); map = null; };
