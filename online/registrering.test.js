import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skapaRegistreringsvakt, klientadress, REGISTRERING_FONSTER_MS } from './registrering.js';
import { styrdKlocka } from '../teststod.js';

test('Registreringsgränsen gäller per adress, ger väntetid och släpper exakt vid fönstrets slut', () => {
  const klocka = styrdKlocka();
  const vakt = skapaRegistreringsvakt({ klocka, maxPerIp: 2 });
  assert.equal(vakt.prova('a'), 0);
  assert.equal(vakt.prova('a'), 0);
  assert.equal(vakt.prova('a'), 60);
  assert.equal(vakt.prova('b'), 0, 'en annan adress har en egen kvot');
  klocka.advance(REGISTRERING_FONSTER_MS - 1);
  assert.equal(vakt.prova('a'), 1);
  klocka.advance(1);
  assert.equal(vakt.prova('a'), 0);
  vakt.rensa();
  assert.equal(vakt.prova('b'), 0);
});

test('Registreringsvakten begränsar även minnet vid många adresser och släpper gamla poster', () => {
  const klocka = styrdKlocka();
  const vakt = skapaRegistreringsvakt({ klocka, maxPerIp: 1 });
  for (let i = 0; i < 10_000; i++) assert.equal(vakt.prova(`ip-${i}`), 0);
  assert.equal(vakt.prova('ytterligare-adress'), 60);
  klocka.advance(REGISTRERING_FONSTER_MS);
  assert.equal(vakt.prova('ytterligare-adress'), 0);
  for (const maxPerIp of [0, -1, NaN, Infinity, 1.5, 10001]) assert.throws(() => skapaRegistreringsvakt({ klocka, maxPerIp }));
});

test('Klientadressen betros bara från lokal proxy och godtar bara en giltig IP-adress', () => {
  const req = (remoteAddress, forwarded) => ({ socket: { remoteAddress }, headers: { 'x-tornstriden-client-ip': forwarded } });
  assert.equal(klientadress(req('198.51.100.1', '203.0.113.9')), '198.51.100.1', 'extern klient kan inte välja adress');
  assert.equal(klientadress(req('127.0.0.1', '203.0.113.9')), '203.0.113.9');
  assert.equal(klientadress(req('::1', '2001:db8::1')), '2001:db8::1');
  assert.equal(klientadress(req('::ffff:127.0.0.1', undefined)), '127.0.0.1');
  for (const bad of ['203.0.113.9, 203.0.113.10', 'okand', '', ['203.0.113.9']]) assert.equal(klientadress(req('127.0.0.1', bad)), '127.0.0.1');
});
