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
#
# Precedence guard (ADR-2028 closeout 2026-09-05), mirroring _ab_vault_resolve():
# ONTOLOGY_PAGES_DIR is honoured ONLY while the vault is ENABLED, or under the
# explicit AGENTBOX_VAULT_LEGACY_PATHS=1 opt-in. With AGENTBOX_VAULT_ENABLED=0 and
# no opt-in this script REFUSES the legacy path and exits 2 — a disabled vault
# must not keep an LLM condensation pass running against a pre-vault tree. "No
# path at all" stays a benign exit 0 (nothing to do); a REFUSED path is a
# configuration error and says so.
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
# NB (fixed 2026-09-05): the `2>/dev/null` below silences a redirection error
# from `exec`, but on `exec` a redirection is PERMANENT — it re-pointed the whole
# script's stderr at /dev/null, swallowing every subsequent diagnostic (including
# the ADR-2028 refusal above being invisible to callers). Save the real stderr on
# fd 8 and restore it the moment the lock attempt is over.
exec 8>&2
if command -v flock >/dev/null 2>&1 && exec 9>"$LOCK" 2>/dev/null; then
  exec 2>&8
  if ! flock -n 9; then
    echo "[condense-refresh] another refresh holds the lock ($LOCK) — skipping." >&2
    exit 0
  fi
else
  exec 2>&8
  LOCKDIR="$LOCK.d"
  if ! mkdir "$LOCKDIR" 2>/dev/null; then
    echo "[condense-refresh] a refresh is already running ($LOCKDIR) — skipping." >&2
    exit 0
  fi
  trap 'rmdir "$LOCKDIR" 2>/dev/null || true' EXIT
fi
exec 8>&-

# ADR-2028 D3: fail loud, not quiet. With no vault there is nothing to condense,
# and running the pass anyway would burn a long LLM run on an empty directory.
EXIT_LEGACY_PATH_REFUSED=2
# NB: an `[ … ] && x=1` one-liner would trip `set -e` when the test is false
# (the AND-list's exit status becomes 1), so this stays an explicit if.
_VAULT_DISABLED=0
if [ "${AGENTBOX_VAULT_ENABLED:-1}" = "0" ]; then _VAULT_DISABLED=1; fi
_LEGACY_OPT_IN=0
case "${AGENTBOX_VAULT_LEGACY_PATHS:-}" in 1|true|TRUE|True|yes|on) _LEGACY_OPT_IN=1 ;; esac

if [ "$_VAULT_DISABLED" = "1" ] && [ "$_LEGACY_OPT_IN" = "0" ] && [ -n "${ONTOLOGY_PAGES_DIR:-}" ]; then
  echo "[condense-refresh] REFUSING legacy corpus path ONTOLOGY_PAGES_DIR=${ONTOLOGY_PAGES_DIR} — AGENTBOX_VAULT_ENABLED=0 (the manifest declares no [vault]), so no consumer may fall back to a pre-vault tree." >&2
  echo "[condense-refresh]   fix: set [vault].root in agentbox.toml, or export AGENTBOX_VAULT_LEGACY_PATHS=1 to opt in deliberately. Nothing run." >&2
  exit "$EXIT_LEGACY_PATH_REFUSED"
fi

if [ "$_VAULT_DISABLED" = "1" ] && [ "$_LEGACY_OPT_IN" = "0" ]; then
  PAGES="${VAULT_PAGES:-}"
else
  PAGES="${ONTOLOGY_PAGES_DIR:-${VAULT_PAGES:-}}"
fi
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
