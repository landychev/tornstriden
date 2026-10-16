/* OnlineMatch (arbetsordning L09): matchvyns adapter mot servern. Samma sex metoder som LokalMatch
   men ingen `local`: inga andras händer, ingen dator, ingen inblick. Vyn kommer från serverns
   SSE-händelse `match` (och /api/match vid sidladdning/återanslutning); kommandon skickas med
   fetch POST och får en kvittens. Ett drag är "väntande" tills kvittensen kommit; uteblir svaret
   frågas servern om samma commandId (KOMMANDOSTATUS) och kommandot skickas om bara när servern
   inte känner till det. En gammal vy eller gammal kvittens skriver aldrig över nyare läge.
   Spelarklockor (L16): vyn har `serverTime`; `serverNu()` ger serverns tid enligt skillnaden när vyn togs emot,
   så att nedräkningen inte beror på att datorns klocka går rätt.
   Anslutning (L17): strömmen svarar på serverns `ping` med ett livstecken. Medan strömmen är borta skickas inga
   nya drag (”Återansluter …”); efter återkomsten kommer aktuell vy från servern innan något kan väljas.
   Ljud och animationer (L19): lyssnarna får bara händelser som är nya för sidan. Det som hämtas efter en
   (åter)anslutning är historik och levereras utan händelser – vyn uppdateras, men inget spelas upp. */
import { ADAPTER_MODE, RECEIPT, PROTOCOL_VERSION } from './kontrakt.js';

export const PENDING = Object.freeze({ sending: 'SKICKAR', checking: 'KONTROLLERAR' });
const tomKvittens = (commandId, status, message) => ({ commandId, status, message, revision: null, roomRevision: null, eventId: null, fingerprint: null });

export function skapaOnlineMatch({ initial, fetchFn = (...args) => fetch(...args), vanta = ms => new Promise(r => setTimeout(r, ms)), maxForsok = 5, forsokMs = 1500, timeoutMs = 10000, klocka = globalThis } = {}) {
  let view = initial.view;
  let skillnad = 0;   // serverns tid minus den lokala, mätt när en vy togs emot
  const matTid = nv => { if (Number.isFinite(nv?.serverTime)) skillnad = nv.serverTime - Date.now(); };
  matTid(view);
  let matchStatus = initial.status;
  let pending = null;
  let strom = null;
  let ansluten = false;   // strömmen är öppen och servern har hälsat (bara när connect() används)
  let onStatus = () => {};
  const listeners = new Set();

  const current = () => ({ ...view, pending });
  const notify = events => { const c = current(); for (const listener of listeners) listener(c, events); };

  /* Ny vy från servern: bara om den är nyare än den vi har. Händelser som redan setts filtreras bort;
     `tyst` (historik efter en återanslutning) levererar vyn utan händelser. */
  function receive({ view: nv, events = [], status } = {}, { tyst = false } = {}) {
    if (!nv || nv.matchId !== view.matchId) return false;
    if (nv.lastEventId < view.lastEventId || nv.revision < view.revision) return false;
    const fresh = tyst ? [] : events.filter(e => e.eventId > view.lastEventId);
    const changed = nv.lastEventId !== view.lastEventId || nv.revision !== view.revision || JSON.stringify(nv.confirm) !== JSON.stringify(view.confirm);
    view = nv;
    matTid(nv);
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
  const historik = () => Boolean(strom) && !ansluten;   // hämtat medan strömmen är borta: tyst (L19)
  const getStatus = commandId => api(`/api/status?commandId=${encodeURIComponent(commandId)}&scope=${encodeURIComponent(`match:${view.matchId}`)}`);
  async function refresh({ tyst = false } = {}) {
    try { receive(await api(`/api/match?efterEventId=${view.lastEventId}`), { tyst }); } catch { /* strömmen kommer med nästa vy */ }
  }

  async function send(command) {
    if (pending) return tomKvittens(command.commandId, RECEIPT.rejected, 'Vänta – ditt förra drag behandlas fortfarande.');
    if (strom && !ansluten) return tomKvittens(command.commandId, RECEIPT.rejected, 'Återansluter – välj igen när matchen har hämtats.');
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
        await refresh({ tyst: historik() });
        if (view.revision !== command.revision) return tomKvittens(command.commandId, RECEIPT.rejected, 'Matchläget har ändrats – välj igen.');
        try { receipt = await api('/api/kommando', command); } catch (error) { if (error.final) return tomKvittens(command.commandId, RECEIPT.rejected, error.message); }
      }
      if (!receipt) return tomKvittens(command.commandId, RECEIPT.error, message ?? 'Ingen kontakt med servern. Kontrollera anslutningen och försök igen.');
      if (receipt.status === RECEIPT.ok && receipt.revision !== null && view.revision < receipt.revision) await refresh({ tyst: historik() });
      return receipt;
    } finally {
      pending = null;
      notify([]);
    }
  }

  /* Webbläsaren återansluter själv efter ett avbrott, men ger upp för gott om svaret inte är en ström (t.ex. 502
     från proxyn eller 401). Då öppnas en ny ström med växande paus, efter en kontroll av sessionen. */
  let ersatt = false;
  let paus = 1000;
  let nyttForsok = null;
  function connect(EventSourceCtor = globalThis.EventSource) {
    klocka.clearTimeout(nyttForsok);
    strom?.close();
    const egen = new EventSourceCtor('/api/handelser', { withCredentials: true });
    strom = egen;
    onStatus('ansluter');
    ansluten = false;
    ersatt = false;
    egen.addEventListener('match', event => receive(JSON.parse(event.data)));
    egen.addEventListener('halsa', event => {
      const data = JSON.parse(event.data);
      ansluten = true; paus = 1000;
      /* Gammal sida efter en uppdatering (L21): dragen skulle avvisas som kontraktsfel – säg det tydligt i stället. Ingen
         tvingad omladdning mitt i matchen (huvudplan §11); spelaren väljer själv när. */
      const gammal = data.protocolVersion !== undefined && data.protocolVersion !== PROTOCOL_VERSION;
      onStatus('ansluten', gammal ? 'Spelet har uppdaterats till en ny version. Ladda om sidan för att fortsätta.' : data.matchtrafik.oppen ? null : data.matchtrafik.orsak);
      refresh({ tyst: true });
    });
    egen.addEventListener('ping', event => { fetchFn('/api/livstecken', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: event.data }).catch(() => {}); });
    egen.addEventListener('ersatt', () => { ersatt = true; ansluten = false; egen.close(); onStatus('ersatt'); });
    egen.onerror = () => {
      if (strom !== egen || ersatt) return;
      ansluten = false;
      onStatus('ateransluter');
      if (egen.readyState !== 2) return;   // CONNECTING: webbläsaren försöker själv
      nyttForsok = klocka.setTimeout(async () => { await refresh({ tyst: true }); if (strom === egen && !ersatt) connect(EventSourceCtor); }, paus);
      paus = Math.min(paus * 2, 30_000);
    };
    return egen;
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
    serverNu: () => Date.now() + skillnad,
    ansluten: () => ansluten,
    pa: fn => { onStatus = fn; },
    close: () => { klocka.clearTimeout(nyttForsok); strom?.close(); strom = null; }
  };
}
