#!/usr/bin/env bash
# scripts/ruvector-sidecar-update.sh
#
# Careful, gated lifecycle manager for the ruvector-postgres memory sidecar.
# The sidecar holds the production RuVector dataset (2M+ memory_entries rows,
# 384-dim HNSW index) on the named volume ruvector_postgres_data_v2, so an
# image bump is never "pull and pray": every update is rehearsed on a
# consistent copy of the data before the real volume is touched, and every
# step is recorded so `rollback` can restore the previous state.
#
# Subcommands:
#   status              Show running image/digest, extension version, row count
#   check               status + compare pinned image against Docker Hub
#   test [--container NAME]
#                       Run the smoke suite against a container (default: prod)
#   update [--to REF] [--dry-run] [--yes] [--adopt] [--keep-candidate]
#                       Full gated update:
#                         1. baseline capture (rows, extension, PG version)
#                         2. logical backup   (pg_dump -Fc)
#                         3. physical snapshot (pg_basebackup -> snapshot volume)
#                         4. candidate rehearsal: target image + snapshot volume,
#                            ALTER EXTENSION ruvector UPDATE, full smoke suite
#                         5. pin bump in agentbox.toml + docker-compose.yml
#                         6. swap: recreate prod on the real volume, ALTER, smoke
#                         7. auto-rollback on any post-swap failure
#   rollback            Revert pin + restore snapshot (per recorded state)
#
# Data-hygiene ops (PRD-018 Phase 2 / ADR-036 D5). ALL dry-run by default;
# --yes applies. The three destructive ops additionally require the matching
# [memory_hygiene] flag in agentbox.toml (fail-closed if the flag is off).
#   migrate-trajectories [--yes]
#                       Additive schema migration for the learning loop:
#                       ADD COLUMN trajectory_steps.duration_ms +
#                       idx_trajectory_steps_trajectory. No toml flag needed.
#   repair-namespaces [--yes]            (flag: allow_namespace_repair)
#                       Un-swap rows whose namespace holds a JSON object and
#                       whose value.data holds the real namespace token.
#                       pg_dump of affected rows before the single-txn swap.
#   backfill-embeddings [--yes]          (flag: allow_embedding_backfill)
#                       Compute embeddings (Xinference bge-small-en-v1.5) for
#                       NULL-embedding non-empty rows; quarantine failures via
#                       metadata.embedding_quarantined=true.
#   archive-legacy [--yes]               (flag: allow_legacy_archival)
#                       Snapshot, then COPY (data-only) the frozen legacy /
#                       dead-hooks namespaces to a compressed archive under
#                       backups/, then DELETE in batches; suggest VACUUM.
#
# Learning + retrieval ops (PRD-018 / ADR-036 D1/D4). Dry-run by default.
#   aggregate-effectiveness [--yes]      (flag: [memory_learning].enabled)
#                       Group trajectory_steps by action pattern; compute the
#                       Wilson lower-bound (z=1.96) success rate with recency
#                       half-life decay; skip patterns below aggregate_min_samples;
#                       upsert each surviving aggregate THROUGH the governed
#                       memStore path into the memory-learning-aggregates
#                       namespace. Dry-run prints the per-pattern table; --yes
#                       writes (requires the flag). Env resolved from .mcp.json.
#   build-metadata-gin [--yes]           (flag: metadata_gin)
#                       CREATE INDEX CONCURRENTLY idx_memory_metadata_gin ON
#                       memory_entries USING gin (metadata jsonb_path_ops) so tag
#                       (metadata @> …) retrieval becomes a bitmap index scan.
#                       Dry-run shows the SQL, current index presence, and the
#                       ~365k-cost seq-scan EXPLAIN it eliminates.
#
# Evaluation ops (PRD-020 / ADR-040 D2 / W-B). Read-only — no DB writes.
#   recall [--runs N] [--k K] [--fixture PATH] [--json] [--build-fixture]
#                       Recall-regression harness — the mandatory gate for
#                       every retrieval-geometry change. Runs the frozen
#                       QuerySetFixture (self-recall@10; true-recall@10 vs a
#                       forced exact scan; exact-token hybrid≥pure) against
#                       the live HNSW index; prints per-class median-of-3
#                       scores + PASS/FAIL against the no-regression band
#                       (exit non-zero on FAIL). Evidence under backups/
#                       ruvector-sidecar/recall-runs/. --build-fixture
#                       (one-shot) re-samples the corpus + writes the fixture.
#
# Index + access ops (ADR-2133). Dry-run by default; --yes applies.
#   reindex [--dry-run|--yes]
#                       Serial, non-concurrent rebuild of idx_memory_embedding_hnsw
#                       (m=16, ef_construction=128, max_parallel_maintenance_workers=0)
#                       under a temporary name beside the live index, swapped in
#                       one DROP+RENAME transaction. Recall harness before and
#                       after, recorded under state.json .reindex; fails loudly
#                       below the enforced floor (self ≥175/200, true ≥102/120).
#   reader-role [--dry-run|--yes|--verify]   (flag: reader_role)
#                       Create/update ruvector_reader (password from
#                       RUVECTOR_READER_PASSWORD, never printed): read-only by
#                       default, SELECT on memory_entries only, a role-scoped
#                       scram pg_hba line; then log in as it and prove reads
#                       work and every write path is refused. --verify re-checks.
#   hba-harden [--dry-run|--yes]             (flag: hba_scram)
#                       Rewrite non-loopback pg_hba `trust` lines to scram-sha-256
#                       after proving every known client password verifies;
#                       restores the backup if the owner cannot log in after.
#
# The image pin lives in agentbox.toml [integrations.ruvector_external].image
# (source of truth — flake.nix composeText reads it) and is mirrored in the
# checked-in docker-compose.yml. Both are updated together here.
#
# Requires: docker, jq, curl. All SQL runs via `docker exec` (no local psql).
# Upstream publishes linux/amd64 only — see `check` output.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

TOML="${RUVECTOR_SIDECAR_TOML:-${REPO_DIR}/agentbox.toml}"
COMPOSE_FILE="${REPO_DIR}/docker-compose.yml"
OVERRIDE_FILE="${REPO_DIR}/docker-compose.override.yml"

SERVICE="ruvector-postgres"
CONTAINER="ruvector-postgres"
CANDIDATE="ruvector-postgres-candidate"
HUB_REPO="ruvnet/ruvector-postgres"
PG_USER="ruvector"
PG_DB="${RUVECTOR_SIDECAR_DB:-ruvector}"

STATE_DIR="${RUVECTOR_SIDECAR_STATE_DIR:-${REPO_DIR}/backups/ruvector-sidecar}"
STATE_FILE="${STATE_DIR}/state.json"

if [ -t 1 ]; then
    RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'
    CYAN=$'\033[0;36m'; NC=$'\033[0m'
else
    RED="" GREEN="" YELLOW="" CYAN="" NC=""
fi

COMPOSE_ARGS=(--project-name agentbox -f "$COMPOSE_FILE")
[[ -f "$OVERRIDE_FILE" ]] && COMPOSE_ARGS=(--project-name agentbox -f "$COMPOSE_FILE" -f "$OVERRIDE_FILE")

die()  { echo -e "${RED}ERROR: $*${NC}" >&2; exit 1; }
info() { echo -e "${CYAN}$*${NC}"; }
ok()   { echo -e "${GREEN}  ✓ $*${NC}"; }
warn() { echo -e "${YELLOW}  ! $*${NC}"; }
fail() { echo -e "${RED}  ✗ $*${NC}"; }

# ── low-level helpers ────────────────────────────────────────────────────────

pg() { # pg <container> <sql>
    docker exec "$1" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -tAc "$2"
}

toml_pin() { # image ref pinned in agentbox.toml [integrations.ruvector_external]
    awk '/^\[integrations\.ruvector_external\]/{f=1;next} /^\[/{f=0}
         f && /^image[[:space:]]*=/{
             sub(/^image[[:space:]]*=[[:space:]]*"/,""); sub(/".*$/,""); print; exit }' "$TOML"
}

toml_volume() {
    awk '/^\[integrations\.ruvector_external\]/{f=1;next} /^\[/{f=0}
         f && /^data_volume[[:space:]]*=/{
             sub(/^data_volume[[:space:]]*=[[:space:]]*"/,""); sub(/".*$/,""); print; exit }' "$TOML"
}

compose_pin() {
    awk '$1=="image:" && $2 ~ /ruvector-postgres/ {print $2; exit}' "$COMPOSE_FILE"
}

# ── data-hygiene helpers (PRD-018 Phase 2) ───────────────────────────────────

# Parse a bare boolean from the [memory_hygiene] block, same anchored-awk style
# as toml_pin. Returns the raw token ("true"/"false"/"" if the key/section is
# absent — an absent flag reads as off, i.e. the destructive path stays closed).
toml_hygiene_flag() { # toml_hygiene_flag <key>
    awk -v key="$1" '
        /^\[memory_hygiene\]/{f=1;next} /^\[/{f=0}
        f && index($0, key)==1 && $0 ~ ("^" key "[[:space:]]*=") {
            sub(/^[^=]*=[[:space:]]*/,""); sub(/[[:space:]]*(#.*)?$/,""); gsub(/"/,"");
            print; exit }' "$TOML"
}

# A gate is on iff the value is exactly '1' or 'true' (env-var contract parity).
is_on() { [[ "${1:-}" == "1" || "${1:-}" == "true" ]]; }

# Double single-quotes so a value can be embedded in a SQL literal safely.
sql_quote() { local s="${1//\'/\'\'}"; printf '%s' "$s"; }

# Xinference lives on the compose DNS name 'xinference' when this script runs
# inside the container mesh, but that name does not resolve when the script is
# invoked host-side (e.g. from tab 6) — the 2026-07-05 backfill-embeddings run
# needed XINFERENCE_ENDPOINT=http://localhost:9997 by hand. Detect host-side
# execution via `getent hosts xinference` and fall back to localhost; an
# explicit XINFERENCE_ENDPOINT in the environment always wins (the ${VAR:-...}
# expansion below only evaluates the getent probe when XINFERENCE_ENDPOINT is
# unset or empty).
xinference_default_endpoint() {
    if getent hosts xinference >/dev/null 2>&1; then
        echo "http://xinference:9997"
    else
        echo "http://localhost:9997"
    fi
}
XINFERENCE_ENDPOINT="${XINFERENCE_ENDPOINT:-$(xinference_default_endpoint)}"
XINFERENCE_MODEL="bge-small-en-v1.5"

# The frozen legacy / dead-hooks selection (verified live: ~1.84M rows).
# namespace LIKE 'legacy/%' OR 'swarm/%' OR one of the write-only telemetry
# namespaces that are never read back. Defined once so archive + delete + the
# dry-run enumeration all use the identical predicate.
LEGACY_PREDICATE="namespace LIKE 'legacy/%' OR namespace LIKE 'swarm/%' OR namespace IN ('hooks:pre-bash','hooks:post-bash','performance-metrics','command-results','command-history')"

# The namespace<->value swap detection predicate (verified live: 178,238 rows).
# A corrupted row has a JSON object in `namespace` and the real namespace token
# nested in `value->>'data'`.
SWAP_PREDICATE="namespace LIKE '{%' AND value ? 'data'"

# psql that keeps backslash meta-commands (\d) working — pg() uses -tAc.
psql_raw() { docker exec "$1" psql -U "$PG_USER" -d "$PG_DB" -c "$2"; }

# Enforce the dry-run/apply/flag contract for a destructive op.
#   hygiene_apply_gate <apply?0/1> <flag-key> <human-op-name>
# Returns 0 to proceed with the write, 1 (via die) if the gate is closed.
hygiene_apply_gate() {
    local apply="$1" flag_key="$2" op="$3" flag_val
    flag_val=$(toml_hygiene_flag "$flag_key")
    if [[ "$apply" -ne 1 ]]; then
        return 1   # dry-run: caller prints the plan and returns
    fi
    if ! is_on "$flag_val"; then
        die "${op} is gated: set [memory_hygiene] ${flag_key} = true in
       ${TOML} to enable the non-dry-run path (currently '${flag_val:-unset}')."
    fi
    return 0
}

# Parse a bare boolean from [integrations.ruvector_external], same anchored-awk
# style as toml_hygiene_flag. Absent key/section reads as off.
toml_ruvector_flag() { # toml_ruvector_flag <key>
    awk -v key="$1" '
        /^\[integrations\.ruvector_external\]/{f=1;next} /^\[/{f=0}
        f && index($0, key)==1 && $0 ~ ("^" key "[[:space:]]*=") {
            sub(/^[^=]*=[[:space:]]*/,""); sub(/[[:space:]]*(#.*)?$/,""); gsub(/"/,"");
            print; exit }' "$TOML"
}

# Parse a bare boolean from [memory_learning], same anchored-awk style.
toml_learning_flag() { # toml_learning_flag <key>
    awk -v key="$1" '
        /^\[memory_learning\]/{f=1;next} /^\[/{f=0}
        f && index($0, key)==1 && $0 ~ ("^" key "[[:space:]]*=") {
            sub(/^[^=]*=[[:space:]]*/,""); sub(/[[:space:]]*(#.*)?$/,""); gsub(/"/,"");
            print; exit }' "$TOML"
}

# Enforce dry-run/apply/flag contract against [integrations.ruvector_external].
#   ruvector_apply_gate <apply?0/1> <flag-key> <human-op-name>
ruvector_apply_gate() {
    local apply="$1" flag_key="$2" op="$3" flag_val
    flag_val=$(toml_ruvector_flag "$flag_key")
    if [[ "$apply" -ne 1 ]]; then
        return 1   # dry-run: caller prints the plan and returns
    fi
    if ! is_on "$flag_val"; then
        die "${op} is gated: set [integrations.ruvector_external] ${flag_key} = true
       in ${TOML} to enable the non-dry-run path (currently '${flag_val:-unset}')."
    fi
    return 0
}

# Enforce dry-run/apply/flag contract against [memory_learning].enabled.
#   learning_apply_gate <apply?0/1> <human-op-name>
learning_apply_gate() {
    local apply="$1" op="$2" flag_val
    flag_val=$(toml_learning_flag "enabled")
    if [[ "$apply" -ne 1 ]]; then
        return 1   # dry-run: caller prints the plan and returns
    fi
    if ! is_on "$flag_val"; then
        die "${op} is gated: set [memory_learning] enabled = true in
       ${TOML} to enable the non-dry-run path (currently '${flag_val:-unset}')."
    fi
    return 0
}

# Resolve the governed MCP env (RUVECTOR_PG_CONNINFO, NODE_PATH,
# XINFERENCE_ENDPOINT, EMBEDDING_MODEL, injected gate vars) the same way the
# runtime does — from the generated .mcp.json claude-flow env block. Emits
# `KEY=VALUE` lines for the first .mcp.json that carries a claude-flow env.
# Empty output (no file / no jq) is fine: the node lib falls back to defaults.
mcp_env_pairs() {
    command -v jq >/dev/null 2>&1 || return 1
    local f
    for f in "${WORKSPACE:-$HOME/workspace}/.mcp.json" \
             "${REPO_DIR}/.mcp.json" \
             "${REPO_DIR}/../.mcp.json" \
             "$HOME/workspace/.mcp.json"; do
        [[ -f "$f" ]] || continue
        if jq -e '.mcpServers["claude-flow"].env' "$f" >/dev/null 2>&1; then
            jq -r '.mcpServers["claude-flow"].env | to_entries[] | "\(.key)=\(.value)"' "$f"
            return 0
        fi
    done
    return 1
}

set_pin() { # set_pin <new-ref> — update agentbox.toml + docker-compose.yml together
    local ref="$1" tmp
    tmp=$(mktemp)
    awk -v ref="$ref" '
        /^\[integrations\.ruvector_external\]/{f=1}
        /^\[/ && $0 !~ /ruvector_external/{f=0}
        f && /^image[[:space:]]*=/{ printf "image          = \"%s\"\n", ref; next }
        {print}' "$TOML" > "$tmp" && cat "$tmp" > "$TOML"
    awk -v ref="$ref" '
        $1=="image:" && $2 ~ /ruvector-postgres/ { sub($2, ref); print; next }
        {print}' "$COMPOSE_FILE" > "$tmp" && cat "$tmp" > "$COMPOSE_FILE"
    rm -f "$tmp"
    ok "pinned ${ref} in agentbox.toml + docker-compose.yml"
}

hub_token() {
    curl -fsS "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${HUB_REPO}:pull" \
        | jq -r .token
}

hub_latest_digest() {
    local token; token=$(hub_token) || return 1
    curl -fsS -o /dev/null -D - \
        -H "Authorization: Bearer $token" \
        -H "Accept: application/vnd.docker.distribution.manifest.v2+json,application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json" \
        "https://registry-1.docker.io/v2/${HUB_REPO}/manifests/latest" 2>/dev/null \
        | awk 'tolower($1)=="docker-content-digest:"{gsub(/\r/,""); print $2}'
}

hub_tag_for_digest() { # newest version-looking tag that shares <digest>
    curl -fsS "https://hub.docker.com/v2/repositories/${HUB_REPO}/tags/?page_size=50" 2>/dev/null \
        | jq -r --arg d "$1" \
            '[.results[] | select(.digest==$d and (.name|test("^[0-9]")))]
             | sort_by(.last_updated) | last | .name // empty'
}

container_project() {
    docker inspect "$CONTAINER" \
        --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true
}

require_prod_running() {
    docker inspect "$CONTAINER" --format '{{.State.Running}}' 2>/dev/null | grep -q true \
        || die "container ${CONTAINER} is not running"
}

pg_password() { # from env, then the running container's own environment
    if [[ -n "${RUVECTOR_PG_PASSWORD:-}" ]]; then
        echo "$RUVECTOR_PG_PASSWORD"
    else
        docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
            | awk -F= '$1=="POSTGRES_PASSWORD"{print $2; exit}'
    fi
}

wait_pg_ready() { # wait_pg_ready <container> <timeout-seconds>
    local c="$1" deadline=$(( $(date +%s) + $2 ))
    while [[ $(date +%s) -lt $deadline ]]; do
        if docker exec "$c" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
            return 0
        fi
        # surface a dead container immediately rather than burning the timeout
        if ! docker inspect "$c" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
            return 2
        fi
        sleep 2
    done
    return 1
}

state_write() { # state_write key=value ... (strings; merges into state.json)
    mkdir -p "$STATE_DIR"
    local args=() jqprog="."
    local i=0 kv k v
    for kv in "$@"; do
        k="${kv%%=*}"; v="${kv#*=}"
        args+=(--arg "k$i" "$v")
        jqprog+=" | .${k} = \$k$i"
        i=$((i+1))
    done
    if [[ -f "$STATE_FILE" ]]; then
        jq "${args[@]}" "$jqprog" "$STATE_FILE" > "${STATE_FILE}.tmp"
    else
        jq -n "${args[@]}" "$jqprog" > "${STATE_FILE}.tmp"
    fi
    mv "${STATE_FILE}.tmp" "$STATE_FILE"
}

state_get() { jq -r ".${1} // empty" "$STATE_FILE" 2>/dev/null; }

# pg_hba rules that trust a non-loopback address (line|type|db|user|address|method).
hba_trust_rules_sql="SELECT line_number || '|' || type || '|' || database::text || '|' || user_name::text || '|' || coalesce(address, '') || '|' || auth_method FROM pg_hba_file_rules WHERE type LIKE 'host%' AND auth_method = 'trust' AND coalesce(address, '') NOT IN ('127.0.0.1', '::1') ORDER BY line_number;"

# ── smoke suite ──────────────────────────────────────────────────────────────
# Asserts the container is a healthy RuVector backend: extension at its
# image's default version, expected row count, HNSW index actually used by
# the planner, and a full write->ANN-search->rollback round trip.

smoke() { # smoke <container> <expected-rows|-> ; returns nonzero on failure
    local c="$1" expected_rows="$2" failures=0

    if docker exec "$c" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
        ok "pg_isready"
    else
        fail "pg_isready"; return 1
    fi

    local installed default
    installed=$(pg "$c" "SELECT extversion FROM pg_extension WHERE extname='ruvector';" || true)
    default=$(pg "$c" "SELECT default_version FROM pg_available_extensions WHERE name='ruvector';" || true)
    if [[ -n "$installed" && "$installed" == "$default" ]]; then
        ok "extension ruvector ${installed} (== image default)"
    elif [[ -n "$installed" ]]; then
        fail "extension ruvector installed=${installed} but image default=${default} (ALTER EXTENSION not applied?)"
        failures=$((failures+1))
    else
        fail "extension ruvector not installed"
        failures=$((failures+1))
    fi

    local rows
    rows=$(pg "$c" "SELECT count(*) FROM memory_entries;" || echo "ERR")
    if [[ "$expected_rows" == "-" && "$rows" != "ERR" ]]; then
        ok "memory_entries readable (${rows} rows)"
    elif [[ "$rows" == "$expected_rows" ]]; then
        ok "row count ${rows} matches baseline"
    else
        fail "row count ${rows} != baseline ${expected_rows}"
        failures=$((failures+1))
    fi

    if pg "$c" "SET enable_seqscan=off;
                EXPLAIN SELECT id FROM memory_entries
                ORDER BY embedding <=> (SELECT embedding FROM memory_entries
                                        WHERE embedding IS NOT NULL LIMIT 1)
                LIMIT 5;" 2>/dev/null | grep -q idx_memory_embedding_hnsw; then
        ok "planner uses idx_memory_embedding_hnsw"
    else
        fail "HNSW index not used by ANN query plan"
        failures=$((failures+1))
    fi

    local nn
    nn=$(pg "$c" "SELECT count(*) FROM (
                    SELECT id FROM memory_entries
                    ORDER BY embedding <=> (SELECT embedding FROM memory_entries
                                            WHERE embedding IS NOT NULL LIMIT 1)
                    LIMIT 5) q;" || echo 0)
    if [[ "$nn" == "5" ]]; then
        ok "ANN query returns k=5 neighbours"
    else
        fail "ANN query returned ${nn} rows, expected 5"
        failures=$((failures+1))
    fi

    # Write path: insert a probe vector, find it via ANN, roll everything back.
    local probe_id="sidecar-probe-$$-$(date +%s)" found
    found=$(pg "$c" "BEGIN;
        INSERT INTO memory_entries (id, namespace, key, value, embedding)
        VALUES ('${probe_id}', 'sidecar-probe', 'probe', '\"probe\"'::jsonb,
                (SELECT ('[' || string_agg('0.101', ',') || ']')
                 FROM generate_series(1,384))::ruvector);
        SELECT id FROM memory_entries WHERE namespace='sidecar-probe'
        ORDER BY embedding <=> (SELECT ('[' || string_agg('0.101', ',') || ']')
                                FROM generate_series(1,384))::ruvector
        LIMIT 1;
        ROLLBACK;" 2>/dev/null | grep -v -E '^(BEGIN|INSERT|ROLLBACK)' | head -1 || true)
    if [[ "$found" == "$probe_id" ]]; then
        ok "write -> ANN search -> rollback round trip"
    else
        fail "write-path probe failed (got '${found}')"
        failures=$((failures+1))
    fi

    local pgver
    pgver=$(pg "$c" "SHOW server_version;" 2>/dev/null || echo "?")
    echo -e "  ${CYAN}·${NC} postgres ${pgver}"

    return "$failures"
}

# ── subcommands ──────────────────────────────────────────────────────────────

cmd_status() {
    require_prod_running
    local ref repo_digest pin cpin
    ref=$(docker inspect "$CONTAINER" --format '{{.Config.Image}}')
    repo_digest=$(docker inspect "$(docker inspect "$CONTAINER" --format '{{.Image}}')" \
        --format '{{range .RepoDigests}}{{println .}}{{end}}' 2>/dev/null | head -1)
    pin=$(toml_pin); cpin=$(compose_pin)

    info "ruvector-postgres sidecar"
    echo "  running image : ${ref}"
    echo "  local digest  : ${repo_digest:-unknown}"
    echo "  toml pin      : ${pin:-none}"
    echo "  compose pin   : ${cpin:-none}"
    [[ "$pin" != "$cpin" ]] && warn "pin drift: agentbox.toml and docker-compose.yml disagree"
    echo "  compose owner : $(container_project || echo none)"
    echo "  extension     : $(pg "$CONTAINER" "SELECT extversion FROM pg_extension WHERE extname='ruvector';" 2>/dev/null || echo '?') (image default: $(pg "$CONTAINER" "SELECT default_version FROM pg_available_extensions WHERE name='ruvector';" 2>/dev/null || echo '?'))"
    echo "  postgres      : $(pg "$CONTAINER" "SHOW server_version;" 2>/dev/null || echo '?')"
    echo "  memory_entries: $(pg "$CONTAINER" "SELECT count(*) FROM memory_entries;" 2>/dev/null || echo '?') rows"
    echo "  data volume   : $(toml_volume)"
    hba_trust_audit
}

# hba_trust_audit — loud warning for any pg_hba `trust` rule that covers a
# non-loopback address (ADR-2133). Such a rule admits every client on that
# network as any role, the superuser included, without a password. pg_hba
# lives on the data volume, so a hand edit survives container recreates, and
# `rollback` restores whatever the snapshot carried. Informational: returns 0.
hba_trust_audit() {
    local rules
    if ! rules=$(pg "$CONTAINER" "$hba_trust_rules_sql" 2>/dev/null); then
        warn "pg_hba audit: could not read pg_hba_file_rules"
        return 0
    fi
    if [[ -z "$rules" ]]; then
        echo "  pg_hba        : no trust rule outside loopback"
        return 0
    fi
    echo -e "${RED}  ════════════════════════════════════════════════════════════════${NC}"
    echo -e "${RED}  !! pg_hba TRUST on a non-loopback address: any client there logs in${NC}"
    echo -e "${RED}  !! as ANY role (superuser ${PG_USER} included) WITHOUT a password.${NC}"
    while IFS= read -r r; do
        echo -e "${RED}  !!   line ${r%%|*}: ${r#*|}${NC}"
    done <<<"$rules"
    echo -e "${RED}  !! Fix: ./agentbox.sh ruvector hba-harden (dry-run first; ADR-2133)${NC}"
    echo -e "${RED}  ════════════════════════════════════════════════════════════════${NC}"
    return 0
}

cmd_check() {
    cmd_status
    echo ""
    info "upstream (docker.io/${HUB_REPO})"
    local latest tag local_digest
    latest=$(hub_latest_digest || true)
    if [[ -z "$latest" ]]; then
        warn "could not reach Docker Hub"
        return 0
    fi
    tag=$(hub_tag_for_digest "$latest")
    echo "  hub :latest   : ${latest} (tag: ${tag:-?})"
    echo -e "  ${YELLOW}note${NC}          : upstream publishes linux/amd64 only"
    local_digest=$(docker inspect "$(docker inspect "$CONTAINER" --format '{{.Image}}')" \
        --format '{{range .RepoDigests}}{{println .}}{{end}}' 2>/dev/null | awk -F@ '/@/{print $2; exit}')
    if [[ "$local_digest" == "$latest" ]]; then
        ok "running digest matches hub :latest"
    else
        warn "running ${local_digest:-unknown} != hub :latest ${latest}"
        echo "  update with   : ./agentbox.sh ruvector update"
    fi
}

cmd_test() {
    local c="$CONTAINER"
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --container) c="$2"; shift 2 ;;
            *) die "unknown test option: $1" ;;
        esac
    done
    info "smoke suite against ${c}"
    if smoke "$c" "-"; then
        echo -e "${GREEN}All smoke tests passed.${NC}"
    else
        die "smoke suite failed"
    fi
}

snapshot_volume() { # snapshot_volume <src-image> <snap-volume> — consistent copy of live datadir
    local img="$1" snap="$2" pw
    pw=$(pg_password)
    docker volume create "$snap" >/dev/null
    info "taking consistent snapshot via pg_basebackup -> ${snap}"
    if docker run --rm --network "container:${CONTAINER}" \
            -e PGPASSWORD="$pw" -v "${snap}:/to" "$img" \
            pg_basebackup -h 127.0.0.1 -U "$PG_USER" -D /to -X stream >/dev/null 2>&1; then
        ok "pg_basebackup snapshot complete"
        return 0
    fi
    warn "pg_basebackup failed — falling back to offline copy (brief sidecar stop)"
    docker stop "$CONTAINER" >/dev/null
    docker run --rm -v "$(toml_volume):/from:ro" -v "${snap}:/to" "$img" \
        sh -c 'cp -a /from/. /to/'
    docker start "$CONTAINER" >/dev/null
    wait_pg_ready "$CONTAINER" 120 || die "sidecar did not come back after offline snapshot"
    ok "offline snapshot complete, sidecar back up"
}

cmd_update() {
    local target="" dry_run=0 yes=0 adopt=0 keep_candidate=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --to)             target="$2"; shift 2 ;;
            --dry-run)        dry_run=1; shift ;;
            --yes)            yes=1; shift ;;
            --adopt)          adopt=1; shift ;;
            --keep-candidate) keep_candidate=1; shift ;;
            -h|--help)
                echo "Usage: $0 update [--to REF] [--dry-run] [--yes] [--adopt] [--keep-candidate]"
                return 0 ;;
            *) die "unknown update option: $1" ;;
        esac
    done

    command -v jq >/dev/null   || die "jq required"
    command -v curl >/dev/null || die "curl required"
    require_prod_running

    local volume current_pin
    volume=$(toml_volume); [[ -n "$volume" ]] || die "data_volume not found in agentbox.toml"
    current_pin=$(toml_pin);  [[ -n "$current_pin" ]] || die "image pin not found in agentbox.toml"

    # ── resolve target ref ──
    if [[ -z "$target" ]]; then
        local digest tag
        digest=$(hub_latest_digest) || die "cannot resolve hub :latest digest"
        tag=$(hub_tag_for_digest "$digest")
        if [[ -n "$tag" ]]; then
            target="${HUB_REPO}:${tag}@${digest}"
        else
            target="${HUB_REPO}@${digest}"
        fi
    fi
    if [[ "$target" == "$current_pin" ]]; then
        echo -e "${GREEN}Already pinned to ${target} — nothing to do.${NC}"
        return 0
    fi

    # ── ownership gate: mirror cmd_up's orphan adoption, but opt-in ──
    local owner; owner=$(container_project)
    if [[ -n "$owner" && "$owner" != "agentbox" && "$adopt" -eq 0 ]]; then
        die "sidecar is owned by compose project '${owner}', not 'agentbox'.
       Re-run with --adopt to take it over (data persists on ${volume}),
       or run the update from that stack instead."
    fi

    # ── baseline ──
    local rows ext pgver
    rows=$(pg "$CONTAINER" "SELECT count(*) FROM memory_entries;")
    ext=$(pg "$CONTAINER" "SELECT extversion FROM pg_extension WHERE extname='ruvector';")
    pgver=$(pg "$CONTAINER" "SHOW server_version;")

    # ── disk headroom: snapshot + dump live on the same fs as the volume ──
    local used avail
    used=$(docker exec "$CONTAINER" du -sb /var/lib/postgresql/data 2>/dev/null | awk '{print $1}' || echo 0)
    avail=$(docker exec "$CONTAINER" df -B1 --output=avail /var/lib/postgresql/data 2>/dev/null | tail -1 | tr -d ' ' || echo 0)
    if [[ "$used" -gt 0 && "$avail" -gt 0 && "$avail" -lt $(( used * 2 )) ]]; then
        die "insufficient disk headroom: datadir ${used}B, free ${avail}B (< 2x needed for snapshot + dump)"
    fi

    local ts; ts=$(date -u +%Y%m%dT%H%M%SZ)
    local run_dir="${STATE_DIR}/${ts}"
    local snap_vol="ruvector_pg_snap_${ts}"
    local dump_file="${run_dir}/ruvector.dump"

    info "update plan"
    echo "  current pin : ${current_pin}"
    echo "  running     : ext ruvector ${ext}, postgres ${pgver}, ${rows} rows"
    echo "  target      : ${target}"
    echo "  dump        : ${dump_file}"
    echo "  snapshot    : ${snap_vol} (volume)"
    echo "  gates       : candidate rehearsal must pass full smoke suite before swap"
    if [[ "$dry_run" -eq 1 ]]; then
        echo -e "${YELLOW}[--dry-run] no changes made.${NC}"
        return 0
    fi
    if [[ "$yes" -ne 1 ]]; then
        read -r -p "Proceed? [y/N] " answer
        [[ "$answer" =~ ^[Yy] ]] || { echo "Aborted."; return 1; }
    fi

    mkdir -p "$run_dir"
    state_write "phase=baseline" "previous_ref=${current_pin}" "target_ref=${target}" \
                "snapshot_volume=${snap_vol}" "dump_file=${dump_file}" \
                "baseline_rows=${rows}" "baseline_ext=${ext}" "volume=${volume}" "ts=${ts}"

    # ── 1. logical backup ──
    info "pg_dump -Fc -> ${dump_file}"
    docker exec "$CONTAINER" pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$dump_file" \
        || die "pg_dump failed"
    ok "logical backup: $(du -h "$dump_file" | cut -f1)"
    state_write "phase=dumped"

    # ── 2. physical snapshot ──
    local current_image
    current_image=$(docker inspect "$CONTAINER" --format '{{.Config.Image}}')
    snapshot_volume "$current_image" "$snap_vol"
    state_write "phase=snapshotted"

    # ── 3. pull target ──
    info "pulling ${target}"
    docker pull "$target" >/dev/null || die "docker pull ${target} failed"
    ok "pulled"

    # ── 4. candidate rehearsal on the snapshot ──
    info "starting candidate (${CANDIDATE}) on snapshot volume"
    docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true
    docker run -d --name "$CANDIDATE" --network none \
        -v "${snap_vol}:/var/lib/postgresql/data" "$target" >/dev/null
    if ! wait_pg_ready "$CANDIDATE" 300; then
        echo ""
        docker logs "$CANDIDATE" 2>&1 | tail -15
        if docker logs "$CANDIDATE" 2>&1 | grep -qi "incompatible"; then
            fail "target image cannot start on the existing data directory —"
            fail "likely a PostgreSQL major-version bump. An in-place upgrade is"
            fail "not possible; a dump/restore migration is required. The logical"
            fail "dump is at ${dump_file}. Aborting with production untouched."
        fi
        docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true
        die "candidate failed to become ready"
    fi
    ok "candidate is up"

    local cand_default cand_installed
    cand_installed=$(pg "$CANDIDATE" "SELECT extversion FROM pg_extension WHERE extname='ruvector';")
    cand_default=$(pg "$CANDIDATE" "SELECT default_version FROM pg_available_extensions WHERE name='ruvector';")
    if [[ "$cand_installed" != "$cand_default" ]]; then
        info "ALTER EXTENSION ruvector UPDATE (${cand_installed} -> ${cand_default}) in candidate"
        pg "$CANDIDATE" "ALTER EXTENSION ruvector UPDATE;" \
            || { docker rm -f "$CANDIDATE" >/dev/null; die "extension update failed in candidate — production untouched"; }
    fi

    info "smoke suite against candidate"
    if ! smoke "$CANDIDATE" "$rows"; then
        [[ "$keep_candidate" -eq 0 ]] && docker rm -f "$CANDIDATE" >/dev/null 2>&1
        die "candidate failed the smoke suite — production untouched.
       Snapshot volume ${snap_vol} and dump retained for inspection."
    fi
    ok "candidate rehearsal passed"
    docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true
    state_write "phase=candidate-tested"

    # ── 5. bump pins ──
    set_pin "$target"
    state_write "phase=pin-updated"

    # ── 6. swap production ──
    info "recreating ${SERVICE} on the real volume with ${target}"
    if [[ -n "$owner" && "$owner" != "agentbox" ]]; then
        warn "adopting sidecar from compose project '${owner}'"
        docker rm -f "$CONTAINER" >/dev/null
    fi
    if ! docker compose "${COMPOSE_ARGS[@]}" up -d "$SERVICE"; then
        fail "compose up failed — rolling back"
        cmd_rollback --yes
        exit 1
    fi
    state_write "phase=swapped"
    if ! wait_pg_ready "$CONTAINER" 300; then
        fail "production did not become ready — rolling back"
        cmd_rollback --yes
        exit 1
    fi

    local prod_installed prod_default
    prod_installed=$(pg "$CONTAINER" "SELECT extversion FROM pg_extension WHERE extname='ruvector';")
    prod_default=$(pg "$CONTAINER" "SELECT default_version FROM pg_available_extensions WHERE name='ruvector';")
    if [[ "$prod_installed" != "$prod_default" ]]; then
        info "ALTER EXTENSION ruvector UPDATE (${prod_installed} -> ${prod_default}) in production"
        if ! pg "$CONTAINER" "ALTER EXTENSION ruvector UPDATE;"; then
            fail "extension update failed in production — rolling back"
            state_write "phase=prod-altered"
            cmd_rollback --yes
            exit 1
        fi
    fi
    state_write "phase=prod-altered"
    pg "$CONTAINER" "ANALYZE memory_entries;" >/dev/null 2>&1 || true

    info "smoke suite against production"
    if ! smoke "$CONTAINER" "$rows"; then
        fail "production failed the smoke suite — rolling back"
        cmd_rollback --yes
        exit 1
    fi
    state_write "phase=done"

    echo ""
    echo -e "${GREEN}Update complete: ${current_pin} -> ${target}${NC}"
    echo "  rollback available : ./agentbox.sh ruvector rollback"
    echo "  snapshot volume    : ${snap_vol} (remove after a soak period:"
    echo "                       docker volume rm ${snap_vol})"
    echo "  logical dump       : ${dump_file}"
    echo "  commit the pin     : git add agentbox.toml docker-compose.yml"
    hba_trust_audit
}

cmd_rollback() {
    local yes=0
    [[ "${1:-}" == "--yes" ]] && yes=1
    [[ -f "$STATE_FILE" ]] || die "no state file at ${STATE_FILE} — nothing to roll back"

    local prev snap phase volume baseline_rows
    prev=$(state_get previous_ref)
    snap=$(state_get snapshot_volume)
    phase=$(state_get phase)
    volume=$(state_get volume)
    baseline_rows=$(state_get baseline_rows)
    [[ -n "$prev" && -n "$snap" && -n "$volume" ]] || die "state file incomplete"

    info "rollback to ${prev} (recorded phase: ${phase})"
    if [[ "$yes" -ne 1 ]]; then
        read -r -p "Proceed? [y/N] " answer
        [[ "$answer" =~ ^[Yy] ]] || { echo "Aborted."; return 1; }
    fi

    set_pin "$prev"

    # If the new image ever ran against the real volume, the extension catalog
    # may have been upgraded past what the old binaries provide — restore the
    # pre-update snapshot rather than trusting the datadir.
    if [[ "$phase" == "swapped" || "$phase" == "prod-altered" || "$phase" == "done" ]]; then
        docker volume inspect "$snap" >/dev/null 2>&1 \
            || die "snapshot volume ${snap} is gone — restore manually from the pg_dump"
        info "restoring datadir from snapshot ${snap}"
        docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
        docker run --rm -v "${volume}:/data" -v "${snap}:/snap:ro" "$prev" \
            sh -c 'find /data -mindepth 1 -delete && cp -a /snap/. /data/'
    else
        docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    fi

    docker compose "${COMPOSE_ARGS[@]}" up -d "$SERVICE" || die "compose up failed during rollback"
    wait_pg_ready "$CONTAINER" 300 || die "sidecar did not become ready after rollback"

    info "smoke suite after rollback"
    smoke "$CONTAINER" "${baseline_rows:--}" || die "rollback smoke suite failed — inspect manually"
    state_write "phase=rolled-back"
    echo -e "${GREEN}Rolled back to ${prev}.${NC}"
    # The restored datadir carries the snapshot's pg_hba.conf (ADR-2133).
    hba_trust_audit
}

# ── data-hygiene subcommands (PRD-018 Phase 2 / ADR-036 D5) ──────────────────

# 1. migrate-trajectories — additive schema for the learning loop. No toml flag
#    (purely additive: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS).
cmd_migrate_trajectories() {
    local apply=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --yes)     apply=1; shift ;;
            --dry-run) apply=0; shift ;;
            -h|--help) echo "Usage: $0 migrate-trajectories [--yes]"; return 0 ;;
            *) die "unknown migrate-trajectories option: $1" ;;
        esac
    done
    require_prod_running

    local sql="ALTER TABLE trajectory_steps ADD COLUMN IF NOT EXISTS duration_ms double precision;
CREATE INDEX IF NOT EXISTS idx_trajectory_steps_trajectory ON trajectory_steps(trajectory_id);"

    info "migrate-trajectories (additive, learning-loop schema)"
    echo "  before:"
    psql_raw "$CONTAINER" "\\d trajectory_steps" | sed 's/^/    /'
    echo ""
    echo "  SQL that WOULD run:"
    echo "$sql" | sed 's/^/    /'

    if [[ "$apply" -ne 1 ]]; then
        echo -e "${YELLOW}[dry-run] no changes made. Re-run with --yes to apply.${NC}"
        return 0
    fi

    info "applying additive migration"
    pg "$CONTAINER" "$sql" >/dev/null || die "migration failed"
    ok "duration_ms column + idx_trajectory_steps_trajectory ensured"
    echo "  after:"
    psql_raw "$CONTAINER" "\\d trajectory_steps" | sed 's/^/    /'
    echo -e "${GREEN}migrate-trajectories complete.${NC}"
}

# 2. repair-namespaces — un-swap namespace<->value on the 178,238 corrupted rows.
cmd_repair_namespaces() {
    local apply=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --yes)     apply=1; shift ;;
            --dry-run) apply=0; shift ;;
            -h|--help) echo "Usage: $0 repair-namespaces [--yes]  (flag: allow_namespace_repair)"; return 0 ;;
            *) die "unknown repair-namespaces option: $1" ;;
        esac
    done
    require_prod_running

    local n
    n=$(pg "$CONTAINER" "SELECT count(*) FROM memory_entries WHERE ${SWAP_PREDICATE};")

    # The swapped JSON in the namespace column was truncated on write for most
    # rows (the column is narrower than the original value), so a bare ::jsonb
    # cast aborts the whole transaction. PG17's pg_input_is_valid() guards the
    # cast; unparseable text is preserved verbatim as {"raw":…,"truncated":true}
    # — that truncated text is all that remains of the original value.
    local sql="BEGIN;
UPDATE memory_entries
   SET namespace = value->>'data',
       value     = CASE WHEN pg_input_is_valid(namespace, 'jsonb')
                        THEN namespace::jsonb
                        ELSE jsonb_build_object('raw', namespace, 'truncated', true)
                        END
 WHERE ${SWAP_PREDICATE};
COMMIT;"

    info "repair-namespaces (namespace<->value un-swap)"
    echo "  detection : namespace LIKE '{%' AND value ? 'data'"
    echo "  affected  : ${n} rows"
    echo "  transform : namespace <- value->>'data' ; value <- namespace::jsonb when valid, else {\"raw\":…,\"truncated\":true}"
    echo "  examples  :"
    pg "$CONTAINER" "SELECT id || '  ns=[' || left(namespace,32) || ']  ->real=[' || left(value->>'data',40) || ']'
                     FROM memory_entries WHERE ${SWAP_PREDICATE} LIMIT 5;" | sed 's/^/    /'
    echo ""
    echo "  SQL that WOULD run (single transaction):"
    echo "$sql" | sed 's/^/    /'

    if ! hygiene_apply_gate "$apply" "allow_namespace_repair" "repair-namespaces"; then
        echo -e "${YELLOW}[dry-run] no changes made. Re-run with --yes (and [memory_hygiene] allow_namespace_repair=true) to apply.${NC}"
        return 0
    fi
    [[ "$n" -eq 0 ]] && { echo -e "${GREEN}nothing to repair.${NC}"; return 0; }

    # Pre-op backup of exactly the affected rows (reversible via COPY FROM).
    mkdir -p "$STATE_DIR"
    local ts backup
    ts=$(date -u +%Y%m%dT%H%M%SZ)
    backup="${STATE_DIR}/repair-namespaces-${ts}.copy.gz"
    info "backing up ${n} affected rows -> ${backup}"
    docker exec "$CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 \
        -c "\\copy (SELECT id, namespace, value FROM memory_entries WHERE ${SWAP_PREDICATE}) TO STDOUT" \
        | gzip > "$backup" || die "pre-op backup failed — aborting, no rows changed"
    ok "backup: $(du -h "$backup" | cut -f1)"

    info "applying swap in a single transaction"
    pg "$CONTAINER" "$sql" >/dev/null || die "repair transaction failed (rolled back)"
    local remaining
    remaining=$(pg "$CONTAINER" "SELECT count(*) FROM memory_entries WHERE ${SWAP_PREDICATE};")
    ok "repaired ${n} rows (remaining matching detection predicate: ${remaining})"
    echo "  restore   : gunzip -c ${backup} | docker exec -i ${CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -c \"\\copy ... FROM STDIN\""
    echo -e "${GREEN}repair-namespaces complete.${NC}"
}

# 3. backfill-embeddings — compute embeddings for NULL-embedding non-empty rows.
cmd_backfill_embeddings() {
    local apply=0 batch=50
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --yes)     apply=1; shift ;;
            --dry-run) apply=0; shift ;;
            --batch)   batch="$2"; shift 2 ;;
            -h|--help) echo "Usage: $0 backfill-embeddings [--yes] [--batch N]  (flag: allow_embedding_backfill)"; return 0 ;;
            *) die "unknown backfill-embeddings option: $1" ;;
        esac
    done
    require_prod_running

    local pred="embedding IS NULL AND value IS NOT NULL AND value::text NOT IN ('\"\"','null','{}')"
    local n
    n=$(pg "$CONTAINER" "SELECT count(*) FROM memory_entries WHERE ${pred};")

    info "backfill-embeddings (Xinference ${XINFERENCE_MODEL})"
    echo "  endpoint  : ${XINFERENCE_ENDPOINT}/v1/embeddings"
    echo "  model     : ${XINFERENCE_MODEL} (384-dim, matches ruvector(384))"
    echo "  candidates: ${n} NULL-embedding non-empty rows"
    echo "  per row   : POST value text -> embedding; UPDATE memory_entries.embedding"
    echo "  on failure: UPDATE metadata = metadata || '{\"embedding_quarantined\":true}'"
    echo "  examples  :"
    pg "$CONTAINER" "SELECT id || '  ns=[' || left(namespace,24) || ']  val=[' || left(value::text,32) || ']'
                     FROM memory_entries WHERE ${pred} LIMIT 5;" | sed 's/^/    /'

    if ! hygiene_apply_gate "$apply" "allow_embedding_backfill" "backfill-embeddings"; then
        echo -e "${YELLOW}[dry-run] no HTTP calls or writes made. Re-run with --yes (and [memory_hygiene] allow_embedding_backfill=true) to apply.${NC}"
        return 0
    fi
    [[ "$n" -eq 0 ]] && { echo -e "${GREEN}nothing to backfill.${NC}"; return 0; }
    command -v curl >/dev/null || die "curl required"
    command -v jq >/dev/null   || die "jq required"

    info "resolving candidate ids"
    local ids id text vec http_ok=0 quarantined=0 done=0
    mapfile -t ids < <(pg "$CONTAINER" "SELECT id FROM memory_entries WHERE ${pred};")
    for id in "${ids[@]}"; do
        [[ -z "$id" ]] && continue
        # Fetch the plain text payload for this row (jsonb -> text).
        text=$(pg "$CONTAINER" "SELECT value::text FROM memory_entries WHERE id='$(sql_quote "$id")';")
        # Ask Xinference for a 384-dim embedding.
        vec=$(curl -fsS --max-time 30 -X POST "${XINFERENCE_ENDPOINT}/v1/embeddings" \
                -H 'Content-Type: application/json' \
                --data "$(jq -n --arg m "$XINFERENCE_MODEL" --arg i "$text" '{model:$m,input:$i}')" 2>/dev/null \
              | jq -rc 'if (.data[0].embedding|length)==384 then (.data[0].embedding|@json) else empty end' 2>/dev/null || true)
        if [[ -n "$vec" ]]; then
            if pg "$CONTAINER" "UPDATE memory_entries SET embedding='${vec}'::ruvector, updated_at=now()
                                WHERE id='$(sql_quote "$id")';" >/dev/null 2>&1; then
                http_ok=$((http_ok+1))
            else
                pg "$CONTAINER" "UPDATE memory_entries
                                    SET metadata = coalesce(metadata,'{}'::jsonb) || '{\"embedding_quarantined\":true}'::jsonb
                                  WHERE id='$(sql_quote "$id")';" >/dev/null 2>&1 || true
                quarantined=$((quarantined+1))
            fi
        else
            pg "$CONTAINER" "UPDATE memory_entries
                                SET metadata = coalesce(metadata,'{}'::jsonb) || '{\"embedding_quarantined\":true}'::jsonb
                              WHERE id='$(sql_quote "$id")';" >/dev/null 2>&1 || true
            quarantined=$((quarantined+1))
        fi
        done=$((done+1))
        if (( done % batch == 0 )); then
            echo "  progress: ${done}/${n}  (embedded ${http_ok}, quarantined ${quarantined})"
        fi
    done
    ok "backfill done: ${http_ok} embedded, ${quarantined} quarantined, ${done} processed"
    pg "$CONTAINER" "ANALYZE memory_entries;" >/dev/null 2>&1 || true
    echo -e "${GREEN}backfill-embeddings complete.${NC}"
}

# 4. archive-legacy — snapshot, COPY-out (data-only), then DELETE the frozen
#    legacy / dead-hooks namespaces in batches. Reversible (archive retained).
cmd_archive_legacy() {
    local apply=0 batch=10000
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --yes)     apply=1; shift ;;
            --dry-run) apply=0; shift ;;
            --batch)   batch="$2"; shift 2 ;;
            -h|--help) echo "Usage: $0 archive-legacy [--yes] [--batch N]  (flag: allow_legacy_archival)"; return 0 ;;
            *) die "unknown archive-legacy option: $1" ;;
        esac
    done
    require_prod_running

    local n size
    n=$(pg "$CONTAINER" "SELECT count(*) FROM memory_entries WHERE ${LEGACY_PREDICATE};")
    size=$(pg "$CONTAINER" "SELECT pg_size_pretty(pg_total_relation_size('memory_entries'));")

    info "archive-legacy (frozen legacy / dead-hooks namespaces)"
    echo "  table size (now) : ${size}"
    echo "  affected rows    : ${n}"
    echo "  namespace roots  :"
    pg "$CONTAINER" "SELECT split_part(namespace,'/',1) || coalesce('/'||split_part(namespace,'/',2),'') AS grp, count(*)
                     FROM memory_entries WHERE ${LEGACY_PREDICATE}
                     GROUP BY 1 ORDER BY 2 DESC LIMIT 20;" \
        | awk -F'|' '{printf "    %-40s %s\n", $1, $2}'
    echo ""
    echo "  archive (COPY data-only) that WOULD run:"
    echo "    \\copy (SELECT * FROM memory_entries WHERE ${LEGACY_PREDICATE}) TO STDOUT | gzip > backups/ruvector-sidecar/archive-legacy-<ts>.copy.gz"
    echo "  delete (batched, ${batch}/batch) that WOULD run:"
    echo "    DELETE FROM memory_entries WHERE ctid IN"
    echo "      (SELECT ctid FROM memory_entries WHERE ${LEGACY_PREDICATE} LIMIT ${batch});  -- looped until 0"
    echo "  then: VACUUM ANALYZE memory_entries;  (reclaims heap + HNSW bloat)"

    if ! hygiene_apply_gate "$apply" "allow_legacy_archival" "archive-legacy"; then
        echo -e "${YELLOW}[dry-run] no snapshot/archive/delete performed. Re-run with --yes (and [memory_hygiene] allow_legacy_archival=true) to apply.${NC}"
        return 0
    fi
    [[ "$n" -eq 0 ]] && { echo -e "${GREEN}nothing to archive.${NC}"; return 0; }

    # Pre-delete physical snapshot via the existing snapshot machinery.
    local ts snap_vol archive current_image
    ts=$(date -u +%Y%m%dT%H%M%SZ)
    snap_vol="ruvector_pg_snap_archive_${ts}"
    archive="${STATE_DIR}/archive-legacy-${ts}.copy.gz"
    mkdir -p "$STATE_DIR"
    current_image=$(docker inspect "$CONTAINER" --format '{{.Config.Image}}')
    snapshot_volume "$current_image" "$snap_vol"
    state_write "phase=archive-snapshotted" "archive_snapshot=${snap_vol}" "archive_file=${archive}" "archive_ts=${ts}"

    # Logical, data-only export of exactly the archived rows (reversible).
    info "COPY data-only export -> ${archive}"
    docker exec "$CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 \
        -c "\\copy (SELECT * FROM memory_entries WHERE ${LEGACY_PREDICATE}) TO STDOUT" \
        | gzip > "$archive" || die "archive export failed — aborting, no rows deleted (snapshot ${snap_vol} retained)"
    ok "archive: $(du -h "$archive" | cut -f1)"

    info "deleting in batches of ${batch}"
    local deleted=0 d
    while :; do
        d=$(pg "$CONTAINER" "WITH del AS (
                DELETE FROM memory_entries
                 WHERE ctid IN (SELECT ctid FROM memory_entries WHERE ${LEGACY_PREDICATE} LIMIT ${batch})
                RETURNING 1) SELECT count(*) FROM del;")
        [[ -z "$d" || "$d" == "0" ]] && break
        deleted=$((deleted + d))
        echo "  deleted ${deleted}/${n}"
    done
    ok "deleted ${deleted} rows"

    local newsize
    newsize=$(pg "$CONTAINER" "SELECT pg_size_pretty(pg_total_relation_size('memory_entries'));")
    state_write "phase=archive-done" "archive_deleted=${deleted}"
    echo ""
    echo -e "${GREEN}archive-legacy complete: ${deleted} rows removed.${NC}"
    echo "  table size       : ${size} -> ${newsize}"
    echo "  archive          : ${archive} (restore: gunzip -c ... | psql \\copy memory_entries FROM STDIN)"
    echo "  pre-delete snap  : ${snap_vol} (docker volume rm after soak)"
    echo -e "  ${YELLOW}suggested next   : docker exec ${CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -c 'VACUUM ANALYZE memory_entries;'${NC}"
    echo "                     (reclaims heap + rebuilds HNSW planner stats; run off-peak)"
}

# ── learning + retrieval subcommands (PRD-018 / ADR-036 D1/D4) ───────────────

# 5. aggregate-effectiveness — distil trajectory_steps into per-action-pattern
#    EffectivenessAggregates (Wilson lower bound + recency decay), written
#    THROUGH the governed memStore path (never raw SQL) into
#    memory-learning-aggregates. Node lib does the maths + governed write; this
#    subcommand owns the gate + .mcp.json env resolution. apply requires
#    [memory_learning].enabled = true (fail-closed).
cmd_aggregate_effectiveness() {
    local apply=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --yes)     apply=1; shift ;;
            --dry-run) apply=0; shift ;;
            -h|--help) echo "Usage: $0 aggregate-effectiveness [--yes]  (flag: [memory_learning].enabled)"; return 0 ;;
            *) die "unknown aggregate-effectiveness option: $1" ;;
        esac
    done
    require_prod_running
    command -v node >/dev/null || die "node required for aggregate-effectiveness"

    local lib="${REPO_DIR}/mcp/servers/lib/aggregate-effectiveness.js"
    [[ -f "$lib" ]] || die "aggregate lib not found: ${lib}"

    # Resolve the governed MCP env (.mcp.json pattern); force typed metadata on so
    # the aggregate's tags/importance persist (feed_retrieval re-rank keys on them).
    local -a envp=()
    mapfile -t envp < <(mcp_env_pairs || true)
    envp+=("RUVECTOR_TYPED_METADATA=1")

    info "aggregate-effectiveness (Wilson lower-bound + recency decay, ADR-036 D1)"
    echo "  namespace : memory-learning-aggregates (governed memStore path — no raw SQL)"
    echo "  tunables  : RUVECTOR_AGGREGATE_MIN_SAMPLES, RUVECTOR_RECENCY_HALF_LIFE_DAYS"
    echo "  env       : ${#envp[@]} key(s) from .mcp.json (+ RUVECTOR_TYPED_METADATA=1)"

    if learning_apply_gate "$apply" "aggregate-effectiveness"; then
        info "applying — upserting eligible aggregates via memStore"
        env "${envp[@]}" node "$lib" --yes || die "aggregate-effectiveness apply failed"
        echo -e "${GREEN}aggregate-effectiveness complete.${NC}"
    else
        env "${envp[@]}" node "$lib" || die "aggregate-effectiveness dry-run failed"
        echo -e "${YELLOW}[dry-run] no writes. Re-run with --yes (and [memory_learning] enabled=true) to apply.${NC}"
    fi
}

# 6. build-metadata-gin — GIN on metadata jsonb_path_ops so tag (metadata @> …)
#    retrieval is a bitmap index scan instead of a ~365k-cost parallel seq scan.
#    Gated on [integrations.ruvector_external].metadata_gin (fail-closed).
cmd_build_metadata_gin() {
    local apply=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --yes)     apply=1; shift ;;
            --dry-run) apply=0; shift ;;
            -h|--help) echo "Usage: $0 build-metadata-gin [--yes]  (flag: metadata_gin)"; return 0 ;;
            *) die "unknown build-metadata-gin option: $1" ;;
        esac
    done
    require_prod_running

    # CREATE INDEX CONCURRENTLY must run outside a transaction (autocommit via -c).
    local sql="CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memory_metadata_gin ON memory_entries USING gin (metadata jsonb_path_ops);"
    local present
    present=$(pg "$CONTAINER" "SELECT 1 FROM pg_indexes WHERE tablename='memory_entries' AND indexname='idx_memory_metadata_gin' LIMIT 1;")

    info "build-metadata-gin (tag @> retrieval acceleration, ADR-036 D4)"
    echo "  gate      : [integrations.ruvector_external] metadata_gin"
    if [[ -n "$present" ]]; then
        echo "  current   : idx_memory_metadata_gin ALREADY present"
    else
        echo "  current   : idx_memory_metadata_gin ABSENT"
    fi
    echo "  SQL that WOULD run:"
    echo "    ${sql}"
    echo "  estimated benefit (current metadata @> plan — the seq scan this removes):"
    psql_raw "$CONTAINER" "EXPLAIN SELECT count(*) FROM memory_entries WHERE metadata @> '{\"tags\":[\"probe\"]}';" | sed 's/^/    /'

    if ! ruvector_apply_gate "$apply" "metadata_gin" "build-metadata-gin"; then
        echo -e "${YELLOW}[dry-run] no index built. Re-run with --yes (and [integrations.ruvector_external] metadata_gin=true) to apply.${NC}"
        return 0
    fi
    [[ -n "$present" ]] && { echo -e "${GREEN}index already present — nothing to do.${NC}"; return 0; }

    info "building GIN index CONCURRENTLY (no table lock; may take minutes over 2M+ rows)"
    if ! pg "$CONTAINER" "$sql" >/dev/null; then
        die "GIN build failed. A failed CONCURRENTLY build can leave an INVALID index —
       inspect with: docker exec ${CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -c \"\\d memory_entries\"
       and drop if needed: DROP INDEX IF EXISTS idx_memory_metadata_gin;"
    fi
    ok "idx_memory_metadata_gin built"
    echo "  new metadata @> plan:"
    psql_raw "$CONTAINER" "EXPLAIN SELECT count(*) FROM memory_entries WHERE metadata @> '{\"tags\":[\"probe\"]}';" | sed 's/^/    /'
    pg "$CONTAINER" "ANALYZE memory_entries;" >/dev/null 2>&1 || true
    echo -e "${GREEN}build-metadata-gin complete.${NC}"
}

# 7. recall — the recall-regression harness (ADR-040 D2 / W-B). READ-ONLY: it
#    never writes an aggregate, a fixture row, or a schema change. It runs the
#    frozen QuerySetFixture against the live HNSW index and prints per-class
#    median-of-3 scores + PASS/FAIL against the no-regression band; per-run
#    evidence lands under backups/ruvector-sidecar/recall-runs/. No gate — a
#    pure read is always safe to run. Env resolved from .mcp.json exactly like
#    aggregate-effectiveness (RUVECTOR_PG_CONNINFO, XINFERENCE_ENDPOINT, …).
RECALL_HARNESS="${RUVECTOR_RECALL_HARNESS:-${REPO_DIR}/scripts/ruvector-recall-harness.mjs}"

# run_recall_harness <args…> — the harness under the governed MCP env. Its
# stdout is the harness's own (machine JSON with --json); exit 0 PASS, 2 FAIL.
run_recall_harness() {
    command -v node >/dev/null || die "node required for recall"
    [[ -f "$RECALL_HARNESS" ]] || die "recall harness not found: ${RECALL_HARNESS}"
    local -a envp=()
    mapfile -t envp < <(mcp_env_pairs || true)
    env "${envp[@]}" node "$RECALL_HARNESS" "$@"
}

# The ENFORCED floor (ADR-040 D2 band; workspace RuVector rules). A reindex
# must land at or above it, whatever the harness band in the fixture says.
RECALL_FLOOR_SELF=175
RECALL_FLOOR_TRUE=102

# recall_capture — one median-of-3 run, parsed into RECALL_SELF, RECALL_TRUE,
# RECALL_VERDICT (PASS|FAIL) and RECALL_ARTIFACT. Returns 0 when the harness
# produced a verdict (PASS or FAIL), 1 when it errored (fixture drift, DB down)
# and there is no measurement to record.
recall_capture() {
    local out rc
    out=$(mktemp)
    set +e
    run_recall_harness --json > "$out"
    rc=$?
    set -e
    if [[ $rc -ne 0 && $rc -ne 2 ]] || ! jq -e '.medians.self_recall' "$out" >/dev/null 2>&1; then
        rm -f "$out"
        return 1
    fi
    RECALL_SELF=$(jq -r '.medians.self_recall' "$out")
    RECALL_TRUE=$(jq -r '.medians.true_recall' "$out")
    RECALL_VERDICT=$(jq -r 'if .verdict.pass then "PASS" else "FAIL" end' "$out")
    RECALL_ARTIFACT=$(jq -r '.artifact // empty' "$out")
    rm -f "$out"
    return 0
}

# recall_meets_floor — the last capture is a PASS and at/above the floor.
recall_meets_floor() {
    [[ "$RECALL_VERDICT" == "PASS" ]] \
        && (( RECALL_SELF >= RECALL_FLOOR_SELF )) \
        && (( RECALL_TRUE >= RECALL_FLOOR_TRUE ))
}

cmd_recall() {
    require_prod_running

    # Resolve the governed MCP env (.mcp.json pattern). Empty output is fine —
    # the harness falls back to the documented defaults.
    local -a envp=()
    mapfile -t envp < <(mcp_env_pairs || true)

    info "recall — recall-regression harness (ADR-040 D2 / W-B, read-only)"
    echo "  fixture   : scripts/recall-fixtures/recall-fixture.v1.json (frozen, checked in)"
    echo "  classes   : self-recall@10 / true-recall@10 (vs forced exact scan) / exact-token"
    echo "  gate      : median-of-3 no-regression band; PASS exit 0, FAIL non-zero"
    echo "  artifact  : backups/ruvector-sidecar/recall-runs/<utc>.json"
    echo "  env       : ${#envp[@]} key(s) from .mcp.json"

    # Pass all remaining args through (--runs, --k, --fixture, --json,
    # --build-fixture, --force, --help). The harness sets its own exit code.
    run_recall_harness "$@"
}

# 8. reindex — recover HNSW recall after write churn (ADR-2133). The index law
#    (docs/LEARNING-memory.md invariant 8): non-concurrent AND serial, m=16,
#    ef_construction=128. CONCURRENTLY double-inserts every tuple with this AM;
#    the AM's parallel build leaves rows unreachable. The rebuild lands under a
#    temporary name beside the live index (CREATE INDEX takes SHARE: reads and
#    ANN searches keep using the old index, writes wait) and is swapped in with
#    one short DROP+RENAME transaction. Verified on a scratch database against
#    ruvector 0.3.0: a renamed HNSW index serves rows inserted after the swap,
#    with no duplicate ids. Recall is measured before and after; the post-run
#    must clear the enforced floor or the command fails loudly.
HNSW_INDEX="idx_memory_embedding_hnsw"
HNSW_REBUILD="${HNSW_INDEX}_rebuild"
HNSW_OPCLASS="ruvector_cosine_ops"
HNSW_M=16
HNSW_EFC=128

hnsw_create_sql() { # hnsw_create_sql <index-name> — the index-law definition
    printf "CREATE INDEX %s ON memory_entries USING hnsw (embedding %s) WITH (m='%s', ef_construction='%s');" \
        "$1" "$HNSW_OPCLASS" "$HNSW_M" "$HNSW_EFC"
}

hnsw_swap_sql() {
    printf "BEGIN; SET LOCAL lock_timeout = '60s'; DROP INDEX %s; ALTER INDEX %s RENAME TO %s; COMMIT;" \
        "$HNSW_INDEX" "$HNSW_REBUILD" "$HNSW_INDEX"
}

hnsw_index_def() { # current definition of <index> from pg_indexes (empty if absent)
    pg "$CONTAINER" "SELECT indexdef FROM pg_indexes WHERE schemaname='public'
                     AND tablename='memory_entries' AND indexname='$1';"
}

# The ANN probe used after the swap: the planner must pick the HNSW index and
# a top-20 must carry 20 distinct ids (the double-insertion signature is the
# same id twice in one top-k).
hnsw_ann_probe_sql() {
    printf "SET enable_seqscan = off; SELECT count(*) || ':' || count(DISTINCT id) FROM (SELECT id FROM memory_entries ORDER BY embedding <=> (SELECT embedding FROM memory_entries WHERE embedding IS NOT NULL ORDER BY id LIMIT 1) LIMIT 20) q;"
}

cmd_reindex() {
    local apply=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --yes)     apply=1; shift ;;
            --dry-run) apply=0; shift ;;
            -h|--help) echo "Usage: $0 reindex [--dry-run|--yes]  (serial, non-concurrent HNSW rebuild + swap, recall-gated)"; return 0 ;;
            *) die "unknown reindex option: $1" ;;
        esac
    done
    require_prod_running

    local def
    def=$(hnsw_index_def "$HNSW_INDEX")
    [[ -n "$def" ]] || die "${HNSW_INDEX} is absent — nothing to rebuild. Create it with:
       SET max_parallel_maintenance_workers = 0; $(hnsw_create_sql "$HNSW_INDEX")"

    info "reindex — serial, non-concurrent rebuild of ${HNSW_INDEX} (ADR-2133)"
    echo "  current   : ${def}"
    if [[ "$def" != *"USING hnsw (embedding ${HNSW_OPCLASS})"* ]]; then
        die "operator class check failed: expected 'USING hnsw (embedding ${HNSW_OPCLASS})'.
       Rebuilding with a different opclass changes retrieval geometry; that is a
       migration under the recall gate, not a reindex. Refusing."
    fi
    ok "operator class ${HNSW_OPCLASS} (cosine; matches the <=> search path)"
    local cur_m cur_efc
    cur_m=$(grep -oE "m='?[0-9]+" <<<"$def" | grep -oE '[0-9]+' | head -1 || true)
    cur_efc=$(grep -oE "ef_construction='?[0-9]+" <<<"$def" | grep -oE '[0-9]+' | head -1 || true)
    if [[ "$cur_m" == "$HNSW_M" && "$cur_efc" == "$HNSW_EFC" ]]; then
        ok "build parameters m=${cur_m} ef_construction=${cur_efc} (index law)"
    else
        warn "current parameters m=${cur_m:-default} ef_construction=${cur_efc:-default}; the rebuild uses the index law m=${HNSW_M} ef_construction=${HNSW_EFC}"
    fi

    local rows size leftover server_pmw
    rows=$(pg "$CONTAINER" "SELECT count(*) || ' rows, ' || count(embedding) || ' embedded' FROM memory_entries;")
    size=$(pg "$CONTAINER" "SELECT pg_size_pretty(pg_relation_size('public.${HNSW_INDEX}'::regclass));")
    leftover=$(pg "$CONTAINER" "SELECT CASE WHEN indisvalid THEN 'valid' ELSE 'INVALID' END FROM pg_index WHERE indexrelid = to_regclass('public.${HNSW_REBUILD}');")
    server_pmw=$(pg "$CONTAINER" "SHOW max_parallel_maintenance_workers;")
    echo "  corpus    : ${rows}"
    echo "  size      : ${size} (current index)"
    echo "  server    : max_parallel_maintenance_workers=${server_pmw} (the build forces 0 in-session regardless)"
    [[ -n "$leftover" ]] && warn "a ${leftover} ${HNSW_REBUILD} from an interrupted run exists; it is dropped first"
    echo "  plan:"
    echo "    1. recall harness (median-of-3) — recorded as the before figure"
    echo "    2. SET max_parallel_maintenance_workers = 0; $(hnsw_create_sql "$HNSW_REBUILD")"
    echo "    3. $(hnsw_swap_sql)"
    echo "    4. verify: definition, planner uses ${HNSW_INDEX}, top-20 ids distinct; ANALYZE"
    echo "    5. recall harness — must PASS at ≥${RECALL_FLOOR_SELF}/200 self, ≥${RECALL_FLOOR_TRUE}/120 true"
    echo "  impact    : writes to memory_entries wait for the build (~5–8 min); ANN"
    echo "              searches keep using the old index until the swap. Never CONCURRENTLY."

    if [[ "$apply" -ne 1 ]]; then
        echo -e "${YELLOW}[dry-run] nothing changed. Re-run with --yes to rebuild.${NC}"
        return 0
    fi

    state_write "reindex.phase=pre-recall" "reindex.started_at=$(date -u +%FT%TZ)" \
                "reindex.index_def_before=${def}" "reindex.index_size_before=${size}"

    info "1/5 recall harness (before)"
    recall_capture || die "the recall harness errored before the rebuild (fixture drift or DB/embedder down).
       A reindex without a recorded baseline is refused — fix the harness first
       (\`$0 recall\` shows the error)."
    state_write "reindex.pre_self=${RECALL_SELF}" "reindex.pre_true=${RECALL_TRUE}" \
                "reindex.pre_verdict=${RECALL_VERDICT}" "reindex.pre_artifact=${RECALL_ARTIFACT}"
    echo "  before    : self ${RECALL_SELF}/200, true ${RECALL_TRUE}/120 — ${RECALL_VERDICT}"

    info "2/5 building ${HNSW_REBUILD} (serial, non-concurrent)"
    [[ -n "$leftover" ]] && pg "$CONTAINER" "DROP INDEX IF EXISTS public.${HNSW_REBUILD};" >/dev/null
    state_write "reindex.phase=building"
    local t0 t1 secs
    t0=$(date +%s)
    if ! pg "$CONTAINER" "SET max_parallel_maintenance_workers = 0; $(hnsw_create_sql "$HNSW_REBUILD")" >/dev/null; then
        pg "$CONTAINER" "DROP INDEX IF EXISTS public.${HNSW_REBUILD};" >/dev/null 2>&1 || true
        state_write "reindex.phase=build-failed"
        die "build of ${HNSW_REBUILD} failed; ${HNSW_INDEX} is untouched."
    fi
    t1=$(date +%s); secs=$((t1 - t0))
    state_write "reindex.build_seconds=${secs}"
    ok "built in ${secs}s"
    [[ "$(pg "$CONTAINER" "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass('public.${HNSW_REBUILD}');")" == "t" ]] \
        || die "${HNSW_REBUILD} is not valid after the build; ${HNSW_INDEX} is untouched."

    info "3/5 swap"
    local attempt swapped=0
    for attempt in 1 2 3; do
        if pg "$CONTAINER" "$(hnsw_swap_sql)" >/dev/null; then swapped=1; break; fi
        warn "swap attempt ${attempt} could not take the lock within 60s; retrying"
    done
    if [[ "$swapped" -ne 1 ]]; then
        state_write "reindex.phase=swap-failed"
        die "swap failed three times. ${HNSW_INDEX} (old) still serves searches and
       ${HNSW_REBUILD} is built and valid. Swap by hand when the table is quiet:
       docker exec ${CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -c \"$(hnsw_swap_sql)\""
    fi
    state_write "reindex.phase=swapped"
    ok "${HNSW_REBUILD} → ${HNSW_INDEX}"

    info "4/5 verify"
    local newdef probe
    newdef=$(hnsw_index_def "$HNSW_INDEX")
    [[ "$newdef" == *"USING hnsw (embedding ${HNSW_OPCLASS}) WITH (m='${HNSW_M}', ef_construction='${HNSW_EFC}')"* ]] \
        || die "post-swap definition is not the index law: ${newdef}"
    ok "definition: ${newdef}"
    pg "$CONTAINER" "SET enable_seqscan = off; EXPLAIN SELECT id FROM memory_entries ORDER BY embedding <=> (SELECT embedding FROM memory_entries WHERE embedding IS NOT NULL LIMIT 1) LIMIT 10;" \
        | grep -q "$HNSW_INDEX" || die "the planner does not use ${HNSW_INDEX} after the swap"
    ok "planner uses ${HNSW_INDEX}"
    probe=$(pg "$CONTAINER" "$(hnsw_ann_probe_sql)" | tail -1)
    [[ "$probe" == "20:20" ]] || die "top-20 ANN probe returned '${probe}' (count:distinct) — duplicate ids mean double insertion"
    ok "top-20 ANN probe: 20 distinct ids"
    pg "$CONTAINER" "ANALYZE memory_entries;" >/dev/null 2>&1 || true
    local size_after
    size_after=$(pg "$CONTAINER" "SELECT pg_size_pretty(pg_relation_size('public.${HNSW_INDEX}'::regclass));")
    state_write "reindex.index_def_after=${newdef}" "reindex.index_size_after=${size_after}"
    echo "  size      : ${size} → ${size_after}"

    info "5/5 recall harness (after)"
    recall_capture || { state_write "reindex.phase=post-recall-error";
        die "the recall harness errored after the swap — recall is UNMEASURED. Run \`$0 recall\` now."; }
    state_write "reindex.post_self=${RECALL_SELF}" "reindex.post_true=${RECALL_TRUE}" \
                "reindex.post_verdict=${RECALL_VERDICT}" "reindex.post_artifact=${RECALL_ARTIFACT}" \
                "reindex.finished_at=$(date -u +%FT%TZ)"
    echo "  after     : self ${RECALL_SELF}/200, true ${RECALL_TRUE}/120 — ${RECALL_VERDICT}"
    if ! recall_meets_floor; then
        state_write "reindex.phase=post-recall-fail"
        echo -e "${RED}════════════════════════════════════════════════════════════════${NC}" >&2
        die "RECALL BELOW THE ENFORCED FLOOR after the rebuild: self ${RECALL_SELF}/200
       (floor ${RECALL_FLOOR_SELF}), true ${RECALL_TRUE}/120 (floor ${RECALL_FLOOR_TRUE}), verdict ${RECALL_VERDICT}.
       The index is the index-law rebuild; the cause is elsewhere (fixture, embedder,
       corpus). Artifact: ${RECALL_ARTIFACT}"
    fi
    state_write "reindex.phase=done"
    echo -e "${GREEN}reindex complete: ${secs}s build, recall clears the floor.${NC}"
}

# 9. reader-role — least-privilege login for read-only consumers (ADR-2133).
#    ruvector_reader: LOGIN, password from RUVECTOR_READER_PASSWORD, no
#    attributes, no memberships, default_transaction_read_only=on, CONNECT on the
#    database, USAGE on public, SELECT on memory_entries and nothing else. The
#    <=> operator's function is granted EXECUTE explicitly (PUBLIC already has
#    it; the explicit grant survives a future REVOKE FROM PUBLIC). TEMPORARY on
#    the database and CREATE on public are revoked from PUBLIC: the owner is a
#    superuser, so only non-owner roles — i.e. this one — lose them.
#    read-only-by-default is a guard rail the role can SET away; the privilege
#    set is the boundary, and the verify step proves both layers.
#    pg_hba: a role-scoped `host all <role> all scram-sha-256` line is kept
#    ahead of every host line, so the password is enforced even where broader
#    trust lines exist (see hba-harden). One-time operator op, idempotent;
#    re-run after restoring the sidecar onto a fresh volume (roles are not in
#    a pg_dump of the database).
READER_ROLE="${RUVECTOR_READER_ROLE:-ruvector_reader}"
READER_HBA_TAG="# agentbox:reader-role (ADR-2133)"

valid_ident() { [[ "$1" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; }

reader_role_sql() { # the whole apply script (psql, fed on stdin); no secret inside
    local r="$READER_ROLE" d="$PG_DB"
    cat <<SQL
\\set ON_ERROR_STOP on
\\getenv reader_pw RUVECTOR_READER_PASSWORD
SET log_statement = 'none';
BEGIN;
SELECT format('CREATE ROLE %I LOGIN', '${r}') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${r}') \\gexec
ALTER ROLE ${r} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'reader_pw';
SELECT format('REVOKE %I FROM %I', g.rolname, '${r}') FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = '${r}') \\gexec
ALTER ROLE ${r} SET default_transaction_read_only = on;
REVOKE ALL ON DATABASE ${d} FROM ${r};
GRANT CONNECT ON DATABASE ${d} TO ${r};
REVOKE TEMPORARY ON DATABASE ${d} FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM ${r};
GRANT USAGE ON SCHEMA public TO ${r};
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${r};
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${r};
GRANT SELECT ON TABLE public.memory_entries TO ${r};
SELECT format('GRANT EXECUTE ON FUNCTION %s TO %I', o.oprcode::regprocedure, '${r}') FROM pg_operator o WHERE o.oprname = '<=>' AND o.oprleft = 'ruvector'::regtype AND o.oprright = 'ruvector'::regtype \\gexec
COMMIT;
SQL
}

hba_file() { pg "$CONTAINER" "SHOW hba_file;"; }

hba_backup() { # hba_backup <hba-path> — echoes the backup path
    local b="$1.agentbox-$(date -u +%Y%m%dT%H%M%SZ)"
    docker exec -u postgres "$CONTAINER" cp -p "$1" "$b" >/dev/null && echo "$b"
}

hba_reload_checked() { # hba_reload_checked <hba-path> <backup> — reload; restore on parse error
    pg "$CONTAINER" "SELECT pg_reload_conf();" >/dev/null
    local errs
    errs=$(pg "$CONTAINER" "SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;")
    if [[ "$errs" != "0" ]]; then
        docker exec -u postgres "$CONTAINER" cp -p "$2" "$1"
        pg "$CONTAINER" "SELECT pg_reload_conf();" >/dev/null
        die "pg_hba.conf did not parse after the edit (${errs} error row(s)); restored ${2} and reloaded."
    fi
}

# Keep the role-scoped scram line as the first `host` line (idempotent).
reader_hba_ensure() {
    local hba first want backup
    hba=$(hba_file)
    want="host    all    ${READER_ROLE}    all    scram-sha-256    ${READER_HBA_TAG}"
    first=$(docker exec "$CONTAINER" awk '$1=="host"{print; exit}' "$hba")
    if [[ "$first" == "$want" ]]; then
        ok "pg_hba: ${READER_ROLE} scram line already precedes every host line"
        return 0
    fi
    backup=$(hba_backup "$hba") || die "could not back up ${hba}"
    in_container_awk "$hba" '
        index($0, tag) { next }
        !done && $1 == "host" { print want; done = 1 }
        { print }
        END { if (!done) print want }' -v "want=${want}" -v "tag=${READER_HBA_TAG}" \
        || die "pg_hba edit failed (backup ${backup})"
    hba_reload_checked "$hba" "$backup"
    ok "pg_hba: ${READER_ROLE} scram line inserted ahead of every host line (backup ${backup##*/})"
}

# reader_psql <password-env-value> <sql> — psql as the reader over TCP, so
# pg_hba applies; the password goes by name-only `docker exec -e`.
reader_psql() {
    PGPASSWORD="$1" docker exec -e PGPASSWORD "$CONTAINER" \
        psql -h 127.0.0.1 -U "$READER_ROLE" -d "$PG_DB" -v ON_ERROR_STOP=1 -tAc "$2" 2>&1
}

reader_role_verify() {
    local pw="$RUVECTOR_READER_PASSWORD" out failures=0 other stmt
    _rv_expect_ok() { # <label> <sql> <expected-last-line-or-glob>
        out=$(reader_psql "$pw" "$2") && [[ "$(tail -1 <<<"$out")" == $3 ]] \
            && ok "$1" || { fail "$1 (got: $(tail -1 <<<"$out"))"; failures=$((failures+1)); }
    }
    _rv_expect_denied() { # <label> <sql> — must error with a privilege/read-only refusal
        if out=$(reader_psql "$pw" "$2"); then
            fail "$1 SUCCEEDED (rolled back)"; failures=$((failures+1))
        elif grep -qE 'permission denied|read-only transaction' <<<"$out"; then
            ok "$1 refused ($(grep -oE 'permission denied[^"]*|read-only transaction' <<<"$out" | head -1))"
        else
            fail "$1 failed for another reason: $(tail -1 <<<"$out")"; failures=$((failures+1))
        fi
    }

    out=$(reader_psql "wrong-${RANDOM}${RANDOM}" "SELECT 1;") \
        && { fail "a WRONG password logged in — pg_hba does not enforce the reader's password"; failures=$((failures+1)); } \
        || { grep -q 'password authentication failed' <<<"$out" && ok "wrong password rejected over TCP" \
             || { fail "wrong-password probe failed oddly: $(tail -1 <<<"$out")"; failures=$((failures+1)); }; }
    _rv_expect_ok "login + default_transaction_read_only" "SHOW default_transaction_read_only;" "on"
    _rv_expect_ok "top-k ANN search (HNSW)" \
        "SET enable_seqscan = off; SELECT count(*) FROM (SELECT id FROM memory_entries ORDER BY embedding <=> (SELECT embedding FROM memory_entries WHERE embedding IS NOT NULL LIMIT 1) LIMIT 10) q;" "10"
    _rv_expect_ok "top-k exact search (seq scan)" \
        "SET enable_indexscan = off; SET enable_bitmapscan = off; SELECT count(*) FROM (SELECT id FROM memory_entries ORDER BY embedding <=> (SELECT embedding FROM memory_entries WHERE embedding IS NOT NULL LIMIT 1) LIMIT 10) q;" "10"
    # Each write is tried twice: inside the read-only default, and after the
    # role opts back into READ WRITE (the privilege layer). Always rolled back.
    for stmt in \
        "INSERT INTO memory_entries (id, namespace, key, value) VALUES ('reader-probe', 'reader-probe', 'probe', '{}'::jsonb)" \
        "UPDATE memory_entries SET key = key WHERE id = 'reader-probe'" \
        "DELETE FROM memory_entries WHERE id = 'reader-probe'" \
        "CREATE TABLE public.reader_probe (x int)" \
        "CREATE TEMP TABLE reader_probe (x int)"; do
        _rv_expect_denied "${stmt%% *} (read-only default)" "BEGIN; ${stmt}; ROLLBACK;"
        _rv_expect_denied "${stmt%% *} (READ WRITE opt-in)" "BEGIN READ WRITE; ${stmt}; ROLLBACK;"
    done
    other=$(pg "$CONTAINER" "SELECT quote_ident(tablename) FROM pg_tables WHERE schemaname='public' AND tablename <> 'memory_entries' ORDER BY tablename LIMIT 1;")
    [[ -n "$other" ]] && _rv_expect_denied "SELECT on public.${other}" "SELECT 1 FROM public.${other} LIMIT 1;"
    return "$failures"
}

cmd_reader_role() {
    local apply=0 verify_only=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --yes)     apply=1; shift ;;
            --dry-run) apply=0; shift ;;
            --verify)  verify_only=1; shift ;;
            -h|--help) echo "Usage: $0 reader-role [--dry-run|--yes|--verify]  (flag: reader_role; needs RUVECTOR_READER_PASSWORD)"; return 0 ;;
            *) die "unknown reader-role option: $1" ;;
        esac
    done
    valid_ident "$READER_ROLE" || die "invalid role name: ${READER_ROLE}"
    valid_ident "$PG_DB" || die "invalid database name: ${PG_DB}"
    require_prod_running

    if [[ "$verify_only" -eq 1 ]]; then
        [[ -n "${RUVECTOR_READER_PASSWORD:-}" ]] || die "RUVECTOR_READER_PASSWORD is unset — needed to log in as ${READER_ROLE}."
        info "reader-role --verify — logging in as ${READER_ROLE}"
        reader_role_verify || die "reader-role verification FAILED"
        echo -e "${GREEN}${READER_ROLE} verified: reads work, every write path is refused.${NC}"
        return 0
    fi

    local present priv hba_first
    present=$(pg "$CONTAINER" "SELECT 1 FROM pg_roles WHERE rolname = '${READER_ROLE}';")
    info "reader-role — least-privilege read-only login (ADR-2133)"
    echo "  gate      : [integrations.ruvector_external] reader_role"
    echo "  role      : ${READER_ROLE} ($([[ -n "$present" ]] && echo present || echo absent))"
    if [[ -n "${RUVECTOR_READER_PASSWORD:-}" ]]; then
        echo "  RUVECTOR_READER_PASSWORD : set (never printed)"
    else
        echo "  RUVECTOR_READER_PASSWORD : unset (required for --yes)"
    fi
    if [[ -n "$present" ]]; then
        priv=$(pg "$CONTAINER" "SELECT 'select=' || has_table_privilege('${READER_ROLE}', 'public.memory_entries', 'SELECT') || ' insert=' || has_table_privilege('${READER_ROLE}', 'public.memory_entries', 'INSERT');")
        echo "  current   : ${priv}"
    fi
    hba_first=$(pg "$CONTAINER" "SELECT line_number || ': ' || user_name::text || ' ' || coalesce(address, '') || ' ' || auth_method FROM pg_hba_file_rules WHERE type = 'host' ORDER BY line_number LIMIT 1;" | tail -1)
    echo "  pg_hba    : first host rule ${hba_first:-?}; --yes keeps a ${READER_ROLE} scram line ahead of it"
    echo "  SQL (stdin; the password is read from the environment by psql, never printed):"
    reader_role_sql | sed 's/^/    /'

    if ! ruvector_apply_gate "$apply" "reader_role" "reader-role"; then
        echo -e "${YELLOW}[dry-run] nothing changed. Re-run with --yes (RUVECTOR_READER_PASSWORD set, reader_role=true).${NC}"
        return 0
    fi
    [[ -n "${RUVECTOR_READER_PASSWORD:-}" ]] || die "RUVECTOR_READER_PASSWORD is unset — refusing to create a role without a password."

    info "applying role + grants"
    reader_role_sql | docker exec -i -e RUVECTOR_READER_PASSWORD "$CONTAINER" \
        psql -U "$PG_USER" -d "$PG_DB" -q -f - >/dev/null || die "role SQL failed (transaction rolled back)"
    ok "${READER_ROLE} created/updated"
    reader_hba_ensure
    info "verifying as ${READER_ROLE}"
    reader_role_verify || die "reader-role verification FAILED — inspect the lines above"
    echo -e "${GREEN}reader-role complete: ${READER_ROLE} reads memory_entries and nothing writes.${NC}"
}

# 10. hba-harden — replace non-loopback `trust` host lines with scram-sha-256
#     (ADR-2133). A trust line for a docker subnet lets every client on that
#     network log in as any role, the superuser included, without a password,
#     so no role password is enforced from there. Refuses unless every password
#     a known client sends (the container's POSTGRES_PASSWORD and the governed
#     .mcp.json conninfo) verifies against the owner's stored SCRAM verifier;
#     after the reload it proves the owner still logs in over the network path
#     and a wrong password does not, and restores the backup otherwise.

# scram_verifies <password> <verifier> — RFC 5802/7677 StoredKey check with
# node:crypto's PBKDF2/HMAC/SHA-256 (no hand-rolled primitive). Both values
# travel through the environment, never argv.
scram_verifies() {
    SCRAM_PW="$1" SCRAM_VERIFIER="$2" node -e '
        const c = require("node:crypto");
        const m = /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/.exec(process.env.SCRAM_VERIFIER || "");
        if (!m) process.exit(3);
        const salted = c.pbkdf2Sync(Buffer.from(process.env.SCRAM_PW, "utf8"), Buffer.from(m[2], "base64"), Number(m[1]), 32, "sha256");
        const clientKey = c.createHmac("sha256", salted).update("Client Key").digest();
        const stored = c.createHash("sha256").update(clientKey).digest();
        process.exit(c.timingSafeEqual(stored, Buffer.from(m[3], "base64")) ? 0 : 1);'
}

# Every password a known owner-role client sends, labelled (values never printed).
owner_client_passwords() {
    local pw conn
    pw=$(docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
            | awk -F= '$1=="POSTGRES_PASSWORD"{sub(/^[^=]*=/,""); print; exit}')
    [[ -n "$pw" ]] && printf 'container POSTGRES_PASSWORD\t%s\n' "$pw"
    conn=$(mcp_env_pairs 2>/dev/null | awk -F= '$1=="RUVECTOR_PG_CONNINFO"{sub(/^[^=]*=/,""); print; exit}' || true)
    pw=$(grep -oE 'password=[^ ]+' <<<"$conn" | head -1 | cut -d= -f2- || true)
    [[ -n "$pw" ]] && printf '.mcp.json RUVECTOR_PG_CONNINFO\t%s\n' "$pw"
    return 0
}

owner_passwords_verify() { # 0 iff at least one client password and all verify
    local verifier label pw n=0 bad=0
    verifier=$(pg "$CONTAINER" "SELECT rolpassword FROM pg_authid WHERE rolname = '${PG_USER}';" 2>/dev/null || true)
    if [[ "$verifier" != SCRAM-SHA-256* ]]; then
        warn "owner ${PG_USER} has no SCRAM verifier (${verifier:+non-SCRAM}${verifier:-none}) — cannot prove clients survive scram"
        return 1
    fi
    while IFS=$'\t' read -r label pw; do
        [[ -z "$label" ]] && continue
        n=$((n+1))
        if scram_verifies "$pw" "$verifier"; then ok "${label} verifies against ${PG_USER}'s SCRAM verifier"
        else fail "${label} does NOT verify — that client would be locked out"; bad=$((bad+1)); fi
    done < <(owner_client_passwords)
    [[ "$n" -gt 0 && "$bad" -eq 0 ]]
}

# hba_rewrite_trust <hba-path> — in place: non-loopback trust host lines become
# scram-sha-256; exact duplicate rule lines (whitespace-normalised) are dropped.
HBA_TRUST_AWK='
    /^[[:space:]]*#/ || NF == 0 { print; next }
    {
        rule = $0; sub(/[[:space:]]*#.*$/, "", rule); n = split(rule, f, /[[:space:]]+/)
        if ((f[1] == "host" || f[1] == "hostssl" || f[1] == "hostnossl") && f[n] == "trust" \
            && f[4] != "127.0.0.1/32" && f[4] != "::1/128" && f[4] != "127.0.0.1" && f[4] != "::1") {
            f[n] = "scram-sha-256"; rule = f[1]; for (i = 2; i <= n; i++) rule = rule " " f[i]
            $0 = rule
        }
        key = rule; gsub(/[[:space:]]+/, " ", key); sub(/^ /, "", key)
        if (seen[key]++) next
        print
    }'

# in_container_awk <hba-path> <awk-program> [awk -v args…] — rewrite the file
# in place as postgres (truncate-and-write keeps ownership and mode; an empty
# result is never written).
in_container_awk() {
    local hba="$1" prog="$2"; shift 2
    docker exec -u postgres "$CONTAINER" sh -c '
        hba="$1"; prog="$2"; shift 2
        out=$(awk "$@" "$prog" "$hba") && [ -n "$out" ] && printf "%s\n" "$out" > "$hba"
    ' _ "$hba" "$prog" "$@"
}

# hba_rewrite_trust <hba-path> — in place: non-loopback trust host lines become
# scram-sha-256 (a trailing comment is dropped with the rewrite); exact
# duplicate rules (whitespace-normalised, comments ignored) are dropped.
hba_rewrite_trust() { in_container_awk "$1" "$HBA_TRUST_AWK"; }

cmd_hba_harden() {
    local apply=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --yes)     apply=1; shift ;;
            --dry-run) apply=0; shift ;;
            -h|--help) echo "Usage: $0 hba-harden [--dry-run|--yes]  (flag: hba_scram)"; return 0 ;;
            *) die "unknown hba-harden option: $1" ;;
        esac
    done
    require_prod_running

    local rules hba
    hba=$(hba_file)
    rules=$(pg "$CONTAINER" "$hba_trust_rules_sql")
    info "hba-harden — non-loopback trust → scram-sha-256 (ADR-2133)"
    echo "  gate      : [integrations.ruvector_external] hba_scram"
    echo "  hba_file  : ${hba}"
    if [[ -z "$rules" ]]; then
        echo -e "${GREEN}  no non-loopback trust lines — nothing to do.${NC}"
        return 0
    fi
    echo "  trust lines that admit any role without a password (line|type|db|user|address|method):"
    sed 's/^/    /' <<<"$rules"
    echo "  plan      : rewrite each to scram-sha-256, drop exact duplicate lines, reload;"
    echo "              prove the owner logs in over the network with its password and a"
    echo "              wrong one is refused; restore the backup on any failure."
    echo "  clients   : every owner-role client must send the right password afterwards"
    echo "              (VisionClaw on visionclaw_network included — not checkable from here)."
    local verified=0
    owner_passwords_verify && verified=1 || true

    if ! ruvector_apply_gate "$apply" "hba_scram" "hba-harden"; then
        echo -e "${YELLOW}[dry-run] nothing changed. Re-run with --yes (and hba_scram=true) to apply.${NC}"
        return 0
    fi
    [[ "$verified" -eq 1 ]] || die "a known client password does not verify against ${PG_USER}'s SCRAM verifier; refusing to remove trust."

    local backup ip owner_pw out
    backup=$(hba_backup "$hba") || die "could not back up ${hba}"
    hba_rewrite_trust "$hba" || die "pg_hba edit failed (backup ${backup})"
    hba_reload_checked "$hba" "$backup"
    ok "rewritten + reloaded (backup ${backup##*/})"

    # Network-path proof: connect to the container's own non-loopback address.
    ip=$(docker inspect "$CONTAINER" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' | awk '{print $1}')
    owner_pw=$(owner_client_passwords | head -1 | cut -f2)
    local restore=0
    if ! PGPASSWORD="$owner_pw" docker exec -e PGPASSWORD "$CONTAINER" psql -h "$ip" -U "$PG_USER" -d "$PG_DB" -tAc "SELECT 1;" >/dev/null 2>&1; then
        fail "owner login over ${ip} with its password failed"; restore=1
    elif out=$(PGPASSWORD="wrong-${RANDOM}${RANDOM}" docker exec -e PGPASSWORD "$CONTAINER" psql -h "$ip" -U "$PG_USER" -d "$PG_DB" -tAc "SELECT 1;" 2>&1); then
        fail "a wrong password still logs in over ${ip} — a trust path remains"; restore=1
    else
        ok "owner logs in over ${ip} with its password; a wrong password is refused"
    fi
    if [[ "$restore" -eq 1 ]]; then
        docker exec -u postgres "$CONTAINER" cp -p "$backup" "$hba"
        pg "$CONTAINER" "SELECT pg_reload_conf();" >/dev/null
        die "hba-harden verification failed; restored ${backup##*/} and reloaded."
    fi
    echo -e "${GREEN}hba-harden complete: no non-loopback trust lines remain.${NC}"
}

# ── dispatch ─────────────────────────────────────────────────────────────────

case "${1:-status}" in
    status)   shift || true; cmd_status "$@" ;;
    check)    shift || true; cmd_check "$@" ;;
    test)     shift || true; cmd_test "$@" ;;
    update)   shift || true; cmd_update "$@" ;;
    rollback) shift || true; cmd_rollback "$@" ;;
    migrate-trajectories) shift || true; cmd_migrate_trajectories "$@" ;;
    repair-namespaces)    shift || true; cmd_repair_namespaces "$@" ;;
    backfill-embeddings)  shift || true; cmd_backfill_embeddings "$@" ;;
    archive-legacy)       shift || true; cmd_archive_legacy "$@" ;;
    aggregate-effectiveness) shift || true; cmd_aggregate_effectiveness "$@" ;;
    build-metadata-gin)   shift || true; cmd_build_metadata_gin "$@" ;;
    recall)   shift || true; cmd_recall "$@" ;;
    reindex)  shift || true; cmd_reindex "$@" ;;
    reader-role) shift || true; cmd_reader_role "$@" ;;
    hba-harden)  shift || true; cmd_hba_harden "$@" ;;
    -h|--help|help)
        sed -n '2,100p' "$0" | sed 's/^# \{0,1\}//'
        ;;
    *) die "unknown subcommand: $1 (status|check|test|update|rollback|migrate-trajectories|repair-namespaces|backfill-embeddings|archive-legacy|aggregate-effectiveness|build-metadata-gin|recall|reindex|reader-role|hba-harden)" ;;
esac
