---
name: deepseek-reasoning
description: >
  Use when the user says "ask deepseek", "consult deepseek", "delegate reasoning
  to deepseek", or needs advanced multi-step Chain-of-Thought reasoning, deep
  debugging root-cause analysis, or dependency-aware task planning via DeepSeek's
  special reasoning endpoint (MCP bridge). NOT for straightforward code
  generation/editing (Claude does that directly), web research (use
  perplexity-research / gemini-url-context), GitHub PR review (github-code-review),
  OpenAI delegation (openai-codex), or latency-sensitive calls (DeepSeek adds 2-5s).
version: 1.0.0
author: agentbox-claude
mcp_server: true
protocol: mcp-sdk
entry_point: mcp-server/server.js
dependencies:
  - deepseek-api
---

# DeepSeek Reasoning Skill

Access DeepSeek's special reasoning-model endpoint from Claude Code via an MCP bridge.
DeepSeek acts as the reasoning planner; Claude executes.

## What it provides

- **Advanced reasoning** — structured multi-step Chain-of-Thought with explicit traces.
- **Root-cause analysis** — deep code/system debugging with reasoning trails.
- **Task planning** — dependency-aware phase/task breakdowns with a critical path.
- **Hybrid workflow** — Claude as executor, DeepSeek as reasoning planner.

## When not to use

- Straightforward code generation or editing — Claude handles this directly.
- Web research or live information — use perplexity-research or gemini-url-context.
- Code review on GitHub PRs — use github-code-review.
- Latency-sensitive tasks — DeepSeek adds 2-5s per call; use Claude directly.
- OpenAI model delegation — use openai-codex.

## Tools (MCP)

Three tools are exposed when the MCP server is running:

- **`deepseek_reason`** — complex multi-step reasoning / problem decomposition.
- **`deepseek_analyze`** — code/system analysis with root-cause reasoning.
- **`deepseek_plan`** — task planning with dependencies and critical path.

Full signatures, parameters, and return schemas: [`references/tools.md`](references/tools.md).

## Architecture (summary)

```
Claude Code (devuser)
  ↓ MCP (stdio)
DeepSeek MCP Server (mcp-server/server.js)
  ↓ direct spawn: node tools/deepseek_client.js
DeepSeek API Client
  ↓ HTTPS
api.deepseek.com (special endpoint, thinking mode)
```

Both server and client run as `devuser`; no sudo bridge, no separate OS user.

## References

- [`references/tools.md`](references/tools.md) — tool signatures, return schemas, DeepSeek-vs-Claude comparison.
- [`references/workflows.md`](references/workflows.md) — invocation examples, hybrid workflow, advanced usage, best practices.
- [`references/operations.md`](references/operations.md) — install, config, supervisord, manual testing, security, performance, troubleshooting.
