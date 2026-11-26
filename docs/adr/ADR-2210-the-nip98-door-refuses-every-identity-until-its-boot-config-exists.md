---
id: ADR-2210
title: The NIP-98 door refuses every identity until its boot config file exists
date: 2026-11-20
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 0b8d2b18827ea3198c356528398646b25ab2d379
verified_paths: [flake.nix, config/nip98-proxy/proxy.mjs, config/lib/nip98-config.sh, config/entrypoint-unified.sh, services/agentbox-manifest/src/proxy.rs, tests/config/nip98-boot-failclosed.test.mjs, tests/config/nip98-config-projection.test.sh, config/nip98-proxy/config-path.mjs]
owner: jjohare
review_trigger: first host rebuild that bakes this change, or any change to where the nip98-config projection runs
repo: agentbox
evidence_class: source+test+deployment+runtime
acceptance_boundary: Operator-requested host rollout is active. Eight baked proxy cases, native projector type rejection and an isolated real-supervisor missing-config/restart/allowed-key fixture pass. The live ingress rejects an unlisted valid signer. Existing-config freshness and role-isolation readability remain explicit limitations; neither is claimed solved.
---

# ADR-2210 — The NIP-98 door refuses every identity until its boot config file exists

## Scoped pin verification — 2026-11-26

Compared the governed delta since `538c223973ee1aa1fb18a7521b5ea91d3e9535ac`: `flake.nix`.
The flake changes only seven npm CLI version/lock/hash tuples; native agent
CLIs use official per-platform checksums. SystemScape pins the tested upstream
`7e5e842` source; its vendored Cargo.lock is unchanged byte-for-byte. The baseline
change only corrects and expands the pending SystemScape changelog entry.
No supervisor block, published port, mount, adapter, credential, feature gate
or memory-learning policy changes in this delta. Existing decision and status
axes are retained. CLI hash derivations, 301 Jest tests, 45 agent reconciliation
checks, no-mods/memory governance and the loopback gate pass; SystemScape has
189 passing tests and a passing terminal smoke. Image activation is not claimed.

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

Residuals: under `[security].role_isolation` the proxy runs as `ab-ingress` (uid 962, `config/role-accounts.json`) while the file is `1000:1000 0600`. Before this change that read as absent (any signer); now it is closed until the file is readable. A key removed from `allowed_pubkeys` still takes effect one boot late, because the proxy reads the previous boot's file and nothing restarts it after re-projection. [Ownership clause superseded 2026-11-23: see the re-verification at the end of this record.]

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

## Re-verification — 2026-11-23 at `06c2f701130aa94edf24a20f9f86de2131a0bcf4`

Governed delta since `fc95b3877`: `config/entrypoint-unified.sh`, `config/lib/nip98-config.sh`, `config/nip98-proxy/proxy.mjs`, `tests/config/nip98-boot-failclosed.test.mjs`, `tests/config/nip98-config-projection.test.sh`. `config/nip98-proxy/proxy.mjs` changes in three ways. (1) The boot-config path is chosen by uid through the new `config/nip98-proxy/config-path.mjs` (`proxy.mjs:254`; uid 1000 keeps the workspace file, any other uid reads only `$AGENTBOX_SECRETS_DIR/nip98-proxy-config.json`, and no permitted path means PENDING, `proxy.mjs:274`, `:1126`). (2) The URL it verifies is the raw query minus the proxy's own credential parameters, with one `forwardedProto()` value (`proxy.mjs:532-541`). (3) An inbound `X-Forwarded-Prefix` is dropped and the proxy re-emits its own, taken from the route's stripped prefix (`:891`, `:914`, `:1039`, `:1051`); an inbound `x-forwarded-proto` is likewise dropped on the WebSocket path and re-emitted once (`:1040`). The strip-and-re-inject of `x-agentbox-pubkey` and `x-agentbox-auth-mode` (`:888`, `:915`, `:1032`), route and allow-list parsing, verifier loading and the identity checks are not touched. In `config/entrypoint-unified.sh` the only hunk is in the `[interaction_plane.proxy]` projection (`:2343-2357`): the fallback branch, taken only when `config/lib/nip98-config.sh` is unreadable, now chowns a root-owned workspace `.agentbox` back to devuser first (`:2348-2350`), and a comment records that the fallback leaves the file `1000:1000 0600` so the door stays closed under role isolation (`:2353-2354`). Five lines added, so lines after `:2347` sit five lower than at `8db362bc5`. In `config/lib/nip98-config.sh` the projection is rewritten: staging, ownership and rename as described in the amendment below, a devuser-run flag-off path, and a role-isolation path into `/run/secrets/ab-ingress/`. `tests/config/nip98-boot-failclosed.test.mjs` and `tests/config/nip98-config-projection.test.sh` grow accordingly. **Review trigger fired.** "any change to where the nip98-config projection runs" is met twice: with the flag off the projection now runs as devuser through `setpriv` (`nip98-config.sh:36-37`, `:89-112`), and under role isolation its destination is `/run/secrets/ab-ingress/nip98-proxy-config.json`. Both were reviewed against the Decision, which stands: `NIP98_PROXY_REQUIRE_CONFIG=1` still makes an absent file mean pending, "projected, nothing to restrict" is still an explicit `{"routes":[],"allowedPubkeys":[]}` (written to the staged file when the projector stages nothing, `nip98-config.sh:67-73`), the readability probe still ends the pending state, and a failed projection still leaves a last-good file or none (`:65`, `:79`).

**Amendment (Residuals superseded in part).** The Residuals paragraph says that under `[security].role_isolation` the proxy runs as `ab-ingress` while the file is `1000:1000 0600`, so the door is closed until the file is readable. That ownership and location no longer hold. Under isolation the file is `root:ab-ingress` 0440 at `/run/secrets/ab-ingress/nip98-proxy-config.json` (`nip98-config.sh:78`, `:156-161`; directory rules in `ab_nip98_role_dir_prepare`, `:135`), and the proxy reads only a file inside `$AGENTBOX_SECRETS_DIR` when its uid is not 1000 (`config/nip98-proxy/config-path.mjs:22-33`, `proxy.mjs:254`); with no permitted file it stays pending (`proxy.mjs:274`, `:1126`). Readability for the role is therefore met in source; it is not exercised on a rebuilt image and `agentbox.toml:2615` keeps `role_isolation = false`. The lib-unreadable fallback (`entrypoint-unified.sh:2348-2357`) still writes `1000:1000 0600` and leaves the door closed under isolation, which is intended. Still open and unchanged: the stale-config window (Stage B ordering and a failed projection serving a last-good file) and the proxy poll's exit-for-restart comparison, now at `proxy.mjs:1133` (cited as `:1112` in the earlier note). `acceptance_boundary` in the front matter describes the live image, which does not carry this push, so it is left as written. `verified_paths` gains `config/nip98-proxy/config-path.mjs`. Ran `bash tests/config/nip98-config-projection.test.sh` (37 passed, 0 failed), `node tests/config/nip98-boot-failclosed.test.mjs` (14 passed, 0 failed), `node --test tests/config/nip98-config-path.test.mjs` (1 passed).

Judged from `git diff fc95b3877..06c2f7011 -- config/entrypoint-unified.sh config/lib/nip98-config.sh config/nip98-proxy/proxy.mjs tests/config/nip98-boot-failclosed.test.mjs tests/config/nip98-config-projection.test.sh`, read in full against this record's claims; `node scripts/adr-index-gen.js docs/adr --check`. The Decision and status axes are unchanged. The claim corrected above is the only one affected; no other claim of this record is falsified. Citations in this record to lines after the points above are as of their own commit and are not renumbered.

## Re-verification — 2026-11-23 (2) at `538c223973ee1aa1fb18a7521b5ea91d3e9535ac`

Governed delta since `06c2f7011`: `flake.nix`. The delta is the poker house seat's optional operator alert (`e59b51980`), plus the seat binary pin (`538c22397`, `lib/poker-citizen.nix`, not a path this record governs). `flake.nix` gains `pokerCitizenAlert` (`:473`) and the per-seat `alertPubkey` (`:489`), each `unplaceheld (… or "")`, and appends `POKER_CITIZEN_ALERT_PUBKEY` to the `[program:poker-citizen]` and `[program:poker-citizen-<name>]` environment lines only when the value is non-empty (`:3434`, `:3449`); lines after `:468` sit three lower and lines after `:486` four lower. Every hunk is additive: one optional key under `[poker_citizen]` and `[poker_citizen.<name>]` and one environment projection; the seat opens no listener and adds no program, port, mount, volume or manifest gate. Nothing this record decides (The NIP-98 door refuses every identity until its boot config file exists) reads `alert_pubkey` or `POKER_CITIZEN_ALERT_PUBKEY`. Line corrections: `agentbox.toml:2615` in the 2026-11-20 note (`role_isolation = false`) is now `agentbox.toml:2616`; the supervised-restart claim cites `[program:nip98-proxy]` at `flake.nix:3170-3177` (`NIP98_PROXY_REQUIRE_CONFIG="1"` on `:3174`, `autorestart=true`, `startsecs=3` on `:3176-3177`) and `[program:bootstrap]` at `flake.nix:2882-2887` (`autostart=true`, `startsecs=0`), not the earlier `:3165-3172` and `:2877-2883`. The claims themselves hold. Review trigger: not fired.

Judged from `git diff 06c2f7011..538c22397 -- flake.nix`, the hunks read in full against this record's claims; `node scripts/adr-index-gen.js docs/adr --check`. The Decision and status axes are unchanged and no claim of this record is falsified beyond the line corrections above. Citations in this record to lines after the points above are as of their own commit and are not renumbered.
