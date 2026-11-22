#!/bin/sh
# Publica o main no servidor do DIGITAL ISP e aquece o cache da Cloudflare (docs/SERVIDOR.md).
# Uso (na pasta do repositório, com o main já no GitHub): sh scripts/publicar.sh
# Precisa do atalho "digitalisp-servidor" no ~/.ssh/config deste PC.
set -e
GIT_SSH_COMMAND=ssh git push -q digitalisp-servidor:/opt/digitalisp/repo.git main:main
ssh digitalisp-servidor '
  set -e
  cd /opt/digitalisp && git --git-dir=repo.git --work-tree=app checkout -q -f main
  cd app && npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1
  export XDG_RUNTIME_DIR=/run/user/$(id -u)
  systemctl --user restart digitalisp
  for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -m 2 http://127.0.0.1:3400/healthz >/dev/null && break; sleep 1; done
  # cada subida troca a versão dos arquivos do painel (/_v/<versão>/): pede todos uma vez pela Cloudflare, para o primeiro
  # acesso de quem usa já encontrar tudo guardado
  B=https://www.digitalisp.com.br
  for u in $(curl -s "$B/admin/" | grep -oE "(modulepreload\" href|stylesheet\" href)=\"/_v/[^\"]+" | sed "s/.*=\"//"); do curl -s -o /dev/null "$B$u" & done; wait
  echo "no ar: $(git --git-dir=/opt/digitalisp/repo.git log --oneline -1)"
'
