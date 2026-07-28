# Hive Mind — Architecture & Core Concepts

The Hive Mind system implements a queen-led hierarchical architecture where a
strategic queen coordinator directs specialized worker agents through collective
decision-making and shared memory. It is the most structured multi-agent
coordination model in Claude Flow.

## Architecture Patterns

**Queen-Led Coordination**
- Strategic queen agents orchestrate high-level objectives
- Tactical queens manage mid-level execution
- Adaptive queens dynamically adjust strategies based on performance

**Worker Specialization**
- Researcher agents: Analysis and investigation
- Coder agents: Implementation and development
- Analyst agents: Data processing and metrics
- Tester agents: Quality assurance and validation
- Architect agents: System design and planning
- Reviewer agents: Code review and improvement
- Optimizer agents: Performance enhancement
- Documenter agents: Documentation generation

## Collective Memory System

- Shared knowledge base across all agents
- LRU cache with memory pressure handling
- **PostgreSQL persistence with pgvector** (production) or SQLite (local fallback)
- HNSW indexing for 150x-12,500x faster vector search
- Memory consolidation and association
- Access pattern tracking and optimisation

**RuVector PostgreSQL Backend**:
```bash
# Connection (auto-configured via RUVECTOR_PG_CONNINFO)
host=ruvector-postgres port=5432 user=ruvector database=ruvector

# Hive memory tables: memory_entries (1.17M+), consensus, session_state
# Features: pgvector, HNSW indexing, 384-dim embeddings (all-MiniLM-L6-v2)
```

## Consensus Mechanisms

**Majority Consensus**
Simple voting where the option with most votes wins.

**Weighted Consensus**
Queen vote counts as 3x weight, providing strategic guidance.

**Byzantine Fault Tolerance**
Requires 2/3 majority for decision approval, ensuring robust consensus even with
faulty agents.
