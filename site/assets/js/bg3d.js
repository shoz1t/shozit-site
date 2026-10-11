/* Абстрактный 3D-фон. Низкополигональные тела (кубики, плиты, кристаллы) парят в глубине:
   мир наклоняется за курсором, тела отталкиваются от него и раскручиваются, клик даёт всплеск.
   Плоская заливка гранями с одним источником света, без градиентов и размытия.
   Считается на canvas, пока вкладка видна; prefers-reduced-motion даёт один статичный кадр. */
(function () {
  'use strict';
  var body = document.body;
  var theme = body.classList.contains('t-rigged') ? 'rigged' : body.classList.contains('t-deep') ? 'deep' : 'studio';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = window.matchMedia('(pointer: coarse)').matches;

  /* ---------- тела ---------- */
  var cubeV = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  var cubeF = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]];
  var octV = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  var octF = [];
  [0, 1].forEach(function (a) { [2, 3].forEach(function (b) { [4, 5].forEach(function (c) { octF.push([a, b, c]); }); }); });
  var SHAPES = {
    cube: { v: cubeV, f: cubeF, s: [1, 1, 1] },
    plate: { v: cubeV, f: cubeF, s: [1.7, 0.16, 1.15] },
    pillar: { v: cubeV, f: cubeF, s: [0.5, 1.9, 0.5] },
    crystal: { v: octV, f: octF, s: [0.75, 1.6, 0.75] },
    gem: { v: octV, f: octF, s: [1.1, 1.1, 1.1] }
  };
  var PAL = {
    studio: { mix: ['cube', 'cube', 'plate', 'plate', 'crystal'], colors: ['#8a6a2c', '#6b5328', '#a78442', '#4d3d22'], edge: '#e8c46a', dim: 0.8, bgfog: [13, 12, 10] },
    rigged: { mix: ['plate', 'plate', 'cube', 'cube', 'pillar'], colors: ['#4f5646', '#3b4235', '#60685a', '#2c3228'], edge: '#b7c29c', accent: '#d9ad67', dim: 0.8, bgfog: [7, 11, 9] },
    deep: { mix: ['crystal', 'crystal', 'crystal', 'gem', 'pillar'], colors: ['#7c52b3', '#a8662e', '#4aa7a1', '#5c3d8f', '#c4863f'], edge: '#f1d2a0', dim: 0.58, bgfog: [20, 18, 31] }
  }[theme];

  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6d2b79f5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function rgb(h) { return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)]; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  var cv = null, ctx = null, W = 0, H = 0, dpr = 1, F = 800, objs = [], raf = 0, last = 0;
  var mouse = { x: -9999, y: -9999, nx: 0, ny: 0, sx: 0, sy: 0 };
  var slow = 0, frames = 0, acc = 0, t0 = 0;
  var LIGHT = (function () { var l = [-0.45, -0.6, -0.66], m = Math.hypot(l[0], l[1], l[2]); return [l[0] / m, l[1] / m, l[2] / m]; })();

  function build() {
    var r = rng(theme === 'deep' ? 4 : theme === 'rigged' ? 2 : 9), n = 15;
    objs = [];
    for (var i = 0; i < n; i++) {
      var kind = PAL.mix[Math.floor(r() * PAL.mix.length)];
      objs.push({
        kind: kind, sh: SHAPES[kind],
        fx: (r() - 0.5) * 2.1, fy: (r() - 0.5) * 2.0, z: 650 + r() * 1150,
        size: 34 + r() * 62,
        col: rgb(PAL.colors[Math.floor(r() * PAL.colors.length)]),
        ax: r() * 6.28, ay: r() * 6.28, az: r() * 6.28,
        wx: (r() - 0.5) * 0.5, wy: (r() - 0.5) * 0.6, wz: (r() - 0.5) * 0.4,
        boost: 0, ox: 0, oy: 0, vx: 0, vy: 0,
        wire: theme !== 'rigged' && r() < 0.18,
        glow: theme === 'rigged' && r() < 0.1
      });
    }
  }
  function resize() {
    if (!cv) return;
    dpr = Math.min(window.devicePixelRatio || 1, slow ? 1 : 1.5);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    F = Math.max(W, H) * 0.95;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduce || !raf) draw(0);
  }

  /* ---------- шаг и отрисовка ---------- */
  function step(dt) {
    mouse.sx += (mouse.nx - mouse.sx) * Math.min(1, dt * 5);
    mouse.sy += (mouse.ny - mouse.sy) * Math.min(1, dt * 5);
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i], k = 1 + o.boost;
      o.ax += o.wx * dt * k; o.ay += o.wy * dt * k; o.az += o.wz * dt * k;
      o.boost *= Math.pow(0.35, dt);
      // положение на экране без смещения: считаем в draw, здесь только отталкивание от курсора
      var s = F / o.z, hx = W / 2 + o.fx * (W / 2) * 0.75 - mouse.sx * 40 * (700 / o.z), hy = H / 2 + o.fy * (H / 2) * 0.75 - mouse.sy * 28 * (700 / o.z);
      var dx = hx + o.ox - mouse.x, dy = hy + o.oy - mouse.y, d = Math.hypot(dx, dy) || 1, R = 230 + o.size * s;
      if (d < R) {
        var p = 1 - d / R;
        o.vx += (dx / d) * p * p * 1400 * dt; o.vy += (dy / d) * p * p * 1400 * dt;
        o.boost = Math.max(o.boost, p * 5);
      }
      o.vx += -o.ox * 5 * dt; o.vy += -o.oy * 5 * dt;
      var damp = Math.pow(0.04, dt);
      o.vx *= damp; o.vy *= damp;
      o.ox += o.vx * dt; o.oy += o.vy * dt;
    }
  }
  function rotate(o, v) {
    var x = v[0] * o.sh.s[0], y = v[1] * o.sh.s[1], z = v[2] * o.sh.s[2], c, s, t;
    c = Math.cos(o.ax); s = Math.sin(o.ax); t = y * c - z * s; z = y * s + z * c; y = t;
    c = Math.cos(o.ay); s = Math.sin(o.ay); t = x * c + z * s; z = -x * s + z * c; x = t;
    c = Math.cos(o.az); s = Math.sin(o.az); t = x * c - y * s; y = x * s + y * c; x = t;
    return [x, y, z];
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    // мир наклоняется за курсором
    var yaw = mouse.sx * 0.2, pitch = mouse.sy * 0.14, cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var order = objs.slice().sort(function (a, b) { return b.z - a.z; });
    for (var i = 0; i < order.length; i++) {
      var o = order[i], sc = o.size * (Math.min(W, H) / 900), fog = Math.min(1, Math.max(0, (o.z - 650) / 1150));
      var alpha = (1 - fog * 0.72) * 0.72;
      var cxs = W / 2 + o.fx * (W / 2) * 0.75 - mouse.sx * 40 * (700 / o.z) + o.ox;
      var cys = H / 2 + o.fy * (H / 2) * 0.75 - mouse.sy * 28 * (700 / o.z) + o.oy;
      var pr = F / o.z;
      var vs = o.sh.v.map(function (v) {
        var p = rotate(o, v), x = p[0] * sc, y = p[1] * sc, z = p[2] * sc;
        // доворот мира (рысканье и тангаж), затем перспектива
        var x1 = x * cy + z * sy, z1 = -x * sy + z * cy, y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
        var persp = F / (o.z + z2);
        return { x: cxs + x1 * persp, y: cys + y1 * persp, rx: x1, ry: y1, rz: z2 };
      });
      var faces = [];
      for (var f = 0; f < o.sh.f.length; f++) {
        var idx = o.sh.f[f], a = vs[idx[0]], b = vs[idx[1]], c = vs[idx[2]];
        var ux = b.rx - a.rx, uy = b.ry - a.ry, uz = b.rz - a.rz, wx = c.rx - a.rx, wy = c.ry - a.ry, wz = c.rz - a.rz;
        var nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        var cx = 0, cyy = 0, czz = 0;
        for (var q = 0; q < idx.length; q++) { cx += vs[idx[q]].rx; cyy += vs[idx[q]].ry; czz += vs[idx[q]].rz; }
        cx /= idx.length; cyy /= idx.length; czz /= idx.length;
        if (nx * cx + ny * cyy + nz * czz < 0) { nx = -nx; ny = -ny; nz = -nz; } // нормаль наружу
        var m = Math.hypot(nx, ny, nz) || 1; nx /= m; ny /= m; nz /= m;
        // грань видна, если смотрит на камеру
        if (nx * cx + ny * cyy + nz * (czz + o.z) >= 0) continue;
        var lam = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
        faces.push({ idx: idx, depth: czz, shade: 0.22 + 0.78 * lam });
      }
      faces.sort(function (a, b) { return b.depth - a.depth; });
      var edge = o.glow ? PAL.accent : PAL.edge;
      for (var g = 0; g < faces.length; g++) {
        var fc = faces[g];
        ctx.beginPath();
        for (var q2 = 0; q2 < fc.idx.length; q2++) { var pt = vs[fc.idx[q2]]; if (q2) ctx.lineTo(pt.x, pt.y); else ctx.moveTo(pt.x, pt.y); }
        ctx.closePath();
        if (!o.wire) {
          var lit = fc.shade + (o.boost > 0.3 ? Math.min(0.25, o.boost * 0.05) : 0);
          var k = PAL.dim * (1 - fog * 0.6);
          var rr = Math.round(PAL.bgfog[0] + (o.col[0] * lit - PAL.bgfog[0]) * k);
          var gg = Math.round(PAL.bgfog[1] + (o.col[1] * lit - PAL.bgfog[1]) * k);
          var bb = Math.round(PAL.bgfog[2] + (o.col[2] * lit - PAL.bgfog[2]) * k);
          ctx.fillStyle = 'rgb(' + rr + ',' + gg + ',' + bb + ')';
          ctx.fill();
        }
        ctx.lineWidth = o.wire ? 1.4 : 1;
        ctx.strokeStyle = edge;
        ctx.globalAlpha = Math.min(1, alpha * (o.wire ? 0.7 : 0.38 + Math.min(0.4, o.boost * 0.08)));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }
  function loop(ts) {
    raf = 0;
    if (document.hidden) return;
    var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
    last = ts;
    // слабое железо: если кадры дольше ~26 мс, один раз снижаем разрешение
    if (!slow) { acc += dt; frames++; if (frames === 90) { if (acc / frames > 0.026) { slow = 1; resize(); } frames = -1e9; } }
    if (coarse && !mouse.touch) { var t = ts / 1000; mouse.nx = Math.sin(t * 0.25) * 0.7; mouse.ny = Math.cos(t * 0.19) * 0.4; }
    step(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  /* ---------- события и запуск ---------- */
  function onMove(e) { mouse.x = e.clientX; mouse.y = e.clientY; mouse.nx = (e.clientX / W - 0.5) * 2; mouse.ny = (e.clientY / H - 0.5) * 2; mouse.touch = e.pointerType === 'touch'; }
  function onLeave() { mouse.x = mouse.y = -9999; mouse.nx = mouse.ny = 0; }
  function onDown(e) {
    objs.forEach(function (o) {
      var s = F / o.z, hx = W / 2 + o.fx * (W / 2) * 0.75 + o.ox, hy = H / 2 + o.fy * (H / 2) * 0.75 + o.oy;
      var d = Math.hypot(hx - e.clientX, hy - e.clientY), R = 420;
      if (d < R) { var p = 1 - d / R; o.boost = Math.max(o.boost, 10 * p + 2); o.wy += (Math.random() - 0.5) * 0.4 * p; var m = d || 1; o.vx += ((hx - e.clientX) / m) * 700 * p; o.vy += ((hy - e.clientY) / m) * 700 * p; }
    });
  }
  function onVis() { if (!document.hidden && cv && !reduce && !raf) { last = 0; raf = requestAnimationFrame(loop); } }

  function mount() {
    if (cv) return;
    cv = document.createElement('canvas');
    cv.className = 'bg3d';
    cv.setAttribute('aria-hidden', 'true');
    ctx = cv.getContext('2d');
    body.insertBefore(cv, body.firstChild);
    build(); resize();
    window.addEventListener('resize', resize);
    if (reduce) { draw(); return; }
    if (!coarse) {
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerdown', onDown, { passive: true });
      document.addEventListener('pointerleave', onLeave);
      window.addEventListener('blur', onLeave);
    }
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(loop);
  }
  function unmount() {
    if (!cv) return;
    if (raf) cancelAnimationFrame(raf);
    raf = 0; last = 0;
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown);
    document.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('blur', onLeave);
    document.removeEventListener('visibilitychange', onVis);
    cv.remove(); cv = ctx = null;
  }
  /* Главная: вместо canvas фоном служит видео в низу первого экрана. Оно чуть сдвигается за курсором. */
  var hasVideo = body.getAttribute('data-bg') === 'video';
  var vid = hasVideo ? document.querySelector('.hero-video video') : null;
  var vT = { x: 0, y: 0 }, vC = { x: 0, y: 0 }, vRaf = 0;
  function vTick() {
    vRaf = 0;
    vC.x += (vT.x - vC.x) * 0.07; vC.y += (vT.y - vC.y) * 0.07;
    vid.style.setProperty('--vx', vC.x.toFixed(2) + 'px');
    vid.style.setProperty('--vy', vC.y.toFixed(2) + 'px');
    if (Math.abs(vT.x - vC.x) > 0.02 || Math.abs(vT.y - vC.y) > 0.02) vRaf = requestAnimationFrame(vTick);
  }
  function vMove(e) { vT.x = -(e.clientX / window.innerWidth - 0.5) * 2 * 18; vT.y = -(e.clientY / window.innerHeight - 0.5) * 2 * 9; if (!vRaf) vRaf = requestAnimationFrame(vTick); }
  function setVideo(on) {
    if (!vid) return;
    if (on && !reduce) { var pr = vid.play(); if (pr && pr.catch) pr.catch(function () {}); } else vid.pause();
    window.removeEventListener('pointermove', vMove);
    if (on && !reduce && !coarse) window.addEventListener('pointermove', vMove, { passive: true });
  }
  function setFx(on, save) {
    body.classList.toggle('fx-off', !on);
    if (hasVideo) setVideo(on);
    else if (on) mount(); else unmount();
    if (save) store('fx', on ? 'on' : 'off');
    [].forEach.call(document.querySelectorAll('.fx-toggle'), function (b) { b.setAttribute('aria-pressed', String(on)); });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.fx-toggle');
    if (b) setFx(b.getAttribute('aria-pressed') !== 'true', true);
  });
  setFx(store('fx') !== 'off', false);
})();
