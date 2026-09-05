---
id: ADR-2058
title: Re-verify rather than re-point ADRs made stale by the uncommitted remediation tree
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: the Phase 2 remediation landing as a commit — at which point ADR-2019, ADR-2023 and ADR-2030 must have verified_commit and verified_paths restored
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2019, ADR-2023, ADR-2030 (the three records re-verified under this decision)
---

# ADR-2058 — Re-verify rather than re-point ADRs made stale by the uncommitted remediation tree

## Context

`scripts/adr-index-gen.js` refuses to generate the ADR index while any ADR is STALE: a
non-empty `verified_paths` whose files changed since that ADR's `verified_commit`. Three
records in this lane's domains were STALE in the Phase 2 tree — ADR-2019 and ADR-2023
(`agentbox.toml` edited) and ADR-2030 (`services/` edited extensively, including the
removal of two crates). None of the changes came from this lane's remediation; they are
the repo owner's pre-existing uncommitted edits. The staleness is real and the validator
is right, but it blocked index generation for **every** lane.

A second trap sits underneath: `agentbox` is a submodule, so its HEAD
(`89301ec7c911eab270c00a0cf81596d0d4f15535`) is **not** the parent repository's HEAD.
An agentbox ADR anchored to the parent SHA is anchored to a commit absent from its own
history.

## Decision

A stale record is **re-verified**, not re-pointed. For each: re-check every claim against
the current tree, correct any that drifted, set `verified_commit` to the submodule's full
HEAD SHA, set `verified_paths: []`, and append a
`### Re-verification 2026-09-05 (ADR-20xx)` section that states verification ran on the
uncommitted tree above that SHA, lists each re-checked claim with its current line, and
records the prior `verified_paths` verbatim so restoring it at the landing commit is a
copy-paste rather than archaeology.

Silently bumping `verified_commit` without re-checking the claims is forbidden: it
asserts a verification that never happened and re-arms staleness checking against a
baseline nobody looked at. Clearing the anchor *without* re-verifying — this ADR's own
first attempt — is also rejected: it unblocks the index but leaves the record's claims
unexamined, which is exactly the drift the Phase 1 audit existed to find.

Every agentbox ADR anchors to the agentbox submodule's SHA, never the parent's.

## Consequences

- The ADR index generates again, unblocking every lane.
- Three records now carry re-verified claims, and the exercise found real drift that a
  bare SHA bump would have hidden — see Verification.
- Staleness checking is off for those three until the landing commit restores
  `verified_paths`; each names its prior list verbatim, and this ADR's `review_trigger`
  is the landing commit, so the debt is tracked.
- Cost: re-verification is slower than clearing. That is the point — the check exists to
  force exactly this reading.

## Verification

Verification ran on the **uncommitted working tree** above
`89301ec7c911eab270c00a0cf81596d0d4f15535` and must be re-run at the landing commit;
`verified_paths` is therefore empty.

- Submodule/parent SHA divergence confirmed: `git -C agentbox rev-parse HEAD` →
  `89301ec7c911eab270c00a0cf81596d0d4f15535`; `git rev-parse HEAD` (parent) →
  `b00c28a0d766c8cf46cd00b100dab60ef2dd74a4`. Existing agentbox records (ADR-2022,
  ADR-2024) use the submodule SHA, confirming it as the correct anchor. **This lane's
  eight new records (ADR-2051…ADR-2058) were initially written against the parent SHA and
  have been corrected**, in frontmatter and in body text.
- Staleness confirmed **not** to originate in this lane: this lane's changed files are
  `mcp/servers/ontology-local.cjs`, `skills/lint-skills.mjs`, `skills/codeact/SKILL.md`,
  `skills/tree-search-coder/SKILL.md`, `tests/fixtures/skill-router-prompts.json`, two
  files under `tests/integration/`, `docs/LEARNING-memory.md`,
  `docs/GOVERNANCE-capabilities.md` and `docs/adr/ADR-205*.md` — none of which appear in
  any stale path list.
- **Drift found by re-verifying, which a SHA bump would have hidden:**
  ADR-2023 claimed `loom_max_tokens = 16384`; the live value is **32768**. ADR-2030's
  scope included `services/diagram-ir/` and `services/prose-sanitiser/`, both now absent
  from HEAD and the working tree (`git ls-tree --name-only HEAD services/` lists eight
  crates plus `LICENSING-NOTICE.md`, neither among them). ADR-2019's claims were all
  still accurate.
- `node scripts/adr-index-gen.js docs/adr --check` → exit **0**; the generating run →
  `ok: 46 ADR(s) valid; wrote docs/adr/README.md`.

## Integration amendment — 2026-09-05

Applied at mesh integration: the re-verified records keep their governed
`verified_paths` populated instead of clearing them, with `verified_commit` at the
submodule HEAD and the dated re-verification section as the working-tree evidence.
The index regenerates today because no commit exists after HEAD; at the landing
commit the validator will report those records STALE, and the landing change must
move `verified_commit` to that commit. That loud failure is the reminder this record
wanted, and it removes the restore-from-notes step. This applies to ADR-2019, ADR-2023
and ADR-2030 in this repository and to the four VisionClaw records handled the same
way (ADR-2004, 2005, 2008, 2027).
