'use strict';
// ontomark step 10 (ontomark/cli-publish): EXP-10 rows AB-P1 to AB-P5 and the caller moves
//
// Run: node --test management-api/tests/ontomark-cli-publish-migration.test.js
//
// Red until the consumer is on ontomark AND the legacy code named by the
// DEPRECATION rows is gone. Reads files and manifests only; never imports
// ontomark, so it runs (and fails by assertion) on a tree that has none.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; }
};
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
/** Source with comment-only lines removed, so prose naming a legacy symbol does not count. */
const code = (rel) => read(rel).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|#)/.test(l)).join('\n');
/** Text of one `[section]` of a Cargo.toml. */
const cargoSection = (rel, name) => {
  let inside = false;
  const out = [];
  for (const line of read(rel).split('\n')) {
    const t = line.trim();
    if (t.startsWith('[')) { inside = t === `[${name}]`; continue; }
    if (inside) out.push(line);
  }
  return out.join('\n');
};

const TAG = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

test('AB-P1: flake.nix pins an ontomark input to a release tag; the VisionClaw vaultSrc pin is gone', () => {
  const flake = code('flake.nix');
  const m = /ontomarkSrc\s*=\s*\{[^}]*url\s*=\s*"github:[^"/]+\/ontomark\/([^"]+)"/.exec(flake);
  assert.ok(m, 'AB-P1: flake.nix has no `ontomarkSrc` input (github:<owner>/ontomark/<tag>)');
  assert.match(m[1], TAG, `AB-P1: ontomarkSrc must be pinned to a release tag, got ${m[1]}`);
  assert.ok(!flake.includes('3213e314f82491f338660c79b77332da6610ed9c'),
    'AB-P1: flake.nix:41-42 still pins vaultSrc to VisionClaw 3213e314 (the D4 adapter takes its own pin)');
  assert.match(flake, /vault[A-Za-z]*AdapterSrc\s*=/, 'AB-P1/D4: flake.nix has no governance adapter input (e.g. vaultAdapterSrc)');
});

test('AB-P2: flake.lock locks ontomarkSrc at the tag and drops the old vaultSrc rev', () => {
  const lock = JSON.parse(read('flake.lock') || '{"nodes":{}}');
  const node = lock.nodes && lock.nodes.ontomarkSrc;
  assert.ok(node, 'AB-P2: flake.lock has no ontomarkSrc node (relock after the flake edit)');
  assert.match((node.original && node.original.ref) || '', TAG, 'AB-P2: ontomarkSrc original.ref must be a release tag');
  assert.ok(!JSON.stringify(lock).includes('3213e314f82491f338660c79b77332da6610ed9c'),
    'AB-P2: flake.lock:263-277 still locks VisionClaw 3213e314');
});

test('AB-P3: lib/ontomark.nix builds ontomark-cli with doCheck on', () => {
  const nix = read('lib/ontomark.nix');
  assert.ok(nix, 'AB-P3: lib/ontomark.nix does not exist');
  assert.match(nix, /ontomark-cli/, 'AB-P3: lib/ontomark.nix must build the ontomark-cli crate');
  assert.match(nix, /doCheck\s*=\s*true/, 'AB-P3: lib/ontomark.nix must keep doCheck = true');
  assert.match(nix, /mainProgram\s*=\s*"ontomark"/, 'AB-P3: lib/ontomark.nix mainProgram must be ontomark');
  assert.ok(!/buildAndTestSubdir\s*=\s*"crates\/vault"[\s\S]*pname\s*=\s*"ontomark/.test(nix), 'AB-P3: ontomark.nix still builds crates/vault');
});

test('AB-P4: the image bakes ontomark and keeps a vault symlink for the adapter', () => {
  const flake = code('flake.nix');
  assert.match(flake, /ln -s \$\{ontomarkPkg\}\/bin\/ontomark \$out\/opt\/agentbox\/bin\/ontomark/,
    'AB-P4: flake.nix:2002-2005 must symlink /opt/agentbox/bin/ontomark');
  assert.match(flake, /ln -s \$\{vault[A-Za-z]*Adapter[A-Za-z]*\}\/bin\/vault \$out\/opt\/agentbox\/bin\/vault/,
    'AB-P4: /opt/agentbox/bin/vault must point at the governance adapter, not the legacy vault package');
  assert.ok(!/vaultPkg\b/.test(flake), 'AB-P4: flake.nix:924-930 still builds the legacy vaultPkg from vaultSrc');
});

test('AB-P5: the boot gate probes ontomark --version and the adapter', () => {
  const entry = read('config/entrypoint-unified.sh');
  assert.match(entry, /\/opt\/agentbox\/bin\/ontomark/, 'AB-P5: entrypoint-unified.sh:1130-1169 Phase 5d(ii) must probe /opt/agentbox/bin/ontomark');
  assert.match(entry, /ontomark[^\n]*--version|--version[^\n]*ontomark/, 'AB-P5: the gate must run `ontomark --version`');
});

test('callers: verbs ontomark owns go to ontomark; propose and apply stay on the vault adapter (D4)', () => {
  const apply = code('management-api/lib/ontology-apply.js');
  assert.match(apply, /ONTOMARK_BIN|ontomarkBin/, 'callers: ontology-apply.js:221,419,478 (find, edit, create) must use an ontomark runner');
  assert.match(apply, /VAULT_BIN|vaultBin/, 'callers: ontology-apply.js:668 (apply) stays on the adapter');
  assert.ok(!/runVault\(\[\s*['"]validate['"]/.test(code('management-api/lib/elevation-stage.js')),
    'callers: elevation-stage.js:200 `validate --strict --json` must run through ontomark');
  const sh = code('skills/ontology-augment/scripts/ontology-augment.sh');
  assert.ok(!/run_vault\s+\w+\s+(retrieve|find)\b/.test(sh), 'callers: ontology-augment.sh:384-421 retrieve/find must use ontomark');
  assert.ok(!/run_vault\s+report\s+validate\b/.test(sh), 'callers: ontology-augment.sh:487 validate must use ontomark');
  assert.match(sh, /run_vault\s+report\s+propose\b/, 'callers: ontology-augment.sh:498 propose stays on the vault adapter');
  assert.match(code('management-api/lib/ontology-propose.js'), /VAULT_BIN/, 'callers: ontology-propose.js:248 propose stays on the vault adapter');
});
