/* Gemensamma kontrakt för lobby och onlinespel (arbetsordning L01).
   Ren data och validering: ingen HTML, inget nätverk, ingen lagring och inga
   Node-specifika beroenden, så att både servern och webbläsaren kan importera
   modulen. Nycklar på engelska och värden på svenska, som i match.js.

   Tre räknare som inte får blandas ihop:
   - rosterVersion  ökar när rummets deltagare eller lagval ändras (Redo gäller en viss rosterVersion).
   - revision       matchens revision från matchmotorn; varje godkänt kommando ökar den med ett.
   - eventId        löpnummer per match för händelser (ljud/animation spelas högst en gång per eventId).
   Dessutom roomRevision för alla rumsuppdateringar (även anslutningsstatus) och
   connectionGeneration per session för att skilja en ny anslutning från en gammal.

   Adaptergräns (L07/L09): matchvyn pratar bara med ett objekt som uppfyller ADAPTER_METHODS.
   `LokalMatch` kör dagens motor (match.js/dator.js) i webbläsaren; `OnlineMatch` skickar kommandon
   och tar emot privata vyer. Duell och lag skiljs av rulesVersion i vyn, inte av adaptern. */

export const PROTOCOL_VERSION = 1;

export const ACTIVITY = Object.freeze({ idle: 'LEDIG', inRoom: 'I_RUM', playing: 'SPELAR', finished: 'FÖLJER_AVSLUT' });
export const CONNECTION = Object.freeze({ online: 'ANSLUTEN', offline: 'FRÅNKOPPLAD' });
export const INVITATION = Object.freeze({ pending: 'VÄNTAR', accepted: 'ACCEPTERAD', declined: 'AVBÖJD', expired: 'UTGÅNGEN', revoked: 'ÅTERKALLAD' });
export const ROOM = Object.freeze({ preparing: 'FÖRBEREDELSE', started: 'STARTAD', closed: 'STÄNGD' });
export const PLAYER_STATUS = Object.freeze({ alive: 'LEVANDE', out: 'UTSLAGEN' });
export const RECEIPT = Object.freeze({ ok: 'GODKÄND', rejected: 'AVVISAD', error: 'INTERNT_FEL', unknown: 'OKÄND' });
export const MATCH_STATUS = Object.freeze({ active: 'PÅGÅR', finished: 'AVSLUTAD', aborted: 'AVBRUTEN' });
export const ADAPTER_MODE = Object.freeze({ local: 'LOKAL', online: 'ONLINE' });

export const TEAMS = Object.freeze([Object.freeze({ id: 'A', name: 'Södra laget' }), Object.freeze({ id: 'B', name: 'Norra laget' })]);
export const TEAM_IDS = Object.freeze(TEAMS.map(team => team.id));
export const MATCH_SIZES = Object.freeze([2, 4, 6, 8]);
export const MAX_ROOM_SIZE = 8;

/* Lobbykommandon (L03–L05). KOMMANDOSTATUS frågar efter kvittensen för ett tidigare commandId. */
export const LOBBY_COMMAND = Object.freeze({
  nick: 'SÄTT_NICK', createRoom: 'SKAPA_RUM', invite: 'BJUD_IN', accept: 'ACCEPTERA', decline: 'AVBÖJ',
  revoke: 'ÅTERKALLA', team: 'VÄLJ_LAG', ready: 'REDO', start: 'STARTA', leave: 'LÄMNA', status: 'KOMMANDOSTATUS'
});
/* Matchkommandon. De sex första är dagens ACTION i match.js (testet kontrollerar att de stämmer);
   VÄLJ_MÅL och BEKRÄFTA_START reserveras för lagmatchen (L12/L14). */
export const MATCH_COMMAND = Object.freeze({
  swap: 'BEKRÄFTA_BYTE', attack: 'SPELA_ATTACK', defend: 'SPELA_FÖRSVAR', pass: 'AVSTÅ_FÖRSVAR', next: 'FORTSÄTT', surrender: 'GE_UPP',
  target: 'VÄLJ_MÅL', confirmStart: 'BEKRÄFTA_START'
});
const ROOM_COMMANDS = new Set([LOBBY_COMMAND.invite, LOBBY_COMMAND.revoke, LOBBY_COMMAND.team, LOBBY_COMMAND.ready, LOBBY_COMMAND.start, LOBBY_COMMAND.leave]);
const INVITATION_COMMANDS = new Set([LOBBY_COMMAND.accept, LOBBY_COMMAND.decline, LOBBY_COMMAND.revoke]);

export const MAX_COMMAND_BYTES = 2048;
export const NICK = Object.freeze({ min: 2, max: 20 });

/* Nycklar som aldrig får förekomma i något objekt som lämnar servern. */
export const SECRET_KEYS = Object.freeze(['token', 'tokenHash', 'secret', 'cookie', 'instances', 'drawPile', 'setAside', 'deckOrder']);

export class ContractError extends Error {
  constructor(field, message) { super(`${field}: ${message}`); this.field = field; }
}
const check = (condition, field, message) => { if (!condition) throw new ContractError(field, message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
/* Kortexemplar heter t.ex. `m1:kort:48` (matchregler.js) och får därför innehålla kolon. */
const isInstanceId = value => typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,96}$/.test(value);
const isCount = value => Number.isInteger(value) && value >= 0;
const isTime = value => Number.isInteger(value) && value >= 0;
const isEnum = (value, set) => Object.values(set).includes(value);
const isTeam = value => value === null || TEAM_IDS.includes(value);
const isIdOrNull = value => value === null || isId(value);

/* ---- Nick ---- */
export function normalizeNick(raw) {
  check(typeof raw === 'string', 'nick', 'Nicket måste vara text.');
  check(!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(raw), 'nick', 'Nicket får inte innehålla kontrolltecken.');
  const nick = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  const length = [...nick].length;
  check(length >= NICK.min && length <= NICK.max, 'nick', `Nicket måste vara ${NICK.min}–${NICK.max} tecken.`);
  return { nick, key: nick.normalize('NFKC').toLocaleLowerCase('sv') };
}

/* ---- Hemligheter ---- */
/* Går igenom ett objekt och kastar om det innehåller hemliga nycklar eller någon annans hand.
   viewerId: den spelare som får se sin egen hand (null för offentliga objekt). */
export function assertNoSecrets(value, viewerId = null, path = 'objekt') {
  if (Array.isArray(value)) { value.forEach((item, i) => assertNoSecrets(item, viewerId, `${path}[${i}]`)); return; }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    check(!SECRET_KEYS.includes(key), `${path}.${key}`, 'Hemlig nyckel får inte lämna servern.');
    if (key === 'hand' && Array.isArray(child) && child.some(card => isObject(card) && 'cardId' in card)) {
      check(viewerId !== null && value.id === viewerId, `${path}.hand`, 'Endast den egna handen får innehålla kortdata.');
    }
    assertNoSecrets(child, viewerId, `${path}.${key}`);
  }
}

/* ---- Session (serverintern) och dess offentliga form ---- */
export function validateSession(session) {
  check(isObject(session), 'session', 'Sessionen måste vara ett objekt.');
  check(isId(session.playerId), 'session.playerId', 'Ogiltigt spelar-ID.');
  check(typeof session.nick === 'string' && typeof session.nickKey === 'string', 'session.nick', 'Nick och nickKey krävs.');
  check(typeof session.tokenHash === 'string' && session.tokenHash.length >= 16, 'session.tokenHash', 'Endast hash av token lagras.');
  check(!('token' in session), 'session.token', 'Sessionstoken i klartext får inte sparas.');
  check(isTime(session.expiresAt) && isTime(session.createdAt) && isTime(session.lastSeenAt), 'session.tider', 'Tider anges som heltal (ms).');
  check(isEnum(session.activity, ACTIVITY), 'session.activity', 'Okänd aktivitet.');
  check(isEnum(session.connection, CONNECTION), 'session.connection', 'Okänd anslutningsstatus.');
  check(isIdOrNull(session.roomId) && isIdOrNull(session.matchId), 'session.roomId', 'roomId/matchId ska vara ID eller null.');
  check(isCount(session.connectionGeneration), 'session.connectionGeneration', 'Anslutningsgeneration ska vara ett heltal.');
  return session;
}

export const publicSession = session => ({ playerId: session.playerId, nick: session.nick, activity: session.activity, connection: session.connection });

/* ---- Inbjudan ---- */
export function validateInvitation(invitation) {
  check(isObject(invitation), 'invitation', 'Inbjudan måste vara ett objekt.');
  check(isId(invitation.id) && isId(invitation.roomId), 'invitation.id', 'Ogiltigt ID.');
  check(isId(invitation.fromPlayerId) && isId(invitation.toPlayerId) && invitation.fromPlayerId !== invitation.toPlayerId, 'invitation.players', 'Avsändare och mottagare måste vara olika spelare.');
  check(isTime(invitation.expiresAt), 'invitation.expiresAt', 'Utgångstid krävs.');
  check(isEnum(invitation.status, INVITATION), 'invitation.status', 'Okänd status.');
  return invitation;
}

/* ---- Rum och lag ---- */
export function validateRoom(room) {
  check(isObject(room), 'room', 'Rummet måste vara ett objekt.');
  check(isId(room.id), 'room.id', 'Ogiltigt rums-ID.');
  check(isEnum(room.status, ROOM), 'room.status', 'Okänd rumsstatus.');
  check(isCount(room.rosterVersion) && isCount(room.roomRevision), 'room.versions', 'rosterVersion och roomRevision ska vara heltal.');
  check(isIdOrNull(room.matchId), 'room.matchId', 'matchId ska vara ID eller null.');
  check(Array.isArray(room.players) && room.players.length <= MAX_ROOM_SIZE, 'room.players', `Högst ${MAX_ROOM_SIZE} deltagare.`);
  const ids = new Set();
  room.players.forEach((member, i) => {
    const field = `room.players[${i}]`;
    check(isObject(member) && isId(member.playerId), field, 'Ogiltig deltagare.');
    check(!ids.has(member.playerId), field, 'Samma spelare finns två gånger i rummet.');
    ids.add(member.playerId);
    check(typeof member.nick === 'string', `${field}.nick`, 'Nick krävs.');
    check(isTeam(member.teamId), `${field}.teamId`, 'Laget måste vara A, B eller null.');
    check(isEnum(member.connection, CONNECTION), `${field}.connection`, 'Okänd anslutningsstatus.');
    check(typeof member.ready === 'boolean', `${field}.ready`, 'Redo ska vara true/false.');
    check(member.readyRosterVersion === null || isCount(member.readyRosterVersion), `${field}.readyRosterVersion`, 'Redo knyts till en rosterVersion eller null.');
    check(isTime(member.joinedAt), `${field}.joinedAt`, 'Anslutningstid krävs.');
  });
  check(room.players.length === 0 ? room.status === ROOM.closed : ids.has(room.hostPlayerId), 'room.hostPlayerId', 'Värden måste vara en deltagare; ett tomt rum är stängt.');
  assertNoSecrets(room);
  return room;
}

export const teamSizes = room => Object.fromEntries(TEAM_IDS.map(id => [id, room.players.filter(member => member.teamId === id).length]));

/* ---- Kommando (klient -> server) ---- */
export function validateCommand(command) {
  check(isObject(command), 'command', 'Kommandot måste vara ett objekt.');
  check(command.protocolVersion === PROTOCOL_VERSION, 'command.protocolVersion', `Protokollversion ${PROTOCOL_VERSION} krävs.`);
  check(isId(command.commandId), 'command.commandId', 'commandId krävs (1–64 tecken A–Z, 0–9, -, _).');
  const type = command.type;
  const isMatch = isEnum(type, MATCH_COMMAND);
  check(isMatch || isEnum(type, LOBBY_COMMAND), 'command.type', 'Okänd kommandotyp.');
  for (const forbidden of ['playerId', 'teamId', 'sessionId', 'token', 'life', 'winner']) {
    check(!(forbidden in command), `command.${forbidden}`, 'Identitet, lag, liv och vinnare bestäms av servern.');
  }
  const payload = command.payload ?? {};
  check(isObject(payload), 'command.payload', 'payload måste vara ett objekt.');
  check(!('playerId' in payload) && !('teamId' in payload && type !== LOBBY_COMMAND.team), 'command.payload', 'Identitet och lag bestäms av servern.');
  if (isMatch) {
    check(isId(command.matchId), 'command.matchId', 'Matchkommandon kräver matchId.');
    check(isCount(command.revision), 'command.revision', 'Matchkommandon kräver aktuell revision.');
  }
  if (ROOM_COMMANDS.has(type)) check(isId(command.roomId), 'command.roomId', 'Rumskommandon kräver roomId.');
  if (INVITATION_COMMANDS.has(type)) check(isId(payload.invitationId), 'command.payload.invitationId', 'Inbjudningskommandon kräver invitationId.');
  if (type === LOBBY_COMMAND.team) check(isTeam(payload.teamId), 'command.payload.teamId', 'Laget måste vara A, B eller null.');
  if (type === LOBBY_COMMAND.ready) check(typeof payload.ready === 'boolean' && isCount(payload.rosterVersion), 'command.payload', 'Redo kräver ready och rosterVersion.');
  if (type === LOBBY_COMMAND.invite) check(Array.isArray(payload.playerIds) && payload.playerIds.length > 0 && payload.playerIds.every(isId), 'command.payload.playerIds', 'Inbjudan kräver minst ett spelar-ID.');
  if (type === LOBBY_COMMAND.nick) normalizeNick(payload.nick);
  if (type === LOBBY_COMMAND.status) check(isId(payload.commandId), 'command.payload.commandId', 'Statusfråga kräver commandId.');
  if (type === MATCH_COMMAND.attack || type === MATCH_COMMAND.defend) check(isInstanceId(payload.instanceId), 'command.payload.instanceId', 'Kortexemplar krävs.');
  if (type === MATCH_COMMAND.target) check(isId(payload.targetPlayerId), 'command.payload.targetPlayerId', 'Måltavla krävs.');
  check(JSON.stringify(command).length <= MAX_COMMAND_BYTES, 'command', `Kommandot får vara högst ${MAX_COMMAND_BYTES} tecken.`);
  return command;
}

/* Fingeravtryck av kommandots innehåll (inte commandId): samma commandId med annat
   innehåll ska avvisas. FNV-1a över kanonisk JSON räcker för jämförelse, inte för säkerhet. */
export function commandFingerprint(command) {
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : isObject(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
  const text = JSON.stringify(canonical({ type: command.type, matchId: command.matchId ?? null, roomId: command.roomId ?? null, revision: command.revision ?? null, payload: command.payload ?? {} }));
  let hash = 0x811c9dc5;
  for (const char of text) {
    for (const byte of new TextEncoder().encode(char)) { hash ^= byte; hash = Math.imul(hash, 0x01000193) >>> 0; }
  }
  return hash.toString(16).padStart(8, '0');
}

/* ---- Kvittens (server -> klient) ---- */
export function validateReceipt(receipt) {
  check(isObject(receipt), 'receipt', 'Kvittensen måste vara ett objekt.');
  check(isId(receipt.commandId), 'receipt.commandId', 'commandId krävs.');
  check(isEnum(receipt.status, RECEIPT), 'receipt.status', 'Okänd kvittensstatus.');
  check(receipt.message === null || typeof receipt.message === 'string', 'receipt.message', 'message är text eller null.');
  for (const key of ['revision', 'roomRevision', 'eventId']) check(receipt[key] === null || isCount(receipt[key]), `receipt.${key}`, 'Heltal eller null.');
  check(receipt.fingerprint === null || typeof receipt.fingerprint === 'string', 'receipt.fingerprint', 'Fingeravtryck är text eller null.');
  if (receipt.status === RECEIPT.ok) check(receipt.fingerprint !== null, 'receipt.fingerprint', 'En godkänd kvittens bär kommandots fingeravtryck.');
  assertNoSecrets(receipt);
  return receipt;
}

/* ---- Händelse ---- */
export function validateEvent(event) {
  check(isObject(event), 'event', 'Händelsen måste vara ett objekt.');
  check(Number.isInteger(event.eventId) && event.eventId >= 1, 'event.eventId', 'eventId är ett löpnummer från 1.');
  check(isId(event.matchId) && isCount(event.revision), 'event.matchId', 'matchId och revision krävs.');
  check(typeof event.type === 'string' && event.type.length > 0, 'event.type', 'Händelsetyp krävs.');
  check(isTime(event.at), 'event.at', 'Tidsstämpel (ms) krävs.');
  check(isObject(event.data), 'event.data', 'data måste vara ett objekt.');
  check(isIdOrNull(event.recipient), 'event.recipient', 'recipient är spelar-ID eller null (offentlig).');
  assertNoSecrets(event, event.recipient);
  return event;
}

/* ---- Privat spelarvy (server -> en klient, eller lokaladapter -> vyn) ---- */
export function validatePrivateView(view) {
  check(isObject(view), 'view', 'Vyn måste vara ett objekt.');
  check(view.protocolVersion === PROTOCOL_VERSION, 'view.protocolVersion', 'Fel protokollversion.');
  check(isId(view.matchId) && isCount(view.revision) && isCount(view.lastEventId), 'view.matchId', 'matchId, revision och lastEventId krävs.');
  check(typeof view.rulesVersion === 'string' && typeof view.deckVersion === 'string', 'view.rulesVersion', 'Regel- och kortleksversion krävs.');
  check(isId(view.viewer), 'view.viewer', 'Egen identitet (viewer) krävs.');
  check(isTeam(view.teamId), 'view.teamId', 'teamId ska vara A, B eller null.');
  check(typeof view.phase === 'string', 'view.phase', 'Fas krävs.');
  check(isObject(view.me) && view.me.id === view.viewer, 'view.me', 'me måste vara samma spelare som viewer.');
  check(Array.isArray(view.me.hand) && view.me.hand.every(card => isObject(card) && isInstanceId(card.instanceId) && typeof card.cardId === 'string'), 'view.me.hand', 'Handen består av {instanceId, cardId}.');
  check(Array.isArray(view.players) && view.players.some(p => p.id === view.viewer), 'view.players', 'players måste innehålla alla deltagare inklusive viewer.');
  view.players.forEach((p, i) => {
    check(isObject(p) && isId(p.id) && typeof p.name === 'string' && isTeam(p.teamId) && isCount(p.life) && isCount(p.cardCount) && isEnum(p.status, PLAYER_STATUS) && isEnum(p.connection, CONNECTION), `view.players[${i}]`, 'Offentlig spelarinfo: id, name, teamId, life, cardCount, status, connection.');
  });
  check(Array.isArray(view.allowed), 'view.allowed', 'allowed (tillåtna egna val) krävs, tom lista om inget.');
  check(view.pending === null || (isObject(view.pending) && isId(view.pending.commandId) && isEnum(view.pending.status, RECEIPT)), 'view.pending', 'pending är null eller {commandId, status}.');
  check(view.deadline === null || (isObject(view.deadline) && isId(view.deadline.playerId) && isTime(view.deadline.at)), 'view.deadline', 'deadline är null eller {playerId, at}.');
  assertNoSecrets(view, view.viewer);
  return view;
}

/* ---- Adapter mellan matchvy och motor ---- */
export const ADAPTER_METHODS = Object.freeze({
  mode: 'ADAPTER_MODE.local eller .online',
  viewer: '() => playerId; fast under hela matchen, inte samma sak som aktiv spelare',
  view: '() => privat vy enligt validatePrivateView',
  send: '(command) => Promise<kvittens>; kommandot saknar playerId, adaptern fyller i identitet',
  status: '(commandId) => Promise<kvittens med status OKÄND om servern inte känner till kommandot>',
  subscribe: '(listener(view, events)) => avregistreringsfunktion; anropas efter varje ny bekräftad vy'
});

export function assertAdapter(adapter) {
  check(isObject(adapter), 'adapter', 'Adaptern måste vara ett objekt.');
  check(isEnum(adapter.mode, ADAPTER_MODE), 'adapter.mode', 'mode ska vara LOKAL eller ONLINE.');
  for (const name of Object.keys(ADAPTER_METHODS).filter(key => key !== 'mode')) {
    check(typeof adapter[name] === 'function', `adapter.${name}`, `Adaptern saknar ${name}().`);
  }
  return adapter;
}
