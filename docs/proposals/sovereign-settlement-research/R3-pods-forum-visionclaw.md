# R3 — Money/Value/Asset Surfaces: solid-pod-rs, VisionClaw/VisionFlow, nostr-bbs, dreamlab-cumbria, AoE

Purpose: map EXISTING money/value/asset surfaces across the estate ahead of integrating the sidestr
Nostr-only Bitcoin sidechain (+RGB) as the financial substrate. Every claim below is file:line cited
and explicitly labelled **BUILT** / **STUBBED** / **ASSERTED-ONLY**. Findings gathered by four parallel
read-only subagents against the live trees on 2026-09-21; no files were edited to produce this report.

---

## A. solid-pod-rs — the Rust JSS port claiming "sovereign, Bitcoin-settled HTTP-402 trust ledger"

Repo: `/home/devuser/workspace/solid-pod-rs`. This is where nearly all real Bitcoin logic in the
estate currently lives.

### A.1 HTTP-402 flow — headers, who pays whom, settlement proof

Two payment surfaces coexist, both keyed on a **Web Ledger** (per-`did:nostr` satoshi balance), never
on raw on-chain balances:

- **Sat-balance gate**: `crates/solid-pod-rs/src/wac/payment.rs:1-93` defines `acl:PaymentCondition`
  read from a `.acl` sidecar, carrying `acl:costSats` (payment.rs:21-35). `PaymentConditionEvaluator::
  evaluate` (payment.rs:63-79) checks `RequestContext::payment_balance_sats >= cost_sats` but
  **does not debit** — "the handler layer is responsible for debiting the ledger after a successful
  WAC grant" (payment.rs:14-15). `total_payment_cost` (payment.rs:85-93) sums cost across conditions
  for the handler to debit post-grant.
- **402 response body**: `payment_required_body(balance, cost)`
  (`crates/solid-pod-rs/src/payments.rs:265-275`) → `{"error":"Payment Required","balance","cost",
  "unit":"sat","deposit":"/pay/.deposit","balance_endpoint":"/pay/.balance","spec":
  "https://webledgers.org"}`. Wired at `crates/solid-pod-rs-server/src/handlers/pay.rs:343-356`
  (`payment_error_response`, maps `PaymentError::InsufficientBalance` → `HttpResponse::
  PaymentRequired`).
- **Headers on paid responses**: `payment_response_headers(balance, cost, currency)`
  (payments.rs:319-329) emits `X-Balance`, `X-Cost`, `X-Pay-Currency` (JSS parity; tested at
  payments.rs:686-698).
- **Who pays whom / settlement proof**: balances are credited via two paths only:
  - (a) an **unverified TXO stand-in** (`(vout+1)*1000` sats, pay.rs:498-519), off by default
    (`deposit_txo_standin_enabled`, pay.rs:461-468 — returns HTTP 501 unless the operator opts in).
    The code's own comment calls this "a free-money oracle."
  - (b) a **verified MRC20 deposit** (pay.rs:563-662) calling `verify_mrc20_anchor` (in `mrc20.rs`):
    re-derives the expected taproot address from the claimed `{pubkey, stateStrings, network}` via
    `bt_address`, checks the state-chain hash-link, and confirms a live UTXO exists via
    `MempoolHttpClient` (mempool.rs:551-568). Replay is blocked by a `sha256(JCS(state))` key stored
    in durable payment state (pay.rs:598-620). This — a re-derived address with a live UTXO — is the
    actual settlement proof, not a signature check or confirmation count.
- `/pay/.buy` and `/pay/.withdraw` (pay.rs:1293-1400+) move MRC20 tokens against the sat ledger via
  `execute_token_transfer` (pay.rs:1180-1291): debits the ledger **only after** `mempool.broadcast_tx`
  succeeds, with a write-ahead "payment intent" record (pay.rs:1231-1263) and crash recovery
  (`recover_payment_intents`, pay.rs:231-265) that re-queries `mempool.transaction_exists` on restart
  (compensate debit on definite 404, else stays pending). This is real crash-safety engineering, not
  a stub.

### A.2 Bitcoin library — hand-rolled or established crate? **FLAG: hand-rolled tx/sighash logic**

**Hand-rolled transaction serialization and BIP-341 TapSighash, built on raw `k256` for the Schnorr
primitive — explicitly NOT `rust-bitcoin`/`bdk`.** Module doc states directly: "No `rust-bitcoin` /
`secp256k1-sys` is introduced" (`crates/solid-pod-rs/src/bitcoin_tx.rs:24`).

Hand-rolled in `bitcoin_tx.rs`:
- VarInt/CompactSize encoding (`write_var_int`, :86-94)
- BIP-340/341 tagged hash `SHA256(SHA256(tag)‖SHA256(tag)‖msg)` (`tagged_hash`, :117-126)
- Big-endian mod-n scalar arithmetic for the taproot key-tweak — `add_mod_n`/`neg_mod_n`/`sub`
  (:145-185), reimplementing secp256k1 scalar math by hand rather than using a curve-library scalar
  type
- P2TR scriptPubKey construction (`p2tr_script`, :191-203)
- Full BIP-341 `TapSighash` from scratch: SHA midstates over prevouts/amounts/scriptPubKeys/
  sequences/outputs, `SIGHASH_DEFAULT`, epoch byte, spend_type, input_index (`build_transaction`,
  :293-459, esp. :352-410)
- Raw segwit tx byte assembly, incl. marker/flag bytes, witness stack (:412-459)
- BIP-341 default key-path TapTweak (even-Y negation + `d' = (±d + TapTweak) mod n`) by hand
  (:309-330)

Signing uses `k256::schnorr::SigningKey::sign_raw(&sighash, &[0u8; 32])` (aux_rand forced to zero for
determinism, :405-407) — `k256` is a maintained RustCrypto crate, so EC point arithmetic and the
signature primitive itself are not hand-rolled. **But the transaction format, the sighash algorithm,
and the taproot tweak scalar arithmetic are hand-rolled protocol logic.** Per house rules ("never
hand-roll cryptography... if an existing implementation hand-rolls a primitive, replacing it is the
highest-priority port"), this is exactly the pattern to flag — BIP-341 TapSighash construction and
taproot tweak math are security-critical and are being reimplemented rather than sourced from
`rust-bitcoin`/`bdk`. Mitigation present: three "golden fixture" cross-impl tests assert byte-identical
output against JSS's `@noble/curves`-based implementation (untweaked/tweaked/multi-input,
bitcoin_tx.rs:1112-1210, fixtures at `tests/fixtures/bitcoin/golden_tx.json`) plus an offline
signature-verification gate — real coverage, but not a substitute for an audited tx-building crate.

### A.3 Testnet/mainnet configurability

Configurable; defaults to testnet4, mainnet is an explicit operator choice:
- `ChainConfig::bitcoin_mainnet()` / `bitcoin_testnet3()` / `bitcoin_testnet4()` / `bitcoin_signet()`
  (payments.rs:222-258), each setting an `explorer_api` URL.
- Mempool endpoint: env var `JSS_PAY_MEMPOOL_URL` (mempool.rs:52), default
  `https://mempool.space/testnet4` (`DEFAULT_MEMPOOL_URL`, mempool.rs:56).
  `select_mempool_endpoint`/`infer_network` (mempool.rs:145-280) classify the resolved URL into
  Mainnet/Testnet3/Testnet4/Signet/Regtest/Unknown from the URL string alone — an `Unknown` or
  default-sourced endpoint triggers a startup WARN naming the fix env var (`log_mempool_selection`,
  mempool.rs:289-310).
- `bt_address(pubkey, state_strings, network)` (mrc20.rs:474-487): HRP `"bc"` only if
  `network == "mainnet"`, else `"tb"` — any non-"mainnet" string, including typos, silently produces
  a testnet-style address (soft default-to-testnet, not a hard-fail on garbage input).
- Route-level mapping `network_for_chain` (pay.rs:69-75): `"btc"→"mainnet"`, `"tbtc3"→"testnet"`,
  everything else → `"testnet4"`.
- Confirmed default throughout: `network: "testnet4"` (e.g. mrc20.rs:872); README states "Default
  network is `testnet4`; mainnet is an explicit operator choice" (README.md:206).

### A.4 Gitmark — mechanically what it does

**A plain git commit — no key-tweak, no OP_RETURN.** `ShellGitMarker::mark_write`
(`crates/solid-pod-rs-git/src/mark.rs:145-228`) shells to the system `git` binary via
`tokio::process::Command`: records pre-write HEAD (parent SHA) → `git add -- <path>` →
`git -c user.name=<committer> -c user.email=<agent_did> commit -m <message>` → resolves new HEAD SHA
→ returns `GitMark { commit_sha, repo, branch: "main", parent }` (mark.rs:35-38, 189-194). The
agent's `did:nostr` becomes the commit **author email** (mark.rs:23-27, 174-176), binding git history
to the authenticated writer. Idempotent re-writes are detected and current HEAD surfaced without
error (mark.rs:196-227). Per README this is the "cheap, always-on" tier (README.md:206) and does
**not** touch Bitcoin — that's the separate, opt-in "block-trail" anchoring path (`anchor_state`,
bitcoin_tx.rs:824-902, wired via `MempoolBlockAnchorer::anchor`, mempool.rs:637-719), which appends
an MRC20 state whose `anchor` field carries the git commit SHA (or an epoch Merkle root) and builds +
broadcasts a **new chained-key taproot UTXO** to timestamp it (`chained_xonly`/
`bt_derive_chained_pubkey` in mrc20.rs) — i.e. the Bitcoin anchor is a fresh taproot output
deterministically chained from prior state strings, not an OP_RETURN data push and not a key-tweak
of the identity key itself.

### A.5 Webledger — real or stub? **BUILT, persisted, updated on payment**

`WebLedger` (payments.rs:102-176) is a serializable struct (`entries: Vec<LedgerEntry>`) with
`credit`/`debit`/`get_balance`, unit-tested (payments.rs:508-577). Server persistence:
`StoragePaymentStore` (pay.rs:128-291) over `Arc<dyn Storage>`. Authoritative document:
`/.well-known/webledgers/state.json` (`PAYMENT_STATE_PATH`, pay.rs:90), a single
`PaymentState { version, ledger, replay, order_book, exchange, intents }` committed with one atomic
`Storage::put` per mutation (`commit_state`, pay.rs:187-215), version-incremented every write
(optimistic-concurrency style). Legacy per-concern docs (webledgers.json, replay.json, offers.json,
pool.json) are written afterward as best-effort compatibility mirrors, not the source of truth
(pay.rs:118-127, 196-214). Every ledger mutation (deposit, buy, withdraw, sell, swap, pool
add/remove-liquidity) goes through this store (pay.rs:503-507, 645-649, 846-848, 899-901,
1113-1115, 1252-1263). **BUILT, not a mock.**

### A.6 Sidechain / sidestr / RGB awareness

**None.** `grep -rniE "sidechain|sidestr|\brgb\b"` across the whole repo (excl. target/) returns
**zero hits**. No sidechain, no RGB, no "sidestr" concept anywhere in solid-pod-rs today.

### A.7 CLOSEOUT-JSS-DEEPDIVE.md vs upstream JSS

`CLOSEOUT-JSS-DEEPDIVE.md` (dated 2026-07-03) **predates** the Bitcoin/MRC20 write-side work in
`bitcoin_tx.rs`/`pay.rs` (those modules self-describe as "Phase 4"/"Phase 0 of the
provenance/payment upgrade," later work) — it does not directly assess the payment code above. Its
relevant findings: executive verdict that solid-pod-rs is "a high-quality library port with a thin
reference server... the shipped `solid-pod-rs-server` wires only a slice of what the libraries
implement," and that `PARITY-CHECKLIST.md` "systematically overstates real-world parity" (measures
library presence, not deployed HTTP behaviour) (lines 9-19). P1-g (line 72): registration/login/
reset are no-op auth stubs (`let _ = ...` returns success) — a different, non-payment gap, noted for
completeness. No JSS payment/ledger/Bitcoin gap is called out (the closeout predates that code); the
operative caveat instead comes from the current README's own Status section (README.md:230-247):
*"Security audit is not green... Reproduced critical findings include... non-atomic payment
state... do not... carry value through payment routes until the findings are fixed."* This is the
maintainers' own, more current disclaimer on the payment surface — i.e. even the BUILT code is
explicitly flagged as not production-safe for real money.

### A.8 STUBBED / BUILT / ASSERTED-ONLY summary — solid-pod-rs

| Module | Verdict |
|---|---|
| `bitcoin_tx.rs` (tx build/sign, mint/transfer/anchor) | **BUILT** — full BIP-341 taproot builder, golden-fixture tests vs JSS/@noble, offline sig verification, persisted via `trail_store.rs`. Hand-rolled per A.2, not fake. |
| `payments.rs` (WebLedger, PayConfig, TXO parsing) | **BUILT** — unit-tested, persisted via `StoragePaymentStore`. |
| `wac/payment.rs` (`PaymentCondition`) | **BUILT** — pure evaluator, unit-tested; debit is documented as the caller's job, not a gap. |
| `wac/anchor.rs` (`ProvenanceAnchor`) | **BUILT** — pure marker/mode-selection logic, always-`Satisfied` by design, unit-tested. |
| `handlers/pay.rs::handle_deposit` TXO stand-in | **STUBBED, self-declared** — "free-money oracle," credits `(vout+1)*1000` sats with zero chain verification; off by default (501 unless `DEPOSIT_TXO_STANDIN_ENABLED`). |
| `handlers/pay.rs::handle_mrc20_deposit` | **BUILT** — real mempool-verified deposit path. |
| `handlers/pay.rs::execute_token_transfer` (.buy/.withdraw) | **BUILT** — real broadcast + durable intent/recovery, fail-closed debit-after-broadcast. |
| `mempool.rs` (`MempoolHttpClient`, `MempoolBlockAnchorer`) | **BUILT** — real `reqwest` mempool.space client, fixture-driven tests, live smoke test explicitly `#[ignore]`d. |
| `trail_store.rs` | **BUILT** — real load/save round-trip, JSS camelCase file-format parity, tested. |
| `mark.rs` (gitmark) | **BUILT** — real subprocess `git` calls, idempotency/parent-chain handling, tested. |
| `identity.rs` (agent DID + git-config privkey) | **BUILT** — writes canonical DID doc + git-config privkey, tested. |
| `schnorr.rs` (NIP-07 SSO) | **BUILT** for `schnorr-sso` feature (real BIP-340 challenge/response); **STUBBED** fallback `SchnorrTodo` always returns `Unimplemented` when the feature/backend isn't wired (:143-166) — identity, not the ledger itself, but relevant to the trust chain underpinning the "sovereign" claim. |
| README claim "sovereign, Bitcoin-settled HTTP-402 trust ledger" | Mechanism is **largely BUILT** at code level (real WebLedger, real taproot anchoring, real mempool verification); production-safety is **ASSERTED-ONLY / self-disclaimed** — the project's own README status section says the security audit is failing (non-atomic payment state among reproduced critical findings) and instructs operators not to carry real value through payment routes yet. |

No `TODO`/`unimplemented!()`/`todo!()` markers found in `bitcoin_tx.rs`, `payments.rs`,
`wac/payment.rs`, or `handlers/pay.rs` — the single grep hit (bitcoin_tx.rs:578) is a comment about a
test double, not production code.

---

## B. VisionClaw / VisionFlow host (`/home/devuser/workspace/project`)

### B.1 `src/handlers/pay_handler.rs` (1121 lines, read in full) — **BUILT** as an HTTP-402 gate, not smart contracts

An actix-web HTTP-402 payment-gating layer wired to `solid_pod_rs::payments` (`WebLedger`,
`PayConfig`, `pubkey_to_did`) and `solid_pod_rs::trading::Exchange` (order book + constant-product
AMM). **Does not touch Bitcoin at all** — balances are a flat filesystem JSON ledger
(`FsPaymentStore`, `{ledger_dir}/ledger.json`), not a wallet or chain state.

- Auth: NIP-98 (`solid_pod_rs::auth::nip98::verify`) → hex pubkey → `did:nostr:<hex>` (:415-430).
- Routes at `/pay/*` (:894-914): `.info`, `.balance`, `.deposit` (**stub, HTTP 501**, :479-493),
  `.estimate`, `.costs`, `.sell`/`.offers`/`.swap` (order book), `.pool`/`.pool/swap`/
  `.pool/liquidity` (AMM), `/{resource}` (generic pay-gated proxy — comment at :503-505 admits "the
  actual resource proxying is a stub… returns a JSON receipt").
- Persistence: `FsPaymentStore`/`FsExchangeStore`, dual-locked (tokio mutex + `flock(2)`), JSON files
  under `PAY_LEDGER_DIR` (:198-403).
- **Wired live**: mounted unconditionally in `src/main.rs` under `#[cfg(feature = "solid-pod-embed")]`
  (:1063-1069, `configure_pay_routes`); `solid-pod-embed` is in the crate's **default** feature set
  (`Cargo.toml:250`). Runtime gate is `PAY_ENABLED` env var (default `false`, 403/disabled), but the
  handlers are real, reachable Actix endpoints — not dead code.
- No Bitcoin/Nostr key material or tx construction here — only NIP-98 auth verification and a
  `did:nostr` string used as an account key.

### B.2 `crates/visionclaw-contracts` — **not** the trust-level/gitmark crate; it is envelope schemas

Read Cargo.toml + all 6 src files (996 LOC: `telemetry.rs`, `github_adapter.rs`, `enterprise.rs`,
`agent_action.rs`, `version.rs`, `lib.rs`). This crate is "web-contracts" only in the sense of
cross-process JSON/TS envelope contracts, unrelated to trust levels/Bitcoin/gitmark:
- `agent_action` — outbound `AgentActionEnvelope` (click → agentbox), ADR-10 §D3.
- `telemetry` — inbound `AgentTelemetryEnvelope` (agentbox → VisionClaw), ADR-10 §D1.
- `enterprise` — inbound `EnterpriseEventEnvelope` (forum → VisionClaw), ADR-10 §D5.
- `github_adapter` — `ParsedMarkdown` GitHub↔ontology boundary value-object, ADR-10 §D11.
- `version` — schema-version constants.

It's a leaf crate (`lib.rs:1-9`) generating TypeScript `.d.ts` bindings via `ts-rs`, deliberately
pulling no actix/Bitcoin/payment deps. **No `TrustLevel`, `GitMark`, `Blocktrails`, or reducer types
exist in this crate** — grep confirms zero hits for gitmark/blocktrail under `crates/`.

**The actual gitmark/blocktrails/L0-L3 code lives at repo root in `src/web_contract/`
(not `crates/visionclaw-contracts`)** — 1393 LOC across `mod.rs`, `reducer.rs`, `state.rs`,
`ledger.rs`, `trail.rs`, `ritual.rs`.

`TrustLevel` enum, exact definition (`src/web_contract/ritual.rs:57-92`):
```rust
pub enum TrustLevel {
    L0HonestOrCaught,   // public reducer + published verifier + block-anchor
    L1SingleUseSeal,    // anchor confirmed spent-exactly-once
    L2AdaptorSigCet,    // RGB/DLC trustless endgame (adaptor-sig CET) — gated off
    L3Rgb,              // RGB consignment trustless endgame — gated off
}
```
`gate()` (:77-86) returns `Ok` for L0/L1, hard `Err` for L2/L3 with message: "trustless (RGB/DLC)
trust levels are hard-refused until the adaptor-signature CET engine is built and independently
audited (ADR-124 §2.4 R3)." `commit_gate()` (:255-273) additionally refuses money-moving transitions
when a `substrate_disabled` flag is set.

Gitmark/Blocktrails structs (`src/web_contract/trail.rs`):
- `GitMark` (:80-94): five serde fields only — `@id`, `genesis`, `nick`, `package`, `repository` —
  tests assert no `@context`/`@type`/`commit`/`parent` present (:230-236, "forbidden key present").
- `Blocktrails` (:150-165): `@type` (fixed "Blocktrail"), `profile` (fixed "gitmark"), `chain`
  (e.g. "tbtc4"), `pubkeyBase`, `states[]` (commit SHAs), `txo[]` (`TxOut{txid, vout, address}`,
  BIP-341 UTXO chain). `is_well_formed()` (:199-201) checks `states.len()==txo.len()` only.
- These are **pure data/serialization types** — no cryptography, no Bitcoin RPC, no git operations.
  `push_link`/`tip`/`new` are trivial Vec pushes/lookups.

### B.3 `visionclaw-protocol` / `visionclaw-domain` — no value/payment/wallet types

Grepped both crates for wallet/balance/currency/payment/asset (case-insensitive): zero genuine hits.
The only matches are `AutoBalanceConfig`/`AutoBalanceNotification`/`auto_balance*` — physics-
simulation auto-balancing fields (`crates/visionclaw-domain/src/types/{actor_types,physics_config}.rs`),
unrelated to money. **No wallet/currency/payment domain types exist in these crates.**

### B.4 `src/services/github_sync_service.rs` — "wallet" is a topic keyword, not code

Only hit, ~line 2484, inside a static topic→keyword table for repo-topic classification:
`("blockchain", &["blockchain","nostr","did","crypto","ledger","web3","chain","wallet"])`. Used to
tag a GitHub repo as "blockchain"-topic; no wallet logic, no balances.

### B.5 ADR-124 and ADR-128 — summarised precisely

**ADR-124** (`docs/archive/adr/ADR-124-smart-contract-features-web-contracts.md`, Status:
*Implemented — updated 2026-07-03*): decides a 4-layer web-contract model (Contract/reducer, State,
Ledger, Trail) over `solid-pod-rs`, choosing "Progressive-Trust... single-use-seal through-line"
(option C) with **only L0/L1 declarable today; L2/L3 hard-refused**. Cites `solid-pod-rs` internals
(`mrc20.rs`, `bitcoin_tx.rs`, `payments.rs`, `trading.rs`, `provenance.rs`, `mempool.rs`) as the
claimed "production, integration-tested" write-side — all **external** to this repo (crates.io dep
`solid-pod-rs = "0.4.0-alpha.15"`, `Cargo.toml:218`; `extraction/solid-pod-rs` local dir exists but is
**empty** — no `bitcoin_tx.rs`/`mrc20.rs`/`payments.rs`/`trading.rs` present). This repo cannot
independently verify those upstream claims — they're asserted about a crate this repo doesn't vendor.

**L0-L3 ladder** (ADR-124 §4 table): L0 "available" (honest-or-caught, operator-custodial); L1
"available (after seal-closing check)" (m-of-n multisig, reducible custody); L2 "FUTURE —
HARD-REFUSED until CET engine built + independently audited" (non-custodial DLC); L3 "FUTURE —
deferred, layer rewrite" (RGB, none-custody).

**Gitmark/blocktrails**: ADR-124 §2.1 defines the trail layer over `mrc20::bt_derive_chained_pubkey` +
`provenance::ProvenanceLog`; ADR-128 is the explicit build-out/implementation plan ("Adopt Melvin
Carvalho's gitmark/blocktrails envelope as THE single web-contract substrate. NO parallel design").
ADR-128 §2.1 pins `gitmark.json` as **verbatim** (the five keys, nothing more); §2.2 pins
`blocktrails.json` as a **reconstruction** (not verbatim) of the webcontracts.org reference shape.

**P21 containment clause** (ADR-124 §7, quoted verbatim): *"the reference-contract config
**hard-pins currency to tbtc4 (testnet)**, **disables the cash-out mirror and `.withdraw`/`.swap`/
`.pool` routes**, the **owner+legal Judgment-Broker sign-off is a BUILD/DEPLOY gate** (not a runtime
hope), and the **trust-level + currency + cash-out flags are anchored on-seal** so a deployed
contract cannot silently switch from testnet to mainnet currency or enable cash-out
post-deployment."* Also §6 P0: "Ship the worldcup parimutuel/leaderboard reducers as the first
reference contract, **hard-pinned to tbtc4 with cash-out / `.swap` / `.pool` / `.withdraw` disabled
(§7, P21)**."

**RGB (L3) deferral rationale** (ADR-124 §2.2/§9): L3/RGB "is a rewrite, not a tightening" — it
replaces the Contract layer (Rust reducer → AluVM bytecode) and the State layer (schema JSON →
strict-encoded consignment), pulls a heavy `rgb-core`/AluVM external dependency conflicting with the
"k256-only, zero-rust-bitcoin-dep posture," and `rgb`/`rgb-protocol`/`alu-vm` are graded only
**[emerging]** in the ontology, with **zero RGB/AluVM/rgb-core anywhere in the tree** (independently
confirmed, see B.7). Plan (§6 P3): `rgb-core`/`rgb-std` integration, consignment import/validate,
AluVM schema authoring — sequenced last, explicitly optional.

### B.6 Verified against code — implemented vs aspirational

**BUILT** in `src/web_contract/` (this repo, compiles, has passing unit tests):
- `TrustLevel` enum + `gate()`/`commit_gate()` capability gate (`ritual.rs`) — tested
  (`trustless_levels_are_hard_refused`, `substrate_disablement_blocks_money_moves`).
- `GitMark`/`GitMarkId`/`Blocktrails`/`TxOut` data structs + `is_well_formed()` (`trail.rs`) — tested
  for byte-parity vs Carvalho ground truth (`gitmark_byte_matches_carvalho_ground_truth`).
- `ContractReducer` trait + `verify()` audit function (reducer-replay/ledger-replay/git-clean/
  trail-tip checks, `ritual.rs:204-248`) — tested against a toy `Pool` reducer in-crate.
- `WebContract::new()` — assembles gitmark+trail+trust_level, rejects L2/L3 at construction
  (`mod.rs:80-95`).

**STUBBED / trait-seam only** (interface exists, no production backend):
- `AnchorConfirmer` trait (`is_confirmed`, `prevout_spent_once`, `ritual.rs:144-151`) — the ONLY
  implementations anywhere in the repo are test doubles `AlwaysConfirmed`/`NeverSpentOnce` inside
  `ritual.rs`'s own `#[cfg(test)]` module. **No production implementation wiring it to a real
  mempool/UTXO lookup exists in this repo** — grep for `outspend`/`spent_once`/`prevout_spent`/
  `MempoolLookup` returns only `ritual.rs`. ADR-128 assigns the real seal-closing implementation to
  the external `solid-pod-rs` crate.
- `pay_deposit_handler` — explicit 501 stub (`pay_handler.rs:479-493`).
- Generic `/pay/{resource}` proxying — explicit stub returning a JSON receipt instead of forwarding
  to a real resource (`pay_handler.rs:503-505`).

**ASSERTED-ONLY / not found in this repo**:
- Any actual Bitcoin tx construction, taproot anchor tx building, or UTXO chain derivation
  (`bitcoin_tx::build_transaction`, `mrc20::bt_derive_chained_pubkey`, `verify_mrc20_anchor`) — all
  cited exclusively as `solid-pod-rs` internals (external crates.io dep, `0.4.0-alpha.15`), **not
  present in this repo's tree**; `extraction/solid-pod-rs` is empty.
- `ContractReducer` engine impl for "the first reference contract (worldcup parimutuel)" — ADR-128
  §5.2 lists this as NEW/not-yet-done; no such implementation exists in `src/web_contract/`.
- `gitmark.json`/`blocktrails.json` serializers wired to a real git repo, and the `verify`/`ship`
  binaries — ADR-128 §5.1 assigns these to the external `solid-pod-rs` crate; no `bin/verify.rs` or
  `bin/ship.rs` in this repo.
- **The P21 containment itself is NOT implemented** in `pay_handler.rs`: the handler has no
  currency-pinning logic and no code path disabling `.sell`/`.swap`/`.pool`/`.pool/swap`/
  `.pool/liquidity` — those routes are live and unconditional, gated only by the blanket `PAY_ENABLED`
  flag, never by trust-level or a testnet/cash-out flag. This is the clearest doc/code gap: ADR-124
  §7 calls the disablement flag "architecturally enforced, not aspirational" as a *requirement*, but
  no such flag exists in `pay_handler.rs` or `web_contract/`.
- RGB/DLC (L2/L3) crypto — confirmed absent (see B.7).

### B.7 Repo-wide grep results (VisionClaw)

- `tbtc4`: only in `src/web_contract/{mod.rs,trail.rs,ritual.rs}` test fixtures and doc-comments —
  never referenced from `pay_handler.rs` or any runtime config/env var. No currency-pinning
  enforcement exists.
- `cash-out`/`cash_out`: one hit, a doc-comment in `ritual.rs:253` describing the substrate-
  disablement flag's *purpose* — no actual disablement code, no `cash_out` symbol anywhere.
- `RGB`: zero code hits in Rust source (the only "RGB" hits in the repo are colour-space RGB in
  `xr-client`/Blender/ffmpeg skill docs — unrelated homonym). Confirms ADR-124's own claim.
- `sidestr`: zero hits.
- `sidechain`: zero Bitcoin-related hits; only unrelated hits are Claude-Code "sidechain"
  (subagent token-tracking) in `agentbox/skills/token-audit` and `agentbox-ops`.

### B.8 Bitcoin tx-construction duplication check

`grep -rln "bitcoin" crates/*/src --include=*.rs` → one hit:
`crates/visionclaw-ontology/src/services/jsonld_ingest/canonical.rs:310-326`, a Markdown-ingest test
fixture titled "Bitcoin" (an ontology page about the concept, `urn:visionflow:page:bitcoin`) — not
Bitcoin protocol code. **No Bitcoin transaction-construction code exists anywhere in this repo's own
crates or `src/`.** solid-pod-rs's `bitcoin_tx.rs` is external (crates.io dependency, not vendored),
so there is **no duplication** between this repo and solid-pod-rs's Bitcoin tx builder — VisionClaw
simply doesn't have one of its own.

---

## C. nostr-rust-forum (nostr-bbs)

Repo: `/home/devuser/workspace/nostr-rust-forum`.

### C.1 Signing crate — `nostr-bbs-core`: BUILT, on established primitives, not hand-rolled

`crates/nostr-bbs-core/src/keys.rs:1` doc comment: "Nostr keypair management, HKDF key derivation
from WebAuthn PRF, and BIP-340 Schnorr signing." Built on RustCrypto crates:
- `keys.rs:5` `use k256::schnorr::{SigningKey, VerifyingKey};` — k256, not raw secp256k1 math.
- `keys.rs:3-4` `hkdf::Hkdf`, `hmac::{Hmac,Mac}`; `:6` `sha2::Sha256`; `:7` `zeroize::Zeroize`.
- `Cargo.toml:24` `k256 = { workspace = true }`, plus `chacha20poly1305`, `hmac`, `hkdf`, `sha2`,
  `aes`, `cbc`, `bech32` — all RustCrypto family, matching the CLAUDE.md-mandated crate set.
- Signing: `keys.rs:66-78` `SecretKey::sign()` → `sk.sign_raw(message, &aux_rand)` (k256 BIP-340
  Schnorr), zeroizes aux_rand after use (:74).
- Verify: `keys.rs:124-130` `PublicKey::verify()` → `vk.verify_raw(message, &k256_sig)`.
- Key derivation: `keys.rs:196-217` `derive_from_prf` (HKDF-SHA256 from WebAuthn PRF per "Podkey
  Passkey Identity Specification §3," cross-checked against a known-answer vector, :294-307);
  `keys.rs:251-265` `derive_subkey` (HMAC-SHA256 domain-separated child-key derivation, JS-parity
  vector at :477-485).
- `SecretKey` is `#[derive(Zeroize)] #[zeroize(drop)]` (:40-41).
- NIP-98 HTTP auth: `crates/nostr-bbs-core/src/nip98.rs:1-33` — kind 27235, full verification
  pipeline (size gate, base64/JSON, kind check, timestamp freshness, event-id recompute + Schnorr
  verify, u/method/payload tag checks), pluggable `Nip98ReplayStore` trait for replay protection.
  **BUILT** — doctested, described as "the single source of truth for NIP-98 verification across the
  forum kit."
- NIP-59 Gift Wrap: `gift_wrap.rs:1-33` — Rumor(kind 14)/Seal(kind 13)/Gift-Wrap(kind 1059) via
  NIP-44 encryption (`nip44.rs`), throwaway keys via `generate_keypair`. **BUILT.**
- **Verdict**: from-scratch scheme composition (Nostr event format, NIP-98/59 protocol logic), but
  crypto primitives (Schnorr, HKDF, HMAC, AEAD) are all delegated to audited RustCrypto crates (k256,
  hkdf, hmac, sha2, chacha20poly1305, aes/cbc) — consistent with the house "never hand-roll
  cryptography" rule. Depends on `nostr` (upstream crate, Cargo.toml:23) and, notably,
  `solid-pod-rs` (Cargo.toml:41, workspace-pinned `=0.5.0-alpha.7`, `default-features = false,
  features = ["core"]`) — **a direct code dependency from this repo into solid-pod-rs**.

### C.2 Zap / NIP-57 / NWC / wallet surfaces — **absent**, except a real HTTP-402 sats ledger

`grep -rn -i "nip.?57|zap|nwc|lightning|lnurl" --include=*.rs .` (excl. target/, .deepsec-gate/)
found **no NIP-57 zap-receipt implementation and no NWC code anywhere**. Two literal hits, both
cosmetic/non-functional:
- `crates/nostr-bbs-forum-client/src/pages/profile.rs:331,334` — a "Lightning" label and a `lud16`
  (LNURL-pay address) display field rendering kind-0 metadata as text. No zap request/receipt
  construction, no LNURL callback, no invoice handling. **STUBBED / display-only.**
- `crates/nostr-bbs-relay-worker/src/relay_do/filter.rs:571` — `["nostr","bitcoin","lightning"]` is a
  `#t`-tag filter test fixture, unrelated to payments (false-positive grep hit).
- `admin/mod.rs:184` "Signer-based variants (NIP-07 / extension wallets)" — a NIP-07 browser-
  extension *signer* abstraction (`&dyn Signer`) for delegating event-signing UI, not a cryptocurrency
  wallet. The actual code (:186-200+) is whitelist-fetching via a signer, unrelated to payments.
- **Conclusion**: NIP-57 zaps and NWC are unimplemented — not even asserted in docs found.

A **real, BUILT** payment surface exists instead — HTTP-402 micro-ledger, architecturally
unrelated to zaps:
- `crates/nostr-bbs-config/src/schema.rs:572-604` — `[payments]` config struct: `enabled: bool`,
  `cost_sats: u64`, optional `[payments.token]` (ticker/rate/supply/issuer). Doc comment: "HTTP 402
  micro-ledger + optional community token... Disabled by default."
- `crates/nostr-bbs-pod-worker/src/payments.rs:1-33` — "HTTP 402 Payment Required — CF Workers
  adapter for solid-pod-rs payments," re-exports `solid_pod_rs::payments::{balance_response,
  parse_txo_uri, pay_info, payment_required_body, pubkey_to_did, webledgers_discovery, ChainConfig,
  PayConfig, PaymentError, PaymentStore, TokenConfig, WebLedger}` (:29-33), layering a D1-backed
  atomic ledger adapter (`debit_atomic`, :183) plus HTTP-402 response construction (`.with_status(402)`
  at :783, 836, 1022). Accounts keyed by `did:nostr:<hex-pubkey>` (:10). 28 test functions in this
  file.
- `crates/nostr-bbs-config/src/validate.rs:194-196, 653-666, 863-880` — validation enforces
  `payments.token.ticker` non-empty when enabled; tested for enabled/disabled states.
- **Verdict**: **BUILT** (real D1-atomic logic, tested), a sats/WebLedger micro-payment system for
  gating actions, built directly on `solid-pod-rs` — **this is the third consumer of solid-pod-rs's
  payments module found in this survey** (alongside solid-pod-rs's own server and VisionClaw's
  `pay_handler.rs`). It is not zap/NWC and doesn't touch Lightning directly (off-chain ledger keyed to
  `did:nostr`, referencing webledgers.org/Melvin Carvalho's HTTP-402 spec, not BOLT11/zap receipts).

### C.3 Event kinds owned by this repo

Only one kind range is defined/owned here: **31400-31405**, "Agent Control Surface Protocol" (ACSP
in-repo terminology, e.g. `kanban.rs:12,603`):
- `crates/nostr-bbs-core/src/governance.rs:11-16,27-34` — canonical definitions: 31400
  `KIND_PANEL_DEFINITION`, 31401 `KIND_PANEL_STATE`, 31402 `KIND_ACTION_REQUEST` (also reused for
  kanban approval requests, `kanban.rs:603-631`, `board.rs:19-20,45`), 31403
  `KIND_ACTION_RESPONSE`, 31404 `KIND_PANEL_UPDATE`, 31405 `KIND_PANEL_RETIRED`.
  `GOVERNANCE_KIND_RANGE: RangeInclusive<u64> = 31400..=31405` (:34).
- Config surfacing: `nostr-bbs-config/src/schema.rs:59,304,518-521,565` (`kinds_lo`/`kinds_hi`
  default 31400/31405); `relay-worker/src/relay_do/nip42.rs:515` (kind allow-list test);
  `forum-client/src/app.rs:782` subscribes to the full kind list.
- **38100-38105 ("colloquy")**: one hit only, `forum-client/src/pages/knowledge.rs` (not read in
  depth; likely a client-side consumer of colloquy kinds). Confirms: colloquy kinds are
  **referenced but not owned/defined** here — per `agentbox/CLAUDE.md`, they live in
  `crates/colloquy/colloquy-nostr` in the agentbox repo.
- Also present, not asked about: 30301/30302 (kanban board/card), 1059 (gift-wrap), 27235 (NIP-98),
  13/14 (seal/rumor), 31922/31923 (NIP-52 calendar).

### C.4 nostr-bbs summary

- Signing/crypto (Schnorr, NIP-98, NIP-59): **BUILT**, on established RustCrypto primitives.
- NIP-57 zaps / NWC: **UNIMPLEMENTED** — no code anywhere; cosmetic `lud16` text only.
- HTTP-402 sats micro-ledger (via solid-pod-rs): **BUILT and tested**, not a zap/NWC system.
- 31400-31405 "ACSP" governance kinds: **BUILT**, owned here.
- 38100-38105 "colloquy" kinds: referenced once, owned elsewhere (agentbox `colloquy-nostr`).

---

## D. dreamlab-cumbria and agentbox-of-empires — economics/billing sweep

### D.1 dreamlab-cumbria

Personal/property/business-planning repo, not software. Real financial content is all
personal-finance/property-business (tax, R&D credits, renovation costs, revenue), not a software
billing/economics subsystem:
- `README.md:44, 265, 268` — infrastructure purchase cost estimates, solar proposal costs, UK
  property tax (mansion tax, CGT, SDLT).
- `dreamlab/README.md:70-71` — "dual revenue," "R&D credits" — business-plan prose for the DreamLab
  training/holiday-let venture.
- `dreamlab/business-plan/reports/executive_dashboard.md:15,25,33,73` — P&L figures.

"tenant"/"wallet"/"federation" hits are noise: agricultural-tenancy language in planning-law LDC
declarations (`fairfield/`), Azure icon names and `@module-federation/*` npm entries in the vendored
`tools/fossflow` diagram tool, and MediaCity "tenants" in an archived lean-canvas doc. **No genuine
software economics/billing/tenant-isolation concept anywhere in this repo.**

### D.2 agentbox-of-empires (AoE, the interaction-plane product)

Checked `src/`, `web/`, `docs/`, `DESIGN.md`, `README.md`, `AGENTS.md`. No billing, tenant-billing,
wallet, payment, or per-agent budget/quota economics system exists:
- **"tenant"** (`src/migrations/v017*`, `src/server/callback.rs:113/419`,
  `src/server/api/system.rs:820`, `src/hooks/dir_guard.rs`, `src/tui/dialogs/hooks_install.rs:438`)
  — exclusively *host multi-tenancy security* (multiple local UIDs on a shared POSIX host, CGNAT-
  routable peers), not customer/billing tenancy. Product is explicitly "single-tenant: there is one
  user."
- **"quota"** (`src/plugin/host_api.rs`, `src/plugin/ui_state.rs`) — plugin KV-storage quota
  (key-count/size caps per plugin), an engineering resource limit, not billing.
- **"budget"** (~150 hits) — all engineering: restart/respawn budgets (`src/acp/supervisor.rs`,
  `src/server/acp_reconciler.rs` — crash-loop backoff bookkeeping), char/byte/render-width budgets
  (`context_primer.rs`, TUI render code), thread-pool budgets (`session/poller.rs`). No monetary sense
  anywhere.
- **"billing"/"payment"** — only literal example strings in unit tests for session-title/name
  generation (`src/tmux/mod.rs:1234`, `src/session/smart_rename.rs:2272` — "Refactor billing
  module," "refactor the payment retry loop") — realistic test fixtures for naming/summarization
  logic, not real billing code.
- **"spend"/"cost" (genuine, worth noting)**: the ACP composer UI displays cumulative **token-usage
  cost** reported upstream by the connected agent backend (Claude/Codex etc.) via `UsageUpdate`.
  `web/src/components/acp/Composer.tsx:1570-1585` and
  `web/src/lib/acpTypes.ts:130-131,639-650,1200-1264,1538-1550` —
  `usage.cost.amount`/`currency`, rebased across `/clear`/`/compact` via a `usageBaseline`. This is a
  **read-only cost display**, not billing, budgeting, wallets, or tenant economics — it relays a
  number the underlying agent backend already reports.
- **"federation.*econom"** — zero hits. Closest adjacent concept is `RateLimitInfo`
  (`src/acp/state.rs:176-188`), which just surfaces an upstream provider's rate-limit reset info, not
  an AoE-owned economics/quota system.
- DESIGN.md/README.md/docs/ — no billing, budget, or tenant-economics design content found.

**Bottom line for D**: no genuine economics/billing surface in either repo beyond (a)
dreamlab-cumbria's personal/property financial documents (business content, not code), and (b) AoE's
single read-only cumulative session-cost display sourced from the agent backend's own usage
reporting.

---

## E. Cross-cutting: balances, value transfer, ownership of Bitcoin tx construction

### E.1 Where does the estate currently keep a "balance" for anyone (human or agent)?

Two independent, non-federated balance stores exist today, both keyed on `did:nostr:<hex-pubkey>`,
neither aware of the other:

1. **solid-pod-rs's `WebLedger`** (payments.rs:102-176), persisted server-side under
   `/.well-known/webledgers/state.json` per pod (`StoragePaymentStore`, pay.rs:128-291). This is the
   canonical, most-built implementation — sats-denominated, backed (optionally) by verified Bitcoin
   MRC20 deposits.
2. **VisionClaw's `FsPaymentStore`** (`pay_handler.rs:198-403) — a *separate* flat-file JSON ledger
   (`{ledger_dir}/ledger.json`) that re-implements the same `WebLedger`/`PayConfig` types from
   `solid_pod_rs::payments` but keeps its own on-disk state, independent of any solid-pod-rs pod
   instance. There is no code path syncing VisionClaw's ledger with a solid-pod-rs pod's ledger — an
   agent's balance in one is invisible to the other.
3. **nostr-bbs-pod-worker's D1-backed ledger** (`payments.rs:183 debit_atomic`) — a third instance,
   this time an edge/Cloudflare-D1-backed adapter also built directly on `solid_pod_rs::payments`
   types, again its own storage, again `did:nostr`-keyed, again independent of the other two.

No balance concept exists for AoE agents, dreamlab-cumbria, or any cross-repo "agent budget." The AoE
"cost" figure (D.2) is a display-only relay of upstream LLM-provider usage cost, not a balance
anyone can spend against.

### E.2 Where is value transferred today, if anywhere?

Real, working (if non-production-hardened) value transfer exists **only inside solid-pod-rs's own
server** (`crates/solid-pod-rs-server/src/handlers/pay.rs`):
- Bitcoin → WebLedger: `handle_mrc20_deposit` — verified MRC20 anchor deposit credits sats (A.1b).
- WebLedger internal: `.sell`/`.swap`/`.pool` AMM trading between the sats ledger and MRC20 tokens
  (`trading.rs`, `Exchange`).
- WebLedger → Bitcoin: `execute_token_transfer` (`.buy`/`.withdraw`) broadcasts a real Bitcoin tx via
  `mempool.broadcast_tx` with write-ahead/recovery bookkeeping (A.1).

Neither VisionClaw's `pay_handler.rs` (B.1) nor nostr-bbs-pod-worker's D1 ledger (C.2) perform any
on-chain Bitcoin movement themselves — both only gate HTTP responses against an off-chain sats
balance; any actual Bitcoin settlement they might eventually rely on would have to happen through a
solid-pod-rs pod they talk to (not shown as wired in either repo). VisionClaw's own ledger
(`FsPaymentStore`) has **no deposit verification at all** beyond the 501-stubbed `.deposit` route —
so today there is literally no way to get real value *into* VisionClaw's ledger.

### E.3 Which repo owns Bitcoin tx construction today — is it duplicated?

**solid-pod-rs owns 100% of Bitcoin transaction construction** in the estate
(`crates/solid-pod-rs/src/bitcoin_tx.rs` + `mrc20.rs`, per A.2). It is a hand-rolled BIP-341
taproot/tx-serialization implementation on top of `k256` for the Schnorr primitive (flagged in A.2 —
candidate for replacement with `rust-bitcoin`/`bdk` per house crypto rules).

**No duplication found**: neither VisionClaw (`crates/visionclaw-contracts`, `src/web_contract/`, B.8)
nor nostr-bbs (`nostr-bbs-core`, `nostr-bbs-pod-worker`, C.1-C.2) contain their own Bitcoin
tx-building code — both depend on solid-pod-rs as a library (VisionClaw via
`extraction/solid-pod-rs`, currently an **empty** local mirror of a crates.io dependency; nostr-bbs
via a direct workspace-pinned Cargo dependency, `nostr-bbs-core/Cargo.toml:41`). This is good news
for a sidestr integration — there is exactly one place (`solid-pod-rs/src/bitcoin_tx.rs` +
`mrc20.rs`) that needs to learn about a sidechain-anchored output format, and three downstream
consumers (solid-pod-rs-server, VisionClaw's `pay_handler.rs`, nostr-bbs-pod-worker) that would
inherit it for free if they stay on the same crate version — **provided VisionClaw's currently-empty
`extraction/solid-pod-rs` vendor mirror and its independent `FsPaymentStore` are reconciled first.**

---

## GAPS (relative to the "sidestr Nostr-only Bitcoin sidechain + RGB as financial substrate" goal)

1. **No sidechain/sidestr awareness anywhere in the estate.** Zero hits for "sidestr"/"sidechain"
   (Bitcoin sense) in solid-pod-rs, VisionClaw, or nostr-bbs (A.6, B.7). This is a fresh integration,
   not an extension of existing scaffolding.
2. **RGB is fully absent, and VisionClaw's own ADR explicitly defers it (L3) as "a rewrite, not a
   tightening"** requiring `rgb-core`/AluVM, which conflicts with solid-pod-rs's stated "k256-only,
   zero-rust-bitcoin-dep posture" (B.5). A sidestr+RGB integration will force a decision on that
   posture — either RGB's dependency footprint is accepted somewhere in the stack, or RGB stays
   external to solid-pod-rs/k256 entirely.
3. **`bitcoin_tx.rs` hand-rolls BIP-341 TapSighash and taproot-tweak scalar arithmetic** (A.2) instead
   of using `rust-bitcoin`/`bdk`. Per house rules this is the highest-priority target for replacement
   *before* extending it with sidechain-anchor tx formats — building sidestr support on top of
   hand-rolled sighash logic compounds the audit surface.
2. **VisionClaw's P21 containment (tbtc4 hard-pin + cash-out/.swap/.pool/.withdraw disablement) is
   asserted in ADR-124/128 but not implemented in code** (B.6) — `pay_handler.rs` has no
   currency-pinning or route-disablement logic keyed to trust level. Any real-money or sidechain
   rollout riding on VisionClaw's `pay_handler.rs` today would ship without the safety rail the ADR
   claims is "architecturally enforced."
3. **`AnchorConfirmer` (VisionClaw's seal-closing check) has no production implementation** — only
   test doubles (B.6). L1 trust ("single-use-seal") cannot actually be verified end-to-end in
   VisionClaw today; it depends entirely on solid-pod-rs doing the real check, and VisionClaw's local
   vendor copy of solid-pod-rs is empty.
4. **VisionClaw's `extraction/solid-pod-rs` directory is an empty stand-in** for a crates.io
   dependency (B.5, B.6) — none of ADR-124/128's claims about solid-pod-rs internals are verifiable
   from within the VisionClaw repo; they're inherited trust in an external crate pinned to an alpha
   version (`0.4.0-alpha.15` in VisionClaw vs `0.5.0-alpha.7` in nostr-bbs — **version skew between
   the two consumers**, worth checking for breaking changes before any sidestr work touches
   `payments.rs`'s public API).
5. **solid-pod-rs's own README disclaims production-safety of its payment routes** (non-atomic
   payment state among reproduced security-audit findings, A.7) — building a sidechain settlement
   layer on top of a payment core the maintainers themselves say not to carry real value through yet
   is a sequencing risk worth surfacing to the wider effort.
6. **The TXO-standin "free-money oracle" deposit path** (A.1a, A.8) is off by default but exists in
   the codebase; any sidestr rollout must ensure it stays disabled/removed rather than accidentally
   becoming the path of least resistance for a sidechain "deposit."
7. **No zap/NIP-57/NWC surface exists anywhere** (C.2) — if the sidestr integration is meant to also
   cover Lightning-style tipping/zaps as part of "closing the payments loop," that is entirely
   greenfield, not a gap in an existing implementation.
8. **No cross-repo balance/identity federation** — three independent ledger stores exist
   (solid-pod-rs pod-local, VisionClaw filesystem, nostr-bbs-pod-worker D1) all keyed on
   `did:nostr:<hex>` but none synced (E.1). A sidestr substrate that's meant to be *the* financial
   layer needs to pick one of these to be canonical (solid-pod-rs's `WebLedger`/`PaymentStore` trait
   is the most mature and the one the other two already depend on) and either retire or become a thin
   proxy for the other two.
9. **AoE has no per-agent budget/spend-limiting concept at all** (D.2) beyond a read-only cost
   display — if "closing the payments loop" includes agent-level spend caps in the interaction plane,
   that's new design, not a wiring task.

## DUPLICATION

1. **Payment/ledger type re-implementation, not Bitcoin-logic duplication**: `solid_pod_rs::payments`
   types (`WebLedger`, `PayConfig`, `PaymentStore` trait, `payment_required_body`,
   `payment_response_headers`, `pubkey_to_did`) are consumed identically by three different storage
   backends — solid-pod-rs-server's own `StoragePaymentStore` (A.5), VisionClaw's `FsPaymentStore`
   (B.1), and nostr-bbs-pod-worker's D1-backed adapter (C.2) — each maintaining its **own separate
   ledger state** rather than one being the canonical store the others proxy to. This is architectural
   duplication of the *storage/consistency* concern (three independent sources of truth for
   "how much does this `did:nostr` have"), even though the Bitcoin-facing logic itself
   (`bitcoin_tx.rs`/`mrc20.rs`) is not duplicated (E.3).
2. **No duplicated Bitcoin transaction-construction code** — confirmed only one implementation exists
   estate-wide, in solid-pod-rs (E.3, B.8). This is the one clean finding: a sidestr integration has a
   single choke point to modify.
3. **Version skew** between solid-pod-rs consumers — VisionClaw pins `solid-pod-rs = "0.4.0-alpha.15"`
   (Cargo.toml:218) while nostr-bbs-core pins `=0.5.0-alpha.7` (Cargo.toml:41) — not code duplication
   per se, but a divergence risk: any `payments.rs`/`bitcoin_tx.rs` API change for sidestr support
   needs to land in a version both consumers can move to together, or the estate will fork behaviour
   across the two alpha lines.
4. **Trust-level/gitmark concept exists in two places with different scope**: solid-pod-rs's
   `provenance.rs`/`mrc20.rs` (the anchor mechanics, A.4) vs VisionClaw's `src/web_contract/`
   (`TrustLevel`, `GitMark`, `Blocktrails` — the policy/data-model layer, B.2). These are
   complementary by design (ADR-124 explicitly builds VisionClaw's layer *on top of* solid-pod-rs) but
   the fact that `crates/visionclaw-contracts` shares a name ("web-contracts") with an entirely
   different, unrelated concept ("cross-process JSON/TS envelope contracts," B.2) is a naming
   collision worth flagging to whoever integrates sidestr next — the crate any AI or engineer would
   grep for by name is not the crate that owns trust levels/gitmark/blocktrails.

---

*Compiled from four parallel read-only subagent investigations (solid-pod-rs, VisionClaw, nostr-bbs,
dreamlab-cumbria/AoE) run 2026-09-21 against the live working trees. No files were modified to produce
this report.*
