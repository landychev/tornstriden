/* Val av regelmotor (arbetsordning L14): samma serverflöde startar en duell (2 deltagare, duell.js) eller
   en lagmatch (4/6/8, lagspel.js). Rummets starttransaktion anropar motorn för deltagarantalet; därefter
   går varje matchkommando och varje vyhämtning till den modul som skapade matchen. Kö, transaktion,
   kvittenser och lagring är gemensamma (tjanst.js, lagring.js).

   `lagspel: false` håller lagformaten stängda i lobbyn (startkontrollen säger då att formatet inte är
   tillgängligt). Sedan lagvyn finns (L15) är de öppna som standard. */
import { skapaDuell } from './duell.js';
import { skapaLagspel, LAG_FORMAT } from './lagspel.js';
import { TEAM_SIZES } from '../lagregler.js';
import { MATCH_COMMAND, RECEIPT } from '../kontrakt.js';

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

  function registrera(tjanst) {
    rum.registreraMotor(2, duell.fabrik);
    if (lagspel) for (const size of TEAM_SIZES) rum.registreraMotor(size, lag.fabrik);
    for (const type of Object.values(MATCH_COMMAND)) tjanst.registrera(type, hantera);
  }

  return { duell, lag, hantera, matchFor, registrera };
}
