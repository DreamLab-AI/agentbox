# lib/prose-sanitiser.nix
#
# Nix derivation for `prose-sanitiser` — the deterministic AI-provenance
# sanitiser behind the `prose-sanitiser` and `open-design` skills.
#
# This replaces the skill's Python CLI layer with twelve baked binaries, so a
# skill consumer needs no Python runtime for the deterministic path:
#
#   inspect-text / clean-text        invisible-Unicode and homoglyph surgery
#   inspect-image / clean-image      PNG/JPEG/WebP metadata stripping
#   inspect-file / clean-file        SVG/PDF/DOCX/ODT/HTML/Markdown scrubbing
#   audit-dir / audit-website        recursive sweep, published-site crawl
#   rewrite-text                     LLM-backed rewrite (Layer B)
#   slop-scan                        prose slop scanner
#   slop-detect                      design slop scanner (was open-design's
#                                    scripts/slop-detect.py)
#   prose-sanitiser-server           the HTTP service
#
# WHAT DELIBERATELY STAYS IN PYTHON: four torch harnesses under
# skills/prose-sanitiser — score_synthid.py (reverse-SynthID),
# clean_ctrlregen.py (CtrlRegen), markdiffusion_harness.py (MarkDiffusion) and
# detect_text_watermark.py (MarkLLM), plus the common.py they import. Those are
# thin wrappers over torch/diffusers model stacks, not logic worth porting;
# the Rust locates them, runs them under resource caps and parses their JSON
# back (see services/prose-sanitiser/crates/media/src/image/harness.rs). They
# are found via $PROSE_SANITISER_SCRIPTS_DIR, else
# /opt/agentbox/skills/prose-sanitiser.
#
# The crate root is a Cargo workspace of seven members under crates/:
#
#   core     shared Finding/Patch/Config types; no I/O, no subprocesses
#   unicode  Layer A invisible-Unicode and homoglyph surgery
#   uk       UK-English spelling enforcement
#   slop     AI writing-tell rule tables and scanners
#   media    image and container provenance surgery, plus io/proc helpers
#   cli      the eleven CLI binaries (package name `prose-sanitiser`)
#   server   the HTTP service and its binary
#
# The path-deps between them are all inside this src tree, so the whole
# workspace still builds from one derivation with one lockfile and no workspace
# reassembly — every external dependency is on crates.io. ureq is pinned with
# default-features = false plus the "tls" feature, which selects rustls — so
# there is NO openssl link and no pkg-config probe, matching the dream-engine
# precedent.
#
# Tests are hermetic: fixtures on disk, Layer A parity vectors, and the one
# network-shaped test deliberately dials a closed loopback port to assert the
# error path. No outbound network, no model downloads, no torch. So
# doCheck = true runs the suite in the sandbox.
#
# Licence: MIT OR Apache-2.0 (crate and whole dependency closure permissive).

{ lib, pkgs }:

let
  version = "0.1.0";

  # In-repo workspace, minus the local build caches. The workspace root IS the
  # build root, so `buildRustPackage` builds every member and installs the
  # twelve binaries between them.
  proseSanitiserSrc = lib.cleanSourceWith {
    src    = ../services/prose-sanitiser;
    filter = path: _type: baseNameOf (toString path) != "target";
  };

in
pkgs.rustPlatform.buildRustPackage {
  pname = "prose-sanitiser";
  inherit version;
  src = proseSanitiserSrc;

  # One workspace, one checked-in lockfile at its root, pinning the full closure.
  cargoLock.lockFile = ../services/prose-sanitiser/Cargo.lock;

  # No native deps: ureq is rustls-backed (default-features = false), so there
  # is no openssl link and no pkg-config probe.

  doCheck = true;

  meta = with lib; {
    description = "Deterministic AI-provenance sanitiser for agentbox — invisible-Unicode and homoglyph surgery, image and container metadata stripping, slop scanning and UK-English enforcement, as CLIs and an HTTP service";
    homepage    = "https://github.com/DreamLab-AI/agentbox";
    license     = with licenses; [ mit asl20 ];
    mainProgram = "clean-text";
    platforms   = platforms.linux;
  };
}
