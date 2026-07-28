---
name: verification-quality
description: "Truth scoring, code-quality verification, and verification-gated automatic rollback for agent and file output via claude-flow. Use when you need confidence scores on agent output, rollback safety checks, or lightweight truth verification without the full build-with-quality pipeline."
version: "2.0.0"
category: "quality-assurance"
tags: ["verification", "truth-scoring", "quality", "rollback", "metrics", "ci-cd"]
---

# Verification & Quality Assurance

Lightweight verification layer over `claude-flow`: reliability scores (0.0-1.0) for
code/agents/tasks, automated correctness/security/best-practice checks, and automatic
rollback of changes that fail a threshold.

## When to use

- You want a confidence score on an agent's or a file's output.
- You want changes auto-reverted when they fall below a quality threshold.
- You want truth-metric dashboards/reports without standing up the full pipeline.

## When not to use

- Full development pipelines with quality gates → **build-with-quality**.
- Swarm performance profiling / bottleneck detection → **performance-analysis**.
- GitHub PR code review with specialised agents → **github-code-review**.
- Test generation + coverage without truth scoring → TDD workflow in **sparc-methodology**.
- Simple linting/formatting → run the project's lint/format tools directly.

## Prerequisites

- Claude Flow (`npx claude-flow@alpha`)
- Git repository (for rollback features)
- Node.js 18+ (for dashboard features)

## Quick start

```bash
# View current truth scores
npx claude-flow@alpha truth

# Run verification check (default threshold 0.95)
npx claude-flow@alpha verify check

# Verify a specific file with a custom threshold
npx claude-flow@alpha verify check --file src/app.js --threshold 0.98

# Rollback the last failed verification
npx claude-flow@alpha verify rollback --last-good
```

Threshold guidance: 0.99 critical code · 0.95 standard · 0.90 experimental. Exit codes:
`0` passed, `1` failed (score < threshold), `2` error.

## Full reference

The complete command surface — truth-metric formats and dashboard, all `verify check`/
`batch`/`report`/`dashboard`/`watch` flags, the five verification criteria, JSON schema,
rollback modes, `.claude-flow/config.json` schema, per-environment thresholds, CI/CD
recipes (GitHub Actions, GitLab), swarm/pair/pre-commit integration, monitoring
export (Prometheus/DataDog/webhook), performance figures, and troubleshooting — lives in
[references/complete-guide.md](references/complete-guide.md).
