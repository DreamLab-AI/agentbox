---
id: ADR-2121
title: Implement Jev compaction with factrail — fact rails in Rust, baked at a pinned commit
date: 2026-10-02
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: f63760e1976deef544bb08b13bcf3ce30aca578c
verified_paths: [lib/factrail.nix, lib/lockfiles/factrail-57ac25b5.Cargo.lock, lib/claude-code-binary.nix, config/entrypoint-unified.sh, config/claude-plugins/.claude-plugin/marketplace.json, scripts/factrail-store-migrate.mjs, tests/config/factrail-store-migrate.test.mjs, tests/config/factrail-projection.test.sh, schema/agentbox.toml.schema.json]
owner: jjohare
review_trigger: a factrail rev bump in lib/factrail.nix, the end of the post-rebuild residency soak, a Claude Code function-hook API change, or a decision to train a local judge on recorded Jev decisions
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2093 (the decision this implements; amends its implementation, not its policy), ADR-2094 (local-backend fence relaxation, unchanged)
---

# ADR-2121 — Implement Jev compaction with factrail — fact rails in Rust, baked at a pinned commit

## Re-verification — 2026-10-02 at caab741c6 (factrail landing anchor)

Anchored to the landing of ADR-2121 (`b7fc2b0e5`, wording follow-up `caab741c6`). Every governed path above is as verified in ADR-2121's Verification section; nothing else changed. Image build, boot and the residency soak remain unverified (`activation_status: staged`).

## Context

ADR-2093 replaced the compaction summary with Jev decisions through a vendored copy of
`tamaratran/fast-jev-compaction`, which *deletes* every call Jev lets go. Since then
`deadczarvc-labs/jev-factkeep-compaction` and `deadczarvc/hermes-jev-compaction` (both MIT)
published fact rails: reduce instead of delete, keep each result's fact lines, save the full
output. On their blind held-out test the rails kept 50 of 50 pre-registered facts against 4 of
50 for upstream, at the cost of keeping ≈45–50% of tokens instead of 7–10%. Locally,
`min_reduction_ratio = 0.55` papered over the re-arm problem with an estimate that ignored the
fixed system/tool prefix. The estate's rule is Rust for glue and evaluators, and a reusable
port becomes a published crate.

## Decision

ADR-2093's policy (Jev judgement, verbatim, email fenced out, a switch) stands. This record
replaces how it is implemented and the parts of it listed here.

1. **factrail is the implementation.** `DreamLab-AI/factrail` (public, MIT OR Apache-2.0,
   NOTICE credits the three MIT sources) re-implements the judge flow, the fact rails and
   Hermes's pooled fact budget, metadata egress and windowed state in Rust, with a thin
   TypeScript function-hook shim that delegates every decision to the binary over a
   versioned stdin/stdout protocol (factrail `docs/protocol.md`). The vendored
   `config/claude-plugins/jev-compaction` and its two test files are deleted.
2. **One pinned commit, baked.** `lib/factrail.nix` builds the factrail workspace at a full
   40-character `rev` (fetch `hash` pinned, lockfile vendored as
   `lib/lockfiles/factrail-<rev8>.Cargo.lock`, the whole workspace's tests run in the
   build). `flake.nix`, gated on `[features.jev_compaction].enabled`, links the binary at
   `/opt/agentbox/bin/factrail` and bakes the shim into the `agentbox` directory marketplace
   as `config/claude-plugins/factrail`, so shim and binary never disagree on the protocol.
   The plugin's `binary` option is the stable `/opt` path, never a store path.
3. **The gate keeps its name and its fence.** `[features.jev_compaction]` stays the gate
   (E074, W072, the catalogue id unchanged). Its `apply_class` becomes `rebuild`: the binary
   is part of the image. The email taint fence fences the same class and stays sticky per
   session. What a fenced session *gets* changes: on a cloud judge it is compacted by local
   fact rails (`fallback = "rules"`: no model, no network) instead of the built-in summary;
   on a declared-local judge it is judged and reported `ok-local`, as ADR-2094 specifies.
4. **The sticky taint survives the change of plugin.** Claude Code keys a plugin's store by
   `sha256("<name>@<marketplace>")`, so factrail starts with an empty one. At boot, before
   install, `scripts/factrail-store-migrate.mjs` merges every tainted `taint:<session>`
   record and the switch position from jev-compaction's store into factrail's (taint only
   widens; factrail's own switch is never overwritten), then renames the old file
   `.migrated`. It refuses, leaving both files untouched, when either store is unreadable,
   and says so in the boot log.
5. **`min_reduction_ratio` is retired.** factrail sizes the cut from the real context: it
   aims at 5/6 of the trigger with the fixed prefix counted, reduces result by result
   cheapest facts first, and evicts the oldest outputs (saved first) to get under the
   trigger. Only when even eviction cannot reach the trigger does `fallback` apply. The
   schema rejects the key.
6. **New manifest keys**, projected as userConfig: `egress` (`full` | `metadata`),
   `fallback` (`rules` | `summary`), `compaction_timeout_ms`, `save_full_outputs`,
   `record_decisions`. Every projected pair is checked against the userConfig the baked
   plugin declares; an undeclared key is skipped with a log line instead of failing the
   install. An empty manifest value is not projected, so the plugin's default holds.
7. **Egress does not widen.** The judge sees text, tool inputs (capped, or only their shape
   under `egress = "metadata"`) and `ok|error, N chars` for each result, never result
   contents, as ADR-2093 states. Saved outputs and the decision log stay on the machine
   (`~/.cache/factrail/outputs`, `~/.local/share/factrail/decisions`, mode 0600), and the
   decision log is never written for a tainted session.
8. **The retired plugin is removed wherever it is found**, whatever the gate, because two
   compaction plugins on one `session.compact` chain would both act.

## Consequences

- Compaction keeps facts it used to delete, and anything reduced is one `Read` away in a
  saved file. The cost is residency: more context survives each compaction. ADR-2093's
  $14–18 per busy agent-hour was measured for the deleting plugin and does not describe
  this one. **Activation condition:** `activation_status` moves to `live` only after a soak
  that records compactions per hour, post-compaction context size and cache-read spend
  against the 2026-10-01 baseline (42 compactions, median 84k after), plus the binary's
  per-call latency (the shim starts it on every tool call for the taint check, capped at
  5 s).
- Email-tainted sessions stop losing compaction quality: they get local fact rails instead
  of the summary, with nothing sent.
- The switch is `/factrail on|off|status`; `/jev-compact` is gone. Its stored position is
  carried over.
- A factrail change reaches the image only through a `rev` bump in `lib/factrail.nix`
  (hash and lockfile with it). That is the review point for every change to compaction.
- Recorded decisions are the training and evaluation data for a local judge
  (factrail `dataset`, `eval --gate`). Training on Jev's outputs waits on TypeSafe's terms
  and is not part of this decision.
- Publishing factrail's reusable crates to crates.io follows the soak, so the published API
  is one that has run live.

## Verification

At the working tree staged on `68270e953` (before the landing commit and before any rebuild):

- **Pin:** the fetch `hash` was computed as the NAR sha256 of the GitHub tarball for `rev`
  by a serialiser that first reproduced `lib/sidestr-agent.nix`'s pinned hash exactly; the
  vendored lockfile is `git show <rev>:Cargo.lock`. The baked paths (`plugin/.claude-plugin`,
  `plugin/hooks/{hooks.json,factrail.ts,protocol.ts}`, `plugin/README.md`, the licence files
  and NOTICE) exist at `rev`. The dependency graph has no git sources and no OpenSSL (rustls
  on ring). factrail CI at `rev` is green, including a Rust 1.85 job.
- **factrail itself at `rev`:** 191 Rust tests (unit, integration, doc, and end-to-end hook
  protocol tests against the built binary), clippy and rustdoc with warnings as errors, fmt;
  the shim's 50 engine tests, `tsc`, and `claude plugin validate --strict`.
- **Wire compatibility with the façade (ADR-2094):** a request captured from
  `factrail compact --judge systemone` parses and validates with
  `system_one_core::wire::Request::parse` (8 Noul questions), and factrail reads answers as
  `answers[name].noul`, the façade's serialisation of `Answer::Noul`.
- **Store migration:** `node --test tests/config/factrail-store-migrate.test.mjs` → 9
  passed, including that the store name scheme reproduces the two store files on disk. A
  dry run on a copy of the live store carried all 16 tainted sessions.
- **Projection:** `bash tests/config/factrail-projection.test.sh` → 8 passed, including
  that every key the entrypoint projects is declared by the plugin at `rev`.
  `tests/config/jev-config-stamp.test.sh` and `tests/config/boot-projection-contract.test.sh`
  → pass; `bash -n config/entrypoint-unified.sh` → clean.
- **Manifest:** `node scripts/agentbox-config-validate.js agentbox.toml` → valid, the same
  five advisory warnings as before; copies with `min_reduction_ratio`, `egress = "loud"`, or
  `taint_tools` without the email prefix → E016, E016, E074.
  `node scripts/ci/check-manifest-catalogue.js` → pass.
- **Ledger rule:** this record lands `accepted` with its implementation, so it adds nothing
  to the `proposed` backlog; `scripts/adr-ratchet.sh` counts only records added undecided
  (`tests/config/adr-ratchet.test.sh` → 6 passed).
- **Not yet verified:** the image built and booted with the plugin installed, and a live
  `/factrail status` in a fresh session. `activation_status: staged` until then, and `live`
  only after the soak above. `verified_commit` is re-anchored to the landing commit in the
  commit that follows it.
