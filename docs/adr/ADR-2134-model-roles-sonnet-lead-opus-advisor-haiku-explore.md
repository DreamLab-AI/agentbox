---
id: ADR-2134
title: Model roles — Sonnet leads, an Opus advisor is on call, search fans out to Haiku
date: 2026-10-09
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 67ab0c5414f8e71c13978e1d5a3b5423316cd65f
verified_paths: [services/agentbox-manifest/src/permissions.rs, agents/Explore.md, scripts/bake-ruflo-console.sh]
owner: jjohare
review_trigger: a Claude Code release that changes advisor pairing rules, or the ADR-2135 shadow log showing a subagent-model policy that beats this one; root ~/.claude/settings.json observed at `model: sonnet` straight after a boot (activation → live)
repo: agentbox
---

# ADR-2134 — Model roles: Sonnet leads, an Opus advisor is on call, search fans out to Haiku

## Re-verification — 2026-10-30

The governed Rust files changed only through `c3a370c60` formatting. Reformatting
the previous sources reproduced the current bytes; the governed state before
that formatting commit matches this record's previous verification. Existing
claims and activation status are unchanged; this is not new runtime acceptance.

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


## Re-verification — 2026-10-21

Ruflo console/mods/swarm versions match the v3.57.0 source; the routeTasks-off patch retains the upstream advisory continuation. All 18 plugin bake/registration tests pass against the real pinned tree. Factrail and Jev entries are unchanged. Manifest validation, the 95 catalogue gates, 45 agent-reconciliation checks and 25 role-supervisor checks pass. This is source verification; image activation and live checks remain separate deployment evidence.

Re-verified 2026-10-23 at `951ada931e235ad45b61b2bef90b7e5c76f8d76c`: of the governed paths only `scripts/bake-ruflo-console.sh` moved since the previous stamp (3 added comment lines on the staged plugin/CLI split; `git diff 16139219..HEAD`); `permissions.rs` and `agents/Explore.md` have no diff. The bake script still carries the `routeTasks` option defaulting to false (`:73-80`). In a detached worktree at HEAD: `cargo test --bin agentbox-manifest permissions` 7 passed; `node --test tests/config/ruflo-console.test.mjs` 17 pass, 0 fail, 1 skipped; `bash tests/config/agent-reconcile.test.sh` 45 passed, 0 failed. `agentbox.toml` keeps `model = "sonnet"` and `advisor_model = "opus"`; the pin is Claude Code 2.1.309, above the 2.1.293 advisor floor. **Correction to the 2026-10-21 note above:** "versions match the v3.57.0 source" no longer holds; the plugin source is the 3.60.0 branch commit `856de8f3` (console 0.45.0) while the npm runtime stays 3.57.0. The decision does not depend on either number. I did not re-run `agentbox-config-validate.js` (the worktree lacked node modules), so the bad-`advisor_model` rejection is carried from the original verification.
