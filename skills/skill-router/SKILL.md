---
name: skill-router
description: >
  Unified dispatcher for 88+ skills. Use when you don't know which skill to invoke — describe
  your task and get routed to the optimal skill, agent composition, or MCP tool.
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

Describe your task. Get routed to the right skill. You don't need to know 88 skills — just say what you need.

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
2. Load `references/routing-table.md` and classify intent against its sections
   (Code Development, GitHub, Multi-Agent/Swarm, Consultants, Research/Web/Content,
   Economics, Documents, Media/3D/Art, Browser, AI/ML, Memory/Learning, Infrastructure,
   UI/UX, Architecture, Domain-Specific, Security).
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
`references/routing-table.md` is a **generated artefact** derived from every skill's
front-matter `description`. It is drift-prone by construction, so **regenerate it after any
skill description changes** (e.g. the `UPGRADE-PLAN-c5.md` §5 rewrites) rather than editing
routing rows to diverge from their owning skill's description.
