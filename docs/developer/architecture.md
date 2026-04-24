# Architecture overview

For contributors. If you're an operator, start at [user/quickstart.md](../user/quickstart.md).

## One-sentence summary

Agentbox is a manifest-driven Nix-built Linux container that hosts software agents, their skills, and their toolchains, with every durable-state integration (memory, task receipts, pod storage, event sinks, agent orchestration) pluggable behind a five-slot adapter pattern.

## The three claims

Every design decision traces back to one of these:

1. **The manifest is the contract.** `agentbox.toml` drives the Nix flake, the generated `docker-compose.yml`, the generated supervisord config, the env vars inside the container, and what the validator will enforce. There is no Dockerfile. There are no ad-hoc build scripts outside the flake. Changing what runs is a diff in `agentbox.toml`.

2. **Adapters are the integration surface.** Durable state is pluggable. Agentbox never hardcodes "the database" or "the task store". Five slots (beads, pods, memory, events, orchestrator) × three implementation classes each (`local-*`, `external`, `off`) = fifteen derivations, one interface per slot. The contract test harness runs the same assertions against all three classes.

3. **Boot is immutable.** The image realises the manifest; it does not construct itself at startup. No `npm install`, no `curl | bash`, no `playwright install`. If a feature is enabled in the manifest, its binaries and dependencies are in the image — artifact probes fail fast on missing closures.

## The layer cake

```mermaid
flowchart TB
    subgraph manifest_layer["manifest"]
        M[agentbox.toml]
        V[agentbox config validate<br/>20 semantic rules]
        V --> M
    end

    subgraph build_layer["build"]
        M --> F[flake.nix]
        F --> N1[npm services<br/>lib/npm-services.nix]
        F --> N2[npm CLIs<br/>lib/npm-cli.nix]
        F --> N3[GPU dispatch<br/>lib/gpu-backend.nix]
        F --> N4[3DGS stack<br/>lib/3dgs-stack.nix]
        F --> N5[Codex binary<br/>lib/codex-binary.nix]
        F --> G[supervisorText generator]
        F --> C[composeText generator]
        F --> I[content-addressed image]
        G --> I
        C --> DC[docker-compose.yml]
    end

    subgraph runtime_layer["runtime"]
        I --> EP[entrypoint-unified.sh]
        EP --> VA[validate-artifacts.sh]
        VA --> SUP[supervisord]
        SUP --> BS[bootstrap-seal]
        SUP --> API[management-api]
        SUP --> MCP[MCP servers]
        SUP --> DSK[desktop optional]
        BS --> SENT[/run/agentbox/<br/>bootstrap.done]
    end

    subgraph probes["probes"]
        API --> LIV[/livez/]
        API --> RDY[/ready<br/>checks sentinel + adapters + mounts/]
        API --> HLT[/health/]
        API --> MET[:9091/metrics<br/>Prometheus]
        API --> META[/v1/meta/]
    end

    subgraph adapter_dispatch["adapter dispatch"]
        API --> AD{resolve by slot}
        MCP --> AD
        AD --> BEADS[beads<br/>sqlite/http/off]
        AD --> PODS[pods<br/>jss/http/off]
        AD --> MEM[memory<br/>ruvector/pg/off]
        AD --> EVT[events<br/>jsonl/http/off]
        AD --> ORC[orchestrator<br/>procmgr/stdio/off]
    end
```

## Important files

| File | Role |
|---|---|
| [`agentbox.toml`](../../agentbox.toml) | Manifest — the single source of truth |
| [`flake.nix`](../../flake.nix) | Build graph — packages, supervisor, compose |
| [`flake.lock`](../../flake.lock) | Pinned inputs |
| [`schema/agentbox.toml.schema.json`](../../schema/agentbox.toml.schema.json) | JSON Schema for the manifest |
| [`scripts/agentbox-config-validate.js`](../../scripts/agentbox-config-validate.js) | Semantic rule engine (E001–E020 + W021) |
| [`lib/npm-services.nix`](../../lib/npm-services.nix) | 6 local service derivations |
| [`lib/npm-cli.nix`](../../lib/npm-cli.nix) | 9 global CLI derivations |
| [`lib/gpu-backend.nix`](../../lib/gpu-backend.nix) | GPU dispatch (none / rocm / cuda) |
| [`lib/codex-binary.nix`](../../lib/codex-binary.nix) | OpenAI Codex Rust CLI |
| [`lib/3dgs-stack.nix`](../../lib/3dgs-stack.nix) | COLMAP + METIS + LichtFeld |
| [`config/entrypoint-unified.sh`](../../config/entrypoint-unified.sh) | Container bootstrap (Stage A + Stage B) |
| [`config/validate-artifacts.sh`](../../config/validate-artifacts.sh) | Pre-supervisord artifact gate |
| [`config/seal-bootstrap.sh`](../../config/seal-bootstrap.sh) | `[program:bootstrap-seal]` — writes sentinel |
| [`management-api/server.js`](../../management-api/server.js) | HTTP API, adapter resolver boot, probes |
| [`management-api/adapters/`](../../management-api/adapters/) | 5 slots × 3 impls + base + errors + resolver |
| [`management-api/observability/`](../../management-api/observability/) | metrics + tracing + pino logger |

## The bootstrap flow

```
Stage A — one-shot, exec-chained, ends with supervisord

  Phase 0: stage-dispatch (AGENTBOX_BOOTSTRAP_STAGE="B" → jump to Stage B)
  Phase 0.5: /opt/agentbox writable? emit ImmutableRootWritable, strict-mode fails
  Phase 1: mkdir -p writable roots (/workspace, /var/lib/*, /tmp/screenshots)
  Phase 2: auto-generate MANAGEMENT_API_KEY if unset/sentinel
  Phase 3: python3 sovereign-bootstrap.py (Nostr identity)
  Phase 4: workspace defaults (zellij, .config, README)
  Phase 5: provision-agent-stacks.py; validate-artifacts.sh; exec supervisord

Stage B — supervisord [program:bootstrap] (same script, AGENTBOX_BOOTSTRAP_STAGE=B)

  Phase 6: _probe_closure for each service's node_modules (no installs)
  Phase 7: (deleted — npm install -g calls removed)
  Phase 8: write /etc/profile.d/agentbox-runtime.sh env hints

Late: [program:bootstrap-seal] priority=99
  polls every required program until RUNNING, then touches
  /run/agentbox/bootstrap.done atomically.
```

Bootstrap events emitted as pino JSON, tagged `agentbox.stage: bootstrap`:
- `BootstrapStarted`, `ImmutableRootWritable`, `CapabilityValidated`, `MissingArtifactDetected`, `RuntimeClosureValidated`, `BootstrapFailed`, `BootstrapSealStarted`, `BootstrapCompleted`, `BootstrapSealTimeout`.

Full spec: [PRD-002](../reference/prd/PRD-002-immutable-runtime-bootstrap.md) + [ADR-006](../reference/adr/ADR-006-immutable-runtime-bootstrap.md) + [DDD-001](../reference/ddd/DDD-001-immutable-bootstrap-domain.md).

## Adapter dispatch

See [adapters.md](adapters.md). Summary: `management-api/adapters/index.js` at startup reads `agentbox.toml`'s `[adapters]` section, resolves each slot to a concrete class from `<slot>/<impl>.js`, calls `connect()` on each with a 10 s timeout. On connect failure:
- Non-critical slots degrade to `off` (and `/health` reports `degraded`)
- `orchestrator` failure is fatal (`process.exit(1)`) — no agent work is possible without it

## Probe semantics

- **`/livez`** — process alive, event loop responsive. Zero external checks. <100 ms response.
- **`/ready`** — bootstrap sentinel present + every non-`off` adapter `healthy` + required filesystem mounts accessible + (when `[sovereign_mesh].publish_agent_events=true`) at least one Nostr relay reachable. Returns 503 with `{ready, reason, missing[]}` when any requirement unmet.
- **`/health`** — aggregate snapshot for humans. Not used by Docker healthcheck or by `agentbox.sh up` (they use `/ready`).

Full spec: [PRD-003 §5.2](../reference/prd/PRD-003-runtime-contract-and-container-hardening.md) + [DDD-002](../reference/ddd/DDD-002-runtime-contract-domain.md).

## Hardened baseline + feature exceptions

Generated compose emits:

```yaml
user: "1000:1000"
read_only: true
cap_drop: [ALL]
tmpfs:
  - /tmp:mode=1777,size=256M
  - /run:mode=755,size=64M
  - /var/run:mode=755,size=16M
  - /var/log:mode=755,size=128M
  - /var/log/supervisor:mode=755,size=64M
security_opt:
  - no-new-privileges:true
  - seccomp=default
```

Feature-specific privilege expansions live in `[security.exceptions.<feature>]` manifest blocks. Activation is gated on the corresponding feature flag (validator rule E020). Baseline drops are never removed by exceptions — they can only add devices, tmpfs paths, caps, or runtime hints.

Seven current exception keys: `desktop`, `gpu-rocm`, `gpu-cuda`, `gaussian-splatting`, `playwright`, `code-server`, `telegram-mirror`.

Full spec: [ADR-007 §4a](../reference/adr/ADR-007-runtime-contract-and-container-hardening.md).

## Observability chain

```
agentbox.toml [observability]
  → flake.nix imageEnv (AGENTBOX_METRICS_PORT, AGENTBOX_OTLP_ENDPOINT, AGENTBOX_LOG_LEVEL)
    → docker-compose.yml ports + environment
      → OCI ExposedPorts
        → management-api metrics-server.js (reads env, binds Fastify on port)
          → /v1/meta reports observability.metrics_endpoint
            → agentbox.sh health discovers and scrapes
```

Every link is verified by `RC-003-08.sh`. Breaking any link = this chain breaks.

## Where conventions live

- **Architectural invariants** — ADRs (accepted). If an ADR says "never write to `/opt/agentbox`", that's load-bearing.
- **Product requirements** — PRDs. Acceptance criteria map to `tests/runtime-contract/RC-*.sh`.
- **Domain models** — DDDs. Aggregates, invariants, events. Code should reify these where practical.
- **Operational guidance** — `docs/developer/*.md` (this file, `adapters.md`, `testing.md`, `version-tracking.md`, `sovereign-mesh.md`, `skills-upgrade.md`).
- **Internal prompting & agent conventions** — [`CLAUDE.md`](../../CLAUDE.md).

## When changes require which artifacts

| Change | ADR? | PRD? | DDD? | Test? |
|---|---|---|---|---|
| New adapter impl for an existing slot | No | No | No | Contract suite + behavioural tests |
| New adapter slot | Yes (extend ADR-005) | Maybe | Likely | Contract suite for all 3 impl classes |
| Hardening exception mechanism change | Yes (ADR-007) | Maybe | Yes (DDD-002) | Validator tests + RC-003-09 / -10 |
| New validator rule | No (reference ADR-005 or -007) | No | No | Semantic-rules test |
| New manifest section | Update ADR-001 + DDD-001 | Depends on scope | Maybe | Schema + validator + TUI test |
| Probe semantics change | Yes (ADR-007) | Yes (PRD-003) | Yes (DDD-002) | RC-003-07 + integration |
| Stage B logic change | ADR-006 if it affects immutable boundary | PRD-002 if acceptance criteria shift | DDD-001 if aggregate/invariant | Bootstrap + RC-002 suite |

## Further reading

- [Adapter pattern](adapters.md) — writing new impls
- [Sovereign mesh](sovereign-mesh.md) — Nostr client internals
- [Testing](testing.md) — suite layout, running, CI wiring
- [Version tracking](version-tracking.md) — Renovate + Nix flake update
- [ADR index](../reference/adr/) — every design decision
- [PRD index](../reference/prd/) — every product requirement
- [DDD index](../reference/ddd/) — every bounded context
