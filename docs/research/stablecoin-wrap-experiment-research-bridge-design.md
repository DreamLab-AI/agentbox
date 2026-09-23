Backends: ceramic (12 queries, one parallel round) · perplexity (perplexity_search, 12 queries in two parallel rounds) · local (ADR-2102, ADR-2101, sidestr SPEC.md, proposals/assets-and-pools.md) · direct fetch for verification (curl + pdftotext on every cited page; r.jina.ai reader for two JS-rendered pages). web-researcher loaded but not needed; native WebSearch/WebFetch not used.

# Stablecoin wrap experiment: how wrapped-asset bridges are designed, and what can be verified

Researcher C · slug `stablecoin-wrap-experiment` · 2026-09-23

Scope: prior art for federated or semi-trusted bridges; reserve attestation; issuer freezes; redemption ordering. It ends with concrete recommendations for the `bridge` consensus rule proposed in ADR-2102 [200][201]. Status tags: **verified** means the quoted text was read on the cited page. **inferred** is my reasoning from verified sources. **unresolved** means no source settles it.

## 0. Where our design starts

- ADR-2102 already commits to five things: a wrapped asset under a versioned `bridge` rule; asset identity equal to the origin contract id; "unique reserve allocations"; redemption records "bound to genesis, txid, vout and asset"; and burn-first, release-second after ADR-2101 finality. It also commits to "wrapped supply equals held reserve at every settled height, with pending redemptions carried as liabilities" [200]. The review amendments leave three items open: what validators check, the attestation format, and the signer [201]. (verified)
- Upstream sidestr already has the pattern this rule needs. A peg-in claim is bound to exactly one parent outpoint through a `claim:<parent txid>:<vout>` record, and "a claim of an outpoint already claimed is invalid". A level-1 validator accepts what the signers claim; a level-2 validator with a parent view refuses a claim it cannot verify [202]. Peg-out is a burn first. The payout carries the sidechain txid on the parent, and a parent-view validator "checks that every burn is paid within `pegoutBlocks`" and publishes the ones that are not [203]. (verified)
- Upstream's draft for moving assets between chains takes the same shape. The origin burns with a `pegout:` record, the destination claims a coinbase issuance of a wrapped asset with id `<origin chain id>:<origin asset id>` paired with `claim:`, and "the trust is the destination's signers, so this is for level 2 chains" [205]. The `assets` rule destroys any asset that a spend fails to tally onward [206]. That is why ADR-2102 separates "destruction by omission" from redemption [200]. (verified)
- ADR-2101: "No external release (bridge redemption, peg-out payment, merchant finality, anchor) happens before the finality rule the protocol profile defines" [207]. (verified)

## 1. Prior art: mint authority, reserve accounting, replay protection, finality

### 1.1 Federated and custodial designs

| system | who can mint | finality before mint | redemption order | reserve evidence | source |
|---|---|---|---|---|---|
| Liquid (L-BTC) | federation claims peg-ins | **102** Bitcoin confirmations | watchmen pay out only to PAK-authorised destinations; PAK list changes take **3 days** | Blockstream PoR tool (unspendable PSBT) | [218][219] |
| Liquid issued assets | whoever holds the **reissuance token**, which can itself be k-of-n (e.g. "3 of 5 signatures for any given issuance") | n/a | burn | issuer-side | [219] |
| Rootstock PowPeg | Bridge contract, keys in PowHSMs that sign only with enough cumulative PoW | **100** Bitcoin blocks | burn → **4000** RSK blocks → HSM signature | on-chain multisig | [220] |
| sBTC | 70% of signers (11 of 15) | per-deposit verification | lock as a non-transferable `locked-sBTC` → BTC paid → burn; a rejection returns the sBTC | threshold wallet | [221][222] |
| WBTC | custodian mints, only after a merchant initiates | **6** BTC confirmations | burn → **25** ETH confirmations → release BTC → mark completed | published custody addresses, signatures from those addresses, quarterly audits | [223][224] |
| Circle CCTP | Circle's attesters (2/2) sign each burn message | "after sufficient block confirmations"; a finality threshold (≥2000 = finalised) | burn on source → attestation → mint on destination | none needed (issuer-native) | [214][216][217] |

Lessons for our rule (inferred from the table):

1. **Mint authority is a scoped, rotatable capability, not the block-signing key.** Liquid gives issuance its own token, which can be multisig [219]. WBTC splits initiation (merchant) from execution (custodian) [223]. PowPeg ties signing to proof of work [220]. ADR-2101 already separates keys [207]. The bridge mint key should be separate again from block-signing keys.
2. **Confirmation depth on the origin chain is a declared parameter.** Deep federated pegs pick very conservative depths (102, 100) [218][220]. Custodial WBTC picks 6 [223]. Our peg-in uses `pegConfirmations: 6` on the txbt4 siding [202]. A bridged RGB deposit needs its own parameter (`bridgeConfirmations`) in the chain document, because RGB's validity depends on the anchoring Bitcoin transaction not being reorganised away.
3. **The redeeming side waits for its own chain's finality before paying out.** WBTC waits 25 ETH confirmations after the burn [224]. sBTC waits six Bitcoin blocks, because "releasing actual BTC is irreversible" [222]. PowPeg waits 4000 RSK blocks [220]. For us this is ADR-2101's `FINALISE_BLOCK` certificate [207].
4. **Two redemption orderings exist, and both are safe if the rule models the pending state.** WBTC burns then releases [224]. sBTC locks, releases, then burns, and has an explicit reject path back to the holder [221]. ADR-2102's burn-first choice [200] needs an equivalent "reject → re-credit" path, or a failed release (a frozen reserve, an invalid destination) destroys value permanently.
5. **Destination restriction is a legitimate lever.** Liquid pays peg-outs only to PAK-authorised destinations, with a three-day delay on list changes. The delay is there so that "the network [can] detect an attacker that is able to compromise a set of functionaries before the attacker is able to make a withdrawal" [218].

### 1.2 Lock-and-mint failures

| incident | root cause | lesson for the `bridge` rule | source |
|---|---|---|---|
| Wormhole, Feb 2022 | Solana verifier accepted a **caller-supplied fake sysvar account**, so a forged message minted 120,000 wETH "without putting up the corresponding ETH as collateral"; Jump Crypto then replenished the ETH "to ensure wETH is backed 1:1" | the rule must verify mint signatures itself against a key pinned in the chain document, never trust a record or input that says "verified"; an unbacked mint is only repaired by someone recapitalising | [208][209] |
| Nomad, Aug 2022 | on initialisation, the zero root (`0x00`) was accepted as a valid proven root, so any unproven message passed | genesis state of the rule must be empty (zero supply, no trusted roots); a zero/empty attestation digest must never validate | [210] |
| Ronin, Mar 2022 | "five of the nine validators" keys obtained; four of them were controlled by one company; per the Augusto SoK table, "nobody noticed for 6 days" | threshold counts **independent operators**, not keys; monitoring must detect unexpected reserve movement | [211][213] |
| Multichain, Jul 2023 | MPC keys controlling locked reserves compromised; bridged USDC.m fell to ~$0.22 while native USDC held par; Circle froze ~$63M of the **underlying** | a wrapped stablecoin is a claim on the bridge; an issuer freeze protects the issuer's token, not the wrapper's holders | [232][233] |

Across systematisations: 65.8% of stolen bridge value came from "intermediary permissioned networks with unsecured cryptographic key operations" [213]. Notland et al. list 11 impact-reduction measures across 34 exploits, among them maximum transfer size, pausing withdrawals, deposits, mints and burns, and monitoring [212]. Even issuer-run burn-and-mint rests on the attester: "CCTP does not validate source-chain state on the destination chain" [217]. (verified; lessons inferred)

### 1.3 Replay protection

CCTP marks `usedNonces[hash(sourceDomain, nonce)] = 1` and rejects "Nonce already used" [215]. The audit states "to prevent replay attacks, each message includes a field for the nonce that is checked in the destination domain. Attesters set the nonce, ensuring it is unique to each message" [216]. Our chain needs no separate nonce space: the origin **outpoint** is already globally unique, and upstream's rule "a claim of an outpoint already claimed is invalid" [202] is exactly CCTP's used-nonce check. The key must also include the origin chain / network identifier, which is CCTP's `sourceDomain` [215], so that a testnet4 deposit can never be replayed against a mainnet-parented chain. (inferred)

## 2. Reserve attestation: what can be proven, and by whom

### 2.1 Formats in the wild

- **Address-ownership proof plus balance lookup.** WBTC publishes custody addresses and, for proof of reserves, publishes "signatures from the addresses which bitcoin is stored in", plus quarterly third-party audits [223]. Blockstream's PoR tool signs a PSBT that "is not actually a valid Bitcoin transaction (even after signing)", so it proves control without risk of moving funds [219][235]. (verified)
- **Merkle-sum liabilities.** Each node is a (balance, hash) pair. The sum tree (not a plain Merkle tree) is needed because of "the possibility of negative balances", and a ZK proof of non-negativity closes the remaining gap [225]. (verified)
- **Issuer-side on-chain supply commitments (Taproot Assets v0.7).** A supply commitment is an on-chain Taproot output; "each new supply-commit transaction spends the prior commitment output and creates a new one", and the daemon exposes `total_outstanding_supply` with a block header and inclusion proof [226]. (verified)
- **RGB.** The RGB docs list a `ProofOfReserves` type, "a bitcoin outpoint paired with a binary proof, can be used to show that some tokens are locked as a reserve" [227]. The LNPBP-0020 RGB20 interface (a pinned 2023 revision) lets genesis, `Issue` and `Burn` carry `reserves {RGBContract.ProofOfReserves}`, with errors `insufficientReserves` / `insufficientCoverage` [228]. This is RGB's own "backed by an outpoint" hook, but it is validated client-side by RGB wallets, not by our chain. (verified; applicability inferred)

### 2.2 What a validator of OUR chain can check without RGB client-side validation

On-chain, an RGB transfer is an ordinary Bitcoin transaction: "there is no visible token identifier, amount, or recipient address on-chain" [234]. So, split by level (inferred from [202][205][234]):

| check | level 1 validator | level 2 validator (parent view) |
|---|---|---|
| each mint references a reserve outpoint never used before (replay) | ✔ from our chain's own records | ✔ |
| mint signature is by the pinned bridge attestation key(s), threshold met | ✔ | ✔ |
| wrapped supply + pending liabilities = Σ attested reserve amounts (bookkeeping identity) | ✔ exact, from records | ✔ |
| redemption burn is followed by a release record within N parent blocks, else flagged | record only | ✔ checks that the release txid exists on the parent |
| the reserve outpoint exists on testnet4 with ≥ `bridgeConfirmations` | ✘ trusts | ✔ |
| the reserve outpoint is still **unspent**, or its move is recorded | ✘ trusts | ✔ |
| the outpoint's output key is the bridge's declared reserve key | ✘ trusts | ✔ if the key is published (key-path taproot, as upstream uses) |
| the outpoint actually carries X units of asset A under contract C (valid consignment history) | ✘ | ✘: needs client-side validation (rgb-lib) |
| the asset is the genuine issuer's contract (not a look-alike) | ✘ | ✘: needs the contract id pinned out of band, and RGB validation |
| no competing claim / encumbrance / issuer freeze on the reserve | ✘ | ✘: legal / issuer-side (ADR-2102 amendment [201]) |

**What must be trusted:** at level 1, as upstream says of peg holders, custody is the holders' to abuse and "the record shows it" [204]. Beyond that: the attesters' RGB validation (amount, asset, history), the pinning of the origin contract id, and the absence of off-chain encumbrance. ADR-2102's amendment already says this: "an on-chain reserve figure proves neither ownership nor the absence of competing claims, and proof of reserves does not enumerate liabilities" [201]. The trust can be *reduced*, not removed: validators can run rgb-lib themselves outside consensus as an audit, and several independent attesters can each validate the consignment. (inferred)

**Taproot Assets comparison:** for a TA-issued stablecoin, a level-2 validator could additionally follow the issuer's supply-commitment chain [226]. That proves the issuer's outstanding supply, not the bridge's holding. (inferred)

## 3. Issuer controls: freezes

- **USDT:** Tether's terms reserve the right to "freeze any Tether Tokens held by you" and to blacklist "any Digital Tokens Address which holds Tether Tokens" [229]. On account chains this is `addBlackList`, followed optionally by `destroyBlackFunds`, where "destroy always follows a freeze" [230]. (verified)
- **USDC bridged by third parties:** Circle's own terms say "Circle lacks the ability to block certain addresses or freeze Bridged USDC" on the wrapper, and if the bridge is exploited "holders of Bridged USDC may not be able to unbridge" [231]. (verified)
- **The freeze lands on the reserve, and wrapper holders bear it.** In Multichain, Circle froze about $63M of underlying USDC [233], but "USDC.m holders on Fantom had no recourse". The analyst's framing: separate "did the backing fail?" from "did access to the backing fail?" [232]. (verified)
- **Client-side-validated assets:** a secondary comparison describes an issuer's lever in RGB as the ability to "refuse transitions", and in Taproot Assets to "refuse proofs", rather than an on-chain blacklist [234]. How USDT-on-RGB actually encodes a freeze (schema rights, issuer-side redemption refusal) is **unresolved**; I found no primary Tether/UTEXO specification. (secondary only; flagged)

What the `bridge` rule should do (inferred):
1. **The reserve is frozen or impaired:** the attesters publish a signed `bhalt:<asset>` record. From then on the rule refuses new mints of that asset and new redemption releases. Existing wrapped units stay transferable, and wallets must show them as *impaired* (the ADR-2102 custody label [200], plus a status flag). No silent haircut or rebasing in consensus. Any recovery or pro-rata distribution is a later, explicit, signed rule document (SPEC §8-style activation), never an automatic action.
2. **A user or destination is sanctioned:** do **not** put a per-holder freeze in consensus for the experiment. The bridge enforces its policy at the only point it controls: release. Following the Liquid PAK precedent [218], it may reject a redemption with a signed `breject:` that re-credits the burner (the sBTC reject path [221]). The rejection is public and auditable.
3. **The issuer stops supporting the asset or network:** treat it as `bhalt` with reason code `unsupported`. (inferred; no source consulted on issuer de-support.)

## 4. Redemption ordering, reorgs, liabilities

- **Mint side (origin deposit → wrapped mint).** Race: the RGB deposit's anchoring transaction is reorganised out after the mint. Mitigation: `bridgeConfirmations` depth before the attestation may be signed, and a level-2 re-check that the outpoint is still in the best chain [202][218][220]. On a *testnet* parent, where reorgs and resets are possible, a reorg after mint is a declared failure mode. The attesters then publish a `bhalt`, and the invariant check shows the shortfall. (inferred)
- **Burn side (wrapped burn → origin release).** Race: releasing before the burn is final lets a reorged-away burn be paid twice. Mitigation: release only after the ADR-2101 `FINALISE_BLOCK` certificate [207]. This matches WBTC's 25-confirmation wait [224] and sBTC's six blocks [222]. Record the release intent durably, keyed by burn txid, before any broadcast, and reconcile on restart, as the reference producer does for peg-outs [203][200]. (verified precedent; mapping inferred)
- **Liabilities while pending.** sBTC keeps a pending redemption as a distinct, non-transferable `locked-sBTC` [221]. Our accounting must track three buckets per asset: `circulating`, `pending_redemption` and `released`. The invariant is **circulating + pending = reserve attested** at each finalised height, and `released` must match reserve decreases. (inferred from [200][221])
- **Double release across bridge instances.** ADR-2102 requires reserve allocation "atomic across bridge instances" [200]. With RGB, spending a seal is itself a Bitcoin double-spend guard: two instances can't both spend the same reserve UTXO. Reserve **splitting** (one UTXO → change + payout) must still be serialised by one release journal. (inferred)

## 5. Concrete recommendations for the experiment

**R1. Mint authority as a coin, not a flag.** Carry wrapped-asset minting on an **authority coin**: a UTXO on our chain, created in the rule's activation document, whose key-path key is the k-of-n bridge attestation key. It is the Liquid reissuance-token pattern [219], with serial ordering like the Taproot Assets commitment chain, where each spend replaces the prior output [226]. Every mint and every `bhalt`/`breject` must spend and recreate it. Normal script validation then checks the threshold signature (the Wormhole lesson [208]), mints are totally ordered, and replay needs a double-spend. The key is distinct from block-signing keys (ADR-2101 [207]), and a change to it is a rule document with a delay, following the Liquid PAK three-day precedent [218]. *(inferred design)*

**R2. Per-mint record** (OP_RETURN ≤255 bytes, the upstream record grammar [206]), e.g.
`bmint:<rule v>:<asset>:<origin net>:<reserve txid>:<vout>:<amount>:<out vout>:<att>`
- `asset` = the full origin contract id (ADR-2102 URN, full digest [200]); upstream's draft id is `<origin chain id>:<origin asset id>` [205]. The two need reconciling (see Open questions).
- `origin net` + `reserve txid:vout` = the uniqueness key; reuse is invalid (the CCTP `sourceDomain`+nonce analogue [215], upstream claim rule [202]).
- `att` = the digest of a signed Nostr attestation event carrying: consignment digest, rgb-lib version, RGB line (v0.11 vs v0.12), anchoring block height and confirmations, bridge reserve output key, depositor's recipient script, and each attester's signature.
- **Invalid if:** zero amount; zero or empty digest (Nomad [210]); reserve outpoint already used; cumulative mint would exceed a per-asset **cap** in the chain document (impact reduction [212]); asset under `bhalt`.

**R3. Per-burn and release records.**
`bburn:<asset>:<amount>:<dest digest>` (a spend that tallies the asset to an OP_RETURN output under the bridge rule, distinct from destruction by omission [206]) moves the amount to `pending`.
`brelease:<burn txid>:<origin release txid>:<new reserve outpoint|none>` (authority-coin spend) closes it after `FINALISE_BLOCK` [207].
`breject:<burn txid>:<reason>` (authority-coin spend) re-credits the burner, following the sBTC reject path [221].
Validators publish every burn not released or rejected within `bridgeReleaseBlocks`, as `pegoutBlocks` does [203].

**R4. Attestation signer.** k-of-n (≥2-of-3 for the experiment, not 1-of-1) over **independently operated** attesters. Each one runs its own rgb-lib validation of the consignment in its own process, never one bridge process signing for all (Ronin [211]; 65.8% key-ops finding [213]). Attestation keys are published in the chain document. Periodically, each attester also publishes a signed **reserve snapshot** listing current reserve outpoints and per-asset totals, and proves control of those outpoints with a Blockstream-PoR-style unspendable PSBT [219][235].

**R5. What validators check.** Every validator checks the rule-internal identities in §2.2 at every block, fail-closed: signature threshold, uniqueness, caps, halt state, and circulating + pending = Σ minted − Σ released. A level-2 validator also checks each reserve outpoint's depth and unspentness on testnet4, and that release txids exist. Anything that needs RGB semantics stays **outside consensus**: an optional audit mode that runs rgb-lib against published consignments and raises a discrepancy event. It never forks the chain (ADR-2102 keeps RGB out of `sidestr-core` [200]).

**R6. Operational guards for a testnet run.** A per-asset cap and per-day release cap, a `bhalt` circuit breaker, and monitoring of reserve outpoints for unexpected spends (Ronin's six undetected days [213]). The test asset must be labelled unbacked or test-only until ADR-2102's gate conditions are met [201].

## Sources

### [200] ADR-2102 — Decision §1–§6 (local)
URL: https://github.com/DreamLab-AI/agentbox/blob/52eab13734e96361f9fcb4dad7f652256a9c1cdb/docs/adr/ADR-2102-assets-are-bridged-in-rgb-as-a-wrapped-asset.md (docs/adr/ADR-2102-assets-are-bridged-in-rgb-as-a-wrapped-asset.md:35-52)
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/DreamLab-AI/agentbox/blob/52eab13734e96361f9fcb4dad7f652256a9c1cdb/docs/adr/ADR-2102-assets-are-bridged-in-rgb-as-a-wrapped-asset.md" retrieved="2026-09-23">
> The rule defines asset identity as the origin contract id under a rule namespace, authorised reissuance for repeated deposits, unique reserve allocations, redemption records bound to genesis, txid, vout and asset, and replay protection; a validator lacking the rule refuses the chain. […] Exit burns the wrapped asset first and issues a consignment to a named UTXO second, never the reverse, and only after the burn is final under the ADR-2101 rule, bound to one asset and recipient, recorded durably before any retry, with reserve allocation atomic across bridge instances and origin-chain reorgs reconciled. Wrapped supply equals held reserve at every settled height, with pending redemptions carried as liabilities
</untrusted-source>

### [201] ADR-2102 — Amendments after adversarial review (local)
URL: https://github.com/DreamLab-AI/agentbox/blob/52eab13734e96361f9fcb4dad7f652256a9c1cdb/docs/adr/ADR-2102-assets-are-bridged-in-rgb-as-a-wrapped-asset.md (docs/adr/ADR-2102-assets-are-bridged-in-rgb-as-a-wrapped-asset.md:73-91)
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/DreamLab-AI/agentbox/blob/52eab13734e96361f9fcb4dad7f652256a9c1cdb/docs/adr/ADR-2102-assets-are-bridged-in-rgb-as-a-wrapped-asset.md" retrieved="2026-09-23">
> an on-chain reserve figure proves neither ownership nor the absence of competing claims, and proof of reserves does not enumerate liabilities. […] Excluding RGB semantics from `sidestr-core` makes the bridge's attestation the thing validators check; the attestation format, its signer and its audit are part of the `bridge` rule. […] The parked items are the reserve attestation format, redemption identity and the legal rights at each layer.
</untrusted-source>

### [202] sidestr SPEC §6 Peg-in (local)
URL: https://github.com/jjohare/spec/blob/722ad42d3271efccfdfaf57c3c6943f58fc168f8/SPEC.md (sidestr/upstream/spec/SPEC.md:161-167, 230)
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/jjohare/spec/blob/722ad42d3271efccfdfaf57c3c6943f58fc168f8/SPEC.md" retrieved="2026-09-23">
> After `pegConfirmations` parent confirmations, a sidechain block may **claim** it: the coinbase pays the named script the peg's amount, and the very next coinbase output is an `OP_RETURN` carrying `claim:<parent txid>:<vout>`. […] A claim of an outpoint already claimed is invalid. A claim of a peg-in the validator cannot see is judged by level (section 9): a level 1 validator accepts what the signers claim; a level 2 validator has a parent view and refuses a claim it cannot verify.
> `pegConfirmations`: 6; `refundBlocks`: 10,000; `pegoutBlocks`: 144
</untrusted-source>

### [203] sidestr SPEC §7 Peg-out (local)
URL: https://github.com/jjohare/spec/blob/722ad42d3271efccfdfaf57c3c6943f58fc168f8/SPEC.md (sidestr/upstream/spec/SPEC.md:180-192)
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/jjohare/spec/blob/722ad42d3271efccfdfaf57c3c6943f58fc168f8/SPEC.md" retrieved="2026-09-23">
> A validator with a parent view checks that every burn is paid within `pegoutBlocks` parent blocks and publishes the ones that are not. The reference producer pays each burn as soon as the block holding it is on the chain, once, keeping its record beside the chain and reconciling it with the peg wallet's own history on start. In level 1 this is the federation's promise and the validators' record of whether it was kept.
</untrusted-source>

### [204] sidestr SPEC §14 Threats (local)
URL: https://github.com/jjohare/spec/blob/722ad42d3271efccfdfaf57c3c6943f58fc168f8/SPEC.md (sidestr/upstream/spec/SPEC.md:288-290)
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/jjohare/spec/blob/722ad42d3271efccfdfaf57c3c6943f58fc168f8/SPEC.md" retrieved="2026-09-23">
> **Peg holders steal**: possible in level 1, the coins are theirs to move. The refund path limits it to coins not yet swept, and the record shows it. This is why level 1 is for coins with no value.
</untrusted-source>

### [205] sidestr proposal: Assets and pools §4 Assets between chains (local)
URL: https://github.com/jjohare/spec/blob/722ad42d3271efccfdfaf57c3c6943f58fc168f8/proposals/assets-and-pools.md (sidestr/upstream/spec/proposals/assets-and-pools.md:74-86)
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/jjohare/spec/blob/722ad42d3271efccfdfaf57c3c6943f58fc168f8/proposals/assets-and-pools.md" retrieved="2026-09-23">
> On the destination chain the signers claim it as the coinbase issuance of a wrapped asset whose id is `<origin chain id>:<origin asset id>`, paired with a `claim:` record naming the origin txid, so a validator with a view of the origin (its mirror, its announcements) checks each claim. […] The trust is the destination's signers, so this is for level 2 chains; a chain that adopts it says so in its document.
</untrusted-source>

### [206] sidestr proposal: Assets and pools §1–§2 records and the `assets` rule (local)
URL: https://github.com/jjohare/spec/blob/722ad42d3271efccfdfaf57c3c6943f58fc168f8/proposals/assets-and-pools.md (sidestr/upstream/spec/proposals/assets-and-pools.md:13-15, 37-39)
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/jjohare/spec/blob/722ad42d3271efccfdfaf57c3c6943f58fc168f8/proposals/assets-and-pools.md" retrieved="2026-09-23">
> A rule reads **records**: `OP_RETURN` outputs whose data is UTF-8 text of at most 255 bytes […] Spending a tallied output without tallying its assets onward destroys them; that is allowed and is how an asset is burned. Assets never touch the peg: a burn (section 7) is of sats only, and an asset has no parent.
</untrusted-source>

### [207] ADR-2101 — Federation topology and key separation (local)
URL: https://github.com/DreamLab-AI/agentbox/blob/04fc80f0715cbb7d2b4bf22b474b413fa3060110/docs/adr/ADR-2101-federation-topology-and-key-separation.md (docs/adr/ADR-2101-federation-topology-and-key-separation.md:98-100, 169-172)
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/DreamLab-AI/agentbox/blob/04fc80f0715cbb7d2b4bf22b474b413fa3060110/docs/adr/ADR-2101-federation-topology-and-key-separation.md" retrieved="2026-09-23">
> No external release (bridge redemption, peg-out payment, merchant finality, anchor) happens before the finality rule the protocol profile defines.
> **Finality proof** = genesis and profile, configuration chain, template decision certificate, sealed header and template binding, `FINALISE_BLOCK` certificate, inclusion proof.
</untrusted-source>

### [208] CertiK — Wormhole Bridge Exploit Incident Analysis
URL: https://www.certik.com/resources/blog/wormhole-bridge-exploit-incident-analysis
Retrieved: 2026-09-23
Status: verified
Found via: ceramic
<untrusted-source url="https://www.certik.com/resources/blog/wormhole-bridge-exploit-incident-analysis" retrieved="2026-09-23">
> During the attack, the hacker bypassed the verification step by injecting a fake sysvar account and successfully generated a malicious "message" that specified for 120,000 wETH to be minted. […] the function "load_current_index" does not validate whether the injected "sysvar account" is actually the "system sysvar".
</untrusted-source>

### [209] Merkle Science — Hack Track: Analysis of the Wormhole Token Bridge Exploit
URL: https://www.merklescience.com/blog/hack-track-analysis-of-wormhole-token-bridge-exploit
Retrieved: 2026-09-23
Status: verified
Found via: perplexity
<untrusted-source url="https://www.merklescience.com/blog/hack-track-analysis-of-wormhole-token-bridge-exploit" retrieved="2026-09-23">
> Post the attack, the Wormhole team assured its users that Wormhole's ETH supply would be replenished to ensure wETH is backed 1:1. […] the attackers fraudulently minted 120,000 wETH worth over $320 million from the Wormhole Bridge on Solana blockchain without putting up the corresponding ETH as collateral.
</untrusted-source>

### [210] CertiK — Nomad Bridge Exploit Incident Analysis
URL: https://www.certik.com/resources/blog/nomad-bridge-exploit-incident-analysis
Retrieved: 2026-09-23
Status: verified
Found via: ceramic
<untrusted-source url="https://www.certik.com/resources/blog/nomad-bridge-exploit-incident-analysis" retrieved="2026-09-23">
> The messages[_messageHash] is 0x000 in this case. The function acceptableRoot(messages[_messageHash]) returns true, and the message is proved. This is caused by 0x0000 is initialized as true(We believe this is a mistake in the deployment).
</untrusted-source>

### [211] Elliptic — Lazarus Group identified behind Ronin bridge theft
URL: https://www.elliptic.co/blog/analysis/north-korea-s-lazarus-group-identified-as-exploiters-behind-540-million-ronin-bridge-theft
Retrieved: 2026-09-23
Status: verified
Found via: ceramic
<untrusted-source url="https://www.elliptic.co/blog/analysis/north-korea-s-lazarus-group-identified-as-exploiters-behind-540-million-ronin-bridge-theft" retrieved="2026-09-23">
> Funds can be moved out if five of the nine validators approve it. The attacker managed to get hold of the private cryptographic keys belonging to five of the validators, which was enough to steal the cryptoassets.
</untrusted-source>

### [212] Notland et al. — SoK: Cross-Chain Bridging Architectural Design Flaws and Mitigations (arXiv:2403.00405)
URL: https://arxiv.org/abs/2403.00405
Retrieved: 2026-09-23
Status: verified
Found via: perplexity
<untrusted-source url="https://arxiv.org/abs/2403.00405" retrieved="2026-09-23">
> Throughout this study, we have analysed 60 different bridges and 34 bridge exploits in the last three years (2021-2023). […] We identified prevention measures and proposed 11 impact reduction measures
</untrusted-source>

### [213] Augusto et al. — SoK: Security and Privacy of Blockchain Interoperability (IEEE S&P 2024)
URL: https://oaklandsok.github.io/papers/augusto2024.pdf
Retrieved: 2026-09-23
Status: verified
Found via: perplexity
<untrusted-source url="https://oaklandsok.github.io/papers/augusto2024.pdf" retrieved="2026-09-23">
> Our findings reveal that a substantial portion (65.8%) of stolen funds originates from projects secured by intermediary permissioned networks with unsecured cryptographic key operations.
> [Table 9, Ronin] The attackers compromised 5 out of 9 validators – the exact threshold. Nobody noticed for 6 days. No monitoring existed.
</untrusted-source>

### [214] Circle — CCTP Technical Guide
URL: https://developers.circle.com/cctp/technical-guide
Retrieved: 2026-09-23
Status: verified
Found via: ceramic
<untrusted-source url="https://developers.circle.com/cctp/technical-guide" retrieved="2026-09-23">
> After sufficient block confirmations , Circles offchain attestation service, Iris, signs the message. An API consumer must query this attestation and submits it onchain to the destination domains MessageTransmitterV2#receiveMessage function. […] This distinction allows the recipient to control the level of finality it requires before accepting a message.
</untrusted-source>

### [215] Circle EVM CCTP contracts docs — Message Lifecycle
URL: https://circlefin-evm-cctp-contracts.mintlify.app/concepts/message-flow
Retrieved: 2026-09-23
Status: verified
Found via: perplexity
<untrusted-source url="https://circlefin-evm-cctp-contracts.mintlify.app/concepts/message-flow" retrieved="2026-09-23">
> bytes32 _sourceAndNonce = _hashSourceAndNonce(_sourceDomain, _nonce);
> require(usedNonces[_sourceAndNonce] == 0, "Nonce already used");
> usedNonces[_sourceAndNonce] = 1;
</untrusted-source>

### [216] ChainSecurity — Code Assessment of the CCTP V2 Smart Contracts (2025-07)
URL: https://6778953.fs1.hubspotusercontent-na1.net/hubfs/6778953/CCTP/ChainSecurity_Circle_CCTP_audit_2025-07.pdf
Retrieved: 2026-09-23
Status: verified
Found via: perplexity
<untrusted-source url="https://6778953.fs1.hubspotusercontent-na1.net/hubfs/6778953/CCTP/ChainSecurity_Circle_CCTP_audit_2025-07.pdf" retrieved="2026-09-23">
> To prevent replay attacks, each message includes a field for the nonce that is checked in the destination domain. Attesters set the nonce, ensuring it is unique to each message. By specifying a finality threshold parameter, the user can choose if they want to send a fast message (unfinalized and with fees) or the normal finalized message.
</untrusted-source>

### [217] L2BEAT — CCTP v2
URL: https://l2beat.com/interop/protocols/cctpv2
Retrieved: 2026-09-23
Status: verified
Found via: perplexity
<untrusted-source url="https://l2beat.com/interop/protocols/cctpv2" retrieved="2026-09-23">
> CCTP does not validate source-chain state on the destination chain. The destination `MessageTransmitter` verifies signatures from Circle-controlled attesters, so security depends on Circle's offchain attestation service signing only valid source messages and protecting its signing keys.
</untrusted-source>

### [218] Liquid Developer Documentation — Technical Overview
URL: https://docs.liquid.net/docs/technical-overview
Retrieved: 2026-09-23
Status: verified
Found via: ceramic
<untrusted-source url="https://docs.liquid.net/docs/technical-overview" retrieved="2026-09-23">
> A peg-in transaction requires 102 confirmations on the Bitcoin network before the funds can be claimed on the Liquid Network. […] the watchmen will only send bitcoin to an address under the control of an authorized user. This is done through the use of a Peg-out Authorization Key (PAK). […] it takes three days to update the PAK list. This allows the network to detect an attacker that is able to compromise a set of functionaries before the attacker is able to make a withdrawal to their own wallet.
</untrusted-source>

### [219] Blockstream — Liquid: A Bitcoin Sidechain (whitepaper)
URL: https://blockstream.com/assets/downloads/pdf/liquid-whitepaper.pdf
Retrieved: 2026-09-23
Status: verified
Found via: perplexity
<untrusted-source url="https://blockstream.com/assets/downloads/pdf/liquid-whitepaper.pdf" retrieved="2026-09-23">
> Liquid allows for multisignature re-issuance of assets which allows for more secure asset management. For example, a tokenized fiat asset in Liquid may require 3 of 5 signatures for any given issuance, which decreases the likelihood of an unauthorized increase of the token supply.
> This PSBT, unlike ordinary PSBTs, is not actually a valid Bitcoin transaction (even after signing), meaning that funds are not at risk of moving or being stolen
</untrusted-source>

### [220] Rootstock Developers Portal — PowPeg
URL: https://dev.rootstock.io/concepts/foundations/powpeg/
Retrieved: 2026-09-23
Status: verified
Found via: perplexity (ceramic returned the sibling /concepts/powpeg/ page)
<untrusted-source url="https://dev.rootstock.io/concepts/foundations/powpeg/" retrieved="2026-09-23">
> Therefore, in order to prevent intended or unintended invalid forks, the Bridge is designed to wait for 100 confirmations before confirming a peg-in transaction. […] Peg-outs require 4000 Rootstock blocks.
</untrusted-source>

### [221] SIP-028 — sBTC peg (stacksgov/sips)
URL: https://github.com/stacksgov/sips/blob/main/sips/sip-028/sip-028-sbtc_peg.md
Retrieved: 2026-09-23
Status: verified
Found via: perplexity
<untrusted-source url="https://github.com/stacksgov/sips/blob/main/sips/sip-028/sip-028-sbtc_peg.md" retrieved="2026-09-23">
> The system requires at least 70%, or 11 out of 15 signatures, for an sBTC operation to be fulfilled. […] The system is safe ("trustworthy") if at least 30% of the sBTC Signer voting power is honest.
> This transfers the requested amount of sBTC to the `.sbtc` contract & mints the user a non-transferable locked-sBTC as a placeholder. […] If instead the request is rejected, the sBTC signers will call the `withdraw-reject` function […] Returns the sBTC to the holder.
</untrusted-source>

### [222] Stacks Documentation — Pegging out sBTC
URL: https://docs.stacks.co/learn/sbtc/sbtc-operations/withdrawal
Retrieved: 2026-09-23
Status: verified
Found via: perplexity
<untrusted-source url="https://docs.stacks.co/learn/sbtc/sbtc-operations/withdrawal" retrieved="2026-09-23">
> The Stacks transaction must reach finality. The protocol requires six Bitcoin block confirmations before proceeding to the next step. […] Mitigates issues from potential Bitcoin forks by allowing time for network stability.
</untrusted-source>

### [223] WBTC Whitepaper
URL: https://www.wbtc.network/whitepaper
Retrieved: 2026-09-23
Status: verified
Found via: perplexity
<untrusted-source url="https://www.wbtc.network/whitepaper" retrieved="2026-09-23">
> Custodian waits for 6 confirmations of the BTC transaction […] Quarterly audits will be conducted by external third parties to verify that all wrapped tokens minted have an equal amount of asset stored among all custodians. In the case of WBTC, proof of reserves can be shown by publishing signatures from the addresses which bitcoin is stored in. […] Custodians will not be able to mint tokens on their own, but would instead require the initiation of a merchant in order to do so.
</untrusted-source>

### [224] WBTC Docs — Mint/Burn Mechanism
URL: https://docs.wbtc.network/how-wbtc-works/mint-burn-mechanism
Retrieved: 2026-09-23
Status: verified
Found via: perplexity
<untrusted-source url="https://docs.wbtc.network/how-wbtc-works/mint-burn-mechanism" retrieved="2026-09-23">
> The custodian waits for 25 confirmations on the Ethereum network to ensure the burn transaction is final. […] Because WBTC is burned before BTC is released, the circulating supply always remains synchronized with the amount of Bitcoin held in custody.
</untrusted-source>

### [225] Vitalik Buterin — Having a safe CEX: proof of solvency and beyond
URL: https://vitalik.eth.limo/general/2022/11/19/proof_of_solvency.html
Retrieved: 2026-09-23
Status: verified
Found via: perplexity
<untrusted-source url="https://vitalik.eth.limo/general/2022/11/19/proof_of_solvency.html" retrieved="2026-09-23">
> One important subtlety of the scheme is the possibility of negative balances […] It turns out that this possibility does not break the scheme, though this is the reason why we specifically need a Merkle sum tree and not a regular Merkle tree.
</untrusted-source>

### [226] Lightning Labs — Announcing Taproot Assets v0.7
URL: https://lightning.engineering/posts/2025-12-16-tapd-0.7-launch/
Retrieved: 2026-09-23
Status: verified
Found via: perplexity
<untrusted-source url="https://lightning.engineering/posts/2025-12-16-tapd-0.7-launch/" retrieved="2026-09-23">
> A supply commitment is an on-chain Taproot output that commits to the current supply state of a grouped asset. With v0.7, the Taproot Assets daemon exposes the supply commitment, its sub-tree roots, the per-leaf entries, and the `total_outstanding_supply` over RPC. […] Updates are modeled as a chain of commitments: each new supply-commit transaction spends the prior commitment output and creates a new one with updated roots and sums.
</untrusted-source>

### [227] RGB Docs — Supported schemas
URL: https://docs.rgb.info/rgb-contract-implementation/schema/supported-schemas
Retrieved: 2026-09-23
Status: verified
Found via: perplexity
<untrusted-source url="https://docs.rgb.info/rgb-contract-implementation/schema/supported-schemas" retrieved="2026-09-23">
> ProofOfReserves: a bitcoin outpoint paired with a binary proof, can be used to show that some tokens are locked as a reserve for the UDA asset
</untrusted-source>

### [228] LNPBP-0020 — RGB-20 fungible assets interface (pinned revision dc16fd09)
URL: https://github.com/LNP-BP/LNPBPs/blob/dc16fd091beaa74b171ce1d1fa04e902ef3a8012/lnpbp-0020.md
Retrieved: 2026-09-23
Status: verified (this revision; the current master no longer carries the text)
Found via: perplexity
<untrusted-source url="https://github.com/LNP-BP/LNPBPs/blob/dc16fd091beaa74b171ce1d1fa04e902ef3a8012/lnpbp-0020.md" retrieved="2026-09-23">
> op? Issue :: used inflationAllowance+ , reserves {RGBContract.ProofOfReserves ^ 0..0xFFFF} -> issuedSupply , future inflationAllowance* , beneficiary assetOwner* !! supplyMismatch | invalidProof | issueExceedsAllowance | insufficientReserves
</untrusted-source>

### [229] Tether — Token Terms of Sale and Service
URL: https://tether.to/en/legal/
Retrieved: 2026-09-23
Status: verified
Found via: perplexity
<untrusted-source url="https://tether.to/en/legal/" retrieved="2026-09-23">
> Tether may suspend or terminate your access to the Site or any of the Services, freeze any Tether Tokens held by you, or terminate your Tether Token Wallet, as required by applicable Law or where Tether, in its sole discretion, determines it is prudent to do so […] blacklisting any Digital Tokens Address which holds Tether Tokens
</untrusted-source>

### [230] BlockSec — Tether destroyBlackFunds: Burn & Reissue Explained
URL: https://blocksec.com/blog/destroyblackfunds-tether-mechanic-explained
Retrieved: 2026-09-23
Status: verified
Found via: perplexity
<untrusted-source url="https://blocksec.com/blog/destroyblackfunds-tether-mechanic-explained" retrieved="2026-09-23">
> The `require(isBlackListed[_blackListedUser])` check is the guard in the deployed contract. If the target address is not already blacklisted, the transaction reverts. Destroy always follows a freeze
</untrusted-source>

### [231] Circle — Third-Party Bridged USDC Terms
URL: https://www.circle.com/legal/bridged-usdc-terms
Retrieved: 2026-09-23
Status: verified
Found via: perplexity
<untrusted-source url="https://www.circle.com/legal/bridged-usdc-terms" retrieved="2026-09-23">
> In the event that the Supported L2 Networks or Supported Bridges are exploited, the Native Ethereum USDC locked in the Supported Bridges may be stolen or lost, and holders of Bridged USDC may not be able to unbridge their Bridged USDC […] Circle does not control the Bridged USDC contract on the Supported L2 Networks and Circle lacks the ability to block certain addresses or freeze Bridged USDC in the event your funds are stolen.
</untrusted-source>

### [232] Pharos — Multichain USDC: the bridge died, not the dollar
URL: https://pharos.watch/learn/case-studies/multichain-usdc-2023/
Retrieved: 2026-09-23
Status: verified
Found via: perplexity
<untrusted-source url="https://pharos.watch/learn/case-studies/multichain-usdc-2023/" retrieved="2026-09-23">
> Circle froze ~$63M of the underlying USDC on Ethereum, protecting the native token — but USDC.m holders on Fantom had no recourse. […] When evaluating a depeg, separate the question "did the backing fail?" from "did access to the backing fail?"
</untrusted-source>

### [233] The Block — $63 million in USDC frozen by Circle following Multichain breach
URL: https://www.theblock.co/news/ecosystems/2023-07-07-63-million-in-usdc-frozen-by-circle-following-multichain-breach-238459
Retrieved: 2026-09-23
Status: verified (read via r.jina.ai reader; page is JS-rendered)
Found via: perplexity
<untrusted-source url="https://www.theblock.co/news/ecosystems/2023-07-07-63-million-in-usdc-frozen-by-circle-following-multichain-breach-238459" retrieved="2026-09-23">
> USDC issuer Circle blacklisted three wallet addresses that received a significant outflow of funds from the cross-chain bridge platform Multichain in its potential security breach. Security firm PeckShield noted that about $63 million in USDC, part of the assets involved in the alarming outflow, has been frozen.
</untrusted-source>

### [234] Spark — ERC-20, SPL, Taproot Assets, and RGB Compared (secondary)
URL: https://www.spark.money/research/stablecoin-token-standard-comparison
Retrieved: 2026-09-23
Status: verified (the quote is present; the freeze claim is a secondary characterisation without a primary Tether/RGB citation)
Found via: perplexity
<untrusted-source url="https://www.spark.money/research/stablecoin-token-standard-comparison" retrieved="2026-09-23">
> In a client-side validated system, the blockchain sees only a standard Bitcoin transaction. There is no visible token identifier, amount, or recipient address on-chain.
> |Address freezing|On-chain mapping|Freeze authority|Issuer can refuse proofs|Issuer can refuse transitions|Issuer-level controls|
</untrusted-source>

### [235] ElementsProject/reserves — Blockstream Proof of Reserves tool
URL: https://github.com/ElementsProject/reserves
Retrieved: 2026-09-23
Status: verified (the repository exists and is the tool the Liquid whitepaper [219] names; design quote taken from [219])
Found via: perplexity
<untrusted-source url="https://github.com/ElementsProject/reserves" retrieved="2026-09-23">
> This project can be found at https://github.com/ElementsProject/reserves. [quoted from the Liquid whitepaper, which names this repository]
</untrusted-source>

## Open questions

1. **Asset id grammar.** ADR-2102 uses `urn:agentbox:asset:<issuer>:<full origin digest>` [200]. Upstream's draft uses `<origin chain id>:<origin asset id>` [205]. For an RGB origin there is no "origin chain id" in the sidestr sense. Which namespace goes in the on-chain record, and does the URN derive from it? (unresolved)
2. **How does USDT-on-RGB encode issuer freezes?** Schema rights, issuer refusal to co-sign transitions, or redemption-only refusal. No primary Tether/UTEXO schema was found; only a secondary claim [234]. This decides whether `bhalt` can be triggered by an observable event or only by attester judgement. (unresolved)
3. **Reserve granularity.** Does rgb-lib reliably support one fresh seal (UTXO) per deposit, so that reserve outpoint = uniqueness key? What happens to uniqueness when attesters consolidate seals? R3's `new reserve outpoint` chain is my proposal, not a checked rgb-lib capability. (unresolved)
4. **Record size.** A full `bmint:` record with a 64-hex txid, a 64-hex contract id and a 64-hex attestation digest is near the 255-byte limit [206]. Should the attestation digest move into the authority-coin spend's witness or annex instead? (unresolved)
5. **Mint in coinbase vs ordinary transaction.** Upstream's §4 draft mints in the coinbase paired with `claim:` [205]. R1 proposes an authority-coin spend instead, so the threshold signature is checked by script. Upstream should be asked whether a non-coinbase mint path is acceptable under the `assets` rule's "the coinbase carries none of these" [206]. (unresolved)
6. **Testnet4 reorg depth.** What `bridgeConfirmations` is proportionate on testnet4, given the 102/100/6 precedents [218][220][223]? A reorg-after-mint drill should be part of the ratification evidence. (unresolved)
7. **Legal layer.** Segregation, encumbrance, insolvency and who owns a frozen reserve are explicitly parked by ADR-2102 [201]. No technical rule can settle them, and the Multichain precedent [232][233] shows they decide holders' recovery in practice. (unresolved; counsel)
