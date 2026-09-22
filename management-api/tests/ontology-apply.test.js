'use strict';
// ADR-2109 — a signed Promote/Demote applies through `vault edit`.
//
// Run: node --test management-api/tests/ontology-apply.test.js
//
// The `vault` binary is WS-C's and does not exist yet, so these tests put a
// STUB named `vault` on PATH which records its argv verbatim and prints the
// JSON the real binary contracts to print (C2). Everything asserted here is an
// assertion about the argv we hand that binary — which is precisely the
// contract that has to still hold when the real one replaces the stub.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const apply = require('../lib/ontology-apply');
const { LocalProcessManagerOrchestratorAdapter } = require('../adapters/orchestrator/local-process-manager');

const IRI = 'urn:ngm:class:knowledge-graph';
const PAGE = 'Knowledge Graph';
const NPUB = 'npub1testhuman';
const AT = '2026-09-22T12:00:00.000Z';

/** A minimal vault repository: just the marker `resolveVaultRepo` checks for. */
function fakeRepo(parent, { pageStatus = 'draft' } = {}) {
  const repo = path.join(parent, 'repo');
  fs.mkdirSync(path.join(repo, 'ontology'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'knowledge', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'ontology', 'vocabulary.yaml'), 'version: 1\n');
  // The page the stub `find` answers with, read (only) to plan the key set.
  fs.writeFileSync(path.join(repo, 'knowledge', 'pages', `${PAGE}.md`),
    `---\ntype: Class\nresource: ${IRI}\nstatus: ${pageStatus}\n---\nbody\n`);
  return repo;
}

/**
 * Install a stub `vault` on PATH. Returns the log reader and a restore fn.
 *
 * `findResult` is the JSON the stub prints for `vault find`; `editExit` is the
 * exit code for `vault edit`, so a refused guard is testable without a real
 * vault.
 */
function stubVault(t, { findResult = [{ id: PAGE, title: PAGE, type: 'Class', score: 1 }], editExit = 0, createExit = 0, pageStatus = 'draft' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-stub-'));
  const log = path.join(dir, 'argv.log');
  const repo = fakeRepo(dir, { pageStatus });
  const script = `#!/bin/sh
{ for a in "$@"; do printf '%s\\n' "$a"; done; printf -- '--\\n'; } >> ${JSON.stringify(log)}
[ "$1" = "--repo" ] && shift 2
case "$1" in
  find) printf '%s' ${JSON.stringify(JSON.stringify(findResult))} ;;
  edit) printf '%s' '{"ok":true,"docs":1,"blocks":1}'; exit ${editExit} ;;
  create) dest=${JSON.stringify(path.join(repo, 'knowledge', 'pages'))}/"$(basename "$2")"
          [ -e "$dest" ] && { printf '%s' '{"created":false,"code":"EXISTS","message":"refused: already exists","blockers":[]}'; exit 2; }
          [ ${createExit} -eq 0 ] && cp "$2" "$dest"; printf '%s' '{"created":true}'; exit ${createExit} ;;
  *) printf '%s' 'null' ;;
esac
`;
  const bin = path.join(dir, 'vault');
  fs.writeFileSync(bin, script, { mode: 0o755 });

  const prevPath = process.env.PATH;
  const prevBin = process.env.VAULT_BIN;
  const prevRepo = process.env.VAULT_REPO;
  process.env.PATH = `${dir}:${prevPath}`;
  process.env.VAULT_REPO = repo;
  delete process.env.VAULT_BIN; // prove the default `vault` resolves on PATH

  t.after(() => {
    process.env.PATH = prevPath;
    if (prevBin === undefined) delete process.env.VAULT_BIN; else process.env.VAULT_BIN = prevBin;
    if (prevRepo === undefined) delete process.env.VAULT_REPO; else process.env.VAULT_REPO = prevRepo;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  return {
    repo,
    /** Every raw invocation, `--repo <root>` included. */
    rawCalls() {
      if (!fs.existsSync(log)) return [];
      return fs.readFileSync(log, 'utf8').split('--\n').filter(Boolean)
        .map(block => block.split('\n').filter(l => l.length > 0));
    },
    /**
     * Every invocation's subcommand argv. Asserts each one was pinned to the
     * resolved repo first — `--repo` is part of the contract on every call.
     */
    calls() {
      return this.rawCalls().map((argv) => {
        assert.deepEqual(argv.slice(0, 2), ['--repo', repo], 'every vault call is pinned with --repo');
        return argv.slice(2);
      });
    },
  };
}

/** A `fetch` that records the attest call and answers with `status`. */
function stubFetch(status = 200) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), method: opts.method });
    return { ok: status >= 200 && status < 300, status };
  };
  fn.calls = calls;
  return fn;
}

// ── The argv, which is the whole contract ───────────────────────────────────

test('promote runs vault edit with status=stable, an appended human attestation and a blast-radius guard', async (t) => {
  const stub = stubVault(t);
  const fetchFn = stubFetch(200);

  const result = await apply.applyOntologyDecision(
    { outcome: 'promote', iri: IRI, signerNpub: NPUB, at: AT, caseId: 'case-a', digest: 'sha256:abc' },
    { fetchFn },
  );

  assert.equal(result.applied, true);
  assert.equal(result.page, PAGE);
  assert.equal(result.attested, true);

  const [find, edit] = stub.calls();
  assert.deepEqual(find, ['find', '--query', 'knowledge graph', '--limit', '25', '--json']);
  assert.deepEqual(edit, [
    'edit', PAGE,
    '--set', 'status=stable',
    '--set', `verified+=${JSON.stringify({ by: `human:${NPUB}`, at: AT })}`,
    // Two keys change — status and verified — and the real `vault edit`
    // counts a block per changed key, so blocks=1 here is refused by it.
    '--expect', 'docs=1,blocks=2',
    '--json',
  ]);
});

test('demote sets status=deprecated and appends no attestation', async (t) => {
  const stub = stubVault(t);
  const result = await apply.applyOntologyDecision(
    { outcome: 'demote', iri: IRI, signerNpub: NPUB, at: AT, caseId: 'case-a', digest: 'sha256:abc' },
    { fetchFn: stubFetch(200) },
  );
  assert.equal(result.applied, true);

  const edit = stub.calls()[1];
  assert.deepEqual(edit, ['edit', PAGE, '--set', 'status=deprecated', '--expect', 'docs=1,blocks=1', '--json']);
  // The falsification target: a demotion that stamped `verified` would be
  // saying "a human vouches for this" about a page it just deprecated.
  assert.ok(!edit.some(a => a.startsWith('verified+=')));
});

test('the blast-radius guard is never omitted and never widened', async (t) => {
  const stub = stubVault(t);
  for (const outcome of ['promote', 'demote']) {
    await apply.applyOntologyDecision(
      { outcome, iri: IRI, signerNpub: NPUB, at: AT, caseId: 'c', digest: 'd' },
      { fetchFn: stubFetch(200) },
    );
  }
  const want = { promote: 'docs=1,blocks=2', demote: 'docs=1,blocks=1' };
  const edits = stub.calls().filter(c => c[0] === 'edit');
  assert.equal(edits.length, 2);
  for (const [call, outcome] of edits.map((c, i) => [c, ['promote', 'demote'][i]])) {
    const i = call.indexOf('--expect');
    assert.notEqual(i, -1, 'every edit declares its blast radius');
    // Exactly one --set per declared block: never more keys than declared.
    const keys = call.filter((a, j) => call[j - 1] === '--set').length;
    assert.equal(call[i + 1], want[outcome]);
    assert.equal(call[i + 1], `docs=1,blocks=${keys}`);
  }
});

test('expectFor counts distinct keys, treating key= and key+= as one key', () => {
  assert.equal(apply.expectFor(['--set', 'status=stable']), 'docs=1,blocks=1');
  assert.equal(apply.expectFor(['--set', 'status=stable', '--set', 'verified+={"a":1}']), 'docs=1,blocks=2');
  assert.equal(apply.expectFor(['--set', 'verified+=x', '--set', 'verified+=y']), 'docs=1,blocks=1');
  assert.throws(() => apply.expectFor(['--unset', 'status']), /malformed/);
});

// ── IRI resolution ──────────────────────────────────────────────────────────

test('the IRI is resolved by re-slugifying candidates, not by trusting the search rank', async (t) => {
  stubVault(t, {
    findResult: [
      { id: 'Knowledge Graphs', score: 0.99 },   // higher ranked, WRONG slug
      { id: PAGE, score: 0.40 },                 // lower ranked, RIGHT slug
    ],
  });
  const page = await apply.resolveIriToPage(IRI);
  assert.equal(page, PAGE, 'exactness beats rank');
});

test('two pages claiming one IRI stop the write rather than picking one', async (t) => {
  stubVault(t, { findResult: [{ id: PAGE }, { id: 'sub/Knowledge Graph' }] });
  await assert.rejects(() => apply.resolveIriToPage(IRI), /2 vault pages claim/);
});

test('an IRI no page answers to stops the write', async (t) => {
  stubVault(t, { findResult: [{ id: 'Something Else' }] });
  await assert.rejects(() => apply.resolveIriToPage(IRI), /no vault page answers/);
});

test('a page hint that does not answer to its own IRI is refused', async (t) => {
  stubVault(t);
  await assert.rejects(
    () => apply.resolveIriToPage(IRI, { page: 'Ontology' }),
    /does not answer to/,
  );
  // …and a hint that does answer short-circuits the search entirely.
  assert.equal(await apply.resolveIriToPage(IRI, { page: 'pages/Knowledge Graph' }), 'pages/Knowledge Graph');
});

test('slugging matches contract C1', () => {
  assert.equal(apply.slugify('Knowledge Graph'), 'knowledge-graph');
  assert.equal(apply.slugify('RGB-D Camera'), 'rgb-d-camera');
  assert.equal(apply.slugify('  Spatial  Computing! '), 'spatial-computing');
  assert.equal(apply.iriSlug('urn:ngm:class:knowledge-graph'), 'knowledge-graph');
});

// ── The ledger is a record, not a gate ──────────────────────────────────────

test('the Loom ledger receives the case id, digest, outcome, signer and instant', async (t) => {
  stubVault(t);
  const fetchFn = stubFetch(200);
  await apply.applyOntologyDecision(
    { outcome: 'promote', iri: IRI, signerNpub: NPUB, at: AT, caseId: 'case-a', digest: 'sha256:abc' },
    { fetchFn },
  );
  assert.equal(fetchFn.calls.length, 1);
  assert.equal(fetchFn.calls[0].method, 'POST');
  assert.match(fetchFn.calls[0].url, /\/loom\/attest$/);
  assert.deepEqual(fetchFn.calls[0].body, {
    case_id: 'case-a', digest: 'sha256:abc', outcome: 'promote', signer: `human:${NPUB}`, at: AT,
  });
});

test('a 404 from the not-yet-deployed attest route does not undo the write', async (t) => {
  stubVault(t);
  const result = await apply.applyOntologyDecision(
    { outcome: 'promote', iri: IRI, signerNpub: NPUB, at: AT, caseId: 'c', digest: 'd' },
    { fetchFn: stubFetch(404) },
  );
  assert.equal(result.applied, true, 'the page WAS written; saying otherwise would be a lie');
  assert.equal(result.attested, false);
  assert.match(result.attestError, /404/);
});

test('an unreachable Loom does not undo the write either', async (t) => {
  stubVault(t);
  const result = await apply.applyOntologyDecision(
    { outcome: 'promote', iri: IRI, signerNpub: NPUB, at: AT, caseId: 'c', digest: 'd' },
    { fetchFn: async () => { throw new Error('ECONNREFUSED'); } },
  );
  assert.equal(result.applied, true);
  assert.equal(result.attested, false);
  assert.match(result.attestError, /unreachable/);
});

// ── Refusals ────────────────────────────────────────────────────────────────

test('a decision with no iri is refused before any vault call', async (t) => {
  const stub = stubVault(t);
  await assert.rejects(
    () => apply.applyOntologyDecision({ outcome: 'promote', signerNpub: NPUB, at: AT }, { fetchFn: stubFetch() }),
    /carries no iri/,
  );
  assert.deepEqual(stub.calls(), []);
});

test('a non-ontology outcome is refused', async (t) => {
  stubVault(t);
  await assert.rejects(
    () => apply.applyOntologyDecision({ outcome: 'approve', iri: IRI }, { fetchFn: stubFetch() }),
    /not an ontology outcome/,
  );
});

test('a vault edit that refuses its guard fails the apply and writes nothing further', async (t) => {
  stubVault(t, { editExit: 1 });
  const fetchFn = stubFetch(200);
  await assert.rejects(() => apply.applyOntologyDecision(
    { outcome: 'promote', iri: IRI, signerNpub: NPUB, at: AT, caseId: 'c', digest: 'd' },
    { fetchFn },
  ));
  assert.equal(fetchFn.calls.length, 0, 'nothing is attested that was not applied');
});

// ── The handler ─────────────────────────────────────────────────────────────

function promoteEvent(content) {
  return {
    id: 'e'.repeat(64),
    pubkey: 'a'.repeat(64),
    kind: 31403,
    created_at: 1790078400,
    tags: [['d', 'sha256:abc'], ['e', 'r'.repeat(64)]],
    content: JSON.stringify(content),
  };
}

test('handleGovernanceDecision applies a promote and reports the page it wrote', async (t) => {
  const stub = stubVault(t);
  const adapter = new LocalProcessManagerOrchestratorAdapter({});
  adapter._ontologyDeps = { fetchFn: stubFetch(200) };

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-cwd-'));
  const prevCwd = process.cwd();
  process.chdir(cwd);
  t.after(() => { process.chdir(prevCwd); fs.rmSync(cwd, { recursive: true, force: true }); });

  const res = await adapter.handleGovernanceDecision(
    promoteEvent({ action: 'promote', iri: IRI, case_id: 'case-a', reasoning: 'checked the closure by hand' }),
  );

  assert.equal(res.ontology.applied, true);
  assert.equal(res.ontology.page, PAGE);
  const edit = stub.calls().find(c => c[0] === 'edit');
  assert.equal(edit[1], PAGE);
  // The instant stamped is the 31403's own `created_at`, not wall-clock now.
  assert.ok(edit.some(a => a.includes('2026-09-22T12:00:00.000Z')));
});

test('handleGovernanceDecision leaves a plain approve alone', async (t) => {
  const stub = stubVault(t);
  const adapter = new LocalProcessManagerOrchestratorAdapter({});
  adapter._ontologyDeps = { fetchFn: stubFetch(200) };

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-cwd-'));
  const prevCwd = process.cwd();
  process.chdir(cwd);
  t.after(() => { process.chdir(prevCwd); fs.rmSync(cwd, { recursive: true, force: true }); });

  const res = await adapter.handleGovernanceDecision(promoteEvent({ action: 'approve', case_id: 'case-a' }));
  assert.equal(res.ontology, null);
  assert.deepEqual(stub.calls(), [], 'no corpus write for a non-ontology outcome');
});

test('a failing apply records the failure instead of losing the signed decision', async (t) => {
  stubVault(t, { findResult: [] });
  const adapter = new LocalProcessManagerOrchestratorAdapter({});
  adapter._ontologyDeps = { fetchFn: stubFetch(200) };

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-cwd-'));
  const prevCwd = process.cwd();
  process.chdir(cwd);
  t.after(() => { process.chdir(prevCwd); fs.rmSync(cwd, { recursive: true, force: true }); });

  const res = await adapter.handleGovernanceDecision(promoteEvent({ action: 'promote', iri: IRI }));
  assert.equal(res.dispatched, true, 'the decision is still relayed and persisted');
  assert.equal(res.ontology.applied, false);
  assert.match(res.ontology.error, /no vault page answers/);
});

// ── Repository resolution: every vault call is pinned with --repo ───────────

test('resolveVaultRepo: VAULT_REPO wins when it holds the marker', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-repo-'));
  try {
    const repo = fakeRepo(dir);
    assert.equal(apply.resolveVaultRepo({ VAULT_REPO: repo, VAULT_ROOT: '/nonexistent/knowledge' }), repo);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('resolveVaultRepo: a set-but-wrong VAULT_REPO is an error, not a fall-through to VAULT_ROOT', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-repo-'));
  try {
    const repo = fakeRepo(dir);
    assert.throws(
      () => apply.resolveVaultRepo({ VAULT_REPO: dir, VAULT_ROOT: path.join(repo, 'knowledge') }),
      { name: 'VaultRepoError', message: /VAULT_REPO=.*holds no/ },
    );
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('resolveVaultRepo: VAULT_ROOT ending in knowledge/ or working/ resolves to its parent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-repo-'));
  try {
    const repo = fakeRepo(dir);
    assert.equal(apply.resolveVaultRepo({ VAULT_ROOT: path.join(repo, 'knowledge') }), repo);
    assert.equal(apply.resolveVaultRepo({ VAULT_ROOT: path.join(repo, 'working') + '/' }), repo);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('resolveVaultRepo: VAULT_ROOT that IS the repo is used as-is', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-repo-'));
  try {
    const repo = fakeRepo(dir);
    assert.equal(apply.resolveVaultRepo({ VAULT_ROOT: repo }), repo);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('resolveVaultRepo: a VAULT_ROOT whose derived repo has no marker fails closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-repo-'));
  try {
    fs.mkdirSync(path.join(dir, 'knowledge'));
    assert.throws(() => apply.resolveVaultRepo({ VAULT_ROOT: path.join(dir, 'knowledge') }),
      { name: 'VaultRepoError', message: /set VAULT_REPO explicitly/ });
    // Only knowledge/ and working/ step up: any other basename is not climbed.
    const other = path.join(fakeRepo(dir), 'pages');
    fs.mkdirSync(other, { recursive: true });
    assert.throws(() => apply.resolveVaultRepo({ VAULT_ROOT: other }), { name: 'VaultRepoError' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('resolveVaultRepo: neither variable set fails closed', () => {
  assert.throws(() => apply.resolveVaultRepo({}), { name: 'VaultRepoError', message: /neither VAULT_REPO nor VAULT_ROOT/ });
  assert.throws(() => apply.resolveVaultRepo({ VAULT_REPO: '  ', VAULT_ROOT: '' }), { name: 'VaultRepoError' });
});

test('an unresolvable repo spawns nothing and writes nothing', async (t) => {
  const stub = stubVault(t);
  const prevRepo = process.env.VAULT_REPO;
  const prevRoot = process.env.VAULT_ROOT;
  delete process.env.VAULT_REPO;
  process.env.VAULT_ROOT = path.join(os.tmpdir(), 'no-such-vault-repo', 'knowledge');
  t.after(() => {
    if (prevRepo === undefined) delete process.env.VAULT_REPO; else process.env.VAULT_REPO = prevRepo;
    if (prevRoot === undefined) delete process.env.VAULT_ROOT; else process.env.VAULT_ROOT = prevRoot;
  });
  const fetchFn = stubFetch(200);

  await assert.rejects(
    apply.applyOntologyDecision(
      { outcome: 'promote', iri: IRI, signerNpub: NPUB, at: AT, caseId: 'case-x', digest: 'sha256:x' },
      { fetchFn },
    ),
    { name: 'VaultRepoError' },
  );
  assert.deepEqual(stub.rawCalls(), [], 'the vault binary was never spawned');
  assert.equal(fetchFn.calls.length, 0, 'nothing was attested for a write that never happened');
});

test('the resolved repo is prepended as --repo on every real invocation', async (t) => {
  const stub = stubVault(t);
  await apply.applyOntologyDecision(
    { outcome: 'demote', iri: IRI, signerNpub: NPUB, at: AT, caseId: 'case-r', digest: 'sha256:r' },
    { fetchFn: stubFetch(200) },
  );
  const raw = stub.rawCalls();
  assert.equal(raw.length, 2);
  for (const argv of raw) assert.deepEqual(argv.slice(0, 2), ['--repo', stub.repo]);
});

test('vaultEnv passes the vault signing variables only when set, and nothing else', (t) => {
  const keys = ['VAULT_NOSTR_SECRET', 'VAULT_RELAY_URL', 'SOME_UNRELATED_SECRET'];
  const prev = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  t.after(() => { for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } });

  for (const k of keys) delete process.env[k];
  let env = apply.vaultEnv();
  assert.ok(!('VAULT_NOSTR_SECRET' in env), 'an absent secret stays absent');
  assert.ok(!('VAULT_RELAY_URL' in env));

  process.env.VAULT_NOSTR_SECRET = 'ab'.repeat(32);
  process.env.VAULT_RELAY_URL = 'ws://relay.local:7777';
  process.env.SOME_UNRELATED_SECRET = 'leak';
  env = apply.vaultEnv();
  assert.equal(env.VAULT_NOSTR_SECRET, 'ab'.repeat(32));
  assert.equal(env.VAULT_RELAY_URL, 'ws://relay.local:7777');
  assert.ok(!('SOME_UNRELATED_SECRET' in env), 'the allow-list still holds');
});

// ── Re-attestation, no-op demotion, canonical digest ────────────────────────

test('promoting an already-stable page is a re-attestation: one verified appended, blocks=1', async (t) => {
  const stub = stubVault(t, { pageStatus: 'stable' });
  const result = await apply.applyOntologyDecision(
    { outcome: 'promote', iri: IRI, signerNpub: NPUB, at: AT, caseId: 'case-re', digest: 'd' },
    { fetchFn: stubFetch(200) },
  );
  assert.equal(result.applied, true);
  assert.equal(result.reattest, true);
  assert.equal(result.blocks, 1);
  const edit = stub.calls().find(c => c[0] === 'edit');
  assert.deepEqual(edit, [
    'edit', PAGE,
    '--set', `verified+=${JSON.stringify({ by: `human:${NPUB}`, at: AT })}`,
    '--expect', 'docs=1,blocks=1',
    '--json',
  ]);
  assert.ok(!edit.includes('status=stable'), 'status is unchanged, so it is not sent');
});

test('demoting an already-deprecated page writes nothing but is still ledgered', async (t) => {
  const stub = stubVault(t, { pageStatus: 'deprecated' });
  const fetchFn = stubFetch(200);
  const result = await apply.applyOntologyDecision(
    { outcome: 'demote', iri: IRI, signerNpub: NPUB, at: AT, caseId: 'case-noop', digest: 'd' },
    { fetchFn },
  );
  assert.equal(result.applied, false);
  assert.equal(result.noop, true);
  assert.deepEqual(stub.calls().map(c => c[0]), ['find'], 'no vault edit was spawned');
  assert.equal(fetchFn.calls.length, 1);
  assert.equal(fetchFn.calls[0].body.outcome, 'demote');
});

test('--expect is derived from the keys that change, for every current status', () => {
  const cases = [
    ['promote', 'draft', 'docs=1,blocks=2'],
    ['promote', 'deprecated', 'docs=1,blocks=2'],
    ['promote', 'stable', 'docs=1,blocks=1'],
    ['demote', 'draft', 'docs=1,blocks=1'],
    ['demote', 'stable', 'docs=1,blocks=1'],
  ];
  for (const [outcome, currentStatus, want] of cases) {
    assert.equal(apply.expectFor(apply.setArgsFor(outcome, { npub: NPUB, at: AT, currentStatus })), want,
      `${outcome} from ${currentStatus}`);
  }
  assert.deepEqual(apply.setArgsFor('demote', { currentStatus: 'deprecated' }), []);
});

test('readPageStatus reads the frontmatter scalar and refuses ids that escape the pages dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-status-'));
  try {
    const repo = fakeRepo(dir, { pageStatus: "'stable'" });
    assert.equal(apply.readPageStatus(PAGE, { repo }), 'stable');
    assert.throws(() => apply.readPageStatus('../../ontology/vocabulary', { repo }), /escapes/);
    assert.throws(() => apply.readPageStatus('Missing Page', { repo }), /ENOENT/);
    fs.writeFileSync(path.join(repo, 'knowledge', 'pages', 'Bare.md'), 'no frontmatter\n');
    assert.throws(() => apply.readPageStatus('Bare', { repo }), /no YAML frontmatter/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the ledger digest is canonical sha256:<hex>, whatever form the 31403 carried', async (t) => {
  stubVault(t);
  const bare = 'AB'.repeat(32);
  const fetchFn = stubFetch(200);
  await apply.applyOntologyDecision(
    { outcome: 'demote', iri: IRI, signerNpub: NPUB, at: AT, caseId: bare, digest: bare },
    { fetchFn },
  );
  assert.equal(fetchFn.calls[0].body.digest, `sha256:${'ab'.repeat(32)}`);
  assert.equal(fetchFn.calls[0].body.case_id, bare, 'the case id stays the d tag verbatim');
  assert.equal(apply.canonicalDigest(`sha256:${'cd'.repeat(32)}`), `sha256:${'cd'.repeat(32)}`);
  assert.equal(apply.canonicalDigest('sha256:e2e-schema-case'), 'sha256:e2e-schema-case');
});

// ── kind: create — Promote writes the page the SIGNED diff adds ───────────

const NEW_IRI = 'urn:ngm:class:photon-sieve';
const NEW_PAGE = 'Photon Sieve';
const NEW_MD = `---\ntype: Class\nresource: ${NEW_IRI}\npublic: false\nstatus: draft\n---\nA diffractive optic.\n`;
const DIGEST_HEX = 'ef'.repeat(32);
const createDiff = (md = NEW_MD) => ['--- /dev/null', `+++ b/${NEW_PAGE}`,
  `@@ -0,0 +1,${md.split('\n').length - 1} @@`, ...md.replace(/\n$/, '').split('\n').map(l => `+${l}`), ''].join('\n');
const createProposal = (over = {}) => ({ kind: 'create', level: 'content', iri: NEW_IRI, page: NEW_PAGE,
  diff: createDiff(), digest: `sha256:${DIGEST_HEX}`, blockers: [], ...over });

const createDecision = (over = {}) => ({ outcome: 'promote', iri: NEW_IRI, signerNpub: NPUB, at: AT,
  caseId: DIGEST_HEX, digest: DIGEST_HEX, proposal: createProposal(), ...over });

test('pageFromCreateDiff reconstructs the added page byte for byte', () => {
  assert.equal(apply.pageFromCreateDiff(createDiff()), NEW_MD);
  const noNl = `${createDiff().replace(/\n$/, '')}\n\\ No newline at end of file\n`;
  assert.equal(apply.pageFromCreateDiff(noNl), NEW_MD.replace(/\n$/, ''));
});

test('pageFromCreateDiff refuses anything that is not a pure addition', () => {
  assert.throws(() => apply.pageFromCreateDiff(createDiff().replace('+type: Class', ' type: Class')), /may only ADD/);
  assert.throws(() => apply.pageFromCreateDiff(createDiff().replace('+type: Class', '-type: Class')), /may only ADD/);
  assert.throws(() => apply.pageFromCreateDiff('--- /dev/null\n+++ b/x\n'), /adds no page/);
  assert.throws(() => apply.pageFromCreateDiff(''), /adds no page/);
});

test('Promote of a create proposal: ONE vault create of the signed diff\'s page, stamped in the same write, then the ledger', async (t) => {
  const stub = stubVault(t);
  const fetchFn = stubFetch(200);
  const result = await apply.applyOntologyDecision(createDecision(), { fetchFn });

  assert.deepEqual([result.applied, result.created, result.page, result.attested], [true, true, NEW_PAGE, true]);
  const calls = stub.calls();
  assert.equal(calls.length, 1, 'no find, no edit: create writes, validates and stamps in one step');
  const file = calls[0][1];
  assert.equal(path.basename(file), `${NEW_PAGE}.md`);
  assert.deepEqual(calls[0].filter((_, i) => i !== 1), [
    'create',
    '--expect', 'docs=1',
    '--set', 'status=stable',
    '--set', `verified+={by: human:${NPUB}, at: ${AT}}`,
    '--json',
  ]);
  assert.equal(fs.readFileSync(path.join(stub.repo, 'knowledge', 'pages', `${NEW_PAGE}.md`), 'utf8'), NEW_MD,
    'the vault received exactly the bytes the signed diff adds');
  assert.ok(!fs.existsSync(file), 'the temp file is removed');
  assert.equal(fetchFn.calls.length, 1);
  assert.deepEqual(fetchFn.calls[0].body,
    { case_id: DIGEST_HEX, digest: `sha256:${DIGEST_HEX}`, outcome: 'promote', signer: `human:${NPUB}`, at: AT });
});

test('the page already existing (exit 2, a race) is applied:false reason exists, and NOT ledgered', async (t) => {
  const stub = stubVault(t);
  fs.writeFileSync(path.join(stub.repo, 'knowledge', 'pages', `${NEW_PAGE}.md`), 'someone else\n');
  const fetchFn = stubFetch(200);
  const result = await apply.applyOntologyDecision(createDecision(), { fetchFn });
  assert.deepEqual([result.applied, result.created, result.reason], [false, false, 'exists']);
  assert.equal(fetchFn.calls.length, 0, 'nothing was admitted, so nothing is ledgered');
  assert.equal(fs.readFileSync(path.join(stub.repo, 'knowledge', 'pages', `${NEW_PAGE}.md`), 'utf8'), 'someone else\n');
});

test('page_sha256, when the proposal carries it, must be the hash of the signed diff\'s page', async (t) => {
  const stub = stubVault(t);
  await assert.rejects(apply.applyOntologyDecision(
    createDecision({ proposal: createProposal({ page_sha256: `sha256:${'00'.repeat(32)}` }) }), { fetchFn: stubFetch() }),
    /not the proposal's page_sha256 0000/);
  assert.deepEqual(stub.calls(), [], 'refused before the vault was spawned');

  const sha = require('crypto').createHash('sha256').update(NEW_MD).digest('hex');
  const result = await apply.applyOntologyDecision(
    createDecision({ proposal: createProposal({ page_sha256: `sha256:${sha}` }) }), { fetchFn: stubFetch(200) });
  assert.equal(result.created, true);
});

test('a create diff that is not a pure addition is refused before the vault is spawned', async (t) => {
  const stub = stubVault(t);
  await assert.rejects(apply.applyOntologyDecision(
    createDecision({ proposal: createProposal({ diff: createDiff().replace('+type: Class', ' type: Class') }) }),
    { fetchFn: stubFetch() }), /may only ADD/);
  assert.deepEqual(stub.calls(), []);
});

test('create proposals refuse what they cannot do safely — and spawn nothing', async (t) => {
  const stub = stubVault(t);
  const f = { fetchFn: stubFetch() };
  await assert.rejects(apply.applyOntologyDecision(createDecision({ outcome: 'demote' }), f), /can only be promoted/);
  await assert.rejects(apply.applyOntologyDecision(createDecision({ iri: 'urn:ngm:class:other' }), f),
    /is not the create proposal's/);
  await assert.rejects(apply.applyOntologyDecision(
    createDecision({ proposal: createProposal({ page: 'Wrong Page' }) }), f), /does not answer to/);
  await assert.rejects(apply.applyOntologyDecision(
    createDecision({ proposal: createProposal({ pages: [NEW_PAGE, 'Zone Plate'] }) }), f), /grouped create/);
  await assert.rejects(apply.applyOntologyDecision(
    createDecision({ proposal: createProposal({ diff: createDiff(NEW_MD.replace(NEW_IRI, 'urn:ngm:class:elsewhere')) }) }), f),
    /resource is not/);
  assert.deepEqual(stub.calls(), [], 'every refusal happened before the vault was spawned');
});

test('every non-EXISTS refusal (exit 2) throws with its code and blockers, and is not ledgered', async (t) => {
  for (const code of ['BLOCKED', 'FRONTMATTER_INVALID', 'UNTITLED', 'UNDECLARED_BLAST_RADIUS', 'GUARD_VIOLATED']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-refuse-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const refusal = { created: false, file: 'x.md', code, message: `refused: ${code}`,
      blockers: code === 'BLOCKED' ? [{ code: 'SLUG_COLLISION', message: 'x' }] : [] };
    const runVault = async () => {
      const err = new Error('Command failed');
      err.code = 2;
      err.stdout = JSON.stringify(refusal);
      throw err;
    };
    const fetchFn = stubFetch(200);
    await assert.rejects(apply.applyOntologyDecision(createDecision(), { fetchFn, runVault, tmpRoot: dir }),
      (err) => err.code === code && /vault create refused Photon Sieve/.test(err.message)
        && (code !== 'BLOCKED' || /SLUG_COLLISION/.test(err.message)));
    assert.equal(fetchFn.calls.length, 0, `${code}: nothing ledgered`);
    assert.deepEqual(fs.readdirSync(dir), [], `${code}: the temp file is removed`);
  }
});

test('the attestation is ONE argv element holding a YAML flow MAPPING (by/at), not a string', () => {
  const yaml = require('js-yaml');
  const argv = apply.createArgsFor('/tmp/x.md', { npub: NPUB, at: AT });
  const sets = argv.filter((a, i) => argv[i - 1] === '--set');
  assert.deepEqual(sets[0], 'status=stable');
  assert.equal(sets.length, 2);
  const [key, value] = sets[1].split(/\+=(.*)/s);
  assert.equal(key, 'verified');
  assert.equal(value, `{by: human:${NPUB}, at: ${AT}}`, 'a space after each colon');
  const parsed = yaml.load(value);
  assert.equal(typeof parsed, 'object');
  assert.deepEqual(Object.keys(parsed), ['by', 'at']);
  assert.equal(parsed.by, `human:${NPUB}`);
  assert.equal(new Date(parsed.at).toISOString(), AT);
});

test('any other vault create failure rejects with no ledger entry', async (t) => {
  const stub = stubVault(t, { createExit: 3 });
  const fetchFn = stubFetch(200);
  await assert.rejects(apply.applyOntologyDecision(createDecision(), { fetchFn }));
  assert.deepEqual(stub.calls().map(c => c[0]), ['create']);
  assert.equal(fetchFn.calls.length, 0);
});

test('an absent or amend kind keeps today\'s edit path', async (t) => {
  const stub = stubVault(t);
  for (const kind of [undefined, 'amend']) {
    await apply.applyOntologyDecision(
      { outcome: 'demote', iri: IRI, signerNpub: NPUB, at: AT, caseId: 'c', digest: 'd',
        proposal: { kind, iri: IRI, page: PAGE } },
      { fetchFn: stubFetch(200) });
  }
  assert.deepEqual(stub.calls().map(c => c[0]), ['find', 'edit', 'find', 'edit']);
});

test('proposalFromRequest reads the PatchProposal from a stored 31402', () => {
  const p = createProposal();
  assert.deepEqual(apply.proposalFromRequest({ content: JSON.stringify(p) }), p);
  assert.deepEqual(apply.proposalFromRequest({ content: { proposal: p } }), p);
  assert.equal(apply.proposalFromRequest({ content: 'not json' }), null);
  assert.equal(apply.proposalFromRequest(null), null);
});

test('the adapter applies a create only when the stored 31402 is the SAME case as the 31403', async (t) => {
  const stub = stubVault(t);
  const request = { event_id: 'aa'.repeat(32), kind: 31402, d_tag: DIGEST_HEX, content: JSON.stringify(createProposal()) };
  const response = (dTag) => ({
    id: 'bb'.repeat(32), pubkey: 'cc'.repeat(32), created_at: 1790078460, kind: 31403,
    tags: [['d', dTag], ['e', request.event_id]],
    content: JSON.stringify({ action: 'promote', iri: NEW_IRI, case_id: dTag }),
  });
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-cwd-'));
  const prev = process.cwd();
  process.chdir(cwd);
  t.after(() => { process.chdir(prev); fs.rmSync(cwd, { recursive: true, force: true }); });

  const adapter = new LocalProcessManagerOrchestratorAdapter({});
  adapter._ontologyDeps = { fetchFn: stubFetch(200), fetchRequest: async (id) => (id === request.event_id ? request : null) };

  // A 31403 for a different case must not borrow this request's page.
  const other = await adapter.handleGovernanceDecision(response('11'.repeat(32)));
  assert.equal(other.ontology.applied, false);
  assert.ok(!stub.calls().some(c => c[0] === 'create'));

  const res = await adapter.handleGovernanceDecision(response(DIGEST_HEX));
  assert.equal(res.ontology.created, true, res.ontology.error);
  assert.deepEqual(stub.calls().filter(c => c[0] === 'create').length, 1);
});
