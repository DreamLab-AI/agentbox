---
id: ADR-2031
title: Consultant model selection is projected from the manifest at boot; environment wins, TUI preserves the operator's choice, and tariffs are dated
date: 2026-09-04
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: ec257a2567993518b25d69a34541544a2a54ef6c
verified_paths: [config/entrypoint-unified.sh, services/agentbox-manifest/src/tui_write.rs, mcp/consultants/antigravity/server.js, skills/mcp.json]
owner: jjohare
review_trigger: any change to a consultant's default model, a Gemini model retirement, the 2027-01-01 Gemini tariff step, or a wizard that starts exposing the consultant model field
repo: agentbox
---

# ADR-2031 — Consultant model selection is projected from the manifest at boot; environment wins, TUI preserves the operator's choice, and tariffs are dated

## Context
`[consultants.antigravity].model` in `agentbox.toml` was declarative only: the
MCP registry (`skills/mcp.json:409`) and the consultant server each carried
their own hard-coded fallback, and the TUI writer rendered a fixed literal, so a
`tui-write` save silently reset an operator's model. The consultant's price
constants were a single undated pair applied to whatever model was configured.
Google released `gemini-3.8-flash` on 2026-09-02 with an introductory tariff
that doubles on 2027-01-01, making both problems visible.

## Decision
The manifest is the source of the consultant model. At boot the entrypoint
projects `consultants.antigravity.model` into `AGENTBOX_ANTIGRAVITY_MODEL`
through `agentbox-manifest toml-string` (`config/entrypoint-unified.sh:1585`),
a fail-open subcommand that prints an empty string for a missing, non-string or
unparseable value. Precedence is fixed: a non-empty environment variable set
before boot wins, then the manifest, then the registry default. The TUI writer
carries an existing manifest model forward unless the flat state names one
explicitly (`services/agentbox-manifest/src/tui_write.rs:37`). Consultant cost
figures are API-equivalent estimates selected by call time against a published,
dated tariff; a model with no configured tariff reports `cost_usd: null` and
`cost_estimate` says so rather than inventing a number. The general-purpose
Gemini default across manifest, setup template, schema, consultant, URL-context
MCP and the AoE session seed is `gemini-3.8-flash`.

## Consequences
Operators change a consultant model in one place and it survives TUI saves and
rebuilds. No boot-path Python is reintroduced (the projection rides the Rust
manifest binary). Anyone overriding to a model without a tariff loses the cost
figure rather than receiving a wrong one. The tariff table needs refreshing at
the 2027-01-01 step and whenever a new default lands. Already-running AoE
sessions keep their old model argument until recreated.

## Verification
Working tree of 2026-09-04, before the rebuild: `cargo test --locked` in
`services/agentbox-manifest` (108 passed; `tests/consultant_model.rs` covers
`toml-string` fail-open, TUI precedence state → existing → default, and the
entrypoint block under env-set / env-empty / env-unset / manifest-missing);
`node --test mcp/consultants/antigravity/server.test.cjs` (2 passed: argv
carries the model, tariff steps at the UTC year boundary); the model id and
tariff were checked against Google's model reference and release post. Nix
evaluation of the staged fixture in `lib/agentbox-manifest.nix` and boot in the
rebuilt image remain to be confirmed on the host (see
`docs/reference/upgrades-2026-09.md`).
