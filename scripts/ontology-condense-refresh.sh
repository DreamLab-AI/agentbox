#!/usr/bin/env bash
# ontology-condense-refresh.sh — on-demand ontology search-optimisation refresh
# (PRD-020 WS-2 / ADR-113). Operator-gated; NOT run on boot (it is a long,
# serialised LLM pass against a local model). Three deterministic stages:
#
#   1. index-build  : parse the vault corpus → compact class records (no LLM)
#   2. condense     : cheap LOCAL LLM → {iri:[synonyms]} aliases + condensed text
#   3. index-build  : re-run, folding the aliases into the PUSH Class-Summary cache
#
# Stage 3's cache feeds the per-turn [ONTOLOGY] breadcrumb (search optimisation).
# The condensed-text JSON (stage 2) is the payload the caller stores into RuVector
# ns:ontology-classes for semantic recall (done via the embedding pipeline, not here).
#
# Config comes from the [skills.ontology.condense] env baked by flake.nix:
#   ONTOLOGY_CONDENSE_ENABLED / _ENDPOINT / _MODEL / _STYLE / _N_BLOCKS / _CONCURRENCY
#
# Corpus path (ADR-2028): VAULT_PAGES — the [vault] path authority the entrypoint
# resolves from agentbox.toml. ONTOLOGY_PAGES_DIR remains the explicit override
# for one release. Outputs: ONTOLOGY_ALIASES / ONTOLOGY_CONDENSED_OUT.
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

# Mutual exclusion (C7 / ADR-113): the scheduler, the entrypoint, and a manual
# operator invocation can all reach here. The condense pass is a long serialised
# LLM run; two overlapping runs would double the load and race on the shared
# CLASSES/ALIASES/CONDENSED outputs. Take an exclusive, non-blocking lock and
# SKIP (not fail) if another refresh already holds it — idempotent + fail-open.
# flock's fd-based lock auto-releases on process exit; the mkdir fallback traps.
LOCK="${ONTOLOGY_CONDENSE_LOCK:-$(dirname "$ALIASES")/.ontology-condense.lock}"
if command -v flock >/dev/null 2>&1 && exec 9>"$LOCK" 2>/dev/null; then
  if ! flock -n 9; then
    echo "[condense-refresh] another refresh holds the lock ($LOCK) — skipping." >&2
    exit 0
  fi
else
  LOCKDIR="$LOCK.d"
  if ! mkdir "$LOCKDIR" 2>/dev/null; then
    echo "[condense-refresh] a refresh is already running ($LOCKDIR) — skipping." >&2
    exit 0
  fi
  trap 'rmdir "$LOCKDIR" 2>/dev/null || true' EXIT
fi

# ADR-2028 D3: fail loud, not quiet. With no vault there is nothing to condense,
# and running the pass anyway would burn a long LLM run on an empty directory.
PAGES="${ONTOLOGY_PAGES_DIR:-${VAULT_PAGES:-}}"
if [ -z "$PAGES" ]; then
  echo "[condense-refresh] [vault] disabled — no corpus path (set [vault].root in agentbox.toml, or ONTOLOGY_PAGES_DIR). Nothing to do." >&2
  exit 0
fi
if [ ! -d "$PAGES" ]; then
  echo "[condense-refresh] corpus path does not exist: $PAGES — check [vault].root. Nothing to do." >&2
  exit 0
fi

echo "[condense-refresh] 1/3 index-build (deterministic parse of $PAGES)…" >&2
node "$LIB/ontology-index-build.js" "$PAGES" "$CLASSES" >/dev/null

echo "[condense-refresh] 2/3 condense via ${ONTOLOGY_CONDENSE_ENDPOINT:-?} (serialised)…" >&2
node "$LIB/ontology-condense.js" "$CLASSES" "$ALIASES" "$CONDENSED"

echo "[condense-refresh] 3/3 index-build (fold aliases into PUSH cache)…" >&2
ONTOLOGY_ALIASES="$ALIASES" node "$LIB/ontology-index-build.js" "$PAGES" "$CLASSES" >/dev/null

echo "[condense-refresh] done. aliases=$ALIASES condensed=$CONDENSED" >&2
