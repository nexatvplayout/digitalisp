// Aba "Ao vivo (HLS)": os canais ao vivo da conta (NEXA Broadcast, IPTV do provedor, câmera, qualquer .m3u8), quantos
// quiser, com a prévia tocando aqui mesmo. A unidade escolhe qual canal passa na zona de vídeo do layout.
// Rotas /api/hls (server/hls.js). A prévia usa o hls.js servido pelo próprio sistema (/vendor/hls.js); no Safari, o nativo.
import { el, guard, toast, put, f, btn, note, label } from './tvcorp-base.js';
import { api } from '../lib.js';
import { ehYoutube, iframeYoutube } from './tvcorp-youtube.js';

// o hls.js do próprio sistema (node_modules, servido em /vendor/hls.mjs), carregado só quando a prévia é usada
let hlsLib = null;
const carregarHlsJs = () => hlsLib || (hlsLib = import('/vendor/hls.mjs').then((m) => m.default).catch((e) => { hlsLib = null; throw new Error(`Não foi possível carregar o player (${e.message}).`); }));

let atual = null; // { video, hls }
function pararPrevia() {
  if (!atual) return;
  atual.hls?.destroy();
  atual.video.pause();
  atual.video.removeAttribute('src');
  atual.video.load();
  atual = null;
}

/** Toca o HLS na caixa e diz o que aconteceu. */
async function previa(box, url) {
  pararPrevia();
  if (ehYoutube(url)) { put(box, iframeYoutube(url, { classe: 'av-video' }), el('p', { class: 'dim small', text: 'Prévia sem som. Na TV, o vídeo toca no volume da tela.' })); return; }
  const video = el('video', { class: 'av-video', controls: true, playsinline: true, autoplay: true });
  video.muted = true;
  const st = el('p', { class: 'dim small', text: 'Conectando…' });
  put(box, video, st);
  video.addEventListener('playing', () => { st.textContent = 'Tocando. A prévia começa sem som: use o volume do player para ouvir.'; }, { once: true });
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url; atual = { video }; video.play().catch(() => {});
    return;
  }
  try {
    const Hls = await carregarHlsJs();
    if (!Hls || !Hls.isSupported()) { st.textContent = 'Este navegador não toca HLS. A TV toca normalmente.'; return; }
    const hls = new Hls({ lowLatencyMode: false });
    atual = { video, hls };
    hls.on(Hls.Events.ERROR, (_e, d) => {
      if (!d.fatal) return;
      st.textContent = d.type === 'networkError'
        ? 'Não deu para abrir o endereço daqui. Confira o link. Se ele estiver certo, o servidor do canal pode não liberar o acesso pelo navegador (CORS); a TV costuma tocar mesmo assim.'
        : `Erro no vídeo (${d.details}).`;
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    video.play().catch(() => {});
  } catch (e) { st.textContent = e.message; }
}

export default async function paintAoVivo(box) {
  pararPrevia();
  const r = await api('/api/hls').catch(() => []);
  const lista = Array.isArray(r) ? r : [];
  const prev = el('div', { class: 'av-prev' }, note('Clique em "Prévia" num canal para ver aqui.', 'dim'));
  const nome = el('input', { type: 'text', maxlength: '80', placeholder: 'Ex.: TV do Provedor' });
  const url = el('input', { type: 'url', maxlength: '500', placeholder: 'https://…/playlist.m3u8' });
  // de onde vem o ao vivo: o endereço HLS ou um vídeo ao vivo do YouTube (cola o link do vídeo ou do canal)
  const urlCampo = f('Endereço HLS (.m3u8)', url);
  const tipo = el('select', { 'aria-label': 'Tipo do canal', onchange: () => {
    const yt = tipo.value === 'youtube';
    urlCampo.querySelector('span').textContent = yt ? 'Link do YouTube (o vídeo ao vivo ou o canal)' : 'Endereço HLS (.m3u8)';
    url.placeholder = yt ? 'youtube.com/watch?v=…  ou  youtube.com/@canal' : 'https://…/playlist.m3u8';
    if (yt && !nome.value) nome.value = 'YouTube ao vivo';
  } }, el('option', { value: 'hls', text: 'Link HLS (.m3u8)' }), el('option', { value: 'youtube', text: 'YouTube (colar o link)' }));
  const linha = (c) => el('div', { class: 'av-row' },
    el('div', { class: 'av-info' }, el('b', { text: c.name }), c.ativo ? null : el('span', { class: 'dim small', text: ' (desligado)' }), c.youtube ? el('span', { class: 'pf-chip', text: 'YouTube' }) : null, el('div', { class: 'dim small av-url', text: c.url })),
    el('div', { class: 'av-btns' },
      btn('Prévia', () => previa(prev, c.url), 'small'),
      btn(c.ativo ? 'Desligar' : 'Ligar', guard(async () => { await api(`/api/hls/${c.id}`, { method: 'PATCH', body: { ativo: !c.ativo } }); await paintAoVivo(box); }), 'small'),
      btn('Apagar', guard(async () => {
        if (!confirm(`Apagar o canal "${c.name}"? As unidades que usavam ficam sem ao vivo.`)) return;
        await api(`/api/hls/${c.id}`, { method: 'DELETE' }); toast('Canal apagado.'); await paintAoVivo(box);
      }), 'small')));
  put(box,
    note('Cadastre quantos canais ao vivo quiser: um canal do NEXA Broadcast, a TV do provedor (IPTV), uma câmera, qualquer endereço .m3u8 ou um vídeo ao vivo do YouTube (o link do vídeo, ou o do canal para tocar a live que estiver no ar). Em "Unidades e grupos", escolha qual canal passa na zona de vídeo das telas de cada unidade (o layout precisa ter uma zona de vídeo).', 'dim'),
    el('div', { class: 'av-grid' },
      el('div', { class: 'card' },
        label('Novo canal ao vivo'),
        el('div', { class: 'pf-grid' }, f('De onde vem', tipo), f('Nome do canal', nome), urlCampo),
        el('div', { class: 'av-btns' },
          btn('Prévia', () => { if (!url.value.trim()) { toast('Cole o endereço .m3u8 ou o link do YouTube.', true); return; } previa(prev, url.value.trim()); }, 'small'),
          btn('Salvar canal', guard(async () => { if (tipo.value === 'youtube' && !ehYoutube(url.value)) { toast('Cole um link do YouTube (youtube.com ou youtu.be).', true); return; } await api('/api/hls', { method: 'POST', body: { nome: nome.value, url: url.value } }); toast('Canal salvo.'); await paintAoVivo(box); }), 'primary')),
        label(`Canais cadastrados (${lista.length})`),
        lista.length ? el('div', { class: 'av-list' }, ...lista.map(linha)) : note('Nenhum canal ainda.', 'dim')),
      el('div', { class: 'card' }, label('Prévia'), prev)));
}
export const leaveAoVivo = pararPrevia;
