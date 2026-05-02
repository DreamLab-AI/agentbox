# lib/linkedobjects-browser.nix
#
# Linked-Object Browser — first implementation of the viewer slot
# (PRD-006 §15 / ADR-012 §Decision §Viewer / DDD-004 §ViewerSurface).
#
# Repository: github.com/linkedobjects/browser
# Author:     Melvin Carvalho et al.
# Licence:    AGPL-3.0
#
# A ~1100-LOC vanilla-JS JSON-LD renderer with a pane-router. We
# materialise the gh-pages tree at a pinned commit into the runtime
# image at /opt/agentbox/browser/, served read-only by the
# management-api at the operator-configured mount path (default `/lo`).
#
# This module is the FIRST viewer implementation. The viewer slot in
# `[linked_data.viewer]` accepts other implementations behind the same
# pane-manifest contract: swap `mode = "external"` to point at a hosted
# instance, or fork this file to ship a different viewer derivation.
# The pane-manifest schema (management-api/middleware/linked-data/viewer/
# manifest.js) is the public extension contract.
#
# Hash-resolution procedure (matches lib/solid-pod-rs.nix):
#
#   1. Update `rev` and `version` below.
#   2. Set `srcHash = lib.fakeHash`.
#   3. Run `./scripts/prefetch-hashes.sh --service linkedobjects-browser`.
#   4. Commit the resolved hash.
#
# AGPL §13 compliance: the management-api emits a `Source-Code` HTTP
# header pointing back at this repository on every response from the
# viewer mount path. See routes/linked-objects.js.
#
# Licence: AGPL-3.0, consistent with agentbox (AGPL-3.0).
# Shipped as static assets served by the management-api route handler.
# See docs/developer/licensing.md for the component license matrix.

{ lib, pkgs }:

let
  version = "0.1.0+rev-8260dc5";
  rev     = "8260dc5e5a1212de123233da116b4e14d58e606e";
  srcHash = "sha256-yRx453b0AfrM4SOPqih5lAcCrcJtbHuktDXeLLxWO3k=";

  src = pkgs.fetchFromGitHub {
    owner = "linkedobjects";
    repo  = "browser";
    inherit rev;
    sha256 = srcHash;
  };

  # Build-info written to $out/.agentbox-build-info.json.
  # Generated via builtins.toJSON to avoid indented-heredoc issues in
  # the Nix ''...'' string (unindented content resets the strip-level).
  buildInfoJson = builtins.toJSON {
    name     = "linkedobjects-browser";
    version  = version;
    rev      = rev;
    homepage = "https://github.com/linkedobjects/browser";
    license  = "AGPL-3.0-only";
    source   = "https://github.com/linkedobjects/browser/tree/${rev}";
  };

  # Agentbox shell page for /lo/.
  # losos/shell.js auto-boots on #losos and reads ?uri= natively.
  # Using pkgs.writeText to avoid heredoc indentation issues.
  indexHtml = pkgs.writeText "agentbox-lo-index.html" ''
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Agentbox — Linked Data Browser</title>
      <link rel="stylesheet" href="mashlib.css">
      <style>
        *{box-sizing:border-box}
        body{margin:0;font-family:system-ui,sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh}
        #bar{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#1a1f2e;border-bottom:1px solid #2d3748;position:sticky;top:0;z-index:200}
        #bar a{color:#a78bfa;font-weight:600;font-size:13px;text-decoration:none;white-space:nowrap}
        #bar input{flex:1;padding:7px 11px;background:#0d1117;border:1px solid #374151;color:#e2e8f0;border-radius:6px;font-size:13px;min-width:0}
        #bar input:focus{outline:none;border-color:#7c3aed}
        #bar button{padding:7px 16px;background:#7c3aed;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap}
        #bar button:hover{background:#6d28d9}
        #hint{padding:48px 24px;text-align:center;color:#4b5563}
        #hint h2{color:#a78bfa;margin-bottom:8px}
        #hint code{background:#1a1f2e;padding:2px 6px;border-radius:4px;font-size:13px}
        #lo-viewer{padding:16px}
      </style>
    </head>
    <body>
    <div id="bar">
      <a href="/lo/">&#9632; Agentbox</a>
      <input id="urlinput" type="text" placeholder="URN or URL — e.g. urn:agentbox:memory:name  or  http://localhost:8484/pods/…" />
      <button onclick="go()">Browse</button>
    </div>

    <div id="hint">
      <h2>Linked Data Browser</h2>
      <p>Enter a URN or URL above, or navigate directly:</p>
      <p><code>/lo/?uri=urn:agentbox:memory:name</code></p>
      <p><code>/lo/?uri=http://localhost:8484/pods/&lt;npub&gt;/</code></p>
    </div>

    <div id="lo-viewer"></div>

    <script type="module">
      import { boot } from './losos/shell.js';

      const params = new URLSearchParams(location.search);
      const rawUri = params.get('uri') || params.get('url') || "";
      const input  = document.getElementById('urlinput');
      const hint   = document.getElementById('hint');

      // Resolve urn:agentbox:* through the management-api before handing
      // to losos — browsers cannot fetch urn: scheme URIs directly.
      function resolveUri(uri) {
        if (uri.startsWith('urn:')) {
          return '/v1/uri/' + encodeURIComponent(uri);
        }
        return uri;
      }

      window.go = function () {
        const v = input.value.trim();
        if (!v) return;
        const u = new URL(location.href);
        u.searchParams.set('uri', v);
        u.searchParams.delete('url');
        location.href = u.toString();
      };

      input.addEventListener('keydown', e => { if (e.key === 'Enter') window.go(); });

      if (rawUri) {
        input.value = rawUri;
        hint.style.display = 'none';
        // Patch ?uri in the query string that losos reads so it fetches
        // the resolved URL, not the raw URN.
        const resolved = resolveUri(rawUri);
        if (resolved !== rawUri) {
          const sp = new URLSearchParams(location.search);
          sp.set('uri', resolved);
          history.replaceState(null, "", "?" + sp.toString());
        }
        boot('#lo-viewer');
      }
    </script>

    <!-- Panes -->
    <script type="module" data-pane src="panes/folder-pane.js"></script>
    <script type="module" data-pane src="panes/profile-pane.js"></script>
    <script type="module" data-pane src="panes/home-pane.js"></script>
    <script type="module" data-pane src="panes/agent-pane.js"></script>
    <script type="module" data-pane src="panes/pod-pane.js"></script>
    <script type="module" data-pane src="panes/todo-pane.js"></script>
    <script type="module" data-pane src="panes/markdown-pane.js"></script>
    <script type="module" data-pane src="panes/schema-pane.js"></script>
    <script type="module" data-pane src="panes/source-pane.js"></script>
    </body>
    </html>
  '';

in
{
  makeLinkedObjectsBrowser = { extraPanes ? null }:
    pkgs.runCommand "linkedobjects-browser-${version}"
      {
        inherit version src;
        passthru = {
          inherit rev version src;
          # Mount-path-agnostic: callers paste this into wherever the
          # static-assets registry mounts viewers.
          relativeRoot = ".";
        };
        meta = {
          description  = "Linked Object Browser ${version} — pinned vanilla-JS JSON-LD viewer";
          homepage     = "https://github.com/linkedobjects/browser";
          license      = lib.licenses.agpl3Only;
          maintainers  = [];
          platforms    = lib.platforms.all;
          longDescription = ''
            A small (~1100 LOC) JSON-LD viewer with a pane-router used by
            agentbox as the first implementation of the viewer slot
            (PRD-006 §15). Served read-only by the management-api at the
            operator-configured mount path. Operators can swap to an
            external instance by setting [linked_data.viewer].mode =
            "external" without rebuilding the image.
          '';
        };
      } ''
        runHook preInstall

        mkdir -p $out
        cp -rL ${src}/. $out/
        chmod -R u+w $out

        # Build-info for /lo/manifest.json provenance endpoint.
        cp ${pkgs.writeText "build-info.json" buildInfoJson} $out/.agentbox-build-info.json

        # Capability marker for the static-assets registry.
        touch $out/.agentbox-viewer-bundle

        # Agentbox shell page — address bar + losos auto-boot on ?uri=.
        cp ${indexHtml} $out/index.html

        runHook postInstall
      '';
}
