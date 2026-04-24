# Changelog

All notable changes to agentbox are documented here.

Format inspired by [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Dates are ISO-8601.

## [Unreleased]

### OpenAI Codex Rust CLI + version-tracking system (2026-04-24)

**Codex integration**:
- New `lib/codex-binary.nix` — Nix derivation fetching OpenAI's official pre-built musl tarball from `github.com/openai/codex/releases/tag/rust-v0.124.0`, pinned per-arch (x86_64 and aarch64 linux sha256 recorded). Static binary, zero runtime deps beyond the container's glibc-less base.
- `[toolchains.codex]` manifest gate (default off) plumbed through `agentbox.toml`, JSON schema, `flake.nix` (`codexPackages` appended to `allPackages` when enabled), and `ENABLE_CODEX` env var.
- Shell aliases `zcodex`, `codex-help`, `codex-version` in `config/agentbox-aliases.sh`.
- `tests/cli/smoke.sh` asserts `codex --help` + `codex --version` when the toolchain is installed; skips cleanly otherwise.
- README Agent-surface table gains a Codex row.

**Upstream version tracking**:
- `renovate.json` — base config (`config:recommended` + semantic commits + dependency dashboard). Custom regex managers for the Codex version, ComfyUI rev, Gemini CLI version, and gitleaks-action version. Security-sensitive packages (`@anthropic-ai/claude-code`, `nostr-tools`, `@noble/curves`) locked to manual review.
- `.github/workflows/nix-flake-update.yml` — weekly (Mon 06:00 UTC) `nix flake update` + `nix flake check --no-build` validation, auto-opens a PR. Also `workflow_dispatch`-able.
- `scripts/check-upstream-releases.sh` — human dashboard that queries `gh` / `npm` / `curl` and prints a colourised pinned-vs-latest table for every tracked dependency. Not CI; operator tool.
- `docs/guides/version-tracking.md` (~100 lines) — the three update channels, bumping Codex worked example, how to add a new tracked ecosystem, rollback.
- README Operations & dev-ergonomics table gains a version-tracking row.

### Platform compatibility (2026-04-24)

- **Flake systems extended** — `eachSystem` now includes `x86_64-darwin` and `aarch64-darwin` alongside the two Linux targets. macOS users get `nix build .#compose` and `nix develop` natively.
- **Container images gated to Linux** — `packages = lib.optionalAttrs pkgs.stdenv.isLinux { runtime / full / desktop / default / cuda-runtime / gaussian-splatting }`. The portable `compose` output stays cross-platform.
- **CUDA eligibility tightened** — `lib/gpu-backend.nix` uses `cudaEligible = pkgs.stdenv.isLinux && pkgs.stdenv.isx86_64` (was `isx86_64` alone, which would incorrectly pass on `x86_64-darwin`).
- **Multi-arch publishing** — `.github/workflows/build-multi-arch.yml` builds on native runners (`ubuntu-latest` + `ubuntu-24.04-arm`, GitHub's free ARM64 runners) and publishes `ghcr.io/dreamlab-ai/agentbox:<sha>` + `:latest` as a single multi-arch manifest. No QEMU.
- **aarch64 flake-check CI** — `.github/workflows/flake-check.yml` evaluates the flake on both Linux archs per PR.
- **Docs** — new `docs/guides/platforms.md` (full matrix incl. GPU backends per OS), new `docs/guides/consuming-the-image.md` (pull instructions), README compatibility table, `docs/README.md` Operator-reference row for the registry.

**Honest summary**: Linux x86_64/aarch64 fully supported (build + run). macOS + Windows are runtime-supported via Docker Desktop pulling the published image. No Apple Silicon GPU (Metal), no Intel oneAPI, no Windows native.

### M4 — 3DGS stack: COLMAP + METIS + LichtFeld Studio (P3.2) (2026-04-23)

**3D Gaussian Splatting stack gate (P3.2)**:

- `lib/3dgs-stack.nix` — new library exporting `makeGaussianSplattingPackages { system }`: returns `[ colmap metis lichtfeld-studio ]` on x86_64-linux; gracefully returns empty list (with `lib.warn`) on aarch64 so the flake still evaluates; each derivation enables CUDA where applicable
- `colmap`: `pkgs.colmap.overrideAttrs` with `-DCUDA_ENABLED=ON`; pins to nixpkgs unstable colmap 3.10 (nixpkgs commit `da32c79e`, 2025-03-18)
- `metis`: `pkgs.metis` 5.1.0 from nixpkgs (CPU-only graph partitioner; no CUDA component)
- `lichtfeld-studio`: `stdenv.mkDerivation` with `fetchFromGitHub`; upstream repo URL unconfirmed — `rev` and `sha256` stubbed with `# TODO: resolve upstream repo and pin rev` comments; build structure (CMake, CUDA flags, `opencv`/`eigen`/`glfw` inputs) is complete and will build once the SHA is filled in
- `flake.nix`: imports `lib/3dgs-stack.nix`; `gauss3dPackages` bound via `lib.optionals (spatialCfg.gaussian_splatting or false)`; appended to `spatialPackages`; new `packages.${system}.gaussian-splatting` output builds a `cuda-runtime`-based image with the 3DGS stack layered on top (`nix build .#gaussian-splatting`)
- `tests/3dgs/reconstruction-smoke.sh`: reads `gaussian_splatting` gate from `agentbox.toml`; exits 77 when disabled; 4 TAP assertions — colmap on PATH, `colmap feature_extractor --help` responds, gpmetis/metis on PATH, fixture PNG has correct magic bytes
- `tests/3dgs/fixtures/sample-256.png`: minimal 256x256 solid-grey RGB PNG for smoke test
- `docs/guides/3dgs.md` (≤60 lines): prerequisites, tool table, pipeline steps, output paths, CUDA arch note
- Gating: validator rule E006 already enforces `gaussian_splatting=true → gpu.backend="local-cuda"`; no new validator changes required

### M4 — CUDA 13.1 toolchain + cuda-runtime image variant + ComfyUI switches (2026-04-23)

**ComfyUI built-in / external switches (P3.5)**:

- `agentbox.toml`: `skills.media.comfyui_builtin` (was the old monolithic `comfyui_integration`); new `[integrations.comfyui_external]` section with `enabled`, `url`, `ws_url` — mirrors the pattern of other external integrations
- `schema/agentbox.toml.schema.json`: `skills.media.comfyui_builtin` only; `integrations.comfyui_external` added as typed object; old `comfyui_integration` / `comfyui_external` keys under `skills.media` removed
- Validator E007 updated: now checks `skills.media.comfyui_builtin` vs `integrations.comfyui_external.enabled` (cross-section rule); `KNOWN_SKILLS` cleaned to remove retired keys
- `flake.nix` built-in path: `fetchFromGitHub` pins ComfyUI v0.3.27; `comfyuiPythonEnv` wraps torch/torchvision/transformers/safetensors and friends; `[program:comfyui-builtin]` supervisor block added, binds to `127.0.0.1:8188`; external path: `COMFYUI_URL` + `COMFYUI_WS_URL` baked into `imageEnv` from manifest values (or 127.0.0.1 defaults for built-in)
- `mcp/mcp.json` `comfyui` server block: hardcoded URL literals removed; server now inherits `COMFYUI_URL` / `COMFYUI_WS_URL` from the container environment
- `docs/guides/comfyui.md` (57 lines): both paths, mutual exclusion, remote-instance config, port collision note

### M4 — CUDA 13.1 toolchain + cuda-runtime image variant (2026-04-23)

**CUDA 13.1 toolchain gate (P3.1)**:

- `lib/gpu-backend.nix` `local-cuda` branch now accepts `toolchainsCudaEnabled` parameter; when `true` and on x86_64, appends `cudaPackages_13_1.{cudatoolkit,cudnn,cutensor,libcublas,libcufft}` to `nixPackages` via `lib.optionals stdenv.isx86_64`
- `dispatchGpuBackend` signature extended to `backend -> toolchainsCudaEnabled`; Nix eval-time assertion enforces `toolchainsCudaEnabled → backend="local-cuda"` (mirrors E019)
- `flake.nix` threads `toolchainCfg.cuda or false` into the dispatch call; fixes pre-existing stray semicolon in `allPackages` concatenation
- New `packages.${system}.cuda-runtime` flake output — `runtime`-based image with CUDA 13.1 baked in; `nix build .#cuda-runtime`
- Validator rule E019 added to `scripts/agentbox-config-validate.js`: `[toolchains.cuda]=true` without `[gpu.backend]="local-cuda"` emits `E019 [toolchains.cuda]=true requires [gpu.backend]="local-cuda"`
- 2 E019 tests in `tests/config/semantic-rules.test.js` (invalid + valid)
- Smoke test `tests/cuda/nvidia-smi-smoke.sh`: skips (exit 77) if CUDA not enabled or docker unavailable; asserts `docker exec agentbox nvidia-smi` exits 0; requires host NVIDIA driver + nvidia-container-toolkit
- PRD-001 §3.3 updated: dispatch signature, §3.3.1 (`[toolchains].cuda` gate), §3.3.2 (CUDA build variant)
- Default `[toolchains].cuda = false` unchanged; default `runtime` image unaffected

### M3 — ecosystem + manifest-driven compose (2026-04-23)

**Skills as content-addressed Nix input (D.9)** — seam in place; remote extract deferred:
- `flake.nix` now declares `inputs.skills` as a `path:./skills` flake input (`flake = false`)
- `outputs` receives `skills` and binds it to `skillsTree`; `appRoot` copies from `skillsTree` rather than the hardcoded `./skills` path
- Operationally a no-op: path-type inputs are file-system equivalent to the previous `${./skills}` reference
- Migration seam established: switching to `github:DreamLab-AI/agentbox-skills/main` + `nix flake lock --update-input skills` is the sole change required once the upstream repo is created
- `tests/flake/skills-input.sh` — smoke test verifying the input is declared; skip-77 when nix absent
- `docs/guides/skills-upgrade.md` — full migration guide (current path state, future remote state, step-by-step extract)
- Full extract (Path A) is a future milestone pending creation of `DreamLab-AI/agentbox-skills`; `skills/` remains the committed source of truth until then

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

**Blender & TeX Live verification (P3.3 + P3.4)**:
- Blender: `pkgs.blender` from nixpkgs-unstable (4.x stable; 5.0.1+ available via overlay)
  - `[skills.spatial_and_3d].blender` controls gated inclusion in `spatialPackages`
  - `tests/toolchains/blender-present.sh` — verifies `blender --version` exits 0 when enabled; skips (exit 77) if disabled
  - `docs/guides/blender.md` (22 lines) — version details, MCP server path, custom package workflow
- TeX Live: `pkgs.texliveFull` from nixpkgs-unstable (~7K packages)
  - `[skills.docs].latex` controls gated inclusion; includes biber for bibliography
  - Alternative: `scheme-full` (equivalent), `scheme-medium` (3K packages), `scheme-small` (400 packages) for space-constrained builds
  - `tests/toolchains/latex-present.sh` — verifies `pdflatex --version` + `biber` when enabled; skips (exit 77) if disabled
  - `docs/guides/latex.md` (47 lines) — covered packages, custom package addition, downsizing strategy

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
