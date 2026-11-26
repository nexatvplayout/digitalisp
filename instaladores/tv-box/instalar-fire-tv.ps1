# DIGITAL ISP - instala o app das telas no Amazon Fire TV (pelo cabo USB ou pela rede).
# Uso: clique duas vezes em INSTALAR.bat (ou rode este arquivo no PowerShell).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$pasta  = Split-Path -Parent $MyInvocation.MyCommand.Path
$apk    = Join-Path $pasta 'DIGITAL-ISP-Telas.apk'
$pt     = Join-Path $pasta 'platform-tools'
$adb    = Join-Path $pt 'adb.exe'
$pacote = 'br.com.digitalisp.telas'

function Passo($t) { Write-Host ''; Write-Host "==> $t" -ForegroundColor Cyan }
function Fim($t, $ok) {
  Write-Host ''
  if ($ok) { Write-Host $t -ForegroundColor Green } else { Write-Host $t -ForegroundColor Red }
  Read-Host 'Aperte Enter para fechar' | Out-Null
  if ($ok) { exit 0 } else { exit 1 }
}

# 1) o APK: usa o que veio na pasta; se faltar, baixa a versao atual do servidor
Passo 'Conferindo o APK do DIGITAL ISP'
if (-not (Test-Path $apk)) {
  Write-Host 'Baixando de https://www.digitalisp.com.br/telas/app/latest.apk ...'
  Invoke-WebRequest -UseBasicParsing 'https://www.digitalisp.com.br/telas/app/latest.apk' -OutFile $apk
}
try {
  $info = Invoke-RestMethod -UseBasicParsing 'https://www.digitalisp.com.br/telas/app/latest.json'
  $hash = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLower()
  if ($hash -ne $info.sha256) {
    Write-Host "Saiu uma versao nova ($($info.versionName)); baixando ..."
    Invoke-WebRequest -UseBasicParsing 'https://www.digitalisp.com.br/telas/app/latest.apk' -OutFile $apk
  }
  Write-Host "APK pronto: versao $($info.versionName)"
} catch { Write-Host 'Sem acesso ao servidor agora; usando o APK da pasta.' }

# 2) o adb (ferramenta oficial do Google)
Passo 'Conferindo o adb'
if (-not (Test-Path $adb)) {
  $zip = Join-Path $pasta 'platform-tools.zip'
  Write-Host 'Baixando o platform-tools do Google (uns 7 MB) ...'
  Invoke-WebRequest -UseBasicParsing 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $pasta -Force
  Remove-Item $zip
}
& $adb start-server | Out-Null

function Aparelhos {
  & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\S' } | ForEach-Object {
    $p = $_ -split '\s+'; [pscustomobject]@{ serial = $p[0]; estado = $p[1] }
  }
}
function Esperar-Autorizacao {
  for ($i = 0; $i -lt 60; $i++) {
    $ok = @(Aparelhos | Where-Object { $_.estado -eq 'device' })
    if ($ok.Count) { return $ok[0].serial }
    if ($i -eq 0 -and @(Aparelhos | Where-Object { $_.estado -eq 'unauthorized' }).Count) {
      Write-Host 'Na TV apareceu "Permitir depuracao USB?": marque "Sempre permitir deste computador" e clique OK.' -ForegroundColor Yellow
    }
    Start-Sleep -Seconds 2
  }
  return $null
}

# 3) achar o Fire TV: primeiro pelo USB; se nao aparecer, pela rede
Passo 'Procurando o Fire TV no cabo USB'
$serial = Esperar-Autorizacao
if (-not $serial) {
  Write-Host 'Nao apareceu pelo USB (em varios Fire TV Stick a porta USB so da energia).'
  Write-Host 'Vamos pela rede. O IP fica no Fire TV em: Configuracoes > Minha Fire TV > Sobre > Rede.'
  $ip = (Read-Host 'Digite o IP do Fire TV (ex.: 192.168.0.50)').Trim()
  if (-not $ip) { Fim 'Sem IP, nao da para continuar.' $false }
  if ($ip -notmatch ':') { $ip = "${ip}:5555" }
  & $adb connect $ip
  $serial = Esperar-Autorizacao
}
if (-not $serial) {
  Fim 'O Fire TV nao respondeu. Confira: Opcoes do desenvolvedor > Depuracao ADB LIGADA, e aceite o aviso na TV.' $false
}
Write-Host "Fire TV encontrado: $serial"
$modelo = (& $adb -s $serial shell getprop ro.product.model) -join ''
$sdk    = [int]((& $adb -s $serial shell getprop ro.build.version.sdk) -join '')
Write-Host "Modelo: $modelo  (Android SDK $sdk)"
if ($sdk -lt 24) { Fim 'Este Fire TV e antigo demais (precisa de Fire OS 6 ou mais novo).' $false }

# 4) instalar (por cima, se ja tiver) e abrir
Passo 'Instalando o DIGITAL ISP (leva uns 30 segundos)'
$saida = (& $adb -s $serial install -r -g $apk 2>&1) -join "`n"
Write-Host $saida
if ($saida -notmatch 'Success') { Fim 'A instalacao falhou (veja a mensagem acima).' $false }

Passo 'Abrindo o app na TV'
& $adb -s $serial shell monkey -p $pacote -c android.intent.category.LEANBACK_LAUNCHER 1 | Out-Null
Fim 'Pronto! O DIGITAL ISP esta instalado e aberto no Fire TV. Agora e so vincular a tela pelo painel.' $true
