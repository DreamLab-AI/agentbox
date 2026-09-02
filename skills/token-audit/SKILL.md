---
name: token-audit
description: "Use when the user asks where their Claude Code usage/tokens are going, is burning through their plan unexpectedly fast, hitting limits, or wants a breakdown of Claude Code activity. Produces a COMPREHENSIVE usage report from local session transcripts: tokens by day/model/project, tool usage, MCP usage, subagent fan-out, web-tool calls, cache efficiency, busiest sessions, hourly activity, and a runaway-daemon cross-reference — distinguishing interactive work from automation and recommending concrete fixes."
user-invocable: true
---

# Claude Code Usage Audit (token-audit)

A **comprehensive** picture of Claude Code usage in this container, built from
the local session transcripts in `~/.claude/projects/**/*.jsonl` (each
assistant message records its token usage, tool calls, model, and metadata).
This covers ALL Claude Code activity — interactive, subagents, hooks, MCP,
web tools — and answers two questions: *where is my usage going?* and *is any
of it runaway automation?*

Engine adapted (MIT) from pacphi/agentic-kit's `ruflo-token-audit`; see the
attribution header in the script. Stdlib-only Python, no network, no extra
dependencies.

## When to use

Trigger on: "where are my tokens/usage going", "why is my usage so high",
"break down my Claude Code activity", "I'm hitting my Max/Pro limit", "what am
I spending tokens on", "audit token usage". Also proactively if the user
mentions surprising usage.

## Procedure

1. **Run the engine** (baked at the skills tree; stdlib-only Python 3):

   ```bash
   token-audit --days 7
   ```

   - Honour any window the user gives ("past month" → `--days 30`).
   - `--top N` widens each section; `--json` gives machine-readable output;
     `--no-daemons` skips the `ps` cross-reference.

2. **Read the whole picture, then lead with the headline.** Synthesize, don't
   echo. Key sections and what they tell you:

   | Section | Read it for |
   |---|---|
   | BY MODEL | Opus/Fable = interactive; heavy Haiku/Sonnet = automation/subagents |
   | SESSIONS PER DAY | tens = human; hundreds–thousands = automation (≈one/min = robotic) |
   | ACTIVITY BY HOUR | a flat 24h histogram (busy at 3am) is automation, not a person |
   | TOOL USAGE | what the work actually *is* (Bash/Read/Edit vs Task/MCP) |
   | MCP USAGE | per-server call volume; heavy MCP also means a per-session tool-def tax |
   | SUBAGENT FAN-OUT | Task spawns + sidechain share — how much is delegated/parallel |
   | BUSIEST SESSIONS | a single runaway conversation surfaces here by token total |
   | CACHE EFFICIENCY | high cache-read% is normal/cheap; flag only with huge automated volume |
   | STARTUP CONTEXT TAX | fixed per-session cost (CLAUDE.md + tool/skill manifests) × many sessions |
   | RUNNING DAEMONS | live ruflo `daemon start` processes mapped to top-burn projects |

3. **Check the daemon cross-reference** (the classic leak upstream: six leaked
   daemons produced ~8.1B tokens in a week, ~94% background). In agentbox,
   ruflo AI workers are pinned off (`RUFLO_DAEMON_AI_WORKERS=0` in the runtime
   env) and no ruflo daemon runs under supervisord — so ANY daemon in this
   section is unexpected. If daemons are listed and the user authorises:

   ```bash
   ruflo-daemon-gc           # preview
   ruflo-daemon-gc --kill    # stop them
   ```

   Then re-run the audit to confirm.

4. **Report like a diagnosis, not a data dump.** Lead with the verdict (where
   usage is going + interactive vs automation + the single biggest driver).
   Then a small supporting table, then ranked concrete fixes with exact
   commands. Levers worth naming: kill runaway daemons; trim an oversized
   CLAUDE.md; drop or gate a heavy always-on MCP (its tool defs are a
   per-session tax); reduce hook/loop fan-out.

## Caveats (be honest)

- The cost-weight is an **Opus-equivalent reference** to compare line items —
  NOT the user's actual plan billing. Don't present it as dollars owed.
- High **cache-read** is normal and cheap; flag it only when it's huge *and*
  multiplied by thousands of automated sessions.
- A few hundred sessions (or Task spawns) from legitimate parallel subagent
  work is not a leak. The tell is *unattended, repeating* activity — flat
  overnight hours, near-identical session counts across projects, daemons
  running.
- Consultant-tier calls (codex/zai/perplexity/deepseek MCP servers) are logged
  separately under `/var/lib/agentbox/consultations/*.jsonl` — this audit sees
  their MCP *call counts*, not their provider-side token spend.

## Sample prompts

- "Audit my Claude Code usage for the last 7 days — where is it all going?"
- "Break down what I've been spending tokens on this week."
- "I'm hitting my Max limit in a day. Run the usage audit and tell me why."
- "Check for runaway ruflo daemons and show me my heaviest sessions."
