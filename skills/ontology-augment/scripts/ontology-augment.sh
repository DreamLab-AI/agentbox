#!/usr/bin/env bash
#
# ontology-augment — the common grounding patterns, as one command.
#
# Every subcommand is a thin, honest wrapper over the two doors the estate has
# onto the corpus (ADR-2107):
#
#   * `vault`  — the corpus on disk. Authoritative for what a page SAYS.
#   * the Loom — http://192.168.2.132:8084, LAN. Authoritative for what the
#                REASONER concluded: the Whelk closure, SPARQL, typed
#                neighbours and paths.
#
# There is no MCP server in this path and no VisionClaw round-trip. The bridge
# that used to provide both is retired.
#
# Budget-bounded and fail-open (ADR-112) is kept where it always lived: in the
# ARGUMENTS, not in a wrapper's error handling. `ask` caps documents and
# expansion depth by default; every Loom call carries a timeout and degrades to
# an empty, clearly-marked result rather than hanging a turn. A grounding step
# that cannot answer must let the turn continue — that is the whole contract.
#
# Output is JSON on stdout, diagnostics on stderr, always. Pipe it to jq.
#
# Usage:
#   ontology-augment.sh ask      <query> [--documents N] [--depth N]
#   ontology-augment.sh search   <query> [--type T] [--limit N]
#   ontology-augment.sh get      <id>
#   ontology-augment.sh classes  [--limit N]
#   ontology-augment.sh sparql   <query|@file>
#   ontology-augment.sh neighbours <iri> [--limit N]
#   ontology-augment.sh paths    <from> <to> [--max-hops N]
#   ontology-augment.sh validate [--vault knowledge|working|all]
#   ontology-augment.sh propose  <iri> --level content|schema [--hypothesis "…"] [--dry-run]
#   ontology-augment.sh health
#
set -euo pipefail

LOOM_URL="${LOOM_BASE_URL:-http://192.168.2.132:8084}"
LOOM_URL="${LOOM_URL%/v1}"          # the façade's OpenAI path is not the graph path
LOOM_URL="${LOOM_URL%/}"
TIMEOUT="${ONTOLOGY_TIMEOUT_SECS:-10}"

# Default budget. `ask` is the pervasive call — it must stay cheap enough that
# an agent can make it reflexively without thinking about the context window.
ASK_DOCUMENTS="${ONTOLOGY_ASK_MAX_DOCUMENTS:-12}"
ASK_DEPTH="${ONTOLOGY_ASK_DEPTH:-1}"

die() { echo "ontology-augment: $*" >&2; exit 2; }

need_vault() {
  command -v vault >/dev/null 2>&1 && return 0
  [ -x /opt/agentbox/bin/vault ] && return 0
  die "no \`vault\` on PATH. It is baked by Nix under [vault].cli (ADR-2108); rebuild the image."
}

VAULT() {
  if command -v vault >/dev/null 2>&1; then command vault "$@"
  else /opt/agentbox/bin/vault "$@"; fi
}

# Fail-open POST. A Loom that is down, slow, unreachable or serving an older
# route set yields a marked empty result and exit 0 — the caller proceeds
# ungrounded rather than dying. LOOM_STATUS carries the HTTP code back so a
# caller can tell "no such route on this generation" (404) from "no network",
# which are different problems with different fixes.
#
# It sets LOOM_STATUS and LOOM_BODY as GLOBALS and prints nothing. It
# must not be called in a `$(...)` substitution: that forks a subshell, the
# assignments die with it, and every caller then reads a stale LOOM_STATUS=0 —
# taking the right branch by accident and reporting the wrong reason.
LOOM_STATUS=0
LOOM_BODY=''
loom_post() {
  local path="$1" body="$2" raw rc
  LOOM_STATUS=0
  set +e
  raw="$(curl -sS --max-time "$TIMEOUT" -w '\n%{http_code}' -H 'content-type: application/json' \
         -H 'accept: application/json, text/event-stream' \
         -X POST --data "$body" "${LOOM_URL}${path}" 2>/dev/null)"
  rc=$?
  set -e
  if [ $rc -ne 0 ] || [ -z "$raw" ]; then
    echo "ontology-augment: Loom unreachable at ${LOOM_URL}${path} — degrading to empty (fail-open)" >&2
    LOOM_STATUS=000
    LOOM_BODY="$(printf '{"degraded":true,"reason":"loom_unreachable","endpoint":"%s","results":[]}' "${LOOM_URL}${path}")"
    return 0
  fi
  LOOM_STATUS="${raw##*$'\n'}"
  LOOM_BODY="${raw%$'\n'*}"
  if [ "$LOOM_STATUS" != "200" ] || [ -z "$LOOM_BODY" ]; then
    echo "ontology-augment: ${LOOM_URL}${path} returned HTTP ${LOOM_STATUS} — degrading (fail-open)" >&2
    LOOM_BODY="$(printf '{"degraded":true,"reason":"loom_http_%s","endpoint":"%s","results":[]}' "$LOOM_STATUS" "${LOOM_URL}${path}")"
  fi
  return 0
}

# The Loom's /mcp is JSON-RPC 2.0. It is kept as the EXTERNAL-host door (PRD Q10)
# and it is the only way to reach loom.neighbours / loom.paths, which have no
# REST route of their own. Calling it over curl is not "using MCP inside the
# estate": no MCP client, no server registration, no tool grant — just a JSON
# body on a LAN URL, the same as any other HTTP call in this script.
#
# MEASURED 2026-09-22: the generation deployed on :8084 answers /mcp with 404.
# The plane is ADR-140 work that has not shipped yet (WS-H). So every caller
# here checks LOOM_STATUS and falls back to the corpus rather than pretending.
loom_mcp() {
  local tool="$1" args="$2"
  loom_post /mcp "$(printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$tool" "$args")"
}

json_str() { printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'; }

cmd="${1:-}"; shift || true
[ -n "$cmd" ] || die "no subcommand. See the header for usage."

case "$cmd" in

  # ── ask — the former ontology_ask: a budget-bounded, provenance-scoped
  # subgraph for a concept. Two steps, because the corpus and the reasoner are
  # two different authorities: find the seeds by name, then expand them.
  ask)
    need_vault
    query="${1:-}"; shift || true
    [ -n "$query" ] || die "ask needs a query"
    while [ $# -gt 0 ]; do
      case "$1" in
        --documents) ASK_DOCUMENTS="$2"; shift 2;;
        --depth)     ASK_DEPTH="$2";     shift 2;;
        *) die "unknown flag for ask: $1";;
      esac
    done
    seeds="$(VAULT find --query "$query" --limit 5 --json)"
    # Page ids contain spaces ("Knowledge Graph"), so they are collected into an
    # array via NUL-delimited read. Do NOT pipe them to xargs: VAULT is a shell
    # function (it picks between `vault` on PATH and the baked /opt path) and
    # xargs execs a binary, so xargs would report "VAULT: No such file".
    ids=()
    while IFS= read -r -d '' id; do ids+=("$id"); done < <(
      printf '%s' "$seeds" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for r in d.get("results", []):
    sys.stdout.write(r["id"] + "\0")')
    [ "${#ids[@]}" -gt 0 ] || { echo '{"seeds":[],"expanded":[],"degraded":false,"note":"no seed matched"}'; exit 0; }
    VAULT retrieve "${ids[@]}" \
      --expand "is-a=${ASK_DEPTH},requires=${ASK_DEPTH},enables=${ASK_DEPTH},part-of=${ASK_DEPTH}" \
      --max-documents "$ASK_DOCUMENTS" --json
    ;;

  # ── search — former ontology_search / kg_node_search.
  search)
    need_vault
    query="${1:-}"; shift || true
    [ -n "$query" ] || die "search needs a query"
    VAULT find --query "$query" --json "$@"
    ;;

  # ── get — former ontology_class_get.
  get)
    need_vault
    id="${1:-}"; [ -n "$id" ] || die "get needs a page id"
    VAULT retrieve "$id" --json
    ;;

  # ── classes — former ontology_class_list.
  classes)
    need_vault
    VAULT find --query '' --type Class --json "$@"
    ;;

  # ── sparql — former ontology_graph_query. The corpus on disk has no reasoned
  # closure, so this is the Loom's job, not the vault's. Read forms only; the
  # façade enforces a LIMIT.
  sparql)
    q="${1:-}"; [ -n "$q" ] || die "sparql needs a query or @file"
    case "$q" in @*) q="$(cat "${q#@}")";; esac
    loom_post /loom/sparql "{\"query\":$(json_str "$q")}"
    printf '%s\n' "$LOOM_BODY"
    ;;

  # ── neighbours / paths — former kg_neighbors / kg_pathfind. Reasoned-graph
  # questions, so the Loom answers. `vault tree <id>` is the corpus-only
  # alternative when the Loom is down and asserted edges are enough.
  neighbours|neighbors)
    iri="${1:-}"; shift || true
    [ -n "$iri" ] || die "neighbours needs an IRI or slug"
    limit=25
    while [ $# -gt 0 ]; do case "$1" in --limit) limit="$2"; shift 2;; *) die "unknown flag: $1";; esac; done
    loom_mcp loom.neighbours "{\"iri\":$(json_str "$iri"),\"limit\":$limit}"
    if [ "$LOOM_STATUS" = "200" ]; then
      printf '%s\n' "$LOOM_BODY"
    else
      # The reasoned closure is unavailable, so answer from the corpus instead
      # and SAY which one answered. `vault tree` walks asserted frontmatter
      # wikilinks: real edges, but only the ones an author wrote — no inferred
      # ancestors, no backlinks the reasoner derived.
      echo "ontology-augment: falling back to \`vault tree\` (asserted edges only, no inferred closure)" >&2
      need_vault
      VAULT tree "$iri" --depth 1 --json
    fi
    ;;

  paths)
    from="${1:-}"; to="${2:-}"; shift 2 || true
    [ -n "$from" ] && [ -n "$to" ] || die "paths needs <from> <to>"
    hops=4
    while [ $# -gt 0 ]; do case "$1" in --max-hops) hops="$2"; shift 2;; *) die "unknown flag: $1";; esac; done
    loom_mcp loom.paths "{\"from\":$(json_str "$from"),\"to\":$(json_str "$to"),\"max_hops\":$hops}"
    if [ "$LOOM_STATUS" = "200" ]; then
      printf '%s\n' "$LOOM_BODY"
    else
      # There is deliberately NO corpus fallback here. A shortest path is a
      # property of the reasoned closure; walking asserted wikilinks from one
      # end and calling the result "the path" would be a different answer
      # wearing this one's name. Say it is unavailable and hand back the two
      # neighbourhoods, which is genuinely what the corpus can support.
      echo "ontology-augment: shortest paths need the reasoned graph (Loom /mcp, HTTP ${LOOM_STATUS}); no corpus equivalent" >&2
      printf '{"degraded":true,"reason":"paths_need_reasoned_graph","loom_status":"%s","hint":"run `neighbours` on each end, or wait for the ADR-140 /mcp plane"}\n' "$LOOM_STATUS"
    fi
    ;;

  # ── validate — former ontology_validate. OKF conformance + vocabulary +
  # link integrity, against the corpus, locally. No network at all.
  validate)
    need_vault
    VAULT validate --json "$@"
    ;;

  # ── propose — former ontology_propose. STILL GOVERNED: this builds a
  # PatchProposal, runs Whelk and the conflict detector as BLOCKERS, and posts a
  # forum 31402 for a human signature. It does not write the page. A non-empty
  # `blockers` array means nothing was posted.
  propose)
    need_vault
    iri="${1:-}"; shift || true
    [ -n "$iri" ] || die "propose needs an IRI"
    VAULT propose "$iri" --json "$@"
    ;;

  # ── health — former ontology_health. The Loom's generation identity is the
  # honest answer to "is grounding available and how old is it".
  health)
    set +e
    out="$(curl -sS --max-time "$TIMEOUT" "${LOOM_URL}/health" 2>/dev/null)"; rc=$?
    set -e
    if [ $rc -ne 0 ] || [ -z "$out" ]; then
      printf '{"degraded":true,"reason":"loom_unreachable","endpoint":"%s"}\n' "${LOOM_URL}/health"
    else
      printf '%s\n' "$out"
    fi
    ;;

  *) die "unknown subcommand: $cmd";;
esac
