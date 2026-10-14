/* Lagstridens effektberäkning (arbetsordning L11, huvudplan §7 "Effektordning för lagstrid",
   beslut 14A–20A, 23A och 24B). En ren funktion: samma kvarvarande bordskort och startliv ger
   alltid samma förklarbara resultat. Ingenting i indata ändras och inga liv sparas här – lagmotorn
   (L12) tillämpar resultatet, och samma funktion används för förhandsvisning under kortval.
   Duellens strid.js är oförändrad.

   Indata:
     targetPlayerId  måltavlan (en spelare i det försvarande laget)
     attacks   [{ instanceId, playerId, cardId, usage }]                      kvarvarande anfallskort
     defences  [{ instanceId, playerId, cardId, targetCard, targetPlayer }]   kvarvarande försvarskort
               targetCard = exemplar-ID för Barriär/Försegling/Spegelsköld (17A: bundet vid spel)
               targetPlayer = spelar-ID för Törnesköld (16A)
     players   [{ id, teamId, life, alive, name }]   läget när striden avgörs
     startLife { [spelar-ID]: liv vid stridens början }   för sista-livet-bonusarna

   Effektordning: 1 kvarvarande kort och enkel attack normaliserad, 2 stopp, 3 attack per kort före
   frost, 4 försvar per kort (Spegelsköld kopierar steg 3), 5 summering med frost/genombrott och golv 0,
   6 avgörande en gång (24B: inga anfallskort = försvaret håller), 7 resultateffekter, 8 nya liv 0–3. */
import { BONUS, MAX_LIFE } from './kort.js';
import { teamBattleCard, USAGE } from './lagregler.js';
import { TEAM_IDS, TEAM_OUTCOME } from './kontrakt.js';

export const OUTCOME = TEAM_OUTCOME;   // definierad i kontrakt.js så att lagvyn kan läsa utfallet
export const ABORT = Object.freeze({ teamGone: 'LAG_UTAN_SPELARE', targetGone: 'MÅLTAVLAN_BORTA' });

const invariant = (condition, message) => { if (!condition) throw new Error(message); };
const isMagicAttack = entry => entry.card.type === 'magic';   // efter normalisering: enkel attack är aldrig magi

/* Steg 1: bara kort vars ägare fortfarande är med räknas (12B), och enkel attack normaliseras (23A). */
function prepare({ targetPlayerId, attacks = [], defences = [], players = [], startLife = {} }) {
  const byId = new Map(players.map(p => [p.id, p]));
  const target = byId.get(targetPlayerId);
  invariant(target, `Okänd måltavla: ${targetPlayerId}`);
  const defendingTeam = target.teamId;
  const attackingTeam = TEAM_IDS.find(t => t !== defendingTeam);
  const seenCards = new Set(), seenPlayers = new Set();
  const norm = (entry, role) => {
    invariant(!seenCards.has(entry.instanceId), `Exemplaret ${entry.instanceId} finns två gånger på bordet.`);
    invariant(!seenPlayers.has(entry.playerId), `${entry.playerId} har lagt mer än ett kort i striden.`);
    seenCards.add(entry.instanceId); seenPlayers.add(entry.playerId);
    const owner = byId.get(entry.playerId);
    invariant(owner, `Okänd kortägare: ${entry.playerId}`);
    invariant(owner.teamId === (role === 'attack' ? attackingTeam : defendingTeam), `${entry.playerId} spelar för fel lag.`);
    const usage = role === 'attack' ? entry.usage ?? USAGE.normal : USAGE.normal;
    const card = teamBattleCard(entry.cardId, usage);
    invariant(role === 'attack' ? Boolean(card.attack) : Boolean(card.defence || card.cancel), `${card.name} kan inte användas som ${role === 'attack' ? 'anfall' : 'försvar'}.`);
    return { ...entry, usage, card, owner };
  };
  const live = (list, role) => list.map(e => norm(e, role)).filter(e => e.owner.alive);
  const a = live(attacks, 'attack');
  const d = live(defences, 'defence');
  const life = id => startLife[id] ?? byId.get(id).life;
  return { byId, target, defendingTeam, attackingTeam, attacks: a, defences: d, life };
}

/* Steg 2: Barriär stoppar sitt valda attackkort; Försegling sitt valda magiska attackkort.
   Ett mål som inte finns kvar ger inget stopp och inget omval (17A). */
function computeStops(attacks, defences) {
  const attackById = new Map(attacks.map(a => [a.instanceId, a]));
  const stoppedBy = new Map();
  for (const d of defences) {
    const t = attackById.get(d.targetCard);
    if (!t) continue;
    if (d.card.cancel || (d.card.ability === 'seal' && isMagicAttack(t))) stoppedBy.set(t.instanceId, [...(stoppedBy.get(t.instanceId) ?? []), d.instanceId]);
  }
  return { attackById, stoppedBy };
}

const nameOf = (s, id) => s.byId.get(id)?.name ?? id;

export function beraknaLagstrid(input) {
  const s = prepare(input);
  const events = [];
  const aborted = reason => ({ outcome: OUTCOME.aborted, reason, attack: 0, defence: 0, defended: null, cards: {}, stopped: [], deductions: { frost: 0, pierce: 0 }, lifeDelta: {}, life: Object.fromEntries([...s.byId.values()].map(p => [p.id, p.life])), eliminated: [], events });

  /* 13A och matchslut prövas alltid först: då inga resultateffekter alls. */
  if (TEAM_IDS.some(team => ![...s.byId.values()].some(p => p.teamId === team && p.alive))) { events.push('Ett lag saknar levande spelare – striden avgörs inte.'); return aborted(ABORT.teamGone); }
  if (!s.target.alive) { events.push(`${s.target.name ?? s.target.id} har lämnat – striden avbryts utan skada eller läkning.`); return aborted(ABORT.targetGone); }

  const { attackById, stoppedBy } = computeStops(s.attacks, s.defences);
  const cards = {};
  for (const [id, by] of stoppedBy) {
    const a = attackById.get(id);
    const stopper = s.defences.find(d => d.instanceId === by[0]);
    events.push(`${stopper.card.name} (${nameOf(s, stopper.playerId)}) stoppar ${a.card.name} (${nameOf(s, a.playerId)}) och dess specialeffekt.`);
  }

  /* Steg 3: attack per ostoppat kort, före frost. */
  const blueDefence = s.defences.some(d => d.card.type === 'defence');
  const attackValue = new Map();
  for (const a of s.attacks) {
    const stopped = stoppedBy.has(a.instanceId);
    let value = 0, bonus = 0;
    if (!stopped) {
      value = a.card.attack;
      if (a.card.ability === 'lastAttack' && s.life(a.playerId) === 1) { bonus += BONUS.lastAttack; events.push(`${a.card.name} får +${BONUS.lastAttack} eftersom ${nameOf(s, a.playerId)} hade ett liv.`); }
      if (a.card.ability === 'dragon' && blueDefence) { bonus += BONUS.dragon; events.push(`${a.card.name} får +${BONUS.dragon} mot ett blått försvarskort.`); }
      value += bonus;
    }
    attackValue.set(a.instanceId, value);
    cards[a.instanceId] = { role: 'attack', playerId: a.playerId, cardId: a.cardId, usage: a.usage, value, bonus, stoppedBy: stoppedBy.get(a.instanceId) ?? null };
  }

  /* Steg 4: försvar per kort. Spegelsköld ersätter sitt grundförsvar med det valda kortets värde från steg 3. */
  for (const d of s.defences) {
    let value = d.card.defence ?? 0, bonus = 0, mirrorOf = null;
    if (d.card.ability === 'lastDefence' && s.life(d.playerId) === 1) { bonus = BONUS.lastDefence; value += bonus; events.push(`${d.card.name} får +${BONUS.lastDefence} eftersom ${nameOf(s, d.playerId)} hade ett liv.`); }
    if (d.card.ability === 'mirror') {
      const t = attackById.get(d.targetCard);
      if (t && !stoppedBy.has(t.instanceId) && isMagicAttack(t)) { value = attackValue.get(t.instanceId); mirrorOf = t.instanceId; events.push(`${d.card.name} kopierar ${t.card.name}: ${value}.`); }
      else { value = d.card.defence; events.push(`${d.card.name} saknar giltigt magiskt mål och ger försvar ${value}.`); }
    }
    cards[d.instanceId] = { role: 'defence', playerId: d.playerId, cardId: d.cardId, usage: USAGE.normal, value, bonus, mirrorOf, targetCard: d.targetCard ?? null, targetPlayer: d.targetPlayer ?? null };
  }

  /* Steg 5: summering och avdrag från totalerna, lägst 0. Frost är inget stoppkort. */
  const frost = s.defences.filter(d => d.card.ability === 'frost').length * BONUS.frost;
  const pierce = s.attacks.filter(a => a.card.ability === 'pierce' && !stoppedBy.has(a.instanceId)).length * BONUS.pierce;
  const sum = (list, values) => list.reduce((total, e) => total + values(e), 0);
  const attackBefore = sum(s.attacks, a => attackValue.get(a.instanceId));
  const defenceBefore = sum(s.defences, d => cards[d.instanceId].value);
  const attack = Math.max(0, attackBefore - frost);
  const defence = Math.max(0, defenceBefore - pierce);
  if (frost) events.push(`Isrustning sänker lagets attack med ${frost}: ${attackBefore} → ${attack}.`);
  if (pierce) events.push(`Sprängladdning sänker försvaret med ${pierce}: ${defenceBefore} → ${defence}.`);

  /* Steg 6: avgörandet. 24B: utan kvarvarande anfallskort är attacken 0 och försvaret håller. */
  const defended = defence >= attack;
  if (!s.attacks.length) events.push('Inga anfallskort finns kvar – attacken är 0 och försvaret räknas som lyckat.');
  events.push(`Attack ${attack} mot försvar ${defence}: ${defended ? 'försvaret håller.' : `${nameOf(s, s.target.id)} förlorar ett liv.`}`);

  /* Steg 7: resultateffekter som livsändringar, en gång per kort. */
  const lifeDelta = {};
  const add = (id, n) => { lifeDelta[id] = (lifeDelta[id] ?? 0) + n; };
  if (defended) {
    for (const d of s.defences) {
      if (d.card.ability === 'heal') { add(d.playerId, 1); events.push(`${d.card.name} läker ${nameOf(s, d.playerId)} ett liv.`); }
      if (d.card.ability === 'thorns') {
        const victim = s.byId.get(d.targetPlayer);
        const hasAttacked = s.attacks.some(a => a.playerId === d.targetPlayer);
        if (victim?.alive && victim.teamId === s.attackingTeam && hasAttacked) { add(victim.id, -1); events.push(`${d.card.name} (${nameOf(s, d.playerId)}) gör en motstöt mot ${nameOf(s, victim.id)}.`); }
        else events.push(`${d.card.name} (${nameOf(s, d.playerId)}) har inget giltigt mål kvar – ingen motstöt.`);
      }
    }
  } else {
    add(s.target.id, -1);
    for (const a of s.attacks) if (a.card.ability === 'lifesteal' && !stoppedBy.has(a.instanceId)) { add(a.playerId, 1); events.push(`${a.card.name} läker ${nameOf(s, a.playerId)} ett liv.`); }
  }

  /* Steg 8: nya liv inom 0–3, ingen återupplivning; alla utslagna registreras tillsammans. */
  const life = {}, eliminated = [];
  for (const p of s.byId.values()) {
    const delta = p.alive ? lifeDelta[p.id] ?? 0 : 0;
    life[p.id] = Math.max(0, Math.min(MAX_LIFE, p.life + delta));
    if (p.alive && p.life > 0 && life[p.id] === 0) eliminated.push(p.id);
  }
  for (const id of eliminated) events.push(`${nameOf(s, id)} har inga liv kvar och slås ut.`);

  return {
    outcome: defended ? OUTCOME.held : OUTCOME.hit, reason: null, attack, defence, defended,
    cards, stopped: [...stoppedBy.keys()], deductions: { frost, pierce },
    lifeDelta, life, eliminated, events
  };
}

/* ---- Målval vid kortspel (används av lagmotorn och vyn; validering vid spel hör till L12/L15) ---- */
/* Exemplar som ett nytt Barriär-, Försegling- eller Spegelsköldkort får välja i bordets nuvarande läge. */
export function giltigaKortmal(input, cardId) {
  const s = prepare(input);
  const { stoppedBy } = computeStops(s.attacks, s.defences);
  const open = s.attacks.filter(a => !stoppedBy.has(a.instanceId));
  const card = teamBattleCard(cardId);
  if (card.cancel) return open.map(a => a.instanceId);
  if (card.ability === 'seal' || card.ability === 'mirror') return open.filter(isMagicAttack).map(a => a.instanceId);
  return [];
}

/* Spelare som ägarens Törnesköld får välja: levande fiender som lagt ett attackkort i striden. */
export function giltigaSpelarmal(input, ownerId) {
  const s = prepare(input);
  const owner = s.byId.get(ownerId);
  invariant(owner, `Okänd spelare: ${ownerId}`);
  return [...new Set(s.attacks.map(a => a.playerId))].filter(id => s.byId.get(id).alive && s.byId.get(id).teamId !== owner.teamId);
}

/* Bygger indata från en lagmatch (lagkortlek.js): bordets poster, spelarnas läge och startliven. */
export function underlagFranMatch(match, { targetPlayerId, startLife }) {
  const entry = e => ({ instanceId: e.instanceId, playerId: e.playerId, cardId: match.instances[e.instanceId], usage: e.usage, targetCard: e.targetCard ?? null, targetPlayer: e.targetPlayer ?? null });
  return {
    targetPlayerId,
    attacks: match.table.filter(e => e.role === 'attack').map(entry),
    defences: match.table.filter(e => e.role === 'defence').map(entry),
    players: match.players.map(p => ({ id: p.id, teamId: p.teamId, life: p.life, alive: p.status === 'LEVANDE', name: p.name })),
    startLife: { ...startLife }
  };
}
