---
name: github-workflow-automation
version: 1.1.0
category: github
description: "Automate GitHub Actions workflows and CI/CD pipelines with claude-flow swarm coordination. Use when creating, optimizing, or debugging GitHub Actions workflow YAML, CI/CD pipelines, or GitHub repository automation — not for PR code review, releases, issues, or multi-repo sync (see the github-* sibling skills)."
tags:
  - github
  - github-actions
  - ci-cd
  - workflow-automation
  - swarm-coordination
  - deployment
  - security
authors:
  - claude-flow
requires:
  - gh (GitHub CLI)
  - git
  - claude-flow@alpha
  - node (v16+)
priority: high
progressive_disclosure: true
---

# GitHub Workflow Automation

Comprehensive GitHub Actions automation with claude-flow swarm coordination —
CI/CD pipeline generation, workflow orchestration, and repository automation
built as self-organising, adaptive GitHub workflows.

## When to use

Reach for this skill when the task is about GitHub Actions *workflow files* or
CI/CD *pipelines*: generating a new `.github/workflows/*.yml`, optimizing an
existing pipeline (parallelization, caching, cost), analysing failed runs,
building swarm-driven CI/security/deploy stages, or wiring claude-flow swarm
coordination into a repo's automation.

## When not to use

- PR-level code review with specialised agents → **github-code-review**
- Release versioning, changelogs, deployment orchestration → **github-release-management**
- Cross-repository package synchronisation → **github-multi-repo**
- Issue tracking and sprint planning → **github-project-management**
- Non-GitHub workflow automation or cloud swarm orchestration → **flow-nexus-swarm**

## Quick start

```bash
# Generate an optimal pipeline from the codebase
npx ruv-swarm actions generate-workflow \
  --analyze-codebase \
  --detect-languages \
  --create-optimal-pipeline

# Optimize an existing workflow
npx ruv-swarm actions optimize \
  --workflow ".github/workflows/ci.yml" \
  --suggest-parallelization

# Analyze a failed run and get fixes
gh run view <run-id> --json jobs,conclusion | \
  npx ruv-swarm actions analyze-failure --suggest-fixes
```

## Prerequisites

`gh` installed and authenticated · `git` configured · Node.js v16+ ·
`claude-flow@alpha` available · repo has `.github/workflows` and Actions
enabled. Full checklist and a setup script: `references/best-practices.md`.

## Reference detail (progressive disclosure)

The heavy catalogs live in `references/` — load the one you need:

- **[references/github-modes.md](references/github-modes.md)** — the eight
  swarm-powered GitHub modes (gh-coordinator, pr-manager, issue-tracker,
  release-manager, repo-architect, code-reviewer, ci-orchestrator,
  security-guardian) with usage examples.
- **[references/workflow-templates.md](references/workflow-templates.md)** —
  eight production-ready Actions templates (intelligent CI, polyglot detection,
  adaptive security scan, self-healing pipeline, progressive deploy, perf-guard,
  PR validation, intelligent release) plus monitoring/analytics commands.
- **[references/advanced-features.md](references/advanced-features.md)** —
  dynamic test strategies, predictive analysis, custom swarm-action
  development, and MCP-based claude-flow swarm coordination / hooks / batch ops.
- **[references/best-practices.md](references/best-practices.md)** — workflow
  organisation, security and performance best practices, debugging &
  troubleshooting, complete real-world examples, the full command reference,
  and the setup checklist.

## Related skills

- `github-code-review` — PR review and quality analysis
- `github-release-management` — release automation and deployment
- `github-project-management` — issue tracking and sprint planning
- `github-multi-repo` — cross-repository coordination
