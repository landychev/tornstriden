/* Webbläsarprov av onlineduellen (arbetsordning L09): två separata webbläsarkontexter går från lobbyn
   (nick, inbjudan, lag, Redo, Starta) till match.html?online=1 och spelar en hel duell via servern
   med start- och Fortsätt-bekräftelser, till resultatrutan och tillbaka till lobbyn.
   Kör från projektroten: `npm install` och sedan `node scripts/prova-online.mjs`. */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8792;
const ROOT = new URL('../', import.meta.url).pathname;
const OUT = mkdtempSync(join(tmpdir(), 'tornstriden-onlineprov-'));
console.log(`Skärmdumpar och data: ${OUT}`);
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'online/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), TORNSTRIDEN_DATA_DIR: join(OUT, 'data') }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });
await new Promise(r => setTimeout(r, 1200));

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK ' : 'FEL'} ${name}${extra ? ' – ' + extra : ''}`); };
const base = `http://127.0.0.1:${PORT}`;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined });
const consoleErrors = [];
const responses = { Anna: [], Bo: [] };

async function gast(namn, options = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.addInitScript(() => { try { if (!localStorage.getItem('tornstriden-language')) localStorage.setItem('tornstriden-language', 'sv'); } catch {} });
  page.on('console', m => { if (m.type() === 'error' && !/mp3|audio|media|404/i.test(m.text())) consoleErrors.push(`${namn}: ${m.text()}`); });
  page.on('pageerror', e => consoleErrors.push(`${namn}: ${e.message}`));
  page.on('response', async r => { if (/\/api\/(match|kommando|status)/.test(r.url())) { try { responses[namn].push(await r.text()); } catch {} } });
  await page.goto(`${base}/lobby.html`);
  await page.getByLabel('Ditt nick').fill(namn);
  await page.getByRole('button', { name: 'Gå in i lobbyn' }).click();
  await page.locator('#connection:text("Ansluten")').waitFor();
  return { namn, context, page };
}
const visible = (page, sel) => page.locator(sel).isVisible().catch(() => false);
const enabled = async (page, sel) => (await visible(page, sel)) && !(await page.locator(sel).isDisabled());
/* Ett klick som kan misslyckas för att en ruta hann öppnas: slingan försöker igen nästa varv. */
const klick = async (page, sel) => { try { await page.click(sel, { timeout: 1500 }); return true; } catch { return false; } };

try {
  const anna = await gast('Anna');
  const bo = await gast('Bo', { ...devices['iPhone 13'] });
  /* Lobby: Anna bjuder in Bo, Bo accepterar, lag, Redo, Starta */
  await anna.page.locator('#players li').filter({ hasText: 'Bo' }).locator('input').check();
  await anna.page.locator('#invite').click();
  await bo.page.getByRole('button', { name: 'Acceptera' }).click();
  await bo.page.locator('#room:not([hidden])').waitFor();
  await anna.page.getByRole('button', { name: 'Välj Södra laget' }).click();
  await bo.page.getByRole('button', { name: 'Välj Norra laget' }).click();
  await anna.page.locator('#ready:not([disabled])').waitFor();
  await anna.page.locator('#ready').click();
  await bo.page.locator('#ready:not([disabled])').waitFor();
  await bo.page.locator('#ready').click();
  await anna.page.locator('#start:not([disabled])').waitFor();
  await anna.page.locator('#start').click();
  await anna.page.waitForURL(/match\.html\?online=1/);
  await bo.page.waitForURL(/match\.html\?online=1/);
  check('båda hamnar på matchsidan efter värdens start', true);
  for (const g of [anna, bo]) {
    await g.page.locator('#intro-dialog[open]').waitFor();
    await g.page.click('#intro-close');
  }
  await anna.page.locator('#connection:text("Ansluten")').waitFor();
  check('egen plats visas nederst med nick', (await anna.page.locator('#name-A').textContent()) === 'Anna' && (await anna.page.locator('#name-B').textContent()) === 'Bo' && (await bo.page.locator('#name-A').textContent()) === 'Bo');
  check('lokal datorstyrning är stängd online', await anna.page.locator('#mode').isHidden());
  await anna.page.screenshot({ path: join(OUT, '7-online-anna.png'), fullPage: true });
  await bo.page.screenshot({ path: join(OUT, '8-online-bo-mobil.png'), fullPage: true });

  /* Spela: båda sidorna sköts växelvis tills båda har resultatrutan med "Till lobbyn". */
  const stats = { byten: 0, start: 0, anfall: 0, forsvar: 0, avstod: 0, fortsatt: 0 };
  let steps = 0, stall = 0, done = { Anna: false, Bo: false };
  while (!(done.Anna && done.Bo) && steps++ < 600) {
    let acted = false;
    for (const g of [anna, bo]) {
      const page = g.page;
      if (await page.locator('#swap-dialog[open]').count()) { await klick(page, '#swap-close'); acted = true; continue; }
      if (await page.locator('#result-dialog[open]').count() && await visible(page, '#dialog-new')) { done[g.namn] = true; continue; }
      if (await enabled(page, '#start-play') && await page.locator('#start-dialog[open]').count()) { if (await klick(page, '#start-play')) stats.start++; acted = true; continue; }
      if (await enabled(page, '#dialog-next')) { if (await klick(page, '#dialog-next')) stats.fortsatt++; acted = true; continue; }
      if (await visible(page, '#hand-bar:not([hidden]) #keep-hand') && await enabled(page, '#keep-hand')) { if (await klick(page, '#keep-hand')) stats.byten++; acted = true; continue; }
      if (await visible(page, '#confirm-attack')) {
        const usable = page.locator('#hand button.mini-card:not(.unusable):not(.inactive)');
        try {
          if (await usable.count()) await usable.first().click({ timeout: 1500 });
          else { await page.click('#usage-simple', { timeout: 1500 }); await page.locator('#hand button.mini-card:not(.unusable):not(.inactive)').first().click({ timeout: 1500 }); }
          await page.locator('#confirm-attack:not([disabled])').waitFor({ timeout: 4000 });
          await page.click('#confirm-attack', { timeout: 1500 }); stats.anfall++;
        } catch { /* läget hann ändras – nästa varv */ }
        acted = true; continue;
      }
      if (await visible(page, '#confirm-pass')) {
        const usable = page.locator('#hand button.mini-card:not(.unusable):not(.inactive)');
        try {
          if (await usable.count()) { await usable.first().click({ timeout: 1500 }); await page.locator('#confirm-defend:not([disabled])').waitFor({ timeout: 4000 }); await page.click('#confirm-defend', { timeout: 1500 }); stats.forsvar++; }
          else { await page.click('#confirm-pass', { timeout: 1500 }); stats.avstod++; }
        } catch { /* läget hann ändras – nästa varv */ }
        acted = true; continue;
      }
    }
    if (!acted) { await anna.page.waitForTimeout(150); stall = (stall ?? 0) + 1; } else stall = 0;
    if (stall === 60) {
      for (const g of [anna, bo]) console.log('DEBUG', g.namn, '| titel:', await g.page.locator('#phase-title').textContent(), '| info:', (await g.page.locator('#selection-info').textContent()).trim().slice(0, 120), '| hand-info:', (await g.page.locator('#hand-info').textContent()).trim().slice(0, 80), '| notice:', await g.page.locator('#notice').textContent(), '| dialoger:', await g.page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map(d => d.id).join(',')), '| start-play:', await g.page.evaluate(() => { const b = document.getElementById('start-play'); return `${b.disabled}/${b.textContent}`; }));
      for (const g of [anna, bo]) console.log('DEBUG2', g.namn, await g.page.evaluate(() => { const b = document.getElementById('confirm-attack'); const hand = [...document.querySelectorAll('#hand button.mini-card')]; return JSON.stringify({ confirmAttack: b ? { disabled: b.disabled, visible: Boolean(b.offsetParent), rect: b.getBoundingClientRect().width } : null, battleActionsHidden: document.getElementById('battle-actions').hidden, hand: hand.length, usable: hand.filter(h => !h.classList.contains('unusable') && !h.classList.contains('inactive')).length, classes: hand.slice(0, 3).map(h => h.className) }); }));
      await anna.page.screenshot({ path: join(OUT, 'debug-anna.png') }); await bo.page.screenshot({ path: join(OUT, 'debug-bo.png') });
      break;
    }
  }
  check('hela matchen spelades via servern till resultatrutan hos båda', done.Anna && done.Bo, JSON.stringify(stats));
  const vinnareA = await anna.page.locator('#result .winner').textContent();
  const vinnareB = await bo.page.locator('#result .winner').textContent();
  check('resultatet är personligt och motsatt för de två', (vinnareA.includes('Du vinner') !== vinnareB.includes('Du vinner')), `${vinnareA.trim()} / ${vinnareB.trim()}`);
  await anna.page.screenshot({ path: join(OUT, '9-online-slut.png') });

  /* Hemliga händer: Bos exemplar-ID får aldrig förekomma i Annas nätverkssvar (och tvärtom). */
  const idsB = await bo.page.evaluate(() => [...document.querySelectorAll('#hand [data-instance]')].map(b => b.dataset.instance));
  const idsA = await anna.page.evaluate(() => [...document.querySelectorAll('#hand [data-instance]')].map(b => b.dataset.instance));
  const lackerA = idsB.filter(id => responses.Anna.some(t => t.includes(`"${id}"`) && !t.includes('"attack"')));
  check('nätverkssvaren till Anna innehåller inte Bos handkort', idsB.length === 0 || lackerA.length === 0, `${idsB.length} kort hos Bo, ${responses.Anna.length} svar till Anna`);
  check('nätverkssvaren till Bo innehåller inte Annas handkort', idsA.length === 0 || idsA.every(id => !responses.Bo.some(t => t.includes(`"${id}"`) && !t.includes('"attack"'))));

  /* Till lobbyn */
  await anna.page.click('#dialog-new');
  await anna.page.waitForURL(/lobby\.html/);
  await anna.page.locator('#lobby-section:not([hidden])').waitFor();
  await bo.page.click('#dialog-new');
  await bo.page.waitForURL(/lobby\.html/);
  await anna.page.locator('#players li').filter({ hasText: 'Bo' }).filter({ hasText: 'Ledig' }).waitFor({ timeout: 5000 });
  check('båda är tillbaka i lobbyn som lediga', (await anna.page.locator('#room').isHidden()));
  check('inga konsolfel', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (error) {
  console.error('AVBRUTET:', error);
  results.push({ name: 'körning', ok: false });
} finally {
  await browser.close();
  server.kill('SIGINT');
}
console.log(`\n${results.filter(r => r.ok).length}/${results.length} kontroller OK`);
if (results.some(r => !r.ok)) { console.log('--- serverlogg ---\n' + serverLog.slice(-3000)); process.exitCode = 1; }
