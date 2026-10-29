# agentbox-sessions

The agentbox session plane ([ADR-2153](../../docs/adr/ADR-2153-session-plane-replaces-aoe.md)). A tmux-backed daemon and CLI that makes `[[interaction_plane.session_seeds]]` in `agentbox.toml` true and keeps it true. It replaces Agent of Empires, which created sessions once and never reconciled them.

## What it does

- **Reconciles.** At start and every 30 s, each seed is compared with what tmux is running. A seed that is missing, dead, blocked on a trust prompt, or drifted from the manifest is started again. Drift is a change to the command, the model or the directory, so a live session on a stale model is recreated.
- **Never guesses ownership.** A session it creates is named `abs_<slug>` and carries the tmux session option `@agentbox-sessions=1`. Only marked sessions are ever killed or recreated. The coordinator (`agentbox:0`), a leftover `aoe_*` session and anything the operator started are foreign and left alone. A foreign session squatting on a seed's name is reported as a conflict.
- **Protects work.** A session whose worktree holds tracked changes or untracked files is not recreated. Ignored build output (`node_modules`, `coverage`, `target`) does not count, or a built worktree would hold its session out of reconcile for ever. Deleting a worktree is stricter: it also refuses when an ignored path is not regenerable.
- **Does not loop.** A seed restarted three times in an hour is held (`backoff`). A sign-in prompt is reported as `blocked` and left, because recreating cannot clear it.
- **Seeds trust before it starts.** The launch contract names the config stores a tool reads (`claude-root`, `claude-profile`, `codex`) and each is written for the session directory first.
- **Scrubs redirects.** `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` are removed from every session that does not list them in `env_allowlist`, so only the wrapper seeds are pointed at a non-Anthropic endpoint. Provider keys in the daemon's environment are forwarded.

## Commands

```
agentbox-sessions daemon                     supervised: provision, serve the socket, reconcile on a timer
agentbox-sessions reconcile [--dry-run]      one pass
agentbox-sessions list [--json]              sessions and their status
agentbox-sessions send <slug> <text>         type, pause, then Enter (Codex reads a burst as a paste)
agentbox-sessions create <slug> --tool T     a session that is not in the manifest (never reconciled)
agentbox-sessions close <slug>               close one of those
agentbox-sessions pick [--list]              tab-8 picker; moves only the client it runs in
agentbox-sessions resolve [--json]           each seed as the launch contract resolves it
agentbox-sessions mark <slug> busy|idle      status from an agent's own hook
agentbox-sessions reap [--dry-run]           remove Agent of Empires' leftover worktrees
agentbox-sessions call '<json>'              one raw request to the daemon's socket
```

## Status

`missing`, `dead` (tmux `pane_dead`), `blocked: <pattern>` (a contract blocker is on the pane), `busy`/`idle` (from `mark`, else the contract's `ready` pattern, else age against the settle time) and `starting`. A blocked session is never reported idle, and `send` refuses a dead or blocked session.

## Socket

`AGENTBOX_SESSIONS_SOCKET` (default `/run/agentbox-sessions/sessions.sock`), mode 0660, group `AGENTBOX_SESSIONS_GID`. Every connection is authorised by the peer uid from `SO_PEERCRED` against `AGENTBOX_SESSIONS_ACL` (`{"allowed_uids":[1000,961]}`), never by the file mode. One JSON line in, one out: `list`, `send`, `create`, `close`, `reconcile`.

## Environment

| Variable | Default | |
|---|---|---|
| `AGENTBOX_ROOT` | `/opt/agentbox` | holds `agentbox.toml`, `config/`, `scripts/` |
| `AGENTBOX_SESSIONS_TMUX_SOCKET` | default server | a private `tmux -L` server, for tests |
| `AGENTBOX_SESSIONS_INTERVAL_SECS` | 30 | reconcile period |
| `AGENTBOX_SESSIONS_SEND_PAUSE_MS` | 400 | pause between text and Enter |
| `AGENTBOX_SESSIONS_STATE_DIR` | `/run/agentbox-sessions/hooks` | `mark` files |
| `AGENTBOX_SESSIONS_PROVISION` | on | `0` skips `scripts/session-provision.mjs` |
| `MANAGEMENT_API_KEY`, `MANAGEMENT_API_URL` | none, `http://127.0.0.1:9090` | session-boundary events; no key, no binding |

## Tests

`cargo test` runs unit tests and `tests/plane.rs`, which drives real processes and real git repositories on a private tmux server and never touches the default one. `tests/cli/session-launch-contract.test.mjs` compares this crate's resolution of every seed with the Node contract test, field by field (`AGENTBOX_SESSIONS_BIN`).

## Licence

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or
  <http://www.apache.org/licenses/LICENSE-2.0>)
- MIT licence ([LICENSE-MIT](LICENSE-MIT) or
  <http://opensource.org/licenses/MIT>)

at your option.

This crate lives inside the [agentbox](https://github.com/DreamLab-AI/agentbox) repository, which as a whole is
AGPL-3.0-only. The permissive grant is per crate and travels with the crate:
`services/` is a deliberately permissive subtree so these modules can be reused
and published outside the hosted service. See
[ADR-2030](https://github.com/DreamLab-AI/agentbox/blob/main/docs/adr/ADR-2030-permissive-licensing-for-publishable-service-crates.md)
and [services/LICENSING-NOTICE.md](https://github.com/DreamLab-AI/agentbox/blob/main/services/LICENSING-NOTICE.md).

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 licence, shall be
dual licensed as above, without any additional terms or conditions.

## Repository

<https://github.com/DreamLab-AI/agentbox> — path `services/agentbox-ops`.
