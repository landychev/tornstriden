(() => {
  'use strict';
  const cards = window.TORNSTRIDEN_CARDS;
  const $ = id => document.getElementById(id);
  let mode = 'attack';
  let selected = null;
  let resolved = false;
  let handSet = 'effects';
  const opponents = { attack: 'skoldmur', defence: 'eldklot' };
  const sampleHand = () => { const start = { original: 0, new: 10, effects: 20 }[handSet]; return cards.slice(start, start + 10); };
  const opponentCard = () => cards.find(card => card.id === opponents[mode]);
  const valid = card => Boolean(card && (mode === 'attack' ? card.attack : card.defence || card.cancel));
  const cardHTML = card => `<span class="mini-kind">${card.label}</span><span class="mini-name">${card.name}</span>${window.TORNSTRIDEN_FX.art(card.overlay)}<span class="mini-value">${card.value}</span><span class="mini-label">${card.valueLabel}</span>`;
  function life(id, count) {
    $(id).setAttribute('aria-label', `${count} av 3 liv`);
    $(id).innerHTML = [0, 1, 2].map(n => `<span aria-hidden="true" class="${n < count ? '' : 'lost'}">${n < count ? '♥' : '♡'}</span>`).join('');
  }
  function slot(id, card, label) {
    $(id).innerHTML = card ? `<div class="mini-card ${card.type}" aria-label="${label}: ${card.name}">${cardHTML(card)}</div>` : `<div class="empty"><span aria-hidden="true">+</span>${label}</div>`;
  }
  function renderSlots() {
    slot('attack-slot', mode === 'attack' ? (valid(selected) ? selected : null) : opponentCard(), mode === 'attack' ? 'Ditt attackkort' : 'Motståndarens attackkort');
    slot('defence-slot', mode === 'defence' ? (valid(selected) ? selected : null) : opponentCard(), mode === 'defence' ? 'Ditt försvarskort' : 'Motståndarens försvarskort');
    $('attack-slot').setAttribute('aria-label', mode === 'attack' ? 'Ditt attackkort' : 'Motståndarens attackkort');
    $('defence-slot').setAttribute('aria-label', mode === 'defence' ? 'Ditt försvarskort' : 'Motståndarens försvarskort');
  }
  function choose(id) {
    if (resolved) return;
    selected = sampleHand().find(card => card.id === id);
    if (!selected) return;
    document.querySelectorAll('#hand button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.card === id)));
    $('selection-info').innerHTML = `<h3>${selected.name}</h3><p>${selected.effect}</p>${valid(selected) ? '' : `<p class="invalid">Det här kortet används vid ${mode === 'attack' ? 'försvar' : 'attack'}. Välj ett annat kort eller byt teststrid.</p>`}`;
    $('resolve').disabled = !valid(selected);
    renderSlots();
  }
  function setup(nextMode = mode) {
    mode = nextMode;
    selected = null;
    resolved = false;
    life('own-life', Number($('own-start-life').value));
    life('enemy-life', Number($('enemy-start-life').value));
    $('enemy-tower').classList.remove('damaged', 'fallen');
    $('own-tower').classList.remove('damaged', 'fallen');
    const hand = sampleHand();
    $('own-count').textContent = `${hand.length} kort på handen`;
    $('enemy-count').textContent = '10 kort på handen';
    $('hand-count').textContent = `${hand.length} kort`;
    for (const key of ['original', 'new', 'effects']) $(`${key}-hand`).setAttribute('aria-pressed', String(handSet === key));
    $('discard-number').textContent = '0';
    $('result').replaceChildren();
    $('turn-label').textContent = 'Din tur att välja kort';
    $('attack-mode').setAttribute('aria-pressed', String(mode === 'attack'));
    $('defence-mode').setAttribute('aria-pressed', String(mode === 'defence'));
    const choices = cards.filter(card => mode === 'attack' ? card.defence || card.cancel : card.attack);
    $('opponent-card').innerHTML = choices.map(card => `<option value="${card.id}">${card.name} · ${card.value}</option>`).join('');
    $('opponent-card').value = opponents[mode];
    $('phase-title').textContent = mode === 'attack' ? 'Ditt anfall' : 'Försvara ditt torn';
    $('phase-description').textContent = `Motståndaren ${mode === 'attack' ? 'försvarar' : 'anfaller'} med ${opponentCard().name}.`;
    $('selection-info').innerHTML = '<h3>Välj ditt kort</h3><p>Tryck på ett kort för att läsa effekten. Kortets siffra visar grundstyrkan; specialeffekten räknas när striden avgörs.</p>';
    $('resolve').disabled = true;
    $('pass').hidden = mode === 'attack';
    $('pass').disabled = false;
    $('hand').innerHTML = hand.map(card => `<button type="button" class="mini-card ${card.type}" data-card="${card.id}" aria-pressed="false" aria-label="${card.name}, ${card.valueLabel} ${card.value}${card.isNew ? ', nytt kortförslag' : ''}">${cardHTML(card)}${card.isNew ? '<span class="new-tag">Nytt förslag</span>' : ''}</button>`).join('');
    renderSlots();
  }
  function resolve(pass = false) {
    if (resolved || (pass && mode !== 'defence') || (!pass && !valid(selected))) return;
    const played = pass ? null : selected;
    const ownStart = Number($('own-start-life').value);
    const enemyStart = Number($('enemy-start-life').value);
    const result = window.TORNSTRIDEN_BATTLE.resolve({
      attacker: mode === 'attack' ? played : opponentCard(),
      defender: mode === 'attack' ? opponentCard() : played,
      attackerLife: mode === 'attack' ? ownStart : enemyStart,
      defenderLife: mode === 'attack' ? enemyStart : ownStart
    });
    resolved = true;
    const ownLife = mode === 'attack' ? result.attackerLife : result.defenderLife;
    const enemyLife = mode === 'attack' ? result.defenderLife : result.attackerLife;
    life('own-life', ownLife);
    life('enemy-life', enemyLife);
    $('own-tower').classList.toggle('damaged', ownLife < ownStart);
    $('enemy-tower').classList.toggle('damaged', enemyLife < enemyStart);
    $('own-tower').classList.toggle('fallen', ownLife === 0);
    $('enemy-tower').classList.toggle('fallen', enemyLife === 0);
    const remaining = ownLife === 0 ? 0 : sampleHand().length - (played ? 1 : 0);
    const enemyRemaining = enemyLife === 0 ? 0 : 9;
    $('own-count').textContent = `${remaining} kort på handen`;
    $('enemy-count').textContent = `${enemyRemaining} kort på handen`;
    $('hand-count').textContent = `${remaining} kort`;
    const discarded = (played ? 2 : 1) + (ownLife === 0 ? sampleHand().length - (played ? 1 : 0) : 0) + (enemyLife === 0 ? 9 : 0);
    $('discard-number').textContent = String(discarded);
    if (ownLife === 0) $('hand').replaceChildren();
    else if (played) document.querySelector(`#hand [data-card="${played.id}"]`).remove();
    document.querySelectorAll('#hand button').forEach(button => { button.disabled = true; button.setAttribute('aria-pressed', 'false'); });
    slot('attack-slot', null, 'Kortet är slängt');
    slot('defence-slot', null, pass ? 'Inget försvar spelades' : 'Kortet är slängt');
    $('resolve').disabled = true;
    $('pass').disabled = true;
    $('turn-label').textContent = 'Teststriden är avslutad';
    $('phase-title').textContent = ownLife === 0 ? 'Ditt torn faller' : enemyLife === 0 ? 'Motståndarens torn faller' : result.defended ? 'Försvaret håller' : 'Tornet träffas';
    $('phase-description').textContent = 'Återställ eller byt teststrid för att prova igen.';
    const fallen = ownLife === 0 || enemyLife === 0 ? ' Det fallna tornets kvarvarande handkort slängs också.' : '';
    $('result').innerHTML = `<h3>${$('phase-title').textContent}</h3><p>Attack ${result.attack} mot försvar ${result.defence}.</p><ul>${result.events.map(event => `<li>${event}</li>`).join('')}</ul><p>Du har ${ownLife} liv. Motståndaren har ${enemyLife} liv. Alla spelade kort slängs.${fallen}</p>`;
    $('selection-info').innerHTML = `<h3>${pass ? (ownLife === 0 ? 'Du avstod från försvar' : 'Du sparade dina kort') : played.name + ' har spelats'}</h3><p>Inga förbrukade kort ersätts. Återställ för en ny fristående teststrid med samma startinställningar.</p>`;
  }
  $('hand').addEventListener('click', event => { const button = event.target.closest('[data-card]'); if (button) choose(button.dataset.card); });
  $('attack-mode').addEventListener('click', () => setup('attack'));
  $('defence-mode').addEventListener('click', () => setup('defence'));
  $('reset').addEventListener('click', () => setup());
  $('resolve').addEventListener('click', () => resolve());
  $('pass').addEventListener('click', () => resolve(true));
  for (const key of ['original', 'new', 'effects']) $(`${key}-hand`).addEventListener('click', () => { handSet = key; setup(); });
  $('opponent-card').addEventListener('change', () => { opponents[mode] = $('opponent-card').value; setup(); });
  for (const id of ['own-start-life', 'enemy-start-life']) $(id).addEventListener('change', () => setup());
  setup();
})();
