---
titulo: Polícia Civil e Polícia Militar: emissores conveniados
resumo: Dê à Polícia Civil e à Polícia Militar um acesso restrito, por convênio: elas enviam alertas, desaparecidos e pedidos de informação, e a prefeitura aprova antes de ir às telas.
caminho: NEXA Telas → Prefeitura → Repartições → Usuários
tela: prefeitura/reparticoes, prefeitura/aprovacoes
tempo: 20 minutos
nivel: avançado
palavras: polícia civil, polícia militar, emissor conveniado, convênio, órgão estadual, aprovação, CCO, emitir direto, cartela policial, pedido de informação, procurado, mandado, disque denúncia, chave de integração, API, webhook, área a evitar, bloqueio de via
---

## Objetivo

Neste artigo você dá à **Polícia Civil** e à **Polícia Militar** um acesso por convênio às telas da prefeitura.

- A **Polícia Militar** envia alertas por área: área a evitar, bloqueio urgente de via.
- A **Polícia Civil** envia desaparecidos e pedidos de informação ao Disque Denúncia.
- A **prefeitura aprova** cada envio antes de ele ir às telas.

É para quem cuida do Painel da Prefeitura e para o responsável de cada órgão.

> Importante: os órgãos conveniados não administram o painel. Eles só emitem o que o convênio permite e veem os próprios envios.

## Antes de começar

- [ ] O convênio assinado com o órgão.
- [ ] A repartição **Segurança e Guarda Municipal (CCO)** cadastrada, para aprovar os envios (veja [Segurança e Guarda Municipal: o painel do CCO](prefeitura-seguranca-cco)). Sem ela, a SECOM e o Painel da Prefeitura aprovam.
- [ ] O nome de quem vai usar o acesso em cada órgão.

## Passo a passo

### 1. Cadastre o órgão

1. Abra **Prefeitura** e clique na aba **Repartições**.
2. Clique em **+ Nova repartição**.
3. Em **Tipo**, escolha **Polícia Civil (emissor conveniado)** ou **Polícia Militar (emissor conveniado)**.
4. Clique em **Salvar**.

### 2. Crie os usuários e entregue o link

1. Na linha do órgão, clique em **Usuários**.
2. Clique em **+ Novo usuário**, com o papel **Gestor**.
3. Clique em **Gerar o link** e mande ao responsável.

### 3. O que o órgão vê

| Órgão | Abas |
|---|---|
| Polícia Civil | **Desaparecidos e cartelas**, **Novo alerta**, **Meus envios** |
| Polícia Militar | **Novo alerta**, **Meus envios** |

A Polícia Militar escolhe entre **Segurança pública** e **Trânsito**. A Polícia Civil, só **Segurança pública**.

### 4. O órgão envia e a prefeitura aprova

1. O órgão preenche o alerta e clica em **Enviar alerta**.
2. O envio aparece em **Meus envios**, como **aguardando**.
3. No CCO, abra a aba **Aprovações** e clique em **Aprovar** ou em **Devolver com motivo**.
4. O órgão vê a decisão e o motivo em **Meus envios**.

> Captura sugerida: a aba Aprovações do CCO com um alerta da Polícia Militar marcado como emissor conveniado e a prévia ao lado.

### 5. Libere a emissão direta, se o convênio previr

1. Em **Repartições → Usuários** do órgão, marque **Pode emitir alertas direto, sem aprovação**.
2. Confirme.

Os alertas e os casos de desaparecido do órgão passam a ir às telas na hora. O pedido de informação e a cartela **Procurado pela Justiça** continuam esperando a aprovação.

### 6. Pedido de informação (Polícia Civil)

1. Na aba **Desaparecidos e cartelas**, em **Quem é**, escolha **Pedido de informação (cartela policial)**.
2. Em **Cabeçalho da cartela**, escolha **A POLÍCIA PEDE INFORMAÇÕES** ou **PROCURADO PELA JUSTIÇA**.
3. Preencha o texto, o **Nº do procedimento** e a **identificação funcional**.
4. Em **Procurado pela Justiça**, preencha o **Nº do mandado de prisão**.
5. Clique em **Enviar para a aprovação do CCO**.

> Importante: o número do procedimento, a matrícula e o mandado ficam só no registro. Eles nunca aparecem nas telas. A cartela "Procurado pela Justiça" mostra sempre "Não aborde. Ligue 190 ou 181." e fica no máximo 15 dias.

### 7. Integração por chave (API)

1. Em **Repartições → Usuários** do órgão, clique em **Gerar a chave de integração**.
2. Clique em **Copiar a chave** e entregue ao responsável técnico do órgão.

Com a chave, o sistema do órgão cria e encerra alertas. A chave aparece só nesse momento. Para trocar, gere outra. Para cortar o acesso, clique em **Revogar a chave**.

> Dica: a chave pede a funcionalidade **Acesso por API** no plano da prefeitura. O exemplo de uso está em docs/TELAS.md, seção 21.

## Resultado

- O órgão conveniado entra pelo link dele e só vê os próprios envios.
- Nada do órgão vai às telas sem a aprovação da prefeitura, a não ser que você libere a emissão direta.
- A auditoria mostra quem enviou, quem aprovou e quando.

## Problemas comuns

**"Esta categoria de aviso não é do seu órgão."** A Polícia Civil emite só Segurança pública. A Polícia Militar, Segurança pública e Trânsito.

**O envio não aparece nas telas.** Ele está aguardando a aprovação. Veja a aba **Aprovações** do CCO.

**A SECOM não vê o pedido do órgão.** Com a Segurança (CCO) cadastrada, quem aprova o pedido de um órgão conveniado é o CCO ou o Painel da Prefeitura.

**"A cartela policial é só da Polícia Civil."** O pedido de informação e a cartela "Procurado pela Justiça" só saem do link da Polícia Civil.

**A chave de integração não é gerada.** O plano da prefeitura não inclui o Acesso por API.

## Próximos passos

- [Segurança e Guarda Municipal: o painel do CCO](prefeitura-seguranca-cco): as ocorrências e a aprovação.
- [Alertas por tipo e pessoas desaparecidas](prefeitura-alertas-e-desaparecidos): a gravidade, o alcance e o QR code.
- [O painel de cada repartição](prefeitura-painel-da-reparticao): usuários e papéis.
