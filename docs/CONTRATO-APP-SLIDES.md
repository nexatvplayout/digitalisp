# Contrato dos slides com arte: o app da TV box e o servidor

Versão 1 · 22/11/2026. Vale para o item `slide` de `signage.blocks[].zones` do `/config`. Combinado com a sessão dos
templates (branch `claude/relaxed-mcclintock-1c97a6`).

O app Android desenha o slide no próprio aparelho, em código nativo, sem WebView. Por isso ele não lê o CSS da prévia:
precisa do **arquivo** da arte e dos campos abaixo, todos dentro de `fields`. Sem os campos novos, o slide sai como
antes: texto sobre a cor do tema.

## Campos de estilo

| Campo | Formato | O que o app faz |
|---|---|---|
| `art` | a chave da arte (`foto-padaria`, `ondas`…) | só usada para saber se é foto (`foto-*`), quando o `artFile` não diz |
| `artFile` | `{ "url", "sha256", "bytes", "photo"?, "tone"? }` | baixa, confere e guarda como as outras mídias (https, SHA-256 de 64 hex, até 8 MB); desenha o fundo |
| `palette` | uma das 11 chaves de `TVC_PALETTES` | fundo em gradiente e a cor de destaque (tabela copiada de `.th-<chave>` do `tvcorp-previa.css`) |
| `orient` | `land` ou `port` | **ignorado**: o desenho já segue a forma da zona (deitada ou em pé) |

### A arte (`artFile`)

- **Foto** (`photo: true` ou chave `foto-*`): cobre o slide, cortando em volta do ponto 72% × 50% (como o
  `background-position` da prévia). Por cima vai o véu preto em gradiente horizontal, de 82% a 60%, e o texto fica claro.
- **Sem foto**: cobre o slide (centro) sem véu. O texto segue o `tone`: `light` = texto escuro; ausente ou `dark` = claro.
- O Android **não abre SVG**. O servidor manda o `artFile` só para as fotos (`.jpg`). As artes SVG ficam sem arquivo, e o
  app desenha o fundo pela `palette` (ou pela cor do tema). Para mostrar uma arte SVG, o servidor pode mandar um PNG
  rasterizado no `artFile`, sem mudar o app.
- Arquivo ausente, inválido ou que não abre: o slide sai na paleta, como se não houvesse arte.
- A arte entra na lista de arquivos do modo (`files()`) e fica guardada para funcionar sem internet.

### A paleta (`palette`)

- No tema escuro: gradiente de 135° de `--tcb` (0%) para o fundo do tema (70%).
- No tema claro: branco até 55%, depois `--tcl` no canto.
- O destaque (rótulos, barra lateral, perfil das redes) usa `--tc` e vence a cor do modelo e a do tema.
- Chave desconhecida: a cor do tema.

## Modelos do comércio

| Modelo | Campos que o app lê | Como desenha |
|---|---|---|
| `oferta` | `title`, `price`, `oldPrice`, `unit`, `tag`, `text`, `until` (AAAA-MM-DD), `qr` | etiqueta (ou o rótulo "Oferta"), produto e texto; o preço numa placa amarela ("De X por", preço, unidade); "Válido até DD/MM ou enquanto durar o estoque." |
| `combo` | `title`, `text` (uma linha por item), `price`, `oldPrice`, `tag`, `qr` | como a oferta, com os itens em lista |
| `precos` | `title`, `text` ("nome \| preço" por linha), `note` | uma linha por item, o nome à esquerda e o preço à direita, com divisória; a observação embaixo |
| `horario` | `title`, `text` ("dias \| horário" por linha), `note`, `qr` | como a vitrine de preços |
| `redes` | `title`, `handle`, `text`, `site`, `qr` | o perfil grande na cor de destaque, o texto, o site e o QR |

- As linhas "a | b" são separadas pelo **último** `|`, até 8 linhas (igual ao `rowsOf` da prévia).
- No tema claro, a placa do preço vai na cor do fundo da paleta (ou do modelo), com o texto branco.
- O campo `image` desses modelos ainda não é desenhado (a prévia o aceita); fica para depois, se o dono pedir.

## Testes

`android/app/src/test/java/br/com/digitalisp/telas/core/SignageArteTest.kt`: leitura de `artFile` (foto pela chave,
`photo` e `tone`, inválidos), da paleta, dos campos de cada modelo e das linhas "a | b".
