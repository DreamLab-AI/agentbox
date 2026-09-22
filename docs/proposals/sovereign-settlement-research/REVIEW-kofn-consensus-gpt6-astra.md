---
title: Level 2 (k of n) — independent consultant review
date: 2026-09-22
consultant: GPT-6 Astra via the codex CLI (consultant tier), question and material assembled by the agentbox session
subject: sidestr level-2 design (upstream proposals/level-2.md, siding/lib/federation.mjs, siding/lib/round.mjs), ADR-2101's adversarial amendments, and sidestr-core 0.1 src/block.rs signing and verification
status: adopted as input to sidestr-core 0.2 step 3 and to the federation project; ADR-2101 amended the same day
---

# Level 2 — consultant review (verbatim answer)

The question put to the consultant asked for creative but sound designs fixing the five
adversarial findings on k-of-n (quorum intersection, timeout re-signing, finality before
external release, custody roots, restore fencing), comparing `multi_a` script-path witnesses
with MuSig2 and FROST, reusable Rust consensus crates against a purpose-written HotStuff-style
state machine, a checkable finality rule, custody and rotation, and a test plan. The full
prompt and material are in the session scratchpad; the material was upstream's level-2
proposal and code, ADR-2101's amendments, and the relevant sidestr-core functions.

**Recommendation: ship `multi_a` for 0.2, use a separate BFT consensus protocol, and release block signatures only after that protocol decides the block template.** For five instances, use **four consensus votes and four custody signatures**, assuming at most one Byzantine instance. Keep aggregation as a later optimisation.

Two qualifications matter:

- Existing sidestr validators can continue checking the same witness-validity rule, but **they do not thereby become finality-aware**. Merchants, bridges and your federation’s fork choice must verify your protocol profile’s finality certificates.
- Some ADR-2101 language needs correction: honest replicas may safely vote for different candidates in different views. What must never happen is conflicting votes within the same voting slot, violations of locking rules, or signing conflicting **decided** blocks.

The versions below are those observed during this review. “Published”, “audited” and “battle-tested” are separate claims.

**1. State the fault model before choosing the signature scheme**

Distinguish:

```text
n = committee size
f = maximum Byzantine logical signers
q = consensus certificate threshold
k = Bitcoin/block authorisation threshold
```

For equal-sized consensus quorums, require:

```text
2q − n > f      safety intersection contains an honest participant
q ≤ n − f      liveness despite Byzantine participants withholding votes
```

These inequalities require `n ≥ 3f + 1`. Merely assuming `2q−n>f` does not produce a smaller Byzantine model with both safety and liveness.

| Instances | Byzantine bound | Suitable q | Recommended k |
|---:|---:|---:|---:|
| 3 | 0 | 2 | 2; crash-only research profile |
| 4 | 1 | 3 | 3 |
| 5 | 1 | 4 | 4 |
| 6 | 1 | 4 | 4 |
| 7 | 2 | 5 | 5 |

Do not mechanically use `2f+1` when `n>3f+1`: three votes out of five are insufficient for `f=1`.

The mandatory counterexample is:

```text
Committee: M, A, B, C, D       M is Byzantine

certificate(X) = {M, A, B}
certificate(Y) = {M, C, D}

Every honest signer signs once. Both 3-of-5 witnesses validate.
```

There is, however, a useful refinement to the review: **a 3-of-5 custody threshold can safely sit behind 4-of-5 consensus**, provided every honest custody signer requires a valid decision certificate before signing, and `k>f`. A conflicting authorisation would then require an honest signer to accept a conflicting decision.

That is not three-node consensus availability: deciding still requires four. For your first implementation, `q=k=4` is easier to operate and explain.

Also, five processes controlled through one administrative account or deployment credential are not five independent Byzantine fault domains.

**2. Signature schemes: keep consensus separate in every case**

| Property | `multi_a(k,n)` | MuSig2 | FROST Taproot |
|---|---|---|---|
| Authorisation | Any k individual keys | **All n aggregate-key participants** | Any threshold-sized subset of shares |
| Signature exchange | Independent signatures; no shared nonce round | Nonce round, then partial signatures | Commitment round, then signature shares |
| Result | Script-path witness, k signatures, n slots, script/control block | One BIP-340 signature | One BIP-340 signature |
| Attribution in final witness | Individual signers visible | Participants not individually visible | Signing subset not visible |
| Failed participant | Choose another subset | Any missing participant blocks that aggregate key | Restart with another subset |
| Key setup | Independent keys | Key aggregation; no DKG | Trusted dealer or DKG |
| Recovery | Keys plus complete descriptor | Participant keys plus aggregation/derivation data | Shares plus public packages and ceremony metadata |
| Consensus safety improvement | None inherently | None inherently | None inherently |

MuSig2 is n-of-n; aggregating whichever k keys happen to answer produces a **different public key**, not a k-of-n spend under the original key. Its nonce handling and key aggregation must follow BIP-327. [BIP-327](https://github.com/bitcoin/bips/blob/master/bip-0327.mediawiki)

**Wallet compatibility has advanced.** Bitcoin Core 30 added BIP-373 PSBT fields. Actual wallet MuSig2 signing was separately merged in PR #29675 and is present in the v31 codebase, whose descriptors include `musig(...)`. Thus “Core cannot co-sign MuSig2” is now too broad. Pin and test your exact Core release and descriptor workflow. [Core BIP support](https://github.com/bitcoin/bitcoin/blob/master/doc/bips.md), [wallet implementation](https://github.com/bitcoin/bitcoin/pull/29675), [v31 descriptors](https://raw.githubusercontent.com/bitcoin/bitcoin/v31.0/doc/descriptors.md)

The practical flows are:

- **`multi_a`:** each wallet adds BIP-371 script signatures to the same PSBT; combine and finalise. Wallets can participate independently.
- **MuSig2:** distribute the identical PSBT, collect all public nonces, distribute the completed nonce set, collect partial signatures, aggregate. Core’s implementation keeps secret nonces in memory; restarting requires restarting the signing session.
- **FROST:** use an external threshold signer/coordinator. Insert the completed signature into `PSBT_IN_TAP_KEY_SIG`; Core can then handle the final transaction. Ordinary descriptor import does not make Core a FROST participant.

A key-path signature is 64 bytes with `SIGHASH_DEFAULT`; non-default Taproot sighash types add a byte. The parent transaction saves witness weight and conceals the policy. Your sidestr solution is embedded in coinbase output data, so do not apply Bitcoin’s witness discount to its storage savings.

**Crates and maturity**

| Component | Version observed | Assessment |
|---|---:|---|
| `bitcoin` | `0.32.102` | Appropriate continuation of your 0.32 dependency line |
| `miniscript` | `12.3.7` compatible with Bitcoin 0.32; latest observed `13.1.0` | Use for descriptors, satisfaction and recovery tooling |
| `secp256k1` | latest `0.33.1` | Current library exposes MuSig2 bindings; Bitcoin 0.32 itself depends on the 0.29 line |
| `secp256k1-zkp` | `0.11.0` | Its documented Rust API does **not** expose the MuSig2 module; do not infer bindings from the C project |
| `musig2` | `0.4.1` | Maintainer describes it as beta; I did not locate an independent audit covering this release |
| `frost-secp256k1-tr` | `3.0.0` | Stable-project lineage, but the published NCC audit explicitly excluded this ciphersuite |

Sources: [Bitcoin](https://docs.rs/bitcoin/0.32.102/bitcoin/), [Miniscript](https://docs.rs/miniscript/12.3.7/miniscript/), [rust-secp256k1](https://github.com/rust-bitcoin/rust-secp256k1), [zkp API](https://docs.rs/secp256k1-zkp/latest/secp256k1_zkp/), [`musig2` status](https://github.com/conduition/musig2), [FROST audit scope](https://github.com/ZcashFoundation/frost/blob/main/README.md).

The NCC FROST audit covered the listed v0.6.0 core/ciphersuite implementations, including ordinary `frost-secp256k1`, key generation and signing. **That is not an audit of `frost-secp256k1-tr` 3.0.0.**

I would call Bitcoin’s ordinary Schnorr/Taproot validation infrastructure battle-tested. I would not transfer that label automatically to recent Rust MuSig2 wrappers, FROST Taproot integration, or your nonce/session persistence.

Current `secp256k1` bindings deserve evaluation before adopting `secp256k1-zkp` for MuSig2. Keep different crate-version key types behind explicit serialisation boundaries.

Two later options are sound but change the descriptor profile:

- **MuSig2 cooperative path plus `multi_a` fallback:** `tr(musig(...),multi_a(k,...))`. All-online spends are compact; k participants retain a fallback. This replaces NUMS and cannot spend existing outputs through a newly invented key path.
- **FROST key path plus independent recovery leaf:** potentially useful for custody recovery, but every recovery path becomes part of the security model. It adds ceremony and recovery complexity.

Neither is necessary for seven signers.

**3. Consensus: a small established protocol, with explicit persistence**

My order of preference is:

1. Evaluate Commonware Simplex with a Nostr transport adapter.
2. If that integration is disproportionate, implement an unoptimised, published protocol faithfully as a pure state machine.
3. Do not design a new “two votes plus a timeout” protocol.

| Candidate | Fit for this federation |
|---|---|
| `commonware-consensus 2026.9.0` | Best listed compositional candidate: application-defined payloads, persistence, certificates and deterministic runtime. Current Simplex is marked **BETA**, not the blanket ALPHA status shown by old docs. Budget for transport and recovery integration; I did not establish audit coverage for your proposed composition. |
| HotShot | Real BFT implementation, but the standalone repository moved into Espresso’s sequencer monorepo. Substantial integration surface; pin a source commit rather than assume an off-the-shelf `hotshot` crate. |
| Narwhal/Bullshark | DAG dissemination/ordering is excessive for 3–7 replicas at this rate. Development moved into Sui; extracting it creates dependency and maintenance work. |
| `tendermint 0.40.4` | Types, serialisation and related client components; `tendermint-rs` is not a ready embedded Tendermint consensus engine. |
| `openraft 0.9.25` | Credible choice for a declared crash-fault-only deployment. Signed messages do not upgrade Raft to Byzantine safety. |

Sources: [Simplex](https://docs.rs/commonware-consensus/latest/commonware_consensus/simplex/index.html), [current stability annotation](https://raw.githubusercontent.com/commonwarexyz/monorepo/main/consensus/src/lib.rs), [HotShot migration](https://github.com/EspressoSystems/HotShot), [Narwhal migration](https://github.com/MystenLabs/narwhal), [Tendermint components](https://github.com/cometbft/tendermint-rs), [OpenRaft](https://docs.rs/openraft/0.9.25/openraft/).

For a purpose-written implementation, **Basic HotStuff is a reasonable specification baseline**, with no pipelining initially:

```text
NEW_VIEW → PREPARE → PRECOMMIT → COMMIT → DECIDE
```

The leader collects q new-view reports and proposes extending the highest prepare QC. A replica prepares only if the proposal extends its lock or its justification is newer than that lock. A prepare QC enables precommit; a precommit QC installs the durable lock and enables commit. A commit QC establishes decision. Distinct phases are signed distinctly. Follow the paper’s ancestry and justification rules exactly; the diagram alone is not an implementation specification. [Basic HotStuff, Algorithm 2](https://pdos.csail.mit.edu/6.824/papers/hotstuff.pdf)

Your state machine should persist:

```rust
struct SafetyState {
    epoch: Epoch,
    view: View,
    highest_prepare_qc: PrepareQc,
    locked_qc: PrecommitQc,
    last_decided: Decision,
    votes: VoteJournal,
    block_authorisations: AuthorisationJournal,
    incarnation: Incarnation,
}
```

Key rules:

- One value per `(epoch, view, phase, consensus instance)`.
- Later-view voting follows the protocol’s safe-proposal rule.
- A timeout changes the view; it never deletes a lock or signing record.
- Decision certificates and previously produced signatures can be retransmitted indefinitely.
- Advance to another height only from the agreed predecessor.
- All replicas can collect votes, reconstruct certificates and disseminate decisions. The proposer must not be the sole owner of progress.

Implement an output boundary such as:

```text
event → proposed state transition → durable transaction/fsync
      → signing request → durable signed outbox → relay publication
```

Persist the irrevocable signing intent before invoking an external signer. After a crash, reproduce or retransmit that same vote; never choose another value for its slot.

Use a single owner for consensus state. Relay callbacks should enqueue messages, not mutate safety state across `await` points.

**Liveness requires an explicit network assumption:** eventually, enough honest replicas can exchange messages through the relays within sufficiently long timeouts. Safety can survive arbitrary delays; bounded progress cannot survive permanent relay censorship or partition. Use increasing view timeouts and a specified pacemaker. The 10-second transaction cadence is a target, not a guarantee over public relays.

**4. Separate template decision, sealing and exact-block finality**

There is an additional issue in the supplied Rust: `seal_block()` inserts the solution, recomputes the coinbase-dependent Merkle root, and searches a nonce. Different valid witnesses can therefore yield different block hashes for the same unsigned content.

Consequently:

```text
unsigned template identifier ≠ final sealed block hash
```

Choosing the first k signatures in key order does not make the result globally canonical: different replicas may possess different subsets.

A conservative design is:

1. **Consensus decides `AUTHORISE_TEMPLATE`.** Its payload binds the canonical unsigned template, height, exact predecessor hash, chain/genesis, epoch and rules.
2. Honest block signers verify that decision and release BIP-325 signatures only for that template.
3. Anyone collects k signatures and constructs a valid sealed block.
4. **Consensus decides `FINALISE_BLOCK`.** Its payload binds the exact sealed block hash and the template decision.
5. External release and the next block use this finalised hash.

Both decisions can be commands in the same ordered BFT log. Do not use an ad hoc “one finalisation vote per height” collector for step 4: competing witness encodings could split those votes and recreate the original deadlock.

This costs another agreement but cleanly handles witness and nonce variability without changing block validity. At your scale, that is a defensible first implementation. Optimising it requires a proof about the chosen consensus engine and block encoding.

Crucially, never permanently choose a k-member signing subset before collecting signatures: a member could withhold after selection. Authorise the template for the whole committee and allow any k valid signatures.

**5. Nostr wire profile and certificate availability**

**Kinds 23510–23514 are ephemeral under NIP-01.** Relays are not expected to retain them. Also, standard tag filters cover single-letter tags; `chain` is not a portable indexed filter. [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md)

Keep those kinds as optional live notifications, but define regular stored events for protocol records. For example, reserve a profile-specific family such as `41010`–`41017`, after checking allocations and relay support:

| Illustrative kind | Payload |
|---:|---|
| 41010 | Proposal and justification |
| 41011 | Phase vote |
| 41012 | Timeout/new-view report |
| 41013 | QC/decision certificate bundle |
| 41014 | Block signature plus template-decision reference |
| 41015 | Sealed block or chunk manifest |
| 41016 | Finality proof / epoch transition |
| 41017 | Fetch request or response |

These are **proposed allocations**, not existing registered sidestr kinds. Stored-event classification still provides no retention guarantee.

Use tags for routing:

```text
g = genesis/profile scope
h = application height
v = view
e = referenced event
```

The authoritative signed payload should include:

```text
protocol/version
genesis or pre-genesis scope
epoch + committee/configuration hash
consensus instance + application height
view + phase
candidate digest + predecessor
justification digest
logical signer ID + incarnation
```

Define one canonical encoding with bounded lengths and integer representations. Reject duplicate/conflicting routing tags and disagreements between tags and payload.

Nostr event IDs are transport identifiers. Re-publication can change them; votes must identify the consensus candidate independently.

For custody separation, use:

- An outer Nostr signature for transport authentication.
- An inner consensus signature from the protected consensus service.
- A chain-authorised mapping between transport identity and logical signer.

Otherwise compromise of the broadly sourced Nostr key is also compromise of your consensus voter.

For seven members, a QC can simply contain a common statement, signer indices and individual signatures. Verify distinct authorised signers, matching phase/view/configuration and at least q signatures. Aggregating consensus signatures provides little practical benefit here.

Persist complete certificates locally and republish them across several relays. Implement fetch by digest and bounded chunking for blocks/certificate bundles. Eliminate `since: 600` as a recovery mechanism and eliminate `created_at` expiry as a safety rule. An old decision remains valid.

**6. Finality and external release**

Define a finality proof with at least:

```text
trusted genesis/profile
authorised epoch/configuration chain
template decision certificate
sealed block/header and template binding
FINALISE_BLOCK decision certificate
transaction inclusion proof, when proving a payment or burn
```

A client verifies the quorum signatures, configuration authority, exact block hash, predecessor linkage, sidestr witness and relevant inclusion proof. It need not replay proposals, timeouts or vote arrival order.

A light client still relies on the federation’s validity attestations unless it independently validates the complete state transition. A QC is not a proof of UTXO execution.

For peg-out:

1. Verify that the burn belongs to a finalised block.
2. Construct a payment intent binding burn identifier, parent network, destination, amount, permitted fees, inputs and change descriptor.
3. Order that intent through consensus.
4. Custody services verify both proofs and their durable payout ledger before signing.
5. Record transaction replacement, broadcast and confirmation states.

“One signature per burn” is too rigid for fee replacement and insufficient for exactly-once payment. A replacement must preserve the authorised payment and conflict with the previous transaction, or otherwise have a carefully specified exclusivity rule. Two different input sets can pay the same burn twice.

Publishing a spend-capable partial signature is already an authorisation boundary: once enough signatures exist, another party can broadcast. Finality checks must precede signing, not just broadcasting.

Embedding a QC or its hash in the **next** coinbase can improve archival availability, provided that metadata is permitted and remains in the signed commitment. But:

- A hash alone does not make the certificate available.
- An arbitrary QC is not necessarily a finality certificate.
- Waiting for another ordinary block adds up to the heartbeat interval.
- Requiring every certificate to be justified by the next certificate creates an infinite regress.

Use a directly verifiable final decision certificate for immediate finality; next-block embedding is archival reinforcement.

For parent checkpoints, prefer a **serial checkpoint UTXO** whose spends commit to successive finalised checkpoints, rather than unrelated OP_RETURN announcements. A client must verify parent-chain inclusion and your confirmation policy. Checkpointing adds parent reorganisation assumptions and does not repair an unsafe federation.

If an anchor is merely publishing evidence, banning all pre-finality anchors is unnecessarily broad. If anchoring itself defines settlement finality, specify “BFT decision → parent inclusion → settlement finality” explicitly.

**7. Restores: a journal counter is not anti-rollback**

An epoch or incarnation stored in the restored snapshot rolls back with the snapshot. A fencing event also does not revoke a private key’s ability to produce valid Bitcoin signatures.

I recommend placing the safety journal and signing authority in a **separate signer service whose state is not restored with the application host**. The application host becomes a replaceable requester.

That service must:

- Enforce vote slots, locks, decision checks and payout policy itself.
- Durably record authorised operations.
- Enforce exclusive application incarnations.
- Reject requests from stale incarnations.
- Refuse conflicting signatures even from a currently authorised caller.

A generic HSM “sign digest” endpoint is not sufficient: it protects key extraction, but the application can still request conflicting signatures.

For disaster recovery after uncertain journal loss:

1. Keep the old signer disabled.
2. Obtain a trusted checkpoint and authoritative safety state from outside the rollback domain.
3. Prove the old instance cannot continue using the key, or retire that key.
4. Admit a new key/incarnation through a finalised configuration transition.

No finite collection of replayable relay events proves that no newer fence exists. Under an isolated or censored view, recovery must halt.

A chain-authorised incarnation helps peers reject stale protocol messages, but it does not invalidate old raw signatures or confiscate parent UTXOs. Parent custody fencing ultimately requires key isolation or moving funds.

For MuSig2/FROST, rollback additionally threatens nonce reuse and key extraction. Bind nonce sessions to the full operation and participant set; never reuse a nonce after an abort, crash or changed signing package. Restored snapshots must not resurrect nonce pools.

**8. Custody roots, derivation and rotation**

There is a constraint conflict to resolve explicitly:

> A block challenge and parent peg output that are literally the same descriptor necessarily use the same public keys. They cannot simultaneously have independent block and peg private keys.

Under the strict compatibility constraint, treat **federation block/peg authorisation as one custody role**, independent from identity and from any separate bridge custody role. A later profile can introduce distinct block and peg descriptors while preserving the general witness-validity mechanism, but that changes the upstream “same descriptor” convention.

For independent-key schemes:

- Generate independent seeds per signer and custody role.
- Use `bitcoin::bip32` for hardened derivation.
- Include protocol version, role, epoch and a collision-resistant chain scope.
- Use a pre-genesis commitment when the eventual genesis depends on the derived keys.
- Encode the chain scope across sufficient hardened path components, or use an explicit recovery registry. Do not truncate a genesis hash to one 31-bit index and assume uniqueness.
- Export concrete public keys at hardened boundaries; watch-only software cannot derive hardened children from an xpub.

The recovery package should contain the descriptor/checksum, exact key order, key origins, derivation paths, NUMS derivation, tree and leaf versions, internal/output keys, epoch activation history, parent network/genesis, scan birthday and outstanding custody state. A seed alone is insufficient operational recovery.

For FROST, **do not independently BIP-32-derive the shares**: that generally destroys their polynomial relationship. Back up the actual share packages, participant identifiers, verification shares, group key and tweak state. Individual seed recovery is not automatically DKG-share recovery. DKG requires consistent authenticated broadcasts and confidential participant-specific messages; public relay transport needs an encrypted, authenticated layer for the latter.

Also test the exact FROST API’s tweak behaviour: record whether a key package represents the internal or already-tweaked output key. Double tweaking produces the wrong address.

Signer changes should be ordered transitions:

```text
old committee finalises new configuration
→ new committee acknowledges readiness/state
→ activation boundary
→ new committee extends the authorised finalised checkpoint
```

A joint old/new quorum handoff is a conservative choice. “New signer document with a future height” is not sufficient unless its authority and activation semantics are finalised.

| Scheme | Add/remove/rotate |
|---|---|
| `multi_a` | New descriptor and challenge; old UTXOs retain old policy |
| MuSig2 | Changed participant key set changes aggregate key |
| FROST | Fresh DKG changes key; resharing may preserve it if supported and correctly executed |

FROST resharing does **not** cryptographically disable a threshold of retained old shares. If removal means revocation of possibly compromised custody, migrate to a new group key and sweep funds.

In every scheme, maintain old signing capability until old outputs are spent, account for late deposits to old addresses, and track migration confirmation. Changing a chain document cannot rewrite an existing parent output.

**9. Concrete Rust and upstream changes**

Keep pure encoding/verification in `sidestr-core`; put journals, consensus, relays and custody policy in separate crates/services.

For the supplied Rust:

| Location | Required change |
|---|---|
| `block_sighash()` | Add a typed spend-path context: key path versus script path, leaf hash, annex and code-separator position where applicable |
| `sign_block()` | Preserve as the level-1 convenience API; introduce separate partial-signing and witness-assembly APIs |
| `verify_block_signature()` | Dispatch through Taproot validation supporting both paths |
| `verify_key_path_input()` | Keep accurately named as a key-path helper; it is not the level-2 verifier |
| `challenge_for()` | Distinguish an already-tweaked output key from a descriptor internal key |
| `seal_block()` | Treat its result as a new exact-block identity requiring finalisation |
| Witness encoding/decoding | Bound allocations/counts, reject truncation/trailing garbage as appropriate, and cover PUSHDATA/CompactSize boundaries |

For script path, verify the control block and output commitment, leaf version, Tapleaf hash and correct Tapscript sighash before evaluating signatures. Use **reverse leaf order** for the witness stack, and exactly k nonempty valid signatures for this `NUMEQUAL` leaf.

Reject duplicate signer keys in chain configuration. Otherwise multiple positions can represent the same custody authority.

Do not mistake “count k signatures” or a Miniscript satisfier for a general consensus interpreter. `bitcoinconsensus 0.106.0+26.0` exposes the Core-derived verification interface, including the spent-output information required for Taproot. It is useful as a validation backend or differential oracle, with explicit acknowledgement of its older Core lineage. [API](https://docs.rs/bitcoinconsensus/latest/bitcoinconsensus/)

If implementing a narrowly scoped verifier for the exact `multi_a` template, label unsupported scripts distinctly and prove equivalence for that supported domain. Do not claim generic sidestr script compatibility.

Preserve consensus acceptance of valid 64/65-byte signatures and annex behaviour even if your signing policy only emits default-sighash/no-annex witnesses. Production policy must not accidentally become a stricter consensus rule. Tapscript has additional failure semantics beyond Schnorr verification. [BIP-342](https://github.com/bitcoin/bips/blob/master/bip-0342.mediawiki)

Audit `family.signed_prefix()` and `stripped_coinbase()` directly: prove which nonce/header fields can change during sealing, and which metadata remains committed. Those bodies were not supplied here.

For `round.mjs` behaviour being ported:

- Delete `mayReSign` timeout relaxation.
- Replace clock-based entitlement with explicit views and leader selection.
- Replace the in-memory `signed` map with durable safety state.
- Remove proposer-exclusive aggregation.
- Require decision proofs before block signatures.
- Treat `onSealed()` as candidate ingestion, not finality.
- Replace highest-tip preference with highest **finalised** compatible history.
- Validate proposals against deterministic chain/UTXO rules; local mempool membership or policy is not consensus validity.
- Retain historical certificates and fetch missing dependencies by digest.
- Authenticate peg-out policy and maintain a durable payout state machine.

**10. Mandatory verification before advertising Byzantine safety**

| Test | Required outcome |
|---|---|
| 3-of-5 conflicting-certificate attack | Demonstrate both old witnesses validate; new profile cannot finalise both |
| Honest timeout re-signing under old protocol | Reproduce conflicting authorisations without Byzantine honest-code behaviour |
| Same-slot equivocation | Two different signed values produce independently verifiable evidence |
| Legitimate later-view voting | Accepted when justified; not falsely classified as equivocation |
| Proposer death | Kill before/after every phase, QC, signature publication and decision; another node completes |
| Partition | Safety under every partition; progress resumes after sufficient connectivity returns |
| Replay | Old proposals, votes, epochs and certificates cannot roll back state |
| Storage crashes | Inject failure before/after signing intent, fsync, signing, outbox write and publication |
| Snapshot clone | Two hosts with the same logical identity cannot obtain conflicting signatures |
| Signature subsets | Different valid witness subsets cannot produce two finalised block hashes |
| Peg-out replacement | No two non-conflicting parent payments for one burn |
| Reconfiguration | Old keys cannot authorise new-epoch protocol decisions; old UTXOs remain correctly tracked |
| Aggregate nonces | Aborts, subset changes and restores never reuse secret nonces |

Use:

- **`proptest 1.11.0`** for generated event schedules, malformed inputs, subset selection and crash sequences; preserve shrunk counterexamples.
- **`turmoil 0.7.2`** for deterministic Tokio-oriented network failures, including simulated relay servers.
- **`madsim 0.2.34`** if adopting its runtime model is useful for broader system simulation.
- Commonware’s deterministic runtime if choosing Commonware.

Sources: [proptest](https://docs.rs/proptest/1.11.0/proptest/), [turmoil](https://docs.rs/turmoil/0.7.2/turmoil/), [madsim](https://docs.rs/madsim/0.2.34/madsim/).

Neither network simulator automatically models disk rollback or Byzantine signing. Add explicit storage faults and adversarial replicas. Model-check the abstract consensus/restore transitions as well; random tests are not a safety proof.

Maintain the JS/Rust differential suite and add Core-backed Taproot/PSBT integration tests. Exercise all signer subsets for your small committees, both output parities, non-default sighashes, malformed control blocks and extra signatures.

**What can reasonably wait on testnet**

You can defer HSMs, independent operators, DKG, aggregate signatures, parent checkpointing and a production-grade disaster-recovery service. A research profile can explicitly halt after uncertain journal loss and restart with fresh keys/genesis.

You should not defer durable votes, removal of unsafe timeout re-signing, the conflicting-certificate test, or a clear distinction between validity and finality.

A documented **3-of-5 crash-only federation** is a reasonable research system. A **4-of-5 federation with correct BFT consensus** can claim one-Byzantine tolerance under its stated independence, persistence and eventual-connectivity assumptions. Threshold arithmetic, successful same-host tests and testnet coin denomination alone establish none of those assumptions.