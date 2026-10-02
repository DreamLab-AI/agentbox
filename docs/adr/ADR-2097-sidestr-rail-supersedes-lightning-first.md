---
id: ADR-2097
title: The sidestr rail supersedes Lightning-first, and pay402 gains a fixtured sidestr scheme
date: 2026-09-21
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: e020264b54c6872ca98995c1adda18b8451a39af
verified_paths: [management-api/lib/pay402.js, scripts/sidechain/demo-accounts.js, management-api/lib/sidestr-spend-key.js, management-api/lib/sidestr-rail.js, management-api/lib/sidestr-payee.js, management-api/middleware/consumer-payer.js, management-api/middleware/spend-policy.js, management-api/routes/chain-payments.js, tests/contract/pay402, scripts/activation/adr-2097-acceptance.js]
owner: jjohare
review_trigger: a chain added to pay402.js SIDESTR_CHAINS; the rail switched to sidestr:dreamlab-txbt4; sidestr-agent gaining a memo or transaction lookup (S2); any proposal to make x402 or l402 payable; any proposal to build NWC
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
3. **`pay402.js` gains a fourth scheme, `sidestr`, as an ADR-032 revision** *(amended in place
   2026-10-02, owner decision SC2: a payment is a sidechain transaction)*. Detection shape,
   frozen and fixtured: a 402 whose `accepts[]` carries `{ scheme: "sidestr", chain_id:
   "sidestr:<name>", address: "<prefix>1p…", pubkey: <payee spend key>, amount_sats, memo:
   <payee receipt URN>, pay_to?: did:nostr, binding?: <kind 38420> }`. The payer builds and
   signs one sidechain transaction with its spend key `k_spend` (never `k_id`, ADR-2101 D3)
   through `sidestr-agent send --post` (sidestr-wallet underneath), which broadcasts it by
   producer `POST /tx` and kind 23500; its receipt URN cites the txid and the including block
   hash. `payable: true` only when `[payments.sidestr]` is enabled for the offer's chain and
   that chain is compiled into `SIDESTR_CHAINS`, testnet parents only; `CONSUMER_ENABLED` and
   `[sidechain]` play no part (paying is not producing). Any other chain id is refused.
   Captured-bytes fixtures in `tests/contract/pay402/` are immutable (ADR-032 D4,
   `fixtures.sha256`). `unknown` remains terminal and unpayable.
4. **Precedence.** During P2 `sidestr` sits below `agentbox-ledger` so the legacy rail still
   wins where both are offered; it moves first in P3 once the Web Ledger is a derived view
   (ADR-2099).
5. **The `[llm_marketplace]` barter economy (kinds 38300 to 38305) stays independent.** A
   grant is not a spend; the marketplace is not a third value system and does not settle on
   the chain.

## Consequences

`economy-loop.md` is rewritten. The consumer pipeline (spend policy, native payer, receipts)
keeps its shape and gains a real rail; `consumer-payer.js` learns to build and publish a
sidechain spend via `sidestr-agent` (`resolveSidestr`, caller `POST /v1/chain/pay`). Anyone who planned on NWC budgets loses that path.
ADR-032's own review trigger fires and is answered by this record.

## Verification

Proposed. Ratification evidence: `tests/contract/pay402/` contains `sidestr` fixtures and the
merge gate passes; a fixture-unwitnessed scheme still classifies `unknown` and cannot spend; an
acceptance test in which agent A pays agent B 1,000 test sats through a 402 challenge end to
end with a receipt URN citing the chain txid.

## Disposition — 2026-10-02

- **Suitability:** fits
- **Priority:** P2 — next cycle (planning-cycle §3 reopening; this is the "agents pay each other live" step of the §9 headline demo)
- **Why:** The owner dropped Lightning-first, and that still stands: TODO-unified, "External critique" disposition, lines 49–51. Upstream has not moved toward Lightning. sidestr/spec `fe689e9` mentions it nowhere, and sidestr-rs's Hitch is a channel kernel inside sidestr that does not speak to Lightning peers (VisionFlow ADR-2012, Source qualification). Nothing in D3 is built yet: `management-api/lib/pay402.js` has no `sidestr` scheme and no `tests/contract/pay402/` sidestr fixture exists (agentbox `c4ed3ec65`). `docs/developer/economy-loop.md:143` already describes the sidestr rail as proposed. The public site still claims Lightning/NWC as "the rail today" (VisionFlow `website/static/index.html:608,1101-1103`). That is tracked on VisionFlow ADR-2012, not here.
- **Next:** Do this after the research chain runs a Rust producer (N-10). Capture the first `sidestr` 402 fixture on `sidestr:dreamlab` testnet sats; that is this record's review trigger and the first piece of its ratification evidence.

## Acceptance — 2026-10-02

Accepted, implementation complete, activation **staged**. The owner decided on 2026-10-02
(SC2): "Sidechain transactions on the `txbt4`-anchored sidechain … Each payment is a sidechain
tx. Hitch session channels are a layer on top, not the demo's payment path." D3 above is
amended in place to say so. SC1 puts the demo on a new chain sealed on `txbt4`, so the rail is
chain-agnostic: `[payments.sidestr]` names the chain and producer, and the chain must be
compiled into `pay402.js` `SIDESTR_CHAINS`. It was built and run against `sidestr:dreamlab`.

**Built at `6db0ffc8d`.**

- The `sidestr` classifier, captured fixtures and the value-leak guard: an uncompiled or
  mainnet chain id is refused; validator E-PAY5 catches the same thing in config.
- The payer, `consumer-payer.js` `resolveSidestr`. It runs from `POST /v1/chain/pay`, its first
  production caller. Before signing it checks the chain guard against the producer's
  `chain.json` and checks the offer's address through `sidestr-agent address`.
- Spend-policy in rail mode, on that route only. Above `approval_threshold_sats` a payment
  parks and waits for a NIP-98 approver on the allowlist; the payer cannot approve its own
  payment. That makes the "parks pending approval" claim at `agentbox.toml:1556` true on
  this rail.
- Journal pairs (`sidestr.send`, `sidestr.settle`, `http.retry`) under the payment's receipt
  URN.
- `k_spend` minted at spawn beside `k_id` from an independent key, never derived from it. A
  kind-38420 binding signed by `k_id` ties them, with a known-answer test.
- `GET /v1/chain/payments`, and `GET /v1/chain/sessions`, which returns `[]` until there are
  Hitch sessions.

`[payments.sidestr]` is on in `agentbox.toml`. Activation is staged rather than live: the
running management-api is the baked image and was not restarted, so the routes go live on the
next rebuild.

**Ratification evidence, all met.**

1. `tests/contract/pay402/` holds `sidestr` fixtures (59/59). One is the captured 402
   `sidestr-dreamlab.json`; four are adversarial derivations.
2. A fixture-unwitnessed scheme (`sidestr-hitch`) classifies `unknown` and cannot spend. With
   only `[payments.sidestr]` on, an `agentbox-ledger` offer stays `payable:false`.
3. Live run of `scripts/activation/adr-2097-acceptance.js` on `sidestr:dreamlab`, 2026-10-02
   (receipt `docs/experiments/ADR-2097-acceptance-2026-10-02.receipt.json`):
   - Agent A `did:nostr:8d10b68a…0cd3` paid agent B `did:nostr:5d134535…d51f` 1,000 test sats
     through B's 402.
   - The payment is txid `921b911cb61f4e977dd88211834de63998e7dc7c70bcad71d48f8c1d65d31f6f`,
     included at height 946 in block
     `49a4e0f15bb162ed94341b650811b12453eec438aa89e1e372ea3f4e1105b881`, fee 155.
   - The receipt URN is
     `urn:agentbox:receipt:8d10b68a…0cd3:sha256-12-3b3e424c94d3`, content-addressed over the
     txid and the block hash.
   - B redeemed it on chain: outpoint `…1f6f:0`, 1,000 sats, and B's balance went from 0 to
     1,000.
   - Three tool.called/tool.completed pairs were journalled, each linked by causation.
   - A was funded from the treasury by `d1f95ae3…4989` at height 945.
   - What was staged: A's route ran in its own Fastify instance, with the NIP-98 hook replaced
     by A's verified identity, and B's payee was a loopback HTTP server.

**What S2 must add to `sidestr-agent`.** 0.3.2 at `d68880bf` is enough for this rail, so no pin
bump is needed. It still lacks the following.

- `send --memo`, so the charge memo goes on chain. Today the memo binds only through the
  receipt.
- A transaction lookup (`tx <txid>`, or a producer `GET /tx/<txid>`). Today inclusion is found
  by scanning the payee's `/coins`, which misses a payee that spends the output first.
- A Rust `bind` that emits the 38420 event, with the same known-answer test.
- `hitch open|pay|close` behind `/v1/chain/sessions`.
- Machine-readable error codes.
- A spend that does not download the whole `blocks.dat`.

**Chain keying and the demo chain (`e020264b54c6872ca98995c1adda18b8451a39af`, same day).** The rail now resolves its chain
the way `config/sidechain/run-producer.sh` does. `SIDESTR_CHAIN` overrides `chain_id`, and the
producer is `http://127.0.0.1:<port>`, with the port taken from `SIDESTR_PORT`, else 3450 for
`dreamlab`, else `[sidechain.<name>].port`, unless `producer_url` is set. Both estate chains are
compiled into `SIDESTR_CHAINS`, each pinned by genesis, and a contract test ties them to the
sealed `chain.json` files.

`agentbox.toml` now defaults the rail to the SC1 demo chain `sidestr:dreamlab-txbt4`
(parent `txbt4`, prefix `drt`, not anchored under SC5) on port 3451. Its producer ships disabled,
so until it runs every payment fails closed at the chain guard.

`GET /v1/chain/payments` follows `agentbox.chain.payments/1`, the contract agreed with S5 for
VisionClaw: `tip`, `checkpoint` (null today), `payments` and `balances`. The balances are
confirmed coins only.

`scripts/sidechain/demo-accounts.js` minted the `demo-a` and `demo-b` agentbox identities, each
with a bound spend key, and wrote `agents/demo-{a,b}-dreamlab-txbt4.json`:
- demo-a: `did:nostr:32029837…315d`, address `drt1p4hft4emc…lgd2`
- demo-b: `did:nostr:ce4827e1…36cb`, address `drt1pe6g45e5r…9aa3j`

**Funding dependency.** The txbt4 chain mints nothing, and the estate holds no post-fork txbt4
coins yet. The demo payment on `sidestr:dreamlab-txbt4` therefore waits on two things: its
producer running, and a peg-in or treasury funding demo-a's spend address. The route suite runs
on both chains with stubs. The live evidence above is on `sidestr:dreamlab`.
