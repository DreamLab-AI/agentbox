# sidestr — technical report

All paths below are relative to the clone roots given in the task:
`upstream/spec`, `upstream/wallet`, `upstream/explorer`, `upstream/sidestr`, `upstream/schema`,
`upstream/nostrfinance.github.io`. All clones are **shallow (`--depth=1`)** — `git log` shows a
single commit in every repo (`spec`, `schema`, `wallet`, `explorer`, `sidestr`), so no claim below
about "one commit" or "one author" should be read as the whole project history; it is what this
snapshot contains. Where the working text says something happened on a date, that is the spec's
own prose, not something independently verified here.

Version stamp: SPEC.md is "0.0.1, draft, 15 September 2026"; report written from a clone taken
2026-09-21 (six days later; the desk proposal's own status note is dated 19 September and the
level-2 proposal's dated log entries run to 19 September, so the working repo is a few days ahead
of the frozen SPEC.md text — proposals are explicitly pre-spec, per SPEC.md §15).

---

## 1. The chain document schema

### 1.1 Fields (SPEC.md §3, §5, plus what the seven `chain.json` examples actually carry)

SPEC.md §3 defines the *conceptual* overlay fields (`parent`, `challenge`, `powLimit`, `subsidy`,
`addressPrefix`, `pegConfirmations`, `refundBlocks`, `genesis`). The **real files** in
`spec/chains/*/chain.json` and `spec/siding/chain.json` carry a richer, consistent superset; the
table below is assembled directly from `chains/gitmark/chain.json`, `chains/txbt4-evm/chain.json`,
`chains/txbt4-fed/chain.json`, `chains/txbt4-desk/chain.json`, `chains/tally/chain.json`,
`chains/melchain/chain.json`, `chains/capewars-s6/chain.json`.

| field | meaning | example |
|---|---|---|
| `id` | `sidestr:<name>` — the chain's identifier, used as the Nostr `d` tag on tip/rule/genesis events (SPEC.md §8, §11) | `sidestr:gitmark` |
| `name` | short label | `gitmark` |
| `parent` | parent chain id (any chain the engine validates — a sidestr chain included, SPEC.md §3.1) | `btc:testnet4-blake2b` in every example — **testnet4 only**, no mainnet chain seen anywhere in this clone |
| `comment` | free text describing the chain's purpose/trust — present on every example, evidently load-bearing documentation-as-data | see §1.2 below for the `gitmark` text |
| `challenge` | script hex; level 1 is `5120<32-byte pubkey>` (P2TR key-path spend, SPEC.md §4); level 2 is `5120<tweaked output key>` derived per `federation.mjs` (§4 below) | `5120…` in all seven |
| `powLimit` | 256-bit hex target; every example uses `7fff…ff` (the parent testnet4's minimum-difficulty target — SPEC.md §3: "cheap enough for a laptop, no retarget") | identical across all 7 |
| `addressPrefix` | bech32/bech32m HRP, distinct per chain: `ts` (the reference `txbt4-siding`), `gm`, `ev`, `fd`, `dk`, `ty`, `mel`, `cape` | — |
| `magic` | 4-byte network magic (p2p/serialization discriminator, `overlay.mjs`'s `sidestrGraph` default `e5d5e5d5` if absent) | e.g. `86afccb8` for gitmark |
| `pegConfirmations` | parent confirmations before a peg-in claim (SPEC.md §6) | `6` everywhere |
| `refundBlocks` | relative timelock on the peg output's refund path (SPEC.md §5) | `10000` everywhere |
| `pegoutBlocks` | window (parent blocks) within which a burn must be paid (SPEC.md §7) | `144` everywhere |
| `pegoutMin` | minimum burn value in sats (SPEC.md §7, `sidestr:rule-pegouts`) | `10000` everywhere |
| `minFeeRate` | producer's minimum sat/vB policy (`chain.mjs` `minFeeRate()`) | `1` everywhere |
| `genesisTime` | genesis block's header time | Unix seconds, e.g. `1789751309` |
| `pegs` | genesis peg array — **empty `[]` in every shipped `chain.json`**, i.e. the published documents describe post-genesis chains whose genesis peg records are not re-published in the document (they're baked into `genesisHash` instead) | `[]` in all 7 |
| `signer` (level 1) | the single signer's x-only pubkey — also the chain's Nostr identity and its BIP-340/schnorr spending key (see §6) | e.g. `7f949b86…` (gitmark) |
| `signers` / `threshold` (level 2) | array of x-only pubkeys plus `k` (SPEC.md §9.1, `level-2.md`) | `txbt4-fed`: 3 signers, threshold 2 |
| `genesisHash` | the hash the genesis block must reproduce (`chain.mjs`'s `open()` checks this and throws `genesis <hash> is not the document's <genesisHash>` on mismatch) | present on all 7 |
| `rules` | opt-in rule names array (SPEC.md §8/§12): `["evm"]`, `["assets","pool"]`, or absent | `txbt4-evm`: `["evm"]`; `tally`: `["assets","pool"]` |
| `evm` | `{ chainId, gasLimit }` sub-object, only when `rules` includes `evm` | `txbt4-evm`: `{"chainId":21474,"gasLimit":30000000}` |
| `pledge` | the desk sub-object (`rate, lockedFrom, maturity, pegAddress, pegScript, maxPerPledge, fee, enforceFrom, paused, pausedNote`) — only on `txbt4-desk` | see §1.2 |

### 1.2 The seven examples, chain by chain

- **`gitmark`** (`chains/gitmark/chain.json`) — "gitmark: a chain for blocktrails — git commits
  anchored as trails of tweaked taproot outputs (git-mark.com). Marks land in seconds; every few
  blocks the tip is checkpointed into the BLAKE2b testnet4, so the parent's proof of work bounds
  when a mark was made. One signer; a faucet pays trail dust. Coins with no value." One signer,
  no `rules` array (plain sidestr chain), running the `checkpoints` proposal
  (SPEC.md §15 table: "Checkpoints — running on `sidestr:gitmark`"). **What it is**: it is *not*
  git-anchoring logic implemented inside sidestr; sidestr is used purely as a fast, cheap
  heartbeat chain whose tip is periodically checkpointed into testnet4 (`checkpoints.md`), so an
  external blocktrails-style commitment scheme (tweaked-taproot state anchors, see §8) can get
  seconds-level confirmation with an eventual, batched anchor to real proof of work. **Who signs
  it**: one key (`signer: 7f949b86…`), same key model as every level-1 chain here (a Nostr key
  used as a BIP-340 chain signer). **What it's for**: fast provisional confirmation for
  git-commit/state-anchor "marks", cheap because sidestr blocks cost nothing (no PoW difficulty,
  a laptop-cheap `powLimit`) and land as fast as the producer wants (SPEC.md §11: a heartbeat
  interval), with genuine PoW security arriving only every few blocks via the checkpoint.
- **`txbt4-evm`** — EVM rule chain, chain id 21474, gas limit 30,000,000, one signer, ten-minute
  blocks (proposal evm.md's flagship deployment).
- **`txbt4-fed`** — the first level-2 chain, 3 signers/threshold 2, ten-minute blocks (level-2.md's
  live deployment, "70+ blocks sealed... two peg-in claims... a 20,000-sat burn... paid").
- **`txbt4-desk`** — the desk proposal's chain: pledge object with `rate: 0.9`, `lockedFrom:
  151406`, `maturity: 158111`, `maxPerPledge: 5,100,000,000` sats, `fee: 1000`, **`paused: true`**
  because the parent's long-coinbase-maturity rule (Bitcoin Knots PR 419) is unmerged — see §5.
- **`tally`** — `rules: ["assets","pool"]`, one signer, 50 tBTC pegged in, "every asset here is
  unbacked; coins with no value" (matches assets-and-pools.md's disclosure requirement).
- **`melchain`** — "Melvin's personal chain... 30 tBTC pegged in by one parent transaction" — a
  personal/test chain, no rules. (The spec repo's sole committer is "Melvin Carvalho" per
  `git shortlog`; this is very likely the spec author's own throwaway chain.)
- **`capewars-s6`** — "Capewars season 6, Tideholm: the season's ledger... A `did:nostr` key is an
  address here. One signer... 10 tBTC pegged in as the season treasury." A game/season-ledger use
  case, no rules array — ordinary sidestr chain used as a game treasury.

### 1.3 Genesis document vs. chain document

SPEC.md §5 defines a separate **genesis document** shape (`{chain, parent, pegs[], challenge,
refundBlocks}`, kind 33501, "signed by the chain's spec key and is the first rule document").
None of the seven `chain.json` files carry a non-empty `pegs` array — genesis peg data is evidently
published once as the kind-33501 genesis event and thereafter only `genesisHash` is kept in the
long-lived `chain.json`, which is regenerated/served by the mirror (`buildGenesis()` in
`siding/lib/chain.mjs` reconstructs the genesis block deterministically from `chain.pegs`, so a
mirror serving a `chain.json` with `pegs: []` could not itself replay genesis — this looks like the
`chains/*/chain.json` snapshot files in the spec repo are informational/documentation copies, not
the literal file each mirror serves; the mirror's own `chain.json` would need `pegs` populated for
`Siding.open()` to rebuild the genesis block from scratch. This is a real, unremarked
inconsistency between the "index/reference" chain.json files bundled in the spec repo and what
`chain.mjs` requires to open a chain from nothing).

---

## 2. Block structure, validation, the kernel

### 2.1 Provenance — bitcoin-desktop/schema is the kernel

`siding/lib/engine.mjs` is explicit: it imports `${SCHEMA}/codec/kernel.js`'s `createKernel`,
loads `schema/core.jsonld`, `schema/proof.jsonld`, `schema/script.jsonld`, `schema/chain.jsonld`,
`schema/validate.jsonld` from a checkout of `bitcoin-desktop/schema` (default path
`~/bitcoin-desktop/schema`, overridable via `SCHEMA` env var; the wallet defaults to
`https://cdn.jsdelivr.net/gh/bitcoin-desktop/schema@v0.0.27`), then layers three overlays:
1. `knotsBlake2b(...)` from `schema/codec/overlays/knots-blake2b.js` — the parent testnet4's
   BLAKE2b-header variant (see `schema/README.md`: "declarative schema" project, JSON-LD-driven
   codec that "must round-trip real mainnet data byte-exactly").
2. `sidestrOverlay(chain, {hash, secp})` from `siding/lib/overlay.mjs` — sidestr's own rules
   (below).
3. Chain-specific rule overlays from `siding/lib/overlays/index.mjs` (`assets`, `pool`, `evm`) —
   only loaded when `chain.rules` names them.

`schema/SPEC_COVERAGE.md` documents the kernel's own scope: it validates headers, transactions and
blocks against an independently sourced consensus checklist (the "BTCDecoded Orange Paper"
section tree), explicitly **excludes** mempool/relay policy (RBF, standardness, fee-market) as
out of scope, and claims to exceed the reference on BIP94 timewarp/testnet4 min-difficulty and to
implement full Taproot (BIP341/342), the unified sighash (Knots' post-fork sighash), and reorg
recovery with bounded walk-back. Signet-style block-signature validation (BIP325) is listed as
only "◐ partial — signet NetworkParams present... block-signature validation not yet implemented"
in the *generic* schema/kernel — sidestr supplies exactly that missing piece itself, as an overlay
rule (`sidestr:rule-block-signature`, below), rather than waiting on the kernel to grow it.

### 2.2 What sidestr validates in-page vs. trusts

Per SPEC.md §1 ("Users validate, signers order") and §9 (levels), and confirmed by the code:

- **In-page / always validated by every node, level 1 included**: full Bitcoin transaction and
  script rules (via the kernel), block structure, proof-of-work against `powLimit`, the block
  signature against `challenge` (`sidestr:rule-block-signature` in `overlay.mjs`), the coinbase
  amount ≤ subsidy(0) + fees + paid claims (`btc:rule-blockctx-coinbase-amount`, overridden by
  `overlay.mjs` to add claims, and again by `overlays/evm.mjs` to add EVM withdrawals), no
  double-claim of a peg-in outpoint (`sidestr:rule-claims`), peg-out burn shape/minimum
  (`sidestr:rule-pegouts`), and, when opted in, the `assets`/`pool`/`evm` rules.
- **Trusted at level 1** (SPEC.md §9): *which peg-ins exist* (a level-1 validator has no parent
  view, so it accepts whatever the signer's coinbase claims as valid — the structural
  claim/payout pairing stops a signer minting arbitrary amounts, but not claiming a peg-in that
  never happened) and *that peg-outs are actually paid* on the parent (nothing in-chain proves a
  burn was honoured; `pegouts.json` on the mirror is the producer's own bookkeeping, and the
  wallet's `pegoutsPaid()` merely fetches and trusts it).
- **Trusted at level 2**: a parent-chain view (headers + the peg outputs) is added, so a validator
  can check a claim against real testnet4 data and refuse an unverifiable one (SPEC.md §9), but
  *ordering* is still trusted to the signers.
- **What the mirror provides, and is never trusted for correctness**: the block file itself
  (`[u32 height][u32 size][block]` plus a JSON index — SPEC.md §11), served over plain HTTP.
  Every validator (explorer, wallet) replays every block through the same kernel; the mirror is
  cross-checked only for *liveness/honesty of tip* against the signer's own kind-33333
  announcement (`announce.mjs`'s `judgeMirror` — same tip hash, mirror may lag but never lead).

### 2.3 The signature check itself (BIP-325 reuse)

`block.mjs` builds a **virtual signet-style transaction pair** exactly as BIP 325 (signet)
specifies: `blockData()` computes `sha256` over the first 72 header bytes with the merkle root
recomputed from the coinbase *stripped of its solution push*; `virtualTxs()` builds a `to_spend`
transaction whose `scriptSig` carries that hash and a `to_sign` transaction spending it, paying an
`OP_RETURN`; the chain's `challenge` script is evaluated as if it were the `to_spend`'s output
script, with the block's solution witness as the spend. `sidestr:rule-block-signature` in
`overlay.mjs` does exactly this via `interpreter.verifyInput`. This is **BIP 325's challenge
mechanism reused as-is** (SPEC.md's own Appendix B says so), just retargeted at sidestr's own
per-chain challenge script rather than a global signet challenge — and, per §4 of this report,
the level-2 challenge additionally reuses the taproot **script path** (a `multi_a` leaf under an
unspendable NUMS internal key) rather than a level-1 key-path spend.

---

## 3. Nostr kinds, tags, event formats, relay assumptions

### 3.1 Complete kind table (SPEC.md Appendix A, cross-checked against code)

| kind | name | class | code reference |
|---|---|---|---|
| 23500 | transaction, content = tx hex, tag `chain` | ephemeral | `relay.mjs` `TX_KIND`; `spend.mjs`'s `deliver()` |
| 23501 | faucet request, content = an address | ephemeral | `relay.mjs` `FAUCET_KIND`; `wallet.mjs` `requestFaucet()` |
| 23510 | block proposal (level 2), content = block hex without solution, tags `chain`,`h` | ephemeral | `round.mjs` `PROPOSAL_KIND` |
| 23511 | partial block signature (level 2), tags `chain`,`h`,`e`=proposal id, content = hex sig | ephemeral | `round.mjs` `PARTIAL_KIND` |
| 23512 | peg-out PSBT to co-sign (level 2), tags `chain`,`d`=outpoint,`h`, content = PSBT | ephemeral | `pegoutround.mjs` `PEGOUT_PSBT_KIND` |
| 23513 | co-signed peg-out PSBT, tags `chain`,`d`,`e`=23512 id, content = PSBT | ephemeral | `pegoutround.mjs` `PEGOUT_SIGNED_KIND` |
| 23514 | sealed block (level 2), content = full sealed block hex, tags `chain`,`h` | ephemeral | `round.mjs` `SEALED_KIND` |
| 33333 | tip announcement, `d`=chain id, NIP-333-shaped | addressable | `announce.mjs` `TIP_KIND` |
| 33500 | rule document, `d` = chain id : activation height | addressable | SPEC.md §8 only — no dedicated code module found for publishing/parsing rule documents in this clone; the mechanism is specified but **not yet implemented in `siding/lib`** as far as this snapshot shows (no `33500` literal anywhere under `siding/lib`) |
| 33501 | genesis document, `d` = chain id | addressable | SPEC.md §5 only; likewise not found as a literal constant in `siding/lib` — genesis is instead reconstructed deterministically from `chain.pegs` by `buildGenesis()`, sidestepping the need to fetch/parse a 33501 event at open time |
| 33502 | peg record `d` = parent txid:vout (SPEC Appendix A) — **repurposed** in code as the desk's pledge event | addressable | `pledge.mjs` `PLEDGE_KIND = 33502`; `wallet.mjs`'s `pledge()`/`publishPledge()` publish pledges under this kind, tagged `d`=`<reward outpoint>`, `chain`=chain id, content = pre-signed maturity tx hex — this is a **second use of kind 33502** beyond SPEC Appendix A's "peg record" description, i.e. the desk proposal (later than 0.0.1) reused the same kind number for a different addressable record without a spec update visible in this clone |

Two kind-numbering observations worth flagging for a port: (1) 33500/33501 are specified but have
no implementing code in this snapshot — a Rust port has no wire example to work from for rule
documents or genesis events, only the prose in SPEC.md §5/§8; (2) 33502 is defined in SPEC.md
Appendix A as "peg record" but is *actually used in code* as the desk's pledge-transaction kind —
these are two different addressable-event schemas sharing one kind number, distinguished only by
`d`-tag shape (`<parent txid>:<vout>` for a peg record vs. `<reward txid>:<reward vout>` for a
pledge — structurally identical, so nothing actually breaks, but a strict reader should not assume
kind 33502 always means "peg record").

### 3.2 Event formats in detail

- **Signing** (`relay.mjs` `makeEvents`): event id = `sha256(JSON.stringify([0, pubkey,
  created_at, kind, tags, content]))` — **exactly NIP-01**'s canonical serialization. Signature =
  BIP-340 schnorr over the 32-byte id, same `schnorrSign` as chain-block signing
  (`schnorr.mjs`). This is a hand-rolled, minimal Nostr event implementation (no external
  nostr-tools dependency in `siding/lib`), consistent with the file's own comment ("pure... a
  browser can use it too").
- **Transaction events (23500/23501)**: signed with a **throwaway key** every time
  (`signer.randomKey()`) — "the transaction authorises itself... a wallet needs no identity to
  spend" (SPEC.md §11, `wallet.mjs` line 206, `relay.mjs` comment). This is a genuine
  privacy/deniability property: submitting a spend never links a wallet's spending key to any
  persistent Nostr identity, because only the on-chain tx signature (over the sidechain UTXO,
  BIP-340/unified-sighash) matters for validity, and the wrapping Nostr event's signer is
  disposable.
- **Tip announcement (33333)**: NIP-333-shaped (`announce.mjs` `tipEvent`) — tags `d`=chain id
  (addressability), `n`=chain id (duplicate, presumably for a different indexing convention),
  `t`=`sidestr` (a fixed tag so "a directory can ask a relay for every sidestr chain at once" —
  SPEC.md §11), `tip`=height, `alt`=human-readable NIP-31 fallback text, `u`=mirror URL (one tag
  per mirror, no explicit marker attribute despite NIP-33333-style conventions elsewhere using
  `["u", url, "mirror"]` — code does add the third element `'mirror'`). Content = the last twelve
  headers concatenated as raw hex (`TIP_HEADERS = 12`re; each header is 328 hex chars =164 bytes,
  matching the BLAKE2b v2 header variant's larger header size vs. Bitcoin's 80-byte header —
  `parseTip()` asserts `content.length % 328 === 0` and slices into 328-char chunks).
- **Level-2 round events (23510/23511/23514)**: `round.mjs` — proposal is signed by the proposer
  with their real Nostr/signer key (not a throwaway — signer identity *is* the authorisation
  here), content is the raw block hex sans solution; partials reference the proposal by `e` tag
  (NIP-01 event reference) and carry a bare 64-byte hex BIP-340 signature as content (not wrapped
  in any further structure); the sealed-block broadcast (23514) exists purely so that
  non-proposing signers can adopt the finished block without waiting on their own mirror to catch
  up.
- **Level-2 peg-out round (23512/23513)**: `pegoutround.mjs` — content is a **raw PSBT** (Partially
  Signed Bitcoin Transaction, base64/hex as produced by the parent node's own RPC,
  `walletcreatefundedpsbt`/`walletprocesspsbt`/`combinepsbt`/`finalizepsbt`), tagged `d` = burn
  outpoint so multiple in-flight peg-outs don't collide, `h` = the burn's sidechain height (used
  to derive who is "entitled" to propose this round, round-robin like block proposing).

### 3.3 Relay assumptions

- **No custom relay software** — plain public Nostr relays are used (wallet defaults:
  `wss://nos.lol`, `wss://relay.damus.io`, `wss://relay.primal.net`, `wss://nostr.mom`,
  `wss://nostr.oxtr.dev` — `wallet.mjs` `DEFAULTS.relays`).
- **Filtering is kind-only at the relay, tag-checked client-side**: `relay.mjs`'s `subscribe()`
  comment is explicit: "relays index single-letter tags for filtering and refuse `#chain`
  (\"unindexed tag filter\")" — so a producer subscribes to a *kind* (e.g. all 23500 events on
  that relay, from all sidestr chains) and manually filters by the `chain` tag value after
  receipt. This is a real scalability constraint: as more sidestr chains share the same public
  relays, every producer must download and discard every other chain's transaction events of the
  same kind.
- **`33333` (tip) IS filterable by `#d`** (`announce.mjs`'s `fetchLatestTip` sends
  `{kinds:[TIP_KIND], '#d':[chainId]}`) — `d` is one of Nostr's indexed single-letter tags, so
  addressable-event lookups by chain id are efficient; only the *ephemeral* kinds (tx/proposal/
  partial/sealed/PSBT) hit the "kind-only" filtering limitation.
- **No relay trust for content correctness** — every inbound event's Nostr signature is verified
  (`verify` callback, ultimately `codec/nostr.js`'s `verifyNostrEvent`) before use, and every
  transaction/block/PSBT payload is independently re-validated against local chain state before
  any effect (SPEC.md's stated design: "nothing trusted from a mirror" extends to relays too).
- **Reconnection**: `subscribe()` implements simple exponential backoff (1 s doubling to 60 s cap)
  per relay URL, with a 10,000-entry `seen` dedup set (evicted oldest-first once full — an
  approximate LRU via `Map` insertion order).
- **Timing assumptions baked into the level-2 round** are notably loose and client-clock-driven
  (`round.mjs`'s `entitled()` uses wall-clock `Date.now()` skew tolerance, "another signer's clock
  may run a little ahead of mine" — there is no NTP/consensus-time mechanism, purely a
  lateness-tolerant round-robin).

---

## 4. Peg-in / peg-out mechanics

### 4.1 Peg-in (SPEC.md §6, `overlay.mjs`, `marker.mjs`, `parent.mjs`)

1. **Parent transaction** pays a **peg output**: a taproot output whose *key path* is the peg
   holders' key (single key at level 1; the level-2 `tr(NUMS, multi_a(k,...))` descriptor at level
   2, §4.3 below) and whose *script path* is `and_v(v:pk(refund), older(refundBlocks))` — the
   pegger's own refund key, spendable after `refundBlocks` (10,000 in every example chain)
   unspent parent blocks.
2. The **same transaction** (or another output of it) carries an `OP_RETURN`:
   `pegin:<chain id>:<sidechain output script>` — `marker.mjs`'s `pegMarkerData()` packs this as
   raw UTF-8 prefix + raw script bytes when it fits the 80-byte `OP_RETURN` policy limit (a taproot
   script is 34 bytes, so `pegin:sidestr:txbt4-siding:` + 34 raw bytes = well within 80 for short
   chain ids; the function falls back to an all-hex text form if the raw-bytes form would exceed
   80 bytes for a longer chain id).
3. After `pegConfirmations` (6 everywhere) confirmations, a sidechain block **claims** it: the
   coinbase pays the named sidechain script the peg amount, and the **very next coinbase output**
   is `OP_RETURN claim:<parent txid>:<vout>` (`overlay.mjs`'s `parseClaims` enforces this strict
   adjacency — "a claim at output i has no payout before it" is a hard validation error). This
   structural pairing is exactly what lets a level-1 validator (no parent view at all) still bind
   each claimed *amount* to one outpoint and prevent double-claims (`sidestr:rule-claims` maintains
   a `claims: Map<outpoint, height>` and refuses a re-claim at a different height).
4. **Level 1** accepts whatever the signer's coinbase claims — no verification the parent
   transaction exists at all. **Level 2** additionally has `parent.mjs`'s `scanPegins()`, which
   walks the parent's actual blocks via `getblock ... 2` RPC looking for the `pegin:` marker and
   records real `{txid, vout, amount, script, height}` tuples — so a level-2 validator/producer
   can refuse (`checkClaims` hook in `round.mjs`) a claim it cannot verify against real testnet4
   data.
5. **Refund path**: `and_v(v:pk(refund), older(refundBlocks))` gives the pegger an unconditional,
   signer-independent way to recover pegged coins if the chain is never claimed or dies — "a dead
   sidechain costs time, not coins" (SPEC.md principle 5). While the parent stalls, the relative
   timelock (`older(...)`, counted in confirmed parent blocks) simply doesn't advance — SPEC.md
   §14 notes this compounds down a chain of siding parents (§3.1's nesting).

### 4.2 Peg-out (SPEC.md §7, `chain.mjs`'s `submit()`, `overlay.mjs`, `parent.mjs`,
`pegoutround.mjs`)

1. A **sidechain transaction** burns value by paying an `OP_RETURN pegout:<parent script hex>`
   output (`overlay.mjs`'s `pegoutMarker`/`parsePegout`, 2–40 raw bytes of parent script) of at
   least `pegoutMin` sats (10,000 everywhere). `chain.mjs`'s mempool `submit()` enforces the
   minimum and shape *before* accepting the transaction; `sidestr:rule-pegouts` re-enforces it at
   block-validation time and also forbids a burn in the coinbase, and forbids a burn's outpoint
   being "claimed" (re-recorded) at two different heights.
2. **Level 1**: the peg holder (same key as the signer) pays the burn from its own parent-node
   wallet directly via Bitcoin Core-style RPC (`parent.mjs`'s `payPegout()`:
   `send([{address: value}, {data: pegoutMarkerData}], ...)`), carrying `OP_RETURN
   pegout:<chain id>:<sidechain txid as 32 raw bytes>` on the *parent* side so a level-2/parent-
   aware validator can pair the burn with its payment (`parsePegoutMarker`). This is unilateral —
   "in level 1 this is the federation's promise and the validators' record of whether it was kept"
   (SPEC.md §7) — nothing on-chain forces the payment; `pegouts.json`/`paidPegouts()` (scanned from
   the wallet's own transaction history) is the only record.
3. **Level 2**: `pegoutround.mjs` runs a **PSBT co-signing round** over the same relay
   infrastructure as block proposals: the entitled signer (round-robin by burn height mod n, same
   lateness-tolerance pattern as block proposing) funds a PSBT via `walletcreatefundedpsbt`
   (paying the burn's parent script + the marker output, fee_rate hard-coded to 2x the chain's
   minimum "because a k-of-n taproot script-path spend carries k signatures, the leaf and a control
   block, which the estimate undercounts" — a real bug they hit and fixed live per the changelog:
   "the wallet's fee for a script-path spend came out under the relay minimum"), publishes it as
   kind 23512, each other signer independently **re-derives the exact expected outputs**
   (`psbtPaysBurn()` checks the PSBT pays exactly the burn amount to the burn's script plus the
   marker plus change back to the peg — refusing anything else, "pays something besides the burn
   and change to the peg") and signs with its own share via `walletprocesspsbt`, returns as 23513;
   once `threshold` signatures are collected the proposer `combinepsbt`+`finalizepsbt`+
   `sendrawtransaction`s it. This is a genuinely trust-reduced construction (each signer's own
   node independently reconstructs and checks the PSBT's semantics before signing — not blind
   co-signing) but it is **not trustless**: a majority-`k` collusion can still steal or redirect
   arbitrary peg funds, exactly as any k-of-n multisig custodian model.
4. **Trust-minimised (non-custodial) peg-out** is explicitly **out of scope for 0.0.1** (SPEC.md
   §7's final line). There is no drivechain/spacechain-style parent-enforced peg here — Appendix B
   explicitly disclaims reaching that level: "drivechains and spacechains, which want the parent
   to enforce the peg and are the level this does not reach."

### 4.3 Level-2 challenge construction (`federation.mjs`)

- **Internal key**: `H + tagged_hash("sidestr/nums", chain_id)·G` where `H` is BIP-341's NUMS
  point (`50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0` — the same constant
  every taproot-assets/anti-key-path-spend construction uses), tweaked per-chain by hashing the
  chain id — this makes the internal key **provably unspendable and chain-specific** (no shared
  internal key across sidestr chains that could create cross-chain confusion).
- **Leaf script**: `<pk_1> CHECKSIG <pk_2> CHECKSIGADD ... <pk_n> CHECKSIGADD <k> NUMEQUAL` — the
  standard `multi_a(k, pk_1..pk_n)` miniscript fragment, BIP-342-native (Tapscript-only opcode,
  `OP_CHECKSIGADD`).
- **Witness**: `n` signature slots in **reverse leaf order** (documented explicitly as a real gap
  between spec prose and implementation: "Two rules the draft did not state... the witness carries
  the slots in reverse leaf order"), exactly `k` filled (a `k+1`th signature fails `NUMEQUAL`),
  then the leaf script, then the control block.
- **The same challenge derivation secures both the block-signing key and the parent peg wallet** —
  `pegDescriptor()` builds `tr(<internal>,multi_a(k,...))`, importable into a Bitcoin Core-style
  wallet as a descriptor with each signer's own key kept private (WIF) and the others' public.
  This means **one k-of-n key set custodies both the chain's block-signing authority and the
  parent-chain peg funds** — compromising or colluding among `k` of the signers grants both block
  production and peg theft simultaneously; the two roles are not separated.

### 4.4 Parent chains supported

Every single chain document in this clone — `txbt4-siding` (the reference chain, SPEC.md §10),
`gitmark`, `txbt4-evm`, `txbt4-fed`, `txbt4-desk`, `tally`, `melchain`, `capewars-s6` — has
`"parent": "btc:testnet4-blake2b"`. This is **testnet4**, specifically a **BLAKE2b-header variant**
of testnet4 (the "blaketestnode"/"BLAKE2b testnet4" repeatedly named in chain comments — this is
*not* standard Bitcoin testnet4, but a Knots-derived fork using BLAKE2b as its PoW hash function,
per `overlay.mjs`'s `powHash: 'knots:blake2b-v2'`). **No mainnet-parented chain exists anywhere in
this clone**, and SPEC.md §3.1 (nesting) is architecturally ready for a sidestr-on-sidestr chain
(a parent may itself be a sidestr chain) but no example of that is shipped here either — `melchain`
and `capewars-s6` and `tally` etc. are all siblings pegged directly to the same testnet4, not
nested under one another.

---

## 5. Opt-in rules

### 5.1 `assets` (assets-and-pools.md §1–2, `overlays/assets.mjs`)

Records ride on ordinary `OP_RETURN` outputs, UTF-8, ≤255 bytes, single push:
- `issue:<TICKER>:<decimals>` — issues a new asset, id = this txid, ticker 1–8 chars `[A-Z0-9]`,
  decimals 0–8 (display only).
- `tally:<asset>:<vout>=<amount>[,...]` — assigns amounts of an asset to specific outputs of this
  transaction (`self` in the issuing tx refers to the new asset).
- Consensus invariant, per asset, per non-coinbase tx: **inputs carry ≥ what tallies assign**; the
  difference is destroyed (a burn mechanism, "spending a tallied output without tallying its
  assets onward destroys them"). Issuance is the sole creation path. At most one `issue:` per tx.
  A malformed/self-inconsistent record invalidates the block (`sidestr:rule-assets`, error
  `bad-tally`).
- Code (`assets.mjs`) implements this with a `CarryView` — a copy-on-write overlay over the
  committed `carried: Map<outpoint, Map<asset,amount>>` state, so a block's transactions can spend
  what earlier transactions in the *same* block created, and the whole block's effects commit or
  discard atomically (`installChecks` folds `view.temp`/`view.spent` into `carried` only if every
  transaction in the block validates; it is explicitly made idempotent per-height so a re-validated
  or competing block at the same height doesn't corrupt state).
- Assets **never touch the peg** — "a burn is of sats only, and an asset has no parent"
  (assets-and-pools.md §2) — this is a deliberate scope boundary: no asset can leave the chain via
  the sats peg-out path.

### 5.2 `pool` (assets-and-pools.md §3, `overlays/pool.mjs`)

- A **pool** is one `OP_TRUE` (`51`) coin holding `x` sats and `y` units of exactly one asset;
  shares are an asset whose id is the pool's opening txid.
- **Opening**: `pool:self:<vout>` + `tally:self:...` minting `floor(sqrt(x0*y0))` shares — the
  standard Uniswap-v2-style constant-product initial-liquidity formula (geometric mean of the two
  reserves).
- **Continuing** spends: exactly one of **swap** (`S'=S`, constant product held after a 3/1000 fee
  on the incoming side — `(1000x' - 3dx)(1000y' - 3dy) >= 1000000xy`, all in exact `BigInt`
  arithmetic, no floating point), **add** (`S'>S`, minted pro rata to the smaller of the two
  deposit ratios, floor-rounded), or **remove** (`S'<S`, withdrawn pro rata, floor-rounded, pool
  never emptied — `x'>=1 && y'>=1` enforced). "Every rounding is in the pool's favour"
  (assets-and-pools.md §3) — this is a deliberate anti-drain design (rounding errors always accrue
  to remaining LPs, never let a user extract fractional dust profitably).
- **Front-running is explicitly acknowledged, not solved**: "the signer orders transactions and so
  can front-run them; at level 1 that is the signer's to refrain from and the document says so, at
  level 2 it takes k of them" (assets-and-pools.md §3) — there is no commit-reveal, batch auction,
  or any MEV mitigation; this is a bare centralized-sequencer AMM with an honesty assumption on the
  block producer(s).
- Running on `sidestr:tally` since 18 September 2026 per both the proposal status line and the
  chain document's own `comment`.
- **§4, assets between chains, is explicitly a draft, level-2-only, unbuilt in this clone** —
  cross-chain asset pegging is architecturally sketched (burn on origin + claim as wrapped asset
  `<origin chain id>:<origin asset id>` on destination, mirroring the sats peg-in/out shape) but
  the report finds no corresponding code in `siding/lib/overlays/`.

### 5.3 `desk` (desk.md, `pledge.mjs`)

- Addresses a specific parent-chain feature: **long-locked coinbase rewards** (the BLAKE2b testnet4
  chains lock rewards from `lockedFrom` until `maturity`, per an as-yet-unmerged Bitcoin Knots PR
  419). A **pledge** is a pre-signed transaction spending a locked reward to the chain's peg
  address (with the standard `pegin:` marker) and `nLockTime` = the reward's maturity height, so it
  literally cannot be broadcast/confirmed before maturity — miner publishes it as kind 33502.
- The desk verifies the pledge now (`verifyPledge()`: checks single input/two outputs, the reward
  is an unspent coinbase past `lockedFrom`, lock time equals computed maturity, output 0 pays the
  peg script, output 1 is exactly the marker naming this chain and a valid key-path payee script,
  fee within `100..100000` sats, signature verifies, reward ≤ `maxPerPledge`) and pays
  `floor(amount × rate)` sats **immediately** from its own float, recording it in `pledges.json`.
  At maturity it broadcasts every held pledge, each of which confirms as an ordinary peg-in and is
  claimed to the **signer's own float**, not to the payee — "because the payee was paid already."
- **Trust model is explicit and one-sided in the miner's favour**: "what the miner keeps is the
  key: at maturity they could spend the reward themselves before the desk's broadcast lands. A
  pledge is a commitment, not a covenant" (desk.md). The desk bears the risk that the miner defects
  at maturity (or a reorg pushes past maturity before the desk's broadcast lands); the miner bears
  no equivalent risk once paid.
- **Status: paused** — `txbt4-desk/chain.json`'s `pledge.paused: true`, with `pausedNote`
  explaining that PR 419's testnet activation height moved from 151,055 to 151,406 mid-flight and
  no parent node yet enforces the lock, so "a pledged reward can be spent by its miner at 100
  blocks, which would invalidate the maturity transaction after the desk has paid" — i.e. **the
  desk currently refuses all pledges because the underlying parent-chain feature it depends on is
  not yet live**. `pledge.enforceFrom: 151550` is a second height, from which *sidestr nodes
  running this rule* refuse an early spend, decoupled from the parent's own enforcement height —
  a defence-in-depth measure against a race where the parent hasn't caught up yet.

### 5.4 `checkpoints` (checkpoints.md, `checkpoint.mjs`)

- One `OP_RETURN` every N blocks: `ckpt:<chain id>:` + height (4 bytes LE) + `:` + 32-byte block
  hash — 58 bytes total for a 15-byte chain id (well within the 80-byte policy limit; `checkpoint.mjs`
  throws if a longer chain id would exceed it).
- Purpose: **"an announcement says where the chain is; it carries no proof of work"** — a
  checkpoint transaction, buried in the parent, proves the chain's history up to that point
  existed *before* the parent block that carries it. This bounds backdating: a validator "shows
  every block at or below the newest confirmed checkpoint as anchored in the parent, and treats a
  mismatch as a rewritten history" — but "checkpoints bound what a signer can backdate; they do
  not order what happens between them" (i.e. this is an anti-rewrite/anti-backdating mechanism,
  not a liveness or ordering guarantee).
- Running on `sidestr:gitmark` — this is exactly the mechanism `gitmark`'s comment describes
  ("every few blocks the tip is checkpointed into the BLAKE2b testnet4").
- Level 2 adds one more check: "also checks that the parent transaction exists and is buried" (not
  just unspent-output-shaped, but confirmed to a depth).

### 5.5 `evm` (evm.md, `overlays/evm.mjs`)

- Full account-based EVM execution **inside** ordinary sidestr transactions: `evm:` + RLP-encoded
  signed Ethereum transaction as a carrier record, executed by every validator in output order
  through `ethereumjs` (`@ethereumjs/vm` 10.1.3, pure JS, Cancun hardfork). No separate EVM block —
  the coinbase commits the resulting state root (`evmroot:` + 32 bytes) so every validator can
  cross-check their own re-execution against the claimed root (`prepare()` reverts and marks the
  block invalid on any mismatch, missing prior-height state, unsigned/bad-signature carrier, or
  reverting VM error other than a legitimate contract revert — a genuine revert is still "applied"
  with gas spent and nonce advanced, matching real Ethereum semantics).
- **Exchange rate is fixed and one-way in effect**: 1 sat = 1 gwei, base fee pinned at 1 gwei, no
  priority fee, fee burned, no block reward (sidechain fees pay the signer as normal). Deposit =
  pay the reserve script (default: the chain's own `challenge` script, i.e. deposits by default
  flow into the same key(s) that hold the peg / sign blocks) + `evmin:<20-byte address>` marker,
  credited at `value × 10^9` wei. Withdrawal = an EVM tx sending value to the fixed address
  `0x00000000000000000000000000000000000501de` ("sidestr" as a vanity suffix, `0501de`) with 34
  bytes of calldata (a sidechain output script) — burned in the EVM, and **the block's coinbase
  must pay `floor(value/1e9)` sats to that script**, enforced by the same overridden
  `btc:rule-blockctx-coinbase-amount` check pattern used for peg claims.
- Deployed as `sidestr:txbt4-evm`, chain id 21474, gas limit 30M, one signer.
- **Explicitly unfinished** (evm.md "Not yet"): receipts/logs are in-memory only, rebuilt from
  scratch on every open (no snapshotting — "fine for a small chain; a snapshot is needed before a
  large one"), wallet UI has no deposit button yet, the standalone browser explorer loads
  `ethereumjs` from a CDN in-page ("heavy, untested"), and cross-chain asset bridging to/from an
  EVM chain is deferred to the still-draft assets-between-chains mechanism.

### 5.6 `ephemeral` (ephemeral.md) — a design note, nothing built

Not a rule a chain document names in `rules` — no code implements it. It proposes:
- `"close": {"height": N}` or `{"time": T}` — the chain stops taking blocks past that point; its
  final ("closing") block pro-rata pays out every coin holder in one coinbase transaction with no
  fee, and the signer pegs out the whole peg address on the parent in the same proportions,
  treating the closing block's payouts as the peg-out burns SPEC §7 already requires.
- The **tombstone**: the closing block's hash is checkpointed into the parent as the chain's last
  act (reusing `checkpoints.md`'s mechanism), so a later dispute about the chain's final state can
  be settled from any party's own retained copy even after every mirror disappears.
- "Manners" for short-lived chains: announce only at genesis/close/hourly (no continuous mirror
  needed — "the parties read each other's producer directly"), carry `purpose`/`party` tags on the
  genesis announcement for discoverability, and peg in the minimum needed (since the parent fee is
  flat regardless of peg size).
- Framed explicitly around **agent use cases**: payment tabs, negotiations/escrow, game/session
  ledgers, and rule-sandboxing — "the parties are usually agents. An agent with a key can make a
  chain in a second, and it has no reason to keep one it has finished with." This is the single
  clearest design statement in the whole corpus that sidestr is being built with autonomous-agent
  economic actors as a first-class user, not just human wallets.

### 5.7 What `level-2` adds, precisely (cross-referencing §4.3 above)

Beyond the k-of-n challenge and PSBT peg-out round already detailed: (a) a **block-production
round** over Nostr (proposal → partial signatures → seal, `round.mjs`) replacing single-signer
`produce()`; (b) **one-signature-per-height** discipline with a lateness-based relaxation so a dead
proposer doesn't permanently stall a height, and a symmetric drop of one's own stalled proposal
after `proposeAfter × n` seconds; (c) genesis for a federated chain is **sealed by k keys**
up front (`siding new --signers ... --key-files ...`), each signer starting from an identical copy
of the resulting block file; (d) a still-unbuilt "step 8" — fetching that genesis block file from a
mirror rather than requiring every signer to already hold an identical local copy — and an
explicitly noted gap: **no support yet for a signer running on a separate machine, or for changing
the signer set** live (a new `signers`/`threshold` pair is specified as a rule document with an
activation height, but the peg *funds* must still be manually moved to the new descriptor by an
old-set-authorised peg-out — there is no automated resharing/rotation ceremony).

---

## 6. The wallet API and key derivation (`wallet/wallet.mjs`, `siding/lib/{address,schnorr}.mjs`)

### 6.1 `openWallet({mirror, chain, relays, cdn, lib, explorer, loadJson, onProgress})`

Discovers a chain either from an explicit mirror URL or (given only a chain id) by asking the
default public relay set for the newest kind-33333 tip announcement, taking the mirror(s) it
names, and accepting only a mirror whose own `chain.json` names `signer` as the announcement's
author (`announce.findChain`/`chooseMirror` — see §2.2, §3.2). It then instantiates an `Explorer`
(from `@sidestr/explorer`, replays every block) and wraps it in a `Wallet`.

### 6.2 Identity, address, EVM address derivation

- `wallet.identity(key)`: a 32-byte hex private key → `pub = pubkeyOf(key)` (x-only BIP-340 pubkey
  via `schnorr.mjs`'s `makeSigner`) → `script = '5120' + pub` (a **P2TR key-path output**, i.e. the
  sidechain address *is* a plain single-key taproot output under that key, exactly like a
  level-1 chain's `challenge`) → `address = scriptToAddress(script, hrp)` (bech32m under the
  chain's own `addressPrefix`). **This is the same construction as the level-1 block-signing
  challenge** — a chain signer's own coins live at the same kind of P2TR-keypath address any
  ordinary wallet key does; nothing distinguishes "signer key" from "ordinary spending key" at the
  address-derivation layer, only at the chain-document level (`chain.signer` names which pubkey is
  authorised to seal blocks).
- `wallet.ethAddress(key)`: `evm.lib.util.createAddressFromPrivateKey(hexBytes(key))` — the
  **same 32-byte secp256k1 private key** is interpreted directly as an Ethereum private key
  (standard Ethereum address derivation: `keccak256(uncompressed pubkey[1:])`'s last 20 bytes, via
  `ethereumjs`'s own utility, not a custom implementation). SPEC.md itself understates this
  slightly ("the same 32 bytes give an address by `keccak(pubkey)`" — evm.md) but the actual
  derivation goes through the standard secp256k1 ECDSA-style uncompressed public key, not the
  x-only/BIP-340 public key used for Nostr and taproot; this is architecturally correct (Ethereum
  needs the *full* public key including its Y-coordinate parity, which x-only keys discard) but is
  a subtlety a Rust port must get right: **one key, three different public representations**
  (BIP-340 x-only for Nostr/taproot; full secp256k1 point for Ethereum) all derived from the same
  private scalar.
- **A Nostr key is therefore, simultaneously**: (1) the wallet's Nostr identity for signing
  transaction/faucet/pledge events (albeit usually via a *throwaway* key for tx/faucet events —
  §3.2), (2) a sidechain P2TR spending key, (3) potentially the chain's block-signing/peg-holder
  key if it happens to be `chain.signer`, and (4) an Ethereum account key on any `evm`-rule chain.
  This key reuse across roles is a deliberate design choice ("Why Nostr" in `standards/sidestr.md`:
  "a Nostr key is a chain address on every sidestr chain and an Ethereum account on the EVM ones")
  but is also the central security concern examined in §7 below.

### 6.3 Transaction building (`wallet.build()`)

Standard coin selection (mature coins, largest-first, greedy fill to `amount + fee-bound`),
key-path taproot spend with the **unified sighash** (`SIGHASH_UNIFIED`, the Knots post-fork
sighash the kernel implements — `sighashUnified(tx, i, prevouts, ht, 2)`), fee computed by sizing
a dummy 65-byte-witness transaction at the chain's declared `minFeeRate`. Special output-layout
variants: `pegout` (destination = `pegoutMarker(resolveTo(to).script)`), `evmDeposit` (destination
= reserve script + a second `evmin:` marker output), and `carrier` (an arbitrary caller-supplied
script + note, used internally by `buildEvm`/`buildWithdraw`/`buildTokenTransfer` to wrap an
Ethereum transaction).

### 6.4 EVM convenience surface

`evmBalance`, `evmNonce`, `evmCode`, `evmCall` (dry-run on a checkpoint that's always reverted),
`evmEstimate` (intrinsic gas + calldata cost + 20% headroom over a dry-run's actual gas), `buildEvm`
(signs a real `ethereumjs` legacy transaction with the wallet's own key, wraps it as a carrier,
**dry-runs the exact wrapped transaction against local validated state before returning it** — "so
nothing leaves the machine that a validator would refuse"), `buildWithdraw`, a minimal hand-rolled
ABI encoder/decoder (`abi.encode/decodeUint/decodeString`, hardcoded selectors for ERC-20's nine
standard functions, `keccak` computed *inside the EVM itself* via a tiny bytecode snippet rather
than a separate Keccak library — a neat trick but notably means every `keccak()` call round-trips
through the whole VM), `token()` (reads ERC-20 metadata/balance), `buildTokenTransfer()`.

### 6.5 Desk wallet surface

`lockedRewards(script)` (reads `coinbases.json`/`pledges.json` off the mirror), `pledge()` (builds
and publishes a pledge via `pledge.mjs`'s `buildPledge`), `publishPledge()` (for a pledge signed
elsewhere).

---

## 7. Security and trust model

1. **Peg custody is fully custodial at level 1, k-of-n custodial at level 2** — there is no
   trust-minimised peg anywhere in this codebase (explicitly out of scope, SPEC.md §7). A level-1
   signer/peg-holder can simply move the peg funds; SPEC.md §14 states this plainly: "peg holders
   steal: possible in level 1, the coins are theirs to move... this is why level 1 is for coins
   with no value." Every shipped chain document's `comment` field independently confirms this is
   the intended posture right now ("Coins with no value" appears verbatim in all seven examples).
2. **Signers can stall or reorder/censor, cannot mint or steal via block signing alone** — a
   coinbase paying more than fees + verified claims is structurally invalid regardless of
   signature validity (SPEC.md §14). Stalling freezes the chain and every nested child's refund
   clock (§3.1) but does not lose coins — refunds simply wait.
3. **Rule adoption is per-node, not per-network, by design** — "user activated" rules mean two
   honest nodes that adopted different rule documents will silently diverge from the activation
   height "exactly as they would on any chain, and the block signatures do not settle it"
   (SPEC.md §8). This is a deliberate governance philosophy (rules are opt-in data, not something
   the signer can force), but it also means **there is no protocol-level mechanism to detect or
   resolve a rule-adoption fork** — a wallet or explorer showing one node's view has no built-in
   way to know it disagrees with another honest participant except by comparing tips out of band.
4. **Key reuse across roles is a genuinely under-examined risk surface** (§6.2 above; not
   discussed as a threat anywhere in SPEC.md or the proposals). Concretely:
   - The **same private key** signs Nostr events (transaction/faucet/pledge wrappers — usually
     throwaway, but the level-2 round's proposal/partial/sealed events and the desk's pledge
     events use the *real* signer identity), spends sidechain UTXOs (BIP-340/taproot), potentially
     seals blocks (if it is `chain.signer`), and controls an Ethereum account (if the chain runs
     `evm`). A key leaked or reused elsewhere (e.g. as a general-purpose Nostr identity key on
     unrelated relays/apps) simultaneously exposes chain funds, EVM funds, and — for a signer —
     block-production authority and the parent-chain peg.
   - There is **no key-separation guidance** in the wallet code or docs: `wallet.identity(key)`
     happily derives everything from one raw hex key with no domain-separation tag, and a signer
     running `federation.mjs`/`round.mjs` uses that same key for the block-sealing partial
     signatures.
   - This mirrors a documented general Nostr-ecosystem risk (`nostrfinance.github.io`'s
     `cryptography/` docs, not read in full for this report but flagged by title —
     `x-only-pubkeys.md`, `tweaks.md`, `schnorr-security.md` — as topics the wider docs corpus
     treats seriously) but sidestr's own spec/proposals do not cross-reference or discuss it.
5. **Mirror trust is bounded, not eliminated** — a mirror cannot lie about chain content (every
   block is independently re-validated) but *can* withhold blocks or serve a stale tip; the
   tip-announcement cross-check (§2.2, §3.2) catches a mirror claiming to be *ahead* of what the
   signer announced, or serving a *different* block at an announced height, but a mirror that is
   simply slow/behind is only detectable as "behind," not distinguished from one that's
   deliberately throttling a specific client.
6. **Replay protection**: transaction/block signatures are scoped by explicit sighash construction
   (unified sighash for ordinary spends; the BIP-325-style virtual-transaction sighash, optionally
   leaf-scoped via `leafHash`, for block/partial signatures) — no evidence of cross-chain replay
   risk was found (the block sighash is computed over that specific chain's header/challenge, and
   the `sidestr/nums` chain-id tag in the level-2 internal-key derivation is explicitly there to
   prevent one federation's derived internal key colliding with another chain's). One relay-layer
   replay note is explicit in code: `round.mjs`'s `onProposal` guards against "a relay replaying an
   old proposal: its proposer has moved on" via a wall-clock staleness check on `created_at`.
7. **If a level-1 signer disappears**: the chain simply stops producing blocks; every peg-in not
   yet claimed (or any peg-in at all, since claiming requires an active producer) and every
   peg-out burn already recorded but unpaid become permanently unfulfillable through the chain
   itself; the only remedy is the peg's own refund timelock for *unclaimed* peg-ins (`refundBlocks`
   after the peg-in confirmed, independent of signer liveness — this refund path needs no signer
   cooperation, SPEC.md principle 5). Already-**claimed** coins on a dead chain have no path back
   to the parent at all if the peg holder is unrecoverable — this is not explicitly discussed in
   SPEC.md's threat list (§14 covers "signers stall" as a liveness-only issue for *unclaimed* pegs
   but does not separately discuss recovery of already-pegged-in balances if the sole signer's key
   is lost, e.g. as distinct from the signer merely being offline).
8. **If a level-2 signer disappears**: the round tolerates it up to `n − k` missing signers per
   round (per the live-test note: "one down tolerated, two halts" for a 2-of-3 chain) via the
   round-robin proposer rotation and the entitlement lateness relaxation; below threshold the chain
   halts exactly as level 1 would.

---

## 8. The RGB seam, blocktrails, webledgers, NWC

### 8.1 RGB — the spec says essentially nothing; the fit is architectural, not implemented

`nostrfinance.github.io/docs/assets/rgb-protocol.md` (read in full) is a **generic, standalone RGB
explainer** — schema/genesis/state-transition/consignment model, RGB20/21/25 asset classes,
client-side validation, Lightning integration status, ecosystem/tooling survey. It **never mentions
sidestr, sidechains, or single-use seals against a sidestr UTXO** anywhere in its text. SPEC.md and
every proposal file (checked exhaustively — `assets-and-pools.md`, `desk.md`, `checkpoints.md`,
`evm.md`, `level-2.md`, `ephemeral.md`) likewise contain **zero occurrences of "RGB", "seal", or
"client-side validation"**. This must be stated plainly: **there is no RGB integration, planned or
implemented, anywhere in this codebase or its accompanying docs.** SPEC.md's only comparison point
is a single throwaway line in Appendix B ("RGB and Taproot Assets, for validation by the client
rather than the chain") positioning sidestr as the *opposite* design point — sidestr validates
consensus rules **on-chain, by every node**, whereas RGB pushes contract state **off-chain,
validated only by participants**.

Given that, any RGB seam is this report's own extrapolation from the two designs' shapes, not
something the spec proposes:

- **Where it could attach, architecturally**: sidestr already has three primitives RGB-style
  client-side validation could reuse without touching consensus:
  1. **Sidestr UTXOs as single-use seals.** Any sidechain output (an ordinary P2TR key-path coin,
     or a pool coin, §5.2) is already a Bitcoin-model UTXO enforced by the same script/interpreter
     rules as the parent — nothing stops an off-chain RGB-style contract from treating a sidestr
     coin's spend as its seal-closing event, exactly as RGB does against mainnet Bitcoin UTXOs
     today. Because every sidestr node already replays every transaction in full, a client-side
     validator would gain nothing sidestr doesn't already provide for the *consensus* fields (UTXO
     existence/uniqueness), and would layer its *own* off-chain state/proof graph on top, unseen
     by sidestr nodes, exactly as RGB does on L1 Bitcoin today.
  2. **Checkpoints as anchors, not seals.** `checkpoints.md`'s `ckpt:<chain id>:<height>:<hash>`
     record already does *half* of what an RGB anchor does — it commits a compact, periodic digest
     of chain state into a chain with real proof-of-work. It is not itself a single-use seal (it
     doesn't consume/reveal a UTXO the way a seal does), but the same OP_RETURN-commitment pattern
     (a hash of accumulated off-chain state, buried in PoW) is the mechanism RGB anchors use against
     Bitcoin, so a client-side contract system could piggyback a Merkle root of its own state
     transitions onto sidestr's existing checkpoint transaction rather than needing a second
     commitment scheme.
  3. **The `assets`/`pool` rules are the wrong layer for RGB-style contracts, on purpose.** SPEC.md
     principle 4 and the assets-and-pools proposal make issued assets and pools **consensus rules,
     validated by every node** — the polar opposite of RGB's premise (private, participant-only
     validation). A chain wanting RGB-style privacy for its assets would *not* name `assets`/`pool`
     in its `rules` array at all; it would run a plain sidestr chain (no extra rules) and build the
     RGB contract layer entirely client-side against its UTXOs, the same way RGB works on mainnet
     Bitcoin — sidestr would then just be "faster/cheaper Bitcoin" as the seal-bearing chain, not a
     protocol RGB has to be aware of.
  4. **A chain-level rule vs. a client-side contract are explicitly different design points in this
     spec's own vocabulary** — "rules are documents" (SPEC.md §4) that every node with the key
     enforces is the *opposite* of RGB's "only participants validate." A future
     `rules: ["rgb-commitments"]`-style opt-in (reserving OP_RETURN space or a specific output
     pattern for RGB commitments, without validating RGB contract semantics in-consensus) would be
     architecturally consistent with how `checkpoints`/`evm`/`assets` were each added as one named,
     independently-toggleable rule — but nothing like it exists in this clone, drafted or built.
- **Honest limit of this analysis**: everything in this subsection beyond the direct SPEC.md/docs
  quotes is inference about where the two systems' shapes *could* meet, not a documented design
  intent. A reader should not cite this report as evidence sidestr "plans" RGB support.

### 8.2 blocktrails — a real, load-bearing relationship (unlike RGB)

Unlike RGB, blocktrails is **directly named and used** by a real chain in this clone: `gitmark`'s
own `comment` field says it exists *for* blocktrails ("a chain for blocktrails — git commits
anchored as trails of tweaked taproot outputs"), and `checkpoints.md`'s status line says
checkpoints are "running on `sidestr:gitmark`". Per `standards/blocktrails.md` (read in full,
generic explainer, no sidestr-specific text either — same caveat as RGB: the docs corpus explains
blocktrails abstractly, it does not itself say "and here is how gitmark uses it"), blocktrails is a
**key-tweaking single-use-seal chain**: each state update hashes the new state, uses that hash as a
tweak added to the previous private key, and the new pubkey becomes the next P2TR (key-path-only)
output — "the spend chain mirrors the key chain, creating verifiable history." The **inferred**
relationship (again, not spelled out in either doc, only reasoned from the two systems' shapes):
sidestr's `gitmark` chain gives blocktrails-style tweaked-output chains a venue that confirms in
seconds (no PoW, a laptop-cheap signed block) for the git-commit-anchoring use case, with the
*real* security (bounding how far a signer could backdate a mark) arriving in batches via the
`checkpoints` rule's periodic OP_RETURN anchor into testnet4's actual proof-of-work. This is the
one place in the whole corpus where a named external protocol (blocktrails) and a named sidestr
chain (gitmark) are explicitly and concretely linked by a chain document's own prose.

### 8.3 webledgers — no relationship found

`standards/webledgers.md` (read in full) is a URI→balance JSON-LD mapping spec (kind-30078
parameterized-replaceable Nostr events, `did:nostr:`/`mailto:`/`https:`/`bitcoin:`/`lightning:`
identifier schemes, multi-currency/multi-unit entries). It is a **W3C Web Payments Community Group
community draft**, not a W3C standard, per its own "Specification Status" section. **No sidestr
document, chain, or proposal references webledgers**, and no code path in `siding/lib` publishes or
consumes kind 30078. The two are conceptually adjacent (both are "balances as URIs/JSON over
Nostr") but there is no integration.

### 8.4 NWC / NIP-47 as a wallet control plane — plausible, unimplemented

`docs/wallets/nwc.md` (read in full) documents standard NIP-47 Nostr Wallet Connect: a
connection-string handshake (`nostr+walletconnect://<pubkey>?relay=...&secret=...`), NIP-04-
encrypted request/response events (kinds 23194/23195/13194), a fixed command set
(`pay_invoice`, `make_invoice`, `get_balance`, `get_info`, `lookup_invoice`, `list_transactions`)
aimed squarely at **Lightning** wallets, with budget controls and a defined error-code vocabulary.
This is entirely orthogonal to sidestr's own transaction-submission model (a plain kind-23500
signed-transaction event from a throwaway key, §3.2) and **nothing in the sidestr repos imports or
references NIP-47/NWC**. As a *plausible* future control plane (this report's own observation, not
a documented plan): a sidestr wallet could in principle expose a parallel NWC-shaped service
(`pay_invoice`→ build+publish a sidestr spend, `get_balance`→ `wallet.balance()`) so any existing
NWC-speaking app could drive a sidestr wallet without bespoke integration — but this would need new
methods beyond NIP-47's Lightning-specific vocabulary (no equivalent of "pay this Lightning
invoice" maps cleanly onto "build a sidestr UTXO spend" or "sign an EVM carrier"), and no such
extension is proposed anywhere in this clone.

---

## 9. Maturity and risk assessment

- **Licence**: `AGPL-3.0-or-later` on every repo (`spec`, `wallet`, `explorer`, `sidestr`) —
  confirmed from each `package.json`'s `license` field and `spec/LICENSE`'s header text. This is a
  strong copyleft licence; a Rust port that links or derives from this code (rather than a
  clean-room reimplementation from the spec prose alone) would need to consider AGPL's network-use
  clause.
- **Single-maintainer risk**: `git shortlog -sn --all` on the `spec` repo shows **one committer,
  "Melvin Carvalho"**, in the checked-out history (caveat: shallow clone, §0 above — the visible
  history is one commit per repo, so this cannot be generalised to "the project has ever only had
  one contributor," only that this snapshot shows no evidence of others). Corroborating
  circumstantial evidence: `melchain`'s own `comment` field says "Melvin's personal chain," and the
  spec's prose voice (terse, present-tense, heavily hedged with dates and provisos — "nothing here
  is final," "a test, not a federation," "one operator, one price") reads as a single author's
  working notes throughout SPEC.md and every proposal, not a committee-drafted specification.
- **Code size**: `siding/lib/*.mjs` + `siding/lib/overlays/*.mjs` together total **1,377 lines**
  (measured via `wc -l`) — this is the entire consensus-adjacent reference implementation (block
  building/signing, the sidestr overlay, federation/round logic, peg-in/out marker parsing, the
  three opt-in rule overlays, address/schnorr/relay/announce plumbing). This is genuinely small,
  which cuts both ways: easy to audit line-by-line, but also thin coverage for a system explicitly
  running with real (if valueless) pegged coins and a live 2-of-3 federation.
- **Tests present, no CI observed**: `siding/test/` has ten files (`announce-test.mjs`,
  `checkpoint-test.mjs`, `claims-test.mjs`, `evm-live.mjs`, `evm-test.mjs`, `evmrpc-test.mjs`,
  `federation-test.mjs`, `pegout-test.mjs`, `pledge-test.mjs`, `round-test.sh`, `rules-test.mjs`);
  `wallet/test/` has `evm-test.mjs`, `wallet-test.mjs` plus Solidity fixtures (`Faucet.sol/.bin`,
  `Token.sol/.bin`); `schema/test/` is far larger and vector-driven (BIP32/34/86/158/174/340/341
  test vectors, real mainnet/testnet4 headers, Knots-specific vectors, `script_tests.json` from
  Bitcoin Core). Several sidestr-level tests are **live-network integration tests, not pure unit
  tests** — `wallet-test.mjs` reads a real key off disk (`~/.sidestr/<name>.key`), builds a real
  transaction against a live mirror, and only *sends* it with an explicit `--send`/`--faucet` flag;
  it is designed to be run by hand against the live `txbt4-siding` deployment, not in an isolated
  CI sandbox. No CI workflow file was found under `siding/` or the wallet/explorer repos in this
  clone (the `schema` repo does have `.github/workflows/test.yml`, but that only covers the kernel,
  not sidestr's own overlay/federation/wallet code).
- **Runs against mainnet: no.** Every chain document pegs to `btc:testnet4-blake2b`; nothing in
  this clone references Bitcoin mainnet. The reference chain's own comment explains why: it exists
  because "the parent chain stalls at its 151,200 retarget until real hash arrives" (SPEC.md §10) —
  i.e. even the parent testnet4 itself is a low-hashrate, stall-prone chain that sidestr is partly
  a workaround for.
- **Dependency pins**: exact pins throughout — `@ethereumjs/{block,common,tx,util,vm}` all pinned
  to `10.1.3` (spec, siding, wallet), `@bitcoin-desktop/schema` pinned by **git commit hash**
  (`github:bitcoin-desktop/schema#v0.0.27` in `sidestr/package.json`'s dependency, and the wallet's
  CDN default resolves the same tag: `cdn.jsdelivr.net/gh/bitcoin-desktop/schema@v0.0.27`), and
  `sidestr`'s own dependency tree pins `@sidestr/spec`, `@sidestr/explorer`, `@sidestr/wallet` each
  to a **specific git commit SHA** rather than a tag or branch — an unusually tight, reproducible
  pinning discipline for a pre-0.0.1 project, consistent with a solo maintainer who controls every
  dependency in the graph and wants exact, bisectable builds.
- **Explicitly unfinished / paused items enumerated across this report**: the desk rule is fully
  built but **paused in production** pending an upstream parent-chain PR (§5.3); rule documents
  (kind 33500) and genesis documents (kind 33501) are specified in prose but have **no implementing
  code** found in this clone (§3.1); assets-between-chains (§5.2 draft) and ephemeral chains (§5.6)
  are **design notes with zero code**; level 2's "changing the signers" has no automated resharing
  path (§5.7); the EVM rule's receipts/logs have no persistence/snapshotting (§5.5); trust-minimised
  (non-custodial) peg-out is explicitly out of scope for the whole 0.0.1 line (§4.2).
- **Overall characterisation**: this is a **working, small, single-author reference implementation
  of a genuinely novel design** (signed sidechains with zero P2P layer, transported entirely over
  public Nostr relays, validated fully by every client including a browser tab), deployed live
  against a low-value testnet with real (if worthless) pegged coins, several named production
  chains already running distinct opt-in rule combinations, and a level-2 federation that has
  already been exercised through a live peg-out round with documented bugs found and fixed same-day.
  It is pre-alpha by any conventional software maturity scale (0.0.1, six days old at time of
  writing, explicit "nothing here is final"), but it is not vapourware — the code paths this report
  traced (block signing, claim/pairing validation, the constant-product pool, the EVM carrier rule,
  the level-2 round) are concrete, exercised, and specific enough (down to exact fee-rate bugs found
  in live testing) that a faithful port is a matter of careful translation, not guesswork.

---

## 10. Concrete facts a Rust port would need

1. **Header/serialization format is not stock Bitcoin** — the parent (and every sidestr chain
   layered on it) uses a **BLAKE2b-hashed, larger (164-byte / 328-hex-char) header** variant
   (`knots:blake2b-v2` per `overlay.mjs`'s `powHash`/`structVariants`), not Bitcoin's standard
   80-byte double-SHA256 header. A port must implement (or bind to) this specific header struct —
   `buildBlock()` in `block.mjs` shows its exact field set: `version, prevBlockHash, merkleRoot,
   timeOnWire, bits, nonce, nonce2, nonce3, extranonce (16 bytes), timeOffset, txCount, flags,
   xorKeyMaskClearBits, xorKey (16 bytes), height, mmRhs (32 bytes)` — considerably more fields
   than a standard Bitcoin header, evidently supporting merge-mining (`mmRhs`) and some
   XOR-obfuscation/extranonce scheme not explained in this clone's docs.
2. **Hashing**: `hash.sha256`, `hash.dsha256` (double-SHA256, standard Bitcoin), `hash.taggedHash`
   (BIP-340 tagged hashes: `"BIP0340/aux"`, `"BIP0340/nonce"`, `"BIP0340/challenge"`, `"TapLeaf"`,
   and the sidestr-specific `"sidestr/nums"` tag) — all standard BIP-340/341 tagged-hash
   constructions, no bespoke hash function for signing (the block PoW hash itself is BLAKE2b per
   the parent's overlay, a separate concern from the BIP-340 tagged hashes used for signature
   derivation).
3. **Signing**: pure **BIP-340 Schnorr** over secp256k1 (`schnorr.mjs`'s from-scratch
   implementation: standard deterministic-nonce-with-aux-randomness construction, `d, e, k`
   computed exactly per BIP-340 §Default Signing, negating `d`/`k` when the corresponding point's Y
   is odd). A Rust port should use `k256`/`secp256k1` + a maintained BIP-340 implementation rather
   than port this JS by hand (per the user's own crypto policy) — RustCrypto's `k256` crate or the
   `secp256k1` crate (bindings to libsecp256k1, which has a battle-tested BIP-340 module) are the
   natural choices; test against BIP-340's own published test vectors, which this JS file does
   **not** appear to embed (no BIP-340 vector file was found under `siding/test/`, though
   `schema/test/vectors/bip340.json` exists at the kernel level and should be reused).
4. **Address encoding**: standard **bech32 (BIP173) for v0, bech32m (BIP350) for v1+** —
   `address.mjs` is a clean, dependency-free reference implementation, directly portable to any
   Rust bech32 crate (`bech32` on crates.io implements both variants).
5. **Transaction/script model, sighash**: reused wholesale from `bitcoin-desktop/schema`'s kernel —
   standard Bitcoin transaction serialization plus the **unified sighash** (a Knots-specific
   post-fork sighash algorithm, `sighashUnified(tx, i, prevouts, hashType, 2)` — the literal `2`
   argument's meaning was not resolved in this pass and should be pinned down directly from
   `schema/codec/interpreter.js` before porting) for ordinary key-path spends, and the
   **BIP-325/signet virtual-transaction sighash** (`sighashTaproot` over a synthetic `to_spend`/
   `to_sign` pair, §2.3) for block/partial signatures. A port needs both sighash algorithms, not
   just standard BIP341 taproot sighash.
6. **Taproot tweaking**: BIP-341 tap-tweak (`secp.tapOutputKey`, `secp.checkTapTweak` — level-2
   internal-key/output-key derivation, §4.3) and the exact **NUMS constant**
   `50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0` (BIP-341's canonical
   unspendable point H) plus the chain-specific tweak-by-`taggedHash("sidestr/nums", chain_id)`
   construction — this exact derivation must be bit-for-bit reproduced for a port to compute the
   same challenge script as the reference implementation for any existing level-2 chain (e.g.
   `txbt4-fed`).
7. **OP_RETURN record encodings, byte-for-byte**, all trivially portable but each with exact
   length/format rules a port must not get wrong (would silently mismatch consensus with the JS
   reference): `pegin:<chain id>:<script>` (marker.mjs), `pegout:<parent script hex>` (chain side,
   overlay.mjs) / `pegout:<chain id>:<32-byte txid>` (parent side, parent.mjs) — **note these are
   two different formats depending on which side of the peg the OP_RETURN sits, sharing only the
   `pegout:` prefix**, `claim:<parent txid>:<vout>` (overlay.mjs), `ckpt:<chain id>:<4-byte-LE
   height>:<32-byte hash>` (checkpoint.mjs), `evmin:<20-byte address>` / `evm:<RLP bytes>` /
   `evmroot:<32 bytes>` (overlays/evm.mjs), `issue:<TICKER>:<decimals>` / `tally:<asset|self>:
   <vout>=<amount>[,...]` / `pool:<pool|self>:<vout>` (records.mjs) — plus the **minimal-push
   requirement** enforced by `records.mjs`'s `recordText()` (rejects a `OP_PUSHDATA1` push that
   could have been a direct push, i.e. non-minimal encodings are treated as absent/malformed, not
   merely non-canonical) and the coinbase-adjacency rule for claims (§4.1).
8. **The witness-commitment solution encoding**: the block signature is *not* a normal witness
   field but a **push appended after the standard BIP-141 witness-commitment output**
   (`6a24aa21a9ed<32-byte commitment>` + one push of `ecc7daa2` + the encoded witness stack), with
   the push encoded via **minimal pushdata** (direct push ≤75 bytes, else `OP_PUSHDATA1` ≤255,
   else `OP_PUSHDATA2` ≤65535) — `block.mjs`'s `withSolution`/`solutionOf` show the exact byte
   layout; a port's block (de)serializer needs this special-cased, since it lives inside a coinbase
   output script, not in the transaction's witness stack proper.
9. **EVM interop constants**: chain id per-document (`chain.evm.chainId`, e.g. `21474` for
   `txbt4-evm`), Cancun hardfork, fixed base fee = 1 gwei = 1 sat, no priority fee, `WITHDRAW`
   address `0x00000000000000000000000000000000000501de`, `1 sat = 1 gwei` exchange rate exactly. A
   Rust port would need a Rust EVM (e.g. `revm`) rather than `ethereumjs`, matched to the same
   Cancun ruleset and exactly reproducing gas accounting so state roots agree with existing chains
   byte-for-byte — this is the single highest-risk item for cross-implementation consensus, since
   any EVM semantic divergence (gas metering edge case, precompile behaviour, RLP edge case)
   between `ethereumjs` and `revm` would fork any chain a Rust node tried to validate alongside
   existing `ethereumjs`-based nodes.
10. **Nostr event id/signature**: exactly NIP-01's canonical JSON serialization
    (`[0,pubkey,created_at,kind,tags,content]`, sha256, BIP-340 sign over the id) — any conformant
    Rust Nostr crate (e.g. `nostr` on crates.io) already implements this; no bespoke behaviour to
    replicate beyond the specific kind numbers and tag shapes catalogued in §3.

---

## 11. Parent chain and header format — addendum (requested follow-up)

This section answers precisely: is a SHA-256d Bitcoin mainnet/testnet4 parent possible today, or is
the BLAKE2b fork family baked in? It separates two questions this clone conflates in casual prose
but keeps structurally distinct in code: **(A) what network `chain.parent` names** (a peg-mechanics
question) and **(B) what hash function the sidechain's own blocks use** (a question with, it turns
out, no dependency on (A) at all).

### 11.1 `btc:testnet4-blake2b` is a real, separate Bitcoin Knots hardfork — not sidestr's invention, not standard testnet4

`schema/schema/overlays/knots-blake2b.jsonld` (lines 108–139) defines it precisely:

> "Bitcoin Knots' BLAKE2b fork of testnet4: shares Core's testnet4 history through 150307, then v2
> headers and BLAKE2b proof of work from 150308 (2026-08-30). Keeps testnet4's 20-minute
> minimum-difficulty exception."

`@type: btc:NetworkParams`, `extends: "btc:testnet4"`, `powHash: "knots:blake2b-v2"`, `blake2bHeight:
150308`, `lastSharedBlock: {height: 150307, hash: "000000000017ec22…"}`,
`forkBlockHash: "000000000000b9d1…"`. A sibling `btc:mainnet-blake2b` (lines 143–166) does the same
to mainnet: shares real Bitcoin history through 961,631, "eight Knots-only SHA256d blocks
961632-961639," then BLAKE2b from 961,640 (2026-08-30), with a documented headline string
("8-30 NYPost Deride And Conquer") burned into the fork block's coinbase. The overlay's own
top-of-file comment names it explicitly: **"Bitcoin Knots BLAKE2b hardfork (v29.4.1.knots20260508,
PRs 357/359/385)... two chains forking from Bitcoin history."** This is modelled as a genuine,
named, contentious Bitcoin Knots hard-fork proposal — the schema repo is documenting/implementing
an actual (apparently real-world, dated) fork attempt, not fabricating a private testnet for
sidestr's convenience. Every `chain.json` in the sidestr spec repo pegs to the **testnet4** variant
of this fork specifically (`btc:testnet4-blake2b`), never the mainnet variant, and never unmodified
`btc:testnet4` or `btc:mainnet`.

**Why sidestr chose it** (SPEC.md §10, already noted in §4.4 of this report): "made because the
parent chain stalls at its 151,200 retarget until real hash arrives, and a chain beside it can keep
making blocks while it waits." This is a real design consequence of choosing a low-hashrate,
frequently-stalling fork of testnet4 as the demonstration parent — not an accident, but also not
evidence that BLAKE2b is required for sidestr's design to work.

### 11.2 The kernel already supports standard SHA-256d `btc:mainnet` / `btc:testnet4` — confirmed at the dispatch level

`schema/schema/chain.jsonld` defines ordinary `btc:mainnet` (line 202) and `btc:testnet4` (line 296)
`NetworkParams` entries with the standard Bitcoin constants (`magic: f9beb4d9`, `powLimit:
00000000ffff…`, `bip34Height`/`bip65Height`/`bip66Height`/`csvHeight`/`segwitHeight`,
`coinbaseMaturity: 100`, etc.) and — critically — **no `powHash` field at all**. The dispatch point
is `schema/codec/codec.js:325-327`:

```js
blockHash(header) {
  const name = this.chain?.powHash ?? 'sha256d';
  const fn = this.powHashes.get(name);
```

and the codec's constructor (`codec.js:92`) seeds `this.powHashes` with exactly one built-in entry:
`['sha256d', (bytes) => reverseHex(dsha256(bytes))]`. So **a network with no `powHash` field —
`btc:mainnet` and `btc:testnet4` both — hashes with plain double-SHA256 automatically**, and
`registerPowHash()` (codec.js:125) is a bare `Map.set`, purely additive. This means:
`pledge.mjs`'s `parentKernel()` (used only by the desk feature, §5.3) **always** installs the
`knotsBlake2b` overlay onto whatever network `chain.parent` names — but doing so is **harmless and
inert** for a plain `btc:mainnet`/`btc:testnet4` parent, because it only adds an unused
`'knots:blake2b-v2'` entry to the hash-function map; nothing calls it unless that network's own
`NetworkParams.powHash` field names it, which `btc:mainnet`/`btc:testnet4` do not. **The kernel
architecturally already supports a standard SHA-256d parent today, with zero code changes,** and
`parent.mjs`'s RPC layer (`getblockcount`, `getblock <hash> 2`, `gettxout`, `decodescript`,
`walletcreatefundedpsbt`/`walletprocesspsbt`/`combinepsbt`/`finalizepsbt`/`sendrawtransaction`,
`lockunspent`, `listtransactions`) is **generic Bitcoin Core JSON-RPC with no BLAKE2b-specific call
anywhere** — it would work unmodified against a real Bitcoin Core node on mainnet or standard
testnet4. `wallet.mjs:62`'s `parentExplorer()` similarly just regex-matches `/testnet4/` or
`/mainnet/` against the `chain.parent` string to pick a block-explorer base URL — parent-hash-scheme
agnostic (though note it points at **`mempool.guide`**, not `mempool.space`, which the task's
framing names as the estate's existing anchoring stack's target — a URL detail to reconcile, not a
blocker, if this wallet code were reused as-is).

**Conclusion on the parent side: naming a real SHA-256d `btc:mainnet` or `btc:testnet4` as
`chain.parent` is not blocked by anything in the schema/kernel or in `parent.mjs`/`pledge.mjs`.**
Nobody has done it in this clone (every shipped chain and every test fixture under
`siding/chains/*.json` — including the informal `sidetest1/2/3.json`, `aatest.json`,
`aastage.json` — names `btc:testnet4-blake2b`), so it is untested in practice, but there is no
structural obstacle visible in this codebase.

### 11.3 The sidechain's OWN header format is unconditionally BLAKE2b-v2 — and this is independent of `chain.parent`

This is the finding that actually matters and is easy to miss because it looks like a parent-chain
question but is not. `siding/lib/overlay.mjs`'s `sidestrGraph(chain)` (lines 41–64) builds the
**sidechain's own** `NetworkParams` entry — the one registered as `chain.id` (e.g.
`sidestr:txbt4-siding`), governing how *that chain's own blocks* are hashed and structured — and it
hard-codes, with no reference anywhere to `chain.parent`:

```js
powHash: 'knots:blake2b-v2',
structVariants: { 'btc:BlockHeader': [{ when: { field: 'version', bit: 31 }, struct: 'knots:BlockHeaderV2' }] },
blake2bHeight: 0, blake2bHeadline: '', unifiedSighashParam: 'blake2bHeight', rdtsExpiryTime: 0,
```

`blake2bHeight: 0` means **every block from the sidechain's own genesis** must be a v2 (164-byte)
header (`knots:rule-header-v2-from-fork` in `schema/codec/overlays/knots-blake2b.js:29`: `height <
params.blake2bHeight || isHeaderV2(header)` — with `blake2bHeight=0` this is unconditionally true
only when every header is v2). `siding/lib/block.mjs`'s `buildBlock()` (line 70) unconditionally
sets `header.version = 0xa0000000`, whose top bit (`0x80000000`, `VERSION_HEADER_V2_FLAG`) is set,
so every block this reference implementation ever produces is structurally a v2 header regardless
of any other configuration. There is **no field in `chain.json` that changes this** — `powHash`,
`structVariants`, `blake2bHeight` are not read from the chain document at all; they are literal
constants in `sidestrGraph()`. `engine.mjs` (siding's own kernel loader) and `explorer.mjs`'s
independent, duplicated copy of `loadEngine()` (line 33) both **unconditionally** `import` and
install `knotsBlake2b` for the sidechain's own kernel, for exactly this reason — the overlay has to
be present for `'knots:blake2b-v2'` to resolve as a registered pow-hash name at all.

**Does this hold even at `powLimit` (trivial difficulty)?** Yes, and this is worth being precise
about because it is easy to conflate "the PoW is nearly free to satisfy" with "the PoW mechanism is
irrelevant." `powLimit` only sets *how large a target* the block hash must be under
(`compactFromTarget(BigInt('0x' + chain.powLimit))` in `chain.mjs`) — i.e., how much nonce-grinding
work is needed to find a satisfying hash. It does not change *which function* computes that hash.
Every example chain uses `powLimit: 7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff`
(the maximum possible target short of unlimited), so in practice almost any nonce satisfies it
immediately — but the hash that gets compared against that target is still computed by the full
multi-stage BLAKE2b construction in `schema/codec/pow/knots-header-v2.js`
(`hashHeaderV2`/`hashHeaderV2Detailed`, lines 26–61): two BIP-340-style tagged-hash commitment
rounds (`"Bitcoin block header 1"`, `"Merge-mining hook"`) feeding a pure-JS BLAKE2b-256
implementation (`schema/codec/pow/blake2b.js`, RFC 7693, `blake2b_nokey` variant — a from-scratch
64-bit-pair-emulated implementation, not a binding to a C library), run **twice** (`b1`, then `b2`
over an ASIC-profile-dependent input layout selected by `header.flags & 3`), then XOR-masked. This
is a materially heavier, more elaborate hashing pipeline than Bitcoin's plain double-SHA256, and it
runs unconditionally on every sidestr block regardless of how trivial the target is.

**One more unconditional Knots-specific coupling worth flagging**: `unifiedSighashParam:
'blake2bHeight'` combined with `blake2bHeight: 0` also means every sidestr chain's *ordinary
transaction* signatures use the Knots "unified sighash" (the post-BLAKE2b-fork sighash algorithm,
`sighashUnified()` in the kernel) from genesis, not Bitcoin's standard BIP143/BIP341 sighash. This
is a second, separate Knots-specific consensus coupling in every sidestr chain's own transaction
validation, again with no `chain.json` field controlling it.

### 11.4 Direct answers to the questions asked

- **"Can a sidestr chain today have a SHA-256d Bitcoin mainnet/testnet4 parent, or is the fork
  family baked in?"** — For the **parent** (peg target): not baked in; `btc:mainnet`/`btc:testnet4`
  are already modelled with standard SHA-256d semantics and nothing in `parent.mjs`/`pledge.mjs`
  would need to change to peg against one (see §11.2). For the **sidechain's own blocks**: yes, the
  BLAKE2b-v2 header/hash **is baked in**, unconditionally, in `siding/lib/overlay.mjs`'s
  `sidestrGraph()` (duplicated in `explorer.mjs`) — with zero dependency on what `chain.parent`
  actually names. Nobody in this clone has run a sidestr chain with a standard-SHA256d parent, but
  that is orthogonal to the fact that every sidestr chain's *own* blocks would still be BLAKE2b-v2
  even if they did, under the code as it stands today.
- **"Does the sidechain's header need BLAKE2b PoW even at powLimit?"** — Yes. `powLimit` only
  relaxes the target the BLAKE2b hash must fall under; it does not substitute a different hash
  function. Every block still runs the full two-round tagged-hash-plus-BLAKE2b-256 pipeline
  described in §11.3, and every block's version field is hard-coded to set the v2-header flag.
- **"What would it take to run against SHA-256d Bitcoin?"** — Two independent pieces of work:
  1. **Peg to a real chain (small, config-only)**: publish a `chain.json` naming `parent:
     "btc:mainnet"` or `"btc:testnet4"`, point `parent.mjs`'s RPC/wallet config at a real Bitcoin
     Core node. Based on the code paths read for this report, no changes to `parent.mjs`,
     `pledge.mjs`, `marker.mjs`, or the peg-in/out record formats (§4) appear to be required — those
     are already parent-hash-agnostic. This is untested in this clone (no example does it) but
     structurally unblocked.
  2. **Make the sidechain's own blocks SHA-256d (small, but real code change)**: edit
     `siding/lib/overlay.mjs`'s `sidestrGraph()` to stop hard-coding `powHash:
     'knots:blake2b-v2'`/`structVariants`/`blake2bHeight`/`unifiedSighashParam`, i.e. omit those
     four keys so the sidechain's own `NetworkParams` entry falls back to the kernel's default
     (`sha256d`, standard 80-byte header, standard BIP341 taproot sighash rather than the unified
     one) — and make the identical edit to `explorer.mjs`'s duplicated `loadEngine()`, since it does
     not share code with `siding/lib/engine.mjs` and would silently keep forcing BLAKE2b for anyone
     reading the chain through the standalone explorer/wallet otherwise. `block.mjs`'s `buildBlock()`
     (`header.version = 0xa0000000`) and `sealBlock()`/`signBlock()`'s nonce-grinding loop
     (`k.codec.blockHash`) need no change themselves — they already just call through to whatever
     `codec.blockHash()` resolves to, so once the network's own `powHash` field stops naming
     `knots:blake2b-v2`, the same block-building code would naturally produce plain 80-byte,
     double-SHA256 headers instead. This is a small, well-isolated patch (four object keys in one
     ~120-line file, plus its duplicate in `explorer.mjs`), not a structural rewrite — but it is a
     genuine code change, not something achievable by writing a different `chain.json` today.
- **Relationship to the estate's own `gitmark` anchoring decision**: this report cannot confirm or
  rule out whether the sidestr repo's own `sidestr:gitmark` chain (`chains/gitmark/chain.json`,
  "a chain for blocktrails — git commits anchored... git-mark.com") is the *same* gitmark product
  referenced in the 2026-09-02 owner decision, or a same-named prototype/demo built by the sidestr
  spec's author independently. What this report **can** state from the code alone: as currently
  configured, `sidestr:gitmark` checkpoints into `btc:testnet4-blake2b` (the Knots BLAKE2b fork),
  **not** into standard Bitcoin testnet4 or mainnet — so if the estate's anchoring stack requires
  SHA-256d mainnet/testnet4 finality (per the 2026-09-02 decision), this specific sidestr chain, as
  shipped in this clone, does not currently provide that; it would need the parent-side reconfiguration
  in point 1 above (trivial) and, if the estate also wants the *sidechain's own* history to be
  SHA-256d for tooling/audit reasons, the small overlay patch in point 2 above.
