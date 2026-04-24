# PRD-002: Immutable runtime bootstrap

**Status:** Draft v1
**Date:** 2026-04-24
**Related:** PRD-001 (Capabilities and adapters), ADR-006 (Immutable runtime bootstrap), DDD-001 (Immutable bootstrap domain)

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
2. A cold boot with egress blocked reaches readiness for a valid standalone manifest.
3. If an enabled service artifact is missing, startup fails deterministically with a specific error.
4. The application tree under `/opt/agentbox` remains immutable at runtime.
5. Feature-gated services can be started without creating `node_modules` inside the container filesystem at boot.

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

1. Remove Stage B package installation from startup.
2. Package currently boot-installed dependencies into image layers or explicit runtime closures.
3. Add artifact validation for feature-gated services.
4. Convert readiness to depend on successful immutable bootstrap completion.

