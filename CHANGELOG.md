# Changelog

All notable changes to agentbox are documented here.

Format inspired by [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Dates are ISO-8601.

## [Unreleased]

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
