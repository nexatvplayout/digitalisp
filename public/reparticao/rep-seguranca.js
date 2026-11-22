// NEXA Telas · página de controle da repartição · segurança pública (server/telas-seguranca.js, docs/TELAS.md §21).
//   O botão de pânico, na barra do topo das repartições com o módulo ligado (gestor e atendente): segure por 2 segundos (ou
//   Enter e confirme) e a Segurança (CCO) recebe um aviso SILENCIOSO. Nada aparece em tela nenhuma. Quem acionou vê
//   "Enviado às HH:MM · recebido pelo CCO às HH:MM".
//   A aba Ocorrências do CCO: os acionamentos em tempo quase real (a cada 3 s), com o destaque vermelho, o som de aviso (só
//   depois de a pessoa ligar o som na página), o ponto no mapa, Recebido e Encerrar (com uma nota).
import { typeSigla } from '/shared/telas-tipos.js';
import { S, el, put, api, act, ok, err, card, cols, hour, hhmm } from '/reparticao/rep-base.js';
import { createMap } from '/admin/telas-mapa.js';

let mineTimer = null; let ccoTimer = null;
export function stop() { clearInterval(mineTimer); clearInterval(ccoTimer); mineTimer = null; ccoTimer = null; }

/* ------------------------------------------------------------------ o botão de pânico (quem aciona) */
const HOLD_MS = 2000;
export function panicButton(btn, noteEl) {
  const st = S.state;
  btn.hidden = !st.panic; noteEl.textContent = '';
  if (!st.panic || btn.dataset.ready) { if (st.panic) watch(noteEl); return; }
  btn.dataset.ready = '1';
  btn.title = 'Segure por 2 segundos para avisar a Segurança. O aviso é silencioso: nada aparece nas telas.';
  let hold = null; let busy = false;
  const send = async () => {
    if (busy) return; busy = true;
    try {
      const r = await api('/panic', { method: 'POST', body: {} });
      noteEl.textContent = `Enviado às ${hour(r.sentAt)} · aguardando o CCO`;
      ok('Aviso silencioso enviado à Segurança. Nada aparece nas telas.');
      watch(noteEl);
    } catch (x) { if (x.message !== 'sessão') err(x.message); } finally { busy = false; btn.classList.remove('holding'); }
  };
  const start = (e) => { if (e.button != null && e.button !== 0) return; btn.classList.add('holding'); clearTimeout(hold); hold = setTimeout(send, HOLD_MS); };
  const cancel = () => { clearTimeout(hold); btn.classList.remove('holding'); };
  btn.addEventListener('pointerdown', start); btn.addEventListener('pointerup', cancel); btn.addEventListener('pointerleave', cancel); btn.addEventListener('pointercancel', cancel);
  // pelo teclado (e para quem não consegue segurar): Enter ou espaço, com a confirmação
  btn.addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault(); if (confirm('Avisar a Segurança agora? O aviso é silencioso: nada aparece nas telas.')) send(); });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  watch(noteEl);
}
/** "Enviado às HH:MM · recebido pelo CCO às HH:MM": relido a cada 10 s enquanto há um aviso sem resposta. */
function watch(noteEl) {
  clearInterval(mineTimer);
  const read = async () => {
    if (!S.session || document.hidden) return;
    try {
      const r = await api('/panic/mine');
      const p = r.sent[0];
      noteEl.textContent = !p ? '' : `Enviado às ${hour(p.sentAt)} · ${p.closedAt ? `encerrado pelo CCO às ${hour(p.closedAt)}` : p.ackAt ? `recebido pelo CCO às ${hour(p.ackAt)}` : 'aguardando o CCO'}`;
      if (!p || p.closedAt) { clearInterval(mineTimer); mineTimer = null; }
    } catch { /* próxima volta */ }
  };
  read(); mineTimer = setInterval(read, 10000);
}

/* ------------------------------------------------------------------ Ocorrências (o CCO) */
let audio = null;
function beep() {
  if (!audio) return;
  try {
    for (const [at, hz] of [[0, 880], [0.25, 660], [0.5, 880]]) {
      const o = audio.createOscillator(); const g = audio.createGain();
      o.frequency.value = hz; o.connect(g); g.connect(audio.destination);
      g.gain.setValueAtTime(0.0001, audio.currentTime + at); g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + at + 0.2);
      o.start(audio.currentTime + at); o.stop(audio.currentTime + at + 0.22);
    }
  } catch { /* sem som neste navegador */ }
}
export function ocorrencias(ctx) {
  let data = null; let seen = null; let map = null; let mapData = null;
  const list = el('div', { class: 'r-reqs' }); const closed = el('ul', { class: 'r-list' });
  const box = el('div', { class: 'r-mapbox' }); const mapNote = el('p', { class: 'r-dim', text: 'Carregando o mapa…' });
  const sound = el('button', { type: 'button', class: 'r-btn small', 'aria-pressed': 'false' }, 'Ligar o som de aviso');
  // o navegador só deixa tocar depois de um gesto da pessoa na página: o som liga neste botão
  sound.addEventListener('click', () => {
    if (audio) { audio.close().catch(() => {}); audio = null; } else { const A = window.AudioContext || window.webkitAudioContext; if (A) { audio = new A(); beep(); } }
    sound.textContent = audio ? 'Som de aviso ligado (clique para desligar)' : 'Ligar o som de aviso'; sound.setAttribute('aria-pressed', String(Boolean(audio)));
  });
  const run = (fn, msg) => act(async () => { await fn(); await load(); }, msg);
  function paintMap() {
    if (!map || !data) return;
    const open = new Map(data.open.filter((p) => p.lat != null && p.lng != null).map((p) => [p.officeId, p]));
    map.setPins((mapData?.offices || []).filter((o) => o.lat != null && o.lng != null).map((o) => { const p = open.get(o.id); return { id: o.id, lat: o.lat, lng: o.lng, status: 'none', cls: p ? 'hit' : 'dim', label: typeSigla(o.type), title: `${o.name}${p ? ` · pânico às ${hour(p.sentAt)}` : ''}` }; }));
  }
  function paint() {
    const fresh = data.open.filter((p) => p.status === 'novo');
    ctx.badge('ocorrencias', fresh.length);
    document.body.classList.toggle('r-panic-on', fresh.length > 0);
    put(list, data.open.length ? data.open.map((p) => el('article', { class: `r-req r-occ${p.status === 'novo' ? ' new' : ''}` },
      el('div', { class: 'r-req-head' }, el('span', { class: `r-tag${p.status === 'novo' ? ' live' : ''}`, text: p.status === 'novo' ? 'PÂNICO' : 'recebido' }), el('b', { text: p.office }), el('span', { class: 'r-dim', text: p.officeTypeLabel })),
      el('p', { class: 'r-dev-line', text: `Acionado às ${hour(p.sentAt)} (${hhmm(p.sentAt)}) por ${p.sentBy.replace(/^repartição: /, '')}` }),
      el('p', { class: 'r-dim', text: `${p.address || 'Sem endereço cadastrado'}${p.lat != null ? ` · ponto ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : ' · sem ponto no mapa'}${p.ackAt ? ` · recebido às ${hour(p.ackAt)} por ${p.ackBy}` : ''}` }),
      el('div', { class: 'r-btns' },
        p.lat != null ? el('button', { type: 'button', class: 'r-btn', onclick: () => { map?.setView(p.lat, p.lng, 15); box.scrollIntoView({ block: 'nearest' }); } }, 'Ver no mapa') : null,
        p.status === 'novo' ? el('button', { type: 'button', class: 'r-btn primary', onclick: run(() => api(`/panic/${p.id}/ack`, { method: 'POST', body: {} }), 'Marcado como recebido. Quem acionou vê a hora.') }, 'Recebido') : null,
        el('button', { type: 'button', class: 'r-btn', onclick: run(async () => {
          const note = prompt(`Encerrar a ocorrência de "${p.office}"? Escreva o que foi feito:`, '');
          if (note == null) return;
          if (note.trim().length < 3) throw new Error('Escreva uma nota para encerrar (o que foi feito).');
          await api(`/panic/${p.id}/close`, { method: 'POST', body: { note: note.trim() } });
          ok('Ocorrência encerrada.');
        }) }, 'Encerrar')))) : el('p', { class: 'r-dim', text: 'Nenhuma ocorrência aberta.' }));
    put(closed, data.closed.slice(0, 30).map((p) => el('li', {}, el('span', { class: 'r-tag', text: 'encerrado' }), el('span', {}, el('b', { text: `${p.office} · ${hhmm(p.sentAt)}` }), el('small', { text: `recebido por ${p.ackBy || '—'} · encerrado por ${p.closedBy || '—'} às ${hour(p.closedAt)}${p.note ? ` · "${p.note}"` : ''}` })))));
    paintMap();
  }
  async function load() {
    data = await api('/panic');
    const ids = new Set(data.open.filter((p) => p.status === 'novo').map((p) => p.id));
    if (seen && [...ids].some((id) => !seen.has(id))) beep(); // um acionamento novo: o som (se a pessoa ligou)
    seen = ids;
    paint();
  }
  api('/mapa').then((m) => {
    mapData = m;
    map = createMap(box, { tiles: false });
    if (m.municipio?.polygons) { map.setOutline(m.municipio.polygons, { mask: false }); map.setBounds(m.municipio.bbox); map.fitBounds(m.municipio.bbox); } else map.fit(m.offices.filter((o) => o.lat != null));
    mapNote.textContent = 'A repartição que acionou o botão fica em destaque no mapa.';
    paintMap();
  }, () => { mapNote.textContent = 'Não foi possível carregar o mapa agora. As ocorrências continuam chegando na lista.'; });
  const node = cols(
    [card('Ocorrências abertas', el('p', { class: 'r-dim', text: 'O botão de pânico das repartições chega aqui em silêncio: nada aparece nas telas. Marque Recebido para quem acionou saber que o aviso chegou.' }), el('div', { class: 'r-btns' }, sound), list), card('Encerradas (90 dias)', closed)],
    card('Mapa', box, mapNote));
  load().catch(() => {});
  clearInterval(ccoTimer);
  ccoTimer = setInterval(() => { if (S.session && !document.hidden) load().catch(() => {}); }, 3000);
  return { node, show: () => { map?.render(); load().catch(() => {}); } };
}
