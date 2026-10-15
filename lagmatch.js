/* Lagmatchens faser och turordning (arbetsordning L12, huvudplan §7 och §9, beslut 6A, 10A, 21A–23A)
   samt individuell utslagning och avhopp (L13, huvudplan §10, beslut 8A, 12B, 13A, 17A, 24B).
   Samma mönster som duellens match.js: all spellogik går genom processLag() eller slaUt(), som arbetar
   på en kopia, kontrollerar kortbokföringen och höjer revisionen en gång per godkänd händelse. Ett
   ogiltigt spelarval lämnar matchen orörd; ett internt fel ger fasen FEL utan vinnare.

   Flöde:
     KORTBYTE            alla levande byter samtidigt inom en omgång (lagkortlek.js)
     STARTBEKRÄFTELSE    lotten avgör första anfallande lag; alla levande bekräftar startmeddelandet
     MÅLVAL              lagets startspelare väljer en levande fiende som måltavla
     ANFALL              anfallskö: startspelaren och sedan levande lagkamrater i fast ordning, högst ett kort
                         eller avstå var; laget måste bidra med minst ett kort; alla kort duger som enkel attack
     FÖRSVAR             försvarskö: måltavlan först, sedan levande lagkamrater i fast ordning; ett kort eller avstå
     RESULTAT            lagstriden beräknas en gång (lagstrid.js), liv sparas, utslagna registreras, bordet
                         slängs, tomma händer fylls (22A); alla levande bekräftar Fortsätt
     AVSLUTAD            ett lag saknar levande spelare (eller inget lag har några kvar)

   21A: varje lag har en pekare till nästa startspelare. Efter varje anfall flyttas pekaren till nästa
   levande lagkamrat; utslagna hoppas över utan att ordningen mellan övriga ändras.

   Utslagning (L13): en spelare slås ut individuellt när hen lämnar (GE_UPP = Lämna matchen), och senare
   av tidsgräns (L16) eller avbrott (L17) via slaUt(). Prioritet vid avhopp: matchslut prövas först; lämnar
   måltavlan i en öppen strid avbryts striden utan effekter (13A); annars tas spelarens bordskort bort (12B)
   och de återstående köerna fortsätter; finns inga anfallskort kvar vid avgörandet håller försvaret (24B).
   Ett redan sparat stridsresultat ändras aldrig. Laget fortsätter med färre spelare (8A). */
import { newTeamMatch, confirmSwap, advanceSwapRound, refillEmptyHands, playToTable, discardTable, discardTableCardsOf, discardHand, auditTeam, playerOf, isAlive, alivePlayers, TEAM_PHASE, ROLE, Avvisning } from './lagkortlek.js';
import { beraknaLagstrid, giltigaKortmal, giltigaSpelarmal, underlagFranMatch, OUTCOME, ABORT } from './lagstrid.js';
import { teamBattleCard, teamCanAttack, teamCanDefend, USAGE } from './lagregler.js';
import { MATCH_COMMAND, PLAYER_STATUS, TEAMS, TEAM_IDS, TEAM_MATCH_PHASE, TEAM_END, ELIMINATION } from './kontrakt.js';
import { STATUS } from './match.js';

export const LAG_FAS = TEAM_MATCH_PHASE;   // faser, utfall och orsaker finns i kontrakt.js så att lagvyn kan läsa dem
export const LAG_HANDLING = Object.freeze({
  swap: MATCH_COMMAND.swap, confirmStart: MATCH_COMMAND.confirmStart, target: MATCH_COMMAND.target,
  attack: MATCH_COMMAND.attack, passAttack: MATCH_COMMAND.passAttack, defend: MATCH_COMMAND.defend,
  passDefence: MATCH_COMMAND.pass, next: MATCH_COMMAND.next,
  leave: MATCH_COMMAND.surrender   // i lagmatch betyder GE_UPP "Lämna matchen": bara den egna spelaren slås ut
});
export const LAG_SLUT = TEAM_END;
export const UTSLAG = ELIMINATION;
export { STATUS };

const reject = (condition, message) => { if (!condition) throw new Avvisning(message); };
const invariant = (condition, message) => { if (!condition) throw new Error(message); };
const otherTeam = team => team === 'A' ? 'B' : 'A';
const teamName = team => TEAMS.find(t => t.id === team).name;
const nameOf = (match, id) => playerOf(match, id)?.name ?? id;
const RUNNING = [LAG_FAS.swap, LAG_FAS.start, LAG_FAS.target, LAG_FAS.attack, LAG_FAS.defence, LAG_FAS.result];

/* ---- Turordning ---- */
/* Lagets fasta ordning med början hos `startId` (inklusive). */
function rotated(match, team, startId) {
  const order = match.teams[team];
  const start = order.indexOf(startId);
  invariant(start !== -1, `${startId} finns inte i ${teamName(team)}.`);
  return [...order.slice(start), ...order.slice(0, start)];
}
/* Första levande spelaren i lagets ordning från `fromId`; `inclusive` avgör om fromId själv räknas. */
export function nextAlive(match, team, fromId, { inclusive }) {
  const order = rotated(match, team, fromId);
  return (inclusive ? order : [...order.slice(1), order[0]]).find(id => isAlive(playerOf(match, id))) ?? null;
}
const teamAlive = (match, team) => match.teams[team].some(id => isAlive(playerOf(match, id)));
const teamHasCards = (match, team) => match.teams[team].some(id => { const p = playerOf(match, id); return isAlive(p) && p.hand.length > 0; });
export const leaderOf = (match, team) => nextAlive(match, team, match.nextLeader[team], { inclusive: true });

/* ---- Ny lagmatch ---- */
export function newLagmatch({ matchId, players, random = Math.random, shuffleFn } = {}) {
  const match = newTeamMatch({ matchId, players, random, shuffleFn });
  Object.assign(match, {
    attackingTeam: null,
    nextLeader: { A: match.teams.A[0], B: match.teams.B[0] },
    battleNumber: 0,
    battle: null,
    confirm: null,              // { kind: BEKRÄFTA_START | FORTSÄTT, by: { spelar-ID: true } }
    activePlayer: null,         // den vars val krävs i MÅLVAL/ANFALL/FÖRSVAR
    lastResult: null,
    lastRefill: null,           // senaste påfyllningen { refillId, drawn: { spelar-ID: antal } } för händelserna
    winnerTeam: null,
    endReason: null,
    error: null
  });
  for (const p of match.players) p.eliminationReason = null;
  return match;
}

/* ---- Strid ---- */
/* Startar nästa strid för `team`. Skyddsregel (huvudplan §7): saknar laget handkort går turen till det
   andra laget; saknar båda kort är kortbokföringen fel och matchen pausas (internt fel, ingen vinnare).
   `sameNumber` återanvänder stridsnumret när en strid som ännu inte fått några kort startas om (L13). */
function startBattle(match, team, events, { switched = false, sameNumber = false } = {}) {
  if (!teamHasCards(match, team)) {
    invariant(!switched && teamHasCards(match, otherTeam(team)), 'Inget lag har handkort kvar – kortbokföringen behöver kontrolleras.');
    events.push(`${teamName(team)} saknar handkort – turen går till ${teamName(otherTeam(team))}.`);
    return startBattle(match, otherTeam(team), events, { switched: true, sameNumber });
  }
  const leader = leaderOf(match, team);
  invariant(leader, `${teamName(team)} saknar levande spelare.`);
  if (!sameNumber) match.battleNumber += 1;
  match.attackingTeam = team;
  match.battle = {
    number: match.battleNumber, attackingTeam: team, leader, target: null,
    startLife: Object.fromEntries(alivePlayers(match).map(p => [p.id, p.life])),
    attackQueue: [], attackIndex: 0, defenceQueue: [], defenceIndex: 0, turns: []
  };
  match.phase = LAG_FAS.target;
  match.activePlayer = leader;
  match.confirm = null;
  events.push(`Strid ${match.battleNumber}: ${teamName(team)} anfaller. ${nameOf(match, leader)} väljer måltavla.`);
}

const canPassAttack = match => match.table.some(e => e.role === ROLE.attack) || match.battle.attackIndex < match.battle.attackQueue.length - 1;

/* Anfallet låses när kön är slut; försvarskön är måltavlan först och sedan levande lagkamrater i fast ordning. */
function lockAttack(match, random, events) {
  const b = match.battle;
  const defending = otherTeam(b.attackingTeam);
  b.defenceQueue = rotated(match, defending, b.target).filter(id => isAlive(playerOf(match, id)));
  b.defenceIndex = 0;
  match.phase = LAG_FAS.defence;
  match.activePlayer = b.defenceQueue[0];
  events.push(`Anfallet är låst. ${nameOf(match, b.target)} försvarar först.`);
}

function advanceAttack(match, random, events) {
  const b = match.battle;
  b.attackIndex += 1;
  if (b.attackIndex < b.attackQueue.length) { match.activePlayer = b.attackQueue[b.attackIndex]; return; }
  lockAttack(match, random, events);
}

function advanceDefence(match, random, events) {
  const b = match.battle;
  b.defenceIndex += 1;
  if (b.defenceIndex < b.defenceQueue.length) { match.activePlayer = b.defenceQueue[b.defenceIndex]; return; }
  resolveBattle(match, random, events);
}

/* Utslagna tas ur en kö. De som redan agerat ligger kvar före indexet; nästa levande som inte agerat blir aktiv. */
function pruneQueue(match, queueKey, indexKey) {
  const b = match.battle;
  const alive = id => isAlive(playerOf(match, id));
  const done = b[queueKey].slice(0, b[indexKey]).filter(alive);
  const rest = b[queueKey].slice(b[indexKey]).filter(alive);
  b[queueKey] = [...done, ...rest];
  b[indexKey] = done.length;
  return rest.length > 0;
}

function snapshotTable(match) {
  return match.table.map(e => ({ ...e, cardId: match.instances[e.instanceId] }));
}

/* Gemensamt slut på en strid som inte avslutat matchen: lagets startspelare roteras, tomma händer fylls
   från nästa anfallande lags startspelare, och alla levande bekräftar Fortsätt. */
function finishBattle(match, random, events) {
  const b = match.battle;
  const next = nextAlive(match, b.attackingTeam, b.leader, { inclusive: false });
  if (next) match.nextLeader[b.attackingTeam] = next;
  match.battle = null;
  match.activePlayer = null;
  if (endIfDecided(match, events)) return;
  const nextTeam = otherTeam(b.attackingTeam);
  const refill = refillEmptyHands(match, { startPlayerId: leaderOf(match, nextTeam), refillId: b.number, random });
  match.lastRefill = { refillId: b.number, drawn: { ...refill.drawn } };
  events.push(...refill.events);
  match.phase = LAG_FAS.result;
  match.confirm = { kind: MATCH_COMMAND.next, by: {} };
}

/* Matchslut prövas efter alla utslagningar i samma händelse: ett lag kvar vinner; inga lag kvar = ingen vinnare. */
function endIfDecided(match, events) {
  const lost = TEAM_IDS.filter(team => !teamAlive(match, team));
  if (!lost.length) return false;
  if (match.table.length) discardTable(match);
  if (match.setAside.length) match.drawPile.push(...match.setAside.splice(0));   // matchen slutade under startbytena
  Object.assign(match, { phase: LAG_FAS.over, activePlayer: null, confirm: null, battle: null });
  if (lost.length === 2) {
    match.winnerTeam = null;
    match.endReason = LAG_SLUT.noPlayers;
    events.push('Inga spelare finns kvar – matchen avslutas utan vinnare.');
  } else {
    match.winnerTeam = otherTeam(lost[0]);
    match.endReason = LAG_SLUT.teamOut;
    events.push(`${teamName(lost[0])} har inga torn kvar. ${teamName(match.winnerTeam)} vinner matchen.`);
  }
  return true;
}

/* Stridsavgörandet sker exakt en gång: beräkna, spara liv, registrera utslagna, släng bordet, pröva
   lagvinst, annars fyll tomma händer och invänta Fortsätt. */
function resolveBattle(match, random, events) {
  const b = match.battle;
  const result = beraknaLagstrid(underlagFranMatch(match, { targetPlayerId: b.target, startLife: b.startLife }));
  const table = snapshotTable(match);
  for (const p of match.players) if (isAlive(p)) p.life = result.life[p.id];
  events.push(...result.events);
  discardTable(match);
  for (const id of result.eliminated) {
    const p = playerOf(match, id);
    p.status = PLAYER_STATUS.out;
    p.eliminationReason = UTSLAG.life;
    const discarded = discardHand(match, id);
    events.push(`${p.name} slås ut${discarded ? ` – ${discarded} kvarvarande handkort slängs` : ''}.`);
  }
  match.lastResult = {
    battleNumber: b.number, attackingTeam: b.attackingTeam, leader: b.leader, target: b.target,
    startLife: { ...b.startLife }, table, turns: [...b.turns],
    outcome: result.outcome, reason: result.reason, attack: result.attack, defence: result.defence, defended: result.defended,
    cards: result.cards, stopped: result.stopped, deductions: result.deductions,
    lifeDelta: result.lifeDelta, life: Object.fromEntries(match.players.map(p => [p.id, p.life])),
    eliminated: result.eliminated, events: result.events
  };
  finishBattle(match, random, events);
}

/* 13A: måltavlan lämnade en öppen strid. Inga skade-, läknings- eller motstötseffekter; spelade kort slängs
   och lagen växlar som efter en vanlig strid. */
function abortBattle(match, random, events) {
  const b = match.battle;
  const table = snapshotTable(match);
  discardTable(match);
  const message = `${nameOf(match, b.target)} lämnade striden – striden avbryts utan skada, läkning eller motstöt.`;
  events.push(message);
  match.lastResult = {
    battleNumber: b.number, attackingTeam: b.attackingTeam, leader: b.leader, target: b.target,
    startLife: { ...b.startLife }, table, turns: [...b.turns],
    outcome: OUTCOME.aborted, reason: ABORT.targetGone, attack: 0, defence: 0, defended: null,
    cards: {}, stopped: [], deductions: { frost: 0, pierce: 0 },
    lifeDelta: {}, life: Object.fromEntries(match.players.map(p => [p.id, p.life])),
    eliminated: [], events: [message]
  };
  finishBattle(match, random, events);
}

/* ---- Individuell utslagning (L13) ---- */
/* Slår ut en grupp spelare i samma händelse (t.ex. samtidiga tidsgränser) och för matchen vidare.
   Redan utslagna hoppas över; om ingen i gruppen var levande avvisas händelsen. `reason` är en orsak för hela
   gruppen eller { [spelare]: orsak } när orsakerna skiljer sig (tidsgräns och avbrott i samma händelse, L17). */
function eliminateGroup(match, playerIds, reason, random, events) {
  const reasonOf = id => typeof reason === 'string' ? reason : reason?.[id];
  for (const id of playerIds) invariant(Object.values(UTSLAG).includes(reasonOf(id)) && reasonOf(id) !== UTSLAG.life, `Okänd orsak till utslagning: ${reasonOf(id)}`);
  const ids = [...new Set(playerIds)];
  for (const id of ids) reject(playerOf(match, id), 'Okänd spelare.');
  const out = ids.map(id => playerOf(match, id)).filter(isAlive);
  reject(out.length, 'Spelaren är redan utslagen.');
  const phase = match.phase;
  const b = match.battle;
  const targetLeft = Boolean(b?.target) && out.some(p => p.id === b.target) && [LAG_FAS.attack, LAG_FAS.defence].includes(phase);

  /* 1. Markera, släng egna bordskort (12B) och handen, en gång per spelare. */
  const reasonText = { [UTSLAG.left]: 'lämnar matchen', [UTSLAG.timeout]: 'hann inte välja i tid', [UTSLAG.disconnect]: 'kom inte tillbaka i tid' };
  for (const p of out) {
    p.status = PLAYER_STATUS.out;
    p.eliminationReason = reasonOf(p.id);
    const own = targetLeft ? [] : discardTableCardsOf(match, p.id);
    const hand = discardHand(match, p.id);
    events.push(`${p.name} ${reasonText[p.eliminationReason]} och slås ut.${own.length ? ' Kortet på bordet tas bort ur striden.' : ''}${hand ? ` ${hand} handkort slängs.` : ''}`);
  }

  /* 2. Matchslut prövas först. */
  if (endIfDecided(match, events)) return;

  /* 3. Fortsätt i aktuell fas. */
  switch (phase) {
    case LAG_FAS.swap:
      events.push(...advanceSwapRound(match, random));
      if (match.phase === TEAM_PHASE.swapsDone) afterSwaps(match, random, events);
      return;
    case LAG_FAS.start:
      if (alivePlayers(match).every(q => match.confirm.by[q.id])) startBattle(match, match.attackingTeam, events);
      return;
    case LAG_FAS.result:
      if (alivePlayers(match).every(q => match.confirm.by[q.id])) startBattle(match, otherTeam(match.lastResult.attackingTeam), events);
      return;
    case LAG_FAS.target:
      if (!isAlive(playerOf(match, b.leader))) {
        b.leader = nextAlive(match, b.attackingTeam, b.leader, { inclusive: false });
        match.activePlayer = b.leader;
        events.push(`${nameOf(match, b.leader)} tar över och väljer måltavla.`);
      }
      if (!teamHasCards(match, b.attackingTeam)) { match.battle = null; startBattle(match, b.attackingTeam, events, { sameNumber: true }); }
      return;
    case LAG_FAS.attack:
      if (targetLeft) return abortBattle(match, random, events);
      if (!pruneQueue(match, 'attackQueue', 'attackIndex')) return lockAttack(match, random, events);
      match.activePlayer = b.attackQueue[b.attackIndex];
      return;
    case LAG_FAS.defence:
      if (targetLeft) return abortBattle(match, random, events);
      if (!pruneQueue(match, 'defenceQueue', 'defenceIndex')) return resolveBattle(match, random, events);
      match.activePlayer = b.defenceQueue[b.defenceIndex];
      return;
    default:
      invariant(false, `Utslagning i okänd fas: ${phase}`);
  }
}

/* Efter sista bytet: lotten avgör första anfallande lag (tekniskt arbetsförslag, L00). */
function afterSwaps(match, random, events) {
  const first = random() < 0.5 ? 'A' : 'B';
  match.attackingTeam = first;
  match.phase = LAG_FAS.start;
  match.confirm = { kind: MATCH_COMMAND.confirmStart, by: {} };
  events.push(`Lotten ger ${teamName(first)} första anfallet. ${nameOf(match, leaderOf(match, first))} väljer måltavla.`);
}

/* ---- Handlingar ---- */
function kravAktiv(match, action, phase) {
  reject(isAlive(playerOf(match, action.playerId)), 'Du är utslagen och kan inte göra fler val i matchen.');
  reject(match.phase === phase, 'Det är inte rätt läge för det valet.');
  reject(action.playerId === match.activePlayer, 'Det är inte din tur.');
}
function kravBekraftelse(match, action, kind) {
  const p = playerOf(match, action.playerId);
  reject(isAlive(p), 'En utslagen spelare behöver inte bekräfta.');
  reject(match.confirm?.kind === kind, kind === MATCH_COMMAND.next ? 'Det finns inget resultat att gå vidare från.' : 'Matchen väntar inte på en startbekräftelse.');
  reject(!match.confirm.by[p.id], 'Du har redan bekräftat.');
  match.confirm.by[p.id] = true;
  return alivePlayers(match).every(q => match.confirm.by[q.id]);
}

const handlers = {
  [LAG_HANDLING.swap](match, action, { events }) {
    events.push(...confirmSwap(match, action.playerId, action.cards, action.random).events);
    if (match.phase === TEAM_PHASE.swapsDone) afterSwaps(match, action.random, events);
  },

  [LAG_HANDLING.confirmStart](match, action, { events }) {
    reject(match.phase === LAG_FAS.start, 'Matchen väntar inte på en startbekräftelse.');
    if (kravBekraftelse(match, action, MATCH_COMMAND.confirmStart)) startBattle(match, match.attackingTeam, events);
  },

  [LAG_HANDLING.target](match, action, { events }) {
    kravAktiv(match, action, LAG_FAS.target);
    const target = playerOf(match, action.target);
    reject(target && target.teamId !== match.battle.attackingTeam, 'Välj ett torn i fiendelaget.');
    reject(isAlive(target), 'Det tornet har redan fallit.');
    const b = match.battle;
    b.target = target.id;
    b.attackQueue = rotated(match, b.attackingTeam, b.leader).filter(id => { const p = playerOf(match, id); return isAlive(p) && p.hand.length > 0; });
    invariant(b.attackQueue.length, 'Anfallskön är tom trots att laget har kort.');
    b.attackIndex = 0;
    match.phase = LAG_FAS.attack;
    match.activePlayer = b.attackQueue[0];
    events.push(`${nameOf(match, b.leader)} väljer ${target.name} som måltavla.`);
  },

  [LAG_HANDLING.attack](match, action, { events }) {
    kravAktiv(match, action, LAG_FAS.attack);
    const usage = action.usage ?? USAGE.normal;
    const entry = playToTable(match, action.playerId, action.card, { role: ROLE.attack, usage });
    const card = teamBattleCard(match.instances[entry.instanceId], usage);
    match.battle.turns.push({ playerId: action.playerId, role: ROLE.attack, instanceId: entry.instanceId });
    events.push(`${nameOf(match, action.playerId)} anfaller med ${card.name}.`);
    advanceAttack(match, action.random, events);
  },

  [LAG_HANDLING.passAttack](match, action, { events }) {
    kravAktiv(match, action, LAG_FAS.attack);
    reject(canPassAttack(match), 'Laget måste lägga minst ett kort. Alla kort kan spelas som enkel attack 1.');
    match.battle.turns.push({ playerId: action.playerId, role: ROLE.attack, instanceId: null });
    events.push(`${nameOf(match, action.playerId)} avstår från att anfalla.`);
    advanceAttack(match, action.random, events);
  },

  [LAG_HANDLING.defend](match, action, { events }) {
    kravAktiv(match, action, LAG_FAS.defence);
    const p = playerOf(match, action.playerId);
    reject(typeof action.card === 'string' && p.hand.includes(action.card), 'Kortet finns inte på din hand.');
    const card = teamBattleCard(match.instances[action.card]);
    reject(teamCanDefend(card), `${card.name} kan inte användas som försvar.`);
    /* Mål binds med kortet (16A, 17A) och prövas mot bordets nuvarande läge. */
    const input = underlagFranMatch(match, { targetPlayerId: match.battle.target, startLife: match.battle.startLife });
    let targetCard = null, targetPlayer = null;
    if (card.cancel) {
      const valid = giltigaKortmal(input, card.id);
      reject(valid.length, 'Det finns inget ostoppat attackkort som Barriären kan stoppa.');
      reject(valid.includes(action.targetCard), 'Välj vilket attackkort Barriären ska stoppa.');
      targetCard = action.targetCard;
    } else if (card.ability === 'seal' || card.ability === 'mirror') {
      const valid = giltigaKortmal(input, card.id);
      if (valid.length) { reject(valid.includes(action.targetCard), `Välj vilket magiskt attackkort ${card.name} ska ${card.ability === 'seal' ? 'stoppa' : 'spegla'}.`); targetCard = action.targetCard; }
      else reject(!action.targetCard, `Det finns inget magiskt attackkort att ${card.ability === 'seal' ? 'stoppa' : 'spegla'}.`);
    } else if (card.ability === 'thorns') {
      const valid = giltigaSpelarmal(input, p.id);
      if (valid.length) { reject(valid.includes(action.targetPlayer), 'Välj vilken anfallare Törneskölden ska träffa.'); targetPlayer = action.targetPlayer; }
    }
    const entry = playToTable(match, p.id, action.card, { role: ROLE.defence, targetCard, targetPlayer });
    match.battle.turns.push({ playerId: p.id, role: ROLE.defence, instanceId: entry.instanceId });
    events.push(`${p.name} ${p.id === match.battle.target ? 'försvarar' : 'hjälper till'} med ${card.name}.`);
    advanceDefence(match, action.random, events);
  },

  [LAG_HANDLING.passDefence](match, action, { events }) {
    kravAktiv(match, action, LAG_FAS.defence);
    match.battle.turns.push({ playerId: action.playerId, role: ROLE.defence, instanceId: null });
    events.push(`${nameOf(match, action.playerId)} avstår från att ${action.playerId === match.battle.target ? 'försvara' : 'hjälpa till'}.`);
    advanceDefence(match, action.random, events);
  },

  [LAG_HANDLING.next](match, action, { events }) {
    reject(match.phase === LAG_FAS.result, 'Det finns inget resultat att gå vidare från.');
    if (kravBekraftelse(match, action, MATCH_COMMAND.next)) startBattle(match, otherTeam(match.lastResult.attackingTeam), events);
  },

  /* Lämna matchen: bara den egna spelaren slås ut (8A); laget spelar vidare. Tillåtet i alla pågående faser. */
  [LAG_HANDLING.leave](match, action, { events }) {
    reject(isAlive(playerOf(match, action.playerId)), 'Du är redan utslagen.');
    eliminateGroup(match, [action.playerId], UTSLAG.left, action.random, events);
  }
};

/* Kör en förändring på en kopia: godkänd → revision + 1; Avvisning → orörd; annat fel → fasen FEL utan vinnare. */
function kor(match, change) {
  const work = structuredClone(match);
  const events = [];
  try {
    change(work, events);
    auditTeam(work);
  } catch (error) {
    if (error instanceof Avvisning) return { status: STATUS.rejected, match, message: error.message, events: [] };
    const failed = structuredClone(match);
    Object.assign(failed, { phase: LAG_FAS.error, activePlayer: null, confirm: null, error: error.message, revision: match.revision + 1 });
    failed.log.push(`Internt fel: ${error.message}`);
    return { status: STATUS.error, match: failed, message: error.message, events: [] };
  }
  work.revision += 1;
  work.log.push(...events);
  return { status: STATUS.ok, match: work, message: null, events };
}

/* Den gemensamma vägen för alla spelarhandlingar. */
export function processLag(match, action, random = Math.random) {
  const rejected = message => ({ status: STATUS.rejected, match, message, events: [] });
  if (!action || action.matchId !== match.id || action.revision !== match.revision) return rejected('Matchläget har ändrats – försök igen.');
  if (typeof action.type !== 'string' || !Object.hasOwn(handlers, action.type)) return rejected('Okänd handling.');   // aldrig prototypens namn (toString, __proto__ …)
  if (!RUNNING.includes(match.phase)) return rejected('Matchen är avslutad.');
  if (!playerOf(match, action.playerId)) return rejected('Okänd spelare.');
  return kor(match, (work, events) => handlers[action.type](work, { ...action, random }, { events }));
}

/* Serverns väg för utslagning utan eget kommando (tidsgräns L16, avbrott L17). Flera spelare i samma
   anrop behandlas som en händelse: matchslut prövas först när alla är utslagna. Ingen revisionskontroll –
   servern kör den i matchens kö, efter alla tidigare kommandon. */
export function slaUt(match, playerIds, reason, random = Math.random) {
  if (!RUNNING.includes(match.phase)) return { status: STATUS.rejected, match, message: 'Matchen är redan avgjord.', events: [] };
  return kor(match, (work, events) => eliminateGroup(work, playerIds, reason, random, events));
}

/* ---- Tillåtna val för en spelare, utan hemlig information om andra ----
   Att lämna matchen (LAG_HANDLING.leave) är alltid möjligt för en levande spelare medan matchen pågår
   och listas därför inte här. */
/* Serveromstart (27B): matchen avslutas utan vinnare. Bordskorten slängs och undanlagda startbyteskort går
   tillbaka till högen, som vid ett vanligt matchslut; liv, händer och utslagningar rörs inte. Är
   kortbokföringen redan trasig lämnas korten där de låg – matchen ska avslutas ändå. */
export function serveravbrott(match, text) {
  let work = structuredClone(match);
  try {
    if (work.table.length) discardTable(work);
    if (work.setAside.length) work.drawPile.push(...work.setAside.splice(0));
  } catch {
    work = structuredClone(match);
  }
  Object.assign(work, { phase: LAG_FAS.over, activePlayer: null, confirm: null, battle: null, winnerTeam: null, endReason: LAG_SLUT.serverAbort, revision: match.revision + 1 });
  work.log.push(text);
  return work;
}

export function allowedActions(match, playerId) {
  const p = playerOf(match, playerId);
  if (!isAlive(p) || !RUNNING.includes(match.phase)) return [];
  const usable = id => ({ instanceId: id, cardId: match.instances[id] });
  const mine = match.activePlayer === p.id;
  switch (match.phase) {
    case LAG_FAS.swap:
      return match.swapsConfirmed[p.id] === match.swapRound - 1 ? [{ type: LAG_HANDLING.swap, maxCards: match.rules.maxCardsPerSwap, round: match.swapRound, cards: p.hand.map(usable) }] : [];
    case LAG_FAS.start:
      return match.confirm.by[p.id] ? [] : [{ type: LAG_HANDLING.confirmStart }];
    case LAG_FAS.result:
      return match.confirm.by[p.id] ? [] : [{ type: LAG_HANDLING.next }];
    case LAG_FAS.target:
      return mine ? [{ type: LAG_HANDLING.target, players: match.players.filter(q => isAlive(q) && q.teamId !== p.teamId).map(q => q.id) }] : [];
    case LAG_FAS.attack:
      if (!mine) return [];
      return [
        { type: LAG_HANDLING.attack, normal: p.hand.filter(id => teamCanAttack(teamBattleCard(match.instances[id]))).map(usable), simple: p.hand.map(usable) },
        ...(canPassAttack(match) ? [{ type: LAG_HANDLING.passAttack }] : [])
      ];
    case LAG_FAS.defence: {
      if (!mine) return [];
      const input = underlagFranMatch(match, { targetPlayerId: match.battle.target, startLife: match.battle.startLife });
      const cards = [];
      for (const id of p.hand) {
        const card = teamBattleCard(match.instances[id]);
        if (!teamCanDefend(card)) continue;
        if (card.cancel || card.ability === 'seal' || card.ability === 'mirror') {
          const targets = giltigaKortmal(input, card.id);
          if (card.cancel && !targets.length) continue;
          cards.push({ ...usable(id), cardTargets: targets });
        } else if (card.ability === 'thorns') cards.push({ ...usable(id), playerTargets: giltigaSpelarmal(input, p.id) });
        else cards.push(usable(id));
      }
      return [{ type: LAG_HANDLING.defend, cards }, { type: LAG_HANDLING.passDefence }];
    }
    default:
      return [];
  }
}
