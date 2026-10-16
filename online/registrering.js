/* Begränsar nya gästsessioner, inte livstecken eller återupptagning av en befintlig session.
   Apache skriver över X-Tornstriden-Client-IP; den betros bara från en proxy på loopback. */
import { isIP } from 'node:net';

export const REGISTRERING_FONSTER_MS = 60_000;
export const REGISTRERINGAR_PER_MINUT = 20;
const MAX_ADRESSER = 10_000;
const loopback = ip => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

export function klientadress(req) {
  const peer = req.socket.remoteAddress;
  const forwarded = req.headers['x-tornstriden-client-ip'];
  const ip = loopback(peer) && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : peer;
  return ip?.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip ?? 'okand';
}

export function skapaRegistreringsvakt({ klocka, maxPerIp = REGISTRERINGAR_PER_MINUT }) {
  if (!Number.isInteger(maxPerIp) || maxPerIp < 1 || maxPerIp > 10_000) throw new Error('Registreringsgränsen måste vara ett heltal mellan 1 och 10000.');
  const adresser = new Map();
  function rensa() {
    for (const [ip, post] of adresser) if (post.slut <= klocka.now()) adresser.delete(ip);
  }
  /* Returnerar 0 om anropet får fortsätta, annars väntetiden i hela sekunder. */
  function prova(ip) {
    const nu = klocka.now();
    let post = adresser.get(ip);
    if (!post || post.slut <= nu) {
      if (adresser.size >= MAX_ADRESSER) {
        rensa();
        if (adresser.size >= MAX_ADRESSER) return Math.ceil(REGISTRERING_FONSTER_MS / 1000);
      }
      post = { antal: 0, slut: nu + REGISTRERING_FONSTER_MS };
      adresser.set(ip, post);
    }
    if (post.antal >= maxPerIp) return Math.max(1, Math.ceil((post.slut - nu) / 1000));
    post.antal += 1;
    return 0;
  }
  return { prova, rensa };
}
