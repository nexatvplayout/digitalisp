// Núcleo de acesso sem banco de dados: catálogo de permissões, hash de senha, política de senha e sessões assinadas.
import { scrypt as scryptCb, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

/**
 * Catálogo de permissões. `implies`: quem edita também precisa ver, então a permissão maior inclui a menor.
 * As rotas pedem "qualquer uma destas" (ver needs() em auth.js).
 */
export const PERMISSIONS = [
  { id: 'playout.view', area: 'Playout', label: 'Ver playout, painel e estatísticas' },
  { id: 'playout.control', area: 'Playout', label: 'Comandar o ar: take, pular, pausar, standby, entrada ao vivo, vitrine e o gerador de caracteres (TAKE/OUT, sequências, placar, moderação dos chats)', implies: ['playout.view', 'live.mesa', 'live.plantao'] },
  { id: 'engine.control', area: 'Playout', label: 'Iniciar, parar e reiniciar o motor de transmissão', implies: ['playout.view'] },
  // ao vivo sem o resto do playout (docs/ACESSO.md, "Só ao vivo"): quem tem só estas abre a tela AO VIVO, a página Entrar ao
  // vivo e o app de controle no que é do ao vivo, e mais nada. Não incluem playout.view (grade, painel, estatísticas);
  // playout.control inclui as duas: quem já comandava o ar segue podendo tudo (as rotas aceitam a nova OU a antiga)
  { id: 'live.mesa', area: 'Ao vivo', label: 'Mesa AO VIVO: operar a mesa de corte (prévia, programa, cortar, transições, áudio e fontes da mesa)' },
  { id: 'live.plantao', area: 'Ao vivo', label: 'Entrar ao vivo: abrir e encerrar o plantão e a Live (tela AO VIVO, página Entrar ao vivo e app de controle) e pôr no ar a câmera do próprio aparelho' },
  { id: 'chat.moderate', area: 'Playout', label: 'Moderar o chat (apagar mensagens)', implies: ['playout.view'] },
  // alerta de emergência manual (docs/EAS.md): vai ao ar em nome de um órgão; o grupo Administradores recebe sozinho (tem
  // todas), os outros só se o admin der. Aprovar, tirar do ar e testar continuam com playout.control
  { id: 'prompter.control', area: 'Playout', label: 'Teleprompter: roteiros de qualquer programa, rolar, velocidade, o que vai à tela da câmera e os endereços dela', implies: ['playout.view'] },
  { id: 'eas.send', area: 'Playout', label: 'Alerta de emergência: pôr no ar um alerta manual (o texto que chegou da Defesa Civil por telefone, rádio ou WhatsApp)', implies: ['playout.view'] },
  { id: 'schedule.edit', area: 'Programação', label: 'Editar a grade e as regras de intervalo', implies: ['playout.view', 'media.view'] },
  { id: 'commercial.manage', area: 'Comercial', label: 'Gerenciar anunciantes, campanhas e peças; ver o vendido × exibido e emitir o comprovante de exibição', implies: ['playout.view', 'media.view'] },
  // redação e teleprompter (docs/REDACAO.md): o grupo Administradores recebe sozinho (tem todas)
  { id: 'news.edit', area: 'Jornalismo', label: 'Redação: espelhos, laudas, pautas e agências de notícias', implies: ['playout.view', 'media.view'] },
  { id: 'media.view', area: 'Biblioteca', label: 'Ver a biblioteca de mídia' },
  { id: 'media.edit', area: 'Biblioteca', label: 'Enviar, editar e excluir mídia (a excluída vai para a lixeira por 30 dias; dá para restaurar)', implies: ['media.view'] },
  // lixeira da biblioteca (server/media-trash.js): o grupo Administradores recebe sozinho (tem todas); os outros só se o admin der
  { id: 'media.purge', area: 'Biblioteca', label: 'Excluir definitivamente da lixeira da biblioteca, sem esperar os 30 dias', implies: ['media.edit'] },
  // Loja de conteúdos (docs/LOJA.md): ver a vitrine e a prévia basta media.view; adquirir (grátis ou pago) e renovar aceitam o
  // termo de licenciamento em nome da organização e podem gerar cobrança: o grupo Administradores recebe sozinho (tem todas)
  { id: 'store.buy', area: 'Biblioteca', label: 'Loja: adquirir e renovar licenças de conteúdo (grátis ou pagas), aceitando o termo de licenciamento em nome da organização', implies: ['media.edit'] },
  { id: 'products.edit', area: 'Vitrine', label: 'Gerenciar produtos e as deixas na linha do tempo', implies: ['playout.view', 'media.view'] },
  { id: 'graphics.edit', area: 'Ar', label: 'Editar gráficos: logomarca, texto rolante, tarja e o gerador de caracteres (modelos, páginas, fontes de dados e saídas Key & Fill)', implies: ['playout.view'] },
  { id: 'audio.edit', area: 'Ar', label: 'Editar áudio e sinalização: loudness, SCTE-35, DTMF e standby', implies: ['playout.view'] },
  { id: 'io.edit', area: 'Entradas e saídas', label: 'Gerenciar entradas ao vivo e saídas', implies: ['playout.view'] },
  { id: 'app.manage', area: 'App do espectador', label: 'Configurar o app: canais, recursos, avisos, loja e atualização', implies: ['playout.view'] },
  { id: 'orders.manage', area: 'App do espectador', label: 'Ver e atualizar os pedidos da loja' },
  { id: 'content.manage', area: 'App do espectador', label: 'Gerenciar conteúdo dos apps: vitrines, VOD, links e informativos', implies: ['playout.view', 'media.view'] },
  { id: 'audience.manage', area: 'App do espectador', label: 'Responder espectadores: mensagens, caixa de entrada e perfis' },
  // a rede de telas da prefeitura (modo órgão público, docs/PREFEITURA.md); o grupo Administradores recebe sozinho (tem todas)
  { id: 'prefeitura.manage', area: 'Telas', label: 'Painel da Prefeitura: telas, repartições, regiões, chaves de acesso, links de controle e alertas nas telas' },
  // TV Corporativa (docs/TV-CORPORATIVA.md): o modo corporativo do NEXA Telas; o grupo Administradores recebe sozinho
  { id: 'tvcorp.manage', area: 'Telas', label: 'TV Corporativa: telas, unidades, mídias, playlists, layouts, grade, RH, indicadores, celular e relatórios' },
  { id: 'channels.manage', area: 'Administração', label: 'Criar, editar e excluir canais', implies: ['playout.view'] },
  { id: 'users.manage', area: 'Administração', label: 'Gerenciar usuários, grupos e permissões' },
  { id: 'audit.view', area: 'Administração', label: 'Ver o registro de auditoria' },
  // docs/CENSURA.md, "Apagar e lixeira": o grupo Administradores recebe sozinho (tem todas); os outros só se o admin der
  // menu Censura (docs/ARQUIVO-LEGAL.md): a timeline do que foi ao ar e as gravações do ao vivo, dia a dia; dá para criar
  // um grupo só com ela para quem audita ou fiscaliza (sem comandar nada)
  { id: 'arquivo.view', area: 'Administração', label: 'Censura: ver a timeline da programação exibida, buscar nela, assistir às gravações do ao vivo e baixar a planilha e trechos (auditoria e fiscalização)' },
  { id: 'censura.manage', area: 'Administração', label: 'Censura: apagar gravações da censura (com confirmação dupla), abrir a lixeira da censura (com a senha dela), definir o prazo de guarda e reter períodos', implies: ['media.view', 'arquivo.view'] },
  { id: 'billing.view', area: 'Plano e cobrança', label: 'Ver plano, uso e cobrança' },
  { id: 'billing.manage', area: 'Plano e cobrança', label: 'Assinar, trocar de plano e gerenciar cobrança', implies: ['billing.view'] },
  { id: 'domains.manage', area: 'Plano e cobrança', label: 'Gerenciar domínios do cliente', implies: ['billing.view'] },
];

/**
 * Catálogo da PLATAFORMA (equipe do SaaS), separado do catálogo do cliente: um id da plataforma nunca vale dentro de um
 * cliente e vice-versa (expandPermissions/cleanPermissions recebem o escopo e ignoram ids do outro catálogo).
 */
export const PLATFORM_PERMISSIONS = [
  { id: 'platform.view', area: 'Plataforma', label: 'Ver o painel da plataforma e consultar clientes, planos e cobrança' },
  { id: 'platform.tenants', area: 'Clientes', label: 'Criar, editar, suspender e excluir clientes; redefinir a senha do administrador do cliente', implies: ['platform.view'] },
  { id: 'platform.plans', area: 'Clientes', label: 'Gerenciar planos, limites e recursos', implies: ['platform.view'] },
  { id: 'platform.billing', area: 'Cobrança', label: 'Gateway, links de cobrança, pagamentos e eventos', implies: ['platform.view'] },
  { id: 'platform.domains', area: 'Clientes', label: 'Gerenciar domínios dos clientes', implies: ['platform.view'] },
  { id: 'platform.monitor', area: 'Operação', label: 'Monitorar canais e a saúde do sistema', implies: ['platform.view'] },
  { id: 'platform.settings', area: 'Plataforma', label: 'Alterar as configurações da plataforma', implies: ['platform.view'] },
  { id: 'platform.impersonate', area: 'Operação', label: 'Entrar como um cliente (personificação)', implies: ['platform.view'] },
  { id: 'platform.staff', area: 'Plataforma', label: 'Gerenciar a equipe e os grupos da plataforma', implies: ['platform.view'] },
  { id: 'platform.audit', area: 'Plataforma', label: 'Ver a auditoria da plataforma e dos clientes', implies: ['platform.view'] },
  { id: 'platform.lab', area: 'Operação', label: 'Usar o laboratório de testes de apps: enviar pacotes, simular TVs e aparelhos, ponte com aparelho na rede local', implies: ['platform.view'] },
  { id: 'platform.content', area: 'Clientes', label: 'Gerenciar o conteúdo global e o de qualquer cliente', implies: ['platform.view'] },
  { id: 'platform.installations', area: 'Clientes', label: 'Instalações Windows: criar, liberar, bloquear, revogar, enviar mensagens e comandos, publicar atualizações', implies: ['platform.view'] },
  // Recursos e custos (docs/CUSTOS.md): consumo do servidor, por canal e por cliente, custos pelas tarifas e diagnóstico;
  // o grupo Super administradores recebe sozinho (tem todas)
  { id: 'platform.costs', area: 'Operação', label: 'Recursos e custos: ver o consumo da plataforma (servidor, canais, clientes, IA), os custos estimados e cadastrar as tarifas', implies: ['platform.view'] },
  // Denúncias do público (docs/DENUNCIAS.md): o contato que a pessoa deixou no formulário é dado pessoal; ver a fila basta platform.view
  { id: 'platform.reports', area: 'Operação', label: 'Denúncias do público: ver o contato de quem denunciou e mudar o estado das denúncias na plataforma', implies: ['platform.view'] },
  // Loja de conteúdos (docs/LOJA.md): títulos, condições, publicação, licenças, termos e o relatório da produtora; ver basta
  // platform.view. Abrir as Mídias da Loja (o painel da biblioteca da plataforma) pede também platform.impersonate
  { id: 'platform.store', area: 'Clientes', label: 'Loja de conteúdos: cadastrar e publicar títulos, condições de licença, documentos, licenças, termos e relatórios da produtora', implies: ['platform.view'] },
];
export const PLATFORM_PERM_IDS = PLATFORM_PERMISSIONS.map((p) => p.id);
const PLATFORM_BY_ID = Object.fromEntries(PLATFORM_PERMISSIONS.map((p) => [p.id, p]));

/** Escopo do catálogo: 'tenant' (cliente, padrão) ou 'platform' (equipe). */
export const catalogOf = (scope = 'tenant') => (scope === 'platform' ? PLATFORM_PERMISSIONS : PERMISSIONS);
export const permIdsOf = (scope = 'tenant') => (scope === 'platform' ? PLATFORM_PERM_IDS : PERM_IDS);
export const PERM_IDS = PERMISSIONS.map((p) => p.id);
const BY_ID = Object.fromEntries(PERMISSIONS.map((p) => [p.id, p]));

/** Lista de permissões -> conjunto com as implicadas. Ids desconhecidos são ignorados. */
export function expandPermissions(ids, scope = 'tenant') {
  const out = new Set();
  const by = scope === 'platform' ? PLATFORM_BY_ID : BY_ID;
  const add = (id) => {
    if (out.has(id) || !by[id]) return;
    out.add(id);
    (by[id].implies || []).forEach(add);
  };
  (ids || []).forEach(add);
  return out;
}

/** Só ids do catálogo, sem repetição, na ordem do catálogo. */
export const cleanPermissions = (ids, scope = 'tenant') => permIdsOf(scope).filter((id) => (ids || []).includes(id));

/* ------------------------------------------------------------------ senhas */
const KEYLEN = 64;
const COST = { N: 16384, r: 8, p: 1 };

/** Formato: scrypt$N$r$p$salt$hash (base64). Os parâmetros ficam no registro, então dá para aumentá-los depois. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(String(password), salt, KEYLEN, COST);
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scrypt(String(password), Buffer.from(salt, 'base64'), want.length, { N: Number(N), r: Number(r), p: Number(p) });
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Hash de um valor qualquer, para gastar o mesmo tempo quando o usuário não existe (não revela quais usuários existem). */
export const DUMMY_HASH = await hashPassword(randomBytes(8).toString('hex'));

const COMMON = new Set(['12345678', '123456789', '1234567890', 'password', 'senha123', 'senha1234', 'admin123', 'admin1234', 'qwerty123', 'abcd1234', '11111111', '00000000']);

/** Política de senha. Lança Error com a mensagem para o usuário. */
export function checkPasswordPolicy(password, { username = '', production = false } = {}) {
  const min = production ? 10 : 8;
  const pw = String(password ?? '');
  if (pw.length < min) throw new Error(`A senha precisa ter pelo menos ${min} caracteres.`);
  if (pw.length > 200) throw new Error('A senha é longa demais (máximo 200 caracteres).');
  if (username && pw.toLowerCase() === String(username).toLowerCase()) throw new Error('A senha não pode ser igual ao usuário.');
  if (COMMON.has(pw.toLowerCase())) throw new Error('Essa senha é comum demais. Escolha outra.');
  if (/^(.)\1+$/.test(pw)) throw new Error('A senha não pode repetir o mesmo caractere.');
}

/** Usuário: 3 a 64 caracteres; letras minúsculas, números, ponto, hífen, sublinhado e (uma vez) "@" para aceitar e-mails. Único na plataforma inteira. */
export const USERNAME_RE = /^(?=.{3,64}$)[a-z0-9][a-z0-9._+-]*(@[a-z0-9][a-z0-9.-]*)?$/;

/* ------------------------------------------------------------------ sessões assinadas (HMAC, sem estado) */
export const SESSION_MS = 12 * 3600 * 1000;

export function createSessions(secret) {
  const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');
  return {
    /** O token leva o id do usuário e a versão de sessão; mudar a senha ou desativar a conta invalida os tokens antigos. */
    issue(user, { imp, ttlMs = SESSION_MS, now = Date.now() } = {}) {
      // tid: cliente do usuário (ausente para a equipe da plataforma); imp: id do usuário da plataforma que personifica o cliente
      // n: identificador único do token (vira o jti "uid.n" da lista de revogação do "Sair"; ver auth.js)
      const body = { uid: user.id, ver: user.ver, exp: now + ttlMs, n: randomBytes(9).toString('hex') };
      if (user.tenantId != null) body.tid = user.tenantId;
      if (imp != null) body.imp = imp;
      const p = Buffer.from(JSON.stringify(body)).toString('base64url');
      return `${p}.${sign(p)}`;
    },
    /**
     * Devolve {uid, ver, exp, jti[, tid, imp]} se a assinatura e a validade estão corretas; senão null.
     * jti = "uid.n" (identifica ESTE token na lista de revogação; null em token sem nonce).
     */
    read(token, now = Date.now()) {
      const [p, sig] = String(token || '').split('.');
      if (!p || !sig) return null;
      const want = Buffer.from(sign(p)); const got = Buffer.from(sig);
      if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
      try {
        const d = JSON.parse(Buffer.from(p, 'base64url').toString());
        if (!(d.exp > now) || !Number.isInteger(d.uid)) return null;
        const out = { uid: d.uid, ver: d.ver, exp: d.exp, jti: typeof d.n === 'string' && d.n ? `${d.uid}.${d.n}`.slice(0, 80) : null };
        if (d.tid != null) out.tid = d.tid;
        if (d.imp != null) out.imp = d.imp;
        return out;
      } catch { return null; }
    },
  };
}
