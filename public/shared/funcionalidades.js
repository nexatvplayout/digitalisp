// Catálogo dos MÓDULOS do DIGITAL ISP: o que um plano de revenda libera. Base herdada do catálogo do NEXA Broadcast (c51d2469),
// com a mesma estrutura e as mesmas funções; as seções e os módulos são do DIGITAL ISP.
// por plano"). O mesmo arquivo serve o servidor (as guardas das rotas e das tarefas de fundo, server/funcionalidades.js), o
// Superadmin (os perfis de funcionalidades e os planos) e o painel do cliente (o menu e os trechos das telas que somem).
// Sem DOM e sem dependências: só dados e funções puras.
//
// Pedido do usuário (22/10): "em superadmin, permita criar perfis de novos usuários, selecionando as funcionalidades que serão
// liberadas 1 a 1, em cada menu... Todos serão 1 canal, porém com as funcionalidades liberadas."
//
// Árvore: seção do menu do painel → item do menu (cada data-view) → funcionalidades de dentro da tela.
//   - O item do menu é ele mesmo uma funcionalidade (a chave dele libera a tela); as de dentro dependem dele (requires).
//   - core: sempre incluída (a base de um canal: Playout, Grade, Mídia, Ajustes, Usuários, Plano e uso…); não se desliga.
//   - legacy: como resolver um plano ANTIGO (gravado antes deste catálogo, só com os 10 recursos de antes) ou um pedido pela
//     API que não cita a chave: uma das 10 chaves antigas (herda o valor dela) ou true (era livre para todos: continua).
//     Nada muda para quem já é cliente: o que estava liberado continua, o que estava fora continua fora.
//   - routes: as rotas que a funcionalidade guarda no servidor (403 feature_unavailable, o mesmo do feature() de sempre).
//       "MÉTODOS CAMINHO": MÉTODOS = * ou GET|POST|…; [ch] = /api ou /api/c/<canal> (rotas do canal); {ch} = o canal pelo
//       endereço (o dono do canal é quem conta); :x = um trecho; * no fim = o caminho e tudo abaixo dele.
//       Objeto { r: 'MÉTODOS CAMINHO', body: { campo: [valores] } }: só quando o corpo JSON traz um desses valores.
//   - clienteRoutes: como routes, mas só para o CLIENTE FINAL (o plano dele vem da revenda, server/contas.js): o que o plano
//       do cliente desliga ele não cria nem altera; a revenda e as contas diretas seguem como antes (os planos delas não citam).
//   - config: chaves da configuração do canal (PUT /config) que só LIGAM com a funcionalidade (desligar sempre pode).
//   - panel: seletores CSS dos trechos das telas do painel que somem sem a funcionalidade (o menu some pelo views).
//   - app: as chaves de "features" que os apps (site, celular, TVs) recebem desligadas sem a funcionalidade.
//   - jobs: as tarefas de fundo que não rodam para o cliente sem a funcionalidade (texto para o resumo).
//   - guards: as conferências que ficam no código da rota (não pelo caminho): o corpo, o protocolo, o WebSocket… (texto).
//   - optIn: um MODO que muda o painel do cliente (o modo prefeitura, docs/TELAS.md, e a TV Corporativa,
//     docs/TV-CORPORATIVA.md, que não esconde nada): só vale quando o plano (ou o
//     perfil dele) o cita ligado. Fica FORA do "tudo liberado" (allFeatures: o plano Ilimitado, o cliente padrão, o Liberar
//     tudo do Superadmin e o rascunho Broadcast), porque ligar o modo também ESCONDE telas (o Comercial). Exceção: o plano
//     Ilimitado vem com TUDO ligado, o modo também (everyFeature), e nele o Comercial continua no menu.
// Rebaixar de plano não apaga nada nem desliga o que já está no ar: some do menu, as rotas recusam, as tarefas de fundo param
// e o que já estava ligado no canal (ex.: SCTE-35, 5.1) continua como está até alguém desligar.

/** As 10 chaves de antes deste catálogo (planos antigos, testes e scripts que chamam a API). */
export const LEGACY_KEYS = ['app', 'shop', 'polls', 'scte', 'graphics', 'rtmpIngest', 'customDomain', 'api', 'vod', 'audience'];

/** Seções do menu do painel (data-sec de public/admin/index.html), na ordem do menu. */
export const SECTIONS = [
  {
    id: 'telas', label: 'Telas',
    menus: [
      { key: 'tvcorp', label: 'Telas e conteúdo', views: ['tvcorp'], core: true, desc: 'A base: cadastro das telas, mídias, playlists, layouts, grade, comandos remotos, funcionamento sem internet e relatórios de exibição.' },
      { key: 'mapa', label: 'Mapa das telas', desc: 'Todas as telas no mapa com o estado de cada uma (no ar, fora do ar, desatualizada), para a revenda e para o cliente final.' },
      { key: 'alertas', clienteRoutes: ['POST|PUT|PATCH|DELETE /api/tvcorp/rede/alerts*'], label: 'Alerta em tela cheia', desc: 'Aviso de emergência (evacuação, falta de energia) por tela, grupo ou raio no mapa, por cima de tudo.' },
      { key: 'aprovacao', clienteRoutes: ['POST|PUT|PATCH|DELETE /api/tvcorp/rede/approvals*'], label: 'Aprovação de conteúdo', desc: 'O que o cliente final sobe espera a revenda aprovar antes de ir para as telas.' },
    ],
  },
  {
    id: 'conteudo', label: 'Conteúdo',
    menus: [
      { key: 'templates', label: 'Templates prontos', desc: 'A biblioteca de templates por segmento (varejo, alimentação, saúde, serviços, indústria), editáveis no navegador.' },
      { key: 'aoVivo', clienteRoutes: ['POST|PUT|PATCH|DELETE /api/hls*'], label: 'Ao vivo (HLS)', desc: 'Um canal ao vivo numa zona da tela: NEXA Broadcast, IPTV do provedor, câmera ou qualquer endereço HLS.' },
      { key: 'paginas', label: 'Páginas e painéis', desc: 'Página da internet ou painel (Power BI, Looker Studio, Grafana) numa zona da tela.' },
      { key: 'dados', clienteRoutes: ['POST|PUT|PATCH|DELETE /api/tvcorp/feeds*', 'POST|PUT|PATCH|DELETE /api/tvcorp/widgets*'], label: 'Notícias, clima e cotações', desc: 'Dados automáticos: notícias com crédito, clima, cotações, RSS da empresa e planilha publicada.' },
      { key: 'indicadores', clienteRoutes: ['POST|PUT|PATCH|DELETE /api/tvcorp/kpis*'], label: 'Indicadores e metas', desc: 'Números da empresa na tela, atualizados à mão ou pela API.' },
      { key: 'rh', clienteRoutes: ['POST|PUT|PATCH|DELETE /api/tvcorp/people*'], label: 'Comunicação interna e RH', desc: 'Comunicados, aniversariantes, dias sem acidente e cardápio da semana.' },
      { key: 'celular', clienteRoutes: ['POST|PUT|PATCH|DELETE /api/tvcorp/mobile*', 'POST|PUT|PATCH|DELETE /api/tvcorp/suggestions*'], label: 'Envio pelo celular', desc: 'Link para o colaborador ou o cliente final mandar foto e aviso pelo celular, com aprovação.' },
    ],
  },
  {
    id: 'atendimento', label: 'Atendimento',
    menus: [
      { key: 'senhas', label: 'Senhas e chamada falada', desc: 'Fila com senha, guichês, totem e chamada falada na tela, para clínicas e atendimento.' },
    ],
  },
  {
    id: 'revenda', label: 'Revenda e integração',
    menus: [
      { key: 'marcaPropria', label: 'Marca própria', legacy: 'customDomain', desc: 'Logo, cores e domínio da revenda no painel, nos links e na abertura das telas (white-label).' },
      { key: 'relatorioAnunciante', label: 'Relatório para anunciante', desc: 'A revenda vende espaço nas telas e manda ao anunciante o relatório de exibição em PDF, com a marca dela.' },
      { key: 'avisosWhatsapp', label: 'Avisos por WhatsApp', desc: 'Aviso quando uma tela cai ou volta, para a revenda e, se ela quiser, para o cliente final.' },
      { key: 'api', label: 'API e webhooks', legacy: 'api', desc: 'Publicar mensagens, campanhas, preços e indicadores pelo sistema da empresa; avisos automáticos de tela caiu e voltou.' },
    ],
  },
  {
    id: 'modos', label: 'Modos especiais',
    menus: [
      { key: 'prefeitura', label: 'Modo órgão público', views: ['prefeitura'], optIn: true, routes: ['* /api/prefeitura*'], guards: ['/api/telas/* (a TV box, pelo token do aparelho; server/telas.js)', '/api/reparticao/* e /reparticao/<link> (o link de controle da repartição)', '/api/totem* e /reparticao/<token>/totem (o totem de senhas; server/telas-senha.js)'], desc: 'Painel da Prefeitura: repartições, regiões, mapa do município, alertas por alcance, senhas, salas, desaparecidos, botão de pânico e link de controle de cada repartição. Só liga de propósito.' },
    ],
  },
];

/* ------------------------------------------------------------------ índices */
/** Lista plana: { key, label, desc, section, menu (chave do item do menu; o próprio para um item), level: 'menu'|'feature', ... }. */
export const FEATURES = [];
for (const s of SECTIONS) {
  for (const m of s.menus) {
    const { features: subs = [], ...menu } = m;
    FEATURES.push({ ...menu, section: s.id, menu: m.key, level: 'menu', requires: menu.requires || [] });
    for (const f of subs) {
      // a de dentro da tela depende do item do menu (exceto do item sempre incluído, que não se desliga, e da que vale sozinha:
      // standalone, uma das 10 de antes que já era conferida sem o item do menu, ex.: o VOD no diretório do app NEXA)
      const req = new Set([...(f.requires || []), ...(m.core || f.standalone ? [] : [m.key])]);
      FEATURES.push({ ...f, section: s.id, menu: m.key, level: 'feature', views: [], requires: [...req] });
    }
  }
}
export const BY_KEY = Object.fromEntries(FEATURES.map((f) => [f.key, f]));
/** Todas as chaves (inclusive as sempre incluídas). */
export const ALL_KEYS = FEATURES.map((f) => f.key);
/** As chaves que um plano escolhe (sem as sempre incluídas). */
export const FEATURE_KEYS = FEATURES.filter((f) => !f.core).map((f) => f.key);
export const CORE_KEYS = FEATURES.filter((f) => f.core).map((f) => f.key);
/** Os modos (optIn): só valem citados ligados no plano; ficam fora do "tudo liberado". */
export const OPT_IN_KEYS = FEATURES.filter((f) => f.optIn).map((f) => f.key);
/** data-view -> chave que libera a tela. */
export const VIEW_FEATURE = Object.fromEntries(FEATURES.flatMap((f) => (f.views || []).map((v) => [v, f.key])));

const own = (o, k) => Boolean(o) && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/**
 * O conjunto completo e coerente de um plano: { chave: boolean } para TODAS as chaves do catálogo.
 * input: o que está gravado no plano (ou veio pela API). Chave citada vale como veio; chave ausente segue a regra legacy
 * (plano antigo e pedido antigo: nada muda). Depois as dependências: sem o item do menu (ou o requires), a de dentro fica fora.
 */
export function resolveFeatures(input) {
  const raw = {};
  const memo = new Map();
  const base = (k, seen = new Set()) => {
    if (memo.has(k)) return memo.get(k);
    const f = BY_KEY[k];
    let v;
    if (!f) v = false;
    else if (f.core) v = true;
    else if (own(input, k)) v = Boolean(input[k]);
    else if (typeof f.legacy === 'string' && !seen.has(k)) v = base(f.legacy, new Set([...seen, k]));
    else v = f.legacy === true;
    memo.set(k, v);
    return v;
  };
  for (const k of ALL_KEYS) raw[k] = base(k);
  const out = {};
  const ok = (k, seen = new Set()) => {
    if (own(out, k)) return out[k];
    if (seen.has(k)) return raw[k];
    const f = BY_KEY[k];
    const v = Boolean(raw[k]) && (f?.requires || []).every((r) => ok(r, new Set([...seen, k])));
    out[k] = v;
    return v;
  };
  for (const k of ALL_KEYS) ok(k);
  return out;
}

/** Tudo liberado (plano Ilimitado e o cliente padrão da instalação), menos os modos (optIn: só ligados de propósito). */
export const allFeatures = () => Object.fromEntries(ALL_KEYS.map((k) => [k, !BY_KEY[k].optIn]));
/** Tudo mesmo, com os modos (optIn): só o plano Ilimitado, que por regra vem com todas as funcionalidades ligadas. */
export const everyFeature = () => Object.fromEntries(ALL_KEYS.map((k) => [k, true]));
/** allFeatures + os modos que o conjunto dado cita ligados (o cliente padrão num plano com o modo prefeitura). */
export const allFeaturesWith = (features) => ({ ...allFeatures(), ...Object.fromEntries(OPT_IN_KEYS.map((k) => [k, Boolean(features?.[k])])) });

/** As chaves que dependem de k (direta ou indiretamente): desligar k as desliga. */
export function dependentsOf(k) {
  const out = new Set();
  const walk = (x) => { for (const f of FEATURES) if (f.requires.includes(x) && !out.has(f.key)) { out.add(f.key); walk(f.key); } };
  walk(k);
  return [...out];
}
/** As chaves de que k depende (direta ou indiretamente): ligar k as liga. */
export function requirementsOf(k) {
  const out = new Set();
  const walk = (x) => { for (const r of BY_KEY[x]?.requires || []) if (!out.has(r)) { out.add(r); walk(r); } };
  walk(k);
  return [...out];
}

/** A tela (data-view) está liberada pelo conjunto? Tela fora do catálogo: sim. */
export const viewAllowed = (features, view) => {
  const k = VIEW_FEATURE[view];
  return !k || BY_KEY[k].core || Boolean(features?.[k]);
};

/** Seletores do painel que somem com este conjunto. */
export const hiddenSelectors = (features) => FEATURES.filter((f) => !f.core && !features?.[f.key]).flatMap((f) => f.panel || []);

/**
 * Resumo do que o cliente vê: por seção, os itens do menu liberados com as funcionalidades de dentro (liberadas e fora).
 * [{ section, label, menus: [{ key, label, core, on, features: [{ key, label, on }] }] }]
 */
export function summary(features) {
  const f = resolveFeatures(features);
  return SECTIONS.map((s) => ({
    section: s.id, label: s.label,
    menus: s.menus.map((m) => ({
      key: m.key, label: m.label, core: Boolean(m.core), on: f[m.key],
      features: (m.features || []).map((x) => ({ key: x.key, label: x.label, on: f[x.key] })),
    })),
  }));
}

/** Etiqueta da chave para as mensagens ("Seu plano X não inclui <etiqueta>"). */
export const featureLabel = (k) => BY_KEY[k]?.label || k;
