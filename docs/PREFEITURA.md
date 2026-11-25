# Prefeitura (modo órgão público) no DIGITAL ISP

Trazido do NEXA Broadcast (`C:\Projetos\nexatvplayout`, `origin/main` b6832dcd, 25/11/2026) em 25/11/2026. O módulo da
prefeitura não mudou no NEXA depois da cópia de 22/11 (commit c51d2469): o servidor e as páginas da repartição já tinham
vindo naquela cópia. Esta passagem trouxe o que faltava (o painel, a guarda do plano, o município, os testes) e ligou tudo
aos níveis do DIGITAL ISP.

A especificação completa continua em `docs/origem-nexa/TELAS.md` (§1 a §32) e os manuais em `docs/origem-nexa/manual/prefeitura-*.md`.

## Como liga

1. **Plataforma** (`/superadmin` → Planos e módulos): marca **Modo órgão público** no plano da revenda. É um módulo
   `optIn`: nunca vem ligado no "tudo liberado".
2. **Revenda** (`/admin` → Planos): o módulo aparece na lista dos planos dos clientes só quando o plano dela tem. Marca no
   plano do cliente final (a prefeitura).
3. **Cliente final** (`/c/<cliente>`): o menu **Prefeitura** aparece com as 12 abas (Mapa, Telas, Grupos, Repartições,
   Regiões, Alertas, Desaparecidos, Ocorrências, Senhas, Cartões, Sem internet, Aprovações), para quem tem a permissão
   `prefeitura.manage` (o grupo Administradores tem). A revenda com o módulo também tem o menu para as telas dela.
4. Sem o módulo, `/api/prefeitura*` responde 403 `feature_unavailable` (guarda do catálogo, `routes` em
   `public/shared/funcionalidades.js`, ligada por `createPlanGate` no `server/index.js`).

O município da prefeitura trava no primeiro cadastro (Painel da Prefeitura → Padrão). Trocar ou tirar:

- a revenda, no cadastro do cliente (Clientes → o cliente → cartão "Município da prefeitura"):
  `GET/PUT/DELETE /api/revenda/clientes/:id/telas-municipio`;
- a plataforma, no cadastro da revenda (para as telas da própria revenda) ou pela rota
  `GET/PUT/DELETE /api/platform/tenants/:id/telas-municipio` (qualquer conta).

## O que foi portado (NEXA → DIGITAL ISP)

### Servidor

| NEXA | DIGITAL ISP | Situação |
|---|---|---|
| `server/telas.js` (API da TV box `/api/telas/*`, Painel da Prefeitura `/api/prefeitura/*`, link da repartição `/reparticao/<link>` e `/api/reparticao/*`, totem `/api/totem*`) | `server/telas.js` | Igual, com os ajustes do DIGITAL ISP (clima pela fonte de Notícias e dados, foto do tempo, manchetes na faixa, canal ao vivo por tela) e textos sem a marca de origem |
| `server/telas-core.js`, `telas-conteudo.js`, `telas-conteudo-core.js` | mesmos nomes | Iguais. Os **vídeos guardados** (aba Sem internet) agora vêm das mídias de vídeo das telas (`tvcorp_media`), não da tabela `media` do canal |
| `server/telas-desaparecidos.js` (pessoas desaparecidas) | mesmo nome | Igual |
| `server/telas-seguranca.js` (botão de pânico, emissores conveniados, CCO, chave de integração) | mesmo nome | Igual |
| `server/telas-senha.js`, `telas-senha-core.js` (senhas, guichê, totem, chamada falada) | mesmos nomes | Iguais |
| `server/telas-salas.js`, `telas-salas-core.js` (salas e consultórios, apoio, acompanhante) | mesmos nomes | Iguais |
| `server/telas-interna.js`, `telas-interna-core.js` (comunicação interna de UPA e hospital) | mesmos nomes | Iguais |
| `server/telas-malha.js` (contorno do município, IBGE) | mesmo nome | Igual |
| `server/telas-geocode.js` ("Localizar no mapa") | mesmo nome | Igual (User-Agent com o nome DIGITAL ISP) |
| `server/telas-imagem-offline.js`, `telas-acesso.js`, `telas-app.js` | mesmos nomes | Iguais (o APK baixado sai como `Telas-<versão>.apk`) |
| `server/db/schema-telas.js` (todas as tabelas `telas_*`, SQLite e Postgres) | mesmo nome | Igual |
| `server/authcore.js`: permissão `prefeitura.manage` | `server/authcore.js` | Igual |
| `public/shared/funcionalidades.js` + `server/funcionalidades.js`: funcionalidade `prefeitura` (optIn, rota guardada `* /api/prefeitura*`) | mesmos | "Modo órgão público", com a mesma rota guardada |
| `server/index.js`: ligação do `createTelas` (canal, clima, mídias, fotos, imagem sem internet) | `server/index.js` | Ligado. O canal é o canal ao vivo (HLS) da conta; a repartição sem canal escolhido toca o primeiro, como o canal da prefeitura no NEXA |
| `server/index.js`: `/graphics/desap-*` sem cache | `server/index.js` | Igual (`no-store`) |
| `server/index.js`: `/api/platform/tenants/:id/telas-municipio` | `server/prefeitura.js` | Igual, e também para a revenda sobre os clientes dela |
| `server/index.js`: o erro devolve o `extra` da rota (`code: municipio_locked` e outros) | `server/index.js` | Igual |
| `scripts/gerar-municipios.mjs` (refaz `public/shared/municipios-ibge.json`) | mesmo nome | Igual |

### Painel

| NEXA | DIGITAL ISP | Situação |
|---|---|---|
| `public/admin/views/prefeitura.js` (Mapa, Telas, Grupos, Repartições, Regiões, Alertas, padrão da prefeitura) | mesmo nome | Igual; cor do grupo em SVG (sem style inline vindo de script); canal = canal ao vivo (HLS) |
| `public/admin/views/prefeitura-fase3.js` (Senhas, Cartões, Sem internet, Aprovações, modo eleitoral) | mesmo nome | Igual, sem os dois campos sem equivalente (ver abaixo) |
| `public/admin/views/prefeitura-controle.js` (usuários da repartição, tipos de aviso, Desaparecidos, Ocorrências) | mesmo nome | Igual |
| `public/admin/views/prefeitura-reparticoes.js` (assistente de nova repartição, ficha, alcance dos alertas) | mesmo nome | Igual, sem a marca "também no ar dos canais" |
| `public/admin/prefeitura.css`, `public/admin/telas-mapa.js` | mesmos nomes | Iguais (já tinham vindo) |
| `public/admin/index.html` + `main.js`: menu Prefeitura, a tela `#prefeitura/<aba>` e o selo (telas desligadas + aprovações) | mesmos | Menu "Prefeitura" com as 12 abas, só com o módulo e a permissão; selo a cada minuto |
| `public/superadmin/views/tenant.js`: cartão "Município da prefeitura" | `public/admin/views/prefeitura-municipio.js` | No cadastro do cliente (revenda) e no cadastro da revenda (plataforma) |
| `public/superadmin/views/funcionalidades.js` | `public/admin/views/plataforma.js` (Planos e módulos) | A plataforma marca o módulo direto no plano |

### Repartição e TV

| NEXA | DIGITAL ISP | Situação |
|---|---|---|
| `public/reparticao/*` (painel da repartição, guichê, totem, sala, equipe, apoio, acompanhante, `rep-*.js`) | mesmos nomes | Iguais; o topo diz "Painel da repartição" / "Repartição · …" no lugar de "NEXA Telas" |
| `public/shared/telas-tipos.js`, `telas-geo.js`, `telas-amostras.js`, `telas-previa.js`, `telas-salas.js`, `triagem-catalogo.js`, `uf-city.js`, `br-docs.js`, `municipios-ibge.json` | mesmos nomes | Iguais |
| `android-telas/` (o app das TV box) | `android/` | Portado em 22/11 **sem** pessoas desaparecidas e sem as categorias de alerta da Defesa Civil (ver Pendências) |

### Testes

| NEXA | DIGITAL ISP |
|---|---|
| `telas-servidor`, `telas-fase3-servidor`, `telas-controle-servidor`, `telas-desaparecidos-servidor`, `telas-seguranca-servidor`, `telas-salas-servidor`, `telas-interna-servidor`, `telas-municipio-servidor`, `telas-layouts-senha-servidor`, `telas-senha-ordem-servidor`, `telas-licenca-reinstalar`, `telas-imagem-offline`, `telas-app-servidor`, `telas-pg` | mesmos nomes, no modelo do DIGITAL ISP (`test/helpers/prefeitura.js`: canal ao vivo, usuário de permissão limitada, auditoria) |
| `reparticoes-assistente-servidor` | mesmo nome (a migração de banco antigo fica pulada) |
| unidade: `telas`, `telas-fase3`, `telas-controle`, `telas-municipio`, `telas-interna`, `telas-layouts-senha`, `telas-senha-ordem`, `telas-geocode`, `telas-aviso-origem` | mesmos nomes (já tinham vindo) |
| — | `prefeitura-servidor` (novo): plataforma → revenda → cliente → telas, a guarda do plano, as permissões e o município pela revenda e pela plataforma |

Rodar: `npm test` (unidade) e `npm run test:servidor` (sobe o servidor; os roteiros de Postgres precisam do pacote
`embedded-postgres`, que não está no `package.json`: `npm install --no-save embedded-postgres@^18.4.0-beta.17`).

### Documentação

| NEXA | DIGITAL ISP |
|---|---|
| `docs/TELAS.md`, `docs/TELAS-APP.md` | `docs/origem-nexa/` (já tinham vindo) |
| `docs/manual/prefeitura-*.md` (6 manuais) | `docs/origem-nexa/manual/` |

## Diferenças de comportamento

- **Sem o módulo no plano**, o Painel da Prefeitura recusa (403), mas a TV box segue no ar e o link da repartição segue
  abrindo: no DIGITAL ISP a base das telas é sempre incluída (a TV Corporativa é `core`). No NEXA a TV recebia 403.
- **Canal**: o canal da prefeitura do NEXA virou o canal ao vivo (HLS) da conta (Telas → Ao vivo). A repartição sem canal
  escolhido toca o primeiro canal ativo.
- **Vídeos guardados** (Sem internet): escolhidos entre os vídeos de Mídias (não há mais biblioteca do canal).
- **Usuários e auditoria**: o DIGITAL ISP não tem as telas de usuários/grupos nem a de auditoria da conta. A permissão
  `prefeitura.manage` vale do mesmo jeito; os administradores têm.

## Sem equivalente no DIGITAL ISP

Nada disto existe aqui; apagar no NEXA não tira nada do DIGITAL ISP.

| No NEXA | Por quê |
|---|---|
| Alerta de emergência do canal nas telas (EAS, `server/eas.js`, `eas-api.js`, `easAiring` do `createTelas`, §16 do TELAS.md) e o "também no ar dos canais" do alcance dos alertas (`easSend`/`easStop`) | O DIGITAL ISP não tem canal no ar. A marca fica guardada no banco, mas nada vai a canal; os alertas da prefeitura seguem indo às telas |
| Aviso por e-mail de tela desligada (`notify` → `alerts.channelEvent`, Saúde do sinal) | O DIGITAL ISP não envia e-mail. O selo do menu e a disponibilidade (aba Telas) seguem |
| Excluir o cliente apaga as tabelas da prefeitura (`server/platform.js`, `TELAS_TABLES`) | O DIGITAL ISP não exclui contas (a revenda suspende ou cancela) |
| Menu Comercial some com o modo (`public/admin/main.js`) | O DIGITAL ISP não tem Comercial |
| Nomes dos menus (`server/menu-names.js`, chave `prefeitura`) | O DIGITAL ISP não tem a troca de nomes dos menus |
| Migração de bancos antigos (`test/telas-migracao.test.js`, trecho de migração de `telas-licenca-reinstalar` e `reparticoes-assistente-servidor`) | O banco do DIGITAL ISP já nasce com todas as colunas |
| Freio das tarefas de fundo pelo ar (`hold: airStrain`) | Não há ar para proteger |
| Manual em HTML (`public/manual/prefeitura-*.html`) | É o manual gerado do NEXA; a fonte (`.md`) veio para `docs/origem-nexa/manual/` |
| Páginas do site (`public/site/para/prefeituras.html`, `camaras.html`, `tribunais.html`…) e `scripts/site-lps/` | Propaganda do NEXA; o site do DIGITAL ISP é outro (`site/`) |

## No NEXA, mas não é do módulo da prefeitura (não apagar junto)

Estes arquivos citam "prefeitura" mas são de outras partes do NEXA:

- `server/tvcorp*.js`, `public/admin/views/tvcorp*.js`, `public/admin/tvcorp.css`: a TV Corporativa (usa a mesma rede de telas);
- `server/transito-rio.js`: a fonte de trânsito do Rio da TV Corporativa (não veio para o DIGITAL ISP);
- `public/admin/telas-mapa.js`, `public/shared/telas-*.js`, `server/telas*.js`: também servem a TV Corporativa no NEXA;
- `public/cg/overlays/politica.js`, `jornalismo.js`, `kit.js`, `lbar-data.js`, `scripts/lbar/modelos.js`: gerador de caracteres;
- `server/cartelas.js`, `server/integrations.js`, `server/frame-guard.js`, `server/storage-refs.js`: canal, integrações e arquivos;
- `server/eas.js`: alertas de emergência dos canais (o módulo da prefeitura só lia).

## Pendências

- **App Android (`android/`)**: o app do DIGITAL ISP saiu do NEXA Telas sem **pessoas desaparecidas** (`Missing.kt`,
  `MissingViews.kt` e os testes `MissingTest`, `MissingQrTest`) e sem as **categorias de alerta da Defesa Civil**
  (`AlertsDefesaCivilTest`), retirados de propósito em 22/11 (commit dfa5679). O servidor manda os casos de desaparecidos
  no sinal de vida (`missing`), mas a TV do DIGITAL ISP não mostra. Para a prefeitura ficar completa na TV, esses arquivos
  do `android-telas/` do NEXA precisam voltar ao `android/` (com o pacote `br.com.digitalisp.telas`) antes de o NEXA
  apagar o módulo. Cópia guardada em `docs/origem-nexa/android-prefeitura/` (de `android-telas/app/src/main/java/br/com/nexatv/telas/MissingViews.kt`,
  `.../core/Missing.kt` e `android-telas/app/src/test/java/br/com/nexatv/telas/core/{MissingTest,MissingQrTest,AlertsDefesaCivilTest}.kt`).
