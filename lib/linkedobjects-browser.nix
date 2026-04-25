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
# Aggregation analysis (matches the solid-pod-rs treatment in
# docs/developer/licensing.md): we ship the browser tree as static
# assets served by, not linked into, agentbox first-party JavaScript.
# Agentbox stays MPL-2.0; the viewer remains AGPL-3.0.

{ lib, pkgs }:

let
  version = "0.1.0+rev-8260dc5";
  rev     = "8260dc5e5a1212de123233da116b4e14d58e606e";
  srcHash = lib.fakeHash;

  src = pkgs.fetchFromGitHub {
    owner = "linkedobjects";
    repo  = "browser";
    inherit rev;
    sha256 = srcHash;
  };

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

        # Ensure the source is writable for any post-install hooks operators
        # may add (rare, but the static-assets registry permits it).
        chmod -R u+w $out

        # Drop a build-info file the manifest endpoint reads at boot so the
        # /lo/manifest.json output can declare its provenance without
        # having to re-read the Nix store.
        cat > $out/.agentbox-build-info.json <<JSON
        {
          "name":     "linkedobjects-browser",
          "version":  "${version}",
          "rev":      "${rev}",
          "homepage": "https://github.com/linkedobjects/browser",
          "license":  "AGPL-3.0-only",
          "source":   "https://github.com/linkedobjects/browser/tree/${rev}"
        }
        JSON

        # Drop a marker so the static-assets registry knows this is a
        # viewer-shaped bundle (mashlib.js + losos/ + lion/ + panes/).
        # Future viewers may use a different marker; the registry is
        # capability-driven, not name-driven.
        touch $out/.agentbox-viewer-bundle

        runHook postInstall
      '';
}
