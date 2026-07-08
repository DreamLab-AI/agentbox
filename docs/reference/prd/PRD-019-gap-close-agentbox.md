# PRD-019: Gap-Close Sprint — agentbox Slice

**Status:** Draft v1 (WorkPackageMinted)
**Date:** 2026-07-08
**Repo:** [github.com/DreamLab-AI/agentbox](https://github.com/DreamLab-AI/agentbox)
**Governed by:** [PRD Gap-Close Sprint (meta)](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/PRD-gap-close-sprint.md), [ADR-004 Gap-Close Sprint Governance](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/ADR-004-gap-close-sprint-governance.md), [DDD Gap-Close Context](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/DDD-gap-close-context.md), [ADR-002 Ecosystem Alignment Governance](https://github.com/DreamLab-AI/VisionFlow) (maturity vocabulary, compatibility matrix, release manifests)
**Child ADR:** [ADR-037 Gap-Close agentbox decisions](../adr/ADR-037-gap-close-agentbox-decisions.md)
**Child DDD:** [DDD-017 Gap-Close agentbox context](../ddd/DDD-017-gap-close-agentbox-context.md)
**Local antecedents:** PRD-018 / ADR-036 / DDD-016 (RuVector-native memory and honest learning loop — the producer this slice extends), ADR-011 (consultation MCPs — the named-consultant decision REC-8 respects), ADR-033 (did:nostr Multikey convergence), ADR-029 (session-mirror live egress — the wire REC-9 extends)

## TL;DR

This slice is agentbox's nine owned items in the gap-close register. None is a net-new capability; each closes a measured distance between a documented behaviour and the code that runs. The through line the meta-PRD named holds here too: the failures are "built, and unwired". The voice-intent producer exists as a fully-read Fastify route that returns 503 and has zero callers (`management-api/routes/voice-intent.js:91`). The did:nostr identity is a placeholder default (`config/entrypoint-unified.sh:515` sets `did:nostr:local`), read passively by four consumers that never receive a minted key. The provenance mirror runs per turn but carries readable text with no signed reference (`config/hooks/nostr-live-mirror.cjs`). The failure telemetry is free-text error strings, not a taxonomy. This slice wires each of those, or, where the honest answer is that the work is already done or belongs to another repository, it says so and marks the tier accordingly.

Two items resist the "wire it" framing and are handled as honesty work rather than build work. REC-7 (outcome learning) is largely finished and honestly gated: `feed_retrieval`/`feed_routing` sit `false` in the live manifest (`agentbox.toml:361-362`) behind a Wilson-bound sample floor documented in PRD-018 §6 and ADR-036, not stale-and-lying. The "intelligence banner" and "hardcoded router confidence" the meta-PRD cites live in the baked claude-flow CLI in the Nix store, outside this git repo; conflating them with agentbox's own trajectory loop would scope work that is not agentbox's to do. RES-d (skill-count drift) is a CI counter, not a wired loop, so it registers no liveness canary; it registers a CI gate instead. Both distinctions are load-bearing and are recorded in the maturity table below rather than smoothed over.

## Owned Items

Nine items, from the meta-PRD's agentbox work package. Wave assignment is the canon's; this slice does not re-scope it.

| Item | Title | Wave | Loop-closing | Canary |
|---|---|---|---|---|
| REC-5 | MAST 14-mode failure taxonomy replacing free-text errors | P1 | Yes | `CANARY-AB-MAST` |
| REC-6 | Authority model: recoverable vs zero-tolerance, escalation by default, blocking-on-signed-response | P1 | Yes | `CANARY-AB-AUTH` |
| REC-7 | Outcome learning made real (`feed_retrieval` / `feed_routing`) | P1 | Yes | `CANARY-AB-LEARN` |
| REC-8 | Model diversity in orchestration (anti-fox cross-model verification) | P2 | Yes | `CANARY-AB-DIVERSITY` |
| REC-9 | Provenance to the pocket (signed ref through the mirror) | P2 | Yes | `CANARY-AB-PROV` |
| COM-14 | did:nostr minted at spawn, in the spawn payload (source side) | P0 | Yes | `CANARY-AB-DID` |
| COM-15 | `/v1/voice-intent` producer un-gated behind mandate, scene-selected `actor_did`, signed 31402 | P1 | Yes | `CANARY-AB-VOICE` |
| REC-3 | Hook fields for contextual transaction cost (emitter side) | P1 | Yes | `CANARY-AB-CTC` |
| RES-d | Script-queryable skill-count source for the canon counter | P1 | No (CI-gated) | — |

## Item Specifications

Each item carries its current maturity tier (cited from the register and verified in code), its target tier, explicit acceptance criteria, and a falsification statement written now, before any implementation.

### REC-5 — MAST failure taxonomy

**Current tier:** `planned`. No MAST vocabulary exists anywhere in the repo (grep for `MAST` returns zero hits outside unrelated skill directories). Failure reporting is free-text: `management-api/utils/agent-event-ws-subscriber.js:41,105,115` log `err.message`; `management-api/routes/agent-events.js:231,236,314,322` return `{success:false, error: <string>}`. The one structured outcome signal is binary success/failure with a quality float in `config/hooks/trajectory-recorder.cjs:227,298` (`util.gradeResult(is_error, stderr, interrupted)`), and the agent-events envelope (`management-api/utils/agent-event-publisher.js:229-256`) carries no error or failure field at all.

**Target tier:** `integrated` — reached when both the trajectory hook path and the agent-events envelope emit a MAST tag, and the QE fleet output carries the same taxonomy (per the meta-PRD's agentbox maturity clause).

**Acceptance criteria:**
1. A shared `lib/failure-taxonomy.js` defines the 14 MAST modes as an enum with a single canonical mapping.
2. `trajectory-recorder.cjs` writes a `failure_mode` field on every graded-failure step; a graded success writes no mode.
3. The agent-events envelope metadata (`agent-event-publisher.js`) carries `failure_mode` on any action whose outcome is a failure.
4. A failure that maps to none of the 14 modes is tagged with an explicit `unmapped` sentinel, never silently dropped — the taxonomy's own honesty rule.
5. Route error handlers in `agent-events.js` classify their `{success:false}` returns through the same library.

**Falsification statement:** *REC-5 is falsified if any failure path through the trajectory hook or the agent-events envelope still emits a free-text error without a MAST tag, or if an unclassifiable failure is dropped rather than tagged `unmapped`.*

### REC-6 — Authority model

**Current tier:** `scaffolded`. Resource-scoped authority exists: `management-api/lib/mandate.js:39` defines `ALLOWED_MODES = ['Read','Write','Append','Control']` as WAC ACL modes per pod container, minted through `urn:agentbox:mandate`. This is real authority scoping, but it is container-scoped, not action-class-scoped, and has no escalation-by-default and no blocking-on-signed-response pattern. Skill frontmatter (`skills/*/SKILL.md`) carries only `name` + `description`, no permission tier. The `agentbox.toml [skills.*]` blocks are category on/off toggles, not risk tiers. The ACSP 31400–31405 blocking-approval machinery lives in nostr-rust-forum, not agentbox.

**Target tier:** `integrated` — a zero-tolerance action blocks pending a signed 31402 response and releases on receipt, observed in a live session.

**Acceptance criteria:**
1. An `authority_class` field (`recoverable` | `zero-tolerance`) is added to SKILL.md frontmatter and to the `agentbox.toml [skills.*]` schema.
2. A new or unclassified skill defaults to escalation-required, not to permissive.
3. A new `lib/authority.js` classifies an action and, for a zero-tolerance action, blocks until a signed 31402 response arrives, consuming the nostr-rust-forum ACSP contract rather than reimplementing the broker.
4. A recoverable action proceeds without a blocking wait; the classification is recorded on the agent-events envelope.

**Falsification statement:** *REC-6 is falsified if a new skill defaults to permissive, if a zero-tolerance action proceeds without a signed-response wait, or if agentbox reimplements the 31402 signing/decision loop instead of consuming the forum's.*

### REC-7 — Outcome learning made real

**Current tier:** producer `integrated`, consumers `scaffolded`. `record_trajectories = true` is live (`agentbox.toml:358`); `config/hooks/trajectory-recorder.cjs` writes real graded `(state, action, outcome, duration)` tuples into `trajectory_steps` (verified honest, not a stub). Both consumers are gated `false` (`agentbox.toml:361-362`) behind `aggregate_min_samples = 20` (line 359), documented in PRD-018 §6 (lines 14-15, 115) and ADR-036, with the gate-flip dated in `CHANGELOG.md:25` (2026-07-05). This is honest gating, not stale lying.

**Target tier:** `integrated` — learning observably influences a second consumer (the meta-PRD's REC-7 target), evidenced by a re-ranked `memory_search` result or an advisory routing hint traceable to an aggregate.

**Scope boundary (decided, see ADR-037 D3):** the "intelligence banner" and "hardcoded router confidence" the meta-PRD names are the baked claude-flow CLI at `/nix/store/.../claude-flow-cli-3.14.4` (`router.js` `0.8` constant, `hook-handler.cjs:243`), which is outside this git repo. agentbox's own `config/hooks/claude-flow-hook-adapter.cjs:16` already disclaims holding learning state. The one in-repo `learns` phrase (`management-api/lib/precedent-service.js:7`, "the system learns to auto-apply") is the governance precedent auto-apply mechanism, COM-16 territory, a distinct and real system — not the trajectory loop, so out of scope here.

**Acceptance criteria:**
1. The trajectory corpus reaches 20+ samples for at least one action-pattern (data-floor wait, scripted in `docs/developer/backlog.md:29-34`).
2. `feed_retrieval` and `feed_routing` flip `true` in the live manifest only after the floor clears.
3. A `memory_search` shows a re-rank bonus on a memory linked to a high-effectiveness pattern, evidenced by a before/after receipt, not asserted.
4. An advisory `[INTELLIGENCE]` hint surfaced by `feed_routing` traces to a specific aggregate id.
5. The compatibility matrix records that the claude-flow-CLI banner and router confidence are out-of-repo and not part of agentbox's REC-7 closure.

**Falsification statement:** *REC-7 is falsified if either consumer flag flips true before the sample floor clears, if the re-rank influence cannot be evidenced by a receipt, if agentbox's child docs claim the out-of-repo intelligence banner as their own closure, or if any in-repo comment is edited to claim the trajectory loop learns before it observably does.*

### REC-8 — Model diversity in orchestration

**Current tier:** `planned`. ADR-011 (`docs/reference/adr/ADR-011-consultation-mcps.md:22`) is the standing decision and it explicitly rejects automatic model diversity: consultants are "named consultants over MCP, not transparent rewriting", and the cost-rewriting router "stays a future optional add-on". Five consultant MCP servers (`mcp/consultants/{antigravity,codex,deepseek,perplexity,zai}/`) each wrap one fixed model (`consultant-base.js:128` `this.model = opts.model`). No automatic multi-model verification exists.

**Target tier:** `integrated` — a closure-verification task dispatches to a consultant from a different model family than the one that produced the change, using the existing consultant envelope, observed in a live session.

**Acceptance criteria:**
1. A thin orchestration wrapper accepts a verification task plus the model family that produced the change under review.
2. The wrapper dispatches to a consultant from a different family via `mcp/consultants/shared/consultant-base.js`, not a new transport.
3. The dispatch and the producing family are recorded, satisfying the meta-PRD's Quality Gate 3 (anti-fox separation) mechanically.
4. The pattern respects ADR-011: consultants stay named and explicitly invoked, not anonymous backends a router silently switches between.

**Falsification statement:** *REC-8 is falsified if verification dispatches to the same model family that produced the change, if it introduces a transparent-rewriting router ADR-011 rejected, or if the producing family is not recorded against the verification.*

### REC-9 — Provenance to the pocket

**Current tier:** `scaffolded`. Both pieces run. The digest bridge (`services/nostr-pod-bridge/src/lib.rs:458-460`) already carries a signed `urn: Option<String>` (the `urn:agentbox:thing:...` identity), embedded into signed Nostr events at lines 488, 517-553. The live per-turn mirror (`config/hooks/nostr-live-mirror.cjs`, NIP-59 gift-wrap, kind 1059 wrapping kind 14, `DEFAULT_RELAY` at line 45) carries no such reference — raw prompt/response text with no urn, no commit SHA, no agent-event id. Provenance to the pocket today means readable text, not a verifiable pointer.

**Target tier:** `integrated` — a per-turn mirrored DM carries a signed-adjacent urn reference resolvable to the underlying execution record.

**Acceptance criteria:**
1. The `nostr-live-mirror.cjs` DM rumor body appends the current session's `urn:agentbox:activity` (or `execution`) id, minted via `lib/uris.js` (the same grammar already used elsewhere).
2. The reference stays within the per-message rumor body cap (the hook's phone-notification size limit), so no full second-signed event is embedded.
3. The reference resolves to the execution/action receipt it points at, mirroring the digest path's pattern (`nostr-pod-bridge/src/lib.rs:458-488`).
4. The mirror stays fail-open: a missing urn degrades to text-only, never blocks the turn.

**Falsification statement:** *REC-9 is falsified if a mirrored turn carries no resolvable urn reference, if the reference does not resolve to a real execution/action receipt, or if adding the reference makes the mirror hook block a turn on failure.*

### COM-14 — did:nostr at spawn (source side)

**Current tier:** `scaffolded`. `config/entrypoint-unified.sh:515` sets `AGENTBOX_AGENT_DID="${AGENTBOX_AGENT_DID:-did:nostr:local}"` — a placeholder default read from the environment, not generated. Profile settings carry an unresolved `didTemplate: "did:nostr:{AGENTBOX_PUBKEY_HEX}"` string. Key-generation primitives exist only in tests and in one named consultant identity (`management-api/lib/junkiejarvis-agent.js:812`), not a generic per-spawn path. Four consumers read `AGENTBOX_AGENT_DID` passively (`mcp/aci-shell/server.js:44`, `management-api/server.js:787`, `management-api/routes/memory.js:136`, `linked-objects.js:88`) but nothing mints it.

**Target tier:** `integrated` (agentbox source side). The cross-substrate end-to-end proof (VisionClaw keying nodes by the minted did:nostr, D4/M1) targets `federation-verified` and is led by VisionClaw; agentbox owns minting and placing the key in the spawn payload.

**Acceptance criteria:**
1. A spawn-time identity step in `config/entrypoint-unified.sh` (or `scripts/start-agentbox.sh`) derives a per-agent secp256k1 keypair before `AGENTBOX_AGENT_DID` is exported, mirroring the signer-from-raw-hex pattern in `junkiejarvis-agent.js`.
2. The `did:nostr:local` fallback is replaced by a real minted `did:nostr:<hex>`.
3. The key persists per profile so a restart of the same profile keeps the same identity.
4. The minted did:nostr appears in the spawn payload the downstream (VisionClaw) reads, canonicalised on the Multikey form per ADR-033.

**Falsification statement:** *COM-14 is falsified if any spawned agent still exports `did:nostr:local`, if the key is regenerated on every restart of the same profile, or if the spawn payload does not carry a Multikey-canonical did:nostr for a downstream to verify.*

### COM-15 — Voice-intent producer

**Current tier:** `scaffolded`. `management-api/routes/voice-intent.js` implements `POST /v1/voice-intent` (fully read, 1-158). It is gated off (`agentbox.toml:34` `voice_intent = false`) and returns 503 when disabled (line 91). Auth reuses agent-event NIP-98 verification (`verifyAgentEventRequest`/`reconcileSourceUrn`, lines 98,115), so the speaker's did:nostr is verified when auth is on. The request body's `actor` field (line 62) is a free-text label hashed via `hashString()` into a numeric target id (line 121), not a did:nostr. No caller exists: grep for `v1/voice-intent` outside tests finds only the route and its registration in `server.js`.

**Target tier:** `integrated` (agentbox producer side). The full voice loop (VisionClaw PTT capture → STT → this endpoint → audible confirmation) targets `federation-verified` and is led by VisionClaw; agentbox owns the producer schema and the signed 31402 dispatch.

**Acceptance criteria:**
1. An additive `actor_did` field (did:nostr) is added to the request schema alongside the existing free-text `actor`, verified/reconciled the same way `auth.did` is for the speaker.
2. The producer un-gates behind mandate rather than the blanket `voice_intent = false` flag: with a valid mandate the route accepts and dispatches; without one it still declines.
3. A valid request produces an accepted, dispatched signed 31402 targeting the scene-selected `actor_did`.
4. The producer records the verified speaker did:nostr and the target `actor_did` distinctly (they are different principals).

**Falsification statement:** *COM-15 is falsified if the producer still hashes only a free-text actor with no verified `actor_did`, if it dispatches an unsigned or un-targeted intent, or if it conflates the speaker identity with the target actor identity.*

### REC-3 — Contextual transaction cost fields (emitter side)

**Current tier:** `scaffolded`. The trajectory-recorder step envelope (`config/hooks/trajectory-recorder.cjs:226-239,298-309`) carries `toolUseId`, `action`, `outcome{success,quality,signal}`, redacted payload and `durationMs` — real and locally timed, but no token count, no handoff count, and no DAG/task linkage beyond the single-session rollup. The agent-events envelope (`agent-event-publisher.js:229-256`) likewise has no token or cost field, and no concept of a handoff distinct from a single step.

**Target tier:** `integrated` — token and handoff fields flow on both envelopes and correlate a multi-agent chain, per the additive-schema pattern PRD-018 Phase 2 established for `duration_ms`.

**Acceptance criteria:**
1. `trajectory-recorder.cjs` writes a `token_count` on each step, parsed from the Claude Code transcript usage block already available to the hook.
2. Both envelopes carry a `handoff_id` (or `dag_id`) correlating steps across a multi-agent task chain.
3. The schema change is additive and byte-compatible with existing consumers, matching PRD-018's Phase-2 migration discipline.
4. A completed DAG can be reconstructed from the emitted fields (handoff counts, token burden per step).

**Falsification statement:** *REC-3 is falsified if a step emits no token count where the transcript carries a usage block, if multi-agent chains cannot be correlated by a handoff/dag id, or if the schema change breaks an existing envelope consumer.*

### RES-d — Skill-count source of truth

**Current tier:** `planned`. Three divergent live claims confirmed: `README.md:34` says "90+ skills"; `skills/SKILL-DIRECTORY.md:3` says "109 active skills" and line 39 says "104 skills"; the filesystem carries 117 directories under `skills/` with 115 `SKILL.md` files at depth 2 (verified `find skills -maxdepth 1 -type d | wc -l` = 117, `find skills -maxdepth 2 -iname SKILL.md | wc -l` = 115). No CI check ties these together.

**Target tier:** `integrated` (agentbox source side) — a script-queryable count wired into the validator pass. The canon `DriftCounter` (VisionFlow RES-d) consumes this source; the canon marks it `released` only when pinned in a release manifest.

**Not a liveness canary.** RES-d wires no agent action, decision, beam, voice command or provenance record end to end. Per ADR-004 Decision 3 it is not a loop-closing item, so it registers a CI gate, not a liveness canary. Forcing a canary on it would misclassify a static-drift check as a live wire.

**Acceptance criteria:**
1. A `scripts/skill-count-check.js` counts `skills/*/SKILL.md` as the single source of truth.
2. The script fails when `README.md` or `SKILL-DIRECTORY.md` states a count that diverges from the filesystem count.
3. The script runs in the same validator pass as `scripts/agentbox-config-validate.js`.
4. The canon `DriftCounter` can query the count non-interactively (machine-readable output).

**Falsification statement:** *RES-d is falsified if a second skill count can appear in the tree without CI failing, or if the count is not queryable non-interactively by the canon counter.*

## Liveness Canaries

Eight loop-closing items each register one canary against the VisionClaw-owned `LivenessHarness` (meta-PRD RES-a). A canary fires when it observes real traffic on the named wire in a live session; a fired canary is the difference between `integrated` and a claim. RES-d registers no canary (CI-gated, above).

| Canary ID | Item | Wire observed | Firing means |
|---|---|---|---|
| `CANARY-AB-MAST` | REC-5 | agent-events envelope metadata + `trajectory_steps.result` | A real failure carried a MAST `failure_mode` tag (or explicit `unmapped`), not a free-text string, end to end |
| `CANARY-AB-AUTH` | REC-6 | `lib/authority.js` block/release around a zero-tolerance action | A zero-tolerance action blocked, awaited a signed 31402 response, and released on receipt |
| `CANARY-AB-LEARN` | REC-7 | `memory_search` re-rank term / `feed_routing` advisory hint | An aggregate that cleared the sample floor observably changed a retrieval result or surfaced a traceable hint |
| `CANARY-AB-DIVERSITY` | REC-8 | consultant dispatch record | A closure-verification task dispatched to a different-family consultant than the producing family |
| `CANARY-AB-PROV` | REC-9 | `nostr-live-mirror.cjs` DM rumor body | A mirrored per-turn DM carried a resolvable `urn:agentbox:activity` reference |
| `CANARY-AB-DID` | COM-14 | spawn payload / exported `AGENTBOX_AGENT_DID` | A spawned agent exported a real minted `did:nostr:<hex>`, not `did:nostr:local` |
| `CANARY-AB-VOICE` | COM-15 | `/v1/voice-intent` response + dispatched 31402 | A valid voice-intent request produced an accepted, scene-`actor_did`-targeted signed 31402 |
| `CANARY-AB-CTC` | REC-3 | trajectory step + agent-events envelope | A step carried a `token_count` and a chain carried a correlating `handoff_id` |

Canary durability (per DDD Open Issue 2): `CANARY-AB-LEARN`, `CANARY-AB-CTC` and `CANARY-AB-MAST` feed KPI measurement (Mesh Velocity, CTC, Augmentation Ratio) and are standing monitors. `CANARY-AB-DID`, `CANARY-AB-VOICE`, `CANARY-AB-AUTH`, `CANARY-AB-PROV` and `CANARY-AB-DIVERSITY` are correctness wires where a single fire in a live session suffices for closure, re-checked on the SHA it was captured against.

## Cross-Repo Boundaries

Fixed by the queen; recorded here so the sub-item boundary lives in the child document per ADR-004 Decision 7.

| Item | agentbox owns | Consumer side (elsewhere) |
|---|---|---|
| COM-14 | Mint did:nostr at spawn, place in spawn payload | VisionClaw keys nodes by it, verifies before trust (D4/M1) |
| COM-15 | Producer route, `actor_did` schema, signed 31402 dispatch | VisionClaw PTT capture → STT → POST; the canon disclosure norm |
| REC-3 | Emit token/handoff fields on both envelopes | VisionClaw four-KPI dashboard (REC-4) consumes the CTC envelope |
| REC-6 | Classify actions, block on signed response | nostr-rust-forum owns the ACSP 31402 signing/decision loop (COM-16) |
| RES-d | Script-queryable skill-count source | VisionFlow canon `DriftCounter` consumes it |

## Maturity Summary

| Item | Current | Target | Gate to target |
|---|---|---|---|
| REC-5 | `planned` | `integrated` | `CANARY-AB-MAST` fires; QE fleet emits the taxonomy |
| REC-6 | `scaffolded` | `integrated` | `CANARY-AB-AUTH` fires on a live block/release |
| REC-7 | producer `integrated`, consumers `scaffolded` | `integrated` | Sample floor clears; `CANARY-AB-LEARN` fires |
| REC-8 | `planned` | `integrated` | `CANARY-AB-DIVERSITY` fires |
| REC-9 | `scaffolded` | `integrated` | `CANARY-AB-PROV` fires |
| COM-14 | `scaffolded` | `integrated` (source); `federation-verified` end-to-end (VisionClaw-led) | `CANARY-AB-DID` fires; VisionClaw verifies |
| COM-15 | `scaffolded` | `integrated` (producer); `federation-verified` end-to-end (VisionClaw-led) | `CANARY-AB-VOICE` fires; VisionClaw caller wired |
| REC-3 | `scaffolded` | `integrated` | `CANARY-AB-CTC` fires |
| RES-d | `planned` | `integrated` (source); `released` when canon pins it | CI gate green; canon `DriftCounter` consumes it |

No item is labelled above the tier its evidence supports. REC-7's producer/consumer split is stated rather than collapsed into one number. COM-14 and COM-15 target `integrated` on the agentbox source/producer side and name `federation-verified` as the VisionClaw-led cross-substrate proof, not folded into agentbox's own claim.

## Out of Scope

- The claude-flow-CLI intelligence banner and router confidence constant (out-of-repo, Nix store) — excluded from REC-7 by ADR-037 D3.
- The ACSP 31400–31405 signing and decision loop — owned by nostr-rust-forum (COM-16); agentbox consumes the contract.
- VisionClaw's did:nostr node keying and PTT/STT capture — the consumer sides of COM-14 and COM-15.
- The canon `DriftCounter` and its release-manifest pinning — VisionFlow owns RES-d's cross-repo counter; agentbox owns the skill-count source only.
- Pre-existing manifest-schema drift the validator flags (E016 `UnknownManifestKey` for `ruvnet_brain`, `mcp_startup_timeout_ms`, `mcp_tool_timeout_ms`; W017/W039/W045/W063) — noted for manifest hygiene, outside these nine items.

## Evidence Discipline

Per ADR-004 and the meta-PRD Quality Gates: each closed item carries an execution receipt (command, raw output, timestamp, git SHA); the anti-fox verifier that confirms a closure sits on a different model family from the producer (REC-8 supplies that mechanism for agentbox); evidence older than its captured SHA or 30 days is stale and re-opens the item. agentbox is a distinct git repo, not a VisionFlow submodule (no `.gitmodules` entry), so its SHA is pinned in the canon release manifest by explicit reference, not submodule tooling.
