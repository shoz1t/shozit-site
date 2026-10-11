// Готовит картинки сайта из assets/ (оригиналы остаются нетронутыми).
// Запуск: node tools/prepare-images.mjs   (нужен ffmpeg в PATH)
// Каждая картинка ужимается до WebP не больше 300 КБ (подбирается качество).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site', 'assets', 'img');
mkdirSync(OUT, { recursive: true });
const R = join(ROOT, 'assets', 'rigged', 'media');
const D = join(ROOT, 'assets', 'deeproll', 'media');
const DB = join(ROOT, 'assets', 'deeproll', 'source', 'assets', 'branding');

const MAX_KB = 300;
const jobs = [
  // [вход, выход, ширина, фильтр обрезки (необязательно)]
  [join(R, 'Screenshot 2026-10-11 100050.png'), 'rigged-slot.webp', 1600],
  [join(R, 'Screenshot 2026-10-11 100647.png'), 'rigged-room.webp', 1600, 'crop=iw:ih-34:0:34'],
  [join(R, 'Screenshot 2026-10-11 100105.png'), 'rigged-coins.webp', 1400],
  [join(R, 'Screenshot 2026-10-11 100114.png'), 'rigged-exit.webp', 772],
  [join(D, 'Screenshot 2026-10-11 100433.png'), 'dr-map.webp', 1600, 'crop=iw:ih-118:0:118'],
  [join(D, 'Screenshot 2026-10-11 100427.png'), 'dr-menu.webp', 1600, 'crop=iw:ih-34:0:34'],
  [join(D, 'Screenshot 2026-10-11 100443.png'), 'dr-collection.webp', 1400, 'delogo=x=1556:y=2:w=322:h=26'],
  [join(D, 'Screenshot 2026-10-11 100436.png'), 'dr-tree.webp', 1100, 'crop=1100:340:70:50'],
  [join(DB, 'deep_roll_logo.png'), 'dr-logo.webp', 720],
];

const sizes = {};
for (const [src, name, width, crop] of jobs) {
  const dst = join(OUT, name);
  let q = 82, ok = false;
  while (!ok && q >= 50) {
    const vf = [crop, `scale=${width}:-2:flags=lanczos`].filter(Boolean).join(',');
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', vf, '-c:v', 'libwebp', '-quality', String(q), '-compression_level', '6', dst], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
    ok = statSync(dst).size <= MAX_KB * 1024;
    if (!ok) q -= 6;
  }
  // размеры из заголовка WebP (VP8/VP8L/VP8X), чтобы проставить width/height в HTML
  const b = readFileSync(dst);
  let w, h;
  const fmt = b.toString('latin1', 12, 16);
  if (fmt === 'VP8X') { w = 1 + b.readUIntLE(24, 3); h = 1 + b.readUIntLE(27, 3); }
  else if (fmt === 'VP8L') { const v = b.readUInt32LE(21); w = 1 + (v & 0x3fff); h = 1 + ((v >> 14) & 0x3fff); }
  else { w = b.readUInt16LE(26) & 0x3fff; h = b.readUInt16LE(28) & 0x3fff; }
  sizes[name] = { w, h, kb: Math.round(statSync(dst).size / 1024), q };
  console.log(name.padEnd(20), `${w}x${h}`, `${sizes[name].kb} KB (q${q})`);
}
writeFileSync(join(OUT, '_sizes.json'), JSON.stringify(sizes, null, 2));


