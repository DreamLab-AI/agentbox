---
id: ADR-2029
title: "Rune is the first-class markdown TUI; tmux window 9 \"Notes\" opens it at the vault root"
date: 2026-09-02
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: edf9118a73ca6699b4c9888eb2f5efe29729f6dc
verified_paths: [flake.nix, lib/rune.nix, config/tmux-autostart.sh, config/tmux.conf, agentbox.toml, setup/agentbox.default.toml, schema/agentbox.toml.schema.json]
owner: jjohare
review_trigger: a Rune release that changes its CLI (`-w`), its keyboard-protocol requirement, or its licence; or the AoE plane absorbing note editing
repo: agentbox
domain: BASELINE-container
lineage: ADR-2003 (manifest-gated Nix composition), legacy ADR-042 (AoE Sessions window and its presence-detect fallback pattern), lib/systemscape.nix (pinned buildRustPackage precedent)
---

# ADR-2029 — Rune is the first-class markdown TUI


## Scoped cache-hash verification — 2026-11-27

The complete governed delta since the previous stamp is eight `npmDepsHash`
assignments in `flake.nix`, recomputed from the already-committed security
lockfiles using the pinned nixpkgs prefetch tool. No source, feature gate,
supervisor command, mount, credential or policy changes in this delta.
Factrail projection (8), migration/delivery tests (33), and setup/advisor checks
(26) pass. This verifies source alignment; deployment acceptance is separate.

## Scoped pin verification — 2026-11-26

Compared the governed delta since `baad4cdc100777f84f09edce22698fb9573858b9`: `flake.nix`.
The flake changes only seven npm CLI version/lock/hash tuples; native agent
CLIs use official per-platform checksums. SystemScape pins the tested upstream
`7e5e842` source; its vendored Cargo.lock is unchanged byte-for-byte. The baseline
change only corrects and expands the pending SystemScape changelog entry.
No supervisor block, published port, mount, adapter, credential, feature gate
or memory-learning policy changes in this delta. Existing decision and status
axes are retained. CLI hash derivations, 301 Jest tests, 45 agent reconciliation
checks, no-mods/memory governance and the loopback gate pass; SystemScape has
189 passing tests and a passing terminal smoke. Image activation is not claimed.

## Scoped consolidation check — 2026-11-22

Compared every governed path since the previous verification. The only changes
are the description of `user_cron.enabled` in the shared schema and, where
governed here, its explicit default-off setup seed. No existing value, authority,
privacy boundary or runtime implementation governed by this decision changes.
The setup drift suite passes 8/8. This is source verification, not activation.

## Scoped source verification — 2026-11-20

Reviewed the governed-path delta through `2ebc3859c77fce7996eb584d78a2b89c286d72c2` against the
[core-tool and browser source review](../estate-closeout/2026-11-20/core-tools-and-browser-source-review.md).
The change is limited to pinned tool packaging, the existing MetaHarness gate's
offline CLI, descriptive schema/catalogue text, bounded System-pane startup,
and honest classification of existing credentials. It changes no adapter,
listener, role authority, model policy or retrieval geometry. Existing decision,
implementation and activation axes and unrelated acceptance limits remain;
this is not a new whole-record runtime or role-isolation rehearsal.


## Scoped source check — 2026-11-18 (SystemScape 0.5)

The only governed delta since the prior stamp is the System pane's guarded
`--record` argument. Notes-window code, vault precedence and Rune are unchanged.
Bash syntax, 17 Notes-launcher cases, 10 vault-precedence cases and 11 consumer
fallback cases pass. Three launcher cases verify supported, older and failed
help probes. No new interactive Rune or whole-record acceptance is claimed.


## Scoped deployment review — 2026-11-16

Reviewed at `350772de92685339dfff117e66088d8adeb44bec`; governed changes since the prior stamp: `agentbox.toml`, `setup/agentbox.default.toml`. The reviewed rollout is limited to the journal/review integration, its Codex cron PATH and the operator-approved zero-budget audit hold. The guard refuses even a zero estimate; no model is called by its tests. Review/transport tests (83), journal tests (43) and cron checks (21) pass. Existing decision/status axes and unrelated acceptance limits remain. In particular, the Codex audit stays off until turn/spend confinement is implemented; this is not its activation receipt.


## Scoped source check — 2026-11-15

At `e521b1136ba912f63a18b2f9eeffbb8489b672eb`, the only governed-path
change is the SystemScape 0.3 comment in `config/tmux-autostart.sh`.
Removing full-line comments and blank lines produces the same executable script
as main before PR #49; Bash syntax validation passes. The Notes window, Rune
pin, CLI arguments and vault-root selection are unchanged. This establishes no
new interactive Rune acceptance; existing status axes and limitations remain.

## Scoped source check — 2026-11-14

Reviewed at `9ce9c2c2cd3be8e339139c7786657b5c3d158bc5`. Reviewed the shared manifest/schema/template and flake deltas: none changes the vault TUI gate, Rune derivation or Notes-window launcher. The Decision's stale 1.4.0 pin is aligned with the existing jjohare/rune 1.5.0-dreamlab.1 source pin. Vault precedence and consumer fallback fixtures pass. This does not claim a new image build or interactive Rune acceptance.


## Scoped source check — 2026-11-09

Shared composition changes add gated StatCraft (rebuild-class catalogue),
update pinned VisionCraft/dependency packages, and replace the bounded .local
tmpfs with a named volume. Nested OpenCode/code-server volumes retain their
identities. Codex remote startup stays manual; the removed feature flag is
not written. This does not widen listeners, authority or retrieval geometry.
The local-home migration fixture, 26 persistence/delivery tests, 25 supervisor
checks, 13 boot checks, manifest validation and port/listener gates pass.
See [local storage migration](../developer/local-home-storage.md). Runtime
acceptance remains separate; existing status axes and open limitations remain.

## Scoped source check — 2026-11-05

The only new shared-flake delta since the previous verification pins OpenSSH
10.6p2 and its upstream SHA-256 together, without changing listeners, mounts,
role mappings or this record's own feature gate. Upstream's 2026-11-05 release
adds the Linux musl/PAM-disabled password-auth workaround. This is a custom
package override: image VEX must not claim a stock nixpkgs OpenSSH build.
Runtime acceptance and all existing status limitations remain separate.

## Scoped source re-verification — 2026-11-03

Shared-file changes add pinned VisionCraft and direct AQE registration, retire
the unused precedent-bridge default, and extend governance custody/config
scrubbing. This record's own mechanism is retained; existing partial/staged
limitations and historical receipts are not promoted to new runtime acceptance.

Evidence: [rebuild verification receipt](../estate-closeout/adr-reverification-2026-11-03.md).
This verifies the scoped source amendment, not new whole-record runtime
acceptance. Decision, implementation and activation statuses are unchanged.

## Scoped re-verification — 2026-10-31

Reviewed the governed-path delta since the previous verification: only the
operator user-cron gate, devuser supervisor block, rebuild-class catalogue entry
and its boolean schema registration changed. Existing capability, identity,
storage and network contracts are unchanged. Preflight, manifest validation,
25 role-isolation supervisor checks and the user-cron schema regression pass.
This does not promote any activation status or claim a live role-isolation rehearsal.

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

Operators and agents work in tmux tabs; the corpus is now an Obsidian vault
(VisionClaw ADR-2040). There is no terminal surface for reading or editing
vault pages with wikilink navigation, so notes are edited in `vim`/`nano`
without link resolution, or outside the container. Rune
(`github.com/aka-rider/rune`, MIT, Rust, ratatui + comrak + tree-sitter,
v1.4.0 at commit `4187dff1`) renders markdown with `[[wikilinks]]`, YAML
frontmatter, tables, task lists, embeds and Kitty images, has a crash journal
and 3-way merge on external change (relevant when agents edit the same files),
and builds from source here in 90 s. Its CLI is `rune [-w <dir>] [file...]`.

## Decision

1. Rune is packaged as `lib/rune.nix` (`rustPlatform.buildRustPackage`,
   `fetchFromGitHub` pinned to `jjohare/rune` commit
   `2698873b1961877a2a1627e98b11929334b51e28` (`v1.5.0-dreamlab.1`), `cargoBuildFlags = ["-p" "rune-cli"]`,
   `doCheck = false`, hashes recorded in the file) and enters the package set
   when `[vault].tui = "rune"`. The gate is honest: absent the gate, the
   binary is not in the image.
2. `config/tmux-autostart.sh` creates window 9 **"Notes"** with
   `-c "$VAULT_ROOT"`. If `rune` is on `PATH` it runs `rune -w "$VAULT_ROOT"`;
   otherwise it prints the same style of rebuild notice the Sessions window
   uses. Window 0 remains the tab0-bridge target; landing behaviour is
   unchanged.
3. `config/tmux.conf` enables `allow-passthrough on` and `extended-keys on`
   so Rune's Kitty graphics and modifier keys work inside tmux.
4. Until the image is rebuilt, the bind-mounted `~/workspace/.cargo/bin/rune`
   (built with `cargo install --git https://github.com/jjohare/rune --tag
   v1.5.0-dreamlab.1 rune-cli`) satisfies the presence check; the entrypoint adds
   `/home/devuser/workspace/.cargo/bin` to `PATH` if it exists.
5. The welcome dashboard lists the Notes tab.

## Consequences

- Vault pages get link-aware editing in the same tabs agents work in.
- The Nix build adds one Rust package (~80 MB binary); rebuild time grows by
  the Rune compile.
- Obsidian-only constructs (callouts, highlights, math) render as plain text
  in Rune today; this is documented, not patched.
- Rune has no config file; keybindings and theme are compiled in (Ctrl chords
  mirror every ⌘ chord, so the Linux/tmux path is Ctrl). Its crash-recovery
  store is a global SQLite at `$HOME/Library/Application Support/rune/rune-v2.db`
  on every OS (not XDG). `/home/devuser` is a read-only layer in this
  container, so with the real HOME Rune starts degraded ("history disabled —
  storage unavailable") and loses exactly the journal and external-change
  bookkeeping this ADR values. The Notes window therefore runs the Rune
  process alone with `HOME=$WORKSPACE/.rune-home` (the pane shell keeps the
  real HOME); the journal lives at
  `~/workspace/.rune-home/Library/Application Support/rune/rune-v2.db` on the
  bind mount and survives both session restarts and image rebuilds.
  `~/.local` was rejected as the home because it is a small noexec tmpfs.
- Rune auto-detects the vault root by climbing to the nearest `.obsidian` or
  `.git` marker, so `rune` launched anywhere inside the vault behaves the same
  as `rune -w "$VAULT_ROOT"`; the window passes `-w` explicitly anyway.

## Verification

2026-09-02, on the `obsidian` branch: `bash -n config/tmux-autostart.sh`
clean; dry runs on a private `TMUX_TMPDIR` socket showed (a) rune present +
vault present → 10 windows, `9:Notes` running
`.cargo/bin/rune -w <vault>` with the normal keybinding footer and the
recovery DB created under `.rune-home`; (b) rune absent + vault missing →
the window falls back to `$WORKSPACE` (tmux refuses `-c` on a missing
directory) and prints the rebuild notice. The binary is resolved in bash
(`command -v rune`, then `$WORKSPACE/.cargo/bin/rune`) and PATH is passed
with `tmux new-window -e`, because panes run fish. Hashes in `lib/rune.nix`
were computed in a throwaway `nixos/nix` container fed over stdin (no bind
mounts — the DinD source-mount trap): `nix-prefetch-url --unpack` for the
source (tag and commit archives hash identically), `cargoHash` from the
fake-hash mismatch against the repo's pinned nixpkgs
(`9ae611a455b90cf061d8f332b977e387bda8e1ca`), then a **complete** build of
`rune-1.4.0` (77.7 MB stripped, `rune 1.4.0`) with the real hashes. Gate
evaluation: `[vault].tui = "rune"` → `runeActive=true`; section absent →
`false`. `implementation_status: complete` when the rebuilt image is booted
and `verified_commit` is recorded.

## Closeout extension — 2026-09-04

CP-01/02/06/08. Owner remains jjohare with vault/runtime maintainers. The current Notes script launches on binary discovery without checking VAULT_TUI or AGENTBOX_VAULT_ENABLED, including the retained workspace cargo fallback. A missing vault uses the workspace; recovery-home creation failure can launch degraded. Existing staged activation and historical implementation evidence are preserved, not re-certified.

**Acceptance condition:** Test mode-none with a binary present, missing/present vault, retained fallback binary, writable/unwritable recovery home, concurrent edits and restart recovery. Decide whether none is a package-selection setting or an execution off-switch, and expose that distinction to the operator. Reopen on resolver, consumer, launcher, storage or TUI changes. Both shell files pass syntax checking; no live terminal/editor or image activation test ran. See the [vault review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/authored-vault-transition.md#runtime-path-overrides-and-notes-launch) and [source/probe receipt](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/vault-path-probe.json).

## Acceptance progress — 2026-09-05

- **Implemented** — the window-9 decision in `config/tmux-autostart.sh` is now a
  single documented function `_notes_window()`, hoisted near the top, with three
  gates evaluated BEFORE binary discovery decides anything. (1) `AGENTBOX_VAULT_ENABLED=0`
  — the vault gate (ADR-2028): no `[vault]` means no corpus to open, so the TUI is
  not launched and the pane says which gate refused; unset is treated as enabled,
  so a standalone launch with a real vault behaves as before. (2) `VAULT_TUI`
  (manifest key `[vault].tui`): `none`, empty or unset blocks the launch even when
  a `rune` binary is present, including the interim `${NOTES_CARGO_BIN}/rune`
  fallback. **The open question is decided and documented in the comment header
  and in the pane message: `[vault].tui` is an EXECUTION off-switch (runtime,
  restart-class); PACKAGE SELECTION is a separate gate evaluated in `flake.nix`
  at BUILD time (rebuild-class), which is why the two can legitimately disagree.**
  (3) Recovery home: `mkdir -p` failure, a non-directory, or a failed write probe
  no longer launches degraded — the pane gets the path, the reason and the fix,
  and the window is left on a shell, because a degraded Rune loses exactly the
  crash-journal and external-change bookkeeping that makes concurrent
  agent/operator edits safe. The window is created in every case, so a refusal
  never costs the operator the tab. A documented, inert dry-run hook
  (`AGENTBOX_TMUX_AUTOSTART_DRY_RUN=notes`) runs only this decision and exits;
  nothing in the image, supervisord or compose sets it.
- **Tests and results** — new `tests/tui/notes-launcher.test.sh`: no tmux server,
  no real Rune (every PATH entry carrying a `rune` binary is dropped so the test
  decides on its own fixtures), `tmux` replaced by a recording stub.
  `bash tests/tui/notes-launcher.test.sh` → **11 passed, 0 failed, exit 0** —
  tui=none with the binary present (no launch; message names the key and the
  execution/package distinction); `VAULT_TUI` unset treated as none; tui=rune +
  binary + vault (launched at the vault root under the recovery HOME, which is
  created); tui=rune + vault missing (workspace fallback, launched, warning);
  `AGENTBOX_VAULT_ENABLED=0` (no launch, vault gate named); unwritable recovery
  home (no launch, path + reason + fix, explicit "not launching degraded");
  no binary (rebuild notice); window 9 created in every case; the dry-run hook
  creates no session and touches no other window. `bash -n` clean.
- **Receipts** — `docs/estate-closeout/2026-09-05/adr-2029-notes-launcher.json`
  (full stdout, exit codes, syntax-check results, source SHA-256s).
- **Remaining** — concurrent-edit and restart-recovery behaviour of the Rune
  journal itself is still untested (it needs a real Rune process and a real
  terminal), as is image activation with the baked package. `activation_status`
  stays `staged`; `implementation_status` is left at `complete` for the packaging
  and window decisions now covered, with the live-editor evidence still open.
- **Governed paths changed** — `config/tmux-autostart.sh`,
  `tests/tui/notes-launcher.test.sh` (new).

## Amendment 2026-09-25 — dreamlab fork; window 9 opens the working vault

- **Source** — `lib/rune.nix` now builds `jjohare/rune` tag `v1.5.0-dreamlab.1`
  (`2698873b`), a fork cut from upstream `v1.5.0` adding Obsidian callouts,
  `==highlights==` and `#tags`; a backlinks panel (F3) with vault-wide
  shortest-path wikilink resolution; and daily notes (F4, `--today`,
  `--daily-dir`, `--daily-format`, `--daily-template`, Templater
  `tp.date.now` tokens). Fork gates at the tag: `make test` 3,801 passed,
  `make lint` clean, `make test-fuzz` and `make perf-guard` green. Upstream is
  MIT; nothing has been offered upstream yet.
- **Hashes** — the `src` hash was computed without Nix by a NAR serialiser that
  reproduces the v1.4.0 pin byte-for-byte; the cargo vendor now comes from the
  pinned `Cargo.lock` (no `git+` sources), replacing `cargoHash`. Both are
  confirmed only when the image is rebuilt.
- **Window** — window 9 opens `[vault].working` (override
  `AGENTBOX_NOTES_ROOT`), on today's journal when the binary offers `--today`;
  see the 2026-09-25 CHANGELOG entry. The `review_trigger` now also covers a
  divergence between the fork and upstream that makes rebasing impractical.
- **Governed paths changed** — `lib/rune.nix`, `config/tmux-autostart.sh`,
  `config/config.fish`, `tests/tui/notes-launcher.test.sh`.

## Disposition — 2026-10-02

- **Suitability:** fits
- **Priority:** P1 — this cycle (settle the proposed-ADR census, TODO "Proposed decision records")
- **Why:** The image has it baked: `rune` resolves to `/nix/store/…-rune-1.5.0-dreamlab.1/bin/rune` and reports `rune 1.5.0-dreamlab.1`, the fork pinned by the 2026-09-25 amendment (`ebca7d62e`, `b558d0d9a`). tmux window `9: Notes` is running in the `agentbox` session. The notes window is part of the operator console that §9 counts as first-class demonstrator work. Two things are still untested: concurrent-edit and restart recovery of the Rune journal.
- **Next:** Ready to accept on the baked binary and the live window 9. Record activation `live` and keep the journal-recovery test as a named residual. **Accepted — owner decision 2026-10-02, Q8** (re-verified at `a238a3764`: `rune --version` → `rune 1.5.0-dreamlab.1` from `/nix/store/irlv87k4…-rune-1.5.0-dreamlab.1`; tmux `agentbox` window `9: Notes` running). `activation_status: live`. Residual: the Rune journal's concurrent-edit and restart recovery is still untested.

## Re-verification — 2026-10-02 (`a48ea407a24185f7a4f654a35e66805778acbec8`)

Tripped by ADR-2078 (pods signer signs as the sovereign identity). `agentbox.toml` changes only in `[integrations.solid_pod_rs]`: `sign_requests` false→true and the comment block above it (ADR-2078); `setup/agentbox.default.toml` carries the same single `sign_requests` change and comment block. It touches no section, key or phase this record governs, and the decision holds unchanged.
Re-verified by `git diff c7b5d5f55..a48ea407a -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-02 (`f7465412de3d0d7a25fc1b6b2c8a72775490616d`)

Tripped by the `sidestr:dreamlab-txbt4` seal. `agentbox.toml` adds the `[sidechain.dreamlab-txbt4]` table, with `enabled = false`. No other key changed. `flake.nix` adds `sidechainChains`, one entry per `[sidechain.<name>]` table. For each table enabled under an enabled `[sidechain]` it bakes three supervisor programs, `sidestr-{producer,mirror,faucet}-<name>`: user devuser, the existing `config/sidechain` runners, and a producer the engine binds to 127.0.0.1:3451. `sidestr-agent` is baked when any faucet is on. The one table shipped is `enabled = false`, so the rendered supervisor text is unchanged. No port, Compose service, volume, user, MCP registration or other program moved. `schema/agentbox.toml.schema.json` adds the `dreamlab-txbt4` object under `sidechain`. No other property changed. No rune, `[vault.tui]` key or notes-window program changed. **Decision unaffected.** `verified_commit` moves to the seal commit. Gates at that commit:

- the manifest validator is valid;
- `check-manifest-catalogue` passes;
- `tests/config/sidechain-genesis.test.sh` passes 7/7 and `sidechain-producer-gates.test.sh` 7/7.

## Re-verification — 2026-10-02 (`6db0ffc8df1e708047c210353f730d1f0427553d`)

Tripped by ADR-2097 (the sidestr payment rail). `agentbox.toml` gains one new table, `[payments.sidestr]` (ADR-2097), placed after `[skills.payment_router]`; no existing key, value or line above it moves; `schema/agentbox.toml.schema.json` gains `payments.properties.sidestr` only. Nothing this record governs is touched, and the decision holds unchanged.
Re-verified by `git diff f7465412d..6db0ffc8d -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-02 (`e434a7a596a3a0518c51b7da107d6e0831891910`)

Tripped by the sidechain health and witness change. `agentbox.toml` changed only in `[voice]`: `enabled` false → true, with a comment, so that the descriptive sidecar state matches the four running agentbox-voice containers (CY-A2, `scripts/ci/check-declared-vs-running.js`). No other key moved. `[vault].tui` is untouched. The manifest validator reports the file valid. Decision and status unchanged.

## Re-verification — 2026-10-02 (`e020264b54c6872ca98995c1adda18b8451a39af`)

Tripped by ADR-2097 (the rail keyed by chain). `agentbox.toml` changes only inside `[payments.sidestr]` (ADR-2097): its comment block, `chain_id` now `sidestr:dreamlab-txbt4`, and `producer_url` dropped in favour of the chain's derived port; `schema/agentbox.toml.schema.json` changes only `payments.properties.sidestr` (`producer_url` optional, `mirror_url` added). Nothing else this record governs is touched, and the decision holds unchanged.
Re-verified by `git diff e434a7a59..e020264b54c6872ca98995c1adda18b8451a39af -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-03 (`055c06ff69b2f53bf38a67d254c048bb03599fc8`)

Tripped by custody X-1 step 1 (W0 `custody/w0-bypasses` and W1 `custody/w1-role-accounts`). `flake.nix` changed only as follows. W0 (`8070c1010`, `6a433e6b3`): `root` loses its `devuser` member, and `[program:docker-read-proxy]` is added (root start, drops to 65534). W1 (`b8c66625a`, `055c06ff6`): role passwd and group lines are appended from `config/role-accounts.json`, `supervisord.roles.conf`, `role-secrets.tsv` and `role-accounts.json` are derived beside the unchanged `supervisord.conf`, and a root-owned `/run/secrets` tmpfs is added (ADR-2122). `agentbox.toml` gains only `[security].role_isolation = false` with its comment (ADR-2122); no other key moved. **D4 amended in effect by custody W0.** The entrypoint no longer adds `/home/devuser/workspace/.cargo/bin` to `PATH` globally: root's boot `PATH` is store-only (a planted binary there ran as root), and devuser shells get the directory *appended* (runtime-env and fish snippets). Window 9 is unaffected for two reasons. With `[vault].tui = "rune"`, rune is baked (`lib/rune.nix`). And `config/tmux-autostart.sh` re-adds the cargo bin via `new-window -e` for the interim fallback. The decision holds, but D4's sentence "the entrypoint adds … to `PATH`" no longer describes root.
Re-verified by `git diff 0919dc39a..055c06ff6 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`d3ff8e9a876e6b026b543f8824487e002e04cfa0`)

Tripped by the G-5 Q15 correction (`custody/w8-key-split`). `agentbox.toml` changed only in the trailing comments of two allowlist entries: `b41654017f…2f7a` is relabelled as the operator's NIP-07 31403 decision signer (it is `[sovereign_mesh.operator].pubkey_hex`), not visionclaw-server, and the `11ed6422…663c` entry in `[interaction_plane.proxy]` notes that its Podkey-vault copy is to be replaced by K_browser. No key, value, table or list member moved. `setup/agentbox.default.toml` received the same comment correction on its `b41654017f…` relay entry and nothing else. `node scripts/agentbox-config-validate.js agentbox.toml` is valid with the same 5 advisory warnings as `origin/main` (`0919dc39a`). Decision and status unchanged.

## Re-verification — 2026-10-03 (`275e12356319a9630846656580d497d53de3d38c`)

Tripped by custody X-1 step 1, W2 (`custody/w2-env-scrub`: `0965a9c8c`, `042115499`, `275e12356`; bypass 3, ROLE secrets out of PID 1's environment). `flake.nix` changes only `[program:tailscale-up]` (a `TAILSCALE_AUTHKEY_FILE` branch that passes `--authkey=file:<path>`; the original branch is unchanged and is the one taken with the flag off) and the `[program:nostr-gateway]` comment. The decision holds.
Re-verified by `git diff 055c06ff6..275e12356 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`3b54129631067277f6363309b01cce485faa027a`, custody integration head)

Tripped by the custody integration (`custody/integration`: W0, W1, W5, W3, W7a, W8, W2, W9 and
the integration resolutions, ADR-2122). Since `275e12356` the governed paths changed as follows. `agentbox.toml` changed only in the trailing comments of two allowlist entries (`d3ff8e9a8`, the Q15 correction: `b4165401` is the operator's decision signer). `flake.nix` gains three things: W5's read-only bake of the sidestr upstream (`lib/sidestr-upstream.nix`, linked at `/opt/agentbox/sidestr/upstream` under `[sidechain].enabled`; `e103f81a7`); the isolated supervisor config renamed `/etc/supervisord.roles.conf` (`760ed01e4`); and a `[program:serve-identity]` block that prints one line and exits 0 while `[security].role_isolation` is off (`b49c62249`). `setup/agentbox.default.toml` changed only in the same allowlist comment (`d3ff8e9a8`).
The Rune window and the vault root it opens are unchanged. The decision holds. Re-verified by `git log 275e12356..3b5412963 -- <verified_paths>`
and the integration gates. Nix was not evaluated in this container; the image is unverified
until the owner's rebuild.

## Re-verification — 2026-10-03 (`32cedf9925ff6de8112fb45e41de048106d0d710`, custody integration CI fix)

Tripped by `32cedf992`, the fix for the PR's clippy and statix failures. `flake.nix` changes by one line in the `[sidechain.*]` normaliser: `parent = c.parent;` becomes `inherit (c) parent;` (statix W04), which evaluates to the same attribute set. Nothing this record governs changes meaning. The decision holds. Re-verified by `git log 3b5412963..32cedf992 -- <verified_paths>`.

## Re-verification — 2026-10-03 (`dc91e092ab646b4a825805b8229602ac8b15bad3`, custody W10)

Tripped by the W10 gap fixes on `custody/integration`. `flake.nix` (`dc91e092a`) gains one let-binding, `roleIsolationBaked = securityCfg.role_isolation or false`, and its inline `/etc/sudoers` lines become a call to `config/bake-devuser-privilege.sh` with that flag; with the flag off (the shipped value) the baked `/etc/group`, `/etc/sudoers` and `/etc/sudoers.d/devuser` are byte-identical (RC-X1-07). Nothing this record governs changes meaning. The decision holds. Re-verified by `git log 32cedf992..dc91e092a -- <verified_paths>`. Nix was not evaluated in this container.

## Re-verification — 2026-10-03 (`f93586b9e52fda0d0b367881e2d2ff3014509faf`, custody W2b/W4)

Tripped by `f93586b9e` (custody W2b and W4: the at-rest migrate/revert and the sidechain state move). `agentbox.toml` changes only in the comment above `[security].role_isolation = false`: it no longer says the identity port and the custody migration are absent, and names what is built (W3, W2b, W4) and what is owed (W3b). No key or value moves. The Rune window and its vault root are untouched. The decision holds. Re-verified by `git log dc91e092a..f93586b9e -- <verified_paths>`.

### Re-verification — 2026-10-03 (vaultSrc repin)

`f93586b9e..33cbb29e8` changes one governed line: `flake.nix` `vaultSrc` moves from VisionClaw `64512141b` to main `94dc0ff60` (`33cbb29e8`, PR #13; ADR-2108 records why). Its one consumer is `lib/vault.nix` (the vault CLI package, `flake.nix:781`); nothing this record governs (ADR-2029 — Rune is the first-class markdown TUI) reads it. The decision holds. Re-verified by `git log f93586b9e..33cbb29e8 -- <verified_paths>`.

### Re-verification — 2026-10-03 (poker house seat, PR #14)

`33cbb29e8..b41d9486c`: `agentbox.toml` gains `[poker_citizen]` (`enabled = true`, key and state under `sidestr/agents`, the forum relay, `daily_cap = 20000`) (`55b9fe9f6`); `flake.nix` bakes `nostr-bbs-poker-citizen` (`lib/poker-citizen.nix`) and a `[program:poker-citizen]` (`user=devuser`) only when `[sidechain].enabled` and `[poker_citizen].enabled`; it opens no listener: it dials the forum relay over `wss` and the local producer at `127.0.0.1:3450` (`55b9fe9f6`); the schema declares the closed `[poker_citizen]` object (`b41d9486c`). Nothing this record governs (ADR-2029 — Rune is the first-class markdown TUI) reads the new table or program. The decision holds. Re-verified by `git log 33cbb29e8..b41d9486c -- <verified_paths>`.

### Re-verification — 2026-10-03 (ab-poker-citizen role)

`b41d9486c..4ea3181b5` changes one governed line: `agentbox.toml` `[poker_citizen].state` becomes a comment (the runner's default is the same path flag-off), for the poker seat's role (`4ea3181b5`). Nothing this record governs (ADR-2029 — Rune is the first-class markdown TUI) reads that key. The decision holds. Re-verified by `git log b41d9486c..4ea3181b5 -- <verified_paths>`.

### Re-verification — 2026-10-03 (key-variable rule)

`4ea3181b5..e3b06d688` changes one governed line: `flake.nix` passes `--env-classes ${./config/custody/env-classes.json}` to the build-time `role-accounts isolate`, which now refuses a devuser program holding a key variable without a role (ADR-2122). Nothing this record governs (ADR-2029 — Rune is the first-class markdown TUI) changes. The decision holds. Re-verified by `git log 4ea3181b5..e3b06d688 -- <verified_paths>`.

### Re-verification — 2026-10-03 (ruflo 3.51.1, Claude Code 2.1.288)

`e3b06d688..daba195e5`: `flake.nix` changes only the `rufloPkg` pin: version 3.51.1, its lock (`config/npm-locks/ruflo-3.51.1.package-lock.json`) and both hashes (`daba195e5`), with the rationale comment. The ruflo closure's bins and extraBins aliases, every gate and every other derivation are unchanged. Nothing this record governs (ADR-2029 — Rune is the first-class markdown TUI; tmux window 9 \"Notes\" opens it at the vault root) changes meaning. The decision holds. Re-verified by `git log e3b06d688..daba195e5 -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.

### Re-verification — 2026-10-03 (ruflo-console gate, `451823ca8`)

`daba195e5..451823ca8`: `agentbox.toml` adds `[toolchains].ruflo_console = false`; `flake.nix` adds the pinned `rufloConsole` input (ruflo v3.51.1, files-only), the `rufloConsolePlugins` bake (only the three mod directories) and its copy into the `agentbox` marketplace under `[toolchains].ruflo_console`, and lets that gate pull in the ruflo closure; the schema declares `toolchains.ruflo_console` (boolean, default false). Nothing this record governs (ADR-2029 — Rune is the first-class markdown TUI; tmux window 9 \"Notes\" opens it at the vault root) changes meaning. The decision holds. Re-verified by `git log daba195e5..451823ca8 -- <verified_paths>`.

### Re-verification — 2026-10-03 (agentic-qe 3.14.7)

`451823ca8..d52d3eeb4`: `flake.nix` changes only the `agenticQePkg` pin: version 3.14.7, its lock and both hashes (`d52d3eeb4`), with the rationale comment. Nothing this record governs (ADR-2029 — Rune is the first-class markdown TUI; tmux window 9 \"Notes\" opens it at the vault root) changes meaning. The decision holds. Re-verified by `git log 451823ca8..d52d3eeb4 -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.

### Re-verification — 2026-10-03 (wrangler 4.147.0)

`d52d3eeb4..341c8bd36`: `flake.nix` changes only the `wranglerPkg` pin: version 4.147.0, its lock and both hashes (`341c8bd36`), with the rationale comment. Nothing this record governs (ADR-2029 — Rune is the first-class markdown TUI; tmux window 9 \"Notes\" opens it at the vault root) changes meaning. The decision holds. Re-verified by `git log d52d3eeb4..341c8bd36 -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.

### Re-verification — 2026-10-03 (mermaid-cli hold note)

`341c8bd36..cff75f7ea`: `flake.nix` changes only the comment above `mermaidCliPkg` (12.0.0 held, re-evaluation recorded); no pin, hash or gate changes (`cff75f7ea`). Nothing this record governs (ADR-2029 — Rune is the first-class markdown TUI; tmux window 9 \"Notes\" opens it at the vault root) changes meaning. The decision holds. Re-verified by `git log 341c8bd36..cff75f7ea -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.

### Re-verification — 2026-10-03 (web-researcher hold note)

`cff75f7ea..09e6271e9`: `flake.nix` changes only a comment in `webResearcherMcpPkg` (v1.49.4 held: needs Go 1.27.1, beyond the pinned nixpkgs); no pin, hash or gate changes (`09e6271e9`). Nothing this record governs (ADR-2029 — Rune is the first-class markdown TUI; tmux window 9 \"Notes\" opens it at the vault root) changes meaning. The decision holds. Re-verified by `git log cff75f7ea..09e6271e9 -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.

### Re-verification — 2026-10-03 (ruflo memory governed, 1fc26c786)

`09e6271e9..1fc26c786`: `flake.nix`: `34f322740` projects `[sidechain].faucet_units`/`faucet_sats` into `[program:sidestr-faucet]`'s environment; `aeca58df6` passes `SIDESTR_PEG_SCRIPT` to the per-chain producer; `bde96a334` adds the `pokerCitizenSeats` map and bakes `[program:poker-citizen-<name>]` per `[poker_citizen.<name>]` (the package gate now counts a seat); `18a85577c` bakes `[program:poker-coach]` under `[poker_coach]`; `b83e0e5d7` adds `findutils` to both producer PATHs; `012bf98f5` adds `rufloGovernedPkg` — `ruflo`/`claude-flow` wrappers that exec `mcp/servers/ruflo-memory-cli.cjs` for `memory` and otherwise run `rufloPkg` with `RUFLO_DAEMON_AUTOSTART=0`, `CLAUDE_FLOW_DISABLE_BRIDGE=1` and `CLAUDE_FLOW_MEMORY_PATH` under `~/.cache` as overridable defaults, `claude-flow-mcp` symlinked through unchanged — and swaps it for `rufloPkg` in the gated package list (ADR-2123). `agentbox.toml`: `34f322740` adds `[sidechain].faucet_units = 1000`/`faucet_sats = 2000`; `29bff6d94`, `5241b28e7` and `aeca58df6` switch `[sidechain.dreamlab-txbt4]` on (`enabled = true`, `interval = 60`, `peg_script`); `bde96a334`/`f2dfc5bfa` add `[poker_citizen.dreamlab-txbt4]` (the BLAKES7 seat on `:3451`, `asset_id`); `18a85577c` adds `[poker_coach]`; `a2ffa05eb` moves `[toolchains].ruflo_console` beside `ruflo` and sets it `true`. `schema/agentbox.toml.schema.json` declares `faucet_units`/`faucet_sats`, `peg_script`, the `[poker_citizen.<name>]` sub-objects and `[poker_coach]` (`bde96a334`, `a2ffa05eb`, `18a85577c`). `lib/rune.nix`, `config/tmux-autostart.sh` and `config/tmux.conf` did not move. Nothing this record decides (ADR-2029 — Rune is the first-class markdown TUI; tmux window 9 "Notes" opens it at the vault root) changed: nothing touches the rune package, the tmux window or the vault root. The decision holds. Re-verified by `git diff 09e6271e9..1fc26c786 -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.

## Re-verification — 2026-10-07 at cca7ea3b151be3ea44907581d40271c714b07dd0

`lib/rune.nix`, `config/tmux-autostart.sh` and `config/tmux.conf` are unchanged since `1fc26c786`. Seventeen commits touch the other governed paths, and none of them touches the Rune gate or window 9. In `flake.nix`, `7dadf61d7` replaces the four fixed `n2c.buildLayer` groups with `lib/image-layers.nix` cadence groups. `runePackages` still enters `allPackages` (`flake.nix:1938`), and that set feeds the `services` layer, so the package is still baked under the gate. `a98aba880` adds `sealmapPkg` to `skillToolPackages`. `cc5f5dcc0`, `2bc789d33` and `feb608318` add the `[program:diagram-review-cron]` block under `[diagram_review].enabled` (ADR-2131). `afc8a0ed6` adds the forum-governance relay and signer env to the management-api program (ADR-2109). `6e4e4a0f8` puts `pokerCitizenPkg` and `nodejs_22` on the faucet PATH. `68a77b1bf`, `1afd80dd1`, `dfbcd69d9` and `57bbd3fad` move `vaultSrc`. In `agentbox.toml`, `afc8a0ed6` adds `[sovereign_mesh.forum_governance]`, `4f09c96b2` adds `reader_role`/`hba_scram` to the ruvector block, and `cc5f5dcc0` adds `[diagram_review]`. Also in `agentbox.toml`: `a449138f2` turns ComfyUI on, `b1e42f148` sets `label_log = false`, and `e4e4f5fb6` raises `zai_max_tokens` to 131072. `setup/agentbox.default.toml` and the schema carry the matching additions only. The gate is unchanged at `flake.nix:899-903` (`vaultTui = vaultCfg.tui or "none"`, `runeActive = vaultTui == "rune"`), and `agentbox.toml:927` still sets `tui = "rune"`. The decision holds.

## Re-verification — 2026-10-13 at `044f1d689`

The decision holds. Every claim below was checked against the code, and the tripped hunks are unrelated to it.

Claims checked:

- lib/rune.nix builds rustPlatform package from the jjohare/rune fork tag v1.5.0-dreamlab.1, cargoBuildFlags -p rune-cli, doCheck=false (amendment 2026-09-25 supersedes Decision 1's v1.4.0)
- flake.nix gates rune on [vault].tui == "rune" (runeActive), lazy import, runePackages in the package set
- config/tmux.conf sets allow-passthrough on and extended-keys on
- config/tmux-autostart.sh _notes_window: gated by AGENTBOX_VAULT_ENABLED and VAULT_TUI (execution off-switch), recovery HOME=$WORKSPACE/.rune-home, window 9 Notes, root = AGENTBOX_NOTES_ROOT else VAULT_WORKING_ROOT else VAULT_ROOT
- agentbox.toml [vault].tui = "rune"

Evidence:

- git diff cca7ea3b1..218dc12c3 -- config/tmux.conf: single hunk adds `set -ga update-environment " COLORTERM LANG LC_ALL"` above the ADR-2029 D3 block; allow-passthrough/extended-keys untouched (still at tmux.conf:26-27 at 218dc12c3).
- flake.nix diff: hunks are ontomark package, sidechain, System One, jev-checkpoints etc.; the rune gate is unchanged: flake.nix:924 `runeActive = vaultTui == "rune";` 925-926 runePkg/runePackages; flake.nix:1971 `++ runePackages`.
- agentbox.toml/default.toml/schema diff has no tui/rune lines; agentbox.toml:1069 `tui = "rune"`.
- git show 218dc12c3:lib/rune.nix: version 1.5.0-dreamlab.1, owner jjohare repo rune, rev 2698873b..., cargoBuildFlags [-p rune-cli], doCheck=false (lib/rune.nix unchanged in the range).
- git show 218dc12c3:config/tmux-autostart.sh lines 30,102-139,190,222 match the described gates and launch line.
- bash tests/tui/notes-launcher.test.sh → 17 passed, 0 failed (ADR recorded 11; suite has grown)

Commands run: `bash tests/tui/notes-launcher.test.sh`

Not checked, and notes: Title and Decision 2 still say the window opens at the vault root; the 2026-09-25 amendment in the same record already corrects this to [vault].working, and the code matches the amendment. Image bake and Rune journal concurrent-edit recovery remain untested (named residual in the ADR); needs a running container.

Checked at `218dc12c3` by reading each claim against the code, not by the staleness diff alone. Stamped at `044f1d689`, which adds only the gate fixes in `config/custody/env-classes.json`, the `check-manifest-catalogue` baseline, `services/agentbox-vex`'s README and licence notice, a stale `agentbox.toml` comment, a stale `paths` example in the ontology-augment docs, and the grounding test's stub.

**Re-verified 2026-10-16 at `efa293b8799b`.** The only change to a governed path is the sidecar-first Blender work (ADR-2142): `agentbox.toml` gains `[skills.spatial_and_3d].blender_local = false`; `flake.nix` narrows one `lib.optionals` condition (`wrapGpuBin pkgs.blender` now needs `blender && blender_local`), adds one `ENABLE_BLENDER_LOCAL` env line and reworks a comment; `schema/agentbox.toml.schema.json` gains the `blender_local` boolean; `management-api/lib/system-manifest.js` gains a `blender-local` catalogue entry and a corrected `blender-mcp` summary. The Rune package and the TUI/tmux wiring are untouched. The decision holds. Re-verified by `git diff <previous verified_commit>..efa293b8799b -- <verified_paths>`; no re-implementation was needed.

**Re-verified 2026-10-17 at `e8d59c23c`.** The only change on a governed path since the previous verification is the flat-vault pages default (agentbox `a2c6d5520`, ADR-2028 amendment; Ontomark ADR-OM-007): `[vault].pages = "."` in `agentbox.toml` and the default manifest, the schema default and description for that key, the entrypoint deriving `VAULT_PAGES`/`VAULT_WORKING_PAGES` from it, and the ontology skills' corpus-verb names (`ontomark find|retrieve|tree`). None of it touches this record's decision. Re-verified by `git diff efa293b87..e8d59c23c -- <verified_paths>`; no re-implementation was needed.

Re-verified 2026-10-17 against `f33c4fc030d199ce957f7ba274d428bc6475c159`: the governed-path delta from the flat-vault amendment is the DeepSeek model/default and MCP metadata refresh plus ownership reconciliation for the OpenCode state directory. The reviewed change preserves this record’s capability, identity, memory, vault and isolation invariants; status axes are unchanged.

Re-verified 2026-10-19 at `dfe78f0766e52ae6cfbae32c395e22c9590d6785`: Reviewed governed-path changes: the flake only repins the vault source; the entrypoint delta corrects the role-isolation class comment; the catalogue makes the baked privilege change rebuild-class. No ingress, retrieval geometry, capability gate, image-delivery or subsystem runtime configuration is changed by those deltas. Existing implementation and activation statuses are retained.

Re-verified 2026-10-19 at `52183d76fde866ab1f05aea524aeea33d8573c3f`: The reviewed flake delta adds the local-cuda-gated stable nvcc link, and the entrypoint/catalogue propagate and describe its scoped host compiler. Backend and wrapper gates pass (23 and 21 assertions); no ingress, role isolation, durable adapter, retrieval or subsystem gate is changed. Image evidence will be regenerated for the new layer closure. Existing status axes are retained.

Re-verified 2026-10-19 at `3acd4fa08f06e2c4543debd46f0ce51605033d3e`: the reviewed delta adds the collaboration and welfare floor (ADR-2144) — one new manifest key `[claude_code].floor`, a floor block and managed-path projection in the entrypoint's instructions and Codex-append sections, two `instructions-project` flags in `agentbox-manifest`, and `config/hooks/decline-recorder.cjs`. No ingress, role isolation, durable adapter, retrieval, skill-routing or compaction mechanism this record governs is changed; its gates pass unchanged. Existing status axes are retained.

Re-verified 2026-10-20 at `61f27d5b375f9838ef7b7334e3f984d0d4a9ea70`: reviewed the governed-path delta for the managed floor (ADR-2144) and alpha.17 forge/proxy launcher (ADR-2145). The schema and capability catalogue now register these settings, with boot-class floor projection and rebuild-class forge/proxy changes. Bridge path dependencies use the same alpha.17 source as the server; the independent core-only registry dependency retains its upstream pin. Claude Code 2.1.304 and Codex 0.163.0 retain the full upstream package resources. Manifest validation, all 94 catalogue gates, 37 targeted Node tests, 12 instruction-layer assertions and skill lint pass. No ingress publication, adapter dispatch, retrieval geometry, mount or role-isolation gate changes. Build and activation evidence is pending; existing status axes are retained.

Re-verified 2026-10-20 at `653b8b6387470eaa3be6c20e6dbd2208e538a985`: reviewed the merged activity-sink registration in the root entrypoint and profile projector, its default-off manifest gate, schema and boot-class catalogue entry. The hook remains inactive; no sink URL, token or new prompt egress is configured. The independent managed floor remains on. Claude Code 2.1.304 and Codex 0.163.0 change pinned CLI resources, not the Jev/factrail hook protocol; their existing replay mechanisms are unchanged. Activity-sink and hook-registration tests pass (50), the Rust projector suite passes (196), manifest validation and all 95 catalogue gates pass, and the generated egress register is in sync. No changed ingress binding, mount, role isolation, retrieval geometry or adapter dispatch. Build and activation checks remain pending. Existing status axes are retained.

Re-verified and deployed 2026-10-20 at `dd6ff7e065a9a2851f7cfa9fa8c71305ce2a8782`: the reviewed flake/Compose delta adds only a root-owned 1 MiB tmpfs at `/etc/claude-code` so boot can project the managed floor on the read-only rootfs. Live file is uid 0, mode 0644, agent-readable and agent-unwritable; the same floor is present in the 13,605-byte Codex instructions. Root and all eight Claude profiles each register the three decline events once. Native pod alpha.17 serves `/forge` (HTTP 200), with testnet policy and zero mirror follows/announce relays; activity sink remains off. Readiness has no degradation, 32 persistent mounts are unchanged, and the other 17 containers are unchanged (speech-to-text was separately rebuilt for its tested marker-ordering fix). The image SBOM/VEX evidence was regenerated for the shipped image; this does not claim an online vulnerability scan or cover the host and sidecars. Existing decision and status axes are retained unless the record explicitly states activation below.


## Re-verification — 2026-10-21

The manifest diff only selects minimal thinking and a 20-minute cap for the final deepsec sweep; feature gates, identity policy, corpus paths and memory geometry are unchanged. The composition diff refreshes locked package/source versions and the Go compiler for web-researcher. Supervisor blocks, ingress bindings, adapter dispatch and persistent mounts are unchanged. The generated Compose file is byte-identical. Manifest validation, the 95 catalogue gates, 45 agent-reconciliation checks and 25 role-supervisor checks pass. This is source verification; image activation and live checks remain separate deployment evidence.

Re-verified at `c8c20341c66feec751fe6234167c220c70fe2ffb`: the only governed code delta is the REUSE
Sphinx builder string correction. Both documentation outputs and all 872
enabled package tests pass; 23 runtime-delivery checks pass. Runtime
boundaries and activation status are unchanged.

Re-verified at `9173cdba6f0a84556bbd4c059db0a7e823aa7a2d`: the governed delta isolates Typepy 1.3.5
and fixes wrapper arguments for host-only sbomnix. Its dependency suites
pass (834 Typepy, 1682 SimpleSQLite), 23 delivery checks pass, and an actual
shipped-path smoke scan emits CycloneDX, SPDX and CSV. Runtime and activation
contracts remain unchanged.

## Re-verification — 2026-10-21 at 73bd631c0

Reviewed the committed change to the Codex home: the parent tmpfs becomes a
named volume; its package volume and credential bind remain independent. No
supervisor, ingress, toolchain, feature-gate, scanner or instruction-projector
code changes. Compose persistence and runtime-delivery checks pass (24 tests),
Compose refresh checks pass (3 tests), and role-supervisor checks pass (25 tests).
This mount migration is explicitly outside fast activation (ADR-2147).

## Re-verification — 2026-10-21 at 395380f71

Reviewed the committed remote-media change against this record. Nix changes
only the ComfyUI MCP dependency closure and its existing builtin/external gates;
`skills/mcp.json` changes only Blender's declared protocol. Blender's optional
local binary, proxy and background-job safety boundaries remain intact. No
identity, ingress, daemon role, instruction projection, persistent mount, scanner
or vendor-routing behavior changes. Media checks pass: 23 Node tests, 12 graph
client tests and 9 downloader tests. Runtime/Compose checks pass (27 tests),
role-supervisor checks pass (25), skills lint and loopback-port checks pass.
Sidecar image activation is tracked separately in the host deployment receipt.

## Re-verification 2026-10-23 at `951ada931`

Tripped by `flake.nix` alone (every other governed path is unchanged since `395380f71`: `git diff 395380f71..HEAD -- <other verified_paths>` is empty). The flake hunks are the eMudhra `cacert` override, the `agenticQePkg` (3.15.10) and `wranglerPkg` (4.151.3) pins, the `rufloConsole` pin move and its `rufloConsolePlugins` name, and `NODE_OPTIONS=--use-openssl-ca` in the container env list. Checked against committed `HEAD` in a detached worktree, not the working tree.

Claims re-read at HEAD: `flake.nix:941-952` gates `runePkg` on `[vault].tui = "rune"` and `:2043-2044` adds `runePackages` to the package list; `lib/rune.nix` (unchanged since `395380f71`; builds the jjohare fork `v1.5.0-dreamlab.1` per the 2026-09-25 amendment, which supersedes Decision 1's pin to `v1.4.0`, with `-p rune-cli` and `doCheck = false`); `config/tmux.conf:26-27` `allow-passthrough on` and `extended-keys on`; `config/tmux-autostart.sh` window 9 Notes. No hunk touches the rune gate. Commands: `grep -nE "rune" flake.nix`, `bash tests/tui/notes-launcher.test.sh` (17 passed, 0 failed). The decision holds.

### Re-verification — 2026-10-29 (ADR-2154 Pele renderer)

`21769a881..d1dd896f4`: `flake.nix` replaces the `mermaidSidecarCliPkg` shell wrapper with `lib/pele.nix` (`pele-render` and an `mmdc` shim, still gated by `[skills.docs].mermaid`) and puts the two commands in `npmCliGatedPackages` in its place; no other gate, pin or supervisor text changes. Nothing ADR-2029 governs changes meaning. The decision holds. Re-verified by reading `git diff 21769a881..d1dd896f4 -- flake.nix` (new hunks only). Nix was not evaluated here; the image is unverified until the host rebuild.


Re-verified 2026-10-29 at `00039efb1e4a70402df86ad19cf76894fe3b9a8f` for ADR-2155. Reviewed the typed-decision activation diff against this record: the changed manifest, bootstrap, catalogue or source-pin hunks do not alter its governing boundary. Existing status axes and runtime evidence limits are retained. No image or service activation is claimed.

Re-verified 2026-10-30 at `29a4b4939`: the agentbox.toml delta is three lines inside [system_one] only (bind 0.0.0.0:8094, network = true, local_only = []); this record's sections are untouched.

Re-verified 2026-10-30 at `cd3a29899`: the delta in schema/agentbox.toml.schema.json is [system_one] only (new `network` and `local_only` properties; `bind` admits 0.0.0.0/RFC 1918); management-api/lib/system-manifest.js gains one entry, `system-one-network`; scripts/agentbox-config-validate.js changes only the [system_one] E080 bind rule. This record's sections are untouched.

Re-verified 2026-10-30 at d0e9ca786: the only change to the governed paths is the new `[system_one].skill_list_at_least` key and its schema property (router runner-up listing, ADR-2091); no section this record governs changed.

Re-verified 2026-10-31 at `b65c3d4ed`. Governed paths changed: `agentbox.toml`: comments only: corpus verbs named as `ontomark`, flat-layout wording (`f4beec643`, `7aa9365d4`); `config/tmux-autostart.sh`: a comment names `ontomark` (`f4beec643`); `flake.nix`: the ontomark comment now names the verbs it owns (`4a07fbfb3`); `schema/agentbox.toml.schema.json`: the `[vault].working` description says pages sit at the working root (`f4beec643`). No section this record governs changed; the decision holds. Re-verified by `git diff d0e9ca786..b65c3d4ed -- <verified_paths>`; no re-implementation was needed. The image carries it at the next rebuild.

Re-verified 2026-10-31 at `97f298db5`: the only delta on this record's governed paths since the previous verification is the sprint-W7 additive work (ADR-2139 Decision 5 `state_budget_tokens`; ADR-2090 `bypass_projects`): new optional keys that default to today's behaviour, in agentbox.toml, schema/agentbox.toml.schema.json, setup/agentbox.default.toml. None of it touches this record's decision. Re-verified by `git diff 753788564..97f298db5 -- <governed paths>`; status axes unchanged.

## Re-verification — 2026-10-31 (`1e41b64b624af97cf49771d08da82fbf3743acbd`)

Tripped by the W8 ADR-sprint changes. Governed-path delta since `753788564`: `agentbox.toml` gains only four `[model_routing.routes]` entries (`diagram-polish`, `diagram-narrative`, `diagram-synthesis`, `seal-review`) and a comment block (ADR-2130); `schema/agentbox.toml.schema.json` widens the `model_routing.routes` host pattern to `claude|codex|loom|zai` and adds those four keys (ADR-2130). No key, table or code path this record decides is touched, so the decision and status axes are unchanged. Judged from the diff (re-runnable: `git diff 753788564..1e41b64b6 -- flake.nix lib/rune.nix config/tmux-autostart.sh config/tmux.conf agentbox.toml setup/agentbox.default.toml schema/agentbox.toml.schema.json`; re-run at integration and the summary above matches it), not by re-running this record's own acceptance checks.

Re-verified 2026-10-31 at `2f15c531b02b8f8393d68d29ce3491712bdd862c` (W7 and W8 integration, `adr-sprint/w78`). Governed-path delta since `97f298db5`: `agentbox.toml`: the four `[model_routing.routes]` diagram routes with their comment block (ADR-2130), and a wording fix on the `bypass_projects` comment (brackets forbidden, scoped to skill routing; ADR-2090); `schema/agentbox.toml.schema.json`: the `model_routing.routes` host pattern widened to `claude|codex|loom|zai` with four route keys (ADR-2130), and the `bypass_projects` item pattern forbidding `[` and `]` with its description scoped to skill routing (ADR-2090). Read from the diff and checked against the merged tree's gates (cargo, jest, validator); nothing it changes is a key, table or code path this record decides, so the decision and status axes are unchanged. Re-run: `git diff 97f298db5..2f15c531b -- agentbox.toml schema/agentbox.toml.schema.json`.

## Re-verification — 2026-11-01 (`cc949bb79`)

Governed-path delta since `2f15c531b` is the RuVector Postgres credential custody change (ADR-2164 amendment 2), nothing else:

- `agentbox.toml`: the two `conninfo` URLs drop the `@@RUVECTOR_PG_PASSWORD@@` placeholder password, with their comments.
- `flake.nix`: removes the claude-flow config template (`claudeFlowConfigJson` and its `cp`) and the baked `RUVECTOR_PG_CONNINFO` image Env entry, and rewords one dream-engine supervisor comment.
- `setup/agentbox.default.toml`: the two `conninfo` URLs drop the `@@RUVECTOR_PG_PASSWORD@@` placeholder password, with their comments.

Nothing this record decides is changed; its status axes are unchanged. Re-run: `git diff 2f15c531b..cc949bb79 -- agentbox.toml flake.nix setup/agentbox.default.toml`.

Re-verified 2026-11-05 at `3beca506c` for ADR-2177: the only change to this record's governed paths since its last stamp is ADR-2177's additive SuperSplat hunk (a gated package set and supervisor block, one toml/schema key, a skill registration); this record's decision is unaffected.

Re-verified 2026-11-10 at `062487bec` (PR #43, `dream-review-ledger`; ADR-2190). Governed-path delta since `e2b49adfc`: `config/tmux-autostart.sh` changes one line, the fallback `dream-engine` tmux session (used only when supervisord does not own the loop), which now creates `/home/devuser/workspace/dream-artefacts` and tees `loop.log` there instead of under `.tmp` (`:463`); `schema/agentbox.toml.schema.json` gains three optional string properties in the `dream_machine` object (`git_author_name`, `git_author_email`, `artefact_dir`, `:2981-2992`); no other property, type or closure in the schema changes; `setup/agentbox.default.toml` gains the same three keys as commented examples in `[dream_machine]` (`:1513-1515`). Window 9, the Rune gate and `_notes_window` are untouched. The decision and status axes are unchanged. Re-run: `git diff e2b49adfc..062487bec -- config/tmux-autostart.sh schema/agentbox.toml.schema.json setup/agentbox.default.toml`.

Re-verified 2026-11-10 at `69d4a8488` (PR #43 review fixes; ADR-2190). Governed-path delta since `062487bec`: `config/tmux-autostart.sh` moves the fallback `dream-engine` tmux session's log from the artefact directory to `/home/devuser/workspace/.agentbox/dream-loop.log` and adds a two-line comment (`:454-465`); nothing else in the script changes; `schema/agentbox.toml.schema.json` rewrites only the `description` strings of the three `dream_machine` keys added at `062487bec` (`git_author_name`, `git_author_email`, `artefact_dir`, `:2981-2992`): the identity becomes a fallback and the artefact directory notes the legacy-path guard; no property, type, default or closure changes; `setup/agentbox.default.toml` rewords the comments on the two commented-out identity keys (`:1513-1514`) to say "fallback"; no live key changes. Window 9, the Rune gate and `_notes_window` are untouched. The decision and status axes are unchanged. Re-run: `git diff 062487bec..69d4a8488 -- config/tmux-autostart.sh schema/agentbox.toml.schema.json setup/agentbox.default.toml`.

Re-verified 2026-11-10 at `571c0ad43` (PR #45, ADR-2191, the Bend toolchain). Governed-path delta since `69d4a8488`: `agentbox.toml` gains `[toolchains].bend = true`; `flake.nix` gains `bendLib` and `bendPackages`, one `++ bendPackages` in `allPackages` and one in the `toolchains` layer group, and `ENABLE_BEND` in the image environment; `schema/agentbox.toml.schema.json` gains the boolean `toolchains.bend`. Every hunk is an addition apart from one re-wrapped line in the `toolchains` layer group. The change adds a gated language toolchain and no listener, published port, mount, volume, supervisor program, secret, identity, model route, vault path, registry entry or Nostr kind, and it alters no existing gate, so what this record decides is not touched. CI on that commit passed the flake evaluation on both architectures, config validation with the TUI round trip, the contract and adapter suites and the custody rehearsal. Re-run: `git diff 69d4a8488..571c0ad43 -- <verified_paths>`.

Re-verified 2026-11-11 at `237178730` (ADR-2192, ADR-2193, ADR-2194 at `04638a618`; ADR-2195 at this commit). Governed-path delta since `571c0ad43`: `agentbox.toml` gains `[skills.routing] scope = "all"` (ADR-2192) and `cad = false`, `cad_print = false` under `[skills.spatial_and_3d]` (ADR-2195); `flake.nix` gains `supervisordLauncher`, listed ahead of `pythonRuntimeEnv` in `pythonBasePackages` (ADR-2193: PID 1 is started by the runtime env's interpreter; the entrypoint's `exec supervisord` line is unchanged), `motionRenderPkg` in `skillToolPackages` (ADR-2194), and the CAD gate (ADR-2195): `cadLib`, `cadEnabled`, two gated additions to `spatialPackages`, a gated `[program:cad-engine]` block bound to `127.0.0.1:3245`, gated `/usr/share/fonts` links and `ENABLE_CAD` in the image environment; `schema/agentbox.toml.schema.json` gains the `scope` enum under `skills.routing` and the `cad` and `cad_print` booleans under `skills.spatial_and_3d`. The changes add a routing scope setting, a launcher for PID 1, one Rust skill tool and a gated-off CAD feature. They add no published port, mount, volume, secret, identity, model route, vault path, registry entry or Nostr kind, and alter no existing gate, so what this record decides is not touched. Run on this commit in the container: the configuration jest suites (294 passed), `skill-lint`, `skill-count-check`, the manifest validator, the egress register check, the secret inventory, the crate licensing check, the role-isolation and runtime-contract shell tests, `python-runtime-path` and `cad-launcher`. The flake was NOT evaluated (no Nix in the container) and no image has been built from it. The decision and status axes are unchanged. Re-run: `git diff 571c0ad43..237178730 -- <verified_paths>`.

Re-verified 2026-11-11 at `1e7d1d2b2`. Governed-path delta since `237178730`: `agentbox.toml` only, where `[skills.spatial_and_3d]` `cad` and `cad_print` go from `false` to `true` (ADR-2195, operator's decision) and their comment is reworded. No other key changes. The gated additions this turns on are the ones the previous note describes as gated off: the CAD launcher, wheelhouse and Xvfb in `spatialPackages`, `[program:cad-engine]`, the `/usr/share/fonts` links and, for `cad_print`, OrcaSlicer. None has been evaluated or built. The manifest validator and `tests/config/cad-launcher.test.sh` (35) pass on this commit.

Re-verified 2026-11-11 at `a1d16473e` (skill-estate audit). Governed-path delta since `1e7d1d2b2`: `agentbox.toml` sets `[system_one.consumers].skill_intent = false` (it doubled each routed turn's input for a blind pick that was never adopted; identical picks on the 86 labelled cases at half the cost) and rewords one comment under `[skills.routing]` (the hook is registered with an 8 s timeout); no other key changes. No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: skill lint and its self-test, skill-count, routing-table, the manifest validator, the router jest suites (104) and configuration jest (301), corpus and parity tests (the corpus's baked-versus-repo comparison fails in this container until the next rebuild carries the new descriptions; CI has no baked tree and skips it). The decision and status axes are unchanged.

Re-verified 2026-11-11 at `924f4282a` (ADR-2196). Governed-path delta since `a1d16473e`: `agentbox.toml` rewords the `[skills.routing].label_log` comment to record that EXP-B8 is over (the key was already `false`); no key changes; `flake.nix` adds `semgrep`, `gitleaks`, `trivy` and `jujutsu` to the ungated `basePackages`; removes `codexMcpPkg`, its `npmServicePackages` entry and its copy into the openai-codex skill folder (the codex CLI, `toolchains.codex` and the codex-plugin-cc payload are unchanged); and gives `[program:podcast-cron]`'s `environment=` PATH util-linux and `vaultPackages` via `lib.makeBinPath`. No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: skill lint (124), skill-count, routing-table, the manifest validator, router and configuration jest, the corpus test (its baked-versus-repo comparison fails in-container until the next rebuild), and the agentbox-manifest and podcast-ingest cargo tests. The Nix changes are not evaluated or built. The decision and status axes are unchanged.

Re-verified 2026-11-11 at `0ed05167b` (ADR-2196, removal of the dead `skills.browser.playwright` switch). Governed-path delta since `924f4282a`: `agentbox.toml` removes `[skills.browser].playwright` and its comment (the key was `false` and drove no skill); `flake.nix` drops `playwright` from the security-exception filter and `ENABLE_PLAYWRIGHT` from the image environment (the playwright skill is gone and local browsers are forbidden here); `schema/agentbox.toml.schema.json` removes the `skills.browser.playwright` property and the `security.exceptions.playwright` block; `setup/agentbox.default.toml` removes the same key. No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: the manifest validator, manifest catalogue, configuration jest (301), agentbox-manifest cargo tests (235), skill lint (124). The flake edits are two whole-line deletions, not evaluated. The decision and status axes are unchanged.

Re-verified 2026-11-11 at `f475e0b8e` (ADR-2196, removal of the dead `skills.browser.qe_browser` switch). Governed-path delta since `0ed05167b`: `agentbox.toml` removes `[skills.browser].qe_browser`; `flake.nix` drops `ENABLE_QE_BROWSER` from the image environment (nothing read it); `schema/agentbox.toml.schema.json` removes the `skills.browser.qe_browser` property; `setup/agentbox.default.toml` removes the same key. No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: the manifest validator (live and default manifests), manifest catalogue, configuration jest (301), the TUI non-interactive validation (5), agentbox-manifest cargo tests (235). The flake edit is one whole-line deletion, not evaluated. The decision and status axes are unchanged.

Re-verified 2026-11-11 at `2c4b365b4` (ADR-2196, second pass). Governed-path delta since `f475e0b8e`: `flake.nix` puts `torch-bin` and `torchvision-bin` inside `pythonRuntimeEnv` behind `[skills.data_science].pytorch` (replacing a bare, unimportable package), adds `openssl.bin`, `gdal`, `pngquant`, `bun` and `manim` to `basePackages`, `trunk`, `cargo-leptos`, `leptosfmt` and `rust-analyzer` to `wasmPackages`, `arnisPkg` (lib/arnis.nix, pinned v3.4.0) to `skillToolPackages`, and drops the lichtfeld comment from the GPU-wrap list. No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: skill lint (123), skill-count, routing-table, manifest validator and catalogue, configuration jest (301), corpus and parity tests (the baked-versus-repo comparison fails in-container until the rebuild), system-one-eval. arnis's source hash was reproduced independently with scripts/nar-hash.py, which also reproduces the pinned StatCraft hash. The Nix is not evaluated or built. The decision and status axes are unchanged.

## Scoped source check — 2026-11-16

The only change to this record's governed paths since its previous `verified_commit` is `25f751250` plus `e188960d9` (a `flake.nix` PATH edit for the same leg) (the diagram-review audit leg: `[diagram_review]` keys `gemini_*` renamed `audit_*` with aliases, `producer_family` added, system-manifest and setup-seed text, a supervisor comment; ADR-2131 amendment of the same date). Checked mechanically: nothing else touched these paths in between. The change does not concern this record's decision, and its claims were not otherwise re-read. Decision and status axes are unchanged.

Re-verified 2026-11-17 at 8c895455a: `agentbox.toml` changes only inside `[system_one]` (`backend` `typesafe` to `laya`, `local_only` filled with eighteen consumers), and `flake.nix` vendors the governance contract module into the management-api and nostr-bridge packages and adds `AGENTBOX_RELAY_ALLOWED_PUBKEYS` to the management-api supervisor environment; this record makes no claim about it.

## Scoped SystemScape mount review — 2026-11-18

Reviewed at `de01d60a408b9eb057a3b6257aabd9f764671c94`; governed deltas: flake.nix.
The rollout adds only the read-only SystemScape settings mount and its boot-time
link, plus the 0.4.0 package pin and exact upstream lock. No published port,
credential, identity, role or adapter authority changes. Package tests (49),
hosts-layer checks (8), actual boot-block fixture and persistent-volume checks
passed. Production mount acceptance remains a separate deployment check;
this source stamp does not promote this record's status axes.

## Re-verification — 2026-11-20 at `f6a87328266381a2f2f1bf6ddf7050ebd72eda49`

Governed delta: `flake.nix` changed in one line, `:3169`: the `[program:nip98-proxy]` supervisor `environment=` gains `NIP98_PROXY_REQUIRE_CONFIG="1"` (W3-05, ADR-2210). One line replaces one line, so no `flake.nix` citation moves, and nothing else in the file changed. This record makes no claim about the proxy's supervisor environment or its config projection. The Decision is unchanged and no claim of this record is falsified by the JOURNAL-LOCK (ADR-2211), W3-05 (ADR-2210) or Podkey-policy (ADR-2212) merges. Commands run: `git diff 2ebc3859c..f6a873282 -- flake.nix lib/rune.nix config/tmux-autostart.sh config/tmux.conf agentbox.toml setup/agentbox.default.toml schema/agentbox.toml.schema.json`. Re-run the diff to reproduce.

## Re-verification — 2026-11-20 at `0913d5458837d8c4d1fa4b5b3e52b70e7975cb5a` (closeout branch)

Governed delta: `flake.nix` changed only in a comment in the generated compose file's header (R-025, the optional `claude-zai` sidecar, `:4164-4169`): comment text, one line longer, so `flake.nix` lines after `:4165` move by +1. No program, port, mount, environment value or derivation changes. Citations in this record to lines after these points are as of their own commit and are not renumbered. Commands run on this commit: `git diff 6a73c5a73..0913d5458 -- <the paths above>` read in full; `node scripts/adr-index-gen.js docs/adr --check`. The Decision and status axes are unchanged and no claim of this record is falsified.

## Re-verification — 2026-11-21 at `aa6c38322068d21b39515feeecc128434612051e` (lost beema key)

Tripped by `fix/beema-key`. The governed delta is three hunks, the same in every record it trips: `agentbox.toml` and `setup/agentbox.default.toml` drop one allowlist entry, the operator's lost older beema key `cd37af94…`, and relabel `b41654017f…` as beema in two trailing comments; the manifest golden fixture drops the same entry. This record was read for any claim about those lines and makes none; its decision is untouched. Checked with `git diff origin/main..aa6c38322 -- agentbox.toml setup/agentbox.default.toml services/agentbox-manifest/tests/golden/live-agentbox.toml` and `cargo test` in `services/agentbox-manifest` (all pass).

## ADR-2214 drift check — 2026-11-22

Compared every governed path changed by `fc95b3877` (ADR-2214). Those changes
move `/home/devuser/.gemini` from a tmpfs to the named volume `agentbox-
antigravity-state`, set `[providers.gemini].auth_mode = "oauth"`, add `gemini`
to the OAuth-capable providers, export `AGENTBOX_ANTIGRAVITY_AUTH_MODE` to the
Antigravity consultant, and correct comments and docs. No value, authority,
boundary or runtime behaviour governed by this decision changes. This is source
verification, not activation.

## Comment-drift check — 2026-11-23 at `469e55367`

Governed delta: `agentbox.toml` changed only in the comment above `[sidechain.dreamlab-txbt4]` (`:2042-2043`): "Off until the lead starts it" becomes "On since 2026-10-03", which matches `enabled = true` and the baked `autostart=true` producer, mirror and faucet programs. It is line-count neutral, so no `agentbox.toml:NNNN` citation moves, and no key or value changes. No decision, status axis or claim of this record is affected. Run: `git diff 59b1aca1c..469e55367 -- <governed paths>` read in full; the agentbox-manifest crate passes `cargo test` and `cargo clippy --all-targets -- -D warnings`, and `scripts/agentbox-config-validate.sh agentbox.toml` reports the manifest valid.

## Re-verification — 2026-11-23 at `06c2f701130aa94edf24a20f9f86de2131a0bcf4`

Governed delta since `469e55367`: `schema/agentbox.toml.schema.json`. `schema/agentbox.toml.schema.json` gains the optional `adapters.connect_timeout_ms` property (ADR-2035: one integer, or a table of per-slot integers, each at least 1) at `:101-145`. It is additive, 45 lines, so lines after `:99` sit 45 lower than at `8db362bc5`; no existing property is changed or tightened. Nothing in the hunk concerns Rune, the notes window or tmux.

Judged from `git diff 469e55367..06c2f7011 -- schema/agentbox.toml.schema.json`, read in full against this record's claims; `node scripts/adr-index-gen.js docs/adr --check`. The Decision and status axes are unchanged and no claim of this record is falsified. Citations in this record to lines after the points above are as of their own commit and are not renumbered.

## Re-verification — 2026-11-23 (2) at `538c223973ee1aa1fb18a7521b5ea91d3e9535ac`

Governed delta since `06c2f7011`: `agentbox.toml`, `flake.nix`, `schema/agentbox.toml.schema.json`, `setup/agentbox.default.toml`. The delta is the poker house seat's optional operator alert (`e59b51980`), plus the seat binary pin (`538c22397`, `lib/poker-citizen.nix`, not a path this record governs). `agentbox.toml` gains one commented-out `# alert_pubkey = ""` line under `[poker_citizen]` (`:2098`); no key or value changes, and lines after `:2095` sit one lower (`role_isolation = false` is now `:2616`, was `:2615`); `flake.nix` gains `pokerCitizenAlert` (`:473`) and the per-seat `alertPubkey` (`:489`), each `unplaceheld (… or "")`, and appends `POKER_CITIZEN_ALERT_PUBKEY` to the `[program:poker-citizen]` and `[program:poker-citizen-<name>]` environment lines only when the value is non-empty (`:3434`, `:3449`); lines after `:468` sit three lower and lines after `:486` four lower; `schema/agentbox.toml.schema.json` declares an optional `alert_pubkey` string (pattern `^([0-9a-fA-F]{64}|npub1[0-9a-z]+)?$`) on `[poker_citizen]` (`:4281`) and on `[poker_citizen.<name>]` (`:4311`); the per-seat object keeps `additionalProperties: false`; lines after `:4277` sit five lower and after `:4302` ten lower; `setup/agentbox.default.toml` gains the same commented-out `# alert_pubkey = ""` line (`:1894`); lines after `:1891` sit one lower. Every hunk is additive: one optional key under `[poker_citizen]` and `[poker_citizen.<name>]` and one environment projection; the seat opens no listener and adds no program, port, mount, volume or manifest gate. Nothing this record decides ("Rune is the first-class markdown TUI; tmux window 9 \"Notes\" opens it at the vault root") reads `alert_pubkey` or `POKER_CITIZEN_ALERT_PUBKEY`. Review trigger: not fired.

Judged from `git diff 06c2f7011..538c22397 -- agentbox.toml flake.nix schema/agentbox.toml.schema.json setup/agentbox.default.toml`, the hunks read in full against this record's claims; `node scripts/adr-index-gen.js docs/adr --check`. The Decision and status axes are unchanged and no claim of this record is falsified. Citations in this record to lines after the points above are as of their own commit and are not renumbered.

## Re-verification — 2026-11-25 at `baad4cdc100777f84f09edce22698fb9573858b9`

Governed delta since `538c22397`: `agentbox.toml` only, one line. `d6b019afb` sets `[features.jev_compaction].cache_warm` from `"compact"` to `"off"` (`agentbox.toml:809`): an idle session near prompt-cache expiry is no longer compacted; threshold compaction (`compact_at_percent`, `compact_at_tokens`) and `enabled = true` (`:802`) are unchanged. The hunk is line-count neutral, so no `agentbox.toml:NNNN` citation moves.

This record makes Rune the markdown TUI in tmux window 9 "Notes" at the vault root. The Rune and tmux keys it cites (`:927`, `:1069`) are untouched. Claim still true.

Checked with `git diff 538c22397..baad4cdc1 -- <verified_paths>` (the one hunk above), a search of this record for `cache_warm`, cache-warm, prompt-cache and idle-compaction claims (none), `scripts/agentbox-config-validate.sh agentbox.toml` (valid, 6 advisory warnings) and `node scripts/adr-index-gen.js docs/adr --check`. Decision and status axes unchanged.

## Re-verification — 2026-11-27 at `b8240a223a8d61a1aecd3df139f0636e3a9f42aa`

Governed delta since `0b8d2b188`: `agentbox.toml` only, one line. `b8240a223` sets `[features.jev_compaction].fallback` from `"rules"` to `"summary"` and extends that line's comment (`agentbox.toml:824`): a compaction that cannot get under the trigger now hands over to Claude Code's built-in summary instead of being installed. The same commit repins factrail to 0.1.3 in `lib/factrail.nix`, which is not a governed path of this record. The hunk is line-count neutral, so no `agentbox.toml:NNNN` citation moves.

This record decides: Rune is the first-class markdown TUI; tmux window 9 \"Notes\" opens it at the vault root. `fallback` under `[features.jev_compaction]` is read only by the factrail projection in `config/entrypoint-unified.sh`; nothing this record decides reads it, and this record makes no claim about the compaction fallback. Claim still true.

Checked with `git diff 0b8d2b188..b8240a223 -- <verified_paths>` (the one hunk above), a search of this record for claims about the compaction `fallback` (none), `scripts/agentbox-config-validate.sh agentbox.toml` (valid, 6 advisory warnings) and `node scripts/adr-index-gen.js docs/adr --check`. Decision and status axes unchanged.
