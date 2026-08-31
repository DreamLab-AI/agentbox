---
id: ADR-2007
title: Runtime isolation is profile-based (per-profile HOME + CLAUDE_CONFIG_DIR), not Linux pseudo-users
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 960394b145fc2f9ab1c3191b682f87079c712e9e
verified_paths: [config/harness-wrappers/zai.sh, config/harness-wrappers/openrouter.sh]
owner: jjohare
review_trigger: A proposal to reintroduce Linux pseudo-user isolation as the primary model, or a harness wrapper omitting the redirect assertion
repo: agentbox
domain: BASELINE-container
lineage: legacy ADR-025 (multi-harness tmux architecture), supersedes ADR-028 (per-user agent fabric); PRD-021 N-01
---

# ADR-2007 — Runtime isolation is profile-based (per-profile HOME + CLAUDE_CONFIG_DIR), not Linux pseudo-users

## Context
Multiple harnesses (different providers/subscriptions) share one container and must not read each
other's settings or, worse, bill the wrong provider by inheriting the global `~/.claude`
`ANTHROPIC_BASE_URL`. Linux pseudo-users (`gemini-user`, `openai-user`, …) were the old isolation
model but added user-management complexity for no matching benefit under a single supervisord/tmux
runtime. A wrapper that silently launches against the wrong redirect is a mis-billing hazard, not
merely a config error. Prior state: ADR-025 (multi-harness tmux) superseding ADR-028 (per-user
fabric), with PRD-021 N-01 mandating the anti-mis-billing assertion.

## Decision
Session/harness isolation pins both `HOME` and `CLAUDE_CONFIG_DIR` to `$WORKSPACE/profiles/<slug>`
in each harness wrapper, so each harness reads its own `settings.local.json` (its own
`ANTHROPIC_BASE_URL` + token) and never the global `~/.claude`. Linux pseudo-user isolation is a dead
path and must not be reintroduced as the primary model. Each wrapper hard-fails loudly (`_die`) if
the profile directory/settings are missing or the provider redirect is absent or off-target. This
forecloses pseudo-user isolation and any wrapper that launches without asserting its redirect.

## Consequences
- Harnesses are isolated by directory, not by OS user — simpler under one supervisord/tmux runtime.
- Mis-billing is caught at launch with a loud failure rather than a silent wrong-provider call.
- Cost: every harness needs a provisioned profile dir with a valid redirect; a missing/misconfigured
  profile is a hard launch failure by design, not a fallback to global config.

## Verification
implementation_status = complete, established at verified_commit cbe7335b9.
`config/harness-wrappers/zai.sh` pins `HOME`/`CLAUDE_CONFIG_DIR` to `$WORKSPACE/profiles/zai`
(header :10-14), defines `_die` (:35), extracts and validates the `ANTHROPIC_BASE_URL` redirect
(:75-85) and fails on a missing dir/settings/redirect. `config/harness-wrappers/openrouter.sh`
mirrors this: profile pin at :10, `_die` at :34, redirect extraction/validation at :74-97.
