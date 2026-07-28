---
name: agentic-jujutsu
version: 2.3.2
description: "Lock-free version control for multiple AI agents committing concurrently to the same repo, built on Jujutsu (jj). Use when several agents need to commit/branch/rebase simultaneously without lock contention, for conflict-free concurrent worktree isolation, or when you want per-agent operation tracking with learned suggestions for repeated jj workflows."
---

# Agentic Jujutsu — AI Agent Version Control

Lock-free, self-learning version control designed for multiple AI agents
working simultaneously without conflicts. Wraps the Jujutsu (`jj`) VCS with a
ReasoningBank trajectory store (learned suggestions), AgentDB operation
tracking, and quantum-resistant integrity fingerprints.

## When to use

- Multiple AI agents are modifying the same repo simultaneously and you want to
  avoid Git's lock contention and serialised commits.
- You need conflict-free concurrent worktree isolation across agents.
- You want operations tracked per agent, with pattern discovery and learned
  suggestions for repeated workflows (deploys, merges, reviews).
- You want fast quantum-resistant (SHA3-512 / HQC-128) integrity checks on
  commits or trajectories.

## When not to use

- Standard single-actor Git operations with no multi-agent coordination — use
  Git directly.
- GitHub PR workflows, issue tracking, or release management — use the
  `github-code-review` / `github-release-management` skills.
- General agent memory and pattern storage without version control — use
  `agentdb-memory-patterns`.
- CI/CD pipeline automation — use `github-workflow-automation`.

## Quick start

```bash
npx agentic-jujutsu
```

```javascript
const { JjWrapper } = require('agentic-jujutsu');

const jj = new JjWrapper();

// Basic operations
await jj.status();
await jj.newCommit('Add feature');
await jj.log(10);

// Self-learning trajectory
const id = jj.startTrajectory('Implement authentication');
await jj.branchCreate('feature/auth');
await jj.newCommit('Add auth');
jj.addToTrajectory();
jj.finalizeTrajectory(0.9, 'Clean implementation');

// Get an AI suggestion for a similar task
const suggestion = JSON.parse(jj.getSuggestion('Add logout feature'));
console.log(`Confidence: ${suggestion.confidence}`);
```

The core loop is: `startTrajectory(task)` → do work (auto-tracked) →
`addToTrajectory()` → `finalizeTrajectory(score, critique)`. Later,
`getSuggestion(task)` returns a learned recommendation. Use honest success
scores (never always 1.0) so the model can learn.

Learning memory (ReasoningBank trajectories, patterns, coordination state) is
stored in centralized RuVector PostgreSQL, retrieved via pgvector HNSW.

## Detailed references

- **`references/cookbook.md`** — worked examples per capability (self-learning,
  pattern discovery, multi-agent coordination, quantum security, operation
  tracking), advanced multi-agent use cases, best practices, and end-to-end
  examples.
- **`references/api.md`** — full method catalog (Core / ReasoningBank / AgentDB
  / Quantum), validation rules, performance characteristics, RuVector storage
  details, troubleshooting, and version history.
