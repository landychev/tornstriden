import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oppnaLagring } from './lagring.js';
import { skapaSessioner, SessionsFel, SESSION_TTL_MS, TOUCH_INTERVAL_MS, MAX_SESSIONS, hashToken } from './session.js';
import { skapaTjanst } from './tjanst.js';
import { ACTIVITY, CONNECTION, LOBBY_COMMAND, PROTOCOL_VERSION, RECEIPT, ContractError } from '../kontrakt.js';
import { styrdKlocka } from '../teststod.js';

function setup() {
  const klocka = styrdKlocka(1_000_000);
  const lagring = oppnaLagring({ path: ':memory:', klocka });
  const sessioner = skapaSessioner({ lagring, klocka });
  return { klocka, lagring, sessioner };
}
const rejects = (fn, status, pattern) => assert.throws(fn, error => error instanceof SessionsFel && error.status === status && pattern.test(error.message));

test('Separata gäster får olika identitet och token; token lagras bara som hash', () => {
  const { sessioner, lagring } = setup();
  const anna = sessioner.skapa('Anna');
  const bo = sessioner.skapa(' Bo ');
  assert.notEqual(anna.session.playerId, bo.session.playerId);
  assert.notEqual(anna.token, bo.token);
  assert.match(anna.token, /^[0-9a-f]{64}$/);
  assert.equal(bo.session.nick, 'Bo');
  assert.equal(lagring.hamtaSession(anna.session.playerId).tokenHash, hashToken(anna.token));
  assert.ok(!JSON.stringify(lagring.hamtaSession(anna.session.playerId)).includes(anna.token));
  assert.equal(sessioner.hamta(anna.token).playerId, anna.session.playerId, 'rätt token ger rätt session');
  assert.equal(sessioner.hamta(bo.token).playerId, bo.session.playerId);
  assert.equal(sessioner.hamta('0'.repeat(64)), null, 'okänd token');
  assert.equal(sessioner.hamta(anna.token.toUpperCase()), null, 'fel format');
  assert.equal(sessioner.hamta(undefined), null);
});

test('Nickkrock: samma nick (oavsett skiftläge/mellanslag) avvisas tills sessionen gått ut; nick ger ingen åtkomst', () => {
  const { sessioner, klocka } = setup();
  const anna = sessioner.skapa('Anna');
  rejects(() => sessioner.skapa('ANNA'), 409, /upptaget/);
  rejects(() => sessioner.skapa('  anna  '), 409, /upptaget/);
  assert.throws(() => sessioner.skapa('A'), ContractError);
  klocka.advance(SESSION_TTL_MS);
  const nyAnna = sessioner.skapa('Anna');
  assert.notEqual(nyAnna.session.playerId, anna.session.playerId, 'ett utgånget nick ger en ny identitet, inte den gamla sessionen');
  assert.equal(sessioner.hamta(anna.token), null, 'den gamla token är död');
});

test('Sessionen förlängs glidande vid aktivitet och går ut efter fem minuters tystnad', () => {
  const { sessioner, klocka } = setup();
  const { token, session } = sessioner.skapa('Anna');
  klocka.advance(SESSION_TTL_MS - TOUCH_INTERVAL_MS);
  assert.ok(sessioner.hamta(token), 'strax före utgång');
  klocka.advance(SESSION_TTL_MS - 1);
  assert.ok(sessioner.hamta(token), 'förlängd av förra aktiviteten');
  klocka.advance(SESSION_TTL_MS + 1);
  assert.equal(sessioner.hamta(token), null, 'tystnad i fem minuter');
  assert.equal(sessioner.lobbylista().some(p => p.playerId === session.playerId), false);
});

test('Nickbyte bara utanför rum/match och inte till någon annans nick', () => {
  const { sessioner, lagring } = setup();
  const anna = sessioner.skapa('Anna');
  sessioner.skapa('Bo');
  rejects(() => sessioner.bytNick(anna.session.playerId, 'bo'), 409, /upptaget/);
  assert.equal(sessioner.bytNick(anna.session.playerId, 'Anna').nick, 'Anna', 'eget nick får "bytas" till sig självt');
  assert.equal(sessioner.bytNick(anna.session.playerId, '<b>Anna</b>').nick, '<b>Anna</b>', 'lagras som text, escapas vid visning');
  lagring.sparaSession({ ...lagring.hamtaSession(anna.session.playerId), activity: ACTIVITY.inRoom });
  rejects(() => sessioner.bytNick(anna.session.playerId, 'Annika'), 409, /utanför rum/);
  rejects(() => sessioner.bytNick('p-finns-inte', 'Annika'), 401, /gått ut/);
});

test('Anslutningsgeneration: ett sent close från en gammal anslutning fäller inte den nya', () => {
  const { sessioner, lagring } = setup();
  const { session } = sessioner.skapa('Anna');
  const id = session.playerId;
  assert.equal(lagring.hamtaSession(id).connection, CONNECTION.offline);
  const g1 = sessioner.anslut(id);
  const g2 = sessioner.anslut(id);
  assert.equal(g2, g1 + 1);
  assert.equal(sessioner.kopplaFran(id, g1), false, 'gammal generation ignoreras');
  assert.equal(lagring.hamtaSession(id).connection, CONNECTION.online);
  assert.equal(sessioner.kopplaFran(id, g2), true);
  assert.equal(lagring.hamtaSession(id).connection, CONNECTION.offline);
  assert.equal(sessioner.kopplaFran(id, g2), false, 'redan frånkopplad');
  sessioner.anslut(id);
  sessioner.markeraAllaFrankopplade();
  assert.equal(lagring.hamtaSession(id).connection, CONNECTION.offline, 'efter serverstart är ingen ansluten');
});

test('Lobbylistan visar bara offentliga fält, sorterad på nick, och lämna tar bort en ledig session', () => {
  const { sessioner } = setup();
  const bo = sessioner.skapa('bo');
  const anna = sessioner.skapa('Åsa');
  sessioner.skapa('Anna');
  sessioner.anslut(bo.session.playerId);
  const lista = sessioner.lobbylista();
  assert.deepEqual(lista.map(p => p.nick), ['Anna', 'bo', 'Åsa']);
  assert.deepEqual(Object.keys(lista[0]), ['playerId', 'nick', 'activity', 'connection']);
  assert.equal(lista[1].connection, CONNECTION.online);
  assert.equal(sessioner.lamna(anna.session.playerId), true);
  assert.equal(sessioner.lamna(anna.session.playerId), false);
  assert.equal(sessioner.lobbylista().length, 2);
});

test('Lobbyn är begränsad till MAX_SESSIONS levande sessioner', () => {
  const { sessioner } = setup();
  for (let i = 0; i < MAX_SESSIONS; i++) sessioner.skapa(`Gäst ${i}`);
  rejects(() => sessioner.skapa('En till'), 503, /full/);
});

test('SÄTT_NICK som kommando går genom tjänsten med kvittens', async () => {
  const { sessioner, lagring, klocka } = setup();
  const tjanst = skapaTjanst({ lagring, klocka });
  sessioner.registrera(tjanst);
  const { session } = sessioner.skapa('Anna');
  sessioner.skapa('Bo');
  const cmd = (commandId, nick) => ({ protocolVersion: PROTOCOL_VERSION, commandId, type: LOBBY_COMMAND.nick, payload: { nick } });
  const ok = await tjanst.kommando(session.playerId, cmd('c1', 'Annika'));
  assert.equal(ok.status, RECEIPT.ok);
  assert.equal(lagring.hamtaSession(session.playerId).nick, 'Annika');
  const upptaget = await tjanst.kommando(session.playerId, cmd('c2', 'bo'));
  assert.equal(upptaget.status, RECEIPT.rejected);
  assert.match(upptaget.message, /upptaget/);
  assert.equal(lagring.hamtaSession(session.playerId).nick, 'Annika');
  await assert.rejects(tjanst.kommando(session.playerId, cmd('c3', 'x')), ContractError);
});
