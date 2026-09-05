---
id: ADR-2002
title: AoE interaction plane requires token auth — loopback is not a boundary
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
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
- Activation requires a running-image receipt, separate from the source
  command. The earlier staged record described a pre-rebuild `--auth none`
  deployment; that historical observation is not a current runtime claim.

## Verification

Live integration at `3ac89796f` against a real 1.13.2 token-auth daemon:
tokenless direct → 401; proxied without token file → local 503; proxied with
token → 200 (Bearer injected, HTTP and WS); `aoe-curl.sh` exfiltration attempts
(`https://…`, `@`, non-/api paths, PUT) rejected exit 2; 63/65-hex tokens
refused. Three codex adversarial rounds; residuals documented at
`readAoeToken()` in `config/nip98-proxy/proxy.mjs`.

## Closeout extension — 2026-09-04

**Work package:** CP-04 / CP-06. **Owner:** existing owner above. **Dependencies:** CP-01
revision/feature identity and the downstream consumer contract.

**Current source verification:** Current `flake.nix` generates `aoe serve --auth token --behind-proxy` on loopback. `readAoeToken` rejects malformed token files but retains a last-good token on read failure; deleting the file is therefore not a revocation mechanism. `aoe-curl.sh` remains positional and loopback-pinned. The proxy test uses a fake upstream: it proves token injection, not the real daemon's enforcement.

At `89301ec7c911eab270c00a0cf81596d0d4f15535`, the local proxy suite passes 45 assertions with no skips using
`NODE_PATH=management-api/node_modules node config/nip98-proxy/selftest.mjs`.
The initial default-resolution run skipped three signature cases; both runs
are preserved in the [estate receipts](../../../../VisionFlow/docs/estate-review/evidence/ingress-selftest-runtime-deps.json).
These are local fake-upstream checks, not deployed acceptance or, for the
identity helper, a key-persistence test. Prior verification at `d19073a82c319f7be01cf61d31521598dc044da5` remains
part of this record's history; the refreshed commit covers the scoped source
claims above. Existing activation labels are not newly verified by this run.

**Acceptance still required:** Capture running binary/config identity and test direct tokenless denial, rotation/revocation, HTTP/WS proxying and all direct consumers. Preserve the same-UID residual until process isolation is implemented or explicitly bounded.

## Acceptance progress — 2026-09-05

**Implemented.** The proxy suite now covers the AoE token boundary itself rather
than only token injection against a fake upstream.

- *Tokenless denial.* A request carrying no NIP-98 header, no bearer and no
  session cookie is denied with the documented 401 on the HTTP path, on the WS
  upgrade, and on a named route — and in each case the AoE daemon token is **not
  injected downstream** and does not leak into the denial body. That is the
  direct test the closeout asked for.
- *Break-glass and session modes* are exercised alongside it, so the cases that
  DO receive the route bearer are distinguished from the cases that must not.
- The identity-header stripping and fail-closed-verifier work recorded under
  ADR-2009 applies to this boundary too: a client cannot assert an identity the
  AoE upstream would trust.

**Tests and results.** `NODE_PATH=management-api/node_modules node config/nip98-proxy/selftest.mjs`
— **120 assertions, 0 failures, 0 skips**. The suite grew from 45 assertions with
the cases listed above; the pre-existing cases are unchanged.

**Receipts.** `docs/estate-closeout/2026-09-05/adr-2009-nip98-selftest.json`.

**Remaining.** Still local fake-upstream checks. Running binary/config identity
was not captured; rotation and revocation against the real AoE daemon were not
exercised (`readAoeToken` retaining a last-good token on read failure is
unchanged, so deleting the file is still not a revocation mechanism); HTTP/WS
proxying to the live daemon and each direct consumer are untested. The same-UID
residual stands until process isolation is implemented or explicitly bounded.

**Governed paths changed.** `config/nip98-proxy/selftest.mjs`,
`config/nip98-proxy/proxy.mjs`, `config/nip98-proxy/README.md`.
