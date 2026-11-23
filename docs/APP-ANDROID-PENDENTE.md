# App Android: o que já lê do contrato e o que ainda falta

Situação em 23/11/2026, versão **0.3.0** (versionCode 3). Referência de desenho: `public/shared/tvcorp-previa.js` e
`.css` do main (o app da Samsung desenha igual). Todos os campos são opcionais: sem eles, a tela fica como antes.

> **Testado só nos testes da JVM e na compilação do release.** Não havia emulador nem TV box nesta máquina: o desenho
> (posições, tamanhos, cores) ainda precisa ser conferido numa tela de verdade.

## Feito na 0.3.0

| O quê | Como o app faz |
|---|---|
| Notícia sozinha (`news` com `single`, `image`) | a foto em tela cheia (cover) e, embaixo, a faixa escura com o nome da fonte, a manchete (até 3 linhas) e fonte · hora, com o filete vermelho à esquerda; `seconds` de cada notícia |
| Clima com foto (`config.weather.art`/`artPort`, e o item `weather` com os mesmos campos) | a foto da forma da zona (em pé: `artPort`), em cover, véu de 35%, ícone e temperatura grandes; os próximos dias quando vêm. As fotos baixam com os arquivos do modo. O último clima bom fica guardado por até 6 h |
| Slide em pé (`fields.orient: 'port'`) | tudo em coluna, mesmo numa caixa larga |
| Imagem `fit: 'contain'` | inteira, com a mesma foto desfocada e escurecida atrás |
| `zone.shape` e `zone.edge` | recorte (core/Shapes.kt, a mesma conta de `tvcorp-formas.js`) com `clipPath` e o filete por cima; a zona de vídeo com formato passa a usar TextureView |
| `zone.overlay` e `opacity` | fundo `rgba(2,6,23, opacity)` e texto claro; as zonas na ordem em que chegam |
| Zona `widget` | o item da lista desenhado na zona |
| Item `video` | baixado e conferido (até 400 MB), tocado inteiro num ExoPlayer da zona (TextureView, contain), mudo sem `sound`; no fim ou no erro, o próximo |
| `transition` e `kenburns` | fade, slide (entra pela direita) ou zoom; o zoom lento na imagem durante o tempo do item |
| `layout.audio` (rádio de fundo) | ExoPlayer separado, http ou https, MP3/AAC/HLS; volume da tela × `volume`/100, respeita o mudo; para ou troca com o bloco; reconecta se cair |
| `ticker.style` e `ticker.rich` | cor, fundo, negrito, itálico, tamanho, fonte, separador e etiqueta; cada aviso com a cor e o estilo dele |
| QR de Wi-Fi e vCard | o texto codificado como veio (até 1000 caracteres), nas zonas e nos itens `qr`, slides, avaliações e "como chegar" |
| `qrSize`, `priceSize`, `photoSize`, `titleSize` | as escalas 0,7 / 1,4 / 1,8 no QR, na placa do preço, na foto e no título do slide |
| `countdown.until` | "Começa em", "Termina em", "Encerrado" ou "É hoje!", com dias, horas, minutos e segundos andando |
| `safety` com `record: null` | sem a linha do recorde |
| Itens `agenda`, `reviews`, `dashboard`, `directions`, `web` | desenhados no aparelho; o `web` numa WebView ocupando a zona, recarregada a cada `refreshMin` |
| `clock` com `face`, `tz`, `label`, `seconds`, `date` | digital ou de ponteiros, no fuso do gadget |
| `signage.wall` | `menu` com `sync`: o item de cada playlist pela conta `syncPosition` com a hora confiável; `wall`: o quadro do conjunto com a janela desta TV (`wallWindow`) |
| Comando `identify` | por 10 s, por cima de tudo: o número grande da posição, o nome da tela e o do conjunto; responde ok |

**Para o painel:** com a 0.3.0 instalada nas TV box, dá para tirar `'android'` de `WALL_UNSUPPORTED` em
`public/shared/tvcorp-wall.js` (o painel hoje não deixa pôr TV Android num videowall).

## Falta

| O quê | Situação |
|---|---|
| `image` nos modelos `oferta`, `precos`, `combo` | a imagem ainda não é desenhada nesses três modelos |
| Vídeo próprio começando no `offset` da troca sincronizada | começa do início e respeita o tempo que falta |
| Conferir tudo numa TV box (ou emulador) | ver a observação no começo |
