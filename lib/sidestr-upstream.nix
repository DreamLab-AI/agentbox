# lib/sidestr-upstream.nix
#
# The sidestr producer's consensus code, baked at the commits in
# config/sidechain/upstream-pins (custody design §2.7, owner Q7; ADR-2103).
# Linked at /opt/agentbox/sidestr/upstream when [sidechain].enabled, and run by
# config/sidechain/run-producer.sh by default.
#
# Why baked and not run from the workspace checkouts: the producer holds the
# chain's signing key, and code its user can edit can exfiltrate that key. The
# old pin check compared `git rev-parse HEAD`, so an uncommitted edit to a
# checkout passed it. A /nix/store tree is root-owned on a read-only rootfs:
# nothing in the container can change it, and the pin becomes structural.
#
# The output is one tree laid out as run-producer.sh expects:
#   spec/           sidestr/spec (siding, the reference engine)
#   schema/         bitcoin-desktop/schema (the kernel siding loads via SCHEMA)
#   blaketestnode/  bitcoin-blake/blaketestnode (block files, via BLAKETESTNODE)
# Each directory carries .pin-commit, the commit it was fetched at; the runner
# refuses to start when any differs from upstream-pins (a stale bake).
#
# node_modules: none. siding imports only node: builtins on the producer path.
# Its package.json names five @ethereumjs packages, but evm.mjs imports them
# lazily and only for a chain whose document names the `evm` rule; neither
# estate chain (config/sidechain/*/chain.json) has a `rules` key. blaketestnode's
# one dependency, webtorrent, is imported only by lib/fetch.mjs, which the
# producer never loads. The hand-placed @ethereumjs/common in the workspace
# checkout was never sufficient for the rule anyway (it needs vm, tx, block,
# util and statemanager). run-producer.sh refuses an evm chain on this bake;
# adopting the rule means baking siding/package-lock.json here first.
#
# To bump: move the line in upstream-pins (only after a block on the new
# commit, as that file says), then set the same `rev` here and refresh `hash`
# (nix-prefetch-url --unpack https://github.com/<owner>/<repo>/archive/<rev>.tar.gz,
# then `nix hash convert --to sri`). Evaluation fails while the two disagree.
#
# Licence of this file: AGPL-3.0-only, the same as agentbox. The fetched trees
# keep their own (spec: see its LICENSE; schema: AGPL-3.0-or-later;
# blaketestnode: MIT).

{ lib, pkgs, pinsFile }:

let
  # Hashes are fetchFromGitHub narHashes of each commit's GitHub tarball.
  upstreams = {
    spec = {
      owner = "sidestr";
      repo  = "spec";
      rev   = "e8deb63161c7459ed39c01d2ca9fda3d860b65b6";
      hash  = "sha256-ZCk7VtqVg7vo4Gg7MR6fBW2kZW/uPJ8W7OQbNwsi0XA=";
    };
    schema = {
      owner = "bitcoin-desktop";
      repo  = "schema";
      rev   = "b8cbf6337c7450fe14ddc5bce00c7280059aab5d";
      hash  = "sha256-FidkmSgBdY0JIitAok9/g1ea/K/qAO2rTtea2Ro3Jp0=";
    };
    blaketestnode = {
      owner = "bitcoin-blake";
      repo  = "blaketestnode";
      rev   = "de33b347ccde458f5b82c33b3bab16abd328a7ec";
      hash  = "sha256-xATkIUSxg8EW0493YL68Aa8sLIuRfpKGd2nnnDb+FfE=";
    };
  };

  # upstream-pins: `<directory> <commit>  # comment` per line.
  fields = l: lib.filter (f: builtins.isString f && f != "") (builtins.split "[[:space:]]+" l);
  pinEntries = lib.filter (f: f != [ ] && !(lib.hasPrefix "#" (builtins.head f)))
    (map fields (lib.splitString "\n" (builtins.readFile pinsFile)));
  pins = builtins.listToAttrs (map (f:
    { name = builtins.elemAt f 0; value = builtins.elemAt f 1; }) pinEntries);

  checked =
    if lib.attrNames pins != lib.attrNames upstreams then
      throw "lib/sidestr-upstream.nix bakes ${toString (lib.attrNames upstreams)} but upstream-pins names ${toString (lib.attrNames pins)}"
    else lib.mapAttrs (dir: u:
      if pins.${dir} != u.rev then
        throw "lib/sidestr-upstream.nix bakes ${dir} at ${u.rev} but upstream-pins says ${pins.${dir}}; move rev and hash together"
      else u) upstreams;

  srcs = lib.mapAttrs (_: u: pkgs.fetchFromGitHub { inherit (u) owner repo rev hash; }) checked;

in
pkgs.runCommand "sidestr-upstream-${builtins.substring 0 8 checked.spec.rev}" {
  passthru = { inherit srcs; pins = lib.mapAttrs (_: u: u.rev) checked; };
  meta = {
    description = "sidestr producer upstream (spec, schema, blaketestnode) at config/sidechain/upstream-pins";
    platforms = lib.platforms.all;
  };
} ''
  mkdir -p $out
  ${lib.concatStrings (lib.mapAttrsToList (dir: src: ''
    cp -r ${src} $out/${dir}
    chmod -R u+w $out/${dir}
    printf '%s\n' ${checked.${dir}.rev} > $out/${dir}/.pin-commit
  '') srcs)}
''
