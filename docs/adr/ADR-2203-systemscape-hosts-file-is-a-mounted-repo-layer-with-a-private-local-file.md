---
id: ADR-2203
title: The SystemScape hosts file is a mounted repo layer with a private local file
date: 2026-11-18
decision_status: proposed
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: edf9118a73ca6699b4c9888eb2f5efe29729f6dc
verified_paths: [config/systemscape/README.md, config/systemscape/hosts.example.toml, config/entrypoint-unified.sh, flake.nix, docker-compose.yml, lib/systemscape.nix, lib/systemscape-Cargo.lock, tests/config/systemscape-hosts-layer.test.sh, tests/config/systemscape-hosts-boot.test.cjs]
owner: operator
review_trigger: the SystemScape pin moves to 0.4.0 or later, or a second consumer of config/systemscape/ appears
repo: agentbox
evidence_class:
acceptance_boundary:
---

# ADR-2203 — The SystemScape hosts file is a mounted repo layer with a private local file


## Scoped cache-hash verification — 2026-11-27

The complete governed delta since the previous stamp is eight `npmDepsHash`
assignments in `flake.nix`, recomputed from the already-committed security
lockfiles using the pinned nixpkgs prefetch tool. No source, feature gate,
supervisor command, mount, credential or policy changes in this delta.
Factrail projection (8), migration/delivery tests (33), and setup/advisor checks
(26) pass. This verifies source alignment; deployment acceptance is separate.

## Scoped pin verification — 2026-11-26

Compared the governed delta since `538c223973ee1aa1fb18a7521b5ea91d3e9535ac`: `flake.nix`, `lib/systemscape.nix`.
The flake changes only seven npm CLI version/lock/hash tuples; native agent
CLIs use official per-platform checksums. SystemScape pins the tested upstream
`7e5e842` source; its vendored Cargo.lock is unchanged byte-for-byte. The baseline
change only corrects and expands the pending SystemScape changelog entry.
No supervisor block, published port, mount, adapter, credential, feature gate
or memory-learning policy changes in this delta. Existing decision and status
axes are retained. CLI hash derivations, 301 Jest tests, 45 agent reconciliation
checks, no-mods/memory governance and the loopback gate pass; SystemScape has
189 passing tests and a passing terminal smoke. Image activation is not claimed.

## Scoped source verification — 2026-11-20

Reviewed the governed-path delta through `2ebc3859c77fce7996eb584d78a2b89c286d72c2` against the
[core-tool and browser source review](../estate-closeout/2026-11-20/core-tools-and-browser-source-review.md).
The change is limited to pinned tool packaging, the existing MetaHarness gate's
offline CLI, descriptive schema/catalogue text, bounded System-pane startup,
and honest classification of existing credentials. It changes no adapter,
listener, role authority, model policy or retrieval geometry. Existing decision,
implementation and activation axes and unrelated acceptance limits remain;
this is not a new whole-record runtime or role-isolation rehearsal.


## Scoped package check — 2026-11-18 (SystemScape 0.5)

The new source pin is `7faffcd29a13f5d0d217434a6e7fafe8407492a1`, version
0.5.0. Host prefetch confirms `sha256-t+7REjvDMzmAzQhJJB6VxDn/ni0BRHR0e2Ti7V8bA/Q=`;
the vendored lock is byte-identical. The standalone Nix build passed 183 tests
with one upstream ignored test, and reports 0.5.0. Eight public/private-layer
checks and the actual boot-link fixture pass. Mounts and boot-link semantics
are unchanged. This verifies the package update, not the pending 0.5 image
activation or any new acceptance/status promotion.

## Context
SystemScape 0.4.0 can watch other machines in its telemetry view. A hosts file
lists them, and each one's `systemscape --probe` is read over OpenSSH. The
default path is `~/.config/systemscape/hosts.toml`. In this container
`~/.config` is not persisted, `agentbox.toml` is tracked in a public
repository, and the file names real addresses and users. ADR-2118 already
solved the same shape for instruction tiers: a tracked public layer plus a
gitignored `local/`, mounted read-only and never baked into the image.

## Decision
- `config/systemscape/` is mounted read-only at `/etc/agentbox/systemscape`
  through the flake's baseline mounts and the generated compose. It holds a
  tracked `README.md` and `hosts.example.toml` (placeholders only) and a
  gitignored `local/hosts.toml` (the operator's machines).
- At boot, when `local/hosts.toml` exists, the entrypoint links
  `~/.config/systemscape/hosts.toml` to it. When it does not, a link the
  entrypoint made is removed. A regular file at that path is never replaced.
- The System pane command does not name the file. A pinned binary older than
  0.4.0 rejects unknown flags and would exit in a loop; with the default-path
  link it simply ignores the file.
- No `agentbox.toml` gate: the file existing is the switch. SSH credentials
  come from the persisted `~/.ssh` mount; the hosts file holds no secret.

## Consequences
- An operator adds machines by editing one private file; it takes effect at
  the next boot, and `systemscape --hosts /etc/agentbox/systemscape/local/hosts.toml`
  checks it without a reboot.
- The mount is rebuild-class: it lands with `./agentbox.sh rebuild`.
- The feature is inert until the SystemScape pin moves to 0.4.0 (rev, NAR
  hash, version and the vendored `lib/systemscape-Cargo.lock`), which needs
  the upstream commit pushed and a host-side prefetch.
- With the pin moved and a file present, the always-on System pane probes the
  listed machines continuously, including `nvidia-smi` every `gpu_interval`.

## Verification
- `bash tests/config/systemscape-hosts-layer.test.sh`: 8 passed. It checks the
  ignore rule, no tracked `local/` files, no estate specifics in tracked
  files, the mount in both flake and compose, the entrypoint link and that the
  System pane names no flag.
- The entrypoint block was exercised against temporary paths: no source, link,
  idempotent rerun, removal of its own link and preservation of a hand-written
  file.
- Not yet verified: a host `nix build .#compose`, a rebuilt image booting with
  the mount, and the pinned 0.4.0 binary in the System pane.

### Host package verification — 2026-11-18

Upstream fbd780511de2c3d264d53b8cb097f983b8ec156c is pushed, pinned at 0.4.0,
and host-prefetched with NAR hash
`sha256-hvAQpf+9SfBfSvHL70wmDyfD3YxTgvKxSVwwUCTapko=`. The lock copy is
byte-identical. `nix build .#systemscape` passed all 49 tests and the binary
reports 0.4.0. The actual boot block also passed temporary-filesystem tests for
absence, linking, repeat execution, link removal, regular-file preservation
and preservation of an unrelated dangling symlink. Image/production activation
evidence is deliberately not claimed by this source-only verification.

## Re-verification — 2026-11-20 at `9263a39761c0c69e651e77ec1c91be33f015a1b5`

Governed delta: `config/entrypoint-unified.sh` changed in one block: the browser-gpu registration probe (~:2248) now accepts HTTP 200 or 503 from `http://browsercontainer:8931/health` instead of `curl -f` (ADR-2207 D5), a net +2 lines, so every line after ~:2248 sits two lines lower. Nothing else in the file moved. The SystemScape hosts link is untouched. The Decision is unchanged and no claim of this record is falsified by the ADR-2207 sidecar refresh. Commands run: `git diff f97628381..9263a3976 -- config/systemscape/README.md config/systemscape/hosts.example.toml config/entrypoint-unified.sh flake.nix docker-compose.yml lib/systemscape.nix lib/systemscape-Cargo.lock tests/config/systemscape-hosts-layer.test.sh tests/config/systemscape-hosts-boot.test.cjs`; `bash -n config/entrypoint-unified.sh` → clean. Re-run the diff to reproduce.

## Re-verification — 2026-11-20 at `f6a87328266381a2f2f1bf6ddf7050ebd72eda49`

Governed delta: `config/entrypoint-unified.sh` changed in one hunk, `:2336-2348` (W3-05, ADR-2210): the `[interaction_plane.proxy]` projection now sources `config/lib/nip98-config.sh` and calls `ab_nip98_project` when that file is readable, and otherwise falls back to the previous `agentbox-manifest nip98-config` call. The hunk is a net +6 lines, so every entrypoint line after about `:2348` sits six lower than at the previous stamp; line citations in earlier notes are as of their own commits. Governed delta: `flake.nix` changed in one line, `:3169`: the `[program:nip98-proxy]` supervisor `environment=` gains `NIP98_PROXY_REQUIRE_CONFIG="1"` (W3-05, ADR-2210). One line replaces one line, so no `flake.nix` citation moves, and nothing else in the file changed. Neither change touches what this record decides. `bash -n config/entrypoint-unified.sh` → clean. The Decision is unchanged and no claim of this record is falsified by the JOURNAL-LOCK (ADR-2211), W3-05 (ADR-2210) or Podkey-policy (ADR-2212) merges. Commands run: `git diff 2ebc3859c..f6a873282 -- config/systemscape/README.md config/systemscape/hosts.example.toml config/entrypoint-unified.sh flake.nix docker-compose.yml lib/systemscape.nix lib/systemscape-Cargo.lock tests/config/systemscape-hosts-layer.test.sh tests/config/systemscape-hosts-boot.test.cjs`. Re-run the diff to reproduce.

## Re-verification — 2026-11-20 at `0913d5458837d8c4d1fa4b5b3e52b70e7975cb5a` (closeout branch)

Governed delta: `config/entrypoint-unified.sh` changed only in a comment block at `:2333-2339` above the nip98 projection (net +2 lines, so lines after `:2338` move by +2). No executable line changed. `docker-compose.yml` changed only in the R-025 header comment (`:5-10`), one line longer, so lines after `:10` move by +1 (the `"9096:9096"` line is now `:48`). No service, port, mount or environment value changed. `flake.nix` changed only in a comment in the generated compose file's header (R-025, the optional `claude-zai` sidecar, `:4164-4169`): comment text, one line longer, so `flake.nix` lines after `:4165` move by +1. No program, port, mount, environment value or derivation changes. Citations in this record to lines after these points are as of their own commit and are not renumbered. Commands run on this commit: `git diff 6a73c5a73..0913d5458 -- <the paths above>` read in full; `node scripts/adr-index-gen.js docs/adr --check`. The Decision and status axes are unchanged and no claim of this record is falsified.

## ADR-2214 drift check — 2026-11-22

Compared every governed path changed by `fc95b3877` (ADR-2214). Those changes
move `/home/devuser/.gemini` from a tmpfs to the named volume `agentbox-
antigravity-state`, set `[providers.gemini].auth_mode = "oauth"`, add `gemini`
to the OAuth-capable providers, export `AGENTBOX_ANTIGRAVITY_AUTH_MODE` to the
Antigravity consultant, and correct comments and docs. No value, authority,
boundary or runtime behaviour governed by this decision changes. This is source
verification, not activation.

## Re-verification — 2026-11-23 at `06c2f701130aa94edf24a20f9f86de2131a0bcf4`

Governed delta since `fc95b3877`: `config/entrypoint-unified.sh`. In `config/entrypoint-unified.sh` the only hunk is in the `[interaction_plane.proxy]` projection (`:2343-2357`): the fallback branch, taken only when `config/lib/nip98-config.sh` is unreadable, now chowns a root-owned workspace `.agentbox` back to devuser first (`:2348-2350`), and a comment records that the fallback leaves the file `1000:1000 0600` so the door stays closed under role isolation (`:2353-2354`). Five lines added, so lines after `:2347` sit five lower than at `8db362bc5`. The SystemScape mount and hosts-file projection is outside the hunk.

Judged from `git diff fc95b3877..06c2f7011 -- config/entrypoint-unified.sh`, read in full against this record's claims; `node scripts/adr-index-gen.js docs/adr --check`. The Decision and status axes are unchanged and no claim of this record is falsified. Citations in this record to lines after the points above are as of their own commit and are not renumbered.

## Re-verification — 2026-11-23 (2) at `538c223973ee1aa1fb18a7521b5ea91d3e9535ac`

Governed delta since `06c2f7011`: `flake.nix`. The delta is the poker house seat's optional operator alert (`e59b51980`), plus the seat binary pin (`538c22397`, `lib/poker-citizen.nix`, not a path this record governs). `flake.nix` gains `pokerCitizenAlert` (`:473`) and the per-seat `alertPubkey` (`:489`), each `unplaceheld (… or "")`, and appends `POKER_CITIZEN_ALERT_PUBKEY` to the `[program:poker-citizen]` and `[program:poker-citizen-<name>]` environment lines only when the value is non-empty (`:3434`, `:3449`); lines after `:468` sit three lower and lines after `:486` four lower. Every hunk is additive: one optional key under `[poker_citizen]` and `[poker_citizen.<name>]` and one environment projection; the seat opens no listener and adds no program, port, mount, volume or manifest gate. Nothing this record decides (The SystemScape hosts file is a mounted repo layer with a private local file) reads `alert_pubkey` or `POKER_CITIZEN_ALERT_PUBKEY`. Review trigger: not fired.

Judged from `git diff 06c2f7011..538c22397 -- flake.nix`, the hunks read in full against this record's claims; `node scripts/adr-index-gen.js docs/adr --check`. The Decision and status axes are unchanged and no claim of this record is falsified. Citations in this record to lines after the points above are as of their own commit and are not renumbered.
