# DIGITAL ISP: funcionalidades e diferenciais

Versão 1, 22/11/2026. Sistema de digital signage **independente do NEXA Broadcast**. A única ligação é opcional: tocar
numa tela o fluxo HLS de um canal do NEXA Broadcast, ou de qualquer outro.

Referências comparadas: OptiSigns (optisigns.com) e Pix Mídia (pixmidia.com.br).

---

## 1. Revenda em três níveis (nasce para ser revendido)

| Nível | Quem é | O que faz |
|---|---|---|
| **Plataforma** | DIGITAL ISP (você) | Cria os planos das revendas, acompanha todas as telas, cobra a revenda |
| **Revenda** | Seu cliente (provedor de internet, agência, integrador) | Tem o gestor de telas, cadastra os clientes dele, cria os planos dos clientes dele |
| **Cliente final** | Loja, clínica, indústria, escritório | Sobe campanhas, mensagens e programação nas telas dele, pelos links de controle |

- **Plano da revenda:** número de telas (o principal), número de clientes, armazenamento, módulos liberados (templates,
  ao vivo HLS, senhas, relatório para anunciante, API) e marca própria.
- **Plano do cliente final**, criado pela revenda dentro do que ela tem: telas, links de controle, armazenamento e módulos.
  A revenda nunca passa do total do plano dela, e o sistema mostra quanto ainda pode vender.
- **Agrupamento:** um cliente tem uma ou mais telas, que podem formar grupos (por loja, por andar, por cidade). Cada
  tela ou grupo é independente para aquele cliente.
- **Links de controle:** cada cliente tem um ou mais links, cada um com o seu alcance (todas as telas, um grupo, uma
  tela) e a sua permissão (subir conteúdo, só mensagens, aprovar). O link pode ser trocado ou desligado a qualquer hora.
- **Marca da revenda (white-label):** logo, cores, nome e domínio próprio no painel e nos links; a tela de abertura
  da TV com a marca dela.
- **Usuários e papéis** em cada nível: dono, gestor, operador, aprovador, só leitura. Registro de quem fez o quê.

## 2. Telas e mapa

- **Mapa** com todas as telas, para você e para a revenda. Para o cliente final, só as telas dele.
- **Estado de cada tela:** no ar, sem imagem, fora do ar (com "desde quando"), desligada pelo horário, conteúdo
  desatualizado, baixando conteúdo, sem espaço.
- **Gestão remota:** captura da tela, o que está passando agora, recarregar, reiniciar o app ou o aparelho, volume, horário de
  ligar e desligar, girar (TV em pé), margem da tela, trocar o layout, apagar o conteúdo guardado.
- **Aviso quando uma tela cai,** por e-mail ou WhatsApp, para a revenda e, se ela quiser, para o cliente final.
- **Cadastro da tela por código** de uso único, que aparece na TV, sem digitar senha no controle remoto.
- Relatório de disponibilidade (horas no ar por tela, por cliente, por revenda).

## 3. Conteúdo

- **Arquivos:** imagens, vídeos, PDF e apresentação (cada página vira um slide), com ajuste automático para a tela.
- **5.000 templates** em português, por segmento (ver o item 4), editáveis no navegador: textos, fotos, preços e cores.
- **Ao vivo:** fluxo HLS de um canal do NEXA Broadcast ou de qualquer endereço (IPTV do provedor, câmera, canal parceiro).
- **Página da internet e painéis** (Power BI, Looker Studio, Grafana ou qualquer endereço público).
- **Dados automáticos:** notícias das agências públicas (com crédito), clima, cotações, RSS da empresa, planilha
  publicada (preços, metas, cardápio) e indicadores.
- **Blocos:** relógio, contagem regressiva, dias sem acidente, QR code, texto rolante, aniversariantes e cardápio da semana.
- **Mensagens rápidas** do cliente final: um aviso escrito no link entra em segundos nas telas dele.
- **Alerta em tela cheia** (evacuação, falta de energia), pela revenda ou pelo cliente, por tela, grupo ou raio no mapa.

## 4. Templates (5.000) e layouts (dezenas)

**Templates.** A meta é 5.000, divididos por segmento:

- **Varejo:** supermercado, padaria, açougue, farmácia, moda, calçados, ótica, eletro, material de construção, pet shop.
- **Alimentação:** restaurante, lanchonete, pizzaria, cafeteria, bar, sorveteria, delivery.
- **Saúde:** clínica, consultório, laboratório, odontologia, hospital, veterinária, academia.
- **Serviços:** salão, barbearia, oficina, lava-rápido, imobiliária, escola, curso, banco, cartório.
- **Indústria e escritório:** segurança do trabalho, metas, comunicação interna, RH, recepção.
- **Outros:** hotelaria, igreja, condomínio, eventos, órgão público.
- **Provedores de internet:** a vitrine do próprio ISP.

Cada segmento tem as peças de que precisa: oferta, preço, combo, cardápio, boas-vindas, horário, promoção da semana,
datas comemorativas, avisos, institucional, QR code e redes sociais. Cada peça sai em paisagem e em retrato, com
variações de cor e de arte. Os templates são gerados por família e conferidos por amostragem. As fotos são próprias
(geradas) ou não há foto; nada de imagem de terceiros.

**Layouts.** Cerca de 40 prontos, mais o editor de zonas:

- tela cheia;
- 2, 3 e 4 zonas;
- em L;
- vídeo + lateral;
- vídeo + faixa;
- cardápio em colunas;
- vitrine de preços;
- totem em pé;
- recepção com senha;
- mural de avisos;
- videowall de 2×2 e de 3×3 (fase 2).

## 5. Programação e campanhas

- **Playlists:** tempo de cada item, ordem por arrastar, item só em certos dias e horários.
- **Grade:** por tela, grupo ou cliente, com prioridade, por dia, faixa de horário e período. Há conteúdo de
  reserva para quando não houver nada programado.
- **Campanhas:** início e fim, alcance (telas e grupos) e meta de exibições. Saem do ar sozinhas no vencimento.
- **Aprovação:** o que o cliente final sobe pode esperar a revenda aprovar. Liga e desliga por cliente.
- **Prévia** de como aparece em cada tela, antes de publicar.

## 6. Funcionamento sem internet

- A tela **baixa tudo o que vai passar** (arquivos e grade de vários dias), confere cada arquivo pela impressão digital
  (hash) e só troca para a programação nova quando tudo chegou inteiro.
- **Roda totalmente sem internet** com o que já tem, inclusive mudando de programação no horário certo, com o relógio
  confiável guardado.
- Ao voltar a internet, **baixa só o que mudou**, manda as capturas e a comprovação de exibição que guardou e limpa o que saiu
  da programação.
- Avisa o painel quando falta espaço no aparelho.

## 7. Aplicativos das telas

- **Android (TV box):** a base é o app que já existe no NEXA Telas.
  - abre sozinho quando a TV box liga;
  - trava em modo quiosque;
  - tem vigia que reinicia o vídeo travado;
  - atualiza sozinho;
  - mostra uma imagem quando fica sem internet;
  - sai na versão final, rápida (a lição da 1.3.1).
- **Samsung (Tizen) e LG (webOS):** apps próprios, com o mesmo contrato do Android. Ficam fora da loja, instalados pelo modo
  desenvolvedor da TV.
- **Instalador pelo celular:** app Android que acha a TV ou a TV box na mesma rede e instala o app nela.
  - TV box Android: pela depuração de rede.
  - Samsung e LG: pelo modo desenvolvedor de cada marca.
  - Limitação a confirmar no teste: o modo desenvolvedor da LG expira e precisa ser renovado; a Samsung exige
    o certificado de desenvolvedor no pacote.
- **Navegador:** qualquer computador ou TV com navegador pode ser uma tela, pelo endereço da tela (para teste e
  monitor de PC).

## 8. Relatórios

- **Comprovação de exibição:** o que passou, em qual tela, quantas vezes e por quanto tempo, contado pela própria tela, mesmo sem
  internet.
- **Relatório para anunciante:** a revenda vende espaço nas telas e manda ao anunciante o relatório com a marca dela (em PDF).
- Horas no ar, telas fora do ar, uso do armazenamento e uso do plano (telas vendidas e livres).

## 9. Segurança e LGPD

- Senha com verificação em duas etapas para a plataforma e as revendas; links de controle com alcance e validade.
- Registro de auditoria; dados de cada cliente separados; fotos de pessoas só com autorização marcada.
- Arquivos guardados no R2, com cópia e sem dados escondidos das fotos (eles são retirados no envio).

## 10. Integração

- **API** por cliente: publicar mensagens, campanhas, preços e indicadores pelo sistema da empresa.
- **Avisos automáticos (webhooks)** para tela caiu, voltou, campanha começou e campanha terminou.
- **NEXA Broadcast:** escolher um canal na lista e ligá-lo numa zona de vídeo (ligação opcional).

## 11. Site www.digitalisp.com.br

Simples e objetivo:

- o que é;
- para quem é (revendas e segmentos);
- como funciona (3 passos);
- funcionalidades;
- aplicativos das telas;
- seja uma revenda;
- contato.

Sem preços, até você definir.

---

## Comparação

**Legenda:** ✔ tem · ✖ não tem ou não aparece nas páginas lidas · ◐ parcial · F2 = fase 2.

| Funcionalidade | OptiSigns | Pix Mídia | DIGITAL ISP |
|---|---|---|---|
| Revenda com planos por número de telas | ✖ | ✖ | ✔ |
| Revenda cadastra os clientes dela (3 níveis) | ✖ | ✖ | ✔ |
| Marca da revenda (white-label) | ◐ marca do cliente | ◐ só o app | ✔ painel, links e tela |
| Links de controle por cliente, sem login | ✖ | ✖ | ✔ |
| Mapa das telas com estado | ✖ | ✖ | ✔ |
| Gestão remota (captura, reiniciar, horário) | ✔ | ✔ | ✔ |
| Funciona sem internet | ✔ | ✔ | ✔ com troca de grade sem rede |
| Templates | 1.000+ (inglês) | 400+ | **5.000 em português, por segmento** |
| Layouts e zonas | ✔ | ✔ | ✔ cerca de 40 + editor |
| Ao vivo HLS (canal de TV real) | ◐ | ◐ palestras | ✔ NEXA Broadcast e qualquer HLS |
| TV box Android em modo quiosque | ◐ | ✔ só o player deles | ✔ qualquer TV box |
| Samsung e LG | ◐ | ✖ | ✔ |
| Instalador pelo celular | ✖ | ✖ | ✔ |
| Hardware próprio obrigatório | não | sim (Pix Player) | não |
| Comprovação de exibição | ✔ | ✔ | ✔ |
| Relatório para anunciante (mídia indoor) | ◐ | ✖ | ✔ |
| Senhas e fila com chamada falada | ✖ | ✖ | ✔ opcional (já existe no NEXA) |
| Aviso de tela caída (WhatsApp) | ✖ | ✖ | ✔ |
| Alerta de emergência em tela cheia | ✔ | ✔ | ✔ |
| Notícias, clima, cotações | ✔ | ✔ | ✔ |
| Power BI e páginas | ✔ | ✔ | ✔ (páginas públicas) |
| Redes sociais na tela (Instagram etc.) | ✔ | ✔ | F2 |
| Videowall | ✔ (pago à parte) | ✖ | F2 |
| Tela de toque / quiosque interativo | ✔ | ✖ | F2 |
| Público medido por câmera/IA | ✔ | ✖ | fora |
| Login corporativo (SSO, Azure AD) | ✔ | ✔ | F2 |
| App do colaborador, intranet, newsletter | ✖ | ✔ | fora (não é signage) |
| Música ambiente | ✔ | ✖ | fora (licença ECAD) |
| Preço em real, por tela | ✖ (dólar) | sob consulta | ✔ |

## Nossos diferenciais

1. **Feito para revender.** Três níveis, plano por número de telas, a revenda monta os planos dos clientes dela e vende com a
   marca dela. Nenhum dos dois descreve isso.
2. **Feito para provedores de internet.** O provedor vende a tela como serviço aos assinantes empresariais, junto com o link,
   e acompanha tudo no mapa.
3. **Mapa de telas com o estado de cada uma,** para a revenda e para o cliente final.
4. **Ao vivo de verdade:** qualquer fluxo HLS e os canais do NEXA Broadcast numa zona da tela.
5. **5.000 templates em português,** por segmento do comércio brasileiro.
6. **Qualquer tela:** TV box Android comum, Samsung, LG e navegador, com instalador pelo celular e sem hardware
   obrigatório.
7. **Sem internet de verdade:** muda de programação no horário mesmo desconectada e guarda a comprovação para mandar depois.
8. **Mídia indoor pronta:** a revenda vende espaço e entrega o relatório ao anunciante.
9. **Senhas e chamada falada** para clínicas e atendimento (já prontas no NEXA Telas).

## Ordem sugerida de construção

1. Base do sistema: revenda em três níveis, planos, usuários, links de controle e mapa. Separada do NEXA Broadcast,
   a partir do módulo TV Corporativa (commit c51d2469).
2. Conteúdo, layouts, programação, sem internet e app Android (derivado do NEXA Telas, com novo nome de pacote).
3. Templates em lotes por segmento, até os 5.000.
4. Site www.digitalisp.com.br.
5. Apps Samsung e LG e instalador pelo celular.
6. Relatório para anunciante, avisos por WhatsApp, API e webhooks.
7. Fase 2: redes sociais, videowall, toque, SSO.
