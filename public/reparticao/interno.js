// NEXA Telas · a página do celular da equipe (server/telas-interna.js, docs/TELAS.md §25). Aberta pelo endereço
// /interno/<token> que o gestor da repartição gera para cada setor: sem app e sem login. A pessoa escreve o nome ou a
// matrícula uma vez (fica no localStorage deste aparelho), lê os avisos do setor e toca em Li. Com a página aberta, os
// códigos de emergência chegam na hora (tempo real lido por fetch: o token vai no cabeçalho, nunca no endereço), com som
// (depois de a pessoa tocar em "Ativar o alerta sonoro": o navegador exige um toque) e vibração. O endereço de disparo
// também dispara e encerra códigos. Nada de HTML em texto: tudo por textContent.
import { codeColorKey } from '/shared/telas-tipos.js';
const $ = (id) => document.getElementById(id);
const token = location.pathname.split('/').filter(Boolean)[1] || '';
const KEY = `nexa.interno.${token.slice(0, 10)}`;
let st = null; let reader = ''; let audio = null; let alarm = null; let seen = new Set(); let streamCtl = null;

const getReader = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const setReader = (v) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* sem armazenamento */ } };
const show = (id, msg) => { $(id).textContent = msg || ''; $(id).hidden = !msg; };
let okTimer = null;
const ok = (m) => { show('err', ''); show('ok', m); clearTimeout(okTimer); okTimer = setTimeout(() => show('ok', ''), 4000); };
const err = (m) => { show('ok', ''); show('err', m); };
const hhmm = (ms) => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const hour = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

async function api(path, body, method) {
  const res = await fetch(`/api/interno${path}`, {
    method: method || (body ? 'POST' : 'GET'), cache: 'no-store', referrerPolicy: 'no-referrer',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Erro ${res.status}`); e.status = res.status; throw e; }
  return data;
}

/* ------------------------------------------------------------------ quem é */
function paintWho() {
  reader = getReader();
  $('who').hidden = Boolean(reader); $('me').hidden = !reader;
  $('meName').textContent = reader;
}
$('whoForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('reader').value.replace(/\s+/g, ' ').trim();
  if (v.length < 2) return err('Escreva ao menos 2 letras.');
  setReader(v.slice(0, 60)); paintWho(); load();
});
$('change').addEventListener('click', () => { setReader(''); $('reader').value = ''; paintWho(); $('reader').focus(); });

/* ------------------------------------------------------------------ o estado: avisos, códigos e o que pode */
async function load() {
  try {
    st = await api('/state', { reader: reader || '' });
    show('err', '');
    $('office').textContent = st.office; $('sector').textContent = st.sector;
    document.title = `${st.sector} · ${st.office}`;
    $('unknown').hidden = !(reader && st.known === false);
    paintNotices(); paintFire(); paintCodes(st.codes);
  } catch (x) { err(x.message); if (x.status === 401) stopStream(); }
}
function paintNotices() {
  const list = st.notices || [];
  $('empty').hidden = list.length > 0;
  $('notices').replaceChildren(...list.map((n) => {
    const li = el('li', `in-n${n.readAt ? ' read' : ''}`);
    li.append(el('small', 'in-kind', n.kindLabel), el('h3', '', n.title));
    for (const p of String(n.text || '').split('\n')) if (p.trim()) li.append(el('p', '', p));
    const foot = el('div', 'in-foot');
    foot.append(el('small', 'r-dim', `até ${hhmm(n.until)}`));
    if (n.readAt) foot.append(el('span', 'in-done', `Lido às ${hour(n.readAt)}`));
    else {
      const b = el('button', 'r-btn primary', 'Li'); b.type = 'button'; b.disabled = !reader;
      b.title = reader ? 'Marca que você leu este aviso' : 'Escreva o seu nome primeiro';
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await api(`/notices/${n.id}/read`, { reader }); ok('Leitura registrada.'); await load(); } catch (x) { err(x.message); b.disabled = false; }
      });
      foot.append(b);
    }
    li.append(foot);
    return li;
  }));
}
function paintFire() {
  $('fireBox').hidden = !st.canFire;
  if (!st.canFire) return;
  $('fire').replaceChildren(...st.catalog.map((c) => {
    const b = el('button', 'in-fire-btn'); b.type = 'button';
    b.classList.add(`cc-${codeColorKey(c.color)}`);
    b.append(el('b', '', c.label), el('small', '', c.meaning));
    b.addEventListener('click', async () => {
      const place = $('place').value.trim();
      if (!confirm(`Disparar ${c.label}${place ? ` em ${place}` : ''}? Vai às telas internas e aos celulares da equipe.`)) return;
      b.disabled = true;
      try { await api('/codes', { code: c.key, place, reader }); ok(`${c.label} disparado.`); await load(); } catch (x) { err(x.message); } finally { b.disabled = false; }
    });
    return b;
  }));
}

/* ------------------------------------------------------------------ o código em vigor: tela, som e vibração */
function paintCodes(codes) {
  const t = Date.now();
  const list = (codes || []).filter((c) => c.until == null || c.until > t);
  const box = $('code');
  if (!list.length) { box.hidden = true; document.body.classList.remove('in-alarm'); stopAlarm(); return; }
  const c = list[0];
  box.hidden = false; document.body.classList.add('in-alarm');
  box.className = `in-code cc-${codeColorKey(c.color)}`;
  $('codeLabel').textContent = c.label.toUpperCase();
  $('codeMeaning').textContent = c.meaning || '';
  $('codePlace').textContent = c.place || '';
  $('codeTime').textContent = `Disparado às ${hour(c.firedAt)}`;
  $('codeMore').textContent = list.length > 1 ? `E mais: ${list.slice(1).map((x) => `${x.label}${x.place ? ` (${x.place})` : ''}`).join(' · ')}` : '';
  const close = $('codeClose'); close.hidden = !st?.canFire;
  close.onclick = async () => {
    if (!confirm(`Encerrar ${c.label}?`)) return;
    close.disabled = true;
    try { await api(`/codes/${c.id}/close`, { reader }); ok('Código encerrado.'); await load(); } catch (x) { err(x.message); } finally { close.disabled = false; }
  };
  // código novo: som (se ligado) e vibração
  const fresh = list.filter((x) => !seen.has(x.id));
  for (const x of list) seen.add(x.id);
  if (fresh.length) { try { navigator.vibrate?.([600, 200, 600, 200, 600]); } catch { /* sem vibração */ } startAlarm(); }
}
$('sound').addEventListener('click', () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audio = audio || new Ctx(); audio.resume?.();
    $('sound').textContent = 'Alerta sonoro ligado'; $('sound').disabled = true;
    $('soundNote').textContent = 'O som toca quando chega um código (o volume é o do celular).';
  } catch { $('soundNote').textContent = 'Este navegador não tocou o som. A vibração e a tela continuam.'; }
});
function beep() {
  if (!audio) return;
  try {
    const t0 = audio.currentTime;
    for (const [at, hz] of [[0, 988], [0.3, 740], [0.6, 988], [0.9, 740]]) {
      const o = audio.createOscillator(); const g = audio.createGain();
      o.type = 'square'; o.frequency.value = hz; g.gain.value = 0.15;
      o.connect(g).connect(audio.destination); o.start(t0 + at); o.stop(t0 + at + 0.25);
    }
  } catch { /* sem som */ }
}
// o som repete a cada 4 s por 1 minuto (ou até o código acabar)
function startAlarm() { stopAlarm(); let n = 0; beep(); alarm = setInterval(() => { if (++n >= 15) stopAlarm(); else beep(); }, 4000); }
function stopAlarm() { clearInterval(alarm); alarm = null; }

/* ------------------------------------------------------------------ tempo real (SSE pelo fetch) com reconexão */
function stopStream() { try { streamCtl?.abort(); } catch { /* já parada */ } streamCtl = null; }
async function stream() {
  let wait = 1000;
  for (;;) {
    streamCtl = new AbortController();
    try {
      const res = await fetch('/api/interno/stream', { cache: 'no-store', referrerPolicy: 'no-referrer', headers: { authorization: `Bearer ${token}` }, signal: streamCtl.signal });
      if (res.status === 401) { err('Endereço desligado. Peça o endereço novo do setor à direção.'); return; }
      if (!res.ok || !res.body) throw new Error(String(res.status));
      wait = 1000;
      const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1]; const data = /^data: (.+)$/m.exec(block)?.[1];
          if (ev === 'codes' && data) { try { paintCodes(JSON.parse(data).codes); } catch { /* bloco quebrado */ } }
        }
      }
    } catch { /* cai e reconecta */ }
    await new Promise((r) => setTimeout(r, wait)); wait = Math.min(wait * 2, 30000);
    load();
  }
}

paintWho();
load().then(() => { if (st) stream(); });
// a lista de avisos relida a cada minuto (o código chega pelo tempo real)
setInterval(() => { if (!document.hidden) load(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
