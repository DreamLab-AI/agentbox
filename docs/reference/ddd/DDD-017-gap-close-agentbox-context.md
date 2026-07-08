# DDD-017: Gap-Close Sprint — agentbox Bounded-Context View

**Status:** Draft v1 (WorkPackageMinted)
**Date:** 2026-07-08
**Repo:** `github.com/DreamLab-AI/agentbox`
**Bounded Context:** agentbox's slice of the Gap-Close Sprint — the nine owned items and the local aggregates their wires touch
**Governed by:** [Gap-Close Sprint Context](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/DDD-gap-close-context.md), [PRD-019](../prd/PRD-019-gap-close-agentbox.md), [ADR-037](../adr/ADR-037-gap-close-agentbox-decisions.md)
**Upstream (conformist):** Gap-Close Sprint (the register-to-closure lifecycle), Ecosystem Alignment ([ADR-002] maturity vocabulary), Judgment Broker ([ADR-003] the ACSP decision loop)
**Local antecedents:** DDD-016 (Memory-learning domain — the trajectory/aggregate model REC-7 and REC-3 extend), DDD-003 (Sovereign messaging — `did:nostr` owner identity, consumed not owned), ADR-013 (canonical URI grammar), ADR-033 (did:nostr Multikey convergence)

---

## 1. Bounded Context

This view scopes agentbox's part of the Gap-Close Context. It owns no new domain model; it conforms to three upstream contexts and names the agentbox-local aggregates that each owned item's wire attaches to. The Gap-Close Context supplies the lifecycle (a gap moves from published-and-owned, through falsification-stated, to canary-fired and closed at a tier). Ecosystem Alignment supplies the maturity vocabulary. The Judgment Broker supplies the ACSP decision loop that REC-6's blocking-on-signed-response consumes.

The slice sits at the source and producer edge of two cross-substrate loops. It mints the `did:nostr` VisionClaw keys nodes by (COM-14). It produces the signed 31402 the voice loop dispatches (COM-15). It emits the telemetry the canon's KPI dashboard reads (REC-3, REC-5). It never owns a render surface, a governance UI, or the broker itself.

---

## 2. Context Map

| Context | Relationship | Notes |
|---|---|---|
| **Gap-Close Sprint** ([DDD](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/DDD-gap-close-context.md)) | Conformist (upstream) | Supplies `RepoWorkPackage`, `ClosureEvidence`, `LivenessCanary`, the wave lifecycle. This slice is one `RepoWorkPackage`. |
| **Ecosystem Alignment** (ADR-002) | Conformist (upstream) | Supplies the seven-tier `MaturityTier` vocabulary used verbatim in PRD-019. |
| **Judgment Broker** (ADR-003) | Conformist (upstream) | Owns the ACSP 31400–31405 loop; REC-6 consumes the signed 31402 response contract, does not reimplement it. |
| **Memory & Learning** ([DDD-016](./DDD-016-memory-learning-domain.md)) | Local (this repo) | The trajectory producer and effectiveness aggregate REC-7 enables and REC-3 extends. |
| **Sovereign Messaging** ([DDD-003](./DDD-003-sovereign-messaging-domain.md)) | Local (this repo) | `did:nostr` owner identity, the mirror egress REC-9 extends. |
| **VisionClaw** | Customer (downstream) | Consumes the minted `did:nostr` (COM-14), POSTs to the voice-intent producer (COM-15), reads the CTC envelope (REC-3). |
| **nostr-rust-forum** | Supplier (upstream) | Supplies the ACSP 31402 signed-response contract REC-6 blocks on. |
| **VisionFlow canon** | Customer (downstream) | Consumes the skill-count source (RES-d) via `DriftCounter`; reconciles every tier. |

### Relationship types

- **Gap-Close → agentbox:** Conformist. This slice adopts the closure protocol (falsification before work, receipt-plus-canary closure, conservative maturity) without redefining it.
- **Judgment Broker → agentbox:** Conformist. REC-6 types its blocking action against the broker's `DecisionOutcome`/signed-31402 contract, not a parallel model.
- **agentbox → VisionClaw / canon:** Customer/Supplier. agentbox supplies minted identity, the voice producer, telemetry fields and the skill-count source; the consumers key nodes, capture voice, render KPIs and count drift.

---

## 3. Aggregates

Gap-Close aggregates this slice participates in, and the agentbox-local aggregates each owned item's wire attaches to.

| Aggregate | Root | Origin | This slice's part |
|---|---|---|---|
| `RepoWorkPackage` | Yes | Gap-Close | This document plus PRD-019/ADR-037 and the nine falsification statements are one work package. |
| `ClosureEvidence` | No (member of `RepoWorkPackage`) | Gap-Close | One receipt + maturity claim + canary result per closed item. |
| `LivenessCanary` | No | Gap-Close (harness in VisionClaw) | Eight canaries registered here (`CANARY-AB-*`); RES-d registers a CI gate instead. |
| `TrajectoryStep` / `EffectivenessAggregate` | Aggregate root: the trajectory | DDD-016 (local) | REC-7 enables the gated consumers; REC-3 adds `token_count`/`handoff_id`; REC-5 adds `failure_mode`. |
| `AgentEventEnvelope` | No (event value) | agentbox local | REC-5 (`failure_mode`), REC-3 (`token_count`/`handoff_id`), REC-6 (recorded authority class) attach here. |
| `AgentIdentity` (`did:nostr`) | Yes | DDD-003 (local) | COM-14 mints it at spawn; the value is consumed downstream by VisionClaw. |
| `VoiceIntent` | Yes | agentbox local (`routes/voice-intent.js`) | COM-15 adds `actor_did`, un-gates behind mandate, dispatches signed 31402. |
| `AuthorityClass` | No (value on a skill/action) | agentbox local (new) | REC-6 introduces the `recoverable`/`zero-tolerance` axis and the block-on-signed-response gate. |
| `ProvenanceReference` | No (value on the mirror rumor) | DDD-003 (local) | REC-9 attaches the `urn:agentbox:activity` reference to the live-mirror DM. |
| `SkillCatalogue` | No (tree state) | agentbox local | RES-d's single source of truth; CI-gated, not a wired aggregate. |

**Consistency boundary.** Per the Gap-Close invariant, a repository's closures are evidenced and reconciled together, at the canon. agentbox's nine items reconcile as one work package; a partial close (say COM-14 without its `CANARY-AB-DID` fired) does not advance the package's wave.

---

## 4. Entities and Value Objects

| Element | Kind | Identity / Fields | Owner |
|---|---|---|---|
| `AgentIdentity` | Entity | `did:nostr:<hex>`, Multikey-canonical (ADR-033) | agentbox (mints), VisionClaw (verifies) |
| `VoiceIntent` | Entity | request: `{transcript, actor?, actor_did, duration_ms}`; verified speaker `auth.did` distinct from target `actor_did` | agentbox producer |
| `MastFailureMode` | Value Object | one of 14 MAST modes, or `unmapped` | agentbox (`lib/failure-taxonomy.js`) |
| `AuthorityClass` | Value Object | `recoverable` \| `zero-tolerance`; default for unclassified = escalation-required | agentbox (`lib/authority.js`, SKILL.md frontmatter) |
| `EffectivenessAggregate` | Entity | Wilson-bound success rate, recency-decayed, gated on `aggregate_min_samples = 20` | agentbox (DDD-016) |
| `CtcField` | Value Object | `token_count`, `handoff_id`/`dag_id` | agentbox emitter (REC-3) |
| `ProvenanceReference` | Value Object | `urn:agentbox:activity:<id>` minted via `lib/uris.js`, within the rumor body cap | agentbox (REC-9) |
| `SkillCount` | Value Object | integer, source = count of `skills/*/SKILL.md` | agentbox (RES-d source), canon (DriftCounter consumer) |
| `MaturityTier` | Value Object | one of `historical`/`planned`/`scaffolded`/`standalone`/`integrated`/`federation-verified`/`released` | Ecosystem Alignment (consumed verbatim) |
| `FalsificationStatement` | Value Object | predicate whose truth means *not done*, authored before work | agentbox (per item, PRD-019) |

---

## 5. Domain Events

Gap-Close context events (from the upstream DDD) as this slice publishes and consumes them, plus the agentbox-local wire events each canary observes.

| Event | Trigger | Publisher | Consumer |
|---|---|---|---|
| `WorkPackageMinted` | This PRD/ADR/DDD triad committed | agentbox | Gap-Close context |
| `FalsificationStated` | Nine falsification statements written before work | agentbox | Gap-Close context |
| `CanaryRegistered` | Eight `CANARY-AB-*` registered against the harness | agentbox | `SprintWave` (VisionClaw harness) |
| `AgentIdentityMinted` | Spawn-time keypair derived, real `did:nostr` exported | agentbox entrypoint | VisionClaw (keys nodes), agent-events consumers |
| `VoiceIntentDispatched` | Valid request accepted, signed 31402 dispatched to `actor_did` | agentbox voice producer | VisionClaw actor, the scene |
| `FailureModeTagged` | A graded failure tagged with a MAST mode (or `unmapped`) | trajectory hook / route handler | agent-events envelope, QE fleet, canon KPI |
| `AuthorityBlocked` / `AuthorityReleased` | Zero-tolerance action blocked pending, released on signed response | `lib/authority.js` | the acting agent, agent-events envelope |
| `AggregateInfluencedRetrieval` | An aggregate past the floor re-ranked a `memory_search` or surfaced an advisory | memory retrieval / routing | the querying agent, `CANARY-AB-LEARN` |
| `ProvenanceReferenced` | A mirrored per-turn DM carried a resolvable urn | mirror hook | the operator's phone, `CANARY-AB-PROV` |
| `CtcFieldEmitted` | A step carried `token_count`; a chain carried `handoff_id` | trajectory hook / publisher | canon CTC dashboard (REC-4/REC-3) |
| `CanaryFired` | A canary observed real traffic on its wire in a live session | VisionClaw harness | `ClosureEvidence`, `SprintWave` |
| `ClosureEvidenced` | Receipt + tier + canary result recorded for an item | agentbox | AntiFoxVerifier (different-family, REC-8-supplied) |

---

## 6. Invariants

Conformant to the Gap-Close context's eight invariants; these are the agentbox-local restatements plus the two the slice adds.

1. **One owner, one child document (conformist).** Each of the nine items is discharged by this triad and no other. COM-14, COM-15 and REC-3 are co-owned; the sub-item boundary with VisionClaw is fixed in PRD-019 §Cross-Repo Boundaries, not left implicit.

2. **Closure is code-verified at the stated tier (conformist).** No item closes on documentation. COM-14 does not close on a template string existing; it closes on a real minted `did:nostr` exported and observed. COM-15 does not close on the route existing; it closes on an accepted, dispatched, signed 31402.

3. **Falsification precedes the work (conformist).** All nine falsification statements are written in PRD-019 before implementation.

4. **No canary, no closure for a loop item (conformist).** The eight loop items each carry a `CANARY-AB-*`. An accepted design whose canary never fires — REC-7 if the corpus never clears the floor — registers as `Open`, visibly.

5. **Maturity is claimed conservatively (conformist).** REC-7 is stated as producer `integrated`, consumers `scaffolded`, not one collapsed number. COM-14/COM-15 target `integrated` on the agentbox side and name `federation-verified` as VisionClaw-led, not folded in.

6. **The two identity principals stay distinct (local).** In a `VoiceIntent`, the verified speaker (`auth.did`) and the target actor (`actor_did`) are different principals and are recorded separately. Conflating them is a closure defect for COM-15.

7. **The out-of-repo learning surface is excluded, in writing (local).** The claude-flow-CLI intelligence banner and router confidence are not agentbox's REC-7 scope; the compatibility matrix records the exclusion. Claiming them as agentbox closure breaks maturity honesty.

8. **The authority axis is orthogonal to the resource axis (local).** `AuthorityClass` (`recoverable`/`zero-tolerance`) is a different axis from `mandate.js` WAC ACL modes (`Read`/`Write`/`Append`/`Control`). The two are never conflated.

---

## 7. Ubiquitous Language

Terms this slice adds or specialises, on top of the Gap-Close context's shared vocabulary (`Gap`, `Commitment`, `Residual`, `Wave`, `Exit Criterion`, `Closure Evidence`, `Liveness Canary`, `Falsification Statement`, `Maturity Tier`).

| Term | Meaning |
|---|---|
| **MAST mode** | One of 14 named failure categories replacing a free-text error string; `unmapped` is the honest sentinel for a failure the current signal cannot resolve to a mode. |
| **Authority class** | The `recoverable`/`zero-tolerance` risk axis on a skill or action; orthogonal to WAC ACL resource modes. |
| **Escalation by default** | An unclassified skill blocks pending review rather than proceeding — the cost of forgetting to classify is a prompt, not an unreviewed irreversible action. |
| **Blocking on signed response** | A zero-tolerance action waits for a signed 31402 response (the forum's ACSP contract) before proceeding, then releases. |
| **Speaker vs actor** | In a voice intent, the *speaker* is the verified `auth.did` who spoke; the *actor* is the scene-selected `actor_did` the command targets. Distinct principals. |
| **Signed-adjacent reference** | A `urn:agentbox:activity` id carried inside an already-sealed mirror DM — verifiable pointer without a second independent signature. |
| **Sample floor** | The `aggregate_min_samples = 20` Wilson-bound threshold an effectiveness aggregate must clear before it influences retrieval or routing. |
| **Skill-count source of truth** | The count of `skills/*/SKILL.md`, the single figure the canon `DriftCounter` reads and the two docs must match. |

---

## 8. Services

Agentbox-local services this slice adds or touches, and their status now (before work).

| Service | Responsibility | Owner | Status |
|---|---|---|---|
| `FailureTaxonomy` (`lib/failure-taxonomy.js`) | Map a graded failure to one of 14 MAST modes or `unmapped` | agentbox (REC-5) | `planned` |
| `AuthorityGate` (`lib/authority.js`) | Classify an action; block a zero-tolerance action on a signed 31402 response | agentbox (REC-6) | `planned` |
| `TrajectoryProducer` (`trajectory-recorder.cjs`) | Record graded tuples; extended with `failure_mode`, `token_count`, `handoff_id` | agentbox (DDD-016; REC-5/REC-3) | producer `integrated`, extensions `planned` |
| `EffectivenessConsumers` (`feed_retrieval`/`feed_routing`) | Re-rank retrieval and surface advisory hints once the floor clears | agentbox (REC-7) | `scaffolded` (gated `false`) |
| `IdentityMinter` (entrypoint spawn step) | Derive a per-agent secp256k1 keypair, export a real `did:nostr` | agentbox (COM-14) | `scaffolded` (placeholder default) |
| `VoiceIntentProducer` (`routes/voice-intent.js`) | Accept a mandate-gated request, dispatch a signed 31402 to `actor_did` | agentbox (COM-15) | `scaffolded` (gated 503, no caller) |
| `ProvenanceMirror` (`nostr-live-mirror.cjs`) | Append a resolvable `urn:agentbox:activity` reference per turn | agentbox (REC-9) | `scaffolded` (text-only today) |
| `CrossModelVerifier` (thin wrapper over consultants) | Dispatch a closure check to a different-family consultant | agentbox (REC-8) | `planned` |
| `SkillCountCheck` (`scripts/skill-count-check.js`) | Single source of truth for skill count; fail CI on divergence | agentbox (RES-d) | `planned` |

---

## 9. Open Issues

1. **Voice caller timing (COM-15).** The producer un-gates before its VisionClaw PTT/STT caller exists, so `CANARY-AB-VOICE` fires against a test caller until the cross-substrate path lands. Whether a test-caller fire counts toward closure, or whether closure waits on the real VisionClaw caller, resolves at the canon when the loop reconciles.

2. **Standing vs one-shot canaries.** `CANARY-AB-LEARN`, `CANARY-AB-CTC` and `CANARY-AB-MAST` feed KPIs and are standing monitors; the correctness canaries fire once. This mirrors the Gap-Close context's own Open Issue 2 and is resolved per canary in PRD-019 §Liveness Canaries.

3. **Corpus arrival (REC-7).** The gated consumers cannot be evidenced until real usage accumulates 20 samples per pattern. The trigger is out of agentbox's direct control (it depends on live agent traffic), so REC-7 may sit `Open` past P1's other closures without that being a defect — the sample floor is honest, not a stall.

4. **agentbox is not a VisionFlow submodule.** No `.gitmodules` entry ties agentbox to VisionFlow, so the release-manifest SHA pin is a manual reference. Canary registration against the VisionClaw harness is a runtime wire, not a git relationship, so it is unaffected.
