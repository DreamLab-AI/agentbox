---
title: Agentbox Ingress & Identity
doc_id: AB-INGRESS
version: 0.2.0
status: draft-for-ratification
verified_commit: 
date: 2026-09-05
changelog:
  - "0.2.0 (2026-09-21): PROPOSED, not ratified. ADR-2098/2101 (PRD-024 sovereign settlement): three domain-separated keys where the identity key k_id never spends and never seals blocks, kind 38420 sidestr-account-binding, a second Multikey in the DID document that amends ADR-033 D2'/D3' with I1 intact, ADR-2012's scope narrowed to identity ingress with chain ingress authenticated by consensus, and NIP-98 selecting the spend key on /v1/wallet/*. Recorded in a clearly marked proposed section plus a proposed scope note on Invariant 6; the live compliance surface is unchanged."
  - "0.1.3 (2026-09-06): Remediation — 2026-09-05 section: ADR-2057/2061/2062/2063/2064/2065/2066/2068/2069/2070/2072 and proposed 2071/2073–2078, the ADR-2018 recall diagnosis, landed in 796d85fcf — re-verified at "
  - "0.1.2 (2026-09-05, ADR-2047): refresh the drifted `verifyIdentity` citations (proxy.mjs:527, not 410-450); restate the door inventory as ten CI-sanctioned publishes; mark the two now-answered divergence bullets Resolved; supersede the compose-exposure qualification (the line-walker bypass is fixed by a parsing gate); correct the :8444 cockpit routing to reflect ADR-069 credential exchange via :9096. Adds the Remediation — 2026-09-05 section."
  - "0.1.1 (2026-08-31): correct AoE auth state — live command is `aoe serve --auth token` (flake.nix:1977), token auth has landed not staged; fix door-inventory row, sole-ingress cite, and the two now-stale divergences."
sources:
  - config/nip98-proxy/proxy.mjs
  - config/nip98-proxy/README.md
  - config/nostr-gateway/gateway.cjs
  - management-api/lib/agent-identity.js
  - management-api/server.js
  - agentbox.toml
  - flake.nix
  - voice/README.md
  - docker-compose.voice.yml
  - scripts/ci/check-ports-loopback.sh
  - docs/reference/adr/ADR-053-hex-canonical-pod-naming.md
  - docs/reference/adr/ADR-040-learning-consumers-model-lifecycle-and-legacy-mining.md
---

# Agentbox Ingress & Identity

## Purpose

Names every way an actor reaches the agentbox interaction/management planes and the
identity each door binds. Ground truth is the running code; legacy ADRs are cited as
evidence, not authority.

## Current State

### Door inventory (what is actually published)

Two ports leave the **agentbox container itself** on a routable interface —
`:9096` and the voice cockpit `:8444` (plus the stock Unmute debug UI `:8443`).
Everything else in the container binds loopback and is reachable only through one
of them or an SSH tunnel. The estate as a whole publishes ten sanctioned mappings
across five compose files; the remainder are sidecar services (browsercontainer,
gui-tools, xr-runtime) with their own auth. `scripts/ci/check-ports-loopback.sh`
(wrapper) → `check-ports-loopback.mjs` enforces `127.0.0.1:` on every other compose
publish and matches sanctioned entries on the normalised
`(host_ip, published, target, protocol)` tuple — see `check-ports-loopback.mjs:55-86`
for the list and its per-entry citation, and ADR-2013 / ADR-2047.

| Door | Bind | Identity gate | Backing service |
|---|---|---|---|
| `:9096` nip98-proxy | `0.0.0.0` (LAN) | NIP-98 / NIP-07 session / break-glass bearer | AoE `:9095`, `/mgmt/` → mgmt-api `:9090` |
| `:8444` voice cockpit | `0.0.0.0` (LAN) | Caddy origin, forwards `Authorization` to tab0-bridge / mgmt-api | AoE, `/approvals/*`, `/mgmt/*`, `/lo/*`, `/docs/*` |
| `:9090` management-api | `127.0.0.1` | NIP-98 bearer on identity surfaces (RbacGate-adjacent) | reached via `:9096/mgmt/` or `:8444/mgmt/` |
| `:9095` AoE `aoe serve` | `127.0.0.1` | daemon bearer token (`--auth token --behind-proxy`) + sole-ingress invariant | the interaction plane itself |
| `:7777` embedded relay | loopback unless `[sovereign_mesh.relay].expose` | pubkey allowlist | nostr-rs-relay |

### `:9096` nip98-proxy — the sole legitimate ingress to AoE

`config/nip98-proxy/proxy.mjs` is the trust boundary in front of `aoe serve`
(`flake.nix:1977`: `aoe serve --auth token --behind-proxy --allowed-host 127.0.0.1
--host 127.0.0.1 --port 9095`). AoE trusts `X-Forwarded-For` because it runs
`--behind-proxy`, so the sole-ingress invariant remains load-bearing for *identity*:
anything that opens `:9095` directly bypasses NIP-98 pubkey verification. Since N-05,
`--auth token` adds defence-in-depth beneath it — every `:9095` request must also carry
the daemon's bearer token, minted at launch into `~/.config/agent-of-empires/serve.url`
(not env-settable), so a co-resident process that never reads that file cannot drive
sessions even on a loopback-reachable port (`flake.nix:1963-1975`, `proxy.mjs:18-21`).

Auth precedence in `verifyIdentity` (`proxy.mjs:626`; ADR-2047 refreshed these
citations from the stale `proxy.mjs:410-450` range, and ADR-2058 re-verification at
`08e817f39` shifted them again by the break-glass scope/expiry block added at
`proxy.mjs:99-160`):

1. **Break-glass bearer** — only if `NIP98_PROXY_ALLOW_BEARER` is set
   (`proxy.mjs:99`); constant-time compared via `constantTimeEqual`
   (`proxy.mjs:540`, called at `:636`); stamps `mode: break-glass`, pubkey
   `NIP98_PROXY_BEARER_PUBKEY` (default `"break-glass"`, `proxy.mjs:100`, returned at
   `:670`), and is additionally scope- and expiry-bounded (`proxy.mjs:104-160`).
2. **NIP-98** (`Authorization: Nostr <base64(kind-27235)>`) verified through the SAME
   `NostrBridge.verifyNip98` path management-api uses (`proxy.mjs:680`,
   `mcp/servers/nostr-bridge.js:459`). The verified BIP-340 x-only pubkey is
   canonicalised (`canonicalPubkey`, `proxy.mjs:241`, called at `:689`), allowlist-checked
   (`pubkeyAllowed`, `proxy.mjs:227`, called at `:693`), then injected as
   `X-Agentbox-Pubkey` (`proxy.mjs:963`).
3. **NIP-07 browser session** — HttpOnly HMAC cookie `agentbox_nip07_session`
   (`SESSION_COOKIE`, `proxy.mjs:213`), minted at `POST /nip07/session`
   (`proxy.mjs:858`) after a signed kind-27235 handshake, stateless token
   `v1.<pubkey>.<expiry>.<mac>` verified by `verifySessionToken` (`proxy.mjs:561`,
   called at `:705`). The cookie is stripped before forwarding (`proxy.mjs:594`);
   upstreams never see it.

On failure: HTML GETs are 302'd to `/nip07/`; API clients get JSON 401
(`proxy.mjs:915-930`). If `NostrBridge` cannot load, the proxy fails **closed** — every
NIP-98 token is rejected, only break-glass (if configured) survives (`proxy.mjs:308-314`).

Upstream header hygiene: inbound `X-Agentbox-Pubkey` is always dropped and re-injected
from the verified identity (`proxy.mjs:681`, `proxy.mjs:796`) — a client cannot forge
the pubkey. `Authorization` is hop-by-hop and never forwarded, EXCEPT the ADR-069
credential-exchange path: a route may declare `bearer_env`, and the proxy injects that
upstream token **only when `auth.mode !== 'nip98'`** (`proxy.mjs:800`) — a genuine
signed NIP-98 header passes through so governance upstreams re-verify the operator
signature themselves.

**AoE token auth — landed (N-05).** `:9095` runs `--auth token` (`flake.nix:1977`):
the daemon mints a bearer token at launch into `~/.config/agent-of-empires/serve.url`
and every request must carry it as `Authorization: Bearer`. Loopback is no longer the
boundary. The two direct consumers read the token from that state file and inject it —
`config/nostr-gateway/gateway.cjs:108-124` (`aoeToken()` reads `serve.url`; its own
comment notes a co-resident process without the token file "can no longer drive the
daemon") and `scripts/aoe-seed-sessions.mjs`. The nip98-proxy stays the only *identity*
ingress (NIP-98 → pubkey); the token is defence-in-depth beneath it. The comment that
formerly lagged this (`flake.nix`, "(aoe serve, --auth none) is NEVER published") has
been corrected in the code and now reads `--auth token` at `flake.nix:2647` (ADR-2047;
line re-pinned by ADR-2058 re-verification at `08e817f39`).

### `:9096` multi-upstream routing (legacy ADR-045)

The proxy is also the sovereign front door for other surfaces. `NIP98_PROXY_ROUTES`
(JSON) and the boot-projected config file
(`/home/devuser/workspace/.agentbox/nip98-proxy-config.json`, from
`agentbox.toml [interaction_plane.proxy]`) add ordered prefix rules ahead of the
default AoE upstream (`proxy.mjs:212-250`). Identity verification is route-independent:
every upstream request is authenticated before routing (the proxy-owned NIP-07 handshake is separate), and the same identity
headers are injected whichever upstream wins. The canonical extra route is
`/mgmt/` → management-api `:9090`. Malformed route/allowlist config is **fatal at boot**
(fail-closed, `proxy.mjs:207-209`, `proxy.mjs:226-231`).

**npub gate** (`NIP98_PROXY_ALLOWED_PUBKEYS`, config-file `allowedPubkeys`, unioned):
when non-empty, only listed 64-hex pubkeys pass NIP-98 verification or may mint a
browser session (`proxy.mjs:113-125`, `pubkeyAllowed`). Unset = any validly-signed
pubkey. The break-glass bearer is orthogonal — its own sentinel, not gated by the
allowlist.

### `:8444` voice cockpit

`docker-compose.voice.yml:40` publishes `0.0.0.0:8444`. A Caddy origin
(`voice/README.md:13-22, 94-106`) fronts one credential over one origin, forwarding
`Authorization` to management-api `:9090` for `/lo/*` and `/docs/*`, and through the
nip98-proxy `:9096` for `/aoe/*`, `/approvals/*`, `/mgmt/*`, `/dream/*` and — since
ADR-069 — `/feed` and `/bridge/*` as well, where the proxy performs the server-side
`BRIDGE_TOKEN` credential exchange so the browser never holds the bridge secret
(`voice/console/Caddyfile:97-105`). `docker-compose.voice.yml:37-40` publishes both
`:8443` (stock Unmute debug UI) and `:8444` (operator console). Both are sanctioned
exposures on the CI list, not breaches — ADR-2013, ADR-2047.

### Identity: hex-canonical pubkey, DID, Multikey

Every durable identity is a BIP-340 x-only 32-byte pubkey, lowercase 64-hex, as the
single storage and URL identity (legacy ADR-053; `pods/<hex>/`, WAC agent URIs, NIP-98
`did:nostr:<hex>`). npub/bech32 is a display/symlink form only.

`management-api/lib/agent-identity.js` mints or loads a per-agent identity:

- Private-key precedence: `AGENTBOX_AGENT_PRIVKEY_HEX` env → persisted profile key file
  (0600) → freshly generated (`loadOrMint`, `agent-identity.js:107-160`).
- **DID**: `did:nostr:<64-hex>` (`agent-identity.js:150`) — the canonical identity.
- **Multikey**: `publicKeyMultibase = "fe70102" + xOnlyHex` (`MULTIKEY_PREFIX`,
  `agent-identity.js:45,50-51`) — `f`(base16-lower) ‖ `e701`(varint multicodec) ‖ `02`
  compressed-point tag, offered alongside the DID (legacy ADR-033 D3′).
- Private key never leaves the function; only DID / x-only pubkey / Multikey are emitted
  (`agent-identity.js:18`).

### Session identity binding

The nip98-proxy stamps the verified pubkey as `X-Agentbox-Pubkey` +
`X-Agentbox-Auth-Mode`. AoE derives the session `AGENTBOX_PROFILE` and the scoped memory
namespace from that identity at session-create (legacy ADR-043 D4.1/D4.4). Each seeded
session binds a `did:nostr` + URN + beads epic + scoped namespace
(`scripts/aoe-seed-sessions.mjs`).

### Sovereign mesh relay posture

`[sovereign_mesh.relay]` (`agentbox.toml:131-181`): nostr-rs-relay on loopback `:7777`,
allowlist ingress with **no fallback and no auto-add** — empty allowlist drops every
inbound event. `allowed_pubkeys` (`agentbox.toml:144-153`) is baked at nix build
(`relayAllowedPubkeysCsv`), so changes need an image rebuild. Current entries: operator
(jjohare), visionclaw-server governance publisher, two forum admins (beema, RedDread),
junkiejarvis bridge agent, operator mobile (Amethyst/Amber). `agent_event_auth = "nip98"`
(`agentbox.toml:172`) — hardened by default; `POST /v1/agent-events/emit` requires a
kind-27235 header and stamps `source_urn` from the verified pubkey.

**Clarify-before-acting on the ingest path (ADR-2088).** `[sovereign_mesh].junkiejarvis_clarify_before_acting`
(default `true`) gates the forum-suggestions tenant: a vague suggestion is answered with a
gift-wrapped clarification DM and parked, never triaged. The one gift-wrap site is
`sendGiftWrappedDm` (`management-api/lib/junkiejarvis-agent.js`); its unwrap mirror is
`unwrapDmRumor`. No new key material, no new relay, no new door — the tenant reuses the
JunkieJarvis signer and the existing authenticated `NostrBridge`.


## Known divergences & open items

- **Resolved — ADR-2047 (2026-09-05): the LAN surface is ten sanctioned publishes, all
  CI-enforced.** This bullet previously read as an admitted invariant breach ("one front
  door is two LAN doors"). It is not a breach: it is a decided, enumerated exposure.
  `scripts/ci/check-ports-loopback.mjs:75-86` carries the `SANCTIONED` list — the
  `9096` sovereign ingress; voice `8443`/`8444` ("second LAN ingress, modelled not
  hidden"); browsercontainer `5903`/`8931`/`9222→9223`; gui-tools `5905`/`9876`/`9877`;
  xr-runtime `5904` — each with its governing citation at `:55-73`, matched on the
  normalised `(host_ip, published, target, protocol)` tuple so a sanction cannot be
  smuggled in by re-spelling. Every other publish must bind `127.0.0.1` or CI fails.
  Correct statement of current reality: **`:9096` is the sole identity-gated ingress to
  the AoE interaction plane, and agentbox additionally publishes nine other sanctioned
  LAN ports whose own auth is each surface's responsibility.** Note the earlier framing
  understated the count as well as mis-framing it.
- **Resolved — ADR-2047 (2026-09-05): the `--auth none` comment was corrected in the
  code.** This bullet is itself stale. `flake.nix:2647` now reads
  `# (aoe serve, --auth token) is NEVER published.`, matching the live supervisor
  command. Nothing further to do.
- **OPEN — the exposure invariant is host-facing only; container-internal binds are
  uncovered (PROPOSED ADR-2062).** Raised by the estate lead, verified here.
  `flake.nix:2180` runs `code-server --bind-addr 0.0.0.0:8080 --auth none`. The
  compose publish is `127.0.0.1:8080:8080` (`docker-compose.yml:61`), so it is not
  host-reachable — but `docker-compose.yml:160-163` joins agentbox to the
  `visionclaw` network, resolved at `docker-compose.override.yml:180-183` to the
  external `visionclaw_network`. Because the listener binds `0.0.0.0` **inside** the
  container, every peer on that bridge (VisionClaw backend, Loom sidecar,
  browsercontainer, gui-tools, email gateway) can reach `http://agentbox:8080` with
  no credential — an editor and a terminal on the workspace. ADR-2013's gate parses
  `ports:` declarations and therefore cannot see this class of exposure at all.
  ADR-2062 proposes restating the boundary in terms of **listeners**: each
  supervised program declares its bind address, and the gate reads supervisor
  commands for `--bind-addr` / `--host` / `--listen` alongside compose `ports:`.
  Invariant 7 below is scoped accordingly rather than left reading as a complete
  exposure statement. Fix routed to ab-runtime (`flake.nix` is theirs).
- **ADR-040 key-split defect (pending).** The relay allowlist entry
  `agentbox.toml:148` is labelled `visionclaw-server — governance publisher (key-split
  pending, ADR-040 D3)`: the governance publisher currently signs under a key that is not
  yet split from the operator/server identity. Until split, governance-published events
  and server identity share a key. Open.
- **Unsigned pod-signing fallback.** Pod signing can fall back unsigned (legacy agentbox
  ADR-026); combined with the `did:nostr:local` placeholder fallback in
  `agent-identity.js:175`, a degraded boot can produce a non-sovereign identity silently.
- **Break-glass bearer over the LAN.** When `NIP98_PROXY_ALLOW_BEARER` is set the bearer
  is accepted on `:9096` (LAN) and via `?access_token=`/`?bearer=` on WS upgrades
  (`proxy.mjs:753-760`). A single shared secret bypasses NIP-98 entirely — acceptable as
  documented opt-in, but it is a full identity bypass while enabled.
- **Session secret is per-boot.** `NIP98_PROXY_SESSION_SECRET` defaults to
  `crypto.randomBytes` (`proxy.mjs:107`): NIP-07 sessions do not survive a proxy restart.
  Intentional, but every restart forces re-authentication.
- **ADR-051 (Loom) load-bearing but only Proposed**, and legacy ADR-045 status
  contradictions (frontmatter vs body vs index) remain unreconciled in the legacy corpus.

## Invariants (must not silently change)

1. AoE `:9095` stays loopback + `--behind-proxy` + `--auth token`; the nip98-proxy is the
   sole *identity* ingress, and every direct loopback consumer (gateway, tab0-bridge,
   seed script, `aoe-curl.sh`) must present the daemon token — a tokenless request to
   `:9095` must always 401.
2. Identity is verified before any route is consulted; `X-Agentbox-Pubkey` is always
   proxy-injected, never trusted inbound.
3. For *named governance upstreams*, `Authorization` injection is gated on
   `auth.mode !== 'nip98'` — a signed NIP-98 identity reaches them intact. The default
   AoE route is the exception: the proxy replaces `Authorization` with the daemon token
   for **every** auth mode (the proxy is AoE's authenticator; identity travels via
   `X-Agentbox-Pubkey`), and fails 503 locally when no token is available.
4. Missing NIP-98 verifier ⇒ fail closed. Malformed route/allowlist config ⇒ fatal at boot.
5. The DID is `did:nostr:<64-hex>`; hex x-only pubkey is the single storage/URL identity.
   Private keys never leave `agent-identity.js` and persist at 0600.
6. Relay ingress is allowlist-only with no auto-add; an empty allowlist drops everything.
   **Scope, PROPOSED (ADR-2098, not ratified):** this invariant governs *identity* ingress,
   which is what it actually controls. ADR-2098 would narrow the scope statement to say so
   and carry chain traffic outside it entirely: `sidestr-node` and `sidestr-producer` open
   their own connections to chain relays, and chain events authenticate against chain state
   (a block signature against `challenge`, a transaction against the UTXO it spends, a tip
   against the signer key) rather than against a pubkey list baked at nix build time
   (`relayAllowedPubkeysCsv`), which a federation with a changing signer set cannot live
   behind. **Chain pubkeys are never added to the identity allowlist.** This is a narrowing
   of a claim, not a loosening of a control, and it is not in force until PRD-024 is ratified.
7. Every host publish binds `127.0.0.1` unless it is on the `SANCTIONED` list in
   `scripts/ci/check-ports-loopback.mjs:75-86` (ten entries, each with a governing
   citation at `:55-73`) — the loopback-ports CI gate enforces this.
   **Scope, stated explicitly (ADR-2047, ADR-2062):** this invariant governs
   *host-facing* exposure only. It reasons about `ports:` declarations, so a
   container-internal `0.0.0.0` bind on a shared docker network is structurally
   invisible to it and is NOT covered. Read this invariant as "no unintended
   host-facing port", never as "no unintended listener". The listener-level
   statement is proposed in ADR-2062 and is not yet an invariant.

8. JunkieJarvis never acts on a forum item it does not understand. Before the nightly
   forum-suggestions tenant triages or queues a suggestion, `junkiejarvis-clarify.js`
   runs a deterministic clarity check (reproduction steps for a defect report, a named
   surface, an unambiguous target, and a specificity floor); a failing item is DMed 1–3
   questions over the shared NIP-59 envelope and parked as `awaiting-clarification`
   instead of triaged (ADR-2088). Gate `[sovereign_mesh].junkiejarvis_clarify_before_acting`,
   default **true**, env override `JUNKIEJARVIS_CLARIFY_BEFORE_ACTING`.
   **Scope, stated explicitly:** this governs the *forum-suggestions ingest path* — the
   post→handoff pipeline in `scripts/dream-forum-suggestions.mjs`. The agent's live
   conversational DM and kind-42 mention paths still answer freely; grilling a member
   mid-conversation would be the wrong behaviour there. Exactly ONE clarification DM is
   sent per item, and 7 days of silence expires the item to `stale` rather than acting on it.
9. On the **JunkieJarvis surface**, gift-wrapped (NIP-59) DMs are constructed in exactly
   ONE place — `sendGiftWrappedDm` in `management-api/lib/junkiejarvis-agent.js`, which
   delegates the sealing to `nostr-tools`' `nip59.wrapEvent`. `JunkieJarvisAgent._sendDm`
   and the nightly forum tenant both call it; a second envelope site on this surface is a
   defect, not an option.
   **Scope, stated explicitly:** this is NOT an estate-wide claim. Other surfaces keep
   their own `nip59` call sites — `management-api/lib/per-user-agent.js`,
   `config/hooks/nostr-live-mirror.cjs`, `config/nostr-gateway/{gateway,nostr-send}.cjs`.
   Consolidating those is unresolved work, not something ADR-2088 did.

## Change process

This is a living document. Amend it in the same PR as any change to the door inventory,
the proxy auth path, the identity mint, or the relay posture. Re-run
`scripts/ci/check-ports-loopback.sh` and update `verified_commit` on every ratified edit.
Load-bearing claims cite `file:line` against the running code; legacy ADRs are evidence
only.

## Current closeout verification — 2026-09-04

ADR-2002, ADR-2009, ADR-2010 and ADR-2011 now carry CP-01/04/05/06 closeout
conditions and refreshed source verification. The local proxy suite passed
45 assertions with installed runtime dependencies, including real signatures;
its initial missing-dependency skips are preserved as a separate receipt.
This is not a deployment receipt. The AoE single-door statement is scoped to
its attributed proxy path; other authenticated estate services and token-bearing
local consumers require their own explicit boundary. A source command saying
`--auth token` does not by itself establish the running binary's mode.

Key persistence failure can produce a valid but unstable identity; placeholder
fallback and cross-tier canonical naming remain acceptance conditions. Parser,
proxy, signature and storage guarantees must each be verified at their consumer
boundary rather than inferred from a common identity vocabulary.

## Compose exposure qualification — 2026-09-04

**Superseded in part — ADR-2047 (2026-09-05).** The structural bypass described
below is **fixed**. The gate no longer walks lines: `scripts/ci/check-ports-loopback.sh`
is now a wrapper that execs `scripts/ci/check-ports-loopback.mjs`, a strict YAML reader
covering block mappings and sequences, flow mappings and sequences (so JSON parses for
free, including a whole-document JSON file), quoted and block scalars, multiple
documents, anchors, aliases and merge keys. Anything outside that subset is **rejected
with a file and line, never skipped** — "parse, or reliably reject", with no third
silently-ignored outcome. Long syntax `{target, published, host_ip, protocol}` normalises
to the same tuple as `"0.0.0.0:8080:80"`, and `ports: *public_ports` is audited on what
it resolves to. The wrapper exits 3 if the gate is missing, so a stray copy cannot look
like a pass. Receipt: `docs/estate-closeout/2026-09-05/adr-2013-ports-gate.json` —
`PASS … 10 compose file(s), 7 ports block(s)`.

ADR-2013 remains `partial` for the *other* half only: the reviewed list covers mappings
in root compose filenames and does not by itself certify effective deployment inputs
(overlay order, interpolation, external files), authentication, or active listeners.
[Reproducible evidence and acceptance](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/runtime-ingress.md#port-gate-syntax-and-exposure-coverage) require release-bound runtime exposure receipts. No service was launched or bound during the review.

Historical text (2026-09-04, no longer accurate): "ADR-2013 is partial: the current tree
passes the gate, but nested service-flow and whole-file JSON-flow short port mappings
evade its line-oriented `ports` walker."

## Relay boundary qualification — 2026-09-04

ADR-2012 is partial for relay-wide allowlisting. The pod bridge authorises inbox writes after embedded-relay signature verification, storage/broadcast and acknowledgement. An empty list blocks that consumer, not relay admission. The standalone generator omits an empty whitelist setting; its backend semantics remain to be verified. [Evidence and acceptance](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/runtime-ingress.md#relay-admission-versus-inbox-authorisation) distinguish three passing authorisation helper tests from the unexecuted complete journey and require separate publisher, subscriber and durable-delivery contracts.

## Remediation — 2026-09-05

- ADR-2064 landing decision: `sign_requests = false` in both manifests, deliberately, until ADR-2078 (proposed) provisions the pods signer from the sovereign identity the boot mints; the fail-closed adapter stays staged.

One line per ADR landing in this domain on 2026-09-05. Each amends the Current
State, Invariants or divergence list above in the same change.

- **ADR-2062** — EXTEND: the exposure gate (`scripts/ci/check-ports-loopback.sh`) grows a listener rule over the generated supervisor `command=`/`environment=` bind addresses in `flake.nix`, so the domain's exposure invariant now covers container-internal binds on the shared docker network and not only host-facing compose publishes; it detected one unsanctioned non-loopback listener (`[program:wayvnc]`), recorded as a finding for ADR-2040.
- **ADR-2064** — FIX: pod request signing fails closed — when `[integrations.solid_pod_rs].sign_requests` is on and no NIP-98 header can be originated, the pods adapter throws the typed `SigningUnavailable` and emits no request, instead of silently going out unsigned at a default-deny pod; no dev-profile relaxation, since none exists (ADR-2041).
- **ADR-2065** — CONSOLIDATE: exactly one process writes `pods/<npub>/events/inbox/` — the Rust `nostr-pod-bridge` daemon when it is running — ending a live duplicate write whose file-existence dedup was silently suppressing the JS consumer's ACSP governance, agent-intent and payment dispatch; the JS consumer is narrowed, not deleted, because it is still the only implementation of those four surfaces.
- **ADR-2066** — FIX/DIVERGENCE: `loadSigner` derives the profiles root from `$WORKSPACE` instead of the retired literal `/workspace/profiles`, which could only `ENOENT`; the remaining provisioning gap (no `AGENTBOX_STACK`, no `sign_stack`, no `nostr.key.enc` on disk) is recorded as ADR-2064's activation prerequisite, not fixed in code.
- **ADR-2041** — WIRE: the ADR-057 execution journal and the ADR-059 action
  pipeline are connected to the real action path (`POST /v1/tasks`) instead of
  existing only under `tests/contract/`.
- **ADR-2042** — WIRE: the proxy-verified `X-Agentbox-Pubkey` is read in the
  attribution layer, so an action records the caller's identity rather than the
  container's. Makes Invariant 2 load-bearing downstream, not just at the proxy.
- **ADR-2043** — REMOVE: the duplicate JS `RelayConsumer` start, which the Rust
  `nostr-pod-bridge` crate already claims to replace.
- **ADR-2044** — FIX: identity derivation and agent-event attribution fail closed
  outside the dev profile (`did:nostr:local` placeholder and
  `AGENTBOX_AGENT_EVENT_AUTH` default `off`).
- **ADR-2045** — FIX: session-mirror egress redacts before NIP-59 wrapping, per
  ADR-2026.
- **ADR-2046** — FIX: the seccomp CI gate protects all 46 established denials and
  the argument-filtered AF_ALG rule, not a six-name sample.
- **ADR-2047** — DOC-CORRECT: door inventory, the two resolved divergence
  bullets, the superseded compose-exposure qualification, and the voice route
  table.
- **ADR-2048** — DOC-CORRECT: the `0600` key-file boundary is same-uid only, and
  what that does and does not buy.
- **ADR-2049** — FIX/DOC-CORRECT: withdraw the unreachable `410 Gone` resolver
  state; scope the multi-user `501` claim to suspend/archive.
- **ADR-2050** — PROPOSED: close the four PROTOCOL-registry federation contract
  rows with paired fixtures.

## Settlement identity and key separation — PROPOSED, 2026-09-21

**`decision_status: proposed`. Nothing here is built.** It records what
[PRD-024](proposals/sovereign-settlement.md), ADR-2101 and ADR-2098 would add to the identity
surface, so this governing document moves in the same change as the records. The Invariants
section above is unchanged apart from the explicitly proposed scope note on Invariant 6.

### Three keys, domain separated (ADR-2101 D3)

sidestr upstream reuses one raw private key as Nostr identity, taproot spending key and block
sealing key, with no domain separation, so one compromise yields all three. The estate refuses
that shape and already owns the tool to avoid it: HMAC-SHA256 domain-separated child derivation
with a JS-parity vector (`nostr-bbs-core keys.rs:251-265`).

| Key | Derivation | Held by | May |
|---|---|---|---|
| `k_id` | the sovereign identity key (`services/nostr-pod-bridge/src/identity.rs:130-158`) | the identity binary | sign identity events, sign the 38420 binding. **Never spends, never seals a block.** |
| `k_spend(chain)` | `derive_subkey(k_id, "sidestr/spend/" ‖ chain_id)` | the wallet path | spend UTXOs on exactly that chain |
| `k_sign(chain)` | `derive_subkey(k_id, "sidestr/sign/" ‖ chain_id)` | federated instance operators only | seal blocks on exactly that chain |

Per-chain derivation is what makes a leaked child-chain spend key unable to touch root coins and a
compromised session unable to seal root blocks. The peg descriptor never contains an identity key,
and the nsec never enters the settlement domain: signing happens behind the identity port.

### The cost of separation, and kind 38420 (ADR-2101 D4, ADR-2098 D2)

Domain separation costs the property that the DID *is* the address. That is bought back explicitly,
never inferred:

- **Kind 38420 `sidestr-account-binding`** (agentbox-owned, from the free band `38400-38499`, ADR-2105):
  addressable, `d` = `<chain id>:<did hex>`, content = the derived spend pubkey, signed by `k_id`.
  Registered in [PROTOCOL-registry.md](PROTOCOL-registry.md).
- **A second Multikey entry** in the DID document for the per-chain spend key. **This amends
  legacy ADR-033 D2'/D3'**, the single-Multikey form emitted by `build_did_document`
  (`services/nostr-pod-bridge/src/contract.rs:60-84`), and **leaves ADR-033 I1 intact**: the DID
  string does not change, no identity migrates, and the hex-canonical identity (ADR-2011, legacy
  ADR-053) is untouched. Consumers that assumed exactly one verification method must be checked;
  that check is a ratification requirement, not an afterthought.

No `wallet` URN is minted. A wallet is a derived view over UTXOs keyed by a `did:nostr`, and
`did:nostr:<hex>` already identifies it uniquely: a second identifier for one thing is the failure
mode ADR-013 and ADR-033 I1 both exist to prevent (ADR-2098 D1, rejected kinds).

### Chain ingress is authenticated by consensus (ADR-2098 D3, D4)

Chain traffic runs on its own supervised programs, `sidestr-node` and `sidestr-producer`
(see [BASELINE-container.md](BASELINE-container.md#sovereign-settlement--proposed-2026-09-21)),
never inside `nostr-pod-bridge`: mixing consensus validation into the process that holds the
identity key is exactly the key-role conflation the derivation above exists to prevent, and chain
events have no business in an ADR-2065 pod inbox. Those programs subscribe to chain relays (public
plus estate-operated) as their own connections, outside the `[sovereign_mesh.relay]` allowlist.
Estate-operated chain relays are needed for child-chain traffic because ephemeral kinds are
filterable only by kind at the relay. The proposed scope note on Invariant 6 above carries the
narrowing of ADR-2012.

### NIP-98 selects the spend key (ADR-2098 D5, ADR-2101 D2)

`/v1/wallet/{balance,holdings,send,peg-in,peg-out}` and `/v1/chain/{info,tip,open,close}` sit
behind the existing global auth hook on management-api, the same arrangement `routes/payments.js:29`
documents for `/v1/pay/*`; AoE-plane callers reach them through nip98-proxy `/mgmt/v1/wallet/*`,
and the mirror is published at `/chain/`. **The authenticated `did:nostr` from NIP-98 is what
selects the spend key.** There is no separate wallet auth, no API key and no session token for
money, and a request whose NIP-98 DID does not match the addressed wallet is refused *before*
policy is consulted.

Session identity binding gains a fifth binding at `phase=create`
(`management-api/routes/sessions-boundary.js:212-296`, after the memory namespace at `:259-266`):
an ephemeral child chain `sidestr:dl-s-<sha12>`, level 1, parent = the root chain, signer = the
session's own derived key, funded by a policy-capped peg-in and recorded as `chain_urn` alongside
`session_urn`, `epic_urn` and `memory_namespace`. It **fails open like its siblings** (the session
starts and simply cannot spend) while the money fails closed. `phase=close` closes the chain, pays
every holder pro rata in the closing coinbase and checkpoints the closing hash as the tombstone; a
child cannot outlive its session, and an orphaned open child holding value is an alertable
condition.
