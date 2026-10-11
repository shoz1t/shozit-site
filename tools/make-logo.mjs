// Финальный логотип «Жетон» с объёмной монетой. Запуск: node tools/make-logo.mjs  ->  design/logo/
// Выход: shozit-logo.svg (статичный), shozit-logo-anim.svg (анимация ~2,3 с), shozit-mark.svg (только жетон).
// Всё прозрачное, без SVG-фильтров: износ сделан масками из пятен, анимируются только transform и opacity.
//
// Объём: у монеты есть толщина T. При повороте вокруг вертикальной оси видны две грани (лицо S и оборотная
// сторона «7»), боковой гурт с насечкой и дальний край. Всё считается из угла θ и пишется в @keyframes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { G, word, wearMask } from './logo-glyphs.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'design', 'logo');
mkdirSync(OUT, { recursive: true });

const CREAM = '#e8dcc0';
const AMBER = '#d9a441';
const PLATE = '#1b1913';
const INK = '#0d0c0a';
const EDGE = '#9a6f1f'; // боковая поверхность
const EDGE_DARK = '#5e4210'; // дальний край и нижний «срез»
const REED = '#3d2b0b';

const T = 12; // толщина монеты
const DY = 4; // вид чуть сверху: срез виден снизу
const SEVEN = 'M0 0H70V22L38 100H12L42 22H0Z'; // оборотная сторона: «7» из слота

// ---------- грань монеты ----------
function face(cx, cy, R, glyph, maskId, { lit = false, flash = false } = {}) {
  const N = 32;
  const step = (Math.PI * 2) / N;
  const ro = R - 3, ri = R - 13;
  const pt = (r, a) => `${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
  let notches = '';
  for (let i = 0; i < N; i++) {
    const a0 = i * step - Math.PI / 2 + step * 0.16;
    const a1 = a0 + step * 0.68;
    notches += `<path${lit ? ` class="n" style="--i:${i}"` : ''} d="M${pt(ro, a0)}A${ro} ${ro} 0 0 1 ${pt(ro, a1)}L${pt(ri, a1)}A${ri} ${ri} 0 0 0 ${pt(ri, a0)}Z" fill="${AMBER}"/>`;
  }
  const rad = (d) => (d * Math.PI) / 180;
  const arc = (r, d0, d1) => `M${pt(r, rad(d0))}A${r} ${r} 0 0 1 ${pt(r, rad(d1))}`;
  const s = 0.62;
  const sx = cx - (70 * s) / 2, sy = cy - (100 * s) / 2;
  return `
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="${PLATE}"/>
    ${notches}
    <circle cx="${cx}" cy="${cy}" r="${R - 20}" fill="none" stroke="${CREAM}" stroke-opacity="0.3" stroke-width="1.5"/>
    <path d="${arc(R - 1.2, 190, 262)}" fill="none" stroke="${CREAM}" stroke-opacity="0.32" stroke-width="2.2" stroke-linecap="round"/>
    <path d="${arc(R - 1.2, 8, 80)}" fill="none" stroke="#000" stroke-opacity="0.5" stroke-width="2.2" stroke-linecap="round"/>
    <g transform="translate(${(sx + 1.2).toFixed(2)} ${(sy + 1.6).toFixed(2)}) scale(${s})"><path d="${glyph}" fill="#000" fill-opacity="0.55"/></g>
    <g transform="translate(${sx.toFixed(2)} ${sy.toFixed(2)}) scale(${s})" mask="url(#${maskId})">
      <path d="${glyph}" fill="${CREAM}"/>
      ${flash ? `<path class="flash" d="${glyph}" fill="${AMBER}"/>` : ''}
    </g>`;
}

// ---------- монета ----------
function coinStatic(cx, cy, R) {
  return `<circle cx="${cx}" cy="${cy + DY}" r="${R}" fill="${EDGE_DARK}"/>${face(cx, cy, R, G.S[1], 'wm-s')}`;
}

function coinAnim(cx, cy, R) {
  const bandTop = cy - R + DY, bandH = 2 * R - DY / 2;
  return `<g class="fall">
  <circle class="ef" cx="${cx}" cy="${cy + DY}" r="${R}" fill="${EDGE_DARK}"/>
  <circle class="eb" cx="${cx}" cy="${cy + DY}" r="${R}" fill="${EDGE_DARK}"/>
  <rect class="bd" x="${cx - T / 2}" y="${bandTop}" width="${T}" height="${bandH}" fill="url(#reed)"/>
  <g class="fb">${face(cx, cy, R, SEVEN, 'wm-b')}</g>
  <g class="fa">${face(cx, cy, R, G.S[1], 'wm-s', { lit: true, flash: true })}</g>
</g>
<circle class="ring" cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${AMBER}" stroke-width="2"/>`;
}

// ---------- раскладка ----------
const WM_SCALE = 0.95;
const TG_SCALE = 0.16;
const cx = 110, cy = 110, R = 82;
const wm = word('SHOZIT', { gap: 12, cls: 'ltr' });
const wmW = wm.width * WM_SCALE;
const tg = word('DEVELOPMENTS', { targetWidth: wmW / TG_SCALE, cls: 'tl' });
const wx = 236, wy = 52;
const W = Math.ceil(wx + wmW + 16), H = 220;
const tgY = wy + 100 * WM_SCALE + 20;

const masks =
  wearMask('wm-s', [0, 0, 70, 100], { specks: 28, scratches: 1, seed: 11 }) +
  wearMask('wm-b', [0, 0, 70, 100], { specks: 28, scratches: 1, seed: 23 }) +
  wearMask('wm-w', [0, 0, wm.width, 100], { specks: 230, scratches: 3, seed: 5 });

const reed = `<pattern id="reed" width="3" height="10" patternUnits="userSpaceOnUse"><rect width="3" height="10" fill="${EDGE}"/><rect width="1.1" height="10" fill="${REED}"/></pattern>`;

function wordmark() {
  return `
<g transform="translate(${wx} ${wy}) scale(${WM_SCALE})" fill="${CREAM}" mask="url(#wm-w)">${wm.svg}</g>
<g transform="translate(${wx} ${tgY}) scale(${TG_SCALE})" fill="${AMBER}">${tg.svg}</g>`;
}

// ---------- анимация ----------
// Падение с двумя оборотами вокруг вертикальной оси, удар, затем монета качается из стороны в сторону
// всё чаще и мельче. На ударе S вспыхивает янтарём, по ободу бежит свет, потом выезжает надпись.
const DUR = 1.28;
const FALL = 0.55;
const wobble = [[0.55, 0], [0.66, 80], [0.78, -66], [0.88, 50], [0.96, -36], [1.03, 24], [1.09, -14], [1.14, 7], [1.18, -3], [1.28, 0]];
function theta(t) {
  if (t <= FALL) return (4 * Math.PI * t) / FALL;
  for (let i = 1; i < wobble.length; i++) {
    const [t1, d1] = wobble[i];
    if (t <= t1) {
      const [t0, d0] = wobble[i - 1];
      const u = (t - t0) / (t1 - t0);
      const e = (1 - Math.cos(Math.PI * u)) / 2;
      return ((d0 + (d1 - d0) * e) * Math.PI) / 180;
    }
  }
  return 0;
}

const FPS = 60;
const samples = [];
for (let k = 0; k <= Math.round(DUR * FPS); k++) samples.push(Math.min(k / FPS, DUR));
samples[samples.length - 1] = DUR;

const f = (n) => n.toFixed(3);
function track(fn) {
  return samples
    .map((t) => {
      const th = theta(t);
      const c = Math.cos(th), s = Math.sin(th);
      const { x = 0, sc, op } = fn(c, s);
      const tr = `translateX(${f(x)}px) scaleX(${f(sc)})`;
      return `${((t / DUR) * 100).toFixed(2)}% { transform: ${tr}; opacity: ${op} }`;
    })
    .join('\n  ');
}
const xF = (s) => (T / 2) * s;
const xB = (s) => -(T / 2) * s;
const kf = {
  fa: track((c, s) => ({ x: xF(s), sc: Math.abs(c), op: c >= 0 ? 1 : 0 })),
  fb: track((c, s) => ({ x: xB(s), sc: Math.abs(c), op: c < 0 ? 1 : 0 })),
  ef: track((c, s) => ({ x: xF(s), sc: Math.abs(c), op: c < 0 ? 1 : 0 })),
  eb: track((c, s) => ({ x: xB(s), sc: Math.abs(c), op: c >= 0 ? 1 : 0 })),
  bd: track((c, s) => ({ x: 0, sc: Math.abs(s), op: 1 })),
};

const css = `
  .a, .a * { transform-box: fill-box; }
  .fa, .fb, .ef, .eb, .bd { transform-origin: 50% 50%; animation-duration: ${DUR}s; animation-timing-function: linear; animation-fill-mode: both; }
  .fa { animation-name: kfa } .fb { animation-name: kfb; opacity: 0 }
  .ef { animation-name: kef; opacity: 0 } .eb { animation-name: keb }
  .bd { animation-name: kbd; transform: scaleX(0) }
  @keyframes kfa {
  ${kf.fa}
  }
  @keyframes kfb {
  ${kf.fb}
  }
  @keyframes kef {
  ${kf.ef}
  }
  @keyframes keb {
  ${kf.eb}
  }
  @keyframes kbd {
  ${kf.bd}
  }
  .fall { transform-origin: 50% 100%; animation: fall ${DUR}s both, fall-fade .1s linear both; }
  @keyframes fall {
    0%   { transform: translateY(-80px) scaleY(1); animation-timing-function: cubic-bezier(.5,0,1,1) }
    43%  { transform: translateY(0) scaleY(1); animation-timing-function: linear }
    46%  { transform: translateY(0) scaleY(.93); animation-timing-function: ease-out }
    55%  { transform: translateY(-12px) scaleY(1); animation-timing-function: ease-in }
    65%  { transform: translateY(0); animation-timing-function: ease-out }
    70%  { transform: translateY(-3px); animation-timing-function: ease-in }
    75%  { transform: translateY(0) }
    100% { transform: translateY(0) scaleY(1) }
  }
  @keyframes fall-fade { from { opacity: 0 } to { opacity: 1 } }
  .flash { opacity: 0; animation: flash .55s ease-out .55s both; }
  @keyframes flash { 0% { opacity: 0 } 20% { opacity: 1 } 100% { opacity: 0 } }
  .ring { opacity: 0; transform-origin: 50% 50%; animation: ring .6s ease-out .55s forwards; }
  @keyframes ring { from { opacity: .7; transform: scale(1) } to { opacity: 0; transform: scale(1.45) } }
  .n { animation: lit .35s linear calc(.6s + var(--i) * .025s) both; }
  @keyframes lit { from { opacity: .12 } to { opacity: 1 } }
  .ltr { animation: slide .4s cubic-bezier(.2,.8,.2,1) calc(1s + var(--i) * .06s) both; }
  @keyframes slide { from { opacity: 0; transform: translateX(-16px) } to { opacity: 1; transform: none } }
  .tl { animation: tfade .4s linear calc(1.55s + var(--i) * .03s) both; }
  @keyframes tfade { from { opacity: 0 } to { opacity: 1 } }
  @media (prefers-reduced-motion: reduce) { .a, .a * { animation: none !important; } .fa, .eb { opacity: 1 !important; transform: none !important; } .fb, .ef, .bd { opacity: 0 !important; } .ring, .flash { opacity: 0 !important; } .fall { transform: none !important; } }`;

const svg = (w, h, inner, { anim, title }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${title}">
<title>${title}</title>
<defs>${masks}${anim ? reed : ''}</defs>
${anim ? `<style>${css}</style>` : ''}
<g class="${anim ? 'a' : ''}">${inner}</g>
</svg>`;

const TITLE = 'Shozit Developments';
const files = {
  'shozit-logo.svg': svg(W, H, coinStatic(cx, cy, R) + wordmark(), { anim: false, title: TITLE }),
  'shozit-logo-anim.svg': svg(W, H, coinAnim(cx, cy, R) + wordmark(), { anim: true, title: TITLE }),
  'shozit-mark.svg': svg(2 * R + 8, 2 * R + 8 + DY, `<g transform="translate(${R + 4 - cx} ${R + 4 - cy})">${coinStatic(cx, cy, R)}</g>`, { anim: false, title: 'Shozit' }),
};
for (const [n, s] of Object.entries(files)) writeFileSync(join(OUT, n), s, 'utf8');
console.log('OK', W + 'x' + H, Object.entries(files).map(([n, s]) => `${n} ${(s.length / 1024).toFixed(0)}KB`).join(', '));
