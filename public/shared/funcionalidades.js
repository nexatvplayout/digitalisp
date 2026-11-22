// Catálogo das funcionalidades do NEXA Broadcast: a fonte única do que um plano libera (docs/PLATAFORMA.md, "Funcionalidades
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
    id: 'operacao', label: 'Operação',
    menus: [
      { key: 'playout', label: 'Playout', views: ['playout'], core: true, desc: 'O canal 24 horas no ar: a programação, o transporte (pausar, pular, retomar) e o motor.' },
      { key: 'painel', label: 'Painel', views: ['dashboard'], legacy: true, desc: 'O resumo do canal: o que está no ar, espectadores, chat e o motor.' },
      {
        key: 'aovivo', label: 'AO VIVO (mesa)', views: ['aovivo'], legacy: true,
        desc: 'A mesa AO VIVO: até 12 fontes, prévia e programa, transições, cartelas, mixer de áudio e o plantão por cima da programação.',
        // encerrar (DELETE) sempre pode: quem saiu do plano com um ao vivo no ar ainda volta à programação
        routes: ['GET|POST|PUT|PATCH [ch]/plantao*', 'GET|POST|PUT|PATCH [ch]/mesa*', 'GET|POST|PUT|PATCH [ch]/luts*', '* [ch]/atem/*', 'GET /api/mesa/cams', 'POST [ch]/live', 'PUT [ch]/atraso', 'POST [ch]/atraso/*'],
        panel: ['#view-playout .livebar:has(#liveGo) > :not(#liveBack):not(#plEnd)', '#atrasoSlot'],
        features: [
          {
            key: 'plantaoCelular', label: 'Plantão pelo celular', legacy: true,
            desc: 'A câmera do celular (página /aovivo e app de controle) entra na mesa ou direto no ar.',
            routes: [{ r: 'POST [ch]/plantao', body: { self: [true] } }, { r: 'POST [ch]/plantao/cue', body: { self: [true] } }],
            app: ['aovivo'],
          },
          {
            key: 'rtmpIngest', label: 'Entradas RTMP (ATEM, OBS e encoders)', legacy: null,
            guards: ['a chave RTMP só vale de cliente ativo com ela (tenancy.ingestAllowed)', 'a fonte RTMP no plantão e na mesa (index.js plantaoSource)'],
            desc: 'Fontes RTMP do estúdio: recepção, chave por fonte e a entrada delas no ar e na mesa.',
            routes: ['POST /api/ingests', 'POST /api/ingests/:id/bridge-token'],
            panel: ['#view-entradas .card:has(#ingForm)'],
          },
          {
            key: 'entradasSrt', label: 'Entradas ao vivo por endereço (SRT, UDP, HLS)', legacy: true,
            desc: 'O sinal ao vivo de um endereço externo (srt://, udp://, https://) com horário na programação.',
            routes: ['POST /api/media/live'],
            panel: ['#view-entradas .card:has(#liveItemForm)'],
          },
          {
            key: 'parceiros', label: 'Canais parceiros (entradas de sinal)', legacy: true,
            desc: 'A retransmissão contínua do sinal de um canal parceiro ou de outra emissora.',
            routes: ['POST /api/media/signal', 'PUT /api/media/:id/signal'],
            panel: ['#sigCard'],
          },
          {
            key: 'modosEntrada', label: 'Modos BYPASS e URGENTE', legacy: true,
            desc: 'Escolher o modo de entrada do ao vivo (selo, logomarca e volta próprios do BYPASS e do URGENTE).',
            routes: [{ r: 'POST [ch]/plantao', body: { mode: ['bypass', 'urgent'] } }, { r: 'POST [ch]/plantao/mode', body: { mode: ['bypass', 'urgent'] } }],
          },
        ],
      },
      {
        key: 'teleprompter', label: 'Teleprompter', views: ['teleprompter'], legacy: true,
        desc: 'Roteiros, a tela da câmera e o controle por endereço com chave.',
        routes: ['* [ch]/prompter*', '* /prompter/{ch}/*'],
      },
      { key: 'monitor', label: 'Monitor', views: ['monitor'], legacy: true, desc: 'O painel do sinal: multiview, encoder e o que sai.' },
      {
        key: 'monitoramento', label: 'Monitoramento', views: ['monitoramento'], legacy: true,
        desc: 'A parede de monitores (entradas, programa e saídas) com alarme e TIME CODE.',
        routes: ['* [ch]/monitoramento*'],
      },
      {
        key: 'saude', label: 'Saúde do sinal', views: ['saude'], legacy: true,
        desc: 'Os alarmes do sinal, o histórico e os avisos por e-mail.',
        routes: ['PUT [ch]/health/thresholds', '* /api/alerts*'],
      },
      {
        key: 'telemetria', label: 'Telemetria (scopes)', views: ['scopes'], legacy: true,
        desc: 'Scopes, áudio, multiviewer, análise do transport stream (TR 101 290), QC de arquivos e sinais de teste.',
        routes: ['* [ch]/ts*', '* /api/qc/*', '* /api/telemetria/*'],
      },
      {
        key: 'relatorios', label: 'Relatórios', views: ['relatorios'], legacy: true,
        desc: 'Loudness do ar (Portaria 354), as-run e direitos de exibição.',
        routes: ['* [ch]/asrun*', '* [ch]/loudness*', 'GET /api/direitos'],
      },
      {
        key: 'eas', label: 'Alertas de emergência (EAS)', views: ['alertas'], legacy: true,
        desc: 'Defesa Civil, INMET e alerta manual levados ao ar.',
        routes: ['POST /api/eas/hook/{ch}*', '* [ch]/eas*'],
        jobs: ['a consulta dos alertas da Defesa Civil e do INMET'],
      },
      {
        key: 'censura', label: 'Censura (arquivo legal)', views: ['censura'], legacy: true,
        desc: 'A gravação do que foi ao ar, a timeline da programação exibida, retenções e a lixeira com senha.',
        // a lixeira e os vídeos da censura na Mídia continuam: quem saiu do plano ainda apaga o que gravou (o espaço conta no plano)
        routes: ['* [ch]/arquivo*', 'PUT [ch]/censura'],
        jobs: ['a gravação do ar para o arquivo legal'],
      },
    ],
  },
  {
    id: 'programacao', label: 'Programação',
    menus: [
      { key: 'grade', label: 'Grade (agenda e lista em loop)', views: ['grade'], core: true, desc: 'A programação: agenda semanal por horário e a lista em loop.' },
      {
        key: 'automacao', label: 'Automação', views: ['automacao'], legacy: true,
        desc: 'A Mesa de Automação: trilhas por horário de grade, intervalos, CG, alertas e roteamento.',
        routes: ['* [ch]/automacao/*'],
      },
      {
        key: 'imersao', label: 'Imersão (4DX)', views: ['fx4d'], legacy: true,
        desc: 'Os efeitos de imersão (luz, vento, vibração) sincronizados com o vídeo nos aparelhos compatíveis.',
        routes: ['* [ch]/fx4d*', '* /api/media/:id/fx4d*', '* /api/app/fx4d/*'],
      },
      {
        key: 'midia', label: 'Mídia', views: ['midia'], core: true,
        desc: 'A biblioteca: envio, conversão, loudness, coleções, ficha e a lixeira.',
        features: [
          {
            key: 'importarLink', label: 'Importar por link', legacy: true,
            desc: 'Trazer vídeos do YouTube, Facebook, Instagram, TikTok, X e Vimeo pelo endereço.',
            routes: ['POST /api/media/imports'],
            panel: ['#impForm'],
          },
          {
            key: 'legendasIa', label: 'Legendas por IA (português)', legacy: true,
            desc: 'A transcrição automática em português, o editor de legendas e o Closed Caption no ar.',
            routes: ['PUT /api/legendas-ia', 'POST /api/media/:id/legendas', 'POST /api/legendas/regerar-todas*'],
            panel: ['#cfgLegendas', '#cfgLegRegen'],
            jobs: ['a transcrição automática das legendas'],
          },
          {
            key: 'legendasIdiomas', label: 'Legendas em outros idiomas', legacy: true, requires: ['legendasIa'],
            desc: 'A tradução das legendas para os 10 idiomas dos apps (inglês, espanhol, francês…).',
            routes: ['PUT /api/legendas-idiomas', 'POST /api/media/:id/legendas/idiomas*', 'PUT /api/media/:id/legendas/idiomas/*'],
            panel: ['#cfgLegIdiomas'],
            jobs: ['a tradução das legendas'],
          },
          {
            key: 'bipe', label: 'Bipe nos palavrões', legacy: true,
            desc: 'O "piii" nos palavrões no ar, nas Saídas e no VOD dos apps, com o dicionário da organização.',
            routes: ['PUT /api/bipe', 'POST /api/media/:id/bipes', 'PUT /api/media/:id/bipes'],
            config: ['audio.bleep.own', 'audio.bleep.social'],
            panel: ['#view-audio .label:has(#auBleepOwn)', '#view-audio .label:has(#auBleepOwn) + p', '#view-audio .label:has(#auBleepSocial)', '#view-audio .label:has(#auBleepSocial) + p', '#view-audio .bp-dict'],
            jobs: ['a procura e a gravação do bipe nos vídeos', 'a cópia com bipe do VOD'],
          },
          {
            key: 'legendaAsteriscos', label: 'Palavrões com **** na legenda', legacy: true,
            desc: 'Os palavrões do dicionário saem com asteriscos no Closed Caption do ar e no VOD.',
            config: ['audio.bleep.legenda'],
            panel: ['#view-audio .label:has(#auBleepCc)', '#view-audio .label:has(#auBleepCc) + p'],
            jobs: ['a legenda com asteriscos do VOD'],
          },
          {
            key: 'upmix51', label: '5.1 convertido do estéreo', legacy: true, requires: ['surround'],
            desc: 'A trilha 5.1 gerada do estéreo (voz no centro, ambiente atrás), por vídeo ou automática no acervo.',
            routes: [{ r: 'POST /api/media/:id/upmix51', bodyNot: { op: ['remove'] } }, 'PUT /api/media/upmix51/auto'],
            panel: ['#view-audio .label:has(#au51auto)', '#au51autoNote', '#s51Auto'],
            jobs: ['a conversão automática do acervo para 5.1'],
          },
          {
            key: 'classind', label: 'Classificação indicativa (ClassInd)', legacy: true,
            desc: 'O selo no ar por horário, a chamada de programação, a prova de exibição e o relatório de autoclassificação.',
            routes: ['PUT /api/classind/config', 'GET /api/classind/relatorio', 'GET [ch]/classind/selo', 'PUT /api/media/:id/chamada'],
            panel: ['#view-relatorios [data-tab=classind]'],
          },
          {
            key: 'classindIa', label: 'Classificação indicativa por IA', legacy: true, requires: ['classind'],
            desc: 'A sugestão da classificação pela IA a partir do áudio e das imagens do programa.',
            routes: ['PUT /api/classind-ia', 'POST /api/media/:id/classind-ia*', 'DELETE /api/media/:id/classind-ia'],
            panel: ['#cfgClassindIa'],
            jobs: ['a análise da classificação pela IA'],
          },
          {
            key: 'cueSheet', label: 'Cue sheet e relatório do ECAD', legacy: true,
            desc: 'As músicas de cada vídeo (importadas da edição ou de planilha), a biblioteca de obras e a programação musical exibida para o ECAD.',
            routes: ['PUT /api/media/:id/cue-sheet', 'POST /api/media/:id/cue-sheet/import', 'POST /api/cue-works', 'PATCH /api/cue-works/:id', 'PUT /api/cue-works/:id/audio', 'POST /api/cue-works/:id/audio/print', 'POST /api/media/:id/cue-sheet/detect', 'PUT /api/cue-sheet/settings', 'GET [ch]/cue-sheet/relatorio'],
            jobs: ['a detecção automática das músicas'],
            panel: ['#view-relatorios [data-tab=ecad]', '.md-cue'],
          },
        ],
      },
      {
        key: 'lojaConteudos', label: 'Loja de conteúdos', views: ['loja'], legacy: true,
        desc: 'Programas, séries e filmes da plataforma licenciados para o canal.',
        routes: ['GET /api/loja', 'GET /api/loja/titulos*', 'POST /api/loja/titulos*', '* /api/loja/pedidos*', 'GET /api/loja/licencas*', 'GET /api/loja/termos/*', 'GET /api/loja/docs/*'],
      },
      {
        key: 'intervalos', label: 'Intervalos', views: ['intervalos'], legacy: true,
        desc: 'As regras de comerciais e vinhetas na troca entre programas.',
        routes: ['PUT [ch]/breaks'],
      },
      {
        key: 'comercial', label: 'Comercial', views: ['comercial'], legacy: true,
        desc: 'Anunciantes, campanhas, vendido × exibido e o comprovante de exibição.',
        routes: ['* /api/comercial*'],
      },
      {
        key: 'vitrine', label: 'Vitrine (produtos na tela)', views: ['produtos'], legacy: true,
        desc: 'Os produtos mostrados no ar e no player, com as deixas na programação.',
        routes: ['POST /api/products', 'PATCH /api/products/:id', 'DELETE /api/products/:id', 'POST /api/products/upload', 'POST|PATCH|DELETE [ch]/cues*', 'POST [ch]/products/push'],
        panel: ['#view-playout .shopbar'],
      },
    ],
  },
  {
    id: 'jornalismo', label: 'Jornalismo',
    menus: [
      {
        key: 'redacao', label: 'Redação', views: ['redacao'], legacy: true,
        desc: 'Espelhos, laudas, pautas e agências de notícias.',
        routes: ['* [ch]/espelhos*', '* [ch]/itens/*', '* /api/redacao/*'],
      },
    ],
  },
  {
    id: 'sinal', label: 'Sinal do canal',
    menus: [
      {
        key: 'graphics', label: 'Gráficos (logomarca, faixa e tarja)', views: ['graficos'], legacy: null, desc: 'A logomarca, o texto rolante e a tarja no ar.',
        guards: ['PUT [ch]/config com o bloco graphics', 'POST [ch]/graphics/upload', 'o CG e as cartelas (feature("graphics") de sempre)'],
      },
      {
        key: 'cg', label: 'Gerador de caracteres', views: ['cg'], legacy: 'graphics', requires: ['graphics'],
        desc: 'O CG: páginas, sequências, dados ao vivo, placar e redes sociais no ar.',
        routes: ['POST|PUT|DELETE [ch]/cg*', 'GET [ch]/cg/export', 'GET [ch]/cg/assets', 'GET [ch]/cg/geocode', 'GET [ch]/cg/tse/*', '* /cg-out/{ch}/*', '* /cg-ctl/{ch}/*'],
        panel: ['#cfgCg'],
      },
      {
        key: 'cartelas', label: 'Cartelas (L-bar)', views: ['cartelas'], legacy: 'graphics', requires: ['graphics'],
        desc: 'As cartelas L-bar: biblioteca, desenho e MOSTRAR/OCULTAR.',
        routes: ['POST|PUT|DELETE [ch]/cartelas*'],
        panel: ['#cartelaSlot'],
      },
      {
        key: 'overlays', label: 'Overlays e Composer', views: ['overlays'], legacy: 'graphics', requires: ['cg'],
        desc: 'O Composer, os modelos de overlay e o acervo de músicas, fundos e vinhetas (o Composer e os modelos usam o Gerador de caracteres).',
      },
      {
        key: 'audio', label: 'Áudio e sinal', views: ['audio'], legacy: true,
        desc: 'Normalização de loudness, nível da saída, tons DTMF e o standby.',
        features: [
          {
            key: 'scte', label: 'Sinalização SCTE-35', legacy: null,
            guards: ['PUT [ch]/config: só a mudança do SCTE-35 sai do pedido (refused); o resto vale'],
            desc: 'Os intervalos marcados no HLS (EXT-X-DATERANGE) para a inserção de anúncios.',
            panel: ['#view-audio .label:has(#sgScte)', '#view-audio label[for=sgPre]', '#sgPre', '#view-audio .card:has(#scteTbl)'],
          },
          {
            key: 'surround', label: 'Som 5.1, 7.1 e imersivo', legacy: true,
            desc: 'A 2ª trilha em 5.1 no ar e o som 5.1, 7.1 e imersivo no VOD dos apps.',
            config: ['audio.surround51'],
            panel: ['#view-audio .label:has(#au51)', '#view-audio .label:has(#au51) + p'],
            jobs: ['o pacote 5.1 do VOD dos apps'],
          },
        ],
      },
      {
        key: 'entradas', label: 'Entradas e saídas', views: ['entradas'], legacy: true,
        desc: 'As Saídas do canal (YouTube, Facebook, RTMP…), o timecode embutido e o que chega ao vivo.',
        features: [
          {
            key: 'saidasSrtUdp', label: 'Saídas SRT e UDP', legacy: true,
            guards: ['POST [ch]/outputs com protocolo SRT ou UDP (server/outputs-api.js)'],
            desc: 'Saídas para destino próprio por SRT ou UDP (além do RTMP). A quantidade de saídas é um limite do plano.',
          },
          {
            key: 'youtube', label: 'Integração com o YouTube', legacy: true,
            desc: 'A conta do YouTube do canal: anúncios nos intervalos e a live ligada à soma de espectadores.',
            routes: ['POST|PUT|DELETE [ch]/youtube-ads*', 'POST|PUT|DELETE /api/integracoes/youtube*'],
            panel: ['#cfgYoutube', '#cfgYoutubeAds'],
          },
        ],
      },
    ],
  },
  {
    id: 'app', label: 'App do espectador',
    menus: [
      { key: 'site', label: 'Site do canal com o player', views: [], core: true, desc: 'A página pública do canal: o player, a programação e as denúncias.' },
      {
        key: 'app', label: 'App do espectador (celular, tablet e web)', views: ['app'], legacy: null,
        guards: ['GET /api/app/config, /api/app/catalog, /api/app/radios/fundos, /api/app/qr.png', 'GET/PUT /api/app/settings, POST /api/app/notice', 'POST /api/content… (Central de conteúdo)'],
        desc: 'O app do canal: canais, avisos, a aparência e a publicação.',
        features: [
          {
            key: 'tvApps', label: 'Apps de TV (Samsung, LG) e o app NEXA', legacy: true, standalone: true,
            guards: ['o canal sai do diretório, da home e da busca do app NEXA (server/appdir.js)'],
            desc: 'O canal nas TVs e no diretório do app NEXA (catálogo do canal, recursos das TVs).',
            routes: ['POST|PUT|DELETE /api/app-catalog*', 'PUT /api/app/tv-features'],
            panel: ['#ctTabs [data-tab=app]'],
            app: ['diretório do app NEXA'],
          },
        ],
      },
      {
        key: 'conteudo', label: 'Conteúdo dos apps', views: ['conteudo'], legacy: 'app', requires: ['app'],
        desc: 'A Central de conteúdo: links ao vivo, canais, informativos e banners nos apps.',
        features: [
          { key: 'vod', label: 'VOD (programas sob demanda)', legacy: null, standalone: true, desc: 'Os programas da biblioteca para assistir quando quiser nos apps.', app: ['VOD'], guards: ['item vod da Central de conteúdo (server/content.js)', 'o VOD no catálogo dos apps e no app NEXA'] },
          { key: 'vitrines', label: 'Vitrines manuais', legacy: 'vod', requires: ['app', 'vod'], desc: 'As vitrines montadas à mão na Central de conteúdo.', panel: ['#ctTabs [data-tab=rows]'], guards: ['vitrine manual da Central de conteúdo (server/content.js)'] },
          {
            key: 'gadgets', label: 'Gadgets (rádios, clima, trânsito e câmeras)', legacy: true, standalone: true,
            desc: 'Os widgets da página do canal nos apps e no site.',
            routes: ['POST|PUT|DELETE /api/app-gadgets*'],
            panel: ['#ctTabs [data-tab=gadgets]'],
          },
          {
            key: 'audiencia', label: 'Audiência dos apps', legacy: true,
            desc: 'Quem assiste: programas, vitrines, rádios, alcance e retenção.',
            routes: ['GET /api/audiencia*'],
            panel: ['#ctTabs [data-tab=aud]'],
          },
        ],
      },
      { key: 'audience', label: 'Público (Fale com a TV)', views: ['publico'], legacy: null, desc: 'O Fale com a TV, a caixa de mensagens do app e os perfis.', app: ['audience'], guards: ['/api/app/messages, /api/app/inbox, /api/app/profile e /api/audience/* (server/audience.js)'] },
      {
        key: 'reacoes', label: 'Reações', views: ['reacoes'], legacy: true,
        guards: ['a reação pelo WebSocket (server/chat.js) e POST /api/app/react das TVs'],
        desc: 'As reações do público no site, no app e nas TVs, e o relatório por programa.',
        routes: ['GET [ch]/reacoes'],
        app: ['reactions'],
      },
      {
        key: 'interacoes', label: 'Interações', views: ['interacoes'], legacy: true,
        desc: 'A central do canal: enquete no ar, reações dos últimos segundos, curtidas e o aviso no canal.',
        features: [
          { key: 'polls', label: 'Enquetes', legacy: null, desc: 'Enquete no ar com voto pelo site, pelo app e pelo controle da TV.', panel: ['#ivPollForm', '#view-interacoes .card:has(#ivCurrent)'], app: ['polls'], guards: ['POST [ch]/polls e o voto; GET [ch]/poll e [ch]/interactivity sem a enquete'] },
          {
            key: 'chat', label: 'Bate-papo e comentários', legacy: true,
            guards: ['a mensagem do chat pelo WebSocket (server/chat.js)', 'os comentários nas TVs'],
            desc: 'O chat do site e do app e os comentários por programa nas TVs.',
            app: ['chat'],
          },
          {
            key: 'mural', label: 'Mural de fotos', legacy: true,
            desc: 'As fotos do público na página do mural, moderadas e levadas ao ar pelo CG.',
            routes: ['POST /api/mural/{ch}*', 'PUT [ch]/cg/mural/auto'],
          },
        ],
      },
      {
        key: 'moderacao', label: 'Moderação', views: ['moderacao'], legacy: true,
        desc: 'A central em tempo real: chat, comentários das plataformas, fotos do mural e enquetes.',
        routes: ['PUT [ch]/comentarios', 'DELETE [ch]/comentarios/*', 'POST [ch]/comentarios/*'],
      },
      { key: 'denuncias', label: 'Denúncias e feedback', views: ['denuncias'], core: true, desc: 'Denunciar e enviar feedback, como pedem as lojas de apps e a lei.' },
      { key: 'shop', label: 'Loja do app e pedidos', views: ['pedidos'], legacy: null, desc: 'Os produtos à venda no app e os pedidos do público.', app: ['shop'], guards: ['GET /api/shop, POST /api/orders e a vitrine do app NEXA'] },
    ],
  },
  {
    id: 'telas', label: 'NEXA Telas',
    menus: [
      {
        key: 'prefeitura', label: 'Modo prefeitura (Painel da Prefeitura)', views: ['prefeitura'], legacy: false, optIn: true,
        desc: 'A rede de telas da prefeitura (TV box em escolas, UBS, UPA, hospitais, CRAS e repartições): mapa, telas, repartições, regiões e alertas, chamada de senha com totem, cartões de informação, clima, vídeos guardados, aprovação da SECOM e modo eleitoral. Sem comerciais: com o modo ligado, o menu Comercial some do painel.',
        routes: ['* /api/prefeitura*'],
        guards: ['/api/telas/* (a TV box, pelo token do aparelho; server/telas.js)', '/api/reparticao/* e /reparticao/<link> (o link de controle da repartição)', '/api/totem* e /reparticao/<token>/totem (o totem de senhas; server/telas-senha.js)', 'o menu Comercial some do painel (public/admin/main.js)'],
      },
      {
        key: 'tvcorp', label: 'TV Corporativa', views: ['tvcorp'], legacy: false, optIn: true,
        desc: 'A TV da empresa nas TV box (recepção, escritório, fábrica, refeitório, loja): o canal com layout por áreas, imagens e slides, playlists, grade por unidade e horário, aniversariantes, comunicados com "Li", indicadores, notícias e cotações, o celular do funcionário e o relatório de exibição. Não esconde o Comercial.',
        routes: ['* /api/tvcorp*'],
        guards: ['/api/telas/* (a TV box aceita a tela com o modo prefeitura OU a TV Corporativa; server/telas.js)', '/tvc/<token> e /api/tvc* (o celular do funcionário; server/tvcorp-dados.js)', '/api/reparticao/tvcorp* (o link da unidade corporativa)', '/api/tvcorp-api/* (a chave de integração, com a funcionalidade api)'],
      },
    ],
  },
  {
    id: 'sistema', label: 'Sistema',
    menus: [
      { key: 'canais', label: 'Canais', views: ['canais'], core: true, desc: 'Os canais da organização (a quantidade é um limite do plano).' },
      { key: 'canal', label: 'Ajustes do canal', views: ['canal'], core: true, desc: 'Nome, logomarca, endereços e as palavras proibidas.' },
      {
        key: 'usuarios', label: 'Usuários e acessos', views: ['usuarios'], core: true, desc: 'Usuários, grupos, permissões e a auditoria.',
        features: [
          { key: 'mam', label: 'NEXA MAM (ilhas de edição e Nuvem)', legacy: true, desc: 'O NEXA MAM no Windows ligado ao canal: biblioteca, envio e o arquivo na Nuvem.', guards: ['/api/mam/v1/*: a ligação e cada pedido com a chave do dispositivo (server/mam-bridge.js)'] },
        ],
      },
      { key: 'licenca', label: 'Licença e suporte', views: ['licenca'], core: true, desc: 'Edição Windows: a licença da central e as mensagens do suporte.' },
      { key: 'plano', label: 'Plano e uso', views: ['plano'], core: true, desc: 'O plano, o uso e a cobrança.' },
      {
        key: 'config', label: 'Configurações', views: ['config'], core: true, desc: 'Organização, fuso horário e os nomes dos menus.',
        features: [
          { key: 'customDomain', label: 'Domínio próprio', legacy: null, desc: 'O site e o app no domínio da emissora.', panel: ['#cfgDomains'], guards: ['POST /api/domains'] },
          { key: 'api', label: 'Acesso por API', legacy: null, desc: 'O domínio de API para integrar sistemas da emissora.', guards: ['POST /api/domains com kind api'] },
          // incorporar o canal em outro site (docs/INCORPORAR.md): chave nova, ligada nos planos de antes (legacy: true), que o
          // Superadmin desliga por plano. Por canal ela nasce DESLIGADA: quem liga é o cliente, em Configurações
          {
            key: 'embed', label: 'Incorporar o canal em outros sites', legacy: true,
            desc: 'O player do canal (e, se quiser, os comentários) num iframe do site da emissora, com o código pronto para colar.',
            panel: ['#cfgEmbed'],
            guards: ['a página /embed/<canal> (404 sem a funcionalidade)', 'ligar a incorporação no PUT [ch]/embed (desligar sempre pode; server/embed.js)'],
          },
        ],
      },
      { key: 'conta', label: 'Minha conta', views: ['conta'], core: true, desc: 'Os dados e a senha de quem entrou.' },
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
