# Passagem: como continuar o DIGITAL ISP

Criado em 22/11/2026 pela sessão coordenadora do NEXA Broadcast. Daqui para frente, este projeto tem **sessão própria**.
Não mexa no repositório do NEXA Broadcast (`C:\Projetos\nexatvplayout`), e o NEXA Broadcast não mexe aqui.

## De onde veio o código

- Copiado do NEXA Broadcast no commit **c51d2469** (main, 22/11/2026), **sem o histórico** e sem vínculo de git.
- O que foi copiado, arquivo por arquivo: `docs/origem-nexa/arquivos-copiados.txt`.
  - Servidor: as telas (`server/telas*.js`), a TV Corporativa (`server/tvcorp*.js`), os esquemas do banco, e a base de
    que eles dependem (login e permissões `authcore.js`, clientes `tenancy.js`, banco `db.js`, armazenamento R2
    `storage.js`, funcionalidades por plano, limite de pedidos, fuso).
  - Painel: as abas da TV Corporativa (`public/admin/views/tvcorp*.js`), as páginas da repartição, do celular
    (`public/tvc/`) e as artes.
  - App: o NEXA Telas 1.3.1 inteiro (`android/`), com as vozes da chamada.
  - Testes: `test/telas*` e `test/tvcorp*`.
- **Não roda ainda.** Falta o `server/index.js` próprio, e o painel ainda depende da casca do NEXA Broadcast
  (`public/admin/index.html` e `main.js`, que não vieram).

## Decisões do dono (22/11/2026)

1. **Totalmente independente** do NEXA Broadcast. A ligação opcional é tocar o HLS de um canal do NEXA Broadcast numa zona.
2. **Nasce para ser revendido.** Os planos são definidos principalmente pelo **número de telas**. Os níveis:
   - plataforma;
   - revenda: o gestor de telas, que cadastra os clientes dele e cria os planos desses clientes;
   - cliente final: uma ou mais telas, em grupos.
3. **Links de controle** por cliente final, um ou mais, para subir campanhas e mensagens. Cada tela ou grupo é
   independente por cliente final.
4. **5.000 templates** por tipo de comércio, empresa e indústria; **dezenas de layouts**.
5. **Offline total:** a tela baixa o conteúdo e roda sem internet; atualiza quando volta.
6. **Mapa** de todas as telas com o estado (no ar, fora, etc.) e gestão remota, para a revenda e para o cliente dela.
7. **App Android** com as mesmas características do NEXA Telas (abre sozinho ao ligar, quiosque, vigia, atualização
   automática). Depois: **apps Samsung e LG** e um **instalador pelo celular** (instala na TV por fora da loja).
8. **Site** simples e objetivo em www.digitalisp.com.br, sem preços até o dono definir.
9. GitHub: o dono já criou o repositório. **Falta o endereço** para ligar o remoto (`git remote add origin ...`).
10. **Nomes (definição do dono):**
    - **revenda** = o cliente do DIGITAL ISP: o provedor, sempre pessoa jurídica, que tem clientes;
    - **cliente final** = o cliente da revenda, pessoa física ou jurídica.
11. **Cobrança: as duas formas.** Dentro do sistema (boleto e Pix) e por fora. A revenda escolhe, para ela e para cada
    cliente final dela, se cobra pelo sistema ou registra só o plano e cobra por conta própria.
12. **App da TV box white-label:** na tela não aparece nada do app nem do DIGITAL ISP, só o conteúdo do cliente.
    - Abertura, tela de cadastro e imagem sem internet com a **logo da revenda**, que é a que chega ao cliente final.
    - O nome do app no aparelho é neutro (por exemplo "Telas").
    - Um APK só para todas as revendas: a marca vem do servidor no cadastro da tela.

## Primeiros passos

1. Ligar o remoto do GitHub e subir o `main`.
2. Fazer o sistema subir sozinho:
   - `server/index.js` próprio;
   - casca do painel com a marca DIGITAL ISP;
   - tirar o que é só do NEXA Broadcast: provedor Railway, motor do canal, prefeitura (desaparecidos, segurança, IBGE).
3. Revenda em três níveis, com planos por telas, links de controle e mapa.
4. App Android com outro pacote (por exemplo `br.com.digitalisp.telas`), nome e ícone da marca, e o próprio endereço de
   atualização. Publicar **sempre o build de release** (`assembleRelease`): o de depuração é lento na TV box.
5. Seguir a ordem de `docs/FUNCIONALIDADES.md`.

## Andamento (22/11/2026)

**Passo 2 feito, menos a prefeitura.** O sistema sobe sozinho: `npm install` e `npm start` (ou `npm run dev`). Abre em
`http://localhost:3000/admin/`. As variáveis estão em `.env.exemplo`.

- A cópia veio incompleta. Faltavam 47 arquivos de que o servidor precisava, trazidos do mesmo commit c51d2469 (lista em
  `docs/origem-nexa/arquivos-complemento.txt`). O `index.js` e a casca do painel do NEXA ficam só como referência em
  `docs/origem-nexa/referencia/`.
- Servidor novo e enxuto: `server/index.js`, a plataforma em `server/plataforma.js` (login da equipe, revendas, planos,
  perfis de funcionalidades) e a configuração em `server/config.js`, com cerca de 100 linhas.
- Banco novo: `server/db/schema.js` tem só as tabelas de acesso, revendas, planos, auditoria e domínios, mais as das telas
  e da TV Corporativa. Ficaram de fora mais de 200 tabelas de canal. Não há migração de versões antigas.
  `server/db/schema-digital.js` está vazio, à espera das tabelas do passo 3.
- Saíram o Railway (provedores de domínio), o motor do canal, o gerador de caracteres, o chat, a censura e o som 5.1.
  `server/domains.js` só diz qual revenda atende um endereço.
- Painel: `public/admin/index.html`, `main.js` e `digitalisp.css`, com a marca. Tem a entrada como revenda ou plataforma.
  A revenda vê "Telas e conteúdo" (as abas da TV Corporativa). A plataforma vê as revendas e cadastra revendas novas.
- Testes: `npm test` roda os 98 testes de unidade, todos passando. `npm run test:servidor` roda os que sobem o servidor;
  esses ainda criam canais do NEXA (`POST /api/channels`) e falham até o passo 3. Quatro testes que conferiam o painel e
  o banco do NEXA saíram, e o teste de migração da 0.5.188 também. Em cada lugar ficou um comentário dizendo isso.

**Ainda não feito (vai junto com o passo 3):** tirar a prefeitura de `server/telas.js`. Desaparecidos
(`telas-desaparecidos.js`), botão de pânico (`telas-seguranca.js`), município e malha do IBGE (`telas-malha.js`), tipos de
repartição (Polícia, Defesa Civil), aprovação da SECOM, modo eleitoral e EAS estão entrelaçados no módulo das telas.
O passo 3 troca "repartição" por "cliente final", e esse corte se faz no mesmo movimento, com os testes de servidor
reescritos para o modelo revenda → cliente final.

**Sessões paralelas abertas (22/11/2026), cada uma no seu branch:** site (`site/`), app Android white-label (`android/`,
que escreve `docs/CONTRATO-APP-MARCA.md`, o contrato que o servidor vai seguir), apps Samsung/LG (`apps-tv/`) e
instalador pelo celular (`apps-celular/instalador/`).

## Regras herdadas que continuam valendo

- Nunca digitar senhas do dono; segredos ficam em arquivos locais, nunca no chat nem no repositório.
- Banco de produção: só mudanças aditivas.
- Nada de concorrentes no site.
- O nome é sempre **DIGITAL ISP**.
- Testes de navegador sem som.
- Uma bateria de testes pesada por vez.
- Nunca usar `git stash`.
- O JDK e o SDK Android ficam em `C:\Projetos\nexa-ferramentas` (`jdk-21.0.13+9`, `android-sdk`).
