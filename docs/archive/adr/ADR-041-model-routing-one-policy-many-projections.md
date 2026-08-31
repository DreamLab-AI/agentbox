---
id: ADR-041
title: "Model routing: one per-activity Claude/Codex policy, many boot projections"
status: implemented
date: 2026-07-24
type: architecture
author: Dr John O'Hare
depends_on: [ADR-011, ADR-015, ADR-027]
related: [PRD-001, PRD-005, ADR-005, ADR-037, ADR-039]
review_trigger: >-
  agentic-qe changes the agentOverrides schema or the constructible-provider set (re-verify
  the projection against the new sanitizer); upstream ruflo #2766 unpins CLAUDE_FLOW_DB_PATH
  from local SQLite (re-evaluate enabling dual_run); a third frontier host CLI joins the image
  (the two-host route grammar "host:model -> host:model" needs generalising); codex-primary
  mirroring is requested as a first-class behaviour (currently leadership only affects severity
  semantics); or the model catalogue drifts far enough that the soft defaults route to retired
  model IDs.
"@context": https://schema.org
"@type": TechArticle
---

# ADR-041 — Model routing: one per-activity Claude/Codex policy, many boot projections

**Status:** Implemented 2026-07-24
**Date:** 2026-07-24
**Repo:** DreamLab-AI/agentbox
**Related:** ADR-011 (consultant tier — the anti-fox model-diversity seam this reuses in spirit), ADR-015 (postgres memory mandate — the reason dual_run stays off), ADR-039 (system surface — the `model-routing` catalogue entry), pacphi/agentic-kit ADR-0001/0002/0004/0006 (the pattern source).

## Context

The image ships two frontier hosts — Claude Code and the OpenAI Codex CLI — but until now
they composed only **manually**: the codex named consultant (`/consult codex`), the
codex-companion skill, and tmux profiles. The QE fleet (agentic-qe) ran on its default
provider with no routing policy at all. Meanwhile the mechanism for structured dual-host
routing is **already shipped upstream**: agentic-qe ≥ 3.13.1 reads an on-disk per-agent
`agentOverrides` map from `.agentic-qe/llm-config.json` (issue #568, sanitised on load),
and `@claude-flow/codex` ships a host-symmetric `DualModeOrchestrator` with collaboration
templates.

pacphi/agentic-kit demonstrated the right shape for configuring this: **one routing policy,
many projections** — a single `activity → host + model (+ escalation)` map materialised into
each downstream config surface, so the surfaces cannot drift apart. That is agentbox's
existing manifest idiom (one TOML, entrypoint reconciles projections every boot), so we
adopt the pattern natively rather than depending on the `ak` CLI.

## Decision

1. **`[model_routing]` in `agentbox.toml` is the single source of truth.** Twelve
   activities (`specification, architecture, design, implementation, testing, review,
   security-scan, security-analysis, documentation, debugging, packaging, release`), each
   mapped as `"host:model"` with an optional `" -> host:model"` escalation rung. Defaults
   are grounded in upstream `@claude-flow/codex` CollaborationTemplates (Claude:
   reasoning/review activities; Codex: execution activities); `packaging`/`release` are
   kit-originated gap-fills and flagged as such in the manifest. Models are soft defaults.

2. **Projections are reconciled at every boot (apply class: `boot`), never hand-synced:**
   - `scripts/model-routing-project.py` writes `agentOverrides` + `defaultProvider` + a
     complete `fallbackChain` into **every** `.agentic-qe/llm-config.json` under the
     workspace (depth-capped walk; dirs created later pick the policy up next boot).
     All non-managed keys in an existing file are preserved; API keys are never written;
     writes are atomic (temp + rename, matching aqe's own `saveRouterConfigFile`).
   - The entrypoint reconciles `AQE_LLM_PROVIDER` on the agentic-qe MCP env block in
     `.mcp.json` (set when the gate is on, removed when off).
   - The projection is **fail-open**: the script always exits 0; on any failure the fleet
     keeps upstream defaults and boot proceeds.

3. **`dual_run` (the `claude-flow-codex` collaboration-swarm surface) ships but stays
   `false`.** Upstream pins `CLAUDE_FLOW_DB_PATH` to a local SQLite file as a workaround
   for ruflo #2766, which conflicts with the ADR-015 postgres memory mandate. The gate
   exists so the decision is visible in the manifest; flipping it is an operator
   experiment, not a default.

4. **Escalation rungs prefer the cross-vendor hop** (`codex → claude:opus`), the same
   principle as ADR-011/ADR-037 D4's model-diversity "anti-fox" seam and aqe's qe-court
   vendor-diversity referee: failing over to a *different* vendor both improves recovery
   odds and preserves review independence. Note the honest capability boundary: the
   escalation rung is *encoded in the policy* but only the aqe projection has a native
   escalation consumer (`auto-escalation-tracker`); the rung is advisory elsewhere.

5. **`primary_host` is a leadership axis, not an enablement axis** (adapted from
   agentic-kit ADR-0006): the primary host's absence is a failure, the alternate's a
   warning. Automatic table mirroring for codex-primary is deliberately NOT implemented
   (model tiers don't map 1:1 across vendors); codex-primary operators tune
   `[model_routing.routes]` directly.

6. **Hosts are subscription-tier** (`claude-code`, `codex` providers — `$0` marginal).
   The projection never seeds a metered API provider; `aqe_llm_provider` and the fallback
   chain validate against aqe's constructible-provider set and drop anything else, the
   same discipline as upstream's `sanitizeAgentOverrides`.

## Consequences

- One edit point (`agentbox.toml`); the wizard (browser + TUI) exposes the gates; the
  per-activity routes render schema-driven in the browser wizard.
- `GET /v1/system` shows the `model-routing` module with apply class `boot` (ADR-039
  documentation-as-data contract).
- agentic-qe is pinned ≥ 3.13.1 in `flake.nix`; do not downgrade below it while
  `aqe_agent_overrides` is on (the overrides map would be silently ignored).
- The `.agentic-qe/llm-config.json` files become managed artefacts: hand edits to the
  managed keys are overwritten at the next boot (stated in the file's `_managedBy` stamp).
- Cost: a projector script and a manifest section to maintain; justified by eliminating
  N hand-synced per-project router configs and giving the QE fleet a deliberate,
  subscription-only routing posture.

## Provenance

Pattern adapted from pacphi/agentic-kit (MIT) ADR-0001 (one policy, many projections),
ADR-0002 (activity vocabulary grounded in upstream templates), ADR-0004 (escalation
availability stated per projection path), ADR-0006 (primary-host leadership axis). The
2026-07-24 adoption analysis (three-agent fan-out + ruvnet-kb grounding) is stored in
RuVector memory: `patterns/agentic-kit-adoption-analysis-2026-07`. Companion pulls from
the same analysis: the `token-audit` skill, `ruflo-daemon-gc.py`, `npx-stale-scan.sh`,
the aidefence closure probe in `lib/npm-cli.nix`, and the `RUFLO_DAEMON_AI_WORKERS=0`
runtime-env pin.
