# Agent Roster

48 agents organised into 8 departments. Each agent has a dedicated template in
the `agents/` subdirectory (relative to the skill directory).

Agents are organised in a hierarchical delegation model. Leadership agents
(creative-director, technical-director, producer) delegate to department leads,
who delegate to specialists. Agents at the same tier may consult each other but
should not make binding decisions outside their domain.

## Leadership (3 agents)

| Agent | Role |
|-------|------|
| `creative-director` | Overall creative vision. Resolves design conflicts. Approves game pillars, art direction, and narrative tone. |
| `technical-director` | Overall technical vision. Resolves technical conflicts. Approves architecture decisions and technology choices. |
| `producer` | Project management. Sprint planning, milestone tracking, cross-department coordination, risk management. |

## Design (9 agents)

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

## Programming (7 agents)

| Agent | Role |
|-------|------|
| `lead-programmer` | Code architecture oversight. Reviews PRs, enforces coding standards, resolves technical disputes. Alias for senior programming guidance. |
| `gameplay-programmer` | Gameplay systems implementation. Combat, movement, abilities, inventory, crafting. |
| `ai-programmer` | NPC/enemy AI. Behaviour trees, utility AI, pathfinding, group tactics, state machines. |
| `engine-programmer` | Core engine systems. Rendering pipeline, physics integration, resource management, platform abstraction. |
| `network-programmer` | Multiplayer networking. Client-server architecture, state synchronisation, lag compensation, anti-cheat. |
| `tools-programmer` | Editor tools, build pipeline, asset importers, debug utilities, profiling harnesses. |
| `ui-programmer` | UI implementation. HUD, menus, popups, animations, data binding, localisation integration. |

## Art and Technical Art (2 agents)

| Agent | Role |
|-------|------|
| `art-director` | Visual style guide, asset quality standards, colour palette, composition rules. |
| `technical-artist` | Shaders, VFX, particle systems, LOD setup, material authoring, art-to-engine pipeline. |

## Audio (2 agents)

| Agent | Role |
|-------|------|
| `audio-director` | Audio vision, mix strategy, music direction, adaptive audio design. |
| `sound-designer` | Sound effect creation, audio event implementation, ambient soundscapes, foley. |

## Quality Assurance (3 agents)

| Agent | Role |
|-------|------|
| `qa-lead` | Test strategy, test plan authoring, regression suite management, release sign-off. |
| `qa-tester` | Test case execution, bug reproduction, exploratory testing, smoke testing. |
| `performance-analyst` | Frame profiling, memory analysis, draw call auditing, load time measurement, budget enforcement. |

## Production (8 agents)

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

## Engine Specialists (14 agents)

### Godot (4 agents)

| Agent | Role |
|-------|------|
| `godot-specialist` | Godot architecture, scene tree patterns, autoloads, project settings, export configuration. |
| `godot-gdscript-specialist` | GDScript idioms, typed arrays, coroutines, signal patterns, resource classes. |
| `godot-gdextension-specialist` | GDExtension C/C++/Rust bindings, build configuration, hot reloading, native performance. |
| `godot-shader-specialist` | Godot shader language, visual shaders, post-processing, compute shaders, canvas items. |

### Unity (5 agents)

| Agent | Role |
|-------|------|
| `unity-specialist` | Unity architecture, MonoBehaviour lifecycle, ScriptableObjects, assembly definitions. |
| `unity-dots-specialist` | ECS, Jobs, Burst compiler, chunk iteration, archetypes, structural changes. |
| `unity-shader-specialist` | Shader Graph, URP/HDRP, custom render passes, compute shaders, VFX Graph. |
| `unity-ui-specialist` | UI Toolkit, UGUI, runtime bindings, USS styling, custom controls. |
| `unity-addressables-specialist` | Asset bundles, remote content, catalogue management, memory profiling, download strategies. |

### Unreal (5 agents)

| Agent | Role |
|-------|------|
| `unreal-specialist` | Unreal architecture, subsystems, plugins, modules, UObject lifecycle, GC. |
| `ue-blueprint-specialist` | Blueprint visual scripting, BP/C++ interface, nativisation, debugging. |
| `ue-gas-specialist` | Gameplay Ability System. Abilities, effects, attribute sets, tags, prediction. |
| `ue-umg-specialist` | UMG widget design, data binding, animations, common UI patterns. |
| `ue-replication-specialist` | Unreal networking. Replication, RPCs, relevancy, dormancy, replay system. |
