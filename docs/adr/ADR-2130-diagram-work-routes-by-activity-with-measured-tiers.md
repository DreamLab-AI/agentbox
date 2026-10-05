---
id: ADR-2130
title: Diagram skills route by four model_routing activities on loom and zai hosts, with tiers set by measured descent and seal review always cross-family
date: 2026-10-05
decision_status: accepted
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: 66f975561c95cef63f080153ac29fc9dbfe576bd
verified_paths: [services/agentbox-manifest/src/routing.rs, skills/sealmap]
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
- **Nothing is live yet.** The four routes, the `loom`/`zai` hosts in `route_re`, explicit `host_provider` arms for both, and the `.tiers.json` reader are implemented together with the `sealmap` skill (sealmap DESIGN §10 step 5). Until then, an `agentbox.toml` route that names `loom` or `zai` is rejected by the parser. This record changes no manifest, flake or code.
- Neither new host maps to the agentic-qe subscription tier. `loom` is the nearest constructible type to `openai` (an OpenAI-compatible base URL). `zai` has no constructible type, so the QE-fleet projection must skip it rather than mislabel it as `codex`.
- `seal-review` on `zai` sends topic content to a cloud provider. This decision does not yet name a LAN-only reviewer from another family, so a corpus that must not leave the estate has no conforming seal reviewer. That is an open item, not a licence to review it with the same family.
- What this forecloses: a skill choosing a model by id, a same-family seal review, and lowering a tier without a held-out measurement.
- Revisit if ADR-2079's router absorbs `[model_routing.routes]`; if GLM leaves Z.AI or `[consultants.zai].model` changes family (`seal-review` then needs another non-Claude family); or if the grammar gains more than one rung.
- **Rejected:** naming model ids in skills, because every swap then edits every skill; same-family review, because it is cheaper but blind to that family's own mistakes; and choosing tiers by assumption, because DESIGN §6 makes tiers an output of measurement.

## Verification

`implementation_status: none`. Checked at `66f975561` by reading committed code: `routing.rs:82-87`'s regex admits only `claude|codex`; `routing.rs:68-73` maps every other host to `codex`; the test `an_unknown_host_is_rejected` (`routing.rs:412`) holds; and no `skills/sealmap/` directory exists. The `[model_routing.routes]`, `[providers.zai]`, `[consultants.zai]` and `[[interaction_plane.session_seeds]] slug = "loom"` keys were read in `agentbox.toml`. **Acceptance for `complete`:** the four routes parse; `host_provider` has explicit `loom` and `zai` arms; and the sealmap skill refuses a same-family seal review in a test.
