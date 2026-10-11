// Текстуры для сайта: зерно, царапины, пятна. Запуск: node tools/make-textures.mjs
// Пишет PNG (серый + прозрачность) в site/assets/img/tex/. Без внешних библиотек.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { rng } from './logo-glyphs.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'site', 'assets', 'img', 'tex');
mkdirSync(OUT, { recursive: true });

// ---- минимальный PNG-кодировщик (gray+alpha, 8 бит) ----
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function pngLA(w, h, la) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 4; // gray + alpha
  const raw = Buffer.alloc((w * 2 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 2 + 1)] = 0;
    la.copy(raw, y * (w * 2 + 1) + 1, y * w * 2, (y + 1) * w * 2);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const save = (name, w, h, la) => {
  const p = pngLA(w, h, la);
  writeFileSync(join(OUT, name), p);
  console.log(name, `${w}x${h}`, `${(p.length / 1024).toFixed(0)} KB`);
};

// ---- зерно: белый шум, тайлится ----
{
  const w = 160, h = 160, r = rng(101);
  const la = Buffer.alloc(w * h * 2);
  for (let i = 0; i < w * h; i++) {
    la[i * 2] = r() > 0.5 ? 255 : 0;
    la[i * 2 + 1] = Math.floor(r() * r() * 90);
  }
  save('grain.png', w, h, la);
}

// ---- пятна: fbm по тайлящейся решётке, чёрные разводы с мягким краем ----
{
  const w = 512, h = 512, r = rng(7);
  const G = 64;
  const lat = Array.from({ length: G * G }, () => r());
  const val = (x, y, f) => {
    const gx = (x / w) * f, gy = (y / h) * f;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const g = (i, j) => lat[((j % f) + f) % f * G + (((i % f) + f) % f)];
    const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const la = Buffer.alloc(w * h * 2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const n = val(x, y, 4) * 0.5 + val(x, y, 8) * 0.28 + val(x, y, 16) * 0.14 + val(x, y, 32) * 0.08;
      const t = Math.min(1, Math.max(0, (n - 0.5) / 0.22));
      const s = t * t * (3 - 2 * t);
      const i = (y * w + x) * 2;
      la[i] = 0;
      la[i + 1] = Math.round(s * 150);
    }
  save('stains.png', w, h, la);
}

// ---- царапины: тонкие линии, светлые и тёмные, с затуханием по концам ----
{
  const w = 1024, h = 512, r = rng(33);
  const A = new Float32Array(w * h), L = new Uint8Array(w * h);
  const seg = (x0, y0, x1, y1, width, strength, light) => {
    const minx = Math.max(0, Math.floor(Math.min(x0, x1) - width - 2)), maxx = Math.min(w - 1, Math.ceil(Math.max(x0, x1) + width + 2));
    const miny = Math.max(0, Math.floor(Math.min(y0, y1) - width - 2)), maxy = Math.min(h - 1, Math.ceil(Math.max(y0, y1) + width + 2));
    const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1;
    for (let y = miny; y <= maxy; y++)
      for (let x = minx; x <= maxx; x++) {
        let t = ((x - x0) * dx + (y - y0) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = x0 + dx * t, py = y0 + dy * t;
        const d = Math.hypot(x - px, y - py);
        const a = Math.max(0, 1 - d / (width / 2 + 0.6)) * strength * Math.sin(Math.PI * t) ** 0.6;
        const i = y * w + x;
        if (a > A[i]) {
          A[i] = a;
          L[i] = light ? 235 : 0;
        }
      }
  };
  for (let k = 0; k < 46; k++) {
    let x = r() * w, y = r() * h;
    const base = (r() < 0.6 ? -0.5 + r() : (r() < 0.5 ? 1 : -1) * (1 + r() * 0.5)) + (r() - 0.5) * 0.2;
    const light = r() < 0.7;
    const width = 0.8 + r() * 1.2;
    const strength = 0.25 + r() * 0.5;
    const parts = 1 + Math.floor(r() * 3);
    for (let p = 0; p < parts; p++) {
      const len = 40 + r() * 320;
      const a = base + (r() - 0.5) * 0.15;
      const nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len;
      seg(x, y, nx, ny, width, strength, light);
      x = nx;
      y = ny;
    }
  }
  const la = Buffer.alloc(w * h * 2);
  for (let i = 0; i < w * h; i++) {
    la[i * 2] = L[i];
    la[i * 2 + 1] = Math.round(A[i] * 255);
  }
  save('scratches.png', w, h, la);
}
