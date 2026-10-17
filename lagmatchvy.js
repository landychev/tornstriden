import { initLanguage } from './sprakval.js';
import { t as tr, source, message, cardText, language, onLanguageChange } from './sprak.js';
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
   spelares tid när servern väntar på hen (nedrakning.js). Servern avgör tidsgränsen.
   Avbrott (L17): en frånkopplad spelares torn visar återstående återanslutningstid; när just hens val behövs
   säger bordet "Väntar på att … återansluter". Den egna anslutningen visas i sidhuvudet.
   Ljud och animationer (L19): bara serverns nya händelser, högst en gång per händelse-ID. Egen livsförlust,
   lagets vunna strid och lagets matchresultat har var sitt ljud; en lagkamrats utslagning eller avhopp ger
   inget förlustljud. Det som redan hänt (sidladdning, återanslutning) är tyst och animeras inte. */
import { cards, MAX_LIFE } from './kort.js';
import { cardFace } from './grafik.js';
import { resultHeader, popupIcon } from './popup.js';
import { USAGE } from './matchregler.js';
import { GameAudio, bindAudioControls, skapaHandelsevakt, handelseljud, resultatljud } from './ljud.js';
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
const cardType = id => cardText(cards.find(card => card.id === id));

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
const teamName = id => tr(TEAMS.find(team => team.id === id)?.name ?? '');
const otherTeam = id => id === 'A' ? 'B' : 'A';
const allowedOf = type => v.allowed.find(a => a.type === type);
const can = type => Boolean(allowedOf(type));
const running = () => ![FAS.over, FAS.error].includes(v.phase);
const cardInHand = id => v.me.hand.find(c => c.instanceId === id);
const selectedCard = () => ui.selected.length === 1 ? cardInHand(ui.selected[0]) : null;
/* Namn i löptext (oescapade; escapas där de sätts in). Den egna spelaren heter "du"/"Du"/"dig". */
const namn = id => id === v.viewer ? tr('du') : playerOf(id)?.name ?? '?';
const Namn = id => id === v.viewer ? tr('Du') : namn(id);
/* "Anna, Bo och dig" (objekt) eller "Anna och du" (subjekt, först i meningen). */
function lista(ids, { subjekt = false } = {}) {
  const delar = ids.map(id => id === v.viewer ? (subjekt ? tr('du') : tr('dig')) : playerOf(id)?.name ?? '?');
  const text = delar.length > 1 ? tr`${delar.slice(0, -1).join(', ')} och ${delar.at(-1)}` : delar[0] ?? tr('ingen');
  return subjekt ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
/* Lagets nästa startspelare: första levande från lagets pekare i fast ordning (samma som servern visar). */
function ledare(team) {
  const order = v.teams[team];
  const start = Math.max(0, order.indexOf(v.nextLeader[team]));
  return [...order.slice(start), ...order.slice(0, start)].find(id => alive(playerOf(id))) ?? null;
}
/* Egen nedräkning (L16): bara när servern väntar på just mig. */
const minKlocka = () => v.deadline && iAmAlive() && running() ? klockrad(v.viewer, { varning: tr('kvar – välj nu, annars slås du ut') }) : '';
const utslagText = p => ({ [ELIMINATION.left]: tr('Du lämnade matchen.'), [ELIMINATION.life]: tr('Ditt torn har fallit.'), [ELIMINATION.timeout]: tr('Tiden för ditt val tog slut.'), [ELIMINATION.disconnect]: tr('Du kom inte tillbaka i tid.') })[p?.eliminationReason] ?? tr('Ditt torn har fallit.');

function resultTitle(r) {
  if (r.outcome === UTFALL.aborted) return tr('Striden avbröts');
  return r.outcome === UTFALL.held ? tr('Försvaret håller') : tr`${Namn(r.target)} träffas`;
}
function resultLine(r) {
  if (r.outcome === UTFALL.aborted) return tr`${Namn(r.target)} lämnade striden – ingen skada, läkning eller motstöt.`;
  return tr`Attack ${r.attack} mot försvar ${r.defence}.`;
}
function overTitle() {
  if (v.endReason === TEAM_END.serverAbort) return tr('Matchen avbröts');
  if (!v.winnerTeam) return tr('Ingen vann matchen');
  return v.winnerTeam === v.teamId ? tr('Ditt lag vinner matchen!') : tr`${teamName(v.winnerTeam)} vinner matchen`;
}
function overText() {
  if (v.endReason === TEAM_END.serverAbort) return tr('Matchen avbröts på grund av ett serveravbrott. Ingen vann. Gå till lobbyn för att ordna en ny match.');   // L18
  if (v.endReason === TEAM_END.noPlayers || !v.winnerTeam) return tr('Matchen avbröts utan vinnare: alla spelare har lämnat eller slagits ut.');
  const forlorare = otherTeam(v.winnerTeam);
  const egen = !iAmAlive() && v.winnerTeam === v.teamId ? tr(' Du var utslagen, men laget tog hem segern.') : '';
  return tr`${teamName(forlorare)} har inga torn kvar efter ${v.battleNumber} strider.${egen}`;
}

/* "Just nu: attack 7 mot försvar 5 – anfallet går igenom om inget mer läggs." */
function lageNu() {
  const p = v.battle?.preview;
  return p ? tr` Just nu: attack ${p.attack} mot försvar ${p.defence} – ${p.defended ? tr('försvaret håller') : tr('anfallet går igenom')} om inget mer läggs.` : '';
}

/* Fastexten; när en frånkopplad spelares val behövs säger den det (L17). */
function phaseText() {
  const phase = fasText();
  if (!running()) return phase;
  const a = v.activePlayer;
  if (a && a !== v.viewer && v.disconnects?.[a] !== undefined) return { ...phase, text: tr`Väntar på att ${Namn(a)} återansluter.` };
  /* Gemensamma val: nämn den som saknas för att hen är frånkopplad. */
  const borta = [...(v.swap?.waitingFor ?? []), ...(v.confirm?.waitingFor ?? [])].filter(id => id !== v.viewer && v.disconnects?.[id] !== undefined);
  return borta.length ? { ...phase, text: tr`${phase.text} Väntar på att ${lista(borta)} återansluter.` } : phase;
}
function fasText() {
  const b = v.battle, r = v.lastResult;
  switch (v.phase) {
    case FAS.swap: return { title: tr`Startbyten – omgång ${v.swap.round} av ${v.swap.rounds}`, text: v.swap.mine ? tr`Väntar på ${lista(v.swap.waitingFor)}.` : tr`Alla byter samtidigt. Markera upp till ${v.swap.maxCards} kort eller behåll handen.` };
    case FAS.start: return { title: tr`${teamName(v.attackingTeam)} anfaller först`, text: tr`${Namn(ledare(v.attackingTeam))} väljer måltavla när alla har bekräftat.${v.confirm?.mine ? tr` Väntar på ${lista(v.confirm.waitingFor)}.` : ''}` };
    case FAS.target: return { title: tr`Strid ${v.battleNumber}: ${teamName(b.attackingTeam)} anfaller`, text: b.leader === v.viewer ? tr('Du väljer vilket fiendetorn ni anfaller.') : tr`${Namn(b.leader)} väljer måltavla.` };
    case FAS.attack: return { title: tr`Strid ${v.battleNumber}: anfall mot ${namn(b.target)}`, text: `${v.activePlayer === v.viewer ? tr('Din tur: lägg ett kort eller avstå.') : tr`${Namn(v.activePlayer)} väljer anfall.`}${b.preview ? tr` Lagets attack hittills: ${b.preview.attack}.` : ''}` };
    case FAS.defence: return {
      title: tr`Strid ${v.battleNumber}: ${b.target === v.viewer ? tr('du försvarar') : tr`${namn(b.target)} försvarar`}`,
      text: `${v.activePlayer === v.viewer ? (b.target === v.viewer ? tr('Försvara ditt torn eller avstå.') : tr`Hjälp ${namn(b.target)} eller avstå.`) : `${Namn(v.activePlayer)} ${v.activePlayer === b.target ? tr('försvarar sitt torn') : tr('väljer om hen hjälper till')}.`}${lageNu()}`
    };
    case FAS.result: return { title: resultTitle(r), text: `${resultLine(r)} ${v.confirm?.mine ? tr`Väntar på ${lista(v.confirm.waitingFor)}.` : tr('Tryck Fortsätt för nästa strid.')}` };
    case FAS.over: return { title: overTitle(), text: overText() };
    case FAS.error: return { title: tr('Matchen har stoppats'), text: tr('Ett internt fel stoppade matchen. Ingen vann.') };
    default: return { title: '', text: '' };
  }
}

/* ---- Lagbordet ---- */
/* `forut`: livet före en ny strid – de förlorade hjärtana brister (spelbord.css). */
const hearts = (life, forut = life) => tr`<span class="hearts" role="img" aria-label="${life} av ${MAX_LIFE} liv">${Array.from({ length: MAX_LIFE }, (_, n) => `<span aria-hidden="true" class="${n < life ? '' : 'lost'}${n >= life && n < forut ? ' just-lost' : ''}">${HEART}</span>`).join('')}</span>`;
/* Livet före stridsresultatet, bara för ett resultat som kom som ny händelse och bara strax efter den. */
function livForut(p) {
  const r = v.lastResult;
  const levande = r && [FAS.result, FAS.over].includes(v.phase) && levandeStrid === `${v.matchId}|${r.battleNumber}` && Date.now() < brytsTill;
  const d = levande ? r.lifeDelta?.[p.id] ?? 0 : 0;
  return d < 0 ? p.life - d : p.life;
}

function chipStatus(p) {
  if (!alive(p)) return ({ [ELIMINATION.left]: tr('Lämnade matchen'), [ELIMINATION.timeout]: tr('Utslagen – tiden tog slut'), [ELIMINATION.disconnect]: tr('Utslagen – kom inte tillbaka') })[p.eliminationReason] ?? tr('Utslagen');
  const b = v.battle;
  const delar = [];
  if (b?.target === p.id) delar.push(tr('Måltavla'));
  if (v.activePlayer === p.id) delar.push(v.phase === FAS.target ? tr('Väljer måltavla') : v.phase === FAS.attack ? tr('Väljer anfall') : b?.target === p.id ? tr('Försvarar') : tr('Väljer hjälp'));
  else if (b?.leader === p.id) delar.push(tr('Startspelare'));
  if (v.confirm?.waitingFor.includes(p.id) || v.swap?.waitingFor.includes(p.id)) delar.push(tr('Inte klar'));
  if (p.connection !== CONNECTION.online) delar.push(tr('Frånkopplad'));
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
  const inner = `<img src="${TORN[p.teamId]}" alt="" width="280" height="320"><span class="chip-text"><strong>${html(p.name)}${p.id === v.viewer ? ' <em>(du)</em>' : ''}</strong>${hearts(p.life, livForut(p))}<small>${alive(p) ? tr`${p.cardCount} kort` : ''}${status ? `${alive(p) ? ' · ' : ''}${html(status)}` : ''}${alive(p) ? `<span class="chip-clock" data-klocka="${html(p.id)}" hidden></span><span class="chip-avbrott" data-avbrott="${html(p.id)}" hidden></span>` : ''}</small></span>`;
  return valbar
    ? tr`<li><button type="button" class="${klass.join(' ')} selectable" data-target="${html(p.id)}" aria-pressed="${ui.target === p.id}" aria-label="Välj ${html(p.name)} som måltavla, ${p.life} liv">${inner}</button></li>`
    : `<li class="${klass.join(' ')}">${inner}</li>`;
}

function spelatKort(entry, { stoppad = false } = {}) {
  const type = cardType(entry.cardId);
  const simple = entry.usage === USAGE.simple;
  return `<div class="mini-card ${type.type}${stoppad ? ' stopped' : ''}" data-card="${type.id}"${simple ? ' data-simple="true"' : ''} aria-label="${html(type.name)}${simple ? tr(' som enkel attack 1') : ''}${stoppad ? tr(', stoppat') : ''}">${cardFace(type, { simple })}</div>`;
}
function malText(entry, table) {
  if (entry.targetCard) {
    const t = table.find(e => e.instanceId === entry.targetCard);
    return t ? `→ ${cardType(t.cardId).name} (${namn(t.playerId)})` : tr('→ målkortet är borta');
  }
  return entry.targetPlayer ? tr`→ motstöt mot ${namn(entry.targetPlayer)}` : '';
}

/* Vad ett kort räknas som just nu (förhandsvisning) eller räknades som (resultat): stopp, spegling,
   bonus eller ett annat värde än det tryckta. `info` är beräkningens rad för exemplaret. */
function kortNot(entry, info, table) {
  const kort = id => { const e = table.find(t => t.instanceId === id); return e ? `${cardType(e.cardId).name} (${namn(e.playerId)})` : null; };
  const type = cardType(entry.cardId);
  const tryckt = entry.role === 'attack' ? (entry.usage === USAGE.simple ? 1 : type.attack ?? 0) : type.defence ?? 0;
  const delar = [];
  if (info?.stoppedBy?.length) delar.push(tr`Stoppad av ${info.stoppedBy.map(kort).filter(Boolean).join(', ') || tr('ett kort')}`);
  else if (info?.mirrorOf) delar.push(tr`Speglar ${kort(info.mirrorOf) ?? tr('kortet')}: ${info.value}`);
  else if (info?.bonus) delar.push(tr`Räknas ${info.value} (+${info.bonus})`);
  else if (info && info.value !== tryckt) delar.push(tr`Räknas ${info.value}`);
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
  if (!queue.length) return `<li class="empty-note">${role === 'defence' ? (b.target ? tr`${html(Namn(b.target))} försvarar först, sedan lagkamraterna.` : tr('Väntar på måltavla.')) : tr('Startspelaren väljer måltavla.')}</li>`;
  return queue.map((id, i) => {
    const entry = b.table.find(e => e.playerId === id && e.role === role);
    const turn = b.turns.find(t => t.playerId === id && t.role === role);
    const nu = v.phase === fas && i === index && !entry && !turn;
    const info = entry ? b.preview?.cards[entry.instanceId] : null;
    const body = entry ? spelatKort(entry, { stoppad: stoppad(entry, info) })
      : turn?.instanceId === null ? tr('<span class="queue-state passed">Avstod</span>')
      : turn ? tr('<span class="queue-state passed">Kortet togs bort</span>')
      : nu ? tr('<span class="queue-state now">Väljer nu …</span>')
      : tr('<span class="queue-state">Väntar</span>');
    const note = entry ? kortNot(entry, info, b.table) : '';
    return `<li class="queue-item${nu ? ' now' : ''}"><span class="queue-name">${html(Namn(id))}${role === 'defence' && id === b.target ? tr(' · måltavla') : ''}</span>${body}${note ? `<span class="queue-note">${html(note)}</span>` : ''}</li>`;
  }).join('');
}
/* Efter avgörandet: korten som räknades, med stoppade kort markerade. */
function resultatLista(role) {
  const r = v.lastResult;
  const entries = r.table.filter(e => e.role === role);
  if (!entries.length) return `<li class="empty-note">${role === 'attack' ? tr('Inga anfallskort kvar') : tr('Inget försvar')}</li>`;
  return entries.map(e => {
    const info = r.cards?.[e.instanceId];
    const ar = stoppad(e, info) || r.stopped.includes(e.instanceId);
    const note = kortNot(e, info, r.table) || (ar ? 'Stoppad' : '');
    return `<li class="queue-item"><span class="queue-name">${html(Namn(e.playerId))}</span>${spelatKort(e, { stoppad: ar })}${note ? `<span class="queue-note${ar ? ' stopped-note' : ''}">${html(note)}</span>` : ''}</li>`;
  }).join('');
}

/* Uppdatera tornens innehåll på plats. Platsernas ordning är fast inom laget. En ändrad statustext
   får inte ersätta eller flytta hjärtats DOM-nod, eftersom det startar om dess CSS-animation. */
function uppdateraTornBarn(nod, mall) {
  const gamla = [...nod.childNodes], nya = [...mall.childNodes];
  for (let i = 0; i < Math.max(gamla.length, nya.length); i++) {
    const fore = gamla[i], efter = nya[i];
    if (!fore) { nod.append(efter); continue; }
    if (!efter) { fore.remove(); continue; }
    if (fore.nodeType !== efter.nodeType || fore.nodeName !== efter.nodeName) {
      fore.replaceWith(efter);
      continue;
    }
    if (fore.nodeType !== Node.ELEMENT_NODE) {
      if (fore.nodeValue !== efter.nodeValue) fore.nodeValue = efter.nodeValue;
      continue;
    }
    for (const { name } of [...fore.attributes]) if (!efter.hasAttribute(name)) fore.removeAttribute(name);
    for (const { name, value } of efter.attributes) if (fore.getAttribute(name) !== value) fore.setAttribute(name, value);
    uppdateraTornBarn(fore, efter);
  }
}
const skrivet = new Map();
function skriv(id, markup) {
  if (skrivet.get(id) === markup) return;
  skrivet.set(id, markup);
  const mall = document.createElement('template');
  mall.innerHTML = markup;
  uppdateraTornBarn($(id), mall.content);
}
function renderBoard() {
  const mitt = v.teamId, fiende = otherTeam(mitt);
  const valbara = new Set(allowedOf(C.target)?.players ?? []);
  const kvar = team => v.teams[team].filter(id => alive(playerOf(id))).length;
  $('enemy-name').textContent = tr`${teamName(fiende)} · ${kvar(fiende)} av ${v.teams[fiende].length} kvar`;
  $('own-name').textContent = tr`${teamName(mitt)} · ditt lag · ${kvar(mitt)} av ${v.teams[mitt].length} kvar`;
  skriv('enemy-towers', v.teams[fiende].map(id => chip(playerOf(id), { valbar: valbara.has(id) })).join(''));
  skriv('own-towers', v.teams[mitt].map(id => chip(playerOf(id), { valbar: false })).join(''));
  const { title, text } = phaseText();
  $('phase-title').textContent = title;
  $('phase-description').textContent = text;
  const n = v.players.length / 2;
  $('match-label').textContent = tr`LAGMATCH ${n} MOT ${n}${v.battleNumber ? tr` · STRID ${v.battleNumber}` : ''}`;
  $('rules-label').textContent = tr`Regler ${v.rulesVersion} · Kortlek ${v.deckVersion} · draghög ${v.drawPileCount} kort, slänghög ${v.discardPileCount} kort.`;
  const visaResultat = [FAS.result, FAS.over].includes(v.phase) && v.lastResult && (v.phase === FAS.result || v.lastResult.battleNumber === v.battleNumber);
  const strid = Boolean(v.battle) || visaResultat;
  document.querySelector('.team-board').classList.toggle('no-battle', !strid);
  /* Summor och avdrag: förhandsvisning under striden (samma beräkning som avgörandet), slutvärden efteråt. */
  const summor = (berakning, { forsvar = true } = {}) => {
    $('attack-total').textContent = berakning ? String(berakning.attack) : '';
    $('defence-total').textContent = berakning && forsvar ? String(berakning.defence) : '';
    $('attack-deduction').textContent = berakning?.deductions?.frost ? tr`−${berakning.deductions.frost} Isrustning` : '';
    $('defence-deduction').textContent = berakning?.deductions?.pierce ? tr`−${berakning.deductions.pierce} Sprängladdning` : '';
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
  const key = `${language()}|${v.me.hand.map(c => c.instanceId).join(',')}|${v.phase}|${ui.usage}|${interactive}`;
  if (key !== handKey) {
    const scrollLeft = $('hand').scrollLeft;
    handKey = key;
    let dealt = 0;
    $('hand').innerHTML = v.me.hand.map(({ instanceId, cardId }) => {
      const type = cardType(cardId);
      const usable = interactive && usableNow(instanceId);
      const fresh = !shownIds.has(instanceId);
      return tr`<button type="button" class="mini-card ${type.type}${usable ? '' : ' unusable'}${fresh ? ' dealt' : ''}"${fresh ? ` style="animation-delay:${dealt++ * 80}ms"` : ''} data-instance="${html(instanceId)}" data-card="${type.id}" aria-pressed="false" aria-label="${html(type.name)}, ${html(type.valueLabel)} ${html(type.value)}${interactive && !usable ? tr(', kan inte spelas just nu') : ''}">${cardFace(type)}<span class="swap-mark" hidden>Byts</span></button>`;
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
  $('hand-owner').textContent = tr`DINA KORT · ${playerOf(v.viewer).name.toUpperCase()}`;
  $('hand-heading').textContent = !iAmAlive() ? tr('Du är utslagen')
    : can(C.swap) ? tr('Välj kort att byta')
    : can(C.attack) ? tr('Välj ditt anfall')
    : can(C.defend) ? (b?.target === v.viewer ? tr('Försvara ditt torn') : tr`Hjälp ${namn(b?.target)}`)
    : tr('Dina kort');
  $('hand-count').textContent = tr`${v.me.hand.length} kort`;
}

/* ---- Knappraden ovanför handen ---- */
function renderActions() {
  const pending = Boolean(v.pending);
  const knapp = (id, action, label, { kind = 'primary', disabled = false } = {}) => `<button type="button" id="${id}" class="${kind}" data-action="${action}"${disabled || pending ? ' disabled' : ''}>${label}</button>`;
  const vanta = () => { const { title, text } = phaseText(); return tr`<h3>${html(title)}</h3><p>${html(text)} Håll in ett kort för att läsa det medan du väntar.</p>`; };
  const b = v.battle;
  let info = '', choices = null, usage = false, actions = '';

  if (!iAmAlive() && running()) {
    info = tr`<h3>Du är utslagen – laget spelar vidare</h3><p>${html(utslagText(v.me))} Du kan följa matchen här eller gå till lobbyn.</p>`;
    actions = knapp('to-lobby-bar', 'lobby', tr('Till lobbyn'), { kind: 'secondary' });
  } else switch (v.phase) {
    case FAS.swap: {
      if (can(C.swap)) {
        const n = ui.selected.length, max = v.swap.maxCards;
        const pick = selectedCard();
        info = tr`<h3>Välj upp till ${max} kort · ${n}/${max} valda</h3><p>Omgång ${v.swap.round} av ${v.swap.rounds}. ${pick ? html(cardType(pick.cardId).effect) : tr('Tryck på ett kort för att markera det, igen för att ångra. Alla byter samtidigt.')}</p>`;
        actions = knapp('keep-hand', 'keep', tr('Behåll handen'), { kind: 'secondary' }) + knapp('confirm-swap', 'swap', n ? tr`Byt ${n} kort` : tr('Byt kort'), { disabled: !n });
      } else info = tr`<h3>Du är klar med omgång ${v.swap.round}</h3><p>Väntar på ${html(lista(v.swap.waitingFor))}.</p>`;
      break;
    }
    case FAS.start: {
      info = tr`<h3>${html(teamName(v.attackingTeam))} anfaller först</h3><p>${html(Namn(ledare(v.attackingTeam)))} väljer måltavla. ${v.confirm?.mine ? tr`Väntar på ${html(lista(v.confirm.waitingFor))}.` : tr('Striden börjar när alla har bekräftat.')}</p>`;
      actions = knapp('confirm-start', 'start', v.confirm?.mine ? tr('Väntar …') : tr('Börja striden'), { disabled: !can(C.confirmStart) });
      break;
    }
    case FAS.target: {
      const t = allowedOf(C.target);
      if (t) {
        info = tr`<h3>Välj måltavla</h3><p>Vilket fiendetorn ska ${html(teamName(v.teamId))} anfalla? Tryck på ett namn här eller på ett torn på bordet.</p>`;
        choices = t.players.map(id => { const p = playerOf(id); return `<button type="button" class="choice" data-target="${html(id)}" aria-pressed="${ui.target === id}">${html(p.name)}<small>${p.life} liv · ${p.cardCount} kort</small></button>`; }).join('');
        const ok = t.players.includes(ui.target);
        actions = knapp('confirm-target', 'target', ok ? `Anfall ${html(playerOf(ui.target).name)}` : tr('Anfall'), { disabled: !ok });
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
        const maste = passOk ? '' : tr('<p class="invalid">Laget har inte lagt något kort – du måste bidra. Alla kort kan spelas som enkel attack 1.</p>');
        const hint = type && !ok ? tr('<p class="invalid">Välj ”Enkel attack 1” för att anfalla med det här kortet.</p>') : '';
        info = `<h3>${type ? html(type.name) : tr`Ditt anfall mot ${html(namn(b.target))}`}</h3>${hint || `<p>${type ? (ui.usage === USAGE.simple ? tr('Vanlig attack 1, utan specialeffekt.') : html(type.effect)) : tr`Välj ett kort i handen.${passOk ? tr(' Du kan också avstå.') : ''}`}</p>`}${maste}`;
        actions = (passOk ? knapp('confirm-pass-attack', 'pass-attack', tr('Avstå anfall'), { kind: 'secondary' }) : '') + knapp('confirm-attack', 'attack', ok ? tr`Anfall med ${html(type.name)}${ui.usage === USAGE.simple ? ' (attack 1)' : ''}` : tr('Anfall'), { disabled: !ok });
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
        if (kortmal) choices = kortmal.map(id => { const e = b.table.find(t => t.instanceId === id); const t = cardType(e.cardId); return `<button type="button" class="choice" data-card-target="${html(id)}" aria-pressed="${ui.cardTarget === id}">${html(t.name)}<small>${html(Namn(e.playerId))}${e.usage === USAGE.simple ? tr(' · enkel attack 1') : ` · ${html(t.value)}`}</small></button>`; }).join('');
        if (spelarmal) choices = spelarmal.map(id => { const p = playerOf(id); return `<button type="button" class="choice" data-player-target="${html(id)}" aria-pressed="${ui.playerTarget === id}">${html(p.name)}<small>${p.life} liv</small></button>`; }).join('');
        const valt = kortmal ? kortmal.includes(ui.cardTarget) : spelarmal ? spelarmal.includes(ui.playerTarget) : true;
        const ok = Boolean(option) && valt;
        const malHjalp = kortmal ? tr`<p>Välj vilket attackkort ${html(type.name)} ska ${type.cancel ? tr('stoppa') : type.ability === 'seal' ? tr('försegla') : tr('spegla')}.</p>`
          : spelarmal ? tr('<p>Välj vilken anfallare Törneskölden ska träffa om försvaret håller.</p>')
          : option && (type.ability === 'seal' || type.ability === 'mirror') ? tr`<p>Inget magiskt attackkort finns att ${type.ability === 'seal' ? tr('försegla') : tr('spegla')} – kortet ger försvar ${type.defence}.</p>` : '';
        const hint = type && !option ? tr('<p class="invalid">Kortet kan inte försvara just nu. Välj ett annat kort eller avstå.</p>') : '';
        info = `<h3>${type ? html(type.name) : sjalv ? tr('Försvara ditt torn') : tr`Hjälp ${html(namn(b.target))}`}</h3>${hint || (type ? `<p>${html(type.effect)}</p>${malHjalp}` : tr`<p>${sjalv ? tr('Du försvarar först.') : tr`${html(Namn(b.target))} är måltavla.`}${html(lageNu())} Lika hög eller högre sammanlagd försvarsstyrka stoppar anfallet.</p>`)}`;
        actions = knapp('confirm-pass', 'pass', sjalv ? tr('Avstå försvar') : tr('Avstå – hjälp inte'), { kind: 'secondary' }) + knapp('confirm-defend', 'defend', ok ? tr`${sjalv ? tr('Försvara') : tr('Hjälp')} med ${html(type.name)}` : sjalv ? tr('Försvara') : tr('Hjälp till'), { disabled: !ok });
      } else info = vanta();
      break;
    }
    case FAS.result: {
      const r = v.lastResult;
      info = `<h3>${html(resultTitle(r))}</h3><p>${html(resultLine(r))}${v.confirm?.mine ? tr` Väntar på ${html(lista(v.confirm.waitingFor))}.` : ''}</p>`;
      actions = knapp('confirm-next', 'next', v.confirm?.mine ? tr('Väntar …') : tr('Fortsätt <span aria-hidden="true">→</span>'), { disabled: !can(C.next) });
      break;
    }
    default: {
      const { title, text } = phaseText();
      info = `<h3>${html(title)}</h3><p>${html(text)}</p>`;
      actions = knapp('to-lobby-bar', 'lobby', tr('Till lobbyn'));
    }
  }
  /* Egen nedräkning överst: bara när servern väntar på just mig (L16). */
  $('action-info').innerHTML = minKlocka() + info;
  $('choices').innerHTML = choices ?? '';
  $('choices').hidden = !choices;
  $('choices').setAttribute('aria-label', v.phase === FAS.target ? tr('Välj måltavla') : tr('Välj mål för kortet'));
  $('usage').hidden = !usage;
  $('usage-normal').setAttribute('aria-pressed', String(ui.usage === USAGE.normal));
  $('usage-simple').setAttribute('aria-pressed', String(ui.usage === USAGE.simple));
  $('actions').innerHTML = actions;
}

/* ---- Resultatrutan: en gång per avgjord strid och vid matchslut. Lagets resultat och den egna
   utslagningen står på var sin rad. ---- */
let resultKey = null;
let vantandeResultat = false;
const slutUtfall = () => v.endReason === TEAM_END.serverAbort ? 'aborted' : v.winnerTeam && v.winnerTeam === v.teamId ? 'victory' : 'defeat';
function resultatHTML() {
  const r = v.lastResult;
  const over = v.phase === FAS.over;
  /* Vid serveravbrott visas inte den sista striden: dess förluster kom före avbrottet. */
  const stridVisas = r && (!over || (r.battleNumber === v.battleNumber && v.endReason !== TEAM_END.serverAbort));
  const kind = over ? slutUtfall() : r.outcome === UTFALL.hit ? 'hit' : 'held';
  const delar = [];
  if (stridVisas) {
    if (r.outcome === UTFALL.aborted) delar.push(tr`<p>${html(Namn(r.target))} lämnade striden. Ingen skada, läkning eller motstöt – de spelade korten slängs.</p>`);
    else {
      delar.push(tr`<div class="result-score" role="group" aria-label="Stridens slutliga styrkor"><div class="score-side score-attack"><span>Attack</span><strong>${r.attack}</strong><small>${html(teamName(r.attackingTeam))}</small></div>${popupIcon('swords')}<div class="score-side score-defence"><span>Försvar</span><strong>${r.defence}</strong><small>${html(Namn(r.target))} och laget</small></div></div>`);
      const kortrad = role => {
        const list = r.table.filter(e => e.role === role);
        return list.length ? list.map(e => { const not = kortNot(e, r.cards?.[e.instanceId], r.table); return `<li>${html(Namn(e.playerId))}: ${html(cardType(e.cardId).name)}${e.usage === USAGE.simple ? tr(' (enkel attack 1)') : ''}${not ? ` – ${html(not)}` : ''}</li>`; }).join('') : `<li>${role === 'attack' ? tr('Inga anfallskort kvar') : tr('Ingen försvarade')}</li>`;
      };
      delar.push(tr`<div class="team-cards"><div><h4>Anfall</h4><ul>${kortrad('attack')}</ul></div><div><h4>Försvar</h4><ul>${kortrad('defence')}</ul></div></div>`);
      const avdrag = [r.deductions?.frost ? tr`Isrustning sänkte attacken med ${r.deductions.frost}.` : '', r.deductions?.pierce ? tr`Sprängladdning sänkte försvaret med ${r.deductions.pierce}.` : ''].filter(Boolean);
      if (avdrag.length) delar.push(`<p class="life-lines">${html(avdrag.join(' '))}</p>`);
      const liv = Object.entries(r.lifeDelta).filter(([, d]) => d).map(([id, d]) => tr`${Namn(id)} ${d < 0 ? tr`förlorar ${-d} liv` : tr`får tillbaka ${d} liv`} (${r.life[id]} kvar).`);
      if (liv.length) delar.push(`<p class="life-lines">${liv.map(html).join(' ')}</p>`);
      if (r.eliminated.length) delar.push(`<p class="life-lines">${html(lista(r.eliminated, { subjekt: true }))} ${r.eliminated.length > 1 ? tr('är utslagna') : tr('är utslagen')}.</p>`);
      delar.push(tr`<details><summary>Hela beräkningen</summary><ul>${r.events.map(e => `<li>${html(message(e))}</li>`).join('')}</ul></details>`);
    }
    if (!over && r.eliminated.includes(v.viewer)) delar.push(tr('<p class="personal"><strong>Du är utslagen – laget spelar vidare.</strong> Du kan följa matchen eller gå till lobbyn.</p>'));
  } else if (over) delar.push(`<p>${html(overText())}</p>`);
  if (over) {
    delar.push(`<p class="winner"><strong>${html(overTitle())}</strong></p>`);
    if (stridVisas) delar.push(`<p>${html(overText())}</p>`);
  }
  return `${resultHeader(kind, over ? overTitle() : resultTitle(r), over && v.endReason === TEAM_END.serverAbort ? tr('SERVERAVBROTT') : over)}<div class="popup-result-body">${delar.join('')}</div>`;
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
  dialog.dataset.outcome = over ? slutUtfall() : v.lastResult.outcome === UTFALL.hit ? 'hit' : 'held';
  const pending = Boolean(v.pending);
  $('dialog-actions').innerHTML = over
    ? tr`<button type="button" id="dialog-lobby" class="primary" data-action="lobby">Till lobbyn</button>`
    : `${minKlocka()}<button type="button" id="dialog-next" class="primary" data-action="next"${!can(C.next) || pending ? ' disabled' : ''}>${v.confirm?.mine ? tr`Väntar på ${html(lista(v.confirm.waitingFor))} …` : tr('Fortsätt <span aria-hidden="true">→</span>')}</button>`;
  const key = over ? `${v.matchId}|slut` : `${v.matchId}|${v.lastResult.battleNumber}`;
  if (key === resultKey) return;
  resultKey = key;
  /* Ljudet kommer ur nya händelser: ett resultat eller matchslut som redan fanns (sidladdning, återanslutning) är tyst. */
  const effekt = resultatljud(nyaResultat, { jag: v.viewer, lag: v.teamId });
  nyaResultat = [];
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
function updateFeedbackText() {
  const banner = $('turn-feedback');
  const b = v.battle;
  const label = v.phase === FAS.target ? tr('Du väljer måltavla!') : v.phase === FAS.attack ? tr('Din tur att anfalla!') : b.target === v.viewer ? tr('Du blir anfallen!') : tr`Hjälp ${namn(b.target)}!`;
  banner.dataset.tone = v.phase === FAS.defence ? 'defence' : 'attack';
  banner.innerHTML = tr`<small>STRID ${v.battleNumber}</small>${html(label)}`;
}
function renderTurnFeedback() {
  const banner = $('turn-feedback');
  const mine = v.activePlayer === v.viewer && [FAS.target, FAS.attack, FAS.defence].includes(v.phase);
  const key = mine ? `${v.matchId}|${v.battleNumber}|${v.phase}` : null;
  if (key === feedbackKey) { if (mine) updateFeedbackText(); return; }
  feedbackKey = key;
  clearTimeout(feedbackTimer);
  banner.hidden = true;
  if (!mine) return;
  updateFeedbackText();
  banner.hidden = false;
  if (!reduceMotion.matches) banner.animate([{ opacity: 0, translate: '0 -6px' }, { opacity: 1, translate: '0 0', offset: .15 }, { opacity: 1, offset: .8 }, { opacity: 0 }], { duration: 1800, easing: 'ease-out', fill: 'forwards' });
  feedbackTimer = setTimeout(() => { banner.hidden = true; }, 1800);
}

function render() {
  sound.setPlaying(running());
  renderBoard();
  if (![FAS.result, FAS.over].includes(v.phase)) levandeStrid = null;   // en ny strid: ett senare matchslut animerar inte den gamla
  renderHand();
  renderActions();
  renderResult();
  renderTurnFeedback();
  const ute = !iAmAlive() || !running();
  $('leave-match').hidden = ute;
  $('to-lobby').hidden = !ute;
  $('log').innerHTML = v.log.map(line => `<li>${html(message(line))}</li>`).join('');
  const pendingText = v.pending?.status === PENDING.sending ? tr('Skickar ditt drag …') : v.pending?.status === PENDING.checking ? tr('Kontrollerar om draget registrerades …') : null;
  $('notice').textContent = ui.notice?.eliminated ? ui.notice.eliminated.map(({ name, reason }) => `${name} ${tr(UTSLAG_BESKED[reason])}.`).join(' ') : message(ui.notice?.text ?? pendingText ?? '');
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

/* Ljud, animation och besked för serverns nya händelser (L19), högst en gång per händelse-ID. */
const vakt = skapaHandelsevakt();
let nyaResultat = [];       // nya RESULTAT/MATCHSLUT: resultatrutan ger dem sitt ljud
let levandeStrid = null;    // "match|strid" för ett resultat som kom som ny händelse: hjärtana brister
let brytsTill = 0;          // ... men bara strax efter händelsen (CSS-animationen tar 0,7 s)
const HJARTBROTT_MS = 900;
const UTSLAG_BESKED = { [ELIMINATION.left]: 'lämnade matchen', [ELIMINATION.timeout]: 'är utslagen – tiden tog slut', [ELIMINATION.disconnect]: 'är utslagen – kom inte tillbaka i tid' };
function playEvents(events) {
  const nya = vakt.nya(events);
  for (const name of handelseljud(nya)) sound.playEffect(name);
  nyaResultat = nya.filter(e => e.type === EVENT.result || e.type === EVENT.matchOver);
  const strid = nya.findLast(e => e.type === EVENT.result);
  if (strid) { levandeStrid = `${strid.matchId}|${strid.data.battleNumber}`; brytsTill = Date.now() + HJARTBROTT_MS; }
  /* Utslagning utanför en strid (avhopp, tid, avbrott): vem och varför. En strids utslagningar visas i resultatrutan. */
  const besked = nya.filter(e => e.type === EVENT.eliminated && e.data.playerId !== v.viewer && UTSLAG_BESKED[e.data.reason]).map(e => ({ name: playerOf(e.data.playerId)?.name ?? '?', reason: e.data.reason }));
  if (besked.length) ui.notice = { eliminated: besked, kind: 'info' };
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
    else if (ui.selected.length >= max) ui.notice = { text: source`Högst ${max} kort per bytesomgång. Avmarkera ett kort först.`, kind: 'error' };
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
  lastDefence: ('Kan spelas som hjälp. Bonusen gäller om du själv hade exakt ett liv när striden började.')
};
const lagAnvandning = type => tr`Spelas när ${[type.attack ? tr('ditt lag anfaller') : null, type.defence || type.cancel ? tr('ditt lag försvarar – för ditt eget torn eller som hjälp') : null].filter(Boolean).join(tr(' eller '))}.`;
function lagTillagg(type) {
  const text = type.cancel ? tr('Kan spelas som hjälp. Välj ett attackkort på bordet som inte redan stoppats.') : tr(LAGREGEL[type.ability]);
  return text ? tr`<h4>I lagmatch</h4><p>${html(text)}</p>` : '';
}

const nedrakning = kopplaNedrakning({ klockor: () => v?.clocks, avbrott: () => v?.disconnects, nu: () => adapter?.serverNu() ?? Date.now(), egen: () => v?.viewer, varna: text => { $('clock-alert').textContent = text; } });
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
  await initLanguage();
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
    node.dataset.connection = lage;
    node.textContent = tr(CONNECTION_TEXT[lage]) ?? lage;
    node.classList.toggle('warn', lage !== 'ansluten');
    if (lage === 'utloggad') { location.replace('lobby.html'); return; }
    if (lage === 'ersatt') ui.notice = { text: 'Spelet är öppet i en annan flik. Ladda om sidan för att spela här.', kind: 'error' };
    if (extra) ui.notice = { text: extra, kind: 'error' };
    if (v) render();
  });
  v = adapter.view();
  vakt.historik(v);   // det som redan hänt är tyst
  $('intro-size').textContent = tr`${v.players.length / 2} mot ${v.players.length / 2}. Ett torn var. Tre liv. Ett lag vinner.`;
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

onLanguageChange(() => {
  if (!v) return;
  const focused = document.activeElement;
  const instance = focused?.dataset.instance;
  const id = focused?.id;
  const scroll = $('hand').scrollLeft;
  $('intro-size').textContent = tr`${v.players.length / 2} mot ${v.players.length / 2}. Ett torn var. Tre liv. Ett lag vinner.`;
  render();
  $('hand').scrollLeft = scroll;
  if (instance) [...$('hand').querySelectorAll('[data-instance]')].find(el => el.dataset.instance === instance)?.focus({ preventScroll: true });
  else if (id) document.getElementById(id)?.focus({ preventScroll: true });
  const connection = $('connection');
  if (connection.dataset.connection) connection.textContent = tr(CONNECTION_TEXT[connection.dataset.connection]);
});
