import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import TOML from '@iarna/toml';

const root = new URL('../../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), 'utf8');
const toml = p => TOML.parse(read(p));
const field = (text, name) => {
  const match = text.match(new RegExp(`^\\s*${name}\\s*=\\s*"([^"]+)"`, 'm'));
  assert.ok(match, `missing Nix field ${name}`);
  return match[1];
};
const server = read('lib/solid-pod-rs.nix');
const bridge = read('lib/nostr-pod-bridge.nix');
const version = field(server, 'version');

function assertSecurityFloor(candidate) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-alpha\.(\d+))?$/.exec(candidate);
  assert.ok(m, `review security floor for version ${candidate}`);
  const [, major, minor, patch, alpha] = m;
  assert.ok(+major > 0 || +minor > 5 || (+minor === 5 && (+patch > 0 || alpha === undefined || +alpha >= 13)), candidate);
}

test('the server stays at or above the ER-22 security release', () => {
  assertSecurityFloor(version);
});

test('the server and bridge fetch the same immutable upstream snapshot', () => {
  assert.match(field(server, 'rev'), /^[a-f0-9]{40}$/);
  assert.equal(field(server, 'rev'), field(bridge, 'solidRev'));
  assert.equal(field(server, 'srcHash'), field(bridge, 'solidHash'));
});

test('vendored and bridge path packages resolve the server release', () => {
  const packages = toml('lib/solid-pod-rs.cargo-lock').package.filter(p => p.name.startsWith('solid-pod-rs'));
  assert.ok(packages.length > 0);
  for (const p of packages) assert.equal(p.version, version, p.name);
  const paths = toml('services/nostr-pod-bridge/Cargo.lock').package.filter(p => !p.source && ['solid-pod-rs', 'solid-pod-rs-nostr'].includes(p.name));
  assert.equal(paths.length, 2);
  for (const p of paths) assert.equal(p.version, version, p.name);
});

test('dream-engine manifest and lockfile agree on the patched dependency chain', () => {
  const manifest = toml('services/dream-engine/Cargo.toml');
  const packages = toml('services/dream-engine/Cargo.lock').package;
  const core = packages.find(p => p.name === 'nostr-bbs-core');
  assert.equal(manifest.dependencies['nostr-bbs-core'], `=${core.version}`);
  const pods = packages.filter(p => p.name === 'solid-pod-rs');
  assert.equal(pods.length, 1);
  // This is a registry library owned by nostr-bbs-core, not the server or
  // relay path dependency. Its independently pinned release must be secure,
  // but does not have to track new forge-only server releases in lockstep.
  assertSecurityFloor(pods[0].version);
});
