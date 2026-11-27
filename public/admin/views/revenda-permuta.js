// Painel da REVENDA · a PERMUTA do cliente final (no cadastro do cliente): a revenda liga a permuta, marca as telas do
// cliente que são permuta (ou escolhe todas) e vincula mídias ou playlists da biblioteca dela como propaganda obrigatória.
// Os itens entram intercalados na zona de playlist maior dos layouts do cliente; ele vê o aviso e não remove.
// Rotas GET/PUT /api/revenda/clientes/:id/permuta (server/revenda.js); a montagem em server/tvcorp.js (comPropaganda).
import { el, api, toast, guard } from '../lib.js';

const TIPO = { image: 'imagem', video: 'vídeo', slide: 'slide' };
const caixa = (checked, texto, extra = null) => {
  const i = el('input', { type: 'checkbox', checked });
  return { i, l: el('label', { class: 'rv-pm-op' }, i, el('span', { text: texto }), extra) };
};

/** O quadro da permuta (só no cliente já cadastrado: antes disso, só o aviso). */
export function permutaCard(clienteId) {
  const box = el('fieldset', { class: 'rv-sec rv-pm' }, el('legend', { text: 'Permuta (propaganda obrigatória)' }));
  if (!clienteId) {
    box.append(el('p', { class: 'dim small', text: 'Depois de cadastrar o cliente, abra o cadastro dele para ligar a permuta: marcar as telas da permuta e escolher a sua propaganda.' }));
    return box;
  }
  box.append(el('p', { class: 'dim', text: 'Carregando…' }));
  api(`/api/revenda/clientes/${clienteId}/permuta`).then((p) => pintar(box, clienteId, p)).catch((e) => box.replaceChildren(el('legend', { text: 'Permuta (propaganda obrigatória)' }), el('p', { class: 'gd-falta', text: e.message || 'Não deu para carregar a permuta.' })));
  return box;
}

function pintar(box, clienteId, p) {
  const ligada = caixa(p.on, 'Permuta ligada para este cliente');
  const onde = el('select', {},
    el('option', { value: 'permuta', text: 'Só nas telas marcadas como permuta', selected: p.scope !== 'all' }),
    el('option', { value: 'all', text: 'Em todas as telas do cliente', selected: p.scope === 'all' }));
  // as telas do cliente: cada uma com a chave Permuta (ligada / desligada)
  const telas = p.telas.map((t) => ({ t, ...caixa(p.devices.includes(t.id), t.name, t.unidade ? el('small', { class: 'dim', text: ` · ${t.unidade}` }) : null) }));
  const telasBox = el('div', { class: 'rv-pm-lista' }, ...(telas.length ? telas.map((x) => x.l) : [el('p', { class: 'dim small', text: 'O cliente ainda não tem telas. As telas que ele ativar aparecem aqui para marcar (ou escolha "Em todas as telas").' })]));
  const pintaOnde = () => { telasBox.hidden = onde.value === 'all'; };
  onde.addEventListener('change', pintaOnde); pintaOnde();
  // a propaganda: mídias e playlists da biblioteca da revenda
  const tem = (kind, id) => p.items.some((x) => x.kind === kind && x.id === id);
  const midias = p.midias.map((m) => ({ kind: 'media', id: m.id, ...caixa(tem('media', m.id), m.title, el('small', { class: 'dim', text: ` · ${TIPO[m.kind] || m.kind}` })) }));
  const pls = p.playlists.map((x) => ({ kind: 'playlist', id: x.id, ...caixa(tem('playlist', x.id), x.name, el('small', { class: 'dim', text: ' · playlist' })) }));
  const vazio = !midias.length && !pls.length;
  const salvar = el('button', { type: 'button', class: 'primary small', text: 'Salvar a permuta', onclick: guard(async () => {
    const items = [...pls, ...midias].filter((x) => x.i.checked).map((x) => ({ kind: x.kind, id: x.id }));
    const body = { on: ligada.i.checked, scope: onde.value, devices: telas.filter((x) => x.i.checked).map((x) => x.t.id), items };
    if (items.length > 30) { toast('No máximo 30 itens de propaganda (use uma playlist para juntar mais).', true); return; }
    const r = await api(`/api/revenda/clientes/${clienteId}/permuta`, { method: 'PUT', body });
    toast(r.on ? `Permuta ligada: ${r.items.length} item(ns) de propaganda em ${r.scope === 'all' ? 'todas as telas do cliente' : `${r.devices.length} tela(s)`}. As telas recebem em até 1 minuto.` : 'Permuta desligada: a propaganda sai das telas do cliente.');
    pintar(box, clienteId, r);
  }) });
  box.replaceChildren(
    el('legend', { text: 'Permuta (propaganda obrigatória)' }),
    el('p', { class: 'dim small', text: 'Na permuta, a sua propaganda entra na programação do cliente, intercalada com o conteúdo dele, na zona de playlist maior de cada layout. É obrigatória: o cliente vê o aviso no painel dele, mas não consegue remover. Ela aparece nas telas da TV Corporativa que têm uma zona de playlist.' }),
    ligada.l,
    el('label', { class: 'rv-f' }, el('span', { text: 'Onde a propaganda entra' }), onde),
    telasBox,
    el('div', { class: 'rv-pm-sub', text: 'A sua propaganda (da sua biblioteca da TV Corporativa)' }),
    vazio ? el('p', { class: 'gd-falta', text: 'A sua biblioteca ainda não tem mídias nem playlists. Cadastre a propaganda em TV Corporativa (Mídias ou Playlists) e volte aqui.' })
      : el('div', { class: 'rv-pm-lista' }, ...pls.map((x) => x.l), ...midias.map((x) => x.l)),
    el('div', { class: 'rv-actions' }, salvar));
}
