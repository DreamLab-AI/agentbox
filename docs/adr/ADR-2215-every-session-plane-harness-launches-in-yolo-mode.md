---
id: ADR-2215
title: Every session-plane harness launches in yolo mode
date: 2026-11-22
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 50591d267ac8700e88fb2a43e45e27648f5e8cf6
verified_paths: [config/session-plane/launch.json, services/agentbox-sessions/src/contract.rs, tests/cli/session-launch-contract.test.mjs]
owner: jjohare
review_trigger: a pinned CLI renames or removes its approval-bypass flag, a new seed tool, or the container stops being the sandbox
repo: agentbox
domain: BASELINE-container
evidence_class: source+test
acceptance_boundary: The static contract test, daemon parity, the live launch tier (all seeds start unblocked on a private tmux server) and the agentbox-sessions crate tests pass, and each pane was inspected for a confirmation dialog. Sessions take the flags only when they are next launched after the rebuild.
---

# ADR-2215 — Every session-plane harness launches in yolo mode

## Context

ADR-2116 already runs every Claude Code session with `bypassPermissions`, so the
`openrouter`, `zai` and `tab0` sessions never prompt. The other harnesses launched
by `agentbox-sessions` (ADR-2153) did prompt. Codex had its sandbox off
(`sandbox_mode = "danger-full-access"`) but still asked before running commands.
Antigravity and OpenCode asked before running tools. A seed blocked on an
approval prompt cannot take `agentbox-sessions send` work unattended.

## Decision

The launch contract (`config/session-plane/launch.json`) starts each non-Claude
harness with its own CLI's approval-bypass flag:

| Tool | Flag | Pane shows |
|---|---|---|
| codex | `--dangerously-bypass-approvals-and-sandbox` | `permissions: YOLO mode` |
| antigravity (`agy` 1.5.13) | `--dangerously-skip-permissions` | no prompts |
| opencode (2.0.32) | `--auto` (rules that explicitly deny still apply) | `Build auto` |

Claude seeds keep getting their mode from settings (ADR-2116), not from launch
arguments. The `router` console runs no agent tools, so it has no prompts to
bypass. A static test fails if any seed tool lacks a declared yolo posture.

## Consequences

- Seeded sessions run commands and edits without asking. Only the container is
  the boundary. The ADR-2116 deny rules (`docker run`/`compose`, ssh to the host)
  bind Claude only; Codex, agy and OpenCode have no equivalent, so they can reach
  the host Docker socket.
- The flags apply when a session is next launched: after a rebuild, or after the
  daemon recreates a session. Sessions that are already running keep their posture.
- An interactive `agy`, `codex` or `opencode` started by hand outside the session
  plane is unchanged.

## Verification

`node --test tests/cli/session-launch-contract.test.mjs`, static and with
`AGENTBOX_LIVE_LAUNCH=1`, passes. `cargo test` in `services/agentbox-sessions`
passes, 66 tests. Each harness was also probed by hand with its flag on a private
tmux server: all three reached their prompt with no confirmation dialog.
