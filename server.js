/* Minimal statisk server för prototypen: `npm start`, sedan http://127.0.0.1:8765/match.html
   ES-moduler kan inte laddas via file://, därför behövs en server. Inga beroenden. */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 8765;
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8' };

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(ROOT, normalize(path === '/' ? '/match.html' : path).replace(/^(\.\.[/\\])+/, ''));
  let stat;
  try { stat = statSync(file); } catch { res.writeHead(404).end('404'); return; }
  if (!stat.isFile()) { res.writeHead(404).end('404'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`Tornstriden: http://127.0.0.1:${PORT}/match.html  (Ctrl+C avslutar)`));
