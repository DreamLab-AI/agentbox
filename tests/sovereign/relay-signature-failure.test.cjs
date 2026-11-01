'use strict';
// Run: node --test tests/sovereign/relay-signature-failure.test.cjs
// Exercise the actual consumer with a controlled crypto dependency loader.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const tools = require('nostr-tools');
const file = path.resolve(__dirname, '../../mcp/nostr-bridge/relay-consumer.js');
function loadConsumer(loadTools) {
  const mod = new Module(file, module);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  const nativeRequire = mod.require.bind(mod);
  mod.require = (name) => name === 'nostr-tools' ? loadTools() : nativeRequire(name);
  mod._compile(fs.readFileSync(file, 'utf8'), file);
  return mod.exports.RelayConsumer;
}
function signedDecision() {
  const secret = new Uint8Array(32); secret[31] = 7;
  return JSON.parse(JSON.stringify(tools.finalizeEvent({
    kind: 31403, created_at: 1790000000, tags: [['e', 'a'.repeat(64)]],
    content: JSON.stringify({ decision: 'approve' }),
  }, secret)));
}
function fixture(t, loadTools, verifyEvent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-signature-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const warnings = [], dispatched = [], notified = [];
  const RelayConsumer = loadConsumer(loadTools);
  const event = signedDecision();
  const consumer = new RelayConsumer({
    npubs: ['npub1local'], podRoot: dir, relayUrls: ['ws://127.0.0.1:1'],
    verifyEvent, logger: { info() {}, debug() {}, error() {}, warn(...a) { warnings.push(a); } },
    adapters: { orchestrator: { async handleGovernanceDecision(e) { dispatched.push(e); } } },
    forumGovernance: { relayUrl: 'wss://forum.example.invalid', signers: [event.pubkey], stateFile: path.join(dir, 'cursor.json') },
  });
  consumer._governanceSink = { notify(e) { notified.push(e); } };
  return { consumer, event, dir, warnings, dispatched, notified };
}
for (const [name, loadTools, verifier] of [
  ['missing dependency', () => { throw new Error('MODULE_NOT_FOUND'); }],
  ['verifier throws', () => ({ verifyEvent() { throw new Error('verification fault'); } })],
  ['injected verifier throws', () => tools, () => { throw new Error('injected fault'); }],
  ['non-boolean verification result', () => ({ verifyEvent() { return 'true'; } })],
]) {
  test(`${name}: reject before notification, persistence or orchestration`, async (t) => {
    const f = fixture(t, loadTools, verifier);
    assert.doesNotThrow(() => f.consumer._onForumGovernance(f.event, 'fixture'));
    await new Promise(setImmediate);
    assert.equal(f.consumer.metrics().forum_governance_rejected_sig, 1);
    assert.equal(f.consumer.metrics().forum_governance_accepted, 0);
    assert.equal(f.consumer._forum.seen.size, 0);
    assert.deepEqual(f.dispatched, []); assert.deepEqual(f.notified, []);
    assert.deepEqual(fs.readdirSync(f.dir), []);
    assert.equal(f.consumer._verifySig(f.event), false);
    if (name !== 'non-boolean verification result') {
      assert.equal(f.warnings.filter(a => a.includes('nostr-event-verification-failed')).length, 1);
    }
  });
}
test('real valid signature passes; a changed payload and malformed event fail', async (t) => {
  const f = fixture(t, () => tools);
  assert.equal(f.consumer._verifySig(JSON.parse(JSON.stringify(f.event))), true);
  assert.equal(f.consumer._verifySig({ ...f.event, content: 'different' }), false);
  assert.equal(f.consumer._verifySig({ id: 'id', sig: 'sig' }), false);
  f.consumer._onForumGovernance(JSON.parse(JSON.stringify(f.event)), 'fixture');
  await new Promise(setImmediate);
  assert.equal(f.consumer.metrics().forum_governance_accepted, 1);
  assert.equal(f.dispatched.length, 1); assert.equal(f.notified.length, 1);
  assert.equal(f.consumer._forum.seen.size, 1);
});
