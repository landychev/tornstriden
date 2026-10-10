/* Spelbordet: ett tillstånd (state), rena härledningar ur det, och en render() som målar allt.
   Handlingarna längst ner ändrar bara state och anropar render(). */
import { cards, MAX_LIFE } from './kort.js';
import { resolve } from './strid.js';
import { cardFace, towerAppearance } from './grafik.js';

const $ = id => document.getElementById(id);
const HAND_SETS = { original: 0, new: 10, effects: 20 };
const HAND_SIZE = 10;
const HEART = '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 20.6S3.4 15.3 3.4 9.4A4.6 4.6 0 0 1 12 6.9a4.6 4.6 0 0 1 8.6 2.5c0 5.9-8.6 11.2-8.6 11.2z"/></svg>';

const state = {
  mode: 'attack',                                   // 'attack' | 'defence'
  handSet: 'effects',                               // nyckel i HAND_SETS
  opponents: { attack: 'skoldmur', defence: 'eldklot' },
  ownStart: MAX_LIFE,
  enemyStart: MAX_LIFE,
  selectedId: null,
  outcome: null                                     // { played, result, ownLife, enemyLife } när striden är avgjord
};

/* ---- Härledningar ur state ---- */
const hand = () => cards.slice(HAND_SETS[state.handSet], HAND_SETS[state.handSet] + HAND_SIZE);
const opponentCard = () => cards.find(card => card.id === state.opponents[state.mode]);
const selected = () => hand().find(card => card.id === state.selectedId) ?? null;
const valid = card => Boolean(card && (state.mode === 'attack' ? card.attack : card.defence || card.cancel));
const opponentChoices = () => cards.filter(card => state.mode === 'attack' ? card.defence || card.cancel : card.attack);

function counts() {
  const own = hand().length;
  if (!state.outcome) return { own, enemy: HAND_SIZE, discard: 0 };
  const { played, ownLife, enemyLife } = state.outcome;
  const ownLeft = own - (played ? 1 : 0);
  const enemyLeft = HAND_SIZE - 1;                  // motståndaren spelar alltid sitt kort
  return {
    own: ownLife === 0 ? 0 : ownLeft,
    enemy: enemyLife === 0 ? 0 : enemyLeft,
    discard: (played ? 1 : 0) + 1 + (ownLife === 0 ? ownLeft : 0) + (enemyLife === 0 ? enemyLeft : 0)
  };
}

/* ---- Små ritfunktioner ---- */
const cardHTML = card => cardFace(card);

function life(id, count, previous = count) {
  $(id).setAttribute('aria-label', `${count} av ${MAX_LIFE} liv`);
  $(id).innerHTML = Array.from({ length: MAX_LIFE }, (_, n) => `<span aria-hidden="true" class="${n < count ? '' : 'lost'}${n >= count && n < previous ? ' just-lost' : ''}">${HEART}</span>`).join('');
}

function slot(id, card, label) {
  $(id).setAttribute('aria-label', label);
  $(id).innerHTML = card ? `<div class="mini-card ${card.type}" aria-label="${label}: ${card.name}">${cardHTML(card)}</div>` : `<div class="empty"><span aria-hidden="true">+</span>${label}</div>`;
}

function tower(id, { start, life: current, defended, isDefender }) {
  const el = $(id);
  towerAppearance(el, current);
  el.classList.toggle('damaged', current < start);
  el.classList.toggle('fallen', current === 0);
  el.classList.toggle('held', Boolean(state.outcome) && isDefender && defended);
  el.classList.toggle('hit', Boolean(state.outcome) && (isDefender ? !defended : current < start));
}

/* ---- Handen byggs bara om när dess innehåll ändras; annars uppdateras bara knapparnas tillstånd ---- */
let renderedHandKey = null;
function renderHand() {
  const key = `${state.handSet}|${state.mode}|${state.outcome ? 'done' : 'open'}`;
  if (key !== renderedHandKey) {
    renderedHandKey = key;
    const gone = state.outcome?.ownLife === 0 ? () => true : card => card.id === state.outcome?.played?.id;
    $('hand').innerHTML = hand().filter(card => !gone(card)).map(card => `<button type="button" class="mini-card ${card.type}${valid(card) ? '' : ' unusable'}" data-card="${card.id}" aria-pressed="false"${valid(card) ? '' : ' aria-disabled="true"'} aria-label="${card.name}, ${card.valueLabel} ${card.value}${card.isNew ? ', nytt kortförslag' : ''}${valid(card) ? '' : `, används vid ${state.mode === 'attack' ? 'försvar' : 'attack'}`}">${cardHTML(card)}${card.isNew ? '<span class="new-tag">Nytt förslag</span>' : ''}</button>`).join('');
  }
  for (const button of $('hand').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(!state.outcome && button.dataset.card === state.selectedId));
    button.disabled = Boolean(state.outcome);
  }
}

function render() {
  const { mode, outcome, ownStart, enemyStart } = state;
  const ownLife = outcome ? outcome.ownLife : ownStart;
  const enemyLife = outcome ? outcome.enemyLife : enemyStart;
  const pick = selected();
  const n = counts();

  // Torn och liv
  life('own-life', ownLife, ownStart);
  life('enemy-life', enemyLife, enemyStart);
  tower('own-tower', { start: ownStart, life: ownLife, defended: outcome?.result.defended, isDefender: mode === 'defence' });
  tower('enemy-tower', { start: enemyStart, life: enemyLife, defended: outcome?.result.defended, isDefender: mode === 'attack' });
  $('own-count').textContent = `${n.own} kort på handen`;
  $('enemy-count').textContent = `${n.enemy} kort på handen`;
  $('discard-number').textContent = String(n.discard);
  $('turn-label').textContent = outcome ? 'Teststriden är avslutad' : 'Din tur att välja kort';

  // Stridsplatsen
  $('attack-mode').setAttribute('aria-pressed', String(mode === 'attack'));
  $('defence-mode').setAttribute('aria-pressed', String(mode === 'defence'));
  if (outcome) {
    slot('attack-slot', null, 'Kortet är slängt');
    slot('defence-slot', null, outcome.played || mode === 'attack' ? 'Kortet är slängt' : 'Inget försvar spelades');
    $('phase-title').textContent = ownLife === 0 ? 'Ditt torn faller' : enemyLife === 0 ? 'Motståndarens torn faller' : outcome.result.defended ? 'Försvaret håller' : 'Tornet träffas';
    $('phase-description').textContent = `Attack ${outcome.result.attack} mot försvar ${outcome.result.defence}. Återställ eller byt teststrid för att prova igen.`;
  } else {
    const mine = valid(pick) ? pick : null;
    slot('attack-slot', mode === 'attack' ? mine : opponentCard(), mode === 'attack' ? 'Ditt attackkort' : 'Motståndarens attackkort');
    slot('defence-slot', mode === 'defence' ? mine : opponentCard(), mode === 'defence' ? 'Ditt försvarskort' : 'Motståndarens försvarskort');
    $('phase-title').textContent = mode === 'attack' ? 'Ditt anfall' : 'Försvara ditt torn';
    $('phase-description').textContent = `Motståndaren ${mode === 'attack' ? 'försvarar' : 'anfaller'} med ${opponentCard().name}.`;
  }

  // Inställningar
  $('opponent-card').innerHTML = opponentChoices().map(card => `<option value="${card.id}">${card.name} · ${card.value}</option>`).join('');
  $('opponent-card').value = state.opponents[mode];
  $('own-start-life').value = String(ownStart);
  $('enemy-start-life').value = String(enemyStart);

  // Handen
  const playable = hand().filter(valid).length;
  $('hand-count').textContent = outcome ? `${n.own} kort` : playable === hand().length ? `${hand().length} kort` : `${hand().length} kort · ${playable} spelbara`;
  for (const key of Object.keys(HAND_SETS)) $(`${key}-hand`).setAttribute('aria-pressed', String(state.handSet === key));
  renderHand();

  // Val, knappar och resultat
  if (outcome) {
    const title = outcome.played ? `${outcome.played.name} har spelats` : ownLife === 0 ? 'Du avstod från försvar' : 'Du sparade dina kort';
    $('selection-info').innerHTML = `<h3>${title}</h3><p>Inga förbrukade kort ersätts. Återställ för en ny fristående teststrid med samma startinställningar.</p>`;
  } else if (pick) {
    $('selection-info').innerHTML = `<h3>${pick.name}</h3><p>${pick.effect}</p>${valid(pick) ? '' : `<p class="invalid">Det här kortet används vid ${mode === 'attack' ? 'försvar' : 'attack'}. Välj ett annat kort eller byt teststrid.</p>`}`;
  } else {
    $('selection-info').innerHTML = '<h3>Välj ditt kort</h3><p>Tryck på ett kort för att läsa effekten. Kortets siffra visar grundstyrkan; specialeffekten räknas när striden avgörs.</p>';
  }
  $('resolve').disabled = Boolean(outcome) || !valid(pick);
  $('pass').hidden = mode === 'attack';
  $('pass').disabled = Boolean(outcome);
  if (outcome) {
    const { result } = outcome;
    const fallen = ownLife === 0 || enemyLife === 0 ? ' Det fallna tornets kvarvarande handkort slängs också.' : '';
    $('result').innerHTML = `<h3>${$('phase-title').textContent}</h3><p>Attack ${result.attack} mot försvar ${result.defence}.</p><ul>${result.events.map(event => `<li>${event}</li>`).join('')}</ul><p>Du har ${ownLife} liv. Motståndaren har ${enemyLife} liv. Alla spelade kort slängs.${fallen}</p>`;
  } else {
    $('result').replaceChildren();
  }
}

/* ---- Handlingar ---- */
function reset(changes = {}) {
  Object.assign(state, changes, { selectedId: null, outcome: null });
  render();
}

function choose(id) {
  if (state.outcome || !hand().some(card => card.id === id)) return;
  state.selectedId = id;
  render();
}

function fight(pass = false) {
  if (state.outcome || (pass && state.mode !== 'defence') || (!pass && !valid(selected()))) return;
  const played = pass ? null : selected();
  const attacking = state.mode === 'attack';
  const result = resolve({
    attacker: attacking ? played : opponentCard(),
    defender: attacking ? opponentCard() : played,
    attackerLife: attacking ? state.ownStart : state.enemyStart,
    defenderLife: attacking ? state.enemyStart : state.ownStart
  });
  state.outcome = {
    played,
    result,
    ownLife: attacking ? result.attackerLife : result.defenderLife,
    enemyLife: attacking ? result.defenderLife : result.attackerLife
  };
  render();
  $('result').focus({ preventScroll: true });
}

$('hand').addEventListener('click', event => { const button = event.target.closest('[data-card]'); if (button) choose(button.dataset.card); });
$('attack-mode').addEventListener('click', () => reset({ mode: 'attack' }));
$('defence-mode').addEventListener('click', () => reset({ mode: 'defence' }));
$('reset').addEventListener('click', () => reset());
$('resolve').addEventListener('click', () => fight());
$('pass').addEventListener('click', () => fight(true));
for (const key of Object.keys(HAND_SETS)) $(`${key}-hand`).addEventListener('click', () => reset({ handSet: key }));
$('opponent-card').addEventListener('change', () => reset({ opponents: { ...state.opponents, [state.mode]: $('opponent-card').value } }));
$('own-start-life').addEventListener('change', () => reset({ ownStart: Number($('own-start-life').value) }));
$('enemy-start-life').addEventListener('change', () => reset({ enemyStart: Number($('enemy-start-life').value) }));
render();
