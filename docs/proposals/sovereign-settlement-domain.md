# DDD-022: Sovereign Settlement Domain

**Date**: 2026-09-21
**Status**: Proposed
**Bounded Context**: Sovereign Settlement, the chains we sign ourselves, what they say a principal holds, and how value enters, moves and leaves them (**BC25**)
**Placement**: `docs/archive/ddd/` is the frozen pre-consolidation corpus and is not authority; the DDD series is continued here beside the living scope documents, following the DDD-021 precedent. The compliance surfaces this domain answers to are [`docs/GOVERNANCE-capabilities.md`](../GOVERNANCE-capabilities.md) (the spend gate), [`docs/INGRESS-identity.md`](../INGRESS-identity.md) (the identity chain) and [`docs/PROTOCOL-registry.md`](../PROTOCOL-registry.md) (URN kinds and Nostr kinds). The product case is [PRD-024](../proposals/sovereign-settlement.md).
**Cross-references**: [PRD-024](../proposals/sovereign-settlement.md) (the product case this domain models). Decisions: [ADR-2096](../adr/) (sidestr sidechains are the sole value instrument: licensing posture, `evm`/`pool`/`desk` excluded, the k256-only posture retired, honest per-chain custody), [ADR-2097](../adr/) (the sidestr rail supersedes Lightning-first; pay402 gains a `sidestr` scheme, an ADR-032 revision), [ADR-2098](../adr/) (the `chain` and `asset` URN kinds, sidestr Nostr kinds registered, chain traffic on a dedicated program outside the identity relay allowlist), [ADR-2099](../adr/) (the chain is the ledger of record, balances are UTXO folds, the three ledgers become views, the blocktrail `txo[]` seam opens onto the root chain, "anchor" terminology until `AnchorConfirmer` ships), [ADR-2100](../adr/) (every chain settlement passes the `payment_settlement` authority gate; durable budget; fail-closed cost gate), [ADR-2101](../adr/) (federation topology and key separation: one root chain, instances as k-of-n signers, ephemeral child chains bound at session create, domain-separated keys amending ADR-033), [ADR-2102](../adr/) (assets are bridged in; RGB enters only as a wrapped asset behind a process boundary, re-sequencing ADR-124/128 for the bridged case only), [ADR-2103](../adr/) (parent chain and header profile are manifest configuration, with mainnet variants behind the P21 gate and bound on-seal).
**Sibling records in other repos**: solid-pod-rs ADR-2008 (the rust-bitcoin port and the ledger becoming a view), VisionFlow host ADR-2111 (`FsPaymentStore` retired, the ADR-124/128 re-sequencing recorded at source), nostr-rust-forum ADR-2012 (the D1 ledger becoming a view; `derive_subkey` as the domain-separation primitive), VisionFlow canon ADR-2012 (canon alignment).
**Amends or supersedes**: [ADR-032](../archive/adr/ADR-032-402-scheme-grammar.md) (revision plus fixtures for the `sidestr` scheme), PRD-015 C10 (Lightning-first, dropped) with C11 (no native EVM rail) standing and extended, ADR-033 (identifier and seam discipline, amended for domain-separated keys and the `txo[]` destination), ADR-124 / ADR-128 in the host repo (the RGB rung re-sequenced for the bridged case only, never silently overridden).
**Consumes**: [DDD-003](../archive/ddd/DDD-003-sovereign-messaging-domain.md) (identity and relay), [DDD-006](../archive/ddd/DDD-006-llm-marketplace-domain.md) (the barter economy this must not become a third parallel to), [DDD-019](../archive/ddd/DDD-019-interaction-plane-domain.md) (sessions, which is what a child chain binds to), [DDD-020](../archive/ddd/DDD-020-semantic-integrity-provenance-domain.md) (provenance and the anchor vocabulary), [DDD-021](./sovereign-system-one-domain.md) (the façade and published-client patterns reused here).

---

## TL;DR for newcomers

*Skip if you already know that we sign our own Bitcoin-family sidechains, that a balance is
just the unspent outputs keyed by a pubkey on one of them, and that every other ledger in the
estate is about to become a cached view of that.*

This bounded context owns **settlement**: the existence and rules of the chains DreamLab
signs, the movement of value into them (peg-in, bridge-in), within them (ordinary spends),
and out of them (peg-out, child-chain close), and the receipts that prove any of it
happened. The aggregate root of chain identity is the `ChainDocument`.

The estate runs three kinds of chain. `sidestr:gitmark` is ours and carries provenance
anchors, not value. `sidestr:dreamlab` is the root chain and carries principals and bridged
assets. Ephemeral child chains nest under the root, bind to a session at create, and settle
back when they close.

The domain does **not** own identity (DDD-003 mints the `did:nostr`), does not own the
governance decision that releases a spend (GOVERNANCE-capabilities owns the 31402/31403
round trip), does not own any parent chain's consensus, and does not own RGB's contract
semantics. It consumes all four.

**If you remember only one thing:** the chain is the ledger of record. A balance shown
anywhere in the estate, including the pod WebLedger, VisionClaw's file ledger and the
worker's D1 table, is a **fold over the UTXO set**, and a fold is not a thing you can spend
from. Every one of those three ledgers becomes a read-through view, or it stops being
consulted.

For the deep version, keep reading.

---

## Domain Purpose

The truth this domain owns is **what a principal holds, and by what authority it moved**.

Today the estate cannot answer that question once. It answers it three times, in three
places that do not talk to each other: solid-pod-rs's `WebLedger` persisted at
`/.well-known/webledgers/state.json` (`payments.rs:102-176`, `pay.rs:128-291`), VisionClaw's
`FsPaymentStore` flat file (`pay_handler.rs:198-403`, whose `.deposit` route is a 501 stub,
so nothing can legitimately enter it at all), and nostr-bbs-pod-worker's D1 table
(`payments.rs:183`). All three are keyed on `did:nostr:<hex>`. None is authoritative over
the others, and none is anchored to anything. A number in a database that nobody else agrees
with is not a balance; it is a claim.

A sidestr chain replaces the claim with a record. Value exists on it because it was pegged
in from a parent chain or bridged in from an origin contract, it is held at a taproot output
whose key is a principal's own derived spend key, and it moves only because that principal
signed. Every node that cares replays every block through the same kernel, so a balance is
not asserted by a server, it is **recomputed by anyone**. That is the whole reason to do this.

Three things make it a domain rather than a client library.

First, **supply integrity**. A sidechain has no subsidy and no mint. Every coin traces to a
peg, every wrapped asset traces to a bridge claim, and the arithmetic that keeps those two
statements true is the only thing standing between us and a system that invents money. It
has to be stated as law and tested as law, not inherited as an implementation detail of
somebody else's JavaScript.

Second, **custody is a declared fact, not a feeling**. Level 1 means one key both seals
blocks and holds the peg: a custodian, whatever the prose says. Level 2 means k of n, which
is a better custodian, not the absence of one. Upstream goes further and derives both roles
from the same key set (`federation.mjs`'s `pegDescriptor()` builds the peg wallet descriptor
from the same challenge derivation that authorises block production), so k colluding signers
get block production and peg theft in one move. This domain carries the trust level on the
chain document as a declared value, refuses to let a chain holding several principals' value
sit at level 1, and separates the key roles that upstream merges, with independent custody
roots rather than children of an agent-readable identity root (I12).

A declared level is a disclosure, not a control. It does not stop a malicious threshold
stealing reserves, refusing redemption or adopting a fraudulent rule, and it does not make
one history canonical. Safety comes from the fault model of I25, where a threshold that fails
`2k - n > f` admits two valid conflicting histories at one height: the counterexample is
three-of-five with one malicious signer, whose only quorum intersection is that signer.
Custody stays custody at every level, and the level-one to level-three ladder is the
hardening path, not an escape from it.

Third, **the regulatory boundary is architectural**. ADR-124 §7 is explicit that removing
custody removes no UK obligation at any trust level, and that the only real containment is
the testnet, no-cash-out corner. That containment has been a documented plan with no code
behind it (the P21 exit criterion). Putting real value on a chain makes it code. The parent
network, the header profile, the currency pin and the cash-out posture become **on-seal
immutable commitments carried by the chain document itself**, so a testnet chain cannot
quietly become a mainnet one.

Nothing here owns the model of identity, the consumers' fail-open behaviour, any parent
chain's consensus, RGB's contract semantics, or the decision to release a spend. It owns the
chains, the pegs, the bridges, the closes, the authorisations that bind a spend to a
decision, and the receipts.

---

## Bounded Context Definition

**Boundary**: from a signed `ChainDocument` at one end to a `SettlementReceipt` at the
other, including everything that changes what a principal holds on a chain we sign.

**Owns** (IN):

- The `ChainDocument` aggregate: a chain's identity, parent, header profile, challenge,
  rules, trust level, signer set, currency pin and cash-out posture. Its lifecycle from
  proposal to sealed genesis to close.
- The `PegIn` and `PegOut` lifecycles, including the claim-adjacency pairing that binds a
  claimed amount to exactly one parent outpoint, and the refund path that makes a dead chain
  cost time rather than coins.
- The `BridgeClaim` aggregate: an external asset (RGB20, including USDT-on-RGB, or a Taproot
  Asset) arriving as a wrapped asset on one of our chains, and the reserve accounting that
  keeps wrapped supply equal to held origin supply.
- The `ChildChain` aggregate and its `Close`: an ephemeral chain bound to a session at
  create, and the pro-rata closing settlement plus tombstone that ends it.
- The `SpendAuthorisation` aggregate: the binding between a spend above a threshold and the
  signed ACSP kind-31403 approval of the kind-31402 request that released it.
- The `SettlementReceipt`: the durable, URN-identified, hash-chained record that a
  settlement occurred, minted through `management-api/lib/uris.js`.
- `BalanceView` as a **derived, explicitly non-authoritative** fold over the UTXO set, and
  the rule that makes it so.
- The anti-corruption boundaries against the sidestr wire protocol, the rgb-lib bridge and
  the three legacy ledgers (below).

**Does not own** (OUT):

- **Identity.** `did:nostr` minting, key persistence and the identity chain belong to
  DDD-003 and `docs/INGRESS-identity.md`. This domain consumes an identity key and derives
  subkeys from it through the identity port; it never mints an identity. That a Nostr key
  can be a chain address is a fact we constrain, not a design we own.
- **The governance decision.** Whether an agent may spend is
  `docs/GOVERNANCE-capabilities.md` and `management-api/lib/authority.js`. This domain owns
  the *binding* of a decision to a spend, not the decision.
- **Any parent chain's consensus.** We read a parent view; we never reason about how it
  reached agreement.
- **RGB contract semantics.** Schemas, state transitions, consignment validation and AluVM
  stay entirely inside rgb-lib behind a process boundary. We never re-implement client-side
  validation, and no RGB type crosses the bridge into our model.
- **The barter economy** (DDD-006, kinds 38300-38305). LLM marketplace grants are a separate
  value system. PRD-024 must say which of the two survives; this domain does not absorb it
  by default.
- **Provenance anchoring** (DDD-020, ADR-059, ADR-128). `sidestr:gitmark` is ours and exists
  precisely to carry anchors, but anchoring is not settlement: this domain owns the chain a
  trail runs on, not the trail. The neighbouring context owns the tweak chain and what a
  mark means.
- **Session lifecycle** (DDD-019). A child chain *binds to* a `ManagedSession`; it does not
  manage one.
- **Pricing and the 402 grammar's shape.** ADR-032 owns the scheme grammar; we supply one
  new scheme's semantics and its fixtures.

**Consumes**:

| Consumed | From | What exactly |
|---|---|---|
| Identity and subkey derivation | DDD-003, `management-api/lib/agent-identity.js`, `nostr-bbs-core` `derive_subkey` (`keys.rs:251-265`) | The sovereign identity key, and HMAC-SHA256 domain-separated children for spend and signer roles. The nsec never enters this domain. |
| URN minting | `management-api/lib/uris.js` | Every durable identifier, per ADR-013, including the new `chain` and `asset` kinds. |
| The release decision | `docs/GOVERNANCE-capabilities.md`, `lib/authority.js`, `task-properties.js` | kind-31402 request, kind-31403 signed approval, the `payment_settlement` zero-tolerance class, the deny journal. |
| The events chain | ADR-005 events slot (`adapters/events/local-jsonl.js`) | Hash-chained append for every settlement event, verified at `/v1/system/audit-chain`. |
| The relay plane | DDD-003, ADR-2012 allowlist, and a dedicated chain-traffic program | Publication and subscription. Chain traffic does not ride the identity relay allowlist (ADR-2098). |
| Memory | DDD-016 | Operational state only. Never a balance. |
| The parent view | A node for the chain's sealed `ParentRef` | Headers and peg outputs, for level-2 claim verification. |
| RGB state | rgb-lib, inside the bridge service only | Consignments, validated there, never here. |
| Session boundaries | DDD-019, `management-api/routes/sessions-boundary.js` | The `phase=create` and `phase=close` hooks a child chain binds to. |

---

## Ubiquitous Language

| Term | Definition |
|---|---|
| **Chain** | A Bitcoin-family sidechain whose only network is Nostr: signed blocks, no subsidy, every coin pegged, rules as signed documents. Ours are the instrument; nothing else in the estate is. |
| **ChainDocument** | The signed document that *is* a chain's identity and rules: `id`, `parent`, `headerProfile`, `challenge`, `powLimit`, `addressPrefix`, `magic`, `pegConfirmations`, `refundBlocks`, `pegoutBlocks`, `pegoutMin`, `minFeeRate`, `genesisHash`, `signer` or `signers` plus `threshold`, `rules[]`, and our additions (`trustLevel`, `currencyPin`, `cashOut`, `p21ReceiptUrn`, `closePolicy`, `boundTo`). The aggregate root of chain identity. |
| **Root chain** | `sidestr:dreamlab`: the one long-lived value chain (level 2, k-of-n, one signer key per federated instance) carrying principals and bridged assets. Sole parent of every child chain. |
| **Gitmark chain** | `sidestr:gitmark`: ours, provenance only, level 1, carrying blocktrail anchors and checkpointing into the parent. Carries no value and must never be asked to. |
| **Child chain** | An ephemeral chain nested off the root, opened at session create, carrying a `Close`, and settled back when it closes. Upstream's `ephemeral` note is a design sketch with no code; we specify it. |
| **Signer** | A key authorised by the chain document to seal blocks. Ordering authority only. Derived, per chain, and distinct from every principal's spend key. |
| **Federation** | The signer set of a chain plus its threshold. "We are our own federation" is a statement about who the custodian is, not a claim that there is none. |
| **TrustLevel** | Declared per chain: L1 (one signer, validators trust it for pegs), L2 (k-of-n with a parent view), L3 (rotation and recovery, not built upstream). Mapped onto the ADR-124 L0-L3 ladder by PRD-024, and carried on-seal. |
| **PegIn** | Value entering a chain from its parent: a parent taproot output whose key path is the peg holders and whose script path is the pegger's timelocked refund, marked `pegin:<chain>:<script>`, claimed after `pegConfirmations` by a coinbase payout paired with an adjacent `claim:<txid>:<vout>`. |
| **Claim** | The coinbase act that turns a confirmed peg output into spendable coins on the chain, binding exactly one parent outpoint, exactly once. |
| **Refund path** | `and_v(v:pk(refund), older(refundBlocks))` on an **unclaimed** deposit output: the depositor's unilateral, signer-independent recovery. It is why an unclaimed deposit on a dead chain costs time rather than coins, and it says nothing about anyone else: once a deposit is swept the branch is gone, and a secondary holder's recovery depends on the federation (I14). |
| **Sweep** | The federation's move of a claimed deposit into a confirmed custody output, which extinguishes the depositor's refund branch and is the precondition for issuing supply against it. The sweep, not a child-side map, is what makes claim and refund mutually exclusive. |
| **Finality rule** | The stated condition under which a history is irrevocable and an external release may occur: quorum intersection under a declared fault model, durable vote journalling, view change on proposer death, and a named parent depth per class of action (I25). A checkpoint is evidence of prior existence and is not this. |
| **Protocol profile** | The named, versioned set of consensus rules a chain runs, declared in its document and negotiated rather than assumed. A validator lacking a named rule refuses the chain (I26). |
| **PegOut** | Value leaving a chain: a `Burn` on the chain, then a payment on the parent. At L1 this is the federation's promise; at L2 it is a PSBT co-signing round in which each signer independently re-derives the expected outputs before signing. |
| **Burn** | The chain-side `OP_RETURN pegout:<parent script hex>` output of at least `pegoutMin`, which destroys chain value in exchange for the promise of a parent payment. |
| **Marker record** | The `OP_RETURN` payloads carrying protocol meaning: `pegin:`, `claim:`, `pegout:`, `ckpt:`, `issue:`, `tally:`, and ours, `bridge:`. Consensus-visible bytes, not metadata. |
| **Bridge claim** | The arrival of an external asset as a wrapped asset on one of our chains: an origin-side consignment is validated and held by the bridge, and a wrapped asset is claimed on-chain against it. The RGB integration is this and nothing more. |
| **Wrapped asset** | A chain-native asset whose supply is backed one-for-one by origin-side reserve, identified as `<origin chain id>:<origin asset id>`, generalising upstream's reserved, unbuilt "assets between chains" shape to an RGB origin. |
| **AssetId** | A chain-native asset identifier: the issuing transaction's txid for a locally issued asset, or the origin pair for a wrapped one. Durably identified by a `urn:agentbox:asset:…`. |
| **Tip** | A chain's current height and recent headers, announced as an addressable kind-33333 event with `d` = chain id. A liveness signal, never a source of state. |
| **Mirror** | An HTTP server offering block files. Convenience only: never trusted for correctness, cross-checked against the signer's own tip announcement, and every block replayed locally. |
| **Rule document** | A signed document with an activation height that adds or changes a chain's opt-in rules. Users adopt rules; signers order transactions. Specified upstream (kind 33500), unimplemented upstream. |
| **Close** | A child chain's terminal act: stop accepting blocks at a height or time, pay every holder pro rata in one closing coinbase, peg out the whole peg in the same proportions, and checkpoint the closing hash into the parent as a tombstone. |
| **Tombstone** | The parent-anchored commitment to a closed chain's final state, so a later dispute is settleable from any retained copy after every mirror is gone. |
| **Anchor** | A commitment placed in a chain that later gains proof of work. The permitted word for the blocktrail construction until `AnchorConfirmer` ships a spent-exactly-once check (I11). |
| **SpendAuthorisation** | The binding of a spend to the signed kind-31403 approval of the kind-31402 request that released it. Above the policy threshold, a spend without one is not a spend, it is an attempt. |
| **SettlementReceipt** | The durable record that settlement occurred: URN-identified through `uris.js`, appended to the hash-chained events log, and resolvable. |
| **BalanceView** | A fold over the UTXO set keyed by a pubkey, rendered into a legacy ledger's shape. Read-through, cacheable, stamped with the height it was computed at, and never authoritative (I05). |
| **Spend authorisation threshold** | The configured value above which a `SpendAuthorisation` is mandatory. Below it, policy caps alone apply (`spend-policy.js`). |
| **P21 gate receipt** | The owner-plus-legal build-time sign-off ADR-124 names as the exit criterion for leaving the testnet corner. Here it is a concrete artefact with a URN, cited by any mainnet chain document. |
| **Currency pin** | The on-seal immutable declaration of which currency a chain settles in (`tbtc4` or `btc`). Not runtime configuration: changing it means a new chain. |
| **Parent profile** | The consensus family and network a chain pegs to. Manifest configuration (`agentbox.toml [sidechain]`), defaulted to upstream's, sealed into the chain document (ADR-2103, I23). |
| **Header profile** | The format and proof-of-work hash of a chain's **own** headers, a separate fact from its parent profile and never derived from it (I24). Default `knots:blake2b-v2`, following upstream. |
| **Consignment** | RGB's own transfer artefact. Named here only so we can say it stops at the bridge and never enters this model. |

---

## Aggregates

### ChainDocument (Root)

The consistency boundary of chain identity. Everything a validator needs to decide whether a
block belongs to this chain is inside it, and nothing that changes per block is.

**Identity**: `urn:agentbox:chain:<name>:<genesis hash>`, minted through `uris.js` against the
new `chain` kind (ADR-2098). The `chain` kind is not owner-scoped, since a chain has no owner
(the root belongs to the federation, a child to a session that will end), but it **pins the
genesis hash**, because a name is a mutable-world label and monetary identity cannot be one
(I07). Re-sealing a chain called `sidestr:dreamlab` over a new genesis therefore produces a
different URN, different key-derivation namespaces (I12) and no inherited authority, rather
than silently reusing both. Account bindings, spend approvals, settlement receipts and reserve
references all cite the pinned URN, never the bare name. The `sidestr:<name>` id remains the
bound foreign identifier for the wire.

A wrapped or issued asset class is identified separately by
`urn:agentbox:asset:<scope>:<digest>` (the `asset` kind: owner-scoped to the issuer,
content-addressed over the origin contract id under the bridge rule's namespace), binding an
agentbox URN to a foreign identifier scheme without a second parallel id, which is exactly the
`knowledge` kind precedent at `uris.js:91-94`. The digest is carried in full wherever it
authenticates anything; a 12-hex abbreviation is for display only (I07).

Two kinds, no more. A peg-in or peg-out is an *event* and `receipt`, `activity` and `event`
already cover events. A wallet is a fold over UTXOs keyed by a `did:nostr` that already
identifies it uniquely, so a `wallet` kind would be a second identifier for a thing that has
one.

**Fields** (upstream fields plus ours, marked):

| Field | Type | Notes |
|---|---|---|
| `id` | `sidestr:<name>` | The foreign identifier, the Nostr `d` tag on tip, rule and genesis events. |
| `urn` | `urn:agentbox:chain:…` | Our canonical identity (I07). |
| `parent` | `ParentRef` | Manifest configuration at draft, sealed at genesis. Default `btc:testnet4-blake2b`. A child chain's parent is the root chain's `id`. Immutable on seal (I23). |
| **`headerProfile`** | `HeaderProfile` | **Ours, explicit.** The chain's own header and proof-of-work family, default `knots:blake2b-v2`. Immutable on seal (I23), never inferred from `parent` (I24). |
| `challenge` | script hex plus derivation | L1: `5120<signer pubkey>`. L2: `5120<tweaked output key>` over a NUMS internal key tweaked by the chain id, with a `multi_a(k, ...)` leaf over derived signer keys. |
| `signers` / `threshold` | `[x-only pubkey]`, `k` | One derived signer key per federated instance for the root chain. |
| `pegConfirmations`, `refundBlocks`, `pegoutBlocks`, `pegoutMin`, `minFeeRate` | ints | Peg policy. |
| `rules[]` | names | Opt-in rules. `evm`, `pool` and `desk` are prohibited (I10). |
| `genesisHash` | hash | The genesis block the document commits to. |
| **`trustLevel`** | `L1 \| L2 \| L3` | **Ours.** Declared, not inferred (I09). |
| **`currencyPin`** | `tbtc4 \| btc` | **Ours.** On-seal immutable (I13). |
| **`cashOut`** | `disabled \| enabled` | **Ours.** On-seal immutable. `enabled` requires `p21ReceiptUrn`. |
| **`p21ReceiptUrn`** | `urn:agentbox:receipt:…` or null | **Ours.** The owner-plus-legal gate artefact (I04). |
| **`closePolicy`** | `{height} \| {time} \| null` | **Ours.** Non-null makes this a `ChildChain`. |
| **`boundTo`** | URN or null | **Ours.** The session URN a child chain settles for. |

**Lifecycle**:

```
Drafted -> Sealed -> Live -> Closing -> Closed
              |                            |
              +--> Abandoned (never        +--> Tombstoned
                   sealed; peg refunded
                   via the refund path)

Drafted   : document composed from manifest configuration, signer set agreed, not yet sealed
Sealed    : genesis sealed by the signer set; genesisHash fixed; parent, headerProfile,
            currencyPin and cashOut immutable from here
Live      : producing blocks; pegs claimable; spends settle
Closing   : closePolicy reached; no new blocks accepted past the boundary
Closed    : closing coinbase paid pro rata; whole peg paid out in the same proportions
Tombstoned: closing hash checkpointed into the parent
```

The root chain and the gitmark chain have no `closePolicy` and therefore no path past `Live`.
Retiring either is a migration, not a close, and is out of scope for this document.

### Deposit (formerly PegIn)

**Consistency boundary**: one parent outpoint, its sweep, and the supply issued against it.
Referenced by, not contained in, the `ChainDocument`.

The lifecycle has four stages and the distinction between the first two is monetary, not
bookkeeping:

```
Marked -> Confirming -> Refundable-unclaimed -> Claimed-and-swept -> IssuedLiability -> Redeemed
                                 |
                                 +--> Refunded (depositor took the timelocked branch)
```

- **Refundable-unclaimed.** The deposit sits in a parent output with the depositor's
  timelocked refund branch. It belongs to the depositor. It backs nothing and no supply may
  be issued against it.
- **Claimed-and-swept.** The federation has swept the deposit into a confirmed custody
  output. The depositor's refund branch no longer exists. Only now does the deposit enter
  `customerReserve`.
- **IssuedLiability.** Supply exists on the chain against that reserve.
- **Redeemed.** The liability is discharged by a confirmed parent payment.

**Issuance waits for the sweep to confirm.** This is the whole of the fix for the defect that
a child-chain claim does not spend the parent outpoint: the claim credits a holder while the
depositor's refund branch remains live and spendable, so a depositor can pay a counterparty
on the chain and then reclaim the backing on the parent. No child-side "already claimed" map
can disable a parent script branch. Only the sweep can, so the sweep is the gate (I14). A
deposit nearing refund expiry without a confirmed sweep is refunded rather than minted
against, and a parent reorg that unconfirms a sweep reverses the issuance it authorised.

Claim adjacency remains useful, and it proves less than it appears to. It binds a claimed
amount to one identifier on one history. It does not establish that the parent outpoint
exists, that its amount matches, that its marker names this chain and recipient, that it sits
under the custody descriptor, that it is on the canonical parent branch, or that it has not
been refunded or allocated elsewhere. At L1 a signer can name a fabricated outpoint, place an
arbitrary payout before the marker, and satisfy the structure completely. That is why I02
requires a real parent view **at every level**, and why a child chain is validated against
the root's view: the child's sole signer is the session, and an unchecked session can invent
money and pay a counterparty with it.

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
record on our chain issues or increases wrapped supply for an `AssetId`), `Redeeming`,
`Redeemed` (wrapped supply burned on our chain, origin asset transferred out by the bridge),
`Rejected`.

This is the RGB integration in full. The bridge is an **RGB-aware peg holder**: it receives
and validates a consignment with rgb-lib, holds the origin asset, and claims a wrapped asset
on our chain. No RGB type, no AluVM artefact, no consignment and no client-side validation
crosses into this model. ADR-2102 re-sequences ADR-124's deferred RGB rung for this bridged
case only; the in-chain RGB VM stays where ADR-124 put it.

**The wrapped asset needs its own consensus rule, and upstream's `assets` rule cannot carry
it.** Upstream defines an issued asset's identity as its issuing transaction's txid and lets
outputs carry no more than inputs, so a second deposit cannot increase the supply of the
first deposit's asset: it can only issue a different asset with a different txid. Calling the
two the same thing in an application database does not make them fungible in consensus. The
upstream cross-chain asset draft does not rescue this either, since it tallies to a burn
output and mints in a coinbase, both of which the existing rule forbids.

So the bridge rides a **versioned `bridge` consensus rule, named in the chain document**
(I26), which defines: asset identity as the origin contract id under the rule's own
namespace, held as a full digest and abbreviated only for display (I07); authorised
reissuance, so repeated deposits increase one asset rather than minting a parade of
lookalikes; unique reserve allocation, so one reserve position never backs two issuances;
mint authorisation; redemption records identified by **genesis hash, transaction, output and
asset together**, because a transaction may carry several burns and "paid once" and "one
signature per burn" must agree on the unit; replay protection; and the complete state
transitions. A validator that does not implement the rule refuses the chain. This is original
protocol work requiring implementation and audit, and calling it a marker convention would
understate it.

Two further distinctions the rule must carry. An **ordinary asset destruction is not a
redemption**: upstream lets assets be destroyed simply by omitting them from output tallies,
which carries no redemption destination, and an asset-unaware coin selector can therefore
destroy attached assets by accident. And what a node actually verifies about the origin
reserve is a **bridge attestation**, not independent RGB validation: excluding RGB semantics
from the node makes the attestation necessary, it does not make independent verification
happen.

Redemption is modelled from the outset even though it ships after issuance, because an asset
that can enter and cannot leave is a trap, and a domain that does not name the exit will grow
one ad hoc.

### ChildChain and Close

`ChildChain` is a `ChainDocument` with a non-null `closePolicy` and a non-null `boundTo`,
parented by the root chain. It is the agent-economics primitive: a session opens one at
create, transacts inside it at no meaningful cost, and settles back at close.

The binding happens in `management-api/routes/sessions-boundary.js` at `phase=create`
(`:212-296`), as a fifth binding after the memory namespace (`:259-266`), returning
`chain_urn` alongside `session_urn`, `epic_urn` and `memory_namespace`. It is **fail-open
like every other binding there**: a chain that fails to open adds a note and the session
still starts, it simply cannot spend.

**`Close` is a distinct consensus transition, not a coinbase with exceptions.** Ordinary
rules limit coinbase value to fees plus claims, forbid burns in a coinbase, exclude asset
records from coinbases, and do not consume existing holder outputs. A closing block that
recreated every balance without retiring the prior UTXO set would duplicate monetary state
outright. The transition therefore specifies, and a validator checks, the full set in I03:
UTXO retirement, per-asset entitlements, an authenticated root-chain destination per holder,
fee and dust and rounding treatment, a bounded holder count, and the finality rule.

Two of those deserve their reason stated. **Destinations must be authenticated in advance**
because with per-chain derivation a holder's child script is not their root script: copying
it into a root payout can pay a key the root balance fold never watches, and if session
cleanup destroyed the child key it pays nobody at all. **Assets cannot be pooled** into one
sats-denominated pro-rata figure, so entitlements are per asset or the close is invalid.

`phase=close` triggers settlement; it does not perform it. A rule rejecting blocks after the
close height cannot compel anyone to produce the closing block, a dead session cannot run a
hook, and a lost session key cannot sign a terminal block. Settlement is therefore driven by
a supervisor outside the session process, with a crash-safe state machine and a named
recovery authority, and the four facts of I18 stay separate throughout.

Nothing upstream implements any of this. The `ephemeral` proposal is a design note whose
sketch conflicts with the ordinary rules it would have to live beside. That makes `Close`
the largest piece of original protocol work in this domain, and the one most in need of its
own test corpus, including a dead-session recovery test, before it holds anything.

### SpendAuthorisation

**Consistency boundary**: one spend above the threshold and the decision that released it.

Fields: the spending principal's pubkey, the chain URN, the amount and asset, the task
property triple (`tp-verifiability`, `tp-reversibility`, `tp-stakes` from
`task-properties.js:172`), the kind-31402 request event id, the kind-31403 approval event id,
the approver's pubkey, the expiry, and the resulting transaction id once settled.

The estate already classifies `payment_settlement` as a zero-tolerance authority class, and
`routes/payments.js` has never called `lib/authority.js`: only broker-bridge and
llm-marketplace do. The declared class has therefore been enforcing nothing on the payment
path. This aggregate is where that stops being true (ADR-2100). No new governance mechanism
is required; the machinery covers this end to end and simply is not called.

Colloquy's authorising-principals model is the right shape for the approver side, and PRD-024
should decide whether to reuse it: an operator's fifty agents are one voice, and an
unregistered pubkey is dropped rather than self-authorising. That is precisely the property a
spend gate needs, and it already exists as a published crate.

### SettlementReceipt

**Consistency boundary**: one settlement fact.

Minted through `uris.js` against the existing `receipt` kind, appended to the hash-chained
events log, and resolvable best-effort at `/v1/uri/<urn>`. It cites the chain URN, the
transaction id, the amount and `AssetId`, the counterparties' pubkeys, the
`SpendAuthorisation` URN where one was required, and the height at which it became final.

BC20's existing split applies unchanged: `receipt` deliberately stays agentbox-local and does
not cross the federation boundary, while `activity` and `bead` do. PRD-024 must make the same
call explicitly for settlement receipts rather than inherit it by accident, because a
settlement that crosses instances whose proof does not is a support ticket waiting to happen.

---

## Value Objects

> **Upstream 0.0.2 note (2026-09-21).** sidestr now names parents by alias (SPEC 3.2) and derives the header family from the parent. `HeaderProfile` remains a value object on `ChainDocument` but is derived from `ParentRef` at draft and still fixed at seal; I24's "declared, never inferred" holds at the document level because the alias table, not a loaded overlay, is the declaration. The first seal is `tbtc4` with stock headers.

| Value object | Shape | Rules |
|---|---|---|
| `ChainId` | `sidestr:<name>`, lowercase, no colons in `<name>` | Immutable. The Nostr `d` tag. Bound to exactly one `urn:agentbox:chain:…`. |
| `ParentRef` | `{networkFamily, network}`, or a `ChainId` | `networkFamily` is the parent's consensus family (`btc-knots-blake2b`, `btc-sha256d`, or another the codec supports); `network` is `mainnet`, `testnet4` or equivalent. A `ParentRef` that is a `ChainId` means the chain is nested, and it then inherits nothing: its own `HeaderProfile` is still declared. A `mainnet` network requires I04. Immutable on seal (I23). |
| `HeaderProfile` | An enum naming a whole consensus implementation, not a serialiser: `{powHash, headerLayout, headerBytes, sighash, scriptRules, activation, timestampRule, maturity, blockLimits, signingPreimage}`. | The chain's *own* profile, independent of its parent's. Default `knots:blake2b-v2` at 164 bytes. Carrying it explicitly is what stops the codec inferring one format from the other, which is the coupling upstream's engine has by loading the BLAKE2b overlay unconditionally regardless of parent. Two profiles are two implementations, proven separately and not assumed equally mature (I24). The manifest spelling is `knots-blake2b-v2` and the chain document's is `knots:blake2b-v2`; the projector maps between them and no consumer relies on implicit string equivalence. |
| `PowHash` | an identifier such as `knots:blake2b-v2` or `sha256d` | Names the hash a header is proved against. Never inferred from `ParentRef` (I24). |
| `Challenge` | script hex plus its derivation | L1 key path, or L2 NUMS-internal-key-plus-`multi_a(k,n)` leaf. Carries the derivation, not just the bytes, so a validator can re-derive rather than trust. |
| `TrustLevel` | `L1 \| L2 \| L3` | Declared on-seal. Maps to the ADR-124 ladder. Monotonic: a chain may not be re-declared downward. |
| `KeyRole` | `identity \| spend(chain) \| signer(chain)` | Domain-separated derivation paths (`sidestr/spend/<chain id>`, `sidestr/sign/<chain id>`) over `derive_subkey`. A key is never used outside its role (I12). |
| `OutPoint` | `{txid, vout}` | Parent-side for pegs, chain-side for spends. Equality is structural. |
| `Amount` | unsigned integer, sats | Integer only. No floating point anywhere in this domain, ever. |
| `AssetId` | txid (local issue) \| `<origin chain id>:<origin asset id>` (wrapped) | The two forms are distinguishable by shape and must never be conflated in a balance. |
| `WrappedAssetId` | the second form above | Carries its origin. A wrapped asset that has lost its origin is not fungible with anything. |
| `MarkerRecord` | `{kind, payload}` over `OP_RETURN` bytes | Kinds: `pegin`, `claim`, `pegout`, `ckpt`, `issue`, `tally`, `bridge`. Parsed, never guessed: a malformed marker invalidates its block. |
| `Height` | unsigned integer | Chain-relative. A height without its chain is meaningless and must not be passed alone. |
| `CurrencyPin` | `tbtc4 \| btc` | On-seal immutable (I13). |
| `CashOutPosture` | `disabled \| enabled` | On-seal immutable. `enabled` implies a `p21ReceiptUrn`. |
| `ReserveRef` | `{origin, outpoint, assetId, amount}` | The bridge's held position backing wrapped supply. |
| `ProRataShare` | `{pubkey, numerator, denominator}` | Exact integer arithmetic. Remainder to the peg. |

### The parent and header profiles are configuration (ADR-2103)

Two facts are separate and both are declared rather than inferred. A chain's `ParentRef`
names the network it pegs to and that network's consensus family. Its `HeaderProfile` names
the format and proof-of-work hash of its *own* headers. Upstream conflates them in practice:
`engine.mjs` loads the Knots BLAKE2b overlay unconditionally and `overlay.mjs` gives every
sidechain `powHash: 'knots:blake2b-v2'` from height 0 whatever its parent is, so the
sidechain's header format is in fact independent of `chain.parent` while looking as though it
follows from it. A Rust codec that inherits that coupling will be wrong the first time the
two differ.

Both values come from `agentbox.toml [sidechain]`, are surfaced by onboarding, and
default to following upstream (`btc:testnet4-blake2b`, `knots:blake2b-v2`) so that a chain
sealed with default configuration interoperates with the reference implementation and its
live chains. Choosing a SHA-256d parent, or a mainnet one, is then a configuration decision
with a gate (I04) rather than a fork of the model. Once genesis is sealed both are immutable
(I23): changing either is a different chain, because the genesis hash and every header after
it depend on them.

`sidestr:gitmark` is the existing proof that the two axes are separate in practice: it
checkpoints into a parent whose family is not its own.

### The accounting quantities

The conservation invariants (I01, I01a, I08) are equations over these quantities and no
others. Naming them separately is the point: the earlier formulation, "spendable sats equal
claimed pegs minus burns", is false because it silently merges quantities that move at
different times and belong to different parties.

| Quantity | Definition | Whose |
|---|---|---|
| `circulating` | Base-unit outputs that are spendable at the evaluated height. | Holders |
| `locked` | Outputs that exist but cannot be spent yet: immature coinbase, timelocked or otherwise encumbered. | Holders |
| `pendingDeposit.unclaimed` | Parent deposit outputs confirmed but not yet claimed, still carrying the depositor's refund branch. | The depositor, not us |
| `pendingDeposit.swept` | Deposits claimed and swept into confirmed custody, no longer refundable by the depositor. | Customer reserve |
| `pendingRedemption` | Value burned on the chain whose parent payment has not confirmed. A **liability**, not supply. | Owed to the redeemer |
| `customerReserve` | Confirmed parent outputs under the custody descriptor, held to back holders. | Holders, collectively |
| `operatorFeeCapital` | Separate parent funds, ours, that pay parent fees for sweeps, peg-outs and migrations. | Us |
| `allocatedReserve` | Per wrapped asset: origin units the bridge holds and has allocated to that asset. | Wrapped-asset holders |
| `unallocatedReserve` | Origin units received or freed mid-operation and not yet backing circulating units. | Transitional |

Two rules keep the quantities from double-counting. A parent escrow and its child
representation are never both counted: a deposit is either unclaimed (the depositor's) or
swept (reserve), never both, which is exactly what I14 turns into a protocol rather than a
hope. And a solvency statement always includes `pendingRedemption`, because a redeemer whose
units are already burned is still owed.

All three equations are evaluated **at a settled height** under I25, never "at all times":
between a burn and its parent payment, or between an origin receipt and a mint, the
quantities are legitimately in motion, and an invariant asserted over an instant that has no
agreed history is not testable.

---

## Domain Events

Each event names the carrier that makes it durable. Three sinks, one lifecycle, matching the
DDD-019 pattern: the chain itself is the consensus record, the hash-chained events log is the
tamper-evident audit record, and a Nostr kind is the federated announcement.

| Event | Trigger | Carrier |
|---|---|---|
| `ChainProposed` | A chain document is drafted from manifest configuration and circulated | Internal only; hash-chained events log |
| `ChainSealed` | Genesis sealed; parent, header profile, currency pin and cash-out become immutable | Genesis document, upstream **kind 33501**, `d` = chain id; events log; `SettlementReceipt` |
| `RuleActivated` | A rule document reaches its activation height | Upstream **kind 33500**, `d` = `<chain id>:<height>`; events log. Specified upstream, unimplemented upstream: we implement it. |
| `TipAnnounced` | Producer announces height and recent headers | Upstream **kind 33333**, `d` = chain id, `t` = `sidestr`, `u` = mirrors. Liveness only, never state. |
| `TransactionSubmitted` | A wallet submits a spend | Upstream **kind 23500**, signed with a throwaway key so a spend never links to a persistent identity |
| `BlockSealed` | A block is signed (L1) or a round completes (L2) | Upstream **kinds 23510/23511/23514**; events log |
| `PegInMarked` | Parent transaction with a `pegin:` marker broadcast | Parent chain; events log |
| `PegInClaimed` | Coinbase payout plus adjacent `claim:` marker | The chain; events log; `SettlementReceipt` |
| `PegInRefunded` | Refund script path spent after `refundBlocks` | Parent chain; events log |
| `PegOutBurned` | Chain-side burn at or above `pegoutMin` | The chain; events log |
| `PegOutPaid` | Parent payment with the `pegout:` marker | Parent chain; events log; `SettlementReceipt` |
| `PegOutDefaulted` | `pegoutBlocks` elapsed unpaid | Events log; **new kind (38111)**; alert. Ours: upstream has no such fact. |
| `BridgeClaimValidated` | rgb-lib accepts a consignment and the reserve is confirmed | Bridge-internal; events log |
| `WrappedAssetClaimed` | `bridge:` marker issues or increases wrapped supply | The chain; events log; `SettlementReceipt` |
| `WrappedAssetRedeemed` | Wrapped supply burned and origin asset released | The chain plus origin; events log; `SettlementReceipt` |
| `ChildChainOpened` | A child chain is sealed and bound at `phase=create` | **New kind (38112)**; events log; the session's `LedgerEpic` |
| `ChildChainClosing` | `closePolicy` boundary reached | **New kind (38113)**; events log |
| `ChildChainClosed` | Pro-rata closing coinbase paid; peg paid out in proportion | The chain; events log; `SettlementReceipt` per holder |
| `ChainTombstoned` | Closing hash checkpointed into the parent | Parent `ckpt:` record; **new kind (38114)**; events log |
| `AnchorRecorded` | A blocktrail anchor lands on the gitmark chain | The gitmark chain; `txo[]` in `contract.rs`; DDD-020 owns its meaning |
| `SpendAuthorisationRequested` | A spend above the threshold is attempted | **kind 31402** (ACSP ActionRequest) with the task-property triple |
| `SpendAuthorisationGranted` | A human approves | **kind 31403** (signed approval) |
| `SpendAuthorisationDenied` / `Expired` | Denied or lapsed | Events log; `authority.js:213` deny journal |
| `SettlementRecorded` | Any settlement finalises | `SettlementReceipt` URN; events log; **new kind (38115)** if PRD-024 decides receipts federate |
| `BalanceViewRefreshed` | A legacy view recomputes from the chain | Internal only. Deliberately **not** federated: a view is not news. |

**Kind allocation and carriage.** Upstream's kinds (23500, 23501, 23510-23514, 33333, 33500,
33501, 33502) are a third party's published language, consumed and published as-is and
registered in `docs/PROTOCOL-registry.md` (ADR-2098). 38110 is the account binding (ADR-2098); our five domain events take 38111-38115 from
the free part of agentbox's owned 38000-38201 block, following the ADR-2085 precedent of
allocating inside the block this repo already owns.

Chain traffic rides a **dedicated supervised program on its own relays, outside the identity
relay allowlist** (ADR-2098). Mixing consensus validation into the process holding the
identity key is the key-role conflation I12 exists to prevent, the daemon relay slot is the
ADR-2065 sole writer of the pod inbox and chain traffic has no business there, and chain
validation needs its own restart and failure semantics.

Two upstream hazards are ACL concerns, not ours to fix: kind 33502 is documented as a peg
record and used in code as a desk pledge, distinguished only by `d`-tag shape, so our parser
disambiguates structurally rather than by kind number; and ephemeral kinds are not filterable
by the `chain` tag at a relay, so a producer on a shared public relay downloads every sidestr
chain's traffic of that kind and discards the rest, which is a real scaling constraint and a
further argument for our own relays on this plane.

---

## Invariants

Domain law. Each is stated so it can be failed by a test.

- **I01 Base supply is conserved against custody, at every settled height.** Evaluated only
  at a height final under I25, over the quantities defined in "The accounting quantities"
  above:

  `circulating + locked + pendingRedemption = customerReserve - feesBorneByCustomers`

  where `circulating` counts spendable base-unit outputs, `locked` counts immature coinbase
  and otherwise encumbered outputs, `pendingRedemption` counts burns not yet paid on the
  parent and is a **liability** rather than supply, and `customerReserve` counts confirmed
  swept custody outputs on the parent. Unclaimed deposits are in neither set: they belong to
  their depositor (I14). There is no subsidy and no mint; the only creation of base supply is
  a claim (I02), and the only destruction is a burn. A coinbase collecting more than fees
  plus paid claims is invalid, and one collecting less reduces supply, which the equation
  admits because it counts what exists rather than what was permitted.
- **I01a Parent fees never come out of customer reserve.** The parent fee of a peg-out, a
  sweep or a reserve migration is funded from `operatorFeeCapital`, or from a deduction
  disclosed to the redeeming party before the burn, and never from the reserve backing other
  holders. A peg-out that would reduce `customerReserve` below `circulating + locked +
  pendingRedemption` is refused rather than paid. Upstream's rule of paying the full burn and
  taking the fee from the same reserve makes a fully backed peg insolvent by inspection, with
  no malicious party required, and is not adopted.
- **I02 A claim creates supply only against a verified parent deposit.** Each
  `claim:<txid>:<vout>` marker must be immediately preceded in the coinbase by its payout,
  and the same outpoint may not be claimed at two heights. That structure alone proves
  nothing about backing, so **at every trust level** the claiming validator must additionally
  verify, against a real parent view: that the outpoint exists; that its amount matches the
  payout; that its deposit marker names this chain and this recipient; that it is controlled
  by the required custody descriptor; that its confirmation is on the canonical parent branch
  at the required depth; and that it has not been refunded or allocated to another chain. A
  claim failing any check is refused, never assumed. **A child chain is validated against the
  root chain's view** even though it has a single signer, because that signer is the session,
  and a session that could fabricate claims could pay a counterparty with money it never had.
- **I03 A close is a distinct consensus transition.** A close is not an ordinary coinbase
  with exceptions. The terminal transition must specify, and a validator must check:
  retirement of the entire prior UTXO set, so balances are settled rather than duplicated;
  per-asset entitlements, since wrapped assets cannot be folded into one sats-denominated
  pro-rata figure; an authenticated root-chain destination per holder, recorded before the
  close rather than copied from a child script the root cannot watch; fee, dust and rounding
  treatment with every remainder to the peg and none to a participant; a maximum holder count
  that bounds the transition's size; and the finality rule under which the payout becomes
  irrevocable. A close that leaves a holder unpaid, pools distinct assets, or pays a
  destination nobody can spend from is invalid.
- **I04 Economic exposure requires a P21 gate receipt.** The gate triggers on exposure, not
  only on a mainnet parent. A `ChainDocument` requires a resolvable, complete signed gate
  approval if it names a mainnet network, pins `btc`, enables cash-out, enables any bridged
  asset, carries any claim redeemable for a service or for anything of value, or descends
  from an ancestor that does any of these: **exposure is inherited by child chains and by
  assets, and a child may not exceed its ancestors' permissions.** Sealing without it is
  refused at build time, not warned about at runtime. The sealing procedure is acyclic: a
  canonical policy payload containing no approval reference and no self-referential hash, then
  two separately signed approvals over that payload's digest, then an envelope containing the
  policy and the complete approvals, then the genesis commitment to that envelope, then the
  archival record. Every security-relevant field is committed and tested, not one identifier.
  **"Cash-out" means** any path by which value leaves for something outside the chain:
  peg-out, bridge redemption, close payout, deposit refund, reserve migration, an AMM
  withdrawal, or an exported claim redeemable elsewhere. Where cash-out is prohibited the
  validator rejects the burn, rather than a service layer declining to offer the button.
- **I05 A balance view is never authoritative.** No code path may spend, debit, credit or
  gate on a `BalanceView` without resolving to the chain. Every view carries the height it
  was folded at, and a view whose height is stale beyond its configured bound is an error,
  not a slightly old number.
- **I06 Every spend above the threshold cites a 31403.** A settlement above the configured
  threshold without a valid, unexpired, signed kind-31403 approval of its kind-31402 request
  is refused. The refusal is journalled through `authority.js:213`.
- **I07 No ad-hoc URN, and monetary identity is the genesis hash.** Every durable identifier
  this domain emits is minted through `management-api/lib/uris.js`, using exactly the
  `chain`, `asset` and existing `receipt` kinds. Hand-built URN strings are prohibited, per
  ADR-013. Further: **a chain's name is never its monetary identity.** The `chain` URN pins
  the genesis hash, and every account binding, spend approval, settlement receipt and reserve
  reference cites that pinned URN. Reusing `sidestr:dreamlab` for a new genesis therefore
  produces a different chain URN, different derivation namespaces (I12) and no inherited
  authority. An `asset` identity is the **full digest** of the origin contract id under the
  bridge rule's namespace; the 12-hex form is a display abbreviation and may never
  authenticate an asset, because collisions become plausible around 2^24 identifiers and the
  assets in question are externally valuable.
- **I08 Wrapped supply is conserved against allocated reserve, at every settled height.** For
  each `WrappedAssetId`, evaluated only at a height final under I25:

  `wrappedCirculating + wrappedPendingRedemption = allocatedReserve`

  where `allocatedReserve` counts origin units held by the bridge and **allocated to this
  asset**, and `wrappedPendingRedemption` counts units burned on our chain whose origin
  release has not completed and which remain a liability of the bridge. Surplus reserve
  arising mid-operation (origin received before minting, burned before releasing) is held as
  unallocated and is not circulating backing. Issuance requires a validated consignment and a
  confirmed, uniquely allocated reserve position; the same reserve position may never back
  two issuances. Redemption burns before it releases, never after, and the burn must be final
  under I25, bound to one asset and one recipient, incapable of authorising a second release,
  and durably recorded before any retry. A process boundary supplies none of this; only the
  rule of I26 does.
- **I09 Trust level is declared, never inferred.** Every chain document carries an explicit
  `trustLevel`, every surface that shows a balance shows it, and it may not be re-declared
  downward. A chain carrying value belonging to more than one principal may not be L1.
- **I10 No `evm`, `pool` or `desk` rule.** None may appear in any chain document we seal
  (ADR-2096). PRD-015 C11's rejection of a native EVM rail stands; the pool rule is a bare
  centralised-sequencer AMM whose front-running the signer cannot mitigate and we will not
  be that signer; the desk rule depends on an unmerged parent change and is paused even
  upstream. Enforced at seal time.
- **I11 Seal terminology is gated.** The phrase "single-use seal" may not be used in code,
  documents or interfaces for any construction in this domain until `AnchorConfirmer` ships
  a spent-exactly-once check, per ADR-124 §2.3 and ADR-2099. "Anchor", "peg", "claim" and
  "marker" are the permitted words.
- **I12 Custody roots are independent of the identity root.** Domain-separated derivation is
  necessary and not sufficient: HMAC protects a parent from a compromised child, never a
  child from a compromised parent, so deriving a signer key from an identity root that a
  session can read isolates nothing. Therefore the **federation signer root** and the
  **bridge custody root** are independent seeds, generated separately, held by their own
  service accounts, and never derived from `k_id`, which is agent-accessible by construction
  (`identity.env` is sourced into every supervised programme). A session's `k_spend` derives
  from **that session's own key**, not from the operator identity root. Derivation namespaces
  bind the protocol version, the chain genesis hash (or, before genesis exists, a pre-genesis
  identity commitment), the role and the epoch, so a rebuilt chain under a reused name never
  reproduces a key. A generic "sign this payload" port recreates the custody authority these
  roots exist to divide and is prohibited: each signing service authenticates its caller and
  admits only an enumerated set of derivations and operations. Amends ADR-033.
- **I13 The currency pin is immutable on seal.** `currencyPin` and `cashOut` are fixed when
  genesis is sealed and cannot be changed by configuration, rule document or redeployment.
  Changing either means a new chain with a new genesis.
- **I14 The refund path protects unclaimed deposits, and nothing else.** Every *unclaimed*
  deposit output carries `and_v(v:pk(refund), older(refundBlocks))` under the depositor's own
  key, and a deposit output whose only spend path is the federation's is prohibited. The
  guarantee stops there, and the domain says so in every surface that mentions it: **once a
  deposit is claimed and swept into custody, the depositor's refund branch no longer exists,
  and a secondary holder's recovery depends on the federation.** Claiming on a child chain
  does not spend the parent outpoint, so the two states must be made exclusive by the sweep
  and not by assertion: issuance waits for the sweep to confirm to the required depth (I02),
  which is what prevents one deposit both backing a circulating claim and being refunded by
  its depositor. A deposit approaching refund expiry without a confirmed sweep is refunded,
  never minted against. A parent reorg that unconfirms a sweep reverses the issuance it
  authorised. "A dead chain costs time, not coins" is true of unclaimed deposits and is not
  said of anything else.
- **I15 Every settlement emits a receipt.** Every terminal settlement event mints a
  `SettlementReceipt` through `uris.js` and appends to the hash-chained events log. An
  unreceipted settlement is a defect, not an optimisation.
- **I16 One ledger of record.** Writes to the three legacy ledgers as sources of truth are
  prohibited once their chain projection is live. They become read-through folds or they are
  removed. Two authoritative balances for one pubkey is the defect this domain exists to end.
- **I17 Assets do not leave through the sats peg.** A burn is of sats only. A wrapped or
  issued asset leaves only through its own bridge redemption or a child chain's close.
- **I18 Session closed, child closed, payout confirmed and tombstone published are four
  facts, never one.** Each is tracked separately and none implies another. Opening is
  fail-open: a session whose chain fails to open still starts and simply cannot spend.
  Closing is not a session hook's to guarantee, because a dead session cannot run one and a
  lost session key cannot sign a terminal block: **settlement is supervised by a process
  outside the session**, with a crash-safe state machine and a named recovery authority able
  to drive a close when the session cannot. A child chain outliving its session is that
  supervisor's work item, not an alert somebody reads. No holder is told they have been paid
  before the parent payout is confirmed under I25, and no chain is treated as historically
  settled before its tombstone is published and its closing state is retained by someone: a
  checkpoint hash is not the closing state, and a holder without the history cannot
  reconstruct an entitlement from a tombstone alone.
- **I19 Settlement fails closed.** No gate on the settlement path may fail open on backend
  unreachability, and the spend budget is durable rather than in-process.
  `cost-gate.js`'s current fail-open default and `spend-policy.js`'s in-memory daily budget
  are acceptable for a sats micro-debit and prohibited here, because "backend unreachable"
  can mean "cannot tell whether this was already spent" and a cap that resets on restart is
  not a cap (ADR-2100).
- **I20 Nothing is trusted from a mirror or a relay.** Every block is replayed locally
  through the kernel; every inbound event's Nostr signature is verified before use; a mirror
  may lag the signer's announced tip but may never lead it.
- **I21 Integer arithmetic only.** Amounts, shares, fees and pro-rata arithmetic are exact
  integers. Any rounding is in the chain's favour, never a participant's.
- **I22 The nsec never enters this domain.** Signing and subkey derivation happen behind the
  identity port. This domain hands over payloads and receives signatures and public keys.
- **I23 Parent and header profile are immutable on seal.** `ParentRef` and `HeaderProfile`
  are read from manifest configuration when a chain document is drafted and fixed when
  genesis is sealed. No rule document, configuration reload or redeployment may change
  either. A chain whose configured parent no longer matches its sealed document is a
  misconfiguration to refuse loudly, never a chain to re-parent. A `ParentRef` naming a
  mainnet network additionally requires I04.
- **I24 Header profile is declared, never inferred from the parent.** A chain's own `powHash`
  and header layout are taken from its document. Deriving them from `ParentRef`, or from
  whichever overlay happens to be loaded, is prohibited. A header profile names a whole
  consensus implementation and not a serialiser: sighash construction, script rules,
  activation and timestamp semantics, coinbase maturity, block limits and the BIP-325 signing
  preimage all belong to it, and two profiles are two implementations to be proven
  separately. The manifest spelling `knots-blake2b-v2` maps to the chain document's
  `knots:blake2b-v2` **in the projector alone**; no consumer relies on implicit string
  equivalence between the two schemas.
- **I25 Quorum safety is a fault model, not a count.** A threshold is not a consensus
  protocol. For a signer set of `n` tolerating `f` Byzantine members, any two quorums must
  intersect in at least one honest member, so `k > (n + f) / 2`, equivalently `2k - n > f`.
  A chain carrying value states its `f` explicitly and satisfies that inequality; `n - k` is
  an availability figure and may never be quoted as fault tolerance. A signer signs at most
  **one** proposal per height, full stop: upstream's relaxation of that rule after a timeout
  is rejected, because absence of an announcement does not prove a signer's earlier signature
  was never assembled, and a delayed certificate plus a later one is two valid conflicting
  histories. Liveness after a dead proposer comes from a view change, not from re-signing.
  Every vote and every parent peg-out payment is durably journalled **before** it is
  published, so a restarted signer cannot equivocate by forgetting. No external release
  (a bridge release, a peg-out payment, a merchant's irreversible delivery, an anchor treated
  as final) may occur before the stated finality rule is met, and that rule names the parent
  depth required for each class of action. Checkpoints prove that a history existed before a
  parent block; they do not select between conflicting histories and are not a finality rule.
- **I26 A consensus extension is declared, versioned and negotiated.** Every rule that changes
  validity, which includes the header profile, the bridge rule, the close transition and the
  cash-out restriction, is named in the chain document as part of a versioned protocol
  profile with mandatory feature negotiation. A validator that does not implement a named
  rule **refuses the chain** rather than following it partially. No field that changes
  validity may be described anywhere as an addition a conformant validator ignores.

---

## Context Map

| Relationship | Neighbour | Pattern |
|---|---|---|
| **Conformist, with an ACL** | sidestr upstream (spec, kinds, marker grammar, block signature) | Their wire language, their kind numbers, their marker bytes. We conform exactly so our chains interoperate with the reference implementation, and translate at the edge. Our additions are extra chain-document fields a conformant validator ignores, never repurposed fields of theirs. |
| **Partnership, first-class** | Gitmark and blocktrails anchoring (DDD-020 / BC23, ADR-059, ADR-128, `git-mark.com`) | **`sidestr:gitmark` is the estate's own product, not an upstream example.** It is a chain this domain seals and produces, carrying a trail of tweaked taproot outputs the anchoring context owns, checkpointed into the parent so the parent's proof of work bounds when a mark was made. Two contexts, one chain: settlement owns the `ChainDocument`, the peg and the receipts; anchoring owns the trail, the tweak chain and what a mark means. They meet at the `ckpt:` record and the `txo[]` seam in `contract.rs:139`, and nowhere else. ADR-128's "adopt verbatim, no parallel design" precedent binds the anchoring scheme, not the chain beneath it. |
| **Customer-Supplier (we are the customer)** | DDD-003 Sovereign Messaging | Supplies `did:nostr`, signing, subkey derivation and the relay plane. We supply payloads, never keys. |
| **Customer-Supplier (we are the customer)** | GOVERNANCE-capabilities, `lib/authority.js`, `task-properties.js` | Supplies the 31402/31403 decision that releases a spend, and the task-property triple. We own the binding of decision to spend, not the decision. |
| **Published Language** | ACSP kinds 31402/31403 | The estate's existing approval grammar, consumed unchanged for `SpendAuthorisation`. |
| **Anti-Corruption Layer** | rgb-lib and the RGB ecosystem | An isolated bridge service behind a process boundary. rgb-lib, rust-bitcoin and bdk live there; no RGB type reaches our model. This also contains the rgb-protocol versus RGB-WG ecosystem split, which is two divergent codebases sharing a name. |
| **Anti-Corruption Layer** | solid-pod-rs `WebLedger`, VisionClaw `FsPaymentStore`, nostr-bbs D1 ledger | A view adapter per ledger. They keep their shapes and HTTP contracts; the numbers inside become folds. Sibling records: solid-pod-rs ADR-2008, host ADR-2111, forum ADR-2012. |
| **Customer-Supplier (we are the supplier)** | BC20 URI federation, `docs/PROTOCOL-registry.md` | We supply the `chain` and `asset` URN kinds and the registered sidestr Nostr kinds. The existing receipt-stays-local, activity-and-bead-cross split is the precedent to follow or explicitly deviate from. |
| **Partnership** | DDD-019 Interaction Plane | A `ChildChain` binds at `sessions-boundary.js` `phase=create` (`:212-296`) and settles at `phase=close` (I18). Shared lifecycle, two aggregates, neither owning the other. |
| **Separate Ways, for now** | DDD-006 LLM Marketplace (barter, kinds 38300-38305) | A second value system exists. Absorbing it is a PRD-024 decision, deliberately not taken here. Becoming a *third* parallel value system is the failure mode to avoid. |
| **Shares pattern, not code** | DDD-021 Typed Decisions (BC24), the Ontology Loom | The published-client and stable-façade patterns are reused: one crate owns the protocol types, every caller depends on it, no caller hand-rolls a subset. |
| **Consumes geometry** | DDD-016 Memory-Learning | Operational state and search only. A balance never lives in memory. |
| **Customer-Supplier (we are the supplier)** | solid-pod-rs payments context | We supply the chain; it supplies the existing `/pay/*` routes, order book and AMM, which become chain-settled or are retired. Its hand-rolled BIP-341 on raw k256 is ported to rust-bitcoin in the same programme, which is what retires the k256-only posture (ADR-2096). |
| **Conformist** | VisionClaw web-contracts (TrustLevel L0-L3, GitMark, Blocktrails) | We conform to the existing trust-level vocabulary rather than mint a parallel one, and map L1/L2/L3 onto it explicitly in PRD-024. |
| **Customer-Supplier (we are the customer)** | Colloquy forum ACSP governance (`colloquy-core`, authorising principals) | Candidate supplier of the approver-side principal-collapse model for `SpendAuthorisation`. Reuse decision belongs to PRD-024. |
| **Upstream we do not control** | Bitcoin, in whichever family the `ParentRef` names | Read-only parent view. |

---

## Anti-corruption layers

Three, each guarding a different kind of foreignness.

**1. The sidestr sidecar (foreign implementation).** The upstream `siding` producer and
signer are AGPL-3.0 JavaScript by a single author on a repository created six days before
this document, whose own specification says field names, kinds and document shapes are
provisional. We run it as a container-internal sidecar for block production while the Rust
implementation reaches parity, and never link it. The boundary has four rules, mirroring
DDD-021's treatment of the Jev protocol:

1. *Conform on the wire, own the model inside.* One Rust crate owns `ChainDocument`,
   `PegIn`, `PegOut`, `MarkerRecord` and the rest as domain types; serde renders them into
   sidestr's shapes at the edge. Nothing inside reasons in upstream JSON.
2. *Our additions are a named, versioned protocol profile, not ignorable metadata.* The
   earlier framing, that a conformant validator may ignore our fields, was wrong and is
   withdrawn: `headerProfile` determines which header format is even parseable, `cashOut`
   determines whether a burn is valid, `closePolicy` determines whether a post-close block is
   valid, and the bridge rule determines whether an issuance is valid. Those are consensus
   forks wearing the clothes of metadata. The profile is declared in the chain document,
   carries a version, and requires **mandatory feature negotiation**: a validator that does
   not implement a named rule refuses the chain rather than following part of it (I26). We
   still never repurpose an upstream field. What we no longer claim is that a chain of ours
   is safely readable by a validator that does not implement our rules.

   Compatibility is therefore stated per chain rather than asserted globally. A chain that
   names no local rule, seals with the default profile and runs plain upstream consensus is
   interoperable with upstream implementations; that is the arm the fixtures exercise. The
   root chain, once it carries a bridge rule and a cash-out restriction, and every child
   chain carrying a close transition, require our validator and say so in their documents.
3. *Their implementation is non-normative for our behaviour.* Recorded upstream blocks and
   events are golden fixtures our codec must round-trip byte-exactly. Where their prose and
   their code disagree, which is already true in at least three places (kind 33502's double
   use, the shipped `chain.json` files carrying empty `pegs` that `open()` cannot rebuild
   genesis from, the witness slots being in reverse leaf order with no specification text),
   the fixture wins for compatibility and our specification wins for behaviour.
4. *Translation failure is loud.* A document we cannot represent is refused at the boundary.
   The translation layer never repairs, defaults or infers a field into existence.

The licence boundary is part of this ACL and is load-bearing (ADR-2096): the AGPL sidecar is
a separate process; the publishable Rust crates are clean-room from the specification under a
permissive licence per ADR-2030; the two never share a crate graph. No canon record of this
tension existed before this work, so PRD-024 introduces it as a new, blocking constraint
rather than a footnote.

**2. The RGB bridge service (foreign trust model).** rgb-lib, rust-bitcoin and bdk live in
one isolated service behind a process boundary. It receives a consignment, validates it,
confirms the reserve, and emits exactly one domain fact: `BridgeClaimValidated` with a
`ReserveRef`. No consignment, schema, contract id or AluVM artefact crosses outward. This is
what makes ADR-124's sharpest objection tractable: rgb-core conflicts with the k256-only,
zero-rust-bitcoin-dependency posture, and the resolution is not to win that argument but to
put the dependency where the posture does not reach. Accepting rust-bitcoin into the estate
is a separate, deliberate decision (ADR-2096) whose first beneficiary is replacing
solid-pod-rs's hand-rolled BIP-341 sighash on raw k256, which house rules already make the
highest-priority port.

**3. The WebLedger view adapter (foreign shape).** Each of the three ledgers keeps its API
and document shape; a per-ledger adapter folds the UTXO set and serves the result with the
height it was computed at. Nothing downstream changes its requests. This is the migration
mechanism, and it is what allows I16 to be reached without a flag day.

---

## Repositories and ports

| Port | Direction | Counterpart | Contract |
|---|---|---|---|
| `ChainDocumentRepository` | Both | Durable store plus kind-33501 genesis | Load by `ChainId` or URN; persist a sealed document; never mutate a sealed one. |
| `BlockStorePort` | Both | Local block files, cross-checked against mirrors | Append, read by height, replay. Mirrors are convenience; every block is replayed (I20). |
| `ParentViewPort` | Outbound | A node for the chain's sealed `ParentRef` | Headers, marker scanning, peg output confirmation, broadcast. Required at L2. One implementation per `networkFamily`; selecting the wrong one is a refusal, not a retry. |
| `ProducerPort` | Outbound | The signer or the level-2 round | Seal a block, or propose and collect partials. Implemented first by the AGPL sidecar, then by the Rust producer at parity. |
| `RelayPort` | Both | The dedicated chain-traffic program's relays | Publish and subscribe for the kinds above, outside the identity relay allowlist (ADR-2098). |
| `IdentityPort` | Outbound | `lib/agent-identity.js`, `derive_subkey` | Public keys and signatures for the `spend` and `signer` roles. The nsec never crosses (I22, I12). |
| `UriMintPort` | Outbound | `lib/uris.js` | Every durable identifier (I07): the `chain` and `asset` kinds, and `receipt`. |
| `AuthorityPort` | Outbound | `lib/authority.js`, `task-properties.js`, `governance-receipt-publisher.js` | `payment_settlement` zero-tolerance class: emit a 31402 with the task-property triple, await a 31403, journal a denial, mirror the outcome. Fails closed (I19). |
| `EventsPort` | Outbound | ADR-005 events slot | Hash-chained append of every event above; verified at `/v1/system/audit-chain`. |
| `ReceiptPort` | Outbound | `receipt-minter.js`, `uris.js` | Mint and resolve `SettlementReceipt` (I15). |
| `BridgePort` | Outbound | The isolated RGB bridge service | `validateConsignment`, `allocateReserve` (atomic across bridge instances), `attestReserve`, `release` (idempotent, durably recorded before retry). Returns domain facts only, and what it returns about the origin reserve is an **attestation**, not independent verification (I08). |
| `BalanceViewPort` | Inbound | The three legacy ledgers | Fold the UTXO set for a pubkey at a height. Read-only by construction (I05). |
| `SessionBoundaryPort` | Inbound | `routes/sessions-boundary.js` `phase=create` (`:212-296`) and `phase=close` | Open, fund and bind a child chain; close and settle it. Fail-open on open, never silent on close (I18). |
| `Pay402Port` | Inbound | `lib/pay402.js` closed-grammar classifier | A fourth `sidestr` scheme result, which is an ADR-032 revision plus captured fixtures (ADR-2097), never a runtime extension point. |
| `AnchorPort` | Outbound | `services/nostr-pod-bridge/src/contract.rs:139` | Supply the gitmark-chain outpoint that populates `txo[]`. DDD-020 owns what the anchor means (ADR-2099). |
| `ManifestGatePort` | Inbound | `agentbox.toml [sidechain]`, `system-manifest.js`, onboarding | One gate, off by default, byte-identical when off, with an honest apply class per ADR-039. Supplies `ParentRef` and `HeaderProfile` defaults at draft time and nothing at all after a seal (I23). |

---

## What this domain explicitly does not model

- **EVM.** No chain we seal names the `evm` rule (I10). One private key producing an Ethereum
  address is a property of the upstream wallet, not a capability we expose. PRD-015 C11
  stands.
- **The pool and desk rules.** The pool rule's front-running is acknowledged and unmitigated
  upstream, and running it makes us the sequencer who could front-run, which is a
  legal-product-class question as much as a technical one. The desk rule depends on an
  unmerged parent change and is paused even on its own chain.
- **Lightning.** Not a rail, not a dependency, not a planned phase. PRD-015 C10 and ADR-032
  D5's Lightning-first position are superseded (ADR-2097). NWC and L402 are not built.
  Lightning may return only as an optional bridge on-ramp, modelled then as another
  `BridgeClaim` origin, never as the instrument.
- **Custodial routers, exchanges and cash-out.** No fiat ramp, no order routing to a third
  party, no withdrawal to an external custodian. `cashOut: disabled` is the default and
  changing it requires I04.
- **RGB contract semantics.** Schemas, state transitions, consignment validation, AluVM. All
  of it stays in rgb-lib behind the process boundary, and none of it is re-implemented.
- **Client-side validation as a chain property.** Our chains validate in consensus, by every
  node. That is the opposite of RGB's premise, and the difference is the reason a bridge
  exists rather than a merger.
- **Trust-minimised peg-out.** Drivechain and spacechain style parent-enforced pegs are out
  of scope upstream and out of scope here. We are a custodian at L1 and a k-of-n custodian at
  L2, and I09 makes us say so.
- **Signer set rotation and recovery.** Upstream's L3 is unbuilt and has no resharing
  ceremony: a new signer set requires manually moving peg funds by an old-set-authorised
  peg-out. We model L3 as a declarable level and nothing more until that exists.
- **What an anchor means.** The gitmark chain is ours; the trail on it, its tweak chain and
  its interpretation belong to DDD-020.
- **A hard-coded parent or header profile.** Neither is excluded and neither is assumed: both
  are configuration this domain reads and seals (ADR-2103). What is not modelled is any
  parent's own consensus.
- **Pricing, markets and the barter economy.** DDD-006's grants are a separate system.

---

## Migration of the three ledgers

The precondition is a decision, not code: the chain is the ledger of record (ADR-2099). What
follows is the sequence that makes it true without a flag day.

**Phase 0, before anything settles.** Implement the P21 gate (I04): the on-seal parent,
header profile, currency pin and cash-out posture, and the owner-plus-legal receipt. This
lands first because it is the only control preventing the rest of the programme from quietly
becoming a mainnet money service, and it should not land in the same change as the code that
makes that tempting. Reconcile VisionClaw's empty `extraction/solid-pod-rs` vendor mirror and
the version skew (VisionClaw pins 0.4.0-alpha.15, nostr-bbs pins 0.5.0-alpha.7) so all three
consumers can move together.

**Phase 1, the chain exists and is empty.** Seal the root chain at L2 on the configured
parent, one derived signer key per federated instance. Defaults follow upstream, so the first
sealed chain interoperates with the reference implementation and its live chains, and the
`[sidechain]` block plus its onboarding surface ships with it. Nothing settles yet.
The Rust validator reaches byte-exact round-trip parity against upstream fixtures **for both
header profiles**, which is the cheapest moment to prove `ParentRef` and `HeaderProfile` are
genuinely independent rather than to discover later that the codec inferred one from the
other. The AGPL sidecar produces blocks. The `chain` and `asset` URN kinds ship. Port
solid-pod-rs's hand-rolled BIP-341 to rust-bitcoin in the same phase, because that code is
about to become load-bearing for real value.

**Phase 2, views before writes, and reconciliation before any writer is disabled.** Each of
the three ledgers grows a read-through fold behind its existing API: solid-pod-rs's
`WebLedger`, VisionClaw's `FsPaymentStore`, nostr-bbs-pod-worker's D1 table. Both numbers are
computed and compared, and divergence is logged, for a stated observation period. Nothing
downstream changes its requests.

The cutover criterion is **reconciliation of the actual obligations**, not a sample. Every
non-zero balance, every outstanding hold or reservation, and every unsettled obligation in
each store is enumerated, matched to its chain-side counterpart, and signed off, with a
documented treatment for each item that does not match. Sampling a set of DIDs, or observing
that a population of empty accounts agrees, tests the fold's plumbing and says nothing about
whether anyone is owed anything. No legacy writer is disabled before its own reconciliation
passes, and the rollback boundary, the point after which returning to the legacy store stops
being possible, is written down before it is crossed. VisionClaw's `FsPaymentStore` goes
first because its reconciliation is genuinely trivial: `.deposit` is a 501 stub, so there is
no legitimate value in it, which is a fact to be verified once rather than assumed.

**Phase 3, the chain becomes the source.** Peg in, and the folds become the only answer. The
legacy stores stop being written as sources of truth (I16). solid-pod-rs's MRC20 deposits and
its AMM are the hard case, since they hold the only real value movement in the estate today
and are non-atomic by the README's own admission: they either become chain-settled or they
are retired, and PRD-024 must choose rather than let them persist as a fourth system.

**Phase 4, the new rail and the gate.** `pay402.js` gains the `sidestr` scheme with its
ADR-032 revision and captured fixtures (ADR-2097). `SpendAuthorisation` is wired, which means
`routes/payments.js` calls `lib/authority.js` for the first time and the declared
`payment_settlement` class starts enforcing something (ADR-2100). `spend-policy.js`'s daily
budget moves into durable state and `cost-gate.js` fails closed on this path (I19). The
blocktrail `txo[]` seam opens onto the gitmark chain (ADR-2099), and because an anchor on our
own chain has an exactly-known spent status, `states.len() == txo.len()` becomes checkable
rather than asserted.

**Phase 5, child chains.** The `ChildChain` and `Close` implementation, its own test corpus,
and the binding at `sessions-boundary.js` `phase=create` (`:212-296`) and `phase=close`
(I18). This is late because it is the most original work and the least derisked by upstream.

**Phase 6, the bridge.** The isolated RGB bridge, issuance before redemption in code but both
in the model (ADR-2102). USDT-on-RGB is not confirmed live as of this date: the Tether
announcement is from August 2025 and the UTEXO-led rollout was described in July 2026 as
realistic but not committed. The bridge therefore ships against a generic RGB20 origin and
treats USDT as one instance, so a slipping third-party launch delays a configuration, not an
architecture.

Throughout: five adapter slots, no sixth (ADR-2085 precedent). Settlement consumes the
`events` and `memory` slots and the management API's existing surfaces. It does not become a
sixth durable-state adapter, and PRD-024 says so explicitly, because a financial substrate is
exactly the sort of capability that feels like it deserves its own slot.

---

## Open modelling questions

1. **Does a `SettlementReceipt` cross BC20?** The existing precedent splits: `receipt` stays
   agentbox-local by design, `activity` and `bead` cross. A settlement between two federated
   instances whose proof does not cross is awkward; a receipt that crosses weakens the
   "agentbox-local proof" stance. PRD-024 must choose, and the choice is a kind-mapping
   decision with an ADR.
2. **One root chain, or one per federated instance?** ADR-2101 says one root, each instance
   holding a derived signer key. That makes every instance a co-custodian of every other's
   value, which is a strong statement about a federation that may include instances we do not
   operate. The alternative, one chain per instance nested under a DreamLab root, pushes the
   inter-instance settlement problem into the peg, which is where it is at least modelled.
3. **What is the threshold for I06, and is it per chain, per principal or per asset?** A
   single global sats figure is wrong for a wrapped USD asset. The natural answer is per asset
   with a per-principal multiplier, but that is policy this domain consumes rather than owns.
4. **Does the approver model reuse Colloquy's authorising principals?** The "fifty agents are
   one voice" property is exactly right for a spend gate and already published as a crate. The
   cost is a dependency from the settlement path onto the forum's model.
5. **Does a child chain need its own peg, or can it be internally funded?** Nesting a child
   under the root rather than under Bitcoin makes its funding transaction a root-chain
   transaction, which is nearly free, and that is almost certainly right. It means the refund
   timelock compounds down the nesting, which needs stating and bounding.
6. **What bounds recovery when a parent stalls?** The refund timelock counts confirmed blocks
   of the relevant parent, so a stalled root freezes every child's refund clock, while a
   stalled external parent with a live root lets children settle into root claims that cannot
   be externally redeemed. Those are two different failure modes and neither has a wall-clock
   bound without guaranteed parent progress, so adding refund periods together is not an
   answer. Needed: a maximum nesting depth, heartbeat requirements per layer, the expiry
   relationships between layers, settlement margins, who advances each chain during recovery,
   and which layer holds a claim after each transition.
7. **Do we operate a gitmark signer or consume the existing one?** An operational question for
   the phase that opens the `txo[]` seam, not an architectural one. Consuming costs nothing;
   operating buys control of the anchor cadence.
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
11. **Does a child chain inherit its root's header profile, or choose its own?** I24 says the
    value is declared, not inherited, but it does not say a child may *differ*. Letting it
    differ means the producer runs several codecs at once; forbidding it makes one field on a
    child decorative. A defaulted-from-parent-but-declared rule is probably right and should be
    stated either way.
12. **Which parent profile does the root chain actually seal with?** ADR-2103 makes it
    configuration defaulting to upstream's Knots BLAKE2b testnet4, which buys interoperability
    with the reference implementation's live chains. A SHA-256d parent buys widely-verified
    proof of work and a straightforward path to mainnet under I04. This is now a configuration
    decision with a default rather than an architectural one, but it is still a decision, and
    sealing is irreversible (I23).
13. **What is the `Defaulted` peg-out remedy?** We model the fact. We have not modelled the
    consequence, and at L2 with our own federation the honest answer may be "an operational
    alert and a manual payment", which should be written down rather than discovered. L2
    lets a validator *detect* an unpaid burn; it does not make the federation's keys sign,
    so upstream's claim that L2 trusts signers for nothing about pegs is not inherited.
14. **What is the declared fault model, and does the signer set satisfy it?** I25 fixes the
    inequality; it does not choose `f`. Choosing it requires deciding how independent the
    operators, credentials, release channels and parent nodes actually are, since five
    signers rebuilt from one image by one operator are not five fault domains. "At least
    3-of-5" selects a number before selecting a model, and under `2k - n > f` it tolerates
    exactly zero Byzantine signers.
15. **What is the child chain's participant set and permitted activity?** A child is L1 by
    topology, yet I09 forbids L1 value belonging to several principals and a close pays
    several holders. The moment a child pays an external counterparty, those collide. Either
    children are single-principal with counterparties settling on the root, or children are
    not L1. This must be decided before a child pays anyone.
16. **Which chain is the authoritative anchor destination, and what makes an anchor final?**
    The gitmark chain and the root chain are both proposed in different places. Beyond that,
    conflicting histories can both be checkpointed, `OP_RETURN` publication is permissionless
    so a marker does not prove an authorised custodian endorsed it, and `states.len() ==
    txo.len()` proves equal lengths rather than a bijection. Needed: which publications are
    authoritative, which checkpoint governs when valid conflicting ones exist, what parent
    depth each external action requires, and what happens when a checkpoint is reorganised
    out.
17. **What is the replay-splitting procedure across header families?** Refusing pre-fork
    UTXOs is insufficient: a pre-fork coin spent after the fork to a fresh peg address can be
    replayed onto the other branch, giving an identical post-fork outpoint on both. Distinct
    family-specific descriptors, fork-exclusive funding or an explicit coin-splitting
    procedure, exact per-input sighash checks and tests over replayed post-fork descendants
    are all required before a second family carries value.
18. **How is the eight-way parent and profile matrix reduced?** Four parent selections times
    two child profiles, before differing root and child profiles and protocol epochs. A
    smaller test matrix needs justified equivalence classes, and the SHA-256d arm currently
    has no live upstream chain to prove against, so a locally minted chain is implementation
    testing rather than an independent oracle.
19. **What replaces the signer set after compromise or loss?** Reserve migration that requires
    the lost quorum is not recovery. Rotation, emergency exit and the case of an operator who
    cannot be reached are unmodelled, and upstream has no resharing ceremony to inherit.

---

## References

- PRD-024, [`docs/proposals/sovereign-settlement.md`](../proposals/sovereign-settlement.md)
- The adversarial review this document was amended against:
  [`sovereign-settlement-research/REVIEW-adversarial-gpt6-astra.md`](./sovereign-settlement-research/REVIEW-adversarial-gpt6-astra.md).
  F1 drives I25, F2 drives I14 and the deposit lifecycle, F3 drives the bridge rule and I08,
  F4 drives I03 and I18, F5 drives I01/I01a and the accounting quantities, F6 drives I12,
  F8 drives I04, F9 drives I26. F7 (the approval digest) belongs to ADR-2100 and is not
  restated here.
- ADR-2096 to ADR-2103 in [`docs/adr/`](../adr/); siblings: solid-pod-rs ADR-2008, host
  ADR-2111, nostr-rust-forum ADR-2012, VisionFlow canon ADR-2012
- ADR-013 canonical URI grammar; `management-api/lib/uris.js:69-97`
- ADR-032 402 scheme grammar (revised by ADR-2097); ADR-033 (amended by ADR-2101/2099)
- ADR-005 adapter architecture and the three middleware layers; ADR-2085 (no sixth slot, kind
  block 38000-38201); ADR-039 (honest apply classes); ADR-2020 (manifest gating)
- ADR-2030 permissive licensing for publishable service crates (the AGPL boundary)
- ADR-2012 relay allowlist; ADR-2065 (pod inbox sole writer)
- ADR-059 blocktrails; `services/nostr-pod-bridge/src/contract.rs:139`; `trail.rs:199-201`
- ADR-124 and ADR-128 (host repo): the L0-L3 trust ladder, the P21 containment mechanism, the
  UK regulatory matrix, and the seal-terminology prohibition at §2.3
- PRD-015 C10 (Lightning-first, superseded) and C11 (no native EVM rail, standing)
- DDD-003, DDD-006, DDD-016, DDD-019, DDD-020, DDD-021
- [`docs/GOVERNANCE-capabilities.md`](../GOVERNANCE-capabilities.md) (kinds 31402/31403,
  `payment_settlement`), [`docs/INGRESS-identity.md`](../INGRESS-identity.md),
  [`docs/PROTOCOL-registry.md`](../PROTOCOL-registry.md)
- `management-api/routes/sessions-boundary.js:212-296`; `lib/authority.js:213`;
  `lib/task-properties.js:172`; `lib/pay402.js`; `lib/spend-policy.js`; `lib/cost-gate.js`
- `nostr-bbs-core/src/keys.rs:251-265` (`derive_subkey`, with the parity vector at `:477-485`)
- solid-pod-rs: `src/bitcoin_tx.rs`, `src/mrc20.rs`, `payments.rs:102-176`, `pay.rs:128-291`
- VisionClaw: `src/handlers/pay_handler.rs:198-403`; nostr-bbs-pod-worker: `payments.rs:183`
- sidestr SPEC.md v0.0.1 draft (2026-09-15) and its proposals: assets-and-pools, desk,
  checkpoints, evm, level-2, ephemeral. Self-described as provisional in field names, kinds
  and document shapes.
