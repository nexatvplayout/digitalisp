# App Android: o que o servidor já manda e o app ainda não desenha

Lista de 22/11/2026, combinada com a sessão dos templates (branch `claude/relaxed-mcclintock-1c97a6` e `main`). A
prioridade agora é o app da Samsung: o Android fica para depois. Tudo abaixo é **opcional** para o app. Hoje ele recebe
esses campos sem quebrar (ignora ou descarta), conferido pelo código.

| O quê | Origem | O que o app faz hoje | O que falta |
|---|---|---|---|
| `qrSize`, `priceSize`, `photoSize`, `titleSize` no slide (`s`, `l`, `xl`; ~0,7 / 1,4 / 1,8) | a653f01 | ignora (médio) | aplicar a escala no desenho |
| `countdown.until` (epoch ms) | 17905f6 | conta até o `target` e mostra a data | "Começa em" / "Termina em" / "Encerrado"; sem `until`, "É hoje!" no dia; dias, horas, minutos e segundos andando a cada segundo |
| Zona `widget` ("Gadget"), com um item na lista | 85222aa | descarta a zona (fica vazia) | aceitar a zona e desenhar o item |
| Itens `agenda`, `reviews`, `dashboard`, `directions` | 85222aa | descarta o item | desenhar (formatos na mensagem da sessão dos templates e em `public/shared/tvcorp-tipos.js`) |
| Item `web` `{ url, refreshMin }` | 85222aa | descarta | WebView ocupando a zona, recarregando a cada `refreshMin` |
| `weather` com `city`, `uf`, `tempC`, `min`, `max`, `text`, `days[]`, `source` | 85222aa | desenha o clima do `/config` | usar os dados do item e a previsão de vários dias |
| `clock` com `face` (`digital`/`analog`), `tz`, `label`, `seconds`, `date` | 85222aa | relógio digital no fuso do modo | ponteiros, fuso e rótulo próprios, segundos, data |
| Conjuntos de várias TVs (menu board): zona `text` com `title` e zona `widget` | cd29340 | o `text` funciona; o `widget` fica vazio | resolvido junto com a zona `widget` |
| `ticker.style` (cor, fundo, negrito, itálico, tamanho em % da faixa, fonte, separador, etiqueta) e `ticker.rich` (cor, negrito e itálico por aviso) | main, `public/shared/faixa.js` | usa só `ticker.items` (texto) | aplicar o estilo e o texto rico na faixa |
| Zona com `overlay: true` e `opacity` (0 a 100): por cima das outras (widget sobre imagem ou vídeo; o vídeo nunca é overlay); as de cima vêm por último | 0e78276 | já desenha as zonas na ordem recebida (a última fica por cima), mas com o fundo opaco do tema: cobre o que está embaixo | fundo `rgba(2,6,23, opacity/100)` e texto claro na zona overlay |
| `signage.wall` `{ id, name, mode, cols, rows, pos, col, row, orientation, bezel, sync, epoch }` (contas em `public/shared/tvcorp-wall.js`; formato em `contrato-signage-wall.md` na pasta de notas) | 49c14ee, 2d5c686 | ignora. No `menu`, cada TV toca a sua grade, mas sem sincronia. No `wall`, cada TV desenha o layout **inteiro** na tela dela (repetido, sem recorte) | `menu` + `sync`: índice e offset de cada playlist por `syncPosition` com a hora confiável, recalculado no fim de cada item. `wall`: quadro de `scaleX%` × `scaleY%` deslocado por `offsetX%`/`offsetY%` (`wallWindow`), recortado |
| Comando `identify` | 2d5c686 | responde `ok: false` "Comando desconhecido nesta versão do app" | por 10 s, por cima de tudo: o nome da TV, o número grande da posição (`wall.pos`) e o nome do conjunto; responder `ok` |
| Item `video` `{ seconds, url, sha256, bytes, width, height, sound, fit: 'contain' }` (MP4 H.264 + AAC até 1080p) | main 36273af | descarta o item | baixar e conferir como as imagens, tocar inteiro com o Media3 na zona (mudo com `sound: false`), pular sem arquivo |
| `transition` (`fade`, `slide`, `zoom`) e `kenburns: true` em qualquer item | main 36273af | troca seca, imagem parada | as transições e o zoom lento |
| Zona `qr` com `WIFI:…` ou vCard | main 36273af | só aceita `https://` (outro texto = cai no QR do `side` ou nada) | codificar o texto como veio (só nas zonas `qr`, com teto de tamanho) |
| `safety` com `record: null` ("Dias desde") | main 36273af | **já funciona**: sem recorde, a linha não aparece | — |
| Manchetes já dentro de `ticker.items`/`ticker.rich` | main 36273af | **já funciona** pelo texto de `ticker.items`; o estilo fica com o item `ticker.style` acima | — |
| `layout.audio` `{ kind: 'radio', id, name, url, codec, bitrate, volume }` (rádio de fundo em layout sem zona de vídeo; MP3/AAC/HLS, muitas vezes `http://`) | main f5f91c1 | ignora: o bloco sem vídeo fica mudo | tocar em segundo plano enquanto o bloco estiver no ar, no volume da tela × `volume`/100, respeitando o mudo; parar ou trocar quando o bloco muda; reconectar se cair. O `network_security.xml` já libera http (quem decide é o código): liberar `http` só para esse player em `core/Urls` |
| `image` nos modelos `oferta`, `precos`, `combo` | fe133de | não desenha a imagem | pôr a imagem ao lado ou embaixo |

Enquanto o `signage.wall` não está no app, o painel não salva um videowall com TV box Android e avisa que o cardápio
dessas TVs troca sem sincronia (32b4a65). Ao implementar, **tirar `'android'` de `WALL_UNSUPPORTED`** em
`public/shared/tvcorp-wall.js`. A resposta "Comando desconhecido…" ao `identify` aparece no painel como "Não suportado
por esta versão do app".

Já feito: a arte de fundo (`artFile`), a paleta e os modelos do comércio (fe133de, `docs/CONTRATO-APP-SLIDES.md`).
