/* Speltjänsten (arbetsordning L02): tar emot validerade kommandon, kör dem ett i taget per rum/match,
   deduplicerar på commandId och sparar läge, händelser och kvittens i samma transaktion.
   Vad varje kommando gör registreras av senare uppgifter (L03–L05 lobby, L08/L14 match) med
   registrera(typ, hanterare). En hanterare får { playerId, command, ops, klocka, slump, mottagen } och returnerar
   { status, message, revision, roomRevision, eventId }. Vid AVVISAD rullas hanterarens skrivningar
   tillbaka; vid kastat fel sparas ingenting och svaret blir INTERNT_FEL.
   L16: `mottagen` är serverns tid när kommandot togs emot, innan det köades – tidsgränser prövas mot den, så att
   tid i kö eller databas aldrig räknas som att spelaren kom för sent. `foreHantering(fn)` anropas i kön före
   varje nytt matchkommando (efter dedupe) så att redan utgångna tidsgränser behandlas innan kommandot kan avgöra
   matchen; `efterGodkand(fn)` anropas efter varje sparat godkänt kommando (t.ex. för att planera turklockor). */
import { validateCommand, validateReceipt, commandFingerprint, MATCH_COMMAND, RECEIPT } from '../kontrakt.js';
import { skapaKo } from './ko.js';

export const systemklocka = Object.freeze({ now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) });
const tystLogg = { info() {}, warn() {}, error() {} };

export function skapaTjanst({ lagring, klocka = systemklocka, slump = Math.random, logg = tystLogg }) {
  const hanterare = new Map();
  const efterGodkand = new Set();
  const foreHantering = new Set();
  const ko = skapaKo();
  const isMatchCommand = type => Object.values(MATCH_COMMAND).includes(type);

  /* Matchtrafiken är öppen. Startspärren från L02 är borttagen (L18): servern avbryter gamla pågående matcher
     innan den öppnar (matcher.avbrytEfterOmstart), och öppnar inte alls om det misslyckas. Spärren finns kvar
     som en strömbrytare (t.ex. för underhåll); den stänger matchkommandon och nya starter, inte lobbyn. */
  const matchtrafik = { oppen: true, orsak: null };

  const scopeOf = (playerId, command) => command.matchId ? `match:${command.matchId}` : command.roomId ? `rum:${command.roomId}` : `spelare:${playerId}`;
  const kvittens = (commandId, status, message, extra = {}) => validateReceipt({ commandId, status, message, revision: null, roomRevision: null, eventId: null, fingerprint: null, ...extra });

  async function kommando(playerId, raw) {
    const command = validateCommand(raw);   // ContractError går vidare till anroparen (HTTP 400)
    const mottagen = klocka.now();
    if (isMatchCommand(command.type) && !matchtrafik.oppen) return kvittens(command.commandId, RECEIPT.rejected, matchtrafik.orsak);
    const scope = scopeOf(playerId, command);
    const fingerprint = commandFingerprint(command);
    return ko.kor(scope, () => {
      const kand = lagring.hamtaKvittens(playerId, scope, command.commandId);
      if (kand) {
        if (kand.fingerprint === fingerprint) return kand.receipt;
        return kvittens(command.commandId, RECEIPT.rejected, 'Samma commandId har redan använts med annat innehåll.');
      }
      const hantera = hanterare.get(command.type);
      if (!hantera) return kvittens(command.commandId, RECEIPT.rejected, 'Kommandot stöds inte ännu.');
      for (const fn of foreHantering) { try { fn({ playerId, command, mottagen }); } catch (error) { logg.warn(`[tjanst] före kommando: ${error.message}`); } }
      let avvisning = null;
      try {
        const receipt = lagring.transaktion(ops => {
          const result = hantera({ playerId, command, ops, klocka, slump, mottagen });
          if (result.status === RECEIPT.rejected) { avvisning = result; throw new Avvisad(); }
          if (result.status !== RECEIPT.ok) throw new Error(`Hanteraren svarade ${result.status}; endast GODKÄND eller AVVISAD är tillåtet.`);
          const godkand = kvittens(command.commandId, RECEIPT.ok, result.message ?? null, { revision: result.revision ?? null, roomRevision: result.roomRevision ?? null, eventId: result.eventId ?? null, fingerprint });
          ops.sparaKvittens({ playerId, scope, commandId: command.commandId, fingerprint, receipt: godkand });
          return godkand;
        });
        logg.info(`[tjanst] ${command.type} ${scope} GODKÄND`);
        for (const fn of efterGodkand) { try { fn({ playerId, command, receipt }); } catch (error) { logg.warn(`[tjanst] efter godkänt kommando: ${error.message}`); } }
        return receipt;
      } catch (error) {
        if (!(error instanceof Avvisad)) {
          logg.error(`[tjanst] ${command.type} ${scope} INTERNT_FEL: ${error.message}`);   // aldrig nyttolast eller matchläge i loggen
          return kvittens(command.commandId, RECEIPT.error, 'Draget kunde inte sparas. Kontrollera status och försök igen.');
        }
      }
      const avvisad = kvittens(command.commandId, RECEIPT.rejected, avvisning.message ?? 'Avvisat.', { revision: avvisning.revision ?? null, roomRevision: avvisning.roomRevision ?? null });
      try { lagring.sparaKvittens({ playerId, scope, commandId: command.commandId, fingerprint, receipt: avvisad }); } catch (error) { logg.warn(`[tjanst] kvittens för avvisat kommando sparades inte: ${error.message}`); }
      logg.info(`[tjanst] ${command.type} ${scope} AVVISAD`);
      return avvisad;
    });
  }

  /* Statusfråga för ett tidigare commandId: känd kvittens eller OKÄND. */
  function status(playerId, scope, commandId) {
    const kand = lagring.hamtaKvittens(playerId, scope, commandId);
    return kand ? kand.receipt : kvittens(commandId, RECEIPT.unknown, null);
  }

  return {
    klocka, slump, matchtrafik, kommando, status, scopeOf, ko,
    registrera(typ, fn) { hanterare.set(typ, fn); },
    efterGodkand(fn) { efterGodkand.add(fn); return () => efterGodkand.delete(fn); },
    foreHantering(fn) { foreHantering.add(fn); return () => foreHantering.delete(fn); },
    hanterar: typ => hanterare.has(typ)
  };
}

class Avvisad extends Error {}
