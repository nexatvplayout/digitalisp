// Monta arquivos .zip byte a byte para os testes do envio de .zip (server/zip-core.js): o comum (Deflate e sem compressão)
// e os casos que nenhum compactador gera de propósito — caminho com "../", link simbólico, senha, tamanho mentiroso (zip-bomb),
// dados sobrepostos, zip64, zip dividido, nome em CP850 e o campo Unicode Path.
import zlib from 'node:zlib';

const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const extra = (id, body) => { const h = Buffer.alloc(4); h.writeUInt16LE(id, 0); h.writeUInt16LE(body.length, 2); return Buffer.concat([h, body]); };

/**
 * entries: [{ name (texto ou Buffer com os bytes brutos), data, method (8 = Deflate, padrão com dados; 0 = sem compressão;
 *   outro número: grava `data` como está), utf8 (marca de UTF-8; padrão: só quando o nome tem acento), encrypted, mode (modo
 *   Unix: 0o120777 = link), madeBy, size/csize/crc (valores MENTIROSOS no índice), zip64 (extra zip64 nesta entrada),
 *   unicodePath (campo 0x7075), offset (aponta o índice para os dados de outra entrada) }]
 * opts: { zip64 (registro zip64 no fim), disks (total de discos no localizador zip64), disk (número do disco no EOCD) }
 */
export function buildZip(entries, { zip64 = false, disks = 1, disk = 0 } = {}) {
  const locals = []; const centrals = []; const offsets = [];
  let pos = 0;
  for (const e of entries) {
    const name = Buffer.isBuffer(e.name) ? e.name : Buffer.from(e.name, 'utf8');
    const data = e.data ?? Buffer.alloc(0);
    const method = e.method ?? (data.length ? 8 : 0);
    const comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = e.crc ?? zlib.crc32(data);
    const size = e.size ?? data.length;
    const csize = e.csize ?? comp.length;
    const utf8 = e.utf8 ?? (!Buffer.isBuffer(e.name) && /[^\x00-\x7f]/.test(e.name));
    const flags = (utf8 ? 0x800 : 0) | (e.encrypted ? 0x1 : 0) | (e.flags ?? 0);
    const big = zip64 || e.zip64;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(big ? 45 : 20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(big ? 0xffffffff : csize, 18); lh.writeUInt32LE(big ? 0xffffffff : size, 22);
    const lx = big ? extra(0x0001, Buffer.concat([u64(size), u64(csize)])) : Buffer.alloc(0);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(lx.length, 28);
    const local = Buffer.concat([lh, name, lx, comp]);
    const at = e.offset != null ? offsets[e.offset] : pos;
    offsets.push(pos);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(e.madeBy ?? 0x031e, 4); ch.writeUInt16LE(big ? 45 : 20, 6);
    ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(big ? 0xffffffff : csize, 20); ch.writeUInt32LE(big ? 0xffffffff : size, 24);
    const cx = Buffer.concat([
      big ? extra(0x0001, Buffer.concat([u64(size), u64(csize), u64(at)])) : Buffer.alloc(0),
      e.unicodePath ? extra(0x7075, Buffer.concat([Buffer.from([1]), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(zlib.crc32(name)); return b; })(), Buffer.from(e.unicodePath, 'utf8')])) : Buffer.alloc(0),
    ]);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(cx.length, 30);
    const mode = e.mode ?? (String(e.name).endsWith('/') ? 0o040755 : 0o100644);
    ch.writeUInt32LE(((mode & 0xffff) << 16) >>> 0, 38);
    ch.writeUInt32LE(big ? 0xffffffff : at, 42);
    if (e.offset == null) { locals.push(local); pos += local.length; } else offsets[offsets.length - 1] = at; // só o índice: reaproveita os dados
    centrals.push(Buffer.concat([ch, name, cx]));
  }
  const cd = Buffer.concat(centrals);
  const n = entries.length;
  const tail = [];
  if (zip64) {
    const z = Buffer.alloc(56);
    z.writeUInt32LE(0x06064b50, 0); z.writeBigUInt64LE(44n, 4); z.writeUInt16LE(45, 12); z.writeUInt16LE(45, 14);
    z.writeBigUInt64LE(BigInt(n), 24); z.writeBigUInt64LE(BigInt(n), 32); z.writeBigUInt64LE(BigInt(cd.length), 40); z.writeBigUInt64LE(BigInt(pos), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0); loc.writeBigUInt64LE(BigInt(pos + cd.length), 8); loc.writeUInt32LE(disks, 16);
    tail.push(z, loc);
  }
  const eo = Buffer.alloc(22);
  eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(disk, 4); eo.writeUInt16LE(disk, 6);
  eo.writeUInt16LE(zip64 ? 0xffff : n, 8); eo.writeUInt16LE(zip64 ? 0xffff : n, 10);
  eo.writeUInt32LE(zip64 ? 0xffffffff : cd.length, 12); eo.writeUInt32LE(zip64 ? 0xffffffff : pos, 16);
  return Buffer.concat([...locals, cd, ...tail, eo]);
}
