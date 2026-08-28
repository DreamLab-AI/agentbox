# ADR-064: Bake MetaHarness runtime binaries into the Nix closure (rebuild-apply)

- **Status:** Accepted — implemented and verified live (2026-08-27 rebuild)
- **Date:** 2026-08-27
- **Relates to:** [ADR-063](ADR-063-enable-ruflo-metaharness-plugin.md) (precursor),
  [ADR-067](ADR-067-metaharness-pin-discipline.md) (pins), ADR-039 (apply classes)

## Context

After ADR-063, the plugin's write/execute skills degrade on the offline container:
`metaharness@~0.3.0` is not in the closure and the bundled `@metaharness/darwin@0.7.1`
fails the skills' `~0.8.0` requirement. The plugin scripts now invoke a local
`node <abs-path>` (upstream moved off `npx`) — offline-first invocation is the
upstream posture too.

Separately, ADR-063 leaves a structural skew: pinned CLI (3.32.x) vs boot-cloned
plugin tree (3.38.x HEAD, refreshed every boot).

## Decision

At the next scheduled rebuild:

1. Add two `mkNpmCli` closures to `flake.nix`: `metaharness@~0.3.0` and
   `@metaharness/darwin` at the version satisfying the plugin skills' pin at
   rebuild time (`~0.8.0` today; re-check against the tree being baked).
2. Bump the `rufloPkg` tarball pin to the ruflo release matching the plugin tree
   being relied on, closing the CLI↔plugin skew in the same rebuild.
3. Add a `system-manifest.js` entry with apply class **`rebuild`**.
4. Gate the rebuild on the pin-discipline check ([ADR-067](ADR-067-metaharness-pin-discipline.md)).

## Consequences

- `score/genome/evolve/security-bench` become genuinely offline-functional;
  graceful-degradation paths remain but stop being the steady state.
- Any darwin execution inside the container honours the sandbox rules of
  [ADR-065](ADR-065-dream-darwin-evaluator-liveness.md) and the governance
  boundaries of [ADR-066](ADR-066-metaharness-governance-boundaries.md).
- Note the dream-engine is **not** a consumer of these baked binaries — its darwin
  runs on the HP annexe with HP-supplied packages (ADR-065). Do not assume version
  identity between container-baked and annexe darwin.
