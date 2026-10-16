/* Klientfilerna (arbetsordning L15, L21): varje fil som en sida laddar – direkt eller via import – måste släppas
   igenom av utvecklingsservern, och för de publicerade sidorna även finnas i deploy.sh. Annars fungerar
   sidan lokalt men får 404 efter nästa publicering. Sedan L21 publiceras även onlinesidorna (lobbyn och
   lagmatchen); serverkoden och lagmotorn får aldrig hamna i listan. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isBlocked } from './server.js';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const deploy = new Set(read('deploy.sh').match(/\nfiles=\(([\s\S]*?)\n\)/)[1].split(/\s+/).filter(Boolean));

/* Sidan och allt den laddar: script/link i HTML och `from './x.js'` i moduler, rekursivt. */
function beroenden(start) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = read(file);
    const refs = file.endsWith('.html')
      ? [...text.matchAll(/(?:src|href)="([A-Za-z0-9_-]+\.(?:js|css))"/g)].map(m => m[1])
      : file.endsWith('.js') ? [...text.matchAll(/from '\.\/([A-Za-z0-9_-]+\.js)'/g)].map(m => m[1]) : [];
    queue.push(...refs);
  }
  return [...seen];
}

test('Publicerade sidor laddar bara filer som finns i deploy.sh och släpps igenom av servern', () => {
  const sidor = [...deploy].filter(f => f.endsWith('.html'));
  for (const sida of ['match.html', 'lobby.html', 'lagmatch.html']) assert.ok(sidor.includes(sida), `${sida} publiceras`);
  for (const fil of deploy) assert.ok(!/^online\//.test(fil) && !/\.test\.js$/.test(fil) && !['lagmatch.js', 'lagkortlek.js', 'lagstrid.js', 'lagvy.js', 'teststod.js', 'server.js', 'preview.js', 'deploy.sh', 'package.json'].includes(fil), `${fil} ska inte publiceras`);
  for (const fil of deploy) assert.ok(!fil.includes('/'), `${fil}: deploy.sh stämplar bara filer i rotkatalogen (assets kopieras separat)`);
  for (const sida of sidor) for (const fil of beroenden(sida)) {
    assert.ok(deploy.has(fil), `${sida} laddar ${fil}, som saknas i deploy.sh`);
    assert.ok(!isBlocked(`/${fil}`), `${sida} laddar ${fil}, som servern spärrar`);
  }
});

test('Onlinesidorna laddar bara filer som utvecklingsservern släpper igenom, aldrig lagmotorn eller serverkod', () => {
  for (const sida of ['lobby.html', 'lagmatch.html']) {
    const filer = beroenden(sida);
    for (const fil of filer) assert.ok(!isBlocked(`/${fil}`), `${sida} laddar ${fil}, som servern spärrar`);
    for (const motor of ['lagmatch.js', 'lagkortlek.js', 'lagstrid.js', 'lagvy.js', 'teststod.js']) assert.ok(!filer.includes(motor), `${sida} ska inte ladda ${motor}`);
  }
  assert.ok(beroenden('lagmatch.html').includes('kortlupp.js') && beroenden('match.html').includes('kortlupp.js'), 'långtrycket delas av duellen och lagvyn');
});
