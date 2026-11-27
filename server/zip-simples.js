// DIGITAL ISP · um ZIP simples (sem compressão, "stored"), para os kits de instalação montados na hora pelo servidor:
// o APK já é comprimido, então guardar sem compressão não perde nada e o ZIP abre em qualquer Windows, Mac ou TV.
import zlib from 'node:zlib';

let TABELA = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  if (!TABELA) {
    TABELA = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TABELA[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dataDos(d) {
  const t = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const dt = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  return { t, dt };
}

/** files: [{ name, data: Buffer }] → Buffer do ZIP (nomes em UTF-8). */
export function zipSimples(files, quando = new Date()) {
  const { t, dt } = dataDos(quando);
  const partes = []; const central = []; let off = 0;
  for (const f of files) {
    const nome = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const crc = crc32(data);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(0, 8);
    loc.writeUInt16LE(t, 10); loc.writeUInt16LE(dt, 12); loc.writeUInt32LE(crc, 14);
    loc.writeUInt32LE(data.length, 18); loc.writeUInt32LE(data.length, 22); loc.writeUInt16LE(nome.length, 26); loc.writeUInt16LE(0, 28);
    partes.push(loc, nome, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(t, 12); cen.writeUInt16LE(dt, 14); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nome.length, 28);
    cen.writeUInt32LE(off, 42);
    central.push(cen, nome);
    off += 30 + nome.length + data.length;
  }
  const cd = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(files.length, 8); fim.writeUInt16LE(files.length, 10);
  fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(off, 16);
  return Buffer.concat([...partes, cd, fim]);
}

export { crc32 };
