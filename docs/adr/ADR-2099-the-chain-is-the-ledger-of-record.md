---
id: ADR-2099
title: The chain is the ledger of record; a balance is a UTXO fold, every existing ledger is a derived view, and the blocktrail txo seam opens onto the gitmark provenance chain
date: 2026-09-21
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: the three-ledger equality test first passing; AnchorConfirmer landing against sidestr-node; any proposal to reintroduce a credit path that is not a peg-in claim
repo: agentbox
domain: BASELINE-container
---

# ADR-2099 — The chain is the ledger of record; a balance is a UTXO fold, every existing ledger is a derived view, and the blocktrail txo seam opens onto the gitmark provenance chain

## Context

Three independent `did:nostr`-keyed sats ledgers exist and none is synced: solid-pod-rs
`StoragePaymentStore` (the most built; MRC20 and TXO deposits, order book, AMM), the host's
`FsPaymentStore` in `src/handlers/pay_handler.rs` (its `.deposit` is a 501 stub, so no value
ever entered it) and the forum's D1 adapter (`pod-worker/src/payments.rs`). The pod ledger is
credited by a trusted write (PRD-015 C12 gap). The blocktrail `txo[]` that ADR-033 reserved as
the single-use-anchor seam is constructed empty in `services/nostr-pod-bridge/src/contract.rs:139`.
Host ADR-124 §2.3 forbids the phrase "single-use seal" until a spent-exactly-once check exists;
`AnchorConfirmer` has only test doubles. The owner decided "the chain is truth" (PRD-024 D4).

## Decision

1. **A `did:nostr` balance is a fold**, never a stored number: `balance(did)` sums the UTXOs
   whose script is `0x5120 ‖ xonly(k_spend(chain))` across the root chain and the principal's
   live child chains; `holdings(did)` folds `tally:` records for wrapped assets. There is no
   wallet object.
2. **Every existing ledger becomes a derived, height-stamped view.** solid-pod-rs `WebLedger`
   reads through `sidestr-node`, with a bounded cache and a staleness bound that is an error,
   not a slightly old number (solid-pod-rs ADR-2008). The forum D1 adapter becomes a view
   (forum ADR-2012); it is the only one of the three that debits atomically
   (`debit_atomic`, a single-statement `UPDATE … WHERE balance >= cost`), and the chain
   replaces that atomicity with consensus ordering, which is a change in mechanism, not a
   loss of the property. The host's `FsPaymentStore` and `/pay/*` handler are deleted and replaced
   by a proxy to `/v1/wallet/*` (host ADR-2111). No code path may spend, credit, debit or gate
   on a view without resolving to the chain.
3. **The only creation of base supply is a peg-in claim; the only destruction is a burn**
   (ordinary transfers and wrapped issuance under the `bridge` rule move or create asset
   units, never sats). In the pod and forum views, the only credit path is a chain event. `WebLedger::credit`
   and `debit` leave the public API; the TXO stand-in deposit path (`pay.rs:498-519`, "Phase 0:
   deterministic stand-in" in the code, a "free-money oracle" in the R3 audit) is deleted, not
   left default-off.
4. **Both solid-pod-rs consumers move to one post-port version together**; the version skew
   (host 0.4.0-alpha.15, forum 0.5.0-alpha.7) is a P1 exit criterion.
5. **The blocktrail `txo[]` is populated per epoch from the anchor outpoint on
   `sidestr:gitmark`**, the estate's own provenance chain, which the `checkpoints` rule
   anchors into the configured parent. Provenance stays off the value chain deliberately: the
   estate runs three kinds of chain (the value root, the gitmark provenance chain, ephemeral
   children). `[sidechain].gitmark.mode = "consume" | "operate"` records whether we validate
   the upstream-signed gitmark or hold a signer key on it. On a chain we validate in full an
   anchor's spent status is exact, so `states.len() == txo.len()` (`trail.rs:199-201`) becomes
   checkable. `AnchorConfirmer` is implemented against `sidestr-node` (host ADR-2111). The
   2026-09-02 "anchoring keeps using mainnet" note is superseded in its parent choice, not its
   substance: anchors reach the configured parent through gitmark's checkpoints.
6. **Terminology.** Until `AnchorConfirmer` is green the words are "anchor", "peg", "claim" and
   "marker". "Single-use seal" is not used in code, documents or interfaces for any construction
   here; a vocabulary lint enforces it.

### Amendments after independent adversarial review (GPT-6 Astra, 2026-09-21)

- **Balance is a set of defined categories, not one number**: circulating, immature coinbase,
  locked or encumbered, pending deposit, pending redemption, per asset. The fold is over
  every address the principal's discovery scheme knows (per-purpose receive addresses need an
  address index and recovery data; there is still recovery state even though there is no
  wallet object).
- **`states.len() == txo.len()` is necessary, not sufficient.** A seal history is proven by
  creation, spending transaction, state binding and finality under the ADR-2101 rule, not by
  equal array lengths.
- **Migration reconciles liabilities.** Before any legacy writer is disabled, every ledger's
  non-zero balances, holds, failed payments and obligations are inventoried and reconciled
  against assets; a stub deposit endpoint does not prove an empty ledger. The equality test
  uses known non-zero state, never random identities. Unbacked legacy liabilities are not
  backed by minting.
- **Anchoring finality.** A checkpoint proves prior existence, not a unique history; which
  checkpoint publications are authoritative and what depth each external action needs are
  set by the protocol profile (ADR-2103), and a reorganised-out checkpoint is handled
  explicitly.

## Consequences

Two sources of truth for one pubkey, the defect this record exists to end, become impossible
rather than reconciled. The pod economy's per-read micro-debits become chain-settled or are
batched onto the chain by the view adapter, which is a latency and fee change the P2 acceptance
test must measure. Removing `credit`/`debit` is the one deliberately breaking change in the
programme. MRC20 stops being a token rail and stays an anchoring primitive.

## Verification

Proposed. Ratification evidence: `balance(did)` identical from solid-pod-rs, the forum view and
`sidestr-node` directly for 100 random DIDs; `grep -rn "fn credit\|fn debit" crates/solid-pod-rs/src/payments.rs`
shows no public API; `contract.rs` no longer constructs `txo: Vec::new()`; the vocabulary lint
passes on `docs/` and `crates/sidestr/`.
