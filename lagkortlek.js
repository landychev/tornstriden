/* Kortbokföring för lagmatcher (arbetsordning L10): utdelning, startbyten, påfyllning av tomma
   händer (22A) och flyttar mellan hand, bord och högar. Ingen stridsberäkning (L11), inga faser
   efter bytena eller turordning (L12) och inga avhoppsregler (L13) – bara att varje kortexemplar
   alltid finns på exakt ett ställe.

   Funktionerna ändrar det matchobjekt de får. Ett ogiltigt spelarval kastar `Avvisning` innan
   något ändrats; allt annat som kastar är ett internt fel. Lagmotorn (L12) arbetar på en kopia
   och sparar den bara om allt gick igenom, precis som duellens process() i match.js.

   Platsordning (tekniskt arbetsförslag, huvudplan §7): varje lags fasta ordning är den ordning
   spelarna har i rummet vid start. Bordet växlar mellan lagen: A1, B1, A2, B2 … Utdelning sker ett
   kort i taget runt bordet; påfyllning börjar hos den spelare som L12 anger (nästa anfallande lags
   startspelare) och fortsätter runt bordet. */
import { teamRules, teamDeck, buildTeamDeck, teamBattleCard, teamCanAttack, teamCanDefend, TEAM_SIZES, USAGE } from './lagregler.js';
import { shuffle } from './matchregler.js';
import { PLAYER_STATUS, TEAM_IDS } from './kontrakt.js';

export const TEAM_PHASE = Object.freeze({ swap: 'KORTBYTE', swapsDone: 'BYTEN_KLARA' });   // L12 lägger till stridsfaserna
export const ROLE = Object.freeze({ attack: 'attack', defence: 'defence' });

export class Avvisning extends Error {}
const reject = (condition, message) => { if (!condition) throw new Avvisning(message); };
const invariant = (condition, message) => { if (!condition) throw new Error(message); };

export const playerOf = (match, id) => match.players.find(p => p.id === id);
export const isAlive = p => Boolean(p) && p.status === PLAYER_STATUS.alive;
export const alivePlayers = match => match.players.filter(isAlive);

/* ---- Flyttar: ett exemplar lämnar exakt en plats och hamnar på en annan ---- */
function moveCard(instanceId, from, to) {
  const index = from.indexOf(instanceId);
  invariant(index !== -1 && from.lastIndexOf(instanceId) === index, `Exemplaret ${instanceId} finns inte exakt en gång där det ska flyttas från.`);
  invariant(!to.includes(instanceId), `Exemplaret ${instanceId} finns redan på målplatsen.`);
  from.splice(index, 1);
  to.push(instanceId);
}
const moveAll = (from, to) => { while (from.length) moveCard(from[0], from, to); };

/* Bordets ordning: lagens fasta ordningar flätade A1, B1, A2, B2 … */
export function seatOrder(teams) {
  const seats = [];
  for (let i = 0; i < Math.max(teams.A.length, teams.B.length); i++) for (const id of TEAM_IDS) if (teams[id][i]) seats.push(teams[id][i]);
  return seats;
}

/* Bordets ordning med början hos en viss spelare. */
export function orderFrom(match, startPlayerId) {
  const start = match.seats.indexOf(startPlayerId);
  invariant(start !== -1, `Okänd startspelare: ${startPlayerId}`);
  return [...match.seats.slice(start), ...match.seats.slice(0, start)];
}

/* ---- Ny lagmatch: validerad uppställning, blandad lek och tio kort var ---- */
export function newTeamMatch({ matchId, players, random = Math.random, shuffleFn } = {}) {
  invariant(Array.isArray(players) && TEAM_SIZES.includes(players.length), `Lagmatcher har 4, 6 eller 8 deltagare, inte ${players?.length}.`);
  invariant(new Set(players.map(p => p.id)).size === players.length, 'Samma spelare finns två gånger.');
  invariant(players.every(p => TEAM_IDS.includes(p.teamId)), 'Varje deltagare måste tillhöra lag A eller B.');
  const teams = Object.fromEntries(TEAM_IDS.map(t => [t, players.filter(p => p.teamId === t).map(p => p.id)]));
  invariant(teams.A.length === teams.B.length, `Lagen måste vara lika stora vid start (${teams.A.length} mot ${teams.B.length}).`);
  const size = players.length;
  const id = matchId ?? `lag-${Date.now().toString(36)}-${Math.floor(random() * 1e6).toString(36)}`;
  const instances = buildTeamDeck({ size, matchId: id, shuffleFn: shuffleFn ?? (list => shuffle(list, random)) });
  const deck = teamDeck(size);
  const match = {
    id,
    revision: 0,
    rulesVersion: teamRules.version,
    deckVersion: deck.version,
    rules: { ...teamRules, sizes: [...teamRules.sizes] },
    deckSize: instances.length,
    instances: Object.fromEntries(instances.map(card => [card.id, card.cardId])),
    drawPile: instances.map(card => card.id),
    discardPile: [],
    setAside: [],
    table: [],                // spelade kort: { instanceId, playerId, role, usage, targetCard, targetPlayer }
    players: players.map(p => ({ id: p.id, name: p.name ?? p.id, teamId: p.teamId, life: teamRules.startLife, hand: [], status: PLAYER_STATUS.alive })),
    teams,
    seats: seatOrder(teams),
    phase: TEAM_PHASE.swap,
    swapRound: 1,
    swapsConfirmed: Object.fromEntries(players.map(p => [p.id, 0])),
    refills: [],              // genomförda påfyllningar (t.ex. strid-ID) – samma påfyllning sker aldrig två gånger
    log: []
  };
  for (let n = 0; n < teamRules.startCards; n++) for (const pid of match.seats) moveCard(match.drawPile[0], match.drawPile, playerOf(match, pid).hand);
  match.log.push(`Ny lagmatch ${size / 2} mot ${size / 2}. ${teamRules.startCards} kort och ${teamRules.startLife} liv var. Kortlek ${deck.version}.`);
  auditTeam(match);
  return match;
}

/* ---- Startbyten: alla byter samtidigt inom en omgång; nästa omgång öppnar när alla levande bekräftat ---- */
export function confirmSwap(match, playerId, cardIds = [], random = Math.random) {
  const events = [];
  reject(match.phase === TEAM_PHASE.swap, 'Startbytena är redan klara.');
  const p = playerOf(match, playerId);
  reject(isAlive(p), p ? 'En utslagen spelare kan inte byta kort.' : 'Okänd spelare.');
  reject(match.swapsConfirmed[p.id] === match.swapRound - 1, 'Du har redan bekräftat den här bytesomgången. Väntar på de andra.');
  reject(Array.isArray(cardIds), 'Korten att byta ska anges som en lista (tom lista = behåll handen).');
  const chosen = cardIds;
  reject(chosen.length <= match.rules.maxCardsPerSwap, `Du får byta högst ${match.rules.maxCardsPerSwap} kort per omgång.`);
  reject(new Set(chosen).size === chosen.length, 'Samma kort är valt två gånger.');
  for (const id of chosen) reject(typeof id === 'string' && p.hand.includes(id), 'Kortet finns inte på din hand.');
  invariant(match.drawPile.length >= chosen.length, 'Draghögen räcker inte till ersättningskorten.');
  for (const id of chosen) moveCard(id, p.hand, match.setAside);
  for (let n = 0; n < chosen.length; n++) moveCard(match.drawPile[0], match.drawPile, p.hand);
  match.swapsConfirmed[p.id] += 1;
  events.push(chosen.length ? `${p.name} byter ${chosen.length} kort (omgång ${match.swapRound}).` : `${p.name} behåller handen (omgång ${match.swapRound}).`);
  events.push(...advanceSwapRound(match, random));
  auditTeam(match);
  return { events };
}

/* Nästa bytesomgång öppnar, eller bytena avslutas, när alla levande har bekräftat den aktuella omgången.
   Anropas efter varje bekräftelse och efter en utslagning under bytena (L13). */
export function advanceSwapRound(match, random = Math.random) {
  const events = [];
  while (match.phase === TEAM_PHASE.swap && alivePlayers(match).every(q => match.swapsConfirmed[q.id] >= match.swapRound)) {
    if (match.swapRound < match.rules.swapRounds) {
      match.swapRound += 1;
      events.push(`Bytesomgång ${match.swapRound} börjar.`);
    } else {
      moveAll(match.setAside, match.drawPile);
      match.drawPile = shuffle(match.drawPile, random);
      for (const q of alivePlayers(match)) invariant(q.hand.length === match.rules.startCards, `${q.name} har inte ${match.rules.startCards} kort efter startbytena.`);
      invariant(!match.table.length, 'Bordet ska vara tomt före första striden.');
      match.phase = TEAM_PHASE.swapsDone;
      events.push('Startbytena är klara. Undanlagda kort blandas tillbaka i draghögen.');
    }
  }
  return events;
}

/* Översta kortet i draghögen; när den är tom blandas slänghögen till ny draghög.
   Bordskort, handkort och undanlagda kort blandas aldrig in. */
function drawOne(match, random, stats, events) {
  if (!match.drawPile.length && match.discardPile.length) {
    moveAll(match.discardPile, match.drawPile);
    match.drawPile = shuffle(match.drawPile, random);
    stats.reshuffles += 1;
    events.push('Draghögen är slut – slänghögen blandas till ny draghög.');
  }
  return match.drawPile[0] ?? null;
}

/* 22A: levande spelare med helt tom hand får upp till fem kort, ett kort i taget runt bordet med
   början hos `startPlayerId`. Mottagarlistan bestäms före första kortet och ändras inte under
   utdelningen. Varje `refillId` (t.ex. stridens nummer) genomförs högst en gång. */
export function refillEmptyHands(match, { startPlayerId, refillId, random = Math.random } = {}) {
  invariant(refillId !== undefined && refillId !== null, 'Påfyllningen behöver ett ID så att den inte kan ske två gånger.');
  const events = [];
  const stats = { reshuffles: 0 };
  if (match.refills.includes(refillId)) return { drawn: {}, recipients: [], reshuffles: 0, events, already: true };
  invariant(match.phase !== TEAM_PHASE.swap, 'Ingen påfyllning under startbytena.');
  const recipients = orderFrom(match, startPlayerId).map(id => playerOf(match, id)).filter(p => isAlive(p) && p.hand.length === 0);
  const drawn = Object.fromEntries(recipients.map(p => [p.id, 0]));
  rounds: for (let n = 0; n < match.rules.refillCards; n++) {
    for (const p of recipients) {
      const card = drawOne(match, random, stats, events);
      if (!card) break rounds;
      moveCard(card, match.drawPile, p.hand);
      drawn[p.id] += 1;
    }
  }
  for (const p of recipients) events.push(`${p.name} hade tom hand och drar ${drawn[p.id]} nya kort.`);
  match.refills.push(refillId);
  auditTeam(match);
  return { drawn, recipients: recipients.map(p => p.id), reshuffles: stats.reshuffles, events, already: false };
}

/* ---- Bordet ---- */
/* Lägger ett eget handkort på bordet. Användningen (vanlig/enkel attack) och eventuella mål låses med kortet (23A).
   Vem som får spela när, och hur många kort, avgör lagmotorn (L12). */
export function playToTable(match, playerId, instanceId, { role, usage = USAGE.normal, targetCard = null, targetPlayer = null } = {}) {
  const p = playerOf(match, playerId);
  reject(isAlive(p), p ? 'En utslagen spelare kan inte spela kort.' : 'Okänd spelare.');
  reject(Object.values(ROLE).includes(role), 'Okänd roll för kortet.');
  reject(Object.values(USAGE).includes(usage), 'Okänd användning av kortet.');
  reject(typeof instanceId === 'string' && p.hand.includes(instanceId), 'Kortet finns inte på din hand.');
  const card = teamBattleCard(match.instances[instanceId]);
  if (role === ROLE.attack) reject(teamCanAttack(card, usage), `${card.name} kan inte spelas som vanlig attack. Välj enkel attack 1 i stället.`);
  else reject(usage === USAGE.normal && teamCanDefend(card), usage === USAGE.simple ? 'Enkel attack kan inte användas för försvar.' : `${card.name} kan inte användas som försvar.`);
  const index = p.hand.indexOf(instanceId);
  p.hand.splice(index, 1);
  /* Kortmål (exemplar) och spelarmål binds med kortet (16A, 17A); giltigheten prövas av lagmotorn (L12). */
  const entry = Object.freeze({ instanceId, playerId: p.id, role, usage, targetCard: role === ROLE.defence ? targetCard : null, targetPlayer: role === ROLE.defence ? targetPlayer : null });
  match.table.push(entry);
  auditTeam(match);
  return entry;
}

/* Alla spelade kort till slänghögen (efter avgjord eller avbruten strid). */
export function discardTable(match) {
  const ids = match.table.map(entry => entry.instanceId);
  match.table = [];
  for (const id of ids) { invariant(!match.discardPile.includes(id), `Exemplaret ${id} ligger redan i slänghögen.`); match.discardPile.push(id); }
  auditTeam(match);
  return ids.length;
}

/* En spelares egna bordskort till slänghögen (används av avhoppsreglerna i L13, beslut 12B). */
export function discardTableCardsOf(match, playerId) {
  const own = match.table.filter(entry => entry.playerId === playerId);
  match.table = match.table.filter(entry => entry.playerId !== playerId);
  for (const entry of own) match.discardPile.push(entry.instanceId);
  auditTeam(match);
  return own.map(entry => entry.instanceId);
}

/* En spelares hela hand till slänghögen (utslagning, L13). Lekens storlek ändras inte. */
export function discardHand(match, playerId) {
  const p = playerOf(match, playerId);
  invariant(p, `Okänd spelare: ${playerId}`);
  const count = p.hand.length;
  moveAll(p.hand, match.discardPile);
  auditTeam(match);
  return count;
}

/* ---- Kortbokföring: varje exemplar på exakt en plats, inga okända eller saknade ---- */
export function auditTeam(match) {
  const tableIds = match.table.map(entry => entry.instanceId);
  const all = [...match.drawPile, ...match.discardPile, ...match.setAside, ...tableIds, ...match.players.flatMap(p => p.hand)];
  const known = Object.keys(match.instances);
  invariant(known.length === match.deckSize && all.length === match.deckSize, `Kortbokföringen stämmer inte: ${all.length} exemplar på bordet, ${match.deckSize} i leken.`);
  const seen = new Set(all);
  invariant(seen.size === all.length, 'Ett exemplar finns på flera platser.');
  for (const id of known) invariant(seen.has(id), `Exemplaret ${id} saknas.`);
  invariant(match.phase === TEAM_PHASE.swap || match.setAside.length === 0, 'Undanlagda kort finns kvar efter startbytena.');
  for (const entry of match.table) invariant(playerOf(match, entry.playerId), `Bordskortet ${entry.instanceId} saknar ägare.`);
  for (const p of match.players) invariant(Number.isInteger(p.life) && p.life >= 0 && p.life <= match.rules.maxLife, `${p.name} har ogiltigt liv: ${p.life}.`);
  return true;
}
