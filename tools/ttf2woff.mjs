// TTF -> WOFF (zlib). Запуск: node tools/ttf2woff.mjs вход.ttf выход.woff
// WOFF поддерживают все браузеры, включая WebKitGTK; файл получается заметно меньше TTF.
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

export function ttf2woff(buf) {
  const n = buf.readUInt16BE(4);
  const flavor = buf.readUInt32BE(0);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    const tag = buf.toString('latin1', o, o + 4);
    const checksum = buf.readUInt32BE(o + 4);
    const offset = buf.readUInt32BE(o + 8);
    const length = buf.readUInt32BE(o + 12);
    const data = buf.subarray(offset, offset + length);
    let comp = deflateSync(data, { level: 9 });
    if (comp.length >= length) comp = data;
    tables.push({ tag, checksum, length, comp });
  }
  const pad4 = (x) => (x + 3) & ~3;
  let off = 44 + 20 * n;
  for (const t of tables) {
    t.offset = off;
    off += pad4(t.comp.length);
  }
  const sfntSize = 12 + 16 * n + tables.reduce((a, t) => a + pad4(t.length), 0);
  const out = Buffer.alloc(off);
  out.write('wOFF', 0, 'latin1');
  out.writeUInt32BE(flavor, 4);
  out.writeUInt32BE(off, 8);
  out.writeUInt16BE(n, 12);
  out.writeUInt16BE(0, 14);
  out.writeUInt32BE(sfntSize, 16);
  out.writeUInt16BE(1, 20);
  out.writeUInt16BE(0, 22);
  tables.forEach((t, i) => {
    const e = 44 + i * 20;
    out.write(t.tag, e, 'latin1');
    out.writeUInt32BE(t.offset, e + 4);
    out.writeUInt32BE(t.comp.length, e + 8);
    out.writeUInt32BE(t.length, e + 12);
    out.writeUInt32BE(t.checksum, e + 16);
    t.comp.copy(out, t.offset);
  });
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('ttf2woff.mjs')) {
  const [inp, outp] = process.argv.slice(2);
  const src = readFileSync(inp);
  const w = ttf2woff(src);
  writeFileSync(outp, w);
  console.log(`${inp}: ${(src.length / 1024).toFixed(0)} KB -> ${outp}: ${(w.length / 1024).toFixed(0)} KB`);
}
