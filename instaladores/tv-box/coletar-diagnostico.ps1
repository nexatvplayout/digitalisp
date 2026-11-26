# DIGITAL ISP - coleta o diagnostico do Fire TV (ou TV box Android): memoria, processador, erros do app.
# Uso: clique duas vezes em COLETAR-DIAGNOSTICO.bat. Gera "diagnostico-<data>.txt" nesta pasta: mande esse arquivo ao suporte.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$pasta  = Split-Path -Parent $MyInvocation.MyCommand.Path
$adb    = Join-Path $pasta 'platform-tools\adb.exe'
$pacote = 'br.com.digitalisp.telas'

function Fim($t, $ok) {
  Write-Host ''
  if ($ok) { Write-Host $t -ForegroundColor Green } else { Write-Host $t -ForegroundColor Red }
  Read-Host 'Aperte Enter para fechar' | Out-Null
  if ($ok) { exit 0 } else { exit 1 }
}

if (-not (Test-Path $adb)) {
  $zip = Join-Path $pasta 'platform-tools.zip'
  Write-Host 'Baixando o adb do Google (uns 7 MB) ...'
  Invoke-WebRequest -UseBasicParsing 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $pasta -Force
  Remove-Item $zip
}
& $adb start-server | Out-Null

function Aparelho {
  $l = & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\sdevice$' } | Select-Object -First 1
  if ($l) { return ($l -split '\s+')[0] } else { return $null }
}
$serial = Aparelho
if (-not $serial) {
  Write-Host 'Nao achei pelo USB. O IP fica no Fire TV em: Configuracoes > Minha Fire TV > Sobre > Rede.'
  $ip = (Read-Host 'Digite o IP do Fire TV (ex.: 192.168.0.50)').Trim()
  if (-not $ip) { Fim 'Sem IP, nao da para continuar.' $false }
  if ($ip -notmatch ':') { $ip = "${ip}:5555" }
  & $adb connect $ip | Out-Null
  for ($i = 0; $i -lt 30 -and -not $serial; $i++) { Start-Sleep -Seconds 2; $serial = Aparelho }
}
if (-not $serial) { Fim 'O aparelho nao respondeu. Confira a Depuracao ADB ligada e aceite o aviso na TV.' $false }

$arq = Join-Path $pasta ("diagnostico-" + (Get-Date -Format 'yyyyMMdd-HHmm') + '.txt')
function Bloco($titulo, [string[]]$cmd) {
  Add-Content -Path $arq -Encoding UTF8 -Value ("`r`n===== " + $titulo + " =====")
  $out = (& $adb -s $serial shell @cmd 2>&1) -join "`r`n"
  Add-Content -Path $arq -Encoding UTF8 -Value $out
}
Set-Content -Path $arq -Encoding UTF8 -Value ("DIGITAL ISP - diagnostico de " + (Get-Date))
Write-Host 'Coletando (leva uns 20 segundos) ...'
Bloco 'Aparelho' @('getprop ro.product.model; getprop ro.build.version.release; getprop ro.build.version.sdk')
Bloco 'Versao do app' @("dumpsys package $pacote | grep -E 'versionName|versionCode|firstInstall|lastUpdate'")
Bloco 'Memoria do aparelho' @('cat /proc/meminfo | head -8')
Bloco 'Memoria do app' @("dumpsys meminfo $pacote | head -45")
Bloco 'Processador agora (top)' @('top -b -n 1 | head -25')
Bloco 'Espaco' @('df -h /data | tail -2')
Bloco 'Erros que fecharam o app' @('logcat -d -b crash -t 300')
Bloco 'Avisos de memoria e travamentos (ANR)' @("logcat -d -t 4000 | grep -iE 'lowmemorykiller|am_low_memory|ANR in|Out of memory|OutOfMemory|$pacote' | tail -200")
Fim ("Pronto: o arquivo " + $arq + " foi gerado. Mande esse arquivo para o suporte do DIGITAL ISP.") $true
