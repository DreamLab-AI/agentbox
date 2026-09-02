# VerifiedSkill Record Schema

Every skill written to RuVector has the following structure. The `skill_urn`
uses the `skill` kind from ADR-013's 19 valid kinds (`decision` added by
ADR-048) — no new kind is invented.

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

## Identity scheme fields (addendum)

| Field | Value | Purpose |
|---|---|---|
| `owner_did` | `did:nostr:<hex-pubkey>` | WHO created this skill. From env `AGENTBOX_AGENT_DID`. |
| `action_urn` | `urn:agentbox:activity:<scope>:verify-<short-id>` | WHAT action produced it. |
| `action_verb` | `"verify"` | Short queryable verb. |
| `source_agent` | same as `owner_did` | Kept for backwards compat with ADR-019 field list. |

Dev-mode fallback (no sovereign mesh): `owner_did = "did:nostr:local"`,
scope = `"local"`.

## Field definitions

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
| `embed_text` | string | Plain-English description embedded by bge-small-en-v1.5 (384-dim, via Xinference) for HNSW search. |
| `scope` | string | Task domain(s) this skill applies to. |
| `verified_by` | string | `urn:agentbox:activity:<scope>:trace-<short-id>` — the ExecutionTrace URN proving the gate passed. |
| `verified_at` | string | ISO 8601 UTC timestamp. |
| `max_evidence_age_s` | int | From manifest; default 3600. The `verified_by` trace must be younger than this. |
| `usage_count` | int | Retrieved and used count; incremented post-task. |

---

## Activity Record Emission (addendum)

For every VerificationGate run (pass or fail), `voyager-gate` emits
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
