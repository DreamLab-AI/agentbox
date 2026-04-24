# Changelog

All notable changes to agentbox are documented here. Format inspired by [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Dates are ISO-8601.

## [Unreleased]

### solid-pod-rs promoted to first-class pod server (2026-04-24)

Completes the DreamLab-AI sovereign data stack. The `pods` adapter slot now
defaults to [`solid-pod-rs`](https://github.com/DreamLab-AI/solid-pod-rs) —
a first-party Rust Solid Protocol 0.11 server. Specified by
[`ADR-010`](docs/reference/adr/ADR-010-rust-solid-pod-adoption.md).

The stack is now coherent end-to-end: one secp256k1 keypair per container,
Schnorr-signed events on HTTP (NIP-98) and WebSocket (NIP-42) surfaces, WAC
policies written against the same npub, content-addressed pod mailboxes
keyed by Nostr event id. No third-party broker.

**What changed:**
- `agentbox.toml`: new top-level `[adapters]` block with `pods = "local-solid-rs"` as the default; new `[integrations.solid_pod_rs]` block for storage/backend/auth/notifications knobs; new `[security.exceptions.solid-pod-rs]` for the `/var/lib/solid` writable volume.
- `schema/agentbox.toml.schema.json`: `pods` enum extended with `local-solid-rs`; full schema for `[integrations.solid_pod_rs]` and the `solid-pod-rs` security exception.
- `scripts/agentbox-config-validate.js`: new rules **E033** (DPoP requires OIDC) and **W034** (`local-jss` deprecation warning). Total semantic rule count is now 33.
- `lib/solid-pod-rs.nix`: new Nix derivation building solid-pod-rs-server from pinned `v0.4.0-alpha.1` via `buildRustPackage`. Cargo features selected from the manifest (fs/memory/s3 backend, OIDC, DPoP cache, notifications). Preserves the upstream AGPL `LICENSE` in `$out/share/doc/solid-pod-rs/`.
- `flake.nix`: `solidPodRsPkg` + `solidPodRsActive` gate wiring; the `[program:solid-pod]` supervisor block now dispatches between the Rust binary (`local-solid-rs`) and the retained Python stub (`local-jss`) based on the manifest. Port `8484` unchanged.
- `management-api/adapters/pods/local-solid-rs.js`: new adapter implementation. Extends `local-jss.js` (wire protocol is identical), overrides `impl` tag, adds LDP Link-rel="next" pagination preference, N3-patch support when the server advertises `Accept-Patch: text/n3`, and capability probing via `OPTIONS /`.
- `management-api/adapters/index.js`: `slotConfig` threads `integrations.solid_pod_rs.base_url` (or constructed bind:port) into the new adapter.

**Docs (ecosystem framing):**
- `README.md`: new "Sovereign data stack" section front-and-centre, showing identity → pod → relay → privacy-filter as a coherent substrate.
- `docs/README.md`: dedicated "Sovereign data stack" table in the user-docs index, separate from feature guides.
- `docs/user/solid-pod.md`: new novice-facing operator guide — why the pod matters, capabilities table against the legacy stub, wizard flow, manifest reference, verify-it's-running commands, Mermaid diagram of the four-loopback-port stack, storage-backend options, licence note.
- `docs/developer/licensing.md`: new canonical AGPL-3.0 aggregation analysis. Documents the allowed/disallowed patterns, FSF citations, the binary-not-library rule, and what contributors must preserve when shipping.
- `docs/reference/adr/ADR-010-rust-solid-pod-adoption.md`: flipped from Proposed → Accepted; added "Position in the sovereign data stack" table; migration paragraph replaces the four-phase deprecation schedule.
- `docs/reference/adr/ADR-005-pluggable-adapter-architecture.md`: `pods` row + implementation layout + manifest contract updated.
- `docs/reference/prd/PRD-001-capabilities-and-adapters.md`: capability row expanded with Solid Protocol 0.11 conformance claim.
- `docs/user/configuration.md`: `[adapters]` block default + `[integrations.solid_pod_rs]` reference + E033/W034 validator entries.
- `docs/user/glossary.md`: Solid-pod definition updated; new "Sovereign data stack" entry; new common-confusion Q&A for solid-pod-rs.
- `docs/user/nostr-relay.md`: pod-is-the-inbox section explicitly cross-references the Rust pod and the atomic-rename invariants.
- `docs/developer/sovereign-mesh.md`: new "Pod server (ADR-010)" section explaining the bridge's direct-filesystem-write contract with solid-pod-rs's fs-backend.

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
