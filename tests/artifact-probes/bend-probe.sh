#!/bin/bash
# Probe: Bend 2 toolchain (bend launcher, clang native build, BendTT kernel; ADR-2191)
# Gate: toolchains.bend / ENABLE_BEND

set -euo pipefail

if [ "${ENABLE_BEND:-false}" != "true" ]; then
  echo "SKIP: ENABLE_BEND not set"
  exit 77
fi

if ! command -v bend &>/dev/null; then
  echo "FAIL: bend not found in PATH"
  exit 1
fi

if ! bend version | grep -Eq '^bend [0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "FAIL: bend version did not print a version"
  exit 1
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/bend-probe.XXXXXX")
trap 'rm -rf "$work"' EXIT
cd "$work"

cat > hello.bend <<'BEND'
import Base

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("Hello, world!")
BEND

if [ "$(bend hello.bend)" != "Hello, world!" ]; then
  echo "FAIL: bend did not check and run hello.bend"
  exit 1
fi

# Native build: the launcher must reach a clang.
if ! bend hello.bend -o hello || [ "$(./hello)" != "Hello, world!" ]; then
  echo "FAIL: bend -o did not produce a working native binary"
  exit 1
fi

# Kernel recheck: the baked BendTT kernel, no Lean and no writable ~/.bend.
if [ "$(bend hello.bend --verdict)" != "ALL PROOFS CHECK" ]; then
  echo "FAIL: bend --verdict did not pass through the baked kernel"
  exit 1
fi

# The image pins its toolchains; the launcher refuses the self-updater.
# Exit 2 is the launcher's own refusal; any other status means the upstream
# updater was reached (and merely failed, for example offline).
rc=0
bend update >/dev/null 2>&1 || rc=$?
if [ "$rc" -ne 2 ]; then
  echo "FAIL: bend update was not refused by the launcher (exit $rc)"
  exit 1
fi

echo "PASS: bend checks, runs, builds natively and rechecks with the kernel"
exit 0
