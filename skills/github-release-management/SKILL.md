---
name: github-release-management
version: 2.0.0
description: "Orchestrate GitHub releases end-to-end: version bumps, changelog/release-note generation, multi-platform builds, staged deployment, and rollback. Use when cutting a release, generating a changelog, coordinating a multi-package or multi-repo release, or running an emergency hotfix."
category: github
tags: [release, deployment, versioning, automation, ci-cd, swarm, orchestration]
author: Claude Flow Team
requires:
  - gh (GitHub CLI)
  - claude-flow
  - ruv-swarm (optional for enhanced coordination)
  - mcp-github (optional for MCP integration)
dependencies:
  - git
  - npm or yarn
  - node >= 20.0.0
related_skills:
  - github-pr-management
  - github-issue-tracking
  - github-workflow-automation
  - multi-repo-coordination
---

# GitHub Release Management Skill

Release automation and orchestration — from changelog generation to multi-platform
deployment with rollback capabilities, optionally coordinated by an AI swarm.

## When To Use

- Cutting a release: version bump, tag, GitHub release, changelog/release notes.
- Coordinating a multi-package (monorepo) or multi-repo release.
- Progressive/staged deployment with monitoring and auto-rollback.
- Running an emergency hotfix off the last stable tag.

## When Not To Use

- PR-level code review and quality analysis → **github-code-review**.
- Authoring/optimising GitHub Actions workflow YAML → **github-workflow-automation**.
- Cross-repository dependency sync and structure alignment → **github-multi-repo**
  (multi-repo *releases* are supported here).
- Issue triage, sprint planning, project boards → **github-project-management**.
- Non-GitHub release pipelines or cloud deployment orchestration →
  **flow-nexus-swarm** / **swarm-advanced**.

## Quick Start

### Simple release
```bash
# Plan and create a release (draft, auto-generated notes)
gh release create v2.0.0 --draft --generate-notes --title "Release v2.0.0"

# Or orchestrate with swarm
npx claude-flow github release-create \
  --version "2.0.0" --build-artifacts --deploy-targets "npm,docker,github"
```

### Full automated release
```bash
npx claude-flow swarm init --topology hierarchical
npx claude-flow sparc pipeline "Release v2.0.0 with full validation"
```

## Essential Commands

### Create a release draft with a generated changelog
```bash
LAST_TAG=$(gh release list --limit 1 --json tagName -q '.[0].tagName')
CHANGELOG=$(gh api repos/:owner/:repo/compare/${LAST_TAG}...HEAD \
  --jq '.commits[].commit.message')
gh release create v2.0.0 \
  --draft --title "Release v2.0.0" --notes "$CHANGELOG" --target main
```

### Version bump
```bash
npm version patch          # or minor, major
git push --follow-tags
```

### Simple deployment
```bash
npm run build && npm publish
gh release create $(npm pkg get version) --generate-notes
```

### Release-prep in one Claude Code message
```javascript
[Single Message]:
  Edit("package.json", { old: '"version": "1.0.0"', new: '"version": "2.0.0"' })
  Bash("gh api repos/:owner/:repo/compare/v1.0.0...HEAD --jq '.commits[].commit.message' > CHANGELOG.md")
  Bash("git checkout -b release/v2.0.0")
  Bash("git add -A && git commit -m 'release: Prepare v2.0.0'")
  Bash("gh pr create --title 'Release v2.0.0' --body 'Automated release preparation'")
```

## Core Capabilities

1. **Release planning & versioning** — semantic version analysis, breaking-change
   detection, timeline generation, multi-package coordination.
2. **Testing & validation** — multi-stage orchestration, cross-platform and
   compatibility testing, performance-regression and security scanning.
3. **Build & deployment** — multi-platform builds, parallel artifacts, progressive
   rollout, automated rollback.
4. **Documentation & communication** — changelog and release-note generation,
   migration guides, stakeholder notification.

## Deeper Detail (progressive disclosure)

- **Swarm orchestration** (release team init, coordinated workflow, agent
  specializations) → [`references/swarm-orchestration.md`](references/swarm-orchestration.md)
- **Advanced & enterprise workflows** (monorepo, progressive deploy, multi-repo,
  hotfix, release-swarm config, compliance) → [`references/advanced-workflows.md`](references/advanced-workflows.md)
- **CI/CD workflows** (full `release.yml` + `hotfix.yml`) → [`references/ci-workflows.md`](references/ci-workflows.md)
- **Best practices, troubleshooting, metrics, checklist template** →
  [`references/best-practices.md`](references/best-practices.md)

---

**Version**: 2.0.0 · **Last Updated**: 2026-07-28 · **Maintained By**: Claude Flow Team
