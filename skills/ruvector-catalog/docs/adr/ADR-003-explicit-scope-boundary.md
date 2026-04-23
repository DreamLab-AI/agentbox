# ADR-003: Explicit Scope Boundary (Negative Signaling)

**Date**: 2026-03-28
**Status**: Proposed
**Deciders**: Mark Allen
**Related ADRs**: ADR-001, ADR-002, ADR-007

---

## Context

The single worst failure mode of both V1 and V2 is returning confident wrong answers for out-of-scope queries. This is worse than returning nothing, because it erodes trust in all recommendations.

**Benchmark Q2** ("I have a client who wants to draft best-selling books. What RuVector technologies would you recommend?"):

- **V1 (CAG)**: Returned 5 lines of false-positive recommendations, including ruvector-attention ("for processing text sequences"), SONA ("for learning writing patterns"), and ruvector-graph ("for knowledge graphs of narrative structure"). Grade: D. These recommendations are technically defensible at a stretch but practically useless -- nobody is going to use a sheaf cohomology engine to write a novel.
- **V2 (RAG)**: Returned Min-Cut Gated Attention with 0.38 similarity, Continuous Batching with 0.32, and Auto-Sharding with 0.28. Grade: F. The RAG pipeline cannot distinguish "somewhat related terms" from "actually useful for this task."
- **Hive Mind**: The Scope Analyst agent correctly identified this as out-of-scope, but only after multi-agent deliberation. This knowledge was not available in V1 or V2.

The core problem: neither V1 nor V2 has any mechanism to say "this is not what RuVector does." V1's SKILL.md describes what RuVector IS but never describes what it IS NOT. V2's similarity scores have no concept of an out-of-scope threshold -- everything gets a score, and low scores (0.28-0.38) are still presented as matches.

This is not unique to Q2. Any query about content generation, web development, project management, or general productivity will trigger false positives because RuVector's technologies use general terms ("learning," "attention," "graph," "model") that overlap with everyday software concepts.

## Decision

**V3 includes an explicit "What RuVector Does NOT Do" section in SKILL.md listing out-of-scope categories.**

The section appears near the top of SKILL.md (after the introduction, before the Problem-Solution Map) and reads:

```markdown
## What RuVector Does NOT Do

RuVector is an AI/ML infrastructure library. It does NOT provide:

- **Content generation**: No text writing, image generation, music composition, or creative tools
- **Web development**: No HTTP frameworks, CSS libraries, frontend components, or CMS
- **Database administration**: No backup tools, migration frameworks, or query optimizers
  (ruvector-postgres is a vector EXTENSION, not a database management tool)
- **Cloud hosting/deployment**: No container orchestration, CI/CD, or infrastructure-as-code
- **Project management**: No task tracking, time management, or team collaboration
- **General-purpose programming**: No string libraries, date utilities, or logging frameworks
- **End-user applications**: RuVector provides infrastructure that applications are built ON,
  not applications themselves

If a query falls entirely outside these boundaries, say so clearly rather than
stretching RuVector's capabilities to fit.
```

Additionally:

1. **SKILL.md includes a confidence directive**: "If no section header matches the query and the query does not involve AI/ML infrastructure, vector search, graph intelligence, neural computation, or mathematical optimization, respond that RuVector does not cover this domain and suggest where to look instead."

2. **The CLI path (ADR-007) implements a minimum score threshold of 0.25**: Results below this threshold are suppressed. If all results fall below threshold, the CLI returns "No relevant technologies found" instead of a ranked list.

3. **The out-of-scope categories are stored as `outOfScope` in catalog.json** (ADR-008) so both the SKILL.md path and CLI path can reference them.

## Consequences

### Positive

- **Eliminates the worst failure mode**: A response of "RuVector does not include content generation tools" is infinitely better than recommending Min-Cut Gated Attention for book writing.
- **Builds trust**: Users who receive honest "I don't know" responses trust the "I do know" responses more. This is a well-documented pattern in recommendation systems.
- **Low token cost**: The out-of-scope section is ~150 tokens. This is 0.075% of the context window.
- **Educates Claude about boundaries**: The explicit list gives Claude a concrete decision surface for scope classification, rather than relying on implicit reasoning about what an "AI/ML infrastructure library" does and does not include.

### Negative

- **Requires maintenance**: New out-of-scope categories may emerge. If RuVector adds a web framework, "web development" must be removed from the exclusion list.
- **False negatives possible**: An overly aggressive scope boundary might reject edge-case queries that ARE relevant. Example: "I need to build a chatbot" -- RuVector DOES have agent frameworks and LLM inference that are relevant, even though "chatbot" sounds like an end-user application.
- **Cannot cover all out-of-scope queries**: The list is finite. A query about "gardening tools" is obviously out of scope but is not explicitly listed. The general directive ("AI/ML infrastructure") handles the long tail, but edge cases remain.

### Neutral

- **Combined with CAG, scope boundaries are soft**: Claude can override the out-of-scope list when a query genuinely does overlap. The list is a heuristic, not a hard gate. The CLI path's score threshold (0.25) is a harder gate because it cannot reason about edge cases.

## Alternatives Considered

### Alternative A: Inferred Scope from Score Thresholds Only (Rejected for Primary Path)

Set a confidence threshold (e.g., cosine similarity < 0.15) and suppress all results below it.

**Why rejected for primary path**: The CAG path does not produce numeric similarity scores. Claude reads SKILL.md and reasons about relevance qualitatively. A numeric threshold only applies to the CLI's HNSW search.

**Accepted for CLI path**: The CLI uses a 0.25 minimum similarity threshold (ADR-007). Results below this are suppressed.

### Alternative B: Explicit + Inferred for CLI Path (Accepted)

Combine the explicit out-of-scope list with a score threshold for the CLI.

**Status**: Accepted. The CLI checks both: (1) does the query match any out-of-scope keywords? and (2) do all results score below 0.25? If either is true, the CLI returns "no relevant technologies."

### Alternative C: Train a Scope Classifier (Rejected)

Build a binary classifier that predicts "in-scope" vs "out-of-scope" before running search.

**Why rejected**: Adds model dependency (even a simple one) for a problem that a 150-token explicit list solves. The catalog has 80 technologies -- the scope boundary can be fully specified by listing what the technologies do (already in SKILL.md) and what they do not do (the new section). A classifier would be appropriate for a catalog of 10,000+ items where scope is ambiguous.

## Evidence

### Benchmark Q2 Detailed Analysis

Query: "I have a client who wants to draft best-selling books. What RuVector technologies would you recommend?"

**Expected answer**: "RuVector is an AI/ML infrastructure library. It does not include content generation, creative writing, or book authoring tools. For book drafting, you would want tools like Claude's writing capabilities, GPT-based assistants, or dedicated writing software like Scrivener."

**V1 actual answer**: Recommended 5 technologies (ruvector-attention, SONA, ruvector-graph, ruvllm, ruvector-learning). Each recommendation contained a plausible but misleading rationale. A non-technical user would not know these are inappropriate.

**V2 actual answer**: Returned Min-Cut Gated Attention (0.38), Continuous Batching (0.32), Auto-Sharding (0.28). The similarity scores are driven by hash collisions on terms like "model" (appears in both "language model" and "book model") and "attention" (appears in both "attention mechanism" and "reader attention").

**V2 root cause**: The TF-IDF embedder hashes all vocabulary into 128 dimensions. The term "model" hashes to dimension 47. Both the query embedding and the Min-Cut Gated Attention embedding have significant weight at dimension 47, producing a false similarity of 0.38.

### Out-of-Scope Category Coverage

Analysis of 50 hypothetical out-of-scope queries across the 7 excluded categories:

| Category | Example Query | Would V1 Return False Positive? | Would V3 Catch It? |
|----------|--------------|--------------------------------|---------------------|
| Content generation | "write marketing copy" | Yes (SONA, ruvllm) | Yes (explicit exclusion) |
| Web development | "build a REST API" | Yes (ruvector-server) | Partial (ruvector-server IS relevant) |
| Database admin | "migrate my PostgreSQL schema" | Yes (ruvector-postgres) | Yes (explicit distinction: extension vs admin) |
| Cloud hosting | "deploy to Kubernetes" | Unlikely | Yes (explicit exclusion) |
| Project management | "track my team's tasks" | Unlikely | Yes (explicit exclusion) |
| General programming | "parse JSON files" | Unlikely | Yes (explicit exclusion) |
| End-user apps | "build a chatbot" | Yes (rvAgent, ruvllm) | Nuanced -- these ARE partially relevant |

The "build a chatbot" case illustrates why the scope boundary must be a soft heuristic (for CAG) rather than a hard gate. rvAgent and ruvllm genuinely are the infrastructure you would use to build a chatbot. The out-of-scope list prevents false positives for clearly irrelevant queries while allowing Claude to exercise judgment on borderline cases.

## Notes

The phrasing of the out-of-scope section matters. "RuVector does NOT provide content generation" is a stronger signal to Claude than "RuVector is focused on AI/ML infrastructure." The explicit negation creates a decision boundary; the vague positive statement does not.
