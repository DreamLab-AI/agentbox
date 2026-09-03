---
id: ADR-2030
title: Publishable service crates are MIT OR Apache-2.0 inside the AGPL-3.0 repository
date: 2026-09-03
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 169602a07511ee5f708a7b793545a2e095bce61e
verified_paths: [services, docs/developer/licensing.md]
owner: jjohare
review_trigger: any new crate under services/, any services crate gaining an AGPL dependency, or first publication of a services crate to crates.io
repo: agentbox
---

# ADR-2030 — Publishable service crates are MIT OR Apache-2.0 inside the AGPL-3.0 repository

## Context
ADR-016 (archive) made the repository AGPL-3.0-only end to end because every
first-party component was aggregated into one hosted service. The 2026-09
Python-to-Rust programme produced ten Rust crates under `services/` that are
self-contained Cargo workspaces, several of them clean-room and reusable
(prose-sanitiser, diagram-ir, the CPython-byte-shape JSON emitter, the
WebCrypto envelope). The operator's standing rule is that such modules are
published to crates.io, where AGPL library crates see little adoption. Every
manifest under `services/` already declares `MIT OR Apache-2.0`; the repo
root `LICENSE` is AGPL-3.0; the two grants were flagged as contradictory by
three workers and by the Codex adversarial review (finding 9). The copyright
holder resolved it on 2026-09-03: the crates, and this code, may be fully
open and permissive without changing the containing repository's licence.

## Decision
Code under `services/` is licensed `MIT OR Apache-2.0` by its own manifests
and the `LICENSE-MIT` / `LICENSE-APACHE` texts in each workspace; the rest
of the repository remains AGPL-3.0-only under the root `LICENSE`. The
permissive grant is per crate and travels with the crate on crates.io. An
AGPL-3.0 repository may contain permissively licensed subtrees; the AGPL
governs the aggregate hosted service, not the licence of each part. A
`services/` crate that links an AGPL-licensed library (today
`nostr-pod-bridge`, which links `solid-pod-rs-nostr`) is not permissive in
effect and must declare `AGPL-3.0-only` in its manifest rather than
advertise a grant it cannot give. Contributions to `services/` are accepted
under the same permissive terms.

## Consequences
The four prose-sanitiser publication candidates and the other reusable
crates can be published without a relicensing exercise. `licensing.md`
gains a subtree row and the dual grant must be stated in every crate
README. Adding an AGPL dependency to a permissive crate is a licence change
and needs this record re-reviewed. ADR-016's "uniformly AGPL-3.0" statement
is amended by this record; the archive copy is not edited.

## Verification
`grep -h '^license' services/*/Cargo.toml services/*/crates/*/Cargo.toml`
shows `MIT OR Apache-2.0` on every crate except `nostr-pod-bridge`
(`AGPL-3.0-only`, set by this change). `services/LICENSING-NOTICE.md` and
`docs/developer/licensing.md` describe the split. Verified at the commit
that lands this record.
