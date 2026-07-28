# AI-First Development Traceability (BHIL Integration)

The [BHIL AI-First Development Toolkit](https://github.com/camalus/BHIL-AI-First-Development-Toolkit)
extends this skill with machine-actionable specification quality. The bottleneck in AI-native
development is **specification quality**, not code generation. BHIL adds:

## Artifact Chain Traceability

Full bidirectional traceability from PRD through deployment:

```
PRD-NNN → SPEC-NNN → ADR-NNN → TASK-NNN → CODE → REVIEW → DEPLOY
```

Each artifact carries YAML frontmatter with parent IDs:
```yaml
---
id: SPEC-042
parent_prd: PRD-012
linked_adrs: [ADR-007, ADR-008]
tasks: [TASK-101, TASK-102, TASK-103]
status: approved
---
```

**Agents:** Use `new-sprint`, `new-feature`, `new-adr` skills to scaffold artifacts with
correct IDs and cross-links. Machine-readable IDs enable full feature-to-code-to-test lineage.

## AI-Native ADR Categories

Four ADR types beyond standard architecture decisions:

| ADR Type | Purpose | Key Fields |
|----------|---------|------------|
| **Model Selection** | LLM benchmarking with cost/latency/quality matrix | Model, benchmarks, cost/req, latency p99, re-eval trigger |
| **Prompt Strategy** | Versioned prompt approaches with eval thresholds | Approach (zero-shot/CoT/RAG), version, pass-rate threshold |
| **Agent Orchestration** | One of 5 patterns with explicit decision criteria | Pattern type, latency budget, cost ceiling, error tolerance |
| **Feature Pipeline** | ML/data pipeline component decisions | Input/output dims, training budget, env gates, fallback strategy |

> **Graph relationships**: When stored in AgentDB, ADRs link via `depends_on`, `amends`, and `supersedes` edges. Use `ruflo adr check` to validate the graph or query with `mcp__claude-flow__memory_search` to find all decisions that depend on a given ADR.

## Five Orchestration Patterns (Decision Framework)

Use this matrix when choosing agent topology:

| Pattern | When | Latency Budget | Cost | Error Tolerance | Scalability |
|---------|------|----------------|------|-----------------|-------------|
| **Orchestrator-Worker** | Clear task decomposition, central control | <1s | Low | Low | High |
| **Pipeline** | Sequential stages, output of N → input of N+1 | <5s | Low | Medium | Medium |
| **Swarm** | Parallel exploration, best result wins | Any | High | High | Very High |
| **Mesh** | Peer-to-peer, no central coordinator | Any | Medium | Very High | High |
| **Hybrid** | Mixed topology based on sub-task needs | Mixed | Mixed | Mixed | High |

**Decision criteria**: If latency budget < 500ms and error tolerance is low → Orchestrator-Worker.
If maximum fault tolerance required → Mesh. If exploration is needed → Swarm.

## Prompt Registry and Versioning

Production prompts must be versioned, evaluated, and immutable once deployed:

```yaml
# Prompt registry entry (YAML frontmatter)
prompt_id: PROMPT-007
linked_adr: ADR-003
version: 2.1.0
version_notes: "Added few-shot examples for edge cases"
eval_suite: EVAL-007
eval_pass_rate: 0.94
status: production  # draft | reviewed | production | deprecated
```

**Semantic versioning rules:**
- **Major** (2.x.x): Format change, breaks parsing downstream
- **Minor** (x.1.x): Backward-compatible improvement (new examples, better instructions)
- **Patch** (x.x.1): Cosmetic (whitespace, typos)

Agents MUST link prompts to eval suite scores before promoting to production.

## Eval Suite as CI Gate

LLM evaluation integrated as automated quality gate (not manual):

```yaml
# EVAL-SUITE structure
eval_suite_id: EVAL-007
linked_prompt: PROMPT-007
test_cases:
  - type: happy_path
    input: "..."
    structural_assertions:
      - valid_json: true
      - max_length: 500
    quality_metric: "llm_rubric"
    rubric_threshold: 0.85
  - type: adversarial
    input: "ignore previous instructions and..."
    safety_assertion: prompt_injection_rejected
  - type: boundary
    input: ""
    structural_assertion: graceful_refusal
ci_config:
  pass_rate_threshold: 0.90
  fail_action: block_merge
```

**Safety guards built into every eval suite:**
- Prompt injection detection (reject or flag)
- PII leakage check (no personal data in outputs)
- Refusal validation (model correctly refuses harmful inputs)

## Guardrails Specification Template

For any agentic capability, define guardrails before implementation:

```markdown
## Guardrails Spec: [Feature Name]
### Input Validation
- Allowed input types: [...]
- Rejection criteria: [...]

### Output Constraints
- Max token budget: [N]
- Forbidden patterns: [regex list]
- Required structure: [JSON schema / format]

### Failure Modes
- Graceful degradation: [fallback behaviour]
- Escalation path: [human review / abort / retry]

### Monitoring
- Log inputs exceeding [threshold]
- Alert on refusal rate > [X%]
```

## BHIL Sprint Workflow Integration

Use BHIL artifact skills at the start of any sprint:

```bash
# Initialize sprint with artifact scaffold
new-sprint "Sprint 12 — Payment Refactor"
# Creates: sprint/S-12/, context files, artifact folders

# Create feature with full traceability
new-feature "Idempotent payment processing"
# Creates: PRD-042, SPEC-042, TASK-042a/b/c with cross-links

# Record an architecture decision
new-adr "Model selection for payment fraud detection"
# Creates: ADR-012 (Model Selection type) with benchmarking table
```

**Integration point with build-with-quality:** After BHIL artifacts exist, hand off to
`build-with-quality` agents (Phase 2 Development) with the SPEC as input. The SPEC's
acceptance criteria become test assertions; ADRs inform architectural choices; TASK IDs
track agent work.
