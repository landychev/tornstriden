/* Låsta regler och kortlekar för lagmatcher med 4, 6 eller 8 deltagare (arbetsordning L10,
   beslut 6A, 11A, 22A och 23A). Duellen behåller sina egna värden i matchregler.js.

   Kortleken: samma 30 korttyper och proportioner som duellen (11A). Baslistan nedan är en
   uttrycklig, låst kopia – nya kort i kort.js eller en ändrad duellek ändrar inte lagleken utan
   ett nytt beslut och en ny version. Varje matchstorlek har en egen kortleksversion, och lekens
   storlek bestäms vid matchstart (den krymper inte när någon slås ut). */
import { cards, MAX_LIFE } from './kort.js';
import { validateDeck, buildDeck, USAGE } from './matchregler.js';

export const TEAM_RULES_VERSION = 'lag-v1';
export const TEAM_SIZES = Object.freeze([4, 6, 8]);

export const teamRules = Object.freeze({
  version: TEAM_RULES_VERSION,
  sizes: TEAM_SIZES,
  maxPerTeam: 4,
  startLife: MAX_LIFE,   // tre liv, ett torn per spelare
  maxLife: MAX_LIFE,
  startCards: 10,
  swapRounds: 2,         // två startbyten ...
  maxCardsPerSwap: 2,    // ... med högst två kort per omgång
  refillCards: 5,        // 22A: bara helt tomma levande händer, ett kort per varv
  simpleAttack: true,    // 23A: valfritt kort som vanlig attack 1 utan specialeffekt
  simpleAttackStrength: 1
});

/* Låst baslista (en enhet = duellens fördelning): två av varje vanligt kort, ett av varje specialkort. */
export const BASE_COPIES = Object.freeze({
  stormning: 2, skoldmur: 2, bagskytt: 2, eldklot: 2, barriar: 2,
  spejare: 2, armborst: 2, katapult: 2, tornvakt: 2, jarnport: 2,
  murbracka: 2, ryttaranfall: 2, belagringstorn: 2, palissad: 2, vallgrav: 2,
  fastningsmur: 2, riddare: 2, livvakt: 2, eldstorm: 2, runskold: 2,
  sprangladdning: 1, 'sista-anfallet': 1, drakeld: 1, vampyrbett: 1, 'helande-ljus': 1,
  isrustning: 1, torneskold: 1, 'sista-bastionen': 1, spegelskold: 1, forsegling: 1
});

/* Minsta antal kort för utdelning och maximala startbyten när bortbytta kort ligger undan. */
export const minDeckSize = size => size * (teamRules.startCards + teamRules.swapRounds * teamRules.maxCardsPerSwap);

/* 11A: faktor = deltagare / 2. 4 → 100, 6 → 150, 8 → 200 kort. */
export const TEAM_DECKS = Object.freeze(Object.fromEntries(TEAM_SIZES.map(size => {
  const factor = size / 2;
  const copies = Object.freeze(Object.fromEntries(Object.entries(BASE_COPIES).map(([id, count]) => [id, count * factor])));
  const total = Object.values(copies).reduce((sum, n) => sum + n, 0);
  return [size, Object.freeze({ version: `lag-${total}-v1`, size, copies, total })];
})));

export function teamDeck(size) {
  const deck = TEAM_DECKS[size];
  if (!deck) throw new Error(`Lagmatcher har 4, 6 eller 8 deltagare, inte ${size}.`);
  return deck;
}

/* Kontrollerar kort-ID, antal och att leken räcker för matchstorleken. Returnerar antalet kort. */
export function validateTeamDeck(size, copies = teamDeck(size).copies, catalog = cards) {
  if (!TEAM_SIZES.includes(size)) throw new Error(`Lagmatcher har 4, 6 eller 8 deltagare, inte ${size}.`);
  const total = validateDeck(copies, catalog);
  if (total < minDeckSize(size)) throw new Error(`Kortleken har ${total} kort men ${size} deltagare behöver minst ${minDeckSize(size)}.`);
  return total;
}

/* Unika, blandade exemplar för en lagmatch: { id: `${matchId}:kort:${n}`, cardId }. */
export function buildTeamDeck({ size, matchId = 'lag', shuffleFn } = {}) {
  validateTeamDeck(size);
  return buildDeck({ matchId, copies: teamDeck(size).copies, ...(shuffleFn ? { shuffleFn } : {}) });
}

/* 23A: kortdata för ett spelat kort i lagstrid. Enkel attack ger ett tillfälligt, icke-magiskt
   attackkort med styrka 1 – ingen ability, cancel, försvarsstyrka eller magisk typ följer med.
   Originalet i katalogen ändras aldrig. */
export function teamBattleCard(cardId, usage = USAGE.normal, catalog = cards) {
  const card = catalog.find(item => item.id === cardId);
  if (!card) throw new Error(`Okänt kort: ${cardId}`);
  if (usage === USAGE.normal) return card;
  if (usage === USAGE.simple) return Object.freeze({ id: card.id, name: `${card.name} (enkel attack)`, type: 'attack', attack: teamRules.simpleAttackStrength, usage });
  throw new Error(`Okänd användning: ${usage}`);
}

/* Vad ett kort får användas till i lagstrid. Alla kort kan anfalla som enkel attack; försvar har ingen enkel variant. */
export const teamCanAttack = (card, usage = USAGE.normal) => usage === USAGE.simple ? teamRules.simpleAttack : Boolean(card?.attack);
export const teamCanDefend = card => Boolean(card?.defence || card?.cancel);
export { USAGE };
