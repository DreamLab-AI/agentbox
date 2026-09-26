# Agentbox — Claude Code notes

@AGENTS.md

## Claude Code only

Everything shared with other agents is in `AGENTS.md` (imported above); only harness-specific notes belong here.

- Permission mode is **`[claude_code].permission_mode`** (ADR-2116; default `bypassPermissions`, no classifier), projected into `~/.claude` and every profile's settings at boot — edit `agentbox.toml`, not `settings.json` (Claude Code rewrites it from memory). Deny rules (`docker run`/`compose`, ssh to the machinelearn host only — HP is allowed) hold even in bypass but are pattern matches a `sh -c` wrapper evades. `dsp` = manifest mode, `dspa` = auto, `dspb` = bypass. On 2.1.280 bypass also allows `.git/`/`.claude/` writes. Boot seeds folder trust (`config/hooks/trust-seed.cjs`).
- In the Bash sandbox `$HOME` is read-only and `npx` reports a bogus ENOSPC: run tools from `node_modules/.bin` with `HOME` pointed at a scratch dir; jest suites under `tests/contract/` need jest, not `node --test`. CUDA stubs and the real driver both exist — `ldd <binary> | grep libcuda` before calling a host driverless.
- Hooks: read `config/hooks/CLAUDE.md` before touching `config/hooks/` (stdout reaches the model; `hookSpecificOutput`; timeouts in seconds).
