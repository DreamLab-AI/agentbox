---
id: ADR-2129
title: Agent ontology grounding treats corpus silence as unknown, and every grounded answer cites the ontology generation it read
date: 2026-10-05
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: cca7ea3b151be3ea44907581d40271c714b07dd0
verified_paths: [skills/ontology-augment/scripts/ontology-augment.sh, skills/ontology-augment/SKILL.md, skills/ontology-augment/references/REFERENCE.md, skills/ontology-augment/references/EXAMPLES.md, tests/skills/ontology-augment-grounding.test.sh]
owner: jjohare
review_trigger: VisionClaw ADR-2128 (versionIRI) or ADR-2127 (tri-valued answers) landing; an agent decision traced to an empty Loom or vault result; the ontology-augment skill's output format changing
repo: agentbox
domain: GOVERNANCE-capabilities
---

# ADR-2129 — Ontology grounding treats silence as unknown and cites its generation

## Context

Agents ground through `ontology-augment`: the `vault` CLI plus Loom `/loom/sparql` and `/mcp` (ADR-2107; `skills/ontology-augment/SKILL.md:95-98`). The skill already marks a *degraded* empty result when the Loom is unreachable (`SKILL.md:58-60,126`), but says nothing about an empty result from a healthy Loom. That case is the open-world one: the corpus does not say, which is not "no" (VisionClaw ADR-2127; PRD-029 §4). The Loom already sends its serving identity in `x-loom-generation` and `x-loom-content-digest` headers and `/health` `generation.id` (`skills/ontology-augment/references/REFERENCE.md:84-90`). The reference only asks agents to quote them "when a result matters". The skill's output does not carry them, and the `vault` CLI path carries nothing, so most grounded claims cannot be reproduced later.

## Decision

1. **Three empties, three labels.** Skill output distinguishes `degraded` (Loom unreachable, already shipped), `silent` (healthy query, no asserted or inferred fact) and, once VisionClaw ADR-2125 makes it reachable, `contradicted` (entailed false). An agent may act on `contradicted`; it must not treat `silent` as negative evidence.
2. **SPARQL negation is flagged.** `FILTER NOT EXISTS` / `MINUS` over the corpus answers "not asserted at this generation", and the skill's examples and output say so.
3. **Every grounded answer cites its generation, automatically.** Skill output always carries the generation: the Loom headers for Loom calls, the local `.generation.json` id for `vault` calls, and the `owl:versionIRI` once host ADR-2128 lands. Quoting is not left to the agent's judgement.
4. **Writes are unchanged.** Grounding stays read-pervasive and write-governed (`SKILL.md:157-165`); a `silent` result is a reason to propose, never to assert.

## Consequences

- Agents stop converting corpus gaps into confident negatives — the failure mode the Loom's fail-open design otherwise invites.
- Dream-cycle and journal entries that cite grounding become reproducible.
- It is a skill-output format change; any parser of `ontology-augment.sh` output moves with it.

## Verification

Not implemented. Evidence of the current state at agentbox `97c1f90b7`: `SKILL.md:58-60,126` cover only the degraded case; `references/REFERENCE.md:84-90` leaves quoting the Loom generation to the agent; the `vault` path has no generation in its output. Complete when a skill test shows a healthy empty query returning `silent` with a generation id, distinct from the degraded case.

Implemented 2026-10-05 (PRD-029 wave; `verified_commit` set on commit). Every `ontology-augment.sh` subcommand prints one envelope (`grounding`, `degraded`, `source`, `generation`, optional `negation`/`fallback`, `note`, `result`). `generation` is filled from the Loom headers or the local `.generation.json`, plus `owl:versionIRI` when carried. `contradicted` appears only when the body carries `entailed_false`. Two defects found on the way and fixed: `ask` read `.results` from `vault find`, which returns a bare array, so it never seeded; and `vault` calls had no `--repo`, so they failed outside the corpus directory.

- `bash tests/skills/ontology-augment-grounding.test.sh` against the pre-change script (`git show HEAD:…/ontology-augment.sh`): RED, 12 passed, 29 failed. An earlier 33-case run against it: 10 passed, 23 failed.
- The same test after the change: GREEN, `41 passed, 0 failed`. This covers: a healthy empty query is `silent` with `generation.id` from `x-loom-generation`. An unreachable Loom is `degraded` with exit 0 and no generation. A 200 degraded body is `degraded`. `entailed_false` gives `contradicted`, and nothing else does. `FILTER NOT EXISTS` and `MINUS` are labelled "not asserted at this generation". `x-loom-version-iri` is carried. `vault find []` is `silent` with the `.generation.json` id and the versionIRI from `ontology_digest`. `--repo` comes from `[vault].repo`. `ask` gives silent with no seed and answered with one. `validate` keeps exit 1. A missing marker gives a null id with a reason. ASK false/true gives silent/answered. Neighbours falls back to vault, enveloped. Paths is degraded. Health covers both states. Stub Loom and stub vault only; the real Loom is never called.
- `bash skills/lint-skills.sh`: `OK — skills estate clean (127 skills…)`. The only ontology-augment warning is the pre-existing description length.
- Smoke against the real corpus (Loom pointed at a closed port): `search "knowledge graph"` gives answered, generation `visionGraph@ae913f93…` from `site-data/.generation.json`. `search zzqqxxnothing` gives silent. `ask "knowledge graph"` gives answered with 5 seeds and 12 expanded.

- Review fixes (2026-10-05): `contradicted` was unreachable. A new `check` subcommand POSTs `{subject, class}` or `{subject, property, object}` to VisionClaw `/api/ontology-agent/check` (base from `VISIONCLAW_API_URL`, else `[skills.ontology].visionclaw_api_url`). It maps entailed→answered, entailed_false→contradicted, not_asserted→silent, and unreachable, non-200 or no verdict→degraded, failing open. The `emit` count also changed: MCP `tools/call` content items are counted (text parsed as JSON, so `"[]"` is 0; `isError` is degraded), and a `vault tree` node counts its `children` (vault omits an empty list). A shape it cannot count is now `silent` with `shape: "unrecognised"`, never `answered`. Only a positive count is answered. `ontology-augment-grounding.test.sh`: RED 45 passed / 21 failed before the fix, GREEN 66 passed / 0 failed after it. `skills/lint-skills.sh` is clean.

## Re-verification — 2026-10-07 at cca7ea3b151be3ea44907581d40271c714b07dd0

Two commits since `a449138f2` touch the governed paths, both on the `check` door. `18f39abe5` makes `vc_post` unwrap VisionClaw's `ok_json!` envelope (`{success, data, error, timestamp}`) once, so the verdict is read from `.data.check` (`skills/ontology-augment/scripts/ontology-augment.sh:333-336`). Before that, every live `check` reply fell through to `degraded`/`visionclaw_no_verdict`. `2f0cee94c` keeps a 400 (unknown or ambiguous class term) as `degraded`, `reason: visionclaw_http_400`, exit 0, and now carries the server's `message` (`:338-343`). `references/REFERENCE.md:229-246` documents the envelope and adds the 400 row. The verdict mapping is unchanged: entailed→answered, entailed_false→contradicted, not_asserted→silent. The envelope and generation citation are unchanged too. `SKILL.md` and `EXAMPLES.md` are untouched. `bash tests/skills/ontology-augment-grounding.test.sh` gives `69 passed, 0 failed` (66 plus an unwrapped-body case and two 400 cases). Decision 4's citation of the write-governance section had already moved to `SKILL.md:157-165` when `a449138f2` rewrote the skill. The decision holds.
