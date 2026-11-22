// O player do 5.1 dos vídeos sem a cópia do vídeo (docs/SOM-51.md "Fase 5"), nos testes: o MESMO código do site, do app e
// da TV (public/viewer/vod51-mp4.js: a marca do endereço e a montagem do MPEG-TS) lendo a v.m3u8 do servidor e os trechos por
// Range pelo HTTP, como o hls.js com o fLoader faz. Sem navegador: o FFmpeg lê o resultado.
//   - videoSegments(base, key): os MPEG-TS de todos os segmentos do vídeo, na ordem ([Buffer]).
//   - mountPlayer(app, () => base): /px/hls/_vod51/<chave>/... = a mestre e as playlists do pacote, com os segmentos do vídeo já
//     montados (/px/.../seg/<n>.ts), para o FFmpeg ler o HLS inteiro (o vídeo, o estéreo e a rendição 5.1) como um player.
import '../../public/viewer/vod51-mp4.js';

const NX = global.NexaVod51;

/** Os segmentos de uma playlist de mídia: [{ dur, off, len, uri }]. */
export function segmentsOf(text) {
  const out = []; let dur = null; let range = null;
  for (const line of String(text).split('\n')) {
    let m;
    if ((m = /^#EXTINF:([0-9.]+),/.exec(line))) dur = Number(m[1]);
    else if ((m = /^#EXT-X-BYTERANGE:(\d+)@(\d+)$/.exec(line))) range = { len: Number(m[1]), off: Number(m[2]) };
    else if (line && !line.startsWith('#')) { out.push({ dur, ...(range || {}), uri: line }); dur = null; range = null; }
  }
  return out;
}

/** Um trecho por Range (como o carregador do player): Buffer. */
export async function rangeGet(url, off, len) {
  const r = await fetch(url, { headers: { Range: `bytes=${off}-${off + len - 1}` } });
  if (r.status !== 206) throw new Error(`${url}: HTTP ${r.status} no Range`);
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length !== len) throw new Error(`${url}: ${b.length} bytes de ${len}`);
  return b;
}

/** O MPEG-TS do segmento s (da v.m3u8, endereço já absoluto) montado como o player monta. */
export async function buildSegment(s) {
  const mk = NX.parseMark(s.uri);
  if (!mk) throw new Error(`segmento sem a marca do índice: ${s.uri}`);
  const [table, media] = await Promise.all([rangeGet(mk.table, mk.off, mk.len), rangeGet(mk.media, s.off, s.len)]);
  return Buffer.from(NX.buildTs(table, media));
}

const abs = (base, uri) => new URL(uri, `${base}/`).href;

/** Os MPEG-TS de todos os segmentos do vídeo do pacote (key = "<mídia>-<pacote>"; kind: _vod51, o 5.1, ou _vodbipe, o bipe). */
export async function videoSegments(base, key, kind = '_vod51') {
  const text = await (await fetch(`${base}/hls/${kind}/${key}/v.m3u8`)).text();
  const out = [];
  for (const s of segmentsOf(text)) out.push(await buildSegment({ ...s, uri: abs(base, s.uri) }));
  return out;
}

/** O player como rota (para o FFmpeg ler o HLS inteiro): /px/hls/_vod51/<chave>/{master,v,a,master71,a71}.m3u8 e seg/<n>.ts. */
export function mountPlayer(app, baseOf) {
  const up = async (key, file) => { const r = await fetch(`${baseOf()}/hls/_vod51/${key}/${file}`); return r.ok ? r.text() : null; };
  app.get('/px/hls/_vod51/:key/seg/:n', async (req, res) => {
    try {
      const segs = segmentsOf(await up(req.params.key, 'v.m3u8'));
      const s = segs[parseInt(req.params.n, 10)];
      if (!s) return res.status(404).end();
      res.set('Content-Type', 'video/mp2t').send(await buildSegment({ ...s, uri: abs(baseOf(), s.uri) }));
    } catch (err) { res.status(500).send(String(err.message)); }
  });
  app.get('/px/hls/_vod51/:key/:file', async (req, res) => {
    const text = await up(req.params.key, req.params.file);
    if (text == null) return res.status(404).end();
    if (req.params.file !== 'v.m3u8') return res.set('Content-Type', 'application/vnd.apple.mpegurl').send(text);
    // o vídeo: cada trecho do MP4 (com a marca) vira o segmento já montado
    let n = 0;
    const out = text.split('\n').filter((l) => !l.startsWith('#EXT-X-BYTERANGE:')).map((l) => (l && !l.startsWith('#') ? `seg/${n++}.ts` : l));
    res.set('Content-Type', 'application/vnd.apple.mpegurl').send(out.join('\n'));
  });
}
