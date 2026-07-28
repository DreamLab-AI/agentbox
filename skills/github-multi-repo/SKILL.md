---
name: github-multi-repo
version: 1.0.0
description: "Coordinate work across many GitHub repositories at once — org-wide dependency/security updates, package and doc version alignment, cross-repo refactors, and shared architecture/templates. Use when a change must land in several repos together, not for single-repo review, release, or CI tasks."
category: github-integration
tags: [multi-repo, synchronization, architecture, coordination, github]
author: Claude Flow Team
requires:
  - ruv-swarm@^1.0.11
  - gh-cli@^2.0.0
---

# GitHub Multi-Repository Coordination

Coordinate AI swarms, package synchronisation, and architecture across multiple
repositories: organisation-wide automation, cross-project changes, and scalable
repository management. Combines `gh` CLI, `claude-flow` swarm MCP tools, and
agent orchestration.

## When to use
- A single change must land across several repos in step (dependency bumps,
  security patches, policy files, shared CI workflows).
- Aligning package versions or documentation across packages/monorepo members.
- Discovering related repos, mapping cross-repo dependencies, or standardising
  structure/templates org-wide.

## When not to use
- Single-repository code review → `github-code-review`.
- Release management within one repo → `github-release-management`.
- GitHub Actions workflow authoring → `github-workflow-automation`.
- Issue tracking / sprint planning → `github-project-management`.
- Cloud swarm deployment unrelated to GitHub repos → `flow-nexus-swarm`.

## Safety — org-wide operations are hard to reverse
Cross-repo pushes touch many repositories in one sweep and are not locally
reversible once fanned out. Before running a fan-out that pushes, opens PRs, or
mutates files across an org:
- Scope the repo filter tightly and dry-run the discovery step first (list the
  repos that would be touched before acting on them).
- Prefer opening PRs over direct pushes so each change is reviewable per repo.
- For genuinely irreversible org-wide sweeps (force pushes, protected-branch or
  policy changes), get explicit human sign-off before executing — treat this as a
  hard gate, not a default.
This is the one guard-railed path in the skill; everything else is judgment-based.

## Quick start

```bash
# Initialize multi-repo coordination (hierarchical topology)
npx claude-flow skill run github-multi-repo init \
  --repos "org/frontend,org/backend,org/shared" \
  --topology hierarchical

# Mesh topology with shared memory + eventual-consistency sync
npx claude-flow skill run github-multi-repo init \
  --repos "org/frontend,org/backend,org/shared" \
  --topology mesh --shared-memory --sync-strategy eventual

# Synchronize package versions and dependencies
npx claude-flow skill run github-multi-repo sync \
  --packages "claude-code-flow,ruv-swarm" --align-versions --update-docs

# Analyze and optimize repository structure
npx claude-flow skill run github-multi-repo optimize \
  --analyze-structure --suggest-improvements --create-templates
```

## Core capabilities
- **Multi-repository swarm coordination** — cross-repo AI swarm orchestration for
  distributed workflows.
- **Package synchronisation** — dependency resolution and version alignment across
  packages.
- **Repository architecture** — structure optimisation and template management.
- **Integration management** — cross-package integration testing and deployment.

## References
- **[references/cookbook.md](references/cookbook.md)** — runnable recipes: swarm
  discovery/synchronised ops, package + doc version alignment, cross-package
  features, architecture analysis, template creation, standardisation, and the
  org-wide dependency/refactor/security-patch workflows.
- **[references/configuration.md](references/configuration.md)** — `.swarm/multi-repo.yml`
  config, repository roles, webhook/Kafka communication strategies, eventual/strong/
  hybrid sync patterns, and monorepo/command-structure layouts.
- **[references/operations.md](references/operations.md)** — the
  `skill run github-multi-repo <verb>` operational surface (use cases, dashboards,
  dep-graph, health checks, caching/parallel/resource tuning, troubleshooting,
  advanced features, metrics), plus related-skill integration points.

---

**Version:** 1.0.0 · **Last Updated:** 2026-07-28 · **Maintainer:** Claude Flow Team
