/* Webbläsarprov av ljud, animationer och besked (arbetsordning L19) med styrd serverklocka.
   Sidornas begärda effektljud räknas via fönsterhändelsen `tornstriden:ljud` (ljud.js). Provet kontrollerar:
   - varje ny händelse ger sitt ljud högst en gång (kortspel, byte, livsförlust, vunnen strid, matchslut);
   - stridsanimationen (skakande torn, brustna hjärtan) spelas för en ny händelse men inte vid nästa ritning;
   - omladdning är tyst och utan animation för det som redan hänt;
   - en lagkamrats avhopp ger inget förlustljud, bara ett besked om vem och varför; lagets förlust hörs först vid
     matchslut;
   - ljudinställningarna sparas och långtryck öppnar kortet förstorat.
   Dragen skickas över HTTP med gästernas kakor, så att sidorna får dem som vilka serverhändelser som helst.
   Kör från projektroten: `npm install` och sedan `node scripts/prova-aterkoppling.mjs`.
   PLAYWRIGHT_CHANNEL=chrome eller PLAYWRIGHT_EXECUTABLE=/sökväg/chrome väljer webbläsare. */
import { chromium, devices } from 'playwright';
import { startaServer } from '../online/server.js';
import { styrdKlocka, styrdSlump } from '../teststod.js';
import { LOBBY_COMMAND, MATCH_COMMAND as C, PROTOCOL_VERSION, RECEIPT } from '../kontrakt.js';
import { USAGE } from '../matchregler.js';

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK ' : 'FEL'} ${name}${extra ? ' – ' + extra : ''}`); };
const app = startaServer({ port: 0, dataDir: ':memory:', klocka: styrdKlocka(1_000_000), slump: styrdSlump(7), lagspel: true, logg: { info() {}, warn() {}, error() {} } });
await app.klar;
const base = `http://127.0.0.1:${app.port()}`;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined });
const fel = [];
let n = 0;

async function oppna(g) {
  g.context = await browser.newContext(g.mobil ? devices['iPhone 13'] : { viewport: { width: 1280, height: 900 } });
  await g.context.addCookies([{ name: 'tornstriden_session', value: g.token, url: base }]);
  await g.context.addInitScript(() => {
    window.__ljud = [];
    window.__hjartbrott = [];
    addEventListener('tornstriden:ljud', e => window.__ljud.push(e.detail));
    document.addEventListener('animationstart', e => {
      if (e.animationName === 'heart-break') window.__hjartbrott.push({ nod: e.target, tid: Date.now() });
    });
  });
  g.page = await g.context.newPage();
  await g.page.addInitScript(() => { try { if (!localStorage.getItem('tornstriden-language')) localStorage.setItem('tornstriden-language', 'sv'); } catch {} });
  g.page.on('pageerror', e => fel.push(`${g.namn}: ${e.message}`));
  g.page.on('console', m => {
    if (g.tapparKvittens && m.text() === 'Failed to load resource: net::ERR_FAILED' && m.location().url === `${base}/api/kommando`) return;
    if (m.type() === 'error' && !/mp3|audio|media/i.test(m.text())) fel.push(`${g.namn}: ${m.text()}`);
  });
}
async function startaMatch(nicks) {
  const gaster = nicks.map((nick, index) => ({ ...app.sessioner.skapa(nick), index, namn: nick, mobil: index % 2 === 1 }));
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
  for (const g of gaster) { await oppna(g); await g.page.goto(`${base}/match.html?online=1`); }
  return { gaster, matchId: app.lagring.hamtaRum(room.id).matchId };
}
const vy = g => app.matcher.matchFor(g.session.playerId).view;
/* Ett drag över HTTP med gästens kaka; servern skickar sedan vyer och händelser till alla strömmar. */
async function kommando(g, type, payload = {}) {
  const v = vy(g);
  const svar = await fetch(`${base}/api/kommando`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, cookie: `tornstriden_session=${g.token}` }, body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: `p${++n}`, type, matchId: v.matchId, revision: v.revision, payload }) });
  const kvitto = await svar.json();
  if (kvitto.status !== RECEIPT.ok) throw new Error(`${g.namn} ${type}: ${kvitto.message}`);
  return kvitto;
}
const ljud = g => g.page.evaluate(() => window.__ljud.slice());
const nollstall = gaster => Promise.all(gaster.map(g => g.page.evaluate(() => { window.__ljud.length = 0; })));
const stilla = (ms = 700) => new Promise(r => setTimeout(r, ms));   // låt strömmar, renderingar och rutor landa
const lika = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function inne(g) {
  await g.page.locator('#intro-dialog[open]').waitFor();
  await g.page.click('#intro-close');
  await g.page.locator('#connection:text("Ansluten")').waitFor({ timeout: 5000 });
}
async function laddaOm(g) {
  await g.page.reload();
  await inne(g);
  await stilla();
}
const stangByteshjalp = async g => { if (await g.page.locator('#swap-dialog[open]').count()) await g.page.click('#swap-close'); };

/* ---- Duell ---- */
{
  const { gaster: [ada, ben], matchId } = await startaMatch(['Ada', 'Ben']);
  const post = () => app.lagring.hamtaMatch(matchId).match;
  for (const g of [ada, ben]) await inne(g);
  await stilla();
  await stangByteshjalp(ada);
  await stilla(300);
  check('duell: utdelningsljudet när bytet börjar', lika(await ljud(ada), ['shuffle']), JSON.stringify(await ljud(ada)));
  await laddaOm(ada);
  await stangByteshjalp(ada);
  await stilla(300);
  check('duell: omladdning mitt i bytena spelar inte utdelningen igen', lika(await ljud(ada), []), JSON.stringify(await ljud(ada)));

  await nollstall([ada, ben]);
  /* L19, granskningsfel 1: servern skickar BYTE men HTTP-kvittensen tappas. Flygningen ska ske
     vid händelsen, inte när statuskontrollen senare hittar samma kvittens (oförändrad revision). */
  await ada.page.evaluate(() => {
    window.__bytesflygningar = 0;
    new MutationObserver(ms => {
      for (const m of ms) for (const el of m.addedNodes) {
        if (el.nodeType === 1 && el.matches('.fly-card')) window.__bytesflygningar++;
      }
    }).observe(document.body, { childList: true });
  });
  let slappKvittens;
  const hallKvittens = new Promise(resolve => { slappKvittens = resolve; });
  const tappaKvittens = async route => { await route.fetch(); await hallKvittens; await route.abort('failed'); };
  await ada.page.route('**/api/kommando', tappaKvittens);
  await ada.page.locator('#hand button.mini-card').nth(0).click();
  await ada.page.locator('#hand button.mini-card').nth(1).click();
  await ada.page.locator('#confirm-swap').click();
  await ada.page.waitForFunction(() => window.__ljud.includes('shuffle'));
  await stilla();
  const foreKvittens = await ada.page.evaluate(() => window.__bytesflygningar);
  check('duell: byteshändelsen animerar två kort innan kvittensen kommer', foreKvittens === 2, String(foreKvittens));
  const statusSvar = ada.page.waitForResponse(r => r.url().includes('/api/status?') && r.ok());
  ada.tapparKvittens = true; // endast det avsiktligt avbrutna kommandots konsolfel är väntat
  slappKvittens();
  await statusSvar;
  await ada.page.waitForFunction(() => !/Skickar|Kontrollerar/.test(document.querySelector('#notice').textContent));
  await stilla();
  ada.tapparKvittens = false;
  check('duell: återhämtad kvittens startar ingen gammal bytesanimation', await ada.page.evaluate(() => window.__bytesflygningar) === foreKvittens);
  await ada.page.unroute('**/api/kommando', tappaKvittens);
  check('duell: ett byte ger blandningsljudet en gång hos båda', lika(await ljud(ada), ['shuffle']) && lika(await ljud(ben), ['shuffle']), `${JSON.stringify(await ljud(ada))} ${JSON.stringify(await ljud(ben))}`);
  await stangByteshjalp(ben);
  await kommando(ben, C.swap, { cards: [] });
  await ada.page.locator('#hand button.mini-card').first().click();
  await ada.page.locator('#confirm-swap').click();
  await ada.page.waitForFunction(() => !/Skickar|Kontrollerar/.test(document.querySelector('#notice').textContent));
  await stilla();
  check('duell: vanligt byte med direkt kvittens animeras en gång', await ada.page.evaluate(() => window.__bytesflygningar) === foreKvittens + 1);
  await kommando(ben, C.swap, { cards: [] });
  for (const g of [ada, ben]) await kommando(g, C.confirmStart);
  await stilla();

  const vem = seat => post().seats[seat] === ada.session.playerId ? ada : ben;
  const anfallare = vem(post().engine.activePlayer);
  const forsvarare = anfallare === ada ? ben : ada;
  await nollstall([ada, ben]);
  const anfall = vy(anfallare).allowed.find(a => a.type === C.attack);
  const vanligt = anfall.normal[0];
  await kommando(anfallare, C.attack, { instanceId: (vanligt ?? anfall.simple[0]).instanceId, usage: vanligt ? USAGE.normal : USAGE.simple });
  await stilla();
  const kortljud = s => s.length === 2 && s[0] === 'card' && ['attack', 'magic'].includes(s[1]);
  check('duell: ett spelat anfallskort ger kort- och anfallsljud en gång hos båda', kortljud(await ljud(ada)) && kortljud(await ljud(ben)), `${JSON.stringify(await ljud(ada))} ${JSON.stringify(await ljud(ben))}`);

  /* Försvararen avstår på sin egen sida: hon får både strömmens vy och sin kvittens (två ritningar tätt efter varandra). */
  await nollstall([ada, ben]);
  await forsvarare.page.locator('#confirm-pass:not([disabled])').click();
  for (const g of [ada, ben]) await g.page.locator('#result-dialog[open]').waitFor({ timeout: 8000 });
  check('duell: det träffade tornet skakar och hjärtat brister hos båda (ny händelse)', await forsvarare.page.locator('#tower-A.hit').count() === 1 && await anfallare.page.locator('#tower-B.hit').count() === 1 && await anfallare.page.locator('#life-B .just-lost').count() >= 1);
  check('duell: hjärtat brister fortfarande hos den som själv avgjorde striden (kvittensen avbryter inte animationen)', await forsvarare.page.locator('#life-A .just-lost').count() >= 1);
  await stilla();
  check('duell: försvararen hör livsförlust, anfallaren vunnen strid – en gång var', lika(await ljud(forsvarare), ['lifeLost']) && lika(await ljud(anfallare), ['battleWon']), `${JSON.stringify(await ljud(forsvarare))} ${JSON.stringify(await ljud(anfallare))}`);
  /* En senare ritning (motståndaren trycker Fortsätt) spelar inte animationen eller ljudet igen. */
  const hjartbrottFore = await forsvarare.page.evaluate(() => window.__hjartbrott.length);
  await kommando(anfallare, C.next);
  await stilla();
  check('duell: en senare ritning bryter inte hjärtat igen och ger inget nytt ljud', hjartbrottFore > 0 && await forsvarare.page.evaluate(() => window.__hjartbrott.length) === hjartbrottFore && lika(await ljud(forsvarare), ['lifeLost']));

  await laddaOm(forsvarare);
  await forsvarare.page.locator('#result-dialog[open]').waitFor({ timeout: 8000 });
  await stilla();
  check('duell: omladdning i resultatläget är tyst och utan stridsanimation', lika(await ljud(forsvarare), []) && await forsvarare.page.locator('#tower-A.hit').count() === 0 && await forsvarare.page.locator('.just-lost').count() === 0, JSON.stringify(await ljud(forsvarare)));

  /* Ljudinställningarna sparas, och långtryck öppnar kortet förstorat. */
  const sida = forsvarare.page;
  await sida.keyboard.press('Escape');
  await sida.click('#sound-settings');
  await sida.locator('#sound-dialog[open]').waitFor();
  await sida.uncheck('#sound-enabled');
  await sida.click('#sound-close');
  await laddaOm(forsvarare);
  const sparat = await sida.evaluate(() => JSON.parse(localStorage.getItem('tornstriden-ljud-v1') ?? 'null'));
  check('ljudinställningen sparas över omladdning', sparat?.enabled === false && (await sida.locator('#sound-settings').textContent()).includes('Av'));
  await sida.keyboard.press('Escape');
  await sida.click('#sound-settings');
  await sida.check('#sound-enabled');
  await sida.click('#sound-close');
  const handkort = sida.locator('#hand button.mini-card').first();
  const box = await handkort.boundingBox();
  await sida.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await sida.mouse.down();
  await sida.waitForTimeout(700);
  const oppen = await sida.locator('#card-dialog[open]').count();
  await sida.mouse.up();
  check('långtryck öppnar kortet förstorat', oppen === 1);
  for (const g of [ada, ben]) await g.context.close();
}

/* ---- Lagmatch, fyra deltagare (Anna och Cy i lag A, Bo och Di i lag B) ---- */
{
  const { gaster, matchId } = await startaMatch(['Anna', 'Bo', 'Cy', 'Di']);
  const [anna, bo, cy, di] = gaster;
  const motor = () => app.lagring.hamtaMatch(matchId).match.engine;
  for (const g of gaster) await g.page.waitForURL(/lagmatch\.html/, { timeout: 8000 });
  for (const g of gaster) await inne(g);
  /* Alla väljer så enkelt som möjligt: behåll handen, bekräfta, första måltavlan, ledaren anfaller med enkel
     attack 1, övriga avstår, försvararna avstår – striden blir en träff på ett liv. */
  async function ettVal() {
    for (const g of gaster) {
      const v = vy(g);
      const val = new Map(v.allowed.map(a => [a.type, a]));
      if (val.has(C.swap)) return kommando(g, C.swap, { cards: [] });
      if (val.has(C.confirmStart)) return kommando(g, C.confirmStart);
      if (val.has(C.target)) return kommando(g, C.target, { targetPlayerId: val.get(C.target).players[0] });
      if (val.has(C.attack) && (v.battle?.leader === v.viewer || !val.has(C.passAttack))) return kommando(g, C.attack, { instanceId: val.get(C.attack).simple[0].instanceId, usage: USAGE.simple });
      if (val.has(C.passAttack)) return kommando(g, C.passAttack);
      if (val.has(C.pass)) return kommando(g, C.pass);
    }
    throw new Error('Ingen kan välja.');
  }
  while (motor().phase !== 'FÖRSVAR') await ettVal();
  await stilla();
  await nollstall(gaster);
  /* Försvararna avstår på sina egna sidor; den sista avgör striden och får sin kvittens strax efter vyn. */
  let sista = null;
  while (motor().phase !== 'RESULTAT') {
    const g = gaster.find(x => vy(x).activePlayer === x.session.playerId);
    const fore = motor().revision;
    await g.page.locator('#confirm-pass:not([disabled])').click();
    sista = g;
    for (let i = 0; i < 100 && motor().revision === fore; i++) await new Promise(r => setTimeout(r, 30));
  }
  for (const g of gaster) await g.page.locator('#result-dialog[open]').waitFor({ timeout: 8000 });
  const r = motor().lastResult;
  const malNamn = gaster.find(g => g.session.playerId === r.target).namn;
  check('lag: hjärtat brister fortfarande hos den som själv avgjorde striden', await sista.page.locator('.tower-chip', { hasText: malNamn }).locator('.just-lost').count() >= 1);
  const brustna = g => g.page.locator('.tower-chip', { hasText: malNamn }).locator('.just-lost').count();
  check('lag: måltavlans hjärta brister hos alla (ny händelse)', (await Promise.all(gaster.map(brustna))).every(c => c >= 1));
  const mal = gaster.find(g => g.session.playerId === r.target);
  const kamrat = gaster.find(g => g !== mal && g.index % 2 === mal.index % 2);
  const anfallarna = gaster.filter(g => g.index % 2 !== mal.index % 2);
  for (const g of gaster) await g.page.waitForFunction(() => window.__hjartbrott.length > 0);
  /* Två snabba bekräftelser ändrar både måltavlans och lagkamratens statustext medan hjärtat brister.
     Räkna faktiska animationsstarter och kontrollera att den ursprungliga noden fortfarande sitter kvar. */
  await kommando(mal, C.next);
  await kommando(kamrat, C.next);
  check('lag: bekräftelserna kommer inom hjärtanimationens tidsfönster', (await Promise.all(gaster.map(g => g.page.evaluate(() => Date.now() - window.__hjartbrott[0].tid < 900)))).every(Boolean));
  await stilla();
  check('lag: snabba Fortsätt startar inte om hjärtanimationen hos någon spelare', (await Promise.all(gaster.map(g => g.page.evaluate(() => window.__hjartbrott.length === 1 && window.__hjartbrott[0].nod.isConnected)))).every(Boolean));
  check('lag: bekräftelsernas statustext uppdateras ändå', (await Promise.all(gaster.map(async g => {
    const texter = await Promise.all([mal, kamrat].map(p => g.page.locator('.tower-chip', { hasText: p.namn }).textContent()));
    return texter.every(text => !text.includes('Inte klar'));
  }))).every(Boolean));
  check('lag: måltavlan hör livsförlust en gång', lika(await ljud(mal), ['lifeLost']), JSON.stringify(await ljud(mal)));
  check('lag: måltavlans lagkamrat hör inget (inte min livsförlust, ingen vunnen strid)', lika(await ljud(kamrat), []), JSON.stringify(await ljud(kamrat)));
  check('lag: hela det anfallande laget hör vunnen strid en gång', (await Promise.all(anfallarna.map(ljud))).every(s => lika(s, ['battleWon'])));
  await laddaOm(mal);
  await mal.page.locator('#result-dialog[open]').waitFor({ timeout: 8000 });
  await stilla();
  check('lag: omladdning i resultatläget är tyst och utan animation', lika(await ljud(mal), []) && await brustna(mal) === 0, JSON.stringify(await ljud(mal)));

  /* Nästa strid; Cy lämnar. Anna (lagkamrat) får besked men inget förlustljud – laget spelar vidare. */
  for (const g of gaster.filter(g => g !== mal && g !== kamrat)) await kommando(g, C.next);
  await stilla();
  for (const g of gaster) if (await g.page.locator('#result-dialog[open]').count()) await g.page.keyboard.press('Escape');
  await nollstall(gaster);
  await kommando(cy, C.surrender);
  await stilla();
  check('lag: en lagkamrats avhopp ger inget ljud', lika(await ljud(anna), []) && lika(await ljud(bo), []), `${JSON.stringify(await ljud(anna))} ${JSON.stringify(await ljud(bo))}`);
  const besked = await anna.page.locator('#notice').textContent();
  check('lag: beskedet säger vem som lämnade', besked.includes('Cy lämnade matchen'), besked);
  /* Anna lämnar också: lag A är slut. Först nu hörs matchslutet – en gång. */
  await kommando(anna, C.surrender);
  for (const g of [bo, di, cy]) await g.page.locator('#result-dialog[open]').waitFor({ timeout: 8000 });
  await stilla();
  check('lag: det vinnande laget hör matchvinst en gång', lika(await ljud(bo), ['matchWon']) && lika(await ljud(di), ['matchWon']), `${JSON.stringify(await ljud(bo))} ${JSON.stringify(await ljud(di))}`);
  check('lag: det förlorande laget hör matchförlust först vid matchslut, en gång', lika(await ljud(cy), ['matchLost']), JSON.stringify(await ljud(cy)));
  await laddaOm(bo);
  await bo.page.locator('#result-dialog[open]').waitFor({ timeout: 8000 });
  await stilla();
  check('lag: omladdning efter matchslut är tyst', lika(await ljud(bo), []), JSON.stringify(await ljud(bo)));
  for (const g of gaster) await g.context.close();
}

/* ---- Lokalt mot datorn: samma händelsevägar ger ljuden ---- */
{
  const g = { namn: 'Lokal', mobil: false, token: 'ingen' };
  await oppna(g);
  const sida = g.page;
  const synlig = sel => sida.locator(sel).isVisible().catch(() => false);
  await sida.goto(`${base}/match.html`);
  await sida.locator('#intro-dialog[open]').waitFor();
  await sida.click('#intro-close');
  await sida.locator('#swap-dialog[open]').waitFor({ timeout: 3000 }).catch(() => {});
  if (await sida.locator('#swap-dialog[open]').count()) await sida.click('#swap-close');
  for (let i = 0; i < 2; i++) { await sida.locator('#hand-bar:not([hidden]) #keep-hand, #start-dialog[open]').first().waitFor({ timeout: 8000 }); if (await synlig('#keep-hand')) await sida.click('#keep-hand'); }
  await sida.locator('#start-dialog[open]').waitFor({ timeout: 8000 });
  await sida.click('#start-play');
  for (let steg = 0; steg < 80 && !(await sida.locator('#result-dialog[open]').count()); steg++) {
    if (await synlig('#confirm-attack')) {
      const kort = sida.locator('#hand button.mini-card:not(.unusable):not(.inactive)');
      if (!(await kort.count())) await sida.click('#usage-simple');
      await sida.locator('#hand button.mini-card:not(.unusable):not(.inactive)').first().click();
      await sida.locator('#confirm-attack:not([disabled])').waitFor({ timeout: 3000 });
      await sida.click('#confirm-attack');
    } else if (await synlig('#confirm-pass')) await sida.click('#confirm-pass');
    else await sida.waitForTimeout(250);
  }
  await stilla();
  const s = await ljud(g);
  const resultat = s.filter(x => ['lifeLost', 'battleWon', 'matchWon', 'matchLost'].includes(x));
  /* Väntat ljud ur tornens stridsanimation: mitt torn träffat → livsförlust; datorns träffat eller mitt försvar höll → vunnen strid. */
  const klass = async sel => (await sida.locator(sel).count()) === 1;
  const vantat = await klass('#tower-A.hit') ? ['lifeLost'] : (await klass('#tower-B.hit') || await klass('#tower-A.held')) ? ['battleWon'] : [];
  check('lokalt mot datorn: kortljud, och resultatljudet stämmer med striden (en gång)', s.includes('card') && lika(resultat, vantat) && (await sida.locator('#result-dialog[open]').count()) === 1, `${JSON.stringify(s)} väntat ${JSON.stringify(vantat)}`);
  await g.context.close();
}

check('inga sid- eller konsolfel', fel.length === 0, fel.slice(0, 5).join(' | '));
await browser.close();
await app.stang();
const fail = results.filter(r => !r.ok);
console.log(`\n${results.length - fail.length}/${results.length} kontroller OK`);
process.exit(fail.length ? 1 : 0);
