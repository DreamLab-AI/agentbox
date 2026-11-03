#!/usr/bin/env bash
# Pre-swap screen helpers in scripts/ruvector-sidecar-update.sh (ADR-2133 amendment).
# Pure tests: the SQL shape and the keep/swap decision. The live mechanism
# (transactional DROP INDEX + ROLLBACK on the ruvector hnsw AM) was proven on a
# scratch table on 2026-10-31; see the ADR-2133 amendment.
set -u
here="$(cd "$(dirname "$0")/../.." && pwd)"
src="$here/scripts/ruvector-sidecar-update.sh"
pass=0; fail=0
check() { if [[ "$2" == "$3" ]]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $1"; echo "  want: $3"; echo "  got:  $2"; fi; }
contains() { if [[ "$2" == *"$3"* ]]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $1 (missing: $3)"; fi; }

eval "$(sed -n '/^SCREEN_TIMEOUT_S=/p;/^hnsw_screen_sql()/,/^}/p;/^screen_verdict()/,/^}/p' "$src")"

sql=$(hnsw_screen_sql idx_old "a,b")
contains "screen opens a transaction" "$sql" "BEGIN;"
contains "screen rolls back, never commits" "$sql" "ROLLBACK;"
[[ "$sql" == *COMMIT* ]] && { fail=$((fail+1)); echo "FAIL: screen must not COMMIT"; } || pass=$((pass+1))
contains "screen drops only the named index" "$sql" "DROP INDEX idx_old;"
contains "screen bounds the lock wait" "$sql" "lock_timeout = '60s'"
contains "screen bounds the lock hold" "$sql" "statement_timeout = '30s'"
contains "screen forces the index path" "$sql" "enable_seqscan = off"
contains "screen scores top-10 self-recall" "$sql" "LIMIT 10"
contains "screen scopes to the fixture ids" "$sql" "'{a,b}'::text[]"
[[ "$sql" == *CONCURRENTLY* ]] && { fail=$((fail+1)); echo "FAIL: never CONCURRENTLY"; } || pass=$((pass+1))

check "equal scores keep the new build" "$(screen_verdict 183 183)" keep-new
check "better new build is kept" "$(screen_verdict 190 168)" keep-new
check "worse new build is rejected" "$(screen_verdict 168 183)" keep-old

SCREEN_TIMEOUT_S=12
contains "timeout is overridable" "$(hnsw_screen_sql x y)" "statement_timeout = '12s'"

echo "reindex screen: ${pass} passed, ${fail} failed"
[[ $fail -eq 0 ]]
