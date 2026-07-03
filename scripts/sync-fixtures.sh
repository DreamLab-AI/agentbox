#!/usr/bin/env bash
# scripts/sync-fixtures.sh — agentbox substrate
#
# Per ADR-082 D5: agentbox consumes cross-substrate fixtures from VisionClaw
# (the master host). This script clones VisionClaw, copies its canonical
# fixture corpus (tests/fixtures/) into tests/contract/upstream_vectors/, and
# writes CHECKSUM.txt for CI drift detection.
#
# The canonical corpus was relocated from docs/specs/fixtures/ to tests/fixtures/
# in VisionClaw on 2026-06-29 (commit 031f539a5, "clean-room documentation
# rebuild"). CANONICAL_REL below tracks that location; if VisionClaw does not
# contain it the script FAILS LOUDLY rather than silently syncing from a dead
# path (which, with rsync --delete, would wipe the checked-in corpus).
#
# Usage:
#   scripts/sync-fixtures.sh                    # full sync
#   scripts/sync-fixtures.sh --verify           # CI gate: exit non-zero on drift
#   VISIONCLAW_FIXTURES_PATH=/local/path \
#     scripts/sync-fixtures.sh                  # offline / local-monorepo dev
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$REPO_ROOT/tests/contract/upstream_vectors/fixtures"
SOURCE="${VISIONCLAW_FIXTURES_PATH:-https://github.com/DreamLab-AI/VisionClaw.git}"
# Canonical fixture location inside VisionClaw (relocated 2026-06-29).
CANONICAL_REL="tests/fixtures"

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
  (cd "$TMPDIR" && git sparse-checkout add "$CANONICAL_REL")
  SRC_DIR="$TMPDIR/$CANONICAL_REL"
  if [ ! -d "$SRC_DIR" ]; then
    echo "ERROR: $SOURCE has no $CANONICAL_REL/ (canonical fixture corpus)." >&2
    echo "       The corpus was relocated from docs/specs/fixtures/ to $CANONICAL_REL/" >&2
    echo "       on 2026-06-29. Refusing to sync from a dead path (would wipe the" >&2
    echo "       checked-in corpus). Update CANONICAL_REL if VisionClaw moved it again." >&2
    exit 1
  fi
else
  SRC_DIR="$SOURCE/$CANONICAL_REL"
  if [ ! -d "$SRC_DIR" ]; then
    echo "ERROR: VISIONCLAW_FIXTURES_PATH=$SOURCE has no $CANONICAL_REL/" >&2
    exit 1
  fi
fi

if command -v rsync &>/dev/null; then
  rsync -a --delete --exclude='CHECKSUM.txt' "$SRC_DIR/" "$TARGET_DIR/"
else
  rm -rf "$TARGET_DIR"/*.json "$TARGET_DIR"/*.md "$TARGET_DIR"/*.txt "$TARGET_DIR"/schemas 2>/dev/null
  mkdir -p "$TARGET_DIR/schemas"
  cp -a "$SRC_DIR/"*.json "$SRC_DIR/"*.md "$SRC_DIR/"*.txt "$TARGET_DIR/" 2>/dev/null || true
  cp -a "$SRC_DIR/schemas/"* "$TARGET_DIR/schemas/" 2>/dev/null || true
fi

# Compute checksums.
cd "$TARGET_DIR"
sha256sum *.json README.md UPSTREAM_PINS.md COVERAGE_MATRIX.md \
  $(find schemas -type f 2>/dev/null) > CHECKSUM.txt

echo "Synced $(wc -l < CHECKSUM.txt) fixture file(s) into $TARGET_DIR"
echo "Run 'scripts/sync-fixtures.sh --verify' in CI to detect drift."
