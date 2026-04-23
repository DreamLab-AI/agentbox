# Agentbox 2.0

Agentbox 2.0 is a Nix-built, modular container for multi-agent workloads. The image is now driven by [`agentbox.toml`](agentbox.toml), trims unused tooling out of the image graph, and boots into a sovereign runtime built around embedded RuVector, file-backed Solid-style pod storage, Nostr-oriented coordination scaffolding, and profile-aware stack provisioning for Claude, Ruflo, QE, docs, and Rust workflows.

## What Changed

- `flake.nix` now reads `agentbox.toml` with `builtins.fromTOML` and composes package layers from feature flags.
- `supervisord.conf` is generated from the manifest, so disabled skills do not consume image size or runtime slots.
- Legacy pseudo-users are removed from the startup path. The entrypoint now boots a single sovereign identity and creates pod storage plus ACL baselines.
- Repo services are copied into the image under `/opt/agentbox`, fixing broken supervisor paths in the old image layout.
- Runtime provisioning now creates `/workspace/profiles/*` stacks with the full progressive-disclosure skills tree mounted into each profile.
- `zellij` replaces `tmux` as the terminal workspace layer, which fits the Rust-first, remote, terminal-native container better than WezTerm or Hermes IDE.

## Manifest

Edit [`agentbox.toml`](agentbox.toml) to control build composition:

```toml
[sovereign_mesh]
enabled = true
solid_pod = true
nostr_bridge = true

[skills.browser]
agent_browser = true
playwright = true

[skills.spatial_and_3d]
qgis = false
blender = false
```

## Build

```bash
nix build .#runtime
nix build .#desktop
nix build .#full
```

## Terminal Workspace

`zellij` is the default multiplexer in the container.

- `t` or `zl`: start Zellij
- `zn <name>`: start or create a named session
- `za <name>`: attach to a session
- `zls`: list sessions
- `zstack <stack>`: launch an Agentbox stack layout
- `zruflo`, `zqe`, `zdocs`, `zclaude`: shortcuts for the main stack layouts

Default config is shipped at `/opt/agentbox/config/zellij.kdl` and copied into `/workspace/.config/zellij/config.kdl` on boot.
Stack layouts are seeded into `/workspace/.config/zellij/layouts/`.

## Run

```bash
docker compose up -d
```

The default stack exposes:

- `9090` management API
- `9700` RuVector
- `8484` Solid-style pod service
- `8888` Jupyter when enabled in `agentbox.toml`

## Sovereign Runtime

On boot Agentbox:

1. Reads `/etc/agentbox.toml`
2. Generates a Nostr identity for `AGENTBOX_AGENT_ID` if one does not exist
3. Creates pod storage under `/var/lib/solid/pods/<npub>/`
4. Writes baseline ACL metadata and runtime identity exports
5. Starts only the services enabled by the manifest

Identity material is stored under `/var/lib/agentbox/identities`. Pod data lives under `/var/lib/solid`.

## Provisioned Stacks

At boot Agentbox materializes these stack profiles under `/workspace/profiles/`:

- `claude-core`
- `ruflo-orchestrator`
- `qe-fleet`
- `nagual-qe`
- `rust-builder`
- `docs-latex`

Each profile gets:

- its own `.env`
- `.claude/settings.json`
- the full skills tree symlinked at `.claude/skills`
- `projects -> /projects` so every isolated profile sees the same mounted external repos
- `workspace -> /workspace` so every isolated profile sees the same shared internal workspace
- a pointer to `skills/SKILL-DIRECTORY.md` for progressive disclosure

## Notes

- The NIP-98 middleware path is now accepted by the management API, but signature verification is still scaffold-level rather than production-complete.
- The bundled Solid service is a lightweight file-backed pod server to establish the architecture and storage model; swapping in the real `solid-pod-rs` binary is the next hardening step.
- `qgis` support now has a generated service hook, but the current repo only includes a placeholder standalone server until a concrete MCP adapter is added.
