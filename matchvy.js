/* Matchvyn: ett matchobjekt från match.js, ett litet visningsläge (ui) och en
   render() som målar allt från spelarvyn. Alla drag – människans och datorns –
   går genom process(); rendera ändrar aldrig matchdata.
   Standardläget är människa (Södra tornet, A) mot datorn (Norra tornet, B).
   Läget "två spelare" visar handen för den som står på tur.
   Presentation: ett valt kort dras upp till sin ruta på stridsplatsen (sidan
   scrollar med), knapparna för anfall/försvar ligger på stridsplatsen, bortbytta
   kort flyger till draghögen och stridsresultatet visas i en dialogruta. */
import { MAX_LIFE } from './kort.js';
import { USAGE, canAttack, canDefend } from './matchregler.js';
import { art } from './bildeffekter.js';
import { newMatch, process, playerView, allowedActions, cardType, PHASE, ACTION, STATUS, END } from './match.js';
import { decide, packAction, DecisionError, STRATEGIES, STRATEGY } from './dator.js';

const $ = id => document.getElementById(id);
const HEART = '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 20.6S3.4 15.3 3.4 9.4A4.6 4.6 0 0 1 12 6.9a4.6 4.6 0 0 1 8.6 2.5c0 5.9-8.6 11.2-8.6 11.2z"/></svg>';
const html = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const HUMAN = 'A';
const COMPUTER = 'B';
const THINK_MS = 600;            // presentationspaus innan datorn spelar
const FLY_MS = 520;              // ett kort flyger mellan hand, stridsplats och högar
const DECISION_PHASES = [PHASE.swap, PHASE.attack, PHASE.defence];
const PLAY_PHASES = [PHASE.attack, PHASE.defence];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

let match = newMatch();
const ui = {
  mode: 'computer',     // 'computer' | 'hotseat'
  strategy: STRATEGIES.smart,
  viewer: HUMAN,        // vems hand som visas
  selected: [],         // markerade exemplar-ID (högst två vid kortbyte, ett annars)
  usage: USAGE.normal,  // NORMAL eller ENKEL_ATTACK vid anfall
  confirm: null,        // 'new' | 'surrender' – en öppen fråga i gränssnittet
  notice: null,         // { text, kind }
  focus: null,          // element-ID som ska få fokus efter nästa render
  thinking: false,      // datorn väntar på att spela
  decisionError: null,  // { matchId, revision, reason } – datorn kunde inte välja
  computerLog: []       // datorns beslut och skäl (visas i utvecklingsläget)
};
let pendingJob = null;  // högst ett väntande datorjobb
let flying = Promise.resolve();  // senaste kortflygningen; resultatrutan väntar in den

/* ---- Härledningar ---- */
const view = () => playerView(match, ui.viewer);
const nameOf = id => match.players.find(p => p.id === id).name;
const opponentOf = id => id === 'A' ? 'B' : 'A';
const isComputer = id => ui.mode === 'computer' && id === COMPUTER;
const cardInHand = instanceId => view().me.hand.find(c => c.instanceId === instanceId);
const typeOf = instanceId => cardType(match.instances[instanceId]);
const selectedOne = () => ui.selected.length === 1 ? cardInHand(ui.selected[0]) : null;
const usableNow = type => {
  if (match.phase === PHASE.swap) return true;
  if (match.phase === PHASE.attack) return canAttack(type, ui.usage);
  if (match.phase === PHASE.defence) return canDefend(type);
  return false;
};
const myTurn = () => match.activePlayer === ui.viewer;
const stateKey = () => `${match.id}|${match.revision}|${match.phase}|${match.activePlayer}`;

/* ---- Små ritfunktioner ---- */
const cardHTML = type => `<span class="mini-kind">${type.label}</span><span class="mini-name">${type.name}</span>${art(type.overlay)}<span class="mini-value">${type.value}</span><span class="mini-label">${type.valueLabel}</span>`;
const simpleHTML = type => `<span class="mini-kind">Enkel attack</span><span class="mini-name">${type.name}</span><span class="mini-value">1</span><span class="mini-label">Attack 1 · utan specialeffekt</span>`;
const button = (action, label, { kind = 'primary', disabled = false, id = '' } = {}) => `<button type="button" class="${kind}"${id ? ` id="${id}"` : ''} data-action="${action}" data-revision="${match.revision}"${disabled ? ' disabled' : ''}>${label}</button>`;

function hearts(id, count, previous = count) {
  $(id).setAttribute('aria-label', `${count} av ${MAX_LIFE} liv`);
  $(id).innerHTML = Array.from({ length: MAX_LIFE }, (_, n) => `<span aria-hidden="true" class="${n < count ? '' : 'lost'}${n >= count && n < previous ? ' just-lost' : ''}">${HEART}</span>`).join('');
}

function slot(id, content, label, extraClass = '') {
  $(id).setAttribute('aria-label', label);
  $(id).innerHTML = content ? `<div class="mini-card ${content.type}${extraClass ? ` ${extraClass}` : ''}" aria-label="${label}: ${html(content.name)}">${content.simple ? simpleHTML(content) : cardHTML(content)}</div>` : `<div class="empty"><span aria-hidden="true">+</span>${label}</div>`;
}

/* ---- Kortflygningar: en kopia animeras i dokumentets koordinater, matchdata rörs inte ---- */
const docRect = el => { const r = el.getBoundingClientRect(); return { left: r.left + scrollX, top: r.top + scrollY, width: r.width, height: r.height }; };

/* Lägger en kopia av `template` i dokumentet och låter den glida från `from` till `to`.
   Kopian sätts i sin naturliga storlek (`layout`: 'to' för kort som landar i en ruta,
   'from' för kort som lämnar handen) och skalas till den andra änden. */
function flyGhost(template, from, to, { delay = 0, fade = false, layout = 'to' } = {}) {
  if (reduceMotion.matches || !from?.width || !to?.width) return Promise.resolve();
  const base = layout === 'from' ? from : to;
  const at = r => `translate(${r.left - base.left}px, ${r.top - base.top}px) scale(${r.width / base.width}, ${r.height / base.height})`;
  const ghost = template.cloneNode(true);
  ghost.classList.add('fly-card');
  ghost.classList.remove('dealt');
  ghost.removeAttribute('id');
  ghost.removeAttribute('aria-pressed');
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, { left: `${base.left}px`, top: `${base.top}px`, width: `${base.width}px`, height: `${base.height}px`, visibility: 'visible' });
  document.body.append(ghost);
  const frames = [{ transform: at(from), opacity: 1 }, { transform: at(to), opacity: fade ? 0 : 1 }];
  // Kort som landar bromsar in; kort som lämnar handen lyfter mjukt och drar sedan iväg.
  const leaving = layout === 'from';
  const animation = ghost.animate(frames, { duration: leaving ? FLY_MS + 220 : FLY_MS, delay, easing: leaving ? 'cubic-bezier(.45, 0, .85, .45)' : 'cubic-bezier(.2, .7, .2, 1)', fill: 'forwards' });
  return animation.finished.catch(() => {}).then(() => ghost.remove());
}

/* Kortet i rutan `slotId` flyger in från rektangeln `from`; rutans eget kort döljs under tiden. */
function flyIntoSlot(slotId, from) {
  const target = $(slotId).querySelector('.mini-card');
  if (!target || !from?.width) return;
  target.style.visibility = 'hidden';
  flying = flyGhost(target, from, docRect(target)).then(() => { target.style.visibility = ''; });
}

/* Kameran följer med: scrolla upp så att stridsplatsen syns om den ligger ovanför synfältet. */
function scrollToBattle() {
  const top = Math.max(0, $('battle').getBoundingClientRect().top + scrollY - 12);
  if (top < scrollY) window.scrollTo({ top, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
}

/* Dit bortbytta kort flyger: draghögen, eller stridsplatsens mitt när högarna är dolda (smal skärm). */
function pileRect() {
  const pile = docRect($('draw-number'));
  if (pile.width) return pile;
  const battle = docRect($('battle'));
  return { left: battle.left + battle.width / 2 - 20, top: battle.top + 24, width: 40, height: 56 };
}

function tower(id) {
  const p = match.players.find(q => q.id === id);
  const r = match.lastResult;
  const shown = [PHASE.result, PHASE.over].includes(match.phase) && r;
  const el = $(`tower-${id}`);
  el.classList.toggle('damaged', p.life < MAX_LIFE && p.life > 0);
  el.classList.toggle('fallen', p.life === 0);
  el.classList.toggle('held', Boolean(shown && r.defender === id && r.defended));
  el.classList.toggle('hit', Boolean(shown && r.life[id] < r.startLife[id]));
  hearts(`life-${id}`, p.life, shown ? r.startLife[id] : p.life);
  $(`count-${id}`).textContent = p.life === 0 ? 'Tornet har fallit' : `${p.hand.length} kort på handen`;
}

/* ---- Text för faserna ---- */
function phaseText() {
  const v = view();
  const active = match.activePlayer ? nameOf(match.activePlayer) : '';
  const waiting = ui.thinking ? ' Datorn väljer kort…' : '';
  switch (match.phase) {
    case PHASE.swap: return { title: `Startbyten – omgång ${match.swapRound} av ${match.rules.swapRounds}`, text: ui.thinking ? 'Datorn väljer sina byten…' : `${active}: markera 0–${match.rules.maxCardsPerSwap} kort att byta och bekräfta. Undanlagda kort blandas tillbaka först när bytena är klara.` };
    case PHASE.attack: return { title: `${active} anfaller`, text: ui.thinking ? `Strid ${match.battleNumber}.${waiting}` : `Strid ${match.battleNumber}. Välj ett kort ur handen. Vilket kort som helst kan spelas som enkel attack 1.` };
    case PHASE.defence: { const a = v.battle.attack; const type = cardType(a.cardId); return { title: `${active} försvarar`, text: `${nameOf(v.battle.attacker)} anfaller med ${a.usage === USAGE.simple ? `${type.name} som enkel attack 1` : `${type.name} (${type.value})`}.${ui.thinking ? waiting : ' Välj ett försvarskort eller avstå.'}` }; }
    case PHASE.result: { const r = match.lastResult; return { title: r.defended ? 'Försvaret håller' : `${nameOf(r.defender)} träffas`, text: `Attack ${r.attackStrength} mot försvar ${r.defenceStrength}. Läs resultatet och tryck Fortsätt.` }; }
    case PHASE.over: return { title: `${nameOf(match.winner)} vinner`, text: match.endReason === END.surrendered ? `${nameOf(opponentOf(match.winner))} gav upp matchen.` : `${nameOf(opponentOf(match.winner))} har fallit efter ${match.battleNumber} strider.` };
    case PHASE.error: return { title: 'Matchen har stoppats', text: `Regel- eller bokföringsfel: ${match.error}. Starta en ny match.` };
    default: return { title: '', text: '' };
  }
}

/* ---- Handen byggs om bara när dess exemplar, fas eller användning ändras.
   Exemplar som inte visats förut delas ut med en liten animation. ---- */
let handKey = null;
let shownIds = new Set();
function renderHand() {
  const v = view();
  const key = `${ui.viewer}|${v.me.hand.map(c => c.instanceId).join(',')}|${match.phase}|${ui.usage}|${match.activePlayer}`;
  if (key !== handKey) {
    handKey = key;
    let dealt = 0;
    $('hand').innerHTML = v.me.hand.map(({ instanceId, cardId }) => {
      const type = cardType(cardId);
      const usable = myTurn() && usableNow(type);
      const why = !myTurn() ? '' : match.phase === PHASE.attack ? ', kan spelas som enkel attack 1' : match.phase === PHASE.defence ? ', används vid attack' : '';
      const fresh = !shownIds.has(instanceId);
      return `<button type="button" class="mini-card ${type.type}${usable ? '' : ' unusable'}${fresh ? ' dealt' : ''}"${fresh ? ` style="animation-delay:${dealt++ * 45}ms"` : ''} data-instance="${instanceId}" aria-pressed="false"${usable ? '' : ' aria-disabled="true"'} aria-label="${html(type.name)}, ${html(type.valueLabel)} ${html(type.value)}${usable ? '' : why}">${cardHTML(type)}<span class="swap-mark" hidden>Byts</span></button>`;
    }).join('');
    shownIds = new Set(v.me.hand.map(c => c.instanceId));
  }
  $('hand').classList.toggle('placing', myTurn() && PLAY_PHASES.includes(match.phase));
  const interactive = myTurn() && DECISION_PHASES.includes(match.phase);
  for (const el of $('hand').querySelectorAll('button')) {
    const chosen = ui.selected.includes(el.dataset.instance);
    el.setAttribute('aria-pressed', String(chosen));
    el.disabled = !interactive;
    el.querySelector('.swap-mark').hidden = !(chosen && match.phase === PHASE.swap);
  }
}

function renderActions() {
  const allowed = allowedActions(match, ui.viewer).map(a => a.type);
  const pick = selectedOne();
  const type = pick ? cardType(pick.cardId) : null;
  let info = '';
  let actions = '';
  let where = 'battle';   // knapparna ligger på stridsplatsen – utom bytesknappen, som ligger vid handen

  if (ui.confirm === 'surrender') {
    actions = `<div class="confirm-panel"><p>Vill du ge upp matchen för ${nameOf(ui.viewer)}? ${nameOf(opponentOf(ui.viewer))} vinner då direkt.</p>${button('confirm-surrender', 'Ja, ge upp')}${button('cancel', 'Avbryt', { kind: 'secondary' })}</div>`;
    info = '<h3>Ge upp?</h3><p>Liv och kort ändras inte. Att bara stänga frågan ändrar ingenting.</p>';
  } else if (ui.confirm === 'new') {
    actions = `<div class="confirm-panel"><p>Vill du kasta den pågående matchen och starta en ny? Inget resultat sparas.</p>${button('confirm-new', 'Ja, ny match')}${button('cancel', 'Avbryt', { kind: 'secondary' })}</div>`;
    info = '<h3>Ny match?</h3><p>Den nya matchen får en helt ny utdelning.</p>';
  } else if (ui.decisionError) {
    info = `<h3>Datorn kunde inte välja ett drag</h3><p>${html(ui.decisionError.reason)} Matchen är oförändrad: inga kort, liv eller faser har ändrats.</p>`;
    actions = button('retry', 'Försök igen', { kind: 'secondary', id: 'retry-computer' }) + button('new', 'Ny match', { id: 'confirm-new-match' });
  } else if (ui.thinking) {
    info = `<h3 class="thinking">Motståndaren väljer kort</h3><p>${nameOf(match.activePlayer)} spelar enligt samma regler som du. Du kan läsa dina kort under tiden.</p>`;
  } else if (match.phase === PHASE.swap && allowed.includes(ACTION.swap)) {
    where = 'hand';
    const n = ui.selected.length;
    info = `<h3>${n === 0 ? 'Behåll handen eller markera kort att byta' : `${n} av ${match.rules.maxCardsPerSwap} kort markerade`}</h3><p>Omgång ${match.swapRound} av ${match.rules.swapRounds}. ${type ? html(type.effect) : 'Tryck på ett kort för att markera det; tryck igen för att ångra.'}</p>`;
    actions = button('swap', n === 0 ? 'Behåll handen' : `Byt ${n} kort`, { id: 'confirm-swap' });
  } else if (match.phase === PHASE.attack && allowed.includes(ACTION.attack)) {
    const ok = type && canAttack(type, ui.usage);
    const hint = type && !ok ? `<p class="invalid">${html(type.name)} har ingen attackstyrka. Välj ”Enkel attack 1” för att anfalla med kortet ändå.</p>` : '';
    info = type ? `<h3>${html(type.name)}</h3><p>${ui.usage === USAGE.simple ? 'Spelas som enkel attack 1: vanlig attack utan specialeffekt och utan magisk typ.' : html(type.effect)}</p>${hint}` : '<h3>Välj ditt attackkort</h3><p>Tryck på ett kort för att läsa effekten. Kortets siffra visar grundstyrkan; specialeffekten räknas när striden avgörs.</p>';
    actions = button('attack', ok ? `Anfall med ${html(type.name)}${ui.usage === USAGE.simple ? ' (attack 1)' : ''}` : 'Anfall', { disabled: !ok, id: 'confirm-attack' });
  } else if (match.phase === PHASE.defence && allowed.includes(ACTION.defend)) {
    const ok = type && canDefend(type);
    const hint = type && !ok ? `<p class="invalid">${html(type.name)} kan inte användas som försvar. Välj ett annat kort eller avstå.</p>` : '';
    info = type ? `<h3>${html(type.name)}</h3><p>${html(type.effect)}</p>${hint}` : '<h3>Välj ditt försvarskort</h3><p>Lika hög eller högre försvarsstyrka stoppar attacken. Att avstå sparar hela handen men kostar ett liv om attacken går igenom.</p>';
    actions = button('pass', 'Avstå försvar', { kind: 'secondary', id: 'confirm-pass' }) + button('defend', ok ? `Försvara med ${html(type.name)}` : 'Försvara', { disabled: !ok, id: 'confirm-defend' });
  } else if (match.phase === PHASE.result) {
    info = `<h3>Strid ${match.lastResult.battleNumber} är avgjord</h3><p>Spelade kort ligger i slänghögen. Nästa anfallare: ${nameOf(opponentOf(match.lastResult.attacker))}.${match.players.some(p => p.life > 0 && !p.hand.length) ? ' En tom hand får upp till fem nya kort.' : ''}</p>`;
    actions = button('next', 'Fortsätt <span aria-hidden="true">→</span>', { id: 'confirm-next' });
  } else if (match.phase === PHASE.over) {
    const youWon = ui.mode === 'computer' && match.winner === HUMAN;
    info = `<h3>${youWon ? 'Du vinner matchen' : `${nameOf(match.winner)} vinner matchen`}</h3><p>${match.endReason === END.surrendered ? 'Matchen avslutades genom att motståndaren gav upp.' : 'Motståndarens torn har fallit.'} Ingen påfyllning eller ny tur efter avslut.</p>`;
    actions = button('new', 'Spela igen', { id: 'confirm-new-match' });
  } else if (match.phase === PHASE.error) {
    info = `<h3>Matchen har stoppats</h3><p>${html(match.error)}</p>`;
    actions = button('new', 'Ny match', { id: 'confirm-new-match' });
  } else {
    info = `<h3>${nameOf(match.activePlayer ?? ui.viewer)} står på tur</h3><p>Vänta på motståndarens drag.</p>`;
  }
  const onBattle = where === 'battle';
  $('selection-info').innerHTML = onBattle ? info : '';
  $('actions').innerHTML = onBattle ? actions : '';
  $('battle-actions').hidden = !onBattle;
  $('hand-info').innerHTML = onBattle ? '' : info;
  $('hand-actions').innerHTML = onBattle ? '' : actions;
  $('hand-bar').hidden = onBattle;
  $('surrender').disabled = !allowed.includes(ACTION.surrender) || Boolean(ui.confirm) || Boolean(ui.decisionError);
  $('new-match').disabled = Boolean(ui.confirm);
}

/* ---- Stridsresultatet visas i en dialogruta. Den öppnas en gång per avgjord strid
   (och vid matchslut), efter att eventuell kortflygning landat, och stängs när
   matchen går vidare. Stängs den med Escape finns Fortsätt kvar på stridsplatsen. ---- */
let resultKey = null;
function renderResult() {
  const r = match.lastResult;
  const dialog = $('result-dialog');
  const over = match.phase === PHASE.over;
  if (!over && !(match.phase === PHASE.result && r)) {
    resultKey = null;
    if (dialog.open) dialog.close();
    return;
  }
  const lines = [];
  if (r && (!over || match.endReason === END.fallen)) {
    const fallen = match.players.filter(p => p.life === 0);
    lines.push(`<p>${html(r.attack.name)} (${r.attackStrength}) mot ${r.defence ? `${html(r.defence.name)} (${r.defenceStrength})` : 'inget försvar'}.</p>`, `<ul>${r.events.map(e => `<li>${html(e)}</li>`).join('')}</ul>`, `<p>${nameOf('A')} har ${r.life.A} liv. ${nameOf('B')} har ${r.life.B} liv. Alla spelade kort slängs.${fallen.length ? ' Det fallna tornets kvarvarande handkort slängs också.' : ''}</p>`);
  } else if (over) {
    lines.push(`<p>${nameOf(opponentOf(match.winner))} gav upp matchen.</p>`);
  }
  if (over) lines.push(`<p class="winner"><strong>${ui.mode === 'computer' && match.winner === HUMAN ? 'Du vinner matchen.' : `${nameOf(match.winner)} vinner matchen.`}</strong></p>`);
  $('result').innerHTML = `<h3 id="result-title">${phaseText().title}</h3>${lines.join('')}`;
  $('dialog-actions').innerHTML = over ? button('new', 'Spela igen', { id: 'dialog-new' }) : button('next', 'Fortsätt <span aria-hidden="true">→</span>', { id: 'dialog-next' });
  const key = `${match.id}|${match.revision}|${match.phase}`;
  if (key === resultKey) return;
  resultKey = key;
  // Vänta ett varv: en flygning som startas direkt efter render() ska hinna registreras i `flying`.
  setTimeout(() => flying.then(() => { if (resultKey === key && !dialog.open) dialog.showModal(); }), 0);
}

function renderDev() {
  const other = match.players.find(p => p.id !== ui.viewer);
  const show = $('show-both').checked;
  $('other-hand').innerHTML = show ? `<p><strong>${nameOf(other.id)}</strong> (${other.hand.length} kort):</p><ul>${other.hand.map(i => `<li>${html(cardType(match.instances[i]).name)}</li>`).join('') || '<li>Tom hand</li>'}</ul>` : '';
  $('computer-log').innerHTML = ui.computerLog.map(line => `<li>${html(line)}</li>`).join('') || '<li>Inga datorbeslut ännu.</li>';
  $('dev-state').textContent = `match ${match.id} · revision ${match.revision} · fas ${match.phase} · aktiv ${match.activePlayer ?? '–'} · strid ${match.battleNumber} · läge ${ui.mode} · strategi ${ui.strategy} (${STRATEGY.version})`;
}

function render() {
  if (ui.mode === 'computer') ui.viewer = HUMAN;
  else if (match.activePlayer) ui.viewer = match.activePlayer;
  const v = view();
  const { title, text } = phaseText();

  // Torn, liv, högar
  tower('A'); tower('B');
  $('label-B').textContent = ui.mode === 'computer' ? 'DATORN' : 'SPELARE B';
  $('hidden-B').classList.toggle('empty', !match.players[1].hand.length);
  $('draw-number').textContent = String(v.drawPileSize);
  $('discard-number').textContent = String(v.discardPile.length);
  $('turn-label').textContent = match.activePlayer ? `${nameOf(match.activePlayer)} står på tur` : match.phase === PHASE.over ? 'Matchen är avslutad' : match.phase === PHASE.result ? 'Tryck Fortsätt för nästa strid' : '';
  $('match-label').textContent = `Regler ${match.rulesVersion} · Kortlek ${match.deckVersion} · Strid ${match.battleNumber}`;
  $('mode').value = ui.mode;
  $('strategy').value = ui.strategy;

  // Stridsplatsen
  $('phase-title').textContent = title;
  $('phase-description').textContent = text;
  const r = match.lastResult;
  if ([PHASE.result, PHASE.over].includes(match.phase) && r) {
    const a = cardType(r.attack.cardId);
    slot('attack-slot', r.attack.usage === USAGE.simple ? { ...a, simple: true, name: r.attack.name } : a, `${nameOf(r.attacker)}s attack`);
    slot('defence-slot', r.defence ? cardType(r.defence.cardId) : null, r.defence ? `${nameOf(r.defender)}s försvar` : 'Inget försvar spelades');
  } else if (match.battle?.attackInstance) {
    const a = typeOf(match.battle.attackInstance);
    slot('attack-slot', match.battle.attackUsage === USAGE.simple ? { ...a, simple: true } : a, `${nameOf(match.battle.attacker)}s attack`);
    // Det valda kortet läggs i rutan även om det (ännu) inte duger som försvar; då visas det nedtonat med en förklaring i knappraden.
    const pick = myTurn() && match.phase === PHASE.defence ? selectedOne() : null;
    const type = pick ? cardType(pick.cardId) : null;
    slot('defence-slot', type, ui.thinking ? 'Datorn väljer försvar' : 'Försvarskort', type && !canDefend(type) ? 'not-usable' : '');
  } else {
    const pick = myTurn() && match.phase === PHASE.attack ? selectedOne() : null;
    const type = pick ? cardType(pick.cardId) : null;
    slot('attack-slot', type ? (ui.usage === USAGE.simple ? { ...type, simple: true } : type) : null, ui.thinking && match.phase === PHASE.attack ? 'Datorn väljer anfall' : 'Attackkort', type && !canAttack(type, ui.usage) ? 'not-usable' : '');
    slot('defence-slot', null, 'Försvarskort');
  }

  // Handen
  $('hand-owner').textContent = ui.mode === 'computer' ? 'DINA KORT · SÖDRA TORNET' : `${nameOf(ui.viewer).toUpperCase()}S KORT`;
  $('hand-heading').textContent = !myTurn() && DECISION_PHASES.includes(match.phase) ? 'Motståndarens tur' : match.phase === PHASE.swap ? 'Välj kort att byta' : match.phase === PHASE.attack ? 'Välj ditt anfall' : match.phase === PHASE.defence ? 'Försvara ditt torn' : match.phase === PHASE.result ? 'Kvarvarande kort' : 'Matchen är slut';
  $('hand-count').textContent = `${v.me.hand.length} kort`;
  $('usage').hidden = !(match.phase === PHASE.attack && myTurn());
  $('usage-normal').setAttribute('aria-pressed', String(ui.usage === USAGE.normal));
  $('usage-simple').setAttribute('aria-pressed', String(ui.usage === USAGE.simple));
  renderHand();
  renderActions();
  renderResult();
  renderDev();

  // Meddelanden och fokus
  $('notice').textContent = ui.notice?.text ?? '';
  $('notice').className = `notice${ui.notice?.kind === 'info' ? ' info' : ''}`;
  if (ui.focus) {
    const target = ui.focus === 'actions' ? $('actions').querySelector('button') ?? $('hand-actions').querySelector('button') : $(ui.focus);
    target?.focus({ preventScroll: true });
    ui.focus = null;
  }
}

/* ---- Datorns tur: en kort, avbrytbar paus och högst ett väntande jobb ---- */
function cancelComputerJob() {
  if (pendingJob) clearTimeout(pendingJob.timer);
  pendingJob = null;
  ui.thinking = false;
}

/* Anropas efter matchstart och varje godkänd handling – aldrig från render(). */
function syncComputerTurn() {
  const key = stateKey();
  if (ui.decisionError) {
    if (ui.decisionError.matchId === match.id && ui.decisionError.revision === match.revision) return;
    ui.decisionError = null;
  }
  if (pendingJob?.key === key) return;
  cancelComputerJob();
  if (!DECISION_PHASES.includes(match.phase) || !isComputer(match.activePlayer)) return;
  const job = { key, timer: null };
  pendingJob = job;
  ui.thinking = true;
  job.timer = setTimeout(() => runComputerJob(job), THINK_MS);
}

function runComputerJob(job) {
  if (pendingJob !== job) return;
  if (stateKey() !== job.key) { pendingJob = null; ui.thinking = false; render(); return; }
  const computerView = playerView(match, COMPUTER);
  let decision;
  try {
    decision = decide(computerView, { strategy: ui.strategy, random: Math.random });
    if (!decision) throw new DecisionError('Beslutsfunktionen gav inget drag.');
  } catch (error) {
    pauseComputer(computerView, error instanceof DecisionError ? error.message : `Oväntat fel i beslutsfunktionen: ${error.message}`);
    return;
  }
  pendingJob = null;
  ui.thinking = false;
  ui.computerLog.push(`Strid ${match.battleNumber}, ${match.phase}: ${decision.reason}`);
  const type = decision.choice.type;
  const reply = send(type, packAction(decision.choice, computerView), { fromComputer: true });
  if (reply.status === STATUS.rejected && match.id === computerView.matchId && match.revision === computerView.revision) pauseComputer(computerView, reply.message);
  // Datorns kort flyger in från dess dolda hand till rutan (bara när den dolda handen syns).
  if (reply.status === STATUS.ok && (type === ACTION.attack || type === ACTION.defend)) {
    const back = $('hidden-B').lastElementChild;
    if (back) flyIntoSlot(type === ACTION.attack ? 'attack-slot' : 'defence-slot', docRect(back));
  }
}

function pauseComputer(computerView, reason) {
  pendingJob = null;
  ui.thinking = false;
  ui.decisionError = { matchId: computerView.matchId, revision: computerView.revision, reason };
  ui.computerLog.push(`Strid ${match.battleNumber}, ${match.phase}: beslutsfel – ${reason}`);
  ui.focus = 'actions';
  render();
}

function retryComputer() {
  const error = ui.decisionError;
  if (!error || error.matchId !== match.id || error.revision !== match.revision) return;
  if (!DECISION_PHASES.includes(match.phase) || !isComputer(match.activePlayer)) return;
  ui.decisionError = null;
  syncComputerTurn();
  render();
}

/* ---- Handlingar: gränssnittet skickar, process() avgör ---- */
function send(type, extra = {}, { fromComputer = false } = {}) {
  const reply = process(match, { matchId: match.id, revision: match.revision, type, ...extra });
  if (reply.status === STATUS.rejected) {
    if (!fromComputer) ui.notice = { text: reply.message, kind: 'error' };
  } else {
    match = reply.match;
    ui.selected = [];
    ui.usage = USAGE.normal;
    ui.confirm = null;
    ui.notice = null;
    if (reply.status === STATUS.error) {
      cancelComputerJob();
      ui.decisionError = null;
      ui.notice = { text: `Internt fel: ${reply.message}`, kind: 'error' };
    } else {
      syncComputerTurn();
    }
    // Resultatrutan tar själv fokus när den öppnas (renderResult).
    if (![PHASE.result, PHASE.over].includes(match.phase) && (type === ACTION.next || type === ACTION.swap || fromComputer)) ui.focus = 'phase-title';
  }
  render();
  return reply;
}

function startNewMatch() {
  cancelComputerJob();
  match = newMatch();
  Object.assign(ui, { viewer: HUMAN, selected: [], usage: USAGE.normal, confirm: null, decisionError: null, computerLog: [], notice: { text: 'Ny match: ny utdelning och tre liv var. Matchen sparas inte vid omladdning.', kind: 'info' }, focus: 'phase-title' });
  handKey = null;
  shownIds = new Set();   // hela handen delas ut på nytt
  syncComputerTurn();
  render();
}

/* Markera ett kort. Vid anfall och försvar dras kortet upp till sin ruta på
   stridsplatsen och sidan scrollar med så att man ser det landa. */
function choose(instanceId) {
  if (!myTurn() || !cardInHand(instanceId)) return;
  ui.notice = null;
  if (match.phase === PHASE.swap) {
    if (ui.selected.includes(instanceId)) ui.selected = ui.selected.filter(id => id !== instanceId);
    else if (ui.selected.length >= match.rules.maxCardsPerSwap) ui.notice = { text: `Högst ${match.rules.maxCardsPerSwap} kort per bytesomgång. Avmarkera ett kort först.`, kind: 'error' };
    else ui.selected = [...ui.selected, instanceId];
    render();
  } else if (PLAY_PHASES.includes(match.phase)) {
    const picked = ui.selected[0] !== instanceId;
    ui.selected = picked ? [instanceId] : [];
    const source = picked ? $('hand').querySelector(`[data-instance="${instanceId}"]`) : null;
    const from = source ? docRect(source) : null;
    render();
    if (!picked) return;
    flyIntoSlot(match.phase === PHASE.attack ? 'attack-slot' : 'defence-slot', from);
    scrollToBattle();
  }
}

/* Bekräfta bytet: de markerade korten flyger till draghögen och de nya delas ut i handen. */
function swapCards() {
  const marked = [...$('hand').querySelectorAll('[aria-pressed="true"]')].map(el => [el, docRect(el)]);
  const reply = send(ACTION.swap, { playerId: ui.viewer, cards: [...ui.selected] });
  if (reply.status !== STATUS.ok) return;
  const pile = pileRect();
  marked.forEach(([el, from], i) => {
    // Krymp med bibehållna proportioner in mot högens mitt.
    const height = pile.width * from.height / from.width;
    const to = { left: pile.left, top: pile.top + (pile.height - height) / 2, width: pile.width, height };
    flyGhost(el, from, to, { delay: i * 70, fade: true, layout: 'from' });
  });
}

function setMode(mode) {
  if (mode === ui.mode) return;
  ui.mode = mode;
  cancelComputerJob();
  ui.decisionError = null;
  ui.selected = [];
  ui.confirm = null;
  handKey = null;
  syncComputerTurn();
  render();
}

const actionHandlers = {
  swap: swapCards,
  attack: () => send(ACTION.attack, { playerId: ui.viewer, card: ui.selected[0], usage: ui.usage }),
  defend: () => send(ACTION.defend, { playerId: ui.viewer, card: ui.selected[0] }),
  pass: () => send(ACTION.pass, { playerId: ui.viewer }),
  next: () => send(ACTION.next),
  new: () => startNewMatch(),
  'confirm-new': () => startNewMatch(),
  'confirm-surrender': () => send(ACTION.surrender, { playerId: ui.viewer }),
  retry: () => retryComputer(),
  cancel: () => { ui.confirm = null; render(); }
};

$('hand').addEventListener('click', event => { const el = event.target.closest('[data-instance]'); if (el && !el.disabled) choose(el.dataset.instance); });
/* Knapparna finns på tre ställen: stridsplatsen, handens bytesrad och resultatrutan. */
function onAction(event) {
  const el = event.target.closest('[data-action]');
  if (!el || el.disabled) return;
  if (el.dataset.revision !== String(match.revision)) { ui.notice = { text: 'Matchläget har ändrats – försök igen.', kind: 'error' }; render(); return; }
  el.disabled = true;   // spärr mot dubbelklick tills handlingen behandlats
  actionHandlers[el.dataset.action]?.();
}
for (const id of ['actions', 'hand-actions', 'dialog-actions']) $(id).addEventListener('click', onAction);
$('usage-normal').addEventListener('click', () => { ui.usage = USAGE.normal; render(); });
$('usage-simple').addEventListener('click', () => { ui.usage = USAGE.simple; render(); });
$('surrender').addEventListener('click', () => { if (!$('surrender').disabled) { ui.confirm = 'surrender'; ui.focus = 'actions'; render(); } });
$('new-match').addEventListener('click', () => { if ([PHASE.over, PHASE.error].includes(match.phase)) startNewMatch(); else { ui.confirm = 'new'; ui.focus = 'actions'; render(); } });
$('mode').addEventListener('change', () => setMode($('mode').value));
$('strategy').addEventListener('change', () => { ui.strategy = $('strategy').value === STRATEGIES.random ? STRATEGIES.random : STRATEGIES.smart; render(); });
$('show-both').addEventListener('change', renderDev);
window.addEventListener('beforeunload', event => { if (![PHASE.over, PHASE.error].includes(match.phase) && match.revision > 0) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', cancelComputerJob);
syncComputerTurn();
render();
