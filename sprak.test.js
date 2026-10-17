import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cards } from './kort.js';
import { resolve } from './strid.js';
import { beraknaLagstrid } from './lagstrid.js';
import { texts } from './sprak-en.js';
import { templates } from './sprak-meddelanden.js';
import { t, source, message, setLanguage, language, cardText, onLanguageChange } from './sprak.js';

afterEach(() => setLanguage('sv'));

test('språkval valideras och parametrar med specialtecken bevaras exakt', () => {
  assert.equal(setLanguage('en'), true);
  assert.equal(setLanguage('xx'), false);
  assert.equal(language(), 'en');
  assert.equal(t`Väntar på ${'Försvar {1} $& <tag>'}.`, 'Waiting for Försvar {1} $& <tag>.');
  assert.equal(source`Väntar på ${'Stormning'}.`, 'Väntar på Stormning.');
  assert.equal(t`Byt ${1} kort`, 'Swap 1 card');
  assert.equal(t`Byt ${2} kort`, 'Swap 2 cards');
});

test('alla kort har engelska namn, etiketter och fullständiga förklaringar utan ändrade regler', () => {
  const before = structuredClone(cards);
  setLanguage('en');
  for (const card of cards) {
    for (const field of ['name', 'label', 'valueLabel', 'when', 'effect']) assert.ok(Object.hasOwn(texts, card[field]), `${card.id}.${field}`);
    const translated = cardText(card);
    for (const field of ['id', 'type', 'attack', 'defence', 'ability', 'cancel', 'value']) assert.equal(translated[field], card[field]);
  }
  assert.deepEqual(cards, before);
  assert.equal(cardText(cards[0]).name, 'Assault');
  setLanguage('sv');
  assert.equal(cardText(cards[0]).name, 'Stormning');
});

test('protokolltexter översätts med spelarens nick oförändrat, även när det är ett svenskt kortnamn', () => {
  setLanguage('en');
  assert.equal(message('Stormning har inte valt lag.'), 'Stormning has not chosen a team.');
  assert.equal(message('Väntar på Försvar {0}.'), 'Waiting for Försvar {0}.');
  assert.equal(message('Försvar försvarar med Sköldmur.'), 'Försvar defends with Shield Wall.');
  assert.equal(message('Magisk barriär stoppar Eldklot och dess eventuella specialeffekt.'), 'Magic Barrier stops Fireball and any special effect it has.');
  assert.equal(message('Nicket är upptaget – välj ett annat.'), 'That nickname is taken – choose another.');
  assert.equal(message('Lagen är ojämna: 3 mot 1. Någon behöver byta lag.'), 'Teams are uneven: 3 vs 1. Someone needs to change teams.');
});

test('alla duellens resultattexter har översättning, inklusive specialkort och läkning', () => {
  setLanguage('en');
  for (const attacker of cards.filter(c => c.attack)) for (const defender of [null, ...cards.filter(c => c.defence || c.cancel)]) for (const life of [1, 3]) {
    for (const event of resolve({ attacker, defender, attackerLife: life, defenderLife: life }).events) {
      assert.notEqual(message(event), event, event);
    }
  }
});

test('översättningar behåller mallarnas parametrar och protokollmallarna finns i katalogen', () => {
  const params = value => [...value.matchAll(/\{\d+\}/g)].map(m => m[0]).sort();
  for (const [key, value] of Object.entries(texts)) assert.deepEqual(params(value), params(key), key);
  for (const { key, localize } of templates) {
    assert.ok(Object.hasOwn(texts, key), key);
    for (const index of localize) assert.ok(key.includes(`{${index}}`), key);
  }
});

test('språkbyte meddelar vyerna en gång och en prenumeration kan tas bort', () => {
  setLanguage('sv');
  const changes = [];
  const stop = onLanguageChange(value => changes.push(value));
  setLanguage('en'); setLanguage('en'); stop(); setLanguage('sv');
  assert.deepEqual(changes, ['en']);
});

test('lagresultat översätter specialeffekter och bevarar spelarnamn', () => {
  setLanguage('en');
  for (const attack of cards.filter(c => c.attack)) for (const defence of cards.filter(c => c.defence || c.cancel)) for (const life of [1, 3]) {
    const players = [{ id: 'a1', teamId: 'A', life, alive: true, name: 'Stormning' }, { id: 'b1', teamId: 'B', life, alive: true, name: 'Försvar' }];
    const result = beraknaLagstrid({ targetPlayerId: 'b1', players, attacks: [{ instanceId: 'attack', playerId: 'a1', cardId: attack.id }], defences: [{ instanceId: 'defence', playerId: 'b1', cardId: defence.id, targetCard: 'attack', targetPlayer: 'a1' }] });
    for (const event of result.events) assert.notEqual(message(event), event, event);
  }
  assert.equal(message('Magisk barriär (Försvar) stoppar Eldklot (Stormning) och dess specialeffekt.'), 'Magic Barrier (Försvar) stops Fireball (Stormning) and its special effect.');
  assert.equal(message('nick: Nicket får inte innehålla kontrolltecken.'), 'nick: The nickname must not contain control characters.');
});
