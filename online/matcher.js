/* Val av regelmotor (arbetsordning L14): samma serverflöde startar en duell (2 deltagare, duell.js) eller
   en lagmatch (4/6/8, lagspel.js). Rummets starttransaktion anropar motorn för deltagarantalet; därefter
   går varje matchkommando och varje vyhämtning till den modul som skapade matchen. Kö, transaktion,
   kvittenser och lagring är gemensamma (tjanst.js, lagring.js).

   `lagspel: false` håller lagformaten stängda i lobbyn (startkontrollen säger då att formatet inte är
   tillgängligt). Sedan lagvyn finns (L15) är de öppna som standard.

   Spelarklockor (L16): efter varje godkänt kommando planeras matchens timer om (klockor.js). Timern körs i
   matchens kö och går till samma modul som matchen (tidsgrans). `pa(fn)` meddelar servern efter en tidsgräns.

   Anslutningsavbrott (L17): servern anropar `frankopplad(spelare, generation, tid)` när en anslutning försvinner
   (stängd eller tyst) och `ansluten(spelare, generation, tid)` när en ny öppnas. Båda körs i spelarens matchkö
   tillsammans med kommandon och timers; `tid` är mottagningstiden.

   Serveromstart (L18, beslut 27B): `avbrytEfterOmstart()` körs innan servern öppnar. Varje match som fortfarande
   är PÅGÅR från förra körningen avbryts utan vinnare (SERVERAVBROTT) i en egen transaktion tillsammans med sin
   sluthändelse. Statusen prövas i transaktionen, så en ny omstart mitt i uppstädningen ger aldrig dubbla
   sluthändelser. Ett lagringsfel kastas vidare – servern ska då inte öppna. */
import { skapaDuell } from './duell.js';
import { skapaLagspel, LAG_FORMAT } from './lagspel.js';
import { TEAM_SIZES } from '../lagregler.js';
import { MATCH_COMMAND, MATCH_STATUS, RECEIPT } from '../kontrakt.js';
import { skapaTurklockor } from './klockor.js';

export function skapaMatcher({ lagring, klocka, rum, lagspel = true }) {
  const duell = skapaDuell({ lagring, klocka, rum });
  const lag = skapaLagspel({ lagring, klocka, rum });
  const modulFor = post => post?.format === LAG_FORMAT ? lag : duell;

  function hantera(args) {
    const rad = args.ops.hamtaMatch(args.command.matchId);
    if (!rad) return { status: RECEIPT.rejected, message: 'Matchen finns inte.' };
    return modulFor(rad.match).hantera(args);
  }

  function matchFor(playerId, options = {}) {
    const matchId = lagring.hamtaSession(playerId)?.matchId;
    const rad = matchId ? lagring.hamtaMatch(matchId) : null;
    return rad ? modulFor(rad.match).matchFor(playerId, options) : null;
  }

  function tidsgrans(args) {
    const rad = args.ops.hamtaMatch(args.matchId);
    return rad ? modulFor(rad.match).tidsgrans(args) : false;
  }

  /* Spelarens pågående match (för anslutningshändelser). */
  const aktivMatch = playerId => lagring.hamtaSession(playerId)?.matchId ?? null;
  const modulForMatch = matchId => modulFor(lagring.hamtaMatch(matchId)?.match);

  /* `nad`: strömmen stängdes nyss och nåden löper – registrera bara om turklockan hinner gå ut under nåden. */
  function frankopplad(playerId, generation, tid = klocka.now(), { nad = 0 } = {}) {
    const matchId = aktivMatch(playerId);
    if (!matchId || !klockor) return Promise.resolve(false);
    return klockor.handelse(matchId, tid, ops => modulForMatch(matchId).avbrott({ ops, matchId, playerId, generation, now: tid, nad }), { fore: true });
  }
  function ansluten(playerId, generation, tid = klocka.now()) {
    const matchId = aktivMatch(playerId);
    if (!matchId || !klockor) return Promise.resolve(false);
    return klockor.handelse(matchId, tid, ops => modulForMatch(matchId).ateranslutning({ ops, matchId, playerId, generation, now: tid }));
  }

  function avbrytEfterOmstart() {
    const matcher = lagring.pagaendeMatcher();
    let avbrutna = 0;
    for (const matchId of matcher) {
      const gjort = lagring.transaktion(ops => {
        const rad = ops.hamtaMatch(matchId);
        if (!rad || rad.status !== MATCH_STATUS.active) return false;   // redan städad av en tidigare start
        modulFor(rad.match).serveravbrott({ ops, post: rad.match });
        return true;
      });
      if (gjort) avbrutna += 1;
    }
    return { avbrutna, matcher };
  }

  let klockor = null;
  const lyssnare = new Set();
  function registrera(tjanst) {
    rum.registreraMotor(2, duell.fabrik);
    if (lagspel) for (const size of TEAM_SIZES) rum.registreraMotor(size, lag.fabrik);
    for (const type of Object.values(MATCH_COMMAND)) tjanst.registrera(type, hantera);
    klockor = skapaTurklockor({ lagring, klocka, ko: tjanst.ko, slump: tjanst.slump, tidsgrans, post: matchId => lagring.hamtaMatch(matchId)?.match ?? null });
    klockor.pa(matchId => { for (const fn of lyssnare) fn(matchId); });
    /* Klockor som gått ut när ett kommando togs emot behandlas före kommandot (en sen timer får inte låta ett
       Lämna eller ett avgörande drag ge fel vinnare). Utslagningen sparas i en egen transaktion och står kvar även
       om kommandot sedan avvisas. */
    tjanst.foreHantering(({ command, mottagen }) => { if (command.matchId) klockor.kontrollera(command.matchId, mottagen); });
    /* Matchdrag och rummets start (som skapar matchen) ändrar vilka klockor som går. */
    tjanst.efterGodkand(({ playerId, command }) => {
      const matchId = command.matchId ?? lagring.hamtaSession(playerId)?.matchId;
      if (matchId) klockor.planera(matchId);
    });
  }

  return {
    duell, lag, hantera, matchFor, registrera, tidsgrans, frankopplad, ansluten, avbrytEfterOmstart,
    pa(fn) { lyssnare.add(fn); return () => lyssnare.delete(fn); },
    klockor: () => klockor,
    /* Avstängning: inga nya timers, och en redan köad kontroll får bli klar innan lagringen stängs. */
    async stang() { klockor?.stang(); await klockor?.klart(); }
  };
}
