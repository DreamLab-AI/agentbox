# ADR-021: LLM Resource Marketplace — Nostr Kind Schema

**Status:** Accepted
**Date:** 2026-05-22
**Deciders:** John O'Hare
**Related:** PRD-009 (LLM Resource Marketplace), DDD-006 (Marketplace domain), ADR-013 (Canonical URI grammar), ADR-005 (Pluggable adapters)

## Context

Agentbox instances federated via the Nostr relay mesh have no protocol for sharing LLM compute resources. Each node operates an isolated set of providers. The existing governance kinds (31400-31405) handle human-in-the-loop oversight; the existing custom kinds (38000-38201) handle agent visualization. Neither covers resource negotiation.

## Decision

Allocate six Nostr event kinds in the 38300-38305 range for an LLM Resource Marketplace protocol. All events follow NIP-01 structure and are signed with the emitter's BIP-340 keypair (did:nostr identity).

### Kind 38300 — LLM Capability Advertisement (Parameterised Replaceable)

```json
{
  "kind": 38300,
  "pubkey": "<provider-hex-pubkey>",
  "tags": [["d", "<model-identifier>"]],
  "content": "{\"model\":\"claude-opus-4-6\",\"context_window\":200000,\"max_tokens_per_request\":32000,\"rate_limit\":{\"rpm\":60,\"tpd\":1000000},\"cost_per_m_token\":15,\"capabilities\":[\"code\",\"vision\",\"tool-use\"],\"endpoint\":\"https://agentbox.tailnet.ts.net:8080/v1/llm/proxy\"}"
}
```

Replaceable by `pubkey + d-tag` (NIP-33 semantics): a provider updating capacity for a model replaces the previous advertisement.

### Kind 38301 — LLM Capability Request

```json
{
  "kind": 38301,
  "pubkey": "<consumer-hex-pubkey>",
  "tags": [],
  "content": "{\"min_context_window\":100000,\"min_capabilities\":[\"code\"],\"max_cost_per_m_token\":20,\"token_budget\":500000,\"purpose\":\"code-review-swarm\"}"
}
```

### Kind 38302 — LLM Grant

```json
{
  "kind": 38302,
  "pubkey": "<provider-hex-pubkey>",
  "tags": [["e", "<request-event-id>", "", "reply"], ["p", "<consumer-hex-pubkey>"]],
  "content": "{\"model\":\"claude-opus-4-6\",\"token_allocation\":500000,\"expires_at\":1748044800,\"access_token\":\"tok_...\",\"endpoint\":\"https://...\"}"
}
```

The `e` tag references the request; the `p` tag identifies the grantee. The access_token is encrypted with NIP-04 in transit (recommended but not enforced in Phase 1).

### Kind 38303 — LLM Deny

```json
{
  "kind": 38303,
  "pubkey": "<provider-hex-pubkey>",
  "tags": [["e", "<request-event-id>", "", "reply"], ["p", "<consumer-hex-pubkey>"]],
  "content": "{\"reason\":\"rate-limit-exhausted\"}"
}
```

### Kind 38304 — LLM Usage Receipt

```json
{
  "kind": 38304,
  "pubkey": "<provider-hex-pubkey>",
  "tags": [["e", "<grant-event-id>", "", "reply"], ["p", "<consumer-hex-pubkey>"]],
  "content": "{\"model\":\"claude-opus-4-6\",\"tokens_used\":15000,\"cost_sats\":225,\"duration_ms\":4200}"
}
```

Receipts are content-addressed via `urn:agentbox:receipt:<pubkey>:<sha256-12>` and integrate with the Web Ledger payment module.

### Kind 38305 — LLM Grant Revocation

```json
{
  "kind": 38305,
  "pubkey": "<provider-hex-pubkey>",
  "tags": [["e", "<grant-event-id>", "", "reply"], ["p", "<consumer-hex-pubkey>"]],
  "content": "{\"reason\":\"abuse-detected\"}"
}
```

### Federation policy

| Kind | Federated | Rationale |
|------|-----------|-----------|
| 38300 | Yes | Ads must propagate for discovery |
| 38301 | Yes | Requests visible to all potential providers |
| 38302 | Yes | Grants may transit relay hops |
| 38303 | No | Point-to-point denial |
| 38304 | Yes | Receipts are audit trail |
| 38305 | No | Point-to-point revocation |

## Consequences

### Positive
- Zero new infrastructure — rides the existing relay mesh
- Standard Nostr tooling (clients, relays, backup) works unchanged
- did:nostr signatures provide non-repudiation on all marketplace events
- Web Ledger integration closes the billing loop
- Heterogeneous model fleets become mesh-addressable

### Negative
- In-memory orderbook is volatile; relay persistence provides durability
- No built-in SLA enforcement (Phase 2)
- Access tokens in kind-38302 should be NIP-04 encrypted but Phase 1 sends plaintext (transport-layer encryption via Tailscale/TLS mitigates)

### Neutral
- Kind range 38300-38305 is private to the DreamLab ecosystem; upstream NIP registration is deferred until the protocol stabilizes

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Extend governance kinds 31400-31405 | Semantic mismatch — governance is human oversight, not resource negotiation |
| Use HTTP-only marketplace API | Doesn't propagate across the relay mesh; requires separate discovery |
| Allocate kinds in 1000-9999 (regular events) | Advertisements need replaceable semantics (NIP-33, 30000-39999 range) |
| Use NIP-15 marketplace events | NIP-15 is for physical goods; LLM resource negotiation needs different content schema |
