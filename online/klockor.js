/* Spelarklockor (arbetsordning L16, beslut 3A, huvudplan §9–10): varje val som servern kräver av en viss
   spelare – kortbyte, målval, kortspel, avstående, startbekräftelse och Fortsätt – får 90 sekunder.
   Därefter slås spelaren ut på tid (lagmatch) eller förlorar (duell).

   Klockorna sparas med matchen som { [spelare]: { nyckel, start, deadline } }. Nyckeln beskriver valet;
   efter varje ändring av matchen räknas kraven om och en klocka behåller sin deadline så länge nyckeln är
   densamma. Vanlig väntan på andra ger inget krav och förbrukar därför ingen tid; markering, avvisade drag
   och omladdning ändrar inte matchen och återställer därför inte klockan.

   Tid: ett kommando är i tid om serverns mottagningstid < deadline; exakt på deadline är för sent.
   Timern läggs i matchens kö (samma ordning som kommandona) och prövar på nytt vilka klockor som verkligen
   har gått ut. Alla som gått ut vid samma tidpunkt behandlas i en och samma händelse, innan vinnaren prövas.
   Före varje nytt matchkommando behandlas klockor som gått ut vid kommandots mottagningstid (kontrollera med
   `tid`), så att en försenad timer aldrig låter ett senare kommando avgöra en match som redan borde ha avgjorts
   av tidsgränsen. En dubbel eller sen timer hittar inget utgånget krav och gör ingenting. Får en utgången klocka ingen effekt
   (motorfel, som rullas tillbaka) stoppas matchens timer och felet loggas, i stället för att planeras om i en
   tät slinga; nästa godkända kommando planerar den igen. Inga timers överlever en serveromstart: gamla
   pågående matcher stängs av startspärren tills L18. */
export const TURTID_MS = 90_000;
export const VARNING_MS = 20_000;   // klienterna varnar när mindre än så här återstår
export const TIDEN_UTE = 'Tiden för ditt val har gått ut.';

/* Nya klockor ur kraven { [spelare]: nyckel }: samma nyckel behåller sin deadline, ett nytt val får 90 s. */
export function uppdateraKlockor(gamla, krav, now) {
  const nya = {};
  for (const [playerId, nyckel] of Object.entries(krav)) {
    const g = gamla?.[playerId];
    nya[playerId] = g && g.nyckel === nyckel ? g : { nyckel, start: now, deadline: now + TURTID_MS };
  }
  return nya;
}

/* Spelare vars deadline har passerats vid `now` (exakt på deadline räknas som för sent). */
export const utgangna = (klockor, now) => Object.entries(klockor ?? {}).filter(([, k]) => k.deadline <= now).map(([id]) => id);

/* Har spelaren ett krav vars tid redan gått ut när kommandot togs emot? */
export const forSent = (klockor, playerId, mottagen) => Boolean(klockor?.[playerId]) && klockor[playerId].deadline <= mottagen;

export const forstaDeadline = klockor => {
  const tider = Object.values(klockor ?? {}).map(k => k.deadline);
  return tider.length ? Math.min(...tider) : null;
};

/* Timers per match. `tidsgrans({ ops, matchId, now, slump })` (matcher.js) behandlar utgångna klockor i en
   transaktion och returnerar true om något ändrades; `klockorFor(matchId)` läser matchens sparade klockor. */
export function skapaTurklockor({ lagring, klocka, ko, slump, tidsgrans, klockorFor, logg = { info() {}, warn() {}, error() {} } }) {
  const timers = new Map();     // matchId -> { id, at }
  const pagaende = new Set();   // köade timerkörningar (för tester och avstängning)
  const lyssnare = new Set();
  let stangd = false;

  function planera(matchId) {
    if (stangd) return;
    const at = forstaDeadline(klockorFor(matchId));
    const gammal = timers.get(matchId);
    if (gammal && gammal.at === at) return;
    if (gammal) { klocka.clearTimeout(gammal.id); timers.delete(matchId); }
    if (at === null) return;
    const id = klocka.setTimeout(() => {
      if (timers.get(matchId)?.id === id) timers.delete(matchId);
      const korning = ko.kor(`match:${matchId}`, () => kontrollera(matchId)).finally(() => pagaende.delete(korning));
      pagaende.add(korning);
    }, Math.max(0, at - klocka.now()));
    timers.set(matchId, { id, at });
  }

  function kontrollera(matchId, tid = klocka.now()) {
    const now = tid;
    let andrat = false;
    try {
      andrat = lagring.transaktion(ops => tidsgrans({ ops, matchId, now, slump })) === true;
      if (andrat) logg.info(`[klockor] tidsgräns i match:${matchId}`);
    } catch (error) {
      logg.error(`[klockor] match:${matchId}: ${error.message}`);   // inget sparas; ingen falsk vinst
      return false;   // timern stoppas: en omplanering skulle gå ut direkt och snurra
    }
    if (!andrat && (forstaDeadline(klockorFor(matchId)) ?? Infinity) <= now) {
      logg.warn(`[klockor] match:${matchId}: utgången klocka utan effekt – timern stoppas tills nästa kommando`);
      return false;
    }
    planera(matchId);
    if (andrat) for (const fn of lyssnare) { try { fn(matchId); } catch (error) { logg.warn(`[klockor] utskick: ${error.message}`); } }
    return andrat;
  }

  return {
    planera,
    kontrollera,
    pa(fn) { lyssnare.add(fn); return () => lyssnare.delete(fn); },
    klart: async () => { while (pagaende.size) await Promise.all([...pagaende]); },
    timers: () => timers.size,
    stang() { stangd = true; for (const { id } of timers.values()) klocka.clearTimeout(id); timers.clear(); }
  };
}
