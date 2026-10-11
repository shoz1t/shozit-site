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

let S = { platform: 'windows', installed: {}, install_dir: '', dirs: {}, lang: null, app_version: '', per_game_dirs: false, auto_update_games: true, auto_update_launcher: true, after_launch: 'keep', reduce_animations: null, log_path: '' };
let remote = { online: false, manifest: null, news: null };
let dict = {};
let lang = 'ru';
let sel = 'rigged';
const progress = {}; // game -> последнее событие install-progress
const errors = {};   // game -> код ошибки
const launching = {};
let confirmUninstall = null;

/* ---------- кнопки окна: подключаются первыми и не зависят от загрузки данных ---------- */
async function syncMax() {
  let m = false;
  try { m = await appWin.isMaximized(); } catch { /* нет разрешения или не поддерживается */ }
  document.body.classList.toggle('maximized', m);
  $('#icoMax').setAttribute('d', m ? 'M3.5 2.5h6v6M2.5 3.5h6v6h-6z' : 'M2.5 2.5h7v7h-7z');
}
function closeWindow() {
  document.body.classList.add('closing');
  setTimeout(async () => {
    try { await appWin.close(); } catch { try { await appWin.destroy(); } catch { /* окно уже закрывается */ } }
  }, document.body.classList.contains('no-anim') ? 0 : 190);
}
$('#btnMin').addEventListener('click', () => appWin.minimize().catch(() => {}));
$('#btnMax').addEventListener('click', () => appWin.toggleMaximize().catch(() => {}));
$('#btnClose').addEventListener('click', closeWindow);
listen('tauri://resize', syncMax);

/* ---------- перевод и форматы ---------- */
const t = (k, v) => String(dict[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? '');
function applyStatic() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-attr]').forEach((el) => el.dataset.i18nAttr.split(';').forEach((p) => { const i = p.indexOf(':'); el.setAttribute(p.slice(0, i), t(p.slice(i + 1))); }));
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
  if (c === 'no_space') return t('err.no_space', { v: (detail || '').split(' / ')[0] });
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

/* ---------- отрисовка главного окна ---------- */
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

  const main = $('#btnMain'), second = $('#btnSecond');
  second.hidden = true;
  main.disabled = false;
  const swap = (el, fn) => { const c = el.cloneNode(true); el.replaceWith(c); c.addEventListener('click', fn); return c; };
  let m1;
  if (i.state === 'installing') { m1 = swap(main, () => invoke('cancel_install', { game: sel })); m1.textContent = t('btn.cancel'); }
  else if (i.state === 'none') { m1 = swap(main, () => install(sel)); m1.textContent = t('btn.install'); m1.disabled = !i.canInstall; }
  else if (i.state === 'update') {
    m1 = swap(main, () => install(sel)); m1.textContent = t('btn.updateTo', { v: i.m.version }); m1.disabled = !i.canInstall;
    const s = swap(second, () => launch(sel)); s.textContent = t('btn.play'); s.hidden = false;
  } else { m1 = swap(main, () => launch(sel)); m1.textContent = launching[sel] ? t('btn.launched') : t('btn.play'); m1.disabled = !!launching[sel]; }

  const prog = $('#progress');
  prog.hidden = i.state !== 'installing';
  updateProgress();

  const facts = $('#facts');
  facts.textContent = '';
  const add = (k, v, cls) => { const d = document.createElement('div'); d.innerHTML = '<dt></dt><dd></dd>'; d.querySelector('dt').textContent = t(k); const dd = d.querySelector('dd'); dd.textContent = v; if (cls) dd.className = cls; facts.appendChild(d); };
  add('fact.installed', i.inst ? i.inst.version : t('val.none'));
  add('fact.latest', i.m ? i.m.version : t('val.none'), i.state === 'update' ? 'up' : '');
  add('fact.size', i.dl?.size ? fmtBytes(i.dl.size) : t('val.none'));
  add('fact.status', i.frozen ? t('status.frozen') : i.state === 'update' ? t('chip.update') : t('status.ok'));

  $('#folderPath').textContent = i.inst ? i.inst.dir : (S.dirs[sel] || S.install_dir);
}

function updateProgress() {
  const p = progress[sel];
  const prog = $('#progress');
  if (!p || prog.hidden) return;
  const phaseKey = { download: 'phase.download', verify: 'phase.verify', extract: 'phase.extract', move: 'phase.move' }[p.phase] || 'phase.wait';
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
  if (S.auto_update_launcher && l?.version && newer(l.version, S.app_version)) {
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

function renderAll() { renderRail(); renderStage(); renderStatus(); if (isOpen()) renderSettings(); }

/* ---------- действия ---------- */
function select(id) {
  if (id === sel) return;
  sel = id;
  confirmUninstall = null;
  renderRail();
  renderStage(true);
}
async function refreshState() { S = await invoke('app_state'); applyAnim(); }
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
    if (S.after_launch === 'minimize') appWin.minimize().catch(() => {});
    else if (S.after_launch === 'close') setTimeout(closeWindow, 600);
  } catch (e) { errors[game] = String(e); }
  renderStage();
}
/* автообновление игр при запуске лаунчера (если включено в настройках) */
async function autoUpdateGames() {
  if (!S.auto_update_games || !remote.online) return;
  for (const id of Object.keys(GAMES)) {
    const i = info(id);
    if (i.state === 'update' && i.canInstall) await install(id);
  }
}

/* ---------- анимации ---------- */
function applyAnim() {
  const off = S.reduce_animations ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.body.classList.toggle('no-anim', !!off);
  const v = $('.panel-fx');
  if (v) { if (off) v.pause(); else v.play?.().catch?.(() => {}); }
}

/* ---------- панель настроек ---------- */
const drawer = $('#settings'), scrim = $('#scrim'), btnSettings = $('#btnSettings');
let pendingMove = [];
const isOpen = () => drawer.classList.contains('open');
const gname = (id) => GAMES[id]?.name || id;

function openSettings() {
  renderSettings();
  drawer.classList.add('open');
  scrim.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  btnSettings.setAttribute('aria-expanded', 'true');
  setTimeout(() => drawer.focus(), 30);
}
function closeSettings() {
  if (!isOpen()) return;
  drawer.classList.remove('open');
  scrim.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  btnSettings.setAttribute('aria-expanded', 'false');
  btnSettings.focus();
}
btnSettings.addEventListener('click', () => (isOpen() ? closeSettings() : openSettings()));
$('#stClose').addEventListener('click', closeSettings);
scrim.addEventListener('click', closeSettings);
document.addEventListener('keydown', (e) => {
  if (!isOpen()) return;
  if (e.key === 'Escape') { e.preventDefault(); closeSettings(); return; }
  if (e.key === 'Tab') { // фокус не уходит из панели
    const f = [...drawer.querySelectorAll('button:not([disabled]), input, [tabindex="0"]')].filter((x) => x.offsetParent !== null || x.type === 'checkbox');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === drawer)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

async function patch(obj) {
  try { await invoke('update_settings', { patch: obj }); await refreshState(); } catch (e) { console.error(e); }
  renderAll();
}

function renderSettings() {
  $('#stPerGame').checked = !!S.per_game_dirs;
  $('#stAutoGames').checked = !!S.auto_update_games;
  $('#stAutoLauncher').checked = !!S.auto_update_launcher;
  $('#stNoAnim').checked = document.body.classList.contains('no-anim');
  document.querySelectorAll('#stAfter button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === S.after_launch)));
  document.querySelectorAll('#stLang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === lang)));
  $('#stVersion').textContent = t('set.version', { v: S.app_version });
  $('#stLogPath').textContent = S.log_path;
  renderDirs();
  renderGameFiles();
}

function renderDirs() {
  const box = $('#stDirs');
  box.textContent = '';
  const rows = S.per_game_dirs ? Object.keys(GAMES).map((id) => ({ id, label: gname(id), path: S.dirs[id] })) : [{ id: null, label: t('set.dir.shared'), path: S.install_dir }];
  for (const r of rows) {
    const el = document.createElement('div');
    el.className = 'dir';
    el.innerHTML = '<div class="dir-top"><b></b><button type="button" class="mini"></button></div><code></code><p class="note"></p>';
    el.querySelector('b').textContent = r.label;
    const btn = el.querySelector('button');
    btn.textContent = t('set.dir.choose');
    btn.addEventListener('click', () => chooseDir(r.id));
    el.querySelector('code').textContent = r.path;
    el.querySelector('code').title = r.path;
    const note = el.querySelector('.note');
    invoke('check_dir', { path: r.path }).then((c) => {
      if (!c.writable) { note.className = 'note warn'; note.textContent = t('set.dir.nowrite'); }
      else if (c.free && c.free < 3 * 1073741824) { note.className = 'note warn'; note.textContent = t('set.dir.lowspace', { v: fmtBytes(c.free) }); }
      else { note.textContent = c.free ? t('set.dir.free', { v: fmtBytes(c.free) }) : ''; }
    }).catch(() => {});
    box.appendChild(el);
  }
}

async function chooseDir(id) {
  const current = id ? S.dirs[id] : S.install_dir;
  let picked = null;
  try { picked = await T.dialog.open({ directory: true, multiple: false, defaultPath: current || undefined }); } catch (e) { console.error(e); }
  if (!picked) return;
  try {
    const res = await invoke('set_dir', { game: id, path: picked });
    await refreshState();
    renderAll();
    if (res.affected?.length) {
      pendingMove = res.affected;
      $('#stMoveText').textContent = t('set.move.ask', { games: res.affected.map(gname).join(', ') });
      $('#stMove').hidden = false;
    } else $('#stMove').hidden = true;
  } catch (e) {
    for (const row of document.querySelectorAll('#stDirs .note')) { row.className = 'note warn'; row.textContent = errText(String(e)); break; }
  }
}
$('#stMoveKeep').addEventListener('click', () => { pendingMove = []; $('#stMove').hidden = true; });
$('#stMoveDo').addEventListener('click', async () => {
  const list = pendingMove.slice();
  pendingMove = [];
  $('#stMoveText').textContent = t('set.move.busy');
  $('#stMove').querySelector('.ask-btns').hidden = true;
  let failed = '';
  for (const g of list) {
    progress[g] = { game: g, phase: 'move', received: 0, total: 0, speed: 0 };
    renderStage();
    try { await invoke('move_game', { game: g }); } catch (e) { failed = errText(String(e)); }
    delete progress[g];
  }
  await refreshState();
  $('#stMoveText').textContent = failed || t('set.move.done');
  setTimeout(() => { $('#stMove').hidden = true; $('#stMove').querySelector('.ask-btns').hidden = false; }, failed ? 5000 : 1800);
  renderAll();
});

$('#stPerGame').addEventListener('change', (e) => patch({ per_game_dirs: e.target.checked }));
$('#stAutoGames').addEventListener('change', (e) => patch({ auto_update_games: e.target.checked }));
$('#stAutoLauncher').addEventListener('change', (e) => patch({ auto_update_launcher: e.target.checked }));
$('#stNoAnim').addEventListener('change', (e) => patch({ reduce_animations: e.target.checked }));
$('#stAfter').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) patch({ after_launch: b.dataset.v }); });
$('#stLang').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-v]');
  if (!b || b.dataset.v === lang) return;
  await loadLang(b.dataset.v);
  await patch({ lang: b.dataset.v });
});
$('#stLog').addEventListener('click', () => invoke('open_log').catch(() => {}));
$('#stCheck').addEventListener('click', async () => {
  const note = $('#stCheckNote');
  note.className = 'note';
  note.textContent = '…';
  await refreshRemote();
  await refreshState();
  renderAll();
  if (!remote.online) { note.className = 'note warn'; note.textContent = t('set.check.offline'); return; }
  const ups = Object.keys(GAMES).filter((id) => info(id).state === 'update').map(gname);
  note.className = 'note ' + (ups.length ? '' : 'ok');
  note.textContent = ups.length ? t('set.check.some', { games: ups.join(', ') }) : t('set.check.none');
  if (S.auto_update_games) autoUpdateGames();
});

const verifyState = {}; // game -> {text, cls, repair}
function renderGameFiles() {
  const box = $('#stGames');
  box.textContent = '';
  for (const id of Object.keys(GAMES)) {
    const inst = S.installed[id];
    const busy = !!progress[id];
    const el = document.createElement('div');
    el.className = 'gf';
    el.innerHTML = '<div class="gf-top"><b></b><span></span></div><div class="gf-btns"></div><p class="note" hidden></p>';
    el.querySelector('b').textContent = gname(id);
    el.querySelector('span').textContent = inst ? 'v' + inst.version : t('set.notinstalled');
    const btns = el.querySelector('.gf-btns');
    const mk = (text, cls, fn, disabled) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'mini ' + cls; b.textContent = text; b.disabled = !!disabled; b.addEventListener('click', fn); btns.appendChild(b); return b; };
    mk(t('set.verify'), 'mini--ghost', () => verifyGame(id), !inst || busy);
    mk(t('folder.open'), 'mini--ghost', () => invoke('open_folder', { game: id }).catch(() => {}), !inst);
    mk(confirmUninstall === 'set:' + id ? t('set.uninstall.confirm') : t('set.uninstall'), 'mini--ghost mini--danger', async () => {
      if (confirmUninstall !== 'set:' + id) { confirmUninstall = 'set:' + id; renderGameFiles(); setTimeout(() => { if (confirmUninstall === 'set:' + id) { confirmUninstall = null; if (isOpen()) renderGameFiles(); } }, 4000); return; }
      confirmUninstall = null;
      try { await invoke('uninstall_game', { game: id }); delete verifyState[id]; } catch (e) { verifyState[id] = { text: errText(String(e)), cls: 'warn' }; }
      await refreshState();
      renderAll();
    }, !inst || busy);
    const v = verifyState[id];
    if (v) {
      const note = el.querySelector('.note');
      note.hidden = false;
      note.className = 'note ' + (v.cls || '');
      note.textContent = v.text;
      if (v.repair && i18nRepairOk(id)) mk(t('set.repair'), '', () => { delete verifyState[id]; install(id); }, false);
    }
    box.appendChild(el);
  }
}
const i18nRepairOk = (id) => info(id).canInstall;
async function verifyGame(id) {
  verifyState[id] = { text: t('set.verifying'), cls: '' };
  progress[id] = { game: id, phase: 'verify', received: 0, total: 0, speed: 0 };
  renderGameFiles();
  renderStage();
  try {
    const r = await invoke('verify_game', { game: id });
    if (r.state === 'ok') verifyState[id] = { text: t('set.verify.ok', { n: r.checked }), cls: 'ok' };
    else if (r.state === 'damaged') verifyState[id] = { text: t('set.verify.bad', { n: r.bad.length }) + ' ' + t('set.repair.note'), cls: 'warn', repair: true };
    else verifyState[id] = { text: t('set.verify.none') + ' ' + t('set.repair.note'), cls: 'warn', repair: true };
  } catch (e) { verifyState[id] = { text: errText(String(e)), cls: 'warn' }; }
  delete progress[id];
  renderAll();
}

/* ---------- запуск ---------- */
function initLinuxResize() {
  if (S.platform !== 'linux') return;
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

async function boot() {
  $('#btnOpen').addEventListener('click', () => invoke('open_folder', { game: S.installed[sel] ? sel : null }).catch((e) => { errors[sel] = String(e); renderStage(); }));
  await listen('install-progress', (e) => {
    const p = e.payload;
    if (['done', 'cancelled'].includes(p.phase)) { delete progress[p.game]; renderAll(); return; }
    progress[p.game] = p;
    if (p.game === sel) { if ($('#progress').hidden) renderStage(); else updateProgress(); }
  });

  await refreshState();
  const startLang = S.lang || ((navigator.language || 'ru').toLowerCase().startsWith('ru') ? 'ru' : 'en');
  await loadLang(startLang);
  initLinuxResize();
  syncMax();
  renderAll();
  await appWin.show();
  document.body.classList.add('ready');

  // заставка 2,6 секунды, клик пропускает; с отключёнными анимациями её нет
  const splash = $('#splash');
  const hide = () => { splash.classList.add('gone'); setTimeout(() => splash.remove(), 600); };
  if (document.body.classList.contains('no-anim')) splash.remove();
  else { splash.addEventListener('click', hide); setTimeout(hide, 2600); }

  await refreshRemote();
  await refreshState();
  renderAll();
  autoUpdateGames();
}
boot().catch((e) => { document.body.classList.add('ready'); console.error(e); });
