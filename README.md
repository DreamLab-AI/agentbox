<div align="center">

# Agentbox

### A reproducible, manifest-driven container runtime for software agents.

[![Build](https://img.shields.io/github/actions/workflow/status/DreamLab-AI/agentbox/build-multi-arch.yml?branch=main&style=flat-square&logo=github)](https://github.com/DreamLab-AI/agentbox/actions)
[![License](https://img.shields.io/badge/License-MPL%202.0-blue?style=flat-square)](LICENSE)
[![Nix](https://img.shields.io/badge/Nix-flakes-5277C3?style=flat-square&logo=nixos)](flake.nix)
[![Multi-arch](https://img.shields.io/badge/arch-amd64%20%7C%20arm64-green?style=flat-square&logo=docker)](https://github.com/DreamLab-AI/agentbox/pkgs/container/agentbox)

One TOML manifest. One Nix flake. One codepath. Works standalone or plugs into a host container mesh.

[Quickstart](#quickstart) · [Features](#features) · [Architecture](#architecture) · [Platforms](#platforms) · [Documentation](docs/README.md) · [Contributing](#contributing)

</div>

---

## Why Agentbox

Running AI agents in a container sounds simple until you hit production. Most solutions make one of three mistakes:

- **Ship a kitchen-sink image** with every possible dep pre-installed. Slow, bloated, impossible to secure.
- **Install everything at boot** with `npm install` / `pip install` / `curl | bash`. Non-reproducible, network-dependent, fails halfway.
- **Lock into one orchestrator**. Can't stand alone; can't integrate cleanly with a host project.

Agentbox takes a different shape. A single declarative TOML manifest drives a Nix flake that builds a content-addressed container image. Every feature — GPU backend, desktop, skills, agent CLIs, durable adapters — is a manifest toggle with build-time validation. Boot is immutable: no installers, no downloads, no silent fallbacks.

The result is a container you can reason about. A diff in `agentbox.toml` is a diff in what runs. A `flake.lock` pin is a byte-identical image. A manifest validator catches errors before Nix eval. A hardened baseline runs under `read_only: true`, `cap_drop: [ALL]`, non-root user, with explicit per-feature exception deltas.

## Quickstart

Pick one. All three paths converge on the same running container.

### 1. Pull the published image (fastest)

```sh
docker pull ghcr.io/dreamlab-ai/agentbox:latest

# Grab the compose file from the flake
nix build github:DreamLab-AI/agentbox#compose
cp result/docker-compose.yml .
cp .env.example .env            # fill in provider keys you'll actually use

./agentbox.sh up
./agentbox.sh health
```

### 2. Build from source

```sh
git clone https://github.com/DreamLab-AI/agentbox.git
cd agentbox
./agentbox.sh up --build        # nix build + docker load + compose up
```

### 3. Remote cloud deployment

```sh
./agentbox.sh provision --target oci    # or fly / hetzner / bare
./agentbox.sh all                        # tunnels SSH / VNC / code-server / API
```

Full per-host recipes: [`docs/user/running.md`](docs/user/running.md). Platform matrix: [`docs/user/platforms.md`](docs/user/platforms.md).

## Features

### Build system

| Capability | Summary |
|---|---|
| **Reproducible builds** | Nix flake pinned by `flake.lock`. Two builds of the same manifest produce identical `sha256` image hashes. |
| **Manifest-gated composition** | [`agentbox.toml`](agentbox.toml) drives both the Nix package set **and** the auto-generated `docker-compose.yml` + supervisor config. Never one without the other. |
| **Multi-arch** | Native Linux `amd64` and `arm64`. Published to [`ghcr.io/dreamlab-ai/agentbox`](https://github.com/DreamLab-AI/agentbox/pkgs/container/agentbox) as a single manifest — Docker auto-selects per host. |
| **Schema-validated config** | [`agentbox config validate`](scripts/agentbox) enforces 20 semantic rules (E001–E020 + W021) before `nix build` attempts. |
| **Upstream tracking** | [Renovate](renovate.json) + [weekly `nix flake update`](.github/workflows/nix-flake-update.yml) + [human dashboard](scripts/check-upstream-releases.sh). |

### Runtime architecture

| Capability | Summary |
|---|---|
| **Pluggable adapters** | Five durable-state slots (beads, pods, memory, events, orchestrator) × three implementation classes each (`local-*`, `external`, `off`). Swap backends by editing the manifest. See [ADR-005](docs/reference/adr/ADR-005-pluggable-adapter-architecture.md). |
| **Standalone or federated** | `[federation].mode = "standalone"` ships local fallbacks; `"client"` federates with a host mesh. One codepath; contract tests run against both. |
| **Immutable bootstrap** | No package installers at boot. Every feature's runtime closure is baked into the image via `buildNpmPackage`. Artifact probes fail fast on missing binaries. See [PRD-002](docs/reference/prd/PRD-002-immutable-runtime-bootstrap.md). |
| **Three-endpoint probes** | `/livez` (process alive), `/ready` (bootstrap sentinel + adapters + paths + relays), `/health` (aggregate). Docker healthcheck gates on `/ready`. |
| **Observability** | Prometheus `/metrics` + OpenTelemetry OTLP + pino structured logs. One manifest key drives the whole chain. |

### Agents & toolchains

| Capability | Summary |
|---|---|
| **Claude Code + ruflo + agentic-qe** | Baked-in via pinned `buildNpmPackage` derivations. |
| **OpenAI Codex (Rust-native)** | [`rust-v0.124.0`](https://github.com/openai/codex/releases/tag/rust-v0.124.0) static musl binary per-arch. |
| **Google Gemini CLI** | [`@google/gemini-cli@0.38.2`](https://github.com/google-gemini/gemini-cli) — 1M context, Chapters flow. |
| **claude-zai (GLM-5 via Z.AI)** | Digest-pinned wrapper. |
| **96-skill catalogue** | Content-addressed Nix input from `./skills/`. Progressive disclosure pattern. Includes a skill-builder. |
| **13 MCP servers** | Playwright, ImageMagick, QGIS, Blender, ComfyUI, web-summary, and more. |
| **Sovereign mesh** | Nostr identity + NIP-98 hybrid auth + `@noble/curves` Schnorr signing. Subscribe/publish relay pool. |
| **Solid-compatible pods** | Local JSS (port 8484) or external endpoint via manifest switch. |

### Security posture

| Capability | Summary |
|---|---|
| **Hardened-by-default** | `user: 1000:1000`, `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`, `seccomp=default`, explicit tmpfs list. |
| **Feature-exception mechanism** | `[security.exceptions.<feature>]` manifest deltas — inherit/merge semantics, E020 + W021 validator rules, audit trail via `SecurityProfileApplied` event. See [ADR-007](docs/reference/adr/ADR-007-runtime-contract-and-container-hardening.md). |
| **No DinD, no socket mount** | Zero container-escape surface in the default profile. |
| **Secret scanning** | [gitleaks](/.github/workflows/secret-scan.yml) on every PR with a canary test. |
| **Auto-generated mgmt key** | No `change-this` defaults. First-boot key persisted at `/workspace/profiles/default/mgmt-key` (mode `0600`). |
| **Nostr keys encrypted at rest** | `nostr.key.enc` with PBKDF2 derivation; zeroed after use. |

### Developer ergonomics

| Capability | Summary |
|---|---|
| **Local lifecycle CLI** | `agentbox.sh {up,down,build,rebuild,logs,shell,health,backup,restore}` + remote-operator verbs. |
| **Interactive TUI** | `scripts/start-agentbox.sh` with live schema validation. |
| **Zellij layout** | 11-tab preset (claude/ruflo/qe/docs/build/logs/vcs/memory/llm/agents/host-shell) + tmux-compat aliases. |
| **VS Code devcontainer** | `.devcontainer/` with Nix-flakes + DinD + forwarded ports. |
| **Pluggable provisioners** | `agentbox.sh provision --target {oci,fly,hetzner,bare}`. |

## Architecture

```mermaid
flowchart TB
    subgraph build["build time"]
        M[agentbox.toml] -->|fromTOML| F[flake.nix]
        F --> I[content-addressed image]
        V[agentbox config validate] -.->|JSON Schema + 20 rules| M
    end

    subgraph runtime["runtime"]
        I --> C[docker compose]
        C --> S[supervisord<br/>generated from manifest]
        S --> API[management-api<br/>:9090 / :9091 metrics]
        S --> MCP[MCP servers]
        S --> DESK[Hyprland desktop<br/>optional]
    end

    subgraph adapters["adapter dispatch"]
        API --> AD{"resolve [adapters]"}
        MCP --> AD
        AD -->|local-*| LOC[local fallbacks<br/>sqlite · JSS · RuVector · JSONL]
        AD -->|external| EXT[host mesh<br/>beads · pods · memory · events · orchestrator]
        AD -->|off| DIS[AdapterDisabled]
    end

    subgraph probes["probes"]
        API --> LV[/livez/]
        API --> RDY[/ready<br/>sentinel + adapters + paths/]
        API --> HLT[/health<br/>aggregate/]
    end
```

Three claims drive every design decision:

1. **The manifest is the contract.** Everything the image does traces back to `agentbox.toml`. No Dockerfile edits, no bespoke scripts.
2. **Adapters are the integration surface.** Durable state is pluggable. Agentbox never hardcodes "the database" or "the task store".
3. **Boot is immutable.** The image realises the manifest; it does not construct itself at startup.

Deeper reading: [`docs/developer/architecture.md`](docs/developer/architecture.md) · [`docs/reference/prd/PRD-001-capabilities-and-adapters.md`](docs/reference/prd/PRD-001-capabilities-and-adapters.md) · [`docs/reference/adr/ADR-005-pluggable-adapter-architecture.md`](docs/reference/adr/ADR-005-pluggable-adapter-architecture.md).

## Platforms

| Target | Build | Run | GPU backends |
|---|---|---|---|
| **Linux x86_64** | Native | Native | `none`, `ollama-rocm`, `ollama-cuda`, `local-cuda` |
| **Linux aarch64** (Pi 5, Ampere, Graviton, Jetson) | Native | Native | `none`, `ollama-rocm`; `ollama-cuda` on Jetson |
| **macOS Apple Silicon** | `compose` + `devShell` only | Via Docker Desktop / OrbStack / Colima | `none` (CPU) or remote GPU |
| **macOS Intel** | `compose` + `devShell` only | Via Docker Desktop / OrbStack / Colima | `none` (CPU) or remote GPU |
| **Windows 10/11** | — | Via Docker Desktop + WSL2 | `ollama-cuda` with NVIDIA CUDA in WSL2 |
| **Remote** (OCI Ampere, Fly, Hetzner, bare metal) | Any | `agentbox.sh provision --target <x>` | Inherits host GPU |

**Not supported**: Apple Silicon GPU (Metal), Intel iGPU/oneAPI, Windows native binaries, 32-bit ARM. Full matrix + per-host cookbook: [`docs/user/platforms.md`](docs/user/platforms.md) · [`docs/user/running.md`](docs/user/running.md).

## Documentation

### For operators (users)

- [Quickstart](docs/user/quickstart.md) — first boot in ten minutes
- [Installation](docs/user/installation.md) — per-OS install paths
- [Configuration](docs/user/configuration.md) — `agentbox.toml` reference
- [Running](docs/user/running.md) — per-host × GPU recipes
- [Platforms](docs/user/platforms.md) — compatibility matrix
- [Providers](docs/user/providers.md) — API-key management
- [Backup & restore](docs/user/backup-restore.md)
- [Troubleshooting](docs/user/troubleshooting.md)
- [Consuming the image](docs/user/consuming-image.md) — GHCR registry tags
- [Provisioning](docs/user/provisioning.md) — remote host targets
- Feature guides: [3DGS](docs/user/3dgs.md) · [Blender](docs/user/blender.md) · [ComfyUI](docs/user/comfyui.md) · [LaTeX](docs/user/latex.md)

### For contributors (developers)

- [Architecture overview](docs/developer/architecture.md)
- [Adapter pattern](docs/developer/adapters.md) — how to implement a new slot or impl
- [Sovereign mesh](docs/developer/sovereign-mesh.md) — Nostr client internals
- [Skills upgrade path](docs/developer/skills-upgrade.md) — migration to standalone repo
- [Version tracking](docs/developer/version-tracking.md) — Renovate + Nix flake update
- [Testing](docs/developer/testing.md) — suite shape, running locally, CI

### Reference (canonical specs)

- **Architecture Decisions** — [ADR index](docs/reference/adr/)
- **Product Requirements** — [PRD index](docs/reference/prd/)
- **Domain Design** — [DDD index](docs/reference/ddd/)

Nav hub with reading order: [`docs/README.md`](docs/README.md).

## Contributing

Contributions welcome. Start with:

1. Read [`docs/developer/architecture.md`](docs/developer/architecture.md) and [`CLAUDE.md`](CLAUDE.md) for the conventions.
2. Run the test suite (see [`docs/developer/testing.md`](docs/developer/testing.md)).
3. `agentbox config validate` must pass before any PR.
4. Never weaken the hardened baseline — feature needs must be expressed as `[security.exceptions.<name>]` deltas.

Issues with the hardening baseline, adapter contract, or probe semantics are usually ADR-level decisions — propose via an ADR PR before code.

## License

[MPL-2.0](LICENSE).

## Acknowledgements

Agentbox was extracted from a larger host project during a 2026-04 radical-upgrade sprint. The sovereign-mesh design leans on Nostr (`nostr-tools`, `@noble/curves`). The adapter pattern was inspired by Hexagonal Architecture and ADR-005. The skills catalogue vendors 96 skill packages under permissive licences.

---

<div align="center">

[Documentation](docs/README.md) · [GitHub](https://github.com/DreamLab-AI/agentbox) · [Issues](https://github.com/DreamLab-AI/agentbox/issues) · [Releases](https://github.com/DreamLab-AI/agentbox/releases) · [Container Registry](https://github.com/DreamLab-AI/agentbox/pkgs/container/agentbox)

</div>
