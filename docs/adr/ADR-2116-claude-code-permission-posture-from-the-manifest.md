---
id: ADR-2116
title: Project the Claude Code permission posture from the manifest, bypass by default with a deny floor
date: 2026-09-25
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: de84739eea73bdbeffa595f57c1a5d71fd77f630
verified_paths: []
owner: jjohare
review_trigger: any change to what bypass mode or deny rules enforce in Claude Code; the host Docker socket being removed from the container; an injection incident through email, web, forum or dream-scanned content
repo: agentbox
domain: GOVERNANCE-capabilities
---

# ADR-2116 — Project the Claude Code permission posture from the manifest, bypass by default with a deny floor

## Context
The entrypoint seeded `permissions.defaultMode = "auto"` only when unset, into the root settings
only. Stack profiles (sessions with `CLAUDE_CONFIG_DIR` at `profiles/<stack>/.claude`) had no mode
and fell back to prompting. Claude Code rewrites `settings.json` from memory, so hand edits did not
persist. The operator runs interactively and carefully and chose maximal permissiveness; the auto
classifier repeatedly refused operator-requested work. Measured on 2.1.280: bypass allows `.git/`
and `.claude/` writes, and `permissions.deny` rules are still enforced in bypass, but as prefix
matches (`sh -c 'ssh …'` evades them). The container mounts the host Docker socket, so `docker run`
is host root, and sessions read untrusted text (email, web, forum/Nostr, scanned repos).

## Decision
1. `[claude_code]` in `agentbox.toml` is the single authority: `permission_mode` (default
   `bypassPermissions`) and `permission_deny` (default `Bash(docker run:*)`, `Bash(docker compose:*)`,
   `Bash(ssh:*)`).
2. `agentbox-manifest permissions-project` reconciles it EVERY boot into `~/.claude/settings.json`
   and every `profiles/*/.claude/settings.json`: sets `defaultMode`, pre-accepts the mode's one-time
   dialog, adds the deny rules, retracts deny rules it added earlier (`agentboxManagedDeny`) and never
   touches hand-added ones. Fail-open; `AGENTBOX_PERMISSIONS_PROJECT=0` disables it and images
   without the subcommand keep the legacy auto seed.
3. Aliases: `dsp` = manifest mode, `dspa` = auto, `dspb` = bypass.

## Consequences
- No prompts and no classifier by default. The deny floor stops accidents and plain injected
  host-escape commands, not a determined wrapper; the residual risk is accepted by the operator.
  Stronger isolation means removing the Docker socket from session reach (a container change).
- `docker ps/exec/logs` stay available for monitoring; ssh is unavailable to agents (already policy).
- Switching back is a one-line manifest edit and a restart; a running session keeps its mode.

## Verification
Probes on 2.1.280 (headless, `--permission-mode bypassPermissions`): writes to `.git/` and `.claude/`
succeed; with the deny list, `ssh -V` and `docker run --help` are refused, `docker ps` runs,
`sh -c 'ssh -V'` runs. `cargo test` in `services/agentbox-manifest` (93 unit incl. 4 permissions
tests, + integration) and clippy clean; manifest validator passes. Applied live to the root settings
and all 8 stack profiles. `staged` until the rebuild bakes the subcommand into the image.
