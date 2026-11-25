# DIGITAL ISP — Instalador pelo celular

App Android do **técnico da revenda** (não é o app white-label da TV). Acha na mesma rede Wi-Fi a **TV box Android**,
a **TV Samsung** ou a **TV LG** e instala nela o app de tela, por fora da loja, baixando a versão atual do servidor
DIGITAL ISP. Como e por quê: [PESQUISA.md](PESQUISA.md).

- Pacote `br.com.digitalisp.instalador` · versão **0.2.0** (versionCode 2) · Android 8.0+ no celular.
- Baixar: **https://www.digitalisp.com.br/instalador** (o APK; `server/telas-tv.js`).

## O que o app faz

1. **Procurar TVs na rede**: mDNS do ADB e varredura da sub-rede (5555; Samsung 8001/8002/26101; LG 3000/3001/9922),
   ou **Digitar o IP da TV** escolhendo a marca.
2. **Conectar**, conforme a marca:
   - Android: 5555 ou a porta da "Depuração por Wi-Fi"; aceite "Permitir depuração?" ou o código de 6 dígitos.
   - Samsung: sdb na 26101. Se a TV não aceitar, a tela mostra o **IP do celular** para pôr no "Host PC IP".
   - LG: pede a **Passphrase** do app Developer Mode, baixa a chave do Key Server e entra por SSH (9922).
3. **Baixar** do servidor (`/telas/app/latest.*` ou `/telas/tv/latest.*`), conferindo tamanho e SHA-256.
4. **Enviar, instalar e abrir** (`pm install`; `0 vd_appinstall`; `luna-send` appInstallService) e mostrar o recado
   final (Samsung: DUID e "abrir o último app ao ligar"; LG: sessão renovada e quanto falta).

Código: `rede/` (descoberta), `adb/`, `samsung/` (sdb), `lg/` (SSH/luna), `pacotes/` (servidor), `instalacao/`
(máquina de estados, orquestrador e as sessões de cada marca), `ui/`.

## Compilar, testar e publicar (Windows, PowerShell)

```powershell
$env:JAVA_HOME = "C:\Projetos\nexa-ferramentas\jdk-21.0.13+9"
```

```powershell
cd C:\Projetos\digital-isp\apps-celular\instalador; .\gradlew.bat --no-daemon :app:testReleaseUnitTest
```

```powershell
cd C:\Projetos\digital-isp\apps-celular\instalador; .\gradlew.bat --no-daemon :app:lintRelease :app:assembleRelease "-Pinstalador.assinarComDebug=true"
```

```powershell
cd C:\Projetos\digital-isp; node scripts/instalador-publicar.mjs; node scripts/telas-tv-publicar.mjs
```

Depois: commit, push do `main` e `sh scripts/publicar.sh`. O `telas-tv-publicar` pega a pasta `tv-*` mais nova de
`C:\Projetos\digital-isp-pacotes` (o `.wgt` já assinado e o `.ipk`). O `local.properties` (fora do git) aponta o SDK:
`sdk.dir=C:/Projetos/nexa-ferramentas/android-sdk`.

Teste contra a Samsung da recepção (só leitura; o PC precisa ser o Host PC da TV):

```powershell
$env:SAMSUNG_REAL = "192.168.100.107"; .\gradlew.bat --no-daemon :app:testReleaseUnitTest --tests "*SamsungRealTest*"
```

## Assinatura

Hoje o release sai assinado com a **chave de depuração deste PC** (`-Pinstalador.assinarComDebug=true`), como o app
da TV. Para a chave própria (o dono faz, uma vez; nenhuma senha passa por aqui):

```powershell
& "C:\Projetos\nexa-ferramentas\jdk-21.0.13+9\bin\keytool.exe" -genkeypair -v -keystore C:\Projetos\digital-isp-chaves\instalador.jks -alias instalador -keyalg RSA -keysize 4096 -validity 10000
```

e `apps-celular/instalador/keystore.properties` (já no `.gitignore`) com `storeFile`, `storePassword`, `keyAlias`,
`keyPassword`. Trocar de chave obriga o técnico a desinstalar o instalador antigo uma vez.

## Teste com aparelhos reais

- **TV box Android**: Opções do desenvolvedor → Depuração USB / ADB pela rede (Android 11+: Depuração por Wi-Fi).
  Procurar → tocar → aceitar na TV → deve abrir o app.
- **Samsung**: Apps → 1 2 3 4 5 → Developer mode ligado → Host PC IP = IP do celular (o app mostra) → desligar da
  tomada 30 s. Procurar → tocar. TV fora do certificado: aparece o DUID (botão "Copiar o DUID").
- **LG**: Content Store → Developer Mode → entrar com a conta de desenvolvedor → Dev Mode Status ligado (reinicia) →
  Key Server ligado. Procurar → tocar → digitar a Passphrase.
- Anotar: modelo, versão do sistema, tempo de envio, se abriu sozinho; na LG, se a renovação da sessão funcionou (o
  recado final diz quanto falta).

## O que depende do dono

1. **Samsung**: incluir o DUID de cada TV nova no certificado Samsung, assinar o `.wgt` de novo e publicar
   (`node scripts/telas-tv-publicar.mjs`). Ou pedir à Samsung o certificado de nível partner.
2. **LG**: a conta de desenvolvedor LG para o app Developer Mode de cada TV; a sessão vence (o instalador renova).
3. **Chave própria** do instalador (acima) e o **jurídico** sobre a LGPL do spake2-java (PESQUISA.md).
