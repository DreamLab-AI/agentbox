# Extraction Prompt Template

The extraction prompt is deterministic and templated. It takes three inputs:

1. **task_summary** — one-paragraph description of what the task attempted.
2. **success** — boolean terminal outcome.
3. **tool_calls** — last 10 tool call entries from the trajectory (tool name +
   truncated stdout/stderr, privacy-filtered before passing to the prompt).

The prompt constrains the LLM to return only JSON matching the lesson schema,
which makes write-gate validation cheap (JSON schema check only, no semantic
judge).

```
SYSTEM: You are a post-task lesson extractor. Analyse the trajectory below and
emit 0-N generalisable rules in the form "IF <scope-condition> THEN
<action-rule>". Rules must be scope-specific (cite the task type or skill),
must reference a concrete observed outcome from the trajectory (stdout,
assertion result, test pass/fail), and must be concise (max 200 characters per
rule). Output a JSON list of objects with fields: rule, scope, evidence_claim
(one sentence citing the observed outcome). Output an empty list [] if no
generalisable rule can be grounded in the trajectory.

USER:
task_summary: {{task_summary}}
success: {{success}}
tool_calls:
{{tool_calls_json}}
```

The agent runtime calls `mcp/expel/distil.py` with the trajectory data;
`distil.py` formats this prompt, calls the LLM, validates the JSON response,
applies privacy filtering, and writes the lessons.
