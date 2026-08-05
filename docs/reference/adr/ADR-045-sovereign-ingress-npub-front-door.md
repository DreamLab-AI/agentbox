---
id: ADR-045
title: "Sovereign ingress: one npub-gated front door for external control surfaces"
status: proposed
date: 2026-08-05
type: architecture
author: Dr John O'Hare
depends_on: [ADR-042, ADR-043, ADR-044]
related: [PRD-021, ADR-013, ADR-017, ADR-039]
review_trigger: >-
  NIP-07 browser signing lands in the AoE dashboard or the operator cockpit
  (retire the break-glass bearer and re-verify the WS token path); the DreamLab
  forum ships its nostr user gate (wire the SSO link-through and re-verify the
  shared-npub assumption); a third upstream is added to the ingress routing
  table (re-verify the prefix-match and header-injection semantics per
  upstream); or the exposure posture changes (new published port, tailscale/
  overlay adoption, or a surface moves between loopback and LAN classes).
"@context": https://schema.org
"@type": TechArticle
---

# ADR-045 — Sovereign Ingress: One npub-Gated Front Door for External Control Surfaces

**Status:** Proposed
**Date:** 2026-08-05
**Repo:** DreamLab-AI/agentbox

## Context

PRD-021 landed the interaction plane behind a NIP-98-verifying reverse proxy
(`config/nip98-proxy/`, ADR-043 D4.6): `aoe serve` binds loopback `:9095` with
`--auth none`, and the proxy on `:9096` is its sole ingress. Operationally,
however, the box is **headless**: the operator reaches it from LAN devices
(laptop, tablet, phone), not from a seat at the console. The audit of external
control surfaces (2026-08-05) found:

- `:9096` was reachable only on the docker network — **no compose file
  published it**, so the sanctioned identity-gated ingress dead-ended one hop
  short of the operator.
- The operator cockpit (`:8444`, ADR-044) is the only LAN-published control
  surface (`0.0.0.0`, self-signed TLS), and already fronts `/aoe/*` through
  `:9096` — the identity gate works, but only via the cockpit origin.
- Every other web surface (management-api `:9090`, code-server `:8080`, solid
  pod `:8484`, VNC `:5901`) is host-loopback behind the SSH-tunnel playbook
  (`docs/user/quickstart.md`), which presumes an operator who tunnels — a
  posture designed for the pre-cockpit era.
- The VNC family is, per operator decision, an **agent action surface** (GUI
  tools for agents), not an operator control path.

Separately, the operator floated merging the voice/agent control surfaces into
the DreamLab forum system behind its nostr user gate, then correctly flagged
that nostr-only comms are a poor fit for live control.

## Decision

### D1 — The nip98-proxy generalises to a multi-upstream sovereign ingress

`config/nip98-proxy/proxy.mjs` gains a **routing table**: an ordered list of
`{prefix, target, strip}` rules consulted per request (HTTP and WS upgrade),
falling through to the existing AoE default upstream. Configuration is by env
(`NIP98_PROXY_ROUTES`, JSON), supplied by the flake-generated supervisor block;
absent the env, behaviour is byte-identical to the single-upstream proxy.

Initial table:

| Prefix | Upstream | Notes |
|---|---|---|
| `/mgmt/` | `http://127.0.0.1:9090` (management-api) | prefix stripped; mgmt-api keeps its own auth — the proxy **adds** the verified `X-Agentbox-Pubkey`, defence in depth, it does not replace the surface's checks |
| *(default)* | `http://127.0.0.1:9095` (aoe serve) | unchanged sole-ingress contract (ADR-043 I03) |

Every routed request carries the same verified-identity headers
(`X-Agentbox-Pubkey`, `X-Agentbox-Auth-Mode`); the Authorization header is
stripped before forwarding exactly as today. The sole-ingress invariant is
**per-upstream**: it continues to hold for `:9095` (loopback bind + this proxy
only); management-api retains its independent loopback publication for local
tooling — the ingress is an *additional* authenticated path, not a migration.

### D2 — Exposure policy: two LAN doors, everything else stays loopback + SSH

| Class | Surfaces | Posture |
|---|---|---|
| **LAN, identity-gated** | `:9096` (sovereign ingress), `:8444` (operator cockpit) | published `0.0.0.0`; NIP-98 / one-credential origin |
| **Loopback + SSH tunnel** | `:9090`, `:8080`, `:8484`, `:8888`, `:5901`, `:9700`, `:9091` | unchanged; the tunnel playbook remains the break-glass/diagnostic path |
| **Agent-facing** | `:5903/:5904/:5905` (browser/XR/GUI-tools VNC) | not operator control surfaces; posture owned by their compose files |

`docker-compose.yml` publishes `9096:9096`. The cockpit remains the primary
human origin; direct `:9096` additionally serves the remote `aoe` CLI/TUI
(`AOE_DAEMON_URL` + bearer) and any NIP-98-signing client.

### D3 — Forum federation at the identity and async seams only

The DreamLab forum system and agentbox **share identity, not chrome**:

- **Shared gate.** The forum's nostr user gate and this ingress verify the same
  npubs. Forum login yields a link-through to the cockpit; when NIP-07 browser
  signing lands, one extension key signs for both surfaces and the break-glass
  bearer retires (review trigger).
- **Forum gets the async artefacts.** Session digests (kind-30840, already
  emitted via `[sovereign_mesh.mobile_bridge]`), approval notifications, and
  run summaries are event-shaped and relay-friendly — they belong on the forum
  and feeds.
- **Live control stays on same-origin HTTP/WS.** Nostr relays are
  store-and-forward: seconds-scale latency, event-size caps, no backpressure —
  structurally wrong for PTY streams, voice frames, and diff views. The
  existing split already demonstrates the pattern: `/nostr/send` (tab0-bridge)
  carries *intent* from anywhere; AoE's serialised `POST /send` carries
  *control* locally.
- **Rejected:** absorbing the cockpit into the forum chrome. ADR-044 built the
  one-origin/one-credential merge of voice + session board; re-hosting it
  inside the forum re-litigates that for no capability gain. Rejected likewise:
  nostr-only transport for any live surface (the operator's own caveat,
  concurred).

## Alternatives considered

- **Publish each surface's port directly and rely on per-surface auth.** Four
  different auth stories (some none) exposed to the LAN; contradicts the
  sole-ingress lesson of ADR-043. Rejected.
- **SSH-tunnel-only status quo.** Sound for a workstation operator, hostile to
  the actual headless/tablet/phone posture; already bypassed in practice by
  the cockpit's `0.0.0.0` publication. Rejected as policy, retained as
  break-glass.
- **Move control into the forum over nostr.** See D3 — transport mismatch.
- **A second reverse proxy (Caddy) as the ingress.** The cockpit's Caddyfile
  already reverse-proxies, but it terminates TLS and serves a site; the
  identity verification lives in proxy.mjs and must stay on the trust boundary
  in front of `:9095`. Extending the existing verified proxy is the smaller,
  single-trust-boundary change.

## Consequences

- One npub identity is the operator's credential for every gated external
  path; surface-local auth remains as defence in depth.
- The routing table is a new (small) attack surface on the trust boundary —
  route additions are ADR-worthy events (review trigger).
- Until NIP-07 signing lands, browsers still need the break-glass bearer for
  direct `:9096` use; the cockpit origin masks this for the common case.
- The forum integration is deliberately loose: nothing in this repo names or
  depends on the forum implementation (host-by-role rule); only the npub gate
  and event kinds are shared contract.

## Related decisions

- [ADR-042](ADR-042-agent-of-empires-interaction-plane.md) — the interaction plane this ingress fronts
- [ADR-043](ADR-043-session-identity-binding.md) — NIP-98 verification contract and sole-ingress invariant
- [ADR-044](ADR-044-voice-plane-aoe-repoint.md) — the operator cockpit origin
- [PRD-021](../prd/PRD-021-interaction-surface-consolidation.md) — the sprint; amended by this ADR's Appendix-B delta
