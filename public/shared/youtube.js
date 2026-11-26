// DIGITAL ISP · o link do YouTube como canal ao vivo (aba Ao vivo, zona de vídeo do layout). Lê os formatos de link que
// as pessoas copiam: o vídeo (watch?v=, youtu.be/, /live/, /embed/, /shorts/) e o canal (/channel/UC…, /@nome).
// O canal toca a transmissão ao vivo que estiver no ar (não para quando o canal começa outra live).

const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const CANAL = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE = /^@[A-Za-z0-9._-]{3,100}$/;
/** O endereço colado, com ou sem https:// na frente. */
const urlDe = (s) => { const t = String(s ?? '').trim(); return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`); };

/** O endereço é do YouTube? */
export function ehYoutube(url) {
  try { return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(urlDe(url).hostname); } catch { return false; }
}

/** { v: id do vídeo } | { c: id do canal UC… } | { handle: '@nome' } | null (não é link de vídeo ou canal do YouTube). */
export function youtubeDe(url) {
  let u; try { u = urlDe(url); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  const p = u.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') return VIDEO.test(p[0] || '') ? { v: p[0] } : null;
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  if (p[0] === 'watch') { const v = u.searchParams.get('v') || ''; return VIDEO.test(v) ? { v } : null; }
  if (p[0] === 'embed' && p[1] === 'live_stream') { const c = u.searchParams.get('channel') || ''; return CANAL.test(c) ? { c } : null; }
  if (['live', 'embed', 'shorts', 'v'].includes(p[0]) && VIDEO.test(p[1] || '')) return { v: p[1] };
  if (p[0] === 'channel' && CANAL.test(p[1] || '')) return { c: p[1] };
  if (HANDLE.test(p[0] || '')) return { handle: p[0] };
  if (p[0] === 'c' || p[0] === 'user') return null; // os endereços antigos: não dá para saber o canal
  return null;
}

/** O link guardado (o mesmo formato sempre): o do vídeo ou o da live do canal. */
export const youtubeUrl = (y) => (y?.v ? `https://www.youtube.com/watch?v=${y.v}` : y?.c ? `https://www.youtube.com/channel/${y.c}/live` : null);

/** A pergunta da página que toca na TV (/telas/youtube.html): v= ou c=. */
export const youtubeQuery = (y) => (y?.v ? `v=${y.v}` : y?.c ? `c=${y.c}` : '');
