/* Webbläsarprov av spelarklockorna (arbetsordning L16) med styrd serverklocka – inga verkliga 90 sekunder.
   Lagmatch med fyra deltagare (varannan mobil): nedräkning i knappraden och på tornen, ingen klocka för den som
   väntar på andra, varning under 20 sekunder och utslagning på tid; laget spelar vidare. Onlineduell: egen och
   motståndarens nedräkning, varning i spelförklaringen och ljudrutan, och förlust på tid i resultatrutan.
   Klienterna räknar ned i realtid från serverns tid i senaste vyn; provet flyttar serverklockan och låter
   sedan ett drag skicka nya vyer, så att klienterna får den nya tiden.
   Kör från projektroten: `npm install` och sedan `node scripts/prova-klockor.mjs`.
   PLAYWRIGHT_CHANNEL=chrome eller PLAYWRIGHT_EXECUTABLE=/sökväg/chrome väljer webbläsare. */
import { chromium, devices } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startaServer } from '../online/server.js';
import { styrdKlocka, styrdSlump } from '../teststod.js';
import { LOBBY_COMMAND, PROTOCOL_VERSION, RECEIPT } from '../kontrakt.js';

const OUT = mkdtempSync(join(tmpdir(), 'tornstriden-klockprov-'));
console.log(`Skärmdumpar: ${OUT}`);
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK ' : 'FEL'} ${name}${extra ? ' – ' + extra : ''}`); };
const klocka = styrdKlocka(1_000_000);
const app = startaServer({ port: 0, dataDir: ':memory:', klocka, slump: styrdSlump(5), lagspel: true, logg: { info() {}, warn() {}, error() {} } });
await app.klar;
const base = `http://127.0.0.1:${app.port()}`;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined });
const fel = [];
let n = 0;

/* Rum och start via tjänsten (som STARTA från lobbyn), så att klockornas timer planeras som i drift. */
async function startaMatch(nicks) {
  const gaster = nicks.map((nick, index) => ({ ...app.sessioner.skapa(nick), index, namn: nick }));
  for (const g of gaster) app.sessioner.anslut(g.session.playerId);
  const ids = gaster.map(g => g.session.playerId);
  const room = app.rum.skapa(ids[0]);
  app.rum.bjudIn(ids[0], room.id, ids.slice(1));
  for (const id of ids.slice(1)) app.rum.acceptera(id, app.rum.vyFor(id).inbjudningar.inkommande[0].id);
  ids.forEach((id, i) => app.rum.valjLag(id, room.id, i % 2 ? 'B' : 'A'));
  const rv = app.lagring.hamtaRum(room.id).rosterVersion;
  for (const id of ids) app.rum.redo(id, room.id, true, rv);
  const start = await app.tjanst.kommando(ids[0], { protocolVersion: PROTOCOL_VERSION, commandId: `start${++n}`, type: LOBBY_COMMAND.start, roomId: room.id, payload: { rosterVersion: rv } });
  if (start.status !== RECEIPT.ok) throw new Error(start.message);
  for (const g of gaster) {
    g.mobil = g.index % 2 === 1;
    g.context = await browser.newContext({ ...(g.mobil ? devices['iPhone 13'] : { viewport: { width: 1280, height: 900 } }), reducedMotion: 'reduce' });
    await g.context.addCookies([{ name: 'tornstriden_session', value: g.token, url: base }]);
    g.page = await g.context.newPage();
    g.page.on('pageerror', e => fel.push(`${g.namn}: ${e.message}`));
    g.page.on('console', m => { if (m.type() === 'error' && !/mp3|audio|media|404/i.test(m.text())) fel.push(`${g.namn}: ${m.text()}`); });
    await g.page.goto(`${base}/match.html?online=1`);
  }
  return { gaster, ids, matchId: app.lagring.hamtaRum(room.id).matchId };
}
const text = (page, sel) => page.locator(sel).first().textContent({ timeout: 4000 }).catch(() => null);
const synliga = (page, sel) => page.locator(`${sel}:not([hidden])`).count();
/* Serverklockan flyttas i steg om 5 s; timers som förfaller körs i matchens kö, och sidorna hinner svara på
   serverns ping mellan stegen (annars vore det ett tyst avbrott, L17). */
const besvarat = () => [...app.strommar].every(s => s.ping === 0 || s.senast >= s.pingTid.get(s.ping));
async function flytta(ms) {
  for (let kvar = ms; kvar > 0; kvar -= 5_000) {
    klocka.advance(Math.min(5_000, kvar));
    await app.matcher.klockor().klart();
    for (let i = 0; i < 80 && !besvarat(); i++) await new Promise(r => setTimeout(r, 50));   // varje sida har svarat på senaste ping
  }
  await app.matcher.klockor().klart();
}

/* ---- Lagmatch, fyra deltagare ---- */
{
  const { gaster, ids, matchId } = await startaMatch(['Anna', 'Bo', 'Cy', 'Di']);
  const [anna, bo, cy, di] = gaster;
  for (const g of gaster) await g.page.waitForURL(/lagmatch\.html/, { timeout: 8000 });
  /* Di låter spelförklaringen ligga öppen hela tiden: klockan, varningen och utslagningen ska nå fram ändå. */
  for (const g of gaster) { await g.page.locator('#intro-dialog[open]').waitFor(); if (g !== di) await g.page.click('#intro-close'); }
  for (const g of gaster) await g.page.locator(`${g === di ? '#intro-dialog' : '#action-info'} .turn-clock:not([hidden])`).waitFor({ timeout: 4000 });
  check('lag: spelförklaringen visar nedräkningen', /^1:[23]\d kvar att välja$/.test(await text(di.page, '#intro-dialog .turn-clock') ?? ''));
  const borjan = await Promise.all(gaster.filter(g => g !== di).map(g => text(g.page, '#action-info .turn-clock')));
  check('lag: alla som byter ser sin nedräkning från 1:30', borjan.every(t => /^1:[23]\d kvar att välja$/.test(t)), borjan.join(' | '));
  check('lag: varje torn visar sin spelares tid', (await Promise.all(gaster.map(g => synliga(g.page, '.chip-clock')))).every(c => c === 4));
  await anna.page.screenshot({ path: join(OUT, 'lag-desktop-byte.png') });
  await bo.page.screenshot({ path: join(OUT, 'lag-mobil-byte.png') });

  await anna.page.click('#keep-hand');
  await anna.page.locator('#action-info .turn-clock').waitFor({ state: 'detached', timeout: 4000 });
  await cy.page.locator('.chip-clock:not([hidden])').nth(2).waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
  check('lag: den som väntar på andra har ingen klocka', !(await anna.page.locator('#action-info .turn-clock').count()) && (await synliga(cy.page, '.chip-clock')) === 3);

  /* 75 sekunder senare: Bos byte skickar nya vyer med serverns nya tid; Cy och Di har 15 sekunder kvar. */
  await flytta(75_000);
  await bo.page.click('#keep-hand');
  await cy.page.locator('#action-info .turn-clock.warn').waitFor({ timeout: 4000 });
  const varning = await text(cy.page, '#action-info .turn-clock');
  check('lag: varning med text under 20 sekunder', /^0:1\d kvar – välj nu, annars slås du ut$/.test(varning ?? ''), varning);
  await cy.page.locator('#clock-alert:text("Mindre än 20 sekunder kvar att välja.")').waitFor({ timeout: 3000 }).then(() => check('lag: skärmläsaren får varningen', true), () => check('lag: skärmläsaren får varningen', false));
  check('lag: tornen varnar också', (await anna.page.locator('.chip-clock.warn').count()) === 2);
  await di.page.locator('#intro-dialog .turn-clock.warn').waitFor({ timeout: 4000 });
  check('lag: varningen syns i den öppna spelförklaringen', /välj nu/.test(await text(di.page, '#intro-dialog .turn-clock') ?? ''));
  await cy.page.screenshot({ path: join(OUT, 'lag-desktop-varning.png') });
  await di.page.screenshot({ path: join(OUT, 'lag-mobil-varning-intro.png') });

  /* Tiden går ut: Cy och Di slås ut tillsammans, Anna och Bo spelar vidare i bytesomgång 2. */
  await flytta(15_000);
  await cy.page.locator('#action-info:has-text("Du är utslagen")').waitFor({ timeout: 4000 });
  check('lag: den utslagna får besked om tidsgränsen', /Tiden för ditt val tog slut/.test(await text(cy.page, '#action-info') ?? ''));
  await di.page.locator('#intro-dialog[open]').waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
  check('lag: spelförklaringen stängs så att utslagningen syns', !(await di.page.locator('#intro-dialog[open]').count()) && /Du är utslagen/.test(await text(di.page, '#action-info') ?? ''));
  await anna.page.locator('#action-info .turn-clock:not([hidden])').waitFor({ timeout: 4000 });
  check('lag: de andra fortsätter med nya 90 sekunder', /^1:[23]\d kvar att välja$/.test(await text(anna.page, '#action-info .turn-clock') ?? '') && /omgång 2/.test(await text(anna.page, '#phase-title') ?? ''));
  check('lag: tornen visar utslagning på tid', (await anna.page.locator('.tower-chip:has-text("Utslagen – tiden tog slut")').count()) === 2);
  const e = app.lagring.hamtaMatch(matchId).match.engine;
  check('lag: servern slog ut båda i samma händelse', e.players.filter(p => p.status === 'UTSLAGEN').length === 2 && new Set(app.lagring.hamtaHandelser(matchId).filter(h => h.type === 'UTSLAGEN').map(h => h.revision)).size === 1);
  await cy.page.screenshot({ path: join(OUT, 'lag-desktop-utslagen.png') });
  for (const g of gaster) await g.context.close();
}

/* ---- Onlineduell ---- */
{
  const { gaster: [anna, bo], matchId } = await startaMatch(['Ada', 'Ben']);
  /* Ada läser spelförklaringen hela tiden; Ben stänger sin. */
  for (const g of [anna, bo]) {
    await g.page.locator('#intro-dialog[open]').waitFor();
    if (g === anna) continue;
    await g.page.click('#intro-close');
    if (await g.page.locator('#swap-dialog[open]').count()) await g.page.click('#swap-close');
  }
  await anna.page.locator('#intro-dialog .turn-clock:not([hidden])').waitFor({ timeout: 4000 });
  check('duell: den som byter ser sin nedräkning i den öppna spelförklaringen', /^1:[23]\d kvar att välja$/.test(await text(anna.page, '#intro-dialog .turn-clock') ?? ''));
  await bo.page.locator('#opponent-clock:not([hidden])').waitFor({ timeout: 4000 });
  check('duell: motståndaren ser nedräkningen men har ingen egen', /kvar för motståndaren$/.test(await text(bo.page, '#opponent-clock') ?? '') && !(await bo.page.locator('#hand-info .turn-clock, #selection-info .turn-clock').count()));
  await bo.page.screenshot({ path: join(OUT, 'duell-mobil-vantar.png') });
  await flytta(90_000);
  await anna.page.locator('#result-dialog[open]').waitFor({ timeout: 5000 });
  await bo.page.locator('#result-dialog[open]').waitFor({ timeout: 5000 });
  check('duell: spelförklaringen stängs och resultatet visas direkt', !(await anna.page.locator('#intro-dialog[open]').count()));
  const a = await text(anna.page, '#result'), b = await text(bo.page, '#result');
  check('duell: den som inte valde förlorar på tid', /Du hann inte välja i tid/.test(a ?? '') && /Ben vinner matchen/.test(a ?? ''), a);
  check('duell: motståndaren vinner', /Du vinner matchen/.test(b ?? '') && /Ada hann inte välja i tid/.test(b ?? ''), b);
  check('duell: inga klockor efter matchslut', !(await synliga(anna.page, '.turn-clock')) && !(await synliga(bo.page, '.turn-clock')));
  const rad = app.lagring.hamtaMatch(matchId);
  check('duell: servern sparade tidsgränsen', rad.status === 'AVSLUTAD' && rad.match.engine.endReason === 'TIDSGRÄNS');
  await anna.page.screenshot({ path: join(OUT, 'duell-desktop-tid.png') });
  await anna.context.close(); await bo.context.close();
}

/* Ljudrutan ska också visa tidsvarningen och lämna plats åt matchslutet. */
{
  const { gaster: [anna, bo], matchId } = await startaMatch(['Ena', 'Två']);
  async function oppnaLjud(g) {
    await g.page.locator('#intro-dialog[open]').waitFor();
    await g.page.click('#intro-close');
    if (await g.page.locator('#swap-dialog[open]').count()) await g.page.click('#swap-close');
    await g.page.click('#sound-settings');
    await g.page.locator('#sound-dialog[open]').waitFor();
  }
  await oppnaLjud(anna); await oppnaLjud(bo);
  const deadline = app.lagring.hamtaMatch(matchId).match.klockor[anna.session.playerId].deadline;
  const clock = anna.page.locator('#sound-dialog .turn-clock:not([hidden])');
  await clock.waitFor({ timeout: 4000 });
  check('duell: ljudrutan visar egen nedräkning', /^1:[23]\d kvar att välja$/.test(await clock.textContent()));
  check('duell: ljudrutan visar ingen klocka för den som väntar', !(await synliga(bo.page, '#sound-dialog .turn-clock')));
  await flytta(75_000);
  /* Omladdningen hämtar serverns flyttade tid; samma deadline ska finnas kvar. */
  await anna.page.reload(); await oppnaLjud(anna);
  await anna.page.locator('#sound-dialog .turn-clock.warn').waitFor({ timeout: 4000 });
  check('duell: ljudrutan varnar under 20 sekunder utan att återställa tiden',
    /^0:1\d kvar – välj nu, annars förlorar du matchen$/.test(await clock.textContent()) &&
    app.lagring.hamtaMatch(matchId).match.klockor[anna.session.playerId].deadline === deadline);
  await anna.page.screenshot({ path: join(OUT, 'duell-ljud-varning-desktop.png') });
  await anna.page.setViewportSize({ width: 390, height: 664 });
  const box = await clock.boundingBox();
  check('duell: ljudvarningen ryms på mobilskärmen', box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 664);
  await anna.page.screenshot({ path: join(OUT, 'duell-ljud-varning-mobil.png') });
  await flytta(15_000);
  for (const g of [anna, bo]) await g.page.locator('#result-dialog[open]').waitFor({ timeout: 5000 });
  check('duell: ljudrutorna stängs vid tidsförlust och resultatet visas',
    !(await anna.page.locator('#sound-dialog[open]').count()) && !(await bo.page.locator('#sound-dialog[open]').count()) &&
    /Du hann inte välja i tid/.test(await text(anna.page, '#result') ?? ''));
  await anna.context.close(); await bo.context.close();
}

check('inga fel i webbläsarna', !fel.length, fel.slice(0, 5).join(' | '));
await browser.close();
await app.stang();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} kontroller OK`);
process.exit(failed.length ? 1 : 0);
