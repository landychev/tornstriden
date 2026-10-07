const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { resolve } = require('./strid.js');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(__dirname + '/kort.js', 'utf8'), context);
const cards = context.window.TORNSTRIDEN_CARDS;
const card = id => cards.find(item => item.id === id);
const fight = (a, d, attackerLife = 3, defenderLife = 3) => resolve({ attacker: card(a), defender: card(d), attackerLife, defenderLife });

test('30 unika kort; tio specialkort med existerande bildlager', () => {
  assert.equal(cards.length, 30);
  assert.equal(new Set(cards.map(c => c.id)).size, 30);
  assert.equal(cards.filter(c => c.ability).length, 10);
  for (const c of cards.filter(c => c.ability)) assert.ok(fs.existsSync(`${__dirname}/assets/effekter/${c.overlay}.svg`));
});
test('Sprängladdning sänker försvar men stoppas helt av barriär', () => {
  assert.equal(fight('sprangladdning', 'skoldmur').defence, 1);
  assert.equal(fight('sprangladdning', 'skoldmur').defenderLife, 2);
  assert.equal(fight('sprangladdning', 'palissad').defence, 0);
  assert.equal(fight('sprangladdning', 'barriar').attack, 0);
  assert.ok(!fight('sprangladdning', 'barriar').events.some(e => e.includes('sänker försvaret')));
});
test('Sista anfallet ger bonus endast vid ett startliv', () => {
  assert.equal(fight('sista-anfallet', 'skoldmur', 1).attack, 5);
  assert.equal(fight('sista-anfallet', 'skoldmur', 2).attack, 2);
  assert.equal(fight('sista-anfallet', 'barriar', 1).attack, 0);
});
test('Drakeld får bonus mot vanlig försvarstyp, inte magi eller flexibla kort', () => {
  assert.equal(fight('drakeld', 'skoldmur').attack, 6);
  assert.equal(fight('drakeld', 'riddare').attack, 4);
  assert.equal(fight('drakeld', 'runskold').attack, 4);
  assert.equal(fight('drakeld', 'forsegling').attack, 0);
});
test('Vampyrbett läker vid träff, aldrig över tre eller efter stopp', () => {
  assert.equal(fight('vampyrbett', 'palissad', 2).attackerLife, 3);
  assert.equal(fight('vampyrbett', 'palissad', 3).attackerLife, 3);
  assert.equal(fight('vampyrbett', 'skoldmur', 2).attackerLife, 2);
  assert.equal(fight('vampyrbett', 'forsegling', 2).attackerLife, 2);
});
test('Helande ljus läker endast efter lyckat försvar', () => {
  assert.equal(fight('stormning', 'helande-ljus', 3, 2).defenderLife, 3);
  assert.equal(fight('stormning', 'helande-ljus', 3, 3).defenderLife, 3);
  assert.equal(fight('eldklot', 'helande-ljus', 3, 2).defenderLife, 1);
});
test('Isrustning minskar båda attacktyperna och går inte under noll', () => {
  assert.equal(fight('eldklot', 'isrustning').attack, 2);
  assert.equal(fight('eldklot', 'isrustning').defended, true);
  assert.equal(fight('spejare', 'isrustning').attack, 0);
  assert.equal(fight('sprangladdning', 'isrustning').defence, 0);
});
test('Törnesköld gör motstöt bara när försvaret lyckas', () => {
  assert.equal(fight('stormning', 'torneskold').attackerLife, 2);
  assert.equal(fight('stormning', 'torneskold', 1).attackerLife, 0);
  assert.equal(fight('eldklot', 'torneskold').attackerLife, 3);
});
test('Sista bastionen ger sex försvar vid ett liv', () => {
  assert.equal(fight('belagringstorn', 'sista-bastionen', 3, 1).defence, 6);
  assert.equal(fight('belagringstorn', 'sista-bastionen', 3, 1).defenderLife, 1);
  assert.equal(fight('belagringstorn', 'sista-bastionen', 3, 2).defence, 2);
});
test('Spegelsköld kopierar bara magiska attacker', () => {
  assert.equal(fight('eldstorm', 'spegelskold').defence, 5);
  assert.equal(fight('eldstorm', 'spegelskold').defended, true);
  assert.equal(fight('katapult', 'spegelskold').defence, 1);
});
test('Försegling stoppar magi men har endast försvar två mot vanliga attacker', () => {
  assert.equal(fight('eldklot', 'forsegling').attack, 0);
  assert.equal(fight('stormning', 'forsegling').defenderLife, 2);
});
test('Befintliga kort och avstående behåller sitt beteende', () => {
  assert.equal(fight('stormning', 'skoldmur').defended, true);
  assert.equal(fight('katapult', 'jarnport').defenderLife, 2);
  assert.equal(fight('eldklot', 'barriar').defended, true);
  assert.equal(fight('riddare', 'skoldmur').attack, 3);
  assert.equal(fight('eldklot', 'riddare').defence, 2);
  assert.equal(resolve({attacker:card('eldklot')}).defenderLife, 2);
});
test('Alla kortkombinationer håller liv och styrkor inom giltiga gränser', () => {
  for (const a of cards.filter(c => c.attack)) {
    for (const d of cards.filter(c => c.defence || c.cancel)) {
      for (const attackerLife of [1, 2, 3]) for (const defenderLife of [1, 2, 3]) {
        const r = resolve({attacker:a, defender:d, attackerLife, defenderLife});
        assert.ok(r.attack >= 0 && r.defence >= 0);
        assert.ok(r.attackerLife >= 0 && r.attackerLife <= 3);
        assert.ok(r.defenderLife >= 0 && r.defenderLife <= 3);
        assert.ok(Math.abs(r.attackerLife - attackerLife) <= 1);
        assert.ok(Math.abs(r.defenderLife - defenderLife) <= 1);
        assert.equal(r.defended, r.defence >= r.attack);
      }
    }
  }
});
