# Running agentbox on your host

Copy-paste recipes per OS × CPU arch × GPU. For the capability matrix see [`platforms.md`](platforms.md); for the registry itself see [`consuming-the-image.md`](consuming-the-image.md).

---

## 1. Linux x86_64 (native) — first-class path

The path everything is tested against.

```sh
docker pull ghcr.io/dreamlab-ai/agentbox:latest

# Pull the generated compose file
nix build github:DreamLab-AI/agentbox#compose
cp result/docker-compose.yml .
cp .env.example .env
$EDITOR .env              # fill the [providers.*] keys you enabled

./agentbox.sh up
./agentbox.sh health
```

No extra flags needed. All skills and GPU backends available.

### 1a. Build from source and start

```sh
# Compile the Nix image, load it into Docker, and start the stack.
./agentbox.sh up --build
```

`--build` runs `nix build .#runtime`, loads the resulting image into Docker, then
calls `docker compose up`. `AGENTBOX_IMAGE_REF` is not consulted — the local image
tag produced by the Nix build is used directly.

### 1b. Start from a registry image

```sh
# Pull a published image, then start the stack.
export AGENTBOX_IMAGE_REF=ghcr.io/dreamlab-ai/agentbox:latest
docker pull "${AGENTBOX_IMAGE_REF}"
./agentbox.sh up --registry
```

`--registry` validates that `AGENTBOX_IMAGE_REF` is set (errors if not), then
calls `docker compose up` with that image. The generated `docker-compose.yml`
uses `${AGENTBOX_IMAGE_REF:-agentbox:runtime-<system>}` so the override is
consumed by compose automatically.

To pin to a specific SHA (recommended for production):

```sh
export AGENTBOX_IMAGE_REF=ghcr.io/dreamlab-ai/agentbox:abc1234def5
docker pull "${AGENTBOX_IMAGE_REF}"
./agentbox.sh up --registry
```

`--build` and `--registry` are mutually exclusive; passing both is an error.

---

## 2. Linux aarch64 (Raspberry Pi 5 · Ampere A1 · AWS Graviton · Jetson)

Same recipe as §1 — Docker pulls the `linux/arm64` manifest variant automatically.

**Raspberry Pi 5** (16 GB model recommended; 8 GB works with `[desktop]` off and CUDA obviously off):

```sh
docker pull ghcr.io/dreamlab-ai/agentbox:latest
./agentbox.sh up
```

**Oracle Cloud Ampere** (ARM; free tier supports 4 cores × 24 GB):

```sh
./agentbox.sh provision --target oci
# SSH into the VM that comes back, run the Linux aarch64 path inside it
```

**Jetson (Orin / Xavier with NVIDIA)**:

```sh
# Enable ollama-cuda in agentbox.toml, regen compose, run
./agentbox.sh rebuild
```

---

## 3. macOS (Apple Silicon M1/M2/M3/M4)

`nix build .#runtime` does not build container images on darwin — pull the published image instead.

### Docker Desktop (default)

```sh
brew install --cask docker
open -a Docker

docker pull ghcr.io/dreamlab-ai/agentbox:latest
# Resolves to linux/arm64 — runs natively via Apple Virtualization.framework

# Native Nix works on macOS for pure-text outputs
nix build github:DreamLab-AI/agentbox#compose
cp result/docker-compose.yml .

./agentbox.sh up
```

### 3a. Build and start (macOS — compose + locally built image)

`nix build .#runtime` does not produce container images on darwin. Use the
`compose`-only output for the manifest, and pull the published image:

```sh
# Generate the compose manifest only (no image build)
nix build github:DreamLab-AI/agentbox#compose
cp result/docker-compose.yml .

# Pull the published multi-arch image and start the stack
export AGENTBOX_IMAGE_REF=ghcr.io/dreamlab-ai/agentbox:latest
docker pull "${AGENTBOX_IMAGE_REF}"
./agentbox.sh up --registry
```

### 3b. Start from a registry image (macOS — recommended)

```sh
export AGENTBOX_IMAGE_REF=ghcr.io/dreamlab-ai/agentbox:latest
docker pull "${AGENTBOX_IMAGE_REF}"
./agentbox.sh up --registry
```

Both `--build` and `--registry` work identically to §1a/§1b except that
`--build` on macOS exits with an error because `nix build .#runtime` is a
Linux-only output. Use `--registry` on macOS.

### OrbStack (recommended — faster + lighter than Docker Desktop)

```sh
brew install --cask orbstack
orb start
docker pull ghcr.io/dreamlab-ai/agentbox:latest
./agentbox.sh up
```

OrbStack's file-sharing is noticeably quicker for repos with many skill files; `docker compose` usage is identical.

### Colima (CLI-only)

```sh
brew install colima docker
colima start --arch aarch64 --memory 8 --disk 50
docker pull ghcr.io/dreamlab-ai/agentbox:latest
./agentbox.sh up
```

### GPU on macOS

**Metal is not accessible to the Linux container.** Docker Desktop, OrbStack, and Colima all run a Linux VM; none pass through the Mac's GPU.

Practical options:

- **CPU-only** — `[gpu].backend = "none"`. Ollama runs CPU-bound. Fine for small local models.
- **Remote GPU via Ollama** — run Ollama on a Linux+NVIDIA host or cloud GPU VM; set `OLLAMA_BASE_URL=http://<remote>:11434` in `.env`. Mac calls the remote model.
- **Remote agentbox entirely** — `./agentbox.sh provision --target oci`, tunnel the management API with `./agentbox.sh api`.

---

## 4. macOS (Intel)

Identical to §3 except Docker pulls `linux/amd64`. All three runtimes (Docker Desktop, OrbStack, Colima) work. Metal still not passed through.

---

## 5. Windows 10/11

Use Docker Desktop with the WSL2 backend. Run everything from inside a WSL2 Ubuntu shell.

```powershell
# PowerShell, one-time
wsl --install -d Ubuntu
# Install Docker Desktop from docker.com; enable WSL2 integration in Settings
```

From inside `wsl.exe` (Ubuntu):

```sh
docker pull ghcr.io/dreamlab-ai/agentbox:latest
git clone https://github.com/DreamLab-AI/agentbox.git
cd agentbox
cp .env.example .env
$EDITOR .env
./agentbox.sh up
./agentbox.sh health
```

### Windows + NVIDIA GPU

Docker Desktop + WSL2 supports NVIDIA CUDA passthrough:

```sh
# inside WSL2
nvidia-smi              # should list your GPU; install the NVIDIA Windows driver if not
# Enable in agentbox.toml: [gpu] backend = "ollama-cuda"
./agentbox.sh rebuild
```

### Windows + AMD GPU

AMD ROCm in WSL2 is experimental and hardware-limited. For most users: `[gpu].backend = "none"` and run Ollama on a Linux host or a cloud endpoint.

---

## 6. NVIDIA GPU hosts (Linux x86_64)

Requires `nvidia-container-toolkit`:

```sh
# Ubuntu/Debian
distribution=$(. /etc/os-release; echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/libnvidia-container/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt update && sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# Verify
docker run --rm --gpus all nvidia/cuda:13.1.0-base-ubuntu24.04 nvidia-smi
```

Enable in manifest:

```toml
# agentbox.toml
[gpu]
backend = "ollama-cuda"       # sidecar CUDA container
# OR
backend = "local-cuda"        # CUDA toolchain baked into agentbox image
[toolchains]
cuda = true                    # required for local-cuda (E019)
```

Regenerate and restart:

```sh
nix build .#compose
cp result/docker-compose.yml .
./agentbox.sh rebuild
```

`local-cuda` unlocks `gaussian_splatting` (COLMAP + METIS + LichtFeld via `nix build .#gaussian-splatting`).

---

## 7. AMD GPU hosts (Linux x86_64 / aarch64)

### 7a. ROCm (AMD's native CUDA equivalent)

Requires ROCm drivers on the host (`amdgpu-install`); RX 6000/7000 or Instinct MI-series.

```toml
[gpu]
backend = "ollama-rocm"
```

The compose generator adds `/dev/kfd` + `/dev/dri` mounts.

### 7b. Vulkan (broader AMD coverage — RX 400/500/Vega/APUs)

Same `ollama-rocm` backend, with Ollama's Vulkan code path:

```sh
# .env
OLLAMA_VULKAN=1
```

Works on recent AMD APUs (Ryzen 7000/8000G) and older discrete AMD cards that ROCm doesn't support.

---

## 8. Raspberry Pi (armv7, 32-bit)

**Not supported.** Agentbox builds for `aarch64-linux` only. If you have a Pi 3B+ or 4 on Raspberry Pi OS 32-bit, reinstall 64-bit (`rpi-imager` → "Raspberry Pi OS (64-bit)") and follow §2.

---

## 9. Remote agentbox (when local hardware isn't enough)

Provision a cloud host, run agentbox there, tunnel the management API back to your laptop:

```sh
./agentbox.sh provision --target oci      # or fly / hetzner / bare
./agentbox.sh all                          # opens SSH + VNC + code-server + API tunnels
```

Works from any host with SSH — macOS, Windows, Linux. ARM Ampere + optional NVIDIA without local hardware.

---

## 10. Common pitfalls

- **First pull is slow** — multi-arch manifest + adapter deps = ~2–3 GB. Subsequent pulls hit Docker's layer cache.
- **`agentbox.sh up` hangs on health poll** — container booted but management-api didn't start. `docker logs agentbox` will show why (usually missing `MANAGEMENT_API_KEY` or a failed adapter `connect()`).
- **Docker Desktop on macOS out of memory** — bump VM RAM to 8 GB+ in Preferences → Resources. OrbStack auto-scales and avoids this.
- **WSL2 can't see an AMD GPU** — only NVIDIA works in WSL2 today. Dual-boot or remote host for AMD.
- **Apple Silicon pulling an `amd64` tag** — `docker pull --platform linux/amd64 ...` runs under Rosetta, very slow. Always use the multi-arch tag so `linux/arm64` wins.
- **Corporate proxies** — set `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` in `.env`; Docker Desktop has its own proxy settings in Preferences.

---

## See also

- [`platforms.md`](platforms.md) — capability matrix per OS × GPU
- [`consuming-the-image.md`](consuming-the-image.md) — registry, tags, single-arch diagnostic tags
- [`quick-start.md`](quick-start.md) — end-to-end first-run flow
- [`backup-restore.md`](backup-restore.md) — save + restore local adapter state
- [`providers.md`](providers.md) — which `.env` keys correspond to which provider
