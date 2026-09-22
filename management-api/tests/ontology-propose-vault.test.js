'use strict';
// ADR-2116 / ADR-2109 — the KG-elevation proposal path invokes `vault propose`,
// not the retired POST /api/ontology-agent/propose.
//
// Run: node --test management-api/tests/ontology-propose-vault.test.js
//
// Same stub-vault pattern as ontology-apply.test.js: a `vault` on PATH that
// records its argv and prints the JSON the real binary contracts to print. The
// assertion is the argv, because that IS the contract (C2) — and the argv is
// what has to still be right when WS-C's binary replaces the stub.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const op = require('../lib/ontology-propose');
const { slugify } = require('../lib/ontology-apply');

const ENV = {
  AGENTBOX_DID: 'did:nostr:' + 'a'.repeat(64),
  AGENTBOX_AGENT_TYPE: 'agentbox-bridge',
};

const CANDIDATE = {
  action: 'create',
  preferred_term: 'Photovoltaic Cell',
  definition: 'A device converting light into electricity.',
  owl_class: 'PhotovoltaicCell',
  physicality: 'physical',
  role: 'component',
  domain: 'energy',
};

/** A stub `vault` on PATH. `patch` is what `vault propose` prints. */
function stubVault(t, { patch = { level: 'content', blockers: [] }, exitCode = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-propose-stub-'));
  const log = path.join(dir, 'argv.log');
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, 'ontology'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'ontology', 'vocabulary.yaml'), 'version: 1\n');
  fs.writeFileSync(path.join(dir, 'vault'), `#!/bin/sh
{ for a in "$@"; do printf '%s\\n' "$a"; done; printf -- '--\\n'; } >> ${JSON.stringify(log)}
printf '%s' ${JSON.stringify(JSON.stringify(patch))}
exit ${exitCode}
`, { mode: 0o755 });

  const prevPath = process.env.PATH;
  const prevBin = process.env.VAULT_BIN;
  const prevRepo = process.env.VAULT_REPO;
  process.env.PATH = `${dir}:${prevPath}`;
  process.env.VAULT_REPO = repo;
  delete process.env.VAULT_BIN;
  t.after(() => {
    process.env.PATH = prevPath;
    if (prevBin === undefined) delete process.env.VAULT_BIN; else process.env.VAULT_BIN = prevBin;
    if (prevRepo === undefined) delete process.env.VAULT_REPO; else process.env.VAULT_REPO = prevRepo;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Every recorded invocation must lead with `--repo <repo>`; the subcommand
  // argv after it is what the descriptor built.
  return {
    repo,
    calls: () => (fs.existsSync(log)
      ? fs.readFileSync(log, 'utf8').split('--\n').filter(Boolean).map(b => b.split('\n').filter(Boolean))
      : []).map((argv) => {
      assert.deepEqual(argv.slice(0, 2), ['--repo', repo], 'vault propose is pinned with --repo');
      return argv.slice(2);
    }),
  };
}

// ── The retired route is gone from the module ───────────────────────────────

test('nothing in the module builds a request against the retired HTTP route', () => {
  assert.equal(typeof op.buildProposeRequest, 'undefined',
    'buildProposeRequest is deleted, not deprecated — a caller must break loudly');
  assert.equal(typeof op.PROPOSE_PATH, 'undefined');
  // Kept only as a recognisable name for the 410 a stale caller will now get.
  assert.equal(op.RETIRED_PROPOSE_PATH, '/api/ontology-agent/propose');

  const source = fs.readFileSync(require.resolve('../lib/ontology-propose'), 'utf8');
  assert.ok(!/path:\s*PROPOSE_PATH/.test(source), 'no descriptor targets the retired route');
});

// ── The argv, which is the contract ─────────────────────────────────────────

test('a create candidate builds the C2 vault propose argv, dry-run by default', () => {
  const cmd = op.buildVaultProposeCommand(CANDIDATE, ENV);
  assert.equal(cmd.bin, 'vault');
  assert.equal(cmd.iri, 'urn:ngm:class:photovoltaic-cell');
  assert.equal(cmd.level, 'content');
  assert.equal(cmd.dryRun, true);
  assert.deepEqual(cmd.argv, [
    'propose', 'urn:ngm:class:photovoltaic-cell',
    '--level', 'content',
    '--hypothesis', cmd.hypothesis,
    '--dry-run', '--json',
  ]);
  assert.match(cmd.hypothesis, /Photovoltaic Cell/);
  assert.match(cmd.hypothesis, /energy domain/);
});

test('an elevation is a CONTENT proposal, never schema', () => {
  // The falsification target for the tier floor in forum ADR-2013: if every
  // elevation claimed `schema`, every one would be floored at tier High and
  // the floor would mean nothing for the changes that actually earn it.
  assert.equal(op.buildVaultProposeCommand(CANDIDATE, ENV).level, 'content');
  assert.equal(op.buildVaultProposeCommand({ ...CANDIDATE, level: 'schema' }, ENV).level, 'schema');
  assert.throws(() => op.buildVaultProposeCommand({ ...CANDIDATE, level: 'demotion' }, ENV),
    /unknown proposal level/);
});

test('post: true lets vault raise the 31402 itself', () => {
  const cmd = op.buildVaultProposeCommand({ ...CANDIDATE, post: true }, ENV);
  assert.equal(cmd.dryRun, false);
  assert.ok(!cmd.argv.includes('--dry-run'));
});

test('an amend names its target IRI rather than minting one', () => {
  const cmd = op.buildVaultProposeCommand(
    { action: 'amend', target_iri: 'urn:ngm:class:solar-panel', amendment: {} }, ENV);
  assert.equal(cmd.iri, 'urn:ngm:class:solar-panel');
  assert.equal(cmd.argv[1], 'urn:ngm:class:solar-panel');
});

// ── The IRI we propose must be the IRI the apply path can resolve ───────────

test('the proposed IRI uses the SAME slug rule the apply path resolves with', () => {
  for (const term of ['Photovoltaic Cell', 'RGB-D Camera', '  Spatial  Computing! ']) {
    const cmd = op.buildVaultProposeCommand({ ...CANDIDATE, preferred_term: term }, ENV);
    assert.equal(cmd.iri, op.IRI_NAMESPACE + slugify(term));
    // The invariant that matters: promotion resolves an IRI by re-slugifying
    // candidate page ids, so a proposal whose IRI cannot round-trip would
    // strand a human decision at apply time.
    assert.equal(require('../lib/ontology-apply').iriSlug(cmd.iri), slugify(term));
  }
});

test('a term that slugs to nothing is refused rather than proposed as a bare namespace', () => {
  assert.throws(() => op.buildVaultProposeCommand({ ...CANDIDATE, preferred_term: '!!!' }, ENV),
    /slugs to the empty string/);
});

// ── Running it ──────────────────────────────────────────────────────────────

test('runVaultPropose returns the PatchProposal and the argv it ran', async (t) => {
  const stub = stubVault(t, {
    patch: { level: 'content', iri: 'urn:ngm:class:photovoltaic-cell',
             page: 'Photovoltaic Cell', digest: 'sha256:abc', blockers: [] },
  });
  const out = await op.runVaultPropose(CANDIDATE, { env: ENV });

  assert.equal(out.blocked, false);
  assert.equal(out.error, null);
  assert.deepEqual(out.blockers, []);
  assert.equal(out.proposal.digest, 'sha256:abc');
  assert.deepEqual(stub.calls(), [out.command.argv]);
});

test('blockers mean the proposal is NOT postable (contract C4)', async (t) => {
  stubVault(t, { patch: { blockers: ['SUBCLASS_CYCLE: A -> B -> A'] } });
  const out = await op.runVaultPropose(CANDIDATE, { env: ENV });
  assert.equal(out.blocked, true);
  assert.deepEqual(out.blockers, ['SUBCLASS_CYCLE: A -> B -> A']);
  // The blockers are returned, not swallowed: a candidate refused for a reason
  // nobody can read is indistinguishable from one that was never scanned.
  assert.equal(out.proposal.blockers.length, 1);
});

test('a vault that fails is reported, not thrown — one bad candidate must not end the sweep', async (t) => {
  stubVault(t, { exitCode: 3 });
  const out = await op.runVaultPropose(CANDIDATE, { env: ENV });
  assert.equal(out.blocked, true);
  assert.equal(out.proposal, null);
  assert.ok(out.error, 'the failure is surfaced');
  assert.ok(out.command.argv.includes('--dry-run'), 'the attempted argv is still reported');
});

test('$VAULT_BIN overrides the binary', (t) => {
  const prev = process.env.VAULT_BIN;
  process.env.VAULT_BIN = '/opt/vault/bin/vault';
  t.after(() => { if (prev === undefined) delete process.env.VAULT_BIN; else process.env.VAULT_BIN = prev; });
  assert.equal(op.buildVaultProposeCommand(CANDIDATE, { ...ENV, ...process.env }).bin, '/opt/vault/bin/vault');
});

// ── The extractor hands the route a command, not an HTTP descriptor ─────────

test('the extractor descriptor carries propose_command and no propose_request', () => {
  const { normaliseEntry, scoreCandidate, buildProposalDescriptor } =
    require('../lib/kg-proposal-extractor');
  // The same RICH fixture tests/sovereign/kg-proposal-extractor.test.js scores.
  const entry = {
    key: 'concept/photovoltaic-cell',
    value: {
      preferred_term: 'Photovoltaic Cell',
      definition: 'A semiconductor device that converts light directly into electricity via the photovoltaic effect.',
      domain: 'renewables',
      physicality: 'physical',
      role: 'energy-conversion',
    },
  };
  const norm = normaliseEntry(entry);
  const d = buildProposalDescriptor(norm, scoreCandidate(norm), {
    ownerPubkey: 'b'.repeat(64),
    env: { ...process.env, ...ENV },
  });

  assert.equal(d.propose_request, undefined, 'the HTTP descriptor is gone, not renamed in place');
  assert.equal(d.propose_command.argv[0], 'propose');
  assert.equal(d.propose_command.iri, 'urn:ngm:class:photovoltaic-cell');
  assert.equal(d.emit.metadata.governed_iri, 'urn:ngm:class:photovoltaic-cell');
  assert.match(d.emit.metadata.governed_command, /^propose urn:ngm:class:photovoltaic-cell --level content/);
  assert.equal(d.emit.metadata.governed_path, undefined);
});

test('an unresolvable vault repo blocks the proposal without spawning vault', async (t) => {
  const stub = stubVault(t);
  const prevRoot = process.env.VAULT_ROOT;
  delete process.env.VAULT_REPO; // stubVault's t.after restores it
  process.env.VAULT_ROOT = path.join(os.tmpdir(), 'no-such-vault-repo', 'knowledge');
  t.after(() => { if (prevRoot === undefined) delete process.env.VAULT_ROOT; else process.env.VAULT_ROOT = prevRoot; });

  const out = await op.runVaultPropose(CANDIDATE);
  assert.equal(out.blocked, true);
  assert.equal(out.proposal, null);
  assert.match(out.error, /holds no ontology\/vocabulary\.yaml/);
  assert.deepEqual(stub.calls(), [], 'vault was never spawned');
});

test('the real vault output shape {proposal, event} is unwrapped, so its blockers still block', async (t) => {
  const event = { kind: 31402, id: 'e1', tags: [['d', 'abc'], ['level', 'content']] };
  stubVault(t, { patch: { proposal: { level: 'content', blockers: ['SUBCLASS_CYCLE'] }, event } });
  const out = await op.runVaultPropose(CANDIDATE);
  assert.equal(out.blocked, true, 'a nested blocker is not invisible');
  assert.deepEqual(out.blockers, ['SUBCLASS_CYCLE']);
  assert.equal(out.proposal.level, 'content');
  assert.deepEqual(out.event, event);
});
