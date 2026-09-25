---
id: ADR-2112
title: The sidestr crates live in DreamLab-AI/sidestr-rs; agentbox hosts the chain instance, not the crates
date: 2026-09-23
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 4293e7ed91b84e70915891c1a140558fe54f2580
verified_paths: [crates/sidestr, .github/workflows/sidestr-crates.yml]
owner: jjohare
review_trigger: any file other than the pointer README appearing under crates/sidestr/; an agentbox component taking a path or git dependency on a sidestr-* crate; the Rust sidestr-node or producer landing in agentbox
repo: agentbox
domain: BASELINE-container
---

# ADR-2112 — The sidestr crates live in DreamLab-AI/sidestr-rs; agentbox hosts the chain instance, not the crates

## Context

sidestr-rs — Rust port of Melvin Carvalho's sidestr sidechains, AGPL-3.0-only: the economic
engine for did:nostr agents. A did:nostr key is a sidechain wallet. Its five crates
(`sidestr-header`, `-core`, `-nostr`, `-wallet`, `-round`) were built in agentbox under
`crates/sidestr/` (ADR-2096 D2, ADR-2106) with their own CI (`.github/workflows/sidestr-crates.yml`).
They are general-purpose, published on crates.io, `AGPL-3.0-only`, and have an outside
audience (sidestr's upstream author, other `did:nostr` agent runtimes) that should not have to
clone an agent container to read or contribute to them. Nothing in agentbox links them: the
estate's chain runs on the upstream JS engine through `config/sidechain/run-producer.sh`. On
2026-09-23 the workspace was split out with history to `github.com/DreamLab-AI/sidestr-rs`.

## Decision

1. **The `sidestr-*` crates live in `DreamLab-AI/sidestr-rs`**: source, CI, changelogs, audits
   and releases. Agentbox does not host a copy; `crates/sidestr/` holds only a pointer README.
2. **Agentbox hosts the chain instance, not the crates**: the sealed `sidestr:dreamlab`
   document, the interim producer runner and the mirror sync in `config/sidechain/`
   (ADR-2103), and later the supervised `sidestr-node`/`sidestr-producer` programs.
3. **Agentbox consumes the crates from crates.io only**, never by path or git dependency, on
   ADR-2106 D3's rule, which now applies to agentbox too. A component that links one declares
   `AGPL-3.0-only`.
4. **Amends ADR-2096 D2** ("a new workspace `crates/sidestr/`") and **ADR-2106 D1/D3**
   ("`crates/sidestr/` follows the colloquy layout"; "the crates live under `crates/`"): read
   both as "in sidestr-rs". Licence, attribution, publish-case-by-case and audit-before-publish
   are unchanged.

## Consequences

The crates get a repository whose README, issues and CI are about them, not about the
container. Agentbox loses 43k lines and one workflow. Its CI no longer tests the crates:
sidestr-rs must carry that CI (at the split its remote had none yet, which is follow-on work
there, not here). A change touching both sides (a new estate kind, say) is now two commits in
two repositories, sequenced by a crates.io release. ADR-2099's ratification criterion "the
vocabulary lint passes on `docs/` and `crates/sidestr/`" now reads as `docs/` here plus the
crates in sidestr-rs. The planned internal crates (`sidestr-producer`, `-bridge`, `-mcp`) are
not written yet; this record does not decide where they go.

## Verification

Complete at `4293e7ed9` (2026-09-23), on a worktree of `origin/main` at `36771995a`:
`git ls-files crates/sidestr` returns only `crates/sidestr/README.md`;
`.github/workflows/sidestr-crates.yml` is gone; `grep -rn "crates/sidestr" config/ scripts/
flake.nix lib/ .github/ tests/` returns nothing, so the chain instance, its tests and the
image never referenced the in-tree crates; `grep -rln sidestr services/*/Cargo.toml` is empty,
so no agentbox build links a `sidestr-*` crate. The remaining `crates/sidestr` mentions under
`docs/` are this record, the pointer, amended statements that name the old path as history,
and the research pack's audit and verify receipts, which are transcripts of what was run at
the time and are left verbatim. `github.com/DreamLab-AI/sidestr-rs` is public, default branch
`main`, holding the five crates at sidestr-core 0.2.2, -header 0.2.1, -nostr 0.2.2,
-wallet 0.2.2, -round 0.1.1, all `AGPL-3.0-only`.
