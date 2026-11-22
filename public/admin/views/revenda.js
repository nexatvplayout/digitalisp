// Painel da REVENDA (o provedor): a gestão do negócio dela. Resumo, clientes finais (cada um com o painel próprio e o
// link de entrada), os planos que ela vende, as cobranças dos clientes, todas as telas e o mapa.
// Rotas /api/revenda/* (server/revenda.js). O conteúdo das telas é do cliente: a revenda abre o painel dele quando ajuda.
import { $, el, api, toast, guard, state, store } from '../lib.js';
import { ufCityPicker } from '../../shared/uf-city.js';
import { createMap } from '../telas-mapa.js';
import { ligarCep } from '../cep.js';

const brl = (c) => (c == null ? '—' : (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const toCents = (v) => { const s = String(v ?? '').trim().replace(/\./g, '').replace(',', '.'); if (!s) return null; const n = Math.round(Number(s) * 100); return Number.isFinite(n) ? n : NaN; };
const centsIn = (c) => (c == null ? '' : (Number(c) / 100).toFixed(2).replace('.', ','));
const kpi = (n, label, cls = '') => el('div', { class: `card kpi ${cls}` }, el('b', { text: String(n) }), el('span', { class: 'dim', text: label }));
const field = (label, input, { full = false, hint = '' } = {}) => el('label', { class: `rv-f${full ? ' full' : ''}` }, el('span', { text: label }), input, hint ? el('small', { class: 'dim', text: hint }) : null);
const inp = (name, value = '', attrs = {}) => el('input', { name, value: value ?? '', ...attrs });
const fmtDoc = (d) => (!d ? '' : d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d);
const fmtPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : p || ''; };
const ST = { active: 'Ativo', suspended: 'Suspenso', canceled: 'Cancelado', trial: 'Em teste', past_due: 'Em atraso' };
const SIT = { 'no-ar': 'No ar', fora: 'Fora do ar', nunca: 'Nunca conectou' };
const loading = (root) => root.replaceChildren(el('p', { class: 'dim', text: 'Carregando…' }));

/** Mostra uma senha/link uma única vez, com o botão de copiar. */
function mostrarAcesso(box, titulo, a) {
  const copiar = (t) => () => navigator.clipboard?.writeText(t).then(() => toast('Copiado.'), () => {});
  box.replaceChildren(el('div', { class: 'card rv-acesso' }, el('h3', { text: titulo }),
    el('p', {}, 'Endereço de entrada: ', el('b', { text: a.link || `${location.origin}/admin/` }), ' ', el('button', { type: 'button', class: 'small', text: 'Copiar', onclick: copiar(a.link || `${location.origin}/admin/`) })),
    el('p', {}, 'Login: ', el('b', { text: a.login })),
    a.senha ? el('p', {}, 'Senha inicial: ', el('b', { class: 'rv-secret', text: a.senha }), ' ', el('button', { type: 'button', class: 'small', text: 'Copiar', onclick: copiar(a.senha) })) : null,
    a.senha ? el('p', { class: 'hint', text: 'A senha aparece só agora. O cliente troca no primeiro acesso.' }) : null));
}

/* ================================================================== resumo */
export async function paintResumo(root) {
  loading(root);
  const [r, conta] = await Promise.all([api('/api/revenda/resumo'), api('/api/conta')]);
  const u = r.uso;
  const livre = u.limite == null ? 'sem limite' : `${Math.max(0, u.limite - u.telas - u.chaves)} livres de ${u.limite}`;
  root.replaceChildren(
    el('div', { class: 'kpis' },
      kpi(r.clientes, 'clientes finais'), kpi(r.telas.total, 'telas'), kpi(r.telas['no-ar'], 'no ar', 'ok'), kpi(r.telas.fora, 'fora do ar', r.telas.fora ? 'warn' : ''),
      kpi(brl(r.receitaMensalCents), 'receita mensal (clientes ativos)'), kpi(r.vencidas.n, `cobranças vencidas · ${brl(r.vencidas.valorCents)}`, r.vencidas.n ? 'warn' : '')),
    el('div', { class: 'card', style: 'margin-top:16px' },
      el('h3', { text: 'Seu plano com a DIGITAL ISP' }),
      el('p', {}, el('b', { text: u.plano?.name || '—' }), ` · telas: ${u.telas} em uso${u.chaves ? ` + ${u.chaves} chave(s) esperando` : ''} (${livre})`),
      el('p', { class: 'dim', text: `Telas vendidas nos planos dos clientes: ${u.vendidas}. Clientes: ${u.clientes}${u.limiteClientes != null ? ` de ${u.limiteClientes}` : ''}.` }),
      conta.link ? el('p', {}, 'Endereço de entrada dos seus clientes: ', el('b', { text: conta.link })) : null));
}

/* ================================================================== clientes */
export async function paintClientes(root) {
  loading(root);
  const [lista, pl] = await Promise.all([api('/api/revenda/clientes'), api('/api/revenda/planos')]);
  const planos = pl.planos;
  const q = el('input', { type: 'search', placeholder: 'Buscar por nome, documento ou cidade', class: 'rv-search' });
  const tbody = el('tbody');
  const box = el('div', { id: 'rcForm' });
  const abrir = (c) => { box.replaceChildren(clienteForm(c, planos, () => paintClientes(root), box)); box.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const draw = () => {
    const s = q.value.trim().toLowerCase();
    const rows = lista.filter((c) => !s || [c.name, c.fantasia, c.document, c.municipio, c.contactEmail].some((x) => String(x || '').toLowerCase().includes(s)));
    tbody.replaceChildren(...(rows.length ? rows.map((c) => el('tr', { class: 'rv-row', tabindex: 0, onclick: () => abrir(c), onkeydown: (e) => { if (e.key === 'Enter') abrir(c); } },
      el('td', {}, el('b', { text: c.fantasia || c.name }), c.fantasia ? el('div', { class: 'dim small', text: c.name }) : null),
      el('td', { text: c.municipio ? `${c.municipio}/${c.uf}` : '—' }),
      el('td', { text: c.plano?.nome || 'sem plano' }),
      el('td', {}, el('span', { class: `rv-st ${c.status}`, text: ST[c.status] || c.status })),
      el('td', { class: 'num', text: `${c.uso?.noAr ?? 0}/${c.uso?.telas ?? 0}` }),
      el('td', { text: c.cobranca?.modo === 'sistema' ? 'Pelo sistema' : 'Por fora' }))) : [el('tr', {}, el('td', { colspan: 6, class: 'dim', text: s ? 'Nada encontrado.' : 'Nenhum cliente ainda. Cadastre o primeiro.' }))]));
  };
  q.addEventListener('input', draw);
  root.replaceChildren(
    !planos.some((p) => p.ativo) ? el('p', { class: 'gd-falta', text: 'Crie pelo menos um plano em "Planos" antes de cadastrar clientes.' }) : null,
    el('div', { class: 'card' },
      el('div', { class: 'rv-bar' }, q, el('button', { class: 'primary', type: 'button', text: '+ Novo cliente', onclick: () => abrir(null) })),
      el('div', { class: 'rv-scroll' }, el('table', { class: 'rv-table' },
        el('thead', {}, el('tr', {}, ...['Cliente', 'Cidade', 'Plano', 'Situação', 'Telas no ar', 'Cobrança'].map((h) => el('th', { text: h })))), tbody))),
    box);
  draw();
}

function clienteForm(c, planos, done, box) {
  const editando = Boolean(c);
  const a = c?.address || {};
  const place = ufCityPicker({ uf: c?.uf || '', cityIbge: c?.municipioIbge ?? null, city: c?.municipio || '', idPrefix: 'rc' });
  const f = el('form', { class: 'card rv-form', novalidate: true });
  const sec = (t, ...k) => el('fieldset', { class: 'rv-sec' }, el('legend', { text: t }), el('div', { class: 'rv-grid2' }, ...k));
  const pessoa = el('select', { name: 'pessoa' }, el('option', { value: 'pj', text: 'Pessoa jurídica (CNPJ)', selected: c?.pessoa !== 'pf' }), el('option', { value: 'pf', text: 'Pessoa física (CPF)', selected: c?.pessoa === 'pf' }));
  f.append(
    el('div', { class: 'rv-form-head' }, el('h3', { text: editando ? `Cliente: ${c.fantasia || c.name}` : 'Novo cliente final' }),
      el('div', { class: 'rv-btns' },
        editando ? el('button', { type: 'button', class: 'small primary', text: 'Abrir o painel do cliente', onclick: guard(async () => {
          const r = await api(`/api/revenda/clientes/${c.id}/entrar`, { method: 'POST' });
          // o painel do cliente abre noutra aba, com a sessão de 1 h (a revenda segue logada aqui)
          localStorage.setItem('disp.token.entrar', r.token); // entregue uma vez à aba nova, que guarda só nela
          window.open(`${location.origin}/admin/#entrar`, '_blank', 'noopener');
        }) }) : null,
        editando ? el('button', { type: 'button', class: 'small', text: 'Nova senha', onclick: guard(async () => {
          if (!confirm('Gerar uma senha nova para o cliente? A senha atual deixa de valer.')) return;
          const r = await api(`/api/revenda/clientes/${c.id}/senha`, { method: 'POST' });
          const d = await api(`/api/revenda/clientes/${c.id}`);
          mostrarAcesso(box, 'Nova senha do cliente', { link: d.acesso.link, login: r.login, senha: r.senha });
        }) }) : null,
        el('button', { type: 'button', class: 'small', text: 'Fechar', onclick: () => f.remove() }))),
    sec('Cliente',
      field('Tipo', pessoa),
      field('Nome / razão social', inp('name', c?.name, { required: true, maxlength: 80 })),
      field('Nome fantasia', inp('fantasia', c?.fantasia, { maxlength: 80 })),
      field('CPF ou CNPJ', inp('document', fmtDoc(c?.document), { inputmode: 'numeric' }))),
    sec('Contato',
      field('Responsável', inp('contactName', c?.contactName, { maxlength: 80 })),
      field('E-mail (é o login dele)', inp('contactEmail', c?.contactEmail, { type: 'email', required: true, disabled: editando })),
      field('Telefone', inp('phone', fmtPhone(c?.phone), { inputmode: 'tel' })),
      field('WhatsApp', inp('whatsapp', fmtPhone(c?.whatsapp), { inputmode: 'tel' }))),
    sec('Endereço',
      field('CEP', inp('zip', a.zip, { maxlength: 9 })), field('Rua', inp('street', a.street, { maxlength: 120 })), field('Número', inp('number', a.number, { maxlength: 20 })),
      field('Complemento', inp('complement', a.complement, { maxlength: 60 })), field('Bairro', inp('district', a.district, { maxlength: 80 })), place.ufField, place.cityField),
    sec('Plano e cobrança',
      field('Plano', el('select', { name: 'planoId' }, el('option', { value: '', text: 'Escolha o plano' }), ...planos.filter((p) => p.ativo || p.id === c?.planoId).map((p) => el('option', { value: p.id, text: `${p.nome} · ${p.telas ?? '∞'} tela(s) · ${brl(p.precoCents)}`, selected: p.id === c?.planoId })))),
      field('Situação', el('select', { name: 'status' }, ...['active', 'suspended', 'canceled'].map((k) => el('option', { value: k, text: ST[k], selected: k === (c?.status || 'active') })))),
      field('Forma de cobrança', el('select', { name: 'modo' },
        el('option', { value: 'fora', text: 'Por fora (eu registro o pagamento)', selected: c?.cobranca?.modo !== 'sistema' }),
        el('option', { value: 'sistema', text: 'Pelo sistema (boleto e Pix)', selected: c?.cobranca?.modo === 'sistema' }))),
      field('Dia do vencimento', inp('dia', c?.cobranca?.diaVencimento ?? 10, { type: 'number', min: 1, max: 28 })),
      field('Valor mensal (R$)', inp('valor', centsIn(c?.cobranca?.valorCents), { inputmode: 'decimal', placeholder: 'vazio = o preço do plano' }))),
    field('Observações', el('textarea', { name: 'notes', rows: 2, maxlength: 1000, text: c?.notes || '' }), { full: true }),
    el('div', { class: 'rv-actions' }, el('button', { class: 'primary', type: 'submit', text: editando ? 'Salvar' : 'Cadastrar cliente' })));
  ligarCep({ cep: f.elements.zip, rua: f.elements.street, bairro: f.elements.district, numero: f.elements.number, place });
  f.addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const p = place.value();
    const valor = toCents(v.valor);
    if (Number.isNaN(valor)) { toast('Valor mensal inválido.', true); return; }
    if (!v.planoId) { toast('Escolha o plano do cliente.', true); return; }
    const body = {
      pessoa: v.pessoa, name: v.name, fantasia: v.fantasia, document: v.document, contactName: v.contactName, phone: v.phone, whatsapp: v.whatsapp,
      address: { zip: v.zip, street: v.street, number: v.number, complement: v.complement, district: v.district, city: p.city || '', state: p.uf || '' },
      uf: p.uf || '', municipio: p.city || '', municipioIbge: p.cityIbge, planoId: Number(v.planoId), status: v.status, notes: v.notes,
      cobranca: { modo: v.modo, diaVencimento: Number(v.dia) || 10, valorCents: valor },
    };
    if (editando) {
      await api(`/api/revenda/clientes/${c.id}`, { method: 'PATCH', body });
      toast('Cliente salvo.'); await done();
    } else {
      const r = await api('/api/revenda/clientes', { method: 'POST', body: { ...body, contactEmail: v.contactEmail } });
      toast(`Cliente ${r.cliente.name} cadastrado.`);
      await done();
      mostrarAcesso($('#rcForm'), 'Acesso do cliente (envie para ele)', r.acesso);
    }
  }));
  return f;
}

/* ================================================================== planos da revenda */
export async function paintPlanos(root) {
  loading(root);
  const r = await api('/api/revenda/planos');
  const card = (p) => {
    const f = el('form', { class: 'card pl-card' });
    const mods = el('div', { class: 'pl-mods' }, ...r.disponiveis.map((s) => el('div', { class: 'pl-sec' }, el('h4', { text: s.secao }),
      ...s.modulos.map((m) => el('label', { class: 'pl-mod', title: m.liberado ? m.desc : 'Fora do seu plano com a DIGITAL ISP' },
        el('input', { type: 'checkbox', name: `m_${m.key}`, checked: m.core || Boolean(p?.modulos?.[m.key]), disabled: m.core || !m.liberado }),
        el('span', {}, el('b', { text: m.label }), m.core ? el('em', { class: 'dim', text: ' sempre incluído' }) : !m.liberado ? el('em', { class: 'dim', text: ' fora do seu plano' }) : null))))));
    f.append(
      el('div', { class: 'pl-head' }, el('h3', { text: p ? p.nome : 'Novo plano' }),
        p ? el('span', { class: 'dim', text: `${p.clientes} cliente(s)` }) : null,
        el('label', { class: 'pl-active' }, el('input', { type: 'checkbox', name: 'ativo', checked: p ? p.ativo : true }), ' Ativo')),
      el('div', { class: 'rv-grid2' },
        field('Nome', inp('nome', p?.nome, { required: true, maxlength: 60 })),
        field('Preço mensal (R$)', inp('preco', centsIn(p?.precoCents), { inputmode: 'decimal' })),
        field('Telas', inp('telas', p?.telas ?? '', { type: 'number', min: 0, placeholder: 'ilimitado' })),
        field('Usuários', inp('usuarios', p?.usuarios ?? '', { type: 'number', min: 0, placeholder: 'ilimitado' })),
        field('Descrição', inp('descricao', p?.descricao, { maxlength: 300 }), { full: true })),
      el('h4', { class: 'pl-mtitle', text: 'Módulos' }), mods,
      el('div', { class: 'rv-actions' }, el('span', { class: 'pl-dirty', text: 'Alterações não salvas', hidden: true }),
        p && !p.clientes ? el('button', { type: 'button', class: 'small', text: 'Apagar', onclick: guard(async () => { if (!confirm(`Apagar o plano ${p.nome}?`)) return; await api(`/api/revenda/planos/${p.id}`, { method: 'DELETE' }); await paintPlanos(root); }) }) : null,
        el('button', { class: 'primary', type: 'submit', text: p ? 'Salvar plano' : 'Criar plano' })));
    const marcar = (x) => { f.classList.toggle('dirty', x); f.querySelector('.pl-dirty').hidden = !x; };
    // só o que a pessoa faz marca (isTrusted): mudança feita pelo próprio painel não conta
    f.addEventListener('input', (e) => { if (e.isTrusted) marcar(true); }); f.addEventListener('change', (e) => { if (e.isTrusted) marcar(true); });
    f.addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      const preco = toCents(v.preco); if (Number.isNaN(preco)) { toast('Preço inválido.', true); return; }
      const modulos = {}; for (const s of r.disponiveis) for (const m of s.modulos) if (!m.core) modulos[m.key] = Boolean(f.elements[`m_${m.key}`]?.checked);
      const body = { nome: v.nome, descricao: v.descricao, precoCents: preco ?? 0, telas: v.telas, usuarios: v.usuarios, modulos, ativo: f.elements.ativo.checked };
      if (p) { await api(`/api/revenda/planos/${p.id}`, { method: 'PATCH', body }); marcar(false); toast('Plano salvo.'); }
      else { const novo = await api('/api/revenda/planos', { method: 'POST', body }); toast('Plano criado.'); f.replaceWith(card({ ...novo, clientes: 0 })); root.append(card(null)); }
    }));
    return f;
  };
  const u = r.uso;
  root.replaceChildren(
    el('p', { class: 'hint', text: `Os planos que você vende aos seus clientes. Seu plano com a DIGITAL ISP: ${u.plano?.name || '—'} · ${u.limite == null ? 'telas sem limite' : `${u.limite} telas`} (${u.telas} em uso, ${u.vendidas} vendidas nos planos).` }),
    ...r.planos.map(card), card(null));
}

/* ================================================================== cobranças dos clientes */
export async function paintCobrancas(root) {
  loading(root);
  const st = root.dataset.status || '';
  const [d, clientes] = await Promise.all([api(`/api/revenda/faturas${st ? `?status=${st}` : ''}`), api('/api/revenda/clientes')]);
  const FST = { aberta: 'Aberta', paga: 'Paga', cancelada: 'Cancelada' };
  const hoje = new Date(); const ref = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const gerar = el('form', { class: 'rv-bar' }, el('label', {}, 'Mês ', el('input', { type: 'month', name: 'ref', value: ref })), el('button', { type: 'submit', class: 'primary', text: 'Gerar as mensalidades do mês' }));
  gerar.addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    const r = await api('/api/revenda/faturas/gerar-mes', { method: 'POST', body: { referencia: gerar.ref.value } });
    toast(`${r.criadas.length} mensalidade(s) criada(s)${r.puladas.length ? `; ${r.puladas.length} pulada(s) (já tinha ou sem valor)` : ''}.`);
    await paintCobrancas(root);
  }));
  const filtro = el('select', { onchange: (e) => { root.dataset.status = e.target.value; paintCobrancas(root); } }, ...[['', 'Todas'], ['aberta', 'Abertas'], ['paga', 'Pagas'], ['cancelada', 'Canceladas']].map(([k, v]) => el('option', { value: k, text: v, selected: k === st })));
  const avulsa = el('form', { class: 'card rv-form' }, el('h3', { text: 'Lançar cobrança' }),
    el('div', { class: 'rv-grid2' },
      field('Cliente', el('select', { name: 'clienteId' }, ...clientes.map((c) => el('option', { value: c.id, text: c.fantasia || c.name })))),
      field('Descrição', inp('descricao', '', { placeholder: 'ex.: Instalação' })), field('Valor (R$)', inp('valor', '', { inputmode: 'decimal', required: true })), field('Vencimento', inp('vencimento', '', { type: 'date', required: true }))),
    el('div', { class: 'rv-actions' }, el('button', { class: 'primary', type: 'submit', text: 'Lançar' })));
  avulsa.addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(avulsa)); const valor = toCents(v.valor);
    if (!valor || Number.isNaN(valor)) { toast('Valor inválido.', true); return; }
    await api('/api/revenda/faturas', { method: 'POST', body: { clienteId: Number(v.clienteId), descricao: v.descricao, valorCents: valor, vencimento: v.vencimento } });
    toast('Cobrança lançada.'); await paintCobrancas(root);
  }));
  const acao = (f, o) => guard(async () => {
    if (o === 'pagar') { const forma = prompt(`Forma do pagamento de ${brl(f.valorCents)} (${f.cliente}):`, 'Pix'); if (forma == null) return; await api(`/api/revenda/faturas/${f.id}/pagar`, { method: 'POST', body: { forma } }); }
    else { if (!confirm('Cancelar esta cobrança?')) return; await api(`/api/revenda/faturas/${f.id}/cancelar`, { method: 'POST', body: {} }); }
    await paintCobrancas(root);
  });
  const rows = d.faturas.map((f) => el('tr', {},
    el('td', { text: f.cliente || `#${f.clienteId}` }), el('td', { text: f.descricao }), el('td', { class: 'num', text: brl(f.valorCents) }), el('td', { text: f.vencimento.split('-').reverse().join('/') }),
    el('td', {}, el('span', { class: `rv-st ${f.vencida ? 'past_due' : f.status === 'paga' ? 'active' : f.status === 'cancelada' ? 'canceled' : 'trial'}`, text: f.vencida ? 'Vencida' : FST[f.status] })),
    el('td', { text: f.pagoEm ? `${new Date(f.pagoEm).toLocaleDateString('pt-BR')} · ${f.pagoForma || ''}` : '' }),
    el('td', {}, f.status === 'aberta' ? el('span', { class: 'rv-btns' }, el('button', { type: 'button', class: 'small', text: 'Registrar pagamento', onclick: acao(f, 'pagar') }), el('button', { type: 'button', class: 'small', text: 'Cancelar', onclick: acao(f, 'cancelar') })) : null)));
  root.replaceChildren(
    el('div', { class: 'kpis' }, kpi(brl(d.totais.abertoCents), 'em aberto'), kpi(brl(d.totais.vencidoCents), 'vencido', d.totais.vencidoCents ? 'warn' : ''), kpi(brl(d.totais.pagoCents), 'recebido')),
    el('p', { class: 'hint', text: 'Boleto e Pix automáticos entram quando a empresa de cobrança for ligada. Até lá, gere as mensalidades e registre os pagamentos recebidos.' }),
    el('div', { class: 'card' }, gerar),
    el('div', { class: 'card', style: 'margin-top:16px' }, el('div', { class: 'rv-bar' }, el('h3', { text: 'Cobranças' }), filtro),
      el('div', { class: 'rv-scroll' }, el('table', { class: 'rv-table' }, el('thead', {}, el('tr', {}, ...['Cliente', 'Descrição', 'Valor', 'Vencimento', 'Situação', 'Pago em', ''].map((h) => el('th', { text: h })))),
        el('tbody', {}, ...(rows.length ? rows : [el('tr', {}, el('td', { colspan: 7, class: 'dim', text: 'Nenhuma cobrança.' }))]))))),
    avulsa);
}

/* ================================================================== telas e mapa */
let mapa = null;
export async function paintTelas(root, { soMapa = false } = {}) {
  loading(root);
  const d = await api('/api/revenda/telas');
  const cont = (s) => d.telas.filter((t) => t.status === s).length;
  const tabela = el('table', { class: 'rv-table' }, el('thead', {}, el('tr', {}, ...['Tela', 'Cliente', 'Unidade', 'Situação', 'Último sinal'].map((h) => el('th', { text: h })))),
    el('tbody', {}, ...(d.telas.length ? d.telas.map((t) => el('tr', {}, el('td', {}, el('b', { text: t.name })), el('td', { text: t.cliente || '—' }), el('td', { text: t.unidade || '—' }),
      el('td', {}, el('span', { class: `rv-st ${t.status === 'no-ar' ? 'active' : t.status === 'fora' ? 'suspended' : 'trial'}`, text: SIT[t.status] })),
      el('td', { text: t.lastSeen ? new Date(t.lastSeen).toLocaleString('pt-BR') : '—' }))) : [el('tr', {}, el('td', { colspan: 5, class: 'dim', text: 'Nenhuma tela ainda.' }))])));
  const box = el('div', { class: 'pf-mapbox mp-map' });
  root.replaceChildren(
    el('div', { class: 'kpis' }, kpi(d.telas.length, 'telas'), kpi(cont('no-ar'), 'no ar', 'ok'), kpi(cont('fora'), 'fora do ar', cont('fora') ? 'warn' : ''), kpi(cont('nunca'), 'nunca conectaram')),
    el('div', { class: 'card', style: 'margin-top:16px' }, box),
    soMapa ? null : el('div', { class: 'card rv-scroll', style: 'margin-top:16px' }, tabela));
  mapa?.destroy?.();
  mapa = createMap(box, {});
  const CLS = { 'no-ar': 'on', fora: 'off', nunca: 'never' };
  const pts = d.telas.filter((t) => t.lat != null && t.lng != null).map((t) => ({ id: `t${t.id}`, lat: t.lat, lng: t.lng, status: CLS[t.status], title: `${t.name} · ${t.cliente || ''}` }));
  mapa.setPins(pts);
  if (pts.length) mapa.fit(pts);
}
export const leaveMapa = () => { mapa?.destroy?.(); mapa = null; };

/* a revenda abriu o painel do cliente noutra aba: a sessão vem uma vez pelo localStorage e fica só no sessionStorage dela (nunca pelo endereço) */
export function tokenDeEntrada() {
  const t = localStorage.getItem('disp.token.entrar');
  if (t) localStorage.removeItem('disp.token.entrar');
  return t;
}
void state; void store;
