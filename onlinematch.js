/* OnlineMatch (arbetsordning L09): matchvyns adapter mot servern. Samma sex metoder som LokalMatch
   men ingen `local`: inga andras händer, ingen dator, ingen inblick. Vyn kommer från serverns
   SSE-händelse `match` (och /api/match vid sidladdning/återanslutning); kommandon skickas med
   fetch POST och får en kvittens. Ett drag är "väntande" tills kvittensen kommit; uteblir svaret
   frågas servern om samma commandId (KOMMANDOSTATUS) och kommandot skickas om bara när servern
   inte känner till det. En gammal vy eller gammal kvittens skriver aldrig över nyare läge. */
import { ADAPTER_MODE, RECEIPT } from './kontrakt.js';

export const PENDING = Object.freeze({ sending: 'SKICKAR', checking: 'KONTROLLERAR' });
const tomKvittens = (commandId, status, message) => ({ commandId, status, message, revision: null, roomRevision: null, eventId: null, fingerprint: null });

export function skapaOnlineMatch({ initial, fetchFn = (...args) => fetch(...args), vanta = ms => new Promise(r => setTimeout(r, ms)), maxForsok = 5, forsokMs = 1500, timeoutMs = 10000, klocka = globalThis } = {}) {
  let view = initial.view;
  let matchStatus = initial.status;
  let pending = null;
  let strom = null;
  let onStatus = () => {};
  const listeners = new Set();

  const current = () => ({ ...view, pending });
  const notify = events => { const c = current(); for (const listener of listeners) listener(c, events); };

  /* Ny vy från servern: bara om den är nyare än den vi har. Händelser som redan setts filtreras bort. */
  function receive({ view: nv, events = [], status } = {}) {
    if (!nv || nv.matchId !== view.matchId) return false;
    if (nv.lastEventId < view.lastEventId || nv.revision < view.revision) return false;
    const fresh = events.filter(e => e.eventId > view.lastEventId);
    const changed = nv.lastEventId !== view.lastEventId || nv.revision !== view.revision || JSON.stringify(nv.confirm) !== JSON.stringify(view.confirm);
    view = nv;
    if (status) matchStatus = status;
    if (changed || fresh.length) notify(fresh);
    return true;
  }

  async function api(path, body) {
    const controller = new AbortController();
    let timer;
    // Tidsgränsen omfattar både svarshuvuden och hela svarskroppen.
    const timeout = new Promise((_, reject) => {
      timer = klocka.setTimeout(() => {
        reject(new Error('Serverns svar dröjde för länge. Kontrollera anslutningen och försök igen.'));
        controller.abort();
      }, timeoutMs);
    });
    let response, text;
    try {
      ({ response, text } = await Promise.race([
        (async () => {
          const response = await fetchFn(path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', signal: controller.signal });
          return { response, text: await response.text() };
        })(),
        timeout
      ]));
    } finally { klocka.clearTimeout(timer); }
    const data = text ? JSON.parse(text) : null;
    if (response.status === 401) { onStatus('utloggad'); throw Object.assign(new Error('Din session har gått ut. Gå till lobbyn och välj nick igen.'), { status: 401, final: true }); }
    if (response.status === 400) throw Object.assign(new Error(data?.message ?? 'Servern avvisade kommandot.'), { status: 400, final: true });
    if (!response.ok) throw Object.assign(new Error(data?.message ?? `Servern svarade ${response.status}.`), { status: response.status });
    return data;
  }
  const getStatus = commandId => api(`/api/status?commandId=${encodeURIComponent(commandId)}&scope=${encodeURIComponent(`match:${view.matchId}`)}`);
  async function refresh() {
    try { receive(await api(`/api/match?efterEventId=${view.lastEventId}`)); } catch { /* strömmen kommer med nästa vy */ }
  }

  async function send(command) {
    if (pending) return tomKvittens(command.commandId, RECEIPT.rejected, 'Vänta – ditt förra drag behandlas fortfarande.');
    pending = { commandId: command.commandId, status: PENDING.sending };
    notify([]);
    let receipt = null;
    let message = null;
    try {
      try { receipt = await api('/api/kommando', command); }
      catch (error) { if (error.final) return tomKvittens(command.commandId, RECEIPT.rejected, error.message); message = error.message; }
      /* Kvittensen dröjde eller försvann: kontrollera utan att göra ett extra drag. */
      for (let forsok = 1; !receipt && forsok <= maxForsok; forsok++) {
        pending = { commandId: command.commandId, status: PENDING.checking };
        notify([]);
        await vanta(forsokMs * forsok);
        let known = null;
        try { known = await getStatus(command.commandId); } catch (error) { if (error.final) return tomKvittens(command.commandId, RECEIPT.rejected, error.message); continue; }
        if (known.status !== RECEIPT.unknown) { receipt = known; break; }
        await refresh();
        if (view.revision !== command.revision) return tomKvittens(command.commandId, RECEIPT.rejected, 'Matchläget har ändrats – välj igen.');
        try { receipt = await api('/api/kommando', command); } catch (error) { if (error.final) return tomKvittens(command.commandId, RECEIPT.rejected, error.message); }
      }
      if (!receipt) return tomKvittens(command.commandId, RECEIPT.error, message ?? 'Ingen kontakt med servern. Kontrollera anslutningen och försök igen.');
      if (receipt.status === RECEIPT.ok && receipt.revision !== null && view.revision < receipt.revision) await refresh();
      return receipt;
    } finally {
      pending = null;
      notify([]);
    }
  }

  function connect(EventSourceCtor = globalThis.EventSource) {
    strom?.close();
    strom = new EventSourceCtor('/api/handelser', { withCredentials: true });
    onStatus('ansluter');
    strom.addEventListener('match', event => receive(JSON.parse(event.data)));
    strom.addEventListener('halsa', event => { const data = JSON.parse(event.data); onStatus('ansluten', data.matchtrafik.oppen ? null : data.matchtrafik.orsak); refresh(); });
    strom.addEventListener('ersatt', () => { strom.close(); onStatus('ersatt'); });
    strom.onerror = () => onStatus('ateransluter');
    return strom;
  }

  return {
    mode: ADAPTER_MODE.online,
    viewer: () => view.mySeat ?? view.viewer,   // duellen: plats A/B; lagmatchen: eget spelar-ID
    view: current,
    send,
    status: getStatus,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    receive, refresh, connect,
    matchStatus: () => matchStatus,
    pa: fn => { onStatus = fn; },
    close: () => { strom?.close(); strom = null; }
  };
}
