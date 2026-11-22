// Mapa do Painel da Prefeitura (views/prefeitura.js, docs/TELAS.md): um mapa de arrastar e dar zoom feito aqui mesmo, sem
// biblioteca de fora (o painel não carrega script de terceiros). Projeção Web Mercator; o fundo são os quadros (256 px) do
// OpenStreetMap em <img> (https://tile.openstreetmap.org/{z}/{x}/{y}.png), com o crédito "© OpenStreetMap" que a licença pede.
// Sem rede (ou com o quadro recusado), a imagem some e os pinos continuam sobre o fundo liso: o mapa nunca depende do fundo.
//   createMap(caixa, { center: { lat, lng }, zoom, onClick({ lat, lng }), onPin(id), onView({ lat, lng, zoom }) })
//   .setPins([{ id, lat, lng, status, title, color, label, count, cls }])   pinos (status: on | warn | off | never | none;
//                                                    vira a classe do pino). label: a sigla escrita no pino; count: o número
//                                                    que aparece com zoom suficiente; cls: classes a mais (dim, out)
//   .setMarker({ lat, lng, draggable, onChange })        o ponto de uma repartição (arrastável); null tira
//   .setCircle({ lat, lng, meters })                     o raio de um alerta; null tira
//   .setOutline(polígonos, { mask })                     o contorno do município (public/shared/telas-geo.js: [[[lng, lat]…]…]),
//                                                    desenhado num <canvas>; mask escurece o lado de fora; null tira
//   .setBounds({ south, west, north, east })             trava o mapa na caixa: não arrasta nem afasta o zoom para fora (com
//                                                    uma margem pequena); null solta
//   .fitBounds(caixa?)                                   enquadra a caixa inteira (a da trava, sem argumento), com zoom
//                                                    fracionário: a cidade ocupa a área toda
//   .fit([{ lat, lng }])   .setView(lat, lng, zoom)   .view()   .destroy()
// O zoom pode ser fracionário (os quadros são esticados do zoom inteiro mais próximo); a roda e os botões andam de 1 em 1.
// As contas (lat/lng <-> pixel, raio em pixels, zoom que cabe, a trava) ficam exportadas para o teste.
export const TILE = 256;
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 18;
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const BRAZIL = { lat: -14.2, lng: -51.9, zoom: 4 };
/** A partir deste zoom o pino mostra também o número (quantas telas a repartição tem). */
export const COUNT_ZOOM = 12;
const MAX_LAT = 85.05112878;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Ponto do mundo (pixels no zoom z) de uma latitude e longitude. */
export function project(lat, lng, z) {
  const size = TILE * 2 ** z;
  const s = Math.sin(clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI / 180);
  return { x: (lng + 180) / 360 * size, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size };
}
export function unproject(x, y, z) {
  const size = TILE * 2 ** z;
  return { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / size))) * 180 / Math.PI, lng: x / size * 360 - 180 };
}
/** Metros por pixel na latitude e no zoom dados. */
export const metersPerPixel = (lat, z) => 156543.03392804097 * Math.cos(lat * Math.PI / 180) / 2 ** z;
/** Centro e o maior zoom em que todos os pontos cabem na caixa (com margem). Sem pontos: null. */
export function fitView(points, width, height, pad = 48) {
  const pts = (points || []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng));
  if (!pts.length) return null;
  const lat = [Math.min(...pts.map((p) => p.lat)), Math.max(...pts.map((p) => p.lat))];
  const lng = [Math.min(...pts.map((p) => p.lng)), Math.max(...pts.map((p) => p.lng))];
  const w = Math.max(64, width - 2 * pad); const h = Math.max(64, height - 2 * pad);
  let zoom = pts.length === 1 || (lat[0] === lat[1] && lng[0] === lng[1]) ? 15 : MIN_ZOOM;
  if (zoom === MIN_ZOOM) {
    for (let z = 16; z >= MIN_ZOOM; z--) {
      const a = project(lat[1], lng[0], z); const b = project(lat[0], lng[1], z);
      if (b.x - a.x <= w && b.y - a.y <= h) { zoom = z; break; }
    }
  }
  // o meio na projeção (não a média das latitudes): os extremos ficam à mesma distância da borda
  const a = project(lat[1], lng[0], zoom); const b = project(lat[0], lng[1], zoom);
  return { ...unproject((a.x + b.x) / 2, (a.y + b.y) / 2, zoom), zoom };
}
const okBox = (b) => Boolean(b) && [b.south, b.west, b.north, b.east].every(Number.isFinite) && b.south < b.north && b.west < b.east;
/**
 * Centro e zoom (fracionário) em que a caixa { south, west, north, east } ocupa a área toda, com a margem pad em pixels.
 * Caixa inválida: null.
 */
export function fitBoundsView(box, width, height, pad = 24) {
  if (!okBox(box)) return null;
  const a = project(box.north, box.west, 0); const b = project(box.south, box.east, 0);
  const w = Math.max(64, width - 2 * pad); const h = Math.max(64, height - 2 * pad);
  const zoom = clamp(Math.min(Math.log2(w / (b.x - a.x)), Math.log2(h / (b.y - a.y))), MIN_ZOOM, MAX_ZOOM);
  return { ...unproject((a.x + b.x) / 2, (a.y + b.y) / 2, 0), zoom };
}
/**
 * O centro mais perto do pedido com a vista dentro da caixa (mais a margem: uma fração do tamanho dela, no mínimo 24 px).
 * Num eixo em que a vista é maior que a caixa, o centro fica no meio da caixa.
 */
export function clampCenter(center, zoom, box, width, height, margin = 0.06) {
  if (!okBox(box)) return { lat: center.lat, lng: center.lng };
  const a = project(box.north, box.west, zoom); const b = project(box.south, box.east, zoom);
  const c = project(center.lat, center.lng, zoom);
  const axis = (lo, hi, v, half) => { const m = Math.max(24, (hi - lo) * margin); const l = lo - m + half; const h = hi + m - half; return l > h ? (lo + hi) / 2 : clamp(v, l, h); };
  return unproject(axis(a.x, b.x, c.x, width / 2), axis(a.y, b.y, c.y, height / 2), zoom);
}
/**
 * Os quadros que cobrem a caixa: [{ key, z, x (já dentro do mundo), y, left, top, size }]. Com o zoom fracionário, os
 * quadros são os do zoom inteiro mais próximo, esticados (size em pixels; 256 no zoom inteiro).
 */
export function tilesFor(center, zoom, width, height) {
  const tz = clamp(Math.round(zoom), 0, MAX_ZOOM);
  const size = TILE * 2 ** (zoom - tz);
  const c = project(center.lat, center.lng, zoom);
  const n = 2 ** tz;
  const x0 = c.x - width / 2; const y0 = c.y - height / 2;
  const out = [];
  for (let ty = Math.floor(y0 / size); ty * size < y0 + height; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(x0 / size); tx * size < x0 + width; tx++) {
      const left = Math.round(tx * size - x0); const top = Math.round(ty * size - y0);
      // a largura vai até onde começa o vizinho: os quadros esticados encostam sem fresta
      out.push({ key: `${tz}/${tx}/${ty}`, z: tz, x: ((tx % n) + n) % n, y: ty, left, top, size: Math.round((tx + 1) * size - x0) - left, sizeY: Math.round((ty + 1) * size - y0) - top });
    }
  }
  return out;
}
export const tileUrl = (t) => TILE_URL.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);

const node = (tag, cls, attrs = {}) => { const n = document.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
/** O que fica por cima do mapa e não arrasta nem dá zoom nele (controles, crédito, pinos, legenda da tela). */
const UI = '.pf-map-ctl, .pf-map-credit, .pf-map-pin, .pf-map-marker, .pf-map-ui';

export function createMap(box, { center = BRAZIL, zoom = BRAZIL.zoom, onClick = null, onPin = null, onView = null, tiles: useTiles = true } = {}) {
  let view = { lat: center.lat, lng: center.lng, zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) };
  let pins = []; let marker = null; let circle = null;
  let outline = null; // { rings: [Float64Array de x,y no zoom 0], mask }
  let bounds = null; // a trava
  let fitted = false; let fitBox = null; // a vista é a da caixa inteira (o redimensionar enquadra de novo)
  const FIT_PAD = 24;
  const tiles = new Map(); // chave -> <img>
  box.classList.add('pf-map');
  box.tabIndex = 0;
  box.setAttribute('role', 'application');
  box.setAttribute('aria-label', 'Mapa: arraste para mover, role para aproximar');
  const tileLayer = node('div', 'pf-map-tiles', { 'aria-hidden': 'true' });
  const shape = node('canvas', 'pf-map-shape', { 'aria-hidden': 'true', hidden: '' });
  const circleEl = node('div', 'pf-map-circle', { hidden: '' });
  const pinLayer = node('div', 'pf-map-pins');
  const markerEl = node('button', 'pf-map-marker', { type: 'button', hidden: '', title: 'Ponto da repartição (arraste para ajustar)' });
  const ctl = node('div', 'pf-map-ctl');
  const plus = node('button', 'btn small', { type: 'button', title: 'Aproximar', 'aria-label': 'Aproximar' }); plus.textContent = '+';
  const minus = node('button', 'btn small', { type: 'button', title: 'Afastar', 'aria-label': 'Afastar' }); minus.textContent = '−';
  ctl.append(plus, minus);
  const credit = node('a', 'pf-map-credit', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener noreferrer' });
  credit.textContent = '© OpenStreetMap';
  // tiles: false = sem o fundo do OpenStreetMap (a página da repartição não carrega nada de fora): só o contorno e os pinos
  box.replaceChildren(...[tileLayer, shape, circleEl, pinLayer, markerEl, ctl, useTiles ? credit : null].filter(Boolean));

  const size = () => ({ w: box.clientWidth || 640, h: box.clientHeight || 420 });
  const toScreen = (lat, lng) => { const { w, h } = size(); const c = project(view.lat, view.lng, view.zoom); const p = project(lat, lng, view.zoom); return { x: p.x - c.x + w / 2, y: p.y - c.y + h / 2 }; };
  const toGeo = (x, y) => { const { w, h } = size(); const c = project(view.lat, view.lng, view.zoom); return unproject(c.x + x - w / 2, c.y + y - h / 2, view.zoom); };
  const place = (n, p) => { n.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`; };
  /** O menor zoom que a trava deixa: o da cidade inteira. */
  const minZoom = () => { if (!bounds) return MIN_ZOOM; const { w, h } = size(); return fitBoundsView(bounds, w, h, FIT_PAD)?.zoom ?? MIN_ZOOM; };

  /** O contorno (e o lado de fora escurecido) no <canvas>, na vista de agora. */
  function drawShape(w, h) {
    shape.hidden = !outline;
    if (!outline) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    if (shape.width !== Math.round(w * dpr) || shape.height !== Math.round(h * dpr)) { shape.width = Math.round(w * dpr); shape.height = Math.round(h * dpr); }
    const g = shape.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const k = 2 ** view.zoom; const c = project(view.lat, view.lng, view.zoom);
    const ox = w / 2 - c.x; const oy = h / 2 - c.y;
    const trace = () => {
      for (const r of outline.rings) {
        g.moveTo(r[0] * k + ox, r[1] * k + oy);
        for (let i = 2; i < r.length; i += 2) g.lineTo(r[i] * k + ox, r[i + 1] * k + oy);
        g.closePath();
      }
    };
    if (outline.mask) { g.beginPath(); g.rect(0, 0, w, h); trace(); g.fillStyle = 'rgba(9, 12, 18, .58)'; g.fill('evenodd'); }
    g.beginPath(); trace();
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(9, 12, 18, .85)'; g.lineWidth = 5; g.stroke();
    g.strokeStyle = outline.color; g.lineWidth = 2.5; g.stroke();
  }

  function render() {
    const { w, h } = size();
    const want = useTiles ? tilesFor(view, view.zoom, w, h) : [];
    const keep = new Set(want.map((t) => t.key));
    for (const [k, img] of tiles) if (!keep.has(k)) { img.remove(); tiles.delete(k); }
    for (const t of want) {
      let img = tiles.get(t.key);
      if (!img) {
        img = node('img', 'pf-map-tile', { alt: '', draggable: 'false', decoding: 'async', width: String(TILE), height: String(TILE) });
        // sem rede ou quadro recusado: a imagem some e fica o fundo liso (os pinos não dependem dela)
        img.addEventListener('error', () => { img.hidden = true; });
        img.src = tileUrl(t);
        tiles.set(t.key, img); tileLayer.append(img);
      }
      img.style.width = `${t.size}px`; img.style.height = `${t.sizeY}px`;
      place(img, { x: t.left, y: t.top });
    }
    drawShape(w, h);
    pinLayer.classList.toggle('counts', view.zoom >= COUNT_ZOOM);
    // pinos no mesmo ponto (várias telas de uma repartição): abrem em leque para todos aparecerem
    const seen = new Map();
    for (const p of pins) {
      const at = toScreen(p.lat, p.lng);
      const k = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
      const i = seen.get(k) || 0; seen.set(k, i + 1);
      if (i) { const a = i * 2.4; const r = 9 + 3 * Math.sqrt(i); at.x += Math.cos(a) * r; at.y += Math.sin(a) * r; }
      place(p.el, at);
      p.el.hidden = at.x < -30 || at.y < -30 || at.x > w + 30 || at.y > h + 30;
    }
    markerEl.hidden = !marker;
    if (marker) place(markerEl, toScreen(marker.lat, marker.lng));
    circleEl.hidden = !circle;
    if (circle) {
      const r = circle.meters / metersPerPixel(circle.lat, view.zoom);
      circleEl.style.width = circleEl.style.height = `${Math.round(2 * r)}px`;
      const c = toScreen(circle.lat, circle.lng);
      place(circleEl, { x: c.x - r, y: c.y - r });
    }
  }
  function setView(lat, lng, z = view.zoom, silent = false) {
    const { w, h } = size();
    const zz = clamp(Number.isFinite(z) ? z : view.zoom, Math.max(MIN_ZOOM, minZoom()), MAX_ZOOM);
    let c = { lat: clamp(lat, -MAX_LAT, MAX_LAT), lng: ((lng + 540) % 360) - 180 };
    if (bounds) c = clampCenter(c, zz, bounds, w, h);
    view = { lat: c.lat, lng: c.lng, zoom: zz };
    fitted = false;
    render();
    if (!silent) onView?.({ ...view });
  }
  /** A caixa inteira na área toda (zoom fracionário). Sem argumento, a da trava (ou a última enquadrada). */
  function fitBounds(b = bounds || fitBox) {
    const { w, h } = size();
    const v = fitBoundsView(b, w, h, FIT_PAD);
    if (!v) return false;
    view = { lat: v.lat, lng: v.lng, zoom: v.zoom };
    fitted = true; fitBox = b;
    render();
    return true;
  }
  /** Zoom mantendo fixo o ponto da tela (x, y): o que está sob o cursor continua sob o cursor. Anda nos zooms inteiros. */
  function zoomAt(z, x, y) {
    const nz = clamp(Math.round(z), Math.max(MIN_ZOOM, minZoom()), MAX_ZOOM);
    if (Math.abs(nz - view.zoom) < 1e-9) return;
    const { w, h } = size();
    const g = toGeo(x ?? w / 2, y ?? h / 2);
    const p = project(g.lat, g.lng, nz);
    const c = unproject(p.x - ((x ?? w / 2) - w / 2), p.y - ((y ?? h / 2) - h / 2), nz);
    setView(c.lat, c.lng, nz);
  }
  /** Um passo de zoom: do fracionário (a cidade inteira) vai ao inteiro seguinte; afastando, para na cidade inteira. */
  const stepZoom = (dir, x, y) => {
    const want = dir > 0 ? Math.floor(view.zoom + 1.0001) : Math.ceil(view.zoom - 1.0001);
    if (dir < 0 && bounds && want <= minZoom()) { if (!fitBounds(bounds)) return; onView?.({ ...view, fitted: true }); return; }
    zoomAt(want, x, y);
  };

  /* arrastar o mapa (e separar o clique do arrasto) */
  let drag = null;
  const local = (e) => { const r = box.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  box.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest(UI)) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, c: project(view.lat, view.lng, view.zoom), moved: false };
    box.setPointerCapture?.(e.pointerId);
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true; box.classList.add('dragging');
    const g = unproject(drag.c.x - dx, drag.c.y - dy, view.zoom);
    setView(g.lat, g.lng, view.zoom, true);
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null; box.classList.remove('dragging');
    if (d.moved) onView?.({ ...view });
    else if (e.type === 'pointerup' && onClick) { const p = local(e); onClick(toGeo(p.x, p.y)); }
  };
  box.addEventListener('pointerup', endDrag);
  box.addEventListener('pointercancel', endDrag);
  box.addEventListener('wheel', (e) => { if (e.target.closest('.pf-map-ui')) return; e.preventDefault(); const p = local(e); stepZoom(e.deltaY < 0 ? 1 : -1, p.x, p.y); }, { passive: false });
  box.addEventListener('dblclick', (e) => { if (e.target.closest(UI)) return; const p = local(e); stepZoom(1, p.x, p.y); });
  box.addEventListener('keydown', (e) => {
    if (e.target !== box) return;
    const step = 80; const c = project(view.lat, view.lng, view.zoom);
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (move) { e.preventDefault(); const g = unproject(c.x + move[0], c.y + move[1], view.zoom); setView(g.lat, g.lng); } else if (e.key === '+' || e.key === '=') stepZoom(1); else if (e.key === '-') stepZoom(-1);
  });
  plus.addEventListener('click', () => stepZoom(1));
  minus.addEventListener('click', () => stepZoom(-1));

  /* arrastar o ponto da repartição */
  let mdrag = null;
  markerEl.addEventListener('pointerdown', (e) => { if (!marker?.draggable || e.button !== 0) return; mdrag = e.pointerId; markerEl.setPointerCapture?.(e.pointerId); e.preventDefault(); });
  markerEl.addEventListener('pointermove', (e) => { if (mdrag !== e.pointerId) return; const p = local(e); const g = toGeo(p.x, p.y); marker.lat = g.lat; marker.lng = g.lng; place(markerEl, p); });
  const endMarker = (e) => { if (mdrag !== e.pointerId) return; mdrag = null; marker.onChange?.({ lat: marker.lat, lng: marker.lng }); };
  markerEl.addEventListener('pointerup', endMarker);
  markerEl.addEventListener('pointercancel', endMarker);

  // a caixa mudou de tamanho (tela cheia, janela): a cidade inteira continua inteira; senão, a vista volta para dentro da trava
  const onResize = () => { if (fitted && fitBounds(fitBox)) return; if (bounds) setView(view.lat, view.lng, view.zoom, true); else render(); };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
  ro?.observe(box);
  render();

  return {
    setPins(list) {
      pinLayer.replaceChildren();
      pins = (list || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).map((p) => {
        const b = node('button', `pf-map-pin ${p.status || ''}${p.selected ? ' sel' : ''}${p.label ? ' tag' : ''}${p.cls ? ` ${p.cls}` : ''}`, { type: 'button', title: p.title || '', 'aria-label': p.title || 'Tela' });
        if (p.color) b.style.setProperty('--pf-ring', p.color);
        if (p.label) { const t = node('span', 'pf-map-pin-t'); t.textContent = p.label; b.append(t); }
        if (p.count != null) { const n = node('span', 'pf-map-pin-n'); n.textContent = String(p.count); b.append(n); }
        b.addEventListener('click', (e) => { e.stopPropagation(); onPin?.(p.id); });
        pinLayer.append(b);
        return { ...p, el: b };
      });
      render();
    },
    setMarker(m) { marker = m && Number.isFinite(m.lat) && Number.isFinite(m.lng) ? { ...m } : null; markerEl.classList.toggle('fixed', !marker?.draggable); render(); },
    setCircle(c) { circle = c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && c.meters > 0 ? { ...c } : null; render(); },
    setOutline(polygons, { mask = false } = {}) {
      if (!Array.isArray(polygons) || !polygons.length) outline = null;
      else {
        const rings = [];
        for (const poly of polygons) for (const ring of poly) {
          const r = new Float64Array(ring.length * 2);
          ring.forEach(([lng, lat], i) => { const p = project(lat, lng, 0); r[2 * i] = p.x; r[2 * i + 1] = p.y; });
          if (ring.length >= 3) rings.push(r);
        }
        outline = { rings, mask, color: getComputedStyle(box).getPropertyValue('--pf-outline').trim() || '#f5b31c' };
      }
      render();
    },
    setBounds(b) { bounds = okBox(b) ? { south: b.south, west: b.west, north: b.north, east: b.east } : null; if (bounds) { setView(view.lat, view.lng, view.zoom, true); } },
    fitBounds,
    fit(points, pad) { const { w, h } = size(); const v = fitView(points, w, h, pad); if (v) setView(v.lat, v.lng, v.zoom, true); return Boolean(v); },
    setView: (lat, lng, z) => setView(lat, lng, z, true),
    view: () => ({ ...view }),
    fitted: () => fitted,
    box,
    render,
    destroy() { ro?.disconnect(); box.replaceChildren(); box.classList.remove('pf-map'); },
  };
}
