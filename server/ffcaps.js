import { execFile } from 'node:child_process';
import { config } from './config.js';

/**
 * Recursos do FFmpeg/ffprobe deste servidor, consultados uma vez por processo, e as opções de entrada seguras para ler
 * mídia de cliente (docs/CONVERSAO.md, "Arquivos grandes").
 *   readsHttps()               o ffprobe lê HTTPS? (o original no R2 é lido por URL assinada, server/storage.js readInput).
 *                              Um build sem TLS faz readInput voltar a baixar o arquivo, se couber acima da reserva do ar.
 *   reconnectOnNetworkError()  o FFmpeg tem -reconnect_on_network_error (4.4+)? Sem ele, uma opção desconhecida derruba o -i.
 */
const once = (bin, args, test) => new Promise((resolve) => {
  if (!bin) return resolve(false);
  execFile(bin, args, { windowsHide: true, timeout: 10_000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => resolve(!err && test(String(stdout || ''))));
});
let https = null;
export function readsHttps() {
  https ||= once(config.ffprobe, ['-hide_banner', '-protocols'], (out) => /^\s*https\s*$/m.test(out.split(/^Output:/m)[0]));
  return https;
}
/** Testes: esquece a resposta guardada (ou força uma). */
export const _setReadsHttps = (v) => { https = v == null ? null : Promise.resolve(Boolean(v)); };

/** A prova do ipc do zmq (server/zmq-endpoint.js): ipc ou tcp para o processo inteiro, com o resultado no log. */
export { zmqMode, probeIpc } from './zmq-endpoint.js';

let zmq = null;
/** O FFmpeg tem os filtros zmq/azmq (comandos a cada quadro por TCP)? O do Debian (contêiner) tem. */
export function hasZmq() {
  zmq ||= once(config.ffmpeg, ['-hide_banner', '-filters'], (out) => /\sazmq\s/.test(out));
  return zmq;
}

let netErr = null;
export function reconnectOnNetworkError() {
  netErr ||= once(config.ffmpeg, ['-hide_banner', '-h', 'protocol=http'], (out) => /reconnect_on_network_error/.test(out));
  return netErr;
}

const isUrl = (p) => /^https?:\/\//i.test(String(p || ''));

/**
 * Opções de entrada quando o original é lido do R2 por URL assinada: reconecta sozinho numa queda (o FFmpeg refaz o pedido
 * com Range a partir de onde parou; até 120 s entre tentativas), também em erro de rede (onNetworkError, se o FFmpeg tiver),
 * e desiste de um pedido parado (rw_timeout, µs) em vez de pendurar a fila. Uma leitura que falha assim mesmo é detectada
 * depois (readFailed / duração): o FFmpeg 5.1 trata o erro no meio como fim do arquivo e sai com 0.
 */
export const httpInputArgs = (input, { onNetworkError = false } = {}) => (isUrl(input)
  ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '120', ...(onNetworkError ? ['-reconnect_on_network_error', '1'] : []), '-rw_timeout', '60000000']
  : []);

/** stderr do FFmpeg com erro de LEITURA da entrada (a saída sai truncada mesmo com código 0). Mora em ffread.js (sem config). */
export { readFailed } from './ffread.js';

/**
 * Demuxers do FFmpeg de cada extensão que o envio aceita. "mov,mp4,m4a,3gp,3g2,mj2" é UM demuxer (MP4, MOV e M4V) e
 * "matroska,webm" outro; a lista do -format_whitelist casa por qualquer um dos nomes.
 */
export const DEMUXERS = {
  '.mp4': 'mov,mp4,m4a,3gp,3g2,mj2', '.m4v': 'mov,mp4,m4a,3gp,3g2,mj2', '.mov': 'mov,mp4,m4a,3gp,3g2,mj2', '.3gp': 'mov,mp4,m4a,3gp,3g2,mj2',
  '.mkv': 'matroska,webm', '.webm': 'matroska,webm',
  '.ts': 'mpegts', '.m2ts': 'mpegts', '.mts': 'mpegts', '.mxf': 'mxf', '.avi': 'avi', '.flv': 'flv', '.mpg': 'mpeg', '.mpeg': 'mpeg', '.vob': 'mpeg', '.wmv': 'asf',
};
// mídia antiga da biblioteca em MPEG-TS (gravações, importações de antes da conversão): o mpegts não abre nada de fora
const LEGACY = ['mpegts'];
/** Demuxers aceitos para mídia de cliente: os das extensões aceitas (config.allowedExt) e o mpegts das mídias antigas. */
export const mediaFormats = (exts = config.allowedExt) => [...new Set([...exts.flatMap((e) => String(DEMUXERS[String(e).toLowerCase()] || '').split(',').filter(Boolean)), ...LEGACY])].join(',');

/**
 * Opções de ENTRADA (antes do -i) para todo FFmpeg/ffprobe que lê mídia enviada por cliente (registro, miniatura,
 * conversão, loudness, legendas, importação):
 *   -format_whitelist   só os demuxers das extensões aceitas. O FFmpeg reconhece o formato pelo CONTEÚDO: um ".mp4" que é
 *                       um manifesto DASH ou uma playlist HLS (ou um concat, um image2) abriria outros arquivos e URLs
 *                       escolhidos por quem enviou (SSRF na rede interna). hls, dash, concat, image2, lavfi, tee ficam fora.
 *   -protocol_whitelist file no arquivo local; por URL (o original no R2), https,tls,tcp. http só com R2_READ_HTTP=1 (o S3
 *                       falso dos testes), nunca decidido pela URL.
 */
export function mediaInputArgs(input, { exts } = {}) {
  const proto = isUrl(input) ? (config.storage.readHttp ? 'https,tls,tcp,http' : 'https,tls,tcp') : 'file';
  return ['-format_whitelist', mediaFormats(exts), '-protocol_whitelist', proto];
}

/**
 * O mesmo para IMAGENS enviadas (logo, marca d'água, selos, figurinhas e o fundo do croma, em DATA_DIR/graphics): só os
 * demuxers de imagem (image2 com o arquivo local, e os _pipe/gif pelo tipo) e só o protocolo file. Usado no graphics.js e
 * oferecido ao motor (engine.js, fundo do croma em imagem).
 */
export const IMAGE_FORMATS = 'image2,png_pipe,jpeg_pipe,webp_pipe,gif,apng'; // apng: um PNG animado é detectado por ele
export const imageInputArgs = () => ['-format_whitelist', IMAGE_FORMATS, '-protocol_whitelist', 'file'];
