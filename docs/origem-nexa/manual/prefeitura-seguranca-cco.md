---
titulo: Segurança e Guarda Municipal: o painel do CCO
resumo: Cadastre a Segurança (CCO), receba o botão de pânico das escolas e dos postos de saúde, aprove o que os órgãos conveniados enviam e mande alertas de segurança e de trânsito.
caminho: NEXA Telas → Prefeitura → Repartições e Ocorrências
tela: prefeitura/ocorrencias, prefeitura/reparticoes
tempo: 20 minutos
nivel: intermediário
palavras: segurança, guarda municipal, CCO, centro de controle, botão de pânico, pânico, ocorrência, recebido, encerrar, escola, hospital, aprovação, emissor conveniado, trânsito, bloqueio, interdição, desvio, área a evitar, evacuação
---

## Objetivo

Neste artigo você monta o painel da **Segurança e Guarda Municipal (CCO)**, o centro de controle da prefeitura nas telas.

- O CCO **recebe o botão de pânico** das repartições, em silêncio.
- O CCO **aprova** o que a Polícia Civil e a Polícia Militar enviam.
- O CCO **manda alertas** de segurança pública e de trânsito, só para a área que precisa.

É para quem cuida do Painel da Prefeitura e para os operadores do CCO.

> Importante: o botão de pânico é silencioso. Nada aparece nas TVs da repartição nem em tela pública nenhuma.

## Antes de começar

- [ ] A rede de telas montada (veja [Montar a rede de telas da prefeitura](prefeitura-rede-de-telas)).
- [ ] O endereço e o ponto no mapa de cada repartição. O CCO precisa saber onde ir.
- [ ] Um computador no CCO com a página aberta o dia todo.

## Passo a passo

### 1. Cadastre a Segurança

1. Abra **Prefeitura** e clique na aba **Repartições**.
2. Clique em **+ Nova repartição**.
3. Em **Tipo**, escolha **Segurança e Guarda Municipal (CCO)**.
4. Clique em **Salvar**.
5. Na linha da repartição, clique em **Usuários**, crie os operadores com o papel **Gestor** e clique em **Gerar o link**.

**O que acontece:** a partir daí o botão de pânico das repartições tem quem receba.

### 2. Ligue o botão de pânico onde ele faz falta

1. Na aba **Repartições**, clique em **Editar** na repartição.
2. Em **Módulos**, marque **Botão de pânico**.
3. Clique em **Salvar**.

Escola, creche, UPA, hospital, UBS, CAPS e CRAS já nascem com o botão ligado.

### 3. Como a repartição aciona

1. No painel da repartição, a pessoa segura o botão **Pânico**, no alto, por 2 segundos.
2. Ao lado do botão aparece **Enviado às 14:32 · aguardando o CCO**.
3. Quando o CCO marca o recebimento, aparece **recebido pelo CCO às 14:33**.

> Dica: o gestor e o atendente têm o botão. Pelo teclado, use Enter e confirme.

### 4. Receba a ocorrência no CCO

1. No painel do CCO, deixe aberta a aba **Ocorrências**.
2. Clique em **Ligar o som de aviso**. O navegador só toca o som depois desse clique.
3. Quando um botão é acionado, a ocorrência aparece em vermelho, com a repartição, o endereço, quem acionou e a hora.
4. Clique em **Ver no mapa** para achar o prédio.
5. Clique em **Recebido**. Quem acionou vê a hora.
6. Ao terminar, clique em **Encerrar** e escreva o que foi feito.

> Captura sugerida: a aba Ocorrências do CCO com uma ocorrência em vermelho, os botões Recebido e Encerrar e o mapa ao lado.

A aba **Ocorrências** do Painel da Prefeitura mostra a mesma lista.

### 5. Aprove o que os órgãos conveniados enviam

1. Abra a aba **Aprovações**. O número mostra quantos pedidos esperam.
2. Clique em **Ver como fica na tela**.
3. Clique em **Aprovar**, ou em **Devolver com motivo** e escreva o motivo.

Nada da Polícia Civil ou da Polícia Militar vai às telas antes da sua aprovação.

### 6. Mande um alerta de segurança ou de trânsito

1. Abra a aba **Novo alerta**.
2. Em **1. Categoria**, clique em **Segurança pública** ou em **Trânsito**.
3. Em **2. Tipo**, clique no tipo. Por exemplo, **Bloqueio de via**.
4. Ajuste o texto, escolha a gravidade e o alcance no mapa.
5. Clique em **Enviar alerta** e confirme.

> Importante: escreva só a orientação ("Evite a região. Siga as orientações dos agentes."). Não descreva suspeito, arma ou placa.

## Resultado

- O botão de pânico chega ao CCO em segundos, sem aparecer em tela nenhuma.
- Os envios dos órgãos conveniados só vão às telas depois de aprovados.
- Tudo fica na auditoria: quem acionou, quem recebeu e quem encerrou.

## Problemas comuns

**"A prefeitura ainda não tem uma repartição de Segurança."** Cadastre a Segurança (passo 1). Sem ela, o botão avisa que não há quem receba.

**O som não toca.** Clique em **Ligar o som de aviso** na aba Ocorrências. O navegador pede esse clique.

**"O aviso já foi enviado há instantes."** O botão aceita 3 acionamentos por minuto por repartição. O primeiro já chegou.

**A repartição não tem o botão.** Ligue o módulo **Botão de pânico** em **Repartições → Editar**.

**A ocorrência aparece sem ponto no mapa.** A repartição está sem ponto. Marque o ponto em **Repartições → Editar**.

## Próximos passos

- [Polícia Civil e Polícia Militar: emissores conveniados](prefeitura-emissores-conveniados): o acesso restrito e a chave de integração.
- [Alertas por tipo e pessoas desaparecidas](prefeitura-alertas-e-desaparecidos): a gravidade, o alcance e os casos de desaparecido.
- [O painel de cada repartição](prefeitura-painel-da-reparticao): usuários, abas e TV box.
