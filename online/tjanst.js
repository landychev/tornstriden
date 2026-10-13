/* Speltjänsten (arbetsordning L02): tar emot validerade kommandon, kör dem ett i taget per rum/match,
   deduplicerar på commandId och sparar läge, händelser och kvittens i samma transaktion.
   Vad varje kommando gör registreras av senare uppgifter (L03–L05 lobby, L08/L14 match) med
   registrera(typ, hanterare). En hanterare får { playerId, command, ops, klocka, slump } och returnerar
   { status, message, revision, roomRevision, eventId }. Vid AVVISAD rullas hanterarens skrivningar
   tillbaka; vid kastat fel sparas ingenting och svaret blir INTERNT_FEL. */
import { validateCommand, validateReceipt, commandFingerprint, MATCH_COMMAND, RECEIPT } from '../kontrakt.js';
import { skapaKo } from './ko.js';

export const systemklocka = Object.freeze({ now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) });
const tystLogg = { info() {}, warn() {}, error() {} };

export function skapaTjanst({ lagring, klocka = systemklocka, slump = Math.random, logg = tystLogg }) {
  const hanterare = new Map();
  const ko = skapaKo();
  const isMatchCommand = type => Object.values(MATCH_COMMAND).includes(type);

  /* Startspärr till L18: gamla pågående matcher får inte återupptas och får inte heller få nya drag. */
  const gamla = lagring.pagaendeMatcher();
  const matchtrafik = gamla.length
    ? { oppen: false, orsak: `Servern startades om med ${gamla.length} pågående match(er). Matchtrafik är stängd tills avbrottshanteringen (L18) finns.`, matcher: gamla }
    : { oppen: true, orsak: null, matcher: [] };
  if (!matchtrafik.oppen) logg.warn(`[tjanst] ${matchtrafik.orsak}`);

  const scopeOf = (playerId, command) => command.matchId ? `match:${command.matchId}` : command.roomId ? `rum:${command.roomId}` : `spelare:${playerId}`;
  const kvittens = (commandId, status, message, extra = {}) => validateReceipt({ commandId, status, message, revision: null, roomRevision: null, eventId: null, fingerprint: null, ...extra });

  async function kommando(playerId, raw) {
    const command = validateCommand(raw);   // ContractError går vidare till anroparen (HTTP 400)
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
      let avvisning = null;
      try {
        const receipt = lagring.transaktion(ops => {
          const result = hantera({ playerId, command, ops, klocka, slump });
          if (result.status === RECEIPT.rejected) { avvisning = result; throw new Avvisad(); }
          if (result.status !== RECEIPT.ok) throw new Error(`Hanteraren svarade ${result.status}; endast GODKÄND eller AVVISAD är tillåtet.`);
          const godkand = kvittens(command.commandId, RECEIPT.ok, result.message ?? null, { revision: result.revision ?? null, roomRevision: result.roomRevision ?? null, eventId: result.eventId ?? null, fingerprint });
          ops.sparaKvittens({ playerId, scope, commandId: command.commandId, fingerprint, receipt: godkand });
          return godkand;
        });
        logg.info(`[tjanst] ${command.type} ${scope} GODKÄND`);
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
    hanterar: typ => hanterare.has(typ)
  };
}

class Avvisad extends Error {}
