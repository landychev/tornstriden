import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio, skapaHandelsevakt, handelseljud, resultatljud } from './ljud.js';
import { EVENT } from './lokalmatch.js';
import { USAGE } from './matchregler.js';
import { ELIMINATION, TEAM_OUTCOME } from './kontrakt.js';

function setup({ saved = null, fetchAsset } = {}) {
  const storage = { value: saved, getItem() { return this.value; }, setItem(key, value) { this.value = value; } };
  const sources = [];
  const context = {
    state: 'suspended', currentTime: 0, destination: {},
    async resume() { this.state = 'running'; }, async suspend() { this.state = 'suspended'; },
    createGain() { return { gain: { setTargetAtTime() {} }, connect() {} }; },
    async decodeAudioData() { return { duration: 72 }; },
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start(when, offset) { this.started = true; this.offset = offset; }, stop() { this.stopped = true; } };
      sources.push(source);
      return source;
    }
  };
  let created = 0;
  const sound = new GameAudio({ storage, createContext: () => { created++; return context; }, fetchAsset: fetchAsset ?? (async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })) });
  return { sound, context, sources, storage, created: () => created };
}

test('Ljud startar efter aktivering; upprepade renderingar skapar bara en musikslinga', async () => {
  const { sound, sources, created } = setup();
  sound.setPlaying(true);
  sound.playEffect('attack');
  assert.equal(created(), 0);
  await Promise.all([sound.unlock(), sound.unlock()]);
  for (let i = 0; i < 20; i++) sound.setPlaying(true);
  assert.equal(created(), 1);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].loop, true);
  sound.playEffect('attack'); sound.playEffect('defence');
  assert.equal(sources.length, 3);
  assert.equal(sources[1].buffer, sound.buffers.get('attack'));
  assert.equal(sources[2].buffer, sound.buffers.get('defence'));
  sound.playEffect('shuffle');
  assert.equal(sources.length, 4);
  assert.equal(sources[3].buffer, sound.buffers.get('shuffle'));
  sound.playEffect('card');
  assert.equal(sources.length, 5);
  assert.equal(sources[4].buffer, sound.buffers.get('card'));
});

test('Tyst läge stoppar pågående ljud och sparas; volymerna är oberoende', async () => {
  const { sound, sources, storage } = setup();
  await sound.unlock(); sound.playEffect('attack');
  sound.setVolume('music', .12); sound.setVolume('effects', .8);
  sound.setEnabled(false);
  assert.ok(sources.every(source => source.stopped));
  sound.playEffect('defence'); sound.playEffect('shuffle'); sound.playEffect('card'); sound.setPlaying(true);
  assert.equal(sources.length, 2);
  const saved = JSON.parse(storage.value);
  assert.deepEqual(saved, { enabled: false, musicVolume: .12, effectsVolume: .8 });
  const restored = setup({ saved: storage.value });
  await restored.sound.unlock();
  assert.equal(restored.created(), 0);
});

test('Snabba kortbyten ersätter förra blandningen utan att avbryta andra effekter', async () => {
  const { sound, sources } = setup();
  await sound.unlock();
  sound.playEffect('attack');
  sound.playEffect('shuffle');
  sound.playEffect('shuffle');
  assert.equal(sources[1].stopped, undefined);
  assert.equal(sources[2].stopped, true);
  assert.equal(sources[3].started, true);
  assert.equal(sound.effects.size, 2);
});

test('Byte av flik pausar ljud; musiken återupptas från rätt plats utan gamla effekter', async () => {
  const { sound, context, sources } = setup();
  await sound.unlock(); context.currentTime = 17; sound.playEffect('attack');
  await sound.setVisible(false);
  assert.equal(context.state, 'suspended');
  assert.ok(sources.every(source => source.stopped));
  sound.playEffect('defence');
  await sound.setVisible(true);
  assert.equal(sources.length, 3);
  assert.equal(sources[2].offset, 17);
  assert.equal(sound.effects.size, 0);
  sound.setPlaying(false);
  await sound.setVisible(false); await sound.setVisible(true);
  assert.equal(sources.length, 3);
  sound.setPlaying(true);
  assert.equal(sources.length, 4);
});

test('Sena ljudfiler startar inte efter avstängning och gamla effekter köas inte', async () => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const { sound, sources } = setup({ fetchAsset: async () => { await ready; return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) }; } });
  const loading = sound.unlock();
  sound.playEffect('attack'); sound.setEnabled(false);
  release(); await loading;
  assert.equal(sources.length, 0);
  sound.enabled = true; await sound.unlock();
  assert.equal(sources.length, 1);
  assert.equal(sources[0].loop, true);
});

test('Saknade ljud, trasiga inställningar och otillgänglig lagring stoppar inte spelet', async () => {
  const { sound } = setup({ saved: '{trasigt', fetchAsset: async () => ({ ok: false }) });
  await sound.unlock();
  assert.equal(sound.failed, true);
  assert.doesNotThrow(() => sound.playEffect('attack'));
  sound.storage = { setItem() { throw new Error('Lagring blockerad'); } };
  assert.doesNotThrow(() => sound.setVolume('music', .5));
  const unavailable = new GameAudio({ storage: {}, createContext() { throw new Error('Inget ljudstöd'); } });
  await unavailable.unlock();
  assert.equal(unavailable.failed, true);
});


/* ---- L19: ljud ur serverbekräftade händelser ---- */
let id = 0;
const h = (type, data = {}, matchId = 'm1') => ({ eventId: ++id, matchId, revision: 1, type, at: 1, data, recipient: null });

test('Duellens resultatljud ur händelser: träff, lyckat försvar, motstöt; matchslut går före stridsljudet', () => {
  const strid = (defended, life) => h(EVENT.result, { battleNumber: 1, attacker: 'A', defender: 'B', defended, startLife: { A: 3, B: 3 }, life });
  assert.deepEqual(['A', 'B'].map(jag => resultatljud([strid(false, { A: 3, B: 2 })], { jag })), ['battleWon', 'lifeLost']);
  assert.deepEqual(['A', 'B'].map(jag => resultatljud([strid(true, { A: 3, B: 3 })], { jag })), [null, 'battleWon']);
  assert.deepEqual(['A', 'B'].map(jag => resultatljud([strid(true, { A: 2, B: 3 })], { jag })), ['lifeLost', 'battleWon'], 'motstöt');
  const slut = [strid(false, { A: 3, B: 0 }), h(EVENT.matchOver, { winner: 'A', endReason: 'TORN_FALLET' })];
  assert.deepEqual(['A', 'B'].map(jag => resultatljud(slut, { jag })), ['matchWon', 'matchLost']);
  assert.equal(resultatljud([h(EVENT.matchOver, { winner: null, endReason: 'SERVERAVBROTT' })], { jag: 'A' }), null, 'ingen vinnare: inget slutljud');
  assert.equal(resultatljud([], { jag: 'A' }), null, 'inga nya händelser (historik): tyst');
});

test('Lagmatchens resultatljud: egen livsförlust, lagets vunna strid och lagets matchresultat skiljs åt; en lagkamrats avhopp ger inget förlustljud', () => {
  const strid = (outcome, lifeDelta) => h(EVENT.result, { battleNumber: 2, attackingTeam: 'A', target: 'b1', outcome, lifeDelta, life: {}, startLife: {}, eliminated: [] });
  const traff = [strid(TEAM_OUTCOME.hit, { b1: -2 })];
  assert.equal(resultatljud(traff, { jag: 'b1', lag: 'B' }), 'lifeLost', 'egen livsförlust');
  assert.equal(resultatljud(traff, { jag: 'b2', lag: 'B' }), null, 'lagkamratens livsförlust är inte min');
  assert.equal(resultatljud(traff, { jag: 'a2', lag: 'A' }), 'battleWon', 'lagets vunna strid, även för den som inte spelade');
  assert.equal(resultatljud([strid(TEAM_OUTCOME.held, { a1: -1 })], { jag: 'b2', lag: 'B' }), 'battleWon', 'försvaret höll');
  assert.equal(resultatljud([strid(TEAM_OUTCOME.aborted, {})], { jag: 'b2', lag: 'B' }), null, 'avbruten strid (måltavlan lämnade)');
  /* Lagkamraten lämnar: utslagen, laget spelar vidare – inget ljud alls. */
  const avhopp = [h(EVENT.surrender, { playerId: 'a2' }), h(EVENT.eliminated, { playerId: 'a2', reason: ELIMINATION.left })];
  assert.equal(resultatljud(avhopp, { jag: 'a1', lag: 'A' }), null);
  assert.deepEqual(handelseljud(avhopp), []);
  /* Lagets förlust hörs bara när servern meddelar matchslut. */
  const slut = [...avhopp, h(EVENT.matchOver, { winnerTeam: 'B', endReason: 'LAG_UTSLAGET' })];
  assert.deepEqual([resultatljud(slut, { jag: 'a1', lag: 'A' }), resultatljud(slut, { jag: 'b1', lag: 'B' })], ['matchLost', 'matchWon']);
  assert.equal(resultatljud([h(EVENT.matchOver, { winnerTeam: null, endReason: 'SERVERAVBROTT' })], { jag: 'a1', lag: 'A' }), null);
});

test('Direkta ljud: kortspel (anfall, magi, enkel attack, försvar), byte och påfyllning', () => {
  const kort = (role, cardType, usage = USAGE.normal) => h(EVENT.cardPlayed, { role, cardType, usage });
  assert.deepEqual(handelseljud([kort('attack', 'attack'), kort('attack', 'magic'), kort('attack', 'magic', USAGE.simple), kort('defence', 'defence')]), ['card', 'attack', 'card', 'magic', 'card', 'attack', 'card', 'defence']);
  assert.deepEqual(handelseljud([h(EVENT.swap, { count: 0 }), h(EVENT.swap, { count: 2 }), h(EVENT.refill, { count: 5 }), h(EVENT.log, { text: 'x' })]), ['shuffle', 'shuffle']);
});

test('Händelsevakten: varje händelse högst en gång, historiken är tyst och en ny match börjar om', () => {
  const vakt = skapaHandelsevakt();
  vakt.historik({ matchId: 'm1', lastEventId: 5 });
  const e = n => ({ eventId: n, matchId: 'm1', type: EVENT.log, data: {} });
  assert.deepEqual(vakt.nya([e(4), e(5)]).map(x => x.eventId), [], 'det som fanns vid sidladdningen');
  assert.deepEqual(vakt.nya([e(6), e(7)]).map(x => x.eventId), [6, 7]);
  assert.deepEqual(vakt.nya([e(7), e(6), e(8)]).map(x => x.eventId), [8], 'samma händelse två gånger (ström och hämtning) spelas en gång');
  vakt.historik({ matchId: 'm1', lastEventId: 20 });   // återanslutning: 9–20 hände medan sidan var borta
  assert.deepEqual(vakt.nya([e(12), e(21)]).map(x => x.eventId), [21]);
  assert.deepEqual(vakt.nya([{ eventId: 1, matchId: 'm2', type: EVENT.log, data: {} }]).map(x => x.eventId), [1], 'ny match (lokalt) börjar om på 1');
});

test('Slutljud fungerar efter att musiken stannat och följer av/på, volym och flikbyte', async () => {
  const { sound, sources } = setup();
  await sound.unlock();
  sound.setPlaying(false);
  assert.equal(sources[0].stopped, true);
  sound.playEffect('matchWon');
  sound.playEffect('matchLost');
  assert.equal(sources[1].buffer, sound.buffers.get('matchWon'));
  assert.equal(sources[2].buffer, sound.buffers.get('matchLost'));
  sound.playEffect('battleWon');
  sound.playEffect('lifeLost');
  assert.equal(sources.length, 3);
  sound.setVolume('effects', 0);
  sound.playEffect('matchWon');
  assert.equal(sources.length, 3);
  sound.setVolume('effects', .65);
  await sound.setVisible(false);
  sound.playEffect('matchLost');
  assert.equal(sources.length, 3);
  assert.ok(sources.every(source => source.stopped));
  await sound.setVisible(true);
  assert.equal(sources.length, 3);
  sound.setEnabled(false);
  sound.playEffect('matchWon');
  assert.equal(sources.length, 3);
});
