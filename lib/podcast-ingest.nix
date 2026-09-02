# lib/podcast-ingest.nix
#
# Nix derivation for `podcast-ingest` — the Rust replacement for the weekly
# podcast knowledge pipeline previously in skills/podcast-knowledge-ingest
# (ingest.py, promote.py) and skills/podcast-bulk-ingest (bulk_ingest.py).
#
# Three binaries mirroring the three scripts one-for-one: transcript download,
# transcript parsing, JSON ledger maintenance and dossier assembly (ingest);
# proposal promotion into the vault working graph, gated on the Loom /health
# `ok` field (promote); and batch backfill (bulk-ingest).
#
# The ledger formats are a compatibility surface, not an implementation detail:
# ledgers written by the Python must keep loading, and the shapes this writes
# must stay byte-compatible with them. That contract is under test in the crate.
#
# yt-dlp is NOT vendored here — the ingest path still shells out to the same
# yt-dlp binary with the same arguments, which pythonRuntimeEnv in flake.nix
# continues to provide (skills/youtube-transcript-archiver needs it too).
#
# Same shape as lib/dream-engine.nix: self-contained [workspace], all deps on
# crates.io, reqwest on rustls-tls with default-features = false, so there is
# NO openssl/pkg-config buildInput.
#
# Licence: MIT OR Apache-2.0.

{ lib, pkgs }:

let
  version = "0.1.0";

  podcastIngestSrc = lib.cleanSourceWith {
    src    = ../services/podcast-ingest;
    filter = path: _type: baseNameOf (toString path) != "target";
  };

in
pkgs.rustPlatform.buildRustPackage {
  pname = "podcast-ingest";
  inherit version;
  src = podcastIngestSrc;

  cargoLock.lockFile = ../services/podcast-ingest/Cargo.lock;

  # Tests are hermetic: ledger byte-compatibility round-trips, transcript
  # parsing and dossier assembly all run against committed fixtures and
  # tempdirs. No network (no feed fetch, no Loom probe), no yt-dlp invocation.
  doCheck = true;

  meta = with lib; {
    description = "Weekly podcast knowledge-ingest pipeline for agentbox — transcript download and parsing, byte-compatible JSON ledgers, dossier assembly, and Loom-health-gated promotion into the vault working graph";
    homepage    = "https://github.com/DreamLab-AI/agentbox";
    license     = with licenses; [ mit asl20 ];
    mainProgram = "podcast-ingest";
    platforms   = platforms.linux;
  };
}
