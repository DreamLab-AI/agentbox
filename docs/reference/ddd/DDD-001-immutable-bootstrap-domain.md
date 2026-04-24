# DDD-001: Immutable Bootstrap Domain

**Date**: 2026-04-24
**Status**: Accepted
**Bounded Context**: Immutable Bootstrap
**Cross-references**: PRD-002 (product requirements), ADR-006 (decision record + legal-writes table), DDD-002 (runtime contract domain — readiness depends on `BootstrapCompleted` from this domain)

---

## TL;DR for newcomers
*Skip if you already know the immutable-bootstrap bounded context.*

This DDD captures the Immutable Bootstrap bounded context: the part of the system whose only job is to answer, truthfully, "does this image already contain everything needed to boot the declared capabilities?" The pain point this model addresses is that bootstrap responsibilities were previously smeared across entrypoint scripts, supervisor config, and ad-hoc health checks, so nothing owned the distinction between a legal startup write (prepare writable dir, seed identity) and an illegal one (install a package, mutate `/opt/agentbox`). The shape of the answer is a domain with explicit aggregates (`RuntimeClosure`, `BootstrapPolicy`, `BootstrapSession`), a ubiquitous language for artefact probes and bootstrap completion, and a single invariant: no illegal mutation, ever. You will get the glossary, aggregates, invariants, and the events this domain emits downstream.

**If you remember only one thing:** this domain owns the legal-mutation boundary at boot — anything that installs, downloads, or mutates `/opt/agentbox` is illegal by construction.

For the deep version, keep reading.

## Domain Purpose

The Immutable Bootstrap domain ensures that agentbox startup realizes a pre-built runtime rather than assembling one. Its job is to answer one question truthfully: "Does this image already contain everything required to boot the capabilities declared by the manifest?"

## Bounded Context Definition

**Boundary**: This domain owns startup-time artifact validation, bootstrap policy, and the legal mutation surface during boot.

**Owns**: Bootstrap policy, packaged artifact inventory, startup validation outcomes, bootstrap completion state.

**Does not own**: Image build mechanics themselves, operator-facing compose selection, steady-state health aggregation, metrics server binding.

## Ubiquitous Language

| Term | Definition |
|---|---|
| **Runtime Closure** | The complete set of executables, libraries, assets, and packaged dependencies required to boot the selected capabilities. |
| **Bootstrap Policy** | The explicit rules that define what startup is allowed to mutate or execute. |
| **Artifact Probe** | A deterministic check proving that a required packaged artifact exists and is runnable. |
| **Bootstrap Completion** | The moment startup has finished legal initialization and the runtime is eligible for readiness evaluation. |
| **Illegal Mutation** | Any startup action that resolves software dependencies, downloads runtime artifacts, or mutates `/opt/agentbox`. |

## Aggregates

### RuntimeClosure (Root Aggregate)

The central aggregate describing whether the built image is bootable for the selected manifest.

```
RuntimeClosure
  +-- capabilities: CapabilityArtifact[]
  +-- bootstrapPolicy: BootstrapPolicy
  +-- completionState: BootstrapCompletionState
  |
  +-- CapabilityArtifact
  |     +-- capabilityId: string
  |     +-- entrypoint: string
  |     +-- requiredAssets: string[]
  |     +-- probe: ArtifactProbe
  |     +-- requiredForReadiness: boolean
  |
  +-- BootstrapPolicy
  |     +-- allowedWrites: WritablePath[]   // see canonical list below
  |     +-- forbiddenOperations: string[]
  |     +-- immutableRoots: string[]
  |
  +-- BootstrapCompletionState
        +-- phase: "not_started" | "validating" | "completed" | "failed"
        +-- failedCapabilityId: string | null
        +-- reason: string | null
```

### Invariants

1. Every readiness-critical capability must have an Artifact Probe.
2. `/opt/agentbox` is always an immutable root. No write to any path under `/opt/agentbox` is permitted at any bootstrap phase, including Stage B. `node_modules` directories under `/opt/agentbox/**` must be baked into the image by the Nix build, not created at runtime.
3. A Runtime Closure cannot be `completed` if any required Artifact Probe fails.
4. Bootstrap Policy must forbid dependency-resolution operations (`npm install`, `npm install -g`, `pnpm install`, `pip install`, `playwright install`, or any equivalent package-manager invocation).

## Entities

### CapabilityArtifact

Represents one runtime capability that must already exist in the image.

**Identity**: `capabilityId`.

**Lifecycle**: Materialized from the manifest and packaged image contents; validated at startup; fails closed if missing.

### ArtifactProbe

Represents how the system proves that a packaged artifact exists.

**Identity**: `capabilityId + probe type`.

**Examples**:

- executable exists on disk
- entrypoint launches with `--version` or equivalent
- required asset path exists

## Value Objects

| Value Object | Structure | Notes |
|---|---|---|
| `BootstrapOutcome` | `{ status, failedCapabilityId, reason }` | Immutable summary of bootstrap result |
| `MutationScope` | `{ writableRoots[], immutableRoots[] }` | Encodes the allowed startup write surface |
| `ProbeResult` | `{ success: boolean, detail: string }` | Result of one artifact validation |

### BootstrapPolicy.allowedWrites — canonical list

The following write targets are explicitly permitted at bootstrap time. Any path not in this list is illegal.

| Category | Path | Stage | Rationale |
|---|---|---|---|
| Runtime directories | `/workspace` (and subdirs) | A | Operator-visible workspace; writable by design |
| Runtime directories | `/projects` | A | Shared projects root across profiles |
| Runtime directories | `/var/lib/ruvector` | A | RuVector data store |
| Runtime directories | `/var/lib/solid` | A | Solid pod storage |
| Runtime directories | `/var/lib/agentbox/identities` | A | Sovereign identity material |
| Runtime directories | `/var/log/supervisor` | A | Supervisor log output |
| Runtime directories | `/var/run` | A | PID files and sockets |
| Runtime directories | `/tmp` (and subdirs) | A | Ephemeral scratch space |
| Identity material | `$WORKSPACE/profiles/default/mgmt-key` | A | Per-instance management API secret; generated once |
| Shell profile seeding | `/etc/bash.bashrc` (append only, idempotent) | A | Sourcing agentbox-aliases; append is guarded by a grep check |
| Shell profile seeding | `/etc/zsh/zshrc` (append only, idempotent) | A | Same as above for zsh |
| Environment hints | `/etc/profile.d/agentbox-runtime.sh` | B | Login-shell env var publication; write is Stage B only |

**Not permitted** (regardless of stage):

- Any path under `/opt/agentbox/**`
- Package-manager operations that create new files under any path (`npm install`, `npm install -g`, `playwright install`, etc.)

### Example CapabilityArtifact — management-api service

```
CapabilityArtifact {
  capabilityId:        "management-api"
  entrypoint:          "/opt/agentbox/management-api/index.js"
  requiredAssets:      [
    "/opt/agentbox/management-api/node_modules",
    "/opt/agentbox/management-api/adapters"
  ]
  probe: ArtifactProbe {
    type:    "node-require"
    command: "node -e \"require('/opt/agentbox/management-api/index.js')\" --dry-run"
  }
  requiredForReadiness: true
}
```

## Domain Events

| Event | Trigger | Payload |
|---|---|---|
| `BootstrapStarted` | Startup begins validation | `{ timestamp }` |
| `CapabilityValidated` | One required artifact probe passes | `{ capabilityId }` |
| `MissingArtifactDetected` | A required probe fails | `{ capabilityId, reason }` |
| `BootstrapCompleted` | All required probes pass and legal setup finishes | `{ timestamp }` |
| `BootstrapFailed` | Startup cannot continue | `{ failedCapabilityId, reason }` |

## Key Behaviors

### validateRuntimeClosure() -> BootstrapOutcome

Checks every readiness-critical Capability Artifact and fails on the first required missing artifact.

### enforceBootstrapPolicy(operation) -> allowed | denied

Guards startup operations against the Bootstrap Policy. Any dependency-resolution action is denied.

### completeBootstrap() -> BootstrapCompletionState

Transitions the aggregate to `completed` only after all required probes succeed and legal initialization work finishes.

## Integration Points

| Consuming Domain | Interface | Direction | Notes |
|---|---|---|---|
| Manifest Validation | enabled capabilities | Validation -> Immutable Bootstrap | Determines what must exist in the Runtime Closure |
| Nix Build | packaged runtime artifacts | Build -> Immutable Bootstrap | Supplies the closure that bootstrap validates |
| Runtime Contract Domain (DDD-002) | bootstrap completion state | Immutable Bootstrap -> Runtime Contract | Readiness depends on bootstrap completion |
| Observability | bootstrap events/logs | Immutable Bootstrap -> Observability | Emits startup evidence |

## CapabilityArtifact Examples by Service Class

Each concrete service type maps to one of four packaging classes, each with a distinct Nix primitive and probe strategy.

### Class A — Locally-built npm service

Source lives in the agentbox repo; packaged via `buildNpmPackage`; `node_modules` baked into the image.

```
CapabilityArtifact {
  capabilityId:     "management-api"
  entrypoint:       "/opt/agentbox/management-api/server.js"
  requiredAssets:   ["/opt/agentbox/management-api/node_modules"]
  probe: ArtifactProbe {
    type:    "exec-check"
    command: "node --check /opt/agentbox/management-api/server.js"
    // --check parses without executing; confirms closure is importable
  }
  requiredForReadiness: true
}
// Other Class A members: mcp/nostr-bridge, openai-codex/mcp-server,
//   lazy-fetch/mcp-server (buildPhase runs tsc first), playwright/mcp-server,
//   comfyui/mcp-server (nativeBuildInputs: [nodeGyp python3] for sharp)
```

### Class B — Globally-installed npm CLI (feature-gated)

Pre-packaged into the Nix store via `buildNpmPackage` against a pinned npm tarball; binary exposed through `imageEnv PATH`. No nixpkgs equivalent exists for any of these tools.

```
CapabilityArtifact {
  capabilityId:     "ruflo-cli"
  entrypoint:       "<nix-store-path>/bin/ruflo"
  requiredAssets:   []
  probe: ArtifactProbe {
    type:    "exec-version"
    command: "ruflo --version"
    // exits 0 and emits a semver string
  }
  requiredForReadiness: false
  // fatal only when toolchains.ruflo = true in manifest
}
// Other Class B members: @claude-flow/cli, agentic-qe, nagual-qe,
//   codebase-memory-mcp, agent-browser, ruvector, @mermaid-js/mermaid-cli
// Note: @mermaid-js/mermaid-cli requires PUPPETEER_SKIP_DOWNLOAD=1 +
//   PUPPETEER_EXECUTABLE_PATH=${pkgs.chromium}/bin/chromium at build time.
```

### Class C — Skill MCP server (local npm + manifest gate)

Combines Class A packaging with Class B conditionality: local source, `buildNpmPackage`, enabled only when the parent skill flag is true in agentbox.toml.

```
CapabilityArtifact {
  capabilityId:     "playwright-mcp"
  entrypoint:       "/opt/agentbox/skills/playwright/mcp-server/server.js"
  requiredAssets:   [
    "/opt/agentbox/skills/playwright/mcp-server/node_modules",
    "<playwright-driver-browsers-path>/chromium-*/chrome-linux/chrome"
  ]
  probe: ArtifactProbe {
    type:    "exec-check"
    command: "node --check /opt/agentbox/skills/playwright/mcp-server/server.js"
  }
  requiredForReadiness: false
  // requiredForReadiness: true when skills.browser.playwright = true
}
// Other Class C members: lazy-fetch/mcp-server, comfyui/mcp-server,
//   openai-codex/mcp-server, host-webserver-debug/mcp-server, web-summary/mcp-server
```

### Class D — Pre-fetched browser/runtime bundle

A static binary bundle sourced from a Nix derivation (`pkgs.playwright-driver.browsers`), not from npm. Already partially present in `flake.nix`; requires `imageEnv` to set `PLAYWRIGHT_BROWSERS_PATH` to the store path.

```
CapabilityArtifact {
  capabilityId:     "playwright-browsers"
  entrypoint:       "<pkgs.playwright-driver.browsers>/chromium-*/chrome-linux/chrome"
  requiredAssets:   ["<pkgs.playwright-driver.browsers>"]
  probe: ArtifactProbe {
    type:    "path-glob"
    command: "test -x $PLAYWRIGHT_BROWSERS_PATH/chromium-*/chrome-linux/chrome"
  }
  requiredForReadiness: false
  // requiredForReadiness: true when skills.browser.playwright = true
}
// Other Class D candidates: Blender binary (spatial_and_3d.blender),
//   ComfyUI model weights (not Nix-managed — operator-supplied volume mount)
```

## Design Notes

This domain exists because "startup script" is too vague a concept. The real boundary is whether boot **realizes** a built runtime or **constructs** one. Once startup is modeled as a domain with invariants, mutable package installation becomes a domain violation rather than an implementation detail.

