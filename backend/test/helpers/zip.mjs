import zlib from 'node:zlib';

const crc32 = (buf) => { let c, crc = 0xffffffff; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; };

/** Minimal zip writer for tests: entries = [{ name, data, deflate?: false, claimSize? }]. Returns base64. */
export function zip(entries) {
    const locals = []; const centrals = []; let offset = 0;
    for (const e of entries) {
        const raw = Buffer.from(e.data); const body = e.deflate === false ? raw : zlib.deflateRawSync(raw); const name = Buffer.from(e.name);
        const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(e.deflate === false ? 0 : 8, 8); lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(e.claimSize ?? raw.length, 22); lh.writeUInt16LE(name.length, 26);
        const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(e.deflate === false ? 0 : 8, 10); ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(e.claimSize ?? raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
        locals.push(lh, name, body); centrals.push(ch, name); offset += 30 + name.length + body.length;
    }
    const cd = Buffer.concat(centrals); const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, eocd]).toString('base64');
}

export const file = (name, data, o = {}) => ({ name, data: typeof data === 'string' ? data : JSON.stringify(data), ...o });
