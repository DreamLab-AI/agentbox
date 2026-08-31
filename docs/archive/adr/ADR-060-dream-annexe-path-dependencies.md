# ADR-060: Dream annexe — evaluate workspace / path-dependency repos

- **Status:** Accepted — mechanism built + unit-tested (2026-08-27). Per-repo
  config (agentbox) validated on the live annexe by one `/dream run agentbox`.
- **Date:** 2026-08-26 (built 2026-08-27)
- **Relates to:** [ADR-052](ADR-052-dream-machine-hp-annexe.md) (dream engine + HP annexe),
  the one-week dreaming audit (2026-08-26)

## Context

The one-week audit found **63% of nights INCONCLUSIVE**, concentrated entirely in the
Rust/workspace repos: **agentbox, nostr-rust-forum, solid-pod-rs are 100% inconclusive**,
zero wins. The run log names the cause precisely:

> `annexe clone cannot resolve the sibling path dependencies`

The execution plane (`services/dream-engine/src/dispatch.rs::clone_to_hp`) ships a
**`git archive --format=tar.gz` of the single target repo's HEAD** to the annexe and
extracts it there. A Cargo (or npm/cargo-workspace) member whose `Cargo.toml` declares
`path = "../sibling-crate"` cannot build: the sibling is a *separate* repo on the
workspace root, absent from the single-repo archive. The build step fails → no evaluator
runs → the night is INCONCLUSIVE by construction, every night, until the dry-streak
breaker benches the repo (nostr-rust-forum hit streak 7). This is the **single biggest
lever** in the audit: fixing it flips three repos from unevaluable to evaluable.

## Findings from the build (2026-08-27)

Investigating the actual repos corrected the audit's blanket "path-deps" reading:

- **agentbox** is the genuine external-sibling case: `services/nostr-pod-bridge`
  has Cargo `path`-deps on **nostr-rust-forum** and **solid-pod-rs** (separate
  workspace repos), absent from agentbox's lone archive — so its `sovereign-mesh`
  slot went INCONCLUSIVE 4 nights and parked it. Fixed here: `annexeInclude:
  ["nostr-rust-forum", "solid-pod-rs"]` **plus** a `sovereign-mesh-bridge`
  evaluator (`cargo build` on the bridge) — shipping the siblings alone is inert
  without an evaluator that actually builds against them.
- **solid-pod-rs**'s `../solid-pod-rs-*` deps are **internal `crates/` members**,
  fully inside its own archive — they resolve already; its INCONCLUSIVE cause is
  elsewhere (evaluator), *not* path-deps. No `annexeInclude` needed.
- **nostr-rust-forum** has **no** `../` path-deps; its blocker is the `perf`
  evaluator (`cargo bench -p nostr-bbs-core`), a separate fix.

So the mechanism unblocks agentbox specifically; the other two Rust repos need
per-repo evaluator work, not sibling shipping.

## Decision

Let a repo **declare the sibling paths its build needs**, and ship them alongside it.

1. **Config** — add an optional `annexe_include: Vec<String>` to `DreamConfig` (paths
   relative to the *workspace root*, e.g. `["nostr-bbs-core", "solid-pod-rs"]`).
   Absent ⇒ current behaviour, byte-for-byte (the gate rule: optional features are
   identical-when-off).
2. **Dispatch** — when `annexe_include` is non-empty, `clone_to_hp` archives the target
   repo **and each included sibling**, and extracts them into the annexe under the same
   *relative layout the path-deps expect* (i.e. rooted at a synthetic workspace dir so
   `../sibling` resolves). Each sibling is archived from its own `git archive HEAD`
   (they are separate git repos), keeping the witness-commit discipline per repo.
3. **Fail-fast + legible** — if a build still fails on unresolved path-deps, the night
   records `INCONCLUSIVE` with the finding `unresolved path-deps: <crate>` (per the
   ADR-056/hygiene rule), so the operator sees exactly which sibling to add to
   `annexe_include`, and the dry-streak / duplicate signals can read it.

### Alternatives considered

- **Archive the whole workspace root.** Rejected: the root is not one git repo, mixes
  unrelated repos, bloats the transfer, and muddies the per-repo witness commit.
- **Evaluate in-place (skip the annexe) for local repos.** Rejected here: it breaks the
  ADR-052 pull-nothing/push-work isolation (the annexe holds no estate credentials);
  keep that boundary.

## Consequences

- Unblocks agentbox / nostr-rust-forum / solid-pod-rs — the audit's dead zone — turning
  ~40% of the fleet from 100%-inconclusive into evaluable, which is where the engine
  actually produces wins (cf. `dream-machine`: 9 ACCEPTs when it *can* measure).
- Opt-in and identical-when-off; no change to repos without path-deps.
- **Validation requires the live annexe** (SSH archive → extract → build). Not
  shippable from the container (the DinD/annexe flow is untestable here). Build behind
  this ADR, then run one `--target nostr-rust-forum` cycle and confirm the build resolves
  before enabling it fleet-wide.

## Related fixes already landed (this audit cycle)

- **Ledger hygiene** (compile.rs): findings must be concrete, never "see report" — so
  INCONCLUSIVE blockers like the one above are legible to the signals. (shipped)
- **Fate tokens** (compile.rs): `#N:MERGED` prior-night fates → accurate `zeroMergeStreak`
  and the cockpit pending-merge queue. (shipped)
- **Store INCONCLUSIVE findings** (ruvector.rs): the memory now retains blocker lessons
  at importance 0.4. (in source; activates on rebuild)
- **Pending-merge queue** ([ADR-056](ADR-056-dream-decision-surface.md)): closes the
  promotion loop the audit found open (17 ACCEPTs, ~0 merged). (shipped)
