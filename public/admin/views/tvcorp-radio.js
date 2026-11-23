// TV Corporativa · a rádio de fundo do layout (layout sem o vídeo do canal: loja, recepção, academia). A lista vem de
// GET /api/radios (~1.200 rádios do Brasil, base aberta Radio Browser); a escolha fica em PUT /api/tvcorp/layouts/:id/radio.
import { el, tapi, put, opt, note, btn, f } from './tvcorp-base.js';

let LISTA = null; // a lista, buscada uma vez por página
const lista = async () => (LISTA ||= await tapi('/api/radios').catch(() => ({ stations: [], genres: [], states: [] })));
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * O campo da rádio no editor do layout. layoutId: o layout que já existe (ou null, novo). hasVideo(): o layout tem zona de
 * vídeo (aí a rádio não vale). Devolve { node, save(id) } — save grava a escolha depois que o layout foi salvo.
 */
export function radioPicker(layoutId, hasVideo) {
  const st = { station: null, volume: 100, changed: false };
  const q = el('input', { type: 'search', placeholder: 'Buscar rádio: nome, cidade, gênero…', 'aria-label': 'Buscar rádio' });
  const genre = el('select', { 'aria-label': 'Gênero' }, opt('', 'Todos os gêneros', true));
  const uf = el('select', { 'aria-label': 'Estado' }, opt('', 'Todo o Brasil', true));
  const res = el('select', { size: '6', 'aria-label': 'Rádios encontradas', class: 'tc-radio-res' });
  const atual = el('p', { class: 'small', 'aria-live': 'polite' });
  const vol = el('input', { type: 'range', min: '10', max: '100', step: '5', value: '100', 'aria-label': 'Volume da rádio' });
  const ouvir = el('audio', { controls: true, preload: 'none', hidden: true, class: 'tc-radio-audio' });
  const aviso = note('');
  const paintAtual = () => {
    atual.textContent = st.station ? `Rádio de fundo: ${st.station.n}${st.station.uf ? ` (${st.station.uf})` : ''} · volume ${st.volume}%` : 'Sem rádio de fundo.';
    const s = st.station && LISTA?.stations.find((x) => String(x.id) === String(st.station.id));
    ouvir.hidden = !s?.https; if (s?.https) ouvir.src = s.https; else ouvir.removeAttribute('src');
    aviso.textContent = st.station && !s?.https ? 'Esta rádio não tem endereço seguro (https): a prévia não toca no navegador, mas toca na TV.' : '';
  };
  const filtrar = () => {
    const words = fold(q.value).split(/\s+/).filter(Boolean);
    const out = (LISTA?.stations || []).filter((s) => (!genre.value || (s.g || []).includes(genre.value)) && (!uf.value || s.uf === uf.value)
      && words.every((w) => fold(`${s.n} ${s.uf || ''} ${(s.g || []).join(' ')}`).includes(w))).slice(0, 80);
    put(res, ...out.map((s) => opt(String(s.id), `${s.n}${s.uf ? ` · ${s.uf}` : ''}`)));
  };
  q.addEventListener('input', filtrar); genre.addEventListener('change', filtrar); uf.addEventListener('change', filtrar);
  res.addEventListener('change', () => { const s = LISTA.stations.find((x) => String(x.id) === res.value); if (s) { st.station = s; st.changed = true; paintAtual(); } });
  vol.addEventListener('input', () => { st.volume = Number(vol.value); st.changed = true; paintAtual(); });
  const tirar = btn('Sem rádio', () => { st.station = null; st.changed = true; paintAtual(); }, 'small');
  const corpo = el('div', { class: 'tc-radio' },
    el('div', { class: 'tc-radio-bar' }, q, genre, uf), res, atual,
    el('div', { class: 'tc-radio-bar' }, f('Volume', vol), tirar), ouvir, aviso,
    note('O som toca junto do conteúdo do layout, no volume da tela (o "mudo" da tela também vale). Lista aberta do Radio Browser; o áudio vem do servidor de cada rádio.'));
  const bloqueio = note('Este layout tem a zona "Vídeo do canal": o som é o do canal. A rádio de fundo é para layouts sem vídeo.');
  const node = el('div', {}, corpo, bloqueio);
  const paintVideo = () => { const v = hasVideo(); corpo.hidden = v; bloqueio.hidden = !v; };
  (async () => {
    const l = await lista();
    put(genre, opt('', 'Todos os gêneros', true), ...(l.genres || []).map((g) => opt(g.id, `${g.name} (${g.count})`)));
    put(uf, opt('', 'Todo o Brasil', true), ...(l.states || []).map((s) => opt(s.uf, `${s.name} (${s.count})`)));
    filtrar();
    if (layoutId) { const r = await tapi(`/api/tvcorp/layouts/${layoutId}/radio`).catch(() => null); if (r?.station) { st.station = r.station; st.volume = r.volume || 100; vol.value = String(st.volume); } }
    paintAtual();
  })();
  paintVideo();
  return {
    node, refresh: paintVideo,
    save: async (id) => {
      if (!id || !st.changed || hasVideo()) return;
      await tapi(`/api/tvcorp/layouts/${id}/radio`, { method: 'PUT', body: { station: st.station?.id ?? null, volume: st.volume } });
    },
  };
}
