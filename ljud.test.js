import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from './ljud.js';

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
