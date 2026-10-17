/* Webbläsarprov av lagvyn (arbetsordning L15): hela lagmatcher för 4, 6 och 8 deltagare där varje deltagare
   har en egen webbläsarkontext (varannan med mobilvy) och bara spelar via gränssnittet: byten, startbekräftelse,
   måltavla, anfall, enkel attack, avstående, försvar med kortmål och spelarmål, Fortsätt och resultatrutor.
   I 6-spelarmatchen lämnar en deltagare och följer resten (ojämna lag); i 8-spelarmatchen lämnar en och går
   till lobbyn. Rum och start ordnas direkt via servern (lobbyflödet provas i prova-lobby.mjs).
   Först körs ett riktat prov (granskning L15): ett kortmål som försvinner genom ett avhopp släpps, och
   förhandsvisningen visar lagens summor under striden.
   Kör från projektroten: `npm install` och sedan `node scripts/prova-lag.mjs [4 6 8]`.
   PLAYWRIGHT_CHANNEL=chrome eller PLAYWRIGHT_EXECUTABLE=/sökväg/chrome väljer webbläsare. */
import { chromium, devices } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startaServer } from '../online/server.js';
import { styrdKlocka, styrdSlump } from '../teststod.js';
import { MATCH_STATUS, PROTOCOL_VERSION } from '../kontrakt.js';
import { auditTeam, playerOf } from '../lagkortlek.js';

const SIZES = process.argv.slice(2).map(Number).filter(n => [4, 6, 8].includes(n));
const OUT = mkdtempSync(join(tmpdir(), 'tornstriden-lagprov-'));
console.log(`Skärmdumpar: ${OUT}`);
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK ' : 'FEL'} ${name}${extra ? ' – ' + extra : ''}`); };
const app = startaServer({ port: 0, dataDir: ':memory:', klocka: styrdKlocka(1_000_000), slump: styrdSlump(17), lagspel: true, logg: { info() {}, warn() {}, error() {} } });
await app.klar;
const base = `http://127.0.0.1:${app.port()}`;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined });
const random = styrdSlump(99);
const pick = list => list[Math.floor(random() * list.length)];

/* Läser sidans läge i ett anrop: vilka knappar som syns och går att trycka på. */
const lage = page => page.evaluate(() => {
  const synlig = el => Boolean(el) && !el.closest('[hidden]') && el.getClientRects().length > 0;
  const q = sel => document.querySelector(sel);
  const aktiv = sel => synlig(q(sel)) && !q(sel).disabled;
  return {
    intro: Boolean(q('#intro-dialog[open]')), kort: Boolean(q('#card-dialog[open]')), resultat: Boolean(q('#result-dialog[open]')), bekrafta: Boolean(q('#confirm-dialog[open]')),
    dialogLobby: synlig(q('#dialog-lobby')), dialogNext: aktiv('#dialog-next'),
    keep: aktiv('#keep-hand'), start: aktiv('#confirm-start'), next: aktiv('#confirm-next'),
    mal: [...document.querySelectorAll('#choices [data-target]')].map(b => b.dataset.target),
    anfall: synlig(q('#confirm-attack')), avstaAnfall: aktiv('#confirm-pass-attack'), forsvar: synlig(q('#confirm-defend')), avsta: aktiv('#confirm-pass'),
    utslagen: /Du är utslagen/.test(q('#action-info')?.textContent ?? ''),
    anvandbara: [...document.querySelectorAll('#hand button.mini-card:not(.unusable):not(.inactive)')].map(b => b.dataset.instance),
    hand: document.querySelectorAll('#hand button.mini-card').length,
    fas: q('#phase-title')?.textContent ?? ''
  };
});

async function klick(page, sel) { try { await page.click(sel, { timeout: 2500 }); return true; } catch { return false; } }
const kortSel = id => `#hand button[data-instance="${id}"]`;

/* En deltagares nästa val, bara via gränssnittet. Returnerar true om något gjordes. */
async function steg(g, stats) {
  const page = g.page;
  const s = await lage(page);
  if (s.intro) return klick(page, '#intro-close');
  if (s.kort) { await page.keyboard.press('Escape'); return true; }
  if (s.bekrafta) return false;
  if (s.resultat) {
    if (s.dialogLobby) { g.klar = true; return false; }
    if (s.dialogNext) { stats.fortsatt++; return klick(page, '#dialog-next'); }
    return false;   // väntar på andras Fortsätt
  }
  if (s.keep) {
    const antal = Math.floor(random() * 3);
    if (!antal) { stats.byten++; return klick(page, '#keep-hand'); }
    for (const id of s.anvandbara.slice(0, antal)) await klick(page, kortSel(id));
    stats.byten++;
    return klick(page, '#confirm-swap');
  }
  if (s.start) { stats.start++; return klick(page, '#confirm-start'); }
  if (s.mal.length) {
    await klick(page, `#choices [data-target="${pick(s.mal)}"]`);
    stats.malval++;
    return klick(page, '#confirm-target:not([disabled])');
  }
  if (s.anfall) {
    if (s.avstaAnfall && random() < 0.35) { stats.avstod++; return klick(page, '#confirm-pass-attack'); }
    let kort = s.anvandbara;
    /* Första anfallet i varje match – och när inget kort duger som vanlig attack – görs som enkel attack 1. */
    if (!kort.length || !stats.enkel) { await klick(page, '#usage-simple'); kort = (await lage(page)).anvandbara; stats.enkel++; }
    if (!kort.length) return false;
    await klick(page, kortSel(pick(kort)));
    stats.anfall++;
    return klick(page, '#confirm-attack:not([disabled])');
  }
  if (s.forsvar) {
    if (!s.anvandbara.length || random() < 0.3) { stats.avstod++; return klick(page, '#confirm-pass'); }
    await klick(page, kortSel(pick(s.anvandbara)));
    const val = await page.locator('#choices [data-card-target], #choices [data-player-target]').count();
    if (val) {
      if (!(await page.locator('#choices [aria-pressed="true"]').count())) await page.locator('#choices button').nth(Math.floor(random() * val)).click({ timeout: 2500 }).catch(() => {});
      if (await page.locator('#choices [data-card-target]').count()) stats.kortmal++; else stats.spelarmal++;
      if (!g.mobilBild && g.mobil) { g.mobilBild = true; await page.screenshot({ path: join(OUT, `mobil-kortmal-${g.namn}.png`) }); }
    }
    if (await page.locator('#confirm-defend:not([disabled])').count()) { stats.forsvar++; return klick(page, '#confirm-defend'); }
    stats.avstod++;
    return klick(page, '#confirm-pass');
  }
  if (s.next) { stats.fortsatt++; return klick(page, '#confirm-next'); }
  return false;
}

/* Kort och bekräftelse ska gå att nå på mobilen utan att växla mellan långt åtskilda delar av sidan. */
async function mobilAvstand(page) {
  const knapp = page.locator('#actions button').last();
  let a, h;
  try {   // vyn kan ritas om mitt i mätningen när en ny vy kommer – mät då vid ett senare val
    await knapp.scrollIntoViewIfNeeded({ timeout: 1000 });
    a = await knapp.boundingBox(); h = await page.locator('#hand button.mini-card').first().boundingBox();
  } catch { return null; }
  if (!a || !h) return null;   // t.ex. tom hand just nu – mät vid ett senare val
  const vh = page.viewportSize().height;
  return { mellan: Math.round(h.y - (a.y + a.height)), spann: Math.round(h.y + h.height - a.y), vh, korthojd: Math.round(h.height) };
}

/* Rum med `nicks`, lag växelvis A/B, startat via servern. */
function startaRum(nicks, seed) {
  const gaster = nicks.map((nick, index) => ({ ...app.sessioner.skapa(nick), index }));
  for (const g of gaster) app.sessioner.anslut(g.session.playerId);
  const ids = gaster.map(g => g.session.playerId);
  const room = app.rum.skapa(ids[0]);
  app.rum.bjudIn(ids[0], room.id, ids.slice(1));
  for (const id of ids.slice(1)) app.rum.acceptera(id, app.rum.vyFor(id).inbjudningar.inkommande[0].id);
  ids.forEach((id, i) => app.rum.valjLag(id, room.id, i % 2 ? 'B' : 'A'));
  const rv = app.lagring.hamtaRum(room.id).rosterVersion;
  for (const id of ids) app.rum.redo(id, room.id, true, rv);
  app.rum.starta(ids[0], room.id, rv, { slump: styrdSlump(seed) });
  return { gaster, ids, room, matchId: app.lagring.hamtaRum(room.id).matchId };
}
/* Lägger ett exemplar av kortet i spelarens hand (byter plats med ett kort i draghögen). */
function ge(engine, pid, cardId) {
  const hand = playerOf(engine, pid).hand;
  const at = engine.drawPile.findIndex(id => engine.instances[id] === cardId);
  const id = engine.drawPile[at];
  engine.drawPile[at] = hand[0];
  hand[0] = id;
  auditTeam(engine);
  return id;
}

async function riktatKortmal() {
  const { gaster, ids, matchId } = startaRum(['K-Rut', 'K-Sam', 'K-Tor', 'K-Ulf'], 3);
  const motor = () => app.lagring.hamtaMatch(matchId).match.engine;
  const token = id => gaster.find(g => g.session.playerId === id).token;
  let n = 0;
  /* Kommandon över HTTP med spelarens kaka, så att servern skickar nya vyer i strömmarna. */
  const kommando = async (id, type, payload = {}) => {
    const r = await fetch(`${base}/api/kommando`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', cookie: `tornstriden_session=${token(id)}` }, body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: `riktat-${++n}`, type, matchId, revision: motor().revision, payload }) });
    const kvitto = await r.json();
    if (kvitto.status !== 'GODKÄND') throw new Error(`${type}: ${kvitto.message}`);
  };
  while (motor().phase === 'KORTBYTE') for (const id of ids) if (motor().swapsConfirmed[id] < motor().swapRound) await kommando(id, 'BEKRÄFTA_BYTE', { cards: [] });
  for (const id of ids) await kommando(id, 'BEKRÄFTA_START');
  let e = motor();
  const ledare = e.battle.leader, lag = playerOf(e, ledare).teamId;
  const kamrat = e.teams[lag].find(id => id !== ledare);
  const mal = e.teams[lag === 'A' ? 'B' : 'A'][0];
  const rad = app.lagring.hamtaMatch(matchId);
  const drake = ge(rad.match.engine, ledare, 'drakeld');
  const spegel = ge(rad.match.engine, mal, 'spegelskold');
  app.lagring.sparaMatch(rad.match, rad.status);
  await kommando(ledare, 'VÄLJ_MÅL', { targetPlayerId: mal });
  await kommando(ledare, 'SPELA_ATTACK', { instanceId: drake });
  await kommando(kamrat, 'SPELA_ATTACK', { instanceId: playerOf(motor(), kamrat).hand.find(id => id !== drake), usage: 'simple' });
  /* Måltavlans webbläsare */
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await context.addCookies([{ name: 'tornstriden_session', value: token(mal), url: base }]);
  const page = await context.newPage();
  await page.addInitScript(() => { try { if (!localStorage.getItem('tornstriden-language')) localStorage.setItem('tornstriden-language', 'sv'); } catch {} });
  const fel = [];
  page.on('pageerror', err => fel.push(err.message));
  await page.goto(`${base}/match.html?online=1`);
  await page.waitForURL(/lagmatch\.html/);
  await page.click('#intro-close');
  await page.locator('#confirm-defend').waitFor();
  check('förhandsvisning: lagets attack syns under striden (Drakeld 4 + enkel attack 1)', (await page.locator('#attack-total').textContent()) === '5' && /Just nu: attack 5 mot försvar 0/.test(await page.locator('#phase-description').textContent()));
  await page.click(`#hand button[data-instance="${spegel}"]`);
  const valtMal = await page.locator(`#choices [data-card-target="${drake}"][aria-pressed="true"]`).count();
  check('Spegelsköld får Drakeld som mål direkt (enda magiska kortet)', valtMal === 1);
  await kommando(ledare, 'GE_UPP');   // Drakelds ägare lämnar: kortet tas bort (12B)
  await page.waitForFunction(() => document.getElementById('attack-total').textContent === '1', null, { timeout: 5000 });
  check('efter avhoppet: Drakeld borta ur summan och inget gammalt kortmål kvar', (await page.locator('#choices [data-card-target]').count()) === 0 && (await page.locator('#confirm-defend:not([disabled])').count()) === 1, await page.locator('#action-info').textContent());
  await page.click('#confirm-defend');
  /* Vänta på serverns läge (inte bara på sidan) innan draget kontrolleras. */
  for (let i = 0; i < 50 && !motor().table.some(t => t.playerId === mal && t.role === 'defence'); i++) await new Promise(r => setTimeout(r, 100));
  await page.waitForFunction(() => document.getElementById('defence-total').textContent === '1', null, { timeout: 5000 }).catch(() => {});
  e = motor();
  const spelat = e.table.find(t => t.playerId === mal && t.role === 'defence');
  const notis = await page.locator('#notice').textContent();
  check('försvaret med Spegelsköld godkänns utan mål (granskning L15)', Boolean(spelat) && spelat.targetCard === null && !notis, `notis "${notis}", bordet: ${JSON.stringify(e.table.map(t => ({ ...t, cardId: e.instances[t.instanceId] })))}`);
  check('förhandsvisningen: Spegelsköld utan magiskt mål räknas som försvar 1', (await page.locator('#defence-total').textContent()) === '1', await page.locator('#defence-cards').textContent());
  await page.screenshot({ path: join(OUT, 'riktat-kortmal.png') });
  check('riktat prov: inga sidfel', fel.length === 0, fel.join(' | '));
  await context.close();
}

async function spelaLagmatch(size) {
  const stats = { byten: 0, start: 0, malval: 0, anfall: 0, enkel: 0, avstod: 0, forsvar: 0, kortmal: 0, spelarmal: 0, fortsatt: 0 };
  /* Deltagare, rum och start via servern */
  const gaster = Array.from({ length: size }, (_, i) => ({ ...app.sessioner.skapa(`${'ABCDEFGH'[i]}${size}-${['Anna', 'Bo', 'Cy', 'Di', 'Ek', 'Fia', 'Gus', 'Hed'][i]}`), index: i }));
  for (const g of gaster) app.sessioner.anslut(g.session.playerId);
  const ids = gaster.map(g => g.session.playerId);
  const room = app.rum.skapa(ids[0]);
  app.rum.bjudIn(ids[0], room.id, ids.slice(1));
  for (const id of ids.slice(1)) app.rum.acceptera(id, app.rum.vyFor(id).inbjudningar.inkommande[0].id);
  ids.forEach((id, i) => app.rum.valjLag(id, room.id, i % 2 ? 'B' : 'A'));
  const rv = app.lagring.hamtaRum(room.id).rosterVersion;
  for (const id of ids) app.rum.redo(id, room.id, true, rv);
  app.rum.starta(ids[0], room.id, rv, { slump: styrdSlump(size) });
  const matchId = app.lagring.hamtaRum(room.id).matchId;
  const motor = () => app.lagring.hamtaMatch(matchId).match.engine;

  /* En webbläsarkontext per deltagare; varannan är en mobil */
  const fel = [];
  const svar = [];
  for (const g of gaster) {
    g.namn = g.session.nick;
    g.mobil = g.index % 2 === 1;
    g.context = await browser.newContext({ ...(g.mobil ? devices['iPhone 13'] : { viewport: { width: 1280, height: 900 } }), reducedMotion: 'reduce' });
    await g.context.addCookies([{ name: 'tornstriden_session', value: g.token, url: base }]);
    g.page = await g.context.newPage();
    await g.page.addInitScript(() => { try { if (!localStorage.getItem('tornstriden-language')) localStorage.setItem('tornstriden-language', 'sv'); } catch {} });
    g.page.on('pageerror', e => fel.push(`${g.namn}: ${e.message}`));
    g.page.on('console', m => { if (m.type() === 'error' && !/mp3|audio|media|404/i.test(m.text())) fel.push(`${g.namn}: ${m.text()}`); });
    g.page.on('response', async r => {
      if (!/\/api\/(match|kommando|status)/.test(r.url())) return;
      try {
        const text = await r.text();
        const json = JSON.parse(text);
        const view = json.view;
        if (view) { delete view.lastResult; if (view.battle) { delete view.battle.table; delete view.battle.turns; } }
        delete json.events;
        const egna = JSON.stringify(json);
        for (const p of motor().players) if (p.id !== g.session.playerId) for (const inst of p.hand) if (egna.includes(`"${inst}"`)) svar.push(`${g.namn} såg ${p.name}s kort ${inst}`);
      } catch { /* strömmar och tomma svar */ }
    });
    await g.page.goto(`${base}/match.html?online=1`);
  }
  for (const g of gaster) await g.page.waitForURL(/lagmatch\.html/, { timeout: 8000 });
  check(`${size}: matchsidan skickar alla till lagvyn`, true);
  await Promise.all(gaster.map(g => g.page.locator('#intro-dialog[open]').waitFor()));
  const forsta = gaster[0].page;
  check(`${size}: egen hand med tio kort och båda lagens torn`, (await forsta.locator('#hand button.mini-card').count()) === 10 && (await forsta.locator('#enemy-towers .tower-chip').count()) === size / 2 && (await forsta.locator('#own-towers .tower-chip.me').count()) === 1);
  await forsta.screenshot({ path: join(OUT, `${size}-start-dator.png`) });

  /* Långtryck på ett kort i handen öppnar kortet förstorat (mobilen) */
  const mobil = gaster.find(g => g.mobil);
  await mobil.page.click('#intro-close');
  const kort = mobil.page.locator('#hand button.mini-card').first();
  const box = await kort.boundingBox();
  await mobil.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await mobil.page.mouse.down();
  await mobil.page.waitForTimeout(700);
  const oppen = await mobil.page.locator('#card-dialog[open]').count();
  await mobil.page.mouse.up();
  check(`${size}: långtryck öppnar kortet förstorat`, oppen === 1);
  if (oppen) await mobil.page.keyboard.press('Escape');
  await mobil.page.waitForTimeout(450);

  /* Spela tills matchen är slut. Lämnaren väljs i 6- och 8-spelarmatchen. */
  const lamnare = size >= 6 ? gaster[size - 1] : null;
  let vilande = 0, mobilKoll = null, resultatBild = false, datorBild = false;
  for (let varv = 0; varv < 4000; varv++) {
    let gjort = false;
    for (const g of gaster) {
      if (g.borta || g.klar) continue;
      if (g === lamnare && !g.lamnat && motor().battleNumber >= 2 && motor().phase !== 'AVSLUTAD') {
        await klick(g.page, '#leave-match');
        await klick(g.page, '#confirm-leave');
        await g.page.locator('#action-info:has-text("Du är utslagen")').waitFor({ timeout: 5000 }).catch(() => {});
        g.lamnat = true;
        check(`${size}: den som lämnar ser "Du är utslagen – laget spelar vidare"`, /Du är utslagen – laget spelar vidare/.test(await g.page.locator('#action-info').textContent()));
        await g.page.screenshot({ path: join(OUT, `${size}-lamnat-${g.namn}.png`) });
        if (size === 8) {
          await klick(g.page, '#to-lobby-bar');
          await g.page.waitForURL(/lobby\.html/, { timeout: 8000 });
          check(`${size}: den som lämnat kan gå till lobbyn medan matchen pågår`, app.lagring.hamtaSession(g.session.playerId).matchId === null);
          g.borta = true;
        }
        gjort = true;
        continue;
      }
      if (await steg(g, stats)) gjort = true;
      if (g.mobil && !mobilKoll && (await g.page.locator('#confirm-attack, #confirm-defend').count()) && (await g.page.locator('#hand button.mini-card').count()) && !(await g.page.locator('dialog[open]').count())) {
        mobilKoll = await mobilAvstand(g.page);
        if (mobilKoll) await g.page.screenshot({ path: join(OUT, `${size}-mobil-val-${g.namn}.png`) });
      }
      if (!g.mobil && !datorBild && (await g.page.locator('#confirm-defend, #confirm-attack').count()) && !(await g.page.locator('dialog[open]').count())) { datorBild = true; await g.page.screenshot({ path: join(OUT, `${size}-dator-val-${g.namn}.png`) }); }
      if (!resultatBild && (await g.page.locator('#result-dialog[open]').count())) { resultatBild = true; await g.page.screenshot({ path: join(OUT, `${size}-resultat-${g.namn}${g.mobil ? '-mobil' : ''}.png`) }); }
    }
    const kvar = gaster.filter(g => !g.borta);
    if (app.lagring.hamtaMatch(matchId).status === MATCH_STATUS.finished && kvar.every(g => g.klar)) break;
    vilande = gjort ? 0 : vilande + 1;
    if (!gjort) await new Promise(r => setTimeout(r, 60));
    if (vilande > 120) {
      for (const g of kvar) console.log('LÄGE', g.namn, JSON.stringify(await lage(g.page)), await g.page.locator('#action-info').textContent());
      console.log('MOTOR', motor().phase, motor().activePlayer);
      break;
    }
  }
  const e = motor();
  check(`${size}: hela matchen spelades via gränssnittet`, e.phase === 'AVSLUTAD', `${e.battleNumber} strider, ${JSON.stringify(stats)}`);
  if (lamnare) {
    const chip = await gaster[0].page.locator('#enemy-towers .tower-chip, #own-towers .tower-chip').filter({ hasText: lamnare.namn }).textContent().catch(() => '');
    check(`${size}: de andra ser att ${lamnare.namn} lämnade (ojämna lag spelade vidare)`, /Lämnade matchen/.test(chip), chip.trim());
  }
  if (size === 6) {
    const text = await lamnare.page.locator('#result').textContent();
    const egetLag = e.players.find(p => p.id === lamnare.session.playerId).teamId;
    const vantat = egetLag === e.winnerTeam ? /Ditt lag vinner matchen!.*Du var utslagen, men laget tog hem segern/s : /vinner matchen/;
    check(`${size}: den som lämnat ser lagets slutresultat skilt från sin egen utslagning`, vantat.test(text), text.replace(/\s+/g, ' ').slice(0, 160));
  }
  const vinnarText = await gaster.find(g => !g.borta && e.players.find(p => p.id === g.session.playerId).teamId === e.winnerTeam)?.page.locator('#result .winner').textContent();
  const forlorarText = await gaster.find(g => !g.borta && e.players.find(p => p.id === g.session.playerId).teamId !== e.winnerTeam)?.page.locator('#result .winner').textContent();
  check(`${size}: resultatet är personligt per lag`, /Ditt lag vinner/.test(vinnarText ?? '') && /vinner matchen/.test(forlorarText ?? '') && !/Ditt lag/.test(forlorarText ?? ''), `${vinnarText?.trim()} / ${forlorarText?.trim()}`);
  if (mobilKoll) check(`${size}: på mobilen ligger bekräftelse och kort intill varandra`, mobilKoll.mellan >= 0 && mobilKoll.mellan < 60 && mobilKoll.spann <= mobilKoll.vh && mobilKoll.korthojd >= 120, JSON.stringify(mobilKoll));
  else check(`${size}: mobilavståndet kunde mätas`, false);
  check(`${size}: inga andras handkort i nätverkssvaren`, svar.length === 0, svar.slice(0, 2).join(' | '));
  check(`${size}: inga sid- eller konsolfel`, fel.length === 0, fel.slice(0, 3).join(' | '));
  await gaster[0].page.screenshot({ path: join(OUT, `${size}-slut.png`) });
  for (const g of gaster) await g.context.close();
  return stats;
}

try {
  await riktatKortmal();
  const total = { kortmal: 0, spelarmal: 0, enkel: 0 };
  for (const size of SIZES.length ? SIZES : [4, 6, 8]) {
    const s = await spelaLagmatch(size);
    for (const k of Object.keys(total)) total[k] += s[k];
  }
  check('kortmål, spelarmål och enkel attack valdes via gränssnittet', total.kortmal > 0 && total.spelarmal > 0 && total.enkel > 0, JSON.stringify(total));
} catch (error) {
  console.error('AVBRUTET:', error);
  results.push({ name: 'körning', ok: false });
} finally {
  await browser.close();
  await app.stang();
}
console.log(`\n${results.filter(r => r.ok).length}/${results.length} kontroller OK`);
if (results.some(r => !r.ok)) process.exitCode = 1;
