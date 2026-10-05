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
# There is no MCP server in this path. The one VisionClaw round-trip is `check`
# (POST /api/ontology-agent/check, ADR-2127): the only door that can answer
# "entailed false", so the only way to reach `contradicted`.
#
# Budget-bounded and fail-open (ADR-112) is kept where it always lived: in the
# ARGUMENTS, not in a wrapper's error handling. `ask` caps documents and
# expansion depth by default; every Loom call carries a timeout and degrades to
# an empty, clearly-marked result rather than hanging a turn. A grounding step
# that cannot answer must let the turn continue — that is the whole contract.
#
# Output is JSON on stdout, diagnostics on stderr, always. Pipe it to jq.
# Every result is one envelope (ADR-2129):
#
#   { "grounding": "answered" | "silent" | "degraded" | "contradicted",
#     "degraded":  bool,              # kept for older parsers
#     "source":    "loom" | "vault" | "visionclaw",
#     "generation": { "id", "content_digest", "version_iri", "from", … },
#     "negation":  { … }              # only when the SPARQL used FILTER NOT EXISTS / MINUS
#     "shape":     "unrecognised"     # only when a healthy body could not be counted
#     "note":      "how to read this state",
#     "result":    <the Loom or vault body, unchanged> }
#
#   silent       — a HEALTHY call found nothing. The corpus does not say; that
#                  is not "no" (open world). Never negative evidence.
#   degraded     — nobody answered (Loom down, wrong route, degraded body).
#   contradicted — only when the response itself carries entailed_false
#                  (VisionClaw ADR-2127, via `check`). Never inferred here.
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
#   ontology-augment.sh check    <subject> <class>
#   ontology-augment.sh check    <subject> --property <p> --object <o>
#   ontology-augment.sh health
#
set -euo pipefail

LOOM_URL="${LOOM_BASE_URL:-http://192.168.2.132:8084}"
LOOM_URL="${LOOM_URL%/v1}"          # the façade's OpenAI path is not the graph path
LOOM_URL="${LOOM_URL%/}"
TIMEOUT="${ONTOLOGY_TIMEOUT_SECS:-10}"
ONTOLOGY_IRI="https://narrativegoldmine.com/ontology"   # VisionClaw ADR-2128 versionIRI base

# Default budget. `ask` is the pervasive call — it must stay cheap enough that
# an agent can make it reflexively without thinking about the context window.
ASK_DOCUMENTS="${ONTOLOGY_ASK_MAX_DOCUMENTS:-12}"
ASK_DEPTH="${ONTOLOGY_ASK_DEPTH:-1}"

die() { echo "ontology-augment: $*" >&2; exit 2; }

command -v jq >/dev/null 2>&1 || die "jq is required (it is in the image's base package set)"

# toml_val <file> <section> <key> — the same flat reader the entrypoint uses
# (_ab_toml_val): first `key = value` in `[section]`, quotes and comments off.
toml_val() {
  [ -r "$1" ] || return 0
  awk -v sec="[$2]" -v key="$3" '
    $0==sec {f=1;next} /^\[/{f=0}
    f && index($0,key)==1 && $0 ~ ("^" key "[[:space:]]*=") {
      sub(/^[^=]*=[[:space:]]*/,""); sub(/[[:space:]]*(#.*)?$/,""); gsub(/"/,"");
      print; exit }' "$1"
}

# The vault REPOSITORY root every `vault` call is pinned to. The boot exports
# VAULT_REPO; a shell that did not inherit it reads [vault].repo (or derives it
# from [vault].root) from the manifest, as the entrypoint does. Without --repo
# `vault` only finds the corpus from a cwd inside it.
if [ -z "${VAULT_REPO:-}" ]; then
  _cfg="${AGENTBOX_CONFIG:-/etc/agentbox.toml}"
  VAULT_REPO="$(toml_val "$_cfg" vault repo)"
  if [ -z "$VAULT_REPO" ]; then
    _root="${VAULT_ROOT:-$(toml_val "$_cfg" vault root)}"
    case "${_root%/}" in */knowledge|*/working) VAULT_REPO="$(dirname "${_root%/}")";; esac
  fi
fi
[ -n "${VAULT_REPO:-}" ] && [ -f "$VAULT_REPO/ontology/vocabulary.yaml" ] || VAULT_REPO=""

need_vault() {
  command -v vault >/dev/null 2>&1 && return 0
  [ -x /opt/agentbox/bin/vault ] && return 0
  die "no \`vault\` on PATH. It is baked by Nix under [vault].cli (ADR-2108); rebuild the image."
}

VAULT() {
  local bin=/opt/agentbox/bin/vault
  command -v vault >/dev/null 2>&1 && bin="$(command -v vault)"
  if [ -n "$VAULT_REPO" ]; then "$bin" --repo "$VAULT_REPO" "$@"; else "$bin" "$@"; fi
}

# The generation a `vault` answer belongs to (ADR-2129 decision 3), as JSON.
# `vault` reads the working tree, so two facts are cited: the last local build's
# `.generation.json` (id, digests, and owl:versionIRI once the build carries an
# ADR-2128 ontology_digest) and the working tree's HEAD. The build directory is
# vault.toml [build].out, else the publish outputs; the newest marker wins.
# VAULT_GENERATION_FILE overrides the search.
vault_generation() {
  local f="${VAULT_GENERATION_FILE:-}" head='' d out
  local -a cands=()
  if [ -z "$f" ] && [ -n "$VAULT_REPO" ]; then
    out="$(toml_val "$VAULT_REPO/vault.toml" build out)"
    for d in "$out" site-data www; do
      [ -n "$d" ] && [ -f "$VAULT_REPO/$d/.generation.json" ] && cands+=("$VAULT_REPO/$d/.generation.json")
    done
    [ "${#cands[@]}" -gt 0 ] && f="$(ls -t -- "${cands[@]}" | head -1)"
  fi
  [ -n "$VAULT_REPO" ] && head="$(git -C "$VAULT_REPO" rev-parse HEAD 2>/dev/null || true)"
  if [ -n "$f" ] && [ -r "$f" ] && jq -e 'type=="object"' "$f" >/dev/null 2>&1; then
    jq -c --arg from "$f" --arg head "$head" --arg base "$ONTOLOGY_IRI" '{
        id, content_digest,
        version_iri: (if (.ontology_digest // "") != "" then $base + "/" + .ontology_digest else null end),
        generated_at, from: $from,
        working_tree_commit: (if $head == "" then null else $head end),
        basis: "last local vault build; vault itself read the working tree at working_tree_commit"
      }' "$f"
  else
    jq -nc --arg head "$head" --arg repo "${VAULT_REPO:-unset}" '{
        id: null, content_digest: null, version_iri: null,
        working_tree_commit: (if $head == "" then null else $head end),
        reason: ("no readable .generation.json under vault repo " + $repo + " ([build].out, site-data, www); run `vault build --out <dir>` or set VAULT_GENERATION_FILE")
      }'
  fi
}

# emit <source> <mode> <body> <generation-json> [<sparql>] [<extra-json>]
# Wraps a body in the ADR-2129 envelope on stdout. mode=query can be `silent`;
# mode=report (validate, propose, health) never is — an empty report is not a
# grounding answer.
emit() {
  local source="$1" mode="$2" body="$3" gen="$4" query="${5:-}" extra="${6:-}"
  [ -n "$extra" ] || extra='{}'
  if ! printf '%s' "$body" | jq . >/dev/null 2>&1; then
    local sse; sse="$(printf '%s' "$body" | sed -n 's/^data: //p' | tail -1)"
    if [ -n "$sse" ] && printf '%s' "$sse" | jq . >/dev/null 2>&1; then body="$sse"
    else body="$(printf '%s' "$body" | jq -Rs .)"; fi
  fi
  printf '%s' "$body" | jq --arg source "$source" --arg mode "$mode" --arg query "$query" \
      --argjson gen "$gen" --argjson extra "$extra" '
    # count: how many facts a body carries, or null when its shape is not one
    # this script knows. Only a POSITIVE count is "answered"; a null count is
    # unknown and is reported as silent with shape "unrecognised", never as an
    # answer (ADR-2129). Shapes: arrays; SPARQL/vault row arrays; JSON-RPC
    # envelopes (.result); MCP tools/call content items, whose text items are
    # parsed as JSON when they are JSON (so "[]" is 0) and are otherwise
    # uncountable; a `vault tree` node (id + title; vault omits an empty
    # children array); a VisionClaw ADR-2127 verdict.
    def count:
      def citem:
        if type != "object" then null
        elif .type == "text" then
          ((.text // "") as $t
           | if ($t | test("^\\s*$")) then 0
             else ($t | try fromjson catch {"__uncountable__": true})
                  | if type == "object" and .__uncountable__ == true then null else count end
             end)
        else null end;
      if type == "array" then length
      elif type == "object" then
        if (.result? | type) == "object" then (.result | count)
        elif (.content? | type) == "array" then
          [ .content[] | citem ] as $i
          | if any($i[]; type == "number" and . > 0) then ([ $i[] | numbers ] | add)
            elif all($i[]; . == 0) then 0
            else null end
        elif (.check? | type) == "object" then (.check | count)
        elif (.verdict? | type) == "string" then (if .verdict == "entailed" then 1 else 0 end)
        else [ (.rows, .results, .seeds, .neighbours, .neighbors, .paths, .items, .bindings)
               | select(type == "array") | length ] as $c
             | if ($c | length) > 0 then ($c | add)
               elif has("id") and has("title") then ((.children // []) | length)
               else null end
        end
      else null end;
    . as $b
    | ( ($b | type) == "object" and ( ($b.degraded? == true) or ($b | has("error"))
                                      or ($b.result?.isError? == true) ) ) as $deg
    | ( [ $b | .. | objects | to_entries[] | select(.value == "entailed_false") ] | length > 0 ) as $contra
    | ( if ($b | type) == "object" and ($b.boolean? | type) == "boolean" then (if $b.boolean then 1 else 0 end)
        else ($b | count) end ) as $n
    | ( [ (if ($query | test("FILTER\\s+NOT\\s+EXISTS"; "i")) then "FILTER NOT EXISTS" else empty end),
          (if ($query | test("\\bMINUS\\s*\\{"; "i")) then "MINUS" else empty end) ] ) as $neg
    | ( if $deg then "degraded"
        elif $contra then "contradicted"
        elif $mode == "query" and (($n | type) != "number" or $n <= 0) then "silent"
        else "answered" end ) as $state
    | ( $mode == "query" and ($deg | not) and ($contra | not) and ($n == null) ) as $unrec
    | { grounding: $state,
        degraded: $deg,
        source: $source,
        generation: (if $deg then $gen + {id: null, reason: "nobody answered; no generation to cite"} else $gen end) }
      + (if ($neg | length) > 0 then { negation: {
            operators: $neg,
            reading: "not asserted at this generation",
            note: "open world: each row lacks the pattern at this generation; absence of a statement, not a falsehood" } }
         else {} end)
      + (if $unrec then { shape: "unrecognised" } else {} end)
      + { note: ( if $unrec then
            "healthy call, but the result shape was not recognised, so nothing was counted: unknown, not answered. Read .result yourself; it is not negative evidence (ADR-2129)."
          else {
            silent: "healthy call, nothing asserted or inferred matched: the corpus does not say at this generation. This is not negative evidence; propose, never assert (ADR-2129).",
            degraded: "nobody answered: grounding unavailable, proceed ungrounded. Not evidence either way.",
            contradicted: "entailed false at this generation (ADR-2127): a real negative you may act on; cite generation.id.",
            answered: "answered at this generation; cite generation.id with the claim."
          }[$state] end ) }
      + $extra
      + { result: $b }'
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
#
# It also sets LOOM_GEN to the serving identity as JSON (ADR-2129): the
# x-loom-generation / x-loom-content-digest headers, and owl:versionIRI from an
# x-loom-version-iri header or the body (VisionClaw ADR-2128) when present.
LOOM_STATUS=0
LOOM_BODY=''
LOOM_GEN='{"id":null,"content_digest":null,"version_iri":null}'
HDRS="$(mktemp)"
trap 'rm -f "$HDRS"' EXIT
hdr() { tr -d '\r' < "$HDRS" | awk -v k="$1" 'index(tolower($0), k ":") == 1 { sub(/^[^:]*:[[:space:]]*/, ""); v = $0 } END { print v }'; }
loom_generation() {
  printf '%s' "$LOOM_BODY" | jq -c --arg g "$(hdr x-loom-generation)" --arg d "$(hdr x-loom-content-digest)" \
      --arg v "$(hdr x-loom-version-iri)" '
    def nz: if . == "" then null else . end;
    (if type == "object" then . else {} end) as $b
    | { id: (($g | nz) // $b.generation?.id? // null),
        content_digest: (($d | nz) // $b.generation?.content_digest? // null),
        version_iri: (($v | nz) // $b.version_iri? // $b.versionIRI? // $b["owl:versionIRI"]?
                      // $b.generation?.version_iri? // null),
        from: (if $g != "" then "x-loom-generation header" elif $b.generation?.id? then "response body" else null end) }' \
    2>/dev/null || printf '{"id":null,"content_digest":null,"version_iri":null}'
}
loom_post() {
  local path="$1" body="$2" raw rc
  LOOM_STATUS=0
  : > "$HDRS"
  set +e
  raw="$(curl -sS --max-time "$TIMEOUT" -D "$HDRS" -w '\n%{http_code}' -H 'content-type: application/json' \
         -H 'accept: application/json, text/event-stream' \
         -X POST --data "$body" "${LOOM_URL}${path}" 2>/dev/null)"
  rc=$?
  set -e
  if [ $rc -ne 0 ] || [ -z "$raw" ]; then
    echo "ontology-augment: Loom unreachable at ${LOOM_URL}${path} — degrading to empty (fail-open)" >&2
    LOOM_STATUS=000
    LOOM_BODY="$(printf '{"degraded":true,"reason":"loom_unreachable","endpoint":"%s","results":[]}' "${LOOM_URL}${path}")"
    LOOM_GEN='{"id":null,"content_digest":null,"version_iri":null}'
    return 0
  fi
  LOOM_STATUS="${raw##*$'\n'}"
  LOOM_BODY="${raw%$'\n'*}"
  LOOM_GEN="$(loom_generation)"
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

json_str() { printf '%s' "$1" | jq -Rs .; }

# VisionClaw's REST base: VISIONCLAW_API_URL (the image exports it from
# [skills.ontology].visionclaw_api_url), else that manifest key, else the
# image default the flake bakes.
vc_base() {
  local u="${VISIONCLAW_API_URL:-}"
  [ -n "$u" ] || u="$(toml_val "${AGENTBOX_CONFIG:-/etc/agentbox.toml}" skills.ontology visionclaw_api_url)"
  [ -n "$u" ] || u="http://visionclaw-server:4000"
  u="${u%/}"; printf '%s' "${u%/api}"
}

# vc_post <path> <body> — fail-open POST to VisionClaw. Sets VC_BODY (a
# degraded marker on any failure) and VC_STATUS; prints nothing, so it must
# not run in a `$(...)` subshell (same rule as loom_post).
VC_STATUS=0
VC_BODY=''
vc_post() {
  local url; url="$(vc_base)$1"
  local raw rc
  set +e
  raw="$(curl -sS --max-time "$TIMEOUT" -w '\n%{http_code}' -H 'content-type: application/json' \
         -H 'accept: application/json' -X POST --data "$2" "$url" 2>/dev/null)"
  rc=$?
  set -e
  if [ $rc -ne 0 ] || [ -z "$raw" ]; then
    echo "ontology-augment: VisionClaw unreachable at ${url} — degrading (fail-open)" >&2
    VC_STATUS=000
    VC_BODY="$(jq -nc --arg e "$url" '{degraded: true, reason: "visionclaw_unreachable", endpoint: $e}')"
    return 0
  fi
  VC_STATUS="${raw##*$'\n'}"
  VC_BODY="${raw%$'\n'*}"
  # VisionClaw's ok_json! wraps every 200 in {success, data, error, timestamp};
  # the verdict lives at .data.check. Unwrap once so everything below reads .check.
  VC_BODY="$(printf '%s' "$VC_BODY" | jq -c 'if type == "object" and (.data? | type) == "object"
      and ((.data.check? // .data.verdict?) != null) then .data else . end' 2>/dev/null || printf '%s' "$VC_BODY")"
  if [ "$VC_STATUS" != "200" ] || ! printf '%s' "$VC_BODY" | jq -e 'type == "object"' >/dev/null 2>&1; then
    # A 400 is VisionClaw refusing the question (a term naming no class, or
    # an ambiguous label); carry its message so the caller can fix the term.
    local msg; msg="$(printf '%s' "$VC_BODY" | jq -r '.message? // .error? // empty' 2>/dev/null || true)"
    echo "ontology-augment: ${url} returned HTTP ${VC_STATUS}${msg:+: $msg} — degrading (fail-open)" >&2
    VC_BODY="$(jq -nc --arg s "$VC_STATUS" --arg e "$url" --arg m "$msg" \
      '{degraded: true, reason: ("visionclaw_http_" + $s), endpoint: $e} + (if $m == "" then {} else {message: $m} end)')"
  elif ! printf '%s' "$VC_BODY" | jq -e '(.check.verdict? // .verdict?) | type == "string"' >/dev/null 2>&1; then
    echo "ontology-augment: ${url} answered without a verdict — degrading (fail-open)" >&2
    VC_BODY="$(printf '%s' "$VC_BODY" | jq -c --arg e "$url" '{degraded: true, reason: "visionclaw_no_verdict", endpoint: $e, body: .}')"
  fi
  return 0
}

# run_vault <mode> <vault args…> — run vault, envelope its JSON, keep its exit
# code. A vault that fails with no JSON is a broken environment, not a degraded
# grounding: its output passes through untouched and the failure stands.
run_vault() {
  local mode="$1" out rc; shift
  set +e; out="$(VAULT "$@")"; rc=$?; set -e
  if [ -z "$out" ] || ! printf '%s' "$out" | jq . >/dev/null 2>&1; then
    [ -n "$out" ] && printf '%s\n' "$out"
    exit "$rc"
  fi
  emit vault "$mode" "$out" "$(vault_generation)"
  exit "$rc"
}

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
    # `vault find --json` prints a bare array; an object with `results` is
    # accepted too, so either shape seeds the expansion.
    # Page ids contain spaces ("Knowledge Graph"), so they are collected into an
    # array via NUL-delimited read. Do NOT pipe them to xargs: VAULT is a shell
    # function (it picks between `vault` on PATH and the baked /opt path) and
    # xargs execs a binary, so xargs would report "VAULT: No such file".
    ids=()
    while IFS= read -r -d '' id; do ids+=("$id"); done < <(
      printf '%s' "$seeds" | jq -j '(if type == "array" then . else (.results // []) end)[] | .id + "\u0000"')
    if [ "${#ids[@]}" -eq 0 ]; then
      emit vault query "$(jq -nc --arg q "$query" '{seeds: [], expanded: [], query: $q, reason: "no seed matched"}')" "$(vault_generation)"
      exit 0
    fi
    run_vault query retrieve "${ids[@]}" \
      --expand "is-a=${ASK_DEPTH},requires=${ASK_DEPTH},enables=${ASK_DEPTH},part-of=${ASK_DEPTH}" \
      --max-documents "$ASK_DOCUMENTS" --json
    ;;

  # ── search — former ontology_search / kg_node_search.
  search)
    need_vault
    query="${1:-}"; shift || true
    [ -n "$query" ] || die "search needs a query"
    run_vault query find --query "$query" --json "$@"
    ;;

  # ── get — former ontology_class_get.
  get)
    need_vault
    id="${1:-}"; [ -n "$id" ] || die "get needs a page id"
    run_vault query retrieve "$id" --json
    ;;

  # ── classes — former ontology_class_list.
  classes)
    need_vault
    run_vault query find --query '' --type Class --json "$@"
    ;;

  # ── sparql — former ontology_graph_query. The corpus on disk has no reasoned
  # closure, so this is the Loom's job, not the vault's. Read forms only; the
  # façade enforces a LIMIT.
  sparql)
    q="${1:-}"; [ -n "$q" ] || die "sparql needs a query or @file"
    case "$q" in @*) q="$(cat "${q#@}")";; esac
    loom_post /loom/sparql "{\"query\":$(json_str "$q")}"
    # FILTER NOT EXISTS / MINUS rows are labelled "not asserted at this
    # generation" by emit: open world, so absence is not falsity (ADR-2129).
    emit loom query "$LOOM_BODY" "$LOOM_GEN" "$q"
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
      emit loom query "$LOOM_BODY" "$LOOM_GEN"
    else
      # The reasoned closure is unavailable, so answer from the corpus instead
      # and SAY which one answered. `vault tree` walks asserted frontmatter
      # wikilinks: real edges, but only the ones an author wrote — no inferred
      # ancestors, no backlinks the reasoner derived.
      echo "ontology-augment: falling back to \`vault tree\` (asserted edges only, no inferred closure)" >&2
      need_vault
      set +e; out="$(VAULT tree "$iri" --depth 1 --json)"; rc=$?; set -e
      if [ -z "$out" ] || ! printf '%s' "$out" | jq . >/dev/null 2>&1; then
        [ -n "$out" ] && printf '%s\n' "$out"; exit "$rc"
      fi
      emit vault query "$out" "$(vault_generation)" "" \
        "$(jq -nc --arg s "$LOOM_STATUS" '{fallback: {from: "loom.neighbours", loom_status: $s, scope: "asserted edges only, no inferred closure"}}')"
      exit "$rc"
    fi
    ;;

  paths)
    from="${1:-}"; to="${2:-}"; shift 2 || true
    [ -n "$from" ] && [ -n "$to" ] || die "paths needs <from> <to>"
    hops=4
    while [ $# -gt 0 ]; do case "$1" in --max-hops) hops="$2"; shift 2;; *) die "unknown flag: $1";; esac; done
    loom_mcp loom.paths "{\"from\":$(json_str "$from"),\"to\":$(json_str "$to"),\"max_hops\":$hops}"
    if [ "$LOOM_STATUS" = "200" ]; then
      emit loom query "$LOOM_BODY" "$LOOM_GEN"
    else
      # There is deliberately NO corpus fallback here. A shortest path is a
      # property of the reasoned closure; walking asserted wikilinks from one
      # end and calling the result "the path" would be a different answer
      # wearing this one's name. Say it is unavailable and hand back the two
      # neighbourhoods, which is genuinely what the corpus can support.
      echo "ontology-augment: shortest paths need the reasoned graph (Loom /mcp, HTTP ${LOOM_STATUS}); no corpus equivalent" >&2
      emit loom query "$(printf '{"degraded":true,"reason":"paths_need_reasoned_graph","loom_status":"%s","hint":"run `neighbours` on each end, or wait for the ADR-140 /mcp plane"}' "$LOOM_STATUS")" "$LOOM_GEN"
    fi
    ;;

  # ── validate — former ontology_validate. OKF conformance + vocabulary +
  # link integrity, against the corpus, locally. No network at all.
  validate)
    need_vault
    run_vault report validate --json "$@"
    ;;

  # ── propose — former ontology_propose. STILL GOVERNED: this builds a
  # PatchProposal, runs Whelk and the conflict detector as BLOCKERS, and posts a
  # forum 31402 for a human signature. It does not write the page. A non-empty
  # `blockers` array means nothing was posted.
  propose)
    need_vault
    iri="${1:-}"; shift || true
    [ -n "$iri" ] || die "propose needs an IRI"
    run_vault report propose "$iri" --json "$@"
    ;;

  # ── check — VisionClaw ADR-2127 tri-valued membership. The one subcommand
  # that can return `contradicted`: entailed → answered, entailed_false →
  # contradicted, not_asserted → silent (open world), no answer → degraded.
  # The generation is VisionClaw's own scope.generation (versionIRI or id).
  check)
    subj="${1:-}"; shift || true
    [ -n "$subj" ] || die "check needs <subject> <class> or <subject> --property P --object O"
    cls='' prop='' obj=''
    while [ $# -gt 0 ]; do
      case "$1" in
        --property) prop="${2:-}"; shift 2 || die "--property needs a value";;
        --object)   obj="${2:-}";  shift 2 || die "--object needs a value";;
        --class)    cls="${2:-}";  shift 2 || die "--class needs a value";;
        -*) die "unknown flag for check: $1";;
        *) [ -z "$cls" ] || die "check takes one class"; cls="$1"; shift;;
      esac
    done
    if [ -n "$prop" ] || [ -n "$obj" ]; then
      [ -n "$prop" ] && [ -n "$obj" ] && [ -z "$cls" ] || die "check: --property and --object go together, without a class"
      req="$(jq -nc --arg s "$subj" --arg p "$prop" --arg o "$obj" '{subject: $s, property: $p, object: $o}')"
    else
      [ -n "$cls" ] || die "check needs a class, or --property and --object"
      req="$(jq -nc --arg s "$subj" --arg c "$cls" '{subject: $s, class: $c}')"
    fi
    vc_post /api/ontology-agent/check "$req"
    gen="$(printf '%s' "$VC_BODY" | jq -c '
      ((.check?.scope?.generation?) // (.scope?.generation?) // null) as $g
      | { id: $g, content_digest: null,
          version_iri: (if ($g | type) == "string" and ($g | test("^https?://")) then $g else null end),
          from: (if $g == null then null else "VisionClaw check scope.generation" end) }
        + (if $g == null then {reason: "VisionClaw did not report the generation it answered from"} else {} end)')"
    emit visionclaw query "$VC_BODY" "$gen"
    ;;

  # ── health — former ontology_health. The Loom's generation identity is the
  # honest answer to "is grounding available and how old is it".
  health)
    : > "$HDRS"
    set +e
    out="$(curl -sS --max-time "$TIMEOUT" -D "$HDRS" "${LOOM_URL}/health" 2>/dev/null)"; rc=$?
    set -e
    if [ $rc -ne 0 ] || [ -z "$out" ]; then
      emit loom report "$(printf '{"degraded":true,"reason":"loom_unreachable","endpoint":"%s"}' "${LOOM_URL}/health")" \
        '{"id":null,"content_digest":null,"version_iri":null}'
    else
      LOOM_BODY="$out"
      emit loom report "$out" "$(loom_generation)"
    fi
    ;;

  *) die "unknown subcommand: $cmd";;
esac
