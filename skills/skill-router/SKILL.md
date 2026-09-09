---
name: skill-router
description: >
  Unified dispatcher for the full skills estate. Use when you don't know which skill to invoke —
  describe your task and get routed to the optimal skill, agent composition, or MCP tool. Not for
  executing the task itself: it only routes, then hands off to the skill that does the work.
version: 1.1.0
author: agentbox-claude
tags:
  - routing
  - discovery
  - dispatcher
  - meta-skill
user-invocable: true
---

# /route — Unified Skill Dispatcher

Describe your task. Get routed to the right skill. You don't need to know the full skills estate — just say what you need.

## Usage

```
/route [describe what you need]
```

Examples:
- `/route fix the login bug and add tests`
- `/route generate a Wardley map of our infrastructure`
- `/route audit this UI for accessibility`
- `/route research competitor pricing for UK market`
- `/route harden this Linux server for SOC2`
- `/route 123 Main St, Brooklyn — site analysis and zoning`
- `/route make a podcast about our architecture`

## Routing Method

The full routing table lives in **`references/routing-table.md`** (loaded on demand — it
duplicates each skill's front-matter description and is regenerated after description
changes; it is not kept inline here to avoid drift). Route as follows:

1. Read the user's input — everything after `/route`.
2. Load `references/routing-table.md` and classify intent against its sections (they mirror
   the category headings of `SKILL-DIRECTORY.md`; one row per skill, each row's text is the
   skill's own trigger description).
3. Apply the routing rules below to dispatch, clarify, or compose.

## Routing Rules

### Rule 1: Clear match → dispatch immediately
State which skill handles the request in one sentence, then invoke it.

### Rule 2: Ambiguous → ask ONE question
If the intent could go to 2+ skills, ask exactly one clarifying question. Then route.

### Rule 3: Multi-skill composition → state the plan
If the task spans multiple skills, state the sequence and invoke the first one.
Example: "Starting with `perplexity-research` for competitor data, then `report-builder` for the analysis document."

### Rule 4: No match → show condensed menu
```
I don't have a specific skill for that. Here's what I cover:

• Code: /route [bug fix / feature / refactor]
• Research: /route [web search / URL analysis / NotebookLM]
• Economics: /route [GPU cost / agent job pricing / token conversion / valuation]
• Design: /route [UI/UX / design audit / typography]
• Docs: /route [report / LaTeX / diagrams / Wardley map]
• Media: /route [image / video / 3D / AI art]
• DevOps: /route [GitHub / CI-CD / release]
• Security: /route [hardening / compliance / audit]
• Architecture: /route [review / first-principles / entropy lens]
• AEC: /route [site planning / zoning / sustainability]

Or browse the full inventory: see SKILL-DIRECTORY.md
```

### Rule 5: Just `/route` with no arguments → show condensed menu

## What This Skill Does NOT Do
- It does not execute tasks. It routes to the skill that does.
- It does not override skill-internal logic.
- It does not ask more than one clarifying question.

## Maintaining the routing table
`references/routing-table.md` is **generated**: `node skills/gen-routing-table.mjs` reads every
skill's frontmatter `description` (and `deprecated`/`replacement`) and the section for each
skill from `references/section-map.json`, and rewrites the table. `bash skills/lint-skills.sh`
fails when the table is stale (`--check`) or a skill directory is missing from the section map.
Never hand-edit a row: fix the owning skill's description, add the skill to the section map if
it is new, and regenerate. (Until 2026-09-09 the table claimed to be generated but was
hand-maintained and 38 skills behind the tree.)

## Cross-harness note
`/route` is a Claude Code slash command. On Codex (GPT-6 Astra) read
`references/routing-table.md` directly; the same rows, the same descriptions.
