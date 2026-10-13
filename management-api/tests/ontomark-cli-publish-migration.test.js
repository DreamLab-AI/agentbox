'use strict';
// ontomark step 10 (ontomark/cli-publish): EXP-10 rows AB-P1 to AB-P5 and the caller moves
//
// Run: node --test management-api/tests/ontomark-cli-publish-migration.test.js
//
// Red until agentbox pins, builds, bakes and probes BOTH binaries (D4: the
// ontomark CLI and the thin vault governance adapter) and every caller routes
// by the §2.1 table: ontomark owns validate/build/gate/conflicts/repair/find/
// retrieve/tree/edit/create, the vault adapter owns propose/apply/panel.
//
// Nothing here trusts text: flake.nix and lib/*.nix are lexed (comments gone,
// strings kept apart from structure, shell comments and `: <<EOF` blocks gone
// inside `''` bodies), flake.lock is JSON-parsed and followed through
// root.inputs, the entrypoint gate is lexed and its condition read, JS callers
// are @babel/parser ASTs or are run against stub binaries. Helpers are in
// ./ontomark-migration-lib.js (shared by the five agentbox migration tests).
//
// Not decidable offline, and deliberately not faked here: that the pinned
// VisionClaw rev really holds the thin adapter, and that both derivations
// build. The step's own gate covers those (`nix build` with doCheck, publish
// against a released tag, the agentbox caller tests).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const L = require('./ontomark-migration-lib');

const verbOf = L.argvVerbOf;
const guardOf = (argv) => L.flagValue(argv, '--expect');

function lockNodeFor(inputName) {
  const lock = L.json('flake.lock');
  const nodeName = lock.nodes && lock.nodes.root && lock.nodes.root.inputs && lock.nodes.root.inputs[inputName];
  return { lock, node: typeof nodeName === 'string' ? lock.nodes[nodeName] : null };
}

/** The input and import behind `ln -s ${B}/bin/<x> $out/opt/agentbox/bin/<to>`. */
function linkedPackage(f, to) {
  const link = f.links.find((l) => l.to === to);
  if (!link) return { link: null };
  const imp = f.imports.find((i) => i.binding === link.binding);
  return { link, imp: imp || null, input: imp && imp.src ? f.inputs.get(imp.src) : null, inputName: imp && imp.src };
}

test('AB-P1: flake.nix pins an ontomark input to a release tag that the build actually uses; the VisionClaw vaultSrc pin is gone', () => {
  const problems = L.ontomarkPinProblems();
  assert.deepEqual(problems, [], `AB-P1: ${problems.join('; ')}`);
  const f = L.flake();
  assert.ok(![...f.inputs.values()].some((i) => i.ref === L.LEGACY_VAULT_REV) && !f.strings.some((s) => s.includes(L.LEGACY_VAULT_REV)),
    'AB-P1: flake.nix:41-42 still pins VisionClaw 3213e314 (the D4 adapter takes its own pin)');
});

test('AB-P2: flake.lock resolves the ontomark input to a pinned rev and narHash, and the old vaultSrc rev is gone', () => {
  const f = L.flake();
  const found = [...f.inputs.entries()].find(([, v]) => v.repo === 'ontomark');
  assert.ok(found, 'AB-P2: flake.nix declares no ontomark input to lock');
  const { lock, node } = lockNodeFor(found[0]);
  assert.ok(node, `AB-P2: flake.lock root.inputs has no node for ${found[0]} (relock after the flake edit)`);
  assert.match(node.locked.rev, L.REV40, 'AB-P2: locked.rev must be a 40-hex commit');
  assert.match(node.locked.narHash, /^sha256-/, 'AB-P2: locked.narHash must be a sha256 SRI hash');
  assert.ok(!JSON.stringify(lock).includes(L.LEGACY_VAULT_REV), 'AB-P2: flake.lock:263-277 still locks VisionClaw 3213e314');
});

test('AB-P3: lib/ontomark.nix is a real derivation: buildRustPackage over ontomark-cli, doCheck on, mainProgram ontomark', () => {
  const raw = L.read('lib/ontomark.nix');
  assert.ok(raw, 'AB-P3: lib/ontomark.nix does not exist');
  const { code, strings } = L.lexNix(raw, L.stripShell);
  const str = (tok) => { const m = /^"S(\d+)"$/.exec(String(tok).trim()); return m ? strings[Number(m[1])] : null; };
  assert.match(code, /\bbuildRustPackage\b/, 'AB-P3: lib/ontomark.nix must call rustPlatform.buildRustPackage (comments do not count)');
  assert.match(code, /\bdoCheck\s*=\s*true\s*;/, 'AB-P3: lib/ontomark.nix must keep doCheck = true');
  const main = /\bmainProgram\s*=\s*("S\d+")\s*;/.exec(code);
  assert.ok(main && str(main[1]) === 'ontomark', 'AB-P3: lib/ontomark.nix mainProgram must be "ontomark"');
  const sel = /\b(buildAndTestSubdir|cargoBuildFlags|buildFlags)\s*=\s*([^;]*);/.exec(code);
  const selected = sel ? [...sel[2].matchAll(/"S(\d+)"/g)].map((m) => strings[Number(m[1])]) : [];
  assert.ok(selected.some((s) => /ontomark-cli/.test(s)), 'AB-P3: lib/ontomark.nix must select the ontomark-cli crate (buildAndTestSubdir or cargoBuildFlags -p)');
  assert.ok(!selected.some((s) => /crates\/vault\b/.test(s)), 'AB-P3: lib/ontomark.nix still builds crates/vault');
  assert.match(code, /\bcargoLock\b|\bcargoHash\b/, 'AB-P3: lib/ontomark.nix must build from the crate\'s own lock (cargoLock/cargoHash)');
  assert.match(code, /\bsrc\b/, 'AB-P3: lib/ontomark.nix takes no source');
});

test('AB-P4: the image bakes ontomark and the vault governance adapter, each from its own pinned input, each in the package closure', () => {
  const f = L.flake();
  const onto = linkedPackage(f, 'ontomark');
  assert.ok(onto.link, 'AB-P4: flake.nix:2002-2005 must symlink /opt/agentbox/bin/ontomark (an `ln -s ${pkg}/bin/ontomark ...` in a real build string)');
  assert.ok(onto.imp && onto.input && onto.input.repo === 'ontomark', 'AB-P4: the ontomark symlink must point at the derivation built from the pinned ontomark input');
  assert.ok(f.inClosure(onto.link.binding), 'AB-P4: the ontomark package is linked but never enters the image package list (`++ <list>`)');

  const vault = linkedPackage(f, 'vault');
  assert.ok(vault.link, 'AB-P4: /opt/agentbox/bin/vault must remain (the D4 adapter) and be symlinked');
  assert.ok(vault.imp && vault.input, 'AB-P4: the vault symlink must point at a derivation built from a pinned flake input');
  assert.ok(vault.input.repo !== 'ontomark', 'AB-P4: the vault symlink must be the VisionClaw governance adapter, not ontomark');
  assert.match(vault.input.ref, L.REV40, 'AB-P4: the adapter input must be pinned to a commit');
  assert.notEqual(vault.input.ref, L.LEGACY_VAULT_REV, 'AB-P4: the adapter still sits on the legacy vault pin 3213e314');
  assert.ok(f.inClosure(vault.link.binding), 'AB-P4: the adapter is linked but never enters the image package list');
  assert.notEqual(vault.imp.src, onto.imp.src, 'AB-P4: ontomark and the adapter must not share one source input');
});

test('AB-P3/D4: no derivation the flake imports still carries the legacy vault build (whelk outputHash), and the adapter keeps doCheck', () => {
  const f = L.flake();
  const legacy = [];
  for (const imp of f.imports) {
    const { code, strings } = L.lexNix(L.read(imp.file), L.stripShell);
    if (!code) continue;
    if (strings.some((s) => /^whelk-\d/.test(s))) legacy.push(`${imp.file}: whelk outputHash entry (lib/vault.nix:77)`);
  }
  assert.deepEqual(legacy, [], `AB-P3: the legacy vault derivation is still imported:\n  ${legacy.join('\n  ')}`);
  const vault = linkedPackage(f, 'vault');
  const file = vault.imp && vault.imp.file;
  assert.ok(file, 'AB-P3: no derivation is linked as /opt/agentbox/bin/vault');
  const { code, strings } = L.lexNix(L.read(file), L.stripShell);
  const main = /\bmainProgram\s*=\s*("S\d+")\s*;/.exec(code);
  assert.ok(main && strings[Number(main[1].slice(2, -1))] === 'vault', `AB-P3: ${file} mainProgram must be "vault" (the adapter keeps the binary name for the transition window)`);
  assert.match(code, /\bdoCheck\s*=\s*true\s*;/, `AB-P3: ${file} must keep doCheck = true`);
});

test('AB-P5: the Phase 5d(ii) liveness gate probes `--version` on BOTH /opt/agentbox/bin/ontomark and /opt/agentbox/bin/vault, from a live condition', () => {
  const g = L.bootGateProbes();
  assert.ok(g.found, 'AB-P5: config/entrypoint-unified.sh has no Phase 5d(ii) gate guarded by AGENTBOX_VAULT_ENABLED');
  assert.ok(!g.dead, 'AB-P5: the gate is dead code (`if false`, `[ 0 = 1 ]`)');
  assert.ok(g.probed.has('ontomark'), `AB-P5: entrypoint-unified.sh:1130-1169 must run \`/opt/agentbox/bin/ontomark --version\` in a condition (probed: ${[...g.probed].join(', ') || 'none'})`);
  assert.ok(g.probed.has('vault'), `AB-P5/D4: the gate must also probe the adapter, \`/opt/agentbox/bin/vault --version\` (probed: ${[...g.probed].join(', ') || 'none'})`);
});

test('callers (JS apply path, exercised): edit/find/create go to ontomark, apply stays on the vault adapter', async (t) => {
  const s = await L.applyScenarios(t);
  const owned = (calls) => calls.map(verbOf).filter((v) => L.ONTOMARK_VERBS.has(v));
  const edit = s.promote.ontomark.find((a) => verbOf(a) === 'edit');
  assert.ok(edit, 'callers: ontology-apply.js:419-424 `edit` must run through ontomark; the ontomark stub saw ' + JSON.stringify(s.promote.ontomark.map(verbOf)));
  assert.equal(guardOf(edit), 'docs=1,blocks=2', 'callers: ontomark edit keeps its --expect guard');
  assert.deepEqual(owned(s.promote.vault), [], `callers: ontology-apply.js:221,419 still sends ${owned(s.promote.vault).join(', ')} to the vault binary`);
  const create = s.create.ontomark.find((a) => verbOf(a) === 'create');
  assert.ok(create && guardOf(create) === 'docs=1', 'callers: ontology-apply.js:478 `create --expect docs=1` must run through ontomark');
  assert.deepEqual(owned(s.create.vault), [], `callers: the create path still sends ${owned(s.create.vault).join(', ')} to the vault binary`);
  const apply = s.amend.vault.find((a) => verbOf(a) === 'apply');
  assert.ok(apply && guardOf(apply) === 'docs=1', 'callers: ontology-apply.js:668 `apply --expect docs=1` stays on the vault adapter (D4)');
  assert.deepEqual(s.amend.ontomark.map(verbOf).filter((v) => v === 'apply'), [], 'callers: ontomark must not receive `apply`');
});

test('callers (elevation stage, exercised): validate goes to ontomark, propose stays on the vault adapter', async (t) => {
  const e = await L.elevationScenario(t);
  const leaked = e.vault.map(verbOf).filter((v) => L.ONTOMARK_VERBS.has(v));
  assert.deepEqual(leaked, [], `callers: elevation-stage.js:200 still sends ${leaked.join(', ')} to the vault binary (validate --strict --json must run through ontomark)`);
  assert.ok(e.vault.map(verbOf).includes('propose'), 'callers: `propose` must still reach the vault adapter (D4); the vault stub saw ' + JSON.stringify(e.vault.map(verbOf)));
});

test('callers (propose command): `vault propose` is built for the vault adapter binary, not ontomark', () => {
  const { buildVaultProposeCommand } = require(path.join(L.ROOT, 'management-api', 'lib', 'ontology-propose'));
  const proposal = { action: 'create', preferred_term: 'Photon Sieve', definition: 'x', owl_class: 'PhotonSieve', physicality: 'physical', role: 'component', domain: 'robotics', is_subclass_of: [], relationships: {}, alt_terms: [] };
  const cmd = buildVaultProposeCommand(proposal, { VAULT_BIN: '/opt/adapter/vault-sentinel', ONTOMARK_BIN: '/opt/cli/ontomark-sentinel', AGENTBOX_DID: 'did:nostr:test', AGENTBOX_X_ONLY_PUBKEY_HEX: 'a'.repeat(64) });
  assert.equal(cmd.bin, '/opt/adapter/vault-sentinel', 'callers: ontology-propose.js:248 `propose` must be run by VAULT_BIN (the adapter)');
  assert.equal(cmd.argv[0], 'propose');
});

test('callers (podcast submit-proposals.mjs): find goes to ontomark, propose to the vault adapter, every call site routed', () => {
  const rel = 'skills/podcast-knowledge-ingest/submit-proposals.mjs';
  const bad = L.routingViolations(rel);
  assert.deepEqual(bad, [], `callers: ${bad.join('\n  ')}`);
  const inv = L.toolInvocations(rel);
  assert.ok(inv.some((i) => i.verb === 'find' && i.route === 'ontomark'), 'callers: submit-proposals.mjs:94 `find` must run through ontomark');
  assert.ok(inv.some((i) => i.verb === 'propose' && i.route === 'vault'), 'callers: submit-proposals.mjs:162 `propose` must run through the vault adapter');
});

test('callers (ontology-augment.sh): retrieve/find/tree/validate go to ontomark, propose to the vault adapter, every call site routed', () => {
  const rel = 'skills/ontology-augment/scripts/ontology-augment.sh';
  const r = L.shellRouting(rel);
  const wrong = [
    ...r.vaultCalls.filter((c) => L.ONTOMARK_VERBS.has(c.verb)).map((c) => `${rel}:${c.line} \`${c.name} ${c.verb}\` reaches the vault binary; ontomark owns ${c.verb}`),
    ...r.ontoCalls.filter((c) => L.ADAPTER_VERBS.has(c.verb)).map((c) => `${rel}:${c.line} \`${c.name} ${c.verb}\` reaches ontomark; the vault adapter owns ${c.verb}`),
  ];
  assert.deepEqual(wrong, [], `callers: ${wrong.join('\n  ')}`);
  const onto = new Set(r.ontoCalls.map((c) => c.verb));
  for (const verb of ['find', 'retrieve', 'tree', 'validate']) assert.ok(onto.has(verb), `callers: ontology-augment.sh must call \`${verb}\` through an ontomark function (found ${[...onto].join(', ') || 'none'})`);
  assert.ok(r.vaultCalls.some((c) => c.verb === 'propose'), 'callers: ontology-augment.sh:498 `propose` must still reach the vault adapter');
});

test('wiring: the migration test is in the command CI runs (management-api `test:node`, finding 9)', () => {
  assert.ok(L.wiredIntoTestNode('ontomark-cli-publish-migration.test.js'),
    'management-api/package.json `test:node` must list tests/ontomark-cli-publish-migration.test.js (Jest roots exclude tests/; node --test does not discover it by itself)');
});
