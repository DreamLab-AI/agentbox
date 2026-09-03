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

  # The crate lives in its own repository (extracted from services/ with full
  # history on 2026-09-03) and is published to crates.io as `diagram-ir`.
  # Agentbox consumes the tagged source so the three binaries are built and
  # tested here. The canonical motion controller is compiled into the crate
  # (assets/template-motion.html), so the self-check needs no skill checkout.
  #
  # To bump: move `rev` to the new tag, refresh `hash` (nix-prefetch-url
  # --unpack on the tag tarball, then `nix hash convert --to sri`), and copy
  # the tag's Cargo.lock to lib/lockfiles/diagram-ir-<version>.Cargo.lock.
  diagramIrSrc = pkgs.fetchFromGitHub {
    owner = "DreamLab-AI";
    repo  = "diagram-ir";
    rev   = "v${version}";
    hash  = "sha256-GCWhD/o223quC2P8HVSSQNG2WiB/LztsRsebU26hGtg=";
  };

in
pkgs.rustPlatform.buildRustPackage {
  pname = "diagram-ir";
  inherit version;
  src = diagramIrSrc;

  # The tag's lockfile, vendored so evaluation never reads from the fetched
  # tree (no import-from-derivation). Byte-identical to Cargo.lock at `rev`.
  cargoLock.lockFile = ./lockfiles/diagram-ir-${version}.Cargo.lock;

  # No native deps: the closure is pure Rust (flate2 uses its rust_backend).

  # Hermetic: parser unit tests, grammar tests and golden-parity fixtures.
  doCheck = true;

  meta = with lib; {
    description = "Deterministic draw.io and Mermaid to normalised diagram IR extractors, plus the accessible-diagram self-check, for agentbox's diagram-design skill";
    homepage    = "https://github.com/DreamLab-AI/diagram-ir";
    license     = with licenses; [ mit asl20 ];
    mainProgram = "diagram-self-check";
    platforms   = platforms.linux;
  };
}
