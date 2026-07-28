---
skill: game-dev
name: game-dev
version: 1.0.0
description: >-
  Game development studio for Godot (native), Unity, and Unreal projects —
  design, programming, art, audio, QA, production, and multi-agent team
  orchestration. Use when starting or building a game, adding a gameplay feature
  spanning multiple systems, running sprint/gate/release workflows, auditing
  assets or balance, or coordinating a game-dev team on Godot, Unity, or Unreal.
  Not for general software work with no game engine involved.
tags:
  - game-dev
  - godot
  - unity
  - unreal
  - game-design
  - indie-dev
  - game-programming
  - level-design
  - game-audio
  - game-qa
  - blender
  - asset-pipeline
mcp_server: false
compatibility:
  - godot >= 4.6
  - blender >= 5.0
author: Claude Code Game Studios
---

# Game Development Studio Skill

A full game-development operating model: 48 specialised agents across 8
departments, 38 `/game-dev` workflow commands, 11 path-scoped coding rule sets,
and version-pinned engine references. Covers the whole lifecycle from concept
through release. Ported from Claude Code Game Studios.

## When to use

- Starting a new game project (concept, engine setup, GDD)
- Adding a major gameplay feature that spans multiple systems
- Running sprint planning, retrospectives, or phase-gate checks
- Coordinating a multi-agent team (combat, narrative, level, audio, UI, polish, release)
- Game-specific audits (asset compliance, balance, performance)
- Preparing a release (checklists, changelogs, patch notes, localisation)
- Prototyping a mechanic in isolation, or onboarding a contributor

Skip it when the task is general software work with no game engine, web/API/infra
unrelated to games, a single quick edit needing no design context, or an engine
this skill does not cover.

## Quick path

Pick the workflow for your phase and invoke it as `/game-dev <command>`:

- **Concept:** `start` → `brainstorm` → `design-system` → `map-systems`
- **Pre-production:** `setup-engine` → `architecture-decision` → `prototype` → `sprint-plan`
- **Production:** `team-*` → `code-review` → `perf-profile` → `balance-check`
- **Polish:** `team-polish` → `asset-audit` → `playtest-report` → `bug-report`
- **Release:** `release-checklist` → `localize` → `changelog` → `patch-notes` → `launch-checklist`
- **Post-release:** `hotfix` → `retrospective` → `tech-debt` → `scope-check`

Unsure where you are? Run `/game-dev start` — it detects project state and routes you.

## Engines at a glance

| Engine | Availability | Notes |
|--------|-------------|-------|
| **Godot** 4.6.1 | Native (`godot` on `$PATH`) | Full support, headless testing, GDScript/C#/GDExtension. |
| **Blender** 5.0.1 | Native (`blender`) | Asset pipeline: model, texture, animation export. |
| **Unity** 2023+ | External MCP bridge | Host machine required; file-only fallback without it. |
| **Unreal** 5.x | External MCP bridge | Host machine required; file-only fallback without it. |

The LLM knowledge cutoff predates Godot 4.4 — cross-reference `engine-reference/godot/`
before suggesting Godot API calls. Full matrix, MCP bridge setup, and Godot headless
testing patterns: [references/engines-and-testing.md](references/engines-and-testing.md).

## Collaborative design principle (governance)

Agents act as expert consultants; the user is the creative director with final
decision authority. Every non-trivial interaction follows:
`Question → Options → Decision → Draft → Approval`.

- Ask before writing files — "May I write this to [filepath]?" before Write/Edit
- Show a draft or summary before requesting approval; multi-file changesets need explicit approval
- No commits without user instruction
- No unilateral cross-domain changes (don't modify files outside a delegated domain)

## Bundled resources

Everything lives relative to this skill directory:

| Path | Contents |
|------|----------|
| `agents/` | 48 agent templates (hierarchical delegation model). Roster: [references/agent-roster.md](references/agent-roster.md). |
| `rules/` | 11 path-scoped coding/content rules. Summaries: [references/coding-rules.md](references/coding-rules.md). |
| `engine-reference/` | Version-pinned Godot / Unity / Unreal API snapshots, breaking changes, deprecations. |
| `tools/` | `engine-check.sh`, `godot-headless.sh` helpers. |
| `examples/` | Worked session transcripts (combat, design crafting, scope crisis, reverse-document). |
| `references/` | On-demand detail — see below. |

### References (load on demand)

- [references/workflows.md](references/workflows.md) — all 38 `/game-dev` commands and the 7 team-orchestration pipelines, grouped by stage.
- [references/agent-roster.md](references/agent-roster.md) — the 48 agents by department, with roles.
- [references/engines-and-testing.md](references/engines-and-testing.md) — engine matrix, Unity/Unreal external-MCP setup, Godot headless testing patterns.
- [references/coding-rules.md](references/coding-rules.md) — the 11 path-scoped rule sets.
- [references/context-and-structure.md](references/context-and-structure.md) — long-session context management, session-state recovery, and the project directory layout.
