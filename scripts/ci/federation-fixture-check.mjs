#!/usr/bin/env node
// scripts/ci/federation-fixture-check.mjs
//
// The CI-runnable half of the ADR-2025 cross-repo identifier contract.
//
// `tests/fixtures/federation-identity.v1.json` is the VERSIONED, two-language
// fixture: it pins the input byte encoding, the serialisation, the exact address
// grammar, the supported kinds, elevation and the explicit unmapped outcomes.
// This script checks the AGENTBOX (JavaScript) side of it. The same file is
// meant to be executed by VisionClaw's Rust pipeline against `src/uri/mod.rs` —
// the fixture carries `expected_rust` for every crossing so the two pipelines
// assert the same table rather than two tables that happen to agree.
//
// The estate review's finding was not that the helpers disagreed on the hash —
// they agree — but that a shared name and a copied comment were being read as a
// shared CONTRACT across three separate properties (bytes, grammar, kind map),
// with no gate running in either repository. This is that gate for one side.
//
// Usage:
//   node scripts/ci/federation-fixture-check.mjs            # human output
//   node scripts/ci/federation-fixture-check.mjs --json     # machine output
// Exit 0 when every expectation holds; non-zero with the divergences named.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = join(__dirname, '..', '..');

const FIXTURE = join(REPO_DIR, 'tests', 'fixtures', 'federation-identity.v1.json');
const bridge = require(join(REPO_DIR, 'management-api', 'lib', 'bc20-provenance-bridge.js'));

const ADDRESS_RE = /^sha256-12-[0-9a-f]{12}$/;
const SCOPE_RE = /^[0-9a-f]{64}$/;

const failures = [];
const checks = [];

function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  if (!ok) failures.push(`${name}: ${detail}`);
}

const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'));
if (fx.schema !== 'agentbox/federation-identity-fixture@1') {
  console.error(`unexpected fixture schema: ${fx.schema}`);
  process.exit(2);
}

// ── 1. content address: same bytes in, same twelve lowercase hex out ─────────
for (const c of fx.content_address) {
  const got = bridge.sha12(c.input);
  check(`content-address/${c.name}`, got === c.expected, `got ${got}, expected ${c.expected}`);
  check(`content-address/${c.name}/grammar`, ADDRESS_RE.test(got), `${got} violates ^sha256-12-[0-9a-f]{12}$`);
}
// The Unicode pair is a CONTRACT, not an accident: the two forms must differ.
{
  const nfc = fx.content_address.find((c) => c.name === 'unicode-nfc');
  const nfd = fx.content_address.find((c) => c.name === 'unicode-nfd');
  if (nfc && nfd) {
    check('content-address/no-normalisation',
      bridge.sha12(nfc.input) !== bridge.sha12(nfd.input),
      'composed and decomposed forms produced the SAME address — one side has started normalising, which silently re-identifies existing records');
  }
}

// ── 2. crossings: mapped, unmapped and divergent are all asserted ───────────
for (const c of fx.crossing) {
  const out = bridge.toVisionclaw(c.agentbox_urn, { ...(c.options || {}), onDrop: () => {} });
  const got = out ? out.visionclaw_id : null;
  if (c.status === 'unmapped') {
    check(`crossing/${c.kind}/unmapped`, got === null,
      `expected an explicit unmapped result, got ${got} — a fabricated identity is worse than a refusal`);
    continue;
  }
  check(`crossing/${c.kind}/${c.status}`, got === c.expected, `got ${got}, expected ${c.expected}`);
  if (out && out.mapping) {
    check(`crossing/${c.kind}/mapping-recoverable`,
      out.mapping.agentbox_urn === c.agentbox_urn && !!out.mapping.visionclaw_urn,
      'the crossing did not return a recoverable mapping record');
  }
}

// ── 3. precomputed address admission — grammar, not prefix ──────────────────
// The review found the Rust constructor/parser accepting an empty suffix, a
// non-hex suffix and an overlong uppercase suffix because it checked only the
// `sha256-12-` prefix. This asserts the GRAMMAR both sides advertise.
for (const c of fx.precomputed_address_admission) {
  const accepted = ADDRESS_RE.test(c.address);
  check(`address-admission/${c.name}`, accepted === c.accept,
    `${c.address} was ${accepted ? 'accepted' : 'rejected'}, expected ${c.accept ? 'accepted' : 'rejected'}`);
}
for (const c of fx.owner_scope_admission) {
  const accepted = SCOPE_RE.test(c.scope);
  check(`scope-admission/${c.name}`, accepted === c.accept,
    `scope was ${accepted ? 'accepted' : 'rejected'}, expected ${c.accept ? 'accepted' : 'rejected'}`);
}

// ── 4. the kind map is the fixture's, not an independent list ───────────────
{
  const declared = Object.keys(bridge.AGENTBOX_TO_VISIONCLAW).sort();
  const inFixture = [...new Set(fx.crossing.map((c) => c.kind))].filter((k) => k !== 'agent').sort();
  const missing = inFixture.filter((k) => !declared.includes(k));
  check('kind-map/fixture-kinds-are-declared', missing.length === 0,
    `kinds in the fixture but absent from the bridge map: ${missing.join(', ')}`);
  const untested = declared.filter((k) => !inFixture.includes(k));
  check('kind-map/every-declared-kind-is-tested', untested.length === 0,
    `kinds the bridge maps but the fixture never exercises: ${untested.join(', ')} — extend the fixture before shipping a new kind`);
}

const result = {
  schema: 'agentbox/federation-fixture-check@1',
  adr: 'ADR-2025',
  fixture_version: fx.version,
  ran_at: new Date().toISOString(),
  side: 'agentbox-javascript',
  checks_run: checks.length,
  failures,
  pass: failures.length === 0,
  // Stated honestly: this gate covers one side. The contract is only closed
  // when the Rust pipeline runs the same file.
  rust_side_status: 'NOT RUN HERE — VisionClaw CI must execute this fixture against src/uri/mod.rs; the bead row is divergent pending ADR-2061',
};

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} else {
  process.stdout.write(`\nFederation identifier fixture (v${fx.version}) — agentbox side: ${result.pass ? 'PASS' : 'FAIL'}\n`);
  process.stdout.write(`  ${checks.length} checks run\n`);
  for (const f of failures) process.stdout.write(`  FAIL: ${f}\n`);
  process.stdout.write(`  note: ${result.rust_side_status}\n\n`);
}
process.exit(result.pass ? 0 : 1);
