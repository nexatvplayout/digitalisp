# DIGITAL ISP - instalador para TV Philips (Android TV / Google TV, Android 9 ate 14).
# Uso: clique duas vezes em INSTALAR.bat. Duas formas:
#   1) prepara o pendrive: baixa o app mais novo e copia para o pendrive ligado no computador;
#   2) instala pela rede (adb): o computador e a TV na mesma rede, com a depuracao ligada na TV.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$pasta  = Split-Path -Parent $MyInvocation.MyCommand.Path
$apk    = Join-Path $pasta 'DIGITAL-ISP-Telas.apk'
$pt     = Join-Path $pasta 'platform-tools'
$adb    = Join-Path $pt 'adb.exe'
$pacote = 'br.com.digitalisp.telas'
$site   = 'https://www.digitalisp.com.br/telas/app'

function Passo($t) { Write-Host ''; Write-Host "==> $t" -ForegroundColor Cyan }
function Aviso($t) { Write-Host $t -ForegroundColor Yellow }
function Fim($t, $ok) {
  Write-Host ''
  if ($ok) { Write-Host $t -ForegroundColor Green } else { Write-Host $t -ForegroundColor Red }
  Read-Host 'Aperte Enter para fechar' | Out-Null
  if ($ok) { exit 0 } else { exit 1 }
}

Write-Host 'DIGITAL ISP - instalador para TV Philips (Android TV / Google TV)' -ForegroundColor White
Write-Host 'Serve para as Philips com a Google Play. As com Titan OS ou Saphi nao aceitam apps de fora da loja.'

# 1) o APK: o da pasta, trocado pelo do site se saiu versao nova
Passo 'Conferindo o app do DIGITAL ISP'
try {
  $info = Invoke-RestMethod -UseBasicParsing "$site/latest.json"
  $hash = if (Test-Path $apk) { (Get-FileHash $apk -Algorithm SHA256).Hash.ToLower() } else { '' }
  if ($hash -ne $info.sha256) {
    Write-Host "Baixando a versao $($info.versionName) do site (uns 30 MB) ..."
    Invoke-WebRequest -UseBasicParsing "$site/latest.apk" -OutFile "$apk.baixando"
    if ((Get-FileHash "$apk.baixando" -Algorithm SHA256).Hash.ToLower() -ne $info.sha256) { Remove-Item "$apk.baixando"; throw 'o arquivo baixado veio errado' }
    Move-Item -Force "$apk.baixando" $apk
  }
  Write-Host "App pronto: versao $($info.versionName)"
} catch {
  if (-not (Test-Path $apk)) { Fim "Sem o app na pasta e sem acesso ao site ($($_.Exception.Message)). Confira a internet." $false }
  Aviso 'Sem acesso ao site agora; usando o app que veio na pasta.'
}

Write-Host ''
Write-Host 'Como voce quer instalar?'
Write-Host '  1 - Pelo pendrive (copia o app para o pendrive ligado neste computador)'
Write-Host '  2 - Pela rede (o computador instala direto na TV, na mesma rede)'
$modo = (Read-Host 'Digite 1 ou 2').Trim()

if ($modo -ne '2') {
  # ---------- PENDRIVE ----------
  Passo 'Procurando o pendrive'
  $discos = @()
  for ($i = 0; $i -lt 30 -and -not $discos.Count; $i++) {
    $discos = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | Where-Object { $_.Size -gt 0 })
    if (-not $discos.Count) { if ($i -eq 0) { Aviso 'Ligue o pendrive no computador (esperando ate 1 minuto) ...' }; Start-Sleep -Seconds 2 }
  }
  if (-not $discos.Count) { Fim 'Nenhum pendrive encontrado. Ligue o pendrive e rode de novo.' $false }
  $d = $discos[0]
  if ($discos.Count -gt 1) {
    for ($i = 0; $i -lt $discos.Count; $i++) { Write-Host "  $($i + 1) - $($discos[$i].DeviceID) $($discos[$i].VolumeName) ($([math]::Round($discos[$i].Size / 1GB, 1)) GB)" }
    $n = [int](Read-Host 'Qual pendrive? (numero)')
    if ($n -lt 1 -or $n -gt $discos.Count) { Fim 'Numero invalido.' $false }
    $d = $discos[$n - 1]
  }
  Write-Host "Pendrive: $($d.DeviceID) $($d.VolumeName) ($($d.FileSystem))"
  if ($d.FileSystem -eq 'NTFS') { Aviso 'Este pendrive esta em NTFS: muitas TVs so leem FAT32 ou exFAT. Se a TV nao mostrar o arquivo, formate o pendrive em exFAT.' }
  if ($d.FreeSpace -lt (Get-Item $apk).Length + 1MB) { Fim 'Sem espaco no pendrive para o app (precisa de uns 30 MB).' $false }
  $dest = Join-Path ($d.DeviceID + '\') 'DIGITAL-ISP-Telas.apk'
  Copy-Item -Force $apk $dest
  Copy-Item -Force (Join-Path $pasta 'LEIA-ME.txt') (Join-Path ($d.DeviceID + '\') 'DIGITAL-ISP-LEIA-ME.txt') -ErrorAction SilentlyContinue
  if ((Get-FileHash $dest -Algorithm SHA256).Hash -ne (Get-FileHash $apk -Algorithm SHA256).Hash) { Fim 'A copia para o pendrive veio errada. Tente outro pendrive.' $false }
  try { (New-Object -ComObject Shell.Application).Namespace(17).ParseName($d.DeviceID).InvokeVerb('Eject') } catch { }
  Write-Host ''
  Write-Host 'Agora, na TV:' -ForegroundColor White
  Write-Host ' 1. (uma vez so) Configuracoes > Sistema > Sobre: clique 7 vezes em "Build do SO Android TV".'
  Write-Host ' 2. (uma vez so) Na Google Play da TV, instale o "File Commander" (ou o "X-plore") e libere-o em'
  Write-Host '    Configuracoes > Apps > Seguranca e restricoes > Fontes desconhecidas.'
  Write-Host ' 3. Ligue o pendrive na TV, abra o gerenciador, escolha DIGITAL-ISP-Telas.apk e instale.'
  Write-Host '    Se o Play Protect avisar: "Mais detalhes" > "Instalar mesmo assim".'
  Write-Host ' 4. Abra o app e digite a chave da tela (gerada no painel em Telas > + TV box).'
  Fim "Pronto! O app esta no pendrive $($d.DeviceID) (ja pode tirar do computador)." $true
}

# ---------- PELA REDE (adb) ----------
Passo 'Conferindo o adb (ferramenta oficial do Google)'
if (-not (Test-Path $adb)) {
  $zip = Join-Path $pasta 'platform-tools.zip'
  Write-Host 'Baixando o platform-tools do Google (uns 7 MB) ...'
  Invoke-WebRequest -UseBasicParsing 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $pasta -Force
  Remove-Item $zip
}
& $adb start-server 2>$null | Out-Null

function Conectado($alvo) {
  $l = (& $adb devices 2>$null) -join "`n"
  return ($l -match [regex]::Escape($alvo) + '\s+device')
}
function NaoAutorizado($alvo) { return (((& $adb devices 2>$null) -join "`n") -match [regex]::Escape($alvo) + '\s+unauthorized') }

Write-Host ''
Write-Host 'Na TV, antes:' -ForegroundColor White
Write-Host ' 1. Configuracoes > Sistema > Sobre: clique 7 vezes em "Build do SO Android TV".'
Write-Host ' 2. Configuracoes > Sistema > Opcoes do desenvolvedor: ligue a "Depuracao USB"'
Write-Host '    e a "Depuracao sem fio" (Android 11 ou mais novo).'
Write-Host ' O IP da TV fica em Configuracoes > Rede e Internet (ou na tela da Depuracao sem fio).'
$ip = (Read-Host 'Digite o IP da TV (ex.: 192.168.0.50)').Trim()
if (-not $ip) { Fim 'Sem IP, nao da para continuar.' $false }
$ip = $ip -replace ':.*$', ''

Passo "Conectando na TV $ip"
$alvo = "${ip}:5555"
& $adb connect $alvo 2>&1 | Out-Null
Start-Sleep -Seconds 2
if (-not (Conectado $alvo)) {
  # Android 11+: a "Depuracao sem fio" pede o pareamento com codigo uma vez
  Write-Host 'A porta 5555 nao respondeu: vamos parear pela "Depuracao sem fio".'
  Write-Host 'Na TV: Opcoes do desenvolvedor > Depuracao sem fio > "Parear o dispositivo com um codigo".'
  $pp = (Read-Host 'Digite a PORTA que aparece junto do codigo (o numero depois dos dois pontos)').Trim()
  $cod = (Read-Host 'Digite o CODIGO de pareamento (6 numeros)').Trim()
  $saida = (& $adb pair "${ip}:$pp" $cod 2>&1) -join "`n"
  Write-Host $saida
  if ($saida -notmatch 'Successfully') { Fim 'O pareamento falhou. Confira o IP, a porta e o codigo (o codigo muda a cada vez).' $false }
  Write-Host 'Pareado. Agora a porta da tela principal da Depuracao sem fio (em "Endereco IP e porta").'
  $pc = (Read-Host 'Digite essa PORTA').Trim()
  $alvo = "${ip}:$pc"
  & $adb connect $alvo 2>&1 | Out-Null
  Start-Sleep -Seconds 2
}
for ($i = 0; $i -lt 30 -and -not (Conectado $alvo); $i++) {
  if ($i -eq 0 -and (NaoAutorizado $alvo)) { Aviso 'Na TV apareceu "Permitir depuracao?": marque "Sempre permitir deste computador" e clique OK.' }
  Start-Sleep -Seconds 2
}
if (-not (Conectado $alvo)) { Fim 'A TV nao respondeu. Confira se a depuracao esta ligada e se o computador esta na mesma rede.' $false }

$modelo = (& $adb -s $alvo shell getprop ro.product.model) -join ''
$marca  = (& $adb -s $alvo shell getprop ro.product.manufacturer) -join ''
$sdk    = [int]((& $adb -s $alvo shell getprop ro.build.version.sdk) -join '')
Write-Host "TV encontrada: $marca $modelo (Android SDK $sdk)"
if ($sdk -lt 24) { Fim 'Esta TV e antiga demais (precisa de Android 7 ou mais novo).' $false }

Passo 'Instalando o DIGITAL ISP (leva de 30 segundos a 2 minutos)'
# No Google TV o Play Protect confere cada app instalado pelo adb e pode parar esperando uma resposta na TV.
# Desliga essa conferencia so durante a instalacao (e volta como estava no fim).
function Ajuste($nome) { ((& $adb -s $alvo shell settings get global $nome 2>$null) -join '').Trim() }
$jaTinha = ((& $adb -s $alvo shell pm list packages $pacote 2>$null) -join "") -match [regex]::Escape($pacote)
$antes = @{}
foreach ($n in 'verifier_verify_adb_installs', 'package_verifier_enable') {
  $antes[$n] = Ajuste $n
  & $adb -s $alvo shell settings put global $n 0 2>&1 | Out-Null
}
$out = Join-Path $env:TEMP 'digitalisp-adb-install.txt'
$err = Join-Path $env:TEMP 'digitalisp-adb-install-erro.txt'
$p = Start-Process -FilePath $adb -ArgumentList @('-s', $alvo, 'install', '-r', '-g', "`"$apk`"") -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
$seg = 0; $avisou = $false
while (-not $p.HasExited -and $seg -lt 300) {
  Start-Sleep -Seconds 5; $seg += 5
  Write-Host -NoNewline '.'
  if ($seg -ge 25 -and -not $avisou) {
    $avisou = $true
    Write-Host ''
    Aviso 'OLHE A TELA DA TV: se apareceu um aviso do Google Play Protect, escolha "Instalar mesmo assim"'
    Aviso '(ou "Nao enviar" / "Permitir") com o controle remoto. A instalacao continua sozinha depois disso.'
  }
}
if (-not $p.HasExited) { try { $p.Kill() } catch { } }
foreach ($n in $antes.Keys) {
  $v = $antes[$n]
  if ($v -and $v -ne 'null') { & $adb -s $alvo shell settings put global $n $v 2>&1 | Out-Null } else { & $adb -s $alvo shell settings delete global $n 2>&1 | Out-Null }
}
Write-Host ''
$saida = ((Get-Content $out -ErrorAction SilentlyContinue) + (Get-Content $err -ErrorAction SilentlyContinue)) -join "`n"
Write-Host $saida
if ($seg -ge 300) { Fim 'A instalacao passou de 5 minutos sem terminar. Confira se ha algum aviso na TV e rode de novo (ou use o pendrive).' $false }
if ($saida -notmatch 'Success') {
  # a saida do adb as vezes some; se o app nao existia antes e agora existe, deu certo
  $tem = ((& $adb -s $alvo shell pm list packages $pacote 2>$null) -join '') -match [regex]::Escape($pacote)
  if ($jaTinha -or -not $tem) { Fim 'A instalacao falhou (veja a mensagem acima).' $false }
}
Write-Host 'Instalado.' -ForegroundColor Green

Passo 'Liberando para abrir sozinho ao ligar a TV'
& $adb -s $alvo shell appops set $pacote SYSTEM_ALERT_WINDOW allow 2>&1 | Out-Null
& $adb -s $alvo shell dumpsys deviceidle whitelist "+$pacote" 2>&1 | Out-Null
$casa = (Read-Host 'Usar o DIGITAL ISP como tela inicial da TV (abre sozinho ao ligar)? S/n').Trim()
if ($casa -notmatch '^[nN]') {
  $r = (& $adb -s $alvo shell cmd package set-home-activity "$pacote/.MainActivity" 2>&1) -join ' '
  if ($r -match 'Success') { Write-Host 'Feito: o DIGITAL ISP e a tela inicial.' } else { Aviso 'A TV nao deixou trocar a tela inicial por aqui; faca pelo menu do app (cima, cima, baixo, baixo, OK).' }
}

Passo 'Abrindo o app na TV'
& $adb -s $alvo shell monkey -p $pacote -c android.intent.category.LEANBACK_LAUNCHER 1 2>&1 | Out-Null
Fim 'Pronto! O DIGITAL ISP esta instalado e aberto na TV. Agora e so digitar a chave da tela (painel: Telas > + TV box).' $true
