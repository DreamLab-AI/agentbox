---
id: ADR-037
title: "Gap-Close sprint — agentbox slice decisions"
status: accepted  # ratified by operator 2026-08-21; D1-D8 verified landed (ADR-LANDING-PLAN-2026-08-21 §1.1)
date: 2026-07-08
type: architecture
author: Dr John O'Hare
depends_on: [ADR-011, ADR-013, ADR-029, ADR-033, ADR-036]
related: [PRD-019, DDD-017, ADR-004-visionflow, ADR-002-visionflow, ADR-003-visionflow]
review_trigger: the canon moves an owned item's wave or owner; a consumer side (VisionClaw did:nostr keying, PTT/STT capture; nostr-rust-forum ACSP contract) changes its wire contract; the trajectory corpus clears the Wilson floor and forces the REC-7 consumer-enablement decision; or a tenth agentbox item enters the register
"@context": https://schema.org
"@type": TechArticle
---

# ADR-037 — Gap-Close Sprint: agentbox Slice Decisions

**Status:** Proposed
**Date:** 2026-07-08
**Repo:** DreamLab-AI/agentbox
**Governed by:** [ADR-004 Gap-Close Sprint Governance](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/ADR-004-gap-close-sprint-governance.md), [PRD Gap-Close Sprint (meta)](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/PRD-gap-close-sprint.md), [ADR-002 Ecosystem Alignment Governance]
**Product record:** [PRD-019 Gap-Close agentbox slice](../prd/PRD-019-gap-close-agentbox.md)
**Domain record:** [DDD-017 Gap-Close agentbox context](../ddd/DDD-017-gap-close-agentbox-context.md)
**Local antecedents:** ADR-011 (named consultants over meta-router), ADR-013 (canonical URI grammar), ADR-029 (session-mirror live egress), ADR-033 (did:nostr Multikey convergence), ADR-036 (RuVector capability adoption and learning loop)

## Context

PRD-019 assigns agentbox nine items from the gap-close register. Most are not open questions of what to build; they are open questions of *where* a wire attaches and *which* existing contract it consumes. This ADR records the eight decisions the slice forces and the alternatives rejected for each. It does not restate PRD-019's acceptance criteria. The canon owns wave, owner and maturity tier per ADR-004 Decision 7; this ADR owns local implementation shape.

Two facts constrain every decision. agentbox already carries an honest learning loop (ADR-036) whose producer is live and whose consumers are gated behind a documented sample floor, so REC-7's "make it real" is a data-and-enablement question, not a fresh build. And agentbox is a distinct git repo, second remote `upstream` pointing at VisionClaw for historical reasons, with no root `Cargo.toml` — a `cargo metadata` invocation walks up to the sibling VisionClaw workspace, a footgun any CI decision must avoid.

## Decisions

### D1 — MAST attaches to the existing envelopes through one shared library (REC-5)

Define the 14 MAST modes once in `lib/failure-taxonomy.js` and consume it from both the trajectory hook path (`config/hooks/trajectory-recorder.cjs`) and the route error handlers (`management-api/routes/agent-events.js`), tagging the agent-events envelope metadata (`agent-event-publisher.js`) on failure. An unmappable failure is tagged `unmapped`, never dropped.

**Alternatives considered:**

| Alternative | Verdict | Rationale |
|---|---|---|
| A new standalone failure-classification service | Rejected | Adds a transport and a lifecycle for what is a field on two envelopes that already flow. The register's own lesson is that unwired capabilities rot; a service nobody calls would be the next D5. |
| Classify only in the QE fleet (`.agentic-qe/`) | Rejected | Leaves the live agent-events and trajectory paths free-text. The meta-PRD's target is *both* the QE fleet and agent-events emitting the taxonomy; QE-only misses the runtime wire the canaries observe. |
| Map the existing binary grade straight onto 14 modes with no `unmapped` sentinel | Rejected | A binary success/failure grade cannot distinguish 14 modes; forcing every failure into a mode would fabricate precision. The `unmapped` sentinel keeps the taxonomy honest about what the current signal can and cannot resolve. |

### D2 — Action class is a new orthogonal axis; blocking consumes the forum ACSP contract (REC-6)

Add an `authority_class` (`recoverable` | `zero-tolerance`) axis to SKILL.md frontmatter and the `agentbox.toml [skills.*]` schema, defaulting unclassified skills to escalation-required. A new `lib/authority.js` gates a zero-tolerance action behind a wait for a signed 31402 response, consuming the nostr-rust-forum ACSP contract rather than reimplementing the broker.

**Alternatives considered:**

| Alternative | Verdict | Rationale |
|---|---|---|
| Reuse `mandate.js` WAC ACL modes (`Read`/`Write`/`Append`/`Control`) for the action class | Rejected | Those modes are resource-scoped (which pod container an agent may touch), a different axis from action risk. Overloading them would conflate "may write to this pod" with "this action is irreversible". The two axes must stay orthogonal. |
| Default unclassified skills to permissive | Rejected | Inverts the meta-PRD's escalation-by-default requirement and reproduces the permissive posture the register flags. Escalation-by-default means the cost of forgetting to classify is a prompt, not an unreviewed irreversible action. |
| Implement the 31402 signing and decision loop inside agentbox | Rejected | The ACSP 31400–31405 machinery is owned by nostr-rust-forum (COM-16); a second implementation would drift from it and re-solve a solved problem. agentbox consumes the signed-response contract; the forum owns the broker (ADR-003, distributed by design). |

### D3 — REC-7 is scoped to agentbox's own trajectory loop; the out-of-repo banner is excluded (REC-7)

Scope REC-7 to the corpus-floor wait, the consumer flag-flip, and evidenced re-rank/advisory behaviour in agentbox's own trajectory loop. Explicitly exclude the "intelligence banner" and "hardcoded router confidence" — they live in the baked claude-flow CLI in the Nix store, outside this repo — and record that exclusion in the compatibility matrix. Add and remove no `learns` comment: the recon found none stale in agentbox matching this gap, and the one real in-repo `learns` line (`precedent-service.js:7`) is COM-16 territory.

**Alternatives considered:**

| Alternative | Verdict | Rationale |
|---|---|---|
| Treat the intelligence banner and router confidence as agentbox's REC-7 scope | Rejected | They are in `/nix/store/.../claude-flow-cli-3.14.4` (`router.js`, `hook-handler.cjs`), confirmed outside `/home/devuser/workspace/project/agentbox` by `which claude-flow` and a repo-wide `find`. Scoping them here would have agentbox's child PRD claim work it cannot do and cannot evidence — a maturity-honesty breach. |
| Delete "stale learns comments" as the meta-PRD phrasing implies | Rejected as a no-op | No stale comment matching this gap exists in agentbox; `claude-flow-hook-adapter.cjs:16` already disclaims learning state. Deleting a comment that is not there, or the one real `learns` line that belongs to a different working mechanism, would be theatre. |
| Flip `feed_retrieval`/`feed_routing` now to look closed | Rejected | The consumers are gated `false` behind `aggregate_min_samples = 20` on purpose (PRD-018 §6, ADR-036). Flipping before the floor clears would surface aggregates computed on too few samples — the exact degenerate-label pathology the Wilson bound exists to prevent. |

### D4 — Cross-model verification is a thin wrapper over named consultants, not a router (REC-8)

Build a thin orchestration wrapper that, for a closure-verification task, dispatches to a consultant from a different model family than the one that produced the change, using the existing `consultant-base.js` envelope. This supplies the anti-fox mechanism (meta-PRD Quality Gate 3) mechanically.

**Alternatives considered:**

| Alternative | Verdict | Rationale |
|---|---|---|
| Build the transparent cost-rewriting router (`claude-code-router` shape) | Rejected | ADR-011 evaluated and rejected exactly this: consultants are named and explicitly invoked, not anonymous backends a router silently switches between. Reopening that decision is outside this sprint's remit (ADR-004: settled architecture is an input, not a question). |
| A full ensemble/voting layer across all five consultants | Rejected | Over-builds the requirement. The sprint needs a different-family second opinion on a closure, not a quorum. One cross-family dispatch satisfies Quality Gate 3; an ensemble adds cost and latency for no gate. |
| Reuse a single fixed consultant for all verification | Rejected | If the verifier is always the same family, it cannot be guaranteed different from the producer; the anti-fox separation would fail whenever the producer happened to be that family. Family-of-producer must be an input to the dispatch. |

### D5 — Provenance is a signed-adjacent urn reference on the live mirror, not an embedded event (REC-9)

Append the current session's `urn:agentbox:activity` (or `execution`) id, minted via `lib/uris.js`, to the `nostr-live-mirror.cjs` DM rumor body as a reference, mirroring the pattern the digest bridge already uses (`nostr-pod-bridge/src/lib.rs:458-488`). Keep the reference within the rumor body cap; degrade to text-only on a missing urn.

**Alternatives considered:**

| Alternative | Verdict | Rationale |
|---|---|---|
| Embed a full signed Nostr event of the execution record in the DM | Rejected | Breaks the phone-notification size cap the mirror deliberately holds, and adds a second signing hop per turn. A resolvable reference gives verifiability without shipping the whole receipt through the mirror. |
| Sign the reference with a fresh per-turn key | Rejected | The gift-wrap already seals the DM with the derived mirror child key (ADR-029); a second signature adds a key-management surface for no additional guarantee. The reference is signed-adjacent — carried inside the already-sealed rumor — not independently signed. |
| Leave the live mirror text-only and rely on the digest for provenance | Rejected | The digest is a SessionEnd summary; the live mirror is the per-turn stream. Provenance to the pocket that arrives only at session end does not let the operator resolve a specific turn's action while it is happening. |

### D6 — did:nostr is minted at spawn in the entrypoint, persisted per profile (COM-14)

Add a spawn-time identity step in `config/entrypoint-unified.sh` (or `scripts/start-agentbox.sh`) that derives a per-agent secp256k1 keypair before `AGENTBOX_AGENT_DID` is exported, replacing the `did:nostr:local` fallback, mirroring the signer-from-raw-hex pattern in `junkiejarvis-agent.js`, canonicalised on the Multikey form per ADR-033. Persist per profile.

**Alternatives considered:**

| Alternative | Verdict | Rationale |
|---|---|---|
| Mint lazily on the first agent-event | Rejected | The four current consumers read `AGENTBOX_AGENT_DID` at import (`server.js:787`, `memory.js:136`, `aci-shell/server.js:44`, `linked-objects.js:88`); a lazy mint leaves a window where they read the placeholder. Spawn-time minting closes that window before any consumer reads. |
| Rely on an operator-provided `AGENTBOX_AGENT_DID` | Rejected | That is the current state — a placeholder default nobody sets, so every agent is `did:nostr:local`. The sprint's exit is a *verifiable* identity on a selected node; an unset environment variable never becomes one. |
| Regenerate the keypair on every start | Rejected | A per-restart identity is not addressable across sessions; VisionClaw could not key a node to a stable did:nostr. Per-profile persistence gives a durable identity a downstream can verify and re-verify. |

### D7 — Voice-intent gains an additive `actor_did`; the producer un-gates behind mandate (COM-15)

Add an additive `actor_did` field to the `/v1/voice-intent` request schema alongside the existing free-text `actor`, verified/reconciled like the speaker's `auth.did`. Un-gate the producer behind a mandate rather than the blanket `voice_intent = false` flag: with a valid mandate the route accepts and dispatches a scene-`actor_did`-targeted signed 31402; without one it declines.

**Alternatives considered:**

| Alternative | Verdict | Rationale |
|---|---|---|
| Keep hashing the free-text `actor` label as the target | Rejected | `hashString(actor)` (voice-intent.js:121) turns a human label into a numeric id with no verified identity behind it. The target of a governed voice command must be a verifiable did:nostr, not a hashed nickname. |
| Replace `actor` with `actor_did` (breaking) | Rejected | A breaking change to a route with (today) zero callers is cheap now but forecloses a caller that wants a human label for display. Additive `actor_did` keeps `actor` as an optional label and adds the verified identity as a separate field. |
| Flip `voice_intent = true` globally to un-gate | Rejected | A blanket flag makes the producer accept any request. Un-gating behind a mandate keeps the producer real (it dispatches) while the mandate check keeps it governed, matching the escalation posture D2 establishes. |

### D8 — Skill count gets a CI counter script, not a liveness canary (RES-d)

Add `scripts/skill-count-check.js` that counts `skills/*/SKILL.md` as the single source of truth and fails when `README.md` or `SKILL-DIRECTORY.md` diverges, run in the same pass as `scripts/agentbox-config-validate.js`. The canon `DriftCounter` consumes the script's machine-readable output. RES-d registers a CI gate, not a canary, because it wires no live loop.

**Alternatives considered:**

| Alternative | Verdict | Rationale |
|---|---|---|
| Keep hand-maintained counts in the two docs | Rejected | That is the drifted state: 90+ vs 104/109 vs an actual 115-117. Hand-maintenance is exactly what produced three numbers in one tree on one day. |
| Register a liveness canary for RES-d | Rejected | A canary observes live traffic on a wired loop (ADR-004 Decision 3). A skill count is static tree state, not a loop; a canary would misclassify it and dilute the canary discipline. A failing CI check is the right gate. |
| Let the canon own the count directly | Rejected | The canon `DriftCounter` is cross-repo; it cannot know agentbox's tree layout without a per-repo source. agentbox owns the source-of-truth script; the canon consumes it. This keeps the ADR-002 division: repository owns its facts, canon owns the cross-repo view. |

## What This ADR Does Not Decide

- The wave, owner or maturity tier of any item — the canon owns those (ADR-004 Decision 7). A tier claimed here is a target reconciled at the canon, not a self-award.
- The consumer sides: VisionClaw's did:nostr node keying and PTT/STT capture, nostr-rust-forum's ACSP signing loop, the canon `DriftCounter`. Those are cited contracts, not decisions this ADR makes.
- ADR-011's named-consultant model or ADR-003's distributed broker — both are inputs, not reopened.

## Consequences

### Positive

- Every wire attaches to an envelope or contract that already flows (agent-events, trajectory steps, the consultant envelope, the mirror rumor, the entrypoint export), so no unwired capability is created to rot.
- The anti-fox verification the whole sprint depends on (D4) is itself built inside agentbox and available to verify the other items' closures.
- REC-7's honesty is preserved: the out-of-repo banner is named and excluded rather than silently claimed, and the consumer flags stay gated until the floor clears.
- COM-14 and COM-15 draw a clean producer/consumer boundary, so the shared did:nostr blocker is minted once here and consumed by three surfaces in VisionClaw.

### Tradeoffs

- Eight canaries plus one CI gate is real registration overhead against the VisionClaw harness, and three of the canaries are standing monitors that must stay green, not fire once.
- The `authority_class` axis (D2) adds a field every skill must eventually carry; the escalation-by-default rule means an unclassified skill prompts until classified, which is friction by design.
- Un-gating voice-intent behind a mandate (D7) makes the producer real before its VisionClaw caller exists, so `CANARY-AB-VOICE` fires against a test caller until the cross-substrate path lands.

### Risks

- **REC-7 mis-scope.** The strongest risk is conflating the out-of-repo intelligence banner with agentbox's own loop. D3 fixes the boundary in writing and in the compatibility matrix; a future agent re-reading the meta-PRD's REC-7 phrasing must consult D3 before scoping.
- **CI walking up to the sibling workspace.** A `cargo metadata` from `agentbox/` resolves to the VisionClaw workspace at `/home/devuser/workspace/project`. Any CI added for D8 or elsewhere must not assume agentbox is a Rust workspace root; the counter script is Node, sidestepping this.
- **Corpus never clears the floor.** If real usage never accumulates 20 samples per pattern, REC-7's consumers stay gated and `CANARY-AB-LEARN` never fires — which registers REC-7 as `Open`, visibly, per ADR-004's structural answer, rather than as a false closure.
