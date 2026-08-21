# KHIVE-Informed Enhancements (v2.0 Roadmap)

Operational learnings from KHIVE v2 comparison during cross-ecosystem engineering.
Full analysis: [KHIVE-LEARNINGS.md](../KHIVE-LEARNINGS.md)

## Orient Pattern — Cold-Start Dashboard

Every session should start with one call that returns the workspace state:

```typescript
// Proposed: single call replaces 4-5 sequential queries
const state = await agentdb.orient({
  namespace: "project-state",
  task_limit: 10,
  recent_limit: 5
});
// Returns: { counts: {memory, task, entity}, open_tasks, recent, stale_count }
```

**Implementation note:** The sidecar Postgres (ruvector-postgres:5432) can serve this as a single SQL query with CTEs — no new infrastructure needed.

## Importance-Weighted Storage

```typescript
// High-importance: architecture decisions, security findings
await agentdb.store({
  key: "ecosystem-dep-map",
  value: "...",
  importance: 0.95,        // Biases retrieval ranking
  memory_type: "semantic"  // Durable — no TTL auto-expire
});

// Low-importance: session state, progress notes
await agentdb.store({
  key: "sprint-progress-may12",
  value: "...",
  importance: 0.4,
  memory_type: "episodic"  // Decays — auto-expire via TTL
});
```

Retrieval blends: `score = 0.6 * cosine_similarity + 0.2 * importance + 0.2 * recency_decay`

## Entity-Relationship Graph

Lightweight graph layer alongside the vector store. Enables structural queries that embeddings can't answer.

```typescript
// Create typed entities
await agentdb.entityCreate({ name: "solid-pod-rs", kind: "project", properties: { layer: 0, sloc: 42000 } });
await agentdb.entityCreate({ name: "nostr-rust-forum", kind: "project", properties: { layer: 1, sloc: 54000 } });

// Link with typed relations
await agentdb.entityLink({ source: "nostr-rust-forum", target: "solid-pod-rs", relation: "depends_on" });

// Structural query: "what depends on solid-pod-rs?"
const dependents = await agentdb.entitySearch({ linked_to: "solid-pod-rs", relation: "depends_on" });
```

**Schema** (sidecar Postgres):
```sql
CREATE TABLE entities (id TEXT PK, kind TEXT, name TEXT, properties JSONB, created_at TIMESTAMPTZ);
CREATE TABLE edges (source TEXT REFERENCES entities(id), target TEXT REFERENCES entities(id),
                    relation TEXT, weight FLOAT DEFAULT 1.0, metadata JSONB);
CREATE INDEX idx_edges_target ON edges(target, relation);  -- "what links TO this entity?"
CREATE INDEX idx_edges_source ON edges(source, relation);  -- "what does this entity link TO?"
```

## Task Dependency DAG

Tasks as a first-class memory kind with dependency ordering:

```typescript
await agentdb.taskCreate({ title: "SSO parity verification", priority: "p0", depends_on: [] });
await agentdb.taskCreate({ title: "Build panel registry", priority: "p1", depends_on: ["sso-parity-id"] });

// Returns only unblocked tasks — respects dependency graph
const actionable = await agentdb.taskNext({ limit: 3 });
```

## Tag Retrieval Path

Exact-match categorical filter bypassing vector search:

```typescript
// Find all P0 security issues — no embedding similarity, just tag match
const p0s = await agentdb.recall({ tags: ["security", "p0"], tag_mode: "all" });
```

**Schema:** `ALTER TABLE memories ADD COLUMN tags JSONB DEFAULT '[]'; CREATE INDEX idx_tags ON memories USING GIN (tags);`

## URI/URN Addressing

Three-level addressing for cross-referencing:

```
urn:agentdb:{namespace}:{kind}:{key}[@version]

Examples:
  urn:agentdb:project-state:memory:ecosystem-dep-map
  urn:agentdb:project-state:entity:solid-pod-rs
  urn:agentdb:project-state:task:fix-nip98-parity
  urn:agentdb:project-state:edge:nrf→solid-pod-rs:depends_on
```

Tasks reference entities by URN. Memories reference tasks by URN. Edges connect entities by URN. Enables graph traversal from any starting node.
