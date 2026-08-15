# lib/dream-engine.nix
#
# Nix derivation for agentbox's `dream-engine` daemon — the "dream machine":
# nightly evidence-gated repository evolution against nominated workspace repos.
# It discovers repos carrying a `dream.config.json` marker, compiles a
# deterministic nightly prompt, dispatches the build + evaluators to the
# HP-Desktop annexe over SSH (control plane here, execution plane on HP —
# ADR-052), calls an LLM (Z.AI GLM by default, self-hosted Loom façade as the
# fallback), parses an ACCEPT/REJECT/INCONCLUSIVE verdict, appends a ledger row
# in the target repo, computes a witness = sha256(sha256(report)+commit), and
# stores significant findings to RuVector. Full narrative:
# docs/developer/dream-engine.md.
#
# This replaces scripts/dream-machine-nightly.mjs — the .mjs orchestrator is now
# the LEGACY FALLBACK, kept for manual invocation and rollback only; the Rust
# binary is the supervised, first-party path.
#
# Simpler than lib/nostr-pod-bridge.nix: the crate is a self-contained
# [workspace] with all dependencies on crates.io, so there are NO sibling
# path-deps to fetch, no workspace reassembly, and — because reqwest is pinned
# to rustls-tls with default-features=false — NO openssl/pkg-config buildInputs.
# The checked-in Cargo.lock pins the whole closure; tests are hermetic (no
# network, no DB), so doCheck = true runs them in the sandbox.
#
# Licence: MIT OR Apache-2.0 (the crate and its whole dependency closure are
# permissive — no copyleft aggregation, unlike the pod bridge).

{ lib, pkgs }:

let
  version = "0.1.0";

  # In-repo crate, minus the local build cache. No sibling fetches, no
  # workspace reassembly — the crate root IS the build root.
  dreamEngineSrc = lib.cleanSourceWith {
    src    = ../services/dream-engine;
    filter = path: _type: baseNameOf (toString path) != "target";
  };

in
pkgs.rustPlatform.buildRustPackage {
  pname = "dream-engine";
  inherit version;
  src = dreamEngineSrc;

  # Standalone [workspace]; the checked-in lockfile pins the full closure.
  cargoLock.lockFile = ../services/dream-engine/Cargo.lock;

  # No native deps: reqwest uses rustls-tls (default-features=false), so there
  # is no openssl link and no pkg-config probe.

  # Tests are hermetic (config parsing, slot rotation, witness hashing,
  # conninfo→URL, verdict parsing — no network, no Postgres). 48/48 green.
  doCheck = true;

  meta = with lib; {
    description = "Nightly evidence-gated repository evolution engine for agentbox (HP annexe, ADR-052) — compiles config into deterministic prompts, dispatches to HP, calls an LLM, parses verdicts, persists ledger + witness + RuVector";
    homepage    = "https://github.com/DreamLab-AI/agentbox";
    license     = with licenses; [ mit asl20 ];
    mainProgram = "dream-engine";
    platforms   = platforms.linux;
  };
}
