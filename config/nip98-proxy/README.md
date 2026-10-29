# NIP-98 operator ingress

The interaction plane is `agentbox-sessions` (ADR-2153): a supervised tmux-backed
daemon reconciles `[[interaction_plane.session_seeds]]` through a unix socket
at `/run/agentbox-sessions/sessions.sock` (0660, `ab-sessions`, SO_PEERCRED ACL).
Sessions are `abs_<slug>` with `@agentbox-sessions=1`; `tab0` is the external
`agentbox:0` coordinator. Window 8 runs `agentbox-sessions pick`. Provider profiles
are reconciled by `scripts/session-provision.mjs`. AoE, its default upstream,
`:9095` and the web session board are retired. The NIP-98 proxy on `:9096` keeps
its named operator routes and returns 404 for unknown routes. The old
`aoe-profiles` volume remains mounted but unused for recovery and mount-stable
activation; it must not be pruned as part of delivery.

Routes come from interaction_plane.proxy.routes. Verification precedes routing.
Genuine NIP-98 Authorization passes through; named bearer_env exchange applies
only to cookie and break-glass callers. Unknown HTTP and WS routes return 404.
The /nip07 login and session-cookie surfaces remain available.

Run `NODE_PATH=management-api/node_modules node config/nip98-proxy/selftest.mjs`
for authentication, credential exchange, routing, cookie and WebSocket coverage.
