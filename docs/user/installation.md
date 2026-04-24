# Installation

Three install paths, in order of preference for most users.

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

Requires Nix with flakes enabled.

```sh
git clone https://github.com/DreamLab-AI/agentbox.git
cd agentbox
./agentbox.sh up --build        # nix build .#runtime + docker load + compose up
```

First build takes 10–20 minutes cold, subsequent builds are cache-hot within seconds.

## 3. Remote cloud deployment

Provisions a fresh VM and brings agentbox up on it. Ideal when local hardware isn't enough.

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
