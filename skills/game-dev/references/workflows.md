# Available Workflows

All workflows are invoked as `/game-dev <command>`. Each workflow loads the
corresponding skill definition and orchestrates the appropriate agents.

## Onboarding and Setup

| Command | Description |
|---------|-------------|
| `/game-dev start` | First-time onboarding. Detects project state, asks where you are, guides you to the right workflow. No assumptions made. |
| `/game-dev setup-engine` | Configure engine, language, rendering backend, physics, naming conventions, and performance budgets. Writes to technical preferences. |
| `/game-dev onboard` | Contextual onboarding for contributors joining an existing project. Summarises architecture, conventions, and current sprint state. |
| `/game-dev project-stage-detect` | Automatically detect the current project stage (concept, pre-production, production, polish, release) from file system artefacts. |

## Design and Ideation

| Command | Description |
|---------|-------------|
| `/game-dev brainstorm` | Guided game concept ideation using professional studio techniques. From zero idea to a structured game concept document. Accepts an optional genre/theme hint. |
| `/game-dev design-system` | Author a Game Design Document section for a specific system. Follows the 8-section template (Overview, Player Fantasy, Rules, Formulas, Edge Cases, Dependencies, Tuning Knobs, Acceptance Criteria). |
| `/game-dev design-review` | Review existing design documents for completeness, internal consistency, and implementability. |
| `/game-dev map-systems` | Map dependencies between game systems. Produces a dependency graph showing which systems affect which others. |

## Implementation

| Command | Description |
|---------|-------------|
| `/game-dev prototype` | Rapid prototyping in an isolated `prototypes/` directory. Relaxed coding standards. Produces throwaway code and a structured prototype report answering a specific design question. |
| `/game-dev code-review` | Architecture and code quality review. Checks adherence to project coding rules, engine best practices, and performance budgets. |
| `/game-dev architecture-decision` | Create an Architecture Decision Record (ADR). Documents the context, options considered, decision made, and consequences. |
| `/game-dev hotfix` | Emergency fix workflow for critical bugs. Bypasses normal sprint process. Creates a hotfix branch, implements the fix, and prepares a patch. |
| `/game-dev reverse-document` | Generate design documentation from existing source code. Analyses implementation to produce retroactive GDD sections. |

## Production Management

| Command | Description |
|---------|-------------|
| `/game-dev sprint-plan` | Sprint planning session. Reviews backlog, estimates effort, assigns tasks to agents, and produces a sprint plan document. |
| `/game-dev estimate` | Task effort estimation. Analyses a feature description and produces time/complexity estimates with confidence ranges. |
| `/game-dev scope-check` | Scope creep analysis. Compares current feature set against original design pillars and flags additions that were not in the original plan. |
| `/game-dev gate-check` | Phase gate validation. Verifies that all criteria for the current development phase are met before advancing to the next. |
| `/game-dev milestone-review` | Milestone progress review. Aggregates completion status across all active features and flags at-risk items. |
| `/game-dev retrospective` | Sprint retrospective. Structured reflection on what went well, what went poorly, and action items for the next sprint. |
| `/game-dev tech-debt` | Technical debt tracking. Identifies, categorises, and prioritises technical debt items across the codebase. |

## Quality Assurance

| Command | Description |
|---------|-------------|
| `/game-dev perf-profile` | Performance profiling workflow. Measures frame time, draw calls, memory usage, and identifies bottlenecks against configured budgets. |
| `/game-dev asset-audit` | Asset compliance audit. Checks all assets against naming conventions, size budgets, format requirements, and import settings. |
| `/game-dev balance-check` | Game balance analysis. Reviews formulas, tuning knobs, and economy data for exploits, dead strategies, and progression issues. |
| `/game-dev bug-report` | Structured bug reporting. Produces a standardised bug report with reproduction steps, expected vs actual behaviour, severity, and affected systems. |
| `/game-dev playtest-report` | Playtest feedback structure. Organises raw playtest observations into categorised, actionable feedback with priority rankings. |

## Release

| Command | Description |
|---------|-------------|
| `/game-dev release-checklist` | Pre-release validation. Runs through a comprehensive checklist covering builds, tests, assets, performance, localisation, and platform requirements. |
| `/game-dev launch-checklist` | Full launch readiness review. Extends release-checklist with marketing, store page, community, analytics, and post-launch support preparation. |
| `/game-dev changelog` | Auto-generate changelogs from git history and design documents. Groups changes by system and impact level. |
| `/game-dev patch-notes` | Player-facing patch notes. Translates technical changelogs into clear, engaging language for the player community. |
| `/game-dev localize` | Localisation workflow. Extracts translatable strings, manages translation files, validates completeness, and checks for string truncation in UI. |

## Team Orchestration

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

## Common Workflows by Project Phase

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
