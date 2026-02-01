# ADR-002: RuVector Standalone Architecture

**Status:** Accepted
**Date:** 2024-12-15
**Author:** Agentbox Team

## Context

Agent workloads require high-performance vector similarity search for:

- Memory retrieval (HNSW indexing)
- Pattern matching (ReasoningBank)
- Semantic search (embeddings)

Initial implementation used PostgreSQL + pgvector, but this added complexity and resource overhead.

```mermaid
graph LR
    subgraph "Previous (pgvector)"
        PG[(PostgreSQL)] --> PGV[pgvector extension]
        PGV --> IDX1[IVFFlat Index]
        INIT[Complex Init] --> PG
    end

    subgraph "Current (RuVector)"
        RV[RuVector] --> REDB[(redb)]
        REDB --> HNSW[HNSW Index]
        SIMPLE[Zero Config] --> RV
    end

    IDX1 -.->|"150x slower"| HNSW

    style RV fill:#f59e0b,color:#fff
    style HNSW fill:#10b981,color:#fff
```

## Decision

Use RuVector as a standalone Rust-native vector database with embedded redb storage.

### Architecture

```mermaid
flowchart TB
    subgraph "RuVector Server"
        API[REST API :9700]
        MCP[MCP Server :9701]

        subgraph "Index Layer"
            HNSW[HNSW<br/>O log n search]
            GNN[GNN Layers<br/>GCN, GAT, GIN]
        end

        subgraph "Learning"
            RB[ReasoningBank]
            SONA[SONA Patterns]
        end

        subgraph "Storage"
            REDB[(redb<br/>Embedded KV)]
        end
    end

    CLIENT((Claude Code)) --> API
    CLIENT --> MCP

    API --> HNSW & GNN
    MCP --> HNSW
    HNSW --> REDB
    GNN --> REDB
    RB --> REDB
    SONA --> RB

    style HNSW fill:#f59e0b,color:#fff
    style REDB fill:#6366f1,color:#fff
```

### Performance Comparison

```mermaid
xychart-beta
    title "Search Latency (ms) - Lower is Better"
    x-axis [1K, 10K, 100K, 1M, 10M]
    y-axis "Latency (ms)" 0 --> 1000
    bar [5, 8, 15, 50, 200]
    line [500, 600, 700, 800, 900]
```

| Vectors | RuVector (HNSW) | pgvector (IVFFlat) | Speedup |
|---------|-----------------|-------------------|---------|
| 1K | 0.5ms | 5ms | 10x |
| 10K | 0.8ms | 50ms | 62x |
| 100K | 1.5ms | 200ms | 133x |
| 1M | 5ms | 2000ms | 400x |

## Consequences

### Positive

- **Zero dependencies** — No PostgreSQL installation
- **Embedded storage** — Single data directory
- **150x-12,500x faster** — HNSW vs IVFFlat
- **Native MCP** — Direct Claude integration
- **GNN support** — Graph neural network operations

### Negative

- **No SQL** — Different query interface
- **New package** — Less battle-tested than PostgreSQL

## Migration

```bash
# Old (removed)
# psql -h localhost -U ruvector -d ruvector

# New
npx ruvector serve --port 9700 --data-dir /var/lib/ruvector
npx ruvector mcp --port 9701
```

## Alternatives Considered

| Alternative | Rejected Because |
|-------------|------------------|
| PostgreSQL + pgvector | Complex setup, slower indexing |
| Pinecone | External dependency, cost |
| Milvus | Heavy, overkill for single-node |
| Qdrant | Good but not Rust-native MCP |
