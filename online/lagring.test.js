import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { oppnaLagring, SCHEMAVERSION, LagringsFel } from './lagring.js';
import { MATCH_STATUS } from '../kontrakt.js';
import { styrdKlocka } from '../teststod.js';

const match = (id, revision = 0) => ({ id, revision, rulesVersion: 'duell-v1', deckVersion: 'duell-50-v1', players: [], instances: { 'm:kort:1': 'katapult' } });
const event = (matchId, eventId) => ({ eventId, matchId, revision: eventId, type: 'TEST', at: 10, recipient: null, data: { n: eventId } });
const receipt = commandId => ({ commandId, status: 'GODKÄND', message: null, revision: 1, roomRevision: null, eventId: 1, fingerprint: 'abc' });

test('Migrering skapar schemat, är idempotent och vägrar nyare databas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tornstriden-'));
  const path = join(dir, 'data', 'spel.sqlite');
  const a = oppnaLagring({ path });
  assert.equal(a.hamtaMeta('schemaversion'), String(SCHEMAVERSION));
  a.stang();
  const b = oppnaLagring({ path });
  assert.equal(b.hamtaMeta('schemaversion'), String(SCHEMAVERSION));
  b.sparaMeta('schemaversion', SCHEMAVERSION + 1);
  b.stang();
  assert.throws(() => oppnaLagring({ path }), LagringsFel);
  rmSync(dir, { recursive: true, force: true });
});

test('Match, händelser och kvittens sparas och läses tillbaka', () => {
  const klocka = styrdKlocka(500);
  const lagring = oppnaLagring({ path: ':memory:', klocka });
  lagring.sparaMatch(match('m1', 2));
  lagring.sparaHandelser([event('m1', 1), event('m1', 2)]);
  lagring.sparaKvittens({ playerId: 'anna', scope: 'match:m1', commandId: 'c1', fingerprint: 'abc', receipt: receipt('c1') });
  assert.deepEqual(lagring.hamtaMatch('m1'), { status: MATCH_STATUS.active, match: match('m1', 2) });
  assert.deepEqual(lagring.hamtaHandelser('m1', 1), [event('m1', 2)]);
  assert.deepEqual(lagring.hamtaKvittens('anna', 'match:m1', 'c1'), { fingerprint: 'abc', receipt: receipt('c1') });
  assert.equal(lagring.hamtaKvittens('bo', 'match:m1', 'c1'), null, 'kvittensen är knuten till spelaren');
  assert.deepEqual(lagring.pagaendeMatcher(), ['m1']);
  lagring.sparaMatch(match('m1', 3), MATCH_STATUS.finished);
  assert.deepEqual(lagring.pagaendeMatcher(), []);
  assert.equal(lagring.hamtaMatch('m1').match.revision, 3);
  assert.throws(() => lagring.sparaMatch(match('m2'), 'PAUSAD'), LagringsFel);
  lagring.stang();
});

test('En transaktion sparar allt eller inget: dubblerad händelse rullar tillbaka match och kvittens', () => {
  const lagring = oppnaLagring({ path: ':memory:' });
  lagring.sparaMatch(match('m1', 0));
  lagring.sparaHandelser([event('m1', 1)]);
  assert.throws(() => lagring.transaktion(ops => {
    ops.sparaMatch(match('m1', 1));
    ops.sparaKvittens({ playerId: 'anna', scope: 'match:m1', commandId: 'c9', fingerprint: 'x', receipt: receipt('c9') });
    ops.sparaHandelser([event('m1', 1)]);   // samma eventId igen -> PRIMARY KEY-fel
  }));
  assert.equal(lagring.hamtaMatch('m1').match.revision, 0, 'matchen är orörd');
  assert.equal(lagring.hamtaKvittens('anna', 'match:m1', 'c9'), null, 'ingen kvittens');
  assert.equal(lagring.hamtaHandelser('m1').length, 1);
  const value = lagring.transaktion(ops => { ops.sparaMatch(match('m1', 5)); return lagring.transaktion(inner => inner.hamtaMatch('m1').match.revision); });
  assert.equal(value, 5, 'nästlad transaktion ser den yttres ändring och binder inte om');
  assert.throws(() => lagring.transaktion(() => { throw new Error('eget fel'); }), /eget fel/);
  assert.equal(lagring.hamtaMatch('m1').match.revision, 5, 'lagringen fungerar vidare efter rollback');
  lagring.stang();
});

test('Sparat testdata överlever en processomstart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tornstriden-'));
  const path = join(dir, 'spel.sqlite');
  const script = `
    import { oppnaLagring } from ${JSON.stringify(new URL('./lagring.js', import.meta.url).href)};
    const l = oppnaLagring({ path: process.argv[1] });
    l.transaktion(ops => {
      ops.sparaMatch({ id: 'm7', revision: 4, rulesVersion: 'duell-v1', deckVersion: 'duell-50-v1', instances: {} });
      ops.sparaHandelser([{ eventId: 1, matchId: 'm7', revision: 4, type: 'TEST', at: 1, recipient: 'anna', data: { hand: [] } }]);
      ops.sparaKvittens({ playerId: 'anna', scope: 'match:m7', commandId: 'c1', fingerprint: 'f', receipt: { commandId: 'c1', status: 'GODKÄND', message: null, revision: 4, roomRevision: null, eventId: 1, fingerprint: 'f' } });
    });
    l.stang();`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script, path], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(existsSync(path));
  const lagring = oppnaLagring({ path });
  assert.equal(lagring.hamtaMatch('m7').match.revision, 4);
  assert.equal(lagring.hamtaHandelser('m7')[0].recipient, 'anna');
  assert.equal(lagring.hamtaKvittens('anna', 'match:m7', 'c1').receipt.status, 'GODKÄND');
  assert.deepEqual(lagring.pagaendeMatcher(), ['m7'], 'en pågående match från förra körningen syns vid uppstart');
  lagring.stang();
  rmSync(dir, { recursive: true, force: true });
});
