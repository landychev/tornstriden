import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cards } from './kort.js';
import { rules, USAGE } from './matchregler.js';
import { newMatch, process, playerView, allowedActions, audit, PHASE, ACTION, STATUS } from './match.js';
import { STRATEGY, STRATEGIES, DecisionError, choicesFor, packAction, decide, chooseSwap, chooseAttack, chooseDefence, keepValue, outcomeUtility } from './dator.js';

/* Seedad slump (mulberry32) så att provmatcher går att upprepa. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* En fristående datorvy, byggd som playerView() i match.js skulle ge den. */
function makeView({ phase = PHASE.defence, hand = [], life = 3, oppLife = 3, oppCards = 5, attack = null, startLife = null, active = true, swapRound = 1 } = {}) {
  const me = { id: 'B', name: 'Norra tornet', life, hand: hand.map((cardId, i) => ({ instanceId: `v:kort:${i + 1}`, cardId })) };
  return {
    matchId: 'v', revision: 7, rulesVersion: rules.version, deckVersion: 'duell-50-v1', rules: { ...rules },
    phase, activePlayer: active ? 'B' : 'A',
    me, opponent: { id: 'A', name: 'Södra tornet', life: oppLife, cardCount: oppCards },
    swapRound, swapsConfirmed: { A: swapRound - 1, B: swapRound - 1 },
    battle: phase === PHASE.attack || phase === PHASE.defence ? { number: 1, attacker: phase === PHASE.attack ? 'B' : 'A', defender: phase === PHASE.attack ? 'A' : 'B', startLife: startLife ?? { A: oppLife, B: life }, attack, defenceAnswered: false } : null,
    lastResult: null, winner: null, endReason: null, error: null, drawPileSize: 20, discardPile: [], log: []
  };
}
const handCard = (view, cardId) => view.me.hand.find(c => c.cardId === cardId).instanceId;
const fixed = () => 0.42;

test('choicesFor: tom lista när det inte är datorns tur eller i RESULTAT/AVSLUTAD', () => {
  assert.deepEqual(choicesFor(makeView({ phase: PHASE.attack, hand: ['stormning'], active: false })), []);
  assert.deepEqual(choicesFor(makeView({ phase: PHASE.result })), []);
  assert.deepEqual(choicesFor(makeView({ phase: PHASE.over })), []);
  assert.equal(decide(makeView({ phase: PHASE.result })), null);
  assert.equal(decide(makeView({ phase: PHASE.attack, hand: ['stormning'], active: false })), null);
});
test('choicesFor: alla delmängder med 0–2 kort vid byte, normal + enkel attack, avstå + försvarskort', () => {
  const swap = choicesFor(makeView({ phase: PHASE.swap, hand: ['stormning', 'skoldmur', 'bagskytt', 'eldklot'] }));
  assert.equal(swap.length, 1 + 4 + 6);
  assert.ok(swap.every(c => c.type === ACTION.swap && new Set(c.cards).size === c.cards.length && c.cards.length <= 2));
  const attack = choicesFor(makeView({ phase: PHASE.attack, hand: ['stormning', 'skoldmur'] }));
  assert.deepEqual(attack.map(c => `${c.card}:${c.usage}`), ['v:kort:1:normal', 'v:kort:1:simple', 'v:kort:2:simple']);
  const defence = choicesFor(makeView({ phase: PHASE.defence, hand: ['stormning', 'skoldmur', 'barriar', 'riddare'], attack: { cardId: 'eldklot', usage: USAGE.normal } }));
  assert.deepEqual(defence.map(c => c.type), [ACTION.pass, ACTION.defend, ACTION.defend, ACTION.defend]);
  assert.deepEqual(packAction(defence[1], makeView()), { matchId: 'v', revision: 7, playerId: 'B', type: ACTION.defend, card: 'v:kort:2' });
});
test('Slumpstrategin väljer ett giltigt val och kastar beslutsfel vid tom vallista i aktiv fas', () => {
  const view = makeView({ phase: PHASE.attack, hand: ['stormning', 'skoldmur'] });
  const choices = choicesFor(view);
  for (let i = 0; i < 20; i++) { const { choice } = decide(view, { strategy: STRATEGIES.random, random: seeded(i) }); assert.ok(choices.some(c => c.card === choice.card && c.usage === choice.usage)); }
  assert.throws(() => decide({ ...makeView({ phase: PHASE.attack, hand: [] }), rules: { ...rules, simpleAttack: false } }, { strategy: STRATEGIES.random }), DecisionError);
  assert.throws(() => decide({ ...makeView({ phase: PHASE.attack, hand: [] }), rules: { ...rules, simpleAttack: false } }), DecisionError);
});
test('Datorn med bara försvarskort anfaller med en tillåten enkel attack', () => {
  const d = decide(makeView({ phase: PHASE.attack, hand: ['skoldmur', 'palissad', 'jarnport'] }), { random: fixed });
  assert.equal(d.choice.type, ACTION.attack);
  assert.equal(d.choice.usage, USAGE.simple);
  assert.match(d.reason, /enkel attack 1/);
});
test('Datorn utan försvarskort avstår', () => {
  const d = decide(makeView({ phase: PHASE.defence, hand: ['stormning', 'katapult'], attack: { cardId: 'eldklot', usage: USAGE.normal } }), { random: fixed });
  assert.equal(d.choice.type, ACTION.pass);
});
test('Ett liv och ett stoppande försvar: sparvärdet väger inte högre än överlevnad', () => {
  const view = makeView({ phase: PHASE.defence, hand: ['barriar', 'palissad'], life: 1, attack: { cardId: 'belagringstorn', usage: USAGE.normal } });
  const d = decide(view, { random: fixed });
  assert.equal(d.choice.type, ACTION.defend);
  assert.equal(d.choice.card, handCard(view, 'barriar'));
  assert.equal(outcomeUtility({ attackerLife: 3, defenderLife: 0 }, 'defender', view), STRATEGY.weights.loss);
});
test('Alla försvar misslyckas med samma livsresultat: datorn avstår och sparar korten', () => {
  const view = makeView({ phase: PHASE.defence, hand: ['palissad', 'tornvakt'], life: 3, attack: { cardId: 'belagringstorn', usage: USAGE.normal } });
  assert.equal(decide(view, { random: fixed }).choice.type, ACTION.pass);
});
test('Sista kortet är ett misslyckat försvar: grundstrategin avstår, påfyllningsbonusen spelar kortet', () => {
  const view = makeView({ phase: PHASE.defence, hand: ['palissad'], life: 3, attack: { cardId: 'belagringstorn', usage: USAGE.normal } });
  assert.equal(decide(view, { random: fixed }).choice.type, ACTION.pass);
  const withBonus = { ...STRATEGY, valueNewHand: true };
  assert.equal(decide(view, { random: fixed, config: withBonus }).choice.type, ACTION.defend);
  const lastLife = makeView({ phase: PHASE.defence, hand: ['palissad'], life: 1, attack: { cardId: 'belagringstorn', usage: USAGE.normal } });
  assert.equal(decide(lastLife, { random: fixed, config: withBonus }).choice.type, ACTION.pass, 'ingen bonus när datorn faller');
});
test('Isrustning mot Eldklot: attack 2 mot försvar 2 stoppas och väljs före avstående', () => {
  const view = makeView({ phase: PHASE.defence, hand: ['isrustning', 'palissad'], attack: { cardId: 'eldklot', usage: USAGE.normal } });
  const d = decide(view, { random: fixed });
  assert.equal(d.choice.card, handCard(view, 'isrustning'));
  assert.match(d.reason, /stoppas \(2 mot 2\)/);
});
test('Törnesköld som slår ut anfallaren prioriteras', () => {
  const view = makeView({ phase: PHASE.defence, hand: ['torneskold', 'fastningsmur', 'barriar'], oppLife: 1, attack: { cardId: 'stormning', usage: USAGE.normal }, startLife: { A: 1, B: 3 } });
  assert.equal(decide(view, { random: fixed }).choice.card, handCard(view, 'torneskold'));
});
test('Helande ljus: läkningen räknas när försvaret lyckas', () => {
  const view = makeView({ phase: PHASE.defence, hand: ['helande-ljus', 'skoldmur'], life: 2, attack: { cardId: 'stormning', usage: USAGE.normal } });
  assert.equal(decide(view, { random: fixed }).choice.card, handCard(view, 'helande-ljus'));
  const full = makeView({ phase: PHASE.defence, hand: ['helande-ljus', 'skoldmur'], life: 3, attack: { cardId: 'stormning', usage: USAGE.normal } });
  assert.equal(decide(full, { random: fixed }).choice.card, handCard(full, 'skoldmur'), 'utan läkningsbehov sparas specialkortet');
});
test('Magiskt kort som enkel attack bedöms som vanlig attack 1 utan ursprunglig effekt', () => {
  const view = makeView({ phase: PHASE.defence, hand: ['spegelskold', 'forsegling', 'palissad'], attack: { cardId: 'eldstorm', usage: USAGE.simple } });
  const d = decide(view, { random: fixed });
  assert.equal(d.choice.type, ACTION.defend);
  assert.equal(d.choice.card, handCard(view, 'palissad'), 'Palissad 1 räcker mot enkel attack 1 och är billigast');
  assert.match(d.reason, /\(1 mot 1\)/);
});
test('Anfall: starkare kort före svagare, Armborst 2 före enkel attack 1 vid lika nytta, motståndare utan kort ger bara avstående som exempel', () => {
  const view = makeView({ phase: PHASE.attack, hand: ['belagringstorn', 'spejare', 'armborst', 'skoldmur'] });
  assert.equal(decide(view, { random: fixed }).choice.card, handCard(view, 'belagringstorn'));
  const weak = makeView({ phase: PHASE.attack, hand: ['armborst', 'skoldmur'] });
  const d = decide(weak, { random: fixed });
  assert.deepEqual([d.choice.card, d.choice.usage], [handCard(weak, 'armborst'), USAGE.normal]);
  const noCards = makeView({ phase: PHASE.attack, hand: ['spejare', 'belagringstorn'], oppCards: 0 });
  const e = decide(noCards, { random: fixed });
  assert.equal(e.choice.card, handCard(noCards, 'spejare'), 'utan försvar räcker svagaste kortet; det dyrare sparas');
  assert.match(e.reason, /mot 1 försvarsexempel/);
});
test('Sista anfallet får sin riktiga bonus i bedömningen vid ett liv', () => {
  const view = makeView({ phase: PHASE.attack, hand: ['sista-anfallet', 'murbracka'], life: 1 });
  assert.equal(decide(view, { random: fixed }).choice.card, handCard(view, 'sista-anfallet'), 'vid ett liv räknas styrkan som 5; vid lika nytta väljs den starkare attacken');
  const twoLives = makeView({ phase: PHASE.attack, hand: ['sista-anfallet', 'murbracka'], life: 2 });
  assert.equal(decide(twoLives, { random: fixed }).choice.card, handCard(twoLives, 'murbracka'), 'utan bonus är Murbräcka 4 starkare än attack 2');
});
test('Startbyten: ensidig hand byter bort kort utan att offra det som behövs; balanserad hand behålls', () => {
  const lopsided = makeView({ phase: PHASE.swap, hand: ['spejare', 'skoldmur', 'palissad', 'tornvakt', 'jarnport', 'vallgrav', 'fastningsmur', 'runskold', 'barriar', 'skoldmur'] });
  const d = decide(lopsided, { random: fixed });
  assert.equal(d.choice.cards.length, 2);
  assert.ok(!d.choice.cards.includes(handCard(lopsided, 'spejare')), 'det enda attackkortet byts inte bort');
  assert.deepEqual(d.choice.cards.map(id => lopsided.me.hand.find(c => c.instanceId === id).cardId).sort(), ['palissad', 'tornvakt'], 'de två försvaren med lägst sparvärde');
  const balanced = makeView({ phase: PHASE.swap, hand: ['stormning', 'katapult', 'spejare', 'skoldmur', 'jarnport', 'palissad', 'eldklot', 'riddare', 'vallgrav', 'drakeld'] });
  assert.deepEqual(decide(balanced, { random: fixed }).choice.cards, []);
  const bothShort = makeView({ phase: PHASE.swap, hand: ['stormning', 'skoldmur'] });
  assert.deepEqual(decide(bothShort, { random: fixed }).choice.cards, [], 'när både anfall och försvar saknas offras inget');
});
test('Samma datorvy ger samma val oavsett motståndarens dolda hand', () => {
  const a = makeView({ phase: PHASE.attack, hand: ['katapult', 'riddare', 'skoldmur'], oppCards: 6 });
  const b = { ...a, opponent: { ...a.opponent, cardCount: 6 } };
  assert.deepEqual(decide(a, { random: seeded(5) }), decide(b, { random: seeded(5) }));
});
test('keepValue följer vikterna: grundstyrka + flexibelt 2 + förmåga 2 + barriär 5', () => {
  for (const [id, expected] of Object.entries({ stormning: 3, riddare: 5, drakeld: 6, barriar: 5, bagskytt: 4, 'sista-anfallet': 4 })) {
    assert.equal(keepValue(cards.find(c => c.id === id)), expected, `${id} ska ha sparvärde ${expected}`);
  }
});

test('Hela matcher dator mot dator genom motorn: inga ogiltiga drag, inga läckor, matchen avslutas', () => {
  const results = { A: 0, B: 0 };
  let battles = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const random = seeded(seed);
    const strategy = seed % 3 === 0 ? STRATEGIES.random : STRATEGIES.smart;
    let m = newMatch({ matchId: `sim${seed}`, random });
    let steps = 0;
    while (![PHASE.over, PHASE.error].includes(m.phase)) {
      assert.ok(steps++ < 2000, `matchen ${seed} fastnar`);
      let action;
      if (m.phase === PHASE.result) action = { matchId: m.id, revision: m.revision, type: ACTION.next };
      else {
        const view = playerView(m, m.activePlayer);
        assert.ok(!('instances' in view) && !('drawPile' in view));
        const decision = decide(view, { strategy, random });
        assert.ok(decision, `inget beslut i ${m.phase}`);
        const allowed = allowedActions(m, m.activePlayer).map(a => a.type);
        assert.ok(allowed.includes(decision.choice.type));
        action = packAction(decision.choice, view);
      }
      const reply = process(m, action, random);
      assert.equal(reply.status, STATUS.ok, `${m.phase}: ${reply.message}`);
      m = reply.match;
      audit(m);
    }
    assert.equal(m.phase, PHASE.over, `match ${seed}: ${m.error}`);
    results[m.winner] += 1;
    battles += m.battleNumber;
  }
  assert.equal(results.A + results.B, 30);
  assert.ok(battles / 30 < 60, `orimligt långa matcher: ${battles / 30} strider i snitt`);
});
