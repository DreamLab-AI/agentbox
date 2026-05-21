# ADR-011: Consultation MCP servers as the meta-router

**Status:** Accepted
**Date:** 2026-04-25
**Author:** Agentbox team
**Supersedes:** n/a
**Related:** ADR-005 (Pluggable adapter architecture), ADR-008 (Privacy filter routing), PRD-005 (Meta-router and consultant tier), ADR-026 in claude-flow (3-tier model routing)

## TL;DR for newcomers
*Skip if you already know why "consultants" beats "meta-router" for agentbox.*

Operators kept asking for a meta-router that picks among Claude / Codex / Gemini / Z.AI / Perplexity / DeepSeek per request. The mature OSS option (`musistudio/claude-code-router`, 28k stars) solves the *cost-optimisation rewriting* problem — intercept Claude API requests, send some of them to cheaper providers transparently. That's not the right shape for agentbox. Agentbox's existing patterns (MCP-everywhere, per-user CLI isolation, RuVector-backed memory, ADR-043 quality signals) align with **named consultants over MCP**, not transparent rewriting. This ADR formalises that decision: five consultant MCP servers, one slash-command for manual dispatch, one subagent template for automatic dispatch, all auditable. The cost-rewriting router stays a future optional add-on.

**If you remember only one thing:** treat external LLMs as labelled consultants the coordinator explicitly invokes — not as anonymous backends a router silently switches between.

For the deep version, keep reading.

## Context

Agentbox already speaks MCP everywhere (claude-flow MCP, ruflo MCP, codebase-memory MCP, opf-router for privacy). Operators install multiple LLM frontends side-by-side under user-isolated home directories: `openai-user/.codex`, `gemini-user`, `zai-user`. The recurring ask is "let me route between them in chat, manually or automatically".

### What the popular OSS solution actually solves

[`musistudio/claude-code-router`](https://github.com/musistudio/claude-code-router) is the most mature project in the space (28k stars, 2.2k forks). It runs as an HTTP proxy in front of Claude Code's Anthropic-format API client. Its router function reads `req.body.messages`, applies a token-count or scenario heuristic, picks a provider (`deepseek`, `gemini`, `openrouter`, …), rewrites the request to that provider's wire format via a transformer plugin, and returns the answer. Subprocess CLIs are supported only experimentally via gist-based plugins. Each call is stateless; no cross-provider context carryover.

The fit-gap with agentbox:

| Concern | claude-code-router | agentbox need |
|---|---|---|
| Trigger | per HTTP request | per task / per question |
| State | stateless, per-call | per-consultation memory in RuVector |
| Output | provider's response, transparent (operator doesn't know who answered) | explicit "Codex says…" with provenance |
| User-isolation | bypassed (proxy layer) | preserved (CLI keeps its own `CLAUDE_CONFIG_DIR`) |
| MCP context | stripped | curated excerpt passed |
| Audit trail | none | mandatory |

Adopting claude-code-router as the meta-router would force model-agnostic agent prompts, lose the audit trail, and defeat the per-user CLI isolation. The shape is wrong.

### What agentbox already has

| Primitive | Where | Purpose |
|---|---|---|
| `skill-router` skill | `skills/skill-router/SKILL.md` | manual dispatch via `/route <task>` |
| `mcp__claude-flow__hooks_model-route` | claude-flow MCP | autopilot model selection telemetry |
| TinyDancer 3-tier (claude-flow ADR-026) | claude-flow internals | vertical Anthropic-only routing |
| ruvector ADR-043 External Intelligence Providers | ruvector | trait-based seam for external quality signals into SONA |
| `Task({subagent_type})` | Claude Code | in-process delegation primitive |
| Per-user CLI dirs | agentbox container | `openai-user`, `gemini-user`, `zai-user`, `devuser` |
| MCP everywhere | claude-flow MCP, ruflo MCP, codebase-memory, opf-router | canonical wire for cross-system calls |

The seams to plug into already exist. The missing piece is a uniform `consult` contract over MCP, one server per provider.

## Decision

We add five MCP servers under `mcp/consultants/<name>/`, share one buildNpmPackage derivation, gate per-consultant via `[consultants.<name>].enabled` in `agentbox.toml`, and dispatch via two surfaces:

1. **Manual:** the `skill-router` skill gains a `### Consultants` routing section. Operators write `/consult <name> "<question>"` in chat; the router invokes `mcp__agentbox-consultants__<name>_consult`.
2. **Automatic:** a new `auto-consultant` subagent template (`agents/auto-consultant.md`) uses heuristics on the question (code keywords → codex, math → deepseek, "current"/"latest" → perplexity, Chinese characters → zai, large context → gemini) plus optional input from `hooks_model-route`.

Every consultation is appended to `/var/lib/agentbox/consultations/<consultant>-YYYY-MM-DD.jsonl`. When `consultants.intelligence_signal = true`, an ADR-043 `QualitySignal` JSON also lands under `/workspace/profiles/<stack>/intelligence/data/` so SONA learning can absorb the verdict.

### Wire contract

Three tools per consultant — identical surface across CLI-spawning and HTTPS-direct consultants:

| Tool | Purpose |
|---|---|
| `consult(question, context_excerpt?, format?, timeout_ms?)` | submit question + curated context, receive `{response, model, tokens, cost_usd, citations, latency_ms}` |
| `health()` | liveness + auth probe; returns `{ok, model, last_error, last_check_at, version?}` without consuming a paid call where possible |
| `cost_estimate(question_size, expected_response_size?)` | pre-call USD estimate so coordinators can budget |

Full schema in [PRD-005 §3](../prd/PRD-005-meta-router-consultants.md#3-wire-contract).

### Implementation layout

```
mcp/consultants/
├── README.md
├── package.json                  # one buildNpmPackage; bin entries per consultant
├── shared/
│   ├── consultant-base.js        # MCP server scaffolding (~250 lines)
│   ├── memory-logger.js          # JSONL audit + ADR-043 signal writer
│   └── spawn-cli.js              # subprocess helper with timeout + isolated env
├── codex/server.js               # spawns /usr/local/bin/codex exec --json
├── gemini/server.js              # spawns gemini --model … --prompt …
├── zai/server.js                 # spawns claude-zai -p … under zai-user HOME
├── perplexity/server.js          # POST api.perplexity.ai/chat/completions
└── deepseek/server.js            # POST api.deepseek.com/v1/chat/completions
```

Single buildNpmPackage derivation packages the whole tree. Each `<consultant>/server.js` requires `../shared/consultant-base.js` directly — no per-consultant npm publish, no symlink farm, no workspace plumbing.

### Validator rules

`scripts/agentbox-config-validate.js` adds:

| Code | Condition |
|---|---|
| **E035** | `consultants.<name>.enabled` requires the matching `providers.<provider>.enabled` |
| **E036** | any sub-consultant enabled requires `consultants.enabled` (master gate) |
| **E037** | `codex` consultant requires `toolchains.codex`; `antigravity` consultant requires `toolchains.antigravity_cli` |
| **E038** | `intelligence_signal=true` requires `AGENTBOX_INTELLIGENCE_DIR` or `WORKSPACE` env var |

### Why not: claude-code-router as the meta-router

Documented above. Wrong layer, wrong stateless semantics, wrong opacity, wrong isolation story. Stays a *future optional* Phase-3 add-on for cost-rewriting *only* — not the meta-router itself.

### Why not: a fan-out / consensus tool

A "ask three consultants and reconcile" tool is tempting but premature. Phase 1 ships the contract; Phase 4 may add a dedicated consensus tool that reuses the contract. Shipping consensus before the contract has live use forces design decisions on incomplete data.

### Why not: a sixth ADR-005 adapter slot

Consultants are tools, not durable-state integrations. The five ADR-005 slots (beads, pods, memory, events, orchestrator) all hold state across runs; a consultation is request/response. Forcing consultants through the adapter contract would add ceremony with no benefit.

### Why not: extend `skills/openai-codex/mcp-server` with provider switching

That server uses the OpenAI Node SDK to talk directly to the OpenAI HTTP API for GPT-5.4 — distinct from the Codex CLI subprocess this ADR's `codex` consultant spawns. Different code paths, different auth (HTTP-API key vs CLI config), different isolation properties. Keep them separate; document the distinction.

## Consequences

### Positive

- **Coordinator-led, explicit.** `/consult deepseek "verify this proof"` is unambiguous. The user knows who answered.
- **Audit trail by construction.** Every call is JSONL-logged before the response returns to the coordinator.
- **User isolation preserved.** Each CLI-spawning consultant uses its own HOME and credentials.
- **No new transport.** MCP-everywhere unchanged.
- **SONA learning loop closes.** Signal files land in the path ADR-043's `FileSignalProvider` watches.
- **Per-consultant cost visibility.** `cost_estimate` before the call, `cost_usd` after — operators see what each consultant costs them.

### Negative

- **Five servers to maintain.** Each provider's pricing, auth, response shape can drift; we own that. Mitigation: shared base class minimises per-consultant code (~80 lines each).
- **Heuristic classifier.** The `auto-consultant` heuristics are deliberately simple. Misses are inevitable; we log them so the table can be tuned. SONA absorbs the outcome data, eventually replacing the static table.
- **Per-day cost ceilings only enforced in Phase 4.** Today the coordinator can run up a bill. Mitigation: `cost_estimate` makes the bill visible per call; operators set provider-side rate limits.
- **CLI-spawn latency.** `codex`, `gemini`, `zai` pay subprocess startup cost (~200-500 ms). HTTPS-direct (perplexity, deepseek) avoid it but pay TLS handshake. Acceptable for explicit consultations, not for hot-path use.

## Service-level objectives

Mirrored in PRD-005 §7. Contract test names:

- `tests/contract/consultant-base.contract.spec.js` — covers `consult / health / cost_estimate` envelope shape, error semantics, timeout enforcement, atomic JSONL append.
- `tests/contract/consultant-<name>.contract.spec.js` — per-consultant smoke against a stub backend.

CI gate: `tests/contract/consultant-*.spec.js` runs in `.github/workflows/contract-tests.yml`; path trigger already covers `mcp/consultants/**`.

## Observability

Per-consultant Prometheus counters and histograms exposed via management-api `/metrics`:

- `consultant_calls_total{consultant, outcome}`
- `consultant_latency_ms{consultant, op}`
- `consultant_tokens_total{consultant, kind}`
- `consultant_cost_usd_total{consultant}`
- `consultant_health{consultant}`

OTLP spans: `agentbox.consultant.<name>.{consult,health,cost_estimate}`. Coordinator's trace context propagates through the MCP call so end-to-end timing is visible in the same trace.

## Security

- Per-call `timeout_ms` enforced by `consultant-base.js`. Hard ceiling 600 s.
- Subprocess env scrubbed by `spawn-cli.js`: only `PATH`, `HOME`, and explicitly-passed variables. No leakage of devuser secrets into a sibling user's process.
- Question + context_excerpt pass through the [privacy-filter middleware](../adr/ADR-008-privacy-filter-routing.md) at the `outbound` policy slot when `[privacy_filter].enabled = true`. PII does not leave the container unredacted.
- Audit log lives at `/var/lib/agentbox/consultations/` — writable mount under the hardened baseline. New `[security.exceptions.consultants]` block adds the volume; W021 fires if the master gate is on without it.
- No new ports. MCP servers run on stdio under Claude Code's spawn lifecycle.

## Follow-ups (non-blocking)

- Phase 3 — vendor `claude-code-router` as an opt-in HTTP-API cost-rewriting layer. Strictly orthogonal to the consultant tier.
- Phase 4 — per-day cost-ceiling enforcement in `consultant-base.js`; typed `CostCeilingExceeded` error.
- Streaming consult — extend the contract with an `op="consult.stream"` SSE flow when MCP gains stable streaming.
- Fan-out / consensus tool that reuses the contract.

## Related files

- `mcp/consultants/` — implementation
- `agentbox.toml` — `[consultants.*]` blocks
- `schema/agentbox.toml.schema.json` — schema additions
- `scripts/agentbox-config-validate.js` — E035-E038
- `flake.nix` — `consultantsPkg` derivation + appRoot copy
- `skills/skill-router/SKILL.md` — `### Consultants` routing section
- `agents/auto-consultant.md` — automatic dispatcher
- `docs/user/consultants.md` — operator guide
- `docs/reference/prd/PRD-005-meta-router-consultants.md` — product requirements
