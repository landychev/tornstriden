/* Lagvyn (arbetsordning L15): lagmatchen för 4/6/8 deltagare i webbläsaren. Samma adaptergräns som duellen
   (onlinematch.js): vyn ser bara serverns privata vy – egen hand, offentliga torn, bordet och egna tillåtna
   val – och skickar kommandon enligt kontrakt.js. Inga lagkamraters händer finns någonstans. Allt som är
   tillåtet bestäms av servern (`allowed`); vyn räknar aldrig ut regler själv.

   Upplägg: fiendelaget överst, stridsplatsen med anfalls- och försvarskön i mitten och det egna laget
   nederst, närmast den egna handen. Alla val – byten, måltavla, kort, kortmål, avstående och Fortsätt –
   görs i knappraden direkt ovanför handen, så att kort och bekräftelse ligger intill varandra även på
   mobilen. Ett långt tryck på ett kort i handen eller på bordet öppnar det förstorat (kortlupp.js).
   Egen utslagning och lagets resultat visas var för sig.
   Spelarklockor (L16): den som har ett val ser sin nedräkning överst i knappraden, och varje torn visar sin
   spelares tid när servern väntar på hen (nedrakning.js). Servern avgör tidsgränsen. */
import { cards, MAX_LIFE } from './kort.js';
import { cardFace } from './grafik.js';
import { resultHeader, popupIcon } from './popup.js';
import { USAGE } from './matchregler.js';
import { GameAudio, bindAudioControls } from './ljud.js';
import { EVENT } from './lokalmatch.js';
import { skapaOnlineMatch, PENDING } from './onlinematch.js';
import { kopplaKortlupp, reduceMotion } from './kortlupp.js';
import { kopplaNedrakning, klockrad } from './nedrakning.js';
import { PROTOCOL_VERSION, RECEIPT, MATCH_COMMAND as C, TEAMS, PLAYER_STATUS, CONNECTION, TEAM_FORMAT, TEAM_MATCH_PHASE as FAS, TEAM_OUTCOME as UTFALL, TEAM_END, ELIMINATION } from './kontrakt.js';

const sound = new GameAudio();
bindAudioControls(sound);

const $ = id => document.getElementById(id);
const html = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const HEART = '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 20.6S3.4 15.3 3.4 9.4A4.6 4.6 0 0 1 12 6.9a4.6 4.6 0 0 1 8.6 2.5c0 5.9-8.6 11.2-8.6 11.2z"/></svg>';
const TORN = { A: 'assets/torn/torn-rod.png', B: 'assets/torn/torn-bla.png' };
const cardType = id => cards.find(card => card.id === id);

let adapter = null;
let v = null;   // senaste privata vyn från servern
const ui = {
  selected: [],          // markerade exemplar (byte: flera; annars ett)
  usage: USAGE.normal,   // vanlig eller enkel attack
  target: null,          // vald måltavla under målval
  cardTarget: null,      // valt attackkort för Barriär, Försegling eller Spegelsköld
  playerTarget: null,    // vald anfallare för Törnesköld
  notice: null,          // { text, kind }
  selKey: null,          // läget som markeringarna gäller
  utslagsKey: null       // för att stänga hjälprutor när jag slås ut
};

/* ---- Härledningar ur vyn ---- */
const playerOf = id => v.players.find(p => p.id === id);
const alive = p => p?.status === PLAYER_STATUS.alive;
const iAmAlive = () => alive(playerOf(v.viewer));
const teamName = id => TEAMS.find(t => t.id === id)?.name ?? '';
const otherTeam = id => id === 'A' ? 'B' : 'A';
const allowedOf = type => v.allowed.find(a => a.type === type);
const can = type => Boolean(allowedOf(type));
const running = () => ![FAS.over, FAS.error].includes(v.phase);
const cardInHand = id => v.me.hand.find(c => c.instanceId === id);
const selectedCard = () => ui.selected.length === 1 ? cardInHand(ui.selected[0]) : null;
/* Namn i löptext (oescapade; escapas där de sätts in). Den egna spelaren heter "du"/"Du"/"dig". */
const namn = id => id === v.viewer ? 'du' : playerOf(id)?.name ?? '?';
const Namn = id => id === v.viewer ? 'Du' : namn(id);
/* "Anna, Bo och dig" (objekt) eller "Anna och du" (subjekt, först i meningen). */
function lista(ids, { subjekt = false } = {}) {
  const delar = ids.map(id => id === v.viewer ? (subjekt ? 'du' : 'dig') : playerOf(id)?.name ?? '?');
  const text = delar.length > 1 ? `${delar.slice(0, -1).join(', ')} och ${delar.at(-1)}` : delar[0] ?? 'ingen';
  return subjekt && text.startsWith('du') ? `D${text.slice(1)}` : text;
}
/* Lagets nästa startspelare: första levande från lagets pekare i fast ordning (samma som servern visar). */
function ledare(team) {
  const order = v.teams[team];
  const start = Math.max(0, order.indexOf(v.nextLeader[team]));
  return [...order.slice(start), ...order.slice(0, start)].find(id => alive(playerOf(id))) ?? null;
}
/* Egen nedräkning (L16): bara när servern väntar på just mig. */
const minKlocka = () => v.deadline && iAmAlive() && running() ? klockrad(v.viewer, { varning: 'kvar – välj nu, annars slås du ut' }) : '';
const utslagText = p => ({ [ELIMINATION.left]: 'Du lämnade matchen.', [ELIMINATION.life]: 'Ditt torn har fallit.', [ELIMINATION.timeout]: 'Tiden för ditt val tog slut.', [ELIMINATION.disconnect]: 'Du kom inte tillbaka i tid.' })[p?.eliminationReason] ?? 'Ditt torn har fallit.';

function resultTitle(r) {
  if (r.outcome === UTFALL.aborted) return 'Striden avbröts';
  return r.outcome === UTFALL.held ? 'Försvaret håller' : `${Namn(r.target)} träffas`;
}
function resultLine(r) {
  if (r.outcome === UTFALL.aborted) return `${Namn(r.target)} lämnade striden – ingen skada, läkning eller motstöt.`;
  return `Attack ${r.attack} mot försvar ${r.defence}.`;
}
function overTitle() {
  if (!v.winnerTeam) return 'Ingen vann matchen';
  return v.winnerTeam === v.teamId ? 'Ditt lag vinner matchen!' : `${teamName(v.winnerTeam)} vinner matchen`;
}
function overText() {
  if (v.endReason === TEAM_END.noPlayers || !v.winnerTeam) return 'Matchen avbröts utan vinnare: alla spelare har lämnat eller slagits ut.';
  const forlorare = otherTeam(v.winnerTeam);
  const egen = !iAmAlive() && v.winnerTeam === v.teamId ? ' Du var utslagen, men laget tog hem segern.' : '';
  return `${teamName(forlorare)} har inga torn kvar efter ${v.battleNumber} strider.${egen}`;
}

/* "Just nu: attack 7 mot försvar 5 – anfallet går igenom om inget mer läggs." */
function lageNu() {
  const p = v.battle?.preview;
  return p ? ` Just nu: attack ${p.attack} mot försvar ${p.defence} – ${p.defended ? 'försvaret håller' : 'anfallet går igenom'} om inget mer läggs.` : '';
}

function phaseText() {
  const b = v.battle, r = v.lastResult;
  switch (v.phase) {
    case FAS.swap: return { title: `Startbyten – omgång ${v.swap.round} av ${v.swap.rounds}`, text: v.swap.mine ? `Väntar på ${lista(v.swap.waitingFor)}.` : `Alla byter samtidigt. Markera upp till ${v.swap.maxCards} kort eller behåll handen.` };
    case FAS.start: return { title: `${teamName(v.attackingTeam)} anfaller först`, text: `${Namn(ledare(v.attackingTeam))} väljer måltavla när alla har bekräftat.${v.confirm?.mine ? ` Väntar på ${lista(v.confirm.waitingFor)}.` : ''}` };
    case FAS.target: return { title: `Strid ${v.battleNumber}: ${teamName(b.attackingTeam)} anfaller`, text: b.leader === v.viewer ? 'Du väljer vilket fiendetorn ni anfaller.' : `${Namn(b.leader)} väljer måltavla.` };
    case FAS.attack: return { title: `Strid ${v.battleNumber}: anfall mot ${namn(b.target)}`, text: `${v.activePlayer === v.viewer ? 'Din tur: lägg ett kort eller avstå.' : `${Namn(v.activePlayer)} väljer anfall.`}${b.preview ? ` Lagets attack hittills: ${b.preview.attack}.` : ''}` };
    case FAS.defence: return {
      title: `Strid ${v.battleNumber}: ${b.target === v.viewer ? 'du försvarar' : `${namn(b.target)} försvarar`}`,
      text: `${v.activePlayer === v.viewer ? (b.target === v.viewer ? 'Försvara ditt torn eller avstå.' : `Hjälp ${namn(b.target)} eller avstå.`) : `${Namn(v.activePlayer)} ${v.activePlayer === b.target ? 'försvarar sitt torn' : 'väljer om hen hjälper till'}.`}${lageNu()}`
    };
    case FAS.result: return { title: resultTitle(r), text: `${resultLine(r)} ${v.confirm?.mine ? `Väntar på ${lista(v.confirm.waitingFor)}.` : 'Tryck Fortsätt för nästa strid.'}` };
    case FAS.over: return { title: overTitle(), text: overText() };
    case FAS.error: return { title: 'Matchen har stoppats', text: 'Ett internt fel stoppade matchen. Ingen vann.' };
    default: return { title: '', text: '' };
  }
}

/* ---- Lagbordet ---- */
const hearts = life => `<span class="hearts" role="img" aria-label="${life} av ${MAX_LIFE} liv">${Array.from({ length: MAX_LIFE }, (_, n) => `<span aria-hidden="true" class="${n < life ? '' : 'lost'}">${HEART}</span>`).join('')}</span>`;

function chipStatus(p) {
  if (!alive(p)) return ({ [ELIMINATION.left]: 'Lämnade matchen', [ELIMINATION.timeout]: 'Utslagen – tiden tog slut', [ELIMINATION.disconnect]: 'Utslagen – kom inte tillbaka' })[p.eliminationReason] ?? 'Utslagen';
  const b = v.battle;
  const delar = [];
  if (b?.target === p.id) delar.push('Måltavla');
  if (v.activePlayer === p.id) delar.push(v.phase === FAS.target ? 'Väljer måltavla' : v.phase === FAS.attack ? 'Väljer anfall' : b?.target === p.id ? 'Försvarar' : 'Väljer hjälp');
  else if (b?.leader === p.id) delar.push('Startspelare');
  if (v.confirm?.waitingFor.includes(p.id) || v.swap?.waitingFor.includes(p.id)) delar.push('Inte klar');
  if (p.connection !== CONNECTION.online) delar.push('Frånkopplad');
  return delar.join(' · ');
}

function chip(p, { valbar }) {
  const klass = ['tower-chip'];
  if (p.id === v.viewer) klass.push('me');
  if (v.activePlayer === p.id) klass.push('active');
  if (v.battle?.target === p.id) klass.push('target');
  if (!alive(p)) klass.push('out');
  if (p.connection !== CONNECTION.online) klass.push('offline');
  const status = chipStatus(p);
  const inner = `<img src="${TORN[p.teamId]}" alt="" width="280" height="320"><span class="chip-text"><strong>${html(p.name)}${p.id === v.viewer ? ' <em>(du)</em>' : ''}</strong>${hearts(p.life)}<small>${alive(p) ? `${p.cardCount} kort` : ''}${status ? `${alive(p) ? ' · ' : ''}${html(status)}` : ''}${alive(p) ? `<span class="chip-clock" data-klocka="${html(p.id)}" hidden></span>` : ''}</small></span>`;
  return valbar
    ? `<li><button type="button" class="${klass.join(' ')} selectable" data-target="${html(p.id)}" aria-pressed="${ui.target === p.id}" aria-label="Välj ${html(p.name)} som måltavla, ${p.life} liv">${inner}</button></li>`
    : `<li class="${klass.join(' ')}">${inner}</li>`;
}

function spelatKort(entry, { stoppad = false } = {}) {
  const type = cardType(entry.cardId);
  const simple = entry.usage === USAGE.simple;
  return `<div class="mini-card ${type.type}${stoppad ? ' stopped' : ''}" data-card="${type.id}"${simple ? ' data-simple="true"' : ''} aria-label="${html(type.name)}${simple ? ' som enkel attack 1' : ''}${stoppad ? ', stoppat' : ''}">${cardFace(type, { simple })}</div>`;
}
function malText(entry, table) {
  if (entry.targetCard) {
    const t = table.find(e => e.instanceId === entry.targetCard);
    return t ? `→ ${cardType(t.cardId).name} (${namn(t.playerId)})` : '→ målkortet är borta';
  }
  return entry.targetPlayer ? `→ motstöt mot ${namn(entry.targetPlayer)}` : '';
}

/* Vad ett kort räknas som just nu (förhandsvisning) eller räknades som (resultat): stopp, spegling,
   bonus eller ett annat värde än det tryckta. `info` är beräkningens rad för exemplaret. */
function kortNot(entry, info, table) {
  const kort = id => { const e = table.find(t => t.instanceId === id); return e ? `${cardType(e.cardId).name} (${namn(e.playerId)})` : null; };
  const type = cardType(entry.cardId);
  const tryckt = entry.role === 'attack' ? (entry.usage === USAGE.simple ? 1 : type.attack ?? 0) : type.defence ?? 0;
  const delar = [];
  if (info?.stoppedBy?.length) delar.push(`Stoppad av ${info.stoppedBy.map(kort).filter(Boolean).join(', ') || 'ett kort'}`);
  else if (info?.mirrorOf) delar.push(`Speglar ${kort(info.mirrorOf) ?? 'kortet'}: ${info.value}`);
  else if (info?.bonus) delar.push(`Räknas ${info.value} (+${info.bonus})`);
  else if (info && info.value !== tryckt) delar.push(`Räknas ${info.value}`);
  if (!info?.mirrorOf) { const mal = malText(entry, table); if (mal) delar.push(mal); }
  return delar.join(' · ');
}
const stoppad = (entry, info) => Boolean(info?.stoppedBy?.length);

/* Kön för en sida under en öppen strid: vem som lagt vad, vem som avstod och vem som väljer nu. */
function koLista(role) {
  const b = v.battle;
  const queue = role === 'attack' ? b.attackQueue : b.defenceQueue;
  const index = role === 'attack' ? b.attackIndex : b.defenceIndex;
  const fas = role === 'attack' ? FAS.attack : FAS.defence;
  if (!queue.length) return `<li class="empty-note">${role === 'defence' ? (b.target ? `${html(Namn(b.target))} försvarar först, sedan lagkamraterna.` : 'Väntar på måltavla.') : 'Startspelaren väljer måltavla.'}</li>`;
  return queue.map((id, i) => {
    const entry = b.table.find(e => e.playerId === id && e.role === role);
    const turn = b.turns.find(t => t.playerId === id && t.role === role);
    const nu = v.phase === fas && i === index && !entry && !turn;
    const info = entry ? b.preview?.cards[entry.instanceId] : null;
    const body = entry ? spelatKort(entry, { stoppad: stoppad(entry, info) })
      : turn?.instanceId === null ? '<span class="queue-state passed">Avstod</span>'
      : turn ? '<span class="queue-state passed">Kortet togs bort</span>'
      : nu ? '<span class="queue-state now">Väljer nu …</span>'
      : '<span class="queue-state">Väntar</span>';
    const note = entry ? kortNot(entry, info, b.table) : '';
    return `<li class="queue-item${nu ? ' now' : ''}"><span class="queue-name">${html(Namn(id))}${role === 'defence' && id === b.target ? ' · måltavla' : ''}</span>${body}${note ? `<span class="queue-note">${html(note)}</span>` : ''}</li>`;
  }).join('');
}
/* Efter avgörandet: korten som räknades, med stoppade kort markerade. */
function resultatLista(role) {
  const r = v.lastResult;
  const entries = r.table.filter(e => e.role === role);
  if (!entries.length) return `<li class="empty-note">${role === 'attack' ? 'Inga anfallskort kvar' : 'Inget försvar'}</li>`;
  return entries.map(e => {
    const info = r.cards?.[e.instanceId];
    const ar = stoppad(e, info) || r.stopped.includes(e.instanceId);
    const note = kortNot(e, info, r.table) || (ar ? 'Stoppad' : '');
    return `<li class="queue-item"><span class="queue-name">${html(Namn(e.playerId))}</span>${spelatKort(e, { stoppad: ar })}${note ? `<span class="queue-note${ar ? ' stopped-note' : ''}">${html(note)}</span>` : ''}</li>`;
  }).join('');
}

function renderBoard() {
  const mitt = v.teamId, fiende = otherTeam(mitt);
  const valbara = new Set(allowedOf(C.target)?.players ?? []);
  const kvar = team => v.teams[team].filter(id => alive(playerOf(id))).length;
  $('enemy-name').textContent = `${teamName(fiende)} · ${kvar(fiende)} av ${v.teams[fiende].length} kvar`;
  $('own-name').textContent = `${teamName(mitt)} · ditt lag · ${kvar(mitt)} av ${v.teams[mitt].length} kvar`;
  $('enemy-towers').innerHTML = v.teams[fiende].map(id => chip(playerOf(id), { valbar: valbara.has(id) })).join('');
  $('own-towers').innerHTML = v.teams[mitt].map(id => chip(playerOf(id), { valbar: false })).join('');
  const { title, text } = phaseText();
  $('phase-title').textContent = title;
  $('phase-description').textContent = text;
  const n = v.players.length / 2;
  $('match-label').textContent = `LAGMATCH ${n} MOT ${n}${v.battleNumber ? ` · STRID ${v.battleNumber}` : ''}`;
  $('rules-label').textContent = `Regler ${v.rulesVersion} · Kortlek ${v.deckVersion} · draghög ${v.drawPileCount} kort, slänghög ${v.discardPileCount} kort.`;
  const visaResultat = [FAS.result, FAS.over].includes(v.phase) && v.lastResult && (v.phase === FAS.result || v.lastResult.battleNumber === v.battleNumber);
  const strid = Boolean(v.battle) || visaResultat;
  document.querySelector('.team-board').classList.toggle('no-battle', !strid);
  /* Summor och avdrag: förhandsvisning under striden (samma beräkning som avgörandet), slutvärden efteråt. */
  const summor = (berakning, { forsvar = true } = {}) => {
    $('attack-total').textContent = berakning ? String(berakning.attack) : '';
    $('defence-total').textContent = berakning && forsvar ? String(berakning.defence) : '';
    $('attack-deduction').textContent = berakning?.deductions?.frost ? `−${berakning.deductions.frost} Isrustning` : '';
    $('defence-deduction').textContent = berakning?.deductions?.pierce ? `−${berakning.deductions.pierce} Sprängladdning` : '';
  };
  if (v.battle) {
    $('attack-cards').innerHTML = koLista('attack');
    $('defence-cards').innerHTML = koLista('defence');
    summor(v.battle.preview, { forsvar: v.phase === FAS.defence });
  } else if (visaResultat) {
    $('attack-cards').innerHTML = resultatLista('attack');
    $('defence-cards').innerHTML = resultatLista('defence');
    summor(v.lastResult.outcome === UTFALL.aborted ? null : v.lastResult);
  } else {
    for (const id of ['attack-cards', 'defence-cards']) $(id).textContent = '';
    summor(null);
  }
}

/* ---- Handen: byggs om bara när exemplar, fas eller användning ändras; nya kort delas ut med en animation ---- */
let handKey = null;
let shownIds = new Set();
const canChoose = () => can(C.swap) || can(C.attack) || can(C.defend);
function usableNow(instanceId) {
  if (can(C.swap)) return true;
  const a = allowedOf(C.attack);
  if (a) return (ui.usage === USAGE.simple ? a.simple : a.normal).some(c => c.instanceId === instanceId);
  const d = allowedOf(C.defend);
  if (d) return d.cards.some(c => c.instanceId === instanceId);
  return false;
}
function renderHand() {
  const interactive = canChoose();
  const key = `${v.me.hand.map(c => c.instanceId).join(',')}|${v.phase}|${ui.usage}|${interactive}`;
  if (key !== handKey) {
    const scrollLeft = $('hand').scrollLeft;
    handKey = key;
    let dealt = 0;
    $('hand').innerHTML = v.me.hand.map(({ instanceId, cardId }) => {
      const type = cardType(cardId);
      const usable = interactive && usableNow(instanceId);
      const fresh = !shownIds.has(instanceId);
      return `<button type="button" class="mini-card ${type.type}${usable ? '' : ' unusable'}${fresh ? ' dealt' : ''}"${fresh ? ` style="animation-delay:${dealt++ * 80}ms"` : ''} data-instance="${html(instanceId)}" data-card="${type.id}" aria-pressed="false" aria-label="${html(type.name)}, ${html(type.valueLabel)} ${html(type.value)}${interactive && !usable ? ', kan inte spelas just nu' : ''}">${cardFace(type)}<span class="swap-mark" hidden>Byts</span></button>`;
    }).join('');
    $('hand').scrollLeft = scrollLeft;
    shownIds = new Set(v.me.hand.map(c => c.instanceId));
  }
  for (const el of $('hand').querySelectorAll('button')) {
    const chosen = ui.selected.includes(el.dataset.instance);
    el.setAttribute('aria-pressed', String(chosen));
    el.classList.toggle('inactive', !interactive);
    el.setAttribute('aria-disabled', String(!interactive || el.classList.contains('unusable')));
    el.querySelector('.swap-mark').hidden = !(chosen && v.phase === FAS.swap);
  }
  const b = v.battle;
  $('hand-owner').textContent = `DINA KORT · ${playerOf(v.viewer).name.toUpperCase()}`;
  $('hand-heading').textContent = !iAmAlive() ? 'Du är utslagen'
    : can(C.swap) ? 'Välj kort att byta'
    : can(C.attack) ? 'Välj ditt anfall'
    : can(C.defend) ? (b?.target === v.viewer ? 'Försvara ditt torn' : `Hjälp ${namn(b?.target)}`)
    : 'Dina kort';
  $('hand-count').textContent = `${v.me.hand.length} kort`;
}

/* ---- Knappraden ovanför handen ---- */
function renderActions() {
  const pending = Boolean(v.pending);
  const knapp = (id, action, label, { kind = 'primary', disabled = false } = {}) => `<button type="button" id="${id}" class="${kind}" data-action="${action}"${disabled || pending ? ' disabled' : ''}>${label}</button>`;
  const vanta = () => { const { title, text } = phaseText(); return `<h3>${html(title)}</h3><p>${html(text)} Håll in ett kort för att läsa det medan du väntar.</p>`; };
  const b = v.battle;
  let info = '', choices = null, usage = false, actions = '';

  if (!iAmAlive() && running()) {
    info = `<h3>Du är utslagen – laget spelar vidare</h3><p>${html(utslagText(v.me))} Du kan följa matchen här eller gå till lobbyn.</p>`;
    actions = knapp('to-lobby-bar', 'lobby', 'Till lobbyn', { kind: 'secondary' });
  } else switch (v.phase) {
    case FAS.swap: {
      if (can(C.swap)) {
        const n = ui.selected.length, max = v.swap.maxCards;
        const pick = selectedCard();
        info = `<h3>Välj upp till ${max} kort · ${n}/${max} valda</h3><p>Omgång ${v.swap.round} av ${v.swap.rounds}. ${pick ? html(cardType(pick.cardId).effect) : 'Tryck på ett kort för att markera det, igen för att ångra. Alla byter samtidigt.'}</p>`;
        actions = knapp('keep-hand', 'keep', 'Behåll handen', { kind: 'secondary' }) + knapp('confirm-swap', 'swap', n ? `Byt ${n} kort` : 'Byt kort', { disabled: !n });
      } else info = `<h3>Du är klar med omgång ${v.swap.round}</h3><p>Väntar på ${html(lista(v.swap.waitingFor))}.</p>`;
      break;
    }
    case FAS.start: {
      info = `<h3>${html(teamName(v.attackingTeam))} anfaller först</h3><p>${html(Namn(ledare(v.attackingTeam)))} väljer måltavla. ${v.confirm?.mine ? `Väntar på ${html(lista(v.confirm.waitingFor))}.` : 'Striden börjar när alla har bekräftat.'}</p>`;
      actions = knapp('confirm-start', 'start', v.confirm?.mine ? 'Väntar …' : 'Börja striden', { disabled: !can(C.confirmStart) });
      break;
    }
    case FAS.target: {
      const t = allowedOf(C.target);
      if (t) {
        info = `<h3>Välj måltavla</h3><p>Vilket fiendetorn ska ${html(teamName(v.teamId))} anfalla? Tryck på ett namn här eller på ett torn på bordet.</p>`;
        choices = t.players.map(id => { const p = playerOf(id); return `<button type="button" class="choice" data-target="${html(id)}" aria-pressed="${ui.target === id}">${html(p.name)}<small>${p.life} liv · ${p.cardCount} kort</small></button>`; }).join('');
        const ok = t.players.includes(ui.target);
        actions = knapp('confirm-target', 'target', ok ? `Anfall ${html(playerOf(ui.target).name)}` : 'Anfall', { disabled: !ok });
      } else info = vanta();
      break;
    }
    case FAS.attack: {
      const a = allowedOf(C.attack);
      if (a) {
        usage = true;
        const pick = selectedCard();
        const type = pick && cardType(pick.cardId);
        const ok = Boolean(pick && usableNow(pick.instanceId));
        const passOk = can(C.passAttack);
        const maste = passOk ? '' : '<p class="invalid">Laget har inte lagt något kort – du måste bidra. Alla kort kan spelas som enkel attack 1.</p>';
        const hint = type && !ok ? '<p class="invalid">Välj ”Enkel attack 1” för att anfalla med det här kortet.</p>' : '';
        info = `<h3>${type ? html(type.name) : `Ditt anfall mot ${html(namn(b.target))}`}</h3>${hint || `<p>${type ? (ui.usage === USAGE.simple ? 'Vanlig attack 1, utan specialeffekt.' : html(type.effect)) : `Välj ett kort i handen.${passOk ? ' Du kan också avstå.' : ''}`}</p>`}${maste}`;
        actions = (passOk ? knapp('confirm-pass-attack', 'pass-attack', 'Avstå anfall', { kind: 'secondary' }) : '') + knapp('confirm-attack', 'attack', ok ? `Anfall med ${html(type.name)}${ui.usage === USAGE.simple ? ' (attack 1)' : ''}` : 'Anfall', { disabled: !ok });
      } else info = vanta();
      break;
    }
    case FAS.defence: {
      const d = allowedOf(C.defend);
      if (d) {
        const pick = selectedCard();
        const type = pick && cardType(pick.cardId);
        const option = pick ? d.cards.find(c => c.instanceId === pick.instanceId) : null;
        const sjalv = b.target === v.viewer;
        const kortmal = option?.cardTargets?.length ? option.cardTargets : null;
        const spelarmal = option?.playerTargets?.length ? option.playerTargets : null;
        if (kortmal) choices = kortmal.map(id => { const e = b.table.find(t => t.instanceId === id); const t = cardType(e.cardId); return `<button type="button" class="choice" data-card-target="${html(id)}" aria-pressed="${ui.cardTarget === id}">${html(t.name)}<small>${html(Namn(e.playerId))}${e.usage === USAGE.simple ? ' · enkel attack 1' : ` · ${html(t.value)}`}</small></button>`; }).join('');
        if (spelarmal) choices = spelarmal.map(id => { const p = playerOf(id); return `<button type="button" class="choice" data-player-target="${html(id)}" aria-pressed="${ui.playerTarget === id}">${html(p.name)}<small>${p.life} liv</small></button>`; }).join('');
        const valt = kortmal ? kortmal.includes(ui.cardTarget) : spelarmal ? spelarmal.includes(ui.playerTarget) : true;
        const ok = Boolean(option) && valt;
        const malHjalp = kortmal ? `<p>Välj vilket attackkort ${html(type.name)} ska ${type.cancel ? 'stoppa' : type.ability === 'seal' ? 'försegla' : 'spegla'}.</p>`
          : spelarmal ? '<p>Välj vilken anfallare Törneskölden ska träffa om försvaret håller.</p>'
          : option && (type.ability === 'seal' || type.ability === 'mirror') ? `<p>Inget magiskt attackkort finns att ${type.ability === 'seal' ? 'försegla' : 'spegla'} – kortet ger försvar ${type.defence}.</p>` : '';
        const hint = type && !option ? '<p class="invalid">Kortet kan inte försvara just nu. Välj ett annat kort eller avstå.</p>' : '';
        info = `<h3>${type ? html(type.name) : sjalv ? 'Försvara ditt torn' : `Hjälp ${html(namn(b.target))}`}</h3>${hint || (type ? `<p>${html(type.effect)}</p>${malHjalp}` : `<p>${sjalv ? 'Du försvarar först.' : `${html(Namn(b.target))} är måltavla.`}${html(lageNu())} Lika hög eller högre sammanlagd försvarsstyrka stoppar anfallet.</p>`)}`;
        actions = knapp('confirm-pass', 'pass', sjalv ? 'Avstå försvar' : 'Avstå – hjälp inte', { kind: 'secondary' }) + knapp('confirm-defend', 'defend', ok ? `${sjalv ? 'Försvara' : 'Hjälp'} med ${html(type.name)}` : sjalv ? 'Försvara' : 'Hjälp till', { disabled: !ok });
      } else info = vanta();
      break;
    }
    case FAS.result: {
      const r = v.lastResult;
      info = `<h3>${html(resultTitle(r))}</h3><p>${html(resultLine(r))}${v.confirm?.mine ? ` Väntar på ${html(lista(v.confirm.waitingFor))}.` : ''}</p>`;
      actions = knapp('confirm-next', 'next', v.confirm?.mine ? 'Väntar …' : 'Fortsätt <span aria-hidden="true">→</span>', { disabled: !can(C.next) });
      break;
    }
    default: {
      const { title, text } = phaseText();
      info = `<h3>${html(title)}</h3><p>${html(text)}</p>`;
      actions = knapp('to-lobby-bar', 'lobby', 'Till lobbyn');
    }
  }
  /* Egen nedräkning överst: bara när servern väntar på just mig (L16). */
  $('action-info').innerHTML = minKlocka() + info;
  $('choices').innerHTML = choices ?? '';
  $('choices').hidden = !choices;
  $('choices').setAttribute('aria-label', v.phase === FAS.target ? 'Välj måltavla' : 'Välj mål för kortet');
  $('usage').hidden = !usage;
  $('usage-normal').setAttribute('aria-pressed', String(ui.usage === USAGE.normal));
  $('usage-simple').setAttribute('aria-pressed', String(ui.usage === USAGE.simple));
  $('actions').innerHTML = actions;
}

/* ---- Resultatrutan: en gång per avgjord strid och vid matchslut. Lagets resultat och den egna
   utslagningen står på var sin rad. ---- */
let resultKey = null;
let vantandeResultat = false;
function resultatEffekt(over) {
  if (over) return v.winnerTeam ? (v.winnerTeam === v.teamId ? 'matchWon' : 'matchLost') : null;
  const r = v.lastResult;
  if (r.outcome === UTFALL.aborted) return null;
  if ((r.lifeDelta[v.viewer] ?? 0) < 0) return 'lifeLost';
  const vann = r.outcome === UTFALL.hit ? r.attackingTeam : otherTeam(r.attackingTeam);
  return vann === v.teamId ? 'battleWon' : null;
}
function resultatHTML() {
  const r = v.lastResult;
  const over = v.phase === FAS.over;
  const stridVisas = r && (!over || r.battleNumber === v.battleNumber);
  const kind = over ? (v.winnerTeam && v.winnerTeam === v.teamId ? 'victory' : 'defeat') : r.outcome === UTFALL.hit ? 'hit' : 'held';
  const delar = [];
  if (stridVisas) {
    if (r.outcome === UTFALL.aborted) delar.push(`<p>${html(Namn(r.target))} lämnade striden. Ingen skada, läkning eller motstöt – de spelade korten slängs.</p>`);
    else {
      delar.push(`<div class="result-score" role="group" aria-label="Stridens slutliga styrkor"><div class="score-side score-attack"><span>Attack</span><strong>${r.attack}</strong><small>${html(teamName(r.attackingTeam))}</small></div>${popupIcon('swords')}<div class="score-side score-defence"><span>Försvar</span><strong>${r.defence}</strong><small>${html(Namn(r.target))} och laget</small></div></div>`);
      const kortrad = role => {
        const list = r.table.filter(e => e.role === role);
        return list.length ? list.map(e => { const not = kortNot(e, r.cards?.[e.instanceId], r.table); return `<li>${html(Namn(e.playerId))}: ${html(cardType(e.cardId).name)}${e.usage === USAGE.simple ? ' (enkel attack 1)' : ''}${not ? ` – ${html(not)}` : ''}</li>`; }).join('') : `<li>${role === 'attack' ? 'Inga anfallskort kvar' : 'Ingen försvarade'}</li>`;
      };
      delar.push(`<div class="team-cards"><div><h4>Anfall</h4><ul>${kortrad('attack')}</ul></div><div><h4>Försvar</h4><ul>${kortrad('defence')}</ul></div></div>`);
      const avdrag = [r.deductions?.frost ? `Isrustning sänkte attacken med ${r.deductions.frost}.` : '', r.deductions?.pierce ? `Sprängladdning sänkte försvaret med ${r.deductions.pierce}.` : ''].filter(Boolean);
      if (avdrag.length) delar.push(`<p class="life-lines">${html(avdrag.join(' '))}</p>`);
      const liv = Object.entries(r.lifeDelta).filter(([, d]) => d).map(([id, d]) => `${Namn(id)} ${d < 0 ? `förlorar ${-d} liv` : `får tillbaka ${d} liv`} (${r.life[id]} kvar).`);
      if (liv.length) delar.push(`<p class="life-lines">${liv.map(html).join(' ')}</p>`);
      if (r.eliminated.length) delar.push(`<p class="life-lines">${html(lista(r.eliminated, { subjekt: true }))} ${r.eliminated.length > 1 ? 'är utslagna' : 'är utslagen'}.</p>`);
      delar.push(`<details><summary>Hela beräkningen</summary><ul>${r.events.map(e => `<li>${html(e)}</li>`).join('')}</ul></details>`);
    }
    if (!over && r.eliminated.includes(v.viewer)) delar.push('<p class="personal"><strong>Du är utslagen – laget spelar vidare.</strong> Du kan följa matchen eller gå till lobbyn.</p>');
  } else if (over) delar.push(`<p>${html(overText())}</p>`);
  if (over) {
    delar.push(`<p class="winner"><strong>${html(overTitle())}</strong></p>`);
    if (stridVisas) delar.push(`<p>${html(overText())}</p>`);
  }
  return `${resultHeader(kind, over ? overTitle() : resultTitle(r), over)}<div class="popup-result-body">${delar.join('')}</div>`;
}
function renderResult() {
  const dialog = $('result-dialog');
  const over = v.phase === FAS.over;
  if (!(over || (v.phase === FAS.result && v.lastResult))) {
    resultKey = null;
    vantandeResultat = false;
    if (dialog.open) dialog.close();
    return;
  }
  $('result').innerHTML = resultatHTML();
  dialog.dataset.outcome = over ? (v.winnerTeam === v.teamId ? 'victory' : 'defeat') : v.lastResult.outcome === UTFALL.hit ? 'hit' : 'held';
  const pending = Boolean(v.pending);
  $('dialog-actions').innerHTML = over
    ? `<button type="button" id="dialog-lobby" class="primary" data-action="lobby">Till lobbyn</button>`
    : `${minKlocka()}<button type="button" id="dialog-next" class="primary" data-action="next"${!can(C.next) || pending ? ' disabled' : ''}>${v.confirm?.mine ? `Väntar på ${html(lista(v.confirm.waitingFor))} …` : 'Fortsätt <span aria-hidden="true">→</span>'}</button>`;
  const key = over ? `${v.matchId}|slut` : `${v.matchId}|${v.lastResult.battleNumber}`;
  if (key === resultKey) return;
  resultKey = key;
  const effekt = resultatEffekt(over);
  if (effekt) { sound.stopEffects(); sound.playEffect(effekt); }
  vantandeResultat = true;
  oppnaResultat();
}
const HJALPRUTOR = ['intro-dialog', 'confirm-dialog', 'card-dialog', 'sound-dialog'];
function oppnaResultat() {
  if (!vantandeResultat || !resultKey) return;
  if (v.phase === FAS.over) for (const id of HJALPRUTOR) if ($(id).open) $(id).close();   // matchslutet ska synas direkt (L16)
  if (HJALPRUTOR.some(id => $(id).open)) return;   // öppnas när rutan stängts
  vantandeResultat = false;
  if (!$('result-dialog').open) $('result-dialog').showModal();
}

/* ---- Kort återkoppling när det blir min tur ---- */
let feedbackKey = null;
let feedbackTimer = null;
function renderTurnFeedback() {
  const banner = $('turn-feedback');
  const mine = v.activePlayer === v.viewer && [FAS.target, FAS.attack, FAS.defence].includes(v.phase);
  const key = mine ? `${v.matchId}|${v.battleNumber}|${v.phase}` : null;
  if (key === feedbackKey) return;
  feedbackKey = key;
  clearTimeout(feedbackTimer);
  banner.hidden = true;
  if (!mine) return;
  const b = v.battle;
  const label = v.phase === FAS.target ? 'Du väljer måltavla!' : v.phase === FAS.attack ? 'Din tur att anfalla!' : b.target === v.viewer ? 'Du blir anfallen!' : `Hjälp ${namn(b.target)}!`;
  banner.dataset.tone = v.phase === FAS.defence ? 'defence' : 'attack';
  banner.innerHTML = `<small>STRID ${v.battleNumber}</small>${html(label)}`;
  banner.hidden = false;
  if (!reduceMotion.matches) banner.animate([{ opacity: 0, translate: '0 -6px' }, { opacity: 1, translate: '0 0', offset: .15 }, { opacity: 1, offset: .8 }, { opacity: 0 }], { duration: 1800, easing: 'ease-out', fill: 'forwards' });
  feedbackTimer = setTimeout(() => { banner.hidden = true; }, 1800);
}

function render() {
  sound.setPlaying(running());
  renderBoard();
  renderHand();
  renderActions();
  renderResult();
  renderTurnFeedback();
  const ute = !iAmAlive() || !running();
  $('leave-match').hidden = ute;
  $('to-lobby').hidden = !ute;
  $('log').innerHTML = v.log.map(line => `<li>${html(line)}</li>`).join('');
  const pendingText = v.pending?.status === PENDING.sending ? 'Skickar ditt drag …' : v.pending?.status === PENDING.checking ? 'Kontrollerar om draget registrerades …' : null;
  $('notice').textContent = ui.notice?.text ?? pendingText ?? '';
  $('notice').className = `notice${(ui.notice ? ui.notice.kind === 'info' : Boolean(pendingText)) ? ' info' : ''}`;
  for (const el of document.querySelectorAll('.dialog-clock')) el.dataset.klocka = v.viewer;
  /* Blir jag utslagen (t.ex. på tid) medan en hjälpruta är öppen ska beskedet synas direkt. */
  const utslagsKey = `${v.matchId}|${iAmAlive()}`;
  if (utslagsKey !== ui.utslagsKey) { if (ui.utslagsKey && !iAmAlive()) for (const id of HJALPRUTOR) if ($(id).open) $(id).close(); ui.utslagsKey = utslagsKey; }
  nedrakning();
}

/* Markeringar gäller ett visst läge; när läget byts (ny fas, ny strid, ny tur eller bytesomgång) nollställs de. */
function syncSelection() {
  const key = `${v.phase}|${v.battleNumber}|${v.activePlayer}|${v.swap?.round ?? ''}`;
  ui.selected = ui.selected.filter(id => cardInHand(id));
  if (key !== ui.selKey) Object.assign(ui, { selKey: key, selected: [], target: null, cardTarget: null, playerTarget: null, usage: USAGE.normal });
  rensaMal();
}

/* Ett mål gäller bara så länge servern fortfarande erbjuder det: ett avhopp kan ta bort målkortet, anfallaren
   eller måltavlan medan man väljer. Ett mål som inte längre finns släpps; finns bara ett giltigt mål väljs det
   (granskning L15: Spegelsköld fick annars behålla ett borttaget Drakeld och draget avvisades). */
function rensaMal() {
  if (!(allowedOf(C.target)?.players ?? []).includes(ui.target)) ui.target = null;
  const option = allowedOf(C.defend)?.cards.find(c => c.instanceId === ui.selected[0]) ?? null;
  const kortmal = option?.cardTargets ?? [], spelarmal = option?.playerTargets ?? [];
  if (!kortmal.includes(ui.cardTarget)) ui.cardTarget = kortmal.length === 1 ? kortmal[0] : null;
  if (!spelarmal.includes(ui.playerTarget)) ui.playerTarget = spelarmal.length === 1 ? spelarmal[0] : null;
}

/* Ljud för bekräftade händelser från servern (spelade kort, byten och påfyllning). */
function playEvents(events) {
  for (const e of events) {
    if (e.type === EVENT.cardPlayed) { sound.playEffect('card'); sound.playEffect(e.data.role === 'attack' ? (e.data.usage !== USAGE.simple && e.data.cardType === 'magic' ? 'magic' : 'attack') : 'defence'); }
    if ((e.type === EVENT.swap && e.data.count > 0) || e.type === EVENT.refill) sound.playEffect('shuffle');
  }
}

/* ---- Handlingar: vyn skickar ett kommando, servern avgör ---- */
async function send(type, payload = {}) {
  const receipt = await adapter.send({ protocolVersion: PROTOCOL_VERSION, commandId: crypto.randomUUID(), type, matchId: v.matchId, revision: v.revision, payload });
  if (receipt.status === RECEIPT.ok) Object.assign(ui, { selected: [], target: null, cardTarget: null, playerTarget: null, usage: USAGE.normal, notice: null });
  else ui.notice = { text: receipt.message ?? 'Draget kunde inte genomföras. Försök igen.', kind: 'error' };
  v = adapter.view();
  render();
  return receipt;
}

async function leaveToLobby() {
  try {
    const lobby = await (await fetch('/api/lobby', { credentials: 'same-origin' })).json();
    if (lobby.rum) await fetch('/api/kommando', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: crypto.randomUUID(), type: 'LÄMNA', roomId: lobby.rum.id, payload: {} }) });
  } catch { /* lobbyn visar läget ändå */ }
  adapter?.close();
  location.href = 'lobby.html';
}

function choose(instanceId) {
  if (!canChoose() || !cardInHand(instanceId)) return;
  ui.notice = null;
  if (can(C.swap)) {
    const max = v.swap.maxCards;
    if (ui.selected.includes(instanceId)) ui.selected = ui.selected.filter(id => id !== instanceId);
    else if (ui.selected.length >= max) ui.notice = { text: `Högst ${max} kort per bytesomgång. Avmarkera ett kort först.`, kind: 'error' };
    else ui.selected = [...ui.selected, instanceId];
  } else {
    ui.selected = ui.selected[0] === instanceId ? [] : [instanceId];
    ui.cardTarget = null;
    ui.playerTarget = null;
    rensaMal();   // finns bara ett möjligt mål väljs det direkt; det syns och kan inte bli fel
  }
  render();
}

const handlers = {
  keep: () => send(C.swap, { cards: [] }),
  swap: () => send(C.swap, { cards: [...ui.selected] }),
  start: () => send(C.confirmStart),
  target: () => send(C.target, { targetPlayerId: ui.target }),
  attack: () => send(C.attack, { instanceId: ui.selected[0], usage: ui.usage }),
  'pass-attack': () => send(C.passAttack),
  defend: () => { rensaMal(); return send(C.defend, { instanceId: ui.selected[0], ...(ui.cardTarget ? { targetInstanceId: ui.cardTarget } : {}), ...(ui.playerTarget ? { targetPlayerId: ui.playerTarget } : {}) }); },
  pass: () => send(C.pass),
  next: () => send(C.next),
  lobby: () => leaveToLobby()
};

function onClick(event) {
  const el = event.target.closest('[data-action], [data-target], [data-card-target], [data-player-target]');
  if (!el || el.disabled) return;
  if (el.dataset.target) { ui.target = el.dataset.target; render(); return; }
  if (el.dataset.cardTarget) { ui.cardTarget = el.dataset.cardTarget; render(); return; }
  if (el.dataset.playerTarget) { ui.playerTarget = el.dataset.playerTarget; render(); return; }
  el.disabled = true;   // spärr mot dubbelklick tills handlingen behandlats
  handlers[el.dataset.action]?.();
}

/* ---- Kortet förstorat med lagreglernas tillägg (14A–20A) ---- */
const LAGREGEL = {
  heal: 'Kan spelas för ditt eget torn eller som hjälp till en lagkamrat. Håller försvaret får du – kortets ägare – tillbaka ett liv, högst tre.',
  lifesteal: 'Går lagets anfall igenom får du – kortets ägare – tillbaka ett liv, högst tre. Ett stoppat eller borttaget kort läker inte.',
  thorns: 'Kan spelas som hjälp. Välj en fiende som lagt ett attackkort i striden; håller försvaret förlorar den spelaren ett liv.',
  frost: 'Kan spelas som hjälp. Sänker hela det anfallande lagets attack med 2.',
  pierce: 'Sänker hela det försvarande lagets försvar med 2.',
  mirror: 'Kan spelas som hjälp. Välj ett magiskt attackkort på bordet: försvaret blir lika starkt som det kortet. Utan giltigt mål ger kortet försvar 1.',
  seal: 'Kan spelas som hjälp. Välj ett magiskt attackkort på bordet att stoppa helt. Utan magiskt mål ger kortet försvar 2.',
  dragon: 'Får +2 om något vanligt blått försvarskort ligger på försvarssidan, även hos en hjälpare.',
  lastAttack: 'Bonusen gäller om du själv hade exakt ett liv när striden började.',
  lastDefence: 'Kan spelas som hjälp. Bonusen gäller om du själv hade exakt ett liv när striden började.'
};
const lagAnvandning = type => `Spelas när ${[type.attack ? 'ditt lag anfaller' : null, type.defence || type.cancel ? 'ditt lag försvarar – för ditt eget torn eller som hjälp' : null].filter(Boolean).join(' eller ')}.`;
function lagTillagg(type) {
  const text = type.cancel ? 'Kan spelas som hjälp. Välj ett attackkort på bordet som inte redan stoppats.' : LAGREGEL[type.ability];
  return text ? `<h4>I lagmatch</h4><p>${html(text)}</p>` : '';
}

const nedrakning = kopplaNedrakning({ klockor: () => v?.clocks, nu: () => adapter?.serverNu() ?? Date.now(), egen: () => v?.viewer, varna: text => { $('clock-alert').textContent = text; } });
const lupp = kopplaKortlupp({ behallare: [$('hand'), $('battlefield')], dialog: $('card-dialog'), detalj: $('card-detail'), anvandning: lagAnvandning, tillagg: lagTillagg });
$('hand').addEventListener('click', event => { const el = event.target.closest('[data-instance]'); if (el && !lupp.swallowed()) choose(el.dataset.instance); });
for (const id of ['action-bar', 'enemy-towers', 'dialog-actions']) $(id).addEventListener('click', onClick);
$('usage-normal').addEventListener('click', () => { ui.usage = USAGE.normal; render(); });
$('usage-simple').addEventListener('click', () => { ui.usage = USAGE.simple; render(); });
$('show-help').addEventListener('click', () => $('intro-dialog').showModal());
$('intro-close').addEventListener('click', () => $('intro-dialog').close());
$('leave-match').addEventListener('click', () => $('confirm-dialog').showModal());
$('to-lobby').addEventListener('click', leaveToLobby);
$('confirm-cancel').addEventListener('click', () => $('confirm-dialog').close());
$('confirm-leave').addEventListener('click', () => { $('confirm-dialog').close(); send(C.surrender); });
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => $(button.dataset.closeDialog).close()));
for (const id of ['intro-dialog', 'confirm-dialog', 'card-dialog', 'sound-dialog']) $(id).addEventListener('close', oppnaResultat);

/* ---- Start: hämta matchen; en duell har sin egen vy, utan match går man till lobbyn ---- */
const CONNECTION_TEXT = { ansluter: 'Ansluter …', ansluten: 'Ansluten', ateransluter: 'Återansluter …', ersatt: 'Öppen i en annan flik', utloggad: 'Sessionen har gått ut' };
async function boot() {
  let data;
  try {
    const response = await fetch('/api/match', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('ingen match');
    data = await response.json();
  } catch { location.replace('lobby.html'); return; }
  if (data.view.format !== TEAM_FORMAT) { location.replace('match.html?online=1'); return; }
  adapter = skapaOnlineMatch({ initial: data });
  adapter.pa((lage, extra) => {
    const node = $('connection');
    node.textContent = CONNECTION_TEXT[lage] ?? lage;
    node.classList.toggle('warn', lage !== 'ansluten');
    if (lage === 'utloggad') { location.replace('lobby.html'); return; }
    if (lage === 'ersatt') ui.notice = { text: 'Spelet är öppet i en annan flik. Ladda om sidan för att spela här.', kind: 'error' };
    if (extra) ui.notice = { text: extra, kind: 'error' };
    if (v) render();
  });
  v = adapter.view();
  $('intro-size').textContent = `${v.players.length / 2} mot ${v.players.length / 2}. Ett torn var. Tre liv. Ett lag vinner.`;
  adapter.subscribe((view, events) => {
    v = view;
    playEvents(events);
    syncSelection();
    render();
  });
  adapter.connect();
  syncSelection();
  $('intro-dialog').showModal();   // före första render(): resultatrutan väntar tills den stängts
  render();
}
boot();
