# NEXA Telas: o app da TV box

App Android **nativo** (Kotlin, sem WebView e sem Capacitor) que transforma uma TV box em tela de sinalização: liga
sozinho, abre em tela cheia, toca o canal (HLS) e mostra avisos e alertas. Pensado para repartições de uma prefeitura
(escolas, unidades de saúde, recepções).

- Pasta: `android-telas/` (projeto Gradle próprio; não entra na imagem Docker do servidor, ver `.dockerignore`).
- `applicationId`: `br.com.nexatv.telas` · nome: **NEXA Telas** · versão 1.2.5 (versionCode 9) · Android 7.0+
  (minSdk 24), alvo API 35. O APK não tem biblioteca nativa: o mesmo arquivo serve em TV box de 32 bits
  (armeabi-v7a) e de 64 bits (arm64-v8a).
- Contrato com o servidor do NEXA Broadcast: `telas-contrato.md` (rotas `/api/telas/*`). O app consome o contrato como
  está escrito; as interpretações, já fechadas com o servidor no §6 do contrato, estão na seção 9.
- Dependências (versões fixas, só de `google()` e `mavenCentral()`): Media3 ExoPlayer 1.4.1 (+ HLS) e ZXing core 3.5.3
  (QR code gerado no aparelho). HTTP pelo `HttpURLConnection` e JSON pelo `org.json` do próprio Android.
- **Vai testar na TV box com Android 11? Comece pela seção 10**, que tem o roteiro inteiro.

> **O que foi e o que não foi testado.** Este app foi compilado (`assembleDebug`), passou no lint e tem testes da JVM
> para a lógica pura (seção 7). **Nada foi testado em aparelho**: não havia TV box nem emulador na montagem. Tudo o que
> depende do Android de verdade está na lista de conferência da seção 8 e no roteiro da seção 10.

## 1. Instalar pelo pendrive

1. Copie `NEXA-Telas-1.2.5-debug.apk` para um pendrive.
2. Na TV box: **Configurações → Segurança** (ou **Apps → Acesso especial**) e permita instalar apps de fontes
   desconhecidas para o gerenciador de arquivos do aparelho.
3. Abra o gerenciador de arquivos, entre no pendrive e abra o APK. Confirme a instalação.
4. Abra o **NEXA Telas**. Ao apertar **Home**, o Android pergunta qual é a tela inicial: escolha **NEXA Telas** e
   **Sempre**. (Sem essa escolha o app funciona, mas o Home leva para a tela antiga do aparelho.)
5. Se a rede ainda não estiver configurada, use o botão **Configurações do Android (rede Wi-Fi)** da primeira tela.

Pelo computador, com a depuração ligada, também dá: `adb install -r NEXA-Telas-1.2.5-debug.apk`.

## 2. Primeira vez: os dois modos

### Gerenciado (com a chave do painel)

1. Escolha **Com a chave do painel da prefeitura**.
2. Confira o endereço do servidor (padrão `https://api.nexa.tv.br`) e digite a **chave de acesso** gerada no painel
   (8 letras e números, vale uma vez e por 24 h). A tela tem um **teclado próprio** (letras e números em botões): ande
   com as setas do controle e aperte OK em cada letra. Quem tiver um teclado USB ligado na TV box pode digitar direto
   no campo.
3. **Ativar.** O app chama `POST /api/telas/activate`, guarda o token do aparelho (cifrado pelo Keystore do Android) e
   passa a seguir o painel: configuração, sinal de vida a cada `heartbeatSec`, comandos, alertas e captura de tela.
4. A última configuração fica guardada: sem rede, o aparelho liga e toca com ela (e com os vídeos já baixados).
5. Se o painel desativar o aparelho (resposta 401), o app apaga o token e volta à tela da chave.
6. Se o serviço for desligado para o cliente (403 com `code: "unavailable"`), o app **guarda** o token e a última
   configuração, continua tocando e tenta de novo a cada 5 minutos.

### Avulso (sem servidor)

1. Escolha **Só um endereço de vídeo, digitado aqui**.
2. Digite o endereço HLS e crie um **PIN** de 4 a 8 números (duas vezes).
3. **Salvar e tocar.** Neste modo só existe o layout de tela cheia, sem avisos, alertas nem horário.

`http://` (sem cadeado) só é aceito aqui, no endereço de vídeo digitado no aparelho. No modo gerenciado o servidor e o
vídeo precisam ser `https://`.

### Sair do app e abrir os ajustes

No controle remoto: **↑ ↑ ↓ ↓ OK** (ou a sequência definida no painel, `lock.exitSeq`) e depois o **PIN**. Abre a tela
de **Ajustes e diagnóstico**: aparelho, repartição, região, servidor, versão, nível de quiosque, rede, último sinal de
vida, último erro, e os botões para testar o canal, recarregar, reativar com outra chave, trocar de modo, sair para as
configurações do Android (10 minutos; abrir o app de novo trava outra vez) e as instruções do Device Owner.

Desde a 1.2.0 os ajustes têm também:

- **Diagnóstico completo (texto para fotografar)**: um bloco de texto só, com tudo o que interessa no teste de campo
  (lista na seção 10.5). Tem um botão para congelar o texto na hora da foto e outro para copiar.
- **Tornar o NEXA Telas a tela inicial**: aparece enquanto o app não for a tela inicial do aparelho.
- **Permitir que o app volte sozinho para a frente**: aparece enquanto a permissão "sobrepor a outros apps" não foi dada.
- **Tirar o app da economia de bateria**: aparece enquanto o app não estiver isento.
- **Data e hora do Android**: abre a tela de data e hora (para aparelho que liga com a data errada).
- **Vídeo: automático / fixo / fixo em 720p**: como o player escolhe a qualidade (ver "Decodificador" na tabela).

- 5 PINs errados bloqueiam por 15 minutos, e o bloqueio continua valendo depois de reiniciar.
- As telas de PIN e de ajustes fecham sozinhas depois de 90 s sem tecla.
- O PIN é conferido no aparelho: `sha256(salt + pin)`, com o salt e o PIN juntados como texto.
- Se o painel não mandar PIN (`lock.pinHash` vazio), a sequência de teclas abre os ajustes direto. O painel deve sempre
  mandar um PIN.

## 3. O que o app faz

| Assunto | Comportamento |
|---|---|
| Ligar | Recebe `BOOT_COMPLETED`, `LOCKED_BOOT_COMPLETED` e `QUICKBOOT_POWERON`; é a tela inicial (HOME + LEANBACK_LAUNCHER + LAUNCHER). **No Android 10 e seguintes quem abre o app ao ligar é o próprio Android, por ele ser a tela inicial**: sem essa escolha (ou sem o Device Owner) o sistema não deixa um app abrir sozinho. Os ajustes mostram se o app é a tela inicial e têm o botão para escolher. App recém-instalado que nunca foi aberto não recebe o aviso de boot: abra uma vez. |
| Player | Media3 ExoPlayer com HLS, tela cheia, tela sempre ligada. Volume e mudo vêm de `stream.volume`/`stream.muted`. Só a trilha de som estéreo é escolhida (a 5.1 do canal fica de fora). No Wi-Fi o app segura o rádio em alto desempenho (`WifiLock`). |
| Decodificador | Usa o decodificador do aparelho (hardware); se ele não abrir, o player tenta o seguinte da lista do Android (software) em vez de parar. A resolução nunca passa do tamanho da tela (mínimo 720p). Modo do vídeo: **automático** (adaptativo), **fixo** (uma qualidade só, a melhor que cabe na tela, sem troca de resolução no meio) e **fixo em 720p**. Dois erros de decodificador em 10 minutos descem um degrau sozinho (fica guardado e aparece em "Último erro"); para subir de novo, o botão "Vídeo" nos ajustes. |
| Vigia | Vídeo parado por 10 s ou erro do player: recarrega (no erro, espera 3 s antes). "Parado" olha dois sinais: os quadros que saem do decodificador e a posição do player. Só com **os dois** parados por 10 s o vídeo é dado como travado, então descontinuidades do HLS e saltos da janela do ao vivo não disparam o vigia. Se o decodificador do aparelho não informa os quadros (contador parado com a posição andando por 3 s), a sessão passa a valer pela posição e os ajustes mostram "Vigia: por posição". Depois de 3 recargas sem sucesso: `stream.backup`. Sem rede ou com os dois fora: toca em laço os vídeos guardados. Fora do principal, confere o ao vivo a cada 30 s (o intervalo dobra, até 4 min, se a volta falhar de novo). |
| Volta do canal | O servidor mantém o HLS vivo com uma cartela enquanto o canal está parado; quando o canal volta, a sequência de segmentos salta. Erro de "atrás da janela do ao vivo", lista parada/reiniciada ou lista malformada: o player volta à ponta do ao vivo na hora (`seekToDefaultPosition` + `prepare`), **sem** contar como recarga que falhou. Só 6 dessas seguidas sem o vídeo andar viram uma falha de verdade. |
| Layouts | `full`; `ticker` (vídeo + faixa de avisos embaixo); `side` (vídeo + coluna lateral); `lbar` (em L: vídeo, coluna lateral à direita e a faixa de avisos embaixo, na largura toda); `portrait` (TV em pé); `queue` (painel de senha grande com o canal pequeno no canto). Desconhecido = `full`. `queue` sem `queue.enabled` é desenhado como `side`. `ticker` sem nenhum aviso é desenhado como `full`, e `lbar` sem nenhum aviso como `side`. Com a saída do aparelho em pé, o `lbar` empilha como o `portrait`. |
| Coluna lateral | Título, depois os widgets na ordem de `side.widgets`: `clock` (relógio e data), `weather` (ícone desenhado no aparelho, temperatura, condição, cidade), `queue` (senha atual e guichê) e `qr` (QR code gerado no aparelho). Embaixo, os cartões de informação e o último aviso encerrado. |
| Clima | Campo `weather` do `/config`; ausente ou `null` = sem clima. Some se a medição (`at`) tiver mais de 3 h (aparelho sem rede). |
| Cartões | `cards`: revezam na coluna lateral (layout `side`, `lbar` e `portrait`) e, no layout `queue`, abaixo das últimas senhas; cada um fica os seus `seconds` (padrão 10, de 3 a 120). Em `full` e `ticker` não aparecem. |
| Senha | Com `queue.enabled`: `GET /api/telas/queue` ao conectar e depois o tempo real por `GET /api/telas/queue/stream` (Server-Sent Events pelo `HttpURLConnection`, sem dependência nova). Reconecta com espera de 1 s a 30 s e pede o estado de novo; o `: ping` de 20 s mantém a conexão (65 s sem nada = caiu). Na chamada: destaque por 10 s, um toque curto, o som do canal baixa para 20% e a voz fala "Senha P zero um dois, guichê três" (com `showName` e nome, o nome no lugar). `repeat: true` anuncia de novo. Sem `queue.enabled`, nada disso roda. |
| Chamada em tela inteira | 1.2.2 (contrato §7.2 e §12). Na chamada (nova ou repetida) um **cartão amarelo ocupa a tela inteira por 10 s, em TODOS os layouts** (inclusive `queue` e `side` com o widget), e some: "SENHA", a senha enorme, o guichê/consultório grande logo abaixo (com " · preferencial" quando for) e o nome reduzido só com `showName` e nome, tudo em texto escuro sobre o amarelo. Chamada seguida troca o cartão e o prazo recomeça. Fora do horário (tela apagada pela agenda) não aparece. Ordem na tela: alerta em tela cheia > desaparecido em tela cheia > faixa do desaparecido > cartão da chamada > o resto. Se a senha não couber com o guichê (TV baixa, margem grande), ela diminui; o guichê nunca some. |
| Painel e coluna da senha | 1.2.2. O bloco da senha atual fica sempre no fundo escuro com texto claro (o destaque passou a ser o cartão em tela inteira; nada pisca nem fica branco sobre amarelo). Ordem: senha, guichê (grande, negrito, até 2 linhas) e o nome. **Em atendimento** (contrato §12): abaixo da senha atual, até 4 senhas chamadas e ainda não finalizadas, a mais nova em cima, com o consultório; saem quando o atendente finaliza, marca "não compareceu" ou encaminha. No painel `queue` a lista "EM ATENDIMENTO" substitui "ÚLTIMAS CHAMADAS" (servidor sem o campo: continua com as últimas). "Aguardando" e a espera média numa linha e as cores do risco em outra, dividindo a largura. A coluna lateral ficou mais estreita (22% da largura, antes 26%): o vídeo maior. |
| Legendas da programação | 1.2.5 (contrato §14). O `captions: { on, lang }` do /config liga a faixa de texto do player (Media3) e prefere o idioma pedido; sem ele no fluxo, a legenda do canal. O ar traz a legenda CEA-608 em português embutida no vídeo; como a mestre HLS não declara `CLOSED-CAPTIONS`, o app declara o CC1 em português ao ler a mestre (sem isso o Media3 descarta as falas). A legenda é desenhada no rodapé da área do vídeo, com fundo escuro atrás de cada linha, dentro da margem segura; o cartão da chamada, os alertas e os desaparecidos ficam por cima, e a faixa de avisos fica fora da área do vídeo. Ajustes: "Legendas: ligadas/desligadas" e "Idioma da legenda" (do canal e os idiomas que o fluxo traz); a escolha do aparelho vale até a próxima mudança das legendas no painel. Diagnóstico: linha "Legendas" (o que vale, de onde, e os idiomas no fluxo). |
| Atualização do app | 1.2.4. O `update` do /config ({ url, sha256, versionCode }) vem do padrão da prefeitura ou, sem ele, do **APK servido pelo próprio servidor** (`/telas/app/latest.apk`, docs/TELAS.md §23). Com versionCode maior que o instalado, o app baixa, confere o SHA-256 e abre o instalador do Android (PackageInstaller); com o Device Owner instala sozinho. Automático a cada configuração nova (uma tentativa por versão a cada 6 h); em Ajustes, **"Procurar atualização"** busca a configuração na hora e tenta sem esperar, dizendo o que aconteceu ("já tem a versão mais nova", "baixando", "não confere"). Sem o Device Owner, o Android pede uma vez a permissão "instalar apps desconhecidos" para o NEXA Telas (há um botão nos Ajustes e um passo no assistente) e confirma cada instalação na tela. |
| Assistente de configuração inicial | 1.2.4. No primeiro uso (antes da chave) e em Ajustes → "Assistente de configuração inicial": (1) tela inicial do aparelho, pela pergunta do Android (RoleManager no Android 10+; nos anteriores, a escolha do Home); (2) abrir ao ligar (o app recebe o aviso de boot; no Android 10+ só abre sozinho sendo a tela inicial ou com o Device Owner); (3) permitir instalar as atualizações; (4) tirar da economia de bateria; (5) rede e hora; (6) a chave de ativação. Cada passo mostra OK / falta / pulado, tem o botão que abre a tela certa do Android e pode ser pulado. **O Android não deixa um app virar a tela inicial nem instalar sem perguntar por conta própria**: quem instala confirma na pergunta do sistema; só o Device Owner (seção 5) faz tudo sem perguntas. |
| Chave de ativação | 1.2.4. Sempre em maiúsculas e no formato XXXX-XXXX, com o hífen automático depois do 4º caractere (o Apagar passa por cima dele). O teclado da tela mostra só os caracteres que a chave usa (números 2–9 numa linha, depois as letras sem I e O; "A chave não usa 0, 1, I nem O"). Teclado USB e colar também valem: minúsculas, espaços e hífens são normalizados; 0, 1, I e O não são trocados em silêncio: saem e aparece o aviso para conferir. O servidor já aceitava hífen e minúsculas. |
| PIN | 1.2.4. De 4 a 8 números (o servidor sorteia 6). A tela não tem casas fixas: uma bolinha por número digitado, e quem confere é o OK (menos de 4 avisa sem contar como erro). |
| Telas de configuração e teclados | 1.2.4. Ajustes, ativação, PIN e assistente ficam dentro da mesma margem de segurança (overscan) da tela do canal, e os teclados da tela (chave e PIN) diminuem as teclas até caber na largura disponível: nada sai pela direita em 1280×720 ou 1920×1080 com margem de 5%. |
| Painel de senha (`queue`) na área segura | 1.2.4. O painel inteiro (título, senha, consultório, em atendimento, aguardando, cores do risco e cartões) e o canal pequeno no canto ficam dentro da margem. A senha diminui até o consultório caber; a lista de em atendimento que não cabe na altura mostra as mais novas e "+N em atendimento". Conferido no emulador em 1280×720 e 1920×1080 com 5%. |
| Cor do risco na chamada | 1.2.3 (contrato §13). Na UPA e no hospital (classificação de risco ligada), o cartão em tela inteira tem o fundo da cor da senha (vermelho #D92D20, laranja #F97316, amarelo #FACC15, verde #16A34A, azul #2563EB) e, no alto, o nível escrito: EMERGÊNCIA · VERMELHO, MUITO URGENTE · LARANJA, URGENTE · AMARELO, POUCO URGENTE · VERDE, NÃO URGENTE · AZUL (quem não distingue as cores lê o nível). Texto branco quando o contraste passa de 4,5 (vermelho e azul); escuro no amarelo, no laranja e no verde (branco daria 2,8 e 3,3). Sem risco: o amarelo de sempre com "SENHA"; prioritária sem risco: "PREFERENCIAL" no alto, maior. Na coluna e no painel, um marcador redondo da cor ao lado da senha atual e de cada senha em atendimento. |
| Margem da tela (overscan) | 1.2.2. Muita TV corta as bordas da imagem. O vídeo vai até a borda; o texto (coluna, painel de senha, faixa de avisos, cartão da chamada, relógio, alerta, desaparecidos, a frase "Reconectando…") fica dentro de uma margem de segurança, por padrão **3%** de cada borda (da largura nos lados, da altura em cima e embaixo). Ajuste no aparelho: Ajustes e diagnóstico → **"Margem da tela (overscan)"**, que troca entre 0, 2, 3, 5 e 7% e mostra por 6 s uma moldura amarela da área segura por cima de tudo (se os cantos da moldura aparecem inteiros na TV, a margem basta). Guardado no aparelho; o contrato não tem campo para isso. O selo TESTE dos alertas simulados não usa a margem. |
| Voz | TextToSpeech do Android em pt-BR, se `queue.voice`. Sem voz em português instalada no aparelho, fica só o toque, e os ajustes mostram isso na linha "Voz da chamada". |
| TV em pé | Se a saída do aparelho já é vertical, a composição é empilhada. Se a saída é deitada e o layout é `portrait`, a composição inteira gira 90° (o lado troca nos ajustes: 90° ou 270°). |
| Alertas | Lista `alerts` do sinal de vida. Mostra em tela cheia, por cima de tudo, o de maior nível e, no empate, o de maior `id`, até o `until` ou até sair da lista. Cor por nível (azul, âmbar, vermelho), tom curto se `sound`. Ficam guardados: depois de reiniciar, o alerta ainda válido volta à tela. |
| Alertas da Defesa Civil | Contrato §9, tudo opcional. `header`: a linha de cima do alerta, em caixa alta (ex.: "ALERTA EXTREMO · DEFESA CIVIL"); sem ele, o cabeçalho de sempre (AVISO, ATENÇÃO, ALERTA). `category`: um ícone desenhado no aparelho ao lado do cabeçalho (nuvem com chuva, encosta, engrenagem, chama, cruz, escudo para `seguranca`, cone para `transito`, visto, triângulo de atenção); desconhecida ou ausente = sem ícone. `test: true`: a palavra **TESTE** fica na tela o alerta inteiro (atravessada em diagonal e em dois selos nos cantos de cima); a cor continua a do nível e o som só toca se `sound` vier ligado. |
| Desaparecidos | Contrato §8: lista `missing` do sinal de vida (até 5 casos). **Tela cheia** (`full`, `both`): por cima do layout, a foto inteira de um lado (ajustada por dentro, fundo escuro) e do outro o cabeçalho pelo tipo (CRIANÇA DESAPARECIDA, ADOLESCENTE DESAPARECIDO(A), PESSOA DESAPARECIDA, IDOSO(A) DESAPARECIDO(A)), nome, idade, "Desde dd/mm/aaaa", "Visto(a) por último", descrição e o contato em destaque no rodapé; com a TV em pé, foto em cima e texto embaixo. O vídeo segue tocando por baixo, o som não muda, sem toque nem voz. **Faixa** (`banner`, `both`): embaixo, por cima do vídeo e no lugar do texto rolante, com a miniatura, "DESAPARECIDA(O)", nome e idade, e o contato. **Ritmo** pelo relógio do aparelho: começa quando os minutos desde a meia-noite são múltiplos de `everyMin`; em `both`, tela cheia no começo do ciclo e faixa na metade; vários casos saem em sequência, sem passar de metade do ciclo (o resto fica para o ciclo seguinte, em rodízio). **Prioridade**: alerta em tela cheia > desaparecido > o resto (com alerta no ar, espera). No layout `queue` a tela cheia nunca cobre o painel de senha: vira faixa, na coluna do canal. **Foto**: baixada uma vez por https, conferida pelo sha256 e pelo tamanho (acima de 1 MB nem baixa), guardada na pasta do app, aberta já reduzida e apagada quando o caso sai da lista; sem foto conferida, uma silhueta desenhada no aparelho. Sem rede, os casos e as fotos guardados valem até o `until`. Texto que não cabe: a fonte diminui até 60% e depois o texto é cortado com reticências. |
| QR code do desaparecido | Contrato §11 (1.2.1). O caso pode trazer `qr: { data, label }`, para contato imediato pelo celular. O código é gerado no aparelho (o mesmo gerador do widget `qr`), preto sobre uma placa branca com margem, uma vez só por caso (fica guardado enquanto o caso está na lista). **Tela cheia**: no canto de baixo, junto do contato do rodapé, com 23% da altura da tela, e a frase `label` ao lado (padrão "Aponte a câmera do celular"); o texto do caso encolhe para não encostar no código. **TV em pé**: o código vai abaixo do texto, acima do rodapé, com a frase ao lado. **Faixa** (inclusive no layout `queue`): na ponta direita, na altura útil da faixa; se o código ficaria menor que 12% da altura da tela (faixa numa TV em pé), a faixa não desenha o código, só o contato. `data` só vale se começar por `https://`, `tel:+` ou `sms:+` e tiver até 300 caracteres; fora disso o caso aparece sem o código. O app **não abre nem confere** o endereço: só desenha. |
| Cartela policial | Contrato §10. O caso de `missing` pode trazer `header` (até 40 caracteres, em caixa alta): quando vem, ele entra no lugar do cabeçalho por tipo, na tela cheia e na faixa. `kind: "informacao"` é a cartela de pedido de informação da polícia ("A POLÍCIA PEDE INFORMAÇÕES", "PROCURADO PELA JUSTIÇA"): idade, data e foto podem não vir, e as linhas vazias não são desenhadas; **sem foto, o texto ocupa a largura** (sem silhueta). A descrição é desenhada como vem ("Não aborde. Ligue 190 ou 181."). Ritmo, prioridades e foto conferida valem como nos desaparecidos. O botão de pânico das repartições não chega ao app. |
| Horário | `schedule.tvOn/tvOff/days` no fuso do aparelho: fora do horário pausa o vídeo e deixa a tela preta (alerta ainda aparece). |
| Comandos | `reload`, `restart-app`, `reboot` (só nível 2; no nível 1 responde `ok=false` com o motivo), `screenshot` (JPEG de até 400 KB). |
| Guardados | Baixa `offline.items` em segundo plano, só em Wi-Fi/cabo sem franquia, continua de onde parou (`.part` + `Range`), confere tamanho e sha256, apaga o que saiu da lista e deixa 300 MB livres. Só `https://`. **sha256 que não confere apaga o arquivo**; a lista é repassada a cada 10 min e ele baixa de novo do zero. |
| Queda | App que cai é reaberto (2 s; 60 s se cair 5 vezes em 5 min). Volta também depois de atualizado. Um alarme a cada 5 min reabre a tela se ela não estiver na frente. |
| Relógio | TV box costuma ligar com a data errada. O app acerta a hora pela resposta do servidor; sem hora confiável, o horário de ligar/desligar fica em "ligada" e alertas com prazo esperam. **Data absurda (antes de novembro de 2026) derruba o https** (o certificado "ainda não é válido") e o app não consegue nem falar com o servidor: nesse caso a tela, a ativação e os ajustes dizem com todas as letras que a data do aparelho está errada, e há o botão "Data e hora do Android". Um app comum não pode acertar o relógio do aparelho. **Na partida (1.2.2)**: nos primeiros 60 s depois de ligar o aparelho ou abrir o app, relógio errado ou certificado recusado pela data aparecem como **"Carregando…"** (não é erro: o relógio costuma acertar pela rede em segundos), e o servidor e o vídeo tentam de novo a cada 2,5 s; passado o prazo, a frase curta "Acertando o relógio do aparelho… confira a internet." (na ativação, com o detalhe e o botão da data). Quando o relógio muda (aviso do Android de hora/fuso alterados, ou um salto do relógio de parede de 1 min ou mais em relação ao monotônico), servidor, senha e vídeo tentam de novo na hora. |

O app **não usa WebView**, então não precisa reiniciar quando o WebView do sistema é atualizado.

## 4. Níveis de quiosque (com os limites de cada um)

O nível em uso aparece na tela de ajustes.

| Recurso | Nível 1: só o APK | Nível 2: Device Owner |
|---|---|---|
| Abrir ao ligar, em tela cheia | Sim (como tela inicial) | Sim |
| Botão Home | Volta ao app, **se** ele foi escolhido como tela inicial "Sempre" | Volta ao app (tela inicial fixada pelo administrador) |
| Voltar, menu, volume, teclas de mídia | Bloqueados dentro do app | Bloqueados |
| Barra de status e notificações | Escondidas (tela cheia imersiva); em alguns aparelhos dá para puxar | Desligadas pelo Android |
| Sair do app | Só pela sequência + PIN **dentro do app**. Mas quem tiver acesso às configurações do Android por outro caminho (botão dedicado do controle, por exemplo) pode trocar a tela inicial | Só pela sequência + PIN (lock task) |
| Trazer o app de volta se outro app abrir | Android 7 a 9: sim (serviço confere a cada 3 s). Android 10+: **só** se a permissão "sobrepor a outros apps" for concedida; sem ela o Android recusa, e o app volta pelo Home ou ao religar | Sim |
| Modo de segurança, restauração de fábrica, novos usuários, instalar apps | Não bloqueia | Bloqueados para o usuário |
| Reiniciar o aparelho de longe | Não (responde `ok=false`) | Sim |
| Atualizar o app | O Android pergunta na tela (e pede uma vez "instalar apps desconhecidos") | Sozinho, quando há versão nova no `update` (o do servidor ou o da prefeitura) |
| Espera fora do horário | Não (tela preta) | Opcional, experimental (ver abaixo) |
| Botão físico de ligar | **Nenhum app bloqueia.** Ao religar, o app volta sozinho | Igual |

Sobre o que não dá para garantir:

- **Android 10+ no nível 1.** O sistema proíbe abrir telas a partir de segundo plano. O que funciona de forma legítima:
  ser a tela inicial (Home e a volta depois de uma queda passam por ela) e a permissão "sobrepor a outros apps"
  (botão nos ajustes ou `adb shell appops set br.com.nexatv.telas SYSTEM_ALERT_WINDOW allow`).
- **Serviço em primeiro plano.** Em alguns Android 12+ o sistema recusa ligar o serviço a partir de segundo plano; o
  app trata a recusa e o serviço liga quando a tela abre.
- **HDMI-CEC.** Não existe API pública para um app mandar a TV desligar. Fora do horário o app deixa a tela preta. No
  nível 2 há uma opção **experimental**, desligada por padrão: pôr o aparelho em espera (`lockNow`) e acordar na hora
  de ligar. Se a TV box estiver com o CEC ligado nas configurações dela, o próprio Android avisa a TV. Em espera o
  aparelho pode parar de mandar o sinal de vida e aparecer como desligado no mapa.
- **`LOCKED_BOOT_COMPLETED`.** Antes do primeiro desbloqueio os dados do app ainda estão fechados, então nesse momento
  o app só espera; em TV box sem tela de bloqueio o `BOOT_COMPLETED` vem em seguida.

## 5. Preparar o nível 2 (Device Owner), passo a passo

Feito uma vez, pelo computador, antes de levar a TV box para a unidade.

1. A TV box **não pode ter conta** cadastrada (Google ou outra). Se tiver, remova em Configurações → Contas. Em alguns
   aparelhos só funciona logo depois de uma restauração de fábrica.
2. Ligue as opções do desenvolvedor (7 toques em "Número da versão") e a depuração USB ou de rede.
3. Instale o app: `adb install -r NEXA-Telas-1.2.5-debug.apk`
4. Torne o app o administrador do aparelho:
   ```
   adb shell dpm set-device-owner br.com.nexatv.telas/.AdminReceiver
   ```
   A resposta esperada começa com `Success: Device owner set to package`.
5. Abra o app (ou reinicie o aparelho). Nos ajustes, o nível de quiosque deve aparecer como **2**. Se o aparelho
   recusar alguma trava, a lista aparece na linha "Travas recusadas pelo aparelho".
6. Desligue a depuração se o aparelho for para um lugar público.

Para desfazer: nos ajustes, **Deixar de ser o administrador do aparelho** (solta as restrições e remove o Device
Owner). O `adb shell dpm remove-active-admin` só funciona em app de teste, então use o botão.

O que o app liga no nível 2: lock task só com o próprio app e sem nenhum recurso do sistema
(`LOCK_TASK_FEATURE_NONE`), barra de status e tela de bloqueio desligadas, tela inicial fixa, tela ligada enquanto
estiver na tomada e as restrições de modo de segurança, restauração de fábrica, novos usuários e instalação de apps
de fontes desconhecidas.

## 6. Compilar

Ferramentas: JDK 21 e Android SDK (plataforma 35 e build-tools 35.0.0). O Gradle vem pelo wrapper (8.11.1, com o
`distributionSha256Sum` conferido).

```
cd android-telas
# local.properties (fora do git) com o caminho do SDK:
#   sdk.dir=C:/Projetos/nexa-ferramentas/android-sdk
set JAVA_HOME=C:\Projetos\nexa-ferramentas\jdk-21.0.13+9
gradlew.bat assembleDebug testDebugUnitTest lintDebug
```

O APK sai em `android-telas/app/build/outputs/apk/debug/app-debug.apk`.

**Para as TV box, sempre o release** (`assembleRelease`, sai em `android-telas/app/build/outputs/apk/release/app-release.apk`,
que é o padrão de `scripts/telas-app-publicar.mjs` desde a 1.3.1). O de depuração é "depurável": o Android roda sem as
otimizações e numa TV box fraca as setas e os teclados ficam lentos. Sem o `keystore.properties`, o release sai com a mesma
chave de depuração das versões já instaladas, então atualiza por cima. O `src/main/baseline-prof.txt` (perfil de compilação,
instalado pelo androidx.profileinstaller) faz o Android compilar antes o aplicativo e o tocador.

### Assinar a versão de produção

O APK de depuração serve para teste. Para distribuir, crie **uma vez** o keystore (fora do repositório, com cópia
guardada: sem ele não dá para atualizar o app instalado) e um arquivo `android-telas/keystore.properties`, também fora
do git:

```
storeFile=C:/caminho/seguro/nexa-telas.jks
storePassword=...
keyAlias=nexa-telas
keyPassword=...
```

Depois: `gradlew.bat assembleRelease`. Sem o arquivo, o release sai sem assinatura. O APK de depuração e o de produção
têm assinaturas diferentes: para trocar um pelo outro é preciso desinstalar (e refazer o Device Owner).

O tom do alerta (`res/raw/alerta.wav`) é gerado por `node scripts/gerar-tom-alerta.cjs`.

## 7. O que os testes da JVM cobrem

`gradlew.bat testDebugUnitTest` (pasta `app/src/test`), sem Android:

- configuração: leitura completa, padrões para campos ausentes, layout desconhecido, tipos errados, endereços aceitos;
- PIN: hash conhecido, conferência, bloqueio de 5 erros por 15 min, relógio que voltou no tempo;
- sequência de saída: acerto, tecla a mais, erro, pausa longa, nomes inválidos;
- alertas: nível, mais novo, vencimento, ida e volta do que fica guardado, "último aviso";
- vigia do player: avanço, travamento, 3 recargas, reserva, guardados, sem rede, volta do ao vivo, intervalo que dobra,
  classificação dos erros (voltar à ponta × recarregar), voltar à ponta sem contar para a reserva, descontinuidades,
  os dois sinais de progresso (quadros e posição: só trava com os dois parados; troca para "por posição");
- horário: dias, janela que vira a noite, minutos até ligar;
- conteúdo guardado: o que fica, baixa, apaga, parcial, falta de espaço, itens inválidos; e o download inteiro com um
  servidor de mentira (continuar de onde parou, servidor que ignora o `Range`, sha256 errado apaga e baixa de novo);
- tempo real: leitor de Server-Sent Events (eventos, `data` em várias linhas, comentários, pedaços partidos, CR/LF);
- senha: leitura do estado, chamada nova, repetição, estado do servidor, texto da fala (senha soletrada, número do
  guichê, nome), espera da reconexão;
- chamada em tela inteira (1.2.2): quando o cartão aparece (todos os layouts, senha ligada, 10 s do destaque, dentro
  do horário), chamada seguida e repetição recomeçam o prazo, o texto (guichê, "preferencial", nome só com `showName`)
  e as cores (contraste WCAG de pelo menos 7 para o texto e o rótulo sobre o amarelo);
- em atendimento (contrato §12): leitura de `serving` (ausente = servidor antigo), a atual fora da lista, até 4, a
  senha anterior que desce ao chamar outro consultório (e sai quando é o mesmo), a repetição que não mexe na lista;
- margem da tela (overscan): as margens por borda em 1080p, 720p e em pé, os valores aceitos e o ciclo do botão;
- legendas (1.2.5): leitura do `captions`, a escolha do aparelho que vale até o painel mudar, o que fica guardado, os
  nomes dos idiomas e o botão que passa pelos idiomas do fluxo;
- cor do risco (1.2.3): leitura de `risk` (só as cinco cores), a cor e o nível em palavras de cada uma, o contraste do
  texto (pelo menos 4,5 em todas), sem risco e prioritária sem risco;
- relógio na partida (1.2.2): "Carregando…" × a frase do relógio pelo tempo desde ligar/abrir e o tipo da falha, o salto do
  relógio e o certificado recusado pela data;
- cartões (tempo de cada um), clima (leitura, ícones, validade), campos novos ausentes (servidor antigo);
- layout `lbar`: leitura e o que cada layout põe na tela (faixa e coluna), inclusive `lbar` sem aviso;
- aparelho (1.2.0): relógio absurdo e a frase da tela, diferença para a hora do servidor, tradução das falhas de rede
  e de certificado, teto de resolução pelo tamanho da tela, os degraus do modo do vídeo quando o decodificador falha,
  decodificador de software pelo nome, o bloco de texto do diagnóstico;
- pessoas desaparecidas (contrato §8): leitura tolerante e limites, `until` vencido, cabeçalhos e textos, o ritmo com
  relógio injetado (começo e metade do ciclo, vários casos, rodízio, metade do ciclo como teto, cada caso no seu
  `everyMin`, `queue` vira faixa, próxima exibição), o plano das fotos e o download conferido pelo sha256 com um
  servidor de mentira;
- alertas da Defesa Civil (contrato §9): leitura tolerante de `header`, `category` e `test`, a escolha do cabeçalho e
  a prioridade, que continua pelo nível;
- QR code do desaparecido (contrato §11): os três começos aceitos, o que é ignorado (tipo errado, outro começo, mais
  de 300 caracteres) sem derrubar o caso, a frase padrão, e a conta do tamanho (tela cheia com pelo menos 22% da
  altura; faixa que só desenha o código acima de 12% da altura da tela).

A tela em si (o desenho do `lbar`, da tela cheia e da faixa dos desaparecidos, do selo TESTE, o teclado da chave, a
tela de diagnóstico) **não** tem teste automático: só foi compilada e passou no lint. Vale o que a conferência no
aparelho mostrar.

## 8. Lista de conferência no aparelho (B13)

`adb` em `C:\Projetos\nexa-ferramentas\android-sdk\platform-tools\adb.exe`. Marque cada item; nada disto foi testado.

**Instalação e partida**
- [ ] `adb install -r` instala; o app abre em tela cheia, sem barras.
- [ ] Home pergunta a tela inicial; com "Sempre", Home volta ao app.
- [ ] Reiniciar o aparelho (`adb reboot`): o app abre sozinho e toca. Anotar quantos segundos depois do boot.
- [ ] Tirar e pôr na tomada: idem.
- [ ] O app aparece na fila de apps do Android TV com a faixa (banner).

**Modo avulso**
- [ ] Digitar um HLS `https://` com o teclado da TV box (os campos aceitam foco e o teclado abre com OK).
- [ ] HLS `http://` toca neste modo.
- [ ] ↑ ↑ ↓ ↓ OK abre o PIN; números do controle e o teclado na tela funcionam; PIN certo abre os ajustes.
- [ ] 5 PINs errados bloqueiam 15 min; reiniciar o app (`adb shell am force-stop br.com.nexatv.telas`) não zera.
- [ ] Voltar, menu, volume e teclas de mídia não fazem nada enquanto toca.

**Modo gerenciado** (precisa do servidor com `/api/telas/*`)
- [ ] Chave válida ativa; chave errada mostra a mensagem do 404; servidor fora mostra "sem resposta".
- [ ] A configuração chega e o layout muda: `full`, `ticker`, `side`, `lbar`, `portrait`.
- [ ] `lbar`: o vídeo fica em cima à esquerda, a coluna (relógio, clima, QR, cartões) à direita e a faixa de avisos embaixo, de ponta a ponta, por baixo do vídeo e da coluna. Tirar todos os avisos no painel: fica igual ao `side`.
- [ ] O QR code da coluna abre o endereço certo no celular.
- [ ] Mudar a configuração no painel: o aparelho pega no próximo sinal de vida (`rev` diferente).
- [ ] Alerta `info`, `warn` e `critical`: tela cheia na cor certa, com som quando `sound`; some no `until` e ao ser encerrado.
- [ ] Reiniciar com um alerta em vigor e sem rede: o alerta volta à tela.
- [ ] Comandos: `reload`, `restart-app` (o app fecha e volta), `screenshot` (a imagem chega com o vídeo? em alguns aparelhos o vídeo sai preto), `reboot` (nível 1: `ok=false`; nível 2: reinicia).
- [ ] Revogar o aparelho no painel: volta à tela da chave.
- [ ] Desligar o aparelho da rede: toca os vídeos guardados em laço; ao voltar a rede, volta ao canal em até ~30 s.
- [ ] Endereço principal inválido com reserva válido: troca para a reserva em até ~40 s.
- [ ] `offline.items`: baixa, confere e toca; item removido do painel some do aparelho.
- [ ] `schedule`: fora do horário a tela fica preta e o vídeo para; na hora de ligar volta sozinho.
- [ ] Sinal de vida: o mapa mostra ligada; estados `playing`, `buffering`, `offline-content`.

**Vigia e quedas**
- [ ] Travar o HLS na origem (parar o canal): recarrega a cada 10 s e segue a ordem principal → reserva → guardados.
- [ ] `adb shell am crash br.com.nexatv.telas` (ou `am force-stop`): o app volta. Anotar em quanto tempo no nível 1.
- [ ] Abrir outro app por cima (`adb shell am start -a android.settings.SETTINGS`): no nível 1, o app volta sozinho? (Android 10+: só com "sobrepor a outros apps".)
- [ ] `adb install -r` de uma versão nova com o app aberto: o app reabre.

**Nível 2**
- [ ] `dpm set-device-owner` responde `Success`; os ajustes mostram nível 2 e nenhuma trava recusada.
- [ ] Home, recentes e barra de status não saem do app; `am start` de outro app é recusado.
- [ ] "Sair para as configurações do Android" abre as configurações; Home volta ao app e trava de novo.
- [ ] O teclado da TV box abre dentro do lock task (campos da ativação).
- [ ] Segurar o botão de ligar: o menu de desligar aparece? (com `LOCK_TASK_FEATURE_NONE` não deve). Desligar e ligar: o app volta.
- [ ] "Deixar de ser o administrador do aparelho" devolve o nível 1.
- [ ] Opção experimental de espera fora do horário: a TV apaga pelo CEC? O aparelho acorda na hora de ligar?

**Senha, cartões e clima (1.1.0)**
- [ ] Layout `queue`: painel grande com a senha atual e o guichê, as últimas 5, "Aguardando" e, em UPA/hospital, os contadores coloridos de risco e a espera média; o canal pequeno no canto, tocando.
- [ ] Chamar uma senha no painel: a tela destaca por 10 s, toca o aviso, o som do canal baixa e volta, e a voz fala "Senha P zero um dois, guichê três". Anotar o atraso entre o clique e a tela.
- [ ] A B13 tem voz em português? (Ajustes → linha "Voz da chamada".) Sem ela: só o toque. Se faltar, instalar os dados de voz pt-BR do "Serviços de Fala do Google" e conferir de novo.
- [ ] "Chamar de novo" (`repeat`): anuncia outra vez sem mudar a lista.
- [ ] `showName` com nome: a tela mostra e a voz fala o nome no lugar da senha.
- [ ] Senha comprida (8 caracteres) cabe na caixa; senha preferencial mostra "preferencial".
- [ ] Tirar a rede por 1 min e voltar: a linha "Chamada de senha (tempo real)" passa por "reconectando" e volta a "conectada"; o estado na tela fica igual ao do painel.
- [ ] Deixar 10 min sem chamadas: a conexão não cai (o `: ping` segura).
- [ ] Desligar `queue.enabled` no painel: o layout `queue` vira `side` e a linha do tempo real some dos ajustes.
- [ ] Widget `queue` no layout `side`: senha atual e guichê na coluna, com o destaque na chamada.
- [ ] Cartões: revezam na coluna (`side`) e abaixo das últimas senhas (`queue`), cada um pelo seu tempo; 8 linhas de 90 caracteres cabem? Em `full`/`ticker` não aparecem.
- [ ] Clima: os 6 ícones (`clear`, `cloudy`, `partly`, `rain`, `storm`, `fog`) aparecem certos; sem `weather`, o bloco some.
- [ ] Coluna lateral cheia (relógio + clima + senha + QR + cartão): tudo cabe em 1080p? E com a TV em pé?
- [ ] Alerta em tela cheia durante uma chamada: o alerta cobre a tela e a voz ainda fala.

**Cartela de fora do ar e volta do canal (1.1.0)**
- [ ] Parar o canal: a tela mostra a cartela do servidor por 10 min sem recarregar nem ir para a reserva (o "Último erro" não enche de erros do player).
- [ ] Religar o canal: a imagem volta em poucos segundos, sem passar pela reserva nem pelos vídeos guardados.
- [ ] Ajustes → linha "Vigia": "por quadros decodificados" (o esperado) ou "por posição" (o decodificador da B13 não informa os quadros; `adb logcat -s NexaTelas` mostra o aviso uma vez).
- [ ] `adb logcat | findstr /i "BehindLiveWindow PlaylistStuck"` durante a troca, para ver qual erro o player deu de fato.

**Diagnóstico e aparelho (1.2.0)**
- [ ] Ajustes → "Diagnóstico completo": o texto aparece inteiro, as setas rolam, "Congelar" para o texto e "Copiar" responde. Fotografar e guardar a foto.
- [ ] No diagnóstico: "Decodificador de vídeo" termina com "(hardware)"; "Vídeo tocando" mostra a resolução e a taxa; "Quadros perdidos" não dispara.
- [ ] "É a tela inicial (Home)": sim. Se não, o botão "Tornar o NEXA Telas a tela inicial" abre a escolha do Android.
- [ ] Chave de ativação digitada só com o controle remoto, pelo teclado da própria tela.
- [ ] Data errada de propósito (Configurações → Data e hora → desligar a automática e pôr 2015): a tela diz que a data do aparelho está errada; acertando a data, volta sozinho.
- [ ] Botão "Vídeo" nos ajustes: troca entre automático, fixo e fixo em 720p, e o vídeo recarrega.

**Alertas da Defesa Civil (1.2.0)**
- [ ] Alerta severo (`warn`): âmbar, com "ALERTA SEVERO · DEFESA CIVIL" em cima e o ícone da categoria ao lado.
- [ ] Alerta extremo (`critical`): vermelho, com "ALERTA EXTREMO · DEFESA CIVIL", ícone e som (se ligado).
- [ ] Alerta de teste: a palavra TESTE atravessada e nos dois cantos de cima o tempo todo; o texto do alerta ainda dá para ler; sem som se o som não foi ligado.
- [ ] Alerta comum do painel (sem os campos novos): igual a antes (AVISO, ATENÇÃO ou ALERTA, sem ícone).

**Pessoas desaparecidas (1.2.0)**
- [ ] Caso `full`: no minuto múltiplo de `everyMin` a tela cheia entra com a foto inteira (sem cortar o rosto), o cabeçalho certo para o tipo, nome, idade, "Desde", "Visto(a) por último", descrição e o contato no rodapé; fica `fullSec` segundos e sai. O som do canal não muda.
- [ ] Caso `banner`: a faixa entra embaixo com a miniatura, nome, idade e contato; nos layouts `ticker`, `lbar` e `portrait` ela fica no lugar do texto rolante.
- [ ] Caso `both`: tela cheia no começo do ciclo e faixa na metade.
- [ ] Layout `queue`: nunca aparece tela cheia; a faixa fica na coluna do canal e o painel de senha continua inteiro. Chamar uma senha durante a faixa: destaque e voz normais.
- [ ] Encerrar o caso no painel: some da tela no próximo sinal de vida.
- [ ] Caso sem foto (ou com a foto fora do ar): aparece a silhueta.
- [ ] TV em pé (`portrait`): foto em cima, texto embaixo.
- [ ] Nome e descrição no tamanho máximo: o texto diminui e, se não couber, termina com reticências; nada fica por cima de nada.
- [ ] Alerta em tela cheia no ar: os desaparecidos não aparecem; voltam depois.
- [ ] Duas telas no mesmo prédio: a exibição entra junto nas duas (diferença de 1 a 2 segundos é normal).
- [ ] Sem rede: os casos já recebidos continuam aparecendo, com a foto.
- [ ] Ajustes: linha "Desaparecidos" com os casos, as fotos guardadas e a próxima exibição.

**Chamada em tela inteira, em atendimento e margem da tela (1.2.2)**
- [ ] Layout `ticker` ("Vídeo + avisos"): Chamar próxima → a tela inteira fica amarela com a senha, o consultório e, com "mostrar o nome", o nome; some depois de 10 s.
- [ ] O mesmo em `full`, `lbar`, `portrait`, `side` (com e sem o widget de senha) e `queue`.
- [ ] Duas chamadas seguidas: o cartão troca para a mais nova e fica mais 10 s. Repetir: volta por 10 s.
- [ ] Alerta em tela cheia no ar durante a chamada: o alerta fica por cima do cartão.
- [ ] Coluna e painel: nada fica amarelo nem pisca; a senha atual, o consultório e o nome legíveis a 4 metros.
- [ ] Chamar A no Consultório 1 e B no Consultório 2: A aparece embaixo de B ("em atendimento"). Finalizar A no painel: A sai da tela em 1 a 2 s.
- [ ] Coluna lateral mais estreita: relógio, data, senha e QR inteiros; nada cortado na borda da TV.
- [ ] Ajustes → "Margem da tela (overscan)": a moldura amarela aparece; escolher o menor valor em que os cantos da moldura aparecem inteiros na TV.
- [ ] Ligar a TV box da tomada: até o relógio acertar aparece só "Carregando…" (nenhuma mensagem de data errada) e o vídeo entra sozinho.

**Cor do risco na chamada (1.2.3)**
- [ ] UPA/hospital com a classificação ligada: chamar uma senha de cada cor; o cartão em tela inteira fica da cor certa, com o nível escrito no alto e o texto legível a 4 metros.
- [ ] Senha sem cor (antes da triagem): o amarelo com "SENHA"; prioritária sem cor: "PREFERENCIAL" no alto.
- [ ] Coluna e painel: a bolinha da cor ao lado da senha atual e das que estão em atendimento.

**QR code no card de desaparecido (1.2.1, contrato §11)**
- [ ] Tela cheia de um caso com `qr`: o código aparece no canto de baixo, à direita, numa placa branca, com a frase ao lado; o nome, a descrição e o contato não encostam nele.
- [ ] **O celular lê o QR da tela cheia a 3 metros** (câmera comum, sem zoom). Anotar a que distância deixa de ler, e com que tipo de endereço (um link curto do WhatsApp lê de mais longe que um endereço comprido).
- [ ] O que o celular abre é o endereço do painel (WhatsApp, ligação ou SMS). A TV box não abre nada.
- [ ] **Faixa com QR** (tela deitada): o código na ponta direita da faixa, e o celular lê de perto (1 a 2 metros).
- [ ] Layout `queue`: a faixa na coluna do canal com o código; conferir se o nome ainda dá para ler ao lado.
- [ ] TV em pé (`portrait`): na tela cheia o código fica abaixo do texto; na faixa não há código, só o contato.
- [ ] Caso sem `qr`: tudo como antes. Ajustes → linha "Desaparecidos" mostra "N com QR code".

**Segurança pública (1.2.0, contrato §10)**
- [ ] Alerta com categoria `seguranca`: o escudo ao lado do cabeçalho ("ALERTA · GUARDA MUNICIPAL"). Categoria `transito`: o cone.
- [ ] Caso de desaparecido com `header` próprio: o texto do servidor aparece no lugar de "CRIANÇA DESAPARECIDA" na tela cheia e no lugar de "DESAPARECIDA(O)" na faixa.
- [ ] Cartela "A POLÍCIA PEDE INFORMAÇÕES" sem foto, sem idade e sem data: o texto ocupa a largura da tela, sem linhas vazias e sem silhueta; a frase "Não aborde. Ligue 190 ou 181." aparece inteira.
- [ ] A mesma cartela com foto: foto de um lado, texto do outro, como nos desaparecidos.

**Imagem e som**
- [ ] Vídeo fluido em 1080p (sem engasgos na B13); proporção certa; áudio sai pelo HDMI.
- [ ] `portrait` com a saída deitada: a composição gira; trocar 90°/270° nos ajustes; o vídeo continua fluido (usa TextureView).
- [ ] A faixa de avisos rola sem tremer; a velocidade `ticker.speed` parece adequada.
- [ ] 24 h ligado sem travar nem vazar memória (`adb shell dumpsys meminfo br.com.nexatv.telas`).

## 9. Interpretações do contrato (fechadas com o servidor, §6 do contrato)

1. **`sha256(salt + pin)`**: o app junta o `pinSalt` (o texto hex, não os bytes) com o PIN e faz o sha256 em UTF-8.
2. **`If-None-Match`**: o app manda o `rev` puro, sem aspas.
3. **"Mais novo" nos alertas**: não há data no alerta; o app usa o maior `id`.
4. **`schedule.days`**: 0 = domingo … 6 = sábado (7 também vale como domingo), no fuso do aparelho. Lista vazia =
   todos os dias. Janela que vira a noite pertence ao dia em que começa.
5. **`ticker.speed`**: dp por segundo, de 20 a 200 (60 ≈ 120 px/s numa saída 1080p).
6. **`net`**: só há `wifi | ethernet | none`; outro tipo de rede com internet é informado como `wifi`.
7. **Erros**: o app lê `error` e `code` do JSON. Só o 401 apaga o token; 403 com `code: "unavailable"` mantém tudo e
   tenta de novo depois. Cada comando chega uma vez só (o app nunca contou com reenvio). Na captura, 413, 415 e 429
   só viram resposta `ok=false` ao comando; o app confere antes que o JPEG termina em `FF D9` e tem até 400 KB.
8. **"Último alerta" na coluna lateral**: o alerta em vigor já cobre a tela inteira, então a coluna mostra por 30 min
   o último alerta que terminou no `until`; alerta encerrado antes da hora some.
9. **Atualização do app**: campo opcional `update: { url, sha256, versionCode }` no `/config`, só `https`. O app baixa,
   confere o SHA-256 e instala (sozinho no nível 2; no nível 1 o Android pergunta na tela). O APK precisa ter a
   mesma assinatura do instalado.
10. **`offline.items`**: só vídeos (o que o ExoPlayer toca); imagens ficam para depois. Não há "baixar de madrugada"
    no contrato; o app baixa quando a rede não tem franquia.
11. **Serial do aparelho**: o campo `device.serial` é opcional e o app não manda (o Android não entrega o serial a
    apps comuns).

### Fases 3 e 4 (§7 do contrato): como o app leu (fechado com o servidor no §7.3)

1. **`last` e a senha atual**: se a atual vier repetida em `last`, o app tira (não mostra a mesma senha duas vezes).
2. **Evento `call` com o mesmo `id` e sem `repeat`** (entrega repetida ao reconectar): nada muda e nada é anunciado.
3. **Chamada perdida enquanto o aparelho estava sem conexão**: ao reconectar o GET traz a senha atual, que aparece na
   tela **sem** toque nem voz (não anuncia atrasado).
4. **Evento `state`**: o app troca o estado inteiro (senha atual, últimas e espera), não só `waiting`.
5. **`byRisk`**: mostrado sempre na ordem vermelho, laranja, amarelo, verde, azul; chave desconhecida vai para o fim, em cinza.
6. **Fala**: letras e algarismos da senha um a um ("P zero um dois"); número do guichê por extenso até 99 ("guichê doze"),
   acima disso algarismo por algarismo. Senha preferencial não muda a fala (só a tela mostra "preferencial").
7. **`weather`**: aparece quando `weather` existe **e** `weather` está em `side.widgets`. Ícone fora dos 6 nomes vira
   nuvem. Sem `tempC` e sem `condition`, o bloco some. A validade de 3 h é do app (o contrato não fala).
8. **`cards`**: `seconds` ausente = 10; limites do app de 3 a 120 s. No layout `portrait` os cartões aparecem como no `side`.
9. **Layout `queue` com a TV em pé**: painel em cima e o canal embaixo.
10. **401/403 no tempo real**: quem trata é o sinal de vida (apaga o token no 401); o tempo real só tenta de novo.
11. **Widget `queue` no layout `queue`**: ignorado na coluna (a senha já está no painel).

### Pessoas desaparecidas e alertas da Defesa Civil (§8 e §9 do contrato): como o app leu

1. **`missing` ausente** = lista vazia: os casos guardados somem. Caso sem `id` (inteiro maior que zero) ou sem `name`
   é ignorado; `id` repetido vale o primeiro. `kind` desconhecido = `adulto` ("PESSOA DESAPARECIDA"). `show`
   desconhecido ou ausente = `both`.
2. **Limites**: `fullSec` 8 a 60 (padrão 15), `bannerSec` 8 a 120 (padrão 20), `everyMin` 2 a 60 (padrão 10). Zero,
   negativo ou o que não é número = o padrão; fora da faixa = a ponta da faixa.
3. **`until`**: 0 ou ausente = sem prazo. O prazo é comparado com a hora acertada pelo servidor; num aparelho sem hora
   confiável (nunca falou com o servidor e está com a data absurda) só aparecem os casos sem prazo.
4. **Ciclo com casos de `everyMin` diferentes**: o ciclo do aparelho é o menor `everyMin` da lista; um caso entra num
   ciclo quando um múltiplo do `everyMin` dele cai dentro desse ciclo. Com o mesmo `everyMin` em todos, é a regra do
   contrato ao pé da letra.
5. **Caso `banner` (só faixa)**: a faixa sai no começo do ciclo, na vez dele na ordem da lista. A faixa da metade do
   ciclo é só a dos casos `both`.
6. **Teto de metade do ciclo**: vale para cada bloco (o do começo e o da metade). Uma exibição mais comprida que
   metade do ciclo é encurtada para caber. No rodízio, o bloco começa um caso adiante a cada ciclo.
7. **Layout `queue`**: `full` vira faixa no começo do ciclo, pelo `bannerSec`; `both` vira faixa no começo e na
   metade. Com o painel deitado, a faixa fica na coluna da direita, embaixo do canal.
8. **Foto**: `bytes` é obrigatório e vai de 1 a 1.048.576; fora disso, ou sem `https`, ou com `sha256` malformado, o
   caso é mostrado com a silhueta e nada é baixado. Download que falha é tentado de novo depois de 2 minutos; foto
   que não confere, depois de 30. A posição da foto no EXIF é respeitada.
9. **Alerta, `header`**: só vale texto (número, lista ou objeto = ausente); quebras de linha viram espaço; cortado em
   60 caracteres; desenhado em caixa alta. **`test`**: só `true` de verdade liga (o texto "true" não). **`category`**
   fora da lista = sem ícone.
10. **`missing[].header` (§10)**: só vale texto; cortado em 40 caracteres e posto em caixa alta. Na faixa ele entra
    inteiro no lugar de "DESAPARECIDA(O)" (diminui até caber e, no limite, termina com reticências).
11. **`kind: "informacao"` sem `header`**: o app usa "A POLÍCIA PEDE INFORMAÇÕES" na tela cheia e "PEDIDO DE
    INFORMAÇÕES" na faixa. Sem foto no caso (`photo: null`), o texto ocupa a largura; se a foto existe mas não baixou
    ou não conferiu, aparece a silhueta, como nos outros casos.
12. **`missing[].qr` (§11)**: `data` com mais de 300 caracteres é **recusado**, não cortado (um endereço cortado
    viraria um código que leva a outro lugar); também é recusado com espaço ou quebra de linha no meio, ou só com o
    começo (`https://` sem mais nada). O começo é aceito em maiúsculas ou minúsculas e o conteúdo vai para o código
    como veio. `label` só vale como texto, cortado em 40 caracteres. Na tela cheia o código tem 23% da altura da tela;
    com a TV em pé ele é limitado a 45% da largura (numa tela muito estreita pode ficar abaixo dos 22% da altura). A
    margem branca é a completa do padrão (4 módulos) mais a placa branca.

## 10. Teste na TV box com Android 11

Roteiro para o primeiro teste num aparelho de verdade. O app nunca rodou numa TV box: tudo abaixo é o que se espera,
e o objetivo do teste é anotar o que acontece de fato. **Antes de reclamar de qualquer coisa, fotografe a tela de
diagnóstico (10.5)**: ela responde a maior parte das perguntas.

O arquivo: `NEXA-Telas-1.2.5-debug.apk`. Serve para TV box de 32 e de 64 bits.

### 10.1 Instalar pelo pendrive

1. No computador, copie o APK para um pendrive (formatado em FAT32 ou exFAT).
2. Ligue a TV box, conecte na rede (Wi-Fi ou cabo) e **confira a data e a hora** em Configurações → Data e hora. Se
   estiver errada, ligue "data e hora automáticas" ou acerte na mão. Com a data errada nada funciona (ver 10.7).
3. Espete o pendrive. Abra o gerenciador de arquivos da TV box (costuma se chamar "Arquivos", "File Manager",
   "Gerenciador de arquivos" ou "AppInstaller").
4. Entre no pendrive e aperte OK em cima do APK.
5. Na primeira vez o Android 11 avisa que aquele gerenciador de arquivos não pode instalar apps. Escolha
   **Configurações** nesse aviso e ligue **"Permitir desta fonte"**. Volte (tecla Voltar) e confirme **Instalar**.
   Se o aviso não oferecer o atalho: Configurações → Apps → Acesso especial a apps → Instalar apps desconhecidos →
   escolha o gerenciador de arquivos → ligar.
6. Se aparecer a pergunta do Play Protect ("Enviar app para verificação?"), responda **Não enviar** e **Instalar
   assim mesmo**. Muita TV box nem tem isso.
7. Terminou: escolha **Abrir**.

Se o gerenciador de arquivos da box não abrir APK, use o adb (10.2).

### 10.2 Instalar pelo computador (adb)

O `adb` está em `C:\Projetos\nexa-ferramentas\android-sdk\platform-tools\adb.exe`.

1. Na TV box: Configurações → Sobre (ou "Preferências do dispositivo → Sobre") → aperte OK **7 vezes** em "Número
   da versão" (ou "Compilação") até aparecer "Você agora é um desenvolvedor".
2. Em Configurações → Opções do desenvolvedor, ligue **Depuração USB**. Se houver "Depuração pela rede" (ou "ADB
   pela rede"), ligue também.
3. Veja o IP da TV box em Configurações → Rede (algo como `192.168.0.57`). O computador tem de estar na mesma rede.
4. No computador, no Prompt de Comando:
   ```
   cd C:\Projetos\nexa-ferramentas\android-sdk\platform-tools
   adb connect 192.168.0.57:5555
   adb devices
   ```
   Na TV aparece "Permitir a depuração?": marque "Sempre permitir" e OK. O `adb devices` tem de mostrar o IP com a
   palavra `device` (não `unauthorized` nem `offline`).
5. Instale (o `-r` mantém os dados se o app já estava instalado):
   ```
   adb install -r "C:\Users\mikro\Downloads\nexa-telas-1.2.5-<código>\NEXA-Telas-1.2.5-debug.apk"
   ```
   A resposta esperada é `Success`.
6. Abra o app pelo controle remoto ou com:
   ```
   adb shell am start -n br.com.nexatv.telas/.MainActivity
   ```

Se o `adb connect` responder "recusada" e a box não tiver a opção de depuração pela rede: ligue a box ao computador
por um cabo USB macho-macho na porta USB que o manual indicar (em muitas é a USB 2.0 mais perto do canto) e rode
`adb tcpip 5555`, depois o `adb connect`. Sem cabo e sem a opção, fique no pendrive.

Para ver o que o app está dizendo durante o teste: `adb logcat -s NexaTelas AndroidRuntime`.

### 10.3 Primeira abertura

1. **Escolha do modo**: "Com a chave do painel da prefeitura".
2. **Ativação**: no Painel da Prefeitura, em Repartições, gere a chave de acesso da tela (8 letras e números, vale
   uma vez e por 24 h). Na TV, o endereço do servidor já vem preenchido. Digite a chave com o **teclado da própria
   tela**: setas para andar, OK em cada letra, "Apagar" para corrigir. Depois desça até **Ativar** e aperte OK.
   - "Chave inexistente, já usada ou vencida": gere outra no painel.
   - "Sem resposta do servidor: o aparelho não achou o servidor": a rede está fora. Use o botão "Configurações do
     Android (rede Wi-Fi)".
   - "Sem resposta do servidor: certificado de segurança recusado…": a data do aparelho está errada (10.7).
3. O canal começa a tocar. Aparece o layout que o painel mandou.
4. **Tela inicial (o mais importante)**: aperte o botão **Home** (a casinha) do controle. O Android pergunta qual app
   usar como tela inicial: escolha **NEXA Telas** e **Sempre**. É isso que faz o app abrir sozinho quando a TV box
   liga. No Android 11 **não existe outra forma** sem o Device Owner: o sistema não deixa um app comum abrir sozinho
   depois do boot.
   - Se o Home não perguntar nada e for direto para a tela da box: entre nos ajustes do app (item 5) e use o botão
     **"Tornar o NEXA Telas a tela inicial"**. Se também não resolver, procure em Configurações → Apps → Apps padrão
     → App de início (ou "Tela inicial"). Há TV box em que o fabricante prendeu o botão Home na tela dele: nessas, só
     o Device Owner (10.4) resolve.
5. **Abrir os ajustes do app**: no controle, **↑ ↑ ↓ ↓ OK** e o PIN definido no painel para a repartição. Confira e
   conceda, nesta ordem (cada botão some depois de concedido):
   - **Tornar o NEXA Telas a tela inicial**, se ainda aparecer.
   - **Permitir que o app volte sozinho para a frente (sobrepor a outros apps)**: abre uma tela do Android; ache
     "NEXA Telas" e ligue. Com isso o app volta sozinho se outro app abrir por cima e também abre no boot mesmo sem
     ser a tela inicial. Muita TV box não tem essa tela; aí, pelo computador:
     `adb shell appops set br.com.nexatv.telas SYSTEM_ALERT_WINDOW allow`
   - **Tirar o app da economia de bateria**: responda "Permitir". Em TV box é comum a tela nem existir; não faz
     falta.
   - Depois de cada um, aperte **Home** para voltar ao app (ou espere: ele volta sozinho em até 10 minutos).
6. Nos ajustes, confira as linhas: "Tela inicial (Home): é o NEXA Telas", "Nível de quiosque", "Relógio" (com a hora
   certa) e "Último sinal de vida" (com hora de agora).
7. **Teste do boot**: tire a TV box da tomada, espere 10 segundos e ligue de novo. O app tem de abrir sozinho e
   tocar. Anote quantos segundos leva.

O app não pede nenhuma permissão em janela (não usa câmera, microfone, arquivos nem localização). As únicas coisas a
conceder são as três acima.

### 10.4 Device Owner (nível 2): travar de verdade

Opcional no primeiro teste. Faça depois que o nível 1 estiver funcionando. Com o Device Owner o app passa a mandar no
aparelho: Home, recentes e barra de status deixam de sair do app, ele abre no boot sem depender de escolha nenhuma,
reinicia o aparelho de longe e se atualiza sozinho.

Pré-requisitos (o Android recusa se faltar um):

- **Nenhuma conta no aparelho.** Configurações → Contas: remova a conta Google e qualquer outra. Se a box nunca teve
  conta, melhor.
- Nenhum outro "administrador do dispositivo" ativo e só um usuário no aparelho.
- App já instalado e depuração ligada (10.2).

Comando, no computador:

```
adb shell dpm set-device-owner br.com.nexatv.telas/.AdminReceiver
```

- Resposta boa: `Success: Device owner set to package br.com.nexatv.telas`.
- `Not allowed to set the device owner because there are already some accounts on the device`: ainda há conta.
  Remova e tente de novo. Se não houver conta à vista, faça a restauração de fábrica, **não** entre com conta
  nenhuma, instale o app e rode o comando antes de qualquer outra coisa.
- `Not allowed to set the device owner because there are already several users on the device`: apague os outros
  usuários em Configurações → Usuários.
- `Unknown admin` ou `ComponentInfo ... not found`: o app não está instalado.

Depois: abra o app (ou reinicie a box). Nos ajustes, "Nível de quiosque" tem de dizer **2**. Se aparecer a linha
"Travas recusadas pelo aparelho", anote o que está escrito nela.

**Como desfazer**: nos ajustes do app, **"Deixar de ser o administrador do aparelho"** (aperte duas vezes). Isso
solta as travas e tira o Device Owner. **Use o botão**: o comando `adb shell dpm remove-active-admin` só funciona
em APK marcado como "só de teste", e este não é.

Enquanto o app for Device Owner, o Android **não deixa desinstalar** (nem pelo `adb uninstall`). Desfaça primeiro.
Se tudo der errado, a restauração de fábrica pelo modo de recuperação da box (botão escondido, em geral dentro do
furo do P2/AV, segurado ao ligar) apaga tudo.

### 10.5 Tela de diagnóstico

Ajustes (↑ ↑ ↓ ↓ OK + PIN) → **Diagnóstico completo (texto para fotografar)**. As setas ↓ e ↑ rolam o texto.
"Congelar o texto" para os números de mexer na hora da foto. Tire a foto com o vídeo tocando há pelo menos um minuto.

O que tem lá e o que é o esperado:

| Linha | Esperado |
|---|---|
| Modelo, Android, Processador (ABIs), Memória, Espaço livre | Android 11 (API 30). ABIs: `armeabi-v7a` (32 bits) ou `arm64-v8a` primeiro (64 bits). |
| Tela (saída) / Tela (área do app) | 1920×1080 a 60 Hz. Muita box desenha os apps em 1280×720 mesmo com a saída em 1080p: não é defeito, mas o vídeo fica limitado a 720p. |
| É a tela inicial (Home) | sim |
| Device Owner (nível 2) | não, até fazer o 10.4 |
| Sobrepor a outros apps / Volta sozinho para a frente | concedida / sim |
| Instalar atualização, Economia de bateria, Notificações | informativo |
| Player | tocando · canal principal |
| Decodificador de vídeo | um nome com `amlogic`, `rk`, `allwinner`, `hisi`, `mtk`… e **(hardware)**. Se disser **SOFTWARE**, o aparelho não tem decodificador de H.264 que preste: vai engasgar em 1080p; ponha o vídeo em "fixo em 720p". |
| Vídeo tocando | 1920×1080 (ou 1280×720), a taxa em Mbit/s |
| Quadros perdidos | perto de zero e parado. Subindo sem parar = aparelho não dá conta. |
| Erros de decodificador | 0 |
| Som tocando | 2 canais |
| Vigia | por quadros decodificados |
| Última tentativa de sinal de vida | hora de agora + "respondido (HTTP 200)" |
| Desaparecidos | casos, fotos guardadas, próxima exibição |
| Hora do aparelho × Hora do servidor | "igual à do servidor" ou poucos segundos |
| Voz em português (pt-BR) | "voz em português instalada". Se não, a chamada de senha toca só o aviso sonoro (ver 10.7). |
| Último erro | vazio |

### 10.6 Lista de conferência do primeiro teste

Na ordem. O resto (a lista comprida) está na seção 8.

- [ ] Instalou (pendrive ou adb) e abriu em tela cheia, sem barras.
- [ ] Ativou com a chave digitada só com o controle remoto.
- [ ] O canal toca, com som pelo HDMI, sem engasgar por 10 minutos.
- [ ] Home → NEXA Telas → Sempre. Home de novo volta ao app.
- [ ] Tirar da tomada e ligar: o app abre sozinho. Tempo: ____ s.
- [ ] ↑ ↑ ↓ ↓ OK abre o PIN; o PIN abre os ajustes; dá para andar por todos os botões com as setas e ver onde está o foco (o botão focado fica azul com borda branca).
- [ ] Foto da tela de diagnóstico (10.5).
- [ ] No painel, trocar o layout para cada um e olhar: `full`, `ticker`, `side`, **`lbar`** (vídeo + coluna à direita + faixa embaixo de ponta a ponta), `portrait`, `queue`.
- [ ] Alerta do painel: tela cheia na cor certa; alerta de **teste** com a palavra TESTE.
- [ ] Pessoa desaparecida de teste (dados inventados): tela cheia no minuto certo, faixa na metade do ciclo.
- [ ] O mesmo caso com QR code: o celular lê o código da tela cheia a 3 metros.
- [ ] Chamar uma senha: destaque, toque e voz.
- [ ] Tirar o cabo de rede/Wi-Fi por 2 minutos e devolver: a tela avisa, toca os vídeos guardados (se houver) e volta ao canal.
- [ ] Deixar ligado de um dia para o outro: ainda tocando, e o diagnóstico sem erros novos.
- [ ] (Opcional) Device Owner: `Success`, nível 2, Home e recentes não saem do app; desfazer pelo botão.

### 10.7 Se der errado

**Tela preta (com ou sem som)**
1. Espere 15 segundos: aparece um aviso embaixo ("Reconectando ao canal…", "Sem rede…" ou a data errada)?
2. Ajustes → "Testar o canal". Se disser "Principal: NÃO respondeu", o problema é a rede ou o endereço, não a box.
3. Se o canal responde e a tela continua preta com som: é o decodificador. Ajustes → botão **"Vídeo"** → "fixo em
   720p". Fotografe o diagnóstico (linhas "Decodificador de vídeo" e "Erros de decodificador").
4. Preto só no layout `portrait` com a tela deitada (composição girada): anote; nesse caso o app usa outro tipo de
   superfície (TextureView), que alguns aparelhos não aceleram.
5. Fora do horário de funcionamento a tela fica preta de propósito: os ajustes dizem "fora do horário".

**Sem som**
1. Volume da TV. O app põe o volume da TV box no máximo sozinho; quem manda no volume é o painel.
2. No painel, o canal está com "mudo" ou volume 0? (Ajustes → "Recarregar a configuração e o vídeo".)
3. No Android da box: Configurações → Som → saída de áudio em **PCM** (ou "estéreo"). Em "passagem direta",
   "bitstream" ou "auto", algumas TVs ficam mudas.
4. Diagnóstico → "Som tocando: 2 canais". Se mostrar 6 canais, avise: o app deveria ter ficado na trilha estéreo.
5. Sem voz na chamada de senha, mas com o toque: falta a voz em português. Instale "Serviços de Fala do Google"
   (ou outro mecanismo de voz) e baixe os dados de português do Brasil em Configurações → Acessibilidade →
   Conversão de texto em voz. TV box sem a loja do Google pode não ter como: fica só o toque.

**Não abre sozinho ao ligar**
1. Ajustes → linha "Tela inicial (Home)". Se não for o NEXA Telas, é isso: refaça o passo 4 do 10.3.
2. O app foi aberto pelo menos uma vez depois de instalado? Sem isso o Android não avisa o app do boot.
3. Dê a permissão "sobrepor a outros apps" (10.3, item 5), pela tela ou pelo comando `adb shell appops set
   br.com.nexatv.telas SYSTEM_ALERT_WINDOW allow`, e teste de novo.
4. Procure nas configurações da box algo como "Início automático", "Apps na inicialização" ou "Gerenciador de
   inicialização" e libere o NEXA Telas. Fabricante de TV box costuma ter um bloqueio próprio.
5. Nada resolveu: Device Owner (10.4). Com ele o Android abre o app no boot sem depender de mais nada.

**Trava ao mudar de resolução (congela, pisca ou fica preto de tempos em tempos)**
1. É o decodificador do aparelho que não aguenta a troca de qualidade do vídeo adaptativo. O app percebe sozinho
   depois de dois erros em 10 minutos e passa para "fixo"; o "Último erro" avisa.
2. Para forçar já: Ajustes → botão **"Vídeo"** → "fixo na melhor qualidade". Se ainda travar: "fixo em 720p".
3. Fotografe o diagnóstico antes e depois. As linhas "Erros de decodificador" e "Quadros perdidos" dizem se melhorou.
4. Congelamento **sem** erro (a imagem para e volta sozinha em uns 10 segundos, com "Reconectando…"): aí é rede. Teste
   com cabo no lugar do Wi-Fi.

**Erro de certificado / "a data deste aparelho está errada"**
1. TV box não tem bateria de relógio: ao ligar, acha que é 2015 (ou 1970) até conseguir a hora pela rede. Com a data
   errada o endereço seguro (https) é recusado e o app não fala com o servidor nem toca o canal.
2. Ajustes → **"Data e hora do Android"** (ou, na ativação, "Abrir data e hora do Android"). Ligue **"Data e hora
   automáticas"** / "Usar horário da rede". Confira o **fuso**: Brasília (GMT-03:00).
3. Se a automática não acerta (rede que bloqueia o servidor de hora): acerte na mão. Vai se perder de novo quando
   faltar luz; nesse caso peça à TI para liberar o NTP (porta 123 UDP) ou use outra rede.
4. Data certa e o erro de certificado continua: a rede pode exigir login num navegador (Wi-Fi de visitante) ou ter
   um filtro que troca o certificado. Teste com o celular como roteador. O app só confia nos certificados do próprio
   Android, de propósito.

**Outros**
- **"Chave inexistente, já usada ou vencida"**: cada chave vale uma vez. Gere outra.
- **O teclado do Android cobre o campo ou não obedece às setas**: use o teclado da própria tela do app (ativação) ou
  ligue um teclado USB. No modo avulso (endereço digitado) o teclado USB é o caminho mais curto.
- **Ficou preso nas configurações do Android**: aperte Home; ou espere 10 minutos, que o app volta.
- **Quero sair do app para mexer na box**: ↑ ↑ ↓ ↓ OK, PIN, "Sair para as configurações do Android (10 min)".
- **Desinstalar**: Configurações → Apps → NEXA Telas → Desinstalar, ou `adb uninstall br.com.nexatv.telas`. Se for
  Device Owner, desfaça antes (10.4). Depois de desinstalar, escolha de novo a tela inicial da box.

### 10.8 O que foi conferido para o Android 11 (por leitura do código e pelo APK, sem aparelho)

- **Versões**: `minSdk` 24, `targetSdk` 35, `compileSdk` 35. O lint (`NewApi`) passa: toda API acima da 24 tem guarda
  de versão. Tela cheia pelo `WindowInsetsController` (API 30) **e** pelas marcas antigas ao mesmo tempo. Nenhum
  `registerReceiver` em código. `PendingIntent` dos alarmes imutável; o da atualização só é mutável do Android 12 em
  diante (no 11 é o padrão). A permissão de notificação (Android 13) e o tipo do serviço em primeiro plano (Android
  14) estão declarados e não afetam o 11.
- **Boot**: recebe `BOOT_COMPLETED`, `LOCKED_BOOT_COMPLETED` e `QUICKBOOT_POWERON`. No Android 10+ o receptor liga o
  serviço, mas abrir a tela depende de ser a tela inicial, de "sobrepor a outros apps" ou do Device Owner.
- **Tela inicial**: categorias `HOME` + `DEFAULT`, `LAUNCHER` e `LEANBACK_LAUNCHER`; faixa (banner) declarada;
  `leanback`, `touchscreen` e `wifi` como não obrigatórios. Serve em Android TV e em Android "de tablet".
- **Rede**: o servidor e o vídeo do modo gerenciado só por `https` (conferido no código). O `http` fica liberado na
  configuração de rede só por causa do modo avulso (endereço digitado no aparelho). Só certificados do sistema;
  nenhum certificado instalado pelo usuário é aceito. Let's Encrypt funciona no Android 11.
- **Armazenamento**: vídeos guardados, fotos e a atualização baixada ficam na pasta privada do app; nenhuma
  permissão de armazenamento. Atualização pelo instalador de pacotes do Android; no nível 1 o Android 11 pergunta na
  tela e pode fechar o app ao liberar "instalar apps desconhecidos" (ele volta sozinho).
- **Controle remoto**: todos os botões e campos recebem foco e mostram o foco; Voltar fecha a tela do app (e o
  teclado, se aberto); PIN com teclado próprio e pelas teclas de número; chave de ativação com teclado próprio.
- **Voz**: o manifesto declara a consulta ao serviço de voz (obrigatória desde o alvo 30). Sem voz em português, só
  o toque, e os ajustes dizem.
- **Vídeo**: decodificador com queda para o seguinte, teto pelo tamanho da tela, só estéreo, modos fixos.
- **Relógio**: aviso claro de data errada na tela, na ativação e nos ajustes.
- **Energia**: tela sempre ligada, `WifiLock` de alto desempenho, pedido de isenção da economia de bateria.

