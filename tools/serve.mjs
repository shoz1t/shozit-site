// Мини-сервер для локального просмотра. Запуск: node tools/serve.mjs [папка] [порт] [save]
// С третьим аргументом save принимает POST /__save/<имя> (нужно для tools/bake*.html):
// .webm пишется в site/assets/video/, остальное в site/assets/img/.
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || 5173);
const allowSave = process.argv[4] === 'save';
const here = dirname(fileURLToPath(import.meta.url));
const imgDir = join(here, '..', 'site', 'assets', 'img');
const videoDir = join(here, '..', 'site', 'assets', 'video');
const framesDir = join(here, '..', 'design', 'frames');
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.webm': 'video/webm', '.mp4': 'video/mp4',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && allowSave && url.pathname.startsWith('/__save/')) {
      const name = decodeURIComponent(url.pathname.slice(8));
      if (!/^[a-z0-9._-]+$/i.test(name)) throw new Error('bad name');
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const dir = /^frame-\d+\.jpg$/.test(name) ? framesDir : name.endsWith('.webm') ? videoDir : imgDir;
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, name), Buffer.concat(chunks));
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('saved ' + name);
    }
    const p = normalize(decodeURIComponent(url.pathname));
    let file = join(root, p);
    if (!file.startsWith(root)) throw new Error('out');
    const s = await stat(file).catch(() => null);
    if (s?.isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    const type = types[extname(file)] || 'application/octet-stream';
    // Range нужен браузеру для видео
    const range = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = Number(range[1]), end = range[2] ? Number(range[2]) : data.length - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-store' });
      return res.end(data.subarray(start, end + 1));
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404');
  }
}).listen(port, () => console.log(`http://localhost:${port}  (${root})`));
