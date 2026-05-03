# Configuration reference

Every key in [`agentbox.toml`](../../agentbox.toml). This is the single source of truth — the Nix flake reads it, the compose generator reads it, the validator enforces it.

## Why this file exists

Instead of editing Dockerfiles, compose YAML, supervisor configs and CLI flags separately, Agentbox puts the entire build-and-runtime surface into one TOML manifest. Change a key, re-validate, rebuild if needed; everything downstream follows. Full product spec: [PRD-001](../reference/prd/PRD-001-capabilities-and-adapters.md).

**What it solves**

- Config drift between the image, the compose file and the runtime env.
- "Which file do I edit to turn off the desktop?" — one answer, always.
- Invalid combinations caught before a 10-minute Nix build (validator error codes `E001`–`E025`).

```mermaid
flowchart TB
    TOML["agentbox.toml<br/>(single manifest)"]
    TOML -->|"read by"| NIX["flake.nix<br/>image composition"]
    TOML -->|"read by"| COMP["compose generator<br/>docker-compose.yml"]
    TOML -->|"read by"| SUP["supervisord generator"]
    TOML -->|"enforced by"| VAL["agentbox-config-validate.js<br/>30 semantic rules"]
    TOML -->|"read at boot by"| API["management-api<br/>adapter resolver"]
    VAL -->|"E001..E031"| ERR["Errors block build"]
    VAL -->|"W021, W030"| WARN["Warnings advise"]
```

After editing, run `agentbox config validate` before `agentbox.sh up`. The validator catches 30 classes of misconfiguration (E001-E031 + W021 + W030, E009 reserved) before `nix build` attempts.

---

## `[core]`

```toml
[core]
orchestration = "ruflo-v3"       # Agent orchestrator. Currently only ruflo-v3 is wired.
vector_db = "ruvector-embedded"  # Local retrieval engine. Currently only ruvector-embedded.
```

## `[federation]`

```toml
[federation]
mode = "standalone"              # "standalone" (local fallbacks) | "client" (federate with host mesh)
external_url = ""                # Required when mode="client". Base URL of the host mesh.
```

## `[adapters]`

Five slots. Each resolves to one of three implementation classes. An `adapter` is the pluggable-backend pattern from [ADR-005](../reference/adr/ADR-005-pluggable-adapter-architecture.md) — every integration that touches durable state goes through one of these slots, so you can run everything locally, federate with a host mesh, or turn the slot off entirely without changing agent code.

```mermaid
graph LR
    subgraph slots["Five adapter slots"]
        B["beads"]
        P["pods"]
        M["memory"]
        E["events"]
        O["orchestrator"]
    end
    subgraph classes["Implementation classes"]
        L["local-*<br/>self-contained"]
        X["external<br/>federated"]
        OFF["off<br/>disabled"]
    end
    B --- L
    B --- X
    B --- OFF
    P --- L
    P --- X
    P --- OFF
    M --- L
    M --- X
    M --- OFF
    E --- L
    E --- X
    E --- OFF
    O --- L
    O --- X
    O --- OFF
```

```toml
[adapters]
beads        = "local-sqlite"          # local-sqlite | external | off
pods         = "local-solid-rs"        # local-solid-rs | external | off
memory       = "embedded-ruvector"     # embedded-ruvector | external-pg | off
events       = "local-jsonl"           # local-jsonl | external | off
orchestrator = "local-process-manager" # local-process-manager | stdio-bridge | off
```

`pods = "local-solid-rs"` is the only first-party implementation. It runs the
[`solid-pod-rs`](https://github.com/DreamLab-AI/solid-pod-rs) Rust Solid
Protocol 0.11 server described in [ADR-010](../reference/adr/ADR-010-rust-solid-pod-adoption.md).
See [solid-pod.md](solid-pod.md) for the operator guide and
`[integrations.solid_pod_rs]` below for the per-feature knobs. The legacy
`local-jss` Python stub was removed 2026-04-25; old manifests carrying it
fail schema validation with E016 (unknown enum value).

Validator rules:
- **E001**: `"external"` requires `federation.mode = "client"` + `federation.external_url`.
- **E002**: `memory = "external-pg"` requires `[integrations.ruvector_external].conninfo`.
- **E003**: `orchestrator = "stdio-bridge"` must not bind an HTTP port.
- **E033**: `integrations.solid_pod_rs.enable_dpop_cache = true` requires `enable_oidc = true`.

Full adapter contract: [ADR-005](../reference/adr/ADR-005-pluggable-adapter-architecture.md).

## `[gpu]`

```toml
[gpu]
backend = "none"    # none | ollama-rocm | ollama-cuda | local-cuda
```

| Backend | When to use |
|---|---|
| `none` | CPU-only, or macOS/Windows hosts (Metal can't reach the container) |
| `ollama-rocm` | AMD GPU with ROCm drivers, or Vulkan fallback |
| `ollama-cuda` | NVIDIA GPU with `nvidia-container-toolkit` |
| `local-cuda` | NVIDIA with CUDA toolchain baked into the image (required for `gaussian_splatting`) |

Validator rule **E006**: `gaussian_splatting = true` requires `backend = "local-cuda"`.

## `[privacy_filter]`

Local PII redaction sidecar (openai/privacy-filter, 1.5B MoE, Apache-2.0).
Gated at wizard time — only offered when a GPU is detected or the host has
≥ 4 cores and ≥ 6 GB of free memory.

```mermaid
flowchart LR
    REQ["Agent request"] --> PF{"Privacy filter<br/>:9092"}
    PF -->|"strict"| REDACT["Redact PII"]
    PF -->|"soft"| FLAG["Flag PII"]
    PF -->|"off"| PASS["Pass through"]
    REDACT --> ADAPTER["Adapter slot"]
    FLAG --> ADAPTER
    PASS --> ADAPTER
```

```toml
[privacy_filter]
enabled = false
mode    = "off"                 # off | local-gpu | local-cpu
port    = 9092                  # loopback-only
dtype   = "bf16"                # bf16 | f32 | q4
model   = "openai/privacy-filter"

[privacy_filter.policy]
pods         = "strict"         # strict | soft | off
memory       = "strict"
events       = "soft"
beads        = "soft"
orchestrator = "off"
inbound      = "soft"
outbound     = "soft"

[privacy_filter.entities]
enabled = []                    # empty = all eight classes
```

Validator rules:
- **E022**: `enabled = true` requires `mode ∈ {local-gpu, local-cpu}`.
- **E023**: `mode = "local-gpu"` requires `gpu.backend != "none"`.
- **E024**: `dtype = "q4"` requires `mode = "local-cpu"`.
- **E025**: `port` must not collide with `observability.metrics_port`.

Full routing contract: [ADR-008](../reference/adr/ADR-008-privacy-filter-routing.md).
Novice-friendly walkthrough: [privacy-filter.md](privacy-filter.md).

## `[desktop]`

```toml
[desktop]
enabled = false
stack = "hyprland-wayland"    # hyprland-wayland | x11-openbox
resolution = "1920x1080"
```

When enabled, exposes port 5901 for VNC. The Hyprland stack needs the `[security.exceptions.desktop]` block active (see below).

## `[observability]`

Drives the entire metrics/tracing/logging chain. One manifest key → compose ports → container env → Prometheus/OTLP endpoints.

```toml
[observability]
metrics_port = 9091
otlp_endpoint = ""            # e.g. "http://otel-collector:4317"; empty = tracing disabled
log_level = "info"            # trace | debug | info | warn | error
```

## `[providers.<name>]`

Per-provider gates. Only enabled providers' env vars are required at boot.

```toml
[providers.anthropic]
enabled = true
env_var = "ANTHROPIC_API_KEY"
optional_env_vars = []

[providers.openai]
enabled = false
env_var = "OPENAI_API_KEY"
optional_env_vars = ["OPENAI_BASE_URL"]
```

Supported out of the box: `anthropic`, `openai`, `gemini`, `deepseek`, `perplexity`, `openrouter`, `context7`, `brave`, `github`, `zai`.

Validator rules **E017/E018**: enabled provider's env var must be present and not a placeholder.

Add a new provider: see [providers.md](providers.md).

## `[skills.*]`

Feature flags for the 96-skill catalogue. Only enabled skills contribute to the image.

```toml
[skills.browser]
playwright = true
qe_browser = false
agent_browser = true

[skills.media]
ffmpeg = true
imagemagick = true
comfyui_builtin = false    # Install ComfyUI inside the container
# [integrations.comfyui_external] — mutually exclusive with comfyui_builtin (E007)

[skills.spatial_and_3d]
blender = false
qgis = false
gaussian_splatting = false    # Requires [gpu].backend = "local-cuda" (E006)

[skills.data_science]
pytorch = false
jupyter = false

[skills.docs]
latex = true
mermaid = true
report_builder = true

[skills.ontology]
enabled = false    # Logseq OWL2 DL tools
```

## `[toolchains]`

Which agent CLIs are in the image.

```toml
[toolchains]
claude        = true
claude_code   = true
ruflo         = true
claude_flow   = true
agentic_qe    = true
nagual_qe     = false    # Not on public npm yet
codebase_memory = true
rust          = true
gemini_cli    = false    # @google/gemini-cli
codex         = false    # OpenAI Codex Rust CLI
code_server   = false    # Web IDE on port 8080
cuda          = false    # CUDA 13.1 toolchain (requires [gpu].backend = "local-cuda")
```

Validator rule **E019**: `cuda = true` requires `gpu.backend = "local-cuda"`.

## `[integrations.<name>]`

Optional external endpoints for federated deployments.

```toml
[integrations.ruvector_external]
enabled = false
conninfo = "postgresql://ruvector@ruvector-postgres:5432/ruvector"

[integrations.comfyui_external]
enabled = false
url = "http://comfyui:8188"
ws_url = "ws://comfyui:8188/ws"

[integrations.ragflow]
enabled = false
network = "docker_ragflow"
aliases = ["agentbox"]
```

## `[sovereign_mesh]`

Nostr identity + Solid pod + optional CTM mirror.

```mermaid
flowchart TB
    subgraph agentbox["Agentbox"]
        ID["Nostr identity<br/>(npub/nsec)"]
        RELAY["Embedded relay<br/>:7777"]
        BRIDGE["Pod-inbox bridge"]
        POD["solid-pod-rs<br/>:8484"]
        CTM["Telegram mirror<br/>(optional)"]
    end
    EXT["External agents<br/>/ humans"] -->|"NIP-98 signed events"| RELAY
    RELAY -->|"accepted events"| BRIDGE
    BRIDGE -->|"persist to mailbox"| POD
    ID -->|"signs outbound"| RELAY
    RELAY -->|"fanout"| EXT
    agentbox -.->|"mirror"| CTM
```

```toml
[sovereign_mesh]
enabled = true
solid_pod = true
nostr_bridge = true
https_bridge = false
telegram_mirror = false
publish_agent_events = false
```

See [sovereign-mesh (developer)](../developer/sovereign-mesh.md) for internals.

### `[sovereign_mesh.relay]`

Embedded Nostr relay for external-agent messaging. Gives external humans
and agents a signed, audited path to internal agents; every accepted
event is persisted to the pod mailbox. Specified by
[PRD-004](../reference/prd/PRD-004-external-agent-messaging.md) /
[ADR-009](../reference/adr/ADR-009-embedded-nostr-relay.md) /
[DDD-003](../reference/ddd/DDD-003-sovereign-messaging-domain.md).

```toml
[sovereign_mesh.relay]
enabled          = false
implementation   = "nostr-rs-relay"   # nostr-rs-relay | rnostr | external | off
port             = 7777
bind             = "127.0.0.1"
expose           = false
data_dir         = "/var/lib/nostr-relay"
ingress_policy   = "allowlist"        # allowlist | signed-only | open
allowed_pubkeys  = []
allowed_kinds    = [1, 1059, 30078, 27235, 38000, 38100]
pod_bridge       = true
external_fanout  = "off"              # bidirectional | publish-only | subscribe-only | off
max_event_bytes  = 131072
messages_per_sec = 5
retention_days   = 30
allow_nip04      = false
info_description = "Agentbox sovereign relay"
info_contact     = ""
```

Validator rules:
- **E026**: `enabled=true` requires `sovereign_mesh.enabled` or `sovereign_mesh.solid_pod`.
- **E027**: `implementation="external"` requires `federation.mode="client"` + `external_url`.
- **E028**: `port` must not collide with RESERVED_PORTS or other services.
- **E029**: `bind="0.0.0.0"` + `expose=false` is a wiring error.
- **W030**: `ingress_policy="open"` is a warning (relay accepts writes from anyone).
- **E031**: `allow_nip04=true` — legacy DMs leak metadata; prefer NIP-17.

When `enabled=true`, also add:

```toml
[security.exceptions.nostr-relay]
writable_volumes = ["nostr-relay-data:/var/lib/nostr-relay"]
reason = "nostr-rs-relay SQLite journal and WAL require a writable durable path"
```

Novice-friendly walkthrough: [nostr-relay.md](nostr-relay.md).

## `[networking]`

```toml
[networking]
tailscale     = false   # opt-in VPN tunnel; see security note below
hostname      = "agentbox"
host_gateway  = false   # gate for the host.docker.internal alias
```

### `[networking].tailscale`

Default `false`. Enabling it adds the tailscale exception (`NET_ADMIN` cap) and triggers the W021 audit gate. The SECURITY WARNING in `agentbox.toml` applies: Tailscale bypasses the did:nostr identity boundary. For production deployments prefer the did:nostr + NIP-98 auth path and leave `tailscale = false`.

### `[networking].host_gateway`

Default `false` (commit `2341480c`). When `true`, the generated compose adds:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

This alias lets the container reach services running on the Docker host by name. It is required when pointing `OPENAI_BASE_URL` at a host-side ollama instance (`http://host.docker.internal:11434/v1`). When `false`, `OPENAI_BASE_URL` should point at a Docker-network-resolvable name instead (`http://ollama:11434/v1` if the ollama sidecar is enabled).

Air-gapped and hardened deployments should keep this `false` — the alias punches a named route from the container network to the host network stack.

## `[sovereign_mesh.operator]` — identity configuration

The operator pubkey belongs in per-deployment configuration, not in the shared `agentbox.toml`. Move it to `.env` or `agentbox.local.toml` (which the flake overlay picks up if present):

```toml
# agentbox.local.toml — per-deployment, not committed
[sovereign_mesh.operator]
pubkey_hex = "your-64-char-hex-pubkey"
```

Or pass it as an env var:

```sh
AGENTBOX_NPUB=npub1...   # bech32 form; the entrypoint converts to hex
```

Leaving `pubkey_hex` in a checked-in `agentbox.toml` ties the repo to a specific operator identity. Anyone forking and running gets the same allowlisted pubkey, which allowlists the fork operator's generated signing key against the original identity. The private key must never appear in the manifest — pass it via `AGENTBOX_PRIVKEY_HEX` env var or use NIP-07/NIP-46 remote signing.

## CPU and memory limits

Resource limits belong in `.env`, not hardcoded in `docker-compose.override.yml`. Add to `.env`:

```sh
AGENTBOX_CPU_LIMIT=4      # compose deploy.resources.limits.cpus
AGENTBOX_MEM_LIMIT=8G     # compose deploy.resources.limits.memory
AGENTBOX_CPU_RESERVE=1    # compose deploy.resources.reservations.cpus
AGENTBOX_MEM_RESERVE=2G   # compose deploy.resources.reservations.memory
```

Reference these from `docker-compose.override.yml`:

```yaml
services:
  agentbox:
    deploy:
      resources:
        limits:
          cpus: '${AGENTBOX_CPU_LIMIT:-4}'
          memory: '${AGENTBOX_MEM_LIMIT:-8G}'
        reservations:
          cpus: '${AGENTBOX_CPU_RESERVE:-1}'
          memory: '${AGENTBOX_MEM_RESERVE:-2G}'
```

See `.env.example` in the repo root for all tunable vars with safe defaults.

## `agentbox.sh` subcommands

### `migrate-workspace`

One-shot migration from the legacy `multi-agent-docker_workspace` external volume to an agentbox-owned named volume. Run this before decommissioning MAD:

```sh
./agentbox.sh migrate-workspace                     # interactive
./agentbox.sh migrate-workspace --force             # skip confirmation
./agentbox.sh migrate-workspace --source multi-agent-docker_workspace --target agentbox-workspace
```

What it does:
1. Verifies the source volume exists.
2. Creates the target volume.
3. Stops the agentbox container (so the source isn't mid-write).
4. Rsyncs all content incrementally using `instrumentisto/rsync-ssh:alpine`.
5. Patches `docker-compose.override.yml` to reference the new volume and renames the `mad-workspace` alias to `agentbox-workspace`.
6. Prints next steps (diff, restart, verify, then `docker volume rm` the old volume once confirmed).

### `preflight`

Validates the local environment before `up`. Catches W021 gate failures, missing host bind paths, and compose merge errors:

```sh
./agentbox.sh preflight
```

Checks performed:
- `docker compose config` succeeds (compose merges cleanly).
- `nix build .#compose --no-link` succeeds (W021 audit gate satisfied).
- Host bind target paths exist (`~/.claude`, `~/.config/claude`, configured project path).
- External volumes are present on the Docker daemon.

Run `preflight` before `up` whenever you change `agentbox.toml`, the override file, or `.env`.

## `[security]` and `[security.exceptions.<feature>]`

Hardening baseline is applied unconditionally. Feature-specific privilege expansions are manifest-declared.

### Supervisord user model (commit `2341480c`)

Supervisord runs as PID 1 root. Long-running supervised services drop to `devuser` (uid 1000) via per-program `user=devuser` directives. Root is needed at boot only for: tmpfs dir creation, setuid sudo wrapper provisioning, TLS cert generation, and `chown -R 1000:1000` on runtime directories. After those one-shot operations complete, no agent-facing process runs as root.

The `user: "1000:1000"` compose field is absent from the generated service block. `no-new-privileges:true` remains the baseline security option.

### `[security].audit_acknowledged` — W021 gate

When any active exception widens the attack surface beyond the baseline (non-empty `cap_add`, raw `devices`, or `seccomp=unconfined`), the flake compose generator fails closed at `nix build .#compose` time unless you set:

```toml
[security]
audit_acknowledged = true
```

Review the residual attack surface before setting this to `true`. The current default manifest has SYS_ADMIN (Chromium sandbox) and NET_ADMIN (Tailscale userspace tun) as widening caps. The `agentbox.sh preflight` command checks the W021 gate before `up`:

```sh
./agentbox.sh preflight   # validates W021, override paths, compose merge
```

### `[security].chromium_sandbox_mode` — TODO

Currently only one path exists: the Playwright exception adds `SYS_ADMIN` and `security_opt_override = ["no-new-privileges:false"]` to allow the Chromium user-namespace sandbox. A manifest knob to select between modes is planned but not yet implemented. The two relevant modes are:

- **`sys-admin`** (current): `SYS_ADMIN` cap + `no-new-privileges:false` via Playwright exception. Default for shared hosts.
- **`userns-remap`** (recommended for dedicated hosts): add `"userns-remap": "default"` to `/etc/docker/daemon.json` on the host. The Chromium sandbox works without `SYS_ADMIN` inside the container. Once the manifest knob is implemented, selecting this mode removes both `SYS_ADMIN` and `no-new-privileges:false` from the generated compose. See ADR-007 §"SYS_ADMIN alternative for Chromium-based skills".

### Override surface contract

The base compose (`docker-compose.yml`) owns: image, ports, healthcheck, `security_opt`, `cap_drop`, `cap_add`, `read_only`, `tmpfs`, base volumes, base environment, `depends_on`. Do not duplicate these in `docker-compose.override.yml`.

The override owns: `env_file`, supplementary env vars (API keys, host-specific endpoints), bind mounts to host paths, network attachments, deploy resource limits, `shm_size`. Use the override for per-deployment customisation:

```yaml
# docker-compose.override.yml — operator-owned, not committed to the product repo
services:
  agentbox:
    env_file: .env
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - COMFYUI_API_ENDPOINT=http://comfyui:8188
    volumes:
      - ${HOME}/.claude:/home/devuser/.claude:rw
    deploy:
      resources:
        limits:
          cpus: '${AGENTBOX_CPU_LIMIT:-4}'
          memory: '${AGENTBOX_MEM_LIMIT:-8G}'
    networks:
      - docker_ragflow
```

### `${HOME}/.claude` bind mount — known attack surface

`docker-compose.override.yml` mounts the host `~/.claude` directory as `:rw` so Claude Code can update plugin state, OAuth tokens, and settings from inside the container. This means any compromised tool executing in the container can persist to the host `.claude` and re-enter the host on the next operator invocation.

The `:rw` is functionally required for Claude Code's in-container operation. The recommended alternative (not yet implemented) is directory-scoped mounts:

```yaml
volumes:
  - ${HOME}/.claude/settings.json:/home/devuser/.claude/settings.json:ro
  - ${HOME}/.claude/plugins:/home/devuser/.claude/plugins:rw
  - ${HOME}/.claude/oauth-tokens:/home/devuser/.claude/oauth-tokens:rw
```

The plugin registry absolute-path problem (host paths baked into plugin metadata) makes the full scoped approach complex. The current `:rw` flat mount is the pragmatic default; treat it as a known surface and ensure your host `.claude` does not contain long-lived secrets that should not reach the container.

```toml
[security]
# baseline is implicit: supervisord root PID 1, per-program user=devuser,
# read_only true, cap_drop [ALL],
# tmpfs [/tmp, /run, /var/run, /var/log, /var/log/supervisor],
# security_opt [no-new-privileges:true, seccomp=./config/seccomp-agentbox.json].

# W021 gate: set to true after reviewing residual surface (see above).
audit_acknowledged = true

[security.exceptions.desktop]
tmpfs = ["/tmp/.X11-unix", "/run/user/1000"]

[security.exceptions.gpu-rocm]
devices = ["/dev/kfd", "/dev/dri"]

[security.exceptions.gpu-cuda]
runtime = "nvidia"
device_requests = [{driver = "nvidia", count = -1, capabilities = [["gpu"]]}]

[security.exceptions.gaussian-splatting]
inherits = ["gpu-cuda"]

[security.exceptions.playwright]
cap_add = ["SYS_ADMIN"]                              # Chromium user-namespace sandbox
security_opt_override = ["no-new-privileges:false"]  # required for Chromium sandbox
reason = "chromium user-namespace sandbox"

[security.exceptions.code-server]
writable_volumes = ["codeserver-config:/home/devuser/.local/share/code-server"]

[security.exceptions.telegram-mirror]
writable_volumes = ["ctm-config:/home/devuser/.config/claude-telegram-mirror"]
```

Validator rules **E020/W021**:
- E020: exception declared but feature not enabled → error.
- W021: exception widens attack surface (cap_add / devices / seccomp=unconfined) but `audit_acknowledged` is missing → flake build fails closed.

Full hardening spec: [ADR-007](../reference/adr/ADR-007-runtime-contract-and-container-hardening.md).

---

## Live validation

```sh
agentbox config validate           # full pass
agentbox config validate --quiet   # exit-code only, suitable for pre-commit
```

The validator runs in three places:
1. The interactive TUI (`scripts/start-agentbox.sh`) on every section transition.
2. `flake.nix` at build-time (`builtins.fromTOML` + assertions).
3. CI (`.github/workflows/contract-tests.yml`) on every PR.

## What changes require a rebuild?

| Change | Rebuild needed? |
|---|---|
| `[adapters]` slot swap | No — runtime re-resolves on container restart |
| `[observability]` tweak | No — env vars re-read on restart |
| `[providers.*]` add/enable | No — boot-time env check only |
| Adding/removing a `[skills.*]` or `[toolchains]` | Yes — image contents change |
| `[gpu].backend` change | Yes — device mounts and packages change |
| `[security.exceptions]` change | Yes — compose output changes |
| `[privacy_filter]` enable/disable | Yes — adds the sidecar python env + supervisor block |
| `[privacy_filter.policy.*]` tweak | No — middleware re-reads env on restart |

When in doubt: `./agentbox.sh rebuild`.
