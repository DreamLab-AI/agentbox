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
# The image pin lives in agentbox.toml [integrations.ruvector_external].image
# (source of truth — flake.nix composeText reads it) and is mirrored in the
# checked-in docker-compose.yml. Both are updated together here.
#
# Requires: docker, jq, curl. All SQL runs via `docker exec` (no local psql).
# Upstream publishes linux/amd64 only — see `check` output.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

TOML="${REPO_DIR}/agentbox.toml"
COMPOSE_FILE="${REPO_DIR}/docker-compose.yml"
OVERRIDE_FILE="${REPO_DIR}/docker-compose.override.yml"

SERVICE="ruvector-postgres"
CONTAINER="ruvector-postgres"
CANDIDATE="ruvector-postgres-candidate"
HUB_REPO="ruvnet/ruvector-postgres"
PG_USER="ruvector"
PG_DB="ruvector"

STATE_DIR="${REPO_DIR}/backups/ruvector-sidecar"
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
}

# ── dispatch ─────────────────────────────────────────────────────────────────

case "${1:-status}" in
    status)   shift || true; cmd_status "$@" ;;
    check)    shift || true; cmd_check "$@" ;;
    test)     shift || true; cmd_test "$@" ;;
    update)   shift || true; cmd_update "$@" ;;
    rollback) shift || true; cmd_rollback "$@" ;;
    -h|--help|help)
        sed -n '2,35p' "$0" | sed 's/^# \{0,1\}//'
        ;;
    *) die "unknown subcommand: $1 (status|check|test|update|rollback)" ;;
esac
