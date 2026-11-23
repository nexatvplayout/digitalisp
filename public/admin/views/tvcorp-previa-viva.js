// TV Corporativa · a prévia grande e ao vivo de um layout: ocupa a tela do computador, toca o canal ao vivo (HLS) na zona de
// vídeo e passa a playlist de cada zona item por item, no tempo de cada um, como a TV faz. Abre pelos Layouts (editor e
// cartões) e pela Grade (com as playlists da grade). Fechar para o vídeo e os relógios.
import { el, tapi, put, opt, label, note, btn, dialog, listOf } from './tvcorp-base.js';
import { layoutPreview, itemPreview } from '../../shared/tvcorp-previa.js';
import { TVC_PLAYLIST_ZONES } from '../../shared/tvcorp-tipos.js';
import { previewOf, sources } from './tvcorp-playlists.js';
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
 * Abre a prévia. layout: { orientation, zones, background, name }. zonePlaylists: { zona: playlistId } (da grade), opcional:
 * sem ele, cada zona de playlist ganha um seletor (começa na primeira playlist).
 */
export async function abrirPreviaViva(layout, { zonePlaylists = null, titulo = '', canalUrl = null, zoneItems = null } = {}) {
  const paradas = [];
  const parar = () => { while (paradas.length) { try { paradas.pop()(); } catch { /* já parou */ } } };
  const [canais, src, pls, scheds, feeds] = await Promise.all([tapi('/api/hls').catch(() => []), sources(), tapi('/api/tvcorp/playlists').catch(() => null),
    zonePlaylists || zoneItems ? null : tapi('/api/tvcorp/schedules').catch(() => null), tapi('/api/tvcorp/feeds').catch(() => null)]);
  // sem grade escolhida: as playlists da grade (ou da programação de uma tela) que usa este layout, como as telas recebem
  const daGrade = listOf(scheds, 'schedules').find((x) => Number(x.layoutId) === Number(layout.id)) || null;
  if (!zonePlaylists && daGrade) zonePlaylists = daGrade.zonePlaylists || {};
  // o clima de verdade (a fonte Clima da empresa), como a TV mostra
  const wf = listOf(feeds, 'feeds').find((f) => f.kind === 'weather' && f.enabled !== false && f.preview?.tempC != null)?.preview || null;
  const clima = wf ? { now: { temp: wf.tempC, cond: wf.cond, text: wf.text }, place: { city: wf.city } } : null;
  const listaCanais = (Array.isArray(canais) ? canais : []).filter((c) => c.ativo !== false);
  const playlists = listOf(pls, 'playlists');
  // toda zona que recebe playlist (playlist, notícias, cotações, contador…); com zoneItems (os itens que a TV recebe agora),
  // essas zonas passam exatamente os itens da TV, sem seletor
  const zonasPl = (layout.zones || []).filter((z) => TVC_PLAYLIST_ZONES.includes(z.kind) && !zoneItems?.[z.id]);
  // a zona sem playlist na grade fica sem playlist (como na TV); sem grade nenhuma, começa na primeira playlist
  const escolha = Object.fromEntries(zonasPl.map((z) => [z.id, zonePlaylists ? zonePlaylists[z.id] ?? null : z.kind === 'news' ? null : playlists[0]?.id ?? null]));
  const canal = el('select', { 'aria-label': 'Canal ao vivo' }, ...listaCanais.map((c, i) => opt(c.url, c.name || `Canal ${i + 1}`, canalUrl ? c.url === canalUrl : i === 0)));
  const aviso = el('p', { class: 'small dim', 'aria-live': 'polite' });
  const palco = el('div', { class: 'tc-live-palco' });
  const seletores = zonasPl.map((z) => {
    const s = el('select', { 'aria-label': `Playlist da zona ${z.id}`, onchange: () => { escolha[z.id] = Number(s.value) || null; montar(); } },
      opt('', z.kind === 'news' ? 'Notícias automáticas (todas as fontes)' : 'Sem playlist', escolha[z.id] == null), ...playlists.map((p) => opt(p.id, p.name, Number(escolha[z.id]) === Number(p.id))));
    return el('label', { class: 'tc-live-sel' }, el('span', { class: 'small', text: `Zona ${z.id}` }), s);
  });

  async function montar() {
    parar();
    const pv = layoutPreview(layout, { theme: { ...themeOf(), mode: layout.background === '#eef2f7' ? 'light' : themeOf().mode }, labels: false, ticker: ['Prévia ao vivo: o texto rolante da tela aparece aqui'], weather: clima });
    put(palco, pv);
    const zonaEl = (id) => pv.querySelector?.(`[data-zone="${id}"] .tvc-z`);
    // o vídeo ao vivo na zona de vídeo
    for (const z of (layout.zones || []).filter((x) => x.kind === 'video')) {
      const box = zonaEl(z.id); if (!box) continue;
      const video = el('video', { class: 'tc-live-video', playsinline: true, autoplay: true, muted: true });
      put(box, video);
      paradas.push(await tocar(video, canal.value || listaCanais[0]?.url, aviso));
    }
    // os itens que a TV recebe agora (Ver a tela agora), item por item
    for (const [zid, lista] of Object.entries(zoneItems || {})) {
      const box = zonaEl(zid); const itens = Array.isArray(lista) ? lista : [];
      if (!box || !itens.length) continue;
      let i = 0; let vivo = true; let t = null;
      const passo = () => {
        if (!vivo) return;
        const it = itens[i % itens.length]; i++;
        put(box, itemPreview(it, { theme: themeOf() }));
        t = setTimeout(passo, Math.max(3, Number(it.seconds) || 10) * 1000);
      };
      paradas.push(() => { vivo = false; clearTimeout(t); });
      passo();
    }
    // a zona de Notícias sem playlist: as notícias das fontes ligadas, uma por vez com a foto (como o servidor manda)
    for (const z of zonasPl.filter((x) => x.kind === 'news' && !escolha[x.id])) {
      const box = zonaEl(z.id); if (!box) continue;
      const rss = listOf(feeds, 'feeds').filter((f) => f.kind === 'rss' && f.enabled !== false);
      const itens = [];
      for (const f of rss) {
        const r = await tapi(`/api/tvcorp/feeds/${f.id}/noticias`).catch(() => null);
        for (const i of (r?.items || []).filter((x) => !x.hidden)) itens.push({ kind: 'news', single: true, title: f.name, source: r.source, image: i.image, items: [{ title: i.title, source: r.source, at: i.at }], seconds: 12 });
      }
      if (!itens.length) continue;
      let i = 0; let vivo = true; let t = null;
      const passo = () => { if (!vivo) return; const it = itens[i % itens.length]; i++; put(box, itemPreview(it, { theme: themeOf() })); t = setTimeout(passo, 12000); };
      paradas.push(() => { vivo = false; clearTimeout(t); });
      passo();
    }
    // cada playlist passando, item por item, no tempo de cada um
    for (const z of zonasPl) {
      const box = zonaEl(z.id); const pid = escolha[z.id]; if (!box || !pid) continue;
      const full = await tapi(`/api/tvcorp/playlists/${pid}`).catch(() => null);
      const itens = (full?.items || []).map((x) => ({ ...x, params: x.params || {} }));
      if (!itens.length) { put(box, el('div', { class: 'tvc-z-empty' }, 'Playlist vazia')); continue; }
      let i = 0; let vivo = true; let t = null;
      const passo = async () => {
        if (!vivo) return;
        const it = itens[i % itens.length]; i++;
        put(box, await previewOf(it, src));
        t = setTimeout(passo, Math.max(3, Number(it.seconds) || 10) * 1000);
      };
      paradas.push(() => { vivo = false; clearTimeout(t); });
      passo();
    }
  }
  canal.addEventListener('change', montar);
  const { dlg } = dialog(titulo || `Prévia ao vivo${layout.name ? ` · ${layout.name}` : ''}`, el('div', { class: 'tc-live' },
    el('div', { class: 'tc-live-bar' }, listaCanais.length && (layout.zones || []).some((z) => z.kind === 'video') ? el('label', { class: 'tc-live-sel' }, el('span', { class: 'small', text: 'Canal' }), canal) : null, ...seletores,
      btn('Tela cheia', () => palco.requestFullscreen?.().catch(() => {}), 'small')),
    daGrade ? note(`Com as playlists da grade "${daGrade.name}", que usa este layout.`, 'small dim') : null, palco, aviso,
    note('A prévia começa sem som (regra do navegador). Os itens passam no tempo de cada um, como na TV; o texto rolante e os gadgets mostram exemplos.', 'small dim')), { wide: true });
  dlg.classList.add('tc-live-dlg');
  dlg.addEventListener('close', parar);
  await montar();
}
