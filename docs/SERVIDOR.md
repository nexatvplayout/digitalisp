# Servidor de produção do DIGITAL ISP

Instalado em 22/11/2026. O painel e a API ficam em **https://painel.digitalisp.com.br**. O site fica em
**https://www.digitalisp.com.br**, no Cloudflare Pages, publicado do `main`, pasta `site/`.

## Onde roda

- É um VPS da KingHost com Ubuntu 24.04. O endereço e a chave ficam só neste PC: o atalho `digitalisp-servidor` está em
  `~/.ssh/config` e a chave em `~/.ssh/digitalisp_servidor`. Nada disso vai para o repositório.
- **Divide a máquina com o Radar de Leads.** Nunca mexa em `/opt/radar`, `/etc/radar`, `/var/lib/radar`, no usuário `radar`
  nem na porta 3333.
- Usuário `digitalisp`, sem sudo, com entrada só por chave e limite de 1 núcleo e 1,5 GB de memória. O que precisar de
  root, o dono pede à sessão do Radar.

```
ssh digitalisp-servidor
export XDG_RUNTIME_DIR=/run/user/$(id -u)   # para o systemctl --user funcionar pelo SSH
```

## Como está montado

| O quê | Onde |
|---|---|
| Código (checkout do `main`) | `/opt/digitalisp/app` |
| Repositório que recebe o push | `/opt/digitalisp/repo.git` |
| Dados locais (imagens e cache, enquanto não há R2) | `/opt/digitalisp/dados` |
| Logs | `/opt/digitalisp/logs/servidor.log` e `tunel.log` |
| Variáveis e segredos (permissão 600, fora do git) | `~/.config/digitalisp/digitalisp.env` e `tunel.env` |
| Backup do banco (`pg_dump` às 03:30, guarda 14 dias) | `/opt/digitalisp/backup`, script `/opt/digitalisp/backup.sh` |

> **Atenção (novembro de 2026):** o túnel do DIGITAL ISP foi trocado pelo Caddy do servidor. **Não religue o `digitalisp-tunel`.**
> Mantenha `CF_TUNNEL=1` em `~/.config/digitalisp/digitalisp.env`: é isso que mantém certo o IP do visitante (`CF-Connecting-IP`).

- **Serviços de usuário** (systemd), que sobem no boot: `digitalisp` e `digitalisp-backup.timer` (o `digitalisp-tunel` foi desligado: a entrada agora é pelo Caddy).
- **Banco:** PostgreSQL 16 local, banco `digitalisp`, acesso pelo socket sem senha.
- **Rede:** o servidor escuta só em `127.0.0.1:3400`.
  - A entrada vem pelo túnel `digitalisp` da Cloudflare (Zero Trust, Rede, Túneis), com a rota
    `painel.digitalisp.com.br` → `http://localhost:3400`.
  - Com `CF_TUNNEL=1`, o IP real vem no `CF-Connecting-IP`.
- **Senhas iniciais:** as do `superadmin` e do `admin` da revenda padrão foram geradas no servidor e ficam no `.env`. O dono
  as lê pelo terminal dele e troca no primeiro acesso.
- **Token do túnel:** gravado com `bin/gravar-token`, no servidor.

## Atualizar (depois de subir o `main` para o GitHub)

```
GIT_SSH_COMMAND="ssh" git push digitalisp-servidor:/opt/digitalisp/repo.git main:main
ssh digitalisp-servidor 'cd /opt/digitalisp && git --git-dir=repo.git --work-tree=app checkout -f main &&
  cd app && npm ci --omit=dev --no-audit --no-fund &&
  export XDG_RUNTIME_DIR=/run/user/$(id -u) && systemctl --user restart digitalisp && sleep 4 &&
  curl -s http://127.0.0.1:3400/healthz'
```

## Pendências

- Bucket R2: configurar `STORAGE_DRIVER=r2` e as chaves no `.env`, e mandar o backup do banco também para o R2.
- Cache longo dos arquivos do painel (`/admin`), com versão no endereço. Hoje o primeiro carregamento busca uns 45
  arquivos.
