# Swarm Composition & Execution

The full-corpus alignment can run as a 15-agent swarm in five parallel waves.
Deploy with the Claude Code Task tool (see the Quick Start in `SKILL.md`).

## 15-Agent Swarm Composition

### Wave 1: Analysis & Inventory (4 Agents - Parallel)

| Agent | Specialisation | Responsibilities |
|-------|---|---|
| **Corpus Analyzer** | researcher | Inventory all 300+ files, identify duplicates, orphans, structure analysis |
| **Link Validator** | code-analyzer | Extract and validate all 4,000+ links, identify broken references |
| **Diagram Inspector** | ml-developer | Audit all diagrams, identify ASCII, validate Mermaid syntax |
| **Content Auditor** | reviewer | Scan for TODOs, developer notes, stubs, incomplete content |

### Wave 2: Architecture & Design (3 Agents - Parallel)

| Agent | Specialisation | Responsibilities |
|-------|---|---|
| **IA Architect** | system-architect | Design unified 7-section information architecture |
| **Link Infrastructure** | backend-dev | Create bidirectional link generation specification |
| **Navigation Designer** | tester | Design 7+ navigation paths, role-based entry points |

### Wave 3: Modernisation & Standardisation (4 Agents - Parallel)

| Agent | Specialisation | Responsibilities |
|-------|---|---|
| **Diagram Moderniser** | ml-developer | Convert ASCII to Mermaid, create production diagrams |
| **Metadata Implementer** | coder | Apply front matter to all files, standardise tags |
| **Spelling Corrector** | code-analyzer | Enforce UK English throughout corpus |
| **Structure Normaliser** | reviewer | Enforce naming conventions, file locations, structure |

### Wave 4: Content & Consolidation (2 Agents - Parallel)

| Agent | Specialisation | Responsibilities |
|-------|---|---|
| **Reference Consolidator** | api-docs | Unify API docs, configurations, schemas, protocols |
| **Content Cleaner** | code-analyzer | Remove developer notes, TODOs, stubs, chuff |

### Wave 5: Quality Assurance & Automation (2 Agents - Parallel)

| Agent | Specialisation | Responsibilities |
|-------|---|---|
| **Quality Validator** | production-validator | Comprehensive QA: coverage, links, metadata, standards |
| **Automation Engineer** | cicd-engineer | Create validation scripts, CI/CD pipeline, maintenance procedures |

## Swarm Execution Details

### Phase 1: Pre-Execution Setup
```yaml
topology: mesh  # Peer-to-peer communication for parallel execution
maxAgents: 15
strategy: adaptive  # Dynamic task allocation
coordination: shared-memory  # Agents share analysis results
```

### Phase 2: Parallel Analysis (Wave 1)
Each agent scans complete corpus independently:
- **Corpus Analyzer**: 298 files, 86 directories, duplicates, orphans
- **Link Validator**: All markdown links, anchor validation, reference checking
- **Diagram Inspector**: 41 diagrams, ASCII detection, syntax validation
- **Content Auditor**: Scan for 50+ anti-patterns (TODO, stub, FIXME, etc.)

### Phase 3: Design & Specification (Wave 2)
Agents design unified system using Wave 1 outputs:
- **IA Architect**: 7-section structure, directory mapping, consolidation plan
- **Link Infrastructure**: Relationship types, similarity algorithms, validation rules
- **Navigation Designer**: Entry points, learning paths, breadcrumbs, sidebars

### Phase 4: Modernisation (Wave 3)
Concurrent implementation of improvements:
- **Diagram Moderniser**: Convert all ASCII to Mermaid with validation
- **Metadata Implementer**: 99% front matter coverage, 45-tag vocabulary
- **Spelling Corrector**: Find/replace all non-UK spellings (colour, favour, etc.)
- **Structure Normaliser**: Enforce camelCase/kebab-case, proper locations

### Phase 5: Content Consolidation (Wave 4)
Merge and clean scattered documentation:
- **Reference Consolidator**: Merge API docs, deduplicate config docs
- **Content Cleaner**: Remove 12+ categories of development noise

### Phase 6: Quality Validation (Wave 5)
Final comprehensive validation:
- **Quality Validator**: Grade A (94+/100) standard validation
- **Automation Engineer**: CI/CD, scripts, maintenance procedures

## Advanced topologies & memory coordination

For hierarchical (1000+ files) vs mesh topologies, custom validation rules,
swarm memory keys, and large-codebase performance tuning, see
[`../docs/ADVANCED.md`](../docs/ADVANCED.md).
