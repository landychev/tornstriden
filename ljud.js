/* Ljud är presentation: inga ljudhändelser ändrar matchens regler eller turer. */
import { PHASE } from './match.js';

export const SOUND_FILES = Object.freeze({
  music: 'strid-musik.mp3', attack: 'anfall.mp3', magic: 'magi.mp3', defence: 'forsvar.mp3',
  shuffle: 'kortblandning.mp3', card: 'kortlaggning.mp3',
  lifeLost: 'forlorat-liv.mp3', battleWon: 'vunnen-strid.mp3',
  matchLost: 'forlorad-match.mp3', matchWon: 'vunnen-match.mp3'
});

export function resultEffect(match, playerId) {
  if (match.phase === PHASE.over && match.winner) return match.winner === playerId ? 'matchWon' : 'matchLost';
  const r = match.lastResult;
  if (match.phase !== PHASE.result || !r) return null;
  if (r.life[playerId] < r.startLife[playerId]) return 'lifeLost';
  const winner = r.defended ? r.defender : r.attacker;
  return winner === playerId ? 'battleWon' : null;
}
const STORAGE_KEY = 'tornstriden-ljud-v1';
const volume = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;

export class GameAudio {
  constructor({ storage, createContext, fetchAsset } = {}) {
    try { this.storage = storage ?? globalThis.localStorage; } catch { this.storage = null; }
    this.createContext = createContext ?? (() => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)());
    this.fetchAsset = fetchAsset ?? (url => fetch(url));
    let saved;
    try { saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? 'null'); } catch { /* Lagring är valfri. */ }
    this.enabled = typeof saved?.enabled === 'boolean' ? saved.enabled : true;
    this.musicVolume = volume(saved?.musicVolume, .3);
    this.effectsVolume = volume(saved?.effectsVolume, .65);
    this.playing = true;
    this.visible = true;
    this.context = null;
    this.buffers = new Map();
    this.effects = new Set();
    this.musicSource = null;
    this.musicOffset = 0;
    this.loading = null;
    this.failed = false;
    this.onChange = () => {};
  }

  save() {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify({ enabled: this.enabled, musicVolume: this.musicVolume, effectsVolume: this.effectsVolume })); } catch { /* Även privat surfning fungerar. */ }
    this.onChange();
  }

  async unlock() {
    if (!this.enabled || !this.visible) return;
    try {
      if (!this.context) {
        this.context = this.createContext();
        this.musicGain = this.context.createGain();
        this.effectsGain = this.context.createGain();
        this.musicGain.gain.value = this.musicVolume;
        this.effectsGain.gain.value = this.effectsVolume;
        this.musicGain.connect(this.context.destination);
        this.effectsGain.connect(this.context.destination);
      }
      // Anropas från ett klick/tangenttryck, även när resume behöver användaraktivering.
      await this.context.resume();
      if (!this.loading) {
        this.loading = Promise.all(Object.entries(SOUND_FILES).map(async ([name, file]) => {
          try {
            const response = await this.fetchAsset(new URL(`assets/ljud/${file}`, import.meta.url));
            if (!response.ok) throw new Error('Ljudfilen saknas');
            const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
            this.buffers.set(name, buffer);
          } catch { this.failed = true; }
        }));
      }
      await this.loading;
      this.sync();
    } catch { this.failed = true; }
    this.onChange();
  }

  get audible() { return this.enabled && this.visible && this.context?.state === 'running'; }

  stopMusic() {
    if (!this.musicSource) return;
    const duration = this.buffers.get('music').duration;
    this.musicOffset = (this.musicOffset + this.context.currentTime - this.musicStarted) % duration;
    this.musicSource.stop();
    this.musicSource.disconnect();
    this.musicSource = null;
  }

  stopEffects() {
    for (const source of this.effects) { source.stop(); source.disconnect(); }
    this.effects.clear();
  }

  sync() {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.musicGain.gain.setTargetAtTime(this.enabled ? this.musicVolume : 0, now, .08);
    this.effectsGain.gain.setTargetAtTime(this.enabled ? this.effectsVolume : 0, now, .02);
    if (!this.audible || !this.playing || !this.musicVolume) { this.stopMusic(); return; }
    if (this.musicSource || !this.buffers.has('music')) return;
    const source = this.context.createBufferSource();
    source.buffer = this.buffers.get('music');
    source.loop = true;
    source.connect(this.musicGain);
    source.start(0, this.musicOffset);
    this.musicStarted = now;
    this.musicSource = source;
  }

  playEffect(name) {
    // Ljud som ännu inte laddats köas inte: ett gammalt anfall får inte höras senare.
    const finale = name === 'matchWon' || name === 'matchLost';
    if (!this.audible || (!this.playing && !finale) || !this.effectsVolume || !this.buffers.has(name)) return;
    // Snabba byten ska inte stapla flera långa kortblandningar ovanpå varandra.
    if (name === 'shuffle') {
      for (const previous of this.effects) {
        if (previous.buffer !== this.buffers.get('shuffle')) continue;
        previous.stop();
        previous.disconnect();
        this.effects.delete(previous);
      }
    }
    const source = this.context.createBufferSource();
    source.buffer = this.buffers.get(name);
    source.connect(this.effectsGain);
    source.onended = () => { this.effects.delete(source); source.disconnect(); };
    this.effects.add(source);
    source.start();
  }

  setPlaying(playing) { this.playing = playing; this.sync(); }
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.stopEffects();
    this.sync();
    this.save();
    if (enabled) void this.unlock();
  }
  setVolume(kind, value) {
    if (kind === 'music') this.musicVolume = volume(value, this.musicVolume);
    else this.effectsVolume = volume(value, this.effectsVolume);
    this.sync();
    this.save();
  }
  async setVisible(visible) {
    this.visible = visible;
    if (!visible) {
      this.stopMusic();
      this.stopEffects();
      try { await this.context?.suspend(); } catch { /* Spelet fortsätter utan ljud. */ }
    } else if (this.context && this.enabled) {
      await this.unlock();
    }
  }
}

export function bindAudioControls(sound) {
  const $ = id => document.getElementById(id);
  sound.onChange = () => {
    $('sound-enabled').checked = sound.enabled;
    $('music-volume').value = String(Math.round(sound.musicVolume * 100));
    $('effects-volume').value = String(Math.round(sound.effectsVolume * 100));
    $('music-level').value = `${$('music-volume').value} %`;
    $('effects-level').value = `${$('effects-volume').value} %`;
    $('sound-settings').textContent = sound.enabled ? '♫ Ljud' : '♫ Av';
    $('sound-settings').setAttribute('aria-label', `Ljudinställningar – ljud ${sound.enabled ? 'på' : 'av'}`);
    $('sound-status').textContent = sound.failed ? 'En del ljud kunde inte laddas. Spelet går fortfarande att spela.' : 'Musiken pausas när du lämnar fliken. Dina ljudinställningar sparas.';
  };
  $('sound-settings').addEventListener('click', () => { void sound.unlock(); $('sound-dialog').showModal(); });
  $('sound-close').addEventListener('click', () => $('sound-dialog').close());
  $('sound-enabled').addEventListener('change', event => sound.setEnabled(event.target.checked));
  for (const kind of ['music', 'effects']) {
    $(`${kind}-volume`).addEventListener('input', event => sound.setVolume(kind, Number(event.target.value) / 100));
  }
  // pointerup ingår eftersom pointerdown från touch inte räknas som användaraktivering i Chrome.
  const unlock = () => { void sound.unlock(); };
  for (const type of ['pointerdown', 'pointerup', 'keydown']) document.addEventListener(type, unlock, { once: true });
  document.addEventListener('visibilitychange', () => { void sound.setVisible(!document.hidden); });
  window.addEventListener('pagehide', () => { void sound.setVisible(false); });
  window.addEventListener('pageshow', () => { void sound.setVisible(!document.hidden); });
  sound.visible = !document.hidden;
  sound.onChange();
}
