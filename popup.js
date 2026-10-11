/* Dekor och resultatuppställning; ändrar inte matchens regler eller tillstånd. */
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const icons = new Set(['shield', 'swords', 'cards', 'crown', 'banner', 'tower']);

export function popupIcon(name) {
  return `<svg class="popup-icon" viewBox="0 0 96 96" aria-hidden="true" focusable="false"><use href="assets/popup/emblem.svg#${icons.has(name) ? name : 'shield'}"></use></svg>`;
}

export function resultHeader(kind, title, over) {
  const icon = { held: 'shield', hit: 'tower', victory: 'crown', defeat: 'banner' }[kind];
  return `<header class="popup-result-head"><span class="eyebrow">${over ? 'MATCHEN ÄR AVGJORD' : 'STRIDENS RESULTAT'}</span><h3 id="result-title">${escape(title)}</h3><span class="popup-medallion">${popupIcon(icon)}</span></header>`;
}

export function battleSummary(result) {
  return `<div class="result-score" role="group" aria-label="Stridens slutliga styrkor"><div class="score-side score-attack"><span>Attack</span><strong>${result.attackStrength}</strong><small>${escape(result.attack.name)}</small></div>${popupIcon('swords')}<div class="score-side score-defence"><span>Försvar</span><strong>${result.defenceStrength}</strong><small>${result.defence ? escape(result.defence.name) : 'Inget försvar'}</small></div></div>`;
}
