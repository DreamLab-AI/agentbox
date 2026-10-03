---
id: ADR-2029
title: "Rune is the first-class markdown TUI; tmux window 9 \"Notes\" opens it at the vault root"
date: 2026-09-02
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 32cedf9925ff6de8112fb45e41de048106d0d710
verified_paths: [flake.nix, lib/rune.nix, config/tmux-autostart.sh, config/tmux.conf, agentbox.toml, setup/agentbox.default.toml, schema/agentbox.toml.schema.json]
owner: jjohare
review_trigger: a Rune release that changes its CLI (`-w`), its keyboard-protocol requirement, or its licence; or the AoE plane absorbing note editing
repo: agentbox
domain: BASELINE-container
lineage: ADR-2003 (manifest-gated Nix composition), legacy ADR-042 (AoE Sessions window and its presence-detect fallback pattern), lib/systemscape.nix (pinned buildRustPackage precedent)
---

# ADR-2029 — Rune is the first-class markdown TUI

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
   `fetchFromGitHub` pinned to tag `v1.4.0`, `cargoBuildFlags = ["-p" "rune-cli"]`,
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
   (built with `cargo install --git https://github.com/aka-rider/rune --tag
   v1.4.0 rune-cli`) satisfies the presence check; the entrypoint adds
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

## Amendment 2026-09-25 — DreamLab fork; window 9 opens the working vault

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
