#!/bin/bash
# Grava as chaves do Cloudflare R2 do DIGITAL ISP no servidor (fora do git, permissão 600) e liga o armazenamento no R2.
# Uso, do seu computador: ssh -t digitalisp-servidor gravar-r2   (as chaves são digitadas aqui, nunca vão para chat nem log)
set -e
umask 077
ENV=~/.config/digitalisp/digitalisp.env
APP=/opt/digitalisp/app
echo "Chaves do Cloudflare R2 (Cloudflare → R2 → Gerenciar tokens de API)."
read -r -p "Account ID (32 letras e números): " ACC
read -r -p "Nome do bucket [digitalisp]: " BUCKET; BUCKET=${BUCKET:-digitalisp}
read -r -p "Access Key ID: " KEY
read -r -s -p "Secret Access Key (não aparece ao digitar): " SECRET; echo
read -r -p "Endereço público do bucket [https://arquivos.digitalisp.com.br]: " PUB; PUB=${PUB:-https://arquivos.digitalisp.com.br}
[[ "$ACC" =~ ^[a-f0-9]{32}$ ]] || { echo "Account ID inválido. Nada foi gravado."; exit 1; }
[ -n "$KEY" ] && [ -n "$SECRET" ] || { echo "Faltou a chave. Nada foi gravado."; exit 1; }
cd "$APP"
echo "Conferindo a conexão e copiando os arquivos que já existem…"
if ! env $(grep -v '^#' "$ENV" | grep -v '^R2_\|^STORAGE_DRIVER' | xargs) R2_ACCOUNT_ID="$ACC" R2_BUCKET="$BUCKET" R2_ACCESS_KEY_ID="$KEY" R2_SECRET_ACCESS_KEY="$SECRET" R2_PUBLIC_URL="$PUB" node scripts/r2-ligar.mjs; then
  echo "O R2 não ficou pronto. Nada foi mudado no servidor; confira as chaves e o bucket e rode de novo."; exit 1
fi
cp "$ENV" "$ENV.antes-do-r2"
grep -v '^R2_\|^STORAGE_DRIVER' "$ENV.antes-do-r2" > "$ENV"
{ echo "STORAGE_DRIVER=r2"; echo "R2_ACCOUNT_ID=$ACC"; echo "R2_BUCKET=$BUCKET"; echo "R2_ACCESS_KEY_ID=$KEY"; echo "R2_SECRET_ACCESS_KEY=$SECRET"; echo "R2_PUBLIC_URL=$PUB"; } >> "$ENV"
chmod 600 "$ENV" "$ENV.antes-do-r2"
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user restart digitalisp
for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -m 2 http://127.0.0.1:3400/healthz >/dev/null && break; sleep 1; done
echo "Pronto: o DIGITAL ISP agora guarda os arquivos no R2 (a cópia antiga da configuração ficou em $ENV.antes-do-r2)."
