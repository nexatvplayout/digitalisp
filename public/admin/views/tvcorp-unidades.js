// TV Corporativa · aba Unidades e grupos (docs/TV-CORPORATIVA.md §5.1 e §6): as unidades (matriz, filial, fábrica, loja,
// CD, refeitório, recepção, ambulatório, sala de treinamento), os usuários e o link de cada uma, o PIN de saída, a chave de
// integração e os grupos de telas (manuais ou automáticos por tipo de unidade). Rotas /api/tvcorp/rede/*.
import {
  el, guard, toast, tapi, put, f, opt, table, label, note, empty, btn, btns, chip, dialog, D,
  active, groupsOf, counters, officeOf,
} from './tvcorp-base.js';
import { copyText, api } from '../lib.js';
import { ufCityPicker } from '../../shared/uf-city.js';
import { OFFICE_TYPES, MODULE, OFFICE_ROLES } from '../../shared/telas-tipos.js';
import { corpTypes } from './tvcorp-catalogo.js';
import { newKey } from './tvcorp-telas.js';

const TYPES = () => corpTypes(OFFICE_TYPES);
const typeName = (k) => TYPES().find((t) => t.key === k)?.label || OFFICE_TYPES.find((t) => t.key === k)?.label || k;
/** Os módulos que valem numa unidade corporativa (§5.1): avisos sempre; senha, comunicação interna e pânico por unidade. */
const CORP_MODULES = [
  ['senha', 'Chamada de senha', 'Recepção e ambulatório: a fila na tela, o totem e a página do guichê.'],
  ['interna', 'Comunicação interna', 'Avisos da direção com "Li" no celular, só nas telas internas.'],
  ['panico', 'Botão de pânico silencioso', 'Um aviso discreto para a portaria ou a segurança. Nada aparece nas telas.'],
];
const DEFAULT_MODS = { recepcao: ['senha', 'panico'], ambulatorio: ['senha'], fabrica: ['interna'], cd: ['interna'] };

function showOnce(title, text, value, hint) {
  dialog(title, el('div', { class: 'pf-keybox' }, note(text), el('div', { class: 'pf-url', text: value }), hint ? note(hint) : null, btn('Copiar', () => copyText(value), 'small')));
}

/** Os endereços estruturados das unidades (server/enderecos.js), lidos ao abrir a aba. */
let enderecos = {};

function editOffice(o, reload) {
  const name = el('input', { type: 'text', maxlength: '80', value: o?.name || '', placeholder: 'Ex.: Fábrica Campinas' });
  const type = el('select', {}, ...TYPES().map((t) => opt(t.key, t.label, (o?.type || 'filial') === t.key)));
  // endereço estruturado (DIGITAL ISP): o CEP preenche a rua, o bairro, a UF e o município; o ponto no mapa sai do endereço
  const e0 = (o && enderecos?.[o.id]) || {};
  const cep = el('input', { type: 'text', inputmode: 'numeric', maxlength: '9', value: e0.cep ? `${e0.cep.slice(0, 5)}-${e0.cep.slice(5)}` : '', placeholder: '00000-000' });
  const rua = el('input', { type: 'text', maxlength: '120', value: e0.rua || (!e0.cep && o?.address) || '' });
  const numero = el('input', { type: 'text', maxlength: '20', value: e0.numero || '' });
  const compl = el('input', { type: 'text', maxlength: '60', value: e0.complemento || '' });
  const bairro = el('input', { type: 'text', maxlength: '80', value: e0.bairro || '' });
  let timer = null; let seq = 0;
  const agendar = () => { clearTimeout(timer); timer = setTimeout(() => localizar(), 700); };
  const place = ufCityPicker({ uf: e0.uf || '', cityIbge: e0.municipioIbge ?? null, city: e0.municipio || '', idPrefix: `un${o?.id || 'n'}`, onChange: () => agendar() });
  const lat = el('input', { type: 'text', inputmode: 'decimal', value: o?.lat ?? '', placeholder: 'calculada pelo endereço' });
  const lng = el('input', { type: 'text', inputmode: 'decimal', value: o?.lng ?? '', placeholder: 'calculada pelo endereço' });
  const ponto = el('p', { class: 'dim small', text: o?.lat != null ? 'Ponto guardado. Muda sozinho se o endereço mudar.' : 'O ponto no mapa é calculado sozinho quando o endereço estiver completo.' });
  let precisao = e0.precisao || null; let manual = e0.precisao === 'manual';
  for (const x of [lat, lng]) x.addEventListener('input', () => { manual = true; precisao = 'manual'; ponto.textContent = 'Ponto ajustado à mão (o endereço não muda mais o ponto).'; });
  async function localizar() {
    const p = place.value();
    if (manual || !p.uf || !p.city) return;
    const my = ++seq;
    ponto.textContent = 'Calculando o ponto no mapa…';
    try {
      const q = new URLSearchParams({ rua: rua.value, numero: numero.value, bairro: bairro.value, municipio: p.city, uf: p.uf });
      const r = await api(`/api/localizar?${q}`);
      if (my !== seq) return;
      lat.value = Number(r.lat).toFixed(6); lng.value = Number(r.lng).toFixed(6); precisao = r.precisao;
      ponto.textContent = r.precisao === 'endereco' ? 'Ponto calculado pelo endereço.' : 'Rua não encontrada no mapa: ponto no centro do município (ajuste à mão se quiser).';
    } catch (err) { if (my === seq) ponto.textContent = err.message; }
  }
  for (const x of [rua, numero, bairro]) x.addEventListener('change', agendar);
  cep.addEventListener('change', guard(async () => {
    const d = cep.value.replace(/\D/g, '');
    if (d.length !== 8) return;
    const r = await api(`/api/cep/${d}`);
    cep.value = `${d.slice(0, 5)}-${d.slice(5)}`;
    if (r.rua) rua.value = r.rua;
    if (r.bairro) bairro.value = r.bairro;
    if (r.uf) { place.ufSelect.value = r.uf; place.ufSelect.dispatchEvent(new Event('change', { bubbles: true })); }
    await place.ready;
    if (r.municipio) { place.cityInput.value = r.municipio; place.cityInput.dispatchEvent(new Event('input', { bubbles: true })); place.cityInput.dispatchEvent(new Event('blur')); }
    numero.focus();
    agendar();
  }));
  const address = { get value() { const p = place.value(); return [[rua.value.trim(), numero.value.trim()].filter(Boolean).join(', '), compl.value.trim(), bairro.value.trim(), p.city ? `${p.city}/${p.uf}` : '', cep.value.trim()].filter(Boolean).join(' - ').slice(0, 200); } };
  const respName = el('input', { type: 'text', maxlength: '120', value: o?.respName || '' });
  const respContact = el('input', { type: 'text', maxlength: '120', value: o?.respContact || '', placeholder: 'telefone ou e-mail' });
  const mods = { ...(o?.modules || {}) };
  const modBox = el('div', { class: 'pf-checks' });
  const paintMods = () => put(modBox, ...CORP_MODULES.map(([k, l, desc]) => el('label', { class: 'pf-check', title: MODULE[k]?.desc || desc },
    el('input', { type: 'checkbox', checked: mods[k] ?? (DEFAULT_MODS[type.value] || []).includes(k), onchange: (e) => { mods[k] = e.target.checked; } }), el('span', { text: `${l}: ${desc}` }))));
  type.addEventListener('change', paintMods); paintMods();
  const num = (v) => (String(v).trim() === '' ? null : Number(String(v).replace(',', '.')));
  dialog(o ? `Unidade · ${o.name}` : 'Nova unidade', el('div', {},
    el('div', { class: 'pf-grid' }, f('Nome', name), f('Tipo', type), f('Responsável', respName), f('Contato do responsável', respContact)),
    label('Endereço'),
    el('div', { class: 'pf-grid' }, f('CEP', cep), f('Rua', rua), f('Número', numero), f('Complemento', compl), f('Bairro', bairro), place.ufField, place.cityField),
    el('div', { class: 'pf-grid two' }, f('Latitude', lat), f('Longitude', lng)),
    ponto,
    note('Digite o CEP para preencher o endereço. O ponto põe a unidade no mapa e no clima da unidade.'),
    label('Módulos da unidade (os avisos do texto rolante valem sempre)'), modBox), {
    wide: true,
    save: async () => {
      const b = { name: name.value, type: type.value, address: address.value, lat: num(lat.value), lng: num(lng.value), respName: respName.value, respContact: respContact.value, modules: { avisos: true, ...Object.fromEntries(CORP_MODULES.map(([k]) => [k, mods[k] ?? (DEFAULT_MODS[type.value] || []).includes(k)])) } };
      const p = place.value();
      if (!p.uf || !p.cityIbge) throw new Error('Escolha a UF e o município da lista.');
      if (!rua.value.trim()) throw new Error('Informe a rua.');
      if (b.lat == null || b.lng == null) { await localizar(); b.lat = num(lat.value); b.lng = num(lng.value); }
      const r = o ? await tapi(`/api/tvcorp/rede/offices/${o.id}`, { method: 'PATCH', body: b }) : await tapi('/api/tvcorp/rede/offices', { method: 'POST', body: b });
      const oid = o?.id ?? r?.id;
      if (oid) await api(`/api/unidades/${oid}/endereco`, { method: 'PUT', body: { cep: cep.value, rua: rua.value, numero: numero.value, complemento: compl.value, bairro: bairro.value, uf: p.uf, municipio: p.city, municipioIbge: p.cityIbge, precisao } });
      toast('Unidade salva.');
      await reload();
      if (r?.generatedPin) setTimeout(() => showOnce(`PIN de saída · ${b.name}`, 'O PIN que destrava as TV box desta unidade no local. Ele aparece só agora: anote e passe ao responsável.', String(r.generatedPin)), 0);
    },
  });
}

/** Usuários do link da unidade (gestor e atendente), o link e a chave de integração (API). */
function officeAccess(o) {
  const box = el('div', {}); let info = null;
  const load = async () => { info = await tapi(`/api/tvcorp/rede/offices/${o.id}/users`); paint(); };
  const passPair = () => {
    const a = el('input', { type: 'password', autocomplete: 'new-password', maxlength: '72' }); const b = el('input', { type: 'password', autocomplete: 'new-password', maxlength: '72' });
    return { a, b, read() { if (a.value !== b.value) throw new Error('A senha e a confirmação não são iguais.'); if (a.value.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.'); return a.value; } };
  };
  const newUser = () => {
    const username = el('input', { type: 'text', maxlength: '40', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'ex.: carla.rh' });
    const nm = el('input', { type: 'text', maxlength: '80' });
    const role = el('select', {}, ...OFFICE_ROLES.map((r) => opt(r.key, `${r.label}: ${r.desc}`, r.key === 'gestor')));
    const p = passPair();
    dialog(`Novo usuário · ${o.name}`, el('div', { class: 'pf-grid' }, f('Usuário', username, '3 a 40 letras minúsculas, números, ponto, hífen ou sublinhado.'), f('Nome', nm), f('Papel', role), f('Senha', p.a, 'Pelo menos 8 caracteres. Só o resumo cifrado fica guardado.'), f('Confirme a senha', p.b)), {
      saveLabel: 'Criar usuário',
      save: async () => { await tapi(`/api/tvcorp/rede/offices/${o.id}/users`, { method: 'POST', body: { username: username.value, name: nm.value, role: role.value, password: p.read() } }); toast('Usuário criado. Passe o usuário e a senha por um caminho diferente do do link.'); await load(); },
    });
  };
  const patch = (u, body, msg) => guard(async () => { await tapi(`/api/tvcorp/rede/offices/${o.id}/users/${u.id}`, { method: 'PATCH', body }); toast(msg); await load(); });
  const genLink = guard(async () => {
    if (info.office?.link?.on && !confirm('Gerar outro link? O de antes deixa de valer.')) return;
    const r = await tapi(`/api/tvcorp/rede/offices/${o.id}/link`, { method: 'POST', body: {} });
    showOnce(`Link da unidade · ${o.name}`, 'O link desta unidade aparece só agora (só o resumo dele fica guardado). Copie e mande ao responsável:', r.url, 'Quem entra só alcança esta unidade: publicar comunicados e imagens nela, os aniversariantes dela e ver as telas dela.');
    await load();
  });
  const apiNote = note('Carregando…');
  const apiBtns = el('div', { class: 'pf-btns left' });
  const readKey = async () => {
    let k = null; try { k = await tapi(`/api/tvcorp/rede/offices/${o.id}/api-key`); } catch { /* sem a rota */ }
    if (!k || k.allowed === undefined) { apiNote.textContent = 'A chave de integração aparece quando o servidor for atualizado.'; put(apiBtns); return; }
    apiNote.textContent = !k.allowed ? 'O plano não inclui o Acesso por API: a chave de integração fica indisponível.' : k.on ? `Chave gerada em ${new Date(k.createdAt).toLocaleString('pt-BR')}. Último uso: ${k.lastUsed ? new Date(k.lastUsed).toLocaleString('pt-BR') : 'nunca'}.` : 'Sem chave. Com ela, o sistema da empresa (RH, ERP, BI) publica comunicados, valores de indicadores e imagens nesta unidade.';
    put(apiBtns, k.allowed ? btn(k.on ? 'Gerar outra chave' : 'Gerar a chave de integração', guard(async () => {
      if (k.on && !confirm('Gerar outra chave? A de antes deixa de valer na hora.')) return;
      const r = await tapi(`/api/tvcorp/rede/offices/${o.id}/api-key`, { method: 'POST', body: {} });
      showOnce('Chave de integração', 'A chave aparece só agora. Entregue ao responsável técnico:', r.key, r.endpoint ? `Endereço: ${r.endpoint} (cabeçalho Authorization: Bearer <chave>)` : null); await readKey();
    })) : null, k.on ? btn('Revogar a chave', guard(async () => { if (!confirm('Revogar a chave de integração?')) return; await tapi(`/api/tvcorp/rede/offices/${o.id}/api-key`, { method: 'DELETE' }); toast('Chave revogada.'); await readKey(); }), 'danger') : null);
  };
  function paint() {
    const users = info.users || [];
    put(box,
      note(`Cada unidade tem um link próprio e os usuários dela. O Gestor publica comunicados e imagens na unidade, cuida dos aniversariantes dela e vê as telas dela; o Atendente só vê o atendimento (quando a unidade tem a chamada de senha). Com a aprovação ligada, o que vem do link espera na aba Aprovações.`),
      label('Link desta unidade'),
      note(info.office?.link?.on ? `Link ligado desde ${new Date(info.office.link.at).toLocaleString('pt-BR')}. Se perdeu o endereço, gere outro.` : 'Esta unidade ainda não tem link.', 'small'),
      btns(btn(info.office?.link?.on ? 'Gerar outro link' : 'Gerar o link', genLink)),
      label(`Usuários (${users.length}${info.max ? ` de ${info.max}` : ''})`),
      users.length ? table(['Usuário', 'Papel', 'Situação', ''], users.map((u) => el('tr', {},
        el('td', {}, el('b', { text: u.username }), el('div', { class: 'dim small', text: u.name || '—' })),
        el('td', { text: OFFICE_ROLES.find((r) => r.key === u.role)?.label || u.role }),
        el('td', { text: u.active ? 'ativo' : 'desativado' }),
        el('td', { class: 'pf-actions' }, btn(u.active ? 'Desativar' : 'Reativar', patch(u, { active: !u.active }, u.active ? 'Usuário desativado.' : 'Usuário reativado.'), 'small'),
          btn('Apagar', guard(async () => { if (!confirm(`Apagar o usuário "${u.username}"?`)) return; await tapi(`/api/tvcorp/rede/offices/${o.id}/users/${u.id}`, { method: 'DELETE' }); await load(); }), 'small danger')))))
        : empty('Nenhum usuário ainda. Crie o primeiro para a unidade poder entrar.'),
      btns(btn('+ Novo usuário', newUser, 'primary')),
      label('Chave de integração (API)'), apiNote, apiBtns);
    guard(readKey)();
  }
  dialog(`Usuários e link · ${o.name}`, box, { wide: true });
  put(box, note('Carregando…'));
  guard(load)();
}

function editGroup(g, reload) {
  const name = el('input', { type: 'text', maxlength: '80', value: g?.name || '' });
  const desc = el('input', { type: 'text', maxlength: '200', value: g?.description || '' });
  const kind = el('select', {}, opt('', 'Manual: escolho as telas', !g?.officeType), ...TYPES().map((t) => opt(t.key, `Automático: todas as telas de ${t.label}`, g?.officeType === t.key)));
  const sort = el('input', { type: 'number', min: '-999', max: '999', step: '1', value: String(g?.sort ?? 0) });
  const picks = new Set(g?.deviceIds || []);
  const manualBox = el('div', {}, label('Telas do grupo'), active().length ? el('div', { class: 'pf-checks tall' }, ...active().map((x) => el('label', { class: 'pf-check' },
    el('input', { type: 'checkbox', checked: picks.has(x.id), onchange: (e) => { if (e.target.checked) picks.add(x.id); else picks.delete(x.id); } }), el('span', { text: `${x.name} · ${officeOf(x.officeId)?.name || ''}` })))) : note('Nenhuma tela ativa ainda.'));
  const sync = () => { manualBox.hidden = Boolean(kind.value); };
  kind.addEventListener('change', sync); sync();
  dialog(g ? `Grupo · ${g.name}` : 'Novo grupo', el('div', {}, el('div', { class: 'pf-grid' }, f('Nome do grupo', name), f('Descrição', desc), f('Como entram as telas', kind), f('Ordem', sort, 'Menor primeiro, quando uma tela está em vários grupos.')), manualBox), {
    wide: true,
    save: async () => {
      const b = { name: name.value, description: desc.value, officeType: kind.value || null, sort: Number(sort.value) || 0 };
      if (!kind.value) b.deviceIds = [...picks];
      if (g) await tapi(`/api/tvcorp/rede/groups/${g.id}`, { method: 'PATCH', body: b }); else await tapi('/api/tvcorp/rede/groups', { method: 'POST', body: b });
      toast('Grupo salvo.'); await reload();
    },
  });
}

export default async function paintUnidades(box, ctx) {
  enderecos = await api('/api/unidades/enderecos').catch(() => ({}));
  const d = D(); const reload = ctx.reload;
  const officeRows = d.offices.map((o) => {
    const devs = active().filter((x) => x.officeId === o.id); const n = counters(devs);
    return el('tr', {},
      el('td', {}, el('b', { text: o.name }), el('div', { class: 'dim small', text: o.address || 'sem endereço' })),
      el('td', { text: typeName(o.type) }),
      el('td', {}, `${devs.length} tela(s)`, devs.length ? el('div', { class: 'small' }, el('span', { class: 'pf-n on', text: `${n.on} no ar` }), n.off + n.never ? el('span', { class: 'pf-n off', text: ` · ${n.off + n.never} desligada(s)` }) : null) : null),
      el('td', {}, ...CORP_MODULES.filter(([k]) => o.modules?.[k]).map(([, l]) => chip(l))),
      el('td', { text: o.link?.on ? 'link ligado' : 'sem link' }),
      el('td', { class: 'pf-actions' },
        btn('Editar', () => editOffice(o, reload), 'small'),
        btn('Usuários e link', () => officeAccess(o), 'small'),
        btn('+ TV box', () => newKey(reload, o.id), 'small'),
        btn('PIN novo', guard(async () => { if (!confirm(`Gerar um PIN de saída novo para as TV box de "${o.name}"? O de antes deixa de valer em até 30 segundos.`)) return; const r = await tapi(`/api/tvcorp/rede/offices/${o.id}/pin`, { method: 'POST', body: {} }); showOnce(`PIN de saída · ${o.name}`, 'O PIN aparece só agora. Anote e passe ao responsável pela unidade.', String(r.pin)); }), 'small'),
        btn('Excluir', guard(async () => { if (devs.length) { toast('Esta unidade ainda tem telas. Revogue ou mude as telas de unidade antes.', true); return; } if (!confirm(`Excluir a unidade "${o.name}"?`)) return; await tapi(`/api/tvcorp/rede/offices/${o.id}`, { method: 'DELETE' }); await reload(); }), 'small danger')));
  });
  const groupRows = d.groups.map((g) => {
    const mine = active().filter((x) => groupsOf(x).some((y) => y.id === g.id)); const n = counters(mine);
    return el('tr', {},
      el('td', {}, el('b', { text: g.name }), g.description ? el('div', { class: 'dim small', text: g.description }) : null),
      el('td', { text: g.officeType ? `Automático · ${typeName(g.officeType)}` : 'Manual' }),
      el('td', {}, el('b', { text: String(mine.length) }), el('span', { class: 'pf-n on small', text: ` · ${n.on} no ar` })),
      el('td', { class: 'pf-actions' }, btn('Editar', () => editGroup(g, reload), 'small'),
        btn('Excluir', guard(async () => { if (!confirm(`Excluir o grupo "${g.name}"? As telas ficam; só deixam de receber o que era do grupo.`)) return; await tapi(`/api/tvcorp/rede/groups/${g.id}`, { method: 'DELETE' }); await reload(); }), 'small danger')));
  });
  put(box,
    note('Cada tela pertence a uma unidade. A grade, os comunicados e os alertas podem ir para a empresa toda, para algumas unidades, para grupos ou para telas escolhidas. Cada unidade pode ter um link próprio: o gestor dela publica só na própria unidade.'),
    label(`Unidades (${d.offices.length})`),
    btns(btn('+ Nova unidade', () => editOffice(null, reload), 'primary')),
    officeRows.length ? table(['Unidade', 'Tipo', 'Telas', 'Módulos', 'Link', ''], officeRows) : empty('Nenhuma unidade ainda. Comece pela matriz ou pela unidade onde fica a primeira TV box.'),
    label(`Grupos de telas (${d.groups.length})`),
    note('Um grupo junta telas para receber o mesmo conteúdo. Manual: você escolhe as telas. Automático: todas as telas das unidades de um tipo (todas as lojas, todas as fábricas).'),
    btns(btn('+ Novo grupo', () => editGroup(null, reload), 'primary'),
      btn('Criar os grupos automáticos por tipo', guard(async () => { const r = await tapi('/api/tvcorp/rede/groups/auto', { method: 'POST', body: {} }); toast(r.created?.length ? `${r.created.length} grupo(s) automático(s) criado(s).` : 'Todos os tipos em uso já têm o grupo automático.'); await reload(); }))),
    groupRows.length ? table(['Grupo', 'Tipo', 'Telas', ''], groupRows) : empty('Nenhum grupo ainda.'));
}
