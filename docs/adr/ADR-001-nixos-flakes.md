# ADR-001: Nix Flake Build Architecture

**Status:** Accepted, Updated for Agentbox 2.0  
**Date:** 2024-12-01  
**Updated:** 2026-04-23  
**Author:** Agentbox Team

## Context

Agentbox needs:

- reproducible multi-architecture builds
- modular feature gating
- generated runtime configuration instead of static monoliths
- a clean path from repo state to container image state

The original Nix work replaced a monolithic Dockerfile. Agentbox 2.0 extends that by making the manifest part of the build contract.

## Decision

Use a Nix flake plus `nix2container`, with `agentbox.toml` as the build-time feature manifest.

The current build flow is:

1. `flake.nix` reads `agentbox.toml`
2. package groups are selected from manifest flags
3. supervisor config text is generated inside the flake
4. repo runtime assets are copied into `/opt/agentbox`
5. runtime, full, and desktop images are built from the same source graph

## Why This Still Stands

This remains the right approach because it gives:

- reproducible image composition
- clear feature gating
- low drift between dev shell and image
- explicit ownership of optional runtime dependencies
- an upgrade path away from giant static images

## Agentbox 2.0 Specific Consequences

### Positive

- the build can exclude unused skills and toolchains
- runtime service generation is tied to the same manifest as package inclusion
- images can carry the repo’s scripts, skills, config, and docs under `/opt/agentbox`
- the sovereign runtime path can be encoded directly in image defaults

### Negative

- more of the runtime contract now lives in `flake.nix`
- runtime-installed npm CLIs still create some non-Nix drift
- old docs and legacy configs can easily become misleading if not maintained

## Current Scope

This ADR now covers:

- manifest-driven package selection
- generated supervisor config
- image variants
- shipping repo assets into the image

It no longer assumes:

- fixed package groups
- static service config
- Linux pseudo-user provisioning as the main isolation mechanism

## Related Files

- [`flake.nix`](../../flake.nix)
- [`agentbox.toml`](../../agentbox.toml)
- [`config/entrypoint-unified.sh`](../../config/entrypoint-unified.sh)
- [`docs/guides/quick-start.md`](../guides/quick-start.md)
