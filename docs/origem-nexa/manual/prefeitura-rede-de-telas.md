---
titulo: Montar a rede de telas da prefeitura
resumo: Cadastre as repartições, ligue as TV box com a chave de acesso, organize as telas em grupos, acompanhe tudo no mapa e mande avisos e alertas só para quem precisa.
caminho: NEXA Telas → Prefeitura
tela: prefeitura
tempo: 25 minutos
nivel: intermediário
palavras: prefeitura, modo prefeitura, NEXA Telas, telas, TV box, repartição, repartições, escola, UBS, UPA, hospital, CRAS, região, bairro, grupo, grupos, mapa, pino, chave de acesso, PIN, link de controle, senha do painel, olho, assistente, alcance dos alertas, avisos, texto rolante, layout, alerta, Defesa Civil, SECOM, raio, captura
---

## Objetivo

Neste artigo você usa o **Painel da Prefeitura**: a rede de telas do NEXA Telas, com uma TV box em cada prédio público (escolas, UBS, UPA, hospitais, CRAS, a sede) tocando o canal da prefeitura, sem comerciais.

No fim, você terá as repartições no mapa, as telas ligadas e com PIN, grupos de telas (por exemplo, **Escolas**), avisos no texto rolante e um alerta em tela cheia enviado só para as telas certas.

É para quem cuida da comunicação e da operação da prefeitura. Leva uns 25 minutos para a primeira repartição.

> Importante: o menu **Prefeitura** só aparece quando o **modo prefeitura** está ligado no plano da organização (quem liga é a equipe da plataforma) e para quem tem a permissão do Painel da Prefeitura. Com o modo ligado, o menu **Comercial** some: a rede não leva anúncios.

## Antes de começar

- [ ] O modo prefeitura ligado no plano e a permissão **Painel da Prefeitura** no seu grupo, com acesso a **todos os canais**. Sem ele aparece **O Painel da Prefeitura pede acesso a todos os canais do cliente.**
- [ ] O canal da prefeitura no ar (veja [Colocar o primeiro canal no ar](primeiro-canal-no-ar)).
- [ ] As TV box com o app NEXA Telas instalado, ligadas à TV e à internet.
- [ ] A lista dos prédios, com o endereço e o responsável de cada um.

## Passo a passo

### 1. Abra o Painel da Prefeitura

**O que fazer:** no menu, em **NEXA Telas**, clique em **Prefeitura**.

**Por quê:** a tela tem seis abas: **Mapa**, **Telas**, **Grupos**, **Repartições**, **Regiões** e **Alertas**.

> Captura sugerida: o Painel da Prefeitura na aba Mapa, com os contadores no alto, os filtros e os pinos das telas sobre o mapa da cidade.

**Resultado esperado:** abre a aba **Mapa**. Na primeira vez, ela pergunta **De qual município é esta prefeitura?**

### 1a. Escolha o município da prefeitura (uma vez)

**O que fazer:** escolha a **UF**, digite o nome em **Município**, escolha na lista e clique em **Salvar o município**.

**Por quê:** o mapa passa a abrir sempre na cidade inteira, com o contorno dela marcado e o lado de fora escurecido, e fica travado nela. A escolha fica guardada: ninguém precisa indicar de novo.

> Captura sugerida: a aba Mapa com a pergunta do município e, ao lado, o mapa já com o contorno da cidade.

**Resultado esperado:** aparece **Município da prefeitura** com o nome da cidade e **Contorno guardado.** O mapa abre na cidade.

**Erro comum:** digitar o nome e não escolher na lista. O painel pede **Escolha o estado e o município da lista.**

**Atenção:** confira antes de salvar. Depois de definido, o município fica **travado**: nem o administrador da prefeitura troca. Se foi escolhido errado, peça a troca à equipe da plataforma.

### 2. Cadastre as regiões

**O que fazer:** na aba **Regiões**, escreva o nome do bairro ou distrito, escolha a cor e clique em **+ Adicionar região**. Repita para cada região.

**Por quê:** cada repartição fica numa região, e um alerta pode ir só para as telas de uma ou mais regiões. A cor aparece no anel do pino, no mapa.

**Resultado esperado:** a região entra na tabela, com o número de repartições e de telas.

### 3. Cadastre a repartição e ponha no mapa

**O que fazer:** na aba **Repartições**, clique em **+ Nova repartição**. O assistente tem três passos:

1. **O tipo:** clique no cartão do tipo (Escola, UBS, UPA, Defesa Civil, Segurança…). Ao lado aparece a prévia da tela da TV box no layout de fábrica do tipo, com conteúdo de exemplo. Para trocar o layout, clique em outro (Tela cheia, Vídeo + avisos, Vídeo + lateral…): a prévia acompanha. Clique em **Continuar**.
2. **Nome, endereço e mapa:** preencha **Nome**, **Região**, **Responsável** e **Contato do responsável**. Escreva o **Endereço**, clique em **Localizar no mapa**, escolha um dos resultados, arraste o marcador até o prédio e clique em **Salvar**.
3. **O link e a senha do painel:** a janela **Repartição criada** mostra o **Link** e a **Senha** do painel da repartição. Clique no olho para ver e em copiar para levar ao responsável.

**Por quê:** o tipo define os módulos da repartição, os grupos automáticos e a sigla do pino. O ponto no mapa é onde o pino dela aparece e o que o alerta por raio usa. A senha é sorteada forte e sem letras que se confundem, para ser ditada por telefone.

> Captura sugerida: o passo 1 com o cartão Escola escolhido e a prévia em Vídeo + lateral.

**Resultado esperado:** a repartição aparece como uma ficha na aba Repartições, com o tipo, o layout, o painel (link e senha escondidos atrás do olho) e as TV box vinculadas. Se a prefeitura ainda não tem um PIN padrão, abre também a janela **PIN de saída** com um PIN sorteado para as TV box desta repartição.

**Erro comum:** confundir a senha do painel com o PIN de saída. A senha abre o painel da repartição no navegador. O PIN destrava a TV box no local, pelo controle remoto, e aparece uma vez só; se perdeu, clique em **PIN de saída da TV box (novo)** na ficha.

**Dica:** depois, na ficha, o olho mostra o link e a senha de novo, só para quem administra a prefeitura, e fica no registro de auditoria. Repartição cadastrada antes desta versão mostra "Senha definida antes; gere uma nova para poder vê-la": clique em **Gerar nova senha** (a de antes deixa de valer).

**Dica:** em **Padrão da prefeitura…** você define o que vale para toda tela que não tem nada mais específico: o layout, os avisos gerais, um PIN padrão, a sequência de saída e o horário de ligar e desligar a TV.

### 4. Ligue a TV box com a chave de acesso

**O que fazer:** na ficha da repartição, clique em **+ TV box** (ou, no fim do assistente, em **Cadastrar a primeira TV box**). Dê o **Nome da tela** (por exemplo, "UBS Centro, recepção") e clique em **Gerar chave**. Digite a chave no app da TV box. Também dá pela aba **Telas** → **Gerar chave de acesso**, escolhendo a repartição.

**Por quê:** a chave liga o aparelho à repartição: a TV box já nasce vinculada a ela, sem passo a mais. A chave vale para uma tela só e vence em 24 horas. Para passar uma tela para outra repartição, use **Ver as TV box** → **Editar ou mover**.

> Captura sugerida: a janela Gerar chave de acesso com a chave em letras grandes e a data em que ela vence.

**Resultado esperado:** a TV box começa a tocar o canal e a tela aparece na tabela com **No ar**. No mapa, o pino fica verde.

**Erro comum:** digitar a chave depois de 24 horas ou usá-la em dois aparelhos. A TV box recusa. Gere outra chave.

### 5. Acompanhe as telas no mapa

**O que fazer:** na aba **Mapa**, veja os contadores e os pinos. Cada pino é uma repartição, com a sigla do tipo (ESC, UBS, UPA, HOSP, CRAS…). Filtre por **região** ou **tipo**. Clique num pino.

**Por quê:** o mapa mostra de uma vez o que está funcionando. Verde: todas as telas da repartição no ar. Amarelo: alguma ligada sem imagem. Vermelho: alguma desligada (sem sinal há mais de 2 minutos). Cinza: sem tela. A legenda fica no canto do mapa.

> Captura sugerida: o mapa da cidade com o contorno, os pinos coloridos e a lateral aberta com as TV box de uma repartição.

**Resultado esperado:** ao clicar no pino, a lateral mostra o nome, o endereço, o tipo e a região da repartição e a lista **TV box desta repartição**: a identificação de cada uma (por exemplo, **#12**), o nome, se está no ar, desde quando, a versão do app e os grupos dela. **Captura e comandos** abre a última captura e os botões **Recarregar**, **Reiniciar app** e **Captura**.

**Dica:** **Captura** pede uma foto do que a tela está mostrando. Ela chega em até 30 segundos.

**Dica:** em **Destacar um grupo** (ou clicando num grupo na lateral), as repartições com tela naquele grupo ficam em destaque, as outras esmaecem, e o painel diz quantas telas do grupo estão no ar e desligadas. **Tirar o destaque** volta ao normal.

**Dica:** **Tela cheia** faz o mapa ocupar a janela inteira (a tecla Esc volta) e **Ver a cidade inteira** volta ao enquadramento da cidade. Os filtros, o grupo destacado e a tela cheia ficam lembrados neste navegador.

### 6. Organize as telas em grupos

**O que fazer:** na aba **Grupos**, clique em **+ Novo grupo**. Dê o nome (por exemplo, "Escolas") e, em **Como entram as telas**, escolha **Manual** e marque as telas, ou **Automático** e o tipo de repartição. Se quiser, preencha os **Avisos do grupo** e o **Layout do grupo**. Clique em **Salvar**.

**Por quê:** o grupo recebe a mesma informação: avisos, layout e alertas só para ele. No automático, toda tela de uma repartição daquele tipo entra sozinha.

**Resultado esperado:** o grupo entra na tabela com o número de telas, quantas estão no ar e quantas desligadas.

**Dica:** **Criar os grupos automáticos por tipo** cria de uma vez um grupo para cada tipo de repartição que você já cadastrou.

### 7. Escreva os avisos

**O que fazer:** abra a repartição (ou o grupo, ou a tela) em **Editar**, escreva um aviso por linha em **Avisos** e escolha o **Layout** com texto rolante (**Vídeo + avisos**). Clique em **Salvar**.

**Por quê:** o que cada tela mostra sai nesta ordem: o que a própria tela define, depois os grupos dela, depois a repartição e, por fim, o padrão da prefeitura.

**Resultado esperado:** as telas trocam em até 30 segundos.

**Dica:** uma tela em vários grupos mostra os avisos de todos eles, na ordem dos grupos, e usa o layout do primeiro grupo que define um.

### 8. Envie um alerta em tela cheia

**O que fazer:** na aba **Alertas**, preencha **Título** e **Texto**, escolha o **Nível**, a **Duração** e, em **Para onde**, o alcance: **Cidade toda**, **Regiões**, **Grupos de telas**, **Uma repartição** ou **Raio no mapa**. Confira a prévia e clique em **Enviar alerta**.

**Por quê:** o alerta cobre o vídeo nas telas escolhidas até o fim do prazo. A prévia diz quantas telas vão receber e quantas estão ligadas agora.

> Captura sugerida: a aba Alertas com o alcance Raio no mapa, o círculo sobre o mapa e a prévia "telas vão receber".

**Resultado esperado:** aparece **Alerta enviado** com o número de telas. Ele entra em **Em vigor e agendados**, com o botão **Encerrar**.

**Erro comum:** no alcance **Raio no mapa**, esquecer de clicar no mapa. A prévia mostra **Clique no mapa para marcar o centro do raio.**

### 9. Dê o controle à repartição

**O que fazer:** na aba **Repartições**, clique em **Usuários**, crie um usuário para o responsável (com o papel **Gestor**) e clique em **Gerar o link**. Copie o link e mande ao responsável. Passe o usuário e a senha por outro caminho. O passo a passo completo está em [O painel de cada repartição](prefeitura-painel-da-reparticao).

**Por quê:** com o link e a senha, a própria repartição vê as telas dela, troca os avisos e manda um alerta nas próprias telas. Nada mais do painel fica ao alcance.

**Resultado esperado:** o link aparece uma vez. Na página, o responsável digita a senha e vê **Telas desta repartição**, **Avisos na tela** e **Alerta em tela cheia**.

**Dica:** a SECOM e a Defesa Civil também alcançam, pelo link delas, a cidade toda, regiões e grupos.

### 10. Defina o alcance dos alertas das repartições de emergência

**O que fazer:** na ficha da **Defesa Civil**, da **Segurança** ou das **Polícias**, em **Alcance dos alertas**, clique em **Alterar**. Escolha **Todas as TV box da prefeitura**, **Regiões e grupos escolhidos** ou **Só as telas desta repartição**. Marque **Também no ar dos canais** se o alerta deve entrar também no ar do canal (o alerta de emergência do canal). Clique em **Salvar**.

**Por quê:** no painel da repartição aparece o botão **Alcance da prefeitura**: com um clique, o alerta vai a todas essas telas ao mesmo tempo. Cada TV box recebe no próximo sinal de vida, em até 30 segundos.

**Resultado esperado:** aparece **Alcance salvo**, com quantas telas recebem hoje. A Defesa Civil já nasce com **Todas as TV box da prefeitura**; as outras começam só com as próprias telas.

**Erro comum:** marcar o ar dos canais sem ligar os Alertas de emergência do canal. O alerta fica só nas telas. Ligue em **Alertas de emergência → Ajustes**. Só Severo e Extremo vão ao ar do canal; aviso e teste, nunca. Nada é enviado a celulares.

## Resultado

- [ ] As repartições aparecem no mapa, cada uma na sua região.
- [ ] As telas estão ligadas e com o pino verde.
- [ ] Cada repartição tem o PIN de saída anotado.
- [ ] Os grupos mostram as telas certas.
- [ ] Os avisos passam nas telas.
- [ ] O alerta de teste apareceu nas telas escolhidas e foi encerrado.

## Problemas comuns

**O menu Prefeitura não aparece.** O modo prefeitura não está no plano da organização, ou o seu grupo não tem a permissão do Painel da Prefeitura. Fale com o administrador.

**O pino está vermelho.** Alguma tela da repartição não dá sinal há mais de 2 minutos: a TV box está desligada ou sem internet. Clique no pino: a lista mostra qual é e o último sinal.

**O pino está amarelo.** Alguma TV box está ligada, mas sem imagem. Abra **Captura e comandos**, veja o **Último erro** e tente **Recarregar**.

**A repartição não aparece no mapa.** Ela está sem ponto. Abra a repartição em **Editar** e use **Localizar no mapa**.

**Aparece "fora do município".** O ponto da repartição ficou fora do contorno da cidade (endereço localizado em outra cidade, por exemplo). Ela não some: clique no nome dela, embaixo do mapa, e arraste o marcador para o lugar certo.

**Aparece "Contorno indisponível".** O contorno vem do IBGE e não chegou. O município continua guardado e o mapa abre na região, sem a trava. Clique em **Tentar de novo**.

**O mapa não deixa sair da cidade.** É assim de propósito: ele fica travado no município da prefeitura, definido no primeiro cadastro. Só a equipe da plataforma troca o município.

**O fundo do mapa não carrega.** O mapa de ruas vem da internet. Sem ele, os pinos continuam aparecendo sobre o fundo liso.

**A repartição esqueceu a senha.** Em **Repartições → Usuários**, clique em **Trocar a senha** na linha do usuário. Quem estava com a página aberta com esse usuário entra de novo.

**Uma TV box foi trocada ou roubada.** Na aba **Telas**, clique em **Revogar**. O aparelho perde o acesso na hora. Para ligar outro, gere uma chave nova.

## Próximos passos

- [Pôr um alerta de emergência no ar](alertas-de-emergencia): o alerta no sinal do canal, para quem assiste em casa.
- [Criar grupos e usuários](usuarios-e-acessos): quem pode abrir o Painel da Prefeitura.
- [Conferir o plano e o uso](plano-e-uso): o que o plano da organização inclui.
