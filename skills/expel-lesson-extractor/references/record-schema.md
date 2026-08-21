# DistilledLesson Record Schema

## OWL2 Ontology Classification

| Field | Value |
|---|---|
| OWL2 class | `ex:DistilledLesson` (subClassOf `ex:Memory`) |
| `memory_type` | `semantic` |
| TTL | none (durable — no expiry) |
| RuVector namespace | `code-harness-lessons` |
| `source_type` (RuVector discriminator) | `ex:DistilledLesson` |

Ontology declaration: `agentbox/ontology/code-harness.ttl`.
Full namespace table: `docs/developer/code-harness-multi-tier-memory.md`.

The `source_type` field on every RuVector entry is the multi-tier discriminator:
it identifies the OWL2 class of the stored record without requiring any schema
change to the `memory_entries` table. Semantic search on `code-harness-lessons`
returns only `ex:DistilledLesson` records; episodic traces live in a separate
namespace and are never mixed into lesson retrieval.

## Record structure

Every lesson written to RuVector has the following structure (stored as JSON
in the `value` field; the `rule` field is the string embedded by
bge-small-en-v1.5 (384-dim, via Xinference) for HNSW semantic search):

```json
{
  "lesson_urn": "urn:agentbox:memory:<scope>:lesson-<sha256-12>",
  "ontology_type": "ex:DistilledLesson",
  "memory_type": "semantic",
  "rule": "IF <scope-condition> THEN <action-rule>",
  "scope": "<task-type or skill-name or '*'>",
  "evidence_trajectory_id": "<traj-id>",
  "evidence_traces": ["urn:agentbox:memory:<scope>:trace-<sha256-12>", "..."],
  "confidence": 0.7,
  "active": true,
  "version": 1,
  "source_agent": "<agent-session-id>",
  "created_at": "<ISO-8601>",
  "contradiction_count": 0
}
```

## Field definitions

| Field | Type | Constraints |
|---|---|---|
| `lesson_urn` | string | ADR-013 grammar: `urn:agentbox:memory:<scope>:lesson-<sha256-12>`. Minted via `management-api/lib/uris.js`. |
| `ontology_type` | string | Always `"ex:DistilledLesson"` — the multi-tier discriminator. |
| `memory_type` | string | Always `"semantic"` — signals durable, no-TTL storage tier. |
| `rule` | string | The generalisable rule in IF/THEN plain English. Max 200 characters. This is the value embedded by RuVector for HNSW semantic search. |
| `scope` | string | Task type or skill name this rule applies to, e.g. `"codeact"`, `"data-pipeline"`, `"cf-d1-pagination"`, `"*"`. |
| `evidence_trajectory_id` | string | Trajectory ID this lesson was extracted from. |
| `evidence_traces` | list[string] | At least one `trace_urn` referencing an `ex:ExecutionTrace` record that supports the rule. Required per PRD-008 §8 (lessons without grounding evidence are discarded). |
| `confidence` | float [0, 1] | Initial value ≥ `[features.expel_lesson_extraction].min_confidence` (default 0.6). |
| `active` | bool | False when confidence drops below `confidence_floor` (default 0.3); soft-deleted but retained for audit. |
| `version` | int | Incremented on contradiction-triggered update. |
| `source_agent` | string | Agent session ID (did:nostr pubkey + short session token). |
| `created_at` | string | ISO 8601 UTC timestamp. |
| `contradiction_count` | int | Times a subsequent trace has contradicted this lesson. |

## RuVector write call pattern

```python
# value must be the rule text (embedded for HNSW) + full JSON as a single
# plain-text string that encodes both the semantic hook and the structured record
value = f"{record['rule']} | " + json.dumps(record)

mcp__claude-flow__memory_store(
    namespace="code-harness-lessons",
    key=f"lesson:{scope}:{short_uuid}",
    value=value,
    # source_type is the OWL2 class IRI — the multi-tier discriminator
    source_type="ex:DistilledLesson",
    upsert=True,
)
```
