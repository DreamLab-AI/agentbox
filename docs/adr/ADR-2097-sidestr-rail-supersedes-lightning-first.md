---
id: ADR-2097
title: The sidestr rail supersedes Lightning-first, and pay402 gains a fixtured sidestr scheme
date: 2026-09-21
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: the first captured sidestr 402 fixture landing in tests/contract/pay402/; any proposal to make x402 or l402 payable; any proposal to build NWC
repo: agentbox
domain: GOVERNANCE-capabilities
---

# ADR-2097 — The sidestr rail supersedes Lightning-first, and pay402 gains a fixtured sidestr scheme

## Context

ADR-032 (archive) D5 fixed settlement as "Lightning-first: the only planned real-money rail is
Lightning via NWC (NIP-47) paying L402 invoices", and PRD-015 C10 scheduled it as Phase 3. It
was never built: no NWC, NIP-47 or NIP-57 code exists outside `node_modules`, and
`docs/developer/economy-loop.md:143` still says "Lightning-first". ADR-032 D2 fixed the
402 scheme grammar as a closed result set (`agentbox-ledger | x402 | l402 | unknown`) where
"adding a scheme is an ADR-032 revision plus fixtures, never a runtime extension point", and its
review trigger named the arrival of a real-money rail. The owner dropped Lightning-first on
2026-09-21 ("we have sidestr now", PRD-024 D5).

## Decision

1. **Lightning-first is superseded.** PRD-015 C10 and ADR-032 D5 no longer describe the plan.
   NWC, NIP-47 and the L402 payable path are not built. Lightning may return later strictly as
   a bridge on-ramp into a chain (ADR-2102), never as the planned rail.
2. **`x402` and `l402` continue to classify and stay `payable: false`.** Detection is free and
   legible; the scheme strings are append-only per ADR-032 D5 and are not removed.
3. **`pay402.js` gains a fourth scheme, `sidestr`, as an ADR-032 revision.** Detection shape,
   frozen and fixtured: a 402 whose `accepts[]` carries `{ scheme: "sidestr", chain:
   "sidestr:<name>", address: "<bech32m>", amount_sats | { asset, amount } }`. `payable: true`
   only when `CONSUMER_ENABLED`, `[sidechain].enabled` and the rail-only table
   `[payments.sidestr].enabled` all hold (the rail table references the chain block and never
   restates its fields). Captured-bytes
   fixtures land in `tests/contract/pay402/` and are immutable once landed (ADR-032 D4).
   `unknown` remains terminal and unpayable.
4. **Precedence.** During P2 `sidestr` sits below `agentbox-ledger` so the legacy rail still
   wins where both are offered; it moves first in P3 once the Web Ledger is a derived view
   (ADR-2099).
5. **The `[llm_marketplace]` barter economy (kinds 38300 to 38305) stays independent.** A
   grant is not a spend; the marketplace is not a third value system and does not settle on
   the chain.

## Consequences

`economy-loop.md` is rewritten. The consumer pipeline (spend policy, native payer, receipts)
keeps its shape and gains a real rail; `consumer-payer.js` learns to build and publish a
kind-23500 spend via `sidestr-wallet`. Anyone who planned on NWC budgets loses that path.
ADR-032's own review trigger fires and is answered by this record.

## Verification

Proposed. Ratification evidence: `tests/contract/pay402/` contains `sidestr` fixtures and the
merge gate passes; a fixture-unwitnessed scheme still classifies `unknown` and cannot spend; an
acceptance test in which agent A pays agent B 1,000 test sats through a 402 challenge end to
end with a receipt URN citing the chain txid.
