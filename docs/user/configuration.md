# Configuration reference

Every key in [`agentbox.toml`](../../agentbox.toml). This is the single source of truth — the Nix flake reads it, the compose generator reads it, the validator enforces it.

## Why this file exists

Instead of editing Dockerfiles, compose YAML, supervisor configs and CLI flags separately, Agentbox puts the entire build-and-runtime surface into one TOML manifest. Change a key, re-validate, rebuild if needed; everything downstream follows. Full product spec: [PRD-001](../reference/prd/PRD-001-capabilities-and-adapters.md).

**What it solves**

- Config drift between the image, the compose file and the runtime env.
- "Which file do I edit to turn off the desktop?" — one answer, always.
- Invalid combinations caught before a 10-minute Nix build (validator error codes `E001`–`E025`).

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

```toml
[adapters]
beads        = "local-sqlite"          # local-sqlite | external | off
pods         = "local-jss"             # local-jss   | external | off
memory       = "embedded-ruvector"     # embedded-ruvector | external-pg | off
events       = "local-jsonl"           # local-jsonl | external | off
orchestrator = "local-process-manager" # local-process-manager | stdio-bridge | off
```

Validator rules:
- **E001**: `"external"` requires `federation.mode = "client"` + `federation.external_url`.
- **E002**: `memory = "external-pg"` requires `[integrations.ruvector_external].conninfo`.
- **E003**: `orchestrator = "stdio-bridge"` must not bind an HTTP port.

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

```toml
[sovereign_mesh]
enabled = true
solid_pod = true
nostr_bridge = true
https_bridge = false
telegram_mirror = false
publish_agent_events = false
jss_rust_backend = false
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

## `[security]` and `[security.exceptions.<feature>]`

Hardening baseline is applied unconditionally. Feature-specific privilege expansions are manifest-declared.

```toml
[security]
# baseline is implicit: user 1000:1000, read_only true, cap_drop [ALL],
# tmpfs [/tmp, /run, /var/run, /var/log, /var/log/supervisor],
# security_opt [no-new-privileges, seccomp=default].

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
cap_add = ["SYS_ADMIN"]    # Chromium sandbox
reason = "chromium user-namespace sandbox"

[security.exceptions.code-server]
writable_volumes = ["codeserver-config:/home/devuser/.local/share/code-server"]

[security.exceptions.telegram-mirror]
writable_volumes = ["ctm-config:/home/devuser/.config/claude-telegram-mirror"]
```

Validator rules **E020/W021**:
- E020: exception declared but feature not enabled → error.
- W021: feature enabled that usually needs an exception, but block is missing → warning.

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
