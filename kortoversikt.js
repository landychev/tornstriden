(() => {
  const cards = window.TORNSTRIDEN_CARDS;
  function render() {
    const onlyEffects = location.hash === '#effektkort';
    document.getElementById('show-all').setAttribute('aria-pressed', String(!onlyEffects));
    document.getElementById('show-effects').setAttribute('aria-pressed', String(onlyEffects));
    document.getElementById('card-catalog').innerHTML = cards.filter(card => !onlyEffects || card.ability).map(card => `
      <article class="playing-card ${card.type}" aria-labelledby="${card.id}-title">
        <div class="top"><span class="kind">${card.label}</span><span class="number">${String(cards.indexOf(card) + 1).padStart(2, '0')} / ${cards.length}</span></div>
        <h2 id="${card.id}-title">${card.name}</h2>
        ${window.TORNSTRIDEN_FX.art(card.overlay)}
        <div class="power"><span class="value">${card.value}</span><span class="power-label">${card.valueLabel}</span></div>
        <dl><dt>När?</dt><dd>${card.when}</dd><dt>Effekt</dt><dd>${card.effect}</dd></dl>
        <footer>${card.isNew ? 'Nytt kortförslag · Ej balansprövat.<br>' : ''}Räknas som ditt kort i striden.<br>Slängs efter striden.</footer>
      </article>`).join('');
  }
  document.getElementById('show-all').addEventListener('click', () => { location.hash = ''; });
  document.getElementById('show-effects').addEventListener('click', () => { location.hash = 'effektkort'; });
  window.addEventListener('hashchange', render);
  render();
})();
