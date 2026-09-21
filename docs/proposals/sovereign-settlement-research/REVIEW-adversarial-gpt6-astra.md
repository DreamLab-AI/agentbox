**Do not ratify this pack as authority to carry real value.** It contains contradictory monetary rules, an unsafe consensus assumption, an incomplete bridge protocol and a settlement gate that is not yet specified tightly enough to enforce its claims.

D0–D6 remain binding. This review does not propose restoring Lightning, abandoning the chain as ledger of record, replacing the chosen topology or reversing the Rust decision. It distinguishes those owner decisions from the unsupported claim that the proposed implementation safely realises them.

I read the supplied pack, researcher reports, planner outputs and upstream specification documents. The implementation findings below are attributed to the supplied researcher reports; this bundle does not contain the complete implementation needed to independently reproduce them. No files were modified or created.

Citation shorthand: **PRD** means `pack/sovereign-settlement.md`; **DDD** means `pack/sovereign-settlement-domain.md`; **ADR-2096** through **ADR-2103** identify the correspondingly numbered files under `pack/`. Other citations give the supplied path explicitly. Line numbers refer to these snapshots.

**1. Fatal flaws**

**F1. A threshold signature is being treated as a consensus protocol. The proposed thresholds do not establish Byzantine safety.**

**Pack claim.** The root starts at 2-of-3, becomes “at least” 3-of-5 before carrying value, and obtains “tolerance” of `n − k`. Distinct hosts and NTP are the principal operational qualifications. [ADR-2101:36–43; PRD:217–218]

**Why it is wrong.** `n − k` describes how many unavailable signers a threshold can tolerate. It does not describe how many Byzantine signers the consensus protocol tolerates.

Consider five signers, A–E, with A malicious:

- A, B and C sign block X at height h.
- A, D and E sign conflicting block Y at height h.
- Every honest signer signs only once.
- Both blocks satisfy 3-of-5.

Two size-k quorums can intersect in only `2k − n` members. To guarantee an honest intersection with f Byzantine signers, a necessary condition is `2k − n > f`. The proposed 3-of-5 permits the only intersection member to be malicious. The same problem affects 2-of-3.

There is a second, independent defect. Upstream initially prohibits signing two proposals at one height, then explicitly relaxes that rule after a timeout. A signer cannot infer from the absence of an announcement that its earlier signature was never assembled into a certificate. A delayed certificate and a later certificate can therefore coexist. NTP does not fix this; network delay and withheld messages are sufficient. [upstream-spec/proposals/level-2.md:21–41,56–64]

**Loss scenario.** A bridge releases origin assets against a burn on X. Y becomes the accepted history and contains no burn. The wrapped units remain spendable while the reserve has left.

**Why the invariants do not stop it.** I20 validates each block locally; both blocks can be valid. I01 and I02 can hold independently on both histories. None establishes a unique final history. [DDD:485–491,557–559]

**Required change.** Specify the actual consensus and finality protocol: fault model, quorum intersection, durable locking, view changes, equivocation handling, signer epochs, restart behaviour and the rule under which an external payment becomes irrevocably authorised. A larger multisig alone is insufficient. Real-value release must depend on that finality rule.

---

**F2. The refund model permits both a child-chain claim and a parent-chain refund, or else destroys the advertised recovery guarantee.**

**Pack claim.** Every peg output retains the depositor’s CSV refund path; `Claimed` and `Refunded` are mutually exclusive terminal states; a dead chain “costs time, not coins”. [DDD:274–282,535–537; PRD:73–77]

**Why it is wrong.** Claiming a deposit on the child chain does not spend its parent outpoint. The parent script does not observe the child claim.

A concrete execution is:

1. Alice deposits 100 units into a parent output with her timed refund branch.
2. The child claims it and credits Alice.
3. Alice transfers the child coins to Bob.
4. The parent output remains unspent until its CSV matures.
5. Alice refunds it.

Bob’s coins remain on the child chain, but their backing has gone. Claim adjacency and a child-side “already claimed” map do not disable a parent script branch. [upstream-spec/SPEC.md:119–139]

Sweeping the deposit into a federation-controlled reserve can prevent that execution. But then Alice’s original refund output no longer exists. Bob does not gain a unilateral recovery path merely because Alice once had one.

The pack partially recognises this elsewhere: ADR-2101 says already-claimed coins on a dead chain have no refund path. That directly contradicts the PRD’s broad assurance and I14’s unrestricted wording. [ADR-2101:42; evidence/R1-sidestr-spec.md:653–662]

**Required change.** Define an explicit deposit protocol distinguishing:

- refundable, unclaimed deposits;
- deposits swept into confirmed custody;
- issued liabilities;
- redeemed liabilities.

Specify whether minting waits for a confirmed sweep, how sweep fees are funded, what happens near refund expiry and how parent reorgs reverse state. Restrict the refund guarantee to the cases the script actually protects. Secondary holders must be told that recovery depends on the federation unless a separate recovery mechanism is implemented.

---

**F3. The wrapped-asset issuance described in the pack cannot be implemented using the stated upstream `assets` rule.**

**Pack claim.** Repeated external deposits issue or increase one wrapped asset identified by `<origin chain id>:<origin contract id>`, using `issue:`/`tally:`. Every node enforces the reserve invariant. [ADR-2102:35–42,71–75; DDD:298–315]

**Evidence against it.**

Upstream defines an issued asset’s identity as the **issuing transaction’s txid**. Subsequent transactions cannot increase its supply: outputs may carry no more than inputs. A new `issue:` creates another asset with another txid. [upstream-spec/proposals/assets-and-pools.md:20–38]

Therefore:

- Deposit 1 can issue asset X.
- Deposit 2 cannot mint additional X under those rules.
- Issuing Y and calling it X in an application database does not make X and Y fungible in consensus.

The DDD introduces a `bridge:` marker to issue or increase supply, but neither ADR-2102 nor the root’s declared rules defines that consensus extension. The root names only `assets` and `checkpoints`. [DDD:303–305,447; PRD:215–216]

The upstream cross-chain asset draft is not a solution. It describes tallying an asset to a burn output and minting it in a coinbase, while the existing rule prohibits tallies to `OP_RETURN` outputs and excludes those records from coinbases. [upstream-spec/proposals/assets-and-pools.md:13–15,30–38,74–85]

**Required change.** Specify a versioned wrapped-asset rule: asset identity, authorised issuance, unique reserve allocations, mint authorisation, redemption records, replay protection and state transitions. Mark it as a new consensus protocol requiring implementation and audit. Validators lacking it must refuse the chain.

Also decide what a node actually verifies about RGB reserves. Excluding RGB semantics from the node makes a bridge attestation possible; it does not make independent RGB reserve verification happen automatically.

---

**F4. The child close contradicts ordinary consensus rules and does not guarantee payment when a session dies.**

**Pack claim.** A closing coinbase pays every holder, its outputs become burns, the entire parent peg is distributed, and a child cannot outlive its session. [ADR-2101:44–50; DDD:334–342,492–495; PRD:222–227]

**Why it is unimplementable as ordinary sidestr consensus.**

- Normal coinbase value is limited to fees plus new claims.
- Burns in coinbases are expressly invalid.
- Ordinary coinbase creation does not consume all existing holder UTXOs.
- Asset records are excluded from coinbases.

The close proposal requires exceptions to all relevant rules, but does not define the complete replacement state transition. [upstream-spec/SPEC.md:95–97,148–153; upstream-spec/proposals/ephemeral.md:32–37; upstream-spec/proposals/assets-and-pools.md:15]

Without explicit retirement of the old UTXO set, a closing coinbase that recreates all balances duplicates monetary state. Without explicit asset handling, it cannot close a chain holding wrapped assets.

**The liveness claim also fails.** A rule rejecting blocks after the close height cannot force anyone to produce the closing block. A dead session cannot execute `phase=close`. A lost session signing key cannot sign the terminal block. An alert does not settle funds.

I18 retreats from “cannot outlive” to an orphan being “alertable” and blocking nothing. That is a different guarantee. [DDD:546–550]

**Required change.** Define close as a distinct consensus transition, including UTXO retirement, per-asset entitlements, parent destinations, fees, dust, rounding, maximum holder count, payout acknowledgement and finality. Implement settlement supervision outside the session process, with a defined recovery authority and crash-safe state machine. Do not equate `session closed`, `child closed`, `parent payout confirmed` and `tombstone published`.

---

**F5. The monetary invariants are false, and the inherited peg-out fee rule makes a fully backed peg insolvent.**

**Pack claim.** Spendable sats equal claimed deposits minus burns; wrapped supply equals held reserve “at all times”. [DDD:485–487,510–513; ADR-2102:42]

**Concrete insolvency.** Upstream requires paying the full burn amount on the parent and taking the parent fee from the same peg reserves. [upstream-spec/SPEC.md:148–158]

Start with reserve R = 100 and circulating liabilities S = 100:

- Burn 10: S becomes 90.
- Pay 10 to the redeemer and 1 in parent fees: R becomes 89.

The peg is now short by 1. No malicious participant is necessary.

I01 is independently overbroad. The coinbase may collect **at most** fees plus claims; uncollected fees reduce supply. “Spendable” also excludes immature coinbases and may exclude encumbered outputs. Those distinctions are absent from the equation.

I08 cannot literally hold through an asynchronous bridge operation. Receiving origin assets before minting produces surplus reserve; burning before releasing also produces surplus reserve. Pending redemptions remain liabilities even though the wrapped units have disappeared.

**Required change.** Write conservation equations for precisely defined quantities. Separate circulating supply, locked supply, pending deposits, pending redemptions, customer reserve and operator fee capital. Prevent the same parent escrow and its child representation being counted twice. Fund fees from explicit operator capital or deduct a disclosed fee from redemption proceeds.

A meaningful solvency condition must include outstanding redemption liabilities, not merely circulating tokens.

---

**F6. The key-isolation claim fails if the derivation root remains accessible to the compromised session.**

**Pack claim.** HMAC-derived spend and signer keys isolate roles; placing `k_sign` under `/run/secrets` prevents a compromised session from sealing root blocks. [ADR-2101:52–70; DDD:526–531,562–563]

**What HMAC actually establishes.** Compromise of a derived child key need not reveal its parent or siblings. Compromise of the parent reveals every deterministically derived child.

The supplied estate evidence records secret material in `identity.env`, sourced before supervisord, and a private key written into Git configuration. ADR-2101 itself acknowledges that `identity.env` is sourced into every supervised programme. [evidence/R2-agentbox-surfaces.md:25–45; ADR-2101:65–66]

Moving the derived key while leaving `k_id` accessible does not isolate the signer. A compromised process can derive `k_sign(chain)` itself.

**Required change.** Remove derivation roots from agent-accessible environments and repositories before relying on this design. Specify the identity/signing service’s caller authentication, permitted derivations and permitted signing operations. A generic “sign this payload” port remains a bypass.

Independent custody roots for federation and bridge roles should be considered within the binding key-separation objective. At minimum, demonstrate that an agent process can access neither those roots nor an unrestricted service using them.

---

**F7. The operation-digest requirement is internally inconsistent and omits material parts of the spend.**

**Pack claim.** Hash structured fields—chain, destination script, amount, asset and purpose—and require the broadcast transaction to hash to the approved digest. [ADR-2100:51–55; PRD:260–261]

Those are different byte strings. A hash of a structured operation is not the transaction hash. An implementation following the words literally will reject legitimate transactions; one interpreting them loosely will invent security-critical semantics.

The listed fields omit:

- inputs and their authority;
- change outputs;
- additional outputs and attached assets;
- fee limits;
- network/genesis identity;
- sighash policy;
- locktime and relevant sequence semantics;
- approval nonce, expiry and single-use consumption.

An approved payment can retain the advertised recipient and amount while leaking value through another output or an excessive fee.

**Required change.** Define canonical approved intent and the exact transaction-to-intent validation relation. Alternatively approve a sufficiently complete transaction template. Bind the approval to the exact chain genesis, principal, asset identity, output set, fee policy, nonce and policy version. Specify RBF and fee-bump behaviour. Consume authorisations atomically at the signing boundary.

Structured fields improve reviewability; they do not by themselves “close” prompt-injection-to-spend.

---

**F8. The P21 commitment does not commit the approval whose immutability its acceptance test promises.**

**Pack claim.** The genesis `pin:` commits a containment object containing six named fields. A later acceptance test mutates `p21Receipt` and expects genesis validation to fail. [ADR-2103:52–60,105–109; PRD:275–288]

The six fields are parent, header profile, currency pin, cash-out, peg confirmations and refund blocks. **The receipt is absent.**

No stated rule explains how mutating that omitted field changes the commitment. Other material controls—bridge enablement, value classification and exposure limits—are also absent.

The security plan includes the gate receipt inside the commitment, but introduces a construction-order problem: approval hashes the full document, which contains the approval reference, while a referenced Git commit contains that document. Implemented literally, this introduces self-referential hashes. [evidence/PLAN-security.md:551–562]

**Required change.** Define an acyclic sealing procedure:

1. Canonical policy payload, excluding approval references and self-referential hashes.
2. Separate owner and legal signatures over that payload’s digest.
3. Final envelope containing the policy and complete signed approvals.
4. Genesis commitment to the defined envelope.
5. A subsequent archival record.

Specify all committed fields and all permitted mutations. Test every security-relevant field, not just one receipt identifier.

---

**F9. The pack simultaneously requires upstream validators to ignore its additions and requires those additions to change validity.**

**Pack claim.** Local additions are fields “a conformant validator ignores”; upstream need never read them. Yet header profile, containment and close policy determine which blocks and spends are valid. [DDD:580,613–622; ADR-2103:45–60]

An old validator ignoring `headerProfile` cannot validate the new header format. One ignoring cash-out restrictions may accept a burn the local validator rejects. One ignoring close policy may accept post-close blocks. One lacking the bridge rule cannot enforce wrapped issuance.

These are consensus forks, not harmless metadata extensions.

**Required change.** Define a named, versioned protocol profile with mandatory feature negotiation and refusal of unsupported consensus rules. State which upstream chains remain compatible and which local chains require the local validator. Remove the assurance that ignored extensions are sufficient for interoperability.

**2. Consensus and cryptography**

**The level-1 peg does not establish backing, and claim/burn pairing proves less than the DDD says.**

DDD says the adjacent claim structure, “not trust”, stops a signer minting. That is false at L1. A signer can name a fabricated parent outpoint, place an arbitrary payout immediately before the marker and satisfy the structural rule. Upstream explicitly says L1 accepts the signers’ claims. [DDD:279–282; upstream-spec/SPEC.md:129–135]

This matters directly to the assertion that a session cannot spend more than its funded budget. The session is the L1 signer. If its validator does not independently check parent deposits, it can fabricate additional claims. A root escrow cap might prevent withdrawing more than the escrow, but it does not prevent a merchant accepting invented child-chain money or being diluted at close. [PRD:182–184; ADR-2101:44–48]

I02 stops a duplicate claim of the **same identifier on one history**. It does not, by itself, prove:

- the parent outpoint exists;
- its amount is correct;
- its deposit marker names this chain and recipient;
- it remains controlled by the required custody descriptor;
- its confirmation is on the canonical parent branch;
- it has not already been refunded or allocated elsewhere.

For L2 these checks must be explicit and independently performed by co-signers. “A real parent view” is too imprecise for the monetary boundary. [DDD:488–491]

Burn pairing has a related granularity problem. The parent payout marker names the sidechain transaction, while a transaction can contain multiple outputs. Specify whether multiple burns per transaction are prohibited or supported, and identify redemptions by at least genesis, transaction, output and asset. Otherwise “one signature per burn” and “paid once” can disagree about what the unit of redemption is. [upstream-spec/SPEC.md:148–158; upstream-spec/proposals/level-2.md:47–50]

**L2 verifies evidence; it does not force the custodian to pay.**

Parent visibility permits detecting an unpaid burn. It does not make the federation’s keys sign a payment. Upstream’s table saying L2 trusts signers for “nothing about pegs” is incompatible with its admission that trust-minimised peg-out is out of scope. [upstream-spec/SPEC.md:159–181]

The pack should reject that upstream terminology rather than inherit it. DDD’s own exclusion correctly describes L2 as k-of-n custody. [DDD:694–699]

A malicious threshold can steal reserves directly, refuse redemption or select a fraudulent rule transition. A minority can censor or halt according to the actual consensus protocol. I09 displays a label; it does not constrain those capabilities.

**The NUMS construction solves one specific problem, not the federation’s safety problem.**

A correctly constructed NUMS internal key removes a known key-path secret, requiring the intended script path. It does not prevent quorum equivocation, malicious rule adoption or theft by the spending threshold.

The pack must distinguish three descriptors:

1. Block-authorisation challenge.
2. Refundable deposit output.
3. Collected reserve output.

Upstream’s L2 peg descriptor has one `multi_a` leaf under NUMS, whereas the base peg description requires a depositor refund leaf. These cannot be treated as the same descriptor without an explicit Taproot tree. [upstream-spec/proposals/level-2.md:8–15,47–54; upstream-spec/SPEC.md:121–123]

Required cryptographic details include:

- the exact NUMS point and tweak encoding;
- canonical chain namespace;
- scalar reduction and invalid-point handling;
- leaf order and control-block construction;
- separation of block keys from custody keys;
- descriptor recovery data and checksums;
- signer-set and descriptor epochs.

The upstream prose and implementation already disagree about witness ordering. The implementation also requires exactly k filled signature slots: blindly including k+1 signatures fails `NUMEQUAL`. These need explicit vectors, not a general assertion of Taproot compatibility. [upstream-spec/proposals/level-2.md:12–15,56–59]

**The HMAC plan needs a complete derivation specification.**

The role labels separate spend from sign, but `chain_id` is deliberately a mutable-world name rather than a genesis-bound identifier. Reusing `sidestr:dreamlab` for a new genesis derives the same role keys. [ADR-2101:54–55; DDD:211–216]

Bind derivation to an unambiguous namespace containing the protocol version, chain genesis or pre-genesis identity commitment, role and epoch. Define encoding, invalid scalar handling and x-only normalisation. Record test vectors across implementations.

Per-purpose receive addresses also require an address-index and recovery scheme. The single-script balance fold does not find those addresses automatically. [ADR-2101:68–73; PRD:177–180]

**Hardened BIP-32 is a derivation and recovery tool, not network containment.**

A key under coin type 1′ can still sign a mainnet transaction if software gives it one. Bitcoin scripts do not enforce BIP-32 path labels. Thus “coin_type 0′ versus 1′ is itself a mainnet containment boundary” overstates what the path provides. [ADR-2101:59–63]

Network containment requires the signer to verify the network, transaction semantics, descriptor and authorised chain policy independently.

The wording also conflicts: signer keys are HMAC children of `k_id`, but the same paragraph specifies dedicated hardened BIP-32 accounts for signer roles. Choose one normative construction per role.

An `m/86′/...` reference does not specify recovery for a threshold Taproot tree. Recovery needs the full descriptor, derivation origins, script tree, key ordering, indexes and epochs. A seed alone may not reconstruct the intended custody policy.

**The fork replay defence is incomplete.**

The security plan correctly identifies asymmetric replay: unified-sighash fork transactions are protected in one direction, while ordinary mainnet signatures can remain valid on the fork. Its proposed cure—fresh keys and refusing controlled UTXOs confirmed before the fork—is insufficient. [evidence/PLAN-security.md:1004–1029; ADR-2103:69–75]

Counterexample:

1. A pre-fork UTXO exists on both branches.
2. Its owner makes a standard-sighash transaction to a freshly generated peg address after the fork.
3. That transaction is replayed onto the fork.
4. The peg receives an identical outpoint on both branches, each confirmed **after** the fork height.

The proposed height check passes. The funding lineage remains replayable. A later standard-sighash spend can still operate on both copies.

Required controls include distinct family-specific descriptors, fork-exclusive funding or an explicit coin-splitting procedure, exact sighash checks on every input, and tests using replayed post-fork descendants. The security plan’s separate-family account requirement should survive into the ratifiable documents. [evidence/PLAN-security.md:1026–1029]

The wrong-chain RPC tripwire also needs ongoing enforcement. A boot-time fork-hash check does not establish continuing parent correctness, peer diversity, reorg handling or freedom from eclipse.

**The two header profiles are two consensus implementations, not two serialisers.**

The pack specifies 80-byte and 164-byte headers, but header length and hash function do not completely define a chain. Validation also depends on transaction sighashes, script rules, activation semantics, timestamp rules, coinbase maturity, block limits and the BIP-325 signing preimage. [ADR-2103:45–51; upstream-spec/SPEC.md:86–97]

The recorded reference signs a construction based on the first 72 header bytes. That needs a field-by-field justification for both layouts, including which fields are deliberately excluded and why. [evidence/R1-sidestr-spec.md:156–168]

Accepting rust-bitcoin does not supply a complete independent consensus engine. Its own documentation warns against treating the library as equivalent to Bitcoin Core consensus validation. The standard script-validation integration does not establish support for this Knots fork’s custom rules. [rust-bitcoin documentation](https://github.com/rust-bitcoin/rust-bitcoin?hl=en-US), [validation implementation](https://docs.rs/bitcoin/latest/src/bitcoin/consensus/validation.rs.html)

There are four parent selections and two child header selections: **eight explicit parent/profile combinations**, before differing child/root profiles and protocol epochs are added. A smaller matrix needs justified equivalence classes.

“Each arm proven against a live upstream chain” is currently impossible for the proposed SHA-256d sidestr arm on the evidence supplied. ADR-2103’s verification quietly substitutes a locally minted chain. That is useful implementation testing, but it is not an independent live oracle. [ADR-2103:48–49,105–107]

**Checkpoints establish prior existence, not unique finality.**

The upstream checkpoint note says a parent block proves that a child history existed before it. It does not specify a unique canonical child history. [upstream-spec/proposals/checkpoints.md:5–16]

Two conflicting child histories can both have hashes embedded in parent transactions. Permissionless `OP_RETURN` publication also means the presence of a marker alone does not establish that an authorised custodian endorsed it.

The protocol must decide:

- which checkpoint publications are authoritative;
- what happens when valid conflicting histories are checkpointed;
- whether first, deepest or another explicitly authorised checkpoint governs;
- what parent depth is required for each external action;
- what happens when a checkpoint is reorganised out;
- how these rules compose across nesting.

A “second explorer agrees” check is not independent finality if both explorers share a backend or are eclipsed together.

Similarly, an exact local spent status and `states.len() == txo.len()` do not prove a unique seal history. Equal array lengths do not prove a bijection; an absent UTXO may never have existed, be pruned or belong to another branch. The evidence needs creation, spending transaction, state binding and finality. [ADR-2099:48–54; DDD:751–753]

**Close needs parent-address mapping and data availability.**

With per-chain derivation, a child holder’s script is not the root wallet’s ordinary script. Copying that script into a root payout may pay a key the root balance fold does not watch. If session cleanup destroys the child key, the payout can become inaccessible. [ADR-2101:54–64; ADR-2099:33–36; upstream-spec/proposals/ephemeral.md:33–37]

Each holder needs an authenticated root destination or a durable recovery mapping. This is especially important for wrapped assets, where different assets cannot be pooled into one sats-denominated pro-rata calculation.

A checkpoint hash is not the closing state. After all mirrors disappear, a holder without the relevant history or proof cannot reconstruct their entitlement from the tombstone. The upstream proposal explicitly relies on parties retaining copies. [upstream-spec/proposals/ephemeral.md:43–49]

**Nested refunds do not have a bounded wall-clock duration.**

CSV advances in the relevant parent’s blocks. If the root stops, child refund clocks stop. If the external parent stops while the root continues, children may settle into root claims while external redemption remains frozen. These are different failure modes.

“Compounding is measured” does not establish a recovery bound. Without guaranteed parent progress, there is no finite bound. Nor is every nesting failure solved by adding refund periods together. [ADR-2101:85–87; PRD:228–229]

Specify maximum nesting depth, heartbeat requirements, expiry relationships, settlement margins, who advances each chain during recovery and which layer holds a claim after each transition.

**Burn-before-release is necessary but insufficient.**

It prevents one simple mint-and-withdraw error only if:

- the burn is final under a sound finality rule;
- it is bound to a specific asset and recipient;
- the same burn cannot authorise multiple releases;
- release is durably recorded before retry;
- reserve allocation is atomic across bridge instances;
- origin-chain reorgs and failed consignments are reconciled.

A process boundary does not provide any of these. I08 presently bundles them into an assertion without specifying their mechanism. [DDD:298–319,510–513]

Also distinguish **ordinary asset destruction** from **redemption**. Upstream permits burning assets simply by omitting them from output tallies. Such a burn contains no necessary redemption destination. An ordinary sats coin selector could accidentally destroy attached assets unless it is asset-aware. [upstream-spec/proposals/assets-and-pools.md:24–38; ADR-2096:37–43]

**3. Economics and operations**

| Failure or condition | What actually breaks | Required operational decision |
|---|---|---|
| **A signer host is rebuilt** | Restoring a key without its latest vote locks can cause equivocation. Restoring an old peg-out journal can cause duplicate payment. Running the old and replacement host simultaneously creates two writers with one authority. | Durable vote and payout journals; anti-rollback protection; instance fencing; recovery reconciliation; restore drills including stale snapshots. Key backup alone is insufficient. [ADR-2101:40–43; upstream-spec/proposals/level-2.md:61–64; upstream-spec/SPEC.md:157–158] |
| **The external parent stalls** | Peg confirmations, refunds, external redemptions and checkpoint finality stop advancing. Internal transfers may continue, allowing unredeemable claims to circulate. | Explicit degraded modes, maximum uncheckpointed exposure, deposit and redemption suspension rules, and honest availability reporting. [upstream-spec/SPEC.md:137–139,198–207; ADR-2103:62–75] |
| **Relays drop ephemeral events** | Transactions, proposals, partial signatures and PSBT rounds disappear. A restarted participant cannot assume the relay can replay them. | Persist locally before publish; acknowledgements, retries and deduplication; independent block/mempool recovery; bounded queues. Estate-operated relays alone do not establish durability. [ADR-2098:46–57; upstream-spec/proposals/level-2.md:25–36,47–50] |
| **A session dies mid-tab** | Its close hook does not execute; its signing key or latest state may disappear; the counterparty holds an unsettled claim. | Recovery outside session lifecycle; durable state and keys; explicit authority to close; a maximum recovery objective or an admission that none exists. [DDD:328–342,546–550] |
| **USDT-on-RGB never launches** | No real USD asset exists for the proposed route. A test RGB20 round-trip does not demonstrate USDT availability, issuer acceptance or liquidity. | Keep the adapter and product claim conditional; set a decision date; specify whether a different bridge origin would require a new asset and approval. Do not invent a token and label it USDT. [ADR-2102:24–31,54–57; PRD:384–385] |
| **Upstream changes the spec** | “Fixture wins for compatibility” and “our specification wins for behaviour” can select different validity rules. Rule-key adoption can split nodes. | Immutable source and rule pins; a governed local protocol version; migration policy; explicit refusal of unexpected upstream rules. [DDD:617–622; upstream-spec/SPEC.md:164–173] |
| **A threshold is lost permanently** | Claimed coins may remain permanently inaccessible. Automatic signer replacement cannot spend the old reserve without the required old keys. | A pre-agreed recovery and wind-down design, including its trust cost. Deferring “L3” does not defer the operational need. [ADR-2101:42–43; DDD:697–699] |

**The sole instrument creates an estate-wide availability dependency.** If the root cannot settle, payments across pods, agents and the forum cannot settle. Operational fallback must therefore be an explicit degraded service mode—such as bounded operator-authorised service credit, if consistent with D0—or suspension. It must not quietly resurrect an authoritative legacy balance.

The pack should specify maximum acceptable outage, recovery objectives and the consequences for users whose service depends on paying an agent. “Below threshold the chain halts for everyone” is a failure description, not an operating model. [ADR-2096:61–67]

**The cost model is missing.** No subsidy means someone funds:

- parent peg transactions;
- checkpoints;
- reserve consolidation;
- child opening and closing;
- mirror and archive retention;
- signer operations;
- RGB consignment storage and transfer;
- exceptional recovery.

Internal zero-fee transfers do not eliminate those costs. A child containing hundreds of tiny holders can create a closing transaction too large or too dusty to relay. The proposal’s “one transaction, no fee” is not a viable parent-chain cost policy. [upstream-spec/proposals/ephemeral.md:32–37,62–63]

**Coinbase maturity may defeat short sessions.** Claims are minted in coinbase transactions. The base rules inherit parent behaviour except where explicitly overridden, and the researcher report identifies a 100-block maturity parameter. A session cannot immediately spend a fresh claim unless enough child blocks have elapsed or maturity is deliberately changed. [upstream-spec/SPEC.md:95–97,129–131; evidence/R1-sidestr-spec.md:960–963]

Choose and test maturity, heartbeat interval, startup latency and capital prefunding. Otherwise “create, fund, transact” is an unstated latency promise.

**The migration assumes away liabilities.** DDD infers that VisionClaw has no legitimate value to reconcile because one deposit endpoint is a stub. That does not prove the persisted ledger is empty or free of obligations. Imports, manual credits, previous versions and other writers must be checked. [DDD:733–738]

Before removing any authoritative ledger, inventory balances and outstanding obligations, reconcile them against assets, freeze the relevant writers and record the cutover. If legacy liabilities are unbacked, D0 does not authorise minting fictitious backing to preserve their numbers.

The “100 random DIDs” equality test is weak: 100 unused identities can all return zero. Tests need known non-zero balances, holds, failed payments, migrated assets and reorgs. [PRD:322]

**The retained AMM remains a financial and technical project.** Removing the upstream `pool` rule does not remove sequencing conflicts or front-running from the existing application AMM. Nor can a formerly central ledger debit arbitrary users once balances become user-authorised UTXOs. The pack needs atomic settlement, signatures, cancellation, slippage limits and failure recovery—or an explicit retirement decision. [ADR-2096:52–54; DDD:740–744; PRD:382–383]

**4. Governance and safety**

**The obvious gate bypass is below the HTTP routes.**

ADR-2100 requires calls through `lib/authority.js`. ADR-2098 separately permits consensus-authenticated chain ingress, and upstream says transactions authorise themselves and can arrive through `/tx` or kind 23500. [ADR-2100:34–40; ADR-2098:51–60; upstream-spec/SPEC.md:221–225]

There is no contradiction in allowing users to broadcast their own transactions. The missing distinction is between:

- external users spending independently held keys;
- managed agent funds whose keys must obey estate policy;
- federation reserve movements;
- automatic bridge and child-close payouts.

For managed funds, **the key-use boundary must enforce approval and budget policy**. A route wrapper is insufficient if a raw signing service, producer wallet, recovery command, bridge process or legacy payment route can obtain an equivalent signature.

Specify which policy applies to every signing capability and remove unrestricted alternatives. Test the bypasses directly rather than treating a non-empty `require('../lib/authority')` grep as evidence of closure. [ADR-2100:76–80]

**31403 validity requires more than a signature.**

The verifier needs an exact request binding, authorised approver identity, role, scope, expiry, policy version and single-use state. The request must bind the requesting principal and chain genesis. It must reject self-approval where prohibited and reject a valid signature from an unauthorised human.

A previously issued approval can remain cryptographically valid after organisational revocation. The pack recognises that settled transactions cannot be retroactively undone, but needs separate rules for approvals that are signed, unused, in-flight or already broadcast. [ADR-2100:56–60; DDD:504–506]

**Structured approval content is still attacker-controlled content.**

A prompt-injected agent can supply an attacker’s destination script and a plausible purpose code. Removing prose prevents one presentation trick; it does not authenticate the economic counterparty or establish that the purchase is wanted.

The approval interface needs trusted resolution of destinations and assets, plus the exact debit and fee exposure. Asset tickers, address aliases and human-readable metadata must not be treated as authority.

**Durability without atomicity does not enforce a budget.**

Two instances can both read “£10 remaining”, reserve £10 and sign distinct UTXO spends. Both spends are valid; the budget is violated.

Surviving a management-api restart tests only persistence. It does not establish atomic reservations, multi-instance consistency, rollback resistance or safe treatment of uncertain broadcasts. [ADR-2100:41–45,76–80]

The existing adapter lifecycle also permits non-orchestrator adapters to degrade to off. That default cannot silently apply to financial policy state. [evidence/R2-agentbox-surfaces.md:366–398]

Define a durable authorisation state machine covering reservation, signing, broadcast, unknown outcome, confirmation, cancellation and reconciliation. An unknown broadcast must retain its reservation until its disposition is established.

Per-asset limits also do not establish a cross-asset risk ceiling. A principal can exhaust several separately permitted assets. Decide whether aggregate value limits exist and, if so, whose valuation is authoritative and what happens when pricing is unavailable.

**“Every outcome has a receipt” is not inherited from the existing receipt code.**

R2 reports a minting function that catches failures and returns a fabricated error URN. It also reports that the governance publisher emits nothing for an unknown outcome. [evidence/R2-agentbox-surfaces.md:232–241,599–612]

Those behaviours conflict with I07, I15 and the claim that every outcome mints a receipt. [DDD:507–509,538–540; ADR-2100:49–50]

The solution is a durable intent and outbox, not merely calling the current helper. Record authorisation before irreversible signing; record uncertainty explicitly; reconcile after crashes. A failed audit write cannot undo an already broadcast transaction.

**The P21 testnet bypass is present in the written conditions.**

I04 triggers on a mainnet parent, `currencyPin = btc` or enabled cash-out. It does not trigger merely because a testnet-parented chain carries economically valuable wrapped assets or service-redeemable claims. [DDD:496–499]

The PRD itself acknowledges that testnet coins redeemable against services carry value. That observation has not become a sealing invariant. [PRD:386–390]

The USDT-specific gate helps that one asset. It does not cover every later bridge asset, a service credit or an L1 child whose parent reference is another sidestr chain rather than a mainnet enum.

Required change: classify economic exposure explicitly and propagate it through nesting and bridges. A child must inherit restrictions from its ancestors and assets. “Testnet parent” cannot be the universal proxy for “no value”.

**Cash-out needs an enforceable definition.**

Does it include:

- ordinary peg-outs;
- bridge redemption;
- automated child close;
- deposit refunds;
- reserve migration;
- AMM withdrawals;
- exporting a transferable claim?

The security plan requires the validator itself to reject prohibited burns, because wallet refusal is bypassable. The pack does not carry that requirement through with equivalent precision. [evidence/PLAN-security.md:535–543; ADR-2103:90–92]

Onboarding filtering is useful presentation behaviour, but it cannot substitute for independent checks at sealing, node opening, signing and bridge operation.

**The owner-and-legal artefact is underspecified.**

A Nostr event has one author. “A signed 31403 approval from the owner and legal principals” must mean two separately authenticated approvals or a precisely defined aggregate envelope. ADR-2103’s singular event ID does not resolve this. [ADR-2103:76–80]

The security plan explicitly requires two humans, but also treats a Git author email containing a DID as an offline-verifiable approval record. Git author metadata is not proof that the DID controller signed anything. [evidence/PLAN-security.md:556–567]

Archive the complete signed approval events and the authorised-principal snapshot. Hashes and relay IDs alone do not make the underlying evidence retrievable after relay loss.

Finally, an old receipt must not unlock all mainnet choices in onboarding. Approval must bind the exact proposed policy, deployment scope, asset set and limits.

**Chain names create an approval and discovery substitution risk.**

DDD explicitly rejects content-addressed chain identity, while upstream admits that a chain name is not proof and initial discovery trusts the signer found in an announcement. [DDD:211–216; upstream-spec/SPEC.md:216–220]

An attacker can advertise another `sidestr:dreamlab` with another genesis and signer set. Local validation of that chain does not prove it is the owner-approved chain.

Keep human-readable names if desired, but pin genesis and policy identity in discovery, account bindings, approvals, receipts, reserve references and cache keys. A URN resolver must not silently redirect a monetary identity to a different genesis.

**5. Regulatory and licensing**

**The legal trigger is the activity and relationship, not the selected parent enum.**

The pack leaves counsel to determine obligations “at first mainnet value”. That is too late and too narrowly framed. Relevant obligations can arise before deposits are accepted, through marketing, customer onboarding or providing a business service involving cryptoassets. [PRD:386–390; ADR-2102:64–67]

For a UK-connected deployment, the pack needs at least the following determinations.

| Activity | Obligation or determination needed | Timing |
|---|---|---|
| Holding customers’ assets or keys through the federation/bridge | Assess custodian-wallet and exchange-provider status under the MLRs; identify the responsible legal entity and obtain required registration. | Before commencing the relevant UK business. |
| Transferring assets for customers | AML controls and applicable Travel Rule collection, verification and transmission. | Operational before relevant transfers. |
| Marketing to UK consumers | A lawful financial-promotion route; fair, clear and non-misleading communications. | Before communicating the promotion. |
| Operating exchange or custody services into the forthcoming expanded regime | Determine required FSMA permissions and transition plan. | Before the relevant commencement and application deadlines. |
| Facilitating reportable cryptoasset exchange activity | Determine CARF status, nexus, due diligence and reporting obligations. | Data collection obligations may already apply in 2026. |
| Holding or transferring assets involving sanctioned persons | Screening, restrictions, freezing and reporting where applicable. | At the relevant holding or transaction, independently of P21. |

The FCA describes the relevant MLR business categories and registration requirements; it also states that UK-facing cryptoasset promotions are technology-neutral and can apply to overseas firms. [FCA AML/CTF regime](https://www.fca.org.uk/firms/financial-crime/money-laundering-terrorist-financing/cryptoassets-aml-ctf-regime), [FCA cryptoasset promotions](https://www.fca.org.uk/firms/cryptoassets)

The Travel Rule has applied to relevant UK cryptoasset businesses since September 2023. A `did:nostr`, transaction hash and principal-collapse record do not supply all required originator and beneficiary information. [FCA Travel Rule expectations](https://www.fca.org.uk/news/statements/fca-sets-out-expectations-uk-cryptoasset-businesses-complying-travel-rule)

As of this review date, the FCA describes the broader regime as commencing on **25 October 2027**, with an application period beginning **30 September 2026**. The pack should distinguish existing AML/promotions duties from future authorisation requirements rather than treating “FCA stablecoin regime” as one undated obligation. [FCA regime overview](https://www.fca.org.uk/publications/policy-statements/cryptoasset-regime), [FCA implementation timeline](https://www.fca.org.uk/firms/cryptoassets-information)

CARF is a material omission. In-scope reporting providers must undertake the specified due diligence and record keeping from **1 January 2026**, with first-period reports due by **31 May 2027**. Whether this operator is in scope requires analysis of its actual services and nexus. [HMRC commencement guidance](https://www.gov.uk/hmrc-internal-manuals/international-exchange-of-information/ieim8000050)

Cryptoasset exchange and custodian-wallet providers are included in relevant-firm sanctions reporting provisions. A proposed automatic payout/refund mechanism must be analysed against applicable restrictions; “the protocol did it” is not an operating policy. [OFSI general guidance](https://www.gov.uk/government/publications/financial-sanctions-general-guidance/uk-financial-sanctions-general-guidance)

**Five hosts do not create five legally independent custodians.** If DreamLab controls the hosts, credentials and release process, the federation is still operationally concentrated. Determine who contracts with users, who owes redemption, who owns the reserves and who bears losses.

**A wrapped USDT claim is not automatically a direct claim against Tether.** The user may hold a claim against the bridge operator, which holds an RGB asset subject to a separate issuer and redemption arrangement. The pack needs the precise rights at each layer, including insolvency treatment, segregation, encumbrance, freezing and recovery.

An on-chain reserve amount does not establish legal ownership or freedom from competing claims. Proof of reserves also does not enumerate all liabilities.

**The inherited regulatory matrix is not legal authority.** R4’s categorical statements that removing custody changes none of the obligations should not be repeated as universal conclusions. Activity, product, territory and business model matter. Gambling and derivatives obligations do not attach merely because a chain can represent value; conversely, removing custody does not necessarily remove exchange, promotion or other obligations. [evidence/R4-canon-assertions.md:106,139,156]

The legal gate therefore needs a scoped determination, named responsible entities, territorial assumptions, customer categories, permitted activities and evidence of required registrations or permissions. “Owner plus legal approved” is not enough information to operate the service.

**The AGPL statement in ADR-2096 is wrong.**

The claim that “AGPL obligations are met by running upstream code as a program, not a library” is not a valid compliance conclusion. [ADR-2096:64–67]

A separate process can support an argument that surrounding programmes are separate works. It does not discharge the AGPL programme’s own obligations. For modified versions supporting remote interaction, section 13 requires an appropriate source offer to remote users. Distribution of containers introduces separate conveyance questions. The contemplated overlay patches make modification an immediate issue. [GNU AGPL v3](https://www.gnu.org/licenses/agpl-3.0.de.html)

Nor is IPC a universal exemption: the FSF’s guidance considers both the communication mechanism and how intimately the programmes interact. [GNU licence FAQ](https://www.gnu.org/licenses/gpl-faq.html.en)

Required actions:

- record the exact licence expressions—R1 reports `AGPL-3.0-or-later`, not merely “AGPL-3.0”;
- inventory the producer, schema engine, explorer, fixtures and modifications;
- define source-offer and distribution compliance;
- document why the boundary separates works;
- preserve provenance for the permissive implementation.

[evidence/R1-sidestr-spec.md:777–780]

**“Clean-room” needs evidence, not a README sentence.** Reading protocol prose and reproducing interoperable behaviour does not automatically make an implementation derivative. Equally, calling something clean-room does not excuse copying implementation expression, test code or protected supporting material. The spec repository itself is reported as AGPL-licensed. Decide what may be reused, preserve provenance and obtain counsel’s view of the intended workflow. [ADR-2096:37–43; evidence/R1-sidestr-spec.md:777–780]

**rgb-lib should not be assigned a fictional AGPL problem.** The current upstream repository identifies rgb-lib as MIT-licensed. Its complete locked dependency graph still requires review, as do bundled tools and copied artefacts. Process isolation remains useful for security and release management, but “unpublished” is not a licence exemption. [rgb-lib repository](https://github.com/RGB-Tools/rgb-lib)

Finally, replacing one RGB process cannot automatically reconcile incompatible contract histories. The process boundary contains software dependencies; it does not contain the economic consequences of choosing the wrong RGB protocol, issuer contract or consignment semantics. [ADR-2102:47–51,63–67]

**6. Internal contradictions across the PRD, ADRs and DDD**

| Subject | Conflicting statements | Resolution required |
|---|---|---|
| **Parent default** | D6 supersedes the earlier SHA-256d choice, but PRD still asks which first seal to choose. [evidence/BRIEF-fact-base.md:167–182; PRD:391–393] | Record the D6 default as settled. Separate that from technical permission to carry value. |
| **Manifest namespace** | Binding brief specifies `[sidechain]`; pack adopts `[payments.sidestr]`. [evidence/BRIEF-fact-base.md:171–179; PRD:267–269; ADR-2103:36] | Honour the binding spelling or record an explicit mapping/amendment. |
| **Header enum** | Manifest uses `knots-blake2b-v2`; domain default uses `knots:blake2b-v2`. [ADR-2103:38; DDD:235] | One schema with an explicit translation, not implicit string equivalence. |
| **Thresholds** | 2-of-3 for P1 and at least 3-of-5 before value. [PRD:217–218; ADR-2101:36–40] | This is a phase distinction, not itself a contradiction. The defect is undefined safety and “at least” without an exact fault model. |
| **Refund guarantee** | Dead chains cost time, not coins; every peg has a refund; already-claimed coins have no refund. [PRD:76–77; DDD:535–537; ADR-2101:42] | Separate unclaimed deposit recovery from claimed reserve custody. |
| **L1 children** | Children are L1; I09 forbids L1 value belonging to multiple principals; close pays multiple holders. [ADR-2101:44–49; DDD:492–495,514–516] | Define the child’s participants and permissible economic activity. A paid counterparty creates the conflict. |
| **Child custody** | Children are custodied by root signers, but their signer is the session’s derived key; upstream L2 reuses block and peg keys. [ADR-2096:55–57; ADR-2101:44–45; upstream-spec/proposals/level-2.md:47–50] | Specify separate block, peg and recovery descriptors for children. |
| **Signer derivation** | HMAC from `k_id`; also dedicated hardened BIP-32 signer accounts. [ADR-2101:54–62] | One normative derivation per role. |
| **Balance and privacy** | Balance is a fold over one per-chain script; receive addresses are per-purpose. [ADR-2099:33–36; ADR-2101:68–73] | Define address discovery, indexing, recovery and balance categories. |
| **Kind 38110** | Account binding in ADR-2098; peg-out default in DDD. [ADR-2098:40–45; DDD:445] | Reallocate and register disjoint schemas before implementation. |
| **Additional kinds** | PRD registers upstream kinds and 38110; DDD allocates 38111–38115 as well. [PRD:306–307; DDD:449–464] | Publish one complete registry with addressability and retention semantics. |
| **Gate reference** | ADR uses `p21Receipt` as an event ID; DDD uses `p21ReceiptUrn`; containment omits both. [ADR-2103:53–55,78–79; DDD:244] | Specify the signed artefact, identifier, resolver and genesis commitment. |
| **Approval policy** | “Zero-tolerance” class; human approval above a threshold; thresholds per asset/principal; threshold shape still an open question. [ADR-2100:22–25,34–38,61–63; PRD:380–381] | Define the automatic-policy and human-approval boundaries exactly; close the already-decided question. |
| **Gate sequencing** | DDD puts P21 first, but wires spend authority after chain settlement migration. PRD puts authority in P2 and M4 implementation in P4, although P4 cannot start without it. [DDD:714–717,740–750; PRD:315–324] | A single dependency graph with safety gates preceding every affected capability. |
| **Deletion versus adaptation** | PRD/ADR delete FsPaymentStore and `/pay/*`; DDD retains ledger shapes and HTTP contracts through adapters. [PRD:237–239; ADR-2099:37–42; DDD:586,733–738] | Decide implementation removal separately from public API compatibility. |
| **Anchor destination** | ADR-2099 uses the root chain; DDD uses gitmark. [ADR-2099:48–51; DDD:453,751] | Choose the authoritative anchoring chain and its relationship to the root. |
| **AMM fate** | ADR-2096 says it remains the exchange surface; PRD asks whether to keep, gate or retire it. [ADR-2096:52–54; PRD:382–383] | Decide before ledger APIs are removed. |
| **Bridge grammar** | ADR uses `issue:`/`tally:`; DDD requires new `bridge:` issuance; upstream assigns txid asset identities. [ADR-2102:35–40; DDD:303–305; upstream-spec/proposals/assets-and-pools.md:20–38] | Specify one actual consensus rule and identity model. |
| **Compatibility** | Local fields are ignorable additions; local fields change validity. [DDD:613–622; ADR-2103:45–60] | Declare mandatory protocol extensions. |
| **Rotation** | Signer-set changes are required rule documents and reserve migration; rotation/recovery are future work. [ADR-2101:42–43; DDD:697–699] | Distinguish planned topology from an implemented safe reconfiguration protocol. |
| **Trust levels** | DDD claims conformity with existing L0–L3 vocabulary, while the estate’s earlier levels describe different constructions. [DDD:593; evidence/R3-pods-forum-visionclaw.md:223–235] | Use an explicit mapping or distinct typed enums. Never compare unrelated levels numerically. |

Two further wording problems have monetary consequences:

- “The only credit is a peg-in claim” is false for a principal receiving an ordinary transfer, and for wrapped issuance. If it means “the only creation of base supply”, say that. [ADR-2099:43–45]
- A single `btc`/`tbtc4` currency pin does not identify which fork asset is owed. Amounts need exact asset and parent-network identity; fork coins are not interchangeable merely because both use sats. [DDD:238–243; ADR-2103:36–42]

**7. Decisions missing, and decisions made prematurely**

**The pack should have decided the following before presenting itself for ratification.**

1. **The adversary and safety target.** How many Byzantine, unavailable and simultaneously rebuilt signers? How independent are their operators, credentials, release channels and parent nodes? What is the tolerated loss and outage? “Distinct hosts” is insufficient. [ADR-2101:36–43]

2. **Canonical history and external finality.** Exactly when may a bridge release, a merchant deliver irreversible service or an anchor be treated as final? What happens after conflicting certificates or parent reorgs? [DDD:557–559; upstream-spec/proposals/checkpoints.md:9–16]

3. **The reserve ownership and liability model.** Who owns each deposit before minting, after minting and after burning? Which reserve backs which claim? Who pays fees and losses? [DDD:269–319,485–513]

4. **The complete wrapped-asset protocol.** Reissuance, authenticated reserve attestations, unique allocations, decimals, amount bounds, asset-aware spending and redemption identity. [ADR-2102:35–42]

5. **Child recovery and close.** Independent settlement supervision, signing authority after session loss, parent destinations, asset distribution, dust and transaction-size limits, pruning and retention. [DDD:322–342]

6. **Signer replacement and emergency exit.** Including compromise, lost keys, a dead operator and inability to obtain the old threshold. A reserve migration requiring the lost quorum is not recovery. [ADR-2101:42–43]

7. **A complete signing-capability inventory.** HTTP, Nostr ingress, identity port, producer wallet, bridge, maintenance commands and legacy AMM routes. Each needs a stated policy boundary. [ADR-2100:34–55; ADR-2098:51–60]

8. **Atomic financial operational state.** Budget reservations, approvals, pending payments, reserve allocations and reconciliation are indispensable even though the chain remains the balance ledger of record. [ADR-2100:41–50; DDD:298–319]

9. **The release and audit gate.** The security plan requires independent validator, wallet, co-signer and bridge audits plus custody and insolvency reviews. The pack makes narrower audit commitments. Restore the full gate explicitly. [evidence/PLAN-security.md:835–853; ADR-2102:64–66; ADR-2103:67–68]

10. **Migration and retirement.** Reconciliation of existing obligations, cutover ordering, old writer disablement, legacy asset redemption and rollback boundaries. [DDD:709–753]

11. **Protocol ownership.** Which exact local specification is normative when upstream prose, fixtures and code disagree? Who approves changes, and how are old chains maintained? [DDD:617–622]

12. **The legal operating model.** Responsible entities, countries, customer classes, custody terms, permitted assets, records and registrations. [PRD:386–390]

**Several choices are premature or over-specified.**

- **“At least 3-of-5”** selects a number before selecting a consensus fault model.
- **The exact close coinbase construction** selects an invalid mechanism before specifying the terminal state transition.
- **“One process is replaced”** overstates replaceability before RGB contract migration and data recovery are understood.
- **48-bit asset identifiers** should not become the sole security identity of externally valuable assets. DDD specifies a 12-hex-character digest; birthday collisions become plausible around the order of \(2^{24}\) generated identifiers. Use a full digest authoritatively and shorten only for display. [DDD:218–221]
- **Short child address prefixes** are acceptable as presentation only. The collision counter covers live siblings, not every retired chain or another deployment; neither the prefix nor its counter should authenticate a chain. [ADR-2101:77–78]
- **“No wallet object”** is a terminology preference masquerading as architecture. Recovery descriptors, address indexes, pending transactions and holds still exist. Their absence from the model makes operations less explicit; it does not eliminate state. [PRD:177–180]
- **An exact 1,000-block parity threshold** is not a production readiness criterion. It tests agreement on sampled accepted history, not invalid-block rejection, adversarial scheduling, safe signing or recovery. [PRD:206–207; ADR-2096:49–51]
- **Treating both header profiles as immediately equally proven** goes beyond the evidence. D6 requires both codecs and configurable selection; it does not require pretending both have identical maturity. [ADR-2103:45–51,105–107]

The pack should retain implementation flexibility where the protocol has not yet been established, while becoming much more exact about monetary safety, authority and recovery.

**8. Verdict and ranked changes**

**MUST change before the owner ratifies this pack**

1. **Replace the consensus assurance with a specified safety protocol.** Resolve quorum intersection, timeout re-signing, durable locks, reconfiguration and finality. Include the conflicting-certificate attack as a mandatory test.
2. **Repair the peg lifecycle and refund claims.** Prove that a deposit cannot both back circulating claims and remain refundable by its original depositor.
3. **Replace the monetary invariants with valid accounting.** Include parent fees, pending redemptions, immature/locked outputs and nested representations.
4. **Specify the wrapped-asset consensus extension.** Repeated issuance of one asset, authenticated reserve allocation and final burn-to-release processing must be real rules.
5. **Specify child close and crash recovery.** The ordinary coinbase rules do not implement the proposed close; session hooks do not provide liveness.
6. **Make key isolation true at the root and service boundary.** Agent-accessible identity secrets and unrestricted signing ports must not recreate custody authority.
7. **Define an enforceable approval digest and atomic budget state machine.** Cover all signing paths, fees, outputs, replay and unknown outcomes.
8. **Repair P21 commitments and broaden the gate to economic value.** Bind complete approvals, bridge exposure and inherited child restrictions using an acyclic sealing procedure.
9. **Declare the local protocol version and compatibility boundary.** Stop describing validity-changing fields as ignorable metadata.
10. **Resolve the cross-document contradictions and release order.** Especially kinds, key derivation, close semantics, gate identifiers, AMM fate and anchor destination.
11. **Restore the security plan’s full independent audit requirement before any real value.** The bridge alone is not the whole loss surface.
12. **Correct the licensing conclusion and obtain a scoped legal operating determination.** A sidecar is not an AGPL compliance strategy by itself; a testnet parent is not universal regulatory containment.

These are changes to the decision pack and its acceptance criteria. Ratification need not pretend all implementation already exists. It must, however, stop authorising implementation against contradictory or unsafe requirements.

**SHOULD change**

1. Add explicit exposure caps, degraded modes and published recovery objectives.
2. Add fault-injection tests covering stale restores, split-brain signers, delayed certificates, relay loss, deep reorgs and bridge retries.
3. Pin source commits, container digests and complete protocol dependencies. R1 calls a `#v0.0.27` tag a commit hash; that evidence is not sufficient for immutable provenance. [evidence/R1-sidestr-spec.md:814–819]
4. Define privacy expectations compatible with public account bindings and independently replicated transaction histories.
5. Replace zero-balance migration sampling with reconciliation of actual liabilities and non-zero state.
6. Define archive retention and recovery of RGB consignments, child close proofs and complete signed approvals.
7. Separate operator-controlled hosting redundancy from independent custody and consensus fault domains.

**Overall risk: Critical for real-value activation; high but containable for a genuinely valueless research deployment.**

The critical rating follows from demonstrated design counterexamples, not merely project age:

- two valid conflicting histories;
- deposit claim plus refund;
- reserve depletion through normal fees;
- an issuance rule that cannot perform the promised operation;
- a close rule conflicting with ordinary validity;
- approval and containment commitments that do not enforce their stated properties.

Adopting a six-day-old, apparently single-author specification as the **sole value instrument is not defensible as immediate production adoption**. The supplied history is too limited even to establish the project’s complete contributor history, and the quoted 1,377 lines exclude substantial underlying consensus machinery. Age, author reputation, small size and successful live transfers are not substitutes for a monetary protocol and recovery proof. [evidence/R1-sidestr-spec.md:782–807]

It is defensible as a constrained engineering commitment under D0–D6 only if “adoption” means:

- freezing and owning a reviewed protocol version;
- treating bridge, close, containment and consensus repairs as original protocol work;
- allowing no customer funds, redeemable service value or misleading USD claims during research;
- completing independent audits and destructive recovery testing before activation;
- operating within explicit exposure limits and legal permissions;
- retaining a credible wind-down and migration procedure.

The binding owner choice determines the intended destination. It does not make this decision pack safe enough to authorise the journey with other people’s money.