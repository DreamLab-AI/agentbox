# lib/supersplat.nix
#
# SuperSplat Gaussian-splat editor and the splat-transform CLI (ADR-2177).
#
# Upstream: github.com/playcanvas/supersplat, github.com/playcanvas/splat-transform
# Licence:  MIT (both); NOTICE carries the entries and the bundled dependencies.
#
# `editor` is SuperSplat's static web build (rollup -> dist/), built from the
# tagged source. It is not a server: [program:supersplat] in flake.nix mirrors it
# into the served root at start and runs static-web-server over that root. The
# editor creates a WebGPU device only (no WebGL2 fallback in 3.6.0), so the
# browser needs a secure context: localhost, or an origin on the browser
# sidecar's TREAT_AS_SECURE list.
#
# `splatTransform` is the headless conversion CLI (PLY / compressed PLY / SOG /
# SPZ / filtering), packaged from the published npm tarball, which is already
# built. Its upstream lockfile records 191 dev-dependency entries with no
# `resolved`/`integrity`, so the source build cannot be prefetched; the tarball
# needs only its runtime dependencies, pinned by the committed
# splat-transform.package-lock.json (generated with `npm install
# --package-lock-only` from the tarball's package.json minus devDependencies and
# scripts, which postPatch strips the same way so the two match).
#
# The CLI imports the Dawn WebGPU addon (`webgpu`, prebuilt in its tarball) at
# top level, so every command needs it to load: autoPatchelf points it at
# libstdc++/libgcc_s. Vulkan is dlopen'd only for an actual GPU adapter; with
# `-g cpu` every format, SOG included, converts without one. The GPU-only
# features are --filter-cluster, --filter-floaters and .voxel.json output.
#
# Both builds run with --ignore-scripts: the webgpu postinstall only clears the
# macOS quarantine attribute. --legacy-peer-deps stops npm re-resolving an
# unmatched eslint peer range in the editor's tree, which needs the registry and
# fails offline in the sandbox (ENOTCACHED); its lockfile is complete, so the
# deps hash is unaffected.
#
# Hash-resolution procedure (matches lib/linkedobjects-browser.nix):
#
#   1. Update the tag/rev or tarball version below (for the CLI, regenerate
#      splat-transform.package-lock.json as above).
#   2. Set the changed src and npmDepsHash values to lib.fakeHash.
#   3. On the host: nix build .#supersplat (or .#splat-transform); copy the
#      "got:" hash from each mismatch into this file, one at a time.
#   4. Commit the resolved hashes.

{ lib, pkgs }:

let
  editorVersion = "3.6.0";
  editorRev     = "8c28d7219727c9e07be8ce8d818485e94d9206d5"; # tag v3.6.0
  editorSrcHash = "sha256-lgQlXU3yPFyYOt9oSuglV7rUoVsUvV4nzqrkkznn18U=";
  editorNpmHash = "sha256-g5f5143a3eN3zniAiCup5BtW5OJzVgxzXEwc2YZDiqE=";

  transformVersion = "3.10.3"; # git tag v3.10.3 = 4f90012be983078010d631fa0572baa99d5c1965
  # The registry's own dist.integrity for the tarball.
  transformSrcHash = "sha512-+jzoQtM1EHDwE2WKuEcaX9RGCGzk6VKnSAmOAiTB2TiNwB1kx2RhesXoSzrGvjKSKEPx6Pr/8kJhcl2WY70Ffg==";
  transformNpmHash = "sha256-3wSJvbstRUQeTnCu536a0ZueXtK9MpfLXVpwtlDH3Z0=";

  # The webgpu tarball ships one prebuilt Dawn addon per platform; keep this host's.
  dawnDir = if pkgs.stdenv.hostPlatform.isAarch64 then "linux-arm64" else "linux-x64";

  editor = pkgs.buildNpmPackage {
    pname = "supersplat";
    version = editorVersion;
    src = pkgs.fetchFromGitHub {
      owner = "playcanvas";
      repo  = "supersplat";
      rev   = editorRev;
      hash  = editorSrcHash;
    };
    npmDepsHash = editorNpmHash;
    npmFlags = [ "--ignore-scripts" "--legacy-peer-deps" ];
    # rollup.config.mjs reads BUILD_TYPE; "release" is its own default, stated
    # so a changed upstream default does not ship a debug build.
    env.BUILD_TYPE = "release";

    installPhase = ''
      runHook preInstall
      mkdir -p $out/share
      cp -r dist $out/share/supersplat
      runHook postInstall
    '';

    meta = {
      description = "SuperSplat Gaussian splat editor (static web build)";
      homepage = "https://github.com/playcanvas/supersplat";
      license = lib.licenses.mit;
      platforms = lib.platforms.linux;
    };
  };

  splatTransform = pkgs.buildNpmPackage {
    pname = "splat-transform";
    version = transformVersion;
    src = pkgs.fetchurl {
      url  = "https://registry.npmjs.org/@playcanvas/splat-transform/-/splat-transform-${transformVersion}.tgz";
      hash = transformSrcHash;
    };
    postPatch = ''
      cp ${./splat-transform.package-lock.json} package-lock.json
      ${pkgs.nodejs}/bin/node -e '
        const fs = require("fs");
        const p = JSON.parse(fs.readFileSync("package.json"));
        delete p.devDependencies; delete p.scripts;
        fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
      '
    '';
    npmDepsHash = transformNpmHash;
    npmFlags = [ "--ignore-scripts" ];
    dontNpmBuild = true; # the tarball ships dist/ already built

    nativeBuildInputs = [ pkgs.autoPatchelfHook pkgs.makeWrapper ];
    buildInputs = [ pkgs.stdenv.cc.cc.lib ];
    # Only this platform's Dawn addon can load here; the others' prebuilt binaries
    # would make autoPatchelf fail on foreign ELF and Mach-O files. linux-arm64 is
    # selected on aarch64 but has only been built and run on x86_64 so far.
    preFixup = ''
      find $out/lib/node_modules/@playcanvas/splat-transform/node_modules/webgpu/dist \
        -mindepth 1 -maxdepth 1 -type d ! -name ${dawnDir} -print0 | xargs -0 rm -r
    '';
    # Vulkan is dlopen'd by Dawn when a GPU adapter is used; the NVIDIA ICD comes
    # from the container's injected driver at run time.
    postFixup = ''
      wrapProgram $out/bin/splat-transform \
        --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath [ pkgs.vulkan-loader ]}
    '';

    meta = {
      description = "CLI for Gaussian splat conversion and processing";
      homepage = "https://github.com/playcanvas/splat-transform";
      license = lib.licenses.mit;
      mainProgram = "splat-transform";
      platforms = [ "x86_64-linux" "aarch64-linux" ];
    };
  };
in
{
  inherit editor splatTransform;
}
