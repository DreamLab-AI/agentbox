# Web Summary — architecture and operations

Depth for the `web-summary` skill. The lean trigger surface lives in `SKILL.md`;
this file holds the diagram, LLM backend wiring, env vars, and troubleshooting.

## Architecture

```
┌─────────────────────────────┐
│  Claude Code / VisionClaw   │
│  (MCP Client)               │
└──────────────┬──────────────┘
               │ MCP Protocol (stdio)
               ▼
┌─────────────────────────────┐
│  Web Summary MCP Server     │
│  (agentbox-mcp web-summary, │
│   Rust rmcp)                │
└──────────────┬──────────────┘
               │ HTTP · OpenAI /v1/chat/completions
               ▼
┌─────────────────────────────┐
│  Ontology Loom facade       │
│  (192.168.2.132:8084/v1)    │
│  model-swappable LLM door    │
└─────────────────────────────┘
```

### LLM backend — the Ontology Loom facade

The former Z.AI service (supervisord program `claude-zai`, port 9600) is
**retired** — the port refuses connections and no such program exists. The skill
now routes LLM calls through the **Ontology Loom facade**, the load-bearing,
model-swappable external-LLM door (agentbox ADR-051 / VisionClaw PRD-025).

- Primary endpoint: `http://192.168.2.132:8084/v1` (OpenAI-compatible
  `/chat/completions`). The facade grounds each call in the ontology and
  delegates to whatever model sits behind it (currently Qwen3.8-27B on `:8085`),
  so this skill never changes when the model is swapped.
- Sidecar alternative (Deployment B): `http://loom:8080/v1` on
  `visionclaw_network` (compose profile `loom`).
- Health without a model round-trip: `curl -s http://192.168.2.132:8084/health`.
- **Never target `192.168.2.48`** — HP's old address is dead and black-holes
  every synthesis into a timeout.

If the Loom is unavailable, fall back to the built-in summarisation path: any
live LLM the agent already has (consultant tier, or the model behind the Loom
directly on `:8085`) can be pointed at via `LLM_URL`.

### Multi-URL and structured extraction

For multi-URL comparison or structured data extraction from URLs, use the
`web-researcher` skill's `scrape_page` / `search_and_scrape` (full PDF/DOCX/
YouTube extraction, verifiable citations) or the `browser` sidecar for
JS-rendered pages. The old `gemini-url-context` route is dead — its `gemini`
CLI is not installed in this image.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_URL` | `http://192.168.2.132:8084/v1` | OpenAI-compatible base of the Loom facade. Falls back to `ZAI_URL` if set (legacy). |
| `LLM_MODEL` | `loom` | Model name passed to the facade (the facade swaps the real model behind it). |
| `LLM_TIMEOUT` | `120` | Request timeout in seconds. Falls back to `ZAI_TIMEOUT` (legacy). |

`call_zai` remains as a backward-compatible alias of `call_llm` for any external
importer; both call the Loom facade.

## Troubleshooting

**LLM connection failed:**

```bash
# Check the Loom facade is up (retrieval-only, no model round-trip)
curl -s http://192.168.2.132:8084/health

# Test a completion end-to-end
curl -s http://192.168.2.132:8084/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"loom","messages":[{"role":"user","content":"Say OK"}],"max_tokens":1536}'
```

If `/health` answers but completions hang, suspect a stale model-backend route
(the `.48`-is-dead trap), not a dead container — fix the route. Reasoning models
behind the Loom need `max_tokens >= 1536`; 400 truncates some to empty.

## VisionClaw integration

This skill exposes the `web-summary://capabilities` resource for discovery by
VisionClaw's MCP TCP client on port 9500.
