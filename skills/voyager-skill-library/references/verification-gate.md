# VerificationGate Steps

The VerificationGate is the trust signal for the skill library. All three
conditions must pass before a write is accepted.

## Step 1: Static AST scan (sandbox_check.py)

```bash
python3 mcp/code-interpreter/sandbox_check.py <candidate_body_file.py>
```

BannedAPI detected → reject immediately with reason `"static-check-failed"`.
Banned APIs (v1): `subprocess`, `os.fork`, `os.exec*`, `os.system`, `socket`,
`ctypes`, `cffi`, `multiprocessing`. See `sandbox_check.py` for full list.

Step 1 always runs first. If it fails, Steps 2 and 3 are not executed.

## Step 2: Kernel assertion execution + evidence URN validation

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

## Step 3: Example execution

For each entry in `examples`, exec the function call and compare the repr of
the output with `expected_output_repr`. Any mismatch or exception → reject
with reason `"example-mismatch"`.

## On pass: mint URN and store

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

## On rejection: quarantine

```python
mcp__ruvector__memory_store(
    namespace="code-harness-skills-rejected",
    key=f"rejected:{name}:{short_timestamp}",
    value=f"Rejected: {reason} | {json.dumps(rejection_record)}",
    source_type="ex:VerifiedSkillRejected",
    upsert=False,
)
```
