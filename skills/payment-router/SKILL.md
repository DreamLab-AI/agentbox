---
name: payment-router
version: 1.0.0
description: "402-aware outbound payment pipeline"
gate: skills.payment_router.enabled
dependencies:
  - cost-estimation
---

# payment-router

402-aware outbound payment pipeline for agentbox agents. Wraps `fetch` with
a transparent detect-classify-pay-retry loop so any skill or adapter can call
cost-gated external resources without writing payment logic inline.

Implements the consumer side of PRD-015 (C1-C6) and the scheme-detection
grammar defined in ADR-032.

## Overview

PRD-015 (Consumer & Broadcast Economy Surfaces) defines six consumer
capabilities:

| Phase | ID | Capability |
|---|---|---|
| Detect | C1 | Intercept HTTP 402 responses |
| Classify | C2 | Identify payment scheme (ADR-032 grammar) |
| Policy | C3 | Apply operator spend policy before any payment |
| Pay | C4 | Execute payment on the appropriate rail |
| Retry | C5 | Replay the original request with proof of payment |
| Receipt | C6 | Preflight estimate → hold buffer → fail-closed |

ADR-032 defines the classification grammar: a pure function
`classify({status, headers, body})` returning
`{scheme, payable, offer, reason}` with a closed result set
(`agentbox-ledger | x402 | l402 | unknown`). The classifier never throws;
unknown input is `unknown` and spends nothing.

Settlement stance (PRD-015 v1.2, Lightning-first): only `agentbox-ledger`
has a native rail in Phase 1. `x402` and `l402` are detected but
return `rail-not-available`. `unknown` is fail-closed: no retry, no spend.

## Usage

```js
import { payFetch } from "./skills/payment-router/scripts/pay-fetch.mjs";

// Drop-in replacement for fetch — handles 402 transparently
const res = await payFetch(
  "https://api.example.com/premium/endpoint",
  {
    method: "GET",
    headers: { Authorization: "Nostr <nip98-token>" }
  },
  {
    pubkey: process.env.AGENTBOX_PUBKEY,  // operator pubkey for attribution
    logger: fastify.log,                   // optional pino-compatible logger
    tier: "inference",                     // for preflight estimate (C6)
  }
);

if (!res.ok) {
  const err = await res.json();
  console.error("Payment failed:", err);
} else {
  const data = await res.json();
  // ...
}
```

`payFetch` is a named ES module export. It is a thin wrapper: non-402
responses pass through unchanged; 402 responses trigger the payment loop.

## Payment loop

The full loop executed on a 402 response:

```
1. INTERCEPT   — res.status === 402? enter loop, else pass through
2. CAP CHECK   — body <= 64 KiB? else → {error:"unrecognised-scheme",
                  reason:"oversized-body"} (never parse oversized input)
3. CLASSIFY    — classify({status:402, headers, body})  [ADR-032 grammar]
4. SCHEME?     — unknown → fail-closed (no spend, named error)
                  x402/l402 → rail-not-available (Phase 1)
                  agentbox-ledger → continue
5. POLICY      — spend gate: deterministic code, operator caps enforced
                  (see Security section)
6. ESTIMATE    — preflight POST /v1/pay/estimate (C6) before any debit
7. PAY         — POST <deposit_endpoint> with idempotency key
                  409 Conflict = already paid (idempotent, treat as success)
8. RETRY       — replay original request exactly once if pay succeeded
9. RECEIPT     — receipt URN minted by the pod on successful debit
                  (urn:agentbox:receipt:<pubkey>:sha256-…, ADR-013)
```

On pay failure the response is a synthetic 402 JSON object with
`error:"payment-failed"` and a `reason` string. The original request is
never replayed after a failed payment.

## Estimate-before-spend (C6)

Before executing a payment, `payFetch` calls the local estimate endpoint to
compute the required hold amount:

```
POST /v1/pay/estimate
Content-Type: application/json

{ "endpoint": "<tier>", "units": <offer.amount> }
```

The response `hold_sats` value applies a `HOLD_BUFFER_RATIO` of **1.2x**
(configurable) over the raw estimated cost. The actual debit sent to the
deposit endpoint uses `offer.amount_sats` from the classified challenge —
the estimate is used only for operator policy enforcement before the wire
call.

**Fail-closed rule:** if the estimate endpoint is unreachable, or if
`hold_sats` exceeds the operator cap configured under
`[payments.consumer].max_spend_sats`, `payFetch` returns a synthetic 402
with `error:"policy-denied"` and does NOT proceed to payment. The model
cannot override this gate.

## Failure semantics

| Condition | Outcome | Spends? |
|---|---|---|
| Body > 64 KiB | `{error:"unrecognised-scheme", reason:"oversized-body"}` 402 | No |
| Body not valid JSON | classified `unknown` via ADR-032 | No |
| `scheme === "unknown"` | `{error:"unrecognised-scheme", reason:<classifier reason>}` 402 | No |
| `scheme === "x402"` or `"l402"` | `{error:"rail-not-available", scheme, reason:"no native rail in Phase 1"}` 402 | No |
| Estimate endpoint unreachable | `{error:"policy-denied", reason:"estimate-unavailable"}` 402 | No |
| `hold_sats` > operator cap | `{error:"policy-denied", reason:"cap-exceeded"}` 402 | No |
| Deposit POST fails (non-409) | `{error:"payment-failed", reason:<status or message>}` 402 | No |
| Deposit POST returns 409 | idempotent success — continue to retry | Yes (already paid) |
| Deposit POST returns 402 | `{error:"payment-failed", reason:"insufficient-balance"}` 402 | No |
| Retry request fails | pass through upstream error as-is | Yes (payment made) |

**One retry only.** After a successful payment the original request is
replayed exactly once. If the replayed request itself returns 402, it is
returned as-is — no second payment loop. The idempotency key is a fresh
`crypto.randomUUID()` per payment attempt and is included in the deposit
POST body and `Idempotency-Key` header so duplicate POSTs (e.g. from network
timeouts) are absorbed by the pod.

## Configuration

### `[skills.payment_router]` (settings.toml / env)

| Key | Default | Description |
|---|---|---|
| `enabled` | `false` | Gate: skill is inactive unless explicitly enabled |
| `hold_buffer_ratio` | `1.2` | Multiplier applied to raw estimate before policy check |

Env-var equivalents follow the management-api convention:
`HOLD_BUFFER_RATIO=1.2`.

### `[payments.consumer]` (settings.toml)

| Key | Default | Description |
|---|---|---|
| `max_spend_sats` | `1000` | Hard cap per request (estimate hold_sats must be ≤ this) |
| `allowed_schemes` | `["agentbox-ledger"]` | Whitelist; other detected schemes return rail-not-available |
| `deposit_fallback` | `/v1/pay/deposit` | Used when the classified offer has no `deposit` field |

### Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `SOLID_POD_PORT` | `pay-fetch.mjs` | Port of the local solid-pod-rs instance (default: 8484) |
| `HOLD_BUFFER_RATIO` | `routes/payments.js` | Buffer over raw estimate (default: 1.2) |
| `BASE_COST_SATS` | `routes/payments.js` | Base cost per unit in satoshis (default: 10) |
| `AGENTBOX_PUBKEY` | `pay-fetch.mjs` | Operator BIP-340 x-only pubkey hex (for attribution) |

## Security

**The spend gate is deterministic code. The model cannot authorise a
payment above operator caps.**

Specifically:

1. `classify()` is a pure function imported from a fixed module path
   (`management-api/lib/pay402.js`). Its input is the raw 402 response
   bytes; the caller cannot inject a pre-classified result.

2. The deposit endpoint URL is derived from the classified `offer.deposit`
   field or falls back to the hardcoded `/v1/pay/deposit` local path. It is
   never taken from user-supplied input or from the 402 body as an
   unvalidated string — `pay-fetch.mjs` resolves relative paths against the
   hardcoded `podBase` origin.

3. `amount_sats` is taken from `offer.amount` (normalised by the
   classifier from `cost_sats` in the challenge body, never from the
   advisory `X-Cost` header). An amount-mismatch between the legacy and
   accepts-array forms classifies `unknown` (ADR-032 D2) and is unpayable.

4. The preflight estimate (C6) runs before any wire call. If the estimated
   `hold_sats` exceeds `[payments.consumer].max_spend_sats`, the loop
   aborts. This check runs in the same process as the payment call; there is
   no TOCTOU window between estimate and debit.

5. `unknown` scheme is terminal and fail-closed by construction. A server
   returning a crafted 402 body that does not match any frozen detection
   signature (ADR-032 D2) receives no payment and no retry.
