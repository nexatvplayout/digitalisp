// TV Corporativa · os quadros dos layouts em pixels: o tamanho de cada zona de playlist na TV (1920×1080 deitada ou
// 1080×1920 em pé), o formato que combina com ela (deitado, em pé ou quase quadrado) e a dica do tamanho da arte.
// Usado nos Layouts (o tamanho de cada zona), nas Playlists (onde a playlist passa e o que combina) e nos Templates (o
// filtro "Para o quadro"). Só leitura: nada aqui muda o que vai para a tela.
import { TVC_FRAMES } from '../../shared/tvcorp-tipos.js';
import { FACTORY_LAYOUTS, zoneLabel } from './tvcorp-catalogo.js';

/** O tamanho da zona em pixels na tela (a TV desenha o layout em 1920×1080 ou 1080×1920). */
export function quadroPx(layout, z) {
  const fr = TVC_FRAMES[layout?.orientation === 'port' ? 'port' : 'land'];
  return { w: Math.round((fr.width * z.w) / 100), h: Math.round((fr.height * z.h) / 100) };
}

/** O formato do quadro: 'land' (deitado), 'port' (em pé) ou 'quad' (quase quadrado: os dois servem, cortando as sobras). */
export function formatoDe({ w, h }) {
  const r = w / Math.max(1, h);
  return r >= 1.25 ? 'land' : r <= 0.8 ? 'port' : 'quad';
}
export const FORMATO_TXT = { land: 'deitado (16:9)', port: 'em pé (9:16)', quad: 'quase quadrado' };

/** A dica do tamanho da arte para o quadro: o tamanho exato e o que mandar quando a arte é feita fora. */
export function dicaArte(q) {
  const { w, h } = q.px; const fmt = formatoDe(q.px);
  const exato = `${w}×${h} px`;
  const base = fmt === 'port' ? 'em pé (1080×1920)' : fmt === 'land' ? 'deitada (1920×1080)' : 'deitada ou em pé';
  const r = w / Math.max(1, h); const ideal = fmt === 'port' ? 9 / 16 : fmt === 'land' ? 16 / 9 : r;
  const corte = fmt !== 'quad' && Math.abs(r - ideal) / ideal > 0.08 ? (r < ideal ? 'as laterais são cortadas' : 'o alto e o pé são cortados') : '';
  return `Arte ideal: ${exato}, ${FORMATO_TXT[fmt]}. Feita fora do painel, envie ${base}${corte ? ` com o principal no centro: neste quadro ${corte}` : ''}.`;
}

/** As zonas de playlist de um layout, com o tamanho em pixels e o formato. */
export function quadrosDoLayout(layout) {
  return (layout?.zones || []).filter((z) => z.kind === 'playlist').map((z) => {
    const px = quadroPx(layout, z);
    return { layout, zone: z, px, formato: formatoDe(px), nome: `${layout.name || layout.label} · quadro "${z.id}"` };
  });
}

/** Onde a playlist passa: cada grade que a põe numa zona, com o layout e o tamanho do quadro. */
export function quadrosDaPlaylist(d, playlistId) {
  const out = [];
  for (const s of d?.schedules || []) {
    const lay = (d.layouts || []).find((l) => l.id === s.layoutId);
    if (!lay) continue;
    for (const [zoneId, pid] of Object.entries(s.zonePlaylists || {})) {
      if (Number(pid) !== Number(playlistId)) continue;
      const z = (lay.zones || []).find((x) => x.id === zoneId);
      if (!z) continue;
      const px = quadroPx(lay, z);
      out.push({ layout: lay, zone: z, px, formato: formatoDe(px), grade: s.name, nome: `${lay.name} · quadro "${z.id}"` });
    }
  }
  return out;
}

/** Todos os quadros de playlist: os dos layouts da empresa e os dos modelos prontos (para o filtro dos Templates). */
export function todosOsQuadros(d) {
  const meus = (d?.layouts || []).flatMap(quadrosDoLayout).map((q) => ({ ...q, key: `l${q.layout.id}:${q.zone.id}`, grupo: 'Layouts da empresa' }));
  const prontos = FACTORY_LAYOUTS.flatMap(quadrosDoLayout).map((q) => ({ ...q, key: `f${q.layout.key}:${q.zone.id}`, grupo: 'Modelos prontos' }));
  return [...meus, ...prontos];
}

/** O formato de uma mídia da biblioteca: slide (o campo orient) ou imagem (largura × altura). */
export function formatoDaMidia(m) {
  if (!m) return null;
  if (m.kind === 'slide') return m.fields?.orient === 'port' ? 'port' : 'land';
  if (m.width && m.height) return formatoDe({ w: m.width, h: m.height });
  return null;
}

/** A mídia combina com o quadro? Quadro quase quadrado aceita os dois formatos. */
export const combina = (fmtMidia, fmtQuadro) => !fmtMidia || fmtQuadro === 'quad' || fmtMidia === fmtQuadro;

export const rotuloZona = (z) => `${z.id} · ${zoneLabel(z.kind)}`;
