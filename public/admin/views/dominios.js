// Domínio próprio (white-label): o painel e a entrada das telas no endereço da revenda ou do cliente (ex.:
// telas.suaempresa.com.br), com os registros de DNS que faltam e o passo a passo. Rotas: /api/dominios (server/dominios.js).
import { el, api, toast, guard } from '../lib.js';

const ESTADO = { ativo: ['ok', 'Ativo'], 'emitindo o certificado': ['wait', 'Emitindo o certificado'], 'aguardando o DNS': ['wait', 'Aguardando o DNS'], 'aguardando a plataforma': ['wait', 'Aguardando a plataforma'] };
const copiar = (t) => () => navigator.clipboard?.writeText(t).then(() => toast('Copiado.'), () => {});

function registros(d) {
  return el('table', { class: 'tbl dm-tbl' },
    el('thead', {}, el('tr', {}, ...['Tipo', 'Nome', 'Valor', 'Para quê'].map((h) => el('th', { text: h })))),
    el('tbody', {}, ...d.records.map((r) => el('tr', {},
      el('td', {}, el('b', { text: r.type })),
      el('td', {}, el('code', { text: r.name }), ' ', el('button', { type: 'button', class: 'btn small', text: 'Copiar', onclick: copiar(r.name) })),
      el('td', {}, el('code', { text: r.value }), ' ', el('button', { type: 'button', class: 'btn small', text: 'Copiar', onclick: copiar(r.value) })),
      el('td', { class: 'dim small', text: r.why || '' })))));
}

export async function paintDominios(root) {
  root.replaceChildren(el('p', { class: 'dim', text: 'Carregando…' }));
  const d = await api('/api/dominios');
  const again = () => paintDominios(root);
  const conta = await api('/api/conta').catch(() => ({}));
  const lista = conta.tipo === 'revenda' ? await api('/api/revenda/clientes').catch(() => []) : [];
  const clientes = Array.isArray(lista) ? lista : lista?.clientes || [];
  const host = el('input', { type: 'text', placeholder: 'telas.suaempresa.com.br', autocomplete: 'off', 'aria-label': 'Endereço' });
  const para = el('select', { 'aria-label': 'Para quem' }, el('option', { value: '', text: conta.tipo === 'revenda' ? 'A minha revenda' : 'A minha conta' }), ...clientes.map((c) => el('option', { value: String(c.id), text: `Cliente: ${c.name}` })));
  const add = guard(async () => {
    await api('/api/dominios', { method: 'POST', body: { hostname: host.value, ...(para.value ? { tenantId: Number(para.value) } : {}) } });
    toast('Domínio cadastrado. Crie os registros de DNS abaixo e clique em Verificar.');
    await again();
  });
  const cards = d.domains.map((x) => {
    const [cls, txt] = ESTADO[x.estado] || ['wait', x.estado];
    return el('div', { class: 'card dm-card' },
      el('div', { class: 'ig-head' }, el('h3', { text: x.hostname }), el('span', { class: `ig-chip ${cls}`, text: txt })),
      el('p', { class: 'small dim', text: `Conta: ${x.conta}${x.estado === 'ativo' ? ` · abre a entrada com a marca dela em https://${x.hostname}` : ''}` }),
      x.estado === 'ativo' ? null : registros(x),
      x.estado === 'aguardando a plataforma' ? el('p', { class: 'small', text: 'Já pode criar o CNAME. A equipe da DIGITAL ISP ainda está ligando a emissão automática do certificado; quando ligar, os registros de verificação aparecem aqui.' }) : null,
      x.lastError ? el('p', { class: 'small ig-res bad', text: x.lastError }) : null,
      el('div', { class: 'pf-btns left' },
        x.estado === 'ativo' ? el('a', { class: 'btn small', href: `https://${x.hostname}`, target: '_blank', rel: 'noopener', text: 'Abrir' }) : el('button', { type: 'button', class: 'btn small primary', text: 'Verificar agora', onclick: guard(async () => { const r = await api(`/api/dominios/${x.id}/verificar`, { method: 'POST' }); toast(r.estado === 'ativo' ? 'Domínio ativo!' : `Ainda: ${r.estado}. O DNS pode levar de minutos a algumas horas.`); await again(); }) }),
        el('button', { type: 'button', class: 'btn small danger', text: 'Retirar', onclick: guard(async () => { if (!confirm(`Retirar ${x.hostname}? O endereço deixa de abrir o painel.`)) return; await api(`/api/dominios/${x.id}`, { method: 'DELETE' }); await again(); }) })));
  });
  root.replaceChildren(
    el('p', { class: 'dim', text: 'Use o seu próprio endereço para o painel e para a entrada das telas, com a sua marca. Cada conta pode ter até 5 endereços.' }),
    d.pode ? el('div', { class: 'card' },
      el('h3', { text: 'Novo domínio' }),
      el('div', { class: 'dm-add' }, host, clientes.length ? para : null, el('button', { type: 'button', class: 'btn primary', text: 'Cadastrar', onclick: add })),
      el('details', { class: 'dm-help' }, el('summary', { text: 'Como configurar o domínio (passo a passo)' }),
        el('ol', {},
          el('li', { text: 'Escolha um subdomínio do seu domínio, por exemplo telas.suaempresa.com.br ou painel.suaempresa.com.br, e cadastre aqui.' }),
          el('li', { text: 'Entre no painel de quem cuida do DNS do seu domínio (Registro.br, Cloudflare, GoDaddy, HostGator, Locaweb…) e crie os registros da tabela: o CNAME e os TXT, com o nome e o valor exatamente como aparecem (use o botão Copiar).' }),
          el('li', { text: `O CNAME aponta para ${d.entrada}. Se o seu DNS estiver no Cloudflare, deixe esse registro com a nuvem cinza ("Somente DNS").` }),
          el('li', { text: 'No Registro.br: Domínio → DNS → Editar zona → Nova entrada. Em "Nome" vai só a parte antes do seu domínio (ex.: telas); o Registro.br completa o resto.' }),
          el('li', { text: 'Volte aqui e clique em "Verificar agora". O DNS pode levar de alguns minutos a algumas horas para valer; o certificado de segurança (https) sai sozinho logo depois.' }),
          el('li', { text: 'Domínio sem subdomínio (suaempresa.com.br) só funciona se o seu DNS aceitar CNAME na raiz (o Cloudflare aceita); no Registro.br, use um subdomínio.' }))))
      : el('div', { class: 'card' }, el('p', { text: 'O domínio próprio faz parte do módulo "Marca própria". Peça a liberação no seu plano.' })),
    d.domains.length ? el('div', { class: 'ig-grid dm-grid' }, ...cards) : el('p', { class: 'dim', text: 'Nenhum domínio próprio ainda.' }));
}
