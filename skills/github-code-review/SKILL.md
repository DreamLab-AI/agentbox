---
name: github-code-review
version: 1.0.0
description: "Multi-agent code review for GitHub PRs. Use when reviewing a pull request, running security/performance/architecture/style checks on a diff, or coordinating specialized review agents and posting findings back to a PR."
category: github
tags: [code-review, github, swarm, pr-management, automation]
author: Claude Code Flow
requires:
  - github-cli
  - ruv-swarm
  - claude-flow
capabilities:
  - Multi-agent code review
  - Automated PR management
  - Security and performance analysis
  - Swarm-based review orchestration
  - Intelligent comment generation
  - Quality gate enforcement
---

# GitHub Code Review Skill

Deploy specialized review agents (security, performance, architecture, style,
accessibility) to review PRs in parallel and post findings back through the
GitHub CLI — beyond traditional single-pass static analysis.

## When to use

- Reviewing a pull request diff for security, performance, architecture, or style issues
- Running specialized checks (OWASP/secrets, Big-O/query efficiency, SOLID/coupling) on changed files
- Coordinating multiple review agents and posting inline comments, labels, or approve/request-changes decisions
- Wiring auto-review into CI (GitHub Actions) or PR-comment commands

## When not to use

- Full project development with quality gates, TDD, and coverage analysis → use **build-with-quality**
- Release versioning, changelog generation, deployment orchestration → use **github-release-management**
- GitHub Actions workflow creation and CI/CD pipeline setup → use **github-workflow-automation**
- Cross-repository synchronisation and architecture management → use **github-multi-repo**
- Sprint planning, issue triage, project board management → use **github-project-management**

## Quick start

```bash
# Initialize review swarm for PR
gh pr view 123 --json files,diff | npx ruv-swarm github review-init --pr 123

# Post review status
gh pr comment 123 --body "🔍 Multi-agent code review initiated"
```

### Complete review workflow

```bash
# Get PR context with gh CLI
PR_DATA=$(gh pr view 123 --json files,additions,deletions,title,body)
PR_DIFF=$(gh pr diff 123)

# Initialize comprehensive review across specialized agents
npx ruv-swarm github review-init \
  --pr 123 \
  --pr-data "$PR_DATA" \
  --diff "$PR_DIFF" \
  --agents "security,performance,style,architecture,accessibility" \
  --depth comprehensive
```

## Reference library

Detailed agent catalogs, config schemas, and end-to-end recipes live in `references/`.
Load the one you need on demand:

- **[references/review-agents.md](references/review-agents.md)** — the specialized
  agents (security, performance, architecture, style), the checks each performs,
  comment templates, and how to build/register a custom review agent.
- **[references/swarm-and-automation.md](references/swarm-and-automation.md)** —
  PR-driven swarm creation, label→agent mapping, topology-by-PR-size, PR-comment
  commands, webhook handler, GitHub Actions auto-review, inline comment generation,
  CI/CD integration, auto-fix and auto-merge.
- **[references/configuration-and-gates.md](references/configuration-and-gates.md)** —
  `.github/review-swarm.yml`, custom path triggers, quality-gate thresholds, status
  checks, security considerations/checklist, and review/comment best practices.
- **[references/advanced-and-workflows.md](references/advanced-and-workflows.md)** —
  context-aware and cross-PR reviews, learning-from-history, five complete workflow
  examples (security/performance/UI/feature/bug-fix), monitoring/analytics, Claude
  Code integration, and troubleshooting.

## Related skills

- `github-release-management` — version management and deployment orchestration
- `github-workflow-automation` — CI/CD pipeline management
- `github-project-management` — issue tracking and sprint planning
- `github-multi-repo` — cross-repository coordination

---

**Last Updated:** 2026-07-28 · **Version:** 1.0.0 · **Maintainer:** Claude Code Flow Team ·
Licensed under the MIT License as part of the Claude Code Flow project.
