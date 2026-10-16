/* Privat lagvy och typade lagmatchhändelser (arbetsordning L14). Ren data utan Node-beroenden, så att
   servern (online/lagspel.js) och lagvyn i webbläsaren (L15) delar samma form.

   Vyn byggs ur lagmotorns läge (lagmatch.js) men innehåller bara offentlig information plus den egna
   handen: aldrig `instances`, draghögens ordning, undanlagda kort eller någon annans hand. Kort på bordet
   och i senaste resultat är offentliga (de ligger med framsidan upp). Tillåtna val beräknas av motorn;
   vyn lägger bara till Lämna matchen (GE_UPP) för en levande spelare medan matchen pågår.

   Händelserna är offentliga (recipient null) och bär aldrig kortexemplar ur någon hand. */
import { allowedActions, LAG_FAS, LAG_HANDLING } from './lagmatch.js';
import { isAlive } from './lagkortlek.js';
import { USAGE } from './lagregler.js';
import { beraknaLagstrid, underlagFranMatch, OUTCOME } from './lagstrid.js';
import { cards } from './kort.js';
import { EVENT } from './lokalmatch.js';
import { PROTOCOL_VERSION, CONNECTION, TEAM_FORMAT } from './kontrakt.js';

export const LAG_FORMAT = TEAM_FORMAT;
/* Samma typer som duellen där det går, plus lagmatchens egna. */
export const LAG_EVENT = Object.freeze({ ...EVENT, confirm: 'BEKRÄFTELSE', target: 'MÅLVAL' });

const PAGAR = [LAG_FAS.swap, LAG_FAS.start, LAG_FAS.target, LAG_FAS.attack, LAG_FAS.defence, LAG_FAS.result];
const kortTyp = cardId => cards.find(card => card.id === cardId)?.type ?? null;
const bordskort = (match, e) => ({ instanceId: e.instanceId, cardId: match.instances[e.instanceId], playerId: e.playerId, role: e.role, usage: e.usage, targetCard: e.targetCard ?? null, targetPlayer: e.targetPlayer ?? null });
const vantarPa = (match, by) => match.players.filter(p => isAlive(p) && !by[p.id]).map(p => p.id);

/* Förhandsvisning under striden (huvudplan §7, effektordningen): samma beräkning som avgörandet, på korten som
   ligger på bordet just nu – utan livsändringar, utslagningar eller förklaringsrader, så att inget ser avgjort ut.
   Allt som används är offentligt: bordets kort, tornens liv och livet vid stridens början. */
function forhandsvisning(match) {
  const b = match.battle;
  if (!b?.target) return null;
  const r = beraknaLagstrid(underlagFranMatch(match, { targetPlayerId: b.target, startLife: b.startLife }));
  if (r.outcome === OUTCOME.aborted) return null;
  return { attack: r.attack, defence: r.defence, defended: r.defended, cards: structuredClone(r.cards), stopped: [...r.stopped], deductions: { ...r.deductions } };
}

/* Privat vy för en deltagare enligt kontraktet (validatePrivateView) med lagmatchens fält. */
/* `avbrott` (L17) ger varje frånkopplad spelares återanslutningsfrist; en pausad turklocka visas inte.
   `klockor` (L16) är serverns spelarklockor { [spelare]: { deadline } }: deadlines är offentliga (alla ser vem
   som väntas på), `deadline` är den egna. `serverTid` låter klienten räkna ned oberoende av sin egen klocka. */
export function lagVy(match, playerId, { lastEventId = 0, anslutning = {}, pending = null, matchStatus = null, klockor = null, avbrott = null, serverTid = null } = {}) {
  const me = match.players.find(p => p.id === playerId);
  if (!me) return null;
  const allowed = allowedActions(match, playerId);
  if (PAGAR.includes(match.phase) && isAlive(me)) allowed.push({ type: LAG_HANDLING.leave });
  const b = match.battle;
  const levande = match.players.filter(isAlive);
  return {
    protocolVersion: PROTOCOL_VERSION,
    format: LAG_FORMAT,
    matchId: match.id,
    revision: match.revision,
    lastEventId,
    rulesVersion: match.rulesVersion,
    deckVersion: match.deckVersion,
    matchStatus,
    viewer: me.id,
    teamId: me.teamId,
    phase: match.phase,
    me: { id: me.id, name: me.name, teamId: me.teamId, life: me.life, status: me.status, eliminationReason: me.eliminationReason ?? null, hand: me.hand.map(id => ({ instanceId: id, cardId: match.instances[id] })) },
    players: match.players.map(p => ({ id: p.id, name: p.name, teamId: p.teamId, life: p.life, cardCount: p.hand.length, status: p.status, eliminationReason: p.eliminationReason ?? null, connection: anslutning[p.id] ?? CONNECTION.online })),
    teams: { A: [...match.teams.A], B: [...match.teams.B] },
    seats: [...match.seats],
    rules: { startLife: match.rules.startLife, startCards: match.rules.startCards, swapRounds: match.rules.swapRounds, maxCardsPerSwap: match.rules.maxCardsPerSwap, refillCards: match.rules.refillCards, simpleAttackStrength: match.rules.simpleAttackStrength },
    swap: match.phase === LAG_FAS.swap ? {
      round: match.swapRound, rounds: match.rules.swapRounds, maxCards: match.rules.maxCardsPerSwap,
      confirmed: levande.filter(p => match.swapsConfirmed[p.id] >= match.swapRound).map(p => p.id),
      waitingFor: levande.filter(p => match.swapsConfirmed[p.id] < match.swapRound).map(p => p.id),
      mine: match.swapsConfirmed[me.id] >= match.swapRound
    } : null,
    attackingTeam: match.attackingTeam,
    battleNumber: match.battleNumber,
    activePlayer: match.activePlayer,
    nextLeader: { ...match.nextLeader },
    battle: b ? {
      number: b.number, attackingTeam: b.attackingTeam, leader: b.leader, target: b.target,
      attackQueue: [...b.attackQueue], attackIndex: b.attackIndex, defenceQueue: [...b.defenceQueue], defenceIndex: b.defenceIndex,
      turns: b.turns.map(t => ({ ...t })), startLife: { ...b.startLife }, table: match.table.map(e => bordskort(match, e)),
      preview: forhandsvisning(match)
    } : null,
    confirm: match.confirm ? { kind: match.confirm.kind, confirmed: Object.keys(match.confirm.by).filter(id => match.confirm.by[id]), waitingFor: vantarPa(match, match.confirm.by), mine: Boolean(match.confirm.by[me.id]) } : null,
    drawPileCount: match.drawPile.length,
    discardPileCount: match.discardPile.length,
    lastResult: match.lastResult ? structuredClone(match.lastResult) : null,
    winnerTeam: match.winnerTeam,
    endReason: match.endReason,
    log: match.log.slice(-40),
    allowed,
    pending,
    deadline: Number.isFinite(klockor?.[playerId]?.deadline) ? { playerId, at: klockor[playerId].deadline } : null,
    clocks: Object.fromEntries(Object.entries(klockor ?? {}).filter(([, k]) => Number.isFinite(k.deadline)).map(([id, k]) => [id, k.deadline])),
    disconnects: Object.fromEntries(Object.entries(avbrott ?? {}).map(([id, a]) => [id, a.deadline])),   // L17: återanslutningsfrist per frånkopplad
    serverTime: serverTid
  };
}

/* Offentlig sammanfattning av ett stridsresultat för händelsen (hela resultatet finns i vyn). */
const resultatData = r => ({
  battleNumber: r.battleNumber, attackingTeam: r.attackingTeam, leader: r.leader, target: r.target, outcome: r.outcome, reason: r.reason,
  attack: r.attack, defence: r.defence, defended: r.defended, lifeDelta: { ...r.lifeDelta }, life: { ...r.life }, startLife: { ...r.startLife }, eliminated: [...r.eliminated]
});

/* Typade händelser ur ett godkänt motorsteg: valet, resultat, utslagning, påfyllning, ny strid/startspelare,
   matchslut och motorns loggrader – i den ordningen. */
export function lagHandelser({ before, after, replyEvents = [], action, nextEventId, at }) {
  let id = nextEventId;
  const out = [];
  const event = (type, data = {}) => out.push({ eventId: id++, matchId: after.id, revision: after.revision, type, at, data, recipient: null });
  const { type, playerId } = action;
  const H = LAG_HANDLING;
  if (type === H.swap) event(LAG_EVENT.swap, { playerId, count: Array.isArray(action.cards) ? action.cards.length : 0, round: before.swapRound });
  if (type === H.confirmStart || type === H.next) event(LAG_EVENT.confirm, { kind: type, playerId, waitingFor: after.confirm?.kind === type ? vantarPa(after, after.confirm.by) : [] });
  if (type === H.target) event(LAG_EVENT.target, { playerId, target: action.target });
  if (type === H.attack || type === H.defend) {
    const cardId = before.instances[action.card];
    event(LAG_EVENT.cardPlayed, { playerId, cardId, usage: type === H.attack ? action.usage ?? USAGE.normal : USAGE.normal, role: type === H.attack ? 'attack' : 'defence', cardType: kortTyp(cardId), targetCard: type === H.defend ? action.targetCard ?? null : null, targetPlayer: type === H.defend ? action.targetPlayer ?? null : null });
  }
  if (type === H.passAttack || type === H.passDefence) event(LAG_EVENT.pass, { playerId, role: type === H.passAttack ? 'attack' : 'defence' });
  if (type === H.leave) event(LAG_EVENT.surrender, { playerId });
  if (after.lastResult && after.lastResult.battleNumber !== before.lastResult?.battleNumber) event(LAG_EVENT.result, resultatData(after.lastResult));
  for (const p of after.players) {
    const prev = before.players.find(q => q.id === p.id);
    if (isAlive(prev) && !isAlive(p)) event(LAG_EVENT.eliminated, { playerId: p.id, reason: p.eliminationReason ?? null });
  }
  /* Påfyllningen läses ur motorns egen redovisning: en jämförelse av handstorlekar blir fel när samma steg
     både spelar spelarens sista kort och fyller handen (granskning L14). */
  if (after.lastRefill && after.lastRefill.refillId !== before.lastRefill?.refillId) {
    for (const [playerId, count] of Object.entries(after.lastRefill.drawn)) if (count > 0) event(LAG_EVENT.refill, { playerId, count });
  }
  if (before.phase === LAG_FAS.result && ![LAG_FAS.result, LAG_FAS.over].includes(after.phase)) event(LAG_EVENT.next, { battleNumber: before.lastResult?.battleNumber ?? null });
  if (after.phase === LAG_FAS.target && after.battle && (before.phase !== LAG_FAS.target || before.battle?.leader !== after.battle.leader || before.battle?.attackingTeam !== after.battle.attackingTeam)) {
    event(LAG_EVENT.firstAttacker, { playerId: after.battle.leader, teamId: after.battle.attackingTeam, battleNumber: after.battle.number });
  }
  if (after.phase === LAG_FAS.over && before.phase !== LAG_FAS.over) event(LAG_EVENT.matchOver, { winnerTeam: after.winnerTeam, endReason: after.endReason });
  for (const text of replyEvents) event(LAG_EVENT.log, { text });
  return out;
}
