# lib/ontology-tools.nix
#
# Nix derivation for `ontology-tools` — the Rust replacement for the Python in
# skills/ontology-core/src (OntologyBlock markdown parse/validate/modify) and
# skills/ontology-enrich/src (wiki-link validation, Perplexity client,
# enrichment workflow orchestration).
#
# Note on scope, because the name invites a wrong assumption: this is NOT an OWL
# ontology parser and it is NOT a twin of VisionClaw's `visionclaw-ontology`
# crate. It parses the vault corpus's `- field:: value` OntologyBlock property
# blocks and validates OWL2 functional-syntax axioms embedded in fenced blocks —
# a text/regex layer above RDF, not an RDF layer. `visionclaw-ontology` was
# evaluated and deliberately not reused: it is AGPL-3.0-only (agentbox ships
# MIT/Apache), it path-deps `visionclaw-domain` so it cannot be consumed as a
# git dependency from a standalone agentbox checkout, and it solves the
# different problem of horned-owl OWL parsing.
#
# Same shape as lib/dream-engine.nix: the crate is a self-contained [workspace]
# with all dependencies on crates.io, so there are no sibling path-deps to
# fetch and no workspace reassembly. reqwest is pinned to rustls-tls with
# default-features = false, so there is NO openssl/pkg-config buildInput.
#
# Licence: MIT OR Apache-2.0.

{ lib, pkgs }:

let
  version = "0.1.0";

  ontologyToolsSrc = lib.cleanSourceWith {
    src    = ../services/ontology-tools;
    filter = path: _type: baseNameOf (toString path) != "target";
  };

in
pkgs.rustPlatform.buildRustPackage {
  pname = "ontology-tools";
  inherit version;
  src = ontologyToolsSrc;

  cargoLock.lockFile = ../services/ontology-tools/Cargo.lock;

  # Tests are hermetic: parser round-trip identity, field preservation, OWL2
  # axiom validation and link-validation all run against in-test fixtures and
  # tempdirs. No network, no database.
  doCheck = true;

  meta = with lib; {
    description = "Vault OntologyBlock parser/validator/modifier with zero-data-loss round-tripping, plus wiki-link validation and Perplexity-backed enrichment (replaces the ontology-core and ontology-enrich Python)";
    homepage    = "https://github.com/DreamLab-AI/agentbox";
    license     = with licenses; [ mit asl20 ];
    mainProgram = "ontology-tools";
    platforms   = platforms.linux;
  };
}
