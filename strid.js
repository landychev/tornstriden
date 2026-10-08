/* Ren regelberäkning för en duell. Samma funktion används i vyn och testerna. */
import { BONUS, MAX_LIFE } from './kort.js';

/* Förmågor som regelmotorn känner till. Testerna kontrollerar att varje kort använder en av dessa. */
export const abilities = Object.freeze(['pierce', 'lastAttack', 'dragon', 'lifesteal', 'heal', 'frost', 'thorns', 'lastDefence', 'mirror', 'seal']);

export function resolve({ attacker, defender = null, attackerLife = MAX_LIFE, defenderLife = MAX_LIFE }) {
  if (!attacker?.attack) throw new Error('Ett attackkort krävs.');
  if (defender && !(defender.defence || defender.cancel)) throw new Error('Ogiltigt försvarskort.');
  for (const life of [attackerLife, defenderLife]) if (!Number.isInteger(life) || life < 1 || life > MAX_LIFE) throw new Error(`Startliv måste vara 1–${MAX_LIFE}.`);
  const events = [];
  let attack = attacker.attack;
  let defence = defender?.defence || 0;
  const stopped = Boolean(defender?.cancel || (defender?.ability === 'seal' && attacker.type === 'magic'));
  if (stopped) {
    attack = 0;
    events.push(`${defender.name} stoppar ${attacker.name} och dess eventuella specialeffekt.`);
  } else {
    if (attacker.ability === 'lastAttack' && attackerLife === 1) {
      attack += BONUS.lastAttack;
      events.push(`${attacker.name} får +${BONUS.lastAttack} attack vid ett liv.`);
    }
    if (attacker.ability === 'dragon' && defender?.type === 'defence') {
      attack += BONUS.dragon;
      events.push(`${attacker.name} får +${BONUS.dragon} mot ett vanligt försvarskort.`);
    }
    if (defender?.ability === 'frost') {
      attack = Math.max(0, attack - BONUS.frost);
      events.push(`${defender.name} sänker attacken med ${BONUS.frost}, lägst till 0.`);
    }
  }
  if (defender?.ability === 'lastDefence' && defenderLife === 1) {
    defence += BONUS.lastDefence;
    events.push(`${defender.name} får +${BONUS.lastDefence} försvar vid ett liv.`);
  }
  if (defender?.ability === 'mirror' && attacker.type === 'magic') {
    defence = attack;
    events.push(`${defender.name} kopierar den magiska attackens styrka: ${attack}.`);
  }
  if (!stopped && attacker.ability === 'pierce') {
    defence = Math.max(0, defence - BONUS.pierce);
    events.push(`${attacker.name} sänker försvaret med ${BONUS.pierce}, lägst till 0.`);
  }
  const defended = defence >= attack;
  let nextAttackerLife = attackerLife;
  let nextDefenderLife = defenderLife;
  if (!defended) {
    nextDefenderLife -= 1;
    events.push('Försvararen förlorar ett liv.');
    if (attacker.ability === 'lifesteal') {
      nextAttackerLife = Math.min(MAX_LIFE, attackerLife + 1);
      events.push(nextAttackerLife > attackerLife ? `${attacker.name} återställer ett liv hos anfallaren.` : `Anfallaren har redan ${MAX_LIFE} liv; ${attacker.name} ger inget extra liv.`);
    }
  } else {
    events.push('Försvaret håller.');
    if (defender?.ability === 'heal') {
      nextDefenderLife = Math.min(MAX_LIFE, defenderLife + 1);
      events.push(nextDefenderLife > defenderLife ? `${defender.name} återställer ett liv hos försvararen.` : `Försvararen har redan ${MAX_LIFE} liv; ingen läkning behövs.`);
    }
    if (defender?.ability === 'thorns') {
      nextAttackerLife -= 1;
      events.push(`${defender.name} gör en motstöt: anfallaren förlorar ett liv.`);
    }
  }
  return { attack, defence, defended, stopped, attackerLife: nextAttackerLife, defenderLife: nextDefenderLife, events };
}
