---
id: ADR-2106
title: The sidestr Rust crates are AGPL-3.0-only derivatives of upstream siding, attributed, published to crates.io and consumed by the estate
date: 2026-09-22
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 416a60a437f314b4a6169a61798ba6e0379d816b
verified_paths: [crates/sidestr/*/Cargo.toml, crates/sidestr/*/README.md, crates/sidestr/*/LICENSE]
owner: jjohare
review_trigger: the first `cargo publish` of a `sidestr-*` crate; upstream sidestr relicensing or a dual grant from its author; any proposal to link a `sidestr-*` crate from a permissive crate
repo: agentbox
domain: BASELINE-container
---

# ADR-2106 — The sidestr Rust crates are AGPL-3.0-only derivatives of upstream siding, attributed, published to crates.io and consumed by the estate

## Context

ADR-2096 D2 and PRD-024 D3/S3 planned `sidestr-header`, `sidestr-core`, `sidestr-nostr` and
`sidestr-wallet` as `MIT OR Apache-2.0` clean-room crates written from SPEC prose only,
never from the upstream code. The first seal (ADR-2103, 2026-09-22) showed that none exists
yet, and that the three repositories the reference toolchain is made of (`sidestr/spec`
including `siding`, `bitcoin-desktop/schema`, `bitcoin-blake/blaketestnode`) are all
AGPL-3.0. A clean-room port from prose alone forgoes the reference's tests, fixtures and
the consensus detail that lives only in code (which fields the genesis commits, the
BIP-325 preimage over each header family, the claim and burn rules), which is where the
first seal found ADR-2103's errors. The owner directed on 2026-09-22: where a functional
crate can be published and consumed, do so, with inline docs and proper attribution to
the original code, decided case by case; for sidestr, stick with AGPL-3.0 and consume.

## Decision

1. **Every `sidestr-*` crate is `AGPL-3.0-only`**, `publish = true`, and may be ported from
   the upstream code as a derivative work. `crates/sidestr/` follows the colloquy layout.
   Each crate's manifest, README and crate-level rustdoc state the licence, that it is a
   port of `siding` by Melvin Carvalho (`github.com/sidestr/spec`, AGPL-3.0), the upstream
   commit it was ported from, and what was changed. Upstream test vectors and fixtures may
   be carried with the same attribution. Each crate ships full inline rustdoc and passes
   `cargo doc --no-deps` without warnings before publication.
2. **Publication is asked for case by case.** A crate is published when it is functional
   and the owner approves that publication; `cargo publish` is never run on the owner's
   behalf without that approval. The first candidate is `sidestr-core`.
3. **The estate consumes the published crates from crates.io**, not by path, in any
   repository other than agentbox (the forum precedent, ADR-2085): a consumer that links a
   `sidestr-*` crate is itself AGPL-3.0 in effect and declares it (ADR-2030's rule for
   `nostr-pod-bridge`). No permissive crate on a crates.io path may depend on a
   `sidestr-*` crate. The crates live under `crates/`, never `services/`, so ADR-2030's
   permissive default for `services/` is untouched.
4. **ADR-2096 D2 and PRD-024 D3/S3 are amended:** the words `MIT OR Apache-2.0` and
   "never from the AGPL JS" no longer apply to the sidestr crates; "clean-room" survives
   only as "written by us, attributed, tested against the reference". The separate-works
   rationale of ADR-2096's amendment is withdrawn for these crates; the AGPL section-13
   source offer already required for the modified `siding` covers them without a second
   mechanism.

## Consequences

The port can use upstream's tests, fixtures and code, which is the fastest route to a
validator that agrees with the reference to the tip hash. The crates are less adoptable
outside AGPL projects, which is accepted: the estate is the consumer. `solid-pod-rs`,
should it link `sidestr-core` for `AnchorConfirmer` (ADR-2099), becomes AGPL-3.0 in
effect and its manifest must say so before that edge is added. `docs/licensing.md` gains
a row for `crates/sidestr/`. ADR-2030's review trigger "any services crate gaining an AGPL
dependency" is not fired by this record; a `services/` crate wanting `sidestr-core` fires it.

## Verification

Complete at `fc202907b` (2026-09-22): all four crates published at 0.1.0. `grep -h '^license'
crates/sidestr/*/Cargo.toml` shows only `AGPL-3.0-only`; each `LICENSE` is byte-identical to
the repository root's; every README names the upstream repository, author and the ported
commit (`sidestr/spec@2de40bd`); `RUSTDOCFLAGS=-D warnings cargo doc --no-deps` is clean on
all four; no `Cargo.toml` under `services/` or in a permissive crate names a `sidestr-*`
dependency; each `cargo publish` was run by the session under the owner's standing
approval of 2026-09-22, with wallet and nostr first verified to build and test against
`sidestr-core` 0.1.0 from the registry rather than the worktree.
