/* Лаунчер Shozit: интерфейс. Сеть, файлы и запуск игр делает Rust (src-tauri), здесь только показ и команды. */
if (!window.__TAURI__) await import('./mock.js'); // просмотр в обычном браузере без Tauri

const T = window.__TAURI__;
const invoke = T.core.invoke;
const listen = T.event.listen;
const appWin = T.window.getCurrentWindow();
const $ = (s, r = document) => r.querySelector(s);

const GAMES = {
  rigged: { name: 'Rigged', body: 'g-rigged', hero: 'img/rigged-slot.webp', thumb: 'img/rigged-slot.webp', logo: 'img/rigged-logo.svg' },
  'deep-roll': { name: 'Deep Roll', body: 'g-deep', hero: 'img/dr-map.webp', thumb: 'img/dr-map.webp', logo: 'img/dr-logo.webp' },
};

let S = { platform: 'windows', installed: {}, install_dir: '', lang: null, app_version: '' };
let remote = { online: false, manifest: null, news: null };
let dict = {};
let lang = 'ru';
let sel = 'rigged';
const progress = {}; // game -> последнее событие install-progress
const errors = {};   // game -> код ошибки
const launching = {};
let confirmUninstall = null;

/* ---------- перевод и форматы ---------- */
const t = (k, v) => String(dict[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? '');
function applyStatic() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-attr]').forEach((el) => el.dataset.i18nAttr.split(';').forEach((p) => { const i = p.indexOf(':'); el.setAttribute(p.slice(0, i), t(p.slice(i + 1))); }));
  document.querySelectorAll('#langSwitch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
}
async function loadLang(l) {
  lang = l;
  dict = await (await fetch(`i18n/${l}.json`)).json();
  applyStatic();
}
function fmtBytes(n) {
  if (!n) return '';
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' ' + t('unit.gb');
  if (n >= 1048576) return (n / 1048576).toFixed(n > 1.05e8 ? 0 : 1) + ' ' + t('unit.mb');
  return Math.max(1, Math.round(n / 1024)) + ' ' + t('unit.kb');
}
const fmtSpeed = (b) => (b > 0 ? (b / 1048576).toFixed(1) + ' ' + t('unit.mbs') : '');
function newer(a, b) {
  const p = (v) => String(v).replace(/^v/, '').split(/\D+/).filter(Boolean).map(Number);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const m = x[i] ?? 0, n = y[i] ?? 0; if (m !== n) return m > n; }
  return false;
}
const pickText = (o) => (o && (o[lang] || o.ru || o.en)) || '';
function errText(code) {
  if (!code) return '';
  const [c, detail] = String(code).split('|');
  const base = dict['err.' + c] ?? dict['err.generic'];
  return detail && c !== 'cancelled' ? `${base} (${detail})` : base;
}

/* ---------- состояние игры ---------- */
function info(game) {
  const m = remote.manifest?.games?.[game] || null;
  const inst = S.installed[game] || null;
  const dl = m?.downloads?.[S.platform] || null;
  const busy = !!progress[game] && !['done', 'cancelled'].includes(progress[game].phase);
  const frozen = !!m?.frozen || game === 'deep-roll';
  let state = 'none';
  if (busy) state = 'installing';
  else if (inst && m && !frozen && newer(m.version, inst.version)) state = 'update';
  else if (inst) state = 'installed';
  const canInstall = !!(remote.online && m && dl && dl.url);
  return { m, inst, dl, busy, frozen, state, canInstall };
}
const chipKey = (i) => (i.state === 'installing' ? 'chip.installing' : i.state === 'update' ? 'chip.update' : i.state === 'installed' ? 'chip.installed' : 'chip.none');

/* ---------- отрисовка ---------- */
function renderRail() {
  const box = $('#games');
  box.textContent = '';
  for (const id of Object.keys(GAMES)) {
    const g = GAMES[id], i = info(id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'game';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(id === sel));
    b.innerHTML = `<img src="${g.thumb}" alt=""><div><b></b><span class="chip"></span></div>`;
    b.querySelector('b').textContent = g.name;
    b.querySelector('.chip').textContent = t(chipKey(i));
    b.addEventListener('click', () => select(id));
    box.appendChild(b);
  }
  const ul = $('#news');
  ul.textContent = '';
  const items = (remote.news?.items || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 3);
  if (!items.length) { const li = document.createElement('li'); li.className = 'news-empty'; li.textContent = t('news.empty'); ul.appendChild(li); }
  for (const it of items) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const d = new Date(it.date + 'T12:00:00').toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long' });
    b.innerHTML = '<time></time><strong></strong>';
    b.querySelector('time').textContent = d;
    b.querySelector('strong').textContent = pickText(it.title);
    if (it.url) b.addEventListener('click', () => invoke('open_url', { url: it.url }).catch(() => {}));
    li.appendChild(b);
    ul.appendChild(li);
  }
}

function renderStage(animate) {
  const g = GAMES[sel], i = info(sel);
  document.body.classList.toggle('g-rigged', g.body === 'g-rigged');
  document.body.classList.toggle('g-deep', g.body === 'g-deep');
  if (animate) { const st = $('#stage'); st.classList.remove('swap'); void st.offsetWidth; st.classList.add('swap'); }
  $('#heroImg').src = g.hero;
  $('#heroLogo').src = g.logo;
  $('#heroLogo').alt = g.name;
  $('#heroTag').textContent = t('tag.' + sel);
  $('#desc').textContent = t('desc.' + sel);

  // баннер: ошибка или нет связи
  const banner = $('#banner');
  const code = errors[sel];
  if (code) {
    banner.className = 'banner err';
    banner.innerHTML = '<span></span>';
    banner.firstChild.textContent = errText(code);
    if (code.split('|')[0] !== 'cancelled' && i.canInstall) {
      const r = document.createElement('button');
      r.type = 'button';
      r.textContent = t('btn.retry');
      r.addEventListener('click', () => install(sel));
      banner.appendChild(r);
    }
    banner.hidden = false;
  } else if (!remote.online && i.state === 'none') {
    banner.className = 'banner';
    banner.innerHTML = '<span></span>';
    banner.firstChild.textContent = t('err.offline');
    banner.hidden = false;
  } else banner.hidden = true;

  // кнопки
  const main = $('#btnMain'), second = $('#btnSecond'), more = $('#btnMore');
  second.hidden = true;
  more.hidden = true;
  main.disabled = false;
  const play = () => launch(sel);
  const swap = (el, fn) => { const c = el.cloneNode(true); el.replaceWith(c); c.addEventListener('click', fn); return c; };
  let m1;
  if (i.state === 'installing') { m1 = swap(main, () => invoke('cancel_install', { game: sel })); m1.textContent = t('btn.cancel'); }
  else if (i.state === 'none') { m1 = swap(main, () => install(sel)); m1.textContent = t('btn.install'); m1.disabled = !i.canInstall; }
  else if (i.state === 'update') {
    m1 = swap(main, () => install(sel)); m1.textContent = t('btn.updateTo', { v: i.m.version }); m1.disabled = !i.canInstall;
    const s = swap(second, play); s.textContent = t('btn.play'); s.hidden = false;
  } else { m1 = swap(main, play); m1.textContent = launching[sel] ? t('btn.launched') : t('btn.play'); m1.disabled = !!launching[sel]; }
  if (i.inst && i.state !== 'installing') {
    const u = swap(more, async () => {
      if (confirmUninstall !== sel) { confirmUninstall = sel; renderStage(); setTimeout(() => { if (confirmUninstall === sel) { confirmUninstall = null; renderStage(); } }, 4000); return; }
      confirmUninstall = null;
      try { await invoke('uninstall_game', { game: sel }); await refreshState(); } catch (e) { errors[sel] = String(e); }
      renderAll();
    });
    u.textContent = confirmUninstall === sel ? t('btn.uninstallConfirm') : t('btn.uninstall');
    u.hidden = false;
  }

  // прогресс
  const prog = $('#progress');
  prog.hidden = i.state !== 'installing';
  updateProgress();

  // факты
  const facts = $('#facts');
  facts.textContent = '';
  const add = (k, v, cls) => { const d = document.createElement('div'); d.innerHTML = '<dt></dt><dd></dd>'; d.querySelector('dt').textContent = t(k); const dd = d.querySelector('dd'); dd.textContent = v; if (cls) dd.className = cls; facts.appendChild(d); };
  add('fact.installed', i.inst ? i.inst.version : t('val.none'));
  add('fact.latest', i.m ? i.m.version : t('val.none'), i.state === 'update' ? 'up' : '');
  add('fact.size', i.dl?.size ? fmtBytes(i.dl.size) : t('val.none'));
  add('fact.status', i.frozen ? t('status.frozen') : i.state === 'update' ? t('chip.update') : t('status.ok'));

  $('#folderPath').textContent = i.inst ? i.inst.dir : S.install_dir;
}

function updateProgress() {
  const p = progress[sel];
  const prog = $('#progress');
  if (!p || prog.hidden) return;
  const phaseKey = { download: 'phase.download', verify: 'phase.verify', extract: 'phase.extract' }[p.phase] || 'phase.wait';
  $('#pPhase').textContent = t(phaseKey);
  const frac = p.total > 0 ? Math.min(1, p.received / p.total) : 0;
  prog.classList.toggle('indet', !(p.total > 0));
  $('#pBar').style.transform = p.total > 0 ? `scaleX(${frac})` : '';
  const parts = [];
  if (p.total > 0) parts.push(Math.round(frac * 100) + '%');
  if (p.phase === 'download' && p.total > 0) parts.push(`${fmtBytes(p.received)} / ${fmtBytes(p.total)}`);
  if (p.phase === 'download' && p.speed > 0) parts.push(fmtSpeed(p.speed));
  $('#pNums').textContent = parts.join(' · ');
}

function renderStatus() {
  $('#netDot').className = 'dot ' + (remote.online ? 'on' : 'off');
  $('#netText').textContent = t(remote.online ? 'status.online' : 'status.offline');
  const el = $('#appVer');
  const l = remote.manifest?.launcher;
  el.textContent = '';
  if (l?.version && newer(l.version, S.app_version)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link-btn';
    b.textContent = t('status.newlauncher', { v: l.version });
    b.addEventListener('click', () => invoke('open_url', { url: l.downloads?.[S.platform]?.url || 'https://github.com/shoz1t/shozit-site/releases/latest' }).catch(() => {}));
    el.appendChild(b);
    el.appendChild(document.createTextNode('  ·  '));
  }
  el.appendChild(document.createTextNode(t('status.version', { v: S.app_version })));
}

function renderAll() { renderRail(); renderStage(); renderStatus(); }

/* ---------- действия ---------- */
function select(id) {
  if (id === sel) return;
  sel = id;
  confirmUninstall = null;
  renderRail();
  renderStage(true);
}
async function refreshState() { S = await invoke('app_state'); }
async function refreshRemote() {
  try { remote = await invoke('refresh_remote'); } catch { remote = { online: false, manifest: null, news: null }; }
}
async function install(game) {
  delete errors[game];
  progress[game] = { game, phase: 'wait', received: 0, total: 0, speed: 0 };
  renderAll();
  try {
    await invoke('install_game', { game });
  } catch (e) {
    errors[game] = String(e);
  }
  delete progress[game];
  await refreshState();
  renderAll();
}
async function launch(game) {
  delete errors[game];
  try {
    await invoke('launch_game', { game });
    launching[game] = true;
    setTimeout(() => { delete launching[game]; if (sel === game) renderStage(); }, 4000);
  } catch (e) { errors[game] = String(e); }
  renderStage();
}

/* ---------- окно ---------- */
async function syncMax() {
  let m = false;
  try { m = await appWin.isMaximized(); } catch { /* нет разрешения или не поддерживается */ }
  document.body.classList.toggle('maximized', m);
  $('#icoMax').setAttribute('d', m ? 'M3.5 2.5h6v6M2.5 3.5h6v6h-6z' : 'M2.5 2.5h7v7h-7z');
}
function initWindowControls() {
  $('#btnMin').addEventListener('click', () => appWin.minimize());
  $('#btnMax').addEventListener('click', () => appWin.toggleMaximize());
  $('#btnClose').addEventListener('click', () => {
    document.body.classList.add('closing');
    setTimeout(() => appWin.close(), 190);
  });
  listen('tauri://resize', syncMax);
  if (S.platform === 'linux') {
    document.body.classList.add('linux');
    // У окна без рамки в Linux нет своих границ для изменения размера: рисуем невидимые ручки по краям.
    const dirs = { n: 'North', s: 'South', e: 'East', w: 'West', nw: 'NorthWest', ne: 'NorthEast', sw: 'SouthWest', se: 'SouthEast' };
    for (const [k, d] of Object.entries(dirs)) {
      const h = document.createElement('div');
      h.className = 'rz rz-' + k;
      h.addEventListener('mousedown', (e) => { if (e.button === 0) { e.preventDefault(); appWin.startResizeDragging(d); } });
      document.body.appendChild(h);
    }
  }
  syncMax();
}

/* ---------- запуск ---------- */
async function boot() {
  document.querySelector('#langSwitch').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-lang]');
    if (!b || b.dataset.lang === lang) return;
    await loadLang(b.dataset.lang);
    invoke('set_lang', { lang: b.dataset.lang }).catch(() => {});
    renderAll();
  });
  $('#btnChoose').addEventListener('click', async () => {
    try {
      const picked = await T.dialog.open({ directory: true, multiple: false, defaultPath: S.install_dir || undefined });
      if (picked) { await invoke('set_install_dir', { path: picked }); await refreshState(); renderStage(); }
    } catch (e) { errors[sel] = String(e); renderStage(); }
  });
  $('#btnOpen').addEventListener('click', () => invoke('open_folder', { game: S.installed[sel] ? sel : null }).catch((e) => { errors[sel] = String(e); renderStage(); }));
  await listen('install-progress', (e) => {
    const p = e.payload;
    if (['done', 'cancelled'].includes(p.phase)) return;
    progress[p.game] = p;
    if (p.game === sel) updateProgress();
  });

  await refreshState();
  const startLang = S.lang || ((navigator.language || 'ru').toLowerCase().startsWith('ru') ? 'ru' : 'en');
  await loadLang(startLang);
  document.getElementById('appVer').textContent = t('status.version', { v: S.app_version });
  initWindowControls();
  renderAll();
  await appWin.show();
  document.body.classList.add('ready');

  // заставка 2,6 секунды, клик или клавиша пропускают
  const splash = $('#splash');
  const hide = () => { splash.classList.add('gone'); setTimeout(() => splash.remove(), 600); };
  splash.addEventListener('click', hide);
  setTimeout(hide, 2600);

  await refreshRemote();
  await refreshState();
  renderAll();
}
boot().catch((e) => { document.body.classList.add('ready'); console.error(e); });
