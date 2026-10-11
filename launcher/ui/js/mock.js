// Заглушка Tauri для просмотра интерфейса в обычном браузере (npm run preview). В самом лаунчере не используется.
// Параметры в адресе: ?offline=1 (нет связи), ?fail=net или ?fail=hash (ошибка установки), ?installed=1, ?linux=1.
const q = new URLSearchParams(location.search);
const handlers = {};
const state = {
  platform: q.get('linux') ? 'linux' : 'windows',
  app_version: '0.1.0',
  lang: null,
  install_dir: q.get('linux') ? '/home/user/.local/share/ru.shozit.launcher/games' : 'C:\\Users\\Player\\AppData\\Local\\ru.shozit.launcher\\games',
  installed: q.get('installed') ? { rigged: { version: '0.0.9', dir: 'C:\\Games\\rigged', exe: 'RIGGED.exe' } } : {},
  busy: [],
};
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
  app_state: async () => ({ ...state }),
  set_lang: async ({ lang }) => { state.lang = lang; },
  set_install_dir: async ({ path }) => { state.install_dir = path; return path; },
  refresh_remote: async () => { await sleep(500); return q.get('offline') ? { online: false, source: '', manifest: null, news: null } : { online: true, source: 'mock', manifest, news }; },
  cancel_install: async () => { cancelled = true; },
  open_folder: async () => {},
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
    state.installed[game] = { version: manifest.games[game].version, dir: state.install_dir + '\\' + game, exe: 'game.exe' };
    emit('install-progress', { game, phase: 'done', received: 0, total: 0, speed: 0 });
  },
};

window.__TAURI__ = {
  core: { invoke: (cmd, args) => (commands[cmd] ? commands[cmd](args || {}) : Promise.reject('unknown command ' + cmd)) },
  event: { listen: async (name, cb) => { (handlers[name] ||= []).push(cb); return () => {}; } },
  window: { getCurrentWindow: () => ({ show: async () => {}, minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {}, isMaximized: async () => false, startResizeDragging: async () => {} }) },
  dialog: { open: async () => 'D:\\Games' },
};
