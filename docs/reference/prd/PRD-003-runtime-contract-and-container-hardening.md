# PRD-003: Runtime contract and container hardening

**Status:** Draft v2
**Date:** 2026-04-24
**Related:** PRD-001 (Capabilities and adapters), PRD-002 (Immutable runtime bootstrap), ADR-007 (Runtime contract and container hardening), DDD-002 (Runtime contract domain)

### Changelog

| Version | Date | Summary |
|---|---|---|
| Draft v1 | 2026-04-24 | Initial draft — four contract problems, mechanism B for hardening exceptions |
| Draft v2 | 2026-04-24 | R3 runtime-contract-wiring audit integrated: §5.1 `AGENTBOX_IMAGE_REF` env-var contract specified; §5.2 probe endpoints (`/livez`, `/ready`, `/health`) and readiness state machine added; §5.3 observability broken-chain diagnosed (toml missing `[observability]`, `imageEnv` missing three vars, compose missing port 9091, `/v1/meta` missing field) and seven-step fix specified; acceptance criteria mapped to named test IDs `RC-003-06` through `RC-003-10` |

## TL;DR for newcomers
*Skip if you already know the operator-facing runtime contract.*

This PRD specifies what an operator must be able to trust about a running agentbox container. The pain point is four mismatches between what the docs promise and what the runtime delivers: compose hardcodes a local image tag while docs recommend GHCR, startup waits on `/health` as if it meant readiness, observability ports are half-wired across manifest and compose, and the container boundary is softer than a tool-running agent surface warrants. The shape of the answer is **one contract with four tied parts**: configurable image reference, distinct liveness/readiness/health probes, fully wired observability, and a hardened default with a documented exception mechanism. You will get the product goals, the wire format for each part, and the named acceptance tests.

**If you remember only one thing:** the operator-facing runtime surface is one contract; image, probes, metrics, and security posture must all be truthful together.

For the deep version, keep reading.

> **Scope.** This document specifies the product requirements for items `2/3/4/5`: image reference selection, truthful health/readiness, complete observability wiring, and a hardened default container boundary.

## 1. Problem summary

Agentbox has four operator-facing mismatches today:

1. generated compose hardcodes a local image tag, while docs also describe running the published GHCR image
2. startup waits on a health endpoint that does not represent real readiness
3. observability settings are documented as configurable, but metrics port wiring is incomplete across manifest, env, compose, and docs
4. the default container boundary is weaker than it should be for a tool-running agent container

These are not separate product problems. They are one runtime contract problem: the operator cannot rely on the system boundary being truthful.

## 2. Product goals

1. **One operator contract for image selection.** The same compose path must support both locally built and registry-pulled images.
2. **Truthful probes.** Liveness, readiness, and detailed health must mean different things and reflect actual runtime state.
3. **Single-source observability wiring.** `[observability]` must control the runtime behavior that docs and scripts describe.
4. **Hardened-by-default container boundary.** The baseline runtime should minimize privilege and writable surface area.

## 3. Non-goals

- Converting all internal supervised programs into separate containers.
- Removing GPU or desktop support.
- Designing a full orchestration platform beyond Docker Compose.

## 4. User stories

### 4.1 Operator

As an operator, I want the generated compose file to run either a local build or a published image without manual editing, so the documented workflows are consistent.

### 4.2 Automation

As CI or tooling, I want readiness to mean "the runtime can actually serve requests," not just "the process has bound a port."

### 4.3 Platform engineer

As a platform engineer, I want metrics and tracing configuration to flow from the manifest into the running system predictably, so scraping and alerting are reliable.

### 4.4 Security reviewer

As a security reviewer, I want the default container profile to run with minimal privileges and writable paths, so agentbox does not behave like a broad host-trust container.

## 5. Product requirements

### 5.1 Image reference selection

Generated compose must select the agentbox image from a configurable image reference, not a hardcoded local-only tag.

The operator contract must support:

- local development image loaded into Docker
- published GHCR image
- pinned immutable release or SHA tag

#### Mechanism: `AGENTBOX_IMAGE_REF` env-var contract

The single control point is the environment variable `AGENTBOX_IMAGE_REF`.

| `AGENTBOX_IMAGE_REF` value | Compose image line resolves to |
|---|---|
| empty (not set) | `agentbox:runtime-<system>` (local Nix build tag) |
| any non-empty string | the value verbatim |

The `flake.nix` `composeText` generator emits the following, using shell-expansion syntax so the generated file works for both paths without editing:

```yaml
image: ${AGENTBOX_IMAGE_REF:-agentbox:runtime-<system>}
```

`agentbox.sh` sub-commands:

- `agentbox.sh up --build` — runs `nix build .#runtime`, loads the result as `agentbox:runtime-<system>`, does not set `AGENTBOX_IMAGE_REF`. Compose uses the local tag automatically.
- `agentbox.sh up --registry` — does not build. Reads `AGENTBOX_IMAGE_REF` from the environment; errors with `"AGENTBOX_IMAGE_REF is not set — cannot use --registry"` if empty.
- `agentbox.sh up` (no flag) — behaves as `--build` if a `result` symlink is present in the project root (i.e. a build has been run); otherwise requires `AGENTBOX_IMAGE_REF` and behaves as `--registry`.

In all three cases `agentbox.sh up` prints `using image: <resolved-ref>` before calling `docker compose up`.

Multi-arch: when `AGENTBOX_IMAGE_REF` contains `:latest` or a digest, Docker resolves the architecture automatically from the registry manifest list. The `<system>` suffix is only present in local build tags.

### 5.2 Probe semantics

The runtime must expose three endpoints with distinct, non-overlapping semantics.

#### `GET /livez` — liveness

Returns `200 {"live": true}` as soon as the Node process has bound its port and the event loop is processing requests. Never returns 5xx unless the process is at the point of crashing. No auth. No dependency checks. Purpose: inform a container orchestrator whether to restart the process.

#### `GET /ready` — readiness

Returns `200 {"ready": true, "since": "<ISO-8601>", "requirements": [...]}` only when ALL of:

1. The `BootstrapCompleted` sentinel (`/run/agentbox/bootstrap.done`) exists and is readable — written by `entrypoint-unified.sh` at the end of stage B.
2. Every adapter whose manifest slot is not `"off"` has completed `connect()` without error.
3. Required writable mounts are present and writable: `/workspace`, `/projects`, `/var/lib/ruvector`.
4. If `[sovereign_mesh].enabled = true` and `publish_agent_events = true`: at least one Nostr relay in `NOSTR_RELAYS` is reachable (WebSocket connect within 3 s).

Returns `503 {"ready": false, "reason": "<short-string>", "missing": [<per-requirement detail>]}` while any condition is unmet. No auth.

#### `GET /health` — human aggregate

Returns per-adapter health, degraded counts, uptime, and build info. Semantics unchanged from current behavior. Explicitly not used for startup automation.

#### Readiness state machine

```
UNREADY  ---(BootstrapCompleted + adapters_ok + mounts_ok [+ relays_ok])--->  READY
READY    ---(adapter.connect() fails post-boot)------------------------------> UNREADY
READY    ---(required volume becomes non-writable)---------------------------> UNREADY
READY    ---(sovereign_mesh relay-reachability lost, publish_agent_events=true)-> UNREADY
```

Transitions from `READY` to `UNREADY` are logged at `warn` level with the failing requirement name. The `since` field records the timestamp of the most recent UNREADY → READY transition.

#### `agentbox.sh` changes

- Default `agentbox.sh up` polls `GET /ready` (not `/health`), timeout 120 s, printing `waiting for /ready at <url>...` before the loop.
- `agentbox.sh up --wait-live` polls `GET /livez` instead (fast smoke check; useful in CI when full readiness is not needed).
- The compose `healthcheck.test` line changes from `curl -f /health` to `curl -f /ready`.

### 5.3 Observability wiring

#### Audit findings

`agentbox.toml` today has no `[observability]` section. `flake.nix` binds `observCfg = agentboxConfig.observability or {}` at line 512 but reads nothing from it. `imageEnv` does not emit `AGENTBOX_METRICS_PORT`. The `composeText` `agentboxPorts` block does not include port 9091. `management-api/observability/metrics-server.js` correctly reads `process.env.AGENTBOX_METRICS_PORT || 9091` but the env var is never injected, so the server always binds 9091 as a hard default. `/v1/meta` has no `observability` field. `agentbox.sh up` echoes `http://localhost:9091/metrics` but port 9091 is not mapped in compose — the line is unreachable from the host.

Every link in the chain after the manifest is broken.

#### Required manifest section

```toml
[observability]
metrics_port   = 9091
otlp_endpoint  = ""     # empty disables OTLP export
log_level      = "info"
```

#### Required wiring: manifest → runtime

1. **`flake.nix` `imageEnv`** — add:
   ```
   "AGENTBOX_METRICS_PORT=<observCfg.metrics_port or 9091>"
   "AGENTBOX_OTLP_ENDPOINT=<observCfg.otlp_endpoint or "">"
   "AGENTBOX_LOG_LEVEL=<observCfg.log_level or "info">"
   ```

2. **`flake.nix` `composeText` `agentboxPorts`** — append unconditionally (metrics scraping is always enabled):
   ```yaml
   - "<metrics_port>:<metrics_port>"
   ```

3. **`flake.nix` `commonPorts`** — add `"<metrics_port>/tcp": {}` so it appears in the OCI image `ExposedPorts`.

4. **`management-api/observability/metrics-server.js`** — already reads `AGENTBOX_METRICS_PORT`; no code change. At startup it logs `[metrics] Prometheus endpoint: http://0.0.0.0:<port>/metrics`.

5. **`management-api/server.js` `/v1/meta` response** — add `observability` field:
   ```json
   {
     "observability": {
       "metrics_endpoint": "http://<AGENTBOX_METRICS_HOST or 0.0.0.0>:<AGENTBOX_METRICS_PORT>/metrics",
       "otlp_endpoint": "<AGENTBOX_OTLP_ENDPOINT or null>"
     }
   }
   ```

6. **`agentbox.sh health`** — after printing the `/health` summary, curl `/v1/meta`, extract `observability.metrics_endpoint`, then curl that URL and print the first five non-comment lines of the response to confirm the scrape target is live.

7. **`agentbox.sh up` startup summary** — replace the hardcoded `http://localhost:9091/metrics` string with `http://localhost:${AGENTBOX_METRICS_PORT:-9091}/metrics` so the printed URL matches what is actually exposed.

### 5.4 Hardened default container profile

The default container profile must use least privilege consistent with supported capabilities.

The baseline must include, where compatible:

- non-root runtime user
- dropped Linux capabilities
- read-only root filesystem
- explicit writable mounts and tmpfs locations
- bounded PID and resource settings or documented configurable equivalents

Capability-specific exceptions, such as GPU and desktop modes, must be explicit rather than silently expanding the baseline privilege set.

### 5.4a Feature-exception mechanism

#### Supervisord user model (updated in commit `2341480c`)

Supervisord runs as PID 1 root. Every long-running supervised service carries an explicit `user=devuser` directive so processes drop to uid 1000 before exec. The `user: "1000:1000"` compose field is absent. This allows the entrypoint to perform root-only boot operations (tmpfs dir creation, setuid wrapper provisioning, `chown -R 1000:1000` on runtime directories, TLS cert generation) before dropping privileges per service. The auto-generated `agentbox-secrets` named volume holds the management-api key at `/var/lib/agentbox/secrets` and is not mixed with the general workspace.

#### Baseline compose fields (applied to all non-exceptional services)

As of commit `2341480c`, the flake compose generator emits these fields on every service:

```yaml
# user: field is absent — supervisord PID 1 is root; per-program user=devuser
read_only: true
cap_drop:
  - ALL
tmpfs:
  - /tmp:mode=1777
  - /run:mode=755
security_opt:
  - no-new-privileges:true
  - seccomp=./config/seccomp-agentbox.json
```

`no-new-privileges:true` is the baseline. Exceptions that require a different value for a specific security_opt entry use the `security_opt_override` field (see below) to replace that entry only; unrelated entries are preserved. The Playwright exception sets `security_opt_override = ["no-new-privileges:false"]` so the Chromium sandbox can use user namespaces.

Named volumes and bind mounts that the service writes to (e.g. `/home/devuser/workspace`, `/var/lib/ruvector`) are explicitly declared; no other paths are writable.

#### Chosen mechanism: B — manifest-driven delta blocks (flake compose generator)

The flake compose generator already owns the single-source model. Features that need expanded privilege declare a `[security.exceptions.<feature>]` block in `agentbox.toml`. The generator reads each block when its parent feature flag is enabled and emits the delta fields into the affected service. No operator-level file juggling; the manifest remains the single source of truth.

Alternatives considered and rejected:

- **A (compose override files)**: requires the operator to assemble the correct `-f` chain; easy to omit a file silently; compose-file count grows with feature count; exception auditability depends on the operator's shell history.
- **C (Docker compose profiles)**: built-in Docker feature, zero new tooling, but per-profile security fields live inline in a single base compose that grows unboundedly; the profile list and the security fields are not co-located with the feature definition; adding a new feature requires editing the base compose, not just the manifest.

**B wins** because: the manifest is already the single source for every feature-gated service block; the generator already conditionally emits `rocmDevices` and `cudaRuntime` strings exactly this way; co-locating the exception declaration with its feature flag makes audit trivial; the operator never touches compose files.

#### Exception declaration syntax (`agentbox.toml`)

```toml
# Declared alongside the feature that requires it.
# The block is only read when the parent feature flag is enabled.

[security.exceptions.desktop]
# Parent gate: [desktop].enabled = true
reason   = "X11/VNC display server requires /tmp/.X11-unix and device access"
devices  = []                      # no raw device mounts for X11/openbox
tmpfs    = ["/tmp/.X11-unix:mode=1777,rw", "/run/user/1000:mode=755,rw"]
writable_volumes = []
cap_add  = []                      # no extra caps; openbox/xvfb run fine without

[security.exceptions.gpu-rocm]
# Parent gate: [gpu].backend ∈ {"ollama-rocm"}
# Applied to the ollama sidecar, not agentbox itself.
reason   = "ROCm requires raw device access to /dev/kfd and /dev/dri"
devices  = ["/dev/kfd:/dev/kfd", "/dev/dri:/dev/dri"]
group_add = ["video", "988"]
security_opt_override = ["seccomp=unconfined"]   # ROCm ioctls not in default profile
cap_add  = []

[security.exceptions.gpu-cuda]
# Parent gate: [gpu].backend ∈ {"ollama-cuda", "local-cuda"}
# Applied to agentbox service when local-cuda; to ollama sidecar for ollama-cuda.
reason   = "NVIDIA runtime requires CUDA device access via nvidia-container-toolkit"
runtime_override = "nvidia"
cap_add  = []                      # toolkit handles device access; no extra caps

[security.exceptions.playwright]
# Parent gate: [skills.browser].playwright = true
reason   = "Chromium user-namespace sandbox requires no-new-privileges:false"
security_opt_override = ["no-new-privileges:false"]
cap_add  = ["SYS_ADMIN"]    # Chromium sandbox — see ADR-007 SYS_ADMIN alternative

[security.exceptions.code-server]
# Parent gate: [toolchains].code_server = true
reason   = "code-server writes extension state to ~/.local/share/code-server"
writable_volumes = ["/workspace/.local/share/code-server"]
cap_add  = []

[security.exceptions.telegram-mirror]
# Parent gate: [sovereign_mesh].telegram_mirror = true
reason   = "CTM daemon writes config and session state to ~/.config/claude-telegram-mirror"
writable_volumes = ["/workspace/.config/claude-telegram-mirror"]
cap_add  = []
```

#### Merge rules

- Exception fields **union** with the baseline: `cap_add` is appended to the baseline `cap_drop: [ALL]` list; `tmpfs` entries extend the baseline list; `devices` is appended.
- `security_opt_override` **replaces** only the specific `security_opt` entries it names (match by prefix, e.g. `seccomp=`); unrelated entries such as `no-new-privileges:true` are preserved unless the override explicitly includes a replacement.
- `runtime_override` replaces the service-level `runtime:` field.
- When two features both declare `cap_add` or `devices`, the union of both sets is applied. There is no conflict to resolve because union is monotone.
- If two features declare conflicting `security_opt_override` values for the same key (e.g. one wants `seccomp=default` and another `seccomp=unconfined`), the generator takes the **most permissive** value and emits a validation warning (see E020 below).

#### Validation

`agentbox config validate` enforces:

- **E020** `hardening-exception-without-feature`: a `[security.exceptions.<name>]` block is present but the corresponding feature flag is not enabled. Emits an error (not a warning) because orphaned exception blocks silently pre-expand privilege if the feature is later enabled without re-validation.
- **W021** `exception-adds-privilege-beyond-baseline`: any enabled exception that carries non-empty `cap_add`, `devices`, or `security_opt_override = ["seccomp=unconfined"]` emits a warning summarising the privilege delta. This is informational; the operator must acknowledge it in CI by setting `security.audit_acknowledged = true` in the manifest.
- The validator cross-checks each exception block's parent gate at parse time; it does not wait for compose generation.

#### Audit trail — `SecurityProfileApplied` domain event

Every time the container boundary is realised (compose generation, runtime apply), a `SecurityProfileApplied` domain event is emitted per DDD-002 §Domain Events. The event payload must include:

```json
{
  "event": "SecurityProfileApplied",
  "baseline": {
    "user": "root (supervisord PID 1); per-program user=devuser",
    "read_only": true,
    "cap_drop": ["ALL"],
    "tmpfs": ["/tmp", "/run"],
    "security_opt": ["no-new-privileges:true", "seccomp=./config/seccomp-agentbox.json"]
  },
  "exceptions_applied": [
    {
      "feature": "desktop",
      "reason": "X11/VNC display server requires /tmp/.X11-unix and device access",
      "delta": { "tmpfs": ["/tmp/.X11-unix", "/run/user/1000"] }
    }
  ],
  "effective_profile": { /* merged result */ },
  "timestamp": "<ISO8601>"
}
```

The `feature` field is mandatory; no anonymous privilege expansion is permitted. The event is written to the structured audit log and is queryable via `agentbox security profile show`.

#### Default behaviour when exception block is absent

If a feature is enabled but no `[security.exceptions.<feature>]` block exists, the generator applies the hardened baseline without modification. If the feature requires a privilege that the baseline does not provide (e.g. `/dev/kfd` access for ROCm), it will fail at runtime. The operator must explicitly declare the exception block; silent privilege expansion is never permitted.

### 5.5 Runtime contract tests

The operator contract must be tested end to end:

- local image workflow
- published image workflow
- readiness probe behavior
- metrics port exposure
- hardening profile presence in generated compose

## 6. Acceptance criteria

1. Compose consumes an operator-settable image reference.
   **Test:** `RC-003-06` (image reference) — two-case test: run with `AGENTBOX_IMAGE_REF=agentbox:runtime-x86_64-linux` (local) and with `AGENTBOX_IMAGE_REF=ghcr.io/dreamlab-ai/agentbox:latest` (registry); both must reach `/ready` HTTP 200.

2. `agentbox.sh up` can run against either a locally loaded image or a pulled registry image.
   **Test:** covered by `RC-003-06` above; both image-reference paths exercise the `agentbox.sh up` verb end-to-end.

3. Readiness fails while bootstrap, required adapters, or required writable mounts are incomplete.
   **Test:** `RC-003-07` (livez vs ready) — with adapter `connect()` artificially delayed (sleep injected), assert `GET /livez` returns 200 and `GET /ready` returns 503 with a JSON `detail` field before resolution; both return 200 after resolution.

4. The configured metrics port is bound and reachable when documented as enabled.
   **Test:** `RC-003-08` (metrics port) — read `[observability].metrics_port` from manifest, assert it appears in compose `ports:`, assert it is bound inside container (`ss -tlnp`), assert `GET http://host:<port>/metrics` returns `text/plain` body containing `# HELP`.

5. The default compose output includes an explicit hardening profile rather than relying only on `no-new-privileges`.
   **Test:** `RC-003-09` (hardening baseline) — `docker inspect` the running container; assert `HostConfig.ReadonlyRootfs == true`, `HostConfig.CapDrop` contains `"ALL"`, `HostConfig.SecurityOpt` contains `"no-new-privileges:true"`, at least two `Mounts` of type `tmpfs` are present. Supervisord PID 1 runs as root; long-running supervised processes (`ps aux` inside container) must show `devuser` not `root` as the user.
   **Test:** `RC-003-10` (hardening exceptions) — with `[desktop].enabled = true`, assert compose adds `/tmp/.X11-unix` and `/run/user/1000` tmpfs entries while baseline `cap_drop: ["ALL"]` remains unchanged.

## 7. Success metrics

| Metric | Target |
|---|---|
| Docs workflow matches compose behavior | 100% alignment |
| False-positive readiness during partial boot | 0 |
| Metrics endpoint doc/runtime mismatch | 0 |
| Default container privilege surface | Reduced and explicit |

## 8. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Hardening may break optional desktop/GPU paths | Some features need exceptions | Express exceptions as explicit profiles or feature-conditioned deltas |
| More precise readiness can increase startup failures | Hidden regressions become visible | Accept and fix; false readiness is worse |
| Image reference indirection can confuse local workflows | Operators need defaults | Provide sane `.env` defaults and `agentbox.sh` helpers |

## 9. Rollout

1. Introduce configurable image reference in compose and lifecycle tooling.
2. Define and implement probe semantics.
3. Wire observability config end to end.
4. Add a hardened baseline compose profile with feature-specific exceptions.
5. Backfill tests and docs to match the contract.

