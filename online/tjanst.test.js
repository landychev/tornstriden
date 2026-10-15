import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oppnaLagring } from './lagring.js';
import { skapaTjanst } from './tjanst.js';
import { skapaKo } from './ko.js';
import { PROTOCOL_VERSION, MATCH_COMMAND, LOBBY_COMMAND, RECEIPT, MATCH_STATUS, ContractError } from '../kontrakt.js';
import { styrdKlocka, styrdSlump } from '../teststod.js';

const cmd = (extra = {}) => ({ protocolVersion: PROTOCOL_VERSION, commandId: 'c1', type: MATCH_COMMAND.next, matchId: 'm1', revision: 0, payload: {}, ...extra });
const match = (revision = 0) => ({ id: 'm1', revision, rulesVersion: 'duell-v1', deckVersion: 'duell-50-v1', instances: {} });

/* Testdubbel för en matchhanterare: ökar revisionen och sparar en händelse. */
function fortsatt({ command, ops, klocka }) {
  const current = ops.hamtaMatch(command.matchId)?.match ?? match();
  if (command.revision !== current.revision) return { status: RECEIPT.rejected, message: 'Matchläget har ändrats – försök igen.', revision: current.revision };
  const next = { ...current, revision: current.revision + 1 };
  ops.sparaMatch(next);
  ops.sparaHandelser([{ eventId: next.revision, matchId: next.id, revision: next.revision, type: 'FORTSATT', at: klocka.now(), recipient: null, data: {} }]);
  return { status: RECEIPT.ok, revision: next.revision, eventId: next.revision };
}

function setup({ before } = {}) {
  const lagring = oppnaLagring({ path: ':memory:', klocka: styrdKlocka(1000) });
  before?.(lagring);
  const tjanst = skapaTjanst({ lagring, klocka: styrdKlocka(1000), slump: styrdSlump(1) });
  tjanst.registrera(MATCH_COMMAND.next, fortsatt);
  return { lagring, tjanst };
}

test('Ogiltigt format kastar ContractError, okänd typ ger AVVISAD utan att något sparas', async () => {
  const { tjanst, lagring } = setup();
  await assert.rejects(tjanst.kommando('anna', cmd({ revision: undefined })), ContractError);
  const receipt = await tjanst.kommando('anna', cmd({ type: LOBBY_COMMAND.leave, roomId: 'r1', matchId: undefined, revision: undefined }));
  assert.equal(receipt.status, RECEIPT.rejected);
  assert.match(receipt.message, /stöds inte/);
  assert.equal(lagring.hamtaKvittens('anna', 'rum:r1', 'c1'), null);
});

test('Godkänt kommando sparar match, händelse och kvittens tillsammans; samma commandId ger samma kvittens en gång', async () => {
  const { tjanst, lagring } = setup();
  const first = await tjanst.kommando('anna', cmd());
  assert.equal(first.status, RECEIPT.ok);
  assert.equal(first.revision, 1);
  assert.equal(first.eventId, 1);
  assert.match(first.fingerprint, /^[0-9a-f]{8}$/);
  assert.equal(lagring.hamtaMatch('m1').match.revision, 1);
  assert.equal(lagring.hamtaHandelser('m1').length, 1);
  const again = await tjanst.kommando('anna', cmd());
  assert.deepEqual(again, first, 'upprepning ger exakt samma kvittens');
  assert.equal(lagring.hamtaMatch('m1').match.revision, 1, 'effekten inträffar bara en gång');
  const changed = await tjanst.kommando('anna', cmd({ payload: { extra: 1 } }));
  assert.equal(changed.status, RECEIPT.rejected);
  assert.match(changed.message, /annat innehåll/);
  assert.equal(tjanst.status('anna', 'match:m1', 'c1').status, RECEIPT.ok);
  assert.equal(tjanst.status('anna', 'match:m1', 'c-x').status, RECEIPT.unknown);
  assert.equal(tjanst.status('bo', 'match:m1', 'c1').status, RECEIPT.unknown, 'annan spelare ser inte kvittensen');
});

test('Avvisat kommando lämnar matchen orörd men får en kvittens som kan frågas efter', async () => {
  const { tjanst, lagring } = setup();
  const receipt = await tjanst.kommando('anna', cmd({ revision: 7 }));
  assert.equal(receipt.status, RECEIPT.rejected);
  assert.equal(receipt.revision, 0);
  assert.equal(lagring.hamtaMatch('m1'), null);
  assert.equal(tjanst.status('anna', 'match:m1', 'c1').status, RECEIPT.rejected);
});

test('Misslyckad lagring ger varken delvis sparat drag eller godkänd kvittens', async () => {
  const { tjanst, lagring } = setup();
  lagring.sparaMatch(match(0));
  lagring.sparaHandelser([{ eventId: 1, matchId: 'm1', revision: 1, type: 'GAMMAL', at: 0, recipient: null, data: {} }]);
  const receipt = await tjanst.kommando('anna', cmd());   // hanteraren försöker spara eventId 1 igen -> lagringsfel
  assert.equal(receipt.status, RECEIPT.error);
  assert.equal(receipt.fingerprint, null);
  assert.equal(lagring.hamtaMatch('m1').match.revision, 0, 'matchen rullades tillbaka');
  assert.equal(lagring.hamtaKvittens('anna', 'match:m1', 'c1'), null, 'ingen kvittens sparades');
  assert.equal(tjanst.status('anna', 'match:m1', 'c1').status, RECEIPT.unknown);
  tjanst.registrera(MATCH_COMMAND.surrender, ({ ops }) => { ops.sparaMatch(match(9)); throw new Error('krasch mitt i'); });
  const crash = await tjanst.kommando('anna', cmd({ commandId: 'c2', type: MATCH_COMMAND.surrender }));
  assert.equal(crash.status, RECEIPT.error);
  assert.equal(lagring.hamtaMatch('m1').match.revision, 0, 'hanterarens skrivning före kraschen är borta');
});

test('Ingen startspärr i tjänsten (L18): gamla pågående matcher avbryts av servern före start, inte här', async () => {
  const { tjanst } = setup({ before: l => l.sparaMatch(match(3)) });
  assert.equal(tjanst.matchtrafik.oppen, true);
  const receipt = await tjanst.kommando('anna', cmd({ revision: 3 }));
  assert.equal(receipt.status, RECEIPT.ok, 'kommandot når hanteraren');
  /* Strömbrytaren finns kvar för underhåll: stängd matchtrafik avvisar matchkommandon men inte lobbyn. */
  Object.assign(tjanst.matchtrafik, { oppen: false, orsak: 'Underhåll.' });
  assert.match((await tjanst.kommando('anna', cmd({ revision: 4, commandId: 'c9' }))).message, /Underhåll/);
  tjanst.registrera(LOBBY_COMMAND.leave, () => ({ status: RECEIPT.ok }));
  const lobby = await tjanst.kommando('anna', cmd({ type: LOBBY_COMMAND.leave, roomId: 'r1', matchId: undefined, revision: undefined, commandId: 'c2' }));
  assert.equal(lobby.status, RECEIPT.ok);
});

test('Kön kör samma nyckel i ordning och olika nycklar oberoende', async () => {
  const ko = skapaKo();
  const order = [];
  const steg = (namn, ms) => () => new Promise(resolve => setTimeout(() => { order.push(namn); resolve(namn); }, ms));
  const a1 = ko.kor('a', steg('a1', 20));
  const a2 = ko.kor('a', steg('a2', 1));
  const b1 = ko.kor('b', steg('b1', 5));
  const fel = ko.kor('a', () => { throw new Error('a3 fel'); });
  const a4 = ko.kor('a', steg('a4', 1));
  await assert.rejects(fel, /a3 fel/);
  assert.deepEqual(await Promise.all([a1, a2, b1, a4]), ['a1', 'a2', 'b1', 'a4']);
  assert.deepEqual(order, ['b1', 'a1', 'a2', 'a4'], 'b1 blev klar medan a1 väntade; a-kön höll ordningen trots fel i a3');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(ko.vantande(), 0);
});

test('Två samtidiga kommandon på samma match: det andra ser det förstas resultat', async () => {
  const { tjanst, lagring } = setup();
  const [first, second] = await Promise.all([tjanst.kommando('anna', cmd({ commandId: 'c1', revision: 0 })), tjanst.kommando('bo', cmd({ commandId: 'c2', revision: 0 }))]);
  assert.equal(first.status, RECEIPT.ok);
  assert.equal(second.status, RECEIPT.rejected, 'samma revision två gånger ger en övergång');
  assert.equal(lagring.hamtaMatch('m1').match.revision, 1);
});
