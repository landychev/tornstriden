/* Matchmotor för en lokal duell. Arbetar bara med data: läser aldrig
   HTML och ändrar aldrig sidan. Reglerna kommer från matchregler.js och
   stridsberäkningen från strid.js. Att flytta ett kort betyder att ta bort
   exemplaret från en plats och lägga samma exemplar på en annan. */
import { cards } from './kort.js';
import { resolve } from './strid.js';
import { rules, deck as lockedDeck, USAGE, buildDeck, battleCard, canAttack, canDefend, shuffle } from './matchregler.js';

export const PHASE = Object.freeze({ swap: 'KORTBYTE', attack: 'ANFALL', defence: 'FÖRSVAR', result: 'RESULTAT', over: 'AVSLUTAD', error: 'FEL' });
export const ACTION = Object.freeze({ swap: 'BEKRÄFTA_BYTE', attack: 'SPELA_ATTACK', defend: 'SPELA_FÖRSVAR', pass: 'AVSTÅ_FÖRSVAR', next: 'FORTSÄTT', surrender: 'GE_UPP' });
export const STATUS = Object.freeze({ ok: 'GODKÄND', rejected: 'AVVISAD', error: 'INTERNT_FEL' });
export const END = Object.freeze({ fallen: 'TORN_FALLET', surrendered: 'UPPGIVEN' });
export const PLAYERS = Object.freeze([{ id: 'A', name: 'Södra tornet' }, { id: 'B', name: 'Norra tornet' }]);

/* Ett ogiltigt spelarval: matchen lämnas orörd. Alla andra fel är interna. */
class Rejection extends Error {}
const reject = (condition, message) => { if (!condition) throw new Rejection(message); };
const invariant = (condition, message) => { if (!condition) throw new Error(message); };

export const cardType = cardId => cards.find(card => card.id === cardId);
export const opponentOf = playerId => playerId === 'A' ? 'B' : 'A';
const player = (match, id) => match.players.find(p => p.id === id);
const alive = p => p.life > 0;

/* ---- Kortexemplar och flyttar ---- */
function moveCard(instanceId, from, to) {
  const index = from.indexOf(instanceId);
  invariant(index !== -1 && from.lastIndexOf(instanceId) === index, `Exemplaret ${instanceId} finns inte exakt en gång där det ska flyttas från.`);
  invariant(!to.includes(instanceId), `Exemplaret ${instanceId} finns redan på målplatsen.`);
  from.splice(index, 1);
  to.push(instanceId);
}

function moveAll(from, to) {
  while (from.length) moveCard(from[0], from, to);
}

/* Stridsytan har en plats för attack och en för försvar. */
function playToBattle(match, hand, instanceId, slot) {
  invariant(!match.battle[slot], 'Stridsplatsen är redan upptagen.');
  const index = hand.indexOf(instanceId);
  invariant(index !== -1 && hand.lastIndexOf(instanceId) === index, `Exemplaret ${instanceId} finns inte exakt en gång på handen.`);
  hand.splice(index, 1);
  match.battle[slot] = instanceId;
}

function discardFromBattle(match, slot) {
  const instanceId = match.battle?.[slot];
  if (!instanceId) return;
  invariant(!match.discardPile.includes(instanceId), `Exemplaret ${instanceId} ligger redan i slänghögen.`);
  match.discardPile.push(instanceId);
  match.battle[slot] = null;
}

/* Varje exemplar ska finnas på exakt en plats. Körs efter varje godkänd handling. */
export function audit(match) {
  const places = [match.drawPile, match.discardPile, match.setAside, ...match.players.map(p => p.hand)];
  const inBattle = [match.battle?.attackInstance, match.battle?.defenceInstance].filter(Boolean);
  const all = [...places.flat(), ...inBattle];
  const known = Object.keys(match.instances);
  invariant(all.length === known.length && all.length === match.deckSize, `Kortbokföringen stämmer inte: ${all.length} exemplar på bordet, ${match.deckSize} i leken.`);
  const seen = new Set(all);
  invariant(seen.size === all.length, 'Ett exemplar finns på flera platser.');
  for (const id of known) invariant(seen.has(id), `Exemplaret ${id} saknas.`);
  for (const p of match.players) invariant(Number.isInteger(p.life) && p.life >= 0 && p.life <= match.rules.maxLife, `${p.name} har ogiltigt liv: ${p.life}.`);
  invariant(Object.values(PHASE).includes(match.phase), `Okänd fas: ${match.phase}`);
}

/* ---- Ny match ---- */
export function newMatch({ matchId, random = Math.random, shuffleFn, names = {} } = {}) {
  const id = matchId ?? `match-${Date.now().toString(36)}-${Math.floor(random() * 1e6).toString(36)}`;
  const instances = buildDeck({ matchId: id, copies: lockedDeck.copies, shuffleFn: shuffleFn ?? (list => shuffle(list, random)) });
  const match = {
    id,
    revision: 0,
    rulesVersion: rules.version,
    deckVersion: lockedDeck.version,
    rules: { ...rules },
    deckSize: instances.length,
    players: PLAYERS.map(p => ({ id: p.id, name: names[p.id] ?? p.name, life: rules.startLife, hand: [] })),
    instances: Object.fromEntries(instances.map(card => [card.id, card.cardId])),
    drawPile: instances.map(card => card.id),
    discardPile: [],
    setAside: [],
    phase: PHASE.swap,
    activePlayer: 'A',
    swapRound: 1,
    swapsConfirmed: { A: 0, B: 0 },
    attacker: null,
    battleNumber: 0,
    battle: null,
    lastResult: null,
    winner: null,
    endReason: null,
    error: null,
    log: []
  };
  for (let n = 0; n < rules.startCards; n++) for (const p of match.players) moveCard(match.drawPile[0], match.drawPile, p.hand);
  match.log.push(`Ny match. ${rules.startCards} kort och ${rules.startLife} liv var.`);
  audit(match);
  return match;
}

/* ---- Hjälpfunktioner för strid, påfyllning och turer ---- */
function drawOne(match, random, events) {
  if (!match.drawPile.length && match.discardPile.length) {
    moveAll(match.discardPile, match.drawPile);
    match.drawPile = shuffle(match.drawPile, random);
    events.push('Draghögen är slut – slänghögen blandas till ny draghög.');
  }
  return match.drawPile.length ? match.drawPile[0] : null;
}

function refillEmptyHands(match, nextAttacker, random, events) {
  const order = [player(match, nextAttacker), player(match, opponentOf(nextAttacker))];
  const recipients = order.filter(p => alive(p) && p.hand.length === 0);
  const drawn = Object.fromEntries(recipients.map(p => [p.id, 0]));
  rounds: for (let n = 0; n < match.rules.refillCards; n++) {
    for (const p of recipients) {
      const card = drawOne(match, random, events);
      if (!card) break rounds;
      moveCard(card, match.drawPile, p.hand);
      drawn[p.id] += 1;
    }
  }
  for (const p of recipients) events.push(`${p.name} hade tom hand och drar ${drawn[p.id]} nya kort.`);
}

function startBattle(match, attacker, events) {
  let a = player(match, attacker);
  let d = player(match, opponentOf(attacker));
  invariant(alive(a) && alive(d), 'En strid kan inte börja när ett torn redan har fallit.');
  if (!a.hand.length) {
    invariant(d.hand.length > 0, 'Båda händerna är tomma trots påfyllning – kortleken räcker inte.');
    events.push(`${a.name} har inga kort att anfalla med – turen går vidare.`);
    [a, d] = [d, a];
  }
  match.attacker = a.id;
  match.battleNumber += 1;
  match.battle = { number: match.battleNumber, attacker: a.id, defender: d.id, startLife: { A: player(match, 'A').life, B: player(match, 'B').life }, attackInstance: null, attackUsage: null, defenceInstance: null, defenceAnswered: false };
  match.phase = PHASE.attack;
  match.activePlayer = a.id;
  events.push(`Strid ${match.battleNumber}: ${a.name} anfaller.`);
}

function resolveBattle(match, events) {
  const { battle } = match;
  invariant(battle?.attackInstance && battle.defenceAnswered, 'Striden kan inte avgöras ännu.');
  const attacker = player(match, battle.attacker);
  const defender = player(match, battle.defender);
  const attackData = battleCard(match.instances[battle.attackInstance], battle.attackUsage);
  const defenceData = battle.defenceInstance ? battleCard(match.instances[battle.defenceInstance]) : null;
  const result = resolve({ attacker: attackData, defender: defenceData, attackerLife: battle.startLife[attacker.id], defenderLife: battle.startLife[defender.id] });
  attacker.life = result.attackerLife;
  defender.life = result.defenderLife;
  match.lastResult = {
    battleNumber: battle.number,
    attacker: attacker.id,
    defender: defender.id,
    attack: { instanceId: battle.attackInstance, cardId: match.instances[battle.attackInstance], usage: battle.attackUsage, name: attackData.name },
    defence: battle.defenceInstance ? { instanceId: battle.defenceInstance, cardId: match.instances[battle.defenceInstance], name: defenceData.name } : null,
    startLife: { ...battle.startLife },
    life: { A: player(match, 'A').life, B: player(match, 'B').life },
    attackStrength: result.attack,
    defenceStrength: result.defence,
    defended: result.defended,
    stopped: result.stopped,
    events: [...result.events]
  };
  events.push(`${attackData.name} (${result.attack}) mot ${defenceData ? `${defenceData.name} (${result.defence})` : 'inget försvar'}: ${result.defended ? 'försvaret håller.' : `${defender.name} förlorar ett liv.`}`);
  events.push(...result.events.filter(e => e !== 'Försvaret håller.' && e !== 'Försvararen förlorar ett liv.'));
  discardFromBattle(match, 'attackInstance');
  discardFromBattle(match, 'defenceInstance');
  match.battle = null;
  match.activePlayer = null;
  for (const p of match.players) {
    if (alive(p) || !p.hand.length) continue;
    events.push(`${p.name} faller – ${p.hand.length} kvarvarande handkort slängs.`);
    moveAll(p.hand, match.discardPile);
  }
  const fallen = match.players.filter(p => !alive(p));
  invariant(fallen.length < 2, 'Båda tornen föll i samma strid – regelfel.');
  if (fallen.length === 1) {
    match.winner = opponentOf(fallen[0].id);
    match.endReason = END.fallen;
    match.phase = PHASE.over;
    events.push(`${fallen[0].name} har fallit. ${player(match, match.winner).name} vinner matchen.`);
  } else {
    match.phase = PHASE.result;
  }
}

/* ---- Handlingar ---- */
const checkTurn = (match, action, phase) => {
  reject(match.phase === phase, 'Du kan inte göra det nu.');
  reject(action.playerId === match.activePlayer, 'Det är inte din tur.');
  reject(alive(player(match, action.playerId)), 'Ett fallet torn kan inte agera.');
};
const checkInHand = (match, playerId, instanceId) => {
  reject(typeof instanceId === 'string' && player(match, playerId).hand.includes(instanceId), 'Kortet finns inte på din hand.');
};

const handlers = {
  [ACTION.swap](match, action, { events }) {
    checkTurn(match, action, PHASE.swap);
    const p = player(match, action.playerId);
    reject(match.swapsConfirmed[p.id] === match.swapRound - 1, 'Du har redan bekräftat den här bytesomgången.');
    const chosen = Array.isArray(action.cards) ? action.cards : [];
    reject(chosen.length <= match.rules.maxCardsPerSwap, `Du får byta högst ${match.rules.maxCardsPerSwap} kort per omgång.`);
    reject(new Set(chosen).size === chosen.length, 'Samma kort är valt två gånger.');
    for (const id of chosen) checkInHand(match, p.id, id);
    invariant(match.drawPile.length >= chosen.length, 'Draghögen räcker inte till ersättningskorten.');
    for (const id of chosen) moveCard(id, p.hand, match.setAside);
    for (let n = 0; n < chosen.length; n++) moveCard(match.drawPile[0], match.drawPile, p.hand);
    match.swapsConfirmed[p.id] += 1;
    events.push(chosen.length ? `${p.name} byter ${chosen.length} kort (omgång ${match.swapRound}).` : `${p.name} behåller handen (omgång ${match.swapRound}).`);
    const waiting = match.players.find(other => match.swapsConfirmed[other.id] < match.swapRound);
    if (waiting) {
      match.activePlayer = waiting.id;
    } else if (match.swapRound < match.rules.swapRounds) {
      match.swapRound += 1;
      match.activePlayer = 'A';
    } else {
      moveAll(match.setAside, match.drawPile);
      match.drawPile = shuffle(match.drawPile, action.random);
      for (const q of match.players) invariant(q.hand.length === match.rules.startCards, `${q.name} har inte ${match.rules.startCards} kort efter startbytena.`);
      invariant(!match.discardPile.length, 'Slänghögen ska vara tom före första striden.');
      events.push('Startbytena är klara. Undanlagda kort blandas tillbaka i draghögen.');
      const first = action.random() < 0.5 ? 'A' : 'B';
      events.push(`Lotten ger ${player(match, first).name} första anfallet.`);
      startBattle(match, first, events);
    }
  },

  [ACTION.attack](match, action, { events }) {
    checkTurn(match, action, PHASE.attack);
    const { battle } = match;
    invariant(battle && battle.attacker === action.playerId && !battle.attackInstance, 'Anfallsfasen saknar giltig strid.');
    const p = player(match, action.playerId);
    checkInHand(match, p.id, action.card);
    const usage = action.usage ?? USAGE.normal;
    reject(Object.values(USAGE).includes(usage), 'Okänd användning av kortet.');
    const type = cardType(match.instances[action.card]);
    reject(canAttack(type, usage), usage === USAGE.simple ? 'Enkel attack är avstängd.' : `${type.name} kan inte spelas som vanlig attack. Välj enkel attack 1 i stället.`);
    playToBattle(match, p.hand, action.card, 'attackInstance');
    battle.attackUsage = usage;
    match.phase = PHASE.defence;
    match.activePlayer = battle.defender;
    events.push(`${p.name} anfaller med ${type.name}${usage === USAGE.simple ? ' som enkel attack 1, utan specialeffekt' : ''}.`);
  },

  [ACTION.defend](match, action, { events }) {
    checkTurn(match, action, PHASE.defence);
    const { battle } = match;
    invariant(battle && battle.defender === action.playerId && !battle.defenceAnswered, 'Försvarsfasen saknar giltig strid.');
    const p = player(match, action.playerId);
    checkInHand(match, p.id, action.card);
    const type = cardType(match.instances[action.card]);
    reject(canDefend(type), `${type.name} kan inte användas som försvar.`);
    playToBattle(match, p.hand, action.card, 'defenceInstance');
    battle.defenceAnswered = true;
    events.push(`${p.name} försvarar med ${type.name}.`);
    resolveBattle(match, events);
  },

  [ACTION.pass](match, action, { events }) {
    checkTurn(match, action, PHASE.defence);
    const { battle } = match;
    invariant(battle && battle.defender === action.playerId && !battle.defenceAnswered, 'Försvarsfasen saknar giltig strid.');
    battle.defenceInstance = null;
    battle.defenceAnswered = true;
    events.push(`${player(match, action.playerId).name} avstår från försvar.`);
    resolveBattle(match, events);
  },

  [ACTION.next](match, action, { events }) {
    reject(match.phase === PHASE.result, 'Det finns inget resultat att gå vidare från.');
    invariant(!match.winner && match.lastResult, 'Resultatfasen saknar giltigt resultat.');
    const nextAttacker = opponentOf(match.lastResult.attacker);
    refillEmptyHands(match, nextAttacker, action.random, events);
    startBattle(match, nextAttacker, events);
  },

  [ACTION.surrender](match, action, { events }) {
    reject([PHASE.swap, PHASE.attack, PHASE.defence, PHASE.result].includes(match.phase), 'Matchen kan inte ges upp nu.');
    const p = player(match, action.playerId);
    reject(Boolean(p), 'Okänd spelare.');
    reject(match.rules.surrender, 'Ge upp ingår inte i regelversionen.');
    discardFromBattle(match, 'attackInstance');
    discardFromBattle(match, 'defenceInstance');
    moveAll(match.setAside, match.discardPile);
    match.battle = null;
    match.winner = opponentOf(p.id);
    match.endReason = END.surrendered;
    match.phase = PHASE.over;
    match.activePlayer = null;
    events.push(`${p.name} ger upp. ${player(match, match.winner).name} vinner matchen.`);
  }
};

/* Den gemensamma vägen för alla handlingar, från människa, utvecklingsläge eller dator.
   AVVISAD lämnar matchen orörd. INTERNT_FEL byter till fasen FEL utan delvisa ändringar. */
export function process(match, action, random = Math.random) {
  const rejected = message => ({ status: STATUS.rejected, match, message, events: [] });
  if (!action || action.matchId !== match.id || action.revision !== match.revision) return rejected('Matchläget har ändrats – försök igen.');
  if (!handlers[action.type]) return rejected('Okänd handling.');
  if (match.phase === PHASE.over || match.phase === PHASE.error) return rejected('Matchen är avslutad. Starta en ny match.');
  if (action.playerId !== undefined && !player(match, action.playerId)) return rejected('Okänd spelare.');
  const work = structuredClone(match);
  const events = [];
  try {
    handlers[action.type](work, { ...action, random }, { events });
    audit(work);
  } catch (error) {
    if (error instanceof Rejection) return rejected(error.message);
    const failed = structuredClone(match);
    failed.phase = PHASE.error;
    failed.activePlayer = null;
    failed.error = error.message;
    failed.revision += 1;
    failed.log.push(`Internt fel: ${error.message}`);
    return { status: STATUS.error, match: failed, message: error.message, events: [] };
  }
  work.revision += 1;
  work.log.push(...events);
  return { status: STATUS.ok, match: work, message: null, events };
}

/* ---- Spelarvy: det en spelare (eller datorn) får se ---- */
export function playerView(match, playerId) {
  const me = player(match, playerId);
  const other = player(match, opponentOf(playerId));
  invariant(me && other, `Okänd spelare: ${playerId}`);
  const { battle } = match;
  return {
    matchId: match.id,
    revision: match.revision,
    rulesVersion: match.rulesVersion,
    deckVersion: match.deckVersion,
    rules: { ...match.rules },
    phase: match.phase,
    activePlayer: match.activePlayer,
    me: { id: me.id, name: me.name, life: me.life, hand: me.hand.map(instanceId => ({ instanceId, cardId: match.instances[instanceId] })) },
    opponent: { id: other.id, name: other.name, life: other.life, cardCount: other.hand.length },
    swapRound: match.swapRound,
    swapsConfirmed: { ...match.swapsConfirmed },
    battle: battle ? {
      number: battle.number,
      attacker: battle.attacker,
      defender: battle.defender,
      startLife: { ...battle.startLife },
      attack: battle.attackInstance ? { cardId: match.instances[battle.attackInstance], usage: battle.attackUsage } : null,
      defenceAnswered: battle.defenceAnswered
    } : null,
    lastResult: match.lastResult ? structuredClone(match.lastResult) : null,
    winner: match.winner,
    endReason: match.endReason,
    error: match.error,
    drawPileSize: match.drawPile.length,
    discardPile: match.discardPile.map(instanceId => match.instances[instanceId]),
    log: [...match.log]
  };
}

/* Tillåtna handlingar för en spelare i det aktuella läget, utan hemlig information. */
export function allowedActions(match, playerId) {
  const me = player(match, playerId);
  if (!me) return [];
  const actions = [];
  const mine = match.activePlayer === playerId && alive(me);
  const usable = card => ({ instanceId: card, cardId: match.instances[card] });
  if (match.phase === PHASE.swap && mine) actions.push({ type: ACTION.swap, maxCards: match.rules.maxCardsPerSwap, round: match.swapRound, cards: me.hand.map(usable) });
  if (match.phase === PHASE.attack && mine) {
    const normal = me.hand.filter(id => canAttack(cardType(match.instances[id]))).map(usable);
    const simple = match.rules.simpleAttack ? me.hand.map(usable) : [];
    actions.push({ type: ACTION.attack, normal, simple });
  }
  if (match.phase === PHASE.defence && mine) {
    actions.push({ type: ACTION.defend, cards: me.hand.filter(id => canDefend(cardType(match.instances[id]))).map(usable) });
    actions.push({ type: ACTION.pass });
  }
  if (match.phase === PHASE.result) actions.push({ type: ACTION.next });
  if (match.rules.surrender && [PHASE.swap, PHASE.attack, PHASE.defence, PHASE.result].includes(match.phase)) actions.push({ type: ACTION.surrender });
  return actions;
}
