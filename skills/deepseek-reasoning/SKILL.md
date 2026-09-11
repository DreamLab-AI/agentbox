---
name: deepseek-reasoning
description: >
  Use when the user says "ask deepseek", "consult deepseek", "delegate reasoning
  to deepseek", or wants a second opinion / an explicit chain-of-thought reasoning
  trace on a hard problem — root-cause debugging, algorithm design, dependency-aware
  task planning — from DeepSeek V4 Flash via the consultant-deepseek MCP tool
  (consult / health / cost_estimate). NOT for straightforward code generation or
  editing (Claude does that directly), web research (use perplexity-research),
  GitHub PR review (github-code-review), OpenAI delegation (openai-codex /
  codex-companion), or latency-sensitive calls (DeepSeek adds 2-5s per call).
version: 2.0.0
author: agentbox-claude
dependencies:
  - deepseek-api
---

# DeepSeek Reasoning Skill

Reach DeepSeek's reasoning model from Claude Code via the **`consultant-deepseek`**
MCP server. This is one of five uniform "consultant" bridges (codex, deepseek,
perplexity, antigravity, zai) under `/opt/agentbox/mcp/consultants/`, registered
in `skills/mcp.json`. It is launched on demand by the MCP client — there is no
supervisord program, no config file, and no bespoke bridge code in this skill.
DeepSeek acts as the reasoning planner; Claude executes.

## What it provides

- **Explicit reasoning traces** — DeepSeek V4 Flash returns its chain-of-thought
  in `message.reasoning_content`, which the consultant folds into the response
  under a `<reasoning>...</reasoning>` preamble ahead of the answer.
- **Root-cause analysis** — deep code/system debugging with a visible reasoning trail.
- **Task planning** — dependency-aware phase/task breakdowns.
- **Hybrid workflow** — Claude as executor, DeepSeek as reasoning planner.

## When not to use

- Straightforward code generation or editing — Claude handles this directly.
- Web research or live information — use perplexity-research.
- Code review on GitHub PRs — use github-code-review.
- OpenAI model delegation — use openai-codex or codex-companion.
- Latency-sensitive tasks — DeepSeek adds 2-5s per call; use Claude directly.

## Tools (MCP)

Three tools, the shape shared by every consultant server:

- **`consult`** — submit a question (and optional curated context) and get an
  answer with model, token usage, cost, and citations.
- **`health`** — liveness + auth probe. No paid call.
- **`cost_estimate`** — estimate USD cost from question/response token counts.

Full parameter and return schemas: [`references/tools.md`](references/tools.md).

## Configuration

- Model: `AGENTBOX_DEEPSEEK_MODEL` env var, default `deepseek-v4-flash`
  (`agentbox.toml` `[consultants.deepseek] model`).
- Auth: `DEEPSEEK_API_KEY` from session env (optional `DEEPSEEK_BASE_URL` override
  for a non-default endpoint). No credential file.
- Gate: `env:AGENTBOX_CONSULTANTS_ENABLED`.

## References

- [`references/tools.md`](references/tools.md) — tool signatures, return schemas, DeepSeek-vs-Claude comparison.
- [`references/workflows.md`](references/workflows.md) — invocation examples, hybrid workflow, advanced usage, best practices.
- [`references/operations.md`](references/operations.md) — real wiring, health checks, troubleshooting.
