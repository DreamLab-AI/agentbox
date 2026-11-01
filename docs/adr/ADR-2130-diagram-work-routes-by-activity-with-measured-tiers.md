---
id: ADR-2130
title: Diagram skills route by four model_routing activities on loom and zai hosts, with tiers set by measured descent and seal review always cross-family
date: 2026-10-05
decision_status: accepted
implementation_status: partial
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: cc949bb79c9ac89858d01c1235dd3bca6e2226a2
verified_paths: [services/agentbox-manifest/src/routing.rs, agentbox.toml, schema/agentbox.toml.schema.json]
owner: jjohare
review_trigger: the sealmap skill landing (DESIGN §10 step 5) with the four routes and two hosts; a Loom model swap; a change of the GLM model behind [consultants.zai]; a seal review whose author and reviewer share a family; ADR-2079's router consolidating [model_routing.routes]
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2079 (the routing table this extends; still proposed); ADR-2080 (the [model_routing] section it extends, not its neural router); ADR-2023 (the Loom is a façade on the :8084 door); ADR-2053 (Z.AI egress posture); ADR-2031 (consultant models from the manifest); sealmap docs/DESIGN.md §6 and §11.4 (owner-accepted 2026-10-05) is the source of truth.
---

# ADR-2130 — Diagram work routes by activity, with measured tiers

## Context

Diagrams-as-code work (sealmap: extract, seal, condense, narrate, review) has steps that need no model at all, steps a 27B local model does well, and steps that need a frontier model. Without a rule, a skill hard-codes a model id and one swap means editing every skill. `[model_routing.routes]` already maps an *activity* to `host:model` with one optional ` -> host:model` escalation rung. The parser accepts only the `claude` and `codex` hosts (`services/agentbox-manifest/src/routing.rs:82-87`). `host_provider` sends every non-`claude` host to `codex` (`routing.rs:68-73`), and that fallthrough would mislabel a new host. A seal reviewed by the model family that wrote it shares that family's blind spots. The `sealmap-review` skill (`c4ea4efca`) already sends diagrams, never source, to Gemini 3.8 Flash.

## Decision

Diagram skills name `[model_routing]` activities and never name model ids. The deterministic steps (extraction, symbol to line, staleness, pack) are **T0**: they run in `sealmap`, cost zero tokens and have no route. Four activities are added. The route each one will carry is in the grammar below; the escalation triggers are checked by the skill, and the grammar names only the next rung:

| Activity | Start → rung | Escalate when |
|---|---|---|
| `diagram-polish` | **T1** `loom:qwen3.8-27B -> claude:claude-sonnet-5`. Claude Haiku is the alternative T1 that the descent may select | the render gate fails twice; diagram-ir finds an invented edge; more than 25 % of calls are inferred |
| `diagram-narrative` | **T2** `claude:claude-sonnet-5 -> claude:claude-opus-5` | seal-review rejects; the topic spans 3 or more areas |
| `diagram-synthesis` | **T3** `claude:claude-opus-5 -> claude:claude-fable-5-1` | the corpus is too large for T3 → T4 Fable |
| `seal-review` | **T3 cross-family** `zai:glm-5.3 -> claude:claude-fable-5-1` | contract-class disagreement → T4 |

Two hosts are added, described the same way as `claude → claude-code` and `codex → codex`:

- **`loom`** → the Ontology Loom façade: `${LOOM_BASE_URL}`, the `:8084` door (ADR-2023), or the compose-profile `loom` sidecar `http://loom:8080`. It speaks OpenAI chat-completions, needs no key, stays on the LAN and costs $0 at the margin. The model behind it is swappable, and no consumer ever targets the model port. Non-ontology subjects send `{"loom_options":{"scaffold":false}}`.
- **`zai`** → the GLM model on Z.AI's Anthropic Messages API: `ZAI_URL` and `ZAI_ANTHROPIC_API_KEY` under `[providers.zai]`, with the auth home `[consultants.zai].home`. Calls are metered and leave the estate. This is the egress path that ADR-2053 already names.

**Tiers are set by measured descent.** A tier is lowered one step at a time, and only while accuracy holds within 0.03 of the tier above. Each step is confirmed on held-out data. A confirmed de-escalation is sticky per corpus and recorded in `docs/diagrams/.tiers.json`; the route is the default start for a corpus with no record. **Seal review is always a different model family from the author.** The `seal-review` route must not share a family with the route that authored the topic. If a skill finds that the author and the reviewer share a family, it refuses to seal; it never reviews with the same family.

**External review is outside `[model_routing]`.** `sealmap-review` calls Gemini 3.8 Flash directly, using `GEMINI_API_KEY` from agentbox `.env`. It is a review transport, not an activity: it is not routed, it sends diagrams only, and it does not stand in for `seal-review`.

## Consequences

- A model swap, including a Loom model swap, is one manifest edit and touches no skill. T0 work never spends tokens.
- **Landed 2026-10-31 (agentbox side); the sealmap side is still open.** The four routes, the `loom`/`zai` hosts in `route_re` and explicit `host_provider` arms are implemented and tested here. The `.tiers.json` reader and the same-family seal-review refusal belong to the `sealmap` tool, which is packaged from `DreamLab-AI/sealmap` (`lib/sealmap.nix`) and is not in this repository, so they remain open. The path `skills/sealmap` this record named does not exist and is not created: the in-repo skill is `skills/sealmap-review`, which the record says is not an activity and not a `seal-review` substitute.
- Neither new host maps to the agentic-qe subscription tier. Neither `loom` nor `zai` has a constructible agentic-qe type, so the QE-fleet projection must skip both rather than mislabel them (`zai` as `codex`, `loom` as `openai`, which would target api.openai.com; amended 2026-10-31, see the close-out).
- `seal-review` on `zai` sends topic content to a cloud provider. This decision does not yet name a LAN-only reviewer from another family, so a corpus that must not leave the estate has no conforming seal reviewer. That is an open item, not a licence to review it with the same family.
- What this forecloses: a skill choosing a model by id, a same-family seal review, and lowering a tier without a held-out measurement.
- Revisit if ADR-2079's router absorbs `[model_routing.routes]`; if GLM leaves Z.AI or `[consultants.zai].model` changes family (`seal-review` then needs another non-Claude family); or if the grammar gains more than one rung.
- **Rejected:** naming model ids in skills, because every swap then edits every skill; same-family review, because it is cheaper but blind to that family's own mistakes; and choosing tiers by assumption, because DESIGN §6 makes tiers an output of measurement.

## Verification

`implementation_status: none`. Checked at `66f975561` by reading committed code: `routing.rs:82-87`'s regex admits only `claude|codex`; `routing.rs:68-73` maps every other host to `codex`; the test `an_unknown_host_is_rejected` (`routing.rs:412`) holds; and no `skills/sealmap/` directory exists. The `[model_routing.routes]`, `[providers.zai]`, `[consultants.zai]` and `[[interaction_plane.session_seeds]] slug = "loom"` keys were read in `agentbox.toml`. **Acceptance for `complete`:** the four routes parse; `host_provider` has explicit `loom` and `zai` arms; and the sealmap skill refuses a same-family seal review in a test.

## Close-out 2026-10-31 (partial)

**Verified at `2a36c42d8`:** the regex admitted only `claude|codex`, `host_provider` sent every other host to `codex`, and `agentbox.toml` had none of the four routes. `sealmap-review` exists in-repo (`skills/sealmap-review`, also baked at `/opt/agentbox/skills`), already registered and lint-clean, so no skills authoring step is owed. `skills/sealmap` was never a path in this repo.

**Implemented:**

- `routing.rs`: `route_re` admits `claude|codex|loom|zai` as start and rung. `host_provider` has explicit arms: `loom` -> `loom` and `zai` -> `zai`, both deliberately absent from `AQE_CONSTRUCTIBLE`, so the agentic-qe projection skips them (fail closed) and never mislabels them `codex` or `openai`.
- `schema/agentbox.toml.schema.json`: the twelve route patterns widened and the four activities added.
- `agentbox.toml`: `diagram-polish`, `diagram-narrative`, `diagram-synthesis` and `seal-review` as the record's table gives them. Claude ids follow the manifest's live ids (`claude-sonnet-5-5`, `claude-opus-5-5`, `claude-fable-5-1`), not the shorthand `claude-sonnet-5` / `claude-opus-5` in this record's table. The Loom start model is the record's `qwen3.8-27B`; the Loom's current alias is `hemmingway-1.5-q8_0` and the workspace notes say old `qwen3.8` names are still accepted, which this change did not verify against a live Loom. Models are soft defaults.

**Tests:**

```
cd services/agentbox-manifest && cargo test --offline     # 210 passed across all binaries, golden llm-config unchanged
#   new: the_four_diagram_routes_parse_as_start_and_as_rung, host_provider_has_an_explicit_arm_for_every_admitted_host,
#        a_zai_route_is_never_projected_as_an_agent_override, the_shipped_manifest_routes_all_parse_and_include_the_diagram_activities
node scripts/agentbox-config-validate.js agentbox.toml    # valid, same 6 advisory warnings as the primary checkout
node scripts/ci/check-manifest-catalogue.js               # PASS, 118 gate paths
```

**Remaining, so `implementation_status` stays `partial`:**

1. The `sealmap` tool must read these routes, refuse a same-family seal review in a test (this record's acceptance), and own the `.tiers.json` reader. All of it lives in `DreamLab-AI/sealmap`.
2. The measured descent has not run. The tiers are soft defaults until accuracy is measured on held-out data, one step at a time within 0.03.
3. A corpus that must not leave the estate still has no conforming LAN-only cross-family seal reviewer (an open item the record already names).

`activation_status` stays `inactive`: the projection skips these activities for the QE fleet (none maps to an `AGENT_ACTIVITY_MAP` entry), and nothing consumes them until `sealmap` does.

**Correction (F3, 2026-10-31): loom fails closed.** The first W8 cut mapped `loom` to `openai`, a latent egress fault. agentic-qe's `openai` provider targets api.openai.com and nothing here sets `OPENAI_BASE_URL` to the Loom, so a QE activity routed to `loom:*` would have sent its prompt, with the Loom model name, to OpenAI. The shipped manifest was not affected (no `AGENT_ACTIVITY_MAP` activity routes to `loom`). `host_provider("loom")` now returns the unconstructible `loom` label, the override loop skips it exactly as it skips `zai`, and `routing.rs` tests assert no `openai` agent override and no Loom model in any fallback-chain entry (`cargo test routing` in `services/agentbox-manifest`: 11 passed). Reinstating a Loom-backed QE provider needs a constructible base-URL provider first, as a new decision.

Re-verified 2026-10-31 at `2f15c531b02b8f8393d68d29ce3491712bdd862c` (W7 and W8 integration, `adr-sprint/w78`). Governed-path delta since `1e41b64b6`: `routing.rs`: `host_provider("loom")` now returns the unconstructible `loom` label instead of `openai`, so the agentic-qe projection skips loom routes as it skips zai (the correction recorded in this record's close-out), with tests; `agentbox.toml` and `schema/agentbox.toml.schema.json`: since the W8 stamp, only the W7 additive keys (`state_budget_tokens`, `bypass_projects = []`) and the bracket and wording fixes (ADR-2090, ADR-2139); the four diagram routes and host patterns this record decides are unchanged. Read from the diff and checked against the merged tree's gates (cargo, jest, validator); the changes to this record's own surface are the ones its close-out above already records (and the status axes there stand), and nothing else it changes touches what it decides. Re-run: `git diff 1e41b64b6..2f15c531b -- agentbox.toml schema/agentbox.toml.schema.json services/agentbox-manifest/src/routing.rs`.

## Re-verification — 2026-11-01 (`cc949bb79`)

Governed-path delta since `2f15c531b` is the RuVector Postgres credential custody change (ADR-2164 amendment 2), nothing else:

- `agentbox.toml`: the two `conninfo` URLs drop the `@@RUVECTOR_PG_PASSWORD@@` placeholder password, with their comments.

Nothing this record decides is changed; its status axes are unchanged. Re-run: `git diff 2f15c531b..cc949bb79 -- agentbox.toml`.
