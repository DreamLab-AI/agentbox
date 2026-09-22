---
id: ADR-2096
title: Our own sidestr sidechains are the sole value instrument, built clean-room in Rust with rust-bitcoin accepted
date: 2026-09-21
decision_status: proposed
implementation_status: partial
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: e1ba33a1c972e15b3b333368544f90bd06d631d9
verified_paths: [crates/sidestr/Cargo.toml, crates/sidestr/*/Cargo.toml, .github/workflows/sidestr-crates.yml]
owner: jjohare
review_trigger: the first ratification review of PRD-024; an upstream sidestr spec release that changes the chain document, kinds or marker grammar; any proposal to add a second value rail
repo: agentbox
domain: BASELINE-container
---

# ADR-2096 — Our own sidestr sidechains are the sole value instrument, built clean-room in Rust with rust-bitcoin accepted

## Context

The estate has a working HTTP 402 economy (sell side `payment-gate.js`, buy side `pay402.js`,
`spend-policy.js`, `consumer-payer.js`, `receipt-minter.js`) whose balance is a JSON Web Ledger
in solid-pod-rs, plus two more unsynced ledgers (host `pay_handler.rs`, forum D1). No rail moves
value: Lightning (PRD-015 C10) was never built, `x402`/`l402` are `payable: false`. Bitcoin tx
construction exists only in solid-pod-rs and hand-rolls BIP-341 on raw k256 (`bitcoin_tx.rs`,
`mrc20.rs`), which the house crypto rule forbids. sidestr (github.com/sidestr/spec, v0.0.1,
2026-09-15, AGPL-3.0, single author, the JSS author) is a Nostr-only Bitcoin-family sidechain:
signed blocks, no subsidy, every coin pegged, rules as signed documents, validated by every
reader. The owner decided on 2026-09-21 that our own sidestr chains are the key and only
instrument and that external assets are bridged in (PRD-024 D0, D3).

## Decision

1. **Our own sidestr sidechains are the only value instrument of the ecosystem.** Value is a
   UTXO on a chain DreamLab signs. No other rail is planned; on-ramps and bridges feed the chain.
2. **The consensus and wallet code is ours, clean-room, in Rust.** A new workspace
   `crates/sidestr/` on the colloquy precedent: `sidestr-header` (both header profiles and
   their PoW hashes, `no_std`-capable, RustCrypto `sha2`/`blake2`, no rust-bitcoin dependency;
   it absorbs the specced-but-unbuilt `b2-consensus` codec of `blake2-experiment/SPEC.md`),
   `sidestr-core` (chain document, block and transaction validation on rust-bitcoin, sidestr
   overlay rules, records codec), `sidestr-nostr` (kinds and event codecs, own NIP-01 structs),
   `sidestr-wallet` (folds, coin selection, key-path spends) are `MIT OR Apache-2.0`,
   `publish = true`, written from SPEC prose and the catalogued wire formats, never from the
   AGPL JS; each README states that. **Amended by ADR-2106 (owner decision 2026-09-22):
   the four crates are `AGPL-3.0-only` derivatives of upstream `siding`, attributed and
   ported from its code and tests, published case by case and consumed from crates.io;
   the permissive grant and the prose-only clean-room constraint are withdrawn for them.**
   `sidestr-producer`, `sidestr-bridge`, `sidestr-mcp` are
   internal (`publish = false`). ADR-2030 applies. The "no `bitcoin` crate" policy of the
   b2mine spec holds for headers and PoW only; D3's rust-bitcoin acceptance governs
   transactions, scripts, sighash and taproot.
3. **rust-bitcoin and secp256k1 are accepted estate-wide.** The "k256-only, zero-rust-bitcoin-
   dep posture" (host ADR-124 §2.2, solid-pod-rs `bitcoin_tx.rs:24`) is retired. solid-pod-rs
   ports `bitcoin_tx.rs` and `mrc20.rs` to rust-bitcoin first, golden fixtures byte-identical
   (solid-pod-rs ADR-2008). Schnorr signing is libsecp256k1 BIP-340 verified against the
   published vectors; nothing hand-rolls a primitive or a sighash.
4. **The upstream AGPL JS `siding` runs only as a container-internal supervised program**
   (`[program:sidestr-producer]`, P0 to P2) until the Rust producer validates the same
   1,000-block range to the same tip hash. It is never linked by a published crate.
5. **Excluded from every chain document we seal:** the `evm` rule (PRD-015 C11 stands), the
   `pool` rule (solid-pod-rs's live AMM remains the exchange surface), the `desk` rule (paused
   upstream). `sidestr-core` does not implement those overlays.
6. **Custody is stated honestly per chain.** The root is a level-2 k-of-n federation of our own
   instances and is custodial; children are level 1, custodied by the root signers. The chain
   document's `comment` says so. Level 3 (rotation, recovery) is declared future work.

## Consequences

Every balance in the estate becomes a fold over chain UTXOs (ADR-2099) and every spend passes
the settlement gate (ADR-2100). solid-pod-rs gains rust-bitcoin as a dependency and loses its
hand-rolled sighash; VisionClaw's separate payment store is deleted (host ADR-2111). The estate
takes on a moving upstream spec; the mitigation is that consensus code is ours and fixture-
pinned. The federation is a real operational commitment: below threshold, the chain halts for
everyone. Running the upstream code as a separate program supports the argument that our
crates are separate works; it does **not** discharge the AGPL programme's own obligations. The
licence boundary is now recorded in canon (it was not before).

### Amendments after independent adversarial review (GPT-6 Astra, 2026-09-21)

- **AGPL compliance is a plan, not a sidecar.** Upstream is `AGPL-3.0-or-later`. The
  `headerProfile` overlay patch makes us a modifier, so section 13 applies: a source offer to
  remote users of the modified `siding`, and conveyance terms for any container that ships it.
  An inventory (producer, schema engine, explorer, fixtures, modifications), the source-offer
  mechanism and the separate-works rationale are P0 deliverables. `rgb-lib` is MIT; its locked
  dependency graph is reviewed, not assumed.
- **Clean-room needs evidence.** The published crates are written from SPEC prose and the
  wire-format catalogue; no upstream implementation expression, test code or fixture text is
  copied; provenance (who read what) is recorded per crate; counsel reviews the workflow.
- **A local protocol profile is normative.** When upstream prose, fixtures and code disagree,
  the estate's versioned protocol profile (ADR-2103) decides; our chains declare it and refuse
  validators that lack it.
- **The AMM is parked, not decided (owner decision 2026-09-21).** A central ledger cannot debit
  user-authorised UTXOs, so the pod AMM cannot survive P2 unchanged; the owner intends to
  inherit upstream's next AMM from JSS rather than rebuild the pod one. Until that lands the
  pod order book and AMM stay routed as-is on the legacy ledger and are excluded from the
  chain-settled surface. Decision 5's "remains the exchange surface" is narrowed to "remains
  routed on the legacy ledger until superseded".
- **"Validate 1,000 blocks to the same tip" is a parity check, not readiness.** Production
  readiness additionally requires invalid-block rejection vectors, adversarial scheduling,
  safe-signing and recovery tests (ADR-2101).

## Verification

**Partial (2026-09-22):** the four crates exist under `crates/sidestr/` and are published at
0.1.0 as AGPL-3.0-only attributed ports (ADR-2106 amends the licence): `cargo test` green
across the workspace with accept-and-reject tests per rule; `sidestr-core` replays the sealed
`sidestr:dreamlab` genesis, reproduces a throwaway genesis byte for byte and cross-validates
block 1 with the reference both ways; `sidestr-wallet`'s spend and burn are mined by both
engines; `sidestr-nostr`'s eleven oracle events are byte-identical to the reference's;
`cargo doc --no-deps` with warnings as errors is clean; `cargo tree` over the four shows no
`rgb` or `aluvm`. **0.2.0 (same day, `74254cc42`, audited anti-fox by GPT-6 Astra with
five counter-examples fixed before release):** core is generic over the header family and
`sidestr-header` implements its trait, so the BLAKE2b arm replays the live `sidestr:txbt4-siding`
and `sidestr:melchain` chains from genesis to their announced tips with every rule on (S1 for
those chains; `txbt4-fed` and `gitmark` carry rules D5 excludes and are refused by design);
level 2's pure parts (federation derivation, partial signatures, witness assembly, a
script-path verifier for the `multi_a` template, federated genesis) are in core, byte-identical
to siding's for a 2-of-3 genesis; the parent view is behind an RPC trait with a read-only live
test on the estate node. **0.2.1 and `sidestr-round` 0.1.0 (2026-09-22 evening):** three
more independent passes (GPT-6 Astra; `docs/proposals/sovereign-settlement-research/AUDIT-sidestr-core-0.2.1-*`,
`AUDIT-sidestr-round-0.1-*`, `VERIFY-sidestr-0.2.1-round-0.1-receipts-*`) found and the
producers fixed: burns whose marker needs `OP_PUSHDATA1` were validated but never recorded and
a malformed one was accepted where the reference refuses the block (chain split); the
reference's `TextDecoder` drops a leading byte-order mark at five text-decode sites and Rust
kept it (a recorded burn there, nothing here); two unchecked encoder domains and a wallet
marker bound; in the round, a torn journal tail swallowed the next vote, the never-re-sign
option did not cover peg-out self-proposals, no TLS backend was compiled so `wss://` relays
were unreachable, timing was second-quantised, intent was journalled after signing, the mirror
served unindexed bytes, and finally a failed append rolled the journal back to a cached length
(the cosign node itself held two handles on one file). Every finding is a regression test
under `tests/audit_regressions*.rs`; ten adversarial blocks from the JS engine replay in Rust
with identical derived lists except the documented strict record-length departure; a Rust
signer co-signs with Melvin's JS signers live in both arrangements and both peg-out
directions. `sidestr-round` is upstream's level-2 protocol, availability-tolerant, with the
BFT redesign of ADR-2101's consultant review a later crate. Not yet: the solid-pod-rs port. Ratification evidence remains: `cargo test -p sidestr-core` green with
rejecting tests per rule; `sidestr-core` validates the live upstream `sidestr:txbt4-fed` and
`sidestr:gitmark` chains to the JS explorer's tip hash; `cargo doc --no-deps` clean on the four
published crates; `cargo tree -p sidestr-core -p sidestr-header -p sidestr-nostr -p
sidestr-wallet | grep -c -E 'rgb|aluvm'` is zero; solid-pod-rs golden
fixtures (`bitcoin_tx.rs:1113-1210`) byte-identical after the port.

## Re-verification — 2026-09-22 at e1ba33a1c

Governed paths changed since `416a60a43` by two commits, both documentation: `4ed9433b0`
(the round crate's docs build without the `relay` feature; the workflow documents both
feature sets) and `e0712bf71` (the inline-docs sweep: docs.rs metadata, `deny(missing_docs)`,
changelogs, patch bumps to sidestr-core 0.2.2, -header 0.2.1, -nostr 0.2.2, -wallet 0.2.2,
-round 0.1.1, every earlier version yanked). No dependency, licence or consensus change; the
decision and its partial implementation status stand.
