/* Webbläsarprov av lobbyn (arbetsordning L06): fyra separata webbläsarkontexter (en mobil) går igenom
   nick, inbjudningar, rum, lagval, Redo, värdbyte, extra flik och omladdning mot en egen onlineserver.
   Kör från projektroten: `npm install` (Playwright finns i devDependencies) och sedan
   `node scripts/prova-lobby.mjs`. Skärmdumpar hamnar i en temporär katalog som skrivs ut. */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8790;
const ROOT = new URL('../', import.meta.url).pathname;
const OUT = mkdtempSync(join(tmpdir(), 'tornstriden-lobbyprov-'));
const dataDir = join(OUT, 'data');
console.log(`Skärmdumpar och data: ${OUT}`);
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'online/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), TORNSTRIDEN_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });
await new Promise(r => setTimeout(r, 1200));

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(`${ok ? 'OK ' : 'FEL'} ${name}${extra ? ' – ' + extra : ''}`); };
const url = `http://127.0.0.1:${PORT}/lobby.html`;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const consoleErrors = [];

async function gast(namn, options = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`${namn}: ${m.text()} (${m.location().url})`); });
  page.on('pageerror', e => consoleErrors.push(`${namn}: ${e.message}`));
  await page.goto(url);
  await page.getByLabel('Ditt nick').fill(namn);
  await page.getByRole('button', { name: 'Gå in i lobbyn' }).click();
  await page.locator('#lobby-section:not([hidden])').waitFor();
  await page.locator('#connection:text("Ansluten")').waitFor();
  return { namn, context, page };
}
const vantaText = (page, selector, text) => page.locator(selector).filter({ hasText: text }).first().waitFor({ timeout: 5000 });

try {
  const anna = await gast('Anna');
  const bo = await gast('Bo');
  const cy = await gast('Cy', { ...devices['iPhone 13'] });
  const dan = await gast('Dan');
  const alla = [anna, bo, cy, dan];

  /* Fel: upptaget nick visas i formuläret med fokus kvar i fältet */
  const inkraktare = await browser.newContext();
  const ip = await inkraktare.newPage();
  await ip.goto(url);
  await ip.getByLabel('Ditt nick').fill('anna');
  await ip.getByRole('button', { name: 'Gå in i lobbyn' }).click();
  await vantaText(ip, '#nick-error', 'upptaget');
  check('upptaget nick ger fel i formuläret och fokus kvar', await ip.evaluate(() => document.activeElement?.id === 'nick'));
  await ip.getByLabel('Ditt nick').fill('<b>Eva</b>');
  await ip.getByRole('button', { name: 'Gå in i lobbyn' }).click();
  await ip.locator('#lobby-section:not([hidden])').waitFor();
  await vantaText(anna.page, '#players li', '<b>Eva</b>');
  check('HTML-liknande nick visas som text', (await anna.page.locator('#players b').count()) === 0);

  /* Alla ser varandra */
  await vantaText(dan.page, '#players li', 'Cy');
  const lista = await dan.page.locator('#players li').allTextContents();
  check('fyra separata sessioner ser varandra', lista.length === 5, lista.join(' | '));

  /* Tangentbord: Tab till Bo:s kryssruta, mellanslag markerar */
  await anna.page.locator('#players li').filter({ hasText: 'Bo' }).locator('input').focus();
  await anna.page.keyboard.press('Space');
  const knapp = anna.page.locator('#invite');
  check('markering med tangentbord uppdaterar knappen', (await knapp.textContent()).includes('(1)'));
  /* Fokus överlever listuppdatering: Dan byter nick medan Annas fokus ligger på kryssrutan */
  const fokusFore = await anna.page.evaluate(() => document.activeElement?.id);
  await dan.page.getByRole('button', { name: 'Ändra nick' }).click();
  await dan.page.locator('#new-nick').fill('Daniel');
  await dan.page.getByRole('button', { name: 'Byt' }).click();
  await vantaText(anna.page, '#players li', 'Daniel');
  const fokusEfter = await anna.page.evaluate(() => document.activeElement?.id);
  check('fokus överlever listuppdatering', fokusFore && fokusFore === fokusEfter, `${fokusFore} -> ${fokusEfter}`);
  check('kryssrutan är fortfarande markerad', await anna.page.locator(`#${fokusFore}`).isChecked());

  /* Anna markerar Cy och Daniel också och skapar rum + bjuder in */
  for (const namn of ['Cy', 'Daniel']) await anna.page.locator('#players li').filter({ hasText: namn }).locator('input').check();
  check('knappen räknar markerade', (await knapp.textContent()).includes('(3)'));
  await knapp.click();
  await anna.page.locator('#room:not([hidden])').waitFor();
  await vantaText(anna.page, '#outgoing', 'Daniel');
  check('rummet syns för värden med utgående inbjudningar', (await anna.page.locator('.outgoing-row').count()) === 3);
  await anna.page.screenshot({ path: join(OUT, '1-anna-rum.png'), fullPage: true });

  /* Mottagare ser inbjudan; Bo och Cy accepterar, Daniel avböjer */
  await vantaText(bo.page, '.invitation', 'Anna');
  await vantaText(cy.page, '.invitation', 'Anna');
  await cy.page.screenshot({ path: join(OUT, '2-cy-mobil-inbjudan.png'), fullPage: true });
  await bo.page.getByRole('button', { name: 'Acceptera' }).click();
  await bo.page.locator('#room:not([hidden])').waitFor();
  check('Cys inbjudan är kvar efter att Bo accepterat (1B)', (await cy.page.locator('.invitation').count()) === 1);
  await cy.page.getByRole('button', { name: 'Acceptera' }).click();
  await cy.page.locator('#room:not([hidden])').waitFor();
  await dan.page.getByRole('button', { name: 'Avböj' }).click();
  await dan.page.locator('.invitation').waitFor({ state: 'detached' });
  await vantaText(anna.page, '#room-count', '3 av högst 8');
  check('tre i rummet, Daniel utanför', (await dan.page.locator('#room').isHidden()));
  check('inbjudningsknappen är dold för en vanlig deltagare', await bo.page.locator('#invite').isHidden());

  /* Lagval och Redo */
  await vantaText(anna.page, '#start-status', 'har inte valt lag');
  check('Redo är spärrat innan lag valts', await cy.page.locator('#ready').isDisabled());
  await anna.page.getByRole('button', { name: 'Välj Södra laget' }).click();
  await bo.page.getByRole('button', { name: 'Välj Norra laget' }).click();
  await cy.page.getByRole('button', { name: 'Välj Södra laget' }).click();
  await vantaText(anna.page, '#start-status', 'Vi är 3');
  await cy.page.locator('#ready:not([disabled])').waitFor({ timeout: 5000 });
  check('Redo är spärrat utan lag, aktiv med lag', true);
  for (const g of [anna, bo, cy]) await g.page.locator('#ready').click();
  await vantaText(anna.page, '#start-status', 'Vi är 3. Matchen kan starta med 2, 4, 6 eller 8 spelare.');
  check('startknappen är dold för icke-värd och spärrad för värden', (await bo.page.locator('#start').isHidden()) && (await anna.page.locator('#start').isDisabled()));
  check('Redo syns för alla', (await anna.page.locator('.ready-state.is-ready').count()) === 3);
  await cy.page.screenshot({ path: join(OUT, '3-cy-mobil-rum.png'), fullPage: true });

  /* Lagbyte nollställer Redo */
  await cy.page.getByRole('button', { name: 'Välj Norra laget' }).click();
  await vantaText(anna.page, '#start-status', 'Väntar på');
  check('lagbyte nollställer allas Redo', (await anna.page.locator('.ready-state.is-ready').count()) === 0);
  check('ojämna lag förklaras', (await anna.page.locator('#start-status').textContent()).includes('ojämna'));

  /* Cy lämnar -> 2 spelare, alla redo -> format spärrat */
  await cy.page.getByRole('button', { name: 'Lämna rummet' }).click();
  await cy.page.locator('#room').waitFor({ state: 'hidden' });
  await vantaText(anna.page, '#room-count', '2 av högst 8');
  for (const g of [anna, bo]) { await g.page.locator('#ready:not([disabled])').waitFor(); await g.page.locator('#ready').click(); await g.page.locator('#ready[aria-pressed="true"]').waitFor(); }
  await vantaText(anna.page, '#start-status', 'Alla är redo');
  check('med två spelare och alla redo kan värden starta (duellmotorn finns sedan L08); icke-värd ser väntetext', !(await anna.page.locator('#start').isDisabled()) && (await bo.page.locator('#start-status').textContent()).includes('Väntar på att värden startar'));
  await anna.page.screenshot({ path: join(OUT, '4-anna-format-sparrat.png'), fullPage: true });

  /* Värdbyte: Anna lämnar -> Bo blir värd */
  await anna.page.getByRole('button', { name: 'Lämna rummet' }).click();
  await vantaText(bo.page, '#room-heading', 'Du är värd');
  check('25A: Bo blir värd när Anna lämnar', true);

  /* Extra flik: Annas andra flik tar över, första fliken visar dialogen */
  const anna2 = await anna.context.newPage();
  await anna2.goto(url);
  await anna2.locator('#lobby-section:not([hidden])').waitFor();
  await anna.page.locator('#replaced[open]').waitFor();
  check('extra flik: den gamla fliken visar "öppen i en annan flik"', true);
  await anna.page.getByRole('button', { name: 'Använd den här fliken' }).click();
  await anna2.locator('#replaced[open]').waitFor();
  check('ta över: den andra fliken får beskedet i stället', true);

  /* Omladdning behåller identiteten */
  await bo.page.reload();
  await bo.page.locator('#lobby-section:not([hidden])').waitFor();
  await vantaText(bo.page, '#my-nick', 'Bo');
  await bo.page.locator('#room:not([hidden])').waitFor();
  check('omladdning behåller nick och rum', true);

  /* Lämna lobbyn */
  await dan.page.getByRole('button', { name: 'Lämna lobbyn' }).click();
  await dan.page.locator('#nick-section:not([hidden])').waitFor();
  await anna.page.locator('#players li').filter({ hasText: 'Daniel' }).waitFor({ state: 'detached' });
  check('lämna lobbyn tar bort spelaren hos andra', true);

  check('inga konsolfel', consoleErrors.length === 0, consoleErrors.join(' | '));
} catch (error) {
  console.error('AVBRUTET:', error);
  results.push({ name: 'körning', ok: false, extra: error.message });
} finally {
  await browser.close();
  server.kill('SIGINT');
}
console.log(`\n${results.filter(r => r.ok).length}/${results.length} kontroller OK`);
if (results.some(r => !r.ok)) { console.log('--- serverlogg ---\n' + serverLog); process.exitCode = 1; }
