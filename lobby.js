/* Lobbyn (arbetsordning L06): nick, spelarlista, inbjudningar, rum, lagval, Redo och värdens start.
   Klienten har inga spelregler: allt som visas är serverns senaste lobbyvy (SSE-händelsen `lobby`),
   och varje knapp skickar ett kommando enligt kontrakt.js och visar serverns kvittens/skäl.
   All text sätts med textContent – nick och meddelanden renderas aldrig som HTML. */
import { PROTOCOL_VERSION, LOBBY_COMMAND, ACTIVITY, CONNECTION, RECEIPT, TEAMS, NICK } from './kontrakt.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child);
  return node;
};

const state = {
  vy: null,                 // senaste lobbyvy från servern: { me, players, rum, start, inbjudningar }
  markerade: new Set(),     // spelar-ID markerade för inbjudan
  strom: null,              // EventSource
  anslutning: 'ansluter',   // ansluter | ansluten | ateransluter | ersatt
  tidsskillnad: 0,          // serverns klocka minus webbläsarens (ms)
  upptagen: new Set()       // kommandotyper som väntar på kvittens
};
const ACTIVITY_TEXT = { [ACTIVITY.idle]: 'Ledig', [ACTIVITY.inRoom]: 'I ett rum', [ACTIVITY.playing]: 'Spelar', [ACTIVITY.finished]: 'Följer avslut' };
const teamName = id => TEAMS.find(t => t.id === id)?.name ?? 'Utan lag';
const serverNu = () => Date.now() + state.tidsskillnad;

/* ---- Meddelanden ---- */
function visaFel(text, { fokus } = {}) { $('error').textContent = text ?? ''; if (fokus) fokus.focus(); }
function visaNotis(text) { $('notice').textContent = text ?? ''; }
function sattAnslutning(lage, text) {
  state.anslutning = lage;
  const node = $('connection');
  node.textContent = text;
  node.classList.toggle('warn', lage !== 'ansluten');
  render();
}

/* ---- Nätverk ---- */
async function api(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  } catch {
    throw Object.assign(new Error('Ingen kontakt med servern. Kontrollera din anslutning och försök igen.'), { status: 0 });
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw Object.assign(new Error(data?.message ?? `Servern svarade ${response.status}.`), { status: response.status, data });
  return data;
}

/* Ett kommando: nytt commandId, väntar på kvittens, visar skäl vid avvisning. Returnerar true om GODKÄND. */
async function skicka(type, extra = {}) {
  if (state.upptagen.has(type)) return false;
  state.upptagen.add(type);
  render();
  try {
    const receipt = await api('/api/kommando', { method: 'POST', body: { protocolVersion: PROTOCOL_VERSION, commandId: crypto.randomUUID(), type, payload: {}, ...extra } });
    if (receipt.status === RECEIPT.ok) { visaFel(''); if (receipt.message) visaNotis(receipt.message); return true; }
    visaFel(receipt.message ?? 'Servern avvisade kommandot.');
    return false;
  } catch (error) {
    if (error.status === 401) { visaSession(null); visaFel(''); $('nick-error').textContent = 'Din session har gått ut. Välj nick igen.'; }
    else visaFel(error.message);
    return false;
  } finally {
    state.upptagen.delete(type);
    render();
  }
}

function oppnaStrom() {
  state.strom?.close();
  const strom = new EventSource('/api/handelser', { withCredentials: true });
  state.strom = strom;
  sattAnslutning('ansluter', 'Ansluter …');
  strom.addEventListener('halsa', event => {
    const data = JSON.parse(event.data);
    state.tidsskillnad = data.tid - Date.now();
    if (!data.matchtrafik.oppen) visaNotis(data.matchtrafik.orsak);
  });
  strom.addEventListener('lobby', event => {
    state.vy = JSON.parse(event.data);
    sattAnslutning('ansluten', 'Ansluten');
    if (state.vy.me.activity === ACTIVITY.playing) tillMatchen();
  });
  strom.addEventListener('match', tillMatchen);
  strom.addEventListener('ersatt', () => {
    strom.close();
    sattAnslutning('ersatt', 'Öppen i en annan flik');
    $('replaced').showModal();
  });
  strom.onerror = () => { if (state.anslutning !== 'ersatt') sattAnslutning('ateransluter', 'Återansluter …'); };
}

/* Matchen har startat: matchsidan tar över (den öppnar en egen ström). */
let paVagTillMatch = false;
function tillMatchen() {
  if (paVagTillMatch) return;
  paVagTillMatch = true;
  state.strom?.close();
  location.href = 'match.html?online=1';
}

/* ---- Vyer ---- */
function visaSession(vy) {
  state.vy = vy;
  const harSession = Boolean(vy);
  $('nick-section').hidden = harSession;
  $('lobby-section').hidden = !harSession;
  $('leave-lobby').hidden = !harSession;
  if (!harSession) { state.strom?.close(); state.strom = null; $('connection').textContent = ''; $('nick').focus(); }
  render();
}

/* Renderar om allt från state.vy men behåller fokus (element har stabila id:n) och markeringar. */
function render() {
  const vy = state.vy;
  if (!vy) return;
  const fokusId = document.activeElement?.id;
  const ansluten = state.anslutning === 'ansluten';
  $('my-nick').textContent = vy.me.nick;
  $('change-nick').hidden = vy.me.activity !== ACTIVITY.idle;

  /* Spelarlistan */
  const andra = vy.players.filter(p => p.playerId !== vy.me.playerId);
  $('empty-lobby').hidden = andra.length > 0;
  const kanBjudas = p => p.activity === ACTIVITY.idle && p.connection === CONNECTION.online;
  const bortfall = [...state.markerade].filter(id => !andra.some(p => p.playerId === id && kanBjudas(p)));
  if (bortfall.length) {
    const namn = bortfall.map(id => vy.players.find(p => p.playerId === id)?.nick ?? 'En spelare');
    for (const id of bortfall) state.markerade.delete(id);
    visaNotis(`${namn.join(', ')} kan inte längre bjudas in och har avmarkerats.`);
  }
  const jagArVard = vy.rum && vy.rum.hostPlayerId === vy.me.playerId;
  const kanMarkera = ansluten && (!vy.rum || jagArVard);
  $('players').replaceChildren(...vy.players.map(p => {
    const mig = p.playerId === vy.me.playerId;
    const id = `pick-${p.playerId}`;
    const box = el('input', { type: 'checkbox', id, disabled: !kanMarkera || mig || !kanBjudas(p) ? '' : null, onchange: e => { e.target.checked ? state.markerade.add(p.playerId) : state.markerade.delete(p.playerId); render(); } });
    box.checked = state.markerade.has(p.playerId);
    const status = mig ? 'Det är du' : p.connection !== CONNECTION.online ? 'Frånkopplad' : ACTIVITY_TEXT[p.activity];
    return el('li', { class: `${mig ? 'me-row' : ''}${!kanMarkera ? ' no-pick' : ''}` },
      el('label', { for: id }, box, el('span', { class: 'nick' }, p.nick)),
      el('span', { class: `status${p.connection === CONNECTION.online && !mig ? ' online' : ''}${p.activity !== ACTIVITY.idle && !mig ? ' busy' : ''}` }, status));
  }));
  const antal = state.markerade.size;
  const invite = $('invite');
  invite.textContent = vy.rum ? `Bjud in till mitt rum${antal ? ` (${antal})` : ''}` : `Skapa rum och bjud in${antal ? ` (${antal})` : ''}`;
  invite.disabled = !kanMarkera || antal === 0 || state.upptagen.has(LOBBY_COMMAND.invite) || state.upptagen.has(LOBBY_COMMAND.createRoom);
  invite.hidden = Boolean(vy.rum) && !jagArVard;
  $('create-room').hidden = Boolean(vy.rum);
  $('create-room').disabled = !ansluten || state.upptagen.has(LOBBY_COMMAND.createRoom);

  /* Inkommande inbjudningar */
  $('invitations').replaceChildren(...vy.inbjudningar.inkommande.map(inv => el('div', { class: 'invitation', id: `inv-${inv.id}` },
    el('p', {}, el('strong', {}, inv.from.nick), ' bjuder in dig till sitt rum. ', el('span', { class: 'time', dataset: { expires: inv.expiresAt } }, tidKvar(inv.expiresAt))),
    el('button', { type: 'button', class: 'primary', id: `accept-${inv.id}`, disabled: !ansluten ? '' : null, onclick: () => skicka(LOBBY_COMMAND.accept, { payload: { invitationId: inv.id } }) }, 'Acceptera'),
    el('button', { type: 'button', class: 'secondary', id: `decline-${inv.id}`, disabled: !ansluten ? '' : null, onclick: () => skicka(LOBBY_COMMAND.decline, { payload: { invitationId: inv.id } }) }, 'Avböj'))));

  renderRum(vy, ansluten, jagArVard);
  if (fokusId && document.activeElement?.id !== fokusId) document.getElementById(fokusId)?.focus();
}

function renderRum(vy, ansluten, jagArVard) {
  const rum = vy.rum;
  $('room').hidden = !rum;
  if (!rum) return;
  const me = rum.players.find(p => p.playerId === vy.me.playerId);
  const vard = rum.players.find(p => p.playerId === rum.hostPlayerId);
  const avslutat = rum.status !== 'FÖRBEREDELSE';
  $('room').classList.toggle('finished', avslutat);
  $('room-heading').textContent = avslutat ? 'Matchen är slut' : jagArVard ? 'Du är värd' : `${vard?.nick ?? 'Någon'} är värd`;
  $('room-count').textContent = `${rum.players.length} av högst 8 deltagare`;
  const medlem = p => el('li', { class: `member${p.playerId === vy.me.playerId ? ' me-row' : ''}` },
    el('span', {}, p.nick, p.playerId === rum.hostPlayerId ? el('span', { class: 'host' }, '(värd)') : null),
    el('span', { class: `ready-state${p.ready ? ' is-ready' : ''}` }, p.connection !== CONNECTION.online ? 'Frånkopplad' : p.ready ? 'Redo' : 'Inte redo'));
  for (const team of TEAMS) $(`team-${team.id}`).replaceChildren(...rum.players.filter(p => p.teamId === team.id).map(medlem));
  const utanLag = rum.players.filter(p => p.teamId === null);
  $('no-team-wrap').hidden = utanLag.length === 0;
  $('team-none').replaceChildren(...utanLag.map(medlem));
  for (const button of document.querySelectorAll('.pick-team')) {
    const valt = me?.teamId === button.dataset.team;
    button.setAttribute('aria-pressed', String(valt));
    button.disabled = !ansluten || state.upptagen.has(LOBBY_COMMAND.team);
    button.onclick = () => skicka(LOBBY_COMMAND.team, { roomId: rum.id, payload: { teamId: valt ? null : button.dataset.team } });
  }
  const ready = $('ready');
  ready.setAttribute('aria-pressed', String(Boolean(me?.ready)));
  ready.textContent = me?.ready ? 'Redo ✓ (ångra)' : 'Redo';
  ready.disabled = !ansluten || state.upptagen.has(LOBBY_COMMAND.ready) || (!me?.ready && me?.teamId === null);
  ready.title = me?.teamId === null ? 'Välj lag först' : '';
  ready.onclick = () => skicka(LOBBY_COMMAND.ready, { roomId: rum.id, payload: { ready: !me?.ready, rosterVersion: rum.rosterVersion } });
  for (const button of document.querySelectorAll('.pick-team')) button.hidden = avslutat;
  ready.hidden = avslutat;
  $('start-box').hidden = avslutat;
  $('leave-room').textContent = avslutat ? 'Tillbaka till lobbyn' : 'Lämna rummet';
  $('leave-room').disabled = !ansluten || state.upptagen.has(LOBBY_COMMAND.leave);
  $('leave-room').onclick = () => { state.markerade.clear(); skicka(LOBBY_COMMAND.leave, { roomId: rum.id }); };

  /* Startvillkor – serverns skäl visas ordagrant. */
  const start = vy.start;
  const status = $('start-status');
  const startButton = $('start');
  if (start?.kanStarta) {
    status.textContent = jagArVard ? 'Alla är redo. Du kan starta matchen.' : 'Alla är redo. Väntar på att värden startar.';
    status.className = 'can-start';
  } else {
    status.textContent = start?.skal.join(' ') ?? '';
    status.className = '';
  }
  startButton.hidden = !jagArVard;
  startButton.disabled = !ansluten || !start?.kanStarta || state.upptagen.has(LOBBY_COMMAND.start);
  startButton.onclick = () => skicka(LOBBY_COMMAND.start, { roomId: rum.id, payload: { rosterVersion: rum.rosterVersion } });

  $('outgoing').replaceChildren(...(jagArVard ? vy.inbjudningar.utgaende.map(inv => el('div', { class: 'outgoing-row', id: `out-${inv.id}` },
    el('span', {}, 'Inbjudan till ', el('strong', {}, inv.to.nick), ' väntar på svar. ', el('span', { class: 'time', dataset: { expires: inv.expiresAt } }, tidKvar(inv.expiresAt))),
    el('button', { type: 'button', class: 'secondary', id: `revoke-${inv.id}`, disabled: !ansluten ? '' : null, onclick: () => skicka(LOBBY_COMMAND.revoke, { roomId: rum.id, payload: { invitationId: inv.id } }) }, 'Återkalla'))) : []));
}

function tidKvar(expiresAt) {
  const sekunder = Math.max(0, Math.round((expiresAt - serverNu()) / 1000));
  return `Gäller ${sekunder} s till.`;
}
setInterval(() => { for (const node of document.querySelectorAll('.time[data-expires]')) node.textContent = tidKvar(Number(node.dataset.expires)); }, 1000);

/* ---- Händelser ---- */
$('nick-form').addEventListener('submit', async event => {
  event.preventDefault();
  const nick = $('nick').value.trim();
  const fel = $('nick-error');
  if ([...nick].length < NICK.min || [...nick].length > NICK.max) { fel.textContent = `Nicket måste vara ${NICK.min}–${NICK.max} tecken.`; $('nick').focus(); return; }
  fel.textContent = '';
  try {
    const vy = await api('/api/session', { method: 'POST', body: { nick } });
    visaSession(vy);
    oppnaStrom();
  } catch (error) {
    fel.textContent = error.status === 409 ? `${error.message} ` : error.message;
    $('nick').focus();
    $('nick').select();
  }
});
$('change-nick').addEventListener('click', () => { $('change-nick-form').hidden = false; $('new-nick').value = state.vy?.me.nick ?? ''; $('new-nick').focus(); $('new-nick').select(); });
$('cancel-nick').addEventListener('click', () => { $('change-nick-form').hidden = true; $('change-nick').focus(); });
$('change-nick-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (await skicka(LOBBY_COMMAND.nick, { payload: { nick: $('new-nick').value.trim() } })) { $('change-nick-form').hidden = true; $('change-nick').focus(); }
  else $('new-nick').focus();
});
$('invite').addEventListener('click', async () => {
  const ids = [...state.markerade];
  if (!ids.length) return;
  let roomId = state.vy?.rum?.id;
  if (!roomId) {
    if (!await skicka(LOBBY_COMMAND.createRoom)) return;
    roomId = (await api('/api/lobby').catch(() => null))?.rum?.id;
    if (!roomId) { visaFel('Rummet kunde inte hämtas. Ladda om sidan och försök igen.'); return; }
  }
  if (await skicka(LOBBY_COMMAND.invite, { roomId, payload: { playerIds: ids } })) { state.markerade.clear(); render(); }
});
$('create-room').addEventListener('click', () => skicka(LOBBY_COMMAND.createRoom));
$('leave-lobby').addEventListener('click', async () => {
  try { await api('/api/session', { method: 'DELETE' }); } catch (error) { visaFel(error.message); return; }
  state.markerade.clear();
  visaSession(null);
});
$('take-over').addEventListener('click', () => { $('replaced').close(); oppnaStrom(); });
$('replaced').addEventListener('cancel', event => event.preventDefault());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.vy && state.anslutning === 'ateransluter') api('/api/lobby').then(vy => { state.vy = vy; render(); }).catch(() => {}); });

/* ---- Start: återuppta befintlig session, annars nickformulär ---- */
api('/api/session').then(vy => { if (vy?.me) { visaSession(vy); oppnaStrom(); } else visaSession(null); }).catch(() => visaSession(null));
