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
- **"Esqueci minha senha" (revenda e cliente final):** só aparece no login com o e-mail ligado. Ponha no
  `~/.config/digitalisp/digitalisp.env` o `SMTP_URL` do provedor de envio (ex.: `smtps://usuario:senha@smtp.provedor.com:465`)
  e o `MAIL_FROM` (`DIGITAL ISP <nao-responda@digitalisp.com.br>`; o domínio precisa estar liberado no provedor, com SPF e
  DKIM no DNS), e reinicie o serviço. Em Integrações (superadmin), o E-mail sai de "a contratar" e ganha o botão Testar. O link
  usa o `PLATFORM_PUBLIC_URL` (ou o domínio verificado da própria revenda), vale 30 minutos e uma vez só.
- **Recuperar o acesso pelo terminal** (sem e-mail; também para a equipe da plataforma), no servidor, na pasta `app`:
  `npm run admin:reset -- <e-mail>` gera uma senha nova (pede troca no primeiro acesso), destrava e reativa a conta;
  `npm run admin:reset -- --platform superadmin` faz o mesmo para a equipe; `npm run admin:reset -- --list <texto>` só
  procura (útil quando o login diz "Usuário ou senha incorretos" e não se sabe se a conta existe).

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

## Domínio próprio (Cloudflare for SaaS)

As revendas e os clientes cadastram o próprio endereço (ex.: `telas.provedor.com.br`) na aba **Domínio próprio** do painel.
O sistema cria o "Custom Hostname" no Cloudflare e mostra a eles o CNAME e os TXT que faltam. Para isso funcionar, uma vez só:

1. **Cloudflare** (zona `digitalisp.com.br`): SSL/TLS → Custom Hostnames → ativar o Cloudflare for SaaS. Criar o registro A
   `clientes.digitalisp.com.br` para o IP do servidor, com proxy (nuvem laranja), e defini-lo como **Fallback Origin**.
2. **Token**: Meu perfil → Tokens de API → personalizado, permissão "Zona → SSL e certificados → Editar" só para
   `digitalisp.com.br`. O Zone ID e o token vão no superadmin, em **Integrações → Domínio próprio**, com "Testar agora".
3. **Caddy** (precisa do usuário administrador do servidor; o usuário `digitalisp` não tem sudo): o tráfego dos domínios dos
   clientes chega com o endereço deles, que não está em nenhum site do Caddy. Acrescentar um site "pega-tudo", que só atende o
   que nenhum outro site atende, com o certificado de origem do Cloudflare (o modo SSL da zona é "Completo", que aceita):

   `/etc/caddy/sites/zz-dominios-clientes.caddy`
   ```
   https:// {
   	tls /etc/caddy/certs/painel.digitalisp.com.br.pem /etc/caddy/certs/painel.digitalisp.com.br.key
   	reverse_proxy 127.0.0.1:3400
   }
   ```
   e, nas opções globais do `/etc/caddy/Caddyfile` (o bloco `{ … }` do começo), a linha `default_sni painel.digitalisp.com.br`,
   para o certificado de origem valer também quando o endereço pedido não é da DIGITAL ISP. Depois: `caddy validate --config
   /etc/caddy/Caddyfile` e `systemctl reload caddy`. Conferir com um domínio de teste já ativo no Cloudflare. O Radar
   (`radar.ispsummit.com.br`, porta 3333) não muda: o site dele continua mais específico que o pega-tudo.

O servidor reconhece o domínio verificado (`domains`, status `verified`) e abre a entrada com a marca da conta dona
(`/c/<identificador>`). Sem a integração, o cadastro fica "aguardando a plataforma" e o cliente já pode criar o CNAME.
