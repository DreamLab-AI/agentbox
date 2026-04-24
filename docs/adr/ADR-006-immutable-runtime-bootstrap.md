# ADR-006: Immutable runtime bootstrap

**Status:** Proposed
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

## Follow-ups

- Add artifact probes for each feature-gated supervisor program.
- Move readiness to depend on bootstrap completion and artifact validation.
- Document which runtime writes remain legal and why.

