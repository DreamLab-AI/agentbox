---
id: ADR-2096
title: Our own sidestr sidechains are the sole value instrument, built clean-room in Rust with rust-bitcoin accepted
date: 2026-09-21
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
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
   AGPL JS; each README states that. `sidestr-producer`, `sidestr-bridge`, `sidestr-mcp` are
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

Proposed; nothing built. Ratification evidence will be: `cargo test -p sidestr-core` green with
rejecting tests per rule; `sidestr-core` validates the live upstream `sidestr:txbt4-fed` and
`sidestr:gitmark` chains to the JS explorer's tip hash; `cargo doc --no-deps` clean on the four
published crates; `cargo tree -p sidestr-core -p sidestr-header -p sidestr-nostr -p
sidestr-wallet | grep -c -E 'rgb|aluvm'` is zero; solid-pod-rs golden
fixtures (`bitcoin_tx.rs:1113-1210`) byte-identical after the port.
