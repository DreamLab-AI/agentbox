# lib/bend.nix
#
# Bend 2 (https://bend-lang.com, github.com/bendlang/bend, Apache-2.0): the
# checker/compiler, its guide, the Base library and a pre-built BendTT proof
# kernel. Gated by [toolchains].bend (ADR-2191).
#
# Three derivations, one output on PATH:
#
#   bend-unwrapped  the upstream release archive, laid out as upstream expects
#                   (libexec/bend/{bin,bend2,guide}: the executable resolves
#                   ../bend2 and ../guide from its own real path).
#   bendtt-kernel   bend2/bendtt.lean compiled with the exact Lean release this
#                   Bend demands, so `bend --verdict` works with no Lean in the
#                   image and no writable ~/.bend (the rootfs is read-only).
#   bend            the `bend` launcher: pins the kernel, clang, the package
#                   cache and the update policy, then execs bend-unwrapped.
#
# Why not upstream's own flake (github:bendlang/bend)? It runs autoPatchelfHook
# over the executable. `bend` is a Bun single-file executable, and rewriting
# its RPATH moves the section Bun reads its payload from: measured 2026-11-10
# with patchelf 0.19.2, `--set-interpreter` alone runs, `--set-interpreter
# --set-rpath` segfaults at start-up. So only the interpreter is rewritten
# here, the installCheck runs the result, and nothing else touches the ELF.
#
# Bump procedure (version and hashes move together, never one without the other):
#   1. bendVersion, and both bendAssets sha256s. The installer vouches for them
#      (`curl -fsSL https://bend-lang.com/install.sh | grep -E '^(VER|SHA_LINUX)'`);
#      cross-check GitHub's recorded digests:
#        gh api repos/bendlang/bend/releases/tags/v<ver> \
#          --jq '.assets[] | select(.name|test("linux")) | "\(.name) \(.digest)"'
#   2. leanVersion. The build fails with a named message when the new Bend
#      wants a different Lean (`LEAN_VERSION` inside the executable); then set
#      leanVersion and both leanAssets sha256s the same way from
#      repos/leanprover/lean4/releases/tags/v<lean>.
#
# Supported targets: x86_64-linux, aarch64-linux. Only x86_64-linux has been
# built and run; the aarch64 hashes are GitHub's recorded digests, checked
# against the downloaded archives.

{ lib, pkgs }:

let
  bendVersion = "2.0.40";

  # The Lean release `bend --verdict` insists on: it compares `lean --version`
  # against this exact string before compiling the kernel.
  leanVersion = "4.34.0";

  bendAssets = {
    "x86_64-linux" = {
      target = "linux-x64";
      sha256 = "c9ff8d67bd903fb6ad9a26b43d8a62c01021de82a44d55ce4a3dcd4732113d6b";
    };
    "aarch64-linux" = {
      target = "linux-arm64";
      sha256 = "2f42a6fa34ecdaa71ae105e5fa734f9a07e129d333e45448ab6d2ff03a837570";
    };
  };

  leanAssets = {
    "x86_64-linux" = {
      name   = "lean-${leanVersion}-linux.tar.zst";
      sha256 = "caaa98356098c85dc0fcbbd28e1ec66f39eb6551829972b752ff20e1286b646b";
    };
    "aarch64-linux" = {
      name   = "lean-${leanVersion}-linux_aarch64.tar.zst";
      sha256 = "40b04fdb7fb849d3c80e10c3bbeebc7b7354b6d3f07450b9168c2149b40d2a82";
    };
  };

  assetFor = what: table: system:
    table.${system} or (throw ''
      lib/bend.nix: no ${what} release asset for system "${system}".
      Supported: ${lib.concatStringsSep ", " (builtins.attrNames table)}.
    '');

  # Sets the ELF interpreter to the store's dynamic linker and nothing else.
  # Used for every pre-built executable here; see the header for why the RPATH
  # is left alone.
  setInterpreter = ''
    setInterpreter() {
      patchelf --set-interpreter "$(cat "$NIX_CC/nix-support/dynamic-linker")" "$1"
    }
  '';

  makeUnwrapped = system:
    let asset = assetFor "Bend" bendAssets system;
    in pkgs.stdenv.mkDerivation {
      pname   = "bend-unwrapped";
      version = bendVersion;

      src = pkgs.fetchurl {
        url = "https://github.com/bendlang/bend/releases/download/v${bendVersion}/bend-${bendVersion}-${asset.target}.tar.gz";
        inherit (asset) sha256;
      };

      nativeBuildInputs = [ pkgs.patchelf ];

      dontBuild    = true;
      # The fixup phase would strip the executable and shrink its RPATH; both
      # rewrite the ELF around Bun's payload.
      dontStrip    = true;
      dontPatchELF = true;

      installPhase = ''
        runHook preInstall
        ${setInterpreter}
        mkdir -p $out/libexec/bend
        cp -R bin bend2 guide $out/libexec/bend/
        setInterpreter $out/libexec/bend/bin/bend
        runHook postInstall
      '';

      doInstallCheck = true;
      installCheckPhase = ''
        runHook preInstallCheck
        export HOME=$TMPDIR BEND_NO_TELEMETRY=1
        # The payload survived the interpreter rewrite and is the pinned release.
        $out/libexec/bend/bin/bend version | grep -Fx "bend ${bendVersion}"
        test -s $out/libexec/bend/bend2/base.bend
        test -s $out/libexec/bend/bend2/bendtt.lean
        test -s $out/libexec/bend/guide/GUIDE.md
        # The kernel below is compiled with leanVersion; a Bend that wants
        # another Lean would reject it at run time, so fail here instead.
        if ! grep -a -q -F 'var LEAN_VERSION = "${leanVersion}";' $out/libexec/bend/bin/bend; then
          echo "lib/bend.nix: bend ${bendVersion} no longer pins Lean ${leanVersion}." >&2
          echo "Set leanVersion and both leanAssets hashes to the release it names:" >&2
          grep -a -o -E 'var LEAN_VERSION = "[^"]+"' $out/libexec/bend/bin/bend >&2 || true
          exit 1
        fi
        runHook postInstallCheck
      '';

      meta = with lib; {
        description = "Bend 2 checker and compiler (upstream release archive)";
        homepage    = "https://bend-lang.com";
        license     = licenses.asl20;
        platforms   = builtins.attrNames bendAssets;
        sourceProvenance = [ sourceTypes.binaryNativeCode ];
      };
    };

  # BendTT's kernel, compiled the way `bend --verdict` compiles it on first use
  # (`lean -c bendtt.c bendtt.lean`, then `leanc -O3 -DNDEBUG`). Lean is a
  # build input only: the official release archive carries its own clang, lld
  # and glibc link stubs, and the kernel it produces needs nothing but glibc.
  makeKernel = system: unwrapped:
    let
      asset = assetFor "Lean" leanAssets system;
      leanTarball = pkgs.fetchurl {
        url = "https://github.com/leanprover/lean4/releases/download/v${leanVersion}/${asset.name}";
        inherit (asset) sha256;
      };
    in pkgs.stdenv.mkDerivation {
      pname   = "bendtt-kernel";
      version = "${bendVersion}-lean${leanVersion}";

      dontUnpack = true;

      nativeBuildInputs = [ pkgs.patchelf pkgs.zstd ];

      dontStrip    = true;
      dontPatchELF = true;

      buildPhase = ''
        runHook preBuild
        ${setInterpreter}
        export HOME=$TMPDIR

        # bin + lib + include are the whole toolchain; src/ and share/ are not
        # read by `lean -c` or `leanc`.
        mkdir lean
        zstd -dc ${leanTarball} | tar -x -C lean --strip-components=1 \
          --exclude='*/src' --exclude='*/share'
        # Every dynamically linked tool, not a hand-picked few: `lean` and
        # `leanc` spawn their siblings (leanir, clang, ld.lld). leantar and the
        # scripts have no interpreter to set and are skipped.
        for exe in lean/bin/*; do
          if [ ! -L "$exe" ] && patchelf --print-interpreter "$exe" >/dev/null 2>&1; then
            setInterpreter "$exe"
          fi
        done
        lean/bin/lean --version | grep -F "Lean (version ${leanVersion},"

        cp ${unwrapped}/libexec/bend/bend2/bendtt.lean .
        lean/bin/lean -c bendtt.c bendtt.lean
        lean/bin/leanc -O3 -DNDEBUG bendtt.c -o bendtt
        runHook postBuild
      '';

      installPhase = ''
        runHook preInstall
        ${setInterpreter}
        install -Dm755 bendtt $out/bin/bendtt
        setInterpreter $out/bin/bendtt
        runHook postInstall
      '';

      doInstallCheck = true;
      installCheckPhase = ''
        runHook preInstallCheck
        : > empty.bendtt
        $out/bin/bendtt empty.bendtt | grep -Fx "ALL PROOFS CHECK"
        runHook postInstallCheck
      '';

      meta = with lib; {
        description = "BendTT proof kernel for `bend --verdict`, built with Lean ${leanVersion}";
        homepage    = "https://bend-lang.com";
        license     = licenses.asl20;
        platforms   = builtins.attrNames leanAssets;
        mainProgram = "bendtt";
      };
    };

in

{
  inherit bendVersion leanVersion;

  # Build the `bend` launcher for a system string (e.g. "x86_64-linux").
  # Invoked from flake.nix when toolchainCfg.bend is enabled.
  makeBend = system:
    let
      unwrapped = makeUnwrapped system;
      kernel    = makeKernel system unwrapped;
    in pkgs.writeTextFile {
      name        = "bend-${bendVersion}";
      destination = "/bin/bend";
      executable  = true;
      text = ''
        #!${pkgs.runtimeShell}
        # bend launcher (agentbox lib/bend.nix, ADR-2191). Every setting below
        # yields to a value already in the environment.

        # `bend update` pipes bend-lang.com/install.sh into sh and installs a
        # second, unpinned copy under ~/.bend. The image pins its toolchains.
        if [ "''${1:-}" = update ]; then
          echo "bend: ${bendVersion} is pinned by the agentbox image; 'bend update' is disabled here." >&2
          echo "bend: bump bendVersion in lib/bend.nix and rebuild the image." >&2
          exit 2
        fi

        # No daily version check against bend-lang.com (set it empty to allow).
        export BEND_NO_TELEMETRY="''${BEND_NO_TELEMETRY-1}"

        # --verdict: the kernel built at image-build time. Without it Bend
        # looks for Lean ${leanVersion} and a writable ~/.bend/bendtt.
        export BENDTT="''${BENDTT:-${kernel}/bin/bendtt}"

        # Hub packages are cached under ~/.bend/lib by default; the home
        # directory is read-only here, the workspace volume is not.
        export BEND_LIB="''${BEND_LIB:-''${WORKSPACE:-$HOME/workspace}/.bend/lib}"

        # `-o <binary>` takes $CC, then `clang` (19+ for GPU calls).
        export PATH="$PATH:${lib.makeBinPath [ pkgs.clang ]}"

        exec ${unwrapped}/libexec/bend/bin/bend "$@"
      '';
      checkPhase = ''
        ${pkgs.stdenv.shellDryRun} "$target"
      '';
      meta = with lib; {
        description = "Bend 2: proof-checked language compiling to C and CUDA";
        homepage    = "https://bend-lang.com";
        license     = licenses.asl20;
        platforms   = builtins.attrNames bendAssets;
        mainProgram = "bend";
      };
      passthru = { inherit unwrapped kernel; };
    };
}
