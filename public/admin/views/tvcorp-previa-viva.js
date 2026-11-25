// TV Corporativa · a prévia grande e ao vivo de um layout: ocupa a tela do computador, toca o canal ao vivo (HLS) na zona de
// vídeo e passa a playlist de cada zona item por item, no tempo de cada um, como a TV faz. Abre pelos Layouts (editor e
// cartões) e pela Grade (com as playlists da grade). Fechar para o vídeo e os relógios.
import { el, tapi, put, opt, label, note, btn, dialog, listOf } from './tvcorp-base.js';
import { layoutPreview, itemPreview } from '../../shared/tvcorp-previa.js';
import { themeOf } from './tvcorp-midias.js';

let hlsLib = null;
const carregarHlsJs = () => hlsLib || (hlsLib = import('/vendor/hls.mjs').then((m) => m.default).catch(() => { hlsLib = null; return null; }));

/** Toca o HLS num <video> (sem som de início: o navegador só deixa tocar sozinho assim). Devolve o "parar". */
async function tocar(video, url, aviso) {
  video.muted = true;
  if (!url) { aviso.textContent = 'Nenhum canal ao vivo cadastrado (aba Ao vivo).'; return () => {}; }
  if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = url; video.play().catch(() => {}); return () => { video.pause(); video.removeAttribute('src'); }; }
  const Hls = await carregarHlsJs();
  if (!Hls?.isSupported()) { aviso.textContent = 'Este navegador não toca HLS; a TV toca normalmente.'; return () => {}; }
  const hls = new Hls({ lowLatencyMode: false });
  hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) aviso.textContent = d.type === 'networkError' ? 'O canal não abriu no navegador (pode ser bloqueio do servidor do canal); a TV costuma tocar.' : `Erro no vídeo (${d.details}).`; });
  hls.loadSource(url); hls.attachMedia(video); video.play().catch(() => {});
  return () => { hls.destroy(); video.pause(); video.removeAttribute('src'); };
}

/**
 * Abre a prévia. layout: { id?, orientation, zones, background, name }. Os itens de cada zona vêm do servidor, montados como
 * a TV recebe (POST /api/tvcorp/layouts/ao-vivo): a grade que usa o layout, ou as playlists escolhidas no próprio layout.
 * zonePlaylists: as da grade que está sendo editada. zoneItems: os itens que uma tela recebe agora (Ver a tela agora).
 */
export async function abrirPreviaViva(layout, { zonePlaylists = null, titulo = '', canalUrl = null, zoneItems = null } = {}) {
  const paradas = [];
  const parar = () => { while (paradas.length) { try { paradas.pop()(); } catch { /* já parou */ } } };
  let somLigado = false;
  const salvo = Number.isInteger(layout.id) && layout.id > 0; // os modelos prontos não têm id
  const [canais, feeds, vivo] = await Promise.all([tapi('/api/hls').catch(() => []), tapi('/api/tvcorp/feeds').catch(() => null),
    zoneItems ? null : tapi('/api/tvcorp/layouts/ao-vivo', { method: 'POST', body: { ...(salvo ? { layoutId: layout.id } : {}), layout: { name: layout.name || 'Prévia', orientation: layout.orientation, zones: layout.zones, background: layout.background }, ...(zonePlaylists ? { zonePlaylists } : {}) } }).catch(() => null)]);
  const itensDaZona = zoneItems || vivo?.zones || {};
  // o clima de verdade (a fonte Clima da empresa), como a TV mostra
  const wf = listOf(feeds, 'feeds').find((f) => f.kind === 'weather' && f.enabled !== false && f.preview?.tempC != null)?.preview || null;
  const clima = wf ? { now: { temp: wf.tempC, cond: wf.cond, text: wf.text }, place: { city: wf.city } } : null;
  const listaCanais = (Array.isArray(canais) ? canais : []).filter((c) => c.ativo !== false);
  const canal = el('select', { 'aria-label': 'Canal ao vivo' }, ...listaCanais.map((c, i) => opt(c.url, c.name || `Canal ${i + 1}`, canalUrl ? c.url === canalUrl : i === 0)));
  const aviso = el('p', { class: 'small dim', 'aria-live': 'polite' });
  const palco = el('div', { class: `tc-live-palco${layout.orientation === 'port' ? ' port' : ''}` });
  const aplicaSom = () => palco.querySelectorAll('video, audio').forEach((m) => { m.muted = !somLigado; if (somLigado) m.play?.().catch(() => {}); });

  async function montar() {
    parar();
    const pv = layoutPreview(layout, { theme: { ...themeOf(), mode: layout.background === '#eef2f7' ? 'light' : themeOf().mode }, labels: false, ticker: ['Prévia ao vivo: o texto rolante da tela aparece aqui'], weather: clima });
    put(palco, pv);
    const zonaEl = (id) => pv.querySelector?.(`[data-zone="${id}"] .tvc-z`);
    // o vídeo ao vivo na zona de vídeo
    for (const z of (layout.zones || []).filter((x) => x.kind === 'video')) {
      const box = zonaEl(z.id); if (!box) continue;
      const video = el('video', { class: `tc-live-video${z.fit === 'cover' ? ' cobrir' : ''}`, playsinline: true, autoplay: true, muted: true });
      put(box, video);
      paradas.push(await tocar(video, canal.value || listaCanais[0]?.url, aviso));
    }
    // a rádio de fundo do layout (sem vídeo), como a TV toca
    if (vivo?.audio?.url) {
      const a = el('audio', { src: vivo.audio.url, autoplay: true, muted: true });
      a.volume = Math.min(1, Math.max(0, (Number(vivo.audio.volume) || 80) / 100));
      palco.append(a); a.play().catch(() => {});
      paradas.push(() => { a.pause(); a.removeAttribute('src'); });
    }
    // cada zona passa os itens que a TV recebe, item por item, no tempo de cada um
    for (const [zid, lista] of Object.entries(itensDaZona)) {
      const box = zonaEl(zid); const itens = Array.isArray(lista) ? lista : [];
      if (!box || !itens.length) continue;
      let i = 0; let ligado = true; let t = null;
      const passo = () => {
        if (!ligado) return;
        const it = itens[i % itens.length]; i++;
        put(box, itemPreview(it, { theme: themeOf() }));
        aplicaSom();
        t = setTimeout(passo, Math.max(3, Number(it.seconds) || 10) * 1000);
      };
      paradas.push(() => { ligado = false; clearTimeout(t); });
      passo();
    }
    aplicaSom();
  }
  canal.addEventListener('change', montar);
  const som = btn('🔇 Ligar o som', () => { somLigado = !somLigado; som.textContent = somLigado ? '🔊 Desligar o som' : '🔇 Ligar o som'; som.setAttribute('aria-pressed', String(somLigado)); aplicaSom(); }, 'small');
  som.setAttribute('aria-pressed', 'false');
  const origem = zoneItems ? null : vivo?.grade ? `Como as telas recebem agora: grade "${vivo.grade.name}".` : vivo ? 'Como as telas recebem: as playlists escolhidas no layout (nenhuma grade usa este layout ainda).' : null;
  const { dlg } = dialog(titulo || `Prévia ao vivo${layout.name ? ` · ${layout.name}` : ''}`, el('div', { class: 'tc-live' },
    el('div', { class: 'tc-live-bar' }, listaCanais.length && (layout.zones || []).some((z) => z.kind === 'video') ? el('label', { class: 'tc-live-sel' }, el('span', { class: 'small', text: 'Canal' }), canal) : null,
      som, btn('Tela cheia', () => palco.requestFullscreen?.().catch(() => {}), 'small')),
    origem ? note(origem, 'small dim') : null, palco, aviso,
    note('Os itens passam no tempo de cada um, como na TV. O som começa desligado (regra do navegador): use o botão para ouvir.', 'small dim')), { wide: true });
  dlg.classList.add('tc-live-dlg');
  dlg.addEventListener('close', parar);
  await montar();
}
