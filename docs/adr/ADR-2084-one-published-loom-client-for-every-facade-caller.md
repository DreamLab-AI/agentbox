---
id: ADR-2084
title: One published loom-client for every façade caller
date: 2026-09-13
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 62e1657fcd7237e6ff0c08464717459e7a45c3ee
verified_paths: [services/dream-engine/src/llm.rs, services/podcast-ingest/src/ingest/loom.rs, services/podcast-ingest/src/promote/loom.rs, services/explainer-tools/src/bin/loom_draft.rs, lib/explainer-tools.nix]
owner: jjohare
review_trigger: the Loom façade changes its request or telemetry contract, or a fifth caller appears
repo: agentbox
---

# ADR-2084 — One published loom-client for every façade caller

## Context

Four callers of the Ontology Loom façade grew up independently: `dream-engine/src/llm.rs`,
both `podcast-ingest` Loom modules, and `skills/explainer/scripts/loom-draft.mjs` in
JavaScript. Each hand-rolled `/v1/chat/completions` and each had learned a different subset
of the same lessons. Only dream-engine knew a façade can answer HTTP 200 with ontology prose
and never call the model; only loom-draft knew about truncation retries and the ADR-139
passthrough assertion; none of the Rust callers floored `max_tokens`, so any of them could
have asked a reasoning model for 400 tokens and got empty content back as a success.

The façade's two per-request switches were also being conflated. `loom_options.verbatim` and
`loom_options.scaffold` are independent controls, and three callers sent only the first.

## Decision

Every caller of a Loom façade uses the `loom-client` crate, published to crates.io under
MIT OR Apache-2.0 from the `loom` repository. Hand-rolled `/v1/chat/completions` request
construction against a façade is prohibited.

The crate owns four things no caller reimplements: the `max_tokens` floor for reasoning
models, truncation retry on a doubled budget, the refusal of scaffold-only responses, and
the passthrough assertion. `LoomOptions` exposes `verbatim` and `scaffold` as separate
constructors — `declining_verbatim()` for a subject the ontology covers, `passthrough()`
for one it does not — so the choice is made explicitly rather than by copying a neighbour.

A façade that reports no `loom` telemetry is treated as passthrough by nature, so the crate
works unchanged against a bare OpenAI-compatible server.

## Consequences

The `loom` repository is relicensed from AGPL-3.0-only to MIT OR Apache-2.0, which is what
made publication possible. `deny.toml` now enforces the RocksDB Apache-2.0 election rather
than merely permitting either branch, so a future copyleft dependency fails CI.

`skills/explainer/scripts/loom-draft.mjs` is deleted; `explainer-loom-draft` in the new
`services/explainer-tools` crate replaces it, and the explainer skill no longer needs `node`
on that path. Three callers gained behaviour they did not have: the token floor everywhere,
truncation retries in the podcast and dream paths, and the scaffold-only refusal in the
podcast paths.

The cost is a crates.io release cadence for a protocol that changes with the façade. The
`review_trigger` above exists for that: a contract change means a new `loom-client` version
before consumers can follow.

## Verification

`cargo deny check licenses` passes against the narrowed policy at `loom` commit `96c4dc2`.
`loom-client` 0.1.0 is published and carries 51 tests (24 unit, 8 doctest, 19 wire-level
against a mock façade), clippy pedantic clean, `cargo doc -D warnings` clean.

In agentbox: `cargo test` gives 155 passing in `dream-engine`, 117 in `podcast-ingest`
(previously 113 passing with 1 failing — `ingest::loom::tests::strips_trailing_v1` asserted
the opposite of its own name and was red on main), and 18 in `explainer-tools` including six
end-to-end tests that run the built binary against a mock façade. `skills/lint-skills.sh`
reports the estate clean at 129 skills, 0 warnings.
