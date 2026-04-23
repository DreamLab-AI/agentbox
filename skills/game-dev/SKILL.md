---
skill: game-dev
name: game-dev
version: 1.0.0
description: >-
  Comprehensive game development studio with 48 coordinated agents for Godot,
  Unity, and Unreal Engine projects. Covers design, programming, art, audio,
  QA, production, and team orchestration workflows across 38 skill commands.
  Ported from Claude Code Game Studios.
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

## Table of Contents

1. [Overview](#overview)
2. [When to Use / When Not to Use](#when-to-use)
3. [Engine Support Matrix](#engine-support-matrix)
4. [Available Workflows](#available-workflows)
5. [Agent Roster](#agent-roster)
6. [Coding Rules](#coding-rules)
7. [Collaborative Design Principle](#collaborative-design-principle)
8. [External MCP Requirements](#external-mcp-requirements)
9. [Godot Headless Testing](#godot-headless-testing)
10. [Context Management](#context-management)

---

## Overview

This skill provides a full game development studio operating model with 48
specialised agents, 38 workflow commands, and 11 rule sets. It covers the
entire lifecycle from concept ideation through release deployment.

**What it provides:**

- 48 agents organised into 8 departments (Leadership, Design, Programming,
  Art, Audio, QA, Production, Engine Specialists)
- 38 slash-command workflows covering design, implementation, testing,
  production management, and team orchestration
- 11 coding/content rule files enforced by file path
- Engine-specific reference material for Godot 4.6, Unity, and Unreal Engine 5
- A collaborative design protocol ensuring human-driven decision making
- Context management strategies for long sessions

**Architecture:**

Agents are organised in a hierarchical delegation model. Leadership agents
(creative-director, technical-director, producer) delegate to department leads,
who delegate to specialists. Agents at the same tier may consult each other but
must not make binding decisions outside their domain.

All agent templates are in `agents/` relative to this skill directory. Rule
files are in `rules/`. Engine API reference snapshots are in `engine-reference/`.

---

## When to Use

**Use this skill when:**

- Starting a new game project from scratch (concept, engine setup, GDD)
- Adding a major gameplay feature that spans multiple systems
- Running a sprint planning or retrospective session
- Coordinating a multi-agent team for a complex feature (combat, narrative,
  level design, audio, UI, polish, release)
- Performing game-specific audits (asset compliance, balance, performance)
- Preparing for release (checklists, changelogs, patch notes, localisation)
- Prototyping a game mechanic in isolation
- Onboarding a new contributor to an existing game project

**Do NOT use this skill when:**

- The task is general-purpose software development with no game engine involvement
- You need web application, API, or infrastructure work unrelated to games
- The project uses a non-supported engine (use engine-specific skills instead)
- You need only a single quick code edit with no design or architecture context
- The task is purely documentation for a non-game project

---

## Engine Support Matrix

| Engine | Version | Availability | Binary | Notes |
|--------|---------|-------------|--------|-------|
| **Godot** | 4.6.1 | Native (installed) | `godot` | Full support. Headless mode available. GDScript, C#, GDExtension. |
| **Blender** | 5.0.1 | Native (installed) | `blender` | Asset pipeline. Modelling, texturing, animation export. |
| **Unity** | 2023+ | External MCP | -- | Requires external MCP server connection. Not installable in container. |
| **Unreal** | 5.x | External MCP | -- | Requires external MCP server connection. Not installable in container. |

### Godot (Native)

Godot 4.6.1 is installed and available on `$PATH` as `godot`. It supports:

- Headless execution: `godot --headless --script res://tests/run_tests.gd`
- Project validation: `godot --headless --check-only`
- Scene export: `godot --headless --export-release`
- GDScript, C#, and GDExtension (C/C++/Rust via gdext)
- VNC display at `:1` for visual testing when needed

The engine reference directory (`engine-reference/godot/`) contains version-pinned
API documentation, breaking changes from 4.4 through 4.6, deprecated APIs, and
current best practices. Because the LLM knowledge cutoff predates Godot 4.4,
always cross-reference this directory before suggesting Godot API calls.

### Blender (Native)

Blender 5.0.1 is installed for the asset pipeline. Use it for:

- 3D model creation and editing
- Texture baking and UV mapping
- Animation authoring and export (glTF, FBX, Collada)
- Headless rendering: `blender --background --python script.py`

### Unity and Unreal (External)

Unity and Unreal Engine cannot be installed inside this container. They require
a host machine or external MCP server. See [External MCP Requirements](#external-mcp-requirements).

---

## Available Workflows

All workflows are invoked as `/game-dev <command>`. Each workflow loads the
corresponding skill definition and orchestrates the appropriate agents.

### Onboarding and Setup

| Command | Description |
|---------|-------------|
| `/game-dev start` | First-time onboarding. Detects project state, asks where you are, guides you to the right workflow. No assumptions made. |
| `/game-dev setup-engine` | Configure engine, language, rendering backend, physics, naming conventions, and performance budgets. Writes to technical preferences. |
| `/game-dev onboard` | Contextual onboarding for contributors joining an existing project. Summarises architecture, conventions, and current sprint state. |
| `/game-dev project-stage-detect` | Automatically detect the current project stage (concept, pre-production, production, polish, release) from file system artefacts. |

### Design and Ideation

| Command | Description |
|---------|-------------|
| `/game-dev brainstorm` | Guided game concept ideation using professional studio techniques. From zero idea to a structured game concept document. Accepts an optional genre/theme hint. |
| `/game-dev design-system` | Author a Game Design Document section for a specific system. Follows the 8-section template (Overview, Player Fantasy, Rules, Formulas, Edge Cases, Dependencies, Tuning Knobs, Acceptance Criteria). |
| `/game-dev design-review` | Review existing design documents for completeness, internal consistency, and implementability. |
| `/game-dev map-systems` | Map dependencies between game systems. Produces a dependency graph showing which systems affect which others. |

### Implementation

| Command | Description |
|---------|-------------|
| `/game-dev prototype` | Rapid prototyping in an isolated `prototypes/` directory. Relaxed coding standards. Produces throwaway code and a structured prototype report answering a specific design question. |
| `/game-dev code-review` | Architecture and code quality review. Checks adherence to project coding rules, engine best practices, and performance budgets. |
| `/game-dev architecture-decision` | Create an Architecture Decision Record (ADR). Documents the context, options considered, decision made, and consequences. |
| `/game-dev hotfix` | Emergency fix workflow for critical bugs. Bypasses normal sprint process. Creates a hotfix branch, implements the fix, and prepares a patch. |
| `/game-dev reverse-document` | Generate design documentation from existing source code. Analyses implementation to produce retroactive GDD sections. |

### Production Management

| Command | Description |
|---------|-------------|
| `/game-dev sprint-plan` | Sprint planning session. Reviews backlog, estimates effort, assigns tasks to agents, and produces a sprint plan document. |
| `/game-dev estimate` | Task effort estimation. Analyses a feature description and produces time/complexity estimates with confidence ranges. |
| `/game-dev scope-check` | Scope creep analysis. Compares current feature set against original design pillars and flags additions that were not in the original plan. |
| `/game-dev gate-check` | Phase gate validation. Verifies that all criteria for the current development phase are met before advancing to the next. |
| `/game-dev milestone-review` | Milestone progress review. Aggregates completion status across all active features and flags at-risk items. |
| `/game-dev retrospective` | Sprint retrospective. Structured reflection on what went well, what went poorly, and action items for the next sprint. |
| `/game-dev tech-debt` | Technical debt tracking. Identifies, categorises, and prioritises technical debt items across the codebase. |

### Quality Assurance

| Command | Description |
|---------|-------------|
| `/game-dev perf-profile` | Performance profiling workflow. Measures frame time, draw calls, memory usage, and identifies bottlenecks against configured budgets. |
| `/game-dev asset-audit` | Asset compliance audit. Checks all assets against naming conventions, size budgets, format requirements, and import settings. |
| `/game-dev balance-check` | Game balance analysis. Reviews formulas, tuning knobs, and economy data for exploits, dead strategies, and progression issues. |
| `/game-dev bug-report` | Structured bug reporting. Produces a standardised bug report with reproduction steps, expected vs actual behaviour, severity, and affected systems. |
| `/game-dev playtest-report` | Playtest feedback structure. Organises raw playtest observations into categorised, actionable feedback with priority rankings. |

### Release

| Command | Description |
|---------|-------------|
| `/game-dev release-checklist` | Pre-release validation. Runs through a comprehensive checklist covering builds, tests, assets, performance, localisation, and platform requirements. |
| `/game-dev launch-checklist` | Full launch readiness review. Extends release-checklist with marketing, store page, community, analytics, and post-launch support preparation. |
| `/game-dev changelog` | Auto-generate changelogs from git history and design documents. Groups changes by system and impact level. |
| `/game-dev patch-notes` | Player-facing patch notes. Translates technical changelogs into clear, engaging language for the player community. |
| `/game-dev localize` | Localisation workflow. Extracts translatable strings, manages translation files, validates completeness, and checks for string truncation in UI. |

### Team Orchestration

Team workflows spawn multiple agents as a coordinated unit, running them through
a phased pipeline with user approval gates between phases. Each team workflow
uses the Task tool to launch agents in parallel where the pipeline allows it.

| Command | Description | Agents Involved |
|---------|-------------|-----------------|
| `/game-dev team-combat` | Combat feature team. Design, implement, and validate a combat mechanic end-to-end. | game-designer, gameplay-programmer, ai-programmer, technical-artist, sound-designer, qa-tester |
| `/game-dev team-narrative` | Story and world team. Author narrative content, world-building, and dialogue systems. | narrative-director, writer, world-builder, sound-designer, localization-lead |
| `/game-dev team-level` | Level design team. Design, block out, populate, and validate a game level. | level-designer, world-builder, gameplay-programmer, technical-artist, qa-tester |
| `/game-dev team-audio` | Audio pipeline team. Design and implement the audio system for a feature or area. | audio-director, sound-designer, gameplay-programmer, technical-artist |
| `/game-dev team-ui` | UI/UX team. Design, implement, and validate a user interface feature. | ux-designer, ui-programmer, art-director, accessibility-specialist, qa-tester |
| `/game-dev team-polish` | Polish and optimisation team. Performance tuning, visual polish, and bug fixing. | performance-analyst, technical-artist, gameplay-programmer, qa-tester |
| `/game-dev team-release` | Release deployment team. Build, test, package, and deploy a release candidate. | release-manager, devops-engineer, qa-lead, community-manager |

---

## Agent Roster

48 agents organised into 8 departments. Each agent has a dedicated template in
the `agents/` subdirectory.

### Leadership (3 agents)

| Agent | Role |
|-------|------|
| `creative-director` | Overall creative vision. Resolves design conflicts. Approves game pillars, art direction, and narrative tone. |
| `technical-director` | Overall technical vision. Resolves technical conflicts. Approves architecture decisions and technology choices. |
| `producer` | Project management. Sprint planning, milestone tracking, cross-department coordination, risk management. |

### Design (9 agents)

| Agent | Role |
|-------|------|
| `game-designer` | Core mechanics design. Authors GDD sections, defines formulas, specifies acceptance criteria. |
| `systems-designer` | System-level design. Inter-system dependencies, economy balance, progression curves. |
| `level-designer` | Level layouts, encounter pacing, spatial flow, collectible placement, difficulty curves. |
| `world-builder` | World lore, geography, environment storytelling, biome design. |
| `narrative-director` | Story arc structure, character development, dialogue system design, branching logic. |
| `writer` | Dialogue authoring, lore entries, item descriptions, UI text, bark lines. |
| `economy-designer` | In-game economy. Resource sinks/faucets, pricing models, reward schedules, inflation control. |
| `ux-designer` | Player experience flows, menu hierarchy, input mapping, accessibility, onboarding sequences. |
| `prototyper` | Rapid throwaway prototypes. Validates design hypotheses with minimal code. |

### Programming (7 agents)

| Agent | Role |
|-------|------|
| `lead-programmer` | Code architecture oversight. Reviews PRs, enforces coding standards, resolves technical disputes. Alias for senior programming guidance. |
| `gameplay-programmer` | Gameplay systems implementation. Combat, movement, abilities, inventory, crafting. |
| `ai-programmer` | NPC/enemy AI. Behaviour trees, utility AI, pathfinding, group tactics, state machines. |
| `engine-programmer` | Core engine systems. Rendering pipeline, physics integration, resource management, platform abstraction. |
| `network-programmer` | Multiplayer networking. Client-server architecture, state synchronisation, lag compensation, anti-cheat. |
| `tools-programmer` | Editor tools, build pipeline, asset importers, debug utilities, profiling harnesses. |
| `ui-programmer` | UI implementation. HUD, menus, popups, animations, data binding, localisation integration. |

### Art and Technical Art (2 agents)

| Agent | Role |
|-------|------|
| `art-director` | Visual style guide, asset quality standards, colour palette, composition rules. |
| `technical-artist` | Shaders, VFX, particle systems, LOD setup, material authoring, art-to-engine pipeline. |

### Audio (2 agents)

| Agent | Role |
|-------|------|
| `audio-director` | Audio vision, mix strategy, music direction, adaptive audio design. |
| `sound-designer` | Sound effect creation, audio event implementation, ambient soundscapes, foley. |

### Quality Assurance (3 agents)

| Agent | Role |
|-------|------|
| `qa-lead` | Test strategy, test plan authoring, regression suite management, release sign-off. |
| `qa-tester` | Test case execution, bug reproduction, exploratory testing, smoke testing. |
| `performance-analyst` | Frame profiling, memory analysis, draw call auditing, load time measurement, budget enforcement. |

### Production (8 agents)

| Agent | Role |
|-------|------|
| `release-manager` | Build pipeline, version tagging, platform submission, release notes. |
| `devops-engineer` | CI/CD, build servers, automated testing infrastructure, deployment scripting. |
| `analytics-engineer` | Telemetry design, data pipeline, player behaviour dashboards, A/B test framework. |
| `community-manager` | Player communication, patch note drafting, feedback triage, social media. |
| `accessibility-specialist` | WCAG compliance, input remapping, subtitle systems, colour-blind modes, screen reader support. |
| `localization-lead` | Translation pipeline, string extraction, locale testing, cultural adaptation. |
| `live-ops-designer` | Post-launch content cadence, seasonal events, daily challenges, live balance tuning. |
| `security-engineer` | Anti-cheat, save file integrity, network security, input validation, exploit prevention. |

### Engine Specialists (14 agents)

#### Godot (4 agents)

| Agent | Role |
|-------|------|
| `godot-specialist` | Godot architecture, scene tree patterns, autoloads, project settings, export configuration. |
| `godot-gdscript-specialist` | GDScript idioms, typed arrays, coroutines, signal patterns, resource classes. |
| `godot-gdextension-specialist` | GDExtension C/C++/Rust bindings, build configuration, hot reloading, native performance. |
| `godot-shader-specialist` | Godot shader language, visual shaders, post-processing, compute shaders, canvas items. |

#### Unity (5 agents)

| Agent | Role |
|-------|------|
| `unity-specialist` | Unity architecture, MonoBehaviour lifecycle, ScriptableObjects, assembly definitions. |
| `unity-dots-specialist` | ECS, Jobs, Burst compiler, chunk iteration, archetypes, structural changes. |
| `unity-shader-specialist` | Shader Graph, URP/HDRP, custom render passes, compute shaders, VFX Graph. |
| `unity-ui-specialist` | UI Toolkit, UGUI, runtime bindings, USS styling, custom controls. |
| `unity-addressables-specialist` | Asset bundles, remote content, catalogue management, memory profiling, download strategies. |

#### Unreal (5 agents)

| Agent | Role |
|-------|------|
| `unreal-specialist` | Unreal architecture, subsystems, plugins, modules, UObject lifecycle, GC. |
| `ue-blueprint-specialist` | Blueprint visual scripting, BP/C++ interface, nativisation, debugging. |
| `ue-gas-specialist` | Gameplay Ability System. Abilities, effects, attribute sets, tags, prediction. |
| `ue-umg-specialist` | UMG widget design, data binding, animations, common UI patterns. |
| `ue-replication-specialist` | Unreal networking. Replication, RPCs, relevancy, dormancy, replay system. |

---

## Coding Rules

11 rule files are bundled in the `rules/` subdirectory. Each rule targets a
specific file path pattern and is enforced when agents operate on matching files.

### gameplay-code (`src/gameplay/**`)

- All gameplay values from external config, never hardcoded
- Delta time for all time-dependent calculations
- No direct UI references; use events/signals
- State machines require explicit transition tables
- Unit tests for all gameplay logic
- Dependency injection over singletons

### shader-code (`assets/shaders/**`)

- Performance budgets per shader pass
- Document all uniforms with type and range
- Fallback shaders for lower-end hardware
- No branching in fragment shaders where avoidable
- Vertex/fragment split must be justified

### ui-code (`src/ui/**`)

- UI must never own or modify game state; display only
- Events/commands to request state changes
- All text through localisation system, never hardcoded strings
- Accessibility requirements on all interactive elements
- Responsive layout for multiple resolutions

### network-code (`src/networking/**`)

- Server authoritative for all gameplay-critical state
- Never trust client input; validate everything server-side
- Bandwidth budgets per message type
- Lag compensation documented per system
- Deterministic simulation where possible

### ai-code (`src/ai/**`)

- 2ms per frame maximum AI update budget
- Behaviour trees over state machines for complex AI
- Debug visualisation for all AI decisions
- Configurable difficulty through data, not code branches
- LOD system for off-screen AI

### engine-code (`src/core/**`)

- Zero allocations in hot paths (update, render, physics)
- Pre-allocate, pool, and reuse
- Thread safety documented on every public API
- Platform abstraction for OS-specific code
- Profiling hooks on all major subsystems

### prototype-code (`prototypes/**`)

- Relaxed standards; code is throwaway
- Every file must begin with `// PROTOTYPE - NOT FOR PRODUCTION`
- Hardcoded values permitted
- No requirement for tests or error handling
- Must never be imported from `src/`

### test-standards (`tests/**`)

- Naming: `test_[system]_[scenario]_[expected_result]`
- Arrange-Act-Assert structure
- No test interdependencies
- Mock external systems
- Performance tests with explicit budget assertions

### data-files (`assets/data/**`)

- All JSON must be valid; broken JSON blocks the build
- Schema validation for all data files
- Version field in all data schemas
- No executable logic in data files
- Human-readable formatting with comments where the format supports them

### narrative (`design/narrative/**`)

- Cross-reference all new lore against existing lore for contradictions
- Character voice consistency checks
- Branching dialogue must define all paths including dead ends
- Cultural sensitivity review for localised content

### design-docs (`design/gdd/**`)

- Every document must contain 8 required sections: Overview, Player Fantasy,
  Detailed Rules, Formulas, Edge Cases, Dependencies, Tuning Knobs,
  Acceptance Criteria
- Balance values must link to their source formula or rationale
- All mechanics in dedicated documents
- Markdown format only

---

## Collaborative Design Principle

This skill enforces a user-driven collaboration model. Agents act as expert
consultants; the user is the creative director with final decision authority.

### Workflow Pattern

Every non-trivial interaction follows:

```
Question -> Options -> Decision -> Draft -> Approval
```

1. **Question**: The agent asks clarifying questions to understand the
   requirement. It does not assume intent.

2. **Options**: The agent researches and presents 2-4 options with trade-offs
   explained. Each option is labelled for easy selection.

3. **Decision**: The user selects an option or provides direction. The agent
   does not proceed without this.

4. **Draft**: The agent produces a draft (design doc section, code, config)
   and presents it for review.

5. **Approval**: The user approves, requests changes, or rejects. The agent
   asks "May I write this to [filepath]?" before using Write/Edit tools.
   Multi-file changes require explicit approval for the full changeset.

### Enforcement Rules

- Agents must never write files without asking first
- Agents must show drafts or summaries before requesting approval
- No commits without user instruction
- No unilateral cross-domain changes (an agent must not modify files outside
  its designated directories without explicit delegation)

---

## External MCP Requirements

Unity and Unreal Engine require a running instance on a host machine with an
MCP server bridge. The container cannot run these engines natively.

### Unity External MCP Setup

1. Install Unity on the host machine (2023.x LTS or later recommended).

2. Install the Unity MCP bridge package. This exposes Unity Editor operations
   (scene manipulation, asset import, build, play mode) as MCP tool calls.

3. Configure the MCP connection in the container:

   ```json
   {
     "mcpServers": {
       "unity": {
         "type": "sse",
         "url": "http://<host-ip>:<port>/mcp",
         "description": "Unity Editor MCP bridge"
       }
     }
   }
   ```

4. Unity-specialist agents will detect the MCP connection and route engine
   operations through it. Without this connection, Unity agents can still
   produce code and configuration files but cannot interact with the editor
   directly.

### Unreal External MCP Setup

1. Install Unreal Engine 5.x on the host machine.

2. Install the Unreal MCP bridge plugin. This exposes editor operations
   (Blueprint compilation, level loading, PIE, packaging) as MCP tool calls.

3. Configure the MCP connection in the container:

   ```json
   {
     "mcpServers": {
       "unreal": {
         "type": "sse",
         "url": "http://<host-ip>:<port>/mcp",
         "description": "Unreal Editor MCP bridge"
       }
     }
   }
   ```

4. Unreal-specialist agents will detect the MCP connection and route engine
   operations through it. Without this connection, Unreal agents can still
   produce C++ code, Blueprint pseudocode, and configuration but cannot
   interact with the editor.

### Verifying MCP Connections

After configuration, verify the connection is active:

```bash
# Check MCP server status
claude-flow mcp status
```

If the external MCP is not available, agents will fall back to file-only mode:
generating source files, configs, and documentation that can be manually
imported into the engine on the host machine.

---

## Godot Headless Testing

Godot 4.6.1 supports headless execution for automated testing and validation
without a display server. This is the primary method for CI and agent-driven
testing.

### Running GDScript Tests

```bash
# Run a test script
godot --headless --script res://tests/run_tests.gd

# Run with specific scene
godot --headless --path /path/to/project res://tests/test_scene.tscn

# Validate project (check for errors without running)
godot --headless --check-only --path /path/to/project
```

### Test Script Pattern

```gdscript
# tests/run_tests.gd
extends SceneTree

func _init() -> void:
    var results := []
    # Run test suites
    results.append(TestCombatSystem.run())
    results.append(TestInventorySystem.run())

    # Report
    var failures := results.filter(func(r): return not r.passed)
    if failures.is_empty():
        print("ALL TESTS PASSED")
    else:
        for f in failures:
            printerr("FAIL: %s - %s" % [f.name, f.message])
    quit(0 if failures.is_empty() else 1)
```

### Visual Testing via VNC

When visual verification is required (shader output, UI layout, particle
effects), use the VNC display:

```bash
# Run Godot with display output on VNC
DISPLAY=:1 godot --path /path/to/project res://scenes/test_visual.tscn
```

Connect to VNC on port 5901 to observe the output. Take screenshots with
the browser automation tools for visual regression comparison.

### Export Validation

```bash
# Dry-run export to check for errors
godot --headless --export-release "Linux" /tmp/test_export

# List available export presets
godot --headless --path /path/to/project --list-exports
```

---

## Context Management

Game development sessions tend to be long and context-heavy. Active context
management prevents degradation.

### Session State File

Maintain `production/session-state/active.md` as a living checkpoint. Update
it after each significant milestone:

- Design section approved and written to file
- Architecture decision made
- Implementation milestone reached
- Test results obtained

The state file should contain: current task, progress checklist, key decisions
made, files being worked on, and open questions.

### Incremental File Writing

When creating multi-section documents (GDDs, architecture docs, lore entries):

1. Create the file immediately with a skeleton (all section headers, empty bodies)
2. Discuss and draft one section at a time in conversation
3. Write each section to the file as soon as it is approved
4. Update the session state file after each section
5. After writing a section, previous discussion about that section can be
   safely compacted -- the decisions are preserved in the file

This keeps the context window holding only the current section's discussion
(approximately 3-5k tokens) instead of the entire document's conversation
history (30-50k tokens).

### Compaction Strategy

- Compact proactively at 60-70% context usage, not reactively at the limit
- Use `/clear` between unrelated tasks or after 2+ failed correction attempts
- Natural compaction points: after writing a section to file, after committing,
  after completing a task, before starting a new topic
- Focused compaction: `/compact Focus on [current task] -- sections 1-3 are
  written to file, working on section 4`

### Recovery After Session Crash

1. Read `production/session-state/active.md` to recover state
2. Read the partially-completed files listed in the state
3. Continue from the next incomplete section or task

The file is the memory, not the conversation. Conversations are ephemeral and
will be compacted or lost. Files on disk persist across compactions and session
crashes.

### Context Budgets by Task Type

| Task Type | Budget |
|-----------|--------|
| Light (read/review) | ~3k tokens startup |
| Medium (implement feature) | ~8k tokens |
| Heavy (multi-system refactor) | ~15k tokens |

### Subagent Delegation

Use subagents for research and exploration to keep the main session clean.
Subagents run in their own context window and return only summaries:

- Use subagents when investigating across multiple files, exploring unfamiliar
  code, or doing research that would consume more than 5k tokens of file reads
- Use direct reads when you know exactly which 1-2 files to check
- Subagents do not inherit conversation history -- provide full context in
  the prompt

---

## Project Directory Structure

```
project-root/
  CLAUDE.md                    # Master configuration (generated by /start)
  .claude/                     # Agent definitions, skills, hooks, rules, docs
  src/                         # Game source code
    core/                      # Engine-level code
    gameplay/                  # Gameplay systems
    ai/                        # AI/NPC systems
    networking/                # Multiplayer code
    ui/                        # UI implementation
    tools/                     # Editor and pipeline tools
  assets/                      # Game assets
    art/                       # Visual assets
    audio/                     # Sound and music
    vfx/                       # Visual effects
    shaders/                   # Shader files
    data/                      # Data-driven config (JSON, resources)
  design/                      # Game design documents
    gdd/                       # Game Design Documents
    narrative/                 # Story, lore, dialogue
    levels/                    # Level design docs
    balance/                   # Economy and balance sheets
  docs/                        # Technical documentation
    architecture/              # ADRs and architecture docs
    api/                       # API reference
    postmortems/               # Sprint/feature postmortems
    engine-reference/          # Version-pinned engine API snapshots
  tests/                       # Test suites
    unit/                      # Unit tests
    integration/               # Integration tests
    performance/               # Performance benchmarks
    playtest/                  # Playtest reports
  tools/                       # Build and pipeline tools
    ci/                        # CI configuration
    build/                     # Build scripts
    asset-pipeline/            # Asset processing scripts
  prototypes/                  # Throwaway prototypes (isolated from src/)
  production/                  # Production management
    sprints/                   # Sprint plans and retrospectives
    milestones/                # Milestone definitions
    releases/                  # Release artefacts
    session-state/             # Ephemeral session state (gitignored)
    session-logs/              # Session audit trail (gitignored)
```

---

## Quick Reference

### Common Workflows by Project Phase

**Concept Phase:**
`/game-dev start` -> `/game-dev brainstorm` -> `/game-dev design-system` -> `/game-dev map-systems`

**Pre-Production:**
`/game-dev setup-engine` -> `/game-dev architecture-decision` -> `/game-dev prototype` -> `/game-dev sprint-plan`

**Production:**
`/game-dev team-*` workflows -> `/game-dev code-review` -> `/game-dev perf-profile` -> `/game-dev balance-check`

**Polish:**
`/game-dev team-polish` -> `/game-dev asset-audit` -> `/game-dev playtest-report` -> `/game-dev bug-report`

**Release:**
`/game-dev release-checklist` -> `/game-dev localize` -> `/game-dev changelog` -> `/game-dev patch-notes` -> `/game-dev launch-checklist`

**Post-Release:**
`/game-dev hotfix` -> `/game-dev retrospective` -> `/game-dev tech-debt` -> `/game-dev scope-check`
