# PRD-009: LLM Resource Marketplace

**Status:** Draft v1
**Date:** 2026-05-22
**Repo:** [github.com/DreamLab-AI/agentbox](https://github.com/DreamLab-AI/agentbox)
**Related:** ADR-021 (Nostr kind schema), DDD-006 (Marketplace domain model), PRD-001 (Capabilities and adapters), ADR-005 (Pluggable adapters), ADR-015 (MCP RuVector mandate)

## TL;DR

Agentbox instances on the relay mesh currently have no way to share LLM compute. If one node has Opus credits and another has a local Llama instance, there is no protocol for advertising, discovering, negotiating, or billing cross-node inference. The LLM Resource Marketplace adds six Nostr event kinds (38300-38305) that enable did:nostr users, agents, and nodes to negotiate access to LLM resources across the mesh, with usage receipts that integrate with the Web Ledger payment rails in solid-pod-rs.

---

## 1. Problem

### 1.1 Isolated LLM compute

Each agentbox runs its own LLM providers (Claude, GPT, local models). There is no mechanism to:
- Discover what models other nodes in the mesh offer
- Request temporary access to a model on another node
- Track token usage across cross-node inference
- Bill for shared compute using the existing Web Ledger

### 1.2 Heterogeneous capability

Different nodes have different capabilities: one may have GPU-accelerated local inference, another may have Opus API credits, a third may run specialized fine-tuned models. Without a discovery layer, swarm orchestration cannot route tasks to the optimal model.

### 1.3 Cost optimization

Multi-agent swarms burn tokens. A marketplace enables routing low-complexity tasks to cheaper models on other nodes while reserving expensive models for tasks that require them.

---

## 2. Solution

Six Nostr event kinds in the parameterised replaceable range (30000-39999):

| Kind | Name | Type | Purpose |
|------|------|------|---------|
| 38300 | Advertisement | Replaceable (d-tag = model) | Provider publishes available model capacity |
| 38301 | Request | Regular | Consumer requests access matching requirements |
| 38302 | Grant | Regular | Provider grants access with token budget and TTL |
| 38303 | Deny | Regular | Provider denies a request with reason |
| 38304 | Receipt | Regular | Usage receipt for billing/audit |
| 38305 | Revocation | Regular | Provider cancels an active grant |

### 2.1 Negotiation flow

```
Provider                          Consumer
   │                                 │
   │ ── kind 38300 (Advertisement) → │ (via relay mesh)
   │                                 │
   │ ← kind 38301 (Request) ──────  │
   │                                 │
   │ ── kind 38302 (Grant) ────────→ │ (includes access_token, endpoint, TTL)
   │                                 │
   │        ... inference calls ...  │
   │                                 │
   │ ← kind 38304 (Receipt) ──────  │ (tokens_used, cost_sats, duration_ms)
   │                                 │
   │ ── kind 38305 (Revocation) ──→  │ (optional — abuse, expiry, policy)
```

### 2.2 Trust model

- **Identity**: All events are signed with did:nostr Schnorr signatures (BIP-340 secp256k1)
- **Authorization**: Grants are scoped to a specific consumer pubkey, model, token budget, and TTL
- **Transport**: Events propagate over the relay mesh (Stratum 2). Tailscale peers see advertisements without public relay exposure
- **Payment**: Receipts integrate with the Web Ledger — DREAM tokens or satoshis per the operator's pricing_mode

### 2.3 Integration points

- **Management API**: `/v1/llm/*` routes for CRUD operations
- **Relay mesh**: Kinds 38300, 38301, 38302, 38304 federated; 38303, 38305 point-to-point
- **Web Ledger**: Receipts (38304) anchor to `urn:agentbox:receipt` URNs and solid-pod-rs payment module
- **Swarm orchestration**: Claude-flow task orchestrator can query `/v1/llm/discover` to route tasks to optimal models
- **agentbox.toml**: `[llm_marketplace]` section gates the feature; `auto_advertise = true` publishes on boot

---

## 3. Requirements

### 3.1 Must have (Phase 1)
- [ ] Kind 38300-38305 event builders with validation
- [ ] In-memory orderbook with d-tag replacement semantics
- [ ] Management API routes with Fastify JSON Schema validation
- [ ] agentbox.toml `[llm_marketplace]` manifest section
- [ ] 50+ unit tests with >90% coverage of the core library

### 3.2 Should have (Phase 2)
- [ ] Relay-mesh propagation of marketplace events (subscribe to peer ads)
- [ ] Auto-advertise on startup from `[providers.*]` configuration
- [ ] Web Ledger integration — receipts trigger balance debit
- [ ] Swarm task router integration — `/discover` informs model selection

### 3.3 Could have (Phase 3)
- [ ] Reputation scoring based on receipt history
- [ ] SLA enforcement — latency monitoring, automatic revocation on breach
- [ ] Multi-hop forwarding — node A requests from node B which proxies to node C
- [ ] Auction mode — multiple providers bid on a request

### 3.4 Won't have
- Centralized marketplace server — all state is on the relay mesh
- Non-Nostr discovery protocols — the relay mesh is the only transport
- Unscoped grants — every grant has a pubkey, model, token budget, and TTL

---

## 4. Rejection list

| Rejected approach | Reason |
|---|---|
| OpenAI-style API key sharing | No identity attribution, no revocation, no billing integration |
| REST-only marketplace (no Nostr) | Doesn't propagate across the relay mesh; requires separate discovery infrastructure |
| Global token pool | Violates sovereign data principle — each node controls its own resources |
| Centralized broker | Single point of failure; contradicts mesh architecture |

---

## 5. Success metrics

| Metric | Target |
|---|---|
| Cross-node inference latency | <2× single-node latency |
| Grant issuance time | <500ms end-to-end |
| Receipt accuracy | 100% of inference calls produce receipts |
| Test coverage | >90% line coverage on core library |

---

## 6. Phase 1 implementation status

Phase 1 is complete:
- `management-api/lib/llm-marketplace.js` — core library (event builders, validators, matching engine, orderbook)
- `management-api/routes/llm-marketplace.js` — 10 HTTP routes
- `tests/sovereign/llm-marketplace.test.js` — 50 unit tests, all passing
- `agentbox.toml` — kinds added to allowed_kinds and federated_kinds; [llm_marketplace] section added
- `server.js` — route registered
