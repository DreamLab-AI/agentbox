# ADR-006: Immutable runtime bootstrap

**Status:** Accepted
**Date:** 2026-04-24
**Author:** Agentbox team
**Related:** PRD-002 (Immutable runtime bootstrap), DDD-001 (Immutable bootstrap domain)

## Context

Agentbox is positioned as a reproducible Nix-built container, but its startup path still installs dependencies and optional CLIs at runtime. That creates four concrete failures:

1. startup depends on outbound network and upstream package registries
2. boot can succeed partially while silently missing requested capabilities
3. the runtime artifact set is not the same as the built image artifact set
4. operator confidence in the manifest and image hash is weakened

The specific anti-pattern is not merely "work at startup"; it is **software dependency resolution at startup**.

## Decision

Agentbox adopts an immutable runtime bootstrap contract.

### Allowed bootstrap responsibilities

Bootstrap may:

- prepare writable directories
- generate local secrets and identity material
- seed workspace defaults
- validate packaged artifacts
- start process supervision

Bootstrap may not:

- install packages
- resolve dependencies
- download browser bundles or model/tool assets needed for declared readiness
- write into `/opt/agentbox`

### Legal writes — three categories

Bootstrap writes are classified into three categories. Code that does not fit one of these is a violation.

| Category | Example paths | Permitted | Notes |
|---|---|---|---|
| **allowed** — writable-directory creation, identity generation, workspace defaults | `/workspace/**`, `/projects`, `/var/lib/ruvector`, `/var/lib/solid`, `/var/lib/agentbox/identities`, `/var/log/supervisor`, `/var/run`, `/tmp/**`, `$WORKSPACE/profiles/default/mgmt-key` | Yes | Core bootstrap responsibility; no network required |
| **legal-but-must-be-explicit** — container-local `/etc` mutations outside `/opt/agentbox` | `/etc/bash.bashrc` (append, idempotent), `/etc/zsh/zshrc` (append, idempotent), `/etc/profile.d/agentbox-runtime.sh` (Stage B write) | Yes — must be declared in `BootstrapPolicy.allowedWrites` in DDD-001 | These are intentional login-shell environment mutations. Each write is idempotent and guarded. `/etc/profile.d/agentbox-runtime.sh` publishes runtime env hints and is Stage B only. All three are in the DDD-001 canonical `allowedWrites` list. |
| **illegal** — any write under the read-only application tree | `/opt/agentbox/**` including `node_modules` subdirs | Never | Violation of immutable root invariant. Node dependencies must be baked into the image by the Nix build derivation, not created at runtime. The current `_install_node_deps` calls in Phase 6 fall into this category and must be removed (see rollout in PRD-002). |

### Packaging rule

Every manifest-enabled service or CLI must be fully represented in the built image as a runtime closure. If that closure cannot be produced, the build or validation step must fail before the operator reaches `docker compose up`.

### Failure rule

A requested capability that is missing at runtime is a fatal configuration error, not a warning.

## Consequences

### Positive

- The running system now matches the built image.
- Offline startup becomes possible.
- Readiness becomes a truthful statement rather than "main process is up."
- Missing feature artifacts are caught earlier and more deterministically.

### Negative

- Image size and build complexity increase for feature-rich variants.
- Some JS-based services need explicit packaging work instead of relying on lazy npm install.
- Existing "self-healing" startup behavior disappears; broken packaging fails visibly.

## Alternatives considered

### Keep the current mutable Stage B

Rejected because it contradicts the reproducibility and operator contract claimed by the product.

### Lazy-install on first feature use

Rejected because it only defers the same nondeterminism and makes failures user-path dependent.

### Init container that performs installs before handoff

Rejected because it still creates a mutable, network-coupled runtime and does not preserve image immutability.

## Implementation notes

The current two-stage startup can remain structurally, but Stage B must become validation and publication only. Any step equivalent to `npm install`, `npm install -g`, or `playwright install` is outside the allowed bootstrap boundary.

### Packaging approach per service

All package-lock.json files are present for every service audited. The preferred primitive is `buildNpmPackage` from nixpkgs for all local sources; it uses the lock file directly and its `npmDepsHash` is the only value that must be kept in sync with upstream changes.

| Service | Source path | Primitive | Special notes | nixpkgs equivalent? | Effort |
|---|---|---|---|---|---|
| management-api | `management-api/` | `buildNpmPackage` | 18 prod deps (fastify + otel + prom-client); pure JS | No | 0.5d |
| mcp / nostr-bridge | `mcp/` | `buildNpmPackage` | 2 deps (nostr-tools, ws); pure JS | No | 0.5d |
| openai-codex/mcp-server | `skills/openai-codex/mcp-server/` | `buildNpmPackage` | 2 deps (@mcp/sdk, openai); pure JS | No | 0.5d |
| lazy-fetch/mcp-server | `skills/lazy-fetch/mcp-server/` | `buildNpmPackage` | TypeScript source — `buildPhase` must run `tsc`; output is `dist/` | No | 1d |
| playwright/mcp-server | `skills/playwright/mcp-server/` | `buildNpmPackage` | playwright dep has native bindings; set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`; browsers come from `pkgs.playwright-driver.browsers` | No | 1d |
| comfyui/mcp-server | `skills/comfyui/mcp-server/` | `buildNpmPackage` + `nativeBuildInputs = [pkgs.python3 pkgs.nodeGyp]` | sharp has native gyp bindings; rebuild against Nix libc | No | 1.5d |
| ruvector (global CLI) | npm registry pin | `buildNpmPackage` | Currently `npx ruvector serve` in supervisord — replace binary path in supervisorText | No | 1d |
| @claude-flow/cli | npm registry pin | `buildNpmPackage` | Large dep tree; verify `claude-flow` binary resolves all sub-commands | No | 1.5d |
| ruflo | npm registry pin | `buildNpmPackage` | Enabled by default in agentbox.toml | No | 1.5d |
| agentic-qe | npm registry pin | `buildNpmPackage` | `aqe init --auto` is a first-run side-effect; must be handled separately | No | 1d |
| nagual-qe | npm registry pin | `buildNpmPackage` | Enabled by default | No | 0.5d |
| codebase-memory-mcp | npm registry pin | `buildNpmPackage` | Enabled by default | No | 1d |
| agent-browser | npm registry pin | `buildNpmPackage` | Interacts with `pkgs.chromium`; set `CHROME_PATH` | No | 1d |
| @mermaid-js/mermaid-cli | npm registry pin | `buildNpmPackage` + `PUPPETEER_SKIP_DOWNLOAD=1` | Point Puppeteer at `pkgs.chromium` via env; add `pkgs.chromium` to browserPackages when mermaid enabled | No | 1d |
| playwright browsers | — | `pkgs.playwright-driver.browsers` (already in flake) | Set `PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}` in imageEnv | Yes (playwright-driver) | 0.5d |

**Hash management:** each `buildNpmPackage` derivation carries an `npmDepsHash` attribute computed via `nix hash path` on the prefetched node_modules. A Renovate `customManagers` block in `.github/renovate.json` with `fileMatch = ["flake\\.nix"]` and per-service `matchStrings` keeps these hashes in sync with `package-lock.json` bumps automatically.

**Install layout:** each local-service derivation's output lands at `$out/opt/agentbox/<service>/` with `node_modules/` already present. The `appRoot` `runCommand` in `flake.nix` is updated to `cp -r ${managementApiPkg}` etc. instead of `cp -r ${./management-api}`. Global CLIs land in the Nix store and are reachable via the `PATH` constructed in `imageEnv` (same mechanism as `codexPackages`).

**No global CLI has a nixpkgs equivalent.** All nine must be packaged from npm tarballs using `buildNpmPackage`. The `fetchNpmDeps` fetcher is called with the pinned version's `package-lock.json` as input. The alternative — keeping them as optional runtime installs with an explicit startup warning — is acceptable only for toolchains that are explicitly feature-gated AND where the operator has accepted a network-capable image variant, but this contradicts the immutable bootstrap contract for the default manifest.

## Follow-ups

- Add artifact probes for each feature-gated supervisor program.
- Move readiness to depend on bootstrap completion and artifact validation. See DDD-001 `validateRuntimeClosure()` and DDD-002 `evaluateReadiness()` for the domain model that governs this dependency.
- Document which runtime writes remain legal and why. The canonical list is in DDD-001 §`BootstrapPolicy.allowedWrites`; this ADR's Legal writes table is its normative cross-reference.
- Decide Phase 1 scope for `skills/host-webserver-debug/mcp-server` and `skills/web-summary/mcp-server` — both have `package-lock.json` and are packaging candidates not yet in the rollout plan (PRD-002 §9).

