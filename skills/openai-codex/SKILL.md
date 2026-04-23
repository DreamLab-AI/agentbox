---
name: openai-codex
description: Delegates complex coding and reasoning tasks to OpenAI Codex (GPT-5.4)
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
When devuser invokes `codex_generate`, the request is routed through the MCP server
running under `openai-user` isolation.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | (required) | OpenAI API key |
| `OPENAI_DEFAULT_MODEL` | `gpt-5.4` | Model to use for completions |
