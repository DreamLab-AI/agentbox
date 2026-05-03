# ADR-007: Runtime contract and container hardening

**Status:** Accepted
**Date:** 2026-04-24
**Author:** Agentbox team
**Related:** PRD-003 (Runtime contract and container hardening), DDD-002 (Runtime contract domain)

## TL;DR for newcomers
*Skip if you already know the four-part runtime contract.*

This ADR explains what an operator is allowed to rely on when running an agentbox container: which image is selected, what "live" and "ready" each mean, where metrics and traces are exposed, and what security boundary is in force. The pain point is a split story across compose, docs, probes, and security posture — hardcoded image tags, `/health` abused as readiness, half-wired observability, and a container boundary softer than it should be for a tool-running agent. The shape of the answer is **four tied decisions**: a configurable `AGENTBOX_IMAGE_REF`, distinct `/livez` / `/ready` / `/health` probes, fully wired observability ports and env, and a hardened default profile with an explicit exception mechanism. You will learn each decision, its wire format, and its acceptance criteria.

**If you remember only one thing:** the runtime surface an operator touches — image, probes, metrics, security — is one contract, not four separate settings.

For the deep version, keep reading.

## Context

Agentbox currently has a split operator story:

- compose hardcodes a local image tag while docs also recommend pulling GHCR images
- the system waits on `/health`, but health is not a reliable readiness signal
- observability config is partially specified but not fully wired into ports and env
- the container boundary is only lightly hardened for a tool-running agent runtime

These are all violations of the same principle: the runtime surface exposed to operators must be explicit, consistent, and auditable.

## Decision

Agentbox adopts a formal runtime contract made of four decisions.

### 1. Image reference becomes configurable

Compose must consume an image reference variable rather than a local-only hardcoded tag. Local builds and registry images are both first-class inputs to the same runtime path.

#### Chosen mechanism: `AGENTBOX_IMAGE_REF` shell-expansion in generated compose

The `flake.nix` `composeText` generator replaces the hardcoded `image: agentbox:runtime-${system}` line (current line 639) with:

```yaml
image: ${AGENTBOX_IMAGE_REF:-agentbox:runtime-<system>}
```

This is valid Docker Compose variable-substitution syntax. It preserves the local-build default (empty variable → local tag) and allows the operator to override without editing the generated file.

`agentbox.sh` encodes the two workflows:

- `up --build`: sets no `AGENTBOX_IMAGE_REF`; the shell-default provides the local tag.
- `up --registry`: requires `AGENTBOX_IMAGE_REF` in the environment; fails with a clear error if absent.

`agentbox.sh up` prints `using image: <resolved-ref>` in both cases before calling `docker compose up`.

No alternative mechanism (e.g. a separate `.env.image` file, a separate override compose file, or an `agentbox.toml` key that re-bakes the compose) was chosen because shell-variable substitution is native to Docker Compose, requires zero extra tooling, and makes the resolved value visible to `docker compose config`.

### 2. Probes become semantically distinct

- `/health` is retained as the human-facing aggregate endpoint (per-adapter status, degraded counts, uptime). It is not used for startup automation.
- `/ready` gates startup automation and requires ALL of: (a) `BootstrapCompleted` sentinel present, (b) required adapters connected, (c) required writable mounts accessible, (d) if sovereign_mesh.publish_agent_events=true, at least one Nostr relay reachable.
- `/livez` is added as the minimal liveness probe: process alive, event loop responsive. No dependency checks. Used by orchestrators and `agentbox.sh up --wait-live`.

#### Current state that is being fixed

`management-api/routes/status.js` `GET /ready` currently returns `{ready: true, ...}` unconditionally — it checks only `processManager.getActiveTasks()` and ignores bootstrap state, adapter health, and mounts. This means the existing `/ready` endpoint is semantically equivalent to `/livez` and provides no safety guarantee.

#### Readiness state machine

```
UNREADY ---(sentinel + adapters + mounts [+ relays])--> READY
READY   ---(adapter.connect() fails post-boot)-------> UNREADY
READY   ---(required mount non-writable)-------------> UNREADY
READY   ---(relay lost, publish_agent_events=true)---> UNREADY
```

The `since` timestamp records UNREADY → READY. READY → UNREADY transitions are logged at warn.

#### `agentbox.sh` and compose changes

- `agentbox.sh up` polls `/ready` (120 s timeout), not `/health`.
- `agentbox.sh up --wait-live` polls `/livez` (60 s timeout).
- Compose `healthcheck.test` changes from `curl -f /health` to `curl -f /ready`.

### 3. Observability is single-source

The manifest owns metrics port, OTLP endpoint, and log level. Runtime env, management-api behavior, compose exposure, and docs must all derive from that same contract.

#### Broken links identified by audit

| Link | Current state | Required state |
|---|---|---|
| `agentbox.toml [observability]` section | Does not exist | Must be added with `metrics_port`, `otlp_endpoint`, `log_level` |
| `flake.nix` `observCfg` usage | Bound at line 512, never read | Must emit `AGENTBOX_METRICS_PORT`, `AGENTBOX_OTLP_ENDPOINT`, `AGENTBOX_LOG_LEVEL` into `imageEnv` |
| `composeText` `agentboxPorts` | Omits metrics port | Must append `"<metrics_port>:<metrics_port>"` |
| `commonPorts` in OCI image config | Omits metrics port | Must add `"<metrics_port>/tcp": {}` |
| `/v1/meta` response | No `observability` field | Must add `observability: { metrics_endpoint, otlp_endpoint }` |
| `agentbox.sh up` summary line | Hardcodes `9091` | Must read `${AGENTBOX_METRICS_PORT:-9091}` |
| `agentbox.sh health` | Checks `/health` only | Must also verify the metrics endpoint is live |

`management-api/observability/metrics-server.js` already reads `AGENTBOX_METRICS_PORT || 9091` correctly; it requires no code change, only the env var injection above.

#### Invariant

If `[observability].metrics_port` is set in the manifest, the generated compose must expose that port, the image must bind it, and `/v1/meta` must report the endpoint. Any mismatch is a `ContractDriftDetected` event (see DDD-002).

### 4. Container boundary is hardened by default

The baseline runtime moves to least privilege:

- dedicated runtime user
- explicit writable paths
- read-only root filesystem where possible
- dropped capabilities and bounded runtime settings

Feature modes that need more access must declare exceptions explicitly.

### 4a. Feature-exception mechanism — manifest-driven delta blocks (Mechanism B)

#### Decision

The flake compose generator is the single point of compose materialisation. Feature-exception blocks are co-located with their feature flags in `agentbox.toml` under `[security.exceptions.<feature>]`. The generator conditionally emits each exception's delta fields into the affected service when the parent feature flag is enabled. This follows the same conditional-string pattern already used for `rocmDevices`, `cudaRuntime`, and `ollamaServiceBlock`.

Three mechanisms were considered:

| Criterion | A: compose override files | B: manifest delta blocks (chosen) | C: Docker compose profiles |
|---|---|---|---|
| Operator UX | Operator assembles `-f` chain | Single manifest edit; `nix build .#compose` | `--profile` flags at `docker compose up` |
| Manifest truthfulness | No — security state distributed across N files | Yes — single file is authoritative | Partial — profile names in compose, bodies inline |
| Compose file count | 1 base + 1 per feature | Always 1 (generated) | Always 1 (but grows) |
| Exception auditability | Poor — operator shell history | Strong — `SecurityProfileApplied` event cites feature | Moderate — profiles visible in compose |
| New-feature cost | New override file + docs | New TOML block + generator condition | New profile block inline in base compose |
| Docker compatibility | Standard | Standard (generated output is plain compose) | Standard but adds CLI coupling |

B is the only mechanism that keeps the manifest as the single source of truth, matches the existing generator pattern, and makes every privilege delta attributable to a named feature in a machine-readable audit event.

#### Supervisord user model

Supervisord runs as PID 1 root. Every long-running `[program:*]` block carries `user=devuser` so those processes drop to uid 1000 before exec. Root is required at boot for:

- creating tmpfs subdirectories with the correct mode and uid/gid
- provisioning the setuid sudo wrapper (`chown 0:0` + `chmod 4755`)
- generating TLS certificates and writing them to `/var/lib/agentbox/secrets`
- `chown -R 1000:1000` on runtime directories before service start

One-shot bootstrap programs (`[program:bootstrap]`, certificate generation) run as root. The `[program:tailscaled]` daemon also runs as root because it needs to create network interfaces. All other long-running services carry explicit `user=devuser`.

The `user: "1000:1000"` compose field is absent from the generated service block. `no-new-privileges:true` remains the baseline security option. The `security_opt_override` mechanism (see below) allows per-exception relaxation of individual security_opt entries without lifting the baseline across the board.

This model was implemented in commit `2341480c`. Prior to that commit, `user: "1000:1000"` was set at the compose level, which silently broke the setuid sudo wrapper provisioning (EPERM on `chown 0:0`) and made `chown -R 1000:1000` calls in the entrypoint no-ops.

#### Baseline compose fields emitted for non-exceptional services

As of commit `2341480c`, the generated baseline is:

```yaml
# user: field is absent — supervisord runs as root, per-program user=devuser
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

Note: `no-new-privileges:true` is the baseline. The Playwright exception uses `security_opt_override` (see below) to flip this to `false` for the Chromium sandbox only — it does not affect the global baseline.

#### W021 audit gate

The flake compose generator fails closed when any active exception widens the attack surface (non-empty `cap_add`, raw `devices`, or `seccomp=unconfined`) and `[security].audit_acknowledged` is not set to `true` in `agentbox.toml`. This gate was implemented in commit `2341480c`.

To acknowledge after reviewing the residual surface, add to `agentbox.toml`:

```toml
[security]
audit_acknowledged = true
```

The `agentbox.sh preflight` command runs `nix build .#compose --no-link` ahead of `up` and reports W021 gate failures before the container starts.

#### Exception block structure in `agentbox.toml`

```toml
[security.exceptions.<feature-name>]
reason                = "<human-readable justification>"
devices               = ["<host>:<container>", ...]   # raw device mounts
tmpfs                 = ["<path>:<options>", ...]     # additional tmpfs mounts
writable_volumes      = ["<path>", ...]               # paths made writable
cap_add               = ["<CAP_NAME>", ...]           # capabilities added back
group_add             = ["<group>", ...]              # supplementary GIDs
security_opt_override = ["<key>=<value>", ...]        # replaces matching security_opt entries
runtime_override      = "<runtime>"                   # replaces service runtime: field
```

#### Merge rules

Union for `cap_add`, `devices`, `tmpfs`, `group_add`, `writable_volumes`. Replace-by-key for `security_opt_override` (e.g. `seccomp=` key replaces baseline `seccomp=./config/seccomp-agentbox.json`). `no-new-privileges:true` is preserved unless explicitly overridden by a `security_opt_override` entry that includes `no-new-privileges:false`. When two features conflict on the same `security_opt_override` key, the generator takes the most permissive value and emits a W021 warning.

The Playwright exception sets `security_opt_override = ["no-new-privileges:false"]` because the Chromium user-namespace sandbox requires it. All other baseline security_opt entries are preserved. The `no-new-privileges:true` entry is replaced by `no-new-privileges:false` only for the merged service block — no other change.

#### Validator rules

- **E020** `hardening-exception-without-feature` — exception block present, parent feature not enabled. Error.
- **W021** `exception-adds-privilege-beyond-baseline` — exception carries `cap_add`, raw `devices`, or `seccomp=unconfined`. Warning; suppressed per-manifest by `security.audit_acknowledged = true`.

#### Audit trail

`SecurityProfileApplied` domain event (DDD-002) is emitted at compose generation and runtime apply. Payload includes baseline, exceptions_applied (each citing `feature` and `reason`), and effective merged profile. No anonymous privilege expansion is permitted.

## Consequences

### Positive

- Operator workflows become consistent across local and registry consumption.
- Startup automation becomes safer because readiness is truthful.
- Metrics and tracing become deployable without doc drift.
- Security posture improves without requiring users to invent their own container policy.

### Negative

- More runtime states become visible as failures instead of being masked.
- Hardening can surface compatibility issues in optional feature paths.
- Compose generation becomes more opinionated and slightly more complex.

## Alternatives considered

### Keep local build and registry workflows separate

Rejected because it creates parallel operator contracts and guarantees documentation drift.

### Continue using `/health` as a convenience readiness check

Rejected because liveness and readiness answer different operational questions.

### Leave hardening to downstream operators

Rejected because agentbox is marketed as a standalone product; baseline boundary policy is part of the product, not optional garnish.

### Expose metrics only through `:9090/metrics`

Rejected as the sole approach because the product already documents a dedicated metrics port and validates it in config. The contract should either support that path fully or remove it entirely; partial support is not acceptable.

## SYS_ADMIN alternative for Chromium-based skills

`[security.exceptions.playwright]` adds `SYS_ADMIN` so Chromium's user-namespace sandbox can initialise. Alternatives with different trade-offs:

1. **Daemon-level user-namespace remap** (`/etc/docker/daemon.json`: `"userns-remap": "default"`). Chromium's unprivileged sandbox works without `SYS_ADMIN` inside the container. Trade-off: all containers on the host share the remapped UID range, which can conflict with volume ownership from non-remapped setups. Best fit: dedicated agentbox hosts.
2. **`--no-sandbox` on Chromium launch**. Removes the sandbox entirely; explicitly not recommended.
3. **Status quo — `SYS_ADMIN` exception**. Default for shared hosts. `cap_drop: [ALL]` baseline still applies, so only the one cap is present in the running container.

## Follow-ups

- Add compose-generation tests for image reference and hardening fields.
- Add readiness tests that fail when bootstrap or required adapters are incomplete.
- Decide whether health detail lives on `/health` or a separate aggregate endpoint, but preserve readiness as its own contract.
- Implement `[security].chromium_sandbox_mode = "sys-admin" | "userns-remap" | "no-sandbox"` knob (currently only `sys-admin` path exists via the Playwright exception `security_opt_override`). The `userns-remap` mode is the recommended choice for dedicated agentbox hosts: add `"userns-remap": "default"` to `/etc/docker/daemon.json` on the host, then set the mode to `userns-remap` in the manifest; the Playwright exception's `no-new-privileges:false` and `SYS_ADMIN` cap are no longer needed in that mode. The validator should confirm the daemon config when `userns-remap` is selected.

