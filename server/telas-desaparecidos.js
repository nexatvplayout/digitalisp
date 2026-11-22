/* NEXA Telas · pessoas desaparecidas (docs/TELAS.md; contrato telas-contrato.md §8). A Defesa Civil (ou a SECOM, pelo link
   de controle, ou o Painel da Prefeitura) põe no ar o caso de uma pessoa desaparecida: a foto em tela cheia com os dados, e
   a faixa com a miniatura. O sinal de vida de cada tela leva `missing`: os casos em vigor PARA aquela tela (o mesmo alcance
   dos alertas), no máximo 5.

   Cuidados que valem em tudo aqui:
     - só entra com a autorização marcada (a família ou a autoridade policial autorizou a divulgação) e o número do
       registro de ocorrência; esses campos NUNCA vão ao aparelho nem a rota pública;
     - a foto é conferida pelo conteúdo (não pela extensão), recodificada em JPEG sem metadados (o EXIF pode ter a
       localização), até 1280 px e 600 KB, e guardada com nome sorteado;
     - encerrar (localizado, encerrado ou vencido) tira das telas no próximo sinal de vida e APAGA a foto na hora;
     - na auditoria, só o nome e o número do registro.

   Rotas espelhadas: <base>/missing… (o link: /api/reparticao · o painel: /api/prefeitura). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import { db } from './db.js';
import * as C from './telas-core.js';
import { localDay, cleanDay } from './telas-senha-core.js';
import { MISSING_KIND_KEYS, MISSING_SHOW_KEYS, MISSING_LIMITS as L, MISSING_CONTACT, MISSING_RELATIONS, phoneDigits, scopeHits, INFO_KIND, INFO_HEADERS, INFO_CONTACT, INFO_DAYS_MAX, isExternal } from '../public/shared/telas-tipos.js';

const { fail, line, idOf } = C;
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const num = (v) => (v == null ? null : Number(v));
const RELATION_KEYS = MISSING_RELATIONS.map((r) => r.key);
const CLOSE_BY_HAND = ['localizado', 'encerrado'];
export const PHOTO_RE = /^desap-[0-9a-f-]{36}\.jpg$/;
const PENDING_MS = 30 * 60_000; // a foto enviada espera o caso por até meia hora

/* ------------------------------------------------------------------ o QR code de contato imediato (contrato §11) */
export const QR_LABEL = 'Aponte a câmera e fale agora';
export const QR_KINDS = ['whatsapp', 'tel', 'sms', 'url'];
const digitsOf = (v) => phoneDigits(v); // número do Brasil só com o DDD ganha o 55
/**
 * O conteúdo do QR code, sem exceção um destes: endereço https (válido, sem usuário e senha, até 300), "tel:+" ou "sms:+"
 * com 8 a 15 dígitos. WhatsApp: o número com DDI, só dígitos -> https://wa.me/<número>. Qualquer outra coisa (http,
 * javascript:, data:, intent:, texto solto): 400.
 */
export function cleanQrData({ kind, value }) {
  if (kind === 'whatsapp' || kind === 'tel' || kind === 'sms') {
    const d = digitsOf(value);
    if (!/^\d+$/.test(d)) throw fail(400, 'QR code: o número leva só dígitos, com o código do país (ex.: 5521999990000).');
    if (kind === 'whatsapp') { if (d.length < 10 || d.length > 15) throw fail(400, 'QR code: número de WhatsApp com o código do país e o DDD (10 a 15 dígitos, ex.: 5521999990000).'); return `https://wa.me/${d}`; }
    if (d.length < 8 || d.length > 15) throw fail(400, 'QR code: telefone com o código do país (8 a 15 dígitos, ex.: 5521999990000).');
    return `${kind}:+${d}`;
  }
  if (kind !== 'url') throw fail(400, 'QR code: escolha WhatsApp, telefone, SMS ou um endereço https.');
  const s = String(value ?? '').trim();
  if (!/^https:\/\//i.test(s)) throw fail(400, 'QR code: o endereço precisa começar por https:// (http, javascript:, data: e outros não são aceitos).');
  if (s.length > 300) throw fail(400, 'QR code: endereço longo demais (até 300 caracteres).');
  let u; try { u = new URL(s); } catch { throw fail(400, 'QR code: endereço inválido.'); }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) throw fail(400, 'QR code: endereço https inválido (sem usuário e senha).');
  const out = u.toString();
  if (out.length > 300) throw fail(400, 'QR code: endereço longo demais (até 300 caracteres).');
  return out;
}
/** O que pode ir ao aparelho: só https://, tel:+ e sms:+ (a última conferência antes de mandar). */
export const qrDataOk = (d) => typeof d === 'string' && d.length <= 300 && (/^https:\/\/[^\s]+$/.test(d) || /^(tel|sms):\+\d{8,15}$/.test(d));
/** O destino padrão de uma repartição (ou da prefeitura): { kind, value, label } -> { kind, value, data, label }; null tira. */
export function cleanQrSetting(b) {
  if (b === null || b === undefined || b === '' || (typeof b === 'object' && !b.kind && !b.value)) return null;
  if (typeof b !== 'object' || Array.isArray(b) || !QR_KINDS.includes(b.kind)) throw fail(400, 'QR code: escolha WhatsApp, telefone, SMS ou um endereço https.');
  const data = cleanQrData(b);
  return { kind: b.kind, value: b.kind === 'url' ? data : digitsOf(b.value), data, label: line(b.label, 40) || QR_LABEL };
}
/** O guardado, sem derrubar nada se estiver fora do formato. */
export function qrSettingOf(v) { try { const s = cleanQrSetting(v); return s && qrDataOk(s.data) ? s : null; } catch { return null; } }
/** O QR de um caso: { mode: 'default' | 'off' | 'custom', kind, value, label } -> { mode, data, label }. */
export function cleanCaseQr(q) {
  const mode = q?.mode ?? 'default';
  if (mode === 'off' || mode === 'default') return { mode, data: null, label: null };
  if (mode !== 'custom') throw fail(400, 'QR code do caso: use o padrão, desligue ou escolha outro destino.');
  return { mode, data: cleanQrData(q), label: line(q.label, 40) || QR_LABEL };
}
/** O `qr` do contrato §11 para um caso: o destino só deste caso, senão o da repartição que cadastrou, senão o da prefeitura. */
export function effectiveQr(m, { office = null, tenant = null } = {}) {
  if (m.qr_mode === 'off') return null;
  const q = m.qr_mode === 'custom' ? { data: m.qr_data, label: m.qr_label } : office || tenant;
  return q && qrDataOk(q.data) ? { data: q.data, label: line(q.label, 40) || QR_LABEL } : null;
}

/* ------------------------------------------------------------------ regras sem banco */
const intIn = (v, min, max, def, what) => {
  if (v === undefined || v === null || v === '') return def;
  const n = Math.round(Number(v));
  if (!(n >= min && n <= max)) throw fail(400, `${what}: de ${min} a ${max}.`);
  return n;
};
/**
 * O caso que o painel (ou o link) mandou. cur: o caso guardado (edição: campo ausente fica como está). allowed: os alcances
 * que quem manda pode usar. Sem a autorização marcada, recusa.
 */
export function cleanMissing(b, cur = null, { now = Date.now(), allowed, info = false }) {
  const has = (k) => b?.[k] !== undefined;
  const keep = (k, col, fn) => (has(k) || !cur ? fn(b?.[k]) : cur[col]);
  // a cartela policial (contrato §10, kind "informacao"): só para quem pode (info = a Polícia Civil); as travas ficam em cleanInfoCard
  const isInfo = (cur ? cur.kind : b?.kind) === INFO_KIND;
  if (has('kind') && cur && (b.kind === INFO_KIND) !== (cur.kind === INFO_KIND)) throw fail(400, 'Um caso de desaparecido não vira cartela policial (nem o contrário): cadastre outro.');
  if (isInfo) return cleanInfoCard(b, cur, { now, allowed, info });
  const kind = keep('kind', 'kind', (v) => { const k = v ?? 'adulto'; if (!MISSING_KIND_KEYS.includes(k)) throw fail(400, 'Tipo inválido (criança, adolescente, adulto ou idoso).'); return k; });
  const name = keep('name', 'name', (v) => { const n = line(v, L.name); if (n.length < 2) throw fail(400, 'Escreva o nome da pessoa.'); return n; });
  const age = keep('age', 'age', (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > L.ageMax) throw fail(400, `Idade: de 0 a ${L.ageMax} anos (ou em branco).`); return n; });
  const since = keep('since', 'since', (v) => {
    if (v === null || v === undefined || v === '') return null;
    const d = cleanDay(v);
    if (!d) throw fail(400, 'Desaparecido(a) desde: use uma data (AAAA-MM-DD).');
    if (d > localDay(now).day) throw fail(400, 'Desaparecido(a) desde: a data não pode ser no futuro.');
    return d;
  });
  const reportNo = keep('reportNo', 'report_no', (v) => { const r = line(v, L.report); if (r.length < 3) throw fail(400, 'Informe o número do registro de ocorrência.'); return r; });
  const authName = keep('authName', 'auth_name', (v) => { const r = line(v, L.authName); if (r.length < 2) throw fail(400, 'Informe o nome de quem autorizou a divulgação.'); return r; });
  const authRelation = keep('authRelation', 'auth_relation', (v) => { if (!RELATION_KEYS.includes(v)) throw fail(400, 'Diga quem autorizou a divulgação: um familiar (ou responsável) ou a autoridade policial.'); return v; });
  // a confirmação: obrigatória ao criar; na edição, não pode ser desmarcada
  if (cur ? (has('authOk') && b.authOk !== true) : b?.authOk !== true) throw fail(400, 'Marque a confirmação: a família ou a autoridade policial autorizou a divulgação da foto e dos dados.');
  let until;
  if (has('until') && b.until != null) until = Math.round(Number(b.until));
  else if (has('days') && b.days != null) until = now + Number(b.days) * 86400_000;
  else until = cur ? Number(cur.until_at) : now + L.days * 86400_000;
  if (!Number.isFinite(until) || until <= now + 60_000) throw fail(400, 'Validade: o caso precisa ficar no ar ao menos por alguns minutos.');
  if (until > now + L.daysMax * 86400_000 + 60_000) throw fail(400, `Validade: no máximo ${L.daysMax} dias a partir de agora (dá para renovar depois).`);
  return {
    kind, name, age, since, reportNo, authName, authRelation,
    lastSeen: keep('lastSeen', 'last_seen', (v) => line(v, L.lastSeen)), description: keep('description', 'description', (v) => line(v, L.description)),
    contact: keep('contact', 'contact', (v) => line(v, L.contact) || MISSING_CONTACT),
    show: keep('show', 'show_mode', (v) => { const s = v ?? 'both'; if (!MISSING_SHOW_KEYS.includes(s)) throw fail(400, 'Como mostrar: tela cheia, faixa ou os dois.'); return s; }),
    fullSec: keep('fullSec', 'full_sec', (v) => intIn(v, L.fullSecMin, L.fullSecMax, L.fullSec, 'Segundos em tela cheia')),
    bannerSec: keep('bannerSec', 'banner_sec', (v) => intIn(v, L.bannerSecMin, L.bannerSecMax, L.bannerSec, 'Segundos da faixa')),
    everyMin: keep('everyMin', 'every_min', (v) => intIn(v, L.everyMinMin, L.everyMinMax, L.everyMin, 'A cada quantos minutos')),
    scope: has('scope') || !cur ? C.cleanScope(b?.scope, allowed) : C.scopeFromRow(cur),
    until,
    // o QR code do caso (contrato §11): o padrão de quem emite, desligado ou outro destino só neste caso
    qr: has('qr') || !cur ? cleanCaseQr(b?.qr) : { mode: cur.qr_mode || 'default', data: cur.qr_data || null, label: cur.qr_label || null },
  };
}
/**
 * A cartela policial: "A POLÍCIA PEDE INFORMAÇÕES" ou "PROCURADO PELA JUSTIÇA" (lista fechada). Travas: o número do
 * procedimento (inquérito ou mandado) e a matrícula de quem cadastra são obrigatórios e ficam só no registro; "procurado"
 * exige o número do mandado de prisão e leva na tela, fixo, "Não aborde. Ligue 190 ou 181."; validade de até 15 dias.
 */
export function cleanInfoCard(b, cur = null, { now = Date.now(), allowed, info = false }) {
  if (!info) throw fail(403, 'A cartela policial (pedido de informação) é só da Polícia Civil.');
  const has = (k) => b?.[k] !== undefined;
  const keep = (k, col, fn) => (has(k) || !cur ? fn(b?.[k]) : cur[col]);
  const headKey = has('infoHeader') || !cur ? b?.infoHeader : INFO_HEADERS.find((h) => h.label === cur.header)?.key;
  const head = INFO_HEADERS.find((h) => h.key === headKey);
  if (!head) throw fail(400, 'Cabeçalho da cartela: escolha "A polícia pede informações" ou "Procurado pela Justiça".');
  const reportNo = keep('reportNo', 'report_no', (v) => { const r = line(v, L.report); if (r.length < 3) throw fail(400, 'Informe o número do procedimento (inquérito ou mandado).'); return r; });
  const authName = keep('authName', 'auth_name', (v) => { const r = line(v, L.authName); if (r.length < 3) throw fail(400, 'Informe a sua identificação funcional (matrícula).'); return r; });
  const warrantNo = keep('warrantNo', 'warrant_no', (v) => line(v, L.report) || null);
  if (head.warrant && !warrantNo) throw fail(400, '"Procurado pela Justiça" exige o número do mandado de prisão.');
  // a frase fixa de segurança ("Não aborde. Ligue 190 ou 181.") abre a descrição, sem edição: o que vier com ela (ou no lugar dela) é o resto do texto
  const strip = (v) => INFO_HEADERS.reduce((s, h) => (h.fixed ? s.split(h.fixed).join(' ') : s), String(v ?? ''));
  const text = line(strip(has('description') || !cur ? b?.description : cur.description), L.description - (head.fixed ? head.fixed.length + 1 : 0));
  let until;
  if (has('until') && b.until != null) until = Math.round(Number(b.until));
  else if (has('days') && b.days != null) until = now + Number(b.days) * 86400_000;
  else until = cur ? Number(cur.until_at) : now + L.days * 86400_000;
  if (!Number.isFinite(until) || until <= now + 60_000) throw fail(400, 'Validade: a cartela precisa ficar no ar ao menos por alguns minutos.');
  if (until > now + INFO_DAYS_MAX * 86400_000 + 60_000) throw fail(400, `Validade: a cartela policial fica no máximo ${INFO_DAYS_MAX} dias.`);
  return {
    kind: INFO_KIND, header: head.label, name: keep('name', 'name', (v) => line(v, L.name)), age: null, since: null, reportNo, authName, authRelation: 'autoridade', warrantNo: head.warrant ? warrantNo : null,
    lastSeen: '', description: head.fixed ? `${head.fixed}${text ? ` ${text}` : ''}` : text, contact: keep('contact', 'contact', (v) => line(v, L.contact) || INFO_CONTACT),
    show: keep('show', 'show_mode', (v) => { const x = v ?? 'both'; if (!MISSING_SHOW_KEYS.includes(x)) throw fail(400, 'Como mostrar: tela cheia, faixa ou os dois.'); return x; }),
    fullSec: keep('fullSec', 'full_sec', (v) => intIn(v, L.fullSecMin, L.fullSecMax, L.fullSec, 'Segundos em tela cheia')),
    bannerSec: keep('bannerSec', 'banner_sec', (v) => intIn(v, L.bannerSecMin, L.bannerSecMax, L.bannerSec, 'Segundos da faixa')),
    everyMin: keep('everyMin', 'every_min', (v) => intIn(v, L.everyMinMin, L.everyMinMax, L.everyMin, 'A cada quantos minutos')),
    scope: has('scope') || !cur ? C.cleanScope(b?.scope, allowed) : C.scopeFromRow(cur),
    until,
    qr: has('qr') || !cur ? cleanCaseQr(b?.qr) : { mode: cur.qr_mode || 'default', data: cur.qr_data || null, label: cur.qr_label || null },
  };
}
/**
 * O item do contrato §8.1 (o que vai ao aparelho): só o que aparece na tela. Nada da autorização. A foto só vai com
 * endereço https, o SHA-256 e o tamanho dentro do que o app aceita (1 a 1.048.576); senão null (o app desenha a silhueta).
 * qr (§11): só quando ligado e válido.
 */
export const missingContract = (m, photoUrl, qr = null) => ({
  // a cartela sem nome leva o cabeçalho como nome (o app ignora o caso sem nome); `header` (§10) só quando há
  id: Number(m.id), kind: m.kind, name: m.name || (m.kind === INFO_KIND ? 'Pedido de informação' : ''), age: num(m.age), since: m.since || null, lastSeen: m.last_seen || '', description: m.description || '', contact: m.contact || MISSING_CONTACT,
  ...(m.header ? { header: line(m.header, 40) } : {}),
  photo: m.photo_file && /^[0-9a-f]{64}$/.test(m.photo_sha || '') && /^https:\/\//.test(photoUrl || '') && Number(m.photo_bytes) >= 1 && Number(m.photo_bytes) <= 1048576 ? { url: photoUrl, sha256: m.photo_sha, bytes: Number(m.photo_bytes) } : null,
  show: m.show_mode, fullSec: Number(m.full_sec), bannerSec: Number(m.banner_sec), everyMin: Number(m.every_min), until: Number(m.until_at),
  ...(qr && qrDataOk(qr.data) ? { qr: { data: qr.data, label: qr.label } } : {}),
});

/** Tipo real da imagem pelos primeiros bytes (a extensão e o Content-Type do envio não valem nada). */
export function sniffImage(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.readUInt32BE(0) === 0x89504e47) return 'png';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}
const PIPE = { jpg: 'jpeg_pipe', png: 'png_pipe', webp: 'webp_pipe' };
const FFMPEG_MS = 20_000;
const MAX_PIXELS = 4096 * 4096;
/**
 * Um JPEG sem metadados, até `side` px no lado maior, na qualidade q (2 = melhor … 31 = menor). vf troca o filtro de
 * tamanho (a imagem de reserva das telas, server/telas-imagem-offline.js, sai em 1920×1080 cobrindo o quadro).
 */
export function encodeJpeg(ffmpeg, input, output, kind, side, q, vf = null) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-nostats', '-v', 'error', '-y', '-filter_threads', '1', '-max_pixels', String(MAX_PIXELS), '-threads', '1', '-f', PIPE[kind], '-i', input, '-frames:v', '1',
      '-vf', vf || `scale='min(${side},iw)':'min(${side},ih)':force_original_aspect_ratio=decrease,format=yuvj420p`,
      '-map_metadata', '-1', '-threads', '1', '-q:v', String(q), '-f', 'image2', '-c:v', 'mjpeg', output], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-600); });
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* já saiu */ } }, FFMPEG_MS);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); if (code === 0) resolve(); else reject(new Error(err.trim().split('\n').pop() || `ffmpeg saiu com ${code}`)); });
  });
}
/**
 * A foto enviada vira o JPEG que vai às telas: sem metadados, lado maior até 1280 px e até 600 KB (baixa a qualidade e,
 * no fim, o tamanho até caber). Devolve o conteúdo pronto. Arquivo que não é imagem: 400.
 */
export async function preparePhoto(buf, { ffmpeg, checkImage = null }) {
  const kind = sniffImage(buf);
  if (!kind) throw fail(400, 'Use uma foto JPEG, PNG ou WebP.');
  if (buf.length > L.uploadBytes) throw fail(413, 'A foto passa de 5 MB. Escolha outra.');
  if (checkImage) { try { checkImage(buf); } catch { throw fail(400, 'Foto grande demais (até 16 megapixels) ou num formato que não dá para conferir.'); } }
  if (!ffmpeg) throw fail(503, 'O servidor está sem o FFmpeg para preparar a foto.');
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nexa-desap-'));
  try {
    const input = path.join(dir, 'in'); const output = path.join(dir, 'out.jpg');
    await fs.promises.writeFile(input, buf);
    for (const [side, q] of [[L.photoSide, 3], [L.photoSide, 6], [L.photoSide, 10], [L.photoSide, 16], [960, 16], [720, 20], [540, 26]]) {
      try { await encodeJpeg(ffmpeg, input, output, kind, side, q); } catch { throw fail(400, 'Não foi possível ler esta foto. Tente outra.'); }
      const out = await fs.promises.readFile(output);
      if (out.length > 0 && out.length <= L.photoBytes) return out;
    }
    throw fail(400, 'Não foi possível preparar esta foto dentro do tamanho das telas. Tente outra.');
  } finally { await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

/**
 * deps: cached(key, fn) e forget(tenantId) (as leituras guardadas de server/telas.js), preview(tenantId, alcance) e
 * assertScope(tenantId, alcance) (o alcance dos alertas), audit, now e photos: { dir, ffmpeg, checkImage(buf),
 * put(nome), remove(nome), url(nome, req) -> endereço público, read(nome) -> Buffer, list?() -> [{ name, mtime }] }.
 */
export function createDesaparecidos({ cached, forget, preview, assertScope, photos, tenantQr = { get: async () => null, set: async () => {} }, requestApproval = null, issuerDirect = async () => false, now = () => Date.now(), timers = true }) {
  const pending = new Map(); // foto enviada à espera do caso: nome -> { tenantId, sha, bytes, at }
  const fileOf = (name) => path.join(photos.dir, name);
  async function dropFile(name) {
    if (!name || !PHOTO_RE.test(name)) return;
    try { await photos.remove(name); } catch (err) { console.warn(`[telas] foto de caso encerrado não saiu do armazenamento (${String(err?.message || err).slice(0, 120)})`); }
    await fs.promises.rm(fileOf(name), { force: true }).catch(() => {});
  }
  function sweepPending(t = now()) { for (const [name, p] of pending) if (t - p.at > PENDING_MS) { pending.delete(name); dropFile(name); } }
  /** Recebe a foto, prepara e guarda com nome sorteado; devolve o nome (vale por meia hora, só para este cliente). */
  async function storePhoto(tenantId, buf) {
    sweepPending();
    if (pending.size > 200) throw fail(429, 'Muitas fotos à espera. Aguarde alguns minutos.');
    const out = await preparePhoto(buf, photos);
    const name = `desap-${randomUUID()}.jpg`;
    await fs.promises.mkdir(photos.dir, { recursive: true });
    await fs.promises.writeFile(fileOf(name), out);
    try { await photos.put(name); } catch (err) { await fs.promises.rm(fileOf(name), { force: true }).catch(() => {}); throw fail(502, 'Não foi possível guardar a foto agora. Tente de novo.'); }
    pending.set(name, { tenantId: Number(tenantId), sha: createHash('sha256').update(out).digest('hex'), bytes: out.length, at: now() });
    return { photo: name, bytes: out.length };
  }
  /** A foto enviada por ESTE cliente, pronta para entrar num caso (sai da espera). */
  function takePhoto(tenantId, name) {
    const p = typeof name === 'string' && PHOTO_RE.test(name) ? pending.get(name) : null;
    if (!p || p.tenantId !== Number(tenantId)) throw fail(400, 'A foto enviada não foi encontrada (ou venceu). Envie de novo.');
    pending.delete(name);
    return { file: name, sha: p.sha, bytes: p.bytes };
  }

  const activeRows = (tenantId) => cached(`mis:${tenantId}`, () => db.all("SELECT * FROM telas_missing WHERE tenant_id = ? AND status = 'active' ORDER BY id DESC", [tenantId]));
  /* ---- o QR code de contato imediato (§11): o destino padrão de cada repartição emissora (telas_office_extras.data.qr) e
     o da prefeitura (no padrão da prefeitura), que vale para a repartição que não definiu o dela */
  const qrSettings = (tenantId) => cached(`mqr:${tenantId}`, async () => {
    const rows = await db.all('SELECT office_id, data FROM telas_office_extras WHERE tenant_id = ?', [tenantId]);
    const byOffice = new Map();
    for (const r of rows) { const s = qrSettingOf(C.parseJson(r.data, {}).qr); if (s) byOffice.set(Number(r.office_id), s); }
    return { byOffice, tenant: qrSettingOf(await tenantQr.get(tenantId)) };
  });
  const qrOf = (m, q) => effectiveQr(m, { office: m.office_id != null ? q.byOffice.get(Number(m.office_id)) || null : null, tenant: q.tenant });
  async function setOfficeQr(tenantId, officeId, setting) {
    const cur = await db.get('SELECT data FROM telas_office_extras WHERE office_id = ? AND tenant_id = ?', [officeId, tenantId]);
    const data = C.parseJson(cur?.data, {});
    if (setting) data.qr = { kind: setting.kind, value: setting.value, label: setting.label }; else delete data.qr;
    if (cur) await db.run('UPDATE telas_office_extras SET data = ?, updated_at = ? WHERE office_id = ? AND tenant_id = ?', [JSON.stringify(data), now(), officeId, tenantId]);
    else await db.run('INSERT INTO telas_office_extras(office_id,tenant_id,data,updated_at) VALUES(?,?,?,?)', [officeId, tenantId, JSON.stringify(data), now()]);
  }
  /** `missing` do sinal de vida: os casos em vigor PARA esta tela, do mais novo para o mais antigo, no máximo 5. */
  async function forDevice(tenantId, me, req) {
    const t = now();
    const rows = (await activeRows(tenantId)).filter((m) => Number(m.until_at) > t && scopeHits(C.scopeFromRow(m), me)).slice(0, L.active);
    if (!rows.length) return [];
    const q = await qrSettings(tenantId);
    return rows.map((m) => missingContract(m, m.photo_file ? photos.url(m.photo_file, req) : null, qrOf(m, q)));
  }
  /** O que o operador vê (com a autorização; sem o nome do arquivo). */
  const dto = (m, reach = null, qr = undefined) => ({
    id: Number(m.id), officeId: num(m.office_id), kind: m.kind, name: m.name, age: num(m.age), since: m.since || null, lastSeen: m.last_seen || '', description: m.description || '', contact: m.contact || '',
    hasPhoto: Boolean(m.photo_file), show: m.show_mode, fullSec: Number(m.full_sec), bannerSec: Number(m.banner_sec), everyMin: Number(m.every_min), scope: C.scopeFromRow(m), until: Number(m.until_at),
    header: m.header || null, warrantNo: m.warrant_no || null,
    status: m.status, closeReason: m.close_reason || null, reportNo: m.report_no, authName: m.auth_name, authRelation: m.auth_relation,
    createdBy: m.created_by || '', createdAt: Number(m.created_at), closedBy: m.closed_by || null, closedAt: num(m.closed_at), ...(reach ? { reach } : {}),
    qr: { mode: m.qr_mode || 'default', data: m.qr_mode === 'custom' ? m.qr_data : null, label: m.qr_mode === 'custom' ? m.qr_label : null }, ...(qr !== undefined ? { qrShown: qr } : {}),
  });
  const about = (m) => `"${m.name}" (registro ${m.report_no || m.reportNo})`;

  /** Encerra: sai das telas no próximo sinal de vida e a foto é apagada do armazenamento na hora. */
  async function closeCase(tenantId, m, reason, by) {
    const t = now();
    const r = await db.run("UPDATE telas_missing SET status = 'closed', close_reason = ?, closed_by = ?, closed_at = ?, photo_file = NULL, photo_sha = NULL, photo_bytes = 0, updated_at = ? WHERE id = ? AND tenant_id = ? AND status = 'active'",
      [reason, line(by, 64), t, t, m.id, tenantId]);
    forget(tenantId);
    if (r.changes === 1) await dropFile(m.photo_file);
    return r.changes === 1;
  }
  /** Os casos que passaram da validade: encerrados com o motivo "vencido" (e a foto apagada). */
  async function expire(t = now(), tenantId = null) {
    // o que esperava a aprovação e venceu sai junto (o pedido fica sem efeito)
    for (const p of await db.all(`SELECT id, tenant_id, photo_file FROM telas_missing WHERE status = 'pending' AND until_at <= ?${tenantId == null ? '' : ' AND tenant_id = ?'}`, tenantId == null ? [t] : [t, tenantId])) {
      await db.run("UPDATE telas_missing SET status = 'closed', close_reason = 'vencido', closed_by = 'sistema', closed_at = ?, photo_file = NULL, photo_sha = NULL, photo_bytes = 0 WHERE id = ? AND status = 'pending'", [t, p.id]);
      await db.run("UPDATE telas_approvals SET status = 'superseded', decided_at = ? WHERE tenant_id = ? AND kind = 'missing' AND ref_id = ? AND status = 'pending'", [t, p.tenant_id, p.id]);
      await dropFile(p.photo_file);
    }
    const rows = await db.all(`SELECT * FROM telas_missing WHERE status = 'active' AND until_at <= ?${tenantId == null ? '' : ' AND tenant_id = ?'}`, tenantId == null ? [t] : [t, tenantId]);
    for (const m of rows) await closeCase(Number(m.tenant_id), m, 'vencido', 'sistema');
    return rows.length;
  }
  const own = async (tenantId, id) => {
    const m = await db.get('SELECT * FROM telas_missing WHERE id = ? AND tenant_id = ?', [idOf(id, 'Caso'), tenantId]);
    if (!m) throw fail(404, 'Caso não encontrado.');
    return m;
  };

  /**
   * As operações, montadas no link e no painel. reg(method, sub, fn, { raw }): fn({ tenantId, officeId, allowed, fixScope,
   * by, body, params, req }) -> { status?, body, log? } ou { photo: Buffer }.
   */
  function operations(reg) {
    reg('get', '', async ({ tenantId, officeId, office }) => {
      await expire(now(), tenantId);
      const t = now(); const q = await qrSettings(tenantId);
      // o emissor conveniado (órgão de fora) só vê os próprios envios
      const mine = office && isExternal(office.type) ? ' AND office_id = ?' : '';
      const rows = await db.all(`SELECT * FROM telas_missing WHERE tenant_id = ? AND (status IN ('active','pending') OR closed_at > ?)${mine} ORDER BY id DESC LIMIT 200`, [tenantId, t - L.keepDays * 86400_000, ...(mine ? [officeId] : [])]);
      const active = [];
      for (const m of rows.filter((x) => x.status === 'active')) active.push(dto(m, await preview(tenantId, C.scopeFromRow(m)), qrOf(m, q)));
      // o QR code de contato imediato: o destino de quem está nesta tela (a repartição, ou a prefeitura no painel) e o herdado
      const own = officeId != null ? q.byOffice.get(Number(officeId)) || null : q.tenant;
      return { body: { serverTime: t, limits: L, active, pending: rows.filter((x) => x.status === 'pending').map((m) => dto(m)), closed: rows.filter((x) => x.status !== 'active' && x.status !== 'pending').map((m) => dto(m)), qr: { own, inherited: officeId != null ? q.tenant : null, label: QR_LABEL } } };
    });
    // o destino padrão do QR code: no link, o da repartição; no painel, o da prefeitura (vale para quem não definiu o seu)
    reg('put', '/qr', async ({ tenantId, officeId, body }) => {
      const setting = cleanQrSetting(body?.qr === undefined ? body : body.qr);
      if (officeId != null) await setOfficeQr(tenantId, officeId, setting); else await tenantQr.set(tenantId, setting ? { kind: setting.kind, value: setting.value, label: setting.label } : null);
      forget(tenantId);
      return { body: { qr: setting }, log: `prefeitura: QR code de contato dos casos de pessoa desaparecida ${setting ? `definido (${setting.kind})` : 'tirado'}${officeId != null ? '' : ' no padrão da prefeitura'}` };
    });
    reg('post', '/photo', async ({ tenantId, req }) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw fail(415, 'Envie a foto como imagem (JPEG, PNG ou WebP).');
      return { status: 201, body: await storePhoto(tenantId, req.body) };
    }, { raw: true });
    reg('post', '', async ({ tenantId, officeId, office, allowed, fixScope, by, body }) => {
      const c = cleanMissing({ ...body, scope: fixScope(body.scope) }, null, { now: now(), allowed, info: office?.type === 'policia-civil' });
      await assertScope(tenantId, c.scope);
      await expire(now(), tenantId);
      // o teto de 5 conta os casos no ar e os que esperam a aprovação (desaparecidos e cartelas, juntos)
      if (Number((await db.get("SELECT COUNT(*) AS n FROM telas_missing WHERE tenant_id = ? AND status IN ('active','pending')", [tenantId])).n) >= L.active) throw fail(409, `Já há ${L.active} casos no ar, que é o máximo. Encerre um caso antes de cadastrar outro.`);
      // o emissor conveniado espera o CCO (a não ser que a prefeitura o tenha liberado); a cartela policial espera SEMPRE
      const waits = Boolean(office && isExternal(office.type) && requestApproval && (c.kind === INFO_KIND || !(await issuerDirect(tenantId, officeId))));
      const ph = body.photo ? takePhoto(tenantId, body.photo) : { file: null, sha: null, bytes: 0 };
      const { scope, scope_data } = C.scopeToRow(c.scope);
      const t = now();
      const id = await db.insert(`INSERT INTO telas_missing(tenant_id,office_id,kind,name,age,since,last_seen,description,contact,photo_file,photo_sha,photo_bytes,show_mode,full_sec,banner_sec,every_min,scope,scope_data,until_at,status,report_no,auth_name,auth_relation,auth_ok,created_by,created_at,qr_mode,qr_data,qr_label,header,warrant_no)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [tenantId, officeId, c.kind, c.name, c.age, c.since, c.lastSeen, c.description, c.contact, ph.file, ph.sha, ph.bytes, c.show, c.fullSec, c.bannerSec, c.everyMin, scope, scope_data, c.until, waits ? 'pending' : 'active', c.reportNo, c.authName, c.authRelation, 1, line(by, 64), t, c.qr.mode, c.qr.data, c.qr.label, c.header || null, c.warrantNo || null]);
      forget(tenantId);
      const row = await db.get('SELECT * FROM telas_missing WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      const reach = await preview(tenantId, c.scope);
      const what = c.kind === INFO_KIND ? `cartela policial "${c.header}" (procedimento ${c.reportNo})` : `pessoa desaparecida ${about(c)}`;
      if (waits) {
        const p = await requestApproval(tenantId, officeId, { kind: 'missing', refId: Number(id), payload: { kind: c.kind, header: c.header || null, name: c.name, age: c.age, since: c.since, lastSeen: c.lastSeen, description: c.description, contact: c.contact, hasPhoto: Boolean(ph.file), scope: c.scope, until: c.until }, cls: 'emergencia', summary: `${c.kind === INFO_KIND ? `cartela "${c.header}"` : 'pessoa desaparecida'}${c.name ? `: ${c.name}` : ''}`, by });
        return { status: 202, body: { ...dto(row, reach), pending: true, approval: p }, log: `prefeitura: ${what} enviada para a aprovação do CCO (pedido #${p.id})` };
      }
      if (c.kind === INFO_KIND) return { status: 201, body: dto(row, reach, qrOf(row, await qrSettings(tenantId))), log: `prefeitura: ${what} no ar: ${reach.total} tela(s)` };
      return { status: 201, body: dto(row, reach, qrOf(row, await qrSettings(tenantId))), log: `prefeitura: pessoa desaparecida ${about(c)} no ar: ${reach.total} tela(s)${ph.file ? ', com foto' : ', sem foto'}` };
    });
    reg('patch', '/:mid', async ({ tenantId, officeId, office, allowed, fixScope, body, params }) => {
      const cur = await own(tenantId, params.mid);
      if (cur.status !== 'active') throw fail(409, 'Este caso já foi encerrado.');
      const c = cleanMissing(body.scope !== undefined ? { ...body, scope: fixScope(body.scope) } : body, cur, { now: now(), allowed, info: office?.type === 'policia-civil' });
      if (office && isExternal(office.type) && Number(cur.office_id) !== Number(officeId)) throw fail(404, 'Caso não encontrado.');
      await assertScope(tenantId, c.scope);
      const ph = body.photo ? takePhoto(tenantId, body.photo) : null;
      const { scope, scope_data } = C.scopeToRow(c.scope);
      await db.run(`UPDATE telas_missing SET kind = ?, name = ?, age = ?, since = ?, last_seen = ?, description = ?, contact = ?, show_mode = ?, full_sec = ?, banner_sec = ?, every_min = ?, scope = ?, scope_data = ?, until_at = ?,
        report_no = ?, auth_name = ?, auth_relation = ?, qr_mode = ?, qr_data = ?, qr_label = ?, header = ?, warrant_no = ?, updated_at = ?${ph ? ', photo_file = ?, photo_sha = ?, photo_bytes = ?' : ''} WHERE id = ? AND tenant_id = ? AND status = 'active'`,
      [c.kind, c.name, c.age, c.since, c.lastSeen, c.description, c.contact, c.show, c.fullSec, c.bannerSec, c.everyMin, scope, scope_data, c.until, c.reportNo, c.authName, c.authRelation, c.qr.mode, c.qr.data, c.qr.label, c.header || null, c.warrantNo || null, now(), ...(ph ? [ph.file, ph.sha, ph.bytes] : []), cur.id, tenantId]);
      forget(tenantId);
      if (ph) await dropFile(cur.photo_file); // a foto de antes sai do armazenamento
      const row = await db.get('SELECT * FROM telas_missing WHERE id = ? AND tenant_id = ?', [cur.id, tenantId]);
      return { body: dto(row, await preview(tenantId, c.scope), qrOf(row, await qrSettings(tenantId))), log: `prefeitura: caso de pessoa desaparecida ${about(c)} alterado${ph ? ' (foto trocada)' : ''}` };
    });
    reg('post', '/:mid/close', async ({ tenantId, officeId, office, by, body, params }) => {
      const cur = await own(tenantId, params.mid);
      if (office && isExternal(office.type) && Number(cur.office_id) !== Number(officeId)) throw fail(404, 'Caso não encontrado.');
      if (cur.status === 'pending') { // desistir do que ainda esperava a aprovação
        await db.run("UPDATE telas_missing SET status = 'closed', close_reason = 'encerrado', closed_by = ?, closed_at = ?, photo_file = NULL, photo_sha = NULL, photo_bytes = 0 WHERE id = ? AND tenant_id = ? AND status = 'pending'", [line(by, 64), now(), cur.id, tenantId]);
        await db.run("UPDATE telas_approvals SET status = 'superseded', decided_at = ? WHERE tenant_id = ? AND kind = 'missing' AND ref_id = ? AND status = 'pending'", [now(), tenantId, cur.id]);
        await dropFile(cur.photo_file); forget(tenantId);
        return { body: { ok: true, reason: 'encerrado' }, log: `prefeitura: caso ${about(cur)} retirado antes da aprovação; a foto foi apagada` };
      }
      const reason = body.reason ?? 'encerrado';
      if (!CLOSE_BY_HAND.includes(reason)) throw fail(400, 'Motivo inválido (localizado ou encerrado).');
      if (cur.status !== 'active' || !(await closeCase(tenantId, cur, reason, by))) throw fail(409, 'Este caso já foi encerrado.');
      return { body: { ok: true, reason }, log: `prefeitura: caso de pessoa desaparecida ${about(cur)} encerrado (${reason === 'localizado' ? 'pessoa localizada' : 'encerrado'}); a foto foi apagada` };
    });
    reg('get', '/:mid/photo', async ({ tenantId, officeId, office, params }) => {
      const cur = await own(tenantId, params.mid);
      if (office && isExternal(office.type) && Number(cur.office_id) !== Number(officeId)) throw fail(404, 'Caso não encontrado.');
      if (!cur.photo_file) throw fail(404, 'Este caso não tem foto.');
      let buf; try { buf = await photos.read(cur.photo_file); } catch { throw fail(404, 'A foto não está disponível agora.'); }
      return { photo: buf };
    });
  }
  /** Monta as operações num prefixo. guard: os middlewares; ctx(req) -> { tenantId, officeId, allowed, fixScope, by }; done(req, res, out). */
  function mount(app, base, guard, ctx, done) {
    const rawBody = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: L.uploadBytes });
    const tooBig = (err, _req, res, next) => (err?.type === 'entity.too.large' ? res.status(413).json({ error: 'A foto passa de 5 MB. Escolha outra.' }) : next(err));
    operations((method, sub, fn, { raw = false } = {}) => app[method](`${base}/missing${sub}`, guard, ...(raw ? [rawBody, tooBig] : []), ah(async (req, res) => {
      const out = await fn({ ...ctx(req), body: raw ? null : req.body || {}, params: req.params, req });
      if (out.photo) return res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' }).send(out.photo);
      await done(req, res, out, `${method.toUpperCase()} ${base}/missing${sub.replace(/:\w+/g, '*')}`);
      return res.set('Cache-Control', 'no-store').status(out.status || 200).json(out.body);
    })));
  }

  /** O CCO aprovou: o caso que esperava entra no ar (se ainda couber no teto e no prazo). */
  async function activate(tenantId, id) {
    const m = await db.get("SELECT * FROM telas_missing WHERE id = ? AND tenant_id = ? AND status = 'pending'", [id, tenantId]);
    if (!m) throw fail(409, 'O caso deste pedido não espera mais a aprovação. Devolva o pedido.');
    if (Number(m.until_at) <= now()) throw fail(409, 'A validade deste caso já passou. Devolva o pedido.');
    if (Number((await db.get("SELECT COUNT(*) AS n FROM telas_missing WHERE tenant_id = ? AND status = 'active'", [tenantId])).n) >= L.active) throw fail(409, `Já há ${L.active} casos no ar, que é o máximo. Encerre um caso antes de aprovar este.`);
    await db.run("UPDATE telas_missing SET status = 'active', updated_at = ? WHERE id = ? AND tenant_id = ? AND status = 'pending'", [now(), id, tenantId]);
    forget(tenantId);
    return { id };
  }
  /** O CCO devolveu: o registro fica como devolvido e a foto é apagada. */
  async function reject(tenantId, id, by) {
    const m = await db.get("SELECT * FROM telas_missing WHERE id = ? AND tenant_id = ? AND status = 'pending'", [id, tenantId]);
    if (!m) return;
    await db.run("UPDATE telas_missing SET status = 'rejected', close_reason = 'devolvido', closed_by = ?, closed_at = ?, photo_file = NULL, photo_sha = NULL, photo_bytes = 0 WHERE id = ? AND tenant_id = ?", [line(by, 64), now(), id, tenantId]);
    await dropFile(m.photo_file); forget(tenantId);
  }
  /** Limpeza: os vencidos, os encerrados há mais de 90 dias, as fotos à espera que venceram e as que ninguém cita. */
  async function prune(t = now()) {
    await expire(t);
    await db.run("DELETE FROM telas_missing WHERE status <> 'active' AND closed_at < ?", [t - L.keepDays * 86400_000]);
    sweepPending(t);
    if (!photos.list) return;
    try {
      const used = new Set((await db.all('SELECT photo_file FROM telas_missing WHERE photo_file IS NOT NULL')).map((r) => r.photo_file));
      for (const f of await photos.list()) if (PHOTO_RE.test(f.name) && !used.has(f.name) && !pending.has(f.name) && (!f.mtime || t - f.mtime > 2 * PENDING_MS)) await dropFile(f.name);
    } catch { /* a listagem falhou: fica para a próxima volta */ }
  }
  /** O cliente foi excluído: as fotos dele saem do armazenamento (as linhas, quem apaga é a exclusão do cliente). */
  async function dropTenant(tenantId) {
    for (const m of await db.all('SELECT photo_file FROM telas_missing WHERE tenant_id = ? AND photo_file IS NOT NULL', [tenantId])) await dropFile(m.photo_file);
  }
  const minute = timers ? setInterval(() => { expire().catch((err) => console.warn('[telas] desaparecidos:', err.message)); sweepPending(); }, 60_000) : null;
  minute?.unref?.();
  return { mount, forDevice, expire, prune, closeCase, dropTenant, storePhoto, activate, reject, stop() { clearInterval(minute); } };
}
