---
name: verification-quality
description: "Verify an installed artifact against the signed witness manifest via `ruflo verify`, and read the real in-CI regression-guard stack (smoke tests, discoverability audit, cryptographic witness, temporal history). Use when you need to check that documented fixes are still present in the tree, or to understand what's actually enforced in CI vs. designed-but-unshipped. Not for per-file truth scoring, confidence thresholds, or auto-rollback — that surface is design only, see references/design-aspirational.md."
version: "2.0.0"
category: "quality-assurance"
tags: ["verification", "witness-manifest", "quality", "ci-cd"]
---

# Verification & Quality Assurance

> **Shipped vs. aspirational.** The *concrete, in-CI* verification stack — regression-guard
> jobs, the witness manifest, the tool-discoverability audit — is real and runs on every
> push in the upstream ruflo repo. A truth-scoring / auto-rollback / WebSocket-dashboard
> surface was drafted for this skill in an earlier version but never shipped: no `truth`
> or `verify check/batch/report/dashboard/watch` command exists in the installed ruflo
> v3.38.21 binary. `ruflo verify` (below) is the real, current command. Treat this section
> as the authoritative current state; the old draft is kept for reference in
> [references/design-aspirational.md](references/design-aspirational.md), dated and marked
> not current.

## When to use

- You want to verify that an installed artifact still matches its signed witness manifest
  (e.g. after a rebuild, or before trusting a claimed fix is present).
- You want to understand what ruflo's own CI actually enforces, to model a similar guard
  in this project.

## When not to use

- Full development pipelines with quality gates → **build-with-quality**.
- Swarm performance profiling / bottleneck detection → **performance-analysis**.
- GitHub PR code review with specialised agents → **github-code-review**.
- Test generation + coverage → TDD workflow in **sparc-methodology**.
- Simple linting/formatting → run the project's lint/format tools directly.
- Per-file truth/confidence scoring or automatic rollback on a threshold — this does not
  exist in the installed CLI; see [references/design-aspirational.md](references/design-aspirational.md)
  for the design if you are considering building it.

## Quick start

```bash
# Verify against the latest manifest from the default branch
claude-flow verify

# Verify against a specific branch
claude-flow verify --branch main

# Verify against a local manifest copy
claude-flow verify --manifest ./verification.md.json

# Machine-readable output for CI
claude-flow verify --json
```

`claude-flow verify` (`ruflo verify` — same binary, invoked via the `claude-flow`
alias baked on PATH) checks an installed artifact against a signed witness manifest:
for each documented fix it hashes the on-disk file and checks that a distinctive
marker substring is still present, so a regression that deletes the fix is caught
even if the file changed for other reasons. Flags: `-b/--branch` (defaults to the
manifest-issuing branch), `-m/--manifest` (use a local file instead of fetching),
`--json`.

## CI Guards — what's actually shipped upstream (current state)

Ruflo's own regression protection is three layers, all gated before publish
(source: ruflo repo `.agents/skills/verification-quality/SKILL.md`, pulled 2026-09-09):

| Layer | What | ADR |
|---|---|---|
| **1 — install/behavioral smoke** | Exercise user-visible failure modes against a real build (npm install without prebuilds, hook flag parsing, MCP wire format, memory import path/key sanitisation, paired-tool round-trips) | ADR-102 |
| **1 — discoverability gate** | Every MCP tool description must answer "use this over native when?" (monotone-decreasing baseline: no-guidance / too-short / duplicate counts) | ADR-112 |
| **2 — cryptographic witness** | Every documented fix's load-bearing marker must still be present in the built artifact; Ed25519-signed, per-OS bundles — this is what `ruflo verify` checks | ADR-103 |
| **3 — temporal history** | An append-only log answering "when was a regression introduced" | ADR-103 |

This project does not run that CI itself; it consumes the same `verify` binary as a
standalone check. If you want an equivalent guard here, model it on layer 2 (a
witness manifest of `{ id, file, sha256, marker }` entries, checked with `ruflo verify
--manifest <path>`) rather than reaching for the truth-scoring surface below, which
was never built.

## Design surface (not shipped)

Truth-metric dashboards, per-file/per-agent confidence scores, threshold-gated
auto-rollback, and CI/CD recipes built around that non-existent surface are recorded
in [references/design-aspirational.md](references/design-aspirational.md), dated and
marked as design only. Do not follow it as current guidance.
