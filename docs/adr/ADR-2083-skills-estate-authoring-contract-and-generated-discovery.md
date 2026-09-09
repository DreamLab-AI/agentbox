---
id: ADR-2083
title: Skills carry one authoring contract, discovery is generated, and both harnesses register from manifests
date: 2026-09-09
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 57a92a402372ef125d43920d6ddbe3d100e498c9
verified_paths: []
owner: jjohare
review_trigger: a skill being added, merged or renamed; a change to lint-skills.mjs, gen-routing-table.mjs, either registration manifest, or the reconcile step in the entrypoint; the next image rebuild (activation)
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2021 (skills are JIT context, lint gate), ADR-2056 (directory facts checkable), ADR-2069 (uncatalogued gate fails the build)
---

# ADR-2083 — Skills carry one authoring contract, discovery is generated, and both harnesses register from manifests

## Context

A 2026-09-09 re-audit of the 128-skill master copy (Fable 5.1 queen, 13 Sonnet auditors,
12 fixers) for Fable 5.1 and GPT-6 Astra workloads found the drift was systemic, not local:
the authoring meta-skill taught Title-Case names, root-level reference files and
`~/.claude/skills` placement, contradicting the lint, ADR-2021 and the agentskills.io
standard both harnesses consume; the router's table claimed to be generated, had no
generator and omitted 38 skills; the skill-count gate was red and not in CI; Codex saw two
hand-made symlinks and no manifest; three skills re-answered one brief in a week; and
verified rot (dead CLI commands, a wrong sidecar port copied from the "canonical" block,
fabricated endpoints, missing-binary silence) sat behind a green lint.

## Decision

1. **One authoring contract**, taught by `skill-builder` and enforced by `lint-skills.mjs`:
   `name` equals the directory (lowercase-hyphen, ≤ 64); `description` ≤ 1024 chars stating
   what, when and when-not; depth in `references/` one level down; the portable frontmatter
   core is agentskills.io's (name, description, license, compatibility, metadata,
   allowed-tools), Claude Code's documented extras are allowed, estate conventions are
   allow-listed and warned on otherwise; a redirect stub carries `deprecated: true` and
   `replacement:`; a skill that needs a Claude-only affordance says so in one line with the
   Codex fallback.
2. **Discovery is generated from frontmatter.** `skills/gen-routing-table.mjs` +
   `skill-router/references/section-map.json` produce `routing-table.md`; the lint fails when
   the table is stale, a skill is absent from the section map or from `SKILL-DIRECTORY.md`,
   or a manifest names a missing or deprecated skill. `scripts/skill-count-check.js` and the
   routing check run in `invariants.yml`.
3. **Both harnesses register from manifests reconciled at boot from the baked tree**:
   `registered-skills.txt` → `~/.claude/skills` (18 skills) and `codex-registered-skills.txt`
   → `~/.codex/skills` (17 skills, sized for Codex's 8,000-character index cap), through the
   same `reconcile-skills.sh`; `~/.codex/AGENTS.md` points GPT-6 Astra at the directory and
   the routing table for the rest. Always-loaded slots are for high-frequency, low-ambiguity
   skills; manifest-disabled or not-installed skills are never registered.
4. **Aligned skills merge; differentiated clusters cross-link.** `repo-education` → `explainer`
   (hub + docs/microsite/video delivery references; direct HP-model path demoted behind the
   Loom façade), `latex-book` → `book-publishing`, toprank's GEO technique → `bencium-aeo`.
   Browser, research, methodology, GitHub, ontology, podcast, thinking-lens and agentdb
   clusters stay separate with reciprocal when-not-to-use links.

## Consequences

- A new skill needs a directory-matching name, a section-map entry, a directory row and a
  passing lint before it bakes; a merged skill leaves a stub for one bake cycle.
- Descriptions are now a measured budget (Claude listing truncation at 1,536 chars for
  description + when_to_use; Codex 8,000-char index), so registration is a deliberate cost.
- Harness-specific behaviour lives in one-line fallbacks or companion files, never in shared
  frontmatter.
- Follow-ups outside this change: retire the `openai-codex/mcp-server` Nix closure
  (superseded by `consultant-codex`); gate linkedin/reddit/notebooklm servers in
  `agentbox.toml`; port TTL export into `ontology-tools`; run a held-out description-trigger
  eval (skill-creator workflow) before and after the next description pass.

## Verification

Master copy only; activation is the next image rebuild. At the landing commit:
`bash skills/lint-skills.sh` → OK (extended checks); `bash tests/config/skill-lint.test.sh`
→ all pass; `node scripts/skill-count-check.js` → ok; `node skills/gen-routing-table.mjs
--check` → current; `bash -n config/entrypoint-unified.sh` → clean. Audit evidence: `docs/archive/skills-audit-2026-09-09/` (fact sheet, fixer brief, per-batch
`findings/*.json` with file:line per finding, cited standards brief); summary in `CHANGELOG.md` (2026-09-09).
