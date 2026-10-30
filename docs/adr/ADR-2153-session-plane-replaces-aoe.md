---
id: ADR-2153
title: Replace Agent of Empires with an owned, tmux-backed session plane that reconciles to the manifest
date: 2026-10-28
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: [ADR-2002, ADR-2063, ADR-2079]
superseded_by: []
verified_commit: 67ab0c5414f8e71c13978e1d5a3b5423316cd65f
verified_paths: [services/agentbox-sessions, config/session-plane, lib/agentbox-sessions.nix, flake.nix, flake.lock, agentbox.toml, config/entrypoint-unified.sh, config/role-accounts.json, config/custody/session-plane-acl.json, config/tab0-bridge, config/nostr-gateway/gateway.cjs, config/nip98-proxy, config/tmux-autostart.sh, config/hooks/session-state.cjs, config/registered-hooks.txt, scripts/session-provision.mjs, scripts/session-control.cjs, scripts/activation/session-plane-cutover.mjs, scripts/activation/session-plane-acceptance.mjs, management-api/lib/system-manifest.js, schema/agentbox.toml.schema.json, services/agentbox-manifest/src/stacks.rs, services/agentbox-manifest/src/stacks_env.rs, tests/cli/session-launch-contract.test.mjs, tests/cli/session-control.test.cjs, tests/config/session-plane-notify.test.sh]
owner: jjohare
review_trigger: Antigravity signed in and OpenRouter answering the canned round trip (closes §11 acceptance → implementation complete); the agentbox-aoe-profiles mount migration; any AoE consumer found to have been missed
repo: agentbox
---

# ADR-2153 — Replace Agent of Empires with an owned, tmux-backed session plane that reconciles to the manifest

## Re-verification — 2026-10-30

The governed Rust files changed only through `c3a370c60` formatting. Reformatting
the previous sources reproduced the current bytes; the governed state before
that formatting commit matches this record's previous verification. Existing
claims and activation status are unchanged; this is not new runtime acceptance.

## Re-verification — 2026-10-29 at 3b498088e (ADR-2153 cutover)

Reviewed the governed-path diff from this record's previous verification to
`3b498088e5a35e78158a9eb8d6f0266996d31f82`. Shared manifest, schema, supervisor and bootstrap changes
are scoped to the owned session plane: AoE and its token consumers retire,
provider provisioning moves, and session status hooks are added. Other named
capability sections and their status axes retain their existing claims.
Validation: session-plane tests (44 unit, 15 integration), manifest projector
suite and Clippy for both crates, proxy selftest (zero failures/skips), hook
registration (12), role-supervisor isolation (25), boot projection (13), and
manifest catalogue/declared-state checks pass locally. This does not claim new
runtime acceptance of this record's unrelated capabilities.

## Context
- Live on 2026-10-28, 5 of 10 AoE sessions are dead and one (`zai`) reports Idle while blocked on a trust prompt. The causes, each reproduced:
  - OpenCode v2.0.32 has no model flag on its TUI (`-m` and `--model` both fail: "Unrecognized flag"), and AoE 1.13 passes one. That kills `deepseek`, `loom` and `loom-raw`.
  - The worktrees under `${PROJECT}-worktrees/` are gone, so `codex`, `antigravity` and the OpenCode sessions have no cwd. The status-hook `ENOENT` in `debug.log` occurs only for those sessions.
  - `trust-seed.cjs` writes only the root `~/.claude.json`. A wrapper profile reads its own `profiles/<slug>/.claude/.claude.json` (its `CLAUDE_CONFIG_DIR`). zai's does not trust `~/workspace/project`. openrouter's does, but only because the prompt was once accepted by hand.
  - `agy` is not signed in.
- The seeder creates sessions and never reconciles them ("already exists — skipping (never killed)"). The records are frozen as of 2026-09-06 (`deepseek` still runs `deepseek-chat`, while the manifest says `deepseek-flash`).
- We run a fork (`DreamLab-AI/agentbox-of-empires@33e806ad`) that is 1 commit ahead and 970 behind upstream. v1.16 adds a one-way data migration.
- What we actually consume from AoE: create/list/send (seeder, tab0-bridge, nostr-gateway `/spawn`), the status hook into `/v1/sessions/boundary` (ADR-043 identity), `aoe session show` (`tmux-autostart.sh`), the TUI picker (tab 8), and the web board behind `:9096` and the `:8444` cockpit.
- The only AoE test in CI is `aoe-launch-never-attaches`. Nothing checks that a seeded command is accepted by the pinned CLI, or that its pane survives boot.

## Decision
1. **AoE is removed.** This covers the `aoe` flake input, `[program:aoe-serve]`, the `aoe-profiles` volume, `scripts/aoe-*`, the `:9095` listener, and the nip98-proxy default upstream to it. The web board is dropped and is not replaced. The proxy keeps `/mgmt/*`.
2. **A Rust crate, `services/agentbox-sessions`, replaces it.** It is a supervised daemon plus a CLI on the same binary, gated by `[interaction_plane]`.
3. **The manifest is the only declaration.** `[[interaction_plane.session_seeds]]` (slug, tool, model, worktree) is the desired state. The per-tool command lines live in `config/session-plane/launch.json`, the launch contract. Each command is verified against the pinned CLI versions by `tests/cli/session-launch-contract.test.mjs`.
4. **Reconcile, not create-only.**
   - At boot and on a timer, a seed whose session is missing, whose pane is dead, whose pane is blocked, or whose command/path/model differs from the manifest is recreated.
   - Before recreating, the daemon checks the worktree for work in progress: tracked changes and untracked files (`git status --porcelain`, ignored files excluded). If there are any it reports and does not touch the session. Ignored build output (`node_modules`, `coverage`, `target`) must not count, or a built worktree would hold its session out of reconcile for ever; recreating a tmux session deletes no files. Deleting a worktree is stricter and also refuses when an ignored path is not regenerable, because `git worktree remove` deletes ignored files without warning.
   - Sessions the daemon did not create are never touched.
5. **Worktrees live at `~/workspace/wt/aoe-<slug>`** (global one-root rule). Before launch, the daemon seeds folder trust for each session directory in every config store the session's tool reads: the root `~/.claude.json`, every wrapper profile's `profiles/<slug>/.claude/.claude.json`, and `~/.codex/config.toml`.
6. **The daemon runs as devuser**, as `aoe-serve` does: it must own devuser's tmux server, and it launches agents, which a role account never hosts. Its one secret is `MANAGEMENT_API_KEY`, and that is devuser-class (`config/custody/env-classes.json`). It therefore gets no `role-accounts.json` row.
   - **The API is a unix socket only**, offering `list`, `create`, `send` and `status`. It follows the identity-port precedent: mode 0660 in a dedicated socket group whose members are devuser and `ab-gateway`, authorised by `SO_PEERCRED` against an ACL of uid 1000 and 961. That way nostr-gateway still reaches it under `[security].role_isolation`.
   - tab0-bridge and nostr-gateway move to the socket and keep their existing tmux fallbacks.
   - There is no TCP listener, so ADR-2002's token boundary and the gateway's `aoe-share` token copy retire with `:9095`.
   - **`tab0` (the coordinator) is an external entry.** It names `agentbox:0`. It is listed and sendable, and it carries an identity binding, but it is never launched, recreated or reconciled.
7. **Status is explicit.**
   - `dead` comes from tmux `#{pane_dead}`.
   - `blocked` is a pane-capture match against the launch contract's blocker patterns (trust, sign-in, unrecognised flag).
   - `busy` and `idle` come from agent hooks where they exist: Claude Code Stop/Notification and Codex `notify`, the same spool voicelink uses. OpenCode and `agy` fall back to the contract's `ready` pattern.
   - A blocked session is never reported idle.
8. **Identity binding stays in management-api.** The daemon emits create/turn/close to `/v1/sessions/boundary`, and minting stays in `uris.js`. At cut-over, each AoE-keyed session epic is closed (`phase=close`) and the replacement sessions mint new bindings. Nothing is migrated in place.
9. **The picker is `agentbox-sessions pick`**, run in tab 8. It only ever calls `switch-client` on its own client (it carries the ADR-2063 / no-attach invariant forward).
10. **The roster is the current seeds minus `loom`.** The ontology-scaffolded OpenCode session is dropped, and `loom-raw` is the local Qwen session (`scaffold:false`).
11. **Acceptance.** After a cold boot, every seed has a live, unblocked pane within 60 s, and every chat seed answers one canned prompt end to end. `router` is excluded from the round-trip because it is a dispatcher console that sends work to the public fleet. This runs as the live tier of the launch contract test and as a boot health line.

## Consequences
- Fixes stop arriving through a fork that is 970 commits behind. We own about 1–2k lines of Rust in its place, and about 1.1k lines of AoE-specific JS go: `aoe-seed-sessions.mjs`, `aoe-session-boundary.cjs` and `aoe-curl.sh`. The proxy, tab0-bridge, the wrappers and `sessions-boundary.js` stay.
- The browser and phone dashboard, and the `:8444` cockpit's AoE board, go away. Remote control remains through Nostr DMs (nostr-gateway → socket) and voice (`voice-paned`, unaffected).
- INGRESS-identity's `:9095` invariants and door rows retire. The `:9096` row narrows to `/mgmt/*` and the other existing routes. `check-listeners.test.mjs` and `check-ports-loopback.sh` update with it.
- The daemon needs:
  - a `system-manifest.js` entry (apply class `rebuild`);
  - a gate on both its Nix package and its supervisor block;
  - a socket-group entry in `config/role-accounts.json`, alongside `ab-identity-port`, but no role account.
- ADR-2079 is superseded, because it examined AoE as a dispatch plane. ADR-2080's router console becomes an ordinary seed on the new plane and keeps its scope rules. ADR-2002 and ADR-2063 are retired when this ADR goes live, not before.
- `agy` sign-in remains an operator action. The acceptance gate reports it as `blocked: sign-in` and does not hide it.
- Until the daemon lands, AoE stays as it is, broken (operator decision 2026-10-28). The local Qwen model can still be reached directly at the Loom door with `scaffold:false`.

## Verification
The context facts were established on 2026-10-28 from:
- `aoe list --json` and `aoe session show` for each session;
- `~/.config/agent-of-empires/debug.log`;
- pane captures of `aoe_loom*`;
- an isolated `tmux -L` launch of each seed command against the installed CLIs: opencode 2.0.32, codex-cli 0.164.0, agy 1.4.4, claude-code 2.1.309;
- `git -C ~/workspace/project worktree list`;
- `profiles/{zai,openrouter}/.claude/.claude.json` (the project is trusted in openrouter's and not in zai's);
- `gh api …/compare` against upstream.

The OpenCode template was verified working: `OPENCODE_CONFIG_CONTENT='{"model":"loom-agent/current"}' opencode --standalone` reaches the full TUI on `qwen3.8-27b-heretic-q8_0 (Loom passthrough)`. Implementation status is `none`. `tests/cli/session-launch-contract.test.mjs` is written first. Its static tier passes, 6/6. Its live tier (`AGENTBOX_LIVE_LAUNCH=1`) is red, 5 of 7, until the daemon exists:
- `codex`, `antigravity`, `deepseek` and `loom-raw` fail because their session directories under `~/workspace/wt/` are not prepared;
- `zai` is blocked on the trust prompt;
- `openrouter` and `router` pass.

With `AGENTBOX_LAUNCH_DIR=~/workspace/project/agentbox`, which checks the CLI contract without prepared directories, the 2026-10-28 runs show:
- **Round trip passes:** `codex`, `zai`, `deepseek` and `loom-raw` each answer the canned prompt. This is after `trust-seed.cjs` began seeding the wrapper profile stores, and after the send path started pausing before Enter. Codex treats text and Enter in one burst as a paste.
- **Launches clean:** `router`, which is excluded from the round trip.
- **Fails on a credential:** `openrouter` returns `401 User not found`. Its key is invalid; this is not a launch problem.
- **Fails on sign-in:** `antigravity` stays blocked until signed in.
- **Known flake:** `zai` timed out once and passed on the next two runs. The wrapper kind has no `ready` pattern, so the prompt is sent after a fixed settle time.

A mutation check that restores the old OpenCode `-m` argv fails both the static tier and the live tier (`pane died: Unrecognized flag: -m in command opencode`).

## Implementation (2026-10-29, before cutover): dormant daemon
`services/agentbox-sessions` is built, tested and baked into the image when `[interaction_plane].enabled`, but its supervisor program has `autostart=false`. Agent of Empires is still the live session plane and its consumers still call it, so starting both would run every agent twice. The cut-over is a separate change that removes `aoe-serve`, repoints the consumers and flips the daemon on.

Landed, with the decisions it forced:
- **Ownership is a marker, not a name.** Sessions are `abs_<slug>` and carry the tmux session option `@agentbox-sessions=1`. Reconcile only ever considers marked sessions, so `agentbox:0`, a leftover `aoe_*` session and anything the operator started are never touched. A foreign session holding a seed's name is reported as a conflict.
- **The recreate gate ignores ignored files** (see §4 above, amended). Found by checking the campaignbuilder agent worktrees, which held only build output and would have blocked reconcile permanently.
- **Restarts are bounded.** Three per seed per hour, then `hold (backoff)`, so a command that dies on launch cannot spin the daemon. A sign-in blocker is reported and left; only trust prompts are cleared by recreating.
- **Socket group owned by `devuser`.** §6 asked for a socket group with no role account, but the role-accounts validator required every group owner to be a role. It now accepts `devuser` as owner (devuser must be a member) and creates no `/run/secrets/<group>` directory for it. The group is `ab-sessions`, gid 973; the ACL is `config/custody/session-plane-acl.json` (uids 1000 and 961). Peer credentials are read through `rustix`, because `UnixStream::peer_cred` is not stable on every toolchain.
- **Provisioning is not yet split out.** `provisionOpenRouter`, `provisionZai` and `provisionOpenCode` still live in `scripts/aoe-seed-sessions.mjs`, which still runs at boot. The daemon runs `scripts/session-provision.mjs` when it exists, and the cut-over creates it.
- **Busy/idle** come from `agentbox-sessions mark <slug> busy|idle` (hooks write it), else the contract's `ready` pattern, else age. Wiring Claude Stop/Notification and Codex `notify` to `mark` is part of the cut-over.
- **The daemon waits for the operator's tmux server** (up to 120 s) before its first pass, so the server always starts with the baked `tmux.conf`.

Not yet done, and not claimed: the consumer repoint (tab0-bridge, nostr-gateway, `tmux-autostart.sh`, the other `aoe-curl` users), AoE removal, the retirement of ADR-2002 and ADR-2063, and the §11 cold-boot acceptance. The acceptance can only be measured after a rebuild and the cut-over.

The 2026-10-29 verification found a tmux shutdown race when recreating the
server's only session. Creation retries the specific server-exit error at most
twice, only after checking that the session name does not already exist. The
private-tmux regression passed 100 isolated repetitions, and the full suite
passed 44 unit and 13 integration tests; this is not a live cut-over test.

## Cutover implementation (2026-10-29)

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

Consumers (tab0-bridge, nostr-gateway, picker, generated controller instructions)
use the session plane. Alternate-project and Z.AI dynamic spawns retain the
confined tmux fallback. Root and profile Claude hooks and Codex notify report
status; Codex keeps its existing voice spool. Legacy AoE hooks are pruned. Boundary
create failures retry on reconciliation, and the external coordinator gets its
own fresh binding. Before activation the host closes the old AoE session epics;
no old session identifier is reused.

This is implementation evidence, not a cold-boot acceptance claim. Provider
credentials and Antigravity sign-in remain live gates. The retained mount is an
explicit exception to decision 1's immediate volume removal: it allows fast
activation's unchanged-mount invariant and keeps the recovery image usable.
Removal requires a later mount migration; no data is deleted by this cutover.

## Activation evidence — 2026-10-29T18:14:17.085Z

- Running image: `127.0.0.1:15000/agentbox@sha256:ef1f99398eba048d9c9d2d03237ea6150caafc581ba7d02fa5bf95c67d5f8fa8`.
- Prepared source: `3b498088e5a35e78158a9eb8d6f0266996d31f82`; `sourceDirty: false`.
- Nine legacy AoE boundary close requests succeeded before replacement. The foreign
  grouped record was left alone. Dirty/foreign worktree protections remain; no recovery image or volume was deleted.
- Only Agentbox was recreated. Persistent mounts match the receipt. Caddy was
  reloaded without recreating its sidecar; the other container IDs were retained.
- `agentbox-sessions`, nip98-proxy, tab0-bridge and nostr-gateway are running.
  No AoE binary/program or :9095 listener remains. Socket mode is 0660, group
  ab-sessions; devuser is accepted and an unlisted uid is rejected.
- Acceptance results: antigravity=fail, codex=pass, deepseek=pass, loom-raw=pass, openrouter=fail, router=pass, zai=pass.
- Remaining acceptance failures: antigravity: blocked: You are currently not signed in; openrouter: API Error: 401.

Acceptance details are in the host-only
`.agentbox-build/session-plane-acceptance.json`. Router is excluded from the
round trip by design. Implementation remains `partial` until the full cold-boot
and provider acceptance condition is met; `live` records the actual cutover,
not an all-provider success claim.

### Final cold-boot and status evidence

The host observer saw all seven seed panes present by 9.06 seconds after
container start. At 60 seconds, six seeds were live and unblocked; Antigravity
was explicitly blocked on sign-in. Four chat seeds generated fresh arithmetic
PONG replies. OpenRouter's request returned `API Error: 401`, now classified as
blocked; router is excluded from chat round trips. After successful replies,
Codex, DeepSeek, loom-raw and Z.AI returned to idle. A regression test ensures a
pane-detected agent without completion hooks does not retain a synthetic busy
mark (44 unit and 15 integration tests pass).

The first live boot exposed an unset Stage-A variable in the new Stage-B notify
projection. The fix resolves both voice gates in Stage B; the isolated shell
execution test removes Stage-A variables and verifies fanout and retraction.
The final image booted normally and passed /ready without the manual recovery
used during diagnosis of that earlier image.

Separate limitations observed: session-boundary turn events report HTTP 500
while the beads privacy redactor returns RedactionShapeError, so successful
agent responses are not proof of successful session-epic binding. The initial
fresh worktree creation also reported an unavailable parent-project submodule
gitlink; its failure was left visible and no parent-project pin was changed.
Readiness can additionally report an aged optional sidechain tip. These remain
reported limits, not an all-capability acceptance claim. The pre-cutover recovery
receipt is `.agentbox-build/pre-session-plane-active.json`; candidate history in
previous.json is not a last-known-good deployment guarantee.

Re-verified at 70bd88d9e: tab0-bridge now probes the session plane on every tick and clears coordinator readiness on a failed send, so the voice meta-agent falls back to tmux after a daemon death instead of advertising session-control.cjs (which has none). This restores the "keep their existing tmux fallbacks" consequence above; `tests/cli/tab0-coordinator-readiness.test.mjs` covers it in CI.

Re-verified 2026-10-30 at `29a4b4939`: the agentbox.toml delta is three lines inside [system_one] only (bind 0.0.0.0:8094, network = true, local_only = []); this record's sections are untouched.

Re-verified 2026-10-30 at `cd3a29899`: the delta in schema/agentbox.toml.schema.json is [system_one] only (new `network` and `local_only` properties; `bind` admits 0.0.0.0/RFC 1918); management-api/lib/system-manifest.js gains one entry, `system-one-network`; scripts/agentbox-config-validate.js changes only the [system_one] E080 bind rule. This record's sections are untouched.

Re-verified 2026-10-30 at d0e9ca786: the only change to the governed paths is the new `[system_one].skill_list_at_least` key and its schema property (router runner-up listing, ADR-2091); no section this record governs changed.

## Close-out 2026-10-30 — status check, no axis change

Status stays `accepted / partial / live`. The old trigger ("the session-plane daemon lands") has fired, so `review_trigger` now names the events that close the remaining gap.

- Running image: `.agentbox-build/active.json` (host, read via the project bind) records `sourceCommit` `e786197ccb9f56c638d4b0181e77f33ab38b7db9`, `sourceDirty: false`, `delivery: registry`, `activatedAt` 2026-10-30T14:22:59.281Z, `imageId` `sha256:9776d2fc515c…`; `docker inspect agentbox --format '{{.Image}}'` and `$AGENTBOX_IMAGE_HASH` both return `sha256:9776d2fc515c5922cde9f7791248f731416192a6b4a66e8d6d06b15bfd5c892d`. The running container therefore runs main at `e786197cc`.
- `supervisorctl status agentbox-sessions` → `RUNNING pid 491, uptime 5:00:52`. `ls -l /run/agentbox-sessions/sessions.sock` → `srw-rw---- devuser ab-sessions`.
- `agentbox-sessions list` → eight rows: seven seeds (`abs_*`, `origin: seed`) plus `tab0` (`agentbox:0`, `origin: external`). `antigravity` is `blocked: You are currently not signed in`; `codex`, `deepseek`, `loom-raw`, `openrouter`, `router`, `tab0` and `zai` are `idle`. `agentbox-sessions call '{"op":"list"}'` returns the same set with `"ok":true`.
- `command -v aoe` → not found; `ss -ltn | grep -c ':9095 '` → 0.
- `git grep -nE '\baoe\b|agent-of-empires|aoe-curl|aoe-serve' -- ':!docs' ':!*.md'` at `e786197cc` finds no live consumer, only residue: the retained `aoe-profiles` volume (`docker-compose.yml:144,194`, `flake.nix:3868,3906`, by design in the cutover section); stale help text naming `/aoe/*` routes (`agentbox.sh:2767,2841`); a stale apply-catalogue summary (`schema/agentbox.toml.apply.json:92`); stale comments (`config/entrypoint-unified.sh:1516`, `management-api/middleware/auth.js:23`, `management-api/routes/sessions-boundary.js:10`); the `aoe-hooks` prune rule (`config/registered-hooks.txt:53-54`); the one-shot `scripts/activation/session-plane-cutover.mjs:6`; and the CI test that guards the no-attach invariant (`.github/workflows/invariants.yml:85`).

Remaining gap (why `partial` stays): §11 all-seed acceptance. Antigravity needs operator sign-in. OpenRouter now reports `idle`, but no round trip was sent from this close-out, so its 401 is not shown fixed. The session-boundary HTTP 500 (`RedactionShapeError`) is not visible in the `supervisorctl tail` window of this boot, which is not evidence of a fix.
