// NEXA Telas · página de controle da repartição · aba Telas (só o gestor): tudo o que o Painel da Prefeitura faz numa TV
// box, restrito às telas DESTA repartição. A lista com a situação, a última captura e "Capturar agora", os comandos
// (recarregar, reiniciar o app, reiniciar o aparelho), renomear, o que a tela define (formato, volume, horário de ligar e
// desligar, lateral), a chave de ativação de uma TV box nova já vinculada a esta repartição, e revogar. O servidor confere
// a repartição em toda rota (/api/reparticao/devices, /api/reparticao/keys).
import { LAYOUTS, STATUS_LABEL, WIDGETS, COMMANDS, deviceStatus, layoutLabel, THEME_COLORS, THEME_MODES } from '/shared/telas-tipos.js';
import { tvPreview } from '/shared/telas-previa.js';
import { sampleFor } from '/shared/telas-amostras.js';
import { S, el, put, api, apiImage, act, ok, card, cols, field, option, check, ago, hhmm, hour, now } from '/reparticao/rep-base.js';

/** O tema dos painéis de senha (contrato §15): dois selects (cor e claro/escuro); '' = segue o nível de cima. */
export function themeSelects(theme, inherit) {
  const color = el('select', {}, option('', inherit, !theme), ...THEME_COLORS.map((c) => option(c.hex, c.label, theme?.color === c.hex)));
  const mode = el('select', {}, option('', inherit, !theme), ...THEME_MODES.map((m) => option(m.key, m.label, theme?.mode === m.key)));
  return { color, mode, read: () => (color.value || mode.value ? { color: color.value || THEME_COLORS[0].hex, mode: mode.value || 'dark' } : null) };
}

/** O som da chamada de senha (contrato §16): bipe, falada ou bipe + falada; '' = não define. */
export const CALL_SOUNDS = [['beep', 'Bipe'], ['voice', 'Falada'], ['both', 'Bipe + falada']];
export const callSoundSelect = (mode, inherit) => el('select', {}, option('', inherit, !mode), ...CALL_SOUNDS.map(([k, n]) => option(k, n, mode === k)));

const DAYS = [['seg', 1], ['ter', 2], ['qua', 3], ['qui', 4], ['sex', 5], ['sáb', 6], ['dom', 0]];
const pct = (v) => (v == null ? '—' : `${String(v).replace('.', ',')}%`);
/** "Recepção · no ar desde 07:02" / "desligada há 3 h". */
export function sinceText(d, t = now()) {
  const st = d.status || deviceStatus(d, t);
  if (st === 'never') return 'nunca deu sinal';
  if (st === 'off') return `desligada ${ago(t - d.lastSeen)}`;
  const since = d.onlineSince || d.lastSeen;
  return `${st === 'warn' ? 'ligada sem imagem' : 'no ar'} desde ${new Date(since).toDateString() === new Date(t).toDateString() ? hour(since) : hhmm(since)}`;
}
/** O bloco "Telas desta repartição" (só leitura) que acompanha as abas: nome, ponto de situação e desde quando. */
export function devicesCard() {
  const list = el('ul', { class: 'r-list' });
  const empty = el('p', { class: 'r-dim', text: 'Nenhuma tela ligada a esta repartição ainda. Gere a chave de ativação na aba Telas.' });
  const paint = () => {
    const devs = S.state.devices || [];
    empty.hidden = devs.length > 0;
    put(list, devs.map((d) => el('li', {}, el('span', { class: `r-dot ${d.status}`, role: 'img', 'aria-label': STATUS_LABEL[d.status] || d.status }), el('span', {}, el('b', { text: d.name }), el('small', { text: sinceText(d, S.state.serverTime) })))));
  };
  paint();
  return { node: card('Telas desta repartição', list, empty), refresh: paint };
}

export function telas(ctx) {
  let data = null; let open = null; // a tela aberta (captura, comandos e o que ela define)
  const list = el('div', { class: 'r-devs' });
  const keysBox = el('div', {});
  const keyOut = el('div', { class: 'r-keybox', hidden: true, role: 'status' });
  const keyName = el('input', { type: 'text', maxlength: '80', placeholder: 'Ex.: Recepção', autocomplete: 'off' });
  const layout = el('select', { id: 'officeLayout' });
  let officeTheme = null; // os selects do tema da repartição (refeitos a cada pintura)
  const themeBox = el('div', { class: 'r-row' });
  const layoutPv = el('div', {});
  // a prévia do formato escolhido, com o conteúdo de exemplo do tipo da repartição e o tema escolhido
  const paintPv = () => {
    const k = layout.value || null;
    const t = officeTheme?.read();
    put(layoutPv, k ? tvPreview({ ...sampleFor(S.state.office?.type, k, S.state.office?.name), theme: t || undefined }) : el('p', { class: 'r-dim', text: 'O formato do padrão da prefeitura.' }),
      k ? el('p', { class: 'r-dim', text: `Prévia: ${layoutLabel(k)} (conteúdo de exemplo).` }) : null);
  };
  layout.addEventListener('change', paintPv);
  const load = async () => { data = await api('/devices'); paint(); };

  function configForm(d) {
    const c = d.config || {};
    const name = el('input', { type: 'text', maxlength: '80', value: d.name });
    const lay = el('select', {}, option('', 'O da repartição (ou o padrão da prefeitura)', !c.layout), ...LAYOUTS.filter((l) => data.layouts.includes(l.key)).map((l) => option(l.key, `${l.label}: ${l.desc}`, c.layout === l.key)));
    const vol = el('input', { type: 'number', min: '0', max: '100', step: '5', value: c.volume ?? '', placeholder: 'padrão' });
    const muted = el('input', { type: 'checkbox', checked: Boolean(c.muted) });
    // legendas da programação (contrato §14): '' = segue a repartição e o padrão da prefeitura
    const capV = !c.captions ? '' : !c.captions.on ? 'off' : `on:${c.captions.lang || ''}`;
    const cap = el('select', {}, option('', 'O da repartição (ou o padrão da prefeitura)', capV === ''), option('off', 'Desligadas', capV === 'off'), option('on:', 'Ligadas, no idioma do canal', capV === 'on:'),
      ...[['pt', 'Português'], ['en', 'Inglês'], ['es', 'Espanhol'], ['fr', 'Francês'], ['de', 'Alemão'], ['it', 'Italiano'], ['zh-CN', 'Chinês'], ['ja', 'Japonês'], ['ko', 'Coreano'], ['ru', 'Russo'], ['ar', 'Árabe']].map(([k, n]) => option(`on:${k}`, `Ligadas, em ${n.toLowerCase()}`, capV === `on:${k}`)));
    // o som da chamada de senha (contrato §16): '' = não define (vale o escolhido no aparelho; sem escolha, bipe + falada)
    const snd = callSoundSelect(c.callSound?.mode || '', 'Não define (vale o escolhido no aparelho)');
    const sndVol = el('input', { type: 'number', min: '0', max: '100', step: '5', value: c.callSound?.volume ?? '', placeholder: '100' });
    const on = el('input', { type: 'time', value: c.schedule?.tvOn || '' }); const off = el('input', { type: 'time', value: c.schedule?.tvOff || '' });
    const days = new Set(c.schedule ? c.schedule.days : [1, 2, 3, 4, 5]);
    const wid = new Set(c.widgets || []);
    const side = el('input', { type: 'text', maxlength: '60', value: c.sideTitle || '', placeholder: 'O nome da repartição' });
    const th = themeSelects(c.theme, 'O da repartição (ou o padrão da prefeitura)');
    const save = act(async () => {
      if ((on.value && !off.value) || (!on.value && off.value)) throw new Error('Horário da TV: preencha a hora de ligar e a de desligar (ou deixe as duas em branco).');
      const config = {
        layout: lay.value || null, volume: vol.value === '' ? null : Number(vol.value), muted: muted.checked || null,
        captions: cap.value === '' ? null : cap.value === 'off' ? { on: false, lang: null } : { on: true, lang: cap.value.slice(3) || null },
        schedule: on.value && off.value ? { tvOn: on.value, tvOff: off.value, days: [...days] } : null, widgets: [...wid], sideTitle: side.value.trim() || null,
        theme: th.read(),
        callSound: snd.value || sndVol.value !== '' ? { mode: snd.value || null, volume: sndVol.value === '' ? 100 : Number(sndVol.value) } : null,
      };
      await api(`/devices/${d.id}`, { method: 'PATCH', body: { name: name.value, config } });
      await load(); await ctx.refresh();
    }, 'Tela salva. Ela troca em até 30 segundos.');
    return el('form', { class: 'r-devform', novalidate: true, onsubmit: save },
      el('h3', { text: 'O que esta tela define' }),
      el('p', { class: 'r-dim', text: 'Em branco, a tela segue a repartição e o padrão da prefeitura. O PIN de saída e a sequência do controle remoto ficam com a prefeitura.' }),
      el('div', { class: 'r-row' }, field('Nome da tela', name), field('Formato da tela', lay)),
      el('div', { class: 'r-row' }, field('Cor dos painéis de senha', th.color), field('Claro ou escuro', th.mode)),
      el('div', { class: 'r-row' }, field('Volume (0 a 100)', vol), check('Sem som nesta tela', muted)),
      el('div', { class: 'r-row' }, field('Legendas da programação', cap, 'Hoje o ar traz a legenda em português. Quem mexe no aparelho pode trocar lá, até a próxima mudança feita aqui.')),
      el('div', { class: 'r-row' }, field('Som da chamada de senha', snd, 'A fala diz a senha letra por letra e o guichê ("Senha A zero zero dois, consultório três"). Sem voz em português no aparelho, toca só o bipe.'), field('Volume da fala (0 a 100)', sndVol)),
      el('div', { class: 'r-row' }, field('Ligar a TV às', on), field('Desligar às', off)),
      el('fieldset', { class: 'r-fs' }, el('legend', { text: 'Dias do horário (nenhum marcado = todos os dias)' }),
        el('div', { class: 'r-checks' }, DAYS.map(([t, n]) => check(t, el('input', { type: 'checkbox', checked: days.has(n), onchange: (e) => { if (e.target.checked) days.add(n); else days.delete(n); } }))))),
      el('fieldset', { class: 'r-fs' }, el('legend', { text: 'Blocos da lateral (nenhum marcado = segue a repartição)' }),
        el('div', { class: 'r-checks' }, WIDGETS.map((w) => check(w.label, el('input', { type: 'checkbox', checked: wid.has(w.key), onchange: (e) => { if (e.target.checked) wid.add(w.key); else wid.delete(w.key); } }))))),
      field('Título da lateral', side),
      el('div', { class: 'r-btns' }, el('button', { type: 'submit', class: 'r-btn primary' }, 'Salvar esta tela')));
  }
  function shotBox(d) {
    const img = el('img', { class: 'r-shot', alt: `Captura da tela ${d.name}`, hidden: true });
    const note = el('p', { class: 'r-dim' });
    if (!d.shotAt) note.textContent = 'Sem captura ainda. Clique em "Capturar agora": a imagem chega em até 1 minuto.';
    else apiImage(`/devices/${d.id}/screenshot`).then((src) => { img.src = src; img.hidden = false; note.textContent = `Captura de ${hhmm(d.shotAt)}`; }, () => { note.textContent = 'Não foi possível abrir a captura.'; });
    return el('div', { class: 'r-shotbox' }, img, note);
  }
  function deviceCard(d) {
    const st = deviceStatus(d, data.serverTime);
    const offline = st === 'off' || st === 'never';
    const cmd = (type, label) => el('button', { type: 'button', class: 'r-btn small', disabled: offline, title: offline ? 'A tela está desligada: o comando só chega com ela ligada.' : '', onclick: act(async () => {
      if (type === 'reboot' && !confirm(`Reiniciar o aparelho da tela "${d.name}"? Ela fica fora do ar por cerca de 1 minuto.`)) return null;
      await api(`/devices/${d.id}/commands`, { method: 'POST', body: { type } });
      ok(`${COMMANDS.find((c) => c.key === type).label}: a tela "${d.name}" recebe no próximo sinal de vida (até 30 s).`);
      if (type === 'screenshot') setTimeout(() => load().catch(() => {}), 45000);
      return true;
    }) }, label);
    const own = [d.config.layout ? `formato ${layoutLabel(d.config.layout)}` : '', d.config.volume != null ? `volume ${d.config.volume}` : '', d.config.muted ? 'sem som' : '', d.config.schedule ? `liga ${d.config.schedule.tvOn}, desliga ${d.config.schedule.tvOff}` : ''].filter(Boolean);
    const isOpen = open === d.id;
    const head = el('div', { class: 'r-dev-head' },
      el('span', { class: `r-dot ${st}`, role: 'img', 'aria-label': STATUS_LABEL[st] }),
      el('b', { text: d.name }), el('span', { class: 'r-id', title: 'Identificação da tela no sistema', text: `#${d.id}` }),
      el('span', { class: `r-tag${st === 'off' ? ' live' : ''}`, text: d.revokedAt ? 'revogada' : STATUS_LABEL[st] }));
    if (d.revokedAt) {
      return el('article', { class: 'r-dev gone' }, head, el('p', { class: 'r-dim', text: `Revogada em ${hhmm(d.revokedAt)}. O aparelho voltou à tela da chave.` }),
        el('div', { class: 'r-btns' }, el('button', { type: 'button', class: 'r-btn small', onclick: act(async () => { if (!confirm(`Excluir a tela revogada "${d.name}" da lista?`)) return; await api(`/devices/${d.id}`, { method: 'DELETE' }); await load(); }) }, 'Excluir da lista')));
    }
    return el('article', { class: `r-dev${isOpen ? ' open' : ''}` }, head,
      el('p', { class: 'r-dev-line', text: `${sinceText({ ...d, status: st }, data.serverTime)}${d.lastSeen && st !== 'on' ? ` · último sinal ${hhmm(d.lastSeen)}` : ''}` }),
      el('p', { class: 'r-dim', text: [`App ${d.appVersion || '—'}`, d.model, d.android ? `Android ${d.android}` : '', d.net ? `rede ${d.net}` : '', `no ar em 7 dias: ${pct(d.d7)}`].filter(Boolean).join(' · ') }),
      own.length ? el('p', { class: 'r-dim', text: `Próprio desta tela: ${own.join(', ')}.` }) : null,
      d.groups?.length ? el('p', { class: 'r-dim', text: `Grupos (definidos pela prefeitura): ${d.groups.join(', ')}.` }) : null,
      d.lastError ? el('p', { class: 'r-err small', text: `Último erro: ${d.lastError}` }) : null,
      el('div', { class: 'r-btns' }, cmd('screenshot', 'Capturar agora'), cmd('reload', 'Recarregar'), cmd('restart-app', 'Reiniciar o app'), cmd('reboot', 'Reiniciar o aparelho'),
        el('button', { type: 'button', class: 'r-btn small', 'aria-expanded': String(isOpen), onclick: () => { open = isOpen ? null : d.id; paint(); } }, isOpen ? 'Fechar' : 'Captura e configuração'),
        el('button', { type: 'button', class: 'r-btn small danger', onclick: act(async () => {
          if (!confirm(`Desvincular a tela "${d.name}"? O aparelho perde o acesso e volta à tela da chave. Para religar, gere outra chave de ativação.`)) return;
          await api(`/devices/${d.id}/revoke`, { method: 'POST' }); ok('Tela desvinculada.'); await load(); await ctx.refresh();
        }) }, 'Desvincular')),
      isOpen ? el('div', { class: 'r-dev-open' }, shotBox(d), configForm(d)) : null);
  }
  function paint() {
    if (!data) return;
    put(layout, option('', 'O padrão da prefeitura', !data.layout), ...LAYOUTS.filter((l) => data.layouts.includes(l.key)).map((l) => option(l.key, `${l.label}: ${l.desc}`, l.key === data.layout)));
    officeTheme = themeSelects(S.state.theme, 'O padrão da prefeitura');
    officeTheme.color.addEventListener('change', paintPv); officeTheme.mode.addEventListener('change', paintPv);
    put(themeBox, field('Cor dos painéis de senha', officeTheme.color), field('Claro ou escuro', officeTheme.mode));
    paintPv();
    put(list, data.devices.length ? data.devices.map(deviceCard) : el('p', { class: 'r-dim', text: 'Nenhuma TV box nesta repartição ainda. Gere a chave de ativação ao lado e digite-a no aparelho.' }));
    put(keysBox, data.keys.length ? [el('h3', { text: 'Chaves esperando uso' }), el('ul', { class: 'r-list' }, data.keys.map((k) => el('li', {},
      el('span', { class: 'r-tag', text: 'chave' }), el('span', {}, el('b', { text: k.deviceName || 'Sem nome' }), el('small', { text: `vence em ${hhmm(k.expiresAt)} · gerada por ${k.createdBy || '—'}` })),
      el('button', { type: 'button', class: 'r-btn small', onclick: act(async () => { await api(`/keys/${k.id}`, { method: 'DELETE' }); await load(); }) }, 'Apagar'))))] : null);
  }
  const newKey = act(async () => {
    const k = await api('/keys', { method: 'POST', body: { name: keyName.value } });
    keyName.value = '';
    keyOut.hidden = false;
    put(keyOut, el('p', { class: 'r-dim', text: 'Digite esta chave na TV box. Ela aparece só agora, vale para UMA tela e vence em 24 horas.' }), el('p', { class: 'r-key', text: k.key }), el('p', { class: 'r-dim', text: `Vence em ${hhmm(k.expiresAt)}. A tela entra já vinculada a ${S.state.office.name}.` }));
    await load();
  });
  /* a imagem sem internet DESTA repartição (server/telas-imagem-offline.js): a tela mostra quando a internet cai sem vídeo guardado */
  const imgBox = el('div', { class: 'r-offimg' });
  const imgFile = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, 'aria-label': 'Escolher a imagem' });
  imgFile.addEventListener('change', act(async () => {
    const f = imgFile.files?.[0]; if (!f) return null;
    imgFile.value = '';
    if (f.size > 15 * 1024 * 1024) throw new Error('A imagem passa de 15 MB. Escolha outra.');
    await api('/offline-image', { method: 'PUT', file: f });
    await loadImage();
    return true;
  }, (r) => (r ? 'Imagem enviada. As telas baixam e guardam em até 1 minuto.' : '')));
  async function loadImage() {
    const { image } = await api('/offline-image');
    const pic = el('img', { class: 'r-shot', alt: 'Imagem que as telas mostram sem internet', hidden: true });
    if (image) apiImage('/offline-image/file').then((src) => { pic.src = src; pic.hidden = false; }, () => {});
    put(imgBox, pic,
      el('p', { class: 'r-dim', text: image ? `Enviada em ${hhmm(image.createdAt)}${image.createdBy ? ` por ${image.createdBy}` : ''}.` : 'Sem imagem própria: vale a do grupo ou a do padrão da prefeitura, se houver.' }),
      el('div', { class: 'r-btns' },
        el('button', { type: 'button', class: 'r-btn', onclick: () => imgFile.click() }, image ? 'Trocar a imagem' : 'Enviar imagem'),
        image ? el('button', { type: 'button', class: 'r-btn danger', onclick: act(async () => {
          if (!confirm('Remover a imagem sem internet desta repartição?')) return null;
          await api('/offline-image', { method: 'DELETE' }); await loadImage(); return true;
        }, (r) => (r ? 'Imagem removida.' : '')) }, 'Remover') : null));
  }
  const saveLayout = act(async () => { const r = await api('/avisos', { method: 'PUT', body: { layout: layout.value || null, theme: officeTheme ? officeTheme.read() : undefined } }); S.state.layout = r.layout; S.state.theme = r.theme; await load(); }, 'Formato salvo. As telas trocam em até 30 segundos.');

  const node = cols(
    card('TV box desta repartição', el('p', { class: 'r-dim', text: 'Cada tela com a situação, a última captura e os comandos. O que você muda aqui vale só nas telas desta repartição.' }), list),
    [
      card('Ativar uma TV box nova', el('p', { class: 'r-dim', text: 'Gere a chave e digite-a no aparelho: a tela entra na rede já vinculada a esta repartição.' }),
        el('form', { novalidate: true, onsubmit: newKey }, field('Nome da tela (opcional)', keyName, 'Sem nome, a tela leva o nome da repartição.'), el('button', { type: 'submit', class: 'r-btn primary' }, 'Gerar chave de ativação')),
        keyOut, keysBox),
      card('Formato das telas desta repartição', el('form', { novalidate: true, onsubmit: saveLayout }, field('Formato da tela', layout, 'Vale em todas as telas da repartição que não têm um formato próprio.'), themeBox, el('p', { class: 'r-dim', text: 'A cor e o claro/escuro valem nos painéis de senha novos (os formatos que começam por "Senha", "Duas filas" e "Últimas chamadas").' }), layoutPv, el('button', { type: 'submit', class: 'r-btn' }, 'Salvar o formato'))),
      card('Imagem sem internet', el('p', { class: 'r-dim', text: 'Quando a internet cai e não há vídeo guardado, a tela mostra esta imagem em vez de ficar preta. JPEG, PNG ou WebP até 15 MB: o servidor ajusta para 1920×1080, cobrindo a tela sem distorcer.' }), imgFile, imgBox),
    ]);
  load().catch(() => {});
  loadImage().catch(() => {});
  return { node, show: () => { load().catch(() => {}); loadImage().catch(() => {}); }, refresh: () => { if (open == null) load().catch(() => {}); } };
}
