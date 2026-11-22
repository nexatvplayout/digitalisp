# DIGITAL ISP — Instalador pelo celular

App Android do **técnico da revenda** (não é o app white-label da TV). Acha na mesma rede Wi-Fi a TV box Android e
instala nela o app de tela, por fora da loja, pela depuração de rede (ADB). Samsung e LG são reconhecidas na rede, mas
ainda não instalam pelo celular — ver [PESQUISA.md](PESQUISA.md).

- Pacote: `br.com.digitalisp.instalador` · versão 0.1.0 · Android 7.0+ no celular.
- Pacote do app de tela esperado: lido do próprio APK; se não der, `br.com.digitalisp.telas` (`Config.kt`).

## O que o app faz

1. **Procurar TVs na rede**: mDNS (`_adb-tls-connect`, `_adb-tls-pairing`, `_adb`) e varredura da sub-rede
   (portas 5555; Samsung 8001/8002/26101; LG 3000/3001/9922). Ou **Digitar o IP da TV**.
2. **Conectar**: na 5555 (ou na porta da "Depuração por Wi-Fi"). Se demorar, a tela manda olhar a TV e aceitar
   "Permitir depuração?".
3. **Parear** (Android 11+): pede o código de 6 dígitos que a TV mostra; a porta vem do mDNS ou é digitada.
4. **Baixar** o APK do endereço configurado (`https://SERVIDOR_A_DEFINIR/app/telas.apk`) ou usar um **APK escolhido
   no celular**.
5. **Enviar** para `/data/local/tmp`, **instalar** com `pm install -r -g`, apagar o temporário e **abrir** o app.

Código: `rede/` (descoberta), `adb/` (ADB e protocolo sync), `instalacao/` (máquina de estados e orquestrador),
`ui/` (tela). A biblioteca ADB só aparece em `adb/LibAdbGateway.kt`.

## Compilar e testar (Windows, PowerShell)

O JDK e o SDK ficam em `C:\Projetos\nexa-ferramentas`. O `local.properties` (fora do git) aponta o SDK:
`sdk.dir=C:/Projetos/nexa-ferramentas/android-sdk`.

```powershell
$env:JAVA_HOME = "C:\Projetos\nexa-ferramentas\jdk-21.0.13+9"
```

```powershell
cd C:\Projetos\digital-isp\apps-celular\instalador; .\gradlew.bat --no-daemon :app:testReleaseUnitTest
```

```powershell
cd C:\Projetos\digital-isp\apps-celular\instalador; .\gradlew.bat --no-daemon :app:assembleRelease
```

Sem chave, sai `app/build/outputs/apk/release/app-release-unsigned.apk` (não instala em celular sem assinar).

## Assinar (o dono faz, uma vez)

A chave e as senhas são do dono e **nunca** vão para o repositório nem para o chat.

1. Criar a pasta `C:\Projetos\digital-isp-chaves` (fora do repositório) e a chave — o `keytool` pede as senhas na
   hora; guarde a chave e as senhas num lugar seguro, com cópia:

   ```powershell
   & "C:\Projetos\nexa-ferramentas\jdk-21.0.13+9\bin\keytool.exe" -genkeypair -v -keystore C:\Projetos\digital-isp-chaves\instalador.jks -alias instalador -keyalg RSA -keysize 4096 -validity 10000
   ```

2. Criar `apps-celular/instalador/keystore.properties` (já está no `.gitignore`):

   ```
   storeFile=C:/Projetos/digital-isp-chaves/instalador.jks
   storePassword=...
   keyAlias=instalador
   keyPassword=...
   ```

3. Rodar o `assembleRelease` de novo: sai `app-release.apk`, assinado.

Use **sempre a mesma chave**: o Android só atualiza o instalador por cima se a assinatura for igual.
(O app de tela tem chave própria, na pasta `android/`.)

## Teste com uma TV box real

Precisa: uma TV box Android, um celular Android, os dois no **mesmo Wi-Fi** (sem "isolamento de clientes"), o APK
de release do app de tela no celular (ou o endereço https dele).

1. Instalar o instalador no celular (APK assinado; ou, só para teste, um `assembleDebug`).
2. Na TV box: **Configurações → Sobre → 7 cliques em "Compilação"** → **Opções do desenvolvedor** → ligar
   **Depuração USB** e, se houver, **Depuração ADB pela rede** / **ADB por rede**.
   Android 11+: ligar **Depuração por Wi-Fi** e abrir **Parear dispositivo com código**.
3. No celular: **Escolher um APK do celular** (o APK do app de tela) — enquanto o servidor não existe.
4. **Procurar TVs na rede** → tocar na TV box ("pronta para instalar" ou "precisa do código").
5. Se aparecer **"Olhe a TV"**: no controle, marcar **Sempre permitir** e **Permitir**.
   Se pedir **código**: digitar os 6 números (e a porta, se não vier preenchida).
6. Conferir: barra de envio, "Instalando", e o app de tela abrindo sozinho na TV.
7. Repetir com o app já instalado (deve atualizar por cima) e com um APK de outra assinatura (deve explicar
   "Desinstale o app antigo").
8. No fim, desligar a depuração na TV.

O que observar e anotar no teste (ainda não foi testado em aparelho real — não há TV box aqui):
- marca/modelo/Android da TV; se a 5555 vem ligada de fábrica; se a varredura achou; se o mDNS achou;
- tempo de envio de um APK de ~15 MB;
- se o `monkey` abriu o app (TVs sem ícone de TV abrem pelo ícone comum);
- Samsung/LG na rede: se aparecem como "TV Samsung"/"TV LG".

## O que depende do dono

1. **Endereço do APK** do app de tela no servidor (substituir `SERVIDOR_A_DEFINIR` em `Config.kt`; dá para trocar
   também na tela "Endereço do app"). Só `https://`.
2. **Chave de assinatura** do instalador (comando acima).
3. **Pacote definitivo do app de tela** (hoje o esperado é `br.com.digitalisp.telas`; o instalador lê do APK).
4. **Licenças**: o pareamento usa o `spake2-java` (LGPL-3.0) — confirmar se está ok distribuir (ver PESQUISA.md).
5. **Samsung e LG**: conta/certificado de desenvolvedor Samsung e conta de desenvolvedor LG, para a próxima fase.
6. **Distribuição** do instalador aos técnicos (fora da loja, ou Play Store como app interno).
