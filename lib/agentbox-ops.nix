# lib/agentbox-ops.nix
#
# Nix derivation for `agentbox-ops` — the operational CLI suite that replaced
# the Python scripts retired by the 2026-09-02 estate legacy audit
# (docs/python-legacy-audit-2026-09-02.md). One Cargo package, one binary per
# tool, all on PATH in the image:
#
#   hermes-scheduler       cron daemon for Claude Code agent tasks
#   ruflo-daemon-gc        pid-reuse-guarded reaper for leaked ruflo daemons
#   token-audit            usage audit over local Claude Code transcripts
#   expel-distil           ExpeL post-task lesson extractor (hook hot path)
#   voyager-gate           Voyager VerificationGate + RuVector write
#   pvgis-fetch            PVGIS yield/optimal-tilt client
#   solar-optimize         UK ground-mount tilt/spacing/capacity/yield
#   comfyui-generate       FLUX 2 one-shot image generator
#   yt-transcript-archive  YouTube channel/playlist transcript archiver
#   report-preflight       Report Builder prerequisite check
#   mcp-call               stdio JSON-RPC client used by tests/code-harness
#
# Modelled on lib/dream-engine.nix: a self-contained [workspace] crate whose
# dependencies are all on crates.io, so there are NO sibling path-deps to
# fetch and no workspace reassembly. reqwest is pinned to rustls-tls with
# default-features = false, so there is no openssl link and no pkg-config
# probe. The checked-in Cargo.lock pins the whole closure.
#
# `expel-distil` and `voyager-gate` sit on hook hot paths whose stdout is
# parsed downstream (management-api/lib/kg-proposal-extractor.js), so the crate
# carries a CPython-compatible JSON writer and unit tests that pin the byte
# shape. Tests are hermetic apart from python3, which the Voyager gate shells
# out to for the `ast` checks on untrusted Python skill bodies — hence
# python3 in nativeCheckInputs.
#
# Licence: MIT OR Apache-2.0 (permissive throughout the dependency closure).

{ lib, pkgs }:

let
  version = "0.1.0";

  # In-repo crate, minus the local build cache. No sibling fetches — the crate
  # root IS the build root.
  agentboxOpsSrc = lib.cleanSourceWith {
    src    = ../services/agentbox-ops;
    filter = path: _type: baseNameOf (toString path) != "target";
  };

in
pkgs.rustPlatform.buildRustPackage {
  pname = "agentbox-ops";
  inherit version;
  src = agentboxOpsSrc;

  # Standalone [workspace]; the checked-in lockfile pins the full closure.
  cargoLock.lockFile = ../services/agentbox-ops/Cargo.lock;

  # No native deps: reqwest uses rustls-tls (default-features = false).

  # Unit tests are hermetic (schedule arithmetic, job lifecycle over tempdirs,
  # CPython JSON byte-shape, PVGIS projection, redaction, counters). The
  # Voyager `ast` helpers shell out to python3.
  doCheck = true;
  nativeCheckInputs = [ pkgs.python3 ];

  meta = with lib; {
    description = "Operational CLI suite for agentbox — scheduler daemon, daemon reaper, token audit, ExpeL lesson distillation, Voyager verification gate, and skill helpers (Rust port of the retired Python scripts)";
    homepage    = "https://github.com/DreamLab-AI/agentbox";
    license     = with licenses; [ mit asl20 ];
    platforms   = platforms.linux;
  };
}
