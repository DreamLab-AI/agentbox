---
id: ADR-2148
title: Typed remote media control planes alongside existing bridges
date: 2026-10-21
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: edf9118a73ca6699b4c9888eb2f5efe29729f6dc
verified_paths: [flake.nix, comfyui-sidecar/Dockerfile, docker-compose.comfyui.yml, docker-compose.gui-tools.yml, gui-tools-sidecar, skills/blender/tools, skills/comfyui/mcp-server, skills/comfyui/scripts, skills/comfyui/models/stopmotion-candidates.json]
owner: jjohare
review_trigger: media control-plane protocol, sidecar dependencies, workflow state handling or model provisioning changes
repo: agentbox
domain: BASELINE-container
---

# ADR-2148: Typed remote media control planes alongside existing bridges


## Scoped cache-hash verification — 2026-11-27

The complete governed delta since the previous stamp is eight `npmDepsHash`
assignments in `flake.nix`, recomputed from the already-committed security
lockfiles using the pinned nixpkgs prefetch tool. No source, feature gate,
supervisor command, mount, credential or policy changes in this delta.
Factrail projection (8), migration/delivery tests (33), and setup/advisor checks
(26) pass. This verifies source alignment; deployment acceptance is separate.

## Verification ancestry repair — 2026-11-27

The previous stamp named the pre-merge dependency-update commit `1ea91deb2`,
which is not an ancestor of main. Every declared `verified_paths` file is
byte-identical between that commit and this main revision (`git diff` is empty).
Anchor the same source verification to main; no decision or activation claim changes.

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

## Scoped source verification — 2026-11-20

Reviewed the governed-path delta through `2ebc3859c77fce7996eb584d78a2b89c286d72c2` against the
[core-tool and browser source review](../estate-closeout/2026-11-20/core-tools-and-browser-source-review.md).
The change is limited to pinned tool packaging, the existing MetaHarness gate's
offline CLI, descriptive schema/catalogue text, bounded System-pane startup,
and honest classification of existing credentials. It changes no adapter,
listener, role authority, model policy or retrieval geometry. Existing decision,
implementation and activation axes and unrelated acceptance limits remain;
this is not a new whole-record runtime or role-isolation rehearsal.


## Scoped source check — 2026-11-14

Reviewed at `0b97c79c2a2cab3a72e165a8110fc89392611014`. ComfyUI moves to pinned 0.45.0 and adds five pinned utility packs under installed-package constraints. The GUI sidecar consumes the shared Blender 5.3.0 checksum pin from the repository-root build context, restricted by its Dockerfile-specific ignore file, and launches OpenGL for VirtualGL. ComfyUI's host publish is now explicitly loopback. DCC negotiation/job handling sources are unchanged. Thirty media adapter and 71 ComfyUI pipeline/download fixtures pass; source port/listener gates pass. No image rebuild, model download or live GPU acceptance is claimed.


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

## Deployment verification — 2026-10-30 (SpEdE)

Corrected the build-only version probe to read `plyfile` distribution metadata;
the module has no `__version__`. The image built with gsplat 1.5.3 ahead of time
against Torch 2.14.0+cu130. After idle-queue recreation, the existing model,
input, output and user volumes remained mounted. `verify-spede.sh` passed:
33 SpEdE classes, the agentbox_video and required core nodes, prebuilt extension
identity, one headless OpenCV distribution, and the synthetic A6000 GPU fixture
(4,800 Gaussians, eight cameras, non-empty alpha and contributors). Agentbox's
HTTP client and VisionClaw both reached the sidecar. No model-weight generation,
photoreal quality or legacy-runtime parity is claimed by this smoke test.

## Re-verification — 2026-10-30 at ed921e56b (empty ComfyUI POST bodies)

The client now treats an empty 200 body from `/queue`, `/interrupt` and `/free` as success. Owned-job cancel still sends `queue delete` or an id-scoped interrupt, never a bare `/interrupt`; history stays the terminal authority; no weights in the image.

## Re-verification — 2026-10-30 at d4fefe869 (gsplat C++20 flag)

The sidecar Dockerfile now patches gsplat's nvcc `-std=c++17` to `-std=c++20` so it builds against torch 2.14. Re-checked: no model weights are baked into the image (provisioning still runs only through `download_video_models.py` into the models volume), and job submission, history-as-authority and owned-only cancellation are untouched.

## Re-verification — 2026-10-30 at b0c9f064e (SpEdE, review fixes)

Re-stamped at 310fa19a0 after pinning the gsplat build tools and plyfile; no invariant changed.

Re-checked after the SpEdE node pack, the CUDA 13.0 base move and two review-fix rounds. Weights stay out of the image: the Dockerfile copies only the provisioning script, and the new `spede`, `spede-replace` and `face-identity` profiles download at pinned revisions with sha256. Cancellation stays job-scoped (`comfy_client.py` `cancel`: queue-delete when pending, `/interrupt` with the receipt's `prompt_id` when running, refused for a foreign running job). `safe_free` is best effort and reports `success:false` when skipped or when a job appeared; `HF_TOKEN` is sent only to Hugging Face URLs and never on redirects.

## Re-verification — 2026-10-30 at 5a6bf94c5 (ADR-2163 tooling)

Reviewed the governed-path diff from `358e5d32c` to `5a6bf94c5395c494d9a14f70c6b888d7f1497239`. The changes stay inside this record's decision:
- History remains the terminal authority. The new Python `cancel` deletes or interrupts only an owned `prompt_id` and never issues a bare interrupt.
- Idle-model unloading is strengthened: `safe_free` requires an idle queue before and after `/free` and issues one free.
- Live node-schema discovery gains a manifest capability snapshot that reads both `COMBO` wire forms, polled after `/system_stats`.
- The sidecar image gains the `agentbox_video` node pack and swaps the GUI OpenCV wheel for `opencv-python-headless==5.0.0.93`. No weights or credentials are baked in.
- Model provisioning stays pinned and hash-verified: a `face-identity` profile (opencv_zoo YuNet/SFace) is added, and explicit-URL downloads never carry `HF_TOKEN`.

Validation: `test_comfy_client.py` and `test_download_video_models.py` (29 OK), `server.test.js` (9/9) and the node pack (55 OK). The image rebuild and live sidecar are not re-run, so this does not claim new runtime acceptance.

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

Date: 2026-10-21
Status: Accepted

## Context

Blender runs in the GUI GPU sidecar and ComfyUI in its own GPU sidecar. The
existing Blender client was a legacy JSON/TCP bridge despite being registered
as MCP. ComfyUI's MCP dependencies were baked only for builtin mode, leaving
external-mode registrations unable to load the SDK. Old convenience recipes
also assumed models absent from the current sidecar.

## Decision

Retain the Blender socket/background-job path and add MCP stdio negotiation,
discovery and exact frame evaluation. Install pinned DCC-MCP packages in the
GUI sidecar as an additional typed Streamable HTTP/REST plane, enabled by
`DCC_MCP_ENABLED`, exposed only within its existing container network on 9881.
Retain the existing 9876 bridge if the candidate fails to start.

Build the existing ComfyUI MCP adapter for either builtin or enabled external
ComfyUI. Use native HTTP/WebSocket for remote jobs and media, with history as
the terminal authority and durable receipts across observation timeouts.
Remove unsupported hard-coded image/video convenience tools. Add live node
schema discovery, queue inspection and idle-model unloading.

Keep model provisioning separate from image builds and persistent model
volumes. Extend pinned, hash-verified profiles with H3 clay and LTX-2.5 layout;
gated downloads require accepted model access through runtime credentials.
Never bake credentials into images. Phase GPU use using the existing skills.

## Consequences and validation

The working services have completed two Blender-endpoint H3 clips. Real MCP
clients have inspected the visible Blender scene through both bridges and
retrieved completed ComfyUI job status. Short clips prove integration, not
production quality or speech accuracy. The optional official Comfy MCP and
Blenderwright remain source-reviewed alternatives. See the skill references
and research chapter 15 for evidence and remaining experiments.

Rebuild Agentbox and the sidecars to persist these changes; a live hot update
alone is not deployment evidence.

## Deployment verification — 2026-10-21

Rebuilt and activated Agentbox, ComfyUI and the GUI sidecar. ComfyUI's pinned
core/LTXVideo/BFS revisions import successfully; its MCP adapter negotiates and
reads the live queue, CUDA allocation works, and all campaign-required nodes are
present. Model/input/output/user mounts match the previous container and the
independent provisioning worker retains its container identity. Model download
completion and workflow inference are separate from these deployment checks.

Blender 5.2.2 LTS serves the raw bridge and the typed gateway. An MCP client
discovers the running instance, loads the scene skill and reads session info;
the restored scene retains nine objects, frame 49 and 25 fps. QGIS and D-Bus
are healthy. Expose the pinned native gateway executable on PATH: an embedded
fallback is not equivalent deployment evidence. Quartz and OpenDSS now resolve
in separate environments, both passing dependency checks and import/engine
smokes. The Arch base is pinned to the digest used for this deployment.

Re-verified 2026-10-22 at `0382cc4b5e34f75a62184bf350f865533010dc52`: reviewed the delta adding an independent, opt-in Isaac Sim lifecycle and live-class service catalogue entry, the 130th routed skill, pinned regional ComfyUI nodes/model metadata, and Blender background Python failure propagation. Existing ingress, role isolation, instruction projection, durable adapters, retrieval geometry, System One selection and image evidence boundaries are unchanged. Isaac runner/contract (15), GPU picker, launcher selection, Blender bridge (19), role supervisor (25), skill lint and catalogue checks pass. Isaac vendor-image and fixture verification remains staged until executed.

Re-verified 2026-10-23 at `951ada931e235ad45b61b2bef90b7e5c76f8d76c`: flake.nix delta does not touch the media closure. Re-read at HEAD: `comfyuiMcpPkg` (flake.nix:910) and its builtin/external gate (flake.nix:931) are unchanged. The sidecar Dockerfiles, compose files and live deployment checks in the record are not covered by this flake-only trip and were not re-run.

### Re-verification — 2026-10-29 (ADR-2154 Pele renderer)

`21769a881..d1dd896f4`: `flake.nix` replaces the `mermaidSidecarCliPkg` shell wrapper with `lib/pele.nix` (`pele-render` and an `mmdc` shim, still gated by `[skills.docs].mermaid`) and puts the two commands in `npmCliGatedPackages` in its place; no other gate, pin or supervisor text changes. Nothing ADR-2148 governs changes meaning. The decision holds. Re-verified by reading `git diff 21769a881..d1dd896f4 -- flake.nix` (new hunks only). Nix was not evaluated here; the image is unverified until the host rebuild.


Re-verified 2026-10-29 at `00039efb1e4a70402df86ad19cf76894fe3b9a8f` for ADR-2155. Reviewed the typed-decision activation diff against this record: the changed manifest, bootstrap, catalogue or source-pin hunks do not alter its governing boundary. Existing status axes and runtime evidence limits are retained. No image or service activation is claimed.

Re-verified 2026-10-31 at `b65c3d4ed`. Governed paths changed: `flake.nix`: the ontomark comment now names the verbs it owns (`4a07fbfb3`). No section this record governs changed; the decision holds. Re-verified by `git diff f71d3420e..b65c3d4ed -- <verified_paths>`; no re-implementation was needed. The image carries it at the next rebuild.

Re-verified 2026-11-04 at `65778e973`. Governed paths changed by ADR-2175 (image-to-splat): `comfyui-sidecar/Dockerfile` bakes four pinned node packs and a hash-pinned SphereSfM bundle; `skills/comfyui/scripts` adds `splat_pipeline.py`, `ui_to_api.py`, `files`-kind outputs with sha256 in `comfy_client.py`, and pinned `splat-*` profiles with deterministic derivation in `download_video_models.py`. The decision holds: jobs stay native HTTP with history as terminal authority and durable receipts, models stay out of the image in pinned hash-verified profiles, and the gated Matrix-3D download uses runtime `HF_TOKEN` only. Rebuilt image verified by `verify-splatkit.sh` and `verify-spede.sh` (ALL PASS).

## Re-verification — 2026-11-01 (`cc949bb79`)

Governed-path delta since `753788564` is the RuVector Postgres credential custody change (ADR-2164 amendment 2), nothing else:

- `flake.nix`: removes the claude-flow config template (`claudeFlowConfigJson` and its `cp`) and the baked `RUVECTOR_PG_CONNINFO` image Env entry, and rewords one dream-engine supervisor comment.

Nothing this record decides is changed; its status axes are unchanged. Re-run: `git diff 753788564..cc949bb79 -- flake.nix`.

Re-verified 2026-11-05 at `3beca506c` for ADR-2177: the only change to this record's governed paths since its last stamp is ADR-2177's additive SuperSplat hunk (a gated package set and supervisor block, one toml/schema key, a skill registration); this record's decision is unaffected.

Re-verified 2026-11-10 at `571c0ad43` (PR #45, ADR-2191, the Bend toolchain). Governed-path delta since `e2b49adfc`: `flake.nix` gains `bendLib` and `bendPackages`, one `++ bendPackages` in `allPackages` and one in the `toolchains` layer group, and `ENABLE_BEND` in the image environment. Every hunk is an addition apart from one re-wrapped line in the `toolchains` layer group. The change adds a gated language toolchain and no listener, published port, mount, volume, supervisor program, secret, identity, model route, vault path, registry entry or Nostr kind, and it alters no existing gate, so what this record decides is not touched. CI on that commit passed the flake evaluation on both architectures, config validation with the TUI round trip, the contract and adapter suites and the custody rehearsal. Re-run: `git diff e2b49adfc..571c0ad43 -- <verified_paths>`.

Re-verified 2026-11-11 at `237178730` (ADR-2192, ADR-2193, ADR-2194 at `04638a618`; ADR-2195 at this commit). Governed-path delta since `571c0ad43`: `flake.nix` gains `supervisordLauncher`, listed ahead of `pythonRuntimeEnv` in `pythonBasePackages` (ADR-2193: PID 1 is started by the runtime env's interpreter; the entrypoint's `exec supervisord` line is unchanged), `motionRenderPkg` in `skillToolPackages` (ADR-2194), and the CAD gate (ADR-2195): `cadLib`, `cadEnabled`, two gated additions to `spatialPackages`, a gated `[program:cad-engine]` block bound to `127.0.0.1:3245`, gated `/usr/share/fonts` links and `ENABLE_CAD` in the image environment. The changes add a routing scope setting, a launcher for PID 1, one Rust skill tool and a gated-off CAD feature. They add no published port, mount, volume, secret, identity, model route, vault path, registry entry or Nostr kind, and alter no existing gate, so what this record decides is not touched. Run on this commit in the container: the configuration jest suites (294 passed), `skill-lint`, `skill-count-check`, the manifest validator, the egress register check, the secret inventory, the crate licensing check, the role-isolation and runtime-contract shell tests, `python-runtime-path` and `cad-launcher`. The flake was NOT evaluated (no Nix in the container) and no image has been built from it. The decision and status axes are unchanged. Re-run: `git diff 571c0ad43..237178730 -- <verified_paths>`.

Re-verified 2026-11-11 at `924f4282a` (ADR-2196). Governed-path delta since `237178730`: `flake.nix` adds `semgrep`, `gitleaks`, `trivy` and `jujutsu` to the ungated `basePackages`; removes `codexMcpPkg`, its `npmServicePackages` entry and its copy into the openai-codex skill folder (the codex CLI, `toolchains.codex` and the codex-plugin-cc payload are unchanged); and gives `[program:podcast-cron]`'s `environment=` PATH util-linux and `vaultPackages` via `lib.makeBinPath`. No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: skill lint (124), skill-count, routing-table, the manifest validator, router and configuration jest, the corpus test (its baked-versus-repo comparison fails in-container until the next rebuild), and the agentbox-manifest and podcast-ingest cargo tests. The Nix changes are not evaluated or built. The decision and status axes are unchanged.

Re-verified 2026-11-11 at `0ed05167b` (ADR-2196, removal of the dead `skills.browser.playwright` switch). Governed-path delta since `924f4282a`: `flake.nix` drops `playwright` from the security-exception filter and `ENABLE_PLAYWRIGHT` from the image environment (the playwright skill is gone and local browsers are forbidden here). No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: the manifest validator, manifest catalogue, configuration jest (301), agentbox-manifest cargo tests (235), skill lint (124). The flake edits are two whole-line deletions, not evaluated. The decision and status axes are unchanged.

Re-verified 2026-11-11 at `f475e0b8e` (ADR-2196, removal of the dead `skills.browser.qe_browser` switch). Governed-path delta since `0ed05167b`: `flake.nix` drops `ENABLE_QE_BROWSER` from the image environment (nothing read it). No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: the manifest validator (live and default manifests), manifest catalogue, configuration jest (301), the TUI non-interactive validation (5), agentbox-manifest cargo tests (235). The flake edit is one whole-line deletion, not evaluated. The decision and status axes are unchanged.

Re-verified 2026-11-11 at `2c4b365b4` (ADR-2196, second pass). Governed-path delta since `f475e0b8e`: `flake.nix` puts `torch-bin` and `torchvision-bin` inside `pythonRuntimeEnv` behind `[skills.data_science].pytorch` (replacing a bare, unimportable package), adds `openssl.bin`, `gdal`, `pngquant`, `bun` and `manim` to `basePackages`, `trunk`, `cargo-leptos`, `leptosfmt` and `rust-analyzer` to `wasmPackages`, `arnisPkg` (lib/arnis.nix, pinned v3.4.0) to `skillToolPackages`, and drops the lichtfeld comment from the GPU-wrap list. No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: skill lint (123), skill-count, routing-table, manifest validator and catalogue, configuration jest (301), corpus and parity tests (the baked-versus-repo comparison fails in-container until the rebuild), system-one-eval. arnis's source hash was reproduced independently with scripts/nar-hash.py, which also reproduces the pinned StatCraft hash. The Nix is not evaluated or built. The decision and status axes are unchanged.

## Scoped source check — 2026-11-16

The only change to this record's governed paths since its previous `verified_commit` is `25f751250` plus `e188960d9` (a `flake.nix` PATH edit for the same leg) (the diagram-review audit leg: `[diagram_review]` keys `gemini_*` renamed `audit_*` with aliases, `producer_family` added, system-manifest and setup-seed text, a supervisor comment; ADR-2131 amendment of the same date). Checked mechanically: nothing else touched these paths in between. The change does not concern this record's decision, and its claims were not otherwise re-read. Decision and status axes are unchanged.

Re-verified 2026-11-17 at 8c895455a: `flake.nix` vendors the governance contract module into the management-api and nostr-bridge packages and adds `AGENTBOX_RELAY_ALLOWED_PUBKEYS` to the management-api supervisor environment; the GUI sidecar's three host publishes (5905, 9876, 9877) in `docker-compose.gui-tools.yml` now bind `${AGENTBOX_SIDECAR_BIND:-127.0.0.1}` instead of `0.0.0.0` and `gui-tools-sidecar/README.md` documents the variable; the record decides the control planes and states no host publish address, and the DCC-MCP plane on 9881 is still container-network only; this record makes no claim about it.

## Scoped SystemScape mount review — 2026-11-18

Reviewed at `de01d60a408b9eb057a3b6257aabd9f764671c94`; governed deltas: flake.nix.
The reviewed source delta is limited to the read-only SystemScape settings mount
and its boot-time link, plus the 0.4.0 package pin and exact upstream lock.
No published port, credential, identity, role or adapter authority changes.
Package tests (49), hosts-layer checks (8), actual boot-block fixture and
persistent-volume checks passed. Production mount acceptance remains separate;
this scoped review does not re-audit unrelated history or promote status axes.

## Re-verification — 2026-11-20 at `9263a39761c0c69e651e77ec1c91be33f015a1b5`

Governed delta: `docker-compose.gui-tools.yml` only pins the `gui-tools-exchange` volume name (ADR-2207 D2). The control planes, their publishes and the gui-tools sidecar's own mount at `/home/devuser/exchange` are unchanged. `scripts/ci/check-ports-loopback.sh` → PASS. Claim still true. The Decision is unchanged and no claim of this record is falsified by the ADR-2207 sidecar refresh. Commands run: `git diff de01d60a4..9263a3976 -- flake.nix comfyui-sidecar/Dockerfile docker-compose.comfyui.yml docker-compose.gui-tools.yml gui-tools-sidecar skills/blender/tools skills/comfyui/mcp-server skills/comfyui/scripts skills/comfyui/models/stopmotion-candidates.json`. Re-run the diff to reproduce.

## Re-verification — 2026-11-20 at `f6a87328266381a2f2f1bf6ddf7050ebd72eda49`

Governed delta: `flake.nix` changed in one line, `:3169`: the `[program:nip98-proxy]` supervisor `environment=` gains `NIP98_PROXY_REQUIRE_CONFIG="1"` (W3-05, ADR-2210). One line replaces one line, so no `flake.nix` citation moves, and nothing else in the file changed. This record makes no claim about the proxy's supervisor environment or its config projection. The Decision is unchanged and no claim of this record is falsified by the JOURNAL-LOCK (ADR-2211), W3-05 (ADR-2210) or Podkey-policy (ADR-2212) merges. Commands run: `git diff 2ebc3859c..f6a873282 -- flake.nix comfyui-sidecar/Dockerfile docker-compose.comfyui.yml docker-compose.gui-tools.yml gui-tools-sidecar skills/blender/tools skills/comfyui/mcp-server skills/comfyui/scripts skills/comfyui/models/stopmotion-candidates.json`. Re-run the diff to reproduce.

## Re-verification — 2026-11-20 at `0913d5458837d8c4d1fa4b5b3e52b70e7975cb5a` (closeout branch)

Governed delta: `flake.nix` changed only in a comment in the generated compose file's header (R-025, the optional `claude-zai` sidecar, `:4164-4169`): comment text, one line longer, so `flake.nix` lines after `:4165` move by +1. No program, port, mount, environment value or derivation changes. Citations in this record to lines after these points are as of their own commit and are not renumbered. Commands run on this commit: `git diff 6a73c5a73..0913d5458 -- <the paths above>` read in full; `node scripts/adr-index-gen.js docs/adr --check`. The Decision and status axes are unchanged and no claim of this record is falsified.

## ADR-2214 drift check — 2026-11-22

Compared every governed path changed by `fc95b3877` (ADR-2214). Those changes
move `/home/devuser/.gemini` from a tmpfs to the named volume `agentbox-
antigravity-state`, set `[providers.gemini].auth_mode = "oauth"`, add `gemini`
to the OAuth-capable providers, export `AGENTBOX_ANTIGRAVITY_AUTH_MODE` to the
Antigravity consultant, and correct comments and docs. No value, authority,
boundary or runtime behaviour governed by this decision changes. This is source
verification, not activation.

## Re-verification — 2026-11-23 (2) at `538c223973ee1aa1fb18a7521b5ea91d3e9535ac`

Governed delta since `fc95b3877`: `flake.nix`. The delta is the poker house seat's optional operator alert (`e59b51980`), plus the seat binary pin (`538c22397`, `lib/poker-citizen.nix`, not a path this record governs). `flake.nix` gains `pokerCitizenAlert` (`:473`) and the per-seat `alertPubkey` (`:489`), each `unplaceheld (… or "")`, and appends `POKER_CITIZEN_ALERT_PUBKEY` to the `[program:poker-citizen]` and `[program:poker-citizen-<name>]` environment lines only when the value is non-empty (`:3434`, `:3449`); lines after `:468` sit three lower and lines after `:486` four lower. Every hunk is additive: one optional key under `[poker_citizen]` and `[poker_citizen.<name>]` and one environment projection; the seat opens no listener and adds no program, port, mount, volume or manifest gate. Nothing this record decides (Typed remote media control planes alongside existing bridges) reads `alert_pubkey` or `POKER_CITIZEN_ALERT_PUBKEY`. Review trigger: not fired.

Judged from `git diff fc95b3877..538c22397 -- flake.nix`, the hunks read in full against this record's claims; `node scripts/adr-index-gen.js docs/adr --check`. The Decision and status axes are unchanged and no claim of this record is falsified. Citations in this record to lines after the points above are as of their own commit and are not renumbered.
