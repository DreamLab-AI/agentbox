# Consultants — explicit second opinion from another LLM

Five MCP servers expose external LLM providers as **named consultants** the
Claude Code / ruflo coordinator can invoke explicitly. Each returns a
labelled answer with provenance: model, token usage, cost, citations,
latency. Specified by [PRD-005](../reference/prd/PRD-005-meta-router-consultants.md)
and [ADR-011](../reference/adr/ADR-011-consultation-mcps.md).

## Why this exists

Agentbox runs many LLM frontends side-by-side. You want the coordinator
to **explicitly** ask a particular expert — "Codex, what about this Rust
unsafe block?" or "DeepSeek, verify this proof" — and get a **labelled**
answer back. Not a transparent silent rewrite that swaps providers under
the hood, which is what `claude-code-router` and similar projects do.

## When to skip this

- You only ever use Claude. The coordinator already does what you need.
- You want **automatic** API-cost optimisation that swaps providers
  transparently. That's a different problem; see ADR-011 §"Why not: claude-code-router".
- You're on the shipped default manifest and don't yet have any of the
  paid provider keys. Set `[consultants].enabled = false` and skip.

## The five consultants

| Name | Backend | Strengths |
|---|---|---|
| `codex`      | OpenAI Codex Rust CLI subprocess | code reasoning, refactors, test generation |
| `antigravity` | Google Antigravity CLI (`agy`) subprocess | 1M-token context for long-document and codebase-wide analysis |
| `zai`        | `claude-zai` (Z.AI / GLM-5, Anthropic-compatible) | Chinese-language reasoning; low-cost second opinions |
| `perplexity` | Perplexity HTTPS API | live-web research with citations |
| `deepseek`   | DeepSeek HTTPS API (`deepseek-reasoner`) | math + transparent chain-of-thought |

## Enabling

The setup wizard (`scripts/start-agentbox.sh`) has a Consultants section
for this. For manual editing:

```toml
# agentbox.toml
[consultants]
enabled              = true
intelligence_signal  = false   # set true to feed SONA's learning loop

[consultants.codex]
enabled    = true
model      = "gpt-5.4"
home       = "/home/devuser/.codex"
timeout_ms = 180000

# … same shape for antigravity, zai, perplexity, deepseek
```

Each enabled consultant requires its provider gate too:

| Consultant | Required provider | Required toolchain |
|---|---|---|
| `codex`      | `[providers.openai].enabled = true`     | `toolchains.codex = true` |
| `antigravity` | `[providers.gemini].enabled = true`    | `toolchains.antigravity_cli = true` |
| `zai`        | `[providers.zai].enabled = true`        | `toolchains.claude = true` (claude-zai is the wrapper) |
| `perplexity` | `[providers.perplexity].enabled = true` | (HTTP-only; no CLI) |
| `deepseek`   | `[providers.deepseek].enabled = true`   | (HTTP-only; no CLI) |

The validator enforces these via E035-E037; you'll see a clear error if a
gate is missing. Add the writable-volume exception when the master gate
is on:

```toml
[security.exceptions.consultants]
writable_volumes = ["consultations-data:/var/lib/agentbox/consultations"]
reason = "consultant tier writes JSONL audit log per call"
```

## Calling a consultant

### Manual — `/consult <name> "<question>"`

The simplest path. The `skill-router` skill recognises `/consult` and
forwards to the matching MCP tool:

```
/consult deepseek "verify this proof"
/consult perplexity "what's the 2026-04 status of the EU AI Act tier-2 requirements?"
/consult codex "is this Rust unsafe block sound?" with-context
/consult antigravity "summarise this 200-page contract"
/consult zai "translate and explain this technical Chinese paragraph"
```

The coordinator picks a `context_excerpt` from the current chat (curated
— don't pass the whole transcript) and hands it to the consultant. The
response is rendered with provenance:

```
[codex / gpt-5.4, 412→180 tokens, $0.0021, 2.1s]

The unsafe block is sound provided buf is non-null and aligned for u8…
```

### Automatic — `auto-consultant` subagent

When the coordinator wants a second opinion but doesn't know which
expert to ask, spawn the `auto-consultant` agent template:

```js
Task({
  subagent_type: "auto-consultant",
  prompt: "Get a second opinion on this design — pick the right expert."
})
```

Heuristics on the question pick the consultant; misses are logged so the
table can be tuned. Full template at [`agents/auto-consultant.md`](../../agents/auto-consultant.md).

### Direct MCP tool call

The MCP tools are also available directly under
`mcp__agentbox-consultants__<name>_consult` for agents that want to bypass
the slash-command:

```js
mcp__agentbox-consultants__deepseek_consult({
  question: "verify this proof",
  context_excerpt: "Theorem: …",
  format: "markdown"
})
```

## What you get back

Every consultation returns the same envelope:

```json
{
  "ok":         true,
  "consultant": "codex",
  "response":   "<the consultant's answer>",
  "model":      "gpt-5.4",
  "tokens":     { "prompt": 412, "completion": 180, "total": 592 },
  "cost_usd":   0.0021,
  "citations":  [],
  "latency_ms": 2143
}
```

Errors return `{ ok: false, consultant, error }` with `isError: true` on
the MCP envelope. Timeouts surface as `consultant <name>: timed out after
<ms> ms`.

## Audit trail

Every call appends a JSONL row to:

```
/var/lib/agentbox/consultations/<consultant>-<YYYY-MM-DD>.jsonl
```

```sh
docker exec agentbox tail -f /var/lib/agentbox/consultations/codex-$(date -u +%F).jsonl | jq
# {
#   "id": "1c8d…", "ts": "2026-04-25T13:14:15Z", "consultant": "codex",
#   "ok": true, "question": "Is this Rust unsafe block sound?",
#   "context_size": 318, "response_len": 712,
#   "model": "gpt-5.4", "tokens": {…}, "cost_usd": 0.0021,
#   "latency_ms": 2143, "citations": 0
# }
```

When `[consultants].intelligence_signal = true`, an ADR-043 `QualitySignal`
JSON also lands under
`/home/devuser/workspace/profiles/<stack>/intelligence/data/<consultant>-<id>.json`. The
SONA learning loop in ruvllm absorbs these so the auto-consultant
classifier improves over time.

## Cost visibility

Every consultant exposes `cost_estimate` before you commit:

```js
mcp__agentbox-consultants__perplexity_cost_estimate({
  question_size: 600,           // tokens
  expected_response_size: 800
})
// → { estimated_usd: 0.014, currency: "USD" }
```

Per-call cost is logged after the response. Aggregate via the JSONL or
the Prometheus counter `consultant_cost_usd_total{consultant}` at port
`[observability].metrics_port`.

## Common gotchas

- **`E035: providers.<provider>.enabled=false`** — you turned on a
  consultant but didn't enable the matching provider. Set
  `[providers.<provider>].enabled = true` and ensure its env var is
  in `.env`.
- **`E036: master gate off`** — set `[consultants].enabled = true` first.
- **`W021: missing security.exceptions.consultants`** — uncomment the
  writable-volume exception block in `agentbox.toml`.
- **CLI consultants timing out** — first call is always slow (subprocess
  startup, model load on the provider side). Subsequent calls are fast.
  Adjust `timeout_ms` in the consultant block.
- **PII in questions leaking to external APIs** — when
  `[privacy_filter].enabled = true` with `policy.outbound != "off"`, the
  privacy-filter middleware redacts the question + context_excerpt
  before they leave the container. See [privacy-filter.md](privacy-filter.md).

## Further reading

- [PRD-005 — Meta-router and consultant tier](../reference/prd/PRD-005-meta-router-consultants.md)
- [ADR-011 — Consultation MCP servers](../reference/adr/ADR-011-consultation-mcps.md)
- [ADR-005 — Pluggable adapter architecture](../reference/adr/ADR-005-pluggable-adapter-architecture.md) (consultants are tools, not durable-state adapters — different layer)
- [`mcp/consultants/README.md`](../../mcp/consultants/README.md) — implementation notes
- [`skills/skill-router/SKILL.md`](../../skills/skill-router/SKILL.md) — manual dispatch surface
