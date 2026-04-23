# Quick Start

This guide reflects the current Agentbox runtime.

## Recommended Path

Use the interactive launcher unless you specifically want to edit files by hand:

```bash
./scripts/start-agentbox.sh
```

The launcher can:

- present checkbox-based feature selection
- update `agentbox.toml`
- create `.env` from `.env.example`
- prompt for key environment values
- check/install missing prerequisites interactively
- optionally build the image
- optionally start the Docker stack

## 1. Configure The Build

Manual path:

Edit [`agentbox.toml`](../../agentbox.toml) before building.

Key sections:

- `[federation]` — `mode = "standalone"` (default) or `"client"`
- `[adapters]` — one per durable-state slot (beads, pods, memory, events, orchestrator)
- `[sovereign_mesh]` — Nostr identity + NIP-98 auth
- `[skills.*]` — 96-skill catalogue gates
- `[toolchains]` — core CLIs (claude, ruflo, claude_flow, agentic_qe, gemini_cli, etc.)
- `[gpu]` — `none` (default, no ollama sidecar) | `ollama-rocm` (ROCm/Vulkan via `/dev/kfd`+`/dev/dri`) | `ollama-cuda` (NVIDIA container runtime, sidecar only) | `local-cuda` (CUDA baked into image; required for `gaussian_splatting`)
- `[desktop]` — Hyprland/Wayland (default) or X11/openbox
- `[observability]` — metrics port, OTLP endpoint, log level
- `[providers.*]` — per-provider API-key gates

Minimal example (standalone, local fallbacks for everything):

```toml
[federation]
mode = "standalone"

[adapters]
beads = "local-sqlite"
pods = "local-jss"
memory = "embedded-ruvector"
events = "local-jsonl"
orchestrator = "local-process-manager"

[sovereign_mesh]
enabled = true

[skills.browser]
playwright = true

[toolchains]
claude = true
claude_code = true
ruflo = true
agentic_qe = true

[gpu]
backend = "none"
```

Federated example (drops into a host container mesh):

```toml
[federation]
mode = "client"
external_url = "http://host-orchestrator:7070"

[adapters]
beads = "external"
pods = "external"
memory = "external-pg"
events = "external"
orchestrator = "stdio-bridge"

[integrations.ruvector_external]
enabled = true
conninfo = "postgresql://ruvector@ruvector-postgres:5432/ruvector"
```

Always run `agentbox config validate` after editing — it checks semantic rules (e.g. `gaussian_splatting = true` requires `gpu.backend = "local-cuda"`) before the build.

### Ontology skill gate (prepared placeholder)

```toml
[skills.ontology]
enabled = false   # default — ontology-core + ontology-enrich are not loaded
```

Set `enabled = true` to load the `ontology-core` and `ontology-enrich` skills into the agent's skill surface. These skills target Logseq OWL2 DL TBox workflows and are opt-in because they carry specific domain assumptions (Logseq graph conventions, OWL2 DL reasoner tooling). When `enabled = false` (the default) neither skill is registered and no extra tooling is pulled into the image.

This gate is a **prepared placeholder** — the MCP server and associated tooling for ontology operations will be fleshed out in a future milestone. Enabling the flag now has no runtime effect beyond advertising the skills in the manifest; downstream agents that check the manifest before loading skills will respect it once the implementation lands.

## 2. Build The Image

```bash
nix build .#runtime
docker load < result
```

Optional variants:

```bash
nix build .#desktop
nix build .#full
```

## 3. Configure Environment

Manual path:

```bash
cp .env.example .env
```

Provider API keys are gated by `[providers.*]` sections in `agentbox.toml`.
Only set the env vars for providers you have enabled — the validator (E017) will
warn at boot for any enabled provider whose env var is missing.

1. In `agentbox.toml`, set `enabled = true` for each provider you want:

   ```toml
   [providers.anthropic]
   enabled = true
   env_var = "ANTHROPIC_API_KEY"
   ```

2. In `.env`, fill in the corresponding value:

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

Infrastructure vars (always required regardless of providers):

- `MANAGEMENT_API_KEY` — API key for the management HTTP API
- `AGENTBOX_AGENT_ID` — stable identity label for this instance
- `NOSTR_RELAYS` — comma-separated Nostr relay URLs
- `WORKSPACE` — shared workspace mount path
- `SHARED_PROJECTS_ROOT` — shared projects mount path

For the full provider reference, optional overrides, and instructions for adding
new providers see [`docs/guides/providers.md`](providers.md).

## 4. Start The Stack

The preferred boot path uses `agentbox.sh up`, which starts the stack and blocks until the management API health endpoint responds (or times out after 60 s):

```bash
./agentbox.sh up
```

If you just rebuilt the Nix image and need to load it before starting:

```bash
./agentbox.sh up --build
```

Direct compose is also fine for simple cases, but you will need to poll health manually:

```bash
docker compose up -d
```

For a full dev-loop iteration (stop existing stack, rebuild image, restart):

```bash
./agentbox.sh rebuild
```

## 5. Verify Host-Level Container State

Use `agentbox.sh health` to get a per-service status summary:

```bash
./agentbox.sh health          # pretty-print; exits non-zero if any service is degraded
./agentbox.sh health --json   # raw JSON; always exits 0
```

Low-level Docker commands for deeper inspection:

```bash
docker compose ps
docker logs --tail 100 agentbox
docker inspect --format '{{json .State.Health}}' agentbox
```

If the container is using an older image or an older entrypoint, use `agentbox.sh rebuild` to rebuild and recreate it.

## 6. Verify Runtime Services

From the host:

```bash
curl http://localhost:9090/health
curl http://localhost:9090/v1/meta        # adapter contract versions + image hash
curl http://localhost:9091/metrics        # Prometheus — scrape this
curl http://localhost:9700/health
curl http://localhost:8484/health         # only when [adapters.pods] = "local-jss"
```

From inside the container:

```bash
docker exec agentbox supervisorctl status
docker exec agentbox zellij --version
docker exec agentbox /opt/agentbox/scripts/zellij-stack.sh ruflo-orchestrator
docker exec agentbox ls -la /workspace/profiles
docker exec agentbox ls -la /projects
```

## 7. Inspect Provisioned Profiles

The runtime creates these profile roots:

- `/workspace/profiles/claude-core`
- `/workspace/profiles/ruflo-orchestrator`
- `/workspace/profiles/qe-fleet`
- `/workspace/profiles/nagual-qe`
- `/workspace/profiles/rust-builder`
- `/workspace/profiles/docs-latex`

Each one should expose:

- `.claude/settings.json`
- `.claude/skills -> /opt/agentbox/skills`
- `projects -> /projects`
- `workspace -> /workspace`

## 8. Storage Paths

- RuVector: `/var/lib/ruvector`
- Solid-style pod storage: `/var/lib/solid`
- Sovereign identities: `/var/lib/agentbox/identities`
- Shared workspace: `/workspace`
- Shared external projects: `/projects`

## 9. Terminal Workflow

Inside the container:

```bash
zclaude
zruflo
zqe
zdocs
```

Those commands open the seeded Zellij layouts for the main stacks.

## Troubleshooting

### Docker is running but the container is unhealthy

Check whether the container is still an older image using the old keepalive-only supervisor config.

### `9090` health checks fail

The management API may not be running in the current container image, or the container may be older than the repo state.

### Profile directories are missing

Check the entrypoint and logs:

```bash
docker logs agentbox
docker exec agentbox ls -la /workspace
```

### Solid or RuVector paths do not exist

Verify the volumes are mounted and the entrypoint bootstrap ran successfully.
