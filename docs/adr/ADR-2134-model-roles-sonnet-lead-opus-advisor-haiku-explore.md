---
id: ADR-2134
title: Model roles — Sonnet leads, an Opus advisor is on call, search fans out to Haiku
date: 2026-10-09
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit:
verified_paths: [services/agentbox-manifest/src/permissions.rs, agents/Explore.md, scripts/bake-ruflo-console.sh]
owner: jjohare
review_trigger: a Claude Code release that changes advisor pairing rules, or the ADR-2135 shadow log showing a subagent-model policy that beats this one
repo: agentbox
---

# ADR-2134 — Model roles: Sonnet leads, an Opus advisor is on call, search fans out to Haiku

## Context
Claude Code's advisor tool (`advisorModel`, `--advisor`, `/advisor`; code.claude.com/docs/en/advisor) lets the main model consult a stronger one at decision points. The advisor must rank at or above the main model. Nothing in agentbox chose the Claude model: `model`/`effortLevel` were hand-set, ruflo's TinyDancer tiers label `agent_spawn` records that never become Claude Code subagents, `[model_routing.routes]` feeds only agentic-qe, and the ruflo-mods keyword route injected a dead `coder` recommendation every turn. A circulated "`--subagents haiku`" flag and "3× dispatcher pool" do not exist.

## Decision
- `[claude_code]` gains `model`, `effort` and `advisor_model`, reconciled every boot by `agentbox-manifest permissions-project` into the root settings and every profile whose settings carry no `env.ANTHROPIC_BASE_URL` (gateway profiles pin their own model and cannot reach the Anthropic-only advisor). A key removed from the manifest is retracted only while settings still hold the value boot wrote; `advisor_model = "off"` removes it. Running value: Sonnet, high effort, Opus advisor.
- Search subagents run on Haiku through `agents/Explore.md` (overrides the built-in by name). `CLAUDE_CODE_SUBAGENT_MODEL` is never set globally: it would also downgrade general-purpose and the `model: inherit` engineers.
- Advisor checkpoints are instructions in the Claude-only tier (`config/instructions/workspace.claude.md`): before a multi-file plan locks, after the same failure twice, before declaring done or committing. ADR-2135 nudges them mechanically.
- build-with-quality treats the advisor as a same-vendor second opinion; the EDD evidence-auditor stays cross-vendor. ruflo is coordination state, not a model router.
- ruflo-mods' prompt route is off by default (bake-time `routeTasks` option).

## Consequences
Advisor calls bill a full-transcript Opus read each; the saving relies on a Sonnet main. Operators who hand-set `/model` see it re-pinned at boot; remove the key to hand control back. GOVERNANCE-capabilities' "subagent models cannot be swapped" invariant is corrected: per-invocation `model` and frontmatter both choose.

## Verification
`cargo test --bin agentbox-manifest permissions` (7 pass); `node scripts/agentbox-config-validate.js agentbox.toml` accepts, a bad `advisor_model` is rejected; `bash tests/config/agent-reconcile.test.sh` 45/45; `node --test tests/config/ruflo-console.test.mjs` 17 pass; a bake over the real ruflo-mods tree changes exactly three lines; dry-run projection skipped openrouter and zai.
