---
id: ADR-2177
title: The SuperSplat editor is served in-container and driven in the browser sidecar; splat-transform is on PATH
date: 2026-11-05
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 2c4b365b48d306b90bc36bf113249380e82b9f5c
verified_paths: [lib/supersplat.nix, lib/splat-transform.package-lock.json, flake.nix, agentbox.toml, scripts/ci/check-ports-loopback.mjs, docker-compose.browsercontainer.yml, skills/supersplat/SKILL.md]
owner: jjohare
review_trigger: SuperSplat or splat-transform pin bump; any change to the supersplat listener's bind, root or authentication; the browser sidecar's TREAT_AS_SECURE list; a proposal to serve datasets or anything outside $WORKSPACE/splats/share
repo: agentbox
domain: BASELINE-container
relates: [ADR-2175, ADR-2062, ADR-2040]
---

# ADR-2177: The SuperSplat editor is served in-container and driven in the browser sidecar; splat-transform is on PATH

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

## Context

ADR-2175 produces trained Gaussian splats, but agents had no way to inspect or clean one:
`lichtfeld-studio` is gated off and unbuilt, and `spark-scene` embeds splats in an app
rather than editing them. SuperSplat (PlayCanvas, MIT) is a browser editor for exactly
this. It ships no release build, needs WebGPU (3.6.0 asks only for a WebGPU device), and
exposes its internal event bus as `window.scene.events`. Its companion `splat-transform`
CLI converts and compresses splats headlessly. The browser lives in a separate sidecar, so
the editor must be reachable across the docker network and must load as a secure context.

## Decision

1. **Build** both at pinned versions in `lib/supersplat.nix`: SuperSplat v3.6.0 from its
   tagged source (`8c28d721`) as a static `dist/`, and `splat-transform` v3.10.3 from its
   published npm tarball (pinned by the registry's own integrity) with a committed
   runtime-only lockfile, `lib/splat-transform.package-lock.json`. The tarball route is
   forced: the source lockfile has 191 dev entries with no `resolved` or `integrity`, which
   Nix cannot prefetch. Both build with `--ignore-scripts`; the Dawn WebGPU addon the CLI
   imports at top level ships prebuilt and is autopatched against `libstdc++`. Gate:
   `[skills.spatial_and_3d] supersplat` (rebuild class), on.
2. **Serve** one root, `$WORKSPACE/splats/share`, with `static-web-server` from nixpkgs as
   `[program:supersplat]` on `0.0.0.0:8795`. Each start mirrors the image's editor into
   `<root>/editor` with `rsync --delete`. Agents copy a splat into `<root>/<name>/` and open
   `/editor/?load=/<name>/<file>`, so the editor and the file share one origin with no CORS.
   `static-web-server` refuses symlinks out of its root, which is why the editor is
   mirrored rather than linked.
3. **Listener.** The browser sidecar must reach it across the docker network, so loopback
   (ADR-2040 option 1) is unavailable. It is sanctioned in `LISTENER_SANCTIONED` instead of
   authenticated: it is never published, read-only, lists no directories, holds no
   credential, and serves only the public editor build and the splats an agent chose to put
   in the share. This is a narrower exposure than the sanctioned VNC servers. Datasets stay
   in `$WORKSPACE/splats/<name>/`, outside the root.
4. **Secure context.** `http://agentbox:8795` is added to the browser sidecar's
   `TREAT_AS_SECURE`. That list is read when the sidecar starts, and recreating the sidecar
   locks the owner's Podkey, so it is not recreated for this change; until it is, agents
   forward the port to `localhost` inside the sidecar (documented in the skill and the
   sidecar README).
5. **Skill** `supersplat` documents only event-bus calls that were run live, separately
   from the ones that only appear in the pinned source.

## Consequences

- Any container on the docker network can read the share root. That is the accepted cost;
  the skill says to keep datasets out of it.
- The event bus is SuperSplat's internal API. A version bump must re-list it against the new
  source before the skill is trusted.
- Editor exports download inside the browser sidecar. Files needed back in agentbox go
  through `splat-transform`.
- 3.6.0 has no WebGL2 fallback, so a browser without WebGPU gets no editor.

## Verification

2026-11-05, on the same build reproduced in a scratch directory (`npm ci --ignore-scripts`,
rollup, 28 s, 27 MB `dist/`), served by `static-web-server` 2.44.1 over the decided layout:

- `/editor/` 200, `webp.wasm` as `application/wasm`, a splat under `/workshop/` 200; `/`,
  a folder and `/editor/../../etc/passwd` all 404 (no listing, no traversal).
- In the browser sidecar over `localhost`: secure context, a WebGPU device on the NVIDIA
  Ampere adapter (the A6000, `isFallbackAdapter` false), and the trained workshop splat
  loaded with 1,042,802 splats, matching its PLY.
- Event bus, run live: `select.all` selected all 1,042,802; `select.delete` removed them;
  `edit.undo` restored them; `select.none` cleared the selection.
- `splat-transform` 3.10.3 on CPU (`-g cpu`), 71 MB PLY in: compressed PLY 16.2 MB,
  SPZ 15.7 MB, SOG 11.2 MB, each under 4 s. With the Dawn addon removed every command
  fails, which is why it is autopatched rather than dropped.
- `scripts/ci/check-ports-loopback.mjs` passes and reports `[program:supersplat]`
  `--host 0.0.0.0` as sanctioned; `tests/config/role-isolation-supervisor.test.sh` 25/25;
  `resolveGate` returns true for `skills.spatial_and_3d.supersplat`; `skills/lint-skills.sh`
  clean.
- On the host: `nix build .#supersplat` and `nix build .#splat-transform` both build at the
  pinned hashes; the Nix editor output matches the scratch build (same files, 27 MB). The
  Nix-built CLI reports v3.10.3, keeps only the `linux-x64` Dawn addon, and converts the
  workshop splat to SOG with `-g cpu` (11,761,431 bytes, identical in size to the scratch
  run). `nix eval --raw .#runtime.drvPath` evaluates the whole image with the gate on.

Open until the image is rebuilt and activated: the supervised program and the CLI from
the image itself, and the `TREAT_AS_SECURE` origin after a sidecar recreate.

- Host, after review: `nix build .#splat-transform` unchanged on x86_64 (`imzz86yr…`) with the Dawn addon now chosen per platform; `packages.aarch64-linux.splat-transform` evaluates (`hm1wy7zw…drv`). nixpkgs pins static-web-server 2.44.1, the version the symlink, MIME and listing checks ran against. The exact `[program:supersplat]` start line, run twice on the host against the store build: HTTP 200, `application/wasm`, 21 files all writable, and a stale file removed by `--delete`.
- The new key is accepted by `schema/agentbox.toml.schema.json`, `agentbox-config-validate.js` (a string value is refused), the semantic-rules suite (83 pass) and the agentbox-manifest TUI field table, whose three goldens moved by exactly one line each; skill counts updated to 132.

## Activation

2026-11-05 compatibility correction: the retained browser image still starts
Chrome with `/tmp/chrome-profile`. Both that path and the intended
`/home/devuser/chrome-profile` now mount the same persistent profile volume.
The old profile was copied while the container was stopped, with a restricted
host backup and recovery image retained. This changes no network exposure.
Chrome now receives the SuperSplat secure origin. Podkey unlock and a live
editor/WebGPU check remain owner/runtime acceptance, not inferred here.

Which sidecars this change needs, from the host checkout:

1. **Agentbox image: rebuild.** `./agentbox.sh prepare`, then `./agentbox.sh activate`
   (or `./agentbox.sh rebuild`). Activation replaces the running agentbox container. Then
   `supervisorctl status supersplat` is RUNNING and
   `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8795/editor/` returns 200.
2. **Browser sidecar: recreate, no image rebuild.** Only its `TREAT_AS_SECURE` environment
   changed (`docker-compose.browsercontainer.yml`). Recreate it, then unlock Podkey over VNC
   (`./agentbox.sh browsercontainer podkey unlock`). Until then, `http://agentbox:8795` is
   not a secure origin and SuperSplat gets no WebGPU device there.
3. **ComfyUI sidecar: nothing.** None of its baked files (`comfyui-sidecar/nodes/agentbox_video`,
   `download_video_models.py`, `stopmotion-candidates.json`) changed after the ADR-2175 build.

Set `activation_status: active` once steps 1 and 2 are done and the editor loads a splat at
`http://agentbox:8795/editor/?load=/…` in the browser sidecar.

Re-verified 2026-11-10 at `571c0ad43` (PR #45, ADR-2191, the Bend toolchain). Governed-path delta since `e2b49adfc`: `agentbox.toml` gains `[toolchains].bend = true`; `flake.nix` gains `bendLib` and `bendPackages`, one `++ bendPackages` in `allPackages` and one in the `toolchains` layer group, and `ENABLE_BEND` in the image environment. Every hunk is an addition apart from one re-wrapped line in the `toolchains` layer group. The change adds a gated language toolchain and no listener, published port, mount, volume, supervisor program, secret, identity, model route, vault path, registry entry or Nostr kind, and it alters no existing gate, so what this record decides is not touched. CI on that commit passed the flake evaluation on both architectures, config validation with the TUI round trip, the contract and adapter suites and the custody rehearsal. Re-run: `git diff e2b49adfc..571c0ad43 -- <verified_paths>`.

Re-verified 2026-11-11 at `237178730` (ADR-2192, ADR-2193, ADR-2194 at `04638a618`; ADR-2195 at this commit). Governed-path delta since `571c0ad43`: `agentbox.toml` gains `[skills.routing] scope = "all"` (ADR-2192) and `cad = false`, `cad_print = false` under `[skills.spatial_and_3d]` (ADR-2195); `flake.nix` gains `supervisordLauncher`, listed ahead of `pythonRuntimeEnv` in `pythonBasePackages` (ADR-2193: PID 1 is started by the runtime env's interpreter; the entrypoint's `exec supervisord` line is unchanged), `motionRenderPkg` in `skillToolPackages` (ADR-2194), and the CAD gate (ADR-2195): `cadLib`, `cadEnabled`, two gated additions to `spatialPackages`, a gated `[program:cad-engine]` block bound to `127.0.0.1:3245`, gated `/usr/share/fonts` links and `ENABLE_CAD` in the image environment. The supersplat listener, root, pin and gate are untouched. The CAD gate adds neighbours in the same `spatialPackages` list and supervisor region. Run on this commit in the container: the configuration jest suites (294 passed), `skill-lint`, `skill-count-check`, the manifest validator, the egress register check, the secret inventory, the crate licensing check, the role-isolation and runtime-contract shell tests, `python-runtime-path` and `cad-launcher`. The flake was NOT evaluated (no Nix in the container) and no image has been built from it. The decision and status axes are unchanged. Re-run: `git diff 571c0ad43..237178730 -- <verified_paths>`.

Re-verified 2026-11-11 at `1e7d1d2b2`. Governed-path delta since `237178730`: `agentbox.toml` only, where `[skills.spatial_and_3d]` `cad` and `cad_print` go from `false` to `true` (ADR-2195, operator's decision) and their comment is reworded. No other key changes. The gated additions this turns on are the ones the previous note describes as gated off: the CAD launcher, wheelhouse and Xvfb in `spatialPackages`, `[program:cad-engine]`, the `/usr/share/fonts` links and, for `cad_print`, OrcaSlicer. None has been evaluated or built. The manifest validator and `tests/config/cad-launcher.test.sh` (35) pass on this commit.

Re-verified 2026-11-11 at `a1d16473e` (skill-estate audit). Governed-path delta since `1e7d1d2b2`: `agentbox.toml` sets `[system_one.consumers].skill_intent = false` (it doubled each routed turn's input for a blind pick that was never adopted; identical picks on the 86 labelled cases at half the cost) and rewords one comment under `[skills.routing]` (the hook is registered with an 8 s timeout); no other key changes. No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: skill lint and its self-test, skill-count, routing-table, the manifest validator, the router jest suites (104) and configuration jest (301), corpus and parity tests (the corpus's baked-versus-repo comparison fails in this container until the next rebuild carries the new descriptions; CI has no baked tree and skips it). The decision and status axes are unchanged.

Re-verified 2026-11-11 at `924f4282a` (ADR-2196). Governed-path delta since `a1d16473e`: `agentbox.toml` rewords the `[skills.routing].label_log` comment to record that EXP-B8 is over (the key was already `false`); no key changes; `flake.nix` adds `semgrep`, `gitleaks`, `trivy` and `jujutsu` to the ungated `basePackages`; removes `codexMcpPkg`, its `npmServicePackages` entry and its copy into the openai-codex skill folder (the codex CLI, `toolchains.codex` and the codex-plugin-cc payload are unchanged); and gives `[program:podcast-cron]`'s `environment=` PATH util-linux and `vaultPackages` via `lib.makeBinPath`. No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: skill lint (124), skill-count, routing-table, the manifest validator, router and configuration jest, the corpus test (its baked-versus-repo comparison fails in-container until the next rebuild), and the agentbox-manifest and podcast-ingest cargo tests. The Nix changes are not evaluated or built. The decision and status axes are unchanged.

Re-verified 2026-11-11 at `0ed05167b` (ADR-2196, removal of the dead `skills.browser.playwright` switch). Governed-path delta since `924f4282a`: `agentbox.toml` removes `[skills.browser].playwright` and its comment (the key was `false` and drove no skill); `flake.nix` drops `playwright` from the security-exception filter and `ENABLE_PLAYWRIGHT` from the image environment (the playwright skill is gone and local browsers are forbidden here). No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: the manifest validator, manifest catalogue, configuration jest (301), agentbox-manifest cargo tests (235), skill lint (124). The flake edits are two whole-line deletions, not evaluated. The decision and status axes are unchanged.

Re-verified 2026-11-11 at `f475e0b8e` (ADR-2196, removal of the dead `skills.browser.qe_browser` switch). Governed-path delta since `0ed05167b`: `agentbox.toml` removes `[skills.browser].qe_browser`; `flake.nix` drops `ENABLE_QE_BROWSER` from the image environment (nothing read it). No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: the manifest validator (live and default manifests), manifest catalogue, configuration jest (301), the TUI non-interactive validation (5), agentbox-manifest cargo tests (235). The flake edit is one whole-line deletion, not evaluated. The decision and status axes are unchanged.

Re-verified 2026-11-11 at `2c4b365b4` (ADR-2196, second pass). Governed-path delta since `f475e0b8e`: `flake.nix` puts `torch-bin` and `torchvision-bin` inside `pythonRuntimeEnv` behind `[skills.data_science].pytorch` (replacing a bare, unimportable package), adds `openssl.bin`, `gdal`, `pngquant`, `bun` and `manim` to `basePackages`, `trunk`, `cargo-leptos`, `leptosfmt` and `rust-analyzer` to `wasmPackages`, `arnisPkg` (lib/arnis.nix, pinned v3.4.0) to `skillToolPackages`, and drops the lichtfeld comment from the GPU-wrap list; skill edits within their own folders (install steps replaced by the baked tools; lichtfeld-studio deleted). No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: skill lint (123), skill-count, routing-table, manifest validator and catalogue, configuration jest (301), corpus and parity tests (the baked-versus-repo comparison fails in-container until the rebuild), system-one-eval. arnis's source hash was reproduced independently with scripts/nar-hash.py, which also reproduces the pinned StatCraft hash. The Nix is not evaluated or built. The decision and status axes are unchanged.
