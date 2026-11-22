// S3 falso em processo (estilo path: /<bucket>/<chave>), o bastante para o SDK da AWS e para o navegador: PutObject,
// CopyObject, GetObject (com Range), HeadObject, DeleteObject, ListObjectsV2 (prefixo e paginação) e o multipart (Create, UploadPart
// por URL assinada, Complete, Abort, ListParts, ListMultipartUploads; o objeto e o envio guardam `at`, que o teste pode envelhecer),
// com CORS como a política do bucket (AllowedOrigins *, PUT/GET/HEAD, ExposeHeaders ETag). A assinatura NÃO é conferida
// criptograficamente: só a presença do cabeçalho Authorization (SDK) ou dos parâmetros X-Amz-* (URL assinada).
// Uso manual (verificar o painel): node test/helpers/fake-s3.js [porta]  -> R2_ENDPOINT=http://127.0.0.1:<porta>
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const xml = (body) => `<?xml version="1.0" encoding="UTF-8"?>${body}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const md5 = (b) => createHash('md5').update(b).digest('hex');
const PRESIGN = ['X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-Expires', 'X-Amz-SignedHeaders', 'X-Amz-Signature'];

/**
 * cors: false simula um bucket sem política de CORS (o navegador recusa); exposeEtag: false, uma política sem ExposeHeaders;
 * opts.failDelete = true (dá para mudar no meio do teste) faz o DeleteObject responder 503, como o R2 fora do ar;
 * opts.deleteStatus = 403 simula Object Lock/retenção recusando a exclusão.
 * opts.getRate (bytes/s; 0 = sem teto; também dá para mudar no meio do teste): o GET de um objeto sai devagar, como o R2
 * lido de longe, para ver o andamento de quem lê o arquivo inteiro (o preparo de um VOB).
 * opts.truncate ({ "bucket/chave": bytes }, muda no meio do teste): o objeto passa a ter só os primeiros `bytes` (GET e HEAD), como
 * um original que chegou cortado; a conversão lida pela URL tem de recusar o convertido curto.
 * reads: cada GET de objeto { key, start, bytes, signed, at } (bytes = o que foi escrito no socket; com getRate, pedaço a pedaço
 * até quem lê fechar a conexão; signed = pela URL assinada, não pelo SDK).
 */
export function fakeS3({ cors = true, exposeEtag = true, port = 0, failDelete = false, deleteStatus = 0, getRate = 0, truncate = {} } = {}) {
  const objects = new Map(); // "bucket/chave" -> { body, type, etag }
  const uploads = new Map(); // uploadId -> { key, type, parts: Map(n -> { body, etag }) }
  const log = []; // "MÉTODO chave operação"
  const presigned = []; // query das URLs assinadas usadas (para conferir os parâmetros)
  const reads = []; // GET de objetos, com o trecho e os bytes servidos
  const opts = { cors, exposeEtag, failDelete, deleteStatus, getRate, truncate };

  const corsHeaders = (req) => {
    if (!opts.cors || !req.headers.origin) return {};
    return { 'Access-Control-Allow-Origin': '*', ...(opts.exposeEtag ? { 'Access-Control-Expose-Headers': 'ETag' } : {}) };
  };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const key = decodeURIComponent(u.pathname.replace(/^\//, ''));
    const q = u.searchParams;
    const send = (status, headers = {}, body) => { res.writeHead(status, { ...corsHeaders(req), ...headers }); res.end(body); };
    // corpo do GET de um objeto: com opts.getRate, em pedaços a cada 50 ms (o teto é relido a cada pedaço)
    const sendObject = (status, headers, body, read = null) => {
      if (req.method !== 'GET' || !opts.getRate) { if (read && req.method === 'GET') read.bytes += body.length; return send(status, headers, req.method === 'GET' ? body : undefined); }
      res.writeHead(status, { ...corsHeaders(req), ...headers });
      let at = 0;
      const tick = () => {
        if (res.destroyed) return;
        if (at >= body.length) { res.end(); return; }
        const n = opts.getRate ? Math.max(1024, Math.round(opts.getRate / 20)) : body.length;
        const chunk = body.subarray(at, at + n);
        res.write(chunk);
        if (read) read.bytes += chunk.length;
        at += n;
        setTimeout(tick, 50);
      };
      tick();
    };
    const error = (status, code, message = code) => send(status, { 'Content-Type': 'application/xml' }, xml(`<Error><Code>${code}</Code><Message>${esc(message)}</Message></Error>`));

    if (req.method === 'OPTIONS') {
      log.push(`OPTIONS ${key}`);
      if (!opts.cors) return send(403, {}, 'CORS não configurado');
      return send(200, {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'PUT, GET, HEAD',
        'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*', 'Access-Control-Max-Age': '3600',
      });
    }
    const signedQuery = PRESIGN.every((p) => q.has(p));
    if (!req.headers.authorization && !signedQuery) return error(403, 'AccessDenied', 'requisição sem assinatura');
    if (signedQuery) presigned.push(Object.fromEntries(q));

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      // ---------- multipart
      if (req.method === 'POST' && q.has('uploads')) {
        const id = randomUUID().replace(/-/g, '');
        uploads.set(id, { key, type: req.headers['content-type'] || 'application/octet-stream', parts: new Map(), at: Date.now() });
        log.push(`POST ${key} create`);
        const [bucket, ...rest] = key.split('/');
        return send(200, { 'Content-Type': 'application/xml' }, xml(`<InitiateMultipartUploadResult><Bucket>${esc(bucket)}</Bucket><Key>${esc(rest.join('/'))}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`));
      }
      if (req.method === 'PUT' && q.has('uploadId') && q.has('partNumber') && req.headers['x-amz-copy-source']) { // UploadPartCopy
        const up = uploads.get(q.get('uploadId'));
        log.push(`PUT ${key} partcopy ${q.get('partNumber')}`);
        if (!up || up.key !== key) return error(404, 'NoSuchUpload');
        const src = objects.get(decodeURIComponent(String(req.headers['x-amz-copy-source']).replace(/^\//, '')));
        if (!src) return error(404, 'NoSuchKey');
        const m = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers['x-amz-copy-source-range'] || ''));
        const part = m ? src.body.subarray(Number(m[1]), Number(m[2]) + 1) : src.body;
        const etag = `"${md5(part)}"`;
        up.parts.set(Number(q.get('partNumber')), { body: part, etag });
        return send(200, { 'Content-Type': 'application/xml' }, xml(`<CopyPartResult><ETag>${esc(etag)}</ETag><LastModified>${new Date().toISOString()}</LastModified></CopyPartResult>`));
      }
      if (req.method === 'PUT' && q.has('uploadId') && q.has('partNumber')) {
        const up = uploads.get(q.get('uploadId'));
        log.push(`PUT ${key} part ${q.get('partNumber')}${signedQuery ? ' presigned' : ''}`);
        if (!up || up.key !== key) return error(404, 'NoSuchUpload');
        const etag = `"${md5(body)}"`;
        up.parts.set(Number(q.get('partNumber')), { body, etag });
        return send(200, { ETag: etag });
      }
      if (req.method === 'POST' && q.has('uploadId')) {
        const up = uploads.get(q.get('uploadId'));
        log.push(`POST ${key} complete`);
        if (!up || up.key !== key) return error(404, 'NoSuchUpload');
        const parts = [...body.toString('utf8').matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map((m) => ({
          n: Number(/<PartNumber>(\d+)<\/PartNumber>/.exec(m[1])?.[1]), etag: unesc(/<ETag>([\s\S]*?)<\/ETag>/.exec(m[1])?.[1] || ''),
        }));
        if (!parts.length) return error(400, 'MalformedXML');
        for (const [i, p] of parts.entries()) {
          const got = up.parts.get(p.n);
          if (!got || got.etag !== p.etag || (i > 0 && p.n <= parts[i - 1].n)) return error(400, 'InvalidPart', `parte ${p.n}`);
        }
        const all = Buffer.concat(parts.map((p) => up.parts.get(p.n).body));
        const etag = `"${md5(Buffer.concat(parts.map((p) => Buffer.from(up.parts.get(p.n).etag.replace(/"/g, ''), 'hex'))))}-${parts.length}"`;
        objects.set(key, { body: all, type: up.type, etag, at: Date.now() });
        uploads.delete(q.get('uploadId'));
        const [bucket, ...rest] = key.split('/');
        return send(200, { 'Content-Type': 'application/xml' }, xml(`<CompleteMultipartUploadResult><Bucket>${esc(bucket)}</Bucket><Key>${esc(rest.join('/'))}</Key><ETag>${esc(etag)}</ETag></CompleteMultipartUploadResult>`));
      }
      if (req.method === 'GET' && q.has('uploadId')) { // ListParts (sem paginação: os testes têm poucas partes)
        const up = uploads.get(q.get('uploadId'));
        log.push(`GET ${key} listparts`);
        if (!up || up.key !== key) return error(404, 'NoSuchUpload');
        const parts = [...up.parts.entries()].sort((a, b) => a[0] - b[0])
          .map(([n, p]) => `<Part><PartNumber>${n}</PartNumber><LastModified>${new Date().toISOString()}</LastModified><ETag>${esc(p.etag)}</ETag><Size>${p.body.length}</Size></Part>`).join('');
        const [bucket, ...rest] = key.split('/');
        return send(200, { 'Content-Type': 'application/xml' }, xml(`<ListPartsResult><Bucket>${esc(bucket)}</Bucket><Key>${esc(rest.join('/'))}</Key><UploadId>${esc(q.get('uploadId'))}</UploadId><IsTruncated>false</IsTruncated>${parts}</ListPartsResult>`));
      }
      if (req.method === 'DELETE' && q.has('uploadId')) {
        log.push(`DELETE ${key} abort`);
        if (!uploads.delete(q.get('uploadId'))) return error(404, 'NoSuchUpload');
        return send(204);
      }
      // ---------- envios em partes abertos (ListMultipartUploads): GET /<bucket>?uploads (sem paginação: os testes têm poucos)
      if (req.method === 'GET' && q.has('uploads') && !key.replace(/\/$/, '').includes('/')) {
        const bucket = key.replace(/\/$/, '');
        log.push(`GET ${bucket} listuploads`);
        const list = [...uploads.entries()].filter(([, u]) => u.key.startsWith(`${bucket}/`))
          .map(([id, u]) => `<Upload><Key>${esc(u.key.slice(bucket.length + 1))}</Key><UploadId>${id}</UploadId><Initiated>${new Date(u.at || Date.now()).toISOString()}</Initiated><StorageClass>STANDARD</StorageClass></Upload>`).join('');
        return send(200, { 'Content-Type': 'application/xml' }, xml(`<ListMultipartUploadsResult><Bucket>${esc(bucket)}</Bucket><IsTruncated>false</IsTruncated>${list}</ListMultipartUploadsResult>`));
      }
      // ---------- listagem (ListObjectsV2): GET /<bucket>?list-type=2&prefix=…&max-keys=…&continuation-token=…
      if (req.method === 'GET' && q.get('list-type') === '2' && !key.replace(/\/$/, '').includes('/')) {
        const bucket = key.replace(/\/$/, ''); // o SDK pede /<bucket>/?list-type=2
        log.push(`GET ${bucket} list ${q.get('prefix') || ''}`);
        const prefix = q.get('prefix') || '';
        const max = Math.min(1000, Number(q.get('max-keys')) || 1000);
        const all = [...objects.keys()].filter((k) => k.startsWith(`${bucket}/${prefix}`)).sort();
        const from = Number(q.get('continuation-token') || 0);
        const page = all.slice(from, from + max);
        const more = from + max < all.length;
        const contents = page.map((k) => { const o = objects.get(k); return `<Contents><Key>${esc(k.slice(bucket.length + 1))}</Key><LastModified>${new Date(o.at || Date.now()).toISOString()}</LastModified><ETag>${esc(o.etag)}</ETag><Size>${o.body.length}</Size><StorageClass>STANDARD</StorageClass></Contents>`; }).join('');
        return send(200, { 'Content-Type': 'application/xml' }, xml(`<ListBucketResult><Name>${esc(bucket)}</Name><Prefix>${esc(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${max}</MaxKeys><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${from + max}</NextContinuationToken>` : ''}${contents}</ListBucketResult>`));
      }
      // ---------- objetos
      if (req.method === 'PUT' && req.headers['x-amz-copy-source']) {
        const from = decodeURIComponent(String(req.headers['x-amz-copy-source']).replace(/^\//, ''));
        log.push(`COPY ${from} -> ${key}`);
        const o = objects.get(from);
        if (!o) return error(404, 'NoSuchKey');
        objects.set(key, { ...o, at: Date.now() }); // a cópia é um objeto novo (LastModified de agora)
        return send(200, { 'Content-Type': 'application/xml' }, xml(`<CopyObjectResult><ETag>${esc(o.etag)}</ETag><LastModified>${new Date().toISOString()}</LastModified></CopyObjectResult>`));
      }
      if (req.method === 'PUT') {
        log.push(`PUT ${key}`);
        const etag = `"${md5(body)}"`;
        objects.set(key, { body, type: req.headers['content-type'], etag, at: Date.now() });
        return send(200, { ETag: etag });
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        log.push(`${req.method} ${key}`);
        const whole = objects.get(key);
        if (!whole) return req.method === 'HEAD' ? send(404) : error(404, 'NoSuchKey');
        const cut = Number(opts.truncate?.[key]) || 0;
        const o = cut > 0 && cut < whole.body.length ? { ...whole, body: whole.body.subarray(0, cut) } : whole;
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
        const read = req.method === 'GET' ? { key, start: range ? Number(range[1]) : 0, bytes: 0, signed: signedQuery, at: Date.now() } : null;
        if (read) reads.push(read);
        if (range) {
          const start = Number(range[1]);
          const end = Math.min(range[2] ? Number(range[2]) : o.body.length - 1, o.body.length - 1);
          if (start >= o.body.length) return send(416, { 'Content-Range': `bytes */${o.body.length}` });
          const part = o.body.subarray(start, end + 1);
          return sendObject(206, { 'Content-Length': part.length, 'Content-Range': `bytes ${start}-${end}/${o.body.length}`, 'Content-Type': o.type, ETag: o.etag, 'Accept-Ranges': 'bytes' }, part, read);
        }
        return sendObject(200, { 'Content-Length': o.body.length, 'Content-Type': o.type || 'application/octet-stream', ETag: o.etag, 'Accept-Ranges': 'bytes', 'Last-Modified': new Date(o.at || Date.now()).toUTCString() }, o.body, read);
      }
      if (req.method === 'DELETE') {
        log.push(`DELETE ${key}`);
        if (opts.failDelete || opts.deleteStatus) {
          const status = Number(opts.deleteStatus) || 503;
          return error(status, status === 403 ? 'AccessDenied' : 'ServiceUnavailable', 'falha simulada do armazenamento'); // R2 fora do ar/Object Lock
        }
        objects.delete(key); return send(204);
      }
      return error(405, 'MethodNotAllowed');
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const p = server.address().port;
    resolve({
      objects, uploads, log, presigned, reads, opts, port: p, endpoint: `http://127.0.0.1:${p}`,
      close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
    });
  }));
}

/** Variáveis de ambiente para subir o servidor com este S3 como "R2". */
export const r2Env = (s3, bucket = 'nexa') => ({
  STORAGE_DRIVER: 'r2', R2_ENDPOINT: s3.endpoint, R2_BUCKET: bucket, R2_ACCESS_KEY_ID: 'AK-TESTE', R2_SECRET_ACCESS_KEY: 'SK-TESTE', R2_FORCE_PATH_STYLE: '1',
  R2_READ_HTTP: '1', // o S3 falso é http: o FFmpeg só lê http com essa opção explícita (server/ffcaps.js mediaInputArgs)
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s3 = await fakeS3({ port: Number(process.argv[2]) || 9555, cors: process.env.FAKE_S3_CORS !== '0' });
  console.log(`S3 falso em ${s3.endpoint} (CORS ${s3.opts.cors ? 'ligado' : 'DESLIGADO'}). Servidor: ${Object.entries(r2Env(s3)).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  setInterval(() => {}, 1 << 30);
}
