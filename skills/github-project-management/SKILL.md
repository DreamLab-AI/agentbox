---
name: github-project-management
title: GitHub Project Management
version: 2.0.0
category: github
description: "GitHub project management with swarm-coordinated issue tracking, board automation, and sprint planning. Use when creating issues, managing project boards, planning sprints, decomposing work into vertical-slice tracer bullets, or triaging issue backlogs."
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
  - ruv-swarm or claude-flow MCP server configured
  - Repository access permissions
tools_required:
  - mcp__github__*
  - mcp__claude-flow__*
  - Bash
  - Read
  - Write
  - TodoWrite
related_skills:
  - github-pr-workflow
  - github-release-management
  - sparc-orchestrator
estimated_time: 30-45 minutes
---

# GitHub Project Management

## When Not To Use

- For PR-level code review with security and performance agents -- use the github-code-review skill instead
- For release versioning, changelogs, and deployment pipelines -- use the github-release-management skill instead
- For GitHub Actions workflow creation and CI/CD setup -- use the github-workflow-automation skill instead
- For cross-repository coordination and package sync -- use the github-multi-repo skill instead
- For general task orchestration outside GitHub -- use the swarm-advanced skill instead

## Overview

A comprehensive skill for managing GitHub projects using AI swarm coordination. Combines intelligent issue management, automated project board synchronization, and swarm-based coordination for efficient project delivery.

See [REFERENCE.md](REFERENCE.md) for complete command reference, issue templates, API examples, and advanced configuration.

## Quick Start

### Basic Issue Creation with Swarm Coordination

```bash
# Create a coordinated issue
gh issue create \
  --title "Feature: Advanced Authentication" \
  --body "Implement OAuth2 with social login..." \
  --label "enhancement,swarm-ready"

# Initialize swarm for issue
npx claude-flow@alpha hooks pre-task --description "Feature implementation"
```

### Project Board Quick Setup

```bash
# Get project ID
PROJECT_ID=$(gh project list --owner @me --format json | jq -r '.projects[0].id')

# Initialize board sync
npx ruv-swarm github board-init \
  --project-id "$PROJECT_ID" \
  --sync-mode "bidirectional"
```

---

## Core Capabilities

### 1. Issue Management & Triage

#### Initialize Issue Swarm

```javascript
mcp__claude-flow__swarm_init { topology: "star", maxAgents: 3 }
mcp__claude-flow__agent_spawn { type: "coordinator", name: "Issue Coordinator" }
mcp__claude-flow__agent_spawn { type: "researcher",  name: "Requirements Analyst" }
mcp__claude-flow__agent_spawn { type: "coder",       name: "Implementation Planner" }
```

#### Issue-to-Swarm Conversion

```bash
# Convert issue to swarm task
npx ruv-swarm github issue-to-swarm 456 --issue-data "$ISSUE_DATA" --auto-decompose --assign-agents

# Batch process issues labeled swarm-ready
ISSUES=$(gh issue list --label "swarm-ready" --json number,title,body,labels)
npx ruv-swarm github issues-batch --issues "$ISSUES" --parallel
```

#### Auto-Label Rules (`.github/swarm-labels.json`)

```json
{
  "rules": [
    { "keywords": ["bug", "error", "broken"],         "labels": ["bug", "swarm-debugger"],   "agents": ["debugger", "tester"] },
    { "keywords": ["feature", "implement", "add"],    "labels": ["enhancement", "swarm-feature"], "agents": ["architect", "coder", "tester"] },
    { "keywords": ["slow", "performance", "optimize"],"labels": ["performance", "swarm-optimizer"], "agents": ["analyst", "optimizer"] }
  ]
}
```

#### Automated Triage

```bash
npx ruv-swarm github triage --unlabeled --analyze-content --suggest-labels --assign-priority
npx ruv-swarm github find-duplicates --threshold 0.8 --link-related --close-duplicates
```

#### Stale Issue Management

```bash
STALE_DATE=$(date -d '30 days ago' --iso-8601)
STALE_ISSUES=$(gh issue list --state open --json number,title,updatedAt \
  --jq ".[] | select(.updatedAt < \"$STALE_DATE\")")

echo "$STALE_ISSUES" | jq -r '.number' | while read -r num; do
  gh issue edit $num --add-label "stale"
  gh issue comment $num --body "Inactive for 30 days — will close in 7 days without activity."
done
```

---

### 2. Project Board Automation

#### Connect Swarm to GitHub Project

```bash
PROJECT_ID=$(gh project list --owner @me --format json | \
  jq -r '.projects[] | select(.title == "Development Board") | .id')

npx ruv-swarm github board-init \
  --project-id "$PROJECT_ID" --sync-mode "bidirectional" \
  --create-views "swarm-status,agent-workload,priority"

gh project field-create $PROJECT_ID --owner @me \
  --name "Swarm Status" --data-type "SINGLE_SELECT" \
  --single-select-options "pending,in_progress,completed"
```

#### Real-time Board Sync

```bash
npx ruv-swarm github board-sync \
  --map-status '{"todo":"To Do","in_progress":"In Progress","review":"Review","done":"Done"}' \
  --auto-move-cards --update-metadata

# Smart card transitions
npx ruv-swarm github board-smart-move \
  --rules '{"auto-progress":"when:all-subtasks-done","auto-review":"when:tests-pass","auto-done":"when:pr-merged"}'
```

---

### 3. Sprint Planning & Tracking

```bash
# Manage sprint
npx ruv-swarm github sprint-manage --sprint "Sprint 23" --auto-populate --capacity-planning --track-velocity

# Track milestone
npx ruv-swarm github milestone-track --milestone "v2.0 Release" --update-board --show-dependencies --predict-completion

# Agile board
npx ruv-swarm github agile-board --methodology "scrum" --sprint-length "2w" --ceremonies "planning,review,retro"

# Kanban board with WIP limits
npx ruv-swarm github kanban-board --wip-limits '{"In Progress":5,"Review":3}' --cycle-time-tracking
```

---

## When to Use Each Strategy

| Issue Type | Topology | Key Agents |
|-----------|---------|-----------|
| Bug fix | star | debugger, coder, tester |
| New feature | mesh | architect, coder×2, tester, documenter |
| Performance | hierarchical | analyst, optimizer, tester |
| Security | star | security-tester, coder, reviewer |
| Documentation | ring | researcher, documenter |

---

## Best Practices

1. **Issue Organization**: Always initialize swarm for complex issues; use memory for progress coordination
2. **Board Management**: Clear column definitions; systematic labeling; well-defined automation rules
3. **Data Integrity**: Bidirectional sync validation; comprehensive audit trails; regular backups
4. **Team Adoption**: Clear documented workflows; regular retrospectives; active feedback loops

---

## Metrics Tracked Automatically

- Issue creation and resolution times
- Agent productivity and sprint velocity
- Burndown, cycle time, and throughput
- Work-in-progress limits
- Cross-repository coordination efficiency

---

## Security & Permissions

1. **Command Authorization**: Validate user permissions before executing commands
2. **Rate Limiting**: Prevent spam and abuse of issue commands
3. **Audit Logging**: Track all swarm operations on issues and boards
4. **Data Privacy**: Respect private repository settings
5. **Webhook Security**: Secure webhook endpoints for real-time updates

---

## Integration with Other Skills

- `github-code-review` - Link issues to pull request reviews
- `github-release-management` - Coordinate release issues and milestones
- `github-workflow-automation` - CI/CD pipeline management
- `github-multi-repo` - Cross-repository coordination

---

**Last Updated**: 2025-10-19 | **Version**: 2.0.0 | **Maintainer**: Claude Code
