// TV Corporativa · aba Celular (docs/TV-CORPORATIVA.md §2.5 e §6): o endereço da página do funcionário no celular (sem
// login: os comunicados em vigor, o "Li", os aniversariantes, os eventos e o cardápio), com o QR code para imprimir e
// colar no mural, e a caixa de sugestões (anônimas por padrão; o IP não é guardado).
// Rotas: GET/POST /api/tvcorp/mobile, DELETE /api/tvcorp/mobile/:id, GET /api/tvcorp/suggestions, POST …/:id/decide.
import { el, guard, toast, tapi, tblob, put, f, opt, table, label, note, empty, btn, btns, chip, dialog, D, listOf, when } from './tvcorp-base.js';
import { copyText } from '../lib.js';
import { qrSvg } from '../../shared/telas-previa.js';
import { LIMITS } from './tvcorp-catalogo.js';

const KIND = { sugestao: 'Sugestão', conteudo: 'Conteúdo para a TV', pesquisa: 'Resposta de pesquisa' };
const STATUS = { pending: 'Nova', ok: 'Respondida', rejected: 'Arquivada' };
const officeName = (id) => (id == null ? 'Empresa toda' : D().offices.find((o) => o.id === id)?.name || '—');

/** O endereço novo aparece uma vez, com o QR code e o botão de imprimir (só a folha do QR sai na impressão). */
function showUrl(name, url) {
  const sheet = el('div', { class: 'tc-print' }, el('h2', { text: name }), qrSvg(url, 'tc-qr-big'), el('p', { text: 'Aponte a câmera do celular para ver os comunicados, os aniversariantes e o cardápio, e para mandar sugestões.' }), el('p', { class: 'small', text: url }));
  dialog(`Endereço do celular · ${name}`, el('div', {},
    note('O endereço aparece só agora (só o resumo dele fica guardado). Copie, imprima o QR code e cole no mural, no refeitório e na recepção.'),
    el('div', { class: 'pf-url', text: url }), sheet,
    btns(btn('Copiar o endereço', () => copyText(url), 'small'), btn('Imprimir o QR code', () => { document.body.classList.add('tc-printing'); window.print(); setTimeout(() => document.body.classList.remove('tc-printing'), 500); }, 'small primary'))), { wide: true });
}
function newMobile(reload) {
  const name = el('input', { type: 'text', maxlength: String(LIMITS.mobileName), placeholder: 'Ex.: Empresa toda, Fábrica Campinas' });
  const office = el('select', {}, opt('', 'Empresa toda (vê o que é da empresa e de todas as unidades)', true), ...D().offices.map((o) => opt(o.id, `Só ${o.name}`)));
  dialog('Novo endereço do celular', el('div', { class: 'pf-grid' }, f('Nome', name), f('Mostra o quê', office), note('Quem tem o endereço vê os comunicados e os aniversariantes (só nome e dia). Não ponha informação sigilosa nos comunicados.')), {
    saveLabel: 'Gerar o endereço',
    save: async () => {
      const r = await tapi('/api/tvcorp/mobile', { method: 'POST', body: { name: name.value.trim() || 'Empresa toda', officeId: office.value ? Number(office.value) : null } });
      await reload();
      setTimeout(() => showUrl(name.value.trim() || 'Empresa toda', r.url), 0);
    },
  });
}

export default async function paintCelular(box, ctx) {
  const [mobile, sugg] = await Promise.all([tapi('/api/tvcorp/mobile').then((r) => listOf(r, 'links')).catch(() => []), tapi('/api/tvcorp/suggestions').then((r) => listOf(r, 'suggestions'))]);
  const again = () => paintCelular(box, ctx);
  // responder: "Publicar como comunicado" (vira um comunicado em vigor, com o texto da pessoa), "Lida" ou "Arquivar"
  const decide = (s, how) => guard(async () => {
    let body = { approve: how !== 'archive' };
    if (how === 'post') { const t = prompt('Título do comunicado (o texto é o da sugestão):', ''); if (t === null) return; body = { approve: true, post: { title: t.trim(), category: 'comunicado', scope: { kind: 'all' } } }; }
    await tapi(`/api/tvcorp/suggestions/${s.id}/decide`, { method: 'POST', body });
    toast(how === 'post' ? 'Publicada como comunicado (aba RH).' : how === 'archive' ? 'Arquivada.' : 'Marcada como lida.'); await again(); ctx.refreshBadge();
  });
  const live = mobile.filter((m) => !m.revokedAt);
  put(box,
    note('A página do celular não pede login: quem tem o endereço (ou lê o QR code) vê os comunicados em vigor, confirma o "Li" digitando o nome ou a matrícula, vê os aniversariantes da semana e o cardápio, e manda sugestões.'),
    label(`Endereços (${live.length})`),
    btns(btn('+ Endereço do celular', () => newMobile(again), 'primary')),
    live.length ? table(['Nome', 'Mostra', 'Criado', ''], live.map((m) => el('tr', {},
      el('td', {}, el('b', { text: m.name })), el('td', { text: officeName(m.officeId) }), el('td', { text: when(m.createdAt) }),
      el('td', { class: 'pf-actions' }, btn('Revogar', guard(async () => { if (!confirm(`Revogar o endereço "${m.name}"? Quem estava com ele perde o acesso. Os QR codes impressos deixam de funcionar.`)) return; await tapi(`/api/tvcorp/mobile/${m.id}`, { method: 'DELETE' }); await again(); }), 'small danger')))))
      : empty('Nenhum endereço ainda. Gere um e imprima o QR code para o mural.'),
    note('Perdeu o endereço? Ele não fica guardado: gere outro e revogue o antigo.'),
    label(`Caixa de sugestões (${sugg.filter((s) => s.status === 'pending').length} nova(s))`),
    sugg.length ? table(['Tipo', 'Texto', 'Quem', 'Unidade', 'Quando', ''], sugg.map((s) => el('tr', { class: s.status === 'pending' ? '' : 'pf-gone' },
      el('td', {}, chip(s.kindLabel || KIND[s.kind] || s.kind), s.image ? btn('Ver a imagem', guard(async () => { const u = await tblob(`/api/tvcorp/suggestions/${s.id}/file`); dialog('Imagem da sugestão', el('img', { class: 'tc-sug-img', src: u, alt: 'Imagem enviada com a sugestão' })); }), 'small') : null),
      el('td', { class: 'pf-pre', text: s.text || '—' }),
      el('td', { text: s.who || 'anônimo' }), el('td', { text: officeName(s.officeId) }), el('td', { text: when(s.createdAt) }),
      el('td', { class: 'pf-actions' }, s.status !== 'pending' ? el('span', { class: 'dim small', text: `${STATUS[s.status] || s.status}${s.decidedBy ? ` por ${s.decidedBy}` : ''}` })
        : [btn('Publicar como comunicado', decide(s, 'post'), 'small primary'), btn('Lida', decide(s, 'read'), 'small'), btn('Arquivar', decide(s, 'archive'), 'small')]))))
      : empty('Nenhuma sugestão ainda.'),
    note('As sugestões são anônimas, a não ser que a pessoa escreva o nome. Ficam 180 dias.'));
}
