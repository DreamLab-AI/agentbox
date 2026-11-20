# browsercontainer — GPU Chrome with CDP + MCP bridge

Hardware-accelerated Chrome instance for browser automation, testing, and AI agent interaction via chrome-devtools-mcp.

Agentbox's host `prepare`/`activate` workflow never rebuilds or restarts this
sidecar; its lifecycle remains explicit. See [incremental builds](../docs/developer/incremental-builds.md).
Agentbox image SBOM/VEX reports also exclude this separately built sidecar;
assess its own image digest separately. [Evidence scope](../docs/developer/vex.md).

Mermaid is no longer rendered here: Agentbox renders it in-process with Pele
(ADR-2154, superseding ADR-2152), and this sidecar carries neither
`@mermaid-js/mermaid-cli` nor a `/render-mermaid` endpoint; nothing in Agentbox
calls one. The `gui-tools-exchange` volume stays for other hand-offs.

PDF visual comparison is also routed here rather than to a local `diff-pdf`
GUI in Agentbox. Poppler rasterises selected pages in Agentbox; the existing
`gui-tools-exchange` volume carries them to Chrome for browser-gpu review.
No new endpoint, renderer installation or sidecar restart is required. See the
[PDF review workflow](../skills/browser/references/latex-diagram-workflows.md).

## Architecture

Agentbox's browser-use instructions are owned by `config/instructions/workspace.claude.md` and its private local layer (ADR-2118), projected at boot. Edit the source layers, not the generated workspace `CLAUDE.md`. This does not change browsercontainer's own mounts or lifecycle.

```
┌──────────────────────────────────────────────────────────────┐
│  browsercontainer (Docker, visionclaw_network)               │
│                                                              │
│  Xvfb :2 (BROWSER_DISPLAY_SIZE, 16:9) ── openbox (maximise)  │
│     │                                                        │
│     ├── Chrome Beta 149+  Vulkan/ANGLE, CDP 0.0.0.0:9222     │
│     ├── x11vnc :5903      view only the one display          │
│     └── record.sh         ffmpeg x11grab → exchange          │
│                                                              │
│  cdp-proxy.js 0.0.0.0:9223 → 127.0.0.1:9222 (Host allow-list)│
│  server.js    0.0.0.0:8931 MCP SSE, /health /display /record │
│               spawns chrome-devtools-mcp per session,        │
│               cwd + TMPDIR = /home/devuser/exchange          │
└──────────────────────────────────────────────────────────────┘
```

## Port layout

| Port | Service | Protocol | Purpose |
|------|---------|----------|---------|
| 5903 | x11vnc | VNC | View Chrome desktop (debugging) |
| 8931 | server.js | HTTP/SSE | MCP bridge — agents connect here |
| 9222 | Chrome | HTTP/WS | CDP; binds 0.0.0.0 inside the container (`--remote-debugging-address`), not published; Chrome itself refuses non-IP Host names |
| 9223 | cdp-proxy.js | HTTP/WS | CDP proxy (exposed as host:9222) |

**CDP proxy mapping**: host `:9222` → container cdp-proxy.js `:9223` → Chrome `:9222`.

**Host publish address (`AGENTBOX_SIDECAR_BIND`)**: these ports have no authentication, so the sidecar compose files (`docker-compose.browsercontainer.yml`, `docker-compose.gui-tools.yml`, `docker-compose.xr-runtime.yml`) publish them on `${AGENTBOX_SIDECAR_BIND:-127.0.0.1}`. The default is loopback. To let a second machine reach them, export one LAN address (for example `AGENTBOX_SIDECAR_BIND=192.168.2.10`) before `docker compose up`; that moves every sidecar port together. `0.0.0.0` publishes on every interface and should only be used on a trusted network. `scripts/ci/check-ports-loopback.sh` accepts this variable only in those three files and only with the loopback default. The in-container listeners stay on `0.0.0.0` because the agentbox proxy reaches them across the docker network.

## Display (ADR-2207)

One Chrome window on one display, locked 16:9. `BROWSER_DISPLAY_SIZE` (compose,
default `1920x1080`) is the only definition: `display-env.sh` (and `display.js`)
accept `WxH` with `W*9 == H*16` and W between 1280 and 3840, and refuse anything
else before Xvfb or Chrome starts. Xvfb, Chrome's window flags
(`--window-position=0,0 --window-size=W,H --start-maximized
--force-device-scale-factor=1`) and the recorder all read it. openbox maximises
and undecorates every normal window, keeps one desktop and has no key or mouse
bindings, so nothing over VNC can move or resize the browser. Without a window
manager Chrome clamps itself one pixel under the screen (1919x1079, measured) and
cannot go fullscreen. Every start removes saved zoom levels and window placement
from the profile's `Default/Preferences` (nothing else), so the browser always
opens at 100 % in the full window. x11vnc stays on 5903 with no client-driven
resizing. Changing the size means recreating the sidecar.

`GET /display` reports the configured size and the window's bounds and state;
`POST /display/fullscreen {"on":true}` gives the page the whole screen for a
recording (`{"on":false}` returns to maximised). The tab strip stays visible in
normal use.

## Passing files (ADR-2207)

The `gui-tools-exchange` volume (pinned name `agentbox_gui-tools-exchange`) is
mounted at **`/home/devuser/exchange` in agentbox and in this sidecar**, the same
absolute path on both sides, so a path never needs translating. Agentbox also keeps
it at `/home/devuser/gui-tools`, the name older skills use. The MCP child runs with
that directory as its cwd and `TMPDIR`; chrome-devtools-mcp accepts paths under its
temp directory, so any path in the exchange is a valid upload or output path, and a
relative `filePath` lands there. No `docker cp`.

```javascript
// screenshot: readable in agentbox at the same path as soon as the call returns
take_screenshot({ filePath: "/home/devuser/exchange/mcp/page.png", fullPage: true })
// upload: write the file in agentbox first, then
upload_file({ uid: "<file input uid>", filePath: "/home/devuser/exchange/in/form.pdf" })
```

`mcp/` and `recordings/` are created on first use; nothing in the volume is ever
deleted by the sidecar. Because the connector's temp directory is now the exchange,
its own scratch directories (`chrome-devtools-mcp-*`, made by `mkdtemp` for unnamed
screenshots and screencasts) also land in the exchange root and survive recreates;
remove them by hand when they pile up. If the exchange is missing or read-only the bridge logs one
warning and the connector falls back to its own temp directory (then only
`docker cp` reaches those files).

## DevTools by name (ADR-2207)

Chrome's DevTools endpoint refuses any `Host` that is not an IP or `localhost`
("Host header is specified and is not an IP address or localhost"); that check is
its DNS-rebinding defence. `cdp-proxy.js` on 9223 forwards with
`Host: 127.0.0.1:9222`, rewrites `webSocketDebuggerUrl` and `devtoolsFrontendUrl`
in `/json*` responses to the host you used, and pipes WebSocket upgrades through.
It keeps the defence instead of removing it: only IP literals, `localhost` and
`CDP_PROXY_ALLOWED_HOSTS` (default `browsercontainer`) are accepted, anything else
gets 403 before Chrome is contacted. So:

```bash
curl -s http://browsercontainer:9223/json/version   # from agentbox, by name
curl -s http://localhost:9222/json/list             # from the host
```

(Until this rebuild the proxy was a socat byte pipe, which did not rewrite `Host`,
so the by-name form failed and consumers had to resolve the container IP first.)

## Recording (ADR-2207)

```bash
curl -s -X POST http://browsercontainer:8931/record/start -d '{"name":"demo"}'
curl -s http://browsercontainer:8931/record
curl -s -X POST http://browsercontainer:8931/record/stop    # returns once the file is finalised
```

`record.sh` (also usable inside the sidecar) records `:2` at the display size, 30 fps,
`libx264 -preset ultrafast -crf 20 -pix_fmt yuv420p` (override with
`RECORD_ENCODER_ARGS`), to `/home/devuser/exchange/recordings/<name>-<UTC>.mkv`.
One recording at a time, at most `RECORD_MAX_SECONDS` (default 3600) each; names are
reduced to `[A-Za-z0-9._-]`. The three POST endpoints (`/display/fullscreen`,
`/record/start`, `/record/stop`) refuse any request carrying an `Origin` header and
send no CORS headers: this port is published on the host's loopback, and a web page
must not be able to drive them. Agents and curl send no `Origin`. `/sse` and
`/messages` keep `Access-Control-Allow-Origin: *` for now (see ADR-2207).

## Usage

```bash
# Start
agentbox.sh browsercontainer up

# Check health
agentbox.sh browsercontainer health

# View CDP tabs
agentbox.sh browsercontainer cdp

# Display size + WebGPU check (exit 1 on failure)
agentbox.sh browsercontainer diagnose

# VNC into the desktop
open vnc://localhost:5903

# Shell access
agentbox.sh browsercontainer shell

# Full rebuild
agentbox.sh browsercontainer rebuild
```

## TREAT_AS_SECURE

Chrome treats HTTP origins as insecure by default, which blocks
`SharedArrayBuffer` (needed for the VisionClaw zero-copy position pipeline).
The `TREAT_AS_SECURE` env var lists comma-separated origins that Chrome should
treat as secure contexts. Set in `docker-compose.browsercontainer.yml`:

```yaml
- TREAT_AS_SECURE=http://the model host:3001,http://the model host:3000
```

The shipped list also carries `http://agentbox:8795`, the SuperSplat editor
(ADR-2177), which creates a WebGPU device only and so needs a secure context.
A changed list takes effect when this sidecar is recreated, which locks Podkey
until the owner unlocks it again; until then, forward the port to `localhost`
inside the sidecar (`socat TCP-LISTEN:8795,bind=127.0.0.1,fork TCP:agentbox:8795`).

The `launch-chromium.sh` script passes them as one comma-separated
`--unsafely-treat-insecure-origin-as-secure=<origins>` flag, combined with
`--test-type` to suppress the warning banner.

For `SharedArrayBuffer` to work, the target page must also serve:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless` (or `require-corp`)

VisionClaw's nginx.dev.conf adds these headers.

## Rendering

Both **WebGPU** and **WebGL** are hardware-accelerated via Vulkan/ANGLE on the
operator-selected NVIDIA GPU (measured 2026-11-20: Chrome 151 beta, adapter
nvidia/ampere, not a fallback adapter, compute round trip working). Chrome is
launched with `--enable-features=WebGPU` and `--enable-unsafe-webgpu` so that
WebGPU works on both HTTPS and HTTP origins.
GPU passthrough is not strictly required — Chrome falls back to software
rendering without it. The healthcheck treats missing GPU as a warning, not a failure.

## Health and diagnostics

`GET /health` answers 200 with `status: ok`, the configured `display`,
`connectorVersion`, `chromeVersion` and `versions` (what the build resolved:
Chrome beta, Chromium, chrome-devtools-mcp, node, ffmpeg, openbox, from
`/opt/browsercontainer/versions.json`). It answers **503** with `status: degraded`
when Chrome is unreachable (it used to answer 200). `healthcheck.sh` also probes
DevTools by name (`Host: browsercontainer:9223`).

`cdp-diagnose.js` (`agentbox.sh browsercontainer diagnose`) checks, in a fresh
background tab on the bridge's loopback URL that it closes again (no open tab is
navigated):

- the browser window's bounds equal the configured display at 0,0;
- WebGPU: an adapter that is not a fallback adapter, and a compute shader that
  doubles 1024 floats with an exact read-back;
- `window.nostr` presence, for information only (the sidecar must come up without Podkey).

It exits non-zero only on a display or WebGPU failure. Given a URL, it then runs the
page diagnosis (state, SharedArrayBuffer, console, errors, main-thread latency,
screenshot to the exchange):

```bash
agentbox.sh browsercontainer diagnose http://example.com 20000
```

## MCP integration

Connector usage statistics, update checks and performance-trace URL exports to
the external CrUX API are disabled (`--no-usage-statistics`, the two opt-out
environment variables and `--no-performance-crux`). This does not block browsing
or imply that every browser request stays on the local network.

Agents on the `visionclaw_network` connect via SSE:

```
http://browsercontainer:8931/sse
```

This spawns a `chrome-devtools-mcp` subprocess per session, providing
40+ browser automation tools (screenshots, accessibility snapshots,
performance traces, memory profiling, DOM inspection).

For Claude Code / agentbox agents, add to `.mcp.json`:

```json
{
  "mcpServers": {
    "browser": {
      "url": "http://browsercontainer:8931/sse"
    }
  }
}
```

## Podkey and the persistent profile (2026-10-03, custody-isolation W9)

Owner rule (2026-10-03): the sidecar installs and enables **Podkey** from the
published artefact as a matter of course. The sidecar's identity, K_browser
(G-5), is held by Podkey, not by Proton Pass and not by a throwaway `/tmp` profile.

### Fresh host (CY-C)

A fresh host's sidecar ships Podkey with no identity. `agentbox.sh browsercontainer up`
(or `rebuild`) first runs `scripts/fetch-podkey.sh fetch`, which needs an
authenticated `gh` or an exported `GH_TOKEN`/`GITHUB_TOKEN` (GitHub serves
artefacts to authenticated callers only). After that the zip is cached in
`browsercontainer/vendor/` (gitignored) and later builds need no network. The
container comes up healthy with Podkey loaded and `state: none` until the owner
mints K_browser (below).

### What is installed, and from where

| Item | Value |
|---|---|
| Source | `podkey-extension` artefact of `JavaScriptSolidServer/podkey` CI (`.github/workflows/ci.yml`); there are no GitHub releases |
| Pin | `browsercontainer/podkey.pin`: commit, run id, artefact id, zip sha256, expected name and version |
| Fetch | host side, raw zip via `GET /repos/…/actions/artifacts/{id}/zip` (`gh api`, or curl + token). Before downloading, the run's `head_sha` must equal the pinned commit and the artefact must belong to the pinned run. `gh run download` is not used because it unpacks, so the zip bytes the pin covers would never be seen |
| Verify | the zip's sha256 must equal the pin (refused otherwise, exit 3). Inside the image build, `fetch-podkey.sh install` re-verifies, refuses `..`/absolute entries, and checks `manifest.json` name/version and `build.json` commit against the pin |
| Install path | `/opt/browsercontainer/extensions/podkey` (inside the image) |
| Extension id | `cakgjkgiodcdhecnnfhmcfphjkknfjkd`. The artefact's manifest has no `key`, so Chrome derives the id from the absolute path: the first 16 bytes of SHA-256(path), each hex nibble mapped `0-f` to `a-p`. The path is fixed in the image, so the id is stable across rebuilds and hosts. `node /opt/browsercontainer/podkey-ctl.js id` prints it |
| Policy | `/etc/opt/chrome/policies/managed/podkey-only.json` (and `/etc/chromium/…`): `ExtensionInstallBlocklist ["*"]`, `ExtensionInstallAllowlist [<id>]` |

**Moving the pin forward** (the only way it changes; rule-estate-pins-move-forward):
pick a green `ci.yml` run on podkey `main`, then edit `podkey.pin` with its `head_sha`,
run id, the `podkey-extension` artefact id, the artefact's `digest` (that is the
zip sha256), the manifest version and `expires_at`. Then `rebuild`. CI artefacts
expire after 90 days. The current pin expires **2027-01-11**, after which only
hosts with a cached zip can build until the pin moves.

### How Chrome loads it

| Browser | Flags | Load |
|---|---|---|
| Google Chrome beta (default) | `--enable-unsafe-extension-debugging` | `podkey-loader` (supervisord) calls CDP `Extensions.loadUnpacked` |
| Chromium (fallback) | `--load-extension=<dir> --disable-extensions-except=<dir>` | Chrome itself |
| no extension dir | none | Chrome starts without Podkey (fail-open) |

Branded Chrome 137+ ignores `--load-extension`. On Chrome beta 151,
`--disable-extensions-except` still applies and disables even the CDP-loaded
Podkey. Both were observed in this sidecar on 2026-10-03, which is why branded
Chrome gets neither flag and the managed policy enforces "Podkey only" instead.
The loader loads **once per Chrome process**: re-loading an unpacked extension
clears `chrome.storage.session`, which would silently lock an unlocked key.

### The profile volume

Chrome's `--user-data-dir` is `/home/devuser/chrome-profile`, the named volume
**`browsercontainer-profile`** (stable name, independent of the compose project).
It holds Podkey's `chrome.storage.local`: the **encrypted vault**
(scrypt + AES-256-GCM, sealed under the owner's passphrase), the public key, and
site grants. The plaintext private key exists only in `chrome.storage.session`
(memory) while unlocked. Never run `docker compose -f docker-compose.browsercontainer.yml down -v`.
That deletes the volume and, with it, the sealed K_browser.

Chrome no longer uses `/tmp/chrome-profile`. The compatibility mount of the profile volume at that path, kept for the retained pre-Podkey image (ADR-2177, 2026-11-05), is retired by ADR-2207: its rebuild replaces that image. Extensions installed by hand into the old in-layer profile (Proton Pass
was added from the Chrome Web Store via VNC on 2026-09-28 13:03 UTC; it was never
part of this build) are not carried over, and the policy blocks re-installing them.

### Owner steps

**Mint K_browser (once, after the first rebuild with this change)**

1. `./agentbox.sh browsercontainer podkey status` should show `"state": "none"`
   and `"extension_id": "cakgjkgiodcdhecnnfhmcfphjkknfjkd"`.
2. Open VNC (`vnc://<host>:5903`). In Chrome, open
   `chrome-extension://cakgjkgiodcdhecnnfhmcfphjkknfjkd/popup/popup.html` (or click
   Podkey's toolbar icon). Choose **Generate new key**, using the passphrase path:
   the sidecar has no security key for the passkey path. Pick a passphrase of at
   least 8 characters and keep it outside the sidecar.
3. Back up per D3 at mint time: **Export key** in Podkey's popup, then seal the
   nsec with your age key on your own machine. It never goes into this repository
   or the agent's view.
4. `./agentbox.sh browsercontainer podkey pubkey` prints the 64-hex public key.
   Give it to the agent, which puts it in `config/custody/g5-key-split.json`
   (`k_browser.pubkey`) and `[interaction_plane.proxy].allowed_pubkeys` (G-5 step 2).

**After every sidecar restart or recreate** the vault is still on the volume, but the
session key is gone, so Podkey is `locked`. Re-unlock (no re-import):

```bash
./agentbox.sh browsercontainer podkey unlock   # prompts for the passphrase, no echo
```

or type it into Podkey's unlock screen over VNC. Unlock is deliberately not part
of the start script: doing it unattended would mean storing the passphrase in the
sidecar, which defeats the vault.

**Only if the volume is lost:** Podkey shows `state: none`. Restore from the age
backup, then use **Import existing key** in the popup over VNC, paste the nsec, and
set a passphrase. The public key, and so every verifier, is unchanged.

Media control-plane update: Blender retains its socket/background-job path and
adds an internal typed DCC-MCP gateway; external ComfyUI includes its MCP
dependencies. See [ADR-2148](../docs/adr/ADR-2148-remote-media-control-planes.md).

The optional [Isaac physics sidecar](../docs/developer/isaac-sim.md) is also
independent of this browser. Building or replacing it does not require a browser
restart or a Podkey unlock.


System One consumer activation is staged under ADR-2155: explicit manifest
switches reach services before launch, with a separate keyless local route for
private data. See `docs/reference/system-one-activation.md` in the Agentbox
repository for rebuild requirements and the remaining deployment prerequisites.

### Session plane cutover (ADR-2153, 2026-10-29)

The interaction plane is `agentbox-sessions` (ADR-2153): a supervised tmux-backed
daemon reconciles `[[interaction_plane.session_seeds]]` through a unix socket
at `/run/agentbox-sessions/sessions.sock` (0660, `ab-sessions`, SO_PEERCRED ACL).
Sessions are `abs_<slug>` with `@agentbox-sessions=1`; `tab0` is the external
`agentbox:0` coordinator. Window 8 runs `agentbox-sessions pick`. Provider profiles
are reconciled by `scripts/session-provision.mjs`. AoE, its default upstream,
`:9095` and the web session board are retired. The NIP-98 proxy on `:9096` keeps
its named operator routes and returns 404 for unknown routes. Seed worktrees live at
`~/workspace/wt/abs-<slug>`; one found under the retired `aoe-` prefix is adopted in
place. The `aoe-profiles` volume was archived and dropped (2026-11-12); after the
rebuild that removes its mount, `docker volume rm agentbox-aoe-profiles` on the host.
