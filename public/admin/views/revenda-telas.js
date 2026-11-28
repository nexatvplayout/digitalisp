// Painel da REVENDA · as TELAS de um cliente final (botão "Telas" na lista de Clientes): cada tela dele, com a situação,
// a unidade e o último sinal; as chaves ainda não usadas; e a chave de uma tela nova (no limite do plano do cliente e no
// da revenda). Rotas GET /api/revenda/clientes/:id/telas e POST /api/revenda/clientes/:id/telas/chave (server/revenda.js).
import { el, api, toast, guard, copyText } from '../lib.js';

const SIT = { 'no-ar': 'No ar', instavel: 'Instável', fora: 'Fora do ar', nunca: 'Nunca conectou' };
const quando = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/** O cartão das telas do cliente. `entrar` abre o painel do cliente (para cadastrar a unidade ou mexer na tela). */
export function telasCard(c, { fechar, entrar }) {
  const box = el('div', { class: 'card rv-tl' });
  const cab = () => el('div', { class: 'rv-form-head' },
    el('h3', { text: `Telas: ${c.fantasia || c.name}` }),
    el('div', { class: 'rv-btns' },
      el('button', { type: 'button', class: 'small', text: 'Abrir o painel do cliente', onclick: entrar }),
      el('button', { type: 'button', class: 'small', text: 'Fechar', onclick: fechar })));
  const carregar = async () => {
    box.replaceChildren(cab(), el('p', { class: 'dim', text: 'Carregando as telas…' }));
    try { pintar(await api(`/api/revenda/clientes/${c.id}/telas`)); } catch (e) { box.replaceChildren(cab(), el('p', { class: 'gd-falta', text: e.message })); }
  };
  function pintar(d) {
    const lista = d.telas.length
      ? el('div', { class: 'rv-scroll' }, el('table', { class: 'rv-table' },
        el('thead', {}, el('tr', {}, ...['Tela', 'Unidade', 'Situação', 'Último sinal', 'Aparelho'].map((h) => el('th', { text: h })))),
        el('tbody', {}, ...d.telas.map((t) => el('tr', {},
          el('td', {}, el('b', { text: t.name })),
          el('td', { text: t.unidade || '—' }),
          el('td', {}, el('span', { class: `rv-tl-st ${t.status}`, text: SIT[t.status] || t.status })),
          el('td', { text: quando(t.lastSeen) }),
          el('td', { class: 'dim small', text: [t.modelo, t.versao && `app ${t.versao}`].filter(Boolean).join(' · ') || '—' }))))))
      : el('p', { class: 'dim', text: 'Este cliente ainda não tem telas. Gere a chave abaixo e digite na TV.' });
    const chaves = d.chaves.length ? el('div', {},
      el('div', { class: 'rv-pm-sub', text: `Chaves esperando a TV (${d.chaves.length})` }),
      el('ul', { class: 'rv-tl-chaves' }, ...d.chaves.map((k) => el('li', { class: 'dim small', text: `${k.nome || 'Tela sem nome'} · ${k.unidade || '—'} · vence ${quando(k.expiresAt)}` })))) : null;
    // a tela nova: a unidade do cliente e o nome; a chave aparece uma vez só
    let nova;
    if (!d.unidades.length) {
      nova = el('div', {},
        el('p', { class: 'gd-falta', text: 'O cliente ainda não tem unidade. Abra o painel do cliente e cadastre a unidade em TV Corporativa → Unidades e grupos; depois volte aqui para gerar a chave.' }),
        el('div', { class: 'rv-actions' }, el('button', { type: 'button', class: 'primary small', text: 'Abrir o painel do cliente', onclick: entrar })));
    } else {
      const unidade = el('select', {}, ...d.unidades.map((u) => el('option', { value: u.id, text: u.name })));
      const nome = el('input', { type: 'text', maxlength: '80', placeholder: 'Ex.: Recepção, balcão, hall' });
      const saida = el('div', { class: 'pf-keybox', hidden: true });
      const gerar = el('button', { type: 'button', class: 'primary small', text: 'Gerar a chave da tela', onclick: guard(async () => {
        const k = await api(`/api/revenda/clientes/${c.id}/telas/chave`, { method: 'POST', body: { officeId: Number(unidade.value), name: nome.value } });
        saida.hidden = false;
        saida.replaceChildren(
          el('p', { class: 'dim small', text: 'Digite esta chave no app DIGITAL ISP da TV. Ela aparece só agora, vale para UMA tela e vence em 24 horas.' }),
          el('div', { class: 'pf-key', text: k.key }),
          el('p', { class: 'dim small', text: `Unidade ${k.unidade}${k.deviceName ? ` · tela "${k.deviceName}"` : ''} · vence ${quando(k.expiresAt)}.` }),
          el('button', { type: 'button', class: 'small', text: 'Copiar a chave', onclick: () => copyText(k.key) }));
        nome.value = '';
        toast('Chave gerada. A tela aparece aqui assim que a TV for ativada.');
      }) });
      nova = el('div', {},
        el('div', { class: 'rv-grid2' },
          el('label', { class: 'rv-f' }, el('span', { text: 'Unidade' }), unidade),
          el('label', { class: 'rv-f' }, el('span', { text: 'Nome da tela (opcional)' }), nome)),
        el('div', { class: 'rv-actions' }, gerar, el('button', { type: 'button', class: 'small', text: 'Atualizar a lista', onclick: carregar })),
        saida);
    }
    box.replaceChildren(...[cab(),
      el('p', { class: 'dim small', text: `${d.telas.length} tela(s)${c.plano?.telas != null ? ` de ${c.plano.telas} no plano ${c.plano.nome}` : ''}.` }),
      lista, chaves,
      el('fieldset', { class: 'rv-sec' }, el('legend', { text: '+ Nova tela' }), nova)].filter(Boolean));
  }
  carregar();
  return box;
}
