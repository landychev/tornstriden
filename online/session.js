/* Gästsessioner (arbetsordning L03, beslut 4A): nick utan konto. Sessionen – inte nicket – är
   identiteten. Klienten har en slumpad token i en HttpOnly-kaka; databasen har bara dess SHA-256.
   Nick är unika (skiftlägesokänsligt) bland sessioner som inte gått ut; utgångna sessioner gallras
   innan ett nick prövas. Sessionen förlängs glidande vid aktivitet och går ut efter SESSION_TTL_MS. */
import { createHash, randomBytes } from 'node:crypto';
import { ACTIVITY, CONNECTION, LOBBY_COMMAND, RECEIPT, normalizeNick, publicSession, validateSession } from '../kontrakt.js';

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const TOUCH_INTERVAL_MS = 60 * 1000;   // skriv last_seen högst en gång per minut
export const MAX_SESSIONS = 200;
export const hashToken = token => createHash('sha256').update(token).digest('hex');

export class SessionsFel extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function skapaSessioner({ lagring, klocka }) {
  const now = () => klocka.now();
  const nyToken = () => randomBytes(32).toString('hex');       // hemligheter kommer alltid från crypto, aldrig från spelslumpen
  const nyttId = () => `p-${randomBytes(6).toString('hex')}`;

  /* Nicket är ledigt om ingen levande session har samma nyckel. Utgångna gallras på köpet. */
  function kravLedigtNick(nickKey, egetPlayerId = null) {
    lagring.raderaUtgangnaSessioner(now());
    const annan = lagring.hamtaSessionMedNickKey(nickKey);
    if (annan && annan.playerId !== egetPlayerId) throw new SessionsFel(409, 'Nicket är upptaget – välj ett annat.');
  }

  function skapa(nickRaw) {
    const { nick, key } = normalizeNick(nickRaw);
    return lagring.transaktion(ops => {
      kravLedigtNick(key);
      if (ops.raknaSessioner(now()) >= MAX_SESSIONS) throw new SessionsFel(503, 'Lobbyn är full just nu – försök igen om en stund.');
      const token = nyToken();
      const t = now();
      const session = validateSession({
        playerId: nyttId(), nick, nickKey: key, tokenHash: hashToken(token), createdAt: t, lastSeenAt: t, expiresAt: t + SESSION_TTL_MS,
        activity: ACTIVITY.idle, connection: CONNECTION.offline, roomId: null, matchId: null, connectionGeneration: 0
      });
      ops.sparaSession(session);
      return { session, token };
    });
  }

  /* Token -> session, eller null. Förlänger giltigheten glidande (högst en skrivning per minut). */
  function hamta(token) {
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
    const session = lagring.hamtaSessionMedHash(hashToken(token));
    if (!session) return null;
    const t = now();
    if (session.expiresAt <= t) { lagring.raderaSession(session.playerId); return null; }
    if (t - session.lastSeenAt >= TOUCH_INTERVAL_MS) {
      session.lastSeenAt = t;
      session.expiresAt = t + SESSION_TTL_MS;
      lagring.sparaSession(session);
    }
    return session;
  }

  const kravSession = playerId => {
    const session = lagring.hamtaSession(playerId);
    if (!session || session.expiresAt <= now()) throw new SessionsFel(401, 'Sessionen har gått ut. Välj nick igen.');
    return session;
  };

  function bytNick(playerId, nickRaw) {
    const { nick, key } = normalizeNick(nickRaw);
    return lagring.transaktion(ops => {
      const session = kravSession(playerId);
      if (session.activity !== ACTIVITY.idle) throw new SessionsFel(409, 'Nicket kan bara bytas utanför rum och match.');
      kravLedigtNick(key, playerId);
      ops.sparaSession({ ...session, nick, nickKey: key });
      return { ...session, nick, nickKey: key };
    });
  }

  /* En ny styrande anslutning: generationen ökar så att ett sent close från en gammal
     anslutning (eller en extra flik) inte kan markera spelaren som frånkopplad. */
  function anslut(playerId) {
    return lagring.transaktion(ops => {
      const session = kravSession(playerId);
      const generation = session.connectionGeneration + 1;
      ops.sparaSession({ ...session, connection: CONNECTION.online, connectionGeneration: generation, lastSeenAt: now(), expiresAt: now() + SESSION_TTL_MS });
      return generation;
    });
  }

  function kopplaFran(playerId, generation) {
    return lagring.transaktion(ops => {
      const session = lagring.hamtaSession(playerId);
      if (!session || session.connectionGeneration !== generation || session.connection === CONNECTION.offline) return false;
      ops.sparaSession({ ...session, connection: CONNECTION.offline });
      return true;
    });
  }

  /* Efter en serverstart finns inga öppna anslutningar; sparad status rättas. */
  function markeraAllaFrankopplade() {
    lagring.transaktion(ops => {
      for (const session of ops.listaSessioner(now())) if (session.connection !== CONNECTION.offline) ops.sparaSession({ ...session, connection: CONNECTION.offline });
    });
  }

  const lobbylista = () => lagring.listaSessioner(now()).map(publicSession).sort((a, b) => a.nick.localeCompare(b.nick, 'sv'));

  function lamna(playerId) {
    return lagring.transaktion(ops => {
      const session = lagring.hamtaSession(playerId);
      if (!session) return false;
      if (session.activity !== ACTIVITY.idle) throw new SessionsFel(409, 'Lämna rummet eller matchen först.');
      ops.raderaSession(playerId);
      return true;
    });
  }

  /* Kommandot SÄTT_NICK går genom tjänstens kö och kvittenser. */
  function registrera(tjanst) {
    tjanst.registrera(LOBBY_COMMAND.nick, ({ playerId, command }) => {
      try { bytNick(playerId, command.payload.nick); return { status: RECEIPT.ok }; }
      catch (error) { if (error instanceof SessionsFel) return { status: RECEIPT.rejected, message: error.message }; throw error; }
    });
  }

  return { skapa, hamta, bytNick, anslut, kopplaFran, markeraAllaFrankopplade, lobbylista, lamna, registrera, rensaUtgangna: () => lagring.raderaUtgangnaSessioner(now()) };
}
