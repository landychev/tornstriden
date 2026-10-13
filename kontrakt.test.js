import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newMatch, playerView, allowedActions, ACTION, PHASE } from './match.js';
import {
  PROTOCOL_VERSION, ACTIVITY, CONNECTION, INVITATION, ROOM, PLAYER_STATUS, RECEIPT, ADAPTER_MODE, TEAM_IDS,
  LOBBY_COMMAND, MATCH_COMMAND, ContractError, normalizeNick, assertNoSecrets, validateSession, publicSession,
  validateInvitation, validateRoom, teamSizes, validateCommand, commandFingerprint, validateReceipt, validateEvent,
  validatePrivateView, assertAdapter
} from './kontrakt.js';
import { styrdKlocka, styrdSlump, testSessioner } from './teststod.js';

const fails = (fn, field) => assert.throws(fn, error => error instanceof ContractError && error.field.startsWith(field), `förväntade fel på ${field}`);

const member = (playerId, extra = {}) => ({ playerId, nick: playerId, teamId: null, connection: CONNECTION.online, ready: false, readyRosterVersion: null, joinedAt: 0, ...extra });
const room = (extra = {}) => ({ id: 'rum1', hostPlayerId: 'anna', status: ROOM.preparing, rosterVersion: 0, roomRevision: 0, matchId: null, players: [member('anna'), member('bo')], ...extra });
const command = (extra = {}) => ({ protocolVersion: PROTOCOL_VERSION, commandId: 'c-1', type: MATCH_COMMAND.next, matchId: 'm1', revision: 3, payload: {}, ...extra });
const receipt = (extra = {}) => ({ commandId: 'c-1', status: RECEIPT.ok, message: null, revision: 4, roomRevision: null, eventId: 7, fingerprint: 'abc', ...extra });
const event = (extra = {}) => ({ eventId: 1, matchId: 'm1', revision: 1, type: 'KORT_SPELAT', at: 1000, data: { playerId: 'anna', cardCount: 9 }, recipient: null, ...extra });
const publicPlayer = (id, teamId) => ({ id, name: id, teamId, life: 3, cardCount: 10, status: PLAYER_STATUS.alive, connection: CONNECTION.online });
const view = (extra = {}) => ({
  protocolVersion: PROTOCOL_VERSION, matchId: 'm1', revision: 0, lastEventId: 0, rulesVersion: 'duell-v1', deckVersion: 'duell-50-v1',
  viewer: 'anna', teamId: 'A', phase: PHASE.swap, me: { id: 'anna', name: 'Anna', life: 3, hand: [{ instanceId: 'k1', cardId: 'katapult' }] },
  players: [publicPlayer('anna', 'A'), publicPlayer('bo', 'B')], allowed: [], pending: null, deadline: null, ...extra
});

test('Matchkommandona stämmer med dagens ACTION i match.js', () => {
  for (const [key, value] of Object.entries(ACTION)) assert.equal(MATCH_COMMAND[key], value, key);
});

test('Nick trimmas, kontrolltecken avvisas och nyckeln är skiftlägesokänslig', () => {
  assert.deepEqual(normalizeNick('  Anna   Karin '), { nick: 'Anna Karin', key: 'anna karin' });
  assert.equal(normalizeNick('ÅSA').key, normalizeNick('åsa').key);
  fails(() => normalizeNick('A'), 'nick');
  fails(() => normalizeNick('x'.repeat(21)), 'nick');
  fails(() => normalizeNick('Anna\u0000'), 'nick');
  fails(() => normalizeNick(42), 'nick');
  assert.equal(normalizeNick('<b>Anna</b>').nick, '<b>Anna</b>', 'HTML-liknande nick är tillåtet som text; escapas vid visning');
});

test('Hemliga nycklar och andras händer upptäcks på varje nivå', () => {
  assertNoSecrets({ players: [{ id: 'anna', cardCount: 3 }] });
  assertNoSecrets({ me: { id: 'anna', hand: [{ instanceId: 'k1', cardId: 'katapult' }] } }, 'anna');
  fails(() => assertNoSecrets({ a: { b: { instances: {} } } }), 'objekt.a.b.instances');
  fails(() => assertNoSecrets({ tokenHash: 'x' }), 'objekt.tokenHash');
  fails(() => assertNoSecrets({ players: [{ id: 'bo', hand: [{ instanceId: 'k2', cardId: 'riddare' }] }] }, 'anna'), 'objekt.players[0].hand');
  fails(() => assertNoSecrets({ me: { id: 'anna', hand: [{ instanceId: 'k1', cardId: 'katapult' }] } }), 'objekt.me.hand');
  assertNoSecrets({ opponent: { id: 'bo', hand: ['k2'] } }, 'anna'); // endast exemplar-ID utan kortdata (räknas som dolt)
});

test('Hela matchobjektet får aldrig lämna servern men dagens playerView är fri från hemligheter', () => {
  const match = newMatch({ matchId: 'm1', random: styrdSlump(3) });
  fails(() => assertNoSecrets(match, 'A'), 'objekt.instances');
  assertNoSecrets(playerView(match, 'A'), 'A');
  fails(() => assertNoSecrets(playerView(match, 'A'), 'B'), 'objekt.me.hand');
});

test('Session: hash i stället för token, offentlig form utan hemligheter', () => {
  const [{ session, token }] = testSessioner(1);
  validateSession(session);
  assert.deepEqual(Object.keys(publicSession(session)), ['playerId', 'nick', 'activity', 'connection']);
  fails(() => validateSession({ ...session, token }), 'session.token');
  fails(() => validateSession({ ...session, tokenHash: 'kort' }), 'session.tokenHash');
  fails(() => validateSession({ ...session, activity: 'BORTA' }), 'session.activity');
  fails(() => validateSession({ ...session, roomId: 42 }), 'session.roomId');
});

test('Inbjudan kräver olika spelare, utgångstid och känd status', () => {
  const invitation = { id: 'i1', roomId: 'rum1', fromPlayerId: 'anna', toPlayerId: 'bo', expiresAt: 5000, status: INVITATION.pending };
  validateInvitation(invitation);
  fails(() => validateInvitation({ ...invitation, toPlayerId: 'anna' }), 'invitation.players');
  fails(() => validateInvitation({ ...invitation, status: 'KANSKE' }), 'invitation.status');
  fails(() => validateInvitation({ ...invitation, expiresAt: -1 }), 'invitation.expiresAt');
});

test('Rum: unika deltagare, värd i rummet, högst åtta, lagval A/B/null', () => {
  validateRoom(room());
  assert.deepEqual(teamSizes(room({ players: [member('anna', { teamId: 'A' }), member('bo', { teamId: 'A' }), member('cy')] })), { A: 2, B: 0 });
  fails(() => validateRoom(room({ players: [member('anna'), member('anna')] })), 'room.players[1]');
  fails(() => validateRoom(room({ hostPlayerId: 'ingen' })), 'room.hostPlayerId');
  fails(() => validateRoom(room({ players: Array.from({ length: 9 }, (_, i) => member(`p${i}`)) })), 'room.players');
  fails(() => validateRoom(room({ players: [member('anna', { teamId: 'C' }), member('bo')] })), 'room.players[0].teamId');
  fails(() => validateRoom(room({ players: [member('anna', { ready: true, readyRosterVersion: 'x' }), member('bo')] })), 'room.players[0].readyRosterVersion');
  fails(() => validateRoom(room({ players: [] })), 'room.hostPlayerId');
  validateRoom(room({ players: [], status: ROOM.closed }));
  fails(() => validateRoom(room({ players: [member('anna', { tokenHash: 'läckt' }), member('bo')] })), 'objekt.players[0].tokenHash');
});

test('Kommando: protokollversion, commandId, revision för match och roomId för rum', () => {
  validateCommand(command());
  fails(() => validateCommand(command({ protocolVersion: 0 })), 'command.protocolVersion');
  fails(() => validateCommand(command({ commandId: 'har mellanslag' })), 'command.commandId');
  fails(() => validateCommand(command({ type: 'FUSKA' })), 'command.type');
  fails(() => validateCommand(command({ revision: undefined })), 'command.revision');
  fails(() => validateCommand(command({ matchId: undefined })), 'command.matchId');
  fails(() => validateCommand(command({ type: MATCH_COMMAND.attack })), 'command.payload.instanceId');
  validateCommand(command({ type: MATCH_COMMAND.attack, payload: { instanceId: 'k1', usage: 'simple' } }));
  fails(() => validateCommand(command({ type: LOBBY_COMMAND.ready, matchId: undefined, revision: undefined })), 'command.roomId');
  fails(() => validateCommand(command({ type: LOBBY_COMMAND.ready, roomId: 'rum1', payload: { ready: true } })), 'command.payload');
  validateCommand(command({ type: LOBBY_COMMAND.ready, roomId: 'rum1', payload: { ready: true, rosterVersion: 2 } }));
  fails(() => validateCommand(command({ type: LOBBY_COMMAND.accept })), 'command.payload.invitationId');
  fails(() => validateCommand(command({ type: LOBBY_COMMAND.team, roomId: 'rum1', payload: { teamId: 'C' } })), 'command.payload.teamId');
  fails(() => validateCommand(command({ type: LOBBY_COMMAND.nick, payload: { nick: 'x' } })), 'nick');
  fails(() => validateCommand(command({ type: LOBBY_COMMAND.invite, roomId: 'rum1', payload: { playerIds: [] } })), 'command.payload.playerIds');
});

test('Kommando: klienten får inte påstå identitet, lag, liv eller vinnare, och storleken är begränsad', () => {
  fails(() => validateCommand(command({ playerId: 'bo' })), 'command.playerId');
  fails(() => validateCommand(command({ teamId: 'A' })), 'command.teamId');
  fails(() => validateCommand(command({ payload: { playerId: 'bo' } })), 'command.payload');
  fails(() => validateCommand(command({ winner: 'A' })), 'command.winner');
  fails(() => validateCommand(command({ payload: { text: 'x'.repeat(3000) } })), 'command');
});

test('Fingeravtryck: samma innehåll ger samma avtryck oavsett commandId och nyckelordning, annat innehåll ger annat', () => {
  const a = command({ type: MATCH_COMMAND.attack, payload: { instanceId: 'k1', usage: 'simple' } });
  const b = { ...a, commandId: 'c-2', payload: { usage: 'simple', instanceId: 'k1' } };
  assert.equal(commandFingerprint(a), commandFingerprint(b));
  assert.notEqual(commandFingerprint(a), commandFingerprint({ ...a, payload: { instanceId: 'k2', usage: 'simple' } }));
  assert.notEqual(commandFingerprint(a), commandFingerprint({ ...a, revision: 4 }));
  assert.match(commandFingerprint(a), /^[0-9a-f]{8}$/);
});

test('Kvittens: status, heltal eller null, fingeravtryck vid godkänt, inga hemligheter', () => {
  validateReceipt(receipt());
  validateReceipt(receipt({ status: RECEIPT.unknown, revision: null, eventId: null, fingerprint: null }));
  fails(() => validateReceipt(receipt({ status: 'JA' })), 'receipt.status');
  fails(() => validateReceipt(receipt({ fingerprint: null })), 'receipt.fingerprint');
  fails(() => validateReceipt(receipt({ revision: 'fyra' })), 'receipt.revision');
  fails(() => validateReceipt(receipt({ view: { instances: {} } })), 'objekt.view.instances');
});

test('Händelse: löpnummer från 1, offentlig data utan händer, privat data bara till mottagaren', () => {
  validateEvent(event());
  validateEvent(event({ recipient: 'anna', data: { id: 'anna', hand: [{ instanceId: 'k1', cardId: 'katapult' }] } }));
  fails(() => validateEvent(event({ eventId: 0 })), 'event.eventId');
  fails(() => validateEvent(event({ data: { id: 'anna', hand: [{ instanceId: 'k1', cardId: 'katapult' }] } })), 'objekt.data.hand');
  fails(() => validateEvent(event({ recipient: 'bo', data: { id: 'anna', hand: [{ instanceId: 'k1', cardId: 'katapult' }] } })), 'objekt.data.hand');
  fails(() => validateEvent(event({ data: { drawPile: ['k9'] } })), 'objekt.data.drawPile');
});

test('Privat vy: viewer är fast, players är offentliga, egen hand är enda kortdatan', () => {
  validatePrivateView(view());
  fails(() => validatePrivateView(view({ me: { id: 'bo', name: 'Bo', life: 3, hand: [] } })), 'view.me');
  fails(() => validatePrivateView(view({ players: [publicPlayer('bo', 'B')] })), 'view.players');
  fails(() => validatePrivateView(view({ players: [publicPlayer('anna', 'A'), { ...publicPlayer('bo', 'B'), hand: [{ instanceId: 'k2', cardId: 'riddare' }] }] })), 'objekt.players[1].hand');
  fails(() => validatePrivateView(view({ players: [publicPlayer('anna', 'A'), { ...publicPlayer('bo', 'B'), status: 'DÖD' }] })), 'view.players[1]');
  fails(() => validatePrivateView(view({ instances: {} })), 'objekt.instances');
  fails(() => validatePrivateView(view({ pending: { commandId: 'c-1' } })), 'view.pending');
  fails(() => validatePrivateView(view({ deadline: { playerId: 'anna' } })), 'view.deadline');
  fails(() => validatePrivateView(view({ allowed: undefined })), 'view.allowed');
  validatePrivateView(view({ pending: { commandId: 'c-1', status: RECEIPT.unknown }, deadline: { playerId: 'bo', at: 90000 } }));
});

test('Dagens duellvy kan lyftas in i kontraktet med ett tunt omslag', () => {
  const match = newMatch({ matchId: 'm1', random: styrdSlump(5) });
  const wrap = playerId => {
    const v = playerView(match, playerId);
    const other = v.opponent;
    return validatePrivateView({
      ...v, protocolVersion: PROTOCOL_VERSION, lastEventId: 0, viewer: playerId, teamId: playerId,
      players: [
        { id: v.me.id, name: v.me.name, teamId: playerId, life: v.me.life, cardCount: v.me.hand.length, status: PLAYER_STATUS.alive, connection: CONNECTION.online },
        { id: other.id, name: other.name, teamId: other.id, life: other.life, cardCount: other.cardCount, status: PLAYER_STATUS.alive, connection: CONNECTION.online }
      ],
      allowed: allowedActions(match, playerId), pending: null, deadline: null
    });
  };
  for (const id of TEAM_IDS) {
    const v = wrap(id);
    assert.equal(v.me.hand.length, 10);
    assert.ok(!('hand' in v.players[1]));
  }
});

test('Adaptern måste ha läge och de sex metoderna', () => {
  const adapter = { mode: ADAPTER_MODE.local, viewer: () => 'A', view: () => ({}), send: async () => ({}), status: async () => ({}), subscribe: () => () => {} };
  assertAdapter(adapter);
  fails(() => assertAdapter({ ...adapter, mode: 'HYBRID' }), 'adapter.mode');
  fails(() => assertAdapter({ ...adapter, status: undefined }), 'adapter.status');
});

test('Teststöd: separata sessioner har olika identitet, token och nick', () => {
  const sessions = testSessioner(4, { nicks: ['Anna', 'Bo'] });
  assert.equal(new Set(sessions.map(s => s.playerId)).size, 4);
  assert.equal(new Set(sessions.map(s => s.token)).size, 4);
  assert.deepEqual(sessions.map(s => s.nick), ['Anna', 'Bo', 'Spelare 3', 'Spelare 4']);
  for (const { session, token } of sessions) { validateSession(session); assert.ok(!JSON.stringify(session).includes(token)); }
  assert.deepEqual(testSessioner(2).map(s => s.playerId), testSessioner(2).map(s => s.playerId), 'samma frö ger samma sessioner');
});

test('Teststöd: styrd klocka kör timers i tidsordning utan verklig väntan', () => {
  const clock = styrdKlocka(1000);
  const fired = [];
  clock.setTimeout(() => fired.push('b'), 90000);
  clock.setTimeout(() => { fired.push('a'); clock.setTimeout(() => fired.push('a2'), 1000); }, 30000);
  const cancelled = clock.setTimeout(() => fired.push('x'), 5000);
  clock.clearTimeout(cancelled);
  clock.advance(29999);
  assert.deepEqual(fired, []);
  clock.advance(1);
  assert.deepEqual(fired, ['a']);
  assert.equal(clock.now(), 31000);
  clock.advance(60000);
  assert.deepEqual(fired, ['a', 'a2', 'b']);
  assert.equal(clock.now(), 91000);
  assert.equal(clock.pending(), 0);
});

test('Teststöd: styrd slump är deterministisk och inom [0, 1)', () => {
  const a = styrdSlump(42), b = styrdSlump(42), c = styrdSlump(43);
  const seriesA = Array.from({ length: 5 }, a), seriesB = Array.from({ length: 5 }, b);
  assert.deepEqual(seriesA, seriesB);
  assert.notDeepEqual(seriesA, Array.from({ length: 5 }, c));
  assert.ok(seriesA.every(x => x >= 0 && x < 1));
  const match = newMatch({ matchId: 'm', random: styrdSlump(9) });
  assert.deepEqual(playerView(match, 'A').me.hand, playerView(newMatch({ matchId: 'm', random: styrdSlump(9) }), 'A').me.hand);
});
