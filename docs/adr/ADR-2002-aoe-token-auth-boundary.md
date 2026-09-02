---
id: ADR-2002
title: AoE interaction plane requires token auth — loopback is not a boundary
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: d19073a82c319f7be01cf61d31521598dc044da5
verified_paths: [config/nip98-proxy/proxy.mjs, scripts/aoe-curl.sh, flake.nix]
owner: jjohare
review_trigger: next image rebuild (activation), or any new consumer of :9095, or per-process isolation becoming available
repo: agentbox
---

# ADR-2002 — AoE interaction plane requires token auth — loopback is not a boundary

## Context

`aoe serve` ran `--auth none --behind-proxy` on loopback `:9095`, with the
loopback bind treated as the N-05 security boundary. Any co-resident process
(code-server, spawned agents, supervised programs) could drive sessions
tokenless, and first-party consumers used exactly that route. The 2026-08-31
review sense-check rated this HIGH and live.

## Decision

The daemon runs `--auth token`. It mints its token into its own state file
(`~/.config/agent-of-empires/serve.url`, dir held 0700); consumers read it
(exactly 64 hex, first occurrence, read-then-stat torn-read retry) and inject
`Authorization: Bearer`. Enforcement is **fail-closed at the request layer,
independent of daemon mode**: the nip98-proxy 503s AoE routes (HTTP and WS
upgrade) without a token; gateway, tab0-bridge and the seed script refuse to
send. Generated agent instructions and Bash allowlists use the loopback-pinned,
positional-only `scripts/aoe-curl.sh` (`METHOD PATH [BODY]`, no URL or flag
passthrough) so the token cannot appear in prompts or be aimed off-box.

## Consequences

- Loopback reachability no longer grants session control; acquiring the token
  requires deliberate file access.
- **Accepted residual:** all consumers share uid 1000, so same-user peers can
  still read the token file — per-process isolation remains future work.
- Boot asserts 0700/ownership and logs a grep-able `[N-05-VIOLATION]` marker on
  violation (non-fatal by disposition).
- Activation is tied to the next image rebuild (nix-baked supervisord); until
  then the running box remains `--auth none` and the new consumer code is
  forward-safe against it.

## Verification

Live integration at `3ac89796f` against a real 1.13.2 token-auth daemon:
tokenless direct → 401; proxied without token file → local 503; proxied with
token → 200 (Bearer injected, HTTP and WS); `aoe-curl.sh` exfiltration attempts
(`https://…`, `@`, non-/api paths, PUT) rejected exit 2; 63/65-hex tokens
refused. Three codex adversarial rounds; residuals documented at
`readAoeToken()` in `config/nip98-proxy/proxy.mjs`.
