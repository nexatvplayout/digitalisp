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
 * params: os campos que a zona aceita (texto, endereço do QR, rótulo; widget = o gadget escolhido direto no layout, sem playlist).
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
  { key: 'countdown', label: 'Contagem regressiva', desc: 'Quanto falta para começar ou para terminar um evento: dias, horas, minutos e segundos.', playlist: true, params: ['widget'] },
  { key: 'safety', label: 'Dias sem acidente', desc: 'Os dias sem acidente, o recorde e a meta.', playlist: true, params: ['widget'] },
  { key: 'worldclock', label: 'Relógio mundial', desc: 'A hora em outras cidades.', params: ['title', 'widget'] },
  { key: 'queue', label: 'Chamada de senha', desc: 'A senha chamada e as últimas chamadas (quando a unidade tem a chamada de senha).' },
  // DIGITAL ISP: qualquer gadget direto na zona (relógio, clima, agenda, indicadores, avaliações, como chegar, página)
  { key: 'widget', label: 'Gadget', desc: 'Um gadget escolhido na aba Barras e blocos: relógio, clima, agenda, indicadores, avaliações, como chegar, página e outros.', params: ['widget'] },
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
  { key: 'widget', label: 'Gadget (contador, relógio, clima, agenda, indicadores…)', needsId: true },
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
export const TVC_ITEM_KINDS = Object.freeze(['image', 'slide', 'birthdays', 'kpi', 'news', 'quotes', 'post', 'menu', 'countdown', 'safety', 'worldclock',
  // DIGITAL ISP: os gadgets novos
  'weather', 'clock', 'agenda', 'reviews', 'dashboard', 'directions', 'web']);

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
/* ------------------------------------------------------------------ DIGITAL ISP: modelos por família (formas × segmento) */
/**
 * Os modelos gerados: para cada segmento, 4 com a playlist como zona principal e 4 com o vídeo ao vivo (o canal em HLS),
 * deitados e em pé, alguns com os gadgets por cima da imagem. A forma dá as posições (o principal, as casas dos gadgets e
 * a faixa); o segmento dá os gadgets que fazem sentido nele, na ordem de importância (a primeira casa recebe o primeiro).
 * As casas "pequenas" (por cima da imagem) só aceitam gadgets que cabem num canto (relógio, clima, QR, logomarca, contador).
 */
function familyLayouts() {
  const QR = (title) => ({ kind: 'qr', id: 'qr', name: 'QR code', small: true, extra: { qr: 'https://exemplo.com.br', title } });
  const G = {
    clock: { kind: 'clock', id: 'clock', name: 'relógio', small: true },
    weather: { kind: 'weather', id: 'weather', name: 'clima', small: true },
    logo: { kind: 'logo', id: 'logo', name: 'logomarca', small: true, extra: { opacity: 0 } },
    countdown: { kind: 'countdown', id: 'countdown', name: 'contador', small: true },
    quotes: { kind: 'quotes', id: 'quotes', name: 'cotações' },
    news: { kind: 'news', id: 'news', name: 'notícias' },
    queue: { kind: 'queue', id: 'queue', name: 'senha' },
    safety: { kind: 'safety', id: 'safety', name: 'dias sem acidente' },
    world: { kind: 'worldclock', id: 'world', name: 'relógio mundial', extra: { title: 'Horário pelo mundo' } },
    agenda: { kind: 'widget', id: 'agenda', name: 'agenda', extra: { sample: 'agenda' } },
    dash: { kind: 'widget', id: 'dash', name: 'indicadores', extra: { sample: 'dashboard' } },
    reviews: { kind: 'widget', id: 'reviews', name: 'avaliações', extra: { sample: 'reviews' } },
    directions: { kind: 'widget', id: 'directions', name: 'como chegar', extra: { sample: 'directions' } },
    ads: { kind: 'playlist', id: 'ads', name: 'anúncios', extra: { hint: 'media' } },
  };
  // os segmentos (as mesmas chaves de TVC_LAYOUT_SEGMENTS) e os gadgets de cada um, do mais ao menos importante
  const SEG = [
    ['geral', 'Uso geral', 'Geral', [G.clock, G.weather, G.news, QR('Saiba mais'), G.logo]],
    ['loja', 'Loja e varejo', 'Loja', [QR('Compre pelo site'), G.countdown, G.reviews, G.clock, G.logo]],
    ['alimentacao', 'Restaurante e lanchonete', 'Restaurante', [QR('Peça pelo celular'), G.reviews, G.clock, G.directions, G.countdown]],
    ['saude', 'Clínica e farmácia', 'Clínica', [G.queue, G.clock, QR('Agende sua consulta'), G.weather, G.directions]],
    ['academia', 'Academia', 'Academia', [G.countdown, G.clock, QR('Baixe o app de treino'), G.dash, G.weather]],
    ['escola', 'Escola', 'Escola', [G.agenda, G.clock, G.countdown, G.weather, G.news]],
    ['recepcao', 'Recepção', 'Recepção', [G.queue, G.weather, G.agenda, G.clock, QR('Fale conosco')]],
    ['corporativo', 'Escritório', 'Escritório', [G.dash, G.agenda, G.quotes, G.clock, G.news]],
    ['industria', 'Indústria', 'Indústria', [G.safety, G.dash, G.clock, G.news, G.weather]],
    ['provedor', 'Provedor de internet', 'Provedor', [QR('Assine pelo celular'), G.directions, G.reviews, G.clock, G.weather]],
    ['igreja', 'Igreja', 'Igreja', [G.agenda, G.countdown, QR('Contribua e participe'), G.clock, G.weather]],
    ['hotel', 'Hotel', 'Hotel', [G.world, G.weather, QR('Wi-Fi dos hóspedes'), G.directions, G.clock]],
    ['elevador', 'Elevador e condomínio', 'Elevador', [G.clock, G.ads, G.news, G.weather, QR('Avisos do condomínio')]],
    ['evento', 'Evento', 'Evento', [G.countdown, G.agenda, QR('Programação completa'), G.clock, G.weather]],
  ];
  // as formas: o principal (M), as casas dos gadgets (S, em ordem; small: só gadget de canto, por cima da imagem) e a faixa
  // small: casa de canto, por cima da imagem; strip: a faixa de cima das telas em pé (só gadget de canto, sem ficar por cima)
  const S = (x, y, w, h, small = false, strip = false) => ({ x, y, w, h, small, strip });
  const SHAPES = {
    playlist: [
      { key: 'lateral', lab: 'com lateral', name: 'com lateral de gadgets', o: 'land', main: [0, 0, 70, 88], slots: [S(70, 0, 30, 30), S(70, 30, 30, 30), S(70, 60, 30, 28)], bar: [0, 88, 100, 12] },
      { key: 'rodape', lab: 'com gadgets embaixo', name: 'com gadgets embaixo', o: 'land', main: [0, 0, 100, 64], slots: [S(0, 64, 34, 24), S(34, 64, 33, 24), S(67, 64, 33, 24)], bar: [0, 88, 100, 12] },
      { key: 'por-cima', lab: 'com gadgets por cima', name: 'em tela cheia com gadgets por cima', o: 'land', main: [0, 0, 100, 88], slots: [S(76, 4, 22, 22, true), S(2, 4, 22, 22, true)], bar: [0, 88, 100, 12], overlay: true },
      { key: 'em-pe', lab: 'em pé', name: 'em pé com gadgets', o: 'port', main: [0, 10, 100, 58], slots: [S(0, 0, 100, 10, false, true), S(0, 68, 50, 22), S(50, 68, 50, 22)], bar: [0, 90, 100, 10] },
    ],
    video: [
      { key: 'em-l', lab: 'em L', name: 'em L com gadgets', o: 'land', main: [0, 0, 75, 88], slots: [S(75, 0, 25, 44), S(75, 44, 25, 44)], bar: [0, 88, 100, 12] },
      { key: 'lateral', lab: 'com lateral', name: 'com lateral de três gadgets', o: 'land', main: [0, 0, 72, 88], slots: [S(72, 0, 28, 30), S(72, 30, 28, 29), S(72, 59, 28, 29)], bar: [0, 88, 100, 12] },
      { key: 'por-cima', lab: 'com gadget por cima', name: 'em tela cheia com gadget por cima', o: 'land', main: [0, 0, 100, 88], slots: [S(76, 4, 22, 22, true)], bar: [0, 88, 100, 12], overlay: true },
      { key: 'em-pe', lab: 'em pé', name: 'em pé com gadgets', o: 'port', main: [0, 10, 100, 34], slots: [S(0, 0, 100, 10, false, true), S(0, 44, 100, 24), S(0, 68, 100, 22)], bar: [0, 90, 100, 10] },
    ],
  };
  const join = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}` : xs[0] || '');
  // os cantos das casas por cima da imagem (acima da faixa): a forma "por cima" troca de canto para não repetir modelo
  const CORNERS = [[76, 4], [2, 4], [76, 62], [2, 62]];
  const sig = (o, zs) => o + JSON.stringify(zs.map((z) => [z.kind, z.x, z.y, z.w, z.h, z.sample || '', z.overlay ? 1 : 0]));
  const seen = new Set();
  const out = [];
  for (const [seg, segLabel, short, gadgets] of SEG) {
    for (const mainKind of ['playlist', 'video']) {
      for (const sh of SHAPES[mainKind]) {
        // os gadgets da forma: as casas pequenas pegam os de canto; as outras, na ordem do segmento. Se sair igual a um
        // modelo já feito, gira o canto e o tamanho da casa (forma por cima) e só depois o começo da lista de gadgets
        const SIZES = [null, [26, 18], [18, 26]];
        let zones = [];
        for (let a = 0; a < 60; a++) {
          const corner = a % 4; const size = SIZES[Math.floor(a / 4) % 3]; const skip = Math.floor(a / 12);
          const list = [...gadgets.slice(skip), ...gadgets.slice(0, skip)];
          const used = new Set(); zones = [];
          sh.slots.forEach((slot, i) => {
            const g = list.find((x) => !used.has(x.id) && (!(slot.small || slot.strip) || x.small)) || null;
            if (!g) return;
            used.add(g.id);
            const [w, h] = slot.small && size ? size : [slot.w, slot.h];
            const [cx, cy] = CORNERS[(corner + (i ? 1 : 0)) % 4];
            // o canto de baixo encosta na faixa (y + altura = 84)
            const [x, y] = slot.small ? [cx === 76 ? 98 - w : 2, cy === 4 ? 4 : 84 - h] : [slot.x, slot.y];
            zones.push(Z(g.id, g.kind, x, y, w, h, { ...(g.extra || {}), ...(slot.small ? { overlay: true, opacity: g.id === 'logo' ? 0 : 60 } : {}) }));
          });
          if (!seen.has(sig(sh.o, zones))) break;
        }
        seen.add(sig(sh.o, zones));
        const main = Z('main', mainKind, ...sh.main, mainKind === 'playlist' ? { hint: 'media' } : {});
        const bar = sh.bar ? [Z('bar', 'ticker', ...sh.bar)] : [];
        const names = zones.map((z) => (gadgets.find((g) => g.id === z.id) || {}).name);
        const what = mainKind === 'video' ? 'vídeo ao vivo' : 'playlist';
        out.push({
          key: `f-${seg}-${mainKind === 'video' ? 'aovivo' : 'playlist'}-${sh.key}`, segment: seg, main: mainKind, family: true,
          label: `${short}: ${what} ${sh.lab}`.slice(0, 60),
          desc: `${segLabel}: ${mainKind === 'video' ? 'o canal ao vivo' : 'a playlist'} ${sh.name} (${join(names)})${bar.length ? ' e o texto rolante' : ''}.`,
          orientation: sh.o, background: '#0b1220',
          zones: [main, ...zones, ...bar],
        });
      }
    }
  }
  return out;
}
/**
 * A zona principal do modelo: a de id "main" ou a maior (o vídeo ao vivo vence quando existe). Para o filtro
 * "Principal: playlist / vídeo ao vivo" da aba Layouts. Devolve 'video', 'playlist' ou 'other'.
 */
export function layoutMainOf(m) {
  const zs = m?.zones || [];
  const z = zs.find((x) => x.id === 'main') || [...zs].sort((a, b) => b.w * b.h - a.w * a.h)[0];
  return z?.kind === 'video' ? 'video' : z?.kind === 'playlist' ? 'playlist' : 'other';
}
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
  { key: 'recepcao', segment: 'recepcao', label: 'Recepção', desc: 'O vídeo, a chamada de senha e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'video', 0, 0, 70, 88), Z('queue', 'queue', 70, 0, 30, 88), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'refeitorio', segment: 'industria', label: 'Refeitório', desc: 'O cardápio do dia, o vídeo e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('menu', 'playlist', 0, 0, 40, 88, { hint: 'widget' }), Z('main', 'video', 40, 0, 60, 88), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'chao-de-fabrica', segment: 'industria', label: 'Chão de fábrica', desc: 'Os indicadores, os dias sem acidente e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('kpis', 'playlist', 0, 0, 65, 88, { hint: 'kpi' }), Z('safety', 'safety', 65, 0, 35, 88), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'totem', segment: 'loja', label: 'Totem em pé', desc: 'Em pé: o vídeo em cima, a playlist embaixo e o texto rolante.', orientation: 'port', background: '#0b1220',
    zones: [Z('main', 'video', 0, 0, 100, 45), Z('content', 'playlist', 0, 45, 100, 45), Z('bar', 'ticker', 0, 90, 100, 10)] },
  // ---------------------------------------------------------------- DIGITAL ISP: layouts com os gadgets, por segmento
  // (sample: o gadget de exemplo que a prévia desenha na zona "Gadget"; o cliente escolhe o dele no editor)
  { key: 'recepcao-relogio-clima', segment: 'recepcao', label: 'Recepção com hora e clima', desc: 'O vídeo, a hora, o clima, um QR code e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'video', 0, 0, 70, 88), Z('clock', 'clock', 70, 0, 30, 30), Z('weather', 'weather', 70, 30, 30, 30), Z('qr', 'qr', 70, 60, 30, 28, { qr: 'https://exemplo.com.br', title: 'Aponte a câmera' }), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'recepcao-agenda', segment: 'recepcao', label: 'Recepção com agenda', desc: 'Conteúdo, a agenda do dia, a hora e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 65, 88), Z('agenda', 'widget', 65, 0, 35, 60, { sample: 'agenda' }), Z('clock', 'widget', 65, 60, 35, 28, { sample: 'clock' }), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'recepcao-em-pe', segment: 'recepcao', label: 'Recepção em pé', desc: 'Em pé: a logomarca, o conteúdo, a agenda e o texto rolante.', orientation: 'port', background: '#0b1220',
    zones: [Z('logo', 'logo', 0, 0, 100, 12), Z('main', 'playlist', 0, 12, 100, 50), Z('agenda', 'widget', 0, 62, 100, 28, { sample: 'agenda' }), Z('bar', 'ticker', 0, 90, 100, 10)] },
  { key: 'loja-vitrine-avaliacoes', segment: 'loja', label: 'Vitrine com avaliações', desc: 'As ofertas grandes, as avaliações dos clientes e o QR code.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 72, 100, { hint: 'media' }), Z('reviews', 'widget', 72, 0, 28, 62, { sample: 'reviews' }), Z('qr', 'qr', 72, 62, 28, 38, { qr: 'https://exemplo.com.br', title: 'Aponte a câmera' })] },
  { key: 'loja-promocao-contador', segment: 'loja', label: 'Promoção com contador', desc: 'As ofertas, a contagem para a promoção acabar e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 68, 88, { hint: 'media' }), Z('countdown', 'countdown', 68, 0, 32, 88), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'loja-totem-promocao', segment: 'loja', label: 'Totem de promoção', desc: 'Em pé: as ofertas, a contagem regressiva e o texto rolante.', orientation: 'port', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 100, 68, { hint: 'media' }), Z('countdown', 'countdown', 0, 68, 100, 22), Z('bar', 'ticker', 0, 90, 100, 10)] },
  { key: 'mercado-duas-ofertas', segment: 'loja', label: 'Duas vitrines de ofertas', desc: 'Dois quadros de ofertas lado a lado e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('left', 'playlist', 0, 0, 50, 88, { hint: 'media' }), Z('right', 'playlist', 50, 0, 50, 88, { hint: 'media' }), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'salao-espera', segment: 'loja', label: 'Salão e barbearia', desc: 'Os serviços e preços, as avaliações dos clientes e a hora.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 65, 88, { hint: 'media' }), Z('reviews', 'widget', 65, 0, 35, 55, { sample: 'reviews' }), Z('clock', 'widget', 65, 55, 35, 33, { sample: 'clock' }), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'farmacia-balcao', segment: 'saude', label: 'Farmácia', desc: 'Ofertas e dicas de saúde, a hora, o clima e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 70, 88), Z('clock', 'clock', 70, 0, 30, 40), Z('weather', 'weather', 70, 40, 30, 48), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'clinica-espera', segment: 'saude', label: 'Sala de espera da clínica', desc: 'O vídeo, a chamada de senha, os médicos do dia e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'video', 0, 0, 65, 88), Z('queue', 'queue', 65, 0, 35, 50), Z('agenda', 'widget', 65, 50, 35, 38, { sample: 'agenda' }), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'clinica-em-pe', segment: 'saude', label: 'Clínica em pé', desc: 'Em pé: a chamada de senha, as dicas de saúde, a hora e o texto rolante.', orientation: 'port', background: '#0b1220',
    zones: [Z('queue', 'queue', 0, 0, 100, 30), Z('main', 'playlist', 0, 30, 100, 50), Z('clock', 'clock', 0, 80, 100, 10), Z('bar', 'ticker', 0, 90, 100, 10)] },
  { key: 'academia-treino', segment: 'academia', label: 'Academia', desc: 'O vídeo de treino, a contagem para a próxima aula e a hora.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'video', 0, 0, 62, 88), Z('countdown', 'countdown', 62, 0, 38, 50), Z('clock', 'widget', 62, 50, 38, 38, { sample: 'clock' }), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'academia-aulas-em-pe', segment: 'academia', label: 'Grade de aulas em pé', desc: 'Em pé: as aulas do dia, as campanhas e o texto rolante.', orientation: 'port', background: '#0b1220',
    zones: [Z('agenda', 'widget', 0, 0, 100, 40, { sample: 'agenda' }), Z('main', 'playlist', 0, 40, 100, 50), Z('bar', 'ticker', 0, 90, 100, 10)] },
  { key: 'escola-patio', segment: 'escola', label: 'Pátio da escola', desc: 'Os avisos, os eventos da semana, o clima e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 60, 88), Z('agenda', 'widget', 60, 0, 40, 50, { sample: 'agenda' }), Z('weather', 'weather', 60, 50, 40, 38), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'escola-em-pe', segment: 'escola', label: 'Escola em pé', desc: 'Em pé: a logomarca, os avisos, as notícias e o texto rolante.', orientation: 'port', background: '#0b1220',
    zones: [Z('logo', 'logo', 0, 0, 100, 12), Z('main', 'playlist', 0, 12, 100, 48), Z('news', 'news', 0, 60, 100, 28), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'escritorio-indicadores', segment: 'corporativo', label: 'Escritório com indicadores', desc: 'O painel de indicadores em cima, os comunicados, a hora e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('kpis', 'widget', 0, 0, 100, 48, { sample: 'dashboard' }), Z('main', 'playlist', 0, 48, 62, 40), Z('clock', 'clock', 62, 48, 38, 40), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'escritorio-fusos', segment: 'corporativo', label: 'Escritório com fusos', desc: 'Os comunicados, o relógio mundial e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 70, 88), Z('clock', 'widget', 70, 0, 30, 32, { sample: 'clock' }), Z('world', 'worldclock', 70, 32, 30, 56), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'sala-reuniao', segment: 'corporativo', label: 'Porta da sala de reunião', desc: 'A agenda da sala, a hora e o clima.', orientation: 'land', background: '#0b1220',
    zones: [Z('agenda', 'widget', 0, 0, 60, 100, { sample: 'agenda' }), Z('clock', 'widget', 60, 0, 40, 55, { sample: 'clock' }), Z('weather', 'weather', 60, 55, 40, 45)] },
  { key: 'sala-reuniao-em-pe', segment: 'corporativo', label: 'Sala de reunião em pé', desc: 'Em pé: o nome da sala, a agenda e a hora.', orientation: 'port', background: '#0b1220',
    zones: [Z('title', 'text', 0, 0, 100, 12, { title: 'Sala de reunião' }), Z('agenda', 'widget', 0, 12, 100, 60, { sample: 'agenda' }), Z('clock', 'widget', 0, 72, 100, 28, { sample: 'clock' })] },
  { key: 'industria-seguranca', segment: 'industria', label: 'Indústria: segurança e metas', desc: 'Os dias sem acidente, o painel de indicadores e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('safety', 'safety', 0, 0, 38, 88), Z('kpis', 'widget', 38, 0, 62, 88, { sample: 'dashboard' }), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'industria-turnos-em-pe', segment: 'industria', label: 'Indústria em pé', desc: 'Em pé: os dias sem acidente, os comunicados, a hora e o texto rolante.', orientation: 'port', background: '#0b1220',
    zones: [Z('safety', 'safety', 0, 0, 100, 30), Z('main', 'playlist', 0, 30, 100, 50), Z('clock', 'clock', 0, 80, 100, 10), Z('bar', 'ticker', 0, 90, 100, 10)] },
  { key: 'provedor-loja', segment: 'provedor', label: 'Loja do provedor', desc: 'O canal ao vivo, os planos, o QR code e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'video', 0, 0, 65, 88), Z('plans', 'playlist', 65, 0, 35, 60, { hint: 'media' }), Z('qr', 'qr', 65, 60, 35, 28, { qr: 'https://exemplo.com.br', title: 'Aponte a câmera' }), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'provedor-vitrine-em-pe', segment: 'provedor', label: 'Vitrine do provedor em pé', desc: 'Em pé: os planos, o QR code e como chegar.', orientation: 'port', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 100, 60, { hint: 'media' }), Z('qr', 'qr', 0, 60, 100, 18, { qr: 'https://exemplo.com.br', title: 'Aponte a câmera' }), Z('dir', 'widget', 0, 78, 100, 22, { sample: 'directions' })] },
  { key: 'igreja-avisos', segment: 'igreja', label: 'Igreja: avisos e programação', desc: 'Os avisos, a programação da semana e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 65, 88), Z('agenda', 'widget', 65, 0, 35, 88, { sample: 'agenda' }), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'igreja-em-pe', segment: 'igreja', label: 'Igreja em pé', desc: 'Em pé: a contagem para o próximo encontro, os avisos e a hora.', orientation: 'port', background: '#0b1220',
    zones: [Z('countdown', 'countdown', 0, 0, 100, 22), Z('main', 'playlist', 0, 22, 100, 58), Z('clock', 'clock', 0, 80, 100, 10), Z('bar', 'ticker', 0, 90, 100, 10)] },
  { key: 'hotel-recepcao', segment: 'hotel', label: 'Recepção de hotel', desc: 'O conteúdo, o relógio mundial, o clima e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 70, 88), Z('world', 'worldclock', 70, 0, 30, 44), Z('weather', 'widget', 70, 44, 30, 44, { sample: 'weather' }), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'hotel-lobby-em-pe', segment: 'hotel', label: 'Lobby de hotel em pé', desc: 'Em pé: a logomarca, o clima com previsão, o conteúdo e como chegar.', orientation: 'port', background: '#0b1220',
    zones: [Z('logo', 'logo', 0, 0, 100, 12), Z('weather', 'widget', 0, 12, 100, 20, { sample: 'weather' }), Z('main', 'playlist', 0, 32, 100, 48), Z('dir', 'widget', 0, 80, 100, 20, { sample: 'directions' })] },
  { key: 'restaurante-salao', segment: 'alimentacao', label: 'Salão do restaurante', desc: 'O vídeo, o cardápio do dia e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'video', 0, 0, 60, 88), Z('menu', 'playlist', 60, 0, 40, 88, { hint: 'widget' }), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'cafeteria-balcao-em-pe', segment: 'alimentacao', label: 'Balcão da cafeteria em pé', desc: 'Em pé: o cardápio com preço, as avaliações e o texto rolante.', orientation: 'port', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 100, 68, { hint: 'media' }), Z('reviews', 'widget', 0, 68, 100, 22, { sample: 'reviews' }), Z('bar', 'ticker', 0, 90, 100, 10)] },
  { key: 'evento-contagem', segment: 'evento', label: 'Evento com contagem', desc: 'A contagem regressiva grande, a hora, o clima, o conteúdo e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('countdown', 'countdown', 0, 0, 60, 62), Z('clock', 'widget', 60, 0, 40, 31, { sample: 'clock' }), Z('weather', 'weather', 60, 31, 40, 31), Z('main', 'playlist', 0, 62, 100, 26), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'noticias-cotacoes', segment: 'geral', label: 'Notícias e cotações', desc: 'As notícias, as cotações, a hora, o clima e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('news', 'news', 0, 0, 50, 88), Z('quotes', 'quotes', 50, 0, 25, 88), Z('clock', 'widget', 75, 0, 25, 44, { sample: 'clock' }), Z('weather', 'weather', 75, 44, 25, 44), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'painel-de-dados', segment: 'geral', label: 'Painel de dados', desc: 'O painel de indicadores, as notícias e as cotações.', orientation: 'land', background: '#0b1220',
    zones: [Z('kpis', 'widget', 0, 0, 100, 60, { sample: 'dashboard' }), Z('news', 'news', 0, 60, 60, 40), Z('quotes', 'quotes', 60, 60, 40, 40)] },
  // ---------------------------------------------------------------- widgets por cima da imagem (overlay: fundo translúcido)
  { key: 'video-relogio-canto', segment: 'geral', label: 'Vídeo com a hora no canto', desc: 'O vídeo em tela cheia e a hora por cima, no canto de cima.', orientation: 'land', background: '#000000',
    zones: [Z('main', 'video', 0, 0, 100, 100), Z('clock', 'widget', 78, 3, 20, 16, { sample: 'clock', overlay: true, opacity: 60 })] },
  { key: 'video-logo-canto', segment: 'geral', label: 'Vídeo com a logomarca no canto', desc: 'O vídeo em tela cheia e a logomarca por cima, como numa emissora de TV.', orientation: 'land', background: '#000000',
    zones: [Z('main', 'video', 0, 0, 100, 100), Z('logo', 'logo', 2, 3, 16, 14, { overlay: true, opacity: 0 })] },
  { key: 'vitrine-relogio-clima', segment: 'loja', label: 'Vitrine com hora e clima por cima', desc: 'As ofertas em tela cheia, com a hora e o clima por cima, nos cantos de cima.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 100, 100, { hint: 'media' }), Z('clock', 'clock', 2, 3, 20, 16, { overlay: true, opacity: 60 }), Z('weather', 'weather', 78, 3, 20, 16, { overlay: true, opacity: 60 })] },
  { key: 'vitrine-qr-canto', segment: 'loja', label: 'Vitrine com QR code por cima', desc: 'As ofertas em tela cheia e o QR code por cima, no canto de baixo.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 100, 100, { hint: 'media' }), Z('qr', 'qr', 82, 62, 16, 34, { qr: 'https://exemplo.com.br', title: 'Aponte a câmera', overlay: true, opacity: 80 })] },
  { key: 'promocao-contador-por-cima', segment: 'loja', label: 'Promoção com contador por cima', desc: 'A oferta em tela cheia e a contagem para a promoção acabar por cima, embaixo.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 100, 100, { hint: 'media' }), Z('countdown', 'countdown', 30, 70, 40, 27, { overlay: true, opacity: 60 })] },
  { key: 'totem-relogio-por-cima', segment: 'loja', label: 'Totem com a hora por cima', desc: 'Em pé: o anúncio em tela cheia, a hora por cima e o texto rolante embaixo.', orientation: 'port', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 100, 90, { hint: 'media' }), Z('clock', 'widget', 55, 2, 42, 9, { sample: 'clock', overlay: true, opacity: 60 }), Z('bar', 'ticker', 0, 90, 100, 10)] },
  // ---------------------------------------------------------------- elevador (telas pequenas de 21" a 32")
  { key: 'elevador-em-pe', segment: 'elevador', label: 'Elevador em pé', desc: 'Em pé: a hora e o clima, os anúncios, as notícias curtas e os avisos do condomínio.', orientation: 'port', background: '#0b1220',
    zones: [Z('clock', 'clock', 0, 0, 50, 12), Z('weather', 'weather', 50, 0, 50, 12), Z('main', 'playlist', 0, 12, 100, 52, { hint: 'media' }), Z('news', 'news', 0, 64, 100, 24), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'elevador-em-pe-condominio', segment: 'elevador', label: 'Elevador do condomínio em pé', desc: 'Em pé: o nome do prédio e a hora, os anúncios, a agenda do condomínio e os avisos.', orientation: 'port', background: '#0b1220',
    zones: [Z('title', 'text', 0, 0, 60, 10, { title: 'Condomínio' }), Z('clock', 'clock', 60, 0, 40, 10), Z('main', 'playlist', 0, 10, 100, 54, { hint: 'media' }), Z('agenda', 'widget', 0, 64, 100, 24, { sample: 'agenda' }), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'elevador-em-pe-simples', segment: 'elevador', label: 'Elevador em pé simples', desc: 'Em pé: a hora, um anúncio grande e os avisos (letra grande para tela pequena).', orientation: 'port', background: '#0b1220',
    zones: [Z('clock', 'widget', 0, 0, 100, 14, { sample: 'clock' }), Z('main', 'playlist', 0, 14, 100, 72, { hint: 'media' }), Z('bar', 'ticker', 0, 86, 100, 14)] },
  { key: 'elevador-deitado', segment: 'elevador', label: 'Elevador deitado', desc: 'Os anúncios, a hora, o clima, as notícias curtas e os avisos.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 65, 86, { hint: 'media' }), Z('clock', 'clock', 65, 0, 35, 26), Z('weather', 'weather', 65, 26, 35, 24), Z('news', 'news', 65, 50, 35, 36), Z('bar', 'ticker', 0, 86, 100, 14)] },
  { key: 'elevador-deitado-cheio', segment: 'elevador', label: 'Elevador deitado em tela cheia', desc: 'Um anúncio em tela cheia com a hora no canto e os avisos embaixo.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 80, 86, { hint: 'media' }), Z('clock', 'widget', 80, 0, 20, 86, { sample: 'clock' }), Z('bar', 'ticker', 0, 86, 100, 14)] },
  // ---------------------------------------------------------------- telas de um conjunto (menu board de várias TVs; ver TVC_LAYOUT_SETS)
  { key: 'menu2d-1', segment: 'alimentacao', set: 'menu-2-deitadas', label: 'Cardápio (TV 1 de 2)', desc: 'O cardápio com preço.', orientation: 'land', background: '#0b1220',
    zones: [Z('title', 'text', 0, 0, 100, 12, { title: 'Cardápio' }), Z('main', 'playlist', 0, 12, 100, 88, { hint: 'media' })] },
  { key: 'menu2d-2', segment: 'alimentacao', set: 'menu-2-deitadas', label: 'Destaques (TV 2 de 2)', desc: 'O vídeo ou a foto do destaque e o QR code.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 75, 100, { hint: 'media' }), Z('qr', 'qr', 75, 0, 25, 100, { qr: 'https://exemplo.com.br', title: 'Aponte a câmera' })] },
  { key: 'menu3d-1', segment: 'alimentacao', set: 'menu-3-deitadas', label: 'Lanches (TV 1 de 3)', desc: 'O título e a vitrine dos lanches.', orientation: 'land', background: '#0b1220',
    zones: [Z('title', 'text', 0, 0, 100, 12, { title: 'Lanches' }), Z('main', 'playlist', 0, 12, 100, 88, { hint: 'media' })] },
  { key: 'menu3d-2', segment: 'alimentacao', set: 'menu-3-deitadas', label: 'Destaque (TV 2 de 3)', desc: 'A promoção do dia em tela cheia.', orientation: 'land', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 100, 100, { hint: 'media' })] },
  { key: 'menu3d-3', segment: 'alimentacao', set: 'menu-3-deitadas', label: 'Bebidas (TV 3 de 3)', desc: 'Bebidas e sobremesas, com o QR code do pedido.', orientation: 'land', background: '#0b1220',
    zones: [Z('title', 'text', 0, 0, 100, 12, { title: 'Bebidas e sobremesas' }), Z('main', 'playlist', 0, 12, 75, 88, { hint: 'media' }), Z('qr', 'qr', 75, 12, 25, 88, { qr: 'https://exemplo.com.br', title: 'Aponte a câmera' })] },
  { key: 'menu4d-1', segment: 'alimentacao', set: 'menu-4-deitadas', label: 'Combos (TV 1 de 4)', desc: 'Os combos.', orientation: 'land', background: '#0b1220',
    zones: [Z('title', 'text', 0, 0, 100, 12, { title: 'Combos' }), Z('main', 'playlist', 0, 12, 100, 88, { hint: 'media' })] },
  { key: 'menu4d-2', segment: 'alimentacao', set: 'menu-4-deitadas', label: 'Lanches (TV 2 de 4)', desc: 'Os lanches.', orientation: 'land', background: '#0b1220',
    zones: [Z('title', 'text', 0, 0, 100, 12, { title: 'Lanches' }), Z('main', 'playlist', 0, 12, 100, 88, { hint: 'media' })] },
  { key: 'menu4d-3', segment: 'alimentacao', set: 'menu-4-deitadas', label: 'Acompanhamentos (TV 3 de 4)', desc: 'Porções e acompanhamentos.', orientation: 'land', background: '#0b1220',
    zones: [Z('title', 'text', 0, 0, 100, 12, { title: 'Acompanhamentos' }), Z('main', 'playlist', 0, 12, 100, 88, { hint: 'media' })] },
  { key: 'menu4d-4', segment: 'alimentacao', set: 'menu-4-deitadas', label: 'Bebidas (TV 4 de 4)', desc: 'Bebidas, sobremesas e o QR code do pedido.', orientation: 'land', background: '#0b1220',
    zones: [Z('title', 'text', 0, 0, 100, 12, { title: 'Bebidas e sobremesas' }), Z('main', 'playlist', 0, 12, 75, 88, { hint: 'media' }), Z('qr', 'qr', 75, 12, 25, 88, { qr: 'https://exemplo.com.br', title: 'Aponte a câmera' })] },
  { key: 'menu2p-1', segment: 'alimentacao', set: 'menu-2-em-pe', label: 'Cardápio (TV 1 de 2, em pé)', desc: 'Em pé: o cardápio com preço.', orientation: 'port', background: '#0b1220',
    zones: [Z('title', 'text', 0, 0, 100, 8, { title: 'Cardápio' }), Z('main', 'playlist', 0, 8, 100, 92, { hint: 'media' })] },
  { key: 'menu2p-2', segment: 'alimentacao', set: 'menu-2-em-pe', label: 'Destaque (TV 2 de 2, em pé)', desc: 'Em pé: o destaque e o QR code.', orientation: 'port', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 100, 82, { hint: 'media' }), Z('qr', 'qr', 0, 82, 100, 18, { qr: 'https://exemplo.com.br', title: 'Aponte a câmera' })] },
  { key: 'menu3p-1', segment: 'alimentacao', set: 'menu-3-em-pe', label: 'Lanches (TV 1 de 3, em pé)', desc: 'Em pé: os lanches.', orientation: 'port', background: '#0b1220',
    zones: [Z('title', 'text', 0, 0, 100, 8, { title: 'Lanches' }), Z('main', 'playlist', 0, 8, 100, 92, { hint: 'media' })] },
  { key: 'menu3p-2', segment: 'alimentacao', set: 'menu-3-em-pe', label: 'Destaque (TV 2 de 3, em pé)', desc: 'Em pé: a promoção do dia.', orientation: 'port', background: '#0b1220',
    zones: [Z('main', 'playlist', 0, 0, 100, 100, { hint: 'media' })] },
  { key: 'menu3p-3', segment: 'alimentacao', set: 'menu-3-em-pe', label: 'Bebidas (TV 3 de 3, em pé)', desc: 'Em pé: bebidas, sobremesas e o QR code.', orientation: 'port', background: '#0b1220',
    zones: [Z('title', 'text', 0, 0, 100, 8, { title: 'Bebidas e sobremesas' }), Z('main', 'playlist', 0, 8, 100, 74, { hint: 'media' }), Z('qr', 'qr', 0, 82, 100, 18, { qr: 'https://exemplo.com.br', title: 'Aponte a câmera' })] },
  // pedido do dono (23/11): boas-vindas no alto com a hora, o clima à esquerda, o principal no meio, as informações à direita e a faixa
  { key: 'boas-vindas-info', segment: 'geral', label: 'Boas-vindas com clima e informações', desc: 'Boas-vindas e hora no alto, clima à esquerda, a playlist no meio, horário de atendimento, Wi-Fi e redes à direita, e o texto rolante.', orientation: 'land', background: '#0b1220',
    zones: [Z('top', 'text', 0, 0, 74, 14, { title: 'Bem-vindo!', text: 'Sua informação, na hora certa.' }), Z('clock', 'clock', 74, 0, 26, 14),
      Z('clima', 'weather', 0, 14, 23, 74), Z('main', 'playlist', 23, 14, 54, 74, { hint: 'media' }),
      Z('info', 'text', 77, 14, 23, 74, { title: 'Informações', text: 'Atendimento: 09:00 às 18:00 · Wi-Fi: Visitantes · Siga-nos @suaempresa' }), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'boas-vindas-info-aovivo', segment: 'geral', label: 'Boas-vindas com clima, informações e vídeo ao vivo', desc: 'O mesmo, com o vídeo ao vivo (HLS) no meio.', orientation: 'land', background: '#0b1220',
    zones: [Z('top', 'text', 0, 0, 74, 14, { title: 'Bem-vindo!', text: 'Sua informação, na hora certa.' }), Z('clock', 'clock', 74, 0, 26, 14),
      Z('clima', 'weather', 0, 14, 23, 74), Z('main', 'video', 23, 14, 54, 74),
      Z('info', 'text', 77, 14, 23, 74, { title: 'Informações', text: 'Atendimento: 09:00 às 18:00 · Wi-Fi: Visitantes · Siga-nos @suaempresa' }), Z('bar', 'ticker', 0, 88, 100, 12)] },
  { key: 'provedor-boas-vindas', segment: 'provedor', label: 'Provedor: boas-vindas com clima e informações', desc: 'Para a loja do provedor: boas-vindas e hora no alto, o QR para assinar à esquerda, os planos na playlist do meio e o Wi-Fi e as redes à direita.', orientation: 'land', background: '#0b1220',
    zones: [Z('top', 'text', 0, 0, 74, 14, { title: 'Bem-vindo!', text: 'Sua informação, na hora certa.' }), Z('clock', 'clock', 74, 0, 26, 14),
      Z('assine', 'qr', 0, 14, 23, 74, { qr: 'https://exemplo.com.br', title: 'Assine já' }), Z('main', 'playlist', 23, 14, 54, 74, { hint: 'media' }),
      Z('info', 'text', 77, 14, 23, 74, { title: 'Informações', text: 'Atendimento: 09:00 às 18:00 · Wi-Fi: Visitantes · Siga-nos @suaempresa' }), Z('bar', 'ticker', 0, 88, 100, 12)] },
  // DIGITAL ISP: os gerados por família (formas × segmento), 4 com a playlist e 4 com o vídeo ao vivo por segmento
  ...familyLayouts(),
].map((m) => Object.freeze({ segment: 'geral', ...m, zones: Object.freeze(m.zones) })));
export const TVC_LAYOUT_MODEL = Object.freeze(Object.fromEntries(TVC_LAYOUT_MODELS.map((m) => [m.key, m])));
export const TVC_LAYOUT_MODEL_KEYS = Object.freeze(TVC_LAYOUT_MODELS.map((m) => m.key));
/** Os segmentos dos layouts (o filtro da aba Layouts). */
export const TVC_LAYOUT_SEGMENTS = Object.freeze([
  { key: 'geral', label: 'Uso geral' }, { key: 'loja', label: 'Loja e varejo' }, { key: 'alimentacao', label: 'Restaurante e lanchonete' },
  { key: 'saude', label: 'Clínica e farmácia' }, { key: 'academia', label: 'Academia' }, { key: 'escola', label: 'Escola' },
  { key: 'recepcao', label: 'Recepção' }, { key: 'corporativo', label: 'Escritório' }, { key: 'industria', label: 'Indústria' },
  { key: 'provedor', label: 'Provedor de internet' }, { key: 'igreja', label: 'Igreja' }, { key: 'hotel', label: 'Hotel' },
  { key: 'elevador', label: 'Elevador e condomínio' }, { key: 'evento', label: 'Evento' },
]);
/**
 * Os conjuntos de várias TVs (menu board de lanchonete e restaurante de shopping, vitrine em painel): uma TV por layout,
 * lado a lado (position 1 = a da esquerda). Cada tela é um layout comum (screens: as chaves em TVC_LAYOUT_MODELS, set:
 * a chave do conjunto); o painel cria um layout por TV e, se o cliente escolher as TVs, uma grade para cada uma (alcance:
 * aquela tela). Nada muda no app da tela: cada TV recebe só o layout dela.
 */
export const TVC_LAYOUT_SETS = Object.freeze([
  { key: 'menu-2-deitadas', label: 'Cardápio em 2 TVs deitadas', desc: 'O cardápio com preço numa TV e o destaque com QR code na outra.', orientation: 'land', segment: 'alimentacao', screens: ['menu2d-1', 'menu2d-2'] },
  { key: 'menu-3-deitadas', label: 'Cardápio em 3 TVs deitadas', desc: 'Lanches, a promoção do dia no meio e bebidas com o QR code do pedido.', orientation: 'land', segment: 'alimentacao', screens: ['menu3d-1', 'menu3d-2', 'menu3d-3'] },
  { key: 'menu-4-deitadas', label: 'Cardápio em 4 TVs deitadas', desc: 'Combos, lanches, acompanhamentos e bebidas, uma categoria por TV.', orientation: 'land', segment: 'alimentacao', screens: ['menu4d-1', 'menu4d-2', 'menu4d-3', 'menu4d-4'] },
  { key: 'menu-2-em-pe', label: 'Cardápio em 2 TVs em pé', desc: 'Em pé: o cardápio numa TV e o destaque com QR code na outra.', orientation: 'port', segment: 'alimentacao', screens: ['menu2p-1', 'menu2p-2'] },
  { key: 'menu-3-em-pe', label: 'Cardápio em 3 TVs em pé', desc: 'Em pé: lanches, a promoção do dia e bebidas com o QR code.', orientation: 'port', segment: 'alimentacao', screens: ['menu3p-1', 'menu3p-2', 'menu3p-3'] },
].map((x) => Object.freeze({ ...x, screens: Object.freeze(x.screens) })));

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
  // datas promocionais do comércio
  { key: 'foto-promo-black-friday', label: 'Foto: Black Friday', tone: 'dark', photo: true },
  { key: 'foto-promo-natal', label: 'Foto: presentes de Natal', tone: 'dark', photo: true },
  { key: 'foto-promo-maes', label: 'Foto: Dia das Mães', tone: 'dark', photo: true },
  { key: 'foto-promo-pais', label: 'Foto: Dia dos Pais', tone: 'dark', photo: true },
  { key: 'foto-promo-criancas', label: 'Foto: Dia das Crianças', tone: 'dark', photo: true },
  { key: 'foto-promo-namorados', label: 'Foto: Dia dos Namorados', tone: 'dark', photo: true },
  { key: 'foto-promo-pascoa', label: 'Foto: Páscoa', tone: 'dark', photo: true },
  { key: 'foto-promo-ano-novo', label: 'Foto: Ano Novo', tone: 'dark', photo: true },
  { key: 'foto-promo-queima', label: 'Foto: queima de estoque', tone: 'dark', photo: true },
  { key: 'foto-promo-verao', label: 'Foto: verão', tone: 'dark', photo: true },
  { key: 'foto-promo-volta-aulas', label: 'Foto: volta às aulas', tone: 'dark', photo: true },
  { key: 'foto-promo-carnaval', label: 'Foto: Carnaval', tone: 'dark', photo: true },
  { key: 'foto-promo-junina', label: 'Foto: festa junina', tone: 'dark', photo: true },
  { key: 'foto-promo-inverno', label: 'Foto: inverno', tone: 'dark', photo: true },
  { key: 'foto-promo-aniversario-loja', label: 'Foto: aniversário da loja', tone: 'dark', photo: true },
  { key: 'foto-promo-dia-cliente', label: 'Foto: Dia do Cliente', tone: 'dark', photo: true },
  // provedor de internet (a vitrine do ISP)
  { key: 'foto-prov-roteador', label: 'Foto: roteador na sala', tone: 'dark', photo: true },
  { key: 'foto-prov-sala-tv', label: 'Foto: sala com TV', tone: 'dark', photo: true },
  { key: 'foto-prov-gamer', label: 'Foto: mesa de jogos', tone: 'dark', photo: true },
  { key: 'foto-prov-home-office', label: 'Foto: trabalho em casa', tone: 'dark', photo: true },
  { key: 'foto-prov-instalacao', label: 'Foto: ferramentas de instalação', tone: 'dark', photo: true },
  { key: 'foto-prov-bobina', label: 'Foto: bobina de fibra', tone: 'dark', photo: true },
  { key: 'foto-prov-cidade', label: 'Foto: cidade conectada', tone: 'dark', photo: true },
  { key: 'foto-prov-datacenter', label: 'Foto: data center', tone: 'dark', photo: true },
  { key: 'foto-prov-streaming', label: 'Foto: sofá e pipoca', tone: 'dark', photo: true },
  { key: 'foto-prov-casa-inteligente', label: 'Foto: casa inteligente', tone: 'dark', photo: true },
  { key: 'foto-prov-estudo', label: 'Foto: mesa de estudo', tone: 'dark', photo: true },
  { key: 'foto-prov-empresa', label: 'Foto: rede da empresa', tone: 'dark', photo: true },
  { key: 'foto-prov-rural', label: 'Foto: casa no campo', tone: 'dark', photo: true },
  { key: 'foto-prov-poste', label: 'Foto: poste com fibra', tone: 'dark', photo: true },
  { key: 'foto-prov-velocidade', label: 'Foto: luzes em alta velocidade', tone: 'dark', photo: true },
  { key: 'foto-prov-suporte', label: 'Foto: fone de suporte', tone: 'dark', photo: true },
  { key: 'foto-prov-sinal', label: 'Foto: ondas de sinal', tone: 'dark', photo: true },
  { key: 'foto-prov-celular', label: 'Foto: celular na mesa', tone: 'dark', photo: true },
  { key: 'foto-prov-seguranca', label: 'Foto: cadeado e rede', tone: 'dark', photo: true },
  { key: 'foto-prov-mudanca', label: 'Foto: caixas de mudança', tone: 'dark', photo: true },
  // uso interno da empresa (comunicação interna)
  { key: 'foto-aniversario-baloes', label: 'Foto: balões de aniversário', tone: 'dark', photo: true },
  { key: 'foto-aniversario-bolo', label: 'Foto: bolo de aniversário', tone: 'dark', photo: true },
  { key: 'foto-aniversario-presentes', label: 'Foto: presentes e confete', tone: 'dark', photo: true },
  { key: 'foto-aniversario-cupcakes', label: 'Foto: cupcakes na mesa', tone: 'dark', photo: true },
  { key: 'foto-aviso-megafone', label: 'Foto: megafone', tone: 'dark', photo: true },
  { key: 'foto-aviso-mural', label: 'Foto: mural de recados', tone: 'dark', photo: true },
  { key: 'foto-escritorio', label: 'Foto: escritório', tone: 'dark', photo: true },
  { key: 'foto-seguranca-epi', label: 'Foto: EPI na bancada', tone: 'dark', photo: true },
  { key: 'foto-fabrica', label: 'Foto: chão de fábrica', tone: 'dark', photo: true },
  { key: 'foto-recepcao', label: 'Foto: recepção da empresa', tone: 'dark', photo: true },
  { key: 'foto-boas-vindas', label: 'Foto: mesa de boas-vindas', tone: 'dark', photo: true },
  { key: 'foto-reconhecimento', label: 'Foto: troféu e medalha', tone: 'dark', photo: true },
  { key: 'foto-metas', label: 'Foto: gráfico de metas', tone: 'dark', photo: true },
  { key: 'foto-confraternizacao', label: 'Foto: confraternização', tone: 'dark', photo: true },
  { key: 'foto-natal', label: 'Foto: árvore de Natal', tone: 'dark', photo: true },
  { key: 'foto-vagas', label: 'Foto: mesa vaga', tone: 'dark', photo: true },
  { key: 'foto-treinamento', label: 'Foto: sala de treinamento', tone: 'dark', photo: true },
  { key: 'foto-refeitorio', label: 'Foto: prato do almoço', tone: 'dark', photo: true },
  { key: 'foto-bem-estar', label: 'Foto: bem-estar', tone: 'dark', photo: true },
  { key: 'foto-sustentabilidade', label: 'Foto: broto de planta', tone: 'dark', photo: true },
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
  // o tamanho de cada elemento (vazio = médio, o de sempre): QR code, selo do preço, foto ou iniciais e título
  ...['qrSize', 'priceSize', 'photoSize', 'titleSize'].map((key, i) => F(key, ['Tamanho do QR code', 'Tamanho do preço', 'Tamanho da foto ou das iniciais', 'Tamanho do título'][i], 'choice',
    { options: ['s', 'l', 'xl'], labels: ['Pequeno', 'Grande', 'Muito grande'] })),
]);
/** Os campos de tamanho dos elementos (a prévia vira classe tvc-<campo sem Size>-<valor>). */
export const TVC_SIZE_FIELDS = Object.freeze(['qrSize', 'priceSize', 'photoSize', 'titleSize']);
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
  { key: 'clock', label: 'Relógio' },
  { key: 'weather', label: 'Clima e previsão' },
  { key: 'agenda', label: 'Agenda e salas' },
  { key: 'dashboard', label: 'Painel de indicadores' },
  { key: 'reviews', label: 'Avaliações e depoimentos' },
  { key: 'directions', label: 'Como chegar' },
  { key: 'web', label: 'Página da internet' },
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
