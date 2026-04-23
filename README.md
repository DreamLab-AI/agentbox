# Agentbox 2.0

Agentbox is a modular, Nix-built container runtime for multi-agent development. The current architecture is driven by [`agentbox.toml`](agentbox.toml), uses embedded RuVector for local vector search, bootstraps a sovereign identity plus Solid-style pod storage, and provisions stack-specific profiles that all share the same mounted projects and skills tree.

## Architecture

Agentbox 2.0 is built around five decisions:

1. Declarative build composition through `agentbox.toml`
2. Sovereign identity bootstrapping with Nostr-style keys
3. Solid-style file-backed pod storage under `/var/lib/solid`
4. Embedded RuVector for local indexing and retrieval
5. Profile isolation with shared mounts instead of Linux pseudo-users

The active runtime flow is:

1. `flake.nix` reads `agentbox.toml`
2. package groups and supervisor services are generated from the manifest
3. the entrypoint bootstraps identity and pod storage
4. runtime tooling is installed on first boot where needed
5. stack profiles are created under `/workspace/profiles`

## Repository Layout

- [`flake.nix`](flake.nix) builds the runtime, full, and desktop images
- [`agentbox.toml`](agentbox.toml) controls feature gating and toolchains
- [`config/entrypoint-unified.sh`](config/entrypoint-unified.sh) performs runtime bootstrap
- [`scripts/sovereign-bootstrap.py`](scripts/sovereign-bootstrap.py) generates identity and pod ACL state
- [`scripts/provision-agent-stacks.py`](scripts/provision-agent-stacks.py) creates isolated stack profiles with shared mounts
- [`config/agentbox-aliases.sh`](config/agentbox-aliases.sh) provides shell aliases
- [`config/zellij.kdl`](config/zellij.kdl) and [`config/zellij/layouts`](config/zellij/layouts) define terminal workspace defaults

## Feature Gating

The build is controlled by `agentbox.toml`. Enabled features get both:

- their Nix packages
- their supervisor/runtime wiring

Disabled features should incur no image or runtime overhead.

Current top-level sections:

- `[core]`
- `[sovereign_mesh]`
- `[desktop]`
- `[skills.browser]`
- `[skills.media]`
- `[skills.spatial_and_3d]`
- `[skills.data_science]`
- `[skills.docs]`
- `[toolchains]`

Example:

```toml
[sovereign_mesh]
enabled = true
solid_pod = true
nostr_bridge = true

[skills.browser]
agent_browser = true
playwright = true
qe_browser = false

[skills.docs]
latex = true
report_builder = true
mermaid = true
```

## Build

```bash
nix build .#runtime
nix build .#desktop
nix build .#full
```

To load the image into Docker:

```bash
docker load < result
```

## Run

```bash
cp .env.example .env
docker compose up -d
```

Compose mounts:

- `./workspace -> /workspace`
- `./projects -> /projects`
- RuVector volume -> `/var/lib/ruvector`
- Solid pod volume -> `/var/lib/solid`
- sovereign identity volume -> `/var/lib/agentbox/identities`

## Runtime Services

Default ports exposed by the compose stack:

- `9090` management API
- `9700` RuVector
- `8484` Solid-style pod service
- `8888` Jupyter, when enabled

Optional services are generated from the manifest. That includes:

- Playwright MCP
- ImageMagick MCP
- QGIS placeholder MCP block
- Blender MCP block
- Nostr bridge
- desktop stack services

## Profiles And Shared Context

On boot Agentbox creates stack profiles under `/workspace/profiles`:

- `claude-core`
- `ruflo-orchestrator`
- `qe-fleet`
- `nagual-qe`
- `rust-builder`
- `docs-latex`

Each profile gets:

- its own `.env`
- its own `.claude/settings.json`
- the same shared skills tree via `.claude/skills -> /opt/agentbox/skills`
- the same mounted external projects via `projects -> /projects`
- the same shared workspace via `workspace -> /workspace`
- a progressive-disclosure pointer to `skills/SKILL-DIRECTORY.md`
- an associated Zellij layout path

This is the intended replacement for the old `gemini-user` / `openai-user` / `zai-user` model.

## Terminal Workspace

Zellij replaces tmux in the current runtime.

Useful commands:

- `t` or `zl` starts Zellij
- `zn <name>` starts a named session
- `za <name>` attaches to a named session
- `zls` lists sessions
- `zstack <stack>` opens an Agentbox layout
- `zclaude`, `zruflo`, `zqe`, `zdocs` open the main stack layouts

Seeded config locations:

- `/workspace/.config/zellij/config.kdl`
- `/workspace/.config/zellij/layouts/*.kdl`

## Sovereign Mesh

When sovereign mode is enabled:

- an identity is created for `AGENTBOX_AGENT_ID`
- key material is stored under `/var/lib/agentbox/identities`
- pod state is stored under `/var/lib/solid/pods/<npub>/`
- baseline ACL metadata is written per pod
- the management API accepts bearer auth and scaffold-level NIP-98 envelopes

Important limitation:

- the bundled Solid service is currently a lightweight file-backed compatibility server, not the final `solid-pod-rs` integration
- NIP-98 handling is scaffold-level and not yet full signature verification

## Skills

The skills tree is mounted into every provisioned profile from `/opt/agentbox/skills`.

The authoritative skill catalog is:

- [`skills/SKILL-DIRECTORY.md`](skills/SKILL-DIRECTORY.md)

This is the progressive-disclosure index the profiles reference at boot.

## Current Caveats

- The running Docker container on this host may still be an older image if you have not rebuilt and relaunched the stack.
- [`config/supervisord.conf`](config/supervisord.conf) is legacy reference material; the active runtime path generates supervisor configuration from `flake.nix`.
- Some external CLIs such as `agentic-qe`, `nagual-qe`, and `codebase-memory-mcp` are installed best-effort at runtime rather than vendored in the repo.
- QGIS support currently wires a placeholder standalone service until the real MCP adapter is added.

## Status

The repo is mid-migration from the old monolithic container model to the new Agentbox 2.0 sovereign/runtime model. The canonical docs are this README, [`docs/guides/quick-start.md`](docs/guides/quick-start.md), and [`CLAUDE.md`](CLAUDE.md).
