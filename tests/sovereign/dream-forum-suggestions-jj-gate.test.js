'use strict';

/**
 * The nightly forum-suggestions tenant (scripts/dream-forum-suggestions.mjs)
 * must not DM a forum member as JunkieJarvis while JunkieJarvis is switched off
 * (owner decision 2026-10-02, Q10; ADR-2088 Disposition).
 *
 * The clarify-before-acting gate (ADR-2088) decides WHETHER an unclear post is
 * acted on; the JunkieJarvis gate ([sovereign_mesh].junkiejarvis, env override
 * JUNKIEJARVIS_ENABLED, ADR-030) decides whether JunkieJarvis may speak to a
 * member at all. Before the fix the tenant honoured only the first, so it sent
 * clarifying DMs with `junkiejarvis = false`.
 *
 * This runs the REAL script as a child process against a throwaway
 * AGENTBOX_DIR whose relay, signer, zone-key and manifest modules are stubs.
 * The real clarify module is used, so the clarity check is the shipped one.
 * The stub relay serves one thread with one vague post; the stub signer records
 * every gift-wrapped DM to a file. No network, no key material, no LLM: the
 * vague post never reaches triage, and ZAI_URL points at a closed port.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../..');
const SCRIPT = path.join(REPO, 'scripts/dream-forum-suggestions.mjs');
const REAL_CLARIFY = path.join(REPO, 'management-api/lib/junkiejarvis-clarify.js');

const JJ = '2de44d5622eef79519ac078f6e227a85aecbaefd561e4e50c5f51dfadbf916e9';
const ROOT_ID = 'a'.repeat(64);
const VAGUE_ID = 'e'.repeat(64);
const AUTHOR = 'b'.repeat(64);

function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function makeFixture(manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jj-gate-'));
  const agentbox = path.join(dir, 'agentbox');
  const workspace = path.join(dir, 'workspace');
  const dmLog = path.join(dir, 'dms.jsonl');
  const publishLog = path.join(dir, 'publishes.jsonl');
  const now = Math.floor(Date.now() / 1000);
  const events = [
    { id: ROOT_ID, pubkey: 'f'.repeat(64), kind: 42, content: 'Feature suggestions', tags: [], created_at: now - 100 },
    { id: VAGUE_ID, pubkey: AUTHOR, kind: 42, content: "it's broken, please fix", tags: [['e', ROOT_ID, '', 'root']], created_at: now - 50 },
  ];

  write(path.join(agentbox, 'mcp/servers/nostr-bridge.js'), `
const fs = require('node:fs');
const EVENTS = ${JSON.stringify(events)};
const match = (f, e) => (!f.kinds || f.kinds.includes(e.kind))
  && (!f.ids || f.ids.includes(e.id))
  && (!f['#e'] || e.tags.some((t) => t[0] === 'e' && f['#e'].includes(t[1])));
class NostrBridge {
  async connect() {}
  async disconnect() {}
  setAuthSigner() {}
  subscribe(filter, cb) { setImmediate(() => EVENTS.filter((e) => match(filter, e)).forEach(cb)); return 'sub'; }
  unsubscribe() {}
  async publish(ev) { fs.appendFileSync(${JSON.stringify(publishLog)}, JSON.stringify(ev) + '\\n'); }
}
module.exports = { NostrBridge };
`);
  write(path.join(agentbox, 'management-api/lib/junkiejarvis-agent.js'), `
const fs = require('node:fs');
module.exports = {
  signerFromHex: () => ({ pubkey: ${JSON.stringify(JJ)}, skBytes: new Uint8Array(32) }),
  sendGiftWrappedDm: async ({ recipientPubkey, text }) => {
    fs.appendFileSync(${JSON.stringify(dmLog)}, JSON.stringify({ recipientPubkey, text }) + '\\n');
    return { id: 'd'.repeat(64) };
  },
  unwrapDmRumor: () => null,
};
`);
  write(path.join(agentbox, 'management-api/lib/junkiejarvis-clarify.js'),
    `module.exports = require(${JSON.stringify(REAL_CLARIFY)});\n`);
  write(path.join(agentbox, 'management-api/lib/zone-keys.js'), `
class ZoneKeyStore { keys() { return []; } get() { return null; } }
module.exports = {
  gateEnabled: () => false,
  loadZones: () => ({}),
  ZoneKeyStore,
  makeAdminCheck: () => async () => false,
  relayHttpBase: () => 'http://127.0.0.1:1',
  anyZoneEncrypted: () => false,
  readOutcome: () => ({ type: 'plain' }),
  applyWritePlan: (ev) => ev,
};
`);
  write(path.join(agentbox, 'management-api/adapters/manifest-loader.js'),
    `module.exports = { loadManifest: () => (${JSON.stringify(manifest)}) };\n`);
  // Pre-resolved thread root, so the run skips the 1000-event root search.
  write(path.join(workspace, '.agentbox/dream-forum-suggestions.json'),
    JSON.stringify({ rootId: ROOT_ID, repliedEventIds: [], lastRunAt: null, clarify: { pending: {} } }));

  return { dir, agentbox, workspace, dmLog, publishLog };
}

function run(fx, extraEnv = {}) {
  const env = { ...process.env };
  delete env.JUNKIEJARVIS_ENABLED;
  delete env.JUNKIEJARVIS_CLARIFY_BEFORE_ACTING;
  Object.assign(env, {
    AGENTBOX_DIR: fx.agentbox,
    WORKSPACE: fx.workspace,
    ZAI_API_KEY: 'test-not-a-key',
    ZAI_URL: 'http://127.0.0.1:1',
    JUNKIEJARVIS_PRIVKEY_HEX: '01'.repeat(32),
  }, extraEnv);
  const res = spawnSync(process.execPath, [SCRIPT, '--once'], { env, encoding: 'utf8', timeout: 60000 });
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : []);
  const ledgerFile = path.join(fx.agentbox, 'docs/dream-cycle/FORUM-SUGGESTIONS.md');
  return {
    stdout: res.stdout,
    dms: read(fx.dmLog),
    publishes: read(fx.publishLog),
    ledger: fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile, 'utf8') : '',
    state: JSON.parse(fs.readFileSync(path.join(fx.workspace, '.agentbox/dream-forum-suggestions.json'), 'utf8')),
  };
}

const fixtures = [];
afterAll(() => { for (const d of fixtures) fs.rmSync(d, { recursive: true, force: true }); });
const fixture = (manifest) => { const fx = makeFixture(manifest); fixtures.push(fx.dir); return fx; };

describe('dream-forum-suggestions honours the JunkieJarvis gate for clarifying DMs', () => {
  test('junkiejarvis = false: an unclear post is held, no DM, no ledger row, not parked', () => {
    const fx = fixture({ sovereign_mesh: { junkiejarvis: false, junkiejarvis_clarify_before_acting: true } });
    const out = run(fx);
    expect(out.dms).toEqual([]);
    expect(out.publishes).toEqual([]);
    expect(out.ledger).not.toMatch(/awaiting-clarification \|/);
    // Not parked and not marked replied, so it is asked once JunkieJarvis is on.
    expect(out.state.clarify.pending[VAGUE_ID]).toBeUndefined();
    expect(out.state.repliedEventIds).not.toContain(VAGUE_ID);
    expect(out.stdout).toMatch(/JunkieJarvis is off/);
  }, 60000);

  test('junkiejarvis absent from the manifest counts as off (fail closed)', () => {
    const fx = fixture({});
    const out = run(fx);
    expect(out.dms).toEqual([]);
  }, 60000);

  test('junkiejarvis = true: the unclear post is DMed once and parked', () => {
    const fx = fixture({ sovereign_mesh: { junkiejarvis: true, junkiejarvis_clarify_before_acting: true } });
    const out = run(fx);
    expect(out.dms).toHaveLength(1);
    expect(JSON.parse(out.dms[0]).recipientPubkey).toBe(AUTHOR);
    expect(out.state.clarify.pending[VAGUE_ID].status).toBe('awaiting-clarification');
    expect(out.ledger).toMatch(/awaiting-clarification \|/);
  }, 60000);

  test('the manifest is the only switch: JUNKIEJARVIS_ENABLED in the env is ignored', () => {
    const offEnvOn = run(fixture({ sovereign_mesh: { junkiejarvis: false } }), { JUNKIEJARVIS_ENABLED: 'true' });
    expect(offEnvOn.dms).toEqual([]);
    expect(offEnvOn.state.clarify.pending[VAGUE_ID]).toBeUndefined();
    const absentEnvOn = run(fixture({}), { JUNKIEJARVIS_ENABLED: 'true' });
    expect(absentEnvOn.dms).toEqual([]);
    const onEnvOff = run(fixture({ sovereign_mesh: { junkiejarvis: true } }), { JUNKIEJARVIS_ENABLED: 'false' });
    expect(onEnvOff.dms).toHaveLength(1);
  }, 60000);
});
