/* Regressioner R01/R04: verklig matchvy, HTML-liknande nick i flera faser och återgång
   efter rumsstädning. Kör: node scripts/prova-regressioner.mjs (PLAYWRIGHT_CHANNEL=chrome valfritt). */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startaServer } from '../online/server.js';
import { STADNING_ALDER_MS } from '../online/rum.js';
import { styrdKlocka, styrdSlump } from '../teststod.js';
import { MATCH_COMMAND, PROTOCOL_VERSION, RECEIPT } from '../kontrakt.js';
import { PHASE } from '../match.js';

const klocka = styrdKlocka(100000);
const app = startaServer({ port: 0, dataDir: ':memory:', klocka, slump: styrdSlump(5), logg: { info() {}, warn() {}, error() {} } });
await app.klar;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  const base = `http://127.0.0.1:${app.port()}`;
  const nick = '<b onclick=top.z=1>';
  const a = app.sessioner.skapa(nick), b = app.sessioner.skapa('" onclick=top.z=2 x=');
  const guests = { A: a, B: b };
  for (const g of [a, b]) app.sessioner.anslut(g.session.playerId);
  const aid = a.session.playerId, bid = b.session.playerId;
  const room = app.rum.skapa(aid);
  app.rum.bjudIn(aid, room.id, [bid]);
  app.rum.acceptera(bid, app.rum.vyFor(bid).inbjudningar.inkommande[0].id);
  app.rum.valjLag(aid, room.id, 'A'); app.rum.valjLag(bid, room.id, 'B');
  const rv = app.lagring.hamtaRum(room.id).rosterVersion;
  app.rum.redo(aid, room.id, true, rv); app.rum.redo(bid, room.id, true, rv);
  app.rum.starta(aid, room.id, rv);
  const view = (seat = 'B') => app.duell.matchFor(guests[seat].session.playerId).view;
  let n = 0;
  async function send(seat, type, payload = {}) {
    const v = view(seat);
    const response = await fetch(base + '/api/kommando', {
      method: 'POST', headers: { origin: base, 'content-type': 'application/json', cookie: `tornstriden_session=${guests[seat].token}` },
      body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: `reg-${++n}`, matchId: v.matchId, revision: v.revision, type, payload })
    });
    const receipt = await response.json();
    assert.equal(receipt.status, RECEIPT.ok, receipt.message);
  }
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.addCookies([{ name: 'tornstriden_session', value: b.token, url: base }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  async function render() {
    await page.goto(base + '/match.html?online=1');
    /* Efter matchslut stängs spelförklaringen av sig själv så att resultatet syns direkt (L16). */
    await page.locator('#intro-dialog[open], #result-dialog[open]').first().waitFor();
    if (await page.locator('#intro-dialog[open]').count()) await page.click('#intro-close');
    if (await page.locator('#swap-dialog[open]').count()) await page.click('#swap-close');
  }
  async function safe(label, selector) {
    assert.ok((await page.locator(selector).textContent()).includes(nick), `${label}: nicket visas bokstavligt`);
    assert.equal(await page.locator('[onclick], [onmouseover]').count(), 0, `${label}: inga injicerade händelseattribut`);
    assert.equal(await page.locator('#hand-info b, #selection-info b, #result b').count(), 0, `${label}: inget injicerat b-element`);
    assert.equal(await page.evaluate(() => window.z), undefined);
    console.log(`OK ${label}`);
  }
  await render();
  await safe('Väntan under kortbytet', '#hand-info');
  for (let i = 0; i < 4; i++) await send(view().activePlayer, MATCH_COMMAND.swap, { cards: [] });
  for (const seat of ['A', 'B']) await send(seat, MATCH_COMMAND.confirmStart);
  // Två strider gör båda nicken till anfallare respektive nästa anfallare.
  for (let i = 0; i < 2; i++) {
    const attacker = view().activePlayer;
    await send(attacker, MATCH_COMMAND.attack, { instanceId: view(attacker).me.hand[0].instanceId, usage: 'simple' });
    await render();
    assert.equal(await page.locator('[onclick], [onmouseover]').count(), 0, 'kortets aria-label skyddas även mot citattecken');
    await send(view().activePlayer, MATCH_COMMAND.pass);
    assert.equal(view().phase, PHASE.result);
    await render();
    await page.locator('#result-dialog[open]').waitFor();
    await safe(`Resultat strid ${i + 1}`, '#result');
    for (const seat of ['A', 'B']) await send(seat, MATCH_COMMAND.next);
  }
  await send('A', MATCH_COMMAND.surrender);
  await render();
  await page.locator('#result-dialog[open]').waitFor();
  await safe('Uppgiven match', '#result');
  klocka.advance(STADNING_ALDER_MS + 1);
  await new Promise(setImmediate);
  app.rum.stada();
  assert.equal(app.duell.matchFor(bid), null);
  await page.click('#dialog-new');
  await page.waitForURL(/lobby\.html/);
  await page.locator('#lobby-section:not([hidden])').waitFor();
  await page.locator('#connection:text("Ansluten")').waitFor();
  assert.equal(app.lagring.hamtaSession(bid).roomId, null);
  assert.deepEqual(errors, []);
  console.log('OK Till lobbyn efter städning, inga sid- eller konsolfel');
} finally {
  await browser?.close();
  await app.stang();
}
