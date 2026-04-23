# Changelog

All notable changes to agentbox are documented here.

Format inspired by [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Dates are ISO-8601.

## [Unreleased]

### M3 — ecosystem + manifest-driven compose (2026-04-23)

**Compose-from-manifest (D.1)** — `flake.nix` now emits `docker-compose.yml` content from `agentbox.toml`:
- New `composeText` generator in `flake.nix` mirrors the existing `supervisorText` pattern
- `packages.compose` flake output writes the file; committed `docker-compose.yml` is the auto-generated snapshot
- `[integrations.ragflow]`, `[integrations.ruvector_external]`, `[desktop]`, `[toolchains.code_server]`, port exposures — all driven by manifest
- `tests/flake/compose-generator.sh` asserts build success + ragflow-toggle flips the `networks:` block
- One source of truth: adding an integration is now a single manifest key

**Unified GPU dispatch (D.2)** — `[gpu].backend` is the single key driving all GPU-related decisions:
- New `lib/gpu-backend.nix` exports `dispatchGpuBackend` returning `{ devicesNeeded, runtimeClass, envVars, nixPackages, composeDeviceReservations, supervisorExtraEnv, ollamaEnabled }`
- Four values — `"none"` (no GPU, ollama omitted), `"ollama-rocm"` (ROCm/Vulkan via `/dev/kfd`+`/dev/dri`), `"ollama-cuda"` (NVIDIA container runtime), `"local-cuda"` (CUDA toolchain baked into image, enables `gaussian_splatting`)
- Consumed by `flake.nix` (packages + env) and the compose generator (device mounts + runtime)
- `tests/flake/gpu-backend.test.sh` — 20 TAP assertions, 5 per backend
- PRD-001 §3.3 documents the dispatch table

**Providers sections (D.3)** — per-provider gates replace bare env vars:
- 10 `[providers.*]` sections: anthropic, openai, gemini, deepseek, perplexity, openrouter, context7, brave, github, zai — all default-off
- Each has `enabled`, `env_var`, `optional_env_vars`
- Validator rules E017 (missing env var for enabled provider) and E018 (placeholder value warning)
- `.env.example` trimmed from 53 bare vars to infrastructure + per-provider block structure with header comment
- Boot-time warning (not fatal) per enabled provider missing its env var
- `docs/guides/providers.md` (56 lines) — supported providers, env vars, optional overrides, add-new-provider workflow

**Nostr-bridge fleshout (D.6)** — from 31-line stub to 483-line real client:
- Connection pool with exponential-backoff retry per relay (reads `NOSTR_RELAYS` env)
- Subscribe with kind filtering; multi-subscription routing
- Publish with fan-out to all connected relays; signer loaded from encrypted profile-local key (`nostr.key.enc`)
- `verifyNip98(authHeader, method, url)` — kind 27235, u/method tag match, 60s freshness, Schnorr signature via `@noble/curves/secp256k1`
- `management-api/middleware/auth.js` soft-delegates to this verifier when present; falls back to structural validation otherwise
- 33 unit tests across 7 behavioural groups, zero network I/O
- `docs/guides/sovereign-mesh.md` (90 lines) — Nostr client behaviour, key handling, verifyNip98 contract, security notes
- Library: `nostr-tools@^2.23.3` (audited `@noble/curves` for Schnorr)

**Gemini CLI toolchain (P2.3)** — official `@google/gemini-cli` pinned to v0.38.2:
- `[toolchains.gemini_cli]` manifest gate (default off)
- `flake.nix` includes `nodejs_20` + npm-install path when enabled; `ENABLE_GEMINI_CLI` env plumbed
- Aliases: `zgemini`, `gemini-help`, `gemini-version` in `config/agentbox-aliases.sh`
- `tests/cli/smoke.sh` asserts `gemini --help` + `gemini --version` when toolchain installed
- v0.38.2 brings 1M context, Chapters narrative flow, Context Compression, worktree support (April 2026 release)
- No daemon mode needed — CLI runs interactively

**claude-zai GLM-5 upgrade (P2.4)**:
- `claude-zai/claude-config.json` model: `glm-4.6` → `glm-5`
- `claude-zai/Dockerfile` pins `@anthropic-ai/claude-code@2.1.47` (was `@latest`)
- 3-line SECURITY comment documenting the pin rationale
- Pin blocks auto-upgrade from a hypothetically malicious upstream release; rotation is PR-only

**Ontology skill gate (P2.5, light)**:
- `[skills.ontology] enabled = false` — prepared placeholder for the Logseq OWL2 DL workflow
- Schema + semantic-rules tests updated
- Quick-start doc entry: enabling this gate loads `skills/ontology-core` + `skills/ontology-enrich` into the agent skill surface
- MCP tool wiring deferred to a future milestone

**Contract tests promoted**: 91 → **145 passing / 33 todo** (target was 130+).
Remaining todos are legitimately pending:
- SLO/p95 latency checks (×5 variants, ×3 impls = 15) — require production load env
- `PermissionDenied` × 3 — requires WAC-capable JSS runtime, not the in-memory stub
- `EmbeddingError` × 3 — requires broken-embedding-pipeline mock; neither real impl triggers it
- 1 more SLO variant for orchestrator
- M4-onward work

### M2 — daily ergonomics + adapter implementations (2026-04-23)

**Five adapter triples implemented** (local-\* / external / off per slot):

- **beads**: `local-sqlite` (SQLite-backed epic/child/dependency store), `external` (HTTP client), `off` (AdapterDisabled)
- **pods**: `local-jss` (HTTP client to local JavaScriptSolidServer on port 8484), `external`, `off`
- **memory**: `embedded-ruvector` (in-process vector cache), `external-pg` (PostgreSQL-backed via `pg` driver), `off`
- **events**: `local-jsonl` (append-only JSONL at `/workspace/events/YYYY-MM-DD.jsonl`), `external` (HTTP POST), `off` (no-op per ADR-005)
- **orchestrator**: `local-process-manager` (wraps existing ProcessManager), `stdio-bridge` (exposes `docker exec -i` spawn/events channel), `off`

Shared infrastructure: `adapters/base.js`, `adapters/errors.js` (`AdapterDisabled`, `UnknownAdapterImpl`).

**Adapter resolver + boot wiring**:
- `adapters/manifest-loader.js` reads `AGENTBOX_MANIFEST_PATH` / `/etc/agentbox.toml` via `@iarna/toml`
- `adapters/index.js` resolves `[adapters]` → concrete instances at startup; unknown impls fail fast
- `/health` now includes `adapters: { <slot>: "healthy"|"degraded"|"off" }`
- `/v1/meta` now includes `adapter_impls: { <slot>: "<impl-name>" }`
- Adapter `connect()` failures downgrade to `off` with a warning — except orchestrator, which is fatal
- Graceful shutdown calls `disconnect()` for each adapter (5 s timeout)

**Contract tests promoted**: from 50 passing / 123 todo (M1) to **91 passing / 54 todo** (M2). 35+ real behavioural assertions now exercise the live adapter implementations against in-memory fakes and SQLite `:memory:` databases.

**agentbox.sh gains local lifecycle verbs** (D.5):
- `up [--build]` — docker compose up + health poll
- `down [--volumes]` — destructive-confirm on `--volumes`
- `build [--variant runtime|desktop|full]` — nix build; prints result path
- `rebuild` — down + build + up --build chained
- `logs [service]` — supervisorctl tail with compose-logs fallback
- `shell [profile]` — bash, or Zellij agentbox layout inside a profile dir
- `health [--json]` — pretty or raw; exits non-zero on degraded
- `tests/cli/smoke.sh` verifies `--help` works on all new verbs

**Manifest JSON Schema + validator** (D.4):
- `schema/agentbox.toml.schema.json` (305 lines, draft 2020-12, `additionalProperties: false` at every section)
- `scripts/agentbox-config-validate.js` Node CLI implementing 16 semantic rules E001–E016 from ADR-005 §validation
- `scripts/agentbox` bash dispatcher (`agentbox config validate [path]`)
- `tests/config/semantic-rules.test.js` — 33/33 pass (two per rule plus one extra valid case for E016)
- Build-time integration: flake.nix can consume the validator output; invalid manifests fail the build before Nix eval

**Observability** (PRD-001 §10a, ADR-005 §Observability):
- `management-api/observability/metrics.js` — Prometheus registry with Counter/Histogram/Gauge for adapter dispatch; `wrapDispatch()` helper for implementations
- `observability/logger.js` — structured JSON via pino with consistent `{ts, level, slot, method, impl, duration_ms, session_id, outcome}` fields
- `observability/tracing.js` — OpenTelemetry SDK; OTLP exporter when `AGENTBOX_OTLP_ENDPOINT` set, no-op otherwise
- `observability/metrics-server.js` — standalone Fastify server on port `AGENTBOX_METRICS_PORT` (default 9091)
- Dependencies: `prom-client`, `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/auto-instrumentations-node`
- Build-info gauge set from `AGENTBOX_IMAGE_HASH` / `AGENTBOX_MANIFEST_CHECKSUM` / `AGENTBOX_FEDERATION_MODE`

**Developer ergonomics**:
- `.devcontainer/devcontainer.json` for VS Code Remote / Codespaces — Nix-flakes base, DinD, 7 canonical forwarded ports, no `/var/run/docker.sock` mount
- `.devcontainer/README.md` onboarding doc
- `config/zellij/layouts/agentbox.kdl` — 11-tab layout (claude, ruflo, qe, docs, build, logs, vcs, memory, llm, agents, host-shell)
- `config/zellij.kdl` — default zellij config points at agentbox layout
- `config/agentbox-aliases.sh` — `z`, `zattach`, `zls`, `zkill`, `zstack`; tmux-compat aliases `tmux-attach`, `tmux-ls`
- Entrypoint sources aliases in `/etc/bash.bashrc` and `/etc/zsh/zshrc`

### M1 — safety floor + contract harness (2026-04-23)

**Added**:
- `tests/reproducibility/nix-build-hash.sh` — double-build sha256 equality check, skip-77 when nix absent
- `management-api` `/health` + `/v1/meta` endpoints (public, pre-auth)
- `management-api/adapters/contract-versions.js` — five initial 1.0.0 contract versions per ADR-005
- Docker Compose healthcheck (`curl -f :9090/health`, 30 s interval)
- Auto-generated `MANAGEMENT_API_KEY` on first boot, persisted under profile dir, mode 0600
- `[sovereign_mesh] https_bridge = false` default; flake.nix supervisor block wired
- `.github/workflows/secret-scan.yml` — gitleaks-action v2.3.2
- `.gitleaks.toml` with `.env.*` allowlist and `AKIA.*EXAMPLE` canary exemption
- `tests/security/secret-canary.sh` — verifies CI catches real-looking secrets
- `agentbox.sh backup` and `restore` verbs — alpine-helper volume I/O, MANIFEST.json archives, secrets-excluded-by-default
- `tests/backup/round-trip.sh` — smoke test
- Contract-test harness skeleton × 5 slots (Jest 29); 50 passing + 123 todo assertions at M1
- `.github/workflows/contract-tests.yml` — runs suites on PR
- Placeholder adapter stubs per slot (superseded by M2 triples)

**Changed**:
- `skills/SKILL-DIRECTORY.md` — replaced empty file with 112-line navigable index
- `README.md` / `CLAUDE.md` / `docs/guides/quick-start.md` — aligned with manifest-driven architecture, observability, new health endpoints
- `README.md` + `PRD-001` + `ADR-005` — mermaid diagrams added (architecture-at-a-glance, manifest→build→runtime, five-slot adapters, standalone-vs-federated, /v1/meta handshake sequence)
- `docs/README.md` — new navigation hub with reading order

**Removed**:
- `config/supervisord.conf` — legacy, superseded by flake-generated supervisor
- "Agentbox 2.0" branding throughout → just "Agentbox"
- Host-project name leaks: `visionflow` → `external_bridge`, `agentic-workstation` → `external-mcp-bridge`, `visionflow-neo4j` → `external-neo4j`, `visionflow-jss` → `external-jss`, author leaks fixed

### 2026-04 radical-upgrade sprint

- PRD-001 (capabilities and adapters) written — standalone product spec
- ADR-005 (pluggable adapter architecture) written — five-slot pattern with SLOs, contract versioning, observability, contract-test harness as merge gate
- Five open questions resolved: Hyprland/Wayland desktop default, ragflow as env-switch integration, official `@google/gemini-cli` replaces the old "Gemini Flow" plan, ontology tools port default-off, CUDA build-flag default-off, dual ComfyUI switches, single `/projects` mount, Zellij retained with tmux-compat aliases, sovereign-mesh core ecosystem (not speculative)
- QE fleet pre-implementation audit — **Conditional GO for M1**; five P0 and seven P1 doc edits landed before any code

---

*See `docs/README.md` for reading order. Pre-M1 history lives in the extraction record of the sprint.*
