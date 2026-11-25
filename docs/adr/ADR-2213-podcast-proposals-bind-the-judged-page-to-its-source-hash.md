---
id: ADR-2213
title: Podcast promotion proposes the exact judged page only against its source hash
date: 2026-11-22
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 8482214befe8ee2f40cd35e422ac43c78e392a7c
verified_paths: [services/podcast-ingest/src/promote, skills/podcast-knowledge-ingest/submit-proposals.mjs, skills/podcast-knowledge-ingest/run-promote.sh, skills/podcast-knowledge-ingest/tests/submit-proposals.test.mjs]
owner: operator
review_trigger: dossier freshness, page splicing, working-note ownership or proposal transport changes
repo: agentbox
domain: BASELINE-container
evidence_class: source+test
acceptance_boundary: Offline Rust tests 182 passed and JavaScript proposal tests 11 passed. Source is committed; production image activation, model-quality evaluation, corpus repair and live governance proposals are not claimed.
---

# ADR-2213 — Podcast proposals carry the exact judged page and source hash

## Decision

A terminal dossier is current only while both its evidence fingerprints and
target-page SHA-256 match. Store the judged whole `proposed_page` and the
`target_page_sha256` in its proposal payload. The submitter checks the live
page hash and hands that stored page to `vault propose --level content --diff`.
It does not implement another splice algorithm or directly edit the curated
vault. A stale/legacy dossier is reported without banking a permanent blocker;
the next promotion run can redraft it. Governance still requires approval.

Draft only against the body, retaining valid LF/CRLF frontmatter byte for byte.
A section inserted after a heading goes after that section, not between its
heading and body. Private rejected-candidate working notes use `type: Note`,
`public: false`, provenance and normal Markdown instead of invalid legacy
properties. Retain existing non-stage notes; refuse symlinked/unreadable pages.
An explicit `--refresh-working-pages` rewrites derived reject notes without a
model call; builds never execute that operation. The scheduled wrapper refuses
an old binary lacking the format-change flag instead of re-breaking notes.

## Limits

The hash comparison is a freshness check, not an atomic lock through later
governance approval/application. Normal proposal conflict handling remains
necessary. Working-note marker ownership is not a cross-process write lock.
No new corpus path authority, listener, durable adapter or model policy is
introduced. Tests use fixtures/tempdirs; no live Loom/Gemini call, proposal,
working-vault refresh or corpus migration was run during preparation.

## Amendment — 2026-11-25
Working-note format is now chosen by the target vault's vocabulary version, and a refresh keeps a person's edits: see ADR-2222. Where this record says private notes use `type: Note` and `public: false`, that is the vocabulary-2 shape; vocabulary 3 writes a `Brief`. The scheduled wrapper also refuses a binary without `--adopt-unmarked-pages`. Re-verified at the pinned commit with `cargo test --offline -- --include-ignored` (224 passed).
