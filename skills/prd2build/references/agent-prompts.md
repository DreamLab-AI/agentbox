# prd2build — Agent Prompts & Execution Batch

The full set of agent prompts the skill spawns. This runs as ONE concurrent batch:
all documentation agents spawn together, work in parallel (foreground mode), and the
Task tool blocks until every agent completes. The Documentation Integrator runs last
and stitches the outputs into a single INDEX.md.

```javascript
// Initialize system (REQUIRED FIRST)
Bash("mkdir -p docs/{specification,ddd,adr,sparc,implementation/{milestones,epics,tasks},testing,design/mockups}")
Bash("npx @claude-flow/cli@latest init --no-color 2>/dev/null || true")
Bash("npx @claude-flow/cli@latest memory init --force --no-color 2>/dev/null || true")

// Spawn ALL documentation agents in PARALLEL (foreground mode)
// They all run concurrently and block until ALL complete

Task("researcher", `
Read PRD from arguments above.

Generate docs/specification/:
- requirements.md (REQ-XXX IDs, functional requirements)
- non-functional.md (performance, security, scalability targets)
- user-stories.md (As a [role], I want [goal], so that [benefit])
- user-journeys.md (actor definitions, user flows, use cases)
- api-contracts.md (OpenAPI-style endpoint specs)
- security-model.md (threat model, auth/authz, data classification)
- edge-cases.md (boundary conditions)
- constraints.md (technical and business limits)
- glossary.md (domain terminology)

Extract:
- All requirements with unique IDs
- All actors and their goals
- All API endpoints
- Security requirements (auth methods, encryption, compliance)

MINIMUM QUALITY BARS:
- 8+ specification files
- 15+ user stories (for any real project)
- 10+ API endpoints (if API-based)
- Security model >50 lines (substantial, not just headers)

Store key entities in memory for other agents.
`, "researcher")

Task("ui-designer", `
Read PRD and requirements.md.

CRITICAL: Check for existing style guides BEFORE generating:
- If docs/specification/style-guide.md exists → READ and REUSE it, DO NOT overwrite
- If docs/specification/style-guide.html exists → READ and REUSE it, DO NOT overwrite

Generate design artifacts:
1. docs/specification/wireframes.md (ASCII wireframes, all major screens)
2. docs/specification/style-guide.md (colors, typography, spacing) - ONLY if not exists
3. docs/specification/style-guide.html (interactive visual guide) - ONLY if not exists
4. docs/design/mockups/*.html (pixel-perfect mockups with dark/light toggle)

Color selection (3-tier priority):
1. TIER 0: Check existing (tailwind.config.js, design-tokens.css) → USE THOSE
2. TIER 1: PRD mentions (brand colors, competitor refs) → USE THOSE
3. TIER 2: Domain psychology (healthcare=blue, finance=navy, ecommerce=neutral)
4. TIER 3: Generate 3 options with rationale if unclear

Typography: Use Google Fonts appropriate for domain.

Accessibility: WCAG 2.1 AA compliance, keyboard nav, screen reader support.

Store design tokens in memory.
`, "ui-designer")

Task("code-analyzer", `
Read PRD and requirements.md from memory.

Generate docs/ddd/:
- domain-model.md (strategic design overview)
- bounded-contexts.md (context boundaries, responsibilities)
- context-map.md (relationships between contexts with diagram)
- ubiquitous-language.md (per-context terminology)
- aggregates.md (aggregate roots, consistency boundaries)
- entities.md (domain entities with identity)
- value-objects.md (immutable value objects)
- domain-events.md (event catalogue with triggers)
- sagas.md (long-running processes, compensating transactions)
- repositories.md (repository interfaces)
- services.md (domain and application services)
- database-schema.md (complete schema with migrations)
- migrations/XXX.sql (numbered migration files)

MINIMUM DDD ARTIFACTS:
- 3+ bounded contexts (Core + Supporting + Generic)
- 5+ aggregates (1-2 per context)
- 8+ entities (aggregates + children)
- 10+ value objects (Money, Email, Status, etc.)
- 6+ domain events (1 per aggregate transition)
- 5+ repositories (1 per aggregate root)
- 4+ services (domain + application)

Generate SQL migrations from aggregates (1 migration per aggregate).

Store aggregate list in memory.
`, "code-analyzer")

Task("System Architect", `
Read PRD, requirements, DDD artifacts from memory.

Generate docs/adr/:
- index.md (ADR registry with dependency graph)
- ADR-001.md through ADR-027.md MINIMUM (each as SEPARATE file)

REQUIRED ADR TOPICS (1 ADR per topic = 27 minimum):
- Architecture (3): system style, module boundaries, deployment
- Database (3): technology, schema design, multi-tenancy
- API (3): design style (REST/GraphQL), versioning, error handling
- Security (4): authentication, authorization, RLS, secrets
- Infrastructure (2): deployment architecture, CDN/storage
- Integration (3): payment/email/storage providers
- Frontend (3): UI framework, state management, component lib
- Testing (3): strategy, coverage targets, E2E approach
- Observability (3): logging, monitoring, error tracking

PLUS: Additional ADRs for PRD-specific decisions.

Each ADR = separate file. Enhanced template with metadata, alternatives, impact radius.

CRITICAL: DO NOT create just index.md. CREATE ALL INDIVIDUAL ADR FILES.

Before claiming done: ls docs/adr/ADR-*.md | wc -l (must be ≥27)

Store ADR index in memory.
`, "system-architect")

Task("SPARC Coordinator", `
Read PRD, requirements, DDD, ADR from memory.

Generate docs/sparc/:
- 01-specification.md (detailed specs with acceptance criteria)
- 02-pseudocode.md (algorithms, logic flows, data structures)
- 03-architecture.md (component diagram, service boundaries, tech stack)
- 04-refinement.md (TDD strategy, refactoring, quality metrics)
- 05-completion.md (integration tests, deployment, CI/CD, handoff)
- traceability-matrix.md (Requirement → Pseudocode → Architecture → Code → Test)

Create end-to-end traceability showing how every requirement flows through design to code.
`, "sparc-coord")

Task("Implementation Planner", `
Read ALL prior documentation from memory.

Generate docs/implementation/:
- roadmap.md (phased delivery plan)
- dependency-graph.md (task dependencies, critical path)
- risks.md (risk register with mitigation)
- definition-of-done.md (DoD templates per task type)

Generate docs/implementation/milestones/:
- M0-foundation.md (infrastructure, database, auth)
- M1-mvp.md (minimum viable product features)
- M2-release.md (full v1.0 release)
- M3-enhanced.md (post-release improvements)

Generate docs/implementation/epics/:
- EPIC-XXX-[name].md (one file per business feature)

Generate docs/implementation/tasks/:
- index.md (task registry with status tracking)
- TASK-XXX-[name].md (one file per atomic technical task)

Each task MUST reference:
- Related requirements (REQ-XXX)
- Related user stories (US-XXX)
- Related ADRs (ADR-XXX)
- Related DDD artifacts (Aggregate, Service, etc.)
- Dependencies (other TASK-XXX)

MINIMUM TASKS: 20+ (real projects need more)

Store task count and relationships in memory.
`, "task-orchestrator")

Task("Test Strategist", `
Read requirements, DDD, and tasks from memory.

Generate docs/testing/:
- test-strategy.md (test pyramid, coverage targets, tools)
- test-cases.md (test specifications per requirement)
- test-data-requirements.md (fixtures, seeds, mocks)
- tdd-approach.md (TDD workflow per bounded context)

Map every requirement to test cases.
Define test data factories for all entities.
`, "tester")

Task("Documentation Integrator", `
CRITICAL: This agent runs LAST and creates the unified index.

Wait for all other agents to complete, then:

1. Read ALL generated documentation:
   - docs/specification/ (all files)
   - docs/ddd/ (all files)
   - docs/adr/ (all ADR files)
   - docs/sparc/ (all files)
   - docs/implementation/ (milestones, epics, tasks)
   - docs/testing/ (all files)

2. Count all artifacts:
   - Total milestones, epics, tasks
   - Total ADRs, bounded contexts, aggregates
   - Total requirements, user stories, API endpoints

3. Extract relationships:
   - Parse "Related ADRs:" from each task
   - Parse "DDD Artifacts:" from each task
   - Parse "Requirements:" from each task
   - Parse "Dependencies:" from each task
   - Build dependency graph

4. Calculate metrics:
   - Total effort (sum task durations)
   - Critical path (longest dependency chain)
   - Complexity distribution

5. Generate docs/implementation/INDEX.md with:
   - Overview & statistics
   - Milestone breakdown (with epic lists)
   - Epic breakdown (with task lists)
   - Task reference tables (by epic, by ADR, by bounded context)
   - Complete traceability matrix (REQ → US → DDD → ADR → Task → Test)
   - Dependency graph (Mermaid)
   - Quick start guide
   - Progress tracking commands

6. Generate docs/README.md:
   - Navigation to all documentation sections
   - Quick links to major documents
   - How to read the docs
   - Glossary of abbreviations

OUTPUT FILES REQUIRED:
- docs/implementation/INDEX.md (THE SINGLE ENTRY POINT)
- docs/README.md (documentation navigator)

VERIFICATION:
- INDEX.md exists and >400 lines
- All milestones appear in INDEX.md
- All epics appear in INDEX.md
- All tasks appear in INDEX.md
- Traceability matrix complete
- README.md has links to all sections

This INDEX.md becomes THE SINGLE SOURCE OF TRUTH for implementation.
`, "planner")

// That's it. All agents spawn together, run in parallel, complete when done.
```

## Build execution (only if `--build` is present)

When the `--build` flag is passed, documentation generates first, then a mesh swarm
executes the build following all ADRs and DDD artifacts. These agents run in the
**background** and coordinate peer-to-peer via the mesh topology.

```javascript
// Check if --build flag was provided
if ("$ARGUMENTS" includes "--build") {

  // Step 1: Initialize swarm with mesh topology
  Bash("npx @claude-flow/cli@latest swarm init --topology mesh --strategy adaptive --no-color 2>/dev/null || true")

  // Step 2: Spawn build swarm agents in BACKGROUND (parallel execution)
  // They will execute the build using all ADRs and DDDrs as reference

  Task("Build Coordinator", `
    Read ALL documentation:
    - docs/adr/ (all ADRs for architectural decisions)
    - docs/ddd/ (all DDD artifacts for domain understanding)
    - docs/implementation/INDEX.md (task execution order)

    Coordinate the build swarm by:
    1. Parsing all ADRs to understand architectural constraints
    2. Understanding DDD bounded contexts and aggregates
    3. Creating execution plan from INDEX.md tasks
    4. Delegating work to specialized agents

    Store build plan in memory for other agents.
  `, "hierarchical-coordinator", run_in_background: true)

  Task("Foundation Builder", `
    Read ADR-001 (system architecture), ADR-004 (database), ADR-007 (auth).

    Execute M0-foundation tasks:
    - Project setup and structure (per ADR-001)
    - Database schema and migrations (per ADR-004, DDD aggregates)
    - Authentication system (per ADR-007)

    Verify each task against related ADRs and DDD artifacts.
  `, "coder", run_in_background: true)

  Task("Feature Implementer", `
    Read all ADRs, DDD bounded contexts, and implementation tasks.

    Execute M1-MVP feature tasks:
    - Core business logic per bounded contexts
    - API endpoints per API ADRs
    - Domain services per DDD services

    Follow INDEX.md task order and dependencies.
  `, "backend-dev", run_in_background: true)

  Task("Frontend Builder", `
    Read ADR-017 (UI framework), ADR-018 (state management), wireframes, style guide.

    Execute frontend tasks:
    - Component library setup (per ADR-017)
    - State management (per ADR-018)
    - UI screens per wireframes and mockups

    Match design tokens from style-guide.md.
  `, "ui-designer", run_in_background: true)

  Task("Test Implementer", `
    Read test strategy and ADR-022 (testing strategy).

    Execute test implementation:
    - Unit tests per bounded context
    - Integration tests per aggregate
    - E2E tests per user journey

    Achieve coverage targets from test-strategy.md.
  `, "tester", run_in_background: true)

  Task("Quality Verifier", `
    Read all ADRs and verify compliance:
    - Security per ADR-010 through ADR-013
    - Performance per ADR-005 through ADR-006
    - API contracts per ADR-008 through ADR-009

    Run linting, type checking, and security scans.
    Report any ADR violations for remediation.
  `, "code-review-swarm", run_in_background: true)

  // All agents spawned in background - they work in parallel via mesh topology
  // Build coordinator orchestrates; others communicate peer-to-peer

  Tell user: "Build swarm launched (6 agents in mesh topology). They're executing the build following all ADRs and DDD artifacts. I'll monitor progress."

  // Wait for background agents to complete, then verify build success
  // The mesh topology allows agents to coordinate autonomously
}
```

## Concurrency model

- All 8 documentation agents spawn in ONE message.
- They execute in parallel (foreground mode); the Task tool blocks until ALL complete.
- Then INDEX.md is generated from their outputs.
- Total time: 5-10 minutes (depends on PRD size).

**No waves, no checkpoints** — spawn all → wait → generate index → done. No complex
verification between phases, no session checkpointing (not needed for docs), no retry
logic (if an agent fails, you see the error).

## Memory coordination

Agents share via memory:
- Specification agent stores requirements → DDD agent reads.
- DDD agent stores aggregates → Implementation planner reads.
- All outputs → INDEX generator reads and integrates.
