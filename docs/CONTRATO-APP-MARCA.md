# Contrato da marca: o app da TV box e o servidor

Versão 1 · 22/11/2026 (nome e ícone revistos em 23/11/2026) · lado do app: `android/` (pacote `br.com.digitalisp.telas`, versão 0.2.0).

> **23/11/2026, decisão do dono:** o app passa a se chamar **DIGITAL ISP** no aparelho, com o logo da DIGITAL ISP no ícone
> e na faixa do Android TV. Sem revenda (antes do cadastro), a abertura e o cadastro mostram o logo DIGITAL ISP. Com
> revenda, continua valendo a marca dela, como descrito abaixo.

O app da TV box mostra, no conteúdo, só o que é do cliente final.
A única marca que aparece é a da **revenda** (o provedor), em três lugares: a abertura, a tela de cadastro e a imagem de
quando não há o que tocar (sem internet). Há **um APK só** para todas as revendas: a marca chega do servidor quando a
tela é cadastrada e fica guardada no aparelho, para valer sem internet.

Este documento diz o que o app espera do servidor. O app é tolerante: **sem o campo, ele usa o neutro** e segue
funcionando. O servidor pode mandar a marca aos poucos (primeiro só o nome, depois a logo).

## 1. Onde o campo vem

O objeto `marca` vem no nível de cima da resposta JSON de três rotas que o app já usa:

| Rota | Quando | O que o app faz com `marca` |
|---|---|---|
| `POST /api/telas/activate` | cadastro com o código de uso único | grava (regras da seção 3) |
| `POST /api/telas/recover` | app reinstalado, recuperado pelo hwid | grava (regras da seção 3) |
| `GET /api/telas/config` | a configuração da tela (na ativação, na partida e quando o `rev` muda) | grava (regras da seção 3) |

O sinal de vida (`POST /api/telas/heartbeat`) **não** precisa trazer a marca. Quando a marca da revenda muda, o
servidor muda o `rev` da configuração das telas dessa revenda: o app vê o `rev` novo no sinal de vida, busca o
`/config` de novo e recebe a marca nova. Ou seja: **a marca entra no cálculo do `rev` (e do ETag) do `/config`.**

A marca é da **revenda** dona do cliente final dono da tela. Todas as telas de todos os clientes finais de uma revenda
recebem a mesma marca.

## 2. O objeto

```json
{
  "rev": "…",
  "marca": {
    "nome": "Provedor Exemplo",
    "logoUrl": "https://arquivos.exemplo.com.br/revendas/42/logo-3f9a.png",
    "logoHash": "3f9a…(64 caracteres hex)…",
    "logoBytes": 48213,
    "corFundo": "#0B1E3A",
    "corDestaque": "#FFCC00"
  }
}
```

| Campo | Tipo | Regra no app | Se faltar ou vier errado |
|---|---|---|---|
| `nome` | texto | espaços e quebras de linha viram um espaço; cortado em 60 caracteres | sem nome |
| `logoUrl` | texto | precisa ser `https://` com host | sem logo |
| `logoHash` | texto | SHA-256 do arquivo, 64 hex; aceita maiúsculas e o prefixo `sha256:` | sem logo |
| `logoBytes` | número inteiro | tamanho exato do arquivo, de 1 a 1.048.576 (1 MiB) | sem logo |
| `corFundo` | texto | `#RRGGBB` (6 hex, sem transparência) | preto `#000000` |
| `corDestaque` | texto | `#RRGGBB` | branco `#FFFFFF` |

- A logo só vale com os três campos `logoUrl`, `logoHash` e `logoBytes` certos. Um campo errado invalida só a logo:
  o nome e as cores continuam valendo.
- Um campo errado nunca faz o app recusar a resposta inteira (a ativação e a configuração seguem normais).
- Campos a mais dentro de `marca` são ignorados (o servidor pode mandar `id`, `slug` etc. sem problema).

### O arquivo da logo

- Formato: **PNG** (recomendado, com fundo transparente), JPEG ou WebP. O Android descobre o formato pelo conteúdo.
- Tamanho: até **1 MiB**. Recomendado: 1200 × 400 px ou menor, deitada; a logo é desenhada inteira, sem cortar, no
  máximo com metade da largura e 40% da altura da tela.
- O endereço precisa responder `200` (ou `206` para `Range`) **sem login**; redirecionamento é seguido. O app baixa com
  a mesma conexão dos vídeos guardados (sem o token do aparelho) e continua de onde parou se a rede cair.
  Um endereço assinado serve, desde que valha por bastante tempo (o aparelho pode ficar dias sem rede e tentar depois).
- **Endereço novo para arquivo novo.** O app guarda a logo pelo hash: trocar a logo = mandar `logoHash` novo (e, de
  preferência, um `logoUrl` novo, para nenhum cache servir a antiga).
- O arquivo pode estar no mesmo armazenamento dos outros arquivos das telas (R2).

## 3. O que o app faz com o campo

| Resposta | Efeito |
|---|---|
| campo `marca` **ausente** | fica a marca guardada (servidor sem a função, ou nada mudou) |
| `"marca": null` | volta ao neutro: apaga a marca guardada e o arquivo da logo |
| `"marca": {}` (nenhum campo válido) | volta ao neutro, como o `null` |
| `marca` com tipo errado (texto, número, lista) | ignorado: fica a guardada |
| `marca` com objeto | substitui a guardada |

- A marca fica guardada no aparelho (nas preferências privadas do app) e a logo em `files/marca/<hash>.img`.
- **Desativar a tela no painel (401) não apaga a marca:** o aparelho continua da revenda e a tela de cadastro mostra a
  logo dela. Só o botão "Trocar de modo (apaga tudo deste app)" dos ajustes do aparelho volta ao neutro.
- Cadastrar o aparelho em outra revenda troca a marca quando a ativação ou o `/config` trouxer a nova.

### Download e conferência da logo

1. O app compara o `logoHash` com o arquivo guardado. Se já tem o arquivo certo (mesmo hash e mesmo tamanho), não baixa.
2. Se não tem, baixa para `<hash>.img.part`, sem o token, continuando de onde parou (`Range`) quando a rede cai.
3. Confere o tamanho (`logoBytes`) e o SHA-256 (`logoHash`). Só então dá o nome final ao arquivo.
4. **A logo anterior continua na tela até a nova chegar inteira e conferida.** Depois disso, a anterior é apagada.
5. Falha de rede: tenta de novo em 2 minutos (e a cada sinal de vida que volta a responder). Arquivo que não confere
   (tamanho ou hash): é apagado, e o app tenta de novo só em 30 minutos; o diagnóstico mostra "Logo da revenda não
   confere".
6. Se o arquivo baixado não for uma imagem que o Android abre, a tela segue como se não houvesse logo (nome ou neutro).

## 4. Onde a marca aparece (e o neutro)

| Lugar | Com logo pronta | Com marca, sem logo pronta | Sem marca (neutro, antes do cadastro) |
|---|---|---|---|
| **Abertura** (ao abrir o app: ao ligar a TV box, depois de uma queda) | tela cheia na `corFundo`, a logo no meio | tela cheia só na `corFundo` | o logo DIGITAL ISP sobre o azul-marinho `#0A2150` |
| **Cadastro** (tela do código de uso único) e assistente | a logo no topo, numa placa da `corFundo` | o `nome` no topo, na `corDestaque` | o título "DIGITAL ISP" (o assistente: nada) |
| **Sem nada para tocar** (sem internet e sem vídeo guardado) | a imagem `offline.image` do cliente, se houver; senão a logo no meio da área do vídeo, sobre a `corFundo` | `offline.image` ou preto | `offline.image` ou preto |

- A abertura fica pelo menos **3 s** e some quando o conteúdo começa, quando o app ainda não foi cadastrado (vai para a
  tela de cadastro) ou, no máximo, em **15 s**.
- Na imagem sem internet, a **imagem do cliente** (`offline.image` do `/config`) tem prioridade sobre a logo da
  revenda: é conteúdo do cliente. A ordem é: vídeo guardado > `offline.image` > logo da revenda > preto.
- No aparelho, o nome do app é **"DIGITAL ISP"** e o ícone e a faixa do Android TV são o logo da DIGITAL ISP
  (decisão do dono de 23/11/2026). Com revenda, a abertura, o cadastro e a imagem sem internet mostram a marca dela.

## 5. Exemplos

Ativação com a marca completa:

```json
{ "deviceId": 812, "token": "…", "channel": "…", "name": "Loja Centro · recepção",
  "marca": { "nome": "Provedor Exemplo", "logoUrl": "https://arquivos.exemplo.com.br/r/42/logo-3f9a.png",
             "logoHash": "3f9a…", "logoBytes": 48213, "corFundo": "#0B1E3A", "corDestaque": "#FFCC00" } }
```

Revenda que ainda não subiu a logo (aparece o nome no cadastro e a cor na abertura):

```json
{ "marca": { "nome": "Provedor Exemplo", "corFundo": "#101010" } }
```

Revenda que apagou a marca no painel (volta ao neutro):

```json
{ "marca": null }
```

Servidor que ainda não implementou a marca: não manda o campo, e o app usa o neutro (ou a marca que já tinha).

## 6. O que falta do lado do servidor

- [ ] Guardar na revenda: nome de exibição, arquivo da logo (com SHA-256 e tamanho), cor de fundo e cor de destaque.
- [ ] Painel da revenda: subir a logo (PNG/JPEG/WebP, até 1 MiB; o servidor calcula o hash e o tamanho) e escolher as cores.
- [ ] Mandar `marca` em `activate`, `recover` e `config`, pela revenda dona da tela.
- [ ] Pôr a marca no cálculo do `rev`/ETag do `/config` (trocar a logo ou as cores muda o `rev` das telas da revenda).
- [ ] Servir a logo por `https`, sem login, com `Range`, num endereço que muda quando o arquivo muda.

## 7. Testes do app que cobrem este contrato

`android/app/src/test/java/br/com/digitalisp/telas/core/BrandTest.kt`: leitura do objeto e de cada campo (válido,
ausente, de tipo errado), as regras de ausente/`null`/`{}`, a ida e volta do que fica guardado, o plano de download que
mantém a logo anterior até a nova conferir, e o tempo da abertura.
