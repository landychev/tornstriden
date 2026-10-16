/* Webbläsarprov av den lokala matchen (arbetsordning L07): spelar en hel datormatch i match.html via
   gränssnittet (byte, anfall, försvar, resultatrutor, långtryck, tvåspelarläge).
   Kör från projektroten: `npm install` och sedan `node scripts/prova-match.mjs`. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const PORT = 8791;
const ROOT = new URL('../', import.meta.url).pathname;
const OUT = mkdtempSync(join(tmpdir(), 'tornstriden-matchprov-'));
console.log(`Skärmdumpar: ${OUT}`);
const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK ' : 'FEL'} ${name}${extra ? ' – ' + extra : ''}`); };
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
const missing = [];
page.on('response', r => { if (r.status() === 404) missing.push(new URL(r.url()).pathname); });
page.on('console', m => { if (m.type() === 'error' && !/mp3|audio|media|404/i.test(m.text())) consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(e.message));
const visible = sel => page.locator(sel).isVisible().catch(() => false);
const enabled = async sel => (await visible(sel)) && !(await page.locator(sel).isDisabled());

try {
  await page.goto(`http://127.0.0.1:${PORT}/match.html`);
  await page.locator('#intro-dialog[open]').waitFor();
  await page.click('#intro-close');
  await page.locator('#swap-dialog[open]').waitFor({ timeout: 3000 }).catch(() => {});
  if (await page.locator('#swap-dialog[open]').count()) await page.click('#swap-close');

  /* Byte omgång 1: markera två kort och byt */
  await page.locator('#confirm-swap').waitFor();
  const cards = page.locator('#hand button.mini-card');
  check('tio kort på handen', (await cards.count()) === 10);
  await cards.nth(0).click(); await cards.nth(1).click();
  check('två kort markerade', (await page.locator('#hand [aria-pressed="true"]').count()) === 2);
  await page.click('#confirm-swap');
  await page.locator('#hand-bar:not([hidden]) #keep-hand, #start-dialog[open]').first().waitFor({ timeout: 8000 });
  /* Omgång 2: behåll */
  if (await visible('#keep-hand')) { await page.click('#keep-hand'); }
  await page.locator('#start-dialog[open]').waitFor({ timeout: 8000 });
  check('startrutan visas efter bytena', true, await page.locator('#start-title').textContent());
  await page.screenshot({ path: join(OUT, '5-match-start.png') });
  await page.click('#start-play');

  /* Långtryck på ett kort i handen öppnar kortrutan */
  const first = page.locator('#hand button.mini-card').first();
  const box = await first.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  const detailOpen = await page.locator('#card-dialog[open]').count();
  await page.mouse.up();
  check('långtryck öppnar kortet förstorat', detailOpen === 1);
  if (detailOpen) { await page.keyboard.press('Escape'); await page.locator('#card-dialog[open]').waitFor({ state: 'detached' }).catch(() => {}); }
  await page.waitForTimeout(500);   // klicket närmast efter ett långtryck sväljs med avsikt

  /* Spela tills matchen är slut */
  let battles = 0, played = 0, defended = 0, passed = 0, steps = 0;
  while (steps++ < 400) {
    if (await visible('#dialog-new') || (await page.locator('#result-dialog[open]').count() && await visible('#dialog-new'))) break;
    if (await visible('#dialog-next')) { await page.click('#dialog-next'); battles++; continue; }
    /* Resultatrutan kan öppnas medan bordets Fortsätt klickas; då gäller rutans knapp i nästa varv. */
    if (await visible('#confirm-next')) { if (await page.click('#confirm-next', { timeout: 2000 }).then(() => true, () => false)) battles++; continue; }
    if (await visible('#confirm-attack')) {
      const usable = page.locator('#hand button.mini-card:not(.unusable):not(.inactive)');
      if (await usable.count()) { await usable.first().click(); }
      else { await page.click('#usage-simple'); await page.locator('#hand button.mini-card:not(.unusable):not(.inactive)').first().click(); }
      try { await page.locator('#confirm-attack:not([disabled])').waitFor({ timeout: 3000 }); }
      catch (e) { console.log('DEBUG fas:', await page.locator('#phase-title').textContent(), '| info:', await page.locator('#selection-info').textContent(), '| notice:', await page.locator('#notice').textContent(), '| markerade:', await page.locator('#hand [aria-pressed="true"]').count(), '| usage:', await page.locator('#usage').isHidden()); await page.screenshot({ path: join(OUT, 'debug.png') }); throw e; }
      await page.click('#confirm-attack'); played++;
      continue;
    }
    if (await visible('#confirm-pass')) {
      const usable = page.locator('#hand button.mini-card:not(.unusable):not(.inactive)');
      if (await usable.count()) { await usable.first().click(); await page.locator('#confirm-defend:not([disabled])').waitFor({ timeout: 3000 }); await page.click('#confirm-defend'); defended++; }
      else { await page.click('#confirm-pass'); passed++; }
      continue;
    }
    if (await visible('#retry-computer')) { check('datorn fastnade', false, await page.locator('#selection-info').textContent()); break; }
    await page.waitForTimeout(250);
  }
  const over = await page.locator('#result-dialog[open]').count();
  const winnerText = await page.locator('#result .winner').textContent().catch(() => '');
  check('matchen spelades till slut', over === 1 && /vinner matchen/.test(winnerText), `${battles} strider, ${played} anfall, ${defended} försvar, ${passed} avstådda – ${winnerText.trim()}`);
  await page.screenshot({ path: join(OUT, '6-match-slut.png') });
  check('matchrutan har rätt utfallsklass', ['victory', 'defeat'].includes(await page.locator('#result-dialog').getAttribute('data-outcome')));
  await page.click('#dialog-new');
  await page.locator('#confirm-swap').waitFor({ timeout: 5000 });
  check('ny match efter avslut ger en ny hand', (await page.locator('#hand button.mini-card').count()) === 10);

  /* Tvåspelarläge: handen följer den som står på tur */
  await page.selectOption('#mode', 'hotseat');
  await page.locator('#swap-dialog[open]').waitFor({ timeout: 2000 }).catch(() => {});
  if (await page.locator('#swap-dialog[open]').count()) await page.click('#swap-close');
  await page.click('#keep-hand');
  await page.waitForTimeout(300);
  const owner = await page.locator('#hand-owner').textContent();
  check('tvåspelarläget visar nästa spelares hand', /NORRA/.test(owner), owner);

  for (let i = 0; i < 3; i++) {
    if (await visible('#swap-close')) await page.click('#swap-close');
    await page.click('#keep-hand');
  }
  await page.locator('#start-dialog[open]').waitFor();
  await page.click('#start-play');
  let localBattles = 0;
  for (let i = 0; i < 10; i++) {
    await page.click('#usage-simple');
    await page.locator('#hand button.mini-card:not(.inactive)').first().click();
    await page.click('#confirm-attack');
    await page.click('#confirm-pass');
    await page.locator('#result-dialog[open]').waitFor();
    localBattles++;
    if (await visible('#dialog-new')) break;
    await page.click('#dialog-next');
  }
  check('tvåspelarläget klarar resultat, Fortsätt och matchslut', localBattles >= 2 && await visible('#dialog-new'), `${localBattles} strider`);
  await page.click('#dialog-new');
  if (await visible('#swap-close')) await page.click('#swap-close');
  check('ny match fungerar efter tvåspelarmatch', await visible('#keep-hand') && await page.locator('#hand button.mini-card').count() === 10);

  check('inga konsolfel (ljudfiler undantagna)', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  const other404 = [...new Set(missing)].filter(p => !/\.(jpg|mp3)$/.test(p));
  check('saknade filer är bara bilder/ljud som inte följde med provkopian', other404.length === 0, other404.join(' '));
} catch (error) {
  console.error('AVBRUTET:', error);
  console.log('Klickläge:', await page.evaluate(() => {
    const el = document.getElementById('usage-simple'), r = el.getBoundingClientRect();
    return { button: r.toJSON(), hits: document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2).map(e => `${e.tagName}.${e.className}`), dialogs: [...document.querySelectorAll('dialog[open]')].map(e => e.id) };
  }));
  results.push({ name: 'körning', ok: false });
  await page.screenshot({ path: join(OUT, 'fel.png') }).catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
console.log(`\n${results.filter(r => r.ok).length}/${results.length} kontroller OK`);
if (results.some(r => !r.ok)) process.exitCode = 1;
