// NEXA Telas · TV Corporativa (docs/TV-CORPORATIVA.md §4.2): o catálogo do modo corporativo, o mesmo arquivo no servidor
// (server/tvcorp.js e server/tvcorp-core.js, as validações), no painel (public/admin/views/tvcorp-*.js) e na prévia
// (public/shared/tvcorp-previa.js). O app Android desenha os mesmos modelos em código nativo a partir das mesmas chaves.
// Sem DOM e sem dependências: só dados e funções puras. Dono: pacote A (só acrescenta; C e D só leem).

/* ------------------------------------------------------------------ limites */
export const TVC_LIMITS = Object.freeze({
  // por cliente (docs §5.4)
  media: 2000, playlists: 200, layouts: 100, schedules: 300, feeds: 50, people: 20000, posts: 2000, kpis: 200,
  // layout por zonas (contrato §4.1)
  zones: 6, videoZones: 1, zoneMinPct: 5,
  // o que vai a uma tela
  itemsPerZone: 60, playlistItems: 60, blocksActive: 2, blocksSent: 12, cacheFiles: 200, cacheBytes: 80 * 1024 * 1024,
  // tempo de cada item na tela (segundos)
  secondsMin: 3, secondsMax: 300, secondsDefault: 10,
  // textos
  name: 60, description: 200, title: 60, text: 280, textLines: 8, zoneText: 120, label: 40, url: 500,
  // prioridade da grade (maior vence)
  priorityMin: 0, priorityMax: 100,
  // imagem enviada (conferida pelo conteúdo) e a que vai às telas
  uploadBytes: 15 * 1024 * 1024, uploadPixels: 16_000_000, imageBytes: 2 * 1024 * 1024,
  // logomarca: PNG com transparência
  logoUploadBytes: 5 * 1024 * 1024, logoSide: 512, logoBytes: 512 * 1024,
  // sinal de vida (relatório de exibição)
  playsPerBeat: 100, playsMaxN: 100000, playsMaxSec: 86400,
  // dados que mudam sozinhos ficam segurados 15 min (o rev não muda a cada minuto)
  holdMs: 15 * 60_000,
  // guarda do relatório de exibição e das horas em exibição
  keepDays: 400,
  // relatórios: no máximo um ano de cada vez
  reportDays: 400,
});

/** Tamanho da tela de cada orientação (a imagem enviada sai neste quadro). */
export const TVC_FRAMES = Object.freeze({ land: { width: 1920, height: 1080 }, port: { width: 1080, height: 1920 } });
export const TVC_ORIENTATIONS = Object.freeze([
  { key: 'land', label: 'Deitada (16:9)' },
  { key: 'port', label: 'Em pé (9:16)' },
]);
export const TVC_ORIENTATION_KEYS = Object.freeze(TVC_ORIENTATIONS.map((o) => o.key));

/** Como a imagem enviada ocupa o quadro: cobre (corta as sobras) ou encaixa (com fundo da cor escolhida). */
export const TVC_FITS = Object.freeze([
  { key: 'cover', label: 'Cobrir a tela (corta as sobras)' },
  { key: 'contain', label: 'Mostrar inteira (com fundo)' },
]);
export const TVC_FIT_KEYS = Object.freeze(TVC_FITS.map((f) => f.key));

/* ------------------------------------------------------------------ zonas do layout (contrato §4.1 zones[].kind) */
/**
 * auto: o conteúdo vem da configuração da tela ou do servidor, sem playlist. playlist: a zona recebe uma playlist na grade.
 * params: os campos que a zona aceita (texto, endereço do QR, rótulo).
 */
export const TVC_ZONES = Object.freeze([
  { key: 'video', label: 'Vídeo do canal', desc: 'O canal ao vivo (grade, playout e ao vivo). No máximo um por layout.' },
  { key: 'playlist', label: 'Playlist', desc: 'Imagens, slides, comunicados, aniversariantes, indicadores e notícias em sequência.', playlist: true },
  { key: 'ticker', label: 'Texto rolante', desc: 'Os avisos da barra inferior (os mesmos da configuração da tela).' },
  { key: 'clock', label: 'Relógio', desc: 'Hora e data.' },
  { key: 'weather', label: 'Clima', desc: 'A previsão da cidade da unidade.' },
  { key: 'qr', label: 'QR code', desc: 'Um QR code fixo com um título.', params: ['qr', 'title'] },
  { key: 'logo', label: 'Logomarca', desc: 'A logomarca da empresa.' },
  { key: 'text', label: 'Texto fixo', desc: 'Um título e uma frase fixos.', params: ['title', 'text'] },
  { key: 'news', label: 'Notícias', desc: 'As manchetes das fontes escolhidas, com a fonte e a hora.', playlist: true },
  { key: 'quotes', label: 'Cotações', desc: 'Dólar, euro e outras moedas, com a hora da cotação.', playlist: true },
  { key: 'countdown', label: 'Contagem regressiva', desc: 'Dias e horas até um evento.', playlist: true },
  { key: 'safety', label: 'Dias sem acidente', desc: 'Os dias sem acidente, o recorde e a meta.', playlist: true },
  { key: 'worldclock', label: 'Relógio mundial', desc: 'A hora em outras cidades.', params: ['title'] },
  { key: 'queue', label: 'Chamada de senha', desc: 'A senha chamada e as últimas chamadas (quando a unidade tem a chamada de senha).' },
]);
export const TVC_ZONE = Object.freeze(Object.fromEntries(TVC_ZONES.map((z) => [z.key, z])));
export const TVC_ZONE_KEYS = Object.freeze(TVC_ZONES.map((z) => z.key));
/** Zonas que recebem uma playlist na grade (as outras se preenchem sozinhas). */
export const TVC_PLAYLIST_ZONES = Object.freeze(TVC_ZONES.filter((z) => z.playlist).map((z) => z.key));
export const TVC_ZONE_ID_RE = /^[a-z][a-z0-9-]{0,15}$/;

/* ------------------------------------------------------------------ itens */
/**
 * O que entra numa playlist (tvcorp_playlist_items.ref_kind). auto: preenchido pelo servidor (pacote B, dataFor), sem id
 * fixo ou com o id da fonte; needsId: precisa do id de um cadastro (mídia, comunicado, indicador, widget, fonte, cartão).
 */
export const TVC_REF_KINDS = Object.freeze([
  { key: 'media', label: 'Imagem ou slide', needsId: true },
  { key: 'post', label: 'Comunicado', needsId: true },
  { key: 'widget', label: 'Contador, dias sem acidente, relógio mundial ou cardápio', needsId: true },
  { key: 'kpi', label: 'Indicador', needsId: true },
  { key: 'birthdays', label: 'Aniversariantes', auto: true },
  { key: 'news', label: 'Notícias', auto: true },
  { key: 'quotes', label: 'Cotações', auto: true },
  { key: 'posts', label: 'Comunicados em vigor (todos)', auto: true },
  { key: 'card', label: 'Cartão de informação', needsId: true },
]);
export const TVC_REF_KIND = Object.freeze(Object.fromEntries(TVC_REF_KINDS.map((k) => [k.key, k])));
export const TVC_REF_KIND_KEYS = Object.freeze(TVC_REF_KINDS.map((k) => k.key));

/** Os itens que a tela recebe (contrato §4.1 zones[...][].kind). */
export const TVC_ITEM_KINDS = Object.freeze(['image', 'slide', 'birthdays', 'kpi', 'news', 'quotes', 'post', 'menu', 'countdown', 'safety', 'worldclock']);

/**
 * O id do item na tela (o mesmo que volta em plays[].ref): m<id> mídia, p<id> comunicado, k<id> indicador, w<id> widget,
 * c<id> cartão, n<id> fonte de notícias (n:all = todas), q<id> cotações (q:all), w:birthdays, w:posts.
 */
export function itemRef(refKind, refId) {
  const id = Number(refId) > 0 ? String(Number(refId)) : null;
  switch (refKind) {
    case 'media': return id ? `m${id}` : null;
    case 'post': return id ? `p${id}` : null;
    case 'kpi': return id ? `k${id}` : null;
    case 'widget': return id ? `w${id}` : null;
    case 'card': return id ? `c${id}` : null;
    case 'news': return id ? `n${id}` : 'n:all';
    case 'quotes': return id ? `q${id}` : 'q:all';
    case 'birthdays': return 'w:birthdays';
    case 'posts': return 'w:posts';
    default: return null;
  }
}
/** O contrário de itemRef: { refKind, refId } (refId 0 nos automáticos sem id) ou null. */
export function parseItemRef(ref) {
  const s = String(ref ?? '');
  if (s === 'w:birthdays') return { refKind: 'birthdays', refId: 0 };
  if (s === 'w:posts') return { refKind: 'posts', refId: 0 };
  if (s === 'n:all') return { refKind: 'news', refId: 0 };
  if (s === 'q:all') return { refKind: 'quotes', refId: 0 };
  const m = /^([mpkwcnq])([1-9][0-9]{0,15})$/.exec(s);
  if (!m) return null;
  const kind = { m: 'media', p: 'post', k: 'kpi', w: 'widget', c: 'card', n: 'news', q: 'quotes' }[m[1]];
  return { refKind: kind, refId: Number(m[2]) };
}

/* ------------------------------------------------------------------ alcance da grade */
/** spec: a ordem do desempate (mais específica vence): tela > grupo > unidade > região > empresa. */
export const TVC_SCOPES = Object.freeze([
  { key: 'all', label: 'Todas as telas da empresa', spec: 0 },
  { key: 'regions', label: 'Regiões', spec: 1, list: 'regions' },
  { key: 'offices', label: 'Unidades', spec: 2, list: 'offices' },
  { key: 'groups', label: 'Grupos de telas', spec: 3, list: 'groups' },
  { key: 'devices', label: 'Telas escolhidas', spec: 4, list: 'devices' },
]);
export const TVC_SCOPE = Object.freeze(Object.fromEntries(TVC_SCOPES.map((s) => [s.key, s])));
export const TVC_SCOPE_KEYS = Object.freeze(TVC_SCOPES.map((s) => s.key));
/** A tela cai no alcance? at: { deviceId, officeId, regionId, groupIds }. */
export function tvcScopeHits(scope, at) {
  const has = (list, v) => Array.isArray(list) && v != null && list.map(Number).includes(Number(v));
  switch (scope?.kind) {
    case 'all': return true;
    case 'regions': return has(scope.regions, at.regionId);
    case 'offices': return has(scope.offices, at.officeId);
    case 'groups': return (at.groupIds || []).some((g) => has(scope.groups, g));
    case 'devices': return has(scope.devices, at.deviceId);
    default: return false;
  }
}

/* ------------------------------------------------------------------ dias da semana (0 = domingo, como o Date) */
export const TVC_DAYS = Object.freeze([
  { key: 0, short: 'Dom', label: 'Domingo' }, { key: 1, short: 'Seg', label: 'Segunda' }, { key: 2, short: 'Ter', label: 'Terça' },
  { key: 3, short: 'Qua', label: 'Quarta' }, { key: 4, short: 'Qui', label: 'Quinta' }, { key: 5, short: 'Sex', label: 'Sexta' },
  { key: 6, short: 'Sáb', label: 'Sábado' },
]);

/* ------------------------------------------------------------------ modelos de layout (de fábrica) */
const Z = (id, kind, x, y, w, h, extra = {}) => Object.freeze({ id, kind, x, y, w, h, ...extra });
/**
 * Os layouts prontos. Cada zona em % da tela (inteiros 0 a 100). hint: o conteúdo sugerido para a playlist da zona (o
 * painel abre a playlist já filtrada). O cliente copia um destes para tvcorp_layouts quando personaliza.
 */
export const TVC_LAYOUT_MODELS = Object.freeze([
  { key: 'tela-cheia', label: 'Tela cheia', desc: 'Só o vídeo do canal.', orientation: 'land', background: '#000000', zones: [Z('main', 'video', 0, 0, 100, 100)] },
  { key: 'so-conteudo', label: 'Só conteúdo', desc: 'Uma playlist em tela cheia, sem vídeo.', orientation: 'land', background: '#0b1220', zones: [Z('main', 'playlist', 0, 0, 100, 100)] },
  { key: 'video-lateral', label: 'Vídeo + lateral', desc: 'O vídeo e uma coluna de conteúdo à direita.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'video', 0, 0, 75, 100), Z('right', 'playlist', 75, 0, 25, 100)] },
  { key: 'video-lateral-barra', label: 'Vídeo + lateral + barra', desc: 'Em L: o vídeo, a coluna de conteúdo e o texto rolante embaixo.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'video', 0, 0, 75, 88), Z('right', 'playlist', 75, 0, 25, 88), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'video-barra', label: 'Vídeo + barra', desc: 'O vídeo e o texto rolante embaixo.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'video', 0, 0, 100, 88), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'conteudo-barra', label: 'Conteúdo + barra', desc: 'Uma playlist grande e o texto rolante embaixo.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 100, 88), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'dois-quadros', label: 'Dois quadros', desc: 'Duas playlists lado a lado.', orientation: 'land', background: '#0b1220',
    zones: [Z('left', 'playlist', 0, 0, 50, 100), Z('right', 'playlist', 50, 0, 50, 100)] },
  { key: 'tres-quadros', label: 'Três quadros', desc: 'O vídeo grande e duas playlists à direita.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'video', 0, 0, 66, 100), Z('top', 'playlist', 66, 0, 34, 50), Z('bottom', 'playlist', 66, 50, 34, 50)] },
  { key: 'recepcao', label: 'Recepção', desc: 'O vídeo, a chamada de senha e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'video', 0, 0, 70, 88), Z('queue', 'queue', 70, 0, 30, 88), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'refeitorio', label: 'Refeitório', desc: 'O cardápio do dia, o vídeo e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('menu', 'playlist', 0, 0, 40, 88, { hint: 'widget' }), Z('main', 'video', 40, 0, 60, 88), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'chao-de-fabrica', label: 'Chão de fábrica', desc: 'Os indicadores, os dias sem acidente e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('kpis', 'playlist', 0, 0, 65, 88, { hint: 'kpi' }), Z('safety', 'safety', 65, 0, 35, 88), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'totem', label: 'Totem em pé', desc: 'Em pé: o vídeo em cima, a playlist embaixo e o texto rolante.', orientation: 'port', background: '#0b1220',
    zones: [Z('main', 'video', 0, 0, 100, 45), Z('content', 'playlist', 0, 45, 100, 45), Z('bar', 'ticker', 0, 90, 100, 10)] },
].map((m) => Object.freeze({ ...m, zones: Object.freeze(m.zones) })));
export const TVC_LAYOUT_MODEL = Object.freeze(Object.fromEntries(TVC_LAYOUT_MODELS.map((m) => [m.key, m])));
export const TVC_LAYOUT_MODEL_KEYS = Object.freeze(TVC_LAYOUT_MODELS.map((m) => m.key));

/* ------------------------------------------------------------------ modelos de slide */
/**
 * Tipos de campo do slide: line (uma linha), text (várias linhas, até TVC_LIMITS.textLines), url (https), media (uma
 * imagem da biblioteca: vira { url, sha256, bytes } na tela), date (AAAA-MM-DD), datetime (AAAA-MM-DDTHH:MM, hora de
 * Brasília da empresa), color (#rrggbb), choice (uma das opções).
 */
export const TVC_FIELD_TYPES = Object.freeze(['line', 'text', 'url', 'media', 'date', 'datetime', 'color', 'choice']);
const F = (key, label, type, extra = {}) => Object.freeze({ key, label, type, ...extra });
const TITLE = F('title', 'Título', 'line', { max: 60, required: true });
const TEXT = F('text', 'Texto', 'text', { max: 280 });
const IMAGE = F('image', 'Imagem', 'media');
const QR = F('qr', 'QR code (endereço)', 'url');
const PRICE = F('price', 'Preço', 'line', { max: 16, required: true });
const OLD_PRICE = F('oldPrice', 'Preço de (riscado)', 'line', { max: 16 });
const TAG = F('tag', 'Etiqueta', 'line', { max: 30 });
/**
 * As artes de fundo dos slides (public/tvcorp/arte/<chave>.svg, desenhadas no projeto, sem marca de terceiros; as fotos
 * foto-<chave>.jpg são próprias, geradas para o DIGITAL ISP). tone: dark (o texto fica claro) ou light (o texto fica
 * escuro): a prévia põe a classe tvc-art-dark ou tvc-art-light e o texto segue a arte. photo: foto com véu escuro por cima.
 */
export const TVC_ARTS = Object.freeze([
  { key: 'ondas', label: 'Ondas', tone: 'dark' }, { key: 'geometrico', label: 'Geométrico', tone: 'dark' },
  { key: 'aniversario', label: 'Aniversário (confete)', tone: 'dark' }, { key: 'seguranca', label: 'Segurança do trabalho (faixas)', tone: 'dark' },
  { key: 'fim-de-ano', label: 'Fim de ano', tone: 'dark' }, { key: 'conquista', label: 'Conquista (raios)', tone: 'dark' },
  { key: 'evento', label: 'Evento (luzes)', tone: 'dark' }, { key: 'saude', label: 'Saúde e bem-estar', tone: 'light' },
  // DIGITAL ISP (templates por segmento)
  { key: 'listras', label: 'Listras', tone: 'dark' }, { key: 'pontos', label: 'Pontos', tone: 'dark' },
  { key: 'folhas', label: 'Folhas', tone: 'dark' }, { key: 'circuito', label: 'Circuito (tecnologia)', tone: 'dark' },
  { key: 'papel', label: 'Papel claro', tone: 'light' },
  { key: 'foto-supermercado', label: 'Foto: hortifrúti', tone: 'dark', photo: true }, { key: 'foto-padaria', label: 'Foto: pães e café', tone: 'dark', photo: true },
  { key: 'foto-farmacia', label: 'Foto: farmácia', tone: 'dark', photo: true }, { key: 'foto-pizzaria', label: 'Foto: pizza no forno', tone: 'dark', photo: true },
  { key: 'foto-cafeteria', label: 'Foto: cafeteria', tone: 'dark', photo: true }, { key: 'foto-academia', label: 'Foto: academia', tone: 'dark', photo: true },
  { key: 'foto-clinica', label: 'Foto: recepção de clínica', tone: 'dark', photo: true }, { key: 'foto-barbearia', label: 'Foto: barbearia', tone: 'dark', photo: true },
  { key: 'foto-pet', label: 'Foto: cachorro e gato', tone: 'dark', photo: true }, { key: 'foto-provedor', label: 'Foto: fibra óptica', tone: 'dark', photo: true },
].map((x) => Object.freeze(x)));
export const TVC_ART = Object.freeze(Object.fromEntries(TVC_ARTS.map((x) => [x.key, x])));
/**
 * As cores do slide (o campo palette): sem ele, a cor do tema da empresa. hex: a cor de destaque (etiquetas); o fundo e o
 * texto de cada uma ficam no CSS (th-<chave>), conferidos para 4,5:1 (test/templates.test.js).
 */
export const TVC_PALETTES = Object.freeze([
  { key: 'azul', label: 'Azul', hex: '#1d4ed8' }, { key: 'verde', label: 'Verde', hex: '#15803d' }, { key: 'petroleo', label: 'Petróleo', hex: '#0f766e' },
  { key: 'vinho', label: 'Vinho', hex: '#9f1239' }, { key: 'roxo', label: 'Roxo', hex: '#6d28d9' }, { key: 'laranja', label: 'Laranja', hex: '#c2410c' },
  { key: 'grafite', label: 'Grafite', hex: '#334155' }, { key: 'vermelho', label: 'Vermelho', hex: '#b91c1c' }, { key: 'marrom', label: 'Marrom', hex: '#92400e' },
  { key: 'rosa', label: 'Rosa', hex: '#be185d' }, { key: 'dourado', label: 'Dourado', hex: '#a16207' },
].map((x) => Object.freeze(x)));
/**
 * Os campos de estilo de todos os modelos: tema claro ou escuro, a cor de destaque (sem ela, a cor da empresa), a arte de
 * fundo (a prévia do painel desenha; o app desenha o slide na cor do tema), a cor do slide (palette; sem ela, a do tema) e
 * o formato (orient: port = em pé, 9:16, para TV em pé e totem; sem ele, deitado).
 */
export const TVC_STYLE_FIELDS = Object.freeze([
  F('variant', 'Tema', 'choice', { options: ['dark', 'light'], labels: ['Escuro', 'Claro'] }),
  F('accent', 'Cor de destaque', 'color'),
  F('art', 'Arte de fundo', 'choice', { options: TVC_ARTS.map((x) => x.key), labels: TVC_ARTS.map((x) => x.label) }),
  F('palette', 'Cor do slide', 'choice', { options: TVC_PALETTES.map((x) => x.key), labels: TVC_PALETTES.map((x) => x.label) }),
  F('orient', 'Formato', 'choice', { options: ['land', 'port'], labels: ['Deitado (16:9)', 'Em pé (9:16)'] }),
]);
export const TVC_SLIDE_MODELS = Object.freeze([
  { key: 'comunicado', label: 'Comunicado', desc: 'Título, texto e QR opcional.', fields: [TITLE, TEXT, IMAGE, QR] },
  { key: 'boas-vindas', label: 'Boas-vindas', desc: 'Para quem chega: visitante ou novo colega.', fields: [TITLE, F('name', 'Nome', 'line', { max: 60 }), F('sector', 'Setor', 'line', { max: 40 }), TEXT, IMAGE] },
  { key: 'aniversariantes', label: 'Aniversariantes', desc: 'A capa da lista de aniversariantes (os nomes vêm do cadastro).', fields: [TITLE, TEXT, IMAGE] },
  { key: 'reconhecimento', label: 'Reconhecimento', desc: 'Uma conquista ou uma história da equipe.', fields: [TITLE, F('name', 'Pessoa ou equipe', 'line', { max: 60 }), TEXT, IMAGE] },
  { key: 'seguranca', label: 'Segurança do trabalho', desc: 'EPI, procedimentos, SIPAT.', fields: [TITLE, TEXT, IMAGE, QR] },
  { key: 'evento', label: 'Evento', desc: 'Data, local e a contagem regressiva.', fields: [TITLE, F('target', 'Quando', 'datetime', { required: true }), F('place', 'Local', 'line', { max: 60 }), TEXT, IMAGE, QR] },
  { key: 'vaga', label: 'Vaga interna', desc: 'Vaga ou processo seletivo.', fields: [TITLE, F('area', 'Área', 'line', { max: 40 }), TEXT, F('until', 'Inscrições até', 'date'), QR] },
  { key: 'indicador', label: 'Indicador', desc: 'Um número grande com a meta.', fields: [TITLE, F('value', 'Valor', 'line', { max: 20, required: true }), F('target', 'Meta', 'line', { max: 20 }), F('unit', 'Unidade', 'line', { max: 10 }), TEXT] },
  { key: 'cardapio', label: 'Cardápio', desc: 'O cardápio do dia (uma linha por prato).', fields: [TITLE, F('text', 'Pratos (um por linha)', 'text', { max: 280 }), IMAGE] },
  { key: 'qr', label: 'Chamada com QR code', desc: 'Pesquisa, inscrição ou sugestão pelo celular.', fields: [TITLE, TEXT, F('qr', 'QR code (endereço)', 'url', { required: true })] },
  { key: 'imagem-com-legenda', label: 'Imagem com legenda', desc: 'Uma imagem grande e uma linha de legenda.', fields: [F('image', 'Imagem', 'media', { required: true }), F('title', 'Legenda', 'line', { max: 60 })] },
  { key: 'data-comemorativa', label: 'Data comemorativa', desc: 'Uma data do calendário com mensagem.', fields: [TITLE, F('date', 'Data', 'date'), TEXT, IMAGE] },
  // DIGITAL ISP: os modelos do comércio (templates por segmento)
  { key: 'oferta', label: 'Oferta', desc: 'Um produto ou serviço com o preço em destaque (e o "de" riscado).', fields: [F('title', 'Produto ou serviço', 'line', { max: 60, required: true }), PRICE, OLD_PRICE, F('unit', 'Unidade', 'line', { max: 20 }), TAG, F('text', 'Texto', 'text', { max: 160 }), F('until', 'Válido até', 'date'), IMAGE, QR] },
  { key: 'precos', label: 'Vitrine de preços', desc: 'Tabela de preços ou cardápio com preço (uma linha por item: nome | preço).', fields: [TITLE, F('text', 'Itens (um por linha: nome | preço)', 'text', { max: 400, required: true }), F('note', 'Observação', 'line', { max: 80 }), IMAGE] },
  { key: 'combo', label: 'Combo', desc: 'Vários itens por um preço só.', fields: [TITLE, F('text', 'Itens do combo (um por linha)', 'text', { max: 200, required: true }), PRICE, OLD_PRICE, TAG, IMAGE, QR] },
  { key: 'horario', label: 'Horário de funcionamento', desc: 'Os dias e os horários (uma linha por faixa: dias | horário).', fields: [TITLE, F('text', 'Horários (um por linha: dias | horário)', 'text', { max: 240, required: true }), F('note', 'Observação', 'line', { max: 80 }), QR] },
  { key: 'redes', label: 'Redes sociais', desc: 'O perfil da empresa nas redes, com o QR code.', fields: [TITLE, F('handle', 'Perfil (@)', 'line', { max: 40, required: true }), TEXT, F('site', 'Site', 'line', { max: 60 }), QR] },
].map((m) => Object.freeze({ ...m, fields: Object.freeze([...m.fields, ...TVC_STYLE_FIELDS]) })));
export const TVC_SLIDE_MODEL = Object.freeze(Object.fromEntries(TVC_SLIDE_MODELS.map((m) => [m.key, m])));
export const TVC_SLIDE_MODEL_KEYS = Object.freeze(TVC_SLIDE_MODELS.map((m) => m.key));

/* ------------------------------------------------------------------ comunicados (pacote B: tvcorp_posts.category) */
/** template: o modelo de slide em que o comunicado da categoria é desenhado. */
export const TVC_POST_CATEGORIES = Object.freeze([
  { key: 'comunicado', label: 'Comunicado', template: 'comunicado' },
  { key: 'rh', label: 'Recursos humanos', template: 'comunicado' },
  { key: 'beneficio', label: 'Benefícios', template: 'comunicado' },
  { key: 'boas-vindas', label: 'Boas-vindas', template: 'boas-vindas' },
  { key: 'reconhecimento', label: 'Reconhecimento', template: 'reconhecimento' },
  { key: 'seguranca', label: 'Segurança do trabalho', template: 'seguranca' },
  { key: 'vaga', label: 'Vaga interna', template: 'vaga' },
  { key: 'evento', label: 'Evento', template: 'evento' },
  { key: 'aviso', label: 'Aviso', template: 'comunicado' },
]);
export const TVC_POST_CATEGORY = Object.freeze(Object.fromEntries(TVC_POST_CATEGORIES.map((c) => [c.key, c])));
export const TVC_POST_CATEGORY_KEYS = Object.freeze(TVC_POST_CATEGORIES.map((c) => c.key));

/* ------------------------------------------------------------------ widgets (pacote B: tvcorp_widgets.kind) */
export const TVC_WIDGETS = Object.freeze([
  { key: 'countdown', label: 'Contagem regressiva' },
  { key: 'safety', label: 'Dias sem acidente' },
  { key: 'worldclock', label: 'Relógio mundial' },
  { key: 'menu', label: 'Cardápio da semana' },
]);
export const TVC_WIDGET_KEYS = Object.freeze(TVC_WIDGETS.map((w) => w.key));

/** Faixas de cor do indicador (contrato §4.1 item kpi.band). */
export const TVC_KPI_BANDS = Object.freeze([
  { key: 'ok', label: 'Na meta', hex: '#2e7d32' },
  { key: 'warn', label: 'Atenção', hex: '#f9a825' },
  { key: 'bad', label: 'Fora da meta', hex: '#c62828' },
]);

/* ------------------------------------------------------------------ unidades corporativas (docs §5.1) */
/**
 * Os tipos de unidade do modo corporativo (o catálogo oficial dos tipos é public/shared/telas-tipos.js, com corp: true;
 * esta lista é a referência das chaves para o servidor da TV Corporativa saber se a tela é de uma unidade corporativa).
 */
export const TVC_OFFICE_TYPE_KEYS = Object.freeze(['matriz', 'filial', 'fabrica', 'loja', 'cd', 'refeitorio', 'recepcao', 'ambulatorio', 'treinamento', 'corp-outro']);
export const isTvcOfficeType = (t) => TVC_OFFICE_TYPE_KEYS.includes(String(t ?? ''));

/* ------------------------------------------------------------------ situação das mídias, grades e aprovação */
export const TVC_STATUS = Object.freeze({ ok: 'Em uso', pending: 'Aguardando aprovação', rejected: 'Devolvido' });
/** Os tipos novos na fila de aprovação (telas_approvals.kind). */
export const TVC_APPROVAL_KINDS = Object.freeze(['tvc-media', 'tvc-schedule', 'tvc-post']);

/** Minutos do dia em "HH:MM" (1440 = "24:00"). */
export const minutesText = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
