#!/usr/bin/env bash
# scripts/sync-fixtures.sh — agentbox substrate
#
# Per ADR-082 D5: agentbox consumes cross-substrate fixtures from VisionClaw
# (the master host). This script clones VisionClaw, copies docs/specs/fixtures/
# into tests/contract/upstream_vectors/, and writes CHECKSUM.txt for CI drift
# detection.
#
# Usage:
#   scripts/sync-fixtures.sh                    # full sync
#   scripts/sync-fixtures.sh --verify           # CI gate: exit non-zero on drift
#   VISIONCLAW_FIXTURES_PATH=/local/path \
#     scripts/sync-fixtures.sh                  # offline / local-monorepo dev
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$REPO_ROOT/tests/contract/upstream_vectors"
SOURCE="${VISIONCLAW_FIXTURES_PATH:-https://github.com/DreamLab-AI/VisionClaw.git}"

mkdir -p "$TARGET_DIR"

case "${1:-}" in
  --verify)
    # CI mode: do not fetch; only verify our local CHECKSUM.txt consistency.
    if [ ! -f "$TARGET_DIR/CHECKSUM.txt" ]; then
      echo "ERROR: $TARGET_DIR/CHECKSUM.txt missing — run sync-fixtures.sh first" >&2
      exit 1
    fi
    cd "$TARGET_DIR"
    sha256sum -c CHECKSUM.txt --quiet
    echo "OK: $(wc -l < CHECKSUM.txt) fixture file(s) match recorded checksums."
    exit 0
    ;;
esac

# Fetch master fixtures.
if [[ "$SOURCE" =~ ^https://.*\.git$ ]]; then
  TMPDIR=$(mktemp -d)
  trap "rm -rf $TMPDIR" EXIT
  git clone --depth=1 --filter=blob:none --sparse --quiet "$SOURCE" "$TMPDIR"
  (cd "$TMPDIR" && git sparse-checkout add docs/specs/fixtures)
  rsync -a --delete --exclude='CHECKSUM.txt' \
    "$TMPDIR/docs/specs/fixtures/" "$TARGET_DIR/"
else
  if [ ! -d "$SOURCE/docs/specs/fixtures" ]; then
    echo "ERROR: VISIONCLAW_FIXTURES_PATH=$SOURCE has no docs/specs/fixtures/" >&2
    exit 1
  fi
  rsync -a --delete --exclude='CHECKSUM.txt' \
    "$SOURCE/docs/specs/fixtures/" "$TARGET_DIR/"
fi

# Compute checksums.
cd "$TARGET_DIR"
sha256sum *.json README.md UPSTREAM_PINS.md COVERAGE_MATRIX.md \
  $(find schemas -type f 2>/dev/null) > CHECKSUM.txt

echo "Synced $(wc -l < CHECKSUM.txt) fixture file(s) into $TARGET_DIR"
echo "Run 'scripts/sync-fixtures.sh --verify' in CI to detect drift."
