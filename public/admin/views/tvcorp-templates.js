// DIGITAL ISP · aba Templates (docs/FUNCIONALIDADES.md §4): a biblioteca de templates prontos por segmento, gerada por
// public/shared/templates-catalogo.js (5.000 ou mais). Busca sem acento, filtros por grupo, segmento, peça e formato, e as
// miniaturas de 24 em 24 (carregam mais ao rolar até o fim ou no botão): nunca se desenha a biblioteca inteira.
// "Usar este template" abre o editor de slide da aba Mídias já preenchido; salvar grava o slide na biblioteca (POST
// /api/tvcorp/media, a mesma validação de qualquer slide). Sem o módulo "templates" no plano, a aba mostra o aviso de upgrade.
import { state } from '../lib.js';
import { el, guard, tapi, put, opt, note, btn, empty, listOf, T } from './tvcorp-base.js';
import { slidePreview } from '../../shared/tvcorp-previa.js';
import { templateCatalog, filterTemplates, GROUPS, ALL_SEGMENTS, PIECES } from '../../shared/templates-catalogo.js';
import { BY_KEY } from '../../shared/funcionalidades.js';
import { slideEditor, themeOf } from './tvcorp-midias.js';
import { todosOsQuadros, dicaArte, FORMATO_TXT } from './tvcorp-quadros.js';
import { D } from './tvcorp-base.js';

const PAGE = 24;
/** Os filtros ficam entre uma visita e outra à aba (na mesma sessão). */
const V = { q: '', group: '', segment: '', piece: '', orient: '', quadro: '', premium: '', shown: PAGE };
/** Vindo de uma playlist: os templates no formato do quadro dela. */
export function templatesPara(orient, q = null) { V.orient = orient || ''; V.quadro = q && q.layout?.id != null ? `l${q.layout.id}:${q.zone.id}` : ''; V.shown = PAGE; }

/** O plano tem o módulo? Sem a lista do plano (servidor antigo, dados de exemplo): tem. */
export const hasTemplates = () => T.demo || !state.me?.planFeatures || Boolean(state.me.planFeatures.templates);

/** O aviso de upgrade: o que o módulo traz e com quem falar. */
function upgrade() {
  const m = BY_KEY.templates;
  const cliente = state.me?.tenant && state.me?.plan?.code?.startsWith?.('cliente-');
  return el('div', { class: 'card pf-empty tc-off tp-up' },
    el('h3', { text: `${m?.label || 'Templates prontos'}: não incluído no seu plano` }),
    note(`${m?.desc || 'A biblioteca de templates por segmento.'} São mais de 5.000 modelos em português, em paisagem e em retrato, prontos para editar e pôr nas telas.`, 'dim'),
    note(cliente ? 'Para liberar, fale com a empresa que fornece as suas telas e peça o módulo "Templates prontos" no seu plano.'
      : 'Para liberar, peça à equipe do DIGITAL ISP o módulo "Templates prontos" no plano da sua revenda.', 'dim'));
}

/** Um cartão: a miniatura (o desenho do próprio slide), o nome e o botão. */
function card(t, use) {
  const thumb = el('div', { class: `tc-thumb${t.premium ? ' tp-prem' : ''}`, role: 'button', tabindex: '0', title: `Usar: ${t.name}`, onclick: () => use(t), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); use(t); } } },
    slidePreview(t.template, t.fields, { theme: themeOf() }), t.premium ? el('span', { class: 'tp-tag', text: 'PREMIUM', title: 'Com foto própria gerada por IA' }) : null);
  return el('div', { class: 'tp-card' }, thumb,
    el('div', { class: 'tp-card-b' },
      el('b', { text: t.fields.title || t.name }),
      el('span', { class: 'dim small', text: `${t.segmentLabel} · ${t.pieceLabel} · ${t.orient === 'port' ? 'em pé (9:16)' : 'deitado (16:9)'}` }),
      el('div', { class: 'pf-btns left' }, btn('Usar este template', () => use(t), 'small primary'))));
}

export default async function paintTemplates(box, ctx) {
  if (!hasTemplates()) { put(box, upgrade()); return; }
  const all = templateCatalog();
  // as imagens da biblioteca (para os campos de imagem do editor), buscadas só quando a pessoa usa um template
  const use = guard(async (t) => {
    const r = await tapi('/api/tvcorp/media').catch(() => null);
    const images = listOf(r, 'media').filter((m) => m.kind === 'image' && m.status !== 'rejected');
    slideEditor(null, images, async () => { ctx.refreshBadge?.(); }, { template: t.template, fields: t.fields, name: t.name.slice(0, 60) });
  });
  const segOptions = () => ALL_SEGMENTS.filter((s) => !V.group || s.group === V.group).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  const q = el('input', { type: 'search', value: V.q, placeholder: 'Buscar: padaria, oferta, pizza, horário, Natal…', 'aria-label': 'Buscar templates' });
  const group = el('select', { 'aria-label': 'Grupo' }, opt('', 'Todos os grupos', !V.group), ...GROUPS.map((g) => opt(g.key, g.label, V.group === g.key)));
  const segment = el('select', { 'aria-label': 'Segmento' });
  const piece = el('select', { 'aria-label': 'Peça' }, opt('', 'Todas as peças', !V.piece), ...PIECES.map((p) => opt(p.key, p.label, V.piece === p.key)));
  const orient = el('select', { 'aria-label': 'Formato' }, opt('', 'Deitado e em pé', !V.orient), opt('land', 'Deitado (16:9)', V.orient === 'land'), opt('port', 'Em pé (9:16)', V.orient === 'port'));
  // para o quadro de um layout: escolhe o formato e mostra o tamanho da arte
  const quadros = todosOsQuadros(D());
  const quadro = el('select', { 'aria-label': 'Para o quadro' }, opt('', 'Para qualquer quadro', !V.quadro),
    ...['Layouts da empresa', 'Modelos prontos'].map((g) => { const qs = quadros.filter((q) => q.grupo === g); return qs.length ? el('optgroup', { label: g }, ...qs.map((q) => opt(q.key, `${q.nome} (${q.px.w}×${q.px.h}, ${FORMATO_TXT[q.formato]})`, V.quadro === q.key))) : null; }).filter(Boolean));
  const dica = el('p', { class: 'small tp-dica', 'aria-live': 'polite' });
  const paintDica = () => { const q = quadros.find((x) => x.key === V.quadro); dica.hidden = !q; dica.textContent = q ? `${q.nome}. ${q.formato === 'quad' ? 'Quadro quase quadrado: deitados e em pé servem, com corte nas sobras.' : `Mostrando só os templates ${q.formato === 'port' ? 'em pé' : 'deitados'}.`} ${dicaArte(q)}` : ''; };
  quadro.addEventListener('change', () => { V.quadro = quadro.value; const q = quadros.find((x) => x.key === V.quadro); V.orient = q && q.formato !== 'quad' ? q.formato : ''; orient.value = V.orient; paintDica(); apply(); });
  const premium = el('select', { 'aria-label': 'Premium' }, opt('', 'Premium e comuns', !V.premium), opt('sim', 'Só PREMIUM (com foto)', V.premium === 'sim'), opt('nao', 'Só comuns', V.premium === 'nao'));
  premium.addEventListener('change', () => { V.premium = premium.value; apply(); });
  const fillSegments = () => put(segment, opt('', 'Todos os segmentos', !V.segment), ...segOptions().map((s) => opt(s.key, s.label, V.segment === s.key)));
  fillSegments();
  const count = el('span', { class: 'dim small', role: 'status' });
  const grid = el('div', { class: 'tp-grid' });
  const more = el('div', { class: 'tp-more' });
  let list = [];
  const paintPage = () => {
    put(grid, ...list.slice(0, V.shown).map((t) => card(t, use)));
    count.textContent = list.length ? `${list.length.toLocaleString('pt-BR')} de ${all.length.toLocaleString('pt-BR')} templates` : '';
    put(more, V.shown < list.length ? btn(`Mostrar mais (${Math.min(PAGE, list.length - V.shown)} de ${(list.length - V.shown).toLocaleString('pt-BR')} restantes)`, () => { V.shown += PAGE; paintPage(); }) : null);
    if (!list.length) put(grid, empty('Nenhum template com esses filtros. Tente outra palavra ou limpe os filtros.'));
  };
  const apply = () => {
    list = filterTemplates(all, V);
    V.shown = PAGE;
    paintPage();
  };
  let timer = null;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { V.q = q.value; apply(); }, 200); });
  group.addEventListener('change', () => { V.group = group.value; if (V.segment && !segOptions().some((s) => s.key === V.segment)) V.segment = ''; fillSegments(); apply(); });
  segment.addEventListener('change', () => { V.segment = segment.value; apply(); });
  piece.addEventListener('change', () => { V.piece = piece.value; apply(); });
  orient.addEventListener('change', () => { V.orient = orient.value; apply(); });
  paintDica();
  const clear = btn('Limpar filtros', () => { Object.assign(V, { q: '', group: '', segment: '', piece: '', orient: '', quadro: '', premium: '' }); premium.value = ''; q.value = ''; group.value = ''; piece.value = ''; orient.value = ''; quadro.value = ''; paintDica(); fillSegments(); apply(); }, 'small');
  put(box,
    note('Modelos prontos por segmento, em português, para deitado (16:9) e em pé (9:16). Escolha um, troque os textos, os preços e as cores e salve: ele vai para a biblioteca (Mídias) e entra nas playlists como qualquer slide.'),
    el('div', { class: 'tp-bar' }, q, quadro, premium, group, segment, piece, orient, clear),
    dica,
    count, grid, more);
  apply();
  // carregar mais ao chegar perto do fim da lista (rolagem leve: só 24 novos por vez)
  if (typeof IntersectionObserver === 'function') {
    const io = new IntersectionObserver((ents) => { if (ents.some((e) => e.isIntersecting) && V.shown < list.length && box.isConnected) { V.shown += PAGE; paintPage(); } }, { rootMargin: '400px' });
    io.observe(more);
  }
}
