// A página do QR code de mídia ou playlist: busca o conteúdo e mostra as imagens, os vídeos e os slides (o mesmo desenho
// das telas, de public/shared/tvcorp-previa.js). Só texto por textContent; nada de estilo por script.
import { slidePreview } from '/shared/tvcorp-previa.js';

const code = location.pathname.split('/').filter(Boolean)[1] || '';
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) n.setAttribute(k, String(v)); for (const k of kids) if (k != null) n.append(k); return n; };

try {
  const r = await fetch(`/q/${encodeURIComponent(code)}/conteudo`, { cache: 'no-store' });
  if (!r.ok) throw new Error('não encontrado');
  const d = await r.json();
  $('titulo').textContent = d.titulo || 'Conteúdo';
  document.title = d.titulo || 'Conteúdo';
  $('empresa').textContent = d.empresa || '';
  const box = $('itens');
  if (!d.itens.length) box.append(el('p', { class: 'q-vazio' }, 'Nada para mostrar agora.'));
  for (const it of d.itens) {
    if (it.kind === 'image') box.append(el('figure', { class: 'q-item' }, el('img', { src: it.url, alt: it.title || '', loading: 'lazy' })));
    else if (it.kind === 'video') box.append(el('figure', { class: 'q-item' }, el('video', { src: it.url, poster: it.poster, controls: true, playsinline: true, preload: 'none' })));
    else if (it.kind === 'slide') box.append(el('figure', { class: `q-item q-slide${it.fields?.orient === 'port' ? ' port' : ''}` }, slidePreview(it.template, it.fields || {}, { image: it.image || null })));
  }
} catch {
  $('titulo').textContent = 'Conteúdo indisponível';
  $('empresa').textContent = 'Este QR code foi desligado ou não existe mais.';
}
