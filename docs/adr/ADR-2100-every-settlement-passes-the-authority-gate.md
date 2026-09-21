---
id: ADR-2100
title: Every chain settlement passes the payment_settlement authority gate, the spend budget is durable, and no settlement gate fails open
date: 2026-09-21
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: the first spend that blocks on a signed 31403 in a test; any change to [skills.authority.classes].payment_settlement; any new route that moves value
repo: agentbox
domain: GOVERNANCE-capabilities
---

# ADR-2100 — Every chain settlement passes the payment_settlement authority gate, the spend budget is durable, and no settlement gate fails open

## Context

`agentbox.toml [skills.authority.classes]` declares `payment_settlement = "zero-tolerance"`
with task properties `verifiability = inspectable`, `stakes = critical`, and
GOVERNANCE-capabilities Invariants say a zero-tolerance action blocks on a signed 31402 to 31403
round-trip, journals every deny as a hash-chained `authority.deny`, and mirrors the outcome to
the approving human (ADR-2087). Verified 2026-09-21: `management-api/routes/payments.js` never
requires `lib/authority.js`; only `broker-bridge.js` and `llm-marketplace.js` do. The class
gates nothing. `middleware/spend-policy.js:36-39` keeps the daily budget in memory, reset on
restart. `middleware/cost-gate.js:67-70` defaults to fail-open on payment-backend
unreachability. PRD-015 named prompt-injection-to-spend as the headline threat.

## Decision

1. **Every chain spend, peg-out, child-chain funding and bridge redemption passes
   `lib/authority.js` under `payment_settlement`**, from the first commit of `/v1/wallet/*` and
   `/v1/chain/*` and retrofitted onto `/v1/pay/*`: emit a 31402 carrying the task-property
   triple (`task-properties.js:172`), block on a signed 31403 above
   `[payments.consumer].approval_threshold_sats`, journal every deny through `authority.js:213`,
   mirror the outcome via `governance-receipt-publisher.js`. No new governance mechanism is
   added; the existing one is called.
2. **Deterministic policy stays the only authoriser.** `spend-policy.js` keeps
   `max_sats_per_call`, `daily_budget_sats`, origin allowlist and the threshold; a model may
   request a spend and cannot authorise one above policy. The daily budget becomes durable
   through an existing adapter slot (the `memory` slot, ADR-2085 precedent: consume a slot,
   never add one) and survives process restart.
3. **Settlement fails closed.** `COST_GATE_FAIL_CLOSED` is forced true on any chain-settling
   path; "backend unreachable" never means "assume unspent". The fail-open default remains
   acceptable only for the legacy sats micro-debit and is retired with it.
4. **Every outcome mints a receipt** through `uris.js`, including denied and failed
   (`receipt-minter.js` OUTCOMES), and appends to the hash-chained events log.
5. **The approver sees a canonical approved intent, never attacker-influenced text, and the
   signer binds the transaction to it.** The 31402 carries a canonical intent: chain genesis
   and protocol profile, requesting principal, complete output set (destination scripts,
   amounts, assets, change), fee ceiling, sighash policy, locktime and sequence semantics,
   an approval nonce, expiry and policy version. The signer validates the transaction it is
   asked to sign against that intent field by field (a hash of the intent is not the
   transaction hash), consumes the approval atomically at the signing boundary, and refuses
   fee bumps or RBF outside the approved ceiling. Destinations and assets are resolved by a
   trusted resolver, never by tickers, aliases or metadata the model supplied. This narrows
   prompt-injection-to-spend; it does not by itself authenticate the counterparty.
6. **Multi-agent policy counts authorising principals, never accounts.** `colloquy-core`'s
   principal collapse (ADR-2086) is adopted for policy ceilings and rate limits: an operator's
   fifty agents share one budget. It is **not** used for per-spend authorisation, because
   ADR-2086 retracts confirmations retroactively on revocation and a cleared transaction
   cannot be un-spent; the principal weight is snapshotted into the receipt at settlement.
7. **Thresholds are per asset with a per-principal multiplier**, consumed as policy from
   `[payments.consumer]`; a single global sats figure is wrong for a wrapped USD asset. The
   child-chain funding threshold defaults to zero: every session funding is approved.

### Amendments after independent adversarial review (GPT-6 Astra, 2026-09-21)

- **The policy boundary is the key-use boundary, not the HTTP route.** A signing-capability
  inventory (HTTP routes, Nostr ingress, the identity port, the producer wallet, the bridge,
  maintenance and recovery commands, legacy pay routes) names the policy that governs each;
  unrestricted alternatives are removed; bypasses are tested directly. A non-empty `require`
  grep is not evidence of closure.
- **31403 validity is more than a signature.** The verifier checks exact request binding,
  approver identity and role against the authorised-principal snapshot, scope, expiry, policy
  version, single-use state and self-approval prohibition; approvals that are signed, unused,
  in flight or broadcast have separate rules on revocation.
- **Budget is an atomic state machine, not a durable counter.** Reservation, signing,
  broadcast, unknown outcome, confirmation, cancellation and reconciliation are durable
  states; an unknown broadcast retains its reservation; two instances cannot both reserve
  the same remainder. Financial policy state never inherits the adapters' degrade-to-off
  default. Aggregate cross-asset ceilings, and the authoritative valuation for them, are
  policy the owner sets.
- **Receipts come from a durable intent and outbox.** Authorisation is recorded before any
  irreversible signing, uncertainty is recorded explicitly, and crashes reconcile from the
  outbox; the existing helper's fabricated error URN on failure and the publisher's silence
  on unknown outcomes are defects to fix, not behaviours to inherit.

## Consequences

A large spend today blocks on a human for the first time. The child-chain funding at session
create is itself a settlement and passes the gate, so a session that exceeds policy starts
without a chain rather than with an unfunded one (fail-open on the binding, fail-closed on the
money). The `memory` adapter carries a small amount of financial state, which the privacy
filter (ADR-2036) must classify. The dependency from the settlement path onto colloquy-core is
accepted for the principal-collapse property.

## Verification

Proposed. Ratification evidence: a test in which a spend above threshold blocks on a signed
31403 and a refusal journals `authority.deny` (this test does not exist today and is the proof
the gap is shut); `grep -n "require('../lib/authority')" management-api/routes/payments.js`
non-empty; the daily budget survives `supervisorctl restart management-api`; a chain-settling
call with `sidestr-node` stopped is refused.
