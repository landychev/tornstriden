/* Beständig lagring för onlinespelet (arbetsordning L02). Inbyggt node:sqlite, inga npm-beroenden.
   Databasen ligger utanför webbroten (se server.js i samma katalog). Allt som hör ihop – matchläge,
   händelser och kvittens – sparas i samma transaktion via transaktion(); ett fel rullar tillbaka allt.
   Tabellerna lagrar JSON-text för objekten; kolumner finns bara för det som söks på. */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MATCH_STATUS } from '../kontrakt.js';

/* Migreringar körs i ordning; versionen sparas i meta. Lägg nya steg sist, ändra aldrig gamla. */
export const MIGRERINGAR = Object.freeze([
  `CREATE TABLE meta (nyckel TEXT PRIMARY KEY, varde TEXT NOT NULL);
   CREATE TABLE matcher (
     id TEXT PRIMARY KEY, status TEXT NOT NULL, revision INTEGER NOT NULL,
     rules_version TEXT NOT NULL, deck_version TEXT NOT NULL, state TEXT NOT NULL,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE INDEX matcher_status ON matcher (status);
   CREATE TABLE handelser (
     match_id TEXT NOT NULL REFERENCES matcher (id), event_id INTEGER NOT NULL, revision INTEGER NOT NULL,
     typ TEXT NOT NULL, at INTEGER NOT NULL, recipient TEXT, data TEXT NOT NULL,
     PRIMARY KEY (match_id, event_id));
   CREATE TABLE kvittenser (
     player_id TEXT NOT NULL, scope TEXT NOT NULL, command_id TEXT NOT NULL,
     fingerprint TEXT NOT NULL, receipt TEXT NOT NULL, created_at INTEGER NOT NULL,
     PRIMARY KEY (player_id, scope, command_id));`,
  /* L03: gästsessioner. Endast hash av token lagras; nick_key är unikt bland sparade sessioner
     (utgångna sessioner gallras innan ett nick prövas). */
  `CREATE TABLE sessioner (
     player_id TEXT PRIMARY KEY, nick TEXT NOT NULL, nick_key TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
     activity TEXT NOT NULL, connection TEXT NOT NULL, room_id TEXT, match_id TEXT, connection_generation INTEGER NOT NULL);
   CREATE INDEX sessioner_expires ON sessioner (expires_at);`,
  /* L04: förberedelserum (hela rummet som JSON, kolumner för sökning) och inbjudningar. */
  `CREATE TABLE rum (
     id TEXT PRIMARY KEY, status TEXT NOT NULL, host_player_id TEXT NOT NULL, room_revision INTEGER NOT NULL,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, state TEXT NOT NULL);
   CREATE INDEX rum_status ON rum (status, updated_at);
   CREATE TABLE inbjudningar (
     id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rum (id), from_player_id TEXT NOT NULL, to_player_id TEXT NOT NULL,
     status TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE INDEX inbjudningar_to ON inbjudningar (to_player_id, status);
   CREATE INDEX inbjudningar_room ON inbjudningar (room_id, status);`
]);
export const SCHEMAVERSION = MIGRERINGAR.length;

export class LagringsFel extends Error {}

const INVITATION_SELECT = 'SELECT id, room_id, from_player_id, to_player_id, status, created_at, expires_at, updated_at FROM inbjudningar';
const inbjudanRad = row => row ? ({ id: row.id, roomId: row.room_id, fromPlayerId: row.from_player_id, toPlayerId: row.to_player_id, status: row.status, createdAt: row.created_at, expiresAt: row.expires_at, updatedAt: row.updated_at }) : null;
const SESSION_SELECT = 'SELECT player_id, nick, nick_key, token_hash, created_at, last_seen_at, expires_at, activity, connection, room_id, match_id, connection_generation FROM sessioner';
const sessionRad = row => row ? ({
  playerId: row.player_id, nick: row.nick, nickKey: row.nick_key, tokenHash: row.token_hash, createdAt: row.created_at, lastSeenAt: row.last_seen_at,
  expiresAt: row.expires_at, activity: row.activity, connection: row.connection, roomId: row.room_id, matchId: row.match_id, connectionGeneration: row.connection_generation
}) : null;

export function oppnaLagring({ path, klocka = { now: Date.now } }) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrera(db);

  const sql = new Map();
  const stmt = text => { if (!sql.has(text)) sql.set(text, db.prepare(text)); return sql.get(text); };
  let depth = 0;

  const ops = {
    /* Match: hela matchobjektet som JSON. status enligt MATCH_STATUS. */
    sparaMatch(match, status = MATCH_STATUS.active) {
      if (!Object.values(MATCH_STATUS).includes(status)) throw new LagringsFel(`Okänd matchstatus: ${status}`);
      const now = klocka.now();
      stmt(`INSERT INTO matcher (id, status, revision, rules_version, deck_version, state, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET status = excluded.status, revision = excluded.revision, state = excluded.state, updated_at = excluded.updated_at`)
        .run(match.id, status, match.revision, match.rulesVersion, match.deckVersion, JSON.stringify(match), now, now);
    },
    hamtaMatch(id) {
      const row = stmt('SELECT status, state FROM matcher WHERE id = ?').get(id);
      return row ? { status: row.status, match: JSON.parse(row.state) } : null;
    },
    pagaendeMatcher() {
      return stmt('SELECT id FROM matcher WHERE status = ? ORDER BY created_at').all(MATCH_STATUS.active).map(row => row.id);
    },
    sparaHandelser(events) {
      const insert = stmt('INSERT INTO handelser (match_id, event_id, revision, typ, at, recipient, data) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const event of events) insert.run(event.matchId, event.eventId, event.revision, event.type, event.at, event.recipient ?? null, JSON.stringify(event.data));
    },
    hamtaHandelser(matchId, efterEventId = 0) {
      return stmt('SELECT event_id, revision, typ, at, recipient, data FROM handelser WHERE match_id = ? AND event_id > ? ORDER BY event_id')
        .all(matchId, efterEventId)
        .map(row => ({ eventId: row.event_id, matchId, revision: row.revision, type: row.typ, at: row.at, recipient: row.recipient, data: JSON.parse(row.data) }));
    },
    sparaKvittens({ playerId, scope, commandId, fingerprint, receipt }) {
      stmt('INSERT INTO kvittenser (player_id, scope, command_id, fingerprint, receipt, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(playerId, scope, commandId, fingerprint, JSON.stringify(receipt), klocka.now());
    },
    hamtaKvittens(playerId, scope, commandId) {
      const row = stmt('SELECT fingerprint, receipt FROM kvittenser WHERE player_id = ? AND scope = ? AND command_id = ?').get(playerId, scope, commandId);
      return row ? { fingerprint: row.fingerprint, receipt: JSON.parse(row.receipt) } : null;
    },
    /* Sessioner (L03) */
    sparaSession(session) {
      stmt(`INSERT INTO sessioner (player_id, nick, nick_key, token_hash, created_at, last_seen_at, expires_at, activity, connection, room_id, match_id, connection_generation)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (player_id) DO UPDATE SET nick = excluded.nick, nick_key = excluded.nick_key, last_seen_at = excluded.last_seen_at, expires_at = excluded.expires_at,
              activity = excluded.activity, connection = excluded.connection, room_id = excluded.room_id, match_id = excluded.match_id, connection_generation = excluded.connection_generation`)
        .run(session.playerId, session.nick, session.nickKey, session.tokenHash, session.createdAt, session.lastSeenAt, session.expiresAt, session.activity, session.connection, session.roomId, session.matchId, session.connectionGeneration);
    },
    hamtaSession: playerId => sessionRad(stmt(`${SESSION_SELECT} WHERE player_id = ?`).get(playerId)),
    hamtaSessionMedHash: tokenHash => sessionRad(stmt(`${SESSION_SELECT} WHERE token_hash = ?`).get(tokenHash)),
    hamtaSessionMedNickKey: nickKey => sessionRad(stmt(`${SESSION_SELECT} WHERE nick_key = ?`).get(nickKey)),
    listaSessioner: now => stmt(`${SESSION_SELECT} WHERE expires_at > ? ORDER BY nick COLLATE NOCASE`).all(now).map(sessionRad),
    raderaSession(playerId) { stmt('DELETE FROM sessioner WHERE player_id = ?').run(playerId); },
    raderaUtgangnaSessioner: now => stmt('DELETE FROM sessioner WHERE expires_at <= ?').run(now).changes,
    raknaSessioner: now => stmt('SELECT COUNT(*) AS n FROM sessioner WHERE expires_at > ?').get(now).n,
    /* Rum och inbjudningar (L04) */
    sparaRum(room) {
      const now = klocka.now();
      stmt(`INSERT INTO rum (id, status, host_player_id, room_revision, created_at, updated_at, state) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET status = excluded.status, host_player_id = excluded.host_player_id, room_revision = excluded.room_revision, updated_at = excluded.updated_at, state = excluded.state`)
        .run(room.id, room.status, room.hostPlayerId, room.roomRevision, now, now, JSON.stringify(room));
    },
    hamtaRum: id => { const row = stmt('SELECT state FROM rum WHERE id = ?').get(id); return row ? JSON.parse(row.state) : null; },
    listaRum: (status, uppdateradeFore = Number.MAX_SAFE_INTEGER) => stmt('SELECT state FROM rum WHERE status = ? AND updated_at < ? ORDER BY updated_at').all(status, uppdateradeFore).map(row => JSON.parse(row.state)),
    raderaRum(id) { stmt('DELETE FROM inbjudningar WHERE room_id = ?').run(id); stmt('DELETE FROM rum WHERE id = ?').run(id); },
    sparaInbjudan(invitation) {
      stmt(`INSERT INTO inbjudningar (id, room_id, from_player_id, to_player_id, status, created_at, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`)
        .run(invitation.id, invitation.roomId, invitation.fromPlayerId, invitation.toPlayerId, invitation.status, invitation.createdAt ?? klocka.now(), invitation.expiresAt, klocka.now());
    },
    hamtaInbjudan: id => inbjudanRad(stmt(`${INVITATION_SELECT} WHERE id = ?`).get(id)),
    listaInbjudningar({ toPlayerId, roomId, status } = {}) {
      const where = []; const params = [];
      if (toPlayerId) { where.push('to_player_id = ?'); params.push(toPlayerId); }
      if (roomId) { where.push('room_id = ?'); params.push(roomId); }
      if (status) { where.push('status = ?'); params.push(status); }
      return stmt(`${INVITATION_SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_at`).all(...params).map(inbjudanRad);
    },
    raderaInbjudningar: (status, uppdateradeFore) => stmt('DELETE FROM inbjudningar WHERE status = ? AND updated_at < ?').run(status, uppdateradeFore).changes,
    hamtaMeta: nyckel => stmt('SELECT varde FROM meta WHERE nyckel = ?').get(nyckel)?.varde ?? null,
    sparaMeta(nyckel, varde) { stmt('INSERT INTO meta (nyckel, varde) VALUES (?, ?) ON CONFLICT (nyckel) DO UPDATE SET varde = excluded.varde').run(nyckel, String(varde)); }
  };

  /* Allt inuti fn sker i en transaktion. Kastar fn, rullas allt tillbaka och felet skickas vidare.
     Nästlade anrop återanvänder den yttre transaktionen. */
  function transaktion(fn) {
    if (depth > 0) return fn(ops);
    db.exec('BEGIN IMMEDIATE');
    depth += 1;
    try {
      const result = fn(ops);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* anslutningen är redan ur transaktion */ }
      throw error;
    } finally {
      depth -= 1;
    }
  }

  return { path, schemaversion: SCHEMAVERSION, ...ops, transaktion, stang: () => db.close() };
}

function migrera(db) {
  const finns = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
  let version = finns ? Number(db.prepare("SELECT varde FROM meta WHERE nyckel = 'schemaversion'").get()?.varde ?? 0) : 0;
  if (version > SCHEMAVERSION) throw new LagringsFel(`Databasen har schemaversion ${version}, programmet kan högst ${SCHEMAVERSION}.`);
  while (version < SCHEMAVERSION) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRERINGAR[version]);
      version += 1;
      db.prepare("INSERT INTO meta (nyckel, varde) VALUES ('schemaversion', ?) ON CONFLICT (nyckel) DO UPDATE SET varde = excluded.varde").run(String(version));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
