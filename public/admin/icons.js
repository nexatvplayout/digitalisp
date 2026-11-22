// Ícones do painel em SVG, no traço dos ícones do menu (24 × 24, linha de 2, pontas redondas, cor do texto). Substituem
// emoji e símbolos de fonte (▶ ■ ✕ 🔊…), que mudam de cara e de tamanho conforme o sistema e a fonte.
//   el('button', { class: 'btn small' }, ...withIcon('play', 'Rodar'))      ícone + texto
//   el('button', { class: 'btn small icon', title: 'Remover', 'aria-label': 'Remover' }, icon('close'))   só o ícone
//   setIcon(botao, 'pause')  /  setIcon(botao, 'stop', 'Tirar')             troca o conteúdo de um botão já na tela
// Estilo: .ico em admin.css (classe "f" = forma cheia, para os comandos de transporte).
const PATHS = {
  play: '<path class="f" d="M7 4.5v15l12-7.5z"/>',
  pause: '<rect class="f" x="6" y="5" width="4" height="14" rx="1"/><rect class="f" x="14" y="5" width="4" height="14" rx="1"/>',
  stop: '<rect class="f" x="6" y="6" width="12" height="12" rx="1.5"/>',
  prev: '<path class="f" d="M17 4.5v15L5 12z"/>',
  first: '<path d="M6 5v14"/><path class="f" d="M19 5v14L8 12z"/>',
  next: '<path d="M18 5v14"/><path class="f" d="M5 5v14l11-7z"/>',
  'frame-prev': '<path class="f" d="M15 5v14L6 12z"/><path d="M19 5v14"/>',
  'frame-next': '<path d="M5 5v14"/><path class="f" d="M9 5v14l9-7z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  'arrow-up': '<path d="M12 19V5M6 11l6-6 6 6"/>',
  'arrow-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  merge: '<path d="M7 4v5a5 5 0 0 0 5 5 5 5 0 0 0 5-5V4"/><path d="M12 14v6M9 17l3 3 3-3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  eyedropper: '<path d="M14 4l6 6-3 3-6-6z"/><path d="M12.5 8.5L5 16v3h3l7.5-7.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  'thumb-up': '<path d="M7 11v9H4v-9z"/><path d="M7 11l4-7a2 2 0 0 1 3 2l-1 4h5.5a2 2 0 0 1 2 2.4l-1.3 6A2 2 0 0 1 17.2 20H7"/>',
  'thumb-down': '<path d="M7 13V4H4v9z"/><path d="M7 13l4 7a2 2 0 0 0 3-2l-1-4h5.5a2 2 0 0 0 2-2.4l-1.3-6A2 2 0 0 0 17.2 4H7"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4.5h4.5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M3 3l18 18"/><path d="M10.6 5.1Q11.3 5 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  alert: '<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  swap: '<path d="M4 8h15l-4-4M20 16H5l4 4"/>',
  star: '<path d="M12 3.5l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 17l-5.3 2.8 1.1-5.9-4.4-4.1 6-.8z"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  dot: '<circle class="f" cx="12" cy="12" r="5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  pin: '<path d="M9 3.5h6l-1 6.5 3.5 3.5h-11L10 10z"/><path d="M12 13.5V21"/>', // fixar (a faixa da máquina no topo)
  shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  // modos do Composer
  ball: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5l4 2.9-1.5 4.7h-5L8 10.4z"/><path d="M12 3v4.5M16 10.4l4.3-1.4M14.5 15.1l2.6 3.7M9.5 15.1l-2.6 3.7M8 10.4L3.7 9"/>',
  news: '<rect x="3" y="4" width="15" height="16" rx="1.5"/><path d="M18 8h3v10.5a1.5 1.5 0 0 1-3 0M6.5 8h8M6.5 12h8M6.5 16h5"/>',
  cross: '<path d="M12 3v18M7 8h10"/>',
  live: '<circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14L7 22l5-3 5 3-1.5-8"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l1.5-2.5h5L16 7"/><circle cx="12" cy="13.5" r="3.5"/>',
  // Monitoramento: a parede de monitores (2 × 2) com o ponto do alarme (menu e views/monitoramento.js)
  monitoring: '<rect x="2.5" y="3.5" width="8.5" height="6.5" rx="1"/><rect x="13" y="3.5" width="8.5" height="6.5" rx="1"/><rect x="2.5" y="12" width="8.5" height="6.5" rx="1"/><path d="M13 12h8.5v6.5H13zM7 21h10"/><circle class="f" cx="17.25" cy="15.25" r="1.6"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  'bell-off': '<path d="M6 16V11a6 6 0 0 1 9.5-4.9M18 11v5l1.5 2h-15"/><path d="M10 20.5a2 2 0 0 0 4 0M3.5 3.5l17 17"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1"/>',
};

const NS = 'http://www.w3.org/2000/svg';

/** O ícone `name` como <svg class="ico">. Sem `label` ele é decorativo (aria-hidden): o texto ou o aria-label do botão fala por ele. */
export function icon(name, { label } = {}) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `ico ico-${name}`);
  if (label) { s.setAttribute('role', 'img'); s.setAttribute('aria-label', label); } else s.setAttribute('aria-hidden', 'true');
  s.innerHTML = PATHS[name] || '';
  return s;
}

/** Filhos para el(): o ícone e, se houver, o texto. */
export const withIcon = (name, text) => (text ? [icon(name), text] : [icon(name)]);

/** Troca o conteúdo de um botão que já está na tela (play ⇄ pausa, "▶ Pôr" ⇄ "■ Tirar"). */
export function setIcon(node, name, text) { node.replaceChildren(...withIcon(name, text)); }

// botões escritos direto no index.html: <button data-icon="play">Rever entrada</button> ganham o ícone quando o painel carrega
if (typeof document !== 'undefined') for (const n of document.querySelectorAll('[data-icon]')) if (!n.querySelector(':scope > .ico')) n.prepend(icon(n.dataset.icon));
