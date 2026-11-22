# NEXA Telas: modo prefeitura e Painel da Prefeitura

O **NEXA Telas** leva o canal da prefeitura a uma rede de **TV box Android** em prédios públicos (escolas, UBS, UPA, hospitais, CRAS, a sede), **sem comerciais**. O NEXA Broadcast faz o lado do servidor e do painel: o **modo prefeitura** (uma funcionalidade do plano), o **Painel da Prefeitura** (mapa, telas, grupos, repartições, regiões e alertas), a **API da TV box** e a **página de controle da repartição**. O app da TV box é outro projeto e fala com o servidor só pelo contrato `nexa-ferramentas/telas-contrato.md` (a fonte única da API do aparelho).

Código: `server/telas.js` (banco e rotas), `server/telas-core.js` (regras sem banco), `server/telas-senha.js` + `server/telas-senha-core.js` (chamada de senha), `server/telas-conteudo.js` + `server/telas-conteudo-core.js` (cartões, clima, vídeos guardados, aprovação, modo eleitoral, EAS e tela desligada), `server/db/schema-telas.js` (esquema), `public/shared/telas-tipos.js` (catálogo: tipos, módulos, layouts, alcance; o mesmo arquivo no servidor, no painel e na página da repartição), `public/admin/views/prefeitura.js` + `public/admin/telas-mapa.js` + `public/admin/prefeitura.css` (painel), `public/admin/views/prefeitura-fase3.js` (as abas Senhas, Cartões, Sem internet e Aprovações), `server/telas-imagem-offline.js` (a imagem sem internet), `public/reparticao/` (página de controle e o totem de senhas). Manual: `docs/manual/prefeitura-rede-de-telas.md` e `docs/manual/prefeitura-senha-e-cartoes.md`.

As **fases 1 e 2** do blueprint (seções 1 a 9): rede, mapa, avisos, layout, grupos e alertas. As **fases 3 e 4** (seções 10 a 16, contrato §7): chamada de senha, cartões de informação, clima, vídeos guardados, aprovação da SECOM, tela desligada, modo eleitoral e o alerta de emergência do canal nas telas. O que fica para depois está em [O que é fase futura](#o-que-é-fase-futura).

---

## 1. Ligar o modo

O modo prefeitura é a funcionalidade **`prefeitura`** do catálogo (`public/shared/funcionalidades.js`, seção **NEXA Telas**), ligada pelo Superadmin no **perfil de funcionalidades** (ou no plano personalizado) do cliente, como as outras (docs/PLATAFORMA.md, 5.1).

Ela é a primeira funcionalidade **`optIn`** (um *modo*): só vale **citada ligada**. Fica fora do "tudo liberado":

- o plano **Ilimitado** e o **cliente padrão** (id 1) não entram no modo sozinhos. O cliente 1 só entra se o plano dele citar `prefeitura: true` (`allFeaturesWith`);
- o **Liberar tudo** do editor de perfis e o rascunho **Broadcast** não a ligam;
- plano antigo (gravado antes do catálogo): desligada (`legacy: false`).

O motivo: ligar o modo também **tira** coisas do painel. Com ele, o menu **Comercial** some (`public/admin/main.js`); os dados do Comercial e as rotas dele ficam como estão (nada é apagado, e desligar o modo traz o menu de volta).

Com o modo desligado:

| Porta | Resposta |
|---|---|
| Painel (`/api/prefeitura*`) | `403 feature_unavailable` pela guarda do plano (`createPlanGate`), como toda funcionalidade guardada; o menu **Prefeitura** não aparece |
| TV box (`/api/telas/*`, com token) | `403 { code: "unavailable" }`: **não** é token revogado, o app guarda o token e segue com a última configuração |
| Ativar (`POST /api/telas/activate`) | `404`, a mesma mensagem da chave inexistente |
| Link de controle | o login responde `401` como senha errada; a sessão aberta cai |

Permissão: **`prefeitura.manage`** (área "NEXA Telas"). O grupo **Administradores** recebe sozinho (tem todas); os outros grupos, só se o administrador der. A rede é do cliente inteiro: grupo limitado a alguns canais não entra (`403`, como no Comercial).

## 2. Modelo de dados

Tabelas em `server/db/schema-telas.js`, uma DDL para SQLite e Postgres, só `CREATE TABLE/INDEX IF NOT EXISTS` (nada muda em tabela antiga, sem chave estrangeira). Toda tabela tem `tenant_id` e toda consulta filtra por ele.

| Tabela | O que guarda |
|---|---|
| `telas_regions` | bairros e distritos: nome e cor |
| `telas_offices` | repartições: nome, tipo, endereço, `lat`/`lng`, região, responsável e contato, `modules` e `config` (JSON), canal; link de controle (`link_hash`, `link_pass`, `link_ver`, `link_at`) |
| `telas_devices` | telas (TV box): nome, repartição, ponto próprio (opcional), `token_hash`, modelo, Android, versão do app, o último sinal de vida (`last_seen`, `online_since`, `state`, `source`, `net`, `last_error`, `uptime_sec`, `locked`, `rev_seen`), `shot_at`, `revoked_at`, `config` (JSON) |
| `telas_groups` | grupos de telas: nome, cor, descrição, `office_type` (NULL = manual; com o tipo = automático), `sort`, `config` (JSON: avisos e layout) |
| `telas_group_devices` | tela ↔ grupo manual (uma tela pode estar em vários) |
| `telas_keys` | chaves de acesso: `key_hash`, repartição, nome da tela, validade, uso |
| `telas_commands` | fila de comandos por tela |
| `telas_alerts` | alertas: título, texto, nível, som, alcance (`scope` + `scope_data` JSON), início, fim, quem mandou, encerramento |
| `telas_alert_deliveries` | as telas que receberam cada alerta (primeira e última vez) |

Fases 3 e 4 (tabelas novas; nenhuma coluna nova em tabela de antes):

| Tabela | O que guarda |
|---|---|
| `telas_office_extras` | uma linha por repartição: `data` em JSON (a configuração da chamada de senha) e o token do totem (`totem_hash`, só o SHA-256) |
| `telas_queue_services` | as filas da repartição: nome, letra(s) da senha, se aceita prioridade, ordem, ativa |
| `telas_queue_tickets` | as senhas: dia (America/Sao_Paulo), código, prioridade (0, 1, 2 = 80+), risco, nome **já reduzido**, situação, guichê, origem (recepção ou totem), as horas (emissão, entrada na fila, 1ª chamada, chamada, fim). Único por repartição, dia e código. 90 dias |
| `telas_queue_calls` | cada chamada (o `id` do contrato §7.2): senha, guichê, repetições, `at` e `shown_at`. 90 dias |
| `telas_cards` | os cartões de informação: tipo, título, linhas (JSON), dia da semana, período, ordem, segundos, classificação |
| `telas_approvals` | a fila da SECOM: tipo (avisos, cartão, alerta), o pedido em JSON, quem pediu, quem decidiu e quando |
| `telas_alert_meta` | a classificação de cada alerta e a marca "sem aprovação" |
| `telas_offline` | os vídeos guardados por nível (`default`, `group`, `office`) |
| `telas_media_hashes` | o SHA-256 de cada vídeo guardado (vale enquanto o arquivo e o tamanho forem os mesmos) |
| `telas_device_events` | as mudanças de situação de cada tela (`on`, `warn`, `off`) |
| `telas_municipio` | o município da prefeitura, uma linha por cliente: código do IBGE, nome, UF, a caixa envolvente (`south`, `west`, `north`, `east`), o contorno simplificado em JSON (`outline`), quando veio e o erro da última tentativa |

Fora do banco: o **padrão da prefeitura** em `settings`, chave `telas:<cliente>` (`{ config, city, update, cidade, electoral, approval, eas, notify }`), e as **capturas** em `DATA_DIR/telas/shots/<cliente>/<tela>.jpg` (só a última de cada tela).

Excluir o cliente (`server/platform.js`) apaga as linhas de todas as tabelas (`TELAS_TABLES`), a chave de `settings` e a pasta das capturas. Excluir um canal não mexe nas repartições: a que apontava para ele passa a tocar o primeiro canal do cliente.

**Migração:** nenhuma ação manual. As tabelas nascem no boot nos dois bancos; as listas da cópia SQLite → Postgres (`COPY_ORDER`, `IDENTITY_TABLES`) já as incluem.

### Catálogo (`public/shared/telas-tipos.js`)

- **Tipos de repartição:** `secom`, `defesa-civil`, `upa`, `hospital`, `ubs`, `caps`, `escola`, `creche`, `cras`, `central-cidadao`, `sine`, `camara`, `cultura`, `terminal`, `outro`.
- **Módulos:** `alertas` (sempre ligado); por repartição: `avisos`, `senha` (chamada de senha) e os que ligam um tipo de cartão: `escala`, `merenda`, `calendario`, `vagas`, `sessao` (pauta), `agenda`, `linhas`. `aprovacao` vale para a prefeitura inteira (liga no padrão da prefeitura). Nenhum é mais "em breve".
- **Layouts:** `full`, `ticker`, `side`, `lbar`, `portrait` e `queue` (a tela só o recebe com a chamada de senha ligada na repartição; senão vai `full`). Blocos da lateral: `clock`, `weather`, `qr`, `queue`.
- **Cartões** (`CARD_KINDS`): merenda, escala, vagas, agenda, pauta, calendário, linhas e aviso da unidade (este sempre disponível).
- **Classificação** (`CONTENT_CLASSES`): utilidade pública (padrão), institucional, emergência. **Risco** (`RISKS`): vermelho, laranja, amarelo, verde, azul.

## 3. Grupos de telas

Um grupo junta telas para receber a mesma informação.

- **Manual:** a prefeitura escolhe as telas; uma tela pode estar em vários grupos.
- **Automático por tipo:** todas as telas das repartições de um tipo (as escolas, as UBS…), sem vínculo gravado: a tela entra e sai do grupo com a repartição. **Criar os grupos automáticos por tipo** cria um grupo para cada tipo em uso.

O grupo pode definir **avisos** e **layout** (nada mais: PIN, volume e sinal reserva não são do grupo) e é um **alcance** de alerta. A ordem dos grupos é o campo `sort` (menor primeiro) e, no empate, a ordem de criação.

## 4. Precedência da configuração

O que cada tela recebe em `/api/telas/config` sai, **campo por campo**, do nível mais específico que define o campo:

**tela > grupos > repartição > padrão da prefeitura > fábrica**

- **Grupos** (só avisos e layout): os **avisos de todos os grupos** da tela que têm avisos, um depois do outro, **na ordem dos grupos**; o **layout do primeiro grupo que define um**. Um grupo sem avisos nem layout não muda nada.
- **Repartição:** com o módulo `avisos` desligado, os avisos dela não contam (vale o nível de baixo).
- Campo vazio num nível = herda do nível de baixo. Para a tela não mostrar avisos, escolha um layout sem texto rolante.
- **Fábrica:** layout `full`, sem avisos, velocidade 60, lateral com o relógio, sequência de saída `UP UP DOWN DOWN OK`, volume 100, sem horário (TV sempre ligada).

O `rev` é o SHA-256 (12 caracteres) do JSON da configuração: qualquer mudança em qualquer nível muda o `rev`, o aparelho vê no sinal de vida e busca a configuração nova (em até 30 s).

### PIN de saída

- O painel define o PIN (4 a 8 dígitos) no padrão da prefeitura, na repartição ou na tela. O servidor guarda **só o sal e o hash**; o aparelho recebe `pinSalt` + `pinHash` e confere no local.
- `pinHash` = SHA-256 em hexadecimal do **texto UTF-8** formado pelo `pinSalt` (o texto hexadecimal, não os bytes) seguido dos dígitos do PIN. Vetor: sal `00ff`, PIN `1234` → `sha256("00ff1234")`.
- **O aparelho nunca recebe o hash vazio** (com ele vazio, a sequência de saída abriria os ajustes sem PIN). Repartição criada sem PIN, numa prefeitura sem PIN padrão, ganha um PIN de 6 dígitos **sorteado**, mostrado **uma vez** na criação. Tirar o PIN de todos os níveis faz o servidor sortear outro para a repartição (que ninguém viu): **PIN novo**, na aba Repartições, sorteia e mostra um.
- O PIN não fica legível em lugar nenhum depois de mostrado. Um PIN de 4 a 8 dígitos com SHA-256 sai por força bruta para quem tiver o sal e o hash: eles só vão ao aparelho da própria tela, pelo token dele. O PIN protege o aparelho de quem está **na frente dele**, não de quem tem o token.

## 5. Rotas

### TV box (contrato `telas-contrato.md`)

`Authorization: Bearer <token>`; todas as respostas com `Cache-Control: no-store` e erro em `{ "error": "…" }`.

| Rota | O que faz |
|---|---|
| `POST /api/telas/activate` | `{ key, device }` → `{ deviceId, token, channel, name }`. Freio por IP (20 em 10 min). `400` malformada; `404` inexistente, usada ou vencida (a mesma mensagem); `429` freio |
| `GET /api/telas/config` | a configuração com `rev`; `ETag` e `If-None-Match` (o `rev` puro ou entre aspas) → `304` |
| `POST /api/telas/heartbeat` | grava o estado; devolve `rev`, `commands` e `alerts` |
| `POST /api/telas/commands/:id/done` | `{ ok, detail }` |
| `POST /api/telas/screenshot` | `image/jpeg` até 400 KB → `204` |

- **Chave:** 8 caracteres de um alfabeto de 32 sem ambíguos (sem I, O, 0, 1), com ou sem hífen, sem diferenciar maiúsculas; uso único de verdade (só quem marca a chave como usada segue); 24 h.
- **Token:** 32 bytes aleatórios (base64url); no banco só o SHA-256. **Revogar** apaga o hash: o aparelho recebe `401` e volta à tela da chave.
- **Sinal de vida:** sem sinal por 120 s = desligada (o servidor calcula). `online_since` é desde quando a tela dá sinal sem parar.
- **Comandos** (`reload`, `restart-app`, `reboot`, `screenshot`): cada um sai **uma vez** (um `reboot` repetido a cada sinal prenderia o aparelho); o que não saiu em 10 min vence; o mesmo comando ainda na fila não empilha.
- **Alertas:** os em vigor **para esta tela** pelo alcance. O id cresce com a criação (o app trata o maior id como o mais novo). A entrega é gravada na primeira vez e a cada 5 min.
- **Captura:** o corpo só é lido depois do token; conferidos o tamanho declarado, o tipo, o teto de 400 KB e a assinatura JPEG (começa em `FF D8 FF`, termina em `FF D9`); até 12 por minuto por tela.
- **`stream.hls`:** o HLS público do canal da repartição (ou do primeiro canal do cliente): `PUBLIC_HLS_URL` > `PLATFORM_PUBLIC_URL` > o host do pedido, mais o caminho do master (`publicPlaylist`). O vídeo vai direto da CDN, nunca pela API.
- **`update`** (opcional): `{ url, sha256, versionCode }` quando a prefeitura define a atualização do app (só `https`); ausente no resto do tempo.

### Painel da Prefeitura (`prefeitura.manage`, acesso a todos os canais)

| Rota | O que faz |
|---|---|
| `GET /api/prefeitura` | tudo de uma vez: padrão, canais, regiões, repartições, grupos, telas, chaves esperando uso |
| `GET /api/prefeitura/status` | o estado das telas (o painel relê a cada 10 s) |
| `PUT /api/prefeitura/defaults` | padrão da prefeitura (`config`) e atualização do app (`update`); `city` (o centro do mapa de antes do município) segue aceito, mas o painel não o grava mais |
| `GET/PUT/DELETE /api/prefeitura/municipio` | o município da prefeitura: `PUT { uf, ibge }` (ou `{ uf, city }`) confere na lista do IBGE, guarda e busca o contorno; a resposta traz `{ municipio: { ibge, name, uf, bbox, outline: { status: ok ou missing, polygons, points, at, error } } }` |
| `POST /api/prefeitura/municipio/outline` | "Tentar de novo": busca o contorno outra vez (6 por minuto por cliente); `{ ok, municipio }` |
| `POST/PATCH/DELETE /api/prefeitura/regions[/:id]` | regiões |
| `POST/PATCH/DELETE /api/prefeitura/offices[/:id]` | repartições (excluir pede as telas revogadas) |
| `POST /api/prefeitura/offices/:id/pin` | PIN novo sorteado, mostrado uma vez |
| `POST/DELETE /api/prefeitura/offices/:id/link`, `PUT …/link/password` | link de controle: gerar (o endereço aparece uma vez), trocar a senha, desligar |
| `POST/DELETE /api/prefeitura/keys[/:id]` | chave de acesso (aparece uma vez) |
| `PATCH/DELETE /api/prefeitura/devices/:id`, `POST …/revoke`, `POST …/commands`, `GET …/screenshot` | telas |
| `POST/PATCH/DELETE /api/prefeitura/groups[/:id]`, `POST /api/prefeitura/groups/auto` | grupos |
| `GET /api/prefeitura/alerts[/:id]`, `POST …/alerts`, `POST …/alerts/preview`, `POST …/alerts/:id/cancel` | alertas, a prévia e as entregas |
| `GET /api/prefeitura/geocode?q=` | "Localizar no mapa" (o mesmo geocodificador do gerador de caracteres, `server/cg/sources.js`) |

Tudo o que muda algo entra na auditoria (`res.locals.audit`), sem segredos.

### Alertas

Campos: título, texto, nível (`info`, `warn`, `critical`), som, início (agora ou agendado) e fim (duração ou "até"; de 1 minuto a 7 dias). Alcance:

| Alcance | Quem recebe |
|---|---|
| `city` | todas as telas da prefeitura |
| `regions` | as telas das repartições das regiões escolhidas |
| `groups` | as telas de um ou mais grupos (manuais ou automáticos) |
| `office` | as telas de uma repartição |
| `radius` | as telas a até N metros de um ponto (haversine sobre o ponto da tela, ou o da repartição); de 100 m a 100 km |

A **prévia** (`/alerts/preview`) diz quantas telas o alcance pega, em quantas repartições, e quantas estão ligadas agora. **Encerrar** tira o alerta das telas no sinal de vida seguinte. O histórico guarda quais telas mostraram cada alerta.

### Painel da repartição (o link de controle)

`/reparticao/<link>` abre o painel de UMA repartição. Ele pede **usuário e senha** (seção 17). Quem entra só alcança aquela repartição:

- vê a situação **das telas dela** e, sendo gestor, **controla as TV box dela** (seção 17);
- troca **os avisos e o layout dela**;
- manda **alerta**: os tipos de alcance amplo (`secom` e `defesa-civil`) alcançam a cidade toda, regiões, grupos, a própria repartição e o **raio no mapa**; **os outros tipos, só as próprias telas**. O alcance `office` é sempre a repartição da sessão (o id do pedido não conta);
- encerra **os alertas que ela mesma mandou**.

Rotas: `POST /api/reparticao/login`, `GET /api/reparticao/state`, `PUT /api/reparticao/avisos`, `POST /api/reparticao/alerts[/preview]`, `POST /api/reparticao/alerts/:id/cancel`, e as das seções 17 a 20. Tudo o que a repartição faz entra na auditoria do cliente como `repartição: <nome> (<usuário>)` (sem usuário, na senha única do link: `repartição: <nome>`).

## 6. O mapa

O painel não carrega biblioteca de mapa. `public/admin/telas-mapa.js` é um mapa próprio de arrastar e dar zoom (Web Mercator, zoom 3 a 18), com os quadros do OpenStreetMap (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) como `<img>` e o crédito **© OpenStreetMap**. Se o quadro falha (sem rede), a imagem some e os **pinos continuam** sobre o fundo liso.

**O município da prefeitura.** Cada cliente escolhe uma vez a **UF** e o **Município** (o mesmo seletor e a mesma lista do IBGE dos cadastros: `public/shared/uf-city.js`, `server/br-places.js`), na própria aba Mapa enquanto não há escolha, ou em **Repartições → Padrão da prefeitura**. Fica em `telas_municipio`. Sem município, a aba Mapa mostra o pedido da escolha em vez do mapa. **Trava (0.5.184):** o município é definido uma vez pelo cliente e fica travado: `PUT /api/prefeitura/municipio` com outro município responde 403 `municipio_locked` e `DELETE` é sempre 403. Trocar ou tirar é só do Superadmin, na ficha do cliente (cartão **Município da prefeitura**): `GET` (platform.view) e `PUT`/`DELETE /api/platform/tenants/:id/telas-municipio` (platform.tenants), com registro na auditoria da plataforma. **Contorno pelo navegador (0.5.185):** o IBGE não responde a servidores fora do Brasil (na produção a busca do servidor dava "demorou demais"). Quando o servidor não consegue, o PAINEL busca a malha no IBGE pelo navegador do operador (uma chamada, sem credencial nem referência, só com o código do município), simplifica e manda em `POST /api/prefeitura/municipio/outline` com `{ geojson }`; o servidor passa pelo mesmo crivo (`fromGeo`), exige que caiba no Brasil e guarda. Acontece ao salvar o município, no **Tentar de novo** e sozinho, uma vez por página, ao abrir o Mapa sem contorno. Freio próprio: 12 por minuto por cliente.

**Localizar no mapa (0.5.186).** `GET /api/prefeitura/geocode` acha endereço com rua e número pelo Nominatim (OpenStreetMap), em `server/telas-geocode.js`: a busca leva "cidade, UF, Brasil" do município da prefeitura e fica presa à caixa dele; sem resultado, tenta sem a caixa e por fim cai no geocodificador antigo (Open-Meteo, que só conhece cidades e bairros). Regras do serviço respeitadas no servidor: um pedido por vez com 1,1 s de intervalo, cliente identificado por um nome genérico, respostas guardadas por 24 h. Do cliente só sai o texto do endereço da repartição.

- **Contorno:** só o servidor fala com o IBGE (`server/telas-malha.js`), em `https://servicodados.ibge.gov.br/api/v3/malhas/municipios/<código>?formato=application/vnd.geo+json` (uma `FeatureCollection` com `Polygon` ou `MultiPolygon`, pontos `[longitude, latitude]`). Do cliente sai **só o código do município**. A busca tem prazo (8 s), teto de tamanho (4 MB), não segue redirecionamento e só aceita https. A resposta é conferida (só polígono e multipolígono, números finitos, dentro do mundo), simplificada por Douglas-Peucker até **2.500 pontos** (`public/shared/telas-geo.js`) e guardada com a caixa envolvente. O painel recebe o contorno do banco, em `GET /api/prefeitura`.
- **Falha do IBGE:** o município fica salvo assim mesmo, com o erro anotado. O mapa abre sem a trava (nas repartições; sem elas, no centro guardado antes desta versão; senão, no estado) e mostra **Contorno indisponível** com o botão **Tentar de novo**. Um contorno já guardado não se perde numa tentativa que falha.
- **Travado na cidade:** com o contorno, o mapa abre sempre enquadrando o município inteiro (zoom fracionário: a cidade ocupa a área toda), com a linha do contorno e o lado de fora escurecido (um `<canvas>` entre os quadros e os pinos). Não arrasta nem afasta o zoom para fora da caixa do município (margem de 6%). **Ver a cidade inteira** volta ao enquadramento; **Tela cheia** faz o mapa ocupar a janela (Esc volta).
- **Um pino por repartição**, com a sigla do tipo (`TYPE_SIGLA` em `telas-tipos.js`) e a cor pela situação das telas dela (`officeStatus` em `telas-geo.js`, sobre as situações de `deviceStatus`): **verde** todas no ar, **amarelo** alguma ligada sem imagem (`error` ou `idle`), **vermelho** alguma sem sinal há mais de 120 s ou que nunca ligou, **cinza** sem tela. O anel é a cor da região; a partir do zoom 12 o pino mostra quantas telas tem. A legenda fica fixa no canto.
- **Lateral:** clicar no pino abre a repartição (nome, endereço, tipo, região, responsável) e a lista das TV box dela: identificação (`#id`), nome, situação, desde quando, versão do app, modelo, série e os grupos. **Captura e comandos** abre o cartão da tela.
- **Grupos:** escolher um grupo (no filtro ou num grupo da lateral) **destaca** as repartições com tela nele (as outras esmaecem) e mostra quantas telas do grupo estão no ar, sem imagem e desligadas. Região e tipo continuam sendo filtros.
- **Fora do município:** a repartição com o ponto fora do contorno não some: entra no contador **fora do município**, na lista embaixo do mapa (um clique abre a repartição) e com o aviso na lateral e na janela de edição. O seletor de ponto da repartição e o mapa dos alertas também abrem na cidade, com o contorno.
- **Lembrado:** o município no servidor. Neste navegador, por cliente (`localStorage`, chave `nexa.pf.mapa.<cliente>`): região, tipo, grupo e tela cheia. A última posição dentro da cidade vale na sessão do navegador (`sessionStorage`): recarregar e trocar de aba mantêm; numa sessão nova o mapa abre com a cidade inteira.
- Contadores no alto (das telas das repartições filtradas).
- **CSP:** o servidor não manda CSP para `/admin`, e a do painel hospedado (`vercel.json`) já tem `img-src … https:`: **nenhuma mudança de CSP foi necessária**. Numa CSP mais estrita, o que o mapa pede é só `img-src https://tile.openstreetmap.org`.

## 7. Decisões de segurança

- **Isolamento entre clientes:** o cliente vem **da credencial** (sessão do painel, token da tela, sessão do link), nunca do pedido. Toda consulta filtra por `tenant_id`; região, grupo, repartição ou tela de outro cliente num pedido = `404`/`400`, como se não existisse.
- **Segredos só em hash:** token da tela, chave de acesso e link de controle em SHA-256 (são valores aleatórios longos); senha do link em scrypt (`authcore.js`); PIN em sal + SHA-256 (seção 4). Chave, link e PIN sorteado aparecem **uma vez** na resposta de quem criou e nunca mais; nenhum DTO leva hash.
- **Nada disso em log:** a auditoria e o `console` não levam token, chave, link, senha ou PIN. O link de controle vai no **corpo** do login, nunca no caminho de uma rota da API. O sinal de vida e a captura ficam fora do log de auditoria (um pedido a cada 30 s por tela).
- **Usuários da repartição:** seção 17 (senha em scrypt, a mesma resposta para qualquer erro, freio por IP, por link e por usuário, sessão presa ao usuário e à versão dele).
- **Link de controle:** senha conferida em tempo constante (scrypt + `timingSafeEqual`), com o mesmo custo e a mesma resposta para link inexistente; freio por IP (10 em 10 min) e por link (30 em 10 min); sessão assinada (HMAC) de 8 h presa à repartição **e à versão do link**: trocar a senha, gerar outro link ou desligar derruba as sessões abertas. A sessão fica no `sessionStorage` da aba e vai em `Authorization`. A página sai com CSP `default-src 'none'; script-src 'self'; style-src 'self'; …`, sem script nem estilo inline, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` e `no-store`.
- **Captura:** o caminho do arquivo sai só de dois inteiros (`<cliente>/<tela>.jpg`): nada do pedido entra no nome. O painel lê a captura com a sessão dele (vira um endereço `blob:` na página), nunca com token no endereço.
- **Entrada:** textos sem caracteres de controle e com teto; endereços (sinal reserva, QR, APK) só `http(s)` sem usuário e senha (o APK, só `https`); o painel escreve tudo com `textContent`.
- **Freios:** ativar (por IP), login do link (por IP e por link), alertas pelo link (10 em 10 min por repartição), capturas (12 por minuto por tela).
- **Atualização do app:** quem tem `prefeitura.manage` aponta o APK. O app confere o SHA-256, e o Android só instala por cima um APK com a mesma assinatura.

## 8. Limites

| O quê | Limite |
|---|---|
| Repartições / regiões / grupos / telas por cliente | 2.000 / 500 / 500 / 20.000 |
| Avisos por nível | 20, de 200 letras (a soma dos grupos corta em 60) |
| Alerta | título 80, texto 500; de 1 minuto a 7 dias |
| Raio | 100 m a 100 km |
| Chaves esperando uso | 500 por cliente; cada uma vale 24 h |
| Captura | 400 KB, só a última de cada tela |
| Histórico de alertas na tela | os 200 mais recentes |

Limpeza automática (a cada 6 h): chaves vencidas há mais de 7 dias e comandos com mais de 30 dias.

Variáveis de ambiente (todas opcionais): `TELAS_ACTIVATE_PER_IP` (tentativas de ativar por IP em 10 min; padrão 20), `TELAS_LINK_LOGIN_PER_IP` (tentativas de login no link por IP em 10 min; padrão 10), `TELAS_TOTEM_PER_MIN` (senhas pelo totem por repartição por minuto; padrão 30), `TELAS_TOTEM_PER_IP_MIN` (por IP; padrão 60) e `TELAS_HASH_MBPS` (teto de leitura do SHA-256 dos vídeos guardados, em MB/s; padrão 8). Em produção, `PUBLIC_HLS_URL` ou `PLATFORM_PUBLIC_URL` precisa estar definida para o `stream.hls` e o endereço do link de controle saírem com o domínio certo.

## 9. Testes

- `test/telas.test.js`: catálogo, chave, PIN (com o vetor `00ff` + `1234`), configuração e precedência, alcance e haversine, alerta, captura e caminho, sessão do link, as contas do mapa, e o código do painel e da página da repartição.
- `test/telas-servidor.test.js`: servidor de verdade. O modo pelo perfil, a permissão, a API da TV box pelo contrato, grupos, alertas por alcance com a prévia, isolamento entre clientes, link de controle, auditoria sem segredos, revogação, modo desligado, freio do ativar e a exclusão do cliente.
- `test/telas-pg.test.js`: Postgres. As tabelas no banco novo e no de antes (idempotente) e o roteiro no dialeto do Postgres.

- `test/telas-fase3.test.js`: as regras das fases 3 e 4. A ordem de chamada (intercalação, 80+, cores do risco), a redução do nome, a virada do dia em America/Sao_Paulo, os cartões e o cartão do dia, a janela do modo eleitoral, o clima com o rev segurado, os vídeos só com o hash, a ponte do EAS e a disponibilidade.
- `test/telas-controle.test.js`: as famílias e as abas por tipo, módulo e papel; a sessão de um usuário da repartição; usuário, papel e senha; o catálogo de tipos de aviso e a gravidade; o texto sugerido que a prefeitura troca; o caso de pessoa desaparecida e o item do contrato §8; o QR code (§11).
- `test/telas-controle-servidor.test.js` (SQLite e Postgres): usuários (regra da senha, isolamento, a senha única que deixa de valer, freio por usuário, sessão que cai), o atendente barrado em tudo o que é do gestor, o controle das TV box restrito à repartição, a aprovação e o aviso geral pelo link da SECOM, o mapa e o raio só para quem alcança a cidade, os tipos de aviso com `header`, `category` e `test` no sinal de vida, Extremo com a confirmação, auditoria com o usuário.
- `test/telas-desaparecidos-servidor.test.js` (SQLite e Postgres): pessoas desaparecidas de ponta a ponta (autorização, foto, alcance, teto de 5, encerrar apaga a foto, vencido, QR code) e o endereço do guichê.
- `test/telas-interna.test.js` e `test/telas-interna-servidor.test.js` (SQLite e Postgres): a comunicação interna (§25) e o som da chamada (§16): nada interno na tela pública, avisos por setor, "Li" e quem falta, os dois endereços do celular, códigos no sinal de vida e no tempo real em menos de 2 s, isolamento, auditoria sem token.
- `test/telas-fase3-servidor.test.js`: servidor de verdade. A senha de ponta a ponta, a chamada pelo SSE em menos de 2 s, o isolamento por repartição e por cliente, o token e o freio do totem, a numeração do dia seguinte, o relatório e o CSV, cartões, clima (com um provedor falso), vídeos guardados, aprovação, modo eleitoral, EAS, selo e exclusão.

## 10. Chamada de senha

Ligada pelo módulo **`senha`** da repartição (de fábrica em UBS, UPA, hospital, CAPS, CRAS, Central do Cidadão e SINE).

**Filas (serviços).** Cada repartição tem as suas: nome, letra(s) da senha (1 a 3, A a Z) e se aceita prioridade. A senha é a letra + o número com 3 dígitos (`A001`); a prioritária leva um `P` (`AP001`). Duas filas não podem dar a mesma senha (a fila `AP` confundiria com a prioritária da `A`: 409). A numeração é por letra e **por dia** em America/Sao_Paulo: à meia-noite recomeça do 001 (o índice único é repartição + dia + código), e a senha de ontem que ficou esperando sai da fila.

**Prioridade legal.** Cada senha é normal (0), prioritária (1: 60+, gestantes, pessoas com deficiência, lactantes, criança de colo) ou 80+ (2). A chamada **intercala**: depois de `ratio` senhas normais seguidas (padrão 2, de 1 a 5) a vez é de uma prioritária, se houver; entre as prioritárias, 80+ primeiro (Lei 13.466/2017) e depois a chegada. No começo do dia a prioritária sai na frente. Sem normal esperando, chama a prioritária, e o contrário.

**Classificação de risco.** Nasce ligada na UPA e no hospital (`risk`; liga e desliga na configuração). A triagem dá a cor (Protocolo de Manchester); quem ainda não tem cor segue a regra da prioridade, depois de quem tem. `waiting.byRisk` e `avgWaitMin` vão no contrato.

**Ordem de chamada (14/11, `rankQueue` em `server/telas-senha-core.js`).** Uma conta só, que devolve a fila na ordem e o **motivo** de cada posição (o painel mostra "Por quê: …" em cada senha da lista Esperando, no Atendimento, na Recepção e no guichê):
- **Vermelho (Emergência): imediato.** Sempre o próximo, à frente de tudo; entre vermelhos, quem chegou antes. Nunca espera proporção.
- **As outras cores têm um tempo-alvo** (de fábrica, o do protocolo: laranja/Muito urgente 10 min, amarelo/Urgente 60, verde/Pouco urgente 120, azul/Não urgente 240; cada repartição muda os seus, de 1 a 1440 min, sem a cor menos grave ter alvo menor). O **atraso relativo** é a espera ÷ o tempo-alvo; a espera conta desde a **emissão** da senha (encaminhar para outra fila não zera o relógio da cor).
- **Níveis**: laranja, amarelo, verde, azul. Com **"o atraso sobe de nível"** (`escalate`, ligado de fábrica), verde e azul sobem um nível a cada tempo-alvo vencido, **até o nível do amarelo**: um verde há 2 h passa o amarelo que acabou de chegar; um azul há 4 h fica no nível do verde e, há 8 h, no do amarelo. Ninguém passa um laranja nem um vermelho. Assim ninguém espera para sempre.
- **No mesmo nível, o maior atraso relativo primeiro** (na mesma cor, é o mais antigo). Com **"a idade acelera"** (`ageBoost`, ligado de fábrica), o atraso do 80+ conta 1,5 vez e o do preferencial/60+ 1,25 vez; no empate, 80+, depois preferencial, depois a chegada. A idade nunca fura a cor.
- **Sem triagem** (ou repartição sem risco): ordem de chegada com a intercalação da prioridade legal (acima): `ratio` normais para cada preferencial, 80+ antes das outras preferenciais.

Configuração (Recepção → "Filas, totem e configuração", do gestor): `targets` `{ laranja, amarelo, verde, azul }`, `ageBoost`, `escalate` e o `ratio` de sempre, guardados no `queue` de `telas_office_extras.data` (só campos novos; a configuração antiga vale como os padrões de fábrica). Sem coluna nem tabela nova.

**Chamar esta.** Na lista Esperando do Atendimento e da página do guichê, cada senha tem **Chamar esta**: `POST <base>/call` (ou `/api/guiche/call`) com `{ desk, ticketId }` chama aquela senha fora da ordem, de qualquer fila (409 se ela já não espera; a resposta leva `manual: true`). Quem chamou e quando ficam na chamada (`called_by`, `at`) e no **log da repartição** ("senha X chamada fora da ordem ("Chamar esta") para …"). Vale para o gestor, o atendente e o endereço do guichê.

**Mudar a prioridade.** Na lista Esperando da Recepção, cada senha de fila com preferencial tem um seletor (Normal, Preferencial / 60+, 80 anos ou mais): `POST <base>/tickets/:tid/priority` `{ priority: 0 | 1 | 2 }`, só de quem espera (409 nos outros casos), para o gestor e o atendente (quem emite). O código impresso **não muda** (a pessoa já tem o papel). Fica no log da repartição. O endereço do guichê não muda prioridade. Não há um tipo "60+" separado do preferencial: a lei dá a mesma prioridade a 60+, gestantes, PcD, lactantes e criança de colo, e só o 80+ fica à frente (Lei 13.466/2017).

**Tipo de problema (Triagem).** Cada senha da aba Triagem tem o campo **Tipo de problema**, uma lista curta e pesquisável dos exemplos do protocolo, agrupados pela cor (`public/shared/triagem-catalogo.js`, com os nomes dos níveis e os tempos-alvo de fábrica), mais **Outro (escolher a cor)**. Ao escolher, a cor **sugerida** fica marcada nos botões; quem faz a triagem confirma ou troca: a decisão é sempre do profissional. **O tipo de problema não fica guardado**: não vai ao servidor (a rota de risco recebe só a cor), não entra no banco, no log nem na TV; fica só na memória da página, até a senha sair da lista ou a página recarregar. Os rótulos das cores no painel usam os nomes dos níveis (ex.: "Laranja · Muito urgente · até 10 min").

**Emissão.** (a) A recepção, na página de controle. (b) O **totem**: `/reparticao/<token>/totem`, uma página de toque com um botão grande por fila e a escolha normal / prioritário / 80+; mostra a senha por 8 s e, com a impressão ligada, chama `window.print()` sobre um papel pequeno (folha de estilo de impressão). O totem é autorizado por um **token próprio** (gerado no painel ou na página de controle, mostrado uma vez, só o SHA-256 no banco) que **só emite senha**: não abre a página de controle, não vê a fila, não registra nome nem risco. Freio: 30 senhas por minuto por repartição e 60 por IP.

**Guichê.** Na página de controle (a mesma sessão do link): o nome do guichê, **Chamar próxima** (de uma fila, se escolhida; a senha que o guichê atendia continua em atendimento até Finalizar), **Repetir**, **Encaminhar** (para outra fila; mantém a prioridade e o risco e entra na fila nova na hora do encaminhamento), **Não compareceu**, **Finalizar**, a triagem (cor e nome) e **Cancelar**. Dois guichês no mesmo instante nunca levam a mesma senha (só quem tira a senha de "esperando" a chama).

**Nome (LGPD).** O nome é opcional (recepção ou triagem). O servidor o reduz a **primeiro nome + inicial do último sobrenome** (`Maria Aparecida da Silva` → `Maria S.`) **antes de gravar**: o nome inteiro não entra no banco, em log, na auditoria nem em tela. Na tela ele só vai com "mostrar o nome" ligado na repartição. O motivo do atendimento não existe em campo nenhum.

**Tempo real.** `GET /api/telas/queue` e `GET /api/telas/queue/stream` (SSE) com o token da tela, sempre e só a fila **da repartição da tela** (o cliente e a repartição vêm do token). Eventos `call` e `state`, `: ping` a cada 20 s, no máximo 2 conexões por tela, limpeza ao desconectar; revogar, excluir ou mudar a tela de repartição derruba a conexão, e a cada minuto o servidor confere no banco as telas conectadas. A chamada é escrita na conexão no mesmo pedido do guichê (no teste, dezenas de milissegundos; o alvo é menos de 2 s). As conexões ficam na memória do processo: uma instância do servidor.

**Em atendimento na tela (contrato §12, 14/11).** O GET e o `state` levam também `serving`: as senhas chamadas que ainda estão em atendimento (sem a atual, a mais nova primeiro, até 8; a última chamada de cada senha, no formato de `current`). O `state` sai quando `waiting` OU `serving` mudam, então finalizar, "não compareceu", encaminhar e cancelar tiram a senha da tela na hora. Sem coluna nova: é a junção de `telas_queue_calls` com `telas_queue_tickets` em `status = 'called'`. Desde a 0.5.202, chamar a próxima NÃO encerra a anterior do guichê: ela fica em atendimento até Finalizar, Não compareceu ou Encaminhar. O app 1.2.2 lista até 4 abaixo da senha atual e mostra a chamada num cartão em tela inteira por 10 s.

**Cor do risco na chamada (contrato §13, 14/11).** O objeto da chamada (`call`, `current`, `last[]`, `serving[]`) leva `risk`: a cor da senha no momento da chamada (`telas_queue_calls.risk`), só na repartição com a classificação de risco ligada; nas outras, `null`. O app 1.2.3 pinta o cartão em tela inteira com a cor, escreve o nível (EMERGÊNCIA, MUITO URGENTE, URGENTE, POUCO URGENTE, NÃO URGENTE, com o nome da cor) e marca a cor ao lado de cada senha na coluna e no painel.

**Histórico e relatório.** Senhas e chamadas ficam 90 dias. A aba **Senhas** do painel traz, por repartição, fila e dia: emitidas, prioritárias, chamadas, atendidas, não compareceram, espera média (emissão até a 1ª chamada) e atendimento médio (chamada até finalizar), com **Exportar CSV** (`GET /api/prefeitura/queue/report?from=&to=&officeId=&format=csv`). A senha encaminhada conta na fila em que terminou.

Rotas: ver o cabeçalho de `server/telas-senha.js`. As operações são as mesmas em `/api/reparticao/queue*` (o link) e `/api/prefeitura/offices/:id/queue*` (o painel).

## 11. Cartões de informação

Um armazenamento só (`telas_cards`): repartição, tipo, título, linhas, dia da semana **ou** período, ordem, segundos e classificação. Os tipos vêm do catálogo, com o modelo de cada um, e cada tipo liga pelo módulo dele na repartição (merenda e calendário na escola, escala na UPA…); o **aviso da unidade** está sempre disponível.

A tela recebe em `cards` (contrato §7.1) só os de **hoje**: o dia da semana do cartão (o cardápio de cada dia) e o período, no horário de Brasília. Limites do contrato aplicados na entrada: título 60, até 8 linhas de 90 (a linha longa é cortada; a 9ª linha é 400), 3 a 120 s (padrão 10), até 12 cartões por tela, 60 por repartição; sem caracteres de controle. Edição: aba **Cartões** do painel e a página de controle (`/api/reparticao/cards*`).

## 12. Clima

`weather` usa a fonte que o servidor já tem (`server/weather.js`: o provedor escolhido no Superadmin, com o cache e as cotas de lá; nenhum provedor novo). A cidade é o campo **cidade** do padrão da prefeitura (UF + município do IBGE). Sem cidade, sem fonte configurada (chave faltando) ou sem previsão: `null`.

A configuração nunca espera o provedor: a busca é em segundo plano e a tela recebe o **mesmo objeto** (com o mesmo `at`) por 30 minutos; só então o servidor busca de novo. Assim o `rev` não muda por causa do clima mais que uma vez a cada 30 min, e o `at` se renova a cada 30 min (o app esconde o clima com mais de 3 h). Com o provedor fora, o último objeto continua; depois de 6 h vira `null`. `tempC` é a temperatura de agora quando a fonte informa; no INMET, a máxima do dia.

## 13. Vídeos guardados e a imagem sem internet

Na aba **Sem internet**, a prefeitura escolhe vídeos prontos da própria biblioteca por nível: **padrão da prefeitura**, **grupo** ou **repartição** (até 10 por nível). Cada tela recebe em `offline.items` os do padrão, depois os dos grupos dela e os da repartição (até 20, sem repetir), com o endereço público do arquivo (`R2_PUBLIC_URL`; só `https`), `bytes` e `sha256`.

O SHA-256 é calculado **uma vez, em segundo plano**, e fica em `telas_media_hashes` (vale enquanto o arquivo e o tamanho forem os mesmos; arquivo trocado = hash novo). A leitura é a das outras tarefas de fundo (`readInput`: a cópia local ou a URL assinada do armazenamento, que nunca vai a log), um vídeo por vez, com teto de `TELAS_HASH_MBPS` e **parando enquanto o ar está sem folga** (o mesmo freio `airStrain`: o vigia de ritmo e as esperas do `server/fundo.js`). Até o hash existir, o item não é mandado. Falha: nova tentativa a cada 10 min, até 5 vezes.

**Imagem sem internet** (`offline.image`, 14/11; `server/telas-imagem-offline.js`, tabela `telas_offline_image`, uma por nível): a prefeitura sobe uma imagem por nível (padrão, grupo ou repartição; a repartição também sobe a dela pelo link de controle, aba Telas, só o gestor). O envio é conferido pelo conteúdo (JPEG, PNG ou WebP, até 15 MB e 16 megapixels) e o FFmpeg grava um JPEG 1920×1080 cobrindo o quadro, sem metadados, de até 2 MB, em `graphics/telasimg-<uuid>.jpg` (R2 ou disco). A tela recebe `{ url, sha256, bytes }` do nível mais específico (repartição > grupos da tela, na ordem > padrão) ou `null`; a troca muda o `rev`. Trocar ou remover apaga o arquivo anterior; excluir a repartição ou o grupo tira a linha, e a limpeza de 6 em 6 h apaga o arquivo que nenhum nível cita. Rotas: `GET /api/prefeitura/offline-image` (também em `images` do `GET /api/prefeitura/offline`), `GET|PUT|DELETE /api/prefeitura/offline-image/:scope/:scopeId` (o PUT leva a imagem crua no corpo) e `GET|PUT|DELETE /api/reparticao/offline-image` (+ `GET …/file`).

## 14. Aprovação da SECOM

Opcional por prefeitura, **desligada de fábrica** (`approval` no padrão da prefeitura). Ligada, o que é escrito **pelo link de controle** de uma repartição fica **aguardando aprovação** em `telas_approvals`: os avisos (o que já está nas telas fica como está), o cartão novo ou alterado e o alerta. Quem tem `prefeitura.manage` aprova ou recusa (com o motivo) na aba **Aprovações**; a repartição vê a situação e o motivo na página dela. O alerta aprovado conta o prazo a partir da aprovação. O que é escrito no painel vale na hora.

**Exceção:** o alerta da **Defesa Civil** sai na hora (é urgente) e fica **marcado** (`flag: sem-aprovacao` e uma linha `auto` no histórico). Tudo é auditado: quem pediu, quem decidiu e quando (na tabela e na auditoria do cliente). Dois cliques no mesmo pedido: só um vale.

## 15. Tela desligada e modo eleitoral

**Tela desligada.** A cada minuto o servidor confere a situação de cada tela (no ar, ligada sem imagem, desligada) e grava as **mudanças** em `telas_device_events`. A aba **Telas** mostra "desligada há X" e a **disponibilidade** em 7 e 30 dias (tempo no ar sobre o tempo acompanhado; o tempo antes da 1ª situação conhecida não conta). O menu **Prefeitura** ganha um **selo** com as telas desligadas e os pedidos aguardando aprovação. O **aviso por e-mail** reaproveita o que o servidor já tem (os avisos da Saúde do sinal, `server/alerts.js`: os mesmos destinatários, a mesma fila com freio, o mesmo SMTP); liga no padrão da prefeitura, com o prazo (5 min a 24 h, padrão 10). Sem SMTP ou sem destinatários, nada sai. Não há webhook: o servidor não tem um mecanismo de webhook de saída para reaproveitar.

**Modo eleitoral.** O padrão da prefeitura guarda o período (`electoral: { from, to }`, dias inteiros em America/Sao_Paulo). Todo conteúdo tem uma **classificação**: utilidade pública (o padrão), institucional (escolhida de propósito) ou emergência. Vale para avisos (a marca `[institucional]` no começo do texto, guardada junto e tirada antes de ir à tela), cartões, alertas e vídeos guardados. No período, o **institucional fica retido**: não vai em `/config` nem no sinal de vida, e **nada é apagado** (volta sozinho no dia seguinte ao fim). O painel mostra uma faixa de aviso, e a aba Aprovações traz o lembrete do art. 37, §1º, da Constituição (sem nome, símbolo ou imagem que caracterize promoção pessoal de autoridade).

## 16. Alerta de emergência do canal (EAS) nas telas

Quando o canal da repartição tem um alerta de emergência **no ar** (docs/EAS.md), as telas dela o recebem no sinal de vida como alerta `critical`, por leitura do estado do EAS (`EasHub.airingFor`, sem escrever nada lá). O `id` começa em 1.000.000.000 (nunca bate com os alertas do painel). O alerta de **teste** não vai às telas. Desliga em **Padrão da prefeitura** (`eas: false`).

As interpretações fechadas com o app das fases 3 e 4 (o `call` só se repete com `repeat: true`, o `state` inteiro, `last` sem a atual, a ordem do `byRisk`, o `at` do clima, os segundos dos cartões, os ids do EAS) estão no contrato, §7.3 (`nexa-ferramentas/telas-contrato.md`).

## 17. Painel da repartição: usuários, famílias de tela e controle das TV box

**Usuários (usuário + senha).** Cada repartição tem os usuários dela em `telas_office_users`: `username` (único dentro da repartição, guardado em minúsculas; 3 a 40 letras, números, ponto, hífen ou sublinhado), nome, a senha em scrypt (`authcore.js`), o papel e se está ativo. Cadastro no Painel da Prefeitura, em **Repartições → Usuários**: criar (com a regra de senha do projeto: 8 caracteres, 10 em produção, diferente do usuário e fora da lista das comuns), trocar a senha, trocar o papel, desativar, reativar e apagar; o mesmo diálogo gera o link da repartição (mostrado uma vez, com **Copiar**). A senha nunca é guardada em texto nem devolvida.

| Papel | O que alcança |
|---|---|
| `gestor` | tudo da repartição: avisos, cartões, alertas, a chamada de senha inteira e as TV box |
| `atendente` | só a chamada de senha: as abas **Atendimento** e **Recepção** (ver a fila, emitir, chamar, repetir, não compareceu, finalizar, encaminhar, cancelar). Não vê avisos, alertas, cartões, telas, filas, totem, configuração nem a triagem; `GET /state` devolve só o nome da repartição e o módulo da senha |

**Entrada.** `POST /api/reparticao/login { token, username, password }`. Uma conferência de senha só, do mesmo custo, e **a mesma resposta** ("Link, usuário ou senha inválidos.") para link, usuário e senha errados, usuário desativado ou de outra repartição. Freios: por IP (`TELAS_LINK_LOGIN_PER_IP`, padrão 10 em 10 min), por link (`TELAS_LINK_LOGIN_PER_LINK`, 60) e por usuário (`TELAS_LINK_LOGIN_PER_USER`, 8). A sessão (8 h, assinada) é `r2.<repartição>.<versão do link>.<usuário>.<versão do usuário>.<validade>`: cai quando o link é gerado de novo e quando aquele usuário troca de senha, de papel ou de situação, ou é apagado.

**Compatibilidade com a senha única.** A repartição que ainda **não tem nenhum usuário** continua entrando só com a senha do link (o campo Usuário fica em branco). **Ao criar o primeiro usuário, a senha única é apagada** e as sessões abertas com ela caem; daí em diante só entra usuário + senha. Se todos os usuários forem apagados, a repartição fica sem acesso até a prefeitura criar um usuário (ou definir de novo uma senha única em "Link de controle").

**A página se monta sozinha.** O tipo da repartição define a **família** (`familyOf`) e os módulos ligados definem as **abas** (`officeTabs`, em `public/shared/telas-tipos.js`): F1 Comando da comunicação (SECOM), F2 Emergência (Defesa Civil), F3 Pronto atendimento (UPA, hospital), F4 Atendimento por senha (UBS, CAPS, CRAS, Central do Cidadão, SINE), F5 Educação (escola, creche), F6 Informação ao público (Câmara, cultura, terminal) e F7 Geral. No computador, duas colunas (a operação à esquerda; a situação das telas, a prévia, a fila ou o mapa à direita); no celular e no tablet, uma. As faixas **Período eleitoral** e **Aguardando a SECOM** só aparecem quando valem. Arquivos: `public/reparticao/reparticao.js` (a casca e as abas) e um módulo por função (`rep-senha.js`, `rep-cartoes.js`, `rep-alertas.js`, `rep-telas.js`, `rep-secom.js`, `rep-desaparecidos.js`); a lista servida fica em `PAGE_FILES` (`server/telas.js`).

- **Merenda (F5):** a grade da semana, de segunda a sexta. Cada dia é o cartão `merenda` daquele dia da semana; **Salvar a semana** grava os cinco de uma vez (pelas rotas dos cartões), **Limpar a semana** esvazia e **Copiar de <dia anterior>** repete um dia no seguinte. Não há "copiar a semana passada": o cardápio é guardado por dia da semana (não por data), então o da semana passada é o que já está na grade.
- **Editor por linhas (F6 e os outros cartões):** adicionar, tirar, arrastar pelo ≡ ou subir e descer pelos botões (teclado), validade, segundos na tela e a prévia ao lado.
- **Prévia "Como aparece na TV":** `public/shared/telas-previa.js` + `.css` desenham a tela nos seis formatos, o alerta, o caso de pessoa desaparecida (tela cheia e faixa) e o QR code. É um desenho do que o app foi programado para mostrar, sem estilo pelo script (a CSP da página não aceita inline). O Painel da Prefeitura usa a mesma prévia nas abas Alertas e Desaparecidos.
- **Aprovações no link da SECOM (F1):** a fila de TODAS as repartições do cliente, com **Ver como fica na tela**, **Aprovar** e **Devolver com motivo** (o motivo é obrigatório). `GET /api/reparticao/approvals`, `POST …/:id/approve|reject`: só o gestor de uma repartição do tipo `secom`. É a mesma regra do painel (`listApprovals` e `decideApproval` em `server/telas-conteudo.js`).
- **Aviso geral (F1):** `PUT /api/reparticao/geral { items }` grava os avisos do **padrão da prefeitura**. Eles aparecem nas telas das repartições que **não têm avisos próprios** (a precedência da seção 4 não muda: a repartição, o grupo ou a tela que definem os seus mostram os seus).
- **Mapa do alcance (F1 e F2):** `GET /api/reparticao/mapa` devolve o contorno guardado do município, as regiões e, de cada repartição do cliente, só o nome, o tipo, o ponto, a região, os grupos e quantas telas tem (nada de endereço, responsável ou dado de aparelho). O mapa é o `telas-mapa.js` com `tiles: false`: **sem o fundo do OpenStreetMap**, porque a página da repartição não carrega nada de fora (a CSP continua `img-src 'self' data:`). O raio se marca clicando no mapa ou numa repartição.

**Controle das TV box (aba Telas, só o gestor).** Tudo o que o painel faz numa tela, restrito às telas DAQUELA repartição: a repartição vem da sessão e entra em toda consulta (tela de outra repartição ou de outro cliente = 404).

| Rota | O que faz |
|---|---|
| `GET /api/reparticao/devices` | as telas (situação, desde quando, app, modelo, rede, último erro, disponibilidade em 7 e 30 dias, os grupos pelo nome) e as chaves esperando uso |
| `PATCH /api/reparticao/devices/:id` | o nome e o que a tela define: formato, volume, sem som, horário de ligar e desligar, blocos e título da lateral, QR, sinal reserva (`OFFICE_DEVICE_CONFIG_KEYS`) |
| `POST …/devices/:id/commands` | recarregar, reiniciar o app, reiniciar o aparelho, captura |
| `GET …/devices/:id/screenshot` | a última captura |
| `POST …/devices/:id/revoke`, `DELETE …/devices/:id` | desvincular (o aparelho volta à tela da chave) e excluir a revogada |
| `POST /api/reparticao/keys`, `DELETE /api/reparticao/keys/:id` | a chave de ativação de uma TV box nova, **já vinculada a esta repartição** (o pedido não escolhe outra); 20 em 10 min por repartição |

Ficam só com a prefeitura: o **PIN de saída** e a **sequência de saída** (a trava do aparelho), os **avisos próprios da tela** (os da repartição passam pela aprovação da SECOM; os da tela não passariam), mudar a tela de repartição, o ponto dela no mapa e os grupos. As regras são as mesmas funções do painel (`patchDevice`, `queueCommand`, `revokeDevice`, `deleteDevice`, `newAccessKey`, `sendShot`).

## 18. Tipos de aviso e gravidade (contrato §9)

O alerta da Defesa Civil começa pelo **catálogo** (`ALERT_CATEGORIES` em `telas-tipos.js`): Meteorológicos e hidrológicos, Riscos geológicos, Desastres tecnológicos e industriais, Incêndios florestais e qualidade do ar, Emergências de saúde pública, Teste e simulação do sistema e Outro. Cada tipo traz o título e o texto sugeridos (com o que fazer agora) e a gravidade sugerida; o operador troca o que quiser. A prefeitura troca o texto sugerido de cada tipo em **Padrão da prefeitura** (`alertTexts`: só o que ela mudou fica guardado). Pessoa desaparecida não é um tipo: é a aba Desaparecidos.

| Gravidade | `level` | Quando |
|---|---|---|
| Aviso | `info` (azul) | comunicado sem risco imediato |
| Severo | `warn` (âmbar) | ameaça significativa que pede atenção e medidas preventivas; ainda há tempo para se preparar |
| Extremo | `critical` (vermelho) | nível máximo, só com risco iminente à vida ou ao patrimônio; vem com o som ligado e **exige `confirmExtreme: true`** no pedido (400 sem ele), no link da Defesa Civil e no Painel da Prefeitura |

O servidor monta a linha de cima (`header`, até 60) ao criar o alerta e guarda em `telas_alert_info` com a categoria, o tipo e a marca de teste: "ALERTA SEVERO · DEFESA CIVIL", "ALERTA EXTREMO · DEFESA CIVIL", "AVISO · DEFESA CIVIL"; pelo painel, com categoria, "… · PREFEITURA"; nas outras repartições só "AVISO · <nome>" no nível informativo (no resto, o cabeçalho do app, como antes). **Teste e simulação:** `test: true`, `header` "TESTE DO SISTEMA", o título gravado começa por "TESTE:" e o som vem desligado. No sinal de vida, `header`, `category` e `test` só entram quando o alerta os tem: o alerta de antes sai exatamente como antes.

## 19. Pessoas desaparecidas (contrato §8 e §11)

Aba **Desaparecidos** no link da Defesa Civil e da SECOM (só o gestor) e no Painel da Prefeitura. Código: `server/telas-desaparecidos.js`; tabela `telas_missing`. Rotas espelhadas em `/api/reparticao/missing*` e `/api/prefeitura/missing*`: listar, `POST /photo` (a foto crua no corpo), criar, `PATCH /:id` (texto, exibição, alcance, validade, foto), `POST /:id/close { reason: localizado | encerrado }`, `GET /:id/photo` e `PUT /qr`.

- **Autorização obrigatória:** o número do registro de ocorrência, o nome e o vínculo de quem autorizou (familiar ou autoridade policial) e a confirmação marcada ("A família ou a autoridade policial autorizou a divulgação da foto e dos dados"). Sem ela, 400. Esses campos ficam só no registro: **nunca vão ao aparelho nem a rota pública**.
- **Foto:** JPEG, PNG ou WebP até 5 MB, conferida **pelo conteúdo** (não pela extensão). O servidor recodifica em JPEG **sem metadados** (o EXIF pode ter a localização), lado maior até 1280 px e até 600 KB (baixa a qualidade e, no fim, o tamanho até caber), calcula o SHA-256 e guarda em `graphics/` com nome sorteado (`desap-<uuid>.jpg`). A tela recebe o endereço público **https**, o SHA-256 e o tamanho; sem https, a foto vai `null` e o app desenha a silhueta. Ao **encerrar** (localizado, encerrado ou vencido) a foto é **apagada do armazenamento na hora** e a rota pública passa a dar 404 (ela sai sem cache). Numa hospedagem com endereço público na frente do armazenamento (CDN), a cópia que a CDN já guardou pode viver até o prazo dela: o nome é sorteado e deixa de ser enviado a qualquer tela.
- **Alcance:** o mesmo dos alertas (cidade, regiões, grupos, repartição, raio), com a mesma contagem de telas. **Validade:** 7 dias de padrão, no máximo 30 a partir de agora, renovável. **Teto:** 5 casos ativos por cliente (409 no 6º). **Emergência:** não passa pela aprovação da SECOM e não é retido no período eleitoral.
- **Sinal de vida:** `missing` leva os casos em vigor PARA aquela tela, do mais novo para o mais antigo, no máximo 5, exatamente com os campos do §8.1. Encerrar ou vencer tira no sinal de vida seguinte. O vencido é encerrado sozinho (motivo `vencido`, a cada minuto). O registro em texto do caso encerrado fica 90 dias e sai na limpeza.
- **QR code de contato imediato (§11):** cada repartição emissora define o destino dela (WhatsApp → `https://wa.me/<número com DDI>`, telefone → `tel:+…`, SMS → `sms:+…`, ou um endereço https) e a frase ao lado (padrão "Aponte a câmera e fale agora", até 40); o Painel da Prefeitura define o **padrão da prefeitura**, que vale para a repartição que não definiu o dela. Cada caso mostra o padrão, fica sem QR code ou usa outro destino só nele. O servidor só aceita `https://` (válido, sem usuário e senha, até 300), `tel:+` e `sms:+` com 8 a 15 dígitos; o resto é 400. O sinal de vida só leva `qr` quando ligado e válido.
- **Auditoria:** só o nome e o número do registro.

## 20. Endereço do guichê

Além do papel atendente, cada repartição com a chamada de senha pode gerar um **endereço do guichê**, como o do totem: `/reparticao/<token>/guiche` (token próprio, mostrado uma vez, só o SHA-256 em `telas_guiche`; gerar outro derruba o anterior). Gera-se na aba Recepção ("Filas, totem e configuração") e no Painel da Prefeitura, na aba Senhas. A página não pede login e só faz o que o atendente usa o dia todo: `GET /api/guiche` (as filas, quantos esperam e as senhas em atendimento), `POST /api/guiche/call`, `POST /api/guiche/tickets/:id/repeat|noshow|finish|forward`. Não emite senha, não lê a fila com nomes, não abre o painel da repartição. Freio: 240 pedidos por minuto por repartição e por IP (`TELAS_GUICHE_PER_MIN`, `TELAS_GUICHE_PER_IP_MIN`). Quem chamou fica gravado como `repartição: <nome> (guichê)`.

**Migração (regra).** As tabelas desta seção e das seções 17 a 19 já estão em bancos no ar. Coluna nova numa tabela que já existe entra sempre como migração aditiva: `TELAS_ADDED_COLS` em `server/db/schema-telas.js` (o Postgres recebe `ALTER TABLE … ADD COLUMN IF NOT EXISTS` pelo `pgMigrate`; o SQLite, o `addCol` de `server/db/sqlite.js`), com NULL ou padrão compatível com as linhas de antes; nunca só no `CREATE TABLE`. `telas_missing` (no ar desde a 0.5.188) ganhou assim `qr_mode`, `qr_data`, `qr_label`, `header` e `warrant_no`. Teste: `test/telas-migracao.test.js` (o esquema exato da 0.5.188 com linhas antigas, nos dois bancos).

## 21. Segurança pública (contrato §10)

Três tipos de repartição (`telas-tipos.js`):

| Tipo | O que é | Alcance | Observação |
|---|---|---|---|
| `seguranca` "Segurança e Guarda Municipal (CCO)", sigla SEG | o centro de controle da prefeitura | amplo | recebe o botão de pânico, aprova os emissores conveniados, emite na hora |
| `policia-civil` "Polícia Civil (emissor conveniado)", sigla PC | órgão estadual, por convênio | amplo | `external: true`; desaparecidos, cartela policial e alertas de Segurança pública |
| `policia-militar` "Polícia Militar (emissor conveniado)", sigla PM | órgão estadual, por convênio | amplo | `external: true`; alertas de Segurança pública e de Trânsito; sem Desaparecidos |

**Emissor conveniado (`external`).** Não administra o painel da prefeitura. Não tem avisos nem cartões (403), não vê telas de ninguém (a aba Telas só aparece se tiver tela vinculada a ele), não recebe a contagem da rede e, no mapa, só o nome e o ponto das repartições. No catálogo de tipos de aviso só usa as categorias dele (`alertCategoriesOf`): a Polícia Civil, **Segurança pública**; a Militar, **Segurança pública** e **Trânsito**. Os textos sugeridos são de orientação ("Evite a região de … Siga as orientações dos agentes."), sem detalhe operacional.

**Linha de cima.** O servidor monta pelo emissor (`issuerHeader`): "ALERTA · GUARDA MUNICIPAL", "ALERTA · POLÍCIA MILITAR", "ALERTA · POLÍCIA CIVIL" no informativo, e "ALERTA SEVERO · …" e "ALERTA EXTREMO · …" nos outros. Extremo pede `confirmExtreme` em todo emissor.

**Aprovação do CCO.** O que o emissor conveniado envia (alerta, desaparecido, cartela) entra **aguardando** em `telas_approvals` e só vai às telas depois de aprovado. É a mesma máquina da aprovação da SECOM (pedir, aprovar, devolver com motivo, prévia), com um tipo de pedido a mais (`missing`: o caso fica `pending` em `telas_missing` e entra no ar ao aprovar; devolvido, vira `rejected` e a foto é apagada). Quem decide:

- o gestor da repartição **`seguranca`** (aba Aprovações do link dela) e o **Painel da Prefeitura**;
- a **SECOM**, só se a prefeitura **não tem** repartição de Segurança (com CCO cadastrado, o pedido do emissor não aparece para a SECOM e ela leva 403 ao decidir);
- com a aprovação geral ligada, os pedidos das repartições da prefeitura aparecem para a SECOM **e** para o CCO: vale quem decidir primeiro, e fica gravado quem foi.

**"Pode emitir direto, sem aprovação"** (desligado de fábrica), por emissor, em **Repartições → Usuários**: `PUT /api/prefeitura/offices/:id/issuer { direct }`. Libera os **alertas** e o **desaparecido** do emissor (saem na hora, marcados `sem-aprovacao`, com uma linha `auto` no histórico). **Nunca** a cartela policial. A Segurança e a Defesa Civil não esperam aprovação nenhuma.

**Botão de pânico (silencioso).** Módulo `panico`, ligado por repartição (de fábrica em escola, creche, UPA, hospital, UBS, CAPS e CRAS). Na barra do topo do painel da repartição (gestor e atendente): segurar por 2 segundos, ou Enter e confirmar. `POST /api/reparticao/panic` grava em `telas_panic` e **nada vai a tela nenhuma** (o pânico não existe em rota nenhuma do aparelho). Chega ao painel da Segurança (aba **Ocorrências**, relida a cada 3 s, com destaque vermelho, o ponto no mapa e o som de aviso depois de a pessoa ligar o som na página) e ao Painel da Prefeitura (aba **Ocorrências**, a cada 5 s): `GET /api/reparticao/panic` (só o gestor da Segurança), `GET /api/prefeitura/panic`, `POST …/panic/:id/ack` (**Recebido**: quem e quando) e `POST …/panic/:id/close { note }` (**Encerrar**, com a nota obrigatória). Quem acionou vê "Enviado às HH:MM · recebido pelo CCO às HH:MM" (`GET /api/reparticao/panic/mine`). Sem repartição de Segurança cadastrada: 409 com a mensagem "não há quem receba" (nada é gravado). Freio: 3 por minuto por repartição (`TELAS_PANIC_PER_MIN`). Tudo na auditoria; histórico de 90 dias. O tempo real é por sondagem curta, não por SSE.

**Cartela policial (só a Polícia Civil).** Na aba Desaparecidos dela, o tipo **Pedido de informação** (`kind: informacao`, com `header` de uma lista fechada: "A POLÍCIA PEDE INFORMAÇÕES" ou "PROCURADO PELA JUSTIÇA"). Travas no servidor: só repartição `policia-civil` (as outras e o painel levam 403); exige o **número do procedimento** e a **identificação funcional** de quem cadastra (ficam só no registro, nunca vão às telas nem à fila de aprovação); "PROCURADO PELA JUSTIÇA" exige o **número do mandado de prisão** e leva na tela, fixo, "Não aborde. Ligue 190 ou 181." (abre sempre a `description` do contrato, uma vez só; o pedido não a tira nem a troca); validade máxima de **15 dias**; **sempre** espera a aprovação; entra no mesmo teto de 5 casos (o teto conta os que estão no ar e os que esperam). O contato padrão é "Disque Denúncia 181 · sigilo garantido". Nome e foto são opcionais; sem nome, o item vai com o nome "Pedido de informação" (o app ignora caso sem nome).

**Chave de integração (API).** Em **Repartições → Usuários** de um emissor conveniado: `POST /api/prefeitura/offices/:id/api-key` gera a chave (mostrada uma vez; só o SHA-256 em `telas_api_keys`; gerar outra derruba a anterior), `DELETE` revoga, `GET` diz se há chave e a data do último uso. Pede a funcionalidade **Acesso por API** (`api`) no plano do cliente: sem ela, a chave não é gerada nem aceita. Rotas, com `Authorization: Bearer <chave>`:

| Rota | O que faz |
|---|---|
| `POST /api/telas-emissor/alerts` | cria um alerta: `category`, `kind` (do catálogo), `title`, `text`, `level`, `durationMin` e `scope` (`city`, `regions`, `groups` ou `radius` com `lat`, `lng`, `meters`). 201 = no ar; 202 = aguardando o CCO |
| `GET /api/telas-emissor/alerts` | os alertas e os pedidos do próprio emissor |
| `POST /api/telas-emissor/alerts/:id/cancel` | encerra um alerta próprio |

É o mesmo caminho do link (`officeAlert`): a mesma validação, as mesmas categorias, o mesmo freio por repartição (os alertas do link e da chave somam), a mesma aprovação e a mesma auditoria (`repartição: <nome> (API)`). Sem envio de foto: desaparecido e cartela, só pela tela.

```sh
curl -X POST https://<painel>/api/telas-emissor/alerts \
  -H "Authorization: Bearer <chave de integração>" -H "Content-Type: application/json" \
  -d '{"category":"transito","kind":"bloqueio-via","title":"Via bloqueada","text":"Evite o trecho e use um caminho alternativo. Siga as orientações dos agentes.","level":"warn","durationMin":30,"scope":{"kind":"radius","lat":-22.9068,"lng":-43.1729,"meters":1500}}'
```

Telas: F8 Segurança/CCO (Ocorrências, Aprovações, Novo alerta, Desaparecidos, No ar, Avisos, Telas), F9 Polícia Civil (Desaparecidos e cartelas, Novo alerta, Meus envios) e F10 Polícia Militar (Novo alerta, Meus envios). Testes: `test/telas-seguranca-servidor.test.js` (SQLite e Postgres).

## 22. Repartições: o assistente, a ficha, o link e a senha com o olho e o alcance dos alertas

**Assistente "+ Nova repartição"** (`public/admin/views/prefeitura-reparticoes.js`): 1) o TIPO num catálogo de cartões
(ícone da família, nome), com a prévia da TV box (`public/shared/telas-previa.js`) no layout de fábrica do tipo e o conteúdo
de exemplo dele (`public/shared/telas-amostras.js`, `DEFAULT_LAYOUT` e `sampleFor`, os mesmos do blueprint das telas de
controle); o layout troca ali mesmo e a prévia acompanha ("Chamada de senha" só nos tipos com a chamada de senha); 2) nome,
endereço, região e mapa no formulário de sempre, já com o tipo e o layout (`config.layout` da repartição); 3) o servidor gera o
link e uma senha sorteada e o painel mostra os dois com o olho e o copiar.

**Link e senha do painel guardados também cifrados.** O login continua pelo resumo (`link_hash` SHA-256, `link_pass` scrypt).
Para o "olho", `telas_offices.link_enc` e `pass_enc` guardam o link e a senha em AES-256-GCM (`server/telas-acesso.js`, formato
`v1:` igual a `server/youtube-chaves.js`). Chave: SHA-256 de `nexa-reparticao-acesso:` + `SESSION_SECRET`; sem
`SESSION_SECRET` (instalação local), um arquivo `DATA_DIR/telas-acesso.key` gerado uma vez. Trocar o `SESSION_SECRET` deixa o
cifrado ilegível: o olho mostra "senha definida antes; gere uma nova" e o login segue. Senha sorteada: 4 blocos de 4 de
`abcdefghjkmnpqrstuvwxyz23456789` (sem 0/O/1/l/I/i), ~79 bits.

| Rota (prefeitura.manage) | O quê |
| --- | --- |
| `POST /api/prefeitura/offices/:id/link` `{ generate: true }` | link novo + senha sorteada (devolve `password` só nesse caso); `{ password }` = senha escrita à mão (também cifrada); `{}` = link novo, a senha fica |
| `PUT /api/prefeitura/offices/:id/link/password` `{ generate: true }` ou `{ password }` | troca a senha (409 com usuários: a senha única do link não vale mais) |
| `POST /api/prefeitura/offices/:id/access` | o olho: `{ state: 'ok' \| 'users' \| 'legacy' \| 'none', url, password, users }`. POST para cair na auditoria ("link e senha do painel da repartição … revelados") |
| `PUT /api/prefeitura/offices/:id/reach` `{ mode, regions, groups, eas }` | o alcance dos alertas (só nos tipos de emergência; 409 nos outros) |

O 1º usuário do painel da repartição apaga `link_pass` e `pass_enc`; desligar o link apaga `link_enc` e `pass_enc`. A leitura
geral (`GET /api/prefeitura`) só diz se dá para ver (`access: { link, password, passwordVisible }`), nunca o texto.

**Ficha da repartição** (cartão na aba Repartições): tipo, layout (o próprio ou o da prefeitura), Painel (link e senha com o
olho e o copiar; "Gerar link e senha", "Gerar nova senha" para as antigas), as TV box vinculadas (quantas, no ar × fora, o
ID de cada uma, "Ver as TV box" com Editar ou mover, "+ TV box"), o alcance dos alertas nas de emergência e "PIN de saída da
TV box (novo)", que é o PIN que destrava o aparelho no local, outra coisa que a senha do painel.

**Vínculo da TV box.** Já era pela chave de acesso: a chave é gerada para uma repartição e a ativação cria a tela nela
(`POST /api/telas/activate`). O que muda: "+ TV box" na ficha e "Cadastrar a primeira TV box" no fim do assistente geram a
chave com a repartição já escolhida (o seletor fica travado); o painel da própria repartição continua gerando chaves que
nascem dela. Mover de repartição continua em Editar (Painel da Prefeitura). O contrato do aparelho não mudou.

**Alcance dos alertas** (`alert_reach`, JSON; `REACH_TYPES` em `telas-tipos.js`: Defesa Civil, Segurança, Polícia Civil e
Militar). `mode`: `own` (as próprias telas), `all` (todas as TV box da prefeitura), `pick` (a própria repartição + regiões e
grupos); `eas`: também no ar dos canais. De fábrica (`NULL`): Defesa Civil `all`, as outras `own`, `eas` desligado. No painel
da repartição aparece o botão "Alcance da prefeitura" (o primeiro, quando não é `own`); o pedido manda só `{ kind: 'reach' }` e
o servidor monta o alcance da ficha (`scope.kind = 'reach'`: `all`, `offices`, `regions`, `groups`; regiões e grupos apagados
depois saem sem erro) e grava esse retrato no alerta. A entrega é a de sempre: o alerta entra na leitura da prefeitura na hora
(`forget`) e cada TV box o recebe no próximo sinal de vida (até `heartbeatSec` = 30 s), todas pela mesma consulta, sem fila
nem escalonamento por tela. Regras mantidas: Severo/Extremo e a confirmação do Extremo, tipos de aviso do órgão, a aprovação
(a Defesa Civil e a Segurança não esperam; o emissor conveniado espera o CCO a não ser liberado; com a SECOM ligada, as comuns
esperam) e o modo eleitoral.

**No ar do canal (EAS).** Com `eas` marcado, um alerta Severo (`warn`) ou Extremo (`critical`) para o "Alcance da prefeitura"
que começa agora vai também ao ar de cada canal do cliente com os Alertas de emergência ligados, pelo alerta manual do EAS
(`EasHub.manual`, `Severe`/`Extreme`, `origin: 'telas'` → `extId` `telas-…`), e só com a funcionalidade `eas` no plano. Aviso
(`info`), teste e alerta agendado não vão. Nas telas ele não repete (`easFor` pula o que veio das telas). Encerrar o alerta
no painel da repartição tira do ar do canal também (a lista fica na memória do processo: depois de um reinício o EAS sai no fim
do tempo, ou em Alertas de emergência). Nada vai a celulares nem a sistema nacional.

Testes: `test/reparticoes-assistente-servidor.test.js` (cifra, senha sorteada, olho só para prefeitura.manage, auditoria,
repartição antiga, vínculo da TV box, alcance da Defesa Civil × repartição comum × Guarda com região, EAS do canal, migração
aditiva com as colunas retiradas de um banco existente) e `test/telas-migracao.test.js`.

## 23. O APK do app das telas pelo próprio servidor (14/11)

O APK da versão atual do NEXA Telas fica versionado em `server/assets/telas-app/` (`NEXA-Telas.apk` + `latest.json` com versionCode, versionName, sha256 e bytes), escrito por `node scripts/telas-app-publicar.mjs` depois do build do `android-telas/` (o APK de depuração: a mesma assinatura das TV box já instaladas). Vai junto na imagem (o Dockerfile copia `server/`). `server/telas-app.js` serve:

- `GET /telas/app/latest.json`: { versionCode, versionName, sha256, bytes, url } (404 sem APK);
- `GET /telas/app/latest.apk`: o arquivo (`application/vnd.android.package-archive`); o endereço leva `?v=<versionCode>` para o CDN não servir a versão anterior.

O APK é conferido contra o latest.json (tamanho e SHA-256) uma vez por mudança de arquivo; se não conferir, nada é oferecido. O `update` do /api/telas/config é o do **padrão da prefeitura** quando ela definiu um; senão, o deste servidor. O Painel da Prefeitura mostra "Versão do app disponível: 1.2.x" no Padrão da prefeitura (`appLatest` no GET /api/prefeitura). Nos testes, `TELAS_APP_DIR` aponta para outra pasta.

**Tamanho no git:** cerca de 4,5 MB por versão (o histórico cresce isso a cada versão publicada). Se pesar, o caminho é guardar o APK no R2 (midia.nexa.tv.br) e deixar no repositório só o latest.json com a URL e o SHA-256.

## 24. Legendas da programação nas telas (contrato §14, 14/11)

Campo `captions: { on, lang }` na configuração (`server/telas-core.js`: FACTORY desligado, `cleanCaptions`, `CAPTION_LANGS`), na mesma precedência dos outros campos (tela > repartição > padrão > fábrica; o grupo não define) e no `/config` como `captions`. No Painel da Prefeitura: Padrão da prefeitura, Repartições e Telas → editar ("Legendas da programação": não define, desligadas, ligadas no idioma do canal ou ligadas num idioma); no painel da repartição: aba Telas → editar a tela. **O ar oferece hoje só a legenda CEA-608 em português** (embutida no vídeo; a mestre HLS não declara faixas de legenda); as traduções por idioma estão só no caminho do `/epg` do site e da TV. O app 1.2.5 mostra a do canal quando o idioma pedido não existe no fluxo, e a escolha feita no aparelho vale até a próxima mudança do painel.

## 25. Comunicação interna de UPA e hospital (contrato §16 e §17, 19/11)

Módulo **`interna`** ("Comunicação interna"), ligado de fábrica na UPA e no hospital (as outras repartições ligam em Repartições → Editar → Módulos). Código: `server/telas-interna.js` (banco, rotas e tempo real), `server/telas-interna-core.js` (regras sem banco), `public/reparticao/rep-interna.js` (as abas do painel da repartição), `public/reparticao/interno.{html,js,css}` (a página do celular), `CODE_COLORS` em `public/shared/telas-tipos.js`. **Nada de dado de paciente**: só funcionários, setores, avisos e o local do código ("Observação, leito 4").

**Telas internas.** O Painel da Prefeitura (Telas → Editar: "Tela interna" e o setor) ou o gestor da repartição (aba Comunicação interna → Telas internas) marca uma TV box como interna (posto de enfermagem, repouso, copa, vestiário). Colunas novas `telas_devices.internal` (0/1) e `sector_id` (migração aditiva, `TELAS_ADDED_COLS`). Só a tela interna de uma repartição com o módulo ligado recebe conteúdo interno; mudar a tela de repartição tira o setor; revogar, excluir ou voltar a pública derruba a conexão de tempo real dos códigos.

**O que a tela PÚBLICA recebe: nada interno.** Nem a chave `internal` no /config, nem `codes` no sinal de vida; a conexão `/api/telas/internal/stream` abre e só recebe o ping. Testado em `test/telas-interna-servidor.test.js` (o texto do aviso e o código não aparecem em /config, sinal de vida nem /queue da tela pública nem da tela de outra repartição).

**Setores** (`telas_int_sectors`, até 40 por repartição): nome e a lista opcional de funcionários (nome ou matrícula, um por linha, até 300, sem repetir sem diferenciar acento e maiúsculas). Cada setor tem dois endereços para o celular, `/interno/<token>`:

| Endereço | O que faz |
|---|---|
| leitura (`read_hash`) | lê os avisos do setor e marca **Li**; recebe os códigos em tempo real |
| disparo (`fire_hash`) | o mesmo e também **dispara e encerra** códigos (entregar só a quem a direção autorizar) |

Os dois só em SHA-256; o endereço aparece **uma vez** (com o QR code para imprimir) e gerar outro derruba o anterior; **Desligar** apaga. Freio: 120 pedidos por minuto por IP (`TELAS_INTERNO_PER_IP_MIN`) e 600 por setor (`TELAS_INTERNO_PER_SECTOR_MIN`). A página sai com os cabeçalhos da página da repartição (CSP `default-src 'none'; script-src 'self'; style-src 'self'; …`, `no-referrer`, `DENY`, `no-store`), sem script nem estilo inline, sem `innerHTML`; as cores dos códigos vêm por classe (`cc-<cor>` da paleta fechada). O token vai sempre no cabeçalho `Authorization`, nunca no endereço de uma rota da API: o tempo real do celular é SSE lido pelo `fetch` (não `EventSource`).

**Avisos internos** (`telas_int_notices`): tipo (Aviso da direção, Escala do plantão, Treinamento, Protocolo, Aniversariantes), título (80), texto (600, com quebras de linha), setores de destino (nenhum = todos), validade (1 minuto a 60 dias; 7 dias de padrão), segundos na tela (5 a 120). Até 60 em vigor por repartição. Na tela interna entram **na frente do revezamento dos cartões** (layouts com lateral); o setor da tela escolhe quais (tela sem setor recebe todos). **"Li"** (`telas_int_reads`, chave `aviso + nome sem acento e minúsculo`): o funcionário escreve o nome ou a matrícula uma vez (fica no `localStorage` do celular) e toca em Li; ler de novo não muda a hora. O painel mostra **quem leu, de que setor e quando**, e, com a lista do setor, **"Lido por N de M"** e **quem falta**. O nome de quem leu não vai à auditoria.

**Códigos de emergência hospitalar** (`telas_int_codes`). De fábrica: Código Azul (parada cardiorrespiratória), Vermelho (incêndio), Rosa (bebê ou criança desaparecida, sequestro), Laranja (múltiplas vítimas ou desastre), Cinza (agressão ou pessoa violenta) e Amarelo (ameaça de bomba). A lista é editável por repartição (até 12; nome, significado e uma cor da paleta `CODE_COLORS`) e fica em `telas_office_extras.data.intCodes`, com o tempo na tela `intCodeMin` (padrão 30 min; 0 = até alguém encerrar; máximo 720). Disparo em um toque (com confirmação) pela aba **Códigos de emergência** (qualquer papel: o atendente da recepção também) ou pelo endereço de disparo, com o local. Vai **só** às telas internas da repartição (todas, qualquer setor) e aos celulares com a página de um setor dela aberta. Encerrar pelo painel ou pelo endereço de disparo; vencido, sai sozinho (`closed_by = '(tempo esgotado)'`). Freio: 10 disparos por minuto por repartição (`TELAS_CODES_PER_MIN`). Log: quem disparou (usuário do painel ou "setor · nome (celular)"), por onde, quando, quem encerrou e quando; tudo na auditoria do cliente.

**Celular.** Com a página aberta, o código aparece no topo na cor do código, vibra e, depois de a pessoa tocar em "Ativar o alerta sonoro" (o navegador exige um toque), toca um alerta que repete a cada 4 s por 1 minuto. Com a página fechada, nada chega (não há notificação push).

**Reaproveitado do pânico silencioso (§21)?** Não: o pânico é o contrário (nunca aparece em tela nenhuma, vai ao CCO). Os códigos usam a sessão do link, o mesmo `fail/line` e o mesmo formato de SSE da chamada de senha.

| Rota (painel da repartição) | Quem | O quê |
|---|---|---|
| `GET /api/reparticao/codes` | qualquer papel | a lista de códigos, o tempo, os em vigor e o log |
| `POST /api/reparticao/codes` `{ code, place }` · `POST …/codes/:id/close` | qualquer papel | disparar e encerrar |
| `GET /api/reparticao/interna` | gestor | setores, avisos com quem leu e quem falta, telas, tipos, códigos |
| `POST/PATCH/DELETE /api/reparticao/interna/sectors[/:id]` | gestor | setores e a lista de funcionários |
| `POST/DELETE /api/reparticao/interna/sectors/:id/link/read|fire` | gestor | o endereço do celular (aparece uma vez) |
| `POST /api/reparticao/interna/notices`, `POST …/notices/:id/cancel` | gestor | aviso interno |
| `PUT /api/reparticao/interna/codes` `{ codes, minutes }` | gestor | a lista de códigos e o tempo na tela |
| `PATCH /api/reparticao/interna/devices/:id` `{ internal, sectorId }` | gestor | tela interna ou pública (só as telas dela) |
| `PATCH /api/prefeitura/devices/:id/internal`, `GET /api/prefeitura/offices/:id/sectors` | prefeitura.manage | o mesmo pelo Painel da Prefeitura |
| `POST /api/interno/state` `{ reader }`, `POST /api/interno/notices/:id/read` `{ reader }`, `GET /api/interno/stream` | endereço do setor | a página do celular |
| `POST /api/interno/codes`, `POST /api/interno/codes/:id/close` | endereço de disparo | disparar e encerrar pelo celular |

Abas do painel da repartição (`officeTabs`): **Códigos de emergência** logo depois do atendimento (gestor e atendente; o atendente sem a chamada de senha fica só com ela) e **Comunicação interna** antes de Telas (só o gestor). Limpeza (6 em 6 h): avisos vencidos ou encerrados há mais de 90 dias (com as leituras) e códigos de mais de 90 dias.

### Contrato do app (§16 e §17)

**§16 Som da chamada de senha.** `/config` traz sempre `callSound: { mode, volume }`: `mode` = `"beep"` (Bipe), `"voice"` (Falada), `"both"` (Bipe + falada) ou `null` (o painel não definiu); `volume` = volume da fala, 0 a 100 (relativo ao volume do aparelho). Precedência no servidor, campo a campo: tela > repartição > padrão da prefeitura (o grupo não define); de fábrica `{ mode: null, volume: 100 }`. **No app:** o que o painel definiu vale; se `mode` é `null`, vale o escolhido em Ajustes → "Som da chamada no aparelho" (navegável pelo controle); sem nenhum dos dois, **Bipe + falada**. Servidor antigo (sem `callSound`): a escolha do aparelho ou, sem ela, o `queue.voice` (voz ligada = bipe + falada). A fala vem depois do bipe, com as letras pelo nome e os algarismos um a um ("Senha á zero zero dois, consultório três", `SpeechText`), pela voz pt-BR do Android (`TextToSpeech`, `KEY_PARAM_VOLUME`). Sem voz em português no aparelho, não quebra: toca só o bipe e o diagnóstico avisa. O diagnóstico mostra o modo que vale, o volume e **de onde veio** (painel, aparelho, padrão). `queue.voice` continua no contrato só para os apps antigos.

**§17 Tela interna.**

- `/config.internal` (só na tela interna; ausente na pública): `{ sector: string | null, notices: [{ id, kind, header, title, text, seconds, until }] }`, até 12 avisos, do mais novo ao mais antigo. `header` é o tipo em caixa alta ("AVISO DA DIREÇÃO"). O app 1.2.7 põe os avisos na frente do revezamento dos cartões (título "AVISO DA DIREÇÃO · Reunião", o texto em até 8 linhas de 90). Mudou um aviso, muda o `rev`.
- §17.2 `codes` no sinal de vida (só na tela interna; ausente na pública) e o evento `codes` (`{ codes: [...] }`, a lista inteira) em `GET /api/telas/internal/stream` (SSE como o da senha: `: ok` ao abrir, `: ping` a cada 20 s, no máximo 2 conexões por tela). Cada código: `{ id, code, label, meaning, color: "#rrggbb", textColor: "#rrggbb", colorKey, place, firedAt, until: epoch ms | null }` (`null` = até alguém encerrar). O app mostra o mais novo em vigor em tela cheia, por cima de tudo (até do alerta), na cor do código, com o nome, o significado, o local, a hora e os outros em vigor; toca o alerta (`alerta.wav`) em repetição por até 90 s pelo volume do aparelho, baixando o som do canal. O "sem som" do vídeo não cala o código. Sai quando some da lista ou passa do `until`. O vídeo e a superfície não mudam.

## 26. Salas e consultórios (UPA e hospital, 19/11)

Código: `server/telas-salas.js` (banco e rotas, criado dentro de `createSenha`) e `server/telas-salas-core.js` (regras sem banco); catálogo `public/shared/telas-salas.js`; página da repartição `public/reparticao/rep-salas.js` (abas **Salas e consultórios**, **Apoio** e **Indicadores**, do gestor) e as mudanças em `rep-senha.js` (Atendimento e Recepção); Painel da Prefeitura, aba **Senhas** (`paintRooms` em `prefeitura-fase3.js`). Testes: `test/telas-salas.test.js` e `test/telas-salas-servidor.test.js` (SQLite e Postgres).

**Tabelas novas** (só `CREATE TABLE IF NOT EXISTS`, nenhuma coluna nova em tabela de antes; entram em `TELAS_FASE3_TABLES`, na cópia SQLite → Postgres e na exclusão do cliente e da repartição):

| Tabela | O que guarda |
|---|---|
| `telas_room_groups` | grupo de salas: nome, as filas que atende (`services`, JSON), `auto` (round robin), ordem |
| `telas_rooms` | sala: nome, `kind` (consultório, classificação, medicação, raio-X/exames, reavaliação, sala, guichê, recepção, outro), grupo, ativa, `state` (`available`, `pause`, `busy`), `state_at`, `ticket_id` (a senha que está nela) |
| `telas_access` | os endereços sem login: `kind` `sala` (com `ref_id` = a sala) ou `apoio` (`ref_id` 0); só o SHA-256 do token |
| `telas_support` | os pedidos de apoio: sala, o que pediu, situação, quem aceitou e quando, conclusão. 90 dias |
| `telas_queue_events` | a linha do tempo da senha para os indicadores: `triage` (a cor dada, com a hora), `call` (a sala e o tipo dela), `arrive` ("Paciente chegou", §31) e `noshow` (não compareceu, com a sala). Só a cor; nunca o motivo. 90 dias |
| `telas_follow` | o QR do acompanhante: o SHA-256 do token e o fim do dia em que vence |

**Cadastro.** Na aba **Salas e consultórios** (gestor) e no Painel da Prefeitura (aba Senhas, repartição escolhida): nome (único na repartição), tipo, grupo, ativa/desativada; até 60 salas e 20 grupos. Um **grupo** (ex.: "Clínico geral" = Consultórios 1, 2 e 3) atende uma ou mais filas da repartição. Sala sem grupo chama de todas as filas.

**Chamar numa sala.** `POST <base>/call { roomId }`: o nome da sala é o guichê que vai à tela (o campo `desk` de sempre continua valendo para quem digita), a próxima senha sai das filas do grupo pela mesma ordem de sempre (`rankQueue`, Manchester) e a sala fica **Ocupada** com a senha. Com `ticketId` é o "Chamar esta" da sala. Finalizar, Não compareceu, Voltar à fila e Encaminhar devolvem a sala a **Disponível**. **Pausa** só o gestor, o atendente ou a própria sala põem (`POST <base>/rooms/:rid/state { state: available | pause }`); **Ocupada** é o sistema.

**Atendimento.** Com salas cadastradas, o Atendimento mostra a lista **Sala** (com a situação de cada uma); a escolha fica lembrada neste navegador (`localStorage`, só o número da sala; a sessão continua só na aba). "Escrever o nome" volta ao campo de antes. A sala escolhida ganha os botões Disponível e Pausa.

## 27. Round robin e a página da sala

**Automático (por grupo).** Com `auto` ligado, quando uma sala do grupo fica Disponível (ou entra uma senha, ou uma senha é encaminhada ou volta à fila, e a cada 30 s) e há gente esperando nas filas do grupo, o servidor distribui entre as salas **disponíveis**, a livre há mais tempo primeiro (`state_at`; empate pela ordem). A sala é reservada antes (só quem a tira de `available` usa) e a senha é tirada de "esperando" pela mesma chamada de sempre: **duas salas nunca levam a mesma senha**. Sem ninguém esperando, a sala volta a Disponível com a hora de antes (não perde a vez). Uma distribuição por vez por repartição (na memória do processo).

**Endereço da sala** (`/reparticao/<token>/sala`): gerado em Salas e consultórios ou no Painel da Prefeitura, mostrado uma vez, só o SHA-256 em `telas_access`; gerar de novo derruba o anterior; **Revogar** desliga; sala desativada ou removida também. Página feita para o celular (375 px), sem login, com a CSP do link de controle (sem inline, nada de fora, sem `innerHTML`). Rotas (`Authorization: Bearer <token>`):

| Rota | O que faz |
|---|---|
| `GET /api/sala` | a sala, a senha dela (com o nome reduzido, se houver, e a etapa), quem espera nas filas do grupo **sem nomes** (código, fila, cor, espera, atraso, motivo), as filas para encaminhar e os pedidos de apoio dela |
| `POST /api/sala/call` | **Chamar paciente** (409 com paciente ainda na sala, §31) |
| `POST /api/sala/arrive` | **Paciente chegou** (§31) |
| `POST /api/sala/repeat` · `noshow` · `finish` · `requeue` | sempre a senha que está NESTA sala (o pedido não escolhe outra) |
| `POST /api/sala/forward { next: true }` ou `{ serviceId }` | próxima etapa ou outra fila |
| `POST /api/sala/state { state }` | Disponível ou Pausa |
| `POST /api/sala/tickets/:id/risk { risk }` | **Reavaliar**: só quem espera nas filas da sala e passou do tempo-alvo |
| `POST /api/sala/support { kind }` · `POST /api/sala/support/:id/cancel` | pedido de apoio |

Não emite senha, não lê a fila com nomes, não abre o painel. Freio: `TELAS_SALA_PER_MIN` (240 por minuto por repartição) e `TELAS_SALA_PER_IP_MIN` (240 por IP). Quem chamou fica na chamada como `sala: <nome>` (`called_by`; o Atendimento mostra em `calls[].by`); o automático, como `automático: <nome>`.

## 28. Pedidos de apoio e o tempo-alvo

**Apoio.** A sala toca em "Preciso de: Maqueiro, Limpeza, Segurança, Enfermagem" (lista editável por repartição, até 12, em Salas e consultórios). O pedido aparece na aba **Apoio** e num cartão dentro do **Atendimento** (aceitar, concluir, cancelar), com a hora, a sala, quem aceitou e o tempo até aceitar. O mesmo pedido aberto da mesma sala não repete (409); dois aceites: só um vale. **Endereço do apoio** (`/reparticao/<token>/apoio`, mesmo padrão do da sala): o celular do setor vê os pedidos de hoje, escreve o próprio nome (guardado só no aparelho) e aceita/conclui: `GET /api/apoio`, `POST /api/apoio/:id/accept|done { who }`. Rotas do painel: `GET <base>/support`, `POST <base>/support/:id/accept|done|cancel`, `POST|DELETE <base>/support-link`.

**Para as telas internas** (outro agente faz as telas): `GET /api/telas/support` com o token da TV box devolve os pedidos **abertos e aceitos** da repartição dela, sem nomes de pessoa:

```json
{ "serverTime": 1763550000000, "requests": [ { "id": 7, "room": "Consultório 2", "kind": "Maqueiro", "status": "open", "at": 1763549900000, "acceptedAt": null } ] }
```

`status`: `open` (esperando alguém) ou `accepted` (a caminho). Concluído e cancelado saem. Sondagem sugerida: a cada 10 s.

**Tempo-alvo do Manchester.** Os alvos são os da §10 (vermelho 0, laranja 10, amarelo 60, verde 120, azul 240 min; editáveis por repartição em Recepção → "Filas, totem e configuração"; o vermelho é sempre 0). Uma senha **passou do alvo** quando espera, tem cor, ainda não foi chamada por um consultório (sem consultório cadastrado: ainda não foi chamada) e a espera desde a emissão é maior que o alvo; o vermelho passa assim que espera. Ela **pisca** (com `prefers-reduced-motion`, fica só destacada) no Atendimento, na Recepção e na página da sala, com **Reavaliar** (o gestor, pela cor; a sala, pelos botões das cores). No overview, cada senha leva `overMin` (minutos acima do alvo ou `null`) e o total em `overdue`.

**No estado das telas** (`GET /api/telas/queue` e o `state` do SSE), só na repartição com a classificação de risco ligada (as outras recebem o estado como antes):

```json
"overdue": { "total": 1, "byRisk": { "vermelho": 1, "laranja": 0, "amarelo": 0, "verde": 0, "azul": 0 }, "tickets": [ { "ticket": "A012", "risk": "vermelho", "overMin": 0 } ] }
```

Só o código da senha, a cor e os minutos acima (até 12). Como o atraso muda com o relógio, o servidor reconfere o estado das repartições com tela ligada a cada minuto.

## 29. QR do acompanhante

Ligado de fábrica na UPA e no hospital (`follow`), desligado nas outras; **a cor desligada de fábrica** (`followRisk`). Ligado, a emissão (recepção e totem) devolve `follow`: `https://<painel>/senha/<token>` (32 bytes aleatórios; no banco só o SHA-256; vence à meia-noite de Brasília do dia da senha). O totem põe o QR no papel; a Recepção ganha **Imprimir a senha** (papel de 72 mm com o QR, pela impressão do navegador). O endereço não fica guardado em lugar nenhum: perdeu o papel, perdeu o QR.

A página `/senha/<token>` (CSP estrita, sem nada de fora, `noindex`, `no-referrer`) lê `GET /api/acompanhar` (`Authorization: Bearer <token>`; 60 por minuto por IP) a cada 15 s: a repartição, o código, a situação, a etapa ("Etapa 3 de 4: Consultório"), a **posição aproximada** ("É a próxima", "2 pessoas antes", "Cerca de 10 pessoas antes", na fila em que está), "**Foi chamada: Consultório 3**" e, se ligada, a espera estimada. **Nunca** o nome, a queixa ou o motivo; a cor só com `followRisk`. Token errado, vencido ou de repartição desligada: 401 com a mesma mensagem.

## 30. Espera estimada para casos leves

Desligada de fábrica (`estimate`). Ligada, o estado das telas ganha `estimate` e a página do QR mostra o texto:

```json
"estimate": { "hours": 3, "byRisk": { "vermelho": null, "laranja": 8, "amarelo": 35, "verde": 70, "azul": 95 }, "lightMin": 80, "light": "Casos verdes e azuis: cerca de 80 min de espera", "text": "Casos leves: UBS Centro, Rua A, 100." }
```

`byRisk`: a média, em minutos, da emissão à 1ª chamada médica (consultório; sem consultório, a 1ª chamada) das senhas chamadas nas últimas `hours` horas (1 a 12, padrão 3), `null` sem amostra. `light` arredonda para gente (de 5 em 5 até 20, de 10 em 10 até 2 h, depois de 30 em 30) e vem `null` sem amostra. `text` é o texto livre da repartição (até 160). Configuração: `PUT <base>/upa { estimate, estimateHours, estimateText }`.

## 31. Etapas do atendimento e indicadores

**Etapas.** `PUT <base>/upa { flow: [{ name, serviceId }] }` (até 8, cada uma numa fila diferente; o nome vazio usa o da fila), em Salas e consultórios. Ex.: Recepção → Classificação → Consultório → Medicação/Exames → Reavaliação. **Encaminhar para a próxima etapa** (`POST <base>/tickets/:tid/next-stage`, a sala com `{ next: true }`) é o Encaminhar de sempre para a fila da etapa seguinte: mantém o código, a prioridade e a cor (e o relógio da cor, que conta desde a emissão). Cada senha do overview e a da sala levam `stage: { name, index, total, next }`; a última etapa responde 409. A mesma `PUT <base>/upa` guarda o QR (`follow`, `followRisk`), a espera estimada e a lista do apoio (`support`), em `telas_office_extras.data.upa` (sem coluna nova).

**Indicadores.** Aba **Indicadores** (gestor) e `GET <base>/indicators?from=&to=&by=day|week|month[&format=csv]` (até 90 dias; também no Painel da Prefeitura). Totais, por período (a semana começa na segunda), **por cor** e "sem cor": senhas, atendidas, não compareceram, **porta–classificação** (da emissão à 1ª cor dada: na recepção, na triagem ou no Reavaliar), **porta–médico** (da emissão à 1ª chamada num consultório; sem consultório cadastrado, à 1ª chamada) e quantas viram o médico **acima do tempo-alvo**; **chamadas por sala** (pelo nome que foi à tela) e **por hora** (senhas emitidas e chamadas). O CSV tem o BOM do Excel e uma seção por bloco. Nada de nome no CSV.

**Quem chama cada etapa (20/11).** Cada etapa de `flow` ganha `mode` (na mesma `PUT <base>/upa`; o painel antigo que não manda `mode` mantém o guardado para a mesma fila; o guardado antes de 20/11, sem `mode`, é Recepção):

| Modo | O que acontece |
|---|---|
| `recepcao` (Recepção, padrão) | como antes: o Atendimento e o guichê chamam e encaminham no painel |
| `sala` (Profissional da sala) | só a página da sala (celular) chama. A "próxima" do painel e do guichê pula essas senhas (sobrando só elas: 409 "…etapa chamada pelo profissional…"); `ticketId` ou `serviceId` delas: o **atendente** e o guichê recebem 403, o **gestor** (e o Painel da Prefeitura) chama **por exceção** (`exception: true` e `stage` na resposta; o log diz "senha X da etapa "Y" (chamada pelo profissional da sala) chamada por exceção"). No overview a senha leva `awaitPro: true` e aparece "aguardando o profissional"; o botão vira **Chamar por exceção** (só o gestor, com confirmação) |
| `auto` (Automático) | o round robin da §27 distribui as senhas dessa fila entre as salas Disponíveis dos grupos que atendem a fila, mesmo com o automático do grupo desligado |

O automático do grupo (`auto` do grupo, de antes) continua valendo para as filas dele, **menos** as das etapas do profissional (essas nunca são automáticas). O tique de 30 s passa por todas as repartições com grupo. Atalhos: `PUT <base>/upa { preset: 'recepcao' }` (**Tudo pela recepção**: toda etapa em Recepção e o automático de todos os grupos desligado) e `{ preset: 'profissionais' }` (**Profissionais chamam**: a 1ª etapa segue com a recepção, as outras com o profissional). A resposta traz `warnings`: etapa do profissional sem sala ativa que atenda a fila; etapa automática sem grupo com sala ativa. Na aba Salas e consultórios, cada etapa tem o campo **Quem chama**, os dois atalhos e os avisos; o grupo que distribui por causa da etapa aparece como "automático (etapa)".

**Confirmar a chegada (20/11).** A chamada passa por: **chamada** → **chegou** (em atendimento) → finalizada ou encaminhada. `confirm` em `data.upa` (de fábrica ligado na UPA e no hospital, desligado nas outras; caixa "Exigir a confirmação de chegada"): ligado, a página da sala só **Finaliza** e **Encaminha** depois do "Paciente chegou" (409 antes); "Não compareceu", "Chamar de novo" e "Voltar à fila" valem sempre. O painel não é travado (a recepção finaliza como antes).

| Rota | O que faz |
|---|---|
| `POST /api/sala/arrive` | **Paciente chegou** (a senha desta sala); 409 se já confirmada |
| `POST <base>/tickets/:tid/arrive` | o mesmo pelo painel (o atendente também alcança), para a sala sem celular |
| `POST /api/sala/call` | agora 409 se ainda há paciente na sala (um por vez: Finalizar, Encaminhar, Não compareceu ou Voltar à fila antes) |

A confirmação é a linha `kind = 'arrive'` em `telas_queue_events` (com a sala e a hora; nenhum dado pessoal; vale só a feita depois do `called_at` da chamada atual, então quem voltou à fila e foi chamado de novo confirma de novo). "Não compareceu" grava `kind = 'noshow'` com a sala. Nenhuma coluna nova. `GET /api/sala` traz `confirm` e, na senha da sala, `callState` (`called` | `arrived` | `serving` = em atendimento sem confirmação exigida), `arrivedAt`, `repeats` e `shownAt`. No overview, as senhas chamadas levam `callState` e `arrivedAt`; o Atendimento mostra "chamado · esperando chegar", "chegou às HH:MM" ou "em atendimento" e o botão **Paciente chegou** / **Chegou**.

**A página da sala, passo a passo** (375 px, botões grandes): **Chamar paciente** → (**Paciente chegou** | **Chamar de novo** | **Não compareceu**, com "Chamado há X min · chamado de novo N vezes") → (**Encaminhar para <próxima etapa>** | **Finalizar**). Disponível/Pausa só com a sala livre. Finalizar, Encaminhar, Não compareceu e Voltar à fila devolvem a sala a **Disponível**; se a fila do grupo é distribuída sozinha, ela recebe a próxima na hora.

**Indicadores (20/11).** `totals.arrived` e `totals.callToArriveMin` (chamada–chegada: de cada chamada ao 1º "chegou" depois dela, em minutos); `byRoom[]` ganha `arrived`, `noshow` e `callToArriveMin` (só o que aconteceu numa sala cadastrada; sala removida sai como "(sala removida)"). O CSV ganha a linha "Chamada–chegada" e as colunas novas na seção Sala.

**Privacidade de saúde.** Em nenhuma tabela, rota ou página nova há queixa, sintoma ou tipo de problema: só a cor do risco (como a §10). Nome só o reduzido, e só na página de controle e na sala que atende a pessoa; nunca na página do QR, no estado das telas, no apoio nem nos indicadores.

## 32. A licença sobrevive à reinstalação do app (20/11)

Antes, desinstalar e instalar de novo o NEXA Telas apagava o token (fica na pasta do app) e alguém tinha de gerar e digitar outra chave. Agora a TV box volta sozinha à mesma tela.

**Identidade do aparelho.** O app calcula o `hwid` = SHA-256 (hexa minúsculo) de `ANDROID_ID|br.com.nexatv.telas` (`android-telas/…/core/Recovery.kt`, `HardwareId`). Do Android 8 em diante o `ANDROID_ID` é por chave de assinatura do app + usuário + aparelho: continua igual depois de desinstalar e reinstalar o app com a mesma assinatura e só muda no reset de fábrica. O `ANDROID_ID` cru nunca sai do aparelho. `ANDROID_ID` vazio, curto, todo zero ou o defeituoso conhecido (`9774d56d682e549c`) = sem hwid (o app pede a chave como antes).

**Ativação.** `POST /api/telas/activate` aceita `device.hwid` (opcional; app antigo sem ele segue ativando). O servidor guarda só `telas_devices.hwid_hash` = SHA-256 de `telas-hwid:<hwid>` (quem lê o banco não tem o que mandar). O aparelho pertence a uma tela só: ativar com outra chave tira o vínculo de qualquer tela anterior dele (a tela anterior não é mexida, só fica sem o vínculo).

**Recuperação.** `POST /api/telas/recover { hwid, device }`, sem credencial:

| Situação | Resposta |
| --- | --- |
| tela ATIVA ligada ao hwid, cliente com o modo ligado | 200 `{ deviceId, token, channel, name }` (o mesmo formato da ativação) |
| nenhuma tela, tela revogada ou excluída, modo desligado | 404 |
| hwid malformado (não é hexa de 64) | 400 |
| mais de `TELAS_RECOVER_PER_IP` (padrão 6) por minuto e IP | 429 |

No 200 o token é NOVO e o anterior para de valer na hora (uma instalação viva por tela; o tempo real da senha e da comunicação interna aberto com o antigo cai). A tela grava `recovered_at`, atualiza modelo, Android e versão do app e a auditoria registra "tela … reativada sozinha após reinstalação do app em …". O Painel da Prefeitura mostra **Reinstalação: Instalação recuperada em <data>** no cartão da tela (`recoveredAt` no DTO). **Revogar** apaga o vínculo (`hwid_hash = NULL`): a tela revogada não volta sozinha; excluir apaga a linha.

**No app.** Sem token e fora do modo avulso, a thread do servidor pergunta ao `/recover` logo na partida (o assistente inicial e a tela da chave aparecem como antes, com "Procurando a ativação anterior deste aparelho…"). Pergunta ao servidor guardado (se houver outro) e ao padrão `https://api.nexa.tv.br`. Sem rede ou com o relógio ainda errado: de novo a cada 5 s no 1º minuto, depois a cada 30 s; 429/5xx: a cada 60 s; 404: para e fica a tela da chave. Voltando, grava o token como a ativação, marca o assistente como feito e busca a configuração. Se a chave for digitada no meio, vale a ativação. Tela revogada no painel (401) volta à tela da chave e a pergunta dá 404.

**Telas já ativadas.** O app desta versão manda o `hwid` também no sinal de vida (`POST /api/telas/heartbeat`, campo opcional): a tela ativada antes, ainda sem vínculo, ganha o vínculo uma vez (tirando-o de outra tela, se houver); a que já tem vínculo não troca. Assim as TV box em campo ficam protegidas assim que o app se atualiza pelo `latest.json`, sem nova chave.

**Banco.** Colunas novas `telas_devices.hwid_hash` (TEXT) e `recovered_at` (INTEGER/BIGINT), aditivas (`TELAS_ADDED_COLS`), e o índice `idx_telas_devices_hwid` criado depois delas (`TELAS_LATE_INDEXES`: `pgIndexes` e `sqlite.js` depois do `addCol`).

**Limites.** Reset de fábrica, troca de aparelho ou app assinado com outra chave = outro `ANDROID_ID`: pede a chave. Quem conhece o hwid (só o próprio app no aparelho calcula) pode pedir o token da tela; nada além do que a ativação já daria. Testes: `test/telas-licenca-reinstalar.test.js` (SQLite com a migração sobre a tabela de antes, e Postgres) e `RecoveryTest.kt`.

## 33. TV Corporativa (20/11)

A TV Corporativa é o modo da empresa do NEXA Telas, ao lado do modo prefeitura: o mesmo app, a mesma TV box, a mesma
ativação e os mesmos comandos, com conteúdo próprio (layout por zonas, mídias, playlists, grade, RH, indicadores, notícias,
o celular do funcionário e o relatório de exibição). O projeto, o contrato com o aparelho (chave `signage` no `/config` e
`plays` no sinal de vida) e as rotas estão em **docs/TV-CORPORATIVA.md**.

O que muda aqui no NEXA Telas:

- **Funcionalidade `tvcorp`** (optIn, como a `prefeitura`) e a permissão **`tvcorp.manage`**. A TV box é aceita quando o
  cliente tem **um dos dois** modos ligado (`available()` em `server/telas.js`). A TV Corporativa não esconde o Comercial.
- **Tipos de unidade corporativos** em `public/shared/telas-tipos.js`, marcados `corp: true` (matriz, filial, fábrica, loja,
  CD, refeitório, recepção, ambulatório, sala de treinamento, outra) e a família **F11 Unidade corporativa** no link da
  unidade (abas Publicar, Comunicados e Aniversariantes, mais as dos módulos). Os tipos corporativos não aparecem no
  Painel da Prefeitura e os da prefeitura não aparecem na TV Corporativa.
- **A rede** (unidades, grupos, telas, chaves, comandos, captura, alertas, aprovações, imagem sem internet) é servida também
  em `/api/tvcorp/rede/*`, com `tvcorp.manage`; o município, os desaparecidos e o alcance de emergência ficam só em
  `/api/prefeitura/*`.
- O `/config` leva a chave `signage` só na tela de unidade corporativa que alguma grade pega; o sinal de vida soma as
  horas ligada e o `plays`. A exclusão da unidade apaga também as mídias, playlists, pessoas, comunicados, indicadores e
  endereços do celular dela. Tabelas novas `tvcorp_*` (só aditivas) em `TELAS_TABLES`, `TELAS_COPY` e `TELAS_IDENTITY`.

## O que é fase futura

- Um papel próprio para a triagem (hoje a cor de risco é do gestor; o atendente não a altera).
- Webhook de saída para a tela desligada (o servidor ainda não tem um mecanismo de webhook de saída).
- Painel de senhas com várias instâncias do servidor (as conexões de tempo real ficam na memória de um processo).
- Calendário de plantão do horário da TV (a disponibilidade não desconta o horário em que a TV fica desligada de propósito).
- Envio do APK pelo painel (hoje a prefeitura informa o endereço, o SHA-256 e o `versionCode`).
