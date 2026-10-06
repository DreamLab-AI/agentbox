# browsercontainer — headless Chrome with CDP + MCP bridge

Hardware-accelerated Chrome instance for browser automation, testing, and AI agent interaction via chrome-devtools-mcp.

Agentbox's host `prepare`/`activate` workflow never rebuilds or restarts this
sidecar; its lifecycle remains explicit. See [incremental builds](../docs/developer/incremental-builds.md).

## Architecture

Agentbox's browser-use instructions are owned by `config/instructions/workspace.claude.md` and its private local layer (ADR-2118), projected at boot. Edit the source layers, not the generated workspace `CLAUDE.md`. This does not change browsercontainer's own mounts or lifecycle.

```
┌──────────────────────────────────────────────────────────────┐
│  browsercontainer (Docker, visionclaw_network)               │
│                                                              │
│  ┌──────────┐  ┌─────────────────────────────────┐           │
│  │  Xvfb    │  │  Chrome Beta 149+               │           │
│  │  :2      │──│  Vulkan/ANGLE hardware accel     │           │
│  │  1920x   │  │  CDP on 127.0.0.1:9222          │           │
│  │  1080    │  │  --unsafely-treat-insecure-...   │           │
│  └──────────┘  └───────────┬─────────────────────┘           │
│       │                    │                                  │
│  ┌────┴─────┐  ┌───────────┴─────────────────────┐           │
│  │ x11vnc   │  │  socat CDP proxy                │           │
│  │ :5903    │  │  0.0.0.0:9223 → 127.0.0.1:9222  │           │
│  └──────────┘  └─────────────────────────────────┘           │
│                                                              │
│  ┌───────────────────────────────────────────────┐           │
│  │  MCP SSE bridge (server.js)                   │           │
│  │  spawns chrome-devtools-mcp per session        │           │
│  │  0.0.0.0:8931                                  │           │
│  └───────────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────┘
```

## Port layout

| Port | Service | Protocol | Purpose |
|------|---------|----------|---------|
| 5903 | x11vnc | VNC | View Chrome desktop (debugging) |
| 8931 | server.js | HTTP/SSE | MCP bridge — agents connect here |
| 9222 | Chrome | HTTP/WS | CDP (internal, localhost only) |
| 9223 | socat | TCP | CDP proxy (exposed as host:9222) |

**CDP proxy mapping**: host `:9222` → container socat `:9223` → Chrome `:9222`.
socat rebinds the listening address so that `/json/list` returns `ws://` URLs
that external clients can connect to directly.

## Usage

```bash
# Start
agentbox.sh browsercontainer up

# Check health
agentbox.sh browsercontainer health

# View CDP tabs
agentbox.sh browsercontainer cdp

# Run diagnostic against a target URL
docker exec browsercontainer node /opt/browsercontainer/cdp-diagnose.js http://the model host:3001

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

The `launch-chromium.sh` script expands these into individual
`--unsafely-treat-insecure-origin-as-secure=<origin>` flags. Combined with
`--test-type` to suppress the warning banner.

For `SharedArrayBuffer` to work, the target page must also serve:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless` (or `require-corp`)

VisionClaw's nginx.dev.conf adds these headers.

## Rendering

Both **WebGPU** and **WebGL** are hardware-accelerated via Vulkan/ANGLE on the
NVIDIA RTX 6000. Chrome is launched with `--enable-features=WebGPU` and
`--enable-unsafe-webgpu` so that WebGPU works on both HTTPS and HTTP origins.
VisionClaw currently uses WebGL (Three.js / React Three Fiber).
GPU passthrough is not strictly required — Chrome falls back to software
rendering without it. The healthcheck treats missing GPU as a warning, not a failure.

## CDP diagnostics

The built-in `cdp-diagnose.js` script navigates Chrome to a target URL,
waits for it to load, then reports:

- Page state (readyState, isSecureContext, crossOriginIsolated, SAB availability)
- WebSocket connections
- Console messages and errors
- Runtime.evaluate latency (detects main thread freezes)
- Screenshot saved to `/tmp/visionclaw-diagnose.png`

```bash
# Default target (the model host:3001), 15s wait
docker exec browsercontainer node /opt/browsercontainer/cdp-diagnose.js

# Custom target and wait time
docker exec browsercontainer node /opt/browsercontainer/cdp-diagnose.js http://example.com 20000
```

## MCP integration

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
expire after 90 days. The current pin expires **2026-12-24**, after which only
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

`/tmp/chrome-profile` is gone. Extensions installed by hand into it (Proton Pass
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
