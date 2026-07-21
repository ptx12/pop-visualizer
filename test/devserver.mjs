import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { join, normalize, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.pop': 'text/plain; charset=latin1',
  '.json': 'application/json'
};

createServer(async (req, res) => {
  try {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/') url = '/renderer/index.html';
    const file = normalize(join(root, url));
    if (!file.startsWith(normalize(root))) { res.writeHead(403); res.end(); return; }
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not file');
    if (req.method === 'HEAD') { res.writeHead(200); res.end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('404');
  }
}).listen(5317, () => console.log('devserver on http://localhost:5317'));
