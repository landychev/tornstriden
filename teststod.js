/* Teststöd för regel- och servertester (arbetsordning L01): styrd klocka, styrd slump och
   separata spelarsessioner. Inga verkliga väntetider – tester för 30/90 sekunder
   flyttar klockan med advance(). Används bara av tester, publiceras inte. */
import { ACTIVITY, CONNECTION, normalizeNick } from './kontrakt.js';

/* Styrd klocka: now() står stilla tills advance(ms) anropas. Timers som förfaller under
   advance körs i tidsordning (lika tid: i registreringsordning) med now() satt till sin
   förfallotid, så att en timer kan registrera nya timers som i sin tur hinner förfalla. */
export function styrdKlocka(start = 0) {
  let now = start;
  let sequence = 0;
  const timers = [];
  const next = until => timers.filter(t => t.at <= until).sort((a, b) => a.at - b.at || a.id - b.id)[0];
  return {
    now: () => now,
    setTimeout(fn, ms = 0) { const timer = { id: ++sequence, at: now + Math.max(0, ms), fn }; timers.push(timer); return timer.id; },
    clearTimeout(id) { const index = timers.findIndex(t => t.id === id); if (index !== -1) timers.splice(index, 1); },
    advance(ms) {
      const until = now + ms;
      for (let timer = next(until); timer; timer = next(until)) {
        timers.splice(timers.indexOf(timer), 1);
        now = timer.at;
        timer.fn();
      }
      now = until;
    },
    pending: () => timers.length
  };
}

/* Styrd slump (mulberry32): samma frö ger samma serie i [0, 1). Ersätter Math.random. */
export function styrdSlump(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hexFrom = (random, bytes = 16) => Array.from({ length: bytes }, () => Math.floor(random() * 256).toString(16).padStart(2, '0')).join('');

/* Testhash för token: markerad som test så att den aldrig förväxlas med serverns riktiga hash (väljs i L03). */
const fnv = (text, seed) => [...text].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), seed).toString(16).padStart(8, '0');
export const testHash = token => `test-${fnv(token, 2166136261)}${fnv(token, 0x9747b28c)}`;

/* Separata spelarsessioner med olika identitet och token. Varje post har serverns sessionsobjekt
   (utan token) och klientens hemliga token separat, så att tester kan skicka rätt/fel token. */
export function testSessioner(count, { random = styrdSlump(7), clock = styrdKlocka(), nicks = [], ttlMs = 24 * 60 * 60 * 1000, hash = testHash } = {}) {
  return Array.from({ length: count }, (_, i) => {
    const { nick, key } = normalizeNick(nicks[i] ?? `Spelare ${i + 1}`);
    const token = hexFrom(random, 32);
    const session = {
      playerId: `p${i + 1}-${hexFrom(random, 4)}`, nick, nickKey: key, tokenHash: hash(token),
      createdAt: clock.now(), lastSeenAt: clock.now(), expiresAt: clock.now() + ttlMs,
      activity: ACTIVITY.idle, connection: CONNECTION.online, roomId: null, matchId: null, connectionGeneration: 1
    };
    return { token, session, playerId: session.playerId, nick };
  });
}

/* Samlar vyer/händelser som en adapter eller server skickar, för kontroll i tester. */
export function samlare() {
  const items = [];
  return { push: (...args) => { items.push(args.length === 1 ? args[0] : args); }, items, last: () => items.at(-1), clear: () => { items.length = 0; } };
}
