# DDD-006: Swarm Orchestration Domain

**Date**: 2026-03-28
**Status**: Proposal (research document -- no implementation)
**Bounded Context**: Swarm Orchestration
**Supersedes**: ruvector-catalog/docs/ddd/DDD-004-skill-routing-domain.md (V2 Skill Router)

---

## Domain Purpose

The Swarm Orchestration domain manages deep analysis escalation. When the initial query pipeline (Scope Guard -> PSI -> Proposal Generation) produces a result with low confidence, or when the user explicitly requests deep analysis, this domain spawns a coordinated group of specialist agents to read deeper into the RuVector codebase and produce a detailed RVBP.

In V2, the Skill Router was a lightweight pattern-matching gateway that spawned a single agent worker. V3 replaces this with a full swarm coordination domain that manages multiple agents, tracks their progress, synthesizes their outputs, and enforces time limits.

## Bounded Context Definition

**Boundary**: Swarm Orchestration owns the decision to escalate, the spawning and coordination of specialist agents, and the synthesis of their outputs into a detailed result. It does NOT own the search logic (Discovery Engine), the scope definitions (Scope Guard), or the technology data (Catalog Core). It delegates to those domains through well-defined interfaces.

**Owns**: Escalation decision logic, agent type definitions, task assignment, progress tracking, result synthesis, timeout enforcement.

**Does not own**: Technology metadata, search ranking, scope classification, proposal template structure, PSI curation.

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Analysis Swarm** | A coordinated group of agents working together on one user query. The swarm has a lifecycle: initiation, agent spawning, parallel work, synthesis, completion. |
| **Swarm Agent** | A specialist agent within a swarm. Each has a defined capability (domain-expert, code-analyst, vertical-specialist, integration-planner) and reads specific parts of the RuVector codebase. |
| **Analysis Task** | A unit of work assigned to a SwarmAgent. Defines what the agent reads and what it produces. |
| **Swarm Result** | The synthesized output of all agents in a swarm. Combined into a DetailedRVBP. |
| **Confidence Level** | A three-tier classification (high, medium, low) of how confident the initial pipeline is in its result. Determines whether escalation occurs. |
| **Depth Level** | How deep into the RuVector codebase an agent reads: L1 (SKILL.md only), L2 (capability docs), L3 (ADRs), L4 (source code). Each level adds cost and latency. |
| **Escalation** | The decision to spawn a swarm because the initial result is insufficient. Triggered by low confidence or explicit user request. |
| **Phase 1** | The initial SKILL.md-based answer. Always completed before swarm escalation. Swarm adds Phase 2 depth. |
| **Synthesis** | The process of combining outputs from multiple agents into a single coherent result. |

## Aggregates

### AnalysisSwarm (Root Aggregate)

One instance per escalation. Manages the lifecycle of a coordinated analysis.

```
AnalysisSwarm
  +-- id: SwarmId (generated UUID)
  +-- query: string (the original user query)
  +-- initialResults: SearchResult | ProblemSection[] (what the pipeline already found)
  +-- initialConfidence: ConfidenceLevel
  +-- status: "initiated" | "spawning" | "running" | "synthesizing" | "completed" | "timed_out" | "failed"
  +-- agents: SwarmAgent[]
  +-- tasks: AnalysisTask[]
  +-- result: SwarmResult | null
  +-- startedAt: ISO8601 timestamp
  +-- completedAt: ISO8601 timestamp | null
  +-- timeoutMs: number (default: 120000)
  |
  +-- SwarmAgent
  |     +-- id: AgentId
  |     +-- type: AgentCapability
  |     +-- depthLevel: DepthLevel
  |     +-- status: "pending" | "running" | "completed" | "failed" | "timed_out"
  |     +-- assignedTask: AnalysisTask
  |     +-- output: string | null
  |     +-- startedAt: ISO8601 timestamp | null
  |     +-- completedAt: ISO8601 timestamp | null
  |
  +-- AnalysisTask
  |     +-- id: TaskId
  |     +-- agentType: AgentCapability
  |     +-- description: string
  |     +-- readTargets: string[]     (file paths the agent should read)
  |     +-- expectedOutput: string    (description of what the agent should produce)
  |     +-- depthLevel: DepthLevel
  |
  +-- SwarmResult
        +-- synthesizedAnalysis: string
        +-- agentOutputs: Map<AgentId, string>
        +-- detailedRVBP: DetailedRVBP | null
        +-- totalDurationMs: number
        +-- agentCount: number
```

### Invariants

1. Swarm only triggers when confidence < threshold (default: 0.7) OR user explicitly requests deep analysis. (Prevents unnecessary agent spawning.)
2. Maximum 4 agents per swarm. (Bounds cost and coordination overhead.)
3. Each agent must return within 120 seconds. (Hard timeout per agent.)
4. The entire swarm must complete within 300 seconds. (Hard timeout for the swarm.)
5. Synthesis waits for ALL agents to complete (or time out) before producing a result. (No partial synthesis unless all agents have reported.)
6. Phase 1 (SKILL.md read and initial answer) must be completed BEFORE swarm escalation begins. (Swarm adds depth; it does not replace the initial answer.)
7. Each SwarmAgent must have exactly one AnalysisTask. (No idle agents, no overloaded agents.)

## Entities

### SwarmAgent

A specialist agent within the swarm. Four types are defined:

| Agent Type | Capability | Reads | Produces |
|------------|-----------|-------|----------|
| `domain-expert` | Deep knowledge of a specific capability domain | SKILL.md, capability docs (L1-L2) | Detailed explanation of how technologies address the query |
| `code-analyst` | Source code reading and API analysis | ADRs, source code (L3-L4) | API surface analysis, integration patterns, code examples |
| `vertical-specialist` | Industry-specific context | Vertical mappings, regulatory docs | Business impact, compliance considerations, audience-appropriate language |
| `integration-planner` | Multi-technology coordination | All capability docs, examples | Phased integration plan, dependency analysis, risk assessment |

**Identity**: `AgentId` (generated UUID).

**Lifecycle**: Created when the swarm spawns. Runs its task. Reports output. Destroyed when the swarm completes.

### AnalysisTask

A unit of work for an agent.

**Identity**: `TaskId` (generated UUID).

**Lifecycle**: Created during swarm planning. Assigned to an agent at spawn time. Immutable after creation.

## Value Objects

| Value Object | Structure | Notes |
|-------------|-----------|-------|
| `ConfidenceLevel` | enum: `high` (>= 0.8), `medium` (0.5-0.8), `low` (< 0.5) | Derived from PSI match scores and scope verdict confidence. |
| `DepthLevel` | enum: `L1` (SKILL.md), `L2` (docs), `L3` (ADRs), `L4` (source code) | Each level adds latency and context window cost. |
| `AgentCapability` | enum: `domain-expert`, `code-analyst`, `vertical-specialist`, `integration-planner` | What the agent specializes in. |
| `SwarmId` | UUID string | Identifies a swarm instance. |
| `AgentId` | UUID string | Identifies an agent within a swarm. |
| `TaskId` | UUID string | Identifies a task within a swarm. |
| `DetailedRVBP` | Extended Proposal structure with deeper analysis, code examples, risk matrix, and phased integration plan | The output of a successful swarm. More detailed than the standard Proposal. |

## Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `SwarmInitiated` | Escalation decision made | `{ swarmId, query, initialConfidence, reason: "low_confidence" | "user_request" }` |
| `AgentSpawned` | Agent created and task assigned | `{ swarmId, agentId, agentType, depthLevel, readTargets[] }` |
| `AgentCompleted` | Agent finishes its task | `{ swarmId, agentId, durationMs, outputLength }` |
| `AgentTimedOut` | Agent exceeds its 120-second limit | `{ swarmId, agentId, elapsedMs }` |
| `AgentFailed` | Agent encounters an error | `{ swarmId, agentId, error }` |
| `ResultsSynthesized` | All agent outputs combined | `{ swarmId, agentCount, successfulAgents, totalDurationMs }` |
| `SwarmCompleted` | Swarm lifecycle ends (success or timeout) | `{ swarmId, status, durationMs, resultQuality }` |

## Key Behaviors

### escalate(query: string, initialResults: any, confidence: ConfidenceLevel) -> DetailedRVBP

The primary method. Decides whether to escalate, plans the swarm, spawns agents, waits for results, and synthesizes.

**Algorithm**:
1. **Decision**: Check if confidence < threshold or user explicitly requested deep analysis. If not, return the initial results unchanged.
2. **Planning**: Based on the query and initial results, determine which agent types are needed:
   - Always include `domain-expert`.
   - Include `code-analyst` if the query involves implementation specifics.
   - Include `vertical-specialist` if Industry Verticals resolved a vertical.
   - Include `integration-planner` if the query involves combining multiple technologies.
3. **Task creation**: For each agent type, create an AnalysisTask with specific read targets:
   - `domain-expert`: SKILL.md + relevant capability doc
   - `code-analyst`: Relevant ADRs + source code entry points
   - `vertical-specialist`: Vertical mapping data + regulatory context
   - `integration-planner`: All matched capability docs + example code
4. **Spawning**: Spawn all agents in parallel via claude-flow agent spawn.
5. **Waiting**: Wait for all agents to complete or time out (120s per agent, 300s total).
6. **Synthesis**: Combine agent outputs into a DetailedRVBP:
   - Merge technology recommendations (de-duplicate, reconcile rankings)
   - Combine explanations into a coherent narrative
   - Build a phased integration plan from the integration-planner's output
   - Include code examples from the code-analyst
   - Add regulatory notes from the vertical-specialist

### shouldEscalate(confidence: ConfidenceLevel, userRequested: boolean) -> boolean

Simple decision function:
- If `userRequested` is true, return true.
- If confidence is `low`, return true.
- If confidence is `medium` and query complexity is high, return true.
- Otherwise, return false.

## Integration Points

| Consuming Domain | Interface | Direction | Notes |
|-----------------|-----------|-----------|-------|
| Discovery Engine (DDD-005) | `search()` method | Discovery -> Swarm | Swarm agents invoke Discovery for focused searches. Customer-supplier. |
| Scope Guard (DDD-004) | `ScopeVerdict` | Scope Guard -> Swarm | Swarm checks scope before committing agents. |
| Catalog Core (DDD-001) | `CatalogRepository` read methods | Catalog -> Swarm | Agents read technology metadata during analysis. |
| Industry Verticals (DDD-003) | `IndustryVertical` data | Verticals -> Swarm | Vertical-specialist agent consumes vertical mappings. |
| Proposal Generation (DDD-006) | `DetailedRVBP` output | Swarm -> Proposals | Swarm output is a superset of the standard Proposal format. |
| claude-flow | Agent spawn/terminate/status API | External dependency | Swarm delegates agent lifecycle to claude-flow. Anti-corruption layer isolates from CLI internals. |

## Anti-Corruption Layer: claude-flow Adapter

The Swarm Orchestration domain does not call claude-flow CLI commands directly. A `SwarmInfrastructureAdapter` translates between domain concepts and claude-flow operations:

```
SwarmInfrastructureAdapter
  +-- spawnAgent(agentType: AgentCapability, task: AnalysisTask) -> AgentId
  +-- checkAgentStatus(agentId: AgentId) -> AgentStatus
  +-- terminateAgent(agentId: AgentId) -> void
  +-- getAgentOutput(agentId: AgentId) -> string | null
```

This ensures that if claude-flow's API changes, only the adapter needs updating -- not the domain logic.
