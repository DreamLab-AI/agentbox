# DDD-022: Sovereign Settlement Domain

**Date**: 2026-09-21
**Status**: Proposed
**Bounded Context**: Sovereign Settlement, the chains we sign ourselves, what they say a principal holds, and how value enters, moves and leaves them (**BC25**)
**Placement**: `docs/archive/ddd/` is the frozen pre-consolidation corpus and is not authority; the DDD series is continued here beside the living scope documents, following the DDD-021 precedent. The compliance surfaces this domain answers to are [`docs/GOVERNANCE-capabilities.md`](../GOVERNANCE-capabilities.md) (the spend gate) and [`docs/INGRESS-identity.md`](../INGRESS-identity.md) (the identity chain); the product case is [PRD-024](./sovereign-settlement.md).
**Cross-references**: [PRD-024](./sovereign-settlement.md) (the product case this domain models), [ADR-2096](../adr/) (sidestr chains as the sole value instrument), [ADR-2097](../adr/) (the chain is truth, ledgers become views), [ADR-2098](../adr/) (federation topology, key separation, and the configured parent and header families of D6), [ADR-2099](../adr/) (bridge-in of RGB assets, including USDT-on-RGB), [ADR-2100](../adr/) (the ADR-124 P21 gate made real, on-seal currency pin), [ADR-2101](../adr/) (Nostr kinds and the settlement relay plane). ADR numbers are placeholders to be assigned by the coordinator. Amends or supersedes: [ADR-032](../archive/adr/ADR-032-402-scheme-grammar.md) (a `sidestr` scheme is an ADR-032 revision plus fixtures), PRD-015 C10 (Lightning-first, dropped), ADR-124 / ADR-128 in the host repo (the RGB rung is re-sequenced, not silently overridden). Consumes: [DDD-003](../archive/ddd/DDD-003-sovereign-messaging-domain.md) (identity and relay), [DDD-006](../archive/ddd/DDD-006-llm-marketplace-domain.md) (the barter economy this must not become a third parallel to), [DDD-019](../archive/ddd/DDD-019-interaction-plane-domain.md) (sessions, which is what a child chain is scoped to), [DDD-020](../archive/ddd/DDD-020-semantic-integrity-provenance-domain.md) (provenance and the anchor vocabulary), [DDD-021](./sovereign-system-one-domain.md) (the façade and published-client patterns reused here).

---

## TL;DR for newcomers

*Skip if you already know that we sign our own Bitcoin-family sidechains, that a balance is
just the unspent outputs keyed by a pubkey on one of them, and that every other ledger in the
estate is about to become a cached view of that.*

This bounded context owns **settlement**: the existence and rules of the chains DreamLab
signs, the movement of value into them (peg-in, bridge-in), within them (ordinary spends),
and out of them (peg-out, child-chain close), and the receipts that prove any of it
happened. The aggregate root of chain identity is the `ChainDocument`. There is one
long-lived root chain that carries principals and bridged assets, and a population of
short-lived child chains that agents, sessions and jobs open, use and close.

The domain does **not** own identity (DDD-003 mints the `did:nostr`), does not own the
governance decision that releases a spend (GOVERNANCE-capabilities owns the 31402/31403
round trip), does not own the parent chain, and does not own RGB's contract semantics. It
consumes all four.

**If you remember only one thing:** the chain is truth. A balance shown anywhere in the
estate, including the pod WebLedger, VisionClaw's file ledger and the worker's D1 table, is
a **view**, and a view is never a thing you can spend from. Every one of those three
ledgers becomes a read-through projection of the UTXO set, or it stops being consulted.

For the deep version, keep reading.

---

## Domain Purpose

The truth this domain owns is **what a principal holds, and by what authority it moved**.

Today the estate cannot answer that question once. It answers it three times, in three
places that do not talk to each other: solid-pod-rs's `WebLedger` persisted at
`/.well-known/webledgers/state.json` (`payments.rs:102-176`, `pay.rs:128-291`), VisionClaw's
`FsPaymentStore` flat file (`pay_handler.rs:198-403`, whose `.deposit` route is a 501 stub,
so nothing can legitimately enter it at all), and nostr-bbs-pod-worker's D1 table
(`payments.rs:183`). All three are keyed on `did:nostr:<hex>`. None of them is authoritative
over the others, and none of them is anchored to anything. A number in a database that
nobody else agrees with is not a balance; it is a claim.

A sidestr chain replaces the claim with a record. Value exists on it because it was pegged
in from a parent chain or bridged in from an origin contract, it is held at a taproot output
whose key is a principal's own key, and it moves only because that principal signed. Every
node that cares replays every block through the same kernel, so a balance is not asserted by
a server, it is **recomputed by anyone**. That is the whole reason to do this.

Three things make it a domain rather than a client library.

First, **supply integrity**. A sidechain has no subsidy and no mint. Every coin traces to a
peg, every wrapped asset traces to a bridge claim, and the arithmetic that keeps those two
statements true is the only thing standing between us and a system that invents money. It
has to be stated as law and tested as law, not inherited as an implementation detail of
somebody else's JavaScript.

Second, **custody is a declared fact, not a feeling**. Level 1 means one key both seals
blocks and holds the peg: a custodian, whatever the prose says. Level 2 means k of n, which
is a better custodian, not the absence of one. Upstream's design goes further and derives
both roles from the same key set (`federation.mjs`'s `pegDescriptor()` builds the peg wallet
descriptor from the same challenge derivation that authorises block production), so k
colluding signers get block production and peg theft in one move. This domain models the
trust level as a per-chain value carried on the chain document, refuses to let a chain
holding several principals' value sit at level 1, and separates the key roles that upstream
merges.

Third, **the regulatory boundary is architectural**. ADR-124 §7 is explicit that removing
custody removes no UK obligation at any trust level, and that the only real containment is
the testnet, no-cash-out corner. That containment has been a documented plan with no code
behind it (the P21 exit criterion). Putting real value on a chain makes it code. The
currency pin and the cash-out disablement become **on-seal immutable commitments carried by
the chain document itself**, so a testnet chain cannot quietly become a mainnet one.

Nothing here owns the model of identity, the consumer's fail-open behaviour, the parent
chain's consensus, RGB's contract semantics, or the decision to release a spend. It owns the
chains, the pegs, the bridges, the closes, the authorisations that bind a spend to a decision,
and the receipts.

---

## Bounded Context Definition

**Boundary**: from a signed `ChainDocument` at one end to a `SettlementReceipt` at the
other, including everything that changes what a principal holds on a chain we sign.

**Owns** (IN):

- The `ChainDocument` aggregate: a chain's identity, parent, challenge, rules, trust level,
  signer set, currency pin and cash-out posture. Its lifecycle from proposal to sealed
  genesis to close.
- The `PegIn` and `PegOut` lifecycles, including the claim-adjacency pairing that binds a
  claimed amount to exactly one parent outpoint, and the refund path that makes a dead chain
  cost time rather than coins.
- The `BridgeClaim` aggregate: an external asset (RGB20, including USDT-on-RGB, or a Taproot
  Asset) arriving as a wrapped asset on one of our chains, and the reserve accounting that
  keeps wrapped supply equal to held origin supply.
- The `ChildChain` aggregate and its `Close`: an ephemeral chain bound to an agent, a
  session or a job, and the pro-rata closing settlement plus tombstone that ends it.
- The `SpendAuthorisation` aggregate: the binding between a spend above a threshold and the
  signed ACSP kind-31403 approval of the kind-31402 request that released it.
- The `SettlementReceipt`: the durable, URN-identified, hash-chained record that a
  settlement occurred, minted through `management-api/lib/uris.js`.
- `BalanceView` as a **derived, explicitly non-authoritative** projection, and the rule that
  makes it so.
- The anti-corruption boundaries against the sidestr wire protocol, the rgb-lib bridge and
  the three legacy ledgers (below).

**Does not own** (OUT):

- **Identity.** `did:nostr` minting, key persistence and the identity chain belong to
  DDD-003 and `docs/INGRESS-identity.md`. This domain consumes a pubkey and never mints one.
  That a Nostr key is simultaneously a chain address is a *fact we consume*, not a design we
  own.
- **The governance decision.** Whether an agent may spend is
  `docs/GOVERNANCE-capabilities.md` and `management-api/lib/authority.js`. This domain owns
  the *binding* of a decision to a spend, not the decision.
- **The parent chain.** Bitcoin's consensus, its blocks, its fee market. We read a parent
  view; we never reason about how it reached agreement.
- **RGB contract semantics.** Schemas, state transitions, consignment validation and AluVM
  stay entirely inside rgb-lib behind the bridge. We never re-implement client-side
  validation, and no RGB type crosses the bridge boundary into our model.
- **The barter economy** (DDD-006, kinds 38300-38305). LLM marketplace grants are a separate
  value system. PRD-024 must say which of the two survives; this domain does not absorb it
  by default.
- **Provenance anchoring** (DDD-020, ADR-059 blocktrails). `sidestr:gitmark` is ours, and it
  exists precisely to carry anchors, but commit anchoring is not settlement: this domain owns
  the chain it runs on, not what it anchors. The neighbouring context owns the trail.
- **Session lifecycle** (DDD-019). A child chain is *bound to* a `ManagedSession`; it does
  not manage one.
- **Pricing and the 402 grammar's shape.** ADR-032 owns the scheme grammar; we supply one
  new scheme's semantics and its fixtures.

**Consumes**:

| Consumed | From | What exactly |
|---|---|---|
| `did:nostr` identity | DDD-003, `management-api/lib/agent-identity.js` | The x-only BIP-340 pubkey that is simultaneously a chain address. The nsec never enters this domain. |
| URN minting | `management-api/lib/uris.js` | Every durable identifier, per ADR-013. |
| The release decision | `docs/GOVERNANCE-capabilities.md`, `lib/authority.js` | kind-31402 request, kind-31403 signed approval, and the `payment_settlement` zero-tolerance class. |
| The events chain | ADR-005 events slot (`adapters/events/local-jsonl.js`) | Hash-chained append for every settlement event, verified at `/v1/system/audit-chain`. |
| The relay plane | DDD-003, ADR-2012 allowlist | Publication and subscription for chain traffic. |
| Memory | DDD-016 | Operational state only. Never a balance. |
| The parent view | A node for the configured `ParentRef` (default `btc:testnet4-blake2b`, D6) | Headers and peg outputs, for level-2 claim verification. |
| RGB state | rgb-lib, inside the bridge service only | Consignments, validated there, never here. |

---

## Ubiquitous Language

| Term | Definition |
|---|---|
| **Chain** | A Bitcoin-family sidechain whose only network is Nostr: signed blocks, no subsidy, every coin pegged, rules as signed documents. Ours are the instrument; nothing else in the estate is. |
| **ChainDocument** | The signed document that *is* a chain's identity and rules: `id`, `parent`, `challenge`, `powLimit`, `addressPrefix`, `magic`, `pegConfirmations`, `refundBlocks`, `pegoutBlocks`, `pegoutMin`, `minFeeRate`, `genesisHash`, `signer` or `signers` plus `threshold`, `rules[]`, and our own additions (`trustLevel`, `currencyPin`, `cashOut`, `p21ReceiptUrn`, `closePolicy`). The aggregate root of chain identity. |
| **Root chain** | The one long-lived DreamLab chain (level 2, k-of-n, one signer key per federated instance) that carries principals and bridged assets. Sole parent of every child chain. |
| **Child chain** | An ephemeral chain nested off the root, opened for one agent, session or job, carrying a `Close`, and settled back to the root when it closes. The upstream `ephemeral` note is a design sketch with no code; we specify it. |
| **Signer** | A key authorised by the chain document to seal blocks. Ordering authority only. Distinct, in our model, from the peg custodian and from any principal's spending key. |
| **Federation** | The signer set of a chain plus its threshold. "We are our own federation" is a statement about who the custodian is, not a claim that there is none. |
| **TrustLevel** | Declared per chain: L1 (one signer, validators trust it for pegs), L2 (k-of-n with a parent view), L3 (rotation and recovery, not built upstream). Mapped onto the ADR-124 L0-L3 ladder by PRD-024, and carried on-seal. |
| **PegIn** | Value entering a chain from its parent: a parent taproot output whose key path is the peg holders and whose script path is the pegger's timelocked refund, marked `pegin:<chain>:<script>`, claimed after `pegConfirmations` by a coinbase payout paired with an adjacent `claim:<txid>:<vout>`. |
| **Claim** | The coinbase act that turns a confirmed peg output into spendable coins on the chain, binding exactly one parent outpoint, exactly once. |
| **Refund path** | `and_v(v:pk(refund), older(refundBlocks))` on the peg output: the pegger's unilateral, signer-independent recovery. The reason a dead chain costs time, not coins. |
| **PegOut** | Value leaving a chain: a `Burn` on the chain, then a payment on the parent. At L1 this is the federation's promise; at L2 it is a PSBT co-signing round in which each signer independently re-derives the expected outputs before signing. |
| **Burn** | The chain-side `OP_RETURN pegout:<parent script hex>` output of at least `pegoutMin`, which destroys chain value in exchange for the promise of a parent payment. |
| **Marker record** | The `OP_RETURN` payloads that carry protocol meaning: `pegin:`, `claim:`, `pegout:`, `ckpt:`, `issue:`, `tally:`, `pool:`. Ours adds `bridge:` (see `BridgeClaim`). All are consensus-visible bytes, not metadata. |
| **Bridge claim** | The arrival of an external asset as a wrapped asset on one of our chains: an origin-side consignment is validated and held by the bridge, and a wrapped asset is claimed on-chain against it. The RGB integration is this and nothing more. |
| **Wrapped asset** | A chain-native asset whose supply is backed one-for-one by origin-side reserve, identified as `<origin chain id>:<origin asset id>`, generalising upstream's reserved, unbuilt "assets between chains" shape to an RGB origin. |
| **AssetId** | A chain-native asset identifier: the issuing transaction's txid for a locally issued asset, or the origin pair for a wrapped one. |
| **Tip** | A chain's current height and recent headers, announced as an addressable kind-33333 event with `d` = chain id. The liveness signal, never a source of state. |
| **Mirror** | An HTTP server offering block files. Convenience only: never trusted for correctness, cross-checked against the signer's own tip announcement, and every block replayed locally. |
| **Rule document** | A signed document with an activation height that adds or changes a chain's opt-in rules. Users adopt rules; signers order transactions. Specified upstream (kind 33500), unimplemented upstream. |
| **Close** | A child chain's terminal act: stop accepting blocks at a height or time, pay every holder pro rata in one closing coinbase, peg out the whole peg in the same proportions, and checkpoint the closing hash into the parent as a tombstone. |
| **Tombstone** | The parent-anchored commitment to a closed chain's final state, so a later dispute is settleable from any retained copy after every mirror is gone. |
| **SpendAuthorisation** | The binding of a spend to the signed kind-31403 approval of the kind-31402 request that released it. Above the policy threshold, a spend without one is not a spend, it is an attempt. |
| **SettlementReceipt** | The durable record that settlement occurred: URN-identified through `uris.js`, appended to the hash-chained events log, and resolvable. Successor to the x402-era receipt for chain settlement. |
| **BalanceView** | A projection of the UTXO set keyed by a pubkey into a legacy ledger's shape. Read-through, cacheable, timestamped with the height it was computed at, and never authoritative (I05). |
| **Spend authorisation threshold** | The configured value above which a `SpendAuthorisation` is mandatory. Below it, policy caps alone apply (`spend-policy.js`). |
| **P21 gate receipt** | The owner-plus-legal build-time sign-off that ADR-124 names as the exit criterion for leaving the testnet corner. In this domain it is a concrete artefact with a URN, cited by any mainnet chain document. |
| **Currency pin** | The on-seal immutable declaration of which currency a chain settles in (`tbtc4` or `btc`). Not runtime configuration: changing it means a new chain. |
| **Parent family** | The consensus family of the network a chain pegs to (`btc-sha256d`, `btc-knots-blake2b`, or another the codec supports). Configured in `agentbox.toml [sidechain]`, defaulted to upstream's, sealed into the chain document (D6, I23). |
| **Header family** | The format and proof-of-work hash of a chain's **own** headers, which is a separate fact from its parent family and is never derived from it (I24). Default `knots:blake2b-v2`, following upstream. |
| **Consignment** | RGB's own transfer artefact. Named here only so we can say it stops at the bridge and never enters this model. |

---

## Aggregates

### ChainDocument (Root)

The consistency boundary of chain identity. Everything a validator needs to decide whether a
block belongs to this chain is inside it, and nothing that changes per block is.

**Identity**: `urn:agentbox:chain:<scope>:<sha256-12>`, minted through `uris.js` against a
new `chain` kind, owner-scoped and content-addressed over the sealed document. This follows
the `knowledge` kind precedent (`uris.js:91-94`), where the content-hash segment is
deliberately shared with a non-agentbox identifier so that one thing does not acquire two
unrelated ids: the chain's own `sidestr:<name>` id is carried as a bound foreign identifier,
not as a competing identity. Adding one kind rather than four (`wallet`, `asset`, `ledger`,
`chain`) is deliberate: a wallet is a key that DDD-003 already identifies, an asset is
identified by its issuing txid, and a ledger is a view.

**Fields** (upstream fields plus ours, marked):

| Field | Type | Notes |
|---|---|---|
| `id` | `sidestr:<name>` | The foreign identifier, the Nostr `d` tag on tip, rule and genesis events. |
| `urn` | `urn:agentbox:chain:…` | Our canonical identity (I07). |
| `parent` | `ParentRef` | Configured, not hard-coded (D6). Defaults to upstream's `btc:testnet4-blake2b`. A child chain's parent is the root chain's `id`. Immutable on seal (I23). |
| **`headerFamily`** | `HeaderFamily` | **Ours, explicit.** The chain's own header and PoW family, default `knots:blake2b-v2` following upstream. Immutable on seal (I23). |
| `challenge` | script hex | L1: `5120<signer pubkey>`. L2: `5120<tweaked output key>` over a NUMS internal key tweaked by the chain id, with a `multi_a(k, ...)` leaf. |
| `signers` / `threshold` | `[x-only pubkey]`, `k` | One key per federated instance for the root chain (D2). |
| `pegConfirmations`, `refundBlocks`, `pegoutBlocks`, `pegoutMin`, `minFeeRate` | ints | Peg policy. |
| `rules[]` | names | Opt-in rules. `evm` is prohibited (I10). |
| `genesisHash` | hash | The genesis block the document commits to. |
| **`trustLevel`** | `L1 \| L2 \| L3` | **Ours.** Declared, not inferred (I09). |
| **`currencyPin`** | `tbtc4 \| btc` | **Ours.** On-seal immutable (I13). |
| **`cashOut`** | `disabled \| enabled` | **Ours.** On-seal immutable. `enabled` requires `p21ReceiptUrn`. |
| **`p21ReceiptUrn`** | `urn:agentbox:receipt:…` or null | **Ours.** The owner-plus-legal gate artefact (I04). |
| **`closePolicy`** | `{height} \| {time} \| null` | **Ours.** Non-null makes this a `ChildChain`. |
| **`boundTo`** | URN or null | **Ours.** The session, agent or job URN a child chain settles for. |

**Lifecycle**:

```
Drafted -> Sealed -> Live -> Closing -> Closed
              |                            |
              +--> Abandoned (never        +--> Tombstoned
                   sealed; peg refunded
                   via the refund path)

Drafted   : document composed, signer set agreed, not yet sealed
Sealed    : genesis sealed by the signer set; genesisHash fixed; currencyPin and cashOut immutable from here
Live      : producing blocks; pegs claimable; spends settle
Closing   : closePolicy reached; no new blocks accepted past the boundary
Closed    : closing coinbase paid pro rata; whole peg paid out in the same proportions
Tombstoned: closing hash checkpointed into the parent
```

A root chain has no `closePolicy` and therefore no path past `Live`. Retiring one is a
migration, not a close, and is out of scope for this document.

### PegIn

**Consistency boundary**: one parent outpoint and its claim. Referenced by, not contained
in, the `ChainDocument`.

States: `Marked` (parent transaction broadcast with a `pegin:` marker), `Confirming`
(fewer than `pegConfirmations`), `Claimable`, `Claimed` (a coinbase payout with an adjacent
`claim:` marker), `Refunded` (the timelock expired and the pegger took the script path).
`Claimed` and `Refunded` are terminal and mutually exclusive.

The claim-adjacency rule is the aggregate's whole point: a claim at coinbase output *i*
must have its payout immediately before it, so a validator with no parent view still binds
each claimed amount to exactly one outpoint. That structure, not trust, is what stops a
signer minting. At L2 it is additionally checked against a real parent view before a block
is signed.

### PegOut

**Consistency boundary**: one burn and its parent payment.

States: `Burned` (chain-side `OP_RETURN pegout:<parent script>` at or above `pegoutMin`),
`Payable` (within `pegoutBlocks`), `Paid` (parent payment carrying `pegout:<chain>:<txid>`),
`Defaulted` (the window passed unpaid).

`Defaulted` is a first-class state and must be, because at L1 nothing on-chain compels the
payment. Upstream models this as producer bookkeeping in a `pegouts.json` the wallet simply
trusts. We model it as a domain event with a receipt, so a default is an **observable fact
with an audit record**, not a missing file. At L2 the PSBT round applies, and each signer
re-derives the expected outputs rather than blind-signing.

### BridgeClaim

**Consistency boundary**: one origin-side reserve position and the wrapped supply issued
against it.

States: `ConsignmentReceived` (an RGB consignment arrives at the bridge), `Validated`
(rgb-lib accepts it and the reserve UTXO is confirmed held), `Claimed` (a `bridge:` marker
record on our chain issues or increases wrapped supply for `<origin chain id>:<origin asset
id>`), `Redeeming`, `Redeemed` (wrapped supply burned on our chain, origin asset transferred
out by the bridge), `Rejected`.

This is the RGB integration in full. The bridge is an **RGB-aware peg holder**: it receives
and validates a consignment with rgb-lib, holds the origin asset, and claims a wrapped asset
on our chain. No RGB type, no AluVM, no consignment and no client-side validation crosses
into this model. The wrapped asset is an ordinary chain asset under the `assets` rule, which
is consensus-validated by every node, which is the *opposite* model to RGB. That opposition
is intentional and is exactly why the bridge exists: it is the seam between a client-side
validated world and a chain-validated one, and a seam is a service, not a merger.

Redemption is modelled from the outset even though it will ship after issuance, because an
asset that can enter and cannot leave is a trap, and a domain that does not name the exit
will grow one ad hoc.

### ChildChain and Close

`ChildChain` is a `ChainDocument` with a non-null `closePolicy` and a non-null `boundTo`,
parented by the root chain. It is the agent-economics primitive: an agent, a session or a
job opens one in seconds, transacts inside it at no meaningful cost, and settles back.

`Close` is the terminal sub-aggregate: the closing block's coinbase pays every holder pro
rata with no fee, the whole peg is paid out on the parent in the same proportions, and the
closing hash is checkpointed as a tombstone. Pro rata is exact integer arithmetic with any
rounding remainder credited to the peg rather than to a holder, because rounding that can be
farmed is a mint by another name.

Nothing upstream implements this. The `ephemeral` proposal is a design note. That makes
`Close` the single largest piece of original modelling in this domain, and the one most in
need of its own test corpus before it holds anything.

### SpendAuthorisation

**Consistency boundary**: one spend above the threshold and the decision that released it.

Fields: the spending principal's pubkey, the chain URN, the amount and asset, the kind-31402
request event id, the kind-31403 approval event id, the approver's pubkey, the expiry, and
the resulting transaction id once settled.

The estate already classifies `payment_settlement` as a zero-tolerance authority class, and
`routes/payments.js` has never called `lib/authority.js`: only broker-bridge and
llm-marketplace do. The declared class has therefore been enforcing nothing on the payment
path. This aggregate is where that stops being true. A `SpendAuthorisation` is created
before a spend, cited by the transaction that settles it, and carried into the receipt.

Colloquy's authorising-principals model is the right shape for the approver side, and PRD-024
should decide whether to reuse it: an operator's fifty agents are one voice, and an
unregistered pubkey is dropped rather than self-authorising. That is precisely the property a
spend gate needs, and it already exists as a published crate.

### SettlementReceipt

**Consistency boundary**: one settlement fact.

Minted through `uris.js` against the existing `receipt` kind (no new kind needed), appended
to the hash-chained events log, and resolvable best-effort at `/v1/uri/<urn>`. It cites the
chain URN, the transaction id, the amount and asset, the counterparties' pubkeys, the
`SpendAuthorisation` URN where one was required, and the height at which it became final.

BC20's existing split applies unchanged: `receipt` deliberately stays agentbox-local and
does not cross the federation boundary, while `activity` and `bead` do. PRD-024 must make
the same call explicitly for settlement receipts rather than inherit it by accident, because
a settlement that crosses instances but whose proof does not is a support ticket waiting to
happen.

---

## Value Objects

| Value object | Shape | Rules |
|---|---|---|
| `ChainId` | `sidestr:<name>`, lowercase, no colons in `<name>` | Immutable. The Nostr `d` tag. Bound to exactly one `urn:agentbox:chain:…`. |
| `ParentRef` | `{networkFamily, network}`, or a `ChainId` | `networkFamily` is the parent's consensus family (`btc-sha256d`, `btc-knots-blake2b`, or another the codec supports); `network` is `mainnet`, `testnet4` or equivalent. A `ParentRef` that is a `ChainId` means the chain is nested, and it then inherits nothing: its own `headerFamily` is still declared. A `mainnet` network requires I04. Immutable on seal (I23). |
| `HeaderFamily` | `{powHash, headerLayout, headerBytes}` | The chain's *own* header format, independent of its parent's. Default `{powHash: knots:blake2b-v2, headerBytes: 164}` following upstream. Carrying it explicitly is what stops the codec inferring one format from the other, which is the mistake upstream's engine makes by loading the BLAKE2b overlay unconditionally regardless of parent. |
| `PowHash` | an identifier such as `sha256d` or `knots:blake2b-v2` | Names the hash a header is proved against. Never inferred from `ParentRef`. |
| `Challenge` | script hex plus its derivation | L1 key path, or L2 NUMS-internal-key-plus-`multi_a(k,n)` leaf. Carries the derivation, not just the bytes, so a validator can re-derive rather than trust. |
| `TrustLevel` | `L1 \| L2 \| L3` | Declared on-seal. Maps to the ADR-124 ladder. Monotonic: a chain may not be re-declared downward. |
| `OutPoint` | `{txid, vout}` | Parent-side for pegs, chain-side for spends. Equality is structural. |
| `Amount` | unsigned integer, sats | Integer only. No floating point anywhere in this domain, ever. |
| `AssetId` | txid (local issue) \| `<origin chain id>:<origin asset id>` (wrapped) | The two forms are distinguishable by shape and must never be conflated in a balance. |
| `WrappedAssetId` | the second form above | Carries its origin. A wrapped asset that has lost its origin is not fungible with anything. |
| `MarkerRecord` | `{kind, payload}` over `OP_RETURN` bytes | Kinds: `pegin`, `claim`, `pegout`, `ckpt`, `issue`, `tally`, `pool`, `bridge`. Parsed, never guessed: a malformed marker invalidates its block. |
| `Level` | see `TrustLevel` | Retained as upstream's word in wire-facing code only. |
| `Height` | unsigned integer | Chain-relative. A height without its chain is meaningless and must not be passed alone. |
| `CurrencyPin` | `tbtc4 \| btc` | On-seal immutable (I13). |
| `CashOutPosture` | `disabled \| enabled` | On-seal immutable. `enabled` implies a `p21ReceiptUrn`. |
| `ReserveRef` | `{origin, outpoint, assetId, amount}` | The bridge's held position backing wrapped supply. |
| `ProRataShare` | `{pubkey, numerator, denominator}` | Exact integer arithmetic. Remainder to the peg. |

---

## Domain Events

Each event names the carrier that makes it durable. Three sinks, one lifecycle, matching the
DDD-019 pattern: the chain itself is the consensus record, the hash-chained events log is the
tamper-evident audit record, and a Nostr kind is the federated announcement.

| Event | Trigger | Carrier |
|---|---|---|
| `ChainProposed` | A chain document is drafted and circulated to the signer set | Internal only; hash-chained events log |
| `ChainSealed` | Genesis sealed; `currencyPin` and `cashOut` become immutable | Genesis document, upstream **kind 33501**, `d` = chain id; events log; `SettlementReceipt` |
| `RuleActivated` | A rule document reaches its activation height | Upstream **kind 33500**, `d` = `<chain id>:<height>`; events log. Specified upstream, unimplemented upstream: we implement it. |
| `TipAnnounced` | Producer announces height and recent headers | Upstream **kind 33333**, `d` = chain id, `t` = `sidestr`, `u` = mirrors. Liveness only, never state. |
| `TransactionSubmitted` | A wallet submits a spend | Upstream **kind 23500**, signed with a throwaway key so a spend never links to a persistent identity |
| `BlockSealed` | A block is signed (L1) or a round completes (L2) | Upstream **kinds 23510/23511/23514**; events log |
| `PegInMarked` | Parent transaction with a `pegin:` marker broadcast | Parent chain; events log |
| `PegInClaimed` | Coinbase payout plus adjacent `claim:` marker | The chain; events log; `SettlementReceipt` |
| `PegInRefunded` | Refund script path spent after `refundBlocks` | Parent chain; events log |
| `PegOutBurned` | Chain-side burn at or above `pegoutMin` | The chain; events log |
| `PegOutPaid` | Parent payment with the `pegout:` marker | Parent chain; events log; `SettlementReceipt` |
| `PegOutDefaulted` | `pegoutBlocks` elapsed unpaid | Events log; **new kind (38420)**; alert. Our addition: upstream has no such fact. |
| `BridgeClaimValidated` | rgb-lib accepts a consignment and the reserve is confirmed | Bridge-internal; events log |
| `WrappedAssetClaimed` | `bridge:` marker issues or increases wrapped supply | The chain; events log; `SettlementReceipt` |
| `WrappedAssetRedeemed` | Wrapped supply burned and origin asset released | The chain plus origin; events log; `SettlementReceipt` |
| `ChildChainOpened` | A child chain is sealed and bound to a session, agent or job | **New kind (38421)**; events log; bound session's `LedgerEpic` |
| `ChildChainClosing` | `closePolicy` boundary reached | **New kind (38422)**; events log |
| `ChildChainClosed` | Pro-rata closing coinbase paid; peg paid out in proportion | The chain; events log; `SettlementReceipt` per holder |
| `ChainTombstoned` | Closing hash checkpointed into the parent | Parent `ckpt:` record; **new kind (38423)**; events log |
| `SpendAuthorisationRequested` | A spend above the threshold is attempted | **kind 31402** (ACSP ActionRequest) |
| `SpendAuthorisationGranted` | A human approves | **kind 31403** (signed approval) |
| `SpendAuthorisationDenied` / `Expired` | Denied or lapsed | Events log, `authority.deny` journal |
| `SettlementRecorded` | Any settlement finalises | `SettlementReceipt` URN; events log; **new kind (38424)** if PRD-024 decides receipts federate |
| `BalanceViewRefreshed` | A legacy view recomputes from the chain | Internal only. Deliberately **not** federated: a view is not news. |

**Kind allocation.** Upstream's kinds (23500, 23501, 23510-23514, 33333, 33500, 33501,
33502) are a third party's published language, consumed and published as-is. Our own events
take 38420-38425 from the free part of agentbox's owned 38000-38201 block, following the
ADR-2085 precedent of allocating inside the block this repo already owns. Two upstream
hazards are ACL concerns, not ours to fix: kind 33502 is documented as a peg record and used
in code as a desk pledge, distinguished only by `d`-tag shape, so our parser must
disambiguate structurally rather than by kind; and ephemeral kinds are not filterable by the
`chain` tag at the relay, so a producer downloads every sidestr chain's traffic of that kind
and discards the rest, which is a real scaling constraint on a shared public relay and an
argument for our own relay in the settlement plane.

---

## Invariants

Domain law. Each is stated so it can be failed by a test.

- **I01 Supply equals pegs.** For any chain, at any height, total spendable sats equals the
  sum of claimed peg-ins minus the sum of burns. There is no subsidy and no mint. A block
  whose coinbase exceeds fees plus paid claims is invalid.
- **I02 A claim spends exactly one peg outpoint, exactly once.** Each `claim:<txid>:<vout>`
  marker must be immediately preceded in the coinbase by its payout, and the same outpoint
  may not be claimed at two heights. At L2 the outpoint must additionally verify against a
  real parent view, and a claim that cannot be verified is refused rather than assumed.
- **I03 A close pays every holder pro rata.** A closed child chain's closing coinbase
  distributes the entire balance to holders in exact proportion, with the rounding remainder
  credited to the peg, and the parent peg-out mirrors those proportions. A close that leaves
  a holder unpaid, or that lets a remainder accrue to a participant, is invalid.
- **I04 No mainnet chain without a P21 gate receipt.** A `ChainDocument` with
  `parent: btc:mainnet` or `currencyPin: btc` or `cashOut: enabled` must cite a resolvable
  `p21ReceiptUrn` recording owner and legal sign-off. Absent it, sealing is refused at
  build time, not warned about at runtime.
- **I05 A balance view is never authoritative.** No code path may spend, debit, credit or
  gate on a `BalanceView` without resolving to the chain. Every view carries the height it
  was computed at, and a view whose height is stale beyond its configured bound is an error,
  not a slightly old number.
- **I06 Every spend above the threshold cites a 31403.** A settlement above the configured
  threshold without a valid, unexpired, signed kind-31403 approval of its kind-31402 request
  is refused. The refusal is recorded in the `authority.deny` journal.
- **I07 No ad-hoc URN.** Every durable identifier this domain emits is minted through
  `management-api/lib/uris.js`. Hand-built URN strings are prohibited, per ADR-013.
- **I08 Wrapped supply equals held reserve.** For each `WrappedAssetId`, total wrapped supply
  on our chains equals the origin asset amount the bridge verifiably holds. Issuance without
  a validated consignment and a confirmed reserve position is prohibited, and redemption
  burns before it releases, never after.
- **I09 Trust level is declared, never inferred.** Every chain document carries an explicit
  `trustLevel`, every surface that shows a balance shows it, and it may not be re-declared
  downward. A chain carrying value belonging to more than one principal may not be L1.
- **I10 No in-chain EVM.** The `evm` rule may not appear in any chain document we seal.
  PRD-015 C11's rejection of a native EVM rail stands and is enforced at seal time.
- **I11 Seal terminology is gated.** The phrase "single-use seal" may not be used in code,
  documents or interfaces for any construction in this domain until a spent-exactly-once
  check exists for it, per ADR-124 §2.3. "Anchor", "peg", "claim" and "marker" are the
  permitted words.
- **I12 Key roles are separated.** The chain block-signing key, the parent peg custody key
  and any principal's spending key are distinct keys. Upstream derives block-signing
  authority and the peg wallet descriptor from one key set; we do not adopt that, because it
  makes one compromise two.
- **I13 The currency pin is immutable on seal.** `currencyPin` and `cashOut` are fixed when
  genesis is sealed and cannot be changed by configuration, rule document or redeployment.
  Changing either means a new chain with a new genesis.
- **I14 The refund path always exists.** Every peg output carries
  `and_v(v:pk(refund), older(refundBlocks))` under the pegger's own key. A peg output whose
  only spend path is the federation's is prohibited.
- **I15 Every settlement emits a receipt.** Every terminal settlement event mints a
  `SettlementReceipt` through `uris.js` and appends to the hash-chained events log. An
  unreceipted settlement is a defect, not an optimisation.
- **I16 One canonical ledger.** Writes to the three legacy ledgers as sources of truth are
  prohibited once their chain projection is live. They become read-through views or they are
  removed. Two authoritative balances for one pubkey is the defect this domain exists to end.
- **I17 Assets do not leave through the sats peg.** A burn is of sats only. A wrapped or
  issued asset leaves only through its own bridge redemption or a child chain's close.
- **I18 A child chain cannot outlive its binding.** A child chain bound to a session must
  reach `Closed` when that session closes. An orphaned open child chain holding value is an
  alertable condition, and the bound session's close is blocked on settlement.
- **I19 Settlement fails closed.** No gate on the settlement path may fail open on backend
  unreachability. `cost-gate.js`'s current fail-open default is acceptable for a sats
  micro-debit and is prohibited here, because "backend unreachable" can mean "cannot tell
  whether this was already spent".
- **I20 Nothing is trusted from a mirror or a relay.** Every block is replayed locally
  through the kernel; every inbound event's signature is verified before use; a mirror may
  lag the signer's announced tip but may never lead it.
- **I21 Integer arithmetic only.** Amounts, shares, fees and pool arithmetic are exact
  integers. Any rounding is in the chain's or the pool's favour, never a participant's.
- **I22 The nsec never enters this domain.** Signing happens behind the identity port.
  This domain hands over payloads and receives signatures.
- **I23 Parent and header family are immutable on seal.** `ParentRef` and `HeaderFamily` are
  read from configuration when a chain document is drafted and fixed when genesis is sealed.
  No rule document, configuration reload or redeployment may change either. A chain whose
  configured parent no longer matches its sealed document is a misconfiguration to refuse
  loudly, never a chain to re-parent. A `ParentRef` naming a mainnet network additionally
  requires I04.
- **I24 Header family is declared, never inferred from the parent.** A chain's own
  `powHash` and header layout are taken from its document. Deriving them from `ParentRef`,
  or from which overlay happens to be loaded, is prohibited.

---

## Context Map

| Relationship | Neighbour | Pattern |
|---|---|---|
| **Conformist, with an ACL** | sidestr upstream (spec, kinds, marker grammar, block signature) | Their wire language, their kind numbers, their marker bytes. We conform exactly so our chains interoperate with the reference implementation, and translate at the edge. Our additions are extra chain-document fields a conformant validator ignores, never repurposed fields of theirs. |
| **Customer-Supplier (we are the customer)** | DDD-003 Sovereign Messaging | Supplies `did:nostr`, signing, the relay plane and the pod mailbox. We supply payloads, never keys. |
| **Customer-Supplier (we are the customer)** | GOVERNANCE-capabilities, `lib/authority.js` | Supplies the 31402/31403 decision that releases a spend. We own the binding of decision to spend, not the decision. |
| **Published Language** | ACSP kinds 31402/31403 | The estate's existing approval grammar, consumed unchanged for `SpendAuthorisation`. |
| **Anti-Corruption Layer** | rgb-lib and the RGB ecosystem | An isolated bridge service. rgb-lib, rust-bitcoin and bdk live behind it; no RGB type reaches our model. This also contains the rgb-protocol versus RGB-WG ecosystem split, which is two divergent codebases sharing a name. |
| **Anti-Corruption Layer** | solid-pod-rs WebLedger, VisionClaw `FsPaymentStore`, nostr-bbs D1 ledger | A view adapter per ledger. They keep their shapes and their HTTP contracts; the numbers inside become projections. |
| **Customer-Supplier (we are the supplier)** | BC20 URI federation, `docs/PROTOCOL-registry.md` | We supply a new `chain` URN kind and a settlement receipt kind-mapping decision. The existing receipt-stays-local, activity-and-bead-cross split is the precedent to follow or explicitly deviate from. |
| **Partnership** | DDD-019 Interaction Plane (BC-session) | A `ChildChain` binds to a `ManagedSession`; the session's close blocks on settlement (I18). Shared lifecycle, two aggregates, neither owning the other. |
| **Partnership, first-class** | Gitmark and blocktrails anchoring (DDD-020 / BC23, ADR-059, ADR-128, `git-mark.com`) | **`sidestr:gitmark` is the estate's own product, not an upstream example.** It is a chain this domain seals, produces and closes, carrying a trail of tweaked taproot outputs that the anchoring context owns, checkpointed into the parent by the `checkpoints` rule so the parent's proof of work bounds when a mark was made. Two contexts, one chain: settlement owns the `ChainDocument`, the peg and the receipts; anchoring owns the trail, the tweak chain and what a mark means. They meet at the `ckpt:` record and the empty `txo[]` seam in `contract.rs:128`, and nowhere else. ADR-128's "adopt verbatim, no parallel design" precedent applies to the anchoring scheme, not to the chain beneath it. |
| **Separate Ways, for now** | DDD-006 LLM Marketplace (barter, kinds 38300-38305) | A second value system exists. Absorbing it is a PRD-024 decision, deliberately not taken here. Becoming a *third* parallel value system is the failure mode to avoid. |
| **Shares pattern, not code** | DDD-021 Typed Decisions (BC24), the Ontology Loom | The published-client and stable-façade patterns are reused: one crate owns the protocol types, every caller depends on it, no caller hand-rolls a subset. |
| **Consumes geometry** | DDD-016 Memory-Learning | Operational state and search only. A balance never lives in memory. |
| **Customer-Supplier (we are the supplier)** | solid-pod-rs payments context | We supply the chain; it supplies the existing `/pay/*` routes, order book and AMM, which become chain-settled or are retired. Its hand-rolled BIP-341 on raw k256 is ported to rust-bitcoin in the same programme (D3). |
| **Conformist** | VisionClaw web-contracts (TrustLevel L0-L3, GitMark, Blocktrails) | We conform to the existing trust-level vocabulary rather than mint a parallel one, and map sidestr's L1/L2/L3 onto it explicitly in PRD-024. |
| **Customer-Supplier (we are the customer)** | Colloquy forum ACSP governance (`colloquy-core`, authorising principals) | Candidate supplier of the approver-side principal-collapse model for `SpendAuthorisation`: an operator's fifty agents are one voice. Reuse decision belongs to PRD-024. |
| **Upstream we do not control** | Bitcoin (testnet4, later mainnet) | Read-only parent view. |

---

## Anti-corruption layers

Three, each guarding a different kind of foreignness.

**1. The sidestr sidecar (foreign implementation).** The upstream `siding` producer and
signer are AGPL-3.0 JavaScript by a single author on a repository created six days before
this document, whose own specification says field names, kinds and document shapes are
provisional. We run it as a container-internal sidecar for block production while the Rust
implementation reaches parity (D3), and never link it. The boundary has four rules, mirroring
DDD-021's treatment of the Jev protocol:

1. *Conform on the wire, own the model inside.* One Rust crate owns `ChainDocument`,
   `PegIn`, `PegOut`, `MarkerRecord` and the rest as domain types; serde renders them into
   sidestr's shapes at the edge. Nothing inside reasons in upstream JSON.
2. *Extensions are additive.* `trustLevel`, `currencyPin`, `cashOut`, `p21ReceiptUrn`,
   `closePolicy` and `boundTo` are new fields a conformant validator ignores. We never
   repurpose an upstream field, and we never require upstream to read ours.
3. *Their implementation is non-normative for our behaviour.* Recorded upstream blocks and
   events are golden fixtures our codec must round-trip byte-exactly. Where their prose and
   their code disagree, which is already true in at least three places (kind 33502's double
   use, the shipped `chain.json` files carrying empty `pegs` that `open()` cannot rebuild
   genesis from, the witness slots being in reverse leaf order with no specification text),
   the fixture wins for compatibility and our specification wins for behaviour.
4. *Translation failure is loud.* A document we cannot represent is refused at the boundary.
   The translation layer never repairs, defaults or infers a field into existence.

The licence boundary is part of this ACL and is load-bearing: the AGPL sidecar is a separate
process; the publishable Rust crate is clean-room from the specification under a permissive
licence per ADR-2030; the two never share a crate graph. R4 establishes that no canon record
of this tension exists yet, so PRD-024 introduces it as a new, blocking constraint rather
than a footnote.

**2. The RGB bridge service (foreign trust model).** rgb-lib, rust-bitcoin and bdk live in
one isolated service. It receives a consignment, validates it with rgb-lib, confirms the
reserve, and emits exactly one domain fact: `BridgeClaimValidated` with a `ReserveRef`. No
consignment, schema, contract id, AluVM artefact or rgb type crosses outward. This is what
makes ADR-124's sharpest objection tractable: rgb-core conflicts with the k256-only,
zero-rust-bitcoin-dependency posture, and the resolution is not to win that argument but to
put the dependency where the posture does not reach. Accepting rust-bitcoin into the estate
(D3) is a separate, deliberate decision whose first beneficiary is replacing solid-pod-rs's
hand-rolled BIP-341 sighash on raw k256, which house rules already make the
highest-priority port.

**3. The WebLedger view adapter (foreign shape).** Each of the three ledgers keeps its API
and its document shape; a per-ledger adapter recomputes the numbers from the UTXO set and
serves them with the height they were computed at. Nothing downstream is asked to change its
requests. This is the migration mechanism, and it is what allows I16 to be reached without
a flag day.

---

## Repositories and ports

| Port | Direction | Counterpart | Contract |
|---|---|---|---|
| `ChainDocumentRepository` | Both | Durable store plus kind-33501 genesis | Load by `ChainId` or URN; persist a sealed document; never mutate a sealed one. |
| `BlockStorePort` | Both | Local block files, cross-checked against mirrors | Append, read by height, replay. Mirrors are convenience; every block is replayed (I20). |
| `ParentViewPort` | Outbound | A node for the chain's sealed `ParentRef` | Headers, `scanPegins`-equivalent marker scanning, peg output confirmation, broadcast. Required at L2. One implementation per `networkFamily`; selecting the wrong one is a refusal, not a retry. |
| `ProducerPort` | Outbound | The signer or the level-2 round | Seal a block, or propose and collect partials. Implemented first by the AGPL sidecar, then by the Rust producer at parity. |
| `RelayPort` | Both | DDD-003 relay plane, ADR-2012 allowlist | Publish and subscribe for the kinds above. Kind-only filtering for ephemeral kinds is a known constraint. |
| `IdentityPort` | Outbound | `lib/agent-identity.js` | Pubkeys and signatures. The nsec never crosses (I22). |
| `UriMintPort` | Outbound | `lib/uris.js` | Every durable identifier (I07), including the new `chain` kind. |
| `AuthorityPort` | Outbound | `lib/authority.js` | `payment_settlement` zero-tolerance class: request a 31402, await a 31403, record a denial. Fails closed (I19). |
| `EventsPort` | Outbound | ADR-005 events slot | Hash-chained append of every event above; verified at `/v1/system/audit-chain`. |
| `ReceiptPort` | Outbound | `receipt-minter.js`, `uris.js` | Mint and resolve `SettlementReceipt` (I15). |
| `BridgePort` | Outbound | The isolated RGB bridge service | `validateConsignment`, `reserveStatus`, `release`. Returns domain facts only. |
| `BalanceViewPort` | Inbound | The three legacy ledgers | Recompute a view for a pubkey at a height. Read-only by construction (I05). |
| `Pay402Port` | Inbound | `pay402.js` closed-grammar classifier | A new `sidestr` scheme, which is an ADR-032 revision plus fixtures, never a runtime extension point. |
| `ManifestGatePort` | Inbound | `agentbox.toml [sidechain]`, `system-manifest.js`, onboarding | One gate, off by default, byte-identical when off, with an honest apply class. Supplies `ParentRef` and `HeaderFamily` defaults at draft time (D6) and nothing at all after a seal: a manifest change cannot reach a sealed chain (I23). |

---

## What this domain explicitly does not model

- **EVM.** No chain we seal names the `evm` rule (I10). One private key producing an
  Ethereum address is a property of the upstream wallet, not a capability we expose. PRD-015
  C11 stands.
- **Lightning.** Not a rail, not a dependency, not a planned phase. PRD-015 C10 and ADR-032
  D5's Lightning-first position are superseded (D5). NWC and L402 are not built. Lightning
  may return only as an optional bridge on-ramp, modelled then as another `BridgeClaim`
  origin, never as the instrument.
- **Custodial routers, exchanges and cash-out.** No fiat ramp, no order routing to a third
  party, no withdrawal to an external custodian. `cashOut: disabled` is the default and
  changing it requires I04.
- **RGB contract semantics.** Schemas, state transitions, consignment validation, AluVM. All
  of it stays in rgb-lib behind the bridge, and none of it is re-implemented.
- **Client-side validation as a chain property.** Our chains validate in consensus, by every
  node. That is the opposite of RGB's premise, and the difference is the reason the bridge
  exists rather than a merger.
- **Trust-minimised peg-out.** Drivechain and spacechain style parent-enforced pegs are out
  of scope upstream and out of scope here. We are a custodian at L1 and a k-of-n custodian at
  L2, and I09 makes us say so.
- **Signer set rotation and recovery.** Upstream's L3 is unbuilt and has no resharing
  ceremony: a new signer set requires manually moving peg funds by an old-set-authorised
  peg-out. We model L3 as a declarable level and nothing more until that exists.
- **Front-running mitigation in the pool rule.** The signer orders transactions and can
  front-run them. Upstream says so plainly. We do not pretend otherwise, and PRD-024 should
  decide whether a pool runs on a chain we sign at all.
- **Pricing, markets and the barter economy.** DDD-006's grants are a separate system.
- **A hard-coded parent or header family.** Neither is excluded and neither is assumed: both
  are configuration this domain reads and seals (D6, see below). What the domain does not
  model is the parents' own consensus.

### The parent and header families are configuration (D6)

Two facts are separate and both are declared rather than inferred. A chain's `ParentRef`
names the network it pegs to and that network's consensus family. A chain's `HeaderFamily`
names the format and proof-of-work hash of its *own* headers. Upstream conflates them in
practice: `engine.mjs` loads the Knots BLAKE2b overlay unconditionally and `overlay.mjs`
gives every sidechain `powHash: 'knots:blake2b-v2'` from height 0 whatever its parent is, so
the sidechain's header format is in fact independent of `chain.parent` while looking as
though it follows from it. A Rust codec that inherits that coupling will be wrong the first
time the two differ.

Both values come from `agentbox.toml [sidechain]`, are surfaced by onboarding, and default
to following upstream (`btc:testnet4-blake2b`, `knots:blake2b-v2`) so that a chain we seal
with default configuration interoperates with the reference implementation and its live
chains. Choosing SHA-256d testnet4 or mainnet is then a configuration decision with a gate
(I04) rather than a fork of the model. Once genesis is sealed, both are immutable (I23):
changing either is a different chain, because the genesis hash and every header after it
depend on them.

`sidestr:gitmark` is the estate's own product, not an upstream example, and it is the
existing proof that the two axes are separate in practice: it runs the `checkpoints` rule
into a parent whose family is not its own.

---

## Migration of the three ledgers

The precondition is a decision, not code: one canonical ledger. The decision is D4, the chain
is truth. What follows is the sequence that makes it true without a flag day.

**Phase 0, before anything settles.** Implement the P21 gate (I04): the on-seal currency pin,
the cash-out disablement, and the owner-plus-legal receipt. This lands first because it is the
only control that prevents the rest of the programme from quietly becoming a mainnet money
service, and it should not land in the same change as the code that makes that tempting.
Reconcile VisionClaw's empty `extraction/solid-pod-rs` vendor mirror and the version skew
(VisionClaw pins 0.4.0-alpha.15, nostr-bbs pins 0.5.0-alpha.7) so all three consumers can
move together.

**Phase 1, the chain exists and is empty.** Seal the root chain at L2 on the configured
parent, one signer key per federated instance. Defaults follow upstream (D6), so the first
sealed chain interoperates with the reference implementation and its live chains, and the
`[sidechain]` block plus its onboarding surface ships with it. Nothing settles on it yet. The
Rust validator reaches byte-exact round-trip parity against upstream fixtures **for both
header families**, which is the cheapest moment to prove `ParentRef` and `HeaderFamily` are
genuinely independent rather than to discover later that the codec inferred one from the
other. The AGPL sidecar produces blocks. The `chain` URN kind ships. Port solid-pod-rs's hand-rolled BIP-341 to rust-bitcoin in the same phase,
because that code is about to become load-bearing for real value.

**Phase 2, views before writes.** Each of the three ledgers grows a read-through projection
behind its existing API: solid-pod-rs's `WebLedger`, VisionClaw's `FsPaymentStore`,
nostr-bbs-pod-worker's D1 table. Both numbers are computed and compared, and divergence is
logged, for a stated observation period. Nothing downstream changes its requests. VisionClaw's
`FsPaymentStore` is the easiest case and should go first: its `.deposit` is a 501 stub, so
there is no legitimate value in it to reconcile, only an empty ledger to repoint.

**Phase 3, the chain becomes the source.** Peg in, and the projections become the only
answer. The legacy stores stop being written as sources of truth (I16). solid-pod-rs's MRC20
deposits and its AMM are the hard case, since they hold the only real value movement in the
estate today and are non-atomic by the README's own admission: they either become
chain-settled or they are retired, and PRD-024 must choose rather than let them persist as a
fourth system.

**Phase 4, the new rail.** `pay402.js` gains a `sidestr` scheme with its ADR-032 revision and
fixtures. `SpendAuthorisation` is wired, which means `routes/payments.js` calls
`lib/authority.js` for the first time and the declared `payment_settlement` zero-tolerance
class starts enforcing something. `spend-policy.js`'s daily budget moves out of memory into
durable state, because an in-memory cap that resets on restart is not a cap.

**Phase 5, child chains.** The `ChildChain` and `Close` implementation, its own test corpus,
and the binding to `ManagedSession` (I18). This is last because it is the most original work
and the least derisked by upstream.

**Phase 6, the bridge.** The isolated RGB bridge, issuance before redemption in code but both
in the model. USDT-on-RGB is not confirmed live as of this date: the Tether announcement is
from August 2025 and the UTEXO-led rollout was described in July 2026 as realistic but not
committed. The bridge therefore ships against a generic RGB20 origin and treats USDT as one
instance, so a slipping third-party launch delays a configuration, not an architecture.

Throughout: five adapter slots, no sixth (ADR-2085 precedent). Settlement consumes the
`events` and `memory` slots and the management API's existing surfaces. It does not become a
sixth durable-state adapter, and PRD-024 should say so explicitly, because a financial
substrate is exactly the sort of capability that feels like it deserves its own slot.

---

## Open modelling questions

1. **Does a `SettlementReceipt` cross BC20?** The existing precedent splits: `receipt` stays
   agentbox-local by design, `activity` and `bead` cross. A settlement between two federated
   instances whose proof does not cross is awkward; a receipt that crosses weakens the
   "agentbox-local proof" stance. PRD-024 must choose, and the choice is a kind-mapping
   decision with an ADR.
2. **One root chain, or one per federated instance?** D2 says one root, each instance holding
   a signer key. That makes every instance a co-custodian of every other's value, which is a
   strong statement about a federation that may include instances we do not operate. The
   alternative, one chain per instance nested under a DreamLab root, pushes the
   inter-instance settlement problem into the peg, which is where it is at least modelled.
3. **What is the threshold for I06, and is it per chain, per principal or per asset?** A
   single global sats figure is wrong for a wrapped USD asset. The natural answer is per asset
   with a per-principal multiplier, but that is policy this domain consumes rather than owns.
4. **Does the approver model reuse Colloquy's authorising principals?** The "fifty agents are
   one voice" property is exactly right for a spend gate and already published as a crate.
   The cost is a dependency from the settlement path onto the forum's model.
5. **Does a child chain need its own peg, or can it be internally funded?** A peg per child
   chain means a parent transaction per agent job, which is a flat fee against a possibly tiny
   tab. Nesting a child chain under the root chain rather than under Bitcoin makes its "parent
   transaction" a root-chain transaction, which is nearly free. That is almost certainly the
   right answer, and it means the refund timelock compounds down the nesting, which needs
   stating and bounding.
6. **What happens to a child chain whose parent stalls?** The refund path's relative timelock
   counts confirmed parent blocks. A stalled root chain freezes every child's refund. This is
   noted upstream as a compounding property of nesting, and it deserves an explicit liveness
   requirement on the root producer.
7. **Does the AMM run on a chain we sign?** The pool rule is a bare centralised-sequencer AMM
   with an acknowledged, unmitigated front-running property. Running it means we are the
   sequencer who could front-run, which is a legal-product-class question as much as a
   technical one.
8. **Which existing value system survives?** DDD-006's barter grants and the sats 402 economy
   are already parallel and non-interacting. Adding settlement without resolving that leaves
   three.
9. **Does a settlement receipt satisfy the ADR-124 P21 evidence requirement, or is the gate
   strictly build-time?** The ADR frames sign-off as gating build and deploy, not runtime.
   Modelling the gate artefact as a receipt makes it resolvable, which is useful, but must not
   turn a build-time control into a runtime one that a misconfiguration can open.
10. **Ontology grounding.** New classes are needed (`sidestr-protocol`, `wrapped-asset-bridge`,
    `pro-rata-close`), and ADR-124 §8 already committed the estate to closing four pre-existing
    gaps (`adaptor-signature`, `dlc-oracle-attestation`, `mrc20-token-rail` / `webledger` /
    `payment-condition-402`, and the AMM maturity-grade inversion). New classes go alongside
    those, not instead of them, and the freshness of that 2026-06-14 snapshot should be
    re-verified rather than trusted.
11. **Do we run our own relay for the settlement plane?** Upstream's ephemeral kinds are not
    filterable by chain at the relay, so on shared public relays every producer downloads every
    sidestr chain's traffic. Our own relay solves that and narrows the ingress surface, at the
    cost of being the thing everyone depends on.
12. **Does a child chain inherit its root's header family, or choose its own?** I24 says the
    value is declared, not inherited, but it does not say a child may *differ*. Letting it
    differ means the producer runs several codecs at once; forbidding it means one field on a
    child chain is decorative. A defaulted-from-parent-but-declared rule is probably right and
    should be stated either way.
13. **Which parent family does the root chain actually seal with?** D6 makes it configuration
    and defaults it to upstream's Knots BLAKE2b testnet4, which buys interoperability with the
    reference implementation's live chains. D1's earlier SHA-256d preference buys a parent with
    real, widely-verified proof of work and a straightforward path to mainnet under I04. This
    is now a configuration decision with a default rather than an architectural one, but it is
    still a decision, and sealing is irreversible (I23).
14. **What is the `Defaulted` peg-out remedy?** We model the fact. We have not modelled the
    consequence, and at L2 with our own federation the honest answer may be "an operational
    alert and a manual payment", which should be written down rather than discovered.

---

## References

- PRD-024, `docs/proposals/sovereign-settlement.md` (the product case)
- ADR-2096 to ADR-2101 (placeholders; topics listed in the header)
- ADR-013 canonical URI grammar; `management-api/lib/uris.js:69-97`
- ADR-032 402 scheme grammar (revision required for the `sidestr` scheme)
- ADR-005 adapter architecture and the three middleware layers; ADR-2085 (no sixth slot)
- ADR-2030 permissive licensing for publishable service crates (the AGPL boundary)
- ADR-2012 relay allowlist; ADR-2085 kind block 38000-38201
- ADR-033 blocktrail `txo[]` seam; `services/nostr-pod-bridge/src/contract.rs:128`
- ADR-124 and ADR-128 (host repo): the L0-L3 trust ladder, the P21 containment mechanism, the
  UK regulatory matrix, and the seal-terminology prohibition at §2.3
- PRD-015 C10 (Lightning-first, superseded) and C11 (no native EVM rail, standing)
- DDD-003, DDD-006, DDD-016, DDD-019, DDD-020, DDD-021
- `docs/GOVERNANCE-capabilities.md` (kinds 31402/31403, `payment_settlement`)
- `docs/INGRESS-identity.md`, `docs/PROTOCOL-registry.md`
- solid-pod-rs: `src/bitcoin_tx.rs`, `src/mrc20.rs`, `payments.rs:102-176`, `pay.rs:128-291`
- VisionClaw: `src/handlers/pay_handler.rs:198-403`; nostr-bbs-pod-worker: `payments.rs:183`
- sidestr SPEC.md v0.0.1 draft (2026-09-15) and proposals: assets-and-pools, desk, checkpoints,
  evm, level-2, ephemeral. Self-described as provisional in field names, kinds and shapes.
