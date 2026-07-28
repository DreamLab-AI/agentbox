# prd2build — Output Structure, INDEX.md, Quality Bars & Customization

## Output structure

After execution, you get:

```
docs/
├── README.md                           # 📖 Start here - Navigation guide
├── implementation/
│   └── INDEX.md                        # 🎯 IMPLEMENTATION START HERE
│
├── specification/
│   ├── requirements.md                 # Functional requirements (REQ-XXX)
│   ├── non-functional.md               # NFRs (performance, security)
│   ├── user-stories.md                 # User stories (US-XXX)
│   ├── user-journeys.md                # Actor flows and use cases
│   ├── wireframes.md                   # UI wireframes (ASCII)
│   ├── style-guide.md                  # Design tokens, colors, typography
│   ├── style-guide.html                # Interactive visual style guide
│   ├── api-contracts.md                # API specifications (OpenAPI-style)
│   ├── security-model.md               # Threat model, auth/authz
│   ├── edge-cases.md                   # Boundary conditions
│   ├── constraints.md                  # Technical/business constraints
│   └── glossary.md                     # Domain terminology
│
├── design/
│   └── mockups/
│       ├── design-tokens.css           # Shared CSS variables
│       └── *.html                      # Mockups with dark/light toggle
│
├── ddd/
│   ├── domain-model.md                 # Strategic design
│   ├── bounded-contexts.md             # Context boundaries
│   ├── context-map.md                  # Context relationships
│   ├── ubiquitous-language.md          # Domain terminology
│   ├── aggregates.md                   # Aggregate roots
│   ├── entities.md                     # Domain entities
│   ├── value-objects.md                # Value objects
│   ├── domain-events.md                # Event catalogue
│   ├── sagas.md                        # Process managers
│   ├── repositories.md                 # Repository interfaces
│   ├── services.md                     # Domain/application services
│   ├── database-schema.md              # Complete schema
│   └── migrations/
│       └── *.sql                       # Numbered migrations
│
├── adr/
│   ├── index.md                        # ADR registry + dependency graph
│   ├── ADR-001-*.md                    # Architecture decisions
│   ├── ADR-002-*.md                    # (27+ individual files)
│   └── ...
│
├── sparc/
│   ├── 01-specification.md             # Detailed specifications
│   ├── 02-pseudocode.md                # Algorithms and logic
│   ├── 03-architecture.md              # System architecture
│   ├── 04-refinement.md                # TDD strategy
│   ├── 05-completion.md                # Integration & deployment
│   └── traceability-matrix.md          # Req → Implementation mapping
│
├── implementation/
│   ├── INDEX.md                        # 🎯 SINGLE ENTRY POINT
│   ├── roadmap.md                      # Master plan
│   ├── dependency-graph.md             # Task dependencies (DAG)
│   ├── risks.md                        # Risk register
│   ├── definition-of-done.md           # DoD templates
│   ├── milestones/
│   │   ├── M0-foundation.md
│   │   ├── M1-mvp.md
│   │   ├── M2-release.md
│   │   └── M3-enhanced.md
│   ├── epics/
│   │   └── EPIC-XXX-[name].md          # Business features
│   └── tasks/
│       ├── index.md                    # Task registry
│       └── TASK-XXX-[name].md          # Atomic tasks
│
└── testing/
    ├── test-strategy.md                # Test pyramid, coverage
    ├── test-cases.md                   # Test specs per requirement
    ├── test-data-requirements.md       # Fixtures and seeds
    └── tdd-approach.md                 # TDD workflow
```

## What you do next

1. **Read**: `docs/README.md` — understand the documentation.
2. **Review**: `docs/implementation/INDEX.md` — your implementation guide.
3. **Start building**: follow the tasks in order or use your own workflow.

No complex scripts, no guardian verification for docs — just clean, complete
documentation.

## Quality guarantees

Each generated document includes:
- ✅ Cross-references to related docs
- ✅ Traceability to PRD requirements
- ✅ No placeholder content (no TODO/TBD)
- ✅ Concrete decisions (no "we'll decide later")
- ✅ Complete coverage (minimums enforced)

**Minimum artifact counts** (auto-validated):
- 8+ specification files
- 27+ ADRs (one per architectural topic)
- 11+ DDD files
- 3+ bounded contexts
- 5+ aggregates
- 20+ tasks

If the PRD is too vague, agents make explicit assumptions and document them.

## INDEX.md contents

The generated INDEX.md provides:

### 1. Quick start
```markdown
## How to Implement This

### By Milestone
1. M0: Foundation (8 tasks, 3 days) - Setup, database, auth
2. M1: MVP (24 tasks, 12 days) - Core features
3. M2: Release (28 tasks, 18 days) - Full feature set
4. M3: Enhanced (12 tasks, 8 days) - Polish

### By Epic
- EPIC-001: Project setup (3 tasks)
- EPIC-002: Database schema (5 tasks)
- EPIC-003: Authentication (4 tasks)
...
```

### 2. Complete traceability
```markdown
## Traceability Matrix

| Requirement | User Story | Bounded Context | Aggregate | ADR | Epic | Tasks | Tests |
|-------------|------------|-----------------|-----------|-----|------|-------|-------|
| REQ-001 | US-001 | Core | Order | ADR-002, ADR-007 | EPIC-003 | TASK-012, TASK-013 | order.test.ts |
...
```

### 3. Dependency graph
```markdown
## Task Dependencies

### Critical Path (23 tasks, 15 days)
TASK-001 → TASK-002 → TASK-005 → TASK-008 → ...

### Dependency Visualization
[Mermaid graph showing all task dependencies]
```

### 4. Reference tables

- **Tasks by Epic** — all tasks grouped by business feature.
- **Tasks by ADR** — which tasks implement each architectural decision.
- **Tasks by Bounded Context** — which tasks touch each domain area.

### 5. Quick commands
```markdown
## Development Commands

### Build
npm run build

### Test
npm test

### Development
npm run dev
docker-compose up -d

### Database
npm run db:migrate
npm run db:seed
```

## Customization

### Adjust quality bars
```bash
# Before running, set your thresholds
export PRD2BUILD_MIN_ADR_COUNT=15      # For MVP (default: 27)
export PRD2BUILD_MIN_AGGREGATES=3      # For simple app (default: 5)
export PRD2BUILD_MIN_TASKS=10          # For prototype (default: 20)

/prd2build my-prd.md
```

### Update mode
```bash
# Update existing docs when PRD changes
/prd2build my-updated-prd.md --mode=update

# Compares against docs/source-prd.md
# Only regenerates changed sections
# Preserves custom edits
# Generates UPDATE-REPORT.md
```

## Example execution

```bash
$ /prd2build ~/projects/my-saas/prd.md

Initializing system...
✅ Directories created
✅ Memory initialized

Spawning documentation agents (8 parallel)...
→ Specification Analyst (researcher)
→ UX Designer (ui-designer)
→ DDD Expert (code-analyzer)
→ System Architect (system-architect)
→ SPARC Coordinator (sparc-coord)
→ Implementation Planner (task-orchestrator)
→ Test Strategist (tester)
→ Documentation Integrator (planner)

⏳ Agents working... (this takes 5-10 minutes)

✅ All agents complete!

Generating unified index...
✅ INDEX.md created

Documentation complete! Generated:
- 8 specification files
- 11 DDD files (5 aggregates, 3 bounded contexts)
- 31 ADRs
- 6 SPARC files
- 4 milestones, 12 epics, 67 tasks
- 4 testing files
- 1 unified INDEX.md

📖 Start here: docs/README.md
🎯 Implementation guide: docs/implementation/INDEX.md
```
