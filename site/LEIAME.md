# Site institucional DIGITAL ISP (www.digitalisp.com.br)

Página única, HTML e CSS estáticos, sem framework e sem nada carregado de fora (sem CDN, sem Google Fonts).
Cerca de 115 KB no total. Abre direto do disco: dê dois cliques em `index.html`.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | A página, com todas as seções e um pequeno script do formulário de contato |
| `estilo.css` | O visual (cores da marca, responsivo) |
| `img/` | Logos do kit (`marca/svg`) e a imagem de compartilhamento `og-digitalisp.png` (1200×630, gerada do kit) |
| `favicon.*`, `apple-touch-icon.png`, `android-chrome-*.png`, `site.webmanifest` | Ícones copiados de `marca/favicon` |

Seções: o que é, para quem é (revendas e segmentos), como funciona (3 passos), funcionalidades, aplicativos das telas,
seja uma revenda e contato. Sem preços e sem citar concorrentes.

## Como publicar

Qualquer hospedagem estática serve: basta subir o **conteúdo** da pasta `site/` (o `index.html` fica na raiz).

**Cloudflare Pages** (recomendado):

1. No painel da Cloudflare: Workers & Pages → Create → Pages.
2. Ou ligue o repositório do GitHub (Build command: vazio; Build output directory: `site`),
   ou escolha "Upload assets" e arraste a pasta `site/`.
3. Em Custom domains, adicione `www.digitalisp.com.br` (e redirecione `digitalisp.com.br` para o `www`).

Pela linha de comando, com o Wrangler já autenticado pelo próprio dono:

```
npx wrangler pages deploy site --project-name digitalisp-site
```

Outras opções que funcionam do mesmo jeito: GitHub Pages, Netlify, ou qualquer servidor que entregue arquivos.

## O que falta do dono

1. **Contato** — procure por `CONTATO_A_DEFINIR` em `index.html` (aparece 3 vezes, uma delas num comentário do script):
   - no texto "E-mail e telefone" da seção Contato;
   - na variável `EMAIL_CONTATO` do script. Enquanto não tiver um e-mail com `@`, o botão Enviar só mostra
     "O canal de contato ainda está sendo definido". Com o e-mail preenchido, o botão abre o programa de e-mail do
     visitante com a mensagem pronta (mailto). Se preferir receber sem depender do programa de e-mail, depois dá para
     trocar por um envio para o servidor do DIGITAL ISP.
   - Definir também se haverá telefone/WhatsApp público.
2. **Revisar as promessas do texto.** O site descreve o que está em `docs/FUNCIONALIDADES.md`; parte ainda não está
   pronta no sistema. Confira se pode anunciar já:
   - aviso quando uma tela cai e venda de espaço para anunciantes (mídia indoor);
   - cobrança pelo sistema com boleto e Pix;
   - templates por segmento (o número "5.000" ficou de fora de propósito; dá para incluir quando estiver perto);
   - Samsung, LG e o instalador pelo celular já estão marcados como **em breve**.
3. **Domínio**: apontar `www.digitalisp.com.br` para a hospedagem. As meta tags (canonical, Open Graph) já usam
   `https://www.digitalisp.com.br/`; se o endereço final for outro, troque em `index.html`.
4. Opcional: política de privacidade (LGPD) quando o formulário passar a enviar dados para o servidor.

## Cuidados ao mexer

- O nome é sempre **DIGITAL ISP**.
- Nada de preços até o dono definir; nada de concorrentes.
- Imagens só do kit `marca/` ou desenhadas em CSS/SVG; nada de imagem de terceiros.
