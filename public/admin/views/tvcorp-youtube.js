// DIGITAL ISP · o vídeo ao vivo do YouTube no lugar do canal: a prévia no painel (a mesma página que a TV abre,
// /tvcorp/youtube.html) e o "+ Vídeo ao vivo do YouTube" das listas de canal (cadastra como um canal da aba Ao vivo).
import { el, toast, tapi, opt } from './tvcorp-base.js';
import { ehYoutube, youtubeDe, youtubeQuery } from '../../shared/youtube.js';

export { ehYoutube };
export const OPCAO_YT = '__youtube';

/** O iframe da prévia (sem som por padrão). */
export function iframeYoutube(url, { mudo = true, classe = '' } = {}) {
  const y = youtubeDe(url);
  const q = y && !y.handle ? youtubeQuery(y) : '';
  return el('iframe', {
    class: `tc-yt${classe ? ` ${classe}` : ''}`, src: `/tvcorp/youtube.html?${q}&mute=${mudo ? 1 : 0}`, title: 'Vídeo ao vivo do YouTube',
    allow: 'autoplay; encrypted-media', referrerpolicy: 'strict-origin-when-cross-origin', loading: 'lazy',
  });
}

/** Como o canal aparece nas listas: "YouTube: nome" ou "Canal ao vivo: nome". */
export const nomeCanal = (c) => (c?.youtube || ehYoutube(c?.url) ? `YouTube: ${c.name}` : `Canal ao vivo: ${c.name}`);

/** A opção do fim das listas de canal. */
export const opcaoYoutube = () => opt(OPCAO_YT, '+ Vídeo ao vivo do YouTube (colar o link)…', false);

/** Pede o link e o nome e cadastra como canal ao vivo. Devolve o canal (ou null, se a pessoa desistiu). */
export async function novoCanalYoutube() {
  const link = prompt('Cole o link do vídeo ao vivo do YouTube (ou o do canal, para tocar a live que estiver no ar):\nEx.: https://www.youtube.com/watch?v=…  ·  https://youtu.be/…  ·  https://www.youtube.com/@canal');
  if (!link || !link.trim()) return null;
  if (!ehYoutube(link)) { toast('Esse link não é do YouTube.', true); return null; }
  const nome = prompt('Nome para este vídeo (aparece nas listas de canal):', 'YouTube ao vivo');
  if (nome == null) return null;
  const c = await tapi('/api/hls', { method: 'POST', body: { nome: (nome.trim() || 'YouTube ao vivo').slice(0, 80), url: link.trim() } });
  toast(`"${c.name}" cadastrado: ele também fica na aba Ao vivo.`);
  return c;
}
