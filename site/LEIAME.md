# Site institucional DIGITAL ISP (www.digitalisp.com.br)

Página única, HTML e CSS estáticos, sem framework e sem nada carregado de fora (sem CDN, sem Google Fonts).
Cerca de 115 KB no total. Abre direto do disco: dê dois cliques em `index.html`.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | A página, com todas as seções e um pequeno script do formulário de contato |
| `estilo.css` | O visual (cores da marca, responsivo) |
| `img/` | Logos do kit (`marca/svg`), a imagem de compartilhamento `og-digitalisp.png` (1200×630, gerada do kit) e o guia de compatibilidade `compatibilidade*.webp` (arte enviada pelo dono, em 2000 e 1000 px) |
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

## Contato (WhatsApp)

O contato é só pelo WhatsApp **(21) 99908-9151**, pelo link `https://wa.me/5521999089151` com o texto pronto
"Olá! Quero saber mais sobre o DIGITAL ISP". Ele aparece:

- no botão "Contato" do topo, no botão da seção Contato e no rodapé (todos abrem em nova aba);
- no botão verde flutuante, no canto de baixo da tela;
- no formulário: "Enviar pelo WhatsApp" abre o WhatsApp com os dados preenchidos já escritos na mensagem.
  Nada é enviado a servidor nenhum.

Para trocar o número: substitua `5521999089151` (5 lugares, incluindo a variável `WHATSAPP` do script) e o texto
`(21) 99908-9151` (3 lugares, um deles no rótulo de acessibilidade do botão flutuante) em `index.html`.

## O que falta do dono

1. **E-mail e telefone fixo**: ainda não foram passados, então o site mostra só o WhatsApp. Quando houver,
   dá para acrescentar na seção Contato e no rodapé.
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
