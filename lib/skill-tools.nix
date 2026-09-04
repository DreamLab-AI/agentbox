# lib/skill-tools.nix
#
# Nix derivation for `skill-tools` — one crate, several binaries, replacing the
# stdlib-only Python tooling of three skills:
#
#   ui-ux-pro-max   BM25 search over the style-guide corpus
#   wardley-maps    JSON -> D3 HTML map generation, heuristics tables, strategic analysis
#   docs-alignment  markdown link validation, mermaid checking, ASCII-diagram detection
#
# Two Python files in this territory deliberately survive and are NOT replaced
# here: skills/wardley-maps/tools/advanced_nlp_parser.py needs spaCy NER (no
# Rust equivalent worth the effort), so the ported tools shell out to it on the
# NLP path exactly as before; and the excluded docs-alignment scripts are
# handled as dead code elsewhere in this programme.
#
# BM25 is implemented directly rather than pulled from a search-engine crate:
# the ranking has to stay identical to the Python's k1/b constants and
# tokenisation, and that equivalence is under test in the crate.
#
# Same shape as lib/dream-engine.nix: self-contained [workspace], all deps on
# crates.io, reqwest on rustls-tls with default-features = false, so there is
# NO openssl/pkg-config buildInput.
#
# Licence: MIT OR Apache-2.0.

{ lib, pkgs }:

let
  version = "0.1.0";

  skillToolsSrc = lib.cleanSourceWith {
    src    = ../services/skill-tools;
    filter = path: _type: baseNameOf (toString path) != "target";
  };

  # `skill-tools` embeds the canonical ui-ux-pro-max CSV corpus with
  # include_str! paths that reach outside the crate when built from the repo.
  # The clean crate source above is isolated in the Nix sandbox, so stage the
  # same tracked corpus inside the build tree during patchPhase.
  uiuxDataSrc = lib.cleanSource ../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data;

in
pkgs.rustPlatform.buildRustPackage {
  pname = "skill-tools";
  inherit version;
  src = skillToolsSrc;

  cargoLock.lockFile = ../services/skill-tools/Cargo.lock;

  postPatch = ''
    mkdir -p uiux-data
    cp -R ${uiuxDataSrc}/. uiux-data/
    substituteInPlace src/uiux/data.rs \
      --replace-fail \
        '../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/' \
        '../../uiux-data/'
  '';

  # Two documented fallback paths still invoke Python scripts. Keep Python
  # build-time-only so their process contract is tested without adding it to
  # the skill-tools runtime closure.
  nativeCheckInputs = [ pkgs.python3 ];

  # Tests are hermetic: BM25 ranking equivalence against a fixed corpus, map
  # generation, and the docs-alignment checkers over in-test fixtures. Link
  # validation is exercised on local/relative links only — no network.
  doCheck = true;

  meta = with lib; {
    description = "Skill support binaries for agentbox — ui-ux-pro-max BM25 style-guide search, Wardley map generation and strategic analysis, and docs-alignment link/mermaid/ASCII checking";
    homepage    = "https://github.com/DreamLab-AI/agentbox";
    license     = with licenses; [ mit asl20 ];
    platforms   = platforms.linux;
  };
}
