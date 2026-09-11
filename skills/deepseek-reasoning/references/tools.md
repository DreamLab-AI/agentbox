# DeepSeek Reasoning — Tools Reference

The `consultant-deepseek` MCP server exposes the same three tools every consultant
server exposes (`/opt/agentbox/mcp/consultants/shared/consultant-base.js`), backed
by DeepSeek's HTTPS API (`/opt/agentbox/mcp/consultants/package/deepseek/server.js`).

## consult

**Purpose:** Submit a question, with optional curated context, and get DeepSeek's
answer plus usage metadata.

**Parameters:**
- `question` (required) — the question or task to put to the consultant.
- `context_excerpt` (optional) — curated context to consider. Keep this small;
  pick what matters rather than pasting everything.
- `format` (optional) — `markdown|plain|json`, default `markdown`.
- `timeout_ms` (optional) — override the per-call timeout (default 120000, capped at 600000).
- `producer_family` (optional) — REC-8 anti-fox: set this when the consult is a
  cross-model closure verification of a change another model family produced.
- `ontology_context` (optional, boolean) — prepend budget-bounded ontology
  grounding (PRD-020 PULL-A). Fail-open; off by default.

**Returns:**
```json
{
  "ok": true,
  "consultant": "deepseek",
  "response": "<reasoning>\n...chain-of-thought...\n</reasoning>\n\n...answer...",
  "model": "deepseek-v4-flash",
  "tokens": { "prompt": 120, "completion": 340, "total": 460 },
  "cost_usd": 0.00081,
  "citations": [],
  "latency_ms": 3120,
  "consultation_urn": "urn:agentbox:activity:...:sha256-12-...",
  "source_urn": "..."
}
```

DeepSeek-v4-flash returns its chain-of-thought separately, in
`message.reasoning_content`; the server folds it into `response` under a
`<reasoning>...</reasoning>` preamble ahead of the answer, so the caller sees
both without a second field to check.

## health

**Purpose:** Liveness + auth probe. Does not consume a paid call.

**Parameters:** none.

**Returns:**
```json
{ "ok": true, "consultant": "deepseek", "model": "deepseek-v4-flash", "last_error": null, "last_check_at": "2026-09-09T12:00:00.000Z" }
```

`ok: false` with `last_error: "DEEPSEEK_API_KEY is not set"` is the common failure —
see [operations.md](operations.md) for the full troubleshooting flow.

## cost_estimate

**Purpose:** Estimate the USD cost of a `consult` call before making it.

**Parameters:**
- `question_size` (required) — approximate token count of the question + context excerpt.
- `expected_response_size` (optional, default 800) — approximate token count of the expected response.

**Returns:**
```json
{ "consultant": "deepseek", "estimated_tokens": { "prompt": 500, "completion": 800 }, "estimated_usd": 0.0021, "currency": "USD" }
```

Current DeepSeek pricing baked into the estimator: $0.00055 / 1K prompt tokens,
$0.00219 / 1K completion tokens (`deepseek/server.js`; check DeepSeek's own pricing
page for the authoritative current rate).

## DeepSeek vs Claude reasoning

| Aspect | DeepSeek V4 Flash | Claude Sonnet 5 |
|--------|--------------------|-------------------|
| Multi-step logic | Excellent | Very Good |
| Code generation | Good | Excellent |
| Reasoning transparency | Explicit `<reasoning>` trace | Implicit |
| Speed | Medium (2-5s) | Fast (<1s) |
| Cost | Lower | Higher |
| Best for | Planning, analysis | Execution, polish |

**Recommendation:** Use both in a hybrid workflow — DeepSeek plans, Claude executes.
