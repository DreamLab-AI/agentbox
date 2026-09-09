---
name: openai-codex
description: "Delegate a coding or reasoning task to OpenAI Codex (GPT-6 Astra) via MCP for a second opinion from a non-Claude model. Use when you want to cross-check a hard algorithm, design, or refactor against a different frontier model, or get an independent bug/security/performance review of a code snippet. Not for tasks Claude handles directly, chain-of-thought traces (use deepseek-reasoning), live web research (use perplexity-research), or GitHub-PR review swarms (use github-code-review)."
mcp_server: true
protocol: stdio
entry_point: mcp-server/server.js
---

# OpenAI Codex Skill

Bridges OpenAI GPT-6 Astra into the Ruflo multi-agent environment as a first-class MCP tool.

## Tools

| Tool | Description |
|------|-------------|
| `codex_generate` | Generate code, solve algorithmic problems, or get architectural advice from GPT-6 Astra |
| `codex_review` | Submit code for bug/security/performance review by GPT-6 Astra |

## When Not To Use

- For tasks Claude can handle directly -- only delegate to Codex when you specifically need GPT-6 Astra capabilities
- For multi-step reasoning with chain-of-thought traces -- use the deepseek-reasoning skill instead
- For web research or fetching live information -- use the perplexity-research or gemini-url-context skills instead
- For code review on GitHub PRs with swarm coordination -- use the github-code-review skill instead

## Status: reference-only, not the live bridge

The bundled `mcp-server/` (this skill's `codex_generate`/`codex_review` tools, calling the
raw `openai` SDK directly) is **not registered as an MCP server anywhere** — it is legacy
code kept only because `flake.nix` (~573-578), the repo's prefetch-hashes.sh, and the
entrypoint (`config/entrypoint-unified.sh` ~841) prefetch it as an npm closure. It is not
symlinked into `~/.claude/skills` (this skill is absent from `registered-skills.txt`) and no
reconciler auto-discovers `entry_point`/`mcp_server` frontmatter for it. Read it as
documentation of a superseded approach, not as something to debug when Codex delegation
fails.

The live GPT-6 Astra bridge is the **`consultant-codex`** MCP server
(`/opt/agentbox/mcp/consultants/package/codex/server.js`, registered in `skills/mcp.json`),
reached on demand by the MCP client — not a standing supervisord program. Its tools are
`consult`, `health`, and `cost_estimate`. Use it directly, or via the `codex-companion`
skill's higher-level commands.

## Architecture (legacy bridge, as designed)

- Would run as `devuser`, invoked directly over stdio MCP protocol (no pseudo-user; the
  `openai-user`/UID-1002 model is retired estate-wide)
- API key injected from `$OPENAI_API_KEY` environment variable
- Superseded by `consultant-codex` — see Status above

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | (required) | OpenAI API key |
| `OPENAI_DEFAULT_MODEL` | `gpt-6-astra` | Model to use for completions |

## Addendum (2026-09-08): large-context reviews go through `codex exec`

This MCP bridge and the `consultant-codex` server take a pasted excerpt only. For reviews
that must read a whole repository or a multi-document bundle (the model has a
one-million-token context), use the direct CLI path documented in
`skills/codex-companion/SKILL.md` under "Two consultation paths". Model for both paths:
`gpt-6-astra`.
