/* Helflödesprov i webbläsare (arbetsordning L20) mot en riktig serverprocess med verklig klocka.
   Separata webbläsarkontexter (egna kakor, varannan som mobil) går hela vägen via gränssnittet:
   nick → lobbyn → inbjudan → acceptans → lagval → Redo → Starta → matchen till slut → resultatrutan → Till lobbyn.
   Två matcher spelas samtidigt i varje omgång: 2 + 8 deltagare, sedan 4 + 6.
   Verkliga avbrott under matcherna:
   - 8: en mobilspelare går offline (som flygplansläge) i 25 s; servern märker tystnaden, de andra ser
     "Frånkopplad", och spelaren kommer tillbaka och spelar vidare.
   - 6: en spelare stänger webbläsaren hårt; efter fristen slås hen ut och laget spelar vidare (2 mot 3).
   - 4: en spelare laddar om sidan (inget avbrott) och öppnar sedan en andra flik som tar över; den gamla fliken
     får beskedet "öppen i en annan flik".
   Alla API-svar till sidorna kontrolleras mot hemlighetsregeln (assertNoSecrets). En vakt läser serverns deadline
   för varje väntande val: har en sida låtit mer än halva turtiden gå utan att välja sparas läge och skärmdump,
   och provet faller – en tidsutslagning ska inte kunna dölja en sida som inte går att spela på.
   Kör från projektroten: `npm install` och sedan `node scripts/prova-helflode.mjs` (`--omgang 1` eller `--omgang 2`
   kör bara den omgången).
   PLAYWRIGHT_CHANNEL=chrome eller PLAYWRIGHT_EXECUTABLE=/sökväg/chrome väljer webbläsare. */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoSecrets } from '../kontrakt.js';
import { styrdSlump } from '../teststod.js';

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = mkdtempSync(join(tmpdir(), 'tornstriden-helflode-'));
console.log(`Skärmdumpar och data: ${OUT}`);
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK ' : 'FEL'} ${name}${extra ? ' – ' + extra : ''}`); };
const vanta = ms => new Promise(r => setTimeout(r, ms));
const random = styrdSlump(20);
const pick = list => list[Math.floor(random() * list.length)];

const ledigPort = () => new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const PORT = await ledigPort();
const base = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'online/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), TORNSTRIDEN_DATA_DIR: join(OUT, 'data') }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverlogg = '';
server.stdout.on('data', d => { serverlogg += d; });
server.stderr.on('data', d => { serverlogg += d; });
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/halsa`)).ok) break; } catch { /* startar */ } await vanta(100); }
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined });
const fel = [];
const hemligt = [];

async function nyFlik(g) {
  const page = await g.context.newPage();
  await page.addInitScript(() => { try { if (!localStorage.getItem('tornstriden-language')) localStorage.setItem('tornstriden-language', 'sv'); } catch {} });
  page.on('pageerror', e => fel.push(`${g.namn}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/mp3|audio|media|Failed to load resource|net::ERR/i.test(m.text())) fel.push(`${g.namn}: ${m.text()}`); });
  page.on('response', async r => {
    if (!/\/api\/(match|kommando|status|lobby|session)/.test(r.url())) return;
    try { const data = await r.json(); assertNoSecrets(data, data?.view?.me?.id ?? data?.me?.playerId ?? null); } catch (e) { if (e.name === 'ContractError' || /Hemlig|Endast den egna/.test(e.message)) hemligt.push(`${g.namn}: ${e.message}`); }
  });
  return page;
}
async function gast(namn, mobil) {
  const g = { namn, mobil, klickfel: new Map(), context: await browser.newContext(mobil ? devices['iPhone 13'] : { viewport: { width: 1280, height: 900 } }) };
  g.page = await nyFlik(g);
  await g.page.goto(`${base}/lobby.html`);
  await g.page.getByLabel('Ditt nick').fill(namn);
  await g.page.getByRole('button', { name: 'Gå in i lobbyn' }).click();
  await g.page.locator('#lobby-section:not([hidden])').waitFor();
  await g.page.locator('#connection:text("Ansluten")').waitFor();
  g.cookie = (await g.context.cookies()).find(c => c.name === 'tornstriden_session').value;
  return g;
}

/* Lobbyn helt via gränssnittet: värden bjuder in, alla accepterar, väljer lag växelvis och blir redo; värden startar. */
async function lobbyflode(grupp) {
  const [vard, ...ovriga] = grupp;
  for (const g of ovriga) await vard.page.locator('#players li').filter({ hasText: g.namn }).locator('input').check();
  await vard.page.locator('#invite').click();
  for (const g of ovriga) {
    await g.page.getByRole('button', { name: 'Acceptera' }).click();
    await g.page.locator('#room:not([hidden])').waitFor();
  }
  for (const [i, g] of grupp.entries()) await g.page.getByRole('button', { name: i % 2 ? 'Välj Norra laget' : 'Välj Södra laget' }).click();
  for (const g of grupp) { await g.page.locator('#ready:not([disabled])').waitFor({ timeout: 8000 }); await g.page.locator('#ready').click(); }
  await vard.page.locator('#start:not([disabled])').waitFor({ timeout: 8000 });
  await vard.page.locator('#start').click();
  const sida = grupp.length === 2 ? /match\.html\?online=1/ : /lagmatch\.html/;
  for (const g of grupp) await g.page.waitForURL(sida, { timeout: 15000 });
}

/* ---- Spelstegen via gränssnittet ---- */
/* Ett klick; misslyckade klick räknas per deltagare och orsak, så att en fastnad sida går att förklara.
   Väntetiden täcker knapparnas korta gungning (nudge, 2 × 1,4 s) – Playwright klickar först när knappen står still. */
async function klick(page, sel, g = null) {
  try { await page.click(sel, { timeout: 4000 }); return true; }
  catch (e) {
    if (g) {
      const rader = e.message.split('\n');
      const orsak = rader.find(r => /intercepts|not visible|not stable|not enabled|disabled|detached/.test(r)) ?? rader.find(r => /Timeout/.test(r)) ?? rader[0];
      const nyckel = `${sel} – ${orsak.replace(/\x1b\[\d+m/g, '').trim().slice(0, 140)}`;
      g.klickfel.set(nyckel, (g.klickfel.get(nyckel) ?? 0) + 1);
    }
    return false;
  }
}
const lage = page => page.evaluate(() => {
  const synlig = el => Boolean(el) && !el.closest('[hidden]') && el.getClientRects().length > 0;
  const q = sel => document.querySelector(sel);
  const aktiv = sel => synlig(q(sel)) && !q(sel).disabled;
  return {
    intro: Boolean(q('#intro-dialog[open]')), kort: Boolean(q('#card-dialog[open]')), resultat: Boolean(q('#result-dialog[open]')), bekrafta: Boolean(q('#confirm-dialog[open]')),
    byteshjalp: Boolean(q('#swap-dialog[open]')), startruta: Boolean(q('#start-dialog[open]')), startPlay: aktiv('#start-play'),
    dialogLobby: synlig(q('#dialog-lobby')) || synlig(q('#dialog-new')), dialogNext: aktiv('#dialog-next'),
    keep: aktiv('#keep-hand'), start: aktiv('#confirm-start'), next: aktiv('#confirm-next'),
    mal: [...document.querySelectorAll('#choices [data-target]')].map(b => b.dataset.target),
    malValt: Boolean(q('#choices [data-target][aria-pressed="true"]')), malKlar: aktiv('#confirm-target'),
    valtKort: Boolean(q('#hand button.mini-card[aria-pressed="true"]')), anfallKlar: aktiv('#confirm-attack'), forsvarKlar: aktiv('#confirm-defend'),
    valAntal: document.querySelectorAll('#choices [data-card-target], #choices [data-player-target]').length, valGjort: Boolean(q('#choices [aria-pressed="true"]')),
    anfall: synlig(q('#confirm-attack')), avstaAnfall: aktiv('#confirm-pass-attack'), forsvar: synlig(q('#confirm-defend')), avsta: aktiv('#confirm-pass'),
    anvandbara: [...document.querySelectorAll('#hand button.mini-card:not(.unusable):not(.inactive)')].map(b => b.dataset.instance),
    anslutning: q('#connection')?.textContent ?? ''
  };
});
const kortSel = id => `#hand button[data-instance="${id}"]`;
/* Ett val för en deltagare (duell och lagmatch har samma knappnamn för det mesta). Returnerar true om något gjordes. */
async function steg(g, forut = null) {
  const page = g.page;
  let s = forut;
  if (!s) { try { s = await lage(page); } catch { return false; } }
  if (s.intro) return klick(page, '#intro-close', g);
  if (s.byteshjalp) return klick(page, '#swap-close', g);
  if (s.kort) { await page.keyboard.press('Escape'); return true; }
  if (s.bekrafta) return false;
  if (s.resultat) {
    if (s.dialogLobby) { g.klar = true; return false; }
    if (s.dialogNext) return klick(page, '#dialog-next', g);
    return false;
  }
  if (s.startruta) return s.startPlay ? klick(page, '#start-play', g) : false;
  if (s.keep) return klick(page, '#keep-hand', g);
  if (s.start) return klick(page, '#confirm-start', g);
  /* Som en människa: välj en gång och bekräfta i nästa steg – att välja om i varje varv ritar om knappen hela tiden. */
  if (s.mal.length) return s.malValt && s.malKlar ? klick(page, '#confirm-target', g) : klick(page, `#choices [data-target="${pick(s.mal)}"]`, g);
  if (s.anfall) {
    if (s.valtKort && s.anfallKlar) return klick(page, '#confirm-attack', g);
    if (s.avstaAnfall && random() < 0.35) return klick(page, '#confirm-pass-attack', g);
    if (!s.anvandbara.length) return s.avstaAnfall ? klick(page, '#confirm-pass-attack', g) : klick(page, '#usage-simple', g);
    return klick(page, kortSel(pick(s.anvandbara)), g);
  }
  if (s.forsvar) {
    if (s.valtKort && s.forsvarKlar) return klick(page, '#confirm-defend', g);
    if (s.valtKort && s.valAntal && !s.valGjort) return klick(page, `#choices [data-card-target], #choices [data-player-target] >> nth=${Math.floor(random() * s.valAntal)}`, g);
    if (s.valtKort || !s.anvandbara.length || random() < 0.3) return klick(page, '#confirm-pass', g);
    return klick(page, kortSel(pick(s.anvandbara)), g);
  }
  if (s.next) return klick(page, '#confirm-next', g);
  return false;
}
const strid = async page => Number((await page.locator('#match-label').textContent().catch(() => '')).match(/STRID (\d+)|Strid (\d+)/)?.slice(1).find(Boolean) ?? 0);

/* Vakt: har en deltagare förbrukat mer än halva turtiden (45 av 90 s, enligt serverns egen deadline för just det
   valet) sparas läget, de misslyckade klicken och en skärmdump – en sida som inte går att spela på ska synas som
   fel, inte som en tidsutslagning. Varje val rapporteras en gång. */
const fastnade = [];
let varvMax = 0;
async function vakt(g) {
  if (g.offline || g.klar) return;
  const svar = await fetch(`${base}/api/match`, { headers: { cookie: `tornstriden_session=${g.cookie}` } }).then(r => r.ok ? r.json() : null).catch(() => null);
  const v = svar?.view;
  if (!v?.deadline || !v.serverTime) return;
  const kvar = v.deadline.at - v.serverTime;
  if (kvar > 45_000 || g.rapporterad === v.deadline.at) return;
  g.rapporterad = v.deadline.at;
  const bild = join(OUT, `fast-${g.namn}-${fastnade.length + 1}.png`);
  await g.page.screenshot({ path: bild }).catch(() => {});
  const val = (v.allowed ?? []).map(a => a.type).filter(t => t !== 'GE_UPP').join('/');
  const text = `${g.namn}${g.mobil ? ' (mobil)' : ''}: ${v.phase}, ${val}, ${Math.round(kvar / 1000)} s kvar; läge ${JSON.stringify(await lage(g.page).catch(() => null))}; klickfel ${JSON.stringify([...g.klickfel].sort((a, b) => b[1] - a[1]).slice(0, 3))}; längsta varv ${Math.round(varvMax / 1000)} s; bild ${bild}`;
  fastnade.push(text);
  console.log('FAST', text);
}
/* Spelar alla matcher i omgången samtidigt tills alla kvarvarande har resultatrutan med Till lobbyn. */
async function spela(grupper, handelser) {
  const aktiva = () => grupper.flat().filter(g => !g.borta);
  let vilande = 0, senastVakt = 0;
  const slut = Date.now() + 60 * 60_000;
  while (Date.now() < slut && !aktiva().every(g => g.klar)) {
    let gjort = false;
    const varvStart = Date.now();
    /* Alla sidor läser sitt läge och agerar samtidigt, som riktiga spelare (turtiden är verkliga 90 s). */
    const spelande = aktiva().filter(g => !g.klar && !g.offline);
    const gjorda = await Promise.all(spelande.map(async g => { const s = await lage(g.page).catch(() => null); return s ? steg(g, s).catch(() => false) : false; }));
    if (gjorda.some(Boolean)) gjort = true;
    varvMax = Math.max(varvMax, Date.now() - varvStart);
    for (const h of handelser) if (!h.gjord && await h.nar()) { h.gjord = true; await h.gor(); gjort = true; }
    if (Date.now() - senastVakt > 5000) { senastVakt = Date.now(); await Promise.all(aktiva().map(vakt)); }
    vilande = gjort ? 0 : vilande + 1;
    if (!gjort) await vanta(120);
    if (vilande > 600) { console.log('STOPP', JSON.stringify(await Promise.all(aktiva().map(async g => [g.namn, g.klar, await lage(g.page).catch(() => null)])))); break; }
  }
}

async function tillLobbyn(grupp, storlek) {
  const kvar = grupp.filter(g => !g.borta);
  for (const g of kvar) { await klick(g.page, '#dialog-lobby, #dialog-new'); await g.page.waitForURL(/lobby\.html/, { timeout: 10000 }).catch(() => {}); }
  for (const g of kvar) await g.page.locator('#lobby-section:not([hidden])').waitFor({ timeout: 8000 }).catch(() => {});
  const lista = await kvar[0].page.locator('#players li').allTextContents();
  const lediga = kvar.every(g => lista.some(t => t.includes(g.namn) && /Ledig|Det är du/i.test(t)));
  check(`${storlek}: alla kvarvarande är tillbaka i lobbyn som lediga`, lediga && kvar.every(g => /lobby\.html/.test(g.page.url())), lista.filter(t => kvar.some(g => t.includes(g.namn))).join(' | '));
}

const resultatText = g => g.page.locator('#result').textContent().catch(() => '');
async function kollaResultat(grupp, storlek) {
  const kvar = grupp.filter(g => !g.borta);
  const alla = kvar.every(g => g.klar);
  const texter = await Promise.all(kvar.map(resultatText));
  check(`${storlek}: hela matchen spelades via gränssnittet till resultatrutan hos alla`, alla, `${kvar.filter(g => g.klar).length}/${kvar.length}`);
  const vinner = texter.filter(t => /Du vinner|Ditt lag vinner/.test(t)).length, forlorar = texter.filter(t => /vinner matchen/.test(t) && !/Du vinner|Ditt lag vinner/.test(t)).length;
  check(`${storlek}: resultatet är personligt – vinnarna ser sin vinst, de andra vinnarens namn`, vinner >= 1 && vinner + forlorar === kvar.length, `${vinner} vinnare, ${forlorar} andra`);
  await kvar[0].page.screenshot({ path: join(OUT, `${storlek}-slut.png`) });
}

const OMGANG = process.argv.includes('--omgang') ? Number(process.argv[process.argv.indexOf('--omgang') + 1]) : null;
const NAMN = { 2: ['Ada', 'Ben'], 4: ['Cia', 'Dag', 'Eva', 'Fil'], 6: ['Gun', 'Hugo', 'Ida', 'Jon', 'Kim', 'Liv'], 8: ['Mia', 'Nils', 'Olle', 'Pia', 'Rut', 'Sam', 'Tor', 'Ulf'] };
const grupp = storlek => Promise.all(NAMN[storlek].map((n, i) => gast(n, i % 2 === 1)));

try {
  /* ---- Omgång 1: duell och åtta deltagare samtidigt ---- */
  if (OMGANG !== 2) {
  const [tva, atta] = [await grupp(2), await grupp(8)];
  await Promise.all([lobbyflode(tva), lobbyflode(atta)]);
  check('2 och 8: lobbyflödet via gränssnittet startade båda matcherna samtidigt', true);
  const offline = atta[3];   // Pia, mobil
  const saFranKopplad = { sett: false };
  /* Avbrottet stoppar inte de andra: händelserna prövas i varje spelvarv och väntar aldrig själva. */
  const pia = { borta: 0, ater: 0 };
  const chipText = () => atta[0].page.locator('.tower-chip', { hasText: offline.namn }).textContent().catch(() => '');
  const handelser1 = [{
    nar: async () => await strid(atta[0].page) >= 2,
    gor: async () => { offline.offline = true; await offline.context.setOffline(true); pia.borta = Date.now(); }
  }, {
    nar: async () => {
      if (!pia.borta) return false;
      if (!saFranKopplad.sett) saFranKopplad.sett = /Frånkopplad/.test(await chipText());
      return Date.now() - pia.borta >= 25_000;
    },
    gor: async () => {
      await offline.context.setOffline(false);
      pia.ater = Date.now();
      check('8: offline i 25 s – servern märker tystnaden och de andra ser "Frånkopplad"', saFranKopplad.sett);
    }
  }, {
    nar: async () => pia.ater > 0 && (/Ansluten/.test(await offline.page.locator('#connection').textContent().catch(() => '')) || Date.now() - pia.ater > 20_000),
    gor: async () => {
      const tillbaka = /Ansluten/.test(await offline.page.locator('#connection').textContent().catch(() => ''));
      offline.offline = false;
      check('8: spelaren kommer tillbaka av sig själv och spelar vidare', tillbaka, `${Math.round((Date.now() - pia.ater) / 100) / 10} s efter att nätet kom tillbaka`);
    }
  }];
  await spela([tva, atta], handelser1);
  await kollaResultat(tva, 2);
  await kollaResultat(atta, 8);
  check('8: mobilvyn visar egen hand och bord', await atta[1].page.locator('#hand button.mini-card, #result-dialog[open]').count() > 0);
  await tillLobbyn(tva, 2);
  await tillLobbyn(atta, 8);
  }

  /* ---- Omgång 2: fyra och sex deltagare samtidigt ---- */
  if (OMGANG !== 1) {
  const [fyra, sex] = [await grupp(4), await grupp(6)];
  await Promise.all([lobbyflode(fyra), lobbyflode(sex)]);
  check('4 och 6: lobbyflödet via gränssnittet startade båda matcherna samtidigt', true);
  const stangd = sex[2];      // Ida stänger webbläsaren hårt
  const laddar = fyra[1];     // Dag laddar om och öppnar sedan en andra flik
  const handelser2 = [{
    nar: async () => await strid(sex[0].page) >= 2,
    gor: async () => { await stangd.context.close(); stangd.borta = true; }
  }, {
    nar: async () => await strid(fyra[0].page) >= 2,
    gor: async () => {
      await laddar.page.reload();
      await laddar.page.locator('#connection:text("Ansluten")').waitFor({ timeout: 10000 });
      const gammal = laddar.page;
      laddar.page = await nyFlik(laddar);
      await laddar.page.goto(`${base}/lagmatch.html`);
      await laddar.page.locator('#connection:text("Ansluten")').waitFor({ timeout: 10000 });
      const besked = await gammal.locator('#notice, #connection').allTextContents().then(t => t.join(' ')).catch(() => '');
      check('4: omladdning och en andra flik – den nya fliken spelar vidare, den gamla får beskedet', /annan flik/i.test(besked), besked.trim().slice(0, 100));
      await gammal.close();
    }
  }];
  await spela([fyra, sex], handelser2);
  const chip = await sex[0].page.locator('.tower-chip', { hasText: stangd.namn }).textContent().catch(() => '');
  check('6: den som stängde webbläsaren slogs ut efter fristen och laget spelade vidare (ojämna lag)', /kom inte tillbaka/i.test(chip), chip.trim());
  await kollaResultat(fyra, 4);
  await kollaResultat(sex, 6);
  await tillLobbyn(fyra, 4);
  await tillLobbyn(sex, 6);
  }
  console.log(`längsta spelvarv (alla sidor ett steg): ${Math.round(varvMax / 100) / 10} s`);
  check('ingen deltagare fastnade (inget val tog mer än halva turtiden)', fastnade.length === 0, fastnade.slice(0, 2).join(' || '));
  check('inga andras händer eller hemliga fält i något API-svar till sidorna', hemligt.length === 0, hemligt.slice(0, 3).join(' | '));
  check('inga sid- eller konsolfel', fel.length === 0, fel.slice(0, 5).join(' | '));
} catch (error) {
  check('provet kunde köras klart', false, error.stack?.split('\n').slice(0, 3).join(' '));
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
const fail = results.filter(r => !r.ok);
console.log(`\n${results.length - fail.length}/${results.length} kontroller OK`);
process.exit(fail.length ? 1 : 0);
