/* Matchvyn: en adapter (lokalmatch.js i dag, onlinematch i L09), ett litet visningsläge (ui)
   och en render() som målar allt från adapterns privata spelarvy. Vyn ser aldrig matchobjektet,
   motståndarens hand eller `instances`: den får en vy, tillåtna val och typade händelser, och
   skickar kommandon enligt kontrakt.js. Alla drag – människans och datorns – går via adaptern.
   Standardläget är människa (Södra tornet, A) mot datorn (Norra tornet, B).
   Läget "två spelare" visar handen för den som står på tur.
   Presentation: ett valt kort dras upp till sin ruta på stridsplatsen,
   knapparna för anfall/försvar ligger på stridsplatsen, bortbytta
   kort flyger till draghögen och stridsresultatet visas i en dialogruta.
   Ett långt tryck på ett kort (hand eller stridsplats) öppnar kortet förstorat (kortlupp.js, delas med lagvyn). */
import { MAX_LIFE } from './kort.js';
import { USAGE } from './matchregler.js';
import { cardFace, towerAppearance } from './grafik.js';
import { popupIcon, resultHeader, battleSummary } from './popup.js';
import { cardType, PHASE, ACTION, END } from './match.js';
import { DecisionError, STRATEGIES, STRATEGY } from './dator.js';
import { GameAudio, bindAudioControls, resultEffect } from './ljud.js';
import { skapaLokalMatch, EVENT } from './lokalmatch.js';
import { skapaOnlineMatch, PENDING } from './onlinematch.js';
import { PROTOCOL_VERSION, RECEIPT, MATCH_COMMAND } from './kontrakt.js';
import { docRect, styledCardCopy, flyGhost, kopplaKortlupp, reduceMotion } from './kortlupp.js';
import { kopplaNedrakning, klockrad } from './nedrakning.js';

const sound = new GameAudio();
bindAudioControls(sound);

const $ = id => document.getElementById(id);
const HEART = '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 20.6S3.4 15.3 3.4 9.4A4.6 4.6 0 0 1 12 6.9a4.6 4.6 0 0 1 8.6 2.5c0 5.9-8.6 11.2-8.6 11.2z"/></svg>';
const html = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const HUMAN = 'A';
const COMPUTER = 'B';
const THINK_MS = 1400;           // låt korten landa innan datorn gör nästa drag
const DECISION_PHASES = [PHASE.swap, PHASE.attack, PHASE.defence];
const PLAY_PHASES = [PHASE.attack, PHASE.defence];

/* Adaptern äger matchen: LokalMatch (match.html) eller OnlineMatch (match.html?online=1, från lobbyn).
   `v` är den senaste privata vyn; den byts bara när adaptern meddelar en ny. Sätts i boot(). */
const ONLINE = new URLSearchParams(location.search).has('online');
let adapter = null;
let v = null;
const ui = {
  mode: 'computer',     // 'computer' | 'hotseat' | 'online'
  strategy: STRATEGIES.smart,
  viewer: HUMAN,        // vems hand som visas
  selected: [],         // markerade exemplar-ID (högst två vid kortbyte, ett annars)
  usage: USAGE.normal,  // NORMAL eller ENKEL_ATTACK vid anfall
  confirm: null,        // 'new' | 'surrender' – en öppen fråga i gränssnittet
  notice: null,         // { text, kind }
  focus: null,          // element-ID som ska få fokus efter nästa render
  thinking: false,      // datorn väntar på att spela
  startPending: null,   // första anfallaren visas innan någon får spela
  decisionError: null,  // { matchId, revision, reason } – datorn kunde inte välja
  computerLog: []       // datorns beslut och skäl (visas i utvecklingsläget)
};
let pendingJob = null;  // högst ett väntande datorjobb
let flying = Promise.resolve();  // senaste kortflygningen; resultatrutan väntar in den
let dealtSoundMatch = null;

function playDealSound() {
  if (dealtSoundMatch === v.matchId) return;
  dealtSoundMatch = v.matchId;
  sound.playEffect('shuffle');
}

/* Ljud för bekräftade händelser från adaptern (lokalt nu, serverns händelser i L09/L19). */
function playEvents(events) {
  for (const e of events) {
    if (e.type === EVENT.cardPlayed) { sound.playEffect('card'); sound.playEffect(e.data.role === 'attack' ? (e.data.usage !== USAGE.simple && e.data.cardType === 'magic' ? 'magic' : 'attack') : 'defence'); }
    if ((e.type === EVENT.swap && e.data.count > 0) || e.type === EVENT.refill) sound.playEffect('shuffle');
  }
}

/* ---- Härledningar (allt ur den privata vyn) ---- */
const view = () => v;
const nameOf = id => v.players.find(p => p.id === id)?.name ?? '';
const opponentOf = id => id === 'A' ? 'B' : 'A';
const isComputer = id => ui.mode === 'computer' && id === COMPUTER;
const personal = () => ui.mode !== 'hotseat';   // "du" i texterna (mot datorn och online)
/* Matchslutet i ord: fallet torn, uppgivet, tidsgräns (L16) eller ingen vinnare när båda tiderna gick ut. */
const vem = id => personal() && id === ui.viewer ? 'Du' : nameOf(id);
function slutText() {
  if (!v.winner) return 'Båda spelarnas tid för valet tog slut samtidigt. Ingen vinner matchen.';
  const forlorare = opponentOf(v.winner);
  if (v.endReason === END.surrendered) return `${nameOf(forlorare)} gav upp matchen.`;
  if (v.endReason === END.timeout) return `${vem(forlorare)} hann inte välja i tid.`;
  return `${nameOf(forlorare)} har fallit efter ${v.battleNumber} strider.`;
}
const vinnarRubrik = () => !v.winner ? 'Ingen vinner matchen' : personal() && v.winner === ui.viewer ? 'Du vinner matchen' : `${nameOf(v.winner)} vinner matchen`;
/* Egen nedräkning online (L16): bara när servern väntar på mig. */
const minKlocka = () => ONLINE && v.deadline ? klockrad(v.deadline.playerId, { varning: 'kvar – välj nu, annars förlorar du matchen' }) : '';
const opponentName = () => ui.mode === 'computer' ? 'Datorn' : nameOf(opponentOf(ui.viewer));
/* Online sitter man alltid nederst: zonen 'A' på bordet är den egna och 'B' motståndarens. Lokalt är zon = plats. */
const zone = id => ONLINE ? (id === ui.viewer ? 'A' : 'B') : id;
/* Startmeddelandet: lokalt ett eget läge, online serverns väntande startbekräftelse. */
const startPending = () => ui.startPending ?? (v.confirm?.kind === MATCH_COMMAND.confirmStart ? { matchId: v.matchId, playerId: v.activePlayer, online: true } : null);
const cardInHand = instanceId => v.me.hand.find(c => c.instanceId === instanceId);
const selectedOne = () => ui.selected.length === 1 ? cardInHand(ui.selected[0]) : null;
const allowedOf = type => v.allowed.find(a => a.type === type);
/* Om ett kort i handen går att använda nu avgörs av de tillåtna valen i vyn, inte av egna regler. */
const usableNow = instanceId => {
  if (v.phase === PHASE.swap) return true;
  if (v.phase === PHASE.attack) { const a = allowedOf(ACTION.attack); return Boolean(a && (ui.usage === USAGE.simple ? a.simple : a.normal).some(c => c.instanceId === instanceId)); }
  if (v.phase === PHASE.defence) { const d = allowedOf(ACTION.defend); return Boolean(d && d.cards.some(c => c.instanceId === instanceId)); }
  return false;
};
const myTurn = () => v.activePlayer === ui.viewer;
const canChoose = () => !startPending() && !v.confirm && myTurn() && DECISION_PHASES.includes(v.phase);   // kort i handen går att markera
const stateKey = () => `${v.matchId}|${v.revision}|${v.phase}|${v.activePlayer}`;

/* ---- Små ritfunktioner ---- */
const cardHTML = type => cardFace(type);
const simpleHTML = type => cardFace(type, { simple: true });
const button = (action, label, { kind = 'primary', disabled = false, id = '' } = {}) => `<button type="button" class="${kind}"${id ? ` id="${id}"` : ''} data-action="${action}" data-revision="${v.revision}"${disabled ? ' disabled' : ''}>${label}</button>`;

function hearts(id, count, previous = count) {
  $(id).setAttribute('aria-label', `${count} av ${MAX_LIFE} liv`);
  $(id).innerHTML = Array.from({ length: MAX_LIFE }, (_, n) => `<span aria-hidden="true" class="${n < count ? '' : 'lost'}${n >= count && n < previous ? ' just-lost' : ''}">${HEART}</span>`).join('');
}

function slot(id, content, label, extraClass = '') {
  $(id).setAttribute('aria-label', label);
  $(id).innerHTML = content ? `<div class="mini-card ${content.type}${extraClass ? ` ${extraClass}` : ''}" data-card="${content.id}"${content.simple ? ' data-simple="true"' : ''} aria-label="${html(label)}: ${html(content.name)}">${content.simple ? simpleHTML(content) : cardHTML(content)}</div>` : `<div class="empty"><span aria-hidden="true">+</span>${html(label)}</div>`;
}

/* Kortet i rutan `slotId` flyger in från rektangeln `from`; rutans eget kort döljs under tiden. */
function flyIntoSlot(slotId, from) {
  const target = $(slotId).querySelector('.mini-card');
  if (!target || !from?.width) return;
  target.style.visibility = 'hidden';
  flying = flyGhost(target, from, docRect(target)).then(() => { target.style.visibility = ''; });
}

/* Dit bortbytta kort flyger: draghögen, eller stridsplatsens mitt när högarna är dolda (smal skärm). */
function pileRect() {
  const pile = docRect($('draw-number'));
  if (pile.width) return pile;
  const battle = docRect($('battle'));
  return { left: battle.left + battle.width / 2 - 20, top: battle.top + 24, width: 40, height: 56 };
}

function tower(id) {
  const p = v.players.find(q => q.id === id);
  const r = v.lastResult;
  const shown = [PHASE.result, PHASE.over].includes(v.phase) && r;
  const el = $(`tower-${zone(id)}`);
  towerAppearance(el, p.life);
  el.classList.toggle('damaged', p.life < MAX_LIFE && p.life > 0);
  el.classList.toggle('fallen', p.life === 0);
  el.classList.toggle('held', Boolean(shown && r.defender === id && r.defended));
  el.classList.toggle('hit', Boolean(shown && r.life[id] < r.startLife[id]));
  hearts(`life-${zone(id)}`, p.life, shown ? r.startLife[id] : p.life);
  $(`count-${zone(id)}`).textContent = p.life === 0 ? 'Tornet har fallit' : `${p.cardCount} kort på handen`;
}

/* ---- Text för faserna ---- */
function phaseText() {
  const active = v.activePlayer ? nameOf(v.activePlayer) : '';
  const waiting = ui.thinking ? ' Datorn väljer kort…' : '';
  switch (v.phase) {
    case PHASE.swap: return { title: `Startbyten – omgång ${v.swapRound} av ${v.rules.swapRounds}`, text: ui.thinking ? 'Datorn väljer sina byten…' : `${active}: markera upp till ${v.rules.maxCardsPerSwap} kort i handen nedanför och tryck Byt kort – eller Behåll handen. Bortbytta kort blandas tillbaka först när bytena är klara.` };
    case PHASE.attack: return { title: `${active} anfaller`, text: ui.thinking ? `Strid ${v.battleNumber}.${waiting}` : `Strid ${v.battleNumber}. Välj ett kort eller använd enkel attack 1.` };
    case PHASE.defence: { const a = v.battle.attack; const type = cardType(a.cardId); return { title: `${active} försvarar`, text: `${nameOf(v.battle.attacker)} anfaller med ${a.usage === USAGE.simple ? `${type.name} som enkel attack 1` : `${type.name} (${type.value})`}.${ui.thinking ? waiting : ' Välj ett försvarskort eller avstå.'}` }; }
    case PHASE.result: { const r = v.lastResult; return { title: r.defended ? 'Försvaret håller' : `${nameOf(r.defender)} träffas`, text: `Attack ${r.attackStrength} mot försvar ${r.defenceStrength}. Läs resultatet och tryck Fortsätt.` }; }
    case PHASE.over: return { title: v.winner ? `${nameOf(v.winner)} vinner` : 'Ingen vinner', text: slutText() };
    case PHASE.error: return { title: 'Matchen har stoppats', text: `Regel- eller bokföringsfel: ${v.error}. Starta en ny match.` };
    default: return { title: '', text: '' };
  }
}

/* ---- Handen byggs om bara när dess exemplar, fas eller användning ändras.
   Exemplar som inte visats förut delas ut med en liten animation. ---- */
let handKey = null;
let shownIds = new Set();
function renderHand() {
  const key = `${ui.viewer}|${v.me.hand.map(c => c.instanceId).join(',')}|${v.phase}|${ui.usage}|${v.activePlayer}`;
  if (key !== handKey) {
    const scrollLeft = handKey?.startsWith(`${ui.viewer}|`) ? $('hand').scrollLeft : 0;
    handKey = key;
    let dealt = 0;
    $('hand').innerHTML = v.me.hand.map(({ instanceId, cardId }) => {
      const type = cardType(cardId);
      const usable = myTurn() && usableNow(instanceId);
      const why = !myTurn() ? '' : v.phase === PHASE.attack ? ', kan spelas som enkel attack 1' : v.phase === PHASE.defence ? ', används vid attack' : '';
      const fresh = !shownIds.has(instanceId);
      return `<button type="button" class="mini-card ${type.type}${usable ? '' : ' unusable'}${fresh ? ' dealt' : ''}"${fresh ? ` style="animation-delay:${dealt++ * 80}ms"` : ''} data-instance="${instanceId}" data-card="${type.id}" aria-pressed="false" aria-label="${html(type.name)}, ${html(type.valueLabel)} ${html(type.value)}${usable ? '' : why}">${cardHTML(type)}<span class="swap-mark" hidden>Byts</span></button>`;
    }).join('');
    $('hand').scrollLeft = scrollLeft;
    shownIds = new Set(v.me.hand.map(c => c.instanceId));
  }
  $('hand').classList.toggle('placing', myTurn() && PLAY_PHASES.includes(v.phase));
  // Korten spärras aldrig med `disabled`: ett långt tryck ska kunna öppna dem även under motståndarens tur.
  const interactive = canChoose();
  for (const el of $('hand').querySelectorAll('button')) {
    const chosen = ui.selected.includes(el.dataset.instance);
    el.setAttribute('aria-pressed', String(chosen));
    el.classList.toggle('inactive', !interactive);
    el.setAttribute('aria-disabled', String(!interactive || el.classList.contains('unusable')));
    el.querySelector('.swap-mark').hidden = !(chosen && v.phase === PHASE.swap);
  }
}

function renderActions() {
  const allowed = v.allowed.map(a => a.type);
  const pick = selectedOne();
  const type = pick ? cardType(pick.cardId) : null;
  let info = '';
  let actions = '';
  let where = v.phase === PHASE.swap ? 'hand' : 'battle';

  if (startPending()) {
    info = `<h3>${html(startTitle())}</h3><p>Startbytena är klara. Dags för första striden.</p>`;
  } else if (ui.decisionError) {
    info = `<h3>Datorn kunde inte välja ett drag</h3><p>${html(ui.decisionError.reason)} Matchen är oförändrad: inga kort, liv eller faser har ändrats.</p>`;
    actions = button('retry', 'Försök igen', { kind: 'secondary', id: 'retry-computer' }) + button('new', 'Ny match', { id: 'confirm-new-match' });
  } else if (ui.thinking) {
    info = `<h3 class="thinking">Motståndaren väljer kort</h3><p>${html(nameOf(v.activePlayer))} spelar enligt samma regler som du. Håll in ett kort om du vill läsa det under tiden.</p>`;
  } else if (v.phase === PHASE.swap && allowed.includes(ACTION.swap)) {
    where = 'hand';
    const n = ui.selected.length;
    const max = v.rules.maxCardsPerSwap;
    const round = `Omgång ${v.swapRound} av ${v.rules.swapRounds}.`;
    info = `<h3>Välj upp till ${max} kort · ${n}/${max} valda</h3><p>${round} ${type ? html(type.effect) : 'Tryck på ett kort för att markera. Tryck igen för att ångra.'}</p>`;
    actions = button('keep', 'Behåll handen', { kind: 'secondary', id: 'keep-hand' }) + button('swap', n === 0 ? 'Byt kort' : `Byt ${n} kort`, { disabled: n === 0, id: 'confirm-swap' });
  } else if (v.phase === PHASE.attack && allowed.includes(ACTION.attack)) {
    const ok = Boolean(pick && usableNow(pick.instanceId));
    const hint = type && !ok ? `<p class="invalid">Välj ”Enkel attack 1” för att anfalla med detta kort.</p>` : '';
    info = type ? `<h3>${html(type.name)}</h3>${hint || `<p>${ui.usage === USAGE.simple ? 'Vanlig attack 1, utan specialeffekt.' : html(type.effect)}</p>`}` : '<h3>Välj ditt attackkort</h3><p>Tryck på ett kort för att läsa effekten.</p>';
    actions = button('attack', ok ? `Anfall med ${html(type.name)}${ui.usage === USAGE.simple ? ' (attack 1)' : ''}` : 'Anfall', { disabled: !ok, id: 'confirm-attack' });
  } else if (v.phase === PHASE.defence && allowed.includes(ACTION.defend)) {
    const ok = Boolean(pick && usableNow(pick.instanceId));
    const hint = type && !ok ? `<p class="invalid">Kortet kan inte försvara. Välj ett annat eller avstå.</p>` : '';
    // Försvararen får läsa det anfallande kortets effekt innan ett eget kort väljs.
    const incoming = v.battle.attack;
    const incomingType = cardType(incoming.cardId);
    const incomingText = incoming.usage === USAGE.simple ? `${html(incomingType.name)} spelas som enkel attack 1, utan specialeffekt.` : `<strong>${html(incomingType.name)}:</strong> ${html(incomingType.effect)}`;
    info = type ? `<h3>${html(type.name)}</h3>${hint || `<p>${html(type.effect)}</p>`}` : `<h3>Välj ditt försvarskort</h3><p>${incomingText}</p><p>Lika hög eller högre försvarsstyrka stoppar attacken. Att avstå sparar hela handen men kostar ett liv om attacken går igenom.</p>`;
    actions = button('pass', 'Avstå försvar', { kind: 'secondary', id: 'confirm-pass' }) + button('defend', ok ? `Försvara med ${html(type.name)}` : 'Försvara', { disabled: !ok, id: 'confirm-defend' });
  } else if (v.phase === PHASE.result) {
    const waiting = ONLINE && Boolean(v.confirm?.mine);
    info = `<h3>Strid ${v.lastResult.battleNumber} är avgjord</h3><p>Spelade kort ligger i slänghögen. Nästa anfallare: ${html(nameOf(opponentOf(v.lastResult.attacker)))}.${v.players.some(p => p.life > 0 && !p.cardCount) ? ' En tom hand får upp till fem nya kort.' : ''}${waiting ? ` Väntar på att ${html(opponentName())} trycker Fortsätt.` : ''}</p>`;
    actions = button('next', waiting ? 'Väntar …' : 'Fortsätt <span aria-hidden="true">→</span>', { id: 'confirm-next', disabled: waiting });
  } else if (v.phase === PHASE.over) {
    info = `<h3>${html(vinnarRubrik())}</h3><p>${v.endReason === END.surrendered ? 'Matchen avslutades genom att motståndaren gav upp.' : v.endReason === END.fallen ? 'Motståndarens torn har fallit.' : html(slutText())} Ingen påfyllning eller ny tur efter avslut.</p>`;
    actions = ONLINE ? button('lobby', 'Till lobbyn', { id: 'confirm-new-match' }) : button('new', 'Spela igen', { id: 'confirm-new-match' });
  } else if (v.phase === PHASE.error) {
    info = `<h3>Matchen har stoppats</h3><p>${html(v.error)}</p>`;
    actions = ONLINE ? button('lobby', 'Till lobbyn', { id: 'confirm-new-match' }) : button('new', 'Ny match', { id: 'confirm-new-match' });
  } else {
    info = `<h3>${html(nameOf(v.activePlayer ?? ui.viewer))} står på tur</h3><p>Vänta på motståndarens drag.</p>`;
  }
  const onBattle = where === 'battle';
  $('selection-info').innerHTML = onBattle ? minKlocka() + info : '';
  $('actions').innerHTML = onBattle ? actions : '';
  $('battle-actions').hidden = !onBattle;
  $('hand-info').innerHTML = onBattle ? '' : minKlocka() + info;
  $('hand-actions').innerHTML = onBattle ? '' : actions;
  $('hand-bar').hidden = onBattle;
  $('surrender').disabled = !allowed.includes(ACTION.surrender) || Boolean(ui.confirm) || Boolean(ui.decisionError);
  $('new-match').disabled = Boolean(ui.confirm);
}

/* Bekräftelser är riktiga dialoger. Datorns presentationspaus stoppas medan
   frågan visas; ett avbrott återupptar samma tur utan att ändra matchen. */
function openConfirmation(kind) {
  cancelComputerJob();
  ui.confirm = kind;
  ui.focus = null;
  render();
}

function closeConfirmation() {
  if (!ui.confirm) return;
  ui.focus = ui.confirm === 'new' ? 'new-match' : 'surrender';
  ui.confirm = null;
  syncComputerTurn();
  render();
}

function renderConfirmation() {
  const dialog = $('confirm-dialog');
  if (!ui.confirm) { if (dialog.open) dialog.close(); return; }
  const surrender = ui.confirm === 'surrender';
  $('confirm-title').textContent = surrender ? 'Ge upp matchen?' : 'Börja en ny match?';
  $('confirm-message').textContent = surrender
    ? `${nameOf(opponentOf(ui.viewer))} vinner om du ger upp. Du kan också stänga rutan och fortsätta spela.`
    : 'Den pågående matchen avslutas och du får en ny hand. Vill du börja om?';
  $('confirm-emblem').innerHTML = popupIcon(surrender ? 'banner' : 'cards');
  $('confirm-actions').innerHTML = minKlocka() + button('cancel', 'Fortsätt spela', { kind: 'secondary', id: 'confirm-cancel' }) + button(surrender ? 'confirm-surrender' : 'confirm-new', surrender ? 'Ja, ge upp' : 'Ja, ny match');
  if (!dialog.open) { dialog.showModal(); $('confirm-cancel').focus(); }
}

/* ---- Stridsresultatet visas i en dialogruta. Den öppnas en gång per avgjord strid
   (och vid matchslut), efter att eventuell kortflygning landat, och stängs när
   matchen går vidare. Stängs den med Escape finns Fortsätt kvar på stridsplatsen. ---- */
let resultKey = null;
let pendingResultKey = null;
let pendingResultEffect = null;
function openPendingResult() {
  if (!pendingResultKey || pendingResultKey !== resultKey) return;
  const rutor = ['intro-dialog', 'swap-dialog', 'confirm-dialog', 'start-dialog', 'card-dialog', 'sound-dialog'];
  /* Matchslutet (t.ex. på tid, L16) ska synas direkt: öppna hjälprutor stängs i stället för att resultatet väntar. */
  if (v.phase === PHASE.over) { if (ui.confirm) closeConfirmation(); for (const id of rutor) if ($(id).open) $(id).close(); }
  if (rutor.some(id => $(id).open)) return;
  pendingResultKey = null;
  if (pendingResultEffect) {
    sound.stopEffects();
    sound.playEffect(pendingResultEffect);
    pendingResultEffect = null;
  }
  if (!$('result-dialog').open) {
    $('result-dialog').showModal();
  }
}
function renderResult() {
  const r = v.lastResult;
  const dialog = $('result-dialog');
  const over = v.phase === PHASE.over;
  if (!over && !(v.phase === PHASE.result && r)) {
    resultKey = null;
    pendingResultKey = null;
    pendingResultEffect = null;
    if (dialog.open) dialog.close();
    return;
  }
  const lines = [];
  if (r && (!over || v.endReason === END.fallen)) {
    const fallen = v.players.filter(p => p.life === 0);
    lines.push(battleSummary(r), `<ul>${r.events.map(e => `<li>${html(e)}</li>`).join('')}</ul>`, `<p>${html(nameOf('A'))} har ${r.life.A} liv. ${html(nameOf('B'))} har ${r.life.B} liv. Alla spelade kort slängs.${fallen.length ? ' Det fallna tornets kvarvarande handkort slängs också.' : ''}</p>`);
  } else if (over) {
    lines.push(`<p>${html(slutText())}</p>`);
  }
  if (over) lines.push(`<p class="winner"><strong>${html(vinnarRubrik())}.</strong></p>`);
  const kind = over ? (personal() && v.winner !== ui.viewer ? 'defeat' : 'victory') : r.defended ? 'held' : 'hit';
  dialog.dataset.outcome = kind;
  $('result').innerHTML = `${resultHeader(kind, phaseText().title, over)}<div class="popup-result-body">${lines.join('')}</div>`;
  const waiting = ONLINE && !over && Boolean(v.confirm?.mine);
  $('dialog-actions').innerHTML = over
    ? (ONLINE ? button('lobby', 'Till lobbyn', { id: 'dialog-new' }) : button('new', 'Spela igen', { id: 'dialog-new' }))
    : minKlocka() + button('next', waiting ? `Väntar på ${html(opponentName())} …` : 'Fortsätt <span aria-hidden="true">→</span>', { id: 'dialog-next', disabled: waiting });
  const key = `${v.matchId}|${v.revision}|${v.phase}`;
  if (key === resultKey) return;
  resultKey = key;
  // I tvåspelarläget gäller ljudet spelaren vars hand visas vid resultatet. Vyn har samma fält som resultEffect läser.
  pendingResultEffect = resultEffect(v, ui.viewer);
  // Vänta ett varv: en flygning som startas direkt efter render() ska hinna registreras i `flying`.
  setTimeout(() => flying.then(() => { if (resultKey === key) { pendingResultKey = key; openPendingResult(); } }), 0);
}

/* ---- Hjälprutor. Spelförklaringen öppnas när sidan laddas (och via knappen Så spelar du).
   Bytesförklaringen öppnas en gång per spelare och match när det är dags att byta,
   men väntar tills spelförklaringen är stängd så att rutorna inte staplas. ---- */
const swapHelpShown = new Set();   // "match-ID|spelare" som redan fått bytesförklaringen
function startTitle() {
  const first = startPending()?.playerId;
  if (ui.mode === 'computer') return first === HUMAN ? 'Du börjar!' : 'Datorn börjar!';
  if (personal()) return first === ui.viewer ? 'Du börjar!' : `${nameOf(first)} börjar!`;
  return `${nameOf(first)} börjar!`;
}

function renderStart() {
  const pending = startPending();
  if (!pending) { if ($('start-dialog').open) $('start-dialog').close(); return; }
  $('start-title').textContent = startTitle();
  const mine = ONLINE && Boolean(v.confirm?.mine);
  $('start-message').textContent = `${nameOf(pending.playerId)} har lottats till att anfalla först. ${ui.mode === 'computer'
    ? (pending.playerId === HUMAN ? 'Välj ditt första attackkort när du är redo.' : 'Du försvarar först. Datorn väntar tills du trycker på Börja striden.')
    : ONLINE ? (pending.playerId === ui.viewer ? 'Du anfaller först.' : 'Du försvarar först.') + (mine ? ` Väntar på att ${opponentName()} bekräftar.` : ' Striden börjar när båda har tryckt på Börja striden.')
    : 'Den andra spelaren försvarar.'}`;
  $('start-clock').innerHTML = minKlocka();
  $('start-play').disabled = mine;
  $('start-play').textContent = mine ? 'Väntar …' : 'Börja striden';
  // Ett sista byte kan fortfarande animeras. Visa meddelandet när korten landat.
  setTimeout(() => Promise.all([flying, ...$('hand').getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))]).then(() => {
    if (startPending()?.matchId === pending.matchId && !$('start-dialog').open) $('start-dialog').showModal();
  }), 0);
}

function beginFirstBattle() {
  const pending = startPending();
  if (!pending) return;
  if (pending.online) { if (!v.confirm?.mine) send(MATCH_COMMAND.confirmStart); return; }   // rutan stängs när båda bekräftat
  ui.startPending = null;
  $('start-dialog').close();
  ui.focus = 'phase-title';
  syncComputerTurn();
  render();
}

/* Kort återkoppling per tur, aldrig vid ommarkering av ett kort. */
let feedbackKey = null;
let feedbackTimer = null;
let feedbackAnimations = [];
function renderTurnFeedback() {
  const banner = $('turn-feedback');
  const active = PLAY_PHASES.includes(v.phase) && !startPending();
  const key = active ? `${v.matchId}|${v.battleNumber}|${v.phase}|${v.activePlayer}|${ui.mode}` : null;
  if (key === feedbackKey) return;
  feedbackKey = key;
  clearTimeout(feedbackTimer);
  feedbackAnimations.forEach(animation => animation.cancel());
  feedbackAnimations = [];
  banner.hidden = true;
  if (!active) return;
  const defending = v.phase === PHASE.defence && myTurn();
  const tone = defending ? 'defence' : 'attack';
  const label = personal()
    ? myTurn() ? (defending ? 'Du blir anfallen!' : 'Din tur att anfalla!')
      : (v.phase === PHASE.attack ? `${opponentName()} förbereder sitt anfall` : `Ditt anfall – ${opponentName()} försvarar`)
    : `${nameOf(ui.viewer)} ${defending ? 'försvarar' : 'anfaller'}!`;
  banner.dataset.tone = tone;
  banner.innerHTML = `<small>${v.phase === PHASE.attack ? `STRID ${v.battleNumber} BÖRJAR` : `STRID ${v.battleNumber}`}</small>${html(label)}`;
  banner.hidden = false;
  if (!reduceMotion.matches) {
    const glow = defending ? '#78b8f0' : '#e9b95e';
    feedbackAnimations = [
      banner.animate([{ opacity: 0, translate: '0 -6px' }, { opacity: 1, translate: '0 0', offset: .15 }, { opacity: 1, offset: .8 }, { opacity: 0 }], { duration: 1800, easing: 'ease-out', fill: 'forwards' }),
      document.querySelector('.table').animate([{ boxShadow: `inset 0 0 0 2px ${glow}00` }, { boxShadow: `inset 0 0 32px 2px ${glow}90`, offset: .25 }, { boxShadow: `inset 0 0 0 2px ${glow}00` }], { duration: 1300, easing: 'ease-out' })
    ];
  }
  feedbackTimer = setTimeout(() => { banner.hidden = true; }, 1800);
}

function renderSwapHelp() {
  const dialog = $('swap-dialog');
  const due = v.phase === PHASE.swap && myTurn() && !ui.thinking && !ui.confirm && !ui.decisionError;
  if (!due) { if (dialog.open) dialog.close(); return; }
  const key = `${v.matchId}|${ui.viewer}`;
  if (swapHelpShown.has(key) || dialog.open || $('intro-dialog').open) return;
  swapHelpShown.add(key);
  $('swap-who').textContent = ui.mode === 'computer' ? 'Du spelar Södra tornet och byter först. Sedan byter datorn.' : ONLINE ? `Du byter nu. ${opponentName()} byter när du är klar.` : `${nameOf(ui.viewer)} byter nu – den andra spelaren tittar bort.`;
  dialog.showModal();
}

/* Utvecklingspanelen: motståndarens hand hämtas bara via adapterns lokala inblick. Online finns ingen sådan väg. */
function renderDev() {
  const other = v.players.find(p => p.id !== ui.viewer);
  const show = $('show-both').checked;
  const names = show && adapter.local ? adapter.local.revealHand(other.id) : null;
  $('other-hand').innerHTML = !show ? '' : !names ? '<p>Motståndarens hand finns bara på servern.</p>' : `<p><strong>${html(nameOf(other.id))}</strong> (${other.cardCount} kort):</p><ul>${names.map(name => `<li>${html(name)}</li>`).join('') || '<li>Tom hand</li>'}</ul>`;
  $('computer-log').innerHTML = ui.computerLog.map(line => `<li>${html(line)}</li>`).join('') || '<li>Inga datorbeslut ännu.</li>';
  $('dev-state').textContent = `match ${v.matchId} · revision ${v.revision} · fas ${v.phase} · aktiv ${v.activePlayer ?? '–'} · strid ${v.battleNumber} · läge ${ui.mode} · strategi ${ui.strategy} (${STRATEGY.version})`;
}

/* Vems hand som visas: alltid A mot datorn; i tvåspelarläget den som står på tur (bara lokalt). */
function syncViewer() {
  if (!adapter.local) { ui.viewer = adapter.viewer(); return; }   // online: fast identitet från servern
  const wanted = ui.mode === 'computer' ? HUMAN : (adapter.local.activePlayer() ?? adapter.viewer());
  if (adapter.local && wanted !== adapter.viewer()) { adapter.local.setViewer(wanted); v = adapter.view(); }
  ui.viewer = adapter.viewer();
}

function render() {
  sound.setPlaying(![PHASE.over, PHASE.error].includes(v.phase));
  syncViewer();
  const { title, text } = phaseText();
  document.body.classList.toggle('swapping', v.phase === PHASE.swap);

  // Torn, liv, högar (online sitter man själv i zon A nederst, motståndaren i zon B)
  for (const p of v.players) tower(p.id);
  const opponent = v.players.find(p => zone(p.id) === 'B');
  $('label-B').textContent = ui.mode === 'computer' ? 'DATORN' : ONLINE ? 'MOTSTÅNDARE' : 'SPELARE B';
  if (ONLINE) { $('name-B').textContent = opponent.name; $('name-A').textContent = nameOf(ui.viewer); $('label-A').textContent = 'DU'; $('opponent-clock').dataset.klocka = opponentOf(ui.viewer); }
  $('hidden-B').classList.toggle('empty', !opponent.cardCount);
  $('draw-number').textContent = String(v.drawPileSize);
  $('discard-number').textContent = String(v.discardPile.length);
  $('turn-label').textContent = v.activePlayer ? `${nameOf(v.activePlayer)} står på tur` : v.phase === PHASE.over ? 'Matchen är avslutad' : v.phase === PHASE.result ? 'Tryck Fortsätt för nästa strid' : '';
  $('match-label').textContent = `Regler ${v.rulesVersion} · Kortlek ${v.deckVersion} · Strid ${v.battleNumber}`;
  if (!ONLINE) { $('mode').value = ui.mode; $('strategy').value = ui.strategy; }
  $('new-match').textContent = ONLINE ? 'Till lobbyn' : 'Ny match';
  $('new-match').hidden = ONLINE && ![PHASE.over, PHASE.error].includes(v.phase);

  // Stridsplatsen
  $('phase-title').textContent = title;
  $('phase-description').textContent = text;
  const r = v.lastResult;
  if ([PHASE.result, PHASE.over].includes(v.phase) && r) {
    const a = cardType(r.attack.cardId);
    slot('attack-slot', r.attack.usage === USAGE.simple ? { ...a, simple: true, name: r.attack.name } : a, `${nameOf(r.attacker)}s attack`);
    slot('defence-slot', r.defence ? cardType(r.defence.cardId) : null, r.defence ? `${nameOf(r.defender)}s försvar` : 'Inget försvar spelades');
  } else if (v.battle?.attack) {
    const a = cardType(v.battle.attack.cardId);
    slot('attack-slot', v.battle.attack.usage === USAGE.simple ? { ...a, simple: true } : a, `${nameOf(v.battle.attacker)}s attack`);
    // Det valda kortet läggs i rutan även om det (ännu) inte duger som försvar; då visas det nedtonat med en förklaring i knappraden.
    const pick = myTurn() && v.phase === PHASE.defence ? selectedOne() : null;
    const type = pick ? cardType(pick.cardId) : null;
    slot('defence-slot', type, ui.thinking ? 'Datorn väljer försvar' : 'Försvarskort', pick && !usableNow(pick.instanceId) ? 'not-usable' : '');
  } else {
    const pick = myTurn() && v.phase === PHASE.attack ? selectedOne() : null;
    const type = pick ? cardType(pick.cardId) : null;
    slot('attack-slot', type ? (ui.usage === USAGE.simple ? { ...type, simple: true } : type) : null, ui.thinking && v.phase === PHASE.attack ? 'Datorn väljer anfall' : 'Attackkort', pick && !usableNow(pick.instanceId) ? 'not-usable' : '');
    slot('defence-slot', null, 'Försvarskort');
  }

  // Handen
  $('hand-owner').textContent = ui.mode === 'computer' ? 'DINA KORT · SÖDRA TORNET' : ONLINE ? `DINA KORT · ${nameOf(ui.viewer).toUpperCase()}` : `${nameOf(ui.viewer).toUpperCase()}S KORT`;
  $('hand-heading').textContent = !myTurn() && DECISION_PHASES.includes(v.phase) ? 'Motståndarens tur' : v.phase === PHASE.swap ? 'Välj kort att byta' : v.phase === PHASE.attack ? 'Välj ditt anfall' : v.phase === PHASE.defence ? 'Försvara ditt torn' : v.phase === PHASE.result ? 'Kvarvarande kort' : 'Matchen är slut';
  $('hand-count').textContent = `${v.me.hand.length} kort`;
  $('usage').hidden = Boolean(startPending()) || Boolean(v.confirm) || !(v.phase === PHASE.attack && myTurn());
  $('usage-normal').setAttribute('aria-pressed', String(ui.usage === USAGE.normal));
  $('usage-simple').setAttribute('aria-pressed', String(ui.usage === USAGE.simple));
  renderHand();
  renderActions();
  renderConfirmation();
  renderResult();
  renderSwapHelp();
  renderStart();
  renderTurnFeedback();
  renderDev();

  // Meddelanden och fokus. Online visas ett väntande drag som notis tills kvittensen kommit.
  const pendingText = v.pending?.status === PENDING.sending ? 'Skickar ditt drag …' : v.pending?.status === PENDING.checking ? 'Kontrollerar om draget registrerades …' : null;
  $('notice').textContent = ui.notice?.text ?? pendingText ?? '';
  $('notice').className = `notice${(ui.notice ? ui.notice.kind === 'info' : Boolean(pendingText)) ? ' info' : ''}`;
  for (const el of document.querySelectorAll('.dialog-clock')) { if (ONLINE) el.dataset.klocka = ui.viewer; else el.removeAttribute('data-klocka'); }
  nedrakning();
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
  if (ui.startPending) { cancelComputerJob(); return; }
  const key = stateKey();
  if (ui.decisionError) {
    if (ui.decisionError.matchId === v.matchId && ui.decisionError.revision === v.revision) return;
    ui.decisionError = null;
  }
  if (pendingJob?.key === key) return;
  cancelComputerJob();
  if (!adapter.local || !DECISION_PHASES.includes(v.phase) || !isComputer(v.activePlayer)) return;
  const job = { key, timer: null };
  pendingJob = job;
  ui.thinking = true;
  job.timer = setTimeout(() => runComputerJob(job), THINK_MS);
}

/* Datorns beslut tas inne i lokaladaptern på datorns egen vy; vyn här får bara valet och skälet. */
function runComputerJob(job) {
  if (pendingJob !== job) return;
  if (stateKey() !== job.key) { pendingJob = null; ui.thinking = false; render(); return; }
  const at = { matchId: v.matchId, revision: v.revision };
  let decision;
  try {
    decision = adapter.local.computerDecision({ strategy: ui.strategy, random: Math.random });
  } catch (error) {
    pauseComputer(at, error instanceof DecisionError ? error.message : `Oväntat fel i beslutsfunktionen: ${error.message}`);
    return;
  }
  pendingJob = null;
  ui.thinking = false;
  ui.computerLog.push(`Strid ${v.battleNumber}, ${v.phase}: ${decision.reason}`);
  const type = decision.choice.type;
  const previousPhase = v.phase;
  const reply = adapter.local.computerSend(decision.choice);
  afterReceipt(reply, { type, previousPhase, fromComputer: true });
  if (reply.status === RECEIPT.rejected && v.matchId === at.matchId && v.revision === at.revision) pauseComputer(at, reply.message);
  // På det kompakta bordet flyger datorns kort från tornet när handen är dold.
  if (reply.status === RECEIPT.ok && (type === ACTION.attack || type === ACTION.defend)) {
    const back = $('hidden-B').lastElementChild;
    const from = back && docRect(back).width ? docRect(back) : docRect($('tower-B'));
    flyIntoSlot(type === ACTION.attack ? 'attack-slot' : 'defence-slot', from);
  }
}

function pauseComputer(at, reason) {
  pendingJob = null;
  ui.thinking = false;
  ui.decisionError = { matchId: at.matchId, revision: at.revision, reason };
  ui.computerLog.push(`Strid ${v.battleNumber}, ${v.phase}: beslutsfel – ${reason}`);
  ui.focus = 'actions';
  render();
}

function retryComputer() {
  const error = ui.decisionError;
  if (!error || error.matchId !== v.matchId || error.revision !== v.revision) return;
  if (!DECISION_PHASES.includes(v.phase) || !isComputer(v.activePlayer)) return;
  ui.decisionError = null;
  syncComputerTurn();
  render();
}

/* ---- Handlingar: gränssnittet skickar ett kommando, adaptern (motor eller server) avgör ---- */
async function send(type, payload = {}) {
  const previousPhase = v.phase;
  const receipt = await adapter.send({ protocolVersion: PROTOCOL_VERSION, commandId: crypto.randomUUID(), type, matchId: v.matchId, revision: v.revision, payload });
  afterReceipt(receipt, { type, previousPhase, fromComputer: false });
  return receipt;
}

/* Gemensam efterbehandling av en kvittens. Ljuden spelas redan av händelserna från adaptern. */
function afterReceipt(receipt, { type, previousPhase, fromComputer }) {
  if (receipt.status === RECEIPT.rejected) {
    if (!fromComputer) ui.notice = { text: receipt.message, kind: 'error' };
  } else {
    if (!ONLINE && previousPhase === PHASE.swap && v.phase === PHASE.attack) {
      ui.startPending = { matchId: v.matchId, playerId: v.activePlayer };
    }
    ui.selected = [];
    ui.usage = USAGE.normal;
    ui.confirm = null;
    ui.notice = null;
    if (receipt.status === RECEIPT.error) {
      cancelComputerJob();
      ui.decisionError = null;
      ui.notice = { text: ONLINE ? receipt.message : `Internt fel: ${receipt.message}`, kind: 'error' };
    } else {
      syncComputerTurn();
    }
    // Resultatrutan tar själv fokus när den öppnas (renderResult).
    if (![PHASE.result, PHASE.over].includes(v.phase) && (type === ACTION.next || type === ACTION.swap || fromComputer)) ui.focus = 'phase-title';
  }
  render();
}

/* Online: lämna det avslutade rummet och gå tillbaka till lobbyn. */
async function leaveToLobby() {
  try {
    const lobby = await (await fetch('/api/lobby', { credentials: 'same-origin' })).json();
    if (lobby.rum) await fetch('/api/kommando', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: crypto.randomUUID(), type: 'LÄMNA', roomId: lobby.rum.id, payload: {} }) });
  } catch { /* lobbyn visar läget ändå */ }
  adapter.close?.();
  location.href = 'lobby.html';
}

function startNewMatch() {
  if (ONLINE) { leaveToLobby(); return; }
  cancelComputerJob();
  sound.stopEffects();
  ui.startPending = null;
  $('start-dialog').close();
  adapter.local.newMatch();
  Object.assign(ui, { viewer: HUMAN, selected: [], usage: USAGE.normal, confirm: null, decisionError: null, computerLog: [], notice: { text: 'Ny match: ny utdelning och tre liv var. Matchen sparas inte vid omladdning.', kind: 'info' }, focus: 'phase-title' });
  handKey = null;
  shownIds = new Set();   // hela handen delas ut på nytt
  syncComputerTurn();
  render();
  playDealSound();
}

/* Markera ett kort. Stridsplats och hand stannar i samma vy. */
function choose(instanceId) {
  if (!canChoose() || !cardInHand(instanceId)) return;
  ui.notice = null;
  if (v.phase === PHASE.swap) {
    if (ui.selected.includes(instanceId)) ui.selected = ui.selected.filter(id => id !== instanceId);
    else if (ui.selected.length >= v.rules.maxCardsPerSwap) ui.notice = { text: `Högst ${v.rules.maxCardsPerSwap} kort per bytesomgång. Avmarkera ett kort först.`, kind: 'error' };
    else ui.selected = [...ui.selected, instanceId];
    render();
  } else if (PLAY_PHASES.includes(v.phase)) {
    const picked = ui.selected[0] !== instanceId;
    ui.selected = picked ? [instanceId] : [];
    const source = picked ? $('hand').querySelector(`[data-instance="${instanceId}"]`) : null;
    const from = source ? docRect(source) : null;
    render();
    if (!picked) return;
    flyIntoSlot(v.phase === PHASE.attack ? 'attack-slot' : 'defence-slot', from);
  }
}

/* Bekräfta bytet: de markerade korten flyger till draghögen och de nya delas ut i handen.
   Med `keep` behålls hela handen – eventuella markeringar ignoreras. */
async function swapCards({ keep = false } = {}) {
  const marked = keep ? [] : [...$('hand').querySelectorAll('[aria-pressed="true"]')].map(el => [styledCardCopy(el), docRect(el)]);
  const reply = await send(ACTION.swap, { cards: keep ? [] : [...ui.selected] });
  if (reply.status !== RECEIPT.ok) return;
  const pile = pileRect();
  flying = Promise.all(marked.map(([el, from], i) => {
    // Krymp med bibehållna proportioner in mot högens mitt.
    const height = pile.width * from.height / from.width;
    const to = { left: pile.left, top: pile.top + (pile.height - height) / 2, width: pile.width, height };
    return flyGhost(el, from, to, { delay: i * 120, fade: true, layout: 'from' });
  }));
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
  swap: () => swapCards(),
  keep: () => swapCards({ keep: true }),
  attack: () => send(ACTION.attack, { instanceId: ui.selected[0], usage: ui.usage }),
  defend: () => send(ACTION.defend, { instanceId: ui.selected[0] }),
  pass: () => send(ACTION.pass),
  next: () => send(ACTION.next),
  new: () => startNewMatch(),
  lobby: () => leaveToLobby(),
  'confirm-new': () => startNewMatch(),
  'confirm-surrender': () => send(ACTION.surrender),
  retry: () => retryComputer(),
  cancel: closeConfirmation
};

/* Långtryck på kort i handen och på stridsplatsen öppnar kortet förstorat; klicket efter ett långtryck sväljs. */
const lupp = kopplaKortlupp({ behallare: [$('hand'), $('battle')], dialog: $('card-dialog'), detalj: $('card-detail') });
$('hand').addEventListener('click', event => { const el = event.target.closest('[data-instance]'); if (el && !lupp.swallowed()) choose(el.dataset.instance); });
/* Samma handlingar används på spelbordet och i dialogrutorna. */
function onAction(event) {
  const el = event.target.closest('[data-action]');
  if (!el || el.disabled) return;
  if (el.dataset.revision !== String(v.revision)) { ui.notice = { text: 'Matchläget har ändrats – försök igen.', kind: 'error' }; render(); return; }
  el.disabled = true;   // spärr mot dubbelklick tills handlingen behandlats
  actionHandlers[el.dataset.action]?.();
}
for (const id of ['actions', 'hand-actions', 'dialog-actions', 'confirm-actions', 'selection-info', 'hand-info']) $(id).addEventListener('click', onAction);
$('usage-normal').addEventListener('click', () => { ui.usage = USAGE.normal; render(); });
$('usage-simple').addEventListener('click', () => { ui.usage = USAGE.simple; render(); });
$('surrender').addEventListener('click', () => { if (!$('surrender').disabled) openConfirmation('surrender'); });
$('new-match').addEventListener('click', () => { if ([PHASE.over, PHASE.error].includes(v.phase)) startNewMatch(); else openConfirmation('new'); });
$('mode').addEventListener('change', () => setMode($('mode').value));
$('strategy').addEventListener('change', () => { ui.strategy = $('strategy').value === STRATEGIES.random ? STRATEGIES.random : STRATEGIES.smart; render(); });
$('show-both').addEventListener('change', renderDev);
/* Hjälprutorna: knapparna stänger; när spelförklaringen stängs kan bytesförklaringen öppnas.
   Bytesförklaringen lämnar fokus på första kortet i handen. */
$('show-help').addEventListener('click', () => $('intro-dialog').showModal());
$('intro-close').addEventListener('click', () => $('intro-dialog').close());
$('swap-close').addEventListener('click', () => $('swap-dialog').close());
$('start-play').addEventListener('click', beginFirstBattle);
$('start-dialog').addEventListener('cancel', event => { event.preventDefault(); if (!ONLINE) beginFirstBattle(); });
$('intro-dialog').addEventListener('close', renderSwapHelp);
$('swap-dialog').addEventListener('close', () => {
  $('hand').querySelector('button:not(.inactive)')?.focus({ preventScroll: true });
  if (v.phase === PHASE.swap) playDealSound();
});
for (const id of ['intro-dialog', 'swap-dialog', 'confirm-dialog', 'card-dialog', 'sound-dialog']) $(id).addEventListener('close', openPendingResult);
$('confirm-dialog').addEventListener('cancel', event => { event.preventDefault(); closeConfirmation(); });
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.closeDialog === 'confirm-dialog') closeConfirmation();
  else $(button.dataset.closeDialog).close();
}));
window.addEventListener('beforeunload', event => { if (!ONLINE && v && ![PHASE.over, PHASE.error].includes(v.phase) && v.revision > 0) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', cancelComputerJob);
const nedrakning = kopplaNedrakning({ klockor: () => (ONLINE ? v?.clocks : null), nu: () => adapter?.serverNu?.() ?? Date.now(), egen: () => ui.viewer, varna: text => { $('clock-alert').textContent = text; } });
/* ---- Start: välj adapter. Online hämtas matchen från servern; saknas den går man till lobbyn. ---- */
const CONNECTION_TEXT = { ansluter: 'Ansluter …', ansluten: 'Ansluten', ateransluter: 'Återansluter …', ersatt: 'Öppen i en annan flik', utloggad: 'Sessionen har gått ut' };
async function boot() {
  if (ONLINE) {
    let data;
    try {
      const response = await fetch('/api/match', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('ingen match');
      data = await response.json();
    } catch { location.replace('lobby.html'); return; }
    if (data.view.format === 'lag') { location.replace('lagmatch.html'); return; }   // lagmatchen har en egen vy (L15)
    adapter = skapaOnlineMatch({ initial: data });
    ui.mode = 'online';
    document.body.classList.add('online');
    $('mode').closest('label').hidden = true;
    $('strategy').closest('label').hidden = true;
    adapter.pa((lage, extra) => {
      const node = $('connection');
      node.textContent = CONNECTION_TEXT[lage] ?? lage;
      node.classList.toggle('warn', lage !== 'ansluten');
      if (lage === 'utloggad') { location.replace('lobby.html'); return; }
      if (lage === 'ersatt') ui.notice = { text: 'Spelet är öppet i en annan flik. Ladda om sidan för att spela här.', kind: 'error' };
      if (extra) ui.notice = { text: extra, kind: 'error' };
      if (v) render();
    });
  } else {
    adapter = skapaLokalMatch();
  }
  v = adapter.view();
  ui.viewer = adapter.viewer();
  adapter.subscribe((view, events) => {
    v = view;
    playEvents(events);
    if (ONLINE) { ui.selected = ui.selected.filter(id => cardInHand(id)); render(); }   // motståndarens drag kom via strömmen
  });
  if (ONLINE) adapter.connect();
  $('intro-dialog').showModal();   // före första render(): bytesförklaringen väntar tills den stängts
  syncComputerTurn();
  render();
}
boot();
