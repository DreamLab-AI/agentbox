---
id: ADR-2191
title: Bend is baked from the pinned upstream release, with the proof kernel built at image-build time
date: 2026-11-10
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 571c0ad436230a4ff3d0da4c0e344282417ba259
verified_paths: [lib/bend.nix, tests/artifact-probes/bend-probe.sh]
owner: jjohare
review_trigger: a Bend pin bump (it may change the Lean release Bend demands); the first aarch64 image build; a request for Bend windowing or audio programs; any proposal to make the home directory writable for ~/.bend
repo: agentbox
domain: BASELINE-container
relates: []
---

# ADR-2191: Bend is baked from the pinned upstream release, with the proof kernel built at image-build time

## Context

Bend 2 (`bendlang/bend`, Apache-2.0) is a proof-checked language that compiles to C for
the CPU and to CUDA for the GPU. Upstream ships it three ways, and none fits the image
as it stands:

- `curl | sh` installs into `~/.bend` and `bend update` repeats it. The rootfs is
  read-only and the image pins its toolchains.
- `bend` is a Bun single-file executable. Upstream's own flake runs `autoPatchelfHook`
  over it; with patchelf 0.19.2 that rewrite makes the executable segfault at start-up.
  Rewriting only the interpreter does not.
- `bend --verdict` rechecks proofs with BendTT, a kernel written in Lean. On first use
  Bend compiles it with one exact Lean release (4.34.0 for Bend 2.0.40; nixpkgs carries
  4.35.0) and caches it in `~/.bend/bendtt`, which cannot be written here.

## Decision

1. **Gate**: `[toolchains].bend` (rebuild class, on). `lib/bend.nix` holds the pins and
   every derivation; `flake.nix` adds the result to the package set and exports
   `ENABLE_BEND`.
2. **Compiler**: the upstream release archive, fetched by its published SHA-256, laid out
   as `libexec/bend/{bin,bend2,guide}` because the executable resolves its library and
   guide relative to its own path. Only the ELF interpreter is rewritten. The derivation
   runs `bend version` and fails unless it prints the pinned version.
3. **Kernel**: `bend2/bendtt.lean` is compiled at image-build time with the official Lean
   release archive of the exact version Bend names, using the commands Bend itself runs.
   The launcher points `BENDTT` at the result. Lean is a build input and is not in the
   image. The compiler derivation fails, naming the wanted version, when a Bend bump
   changes the Lean it demands.
4. **Launcher**: `bend` on PATH is a script that sets `BENDTT`, sets `BEND_NO_TELEMETRY=1`
   (no daily version check against bend-lang.com), puts `BEND_LIB` at
   `$WORKSPACE/.bend/lib` (the hub package cache), appends a clang to PATH for `-o`
   builds, and refuses `bend update`. Each setting yields to one already in the
   environment.
5. **GPU**: nothing is added. Bend finds the toolkit through `$CUDA_PATH`, which
   `[toolchains].cuda` already exports; without it `!` calls run on the CPU.
6. **Bumps are manual**: version and both archive hashes move together (procedure in the
   file header). `scripts/check-upstream-releases.sh` reports the pinned and latest
   versions. No Renovate rule: it would move the version without the hashes.

## Consequences

- `bend file.bend`, `-o` to a native binary, C or JS, `--verdict`, `bend guide` and
  `bend base` work offline with no state in the home directory.
- `bend login`, and so `--publish <name>@<version>`, does not work: it writes
  `~/.bend/bendai.json`. A publish to the hub is public and permanent, so leaving it off
  is the safe default. Hash-only `--publish` and hub imports still reach
  `hub.bend-lang.com`.
- Programs that open a window or play audio need X11 and ALSA development libraries the
  image does not carry.
- The image build fetches the Lean archive (580 MB) once and spends about a minute
  compiling the kernel. The image gains the 92 MB executable and the 5.5 MB kernel.
- The interpreter-only rewrite depends on how Bun lays out its payload. The install
  check catches a release where that stops working.
- Only x86_64 was run. The aarch64 hashes are GitHub's recorded digests; the first
  aarch64 build is the test.

## Verification

In the running container on 2026-11-10, before the change was committed (nothing is
claimed about a built image):

- The four archives match the SHA-256 values in upstream's installer and GitHub's
  recorded asset digests.
- An interpreter-only patched copy of `bend` prints `bend 2.0.40` under `env -i` with a
  missing home directory; the same copy with its RPATH also set segfaults.
- The kernel build steps of `lib/bend.nix`, run under `env -i` with only coreutils, tar,
  grep, zstd and patchelf on PATH, produce a kernel that needs only glibc and answers
  `ALL PROOFS CHECK`.
- The launcher text, rendered from `lib/bend.nix` with those paths, passes
  `tests/artifact-probes/bend-probe.sh` with a read-only home and no clang on PATH:
  check and run, native build, `--verdict`, and the refused `bend update`.
- A GPU program (`pow2!(20n)` from the guide) builds its `.gpu` half against the
  image's CUDA toolkit with no extra configuration and prints `1048576`, with no
  missing-toolkit notice. Whether the call ran on the GPU or the CPU was not measured.

At `571c0ad43` (PR #45) CI evaluated the flake on x86_64-linux and aarch64-linux
(`nix flake check --no-build`, and `nix eval .#runtime.drvPath` with the gate on), so the
Bend derivations evaluate on both. The checks listed above were run on the same file
contents before that commit.

Not established: that `nix build .#runtime` succeeds. Nothing has been built by Nix, in
CI or on the host. The record moves to `complete` and `live` after the host rebuild
passes the probe.
