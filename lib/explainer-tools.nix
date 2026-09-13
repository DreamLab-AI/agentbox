# lib/explainer-tools.nix
#
# Nix derivation for `explainer-tools` — the Rust tooling of the `explainer`
# skill, replacing the Node scripts it used to carry.
#
# Today it ships one binary:
#
#   explainer-loom-draft   draft explainer sections on the LAN model through
#                          the Ontology Loom façade (was scripts/loom-draft.mjs)
#
# The façade protocol itself is NOT reimplemented here: it comes from the
# published `loom-client` crate, which is also what services/dream-engine and
# services/podcast-ingest use. That crate is the one place that knows a façade
# can answer HTTP 200 with ontology prose instead of a model answer, or
# truncate a reasoning model into empty content — three callers used to know
# three different subsets of that.
#
# Same shape as lib/skill-tools.nix: self-contained [workspace], all deps on
# crates.io, reqwest on rustls-tls via loom-client's own pinning, so there is
# NO openssl/pkg-config buildInput.
#
# Licence: MIT OR Apache-2.0.

{ lib, pkgs }:

let
  version = "0.1.0";

  explainerToolsSrc = lib.cleanSourceWith {
    src    = ../services/explainer-tools;
    filter = path: _type: baseNameOf (toString path) != "target";
  };

in
pkgs.rustPlatform.buildRustPackage {
  pname = "explainer-tools";
  inherit version;
  src = explainerToolsSrc;

  cargoLock.lockFile = ../services/explainer-tools/Cargo.lock;

  # The end-to-end tests stand up a wiremock server on loopback and run the
  # built binary against it. Hermetic — no network beyond 127.0.0.1, no model.
  doCheck = true;

  meta = with lib; {
    description = "Explainer skill tooling for agentbox — façade-backed section drafting via loom-client";
    homepage    = "https://github.com/DreamLab-AI/agentbox";
    license     = with licenses; [ mit asl20 ];
    platforms   = platforms.linux;
  };
}
