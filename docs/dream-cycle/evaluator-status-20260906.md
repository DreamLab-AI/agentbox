# sovereign-mesh-bridge evaluator: FALLBACK-by-default on annexe nights

Recorded 2026-09-06 (commit d6b8651, deep: sovereign-mesh, slot 2).

## Status

The `sovereign-mesh-bridge` evaluator cannot substantively run in the HP
annexe. `services/nostr-pod-bridge` path-deps the sibling repos
`nostr-rust-forum` and `solid-pod-rs` (`../../../../`), which are absent from
the per-night annexe clone, so cargo aborts during dependency resolution:

    error: failed to load manifest for dependency `nostr-bbs-core`
    Caused by:
      failed to read `~/dream-annexe/nostr-rust-forum/crates/nostr-bbs-core/Cargo.toml`
    Caused by:
      No such file or directory (os error 2)

## Why the receipt still says PASSED

The entrypoint is `cd services/nostr-pod-bridge && cargo build --release 2>&1
| tail -12`. The pipeline's exit status is `tail`'s (0); cargo's failure exit
is masked, so the harness records `outcome=PASSED exit=0` while stdout carries
the cargo error. Identical output reproduced 2026-09-01 through 2026-09-06.
The PASSED is a pipe-masked false positive: as wired, the sovereign-mesh
required gate is vacuous on annexe nights and cannot veto anything.

## Standing rule for annexe nights (deep: sovereign-mesh)

1. Record `sovereign-mesh-bridge` as FALLBACK (vacuous pass) in the nightly
   capability probe. Do not re-derive this; do not treat its PASSED as
   evidence about the bridge crate.
2. Do not evaluate or propose changes to `services/nostr-pod-bridge` or its
   sibling crates (discipline: sibling-path-deps-fenced). Handoff belongs to
   those repositories' own dream cycles.
3. An ACCEPT on a sovereign-mesh annexe night must rest on the other required
   evaluators (dream-engine-tests, hooks-syntax) plus graded receipts, as on
   2026-09-02 and 2026-09-06.

## Deferred fix -- operator decision required

Making the entrypoint honest (e.g. `set -o pipefail`) would, on an annexe
without the sibling repos, fail every candidate and deterministically veto
every ACCEPT (ADR-2024). Do not ship pipefail alone. Pair the fix with one of:

  (a) checking the sibling repos out into the annexe build environment,
  (b) re-slotting the sovereign-mesh deep to an environment that can build it,
  (c) re-classifying this entrypoint as non-required for annexe nights.

Until one of those lands, this file is the source of truth for the status of
the `sovereign-mesh-bridge` evaluator.
