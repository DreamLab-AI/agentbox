---
id: ADR-2009
title: The nip98-proxy is the fail-closed AoE identity boundary
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 9fc8b4e693edbf6ec2dfd0f372328903819eeb30
verified_paths: [config/nip98-proxy/proxy.mjs, flake.nix, docs/INGRESS-identity.md]
owner: jjohare
review_trigger: A second identity ingress is proposed, or aoe serve stops binding loopback
repo: agentbox
domain: INGRESS-identity
lineage: legacy ADR-042 (AoE interaction plane), ADR-043 (session identity binding), ADR-045 (sovereign npub front door)
---

# ADR-2009 — The nip98-proxy is the fail-closed AoE identity boundary

## Re-verification — 2026-10-02 at caab741c6 (factrail landing, ADR-2121)

The factrail landing (ADR-2121, `b7fc2b0e5` + `caab741c6`) touched governed paths without touching this decision: `flake.nix` gains only the factrail package, its `/opt/agentbox/bin/factrail` link and the shim copy, each under `lib.optionalString jevCompactionOn`. No hunk falls in code this record governs, so its claims and status axes stand unchanged.

## Re-verification — 2026-10-01 (runtime packaging changes)

The proxy remains the sole identity boundary after the ontology-runtime and
Codex storage changes. Its complete self-test passes with zero failures/skips,
including tokenless HTTP and WebSocket denial, and signed host-port binding
passes 4/4. Source anchor: `47e187934`.

## Re-verification — 2026-10-01 (dependency refresh)

The proxy remains the sole AoE identity door. Fastify 5's management-API URL reconstruction now uses request.host to retain the signed port; synthetic signed requests prove correct-port acceptance and mismatched-port rejection. Proxy selftests pass without skips.
Source anchor: `bce906199`. Existing status axes and deferred
work remain unchanged; this source/test receipt is not a new activation claim.

## Re-verification — 2026-09-29 (instruction-home migration)

Volume-identity correction at `efdb79475`: already-prefixed names are retained by the generator. The new resolved-Compose test passes for 15 persistent volume identities, the external Claude home, read-only instructions and PID parity. This changes no service authorization or published ports.

Packaging follow-up at `fc8ba7a7b`: the config copy now filters out mount-only instruction layers. Rechecked the changed Nix expression; it does not alter this record's runtime gates, auth commands or port inventory. The local test evidence below remains applicable.

The changed ingress prose adds sealed-original attribution, not a new identity route. HTTP/WS still strip supplied identity headers and inject verified identity; the proxy selftest passes with zero failures/skips, including absent-verifier and allowlist-removal denial. The Compose regeneration preserves the 9096 ingress. Verification anchor: `526b97dc6`. Status axes are unchanged by this source check.

## Context

## Re-verification — 2026-09-30 (interim sidechain supervision)

No identity route, verifier or proxy authorization changed. The real proxy selftest passes with zero failures/skips, including spoofed headers, missing verifier and removed allowlist entries.
Source anchor: `d0fa1b80b`. Existing status axes and deferred work are unchanged;
this scoped source/test receipt does not assert a new running-image activation.

### Original context
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

## Re-verification — 2026-09-21 (`b680a7aeef604276af73e00e1eb5156f379530ae`)

Governed paths moved for reasons outside this claim: `docs/INGRESS-identity.md` gained invariants 8 and 9 (ADR-2088, purely additive — `git diff <old>..HEAD -- docs/INGRESS-identity.md` is 30 insertions, 0 deletions); `proxy.mjs` gained `/nip07/session` (a cookie probe that 401s without a valid session, not a new identity door) and an opt-in `preserve_host` whose connection targets stay fixed by the trusted config. Re-established at `HEAD`: `aoe serve --behind-proxy --host 127.0.0.1 --port 9095` (`flake.nix:2411`); inbound `x-agentbox-pubkey` / `x-agentbox-auth-mode` unconditionally dropped and re-injected from the verified identity on HTTP (`proxy.mjs:961-962`, `:979-980`) and on WS upgrade (`:1122`, `:1140`); a verifier that will not load yields `nip98_verifier_unavailable` → reject (`:679`); boot-fatal config validation for a bad allowlist entry (`:222`) and an unset `bearer_env` (`:336`). Claim STILL TRUE.

### Re-verified 2026-09-21 at fa93fcaaacdda0549add06cbfeec8ad002912606

Governed paths changed in the PRD-024 governing-doc commit: docs/INGRESS-identity.md only, and only additively: the frontmatter version bump to 0.2.0 with its changelog line, a scope note appended to Invariant 6 (the relay allowlist, ADR-2012's concern, marked "not in force until PRD-024 is ratified") and a new section "Settlement identity and key separation, PROPOSED". The nip98-proxy identity boundary, the bearer gating and their citations into `config/nip98-proxy/proxy.mjs` are untouched (`git diff b680a7ae..fa93fcaaa -- config/nip98-proxy/proxy.mjs` is empty). Decision unaffected; `verified_commit` moved to the landing commit.

**2026-09-21 re-verified at `ab785f08c`.** Governed paths changed by the ADR-2105 kind move: docs/INGRESS-identity.md. The change is a kind-number relocation (colloquy 38100-38105 to 38410-38415, settlement 38110-38115 to 38420-38425) plus six numbers appended to `[sovereign_mesh.relay].allowed_kinds` and a comment above it; it touches no section this record governs. The decision and its invariant hold unchanged. Re-verified by `git diff 1639f86ab..224afae65 -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-09-22 at d6b976271 (Sovereign Corpus landing)

**Governed changes:** `flake.nix`: statix lint only — assignment→`inherit` (with `or` defaults preserved as `inherit ({ defaults } // cfg)`), redundant parentheses dropped, `(x or false) == true` rewritten as `let v = x or false; in builtins.isBool v && v` (same result for every input), and one comment reworded ("logseq corpus" → "vault corpus"). No derivation, port, service, gate or package changed. **Decision unaffected** — none of these touches what this record decides. `verified_commit` moved to the landing commit. Gates at that commit: routing table current; forum e2e real mode 101/101 and stub 30/30 against this tree; management-api jest 88/88.

## Re-verification — 2026-09-26 (`4f9450ac86477bc3832933953454ea577bd3d531`)

Tripped by `docs/INGRESS-identity.md` gaining item 10 (JunkieJarvis in end-to-end encrypted forum zones, forum ADR-2016) and changelog 0.2.1. The addition describes zone-key grant handling and zk-message decryption on the agent surfaces; it does not touch the NIP-98 proxy identity boundary, the door inventory or any authentication path this record decides. Decision unaffected.

## Re-verification — 2026-10-02 (`a48ea407a24185f7a4f654a35e66805778acbec8`)

Tripped by ADR-2078 (pods signer signs as the sovereign identity). `docs/INGRESS-identity.md` gains invariant 11 (pod origination), a Remediation — 2026-10-02 entry, a superseded-by marker on the 2026-09-05 `sign_requests = false` line and changelog 0.2.2; invariants 1-10 are unchanged. It touches no section, key or phase this record governs, and the decision holds unchanged.
Re-verified by `git diff c7b5d5f55..a48ea407a -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-02 (`f7465412de3d0d7a25fc1b6b2c8a72775490616d`)

Tripped by the `sidestr:dreamlab-txbt4` seal. `flake.nix` adds `sidechainChains`, one entry per `[sidechain.<name>]` table. For each table enabled under an enabled `[sidechain]` it bakes three supervisor programs, `sidestr-{producer,mirror,faucet}-<name>`: user devuser, the existing `config/sidechain` runners, and a producer the engine binds to 127.0.0.1:3451. `sidestr-agent` is baked when any faucet is on. The one table shipped is `enabled = false`, so the rendered supervisor text is unchanged. No port, Compose service, volume, user, MCP registration or other program moved. The proxy, its routes and its identity check are untouched. The new producer listens on loopback and nothing routes it through the proxy. **Decision unaffected.** `verified_commit` moves to the seal commit. Gates at that commit:

- the manifest validator is valid;
- `check-manifest-catalogue` passes;
- `tests/config/sidechain-genesis.test.sh` passes 7/7 and `sidechain-producer-gates.test.sh` 7/7.

## Re-verification — 2026-10-03 (`055c06ff69b2f53bf38a67d254c048bb03599fc8`)

Tripped by custody X-1 step 1 (W0 `custody/w0-bypasses` and W1 `custody/w1-role-accounts`). `flake.nix` changed only as follows. W0 (`8070c1010`, `6a433e6b3`): `root` loses its `devuser` member, and `[program:docker-read-proxy]` is added (root start, drops to 65534). W1 (`b8c66625a`, `055c06ff6`): role passwd and group lines are appended from `config/role-accounts.json`, `supervisord.roles.conf`, `role-secrets.tsv` and `role-accounts.json` are derived beside the unchanged `supervisord.conf`, and a root-owned `/run/secrets` tmpfs is added (ADR-2122). `[program:nip98-proxy]` is unchanged in `supervisord.conf`. Under the flag it runs as `ab-ingress`. `NIP98_PROXY_ALLOW_BEARER` and `NIP98_PROXY_SESSION_SECRET` are delivered to `/run/secrets/ab-ingress/` and removed from PID 1, and `proxy.mjs` reads them from the environment only. With the flag on, break-glass is therefore off and sessions use a per-boot secret (`proxy.mjs:212`). Both are fail-closed outcomes, so the boundary holds.
Re-verified by `git diff 0919dc39a..055c06ff6 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`275e12356319a9630846656580d497d53de3d38c`)

Tripped by custody X-1 step 1, W2 (`custody/w2-env-scrub`: `0965a9c8c`, `042115499`, `275e12356`; bypass 3, ROLE secrets out of PID 1's environment). `config/nip98-proxy/proxy.mjs` now reads `NIP98_PROXY_ALLOW_BEARER` and `NIP98_PROXY_SESSION_SECRET` through `management-api/lib/role-secret.js` (`<NAME>_FILE`, then `$AGENTBOX_SECRETS_DIR/<NAME>`, then the bare variable only with the flag off). Flag off it is the same read (the nip98 selftest passes unchanged). NIP-98 verification, the identity headers and the routes are untouched, so the decision holds. `flake.nix` changes only `[program:tailscale-up]` (a `TAILSCALE_AUTHKEY_FILE` branch that passes `--authkey=file:<path>`; the original branch is unchanged and is the one taken with the flag off) and the `[program:nostr-gateway]` comment. The decision holds.
Re-verified by `git diff 055c06ff6..275e12356 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`3b54129631067277f6363309b01cce485faa027a`, custody integration head)

Tripped by the custody integration (`custody/integration`: W0, W1, W5, W3, W7a, W8, W2, W9 and
the integration resolutions, ADR-2122). Since `275e12356` the governed paths changed as follows. `flake.nix` gains three things: W5's read-only bake of the sidestr upstream (`lib/sidestr-upstream.nix`, linked at `/opt/agentbox/sidestr/upstream` under `[sidechain].enabled`; `e103f81a7`); the isolated supervisor config renamed `/etc/supervisord.roles.conf` (`760ed01e4`); and a `[program:serve-identity]` block that prints one line and exits 0 while `[security].role_isolation` is off (`b49c62249`).
nip98-proxy's fail-closed boundary is untouched by these lines. Its secret loading moved to the shared role-secret loader in W2 (ADR-2122 §3a), which fails closed when the loader is unavailable under the flag. The decision holds. Re-verified by `git log 275e12356..3b5412963 -- <verified_paths>`
and the integration gates. Nix was not evaluated in this container; the image is unverified
until the owner's rebuild.

## Re-verification — 2026-10-03 (`32cedf9925ff6de8112fb45e41de048106d0d710`, custody integration CI fix)

Tripped by `32cedf992`, the fix for the PR's clippy and statix failures. `flake.nix` changes by one line in the `[sidechain.*]` normaliser: `parent = c.parent;` becomes `inherit (c) parent;` (statix W04), which evaluates to the same attribute set. Nothing this record governs changes meaning. The decision holds. Re-verified by `git log 3b5412963..32cedf992 -- <verified_paths>`.

## Re-verification — 2026-10-03 (`dc91e092ab646b4a825805b8229602ac8b15bad3`, custody W10)

Tripped by the W10 gap fixes on `custody/integration`. `flake.nix` (`dc91e092a`) gains one let-binding, `roleIsolationBaked = securityCfg.role_isolation or false`, and its inline `/etc/sudoers` lines become a call to `config/bake-devuser-privilege.sh` with that flag; with the flag off (the shipped value) the baked `/etc/group`, `/etc/sudoers` and `/etc/sudoers.d/devuser` are byte-identical (RC-X1-07). Nothing this record governs changes meaning. The decision holds. Re-verified by `git log 32cedf992..dc91e092a -- <verified_paths>`. Nix was not evaluated in this container.

### Re-verification — 2026-10-03 (vaultSrc repin)

`dc91e092a..33cbb29e8` changes one governed line: `flake.nix` `vaultSrc` moves from VisionClaw `64512141b` to main `94dc0ff60` (`33cbb29e8`, PR #13; ADR-2108 records why). Its one consumer is `lib/vault.nix` (the vault CLI package, `flake.nix:781`); nothing this record governs (ADR-2009 — The nip98-proxy is the fail-closed AoE identity boundary) reads it. The decision holds. Re-verified by `git log dc91e092a..33cbb29e8 -- <verified_paths>`.

### Re-verification — 2026-10-03 (poker house seat, PR #14)

`33cbb29e8..b41d9486c`: `flake.nix` bakes `nostr-bbs-poker-citizen` (`lib/poker-citizen.nix`) and a `[program:poker-citizen]` (`user=devuser`) only when `[sidechain].enabled` and `[poker_citizen].enabled`; it opens no listener: it dials the forum relay over `wss` and the local producer at `127.0.0.1:3450` (`55b9fe9f6`). Nothing this record governs (ADR-2009 — The nip98-proxy is the fail-closed AoE identity boundary) reads the new table or program. The decision holds. Re-verified by `git log 33cbb29e8..b41d9486c -- <verified_paths>`.

### Re-verification — 2026-10-03 (key-variable rule)

`b41d9486c..e3b06d688` changes one governed line: `flake.nix` passes `--env-classes ${./config/custody/env-classes.json}` to the build-time `role-accounts isolate`, which now refuses a devuser program holding a key variable without a role (ADR-2122). Nothing this record governs (ADR-2009 — The nip98-proxy is the fail-closed AoE identity boundary) changes. The decision holds. Re-verified by `git log b41d9486c..e3b06d688 -- <verified_paths>`.

### Re-verification — 2026-10-03 (ruflo 3.51.1, Claude Code 2.1.288)

`e3b06d688..dc6c7c5d8`: `flake.nix` changes only the `rufloPkg` pin: version 3.51.1, its lock (`config/npm-locks/ruflo-3.51.1.package-lock.json`) and both hashes (`dc6c7c5d8`), with the rationale comment. The ruflo closure's bins and extraBins aliases, every gate and every other derivation are unchanged. Nothing this record governs (ADR-2009 — The nip98-proxy is the fail-closed AoE identity boundary) changes meaning. The decision holds. Re-verified by `git log e3b06d688..dc6c7c5d8 -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.

### Re-verification — 2026-10-03 (agentic-qe 3.14.7)

`dc6c7c5d8..541e96dcc`: `flake.nix` changes only the `agenticQePkg` pin: version 3.14.7, its lock and both hashes (`541e96dcc`), with the rationale comment. Nothing this record governs (ADR-2009 — The nip98-proxy is the fail-closed AoE identity boundary) changes meaning. The decision holds. Re-verified by `git log dc6c7c5d8..541e96dcc -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.

### Re-verification — 2026-10-03 (wrangler 4.147.0)

`541e96dcc..9fc8b4e69`: `flake.nix` changes only the `wranglerPkg` pin: version 4.147.0, its lock and both hashes (`9fc8b4e69`), with the rationale comment. Nothing this record governs (ADR-2009 — The nip98-proxy is the fail-closed AoE identity boundary) changes meaning. The decision holds. Re-verified by `git log 541e96dcc..9fc8b4e69 -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.
