---
name: openai-codex
description: "Delegate a coding or reasoning task to OpenAI Codex (GPT-5.4) via MCP for a second opinion from a non-Claude model. Use when you want to cross-check a hard algorithm, design, or refactor against a different frontier model, or get an independent bug/security/performance review of a code snippet. Not for tasks Claude handles directly, chain-of-thought traces (use deepseek-reasoning), live web research (use perplexity-research), or GitHub-PR review swarms (use github-code-review)."
mcp_server: true
protocol: stdio
entry_point: mcp-server/server.js
---

# OpenAI Codex Skill

Bridges OpenAI GPT-5.4 into the Ruflo multi-agent environment as a first-class MCP tool.

## Tools

| Tool | Description |
|------|-------------|
| `codex_generate` | Generate code, solve algorithmic problems, or get architectural advice from GPT-5.4 |
| `codex_review` | Submit code for bug/security/performance review by GPT-5.4 |

## When Not To Use

- For tasks Claude can handle directly -- only delegate to Codex when you specifically need GPT-5.4 capabilities
- For multi-step reasoning with chain-of-thought traces -- use the deepseek-reasoning skill instead
- For web research or fetching live information -- use the perplexity-research or gemini-url-context skills instead
- For code review on GitHub PRs with swarm coordination -- use the github-code-review skill instead

## Architecture

- Runs as `devuser` via supervisord (skill files under ~/.claude/skills)
- Communicates over stdio MCP protocol
- Auto-discovered by `generate-mcp-settings.sh`
- API key injected from `$OPENAI_API_KEY` environment variable

## Usage from Ruflo (devuser)

The MCP bridge makes these tools transparently available to Claude Code and Ruflo agents.
When devuser invokes `codex_generate`, the request is routed through the MCP server —
which runs as `devuser` under profile isolation (supervisord-managed), not a pseudo-user.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | (required) | OpenAI API key |
| `OPENAI_DEFAULT_MODEL` | `gpt-5.4` | Model to use for completions |
