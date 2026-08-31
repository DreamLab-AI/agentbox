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

### Keeping ADRs honest — the verification/staleness contract

Status tracking and the supersession graph keep the ledger *internally*
consistent; `ruflo adr check` validates that axis (no orphaned `supersedes`,
no broken chains). It does **not** stop a record drifting from the code it
describes — an ADR can have a perfect lineage graph and still lie about what the
system does. Add a second, orthogonal axis: consistency with the code.

- **`verified_commit` + `verified_paths`.** Each code-bearing record carries the
  full 40-char SHA at which its claims were checked and the repo-relative paths
  it inspected. CI fails the record when any governed path changed since —
  `git diff <verified_commit>..HEAD -- <verified_paths>` must be empty.
- **An unpopulated gate is vacuous.** A record with no `verified_paths` is never
  checked. Advertising "CI-enforced staleness" while records omit paths is
  marketing, not enforcement — populate paths on every code-bearing record, or
  drop the claim. (An opt-in check that no record opts into governs nothing.)
- **Commit sequencing.** A record's `verified_commit` must be a commit whose
  governed paths are *unchanged since it*. Land code changes first, then point
  the record at that SHA — never the reverse, or the record flags its own
  arming commit as stale on the next run.
- **Proposed/rejected records verify nothing.** An empty `verified_commit` is
  their honest state; the generator/validator must accept it rather than force a
  dishonest SHA onto an unbuilt decision.
- **Code is authority.** When a governed path changes and the gate fires,
  classify the drift before touching the record — an adversarial reviewer on a
  *different model family* (the EDD anti-fox rule) is the cheap way: **cosmetic**
  (formatting, import reorder, test line-wrapping) → re-verify and bump the SHA
  with a one-line note; **semantic** (behaviour changed) → re-open the decision.
  The gate says "this code moved, re-confirm the record," not "this record is
  wrong" — so the common case is a bounded re-verification, not a rewrite.
- **Mint new architectural decisions as `proposed`, not `accepted`.**
  Ratification is the owner's act; an agent proposes, a human accepts.

The payoff is a ledger that cannot silently rot: the first time governed code
moves under a record, CI names the record and the exact path, and the fix is a
scoped re-verify rather than an audit. An ADR you cannot falsify against the
code is documentation, not a control.

## Test-Driven Development (TDD)
- **Red-Green-Refactor**: Strict cycle enforcement with TDD-specific agents
- **Test Patterns**: Unit, integration, and contract test templates
- **Best Practices**: Arrange-Act-Assert, descriptive naming, behaviour-focused tests
- **Stabilization role**: TDD agents now also receive proven EDD expectations as input — converting them into permanent regression tests is a first-class TDD task in v1.2.0.
