# lib/pele.nix
#
# Pinned Pele (obsidianmd/pele, MIT, no dependencies) — the only Mermaid
# renderer in the image (ADR-2154, estate decision VisionFlow ADR-2020).
#
# The npm tarball is fetched by integrity (SRI); dist/pele.js and LICENSE are
# installed beside a VERSION file carrying the sha256 that
# skills/diagrams-as-code/scripts/lib/pele-static.cjs re-verifies before every
# import. `pele-render` and the `mmdc` compatibility shim are thin wrappers that
# run the repo scripts with the image's Node and point PELE_VENDOR_DIR here.
#
# npm `pele` 1.0.0 is an unrelated 2020 package: never accept it. A version bump
# is deliberate — change `version`, `hash` and `fileSha256` together, then rerun
# the diagram corpus gate and tests/cli/pele-render.test.mjs.

{ lib, pkgs, scriptsDir ? "/opt/agentbox/scripts" }:

let
  version = "1.12.0";
  # nix-prefetch-url https://registry.npmjs.org/pele/-/pele-1.12.0.tgz (SRI form)
  hash = "sha512-3OdOK6rvkaTB569R4/I8U0H82MqPRxj7vfkbowa2rRhgSBPFhvWlfFy5eae0jP+2A6hE8abE17nsdyxJz2VBiQ==";
  # sha256 of package/dist/pele.js inside the tarball.
  fileSha256 = "111172ef3cfe3ab8fd58cba28f69e2c23f1d9f08c63db306fb9eb654a77de20b";

  src = pkgs.fetchurl {
    url = "https://registry.npmjs.org/pele/-/pele-${version}.tgz";
    inherit hash;
  };

  vendor = pkgs.runCommand "pele-vendor-${version}" { nativeBuildInputs = [ pkgs.gnutar pkgs.gzip ]; } ''
    mkdir -p unpack $out
    tar -xzf ${src} -C unpack
    actual=$(sha256sum unpack/package/dist/pele.js | cut -d' ' -f1)
    if [ "$actual" != "${fileSha256}" ]; then
      echo "pele.js sha256 $actual != pinned ${fileSha256}" >&2
      exit 1
    fi
    grep -q '"version": "${version}"' unpack/package/package.json
    install -m 0644 unpack/package/dist/pele.js $out/pele.js
    install -m 0644 unpack/package/LICENSE $out/LICENSE
    printf '{ "type": "module", "private": true }\n' > $out/package.json
    cat > $out/VERSION <<EOF2
    pele ${version}
    source   https://registry.npmjs.org/pele/-/pele-${version}.tgz
    integrity ${hash}
    file     dist/pele.js
    sha256   ${fileSha256}
    EOF2
  '';

  node = "${pkgs.nodejs_22}/bin/node";
  env = ''
    export PELE_VENDOR_DIR=${vendor}
    export PATH=${pkgs.imagemagick}/bin:$PATH
  '';
in
{
  inherit version vendor;

  peleRender = pkgs.writeShellScriptBin "pele-render" ''
    ${env}
    exec ${node} ${scriptsDir}/pele-render.cjs "$@"
  '';

  # Existing skills and validators keep calling `mmdc`.
  mmdcShim = pkgs.writeShellScriptBin "mmdc" ''
    ${env}
    exec ${node} ${scriptsDir}/mmdc-pele.cjs "$@"
  '';
}
