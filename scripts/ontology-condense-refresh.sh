#!/usr/bin/env bash
# ontology-condense-refresh.sh — on-demand ontology search-optimisation refresh
# (PRD-020 WS-2 / ADR-113). Operator-gated; NOT run on boot (it is a long,
# serialised LLM pass against a local model). Three deterministic stages:
#
#   1. index-build  : parse the logseq corpus → compact class records (no LLM)
#   2. condense     : cheap LOCAL LLM → {iri:[synonyms]} aliases + condensed text
#   3. index-build  : re-run, folding the aliases into the PUSH Class-Summary cache
#
# Stage 3's cache feeds the per-turn [ONTOLOGY] breadcrumb (search optimisation).
# The condensed-text JSON (stage 2) is the payload the caller stores into RuVector
# ns:ontology-classes for semantic recall (done via the embedding pipeline, not here).
#
# Config comes from the [skills.ontology.condense] env baked by flake.nix:
#   ONTOLOGY_CONDENSE_ENABLED / _ENDPOINT / _MODEL / _STYLE / _N_BLOCKS / _CONCURRENCY
# Override the corpus + outputs via env: ONTOLOGY_PAGES_DIR, ONTOLOGY_ALIASES.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LIB="${ONTOLOGY_LIB_DIR:-$HERE/../mcp/servers/lib}"
[ -d "$LIB" ] || LIB="/opt/agentbox/mcp/servers/lib"

CLASSES="${ONTOLOGY_CLASSES_OUT:-/tmp/onto-classes.json}"
ALIASES="${ONTOLOGY_ALIASES:-/home/devuser/workspace/.agentbox-data/ontology-aliases.json}"
CONDENSED="${ONTOLOGY_CONDENSED_OUT:-/home/devuser/workspace/.agentbox-data/ontology-condensed.json}"
mkdir -p "$(dirname "$ALIASES")" "$(dirname "$CONDENSED")"

if [ "${ONTOLOGY_CONDENSE_ENABLED:-false}" != "true" ]; then
  echo "[condense-refresh] ONTOLOGY_CONDENSE_ENABLED != true — nothing to do." >&2
  exit 0
fi

echo "[condense-refresh] 1/3 index-build (deterministic parse)…" >&2
node "$LIB/ontology-index-build.js" "${ONTOLOGY_PAGES_DIR:-}" "$CLASSES" >/dev/null

echo "[condense-refresh] 2/3 condense via ${ONTOLOGY_CONDENSE_ENDPOINT:-?} (serialised)…" >&2
node "$LIB/ontology-condense.js" "$CLASSES" "$ALIASES" "$CONDENSED"

echo "[condense-refresh] 3/3 index-build (fold aliases into PUSH cache)…" >&2
ONTOLOGY_ALIASES="$ALIASES" node "$LIB/ontology-index-build.js" "${ONTOLOGY_PAGES_DIR:-}" "$CLASSES" >/dev/null

echo "[condense-refresh] done. aliases=$ALIASES condensed=$CONDENSED" >&2
