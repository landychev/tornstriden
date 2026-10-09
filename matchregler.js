/* Beslutade regler och låst kortlek för första duellversionen (SPELREGLER.md, avsnitt 13).
   Matchmotorn (del 2) och datorn (del 3) läser värdena härifrån i stället för
   att upprepa dem. Beräkningen av en enskild strid finns oförändrad i strid.js. */
import { cards, MAX_LIFE } from './kort.js';

export const RULES_VERSION = 'duell-v1';
export const DECK_VERSION = 'duell-50-v1';

/* Regelbeslut bekräftade 2026-10-09. */
export const rules = Object.freeze({
  version: RULES_VERSION,
  players: 2,            // två spelare, ett torn var, gemensam kortlek
  startLife: MAX_LIFE,   // 3 liv; läkning går aldrig över maxliv
  maxLife: MAX_LIFE,
  startCards: 10,
  swapRounds: 2,         // två bytesomgångar före start ...
  maxCardsPerSwap: 2,    // ... med högst två kort per omgång
  refillCards: 5,        // endast vid helt tom hand, efter striden
  simpleAttack: true,    // valfritt kort som vanlig attack 1 utan specialeffekt
  simpleAttackStrength: 1,
  surrender: true        // Ge upp: motståndaren vinner, liv ändras inte
});

/* 20 startkort + högst 8 ersättningskort under startbytena. */
export const MIN_DECK_SIZE = rules.players * (rules.startCards + rules.swapRounds * rules.maxCardsPerSwap);

/* Hur ett kort används i en strid. Enkel attack gäller bara anfallaren. */
export const USAGE = Object.freeze({ normal: 'normal', simple: 'simple' });

/* Låst fördelning: kort-ID → antal exemplar. Listan är avsiktligt uttrycklig,
   så att nya kort i kort.js inte ändrar leken utan ett nytt beslut.
   Två exemplar av varje kort utan ability, ett av varje specialkort. Summa 50. */
export const deck = Object.freeze({
  version: DECK_VERSION,
  copies: Object.freeze({
    stormning: 2, skoldmur: 2, bagskytt: 2, eldklot: 2, barriar: 2,
    spejare: 2, armborst: 2, katapult: 2, tornvakt: 2, jarnport: 2,
    murbracka: 2, ryttaranfall: 2, belagringstorn: 2, palissad: 2, vallgrav: 2,
    fastningsmur: 2, riddare: 2, livvakt: 2, eldstorm: 2, runskold: 2,
    sprangladdning: 1, 'sista-anfallet': 1, drakeld: 1, vampyrbett: 1, 'helande-ljus': 1,
    isrustning: 1, torneskold: 1, 'sista-bastionen': 1, spegelskold: 1, forsegling: 1
  })
});

/* Kontrollerar att varje kort-ID finns, att antalen är positiva heltal och att
   leken räcker till utdelning och startbyten. Returnerar antalet kort. */
export function validateDeck(copies = deck.copies, catalog = cards) {
  const known = new Set(catalog.map(card => card.id));
  let total = 0;
  for (const [id, count] of Object.entries(copies)) {
    if (!known.has(id)) throw new Error(`Okänt kort i kortleken: ${id}`);
    if (!Number.isInteger(count) || count < 1) throw new Error(`${id}: antalet måste vara ett positivt heltal.`);
    total += count;
  }
  if (total < MIN_DECK_SIZE) throw new Error(`Kortleken har ${total} kort men behöver minst ${MIN_DECK_SIZE}.`);
  return total;
}

/* Fisher–Yates på en kopia. Byts ut i tester och utvecklingsläge. */
export function shuffle(list, random = Math.random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/* Skapar ett exemplar per kort i fördelningen och blandar dem.
   Varje exemplar { id, cardId } har en egen identitet, även när korttypen är samma. */
export function buildDeck({ matchId = 'match', copies = deck.copies, shuffleFn = shuffle } = {}) {
  validateDeck(copies);
  const instances = [];
  let serial = 0;
  for (const [cardId, count] of Object.entries(copies)) {
    for (let n = 0; n < count; n++) instances.push(Object.freeze({ id: `${matchId}:kort:${++serial}`, cardId }));
  }
  const shuffled = shuffleFn(instances);
  if (shuffled.length !== instances.length || new Set(shuffled.map(card => card.id)).size !== instances.length) throw new Error('Blandningen ändrade antalet exemplar.');
  return shuffled;
}

/* Kortdata som resolve() i strid.js ska få för ett spelat kort.
   Enkel attack ger ett tillfälligt, icke-magiskt attackkort med styrka 1;
   ingen ability, cancel eller annan egenskap följer med. Originalet ändras aldrig. */
export function battleCard(cardId, usage = USAGE.normal, catalog = cards) {
  const card = catalog.find(item => item.id === cardId);
  if (!card) throw new Error(`Okänt kort: ${cardId}`);
  if (usage === USAGE.normal) return card;
  if (usage === USAGE.simple) {
    if (!rules.simpleAttack) throw new Error('Enkel attack är avstängd i denna regelversion.');
    return Object.freeze({ id: card.id, name: `${card.name} (enkel attack)`, type: 'attack', attack: rules.simpleAttackStrength, usage });
  }
  throw new Error(`Okänd användning: ${usage}`);
}

/* Vad ett kort får användas till. Försvar har ingen enkel variant. */
export const canAttack = (card, usage = USAGE.normal) => usage === USAGE.simple ? rules.simpleAttack : Boolean(card?.attack);
export const canDefend = card => Boolean(card?.defence || card?.cancel);
