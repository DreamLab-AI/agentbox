# PRD-015: Consumer & Broadcast Economy Surfaces

**Status:** Draft v1
**Date:** 2026-06-12
**Author:** DreamLab AI
**Repo:** [github.com/DreamLab-AI/agentbox](https://github.com/DreamLab-AI/agentbox)
**Related:** PRD-009 (LLM resource marketplace), PRD-006 (Linked-data interfaces), PRD-007 (Multi-tenant federation), ADR-005 (Pluggable adapters), ADR-008 (Privacy filter), ADR-009 (Embedded Nostr relay), ADR-010 (Rust Solid pod), ADR-012 (JSON-LD federation grammar), ADR-013 (Canonical URI grammar), ADR-021 (Marketplace kinds), DDD-006 (Marketplace domain), [`docs/developer/economy-loop.md`](../../developer/economy-loop.md)
**Drives:** an ADR for the 402 challenge & scheme-detection grammar (numbered on acceptance), the `skills/payment-router` skill (Phase 1 deliverable), and the real-money settlement workstream already flagged in economy-loop.md §What remains #4

## TL;DR

The agentbox economy is one-sided. The **sell side** is implemented and
test-gated end to end: `payment-gate.js` enforces HTTP 402 with a real Web
Ledger debit in solid-pod-rs, receipts/activities are minted as URNs, and the
whole loop crosses the BC20 federation boundary
([economy-loop.md](../../developer/economy-loop.md), landed 2026-06-09). But
agents cannot **spend** outside the implicit signed-pod-read path, and gated
services are **invisible** — our 402 dialect is bespoke (neither x402 nor
L402), and nothing publishes service offers anywhere a crawler or peer can
find them.

This PRD adds the two missing halves as manifest-gated product surfaces:

- **Consumer** — a governed outbound payment pipeline: detect a 402
  challenge, classify its scheme, apply a deterministic spend policy, pay,
  retry, and mint receipt + activity URNs for every sat spent.
- **Broadcast** — make our own gated services legible and discoverable:
  a generated `/.well-known/x402.json` manifest, a standards-shaped 402
  challenge (additive, backwards compatible), marketplace auto-advertisement,
  and optional submission to external indexes.

Field evidence that this gap is the live frontier: hosted custodial routers
(e.g. cinderwright, surveyed 2026-06-12) already bridge x402 (1,503 live
services), L402 (1,185), and card rails for agents, indexing 2,800+ payable
services crawled from `/.well-known/x402.json` manifests; x402 reported
~$600M annualised volume in 2025 (already cited in
[`skills/cost-estimation/cost-model.md`](../../../skills/cost-estimation/cost-model.md)).
We adopt the *ideas* — protocol detection, one-balance UX, budget surface,
discovery manifests — and reject the custody model, which contradicts the
sovereign data stack.

---

## 1. Problem

### 1.1 Sell without buy

`management-api/middleware/payment-gate.js` and `cost-gate.js` let agentbox
**charge** for routes (live on the ComfyUI route today), and
`routes/payments.js` exposes the full `/v1/pay/*` ledger surface. But no
component can **receive** a 402 challenge and resolve it. The only spend path
is implicit: a NIP-98-signed pod read where the pod debits the caller's Web
Ledger. An agent that meets a 402 from a peer node's management API — or any
external paid service — has no detector, no payer, no budget, and no receipt.

### 1.2 A bespoke 402 dialect

Our challenge is `X-Cost` / `X-Balance` / `X-Pay-Currency` headers plus a JSON
body with `deposit_endpoint`. It is neither x402 (JSON `accepts[]` array of
payment schemes) nor L402 (`WWW-Authenticate: L402` macaroon + invoice). No
external router, crawler, or x402-aware client can recognise an agentbox
service; equally, our agents cannot name what a foreign challenge wants.

### 1.3 No discovery in either direction

PRD-009's marketplace kinds (38300–38305) solve discovery **inside the relay
mesh** for LLM capacity specifically. There is no outward-facing offer
manifest for arbitrary gated routes, and no client that can consume external
discovery surfaces (well-known manifests, public x402 indexes, peer ads) and
present a merged offer view to an agent.

### 1.4 The absence of a governed spend path is itself a risk

Agents that need a paid resource will improvise — hand-rolled curl loops,
operator-driven manual deposits, or pasting credentials into third-party
routers. A missing consumer surface does not prevent spending; it prevents
*governed* spending: no caps, no allowlists, no receipts, no audit trail.

### 1.5 The custodial shortcut is one `npx` away

The surveyed external router ships an MIT MCP wrapper that any agent here
could load today. It works by holding the agent's balance on a hosted service
and signing payments server-side. Convenient, and a direct violation of the
sovereign-stack commitment (single identity, single source of truth,
operator-held keys). Without a first-party alternative, custody becomes the
default by gravity.

---

## 2. Solution overview

Two surfaces sharing one policy spine and one scheme grammar:

```
CONSUMER (buy side)                          BROADCAST (sell-side visibility)
                                             
  agent / skill issues fetch                   [payments] manifest + gated-route registry
        │                                            │
        ▼                                            ├─→ /.well-known/x402.json   (B1)
  402 received ──→ scheme detector (C1)              ├─→ enriched 402 challenge   (B2)
        │            agentbox-ledger | x402          ├─→ 38300 marketplace ads    (B3)
        │            | l402 | unknown                ├─→ S8 linked-data surface   (B4)
        ▼                                            └─→ external index submit    (B6, opt-in)
  spend policy gate (C3)  ── deny → named error
        │  caps · allowlist · approval threshold
        ▼
  estimate + hold (C6) ──→ pay via rail (C2/C9/C10/C11)
        │
        ▼
  retry request ──→ 200 ──→ mint receipt + activity URNs (C4)
                              └─→ observability span/log/metrics (ADR-005)
```

Design stances, fixed up front:

- **Non-custodial by default.** The only balance an agent relies on is its
  Web Ledger in a pod it (or its operator) controls. External
  custodial delegation exists only as an explicit, default-off gate (C9).
- **Policy is deterministic, never LLM discretion.** The spend gate is
  middleware/script code evaluating manifest policy. A model may *request*
  a spend; it cannot *authorise* one above policy.
- **Sats-denominated ledger, bridging at the edge.** The Web Ledger stays in
  satoshis. Foreign rails (USDC, Lightning invoices) are converted at the
  payer layer, mirroring the external routers' architecture — but with the
  treasury keys held by the operator, not a host.
- **Additive interop.** The existing challenge headers/body never change;
  standards-shaped fields are added alongside (B2). Existing clients keep
  working byte-for-byte.
- **No sixth adapter slot.** Payments ride the pods slot (the ledger lives in
  the pod) plus management-api routes, per ADR-005's fixed five-slot
  contract. Consumer and broadcast must both work in `federation.mode =
  "standalone"` and `"client"` — never one-mode-only.

---

## 3. Actors

| Actor | Role in this PRD |
|---|---|
| Autonomous agent | Consumer: requests paid resources inside a policy envelope; never holds policy authority |
| Operator | Owns spend policy, funds the ledger, approves above-threshold spends, opts into broadcast |
| Peer agentbox node | Both sides: charges via payment-gate, spends via consumer pipeline; discovery via mesh ads + manifests |
| External 402 service | x402- or L402-gated API the consumer may pay (Phase 3 or via C9 delegation) |
| External indexer / crawler | Reads `/.well-known/x402.json`, grades service health; never receives balance or identity data |
| Host project (by role) | May scrape payment metrics and render spend provenance from crossed activity URNs |

---

## 4. Scheme grammar (the shared contract)

The detector (C1) and the challenge emitter (B2) are two sides of one
grammar. Classification is a pure function of `(status, headers, body)`:

| Scheme | Detection signature | Pay rail | Status |
|---|---|---|---|
| `agentbox-ledger` | 402 + `X-Pay-Currency: sats` + body `deposit_endpoint`, and/or `accepts[]` entry with `scheme: "agentbox-ledger"` | Web Ledger debit via NIP-98 (native) | Implemented server-side today; consumer = Phase 1 |
| `x402` | 402 + JSON body with `x402Version` / `accepts[]` of scheme entries (e.g. `exact` on an EVM network, EIP-3009 settlement) | Signed USDC authorisation | Phase 3 native (C11) or delegated (C9) |
| `l402` | 402/401 + `WWW-Authenticate: L402` (or legacy `LSAT`) carrying `macaroon` + `invoice` (BOLT11) | Lightning payment + macaroon replay | Phase 3 native via NWC (C10) or delegated (C9) |
| `unknown` | Anything else returning 402 | None — fail closed | Named error always |

Exact wire-format fixtures (header shapes, field names, version pinning) are
specified in the companion ADR and frozen as a fixture corpus under
`tests/contract/` — the detector is contract-tested against real captured
challenges, not paraphrases.

### 4.1 The enriched native challenge (B2, worked example)

Current emission (unchanged, from `payment-gate.js`):

```
HTTP/1.1 402 Payment Required
X-Cost: 100
X-Pay-Currency: sats
X-Balance: 30
```
```json
{
  "error": "payment-required",
  "cost_sats": 100,
  "balance_sats": 30,
  "currency": "sats",
  "deposit_endpoint": "/v1/pay/deposit",
  "info_endpoint": "/v1/pay/info"
}
```

Added alongside (additive only):

```json
{
  "accepts": [
    {
      "scheme": "agentbox-ledger",
      "currency": "sats",
      "amount": 100,
      "pay_to": "did:nostr:<operator-pubkey-hex>",
      "ledger": "web-ledger",
      "deposit": "/v1/pay/deposit",
      "info": "/v1/pay/info"
    }
  ]
}
```

x402 treats `scheme` as an open field: indexers that don't know
`agentbox-ledger` skip the entry; ones that do (our own consumer, peer
nodes) get a machine-readable offer. When a real-money rail lands (Phase 3),
a second `accepts[]` entry advertises it without touching the first.

---

## 5. Requirements — Consumer (C-series)

### 5.1 Must have (Phase 1 — in-mesh, no new money rails)

- [ ] **C1 Scheme detector.** `management-api/lib/pay402.js`: pure
  classification of `(status, headers, body)` → `agentbox-ledger | x402 |
  l402 | unknown` + extracted offer struct. Unit-tested against the fixture
  corpus; no network, no side effects.
- [ ] **C2 Native payer.** Resolve `agentbox-ledger` challenges using the
  caller's Web Ledger: NIP-98-signed flow through the pods adapter /
  `/v1/pay` surface (originator from `lib/pod-signer.js`, gated by
  `[integrations.solid_pod_rs].sign_requests`). Pay → retry exactly once,
  carrying an idempotency key so a replayed retry cannot double-charge.
- [ ] **C3 Spend policy gate.** Deterministic middleware evaluating
  `[payments.consumer]` policy *before* any rail is invoked:
  `max_sats_per_call`, `daily_budget_sats`, origin
  allowlist/denylist (default: mesh-only), `approval_threshold_sats`
  (above it, the spend parks pending operator approval). Denials are named
  errors. Fail-closed: missing/invalid policy → no spend.
- [ ] **C4 Receipts and provenance.** Every spend mints
  `urn:agentbox:receipt:<scope>:…` and a PROV-O
  `urn:agentbox:activity:<scope>:pay-…` through `lib/uris.js` (sole-mint,
  ADR-013), carrying `owner_did`, origin, scheme, amount, and outcome.
  Receipts are minted on *attempted* spends too (denied/failed), with
  outcome recorded — the audit trail has no gaps.
- [ ] **C5 Skill packaging.** `skills/payment-router/` — SKILL.md (LION
  frontmatter) teaching the estimate → policy → pay → retry → receipt loop,
  plus `scripts/pay-fetch.mjs`, the 402-aware fetch wrapper agents actually
  invoke. Gated under `[skills.payment_router]`, default off.
- [ ] **C6 Estimate-before-spend.** Preflight `/v1/pay/estimate` (existing
  route) when the skill knows the tier; server-anchored hold using the
  existing `HOLD_BUFFER_RATIO` lifecycle so caps are enforced by the ledger,
  not only by client code.

### 5.2 Should have (Phase 2 — discovery and budget UX)

- [ ] **C7 Discovery client.** Merge three offer sources into one view:
  crawled `/.well-known/x402.json` manifests, kind-38300 marketplace ads off
  the relay mesh, and (when C9 is enabled) external index search. Crawl
  results are cached in the per-session RuVector cache only — durable truth
  stays in pods and marketplace events.
- [ ] **C8 Budget surface.** `GET /v1/pay/budget`: spent today, remaining
  daily budget, active holds, pending approvals — the operator- and
  agent-readable view of C3 state.
- [ ] **C9 External router delegation (default off).** Vendored, pinned copy
  of the MIT-licensed external MCP wrapper behind
  `[payments.consumer].external_router`; requires the operator to supply the
  router key via env. Every delegated spend still passes the C3 gate and
  still mints C4 receipts locally. Ships with a custody warning in the skill
  text: the hosted service holds that balance, not the pod.

### 5.3 Could have (Phase 3 — real-money rails; separate workstream)

- [ ] **C10 Lightning rail via NWC (NIP-47).** First native real-money rail:
  pays L402 invoices through an operator-configured wallet connection. Chosen
  first because it reuses the nostr identity/transport substrate and needs no
  resident node.
- [ ] **C11 x402 rail (EIP-3009).** Native USDC authorisation signing with an
  operator-held EVM key; self-contained signer, no chain infrastructure.
- [ ] **C12 Deposit settlement verification.** Close the trusted-write gap on
  `/v1/pay/deposit` (solid-pod-rs audit A-4, economy-loop.md §What remains
  #4): a deposit credits the ledger only after rail-appropriate settlement
  proof. Precondition for treating ledger sats as real-money claims.

### 5.4 Won't have

- Custodial third-party balances as a default or implicit path.
- Auto-payment of `unknown` schemes under any policy.
- Spends that do not mint a receipt URN.
- A sixth adapter slot (rides pods + management-api).
- LLM-discretionary spend authorisation.

---

## 6. Requirements — Broadcast (B-series)

### 6.1 Must have (Phase 1)

- [ ] **B1 Well-known manifest.** Generate `/.well-known/x402.json` at boot
  from the `[payments]` manifest section plus a registry of payment-gated
  routes (today: ComfyUI, paid tasks); served by management-api only when
  `[payments.broadcast].well_known = true`. Generated at boot, never fetched
  at runtime — same pinning philosophy as the linked-data context catalogue.
- [ ] **B2 Standards-shaped challenge.** Extend `payment-gate.js` to emit the
  `accepts[]` block of §4.1 alongside the existing headers/body. Additive;
  regression test asserts the legacy fields are byte-identical.
- [ ] **B3 Marketplace ad alignment.** The same gated-route registry that
  feeds B1 feeds kind-38300 advertisements when
  `[llm_marketplace].auto_advertise` is on (PRD-009 Phase 2) — one source of
  truth, two broadcast media (HTTP manifest + relay mesh).
- [ ] **B4 S8 surface parity.** The `[linked_data]` payments surface (S8)
  renders the same offer data as JSON-LD, passing through the standard
  middleware order — observability → privacy filter → encoder (ADR-008,
  ADR-012, DDD-004 §L08) — so redaction completes before encoding.

### 6.2 Should have (Phase 2)

- [ ] **B5 Health and quality signals.** Enrich `/v1/pay/info` and the B1
  manifest with uptime/latency aggregates from the observability layer —
  the fields external indexers grade services on. Aggregates only; never
  per-caller data.
- [ ] **B6 External index submission (default off).** An explicit operator
  action (CLI/dashboard) that submits the B1 manifest to public x402 indexes.
  Outward publication is irreversible — never automatic, confirmed per
  submission.

### 6.3 Could have (Phase 3)

- [ ] **B7 L402-compatible challenge emission** once a Lightning rail exists,
  so Lightning-native clients can pay agentbox services without
  understanding `agentbox-ledger`.

### 6.4 Won't have

- A public index-as-a-product (we publish and consume manifests; we do not
  operate a registry service).
- Broadcasting any surface without an explicit operator opt-in gate.
- Balance, identity, or per-caller data in any broadcast surface.

---

## 7. Manifest design

Proposed additions (all default-off; existing `[payments]` keys unchanged):

```toml
[payments]                      # existing — unchanged
enabled = true
backend = "solid-pod-rs"
base_cost_sats = 10
dream_per_sat = 10
hold_buffer_ratio = 1.2

[payments.consumer]
enabled                 = false
max_sats_per_call       = 100      # hard per-spend ceiling
daily_budget_sats       = 1000     # rolling 24h cap, enforced via ledger holds
approval_threshold_sats = 50      # above this, park for operator approval
allow_origins           = []       # empty = mesh-only (pods + peer nodes)
deny_origins            = []
external_router         = "off"    # off | cinderwright  (C9; custody warning)

[payments.broadcast]
enabled        = false
well_known     = false             # serve /.well-known/x402.json (B1)
accepts_block  = true              # emit accepts[] in 402 challenges (B2)
health_signals = false             # include uptime/latency aggregates (B5)
index_submit   = "off"             # external index submission (B6; explicit action)

[skills.payment_router]
enabled = false                    # C5 — the agent-facing skill
```

Manifest-gating rules apply as everywhere else: if any component becomes a
supervised service, both its Nix package set and its supervisor block are
gated; schema + validator entries (`schema/agentbox.toml.schema.json`,
`scripts/agentbox-config-validate.js`) land with the keys.

---

## 8. Architecture and integration points

| Concern | Where it lives |
|---|---|
| Scheme detector (C1) | `management-api/lib/pay402.js` — shared by consumer skill, tests, and any route needing classification |
| Native payer + policy gate (C2/C3) | `management-api/middleware/` sibling of `payment-gate.js`; policy read from manifest at boot |
| Challenge emission (B2) | extend `management-api/middleware/payment-gate.js` |
| Well-known manifest (B1) | new `management-api/routes/well-known.js` + boot-time generator |
| Budget surface (C8) | extend `management-api/routes/payments.js` |
| Agent-facing loop (C5) | `skills/payment-router/` (SKILL.md + `scripts/pay-fetch.mjs`), MCP-server subdir only if/when C9 lands — precedent: `skills/comfyui/mcp-server` |
| Identity | caller DID from NIP-98 (`req.auth.pubkey` → `did:nostr:<hex>`); operator DID from `AGENTBOX_PUBKEY`; signing originator `lib/pod-signer.js` |
| Provenance | `lib/uris.js` sole-mint; receipt + activity kinds per the code-as-harness allocation; BC20 crossing of activities reuses the existing bridge |
| Observability | every consumer dispatch emits span/log/metrics (ADR-005): `agentbox_pay_spend_total{scheme,outcome}`, `agentbox_pay_denied_total{reason}`, `agentbox_pay_challenge_detected_total{scheme}`; exporters stay optional |
| Contract tests | `tests/contract/` — detector fixture corpus; consumer flow green in both `standalone` and `client` federation modes; B2 regression for legacy challenge bytes |

### 8.1 Failure semantics

| Failure | Behaviour |
|---|---|
| Policy missing/invalid | Fail closed — no spend, named error |
| Unknown scheme | Fail closed — named error identifying the scheme guess |
| Insufficient ledger balance | Surface upstream 402 unchanged + local advice (deposit endpoint) |
| Ledger/pod unreachable during spend | Fail closed (spends never fail open; read-only balance queries may 502) |
| Settlement/retry timeout | One retry with idempotency key, then receipt with `outcome: failed` |
| Approval pending | Spend parked; receipt minted with `outcome: pending-approval`; resumable by operator |

---

## 9. Security and sovereignty

1. **Prompt-injection → spend is the headline threat.** Attacker-controlled
   content (a malicious 402 body, a poisoned page an agent reads, a forged
   marketplace ad) may try to induce payment. Mitigations, layered: the C3
   gate is deterministic code outside model control; origin allowlist
   defaults to mesh-only; per-call and daily caps anchor in **server-side
   ledger holds**, not client arithmetic; above-threshold spends require
   out-of-band operator approval; unknown schemes are unpayable by
   construction.
2. **Custody stays with the operator.** C9 is the only custodial path; it is
   default-off, env-keyed, loudly labelled, and still locally policy-gated
   and receipt-audited.
3. **Broadcast leaks nothing private.** Privacy filter runs before the
   encoder on every broadcast surface (DDD-004 §L08); manifests carry offers
   and aggregates only; B6 submission is an explicit irreversible-publication
   confirmation.
4. **Deposit trust is named, not hidden.** Until C12, ledger credits remain
   trusted-write (audit A-4); consumer docs and `/v1/pay/info` state this so
   no one mistakes in-mesh sats for settled value.
5. **Identity is the existing mesh.** No new key types: NIP-98 for HTTP,
   BIP-340 x-only pubkeys as scope, `did:nostr` everywhere — the consumer is
   one more participant in the identity mesh, not a new primitive. Phase 3
   adds operator-held wallet keys (NWC connection string, EVM key) stored
   like the existing encrypted stack keys.

---

## 10. Phasing

| Phase | Scope | Exit criteria |
|---|---|---|
| 1 — In-mesh consumer + native broadcast | C1–C6, B1–B4 | Agent on node A pays a 402 from node B's gated route end-to-end (detect → policy → ledger debit → retry → 200), with receipt + activity URNs minted and the legacy challenge byte-identical under B2; contract tests green in standalone + client modes |
| 2 — Discovery + budget UX | C7–C9, B5–B6 | Merged offer view returns mesh ads + crawled manifests; `/v1/pay/budget` live; one external crawl pilot indexes an opted-in agentbox manifest; C9 delegation behind its gate with local receipts |
| 3 — Real-money rails | C10–C12, B7 | An L402 service paid via NWC under policy caps; deposit credits require settlement proof (A-4 closed); x402 rail behind its own gate |

Phase 3 is deliberately a separate workstream with its own risk review —
Phases 1–2 ship full product value (the in-mesh economy plus discovery)
without touching real money.

---

## 11. Rejection list

| Rejected approach | Reason |
|---|---|
| Custodial hosted router as the default spend path | Violates the sovereign stack: balance and signing keys leave operator control |
| A sixth "payments" adapter slot | ADR-005's five slots are fixed; the ledger lives in the pod (pods slot) and the HTTP surface in management-api |
| LLM-judged spend authorisation | Injection-prone; policy must be deterministic middleware |
| Replacing the bespoke 402 fields with x402-only | Breaks existing clients; B2 is additive instead |
| Durable crawl-index database in agentbox | Embedded RuVector is a per-session cache; durable truth belongs to pods and marketplace events |
| USDC- (or DREAM-) denominated external offers | Ledger and external offers stay sats-denominated; currency bridging happens at the payer edge, token economics stay internal |
| Auto-funding the ledger from a wallet on low balance | Turns a spend-cap breach into a wallet drain; deposits remain operator-driven |

---

## 12. Success metrics

| Metric | Target |
|---|---|
| Spend audit completeness | 100% of attempted spends (paid, denied, failed, pending) mint a receipt URN |
| Detector accuracy | 100% on the contract fixture corpus (incl. captured real-world x402/L402 challenges) |
| Policy enforcement | Zero spends above per-call/daily caps in adversarial tests (incl. injected-challenge corpus) |
| Pipeline overhead | p95 added latency < 50 ms excluding the payment rail itself |
| Challenge compatibility | Legacy 402 fields byte-identical with `accepts_block` on |
| Broadcast validity | B1 manifest passes x402 well-known schema checks; ≥1 external crawler indexes a pilot node in Phase 2 |
| Contract coverage | Consumer + broadcast suites green in `standalone` and `client` federation modes |

---

## 13. Open questions

1. **Approval surface.** Where does `approval_threshold_sats` park-and-approve
   live — the setup dashboard (PRD-012), an ACSP human-in-the-loop event, or
   both? (PRD-014's Seam-D decision stub is adjacent prior art.)
2. **Scheme naming.** Keep `agentbox-ledger` as a private scheme string, or
   pursue registration in the x402 scheme namespace once stable?
3. **Signed manifests.** Should `/.well-known/x402.json` carry a detached
   operator signature (JCS canonicalisation via the existing `jcs.js` +
   BIP-340)? Crawlers don't require it; peers could verify it.
4. **L402 macaroon lifecycle.** Caching/replay window for purchased macaroons
   across retried calls — needs an answer in the Phase 3 ADR.
5. **DREAM exposure.** `/v1/pay/info` advertises DREAM internally; external
   broadcast is sats-only in this draft. Confirm token economics stay
   non-broadcast.

---

## 14. References

- [`docs/developer/economy-loop.md`](../../developer/economy-loop.md) — the
  implemented sell-side loop this PRD completes.
- PRD-009 / ADR-021 / DDD-006 — marketplace kinds 38300–38305 (the in-mesh
  discovery medium B3 feeds).
- `management-api/middleware/payment-gate.js`, `middleware/cost-gate.js`,
  `routes/payments.js` — the existing enforcement and ledger surface.
- [`skills/cost-estimation/cost-model.md`](../../../skills/cost-estimation/cost-model.md)
  §x402 Protocol — prior internal note on x402 compatibility.
- External survey (2026-06-12): cinderwright-api — MIT MCP wrapper over a
  hosted router (api.ideafactorylab.org); x402/L402/MPP bridging; ~2,800
  indexed services crawled from `/.well-known/x402.json` manifests; the
  custody model this PRD explicitly rejects, and the discovery/protocol-
  detection ideas it adopts.
- x402 (HTTP 402 payment challenge grammar, EIP-3009 settlement), L402/LSAT
  (macaroon + BOLT11 invoice), NIP-47 Nostr Wallet Connect — wire-format
  references for the companion ADR's fixture corpus.
