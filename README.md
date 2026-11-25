# DIGITAL ISP

Digital signage feito para ser revendido: plataforma → revendas → clientes finais → telas. Domínio: www.digitalisp.com.br.

Projeto **independente do NEXA Broadcast**. A única ligação prevista é opcional: tocar numa zona da tela o fluxo HLS de
um canal do NEXA Broadcast (ou de qualquer outro endereço HLS).

## Pastas

| Pasta | O que tem |
|---|---|
| `docs/FUNCIONALIDADES.md` | O que o sistema vai ter, a comparação com OptiSigns e Pix Mídia e os diferenciais |
| `marca/` | Kit da marca (SVG, PNG, ícones, favicon). Cores: azul-marinho #0A2150, azul #0D80FF, ciano #14C4CC |
| `server/`, `public/`, `test/` | Ponto de partida copiado do NEXA Broadcast (TV Corporativa e telas), a adaptar |
| `android/` | App da TV box, copiado do NEXA Telas 1.3.1, a renomear (pacote e marca) |
| `docs/origem-nexa/` | Documentação de origem e a lista exata dos arquivos copiados |

Antes de mexer, leia `PASSAGEM.md`.

## Rodar no computador

```
npm install
npm run dev
```

Abre em http://localhost:3000/admin/ com SQLite e arquivos locais em `./data`. Para produção, veja `.env.exemplo`.
Testes: `npm test` (unidade) e `npm run test:servidor` (sobe o servidor; em adaptação, veja `PASSAGEM.md`).
