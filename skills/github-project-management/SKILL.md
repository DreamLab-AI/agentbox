---
name: github-project-management
title: GitHub Project Management
version: 2.1.0
category: github
description: "Use when creating GitHub issues, managing project boards, planning sprints, decomposing work into vertical-slice tracer bullets, or triaging an issue backlog with swarm coordination. NOT for PR review (use github-code-review), release versioning (use github-release-management), CI/CD workflows (use github-workflow-automation), or cross-repo sync (use github-multi-repo)."
author: Claude Code
tags:
  - github
  - project-management
  - issue-tracking
  - project-boards
  - sprint-planning
  - agile
  - swarm-coordination
difficulty: intermediate
prerequisites:
  - GitHub CLI (gh) installed and authenticated
  - claude-flow MCP server configured
  - Repository access permissions
tools_required:
  - gh
  - Bash
  - mcp__claude-flow__*
  - Read
  - Write
  - TodoWrite
related_skills:
  - github-code-review
  - github-release-management
  - github-workflow-automation
  - github-multi-repo
estimated_time: 30-45 minutes
---

# GitHub Project Management

Manage GitHub issues, boards, and sprints — optionally coordinated by a claude-flow agent swarm. Issue work goes through the `gh` CLI; swarm orchestration through `mcp__claude-flow__*` tools.

## When Not To Use

- PR-level code review with security/performance agents → **github-code-review**
- Release versioning, changelogs, deployment pipelines → **github-release-management**
- GitHub Actions workflow creation and CI/CD setup → **github-workflow-automation**
- Cross-repository coordination and package sync → **github-multi-repo**
- General task orchestration outside GitHub → **swarm-advanced**

## Quick Start

```bash
# Create an issue tagged for swarm pickup
gh issue create \
  --title "Feature: Advanced Authentication" \
  --body "Implement OAuth2 with social login..." \
  --label "enhancement,swarm-ready"

# Open a coordination swarm for the issue
npx claude-flow@alpha hooks pre-task --description "Feature implementation"
```

Board setup:

```bash
PROJECT_ID=$(gh project list --owner @me --format json | jq -r '.projects[0].id')
npx ruv-swarm github board-init --project-id "$PROJECT_ID" --sync-mode "bidirectional"
```

## Full Reference

The complete command catalogues — issue triage and templates, board automation, sprint/milestone commands, analytics, security, and end-to-end workflow examples — live in [references/REFERENCE.md](references/REFERENCE.md). Load it on demand.

---

**Last Updated**: 2026-08-21 | **Version**: 2.1.0 | **Maintainer**: Claude Code
