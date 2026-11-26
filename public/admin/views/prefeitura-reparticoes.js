// Painel da Prefeitura · Repartições (docs/PREFEITURA.md, "Repartições: o assistente e a ficha"): o assistente de nova repartição
// (1. o TIPO num catálogo de cartões, com a prévia da TV box no layout de fábrica do tipo e a troca de layout ali mesmo;
// 2. nome, endereço, região e mapa, no formulário de sempre; 3. o LINK e a SENHA do painel da repartição, com o olho e o
// copiar), a ficha de cada repartição (tipo, layout, link e senha com o olho, as TV box vinculadas, o alcance dos alertas
// das repartições de emergência) e as janelas que a ficha abre. Texto só por textContent (el), nenhum endereço de fora.
import { el, api, guard, toast, copyText } from '../lib.js';
import { icon } from '../icons.js';
import { tvPreview } from '../../shared/telas-previa.js';
import { OFFICE_TYPES, OFFICE_TYPE, FAMILIES, familyOf, typeLabel, layoutLabel, LAYOUTS, REACH_MODES, reachText, deviceStatus, STATUS_LABEL } from '../../shared/telas-tipos.js';
import { defaultLayout, layoutsFor, sampleFor } from '../../shared/telas-amostras.js';

/* ------------------------------------------------------------------ os ícones dos tipos (um por família, traço simples) */
const FAMILY_ICON = {
  comando: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a3 3 0 0 1 0 6M18 6a7 7 0 0 1 0 12',
  emergencia: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  pronto: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  senha: 'M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM10 7v10',
  educacao: 'M3 5h7a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H3zM21 5h-7a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h7z',
  informacao: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 11v6M12 7.5v.5',
  geral: 'M4 21V5l8-3l8 3v16zM9 21v-5h6v5M8 8h2M14 8h2M8 12h2M14 12h2',
  cco: 'M12 3l8 3v6c0 5-3.5 8-8 9c-4.5-1-8-4-8-9V6z',
  'policia-civil': 'M12 3l2.6 5.3l5.9.9l-4.3 4.1l1 5.8L12 16.4l-5.2 2.7l1-5.8L3.5 9.2l5.9-.9z',
  'policia-militar': 'M12 3l8 3v6c0 5-3.5 8-8 9c-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5l4.5-5',
};
const NS = 'http://www.w3.org/2000/svg';
/** O ícone do tipo (o da família dele), decorativo. */
export function typeIcon(type) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', `pf-ticon fam-${familyOf(type)}`); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', FAMILY_ICON[familyOf(type)] || FAMILY_ICON.geral); s.append(p);
  return s;
}

/* ------------------------------------------------------------------ passo 1: o tipo e o layout, com a prévia */
/**
 * O catálogo de tipos com a prévia. Ao continuar, chama next({ type, layout }) (o passo 2 é o formulário de repartição de
 * sempre, já com o tipo e o layout escolhidos).
 */
export function officeWizard(ui, next) {
  let type = null; let layout = null;
  const pv = el('div', { class: 'pf-wiz-pv' });
  const lays = el('div', { class: 'pf-seg', role: 'group', 'aria-label': 'Layout da tela' });
  const about = el('p', { class: 'dim small' });
  const famName = (k) => FAMILIES.find((f) => f.key === familyOf(k))?.label || '';
  const cards = OFFICE_TYPES.filter((t) => !t.corp).map((t) => el('button', { type: 'button', class: 'pf-type', 'data-type': t.key, 'aria-pressed': 'false', title: t.desc || t.label, onclick: () => pick(t.key) },
    typeIcon(t.key), el('b', { text: t.short }), el('span', { class: 'dim small', text: famName(t.key) })));
  function paintPreview() {
    if (!type) { pv.replaceChildren(el('div', { class: 'pf-wiz-empty dim', text: 'Escolha o tipo da repartição: a prévia da tela da TV box aparece aqui.' })); lays.replaceChildren(); about.textContent = ''; return; }
    pv.replaceChildren(el('figure', { class: 'tv-previa-fig' }, tvPreview(sampleFor(type, layout)), el('figcaption', { text: `${layoutLabel(layout)} · conteúdo de exemplo de ${OFFICE_TYPE[type].short} (a tela de verdade mostra o que a repartição cadastrar)` })));
    lays.replaceChildren(...layoutsFor(type).map((k) => el('button', { type: 'button', class: `pf-chip pf-chip-btn${k === layout ? ' on' : ''}`, 'aria-pressed': String(k === layout), title: LAYOUTS.find((l) => l.key === k)?.desc || '', onclick: () => { layout = k; paintPreview(); } }, layoutLabel(k))));
    about.textContent = OFFICE_TYPE[type].desc || `Layout de fábrica de ${OFFICE_TYPE[type].short}: ${layoutLabel(defaultLayout(type))}. Dá para trocar aqui ou depois.`;
  }
  function pick(k) {
    type = k; layout = defaultLayout(k);
    for (const c of cards) { const on = c.getAttribute('data-type') === k; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); }
    paintPreview();
  }
  paintPreview();
  const body = el('div', { class: 'pf-wiz' },
    el('div', {}, el('div', { class: 'label', text: '1. Que tipo de repartição é?' }), el('div', { class: 'pf-types' }, ...cards)),
    el('div', { class: 'pf-wiz-side' }, el('div', { class: 'label', text: 'Como aparece na TV box' }), pv, el('div', { class: 'label', text: 'Layout' }), lays, about));
  ui.dialog('Nova repartição · 1 de 3: o tipo', body, {
    wide: true, saveLabel: 'Continuar',
    save: () => { if (!type) throw new Error('Escolha o tipo da repartição.'); next({ type, layout }); },
  });
}

/* ------------------------------------------------------------------ o link e a senha do painel da repartição (o "olho") */
const MASK = '••••••••••••';
/**
 * As linhas "Link" e "Senha" com o olho (mostra/oculta) e o copiar. O texto só vem do servidor quando alguém clica (POST
 * …/access, que fica na auditoria). shown: { url, password } já conhecidos (o fim do assistente). onChange(): a ficha relê.
 */
export function accessBox(ui, o, { shown = null, onChange = null } = {}) {
  const box = el('div', { class: 'pf-access' });
  let got = shown ? { state: shown.password ? 'ok' : 'users', url: shown.url, password: shown.password || null, users: !shown.password } : null;
  let open = { url: Boolean(shown), password: Boolean(shown) };
  const reveal = async () => { if (!got) got = await api(`/api/prefeitura/offices/${o.id}/access`, { method: 'POST', body: {} }); return got; };
  const after = async () => { got = null; open = { url: false, password: false }; if (onChange) await onChange(); else paint(); };
  const regen = (label, title, fn) => el('button', { class: 'btn small', type: 'button', title, onclick: guard(async () => { const r = await fn(); if (r === false) return; got = { ...(await reveal()), ...r }; open = { url: true, password: true }; paint(); if (onChange) onChange(true); }) }, label);
  const genAll = () => regen(o.link.on ? 'Gerar novo link e senha' : 'Gerar link e senha', 'Sorteia uma senha forte e gera o link (o link e a senha de antes deixam de valer).', async () => {
    if (o.link.on && !confirm(`Gerar outro link e outra senha para "${o.name}"? Os de antes deixam de valer e quem estava com a página aberta precisa entrar de novo.`)) return false;
    const r = await api(`/api/prefeitura/offices/${o.id}/link`, { method: 'POST', body: { generate: true } }); o.link = r.office.link; o.access = r.office.access;
    got = null; return {};
  });
  const genPass = () => regen('Gerar nova senha', 'Sorteia uma senha nova (a de antes deixa de valer; o link continua).', async () => {
    if (!confirm(`Gerar uma senha nova para o painel de "${o.name}"? A de antes deixa de valer.`)) return false;
    await api(`/api/prefeitura/offices/${o.id}/link/password`, { method: 'PUT', body: { generate: true } }); got = null; return {};
  });
  const genLink = () => regen('Gerar novo link', 'Gera um endereço novo (o de antes deixa de valer; a senha continua).', async () => {
    if (!confirm(`Gerar outro link para "${o.name}"? O de antes deixa de valer.`)) return false;
    const r = await api(`/api/prefeitura/offices/${o.id}/link`, { method: 'POST', body: {} }); o.link = r.office.link; got = null; return {};
  });
  function row(label, key, value, hint) {
    const on = open[key] && value;
    const eye = el('button', { class: 'btn small icon-only', type: 'button', 'aria-label': on ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`, title: on ? 'Ocultar' : 'Mostrar', onclick: guard(async () => { await reveal(); open[key] = !open[key]; paint(); }) }, icon(on ? 'eye-off' : 'eye'));
    const copy = el('button', { class: 'btn small icon-only', type: 'button', 'aria-label': `Copiar ${label.toLowerCase()}`, title: 'Copiar', onclick: guard(async () => { const g = await reveal(); const v = key === 'url' ? g.url : g.password; if (!v) { paint(); return toast(`${label}: não dá para mostrar (definido antes). Gere de novo.`, true); } copyText(v); }) }, icon('copy'));
    return el('div', { class: 'pf-secret' }, el('span', { class: 'pf-secret-k', text: label }), el('code', { class: `pf-secret-v${on ? '' : ' masked'}`, text: on ? value : MASK }), eye, copy, hint ? el('small', { class: 'dim', text: hint }) : null);
  }
  function paint() {
    const kids = [];
    if (!o.link.on) kids.push(el('p', { class: 'dim small', text: 'Sem link do painel ainda.' }), el('div', { class: 'pf-btns left' }, genAll()));
    else if (got && got.state === 'legacy' && !got.url) kids.push(el('p', { class: 'pf-err small', text: 'Link e senha definidos antes: só o resumo ficou guardado. Gere novos para poder vê-los.' }), el('div', { class: 'pf-btns left' }, got.users ? genLink() : genAll()));
    else {
      kids.push(row('Link', 'url', got?.url));
      if (o.users || got?.users) kids.push(el('p', { class: 'dim small', text: `Esta repartição entra com usuário e senha (${o.users || ''} usuário(s): botão Usuários). A senha única do link não vale mais.` }));
      else if (got && got.state === 'legacy') kids.push(el('div', { class: 'pf-secret' }, el('span', { class: 'pf-secret-k', text: 'Senha' }), el('span', { class: 'pf-err small', text: 'Senha definida antes; gere uma nova para poder vê-la.' }), genPass()));
      else kids.push(row('Senha', 'password', got?.password, shown && 'Passe a senha por outro caminho que não o do link (por telefone, por exemplo).'));
      if (!got) kids.push(el('small', { class: 'dim', text: 'O olho e o copiar mostram o link e a senha só para quem administra a prefeitura, e ficam no registro de auditoria.' }));
    }
    box.replaceChildren(...kids);
  }
  paint();
  return box;
}
/** O fim do assistente: a repartição criada, com o link e a senha já à vista. */
export function accessResult(ui, o, shown, { addBox, pin = null }) {
  ui.dialog(`Nova repartição · 3 de 3: ${o.name}`, el('div', { class: 'pf-grid' },
    el('p', { class: 'small', text: `Pronto. Este é o painel de "${o.name}": quem tiver o link E a senha cuida das telas, dos avisos e dos alertas dela.` }),
    accessBox(ui, o, { shown }),
    pin ? el('div', { class: 'pf-keybox' },
      el('p', { class: 'dim small', text: 'PIN de saída das TV box desta repartição (outra coisa que a senha do painel): destrava o aparelho no local, pelo controle remoto, depois da sequência de saída. Aparece só agora; se perder, gere outro na ficha.' }),
      el('div', { class: 'pf-key', text: pin }), el('button', { class: 'btn small', type: 'button', onclick: () => copyText(pin) }, 'Copiar o PIN')) : null,
    el('p', { class: 'dim small', text: 'Dá para ver o link e a senha de novo na ficha da repartição (o olho). As TV box que você cadastrar a partir da ficha já nascem vinculadas a ela.' }),
    el('div', { class: 'pf-btns left' }, el('button', { class: 'btn primary', type: 'button', onclick: () => addBox(o) }, 'Cadastrar a primeira TV box'))));
}

/* ------------------------------------------------------------------ as TV box da repartição */
export function officeDevices(ui, o, { editDevice, addBox, now }) {
  const list = ui.data().devices.filter((d) => d.officeId === o.id && !d.revokedAt);
  const rows = list.map((d) => { const st = deviceStatus(d, now()); return el('tr', {},
    el('td', {}, el('span', { class: `pf-dot ${st}`, role: 'img', 'aria-label': STATUS_LABEL[st] }), ' ', el('b', { text: d.name })), el('td', { class: 'mono', text: `#${d.id}` }), el('td', { text: STATUS_LABEL[st] }),
    el('td', { text: d.lastSeen ? ui.when(d.lastSeen) : 'nunca' }), el('td', { text: [d.model, d.appVersion && `app ${d.appVersion}`].filter(Boolean).join(' · ') || '—' }),
    el('td', { class: 'pf-actions' }, el('button', { class: 'btn small', type: 'button', title: 'Editar a tela ou passá-la para outra repartição', onclick: () => editDevice(d) }, 'Editar ou mover'))); });
  const w = ui.dialog(`TV box de ${o.name}`, el('div', {},
    el('p', { class: 'dim small', text: 'Toda TV box cadastrada pela chave desta repartição (aqui, na aba Telas com a repartição escolhida, ou pelo painel da própria repartição) já nasce vinculada a ela. Para passar uma tela para outra repartição: Editar ou mover.' }),
    rows.length ? ui.table(['TV box', 'ID', 'Situação', 'Último sinal', 'Aparelho', ''], rows) : el('p', { class: 'dim', text: 'Nenhuma TV box vinculada ainda.' }),
    el('div', { class: 'pf-btns left' }, el('button', { class: 'btn primary', type: 'button', onclick: () => { w.close(); addBox(o); } }, 'Cadastrar TV box nesta repartição'))));
}

/* ------------------------------------------------------------------ o alcance dos alertas (repartições de emergência) */
export function reachDialog(ui, o) {
  const d = ui.data(); const r = o.reach;
  let mode = r.mode; const regs = new Set(r.regions); const grps = new Set(r.groups);
  const eas = el('input', { type: 'checkbox', checked: r.eas });
  const picks = el('div', {});
  const checks = (list, set, empty) => (list.length ? el('div', { class: 'pf-checks' }, ...list.map((x) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: set.has(x.id), onchange: (e) => { if (e.target.checked) set.add(x.id); else set.delete(x.id); } }), el('span', { text: x.name })))) : el('p', { class: 'dim small', text: empty }));
  const paintPicks = () => picks.replaceChildren(...(mode === 'pick' ? [el('div', { class: 'label', text: 'Regiões' }), checks(d.regions, regs, 'Nenhuma região cadastrada (aba Regiões).'), el('div', { class: 'label', text: 'Grupos de telas' }), checks(d.groups, grps, 'Nenhum grupo cadastrado (aba Grupos).')] : []));
  const modes = el('div', { class: 'pf-checks' }, ...REACH_MODES.map((m) => el('label', { class: 'pf-check' }, el('input', { type: 'radio', name: `reach-${o.id}`, value: m.key, checked: m.key === mode, onchange: () => { mode = m.key; paintPicks(); } }), el('span', { text: m.label }))));
  paintPicks();
  ui.dialog(`Alcance dos alertas · ${o.name}`, el('div', { class: 'pf-reach' },
    el('p', { class: 'dim small', text: `Quando "${o.name}" manda um alerta para o "Alcance da prefeitura" pelo painel dela, ele aparece em todas estas telas ao mesmo tempo (cada TV box recebe no próximo sinal de vida, a cada 10 segundos no máximo). As regras continuam: Severo e Extremo, tipos de aviso e a aprovação de cada repartição.` }),
    modes, picks,
    // DIGITAL ISP: sem canais no ar, o alerta fica só nas telas (o "também no ar dos canais" do NEXA não existe aqui)
    el('p', { class: 'dim small', text: 'Não envia nada a celulares nem a sistemas nacionais: são só as telas da prefeitura.' })), {
    save: async () => {
      const out = await api(`/api/prefeitura/offices/${o.id}/reach`, { method: 'PUT', body: { mode, regions: [...regs], groups: [...grps], eas: eas.checked } });
      toast(`Alcance salvo: ${out.text} (${out.preview.total} tela(s) hoje).`);
      await ui.reload();
    },
  });
}

/* ------------------------------------------------------------------ a ficha de cada repartição */
/**
 * O cartão da repartição: tipo, layout, o painel (link e senha com o olho), as TV box vinculadas e, nas de emergência, o
 * alcance dos alertas. deps: { editOffice, officeUsers, addBox, editDevice, newPin, remove, now, regionName }.
 */
export function officeCard(ui, o, deps) {
  const def = ui.data().defaults.config;
  const mine = ui.data().devices.filter((d) => d.officeId === o.id && !d.revokedAt);
  const st = mine.map((d) => deviceStatus(d, deps.now()));
  const on = st.filter((s) => s === 'on').length;
  const layout = o.config.layout ? layoutLabel(o.config.layout) : `o da prefeitura (${layoutLabel(def.layout || 'full')})`;
  const reach = o.hasReach ? reachText(o.reach, ui.data()) : null;
  return el('article', { class: 'pf-rep' },
    el('header', { class: 'pf-rep-head' }, typeIcon(o.type),
      el('div', {}, el('b', { text: o.name }), el('div', { class: 'dim small', text: [typeLabel(o.type), deps.regionName(o.regionId), o.address || 'sem endereço', o.lat != null ? null : 'sem ponto no mapa'].filter(Boolean).join(' · ') }))),
    el('dl', { class: 'pf-rep-dl' },
      el('dt', { text: 'Layout' }), el('dd', { text: layout }),
      el('dt', { text: 'Painel' }), el('dd', {}, accessBox(ui, o, { onChange: (keep) => (keep ? null : ui.reload()) })),
      el('dt', { text: 'TV box' }), el('dd', {},
        el('div', { class: 'pf-devs' }, el('b', { text: `${mine.length}` }), mine.length ? el('span', { class: 'small', text: ` · ${on} no ar · ${mine.length - on} fora` }) : el('span', { class: 'dim small', text: ' nenhuma vinculada' }),
          ...mine.slice(0, 24).map((d, i) => el('span', { class: 'pf-devchip', title: `${d.name} · ${STATUS_LABEL[st[i]]}` }, el('span', { class: `pf-dot ${st[i]}` }), ` #${d.id}`)), mine.length > 24 ? el('span', { class: 'dim small', text: ` +${mine.length - 24}` }) : null),
        el('div', { class: 'pf-btns left' },
          el('button', { class: 'btn small', type: 'button', onclick: () => officeDevices(ui, o, deps) }, 'Ver as TV box'),
          el('button', { class: 'btn small', type: 'button', title: 'Gera a chave de uso único de uma TV box que já nasce vinculada a esta repartição.', onclick: () => deps.addBox(o) }, '+ TV box'))),
      ...(reach ? [el('dt', { text: 'Alcance dos alertas' }), el('dd', {}, el('div', { class: 'pf-devs' }, el('span', { text: `${reach}` }), el('button', { class: 'btn small', type: 'button', onclick: () => reachDialog(ui, o) }, 'Alterar')))] : [])),
    el('footer', { class: 'pf-actions' },
      el('button', { class: 'btn small', type: 'button', onclick: () => deps.editOffice(o) }, 'Editar'),
      el('button', { class: 'btn small', type: 'button', title: 'Os usuários (usuário e senha) do painel desta repartição.', onclick: () => deps.officeUsers(o) }, 'Usuários'),
      o.users ? null : el('button', { class: 'btn small', type: 'button', title: 'Escrever a senha do painel à mão (em vez da sorteada).', onclick: () => deps.officeLink(o) }, 'Senha à mão'),
      el('button', { class: 'btn small', type: 'button', title: 'O PIN de saída destrava a TV box no local, pelo controle remoto. Não é a senha do painel da repartição. Sorteia um novo e mostra uma vez.', onclick: deps.newPin }, 'PIN de saída da TV box (novo)'),
      el('button', { class: 'btn small danger', type: 'button', onclick: deps.remove }, 'Excluir')));
}
