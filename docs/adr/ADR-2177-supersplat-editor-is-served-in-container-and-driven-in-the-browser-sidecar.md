---
id: ADR-2177
title: The SuperSplat editor is served in-container and driven in the browser sidecar; splat-transform is on PATH
date: 2026-11-05
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 3beca506c1d44122bf2e14ed935d590b9d020233
verified_paths: [lib/supersplat.nix, lib/splat-transform.package-lock.json, flake.nix, agentbox.toml, scripts/ci/check-ports-loopback.mjs, docker-compose.browsercontainer.yml, skills/supersplat/SKILL.md]
owner: jjohare
review_trigger: SuperSplat or splat-transform pin bump; any change to the supersplat listener's bind, root or authentication; the browser sidecar's TREAT_AS_SECURE list; a proposal to serve datasets or anything outside $WORKSPACE/splats/share
repo: agentbox
domain: BASELINE-container
relates: [ADR-2175, ADR-2062, ADR-2040]
---

# ADR-2177: The SuperSplat editor is served in-container and driven in the browser sidecar; splat-transform is on PATH

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
