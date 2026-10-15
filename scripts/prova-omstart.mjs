/* Webbläsarprov av serveromstart (arbetsordning L18, beslut 27B) med riktig serverprocess.
   En duell (dator + mobil) och en lagmatch med fyra deltagare pågår när servern dödas med SIGKILL. Servern
   startas om på samma port; sidorna ansluter igen av sig själva och visar "Matchen avbröts på grund av ett
   serveravbrott. Ingen vann." med Till lobbyn. Från lobbyn kan en ny match startas.
   Kör från projektroten: `npm install` och sedan `node scripts/prova-omstart.mjs`.
   PLAYWRIGHT_CHANNEL=chrome eller PLAYWRIGHT_EXECUTABLE=/sökväg/chrome väljer webbläsare. */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8794;
const ROOT = new URL('../', import.meta.url).pathname;
const OUT = mkdtempSync(join(tmpdir(), 'tornstriden-omstartsprov-'));
console.log(`Skärmdumpar och data: ${OUT}`);
const base = `http://127.0.0.1:${PORT}`;
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK ' : 'FEL'} ${name}${extra ? ' – ' + extra : ''}`); };
let serverLog = '';
async function startaServer() {
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'online/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), TORNSTRIDEN_DATA_DIR: join(OUT, 'data') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let ut = '';
  proc.stdout.on('data', d => { ut += d; serverLog += d; });
  proc.stderr.on('data', d => { ut += d; serverLog += d; });
  const slut = new Promise(r => proc.on('exit', r));
  for (let i = 0; i < 200 && !ut.includes('Tornstriden online:'); i++) await new Promise(r => setTimeout(r, 25));
  return { proc, ut: () => ut, doda: async () => { proc.kill('SIGKILL'); await slut; }, stoppa: async () => { proc.kill('SIGTERM'); await slut; } };
}
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined });
const fel = [];
const vanta = async (villkor, ms = 10000) => { const slut = Date.now() + ms; while (Date.now() < slut) { if (await villkor()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
const text = (page, sel) => page.locator(sel).first().textContent({ timeout: 4000 }).catch(() => '');

/* En deltagare går in i lobbyn med sitt nick; rummet ordnas sedan via API:t med deltagarens kaka. */
async function gast(namn, mobil = false) {
  const context = await browser.newContext({ ...(mobil ? devices['iPhone 13'] : { viewport: { width: 1280, height: 900 } }), reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', e => fel.push(`${namn}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/mp3|audio|media|404|Failed to load resource|ERR_CONNECTION_REFUSED|net::/i.test(m.text())) fel.push(`${namn}: ${m.text()}`); });
  await page.goto(`${base}/lobby.html`);
  await page.getByLabel('Ditt nick').fill(namn);
  await page.getByRole('button', { name: 'Gå in i lobbyn' }).click();
  await page.locator('#connection:text("Ansluten")').waitFor();
  const cookie = (await context.cookies()).find(c => c.name === 'tornstriden_session');
  let n = 0;
  const api = async (path, body) => {
    const r = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { cookie: `${cookie.name}=${cookie.value}`, origin: base, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return r.json();
  };
  const kommando = (type, extra = {}) => api('/api/kommando', { protocolVersion: 1, commandId: `${namn}-${Date.now()}-${++n}`, type, payload: {}, ...extra });
  const id = (await api('/api/lobby')).me.playerId;
  return { namn, context, page, api, kommando, id };
}
async function startaMatch(gaster) {
  const [vard, ...ovriga] = gaster;
  await vard.kommando('SKAPA_RUM');
  const roomId = (await vard.api('/api/lobby')).rum.id;
  await vard.kommando('BJUD_IN', { roomId, payload: { playerIds: ovriga.map(g => g.id) } });
  for (const g of ovriga) await g.kommando('ACCEPTERA', { payload: { invitationId: (await g.api('/api/lobby')).inbjudningar.inkommande[0].id } });
  for (const [i, g] of gaster.entries()) await g.kommando('VÄLJ_LAG', { roomId, payload: { teamId: i % 2 ? 'B' : 'A' } });
  const v = (await vard.api('/api/lobby')).rum.rosterVersion;
  for (const g of gaster) await g.kommando('REDO', { roomId, payload: { ready: true, rosterVersion: v } });
  const start = await vard.kommando('STARTA', { roomId, payload: { rosterVersion: v } });
  if (start.status !== 'GODKÄND') throw new Error(start.message);
  return roomId;
}

let server = await startaServer();
try {
  const ada = await gast('Ada'), ben = await gast('Ben', true);
  const lag = [await gast('Cy'), await gast('Di', true), await gast('Ek'), await gast('Fia', true)];
  await startaMatch([ada, ben]);
  await startaMatch(lag);
  for (const g of [ada, ben]) await g.page.waitForURL(/match\.html\?online=1/, { timeout: 8000 });
  for (const g of lag) await g.page.waitForURL(/lagmatch\.html/, { timeout: 10000 });
  for (const g of [ada, ben, ...lag]) { await g.page.locator('#intro-dialog[open]').waitFor(); await g.page.click('#intro-close'); if (await g.page.locator('#swap-dialog[open]').count()) await g.page.click('#swap-close'); }
  await ada.page.click('#keep-hand');
  await lag[0].page.click('#keep-hand');
  check('duellen och lagmatchen pågår', await vanta(async () => /Ben står på tur|Motståndarens tur/.test(await ada.page.locator('.game-view').textContent())));

  /* Servern dör utan förvarning. */
  await server.doda();
  check('sidorna märker att servern är borta', await vanta(async () => /Återansluter/.test(await text(ada.page, '#connection')) && /Återansluter/.test(await text(lag[1].page, '#connection'))));
  await ada.page.screenshot({ path: join(OUT, 'duell-servern-borta.png') });

  /* Omstart på samma port: gamla matcher avbryts innan servern öppnar. */
  server = await startaServer();
  check('servern avbryter de två pågående matcherna vid start', /2 pågående match\(er\) avbröts utan vinnare/.test(server.ut()), server.ut().trim().split('\n').at(-1));
  for (const g of [ada, ben]) {
    const ok = await g.page.locator('#result-dialog[open]').waitFor({ timeout: 15000 }).then(() => true, () => false);
    const t = await text(g.page, '#result');
    check(`duell (${g.namn}): avbrottet visas utan vinnare`, ok && /SERVERAVBROTT/.test(t) && !/AVGJORD/.test(t) && /Matchen avbröts på grund av ett serveravbrott\. Ingen vann\./.test(t) && !/vinner matchen/.test(t), t.slice(0, 120));
    check(`duell (${g.namn}): Till lobbyn finns`, await g.page.locator('#dialog-new:text("Till lobbyn")').isVisible());
  }
  await ben.page.screenshot({ path: join(OUT, 'duell-mobil-avbruten.png') });
  for (const g of lag) {
    const ok = await g.page.locator('#result-dialog[open]').waitFor({ timeout: 15000 }).then(() => true, () => false);
    const t = await text(g.page, '#result');
    check(`lag (${g.namn}): avbrottet visas utan vinnare`, ok && /SERVERAVBROTT/.test(t) && !/AVGJORD/.test(t) && /Matchen avbröts på grund av ett serveravbrott\. Ingen vann\./.test(t) && !/vinner matchen/.test(t), t.slice(0, 120));
  }
  await lag[1].page.screenshot({ path: join(OUT, 'lag-mobil-avbruten.png') });
  await lag[0].page.screenshot({ path: join(OUT, 'lag-desktop-avbruten.png') });
  const nytt = await ada.kommando('BEKRÄFTA_BYTE', { matchId: (await ada.api('/api/match')).view.matchId, revision: (await ada.api('/api/match')).view.revision, payload: { cards: [] } });
  check('gamla matchen tar inte emot nya drag', nytt.status === 'AVVISAD' && /avbröts/.test(nytt.message), nytt.message);

  /* Till lobbyn och en ny match. */
  for (const g of [ada, ben]) { await g.page.click('#dialog-new'); await g.page.waitForURL(/lobby\.html/, { timeout: 8000 }); }
  check('Till lobbyn leder till lobbyn som ledig', await vanta(async () => (await ada.api('/api/lobby')).me.activity === 'LEDIG' && (await ben.api('/api/lobby')).me.activity === 'LEDIG'));
  for (const g of [ada, ben]) await g.page.locator('#connection:text("Ansluten")').waitFor({ timeout: 8000 });
  await startaMatch([ada, ben]);
  await ada.page.waitForURL(/match\.html\?online=1/, { timeout: 8000 });
  await ada.page.locator('#intro-dialog[open]').waitFor(); await ada.page.click('#intro-close');
  check('en ny match kan startas efter omstarten', (await ada.api('/api/match')).view.phase === 'KORTBYTE' && (await ada.page.locator('#hand button.mini-card').count()) === 10);
  check('inga fel i webbläsarna', !fel.length, fel.slice(0, 5).join(' | '));
} catch (error) {
  console.error('AVBRUTET:', error);
  results.push({ name: 'körning', ok: false });
} finally {
  await browser.close();
  await server.stoppa();
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} kontroller OK`);
if (failed.length) console.log('--- serverlogg ---\n' + serverLog.slice(-2000));
process.exit(failed.length ? 1 : 0);
