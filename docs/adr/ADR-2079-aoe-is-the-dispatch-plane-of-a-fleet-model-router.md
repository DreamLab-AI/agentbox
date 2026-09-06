---
id: ADR-2079
title: Examine AoE as the dispatch plane of a fleet model router — the routing policy lives outside the session manager, and privacy is its first axis
date: 2026-09-06
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: cda60e7a0d04a1436d2cdd83779c49745a4efb96
verified_paths: []
owner: jjohare
review_trigger: completion of the research spike in Decision §1 (fleet inventory, task classes, one week of routed-vs-default measurements), a second non-Claude harness needing per-task model choice, or any agent patching routing logic into the AoE source tree
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: PRD-005 (2026-04-25, archived) split "cost-rewriting router" from "explicit labelled consultants" and built only the consultants — the ORIGIN of the routing question, referenced with `see`; legacy ADR-041 (one policy, many projections — the per-activity Claude/Codex table); legacy ADR-042/043 (AoE interaction plane, session identity binding); ADR-2031 (consultant model projection); ADR-2070 (raw Loom door is never auto-routed). Nothing here is superseded.
---

# ADR-2079 — Examine AoE as the dispatch plane of a fleet model router

## Context

The operator asked (2026-09-06) whether Agent of Empires, tmux window 8 "Sessions", could
become the fleet's meta model router — choosing the LLM for agents and their subagents by
specialism, cost and speed — and whether that should be the tab's primary utility. Today AoE
supervises seven seeded heterogeneous sessions (`agentbox.toml [[interaction_plane.session_seeds]]`:
codex, antigravity, claude→openrouter, claude→zai, opencode→deepseek, opencode→loom,
opencode→loom-raw) and is the only estate surface that runs a non-Claude agent as a
first-class worker. Model choice is scattered across four unrelated mechanisms: the
`[model_routing.routes]` activity table (legacy ADR-041, projected into agentic-qe only), the
`[consultants.<name>].model` projection with dated tariffs (ADR-2031), the per-seed `model`
keys above, and a regex "Routing task" hook (`~/.claude/helpers/hook-handler.cjs route`) on
every prompt whose recommendations are mostly noise. No mechanism records an outcome. The ruv
ecosystem already ships four routers (survey 2026-09-06, Verification): none dispatches to a CLI
harness, and only agentic-flow's carries a privacy rule.

## Decision

**Proposed — an option to examine, not a commitment.** The intuition test came back "worth
examining, but not as stated", and this record fixes the shape any examination must respect.

1. **A research spike precedes any build.** Deliverables, in order: (a) a fleet inventory —
   every model reachable from the box with endpoint, harness, tariff (dated, per ADR-2031),
   measured latency, specialisms and privacy tier; (b) six to ten task classes with a
   scorecard per class; (c) one week of measurements comparing routed against default
   outcomes on real work, written to RuVector. No default-path change before (c) reports.
2. **AoE is the dispatch plane, never the decision plane.** Routing policy does not live inside
   the TUI session manager. AoE's role, if this is taken, is "dispatch and observe": receive a
   `(task, chosen backend)` pair, run it as a session, report the outcome. The AoE source tree
   stays unpatched (legacy ADR-042 overlay-only rule): dispatch rides `config.toml`
   (`custom_agents`, `agent_command_override`, seeds) and the `/api/sessions` surface behind
   the nip98-proxy (ADR-2009), nothing else.
3. **The policy lives in a small Rust routing crate in agentbox** (`services/`, clap subcommands
   like `agentbox-manifest`): a policy table, the per-class scorecard (task class, privacy tier,
   cost, latency, quality), and an outcome writer into RuVector through the MCP path
   (ADR-2014) so the scorecard can learn. It consolidates the four mechanisms in Context into
   one projection source; the `[model_routing]` table becomes its input, not a parallel truth.
   **It reuses, it does not re-derive.** The quality predictor is `@metaharness/router`
   (k-NN / kernel-ridge `TrainedRouter`, optional FastGRNN via `@ruvector/tiny-dancer`; both
   already in the baked ruflo closure at 0.3.3 / 0.1.22): the crate owns the candidate set,
   the privacy gate and the cost ceiling, and calls the predictor with an embedding. Outcome
   rows use ruflo's DRACO row shape `{embedding, scores{model: quality}, cost, latency}` so
   ruflo's promotion-gate analyser (quality > 2 %, cost < 1 %, p95 latency < 5 %) applies
   unchanged. agentic-qe's `HybridRouter` stays the QE fleet's in-process router, fed by the
   same policy through the existing `llm-config.json` projection. agentic-flow's `ModelRouter`
   is an API-level router that makes the model call itself — the PRD-005 cost-rewriting class —
   and is not adopted.
4. **Privacy tier is the first routing axis, before cost.** A task whose context carries
   personal or LAN-only content (the Loom exists for exactly this — ADR-2023, ADR-2055, the
   `config/egress-policy.json` classification) may only be dispatched to a backend at or
   below its tier. A cost optimiser that could send email-derived context to an external
   model is a rejected design. The raw Loom door stays agent-choice only and is never a
   routing fallback (ADR-2070).
5. **Subagent models are out of the router's reach.** Claude Code subagents run Claude models
   only; the router cannot swap a subagent's model. Its decision is binary at that seam:
   spawn a Claude subagent, or dispatch the task to an AoE session on another backend.
6. **Every dispatch is labelled and audited**, as the consultant tier already is
   (`mcp/consultants/shared/consultant-base.js` `consult`/`health`/`cost_estimate`,
   `memory-logger.js`): backend, model, tariff, latency, outcome, privacy tier, and the
   policy row that chose it. Anonymous, transparent request rewriting (the PRD-005 "cost
   router") remains rejected.
7. **Gate and apply class.** If built, the router is a `[model_routing.dispatcher]` gate
   (default off, `system-manifest.js` entry, apply class `boot`), byte-identical-when-off
   (ADR-2020), and the regex prompt hook is retired when it activates.

## Consequences

- The tab's utility would change from "seven idle harnesses to pick by hand" to a
  dispatch surface that a policy drives, which is what the operator asked for; but the
  policy is a new Rust service with a scorecard, a tariff feed and a learning loop, so this is
  a multi-week piece of work, not a bounded fix.
- Forbidden from now: patching routing logic into the AoE source tree; any routing path that
  ignores privacy tier; auto-routing to `loom-raw`; a second per-activity routing table.
- Cost of the spike alone: fleet tariffs are dated estimates (ADR-2031), so measured cost
  needs a real per-call feed; latency and quality need a harness per task class; a week of
  dual-run measurement doubles spend for that week.
- Dependencies that are not built: the execution journal and policy pipeline (ADR-2041 wired
  on one route only) would be the natural audit sink; until then the consultant JSONL logger
  pattern is the fallback.
- If the spike shows routed outcomes do not beat the default, the record moves to
  `rejected` and AoE stays a session manager.
- **Phase 0 landed as ADR-2080** (2026-09-06): the metaharness router runs as a dedicated
  AoE session for public work only, with receipts and trajectory rows that are the raw
  material for the spike in Decision §1. It dispatches only to OpenRouter; the fleet-wide
  dispatcher and privacy-tier scorecard remain this record's open work.

## Verification

`implementation_status: none`. Verified at `cda60e7a0d04a1436d2cdd83779c49745a4efb96`:
`grep -rn dispatcher agentbox.toml services/` returns nothing; `agentbox.toml [model_routing]`
has `enabled = true`, `aqe_agent_overrides = true` and twelve `routes` rows projected only to
`.agentic-qe/llm-config.json`; `[[interaction_plane.session_seeds]]` has seven seeds with
three explicit `model` keys; `~/.claude/settings.json` `UserPromptSubmit` runs
`hook-handler.cjs route`; no routing outcome is written to any RuVector namespace. Prior art:
`docs/archive/prd/PRD-005-meta-router-consultants.md` §TL;DR, the 2026-09-06 RuVector entry
`project-state/aoe-meta-model-router-thread-2026-09-06`.

**Native routers surveyed (2026-09-06, baked closures inspected).**

| Router | Where | Decides | Dispatches | Privacy axis | Learns from outcomes |
|---|---|---|---|---|---|
| ruflo `ModelRouter` (heuristic + Thompson bandit; ADR-148/149/150 neural path gated on `CLAUDE_FLOW_ROUTER_NEURAL=1`) | `@claude-flow/cli` 3.38.20 `dist/src/ruvector/model-router.js`, `neural-router.js`; MCP `hooks_model-route/-outcome/-stats/-verify` | Claude tier, or a model id incl. OpenRouter slugs | no — returns an id | none | yes (`.swarm/model-router-state.json`; DRACO trajectories; parallel-log promotion gate) |
| `@metaharness/router` (k-NN, KRR `TrainedRouter`, `NativeRouter` FastGRNN) | ruflo closure 0.3.3, tiny-dancer 0.1.22 | cheapest candidate whose predicted quality clears a bar | no | none | yes — trained from `{embedding, scores}` rows; portable JSON / `.safetensors` artefact |
| agentic-qe `HybridRouter` (ADR-043) + 5-tier `ModelRouter` (ADR-051) + mincut gating (ADR-068) + advisor routing with PII redaction (ADR-092) | agentic-qe 3.13.12 `dist/shared/llm/router`, `dist/routing/`; MCP `model_route`, `routing_economics` | provider + model per agent type, 10 provider ids (claude, claude-code, codex, openai, ollama, openrouter, gemini, azure-openai, bedrock, cognitum) | yes, but only in-process API calls for QE agents | redaction modes strict/balanced/off, not a tier gate | yes (`routing-feedback`, `routing-outcomes`) |
| agentic-flow `ModelRouter` | agentic-flow 2.0.7 `dist/router/router.js`, `router.config.json` | provider + model by rule (agentType, complexity, `privacy: high, localOnly`) | yes — it makes the call (anthropic, openrouter, gemini, ollama, onnx) | one rule | ADR-073 cost-optimal k-NN, opt-in |
| `@ruvector/router` | 0.1.30 in all closures | intent → handler by embedding | no | none | no |

Live probe: `model_route` on this record's own task returned tier 2 / `claude-sonnet-4-6`,
complexity 55, confidence 0.5, in 6 ms; `routing_economics` reports zero spend tracked. The
regex prompt hook is `~/.claude/helpers/router.js` (`TASK_PATTERNS` → agent name), which routes
to an *agent*, not a model. `CLAUDE_FLOW_ROUTER_NEURAL` is unset in this container.

**Acceptance test for the spike landing** (moves this record to `accepted`, impl `partial`):
1. `docs/reference/` holds the fleet inventory with a dated tariff and a measured latency
   per model, and a privacy tier for every endpoint.
2. Six to ten task classes exist as a checked-in table with a scorecard each.
3. A week of routed-vs-default outcomes is queryable in RuVector via `memory_search`, and the
   report states per class whether routing won, lost or tied.
4. No file under the AoE flake input changed.
