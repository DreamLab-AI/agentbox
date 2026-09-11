---
id: ADR-2009
title: The nip98-proxy is the fail-closed AoE identity boundary
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 8fcc7b79b7c93c0744ca68b7a09fa14fdae8f5e3
verified_paths: [config/nip98-proxy/proxy.mjs, flake.nix, docs/INGRESS-identity.md]
owner: jjohare
review_trigger: A second identity ingress is proposed, or aoe serve stops binding loopback
repo: agentbox
domain: INGRESS-identity
lineage: legacy ADR-042 (AoE interaction plane), ADR-043 (session identity binding), ADR-045 (sovereign npub front door)
---

# ADR-2009 — The nip98-proxy is the fail-closed AoE identity boundary

## Context
Requests must become a verified BIP-340 pubkey before any routing decision.
The AoE interaction plane (`aoe serve`) has its own shared-secret token but no
identity. Loopback binding alone stopped being a trust boundary (N-05): the
daemon now requires the token regardless. Identity must live in exactly one
place, and a client must not be able to assert its own identity by header.
Legacy ADR-042/043/045 defined the plane, session binding and front door; this
consolidates them into one boundary. Governing doc: `docs/INGRESS-identity.md`.

## Decision
Exactly one NIP-98-verifying door — the `:9096` nip98-proxy — turns a request
into a verified x-only pubkey. `aoe serve` runs `--behind-proxy --host 127.0.0.1
--port 9095`, so bypassing the proxy bypasses identity. Every upstream request is
authenticated before routing; the proxy-owned NIP-07 handshake is separate; any inbound `X-Agentbox-Pubkey`
(and `-Auth-Mode`) is unconditionally stripped and re-injected from the verified
identity on both HTTP and WebSocket paths. If the Schnorr verifier cannot load,
every NIP-98 token is rejected (401; only an explicit break-glass bearer may
pass). A malformed route, allowlist or upstream config crashes the proxy at boot
rather than silently dropping a rule. This forbids an additional ungoverned AoE identity
ingress and client-asserted pubkeys; other estate services retain their own
authentication boundaries.

## Consequences
Identity is structurally single-sourced and auditable. Cost: the proxy is a hard
dependency — if it is down, its upstream routes are unreachable, and a verifier load failure is
a total outage by design. Boot-fatal config validation means a typo in routes or
allowlist takes the door offline rather than degrading quietly. The AoE daemon
token becomes defence-in-depth beneath identity, not the boundary itself.

## Verification
Re-checked at `cbe7335b9`: `flake.nix:1977` (`aoe serve --auth token
--behind-proxy --allowed-host 127.0.0.1 --host 127.0.0.1 --port 9095`) and
`:1970` ("only IDENTITY ingress"). `config/nip98-proxy/proxy.mjs:732` drops
inbound `x-agentbox-pubkey`, `:743` re-injects; WS path `:864` strips, `:876`
re-injects. Fail-closed no-verifier at `:472` (`nip98_verifier_unavailable`).
Boot-fatal: `:120` (bad allowlist throws), `:219`/`:259`/`:281` (`process.exit(1)`
on invalid route/config).

**2026-09-05 re-verified at 08e817f39.** Governed paths changed by `11804ba4b` (`proxy.mjs` +242: break-glass scope/expiry bounds and an authoritative-`NOSTR_BRIDGE_PATH` rule that fails closed instead of falling back to another verifier candidate) and by the ADR-2047 citation refresh of `docs/INGRESS-identity.md`; both strengthen the fail-closed identity boundary, so the decision still holds. The `cbe7335b9` citations in the paragraph above have all drifted and are superseded by these HEAD line numbers: `flake.nix:2320` (`aoe serve --auth token --behind-proxy --allowed-host 127.0.0.1 --host 127.0.0.1 --port 9095`) and `flake.nix:2313` (\"only IDENTITY ingress\"); inbound `x-agentbox-pubkey`/`x-agentbox-auth-mode` are dropped on the HTTP path at `config/nip98-proxy/proxy.mjs:946-947` and re-injected from the verified identity at `:963-964`; the WS path strips at `:1106` and re-injects at `:1120`; fail-closed no-verifier at `:676` (`nip98_verifier_unavailable`); boot-fatal config at `:336` (unset `bearer_env` throws \"fail closed\") and `:376`/`:398`/`:416` (`process.exit(1)` on invalid route/allowlist/upstream config). **Governing-doc correction made by this pass:** every `verifyIdentity` citation in `docs/INGRESS-identity.md:69-89` was off by the ~99 lines the break-glass block added — `verifyIdentity` is at `proxy.mjs:626` (not 527), `constantTimeEqual` `:540` called at `:636`, `canonicalPubkey` `:241` called at `:689`, `pubkeyAllowed` `:227` called at `:693`, `SESSION_COOKIE` `:213`, session mint `:858`, `verifySessionToken` `:561` called at `:705`, cookie strip `:594`, identity injection `:963`, 302/401 branch `:915-930`, and the corrected `--auth token` comment is at `flake.nix:2647` (not 2515). Those citations have been repointed in place. Commands: `git diff --name-only 89301ec7..HEAD -- config/nip98-proxy/proxy.mjs docs/INGRESS-identity.md flake.nix`, `grep -n` on each cited symbol. Remaining gaps from the 2026-09-05 acceptance section (fake upstreams, no deployed door inventory) are unchanged.

## Closeout extension — 2026-09-04

**Work package:** CP-04. **Owner:** existing owner above. **Dependencies:** CP-01
revision/feature identity and the downstream consumer contract.

**Current source verification:** The current HTTP/WS paths strip supplied identity headers and inject authenticated identity. The NIP-07 handshake page is a proxy-owned pre-auth surface; upstream requests pass `verifyIdentity` before routing. Supported modes include fresh NIP-98, signed-handshake HMAC sessions and explicit break-glass. The single-door claim is scoped to AoE identity ingress, not all estate services.

At `89301ec7c911eab270c00a0cf81596d0d4f15535`, the local proxy suite passes 45 assertions with no skips using
`NODE_PATH=management-api/node_modules node config/nip98-proxy/selftest.mjs`.
The initial default-resolution run skipped three signature cases; both runs
are preserved in the [estate receipts](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/ingress-selftest-runtime-deps.json).
These are local fake-upstream checks, not deployed acceptance or, for the
identity helper, a key-persistence test. Prior verification at `d19073a82c319f7be01cf61d31521598dc044da5` remains
part of this record's history; the refreshed commit covers the scoped source
claims above. Existing activation labels are not newly verified by this run.

**Acceptance still required:** Verify spoofed identity headers, absent verifier, allowlist removal, cookie expiry/restart and each direct sidecar path. Bind the door inventory to deployed ports and credentials; document any bypass of per-user attribution.

## Acceptance progress — 2026-09-05

**Implemented.** The four acceptance cases named in the closeout are now
exercised against the real proxy, and the defects they exposed are fixed.

- *Spoofed identity header.* A client that supplies the identity headers the
  proxy injects has them **stripped and replaced** by the authenticated
  identity, asserted on both the HTTP and the WebSocket path; the upstream never
  observes the client-supplied value.
- *Absent verifier.* When the NIP-98 verifier is unavailable or throws, the
  proxy **fails closed** — it denies rather than routing unauthenticated, and
  the upstream receives nothing.
- *Allowlist removal.* An identity that was allowed and is then removed is denied
  on the next request, **including one carrying an already-established session
  cookie**, so a live session cannot outlive its authorisation.
- *Cookie expiry and restart.* An expired signed-handshake cookie is rejected,
  and a cookie minted under a previous HMAC key is rejected after restart, with a
  control case proving a current-key cookie still works. Neither rejection
  contacts the upstream.

**Tests and results.** `NODE_PATH=management-api/node_modules node config/nip98-proxy/selftest.mjs`
— **120 assertions, 0 failures, 0 skips**. The suite grew from 45 assertions with
the cases listed above; the pre-existing cases are unchanged.

**Receipts.** `docs/estate-closeout/2026-09-05/adr-2009-nip98-selftest.json`.

**Remaining.** Fake upstreams throughout: this is not deployed acceptance. The
door inventory is still not bound to deployed ports and credentials, each direct
sidecar path is untested, and no bypass of per-user attribution has been
enumerated against a running deployment.

**Governed paths changed.** `config/nip98-proxy/proxy.mjs`,
`config/nip98-proxy/selftest.mjs`, `config/nip98-proxy/README.md`.

## Landing re-verification — 2026-09-05 (ddd1f1ec8)

Governed paths changed in the landing commit: docs/INGRESS-identity.md: one line in `## Remediation — 2026-09-05` recording the ADR-2062 listener gate; flake.nix: the aoe-profiles volume entry and baseline volume name (ADR-2063) and the `lib.optionalString podcastIngestEnabled` wrapper around [program:podcast-cron] (ADR-2057); the aoe-serve, nip98-proxy, relay and proxy blocks are byte-identical. Decision unaffected; `verified_commit` moved to the landing commit.

## Landing re-verification — 2026-09-06 (796d85fcf)

Governed paths changed in the Wave 3 landing commit: docs/INGRESS-identity.md, flake.nix. The changes are the ones recorded by the Wave 3 records landed in that commit (ADR-2061, 2064, 2065, 2066, 2068, 2069, 2070, 2072, the proposed 2071/2073–2078) and the ADR-2018 recall diagnosis; none alters this record's decision. Gates at the landing commit: management-api 81 suites / 1290 tests, exposure gate PASS, catalogue 60 paths, config validation clean. `verified_commit` moved to the landing commit.

## Landing re-verification — 2026-09-06 (f7a3915f9)

Governed paths changed in the doc-sync commit: docs/INGRESS-identity.md — frontmatter `version`/`verified_commit` bump and changelog entry for the Remediation — 2026-09-05 section; no code or citation this record depends on changed. `verified_commit` moved to the doc-sync commit.


## Bounded source re-verification — 2026-09-07

The flake delta adds only secretBackupPkg; proxy bindings and authentication forwarding are unchanged. No new network surface was introduced. The complete intervening change to the governed source was reviewed at `a0ee1fe5740baa38e14c4ff3fe512dd557bcbb6e`; prior runtime/approval limitations remain.

### 2026-09-07 npm closure re-verification

The intervening governed `flake.nix` change adds exact package-lock inputs for
the nine existing npm CLIs and updates five dependency-output hashes after a
manifest-by-manifest comparison. No existing package version changed; additions
are optional musl packages already present in the original locks. All nine
fixed-output derivations passed an explicit the connected node `nix build --rebuild` replay.
This changes reproducible package installation, not the ADR's admission, custody
or publication rule. Source verification is renewed at this commit; existing
activation evidence and limits remain unchanged. The active local container was
not replaced, and no key was rotated.

### 2026-09-07 development-shell re-verification

The only intervening governed flake change selects the upstream executable
`nix2container.packages.${system}.nix2container-bin` for devShell buildInputs;
the former `n2c.nix2container` attribute does not exist. The selected executable
derivation evaluates on the pinned the connected node input. Container package selection,
admission and custody behaviour are unchanged by this development-shell repair.
Existing runtime activation limits remain. Verification is renewed at
`8fcc7b79b7c93c0744ca68b7a09fa14fdae8f5e3`; the project flake.lock has not been updated.
