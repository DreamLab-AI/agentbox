# ADR-002: RuVector As Embedded Search Layer

**Status:** Accepted (reframed 2026-04-23)  
**Date:** 2025-01-15  
**Updated:** 2026-04-23  
**Author:** Agentbox Team

## TL;DR for newcomers
*Skip if you already know why embedded vector search is not a durable store.*

This ADR explains the role of RuVector inside agentbox. It is the embedded local vector index — fast retrieval against container-local state, startup-time indexing, cheap semantic search — and it is explicitly **not** the canonical durable source of truth for sovereign memory. The pain point it addresses is the earlier assumption that a single embedded database could serve both transient retrieval and long-lived memory; that conflation leaks ephemeral container state into the user's durable memory surface. The shape of the answer is **RuVector as per-session cache**, with durable memory routed through the ADR-005 `memory` adapter slot (pod storage or external pgvector). You will learn where RuVector fits, what it owns, and what it deliberately does not own.

**If you remember only one thing:** RuVector is the embedded retrieval cache, not the durable memory backend.

For the deep version, keep reading.

## Context

Agentbox originally moved away from PostgreSQL + pgvector toward embedded RuVector for a lighter local vector/search layer.

Agentbox keeps RuVector, but the storage story has changed:

- durable state is intended to live in Solid-style pod storage
- RuVector is now the embedded local retrieval/index layer
- legacy PostgreSQL-based memory assumptions are no longer canonical

## Decision

Keep RuVector as the local embedded retrieval engine.

Use it for:

- local vector search
- startup-time indexing support
- fast retrieval against container-local state

Do not treat it as the canonical durable source of truth for sovereign memory.

## Consequences

### Positive

- no mandatory external database
- fast local search
- fits the modular container target
- aligns with the sovereign runtime goal of decoupling durable storage from heavyweight local DBs

### Negative

- some older docs and config files still describe PostgreSQL-era assumptions
- durable semantic memory and pod storage integration is still in progress

## Current Architectural Meaning

In the current architecture:

- Solid-style pod storage is the durable memory direction
- RuVector is the embedded search/index direction

That split is the intended design.

## Related Files

- [`scripts/solid-pod-server.py`](../../scripts/solid-pod-server.py)
- [`config/entrypoint-unified.sh`](../../config/entrypoint-unified.sh)
- [`agentbox.toml`](../../agentbox.toml)
