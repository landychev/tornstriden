import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skapaLokalMatch, privatVy, EVENT } from './lokalmatch.js';
import { newMatch, PHASE, ACTION } from './match.js';
import { STRATEGIES } from './dator.js';
import { PROTOCOL_VERSION, RECEIPT, ADAPTER_MODE, assertAdapter, validatePrivateView, assertNoSecrets } from './kontrakt.js';
import { styrdSlump, styrdKlocka } from './teststod.js';

let n = 0;
const cmd = (view, type, payload = {}) => ({ protocolVersion: PROTOCOL_VERSION, commandId: `c${++n}`, type, matchId: view.matchId, revision: view.revision, payload });

test('privatVy uppfyller kontraktet och saknar hemligheter för båda spelarna', () => {
  const match = newMatch({ matchId: 'm1', random: styrdSlump(1) });
  for (const id of ['A', 'B']) {
    const v = validatePrivateView(privatVy(match, id));
    assert.equal(v.viewer, id);
    assert.equal(v.teamId, id);
    assert.equal(v.me.hand.length, 10);
    assert.deepEqual(v.players.map(p => [p.id, p.teamId, p.cardCount, p.status]), [['A', 'A', 10, 'LEVANDE'], ['B', 'B', 10, 'LEVANDE']]);
    assert.equal(v.allowed.some(a => a.type === ACTION.swap), v.activePlayer === id, 'bara den som står på tur får byta');
    assert.ok(!('instances' in v) && !('drawPile' in v));
  }
  assert.throws(() => assertNoSecrets(privatVy(match, 'A'), 'B'), /hand/);
});

test('Adaptern uppfyller gränssnittet; kommandon får identitet från adaptern och ger kvittens + händelser', async () => {
  const adapter = assertAdapter(skapaLokalMatch({ matchId: 'm1', random: styrdSlump(2), klocka: styrdKlocka(5000) }));
  assert.equal(adapter.mode, ADAPTER_MODE.local);
  assert.equal(adapter.viewer(), 'A');
  const seen = [];
  adapter.subscribe((view, events) => seen.push({ revision: view.revision, events: events.map(e => e.type) }));
  const v0 = adapter.view();
  const fel = await adapter.send(cmd(v0, ACTION.attack, { instanceId: 'm1:kort:1' }));
  assert.equal(fel.status, RECEIPT.rejected, 'anfall under kortbytet avvisas');
  assert.equal(seen.length, 0, 'avvisning ger ingen ny vy');
  const keep = await adapter.send(cmd(v0, ACTION.swap, { cards: [] }));
  assert.equal(keep.status, RECEIPT.ok);
  assert.equal(keep.revision, 1);
  assert.match(keep.fingerprint, /^[0-9a-f]{8}$/);
  assert.deepEqual(seen[0].events.slice(0, 1), [EVENT.swap]);
  assert.ok(seen[0].events.includes(EVENT.log));
  assert.equal((await adapter.status(keep.commandId)).status, RECEIPT.ok);
  assert.equal((await adapter.status('okänd')).status, RECEIPT.unknown);
  const stale = await adapter.send(cmd(v0, ACTION.swap, { cards: [] }));
  assert.equal(stale.status, RECEIPT.rejected, 'gammal revision avvisas');
  validatePrivateView(adapter.view());
});

test('En hel datormatch går att spela genom adaptern med bara den privata vyn; alla händelser är hemlighetsfria', async () => {
  const adapter = skapaLokalMatch({ matchId: 'm2', random: styrdSlump(7), klocka: styrdKlocka(0) });
  const alla = [];
  adapter.subscribe((view, events) => { validatePrivateView(view); for (const e of events) { assertNoSecrets(e); alla.push(e); } });
  let steps = 0;
  while (adapter.view().phase !== PHASE.over && steps++ < 400) {
    const v = adapter.view();
    if (v.activePlayer === 'B') {
      const { choice } = adapter.local.computerDecision({ strategy: STRATEGIES.smart });
      const receipt = adapter.local.computerSend(choice);
      assert.equal(receipt.status, RECEIPT.ok, receipt.message);
      continue;
    }
    const allowed = v.allowed.map(a => a.type);
    let receipt;
    if (allowed.includes(ACTION.swap)) receipt = await adapter.send(cmd(v, ACTION.swap, { cards: v.me.hand.slice(0, 1).map(c => c.instanceId) }));
    else if (allowed.includes(ACTION.attack)) { const a = v.allowed.find(x => x.type === ACTION.attack); receipt = a.normal.length ? await adapter.send(cmd(v, ACTION.attack, { instanceId: a.normal[0].instanceId })) : await adapter.send(cmd(v, ACTION.attack, { instanceId: a.simple[0].instanceId, usage: 'simple' })); }
    else if (allowed.includes(ACTION.defend)) { const d = v.allowed.find(x => x.type === ACTION.defend); receipt = d.cards.length ? await adapter.send(cmd(v, ACTION.defend, { instanceId: d.cards[0].instanceId })) : await adapter.send(cmd(v, ACTION.pass)); }
    else if (allowed.includes(ACTION.next)) receipt = await adapter.send(cmd(v, ACTION.next));
    else throw new Error(`Inget tillåtet val i fas ${v.phase}`);
    assert.equal(receipt.status, RECEIPT.ok, receipt.message);
  }
  const slut = adapter.view();
  assert.equal(slut.phase, PHASE.over);
  assert.ok(['A', 'B'].includes(slut.winner));
  const typer = new Set(alla.map(e => e.type));
  for (const t of [EVENT.swap, EVENT.firstAttacker, EVENT.cardPlayed, EVENT.result, EVENT.next, EVENT.matchOver, EVENT.log]) assert.ok(typer.has(t), `händelsen ${t} förekom`);
  assert.deepEqual(alla.map(e => e.eventId), alla.map((_, i) => i + 1), 'löpnummer utan luckor');
  assert.ok(alla.filter(e => e.type === EVENT.cardPlayed).every(e => e.data.cardId && e.data.role && e.data.cardType));
});

test('Lokala extrametoder: spelarbyte vid samma skärm, ny match och inblick finns bara under local', () => {
  const adapter = skapaLokalMatch({ matchId: 'm3', random: styrdSlump(3) });
  adapter.local.setViewer('B');
  assert.equal(adapter.view().viewer, 'B');
  assert.equal(adapter.view().me.id, 'B');
  assert.equal(adapter.local.revealHand('A').length, 10);
  adapter.local.setViewer('A');
  adapter.local.newMatch({ matchId: 'm4' });
  assert.equal(adapter.view().matchId, 'm4');
  assert.equal(adapter.view().revision, 0);
  const publik = { mode: adapter.mode, viewer: adapter.viewer, view: adapter.view, send: adapter.send, status: adapter.status, subscribe: adapter.subscribe };
  assertAdapter(publik);
  assert.ok(!('local' in publik), 'onlineadaptern (L09) får samma form utan local');
});
