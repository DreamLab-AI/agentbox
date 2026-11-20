---
id: ADR-2207
title: The browser sidecar is one browser on one fixed 16:9 display, with one exchange path
date: 2026-11-20
decision_status: accepted
implementation_status: complete
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: 0d3d3b2a234af040ef4aa2ca2301d8be7c404ff8
verified_paths: [browsercontainer/*, tests/browsercontainer/*, docker-compose.browsercontainer.yml, .github/workflows/browsercontainer.yml]
owner: operator
review_trigger: the owner's sidecar rebuild (activation), a change of window manager, display size rules or exchange path, or chrome-devtools-mcp moving past 1.13
repo: agentbox
evidence_class: test
acceptance_boundary: Fixture and unit tests under tests/browsercontainer (stub Chrome, Xvfb and ffmpeg; fake DevTools upstream; Compose's resolved model of docker-compose.browsercontainer.yml). No image was built, and openbox, Xvfb, Chrome and ffmpeg were not run. The agentbox override's resolved model is asserted only host-side (tests/config/compose-persistence.test.cjs). Activation is the owner's rebuild and diagnostic.
---

# ADR-2207 — The browser sidecar is one browser on one fixed 16:9 display, with one exchange path

## Context

Measured on the live sidecar (image of 2026-11-05). Xvfb `:2` ran at 1920x1080 with no window manager, and Chrome came up as a 500x584 window at (710,265). With size flags it clamped to 1919x1079, the same under `setWindowBounds` and `--kiosk`. The profile carried `about:blank` at 125 % zoom and a saved window placement. DevTools refused `Host: browsercontainer:9223`, because the socat pipe does not rewrite Host, yet the README claimed it worked. Agentbox mounted the exchange at `/home/devuser/gui-tools` and the sidecar at `/home/devuser/exchange`. Meanwhile chrome-devtools-mcp accepts paths only under client roots or `os.tmpdir()`, so files went through `docker cp`. `/health` answered 200 when Chrome was down. chrome-devtools-mcp 1.12.0 had usage statistics and update checks on.

## Decision

1. **One display.** `BROWSER_DISPLAY_SIZE` (default 1920x1080) is the only definition.
   - `display-env.sh` and `display.js` accept only WxH with `W*9 == H*16` and W from 1280 to 3840, and refuse anything else before Xvfb or Chrome starts.
   - openbox maximises and undecorates every normal window, keeps one desktop, has no key or mouse bindings and focuses new windows. Without a window manager the window can neither fill the screen exactly nor go fullscreen.
   - Chrome gets `--window-position=0,0 --window-size=W,H --start-maximized --force-device-scale-factor=1`.
   - Each start removes `partition.per_host_zoom_levels`, `partition.default_zoom_level` and `browser.window_placement` from Preferences. The rewrite is atomic, and the file is left untouched when it is absent, invalid or already clean.
   - Fullscreen is a bridge endpoint, not kiosk mode. x11vnc stays on 5903 with no client resizing.
2. **One exchange path.** `gui-tools-exchange` is mounted at `/home/devuser/exchange` in agentbox and every sidecar.
   - Agentbox keeps `/home/devuser/gui-tools` as an alias.
   - Every compose file pins the live name `${GUI_TOOLS_EXCHANGE_VOLUME:-agentbox_gui-tools-exchange}`, so nothing migrates.
   - The MCP child runs with cwd and `TMPDIR` set to the exchange when it is a writable directory, and otherwise warns once. Any exchange path is then a valid upload or output path at the path agentbox sees.
3. **DevTools by name, rebinding defence kept.** `cdp-proxy.js` replaces socat on 9223.
   - It forwards with `Host: 127.0.0.1:9222`, rewrites the ws URLs in `/json*` responses to the caller's host, and pipes upgrades.
   - Only IP literals, `localhost` and `CDP_PROXY_ALLOWED_HOSTS` (default `browsercontainer`) are accepted. Anything else, a missing Host included, gets 403 before Chrome is contacted.
4. **Recording.** `record.sh` runs ffmpeg x11grab of `:2` at the display size, 30 fps, libx264 ultrafast crf 20, writing Matroska to `<exchange>/recordings/`.
   - It allows one recording at a time, at most `RECORD_MAX_SECONDS` (3600) via `-t`.
   - Stop sends SIGINT and waits until the file is finalised.
5. **Bridge.** The child runs with `--no-usage-statistics`, `CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS=1` and `CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1`.
   - `/health` answers 503 when Chrome is unreachable, and reports the display and the build's versions.
   - New endpoints: `GET /display`, `POST /display/fullscreen`, `GET /record`, `POST /record/start`, `POST /record/stop`.
   - The three POSTs refuse any request carrying `Origin` and emit no CORS headers. This port is on the host's loopback with `Access-Control-Allow-Origin: *`, so a web page on the host must not drive them.
   - `/sse` and `/messages` keep that CORS and so remain reachable from a web page on the host. Tightening them is a separate, follow-up decision.
6. **Pins.** chrome-devtools-mcp is pinned to 1.13.0 (every bridge flag checked against its CLI) and ws to 8.23.0 (npm-generated lock).
   - The dead `PUPPETEER_EXECUTABLE_PATH` is removed.
   - The `/tmp/chrome-profile` alias of ADR-2177 is retired, because this rebuild replaces the image that used it.
   - `/opt/browsercontainer/versions.json` records what the build resolved.
7. **Diagnostic.** `cdp-diagnose.js` (`agentbox.sh browsercontainer diagnose`) checks two things in a fresh background tab on a loopback URL:
   - the window bounds equal the display;
   - WebGPU has a non-fallback adapter and passes a 1024-float compute round trip.
   It reports `window.nostr` as information only, and exits non-zero only on display or WebGPU failure.
8. **No stealth MCP.** Both evaluated servers launch their own Chrome and cannot attach to this one, which breaks the one-browser rule.
   - DevinoSolutions' server also ships default-on crash reporting and a very wide tool surface.
   - PyPI `stealth-browser-mcp` is not vibheksoni's package; that one is `browserstealthmcp`.
   - Revisit only with evidence of a site blocking this sidecar.

## Consequences

- Recreating the sidecar restarts Chrome and locks Podkey until the owner unlocks it, as before.
- A display size change needs a recreate.
- The `/health` 200→503 change is absorbed in the repo:
  - `agentbox.sh browsercontainer health` reports 503 as "bridge up, Chrome down";
  - the boot-time `browser-gpu` registration in `config/entrypoint-unified.sh` treats 503 as reachable (an agentbox image change);
  - `healthcheck.sh` probes DevTools by name.
- Screenshot paths under the sidecar's `/tmp` stop being accepted, because the connector's temp root is now the exchange. The skills now use `/home/devuser/exchange`.
- The connector's own `mkdtemp` scratch directories (`chrome-devtools-mcp-*`) now land in the exchange root and survive recreates. Nothing deletes them, so the owner clears them by hand.
- NVIDIA: host and sidecar run 615.78.08 and WebGPU works with it. R620 is the newer production branch, and moving to it is a host decision outside this record.
- Not verified here: no image build, no openbox/Xvfb/Chrome/ffmpeg run, and no resolved model of the agentbox override (that is checked host-side).

**Activation (owner, host shell):**

1. `./agentbox.sh browsercontainer rebuild`.
2. `./agentbox.sh prepare && ./agentbox.sh activate`, to recreate agentbox for the `/home/devuser/exchange` mount and the entrypoint change.
3. `./agentbox.sh browsercontainer podkey unlock`, or mint over VNC on a fresh profile.
4. `./agentbox.sh browsercontainer diagnose` and `./agentbox.sh browsercontainer health`.

Set `activation_status: live` once the diagnostic passes on the rebuilt sidecar.

## Verification

At `0d3d3b2a2`, from the worktree:

- `bash tests/browsercontainer/launch-args.test.sh`: 14 passed, 1 skipped (real Podkey artefact not cached).
- `bash tests/browsercontainer/fetch-podkey.test.sh`: 16 passed, 1 skipped.
- `bash tests/browsercontainer/record.test.sh`: 9 passed.
- `node --test tests/browsercontainer/*.test.cjs`: 50 passed. This covers display-config, server, cdp-proxy, pins, diagnose and podkey-ctl, plus the compose-profile-volume and exchange-compose scripts.
- Every new test was observed failing before its change. The Host allow-list and Origin refusal were also checked by disabling them (pass-through proxy, Origin check off), which turned their tests red.
- `skills/lint-skills.sh` is clean, `scripts/ci/check-ports-loopback.sh` exits 0, and ShellCheck 0.11.0 at warning severity reports nothing on the touched shell files.
