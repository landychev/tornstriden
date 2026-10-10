import { cards } from './kort.js';
import { cardArt } from './grafik.js';

const onlyEffects = () => location.hash === '#effektkort';

function render() {
  document.getElementById('show-all').setAttribute('aria-pressed', String(!onlyEffects()));
  document.getElementById('show-effects').setAttribute('aria-pressed', String(onlyEffects()));
  document.getElementById('card-catalog').innerHTML = cards.filter(card => !onlyEffects() || card.ability).map(card => `
    <article class="playing-card ${card.type}" aria-labelledby="${card.id}-title">
      <div class="top"><span class="kind">${card.label}</span><span class="number">${String(cards.indexOf(card) + 1).padStart(2, '0')} / ${cards.length}</span></div>
      <h2 id="${card.id}-title">${card.name}</h2>
      ${cardArt(card, { lazy: true })}
      <div class="power"><span class="value">${card.value}</span><span class="power-label">${card.valueLabel}</span></div>
      <dl><dt>När?</dt><dd>${card.when}</dd><dt>Effekt</dt><dd>${card.effect}</dd></dl>
      <footer>${card.isNew ? 'Nytt kortförslag · Ej balansprövat.<br>' : ''}Räknas som ditt kort i striden.<br>Slängs efter striden.</footer>
    </article>`).join('');
}

/* replaceState i stället för location.hash: ingen scrollning till toppen och inget kvarlämnat '#'. */
function show(hash) {
  history.replaceState(null, '', location.pathname + location.search + hash);
  render();
}
document.getElementById('show-all').addEventListener('click', () => show(''));
document.getElementById('show-effects').addEventListener('click', () => show('#effektkort'));
window.addEventListener('hashchange', render);
render();
