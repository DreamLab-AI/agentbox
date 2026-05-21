# PRD-005: Meta-router and consultant tier

**Status:** Draft v1
**Date:** 2026-04-25
**Repo:** [github.com/DreamLab-AI/agentbox](https://github.com/DreamLab-AI/agentbox)
**Related:** ADR-005 (Pluggable adapter architecture), ADR-011 (Consultation MCP servers), ADR-026 in upstream claude-flow (3-tier model routing), ADR-043 in ruvector (External Intelligence Providers), PRD-001 (Capabilities and adapters)

## TL;DR for newcomers
*Skip if you already know why "meta-router" and "consultant" are different problems.*

Agentbox runs many LLM frontends — Claude Code, ruflo, the Codex Rust CLI, Google's Antigravity CLI (agy), the Anthropic-compatible claude-zai (Z.AI / GLM), and direct HTTPS providers (Perplexity, DeepSeek). Operators repeatedly ask for "one router that picks the right model". Two distinct asks live inside that question: **API cost optimisation** (rewrite Anthropic-format requests under the hood for cheaper providers, like `musistudio/claude-code-router`) and **explicit consultation** (the coordinator agent says "ask Codex about this Rust unsafe block" and gets a labelled answer back). They have different SLOs, different failure modes, different audit-trail requirements. We solve only the second one here as a first-class capability — five MCP servers exposing a uniform `consult / health / cost_estimate` contract, dispatched manually via `/consult` (a skill-router skill) or automatically via an `auto-consultant` subagent template. The first ask (HTTP-level cost rewriting) stays as an optional Phase-3 add-on.

**If you remember only one thing:** consultants are explicit, labelled, audited; cost-rewriting routers are stateless, transparent, anonymous. Don't conflate them.

For the deep version, keep reading.

## 1. Problem

Agentbox already has multiple LLM frontends installed and isolated:

| Frontend | Lives at | User isolation | Primary trait |
|---|---|---|---|
| Claude Code | `claude` on PATH | `devuser` | coordinator; orchestrates everything else |
| ruflo | `ruflo` on PATH | `devuser` | swarm orchestrator; Byzantine/Raft consensus; MCP-tool surface |
| OpenAI Codex Rust CLI | `/usr/local/bin/codex` (lib/codex-binary.nix) | `openai-user` | code reasoning, refactors |
| Google Antigravity CLI | `agy` on PATH | `devuser` | 1M-token context |
| claude-zai | `claude-zai` on PATH | `zai-user` | Anthropic-compatible Z.AI / GLM |
| OpenAI HTTP API | direct | n/a | already wrapped by `skills/openai-codex/mcp-server` |
| Anthropic HTTP API | direct via Claude Code | n/a | the coordinator's own backend |
| Perplexity HTTP API | direct | n/a | live-web research with citations |
| DeepSeek HTTP API | direct | n/a | math + transparent reasoning |

What is missing: a uniform way for the coordinator (Claude / ruflo) to invoke any of these frontends as a *named expert consultant*, get a labelled answer back, log the consultation, and (optionally) feed the outcome into SONA's learning loop. Today the only mechanism is to either:

- spawn a subprocess in an ad-hoc shell call (loses the response, no audit trail), or
- write a one-off MCP server per provider, each with its own bespoke contract.

Operators have asked for "a meta router that can manage top level context and route to any of the harness or api options, by request as well as automatically". Surveying the landscape: `musistudio/claude-code-router` solves a related but different problem (API-level cost rewriting, no per-provider audit, stateless). The coordinator-with-consultants pattern fits agentbox's existing MCP-everywhere architecture and respects user isolation; the cost-rewriting router does not.

## 2. Principles

1. **Consultants are first-class, labelled, audited.** Every call returns provenance (`consultant`, `model`, `tokens`, `cost_usd`, `citations`, `latency_ms`). The coordinator and the operator both know who said what.
2. **One contract for all consultants.** Three tools: `consult`, `health`, `cost_estimate`. Identical wire shape across CLI-spawning and HTTPS-direct consultants.
3. **MCP over the entire transport.** No new wire format. No HTTP proxy. Every consultant is an MCP server registered in `skills/mcp.json`; Claude Code spawns it on stdio when a tool is called.
4. **User isolation is preserved.** Each CLI-spawning consultant invokes its CLI under the matching `<provider>-user` HOME with that user's credential dir intact. No leakage of devuser secrets into a sibling user's process.
5. **Manifest-gated, like every other agentbox feature.** `[consultants.enabled]` is the master gate; `[consultants.<name>].enabled` controls per-consultant inclusion. Disabled consultants add nothing to the image.
6. **Audit trail is non-optional when the tier is on.** JSONL append per consultant per day under `/var/lib/agentbox/consultations/`. Optional ADR-043 `QualitySignal` files when `[consultants.intelligence_signal] = true` so SONA can learn.
7. **Manual is the default; automatic is opt-in.** `/consult <name>` (skill-router) is the canonical surface. The `auto-consultant` subagent template is the optional Phase-2 classifier-driven dispatcher.

## 3. Wire contract

Every consultant MCP server exposes exactly three tools.

### 3.1 `consult`

```json
// Request
{
  "question":        "Is this Rust unsafe block sound?",
  "context_excerpt": "fn read_at(buf: *mut u8, ...) { ... }",
  "format":          "markdown",
  "timeout_ms":      120000
}

// Response (envelope)
{
  "ok":         true,
  "consultant": "codex",
  "response":   "<consultant's answer>",
  "model":      "gpt-5.4",
  "tokens":     { "prompt": 412, "completion": 180, "total": 592 },
  "cost_usd":   0.0021,
  "citations":  [],
  "latency_ms": 2143
}
```

### 3.2 `health`

```json
{
  "ok":            true,
  "consultant":   "codex",
  "model":         "gpt-5.4",
  "last_error":    null,
  "last_check_at": "2026-04-25T12:34:56Z",
  "version":       "rust-v0.124.0"
}
```

### 3.3 `cost_estimate`

```json
{
  "consultant":       "codex",
  "estimated_tokens": { "prompt": 400, "completion": 800 },
  "estimated_usd":    0.0042,
  "currency":         "USD"
}
```

## 4. Five consultants

| Consultant | Backend | Pricing model (indicative) | Strengths |
|---|---|---|---|
| `codex`      | OpenAI Codex Rust CLI subprocess (`/usr/local/bin/codex exec`) | $0.005/1k prompt, $0.015/1k completion (gpt-5.4) | code reasoning, refactors, test generation; respects per-user `CODEX_HOME` |
| `antigravity` | Google Antigravity CLI (`agy`) subprocess | $0.00125/1k prompt, $0.005/1k completion (gemini-2.5-pro) | 1M-token context; long-document and codebase-wide analysis |
| `zai`        | `claude-zai` subprocess (Anthropic-compatible Z.AI endpoint) | $0.0006/1k prompt, $0.0024/1k completion (glm-5) | Chinese-language reasoning, low-cost second opinions |
| `perplexity` | Perplexity HTTPS API direct | $0.003/1k prompt, $0.015/1k completion (sonar-pro) | live-web research with citations |
| `deepseek`   | DeepSeek HTTPS API direct | $0.00055/1k prompt, $0.00219/1k completion (deepseek-reasoner) | math + transparent chain-of-thought reasoning |

## 5. Manifest model

```toml
[consultants]
enabled              = false
log_dir              = "/var/lib/agentbox/consultations"
intelligence_signal  = false

[consultants.codex]
enabled    = false
model      = "gpt-5.4"
home       = "/home/openai-user/.codex"
timeout_ms = 180000

# … same shape for gemini, zai, perplexity, deepseek
```

### Validator rules

| Code | Condition |
|---|---|
| **E035** | `consultants.<name>.enabled = true` requires the matching `providers.<provider>.enabled = true` (mapping below) |
| **E036** | Any sub-consultant enabled requires `consultants.enabled = true` |
| **E037** | `consultants.codex` requires `toolchains.codex = true`; `consultants.antigravity` requires `toolchains.antigravity_cli = true` |
| **E038** | `consultants.intelligence_signal = true` requires `AGENTBOX_INTELLIGENCE_DIR` or `WORKSPACE` set in the env |

Provider mapping: `codex → openai`, `antigravity → gemini`, `zai → zai`, `perplexity → perplexity`, `deepseek → deepseek`.

## 6. Dispatch surfaces

### 6.1 Manual — `/consult <name> "<question>"`

The [`skill-router`](../../../skills/skill-router/SKILL.md) skill gains a `### Consultants` section. Operators (or agents acting on user instructions) can write `/consult deepseek "verify this proof"` in chat. The router classifies the intent, picks the matching consultant MCP, and forwards. Response is rendered with provenance: model, tokens, cost, citations.

### 6.2 Automatic — `auto-consultant` subagent

When the coordinator wants a second opinion but doesn't know which expert to ask (e.g. "get a second opinion on this design"), spawn the `auto-consultant` agent template via the standard `Task({ subagent_type: "auto-consultant", prompt: "..." })` mechanism. The template uses heuristics on the question (code keywords → codex, math keywords → deepseek, "current" / "latest" → perplexity, Chinese characters → zai, large context → gemini) plus optional input from `mcp__claude-flow__hooks_model-route` if the autopilot is on. Returns the consultant's labelled response.

## 7. Service-level objectives

| Operation | p95 latency | Throughput floor | Error ceiling |
|---|---|---|---|
| `consult` (HTTP-direct: perplexity, deepseek) | 4 s | 5 req/s per consultant | 1 % |
| `consult` (CLI-spawn: codex, gemini, zai) | 8 s | 2 req/s per consultant | 2 % |
| `health` | 200 ms | 50 req/s | 0.5 % |
| `cost_estimate` | 5 ms | 500 req/s | 0 % |
| Audit-log write | 5 ms | matched to consult rate | 0 % |

Measured at p95 over a 7-day window. Health checks consume credits on Perplexity (no metadata endpoint) but stay within rate limits.

## 8. Observability

Per-consultant Prometheus counters and histograms (exposed via management-api at the existing `/metrics` port):

- `consultant_calls_total{consultant, outcome}` — counter
- `consultant_latency_ms{consultant, op}` — histogram (op ∈ consult, health, cost_estimate)
- `consultant_tokens_total{consultant, kind}` — counter (kind ∈ prompt, completion)
- `consultant_cost_usd_total{consultant}` — counter
- `consultant_health{consultant}` — gauge ∈ {0 unhealthy, 1 healthy}

Spans: `agentbox.consultant.<name>.<op>`, attached to the OTLP pipeline configured at `[observability].otlp_endpoint`. Trace context propagates from the coordinator through the MCP `consult` call so end-to-end timing is visible.

JSONL audit log path: `/var/lib/agentbox/consultations/<consultant>-<YYYY-MM-DD>.jsonl`. One row per call with `{id, ts, consultant, question, context_size, response_len, model, tokens, cost_usd, latency_ms, ok, error?, citations}`.

## 9. Goals and non-goals

### Goals

1. Five consultants ship behind manifest gates, all green on the `consult / health / cost_estimate` contract.
2. Manual `/consult <name>` works from any chat session that has agentbox's MCP registered.
3. Automatic `auto-consultant` subagent picks correctly on a defined heuristic table; misses are logged so the table can be tuned.
4. Every consultation is auditable in JSONL within 5 ms of completion.
5. User isolation preserved — `codex` consultant cannot read `gemini-user` env; `zai` consultant cannot read `openai-user` config.
6. Per-day cost ceilings per consultant; the consultant returns a typed `CostCeilingExceeded` error rather than continuing.

### Non-goals

1. **Not** a transparent API rewriter. We do not silently swap the model behind a Claude Code request.
2. **Not** a RAG layer. The consultant receives the curated `context_excerpt` the coordinator chose; consultants do not reach into RuVector or any other store.
3. **Not** a streaming surface. Consultations are request/response. Streaming is a Phase-3 addition.
4. **Not** a fan-out tool. Each `consult` call hits exactly one consultant. The coordinator decides whether to call multiple.
5. **Not** a substitute for the existing OpenAI HTTP-API consultant at `skills/openai-codex/mcp-server`. That stays as-is; the `codex` consultant defined here is distinct (CLI subprocess, different auth path).

## 10. Sequencing

| Phase | Scope | Status |
|---|---|---|
| 1 | Five consultant MCP servers, manifest gates, validator rules, packaging, skill-router routing, ADR/PRD, operator guide | landed in this PR |
| 2 | `auto-consultant` agent template, classifier heuristics, ADR-043 signal writes | landed in this PR |
| 3 | Optional `claude-code-router` HTTP-cost-rewriting layer (separate, opt-in, not the meta-router) | future |
| 4 | Streaming consult, fan-out tool for "ask all consultants and merge", per-day cost ceilings enforced in code | future |

## 11. References

- [ADR-011 — Consultation MCP servers and the meta-router decision](../adr/ADR-011-consultation-mcps.md)
- [ADR-005 — Pluggable adapter architecture](../adr/ADR-005-pluggable-adapter-architecture.md) (consultants are NOT a sixth adapter slot — they are tools, not durable-state integrations)
- [`skills/skill-router/SKILL.md`](../../../skills/skill-router/SKILL.md) — the manual dispatch table
- [`docs/user/consultants.md`](../../user/consultants.md) — operator guide
- [`mcp/consultants/README.md`](../../../mcp/consultants/README.md) — implementation notes
- ruvector ADR-043 External Intelligence Providers — the SONA learning seam
