#!/usr/bin/env node
/* Säkerhetskopia av onlineserverns databas (arbetsordning L21). Använder SQLites egen backup-funktion via
   node:sqlite, så kopian är konsekvent även medan tjänsten kör (WAL-läge) – ingen sqlite3-binär behövs.
     node drift/sakerhetskopia.mjs [--data KATALOG] [--till KATALOG] [--behall N]
   Standard: databasen i TORNSTRIDEN_DATA_DIR (annars ../tornstriden-data bredvid utcheckningen), kopior i
   <data>/sakerhetskopior/tornstriden-ÅÅÅÅMMDD-HHMMSS.sqlite, de 14 senaste behålls.
   Körs av drift/uppdatera.sh före varje uppdatering, annars för hand (eller dagligen via `installera.sh --cron`).
   Återställning: se DRIFT.md (stoppa tjänsten, byt ut tornstriden.sqlite, starta). */
import { backup, DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flagga = (namn, standard) => { const i = args.indexOf(namn); return i === -1 ? standard : args[i + 1]; };
const rot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(flagga('--data', process.env.TORNSTRIDEN_DATA_DIR || join(rot, '..', 'tornstriden-data')));
const malDir = resolve(flagga('--till', join(dataDir, 'sakerhetskopior')));
const behall = Number(flagga('--behall', 14));
const kalla = join(dataDir, 'tornstriden.sqlite');

if (!existsSync(kalla)) { console.error(`Ingen databas att kopiera: ${kalla}`); process.exit(1); }
mkdirSync(malDir, { recursive: true, mode: 0o700 });
const stampel = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const mal = join(malDir, `tornstriden-${stampel}.sqlite`);

const db = new DatabaseSync(kalla, { readOnly: true });
try {
  await backup(db, mal);
} finally { db.close(); }
/* Kopian blir en enda fil (inte WAL-läge med -wal/-shm bredvid) och kontrolleras: den går att öppna och har en schemaversion. */
const kopia = new DatabaseSync(mal);
kopia.exec('PRAGMA journal_mode = DELETE');
const version = kopia.prepare("SELECT varde FROM meta WHERE nyckel = 'schemaversion'").get()?.varde ?? '?';
const matcher = kopia.prepare('SELECT COUNT(*) AS n FROM matcher').get().n;
kopia.close();
console.log(`${new Date().toISOString()} kopia ${mal} (${statSync(mal).size} byte, schemaversion ${version}, ${matcher} matcher)`);

/* Gallring: behåll de N senaste. */
const gamla = readdirSync(malDir).filter(f => /^tornstriden-\d{8}-\d{6}\.sqlite$/.test(f)).sort().slice(0, -behall);
for (const f of gamla) {
  for (const fil of [f, `${f}-wal`, `${f}-shm`]) if (existsSync(join(malDir, fil))) unlinkSync(join(malDir, fil));
  console.log(`gallrad ${f}`);
}
