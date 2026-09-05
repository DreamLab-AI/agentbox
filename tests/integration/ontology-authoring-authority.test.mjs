// ontology-authoring-authority.test.mjs — ADR-2022 acceptance fixtures for the
// named authority gate that separates LOCAL AUTHORING from SHARED-ONTOLOGY
// PROMOTION.
//
// Hermetic: a temp Markdown corpus, an injected env and an injected manifest.
// No VisionClaw, no Whelk, no Loom, no network, no provider.
//
// Run: node --test tests/integration/ontology-authoring-authority.test.mjs
//
// Required fixtures (ADR-2022 closeout acceptance):
//   forced-local without opt-in → typed denial, no file written · forced-local
//   with opt-in → write allowed with a correlation id in BOTH the artefact and
//   the return value · remote-disabled · bootstrap · governed-proposal
//   targeting the shared store · direct axiom load blocked when
//   direct_axiom_load = false · every caller of the Markdown-writing helper
//   passes through the gate.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO = path.resolve(new URL('../..', import.meta.url).pathname);
const authority = require('../../mcp/servers/lib/ontology-authoring-authority.js');
const { createLocalOntology } = require('../../mcp/servers/lib/ontology-local.js');

const {
  AUTHORING_MODES,
  AUTHORING_TARGETS,
  AUTHORING_OPERATIONS,
  AUTHORING_CHAIN_STAGES,
  DENIAL_CODES,
  ENV_KEYS,
  MANIFEST_KEYS,
  CORRELATION_FRONTMATTER_KEYS,
  OntologyAuthorityError,
  assertAuthoringAuthority,
  createAuthoredCorpusWriter,
  resolveAuthoringMode,
} = authority;

// ── temp corpus ──────────────────────────────────────────────────────────────

const PAGE = `---
public: true
owl-class: urn:ngm:class:smart-contract
---

# Smart Contract

\`\`\`json-ld
{
  "@type": "Class",
  "@id": "urn:ngm:class:smart-contract",
  "label": "Smart Contract",
  "definition": "A self-executing agreement.",
  "domain": "blockchain",
  "maturity": "mature"
}
\`\`\`
`;

function makeCorpus() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ont-authority-'));
  fs.writeFileSync(path.join(dir, 'smart-contract.md'), PAGE, 'utf8');
  return dir;
}

function readPage(dir) {
  return fs.readFileSync(path.join(dir, 'smart-contract.md'), 'utf8');
}

/** Manifest views. Deny-by-default is the ABSENCE of a key, not a false one. */
const MANIFEST_EMPTY = {};
const MANIFEST_LOCAL_AUTHORING = { skills: { ontology: { local_authoring: true, direct_axiom_load: false } } };
const MANIFEST_DIRECT_LOAD = { skills: { ontology: { local_authoring: true, direct_axiom_load: true } } };

const ENV_FORCE_LOCAL_ONLY = { [ENV_KEYS.FORCE_LOCAL]: '1' };
const ENV_FORCE_LOCAL_OPTED_IN = { [ENV_KEYS.FORCE_LOCAL]: '1', [ENV_KEYS.LOCAL_AUTHORING]: '1' };

function writerFor(dir, { env, manifest, gate } = {}) {
  return createAuthoredCorpusWriter({
    backend: createLocalOntology(dir),
    env: env || {},
    manifest: manifest === undefined ? MANIFEST_EMPTY : manifest,
    gate,
  });
}

const AXIOM = { axiom_type: 'ObjectPropertyAssertion', subject: 'urn:ngm:class:smart-contract', object: 'urn:ngm:class:escrow' };
const PROPOSAL = { subject: 'urn:ngm:class:smart-contract', object: 'urn:ngm:class:escrow', relation: 'relatedTo' };

// ── 1. forced-local WITHOUT the opt-in ──────────────────────────────────────

test('forced-local without opt-in: typed denial naming the missing authority, nothing written', () => {
  const dir = makeCorpus();
  const before = readPage(dir);
  const W = writerFor(dir, { env: ENV_FORCE_LOCAL_ONLY, manifest: MANIFEST_EMPTY });

  let thrown = null;
  try { W.propose(PROPOSAL, { mode: AUTHORING_MODES.FORCED_LOCAL }); } catch (e) { thrown = e; }

  assert.ok(thrown instanceof OntologyAuthorityError, 'denial is a typed error, not a falsy return');
  assert.equal(thrown.code, DENIAL_CODES.LOCAL_AUTHORING_NOT_AUTHORISED);
  assert.deepEqual(thrown.missing_authority, [
    `env:${ENV_KEYS.LOCAL_AUTHORING}`,
    `manifest:${MANIFEST_KEYS.LOCAL_AUTHORING}`,
  ]);
  assert.equal(thrown.authorised, false);
  assert.equal(readPage(dir), before, 'the corpus is byte-identical — no silent write');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('forced-local with the env opt-in but no manifest key: still denied', () => {
  const dir = makeCorpus();
  const before = readPage(dir);
  const W = writerFor(dir, { env: ENV_FORCE_LOCAL_OPTED_IN, manifest: MANIFEST_EMPTY });
  assert.throws(
    () => W.propose(PROPOSAL, { mode: AUTHORING_MODES.FORCED_LOCAL }),
    (e) => e.code === DENIAL_CODES.LOCAL_AUTHORING_NOT_AUTHORISED
      && e.missing_authority.includes(`manifest:${MANIFEST_KEYS.LOCAL_AUTHORING}`),
  );
  assert.equal(readPage(dir), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('forced-local: FORCE_LOCAL alone is a BACKEND selector, never an authority', () => {
  assert.throws(
    () => assertAuthoringAuthority({
      mode: AUTHORING_MODES.FORCED_LOCAL, env: ENV_FORCE_LOCAL_ONLY, manifest: MANIFEST_LOCAL_AUTHORING,
    }),
    (e) => e.missing_authority.includes(`env:${ENV_KEYS.LOCAL_AUTHORING}`),
  );
});

// ── 2. forced-local WITH the opt-in ─────────────────────────────────────────

test('forced-local with opt-in: write allowed, correlation id in the return AND the artefact', () => {
  const dir = makeCorpus();
  const W = writerFor(dir, { env: ENV_FORCE_LOCAL_OPTED_IN, manifest: MANIFEST_LOCAL_AUTHORING });

  const out = W.propose(PROPOSAL, { mode: AUTHORING_MODES.FORCED_LOCAL });

  assert.equal(out.authorised, true);
  assert.equal(out.changed, true, 'the corpus edit actually happened');
  assert.equal(out.mode, AUTHORING_MODES.FORCED_LOCAL);
  assert.equal(out.governed, false, 'local authoring is authoring, NOT governed promotion');
  assert.equal(out.route, 'local-authored-corpus');
  assert.match(out.correlation_id, /^ont-auth-\d{14}-[0-9a-f]{12}$/);
  assert.deepEqual(out.chain_stages, AUTHORING_CHAIN_STAGES);
  assert.equal(out.stage, 'validation');
  assert.equal(out.correlation_stamped, true);

  const page = readPage(dir);
  assert.ok(page.includes(`${CORRELATION_FRONTMATTER_KEYS.ID}: ${out.correlation_id}`),
    `correlation id stamped into frontmatter:\n${page}`);
  assert.ok(page.includes(`${CORRELATION_FRONTMATTER_KEYS.MODE}: ${AUTHORING_MODES.FORCED_LOCAL}`));
  assert.ok(page.includes(`${CORRELATION_FRONTMATTER_KEYS.STAGE}: validation`));
  assert.ok(page.includes('"relatedTo"'), 'the authored relation landed in the Class block');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('forced-local: an explicit correlation id from an earlier chain stage is reused', () => {
  const dir = makeCorpus();
  const W = writerFor(dir, { env: ENV_FORCE_LOCAL_OPTED_IN, manifest: MANIFEST_LOCAL_AUTHORING });
  const out = W.propose(PROPOSAL, { mode: AUTHORING_MODES.FORCED_LOCAL, correlation_id: 'ont-auth-upstream-1' });
  assert.equal(out.correlation_id, 'ont-auth-upstream-1');
  assert.ok(readPage(dir).includes('ont-auth-upstream-1'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('forced-local may never target the shared ontology', () => {
  assert.throws(
    () => assertAuthoringAuthority({
      mode: AUTHORING_MODES.FORCED_LOCAL,
      target: AUTHORING_TARGETS.SHARED_ONTOLOGY,
      env: ENV_FORCE_LOCAL_OPTED_IN,
      manifest: MANIFEST_DIRECT_LOAD,
    }),
    (e) => e.code === DENIAL_CODES.SHARED_STORE_FORBIDDEN
      && e.missing_authority.includes(`mode:${AUTHORING_MODES.GOVERNED_PROPOSAL}`),
  );
});

// ── 3. remote-disabled ──────────────────────────────────────────────────────

test('remote-disabled: an outage is not an authority — denied without the opt-in', () => {
  const dir = makeCorpus();
  const before = readPage(dir);
  const W = writerFor(dir, { env: {}, manifest: MANIFEST_EMPTY });
  assert.throws(
    () => W.propose(PROPOSAL, { mode: AUTHORING_MODES.REMOTE_DISABLED }),
    (e) => e.code === DENIAL_CODES.LOCAL_AUTHORING_NOT_AUTHORISED
      && e.mode === AUTHORING_MODES.REMOTE_DISABLED,
  );
  assert.equal(readPage(dir), before, 'a network failure never writes the corpus');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('remote-disabled with the opt-in: authoring allowed, confined to the local corpus', () => {
  const dir = makeCorpus();
  const W = writerFor(dir, {
    env: { [ENV_KEYS.LOCAL_AUTHORING]: '1' }, // no FORCE_LOCAL: the failure chose the backend
    manifest: MANIFEST_LOCAL_AUTHORING,
  });
  const out = W.propose(PROPOSAL, { mode: AUTHORING_MODES.REMOTE_DISABLED });
  assert.equal(out.authorised, true);
  assert.equal(out.changed, true);
  assert.equal(out.governed, false);
  assert.ok(out.correlation_id);
  assert.ok(readPage(dir).includes(out.correlation_id));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('remote-disabled may never target the shared ontology', () => {
  assert.throws(
    () => assertAuthoringAuthority({
      mode: AUTHORING_MODES.REMOTE_DISABLED,
      target: AUTHORING_TARGETS.SHARED_ONTOLOGY,
      env: { [ENV_KEYS.LOCAL_AUTHORING]: '1' },
      manifest: MANIFEST_LOCAL_AUTHORING,
    }),
    (e) => e.code === DENIAL_CODES.SHARED_STORE_FORBIDDEN,
  );
});

// ── 4. bootstrap ────────────────────────────────────────────────────────────

test('bootstrap: denied without the manifest flag, the env flag and the authorisation reference', () => {
  assert.throws(
    () => assertAuthoringAuthority({
      mode: AUTHORING_MODES.BOOTSTRAP,
      operation: AUTHORING_OPERATIONS.DIRECT_AXIOM_LOAD,
      env: {},
      manifest: MANIFEST_EMPTY,
    }),
    // direct_axiom_load = false blocks the load before bootstrap authority is
    // even considered — the manifest flag is the outer gate.
    (e) => e.code === DENIAL_CODES.DIRECT_AXIOM_LOAD_DISABLED,
  );

  assert.throws(
    () => assertAuthoringAuthority({
      mode: AUTHORING_MODES.BOOTSTRAP,
      operation: AUTHORING_OPERATIONS.DIRECT_AXIOM_LOAD,
      env: { [ENV_KEYS.BOOTSTRAP]: '1' }, // no authorisation reference
      manifest: MANIFEST_DIRECT_LOAD,
    }),
    (e) => e.code === DENIAL_CODES.BOOTSTRAP_NOT_AUTHORISED
      && e.missing_authority.includes(`env:${ENV_KEYS.BOOTSTRAP_AUTHORISATION}`),
  );
});

test('bootstrap fully authorised: the axiom load runs and is correlated', () => {
  const dir = makeCorpus();
  const W = writerFor(dir, {
    env: {
      [ENV_KEYS.BOOTSTRAP]: '1',
      [ENV_KEYS.BOOTSTRAP_AUTHORISATION]: 'urn:agentbox:decision:bootstrap-2026-09-05',
    },
    manifest: MANIFEST_DIRECT_LOAD,
  });
  const out = W.axiomAdd(AXIOM, { mode: AUTHORING_MODES.BOOTSTRAP });
  assert.equal(out.authorised, true);
  assert.equal(out.changed, true);
  assert.equal(out.mode, AUTHORING_MODES.BOOTSTRAP);
  assert.ok(out.correlation_id);
  assert.ok(readPage(dir).includes(`${CORRELATION_FRONTMATTER_KEYS.MODE}: ${AUTHORING_MODES.BOOTSTRAP}`));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bootstrap records, but does not itself verify, the authorisation reference', () => {
  const grant = assertAuthoringAuthority({
    mode: AUTHORING_MODES.BOOTSTRAP,
    operation: AUTHORING_OPERATIONS.DIRECT_AXIOM_LOAD,
    env: { [ENV_KEYS.BOOTSTRAP]: '1', [ENV_KEYS.BOOTSTRAP_AUTHORISATION]: 'urn:agentbox:decision:x' },
    manifest: MANIFEST_DIRECT_LOAD,
  });
  assert.equal(grant.bootstrap_authorisation, 'urn:agentbox:decision:x');
  assert.equal(grant.target, AUTHORING_TARGETS.LOCAL_AUTHORED_CORPUS);
});

test('bootstrap may never target the shared ontology through this gate', () => {
  assert.throws(
    () => assertAuthoringAuthority({
      mode: AUTHORING_MODES.BOOTSTRAP,
      target: AUTHORING_TARGETS.SHARED_ONTOLOGY,
      operation: AUTHORING_OPERATIONS.DIRECT_AXIOM_LOAD,
      env: { [ENV_KEYS.BOOTSTRAP]: '1', [ENV_KEYS.BOOTSTRAP_AUTHORISATION]: 'urn:agentbox:decision:x' },
      manifest: MANIFEST_DIRECT_LOAD,
    }),
    (e) => e.code === DENIAL_CODES.SHARED_STORE_FORBIDDEN,
  );
});

// ── 5. governed-proposal ────────────────────────────────────────────────────

test('governed-proposal: the only mode that may target the shared ontology', () => {
  const grant = assertAuthoringAuthority({
    mode: AUTHORING_MODES.GOVERNED_PROPOSAL,
    target: AUTHORING_TARGETS.SHARED_ONTOLOGY,
    operation: AUTHORING_OPERATIONS.PROPOSAL,
    env: {},
    manifest: MANIFEST_EMPTY, // needs no local-authoring opt-in: it writes no file
  });
  assert.equal(grant.authorised, true);
  assert.equal(grant.governed, true);
  assert.equal(grant.route, 'proposal-pr');
  assert.equal(grant.local_write_permitted, false);
  assert.equal(grant.target, AUTHORING_TARGETS.SHARED_ONTOLOGY);
  assert.ok(grant.correlation_id);
});

test('governed-proposal: writes NO local file, returns the governed route instead', () => {
  const dir = makeCorpus();
  const before = readPage(dir);
  const W = writerFor(dir, { env: {}, manifest: MANIFEST_EMPTY });
  const out = W.propose(PROPOSAL, { mode: AUTHORING_MODES.GOVERNED_PROPOSAL, target: AUTHORING_TARGETS.SHARED_ONTOLOGY });
  assert.equal(out.authorised, true);
  assert.equal(out.written, false);
  assert.equal(out.governed, true);
  assert.equal(out.route, 'proposal-pr');
  assert.ok(out.correlation_id);
  assert.equal(readPage(dir), before, 'a governed proposal never edits the local corpus');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('governed-proposal: a direct axiom load is CONVERTED into a proposal, not executed', () => {
  const dir = makeCorpus();
  const before = readPage(dir);
  const W = writerFor(dir, { env: {}, manifest: MANIFEST_EMPTY });
  const out = W.axiomAdd(AXIOM, { mode: AUTHORING_MODES.GOVERNED_PROPOSAL, target: AUTHORING_TARGETS.SHARED_ONTOLOGY });
  assert.equal(out.written, false);
  assert.equal(out.converted_from, AUTHORING_OPERATIONS.DIRECT_AXIOM_LOAD);
  assert.match(out.message, /ontology_propose/);
  assert.equal(readPage(dir), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('governed-proposal: a raw local corpus edit is refused — it produces a proposal', () => {
  assert.throws(
    () => assertAuthoringAuthority({
      mode: AUTHORING_MODES.GOVERNED_PROPOSAL,
      operation: AUTHORING_OPERATIONS.LOCAL_AUTHORING_WRITE,
      env: {}, manifest: MANIFEST_EMPTY,
    }),
    (e) => e.code === DENIAL_CODES.GOVERNED_ROUTE_REQUIRED,
  );
});

// ── 6. direct_axiom_load = false actually blocks ────────────────────────────

test('direct axiom load is blocked in EVERY mode except governed-proposal when the manifest says false', () => {
  const dir = makeCorpus();
  const before = readPage(dir);
  const cases = [
    [AUTHORING_MODES.FORCED_LOCAL, ENV_FORCE_LOCAL_OPTED_IN],
    [AUTHORING_MODES.REMOTE_DISABLED, { [ENV_KEYS.LOCAL_AUTHORING]: '1' }],
    [AUTHORING_MODES.BOOTSTRAP, { [ENV_KEYS.BOOTSTRAP]: '1', [ENV_KEYS.BOOTSTRAP_AUTHORISATION]: 'urn:x' }],
  ];
  for (const [mode, env] of cases) {
    // local_authoring is TRUE here — the local opt-in must NOT unlock the
    // ungoverned axiom backdoor. Only direct_axiom_load does that.
    const W = writerFor(dir, { env, manifest: MANIFEST_LOCAL_AUTHORING });
    assert.throws(
      () => W.axiomAdd(AXIOM, { mode }),
      (e) => e.code === DENIAL_CODES.DIRECT_AXIOM_LOAD_DISABLED
        && e.missing_authority.includes(`manifest:${MANIFEST_KEYS.DIRECT_AXIOM_LOAD}`),
      `mode ${mode} must be blocked`,
    );
    assert.equal(readPage(dir), before, `mode ${mode} wrote nothing`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the live agentbox.toml still has direct_axiom_load = false and no local_authoring key', () => {
  const policy = authority.readManifestFile(path.join(REPO, 'agentbox.toml'));
  assert.equal(policy.direct_axiom_load, false, 'ADR-2022 default holds in the running manifest');
  assert.equal(policy.local_authoring, false, 'local authoring is off until explicitly enabled');
});

// ── 7. deny by default ──────────────────────────────────────────────────────

test('an unknown mode is denied, never treated as permissive', () => {
  assert.throws(
    () => assertAuthoringAuthority({ mode: 'whatever', env: {}, manifest: MANIFEST_DIRECT_LOAD }),
    (e) => e.code === DENIAL_CODES.UNKNOWN_MODE,
  );
  assert.throws(
    () => assertAuthoringAuthority({ env: {}, manifest: MANIFEST_DIRECT_LOAD }),
    (e) => e.code === DENIAL_CODES.UNKNOWN_MODE,
  );
});

test('resolveAuthoringMode is a closed set: bootstrap > forced-local > remote-disabled > governed', () => {
  assert.equal(resolveAuthoringMode({ forceLocal: true, env: {} }), AUTHORING_MODES.FORCED_LOCAL);
  assert.equal(resolveAuthoringMode({ remoteFailed: true, env: {} }), AUTHORING_MODES.REMOTE_DISABLED);
  assert.equal(resolveAuthoringMode({ env: {} }), AUTHORING_MODES.GOVERNED_PROPOSAL);
  assert.equal(
    resolveAuthoringMode({ forceLocal: true, env: { [ENV_KEYS.BOOTSTRAP]: '1' } }),
    AUTHORING_MODES.BOOTSTRAP,
  );
});

// ── 8. every caller goes through the gate ───────────────────────────────────

test('gate spy: BOTH writer entry points invoke the gate exactly once, with the right claim', () => {
  const dir = makeCorpus();
  const calls = [];
  const spy = (opts) => { calls.push(opts); return assertAuthoringAuthority(opts); };
  const W = writerFor(dir, { env: ENV_FORCE_LOCAL_OPTED_IN, manifest: MANIFEST_DIRECT_LOAD, gate: spy });

  W.propose(PROPOSAL, { mode: AUTHORING_MODES.FORCED_LOCAL });
  W.axiomAdd(AXIOM, { mode: AUTHORING_MODES.FORCED_LOCAL });

  assert.equal(calls.length, 2, 'one gate call per entry point');
  assert.equal(calls[0].tool, 'ontology_propose');
  assert.equal(calls[0].operation, AUTHORING_OPERATIONS.LOCAL_AUTHORING_WRITE);
  assert.equal(calls[0].mode, AUTHORING_MODES.FORCED_LOCAL);
  assert.equal(calls[1].tool, 'ontology_axiom_add');
  assert.equal(calls[1].operation, AUTHORING_OPERATIONS.DIRECT_AXIOM_LOAD);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate spy: when the gate denies, the Markdown helper is never reached', () => {
  const dir = makeCorpus();
  const before = readPage(dir);
  let reached = 0;
  const denying = () => {
    throw new OntologyAuthorityError({
      code: DENIAL_CODES.LOCAL_AUTHORING_NOT_AUTHORISED,
      message: 'denied by the spy',
      missing_authority: ['spy'],
    });
  };
  const backend = createLocalOntology(dir);
  const tracked = {
    corpusDir: dir,
    axiomAdd: (a) => { reached++; return backend.axiomAdd(a); },
    propose: (a) => { reached++; return backend.propose(a); },
  };
  const W = createAuthoredCorpusWriter({ backend: tracked, gate: denying, env: {}, manifest: MANIFEST_DIRECT_LOAD });

  assert.throws(() => W.propose(PROPOSAL, { mode: AUTHORING_MODES.FORCED_LOCAL }), OntologyAuthorityError);
  assert.throws(() => W.axiomAdd(AXIOM, { mode: AUTHORING_MODES.FORCED_LOCAL }), OntologyAuthorityError);
  assert.equal(reached, 0, 'the writing helper was never called');
  assert.equal(readPage(dir), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('static guard: no production file reaches the Markdown-writing helper except through the gate', () => {
  // Receivers of `.axiomAdd(` / `.propose(` per production file. The bridge may
  // only call the GATED writer (`W`); the gate module may call its injected
  // backend. Any new receiver here is a bypass and must fail this test.
  const EXPECTED = {
    'mcp/servers/ontology-bridge.js': ['W'],
    'mcp/servers/lib/ontology-authoring-authority.js': ['backend'],
    // ADR-2054 CLOSED the last bypass: the standalone CLI front-end now calls the
    // GATED writer, not the raw backend. Pinning the receiver as `writer` means a
    // regression back to `onto` fails this test.
    'mcp/servers/ontology-local.cjs': ['writer'],
  };

  const roots = ['mcp/servers', 'mcp/servers/lib'];
  const found = {};
  for (const root of roots) {
    for (const f of fs.readdirSync(path.join(REPO, root))) {
      if (!/\.(js|cjs|mjs)$/.test(f) || /\.test\./.test(f)) continue;
      const rel = `${root}/${f}`;
      const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
      const receivers = new Set();
      for (const m of src.matchAll(/(\w+)\s*(?:\(\))?\.(?:axiomAdd|propose)\s*\(/g)) {
        receivers.add(m[1]);
      }
      if (receivers.size) found[rel] = [...receivers].sort();
    }
  }

  assert.deepEqual(found, EXPECTED, `unexpected direct callers of the writing helper: ${JSON.stringify(found, null, 2)}`);
  const bridge = fs.readFileSync(path.join(REPO, 'mcp/servers/ontology-bridge.js'), 'utf8');
  assert.ok(/handleLocalWrite/.test(bridge), 'the bridge routes writes through the gated dispatch');
  assert.ok(!/L\.(axiomAdd|propose)\s*\(/.test(bridge), 'the bridge no longer calls the local backend directly');
});
