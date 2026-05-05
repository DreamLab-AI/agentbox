# GitHub Project Management — Complete Reference

Full command reference and API examples extracted from SKILL.md.

---

## Issue Templates

### Integration Issue Template

```markdown
## 🔄 Integration Task

### Overview
[Brief description of integration requirements]

### Objectives
- [ ] Component A integration
- [ ] Component B validation
- [ ] Testing and verification
- [ ] Documentation updates

### Integration Areas
#### Dependencies
- [ ] Package.json updates
- [ ] Version compatibility
- [ ] Import statements

#### Functionality
- [ ] Core feature integration
- [ ] API compatibility
- [ ] Performance validation

#### Testing
- [ ] Unit tests
- [ ] Integration tests
- [ ] End-to-end validation

### Swarm Coordination
- **Coordinator**: Overall progress tracking
- **Analyst**: Technical validation
- **Tester**: Quality assurance
- **Documenter**: Documentation updates

### Progress Tracking
Updates will be posted automatically by swarm agents during implementation.
```

### Bug Report Template

```markdown
## 🐛 Bug Report

### Problem Description
[Clear description of the issue]

### Expected Behavior
[What should happen]

### Actual Behavior
[What actually happens]

### Reproduction Steps
1. [Step 1]
2. [Step 2]
3. [Step 3]

### Environment
- Package: [package name and version]
- Node.js: [version]
- OS: [operating system]

### Investigation Plan
- [ ] Root cause analysis
- [ ] Fix implementation
- [ ] Testing and validation
- [ ] Regression testing

### Swarm Assignment
- **Debugger**: Issue investigation
- **Coder**: Fix implementation
- **Tester**: Validation and testing
```

### Feature Request Template

```markdown
## ✨ Feature Request

### Feature Description
[Clear description of the proposed feature]

### Use Cases
1. [Use case 1]
2. [Use case 2]
3. [Use case 3]

### Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

### Implementation Approach
#### Design
- [ ] Architecture design
- [ ] API design
- [ ] UI/UX mockups

#### Development
- [ ] Core implementation
- [ ] Integration with existing features
- [ ] Performance optimization

#### Testing
- [ ] Unit tests
- [ ] Integration tests
- [ ] User acceptance testing

### Swarm Coordination
- **Architect**: Design and planning
- **Coder**: Implementation
- **Tester**: Quality assurance
- **Documenter**: Documentation
```

### Swarm Task Template

```markdown
<!-- .github/ISSUE_TEMPLATE/swarm-task.yml -->
name: Swarm Task
description: Create a task for AI swarm processing
body:
  - type: dropdown
    id: topology
    attributes:
      label: Swarm Topology
      options:
        - mesh
        - hierarchical
        - ring
        - star
  - type: input
    id: agents
    attributes:
      label: Required Agents
      placeholder: "coder, tester, analyst"
  - type: textarea
    id: tasks
    attributes:
      label: Task Breakdown
      placeholder: |
        1. Task one description
        2. Task two description
```

---

## Workflow Integration

### GitHub Actions for Issue Management

```yaml
# .github/workflows/issue-swarm.yml
name: Issue Swarm Handler
on:
  issues:
    types: [opened, labeled, commented]

jobs:
  swarm-process:
    runs-on: ubuntu-latest
    steps:
      - name: Process Issue
        uses: ruvnet/swarm-action@v1
        with:
          command: |
            if [[ "${{ github.event.label.name }}" == "swarm-ready" ]]; then
              npx ruv-swarm github issue-init ${{ github.event.issue.number }}
            fi
```

### Board Integration Workflow

```bash
npx ruv-swarm github issue-board-sync \
  --project "Development" \
  --column-mapping '{
    "To Do": "pending",
    "In Progress": "active",
    "Done": "completed"
  }'
```

---

## Specialized Issue Strategies

### Bug Investigation Swarm

```bash
npx ruv-swarm github bug-swarm 456 --reproduce --isolate --fix --test
```

### Feature Implementation Swarm

```bash
npx ruv-swarm github feature-swarm 456 --design --implement --document --demo
```

### Technical Debt Refactoring

```bash
npx ruv-swarm github debt-swarm 456 --analyze-impact --plan-migration --execute --validate
```

---

## Advanced Coordination

### Multi-Board Synchronization

```bash
npx ruv-swarm github multi-board-sync \
  --boards "Development,QA,Release" \
  --sync-rules '{
    "Development->QA": "when:ready-for-test",
    "QA->Release": "when:tests-pass"
  }'

npx ruv-swarm github cross-org-sync \
  --source "org1/Project-A" \
  --target "org2/Project-B" \
  --field-mapping "custom" \
  --conflict-resolution "source-wins"
```

### Issue Dependencies

```bash
npx ruv-swarm github issue-deps 456 --resolve-order --parallel-safe --update-blocking
```

### Epic Coordination

```bash
npx ruv-swarm github epic-swarm --epic 123 --child-issues "456,457,458" --orchestrate
```

### Cross-Repository Coordination

```bash
npx ruv-swarm github cross-repo \
  --issue "org/repo#456" \
  --related "org/other-repo#123" \
  --coordinate
```

### Work Distribution

```bash
npx ruv-swarm github board-distribute \
  --strategy "skills-based" --balance-workload --respect-preferences --notify-assignments
```

### Standup Automation

```bash
npx ruv-swarm github standup-report \
  --team "frontend" --include "yesterday,today,blockers" --format "slack" --schedule "daily-9am"
```

### Review Coordination

```bash
npx ruv-swarm github review-coordinate \
  --board "Code Review" --assign-reviewers --track-feedback --ensure-coverage
```

---

## Board Configuration Details

### Board Mapping Configuration

```yaml
# .github/board-sync.yml
version: 1
project:
  name: "AI Development Board"
  number: 1

mapping:
  status:
    pending: "Backlog"
    assigned: "Ready"
    in_progress: "In Progress"
    review: "Review"
    completed: "Done"
    blocked: "Blocked"

  agents:
    coder: "🔧 Development"
    tester: "🧪 Testing"
    analyst: "📊 Analysis"
    designer: "🎨 Design"
    architect: "🏗️ Architecture"

  priority:
    critical: "🔴 Critical"
    high: "🟡 High"
    medium: "🟢 Medium"
    low: "⚪ Low"

  fields:
    - name: "Agent Count"
      type: number
      source: task.agents.length
    - name: "Complexity"
      type: select
      source: task.complexity
    - name: "ETA"
      type: date
      source: task.estimatedCompletion
```

### Custom Views & Dashboards

```javascript
// Custom board views
{
  "views": [
    { "name": "Swarm Overview",  "type": "board",   "groupBy": "status",       "filters": ["is:open"], "sort": "priority:desc" },
    { "name": "Agent Workload",  "type": "table",   "groupBy": "assignedAgent","columns": ["title", "status", "priority", "eta"], "sort": "eta:asc" },
    { "name": "Sprint Progress", "type": "roadmap", "dateField": "eta",        "groupBy": "milestone" }
  ]
}

// Dashboard with performance widgets
{
  "dashboard": {
    "widgets": [
      { "type": "chart",   "title": "Task Completion Rate", "data": "completed-per-day",  "visualization": "line" },
      { "type": "gauge",   "title": "Sprint Progress",      "data": "sprint-completion",  "target": 100 },
      { "type": "heatmap", "title": "Agent Activity",       "data": "agent-tasks-per-day" }
    ]
  }
}
```

---

## Analytics & Reporting Commands

```bash
# Board analytics
PROJECT_DATA=$(gh project item-list $PROJECT_ID --owner @me --format json)
npx ruv-swarm github board-analytics \
  --project-data "$PROJECT_DATA" \
  --metrics "throughput,cycle-time,wip" \
  --group-by "agent,priority,type" \
  --time-range "30d" \
  --export "dashboard"

# Sprint and burndown reports
npx ruv-swarm github board-progress --show "burndown,velocity,cycle-time" --time-period "sprint" --export-metrics
npx ruv-swarm github board-report --type "sprint-summary" --format "markdown" --include "velocity,burndown,blockers"

# KPI tracking
npx ruv-swarm github board-kpis \
  --metrics '["average-cycle-time","throughput-per-sprint","blocked-time-percentage","first-time-pass-rate"]'

# Team metrics
npx ruv-swarm github team-metrics --board "Development" --per-member --include "velocity,quality,collaboration"

# Release planning
npx ruv-swarm github release-plan-board --analyze-velocity --estimate-completion --identify-risks

# Issue resolution metrics
npx ruv-swarm github issue-metrics --issue 456 --metrics "time-to-close,agent-efficiency,subtask-completion"
npx ruv-swarm github effectiveness --issues "closed:>2024-01-01" --compare "with-swarm,without-swarm"
```

---

## Troubleshooting Commands

```bash
# Diagnose sync problems
npx ruv-swarm github board-diagnose --check "permissions,webhooks,rate-limits" --test-sync --show-conflicts

# Optimize board performance
npx ruv-swarm github board-optimize --analyze-size --archive-completed --index-fields --cache-views

# Recover board data
npx ruv-swarm github board-recover --backup-id "2024-01-15" --restore-cards --preserve-current --merge-conflicts
```

---

## Complete Workflow Example

### Full-Stack Feature Development

```bash
# 1. Create feature issue with swarm coordination
gh issue create \
  --title "Feature: Real-time Collaboration" \
  --body "$(cat <<EOF
## Feature: Real-time Collaboration
### Overview
Implement real-time collaboration features using WebSockets.
### Objectives
- [ ] WebSocket server setup
- [ ] Client-side integration
- [ ] Presence tracking
- [ ] Conflict resolution
- [ ] Testing and documentation
### Swarm Coordination
This feature will use mesh topology for parallel development.
EOF
)" \
  --label "enhancement,swarm-ready,high-priority"

# 2. Initialize swarm and decompose tasks
ISSUE_NUM=$(gh issue list --label "swarm-ready" --limit 1 --json number --jq '.[0].number')
npx ruv-swarm github issue-init $ISSUE_NUM \
  --topology mesh --auto-decompose --assign-agents "architect,coder,tester"

# 3. Add to project board
PROJECT_ID=$(gh project list --owner @me --format json | jq -r '.projects[0].id')
gh project item-add $PROJECT_ID --owner @me \
  --url "https://github.com/$GITHUB_REPOSITORY/issues/$ISSUE_NUM"

# 4. Set up automated tracking
npx ruv-swarm github board-sync --auto-move-cards --update-metadata

# 5. Monitor progress
npx ruv-swarm github issue-progress $ISSUE_NUM --auto-update-comments --notify-on-completion
```

---

## Quick Reference Commands

```bash
# Issue Management
gh issue create --title "..." --body "..." --label "..."
npx ruv-swarm github issue-init <number>
npx ruv-swarm github issue-decompose <number>
npx ruv-swarm github triage --unlabeled

# Project Boards
npx ruv-swarm github board-init --project-id <id>
npx ruv-swarm github board-sync
npx ruv-swarm github board-analytics

# Sprint Management
npx ruv-swarm github sprint-manage --sprint "Sprint X"
npx ruv-swarm github milestone-track --milestone "vX.X"

# Analytics
npx ruv-swarm github issue-metrics --issue <number>
npx ruv-swarm github board-kpis
```
