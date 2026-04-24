# Configuration reference

Every key in [`agentbox.toml`](../../agentbox.toml). This is the single source of truth — the Nix flake reads it, the compose generator reads it, the validator enforces it.

After editing, run `agentbox config validate` before `agentbox.sh up`. The validator catches 20 classes of misconfiguration before `nix build` attempts.

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

Five slots. Each resolves to one of three implementation classes.

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

When in doubt: `./agentbox.sh rebuild`.
