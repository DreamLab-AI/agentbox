# DDD-006: LLM Resource Marketplace Domain

**Date**: 2026-05-22
**Status**: Draft
**Bounded Context**: LLM Resource Marketplace
**Cross-references**: PRD-009 (LLM Resource Marketplace), ADR-021 (Nostr kind schema), DDD-003 (Sovereign messaging), ADR-013 (Canonical URI grammar)

## Domain Overview

The LLM Resource Marketplace is a bounded context within the agentbox ecosystem that enables decentralized negotiation of LLM compute resources between did:nostr identities over the Nostr relay mesh. It bridges the identity domain (DDD-003) with the payment domain (Web Ledger in solid-pod-rs).

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Provider** | A did:nostr identity that advertises LLM model capacity for consumption by other mesh participants |
| **Consumer** | A did:nostr identity that requests and uses LLM resources from providers |
| **Advertisement** | A replaceable Nostr event (kind 38300) declaring a provider's available model, capacity, pricing, and endpoint |
| **Request** | A Nostr event (kind 38301) from a consumer specifying minimum requirements for LLM access |
| **Grant** | A Nostr event (kind 38302) from a provider authorizing a consumer to use a specific model within a token budget and TTL |
| **Denial** | A Nostr event (kind 38303) from a provider rejecting a request with a stated reason |
| **Receipt** | A Nostr event (kind 38304) recording token usage, cost, and duration for a single inference session against a grant |
| **Revocation** | A Nostr event (kind 38305) from a provider cancelling an active grant |
| **Orderbook** | The in-memory aggregate that tracks active advertisements and grants for matching and accounting |
| **d-tag** | NIP-33 discriminator tag — for advertisements, this is the model identifier, enabling replaceable semantics per provider per model |
| **Token budget** | The maximum number of LLM tokens a grant authorizes the consumer to use |
| **Token allocation** | Synonym for token budget in the grant context |

## Aggregate Roots

### Advertisement Aggregate

```
Advertisement
  ├── pubkey (provider did:nostr identity)
  ├── model (d-tag, natural key for replacement)
  ├── context_window
  ├── max_tokens_per_request
  ├── rate_limit { rpm, tpd }
  ├── cost_per_m_token
  ├── capabilities []
  ├── endpoint
  └── updated_at
```

**Invariants:**
- I01: One advertisement per (pubkey, model) pair — newer replaces older (NIP-33)
- I02: context_window > 0
- I03: endpoint must be a non-empty string
- I04: capabilities must be an array

### Grant Aggregate

```
Grant
  ├── grant_id (synthetic key)
  ├── provider_pubkey
  ├── consumer_pubkey
  ├── model
  ├── token_allocation
  ├── tokens_used
  ├── expires_at
  └── receipts []
```

**Invariants:**
- I05: tokens_used ≤ token_allocation — usage exceeding the budget is rejected
- I06: expires_at > now() — expired grants are pruned and not queryable
- I07: only the provider_pubkey can revoke a grant
- I08: receipts are append-only — once recorded, a receipt cannot be modified

## Domain Events

| Event | Kind | Emitter | Trigger |
|-------|------|---------|---------|
| CapabilityAdvertised | 38300 | Provider | Model availability changes |
| AccessRequested | 38301 | Consumer | Consumer needs LLM resources |
| AccessGranted | 38302 | Provider | Provider approves a request |
| AccessDenied | 38303 | Provider | Provider rejects a request |
| UsageRecorded | 38304 | Provider | Inference session completes |
| GrantRevoked | 38305 | Provider | Policy violation or expiry |

## Bounded Context Map

```
┌─────────────────────────────────────────────┐
│         LLM Resource Marketplace            │
│         (management-api/lib/llm-*)          │
│                                             │
│  Orderbook ─── Advertisement Aggregate      │
│     │          Grant Aggregate              │
│     │                                       │
│     ├── Match Engine                        │
│     ├── Usage Tracker                       │
│     └── Event Builders (38300-38305)        │
└────────┬──────────────────┬─────────────────┘
         │                  │
    ┌────▼────┐      ┌──────▼──────┐
    │ Identity │      │  Payment    │
    │ (DDD-003)│      │ (Web Ledger)│
    │          │      │             │
    │ did:nostr│      │ DREAM/sats  │
    │ NIP-98   │      │ receipts    │
    └──────────┘      └─────────────┘
         │                  │
    ┌────▼──────────────────▼──────┐
    │      Relay Mesh (NIP-01)     │
    │  Federation transport for    │
    │  kinds 38300-38305           │
    └──────────────────────────────┘
```

## Anti-Corruption Layer

The marketplace domain translates between:
- **Nostr wire format** (kind, tags, content JSON string) ↔ **domain objects** (Advertisement, Grant, Receipt)
- **URN grammar** (`urn:agentbox:receipt:<pubkey>:<sha256-12>`) ↔ **grant IDs** (synthetic `grant-<timestamp>-<random>`)
- **Web Ledger** (satoshi amounts, DREAM tokens) ↔ **marketplace pricing** (cost_per_m_token, token_budget)

The `buildX()` functions in `llm-marketplace.js` are the AC layer outbound (domain → Nostr). The `validateX()` functions are the AC layer inbound (Nostr → domain).

## Repository

The Orderbook is the repository abstraction:
- `addAdvertisement()` / `removeAdvertisements()` / `getAdvertisements()` — advertisement CRUD
- `addGrant()` / `revokeGrant()` / `getActiveGrants()` — grant lifecycle
- `recordUsage()` — receipt recording with budget enforcement
- `findMatches()` — query engine for request-advertisement matching
- `pruneExpired()` — garbage collection of expired grants
- `stats()` — aggregate metrics

Phase 1 uses an in-memory Map; Phase 2 persists to the relay mesh (kind events *are* the persistence layer).

## Files

| File | Responsibility |
|------|---------------|
| `management-api/lib/llm-marketplace.js` | Domain model, event builders, validators, matching engine, Orderbook |
| `management-api/routes/llm-marketplace.js` | Application service (HTTP routes, Fastify schema validation) |
| `tests/sovereign/llm-marketplace.test.js` | 50 unit tests covering all domain invariants |
| `agentbox.toml` `[llm_marketplace]` | Feature gate and configuration |
