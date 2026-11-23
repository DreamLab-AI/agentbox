---
id: ADR-2217
title: Decision records may name the tests that guard them
date: 2026-11-23
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 4de8ef8a53760a87b853f38f0606ddd9b192890e
verified_paths: [scripts/adr-index-gen.js, tests/config/adr-guard.test.mjs, .github/workflows/adr-checker.yml]
owner: jjohare
review_trigger: a proposal to require guard for some status, to run guarded tests from the checker, to show guards in the generated index, or to support globs or names containing ',' or ']'
repo: agentbox
evidence_class: source+test
acceptance_boundary: The checker resolves guard entries statically and tests/config/adr-guard.test.mjs passes 25 cases; the old and new checkers give identical output on agentbox, VisionClaw, visionGraph, knowledgeGraph, ontomark-obsidian and ontomark. It does not establish that a guarded test passes, or that it tests what the record claims; that stays a review matter. Staged: live in this repo's CI once merged, and in each pinned consumer once its pin moves.
guard: [tests/config/adr-guard.test.mjs]
---

# ADR-2217 — Decision records may name the tests that guard them

## Context
A record says how its status was verified, but not which tests keep it true afterwards. `verified_paths` arms staleness on source; nothing ties a record to its tests, so a deleted or renamed test leaves the record silently unguarded. OpenMetadata's decision records carry a `Guard:` header line listing the test classes that enforce each decision ([example](https://github.com/open-metadata/OpenMetadata/blob/main/docs/decisions/2026-10-13-a-memory-conflict-opens-a-review-task-and-approving-it-supersedes-the-disputed-memory.md)). The schema and checker belong to ADR-2001 (typed frontmatter, `scripts/adr-index-gen.js`); `evidence_class` came from VisionFlow ADR-2007. No ledger in the estate used a `guard` key before this record (searched 2026-11-23: agentbox, VisionClaw, visionGraph, knowledgeGraph, ontomark, ontomark-obsidian, nostr-rust-forum, VisionFlow, dreamlab-ai-website, vellum-markdown-editor, dream-engine).

## Decision
Amends ADR-2001's frontmatter schema with one optional field:

- `guard: [path, path#name]`, an inline list. `path` is one file relative to the repository root, resolved against the git toplevel exactly as `verified_paths` are, and read from the working tree. `#name` (optional) is a test function, class or describe identifier that must occur verbatim in that file.
- The checker fails only when a guard is present and malformed (not a list, an empty entry or name, a glob character, an absolute path, a `..` segment, more than one `#`), when its file is missing or is not a file, or when its name does not occur in the file. `guard: []` is valid. The template skeleton is exempt.
- Static only: the checker never runs a test, because hosted CI cannot build most guarded repositories.
- No status requires a guard. Requiring one would turn every ledger red and is a separate decision.
- The generated index does not show guards, so every consumer's README stays byte-identical on its next regeneration.
- Without git the existence checks are skipped with a warning, as the staleness checks are; shape errors are still reported.
- The frontmatter parser splits inline lists on `,` and strips ` #...` as a comment when whitespace precedes `#`, so a name cannot contain `,` or `]`, and there must be no space before `#`.

## Consequences
- A record can point at its enforcement, and a test file that is deleted or renamed, or an identifier that is renamed, fails the ledger gate rather than leaving the record quietly unguarded.
- Presence is not passing: a guard proves a named test exists, not that it passes or that it tests the claim.
- Changing the checker changes its sha256, so pinned consumers (visionGraph, knowledgeGraph, ontomark-obsidian, ontomark) adopt guard by bumping `ADR_CHECKER_SHA` and `ADR_CHECKER_SHA256` in `scripts/adr-ledger.sh`. Vendored copies (VisionClaw, VisionFlow, nostr-rust-forum, dreamlab-ai-website) ignore the key, as they ignore any unknown key, until they are re-synced.
- Existing records are not backfilled.

## Verification
At verified_commit `4de8ef8a5`:
- `node tests/config/adr-guard.test.mjs` reports 25 passed, 0 failed. It covers a valid guard (path, describe/it name, class name), an absent guard, an empty guard, an accepted/complete/live record with no guard, a missing file, a path relative to the ADR directory rather than the root, a directory, a missing name, eight malformed shapes, shape errors without git, the no-git skip, and the template exemption.
- `node tests/config/adr-ledger-config.test.mjs` reports 23 passed, and `node tests/config/adr-index-check.test.mjs` reports 20 passed.
- `node scripts/adr-index-gen.js docs/adr --check` passes (171 records) with no STALE record, so no existing record names the checker in `verified_paths`.
- The pre-change checker (`8bd4314d1`, the consumers' pin, and agentbox `main` before this change) and the new one were run over agentbox, VisionClaw, visionGraph, knowledgeGraph, ontomark-obsidian and ontomark `docs/adr`. Their outputs were compared, and the new checker introduced no new error in any ledger.
- This record names its own test in `guard`, so the gate resolves at least one real guard on every run.
