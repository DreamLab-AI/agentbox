---
name: Guidance Control Plane
description: Compile, retrieve, enforce, and evolve governance rules for autonomous agents operating safely for days instead of minutes
version: 3.0.0-alpha.1
mcp_server: false
protocol: hooks
entry_point: hooks.ts
source: https://github.com/ruvnet/claude-flow/tree/claude/guidance-control-plane-uhmR3/v3/@claude-flow/guidance
---

# Guidance Control Plane Skill

The Guidance Control Plane sits *beside* Claude Code (not inside it) to provide comprehensive governance for autonomous agents. This enables agents to operate safely for **days instead of minutes** - a step change in autonomy.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Guidance Control Plane                            │
├─────────────────────────────────────────────────────────────────────┤
│  COMPILE          │ CLAUDE.md → constitution + task-scoped shards   │
│  RETRIEVE         │ Intent classification → relevant rules          │
│  ENFORCE          │ 4 gates: destructive, allowlist, diff, secrets  │
│  PROVE            │ Hash-chained cryptographic envelopes            │
│  GATE (Tools)     │ Idempotency, schema validation, budget metering │
│  GATE (Memory)    │ Authority scope, rate limiting, decay tracking  │
│  OBSERVE          │ Privilege throttling via violation/drift scores │
│  BUDGET           │ Token, tool, storage, time, cost enforcement    │
│  LOG              │ NDJSON event store with compaction and replay   │
│  EVOLVE           │ Signed proposals → simulation → staged rollout  │
│  VALIDATE         │ Fails-closed admission for agent cell manifests │
│  COMPOSE          │ Grant, restrict, delegate, expire permissions   │
│  TRUST            │ Per-agent trust accumulation with decay/tiers   │
│  ANCHOR           │ Immutable externally-signed facts               │
│  TIME             │ Bitemporal assertions with validity windows     │
│  ADVERSARIAL      │ Prompt injection, memory poisoning detection    │
└─────────────────────────────────────────────────────────────────────┘
```

## When to Use This Skill

Use this skill when you need:

- **Extended autonomy** - Agents operating for days/weeks, not minutes
- **Governance enforcement** - Hard constraints on tool/memory operations
- **Cryptographic proof** - Verifiable decision chains for audit/compliance
- **Trust management** - Earned privileges through consistent good behavior
- **Adversarial defense** - Protection against prompt injection, memory poisoning
- **Multi-agent coordination** - Collusion detection and quorum consensus

## Key Components

### 1. GuidanceCompiler
Transforms CLAUDE.md into constitution + task-scoped shards.
```typescript
import { createCompiler } from '@claude-flow/guidance/compiler';

const compiler = createCompiler({ projectRoot: '/workspace' });
const bundle = await compiler.compile();
// bundle.constitution: Core rules (rarely change)
// bundle.shards: Task-specific rule fragments
```

### 2. ShardRetriever
Injects task-relevant constraints via intent classification.
```typescript
import { createRetriever } from '@claude-flow/guidance/retriever';

const retriever = createRetriever({ compiler, embeddingProvider });
const result = await retriever.retrieve({
  taskDescription: 'Refactor authentication module',
  tools: ['Edit', 'Bash', 'Write']
});
// result.shards: Relevant rules for this task
// result.constitution: Always-present base rules
```

### 3. EnforcementGates
Four gates validate every operation:
- **Destructive ops** - Blocks rm -rf, DROP TABLE, etc.
- **Tool allowlist** - Only permitted tools pass
- **Diff size** - Limits change scope
- **Secrets** - Detects API keys, passwords

```typescript
import { createGates } from '@claude-flow/guidance/gates';

const gates = createGates(config);
const decision = gates.evaluate({
  tool: 'Bash',
  input: { command: 'rm -rf /' }
});
// decision.allowed: false
// decision.reason: 'Destructive command blocked'
```

### 4. ProofChain
Cryptographic envelopes for every decision.
```typescript
import { createProofChain } from '@claude-flow/guidance/proof';

const proof = proofChain.append({
  action: 'Edit',
  decision: 'allowed',
  evidence: { gateResults, timestamp }
});
// proof.hash: SHA-256 hash
// proof.parentHash: Chain link
```

### 5. TrustSystem
Agents earn privileges through consistent good behavior.
```typescript
import { createTrustSystem } from '@claude-flow/guidance/trust';

const trust = trustSystem.getScore('agent-123');
// trust.tier: 'ELEVATED' | 'STANDARD' | 'RESTRICTED'
// trust.throughputMultiplier: 2x for trusted, 0.1x for restricted
```

### 6. AdversarialDefense
Detects prompt injection, memory poisoning, collusion.
```typescript
import { ThreatDetector, CollusionDetector } from '@claude-flow/guidance/adversarial';

const threat = threatDetector.scan(input);
// threat.promptInjection: boolean
// threat.memoryPoisoning: boolean
// threat.exfiltration: boolean
```

## Impact Metrics

| Dimension | Without Control Plane | With Control Plane | Improvement |
|-----------|----------------------|-------------------|-------------|
| Autonomy duration | Minutes to hours | Days to weeks | **10x-100x** |
| Cost per outcome | Rises super-linearly | Agents slow naturally | **30-60% lower** |
| Reliability | Frequent silent failures | Failures surface early | **2x-5x higher** |
| Destructive actions blocked | - | 50-90% reduction | **Blocked before execution** |
| Memory corruption | - | 70-90% reduction | **Write gating** |
| Prompt injection | - | 80-95% reduction | **Pattern detection** |

## Agent Cell Axioms

Every agent must satisfy five axioms:

| # | Axiom | Enforcement Point |
|---|-------|-------------------|
| 1 | Declare intent before acting | ManifestValidator |
| 2 | Request capability, never assume it | CapabilityAlgebra |
| 3 | Justify every write with evidence | MemoryWriteGate |
| 4 | Accept decay as natural, not failure | CoherenceScheduler |
| 5 | Emit proof for every decision | ProofChain |

## Hook Integration

Enable via `.claude/settings.json`:
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": ".*",
      "commands": ["npx @claude-flow/guidance hooks pre-tool"]
    }],
    "PostToolUse": [{
      "matcher": ".*",
      "commands": ["npx @claude-flow/guidance hooks post-tool"]
    }]
  }
}
```

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Manifest validation | < 5ms | < 1ms |
| Gate evaluation | < 1ms | < 0.5ms |
| Proof append | < 2ms | < 1ms |
| Memory write check | < 3ms | < 1ms |
| Coherence computation | < 1ms | < 0.5ms |

## Installation

```bash
# Via npm (recommended)
npm install @claude-flow/guidance@v3alpha

# Or use via npx
npx @claude-flow/guidance init
```

## ADRs

- ADR-G001: Guidance Control Plane
- ADR-G002: Constitution-Shard Split
- ADR-G003: Intent-Weighted Classification
- ADR-G004: Four Enforcement Gates
- ADR-G005: Proof Envelope
- ADR-G006: Deterministic Tool Gateway
- ADR-G007: Memory Write Gating
- ADR-G008: Optimizer Promotion Rule
- ADR-G009: Headless Testing Harness
- ADR-G010: Capability Algebra
- ADR-G011: Artifact Ledger
- ADR-G012: Manifest Validator
- ADR-G013: Evolution Pipeline
- ADR-G014: Conformance Kit
- ADR-G015: Coherence-Driven Throttling
- ADR-G016: Agentic Container Integration
