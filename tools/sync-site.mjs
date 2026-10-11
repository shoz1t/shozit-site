// Синхронизация сайта. Запуск: node tools/sync-site.mjs
// 1) Вписывает русские тексты из site/i18n/ru.json в HTML (в элементы с data-i18n и атрибуты из data-i18n-attr).
//    Так страница читается без JavaScript и в превью соцсетей, а ru.json остаётся единственным источником.
// 2) Подставляет адрес сайта из site/site.json в элементы с data-abs ("атрибут:/путь").
// 3) Проверяет, что в en.json есть все ключи из ru.json, и пишет robots.txt и sitemap.xml.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const ru = JSON.parse(readFileSync(join(SITE, 'i18n', 'ru.json'), 'utf8'));
const en = JSON.parse(readFileSync(join(SITE, 'i18n', 'en.json'), 'utf8'));
const siteUrl = JSON.parse(readFileSync(join(SITE, 'site.json'), 'utf8')).siteUrl.replace(/\/$/, '');

const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'assets') walk(p, out); }
    else if (n.endsWith('.html')) out.push(p);
  }
  return out;
}

function setAttr(attrs, name, value) {
  const re = new RegExp(`(\\s${name}=)"[^"]*"`);
  return re.test(attrs) ? attrs.replace(re, `$1"${escAttr(value)}"`) : `${attrs} ${name}="${escAttr(value)}"`;
}

const errors = [];
const used = new Set();
const pages = [];

for (const file of walk(SITE)) {
  let html = readFileSync(file, 'utf8');
  const rel = relative(SITE, file);

  // атрибуты
  html = html.replace(/<([a-zA-Z][\w-]*)(\s[^>]*?)(\/?)>/g, (m, tag, attrs, slash) => {
    let a = attrs;
    const ia = /\sdata-i18n-attr="([^"]+)"/.exec(a);
    if (ia) for (const pair of ia[1].split(';')) {
      const i = pair.indexOf(':');
      const k = pair.slice(i + 1);
      used.add(k);
      if (ru[k] === undefined) errors.push(`${rel}: нет ключа ${k}`);
      else a = setAttr(a, pair.slice(0, i), ru[k]);
    }
    const ab = /\sdata-abs="([^"]+)"/.exec(a);
    if (ab) for (const pair of ab[1].split(';')) {
      const i = pair.indexOf(':');
      a = setAttr(a, pair.slice(0, i), siteUrl + pair.slice(i + 1));
    }
    return `<${tag}${a}${slash}>`;
  });

  // тексты
  html = html.replace(/(<([a-zA-Z][\w-]*)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (m, open, tag, key, _old, close) => {
    used.add(key);
    if (ru[key] === undefined) { errors.push(`${rel}: нет ключа ${key}`); return m; }
    return open + escText(ru[key]) + close;
  });

  writeFileSync(file, html, 'utf8');
  pages.push(rel.replace(/index\.html$/, '').replace(/\\/g, '/'));
}

for (const k of Object.keys(ru)) if (en[k] === undefined) errors.push(`en.json: нет ключа ${k}`);
for (const k of Object.keys(en)) if (ru[k] === undefined) errors.push(`ru.json: нет ключа ${k}`);
const unused = Object.keys(ru).filter((k) => !used.has(k));

const urls = pages.filter((p) => p !== '404.html');
writeFileSync(join(SITE, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((p) => `  <url><loc>${siteUrl}/${p}</loc></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(join(SITE, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`);

console.log(`Страницы: ${pages.join(', ')}`);
console.log(`Адрес сайта: ${siteUrl}`);
if (unused.length) console.log(`Ключи без использования в HTML (${unused.length}): ${unused.join(', ')}`);
if (errors.length) { console.error('ОШИБКИ:\n' + errors.join('\n')); process.exit(1); }
console.log('Готово.');
