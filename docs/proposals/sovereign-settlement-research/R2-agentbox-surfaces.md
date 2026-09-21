# R2 — agentbox surfaces relevant to sidestr / financial-substrate integration

Scope: map every EXISTING agentbox surface that a Nostr-only Bitcoin sidechain
(sidestr) + RGB integration would touch. Every claim is cited `file:line`.
Headline correction to the brief's framing: **agentbox already has a working,
partially-implemented sats/ledger payment system** ("Web Ledger" / "DREAM
token" economy, PRD-015 / ADR-032). This is not a payments-shaped gap to fill
from scratch — it is an existing rail that a sidestr/RGB settlement layer would
either (a) sit behind as a new `scheme` in the existing 402 classifier, or (b)
replace/extend at the solid-pod-rs ledger backend. Both paths are open; neither
is built. GAPS section at the end is the honest inventory of what is asserted,
partial, or absent.

---

## 1. Identity

### 1.1 `services/nostr-pod-bridge` — what bootstrap actually does

Rust port of `scripts/sovereign-bootstrap.py`
(`services/nostr-pod-bridge/src/bootstrap.rs:1-8`). Runs as root at container
boot phase `[2/8]`, gated on `[sovereign_mesh].enabled`
(`services/nostr-pod-bridge/src/bootstrap.rs:265-276,299-307`).

- **Keypair**: `services/nostr-pod-bridge/src/identity.rs:130-158` — BIP-340
  x-only secp256k1 keypair via `k256` (RustCrypto), even-y canonicalised
  (`normalise_even_y`, `identity.rs:107-126`), NIP-19 npub/nsec via
  `nostr_bbs_core::nip19` (`identity.rs:9-11`). Persisted at
  `<identity_root>/<agent_id>.json` (`identity.rs:183-185`), migrated in place
  if pre-x-only (`identity.rs:198-240`).
- **identity.env**: `services/nostr-pod-bridge/src/bootstrap.rs:190-219` writes
  `AGENTBOX_DID=did:nostr:<hex>`, `AGENTBOX_URN=urn:agentbox:agent:<agent_id>`,
  `AGENTBOX_BRIDGE_RECIPIENT_PUBKEY`/`_SK`, at mode 0600
  (`bootstrap.rs:221-233`); sourced by the entrypoint pre-supervisord, then
  scrubbed to tmpfs (SEC-003, comment at `bootstrap.rs:198-200`).
- **DID documents**: `services/nostr-pod-bridge/src/contract.rs:60-84`
  (`build_did_document`) emits the ADR-033 canonical single-Multikey form —
  `publicKeyMultibase = "fe70102" + x-only-hex`, no `service` array populated
  by this function (`also_known_as` only). Written to both
  `<pod>/did-nostr.json` (`bootstrap.rs:161-164`, with the pod WebID in
  `alsoKnownAs`) and `<pod-git-root>/agent.did.json`
  (`contract.rs:236-240`, no `alsoKnownAs`).
- **gitmark/blocktrails — what it actually does today**: `contract.rs:184-260`
  (`wire_pod_contract_substrate`). It (1) writes `agent.did.json` + `git
  config nostr.privkey <hex>` at the pod-git root, (2) commits it as a
  "genesis" commit, (3) writes `gitmark.json` (5-key verbatim create-agent
  envelope: `@id, genesis, nick, package, repository` —
  `contract.rs:94-101`) and `blocktrails.json` (`@type: Blocktrail, profile:
  "gitmark", states[], txo: []` — `contract.rs:110-118`) referencing the real
  genesis commit SHA, (4) commits both, (5) advances `blocktrails.states[]`
  to the new tip SHA (`contract.rs:238-260`). **`txo[]` (the single-use-seal
  UTXO chain to a confirmed on-chain transaction) is hard-coded empty
  (`contract.rs:128` `txo: Vec::new()`) and is never populated anywhere in
  this crate** — it is the reserved-but-unopened seam to L1/RGB/DLC, per
  ADR-033's own framing (see 1.2). Today the whole substrate is
  "honest-or-caught" at L0: a real git commit SHA, not a chain anchor.
- The per-user pod is itself a git repo (`ensure_pod_git`,
  `contract.rs:165-182`) — commits are made under `did:nostr:<hex>@agentbox.local`
  as committer identity, no human identity leaks in.

### 1.2 ADR-033 — the `txo[]` / L1/RGB/DLC reservation (read carefully)

`docs/archive/adr/ADR-033-did-nostr-multikey-convergence.md` (frozen/archive —
authority only for the DID-document shape D2′/D3′, NOT for gitmark/blocktrails
policy going forward per repo convention, but it is the only place this is
specified today):

- D5′ (`ADR-033.md` "D5′ — agent identity storage"): documents the
  gitmark/blocktrails anchoring exactly as implemented in §1.1, and states
  explicitly: *"Honest-or-caught (L0): the trail tip is a real git commit;
  `txo[]` is empty (the single-use-seal seam to a confirmed on-chain tx —
  L1/RGB/DLC — is reserved, not yet opened)."*
- The "ADR-124 build-out note" section (bottom of the file) repeats this:
  *"`txo[]` = the BIP-341 single-use-seal UTXO chain, empty at L0 … Trust
  model: honest-or-caught (L0); the single-use-seal seam upgrades to
  trustless (RGB/DLC) when `txo[]` opens."*
- **This is the single most on-point existing design seam for sidestr/RGB
  integration in the whole repo.** It names BIP-341 single-use-seals, RGB and
  DLC explicitly as the intended upgrade path, but zero code implements it —
  `txo` is a `Vec<String>` that is constructed empty and never appended to
  (`contract.rs:110-118,128,240-260` — confirmed by reading every call site;
  there is no other producer).
- ADR-033 I1 is an explicit invariant: no identity/npub/URN/ACL/pod/payment
  migration is implied by opening this seam — the `did:nostr:<hex>` string and
  BIP-340 keypair are fixed regardless of what settles underneath.

### 1.3 `docs/INGRESS-identity.md` — Invariants (identity chain)

Not re-read line-by-line here beyond what's cited elsewhere in this report
(§2, §5); its Invariants section governs the NIP-98 auth boundary
(`nip98-proxy`) and hex-canonical identity, both load-bearing for any spend
authorisation (a payment call must arrive with a verified `did:nostr` the same
way any other governed action does — see §2.2, §6).

### 1.4 ADR-2011 — hex-canonical identity

`docs/adr/ADR-2011-hex-canonical-identity.md` (not fully re-quoted; title from
the index: `docs/adr/README.md` row for ADR-2011) — 64-hex BIP-340 x-only is
sole storage/URL identity, npub is display-only. This is the identity a
sidechain wallet binding would key off; there is no separate "wallet pubkey"
concept anywhere in the codebase (confirmed by the URN-kind grep in §1.5 — no
`wallet` kind exists).

### 1.5 `management-api/lib/uris.js` — the 20 URN kinds (verbatim enumeration)

`management-api/lib/uris.js:69-97` (`KINDS` object), verified by direct
enumeration — **20 kinds**, none named `wallet`, `asset`, `payment`, or
`ledger`:

```
pod, envelope, credential, mandate, receipt, activity, event, decision,
mcp, memory, skill, adr, prd, ddd, thing, dataset, bead, knowledge, agent, meta
```

- `mandate` and `receipt` (`uris.js:76,77`) are the closest existing kinds to
  "payment" — both are owner-scoped, content-addressed, and resolve through
  the `pods` surface. They are the vocabulary used today for the *existing*
  x402-style payment economy (§2), not sidechain-specific.
- `knowledge` (`uris.js:91-94`, ADR-2085) is the newest kind, added for the
  Colloquy forum — comment at the same lines documents that its content-hash
  segment is deliberately shared with the `cq` knowledge-unit id
  (`ku_<hex>`), a useful precedent for how a future sidechain-tx kind could be
  bound to a non-agentbox identifier scheme without a second parallel ID.
- **GAP**: there is no `sidechain-tx`, `wallet`, or `asset` kind. Minting one
  would be a one-line addition to `KINDS` (`uris.js:69`) following the
  `bead`/`knowledge` pattern (owner-scoped + content-addressed), but nothing
  does this today.

### 1.6 ADR-2078 — pods signer from sovereign identity

Referenced in `agentbox/CLAUDE.md` ("Rules for changes" is silent on this
directly, but `sign_requests = false` (ADR-2064) is documented in
`agentbox/CLAUDE.md` "Runtime model gotchas": *"Pods requests are declared
unsigned (`sign_requests = false`, ADR-2064) until ADR-2078 wires the
sovereign identity key; the fail-closed adapter throws `SigningUnavailable` if
the flag is flipped without key material."* This is the exact mechanism a
sidechain signer would need to hook: today pod request signing is
**explicitly not wired to the sovereign identity key** — it is a documented,
named gap (ADR-2078), not a stub pretending to work.

### 1.7 Per-session `did:nostr` minting (ADR-043 / `aoe-seed-sessions.mjs`)

`scripts/aoe-seed-sessions.mjs` (858 lines) reconciles
`[interaction_plane].session_seeds` into AoE sessions
(`aoe-seed-sessions.mjs:103`). Identity binding is delegated to a
**session-boundary hook**, not minted inline in this script:
`aoe-seed-sessions.mjs:449-451` sets `cfg.status_hooks = { enabled: true,
on_change: 'node <BOUNDARY_HOOK>' }` with the comment *"Status hooks → Builder
B's session-boundary shim (identity binding fires on transitions)."* — i.e.
the actual `did:nostr` + URN + beads-epic binding for a session happens in a
separate boundary script this file only wires up, and CLAUDE.md's claim of
"binds a `did:nostr` + URN + beads epic + scoped memory namespace at create"
(ADR-043) is **not verified from `aoe-seed-sessions.mjs` alone** — it is a
downstream effect of the hook this file registers. No sidechain-account
analogue exists in either file.

---

## 2. Payments already present — this is the big finding

**Correction to the brief's premise**: agentbox is not payment-naive. There is
a working (test-gated, partially deployed) HTTP-402 "Web Ledger" economy with
both a sell-side (agentbox charges) and buy-side (agentbox pays) leg, a
DREAM-token wrapper, and receipt/activity provenance minting. Full narrative
in `docs/developer/economy-loop.md` (canonical source; summarised + verified
against code below).

### 2.1 Sell-side: `payment-gate.js` / `cost-gate.js`

- `management-api/middleware/payment-gate.js:172-253` (`paymentGate`) —
  Fastify preHandler factory. Resolves cost (`_resolveCost`,
  `payment-gate.js:124-140`, fixed/tier/dynamic), queries balance via
  `GET http://127.0.0.1:<SOLID_POD_PORT>/pay/.balance`
  (`payment-gate.js:37,54-79`), and on insufficient balance returns **HTTP
  402** with a body that is legacy-compatible (`deposit_endpoint`,
  `cost_sats`, etc., `payment-gate.js:205-213`) plus an **additive**
  `accepts[]` x402-style array gated on `manifest.payments.broadcast.accepts_block`
  (`payment-gate.js:216-218`, default true per `agentbox.toml:1468`). On
  success it POSTs a deduction to `/pay/.deduct`
  (`payment-gate.js:85-115,226-238`) and decorates the response with
  `X-Cost`/`X-Balance`/`X-Pay-Currency` headers (`payment-gate.js:242-244`).
- `management-api/middleware/cost-gate.js:23-73` — a narrower, task-scoped
  gate applied only to `POST /v1/tasks`
  (`cost-gate.js:28`); reads `body.cost_sats`, requires
  `request.authenticatedDid` (set by NIP-98 auth), fails open unless
  `COST_GATE_FAIL_CLOSED=true` (`cost-gate.js:67-70`) — **an explicit,
  documented fail-open default on payment-backend outage**, worth flagging
  for a sidechain settlement path where fail-open on a chain-reachability
  timeout would be a different risk profile than fail-open on a local pod.
- `management-api/routes/payments.js:1-30` documents the full route set:
  `GET /v1/pay/info`, `GET /v1/pay/balance`, `POST /v1/pay/deposit`,
  `POST /v1/pay/estimate`, `POST /v1/pay/buy` (buy DREAM with sats),
  `POST /v1/pay/withdraw` (burn DREAM for sats). All proxy to a local
  `solid-pod-rs` instance on `SOLID_POD_PORT` (default 8484) except
  `/estimate` which is computed locally from env-var tier multipliers
  (`payments.js:14-24`). **The actual ledger state (balances, deposits,
  TXO validation) lives in `solid-pod-rs`, a separate repo, not in
  agentbox.** agentbox is a thin proxy + policy layer over it.

### 2.2 Buy-side (consumer) pipeline — PRD-015 Phase 1, already landed

Per `docs/developer/economy-loop.md` ("Consumer pipeline" section) and
verified against the named files:

- **C1 classifier** — `management-api/lib/pay402.js:1-343`. Pure function,
  never throws, 64 KiB body cap (`pay402.js:38,180-182`). Recognises three
  payable-shape schemes in strict precedence: `agentbox-ledger` (402 + either
  `accepts[]` entry or legacy `X-Pay-Currency: sats` header +
  `deposit_endpoint`, amount-mismatch detection, `pay402.js:184-237`), `x402`
  (402 + integer `x402Version` + `accepts[]` with `scheme`/`network`,
  `pay402.js:239-268`), `l402`/`lsat` (402 **or 401**, `WWW-Authenticate:
  L402|LSAT` with `macaroon` + a valid `lnbc*/lntb*/lnbcrt*` invoice,
  `pay402.js:270-304`). Everything else is `unknown`, terminal, fail-closed
  (`pay402.js:306-309`). **`payable` is only ever `true` for
  `agentbox-ledger`** and only when `process.env.CONSUMER_ENABLED === 'true'`
  (`pay402.js:234`) — x402 and l402 classify correctly today but are
  **structurally unpayable in this codebase** (no native Lightning rail; see
  GAPS).
- **C3 spend policy** — `management-api/middleware/spend-policy.js:82-194`.
  Fail-closed on every branch: master `enabled` gate
  (`spend-policy.js:99-102`), `max_sats_per_call` hard cap
  (`spend-policy.js:117-120,159-163`), rolling in-memory (not persisted —
  `spend-policy.js:39` comment: "never written to disk; reset on process
  restart") `daily_budget_sats` keyed by `date|origin`
  (`spend-policy.js:36-63,166-178`), `approval_threshold_sats` sets
  `request.requiresApproval` without denying (`spend-policy.js:180-189`),
  origin allow/deny lists (`spend-policy.js:113-140`). Driven entirely by
  `manifest.payments.consumer.*` — no code path bypasses the manifest.
- **C2 native payer** — `management-api/middleware/consumer-payer.js` (named
  in `economy-loop.md`'s file table; not separately re-read here beyond that
  citation) — POSTs `/v1/pay/deposit` with an idempotency key, single retry.
- **C4 receipt/activity URN minting** — `management-api/lib/receipt-minter.js:1-70+`.
  `mintSpendReceipt`/`mintSpendActivity` (`receipt-minter.js:35-56` and
  continuation) mint `urn:agentbox:receipt:*` / `urn:agentbox:activity:*`
  through `lib/uris.js` `mint()` (sole-mint discipline, ADR-013), called on
  **every** spend attempt — paid, denied, failed, pending-approval
  (`receipt-minter.js:20-24` `OUTCOMES` enum) — "so the audit trail has zero
  gaps" (`receipt-minter.js:8-9`). Both functions are unconditionally
  try/catch and never throw (`receipt-minter.js:9-10`, confirmed by the
  `catch (_e) { return 'urn:agentbox:receipt:error:mint-failed' }` pattern at
  `receipt-minter.js:52-54`).
- **B2 enriched 402 challenge** — the same `payment-gate.js` (§2.1) — additive
  `accepts[]`.
- **B1 well-known manifest** — `management-api/routes/well-known.js` serves
  `/.well-known/x402.json` (gated on `manifest.payments.broadcast.well_known`,
  `agentbox.toml:1467`), generated at boot (per `economy-loop.md`).
- **C5 skill** — `skills/payment-router/scripts/pay-fetch.mjs` — `payFetch()`,
  a drop-in 402-aware `fetch` wrapper. `[skills.payment_router].enabled = false`
  by default (`agentbox.toml:1472-1473`, comment: "C5 — enable with
  `[payments.consumer].enabled = true`").
- **D4 contract corpus** — `tests/contract/pay402/` (captured-bytes fixture
  corpus + merge gate, per `economy-loop.md`; directory confirmed present at
  `tests/contract/` listing, §3 below).

### 2.3 Manifest surface — `agentbox.toml [payments]` block

`agentbox.toml:1437-1490` verified directly:

```toml
[payments]
enabled = true
backend = "solid-pod-rs"
base_cost_sats = 10
dream_per_sat = 10
hold_buffer_ratio = 1.2

[payments.tiers]        # agentbox.toml:1444-1447
inference = 10; image_gen = 100; analytics = 5

[payments.token]        # agentbox.toml:1449-1453
ticker = "DREAM"; rate = 10; supply = 1000000
issuer = ""            # populated from OPERATOR_NOSTR_PUBKEY at runtime

[payments.consumer]     # agentbox.toml:1456-1463 — PRD-015 Phase 1
enabled = false                # opt-in
max_sats_per_call = 100
daily_budget_sats = 1000
approval_threshold_sats = 50
allow_origins = []; deny_origins = []
external_router = "off"        # "off" | "cinderwright" (C9; custody warning)

[payments.broadcast]    # agentbox.toml:1465-1470
enabled = false; well_known = false; accepts_block = true
health_signals = false; index_submit = "off"

[skills.payment_router]  # agentbox.toml:1472-1473
enabled = false
```

**A `[sidechain]` or `[payments.sidestr]` block does not exist.** The nearest
manifest precedent for "an external settlement/routing option that needs a
custody warning" is `payments.consumer.external_router = "off" |
"cinderwright"` (`agentbox.toml:1463`) — the comment flags "custody warning"
already, i.e. the manifest authors have already anticipated a third-party
custodial router option and gated it off by default. A sidestr rail is
structurally the same shape of decision.

### 2.4 System-manifest catalogue entry

`management-api/lib/system-manifest.js:188-190`:
```js
{ id: 'payments', name: 'Payments (x402 ledger)', layer: 'module',
  gate: 'payments', apply_class: 'boot',
  summary: 'HTTP-402 web ledger: deposit, estimate, buy, withdraw.' }
```
Confirms `apply_class: 'boot'` (ADR-039 classes: live/boot/rebuild, per
`agentbox/CLAUDE.md` "Rules for changes"). A `[sidechain]` gate would need its
own catalogue row here with an honest apply class — likely `boot` if it's a
config/env toggle for an external node URL, `rebuild` if it bakes a sidestr
node binary into the Nix image.

### 2.5 ADR-2065 / INGRESS-identity.md — "payment dispatch" consumer, found

`docs/INGRESS-identity.md:354`: *"ADR-2065 — CONSOLIDATE: exactly one process
writes `pods/<npub>/events/inbox/` — the Rust `nostr-pod-bridge` daemon when it
is running — ending a live duplicate write whose file-existence dedup was
silently suppressing the JS consumer's ACSP governance, agent-intent and
payment dispatch; the JS consumer is narrowed, not deleted, because it is
still the only implementation of those four surfaces."*

This describes a **JS consumer of `pods/<npub>/events/inbox/`** that reads
inbound Nostr events and dispatches ACSP governance actions, agent-intent
actions, and **payment actions**. The exact consumer file is not named in this
sentence; based on the surface names ("ACSP governance", "agent-intent",
"payment dispatch") the most likely candidate given the rest of the codebase
is `management-api`'s inbox-poll/event-dispatch loop feeding into
`lib/authority.js` (governance, §6) and `routes/payments.js` (payment) — but
**this report could not locate the exact dispatch function by name in the
time available; flagged as a follow-up grep** (`grep -rn "events/inbox"
management-api/`). What is certain from the ADR-2065 text: this is a **live,
non-stub consumer** — it is being narrowed (not deleted) precisely because
production traffic depends on it.

### 2.6 ADR-032, DDD-006, PRD-015 — the design series behind all of §2

- `docs/archive/adr/ADR-032-402-scheme-grammar.md` — the security-gate scheme
  grammar `pay402.js` implements verbatim (its docstring at
  `pay402.js:6` cites ADR-032 D2 directly).
- `docs/archive/ddd/DDD-006-llm-marketplace-domain.md` — a *different*
  economy: LLM resource adverts/grants over Nostr kinds 38300–38305
  (confirmed live: `management-api/lib/system-manifest.js` catalogue entry
  `llm-marketplace`, `gate: 'llm_marketplace'`, `apply_class: 'boot'`,
  "LLM resource adverts/grants over nostr kinds 38300-38305" — this is
  adjacent to but separate from the sats ledger; it's a barter/grant system,
  not currency).
- `docs/archive/prd/PRD-015-consumer-broadcast-economy.md` — the PRD behind
  the buy-side pipeline in §2.2 (title from filename; content summarised via
  `economy-loop.md`, which cites it directly in its own title line).

### 2.7 Known gap already documented by the maintainers

`docs/developer/economy-loop.md` (top of file, "Known gap" callout):
*"receipt crossing to the host graph is not yet wired.
`bc20.crossOutbound()` is invoked only from the test/runner tier … no
production caller crosses into the host graph, and nothing on the host
consumes the durable `UrnMapping` table. The `Host` lane below is design, not
a live path."* This is the single clearest self-admission in the repo that
the economy loop's cross-repo provenance leg is design-only.

---

## 3. Adapters — five slots, no sixth for finance

### 3.1 The five slots and the middleware order

- `docs/adr/ADR-2004-five-adapter-slots.md` (title from index row,
  `docs/adr/README.md`: *"Durable state rides exactly five adapter slots;
  orchestrator boot-probe failure is fatal, the other four degrade to off"*).
  Decision status accepted, implementation partial, activation live.
- Slots confirmed by directory listing: `management-api/adapters/`
  contains `beads/`, `events/`, `memory/`, `orchestrator/`, `pods/` plus
  shared `base.js`, `contract-versions.js`, `errors.js`, `lifecycle.js`,
  `manifest-loader.js`, `index.js`.
- Middleware order: `docs/adr/ADR-2005-dispatch-middleware-order.md` (title:
  *"Every adapter dispatch is wrapped in a fixed order — observability, then
  privacy filter, then JSON-LD encoder"*) is **superseded by ADR-2036**
  (`docs/adr/README.md` row: ADR-2005 status "superseded" → "ADR-2036";
  ADR-2036 file: `docs/adr/ADR-2036-dispatch-two-layer-encoder-is-a-gated-surface.md`
  — makes the JSON-LD encoder layer itself a two-layer, separately-gated
  surface rather than a single stage).
- Contract tests: `tests/contract/` (listing captured directly) includes
  `adapter-lifecycle.contract.spec.js`, `pods.contract.spec.js`,
  `memory.contract.spec.js`, `events.contract.spec.js`,
  `orchestrator.contract.spec.js`, `beads.contract.spec.js`,
  `capability-scope.contract.spec.js`, `execution-journal.contract.spec.js`,
  and a `pay402/` subdirectory (D4 in §2.2) — i.e. the payment contract
  corpus already lives inside `tests/contract/` alongside the five-slot
  contracts, not as a sixth slot's contract set.

### 3.2 "No sixth adapter slot" — the colloquy precedent, read in full

`docs/adr/ADR-2085-colloquy-knowledge-units-on-the-forum.md:54-55`:
*"No sixth adapter slot. Colloquy consumes the existing `memory` and `events`
slots. A knowledge store is a consumer of durable state, not a new class of
it."* — i.e. the rule the maintainers apply is: **a new capability is a
*consumer* of the existing five slots (typically `memory` and/or `events`),
never a reason to add a slot**, provided its state shape is expressible as
memory rows or event-stream entries.

`CLAUDE.md` (agentbox root) states the same for `colloquy-store`
specifically: *"`colloquy-store` (local / shared / relay behind one trait,
transports as traits, **published**; **no sixth adapter slot**)"*. Confirmed
in code: `crates/colloquy/colloquy-store/src/{local,shared,relay,store}.rs`
exist as separate transport implementations behind what the CLAUDE.md
describes as one trait (not independently re-verified line-by-line here, but
the file layout matches the claim).

**Implication for a financial/ledger capability**: under this precedent, a
sidestr integration should **not** propose a sixth "ledger" adapter slot. The
existing pattern is either (a) a new consumer library (like
`colloquy-backends`/`colloquy-mcp`) that reads/writes through `memory` and
`events`, mirroring how payments already work (payment state itself lives in
`solid-pod-rs`, outside all five slots — see §2.1; the *provenance* of a spend,
i.e. receipts/activities, is what rides the `pods`/`memory`/`events` surfaces
via URN minting), or (b) a new external service (like `solid-pod-rs`) that
agentbox proxies to, exactly as it already does for the sats ledger. A sidestr
node would most naturally slot in as **(b)**: a sidecar service agentbox talks
to over HTTP, the same shape as `solid-pod-rs` is today.

### 3.3 ADR-005 / ADR-031 — original adapter architecture + contract enforcement

`docs/archive/adr/ADR-005-pluggable-adapter-architecture.md` — the original
(pre-consolidation) five-slot pitch, referenced live in
`agentbox/CLAUDE.md` ("Architecture in one paragraph": *"Durable state goes
through five adapter slots (beads, pods, memory, events, orchestrator;
ADR-005)"*). `docs/archive/adr/ADR-031-adapter-contract-enforcement.md` is the
archived contract-test mandate that `tests/contract/` implements today.

---

## 4. Manifest gating

### 4.1 `agentbox.toml` — top-level block inventory (full list, verified)

Full ordered list of top-level `[section]` headers extracted directly from
`agentbox.toml` (105 sections; relevant ones already covered above:
`[payments]` §2.3, `[sovereign_mesh]` §1/§5, `[skills.authority]` §6). Two
more relevant to money:

- `[llm_marketplace]` (`agentbox.toml:312`) — the DDD-006 barter/grant
  economy (§2.6), separate manifest gate from `[payments]`.
- `[mesh]` (`agentbox.toml:251`) — general mesh config, not payment-specific
  (not read in depth; flagged for completeness).
- **No `[federation]` top-level block exists** in `agentbox.toml` — federation
  mode is instead `[sovereign_mesh.multi_user]`'s comment block referencing
  "Mesh federation (PRD-010 Phase 3 / ADR-073)" with a `mode` field
  (`agentbox.toml:241-251`, values `standalone`/`federated` documented in the
  comment at line 246-248, though the `mode` key itself sits in
  `[sovereign_mesh.multi_user]` per the grep context, not a separate
  `[federation]` table — **the brief's premise of a top-level `[federation]`
  block is not accurate; correct it to `[sovereign_mesh.multi_user]`'s
  federation-mode comment**).

### 4.2 How a `[sidechain]` / new `[payments.sidestr]` gate would be declared

Following the exact pattern of `[payments.consumer]` (§2.3) and the
system-manifest catalogue entry (§2.4):

1. Add a manifest block, e.g. `[payments.sidestr]` (nested under the existing
   `[payments]` namespace, matching how `.consumer`/`.broadcast`/`.tiers`/
   `.token` already nest — `agentbox.toml:1444-1470`) with an `enabled` master
   gate (fail-closed default per the spend-policy precedent, §2.2) and an
   explicit custody/trust-model field (mirroring
   `external_router = "off" | "cinderwright"`, `agentbox.toml:1463`).
2. Add a `system-manifest.js` catalogue row
   (`management-api/lib/system-manifest.js`, following the `payments` entry
   at lines 188-190) with an honest `apply_class` — `boot` if it's a
   config/endpoint toggle, `rebuild` if it bakes a sidestr client binary
   into the Nix image (per ADR-039/ADR-2069, referenced in
   `agentbox/CLAUDE.md` "Rules for changes": *"When adding a gate, add a
   `system-manifest.js` catalogue entry with an honest apply class
   (`live`/`boot`/`rebuild`, ADR-039)"*).
3. If it needs a supervised process (a sidestr node/light-client daemon),
   follow the `[sovereign_mesh.relay]` pattern (`agentbox.toml:144-222`) —
   `implementation`, `port`, `bind` (loopback default per ADR-2013
   sanctioned-exposure list, `docs/adr/ADR-2013-loopback-publish-except-9096.md`),
   `data_dir`.
4. Nothing in the manifest-gate machinery is finance-specific — the mechanism
   is generic TOML-table-existence + `enabled` boolean, read by
   `management-api/adapters/manifest-loader.js` and (at boot) by
   `services/agentbox-manifest` (the Rust projector, per
   `agentbox/CLAUDE.md`'s canonical-runtime-files list).

---

## 5. Nostr plumbing

### 5.1 Relay allowlist (ADR-2012) and the daemon relay slot

`agentbox.toml:144-159` (`[sovereign_mesh.relay]`): `implementation =
"nostr-rs-relay"`, port 7777, bind `127.0.0.1`, `ingress_policy =
"allowlist"`, and the load-bearing comment: *"Strict allowlist consumed by
nostr-pod-bridge `authorize()` — there is NO fallback and NO auto-add: empty =
every inbound relay event is dropped. (The operator pubkey is NOT auto-added
at boot …) Add 64-char hex pubkeys to admit them. Baked into the supervisor
env at nix build time (flake.nix relayAllowedPubkeysCsv) — changes need a
rebuild."* (`agentbox.toml:151-159`). This matches
`docs/adr/ADR-2012-relay-allowlist-only-ingress.md` (title from index).
**Any sidestr tx/tip event a peer publishes into this relay would need its
publishing pubkey pre-baked into `allowed_pubkeys` at image build time** —
there is no runtime admission path. This is a real integration friction point:
a sidechain settlement notary or a peer agent's pubkey would need a rebuild to
be admitted, not a config reload.

### 5.2 Kinds already registered (assembled from direct grep, not a single
registry file — `docs/PROTOCOL-registry.md` covers cross-repo URN/BC20
concerns only, not the full Nostr kind list)

| Kind | Purpose | Citation |
|---|---|---|
| 1059 | NIP-59 gift wrap (unwrapped by `nostr-pod-bridge`) | `agentbox.toml:78` |
| 27235 | NIP-98 HTTP auth event | `agentbox.toml:184`; `docs/INGRESS-identity.md:80,88,181` |
| 30840 | Session-summary digest (`nostr-pod-bridge session-summary`) | `agentbox.toml:80,90`; `CLAUDE.md:70`; `docs/README.md:57` |
| 30841 | Project-tracking telemetry digest (addressable) | `agentbox.toml:1501-1516`; `docs/README.md:166` (ADR-035) |
| 30910 | NIP-58 invite / ban events | `agentbox.toml:235,260` |
| 31402 | ACSP ActionRequest (governance gate) | `agentbox.toml:106,112,118,1005`; `docs/GOVERNANCE-capabilities.md:343` |
| 31403 | Human approval of a 31402 (signed) | `docs/GOVERNANCE-capabilities.md` (§6 below); `docs/adr/ADR-2085-…md` graduation flow |
| 38000–38099 | Agent-intent block (agentbox-owned, spent) | `docs/adr/ADR-2085-colloquy-knowledge-units-on-the-forum.md:41-44` |
| 38100–38105 | Colloquy: KnowledgeUnit/Confirmation/Flag/Supersession/Graduation/ToolGapSignal | same file, lines 40-48; table also in `docs/PROTOCOL-registry.md:85-90` |
| 38000–38201 | Full agentbox-owned Nostr kind block | `docs/adr/ADR-2085-…md:42-43` ("The block `38000–38201` is agentbox's") |
| 38300–38305 | LLM marketplace adverts/grants | `management-api/lib/system-manifest.js` `llm-marketplace` catalogue entry; `agentbox.toml:315` |

**Where would kind 23500/33333 (sidestr tx/tip) traffic go?** Neither kind
number is referenced anywhere in the repo (confirmed: no hits for `23500` or
`33333` in the grep sweep). agentbox's own owned block is `38000–38201`
(§ above) — a sidestr kind in the `2xxxx`/`3xxxx` range the brief names would
either (a) need to be registered as *externally*-owned (consumed, not
published, by agentbox — the relay would need `ingress_policy`/allowlist
admission for whatever pubkeys publish it, §5.1) or (b) if agentbox itself is
meant to *publish* sidestr events, a new kind would need to be carved out of
the still-open `38106–38201` range within agentbox's owned block, following
the ADR-2085 precedent of "allocate N kinds inside the block this repo
already owns" (`ADR-2085-…md:42`). No ADR proposes either today.

### 5.3 nip98-proxy

`config/nip98-proxy/` — sole NIP-98-verifying ingress to AoE `:9095`, LAN
`:9096`, `/mgmt/` → management-api (per `agentbox/CLAUDE.md`'s canonical-files
table). This is the boundary a wallet-authorising request (e.g. "approve this
spend") would cross if driven through the AoE interaction plane rather than a
direct management-api call; the *payment* routes themselves
(`/v1/pay/*`) sit behind management-api's own NIP-98/bearer auth hook
(`management-api/routes/payments.js:29` "Auth: all routes are behind the
global onRequest auth hook (bearer/NIP-98)"), not specifically behind
nip98-proxy — the proxy is the AoE session-lifecycle door, not every route's
door.

### 5.4 Session mirror

`config/hooks/nostr-live-mirror.cjs` (per root `workspace/CLAUDE.md`) — NIP-59
gift-wrapped self-DM per-turn mirror, off switch `AGENTBOX_LIVE_MIRROR=0`,
fail-open. Not payment-specific; noted only because it's the other live Nostr
egress path alongside session-summary and would need explicit exclusion if a
sidestr payment confirmation should NOT be mirrored to the operator's private
relay by accident (no such interaction exists today; flagging as a design
question, not a bug).

---

## 6. Governance — what would gate a spend, verified against code

### 6.1 The action-authority axis already classifies payments as zero-tolerance

`agentbox.toml:967-1070` (`[skills.authority]`), directly confirmed:

```toml
[skills.authority.classes]
payment_settlement = "zero-tolerance"   # irreversible above-threshold sats spend
...
[skills.authority.task_properties.classes.payment_settlement]
verifiability = "inspectable"  # an on-chain / ledger settlement is checkable
stakes        = "critical"
```

This is the single most important governance finding for the sidestr
integration: **`payment_settlement` already exists as a named, zero-tolerance
action class**, alongside `pod_delete`, `pod_git_push`, `mandate_revoke`,
`ontology_axiom_load`. Zero-tolerance means (per
`docs/GOVERNANCE-capabilities.md` Invariants, §6.2) it must block on a signed
31402→31403 round-trip before proceeding, and `zero-tolerance ⇒ irreversible`
is asserted as an **invariant, never a default someone can loosen**
(`docs/GOVERNANCE-capabilities.md:348`, `agentbox.toml` comment at line ~1000
region). A sidestr on-chain settlement is *exactly* the shape of action this
class already anticipates (comment says "on-chain / ledger settlement is
checkable" — `agentbox.toml`, `task_properties.classes.payment_settlement`
block).

### 6.2 Task-property triple, authority.deny journal, receipts (ADR-2087)

`docs/GOVERNANCE-capabilities.md:337-360` (Invariants section), verified:

- The boundary is a property of the **task**, not the requesting agent
  (ADR-2011/ADR-2087) — every 31402 carries `tp-verifiability`,
  `tp-reversibility`, `tp-stakes` tags, computed by
  `management-api/lib/task-properties.js:172` from `[skills.authority.classes]`
  + `[skills.authority.task_properties]` (`docs/GOVERNANCE-capabilities.md:350-352`).
  An agent may only *tighten* its own declared `task_properties`, never loosen
  (`GOVERNANCE-capabilities.md:352`).
- **No gate outcome is silent** (`GOVERNANCE-capabilities.md:355-357`,
  ADR-2087): every deny path in `management-api/lib/authority.js:213` appends
  a hash-chained `authority.deny {agent_did, stage, reason, action_class,
  operation_sha256}` event through the events adapter (ADR-039 hash chain)
  and to `/v1/agent-events`. A journalling failure is logged loudly and never
  silently converts a deny into an exception (fail-closed on the action,
  fail-open on the record).
- **A mutation owner reports the outcome to the approving human**
  (`GOVERNANCE-capabilities.md:358-360`, ADR-2087): each
  `ApplicationReceiptStore` stage mirrors to the forum receipts endpoint under
  NIP-98 via `management-api/lib/governance-receipt-publisher.js`. Transport
  failures journal as `authority.receipt-post-failed` and queue for replay.
  An `unknown` local outcome publishes **nothing** — deliberately, "the ladder
  has no stage for 'we do not know'".

### 6.3 Judgment-broker / human-approval surfaces

Not separately re-verified beyond the 31402/31403 mechanism already cited
(§6.1-6.2) and the ADR-2085 graduation reuse
(`docs/adr/ADR-2085-…md:58-60`: *"Graduation reuses the governance round-trip.
A promotion emits `31402`; the human approves with a signed `31403`; the
unit's graduation record cites that event id in an additive
`authorising_event` field."*) — this is the same mechanism a sidestr
settlement approval would reuse: emit 31402 with `tp-*` tags computed from
`payment_settlement`'s existing class entry, wait for a signed 31403, record
the approving event id.

### 6.4 What this means for a spend gate concretely

**No new governance mechanism is needed to gate a sidestr spend above a
threshold.** The existing `payment_settlement` zero-tolerance class,
task-property stamping, deny journal, and receipt-mirroring machinery already
covers it end-to-end, *provided* the sidestr settlement call is routed through
whatever code path calls `lib/authority.js`'s gate before executing — which
today is presumably the existing `/v1/pay/*` routes for the sats ledger
(§2.1), but **it was not verified in this pass whether `routes/payments.js`
actually calls into `lib/authority.js`/`payment_settlement` classification, or
whether that gate is currently wired only to skill-execution paths** (the
class name and the `payment-gate.js`/`spend-policy.js` middleware in §2 appear
to be a *parallel*, older mechanism — flagged as a GAP below, needs a direct
grep of `authority.js` call sites against `routes/payments.js`).

---

## 7. Docs conventions

- **Template**: `docs/adr/TEMPLATE.md` — three-axis status
  (`decision_status`/`implementation_status`/`activation_status`), mandatory
  `verified_commit`+`verified_paths` (pathspecs, globs preferred where the
  `review_trigger` names a growable set — `docs/adr/README.md`'s "Arm the
  gate…" paragraph), `owner`, `review_trigger`, `repo` (`visionclaw |
  agentbox`).
- **Next free ADR number**: **ADR-2096** (last is ADR-2095 per the git log
  supplied in this session's context — `ADR-2095-measure-typed-decision-seams-against-a-copy-ceiling.md`
  confirmed as the last file in `docs/adr/` by directory listing, §ls output
  above).
- **Next free PRD number**: **PRD-023** (last is `PRD-022-semantic-integrity-provenance-decisions.md`,
  confirmed by `ls docs/archive/prd | tail`). Note PRDs live under
  `docs/archive/prd/` even for numbers as recent as 022 — the "archive" label
  in this repo means "PRD corpus", not necessarily superseded; only the ADR
  series moved to the thin `docs/adr/` ledger post-consolidation.
- **Next free DDD number**: **DDD-021** (last is
  `DDD-020-semantic-integrity-provenance-domain.md`, same directory pattern).
- **Index regeneration**: `node scripts/adr-index-gen.js docs/adr`
  (`docs/adr/README.md` header comment: *"GENERATED BY scripts/adr-index-gen.js
  — DO NOT EDIT BY HAND"*; confirmed file exists at
  `./scripts/adr-index-gen.js`).
- **Invariants CI**: `.github/workflows/invariants.yml` (confirmed present)
  — per `docs/adr/README.md`: *"invalid frontmatter, asymmetric supersession
  edges, and stale `verified_commit`+`verified_paths` claims all fail the
  build."*
- **Re-verification discipline** (worth internalising for any new sidestr
  ADR): `docs/adr/README.md`'s long paragraph on "read and check, never diff
  and bump" — a `verified_commit` bump requires re-running the domain's own
  gate/tests against that exact commit, not just confirming the diff looks
  irrelevant; the worked 2026-09-21 example (ADR-2030 falsified by a file
  outside its own `verified_paths`) is a direct warning against narrow
  `verified_paths` globs for a fast-moving new subsystem like a sidestr
  client.

---

## 8. Colloquy crates — reusable as a spend-authorisation model?

### 8.1 The "authorising principals" model, precisely

`docs/adr/ADR-2086-confirmation-weight-follows-authorising-principals.md`
(full read, §1 above already summarised its content in-line):

- Unit of trust = **authorising principal**, not account. A human's principal
  is themself; an agent's principal is whoever registered it
  (`agent_registry.registered_by`, served at `/api/agents/disclosure`).
  N agents under one principal contribute that principal's weight **once**.
- **Unregistered pubkey → dropped, never self-authorising** — the explicit
  design choice against the "if we don't know who authorises them, they
  authorise themselves" default, because that hands an attacker exactly the
  Sybil vector the collapse rule exists to prevent.
- Human principal draws a WoT-derived multiplier capped at **3×** an agent
  principal; an agent under a different principal draws full weight.
- Graduation **counts** principals (2 distinct + ≥1 human for shared tier; 3 +
  signed approval for public tier) rather than **weighing** them — because a
  maximally-trusted principal (3.0) could otherwise clear any weight threshold
  alone, and self-approval must be structurally impossible, not merely
  discouraged.
- A flag suppresses nothing by itself (subtracts one principal's weight,
  marks `Disputed`, still served); only a signed 31403 retires a unit — no
  single member can unilaterally remove knowledge.
- Test coverage named directly in the ADR's Verification section:
  `principal.rs::three_principals_outrank_eight_hundred_accounts_under_two`,
  `a_swarm_under_one_principal_collapses_to_one`,
  `the_human_cap_is_worth_exactly_three_agent_operators`,
  `graduation.rs::one_trusted_human_cannot_promote_alone`,
  `ledger.rs::unregistered_pubkeys_are_dropped_and_reported_not_self_authorised`,
  `ledger.rs::revoking_an_agent_retracts_its_past_confirmations`.

### 8.2 Is it reusable for spend authorisation / multi-agent-one-voice?

**Structurally, yes, with two caveats.** The model is exactly "an operator's
fifty agents are one voice" (`agentbox/CLAUDE.md`'s own summary line), which
is precisely the shape of a multi-sig-avoidance problem for agent wallets: if
ten of an operator's agents each try to independently "confirm" a spend, the
colloquy model already collapses that to the operator's single principal
weight rather than letting agent count manufacture consensus. Caveats:

1. **It is a knowledge/confirmation model, not a value-transfer model.** Its
   crates (`colloquy-core`, `colloquy-nostr` kinds 38100-38105, `colloquy-store`)
   are wired to the forum/knowledge-unit domain — reusing it for spend
   authorisation means either generalising `colloquy-core`'s
   `ConfirmationPolicy`/`GraduationPolicy` types to a value-transfer context
   (a real refactor, not a drop-in), or building a parallel
   `SpendAuthorisationPolicy` that imports the same principal-collapse logic
   from `colloquy-core` (published, pure, wasm-capable per
   `agentbox/CLAUDE.md`'s crate description) as a library dependency. The
   latter is cheap given `colloquy-core` is already a published,
   dependency-light crate.
2. **Revocation semantics need re-checking for money.** "Revoking an agent
   retracts its past confirmations on the next reconstruction" (ADR-2086
   Consequences) is a fine behaviour for a knowledge base (a stale fact stops
   being counted) but would be a much sharper edge for a spend that has
   already settled on a sidechain — you cannot retroactively un-confirm a
   transaction that already cleared. Any reuse for spend authorisation needs
   an explicit point-in-time freeze (a receipt, in the existing
   `receipt-minter.js` vocabulary, §2.2 C4) rather than relying on
   colloquy's live-reconstruction confidence model for anything that has
   already executed.

The `colloquy-backends` crate (internal, not published) is the one already
bound to `nostr-bbs-core` signing and the governed `ruvector-mcp.cjs` — it is
the crate to look at for "how does this estate actually sign and dispatch a
governed multi-agent action today", since it is explicitly the production
transport layer, not the pure model.

---

## GAPS — honest inventory

1. **`txo[]` (BIP-341 single-use-seal / RGB / DLC anchor) is a named,
   documented, zero-percent-implemented seam.** `contract.rs:128,240-260`
   constructs `Blocktrail.txo` empty and never appends to it anywhere in the
   codebase. This is the *exact* integration point ADR-033 names for a
   sidechain, and it is entirely unopened. (§1.1, §1.2)

2. **No `wallet`/`asset`/`payment`/`ledger` URN kind exists.** The 20 kinds in
   `uris.js` cover `mandate`/`receipt` for the existing sats economy but
   nothing sidechain-specific. Adding one is a low-risk, well-precedented
   change (follow the `knowledge`/`bead` pattern) but is not done. (§1.5)

3. **Pod-request signing from the sovereign identity is explicitly unwired**
   (`sign_requests = false`, ADR-2064, pending ADR-2078) — the fail-closed
   adapter throws `SigningUnavailable` if flipped without key material. Any
   sidestr flow that needs agentbox's pod layer to sign on the agent's behalf
   inherits this exact gap. (§1.6)

4. **The existing sats ledger is not actually on-chain anywhere.** `/v1/pay/*`
   proxies to `solid-pod-rs`'s in-memory-or-FS-backed ledger
   (`payment-gate.js`, `routes/payments.js`) — "Web Ledger" is a
   database/API abstraction, not a Bitcoin-anchored balance. The
   `economy-loop.md` demo itself flags that receipt-crossing to the host
   provenance graph "is not yet wired" — the entire chain from a paid read to
   a durable cross-repo record has a documented missing link at the very
   last hop. (§2.7)

5. **x402 and l402 schemes classify but are `payable: false` by construction**
   (`pay402.js:262-266,297-303`) — there is no native Lightning rail
   (`economy-loop.md`: "Phase 3 adds Lightning via NWC" — Phase 3 is
   unimplemented; this session found no NWC/nip47 wiring anywhere outside
   `node_modules/nostr-tools`, i.e. the *library* is vendored but nothing in
   agentbox's own code calls it). A sidestr rail would presumably be a fourth
   scheme in this same classifier, following the `agentbox-ledger` pattern.

6. **Daily spend budget is in-memory only, resets on restart**
   (`spend-policy.js:36-39` module comment) — not persisted, not
   multi-process safe. A production spend gate for real money would need this
   moved into a durable store (one of the five adapter slots, per §3.2's
   "consumer of existing state" rule — most naturally `memory` or a
   dedicated ledger table inside `solid-pod-rs`).

7. **`COST_GATE_FAIL_CLOSED` defaults to fail-**open** on payment-backend
   unreachability** (`cost-gate.js:67-70`). Acceptable for a sats micro-debit
   against a local pod; almost certainly the wrong default if the same gate
   is reused in front of an on-chain settlement call, where "backend
   unreachable" could mean "cannot verify whether this already spent".

8. **This session could not confirm whether `routes/payments.js` actually
   invokes `lib/authority.js`'s `payment_settlement` zero-tolerance class.**
   The manifest declares the class; `payment-gate.js`/`spend-policy.js`
   enforce balance/budget caps independently. Whether a large sats spend
   today actually blocks on a signed 31402/31403 round-trip, or only on the
   numeric caps in `spend-policy.js`, was not verified — this is the single
   most important follow-up grep for anyone wiring sidestr settlement into
   the governance gate (§6.4).

9. **The exact JS consumer of `payment dispatch` named in ADR-2065
   (`docs/INGRESS-identity.md:354`) was not located by name** in the time
   available. Needs `grep -rn "events/inbox" management-api/` as a direct
   follow-up. (§2.5)

10. **`[federation]` as a standalone top-level manifest block does not
    exist** — the brief's premise names it; the real surface is
    `[sovereign_mesh.multi_user]`'s federation-mode comment
    (`agentbox.toml:241-251`) plus the separate, unrelated `federation.mode`
    reference in `agentbox/CLAUDE.md`'s architecture paragraph (*"federation.mode
    selects standalone vs client"* — this appears to describe a *different*,
    higher-level adapter-federation concept from `ADR-005`/PRD-001, not the
    `sovereign_mesh` block; the two uses of "federation" in this repo are not
    obviously the same axis and this report did not have time to reconcile
    them — flagged, not resolved). (§4.1)

11. **No kind 23500 or 33333 (or any sidestr-shaped kind) is referenced
    anywhere in the repository.** Confirmed by direct grep with zero hits.
    (§5.2)

12. **The `[llm_marketplace]` barter economy (kinds 38300-38305, DDD-006) and
    the `[payments]` sats economy are parallel, apparently non-interacting
    systems** — this report did not verify whether they share any settlement
    logic or are entirely independent stacks (both are gated `apply_class:
    'boot'` in `system-manifest.js` but that only means "toggled without a
    rebuild", not "integrated"). A sidestr design should decide explicitly
    which of these two existing economies (or neither) it is meant to unify
    with, rather than becoming a third parallel value system.

13. **Colloquy's principal-collapse model is not yet a library dependency of
    anything payment-related.** Reuse for spend-authorisation is a proposal
    in this report (§8.2), not an existing wiring.
