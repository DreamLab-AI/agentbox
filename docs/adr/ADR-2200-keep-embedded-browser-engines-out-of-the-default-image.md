---
id: ADR-2200
title: Keep embedded browser engines out of the default image
date: 2026-11-12
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 06c2f701130aa94edf24a20f9f86de2131a0bcf4
verified_paths: [agentbox.toml, flake.nix, management-api/lib/system-manifest.js, schema/agentbox.toml.schema.json, services/agentbox-manifest/src/tui_read.rs, services/agentbox-manifest/src/tui_fields.rs, skills/browser/references/latex-diagram-workflows.md]
owner: jjohare
review_trigger: Re-enable local QGIS or CAD printing; change PDF comparison workflow or nixpkgs pin
repo: agentbox
domain: BASELINE-container
relates: [ADR-2132, ADR-2142, ADR-2195]
evidence_class: source+test+runtime
acceptance_boundary: Source gates, schema/setup round-trip tests and browser raster handoff verified; replacement-image inventory excludes the embedded engines and local GIS/slicer packages, activation preserves persistent mounts, and readiness plus CUDA, NVENC, sidecar QGIS and memory checks pass.
---

# ADR-2200 — Keep embedded browser engines out of the default image

Scoped re-verification at `37db0ec52`: browser PDF examples now pass the explicit
page ID required by the live connector. The sidecar-first routing and package
gates are unchanged; the captured argument-contract tests pass.


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



## Scoped deployment review — 2026-11-16

Reviewed at `350772de92685339dfff117e66088d8adeb44bec`; governed changes since the prior stamp: `agentbox.toml`. The reviewed rollout is limited to the journal/review integration, its Codex cron PATH and the operator-approved zero-budget audit hold. The guard refuses even a zero estimate; no model is called by its tests. Review/transport tests (83), journal tests (43) and cron checks (21) pass. Existing decision/status axes and unrelated acceptance limits remain. In particular, the Codex audit stays off until turn/spend confinement is implemented; this is not its activation receipt.


## Context

Cold-build inspection found QtWebEngine through local QGIS/PyQt6 and WebKitGTK
through both OrcaSlicer and diff-pdf/wxWidgets. QGIS already runs in the GUI
sidecar and browser automation has a separate browsercontainer. Recompiling
these engines on the shared build/data disk delays unrelated Agentbox changes.

## Decision

Keep `qgis = true` for the existing sidecar MCP proxy, with `qgis_local = false`
to omit the local binary and PyQt closure. An absent local flag preserves the
old package behaviour. Register the new gate as rebuild-class, including schema
and setup read/write support. Keep core CAD on and `cad_print = false`.

Remove diff-pdf from the base package set. Route PDF visual comparison through
the existing browser skill: Poppler rasterises selected pages, the shared
exchange volume carries artifacts, and browser-gpu captures/reviews them.
Do not claim visual inspection replaces a deterministic pixel-equality test.
No new network listener or browser sidecar rebuild is needed.

## Consequences

The default image needs neither embedded browser engine. Local QGIS workflows
must use the sidecar; local slicing is unavailable until explicitly re-enabled.
Browser and GUI sidecar lifecycles, profiles and data volumes remain independent.
The source/preparation checks must verify both engines are absent from the
remaining plan; activation and runtime health are separate release evidence.

## Verification

At the original implementation commit: manifest validation passed; the manifest
crate passed 236 tests (including QGIS sidecar-only round-trip and old-default
compatibility); lifecycle/catalogue tests passed 29, role-supervisor tests 25,
agent reconciliation 45, instruction layers 12, and skill lint passed for all
123 skills. The Nix remaining plan contains neither QtWebEngine nor WebKitGTK.

Live GUI health passed Blender, QGIS and DCC checks. A one-page PDF generated in
Agentbox was rasterised with Poppler into the shared exchange volume, loaded
in a fresh browsercontainer CDP tab and screenshotted (992 by 1404 raster).
The temporary tab was closed; existing tabs and sidecar profiles were untouched.
This proves the file handoff, not pixel-equality or replacement-image health.

Re-verified at `d0fe1e147367ca068ff5e5e296d842ec689a3330` after a governed-path change:
`flake.nix` gives gjs 1.88.1 a writable XDG cache during checks. All 77 upstream
GJS tests then passed, with none disabled. This changes no GIS/PDF gate, proxy,
mount or image package selection; the earlier gate and handoff evidence still
applies. Original implementation: `a1b5e62dce3e0d34644f5ac11acdacfb0ce0f38d`.

Activated on 2026-11-13 from the verified commit above, image ID
`sha256:2287a21f679082783c71e997ac991792c272a148e0ec6bf019977194070d736c`.
The actual `image.layers.paths` inventory contains no QtWebEngine, WebKitGTK,
QtWebKit, WPE WebKit, diff-pdf, OrcaSlicer or local versioned QGIS package.
Other Qt libraries are not excluded by this decision. The five layers total
37.45 GiB uncompressed. Activation checked identical persistent mounts against
the prepared receipt; retired AoE profile data remains retained separately.
After startup settling, readiness has no degraded checks and the MCP hub,
Nostr gateway and both sidechain producers are RUNNING. Executed probes pass
CUDA tensor allocation, FFmpeg NVENC (640 by 480), sidecar QGIS framed ping,
RuVector MCP `memory_health` and a Gemini Hydrogen consultant turn. These
checks do not claim a new PDF pixel-equality test or a sidecar GPU training run.

Re-verified on 2026-11-14 for the skill and memory update at `verified_commit`:
the new image `sha256:ceeb743c024961d0d0e19a271737bd20b2b20b8c647f5361ff4eea206d94117f`
still excludes all packages named above from its actual layer paths. Platform,
toolchain and CLI layer digests are unchanged. Mount equality, settled readiness,
CUDA allocation, NVENC and the sidecar QGIS ping pass again; no sidecar was recreated.

## Scoped source check — 2026-11-16

The only change to this record's governed paths since its previous `verified_commit` is `25f751250` plus `e188960d9` (a `flake.nix` PATH edit for the same leg) (the diagram-review audit leg: `[diagram_review]` keys `gemini_*` renamed `audit_*` with aliases, `producer_family` added, system-manifest and setup-seed text, a supervisor comment; ADR-2131 amendment of the same date). Checked mechanically: nothing else touched these paths in between. The change does not concern this record's decision, and its claims were not otherwise re-read. Decision and status axes are unchanged.

Re-verified 2026-11-17 at 8c895455a: `agentbox.toml` changes only inside `[system_one]` (`backend` `typesafe` to `laya`, `local_only` filled with eighteen consumers), and `flake.nix` vendors the governance contract module into the management-api and nostr-bridge packages and adds `AGENTBOX_RELAY_ALLOWED_PUBKEYS` to the management-api supervisor environment; this record makes no claim about it.

## Scoped SystemScape mount review — 2026-11-18

Reviewed at `de01d60a408b9eb057a3b6257aabd9f764671c94`; governed deltas: flake.nix.
The reviewed source delta is limited to the read-only SystemScape settings mount
and its boot-time link, plus the 0.4.0 package pin and exact upstream lock.
No published port, credential, identity, role or adapter authority changes.
Package tests (49), hosts-layer checks (8), actual boot-block fixture and
persistent-volume checks passed. Production mount acceptance remains separate;
this scoped review does not re-audit unrelated history or promote status axes.

## Re-verification — 2026-11-20 at `9263a39761c0c69e651e77ec1c91be33f015a1b5`

Governed delta: `skills/browser/references/latex-diagram-workflows.md` now uses `file:///home/devuser/exchange/...` paths and says the exchange volume is `/home/devuser/exchange` in both Agentbox and the sidecar, with `$HOME/gui-tools` kept as the Agentbox alias (ADR-2207 D2, D8). The claim of this record, that PDF visual review goes Poppler raster → shared exchange volume → browser-gpu with no local diff-pdf or embedded engine, still holds and is now stated with one path. This branch adds no browser engine to the image. The record's "no browser sidecar rebuild is needed" described its own change; ADR-2207's rebuild is a separate, owner-run activation. The Decision is unchanged and no claim of this record is falsified by the ADR-2207 sidecar refresh. Commands run: `git diff de01d60a4..9263a3976 -- agentbox.toml flake.nix management-api/lib/system-manifest.js schema/agentbox.toml.schema.json services/agentbox-manifest/src/tui_read.rs services/agentbox-manifest/src/tui_fields.rs skills/browser/references/latex-diagram-workflows.md`. Re-run the diff to reproduce.

## Re-verification — 2026-11-20 at `f6a87328266381a2f2f1bf6ddf7050ebd72eda49`

Governed delta: `flake.nix` changed in one line, `:3169`: the `[program:nip98-proxy]` supervisor `environment=` gains `NIP98_PROXY_REQUIRE_CONFIG="1"` (W3-05, ADR-2210). One line replaces one line, so no `flake.nix` citation moves, and nothing else in the file changed. This record makes no claim about the proxy's supervisor environment or its config projection. The record keeps embedded browser engines out of the default image; the changed line adds no package. The Decision is unchanged and no claim of this record is falsified by the JOURNAL-LOCK (ADR-2211), W3-05 (ADR-2210) or Podkey-policy (ADR-2212) merges. Commands run: `git diff 37db0ec52..f6a873282 -- agentbox.toml flake.nix management-api/lib/system-manifest.js schema/agentbox.toml.schema.json services/agentbox-manifest/src/tui_read.rs services/agentbox-manifest/src/tui_fields.rs skills/browser/references/latex-diagram-workflows.md`. Re-run the diff to reproduce.

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

Governed delta since `469e55367`: `schema/agentbox.toml.schema.json`. `schema/agentbox.toml.schema.json` gains the optional `adapters.connect_timeout_ms` property (ADR-2035: one integer, or a table of per-slot integers, each at least 1) at `:101-145`. It is additive, 45 lines, so lines after `:99` sit 45 lower than at `8db362bc5`; no existing property is changed or tightened. The browser-engine switches and the `skills.browser` schema are untouched.

Judged from `git diff 469e55367..06c2f7011 -- schema/agentbox.toml.schema.json`, read in full against this record's claims; `node scripts/adr-index-gen.js docs/adr --check`. The Decision and status axes are unchanged and no claim of this record is falsified. Citations in this record to lines after the points above are as of their own commit and are not renumbered.
