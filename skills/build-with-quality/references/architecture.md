# Architecture — Learning, Memory, Routing, Consensus, Execution

Internal machinery of build-with-quality: the unified learning system, memory
architecture, model routing, performance targets, consensus mechanisms, and the
dual (MCP / CLI) execution model.

## Unified Learning System

- **SONA (Self-Optimising Neural Architecture)**: 5 modes (real-time, balanced, research, edge, batch)
- **ReasoningBank**: Pattern storage with confidence tiers (Bronze -> Platinum)
- **HNSW Indexing**: O(log n) vector search - 150x faster than linear
- **Dream Cycles**: Background pattern consolidation
- **Q-Learning**: Coverage optimisation with 12-dimensional state space

## Memory Architecture Enhancements (v1.3.0 — KHIVE-informed)

Learnings from operational comparison with KHIVE v2 during cross-ecosystem sprints.
See [agentdb-memory-patterns/KHIVE-LEARNINGS.md](../../agentdb-memory-patterns/KHIVE-LEARNINGS.md) for full analysis.

- **Orient Pattern**: Single cold-start call returns memory/task/entity counts, recent items, and open tasks. Eliminates the 4-5 sequential tool calls that currently open every session. Proposed: `mcp__claude-flow__memory_orient()`.
- **Importance-Weighted Retrieval**: Memories stored with `importance` float (0.0–1.0). Retrieval blends: `0.6 * cosine + 0.2 * importance + 0.2 * recency`. Architecture decisions and security findings reliably surface above session noise.
- **Episodic vs Semantic Memory Types**: `episodic` (what happened — decays, auto-expire via TTL) vs `semantic` (what we learned — durable, no TTL). Filterable on recall. Agents ask "what did we learn about NIP-98?" not "what happened on May 11th?"
- **Tag Retrieval Path**: Exact-match categorical filters that bypass vector search entirely. `recall(tags=["security","p0"])` returns all P0 security issues without depending on embedding similarity. Uses GIN-indexed JSONB on the sidecar Postgres.
- **Entity-Relationship Graph**: Lightweight entity/edge tables alongside the vector store. Enables structural queries: "what depends on solid-pod-rs?" → graph traversal, not embedding similarity. Entities have typed `kind` (person/project/concept) and typed `relation` edges.
- **Task Dependency DAG**: Tasks with `depends_on` arrays and a `next()` verb that returns only unblocked work. Enforces execution order across multi-repo sprints without manual coordination.
- **URI/URN Addressing**: Three-level scheme: `urn:agentdb:{namespace}:{kind}:{key}[@version]`. Every entry addressable by URN. Cross-references between tasks, entities, and memories use URNs, enabling graph traversal from any node.
- **Hybrid Scoring**: Combine HNSW vector score with BM25 keyword match for retrieval. Catches exact-match queries that embedding models miss.

## Intelligent Model Routing (TinyDancer)

- **3-tier routing**: Haiku (0-20), Sonnet (20-70), Opus (70-100) complexity
- **Flash Attention**: 2.49x-7.47x speedup
- **75% token reduction** through intelligent routing
- **Multi-model voting** for low-confidence decisions

## Performance Targets

| Metric | Target | Achieved |
|--------|--------|----------|
| Vector Search | <3ms | 150x faster |
| Flash Attention | 2.49x speedup | yes |
| Coordination Latency | <100ms | yes |
| Token Reduction | 75% | yes |
| Defect Prediction F1 | >0.8 | yes |

## Consensus Mechanisms

| Decision Type | Algorithm | Threshold |
|--------------|-----------|-----------|
| Code review approval | Weighted Voting | >0.7 weighted |
| Quality gate passage | Byzantine Fault Tolerant | 2/3 majority |
| Pattern storage | CRDT | Conflict-free merge |
| Architecture decisions | Raft | Leader-based |
| Evidence audit verdict (NEW v1.2.0) | Independent Verifier | Producer ≠ Auditor; different model families; tie-break escalates to third model |

## Execution Modes

### Dual Execution Support

The skill supports two execution modes:

1. **MCP Tools (Preferred)**: Use `mcp__claude-flow__*` tools when available
2. **CLI Fallback**: Use `npx claude-flow@alpha` commands when MCP is not configured

Detection logic:
```
IF mcp__claude-flow__swarm_init is available:
    USE MCP Tools
ELSE:
    USE CLI Commands
```

### Agent Coordination Protocol

All spawned agents should run coordination hooks so shared memory and task state stay
in sync:

```bash
# Before starting work
npx claude-flow@alpha hooks pre-task --description "[task]"

# After file operations
npx claude-flow@alpha hooks post-edit --file "[file]"

# Share with other agents
npx claude-flow@alpha hooks notification --message "[update]"

# After completing
npx claude-flow@alpha hooks post-task --task-id "[id]"
```

## Configuration

See [config/skill.yaml](../config/skill.yaml) for full configuration options including:
- Swarm topology settings
- Learning mode configurations
- Quality gate thresholds
- Model routing strategies
- TDD/DDD/ADR methodology settings
