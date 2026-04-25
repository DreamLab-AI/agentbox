# Consultant MCP servers

Five MCP servers that expose external LLM providers as **consultants** the
Claude Code / ruflo coordinator can invoke explicitly. Each speaks the same
three-tool contract (`consult`, `health`, `cost_estimate`); the coordinator
chooses **which** consultant by intent (manual via the
[`skill-router`](../../skills/skill-router/SKILL.md) routing table or
automatic via the `auto-consultant` agent template).

| Consultant | Backend | Strength | Auth |
|------------|---------|----------|------|
| `codex`      | OpenAI Codex Rust CLI subprocess | code reasoning, refactors, test generation | `OPENAI_API_KEY`, `~/.codex` config |
| `gemini`     | `@google/gemini-cli` subprocess  | 1M-token context, long-document analysis | `GOOGLE_GEMINI_API_KEY` |
| `zai`        | `claude-zai` (Anthropic-API-compatible Z.AI/GLM) | Chinese-language, low-cost reasoning | `ZAI_ANTHROPIC_API_KEY`, `ZAI_URL` |
| `perplexity` | Perplexity HTTPS API (`sonar-pro`) | live web research with citations | `PERPLEXITY_API_KEY` |
| `deepseek`   | DeepSeek HTTPS API (`deepseek-reasoner`) | math + reasoning chain transparency | `DEEPSEEK_API_KEY`, optional `DEEPSEEK_BASE_URL` |

Specified by [PRD-005](../../docs/reference/prd/PRD-005-meta-router-consultants.md)
and [ADR-011](../../docs/reference/adr/ADR-011-consultation-mcps.md). Operator
guide at [docs/user/consultants.md](../../docs/user/consultants.md).

## Wire contract

Every consultant exposes exactly three tools.

### `consult(question, context_excerpt?, format?)`

```json
{
  "question": "Is this Rust unsafe block sound?",
  "context_excerpt": "fn read_at(buf: *mut u8, ...) { ... }",
  "format": "markdown"
}
```

Returns:

```json
{
  "response": "<consultant's answer>",
  "model": "<concrete model id>",
  "tokens": { "prompt": 412, "completion": 180, "total": 592 },
  "cost_usd": 0.0021,
  "citations": [],
  "latency_ms": 2143,
  "consultant": "codex"
}
```

### `health()`

```json
{
  "ok": true,
  "model": "gpt-5.4",
  "last_error": null,
  "last_check_at": "2026-04-25T12:34:56Z"
}
```

### `cost_estimate(question_size, expected_response_size?)`

```json
{
  "estimated_tokens": { "prompt": 400, "completion": 800 },
  "estimated_usd": 0.0042,
  "currency": "USD"
}
```

## Layout

```
mcp/consultants/
├── README.md                # this file
├── shared/                  # consultant-base.js + spawn-cli + logger
├── codex/                   # Rust Codex CLI subprocess
├── gemini/                  # @google/gemini-cli subprocess
├── zai/                     # claude-zai (Z.AI) subprocess
├── perplexity/              # Perplexity HTTPS
└── deepseek/                # DeepSeek HTTPS
```

Each directory is its own buildNpmPackage derivation in `flake.nix`, packaged
under `lib/npm-services.nix`, and is gated by `[consultants.<name>]` in
`agentbox.toml`. Disabled consultants add nothing to the image.

## Logging

Every `consult` call appends a JSONL row to
`/var/lib/agentbox/consultations/<consultant>-YYYY-MM-DD.jsonl` with the
question, response, model, tokens, cost, latency, and `ok` flag. When
`consultants.<name>.intelligence_signal = true`, an additional ADR-043
signal file is written to `/workspace/profiles/<stack>/intelligence/data/`
so SONA learning loops can absorb the verdict.

## Safety

- Every consultant honours a per-call timeout (default 120 s, configurable).
- Per-day cost ceiling per consultant; `consult` returns an error rather
  than exceeding it.
- Question + context excerpts pass through the [privacy-filter middleware](../../docs/user/privacy-filter.md)
  when `[privacy_filter].policy.outbound != "off"` so PII does not leak to
  external APIs.
- Each consultant logs the redacted version of the question alongside a
  hash of the original for audit-trail traceability.

## Extending

Add a new consultant by:

1. Creating `mcp/consultants/<name>/server.js` that imports
   `../shared/consultant-base.js` and supplies `callConsult`, `healthCheck`,
   `estimateCost`.
2. Adding the `[consultants.<name>]` block to `agentbox.toml.schema.json`
   and `agentbox.toml`.
3. Wiring the npm-service derivation in `flake.nix` (mirror `gemini` /
   `perplexity`).
4. Listing in the routing table in `skills/skill-router/SKILL.md` under
   `### Consultants`.

The base class handles the MCP wire (stdio transport, tool registration,
error envelopes, JSONL logging, timeout enforcement, redaction hand-off).
