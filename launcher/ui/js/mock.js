// Заглушка Tauri для просмотра интерфейса в обычном браузере (npm run preview). В самом лаунчере не используется.
// Параметры в адресе: ?offline=1 (нет связи), ?fail=net или ?fail=hash (ошибка установки), ?installed=1, ?linux=1, ?bad=1 (проверка находит повреждения).
const q = new URLSearchParams(location.search);
const handlers = {};
const sep = q.get('linux') ? '/' : '\\';
const base = q.get('linux') ? '/home/user/.local/share/ru.shozit.launcher/games' : 'C:\\Users\\Player\\AppData\\Local\\ru.shozit.launcher\\games';
const state = {
  platform: q.get('linux') ? 'linux' : 'windows',
  app_version: '0.1.0',
  lang: null,
  install_dir: base,
  per_game_dirs: false,
  game_dirs: {},
  auto_update_games: false,
  auto_update_launcher: true,
  after_launch: 'keep',
  reduce_animations: null,
  installed: q.get('installed') ? { rigged: { version: '0.0.9', dir: base + sep + 'rigged', exe: 'RIGGED.exe' } } : {},
  busy: [],
  log_path: base + sep + 'logs' + sep + 'launcher.log',
};
const rootFor = (g) => (state.per_game_dirs && state.game_dirs[g]) || state.install_dir;
const dirs = () => ({ rigged: rootFor('rigged'), 'deep-roll': rootFor('deep-roll') });
const dl = (name, size) => ({ url: `https://example.invalid/${name}`, sha256: 'a'.repeat(64), size });
const manifest = {
  launcher: { version: '0.2.0', downloads: { windows: { url: 'https://github.com/shoz1t/shozit-site/releases/latest' } } },
  games: {
    rigged: { name: 'Rigged', version: '0.1.0', frozen: false, downloads: { windows: dl('r-win.zip', 56899290), linux: dl('r-lin.zip', 50889370) } },
    'deep-roll': { name: 'Deep Roll', version: '0.1.0', frozen: true, downloads: { windows: dl('d-win.zip', 118686857), linux: dl('d-lin.zip', 109000717) } },
  },
};
const news = { items: [
  { date: '2026-10-06', title: { ru: 'RIGGED: играбельное демо скоро', en: 'RIGGED: a playable demo is coming soon' }, url: 'https://t.me/shozitdev/10' },
  { date: '2026-09-27', title: { ru: 'Новый проект: RIGGED', en: 'A new project: RIGGED' }, url: 'https://t.me/shozitdev/9' },
  { date: '2026-09-27', title: { ru: 'Deep Roll заморожена', en: 'Deep Roll is frozen' }, url: 'https://t.me/shozitdev/6' },
] };
const emit = (name, payload) => (handlers[name] || []).forEach((h) => h({ payload }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cancelled = false;

const commands = {
  app_state: async () => ({ ...state, install_dir: state.install_dir, dirs: dirs() }),
  update_settings: async ({ patch }) => { Object.assign(state, patch); },
  check_dir: async () => ({ writable: true, free: 148 * 1073741824, error: null }),
  set_dir: async ({ game, path }) => {
    if (game) state.game_dirs[game] = path; else state.install_dir = path;
    const affected = Object.entries(state.installed).filter(([g, i]) => (!game || game === g) && i.dir !== rootFor(g) + sep + g).map(([g]) => g);
    return { check: { writable: true, free: 2 * 1073741824 }, affected };
  },
  move_game: async ({ game }) => { emit('install-progress', { game, phase: 'move', received: 0, total: 0, speed: 0 }); await sleep(1200); state.installed[game].dir = rootFor(game) + sep + game; emit('install-progress', { game, phase: 'done', received: 0, total: 0, speed: 0 }); },
  verify_game: async ({ game }) => {
    for (let i = 1; i <= 10; i++) { await sleep(80); emit('install-progress', { game, phase: 'verify', received: i, total: 10, speed: 0 }); }
    emit('install-progress', { game, phase: 'done', received: 0, total: 0, speed: 0 });
    return q.get('bad') ? { state: 'damaged', bad: ['RIGGED.pck'], checked: 4 } : { state: 'ok', bad: [], checked: 4 };
  },
  refresh_remote: async () => { await sleep(500); return q.get('offline') ? { online: false, source: '', manifest: null, news: null } : { online: true, source: 'mock', manifest, news }; },
  cancel_install: async () => { cancelled = true; },
  open_folder: async () => {},
  open_log: async () => {},
  open_url: async () => {},
  launch_game: async () => { await sleep(200); },
  uninstall_game: async ({ game }) => { delete state.installed[game]; },
  install_game: async ({ game }) => {
    cancelled = false;
    const total = manifest.games[game].downloads[state.platform].size;
    let got = 0;
    while (got < total) {
      await sleep(80);
      if (cancelled) { emit('install-progress', { game, phase: 'cancelled', received: 0, total, speed: 0 }); throw 'cancelled'; }
      got = Math.min(total, got + total / 90);
      emit('install-progress', { game, phase: 'download', received: got, total, speed: 14.2 * 1048576 });
      if (q.get('fail') === 'net' && got > total * 0.4) throw 'network|connection reset';
    }
    for (const [ph, ms] of [['verify', 900], ['extract', 900]]) { for (let i = 0; i <= 10; i++) { await sleep(ms / 10); emit('install-progress', { game, phase: ph, received: i, total: 10, speed: 0 }); } if (q.get('fail') === 'hash' && ph === 'verify') throw 'hash_mismatch'; }
    state.installed[game] = { version: manifest.games[game].version, dir: rootFor(game) + sep + game, exe: 'game.exe' };
    emit('install-progress', { game, phase: 'done', received: 0, total: 0, speed: 0 });
  },
};

window.__TAURI__ = {
  core: { invoke: (cmd, args) => (commands[cmd] ? commands[cmd](args || {}) : Promise.reject('unknown command ' + cmd)) },
  event: { listen: async (name, cb) => { (handlers[name] ||= []).push(cb); return () => {}; } },
  window: { getCurrentWindow: () => ({ show: async () => {}, minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {}, destroy: async () => {}, isMaximized: async () => false, startResizeDragging: async () => {} }) },
  dialog: { open: async () => (q.get('linux') ? '/mnt/games' : 'D:\\Games') },
};
