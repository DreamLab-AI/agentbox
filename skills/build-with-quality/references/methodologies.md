# Methodologies — DDD, ADR, TDD

EDD (Expectation-Driven Development) has its own playbook in
[EDD-PROTOCOL.md](../EDD-PROTOCOL.md). This file covers the other three
methodologies the skill orchestrates. EDD runs **before** TDD/BDD as the
design-time specification phase, then hands proven scenarios off to TDD/BDD for
permanent regression coverage — it does not replace them.

## Domain-Driven Design (DDD)
- **Strategic Design**: Bounded contexts, context mapping, ubiquitous language
- **Tactical Patterns**: Aggregates, entities, value objects, domain events, repositories
- **Guidelines**: Small aggregates, reference by ID, domain events for cross-aggregate communication

## Architecture Decision Records (ADR)
- **Templates**: Standardized ADR format with context, decision, consequences
- **Categories**: Architecture, technology, patterns, operations decisions
- **Tracking**: Status management (proposed -> accepted -> deprecated -> superseded)
- **Graph-Backed ADRs via AgentDB**: When ruflo ADR tooling is available, decisions are stored as a graph in AgentDB with typed relationships (`depends_on`, `amends`, `supersedes`). This enables semantic search across the decision history, impact analysis when a decision changes, and automated consistency checks.

### Ruflo ADR Tooling (Plugin Ecosystem)

When the ruflo ADR plugin is installed, three commands extend the skill:

| Command | Purpose |
|---------|---------|
| `ruflo adr create "Decision title"` | Scaffold a new ADR with auto-numbered ID, frontmatter, and cross-links |
| `ruflo adr index` | Index all ADRs into AgentDB as a relationship graph |
| `ruflo adr check` | Validate ADR consistency — detect broken `supersedes`/`amends` chains, orphaned decisions, missing status transitions |

**Installation** (when published):
```bash
ruflo plugins install --name ruflo-core --source ruvnet/ruflo
ruflo plugins install --name ruflo-adr --source ruvnet/ruflo
```

**How it works**: Each ADR becomes a node in AgentDB with edges to related decisions. The graph captures evolution — which decisions led to which, what got superseded, and where the current architectural boundary sits. This is searchable via `mcp__claude-flow__memory_search` against the `patterns` namespace.

**Manual fallback** (available now): Without the plugin, agents should store ADR metadata in AgentDB manually:
```javascript
mcp__claude-flow__memory_store({
  namespace: "patterns",
  key: "adr-072-feature-engineering",
  value: "ADR-072: AutoRDF2GML feature engineering. Status: accepted. Depends on: ADR-048 (ontology weights), ADR-070 (CUDA integration). Supersedes: none.",
  upsert: true
})
```

## Test-Driven Development (TDD)
- **Red-Green-Refactor**: Strict cycle enforcement with TDD-specific agents
- **Test Patterns**: Unit, integration, and contract test templates
- **Best Practices**: Arrange-Act-Assert, descriptive naming, behaviour-focused tests
- **Stabilization role**: TDD agents now also receive proven EDD expectations as input — converting them into permanent regression tests is a first-class TDD task in v1.2.0.
