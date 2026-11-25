# App da TV box (Android)

Pasta `android/`. App nativo (Kotlin), white-label, que transforma uma TV box em tela de sinalização. Veio do app que já
existia no outro produto do dono (a versão 1.3.1) e foi adaptado em 22/11/2026.

- Pacote (`applicationId` e `namespace`): **`br.com.digitalisp.telas`** · versão **0.2.0** (versionCode 2) · Android 7.0+.
- Nome no aparelho: **"DIGITAL ISP"**, com o logo da DIGITAL ISP no ícone e na faixa do Android TV (decisão do dono de
  23/11/2026; antes era o nome neutro "Telas"). Vetores feitos a partir de `marca/svg/icone.svg` e
  `marca/svg/logo-horizontal-fundo-escuro.svg`.
- **White-label:** na tela só aparece o conteúdo. A logo da revenda aparece na abertura, no cadastro e na imagem sem
  internet. Um APK só para todas as revendas: a marca vem do servidor. O contrato: [CONTRATO-APP-MARCA.md](CONTRATO-APP-MARCA.md).
- Os detalhes de funcionamento herdados (quiosque, vigia, modo avulso, testes na TV box) continuam descritos em
  [origem-nexa/TELAS-APP.md](origem-nexa/TELAS-APP.md); os nomes de lá mudaram (o app agora é "DIGITAL ISP" e a chave de
  ativação é o "código de cadastro").

## O que mudou em relação ao app de origem

| | |
|---|---|
| Mantido | pessoas desaparecidas (`missing`, do modo órgão público; tiradas em 22/11 e devolvidas na 0.3.3), abre sozinho ao ligar, quiosque (níveis 0 a 2), vigia que reinicia o vídeo travado, atualização automática pelo campo `update` do `/config`, vídeos guardados e funcionamento sem internet, imagem sem internet (`offline.image`), chamada de senha com voz (opcional), alertas, TV Corporativa (zonas), modo avulso, recuperação depois de reinstalar |
| Novo | a marca da revenda (abertura, cadastro, imagem sem internet), guardada no aparelho; servidor padrão configurável no build |
| Retirado | os textos e endereços do produto de origem |

Os alertas continuam com `header`, `test` e `category` (o ícone da categoria da Defesa Civil, devolvido na 0.3.3). A tela interna
com códigos de emergência (`internal`) continua no app, sem mudança.

## Compilar

Ferramentas em `C:\Projetos\nexa-ferramentas` (JDK 21 e SDK Android). Um `android/local.properties` (fora do git) com:

```
sdk.dir=C:/Projetos/nexa-ferramentas/android-sdk
```

Testes da JVM e o build de release (no PowerShell, dentro de `android/`):

```powershell
$env:JAVA_HOME = "C:\Projetos\nexa-ferramentas\jdk-21.0.13+9"; .\gradlew.bat testDebugUnitTest assembleRelease
```

- **Publicar sempre o build de release** (`assembleRelease`): o de depuração é lento na TV box.
- Sem a chave do dono, o release sai **sem assinatura** (`app/build/outputs/apk/release/app-release-unsigned.apk`), e o
  Android não instala APK sem assinatura.
- Só para testar numa TV box antes de existir a chave do dono, dá para assinar com a chave de depuração:
  `.\gradlew.bat assembleRelease -Ptelas.assinarComDebug=true`. Atenção: o aparelho que recebeu esse APK precisa
  **desinstalar** o app antes de receber o assinado com a chave do dono (o Android recusa atualizar com outra chave).

### Criar a chave de release do dono (uma vez só)

Quem roda é o dono, no computador dele; a senha é digitada por ele e nunca vai para o chat nem para o repositório.

```powershell
& "C:\Projetos\nexa-ferramentas\jdk-21.0.13+9\bin\keytool.exe" -genkeypair -v -keystore "C:\Projetos\digital-isp-chaves\telas-release.jks" -alias telas -keyalg RSA -keysize 4096 -validity 36500
```

O `keytool` pede a senha e os dados (nome, empresa). Depois, criar `android/keystore.properties` (já está no
`.gitignore`, nunca entra no git):

```
storeFile=C:/Projetos/digital-isp-chaves/telas-release.jks
storePassword=<a senha>
keyAlias=telas
keyPassword=<a senha>
```

- Guardar o `.jks` e a senha **fora do repositório e com cópia de segurança**: sem essa chave, nenhuma TV box aceita
  mais atualização (seria preciso desinstalar o app em cada uma).
- Com o arquivo no lugar, o mesmo `assembleRelease` passa a gerar `app-release.apk` assinado.

## Marcadores a definir

| Marcador | Onde | O que fazer quando o domínio for decidido |
|---|---|---|
| Servidor padrão | `android/gradle.properties`: `telas.servidorPadrao=https://www.digitalisp.com.br` (definido em 23/11/2026), lido como `BuildConfig.SERVIDOR_PADRAO` | a tela de cadastro já vem com ele e esconde o campo do servidor (botão "Avançado: usar outro servidor"); a recuperação depois de reinstalar pergunta a ele. Sem a linha, volta o marcador `SERVIDOR_A_DEFINIR` (quem instala digita o endereço). |
| Endereço de atualização | não fica no app | vem do servidor no campo `update` do `/config` (`url`, `sha256`, `versionCode`). O servidor precisa servir o APK de release assinado com a chave do dono. |
