# Apps de tela para TVs Samsung (Tizen) e LG (webOS)

Um player web só, em `comum/`, empacotado para as duas marcas. Ele fala com o servidor pelo **mesmo contrato do app
Android** (`/api/telas/*`: ativação, configuração com `rev`, sinal de vida, comandos e o `signage` da grade). Na tela
só aparece o conteúdo do cliente; a abertura, o cadastro e o "sem internet" mostram a **logo da revenda**, que chega do
servidor. O nome do app no aparelho é **Telas**.

```
apps-tv/
  comum/            o player (HTML/JS puro, sem framework; roda no Chromium 53+ das TVs de 2018 em diante)
    index.html, estilo.css
    js/sha256.js     SHA-256 por partes (as TVs não têm crypto.subtle fora de https)
    js/nucleo.js     regras sem tela: configuração, marca, grade pelo relógio, troca só com tudo baixado, sinal de vida
    js/fila.js       fila de download (poucos de cada vez, confere tamanho e hash, sem rede para a fila inteira)
    js/armazem.js    IndexedDB (arquivos inteiros e pedaços de 4 MB, para continuar de onde parou)
    js/plataforma.js Tizen, webOS ou navegador: identidade, modelo, teclas, rede, proteção de tela
    js/rede.js       cliente da API
    js/tela.js       desenha as zonas e as playlists
    js/app.js        abertura → cadastro → download → reprodução, com e sem internet
    js/config-padrao.js  o servidor de produção (reescrito pelo empacotamento)
  tizen/config.xml  manifesto Samsung
  webos/appinfo.json manifesto LG
  scripts/empacotar.js  gera o .ipk (LG) e a pasta pronta para assinar o .wgt (Samsung)
  teste/            servidor falso + testes `node --test`
```

## Testar no computador

Uma vez, para o gerador da prévia (esbuild-wasm, o mesmo do painel):

```powershell
cd apps-tv; npm install
```

```powershell
node apps-tv/teste/servidor-falso.js
```

- **Painel × TV lado a lado**: <http://localhost:8787/teste/comparar> mostra cada tipo de item com o desenho do
  painel (o módulo original de `public/shared`) à esquerda e o do app (o `tela.js` de verdade) à direita, em zona larga,
  lateral ou grande. `/teste/tipos?modo=lateral` (vídeo 75% + playlist 25%) ou `?modo=cheia` põe um item de cada tipo
  na grade da tela; `/teste/tema?cor=%2315803d&modo=light` troca o tema.

- A tela: <http://localhost:8787/?servidor=http://localhost:8787> (no navegador o vídeo é sempre **mudo**; `&som=1` liga).
- O "painel" falso: <http://localhost:8787/teste/painel>: aprovar o código da TV, cortar e religar a rede, virar a grade
  em 1 ou 2 minutos, publicar imagem nova (inteira ou corrompida), deixar o download lento, alerta em tela cheia.
- Ajustes escondidos na tela: **↑ ↑ ↓ ↓ OK** no controle (ou a tecla INFO): servidor, programação, espaço, último erro.

O roteiro conferido no navegador embutido (22/11/2026): código na tela → aprovado no painel → baixou 6 arquivos e
tocou a grade A (vídeo guardado + playlist + faixa) → grade nova com virada em 2 min → rede cortada → a tela trocou
para a grade B no minuto certo **sem rede** → recarregada sem rede, voltou da memória → imagem corrompida publicada:
a tela recusou (sha256), **seguiu com a programação antiga** e avisou no sinal de vida → arquivo certo: trocou sozinha
→ a contagem de exibição chegou ao servidor.

Testes automáticos (leves, sem navegador):

```powershell
cd apps-tv; node --test "teste/*.test.js"
```

Cobrem: SHA-256 contra o do Node; a fila (repetidos, simultâneos, hash/tamanho errado, erro de rede com espera, sem
rede para tudo sem gastar tentativa); a troca só com tudo baixado (inclusive logo, imagem e vídeos do "sem internet");
a limpeza; a grade (fuso, virada da meia-noite, datas, fallback, item com horário próprio, horário da TV); leitura
tolerante da configuração e da marca; o sinal de vida; a sintaxe que as TVs antigas aceitam; o servidor falso; os
pacotes (.ipk aberto e conferido, pasta do Tizen).

## Como funciona sem internet

1. O sinal de vida (a cada 30 s) traz o `rev`. Mudou: busca a configuração e guarda como **"a que está chegando"**.
2. Lista o pacote inteiro: logo da revenda, imagem sem internet, vídeos guardados (`offline.items`) e os arquivos de
   todos os blocos da grade (hoje e amanhã, como o servidor manda).
3. Baixa o que falta, 2 por vez, em pedaços de 4 MB com `Range` (continua de onde parou depois de desligar), conferindo
   **tamanho e SHA-256**. O que não confere é apagado e baixado de novo do zero (3 tentativas por ciclo).
4. **Só com tudo inteiro** a programação nova entra. Até lá a tela segue com a anterior (ou, na primeira vez, mostra a
   logo da revenda e o progresso). Depois da troca, apaga o que nenhuma programação cita.
5. A grade é reavaliada a cada 15 s pelo relógio corrigido com a hora do servidor (guardada), então **muda de bloco no
   horário mesmo sem rede**. O ao vivo (HLS) só toca com rede; sem ela, a zona de vídeo passa os vídeos guardados.
6. A contagem de exibição fica guardada por dia e vai no sinal de vida quando a rede volta (só é zerada depois do 200).
7. Falta de espaço: a tela não começa a baixar, segue com a programação atual e manda o aviso (`lastError` e `storage`).

### Limites de armazenamento (a confirmar em aparelho)

| Plataforma | Onde guarda | Limite |
|---|---|---|
| Navegador (teste) | IndexedDB | a cota do Chromium (dezenas de % do disco livre) |
| Samsung (Tizen 4+) | IndexedDB do app | sem cota do navegador com o privilégio `unlimitedstorage` (no `config.xml`); o teto real é o espaço livre da TV, em geral 1 a 3 GB e dividido com os outros apps |
| LG (webOS 4+) | IndexedDB do app | cota do Chromium do aparelho; as TVs LG costumam ter pouco espaço livre (de centenas de MB a ~1,5 GB) |

Recomendação até medir nas TVs: **pacote de até 500 MB por tela**, vídeos H.264 1080p com taxa moderada. A tela manda
`storage: { used, free }` no sinal de vida (quando a TV informa), e o painel pode avisar antes de publicar.

## O desenho dos itens (o mesmo código da prévia do painel)

A TV desenha cada item com `itemPreview`/`slidePreview` de `public/shared/tvcorp-previa.js` e o CSS de
`public/shared/tvcorp-previa.css`, sem cópia à mão: `apps-tv/scripts/previa.js` gera `comum/js/previa.js`,
`comum/previa.css` e `comum/arte/`, com as artes `.svg` e as fotos `.jpg` de `public/tvcorp/arte/` (fora do git; o
empacotamento e o servidor falso geram sozinhos). O pacote leva o desenho do `public/` do checkout em que foi gerado.

- **JS**: empacotado pelo esbuild para o Chromium 53, com polyfills de `Array.flat`, `append`, `Object.entries` e
  `padStart`.
- **CSS**: as TVs de 2018–2020 não têm container queries, `min()`, `gap` no flex, `inset` nem `:has()`. `Ncqw`/`Ncqh`
  viram `calc(N * var(--cqw|--cqh))`, `min(A, B)` vira `var(--mI)`, `gap` vira margem entre os filhos e `inset` vira
  top/right/bottom/left. O app mede cada zona e põe as variáveis nela. Slide e item são containers no painel: lá dentro
  1cqw é 1% da largura **sem o padding**; o app mede isso também (`TelasPrevia.CONTEINERES`).
- **Dados do aparelho**: imagens, imagem dos campos do slide e fotos dos aniversariantes saem do IndexedDB (`blob:`).
  Foto é opcional: não segura a troca de programação; sem ela, as iniciais (as do servidor, `initials`) num círculo da
  cor do tema. Dias sem acidente são contados pela data (`since`) no aparelho, e relógio, relógio mundial e contagem
  pela hora: seguem certos sem rede. Notícias e cotações ficam com o último valor guardado até a próxima configuração.
- **Tema**: `signage.brand.color/mode` (ou `signage.theme`), as mesmas classes `th-*` do painel.
- Clima, QR code e relógio como item: o painel só os desenha como zona; a TV usa esse mesmo desenho de zona.
- Diferenças de propósito em relação à prévia: as iniciais dos aniversariantes (a prévia divide o nome por `/s+/`, a
  letra "s", e não por espaço, e pinta com `--tacc`, que nenhum tema define). Vale corrigir na prévia do painel.

## Contrato com o servidor

O que já existe no contrato do Android e o app de TV usa igual: `POST /api/telas/activate`, `POST /api/telas/recover`,
`GET /api/telas/config` (com `If-None-Match`/304), `POST /api/telas/heartbeat` (`rev`, `state`, `source`, `net`,
`uptimeSec`, `lastError`, `locked`, `hwid`, `plays`, `playsDay`), `POST /api/telas/commands/:id/done`, o `signage`
(blocos, zonas, itens com `{ url, sha256, bytes }`), `offline.items`, `offline.image`, `stream`, `schedule`, `ticker`,
alertas.

**O que o servidor precisa acrescentar para as TVs** (combinar com a sessão do servidor):

1. **CORS** em `/api/telas/*` e nos arquivos: o app roda do pacote (file://). `Access-Control-Allow-Origin: *`,
   `Allow-Headers: Authorization, Content-Type, If-None-Match, Range`, `Expose-Headers: Date, ETag`, e o `OPTIONS`.
   Sem `Expose-Headers: Date`, o app aceita a hora em `now` (epoch ms) no corpo do sinal de vida.
2. **Código mostrado na TV** (proposta; hoje o Android digita a chave do painel):
   - `POST /api/telas/pair { device }` → `200 { pairId, code: "ABCD-EFGH", expiresAt, pollSec }`. O `pairId` é segredo
     da TV (aleatório, 24+ bytes); o `code` é o que aparece na tela, no alfabeto da chave (sem 0, 1, I, O).
   - `GET /api/telas/pair/:pairId` → `202 { status: "waiting" }` até alguém digitar o código no painel; depois
     `200 { deviceId, token, channel, name, brand? }` **uma vez só**; `404` vencido ou já usado (a TV pede outro).
   - O painel: "Cadastrar tela" com o campo do código, a escolha do cliente final e do grupo.
   - Servidor sem essas rotas (`404/405/501` no `POST /pair`): a TV cai na chave digitada (`/activate`), que já existe.
3. **Marca da revenda**: o app aceita `brand` no topo do `/config`, em `signage.brand` ou na resposta da ativação/
   pareamento, com `name`, `logo` (`{ url, sha256, bytes }` para guardar, ou endereço puro), `color` e `background`.
   Campo faltando = sem ele (sem logo, a tela fica só com o fundo). Quando `docs/CONTRATO-APP-MARCA.md` existir, conferir
   e ajustar `lerMarca` em `comum/js/nucleo.js`.
4. Extras opcionais no sinal de vida (o servidor pode ignorar): `platform` (`tizen`, `webos`, `browser`), `model`,
   `pending: { rev, files, bytes }` (o que está chegando) e `storage: { used, free }`.
5. Item `video` na playlist (`{ id, kind: "video", url, sha256, bytes }`): extensão do DIGITAL ISP; o Android 1.3 pula
   tipo desconhecido.
6. Comando `clear-content` (apaga o conteúdo guardado e baixa de novo). `reboot` e `screenshot` voltam `ok=false`:
   app comum de TV não reinicia o aparelho nem captura a tela.

`device.android` no cadastro leva a versão do sistema da TV ("Tizen 6.5", "webOS 6"), para o painel ter o que mostrar.

## White-label

- Nada do app nem do sistema aparece: sem nome, sem marca d'água. O teste `sintaxe.test.js` barra "DIGITAL ISP" e
  "NEXA" no player.
- Abertura e carregamento (espera): a marca DIGITAL ISP (`comum/marca/logo-digital-isp.svg`), decisão do dono de 23/11/2026. Cadastro e sem internet: a logo da revenda (guardada no aparelho) sobre o fundo da revenda.
- Antes do primeiro cadastro a TV ainda não sabe a revenda: a tela do código fica só com o código e a instrução.
- Nome no aparelho: **DIGITAL ISP**, com o ícone da DIGITAL ISP (`apps-tv/marca/`, gerado de `marca/icones/icone-1024.png`; decisão do dono de 23/11/2026, antes era "Telas"). O que aparece na tela continua sendo a marca da revenda. O id do pacote não mudou (Samsung `DgIspTela1.Telas`, LG `br.com.digitalisp.telas`): a versão nova instala por cima.

## Abrir ao ligar

| Marca | Como |
|---|---|
| Samsung (consumidor) | Não há API para um app de terceiros abrir sozinho. Nos modelos 2018+: **Configurações › Geral › Recursos inteligentes › Executar automaticamente o último aplicativo** (Autorun Last App) ligado; deixe o Telas aberto ao desligar. O nome do menu muda por ano/modelo. |
| Samsung (linha profissional, Tizen signage) | "URL Launcher"/"Custom App" com início automático: fora deste pacote (outro formato de instalação). |
| LG (consumidor) | Não há início automático para app de modo desenvolvedor. Com "Quick Start+" a TV costuma voltar ao app aberto, mas não é garantido. |
| LG (linha profissional, webOS Signage) | menu de início do aplicativo: fora deste pacote. |

O app desliga a proteção de tela (Tizen: `setScreenSaver`; webOS: vídeo na frente segura a tela) e a tecla Voltar
não sai do app.

## Instalar na Samsung (Tizen), fora da loja

Precisa: Tizen Studio com a extensão de TV Samsung e um **certificado Samsung** (autor + distribuidor). Quem cria a
conta Samsung e o certificado é o dono; nenhuma senha passa por aqui.

1. **Na TV**: abra **Apps**, digite **1 2 3 4 5** no controle, ligue **Developer mode**, informe o **IP do computador**
   e reinicie a TV (desligar e ligar pela tomada em alguns modelos).
2. **No computador**: Tizen Studio → Package Manager → Extension SDK → instale **TV Extensions** e **Samsung Certificate
   Extension**.
3. Conecte a TV: Device Manager (ou `sdb connect <IP da TV>`). Anote o **DUID** que aparece.
4. **Certificate Manager** → novo perfil **Samsung** (TV) → certificado de autor e de distribuidor, entrando com a conta
   Samsung do dono. O certificado de distribuidor de desenvolvedor só vale nas TVs cujo **DUID** foi incluído nele:
   cada TV nova precisa entrar no certificado (e o pacote ser assinado de novo). Crie um perfil próprio do DIGITAL ISP;
   não reaproveite o de outro produto.
5. Gere e assine:
   ```powershell
   node apps-tv/scripts/empacotar.js tizen --servidor=https://<servidor de produção> --perfil=<nome do perfil>
   ```
   Sai `apps-tv/dist/tizen/DigitalISP-<versão>.wgt`.
6. Instale: `tizen install -n apps-tv/dist/tizen/DigitalISP-1.0.15.wgt -t <nome da TV no sdb devices>`.
7. Abra o Telas na lista de apps; o código aparece; cadastre no painel.

Atualizar: repetir 5 e 6 (mesmo perfil, versão maior no `config.xml`). O modo desenvolvedor da Samsung não vence,
mas o certificado tem validade: renovar antes de vencer.

## Instalar na LG (webOS), fora da loja

Precisa: conta de desenvolvedor LG (gratuita, do dono) e o **webOS TV CLI** (`ares-*`, do webOS TV SDK).

1. **Na TV**: LG Content Store → instale o app **Developer Mode** → entre com a conta de desenvolvedor LG → ligue
   **Dev Mode Status** (a TV reinicia) → ligue **Key Server**. Anote o IP e a passphrase mostrados.
2. **No computador**: `ares-setup-device` → adicione a TV (IP, porta 9922, usuário `prisoner`) →
   `ares-novacom --device <nome> --getkey` (pede a passphrase da tela da TV).
3. Gere o pacote (não precisa de certificado):
   ```powershell
   node apps-tv/scripts/empacotar.js webos --servidor=https://<servidor de produção>
   ```
   Sai `apps-tv/dist/webos/br.com.digitalisp.telas_1.0.0_all.ipk`. (O `ares-package apps-tv/dist/webos/app` gera o
   mesmo pacote, se preferir a ferramenta da LG.)
4. Instale: `ares-install --device <nome> apps-tv/dist/webos/br.com.digitalisp.telas_1.0.0_all.ipk` e abra com
   `ares-launch --device <nome> br.com.digitalisp.telas`.

**O modo desenvolvedor da LG expira.** O app Developer Mode mostra o tempo restante da sessão; quando ela acaba, a TV
sai do modo desenvolvedor e **os apps instalados por ele somem**. Renove antes: botão **Extend** no app Developer Mode
ou `ares-extend-dev --device <nome>` do computador. Para muitas TVs, isso pede uma rotina (o instalador pelo celular
deve renovar quando visitar a TV) ou a linha profissional da LG.

## O que depende do dono (contas, certificados, ferramentas)

- **Samsung**: conta Samsung, perfil de certificado (autor + distribuidor) com os DUIDs das TVs; Tizen Studio com as
  extensões de TV (já há um Tizen Studio em `C:\tizen-studio` neste computador). Depois: assinar com
  `--perfil=<nome>`.
- **LG**: conta de desenvolvedor LG em cada TV (app Developer Mode) e o webOS TV CLI instalado; renovar a sessão.
- **Servidor de produção**: o endereço https definitivo para `--servidor=` (hoje o padrão é
  `https://app.digitalisp.com.br`, a confirmar).
- **Servidor**: as rotas de pareamento, o CORS e a marca (seção "Contrato").
- **Primeiro teste em aparelho**: medir o espaço real, conferir o `.ipk` com `ares-install`, o `.wgt` com
  `tizen install`, a identidade do aparelho (DUID/LGUDID) e o Autorun Last App.

## Limitações conhecidas desta versão (1.0.0)

- Captura de tela e reiniciar o aparelho: impossíveis para app comum nas duas marcas.
- Itens (desde a 1.0.4): todos com **o desenho da prévia do painel**, o mesmo código (ver "O desenho dos itens"):
  imagem, slide (todos os modelos), comunicado (comunicado, vaga, segurança), aniversariantes com foto ou iniciais,
  indicador com a barra da meta, notícias com o crédito, cotações, cardápio, contagem, dias sem acidente, relógio
  mundial, texto, QR code, clima e relógio. O vídeo da playlist e o ao vivo continuam com o player. Senha (fila) ainda
  não.
- Ao vivo (`stream.hls`), desde a 1.0.3 (`comum/js/aovivo.js`): na Samsung pelo **AVPlay** (o player da TV, o caminho
  recomendado para HLS ao vivo na Tizen); no webOS e no navegador pelo `<video>` nativo (o Chrome do computador não toca
  HLS: só um vídeo comum, como o `/teste/aovivo?url=video` do servidor falso). O player fica numa camada própria e não é
  recriado pelo redesenho da grade, por configuração nova nem por falha do sinal de vida. Vigia: 30 s de tolerância na
  partida, parado 20 s (30 s enchendo o buffer) recarrega; 3 recargas sem andar vão para os vídeos guardados e o ao vivo
  é tentado de novo em 30 s, 60 s… até 5 min. No AVPlay o volume é o da TV (`stream.muted`/`volume` não valem ali).
- PIN de saída e menu de ajustes completos do Android: não há "sair" no app de TV (Voltar não sai); os ajustes
  escondidos só mostram o diagnóstico.
