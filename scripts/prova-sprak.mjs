/* Språkprov i riktig webbläsare: första besök, lagring, dialoger, mobil,
   olika språk i samma online-/lagmatch samt språkbyte utan skickade spelkommandon.
   Kör: PLAYWRIGHT_CHANNEL=chrome node scripts/prova-sprak.mjs */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startaServer } from '../online/server.js';
import { styrdKlocka, styrdSlump } from '../teststod.js';
import { LOBBY_COMMAND, MATCH_COMMAND as C, PROTOCOL_VERSION, RECEIPT } from '../kontrakt.js';

const out = mkdtempSync(join(tmpdir(), 'tornstriden-sprak-'));
const app = startaServer({ port: 0, dataDir: ':memory:', klocka: styrdKlocka(1_000_000), slump: styrdSlump(17), lagspel: true, logg: { info() {}, warn() {}, error() {} } });
await app.klar;
const base = `http://127.0.0.1:${app.port()}`;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const errors = [];
let checked = 0, sequence = 0;
const check = (description, condition) => { assert.ok(condition, description); checked++; console.log(`OK ${description}`); };
const track = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() === 404) errors.push(`404 ${new URL(response.url()).pathname}`); });
};
const choose = async (page, lang) => {
  const parent = await page.locator('dialog[open]').count() ? page.locator('dialog[open]').last() : page.locator('.masthead');
  await parent.locator(`[data-language="${lang}"]`).click();
  await page.waitForFunction(lang => document.documentElement.lang === lang, lang);
};
async function snapshot(page) {
  return page.evaluate(() => ({
    hand: [...document.querySelectorAll('#hand [data-instance]')].map(el => [el.dataset.instance, el.getAttribute('aria-pressed')]),
    revision: [...document.querySelectorAll('[data-revision]')].map(el => el.dataset.revision),
    life: [...document.querySelectorAll('[data-life]')].map(el => [el.id, el.dataset.life]),
    draw: document.querySelector('#draw-number')?.textContent,
    discard: document.querySelector('#discard-number')?.textContent
  }));
}
async function setupMatch(size) {
  const guests = Array.from({ length: size }, (_, index) => ({ ...app.sessioner.skapa(`Sprak${size}-${index}`), index, lang: index % 2 ? 'sv' : 'en' }));
  for (const guest of guests) app.sessioner.anslut(guest.session.playerId);
  const ids = guests.map(g => g.session.playerId);
  const room = app.rum.skapa(ids[0]);
  app.rum.bjudIn(ids[0], room.id, ids.slice(1));
  for (const id of ids.slice(1)) app.rum.acceptera(id, app.rum.vyFor(id).inbjudningar.inkommande[0].id);
  ids.forEach((id, i) => app.rum.valjLag(id, room.id, i % 2 ? 'B' : 'A'));
  const revision = app.lagring.hamtaRum(room.id).rosterVersion;
  for (const id of ids) app.rum.redo(id, room.id, true, revision);
  const receipt = await app.tjanst.kommando(ids[0], { protocolVersion: PROTOCOL_VERSION, commandId: `sprak-start-${++sequence}`, type: LOBBY_COMMAND.start, roomId: room.id, payload: { rosterVersion: revision } });
  assert.equal(receipt.status, RECEIPT.ok);
  const matchId = app.lagring.hamtaRum(room.id).matchId;
  for (const guest of guests) {
    guest.context = await browser.newContext({ viewport: { width: guest.index % 2 ? 390 : 1440, height: 900 }, reducedMotion: 'reduce' });
    await guest.context.addCookies([{ name: 'tornstriden_session', value: guest.token, url: base }]);
    await guest.context.addInitScript(lang => localStorage.setItem('tornstriden-language', lang), guest.lang);
    guest.page = await guest.context.newPage(); track(guest.page);
    await guest.page.goto(`${base}/${size === 2 ? 'match.html?online=1' : 'lagmatch.html'}`);
    await guest.page.locator('#intro-dialog[open]').waitFor();
    await guest.page.click('#intro-close');
    if (size === 2 && await guest.page.locator('#swap-dialog[open]').count()) await guest.page.click('#swap-close');
  }
  return { guests, matchId };
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); track(page);
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  await page.goto(`${base}/match.html`);
  await page.locator('#language-dialog[open]').waitFor();
  await page.keyboard.press('Escape');
  check('första besöket kräver språkval före spelintroduktionen', await page.locator('#language-dialog[open]').count() === 1 && await page.locator('#intro-dialog[open]').count() === 0);
  await choose(page, 'en');
  await page.locator('#intro-dialog[open]').waitFor();
  check('engelsk introduktion och sparat språk', /Two towers/.test(await page.locator('#intro-dialog').innerText()) && await page.evaluate(() => localStorage.getItem('tornstriden-language')) === 'en');
  await choose(page, 'sv');
  check('språk kan bytas direkt i öppen dialog', /Två torn/.test(await page.locator('#intro-dialog').innerText()));
  await choose(page, 'en'); await page.click('#intro-close'); await page.click('#swap-close');
  await page.locator('#hand [data-instance]').first().click();
  const before = await snapshot(page), navigationCount = navigations;
  for (const lang of ['sv', 'en', 'sv', 'en']) await choose(page, lang);
  check('kort, markeringar, liv, högar och revision bevaras utan omladdning', JSON.stringify(await snapshot(page)) === JSON.stringify(before) && navigations === navigationCount);
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
    check(`engelsk matchvy ryms vid ${width} px`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(out, `match-${width}.png`) });
  }
  const card = page.locator('#hand [data-instance]').first();
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.locator('#card-dialog[open]').waitFor(); await page.mouse.up();
  await page.waitForTimeout(450); // långtryckets efterföljande klick sväljs avsiktligt
  await choose(page, 'sv');
  check('förstorat kort följer språket medan rutan är öppen', /Så fungerar kortet/.test(await page.locator('#card-detail').textContent()));
  await choose(page, 'en');
  check('förstorat kort har engelska effekter', /How the card works/.test(await page.locator('#card-detail').textContent()) && !/[åäöÅÄÖ]/.test(await page.locator('#card-detail').textContent()));
  await page.keyboard.press('Escape');
  await page.goto(`${base}/lobby.html`); await page.locator('#nick-section:not([hidden])').waitFor();
  check('språket följer med till lobbyn utan ny fråga', await page.locator('#language-dialog').count() === 0 && /Choose a nickname/.test(await page.locator('#nick-section').innerText()));
  await page.fill('#nick', 'x'); await page.click('#nick-form button');
  check('valideringsfel visas på engelska', /nickname must be/.test(await page.locator('#nick-error').innerText()));
  await choose(page, 'sv');
  check('redan visat fel och inmatning bevaras vid språkbyte', /Nicket måste vara/.test(await page.locator('#nick-error').innerText()) && await page.inputValue('#nick') === 'x');
  await page.reload(); await page.locator('#nick-section:not([hidden])').waitFor();
  check('senaste språket används efter omladdning', await page.locator('html').getAttribute('lang') === 'sv' && await page.locator('#language-dialog').count() === 0);
  await context.close();

  for (const mode of ['invalid', 'unavailable']) {
    const c = await browser.newContext();
    await c.addInitScript(mode => {
      if (mode === 'invalid') localStorage.setItem('tornstriden-language', 'xx');
      else Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
    }, mode);
    const p = await c.newPage(); track(p); await p.goto(`${base}/match.html`);
    await p.locator('#language-dialog[open]').waitFor(); await choose(p, 'en'); await p.locator('#intro-dialog[open]').waitFor();
    check(`språkval fungerar när lagringen är ${mode}`, /Two towers/.test(await p.locator('#intro-dialog').innerText()));
    await c.close();
  }

  for (const size of [2, 4]) {
    const { guests, matchId } = await setupMatch(size);
    check(`${size} spelare kan ha olika språk i samma match`, /Starting swaps/.test(await guests[0].page.locator('#phase-title').innerText()) && /Startbyten/.test(await guests[1].page.locator('#phase-title').innerText()));
    const g = guests[0], p = g.page;
    await p.locator('#hand [data-instance]').first().click();
    const before = structuredClone(app.lagring.hamtaMatch(matchId).match), hand = await snapshot(p);
    let commands = 0; p.on('request', r => { if (r.url().endsWith('/api/kommando')) commands++; });
    await choose(p, 'sv'); await choose(p, 'en');
    assert.deepEqual(app.lagring.hamtaMatch(matchId).match, before);
    check(`${size} spelare: språkbyte skickar inget kommando och bevarar serverns tillstånd`, commands === 0 && JSON.stringify(await snapshot(p)) === JSON.stringify(hand));
    if (size === 4) {
      await p.click('#show-help'); await choose(p, 'sv'); await choose(p, 'en');
      check('lagförklaringen översätts i öppen dialog', /Everyone swaps/.test(await p.locator('#intro-dialog').innerText()));
    }
    for (const guest of guests) await guest.context.close();
  }
  check('inga JavaScript-fel eller saknade resurser', errors.length === 0);
  console.log(`${checked}/${checked} godkända. Bilder: ${out}`);
} finally { await browser.close(); await app.stang(); }
