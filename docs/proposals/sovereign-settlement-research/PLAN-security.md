# PLAN-security.md: security architecture for the sidestr financial substrate

Status: **proposed**. Author: Opus security architect, planning mesh, 2026-09-21. Read-only pass over
the estate; no file outside this one was modified. Every estate claim carries a `file:line` citation.
Binding inputs: `BRIEF-fact-base.md:132-165` (owner direction and decisions D1-D5), `R1-sidestr-spec.md`,
`R2-agentbox-surfaces.md`, `R3-pods-forum-visionclaw.md`, `R4-canon-assertions.md`.

This document is the security half of the sidestr programme. It does not decide product scope; it
decides what must be true before each capability may carry value, and names the mechanism for each.

## 0. Scope, ground rules and terminology discipline

**0.1 What is being secured.** Owner direction is unambiguous: "our own sidestr sidechains are the key
and only instrument" (`BRIEF-fact-base.md:133-136`). That makes DreamLab the signer set, the peg holder
and, at mainnet, the custodian. Every threat below is written from that posture, not from the posture of
a participant in someone else's federation.

**0.2 Terminology trap, enforced.** ADR-124 §2.3 forbids the phrase "single-use seal" for anything in
this estate until a spent-exactly-once check exists: today's `verify_mrc20_anchor` proves UTXO-exists,
not spent-once (`docs/archive/adr/ADR-124-smart-contract-features-web-contracts.md` R2, quoted at
`R4-canon-assertions.md` T1-5; code at `crates/solid-pod-rs/src/mrc20.rs:546-547`, and the ADR's own
delivery note records "zero `outspend`/spent-status helper in `crates/`"). This plan therefore says
**peg anchor**, **claim pairing** and **burn record**, never "seal", and every artefact produced by the
programme must do the same. A document that calls the peg a seal fails review on that ground alone.

**0.3 House crypto rule, restated as a gate not a preference.** RustCrypto or libsecp256k1 bindings
only: `k256` / `secp256k1`, `rust-bitcoin` (accepted into the estate by D3,
`BRIEF-fact-base.md:154-158`), `bech32`, `bip32`, `sha2`, `age` for at-rest. No hand-rolled sighash,
no hand-rolled scalar arithmetic, no bespoke envelope. The estate currently violates this in one
place: `crates/solid-pod-rs/src/bitcoin_tx.rs:117-126,145-185,293-459` hand-rolls BIP-340 tagged
hashing, mod-n scalar arithmetic for the taproot tweak, and the full BIP-341 TapSighash, on the stated
premise "No `rust-bitcoin` / `secp256k1-sys` is introduced" (`bitcoin_tx.rs:24`). D3 resolves this: the
port to `rust-bitcoin` is **in the same programme**, not after it. Building sidestr peg construction on
top of the hand-rolled sighash would compound the audit surface rather than replace it
(`R3-pods-forum-visionclaw.md` GAPS item 3).

**0.4 What is verifiable today and what is not.** The estate has zero sidestr awareness: no `23500` or
`33333` literal anywhere in agentbox (`R2-agentbox-surfaces.md:505-534`), zero hits for
sidechain/sidestr/rgb in solid-pod-rs (`R3-pods-forum-visionclaw.md` A.6) and in VisionClaw
(`R3` B.7). Everything below is therefore threat modelling against a design, with the one exception of
the governance and ingress machinery, which exists and is cited by line.

---

## 1. Threat model

STRIDE per surface. Each row carries a mechanism, not a platitude. Severity is DREAD-scored in §1.10.
Notation: **L1** and **L2** are sidestr trust levels (`R1-sidestr-spec.md:29-34`), not agentbox trust
levels L0-L3 from ADR-124; where both appear the prefix is written out.

### 1.1 Root chain federation (k-of-n across our own instances)

Design under threat: one DreamLab root chain at sidestr level 2, each federated instance holding one
signer key (D2, `BRIEF-fact-base.md:151-153`). Level 2 means a `tr(NUMS_chain, multi_a(k, pk_1..pk_n))`
descriptor where **the same key set secures both block production and the parent peg wallet**
(`R1-sidestr-spec.md:353-358`). That single fact drives most of this table.

| # | STRIDE | Threat | Mechanism required |
|---|---|---|---|
| F1 | Spoofing | A non-signer publishes kind 23510/23511 proposals and partials, or a signer's key is used from a second machine, and validators cannot tell | Validator binds accepted partials to the exact `chain.signers` pubkey set and to the leaf order the witness demands (`R1:344-348`: slots in **reverse leaf order**, exactly `k` filled, a `k+1`th fails `NUMEQUAL`). Our Rust validator MUST reproduce `federation.mjs`'s internal key `H + tagged_hash("sidestr/nums", chain_id)·G` byte-for-byte (`R1:339-343`, `R1:912-918`) and refuse any block whose challenge does not equal the one derived from our own copy of the chain document. Cross-implementation vector: reproduce `txbt4-fed`'s published challenge script exactly before the chain is used for anything. |
| F2 | Tampering | A signer proposes a block whose coinbase claims a peg-in that never happened on the parent | At level 1 this is accepted blindly; at level 2 `parent.mjs`'s `scanPegins()` gives each signer an independent parent view and `round.mjs`'s `checkClaims` hook lets it refuse (`R1:288-294`). **Requirement: every DreamLab signer runs its own parent Bitcoin node.** A signer that validates claims against a shared node held by one instance reduces the federation to 1-of-n for claim truth regardless of k. |
| F3 | Repudiation | After a loss, no record of which signer signed which height | Partials are BIP-340 signatures over the BIP-325 virtual-transaction sighash and are published as kind 23511 referencing the proposal by `e` tag (`R1:222-228`). Requirement: the signer sidecar persists every partial it emits and every partial it accepts to the events adapter under the ADR-039 hash chain, the same chain `authority.deny` uses (`docs/GOVERNANCE-capabilities.md` Invariants, quoted `R2:596-601`). Signature sets are then replayable against the sealed block. |
| F4 | Information disclosure | The signer set, the peg descriptor and each instance's liveness are public by construction | Accepted and unavoidable: the peg descriptor is a parent-chain taproot output and the tip announcements are public (`R1:216-221`). What must NOT leak is which pubkey belongs to which physical instance; do not put an instance hostname in the `alt` tag or the `comment` field of the chain document. |
| F5 | Denial of service | Signers stall; below threshold the chain halts | Level 2 tolerates `n-k` missing signers per round with a lateness-relaxed round-robin (`R1:664-668`: "one down tolerated, two halts" measured on a 2-of-3 chain). Requirement: **n >= 5, k = 3** for the root chain, so two instances may be down or rebuilding. A 2-of-3 root chain makes any single rebuild a one-fault-from-halt condition, and this estate rebuilds its containers routinely (`agentbox/CLAUDE.md` "Runtime model gotchas"). |
| F6 | DoS (time) | The round's entitlement uses wall-clock `Date.now()` skew tolerance with no consensus time (`R1:257-259,1`) | Requirement: every signer host runs NTP with a monitored offset, and the Rust producer refuses to propose if its own offset exceeds half the lateness window. Clock drift on one instance is otherwise indistinguishable from censorship. |
| F7 | Elevation of privilege | `k` signers collude, or one attacker compromises `k` instances, and gains block production **and** the parent peg simultaneously | This is the structural property of the design (`R1:353-358`, `R1:315-318`: "a majority-`k` collusion can still steal or redirect arbitrary peg funds"). Mitigation is not cryptographic, it is topological: signer keys MUST NOT all live in containers built from the same image, on the same host, behind the same operator credential. At mainnet, at least `n-k+1` signer keys must be on hardware the container cannot read. Until that holds, state the custody honestly per chain rather than implying k-of-n reduces trust below 1. |
| F8 | EoP (rotation) | A signer key is suspected compromised and cannot be retired | There is **no automated resharing or rotation ceremony**: a new `signers`/`threshold` pair is a rule document with an activation height, but the peg funds must be manually moved to the new descriptor by an old-set-authorised peg-out (`R1:520-531`). Rotation is therefore a **peg-out, then peg-in under the new descriptor**, and it requires the old set to still be `k`-cooperative. If `k` keys are lost, the peg is lost. Requirement: rotation is rehearsed on testnet4, timed, and documented as a runbook **before** any chain carries value; and no more than `n-k` keys may be held under the same custody control so that a compromise of one control still leaves a cooperative `k`. |
| F9 | Tampering (rules) | Two honest instances adopt different rule documents and silently diverge from the activation height | "User activated" rules are per-node and the block signatures do not settle the disagreement (`R1:628-634`). There is no protocol-level fork detection. Requirement: rule documents for our chains are minted through the ADR process, pinned by content hash in the repo, and the Rust validator refuses to start if its resolved rule set hash differs from the one named in the chain document it loaded. A divergence must be a boot failure, not a slow drift. |
| F10 | Spoofing (genesis) | A signer is handed a genesis block file that differs from the others | Level-2 genesis is sealed by `k` keys up front and every signer must already hold an identical local copy; "fetch genesis from a mirror" is an unbuilt step 8 (`R1:520-526`). Requirement: the genesis block file is committed to the repo with its sha256 in the chain ADR, and each signer verifies that hash at boot. |

### 1.2 Ephemeral child chains

Design under threat: agents and sessions open nested child chains off the root and settle on close (D2).
The `ephemeral` proposal is **a design note with no code** (`R1:495-513`), framed explicitly around
agents: "the parties are usually agents. An agent with a key can make a chain in a second."
This is the most attractive and least built part of the design, and the plan must say so.

| # | STRIDE | Threat | Mechanism required |
|---|---|---|---|
| E1 | Tampering | The closing block's pro-rata payout is wrong, over-paying the party that signs it | The close is a coinbase paying every holder pro rata with no fee, and the signer pegs out the whole peg address in the same proportions (`R1:499-503`). A coinbase paying more than fees plus verified claims is structurally invalid regardless of signature (`R1:612-615`) but **pro-rata correctness is a new consensus rule with no reference implementation**. Requirement: the pro-rata rule is implemented in our Rust validator first, with property tests (sum of payouts equals sum of inputs, no holder omitted, rounding always favours the peg not the payee), before any child chain is opened. |
| E2 | Repudiation | After every mirror disappears, a party disputes the final state | The tombstone checkpoints the closing block hash into the parent (`R1:504-506`) reusing `ckpt:<chain>:<height>:<hash>` (`R1:895-900`). Requirement: the tombstone checkpoint is **mandatory, not optional**, for every child chain that ever held value, and the checkpoint transaction must confirm before the child's URN is marked settled. |
| E3 | EoP | A child chain whose signer is an agent container: the agent (or something that has injected into it) is the sole authority over that chain | This is the sharpest new risk the design introduces. An agent-signed child chain is sidestr **level 1**: the signer is the peg holder and "the coins are theirs to move" (`R1:605-611`). Requirements, all three: (a) the parent peg for a child is funded only from the root chain, never from the parent Bitcoin chain directly, so the exposure is bounded by an amount the root chain already governs; (b) a hard per-child cap enforced at peg-in time by the root chain's spend gate (§3); (c) the child's signer key is a **throwaway derived key** (§2.4), never the agent's `did:nostr` key, so compromise of the child does not compromise the agent's identity, its pod, or its root-chain balance. |
| E4 | DoS | A child chain is never closed; its coins are stranded and its refund clock is frozen | The refund timelock is counted in confirmed **parent** blocks, and nesting compounds the wait (`R1:295-299`). For a child of our root chain, the "parent" is our root chain, so a stalled root freezes every child's refund. Requirement: children carry a `close.height` at genesis (never open-ended), and an unclosed child past its close height is force-closed by the root federation under a documented procedure, with the force-close recorded as a 31402/31403 governed action. |
| E5 | Spoofing | A thousand child chains are opened to exhaust relays, mirrors or the operator's attention | Child creation is a governed action, rate-limited per authorising principal (§3.5), and the tip announcement uses the "manners" cadence from the proposal: announce at genesis, close and hourly only (`R1:507-510`). |
| E6 | Information disclosure | Child chain genesis tags `purpose` and `party` for discoverability (`R1:509-510`) | These tags are public. Requirement: our child chains carry a URN, never a human-readable purpose string, and the URN resolves privately. See §6. |

### 1.3 Peg custody

| # | STRIDE | Threat | Mechanism required |
|---|---|---|---|
| P1 | EoP | Level 1: the signer simply moves the peg funds | Structural (`R1:605-611`). Level 1 is permitted **only** for valueless testnet4 chains and for child chains funded from the root under caps (E3). No level-1 chain may ever be pegged to mainnet. This is a CI-enforced invariant, §4.4. |
| P2 | EoP | Level 2: `k` collude, or `k` are compromised together | See F7. The PSBT round is genuinely trust-reduced, not trustless: each signer re-derives the expected outputs and refuses a PSBT that "pays something besides the burn and change to the peg" (`R1:307-314`). Requirement: our Rust co-signer implements that same independent re-derivation; blind co-signing is forbidden. This is the single highest-value line of code in the programme. |
| P3 | Tampering | The peg-out PSBT underpays the fee and is rejected, or overpays and leaks value | The reference implementation hard-codes 2x the chain minimum because a k-of-n script-path spend carries k signatures, the leaf and a control block, which the wallet's estimate undercounts; this was a real bug found in live testing (`R1:305-310`). Our port must reproduce the fee policy and assert the resulting fee rate is within a declared band, rejecting both under and over. |
| P4 | Repudiation | Level 1 peg-out is "the federation's promise"; the only record that it was kept is the peg holder's own wallet history (`R1:300-305`) | For any chain we operate above zero value, peg-out payment MUST be recorded as an agentbox receipt URN through `management-api/lib/receipt-minter.js:35-56`, which already mints on every outcome including denied and failed "so the audit trail has zero gaps" (`receipt-minter.js:8-9`). A promise with no independent record is not acceptable once value is real. |
| P5 | DoS / loss | **Already-claimed coins on a dead chain have no path back to the parent** if the peg holder is unrecoverable; SPEC's threat list covers unclaimed peg-ins only (`R1:645-657`) | This is the gap R1 flags as undiscussed upstream, and it is the one that loses money rather than time. Requirements: (a) the peg descriptor for every chain we operate is backed up as a descriptor plus each signer's key share under `services/secret-backup` (tar inside age, X25519/scrypt, ChaCha20-Poly1305 under STREAM, cannot write plaintext, restore demonstrated on synthetic data, `docs/SECURITY-profiles.md:44`); (b) recovery is rehearsed off-host before value, since "off-host survival, retention, deletion and revocation of retained copies remain untested" (`SECURITY-profiles.md:44`); (c) a chain that carries value declares a maximum unclaimed balance and a liveness monitor that escalates through the governance gate when the producer misses N heights. |
| P6 | Tampering | The refund path is the pegger's own `and_v(v:pk(refund), older(refundBlocks))` (`R1:271-274,295-299`) and requires no signer | This is the one genuinely good custody property in the design and must be preserved: our peg-in builder MUST always construct the script path with a refund key the pegger controls, and MUST refuse to build a peg-in whose refund key is held by the federation. A federation-held refund key silently converts the peg from custodial-with-escape to custodial-full. |
| P7 | Information disclosure | `refundBlocks` is 10,000 parent blocks in every example (`R1:271-274`), roughly ten weeks on a healthy chain and unbounded on a stalling one | testnet4 itself stalls at its retarget (`R1:800-804`). Requirement: the refund window is a declared operational parameter with an owner-visible worst case, not an inherited default. |

### 1.4 The RGB / USDT bridge

Design under threat: an RGB-aware peg holder receives a consignment and claims a **wrapped asset** on
our chain (`BRIEF-fact-base.md:138-144`). Not an in-chain RGB VM. `rgb-lib` lives in an isolated bridge
service (D3). Note the prior-art inversion R1 records: sidestr's own `assets` rule is chain-validated
consensus, "the opposite model to RGB" (`BRIEF-fact-base.md:53-54`), so the bridge is translating
between two different validity models, not extending one.

| # | STRIDE | Threat | Mechanism required |
|---|---|---|---|
| B1 | Tampering | A forged or replayed consignment mints a wrapped asset that no real RGB state backs | The bridge validates through `rgb-lib` and nothing else; it never accepts a caller-supplied assertion about a transfer. The consignment's terminal witness txid plus output index is recorded as a claim key with an atomic record-if-absent, the same defect class ADR-124 R6 identifies in the existing two-call replay guard (`payments.rs:441-442`, per ADR-124 §10 R6). Two-call check-then-record is forbidden on this path. |
| B2 | Tampering | The wrapped-asset claim is minted on our chain but the RGB side is later reorganised or invalidated | Requirement: a confirmation depth on the RGB witness transaction at least equal to `pegConfirmations` (6 everywhere, `R1:22`), and the wrapped claim carries the witness outpoint so the binding is auditable. |
| B3 | EoP | The bridge signer holds the RGB asset for everyone: it is a single-key custodian of bridged USDT | State it plainly: **at v1 the bridge is a single-signature custodian and is strictly more custodial than the level-2 peg.** Requirements: a separate key (§2.3), a hard ceiling on bridged notional enforced at claim time, no automatic redemption above the ceiling, and no mainnet or real-USDT bridging until §4's gate passes and §7's independent audit is complete. |
| B4 | Repudiation | Redemption (peg-out of USDT) is disputed | Redemption is a zero-tolerance governed action (§3.2) with a receipt and, at mainnet, a second human. The bridge's own ledger of claims and redemptions is a derived view; the chain and the RGB consignment history are the two independent sources that must agree, and a nightly reconciliation job asserts they do. |
| B5 | DoS | `rgb-lib` pulls `rust-bitcoin` and `bdk` into the crate graph, and RGB itself is split between `github.com/rgb-protocol` and RGB-WG with "RGB" naming two divergent codebases (`BRIEF-fact-base.md:60-64`) | Requirement: the bridge is an isolated service with its own crate graph, its own process, its own key, and a pinned exact version of one of the two codebases named in an ADR. It is never a library dependency of the validator, the wallet or agentbox. This keeps ADR-124's dependency tension (`R4` tension 2) confined to one binary. |
| B6 | Info disclosure | USDT on RGB is **not confirmed live** as of 2026-09-21 (`BRIEF-fact-base.md:56-59`) | The plan must not schedule a dependency on an unlaunched product. The bridge is built and tested against a self-issued RGB20 test asset; USDT is a configuration value, not a milestone. |
| B7 | Elevation | The "assets between chains" shape the bridge generalises is itself **reserved/draft with zero code** (`BRIEF-fact-base.md:37-41`, `R1:398-423`) | Our wrapped-asset rule is therefore our own consensus rule, authored and owned here, not an upstream one. It needs the same treatment as E1: Rust-first, property-tested, ADR-recorded, and never silently divergent from whatever upstream later publishes under the same name. |

### 1.5 Relays

| # | STRIDE | Threat | Mechanism required |
|---|---|---|---|
| R1 | Spoofing | A relay injects forged events | Every inbound event's NIP-01 id and BIP-340 signature is verified before use and every payload is re-validated against local state (`R1:248-252`). Our port inherits this and adds nothing trusted from a relay. |
| R2 | Tampering (replay) | A relay replays an old proposal or an old transaction | `round.mjs` guards proposals with a wall-clock staleness check on `created_at` (`R1:641-644`). Transactions are self-authorising, so replay of a 23500 is harmless at the chain layer, but it is not harmless at the **mempool** layer: requirement is a seen-set keyed by txid with a bounded window, and the existing 10,000-entry approximate LRU (`R1:253-256`) is too small for a busy chain and must be sized against measured event volume. |
| R3 | DoS | Relays refuse `#chain` filters as unindexed, so a producer downloads every 23500 on the relay from every sidestr chain and filters client-side (`R1:238-246`) | This is a scalability and a griefing surface: a third party can flood a shared public relay with 23500 events tagged for another chain and force our producers to process them. Requirement: our chains use **our own relay** as the primary transport. The allowlist there is build-time (`agentbox.toml:151-159`: "empty = every inbound relay event is dropped", "changes need a rebuild"), which is friction but is also exactly the property we want for a money transport. Public relays are a secondary, best-effort mirror only. |
| R4 | Censorship | Our relay drops a signer's partials, or a public relay drops ours | Every signer publishes to at least two relays with disjoint operators, and the producer counts partials per relay so a relay that consistently delivers fewer is visible. Requirement: a relay-diversity metric in the signer sidecar's health output. |
| R5 | Admission | A peer instance's signer pubkey must be in the allowlist baked at image build (`R2:488-504`) | Adding a federation member is therefore a rebuild of every other member. Requirement: this is stated as an operational cost in the chain ADR, and the signer-set rule document and the allowlist change land in the same commit so they cannot drift. |
| R6 | Info disclosure | Kind-23500 traffic on public relays reveals transaction timing and volume even with throwaway signing keys | See §6. |

### 1.6 Mirrors

| # | STRIDE | Threat | Mechanism required |
|---|---|---|---|
| M1 | Tampering | A mirror serves a different block at an announced height | Caught: the wallet accepts only a mirror whose `chain.json` names `signer` as the tip-announcement's author, and the tip cross-check detects a mirror ahead of or differing from the announcement (`R1:536-541`, `R1:635-640`). |
| M2 | DoS | A mirror withholds blocks or throttles one client; "behind" is indistinguishable from "deliberately throttling" (`R1:635-640`) | Requirement: our wallet and validator read from at least two mirrors and one directly-connected producer, and treat a mirror more than N heights behind the best-known tip as failed rather than slow. |
| M3 | Spoofing | A hostile mirror URL is published in a 33333 `u` tag | The `u` tags come from the announcement signed by `chain.signer` (`R1:216-221`), so this reduces to signer compromise. But our clients should pin our own mirror URLs from configuration and treat announced mirrors as fallback only. |

### 1.7 Wallet API ingress

| # | STRIDE | Threat | Mechanism required |
|---|---|---|---|
| W1 | Spoofing | An unauthenticated caller reaches a spend endpoint | `nip98-proxy` is the sole NIP-98-verifying ingress to the AoE loopback port and the LAN door on `:9096` (`docs/LAN-door-threat-model.md:11`); `/v1/pay/*` sits behind management-api's own global NIP-98/bearer hook (`management-api/routes/payments.js:29`, cited `R2:535-547`). Requirement: every sidestr spend route is behind the same hook and additionally asserts `request.authenticatedDid`, the way `cost-gate.js` already does. |
| W2 | EoP | The proxy break-glass bearer is used to reach a spend route | The break-glass branch gained expiry, request scope and per-use audit on 2026-09-05, but both bounds are **default off**: "a deployment that sets neither is exactly as unbounded as before" (`docs/SECURITY-profiles.md:43`). Requirement: no sidestr spend route is reachable through the break-glass identity at all. The sentinel identity must be rejected by name at the spend gate, not merely bounded. |
| W3 | Spoofing (sibling) | A sibling container or a process sharing UID 1000 reaches a loopback listener | Loopback publish does not isolate Docker siblings or same-UID processes (`docs/LAN-door-threat-model.md:3-7,19-25`). The signer key must therefore not be readable by anything that merely shares the UID: it lives in `/run/secrets`, mode 0600, owned by a dedicated service account, and the signer process is the only reader. See §2.5. |
| W4 | Tampering | A replayed NIP-98 event authorises a second spend | NIP-98 kind 27235 carries method, URL and payload hash. Requirement: the spend path adds an idempotency key bound to the operation digest, which the existing consumer payer already does for deposits (`consumer-payer.js`, per `R2:200-254` C2), and rejects a duplicate digest within the window rather than re-executing. |
| W5 | Info disclosure | The wallet API returns another DID's balance | Under D4 the balance is the UTXO set keyed by a pubkey on a public chain, so the API cannot be the confidentiality boundary. See §6.3; the mitigation is address derivation, not access control. |

### 1.8 Prompt-injection-to-spend

PRD-015 names this as the headline threat verbatim (`R4` T5-2: "Named headline threat:
'prompt-injection to spend'"), and the estate's answer is already architectural: "policy is
deterministic, never LLM discretion. A model may *request* a spend; it cannot *authorise* one above
policy" (`R4` T5-2), plus ADR-032's closed-grammar classifier framed explicitly as "the spend
pipeline's first gate against prompt-injection-to-payment" (`R4` T3-1).

| # | Threat | Mechanism required |
|---|---|---|
| I1 | Injected text persuades an agent to call a spend tool | The spend decision is never a model output. The classifier is a pure function over frozen byte shapes with a closed result set and `unknown` can never spend (`management-api/lib/pay402.js:306-309`, `R2:200-238`). A `sidestr` scheme is added by ADR-032 revision plus fixtures, never as a runtime extension point (D4, `BRIEF-fact-base.md:159-160`; `R4` T3-1 D2). |
| I2 | Injected text persuades an agent to raise its own cap | An agent may only **tighten** its declared task properties, never loosen (`docs/GOVERNANCE-capabilities.md` Invariants, `R2:590-595`). Caps live in the manifest and no code path bypasses the manifest (`spend-policy.js`, `R2:216-228`). Requirement: the sidestr caps live in `[payments.sidestr]`, not in any agent-writable store. |
| I3 | Injected text persuades an agent to open a child chain and move value into it | Child creation is itself a `payment_settlement`-class action (§3.3). The cap in E3(b) bounds the blast radius even if the gate is bypassed. |
| I4 | Injected text targets the **approver** rather than the agent: the 31402 request's human-readable summary is attacker-controlled | This is the injection vector the current design does not cover. Requirement: the 31402 for a chain spend renders **structured fields only** (amount, destination script, chain id, operation digest), derived from the parsed transaction by our own code, with any free-text field from the requesting agent clearly demarcated and never used as the summary. An approver who approves a digest they cannot independently read is not a control. |
| I5 | Injected content reaches the model through a tool result and the session is later compacted or routed | The ADR-2093 taint fence already models exactly this shape for email (`docs/adr/ADR-2093-jev-verbatim-compaction.md:39-44`, validator E074 refuses a manifest that drops the email prefix). Requirement: sidestr wallet tools that return third-party-controlled strings (a memo field, a mirror's `alt` text) join the taint prefix list, and backend locality stays asserted rather than inferred (`GOVERNANCE-capabilities.md` Invariants: "never derived from a hostname, URL, IP literal or network probe"). |

### 1.9 The interim AGPL JS `siding` sidecar

D3 runs the upstream AGPL JS as the interim signer/producer until the Rust producer reaches parity
(`BRIEF-fact-base.md:154-158`). That is a reasonable engineering call and a real supply-chain exposure.

| # | Threat | Mechanism required |
|---|---|---|
| S1 | Supply chain | Upstream is one committer, the repo was created 2026-09-15, and the spec says "nothing here is final" (`BRIEF-fact-base.md:50-51`, `R1:780-790`) | The sidecar runs **only** pinned-by-SHA code. Upstream already pins `@sidestr/spec`, `@sidestr/explorer`, `@sidestr/wallet` to specific git commit SHAs and `@bitcoin-desktop/schema` to `#v0.0.27` (`R1:812-822`); we mirror those pins into our own lock and vendor the tree into the image rather than fetching at runtime. |
| S2 | Supply chain | There is **no CI on the sidestr repos**; only the `schema` kernel has a workflow, and several sidestr tests are live-network integration tests that read a real key from `~/.sidestr/<name>.key` and build against a live mirror (`R1:800-811`) | We do not inherit upstream's test posture. Our gate is our own: the Rust validator must agree with the JS producer on every block the JS produces, checked continuously (§7.2). The JS is trusted to produce, never to validate. |
| S3 | Key exposure | The JS sidecar needs the signer key | The sidecar gets a key that is **not** the identity key and **not** the root-chain key during the interim period: run the interim producer on a testnet4 chain only, with its own key, and do not give the JS process the root-chain signer share. This is the concrete reason §2 separates the keys by role rather than by chain alone. |
| S4 | Licence | AGPL-3.0 network-use clause; a container-internal sidecar is acceptable but a publishable Rust crate must be clean-room from the spec (`BRIEF-fact-base.md:105-108`; ADR-2030 permissive policy for publishable crates) | Requirement: the Rust validator is written by someone who has read the SPEC prose and the wire formats, with a written clean-room declaration in the crate's ADR, and the crate graph is checked in CI for any AGPL edge. `R4` tension 3 records that **no canon currently documents this conflict at all**, so the programme must establish it, not assume it. |
| S5 | Consensus divergence | The BLAKE2b-v2 header and the Knots unified sighash are hard-coded for every sidestr chain's **own** blocks regardless of parent (`R1:999-1048`), and making them SHA-256d is a real code change in two files, one of which is a duplicate in the explorer | D6 makes this configurable (§9); the configuration must reach **both** `overlay.mjs` and `explorer.mjs`, or the explorer silently keeps forcing BLAKE2b for anyone reading through it while the producer does not. A divergence here is a chain split, not a bug. |

### 1.10 DREAD ranking, top findings

Scores are damage / reproducibility / exploitability / affected / discoverability, each 0-10, mean to
one decimal. Priority bands per the standard split: >=8 critical, >=6 high, >=4 medium.

| Rank | Finding | D | R | E | A | Di | Mean | Priority |
|---|---|---|---|---|---|---|---|---|
| 1 | F7/P2: `k` signer compromise yields block production **and** the parent peg in one step | 10 | 6 | 5 | 10 | 8 | 7.8 | high, becomes critical at mainnet |
| 2 | I4: the approver is shown attacker-influenced text for a zero-tolerance spend | 9 | 9 | 8 | 7 | 6 | 7.8 | high |
| 3 | B3: bridge signer is a single-key custodian of bridged USDT | 10 | 7 | 6 | 8 | 7 | 7.6 | high, blocks mainnet |
| 4 | P5: already-claimed coins on a dead chain have no path back | 10 | 5 | 4 | 8 | 4 | 6.2 | high |
| 5 | E3: an agent container is the sole signer of a value-bearing child chain | 8 | 8 | 7 | 5 | 6 | 6.8 | high |
| 6 | §3.1: `payment_settlement` is declared zero-tolerance but `routes/payments.js` never calls the gate | 8 | 10 | 9 | 6 | 3 | 7.2 | high |
| 7 | §6.3: did:nostr to chain-address linkage makes every agent balance publicly enumerable | 5 | 10 | 10 | 10 | 7 | 8.4 | critical for privacy, low for funds |
| 8 | F8: no rotation ceremony; a suspected-compromised signer key cannot be retired without a cooperative `k` | 9 | 4 | 3 | 8 | 5 | 5.8 | medium, blocks mainnet |
| 9 | S5: BLAKE2b/unified-sighash divergence between our Rust and the JS sidecar | 9 | 6 | 3 | 7 | 4 | 5.8 | medium |
| 10 | §3.4: spend budget is in-memory and resets on restart (`spend-policy.js:36-39`) | 6 | 10 | 8 | 5 | 4 | 6.6 | high |
| 11 | §3.4: `cost-gate.js:67-70` fails **open** when the payment backend is unreachable | 7 | 9 | 7 | 5 | 5 | 6.6 | high on a chain path |
| 12 | R3: shared public relays let a third party flood our producers' kind-only subscription | 4 | 9 | 8 | 6 | 7 | 6.8 | high for availability |


---

## 2. Key management

### 2.1 The question answered directly: yes, the signer key MUST differ from the did:nostr identity key

Upstream conflates them by design. `wallet.identity(key)` takes one 32-byte hex private key and yields
the BIP-340 x-only pubkey, the P2TR script `5120||pub`, and the bech32m address, which is **the same
construction as a level-1 chain's `challenge`**; nothing distinguishes a signer key from an ordinary
spending key at the address layer (`R1:544-556`). The same scalar is simultaneously a Nostr identity,
a sidechain spending key, potentially the block-signing and peg-holder key, and an Ethereum account on
any `evm` chain (`R1:565-571`). R1 states plainly that "there is **no key-separation guidance** in the
wallet code or docs" and that upstream's own spec never discusses this as a threat (`R1:616-634`).

Five independent reasons this estate must not inherit that:

1. **Blast radius.** The `did:nostr` key is the agent's identity, its pod committer identity, its
   NIP-98 credential and its governance signing key (`services/nostr-pod-bridge/src/identity.rs:130-158`,
   `bootstrap.rs:190-219`, `contract.rs:236-240`). Making it also a money key means one leak loses
   identity, pod authority and funds together.
2. **Custody boundary.** Under D2 a federated instance holds a **signer share** that co-custodies other
   people's pegged coins. That key has a different owner-of-record, a different rotation trigger and a
   different legal character from an agent's identity key. Conflating them makes the regulatory analysis
   in §5 incoherent.
3. **Location.** The identity key is written to `identity.env` at mode 0600 and sourced by the
   entrypoint **into every supervised program's environment** before being scrubbed to tmpfs
   (`bootstrap.rs:190-233`). That is an acceptable distribution for an identity credential and an
   unacceptable one for a spending key: every supervised program would hold it.
4. **Privacy.** D4 makes the balance the UTXO set keyed by a pubkey. If that pubkey is the DID, every
   balance is world-readable from a DID (§6.3).
5. **Rotation.** Identity rotation breaks every DID document, ACL and URN (ADR-033 I1 asserts no
   identity migration is implied by opening the anchoring seam, `R2:78-85`). Signer rotation must be
   possible **without** touching identity. Shared keys make one impossible.

### 2.2 Derivation: hardened BIP-32 from a master seed. Tagged-hash tweaks are rejected.

The obvious cheap option is an additive tagged-hash tweak: `k_role = k_identity + H("dreamlab/sidestr/role-v1", role || chain_id) mod n`.
**Reject it.** The tweak is computed from public data, so it is publicly reproducible; an attacker who
obtains any one role key recovers `k_identity = k_role - H(...)` and thereby every other role key and
the identity itself. Additive tweaks give address separation, never key-compromise isolation. The same
objection applies to any scheme where the child is a public function of the parent. sidestr's own
`sidestr/nums` tweak is fine precisely because it tweaks a **NUMS point** that nobody knows the
discrete log of (`R1:339-343`), not a live private key.

Use hardened BIP-32 instead, where a compromised child gives nothing about the parent or its siblings:

```
master seed (256-bit, generated by the OS CSPRNG at bootstrap, BIP-39 backup phrase optional)
 |
 +-- m/44'/1237'/0'/0/0          did:nostr identity            (NIP-06 account 0, unchanged semantics)
 +-- m/44'/1237'/7770'/0/0       root-chain block-signing share
 +-- m/44'/1237'/7771'/i'/0/0    per-child-chain signer         i' = tagged_hash("dreamlab/sidestr/child-index", chain_id)[0..4] & 0x7fffffff
 +-- m/44'/1237'/7772'/0/0       RGB bridge operator key
 +-- m/86'/1'/0'/0/*             parent peg wallet keys         (BIP-86 taproot, coin_type 1 = testnet)
 +-- m/86'/0'/0'/0/*             parent peg wallet keys, mainnet, minted only after the §4 gate
 +-- m/44'/1237'/7773'/j'/0/0    per-purpose receive keys       (§6.3)
```

Notes that matter for correctness, not style:

- **The peg wallet branch is BIP-86 under coin type 0'/1', not 1237'.** It is imported into a
  Bitcoin Core style wallet as part of the `tr(NUMS_chain, multi_a(k, ...))` descriptor
  (`pegDescriptor()`, `R1:349-352`), and that wallet must be restorable from standard tooling in a
  recovery. Putting it under the Nostr coin type would make every recovery bespoke.
- **coin_type 1' versus 0' is a containment boundary, not a convenience.** A mainnet peg key cannot be
  derived by accident from a testnet configuration if the branch is different, and §4.4's CI check can
  assert that no `0'` key exists in any deployed configuration until the gate receipt exists.
- **Child-chain indices must be hardened and derived from the chain id**, so a child signer key is
  reproducible from a backup of the seed plus the chain id alone, without a separate key registry that
  could be lost independently.
- **One private scalar, three public representations** (`R1:557-564`): BIP-340 x-only for Nostr and
  taproot, full secp256k1 point for any EVM derivation. The `evm` rule is excluded by standing decision
  (`BRIEF-fact-base.md:163`), so our derivation code must have **no** Ethereum representation at all;
  its absence is an assertion in the test suite, not an omission.
- **Existing installs**: the current identity is generated directly as a keypair, not from a seed
  (`identity.rs:130-158`), with in-place migration already precedented for pre-x-only keys
  (`identity.rs:198-240`). Migration path: generate a seed, keep the **existing** identity key as an
  imported leaf recorded in the keystore, derive only the new roles from the seed. Never re-key an
  existing DID for this programme; ADR-033 I1 forbids it.

### 2.3 The four key classes and their custody

| Key | Path | Where it lives | Who may read it | Rotation trigger |
|---|---|---|---|---|
| did:nostr identity | `m/44'/1237'/0'/0/0` | `<identity_root>/<agent_id>.json`, `identity.env` 0600, scrubbed to tmpfs (`identity.rs:183-185`, `bootstrap.rs:190-233`) | every supervised program, by current design | compromise only; rotation is an identity event, not a routine |
| Root-chain signer share | `m/44'/1237'/7770'/0/0` | `/run/secrets/sidestr-signer.key`, 0600, owned by a dedicated service account, loaded by the signer process alone | the signer service only. **Never in `identity.env`.** | scheduled, plus on any suspicion; ceremony per F8 |
| RGB bridge operator key | `m/44'/1237'/7772'/0/0` | `/run/secrets/rgb-bridge.key`, separate service account, separate container | the bridge service only | scheduled; a bridge rotation is a consignment migration and must be rehearsed |
| Per-child throwaway | `m/44'/1237'/7771'/i'/0/0` | derived on demand, held in the child signer process memory, never written | that process only | not rotated; the chain closes instead |
| Parent peg wallet share | `m/86'/1'/0'/0/*` | descriptor-imported into the signer's own bitcoind wallet | the bitcoind process | with the signer share, together |

**HSM posture, stated honestly.** There is no HSM in this estate today, and the custody register
records that every custodian, deployed location, rotation cadence and response window remains
**unconfirmed** for five of seven existing credential roles (`docs/SECURITY-profiles.md:36-54`).
Recommendation: testnet4 chains run with file-backed keys under `/run/secrets`; **mainnet requires at
least `n-k+1` signer shares on hardware signing devices** so that compromise of the container estate
cannot reach a cooperative `k`. Naming a device is out of scope here; requiring one is not.

**Backup.** Signer shares and the peg descriptor go through `services/secret-backup` (tar inside age,
X25519/scrypt, ChaCha20-Poly1305 under STREAM, cannot produce a plaintext archive, 0600 artefacts,
restore demonstrated byte for byte on synthetic data, `docs/SECURITY-profiles.md:44`). Two gaps in that
row are blocking for value: it is **not yet wired into `flake.nix`** so the image does not ship the
binary, and off-host survival, retention and deletion are untested. Both close before a value-bearing
chain, not after.

### 2.4 Interaction with ADR-2078

ADR-2078 provisions the **pods** signer from the sovereign identity; today pod requests are declared
unsigned (`sign_requests = false`, ADR-2064) and the fail-closed adapter throws `SigningUnavailable` if
the flag is flipped without key material (`agentbox/CLAUDE.md` "Runtime model gotchas"; `R2:129-140`).
Two clean statements:

1. **ADR-2078 does not unblock chain signing and must not be extended to.** It wires the identity key
   into pod request signing. The chain signer is a different key on a different branch by §2.1. If
   ADR-2078 were generalised into "the sovereign identity signs everything", it would re-create exactly
   the conflation this section rejects. The sidestr ADR must cite ADR-2078 and state the boundary.
2. **ADR-2078 is still a prerequisite**, because the chain's governance path depends on signed pod
   requests for receipts and the 31402/31403 round trip. Sequence: ADR-2078 lands, then chain keys are
   minted on their own branch, then the spend gate is wired.

### 2.5 Verification against published vectors, as a merge gate

No key or signing code merges without passing, in our own CI, in this order:

1. **BIP-32** test vectors 1-5 including the hardened and the leading-zero-byte cases, against `bip32`
   or `bitcoin::bip32`.
2. **BIP-340** vectors. The kernel corpus already ships `schema/test/vectors/bip340.json`, and R1 notes
   the sidestr JS itself embeds no BIP-340 vector file (`R1:866-876`); we reuse the kernel's.
3. **BIP-341** tap-tweak and sighash vectors, plus **BIP-86** derivation vectors for the peg branch.
4. **The NUMS construction**, byte-for-byte: `H = 50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0`
   tweaked by `tagged_hash("sidestr/nums", chain_id)` (`R1:339-343`, `R1:912-918`).
5. **sidestr live vectors**: our Rust must reproduce the published challenge script, address set and at
   least one sealed block of the existing `txbt4-fed` level-2 chain, and the two distinct peg-out
   OP_RETURN formats that share only the `pegout:` prefix (`R1:895-900`, and note the minimal-push
   requirement at the same citation: a non-minimal push is treated as malformed, not merely
   non-canonical).
6. **A negative test per hand-rolled primitive removed**: the `bitcoin_tx.rs` golden fixtures
   (`bitcoin_tx.rs:1112-1210`, fixtures at `tests/fixtures/bitcoin/golden_tx.json`) must still pass
   after the `rust-bitcoin` port, proving the port is byte-identical rather than merely plausible. Note
   that those goldens only work by pinning `aux_rand = 0` (ADR-124 R1), which sidesteps rather than
   solves cross-implementation divergence; the port must keep the pin and say why.

---

## 3. Spend authorisation

### 3.1 The gap to close first

`payment_settlement = "zero-tolerance"` is declared at `agentbox.toml:980`, with task properties
`verifiability = "inspectable"`, `stakes = "critical"` at `agentbox.toml:1028-1030`. Zero-tolerance
implies irreversible as an invariant that is never declarable away
(`docs/GOVERNANCE-capabilities.md` Invariants: "`zero-tolerance ⇒ irreversible` is an invariant, not a
default"). The gate is real: `buildAuthorityGate` is constructed in `management-api/server.js:1121`
and decorated onto the app at `server.js:1133`.

**It is not wired to money.** Direct grep of call sites: `authorityGate.guard(...)` appears at
`management-api/routes/broker-bridge.js:473` and `management-api/routes/llm-marketplace.js:456` and
nowhere else. `management-api/routes/payments.js` does not require `lib/authority` at all. Today a
large sats spend blocks only on the numeric caps in `spend-policy.js`, not on a signed 31402/31403
round trip. This was flagged as the single most important follow-up in `R2:753-841` GAP 8 and is
confirmed here.

**Requirement S-1 (precedes any sidestr work).** Route `POST /v1/pay/deposit`, `/v1/pay/buy`,
`/v1/pay/withdraw` and every future sidestr spend through `authorityGate.guard` with
`action_class: 'payment_settlement'`, following the `broker-bridge.js:473` call shape. This is a
pre-existing defect the sidestr programme inherits; fixing it is not sidestr scope creep, it is the
precondition that makes the rest of this section meaningful.

### 3.2 Which operations are `payment_settlement`

Zero-tolerance, blocking on a signed 31403, no exceptions:

- peg-in claim above the per-chain threshold (it commits parent-chain funds)
- any peg-out burn (irreversible, and level-1 peg-out depends on the federation keeping a promise,
  `R1:300-305`)
- bridge redemption / USDT peg-out (B4)
- bridge wrapped-asset claim above the notional ceiling (B3)
- child-chain force-close (E4)
- signer-set rule document publication and any rotation peg-out (F8)
- chain document seal for a new chain (§4)

Recoverable, deterministic policy only, no human round trip:

- a root-chain spend at or below `approval_threshold_sats`
- a child-chain internal transfer within an already-funded child, below its cap
- any read: balance, tip, explorer replay

### 3.3 Thresholds: root chain versus ephemeral child chains

The existing consumer policy is the template (`agentbox.toml:1456-1463`): `max_sats_per_call = 100`,
`daily_budget_sats = 1000`, `approval_threshold_sats = 50`, allowlist empty meaning mesh-only. Proposed
`[payments.sidestr]` shape, all values owner-set, these being placeholders that testnet4 will calibrate:

```toml
[payments.sidestr]
enabled                     = false      # opt-in, like every other money gate in this file
chain                       = ""         # our root chain id; empty = no chain configured
level                       = 2          # 1 forbidden for any chain with a non-zero declared value
# root chain
root_max_sats_per_call      = 1000
root_daily_budget_sats      = 10000
root_approval_threshold_sats = 500       # above this, a signed 31403 is required
# ephemeral children
child_max_peg_in_sats       = 2000       # E3(b): the blast radius of an agent-signed child
child_max_concurrent        = 8          # per authorising principal, E5
child_max_lifetime_blocks   = 1440       # close.height is mandatory, E4
child_approval_threshold_sats = 0        # 0 = every child peg-in is governed; raise only with evidence
# bridge
bridge_enabled              = false      # B3/B6
bridge_max_notional         = 0          # 0 until the §4 gate and the §7 audit
```

Rationale for the asymmetry: a root-chain spend is protected by k-of-n block production and by a
federation that re-derives the PSBT semantics independently (P2). A child-chain peg-in hands value to a
**single agent-held key** on a level-1 chain, so the threshold there is about bounding an uncontrolled
custodian, not about approving a transfer. Hence `child_approval_threshold_sats = 0` as the default:
every hand-off to an agent-signed chain is a governed event until measurement says otherwise.

### 3.4 Making the deterministic policy durable and fail-closed

Three concrete defects in the existing middleware that a chain path cannot inherit:

1. **The daily budget is a module-level `Map`, never written to disk, reset on process restart**
   (`management-api/middleware/spend-policy.js:36-39`, confirmed by direct read: "Entries are never
   written to disk; they reset on process restart"). It is also not multi-process safe. On a chain
   path this means a restart loop is a budget bypass. **Requirement:** move the accumulator into a
   durable store. Per the ADR-2085 precedent there is **no sixth adapter slot**; a new capability
   consumes the existing memory or events slots (`R2:390-419`). Use the **memory** slot with a
   namespace-scoped counter and a compare-and-set update, and fail closed if the store is unreachable.
2. **`cost-gate.js` fails open when the payment backend is unreachable** unless
   `COST_GATE_FAIL_CLOSED === 'true'` (`management-api/middleware/cost-gate.js:66-70`, read directly:
   the catch logs and returns without denying). On a pod micro-debit that is a defensible default. On a
   chain path "backend unreachable" can mean "I cannot tell whether this already spent".
   **Requirement:** the sidestr path sets fail-closed unconditionally in code, not by env var, and the
   env var cannot loosen it.
3. **`unknown` must stay terminal.** `pay402.js:306-309` already makes an unrecognised 402 shape
   terminal and unpayable. The `sidestr` scheme is added by ADR-032 revision plus captured-bytes
   fixtures in `tests/contract/pay402/`, never as a runtime extension point
   (`R4` T3-1; D4 at `BRIEF-fact-base.md:159-160`).

Additionally: every spend attempt, on every outcome, mints a receipt. `receipt-minter.js:20-24` already
enumerates paid, denied, failed and pending-approval outcomes and both mint functions are
unconditionally try/catch and never throw (`receipt-minter.js:8-10,52-54`). The sidestr path reuses it
unchanged and adds no new audit mechanism.

### 3.5 Colloquy "authorising principals": the decision

**Decision: adopt the principal-collapse rule for policy-ceiling changes and for rate limits. Do not
adopt it for per-spend authorisation.**

Adopt, because the model is exactly right for the multi-agent shape: an operator's fifty agents are one
voice, unregistered pubkeys are dropped rather than self-authorising, and a human principal is capped at
3x an agent principal (ADR-2086, summarised `R2:683-713`). Applied to spending, this prevents an
attacker who has compromised several agents under one principal from manufacturing consensus to raise a
cap or to open more child chains than E5 allows. Implementation is cheap: `colloquy-core` is published,
pure, dependency-light and wasm-capable, so a `SpendAuthorisationPolicy` imports the principal-collapse
logic as a library rather than generalising the knowledge-domain types (`R2:714-736`).

Do not adopt for the per-spend decision, for one decisive reason: **colloquy confidence is a live
reconstruction, and revoking an agent retracts its past confirmations on the next reconstruction**
(ADR-2086 Consequences, `R2:737-745`). That is correct for a knowledge base and wrong for money: you
cannot retroactively un-confirm a transaction that has already cleared on a chain. Per-spend
authorisation therefore stays what the estate already built: deterministic policy plus, above the
threshold, a single signed 31403 from a human, frozen at the moment of approval as a receipt. Where
principal weight is consulted, the weight is **snapshotted into the receipt** at decision time and the
receipt, not the live graph, is the record.

One further guard: `governance_manual_continue` already refuses an agent DID, or this container's own
DID, as `executed_by` and binds to the approved operation digest
(`docs/GOVERNANCE-capabilities.md` Invariants). The sidestr path reuses that binding so that an
approval for one transaction can never be spent on another.

### 3.6 The operation digest

Every governed chain action's 31402 carries `operation_sha256` over a canonical JCS serialisation of the
**parsed** action: chain id, input outpoints, output scripts and amounts, fee, and for a bridge
redemption the consignment terminal outpoint. The `authority.deny` journal already records
`operation_sha256` (`management-api/lib/authority.js:213` per `GOVERNANCE-capabilities.md` Invariants),
so this is a field already in the schema. The transaction that is finally broadcast must hash to the
approved digest or the signer refuses. This is what closes I4 mechanically rather than by asking the
approver to read carefully.


---

## 4. The P21 gate, made real

ADR-124 §7 specifies P21 as "architecturally enforced, not aspirational": hard-pin currency to testnet,
disable the cash-out mirror and the `.withdraw`/`.swap`/`.pool` routes, make owner plus legal sign-off a
**BUILD/DEPLOY gate not a runtime hope**, and anchor trust level, currency and cash-out flags **on-seal**
so a deployed contract cannot silently switch testnet to mainnet or enable cash-out after funds are
committed (`docs/archive/adr/ADR-124-smart-contract-features-web-contracts.md` §7, and Q4 answered "yes"
in §10). It is **PLANNED, not built**: `R4` T8-3 and `R3` GAPS record that `pay_handler.rs` has no
currency-pinning or route-disablement logic keyed to trust level, so any rollout riding on it today
ships without the rail the ADR claims. D1 makes implementing it a precondition
(`BRIEF-fact-base.md:148-150`).

Here is the concrete mechanism for a sidestr chain document.

### 4.1 The containment block, committed into genesis

Add to our chain documents a `containment` object, and commit its hash into the genesis block so that
changing it changes the chain id:

```json
"containment": {
  "spec": "dreamlab/containment-v1",
  "parent_network": "btc:testnet4",
  "pow_family": "knots:blake2b-v2",
  "value_class": "valueless-test",
  "cash_out": false,
  "bridge": false,
  "pegout_enabled": false,
  "peg_confirmations": 6,
  "refund_blocks": 10000,
  "max_declared_value_sats": 0,
  "gate_receipt": null
}
```

`pow_family`, `peg_confirmations` and `refund_blocks` are inside the hashed object because §9 makes
the parent family and the sidechain header family operator-configurable, and all three of these are
the parameters whose safe value depends on which family was chosen.

Mechanism, using only primitives sidestr already has:

- The genesis block is reconstructed deterministically from `chain.pegs` by `buildGenesis()` rather than
  fetched as a kind-33501 event (`R1:196-198`). Extend that construction with one additional coinbase
  `OP_RETURN` output, `pin:<sha256(JCS(containment))>`, using the same minimal-push discipline as every
  other record type (`R1:895-900`).
- Our Rust validator computes `sha256(JCS(chain.containment))` from the chain document it loaded and
  **refuses to start** if it does not equal the genesis commitment. A mismatch is a boot failure, not a
  warning.
- Because the genesis block hash feeds the whole chain, an operator who edits `containment` after
  genesis gets a different chain, not a quietly re-flagged one. That is precisely the "cannot silently
  switch testnet to mainnet post-deployment" property ADR-124 Q4 demands, achieved without a new
  cryptographic construction.
- `parent_network` is additionally cross-checked against `chain.parent` at boot; a document whose
  `containment.parent_network` and `chain.parent` disagree is malformed.

### 4.2 Runtime effect of the flags

- `cash_out: false` and `pegout_enabled: false` make the wallet refuse to construct a `pegout:` burn and
  make the validator treat a burn as a consensus error for that chain. Refusing to **build** is not
  enough on its own; the validator must also refuse, or a hand-crafted transaction bypasses the wallet.
- `bridge: false` makes the bridge service refuse to claim a wrapped asset on that chain id, checked at
  the bridge, at the validator's wrapped-asset rule, and in the manifest gate
  (`[payments.sidestr].bridge_enabled`). Three independent refusals, because B3 is the largest custody
  exposure in the design.
- `max_declared_value_sats` is what §3.3's child caps and §7's audit thresholds key off, and what the
  regulatory analysis in §5 uses as "declared value".

### 4.3 The sign-off artefact: both 31403 and gitmark

The brief asks where sign-off is recorded. **Both, and they record different things.**

- **Signed kind-31403** is the *authorisation*. The chain document seal is a `payment_settlement`-class
  action (§3.2). The 31402 carries `operation_sha256` over the JCS of the full chain document including
  `containment`; the human's signed 31403 approves that exact digest. This reuses the existing ladder
  with no new mechanism (`GOVERNANCE-capabilities.md` Invariants; ADR-2085's graduation precedent of
  citing the approving event id in an `authorising_event` field, `R2:614-625`).
- **A gitmark commit** is the *durable, offline-verifiable record*. A git commit whose author email is
  the approving human's DID, containing the chain document, the containment hash, the 31403 event id and
  the legal sign-off attestation, in the repo that owns the chain. gitmark is a plain git commit with the
  DID as author email (`crates/solid-pod-rs-git/src/mark.rs:145-228,23-27,174-176`), which is exactly the
  "honest-or-caught" record this needs and which survives relay loss.
- `containment.gate_receipt` carries `{ "event_id": "<31403 id>", "commit": "<sha>", "attested_by": ["<did>", "<did>"] }`,
  and because it is inside the hashed object it is committed into genesis alongside everything else.
  A mainnet chain whose `gate_receipt` is null cannot exist, by construction: the hash would not match a
  genesis built from a document carrying the receipt.
- **Two humans, not one, for mainnet.** Owner plus legal are two distinct `did:nostr` principals and
  both 31403s must be present. The colloquy rule that self-approval must be structurally impossible
  rather than discouraged applies directly (`R2:697-703`).

### 4.4 CI checks

Three checks, in `.github/workflows/invariants.yml` alongside the existing ADR frontmatter and
`verified_commit` gates (`docs/adr/README.md`, per `R2:643-680`):

1. **No mainnet chain document without a gate receipt.** Scan every `chain.json` in the repo; if
   `containment.parent_network` is not a testnet, require a non-null `gate_receipt` whose `event_id`
   resolves to a stored 31403 whose signature verifies over the document digest, and whose `commit`
   exists in git history. Fail the build otherwise.
2. **No level-1 chain with non-zero declared value, and no mainnet level-1 chain at all** (P1).
3. **No mainnet key material derivable from a testnet configuration**: assert that no deployed
   configuration references a `m/86'/0'/...` path, and that `[payments.sidestr].bridge_enabled` is false,
   while any chain document in the tree declares `value_class: "valueless-test"`.

Plus a fourth, cheap and high-value: **a grep gate for the forbidden term**, failing the build on
"single-use seal" applied to our own substrate in any new document (§0.2).

---

## 5. Regulatory position, UK

Not legal advice. This section maps the design onto the matrix the estate has already written and names
the questions that require counsel.

### 5.1 The matrix we inherit

ADR-124 §7 cross-tabulates two independent axes, cryptographic trust level (L0-L3) against legal product
class (gambling/parimutuel, securities/derivatives, money-transmission/VASP), and every cell for a
real-value public deployment reads **"same, L3 does NOT exempt"**. The load-bearing sentence is
"a public real-value pool is regulated at EVERY cryptographic level. L3/RGB removes operator *custody*
but does not remove any *legal* obligation on any axis. The only true containment is staying in the
testnet / symbolic / no-cash-out corner." (ADR-124 §7, read directly.)

The sidestr design **strengthens** rather than weakens this conclusion, and the plan must say so
plainly, because the marketing framing of sidechains and RGB runs the other way (`R4` tension 6). We are
not removing custody. Owner direction makes us the signer set and the peg holder
(`BRIEF-fact-base.md:133-136`), and Tension 5 is resolved as "we are our own federation"
(`BRIEF-fact-base.md:144-145`). A k-of-n federation of instances all controlled by one operator is, for
regulatory purposes, one custodian with a good internal control. It is not a reduction in custody; it is
a reduction in single-point-of-failure risk within a custodial arrangement.

### 5.2 What the design adds that ADR-124 did not model

ADR-124 modelled MRC20 issuance plus an AMM. The new design adds two things:

1. **Custody of pegged sats belonging to other parties.** Pegged coins sit in a parent-chain taproot
   output the federation controls (`R1:265-274`, `R1:349-358`). Holding another person's bitcoin and
   giving them a claim on it is the classic shape of the money-transmission/VASP row. The refund path
   (P6) is a genuine mitigation of *loss*, and does nothing to change the *characterisation*.
2. **Custody of a fiat-referenced stablecoin.** Bridged USDT is a fiat-referenced token; the bridge
   signer holds the RGB asset and issues a wrapped claim (B3). This adds a row ADR-124 does not have:
   the UK stablecoin regime. The 2026 FCA cryptoasset regime brings issuance and custody of qualifying
   stablecoins into the regulatory perimeter, alongside the existing MLR-2017 registration requirement
   for cryptoasset exchange and custodian wallet providers, with safeguarding obligations for held
   client assets. The precise perimeter, the transitional arrangements and whether a wrapped claim on a
   private chain is itself a regulated activity are **exactly the questions for counsel**, not questions
   this document should answer.

Proposed amendment to the ADR-124 §7 table, to be minted with the sidestr ADR:

| Legal product class | L0 | L1 | L2 | L3/RGB | sidestr federation peg | RGB/USDT bridge |
|---|---|---|---|---|---|---|
| Gambling / parimutuel | licence if real-stakes/public | same | same | same | same | same |
| Securities / derivatives | FCA retail crypto-derivatives ban; unregistered securities exposure | same | same | same | same | same, plus token-characterisation question |
| Money transmission / VASP | MLR-2017 registration, KYC/AML, transaction monitoring | same | same | same | **same, and we are now explicitly the custodian** | **same, plus the fiat-referenced stablecoin regime and safeguarding** |

### 5.3 The honest position on testnet4

**testnet4 with valueless coins attracts none of these obligations**, and this is the entire reason D1
pins testnet4 first. Every shipped sidestr chain document carries the comment "Coins with no value"
(`R1:605-611`), and every example chain parents to testnet4 with no mainnet chain anywhere in the clone
(`R1:359-373`, `R1:795-799`). Our chains inherit that posture and declare it in `containment.value_class`.

The corollary that must be written into the ADR and not softened: **the moment a coin on our chain is
exchangeable for anything of value, the testnet posture ends regardless of what the parent chain is.**
A testnet4-parented chain whose coins are sold, bartered for compute, or treated as a credit redeemable
against a service is carrying value. The containment flag `value_class` is a declaration, and a
declaration that contradicts observable behaviour is worse than no declaration, because it becomes
evidence of intent. This is the single most important sentence in this section.

### 5.4 What the gate must therefore require before mainnet or real USDT

1. **Written legal sign-off** naming the specific activities assessed (peg custody; wrapped-asset
   issuance; redemption; any exchange between assets on our chain) and the conclusion on each.
2. **A decided KYC posture for pod owners**, recorded before the first real-value peg-in rather than
   retro-fitted. The estate currently has no KYC concept at all; identity is a `did:nostr` and nothing
   more (`docs/INGRESS-identity.md` per `R2:87-103`). Whether a peg-in requires an identified
   counterparty is a business and legal decision with a direct architectural consequence: if it does,
   the peg-in path needs an identity attestation binding a real-world identity to the DID, which the
   estate would have to build.
3. **Transaction monitoring hooks** wired before value, not after. Concretely: the peg-in, peg-out,
   bridge-claim and bridge-redemption paths each emit a structured event through the events adapter
   under the ADR-039 hash chain, with amount, counterparty pubkey, chain id and timestamp, in a form a
   monitoring rule can consume. The ontology already carries `urn:ngm:class:transaction-monitoring`,
   `kyc-aml`, `uk-mlr-2017` [established] and `aml` [mature] (ADR-124 §8), so the grounding exists and
   should be reused rather than re-derived.
4. **A safeguarding statement** for held client assets: where they are, who controls the keys, what
   happens on insolvency or on loss of `k` shares (P5), and how a client's claim is evidenced.
5. **The §4 gate receipt**, with both owner and legal 31403s, committed into genesis.

### 5.5 Questions for counsel

Listed in §8.2 with the owner questions, so there is one place to take to the meeting.

---

## 6. Privacy

### 6.1 What a public relay learns

- **Kind 23500 transaction events are signed by a throwaway key every time** (`signer.randomKey()`,
  `R1:206-215`), so submission never links a spending key to a persistent Nostr identity. That is a real
  property and worth preserving in our Rust wallet: the port must generate a fresh key per submission
  and must not "helpfully" sign with the wallet identity.
- **The transaction content is the raw transaction hex.** The relay therefore learns the full graph:
  inputs, outputs, amounts, and the chain tag. The throwaway key hides *who submitted*, not *what moved*.
- **Kind 33333 tip announcements are signed by `chain.signer`** and carry the chain id, the tip height,
  mirror URLs and the last twelve headers as content (`R1:216-221`). A public relay therefore learns
  that our chain exists, how fast it advances, where its mirrors are, and by inference when our
  federation is down. Mirror URLs are an attack surface handed out for free.
- **Level-2 round events (23510/23511/23514) are signed by the real signer identities** because signer
  identity *is* the authorisation (`R1:222-228`). A relay learns which of our instances is alive, which
  proposed at which height, and which is late. That is an operational-intelligence leak about our
  infrastructure, and it is unavoidable if we use public relays for the round.
- **Kind-only filtering** means our producers must download every event of the same kind from every
  sidestr chain on that relay (`R1:238-246`), which is a load problem (R3) and also means our
  subscription pattern reveals which kinds we care about.

**Requirement:** the level-2 round runs over **our own allowlisted relay** (`agentbox.toml:151-159`),
not over the public defaults `wss://nos.lol`, `wss://relay.damus.io`, `wss://relay.primal.net`,
`wss://nostr.mom`, `wss://nostr.oxtr.dev` (`R1:236-238`). Public relays may carry tip announcements for
discoverability if we choose discoverability; they must not carry the signer round.

### 6.2 Mirrors

A mirror sees every block and every reader's request pattern. Reading a wallet's balance through a
mirror reveals which addresses that client cares about. Requirement: our wallet fetches whole blocks and
filters locally, never asks a mirror "what is the balance of address X". The explorer replays every
block anyway (`R1:536-541`), so this costs nothing architecturally.

### 6.3 The did:nostr to chain-address linkage: the sharpest privacy finding

D4 says "a did:nostr balance is the UTXO set keyed by that pubkey on our chain"
(`BRIEF-fact-base.md:158-159`). Combined with upstream's derivation, where the address is literally
`5120 || x-only-pubkey` (`R1:544-556`), this means: **anyone who knows an agent's DID can compute its
chain address and read its entire balance and transaction history, forever.** DIDs are public by design;
they are in DID documents, in pod paths, in git commit author emails
(`contract.rs:236-240`, `mark.rs:23-27`). Every agent's finances become world-readable, and the
transaction graph links agents to each other whenever they transact.

This is not acceptable and it is cheap to fix. Three requirements:

1. **The chain spending key is not the identity key** (§2.1). This is now also a privacy requirement,
   not only a custody one.
2. **Per-purpose receive addresses** from `m/44'/1237'/7773'/j'/0/0`, one per counterparty or per
   invoice, so that no single address accumulates a whole balance and no address is derivable from a DID.
3. **Balance resolution is an authenticated lookup, not a derivation.** "What is this DID's balance"
   becomes a query answered by our own service from its own address index, behind NIP-98, rather than a
   computation anyone can perform. The chain stays the truth; the DID-to-address mapping stays private.

The cost is a mapping that must be backed up with the seed, which §2.2's deterministic hardened indices
already handle: `j'` is derived from the purpose identifier, so the mapping is reproducible from the seed
alone.

### 6.4 Relation to the privacy filter middleware

Adapter dispatch is wrapped in two layers, observability around privacy redaction, and that order is an
Invariant (`docs/adr/ADR-2036-dispatch-two-layer-encoder-is-a-gated-surface.md:33-37`). The JSON-LD
encoder is a per-surface gated stage whose ordering is enforced **by evidence, not position**: the
privacy filter stamps a per-dispatch marker and `assertPrivacyFilterApplied` (`encoder.js:128`) throws
for fail-closed slots on an unmarked payload (`ADR-2036:30-32,38-45`). ADR-2036's own rule applies
directly here: "Any new cross-cutting concern that applies uniformly to every adapter method joins the
wrap and states its fail-open/fail-closed behaviour in an ADR" (`ADR-2036:46-51`).

**Requirement:** chain data that crosses an adapter (a receipt written to memory, an event to the
events slot, a URN resolved through pods) is subject to the filter like anything else, and the sidestr
ADR states its fail-closed behaviour. Amounts and counterparty pubkeys are the redaction targets when
the destination is not the owner's own surface.

### 6.5 The email-taint fence as precedent, applied

ADR-2093 fences email-tainted sessions from the Jev compaction judge by tool-name prefix, with validator
E074 refusing a manifest that drops the email prefix and the whole rule living in `hooks/policy.mjs`
(`docs/adr/ADR-2093-jev-verbatim-compaction.md:39-44`), and ADR-2094 relaxes it only on an explicitly
declared `backendLocal: true` that is never inferred from a hostname, URL, IP literal or network probe
(`GOVERNANCE-capabilities.md` Invariants; `ADR-2093:108-115`).

That is the right shape and should be reused twice:

1. **A spend-tainted session.** A session that has called a sidestr wallet tool carries a taint, and the
   taint is consulted before any egress that could carry transaction detail: the live mirror
   (`config/hooks/nostr-live-mirror.cjs`, per `workspace/CLAUDE.md`), the kind-30840 session digest, and
   any consultant or non-local model call. `R2:548-559` already flags the mirror as a path that would
   need explicit exclusion so a payment confirmation is not mirrored to the operator's relay by
   accident. Make it explicit rather than incidental.
2. **A prompt-injection taint.** Per I5, wallet tools that surface third-party strings join the
   `taint_tools` prefix list so a session that has read a hostile memo cannot then be compacted or routed
   through a non-local engine.

Both go in `config/egress-policy.json`, which already enumerates content, recipients, providers,
encryption, transport and log retention per path, implemented twice and held together by a paired
redaction fixture both runtimes must satisfy (`docs/SECURITY-profiles.md:58-74`). A new path is a new
row there, not a new mechanism.


---

## 7. Security acceptance gates, per phase

Phases mirror the build order D3 implies. No phase begins until the previous phase's gate is green and
its receipt is recorded. "Green" means a receipt exists, not that someone remembers running it.

### 7.0 Phase 0: preconditions (no sidestr code)

| Gate | Evidence |
|---|---|
| S-1: `payment_settlement` wired to `authorityGate.guard` on every `/v1/pay/*` mutation (§3.1) | a test that a spend above threshold is denied without a signed 31403, plus the `authority.deny` journal entry |
| `spend-policy` accumulator durable and multi-process safe (§3.4.1) | restart during a budgeted sequence does not reset the budget |
| `services/secret-backup` wired into `flake.nix` and an off-host restore rehearsed (`SECURITY-profiles.md:44`) | dated restore receipt on synthetic data, off host |
| ADR-2078 landed; pods request signing wired (`R2:129-140`) | `sign_requests = true` without `SigningUnavailable` |
| `bitcoin_tx.rs` ported to `rust-bitcoin`, goldens still byte-identical (§2.5.6) | `tests/fixtures/bitcoin/golden_tx.json` passes post-port |

### 7.1 Phase 1: Rust validator and wallet, testnet4, read-only

| Gate | Evidence |
|---|---|
| Vector suite §2.5 items 1-5 | CI job, all green, vectors committed |
| Validator reproduces `txbt4-fed` challenge, addresses and one sealed block | fixture test against the live chain's published data |
| Containment hash check refuses a mismatched document at boot (§4.1) | negative test |
| Forbidden-term grep gate (§4.4) | CI |
| `deepsec` gate run in PR mode under `[security.deepsec]` (`agentbox.toml:1951-1958`, ADR-2033) with a receipt; exit 78 recorded as SKIPPED | receipt artefact |
| Contract tests for the new `sidestr` 402 scheme fixtures in `tests/contract/pay402/` | merge gate |
| No AGPL edge in the publishable crate graph; clean-room declaration in the crate ADR (§1.9 S4) | licence CI check |

### 7.2 Phase 2: our own testnet4 chain, level 2, valueless

Chaos suite, each run as an automated scenario with an asserted outcome, not a manual exercise:

| Scenario | Required outcome |
|---|---|
| **Signer down** (1 of 5) | chain continues; round-robin skips; metric shows the absence |
| **Signer down** (3 of 5, below k) | chain halts cleanly; no partial block is sealed; no coins move; alert fires |
| **Clock skew** on one signer beyond the lateness window | that signer refuses to propose rather than proposing a contested block (F6) |
| **Relay partition**: signers split across two relay sets | no two conflicting blocks at one height are sealed; the one-signature-per-height discipline holds (`R1:517-520`) |
| **Mirror lies**: a mirror serves a different block at an announced height | client rejects and fails over (`R1:635-640`) |
| **Mirror stalls**: a mirror serves a stale tip | client treats it as failed past N heights, not merely slow (M2) |
| **Replayed peg-in claim**: the same parent outpoint claimed at two heights | refused by the claims map (`R1:280-288`); assert the refusal is journalled |
| **Double-claim across a restart** | the claims map is durable; a restart does not re-open the claim |
| **Unverifiable claim**: a coinbase claims a peg-in with no parent transaction | each signer's own parent node refuses via `checkClaims` (F2) |
| **Forged partial** from a non-signer pubkey | rejected before the witness is assembled |
| **PSBT that pays somewhere else** | every co-signer refuses on independent re-derivation (P2); assert no signature is produced |
| **Fee below relay minimum** on a script-path spend | rejected by our band check rather than by the network (P3) |
| **Dead child chain** past `close.height` | force-close path runs, tombstone confirms, settlement reconciles to the root |
| **Rotation rehearsal**: retire one signer, move the peg to a new descriptor | completed within a documented window, funds intact, runbook updated (F8) |
| **Full recovery**: rebuild a signer from seed plus backup alone | signer rejoins, derives the same keys, validates from genesis |

### 7.3 Phase 3: bridge against a self-issued RGB20 test asset

| Gate | Evidence |
|---|---|
| Forged consignment rejected; replayed consignment rejected by atomic record-if-absent (B1) | negative tests |
| Reorganised RGB witness below confirmation depth does not mint (B2) | test against a regtest reorg |
| Bridge cannot claim on a chain whose `containment.bridge` is false, refused at all three points (§4.2) | three negative tests |
| Nightly reconciliation between chain claims and consignment history (B4) | reconciliation job with an alerting delta |
| Bridge key on its own branch, its own service account, its own container (§2.3) | configuration review receipt |

### 7.4 Phase 4: mainnet or real USDT. Independent audit required.

Nothing in this programme reaches mainnet on internal review alone. The estate's own precedent is
explicit: ADR-124's capability gate HARD-REFUSES declaring L2 until the engine is built **and
independently audited** (`R4` T1-6; ADR-124 §10 R3, "a subtle bug loses funds silently"), and
solid-pod-rs's own README instructs operators not to carry value through payment routes until its
findings are fixed (`R3` A.7, README.md:230-247). Required before the §4 gate receipt is signed:

1. **An external audit of the Rust validator, wallet and co-signer**, scoped to: consensus agreement
   with the reference implementation, the level-2 challenge and witness construction, the PSBT
   re-derivation check, the peg-in claim pairing and claims map, and key derivation and storage.
2. **An external audit of the bridge**, scoped to consignment validation, the claim key, the notional
   ceiling and the redemption path.
3. **A key-custody review** closing ADR-124 R4 (plaintext keys, no at-rest encryption, no `Zeroize`, no
   rotation), which the ADR already says "must close before T1+".
4. **Closure of ADR-124 R6** (per-ledger advisory lock or CAS, atomic record-if-absent) wherever the
   sidestr path touches a ledger.
5. **A rehearsed insolvency and loss-of-`k` procedure** (P5, §5.4.4).
6. **Written legal sign-off** per §5.4, recorded per §4.3.

---

## 8. Open questions

### 8.1 For the owner

1. **n and k for the root chain.** §1.1 F5 argues n >= 5, k = 3 so two instances may be down or
   rebuilding. How many independent instances will actually exist, and on how many distinct hosts and
   operator credentials? The answer sets the honest custody statement, not the other way round.
2. **Hardware signing at mainnet.** §2.3 requires at least `n-k+1` shares on hardware the container
   cannot read. Is that acceptable, and who physically holds those devices?
3. **Child-chain default: governed or free?** §3.3 proposes `child_approval_threshold_sats = 0`, so
   every hand-off of value to an agent-signed chain is a governed event. That is deliberately
   inconvenient. Is the friction acceptable for the first six months of measurement?
4. **Own relay only for the signer round?** §6.1 requires it, at the cost of a rebuild to admit each new
   federation member (`agentbox.toml:151-159`). Confirm the operational cost is accepted.
5. **Answered by D6, but two sub-questions remain.** D6 makes the parent family and the header family
   explicit `[sidechain]` configuration with the upstream default. §9 accepts that and adds the
   constraints. The two questions D6 does not settle: (a) may onboarding offer the two mainnet variants
   at all before the §4 gate receipt exists, or should the list be filtered (§9.4 recommends filtered);
   (b) is `btc:mainnet-blake2b` acceptable as a parent for anything that carries value given §9.2's
   reorg economics, or is it testnet-only in practice regardless of what the enum permits?
6. **Does `sidestr:gitmark` upstream relate to our gitmark?** R1 could not resolve whether the upstream
   chain is the same product as the estate's anchoring stack, and notes it checkpoints into
   testnet4-BLAKE2b rather than standard testnet4 or mainnet (`R1:1091-1097`). If our anchoring is meant
   to converge with it, that is a decision; if not, the name collision needs a note.
7. **Which of the three ledgers is retired first.** D4 makes the chain the truth and the others derived
   views; three unsynced `did:nostr`-keyed ledgers exist today with a version skew between consumers
   (`BRIEF-fact-base.md:91-94`, `R3` DUPLICATION 1 and 3). Retirement order is a security question
   because each retained writable ledger is a path that can mint balance outside the chain.
8. **The TXO stand-in "free-money oracle".** It is off by default but present
   (`crates/solid-pod-rs-server/src/handlers/pay.rs:498-519,461-468`). Delete it, or keep it behind the
   flag? Recommendation: delete, so it cannot become the path of least resistance for a sidechain
   deposit (`R3` GAPS 6).

### 8.2 For counsel

Framed as questions, with no answer implied.

1. Does operating a k-of-n federation that holds other parties' bitcoin in a taproot output, against
   claims recorded on a chain we produce, constitute a **cryptoasset custodian** activity requiring
   MLR-2017 registration, and does the pegger-controlled refund path (P6) affect that characterisation?
2. Does issuing a **wrapped claim** on our chain against an RGB-held USDT position constitute issuance
   or custody of a **qualifying stablecoin** under the FCA cryptoasset regime, or an activity in relation
   to one, and what safeguarding obligations attach to the held asset?
3. Does exchange between assets on our chain (sats against a wrapped asset) constitute a **cryptoasset
   exchange provider** activity, and does it matter that both legs are internal to a chain we operate?
4. What **KYC posture** is required of a pod owner who pegs in? Does it differ between a peg-in of our
   own funds, a peg-in by an identified customer, and a peg-in by an unidentified third party?
5. Are the **agent-signed ephemeral child chains** a separate regulated arrangement, or an internal
   sub-account structure within the root arrangement? The agent is a machine acting for a principal; who
   is the customer?
6. At what point does a coin that is not exchangeable for fiat but **is** redeemable against our own
   compute services become e-money, a voucher, or a regulated token? §5.3's line about declaration versus
   observable behaviour is the crux.
7. What **record-keeping and transaction-monitoring** minimums attach, and over what retention period,
   so that §5.4.3's hooks are built to the right shape first time?
8. Does the **AGPL-3.0 network-use clause** on the upstream sidestr code create any obligation when the
   code runs as an internal sidecar whose outputs are published to public relays? (`R4` tension 3 records
   that no canon documents this at all; ADR-2030's permissive policy for publishable crates is the
   forward rule.)

### 8.3 Deliberately unresolved here

- Whether the wrapped-asset consensus rule should be ours alone or proposed upstream. It is our rule
  either way at v1 (B7); publishing it is a strategy question, not a security one.
- The exact monitoring rule set. Building the hooks (§5.4.3) is in scope; deciding the thresholds is a
  compliance decision downstream of counsel's answer to 8.2.7.
- Which external auditor. Named in the ADR when chosen; the requirement (§7.4) does not depend on the
  name.

---

## 9. Amendment: D6, configurable parent network and header family

Owner amendment 2026-09-21 (D6): the parent network (`btc:testnet4-blake2b` | `btc:mainnet-blake2b` |
`btc:testnet4` | `btc:mainnet`) and the sidechain header/PoW family become explicit configuration in an
`agentbox.toml [sidechain]` block exposed by onboarding, defaulting to upstream's Knots BLAKE2b
testnet4. This section supersedes §8.1 question 5 and adds to §4, §1.3 and §7. It does not change any
other decision.

Facts used here are read from `~/workspace/blake2-experiment/SPEC.md` (b2mine spec v0.1, 2026-09-02,
"research complete, no code yet"), from R1 §11, and from the Knots source facts that spec records.

### 9.1 What the four options actually differ on

The four parent options are not four settings of one dial. They differ on **value**, on **finality**,
on **liveness of the refund clock**, and on **regulatory exposure**, and those four do not move
together.

| | `btc:testnet4-blake2b` (default) | `btc:mainnet-blake2b` | `btc:testnet4` | `btc:mainnet` |
|---|---|---|---|---|
| Parent coins have value | no | **yes** (fork coins exist 1:1 for every pre-fork UTXO, `blake2-experiment/SPEC.md:21`) | no | yes |
| Parent hashrate | unknown, low | **~1.1 PH/s measured, site claims >2 PH/s** (`SPEC.md:16`) | very low, stall-prone | ~full Bitcoin hashrate |
| Reorg economics | irrelevant | **"~1 PH/s is rentable"**, the spec's own top risk (`SPEC.md:297`) | irrelevant | strongest available |
| Retarget behaviour | 2016-block, 4x clamp | 2016-block with 4x clamp after a one-time 22-bit target shift; first retarget fell 41.3% (`SPEC.md:40-44`) | **stalls at the 151,200 retarget until real hash arrives** (`R1:800-804`) | stable |
| Block capacity | RDTS, weight <= 800,000 (~300 kB) until 1 Sep 2027 (`SPEC.md:45-46`) | same RDTS limit | standard | standard |
| ASIC availability to an attacker | Sia-class ASICs mine it with stock firmware, **by design** (`SPEC.md:15`) | same | n/a | n/a |
| Regulatory exposure (§5) | none | **full, immediately** | none | **full, immediately** |
| P2P isolation | shares magic and port 8333 with mainnet (`SPEC.md:47`) | same | separate | separate |

Two conclusions follow, and both belong in the ADR rather than in a tooltip.

**`btc:mainnet-blake2b` is a real-value parent with weak finality.** It is the one combination that
carries value *and* has reorg economics an attacker can buy. It is therefore the most dangerous of the
four for a peg, more dangerous than `btc:mainnet` despite looking like the cheaper mainnet. The spec's
own mitigation for its own mined coins is instructive: treat them "as zero-value until 100+
confirmations and a second independent explorer agrees on our block hash" (`SPEC.md:297`). A peg cannot
run on a parent whose own tooling advises 100 confirmations and an out-of-band second opinion, at
`pegConfirmations = 6`.

**`btc:testnet4` standard is not a safe default either, for the opposite reason.** Its retarget stall
(`R1:800-804`, which is the stated reason the reference sidestr chain exists at all) breaks the refund
clock: `refundBlocks` is a relative timelock counted in **confirmed parent blocks** (`R1:271-274`,
`R1:295-299`), so a stalled parent means the pegger's unilateral escape hatch never matures. On a
stalling parent, SPEC's principle "a dead sidechain costs time, not coins" becomes "costs unbounded
time", which for a person waiting on a refund is indistinguishable from losing the coins.

### 9.2 Per-family parameters that must move with the choice

`pegConfirmations` and `refundBlocks` are 6 and 10,000 in every upstream example
(`BRIEF-fact-base.md:22-24`, `R1:271-274`), calibrated for nothing in particular. They are now
family-dependent and belong in the containment block (§4.1, amended above).

| Family | `peg_confirmations` | `refund_blocks` | Statement the chain document must carry |
|---|---|---|---|
| `btc:testnet4-blake2b` | 6 is fine | 10,000 | valueless; refund maturity is unpredictable and that is acceptable because nothing is at stake |
| `btc:mainnet-blake2b` | **>= 100, and not sufficient alone** | must be justified against observed cadence, not inherited | "a well-funded attacker can rent hashrate exceeding this chain's; peg finality is economic, not cryptographic" |
| `btc:testnet4` | 6 | **refund maturity is not guaranteed to arrive**; say so | valueless; refund path may never mature during a retarget stall |
| `btc:mainnet` | 6 is conventional | 10,000 (~69 days at 10 min blocks) | full regulatory gate per §5 applies before this value may be selected |

Two further per-family requirements:

- **Checkpoint finality is parent finality.** The `checkpoints` rule writes `ckpt:<chain>:<height>:<hash>`
  into the parent (`R1:452-468`), and E2 makes the child-chain tombstone mandatory. A checkpoint on a
  rentable parent is only as final as that parent, so the tombstone's dispute-settling property (E2)
  weakens exactly where the parent is weak. Requirement: a chain on a `*-blake2b` parent records its
  checkpoint confirmation depth alongside the checkpoint, and a tombstone is not treated as settled
  below the family's `peg_confirmations`.
- **RDTS block capacity is a peg constraint.** Until 1 Sep 2027 the fork caps blocks at ~300 kB
  (`SPEC.md:45-46`). Peg-ins, peg-outs and checkpoints compete for that space with everything else on
  the fork. This tightens P3's fee-band check rather than loosening it: our co-signer must reject a
  PSBT whose fee rate is below a family-specific floor as well as above a ceiling, because a peg-out
  stuck in a 300 kB-per-block mempool is a liveness failure that looks like a promise unkept.

### 9.3 Replay across the fork pair

This is the genuinely new cryptographic hazard D6 introduces, and it is asymmetric.

The mechanism: **every pre-fork UTXO exists on both chains 1:1** (`SPEC.md:21`); the fork activated at
mainnet height 961,640 (`SPEC.md:36-39`). `SIGHASH_UNIFIED = 0x20` (PR 357) is **opt-in**, and makes a
fork-signed spend invalid on mainnet; Knots signs with it by default where the fork is scheduled
(`SPEC.md:54-56`). Note carefully what that does and does not protect:

- A fork-side spend signed with `SIGHASH_UNIFIED` **cannot** be replayed onto mainnet. Protected.
- A mainnet-side spend signed with a **standard** sighash, of a pre-fork UTXO, **is** valid on the fork
  and can be replayed there by anyone who observes it, moving the fork-side twin of those coins to the
  same destination. Not protected, and nothing in the opt-in flag helps, because the mainnet signer had
  no reason to set it.

For a peg this matters in one specific and avoidable way. If a peg descriptor's keys ever control a
pre-fork UTXO, then a mainnet peg-out is a free instruction to move the fork-side twin, and a fork-side
peg-out signed without the flag is a free instruction on mainnet.

**Requirement D6-R1: peg keys are post-fork by construction.** The `m/86'/...` peg branch (§2.2) is
derived from a seed generated for this programme, so no key on it can hold a pre-fork UTXO unless
someone deliberately sends one there. Make that an assertion, not an assumption: at descriptor import,
the signer scans the descriptor's history and **refuses to operate** if any UTXO it controls has a
confirmation height below 961,640 on a `*-blake2b` parent, or below the fork height on the
corresponding mainnet view. This is a cheap boot check and it removes the entire replay class.

**Requirement D6-R2: never reuse a key across parent families.** A separate branch per family, so the
same key never appears on two chains that share a UTXO history. §2.2's coin-type split (`1'` testnet,
`0'` mainnet) already does half of this; extend it to a distinct account index per family so that a
`btc:mainnet` peg key and a `btc:mainnet-blake2b` peg key are different keys.

**Requirement D6-R3: set the flag anyway.** Where a `*-blake2b` parent is configured, every spend our
code signs sets `SIGHASH_UNIFIED`, belt and braces, and a test asserts the sighash byte. Note the
interaction with R1's finding that every sidestr chain's **own** transactions already use the Knots
unified sighash from genesis via `unifiedSighashParam: 'blake2bHeight'` with `blake2bHeight: 0`
(`R1:1030-1036`) regardless of parent; D6 means our sidechain's own sighash and our parent-side sighash
are now independently configured, and the test matrix must cover the four combinations rather than
assuming they agree.

**Requirement D6-R4: the two parent nodes must not be confused for each other.** The fork shares
mainnet's network magic and port 8333, so fork nodes and Core nodes meet on the same P2P network and
reject each other's blocks, with slow peer discovery as a consequence (`SPEC.md:47`); the same datadir
cannot serve both and two instances are required (`SPEC.md:237-238`). A signer whose "parent view"
silently follows the wrong chain breaks F2's entire claim-verification argument while appearing
healthy. Requirement: at boot, a signer on a `*-blake2b` parent asserts
`getblockhash 961640 == 0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb`
(`SPEC.md:257`) and a signer on a standard parent asserts that the same height hashes to the last
SHA-256d block's successor in the Core view. A failed assertion is a boot failure. Slow peer discovery
also makes eclipse cheaper on the fork, so `addnode` peers are pinned in configuration and a signer
alarms if its peer count on a fork parent falls below a floor.

### 9.4 P21 under a configurable parent

D6 creates exactly the risk §4 exists to prevent: a value for the parent that now lives in an editable
TOML file, exposed to onboarding, where a single edit could point a chain at a mainnet variant. The
containment mechanism already handles it, provided three rules hold.

1. **The manifest configures chain *creation*, never chain *interpretation*.** `[sidechain]` supplies
   the values that go into a new chain document at seal time. Once sealed, the chain document is the
   authority, and the validator reads `containment.parent_network` and `containment.pow_family` from
   the document, never from the manifest. A manifest edit on a running deployment therefore cannot move
   a live chain anywhere; at worst it creates a different chain.
2. **The validator refuses a disagreement rather than preferring either side.** At boot, if
   `[sidechain].parent` or `[sidechain].pow_family` differs from the loaded chain document's
   containment values, the process exits with a named error. Preferring the document silently would let
   an operator believe they had changed something; preferring the manifest would be the exact silent
   flip ADR-124 Q4 forbids.
3. **Both values are inside the hashed object** (§4.1 as amended), so they are committed into genesis
   via the `pin:` record and cannot be edited without producing a different chain id.

**Onboarding must filter, not warn.** The `[sidechain]` block is described as exposed by onboarding.
A dropdown containing `btc:mainnet` and `btc:mainnet-blake2b` is a real-value option one click away from
someone who has just installed the software. Requirement: onboarding offers **only** the two testnet
families. The two mainnet values are accepted by the parser but refused by the manifest validator
unless a gate receipt (§4.3) is present in the repository, in the same shape as the §4.4 CI check, and
the refusal names the gate. This mirrors the estate's existing pattern for money surfaces, where every
one of them is default-off in the manifest (`agentbox.toml:1456-1470`: `consumer.enabled = false`,
`broadcast.enabled = false`, `external_router = "off"` with its custody warning).

**Manifest catalogue entry.** Per ADR-039, a new gate needs a `system-manifest.js` row with an honest
apply class (`R2:298-311`). `[sidechain]` is **`rebuild`**, not `boot`: the PoW family selection reaches
the kernel overlay that is baked into the image (`R1:999-1048` shows `powHash`, `structVariants`,
`blake2bHeight` and `unifiedSighashParam` as literal constants in `sidestrGraph()`, duplicated in
`explorer.mjs`), and the relay allowlist that carries the signer round is likewise baked at build time
(`agentbox.toml:151-159`). Declaring it `boot` would be the dishonest apply class ADR-039 exists to
prevent.

### 9.5 Consequence for the 2026-09-02 owner decision

`blake2-experiment/SPEC.md:4-6` records: "tokens first, no VisionFlow pivot. **The anchoring stack keeps
using mainnet.**" and its non-goals repeat "Any change to VisionFlow / block-trails anchoring. Mainnet
stays the record" (`SPEC.md:136`). D6 does not overturn that, and the ADR must say so explicitly: the
**anchoring** stack stays on `btc:mainnet` SHA-256d; D6 governs the **sidechain peg parent**, which is a
different consumer of a different parent for a different purpose. Two independent parent selections now
exist in the estate and must not be collapsed into one setting. If a future chain wants its blocktrail
anchoring and its peg on the same parent, that is a new decision with its own record.

### 9.6 Added acceptance gates

Appended to §7:

| Phase | Gate | Evidence |
|---|---|---|
| 1 | Header/PoW family round-trips for **every** configured family, not only the default | `HeaderV2` decode plus hash equals the RPC hash for six real fork blocks including one per observed ASIC profile (`SPEC.md:264-267`), and equivalent vectors for the SHA-256d path |
| 1 | Manifest/document disagreement is a boot failure (§9.4.2) | negative test per field |
| 1 | Onboarding cannot select a mainnet family without a gate receipt (§9.4) | negative test through the onboarding path, not only the parser |
| 2 | Pre-fork UTXO refusal (D6-R1) | a descriptor seeded with a synthetic pre-fork UTXO causes the signer to refuse to operate |
| 2 | `SIGHASH_UNIFIED` set on every parent-side spend under a `*-blake2b` parent (D6-R3) | sighash byte asserted across the four family/own-chain combinations |
| 2 | Wrong-parent tripwire (D6-R4) | a signer pointed at a Core node while configured for a fork parent fails to boot, and vice versa |
| 2 | Fork peer-count floor alarms | chaos scenario: drop `addnode` peers below the floor, assert the alarm |
| 2 | Fee-band floor under RDTS capacity (§9.2) | a PSBT below the family floor is rejected by the co-signer |
| 4 | If `btc:mainnet-blake2b` is ever selected for a value-bearing chain, the audit scope explicitly covers reorg economics and the chosen `peg_confirmations` | audit report section |

---

*Produced read-only, 2026-09-21. Mint the resulting records as `proposed`; the human ratifies.
Companion records this plan expects: an agentbox ADR from `docs/adr/TEMPLATE.md` at ADR-2096+, a PRD at
`docs/proposals/`, and an amendment to ADR-124 §7's matrix in the VisionFlow host repo.*
