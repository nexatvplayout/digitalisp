// Superadmin · Integrações: de onde vêm os dados das telas (clima, cotações, notícias, CEP, mapa, rádios, agendas) e o
// que ainda falta contratar (boleto e Pix, WhatsApp, e-mail). O clima tem a fonte escolhida aqui; a chave do plano comercial
// é digitada aqui pelo dono e fica cifrada no servidor (nunca volta à tela). Rotas: /api/platform/integracoes (server/integracoes.js).
import { el, api, toast, guard } from '../lib.js';

const card = (...kids) => el('div', { class: 'card ig-card' }, ...kids);
const chip = (ok, text) => el('span', { class: `ig-chip ${ok ? 'ok' : ok === false ? 'bad' : 'wait'}`, text });

function testar(id, out) {
  return guard(async () => {
    out.className = 'small ig-res'; out.textContent = 'Testando…';
    const r = await api(`/api/platform/integracoes/${id}/testar`, { method: 'POST' });
    out.className = `small ig-res ${r.ok ? 'ok' : 'bad'}`;
    out.textContent = `${r.ok ? '✓' : '✗'} ${r.message}${r.latencyMs != null ? ` (${r.latencyMs} ms)` : ''}`;
  });
}

function climaCard(c, again) {
  const sel = el('select', { 'aria-label': 'Fonte do clima' }, ...c.providers.map((p) => el('option', { value: p.id, disabled: !p.ready, selected: p.id === c.provider, text: `${p.label}${p.needsKey ? ' (com chave)' : ' (sem chave)'}${p.ready ? '' : ' · em breve'}` })));
  const key = el('input', { type: 'password', autocomplete: 'off', placeholder: 'Chave do plano comercial (fica cifrada no servidor)' });
  const notaP = el('p', { class: 'small dim' });
  const keyBox = el('div', { class: 'ig-key' });
  const paint = () => {
    const p = c.providers.find((x) => x.id === sel.value);
    notaP.textContent = p?.note || '';
    keyBox.hidden = !p?.needsKey;
    key.placeholder = p?.keySet ? (p.keyReadable === false ? 'A chave salva ficou ilegível: digite de novo' : '•••••••• (salva; digite para trocar)') : 'Chave do plano comercial (fica cifrada no servidor)';
  };
  sel.addEventListener('change', paint);
  const out = el('p', { class: 'small ig-res' });
  const salvar = guard(async () => {
    const body = { provider: sel.value };
    if (key.value.trim()) { body.key = key.value.trim(); body.keyFor = sel.value; }
    await api('/api/platform/integracoes/clima', { method: 'PUT', body });
    key.value = '';
    toast('Fonte do clima salva. Vale na hora para todas as telas.');
    await again();
  });
  paint();
  return card(
    el('div', { class: 'ig-head' }, el('h3', { text: 'Clima e previsão' }), chip(true, `em uso: ${c.providers.find((p) => p.id === c.provider)?.label || c.provider}`)),
    el('p', { class: 'small dim', text: 'Alimenta o gadget e a zona de clima e a previsão das telas. Escolha a fonte; a troca vale na hora para todas as revendas.' }),
    el('label', { class: 'rv-f' }, el('span', { text: 'Fonte' }), sel), notaP,
    keyBox,
    el('div', { class: 'pf-btns left' }, el('button', { type: 'button', class: 'btn primary small', onclick: salvar, text: 'Salvar' }), el('button', { type: 'button', class: 'btn small', onclick: testar('clima', out), text: 'Testar agora' })),
    out,
    el('p', { class: 'small dim', text: `Cidades guardadas: ${c.cities} · consultas na última hora: ${c.callsLastHour} de ${c.limits.callsPerHour} · cada cidade é guardada por ${c.limits.cacheMin} min.` }),
    (() => { keyBox.append(el('label', { class: 'rv-f' }, el('span', { text: 'Chave' }), key)); return null; })());
}

export async function paintIntegracoes(root) {
  root.replaceChildren(el('p', { class: 'dim', text: 'Carregando…' }));
  const d = await api('/api/platform/integracoes');
  const again = () => paintIntegracoes(root);
  const fixas = d.fixas.map((f) => {
    const out = el('p', { class: 'small ig-res' });
    return card(
      el('div', { class: 'ig-head' }, el('h3', { text: f.nome }), chip(true, 'ativa · sem chave')),
      el('p', { class: 'small', text: `Fonte: ${f.fonte}` }),
      el('p', { class: 'small dim', text: `Usada em: ${f.usa}${f.info ? ` · ${f.info}` : ''}` }),
      f.testavel ? el('div', { class: 'pf-btns left' }, el('button', { type: 'button', class: 'btn small', onclick: testar(f.id, out), text: 'Testar agora' })) : null,
      out);
  });
  const pend = d.pendentes.map((p) => card(
    el('div', { class: 'ig-head' }, el('h3', { text: p.nome }), chip(null, 'a contratar')),
    el('p', { class: 'small dim', text: `Para: ${p.usa}` }),
    el('p', { class: 'small', text: p.nota })));
  root.replaceChildren(
    el('p', { class: 'dim', text: 'De onde vêm os dados que as telas mostram. As fontes abertas não precisam de chave; as que dependem de contrato aparecem como "a contratar".' }),
    el('div', { class: 'ig-grid' }, climaCard(d.clima, again), ...fixas),
    el('h3', { class: 'ig-sec', text: 'Armazenamento' }),
    el('div', { class: 'ig-grid' }, card(el('div', { class: 'ig-head' }, el('h3', { text: 'Arquivos das telas (imagens e vídeos)' }), chip(d.armazenamento.driver === 'r2', d.armazenamento.driver === 'r2' ? 'Cloudflare R2' : 'no servidor')), el('p', { class: 'small', text: d.armazenamento.nota }))),
    el('h3', { class: 'ig-sec', text: 'A contratar' }),
    el('div', { class: 'ig-grid' }, ...pend));
}
