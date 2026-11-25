---
titulo: Chamada de senha, cartões e vídeos guardados nas telas
resumo: Ligue a chamada de senha de uma repartição (filas, totem, guichê e a senha na tela em tempo real), monte os cartões de informação, guarde vídeos para quando a internet cair e use a aprovação da SECOM e o modo eleitoral.
caminho: NEXA Telas → Prefeitura → Senhas, Cartões, Sem internet e Aprovações
tela: prefeitura/senhas, prefeitura/cartoes, prefeitura/videos, prefeitura/aprovacoes
tempo: 30 minutos
nivel: intermediário
palavras: senha, chamada de senha, fila, filas, guichê, consultório, totem, prioritário, prioridade, idoso, 80 anos, gestante, classificação de risco, triagem, UPA, hospital, UBS, cartão, cartões, merenda, cardápio, escala, plantão, vagas, SINE, agenda, pauta, clima, vídeos guardados, sem internet, offline, imagem sem internet, tela preta, imagem de reserva, aprovação, SECOM, modo eleitoral, período eleitoral, institucional, utilidade pública, tela desligada, disponibilidade, relatório, CSV, alerta de emergência
---

## Objetivo

Neste artigo você liga o que as telas da prefeitura mostram além do canal e dos avisos:

- a **chamada de senha** de uma repartição, com filas, totem de retirada, a página do guichê e a senha na tela em menos de 2 segundos;
- os **cartões de informação**: merenda, escala do dia, vagas, agenda, pauta e avisos da unidade;
- o **clima** da cidade na lateral da tela;
- os **vídeos guardados** e a **imagem sem internet**, que a TV box mostra quando a internet cai;
- a **aprovação da SECOM** e o **modo eleitoral**.

É para quem cuida do Painel da Prefeitura e para o responsável de cada repartição. Leva uns 30 minutos para a primeira repartição.

> Importante: na tela, a pessoa aparece só pelo **primeiro nome e a inicial do sobrenome** (Maria S.), e só se a repartição ligar essa opção. O motivo do atendimento nunca é registrado.

## Antes de começar

- [ ] A rede de telas montada (veja [Montar a rede de telas da prefeitura](prefeitura-rede-de-telas)).
- [ ] A repartição com o módulo **Chamada de senha** ligado. UBS, UPA, hospital, CRAS, Central do Cidadão e SINE já nascem com ele. Nas outras, ligue em **Repartições → Editar → Módulos**.
- [ ] O **link** da repartição e um usuário para a recepção e para cada guichê (veja [O painel de cada repartição](prefeitura-painel-da-reparticao)).
- [ ] Um tablet ou uma tela de toque na entrada, se for usar o totem.

## Passo a passo

### 1. Crie as filas da repartição

1. Abra **Prefeitura** e clique na aba **Senhas**.
2. Em **Repartição**, escolha a repartição.
3. Escreva o nome da fila (por exemplo, **Atendimento geral**) e a **letra** da senha (por exemplo, **A**).
4. Deixe **Tem senha prioritária** marcado, se a fila atende prioridade legal.
5. Clique em **+ Adicionar fila**.

> Captura sugerida: a aba Senhas com a repartição escolhida, as filas com as letras e o campo para adicionar uma fila.

As senhas saem como **A001**, **A002**. As prioritárias levam um P: **AP001**. A numeração recomeça todo dia.

> Dica: numa UPA, crie duas filas: **Triagem** e **Atendimento médico**. A triagem dá a cor do risco e encaminha a pessoa para a outra fila.

### 2. Escolha como a tela chama

1. Ainda em **Senhas**, preencha o **Título do painel de senha**.
2. Em **Senhas normais para cada prioritária**, deixe **2**: depois de duas normais, a vez é de uma prioritária. Quem tem 80 anos ou mais passa à frente das outras prioridades.
3. Marque **A tela fala a senha e o guichê**, se quiser a voz.
4. Marque **Classificação de risco por cor**, se a ordem deve seguir a cor (vermelho, laranja, amarelo, verde, azul). Na UPA e no hospital já vem marcado. Veja "Quem é chamado primeiro", no passo 4.
5. Clique em **Salvar configuração**.

Para a senha aparecer grande, escolha o layout **Chamada de senha** na repartição (**Repartições → Editar**). Para ela aparecer só na coluna, marque o bloco **Senha atual** na lateral.

### 3. Ponha o totem na entrada

1. Em **Totem de retirada de senha**, clique em **Gerar o endereço do totem**.
2. Copie o endereço. Ele aparece só nessa hora.
3. Abra o endereço no tablet da entrada e deixe a página em tela cheia.

> Captura sugerida: o totem na tela de toque, com um botão grande para cada fila.

A pessoa toca na fila, escolhe **Atendimento normal**, **Prioritário** ou **80 anos ou mais**, e a senha aparece grande por 8 segundos. Com **O totem imprime a senha** marcado, o navegador abre a impressão de um papel pequeno.

> Importante: o endereço do totem só emite senha. Ele não abre a página de controle e não mostra a fila.

### 4. Atenda pelo guichê

Quem atende abre o **link** da repartição e entra com o usuário e a senha dele. Outra opção é o **endereço do guichê**, que não pede login e só chama a senha.

1. Em **Este guichê**, escreva o nome do seu guichê (por exemplo, **Guichê 3** ou **Consultório 2**).
2. Clique em **Chamar próxima**. A senha aparece na tela da espera com o seu guichê.
3. Se a pessoa não ouviu, clique em **Chamar novamente**. Na lista **Em atendimento**, cada senha também tem **Chamar novamente**, para chamar de novo uma senha anterior que ainda não foi finalizada.
4. Para mandar a pessoa a outra fila, escolha a fila em **Encaminhar para** e clique em **Encaminhar**. A prioridade e o risco continuam com ela.
5. Se ninguém veio, clique em **Não compareceu**.
6. No fim do atendimento, clique em **Finalizar**.

> Captura sugerida: a página de controle com o guichê à esquerda (a senha chamada em destaque e os botões Chamar novamente, Não compareceu e Finalizar) e a recepção à direita.

A recepção emite senhas em **Recepção: emitir senha**: escolha a fila e o atendimento e, se quiser, escreva o primeiro nome.

Na triagem, escolha a cor em **Classificação de risco** e clique em **Salvar a triagem**.

### Quem é chamado primeiro

A lista **Esperando** já está na ordem em que as senhas serão chamadas, e cada senha diz o porquê (por exemplo, "vermelho: imediato", "laranja há 12 min: passou do alvo de 10 min", "sem triagem · ordem de chegada").

- **Vermelho (Emergência)** é sempre o próximo.
- As outras cores têm um **tempo-alvo**: laranja (Muito urgente) 10 minutos, amarelo (Urgente) 60, verde (Pouco urgente) 120 e azul (Não urgente) 240. Quem passou mais do alvo vai na frente.
- Verde e azul que esperam demais **sobem de nível** até o do amarelo. Um verde há 2 horas passa o amarelo que acabou de chegar. Ninguém passa um laranja.
- Na mesma cor, **80 anos ou mais** e **preferencial (60+)** andam mais rápido.
- Quem ainda não passou pela triagem segue a ordem de chegada, com uma preferencial a cada 2 normais. 80 anos ou mais vai antes das outras preferenciais.

Para mudar os tempos-alvo ou desligar a aceleração por idade, abra **Recepção → Filas, totem e configuração**, em **Ordem de chamada com a classificação de risco**, e clique em **Salvar configuração**.

### Chamar fora da ordem e mudar a prioridade

- No **Atendimento** (e na página do guichê), clique em **Chamar esta** ao lado da senha para chamá-la agora, fora da ordem. Fica registrado quem chamou e quando.
- Na **Recepção**, troque a prioridade de quem espera no seletor ao lado da senha (**Normal**, **Preferencial / 60+** ou **80 anos ou mais**). O número da senha não muda.

### Tipo de problema na triagem

Na aba **Triagem**, escolha o **Tipo de problema** (por exemplo, **Dor no peito intensa**). A cor sugerida fica marcada nos botões com a palavra **sugestão**. Confirme clicando nela ou escolha outra cor: a decisão é sempre de quem faz a triagem. Para um caso fora da lista, escolha **Outro (escolher a cor)**.

> Importante: o tipo de problema não fica guardado. Ele só sugere a cor nesta tela: não vai ao servidor, à TV nem ao registro. Só a cor é gravada.

> Captura sugerida: a aba Triagem com o tipo de problema escolhido e a cor sugerida marcada.

### 5. Monte os cartões de informação

1. Abra a aba **Cartões** e escolha a repartição.
2. Clique em **+ Novo cartão**.
3. Escolha o **Tipo** (por exemplo, **Merenda**) e escreva as linhas, uma por linha.
4. No cardápio, escolha o **Dia da semana**: faça um cartão para cada dia. A tela mostra só o de hoje.
5. Clique em **Salvar**.

Os cartões se revezam na lateral da tela. A repartição também edita os cartões dela pelo link de controle.

### 6. Mostre o clima

1. Abra **Repartições** e clique em **Padrão da prefeitura…**.
2. Em **Clima nas telas**, escolha o **Estado** e escreva o **Município**.
3. Em **Blocos da lateral**, marque **Clima**.
4. Clique em **Salvar**.

O clima aparece nos layouts com lateral e se renova a cada 30 minutos.

### 7. Guarde vídeos e uma imagem para quando a internet cair

1. Abra a aba **Sem internet**.
2. Em **Nível**, escolha **Padrão da prefeitura**, um grupo ou uma repartição.
3. Marque os vídeos da biblioteca.
4. Clique em **Salvar a lista**.

Cada TV box baixa os vídeos e toca quando fica sem internet. O vídeo só segue para as telas depois que a coluna **Situação** mostra **pronto para as telas**.

Para a tela não ficar preta quando a internet cai e não há vídeo guardado, suba também uma imagem:

1. Na mesma aba, em **Nível**, escolha **Padrão da prefeitura**, um grupo ou uma repartição.
2. Em **Imagem sem internet**, clique em **Enviar imagem** e escolha um arquivo JPEG, PNG ou WebP de até 15 MB.
3. Confira a miniatura. Para trocar, clique em **Trocar a imagem**; para tirar, clique em **Remover**.

O servidor ajusta a imagem para 1920×1080, cobrindo a tela sem distorcer (as sobras são cortadas). Cada tela usa a imagem do nível mais específico: a da repartição, depois a do grupo, depois a do padrão da prefeitura. O gestor da repartição também envia a imagem dela pelo link de controle, na aba **Telas**.

### 8. Ligue a aprovação da SECOM

1. Em **Repartições → Padrão da prefeitura…**, marque **Aprovação da SECOM**.
2. Clique em **Salvar**.
3. Abra a aba **Aprovações** para ver o que as repartições pediram.
4. Clique em **Aprovar** ou **Recusar** em cada pedido.

> Captura sugerida: a aba Aprovações com um pedido aguardando, o conteúdo, a classificação e os botões Aprovar e Recusar.

Com a aprovação ligada, os avisos, os cartões e os alertas escritos pelo link de controle esperam a sua decisão. Os alertas da Defesa Civil saem na hora e ficam marcados no histórico.

### 9. Prepare o período eleitoral

1. Em **Repartições → Padrão da prefeitura…**, preencha o **Primeiro dia do período** e o **Último dia**.
2. Clique em **Salvar**.

No período, o que está classificado como **Institucional** fica guardado e não vai às telas. Nada é apagado. **Utilidade pública** e **Emergência** seguem normalmente.

Ao escrever um aviso, um cartão ou um alerta, escolha a **Classificação**. O padrão é **Utilidade pública**.

## Resultado

- [ ] A repartição tem as filas criadas e o totem emite senhas.
- [ ] A senha chamada no guichê aparece na tela da espera em menos de 2 segundos.
- [ ] Os cartões do dia aparecem na lateral.
- [ ] Os vídeos guardados mostram **pronto para as telas**.
- [ ] A aba **Sem internet** mostra a miniatura da imagem do padrão da prefeitura.
- [ ] A aba **Aprovações** mostra os pedidos das repartições.
- [ ] A aba **Senhas** mostra o relatório e exporta o CSV.

## Problemas comuns

**A aba Senhas diz que nenhuma repartição tem a chamada de senha.** Ligue o módulo **Chamada de senha** em **Repartições → Editar → Módulos**.

**A tela não mostra o painel de senha.** A repartição precisa do layout **Chamada de senha** ou do bloco **Senha atual** na lateral, e do módulo ligado.

**O totem mostra "Totem desligado".** O endereço foi trocado ou desligado. Gere outro em **Senhas → Totem de retirada de senha**.

**O totem mostra "Muitas senhas em pouco tempo".** A emissão tem um freio contra abuso. Espere um minuto ou emita pela recepção.

**A letra da fila foi recusada.** A letra confunde com a de outra fila: a prioritária da fila **A** usa **AP**. Escolha outra letra.

**O cartão não aparece na tela.** Confira o **Dia da semana** e o período do cartão, e se o módulo do tipo está ligado na repartição.

**O clima não aparece.** Falta a cidade no **Padrão da prefeitura**, ou o bloco **Clima** não está marcado na lateral.

**O vídeo guardado fica em "calculando a conferência".** O servidor confere o arquivo em segundo plano e espera quando o canal no ar precisa de folga. Clique em **Atualizar a situação** depois de alguns minutos.

**O aviso sumiu da tela no período eleitoral.** Ele está classificado como **Institucional**. Volta sozinho depois do último dia.

**O selo vermelho no menu Prefeitura.** Ele soma as telas desligadas e os pedidos aguardando aprovação. A aba **Telas** mostra há quanto tempo cada tela está desligada.

## Próximos passos

- [Montar a rede de telas da prefeitura](prefeitura-rede-de-telas): repartições, telas, grupos e alertas.
- [Pôr um alerta de emergência no ar](alertas-de-emergencia): o alerta do canal também aparece nas telas da prefeitura.
- [Criar grupos e usuários](usuarios-e-acessos): quem pode abrir o Painel da Prefeitura.
