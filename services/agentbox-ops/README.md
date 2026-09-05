# agentbox-ops

Operational CLI tools for agentbox: scheduler, daemon reaper, token audit, and skill helpers.

Part of [agentbox](https://github.com/DreamLab-AI/agentbox); the crate lives at `services/agentbox-ops` and is a
self-contained Cargo workspace.

`agentbox-ops` collects the operational binaries that keep an agentbox
container healthy. Each one replaces a Python script retired by the 2026-09-02
legacy audit; the shared logic lives in the library so it can be unit-tested
independently of the CLI shell around it.

### Binaries

| Binary | Purpose |
|---|---|
| `hermes-scheduler` | Background cron daemon for Claude Code agent tasks. |
| `ruflo-daemon-gc` | Read-only reaper for leaked `ruflo` / `claude-flow` daemons; signals only with `--kill`. |
| `teammate-gc` | Idle agent-team teammate reaper (CPU-counter idleness, pid-reuse guarded); `--loop` under supervisord, signals only with `--kill`. |
| `agentbox-hook` | Resident Claude Code hook shim: `event <kind>` spools a hook event in <10 ms, `reconcile` rewrites project settings away from CLI hooks, `drain --loop` folds spools into the events volume (ADR-2034). |
| `token-audit` | Token-usage accounting across sessions. |
| `expel-distil` | ExpeL lesson distillation from trajectories. |
| `voyager-gate` | Voyager verification gate. |
| `pvgis-fetch`, `solar-optimize` | PVGIS irradiance retrieval and array optimisation. |
| `comfyui-generate` | ComfyUI generation driver. |
| `yt-transcript-archive` | YouTube transcript archival. |
| `report-preflight` | Report pre-flight validation. |
| `mcp-call` | One-shot MCP tool invocation. |

### Process identity

Every path in this crate that signals a process identifies its target by argv
elements and `/proc/<pid>/stat` start time before signalling, and refuses to act
on an unverifiable or mismatched PID (`src/process_identity.rs`, ADR-2032). The
reaper is read-only by default.

### Usage

```sh
hermes-scheduler --help
ruflo-daemon-gc --json
```

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
