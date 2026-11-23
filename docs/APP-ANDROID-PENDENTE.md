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
| `image` nos modelos `oferta`, `precos`, `combo` | fe133de | não desenha a imagem | pôr a imagem ao lado ou embaixo |

Já feito: a arte de fundo (`artFile`), a paleta e os modelos do comércio (fe133de, `docs/CONTRATO-APP-SLIDES.md`).
