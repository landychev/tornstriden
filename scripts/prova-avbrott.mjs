/* Webbläsarprov av anslutningsavbrott (arbetsordning L17) med styrd serverklocka.
   Lagmatch med fyra deltagare: Di tappar nätet (tyst avbrott, upptäcks efter 15 s utan livstecken), de andra
   ser Di som frånkopplad med återstående tid och byter vidare; Di kommer tillbaka och fortsätter. Sedan tappar
   Di nätet igen och slås ut när fristen tar slut, medan laget spelar vidare.
   Onlineduell: Ben stänger fliken när det är hans tur, Ada ser "Väntar på att Ben återansluter" med nedräkning;
   Ben öppnar sidan igen och har kvar sin sparade turtid.
   Kör från projektroten: `npm install` och sedan `node scripts/prova-avbrott.mjs`.
   PLAYWRIGHT_CHANNEL=chrome eller PLAYWRIGHT_EXECUTABLE=/sökväg/chrome väljer webbläsare. */
import { chromium, devices } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startaServer } from '../online/server.js';
import { styrdKlocka, styrdSlump } from '../teststod.js';
import { LOBBY_COMMAND, PROTOCOL_VERSION, RECEIPT } from '../kontrakt.js';

const OUT = mkdtempSync(join(tmpdir(), 'tornstriden-avbrottsprov-'));
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
    await g.page.addInitScript(() => { try { if (!localStorage.getItem('tornstriden-language')) localStorage.setItem('tornstriden-language', 'sv'); } catch {} });
    g.page.on('pageerror', e => fel.push(`${g.namn}: ${e.message}`));
    g.page.on('console', m => { if (m.type() === 'error' && !/mp3|audio|media|404|ERR_INTERNET_DISCONNECTED|Failed to load resource|net::/i.test(m.text())) fel.push(`${g.namn}: ${m.text()}`); });
    await g.page.goto(`${base}/match.html?online=1`);
  }
  return { gaster, ids, matchId: app.lagring.hamtaRum(room.id).matchId };
}
const text = (page, sel) => page.locator(sel).first().textContent({ timeout: 4000 }).catch(() => null);
const post = matchId => app.lagring.hamtaMatch(matchId).match;
const vanta = async (villkor, ms = 8000) => { const slut = Date.now() + ms; while (Date.now() < slut) { if (await villkor()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };
/* Serverklockan flyttas i steg om 5 s. Efter varje steg väntar provet tills varje ansluten sida svarat på
   senaste ping – annars skulle den hoptryckta tiden se ut som tystnad. `utan`: spelare som ska vara tysta. */
const besvarat = utan => [...app.strommar].filter(s => !utan.includes(s.playerId)).every(s => s.ping === 0 || s.senast >= s.pingTid.get(s.ping));
async function flytta(ms, utan = []) {
  for (let kvar = ms; kvar > 0; kvar -= 5_000) {
    klocka.advance(Math.min(5_000, kvar));
    await app.matcher.klockor().klart();
    await vanta(() => besvarat(utan), 4000);
  }
  await app.matcher.klockor().klart();
}

/* ---- Lagmatch, fyra deltagare ---- */
{
  const { gaster, ids, matchId } = await startaMatch(['Anna', 'Bo', 'Cy', 'Di']);
  const [anna, bo, cy, di] = gaster;
  for (const g of gaster) await g.page.waitForURL(/lagmatch\.html/, { timeout: 8000 });
  for (const g of gaster) { await g.page.locator('#intro-dialog[open]').waitFor(); await g.page.click('#intro-close'); }
  for (const g of gaster) await g.page.locator('#connection:text("Ansluten")').waitFor({ timeout: 5000 });

  /* Omladdning mitt i matchen är inget avbrott. */
  await bo.page.reload();
  await bo.page.locator('#intro-dialog[open]').waitFor(); await bo.page.click('#intro-close');
  await flytta(5_000);
  check('lag: en omladdning är inget avbrott', !Object.keys(post(matchId).avbrott ?? {}).length && !app.lagring.hamtaHandelser(matchId).some(h => h.type === 'AVBROTT'));
  /* Di tappar nätet. Utan livstecken i 15 s räknas det som ett avbrott. */
  await di.context.setOffline(true);
  await flytta(20_000, [di.session.playerId]);
  const diId = di.session.playerId;
  check('lag: tyst avbrott upptäcks efter 15 s utan livstecken', Boolean(post(matchId).avbrott?.[diId]), JSON.stringify(post(matchId).avbrott ?? {}));
  const diChip = anna.page.locator('.tower-chip', { hasText: 'Di' });
  await diChip.locator('.chip-avbrott:not([hidden])').waitFor({ timeout: 5000 });
  const chipText = await diChip.textContent();
  check('lag: de andra ser Di som frånkopplad med återstående tid', /Frånkopplad/.test(chipText) && /0:[0-3]\d/.test(chipText), chipText);
  check('lag: Dis egen sida visar Återansluter', await vanta(async () => /Återansluter/.test(await text(di.page, '#connection') ?? '')));
  await anna.page.screenshot({ path: join(OUT, 'lag-desktop-di-borta.png') });
  /* De anslutna byter; omgången väntar bara på Di. */
  for (const g of [anna, bo, cy]) await g.page.click('#keep-hand');
  check('lag: de anslutna kan lämna sina svar', await vanta(() => post(matchId).engine.swapsConfirmed[anna.session.playerId] === 1 && post(matchId).engine.swapsConfirmed[cy.session.playerId] === 1));
  check('lag: omgången väntar på Di', /Väntar på Di/.test(await text(anna.page, '#phase-description') ?? '') || /Di/.test(await text(anna.page, '#action-info') ?? ''));

  /* Di är tillbaka före fristen: sidan ansluter igen och Di kan byta. */
  await di.context.setOffline(false);
  check('lag: Di återansluter av sig själv', await vanta(() => !post(matchId).avbrott?.[diId], 12000));
  await di.page.locator('#connection:text("Ansluten")').waitFor({ timeout: 8000 });
  await anna.page.locator('.tower-chip', { hasText: 'Di' }).locator('.chip-avbrott').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  check('lag: de andra ser att Di är tillbaka', !/Frånkopplad/.test(await diChip.textContent()));
  await di.page.locator('#keep-hand:not([disabled])').waitFor({ timeout: 5000 });
  await di.page.click('#keep-hand');
  check('lag: Di fortsätter där matchen står (bytesomgång 2)', await vanta(() => post(matchId).engine.swapRound === 2));
  check('lag: avbrottet drogs från budgeten en gång', (post(matchId).avbrottsbudget?.[diId] ?? 0) > 0 && (post(matchId).avbrottsbudget[diId] ?? 0) <= 30_000);

  /* Di tappar nätet igen och kommer inte tillbaka i tid. */
  await di.context.setOffline(true);
  await flytta(15_000 + 30_000 + 5_000, [di.session.playerId]);
  const e = post(matchId).engine;
  check('lag: slut på fristen slår ut Di, laget spelar vidare', e.players.find(p => p.id === diId).eliminationReason === 'AVBROTT' && e.phase !== 'AVSLUTAD', `${e.phase}`);
  await anna.page.locator('.tower-chip:has-text("Utslagen – kom inte tillbaka")').waitFor({ timeout: 5000 }).then(() => check('lag: tornet visar varför Di slogs ut', true), () => check('lag: tornet visar varför Di slogs ut', false));
  await di.context.setOffline(false);
  await di.page.locator('#action-info:has-text("Du är utslagen")').waitFor({ timeout: 12000 }).catch(() => {});
  check('lag: Di får beskedet när sidan är tillbaka', /Du kom inte tillbaka i tid/.test(await text(di.page, '#action-info') ?? ''));
  await di.page.screenshot({ path: join(OUT, 'lag-mobil-di-utslagen.png') });
  for (const g of gaster) await g.context.close();
}

/* ---- Onlineduell ---- */
{
  const { gaster: [ada, ben], matchId } = await startaMatch(['Ada', 'Ben']);
  for (const g of [ada, ben]) {
    await g.page.locator('#intro-dialog[open]').waitFor();
    await g.page.click('#intro-close');
    if (await g.page.locator('#swap-dialog[open]').count()) await g.page.click('#swap-close');
    await g.page.locator('#connection:text("Ansluten")').waitFor({ timeout: 5000 });
  }
  await ada.page.click('#keep-hand');
  await flytta(10_000);   // Ben har använt 10 s av sin tur
  const benId = ben.session.playerId;
  const sparad = post(matchId).klockor[benId].deadline - klocka.now();
  /* Ben stänger fliken: stängningen märks direkt, och efter 3 s nåd (en omladdning hade hunnit tillbaka) är det
     ett avbrott med frist räknad från stängningen. */
  const stangd = klocka.now();
  await ben.page.close();
  await vanta(() => app.lagring.hamtaSession(benId).connection === 'FRÅNKOPPLAD');
  await flytta(5_000);
  check('duell: en stängd flik blir ett avbrott efter nåden, med frist från stängningen', await vanta(() => post(matchId).avbrott?.[benId]?.deadline === stangd + 30_000));
  await ada.page.locator('#opponent-avbrott:not([hidden])').waitFor({ timeout: 5000 });
  check('duell: Ada ser återstående tid för Ben', /^0:[23]\d kvar för motståndaren att återansluta$/.test(await text(ada.page, '#opponent-avbrott') ?? ''), await text(ada.page, '#opponent-avbrott'));
  check('duell: Ada ser att spelet väntar på Ben', /Väntar på att Ben återansluter/.test(await text(ada.page, '#selection-info, #hand-info') ?? '') || /Väntar på att Ben återansluter/.test(await ada.page.locator('.game-view').textContent()));
  await ada.page.screenshot({ path: join(OUT, 'duell-desktop-ben-borta.png') });
  await flytta(20_000);
  /* Ben öppnar sidan igen: samma tur med sparad tid, inte nya 90 sekunder. */
  ben.page = await ben.context.newPage();
  await ben.page.addInitScript(() => { try { if (!localStorage.getItem('tornstriden-language')) localStorage.setItem('tornstriden-language', 'sv'); } catch {} });
  ben.page.on('pageerror', e => fel.push(`Ben: ${e.message}`));
  await ben.page.goto(`${base}/match.html?online=1`);
  await ben.page.locator('#intro-dialog[open]').waitFor();
  await ben.page.click('#intro-close');
  if (await ben.page.locator('#swap-dialog[open]').count()) await ben.page.click('#swap-close');
  check('duell: Ben är tillbaka i matchen', await vanta(() => !post(matchId).avbrott?.[benId]));
  const kvar = post(matchId).klockor[benId].deadline - klocka.now();
  check('duell: Bens turtid fortsätter med den sparade tiden', kvar === sparad, `${kvar} ms, sparat ${sparad} ms`);
  await ben.page.locator('#hand-info .turn-clock:not([hidden])').waitFor({ timeout: 5000 });
  check('duell: Ben ser sin egen nedräkning', /^1:[12]\d kvar att välja$/.test(await text(ben.page, '#hand-info .turn-clock') ?? ''), await text(ben.page, '#hand-info .turn-clock'));
  await ada.page.locator('#opponent-avbrott').waitFor({ state: 'hidden', timeout: 5000 }).then(() => check('duell: Adas nedräkning för avbrottet försvinner', true), () => check('duell: Adas nedräkning för avbrottet försvinner', false));
  await ben.page.screenshot({ path: join(OUT, 'duell-mobil-ben-tillbaka.png') });
  await ada.context.close(); await ben.context.close();
}

check('inga fel i webbläsarna', !fel.length, fel.slice(0, 5).join(' | '));
await browser.close();
await app.stang();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} kontroller OK`);
process.exit(failed.length ? 1 : 0);
