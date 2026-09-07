# LAN and container-network doors — 2026-09-07

The supported closeout profile retains relay exposure/mobile/multi-user/payment
surfaces disabled. A loopback host publish restricts host/LAN reachability; it
does not isolate listeners on the Docker bridge from sibling containers or
processes sharing UID 1000. Source identity and active endpoint observations are
separate evidence.

| Door | Admission and trust boundary | Residual / supported posture |
|---|---|---|
| AoE via NIP-98 proxy :9096 | Proxy verifies request identity; loopback AoE :9095 independently requires bearer token | Same-UID readers are not isolated from owner-only files; no per-agent confinement claim |
| Desktop VNC | Loopback host publish; wayvnc/x11vnc explicitly sanctioned as unauthenticated container listeners | Docker siblings remain trusted for this profile; no LAN publication added |
| Browser CDP / browser automation sidecar | Separate compose publications, enumerated in check-ports-loopback SANCTIONED | CDP can drive authenticated browser state; the sanctioned publication is not an authentication mechanism |
| Voice and GUI tools | Separate sanctioned voice/UI/MCP publications | Endpoint-specific credentials/transport must be reviewed; AoE NIP-98 does not protect these ports |
| Nostr relay | Allowlist admission and local bridge; expose=false | Rail/LAN opening deferred until distinct publisher custody and bilateral admission receipts |
| Loom façade :8084 | Named outbound grounding service; caller trusts the selected service | Generation response is service identity, not cryptographic remote attestation; mismatched content/model refused by staged client |
| Loom raw model :8085 | Named agent-choice/benchmark egress | No automatic fallback for knowledge work; purpose restriction remains policy, not runtime isolation |

`check-ports-loopback.mjs::SANCTIONED` is the publish inventory and
`LISTENER_SANCTIONED` the internal-listener exception inventory. Passing these
checks proves conformity to those lists, not confidentiality against a hostile
sibling. Separate network namespaces/credentials or authenticated VNC/CDP are
required before selecting a hostile-sibling profile. Existing exceptions are
recorded rather than silently widened. No credentials were copied into this
document and no new listener was enabled.
