# ADR-007: Runtime contract and container hardening

**Status:** Proposed
**Date:** 2026-04-24
**Author:** Agentbox team
**Related:** PRD-003 (Runtime contract and container hardening), DDD-002 (Runtime contract domain)

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

### 2. Probes become semantically distinct

- `/health` is liveness or detailed aggregate health, but not a substitute for readiness.
- `/ready` gates startup automation and requires bootstrap completion plus required dependency availability.
- helper scripts must wait on readiness.

### 3. Observability is single-source

The manifest owns metrics port, OTLP endpoint, and log level. Runtime env, management-api behavior, compose exposure, and docs must all derive from that same contract.

### 4. Container boundary is hardened by default

The baseline runtime moves to least privilege:

- dedicated runtime user
- explicit writable paths
- read-only root filesystem where possible
- dropped capabilities and bounded runtime settings

Feature modes that need more access must declare exceptions explicitly.

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

## Follow-ups

- Add compose-generation tests for image reference and hardening fields.
- Add readiness tests that fail when bootstrap or required adapters are incomplete.
- Decide whether health detail lives on `/health` or a separate aggregate endpoint, but preserve readiness as its own contract.

