---
id: ADR-2021
title: Skills are JIT context — no monolith SKILL.md, depth relocated to references/, enforced by lint before rebuild
date: 2026-08-31
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: any change to the banned-string set or path conventions, or the monolith line threshold
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: legacy skills-upgrade-plan-c5 (2026-08-21 audit follow-up); no legacy ADR — the discipline lives in the lint gate + CLAUDE.md
---

# ADR-2021 — Skills are JIT context — no monolith SKILL.md, depth relocated to references/, enforced by lint before rebuild

## Context

Skills self-trigger from their description frontmatter and are baked at
`/opt/agentbox/skills`. A `SKILL.md` that carries all its depth inline bloats the
context window on every trigger; and stale strings (retired hosts, dead SDKs,
old runtime paths) quietly rot the estate. The 2026-08-21 audit
(skills-upgrade-plan-c5) turned these into a mechanical gate rather than a
convention nobody enforces. There is no legacy ADR — the rule lives in the lint
script and CLAUDE.md.

## Decision

Skills keep depth in `references/` subdirs and self-trigger from description
frontmatter. `skills/lint-skills.sh` is a **pre-rebuild gate**: a `SKILL.md`
over 250 lines with no `references/` dir is a MONOLITH failure; a banned stale
string (retired `.48` host, dead SDKs, wrong embeddings), an absolute
`~/.claude/skills` path, or the retired literal `/workspace` path are each hard
failures; frontmatter must open with `---` and carry `name:`/`description:`. The
lint must pass before an image rebuild bakes the skills. This is **advisory
estate-hygiene, not a runtime capability gate** — it shapes what gets baked, it
does not sandbox execution.

## Consequences

- The lint catches selected drift patterns. Its references-directory exception does not bound entry-file length, and its text searches do not validate frontmatter membership.
- Adding real inline depth forces a `references/` split, which is extra
  structure for genuinely large skills.
- Honest caveat: the gate runs at author/build time only; nothing re-checks a
  baked skill at runtime, and the suppress list (`DEAD|retired|legacy|…`) can be
  used to knowingly wave a string through.

## Verification

At `cbe7335b9`, `skills/lint-skills.sh`: banned-string set including the dead
`a retired address` host (:8), absolute-path ban (:15-17), retired `/workspace` ban
(:20-22), monolith >250-line/no-`references/` check (:25-31), frontmatter sanity
(:33-38). Skills are baked at `/opt/agentbox/skills`. Line numbers drifted from
the source record but every construct is present and live.

## Closeout extension — 2026-09-04

CP-01/07/08. Owner remains jjohare with capability/runtime maintainers. Actual isolated lint fixtures accept a 304-line entry with an empty references directory and an empty frontmatter block whose name/description appear only in the body. The no-references long entry correctly fails.

Implementation status changes to partial for the broader guarantee; existing conventions and manifest policy remain accepted. **Acceptance condition:** Parse the actual frontmatter, enforce a deliberate entry-context budget and validate referenced resources. Test supported build entry points and bind the lint result to the baked revision. Preserve documented suppressions without treating them as semantic validation. Reopen on lint, registry, build, routing or executor changes. See the [capability review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/capability-instructions-and-enforcement.md) and [source/fixture receipt](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/skill-lint-probes.json). No provider, model orchestration or image rebuild ran.

## Acceptance progress — 2026-09-05

- **Implemented**
  - `skills/lint-skills.sh` stays the stable CI entry point (`.github/workflows/invariants.yml:68`) and now execs `skills/lint-skills.mjs` — the frontmatter contract needs a real YAML parse, not line greps.
  - **Real frontmatter parse.** `---` must open line 1, the block must close with a `---`/`...` line, and `name`/`description` must be top-level keys *inside* that block carrying non-empty scalars. Quoted values, block scalars (`|`/`>` with chomping), comments and nested mappings are understood; empty, sequence-only and unclosed blocks fail; fields appearing only in the body fail. Closes reproducer case `fields_outside_frontmatter`.
  - **Named entry-context budget.** `MAX_ENTRY_LINES = 250`, read out of the previous script's `-gt 250` threshold and unchanged. Progressive disclosure is satisfied only when `references/` exists **and** holds at least one readable file, so an empty `references/` no longer buys an over-budget entry. Closes reproducer case `long_empty_references`.
  - **Resource validation.** Every relative `references/`, `scripts/`, `assets/` path cited by a `SKILL.md` — markdown links, inline backtick paths, and bare paths on their own line, outside fenced blocks — must resolve; a miss fails with skill, line and path.
  - **Suppressions preserved, not conflated with validation.** The documented `lint-ok` line marker (plus the historical STALE prose-context words) still waves a line through, but suppressed hits are printed under a separate `-- suppressed --` heading and counted in the summary; a suppression cannot wave through a FRONTMATTER defect.
- **Tests and results**
  - `bash tests/config/skill-lint.test.sh` → **19 passed, 0 failed**, covering valid skill; empty-frontmatter-with-body-fields (FAIL); over-budget with empty `references/` (FAIL); over-budget with populated `references/` (PASS); over-budget with no `references/` (FAIL); missing referenced resource in all three cited forms (FAIL); no frontmatter (FAIL); unclosed frontmatter (FAIL); `name` present with empty `description` (FAIL); non-scalar `description` (FAIL); comment-only `description` (FAIL); sequence-only frontmatter (FAIL); quoted name + folded description (PASS); suppression accounting; suppression cannot fake frontmatter validity; banned stale string regression.
  - `bash skills/lint-skills.sh` against the real tree → exit 0, `OK — skills estate clean (125 skills, MAX_ENTRY_LINES=250, 40 suppressed)`. Zero frontmatter and zero budget violations estate-wide. Three genuine resource violations were found and fixed at source: `ruvnet-brain` cited a repo-root script with a skill-relative path (now `agentbox/scripts/…`), `mermaid-diagrams` cited a sibling skill's reference as its own (now `diagram-design/references/import-mermaid.md`), and `explainer`'s `scripts/kb/` is a deliberate day-2 forward reference recorded through the `lint-ok` suppression with a comment. No rule was weakened to make the tree pass.
- **Receipts** — `docs/estate-closeout/2026-09-05/adr-2021-skill-lint.json`
- **Remaining** — the gate still runs at author/CI time only; nothing re-checks a baked skill at runtime, and binding the lint result to the baked image revision (and proving every supported build entry point invokes it) is untouched. Nested `<skill>/**/SKILL.md` entries outside the top level are still out of scope, as before.
- **Governed paths changed** — `skills/lint-skills.sh`, `skills/lint-skills.mjs` (new), `tests/config/skill-lint.test.sh` (new), `skills/ruvnet-brain/SKILL.md`, `skills/mermaid-diagrams/SKILL.md`, `skills/explainer/SKILL.md`, `docs/estate-closeout/2026-09-05/adr-2021-skill-lint.json` (new).
