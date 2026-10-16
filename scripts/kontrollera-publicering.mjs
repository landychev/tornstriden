#!/usr/bin/env node
/* Kontroll av en publiceringskopia (arbetsordning L21): `node scripts/kontrollera-publicering.mjs KATALOG`
   efter `./deploy.sh KATALOG`. Kopian ska gå att öppna utan saknade filer, varje referens till skript, stilmall,
   modul och asset ska vara versionsstämplad (?v=…), och serverkod, lagmotor, tester, databas och Git-data får inte
   finnas där. Avslutar med kod 1 och en lista över fel om något brister.
   Med --servera öppnas kopian dessutom på en lokal port och varje sida hämtas med sina beroenden över HTTP, som en
   webbläsare skulle göra (utan Apache-proxy: /api/ ingår inte i kontrollen). */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, relative, resolve, sep } from 'node:path';
import { skapaFilserver } from '../server.js';

const args = process.argv.slice(2);
const servera = args.includes('--servera');
const katalog = resolve(args.find(a => !a.startsWith('--')) ?? '');
if (!args.some(a => !a.startsWith('--')) || !existsSync(katalog)) { console.error('Ange publiceringskopians katalog.'); process.exit(2); }

const fel = [];
const filer = [];
(function ga(dir) { for (const namn of readdirSync(dir)) { const p = join(dir, namn); if (statSync(p).isDirectory()) ga(p); else filer.push(relative(katalog, p).split(sep).join('/')); } })(katalog);

/* 1. Förbjudet innehåll. */
const forbjudet = f => f.startsWith('online/') || f.startsWith('.git') || f.startsWith('node_modules/') || f.startsWith('scripts/') || f.startsWith('drift/') || f.startsWith('apache/')
  || /\.test\.js$/.test(f) || /\.sqlite/.test(f) || /\.(md|py|sh|json|mjs|env)$/.test(f) && f !== 'LICENSE'
  || ['lagmatch.js', 'lagkortlek.js', 'lagstrid.js', 'lagvy.js', 'teststod.js', 'server.js', 'preview.js', 'deploy.sh', 'package.json', 'package-lock.json', '.DS_Store'].includes(f);
for (const f of filer) if (forbjudet(f)) fel.push(`får inte publiceras: ${f}`);

/* 2. Sidorna finns, och varje referens pekar på en fil i kopian med versionsstämpel. */
for (const sida of ['index.html', 'match.html', 'lobby.html', 'lagmatch.html', 'spelbord.html']) if (!filer.includes(sida)) fel.push(`sidan saknas: ${sida}`);
const refs = text => [
  ...[...text.matchAll(/(?:src|href)="([^"#?]+\.(?:js|css|png|jpg|jpeg|svg|mp3|wav|ogg|woff2?))(\?v=[^"#]*)?(?:#[^"]*)?"/g)].map(m => ({ ref: m[1], stamp: m[2] })),
  ...[...text.matchAll(/from '\.\/([^'?]+\.js)(\?v=[^']*)?'/g)].map(m => ({ ref: m[1], stamp: m[2] })),
  ...[...text.matchAll(/import\('\.\/([^'?]+\.js)(\?v=[^']*)?'\)/g)].map(m => ({ ref: m[1], stamp: m[2] })),
  ...[...text.matchAll(/(assets\/[^"'`)#\s?]+)(\?v=[^"'`)#\s]*)?/g)].map(m => ({ ref: m[1], stamp: m[2] }))
];
const version = new Set();
for (const f of filer.filter(f => /\.(html|css|js)$/.test(f))) {
  const text = readFileSync(join(katalog, f), 'utf8');
  for (const { ref, stamp } of refs(text)) {
    if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:')) continue;
    const mal = ref.startsWith('/') ? ref.slice(1) : ref;
    if (mal.includes('${')) {   // dynamisk adress (t.ex. assets/kort/${card.id}.jpg): katalogen ska finnas och ha filer
      const dir = mal.slice(0, mal.indexOf('${')).replace(/[^/]*$/, '');
      if (!filer.some(x => x.startsWith(dir))) fel.push(`${f} pekar på ${ref}, men katalogen ${dir} saknas i kopian`);
    } else if (!filer.includes(mal)) fel.push(`${f} pekar på ${ref}, som saknas i kopian`);
    if (!stamp) fel.push(`${f} refererar ${ref} utan versionsstämpel (?v=)`); else version.add(stamp);
  }
}
if (version.size > 1) fel.push(`blandade versionsstämplar: ${[...version].join(' ')}`);

/* 3. Valfritt: hämta sidorna över HTTP från kopian. */
if (servera && !fel.length) {
  const server = createServer(skapaFilserver(katalog));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = p => `http://127.0.0.1:${server.address().port}/${p}`;
  for (const sida of ['index.html', 'match.html', 'lobby.html', 'lagmatch.html', 'spelbord.html']) {
    const svar = await fetch(url(sida === 'index.html' ? '' : sida));   // utvecklingsservern visar matchen på /, som Apache visar index.html
    if (svar.status !== 200) { fel.push(`HTTP ${svar.status} för ${sida}`); continue; }
    for (const { ref, stamp } of refs(await svar.text())) {
      if (ref.includes('${')) continue;
      const r = await fetch(url(`${ref}${stamp ?? ''}`));
      if (r.status !== 200) fel.push(`HTTP ${r.status} för ${ref} (från ${sida})`);
    }
  }
  server.close();
}

if (fel.length) { console.error(`Publiceringskopian ${katalog} har ${fel.length} fel:`); for (const f of fel) console.error(`  - ${f}`); process.exit(1); }
console.log(`Publiceringskopian ${katalog} är hel: ${filer.length} filer, version ${[...version][0] ?? '(ingen stämpel)'}, inga serverfiler.`);
