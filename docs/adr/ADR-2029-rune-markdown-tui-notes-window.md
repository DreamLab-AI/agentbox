---
id: ADR-2029
title: "Rune is the first-class markdown TUI; tmux window 9 \"Notes\" opens it at the vault root"
date: 2026-09-02
decision_status: proposed
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit:
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

**Acceptance condition:** Test mode-none with a binary present, missing/present vault, retained fallback binary, writable/unwritable recovery home, concurrent edits and restart recovery. Decide whether none is a package-selection setting or an execution off-switch, and expose that distinction to the operator. Reopen on resolver, consumer, launcher, storage or TUI changes. Both shell files pass syntax checking; no live terminal/editor or image activation test ran. See the [vault review](../../../../VisionFlow/docs/estate-review/authored-vault-transition.md#runtime-path-overrides-and-notes-launch) and [source/probe receipt](../../../../VisionFlow/docs/estate-review/evidence/vault-path-probe.json).

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
