'use strict';
// ADR-2106 — a signed Promote/Demote applies through `vault edit`.
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

/**
 * Install a stub `vault` on PATH. Returns the log reader and a restore fn.
 *
 * `findResult` is the JSON the stub prints for `vault find`; `editExit` is the
 * exit code for `vault edit`, so a refused guard is testable without a real
 * vault.
 */
function stubVault(t, { findResult = [{ id: PAGE, title: PAGE, type: 'Class', score: 1 }], editExit = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-stub-'));
  const log = path.join(dir, 'argv.log');
  const script = `#!/bin/sh
{ for a in "$@"; do printf '%s\\n' "$a"; done; printf -- '--\\n'; } >> ${JSON.stringify(log)}
case "$1" in
  find) printf '%s' ${JSON.stringify(JSON.stringify(findResult))} ;;
  edit) printf '%s' '{"ok":true,"docs":1,"blocks":1}'; exit ${editExit} ;;
  *) printf '%s' 'null' ;;
esac
`;
  const bin = path.join(dir, 'vault');
  fs.writeFileSync(bin, script, { mode: 0o755 });

  const prevPath = process.env.PATH;
  const prevBin = process.env.VAULT_BIN;
  process.env.PATH = `${dir}:${prevPath}`;
  delete process.env.VAULT_BIN; // prove the default `vault` resolves on PATH

  t.after(() => {
    process.env.PATH = prevPath;
    if (prevBin === undefined) delete process.env.VAULT_BIN; else process.env.VAULT_BIN = prevBin;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  return {
    /** Every invocation, as an array of argv arrays. */
    calls() {
      if (!fs.existsSync(log)) return [];
      return fs.readFileSync(log, 'utf8').split('--\n').filter(Boolean)
        .map(block => block.split('\n').filter(l => l.length > 0));
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
    '--expect', 'docs=1,blocks=1',
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
  for (const call of stub.calls().filter(c => c[0] === 'edit')) {
    const i = call.indexOf('--expect');
    assert.notEqual(i, -1, 'every edit declares its blast radius');
    assert.equal(call[i + 1], 'docs=1,blocks=1');
  }
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
    case_id: 'case-a', digest: 'sha256:abc', outcome: 'promote', signer: NPUB, at: AT,
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
