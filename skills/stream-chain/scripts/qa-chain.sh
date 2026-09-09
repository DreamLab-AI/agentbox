#!/usr/bin/env bash
# Historical stub — the `claude-flow stream-chain pipeline` command this script
# drove does not exist in the deployed CLI (verified 2026-09-09 against ruflo
# v3.38.21: `claude-flow stream-chain --help` -> "Unknown command: stream-chain").
#
# There is no CLI or shell-scriptable substitute: the working replacement is the
# mcp__claude-flow__workflow_create / workflow_execute / task_orchestrate MCP
# tool calls documented in ../SKILL.md, which only run from inside a Claude Code
# (or other MCP-client) session — not from a standalone bash script.
#
# This script intentionally refuses to run rather than pretend to do the QA
# sweep. Run the four pipelines (analysis -> refactor -> test -> optimize) from
# Claude Code instead, following ../SKILL.md's "Reusable chain" example once
# per pipeline.
set -euo pipefail

echo "qa-chain.sh is retired: 'claude-flow stream-chain pipeline' does not exist" >&2
echo "in this deployment. See ../SKILL.md for the working MCP-tool equivalent" >&2
echo "(mcp__claude-flow__workflow_create / workflow_execute), which must be run" >&2
echo "from Claude Code — not from this script." >&2
exit 1
