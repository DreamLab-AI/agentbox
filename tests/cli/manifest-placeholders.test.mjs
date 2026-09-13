// Every `${VAR}` the manifest carries must be a variable the container is
// actually given.
//
// agentbox.toml holds placeholders rather than estate addresses, because this
// repository is public. Nothing in the image expands them: the Docker image's
// Env entries are literal strings, and supervisord does not do shell expansion
// in `environment=`. So a placeholder naming a variable that compose never
// passes in cannot ever resolve, and the literal text gets used where a URL or
// a hostname belongs — which is how a running dream engine ended up with
// LOOM_URL set to the seventeen characters "${LOOM_BASE_URL}".
//
// This is a static gate: it needs no running container, and it fails the moment
// someone generalises an address out of the repo without wiring the variable in.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(`${root}${p}`, 'utf8');

/** Manifest values that are ENTIRELY a `${VAR}` placeholder, with their keys. */
function manifestPlaceholders(toml) {
  const found = [];
  toml.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"\$\{([A-Z0-9_]+)\}"/);
    if (m) found.push({ key: m[1], variable: m[2], line: i + 1 });
  });
  return found;
}

/** Variables the compose file passes into the agentbox container. */
function composeProvides(compose) {
  const provided = new Set();
  for (const line of compose.split('\n')) {
    const m = line.match(/^\s*-\s*([A-Z0-9_]+)=/);
    if (m) provided.add(m[1]);
  }
  return provided;
}

test('every manifest placeholder names a variable compose passes in', () => {
  const placeholders = manifestPlaceholders(read('agentbox.toml'));
  assert.ok(placeholders.length > 0, 'expected the manifest to carry placeholders');

  const provided = composeProvides(read('docker-compose.yml'));
  const orphans = placeholders.filter((p) => !provided.has(p.variable));

  assert.deepEqual(
    orphans,
    [],
    `agentbox.toml references ${orphans.map((o) => `\${${o.variable}}`).join(', ')} ` +
      `but docker-compose.yml never passes ${orphans.length === 1 ? 'it' : 'them'} into the ` +
      `container, so the literal reaches the consumer. Add ` +
      `${orphans.map((o) => `- ${o.variable}=\${${o.variable}:-}`).join(', ')} to the ` +
      `agentbox service's environment.`,
  );
});

test('the flake never emits a bare placeholder as a value', () => {
  // A supervisor or image-Env line that interpolates a manifest value straight
  // into the config must go through `unplaceheld`, which maps an unexpanded
  // placeholder to empty so the consumer's own default applies.
  const flake = read('flake.nix');

  // The two settings this actually bit. Both must be guarded.
  for (const guarded of [
    'ONTOLOGY_CONDENSE_ENDPOINT=${unplaceheld',
    'dreamLoomEnv',
  ]) {
    assert.ok(
      flake.includes(guarded),
      `flake.nix no longer guards ${guarded} — a manifest placeholder can reach the runtime again`,
    );
  }

  // And nothing may hard-code the literal placeholder as a fallback value, the
  // shape that produced LOOM_URL="${LOOM_BASE_URL}".
  const literalFallback = /or\s+"\\\$\{[A-Z0-9_]+\}"/.exec(flake);
  assert.equal(
    literalFallback,
    null,
    `flake.nix falls back to the literal ${literalFallback?.[0]} instead of leaving the value unset`,
  );
});
