# Pesquisa: instalar o app de tela pelo celular, fora da loja

DIGITAL ISP — Instalador. Primeira versão em 22/11/2026 (só Android); Samsung e LG em 25/11/2026 (versão 0.2.0).

## Resumo

| Aparelho | Como o celular instala | Situação |
|---|---|---|
| TV box Android (Android 5 a 10) | ADB por TCP na porta 5555 + aceite da chave na TV | **Pronto** |
| TV box / Google TV Android 11+ | "Depuração por Wi-Fi": pareamento por código (TLS + SPAKE2) | **Pronto** |
| Samsung (Tizen) | Modo desenvolvedor com o **IP do celular** como "Host PC IP"; sdb na porta 26101; `.wgt` assinado | **Pronto**; cada TV nova precisa estar no certificado Samsung (DUID) — **depende do dono** |
| LG (webOS) | App "Developer Mode" da TV; chave do Key Server (porta 9991) aberta com a frase-senha; SSH 9922; luna-send | **Pronto**; precisa da conta de desenvolvedor LG em cada TV, e a sessão **vence** |
| Samsung / LG profissionais (SSSP, webOS Signage) | URL Launcher / servidor do monitor | Depois (outro formato) |

O app de tela vem sempre do **servidor DIGITAL ISP** (https://www.digitalisp.com.br), conferido pelo SHA-256:
`/telas/app/latest.json` (Android) e `/telas/tv/latest.json` (Samsung `.wgt` e LG `.ipk`, `server/telas-tv.js`).

## 1. TV box Android

### 1.1 ADB por TCP (porta 5555)

- Ligado em **Opções do desenvolvedor → Depuração USB / Depuração ADB pela rede** (nas TV boxes comuns costuma vir
  ligado de fábrica). Opções do desenvolvedor: **Configurações → Sobre → 7 cliques em "Compilação"**.
- Na primeira conexão a TV pergunta **"Permitir depuração?"**: "Sempre permitir" + "Permitir". Depois a chave do
  celular entra direto.
- Sem criptografia no TCP puro: o LEIAME manda desligar a depuração no fim.

### 1.2 Android 11+: pareamento por código

- **Depuração por Wi-Fi → Parear dispositivo com código** mostra código de 6 dígitos, IP e porta temporária.
- mDNS: `_adb-tls-pairing._tcp` (porta do pareamento) e `_adb-tls-connect._tcp` (porta da conexão).
- Pareamento TLS 1.3 + SPAKE2; depois ADB com `STLS`.

### 1.3 Instalar e abrir

`sync:` para `/data/local/tmp`, `pm install -r -g` (sem `-g` nas TVs antigas), `monkey` com `LEANBACK_LAUNCHER` e
depois `LAUNCHER`. Erros do `pm` traduzidos em `adb/SaidaComandos.kt`.

### 1.4 Bibliotecas

| Biblioteca | Licença | Uso |
|---|---|---|
| libadb-android 3.1.1 | GPL-3.0-or-later **ou Apache-2.0** (usamos Apache-2.0) | ADB e pareamento |
| spake2-java 2.2.1 | **LGPL-3.0** | SPAKE2 do pareamento (`libspake2.so` separada, sem alteração) |
| Conscrypt 2.5.3 | Apache-2.0 | TLS 1.3 |
| Bouncy Castle 1.81 | MIT | certificado da chave ADB |
| JSch 2.27.0 (mwiede) | BSD | SSH/SFTP da LG |
| Apache MINA SSHD 2.20 | Apache-2.0 | **só nos testes** (TV LG de mentira) |

A LGPL do spake2-java aceita app fechado com a biblioteca separável; **confirmar com o jurídico do dono**. Sem ela,
perde-se só o Android 11+ por código.

## 2. Samsung (Tizen)

### 2.1 Como o Tizen Studio instala (e o celular faz igual)

Conferido em 25/11/2026 com o `sdb.exe` do Tizen Studio e a Samsung **UN58TU7020GXZD (Tizen 5.5)** da recepção, por um
proxy que gravou o tráfego, e com o próprio cliente Kotlin do instalador contra a mesma TV (`SamsungRealTest`):

1. **sdb = protocolo do ADB** (cabeçalho de 24 bytes, CNXN/OPEN/OKAY/WRTE/CLSE), **sem chave**: `CNXN` versão
   `0x00100000`, 256 KiB, `"host::"`; a TV responde `"device::UN58TU7020GXZD::0"`. Quem não é o "Host PC IP" não passa
   do CNXN — por isso o **celular tem de ser o Host PC** (o IP dele digitado no modo desenvolvedor da TV).
2. `capability:` → `sdk_toolpath:/home/owner/share/tmp/sdk_tools`, `platform_version:5.5`, `secure_protocol:enabled`.
3. O shell é **restrito**: só comandos `0 ...` respondem (`echo` não). `0 getduid` → o DUID (`RLCHYSD5UYU62` na
   recepção).
4. `sync:` só grava em `<sdk_toolpath>/tmp/` (fora dela: `FAIL You cannot push files to this path.`); o modo enviado é
   `33261`.
5. Instalar: `0 vd_appinstall <appId> <caminho>` (classe `SecureCmdVer1_0` do tizen-new-cli). Saída:
   `app_id[X] install start` … `install completed`, ou `download failed[N]` / `install failed[N, M]`. Com id de teste e
   arquivo inexistente a TV respondeu `download failed[16]` (o app instalado não foi tocado).
6. Abrir: `0 execute <appId>`.

### 2.2 O que depende do dono

- O `.wgt` é assinado com o **certificado Samsung** do dono (autor + distribuidor). O certificado de distribuidor
  de desenvolvedor só vale nas TVs cujo **DUID** está nele. Uma TV nova: o instalador mostra o DUID e explica; o dono
  inclui o DUID no certificado (Tizen Studio → Certificate Manager), gera e assina o pacote de novo
  (`apps-tv/scripts/empacotar.js tizen --perfil=...`) e publica (`node scripts/telas-tv-publicar.mjs`).
- Para não depender do DUID de cada TV: certificado de nível **partner** (pedido à Samsung) ou a linha profissional
  (SSSP/URL Launcher).
- O "Host PC IP" é um só por TV: se o celular trocar de IP (DHCP), troca na TV também. A Samsung não vence a sessão.
- Abrir sozinho ao ligar: "Executar automaticamente o último aplicativo" (mostrado no fim da instalação).

## 3. LG (webOS)

### 3.1 Como o ares-install faz (e o celular faz igual)

Do código do webOS TV CLI (github.com/webos-tools/cli, Apache-2.0: `lib/install.js`, `lib/base/novacom.js`,
`lib/base/luna.js`, `files/conf/command-service.json`):

1. Key Server do app Developer Mode: `GET http://TV:9991/webos_rsa` → chave privada **cifrada** com a frase-senha
   (Passphrase) que a TV mostra.
2. SSH na porta **9922**, usuário **prisoner**, com essa chave (aceitamos `ssh-rsa` antigo, como as TVs pedem).
3. `/usr/bin/test -d /media/developer/temp || /bin/mkdir -p /media/developer/temp`, envio por SFTP (ou `cat >`) e
   conferência do tamanho.
4. `/usr/bin/luna-send-pub -i luna://com.webos.appInstallService/dev/install
   '{"id":"com.ares.defaultName","ipkUrl":"/media/developer/temp/<ipk>","subscribe":true}'`; lê `details.state` até
   `installed` (ou `FAILED` com `details.reason`). Depois `rm -f`.
5. Abrir: `luna-send-pub -n 1 luna://com.webos.applicationManager/launch '{"id":"br.com.digitalisp.telas"}'`.
6. **Renovar a sessão** (o botão "Extend"): token em `/var/luna/preferences/devmode_enabled`, depois
   `https://developer.lge.com/secure/ResetDevModeSession.dev?sessionToken=…` e `CheckDevModeSession.dev` (tempo que
   falta). É o que o webOS Dev Manager da comunidade faz; **a confirmar numa LG real**. Se falhar, o instalador só avisa.

A chave e a frase ficam guardadas no celular (pasta privada do app) por TV: na próxima visita entra sem perguntar e
renova a sessão.

### 3.2 O que depende do dono

- **Conta de desenvolvedor LG** (gratuita) para entrar no app Developer Mode de cada TV.
- **A sessão vence** (cerca de 50 h na referência antiga; hoje o app mostra o tempo, a confirmar). Vencida, a TV apaga
  o app. O instalador renova a cada visita; para muitas TVs, a saída é a linha profissional da LG.

## 4. Testado sem aparelho

- 91 testes da JVM: descoberta, máquina de estados, orquestração das três marcas, protocolo sync, download conferido.
- **Samsung**: uma "TV" sdb de mentira que responde como a da recepção (CNXN, capability, shell restrito, sync só em
  `sdk_tools/tmp`, `vd_appinstall`, `execute`), mais o `SamsungRealTest` contra a TV de verdade (só leitura).
- **LG**: uma "TV" com servidor SSH/SFTP de verdade (Apache MINA) + Key Server com chave cifrada pela frase.
- Não testado em aparelho: Android real, LG real, e a instalação completa numa Samsung (a da recepção não foi
  reinstalada de propósito: desinstalar apaga o cadastro da tela).

## 5. Depois

1. Linha profissional: URL Launcher (Samsung SSSP) e Pro:Centric/SI (LG).
2. Login do técnico (vincular a tela à revenda já na instalação).
3. QR code na tela de cadastro da TV para abrir o instalador.
4. Desligar a depuração da TV box pelo próprio instalador no fim.
