/* Ren regelberäkning för en duell. Samma funktion används i vyn och testerna. */
(function (root) {
  'use strict';
  function resolve({ attacker, defender = null, attackerLife = 3, defenderLife = 3 }) {
    if (!attacker?.attack) throw new Error('Ett attackkort krävs.');
    if (defender && !(defender.defence || defender.cancel)) throw new Error('Ogiltigt försvarskort.');
    for (const life of [attackerLife, defenderLife]) if (!Number.isInteger(life) || life < 1 || life > 3) throw new Error('Startliv måste vara 1–3.');
    const events = [];
    let attack = attacker.attack;
    let defence = defender?.defence || 0;
    const stopped = Boolean(defender?.cancel || (defender?.ability === 'seal' && attacker.type === 'magic'));
    if (stopped) {
      attack = 0;
      events.push(`${defender.name} stoppar ${attacker.name} och dess eventuella specialeffekt.`);
    } else {
      if (attacker.ability === 'lastAttack' && attackerLife === 1) {
        attack += 3;
        events.push('Sista anfallet får +3 attack vid ett liv.');
      }
      if (attacker.ability === 'dragon' && defender?.type === 'defence') {
        attack += 2;
        events.push('Drakeld får +2 mot ett vanligt försvarskort.');
      }
      if (defender?.ability === 'frost') {
        attack = Math.max(0, attack - 2);
        events.push('Isrustning sänker attacken med 2, lägst till 0.');
      }
    }
    if (defender?.ability === 'lastDefence' && defenderLife === 1) {
      defence += 4;
      events.push('Sista bastionen får +4 försvar vid ett liv.');
    }
    if (defender?.ability === 'mirror' && attacker.type === 'magic') {
      defence = attack;
      events.push(`Spegelsköld kopierar den magiska attackens styrka: ${attack}.`);
    }
    if (!stopped && attacker.ability === 'pierce') {
      defence = Math.max(0, defence - 2);
      events.push('Sprängladdning sänker försvaret med 2, lägst till 0.');
    }
    const defended = defence >= attack;
    let nextAttackerLife = attackerLife;
    let nextDefenderLife = defenderLife;
    if (!defended) {
      nextDefenderLife -= 1;
      events.push('Försvararen förlorar ett liv.');
      if (attacker.ability === 'lifesteal') {
        nextAttackerLife = Math.min(3, attackerLife + 1);
        events.push(nextAttackerLife > attackerLife ? 'Vampyrbett återställer ett liv hos anfallaren.' : 'Anfallaren har redan tre liv; Vampyrbett ger inget extra liv.');
      }
    } else {
      events.push('Försvaret håller.');
      if (defender?.ability === 'heal') {
        nextDefenderLife = Math.min(3, defenderLife + 1);
        events.push(nextDefenderLife > defenderLife ? 'Helande ljus återställer ett liv hos försvararen.' : 'Försvararen har redan tre liv; ingen läkning behövs.');
      }
      if (defender?.ability === 'thorns') {
        nextAttackerLife -= 1;
        events.push('Törnesköld gör en motstöt: anfallaren förlorar ett liv.');
      }
    }
    return { attack, defence, defended, stopped, attackerLife: nextAttackerLife, defenderLife: nextDefenderLife, events };
  }
  const api = Object.freeze({ resolve });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TORNSTRIDEN_BATTLE = api;
})(typeof window === 'undefined' ? null : window);
