# ADR-004: Upstream Sync Boundaries

**Status:** Accepted (updated 2026-04-23)  
**Date:** 2026-02-03  
**Updated:** 2026-04-23  
**Author:** Agentbox Team

## Context

Agentbox inherited ideas, assets, and some structure from older upstream containers and adjacent agent environments.

That remains useful, but Agentbox now has a different architecture:

- manifest-driven Nix build
- sovereign runtime bootstrap
- profile-based isolation
- shared mounts plus shared skills tree
- Zellij workspaces

Blind upstream syncing is no longer safe.

## Decision

Sync upstream selectively, not mechanically.

Only port upstream changes that fit the current agentbox architecture.

## What May Be Synced

- skills that fit the current progressive-disclosure tree
- shell aliases and workflows that still match the runtime model
- useful scripts that do not reintroduce deprecated architecture
- toolchain guidance that maps to current manifest-gated features

## What Must Not Be Reintroduced

- Linux pseudo-user isolation as the primary runtime model
- static monolithic service configs
- PostgreSQL-first memory assumptions
- old tmux-first terminal assumptions
- local bridge/TCP/WS-centric orchestration as the main coordination path

## Current Sync Targets

- [`skills/`](../../skills/)
- [`config/agentbox-aliases.sh`](../../config/agentbox-aliases.sh)
- [`aisp/`](../../aisp/)

## Sync Rule

Before porting an upstream feature, ask:

1. does it belong behind an `agentbox.toml` flag?
2. does it fit the sovereign/profile runtime?
3. does it require new runtime bootstrap wiring?
4. does it contradict the shared-mount profile model?

If the answer to 2 or 4 is problematic, do not port it directly.

## Notes

This ADR replaces the older “version-matched alias sync” mindset with an architecture-aware one.
