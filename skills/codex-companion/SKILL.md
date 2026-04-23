---
name: codex-companion
description: >
  OpenAI Codex / GPT-5.4 integration for Claude Code. Use when the user says
  "consult with openai", "talk to codex", "ask gpt-5.4", "get a second opinion
  from openai", "delegate to codex", "openai review", or "codex rescue". Provides
  code reviews, adversarial reviews, rescue operations (when Claude is stuck),
  and GPT-5.4 task delegation with structured prompting. Uses the openai-user
  isolation for API key management. From openai/codex-plugin-cc.
version: 1.0.0
author: OpenAI (adapted for Agentbox)
tags:
  - codex
  - openai
  - gpt-5.4
  - review
  - rescue
  - adversarial
env_vars:
  - OPENAI_API_KEY
---

# Codex Companion

OpenAI's official Codex plugin for Claude Code, adapted for our multi-user container. Delegates code review, adversarial review, and rescue tasks to GPT-5.4 via the Codex CLI.

## When to Use This Skill

- **Code review**: Get a Codex review of your git changes (working tree or branch)
- **Adversarial review**: Challenge your implementation approach and design choices
- **Rescue**: When Claude is stuck, hand the task to Codex for a second opinion
- **GPT-5.4 delegation**: Offload substantial coding, debugging, or research tasks
- **Cross-model validation**: Use Codex as a check on Claude's work

## When Not to Use

- For simple tasks Claude can finish quickly — don't add Codex overhead
- For non-code tasks (research, content, design) — use dedicated skills instead
- For DeepSeek reasoning — use `deepseek-reasoning` skill instead
- If OPENAI_API_KEY is not configured — run `/codex:setup` first

## Container Integration

This skill leverages our `openai-user` (UID 1002) for API key isolation:

```bash
# The openai-user has OPENAI_API_KEY pre-configured in the entrypoint
as-openai   # Switch to openai-user context

# Or run Codex commands directly (the skill handles user switching)
/codex:review              # Review working tree changes
/codex:adversarial-review  # Challenge the implementation approach
/codex:rescue [task]       # Hand a stuck task to Codex
/codex:status              # Check Codex job status
/codex:result              # Get last Codex result
/codex:cancel              # Cancel running Codex job
```

## Commands

| Command | Description |
|---------|-------------|
| `/codex:review` | Code review of git changes (working tree or branch) |
| `/codex:adversarial-review` | Challenge implementation, design choices, tradeoffs |
| `/codex:rescue [task]` | Delegate investigation or fix to Codex when stuck |
| `/codex:status` | Check Codex job progress |
| `/codex:result` | Retrieve last Codex output |
| `/codex:cancel` | Cancel running Codex job |
| `/codex:setup` | Configure Codex CLI and API key |

## Rescue Agent

The `codex-rescue` subagent activates proactively when:
- Claude Code is stuck on a debugging task
- A second implementation pass would help
- Deeper root-cause investigation is needed
- A substantial coding task should be delegated

The rescue agent uses the `gpt-5-4-prompting` skill to compose tight, structured Codex prompts with XML tags, output contracts, and verification loops.

## GPT-5.4 Prompting Patterns

The skill includes a reference library for composing effective Codex prompts:

| Pattern | Use Case |
|---------|----------|
| `<task>` + `<completeness_contract>` + `<verification_loop>` | Coding / debugging |
| `<task>` + `<grounding_rules>` + `<structured_output_contract>` | Review tasks |
| `<task>` + `<research_mode>` + `<citation_rules>` | Research / recommendations |
| `<task>` + `<action_safety>` | Write-capable tasks (prevents unrelated refactors) |

## Review Output Schema

Reviews follow a structured JSON schema (`review-output.schema.json`) with:
- Severity levels (critical, major, minor, suggestion)
- Category classification (bug, security, performance, design, style)
- File + line references
- Confidence scores

## Hooks

- **SessionStart/SessionEnd**: Lifecycle management for Codex companion state
- **Stop**: Review gate — optionally triggers a Codex review before session ends

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key (pre-configured for `openai-user`) |
| `CODEX_MODEL` | No | Override model (default: GPT-5.4, `spark` maps to `gpt-5.3-codex-spark`) |

## Setup

```bash
# If running as devuser, the openai-user key is available via:
as-openai   # Switch user context

# Or configure directly:
/codex:setup

# Verify:
/codex:status
```

## Integration with Other Skills

| Skill | Relationship |
|-------|-------------|
| `openai-codex` | Legacy MCP bridge — codex-companion is the full-featured replacement |
| `build-with-quality` | BWQ can delegate review phases to Codex for cross-model validation |
| `github-code-review` | Codex reviews complement Claude reviews for multi-perspective analysis |
| `vanity-engineering-review` | Run adversarial review first, then vanity check for over-engineering |

## Attribution

Codex Plugin for Claude Code by OpenAI. Apache 2.0 License.
