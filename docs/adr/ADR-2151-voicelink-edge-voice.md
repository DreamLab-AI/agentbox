---
id: ADR-2151
title: Run voice at the client edge and drive native CLI panes over the ssh attach chain
date: 2026-10-27
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: first voicelink release that changes PROTOCOL_VERSION, or a change to the `agentbox.sh shell` attach path
repo: agentbox
domain: BASELINE-container
---

# ADR-2151 — Run voice at the client edge and drive native CLI panes over the ssh attach chain

## Context
The operator works remotely by ssh to the host and `agentbox.sh shell` (`docker exec -it --user 1000 … tmux attach -t agentbox`), driving native `claude`/`codex` CLIs in tmux tabs; AoE (tab 8) is rarely used. The existing voice plane (ADR-044: Nemotron ASR, Pocket TTS, Unmute, the `:8444` cockpit) transcribes server-side and targets tab0-bridge/AoE, which is the wrong surface for this workflow. Client devices (an AMD Strix Halo laptop with 64 GB unified memory, NVIDIA boxes, CPU-only machines, macOS) can run speech and a conversational model locally. tmux tracks the current window per session, not per client, so two attached terminals cannot follow focus independently.

## Decision
- Voice runs on the client in a separate repository, `DreamLab-AI/agentbox-voicelink` (Apache-2.0 OR MIT): STT, TTS, echo cancellation, VAD and a local LLM concierge. Only text and control messages cross the wire.
- The transport is the operator's existing ssh login: one ControlMaster carries both the terminal attach and `ssh -T host docker exec -i --user 1000 agentbox voice-paned --stdio`, a JSON-lines link whose contract is the published `voicelink-proto` crate. No new port, token or ingress.
- Each client attaches to its own grouped session (`tmux new-session -t agentbox -s remote-<client>`); `voice-paned` follows that session's focus through a control-mode client (`-f ignore-size,no-output`). Writes are only representable against the focused pane; acting on a background tab means selecting it first.
- Claude Stop/Notification hooks and the Codex `notify` hook append events to a bounded JSONL spool tagged with `$TMUX_PANE`; `voice-paned` tails it. Hooks print nothing to stdout and fail open.
- `voice-paned` lives in the voicelink repository and is baked into the image from a pinned revision (`lib/voice-paned.nix`, the `lib/sidestr-agent.nix` pattern), gated by `[voicelink]` (apply class `rebuild`). It is a per-connection process, not a supervisor program.
- The ADR-044 server plane and cockpit are unchanged and remain the VisionClaw/browser path; clients may use Nemotron/Pocket and the Loom as remote backends through ssh `-L` forwards.

## Consequences
- Agentbox gains no listening surface; the attack surface is the ssh login the operator already holds.
- The repositories meet at the pinned `voice-paned` revision and at the spool format, both owned by voicelink: hooks call `voice-paned record`, so no second implementation of the record exists here. A breaking wire change bumps `PROTOCOL_VERSION` and both sides.
- Prompt detection for menus without a hook relies on pane-content matching, which needs pinned fixtures and breaks on CLI UI changes.
- Follow-on: the hook registrations at both sites (root and per-profile), the Codex `notify` projection, and the Nix bake.

## Verification
None yet (`implementation_status: none`). Becomes `partial` when `voice-paned` is baked and the hook spool is registered, verified by the voicelink end-to-end link test against a live grouped session.
