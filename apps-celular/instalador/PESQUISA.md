# Pesquisa: instalar o app de tela pelo celular, fora da loja

DIGITAL ISP — Instalador (22/11/2026). O que é viável já, o que fica para depois e por quê.

## Resumo

| Aparelho | Como instala pelo celular | Situação |
|---|---|---|
| TV box Android (Android 5 a 10, a maioria das "boxes" comuns) | ADB por TCP na porta 5555 + aceite da chave na TV | **Feito nesta versão** |
| TV box / Google TV Android 11+ | "Depuração por Wi-Fi": pareamento por código de 6 dígitos (TLS) e conexão na porta que a TV anuncia | **Feito nesta versão** |
| Samsung (Tizen) de casa | Modo desenvolvedor + `sdb` (porta 26101) + pacote `.wgt` assinado com certificado Samsung ligado ao aparelho | **Depois** — dá para fazer, mas depende de certificado do dono |
| Samsung profissional (monitores de sinalização, SSSP/Tizen Signage) | "URL Launcher" do próprio monitor baixa o `.wgt` de um endereço | **Depois, e é o caminho melhor** — não precisa do celular para instalar |
| LG (webOS) de casa | App "Developer Mode" na TV + SSH (porta 9922) com a chave mostrada na TV; sessão de desenvolvedor expira | **Depois** — viável, mas a expiração não serve para tela 24 h |
| LG profissional (webOS Signage / Pro:Centric) | Instalação de IPK por servidor ou pendrive, sem expirar | **Depois** — caminho certo para LG |

Nesta versão o instalador **já reconhece** Samsung e LG na rede (portas típicas) e mostra ao técnico que essas
marcas ainda não instalam pelo celular, em vez de deixá-las de fora sem explicação.

## 1. TV box Android

### 1.1 ADB por TCP (porta 5555) — a maioria das TV boxes

- O `adbd` da TV aceita conexões TCP quando a depuração por rede está ligada. Nas TV boxes comuns (AOSP, Android 7 a 10)
  isso costuma estar em **Configurações → Opções do desenvolvedor → Depuração USB / Depuração ADB pela rede**, e em
  muitas já vem ligado de fábrica (`service.adb.tcp.port=5555`).
- Para liberar as Opções do desenvolvedor: **Configurações → Sobre → clicar 7 vezes em "Compilação"**.
- Na primeira conexão, o `adbd` pede a chave RSA do celular e a TV mostra **"Permitir depuração?"**. O técnico marca
  **"Sempre permitir deste computador"** e confirma com o controle remoto. Depois disso a mesma chave entra direto.
- Protocolo: o ADB normal (`CNXN`, `AUTH`, `OPEN`, `WRTE`, `OKAY`, `CLSE`). Não há criptografia no TCP puro: só use em
  rede de confiança (a rede do cliente, durante a instalação). O LEIAME manda desligar a depuração no fim.

### 1.2 Depuração por Wi-Fi do Android 11+ (pareamento por código)

- Em **Opções do desenvolvedor → Depuração por Wi-Fi → Parear dispositivo com código**, a TV mostra um código de 6
  dígitos, um IP e uma porta de pareamento (temporária).
- A TV anuncia pela rede, por mDNS:
  - `_adb-tls-pairing._tcp` — porta de pareamento (só enquanto a janela "Parear" estiver aberta);
  - `_adb-tls-connect._tcp` — porta da conexão (muda a cada vez que a depuração por Wi-Fi é ligada).
- Pareamento: TLS 1.3 + **SPAKE2** com o código; troca-se a chave pública. Depois, a conexão na porta de
  `_adb-tls-connect` é ADB com `STLS` (TLS por cima), sem novo aviso na TV.
- Algumas TVs Android 11+ continuam aceitando a 5555 se a "Depuração ADB pela rede" antiga estiver ligada; o
  instalador tenta as duas coisas.

### 1.3 Instalar e abrir

- Enviar o APK: serviço `sync:` (`SEND /data/local/tmp/arquivo.apk,0644` → blocos `DATA` de até 64 KiB → `DONE`), e
  depois `shell:pm install -r -g /data/local/tmp/arquivo.apk`. Funciona em todas as versões; `cmd package install -S`
  (sem arquivo temporário) só existe a partir do Android 7, por isso não é o caminho principal.
- `-r` reinstala por cima (atualização) mantendo os dados; `-g` já concede as permissões de execução.
- Abrir no fim: `monkey -p <pacote> -c android.intent.category.LEANBACK_LAUNCHER 1`, e se a TV não tiver ícone de TV,
  `-c android.intent.category.LAUNCHER`. O nome do pacote é lido do próprio APK baixado.
- Erros comuns do `pm install` e o que significam estão traduzidos em `InstallOutput.kt` (assinatura diferente,
  versão mais antiga, espaço insuficiente, etc.).

### 1.4 Bibliotecas ADB em Kotlin/Java

| Biblioteca | Licença | TCP 5555 | Pareamento Android 11+ | Observação |
|---|---|---|---|---|
| **libadb-android** (MuntashirAkon) 3.1.1 | **GPL-3.0-or-later OU Apache-2.0** (escolhemos **Apache-2.0**) | sim | **sim** (TLS + SPAKE2) | Feita para Android; usada no App Manager. JitPack. **Escolhida.** |
| └ spake2-java (mesmo autor) 2.2.1 | **LGPL-3.0** | — | usada no pareamento | Entra como biblioteca separada no APK. Ver nota abaixo. |
| └ Conscrypt (Google) 2.5.3 | Apache-2.0 | — | TLS 1.3 com `exportKeyingMaterial` | Maven Central. |
| └ Bouncy Castle 1.81 | MIT (licença Bouncy Castle) | — | — | Gera o certificado da chave do celular. |
| dadb (mobile.dev) 2.0.0 | Apache-2.0 | sim | **não** | Boa e simples, Maven Central; mas sem pareamento não atende Android 11+. |
| AdbLib (cgutman) | BSD-3 | sim | não | Antiga, sem manutenção. |
| Escrever o protocolo à mão | — | fácil | difícil (SPAKE2 compatível com BoringSSL) | Não compensa refazer o SPAKE2. |

**Nota sobre a LGPL do spake2-java:** a LGPL permite usar a biblioteca num app fechado desde que ela fique como
biblioteca separável, a licença e o código-fonte dela fiquem disponíveis, e quem quiser possa trocá-la. No APK ela é
uma biblioteca nativa separada (`lib/*/libspake2.so`) mais as classes Java dela, sem alteração; o R8 está desligado. O
app tem uma tela "Licenças" que cita cada biblioteca. **Confirmar com o jurídico do dono antes de distribuir.**
Se o dono preferir zero LGPL, a alternativa é tirar o pareamento (só TCP 5555, com dadb) — perde-se o Android 11+.

**Isolamento:** o app só fala com a biblioteca por uma interface própria (`AdbGateway`). Trocar de biblioteca é trocar
um arquivo (`LibAdbGateway.kt`).

### 1.5 Descoberta na rede

- **mDNS** (Android `NsdManager`): `_adb-tls-connect._tcp`, `_adb-tls-pairing._tcp` e `_adb._tcp`. Pega nome,
  IP e porta sem o técnico digitar nada.
- **Varredura da sub-rede**: tenta abrir TCP em cada IP da rede do Wi-Fi (até 254 endereços; redes maiores são
  limitadas à /24 em volta do celular), com 64 tentativas em paralelo e 400 ms de espera. Portas:
  - `5555` → TV box com ADB;
  - `8001`/`8002` → Samsung Tizen (API da TV), `26101` → Samsung com modo desenvolvedor;
  - `3000`/`3001` → LG webOS (SSAP), `9922` → LG com modo desenvolvedor.
- **IP manual**: sempre possível (rede com isolamento de clientes bloqueia mDNS e varredura).
- Limitações: Wi-Fi de visitantes com "isolamento de clientes" impede tudo — o celular precisa estar na **mesma rede**
  da TV, sem isolamento.

## 2. Samsung (Tizen)

- **TV de casa (Smart TV comum):** o app é um `.wgt` (web app). Para instalar fora da loja:
  1. Na TV, em **Apps**, digitar `12345` no controle → ligar **Developer mode** e informar o **IP do computador**
     (aqui: o IP do celular). Reiniciar a TV.
  2. Conectar com `sdb` (protocolo derivado do ADB) na porta **26101**.
  3. O `.wgt` tem de estar assinado com o **certificado Samsung** (autor + distribuidor) gerado no Tizen Studio com a
     conta Samsung do dono, e o certificado de distribuidor lista os **DUIDs** das TVs permitidas (ou nível "partner").
  4. Instalar: enviar o `.wgt` e rodar `vd_appinstall` / `0 vd_appinstall <id> <arquivo>` pelo shell do `sdb`.
- **Viável pelo celular?** Tecnicamente sim (o `sdb` é parecido com o ADB, dá para portar), mas: o certificado amarra
  as TVs pelo DUID (cada TV nova = novo certificado ou certificado de parceiro), o modo desenvolvedor aponta para um
  IP fixo, e não há biblioteca pronta. **Fica para depois**, junto com o app Samsung (sessão apps-tv).
- **Monitor profissional Samsung (SSSP / Tizen Signage):** tem **URL Launcher** — o monitor baixa e roda o `.wgt` de
  um endereço do servidor, com atualização automática, sem certificado da loja. **É o caminho recomendado** para
  sinalização em Samsung: o instalador pode, no futuro, só mostrar o passo a passo e o endereço a digitar.

## 3. LG (webOS)

- **TV de casa:** instalar o app **Developer Mode** da loja LG na TV e entrar com uma **conta de desenvolvedor LG**
  (do dono ou da revenda). A TV abre SSH na porta **9922** e mostra uma **frase-chave** para baixar a chave privada.
  O `ares-install` envia o `.ipk` por SFTP e instala.
- **A sessão de desenvolvedor expira** (por volta de 50 horas na última referência; o app tem botão de prorrogar, e
  há `ares-extend-dev`). Quando expira, **os apps instalados por esse modo somem ou deixam de abrir**. Para tela
  24 h isso é inaceitável sem um "renovador".
- **Viável pelo celular?** Sim tecnicamente (SSH/SFTP por JSch ou Apache MINA SSHD, ambas licenças permissivas), mas
  o problema é a expiração, não o celular. **Fica para depois**; teste com uma LG real para medir o prazo.
- **LG profissional (webOS Signage, Pro:Centric):** instala IPK por servidor/pendrive sem expirar. **Caminho
  recomendado** para LG em sinalização.

## 4. O que fica para depois

1. Samsung por `sdb` (depende do certificado do dono) e LG por SSH (depende da conta de desenvolvedor e da expiração).
2. Passo a passo de URL Launcher (Samsung profissional) e Pro:Centric/SI (LG profissional) dentro do instalador.
3. Endereço real do APK (`SERVIDOR_A_DEFINIR`) e verificação do SHA-256 do APK publicado pelo servidor.
4. Login do técnico da revenda no instalador (vincular a tela à revenda já na instalação).
5. QR code na tela de cadastro da TV para abrir o instalador já com o código.
6. Desligar a depuração na TV pelo próprio instalador no fim (`settings put global adb_enabled 0` desliga a conexão
   em uso; precisa testar em cada marca antes de ligar como padrão).
