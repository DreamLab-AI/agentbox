# PRD-003: Runtime contract and container hardening

**Status:** Draft v1
**Date:** 2026-04-24
**Related:** PRD-001 (Capabilities and adapters), PRD-002 (Immutable runtime bootstrap), ADR-007 (Runtime contract and container hardening), DDD-002 (Runtime contract domain)

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

### 5.2 Probe semantics

The runtime must expose distinct probe meanings:

- **liveness**: main process is alive and event loop is responsive
- **readiness**: immutable bootstrap is complete, required services are started, and required adapters/volumes are usable
- **health detail**: aggregate status with degraded/failed component detail for humans and tooling

`agentbox.sh up` must wait on readiness, not mere liveness.

### 5.3 Observability wiring

`[observability].metrics_port`, `otlp_endpoint`, and `log_level` must be wired through:

- manifest validation
- runtime env vars
- compose port exposure
- management-api startup
- operator docs and helper scripts

If a direct metrics port is documented, it must actually be exposed and served.

### 5.4 Hardened default container profile

The default container profile must use least privilege consistent with supported capabilities.

The baseline must include, where compatible:

- non-root runtime user
- dropped Linux capabilities
- read-only root filesystem
- explicit writable mounts and tmpfs locations
- bounded PID and resource settings or documented configurable equivalents

Capability-specific exceptions, such as GPU and desktop modes, must be explicit rather than silently expanding the baseline privilege set.

### 5.5 Runtime contract tests

The operator contract must be tested end to end:

- local image workflow
- published image workflow
- readiness probe behavior
- metrics port exposure
- hardening profile presence in generated compose

## 6. Acceptance criteria

1. Compose consumes an operator-settable image reference.
2. `agentbox.sh up` can run against either a locally loaded image or a pulled registry image.
3. Readiness fails while bootstrap, required adapters, or required writable mounts are incomplete.
4. The configured metrics port is bound and reachable when documented as enabled.
5. The default compose output includes an explicit hardening profile rather than relying only on `no-new-privileges`.

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

