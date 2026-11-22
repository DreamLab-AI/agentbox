---
id: ADR-2210
title: The NIP-98 door refuses every identity until its boot config file exists
date: 2026-11-20
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: fc95b38774814f9bc83ddfac28649d12cd74fe12
verified_paths: [flake.nix, config/nip98-proxy/proxy.mjs, config/lib/nip98-config.sh, config/entrypoint-unified.sh, services/agentbox-manifest/src/proxy.rs, tests/config/nip98-boot-failclosed.test.mjs, tests/config/nip98-config-projection.test.sh]
owner: jjohare
review_trigger: first host rebuild that bakes this change, or any change to where the nip98-config projection runs
repo: agentbox
evidence_class: source+test+deployment+runtime
acceptance_boundary: Operator-requested host rollout is active. Eight baked proxy cases, native projector type rejection and an isolated real-supervisor missing-config/restart/allowed-key fixture pass. The live ingress rejects an unlisted valid signer. Existing-config freshness and role-isolation readability remain explicit limitations; neither is claimed solved.
---

# ADR-2210 — The NIP-98 door refuses every identity until its boot config file exists

## Host verification and activation — 2026-11-20 evening

The operator requested checking and actioning this rebuild. Source
`ba1265164ea309bd5443cfa37b3e4e8ede2ae9ab` was activated at 22:01:48 UTC.
The actual baked proxy passed all eight fail-closed cases; its runtime path
matches the tested copy byte for byte. The native projector refused mistyped
allowlist/routes values without writing output. In a network-isolated fixture
with no production mounts, real supervisord first served a 401 while config
was absent, then restarted the proxy on config appearance and served the
allowlisted test signer. A fresh unlisted valid signer was rejected by the
live session endpoint with `pubkey_not_allowed` (three allowed keys, seven
named routes). Role isolation remains off; the stale-config and readability
limitations below remain. Earlier proposed/unbuilt statements are historical.

## Context
- The allowlist (`[interaction_plane.proxy].allowed_pubkeys`) and named routes reach `proxy.mjs` only through a file projected by `entrypoint-unified.sh` in Stage B, which runs under supervisord.
- `[program:nip98-proxy]` is `autostart=true` and starts in parallel with the bootstrap program, and the proxy reads the file once. On a clean workspace it can start before the file exists. A failed projection (`|| true`) also leaves no file.
- An absent file read as "no allowlist", and an empty allowlist means "any validly signed key" (ADR-045 D2), so the LAN door on `:9096` forwarded `/mgmt/` to the management API for any signer. The management API gates only specific routes by identity (`management-api/lib/authz.js`: approvals, mandate, sessions-boundary); that every other `/mgmt` route accepts any verified key is not established. This was an authorisation collapse, not an authentication bypass. Characterised by `tests/config/nip98-boot-failclosed.test.mjs` case 2 (200, upstream hit, before the change).

## Decision
- The supervisor sets `NIP98_PROXY_REQUIRE_CONFIG=1`. With it, an absent config file means *pending*: every NIP-98 or session identity is refused (401, `pubkey_not_allowed`), and the proxy exits 0 when the file appears so the supervisor restarts it with the real config. Break-glass is unchanged.
- `ab_nip98_project` makes "projected, nothing to restrict" an explicit file (`{"routes":[],"allowedPubkeys":[]}`), so the operator's deliberate any-signer mode survives. The proxy's readability probe, not existence, ends the pending state, so an unreadable file (EACCES) stays closed without a restart loop. A projector failure leaves a last-good file untouched, or no file (closed). The boot step stays rc 0.
- Without the variable (standalone, selftest) the ADR-069 behaviour is unchanged.

## Consequences
- A failed projection now costs the door (401 for everyone, loud log line), not its authorisation.
- A one-time proxy restart on first boot of a clean workspace. The brief window before it is closed, not open.
- The Rust projector still removes the file for an absent section; the shell wrapper rewrites it as explicit empty.

## Verification
Status is `proposed` with no `verified_commit` until the host rebuild verifies it; the paths are `config/nip98-proxy/proxy.mjs`, `config/lib/nip98-config.sh` and the two `tests/config/nip98-*` files.

Unit level only: `node tests/config/nip98-boot-failclosed.test.mjs` (8/8) and `bash tests/config/nip98-config-projection.test.sh` (7/7). The image is unbuilt; the supervisor restart-on-exit-0 path and the Stage B timing are confirmed only after a host rebuild.

Residuals: under `[security].role_isolation` the proxy runs as `ab-ingress` (uid 962, `config/role-accounts.json`) while the file is `1000:1000 0600`. Before this change that read as absent (any signer); now it is closed until the file is readable. A key removed from `allowed_pubkeys` still takes effect one boot late, because the proxy reads the previous boot's file and nothing restarts it after re-projection.

## Amendment — 2026-11-20 (review)

A review of this change found that `agentbox-manifest nip98-config` read a mistyped `allowed_pubkeys` or `routes` value (a string or a number, not an array) as absent, returned 0, and the boot helper then wrote the explicit empty config, which the door serves as any valid signer. From dd78dba42 a non-array value is an error (`services/agentbox-manifest/src/proxy.rs`, `array_or_absent`), so the helper leaves state untouched and the door stays closed. The projector now writes the file atomically, and the proxy's restart probe parses the file before exiting for a restart (`config/nip98-proxy/proxy.mjs:1090-1104`). Still not covered: a file left by an earlier boot is served until the proxy restarts (open-work NIP98-STALE-CONFIG).

> Note 2026-11-20 (NIP98-STALE-CONFIG, partly mitigated; source and tests only, live after the next image rebuild): the stale-config defect is narrowed, not closed. Under `NIP98_PROXY_REQUIRE_CONFIG=1` the proxy keeps the text of the file it loaded (`config/nip98-proxy/proxy.mjs`, `LOADED_CONFIG_RAW`) and its 2-second poll exits 0 when the file on disk is readable, parses and differs from that text (`proxy.mjs:1112`), after at least 3.5 s of uptime so the exit never counts inside `startsecs`. supervisord restarts it (`[program:nip98-proxy]`, `autorestart=true`, `startsecs=3`, `flake.nix:3165-3172`). Two things stay open. (1) Stage B, which writes the projection (`ab_nip98_project`, `config/entrypoint-unified.sh:2346`), is itself a supervised program (`[program:bootstrap]`, `autostart=true`, `startsecs=0`, `flake.nix:2877-2883`) started alongside the proxy, not before it. Until Stage B reaches line 2346 and rewrites the file, the proxy serves the previous boot's allow-list and routes, and after the rewrite for up to one more poll (2 s by default). (2) If the projection fails, nothing replaces the old file and the old list is served indefinitely: `ab_nip98_project` logs "a last-good file keeps serving" and returns 0 (`config/lib/nip98-config.sh:26-27`), and the proxy has no change to react to. An identical rewrite, a half-written file or a removed file does not restart it. Pinned by `tests/config/nip98-boot-failclosed.test.mjs` cases 8a and 8b, which cover the change-detection only, not the ordering window or the failed-projection case. The fail-closed fix is to move the stale file aside in Stage A, before supervisord starts, so the proxy starts pending and refuses every identity until Stage B projects a fresh one. That is a boot-path change (`config/entrypoint-unified.sh`) which cannot be tested without an image rebuild, so it is left for a rebuild-tested change and is not implemented here. The earlier "one boot late" residual therefore still holds on the stated terms.

## Re-verification — 2026-11-20 at `0913d5458837d8c4d1fa4b5b3e52b70e7975cb5a` (closeout branch)

Governed delta: `config/entrypoint-unified.sh` changed only in a comment block at `:2333-2339` above the nip98 projection (net +2 lines, so lines after `:2338` move by +2). No executable line changed. `config/nip98-proxy/proxy.mjs` (NIP98-STALE-CONFIG): under `NIP98_PROXY_REQUIRE_CONFIG=1` the config poll now also runs when a file was loaded. The proxy keeps the loaded text (`LOADED_CONFIG_RAW`) and exits 0 for a supervised restart when a readable, parsing file differs from it, never before 3.5 s of uptime (`proxy.mjs:1094-1118`, the comparison at `:1112`). The pending behaviour (refuse every identity until a readable file appears), routing, header stripping and re-injection, the verifier and the allow-list parsing are untouched. The fix is partial, as the ADR-2210 note says: the previous boot's file is still served until Stage B rewrites it. `flake.nix` changed only in a comment in the generated compose file's header (R-025, the optional `claude-zai` sidecar, `:4164-4169`): comment text, one line longer, so `flake.nix` lines after `:4165` move by +1. No program, port, mount, environment value or derivation changes. This is the record the change belongs to. Its body cites the restart probe at `proxy.mjs:1090-1104`; it is now `:1094-1118`. The two new cases are `tests/config/nip98-boot-failclosed.test.mjs` 8a and 8b. Run: `node tests/config/nip98-boot-failclosed.test.mjs` 10 passed, 0 failed; `bash tests/config/nip98-config-projection.test.sh` 7 passed, 0 failed. The dated note above states the limits (Stage B ordering window, failed projection, fail-closed fix left for a rebuild-tested change). Citations in this record to lines after these points are as of their own commit and are not renumbered. Commands run on this commit: `git diff 6a73c5a73..0913d5458 -- <the paths above>` read in full; `node scripts/adr-index-gen.js docs/adr --check`. The Decision and status axes are unchanged and no claim of this record is falsified.

## ADR-2214 drift check — 2026-11-22

Compared every governed path changed by `fc95b3877` (ADR-2214). Those changes
move `/home/devuser/.gemini` from a tmpfs to the named volume `agentbox-
antigravity-state`, set `[providers.gemini].auth_mode = "oauth"`, add `gemini`
to the OAuth-capable providers, export `AGENTBOX_ANTIGRAVITY_AUTH_MODE` to the
Antigravity consultant, and correct comments and docs. No value, authority,
boundary or runtime behaviour governed by this decision changes. This is source
verification, not activation.
