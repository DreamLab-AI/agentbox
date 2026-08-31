---
id: ADR-032
title: The 402 payment challenge & scheme-detection grammar
status: accepted
date: 2026-06-12
type: contract
author: Dr John O'Hare
depends_on: [ADR-005, ADR-008, ADR-012, ADR-013, ADR-021, ADR-031]
review_trigger: a new payment scheme enters the grammar; the x402 or L402 wire formats publish a new version; the NWC rail (PRD-015 C10) lands; or any change to the legacy challenge fields emitted by payment-gate.js
---

# ADR-032 — The 402 payment challenge & scheme-detection grammar

**Related:** PRD-015 (Consumer & broadcast economy surfaces — the product
spec this ADR is the wire contract for), ADR-005 (adapter middleware and
observability), ADR-013 (canonical URI grammar — receipt/activity minting),
ADR-021 / PRD-009 (marketplace kinds 38300–38305 — the relay-side discovery
medium), ADR-031 (executable contract gates — the enforcement pattern the
fixture corpus follows), `management-api/middleware/payment-gate.js` (the
emitter), [`docs/developer/economy-loop.md`](../../developer/economy-loop.md)
(the implemented sell side).

## TL;DR for newcomers

*Skip if you already know why payment detection must be a frozen grammar,
not a heuristic.*

Agentbox can charge for routes (HTTP 402 + Web Ledger debit) but its
challenge format is bespoke, and agents meeting a foreign 402 cannot name
what it wants. PRD-015 adds a consumer (detect → policy → pay → receipt) and
a broadcast surface (make our offers legible). Both sides meet at one
question: **given an HTTP response, exactly which payment scheme is this?**

The answer is a security boundary. The classifier's output decides which
rail may move money, and the input is attacker-controlled bytes (any server
can return any 402). So the grammar is: a **pure function** over
`(status, headers, body)`, with a **closed result set**
(`agentbox-ledger | x402 | l402 | unknown`), **frozen detection signatures**
pinned by a captured-bytes fixture corpus in `tests/contract/`, and
**fail-closed semantics** — `unknown` is unpayable by construction, and the
classifier never throws.

Settlement stance (operator decision, PRD-015 v1.2): the native ledger is
sats; the only planned real-money rail is **Lightning via NWC (NIP-47)**
paying L402 invoices. x402 is in the grammar for *detection and emission
shape* — we borrow its `accepts[]` envelope and its `/.well-known/x402.json`
discovery idiom — but no native EVM/USDC signing rail will be built; x402
challenges are payable only through explicit, default-off delegation.

**If you remember only one thing:** classification is deterministic code
over frozen byte-shapes; a scheme the fixtures don't witness is `unknown`,
and `unknown` can never spend a sat.

For the deep version, keep reading.

## Context

Three forces shape the grammar:

1. **Interop without breakage.** The existing challenge
   (`X-Cost`/`X-Balance`/`X-Pay-Currency` headers + JSON body with
   `deposit_endpoint`) has live clients — the contract suites and any peer
   node assert on those bytes. Meanwhile the outside world converged on two
   idioms: x402's JSON `accepts[]` array (open `scheme` field, well-known
   discovery manifests, thousands of indexed services) and L402's
   `WWW-Authenticate` macaroon + BOLT11 invoice. We need to *speak* enough
   of both to be legible and to read foreign challenges — without changing
   a byte of our own legacy emission.

2. **Classification is the spend pipeline's first security gate.** A 402
   body is attacker-controlled input that, downstream, can move money.
   Anything probabilistic here (LLM judgement, fuzzy matching, "best
   effort" parsing) converts prompt injection into payment authorisation.
   PRD-015 §9.1 names this the headline threat; the grammar is the first
   layer of the layered defence.

3. **External specs drift; our detector must not drift with them.**
   x402 versions its envelope (`x402Version`); L402 has a legacy spelling
   (`LSAT`). ADR-031 established the repo's answer to spec drift: contracts
   are executable, fixtures are bytes, and a green suite means real
   assertions ran. The same pattern applies — the detector's truth is a
   fixture corpus of captured challenges, not prose paraphrases of
   third-party docs.

## Decision

### D1 — Classification is a pure function with a closed result set

`management-api/lib/pay402.js` exports:

```js
classify({ status, headers, body }) -> {
  scheme:  "agentbox-ledger" | "x402" | "l402" | "unknown",
  payable: boolean,          // false unless a configured rail exists for scheme
  offer:   Offer | null,     // extracted, normalised offer struct
  reason:  string            // for "unknown": which signature checks failed
}
```

No network, no side effects, no exceptions: malformed input of any shape
(non-JSON body, headers of the wrong type, multi-megabyte bodies — input is
size-capped before parse) classifies as `unknown` with a `reason`. The
result set is closed: adding a scheme is an ADR-032 revision plus fixtures
(D4), never a runtime extension point.

`headers` are treated case-insensitively per RFC 9110; `body` is parsed as
JSON at most once, with a hard size cap (64 KiB, matching the NIP-98 token
gate precedent) before any parse attempt.

### D2 — Detection signatures, frozen

Precedence is top-to-bottom; the first match wins. All signatures require
`status == 402` except where noted.

**`agentbox-ledger`** — either of:
- (a) body contains an `accepts[]` array with an entry whose
  `scheme == "agentbox-ledger"` (the B2 enriched form), or
- (b) header `X-Pay-Currency: sats` AND body has a string
  `deposit_endpoint` (the legacy form emitted by `payment-gate.js` today).

Offer extraction: amount from body `cost_sats` (authoritative; the `X-Cost`
header is advisory display only and never used for the debit), `pay_to`,
`deposit`, `info` from the accepts entry when present, else from the legacy
body fields. When both forms are present they MUST agree on amount; a
mismatch classifies `unknown` (reason `amount-mismatch`) — a disagreeing
challenge is a forged or broken challenge.

**`x402`** — body is JSON containing an integer `x402Version` AND an
`accepts[]` array of objects each carrying at least `scheme` and `network`.
Entries with unrecognised schemes are preserved verbatim in the offer
struct (so delegation and logging can see them) but `payable` is `false`
unless C9 delegation is enabled and the delegate supports the entry.
`x402Version` other than `1` classifies as `x402` with `payable: false`,
reason `unsupported-version`, until fixtures for the new version land.

**`l402`** — status 402 **or** 401, with a `WWW-Authenticate` header whose
auth-scheme token is `L402` or (legacy, read-side only) `LSAT`,
case-insensitive, carrying both a `macaroon` parameter and an `invoice`
parameter whose value has a BOLT11 human-readable prefix (`lnbc`/`lntb`/
`lnbcrt`). A missing or non-BOLT11 invoice classifies `unknown` (reason
`l402-malformed`). We never emit `LSAT`.

**`unknown`** — everything else with status 402. Terminal and fail-closed:
no rail, no retry, named error, receipt minted with `outcome: denied`
(PRD-015 C4 — attempted spends leave audit trail).

Precedence rationale: a challenge carrying both our native signature and an
`accepts[]` array (our own B2 output does) must classify `agentbox-ledger`
so the native rail wins; an x402-shaped body without our entry classifies
`x402`; `WWW-Authenticate` is only consulted after body-shape checks fail,
because L402 is the only header-borne scheme.

### D3 — The enriched native challenge is additive and byte-stable

`payment-gate.js` (B2, gated by `[payments.broadcast].accepts_block`) adds
exactly one field to the challenge body — the `accepts[]` array — whose
first entry is the native offer:

```json
{
  "scheme": "agentbox-ledger",
  "currency": "sats",
  "amount": 100,
  "pay_to": "did:nostr:<operator-pubkey-hex>",
  "ledger": "web-ledger",
  "deposit": "/v1/pay/deposit",
  "info": "/v1/pay/info"
}
```

Required: `scheme`, `currency` (always `"sats"`), `amount` (integer sats,
equal to `cost_sats`), `pay_to` (operator DID per ADR-013 identity
grammar). Optional: `ledger`, `deposit`, `info`. Future rails append
further entries (e.g. an `l402` entry once B7 lands); entries are never
mutated or reordered retroactively.

The legacy headers and the legacy body fields are **byte-identical** with
the gate on or off; a regression fixture asserts the serialised legacy
subset byte-for-byte (PRD-015 success metric "Challenge compatibility").

`/.well-known/x402.json` (B1) reuses the same entry schema per offer; the
manifest generator and the challenge emitter share one offer-construction
function so the two surfaces cannot disagree.

### D4 — The fixture corpus is the contract

`tests/contract/pay402/fixtures/` holds **captured bytes**, one file per
challenge: our own emitter's output (legacy and enriched, generated in-test
and snapshotted), real x402 challenges (spec examples plus at least one
captured from a live indexed service), L402 challenges in both `L402` and
`LSAT` spellings, and adversarial cases (amount mismatch, oversized body,
`accepts[]` with hostile strings, x402Version 2, non-BOLT11 invoice,
401-without-WWW-Authenticate).

Rules, in the ADR-031 mould:

- The detector must score **100%** on the corpus; the suite is a merge gate.
- Adding or changing a signature requires fixtures *first* — a detection
  rule no fixture witnesses is dead grammar and gets removed.
- Fixtures are immutable once landed; corrections add a new fixture and
  deprecate (never edit) the old one, so detector history stays replayable.
- The corpus runs in both `standalone` and `client` federation modes
  (ADR-005 three-class discipline) since the consumer must work in both.

### D5 — Scheme evolution is append-only; settlement is Lightning-first

- Scheme strings are append-only and never re-interpreted. Retiring a
  scheme means marking it `payable: false` forever, not deleting it.
- `agentbox-ledger` stays a private scheme string unless/until registered
  in the x402 namespace (PRD-015 open question 2); registration would not
  change the wire shape.
- **No native EVM/USDC rail** (PRD-015 v1.2 operator decision). x402 is
  detection-and-envelope only: we adopt its `accepts[]` shape and
  well-known manifest idiom because they are good HTTP citizenship, and we
  decline its settlement layer. The only planned real-money rail is
  **Lightning via NWC (NIP-47)** paying L402 invoices — sats end to end,
  one operator-held wallet secret, the same relay-and-keys substrate as the
  rest of the mesh. Revisit trigger: the mesh repeatedly needs an
  x402-only service that delegation (C9) cannot reach.
- New x402 versions or L402 revisions enter as `payable: false` detections
  first (D2), and become payable only after fixtures and a rail exist.

### D6 — Macaroon and credential lifecycle (L402)

A purchased macaroon is a bearer credential bought with the operator's
sats, so it is treated like a key, not a cache entry:

- Stored in the agent pod's **private** storage (never `/public/`,
  never broadcast, never crossed over BC20), keyed by origin host.
- Replayed only against the origin that issued it, for the validity window
  encoded in the macaroon itself; no cross-origin or cross-scope reuse.
- Linked from the receipt URN of the spend that bought it
  (`urn:agentbox:receipt:<scope>:…`), so "what did this credential cost and
  when" is answerable from provenance alone.
- Evicted on expiry or on a 401 replay failure (one re-purchase attempt
  passes through the full C3 policy gate again — a forced re-buy is a new
  spend, never an automatic one).

### D7 — Failure semantics are fail-closed at every step

| Condition | Classification / behaviour |
|---|---|
| Body not JSON / over size cap | `unknown` (`reason` set), no parse retry |
| Amount disagreement between legacy and accepts forms | `unknown`, `amount-mismatch` |
| Recognised scheme, no configured rail | scheme kept, `payable: false` — policy gate never consulted |
| Recognised scheme, rail exists, policy denies | named error from C3; receipt `outcome: denied` |
| Classifier internal error | impossible by construction (pure, total function); a thrown exception is a test-gate failure, not a runtime path |

## Considered options

- **(chosen) Frozen grammar + fixture corpus, Lightning-first settlement.**
  Deterministic, injection-resistant, evolvable by append, and aligned with
  the sovereign stack's existing keys and relays.
- **Rejected: replace the bespoke dialect with x402 wholesale.** Breaks
  every existing client and contract suite asserting on the legacy bytes;
  additive `accepts[]` gets full legibility with zero breakage.
- **Rejected: native EVM/USDC (EIP-3009) settlement.** An EVM key in the
  box is a new custody class and a new threat surface for a rail the
  operator does not want; Lightning covers the real-money need on the
  existing nostr substrate. Detection stays so agents are never blind.
- **Rejected: LLM-assisted challenge interpretation.** Turns
  attacker-controlled response bodies into a prompt-injection path that
  ends in payment; classification must be code (PRD-015 §9.1).
- **Rejected: per-caller ad-hoc detection (each skill parses its own 402).**
  Guarantees drift between consumers and the emitter; one `pay402.js`,
  shared by skill, routes and tests, is the whole point of a grammar.

## Consequences

**Positive.** One grammar serves detector, emitter and manifest, so the
surfaces cannot disagree; foreign challenges become legible without
becoming automatically payable; the corpus turns third-party spec drift
into a visible red suite instead of silent misclassification; Lightning
settlement adds exactly one secret to the box.

**Negative.** x402-only services are unreachable natively (accepted —
delegation or do-without); fixture-first discipline adds friction to scheme
changes (intended); the byte-identical legacy guarantee constrains future
challenge redesigns until a major version.

**Neutral.** The grammar is settlement-agnostic plumbing: rails plug in
behind `payable` without touching classification. Status stays *proposed*
until PRD-015 Phase 1 lands the detector and the corpus; acceptance
criterion is the corpus green as a merge gate.

## References

- PRD-015 §4 (scheme grammar table), §4.1 (worked challenge), §8.1
  (failure semantics), §11 (rejection list — EVM rail entry).
- `management-api/middleware/payment-gate.js`,
  `middleware/cost-gate.js`, `routes/payments.js` — current emitter and
  ledger surface. `lib/uris.js` — receipt/activity minting (ADR-013).
- x402: HTTP 402 challenge grammar, `accepts[]` envelope,
  `/.well-known/x402.json` discovery, EIP-3009 settlement (envelope
  adopted; settlement rejected). L402/LSAT: `WWW-Authenticate` macaroon +
  BOLT11 invoice. NIP-47: Nostr Wallet Connect (the chosen rail's
  transport). BOLT11: invoice encoding (prefix check in D2).
- ADR-031 — the executable-contract enforcement pattern D4 follows.
