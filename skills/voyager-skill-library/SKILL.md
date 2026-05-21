---
name: voyager-skill-library
description: >
  Verified, executable skill primitives stored in RuVector under namespace
  `code-harness-skills` as ex:VerifiedSkill records (memory_type=procedural).
  A candidate skill (function + assertions + ≥1 example) is written only
  after VerificationGate passes: (a) all assertions execute clean under a
  fresh KernelSession via the code-interpreter MCP, (b) ≥1 example runs
  without exception, (c) sandbox_check.py finds no banned APIs. Skills are
  immutable + versioned (urn:agentbox:skill:<scope>:<name>:v<n>); old
  versions archived after 30 days. Retrieved at task start by CodeAct
  and injected as ICL prelude.
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

Every skill written to RuVector has the following structure. The `skill_urn`
uses the `skill` kind from ADR-013's 18 valid kinds — no new kind is invented.

```json
{
  "skill_urn": "urn:agentbox:skill:<scope-pubkey>:<name>:v<n>",
  "ontology_type": "ex:VerifiedSkill",
  "memory_type": "procedural",
  "name": "<snake_case_function_name>",
  "version": 1,
  "signature": "def normalise_dataframe(df: pd.DataFrame, cols: list) -> pd.DataFrame",
  "body_python": "import pandas as pd\n\ndef normalise_dataframe(...):\n    ...",
  "assertions": [
    "assert isinstance(normalise_dataframe(pd.DataFrame({'a': [1,2]}), ['a']), pd.DataFrame)"
  ],
  "examples": [
    {
      "input_repr": "pd.DataFrame({'a': [1, 2]}), ['a']",
      "expected_output_repr": "pd.DataFrame with 'a' column normalised to [0.0, 1.0]",
      "description": "Normalise a single numeric column"
    }
  ],
  "embed_text": "normalise a DataFrame column to [0, 1] range using min-max scaling",
  "scope": "data-pipeline",
  "verified_by": "urn:agentbox:activity:<scope>:trace-<short-id>",
  "verified_at": "<ISO-8601>",
  "max_evidence_age_s": 3600,
  "source_agent": "did:nostr:<hex-pubkey>",
  "owner_did": "did:nostr:<hex-pubkey>",
  "action_urn": "urn:agentbox:activity:<scope>:verify-<short-id>",
  "action_verb": "verify",
  "usage_count": 0
}
```

### Identity scheme fields (addendum)

| Field | Value | Purpose |
|---|---|---|
| `owner_did` | `did:nostr:<hex-pubkey>` | WHO created this skill. From env `AGENTBOX_AGENT_DID`. |
| `action_urn` | `urn:agentbox:activity:<scope>:verify-<short-id>` | WHAT action produced it. |
| `action_verb` | `"verify"` | Short queryable verb. |
| `source_agent` | same as `owner_did` | Kept for backwards compat with ADR-019 field list. |

Dev-mode fallback (no sovereign mesh): `owner_did = "did:nostr:local"`,
scope = `"local"`.

### Field definitions

| Field | Type | Constraints |
|---|---|---|
| `skill_urn` | string | `urn:agentbox:skill:<scope>:<name>:v<n>`. Minted via `management-api/lib/uris.js`. |
| `ontology_type` | string | Always `"ex:VerifiedSkill"`. |
| `memory_type` | string | Always `"procedural"` — signals durable, executable storage tier. |
| `name` | string | Snake-case function name; unique within scope. |
| `version` | int | Monotonically increasing; determined by querying existing records. |
| `signature` | string | Full Python function signature string. |
| `body_python` | string | Complete Python function body including imports; self-contained. |
| `assertions` | list[string] | Python assertion statements verified via `kernel.exec`. |
| `examples` | list[object] | At least one `{input_repr, expected_output_repr, description}`. |
| `embed_text` | string | Plain-English description embedded by MiniLM for HNSW search. |
| `scope` | string | Task domain(s) this skill applies to. |
| `verified_by` | string | `urn:agentbox:activity:<scope>:trace-<short-id>` — the ExecutionTrace URN proving the gate passed. |
| `verified_at` | string | ISO 8601 UTC timestamp. |
| `max_evidence_age_s` | int | From manifest; default 3600. The `verified_by` trace must be younger than this. |
| `usage_count` | int | Retrieved and used count; incremented post-task. |

---

## VerificationGate Steps

The VerificationGate is the trust signal for the skill library. All three
conditions must pass before a write is accepted.

### Step 1: Static AST scan (sandbox_check.py)

```bash
python3 mcp/code-interpreter/sandbox_check.py <candidate_body_file.py>
```

BannedAPI detected → reject immediately with reason `"static-check-failed"`.
Banned APIs (v1): `subprocess`, `os.fork`, `os.exec*`, `os.system`, `socket`,
`ctypes`, `cffi`, `multiprocessing`. See `sandbox_check.py` for full list.

Step 1 always runs first. If it fails, Steps 2 and 3 are not executed.

### Step 2: Kernel assertion execution + evidence URN validation

Spawn a fresh `KernelSession` (via code-interpreter MCP `kernel.reset` first
to ensure clean state), then:

```python
# Run the function body
kernel.exec(body_python)

# Run each assertion
for assertion in assertions:
    kernel.exec(assertion)  # Any exception or AssertionError → reject
```

Any exception or failing assertion → reject with reason `"assertion-failed"`.

**Evidence URN validation (Step 2.5, per ADR-019 §VerificationGate):**
The `verified_by` URN passed by the submitter must reference a real
`ex:ExecutionTrace` record retrievable via `memory_retrieve`. That trace must
have a `created_at` timestamp younger than `max_evidence_age_s`. Stale or
missing → reject with reason `"stale-evidence"`.

### Step 3: Example execution

For each entry in `examples`, exec the function call and compare the repr of
the output with `expected_output_repr`. Any mismatch or exception → reject
with reason `"example-mismatch"`.

### On pass: mint URN and store

```python
version = current_max_version + 1
skill_urn = f"urn:agentbox:skill:{scope}:{name}:v{version}"

mcp__ruvector__memory_store(
    namespace="code-harness-skills",
    key=f"skill:{scope}:{name}:v{version}",
    # value = embed_text (semantic hook) + full JSON
    value=f"{embed_text} | {json.dumps(record)}",
    source_type="ex:VerifiedSkill",
    upsert=True,
)
```

### On rejection: quarantine

```python
mcp__ruvector__memory_store(
    namespace="code-harness-skills-rejected",
    key=f"rejected:{name}:{short_timestamp}",
    value=f"Rejected: {reason} | {json.dumps(rejection_record)}",
    source_type="ex:VerifiedSkillRejected",
    upsert=False,
)
```

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

For every VerificationGate run (pass or fail), `verify-and-store.py` emits
an Activity record to `code-harness-activities`:

```json
{
  "activity_urn": "urn:agentbox:activity:<scope>:verify-<short-id>",
  "ontology_type": "ex:Activity",
  "memory_type": "episodic",
  "verb": "verify",
  "subject_did": "did:nostr:<hex-pubkey>",
  "object_urn": "urn:agentbox:skill:<scope>:<name>:v<n>",
  "started_at": "<ISO-8601>",
  "ended_at": "<ISO-8601>",
  "outcome": "ok|error",
  "evidence": ["urn:agentbox:activity:<scope>:trace-<short-id>"]
}
```

On successful store, a second Activity record is emitted with `verb=store`.
Activity records carry only URN references — no function bodies, no
stdout/stderr — so they bypass privacy redaction by design.

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
- The `embed_text` field is the primary semantic signal embedded by MiniLM
  for HNSW search. Write it as a plain-English description of what the
  function does, not its signature.
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
- `docs/reference/adr/ADR-019-experiential-skill-learning.md` — canonical decision.
- `docs/reference/prd/PRD-008-code-as-harness-integration.md` §3.5 / §7 Phase 2b.
- `docs/reference/ddd/DDD-005-code-execution-domain.md` §VerifiedSkill aggregate.
