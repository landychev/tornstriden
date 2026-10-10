/* Gemensam presentation. Kortens regler och värden kommer fortfarande från kort.js. */
import { cards } from './kort.js';
import { effects } from './bildeffekter.js';

const cardIds = new Set(cards.map(card => card.id));
const effectIds = new Set(effects.map(effect => effect.id));
const escape = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

export function cardArt(card, { simple = false, lazy = false } = {}) {
  if (!cardIds.has(card.id)) return '';
  const effect = !simple && effectIds.has(card.overlay) ? card.overlay : null;
  return `<span class="card-art fx-art"${effect ? ` data-fx="${effect}"` : ''} aria-hidden="true"><img class="fx-subject custom-image" src="assets/kort/${card.id}.jpg" alt="" width="600" height="900" decoding="async"${lazy ? ' loading="lazy"' : ''}>${effect ? `<img class="fx-layer" src="assets/effekter/${effect}.svg" alt="">` : ''}</span>`;
}

export function cardFace(card, { simple = false } = {}) {
  return `${cardArt(card, { simple })}<span class="mini-value">${simple ? '1' : escape(card.value)}</span><span class="mini-name">${escape(card.name)}</span><span class="mini-kind">${simple ? 'Enkel attack' : escape(card.label)}</span><span class="mini-label">${simple ? 'Attack 1 · utan specialeffekt' : escape(card.valueLabel)}</span>`;
}

/* Visuella skador följer verkliga liv, även efter läkning eller en ny match. */
export function towerAppearance(element, life) {
  element.dataset.life = String(life);
}
