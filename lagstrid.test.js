import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cards } from './kort.js';
import { resolve } from './strid.js';
import { battleCard, USAGE } from './matchregler.js';
import { beraknaLagstrid, giltigaKortmal, giltigaSpelarmal, underlagFranMatch, OUTCOME, ABORT } from './lagstrid.js';
import { newTeamMatch, confirmSwap, playToTable, playerOf, auditTeam, TEAM_PHASE, ROLE } from './lagkortlek.js';
import { styrdSlump } from './teststod.js';

/* Spelare: lag A anfaller, lag B försvarar, b1 är måltavla om inget annat sägs. */
const P = (id, life = 3, alive = true) => ({ id, teamId: id[0].toUpperCase(), life, alive, name: id });
const lag = (k, liv = {}) => ['a', 'b'].flatMap(t => Array.from({ length: k }, (_, i) => P(`${t}${i + 1}`, liv[`${t}${i + 1}`] ?? 3)));
const borta = (players, ...ids) => players.map(p => ids.includes(p.id) ? { ...p, alive: false } : p);
let n = 0;
const A = (playerId, cardId, usage = USAGE.normal) => ({ instanceId: `k${++n}`, playerId, cardId, usage });
const D = (playerId, cardId, { kort = null, spelare = null } = {}) => ({ instanceId: `k${++n}`, playerId, cardId, targetCard: kort, targetPlayer: spelare });
const strid = ({ attacks = [], defences = [], players = lag(2), target = 'b1', startLife } = {}) =>
  beraknaLagstrid({ targetPlayerId: target, attacks, defences, players, startLife: startLife ?? Object.fromEntries(players.map(p => [p.id, p.life])) });

/* ---- Räkneexemplen i huvudplan §7, ordagrant ---- */
test('Exempel: två Stormning mot två Isrustningar – attack 3+3−2−2 = 2, försvar 4, försvaret håller', () => {
  const r = strid({ attacks: [A('a1', 'stormning'), A('a2', 'stormning')], defences: [D('b1', 'isrustning'), D('b2', 'isrustning')] });
  assert.deepEqual([r.attack, r.defence, r.outcome], [2, 4, OUTCOME.held]);
  assert.equal(r.deductions.frost, 4);
  assert.deepEqual(r.lifeDelta, {});
});

test('Exempel: Drakeld + Stormning mot Spegelsköld + Isrustning + Palissad – speglingen kopierar 6 före frost', () => {
  const drakeld = A('a1', 'drakeld');
  const spegel = D('b1', 'spegelskold', { kort: drakeld.instanceId });
  const r = strid({ players: lag(3), attacks: [drakeld, A('a2', 'stormning')], defences: [spegel, D('b2', 'isrustning'), D('b3', 'palissad')] });
  assert.equal(r.cards[drakeld.instanceId].value, 6, 'Palissaden ger Drakeld +2');
  assert.equal(r.cards[spegel.instanceId].value, 6, 'Spegelsköld kopierar 6, inte 4 och inte 6−2');
  assert.equal(r.cards[spegel.instanceId].mirrorOf, drakeld.instanceId);
  assert.deepEqual([r.attack, r.defence, r.outcome], [7, 9, OUTCOME.held]);
});

test('Exempel: två Sprängladdningar mot två Sköldmurar – försvar 3+3−2−2 = 2, måltavlan förlorar ett liv', () => {
  const r = strid({ attacks: [A('a1', 'sprangladdning'), A('a2', 'sprangladdning')], defences: [D('b1', 'skoldmur'), D('b2', 'skoldmur')] });
  assert.deepEqual([r.attack, r.defence, r.outcome], [6, 2, OUTCOME.hit]);
  assert.deepEqual(r.lifeDelta, { b1: -1 });
  assert.equal(r.life.b1, 2);
});

test('Exempel: Stormning + Armborst mot två Törnesköldar mot samma spelare – två motstötar fäller henne, lagkamraten klarar sig', () => {
  const players = lag(2, { a1: 2 });
  const r = strid({ players, attacks: [A('a1', 'stormning'), A('a2', 'armborst')], defences: [D('b1', 'torneskold', { spelare: 'a1' }), D('b2', 'torneskold', { spelare: 'a1' })] });
  assert.deepEqual([r.attack, r.defence, r.outcome], [5, 6, OUTCOME.held]);
  assert.deepEqual(r.lifeDelta, { a1: -2 });
  assert.deepEqual([r.life.a1, r.life.a2], [0, 3]);
  assert.deepEqual(r.eliminated, ['a1'], 'motstötarna summeras innan utslagning prövas');
});

test('Exempel: Vampyrbett + Katapult mot Barriär + Tornvakt – stoppat Vampyrbett läker inte trots lagets träff', () => {
  const players = lag(2, { a1: 2 });
  const vampyr = A('a1', 'vampyrbett');
  const r = strid({ players, attacks: [vampyr, A('a2', 'katapult')], defences: [D('b1', 'barriar', { kort: vampyr.instanceId }), D('b2', 'tornvakt')] });
  assert.deepEqual([r.attack, r.defence, r.outcome], [5, 2, OUTCOME.hit]);
  assert.deepEqual(r.stopped, [vampyr.instanceId]);
  assert.deepEqual(r.lifeDelta, { b1: -1 });
  assert.equal(r.life.a1, 2, 'ingen läkning');
});

test('Exempel: Drakeld + Armborst mot två Sköldmurar – två blå kort ger fortfarande bara +2', () => {
  const r = strid({ attacks: [A('a1', 'drakeld'), A('a2', 'armborst')], defences: [D('b1', 'skoldmur'), D('b2', 'skoldmur')] });
  assert.deepEqual([r.attack, r.defence, r.outcome], [8, 6, OUTCOME.hit]);
});

test('Exempel: Spegelskölds valda magiska kort tas bort – kopian upphör, ger 1, inget omval trots annat magiskt kort', () => {
  const players = borta(lag(3), 'a1');   // a1 har lämnat; hennes Eldklot är borttaget (12B)
  const eldklot = A('a1', 'eldklot');
  const spegel = D('b1', 'spegelskold', { kort: eldklot.instanceId });
  const r = strid({ players, attacks: [eldklot, A('a2', 'drakeld'), A('a3', 'armborst')], defences: [spegel, D('b2', 'skoldmur')] });
  assert.equal(r.cards[spegel.instanceId].value, 1);
  assert.equal(r.cards[spegel.instanceId].mirrorOf, null, 'Drakeld väljs inte i efterhand');
  assert.ok(!(eldklot.instanceId in r.cards), 'det borttagna kortet räknas inte');
  assert.deepEqual([r.attack, r.defence], [(4 + 2) + 2, 1 + 3], 'övriga bidrag räknas om');
});

test('Exempel: avdrag och motstötar går aldrig under 0', () => {
  const frost = strid({ attacks: [A('a1', 'stormning')], defences: [D('b1', 'isrustning'), D('b2', 'isrustning')] });
  assert.equal(frost.attack, 0, 'max(0, 3 − 4)');
  const torn = strid({ players: lag(2, { a1: 1 }), attacks: [A('a1', 'spejare')], defences: [D('b1', 'torneskold', { spelare: 'a1' }), D('b2', 'torneskold', { spelare: 'a1' })] });
  assert.equal(torn.lifeDelta.a1, -2);
  assert.equal(torn.life.a1, 0, 'aldrig −1');
});

/* ---- Specialregler 14A–20A, 23A, 24B och 13A ---- */
test('14A/15A: Helande ljus från en hjälpare läker hjälparen, inte måltavlan; Isrustning från hjälpare sänker lagets attack', () => {
  const players = lag(2, { b1: 2, b2: 2 });   // Alex = b1 (måltavla), Mira = b2 (hjälpare)
  const r = strid({ players, attacks: [A('a1', 'stormning'), A('a2', 'armborst')], defences: [D('b1', 'skoldmur'), D('b2', 'helande-ljus')] });
  assert.deepEqual([r.attack, r.defence, r.outcome], [5, 6, OUTCOME.held]);
  assert.deepEqual(r.lifeDelta, { b2: 1 });
  assert.deepEqual([r.life.b1, r.life.b2], [2, 3]);
  const is = strid({ attacks: [A('a1', 'stormning'), A('a2', 'armborst')], defences: [D('b1', 'palissad'), D('b2', 'isrustning')] });
  assert.deepEqual([is.attack, is.defence], [3, 3], 'Isrustning ger försvar 2 och −2 på lagets attack');
  const full = strid({ attacks: [A('a1', 'spejare')], defences: [D('b2', 'helande-ljus')] });
  assert.equal(full.life.b2, 3, 'högst tre liv');
});

test('Sista anfallet och Sista bastionen läser ägarens liv vid stridens början, även vid laghjälp', () => {
  const r = strid({ players: lag(2, { a2: 1, b2: 1 }), attacks: [A('a1', 'stormning'), A('a2', 'sista-anfallet')], defences: [D('b1', 'palissad'), D('b2', 'sista-bastionen')] });
  assert.deepEqual([r.attack, r.defence], [3 + 5, 1 + 6]);
  const startliv = strid({ players: lag(2, { a2: 1 }), startLife: { a1: 3, a2: 2, b1: 3, b2: 3 }, attacks: [A('a2', 'sista-anfallet')] });
  assert.equal(startliv.attack, 2, 'bonusen följer startlivet, inte nuvarande liv');
});

test('19A/20A: Drakeld får +2 bara av kvarvarande blått försvar; Törnesköld räknas som blått, hybrid och magi inte; flera speglingar', () => {
  const med = kort => strid({ attacks: [A('a1', 'drakeld')], defences: [D('b1', kort)] }).attack;
  assert.equal(med('torneskold'), 6);
  assert.equal(med('bagskytt'), 4);
  assert.equal(med('runskold'), 4);
  const r = strid({ players: borta(lag(2), 'b2'), attacks: [A('a1', 'drakeld')], defences: [D('b1', 'runskold'), D('b2', 'skoldmur')] });
  assert.equal(r.attack, 4, 'bonusen försvinner när det blå kortet tas bort');
  const d1 = A('a1', 'drakeld'), d2 = A('a2', 'drakeld');
  const flera = strid({ players: lag(3), attacks: [d1, d2], defences: [D('b1', 'spegelskold', { kort: d1.instanceId }), D('b2', 'spegelskold', { kort: d1.instanceId }), D('b3', 'palissad')] });
  assert.deepEqual([flera.cards[d1.instanceId].value, flera.cards[d2.instanceId].value], [6, 6]);
  assert.equal(flera.defence, 6 + 6 + 1, 'två Spegelsköldar kopierar samma kort, var och en en gång');
});

test('Stopp: Försegling stoppar valt magiskt kort och behåller försvar 2; Barriär ger 0; stoppat kort förlorar sina effekter; borttaget stoppkort återställer', () => {
  const eldklot = A('a1', 'eldklot'), storm = A('a2', 'stormning');
  const seal = strid({ attacks: [eldklot, storm], defences: [D('b1', 'forsegling', { kort: eldklot.instanceId })] });
  assert.deepEqual([seal.attack, seal.defence, seal.stopped], [3, 2, [eldklot.instanceId]]);
  const fel = strid({ attacks: [eldklot, storm], defences: [D('b1', 'forsegling', { kort: storm.instanceId })] });
  assert.deepEqual([fel.attack, fel.defence, fel.stopped], [7, 2, []], 'Försegling stoppar inte vanliga attacker');
  const spr = A('a1', 'sprangladdning');
  const bar = strid({ attacks: [spr, A('a2', 'armborst')], defences: [D('b1', 'barriar', { kort: spr.instanceId }), D('b2', 'skoldmur')] });
  assert.deepEqual([bar.attack, bar.defence, bar.deductions.pierce], [2, 3, 0], 'stoppad Sprängladdning sänker inte försvaret; Barriär ger försvar 0');
  const vamp = A('a1', 'vampyrbett');
  const tillbaka = strid({ players: borta(lag(2, { a1: 2 }), 'b2'), attacks: [vamp], defences: [D('b2', 'barriar', { kort: vamp.instanceId })] });
  assert.deepEqual([tillbaka.attack, tillbaka.outcome, tillbaka.life.a1], [3, OUTCOME.hit, 3], 'när stoppkortet tas bort är kortet aktivt igen och läker');
});

test('Frost är inget stopp: Sprängladdningens avdrag finns kvar även när attacken sänks till 0', () => {
  const r = strid({ attacks: [A('a1', 'sprangladdning')], defences: [D('b1', 'isrustning'), D('b2', 'isrustning')] });
  assert.deepEqual([r.attack, r.defence, r.deductions], [0, 2, { frost: 4, pierce: 2 }]);
  assert.equal(r.outcome, OUTCOME.held);
});

test('23A: enkel attack är vanlig attack 1 – Barriär stoppar den, Försegling och Spegelsköld kan inte använda magin, ingen Drakeld-bonus', () => {
  const enkel = A('a1', 'drakeld', USAGE.simple);
  const r = strid({ attacks: [enkel], defences: [D('b1', 'spegelskold', { kort: enkel.instanceId }), D('b2', 'skoldmur')] });
  assert.equal(r.cards[enkel.instanceId].value, 1, 'ingen +2 trots blått försvar');
  assert.equal(r.defence, 1 + 3, 'Spegelsköld ger 1');
  const seal = strid({ attacks: [enkel], defences: [D('b1', 'forsegling', { kort: enkel.instanceId })] });
  assert.deepEqual([seal.stopped, seal.attack, seal.defence], [[], 1, 2]);
  const bar = strid({ attacks: [enkel], defences: [D('b1', 'barriar', { kort: enkel.instanceId })] });
  assert.deepEqual([bar.stopped, bar.attack], [[enkel.instanceId], 0]);
  assert.equal(strid({ attacks: [A('a1', 'skoldmur', USAGE.simple)] }).attack, 1, 'även ett försvarskort kan anfalla som enkel attack');
});

test('16A: Törnesköld skadar bara sin valda levande fiende som lagt ett attackkort; träff kostar exakt ett liv', () => {
  const avstod = strid({ attacks: [A('a1', 'spejare')], defences: [D('b1', 'torneskold', { spelare: 'a2' })] });
  assert.deepEqual(avstod.lifeDelta, {}, 'a2 avstod – ingen motstöt');
  const stoppad = A('a1', 'eldklot');
  const r = strid({ attacks: [stoppad], defences: [D('b1', 'torneskold', { spelare: 'a1' }), D('b2', 'barriar', { kort: stoppad.instanceId })] });
  assert.deepEqual(r.lifeDelta, { a1: -1 }, 'målet behöver bara ha lagt ett attackkort, inte ett ostoppat');
  const stor = strid({ attacks: [A('a1', 'belagringstorn'), A('a2', 'katapult')] });
  assert.deepEqual([stor.attack, stor.defence, stor.lifeDelta], [11, 0, { b1: -1 }], 'överskottet kostar fortfarande bara ett liv');
});

test('24B: alla anfallskort borta – attack 0, försvaret håller även vid försvar 0, läkning sker, motstöt mot den som lämnat skadar ingen', () => {
  const players = borta(lag(2, { b2: 2 }), 'a1');   // Alex = a1 lämnade, Sam = a2 avstod
  const r = strid({ players, attacks: [A('a1', 'katapult')], defences: [D('b2', 'helande-ljus'), D('b1', 'torneskold', { spelare: 'a1' })] });
  assert.deepEqual([r.attack, r.outcome], [0, OUTCOME.held]);
  assert.deepEqual(r.lifeDelta, { b2: 1 });
  assert.equal(r.life.a2, 3, 'ingen skada flyttas till Sam');
  const tom = strid({ players: borta(lag(2), 'a1'), attacks: [A('a1', 'stormning')] });
  assert.deepEqual([tom.attack, tom.defence, tom.outcome], [0, 0, OUTCOME.held]);
});

test('13A och matchslut: saknad måltavla eller lag utan spelare avbryter utan resultateffekter', () => {
  const r = strid({ players: borta(lag(2, { a1: 2 }), 'b1'), attacks: [A('a1', 'vampyrbett')], defences: [D('b2', 'helande-ljus')] });
  assert.deepEqual([r.outcome, r.reason, r.lifeDelta, r.life.a1], [OUTCOME.aborted, ABORT.targetGone, {}, 2]);
  const slut = strid({ players: borta(lag(2), 'b1', 'b2'), attacks: [A('a1', 'stormning')] });
  assert.equal(slut.reason, ABORT.teamGone, 'matchslut prövas före måltavlan');
});

test('Ogiltig indata är ett internt fel: dubbla kort, två kort per person, fel lag, kort som inte kan användas', () => {
  const k = A('a1', 'stormning');
  assert.throws(() => strid({ attacks: [k, { ...k, playerId: 'a2' }] }), /två gånger/);
  assert.throws(() => strid({ attacks: [A('a1', 'stormning'), A('a1', 'armborst')] }), /mer än ett kort/);
  assert.throws(() => strid({ attacks: [A('a1', 'stormning')], defences: [D('a2', 'skoldmur')] }), /fel lag/);
  assert.throws(() => strid({ defences: [D('b1', 'stormning')] }), /kan inte användas som försvar/);
  assert.throws(() => strid({ attacks: [A('a1', 'skoldmur')] }), /kan inte användas som anfall/);
  assert.throws(() => strid({ target: 'x9' }), /Okänd måltavla/);
});

test('Funktionen är ren: indata och kortkatalog ändras inte, och samma indata ger samma resultat', () => {
  const katalog = JSON.stringify(cards);
  const players = lag(3, { a1: 1, b2: 1 });
  const drakeld = A('a1', 'drakeld');
  const input = { targetPlayerId: 'b1', players, startLife: Object.fromEntries(players.map(p => [p.id, p.life])),
    attacks: [drakeld, A('a2', 'sista-anfallet'), A('a3', 'sprangladdning')],
    defences: [D('b1', 'spegelskold', { kort: drakeld.instanceId }), D('b2', 'sista-bastionen'), D('b3', 'torneskold', { spelare: 'a3' })] };
  const fore = JSON.stringify(input);
  const deepFreeze = o => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); return o; };
  const r1 = beraknaLagstrid(deepFreeze(input));
  const r2 = beraknaLagstrid(input);
  assert.deepEqual(r1, r2);
  assert.equal(JSON.stringify(input), fore);
  assert.equal(JSON.stringify(cards), katalog);
});

/* ---- Målval vid spel ---- */
test('Giltiga mål: Barriär väljer ostoppade attackkort, Försegling/Spegelsköld bara ostoppad vanlig magi, Törnesköld fiender som anfallit', () => {
  const eld = A('a1', 'eldklot'), storm = A('a2', 'stormning'), enkel = A('a3', 'drakeld', USAGE.simple);
  const input = { targetPlayerId: 'b1', players: lag(3), startLife: {}, attacks: [eld, storm, enkel], defences: [D('b1', 'barriar', { kort: storm.instanceId })] };
  assert.deepEqual(giltigaKortmal(input, 'barriar'), [eld.instanceId, enkel.instanceId], 'redan stoppat kort kan inte väljas igen');
  assert.deepEqual(giltigaKortmal(input, 'forsegling'), [eld.instanceId]);
  assert.deepEqual(giltigaKortmal(input, 'spegelskold'), [eld.instanceId]);
  assert.deepEqual(giltigaKortmal(input, 'skoldmur'), []);
  assert.deepEqual(giltigaSpelarmal(input, 'b2'), ['a1', 'a2', 'a3']);
  const utan = { ...input, players: borta(input.players, 'a2') };
  assert.deepEqual(giltigaSpelarmal(utan, 'b2'), ['a1', 'a3']);
  assert.deepEqual(giltigaKortmal(utan, 'barriar'), [eld.instanceId, enkel.instanceId]);
  const utanBarriar = { ...input, players: borta(input.players, 'b1') };
  assert.deepEqual(giltigaKortmal(utanBarriar, 'barriar'), [eld.instanceId, storm.instanceId, enkel.instanceId], 'när Barriären tas bort är Stormning valbar igen');
});

test('Underlag från en lagmatch: bordskortens mål och startliv ger samma beräkning som räkneexemplet', () => {
  const m = newTeamMatch({ matchId: 'u', players: lag(3).map(p => ({ id: p.id, name: p.id, teamId: p.teamId })), random: styrdSlump(1) });
  while (m.phase === TEAM_PHASE.swap) for (const id of m.seats) if (m.swapsConfirmed[id] < m.swapRound) confirmSwap(m, id, [], styrdSlump(2));
  /* Lägg önskade kort i händerna genom att byta plats med ett kort i draghögen. */
  const ge = (pid, cardId) => {
    const id = m.drawPile.find(i => m.instances[i] === cardId);
    const hand = playerOf(m, pid).hand;
    m.drawPile[m.drawPile.indexOf(id)] = hand[0];
    hand[0] = id;
    auditTeam(m);
    return id;
  };
  const drakeld = ge('a1', 'drakeld'), storm = ge('a2', 'stormning'), spegel = ge('b1', 'spegelskold'), is = ge('b2', 'isrustning'), pal = ge('b3', 'palissad');
  playToTable(m, 'a1', drakeld, { role: ROLE.attack });
  playToTable(m, 'a2', storm, { role: ROLE.attack });
  playToTable(m, 'b1', spegel, { role: ROLE.defence, targetCard: drakeld });
  playToTable(m, 'b2', is, { role: ROLE.defence });
  playToTable(m, 'b3', pal, { role: ROLE.defence });
  const r = beraknaLagstrid(underlagFranMatch(m, { targetPlayerId: 'b1', startLife: Object.fromEntries(m.players.map(p => [p.id, p.life])) }));
  assert.deepEqual([r.attack, r.defence, r.outcome, r.cards[spegel].mirrorOf], [7, 9, OUTCOME.held, drakeld]);
  assert.equal(m.table.length, 5, 'beräkningen ändrar inte bordet');
});

/* ---- Korsprov: 1 mot 1 ska ge exakt duellens resultat för alla kombinationer ---- */
test('Korsprov mot strid.js: varje anfall (vanligt och enkelt) mot varje försvar eller avstående, alla startliv', () => {
  const anfall = [...cards.filter(c => c.attack).map(c => [c, USAGE.normal]), ...cards.map(c => [c, USAGE.simple])];
  const forsvar = [null, ...cards.filter(c => c.defence || c.cancel)];
  let kombinationer = 0;
  for (const [ac, usage] of anfall) for (const dc of forsvar) for (const aL of [1, 2, 3]) for (const dL of [1, 2, 3]) {
    const duell = resolve({ attacker: battleCard(ac.id, usage), defender: dc, attackerLife: aL, defenderLife: dL });
    const a = { instanceId: 'x1', playerId: 'a1', cardId: ac.id, usage };
    const d = dc && { instanceId: 'x2', playerId: 'b1', cardId: dc.id, targetCard: 'x1', targetPlayer: 'a1' };
    const r = beraknaLagstrid({ targetPlayerId: 'b1', players: [P('a1', aL), P('b1', dL)], startLife: { a1: aL, b1: dL }, attacks: [a], defences: d ? [d] : [] });
    const namn = `${ac.id}/${usage} mot ${dc?.id ?? 'avstående'} (${aL}/${dL})`;
    assert.deepEqual([r.attack, r.defence, r.defended, r.stopped.length > 0, r.life.a1, r.life.b1], [duell.attack, duell.defence, duell.defended, duell.stopped, duell.attackerLife, duell.defenderLife], namn);
    kombinationer++;
  }
  assert.equal(kombinationer, anfall.length * forsvar.length * 9, 'alla kombinationer prövades');
  assert.equal(kombinationer, 7452, '46 anfallsvarianter × 18 försvar/avstående × 9 startliv');
});

/* ---- Slumpade strider: gränser och invarianter ---- */
test('Slumpade lagstrider: styrkor ≥ 0, liv 0–3, högst ett liv för måltavlan, utslagna = liv 0, borttagna oförändrade', () => {
  const random = styrdSlump(77);
  const pick = list => list[Math.floor(random() * list.length)];
  const attackKort = cards.filter(c => c.attack), forsvarsKort = cards.filter(c => c.defence || c.cancel);
  for (let i = 0; i < 3000; i++) {
    const k = pick([2, 3, 4]);
    const players = lag(k).map(p => ({ ...p, life: 1 + Math.floor(random() * 3), alive: p.id === 'b1' || random() > 0.15 }));
    const attacks = players.filter(p => p.teamId === 'A' && random() > 0.25).map(p => random() < 0.2 ? A(p.id, pick(cards).id, USAGE.simple) : A(p.id, pick(attackKort).id));
    const defences = players.filter(p => p.teamId === 'B' && random() > 0.3).map(p => D(p.id, pick(forsvarsKort).id, { kort: attacks.length ? pick(attacks).instanceId : null, spelare: attacks.length ? pick(attacks).playerId : null }));
    const r = beraknaLagstrid({ targetPlayerId: 'b1', players, startLife: Object.fromEntries(players.map(p => [p.id, p.life])), attacks, defences });
    if (r.outcome === OUTCOME.aborted) { assert.deepEqual(r.lifeDelta, {}); continue; }
    assert.ok(r.attack >= 0 && r.defence >= 0);
    assert.equal(r.defended, r.defence >= r.attack);
    for (const p of players) {
      assert.ok(r.life[p.id] >= 0 && r.life[p.id] <= 3);
      if (!p.alive) assert.equal(r.life[p.id], p.life, 'en borttagen spelare påverkas inte');
      assert.equal(r.eliminated.includes(p.id), p.alive && r.life[p.id] === 0);
    }
    assert.ok((r.lifeDelta.b1 ?? 0) >= -1, 'måltavlan förlorar högst ett liv');
    const delar = Object.entries(r.lifeDelta);
    if (r.defended) assert.ok(delar.every(([id, d]) => d > 0 ? id.startsWith('b') : id.startsWith('a')), 'lyckat försvar: läkning till försvarare, motstöt till anfallare');
    else assert.ok(delar.every(([id, d]) => d > 0 ? id.startsWith('a') : id === 'b1'), 'träff: bara måltavlan skadas, bara anfallare läks');
  }
});
