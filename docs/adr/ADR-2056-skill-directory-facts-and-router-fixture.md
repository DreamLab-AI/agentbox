---
id: ADR-2056
title: Make the skills directory facts checkable and give the router fixture a consumer
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: a skill being added, removed or renamed, or a new routing target entering tests/fixtures/skill-router-prompts.json
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2021 (skills JIT context lint), legacy ADR-037 D8 (skill-count-check as the single count authority)
---

# ADR-2056 — Make the skills directory facts checkable and give the router fixture a consumer

## Context

Three findings about the skills estate, all of the same shape — a fact about the estate
recorded in prose with nothing checking it:

1. `tests/fixtures/skill-router-prompts.json` (10 `{prompt, expected_skill, rationale}`
   entries) had **zero code consumers**, verified by grepping `scripts/` and `tests/`.
   Dead test data that silently rots.
2. Wiring a consumer immediately found real rot: five entries named
   `expected_skill: "sparc-code"`, a skill that has never existed as a directory. The
   canonical estate spelling is the colon form `sparc:code`, used throughout
   `skills/SKILL-DIRECTORY.md`. The hyphen form survives only in YAML `related_skills:`
   frontmatter, where an unquoted colon would be invalid YAML.
3. Directory facts drifted: `CLAUDE.md` says the image bakes "118 skills";
   `docs/GOVERNANCE-capabilities.md` says `SKILL-DIRECTORY.md` is "912 lines". The real
   figures are 126 skill directories (which `SKILL-DIRECTORY.md` and
   `scripts/skill-count-check.js` already agree on) and 915 lines.

4. Chasing (3) exposed a fourth: `skills/lint-skills.mjs` listed `toprank` in
   `SKIP_DIRS`, which excluded a **real skill from all six lint checks** — not merely
   from the narrow absolute-path exemption it also carries in `ABSPATH_SKIP_DIRS`. The
   symptom was that the lint gate reported "125 skills" while `skill-count-check.js`
   reported 126, so the two authorities on the same number disagreed and neither
   flagged it.

Note for the record: a Phase 1 note in this lane reported "134 skills". That was a
miscount — `ls skills/` includes non-directory entries. `ls -d skills/*/` is 126, and
`scripts/skill-count-check.js` reports `ok: true` with no divergences.

## Decision

The router fixture has a consumer:
`tests/integration/skill-router-fixture.test.mjs` asserts what is deterministically
assertable about it. Routing itself is **not** asserted — skills self-trigger from their
`description` frontmatter, so there is no deterministic prompt→skill oracle, and a test
that pretended otherwise would be theatre. The test asserts instead: the fixture parses
as a non-empty array with an exact key set and non-empty string fields; prompts are
unique; and every `expected_skill` resolves.

Resolution is target-class aware, because the fixture legitimately names two kinds of
target. A bare name is a **local skill** and must have `skills/<name>/SKILL.md`. A name
containing `:` is a **namespaced plugin command**, which has no directory in this repo,
so its existence is checked against `SKILL-DIRECTORY.md` and it must *not* shadow a
skill directory. Both classes must appear in `SKILL-DIRECTORY.md`.

The canonical spelling of a namespaced command is the colon form. Frontmatter that must
carry one quotes it (`- "sparc:code"`) rather than hyphenating it.

`SKIP_DIRS` in `skills/lint-skills.mjs` holds only genuinely non-skill directories
(`node_modules`, `.git`). A skill is never excluded from the lint gate wholesale; where
one needs relief from a single check it goes in that check's own narrow exemption set
(`ABSPATH_SKIP_DIRS`) with a reason. A blanket skip silently drops five other checks and
desynchronises the gate's count from `skill-count-check.js`, which is how this went
unnoticed.

Prose facts about the estate are stated only where something checks them, or are stated
as approximations. The exact skill count lives in `SKILL-DIRECTORY.md` and
`README.md`, which `scripts/skill-count-check.js` already gates; other documents refer
to the directory rather than repeating a number they cannot keep current. Line counts of
a living document are not stated at all.

## Consequences

- A renamed or deleted skill now fails a test instead of rotting silently in a fixture —
  which is exactly what happened here and went unnoticed.
- The fixture is worth keeping rather than deleting: it encodes routing intent, and with
  a consumer it also pins the naming convention.
- `GOVERNANCE-capabilities` loses a line-count claim it could not keep true, and gains a
  pointer to the checker that owns the count.
- Follow-on, routed to the runtime lane: `CLAUDE.md`'s "118 skills" is stale and sits
  outside `skill-count-check.js`'s claim-matching scope (it scans `README.md` and
  `SKILL-DIRECTORY.md`). Either correct it to 126 or, better, extend the checker to
  cover `CLAUDE.md` so the number cannot drift again.

## Verification

Verification ran on the **uncommitted working tree** above
`89301ec7c911eab270c00a0cf81596d0d4f15535` and must be re-run at the landing commit;
`verified_paths` is therefore empty.

- `ls -d skills/*/ | wc -l` → **126**.
- `wc -l < skills/SKILL-DIRECTORY.md` → **915**; `SKILL-DIRECTORY.md` headline reads
  "**126 active skills**".
- `node scripts/skill-count-check.js` → `"divergences": []`, `"ok": true`, exit 0.
- `grep -rn 'skill-router-prompts' --include=*.js --include=*.mjs --include=*.cjs
  --include=*.sh --include=*.json .` (excluding `node_modules`) → no match before this
  change; the new test after it.
- Canonical-spelling evidence: `grep -rn 'sparc:code\|sparc-code' skills/` →
  `SKILL-DIRECTORY.md` uses the colon form at `:61`, `:622`, `:641` (and `sparc:coder`
  at `:64`, `:634`); the hyphen form appears only in `codeact/SKILL.md` frontmatter and
  its "When NOT to use" table, and in `tree-search-coder/SKILL.md` frontmatter.
- The `toprank` exclusion was proved unnecessary before removal: a probe copy of
  `lint-skills.mjs` with `toprank` dropped from `SKIP_DIRS` ran clean —
  `OK — skills estate clean (126 skills, MAX_ENTRY_LINES=250, 40 suppressed)`, exit 0 —
  so the skill passes all six checks and the blanket skip was suppressing nothing real.
- After the change: `./skills/lint-skills.sh` → `OK — skills estate clean (126 skills,
  MAX_ENTRY_LINES=250, 40 suppressed)`, exit 0. The gate and
  `scripts/skill-count-check.js` now both report **126**; before, they reported 125 and
  126 respectively.
- `node --test tests/integration/skill-router-fixture.test.mjs` → **4 tests, 4 pass,
  0 fail** (after the fixture's five `sparc-code` values were corrected to `sparc:code`).
- `node scripts/skill-count-check.js` → `"count": 126`, `"ok": true`, exit 0.
