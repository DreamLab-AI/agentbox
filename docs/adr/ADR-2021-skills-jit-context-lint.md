---
id: ADR-2021
title: Skills are JIT context — no monolith SKILL.md, depth relocated to references/, enforced by lint before rebuild
date: 2026-08-31
decision_status: accepted
implementation_status: complete
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

- The context cost of triggering a skill stays bounded, and estate drift is
  caught mechanically instead of by review.
- Adding real inline depth forces a `references/` split, which is extra
  structure for genuinely large skills.
- Honest caveat: the gate runs at author/build time only; nothing re-checks a
  baked skill at runtime, and the suppress list (`DEAD|retired|legacy|…`) can be
  used to knowingly wave a string through.

## Verification

At `cbe7335b9`, `skills/lint-skills.sh`: banned-string set including the dead
`192.168.2.48` host (:8), absolute-path ban (:15-17), retired `/workspace` ban
(:20-22), monolith >250-line/no-`references/` check (:25-31), frontmatter sanity
(:33-38). Skills are baked at `/opt/agentbox/skills`. Line numbers drifted from
the source record but every construct is present and live.
