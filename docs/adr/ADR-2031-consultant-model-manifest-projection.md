---
id: ADR-2031
title: Consultant model selection is projected from the manifest at boot; environment wins, TUI preserves the operator's choice, and tariffs are dated
date: 2026-09-04
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: ee742ade57ddca06ba846676e6006171ec76c49d
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
`docs/archive/upgrades-2026-09/upgrades-2026-09.md`).

## Closeout extension — 2026-09-04

CP-01/08. Owner remains jjohare with consultant/runtime maintainers. Source reinspection confirms environment-over-manifest boot projection. Existing tests and pricing references retain their original scope/date; this pass does not re-verify external model availability or tariffs. Staged activation remains unchanged.

**Acceptance condition:** retain the staged Nix/boot receipt, effective projected model and actual process argument across absent/empty/explicit overrides and TUI saves. Distinguish old sessions from newly created sessions. Report unknown tariff without an invented cost and date any future tariff verification. Reopen on model precedence, registry defaults, TUI write or boot changes. See the [configuration review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/configuration-projection.md).

## Landing re-verification — 2026-09-05 (ddd1f1ec8)

Governed paths changed in the landing commit: config/entrypoint-unified.sh: the ADR-2063 hub start/restart nudge and `.git/worktrees` chown, and the ADR-2057 harness/precedent gate reads and HARNESS_TEMPLATE_DIR export; the consultant model projection block is unchanged and `cargo test --test consultant_model` (agentbox-manifest) passes 3/3 against it. Range ec257a256..08e817f39 was re-read as well: 204 lines landed by the ADR-2034 hub projection and sprint blocks, none touching the projection. Decision unaffected; `verified_commit` moved to the landing commit.

## Landing re-verification — 2026-09-06 (796d85fcf)

Governed paths changed in the Wave 3 landing commit: config/entrypoint-unified.sh. The changes are the ones recorded by the Wave 3 records landed in that commit (ADR-2061, 2064, 2065, 2066, 2068, 2069, 2070, 2072, the proposed 2071/2073–2078) and the ADR-2018 recall diagnosis; none alters this record's decision. Gates at the landing commit: management-api 81 suites / 1290 tests, exposure gate PASS, catalogue 60 paths, config validation clean. `verified_commit` moved to the landing commit.


## Bounded source re-verification — 2026-09-07

The entrypoint delta replaces only the agent identity block; consultants.antigravity.model projection and operator-override precedence are unchanged. A failed identity now aborts boot rather than allowing downstream consumers to start with a placeholder. The complete intervening change to the governed source was reviewed at `a0ee1fe5740baa38e14c4ff3fe512dd557bcbb6e`; prior runtime/approval limitations remain.

**2026-09-07 re-verified at `ee742ade5`.** Governed paths changed by `ee742ade5` (ADR-2082 orchestration proxy): config/entrypoint-unified.sh. The changes are additive — two new `[integrations.ruvector_external]` keys, their entrypoint env projection, one catalogue entry and two schema properties — and touch none of the sections this record governs; the decision and its invariant hold unchanged. Re-verified by `git diff a0ee1fe57..ee742ade5 -- <verified_paths>`; no re-implementation was needed.
