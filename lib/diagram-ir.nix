# lib/diagram-ir.nix
#
# Nix derivation for `diagram-ir` — the deterministic draw.io / Mermaid
# extractors and the accessible-diagram self-check that back the
# `diagram-design` and `mermaid-diagrams` skills.
#
# This replaces three Python scripts that used to ship inside the skill
# (scripts/drawio_extract.py, scripts/mermaid_extract.py, scripts/self_check.py).
# The skills now invoke the baked binaries `drawio-extract`, `mermaid-extract`
# and `diagram-self-check` on PATH, so a skill consumer needs no Python runtime.
#
# Three binaries, one library:
#   drawio-extract      .drawio/.xml → normalised IR JSON (handles the
#                       zlib+base64 "compressed diagram" payload inline via
#                       flate2/base64 — no shelling out, no draw.io install)
#   mermaid-extract     Mermaid source → the same IR JSON shape
#   diagram-self-check  accessible-SVG contract, single-file safety, motion rules
#
# Trust boundary: every entry point parses bounded text or bytes. Nothing
# evaluates, renders, fetches or executes its input — no network, no
# subprocesses, no DTD or external-entity expansion, and hard caps on input
# size, decompressed size, node count and edge count. That is why this is a
# parser port rather than a wrapper: there is no upstream renderer to call.
#
# Like lib/dream-engine.nix this is a self-contained [workspace] with all
# dependencies on crates.io, so there are no sibling path-deps to fetch and no
# workspace reassembly. Pure-Rust dependency closure (quick-xml, flate2 with the
# rust_backend, base64, serde_json, regex, clap) — no openssl, no pkg-config,
# no native buildInputs. The checked-in Cargo.lock pins the whole closure.
#
# Tests are hermetic (fixtures on disk, golden parity against the retired
# Python's recorded output; no network, no subprocesses), so doCheck = true
# runs them in the sandbox.
#
# Licence: MIT OR Apache-2.0 (crate and whole dependency closure permissive).

{ lib, pkgs }:

let
  version = "0.1.0";

  # In-repo crate, minus the local build cache. The crate root IS the build root.
  diagramIrSrc = lib.cleanSourceWith {
    src    = ../services/diagram-ir;
    filter = path: _type: baseNameOf (toString path) != "target";
  };

in
pkgs.rustPlatform.buildRustPackage {
  pname = "diagram-ir";
  inherit version;
  src = diagramIrSrc;

  # Standalone [workspace]; the checked-in lockfile pins the full closure.
  cargoLock.lockFile = ../services/diagram-ir/Cargo.lock;

  # No native deps: the closure is pure Rust (flate2 uses its rust_backend).

  # Hermetic: parser unit tests, grammar tests and golden-parity fixtures.
  doCheck = true;

  meta = with lib; {
    description = "Deterministic draw.io and Mermaid to normalised diagram IR extractors, plus the accessible-diagram self-check, for agentbox's diagram-design skill";
    homepage    = "https://github.com/DreamLab-AI/agentbox";
    license     = with licenses; [ mit asl20 ];
    mainProgram = "diagram-self-check";
    platforms   = platforms.linux;
  };
}
