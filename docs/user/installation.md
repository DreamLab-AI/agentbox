# Installation

Three install paths, in order of preference for most users.

## Why this exists

Most people coming from Claude Desktop or Cursor are used to a one-click installer. Agentbox is a headless agent container (it runs as a background service, not a window), so the install step is really "get the image onto a host that runs Docker and open the right ports". The three paths below map to the three realistic starting points: you already have Docker, you want to build from source with Nix, or you want the whole thing on a cloud VM without touching local hardware.

**What it solves**

- One reproducible image instead of a pile of `pip install` / `npm install` / model-download steps per agent.
- Multi-arch manifests — the same command works on Intel Linux, Apple Silicon, Raspberry Pi 5 and ARM cloud instances.
- A single `./agentbox.sh up` entry point that handles compose, volumes and health-checking.

**When to skip this**: if you only run a single agent CLI natively and do not need persistent storage, shared skills, or remote access, install that CLI directly.

## 1. Pull the published image (recommended)

Works on any host with Docker. Pulls the right arch automatically.

```sh
docker pull ghcr.io/dreamlab-ai/agentbox:latest
```

Then grab the compose file from the flake. This works on macOS/Windows too because `nix build .#compose` is pure text generation — no container build.

```sh
nix build github:DreamLab-AI/agentbox#compose
cp result/docker-compose.yml .
cp .env.example .env            # edit to fill provider keys
./agentbox.sh up
```

Haven't got Nix? Copy the compose from the repo:

```sh
curl -fsSL https://raw.githubusercontent.com/DreamLab-AI/agentbox/main/docker-compose.yml -o docker-compose.yml
```

## 2. Build from source (Linux x86_64 or aarch64)

Requires Nix with flakes enabled. A Nix `flake` is a declarative package recipe — here it pins every dependency (toolchains, skills, adapter binaries) against a lockfile, so the image you build locally matches the image CI publishes. This is the path for contributors, or for anyone who wants to change which skills or toolchains are baked in.

```sh
git clone https://github.com/DreamLab-AI/agentbox.git
cd agentbox
./agentbox.sh up --build        # nix build .#runtime + docker load + compose up
```

First build takes 10–20 minutes cold, subsequent builds are cache-hot within seconds.

## 3. Remote cloud deployment

Provisions a fresh VM and brings agentbox up on it. Ideal when local hardware isn't enough — no GPU, not enough RAM, or you want the agents reachable from multiple machines. `./agentbox.sh provision` takes care of cloud-init, SSH, Docker install and `docker pull` so you go from a bare provider API key to a running agentbox in one command. See [provisioning.md](provisioning.md) for the target matrix.

```sh
./agentbox.sh provision --target oci         # Oracle Cloud Ampere (free tier)
./agentbox.sh provision --target fly          # fly.io
./agentbox.sh provision --target hetzner      # Hetzner Cloud
./agentbox.sh provision --target bare         # any SSH-reachable host
```

Once the VM is up, `./agentbox.sh all` opens SSH + VNC + code-server + management-API tunnels to your laptop.

## Per-OS prerequisites

### Linux

- Docker 24+ with `docker compose` plugin (the v2 built-in, not the deprecated `docker-compose` Python script).
- For GPU features: `nvidia-container-toolkit` (NVIDIA) or ROCm drivers (AMD). See [running.md](running.md) §6–7.

### macOS

- Docker Desktop, OrbStack (recommended), or Colima.
- Nix via [Determinate Installer](https://determinate.systems/nix) or [nix-installer](https://nixos.org/download.html) if you want local `nix build` for compose/devShell. Container image builds require a Linux host; macOS pulls the published image instead.

### Windows

- Docker Desktop with WSL2 backend.
- A WSL2 Ubuntu distribution: `wsl --install -d Ubuntu`.
- Everything else runs inside WSL2 — same as the Linux path.

## Verify

```sh
./agentbox.sh health            # pretty summary; exits non-zero if any service is degraded
./agentbox.sh health --json     # machine-readable
curl http://localhost:9090/ready    # readiness probe
curl http://localhost:9091/metrics  # Prometheus metrics
```

If any of these fail, see [troubleshooting.md](troubleshooting.md).

## Uninstall

```sh
./agentbox.sh down --volumes         # stops and removes all volumes (destructive)
docker rmi ghcr.io/dreamlab-ai/agentbox:latest
rm -rf ~/agentbox                    # if you cloned the repo
```

To keep state but reclaim space, `./agentbox.sh down` without `--volumes` leaves named volumes intact for the next `up`.
