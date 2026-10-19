#!/usr/bin/env bash
# Static gate for the CUDA host-compiler fix: build.rs-driven CUDA crates spawn
# plain `nvcc`, so the image must provide an `nvcc` wrapper that passes
# -ccbin <gcc <= 14> and -I$CUDA_PATH/include (CUDA 12.9 supports GCC <= 14;
# the system gcc is newer). Nothing here builds or needs nix: it reads
# lib/gpu-backend.nix, flake.nix, the entrypoint and system-manifest.js, and
# renders the wrapper body against a fake toolkit to exercise its argument logic.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${HERE}/../.."
NIX="${ROOT}/lib/gpu-backend.nix"
PASS=0; FAIL=0
_ok()  { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
_bad() { FAIL=$((FAIL + 1)); printf 'FAIL  %s\n' "$1"; }
_has() { grep -Eq -- "$2" "$1" && _ok "$3" || _bad "$3"; }

_has "$NIX" 'nvccWrapper = pkgs\.writeShellScriptBin "nvcc"' "wrapper derivation named nvcc exists"
_has "$NIX" '^[[:space:]]+-ccbin' "wrapper recognises -ccbin"
_has "$NIX" 'set -- -ccbin ' "wrapper injects -ccbin"
_has "$NIX" 'CUDA_PATH:-' "wrapper injects -I\$CUDA_PATH/include"

GCCV="$(sed -n 's/^[[:space:]]*nvccHostGcc = pkgs\.gcc\([0-9]\+\);.*/\1/p' "$NIX")"
if [ -n "$GCCV" ] && [ "$GCCV" -le 14 ] && [ "$GCCV" -ge 11 ]; then
  _ok "nvcc host compiler is gcc${GCCV} (<= 14)"
else
  _bad "nvccHostGcc must be pkgs.gcc<N> with N <= 14 (got '${GCCV}')"
fi

_has "$NIX" 'NVCC_CCBIN +=' "NVCC_CCBIN set in supervisorExtraEnv"
_has "$NIX" 'CUDAHOSTCXX +=' "CUDAHOSTCXX set in supervisorExtraEnv"
_has "$NIX" 'CUDA_PATH +=  *"\$\{cudaCompat\}"' "CUDA_PATH points at the merged output"
_has "$NIX" 'ln -s \$\{nvccWrapper\}/bin/nvcc \$out/bin/nvcc' "\$CUDA_PATH/bin/nvcc is the wrapper"
# Inside the local-cuda branch only (cudaEligible gate): the wrapper leads the
# package list and gcc14 is kept off PATH so the default compiler is unchanged.
LIST="$(sed -n '/baseCudaPackages = lib.optionals cudaEligible/,/\]);/p' "$NIX")"
printf '%s\n' "$LIST" | grep -v '^[[:space:]]*#' | grep -q 'nvccWrapper' \
  && _ok "wrapper is in the gated local-cuda package list" || _bad "wrapper missing from baseCudaPackages"
printf '%s\n' "$LIST" | grep -v '^[[:space:]]*#' | grep -q 'nvccHostGcc\|gcc14' \
  && _bad "gcc14 must not be on PATH (default compiler unchanged)" || _ok "gcc14 not added to PATH"

_has "${ROOT}/flake.nix" 'ln -s \$\{gpuCfg\.nvccWrapper\}/bin/nvcc \$out/opt/agentbox/bin/nvcc' "stable /opt/agentbox/bin/nvcc link"
_has "${ROOT}/config/entrypoint-unified.sh" 'for var in CUDA_PATH .*NVCC_CCBIN CUDAHOSTCXX' "entrypoint propagates NVCC_CCBIN/CUDAHOSTCXX to runtime env"
_has "${ROOT}/management-api/lib/system-manifest.js" "id: 'cuda'" "system-manifest cuda entry present"
grep -A3 "id: 'cuda'" "${ROOT}/management-api/lib/system-manifest.js" | grep -q "apply_class: 'rebuild'" \
  && _ok "cuda entry is rebuild-class" || _bad "cuda entry must be rebuild-class"
_has "${ROOT}/docs/BASELINE-container.md" 'nvcc` wrapper' "CUDA toolchain documented"

# Behavioural: render the wrapper body against a fake toolkit and gcc.
TMP="$(mktemp -d "${TMPDIR:-/tmp}/nvcc-wrap.XXXXXX")"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/tk/bin" "$TMP/gcc/bin"
printf '#!/bin/sh\nprintf "%%s\\n" "$@"\n' >"$TMP/tk/bin/nvcc"; chmod +x "$TMP/tk/bin/nvcc"
sed -n '/writeShellScriptBin "nvcc"/,/^      '"''"';/p' "$NIX" | sed '1d;$d' \
  | sed -e "s#''\\\${#\${#g" -e "s#\\\${nvccHostGcc}#$TMP/gcc#g" -e "s#\\\${cudaToolkit}#$TMP/tk#g" >"$TMP/nvcc"
if bash -n "$TMP/nvcc" 2>/dev/null; then
  OUT="$(env -u NVCC_CCBIN -u CUDA_PATH bash "$TMP/nvcc" -ptx x.cu)"
  printf '%s\n' "$OUT" | grep -qx -- "-ccbin" && printf '%s\n' "$OUT" | grep -qx "$TMP/gcc/bin/gcc" \
    && _ok "default -ccbin is the baked gcc" || _bad "default -ccbin missing"
  printf '%s\n' "$OUT" | grep -qx -- "-I$TMP/tk/include" && _ok "default -I is the toolkit include" || _bad "default -I missing"
  OUT="$(env -u NVCC_CCBIN CUDA_PATH=/cp bash "$TMP/nvcc" x.cu)"
  printf '%s\n' "$OUT" | grep -qx -- "-I/cp/include" && _ok "CUDA_PATH overrides -I" || _bad "CUDA_PATH override"
  OUT="$(NVCC_CCBIN=/o/gcc bash "$TMP/nvcc" x.cu)"
  printf '%s\n' "$OUT" | grep -qx "/o/gcc" && _ok "NVCC_CCBIN overrides -ccbin" || _bad "NVCC_CCBIN override"
  OUT="$(bash "$TMP/nvcc" --compiler-bindir /my/g++ x.cu)"
  [ "$(printf '%s\n' "$OUT" | grep -c -- 'ccbin\|compiler-bindir')" = 1 ] \
    && _ok "caller-supplied --compiler-bindir is not doubled" || _bad "caller --compiler-bindir doubled"
else
  _bad "rendered wrapper does not parse"
fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
