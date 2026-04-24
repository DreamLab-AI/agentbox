# Changelog

All notable changes to agentbox are documented here. Format inspired by [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Dates are ISO-8601.

## [Unreleased]

### External agent messaging + embedded Nostr relay (2026-04-24)

Answers the open question "how do external agents reach internal ones":
the pod is the inbox, the relay is how the envelope gets there.

**Spec trio (quality-engineered):**
- [`PRD-004`](docs/reference/prd/PRD-004-external-agent-messaging.md) (323 lines) — actors, inbound/outbound flows, NIP-11/42/17 support matrix, four options axes, SLOs with p95/throughput/error ceilings per op.
- [`ADR-009`](docs/reference/adr/ADR-009-embedded-nostr-relay.md) (281 lines) — decision for `nostr-rs-relay` 0.9.0 (already in nixpkgs), alternatives weighed (rnostr, separate container, HTTP-only, custom Rust), contract-test names, failure-mode recovery.
- [`DDD-003`](docs/reference/ddd/DDD-003-sovereign-messaging-domain.md) (374 lines) — six aggregates (AgentIdentity, PodMailbox, RelayEndpoint, InboundEnvelope, OutboundEnvelope, Subscription), twelve numbered testable invariants I01-I12, anti-corruption layer, property-based test strategy.

**Implementation:**
- `[sovereign_mesh.relay]` manifest block, schema with `additionalProperties: false`, validator rules E026-E029 + W030 + E031.
- `scripts/start-agentbox.sh` gains `section_nostr_relay` — implementation / binding / ingress-policy / external-fanout / retention prompts; only offered when sovereign_mesh is enabled.
- `flake.nix`: `pkgs.nostr-rs-relay` derivation (zero packaging cost), manifest-rendered `/etc/agentbox/nostr-relay.toml`, gated `[program:nostr-relay]` supervisor block, new `[security.exceptions.nostr-relay]` for the writable SQLite volume, port publishing when `expose=true`, full `AGENTBOX_RELAY_*` env surface for the bridge consumer.
- `rnostr` path guarded with `throw` + actionable message since it is not yet in the pinned nixpkgs.

**Docs:**
- [`docs/user/nostr-relay.md`](docs/user/nostr-relay.md) novice guide, configuration.md + troubleshooting.md entries, docs/README.md ADR/PRD/DDD indices, PRD-001 capability row, developer/sovereign-mesh.md extended with embedded-relay section and bridge-consumer contract.

### Local PII redaction via openai/privacy-filter (2026-04-24)

**Spec:**
- [`ADR-008`](docs/reference/adr/ADR-008-privacy-filter-routing.md) — dispatch-path middleware with per-adapter-slot policy (strict/soft/off); fail-closed defaults on `pods` and `memory`.

**Implementation:**
- `[privacy_filter]` manifest block + schema + validator rules E022-E025.
- Wizard gates on GPU presence **or** `nproc ≥ 4 AND MemAvailable ≥ 6 GB` (the MoE keeps all 128 experts resident even though only top-4 fire per token).
- `scripts/opf-router.py`: stateless sidecar exposing `/classify`, `/redact`, `/health`, `/metrics` on loopback `:9092`.
- `flake.nix`: `privacyFilterPythonEnv` (transformers + safetensors + torch + aiohttp) + gated `[program:opf-router]` supervisor block.

**Docs:**
- [`docs/user/privacy-filter.md`](docs/user/privacy-filter.md) with entity classes, policy presets, observability.

### Novice-accessible documentation sweep (2026-04-24)

Four-agent parallel swarm landed these across every doc tier:
- `docs/user/glossary.md` — 60-second mental model, A-Z glossary (now 46 terms), common-confusions Q&A.
- 15 `docs/user/*.md` files framed with "why this exists" / "what it solves" / "when to skip".
- 6 `docs/developer/*.md` enriched with Context paragraphs, "Why not X" callouts anchored to ADRs, Minimum-useful-change examples.
- 13 `docs/reference/{adr,prd,ddd}/*.md` gained `## TL;DR for newcomers` blocks (≤120 words each) without touching canonical content.

### Validator rule inventory (30 rules)

Active: E001-E008 (8), E010-E015 (6), E016-E020 (5), W021, E022-E025 (4, privacy filter), E026-E029 (4, Nostr relay), W030, E031. E009 reserved. The validator header docstring and every downstream reference ("20 semantic rules E001-E020", "18 semantic rules E001-E018") updated to reflect the current inventory.

### Seal-bootstrap awk dedup + docstring cleanup (2026-04-24)

- **Fixed**: `config/seal-bootstrap.sh` `_required_programs()` awk emitted each qualifying program name once per line of the block after the readiness marker (verified on a test fixture: 7 dupes for ruvector, 6 for management-api). Rewrote the awk to track state in a `function emit()` invoked on block transitions and EOF. The seal loop now polls each required program exactly once per pass. Readiness behaviour was not broken — just wasteful — but the duplication would have been fragile if anything downstream consumed the list assuming uniqueness.
- **Docstring cleanup**: `lib/npm-services.nix` preamble and `makeNpmService` parameter doc still claimed `lib.fakeHash` would "throw at eval time", which was outdated after commit `6db0e061` converted the guard to realisation-time-only. Comments now describe the actual lazy behaviour: placeholder SRI substituted at eval; hash mismatch surfaces at realisation with a `preFetch` operator hint.

### Bootstrap + eval-time P0 fixes (2026-04-24)

Two regressions caught in post-merge review. Both shipped in `6db0e061`.

**`/ready` now actually fires.** The generated `supervisorText` in `flake.nix` did not include the `[program:bootstrap-seal]` block — it only lived in `config/supervisord-nix.conf`, which was not wired into the image. Without the seal program, `/run/agentbox/bootstrap.done` was never written, `/ready` returned 503 indefinitely, and the docker healthcheck (`curl -f /ready`) never turned green. Fixed by adding `[program:bootstrap-seal] priority=99` directly to the generator and tagging `management-api` and `ruvector` with `environment=AGENTBOX_REQUIRED_FOR_READINESS="true"` so `seal-bootstrap.sh` has real gates to poll. Orphan `config/supervisord-nix.conf` deleted.

**`nix flake check` / `nix build .#compose` / `nix eval` now work on a fresh clone.** `lib.fakeHash` previously triggered an eval-time throw in both `lib/npm-services.nix` and `lib/npm-cli.nix`, blocking every flake consumer — not just `nix build .#runtime`. Replaced with a lazy approach: fakeHash substitutes a placeholder SRI so eval succeeds, and a `preFetch` hook emits an operator-friendly hint only when realisation is attempted. `buildNpmPackage` / `fetchurl` surface the hash mismatch at build time with Nix's standard format plus the hint. Only `nix build .#runtime` (actual realisation) still needs operator prefetch.

### Documentation reorganisation (2026-04-24)

Audience-tiered split:
- `docs/user/` — operator-facing (quickstart, installation, configuration, running, platforms, troubleshooting, providers, backup, consuming-image, provisioning, feature guides)
- `docs/developer/` — contributor-facing (architecture, adapters, testing, sovereign-mesh, skills-upgrade, version-tracking)
- `docs/reference/{adr,prd,ddd}/` — canonical specs (7 ADRs, 3 PRDs, 2 DDDs)

Top-level `README.md` rewritten as a world-class product pitch with Mermaid architecture diagram and full link graph into the new docs tree. `docs/README.md` restructured as an audience-tiered nav hub.

### Runtime contract + container hardening (2026-04-24)

Implements [PRD-003](docs/reference/prd/PRD-003-runtime-contract-and-container-hardening.md) + [ADR-007](docs/reference/adr/ADR-007-runtime-contract-and-container-hardening.md) + [DDD-002](docs/reference/ddd/DDD-002-runtime-contract-domain.md).

**Image reference selection**:
- Generated compose now uses `image: ${AGENTBOX_IMAGE_REF:-agentbox:runtime-<system>}` so operators can switch between local builds and registry-pulled images with an env var.
- `agentbox.sh up` gains `--build` and `--registry` flags (mutually exclusive) plus `--wait-live` to wait on `/livez` rather than `/ready`.

**Three-endpoint probe semantics**:
- `/livez` — process-alive only (<100ms, no external checks).
- `/ready` — bootstrap sentinel present + every non-`off` adapter healthy + required filesystem mounts accessible + Nostr relays reachable when `[sovereign_mesh].publish_agent_events=true`. Returns 503 with `{ready, reason, missing[]}` when any requirement unmet.
- `/health` retained as aggregate for humans; Docker healthcheck now gates on `/ready`.
- `/v1/meta` gains `observability: { metrics_endpoint, otlp_endpoint }`.

**End-to-end observability**:
- Five-link chain: `agentbox.toml [observability]` → flake imageEnv → compose ports → OCI ExposedPorts → management-api metrics server. `agentbox.sh health` discovers the endpoint via `/v1/meta` and scrapes it.

**Hardened-by-default container**:
- Baseline: `user: 1000:1000`, `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`, `seccomp=default`, tmpfs for `/tmp`, `/run`, `/var/run`, `/var/log`, `/var/log/supervisor`.
- `[security.exceptions.<feature>]` manifest deltas with inherit/merge semantics. Seven mappings: `desktop`, `gpu-rocm`, `gpu-cuda`, `gaussian-splatting`, `playwright`, `code-server`, `telegram-mirror`. Baseline drops are structurally immutable — exceptions can only add.
- Validator rules E020 (orphan exception) and W021 (enabled feature missing its exception).
- `SecurityProfileApplied` structured log event at startup.

### Immutable runtime bootstrap (2026-04-24)

Implements [PRD-002](docs/reference/prd/PRD-002-immutable-runtime-bootstrap.md) + [ADR-006](docs/reference/adr/ADR-006-immutable-runtime-bootstrap.md) + [DDD-001](docs/reference/ddd/DDD-001-immutable-bootstrap-domain.md).

**Packaged closures replace runtime installers**:
- Six local npm services via `buildNpmPackage` (new `lib/npm-services.nix`): management-api, mcp/nostr-bridge, skills/openai-codex/mcp-server, skills/lazy-fetch/mcp-server, skills/playwright/mcp-server, skills/comfyui/mcp-server.
- Nine global npm CLIs via tarball fetch + `buildNpmPackage` (new `lib/npm-cli.nix`): ruvector 0.2.23, @claude-flow/cli 3.5.80, ruflo 3.5.80, agentic-qe 3.9.15, codebase-memory-mcp 0.6.0, agent-browser 0.26.0, playwright 1.59.1, @mermaid-js/mermaid-cli 11.12.0. (nagual-qe awaits public publication.)
- All Stage B `npm install` and `npm install -g` calls deleted from the entrypoint.
- TypeScript build for lazy-fetch-mcp uses `pkgs.nodePackages.typescript` (respects Nix sandbox).

**Bootstrap lifecycle**:
- `config/seal-bootstrap.sh` as `[program:bootstrap-seal]` (priority 99) writes `/run/agentbox/bootstrap.done` atomically after all required-for-readiness programs reach RUNNING.
- `config/validate-artifacts.sh` runs pre-supervisord and fails fast on any missing required artifact (no silent `|| true`).
- Ten bootstrap observability events emitted as pino JSON tagged `agentbox.stage: bootstrap`.
- `AGENTBOX_STRICT_IMMUTABLE=true` escalates the `/opt/agentbox:rw` warning to a fatal error.

### OpenAI Codex Rust CLI + upstream version tracking (2026-04-24)

- `lib/codex-binary.nix` — Nix derivation pulling OpenAI's official pre-built musl tarball (rust-v0.124.0), pinned per-arch (x86_64 + aarch64 linux sha256). `[toolchains.codex]` manifest gate.
- `renovate.json` — custom regex managers for Codex, ComfyUI, Gemini CLI, gitleaks-action, and all nine npm CLI versions.
- `.github/workflows/nix-flake-update.yml` — weekly `nix flake update` with `nix flake check` validation and auto-PR.
- `scripts/check-upstream-releases.sh` — human dashboard comparing pinned vs latest upstream.
- `docs/developer/version-tracking.md` — the three update channels, Codex bump worked example.

### Platform compatibility (2026-04-24)

- Flake `eachSystem` now includes `x86_64-darwin` and `aarch64-darwin`. Container-image outputs gated behind `lib.optionalAttrs pkgs.stdenv.isLinux`; portable `compose` output available on macOS.
- CUDA eligibility tightened to `isLinux && isx86_64` (was `isx86_64` alone).
- `.github/workflows/build-multi-arch.yml` builds on native runners (ubuntu-latest + ubuntu-24.04-arm) and publishes `ghcr.io/dreamlab-ai/agentbox:<sha>` + `:latest` as a single multi-arch manifest.
- `.github/workflows/flake-check.yml` evaluates the flake on both Linux archs per PR.
- New guides: `docs/user/platforms.md`, `docs/user/consuming-image.md`, `docs/user/running.md` (per-host cookbook).

Linux x86_64 and aarch64 are fully supported (build + run). macOS and Windows are runtime-supported via Docker Desktop pulling the published image. Apple Silicon GPU (Metal), Intel oneAPI, and Windows native are not supported.

### Test coverage completion (2026-04-24)

- 5 runtime-contract tests (RC-002-01..05) mapping PRD-002 acceptance criteria.
- 5 runtime-contract tests (RC-003-06..10) mapping PRD-003 acceptance criteria.
- 23 pytest cases for the TUI Python helpers.
- 7 Nostr-bridge integration tests with local WebSocket echo servers.
- 9 resolver-degraded-start tests.
- 4 hardening edge-case tests (key typo, multi-feature dedup, 7-parametric E020).
- 2 bootstrap edge tests (seal-timeout negative, writable-root warning).
- Validator rules E001–E020 + W021 all enforced and tested (49 active + 1 Nix-skipped).
- Contract harness at 145 passing / 33 todo. Remaining todos have per-test unblock notes citing the specific external-infra dependency (k6, WAC-capable JSS, ONNX runtime, SSD-backed CI).

### M2 — daily ergonomics + adapter implementations (2026-04-23)

**Five adapter triples implemented** (local-* / external / off per slot): beads, pods, memory, events, orchestrator. Shared `adapters/base.js` + `adapters/errors.js` (`AdapterDisabled`, `UnknownAdapterImpl`).

**Adapter resolver + boot wiring**: `adapters/manifest-loader.js` + `adapters/index.js`. `/health` reports per-adapter health; `/v1/meta` reports per-adapter impl.

**`agentbox.sh` gains local lifecycle verbs**: `up`, `down`, `build`, `rebuild`, `logs`, `shell`, `health`.

**Manifest JSON Schema + `agentbox config validate` CLI**: `schema/agentbox.toml.schema.json`, 20 semantic rules.

**Observability**: Prometheus `/metrics` on port 9091 + OpenTelemetry OTLP + pino structured logs.

**Developer ergonomics**: `.devcontainer/devcontainer.json` (Nix-flakes base + DinD), `config/zellij/layouts/agentbox.kdl` (11-tab layout), shell aliases, tmux-compat.

### M1 — safety floor + contract harness (2026-04-23)

- Nix build reproducibility test (`tests/reproducibility/nix-build-hash.sh`).
- Management-api `/health` + `/v1/meta` endpoints (public, pre-auth).
- Docker Compose healthcheck.
- Auto-generated `MANAGEMENT_API_KEY` on first boot (persisted at `/workspace/profiles/default/mgmt-key`, mode 0600).
- gitleaks CI workflow (v2.3.2) with canary test.
- `agentbox.sh backup` and `restore` verbs (alpine-helper volume I/O, secrets excluded by default).
- Jest contract test harness × 5 slots.

### Agentbox extraction (2026-04-23)

Agentbox was extracted from a larger host project during a radical-upgrade sprint. Initial commit replaced a 1,188-line Dockerfile + 2,379-line bash entrypoint monolith with a Nix flake, manifest-driven composition, and an adapter-pattern architecture. The design priorities — reproducibility, adapter pattern, manifest-gating — came directly from lessons learned in the original monolith.
