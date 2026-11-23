// TV Corporativa · o catálogo que o painel usa (docs/TV-CORPORATIVA.md §2, §3 e §4.2), TIRADO do catálogo comum
// public/shared/tvcorp-tipos.js (o mesmo do servidor e do app) e das datas de public/shared/tvcorp-datas.js. Aqui ficam só
// os nomes no formato que as abas usam (campos do editor de slide, itens da playlist) e as funções pequenas do painel.
// Sem DOM e sem dependências além dos catálogos: o teste importa direto.
import {
  TVC_LIMITS, TVC_ZONES, TVC_ZONE, TVC_LAYOUT_MODELS, layoutMainOf, TVC_LAYOUT_SETS, TVC_LAYOUT_SEGMENTS, TVC_SLIDE_MODELS, TVC_POST_CATEGORIES, TVC_WIDGETS, TVC_REF_KIND, TVC_SCOPES,
  TVC_ARTS, TVC_ZONE_ID_RE, isTvcOfficeType,
} from '../../shared/tvcorp-tipos.js';
import { DATES, DEFAULT_DATE_KEYS } from '../../shared/tvcorp-datas.js';

/** Tipos de zona de um layout (contrato §4.1). video: o canal, a mesma área do player de hoje; no máximo 1 por layout. */
export const ZONE_KINDS = TVC_ZONES.map((z) => ({ key: z.key, label: z.label, desc: z.desc, playlist: Boolean(z.playlist), params: z.params || [] }));
export const ZONE_KIND = Object.fromEntries(ZONE_KINDS.map((z) => [z.key, z]));
export const zoneLabel = (k) => TVC_ZONE[k]?.label || k;

/**
 * Itens de uma playlist (tvcorp_playlist_items.ref_kind, os do catálogo comum). pick: a lista de onde se escolhe o registro
 * (feed: só as fontes do tipo feedKind); auto: o servidor preenche sozinho; optional: o registro é opcional (sem ele, todos).
 */
export const ITEM_KINDS = [
  { key: 'media', pick: 'media' },
  { key: 'posts', auto: true },
  { key: 'post', pick: 'post' },
  { key: 'birthdays', auto: true },
  { key: 'kpi', pick: 'kpi' },
  { key: 'news', pick: 'feed', feedKind: 'rss', label: 'Notícias (uma fonte)' },
  { key: 'quotes', pick: 'feed', feedKind: 'quotes', label: 'Cotações (uma fonte)' },
  { key: 'widget', pick: 'widget' },
].map((k) => ({ label: TVC_REF_KIND[k.key].label, ...k }));
export const ITEM_KIND = Object.fromEntries(ITEM_KINDS.map((k) => [k.key, k]));

/** Limites (os mesmos do servidor: TVC_LIMITS; os do RH e do celular, os do pacote B). */
export const LIMITS = Object.freeze({
  name: TVC_LIMITS.name, description: TVC_LIMITS.description,
  slideTitle: TVC_LIMITS.title, slideText: TVC_LIMITS.text, slideLines: TVC_LIMITS.textLines, slideLine: 90,
  zones: TVC_LIMITS.zones, itemsPerZone: TVC_LIMITS.playlistItems, blocks: TVC_LIMITS.blocksSent,
  secondsMin: TVC_LIMITS.secondsMin, secondsMax: TVC_LIMITS.secondsMax, secondsDefault: TVC_LIMITS.secondsDefault,
  media: TVC_LIMITS.media, playlists: TVC_LIMITS.playlists, layouts: TVC_LIMITS.layouts, schedules: TVC_LIMITS.schedules,
  feeds: TVC_LIMITS.feeds, people: TVC_LIMITS.people, posts: TVC_LIMITS.posts, kpis: TVC_LIMITS.kpis,
  feedRefreshMin: 15, feedRefreshMax: 1440,
  priorityMin: TVC_LIMITS.priorityMin, priorityMax: TVC_LIMITS.priorityMax,
  imageBytes: TVC_LIMITS.uploadBytes, logoBytes: TVC_LIMITS.logoUploadBytes,
  personName: 60, personSector: 40,
  postTitle: 80, postBody: 600,
  mobileName: 60,
});

/** Os modelos de layout de fábrica (§4.2), os do catálogo comum. */
export const FACTORY_LAYOUTS = TVC_LAYOUT_MODELS.map((m) => ({ key: m.key, label: m.label, desc: m.desc, orientation: m.orientation, background: m.background, segment: m.segment || 'geral', set: m.set || null, main: layoutMainOf(m), zones: m.zones.map(({ hint, ...z }) => ({ ...z })) }));
/** Os conjuntos de várias TVs (menu board): as telas, na ordem da esquerda para a direita. */
export const FACTORY_SETS = TVC_LAYOUT_SETS.map((x) => ({ ...x, screens: [...x.screens] }));
export const LAYOUT_SEGMENTS = TVC_LAYOUT_SEGMENTS.map((x) => ({ ...x }));
export const FACTORY_LAYOUT = Object.fromEntries(FACTORY_LAYOUTS.map((l) => [l.key, l]));

/** O tipo do campo do catálogo comum -> o campo do editor: text | textarea | url | image | date | datetime | choice. */
const FIELD_KIND = { line: 'text', text: 'textarea', url: 'url', media: 'image', date: 'date', datetime: 'datetime', color: 'color', choice: 'choice' };
const pad = (n) => String(n).padStart(2, '0');
/** Uma data daqui a n dias (AAAA-MM-DD), para os exemplos dos modelos. */
const dayAhead = (n) => { const d = new Date(Date.now() + n * 86400000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const SAMPLES = {
  comunicado: { title: 'Horário de fim de ano', text: 'Nos dias 24 e 31 o expediente vai até as 14h.' },
  'boas-vindas': { title: 'Seja bem-vindo!', name: 'Marcos A.', sector: 'Logística', text: 'Novo integrante do time.' },
  aniversariantes: { title: 'Aniversariantes da semana', text: 'Os nomes vêm do cadastro do RH.' },
  reconhecimento: { title: 'Destaque do mês', name: 'Equipe do turno B', text: '30 dias seguidos sem retrabalho.' },
  seguranca: { title: 'Use o EPI', text: 'Capacete, óculos e protetor auricular na área de produção.' },
  evento: { title: 'SIPAT', target: `${dayAhead(12)}T09:00`, place: 'Auditório', text: 'Palestras das 9h às 11h.' },
  vaga: { title: 'Vaga: analista de compras', area: 'Suprimentos', text: 'Inscrições pelo QR code.' },
  indicador: { title: 'Produção do mês', value: '82', target: '100', unit: '%' },
  cardapio: { title: 'Cardápio de hoje', text: 'Arroz, feijão e salada\nFrango grelhado\nSobremesa: fruta' },
  qr: { title: 'Responda a pesquisa', text: 'Aponte a câmera do celular.', qr: 'https://exemplo.com.br/pesquisa' },
  'imagem-com-legenda': { title: 'Nossa equipe na feira do setor' },
  'data-comemorativa': { title: 'Dia do Trabalhador', date: dayAhead(5), text: 'Obrigado a todos que fazem a empresa acontecer.' },
  oferta: { title: 'Pão francês', price: 'R$ 16,90', oldPrice: 'R$ 19,90', unit: 'o kg', tag: 'OFERTA', text: 'Enquanto durar o estoque.' },
  precos: { title: 'Tabela de preços', text: 'Café expresso | R$ 6,50\nCappuccino | R$ 11,90\nPão na chapa | R$ 7,90\nBolo de fubá (fatia) | R$ 9,90', note: 'Preços válidos nesta loja.' },
  combo: { title: 'Combo da casa', text: 'X-salada\nBatata frita (porção)\nSuco natural', price: 'R$ 44,90', oldPrice: 'R$ 52,70', tag: 'ECONOMIZE R$ 7,80' },
  horario: { title: 'Horário de funcionamento', text: 'Segunda a sexta | 8h às 18h\nSábado | 8h às 13h\nDomingo e feriados | Fechado', note: 'Nos feriados, o horário pode mudar.' },
  redes: { title: 'Siga a gente nas redes', handle: '@suaempresa', text: 'Novidades e bastidores todos os dias.', qr: 'https://exemplo.com.br/redes' },
};
/**
 * Os modelos de slide do catálogo comum, com os campos no formato do editor (kind, max, options). A cor de destaque e a
 * arte de fundo têm controle próprio no editor (não entram na lista de campos).
 */
export const SLIDE_TEMPLATES = TVC_SLIDE_MODELS.map((m) => ({
  key: m.key, label: m.label, desc: m.desc, sample: SAMPLES[m.key] || {},
  fields: m.fields.filter((fd) => !['accent', 'art'].includes(fd.key)).map((fd) => ({
    key: fd.key, label: fd.key === 'variant' ? 'Tema do slide' : fd.label, kind: FIELD_KIND[fd.type] || 'text', max: fd.max || (fd.type === 'text' ? TVC_LIMITS.text : fd.type === 'line' ? TVC_LIMITS.title : null),
    required: Boolean(fd.required), options: fd.options || null, labels: fd.labels || null,
  })),
}));
export const SLIDE_TEMPLATE = Object.fromEntries(SLIDE_TEMPLATES.map((t) => [t.key, t]));

/** A biblioteca de artes de fundo (public/tvcorp/arte/<key>.svg, desenhadas no projeto, e as fotos próprias <key>.jpg; sem marca de terceiros). */
export const ARTS = TVC_ARTS.map((a) => ({ key: a.key, label: a.label, photo: Boolean(a.photo) }));

/** Categorias dos comunicados (tvcorp_posts.category). */
export const POST_CATEGORIES = TVC_POST_CATEGORIES.map((c) => ({ key: c.key, label: c.label }));
export const postCategoryLabel = (k) => POST_CATEGORIES.find((c) => c.key === k)?.label || k;

/** Os tipos corporativos: os do catálogo comum marcados corp (public/shared/telas-tipos.js). */
export const corpTypes = (officeTypes = []) => officeTypes.filter((t) => t.corp && isTvcOfficeType(t.key));

/** Widgets próprios (tvcorp_widgets.kind). */
export const WIDGET_KINDS = TVC_WIDGETS.map((w) => ({ key: w.key, label: w.label }));
export const widgetLabel = (k) => WIDGET_KINDS.find((w) => w.key === k)?.label || k;
export const WEEK_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Fontes de dados (tvcorp_feeds.kind). Os endereços, moedas e fusos vêm do servidor (GET /api/tvcorp/feeds e /widgets). */
export const FEED_KINDS = [
  { key: 'rss', label: 'Notícias (RSS)' }, { key: 'quotes', label: 'Cotações' }, { key: 'weather', label: 'Clima' }, { key: 'traffic', label: 'Trânsito' },
];
export const feedKindLabel = (k) => FEED_KINDS.find((x) => x.key === k)?.label || k;
export const KPI_SOURCES = [
  { key: 'manual', label: 'Manual (digito o valor)' }, { key: 'csv', label: 'Planilha publicada como CSV (https)' },
  { key: 'json', label: 'Endereço JSON (https)' }, { key: 'api', label: 'Integração por API (sistema da empresa)' },
];
/** Datas comemorativas (lista fixa de public/shared/tvcorp-datas.js): [chave, nome]; DEFAULT_DATES = as marcadas de fábrica. */
export const DATE_LIST = DATES.map((d) => [d.key, d.name]);
export const DEFAULT_DATES = DEFAULT_DATE_KEYS;

/** Escopo de uma grade ou comunicado (o mesmo formato dos alertas): todas as telas, unidades, grupos ou telas. */
export const SCOPES = TVC_SCOPES.filter((s) => s.key !== 'regions').map((s) => ({ key: s.key, label: s.label }));

/** "Ana Souza Lima" -> "Ana L." (primeiro nome + inicial do último sobrenome, §7.2). */
export function shortName(name) {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (p.length < 2) return p[0] || '';
  return `${p[0]} ${p[p.length - 1][0].toUpperCase()}.`;
}
/** Minutos do dia <-> "HH:MM". */
export const minToHm = (m) => (m == null || m === '' ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
export const hmToMin = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m ? Math.min(1440, Number(m[1]) * 60 + Number(m[2])) : null; };
/** "1,2,3" | [1,2,3] -> [1,2,3] (vazio = todo dia). */
export const daysOf = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter((x) => x !== '').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
export const daysText = (v) => { const d = daysOf(v); return !d.length || d.length === 7 ? 'todo dia' : d.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((n) => WEEK_SHORT[n]).join(', '); };
/** A faixa de cor de um indicador pela meta (sem faixas próprias: verde a partir de 100%, amarelo de 80%, vermelho abaixo). */
export function kpiBand(k) {
  if (k && Object.hasOwn(k, 'band')) return ['ok', 'warn', 'bad'].includes(k.band) ? k.band : 'none'; // o servidor já calculou
  const v = Number(k?.value); const t = Number(k?.target);
  if (k?.value == null || !Number.isFinite(v)) return 'none';
  if (!Number.isFinite(t) || t === 0) return 'none';
  if (Array.isArray(k?.bands) && k.bands.length) { // faixas próprias: "a partir de" em % da meta (como o servidor)
    const pct = (v / t) * 100;
    const hit = [...k.bands].sort((a, b) => Number(b.from) - Number(a.from)).find((b) => pct >= Number(b.from));
    if (hit) return ['ok', 'warn', 'bad'].includes(hit.band) ? hit.band : 'none';
  }
  const r = k.direction === 'down' ? t / Math.max(v, 1e-9) : v / t;
  return r >= 1 ? 'ok' : r >= 0.8 ? 'warn' : 'bad';
}
/** Confere as zonas de um layout como o servidor (§4.1): inteiros 0..100, dentro da tela, até 6 zonas, no máximo 1 vídeo, ids únicos. */
export function checkZones(zones) {
  if (!Array.isArray(zones) || !zones.length) return 'O layout precisa de pelo menos uma zona.';
  if (zones.length > LIMITS.zones) return `No máximo ${LIMITS.zones} zonas por layout.`;
  if (zones.filter((x) => x.kind === 'video').length > 1) return 'No máximo uma zona de vídeo por layout.';
  const ids = new Set();
  for (const q of zones) {
    if (!TVC_ZONE_ID_RE.test(String(q.id || ''))) return `Nome de zona inválido: "${q.id}". Comece com uma letra; use letras minúsculas, números e hífen (até 16).`;
    if (ids.has(q.id)) return `Duas zonas com o nome "${q.id}".`;
    ids.add(q.id);
    if (!ZONE_KIND[q.kind]) return `Tipo de zona desconhecido: ${q.kind}.`;
    for (const k of ['x', 'y', 'w', 'h']) if (!Number.isInteger(q[k]) || q[k] < 0 || q[k] > 100) return `A zona "${q.id}" tem ${k} fora de 0 a 100.`;
    if (q.w < TVC_LIMITS.zoneMinPct || q.h < TVC_LIMITS.zoneMinPct) return `A zona "${q.id}" ficou pequena demais (mínimo ${TVC_LIMITS.zoneMinPct}%).`;
    if (q.x + q.w > 100 || q.y + q.h > 100) return `A zona "${q.id}" passa da borda da tela.`;
  }
  for (let i = 0; i < zones.length; i++) for (let k = i + 1; k < zones.length; k++) {
    const a = zones[i]; const b = zones[k];
    if (Boolean(a.overlay) === Boolean(b.overlay) && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return `As zonas "${a.id}" e "${b.id}" estão uma por cima da outra (marque "Por cima" na que fica sobre a outra).`;
  }
  return null;
}
/** Segundos em texto curto: 3.725 -> "1 h 2 min". */
export function hoursText(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600); const m = Math.round((s % 3600) / 60);
  return h ? `${h.toLocaleString('pt-BR')} h${m ? ` ${m} min` : ''}` : `${m} min`;
}
