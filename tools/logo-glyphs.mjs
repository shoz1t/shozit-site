// Буквы Shozit Developments. Нарисованы с нуля на сетке высотой 100, штрих 22, фаски 12.
export const G = {
  S: [70, 'M12 0H70V22H26V38H58L70 50V88L58 100H0V78H44V62H12L0 50V12Z'],
  H: [72, 'M0 0H22V38H50V0H72V100H50V62H22V100H0Z'],
  O: [70, 'M12 0H58L70 12V88L58 100H12L0 88V12ZM26 22V78H44V22Z'],
  Z: [70, 'M0 0H70V22L30 78H70V100H0V78L40 22H0Z'],
  I: [22, 'M0 0H22V100H0Z'],
  T: [70, 'M0 0H70V22H46V100H24V22H0Z'],
  D: [70, 'M0 0H46L70 24V76L46 100H0ZM22 22V78H38L48 68V32L38 22Z'],
  E: [62, 'M0 0H62V22H22V38H54V60H22V78H62V100H0Z'],
  V: [72, 'M0 0H23L36 66L49 0H72L47 100H25Z'],
  L: [60, 'M0 0H22V78H60V100H0Z'],
  P: [68, 'M0 0H56L68 12V54L56 66H22V100H0ZM22 22V44H46V22Z'],
  M: [92, 'M0 0H24L46 48L68 0H92V100H70V40L46 92L22 40V100H0Z'],
  N: [74, 'M0 0H22L52 60V0H74V100H52L22 40V100H0Z'],
};

// Раскладка слова: gap задаёт зазор, targetWidth растягивает слово до нужной ширины.
export function layout(text, gap, targetWidth) {
  const chars = [...text];
  const sum = chars.reduce((a, c) => a + G[c][0], 0);
  const g = targetWidth ? (targetWidth - sum) / (chars.length - 1) : gap;
  let x = 0;
  const items = chars.map((ch) => {
    const it = { ch, x };
    x += G[ch][0] + g;
    return it;
  });
  return { items, width: x - g };
}

// Каждая буква в своей группе: позиция в <g transform>, анимация (если есть) на <path class>.
export function word(text, { gap = 12, targetWidth, cls = '' } = {}) {
  const { items, width } = layout(text, gap, targetWidth);
  const svg = items
    .map(
      (it, i) =>
        `<g transform="translate(${it.x.toFixed(2)} 0)"><path class="${cls}" style="--i:${i}" d="${G[it.ch][1]}" fill-rule="evenodd"/></g>`
    )
    .join('');
  return { svg, width };
}

// Детерминированный генератор для пятен износа.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Маска износа: чёрные пятна и царапины на белом. Возвращает содержимое <mask>.
// Координаты в единицах букв (высота 100), box = [x, y, w, h].
export function wearMask(id, box, { specks = 200, scratches = 3, seed = 1 } = {}) {
  const r = rng(seed);
  const [bx, by, bw, bh] = box;
  let d = '';
  for (let i = 0; i < specks; i++) {
    const cx = bx + r() * bw, cy = by + r() * bh;
    const rad = 0.35 + Math.pow(r(), 3) * 2.4; // в основном мелкие, редко крупные
    const n = 4 + Math.floor(r() * 3);
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r() * 0.8;
      const rr = rad * (0.6 + r() * 0.7);
      pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)} ${(cy + Math.sin(a) * rr).toFixed(2)}`);
    }
    d += `M${pts.join('L')}Z`;
  }
  let sc = '';
  for (let i = 0; i < scratches; i++) {
    const x1 = bx + r() * bw * 0.7, y1 = by + r() * bh;
    const len = bw * (0.12 + r() * 0.25);
    const ang = -0.35 + r() * 0.5;
    sc += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}L${(x1 + Math.cos(ang) * len).toFixed(1)} ${(y1 + Math.sin(ang) * len).toFixed(1)}" stroke="#000" stroke-width="${(0.5 + r() * 0.7).toFixed(2)}" stroke-linecap="round"/>`;
  }
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="${bx - 5}" y="${by - 5}" width="${bw + 10}" height="${bh + 10}"><rect x="${bx - 5}" y="${by - 5}" width="${bw + 10}" height="${bh + 10}" fill="#fff"/><path d="${d}" fill="#000"/>${sc}</mask>`;
}
