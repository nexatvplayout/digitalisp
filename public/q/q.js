// A página do QR code de mídia ou playlist: passa as propagandas uma por vez, no tempo de cada uma, como na tela (o mesmo
// desenho dos slides, de public/shared/tvcorp-previa.js). No celular em pé, o slide vem na versão em pé.
// Toque na imagem para pausar ou continuar; setas e pontinhos para ir e voltar; "Ver todos" mostra a lista.
// Só texto por textContent; nada de estilo por script.
import { slidePreview } from '/shared/tvcorp-previa.js';

const code = location.pathname.split('/').filter(Boolean)[1] || '';
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v); else n.setAttribute(k, String(v));
  }
  for (const k of kids) if (k != null) n.append(k);
  return n;
};
const emPe = () => (globalThis.matchMedia ? matchMedia('(orientation: portrait)').matches : true);

/** Um item desenhado (imagem, vídeo ou slide). */
function desenho(it, { lista = false } = {}) {
  if (it.kind === 'image') return el('figure', { class: 'q-item' }, el('img', { src: it.url, alt: it.title || '', loading: lista ? 'lazy' : null }));
  if (it.kind === 'video') return el('figure', { class: 'q-item' }, el('video', { src: it.url, poster: it.poster, controls: lista ? true : null, playsinline: true, muted: lista ? null : true, autoplay: lista ? null : true, preload: lista ? 'none' : 'auto' }));
  if (it.kind === 'slide') {
    const orient = emPe() ? 'port' : 'land'; // os templates têm as duas versões: a do jeito do celular
    return el('figure', { class: `q-item q-slide${orient === 'port' ? ' port' : ''}` }, slidePreview(it.template, { ...(it.fields || {}), orient }, { image: it.image || null }));
  }
  return null;
}

function apresentacao(itens) {
  const palco = el('div', { class: 'q-palco', role: 'region', 'aria-label': 'Propagandas passando' });
  const pontos = el('div', { class: 'q-pontos' });
  const barra = el('div', { class: 'q-barra' }, el('span', { class: 'q-barra-in' }));
  const estado = el('span', { class: 'q-estado', 'aria-live': 'polite' });
  let i = 0; let t = null; let pausado = false;
  const marca = () => [...pontos.children].forEach((p, k) => p.setAttribute('aria-current', k === i ? 'true' : 'false'));
  const mostra = (k) => {
    clearTimeout(t);
    i = (k + itens.length) % itens.length;
    const it = itens[i];
    palco.replaceChildren(desenho(it));
    marca();
    // a barrinha do tempo: reinicia a animação pela classe (a duração vem por classe de 4 a 60 s)
    barra.className = 'q-barra'; void barra.offsetWidth;
    if (!pausado) barra.className = `q-barra anda s${it.seconds || 8}`;
    const v = palco.querySelector('video');
    if (v) { v.addEventListener('ended', () => { if (!pausado) mostra(i + 1); }); v.play?.().catch(() => {}); }
    else if (!pausado) t = setTimeout(() => mostra(i + 1), (it.seconds || 8) * 1000);
    estado.textContent = `${i + 1} de ${itens.length}${pausado ? ' · pausado' : ''}`;
  };
  const alterna = () => { pausado = !pausado; mostra(i); };
  palco.addEventListener('click', alterna);
  itens.forEach((_, k) => pontos.append(el('button', { type: 'button', class: 'q-ponto', 'aria-label': `Ir para a ${k + 1}ª`, onclick: () => mostra(k) })));
  // arrastar para o lado troca
  let x0 = null;
  palco.addEventListener('touchstart', (e) => { x0 = e.touches[0]?.clientX ?? null; }, { passive: true });
  palco.addEventListener('touchend', (e) => { const x = e.changedTouches[0]?.clientX; if (x0 != null && x != null && Math.abs(x - x0) > 40) mostra(i + (x < x0 ? 1 : -1)); x0 = null; });
  const nav = el('div', { class: 'q-nav' },
    el('button', { type: 'button', class: 'q-bt', 'aria-label': 'Anterior', onclick: () => mostra(i - 1) }, '‹'),
    estado,
    el('button', { type: 'button', class: 'q-bt', 'aria-label': 'Pausar ou continuar', onclick: alterna }, '⏯'),
    el('button', { type: 'button', class: 'q-bt', 'aria-label': 'Próxima', onclick: () => mostra(i + 1) }, '›'));
  mostra(0);
  return el('section', { class: 'q-show' }, palco, barra, nav, itens.length > 1 ? pontos : null);
}

try {
  const r = await fetch(`/q/${encodeURIComponent(code)}/conteudo`, { cache: 'no-store' });
  if (!r.ok) throw new Error('não encontrado');
  const d = await r.json();
  $('titulo').textContent = d.titulo || 'Conteúdo';
  document.title = d.titulo || 'Conteúdo';
  $('empresa').textContent = d.empresa || '';
  const box = $('itens');
  const itens = (d.itens || []).filter((it) => ['image', 'video', 'slide'].includes(it.kind));
  if (!itens.length) box.append(el('p', { class: 'q-vazio' }, 'Nada para mostrar agora.'));
  else if (itens.length === 1) box.append(desenho(itens[0], { lista: true }));
  else {
    box.append(apresentacao(itens));
    const lista = el('div', { class: 'q-lista', hidden: true }, ...itens.map((it) => desenho(it, { lista: true })));
    const ver = el('button', { type: 'button', class: 'q-ver', onclick: () => { lista.hidden = !lista.hidden; ver.textContent = lista.hidden ? 'Ver todos' : 'Esconder a lista'; } }, 'Ver todos');
    box.append(ver, lista);
  }
} catch {
  $('titulo').textContent = 'Conteúdo indisponível';
  $('empresa').textContent = 'Este QR code foi desligado ou não existe mais.';
}
