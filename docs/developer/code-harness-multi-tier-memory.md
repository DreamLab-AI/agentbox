# Code Harness Multi-Tier Memory

> **Ecosystem alignment**: This domain reuses the agentbox identity stack:
> `did:nostr:<hex-pubkey>` for actors, `urn:agentbox:<kind>:<scope>:<local>`
> for resources (ADR-013), PROV-O `Activity` for actions. The four existing
> DreamLab backends (solid-pod-rs, nostr-rust-forum, VisionClaw,
> dreamlab-ai-website) share this scheme — Code Execution and Experiential
> Learning becomes the fifth participant without adding identity primitives.

This document is the authoritative namespace/class/TTL table for the Code
Execution and Experiential Learning bounded context (DDD-005, ADR-019, PRD-008).

Cross-references (read before making changes):

- ADR-019: canonical decision — ExpeL + Voyager mechanisms, privacy filter,
  write-gate, manifest gates, garbage collection.
- DDD-005: aggregates (KernelSession, ExecutionTrace, DistilledLesson,
  VerifiedSkill), invariants I08-I15, ubiquitous language.
- PRD-008: six capability surfaces, acceptance criteria, observability.
- `skills/expel-lesson-extractor/SKILL.md` — lesson extraction usage guide.
- `skills/voyager-skill-library/SKILL.md` — skill library usage guide.
- `ontology/code-harness.ttl` — OWL2 DL declarations.

---

## Namespace Table

| Namespace | OWL2 Class | memory_type | TTL | Owner |
|---|---|---|---|---|
| `code-harness-traces` | `ex:ExecutionTrace` | `episodic` | 90 days | code-interpreter MCP (WP-A, ADR-018) |
| `code-harness-lessons` | `ex:DistilledLesson` | `semantic` | none (durable) | expel-lesson-extractor (mcp/expel/distil.py) |
| `code-harness-skills` | `ex:VerifiedSkill` | `procedural` | none (durable, current version) | voyager-skill-library (mcp/voyager/verify-and-store.py) |
| `code-harness-skills-archive` | `ex:VerifiedSkill` | `procedural` | 365 days | archive-old-versions.py (cron) |
| `code-harness-skills-rejected` | `ex:VerifiedSkillRejected` | `episodic` | 30 days | voyager-skill-library (VerificationGate rejection path) |
| `code-harness-activities` | `ex:Activity` | `episodic` | 365 days | every WP (kernel, expel, voyager) |

The `source_type` field on every RuVector entry is the OWL2 class IRI form
(e.g. `ex:DistilledLesson`, `ex:VerifiedSkill`). This is the **multi-tier
discriminator**: it identifies the class of the stored record without requiring
any schema change to the `memory_entries` table in RuVector PostgreSQL.

---

## URN Grammar (ADR-013)

All resource identifiers follow `urn:agentbox:<kind>:<scope>:<local>` where
`scope` is the hex pubkey portion of the owning agent's `did:nostr` DID.

| Resource | kind | local pattern | Example URN |
|---|---|---|---|
| DistilledLesson | `memory` | `lesson-<sha256-12>` | `urn:agentbox:memory:abc123:lesson-def456789012` |
| VerifiedSkill (current) | `skill` | `<name>:v<n>` | `urn:agentbox:skill:abc123:normalise_dataframe:v2` |
| VerifiedSkill (archived) | `skill` | `<name>:v<n>:archived` | `urn:agentbox:skill:abc123:normalise_dataframe:v1:archived` |
| ExecutionTrace | `activity` | `trace-<short-id>` | `urn:agentbox:activity:abc123:trace-f1e2d3c4b5a6` |
| KernelSession | `thing` | `kernel-<short-id>` | `urn:agentbox:thing:abc123:kernel-a1b2c3d4e5f6` |
| Activity record | `activity` | `<verb>-<short-id>` | `urn:agentbox:activity:abc123:distil-1a2b3c4d5e6f` |

Note on kind taxonomy: KernelSession uses kind `thing` (it is a thing the agent
uses); ExecutionTrace uses kind `activity` (it is an action receipt — what was
executed). Neither introduces a new kind beyond the canonical 18.

URN → IRI mapping for Linked Data surfaces (ADR-012, optional, gated by
`[linked_data]` manifest section):

```
urn:agentbox:<kind>:<scope>:<local>
→ <https://urn.agentbox.dev/<kind>/<scope>/<local>>
```

HTTP resolvability: `GET /v1/uri/<urn>` → 307 (if resolvable), 404/410 (if
not). Best-effort per ADR-013 §Resolvability.

---

## Identity Fields (addendum)

Every primary record stored in any of the namespaces above must include the
following identity fields:

| Field | Value | Purpose |
|---|---|---|
| `owner_did` | `did:nostr:<hex-pubkey>` | WHO created/owns this record |
| `action_urn` | `urn:agentbox:activity:<scope>:<verb>-<short-id>` | WHAT action produced it |
| `action_verb` | `exec`, `distil`, `verify`, `store`, `archive`, `retrieve` | Short queryable verb |

**DID source**: `AGENTBOX_AGENT_DID` env var (full `did:nostr:` form) or
`AGENTBOX_AGENT_PUBKEY` (raw hex, prefixed automatically). Dev-mode fallback
when neither is set: `did:nostr:local` (documented; not for production).

did:nostr literals are stored as `xsd:string` in RuVector (plain text values)
and as datatype `ex:NostrDid` in the OWL2 ontology (code-harness.ttl).

---

## Activity Records (code-harness-activities)

Every state-changing operation emits an Activity record regardless of outcome
(ok / skip / error). Activity records are stored in `code-harness-activities`
with `memory_type=episodic` and TTL 365 days.

**Activity records carry NO trace body** — only URN references. This is
intentional: they bypass privacy redaction by design. The privacy filter
(ADR-008 / ADR-019 D04) applies to ExecutionTrace bodies (stdout/stderr/code)
and lesson/skill text — not to the audit trail of which URNs were operated on.

```json
{
  "activity_urn": "urn:agentbox:activity:<scope>:<verb>-<short-id>",
  "ontology_type": "ex:Activity",
  "memory_type": "episodic",
  "verb": "distil|verify|archive|store|exec",
  "subject_did": "did:nostr:<hex-pubkey>",
  "object_urn": "<URN of the primary record>",
  "started_at": "<ISO-8601>",
  "ended_at": "<ISO-8601>",
  "outcome": "ok|skip|error",
  "evidence": ["<trace_urn>", "..."],
  "owner_did": "did:nostr:<hex-pubkey>",
  "action_verb": "<verb>"
}
```

Emitters:

| Verb | Emitted by | Trigger |
|---|---|---|
| `distil` | mcp/expel/distil.py | Every post-task distillation run (even skip/error) |
| `verify` | mcp/voyager/verify-and-store.py | Every VerificationGate run |
| `store` | mcp/voyager/verify-and-store.py | Every successful skill write |
| `archive` | mcp/voyager/archive-old-versions.py | Every archived skill version |
| `exec` | code-interpreter MCP (WP-A) | Every kernel.exec call |

---

## Privacy Filter Scope (ADR-008 / ADR-019 D04)

| Content | Privacy filter applies? |
|---|---|
| ExecutionTrace body (stdout, stderr, code) | YES — filtered before RuVector write |
| DistilledLesson rule text and evidence_claim | YES — filtered before RuVector write |
| VerifiedSkill body_python, assertions, examples | YES (body is code — may contain secrets) |
| Activity records (URN refs only, no bodies) | NO — bypass by design |

Failure mode: if PrivacyFilterPort is unavailable, lessons and skills are
**dropped** (not written without redaction). This is fail-closed. A
`LessonRedactionFailed` event is emitted with `outcome=error` in the
corresponding Activity record.

---

## Manifest Gates

```toml
[features.expel_lesson_extraction]
enabled              = false
max_lessons_per_task = 5
min_confidence       = 0.6
confidence_floor     = 0.3
archive_after_days   = 30

[skills.voyager_skill_library]
enabled              = false  # requires skills.code_interpreter.enabled = true
max_skill_body_lines = 80
archive_after_days   = 30
max_evidence_age_s   = 3600
```

Validator rules:
- `E044`: `skills.voyager_skill_library.enabled = true` requires
  `skills.code_interpreter.enabled = true` (hard error).
- `W043`: `features.expel_lesson_extraction.enabled = true` without
  `skills.code_interpreter.enabled = true` is accepted but logged.

---

## OWL2 Ontology

Classes declared in `ontology/code-harness.ttl`:

| Class | Superclass | Alignment |
|---|---|---|
| `ex:DistilledLesson` | `ex:Memory` | — |
| `ex:VerifiedSkill` | `ex:Memory` | — |
| `ex:ExecutionTrace` | `ex:Memory` | — |
| `ex:KernelSession` | `ex:Memory` | — |
| `ex:Activity` | `ex:Memory`, `prov:Activity` | PROV-O upstream |

The `ex:memoryType` property discriminates the memory tier (`semantic`,
`episodic`, `procedural`) on instances of `ex:Memory` subclasses.

---

## MCP Write Protocol

All writes go through `mcp__ruvector__memory_store`. Never raw SQL, never
`claude-flow memory *` CLI. Both paths bypass the MiniLM-L6-v2 (384-dim)
embedding pipeline and produce entries invisible to HNSW semantic search
(ADR-015 mandate, `ruvector-postgres:5432`, db: `ruvector`).

```python
mcp__ruvector__memory_store(
    namespace="code-harness-lessons",        # or skills, activities, etc.
    key="lesson:<scope>:<short-id>",
    value="<rule-text> | <full-json>",       # rule text is the semantic embedding hook
    source_type="ex:DistilledLesson",        # OWL2 class IRI — the multi-tier discriminator
    upsert=True,
)
```
