# KHIVE Operational Learnings for AgentDB Memory Patterns

**Date:** 2026-05-12
**Source:** Direct operational comparison — KHIVE v2 vs RuVector/AgentDB during DreamLab ecosystem mega-sprint
**Status:** Actionable — concrete gaps identified with proposed enhancements

---

## 1. Side-by-Side Capability Matrix

| Capability | KHIVE | RuVector/AgentDB | Gap |
|-----------|-------|-----------------|-----|
| **Cold-start dashboard** | `orient()` — 1 call returns memory/task/entity counts, recent items, open tasks | Requires 2-3 separate calls (`memory_list` + `memory_search`) | **Critical.** Every session starts with 4-5 wasted tool calls. |
| **Importance scoring** | `remember(content, importance=0.8)` — float 0.0–1.0, used in retrieval ranking | None — all memories are equal weight | **High.** High-importance memories (architecture decisions, security findings) drown in session noise. |
| **Memory type distinction** | `episodic` (what happened) vs `semantic` (what we learned) — filterable on recall | `source_type` string — not a retrieval dimension, not typed | **High.** Episodic memories decay; semantic ones endure. No way to ask "what did we learn?" vs "what happened?" |
| **Tag-based retrieval** | `recall(tags=["security","p0"], tag_mode="all")` — no semantic query needed | None — everything goes through vector search | **High.** Sometimes you know the category but not the phrasing. Tags bypass the embedding lottery. |
| **Hybrid scoring** | `raw_score` (vector) + `rank_score` (BM25 + recency + importance) + `score` (blended) | Single HNSW cosine score | **Medium.** BM25 catches exact keyword matches that embedding models miss. |
| **Entity-relationship graph** | `create(name, kind)` + `link(source, target, relation, weight)` + property search | None — flat key-value with vector search | **Critical.** Can't express "crate X depends on crate Y" or "person A owns module B". |
| **Task dependency DAG** | `assign(title, depends_on=[id1,id2])` + `next()` respects unblocked tasks | None — no task concept | **High.** Task ordering requires manual tracking. `next()` is the killer feature — "what can I actually work on right now?" |
| **Temporal filtering** | `created_after`, `created_before` on recall | None | **Medium.** Can't ask "what did we store this session?" or "what's older than 7 days?" |
| **Cross-kind search** | `recall(kind="task")`, `recall(kind="memory")`, `recall(kind="message")` | Single flat namespace search | **Medium.** Memories and tasks are different things with different lifecycles. |
| **Namespace scoping** | Automatic per-workspace namespace, cross-namespace search via `namespaces` param | Manual namespace param on every call | **Low.** Both have namespaces, but KHIVE's is more ergonomic. |
| **Batch operations** | `complete()` supports 3-op batches | None | **Low.** Minor efficiency. |

## 2. Architectural Patterns Worth Adopting

### 2.1 The Orient Pattern (highest impact)

KHIVE's `orient()` is a single cold-start call that returns everything a session needs to resume:

```
{
  counts: { memory: 30, task: 90, entity: 0, message: 0 },
  open_tasks: [ { id, priority, status, title } ... ],
  recent: [ { id, kind, content_preview, created_at } ... ],
  unread_messages: 0
}
```

**Why it matters:** Every Claude Code session starts cold. Without `orient()`, the agent makes 4-5 sequential calls to understand state, burning tokens and time. With it, one call gives the full workspace picture.

**Proposed for AgentDB:**
```typescript
mcp__claude-flow__memory_orient({
  namespace: "project-state",
  task_limit: 10,
  recent_limit: 5
})
// Returns: { counts, open_tasks, recent_memories, stale_count }
```

### 2.2 The Remember-with-Importance Pattern

KHIVE scores every memory 0.0–1.0 at write time. This biases retrieval toward high-importance items without requiring the caller to know what's important at search time.

**Why it matters:** During the mega-sprint, 30 KHIVE memories covered 697K SLOC across 6 repos. The ecosystem dependency map (importance=0.95) reliably surfaced above session noise (importance=0.5) in every search. In RuVector, the equivalent entries are indistinguishable from wave summaries.

**Proposed for AgentDB:**
```typescript
mcp__claude-flow__memory_store({
  key: "ecosystem-dep-map",
  value: "...",
  namespace: "project-state",
  importance: 0.95,       // NEW: float 0.0-1.0
  memory_type: "semantic"  // NEW: episodic | semantic
})
```

Retrieval should blend: `final_score = 0.6 * cosine_similarity + 0.2 * importance + 0.2 * recency_decay`

### 2.3 The Entity-Link Graph Pattern

KHIVE's entity system enables structural queries that vector search cannot answer:

```
create("solid-pod-rs", kind="project", properties={"layer": 0, "sloc": 42000})
create("nostr-rust-forum", kind="project", properties={"layer": 1, "sloc": 54000})
link(source="nostr-rust-forum", target="solid-pod-rs", relation="depends_on", weight=0.9)

// Later: "what depends on solid-pod-rs?"
search("entity", linked_to="solid-pod-rs", relation="depends_on")
```

**Why it matters:** The ecosystem dependency map we stored in RuVector as a giant text blob (`ECOSYSTEM DEPENDENCY MAP...`) would be 6 entities with 8 edges in KHIVE. You can traverse the graph. You can ask "what breaks if I change solid-pod-rs?" and get a real answer.

**Proposed for AgentDB:** Add a lightweight entity/edge table alongside the vector store:
```sql
CREATE TABLE entities (id TEXT PK, kind TEXT, name TEXT, properties JSONB);
CREATE TABLE edges (source TEXT, target TEXT, relation TEXT, weight FLOAT, metadata JSONB);
```

Expose via MCP:
```typescript
mcp__claude-flow__entity_create({ name: "solid-pod-rs", kind: "project", properties: {...} })
mcp__claude-flow__entity_link({ source: "...", target: "...", relation: "depends_on" })
mcp__claude-flow__entity_search({ linked_to: "...", relation: "depends_on" })
```

### 2.4 The Task-DAG Pattern

KHIVE tasks have `depends_on` arrays and a `next()` verb that filters for unblocked work:

```
assign("Fix NIP-98 parity", priority="p0", depends_on=["verify-solid-pod-rs-api"])
assign("Build panel registry", priority="p1", depends_on=["fix-nip98-parity"])

next()  // Returns only "verify-solid-pod-rs-api" — the unblocked root
```

**Why it matters:** During the sprint, we had 90 tasks across 6 repos. Without dependency tracking, prioritisation degenerates to "pick the top p0" regardless of whether its prerequisites are done. `next()` enforces execution order without manual coordination.

**Proposed for AgentDB:** Tasks as a first-class memory kind:
```typescript
mcp__claude-flow__task_create({
  title: "SSO parity verification",
  priority: "p0",
  depends_on: ["verify-nip98-fields"],
  tags: ["sso", "cross-repo"]
})
mcp__claude-flow__task_next({ limit: 3 })  // Unblocked only
mcp__claude-flow__task_complete({ id: "...", result: "Verified: ±60s window matches" })
```

### 2.5 The Tag Retrieval Path

KHIVE's `recall(tags=["security"], tag_mode="all")` bypasses vector search entirely. Tags are exact-match categorical filters.

**Why it matters:** Vector search depends on embedding quality. "Find all P0 security issues" is a categorical query — you don't want semantic similarity ranking, you want exact tag match. The embedding model might rank a P1 performance issue above a P0 auth bypass because the descriptions happen to share vocabulary.

**Proposed for AgentDB:** Add a `tags` JSONB column to the memory table, with GIN index:
```sql
ALTER TABLE memories ADD COLUMN tags JSONB DEFAULT '[]';
CREATE INDEX idx_memories_tags ON memories USING GIN (tags);
```

## 3. What KHIVE Gets Wrong (or we should improve on)

| Issue | Detail | Our Advantage |
|-------|--------|---------------|
| **No upsert** | KHIVE `remember()` always creates new entries; updating requires delete + recreate | RuVector has `upsert: true` on `memory_store` — idempotent writes are critical for evolving state |
| **Entity count always 0** | `orient()` reports entity count as 0 unless you call `entity.list` separately — the dashboard is incomplete | We should make `orient()` report real counts for all types |
| **Message layer underused** | KHIVE has `send()` / `inbox()` / `request()` for inter-agent messaging but we never used it — all coordination happened via memory | If we add messaging, make it pull-based (inbox polling) not push-based (WebSocket) for CF Worker compat |
| **No TTL on memories** | KHIVE memories persist forever; no automatic cleanup | RuVector has TTL support — episodic memories should auto-expire |
| **Limited full-text content** | Early KHIVE versions truncated to 200 chars; v2 fixed this | Always return full content by default |
| **No embedding model control** | KHIVE uses a fixed embedding model internally | RuVector uses MiniLM-L6-v2 (384-dim) via xinference — we could offer model selection per namespace for domain-specific embeddings |

## 4. Mapping to URI/URN Addressing

The combination of KHIVE's patterns suggests a **three-level addressing scheme** for AgentDB:

```
Level 1: Namespace (workspace/project scope)
  urn:agentdb:project-state:*

Level 2: Kind (memory, entity, task, edge)
  urn:agentdb:project-state:memory:ecosystem-dep-map
  urn:agentdb:project-state:entity:solid-pod-rs
  urn:agentdb:project-state:task:fix-nip98-parity
  urn:agentdb:project-state:edge:nrf→solid-pod-rs:depends_on

Level 3: Version/Temporal (for replaceable entries)
  urn:agentdb:project-state:memory:ecosystem-dep-map@2026-05-12
  urn:agentdb:project-state:task:fix-nip98-parity#completed
```

Every entry is addressable by URN. Cross-references use URNs:
- A task's `depends_on` field contains entity/task URNs
- An entity's `link` edge contains entity URNs
- A memory's `context_ids` field contains any mix of URNs

This enables the **graph traversal** that flat key-value stores can't do: "starting from this task, find all entities it references, then find all memories about those entities."
