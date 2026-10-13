/* Minimal statisk server för prototypen: `npm start`, sedan http://127.0.0.1:8765/match.html
   ES-moduler kan inte laddas via file://, därför behövs en server. Inga beroenden.
   Onlinespelets server (online/server.js) återanvänder serveFile för lokal provkörning. */
import { createServer } from 'node:http';
import { createReadStream, statSync, realpathSync } from 'node:fs';
import { extname, join, posix, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PORT = Number(process.env.PORT) || 8765;
export const ROOT = fileURLToPath(new URL('.', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8' };

/* Serverkod, tester och Git-data ska inte gå att hämta som statiska filer, inte ens lokalt.
   I drift publicerar deploy.sh bara den uttryckliga klientfillistan. */
const CLIENT_FILES = new Set(`spelbord.html match.html textkort.html effekter.html lobby.html
spelbord.css match.css bildeffekter.css effektverkstad.css tokens.css grafik.css popup.css lobby.css
spelbord.js kort.js strid.js matchregler.js match.js matchvy.js dator.js lobby.js
bildeffekter.js kortoversikt.js effektverkstad.js grafik.js popup.js ljud.js
kontrakt.js lokalmatch.js onlinematch.js LICENSE`.split(/\s+/));
const canonicalPath = path => posix.normalize('/' + path.replace(/^\/+/, ''));
export const isBlocked = path => {
  const canonical = canonicalPath(path);
  return !CLIENT_FILES.has(canonical.slice(1)) && !/^\/assets\/(?!.*(?:^|\/)\.)[^\\\0]+\.(?:svg|png|jpe?g|webp|gif|ico|mp3|wav|ogg|woff2?)$/i.test(canonical);
};

export function serveFile(req, res) {
  let path;
  try { path = canonicalPath(decodeURIComponent(new URL(req.url, 'http://x').pathname)); }
  catch { res.writeHead(400).end('400'); return; }
  // Ingen separat flikikon finns i prototypen; webbläsarens automatiska anrop är ändå giltigt.
  if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
  if (path === '/') path = '/match.html';
  if (isBlocked(path)) { res.writeHead(404).end('404'); return; }
  let file, stat;
  try {
    file = realpathSync(join(ROOT, path));
    const resolved = relative(realpathSync(ROOT), file);
    if (resolved.startsWith('..') || isAbsolute(resolved) || isBlocked('/' + resolved)) { res.writeHead(404).end('404'); return; }
    stat = statSync(file);
  } catch { res.writeHead(404).end('404'); return; }
  if (!stat.isFile()) { res.writeHead(404).end('404'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer(serveFile).listen(PORT, '127.0.0.1', () => console.log(`Tornstriden: http://127.0.0.1:${PORT}/match.html  (Ctrl+C avslutar)`));
}
