# TV Corporativa: projeto do módulo (NEXA Telas)

Pedido do dono (20/11): "Crie um módulo completo de TV CORPORATIVA e coloque no menu abaixo de Prefeitura com todas as
funcionalidades de digital signage". Este documento é o **projeto**: nada aqui está construído. Ele diz o que já existe no
NEXA Telas, o que muda, o que é novo, e divide a obra em pacotes para 4 agentes em paralelo mais o coordenador.

Fontes lidas para o levantamento: três páginas públicas de mercado sobre TV corporativa (indicadas pelo dono) e a lista de
menus do painel de um concorrente que o dono mostrou. **Nenhum nome de concorrente entra em texto do produto** (painel, app,
site, manual).

---

## 1. Visão

**TV Corporativa é um modo do NEXA Telas**, ao lado do modo prefeitura. Reaproveita tudo o que já existe: a TV box Android com
o app kiosk `NEXA Telas` (`android-telas/`), a ativação por chave, o token, a recuperação após reinstalação (§32 de
`docs/TELAS.md`), o sinal de vida, os comandos remotos, as capturas, o horário liga/desliga, a imagem e os vídeos sem
internet, os grupos, os alertas por alcance, a aprovação, os cartões, o texto rolante, a lateral e a chamada de senha.

O que muda é o **público** (funcionários, clientes na recepção, chão de fábrica, refeitório, loja) e o **conteúdo**:
comunicação interna, endomarketing, RH, indicadores, notícias e informação útil, numa **grade por zonas** (layout com várias
áreas na mesma tela) e com **segmentação** por unidade, grupo e tela.

| Decisão | Como fica |
|---|---|
| Ligar o modo | funcionalidade **`tvcorp`** no catálogo (`public/shared/funcionalidades.js`, seção NEXA Telas), `optIn: true` como a `prefeitura`: só vale citada ligada; fora do "Liberar tudo". **Não esconde o Comercial** (diferente do modo prefeitura) |
| Os dois modos juntos | permitido. As unidades corporativas e as repartições moram nas mesmas tabelas (`telas_offices`), separadas pelo **tipo** (tipos novos de unidade, seção 5.1) |
| Menu | item **TV Corporativa** (`data-view="tvcorp"`) logo **abaixo de Prefeitura**, na seção "telas" do menu lateral, com selo próprio (telas desligadas + pedidos aguardando aprovação) |
| Permissão | **`tvcorp.manage`** (área "NEXA Telas"), dada sozinha ao grupo Administradores, como `prefeitura.manage` |
| TV box | o mesmo app e a mesma API `/api/telas/*`. O servidor aceita a tela quando o cliente tem `prefeitura` **ou** `tvcorp` ligado |
| Vídeo principal | continua sendo o **canal** do cliente (HLS público do NEXA Broadcast). O vídeo institucional, os treinamentos e a **transmissão ao vivo para todas as telas** saem da Grade/Playout e do Ao vivo que o cliente já tem. **O caminho do vídeo no app não muda** |
| Conteúdo novo | slides, imagens, dados e textos desenhados **pelo app, em código nativo**, nas zonas do layout (nunca por cima do player, sempre em `View`s próprias ao lado ou sobre áreas que não são o vídeo) |

### 1.1 O que nos diferencia (para o site depois, sem citar ninguém)

- Canal de TV de verdade nas telas: grade, ao vivo com mesa, legendas, loudness, alerta de emergência: o que outros
  sistemas chamam de "transmissão ao vivo" aqui é o próprio ar do canal.
- Chamada de senha, comunicação interna com "Li" e o botão de pânico silencioso já prontos para recepção, ambulatório e
  portaria da empresa.
- Licença presa ao aparelho (sobrevive à reinstalação) e atualização do app pelo próprio servidor.

---

## 2. Levantamento: funções de TV corporativa / digital signage

Lista exaustiva, juntando as três páginas de referência, os menus do painel mostrado pelo dono e o padrão de mercado.
Cada linha diz o estado no NEXA Telas: **Existe** (onde), **Adaptar** (existe e precisa mudar) ou **Nova**. A coluna
**Pac.** é o pacote de trabalho (seção 8); **F2** = fase 2 (decisão do dono, seção 9).

### 2.1 Rede de telas (players)

| Função | Estado | Onde / o que fazer | Pac. |
|---|---|---|---|
| Cadastro dos players, ativação por chave | Existe | `telas_keys`, `POST /api/telas/activate`, aba Telas do Painel da Prefeitura | Coord. (rede no menu novo) |
| Licença presa ao aparelho, volta sozinha após reinstalar | Existe | §32 de TELAS.md, `/api/telas/recover` | — |
| Players online/offline, desde quando, disponibilidade 7/30 dias | Existe | `telas_devices`, `telas_device_events`, `deviceStatus` | C (mostrar) |
| Captura de tela remota | Existe | comando `screenshot`, `/api/telas/screenshot` | C |
| Reiniciar app / aparelho / recarregar | Existe | `telas_commands` (`reload`, `restart-app`, `reboot`) | C |
| **Histórico de comandos enviados aos players** | Adaptar | a tabela `telas_commands` já guarda; falta a rota de listagem e a aba | A + C |
| Aviso por e-mail de tela desligada | Existe | `server/alerts.js` via `telas-conteudo.js` | — |
| Horário liga/desliga por dia da semana | Existe | `schedule` na configuração (`core/Schedule.kt`) | C (editor) |
| Volume e mudo por tela | Existe | `volume`, `muted` | — |
| Orientação em pé (totem) | Existe | layout `portrait`; nos layouts novos, `orientation` do layout | A, D |
| PIN de saída e trava kiosk | Existe | §4 de TELAS.md | — |
| Atualização remota do app | Existe | `server/telas-app.js`, `latest.json` | — |
| **Instalar o aplicativo** (passo a passo, QR do APK, chave) | Adaptar | `/telas/app/latest.apk` já existe; falta a aba com o roteiro e o QR | C |
| Telemetria (modelo, Android, versão, rede, último erro, uptime) | Existe | sinal de vida | — |
| Grupos de telas (manuais e automáticos por tipo) | Existe | `telas_groups`, `telas_group_devices` | — |
| Unidades / filiais / setores | Adaptar | `telas_offices` com **tipos corporativos novos** (5.1); "setor" = grupo manual ou o setor da comunicação interna | Coord. + A |
| Mapa das unidades | Adaptar | `telas-mapa.js` sem a trava do município (empresa tem filiais em várias cidades): modo "Brasil" com enquadramento pelas unidades | C |
| Verificação da entrada HDMI, 4G, limite de banda por horário | Nova (fora) | depende de hardware; fica fora deste projeto | — |
| Sincronizar várias telas (mural de vídeo / videowall) | Nova F2 | relógio comum (o app já tem `TrustedClock`), mas exige o player; decisão do dono | F2 |

### 2.2 Conteúdo e programação

| Função | Estado | Onde / o que fazer | Pac. |
|---|---|---|---|
| Vídeo institucional, treinamentos, vídeos do dia | Existe | Grade, Playout e Agenda do canal (o canal é o vídeo da tela) | — |
| **Transmissão ao vivo para todas as telas** | Existe | Ao vivo / mesa do canal; tudo o que vai ao ar aparece nas telas | — |
| **Minhas mídias** (biblioteca de imagens e slides) | Nova | `tvcorp_media`: envio de imagem (JPEG/PNG/WebP → JPEG 1920×1080 ou 1080×1920 pelo FFmpeg, sem metadados, como a imagem sem internet) e slides de modelo | A |
| Vídeos na biblioteca | Existe | biblioteca de mídia do canal (vão ao ar pela grade) | — |
| Vídeo por segmento (só numa unidade, só num grupo) | Nova F2 | pede um 2º player no app; decisão do dono (seção 9) | F2 |
| PDF e apresentações (PPT) | Nova F2 | sem conversor no servidor; na fase 1, "Exportar como imagem" no programa do usuário e subir as páginas | F2 |
| Padronização automática do formato (imagem) | Nova | o mesmo caminho do FFmpeg da imagem sem internet: cobre o quadro, corta ou encaixa com fundo | A |
| **Playlists** (sequência com tempo por item) | Nova | `tvcorp_playlists`, `tvcorp_playlist_items` | A |
| **Grades de programação** (qual playlist em qual tela, dia e horário) | Nova | `tvcorp_schedules` com alcance (todas, unidades, grupos, telas, regiões), dias, faixa de horário, período e prioridade | A |
| Agendamento com início e fim (validade) | Nova | `valid_from`/`valid_to` no item da playlist, na grade, nos comunicados | A, B |
| Conteúdo da matriz + conteúdo local da unidade | Nova | a grade junta os níveis: empresa (todas) + grupo + unidade + tela, na ordem; a unidade só mexe na dela (link da unidade) | A |
| **Layouts com zonas** | Adaptar | hoje há 6 formatos fixos + 9 de senha; novo: layouts por zonas (`tvcorp_layouts`), com modelos prontos de fábrica | A, C, D |
| Modelos prontos (templates) | Nova | catálogo de fábrica em `public/shared/tvcorp-tipos.js`: layouts e modelos de slide (comunicado, boas-vindas, aniversariantes, segurança, evento, vaga interna, indicador, cardápio, QR) | A, C, D |
| **Editor de arte** (slide a partir de modelo) | Nova | formulário por modelo: título, texto, imagem, cores do tema, QR; a prévia no painel; o app desenha o mesmo modelo em código nativo | C, D |
| Biblioteca inicial de artes (datas comemorativas, SIPAT, segurança) | Nova | fundos próprios do projeto (gerados por nós, sem marca de terceiros), em `public/tvcorp/arte/` | C |
| Tema da empresa (cores, logomarca) | Adaptar | `theme` já existe (cor e claro/escuro); somar a logomarca da empresa no padrão do modo | A, D |
| **Barra inferior** (texto rolante) | Existe | `ticker` (avisos), com a precedência tela > grupos > unidade > padrão | — |
| Barra inferior com fontes (notícias, cotações) | Adaptar | o texto rolante passa a aceitar itens de fonte (RSS, cotações), no servidor | B |
| **Barra lateral** | Adaptar | `side.widgets` (relógio, clima, QR, senha); somar notícias, cotações, aniversariantes do dia, indicador, contador | B, D |
| **Bloco informativo** | Adaptar | os cartões (`telas_cards`) + o tipo "aviso da unidade"; na TV corporativa viram slides de modelo | A |
| QR code automático (no slide e na notícia) | Adaptar | QR da lateral existe; somar o QR por slide | D |
| Menu board (cardápio do refeitório, com preço opcional) | Adaptar | o cartão `merenda` vira o modelo **Cardápio** (semana por dia, como a merenda) | B |
| Contador regressivo (evento, campanha) | Nova | widget `countdown` | B, D |
| "Dias sem acidente" (segurança do trabalho) | Nova | widget `safety`: data do último acidente, recorde, meta | B, D |
| Relógio mundial | Nova | widget `worldclock` (fusos fixos da lista) | D |
| Datas comemorativas automáticas | Nova | lista fixa no código (`public/shared/tvcorp-datas.js`), o cliente escolhe quais | B |
| Página da web / painel de BI por endereço (URL) | Nova F2 | zona `url` com WebView no app; só https, só endereços que o cliente cadastrar; decisão do dono (seção 9) | F2 |
| Captura automática de URL pelo servidor | Nova (fora) | o servidor não tem navegador sem tela; fora deste projeto | — |
| Playlist de música (som ambiente) | Nova F2 | rádio (Radio Browser, que já usamos) ou áudio próprio; pede um 2º player de áudio; decisão do dono | F2 |
| Webcam ao vivo | Existe | a câmera entra no canal pela mesa (Ao vivo) | — |
| Conteúdo colaborativo (funcionário envia, gestor aprova) | Adaptar | aprovação existe (`telas_approvals`); somar o envio pela página do celular (2.5) | A, B |
| Tela touch / interativa | Nova (fora) | TV box com controle remoto; fora deste projeto | — |
| Interatividade por QR (pesquisa, sugestão, inscrição) | Nova | QR do slide leva à página do celular da empresa (2.5) | B |

### 2.3 Dados ao vivo (widgets e fontes)

| Função | Estado | Onde / o que fazer | Pac. |
|---|---|---|---|
| Clima | Adaptar | `server/weather.js` (provedor do Superadmin: INMET sem chave ou Open-Meteo com chave comercial). Hoje é por cidade da prefeitura; passa a ser **por unidade** (o município da unidade) | B |
| **Agência de notícias** (manchetes) | Nova | fontes RSS livres (seção 7.3) pelo `parseFeed` e `safeFetch` de `server/cg/sources.js`/`net.js`; só título, fonte e hora; o QR leva à matéria | B |
| RSS da própria empresa | Nova | o mesmo leitor, com o endereço do cliente (só https) | B |
| Cotações (dólar, euro, bolsa) | Nova | AwesomeAPI (já usada no CG, sem chave) e PTAX do Banco Central (dados abertos) | B |
| Trânsito | Adaptar | só o Rio de Janeiro tem fonte (`server/transito-rio.js`); nas outras cidades, avisos escritos | B |
| **Indicadores e metas (KPI)** | Nova | `tvcorp_kpis`: valor manual, planilha publicada como CSV (https) ou JSON (https), meta, faixas de cor; modelos: número grande, barra de meta, ranking | B |
| Painel de BI (Power BI etc.) | Nova F2 | pela zona `url` (F2) ou por imagem enviada pela API (fase 1: o cliente manda a imagem do painel pela API, seção 6.4) | A (API) |
| **Redes sociais** (mural com posts da empresa) | Nova F2 | só as contas do próprio cliente, pelas APIs oficiais com o token dele (o CG já faz isso para comentários), com moderação | F2 |
| Integração com ERP/MES (produção, OEE) | Nova | pela API de indicadores (6.4) | B |

### 2.4 RH e comunicação interna

| Função | Estado | Onde / o que fazer | Pac. |
|---|---|---|---|
| **Aniversariantes** (do dia, da semana, do mês) | Nova | `tvcorp_people`: nome, **dia e mês** (sem ano), unidade, setor; foto só com consentimento marcado; importação por planilha CSV | B |
| Tempo de casa / boas-vindas aos novos | Nova | `tvcorp_people.hire_date` (data de admissão, não de nascimento) | B |
| **Comunicados** (RH, benefícios, horários, férias coletivas) | Nova | `tvcorp_posts` com categoria, validade, alcance e aprovação | B |
| Reconhecimentos, conquistas, histórias | Nova | categorias de `tvcorp_posts` | B |
| Vagas internas, processos seletivos | Nova | categoria de `tvcorp_posts` | B |
| Segurança do trabalho (EPI, procedimentos, SIPAT) | Nova | categoria + o widget "dias sem acidente" | B |
| Comunicado urgente / crise / evacuação | Existe | alertas com alcance e gravidade (`telas_alerts`), tela cheia na hora | Coord. (aba Alertas no menu novo) |
| Confirmação de leitura ("Li") | Existe (UPA) | módulo `interna` (§25 de TELAS.md): setores, avisos com "Li", telas internas, celular | Adaptar: ligar `interna` nos tipos corporativos |
| Botão de pânico silencioso (portaria, recepção) | Existe | módulo `panico` (§21) | — |
| Chamada de senha (recepção, ambulatório da empresa) | Existe | módulo `senha` (§10) | — |
| Pesquisas, sugestões, chamados ao RH | Nova | página do celular (2.5): formulário curto, anônimo opcional | B |

### 2.5 App (celular) do funcionário

| Função | Estado | Onde / o que fazer | Pac. |
|---|---|---|---|
| Página no celular com os comunicados, aniversariantes e eventos | Nova | `/tvc/<token>` (uma por empresa ou por unidade), sem login, CSP estrita como `/interno/<token>`; lê `GET /api/tvc` | B |
| "Li" nos comunicados que pedem | Adaptar | a mesma ideia do `interna` | B |
| Enviar sugestão de conteúdo (colaborativo) | Nova | vai para a aprovação | B |
| Curtidas e comentários | Nova F2 | moderação e identidade do funcionário; decisão do dono | F2 |

### 2.6 Gestão, permissões e relatórios

| Função | Estado | Onde / o que fazer | Pac. |
|---|---|---|---|
| **Resumo do sistema** (mídias em exibição, players ativos, horas em exibição) | Nova | aba Resumo, `GET /api/tvcorp/summary` | A + C |
| **Relatório de exibição** (proof of play: o quê, onde, quantas vezes, quanto tempo) | Nova | o app conta e manda no sinal de vida (`plays`); `tvcorp_plays` por dia; CSV e impressão (PDF pelo navegador) | A, C, D |
| Relatório de disponibilidade das telas | Existe | disponibilidade 7/30 dias | C (mostrar no Relatórios) |
| Aprovação de conteúdo | Adaptar | `telas_approvals` ganha os tipos `tvc-post`, `tvc-media`, `tvc-schedule` | A |
| Usuários e permissões por unidade | Adaptar | os usuários da repartição (§17: gestor e atendente) valem para a unidade; o link da unidade abre a família nova **F11 Unidade corporativa** (publicar na própria unidade, aniversariantes dela, comunicados dela) | Coord. + B |
| Auditoria (quem publicou, aprovou, mandou comando) | Existe | `res.locals.audit` | todos |
| Integração por API (publicar comunicado, valor de indicador, imagem) | Adaptar | a chave de integração (`telas_api_keys`, §21) ganha rotas da TV corporativa, com a funcionalidade `api` no plano | A, B |
| Modo eleitoral, Defesa Civil, desaparecidos, EAS da prefeitura | Existe, não se aplica | ficam escondidos no menu TV Corporativa | — |
| Modo offline (sem internet continua mostrando) | Adaptar | vídeos guardados e a imagem sem internet existem; os slides e imagens da grade também ficam no aparelho (cache com SHA-256) | D |

---

## 3. Modelo de dados (só tabelas novas)

Regras de sempre (TELAS.md §2 e §20): uma DDL para SQLite e Postgres, só `CREATE TABLE/INDEX IF NOT EXISTS`, `tenant_id` em
toda tabela e em toda consulta, sem chave estrangeira, ids com identidade, JSON em `TEXT`. **Nenhuma coluna nova em tabela
que já existe** neste projeto: o que é da tela ou da unidade fica em tabela própria ligada pelo id. Toda tabela nova entra em
`TELAS_TABLES` (exclusão do cliente), `TELAS_COPY` e `TELAS_IDENTITY` (cópia SQLite → Postgres). Tempos em epoch ms
(`INTEGER`/`BIGINT`), dias em `YYYY-MM-DD` de America/Sao_Paulo.

Dois arquivos de esquema, um por pacote, para não haver conflito: `server/db/schema-tvcorp.js` (pacote A) e
`server/db/schema-tvcorp-dados.js` (pacote B). O coordenador registra os dois em `server/db/schema.js` (como o
`telasDDL`) e as listas em `schema-telas.js`.

### 3.1 Pacote A: conteúdo, grade e exibição (`schema-tvcorp.js`)

| Tabela | Colunas |
|---|---|
| `tvcorp_settings` | `tenant_id` (único), `data` JSON: logomarca (arquivo), tema, fuso, aprovação ligada, categorias ativas, datas comemorativas escolhidas, `updated_at` |
| `tvcorp_media` | `id`, `tenant_id`, `office_id` (NULL = da empresa), `kind` (`image` \| `slide`), `title`, `file` (nome em `graphics/`, `tvcmedia-<uuid>.jpg`; NULL no slide), `sha256`, `bytes`, `width`, `height`, `template` (modelo do slide), `fields` JSON (texto, cores, imagem, QR), `seconds` (padrão), `status` (`ok` \| `pending` \| `rejected`), `created_by`, `created_at`, `updated_at` |
| `tvcorp_playlists` | `id`, `tenant_id`, `office_id` (NULL = da empresa), `name`, `description`, `shuffle` (0/1), `sort`, `created_at`, `updated_at` |
| `tvcorp_playlist_items` | `id`, `tenant_id`, `playlist_id`, `ref_kind` (`media` \| `post` \| `widget` \| `kpi` \| `birthdays` \| `news` \| `card`), `ref_id` (ou NULL nos automáticos), `params` JSON, `seconds`, `sort`, `valid_from`, `valid_to`, `days` (0..6 em texto "1,2,3"; vazio = todo dia), `time_from`, `time_to` (minutos do dia) |
| `tvcorp_layouts` | `id`, `tenant_id`, `name`, `orientation` (`land` \| `port`), `zones` JSON (seção 4.2), `background` (cor ou `media_id`), `factory_key` (modelo de origem), `created_at`, `updated_at` |
| `tvcorp_schedules` | `id`, `tenant_id`, `name`, `layout_id`, `zone_playlists` JSON (`{ zona: playlist_id }`), `scope` + `scope_data` JSON (o mesmo formato dos alertas: `city`→`all`, `offices`, `groups`, `regions`, `devices`), `days`, `time_from`, `time_to`, `date_from`, `date_to`, `priority` (maior vence), `status` (`ok` \| `pending`), `created_by`, `created_at`, `updated_at` |
| `tvcorp_plays` | `tenant_id`, `device_id`, `day`, `ref_kind`, `ref_id`, `plays`, `seconds`; único (`tenant_id`, `device_id`, `day`, `ref_kind`, `ref_id`); 400 dias |
| `tvcorp_hours` | `tenant_id`, `device_id`, `day`, `on_sec` (horas em exibição por tela e dia, do sinal de vida); único (`tenant_id`, `device_id`, `day`); 400 dias |

A **identidade da unidade corporativa** fica nas tabelas de sempre (`telas_offices` com os tipos novos). O histórico de
comandos já está em `telas_commands` (a limpeza de 30 dias continua).

### 3.2 Pacote B: dados, RH e celular (`schema-tvcorp-dados.js`)

| Tabela | Colunas |
|---|---|
| `tvcorp_feeds` | `id`, `tenant_id`, `kind` (`rss` \| `quotes` \| `weather` \| `traffic`), `name`, `config` JSON (endereço https, pares de moeda, unidade do clima…), `refresh_min` (15 a 1440), `cache` JSON (itens já limpos), `fetched_at`, `last_error`, `enabled` |
| `tvcorp_people` | `id`, `tenant_id`, `office_id`, `name` (até 60), `sector` (até 40), `bday_day`, `bday_month` (**sem ano**), `hire_date` (`YYYY-MM-DD`, opcional), `photo` (arquivo, só com `photo_consent = 1`), `photo_consent`, `active`, `created_at`, `updated_at` |
| `tvcorp_posts` | `id`, `tenant_id`, `office_id` (NULL = empresa), `category` (`comunicado`, `rh`, `beneficio`, `boas-vindas`, `reconhecimento`, `seguranca`, `vaga`, `evento`, `aviso`), `title`, `body`, `media_id`, `qr_url`, `scope` + `scope_data`, `valid_from`, `valid_to`, `needs_ack` (0/1), `status` (`ok` \| `pending` \| `rejected`), `reason`, `created_by`, `created_at`, `updated_at` |
| `tvcorp_post_acks` | `tenant_id`, `post_id`, `who` (nome ou matrícula, como no `interna`), `at`; único (`post_id`, `who`) |
| `tvcorp_kpis` | `id`, `tenant_id`, `office_id`, `name`, `unit` (%, R$, un…), `value`, `target`, `direction` (`up` \| `down`), `bands` JSON (faixas de cor), `source` (`manual` \| `csv` \| `json` \| `api`), `source_cfg` JSON (endereço https, célula/caminho), `refresh_min`, `updated_at`, `last_error` |
| `tvcorp_kpi_points` | `tenant_id`, `kpi_id`, `at`, `value` (série para o gráfico; 400 dias) |
| `tvcorp_widgets` | `id`, `tenant_id`, `kind` (`countdown`, `safety`, `worldclock`, `menu`), `name`, `data` JSON (data do evento; data do último acidente e recorde; fusos; cardápio da semana), `updated_at` |
| `tvcorp_mobile` | `id`, `tenant_id`, `office_id` (NULL = empresa), `token_hash` (SHA-256; o endereço aparece uma vez), `name`, `created_at`, `revoked_at` |
| `tvcorp_suggestions` | `id`, `tenant_id`, `office_id`, `kind` (`sugestao` \| `conteudo` \| `pesquisa`), `text`, `media_file`, `who` (opcional; vazio = anônimo), `status`, `created_at`; 180 dias |

Fora do banco: nada novo em `settings` além de `tvcorp_settings` (tabela, para ficar no `TELAS_TABLES` e sair junto na
exclusão do cliente).

---

## 4. Contrato com o aparelho (proposta para `telas-contrato.md`, seção nova "Sinalização corporativa")

O app recebe **uma chave a mais** no `/api/telas/config` e manda **um campo a mais** no sinal de vida. App antigo ignora a
chave; servidor antigo nunca a manda. O `rev` cobre a chave nova (mudar a grade muda o `rev`).

### 4.1 `signage` no `/config` (só na tela de unidade corporativa com o modo ligado)

```json
"signage": {
  "tz": "America/Sao_Paulo",
  "brand": { "logo": { "url": "https://…/tvclogo-….png", "sha256": "…", "bytes": 12345 }, "color": "#1d4ed8", "mode": "dark" },
  "blocks": [
    {
      "id": "s12", "layout": { "orientation": "land", "background": "#0b1220",
        "zones": [
          { "id": "main",  "x": 0,  "y": 0,  "w": 75, "h": 88, "kind": "video" },
          { "id": "right", "x": 75, "y": 0,  "w": 25, "h": 88, "kind": "playlist" },
          { "id": "bar",   "x": 0,  "y": 88, "w": 100, "h": 12, "kind": "ticker" }
        ] },
      "days": [1,2,3,4,5], "from": 420, "to": 1080, "dateFrom": "2026-11-20", "dateTo": null,
      "zones": { "right": [ { "id": "m45", "kind": "image", "seconds": 10, "url": "https://…", "sha256": "…", "bytes": 210000 },
                           { "id": "p7",  "kind": "slide", "seconds": 12, "template": "comunicado", "fields": { "title": "…", "text": "…", "qr": "https://…" } },
                           { "id": "w:birthdays", "kind": "birthdays", "seconds": 12, "people": [ { "name": "Ana S.", "day": 20, "month": 11, "sector": "Financeiro" } ] },
                           { "id": "k3",  "kind": "kpi", "seconds": 10, "name": "Vendas do mês", "value": 82, "target": 100, "unit": "%", "band": "warn" } ] }
    }
  ],
  "fallback": "s0"
}
```

- `blocks` já vem **resolvido pelo servidor**: só os de hoje e amanhã (o app troca na virada sem rede), na ordem de
  prioridade. O app escolhe o bloco cujo dia e faixa valem **agora** (pelo relógio confiável que já tem); nenhum vale = o
  `fallback` (a grade padrão da empresa) ou, sem ele, o layout de sempre (`layout` da configuração).
- `zones[].kind`: `video` (o canal, **a mesma `View` do player de hoje**, só posta no retângulo da zona), `playlist`,
  `ticker` (o `ticker` da configuração), `clock`, `weather`, `qr`, `logo`, `text`, `news`, `quotes`, `countdown`, `safety`,
  `worldclock`, `queue` (a senha, quando a unidade tem o módulo). Coordenadas em % da tela (inteiros 0 a 100). No máximo
  1 zona `video` e 6 zonas por layout.
- Itens: `image`, `slide` (modelo + campos: o app desenha), `birthdays`, `kpi`, `news` (manchetes com fonte e hora),
  `quotes`, `post` (comunicado no modelo da categoria), `menu` (cardápio de hoje). Dados de widget e de fonte vêm **já
  prontos** no item (o app nunca busca fora). Arquivos sempre com `url` https + `sha256` + `bytes`: o app baixa, confere
  e guarda (como `offline.items`); item sem arquivo baixado é pulado.
- Tetos: 2 blocos ativos por dia, 60 itens por zona, 200 arquivos no cache (o mais antigo sai), 80 MB de cache.
- Dados que mudam sozinhos (notícias, cotações, clima, KPI) **não** mexem no `rev` a cada minuto: o servidor segura o
  mesmo objeto por 15 min (a mesma regra do clima, §12 de TELAS.md).

### 4.2 Zonas de fábrica (`public/shared/tvcorp-tipos.js`)

Modelos de layout: **Tela cheia** (vídeo), **Só conteúdo** (playlist em tela cheia, sem vídeo), **Vídeo + lateral**,
**Vídeo + lateral + barra** (L), **Vídeo + barra**, **Conteúdo + barra**, **Dois quadros** (playlist | playlist),
**Três quadros** (vídeo grande + duas playlists), **Recepção** (vídeo + senha + barra), **Refeitório** (cardápio + vídeo +
barra), **Chão de fábrica** (indicadores + dias sem acidente + barra), **Totem em pé** (vídeo em cima, playlist embaixo,
barra). Cada modelo tem a prévia no painel e é copiado para `tvcorp_layouts` quando o cliente o personaliza.

Modelos de slide: `comunicado`, `boas-vindas`, `aniversariantes`, `reconhecimento`, `seguranca`, `evento` (com contador),
`vaga`, `indicador`, `cardapio`, `qr` (chamada para ação), `imagem-com-legenda`, `data-comemorativa`. Cada um com campos
fixos e limites (título 60, texto 280, até 8 linhas) e duas variações de cor (tema claro e escuro).

### 4.3 Sinal de vida: `plays`

```json
"plays": [ { "ref": "m45", "n": 34, "sec": 340 }, { "ref": "p7", "n": 30, "sec": 360 } ], "playsDay": "2026-11-20"
```

Contagem acumulada desde o último sinal de vida aceito (o app só zera depois do `200`). O servidor soma em `tvcorp_plays`
e o tempo em exibição em `tvcorp_hours`. O vídeo do canal não entra aqui (a audiência do canal já é medida pelo ar).
Teto: 100 entradas por sinal de vida; `ref` fora do que a tela recebeu é ignorado.

---

## 5. Servidor

### 5.1 Catálogo (coordenador, em `public/shared/telas-tipos.js`)

Tipos de unidade novos, marcados `corp: true` (não aparecem no assistente da prefeitura e vice-versa): `matriz`
(Matriz / sede), `filial` (Filial / escritório), `fabrica` (Fábrica / planta), `loja` (Loja / ponto de venda),
`cd` (Centro de distribuição), `refeitorio` (Refeitório), `recepcao` (Recepção / portaria), `ambulatorio` (Ambulatório da
empresa), `treinamento` (Sala de treinamento), `corp-outro` (Outro). Família **F11 Unidade corporativa** em `familyOf`,
com as abas Publicar, Aniversariantes, Comunicados, Telas e, conforme os módulos, Senha, Comunicação interna e Pânico.
Módulos de fábrica: `avisos` em todos; `senha` em recepção e ambulatório; `interna` em fábrica e CD; `panico` em recepção.

### 5.2 Rotas do painel (`tvcorp.manage`; guarda do plano `* /api/tvcorp*` pela funcionalidade `tvcorp`)

| Rota | O que faz | Pac. |
|---|---|---|
| `GET /api/tvcorp` | tudo de uma vez: padrão, unidades, grupos, telas, layouts, playlists, grades (como o `GET /api/prefeitura`) | A |
| `GET /api/tvcorp/summary` | o Resumo: telas no ar/sem imagem/desligadas, itens em exibição agora, horas em exibição hoje, 7 e 30 dias, pedidos aguardando | A |
| `PUT /api/tvcorp/settings` | logomarca (corpo cru), tema, aprovação, datas comemorativas | A |
| `GET/POST/PATCH/DELETE /api/tvcorp/media[/:id]` | biblioteca; `POST /media/image` com a imagem crua no corpo; `GET /media/:id/file` | A |
| `GET/POST/PATCH/DELETE /api/tvcorp/playlists[/:id]`, `PUT …/:id/items` | playlists e a lista inteira de itens de uma vez | A |
| `GET/POST/PATCH/DELETE /api/tvcorp/layouts[/:id]` | layouts por zonas (validação no `tvcorp-core.js`) | A |
| `GET/POST/PATCH/DELETE /api/tvcorp/schedules[/:id]`, `POST …/preview` | grade; a prévia diz quantas telas pega e o que cada uma mostra agora | A |
| `GET /api/tvcorp/devices/:id/now` | o que a tela está mostrando agora (o bloco e o item, pelo último `plays`) | A |
| `GET /api/tvcorp/commands?deviceId=&from=&to=` | o histórico dos comandos enviados (quem, quando, resultado) | A |
| `GET /api/tvcorp/reports/plays?from=&to=&by=item\|device\|office&format=csv` | relatório de exibição | A |
| `GET /api/tvcorp/reports/hours?from=&to=&format=csv` | horas em exibição por tela e unidade | A |
| `GET/POST/PATCH/DELETE /api/tvcorp/feeds[/:id]`, `POST …/:id/test` | fontes (RSS, cotações, clima, trânsito); o "Testar" busca uma vez e mostra os itens | B |
| `GET/POST/PATCH/DELETE /api/tvcorp/people[/:id]`, `POST /people/import` (CSV), `GET /people/export` | aniversariantes e admissão | B |
| `GET/POST/PATCH/DELETE /api/tvcorp/posts[/:id]`, `GET …/:id/acks` | comunicados (com o "Li") | B |
| `GET/POST/PATCH/DELETE /api/tvcorp/kpis[/:id]`, `POST …/:id/value` | indicadores e o valor manual | B |
| `GET/POST/PATCH/DELETE /api/tvcorp/widgets[/:id]` | contador, dias sem acidente, relógio mundial, cardápio | B |
| `POST/DELETE /api/tvcorp/mobile[/:id]`, `GET /api/tvcorp/suggestions`, `POST …/:id/decide` | endereço do celular e a caixa de sugestões | B |
| rede (unidades, grupos, telas, chaves, comandos, captura, alertas, aprovações) | as rotas de `/api/prefeitura/*` **servidas também** sob `/api/tvcorp/rede/*` com a guarda `tvcorp` e a permissão `tvcorp.manage` (seção 8, coordenador) | Coord. |

### 5.3 Rotas sem sessão do painel

| Rota | Credencial | O que faz | Pac. |
|---|---|---|---|
| `GET /api/telas/config` (chave `signage`) | token da tela | já existe; ganha `signage` pelo `signageFor(tenantId, device, office, groups)` exportado pelo pacote A | A + Coord. |
| `POST /api/telas/heartbeat` (campo `plays`) | token da tela | já existe; repassa `plays` ao `recordPlays()` do pacote A | A + Coord. |
| `GET /api/tvc` | `Authorization: Bearer <token do celular>` | comunicados em vigor, aniversariantes da semana, eventos, cardápio de hoje; 60 por minuto por IP | B |
| `POST /api/tvc/ack/:postId`, `POST /api/tvc/suggest` | o mesmo | "Li" e sugestão (texto até 500, imagem opcional até 5 MB conferida pelo conteúdo); 10 por minuto por IP | B |
| `GET /tvc/<token>` | — | a página do celular (`public/tvc/`), CSP estrita, `noindex`, `no-referrer` | B |
| `POST /api/tvcorp-api/posts`, `POST /api/tvcorp-api/kpis/:id/value`, `POST /api/tvcorp-api/media/image` | chave de integração (funcionalidade `api`) | publicar por sistema externo (ERP, BI, RH) | A (imagem) + B (post, KPI) |

### 5.4 Regras do servidor

- **Resolução da grade** (`tvcorp-core.js`, sem banco, testável): para cada tela, as grades cujo alcance a pega e cuja
  data vale; por faixa de dia e hora, vence a de maior `priority`; empate = a mais específica (tela > grupo > unidade >
  empresa) e depois a mais nova. Os itens da playlist passam pelo filtro de validade, dia e hora; os itens "automáticos"
  (`birthdays`, `news`, `quotes`, `kpi`, `post`) são preenchidos pelos provedores do pacote B por uma interface simples
  (`dataFor(tenantId, officeId, ref) -> item | null`), injetada no `createTvcorp`.
- **Aprovação:** ligada em `tvcorp_settings`, o que vem do link da unidade e do celular fica `pending` e entra em
  `telas_approvals` com tipos novos; o painel aprova. O que o painel cria vale na hora.
- **Arquivos:** imagem pelo FFmpeg como `server/telas-imagem-offline.js` (conferida pelo conteúdo, até 15 MB e 16 MP; JPEG
  sem metadados, até 2 MB), em `graphics/tvcmedia-<uuid>.jpg`; trocar ou apagar apaga o arquivo; limpeza de 6 em 6 h dos
  órfãos. Logomarca: PNG com transparência, até 512×512.
- **Fontes externas** (pacote B): busca só no servidor, em segundo plano, com `safeFetch` (só https, prazo, teto de 2 MB,
  sem seguir para endereço interno), cache por fonte, uma busca por vez por fonte, teto por hora por cliente; erro fica
  na fonte e o último resultado bom continua por 6 h. Texto limpo de HTML e de caracteres de controle; o painel e o app
  escrevem como texto.
- **Isolamento:** o cliente vem da credencial; unidade, grupo, tela, mídia, playlist de outro cliente = 404.
- **Limites:** 2.000 mídias, 200 playlists, 100 layouts, 300 grades, 50 fontes, 20.000 pessoas, 2.000 comunicados ativos,
  200 indicadores por cliente.

---

## 6. Painel: o menu "TV Corporativa"

`public/admin/views/tvcorp.js` (a casca e as abas) e um arquivo por aba, no padrão do `prefeitura-*.js`; estilo em
`public/admin/tvcorp.css`. Textos em português simples, escritos com `textContent`.

| Aba | O que tem | Pac. |
|---|---|---|
| **Resumo** | cartões: telas no ar / sem imagem / desligadas, itens em exibição agora, horas em exibição (hoje, 7, 30 dias), pedidos aguardando; a lista das telas desligadas com "desde quando" | C |
| **Telas** (Meus players) | lista e mapa das unidades, cada tela com situação, captura, "o que está passando agora", comandos, horário liga/desliga, volume, layout de reserva; "+ TV box" gera a chave | C |
| **Unidades e grupos** | unidades (tipos corporativos), usuários e link da unidade, grupos manuais e automáticos | C |
| **Mídias** (Minhas mídias) | biblioteca: enviar imagem (arrastar e soltar), criar slide por modelo com a prévia, validade, aprovar | C |
| **Playlists** | montar a sequência (arrastar), tempo por item, validade e dias por item, itens automáticos (aniversariantes, notícias, indicadores, comunicados) | C |
| **Layouts** | escolher um modelo de fábrica e ajustar as zonas (arrastar as bordas num quadro 16:9 ou 9:16), cor de fundo | C |
| **Grade** (Grades de programação) | a semana em colunas, blocos por faixa de horário e alcance, a prévia "o que cada tela mostra agora" | C |
| **Notícias e dados** (Agência de notícias) | fontes RSS da lista livre (seção 7.3) ou próprias, cotações, clima por unidade, trânsito; "Testar" | C (B dá as rotas) |
| **Indicadores** | KPIs com meta, faixas de cor, fonte (manual, planilha CSV, JSON, API) e o gráfico | C |
| **RH** | aniversariantes (lista, importar e exportar CSV, consentimento da foto), admissões, comunicados por categoria com "Li" e quem leu | C |
| **Barras e blocos** (Barra inferior, Barra lateral, Bloco informativo) | o texto rolante (avisos e fontes), os blocos da lateral, os widgets (contador, dias sem acidente, relógio mundial, cardápio) | C |
| **Alertas** | o mesmo editor dos alertas da prefeitura, com o alcance por unidade, grupo e raio (comunicado urgente / evacuação) | C (reusa) |
| **Aprovações** | a fila com prévia, aprovar e devolver com motivo | C (reusa) |
| **Celular** (App) | gerar o endereço do celular (QR para imprimir), a caixa de sugestões | C |
| **Relatórios** | relatório de exibição (por item, tela, unidade, período; CSV e imprimir), horas em exibição, disponibilidade das telas | C |
| **Comandos** (Comandos enviados aos players) | o histórico com filtro por tela e período | C |
| **Instalar o aplicativo** | o roteiro (TV box Android 7 ou mais novo, baixar pelo QR ou pelo endereço, abrir, digitar a chave), versão disponível, o QR do APK | C |
| **Configurações** | logomarca, cores, fuso, aprovação, datas comemorativas, PIN de saída padrão, imagem sem internet | C |

A **prévia** de layout e de slide fica em `public/shared/tvcorp-previa.js` + `.css` (como `telas-previa.js`): desenho do
que o app foi programado para mostrar, sem estilo inline (usável depois no link da unidade com a CSP estrita).

O **link da unidade** (`public/reparticao/`, família F11) ganha `public/reparticao/rep-tvcorp.js`: publicar comunicado e
imagem na própria unidade, aniversariantes dela, ver as telas dela. Tudo pela aprovação quando ligada.

---

## 7. Restrições

### 7.1 Textos

- Nenhum nome de concorrente em painel, app, site, manual ou comentário de código voltado ao produto.
- Português do Brasil simples, frases curtas, sem sigla sem explicação ("relatório de exibição", não "proof of play";
  "tela" ou "TV box", não "player", nos textos do produto; "player" só nesta especificação).
- Site: sem preços (memória do dono), sem 720p, sem concorrentes.

### 7.2 Privacidade (LGPD)

- **Aniversariantes: só nome e dia/mês.** Não existe coluna de ano de nascimento; a importação por CSV descarta o ano se
  vier. Nome exibido reduzido como na senha (primeiro nome + inicial do sobrenome), com a opção "nome completo" por empresa.
- Foto do funcionário só com o consentimento marcado por pessoa ("A pessoa autorizou a foto na TV"); sem ele, o app
  desenha as iniciais. Desmarcar apaga a foto do armazenamento na hora. Foto recodificada sem metadados.
- Tempo de casa usa a data de admissão (dado de trabalho), mostrada como "5 anos de casa".
- Pessoa desligada: `active = 0` some das telas no próximo `rev`; a exclusão apaga a linha.
- "Li": só o nome ou matrícula que a pessoa digitar, como no `interna`; nada de rastreio de celular.
- Sugestões anônimas por padrão; o IP não é guardado.
- Indicadores: nunca dado individual de funcionário (ranking só por equipe, unidade ou turno; o painel avisa).

### 7.3 Fontes externas permitidas

| Dado | Fonte | Observação |
|---|---|---|
| Clima | `server/weather.js` (provedor escolhido no Superadmin): **INMET** (público, sem chave) ou **Open-Meteo plano comercial** (com chave) | o plano gratuito do Open-Meteo é só para uso não comercial: TV corporativa é uso comercial, então só com a chave paga ou pelo INMET |
| Geocódigo das unidades | Nominatim (`server/telas-geocode.js`, com as regras do serviço já respeitadas) | só o texto do endereço |
| Mapa | quadros do OpenStreetMap com o crédito | como o mapa da prefeitura |
| Notícias | **Agência Brasil (EBC)**, conteúdo sob licença Creative Commons BY (citar a fonte), feeds RSS oficiais do **gov.br**, **Agência Senado** e **Agência Câmara** (uso livre com crédito); o RSS da própria empresa | só título, fonte, hora e o QR para a matéria; **nada de portais comerciais** (precisam de contrato de licença). O crédito "Fonte: …" sempre na tela |
| Cotações | **AwesomeAPI** (já usada no CG, sem chave) e **PTAX do Banco Central** (dados abertos, `olinda.bcb.gov.br`) | com a hora da cotação e "valores de referência" |
| Trânsito | só as ocorrências do COR no Rio (`server/transito-rio.js`); nas outras cidades, avisos escritos | |
| Rádio (F2) | Radio Browser (`server/radios.js`, já em uso) | direitos de execução pública (ECAD) são do cliente: o painel avisa |
| Datas comemorativas | lista fixa no código (feriados nacionais e datas do calendário corporativo) | sem consulta externa |
| Redes sociais (F2) | só as contas do próprio cliente pelas APIs oficiais, com o token dele (como o CG) | moderação obrigatória |
| Esportes, celebridades, horóscopo | **não** | direitos e qualidade da fonte |

O app **nunca** busca nada fora: tudo vem pronto do servidor (o app só baixa os arquivos que o servidor indicou).

---

## 8. Pacotes de trabalho (4 agentes em paralelo + coordenador)

Cada pacote numa branch e worktree próprias, mexendo **só nos arquivos listados**. O que liga os pacotes ao resto do
sistema fica com o **coordenador**, num commit de integração depois.

### Passo 0 (coordenador, antes de abrir os pacotes, ~1 h)

1. Escrever a seção nova do contrato (`nexa-ferramentas/telas-contrato.md`, "Sinalização corporativa") a partir da seção 4
   deste documento: é a fonte única para A, C e D.
2. Criar `public/shared/tvcorp-tipos.js` com o **esqueleto** do catálogo (nomes das zonas, tipos de item, chaves dos
   modelos de layout e de slide, categorias de comunicado, limites). A é dono do arquivo depois do passo 0 (só acrescenta);
   C e D só leem.

### Pacote A: servidor do conteúdo, grade e exibição

- **Arquivos (novos):** `server/tvcorp.js` (banco e rotas `/api/tvcorp/*` da seção 5.2 marcadas A, `createTvcorp({ db,
  audit, storage, ffmpeg, dataFor, … })` com `mount(app, { needs })`, `signageFor()` e `recordPlays()` exportados),
  `server/tvcorp-core.js` (validações, resolução da grade, montagem do `signage`, sem banco), `server/tvcorp-midia.js`
  (imagem e logomarca pelo FFmpeg), `server/db/schema-tvcorp.js` (3.1), `public/shared/tvcorp-tipos.js` (completa o
  catálogo), testes `test/tvcorp.test.js` e `test/tvcorp-servidor.test.js` (SQLite e Postgres, com o `pg` de teste em
  UTF8).
- **Não toca:** `server/telas*.js`, `server/index.js`, `schema.js`, nada de `public/admin/`.
- **Entrega para o coordenador:** a assinatura de `signageFor` e `recordPlays`, a lista de tabelas para `TELAS_TABLES`,
  `TELAS_COPY`, `TELAS_IDENTITY`, a linha do catálogo de rotas.

### Pacote B: fontes de dados, RH, indicadores e celular

- **Arquivos (novos):** `server/tvcorp-dados.js` (rotas B de 5.2 e 5.3, `createTvcorpDados()` com `mount()` e
  `dataFor(tenantId, officeId, ref)`), `server/tvcorp-fontes.js` (RSS pelo `parseFeed`, cotações, clima por unidade pelo
  `weather.js`, trânsito; leitura de CSV/JSON dos indicadores; só importa de `server/cg/net.js`, `server/cg/sources.js` e
  `server/weather.js`, sem alterá-los), `server/tvcorp-rh.js` (aniversariantes, admissões, importação CSV sem ano,
  comunicados, "Li"), `server/db/schema-tvcorp-dados.js` (3.2), `public/shared/tvcorp-datas.js` (datas comemorativas),
  `public/tvc/` (página do celular: `index.html`, `tvc.js`, `tvc.css`), `public/reparticao/rep-tvcorp.js` (família F11),
  testes `test/tvcorp-dados.test.js` e `test/tvcorp-dados-servidor.test.js` (com provedores falsos, nada de rede).
- **Não toca:** os arquivos do A, `server/cg/*`, `server/weather.js`, `public/reparticao/reparticao.js` (o registro da aba
  F11 é do coordenador).
- **Entrega:** `dataFor`, a lista de tabelas, a rota `GET /tvc/<token>` para o coordenador montar e a CSP da página.

### Pacote C: o painel "TV Corporativa"

- **Arquivos (novos):** `public/admin/views/tvcorp.js` (casca e abas), `public/admin/views/tvcorp-*.js` (um por aba:
  `-resumo`, `-telas`, `-unidades`, `-midias`, `-playlists`, `-layouts`, `-grade`, `-dados`, `-indicadores`, `-rh`,
  `-barras`, `-celular`, `-relatorios`, `-comandos`, `-instalar`, `-config`), `public/admin/tvcorp.css`,
  `public/shared/tvcorp-previa.js` + `.css`, `public/tvcorp/arte/` (fundos próprios), `docs/manual/tv-corporativa.md`,
  testes `test/tvcorp-painel.test.js` (código do painel: `textContent`, sem inline; abas por permissão).
- **Reaproveita sem alterar:** `public/admin/telas-mapa.js`, `public/shared/telas-previa.js`, os editores de alerta e
  aprovação do `prefeitura*.js` (importa as funções exportadas; se precisar de exportar algo novo, pede ao coordenador).
- **Trabalha contra o contrato do passo 0** com dados de exemplo até A e B entrarem; as abas Alertas e Aprovações falam com
  `/api/tvcorp/rede/*`.
- **Não toca:** `index.html`, `main.js`, `prefeitura*.js`, `menu-names.js`.

### Pacote D: o app Android (NEXA Telas 1.3.0)

- **Arquivos (novos):** `core/Signage.kt` (leitura do `signage`, escolha do bloco pela hora, sem Android: testável),
  `core/SignageCache.kt` (baixa, confere SHA-256, guarda, apaga os antigos; reaproveita o `OfflinePlan`/`OfflineFetch`
  sem mudar o comportamento deles), `core/PlayLog.kt` (contagem para o `plays`), `SignageLayout.kt` (monta as zonas em
  `FrameLayout` por porcentagem), `SignageViews.kt` (playlist com troca suave, os modelos de slide desenhados em código,
  aniversariantes, KPI com barra de meta, notícias, cotações, contador, dias sem acidente, relógio mundial, logomarca),
  testes `SignageTest.kt` e `PlayLogTest.kt`.
- **Pontos de ligação dentro do app (pequenos, do próprio D):** `core/Config.kt` (um campo opcional `signage`),
  `Engine.kt` (passar `plays` no sinal de vida), `MainActivity.kt` (com `signage`, montar o `SignageLayout` e pôr a
  **mesma** `VideoFrame`/`PlayerHost` dentro da zona `video`; sem `signage`, tudo como hoje).
- **Proibido:** mudar `PlayerHost.kt`, a escolha da fonte (HLS, reserva, offline), o buffer, o codec, a superfície do
  vídeo. Nada de segundo player, WebView ou áudio nesta fase.
- **Entrega:** APK pelo `scripts/telas-app-publicar.mjs` (versionCode novo), capturas das zonas numa TV box.

### Coordenador: integração (depois de A e B; C e D podem entrar em seguida)

| Arquivo | O que muda |
|---|---|
| `public/shared/funcionalidades.js` | a funcionalidade `tvcorp` (seção NEXA Telas, `optIn: true`, `legacy: false`, `views: ['tvcorp']`, `routes: ['* /api/tvcorp*']`, guards do celular e da TV box) |
| `server/authcore.js` | a permissão `tvcorp.manage` |
| `public/admin/index.html` | `<a href="#tvcorp" data-view="tvcorp" hidden>` **logo depois** do item Prefeitura (com o selo `tvBadge`), a `<section id="view-tvcorp">` e o `<link>` do `tvcorp.css` |
| `public/admin/main.js` | `import tvcorp`, `VIEWS`, `tvcorp: { view: 'tvcorp.manage' }`, o selo (`/api/tvcorp/badge`); a regra do Comercial **não** muda |
| `server/menu-names.js` | `'tvcorp'` em `MENU_VIEWS` logo depois de `'prefeitura'` (e no perfil Broadcast, `tvcorp: 'DIGITAL SIGNAGE'`) |
| `server/telas.js` | `available()` = `prefeitura` **ou** `tvcorp`; `contractConfig` recebe `signage` (via `signageFor`); o sinal de vida repassa `plays`; o `mountPanel` montado também sob `/api/tvcorp/rede` com a permissão `tvcorp.manage` (os pedaços só de prefeitura, como município e Defesa Civil, ficam fora desse prefixo); `PAGE_FILES` com `rep-tvcorp.js` |
| `server/telas-core.js` | `contractConfig({ …, signage })` acrescenta a chave só quando vem |
| `public/shared/telas-tipos.js` | os tipos corporativos e a família F11 (5.1) |
| `public/reparticao/reparticao.js` | registrar a aba F11 (`rep-tvcorp.js`) |
| `server/db/schema.js`, `server/db/schema-telas.js`, `server/db/sqlite.js` | registrar as DDL de A e B, as tabelas em `TELAS_TABLES`, `TELAS_COPY`, `TELAS_IDENTITY` |
| `server/index.js` | `createTvcorp` e `createTvcorpDados` (com `dataFor` de B injetado em A), `mount`, a página `/tvc/<token>` com a CSP dela, `/telas/heartbeat` continua fora da auditoria |
| `server/platform.js` | nada (a exclusão já percorre `TELAS_TABLES`), só conferir os arquivos de `graphics/tvcmedia-*` e `tvclogo-*` na limpeza |
| `docs/TELAS.md`, `CHANGELOG`, `docs/WINDOWS-MUDANCAS.md` se couber | a seção nova apontando para este documento |
| `vercel.json` / CSP do painel hospedado | só se a prévia precisar (não deve: imagens já são `https:`) |

**Ordem e dependências**

```
Passo 0 (coordenador: contrato + esqueleto do catálogo)
   ├── A (servidor do conteúdo) ─┐
   ├── B (dados, RH, celular) ───┼── Integração 1 (coordenador: schema, rotas, modo, menu) ── publicar
   ├── C (painel, contra o contrato; liga às rotas reais depois de A e B) ─┘          │
   └── D (app 1.3.0, contra o contrato; teste de ponta a ponta depois da Integração 1) ── publicar o APK
```

- A e B não dependem um do outro (B entrega `dataFor`; A recebe por injeção e, sem ele, os itens automáticos saem vazios).
- C depende do formato (passo 0), não do código de A e B.
- D depende só do contrato; a prova numa TV box real é depois da integração 1.
- Publicação em **um lote** (cada publicação derruba o ar ~1 min): integração 1 com A, B e C juntos; o APK 1.3.0 depois,
  pelo `latest.json`, sem mexer no servidor.

---

## 9. Decisões para o dono (fase 2)

1. **Vídeo por segmento** (um vídeo só numa unidade ou grupo, sem passar pelo canal): pede um segundo player no app,
   separado do player do canal. Custo: memória e decodificador nas TV box baratas; risco de travar. Recomendação: só em
   layouts sem o vídeo do canal ("Só conteúdo"), com teste em 720p na TV box antes.
2. **Página da web / BI por endereço** (zona com WebView): o Android das TV box tem WebView, mas páginas pesadas travam e
   painéis com login expiram. Recomendação: começar pela imagem enviada pela API (fase 1) e liberar a WebView só para
   endereços cadastrados, sem JavaScript de ponte.
3. **Som ambiente / rádio**: segundo player de áudio e direitos de execução pública (ECAD) do cliente.
4. **Videowall / telas sincronizadas**: precisa de relógio comum e controle fino do player.
5. **Curtidas e comentários no celular** e **mural de redes sociais**: moderação e identidade do funcionário.
6. **PDF e PowerPoint**: conversão no servidor (pede um conversor novo na imagem do servidor) ou só imagem exportada.
7. **Nome da funcionalidade no Superadmin e no site**: "TV Corporativa" (sugestão) e se entra em algum plano.

## 10. Testes esperados (sem rodar suítes pesadas juntas)

- Regras puras: resolução da grade (prioridade, dia, faixa que vira a noite, validade), montagem do `signage` (tetos,
  `rev` estável com dados de fonte segurados por 15 min), limpeza de CSV sem ano, redução do nome, limites de texto.
- Servidor (SQLite e Postgres): modo desligado (403 `feature_unavailable` no painel; a TV box só com um dos modos),
  isolamento entre clientes, aprovação, `plays` somados e ignorados quando fora do que a tela recebeu, arquivos apagados
  ao trocar, auditoria sem segredos, a tela da prefeitura sem `signage`.
- App: `SignageTest` (bloco certo por hora, virada do dia, fallback), `PlayLogTest` (zera só depois do 200), cache por
  SHA-256; prova manual na TV box de teste com captura de cada modelo de layout.

---

## Entrega do pacote B (branch `feat/tvcorp-b-dados`)

Arquivos: `server/tvcorp-dados.js` (rotas e `dataFor`), `server/tvcorp-fontes.js` (fontes de fora, indicadores),
`server/tvcorp-rh.js` (regras puras de RH e comunicados), `server/db/schema-tvcorp-dados.js`, `public/shared/tvcorp-datas.js`,
`public/tvc/` (`index.html`, `tvc.js`, `tvc.css`), `public/reparticao/rep-tvcorp.js`, testes `test/tvcorp-dados.test.js` e
`test/tvcorp-dados-servidor.test.js` (SQLite e Postgres, provedores falsos, nada de rede).

### Assinatura

```js
import { createTvcorpDados, TVC_HEADERS } from './tvcorp-dados.js';
const dados = createTvcorpDados({
  db, audit: access.audit, ipOf: clientIp, publicUrl: telasOrigin,
  available: (tenantId) => …,                 // prefeitura OU tvcorp ligado (o mesmo de server/telas.js)
  weatherOf: (ibge) => weatherForecast(ibge), // server/weather.js
  trafficOf: (ibge) => transitoRio.forCity(ibge), // opcional: só o Rio
  settingsOf: undefined,                      // padrão: lê tvcorp_settings.data (pacote A) — chaves approval, fullNames, dates, tz
  isCorpOffice: (o) => …,                     // padrão: tipos de §5.1; trocar pelo `corp: true` do catálogo
  files: { dir: path.join(config.dataDir, 'telas', 'tvcorp') }, // fotos e imagens das sugestões (tvcpessoa-*.jpg, tvcsug-*.jpg)
  photoUrl: (name) => `https://…/${name}`,    // opcional: sem ele a TV desenha as iniciais (a foto não vai)
});
dados.mount(app, { needs, office, gestorOnly, note, apiKey });   // cada parte só monta se a dependência vier
createTvcorp({ …, dataFor: dados.dataFor });                     // pacote A
// relógio: dados.tick() a cada minuto já roda sozinho (timers: true); dados.prune() na limpeza de 6 h;
// dados.dropOffice(x, tenantId, officeId) na transação que apaga a unidade; dados.pending(tenantId) para o selo.
```

`dataFor(tenantId, officeId, ref, ctx?)` -> item | item[] | null. `ref`: `'birthdays'` (params.range day|week|month,
params.scope office|all), `'welcome'`, `'tenure'`, `'dates'`, `'news:<feed>'`, `'quotes:<feed>'`, `'traffic:<feed>'`,
`'weather[:<feed>]'` (sem id: a fonte da unidade), `'kpi:<id>'`, `'post[:<id>]'` (sem id: a LISTA dos em vigor),
`'widget:<id>'`, `'menu'`/`'countdown'`/`'safety'`/`'worldclock'`; ou `{ ref_kind, ref_id, params }`. `ctx` = `{ deviceId,
groupIds, regionId }` para o alcance dos comunicados. Formatos (o que o app lê): birthdays `{title, people[{name, day, month,
sector, initials, photo?}]}` (sem ano); kpi `{name, value, target, unit, band, direction, points}`; news `{source, items[{title,
source, at, qr?}]}` (trânsito sai como news); quotes `{source, note, at, items[{label, value, change, prefix, decimals}]}`;
menu `{title, day, items[{name, price?}]}`; countdown `{title, target, text}`; safety `{since, days, record, goal}`;
worldclock `{clocks[{label, tz}]}`; post `{category, header, title, body, qr?, mediaId?, date}` (o pacote A troca `mediaId`
pela `image` com url+sha256+bytes); welcome/tenure/dates saem como `slide` (`boas-vindas`, `reconhecimento`,
`data-comemorativa`). Dado de fonte segurado no banco (refresh mínimo 15 min; mais de 6 h sem busca boa = null).

### Tabelas (para `TELAS_TABLES`, `TELAS_COPY`, `TELAS_IDENTITY`)

`tvcorpDadosDDL(d)` e as listas `TVCORP_DADOS_TABLES` (ordem de exclusão), `TVCORP_DADOS_COPY` (ordem de cópia) e
`TVCORP_DADOS_IDENTITY` em `server/db/schema-tvcorp-dados.js`: `tvcorp_feeds`, `tvcorp_people`, `tvcorp_posts`,
`tvcorp_post_acks`, `tvcorp_kpis`, `tvcorp_kpi_points`, `tvcorp_widgets`, `tvcorp_mobile`, `tvcorp_suggestions`. Colunas além
da §3.2 (todas em tabela nova): `tried_at` (feeds e kpis), `photo_sha`/`photo_bytes`, `created_via`/`decided_by`/`decided_at`
(posts), `who_key` (acks), `mobile_id`/`reason`/`decided_*` (sugestões). Nenhuma coluna de ano de nascimento.

### Rotas

- Painel (`tvcorp.manage`): `/api/tvcorp/feeds[/:id][/test]`, `/people[/:id]`, `/people/import` (CSV cru `text/csv` ou
  `{csv}`, até 4 MB), `/people/export`, `/people/:id/photo` (PUT imagem crua, GET, DELETE), `/posts[/:id]`, `/posts/:id/acks`,
  `/posts/:id/decide`, `/kpis[/:id]`, `/kpis/:id/value`, `/kpis/:id/test`, `/widgets[/:id]`, `/mobile[/:id]`, `/suggestions`,
  `/suggestions/:id/file`, `/suggestions/:id/decide`, `/dados/pending`, `/dados/catalog`. Auditoria por `res.locals.audit`.
- Celular: `GET /tvc/<token>` (+ `/tvc/tvc.js`, `/tvc/tvc.css`), `GET /api/tvc` (60/min por IP), `POST /api/tvc/ack/:postId`,
  `POST /api/tvc/suggest`, `PUT /api/tvc/suggest/:id/image` (até 5 MB, 10 min depois da sugestão) (10/min por IP; 60
  sugestões/h por endereço). Token SÓ em `Authorization: Bearer`; o nome do "Li" em `X-Tvc-Who` (URI-encoded).
- Link da unidade (F11, só gestor e só tipo corporativo): `GET /api/reparticao/tvcorp`, `/posts[/:id]`, `/posts/:id/acks`,
  `/people[/:id]`, `/people/import`. Com a aprovação ligada, o comunicado da unidade volta 202 e fica `pending`.
- Integração (`apiKey` põe `req.tenantId`; opcional `req.apiOfficeId`, `req.apiName`): `POST /api/tvcorp-api/posts`,
  `POST /api/tvcorp-api/kpis/:id/value` (60/min por cliente).

### CSP da página do celular (`TVC_HEADERS`)

`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'none';
base-uri 'none'; frame-ancestors 'none'`, com `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`,
`X-Frame-Options: DENY`, `Cache-Control: no-store`. O `mountMobile` já serve com eles; nada a acrescentar no `index.js`.

### Para o coordenador

1. `schema.js`/`schema-telas.js`/`sqlite.js`: registrar `tvcorpDadosDDL` e as três listas.
2. `index.js`: criar e montar como acima; `/tvc/` e `/api/tvc*` são públicos (sem sessão) e não passam pela guarda do plano
   do painel (a guarda é o `available` do próprio módulo); `/api/tvcorp-api/*` pela chave com a funcionalidade `api`.
3. Rota da foto para a TV box (se quiser a foto na tela): servir `dados.readFile(name)` com o token do aparelho e passar
   `photoUrl`. Sem isso o app desenha as iniciais.
4. `reparticao.js`: abas F11 `publicar`, `comunicados`, `aniversariantes` de `rep-tvcorp.js` (`stop()` na saída) e
   `rep-tvcorp.js` em `PAGE_FILES` de `server/telas.js`. Classes usadas: as de `reparticao.css` (`r-btn small danger`).
5. Endereços do catálogo de notícias (`NEWS_CATALOG` em `tvcorp-fontes.js`) a conferir no "Testar" em produção.

## Entrega do pacote A (servidor do conteúdo, grade e exibição)

Branch `feat/tvcorp-a-servidor`. Arquivos novos: `public/shared/tvcorp-tipos.js` (catálogo, passo 0),
`server/db/schema-tvcorp.js`, `server/tvcorp-core.js` (regras sem banco), `server/tvcorp-midia.js` (imagem e logomarca
pelo FFmpeg), `server/tvcorp.js` (banco e rotas), `test/tvcorp.test.js`, `test/tvcorp-servidor.test.js` (express mínimo,
SQLite e Postgres em UTF8, FFmpeg de verdade). Nada fora disso foi tocado.

### Montar (server/index.js)

```js
import { createTvcorp } from './tvcorp.js';
const tvcorp = createTvcorp({
  db,                                   // server/db.js
  storage: {                            // graphics/ (como offlineImages do telas): tvcmedia-<uuid>.jpg e tvclogo-<uuid>.png
    dir: config.graphicsDir,
    put: (name) => storage.put('graphics', name),
    remove: (name) => storage.remove('graphics', name),
    url: (name, req) => { const u = storage.url('graphics', name); return !u ? null : isUrl(u) ? u : `${telasOrigin(req)}${u}`; },
    read: async (name) => { /* igual ao offlineImages.read */ },
    list: async () => [...await storage.list('graphics', 'tvcmedia-'), ...await storage.list('graphics', 'tvclogo-')].map((f) => ({ name: f.name, mtime: f.mtimeMs })),
  },
  ffmpeg: config.ffmpeg, checkImage,    // server/cg/env.js
  dataFor: dados.dataFor,               // pacote B (sem ele, os itens automáticos saem vazios)
  labelFor: undefined,                  // opcional (B): (tenantId, refKind, refId) -> nome, para os relatórios
  refExists: undefined,                 // opcional (B): (tenantId, refKind, refId) -> bool, confere ids na playlist
  decideOther: undefined,               // opcional (B): aprovação do tipo tvc-post pela fila /api/tvcorp/approvals
  hasFeature: (tid, key) => tenancy.hasFeature(tid, key), // sem ele a rota /api/tvcorp-api/* não monta
  forget: (tenantId) => telas.forget(tenantId),           // refaz o rev das telas a cada mudança
  audit: access.audit, ipOf: clientIp,
});
tvcorp.mount(app, { needs });           // /api/tvcorp/* (needs('tvcorp.manage') + acesso a todos os canais) e /api/tvcorp-api/*
// link da unidade (F11), dentro do mountOffice do telas.js: guard = [office, gestorOnly]; note = a auditoria do link
tvcorp.mountOffice(app, { guard: gestor, note });
```

A guarda do plano `* /api/tvcorp*` (funcionalidade `tvcorp`) continua no catálogo; a rota da chave de integração confere
`tvcorp` e `api` por conta própria (`hasFeature`).

### Ligações no server/telas.js

- `/api/telas/config`: `signage = await tvcorp.signageFor(tenantId, deviceRow, officeRow, groupIds, { req })` e
  `contractConfig({ …, signage })` acrescenta a chave só quando não é `null`. Devolve `null` fora das unidades corporativas
  (tipos de `TVC_OFFICE_TYPE_KEYS`, os mesmos da §5.1) e quando nenhuma grade pega a tela. Os dados de fonte ficam
  segurados 15 min dentro do módulo: o `rev` fica parado.
- `/api/telas/heartbeat`: a CADA sinal de vida aceito, `await tvcorp.recordPlays(tenantId, deviceRow, req.body, { office:
  officeRow, groups: groupIds, req })` (soma as horas ligadas mesmo sem `plays`; devolve `{ accepted, ignored }`). Aceita o
  `plays` + `playsDay` do app (até 100 entradas, um dia por envio; dia de hoje ou de ontem). Só conta o que a tela recebeu
  nas últimas 48 h.
- Exclusão da unidade (dentro da transação): `await tvcorp.dropOffice(x, tenantId, officeId)`.
- B avisa que os dados mudaram (comunicado novo, indicador): `tvcorp.forgetData(tenantId)` (o próximo /config busca de novo).
- `tvcorp.prune()` roda de 6 em 6 h sozinho (`timers: true`): arquivos órfãos com mais de 1 h e relatório com mais de 400
  dias. `tvcorp.stop()` para o relógio.

### Tabelas (server/db/schema-tvcorp.js)

`tvcorpDDL(d)` (registrar no `sqliteDDL`/`pgDDL` como o `telasDDL`) e as listas:
`TVCORP_TABLES` = `tvcorp_settings, tvcorp_media, tvcorp_playlists, tvcorp_playlist_items, tvcorp_layouts,
tvcorp_schedules, tvcorp_plays, tvcorp_hours` (para `TELAS_TABLES`), `TVCORP_COPY` (a mesma, para `TELAS_COPY`) e
`TVCORP_IDENTITY` = `tvcorp_media, tvcorp_playlists, tvcorp_playlist_items, tvcorp_layouts, tvcorp_schedules`
(para `TELAS_IDENTITY`). `tvcorp_settings` tem `tenant_id` como chave primária; `data` guarda `theme`, `tz`, `approval`,
`fullNames`, `dates`, `categories`, `defaultSchedule` e `logo` (as mesmas chaves que o pacote B lê).

### Rotas (para o catálogo de rotas)

Painel: `GET /api/tvcorp`, `/badge`, `/summary`; `PUT /settings`; `GET|PUT|DELETE /settings/logo`; `GET|POST /media`,
`POST /media/image` (imagem crua; `?title&caption&seconds&officeId&orientation=land|port&fit=cover|contain&bg=rrggbb`),
`GET|PATCH|DELETE /media/:id`, `PUT /media/:id/image`, `GET /media/:id/file`; `GET|POST /playlists`, `GET|PATCH|DELETE
/playlists/:id`, `PUT /playlists/:id/items`; `GET|POST /layouts`, `GET|PATCH|DELETE /layouts/:id`; `GET|POST /schedules`,
`GET|PATCH|DELETE /schedules/:id`, `POST /schedules/preview`; `GET /devices/:id/now`; `GET /commands?deviceId&from&to`;
`GET /reports/plays?from&to&by=item|device|office&format=csv`; `GET /reports/hours?from&to&format=csv`;
`GET /approvals`, `POST /approvals/:id/decide` (`{ approve, note }`; tipos `tvc-media` e `tvc-schedule`; `tvc-post` pelo
`decideOther`). Link da unidade: `GET|POST /api/reparticao/tvcorp/media`, `POST …/media/image`, `GET …/media/:id/file`,
`DELETE …/media/:id` (só a própria unidade; com a aprovação ligada nasce `pending` e entra em `telas_approvals`).
Integração: `POST /api/tvcorp-api/media/image` (Bearer da chave da unidade; `?id=` troca a imagem mantendo o id; 30 por
minuto por chave).

### Formato do `signage` montado (o que o app 1.3.0 lê)

- Bloco: `{ id: 's<grade>', layout: { orientation, background (só cor), zones[{ id, kind, x, y, w, h, title?, text?, qr? }] },
  days[0..6], from, to (minutos; from > to = vira a noite), dateFrom, dateTo, zones: { zona: itens } }`; até 12 blocos; o
  padrão da empresa (`settings.defaultSchedule`) vai por último com todos os dias e 0 a 1440, e o id dele em `fallback`.
- `image`: `{ id: 'm<id>', kind, seconds, url, sha256, bytes, caption?, fit: 'contain' }` (a imagem já sai no quadro).
- `slide`: `{ id: 'm<id>', kind, seconds, template, fields }`; `fields.image` vira `{ url, sha256, bytes }`; `lines[]` quando
  o texto tem mais de uma linha; `items[]` no `cardapio`; `kpi { value, target?, unit? }` no `indicador`; `target` (data e
  hora) no `evento`. Cartão (`c<id>`): slide `comunicado` com `title`, `text`, `lines[]`.
- Itens do pacote B (birthdays, kpi, news, quotes, menu, countdown, safety, worldclock, post) passam como vieram; o `mediaId`
  do comunicado vira `image { url, sha256, bytes }` (sem arquivo válido, a chave some). Pedido ao B:
  `dataFor(tenantId, officeId, { ref_kind, ref_id, params }, { deviceId, groupIds, regionId })`; "todos os comunicados" =
  `ref_kind: 'post'` sem id (segurado por tela).
- Restrições de item, só quando há: `days`, `from`/`to` (minutos), `dateFrom`/`dateTo` (o app confere sozinho).
- Tetos aplicados no servidor: 60 itens por zona, 200 arquivos e 80 MB somados.

### O que ficou com o coordenador

- Foto dos aniversariantes (pacote B, `photoUrl`): o pacote A não serve os arquivos do B. Caminho mais simples: o B guardar
  as fotos no mesmo `graphics/` (ou servir `dados.readFile` por rota com o token do aparelho) e passar o `photoUrl`; o A
  expõe `tvcorp.mediaFileFor(tenantId, mediaId, req)` para quem precisar do arquivo de uma imagem da biblioteca no formato
  do contrato.
- `available()` do telas.js, a funcionalidade `tvcorp`, `tvcorp.manage`, menu e F11: como no quadro do coordenador (§8).
