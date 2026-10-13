/* LokalMatch (arbetsordning L07): dagens duellmotor (match.js) och datorn (dator.js) bakom den
   gemensamma adaptergränsen i kontrakt.js. Matchvyn ser bara den privata vyn, tillåtna val och
   typade händelser – aldrig matchobjektet, andras händer eller `instances`.
   OnlineMatch (L09) ger samma sex metoder mot servern. Allt under `local` finns bara här:
   spelarbyte vid samma skärm, datorns beslut och utvecklingspanelens inblick. */
import { newMatch, process, playerView, allowedActions, cardType, PHASE, ACTION, STATUS } from './match.js';
import { decide, packAction, DecisionError } from './dator.js';
import { PROTOCOL_VERSION, ADAPTER_MODE, RECEIPT, PLAYER_STATUS, CONNECTION, commandFingerprint } from './kontrakt.js';

/* Händelsetyper som vyn och ljudet reagerar på (L19 knyter samma typer till serverns händelser). */
export const EVENT = Object.freeze({ log: 'LOGG', cardPlayed: 'KORT_SPELAT', pass: 'AVSTÅ', swap: 'BYTE', refill: 'PÅFYLLNING', firstAttacker: 'STARTSPELARE', result: 'RESULTAT', matchOver: 'MATCHSLUT', surrender: 'GE_UPP', next: 'FORTSÄTT' });

/* Privat vy enligt kontraktet, byggd av motorns playerView + allowedActions. I duellen är spelare A lag A och B lag B. */
export function privatVy(match, playerId, { lastEventId = 0, pending = null } = {}) {
  const v = playerView(match, playerId);
  return {
    ...v,
    protocolVersion: PROTOCOL_VERSION,
    lastEventId,
    viewer: playerId,
    teamId: playerId,
    players: v.players.map(p => ({ ...p, teamId: p.id, status: p.life > 0 ? PLAYER_STATUS.alive : PLAYER_STATUS.out, connection: CONNECTION.online })),
    allowed: allowedActions(match, playerId),
    pending,
    deadline: null
  };
}

/* Typade händelser ur ett motorsvar (delas av lokaladaptern och serverns duellmodul):
   vad som spelades, påfyllning, startspelare, resultat och matchslut, plus motorns loggrader. */
export function typadeHandelser({ before, after, replyEvents, action, nextEventId, at }) {
  let id = nextEventId;
  const out = [];
  const event = (type, data = {}) => ({ eventId: id++, matchId: after.id, revision: after.revision, type, at, data, recipient: null });
  const { type, playerId } = action;
  if (type === ACTION.attack || type === ACTION.defend) out.push(event(EVENT.cardPlayed, { playerId, cardId: before.instances[action.card], usage: action.usage ?? null, role: type === ACTION.attack ? 'attack' : 'defence', cardType: cardType(before.instances[action.card]).type }));
  if (type === ACTION.pass) out.push(event(EVENT.pass, { playerId }));
  if (type === ACTION.swap) out.push(event(EVENT.swap, { playerId, count: action.cards?.length ?? 0 }));
  if (type === ACTION.next) out.push(event(EVENT.next, { playerId }));
  if (type === ACTION.surrender) out.push(event(EVENT.surrender, { playerId }));
  for (const p of after.players) {
    const prev = before.players.find(q => q.id === p.id);
    if (type !== ACTION.swap && p.hand.length > prev.hand.length) out.push(event(EVENT.refill, { playerId: p.id, count: p.hand.length - prev.hand.length }));
  }
  if (before.phase === PHASE.swap && after.phase === PHASE.attack) out.push(event(EVENT.firstAttacker, { playerId: after.activePlayer }));
  if (after.phase === PHASE.result && before.phase !== PHASE.result) out.push(event(EVENT.result, { battleNumber: after.lastResult.battleNumber, attacker: after.lastResult.attacker, defender: after.lastResult.defender, defended: after.lastResult.defended, life: { ...after.lastResult.life }, startLife: { ...after.lastResult.startLife } }));
  if (after.phase === PHASE.over && before.phase !== PHASE.over) out.push(event(EVENT.matchOver, { winner: after.winner, endReason: after.endReason }));
  for (const text of replyEvents) out.push(event(EVENT.log, { text }));
  return out;
}

/* Kommando enligt kontraktet -> motorns handling. Identiteten sätts av adaptern, aldrig av vyn. */
const toAction = (playerId, command) => ({
  matchId: command.matchId, revision: command.revision, type: command.type, playerId,
  card: command.payload?.instanceId, usage: command.payload?.usage, cards: command.payload?.cards
});

export function skapaLokalMatch({ matchId, random = Math.random, names, viewer = 'A', computer = 'B', klocka = { now: () => Date.now() } } = {}) {
  let match = newMatch({ matchId, random, names });
  let viewerId = viewer;
  let eventId = 0;
  const listeners = new Set();
  const receipts = new Map();

  const view = () => privatVy(match, viewerId, { lastEventId: eventId });
  const event = (type, data = {}) => ({ eventId: ++eventId, matchId: match.id, revision: match.revision, type, at: klocka.now(), data, recipient: null });

  function utfor(action, command = null) {
    const before = match;
    const reply = process(match, action, random);
    const status = reply.status === STATUS.ok ? RECEIPT.ok : reply.status === STATUS.rejected ? RECEIPT.rejected : RECEIPT.error;
    let events = [];
    if (reply.status !== STATUS.rejected) {
      match = reply.match;
      events = reply.status === STATUS.ok ? typadeHandelser({ before, after: match, replyEvents: reply.events, action, nextEventId: eventId + 1, at: klocka.now() }) : [event(EVENT.log, { text: `Internt fel: ${reply.message}` })];
      eventId += events.length - (reply.status === STATUS.ok ? 0 : 1);
    }
    const receipt = { commandId: command?.commandId ?? `lokal-${eventId}`, status, message: reply.message, revision: match.revision, roomRevision: null, eventId: events.at(-1)?.eventId ?? null, fingerprint: command && status === RECEIPT.ok ? commandFingerprint(command) : null };
    if (command) receipts.set(command.commandId, receipt);
    if (reply.status !== STATUS.rejected) { const v = view(); for (const listener of listeners) listener(v, events); }
    return receipt;
  }

  const adapter = {
    mode: ADAPTER_MODE.local,
    viewer: () => viewerId,
    view,
    send: async command => utfor(toAction(viewerId, command), command),
    status: async commandId => receipts.get(commandId) ?? { commandId, status: RECEIPT.unknown, message: null, revision: null, roomRevision: null, eventId: null, fingerprint: null },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },

    /* Endast lokalt. Onlineadaptern saknar `local`, så vyn måste alltid kontrollera att det finns. */
    local: {
      matchId: () => match.id,
      /* Två spelare vid samma skärm: den vars tur det är ser sin hand. */
      setViewer(id) { viewerId = id; },
      activePlayer: () => match.activePlayer,
      newMatch(options = {}) { match = newMatch({ random, names, ...options }); eventId = 0; receipts.clear(); const v = view(); for (const listener of listeners) listener(v, []); },
      /* Datorns drag: beslutet tas på datorns egen privata vy, som aldrig lämnar adaptern. */
      computerDecision({ strategy, random: decisionRandom = random } = {}) {
        const computerView = playerView(match, computer);
        const decision = decide(computerView, { strategy, random: decisionRandom });
        if (!decision) throw new DecisionError('Beslutsfunktionen gav inget drag.');
        return { choice: decision.choice, reason: decision.reason, matchId: match.id, revision: match.revision };
      },
      computerSend(choice) {
        const computerView = playerView(match, computer);
        return utfor(packAction(choice, computerView));
      },
      /* Utvecklingspanelen: motståndarens kortnamn. Finns inte online. */
      revealHand(playerId) { return match.players.find(p => p.id === playerId)?.hand.map(id => cardType(match.instances[id]).name) ?? []; }
    }
  };
  return adapter;
}
