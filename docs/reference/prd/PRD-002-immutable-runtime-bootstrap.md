# PRD-002: Immutable runtime bootstrap

**Status:** Draft v2
**Date:** 2026-04-24
**Related:** PRD-001 (Capabilities and adapters), ADR-006 (Immutable runtime bootstrap), DDD-001 (Immutable bootstrap domain)

### Changelog

| Version | Date | Summary |
|---|---|---|
| Draft v1 | 2026-04-24 | Initial draft — immutable bootstrap contract, four-phase rollout |
| Draft v2 | 2026-04-24 | R1 packaging audit integrated: `comfyui/mcp-server` added to Phase 1 with native-gyp note; effort totals corrected to ~13d+2d CI; `skills/host-webserver-debug/mcp-server` and `skills/web-summary/mcp-server` identified as unscoped candidates (noted as follow-up); Renovate hash-management step made explicit; cross-references to ADR-006 packaging table and DDD-001 invariants tightened |

> **Scope.** This document specifies the product requirements for item `1`: removing mutable dependency installation from container startup so agentbox boots as an immutable, pre-packaged runtime rather than a best-effort VM-like environment.

## 1. Problem summary

Agentbox presents itself as a Nix-built, reproducible container, but startup still performs mutable runtime work:

- installs Node dependencies into copied source trees
- installs global CLIs with `npm install -g`
- downloads Playwright browsers on first boot
- tolerates failures with `|| true`

That makes the boot result depend on network access, upstream registries, startup timing, and partial failure. The product contract is currently stronger than the runtime behavior.

## 2. Product goals

1. **Boot must be deterministic.** Two runs of the same image and manifest must start with the same binaries and dependency graph.
2. **Boot must not require network access.** Network should be optional for application work, not required for the container to become ready.
3. **Boot must fail fast on packaging errors.** Missing runtime artifacts must surface as explicit startup failures, not degraded best-effort warnings.
4. **Runtime mutation must be narrow and intentional.** Startup may create instance state, but it must not resolve software dependencies.
5. **Feature gates must remain truthful.** If a manifest flag enables a service or toolchain, the image must already contain the required executable and libraries.

## 3. Non-goals

- Replacing `supervisord` in this phase.
- Redesigning the skills catalog or feature taxonomy.
- Eliminating writable runtime state such as generated identities, profile directories, or persisted local data.
- Splitting all optional capabilities into separate containers.

## 4. Users and operator stories

### 4.1 Operator

As an operator, I want `docker compose up` to succeed offline if I already have the image, so container readiness does not depend on npm or browser downloads.

### 4.2 Maintainer

As a maintainer, I want packaging failures to appear at build time or immediately at process start, so regressions are caught before a user reaches a half-configured runtime.

### 4.3 Integrator

As an integrator, I want manifest flags to correspond to artifacts already present in the image, so I can reason about capabilities from the manifest alone.

## 5. Product requirements

### 5.1 Immutable startup contract

Startup must not:

- download packages from npm, PyPI, GitHub, or similar registries
- run package-manager resolution (`npm install`, `pnpm install`, `pip install`, `playwright install`)
- mutate the read-only application tree under `/opt/agentbox`

Startup may:

- create or validate writable directories
- generate instance-local secrets and identity material
- provision workspace defaults and profile scaffolding
- start supervised processes

### 5.2 Feature artifact completeness

For every enabled manifest capability that starts a service or exposes a CLI, the built image must already include:

- the executable entrypoint
- its runtime dependency closure
- any required static assets or browser/runtime bundle

This includes service-local `node_modules` or an equivalent packaged closure.

### 5.3 Build-time validation

The build pipeline must validate that each enabled service block has a resolvable runtime artifact. If an enabled feature cannot be packaged, the build must fail or the manifest validator must reject the configuration.

### 5.4 Startup failure semantics

Missing artifacts at startup must be fatal for required features. Silent `|| true` fallback is not acceptable for bootstrap-critical work.

### 5.5 Offline boot

Given a locally available image and volumes, startup must succeed with outbound network blocked, unless the selected application mode explicitly requires an external endpoint after readiness.

### 5.6 Bootstrap observability

Bootstrap must emit structured status for:

- bootstrap started
- bootstrap phase completed
- bootstrap failed
- missing artifact detected

Those events must be visible through logs and readiness state.

## 6. Acceptance criteria

1. `config/entrypoint-unified.sh` contains no package-manager install or dependency download steps.
   **Test:** `RC-002-03` (entrypoint linter) — grep scan of `config/entrypoint-unified.sh` for `npm install`, `pnpm`, `pip install`, `playwright install`, `npm install -g`, and `npx.*install`; zero matches required.

2. A cold boot with egress blocked reaches readiness for a valid standalone manifest.
   **Test:** `RC-002-01` (no-network boot) — container started with `--network none`; asserts `GET /ready` returns HTTP 200 within 60 s.

3. If an enabled service artifact is missing, startup fails deterministically with a specific error.
   **Test:** `RC-002-05` (missing-artifact fatal) — entrypoint wrapper unlinks one required binary before supervisor init; asserts supervisord exits non-zero and stderr matches `FATAL:.*missing` within 30 s.

4. The application tree under `/opt/agentbox` remains immutable at runtime.
   **Test:** `RC-002-04` (read-only app tree) — container started with `/opt/agentbox` bind-mounted read-only; asserts boot reaches readiness and no write attempt inside `/opt/agentbox` is logged.

5. Feature-gated services can be started without creating `node_modules` inside the container filesystem at boot.
   **Test:** `RC-002-02` (artifact probes) — for each binary in the feature matrix (playwright, codex, gemini-cli, claude-code, ruflo, agentic-qe, code-server, nostr-bridge), assert binary present in PATH and `--version` or `--help` exits 0; no `node_modules` directory created under `/opt/agentbox` during probe phase.

## 7. Success metrics

| Metric | Current problem | Target |
|---|---|---|
| Boot requires registry/network for dependency resolution | Yes | No |
| Best-effort bootstrap steps with silent failure | Present | Zero bootstrap-critical silent failures |
| Cold-start time variance caused by downloads | High | Low and bounded |
| Drift between built image and started runtime | Possible | Eliminated for packaged features |

## 8. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Larger images | Pre-packaging dependencies increases image size | Use feature gates, layer boundaries, and separate variants where needed |
| More build-time work | Some errors move earlier in the lifecycle | Acceptable trade: fail early, not at customer boot |
| Packaging complexity for JS tools | Some tools assume install-time side effects | Package wrappers and assets explicitly; add artifact probes per capability |

## 9. Rollout

**Phase 1 — Local service packages (6 services, ~5d)**

1. Add `buildNpmPackage` derivations in `flake.nix` for the six local services: `management-api`, `mcp` (nostr-bridge), `skills/openai-codex/mcp-server`, `skills/lazy-fetch/mcp-server`, `skills/playwright/mcp-server`, and `skills/comfyui/mcp-server`. Each derivation sets `src = ./<service>`, `npmDepsHash = "<prefetched-hash>"`, and `postInstall` copies the built tree into `$out/opt/agentbox/<service>`. The `lazy-fetch` derivation additionally runs `tsc` in `buildPhase` before packaging `dist/`. The `comfyui/mcp-server` derivation adds `nativeBuildInputs = [pkgs.python3 pkgs.nodeGyp]` because the `sharp` dependency has native bindings that require a gyp rebuild; gate behind `skills.media.comfyui_builtin`. Note: `skills/host-webserver-debug/mcp-server` and `skills/web-summary/mcp-server` have package-lock files and are packaging candidates; scoping to Phase 1 or later is a follow-up decision.
2. Remove the five `_install_node_deps` calls from Phase 6 of `config/entrypoint-unified.sh`. Replace with a probe loop: for each expected `node_modules` path, `test -d "$path" || { echo "FATAL: missing closure $path"; exit 1; }`.
3. Add `checkPhase` to each derivation: `node <entrypoint> --version` or `node -e "require('./<main>')"` — confirms the closure loads without import errors.
4. Update `appRoot` in `flake.nix` to copy each derivation's output rather than the raw source directory, so the Nix-built `node_modules` are baked into the image layer.

**Phase 2 — Global CLI toolchains (9 packages, ~9d)**

5. Add `buildNpmPackage` derivations for the nine global CLIs currently installed in Phase 7: `ruvector`, `@claude-flow/cli`, `ruflo`, `agentic-qe`, `nagual-qe`, `codebase-memory-mcp`, `agent-browser`, `playwright` (CLI wrapper only — browsers handled separately), `@mermaid-js/mermaid-cli`. Pin each to the same version range currently used at runtime. Add each derivation to `allPackages` behind its existing `lib.optionals` feature gate, mirroring the `codexPackages` pattern already used for the Codex binary.
6. Replace all nine `npm install -g` lines in Phase 7 of `config/entrypoint-unified.sh` with a single comment block explaining that these CLIs are now pre-packaged. Phase 7 becomes a no-op; remove it or reduce it to the artifact probe for each enabled CLI (`command -v ruflo || { echo "FATAL: ruflo not in PATH"; exit 1; }`).
7. For `playwright` browsers: the `flake.nix` already includes `pkgs.playwright-driver` in `browserPackages`. Set `PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}` in `imageEnv` when `browserCfg.playwright` is true. Remove the `npx playwright install chromium` call from Phase 7.
8. For `@mermaid-js/mermaid-cli` (depends on Chromium via Puppeteer): set `PUPPETEER_SKIP_DOWNLOAD=1` and `PUPPETEER_EXECUTABLE_PATH=${pkgs.chromium}/bin/chromium` in the derivation's build environment; add `pkgs.chromium` to `browserPackages` unconditionally when mermaid is enabled.

**Phase 3 — Hash management and CI (1d)**

9. Add a Renovate `customManagers` entry in `.github/renovate.json` (or create it) with `fileMatch = ["flake\\.nix"]`, `matchStrings` targeting each `npmDepsHash = "..."` line, and `datasourceTemplate = "npm"`. This keeps each hash in sync with `package-lock.json` bumps without manual `nix hash` runs.
10. Add a `nix flake check` step to the CI pipeline that builds all derivations and runs their `checkPhase`. Gate image build on this step passing.

**Phase 4 — Cleanup and acceptance (1d)**

11. Delete `STAGE_B_MODE` and the Phase 6/7 function bodies from `config/entrypoint-unified.sh` once all probe replacements are in place. Stage B becomes purely: validate probes, publish `profile.d` env hints, emit `BootstrapCompleted` event.
12. Update `docs/guides/quick-start.md` and `README.md` to remove the note about first-boot network requirement. Add a build-time note: "Run `nix build .#runtime` to produce a fully self-contained image; no network access is required at container start."

