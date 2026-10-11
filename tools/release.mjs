// Подготовка релиза: пакует игру в zip (или берёт готовые файлы лаунчера), считает SHA-256 и размер
// и сам обновляет site/version.json.
//
//   node tools/release.mjs game <rigged|deep-roll> <версия> <папка-windows> <папка-linux>
//   node tools/release.mjs launcher <версия> <файл-для-windows> <файл-для-linux>
//
// Игру нужно собрать (экспорт Godot) заранее: в каждой папке лежит всё, что должно оказаться
// у игрока, включая исполняемый файл. Архивы появятся в test-builds/ (она в .gitignore).
// Их загружают в релиз GitHub, а version.json публикуют вместе с сайтом.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_JSON = join(ROOT, 'site', 'version.json');
const OWNER = 'shoz1t';
const REPO = { rigged: 'rigged', 'deep-roll': 'deep-roll' };
const PREFIX = { rigged: 'RIGGED', 'deep-roll': 'DeepRoll' };

const die = (m) => { console.error('Ошибка: ' + m); process.exit(1); };
const sha256 = (file) => new Promise((ok, bad) => { const h = createHash('sha256'); createReadStream(file).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', bad); });

function zipFolder(dir, out) {
  if (existsSync(out)) rmSync(out);
  if (process.platform === 'win32') {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${join(dir, '*')}' -DestinationPath '${out}' -CompressionLevel Optimal`], { stdio: 'inherit' });
    if (r.status !== 0) die('не удалось создать архив ' + out);
  } else {
    const r = spawnSync('zip', ['-r', '-q', out, '.'], { cwd: dir, stdio: 'inherit' });
    if (r.status !== 0) die('нужна команда zip, не удалось создать ' + out);
  }
}

const [kind, ...args] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(VERSION_JSON, 'utf8').replace(/^﻿/, ''));
const today = new Date().toISOString().slice(0, 10);

if (kind === 'game') {
  const [game, version, winDir, linDir] = args;
  if (!REPO[game] || !version || !winDir || !linDir) die('формат: game <rigged|deep-roll> <версия> <папка-windows> <папка-linux>');
  const node = manifest.games[game];
  mkdirSync(join(ROOT, 'test-builds'), { recursive: true });
  for (const [os, dir] of [['windows', winDir], ['linux', linDir]]) {
    const abs = resolve(dir);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) die('нет папки ' + abs);
    if (!existsSync(join(abs, node.executable[os]))) die(`в ${abs} нет файла ${node.executable[os]}`);
    const name = `${PREFIX[game]}-v${version}-${os}.zip`;
    const out = join(ROOT, 'test-builds', name);
    zipFolder(abs, out);
    node.downloads[os] = { url: `https://github.com/${OWNER}/${REPO[game]}/releases/download/v${version}/${name}`, sha256: await sha256(out), size: statSync(out).size };
    console.log(`${name}: ${node.downloads[os].size} байт, ${node.downloads[os].sha256}`);
  }
  node.version = version;
  console.log(`\nДальше: загрузи оба архива из test-builds/ в релиз v${version} репозитория ${OWNER}/${REPO[game]}.`);
} else if (kind === 'launcher') {
  const [version, win, lin] = args;
  if (!version || !win || !lin) die('формат: launcher <версия> <файл-windows> <файл-linux>');
  for (const [os, file] of [['windows', win], ['linux', lin]]) {
    const abs = resolve(file);
    if (!existsSync(abs)) die('нет файла ' + abs);
    manifest.launcher.downloads[os] = { url: `https://github.com/${OWNER}/shozit-site/releases/download/launcher-v${version}/${basename(abs)}`, sha256: await sha256(abs), size: statSync(abs).size };
    console.log(`${basename(abs)}: ${manifest.launcher.downloads[os].size} байт, ${manifest.launcher.downloads[os].sha256}`);
  }
  manifest.launcher.version = version;
} else die('первый аргумент: game или launcher');

manifest.updated = today;
writeFileSync(VERSION_JSON, JSON.stringify(manifest, null, 2) + '\n');
console.log('\nsite/version.json обновлён. Закоммить и отправь сайт, чтобы кнопки и лаунчер увидели новую версию.');
