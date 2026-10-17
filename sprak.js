/* Språk för presentationen. Inga motorvärden, identiteter eller kommandon översätts.
   t kan anropas med en källtext eller som mall: t`Strid ${nummer}`.
   Interpolerade värden sätts in en gång, så att nick med t.ex. {1} bevaras. */
import { texts } from './sprak-en.js';
import { sourceText } from './sprak-sv.js';
import { templates } from './sprak-meddelanden.js';

export const STORAGE_KEY = 'tornstriden-language';
const supported = value => value === 'sv' || value === 'en';
let chosen = null;
const storage = () => typeof window === 'undefined' ? null : window.localStorage;
try { const saved = storage()?.getItem(STORAGE_KEY); if (supported(saved)) chosen = saved; } catch { /* Språkvalet fungerar även utan lagring. */ }
let current = chosen ?? 'sv';
const listeners = new Set();
export const language = () => current;
export const hasLanguageChoice = () => chosen !== null;
export const onLanguageChange = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export function setLanguage(value) {
  if (!supported(value)) return false;
  if (chosen === value && current === value) return true;
  chosen = value;
  current = value;
  try { storage()?.setItem(STORAGE_KEY, value); } catch { /* Behåll valet för denna sidvisning. */ }
  for (const listener of listeners) listener(value);
  return true;
}
const keyOf = (value, values) => Array.isArray(value) ? value.reduce((s, part, i) => s + part + (i < values.length ? `{${i}}` : ''), '') : value;
export function source(value, ...values) {
  return String(keyOf(value, values) ?? '').replace(/\{(\d+)\}/g, (all, index) => index < values.length ? String(values[index]) : all);
}
export function t(value, ...values) {
  if (value == null) return '';
  const key = keyOf(value, values);
  let translated = current === 'en' ? (Object.hasOwn(texts, key) ? texts[key] : sourceText(key)) : sourceText(key);
  if (current === 'en' && values[0] === 1) {
    if (key === '{0} kort') translated = '{0} card';
    if (key === '{0} kort på handen') translated = '{0} card in hand';
    if (key === 'Byt {0} kort') translated = 'Swap {0} card';
  }
  return String(translated).replace(/\{(\d+)\}/g, (all, index) => index < values.length ? String(values[index]) : all);
}
export function cardText(card) {
  if (!card || current === 'sv') return card;
  return { ...card, ...Object.fromEntries(['name', 'label', 'valueLabel', 'when', 'effect'].filter(key => typeof card[key] === 'string').map(key => [key, t(card[key])])) };
}

/* Äldre protokollet skickar textmeddelanden. Endast uttryckliga meddelandemallar
   matchas här, aldrig spelarlistans nick eller annan fritt skriven text.
   Parametrar är oförändrade utom de som mallen markerar som kort/lag/undermeddelanden. */
const escapePattern = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = templates.map(({ key, localize = [] }) => {
  const indices = [];
  const parts = key.split(/(\{\d+\})/).map(part => {
    const match = /^\{(\d+)\}$/.exec(part);
    if (!match) return escapePattern(part);
    indices.push(Number(match[1])); return '([\\s\\S]*?)';
  });
  return { key, localize, indices, pattern: new RegExp('^' + parts.join('') + '$') };
});
export function message(value, depth = 0) {
  if (value == null) return '';
  const text = String(value);
  if (current === 'sv' || depth > 4) return text;
  if (Object.hasOwn(texts, text)) return t(text);
  for (const entry of patterns) {
    const match = entry.pattern.exec(text);
    if (!match) continue;
    const args = [];
    entry.indices.forEach((index, n) => { args[index] = entry.localize.includes(index) ? message(match[n + 1], depth + 1) : match[n + 1]; });
    return t(entry.key, ...args);
  }
  return text;
}
