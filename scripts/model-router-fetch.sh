#!/usr/bin/env bash
# ============================================================================
# model-router-fetch.sh — populate the PRE-REBUILD fallback artefact dir for the
# ADR-2080 model-router console, hash-verified against the single source of
# truth (config/model-router/artefacts.json — the same file flake.nix bakes
# /opt/agentbox/model-router from). Idempotent: verified files are skipped.
#
#   scripts/model-router-fetch.sh            → $WORKSPACE/.agentbox/model-router
#   scripts/model-router-fetch.sh --dest DIR
#   scripts/model-router-fetch.sh --check    → verify only, no downloads (exit 1 on miss)
#
# Usually reached via `./agentbox.sh model-router fetch|status`.
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="${HERE}/../config/model-router/artefacts.json"
WORKSPACE="${WORKSPACE:-/home/devuser/workspace}"
DEST="${WORKSPACE}/.agentbox/model-router"
CHECK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST="$2"; shift 2 ;;
    --check) CHECK=1; shift ;;
    -h|--help) sed -n 2,13p "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -r "$MANIFEST" ] || { echo "manifest missing: $MANIFEST" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node required" >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum required" >&2; exit 1; }

# rows: dest<TAB>url<TAB>sha256<TAB>size
rows="$(node -e '
const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
for (const f of m.files) process.stdout.write([f.dest, f.url, f.sha256, f.size].join("\t") + "\n");
' "$MANIFEST")"

ok=0; fetched=0; bad=0
while IFS=$'\t' read -r dest url sha size; do
  [ -n "$dest" ] || continue
  target="${DEST}/${dest}"
  if [ -f "$target" ]; then
    have="$(sha256sum "$target" | cut -c1-64)"
    if [ "$have" = "$sha" ]; then ok=$((ok+1)); continue; fi
    echo "  stale/corrupt: ${dest} (have ${have:0:12}…, want ${sha:0:12}…)"
    [ "$CHECK" = 1 ] && { bad=$((bad+1)); continue; }
    rm -f "$target"
  elif [ "$CHECK" = 1 ]; then
    echo "  missing: ${dest}"; bad=$((bad+1)); continue
  fi
  mkdir -p "$(dirname "$target")"
  echo "  fetching ${dest} (${size} bytes)"
  if ! curl -sfL --retry 3 --retry-delay 2 -o "${target}.part" "$url"; then
    echo "  FAILED download: ${url}" >&2; rm -f "${target}.part"; bad=$((bad+1)); continue
  fi
  have="$(sha256sum "${target}.part" | cut -c1-64)"
  if [ "$have" != "$sha" ]; then
    echo "  FAILED hash: ${dest} (got ${have:0:12}…, want ${sha:0:12}…) — refusing to install" >&2
    rm -f "${target}.part"; bad=$((bad+1)); continue
  fi
  mv "${target}.part" "$target"; fetched=$((fetched+1))
done <<< "$rows"

total=$((ok+fetched))
if [ "$CHECK" = 1 ]; then
  echo "model-router artefacts in ${DEST}: ${ok} verified, ${bad} missing/stale"
else
  echo "model-router artefacts in ${DEST}: ${ok} already verified, ${fetched} fetched, ${bad} failed (${total} ready)"
fi
[ "$bad" = 0 ]
