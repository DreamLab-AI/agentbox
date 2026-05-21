# Platform compatibility

Agentbox is a Linux-container product. Build and run paths vary by host OS.

## Why this page exists

Different hosts can do different things with the same image. Docker Desktop on macOS can pull and run agentbox, but it cannot build a Linux image from a Nix flake (the flake's container-image output is gated to Linux hosts) and it has no GPU passthrough for Apple's Metal. Linux hosts can do everything. Windows works through WSL2. The tables below replace trial-and-error with a compatibility matrix you can check before starting.

**What it solves**

- Knowing in advance whether `nix build .#runtime` will work on your host.
- Avoiding the trap of enabling `local-cuda` on a machine that cannot pass through NVIDIA.
- Picking the right escape hatch when your laptop cannot do the workload (remote provisioning).

## Build vs run

| Action | Linux x86_64 | Linux aarch64 | macOS (Intel or Apple Silicon) | Windows 10/11 |
|---|---|---|---|---|
| `nix build .#runtime` (container image) | ✅ Native | ✅ Native | ❌ Linux-only output | ❌ Linux-only output |
| `nix build .#compose` (manifest generator) | ✅ | ✅ | ✅ | ✅ (WSL2) |
| `nix develop` (dev shell) | ✅ | ✅ | ✅ | ✅ (WSL2) |
| `docker pull ghcr.io/dreamlab-ai/agentbox:<tag>` | ✅ | ✅ | ✅ (Docker Desktop) | ✅ (Docker Desktop) |
| `agentbox.sh up` / `down` / `logs` / `health` | ✅ | ✅ | ✅ | ✅ |
| `agentbox config validate` | ✅ | ✅ | ✅ | ✅ |

The flake exposes `x86_64-linux`, `aarch64-linux`, `x86_64-darwin`, and `aarch64-darwin` systems. On darwin the `packages` attribute set contains only the portable outputs (`compose`) — container-image outputs are gated behind `pkgs.stdenv.isLinux` so they don't attempt to cross-compile.

## GPU backends

| `[gpu].backend` | Linux x86_64 | Linux aarch64 | macOS | Windows |
|---|---|---|---|---|
| `none` | ✅ | ✅ | ✅ | ✅ |
| `ollama-rocm` (AMD / Vulkan) | ✅ | ✅ (with ROCm-capable driver) | ❌ | ❌ |
| `ollama-cuda` (NVIDIA, sidecar) | ✅ | Jetson only | ❌ | ❌ |
| `local-cuda` (NVIDIA toolchain in image) | ✅ | ❌ | ❌ | ❌ |

NVIDIA and AMD GPU access from within a container requires the host to expose the device (through `nvidia-container-runtime` or `/dev/kfd`+`/dev/dri` respectively). Docker Desktop on macOS runs the container inside a Linux VM that has no GPU passthrough; the `none` backend is the only functional choice there.

Apple Silicon's Metal, Intel's iGPU/oneAPI, and neural-accelerator paths (Apple Neural Engine, CoreML) are **not supported**. If you need GPU inference from a Mac, run the workload on a remote Linux host (e.g. Oracle Cloud Ampere + NVIDIA A10 via `agentbox.sh provision --target oci`).

## Recommended workflows per OS

### Linux x86_64 workstation

```sh
nix build .#runtime
docker load < result
./agentbox.sh up
```

### Linux aarch64 (Raspberry Pi 5, Ampere, Graviton)

```sh
nix build .#runtime              # native ARM build
docker load < result
./agentbox.sh up
```

### macOS (Apple Silicon or Intel)

Option A — consume the published image (recommended):

```sh
docker pull ghcr.io/dreamlab-ai/agentbox:latest
./agentbox.sh up
```

Option B — develop locally (config edits, schema validation) without building the image:

```sh
nix build .#compose              # generates docker-compose.yml
nix develop                      # drops into a shell with all CLIs
agentbox config validate         # schema + semantic rules
```

The image itself still has to be built on a Linux host or pulled from the registry.

### Windows 10/11

Docker Desktop + WSL2. Inside WSL2 (an Ubuntu shell):

```sh
docker pull ghcr.io/dreamlab-ai/agentbox:latest
./agentbox.sh up
```

`agentbox.sh` requires `bash` + `docker`; both work inside WSL2. The TUI (`scripts/start-agentbox.sh`) auto-fetches a `gum` binary and also runs in WSL2 (falls back to whiptail or plain text).

## Multi-arch registry

`build-multi-arch.yml` publishes `ghcr.io/dreamlab-ai/agentbox:<sha>` and `:latest` with `linux/amd64` + `linux/arm64` manifests. Docker clients auto-select the right arch. If you need a specific arch explicitly:

```sh
docker pull --platform linux/arm64 ghcr.io/dreamlab-ai/agentbox:latest
```

## CI coverage

- `flake-check.yml` evaluates the flake on both `x86_64-linux` and `aarch64-linux` runners on every PR. Catches arch-specific regressions before merge.
- `build-multi-arch.yml` produces the published image via manual `workflow_dispatch` (automatic triggers are disabled while the schema validator catches up with manifest drift).
- `contract-tests.yml` runs the Jest adapter-contract suite (platform-agnostic Node tests).

## Things that are NOT cross-platform

- The CUDA 13.1 toolchain (`cudaPackages_13_1`) — Linux x86_64 only.
- The 3DGS stack (COLMAP + METIS + LichtFeld) — Linux x86_64 only.
- Hyprland / wayvnc desktop stack — Linux only.
- Some MCP servers that assume `/dev`, `/proc`, or Linux cgroups — not relevant on macOS hosts since the container itself is Linux.

## Reporting a platform-specific regression

If `nix flake check` or `nix build .#compose` fails on macOS, include in the issue:

- `nix --version`
- `nix-info -m`
- Full `nix build` stderr
- `agentbox.toml` contents (or note if default)

File at https://github.com/DreamLab-AI/agentbox/issues with label `platform:<arch>`.
