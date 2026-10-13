/* Minimal statisk server för prototypen: `npm start`, sedan http://127.0.0.1:8765/match.html
   ES-moduler kan inte laddas via file://, därför behövs en server. Inga beroenden.
   Onlinespelets server (online/server.js) återanvänder serveFile för lokal provkörning. */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PORT = Number(process.env.PORT) || 8765;
export const ROOT = fileURLToPath(new URL('.', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8' };

/* Serverkod, tester och Git-data ska inte gå att hämta som statiska filer, inte ens lokalt.
   I drift publicerar deploy.sh bara den uttryckliga klientfillistan. */
const BLOCKED = [/^\/online(\/|$)/, /^\/node_modules(\/|$)/, /^\/\.git(\/|$)/, /^\/scripts(\/|$)/, /\.test\.js$/, /^\/teststod\.js$/, /^\/deploy\.sh$/, /^\/package\.json$/];
export const isBlocked = path => BLOCKED.some(pattern => pattern.test(path));

export function serveFile(req, res) {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (isBlocked(path)) { res.writeHead(404).end('404'); return; }
  const file = join(ROOT, normalize(path === '/' ? '/match.html' : path).replace(/^(\.\.[/\\])+/, ''));
  let stat;
  try { stat = statSync(file); } catch { res.writeHead(404).end('404'); return; }
  if (!stat.isFile()) { res.writeHead(404).end('404'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer(serveFile).listen(PORT, '127.0.0.1', () => console.log(`Tornstriden: http://127.0.0.1:${PORT}/match.html  (Ctrl+C avslutar)`));
}
