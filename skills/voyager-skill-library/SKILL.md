---
name: voyager-skill-library
description: >
  Store and retrieve verified, executable Python skill primitives (a function
  plus assertions plus at least one example) in the code-harness procedural
  memory tier. Use when a reusable utility, parser, validator, or algorithm has
  proven general-purpose across tasks and should be verification-gated and
  persisted for future reuse, or when retrieving such helper functions at task
  start to inject as a CodeAct prelude. Covers the VerificationGate write path,
  the VerifiedSkill record schema, immutable versioning, and task-start
  retrieval — details in the body. Not for one-off scripts, project-specific
  domain logic, or functions using banned APIs (subprocess, socket, ctypes,
  os.system) that cannot pass the VerificationGate.
version: 0.1.0
related_skills:
  - codeact
  - expel-lesson-extractor
depends_on_mcps:
  - code-interpreter
---

# Voyager Verified Skill Library

**Status: Phase 2 scaffolding. The SKILL.md and verification implementation
(`mcp/voyager/verify-and-store.py`) ship now. The VerificationGate write path
will be activated only after Phase 1 (expel-lesson-extractor) has been
validated and `skills.code_interpreter.enabled = true` is confirmed live
(ADR-019 §Rollout, PRD-008 §6 Phase 2b).**

See: ADR-019 §Mechanism 2, PRD-008 §3.5 / §7 Phase 2b (D1-D5), DDD-005
§VerifiedSkill aggregate, invariants I08-I15.
Multi-tier memory table: `docs/developer/code-harness-multi-tier-memory.md`.

---

## When to Use

Tasks that involve utility functions, parsers, validators, or algorithms
likely to be reused across sessions. Submit a candidate `VerifiedSkill` when:

- A Python function has been used successfully at least twice in the same task
  class and is clearly general-purpose.
- The function can be expressed self-containedly (all imports at the top,
  no reliance on external state beyond standard library or approved packages).
- You can write at least one `assert`-based test and one example invocation.

## When NOT to Use

- One-off scripts or project-specific domain logic unlikely to transfer to
  future tasks.
- Functions with banned APIs (`subprocess`, `socket`, `ctypes`, `os.system`,
  `os.fork` — per `sandbox_check.py`).
- Functions whose correctness cannot be verified by `kernel.exec` within
  `[skills.voyager_skill_library].max_evidence_age_s` (default 3600 s).
- When `skills.voyager_skill_library.enabled = false`.
- When `skills.code_interpreter.enabled = false` (VerificationGate has no
  kernel to run assertions; writes are blocked — validator rule E044).

---

## OWL2 Ontology Classification

| Field | Value |
|---|---|
| OWL2 class | `ex:VerifiedSkill` (subClassOf `ex:Memory`) |
| `memory_type` | `procedural` |
| TTL | none (durable — no expiry for current version) |
| RuVector namespace | `code-harness-skills` |
| `source_type` (RuVector discriminator) | `ex:VerifiedSkill` |
| Archive namespace | `code-harness-skills-archive` |

Ontology declaration: `agentbox/ontology/code-harness.ttl`.
Full namespace table: `docs/developer/code-harness-multi-tier-memory.md`.

The `source_type` discriminator allows a single RuVector `memory_entries` table
to serve multi-tier memory: `ex:VerifiedSkill` records are the procedural tier
(durable, executable); `ex:DistilledLesson` records are the semantic tier
(durable, natural-language rules); `ex:ExecutionTrace` records are the episodic
tier (90-day TTL, decay). No schema migration required.

---

## VerifiedSkill Record Schema

Every skill written to RuVector has a fixed structure, keyed by `skill_urn`
(the `skill` kind from ADR-013's 19 valid kinds — `decision` added by ADR-048;
no new kind is invented). Full JSON record, identity-scheme addendum fields,
field-definition table, and the Activity-record schema:
**[references/verified-skill-schema.md](references/verified-skill-schema.md)**.

The `embed_text` field is the primary semantic signal, embedded by
bge-small-en-v1.5 (384-dim, via Xinference) for HNSW search — a plain-English
description of what the function does, not its signature.

---

## VerificationGate Steps

The VerificationGate is the trust signal for the skill library: three
conditions (static AST scan → kernel assertion + evidence-URN validation →
example execution) must all pass before a write is accepted; failures are
quarantined to `code-harness-skills-rejected`. Full step code, banned-API list,
reject reasons, and the pass/reject store snippets:
**[references/verification-gate.md](references/verification-gate.md)**.

---

## Versioning

`VerifiedSkill` records are **immutable**. An updated skill body is stored under
a new URN `urn:agentbox:skill:<scope>:<name>:v<n+1>`. The previous version is
retained in `code-harness-skills` until it is demoted to
`code-harness-skills-archive` by `mcp/voyager/archive-old-versions.py` after
`[skills.voyager_skill_library].archive_after_days` days (default 30).

Archived skill URN suffix: `urn:agentbox:skill:<scope>:<name>:v<n>:archived`
(same URN identity, `:archived` suffix signals tier, per addendum).

**Retrieval by name** returns the highest-version active record by default.
Pin a specific version via the `version` filter in the retrieval query.

---

## Retrieval at Task Start

`codeact`, `pytorch-ml`, and any skill that opts in must run the following
search before the main task prompt:

```python
results = mcp__ruvector__memory_search(
    query=task_description,
    namespace="code-harness-skills",
    limit=3,
)
```

Inject retrieved `VerifiedSkill` bodies into the agent context as an
**"Available helper functions:" block**. Budget: ≤ 600 tokens total (three
function bodies). Truncate at natural function boundaries if over budget.

```
Available helper functions (from code-harness-skills):
def normalise_dataframe(df: pd.DataFrame, cols: list) -> pd.DataFrame:
    """Min-max normalise specified columns."""
    import pandas as pd
    ...
```

Both the lessons block (≤ 400 tokens) and the skills block (≤ 600 tokens) run
in parallel at task start. Combined budget ≤ 1,000 tokens.

---

## Activity Record Emission (addendum)

Every VerificationGate run (pass or fail) emits an `ex:Activity` record to
`code-harness-activities`, carrying only URN references (no function bodies, no
stdout/stderr) so it bypasses privacy redaction by design; a second record with
`verb=store` follows on successful store. Activity JSON schema:
**[references/verified-skill-schema.md](references/verified-skill-schema.md)**.

---

## Manifest Gates

```toml
[skills.voyager_skill_library]
enabled              = false  # set true; requires skills.code_interpreter.enabled = true
max_skill_body_lines = 80     # reject candidate skills exceeding this line count
archive_after_days   = 30     # demote superseded skill versions to archive namespace
max_evidence_age_s   = 3600   # verified_by trace URN must reference a trace younger than this
```

Validator rules:
- `E044`: `skills.voyager_skill_library.enabled = true` requires
  `skills.code_interpreter.enabled = true` (VerificationGate depends on
  KernelSession from kernel MCP). Hard error — blocks startup.
- `W043`: `features.expel_lesson_extraction.enabled = true` without
  `skills.code_interpreter.enabled = true` is accepted but noted.

---

## Implementation Notes

- The implementation lives at `mcp/voyager/verify-and-store.py` (Phase 2
  write-gate implementation) and `mcp/voyager/archive-old-versions.py`
  (scheduled archival job).
- All RuVector writes use `mcp__ruvector__memory_store` exclusively. Never
  raw SQL, never `claude-flow memory *` CLI (ADR-015 mandate).
- The `embed_text` field is the primary semantic signal embedded by
  bge-small-en-v1.5 (384-dim, via Xinference) for HNSW search. Write it as a
  plain-English description of what the function does, not its signature.
- URNs minted via `management-api/lib/uris.js`. Never construct with ad-hoc
  string formatting in application code.
- `sandbox_check.py` reused from `mcp/code-interpreter/`. Never duplicate.

---

## Related Files

- `mcp/voyager/verify-and-store.py` — VerificationGate + RuVector write.
- `mcp/voyager/archive-old-versions.py` — scheduled archival cron job.
- `mcp/code-interpreter/sandbox_check.py` — static AST scanner (reused).
- `skills/expel-lesson-extractor/SKILL.md` — Phase 1 lesson extractor.
- `skills/codeact/SKILL.md` — retrieves skills at task start.
- `ontology/code-harness.ttl` — OWL2 class declarations.
- `docs/developer/code-harness-multi-tier-memory.md` — namespace / class table.
- `docs/archive/adr/ADR-019-experiential-skill-learning.md` — canonical decision.
- `docs/archive/prd/PRD-008-code-as-harness-integration.md` §3.5 / §7 Phase 2b.
- `docs/archive/ddd/DDD-005-code-execution-domain.md` §VerifiedSkill aggregate.
