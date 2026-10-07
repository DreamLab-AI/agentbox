#!/usr/bin/env bash
# ruvector-sidecar-ops — the reindex, reader-role and hba-harden subcommands of
# scripts/ruvector-sidecar-update.sh (ADR-2133), driven against a stub `docker`
# on PATH and a stub recall harness. No sidecar, no network, no Nix.
#
#   reindex     dry-run changes nothing; the build is serial and non-concurrent,
#               builds beside the live index and swaps in one transaction;
#               refuses a foreign opclass, a missing baseline, a failed build and
#               a duplicate-id probe; records before/after recall under
#               state.json .reindex without touching the update flow's keys;
#               fails loudly below the enforced floor.
#   reader-role dry-run never needs or prints the password; --yes refuses with
#               the password unset or the manifest flag off; the password never
#               reaches docker argv or stdout; the SQL grants SELECT on
#               memory_entries only.
#   hba-harden  dry-run lists the trust lines; --yes refuses with the flag off;
#               the owner-password SCRAM check accepts and rejects on the
#               RFC 7677 §3 SCRAM-SHA-256 test vector, and a non-verifying
#               password refuses before pg_hba is touched.
#   status      warns loudly on any non-loopback trust rule (so a hand edit or
#               a rollback to an older snapshot cannot bring it back silently),
#               and stays quiet and exit-0 when there is none.
# shellcheck disable=SC2015
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SCRIPT="$ROOT/scripts/ruvector-sidecar-update.sh"
PASS=0; FAIL=0
_ok()  { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$((PASS + FAIL))" "$1"; }
_bad() { FAIL=$((FAIL + 1)); printf 'not ok %d - %s\n' "$((PASS + FAIL))" "$1"; [ -n "${2:-}" ] && printf '#   %s\n' "$2"; }
_done() { printf '1..%d\n# ruvector-sidecar-ops: %d passed, %d failed\n' "$((PASS + FAIL))" "$PASS" "$FAIL"; [ "$FAIL" -eq 0 ]; exit $?; }
_has()   { grep -qF -- "$2" "$1" 2>/dev/null; }

T="$(mktemp -d "${TMPDIR:-/tmp}/rv-sidecar-ops.XXXXXX")"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"

INDEXDEF_OK="CREATE INDEX idx_memory_embedding_hnsw ON public.memory_entries USING hnsw (embedding ruvector_cosine_ops) WITH (m='16', ef_construction='128')"

# ── stub docker: logs every call (argv + stdin) and answers by SQL pattern ──
cat > "$T/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf 'ARGV:' >> "$STUB_LOG"; printf ' %q' "$@" >> "$STUB_LOG"; printf '\n' >> "$STUB_LOG"
case "${1:-}" in
  inspect) case "$*" in *Config.Env*) echo "POSTGRES_PASSWORD=${STUB_OWNER_PW:-}" ;; *) echo true ;; esac; exit 0 ;;
  exec) ;;
  *) exit 0 ;;
esac
stdin=""
for a in "$@"; do [ "$a" = "-i" ] && stdin=$(cat); done
[ -n "$stdin" ] && printf 'STDIN:%s\n' "$stdin" >> "$STUB_LOG"
sql="${*: -1}"
[ -n "$stdin" ] && sql="$stdin"
case "$sql" in
  *"indexname='idx_memory_embedding_hnsw'"*) echo "${STUB_INDEXDEF}" ;;
  *"' rows, '"*)                    echo "100 rows, 100 embedded" ;;
  *pg_size_pretty*)                 echo "10 MB" ;;
  *"CASE WHEN indisvalid"*)         echo "${STUB_LEFTOVER:-}" ;;
  *"SELECT indisvalid"*)            echo t ;;
  *"SHOW max_parallel"*)            echo 0 ;;
  *"CREATE INDEX"*)                 [ -n "${STUB_BUILD_FAIL:-}" ] && { echo "ERROR: build" >&2; exit 1; }; echo SET; echo "CREATE INDEX" ;;
  *"RENAME TO"*)                    echo COMMIT ;;
  *EXPLAIN*)                        echo "  ->  Index Scan using idx_memory_embedding_hnsw on memory_entries" ;;
  *"count(DISTINCT id)"*)           echo SET; echo "${STUB_PROBE:-20:20}" ;;
  *"FROM pg_roles WHERE rolname"*)  echo "${STUB_ROLE_PRESENT:-}" ;;
  *"SHOW hba_file"*)                echo "/var/lib/postgresql/data/pg_hba.conf" ;;
  *"pg_hba_file_rules"*)            r="${STUB_HBA_RULES-__default__}"
                                    [ "$r" = __default__ ] && r='128|host|{all}|{all}|172.18.0.0|trust'
                                    [ -n "$r" ] && printf '%s\n' "$r" ;;
  *"FROM pg_authid"*)               echo "${STUB_VERIFIER:-}" ;;
  *"has_table_privilege"*)          echo "${STUB_PRIV:-}" ;;
  *) : ;;
esac
exit 0
STUB
chmod +x "$T/bin/docker"

# ── stub recall harness: STUB_RECALL_SEQ="self:true:VERDICT,…", one per call;
#    ERR = exit 1 with no JSON (harness error). Calls counted in $T/recall.n ──
cat > "$T/harness.mjs" <<'STUB'
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const nf = process.env.STUB_RECALL_COUNTER;
const n = existsSync(nf) ? Number(readFileSync(nf, 'utf8')) : 0;
writeFileSync(nf, String(n + 1));
const step = (process.env.STUB_RECALL_SEQ || '').split(',')[n] || 'ERR';
if (step === 'ERR') { process.stderr.write('stub harness error\n'); process.exit(1); }
const [s, t, v] = step.split(':');
process.stdout.write(JSON.stringify({ medians: { self_recall: Number(s), true_recall: Number(t), exact_token_delta: 1 },
  verdict: { pass: v === 'PASS', reasons: [] }, artifact: `/tmp/run-${n}.json` }) + '\n');
process.exit(v === 'PASS' ? 0 : 2);
STUB

# toml fixtures: the reader_role / hba_scram flags on and off
mk_toml() { # mk_toml <path> <reader_role> <hba_scram>
  printf '[integrations.ruvector_external]\nenabled = true\nreader_role = %s\nhba_scram = %s\n\n[memory_hygiene]\n' "$2" "$3" > "$1"
}
mk_toml "$T/on.toml" true true
mk_toml "$T/off.toml" false false

# run <case> <args…> — fresh log/state per case; output to $T/<case>.out, rc to $T/<case>.rc
run() {
  local c="$1"; shift
  rm -f "$T/recall.n"; : > "$T/$c.log"; mkdir -p "$T/state-$c"
  printf '{"phase":"done","previous_ref":"img:1"}\n' > "$T/state-$c/state.json"
  env PATH="$T/bin:$PATH" STUB_LOG="$T/$c.log" STUB_RECALL_COUNTER="$T/recall.n" \
      RUVECTOR_RECALL_HARNESS="$T/harness.mjs" RUVECTOR_SIDECAR_STATE_DIR="$T/state-$c" \
      RUVECTOR_SIDECAR_TOML="${TOMLF:-$T/on.toml}" STUB_INDEXDEF="${STUB_INDEXDEF:-$INDEXDEF_OK}" \
      WORKSPACE="$T" HOME="$T" bash "$SCRIPT" "$@" > "$T/$c.out" 2>&1
  echo $? > "$T/$c.rc"
}
rc() { cat "$T/$1.rc"; }
recall_calls() { [ -f "$T/recall.n" ] && cat "$T/recall.n" || echo 0; }
state() { jq -r "$2" "$T/state-$1/state.json"; }

# ═════ reindex ═════
run r-dry reindex --dry-run
[ "$(rc r-dry)" = 0 ] && _ok "reindex --dry-run exits 0" || _bad "reindex --dry-run exits 0" "$(cat "$T/r-dry.out")"
_has "$T/r-dry.out" "SET max_parallel_maintenance_workers = 0; CREATE INDEX idx_memory_embedding_hnsw_rebuild ON memory_entries USING hnsw (embedding ruvector_cosine_ops) WITH (m='16', ef_construction='128');" \
  && _ok "dry-run plan: serial build of the index-law definition under the temporary name" || _bad "dry-run plan shows the serial build"
_has "$T/r-dry.out" "DROP INDEX idx_memory_embedding_hnsw; ALTER INDEX idx_memory_embedding_hnsw_rebuild RENAME TO idx_memory_embedding_hnsw; COMMIT;" \
  && _ok "dry-run plan: one-transaction swap" || _bad "dry-run plan shows the swap"
! grep -qE "ARGV:.*(CREATE\\\\ INDEX|DROP\\\\ INDEX|RENAME)" "$T/r-dry.log" && [ "$(recall_calls)" = 0 ] \
  && _ok "dry-run executes no DDL and no harness run" || _bad "dry-run executed DDL or the harness" "$(grep -E 'CREATE|DROP|RENAME' "$T/r-dry.log" | head -3)"

STUB_RECALL_SEQ="170:100:FAIL,189:115:PASS" run r-ok reindex --yes
[ "$(rc r-ok)" = 0 ] && _ok "reindex --yes happy path exits 0" || _bad "reindex --yes happy path exits 0" "$(tail -5 "$T/r-ok.out")"
[ "$(recall_calls)" = 2 ] && _ok "recall harness runs before and after" || _bad "recall harness runs twice" "calls=$(recall_calls)"
! grep -q CONCURRENTLY "$T/r-ok.log" && _ok "no CONCURRENTLY in any executed SQL" || _bad "CONCURRENTLY executed"
grep -E 'ARGV:.*CREATE\\ INDEX' "$T/r-ok.log" | grep -q 'SET\\ max_parallel_maintenance_workers\\ =\\ 0\\;' \
  && _ok "the CREATE INDEX runs in the same session as SET max_parallel_maintenance_workers = 0" || _bad "serial SET travels with the build"
build_ln=$(grep -n 'CREATE\\ INDEX' "$T/r-ok.log" | head -1 | cut -d: -f1)
swap_ln=$(grep -n 'RENAME\\ TO' "$T/r-ok.log" | head -1 | cut -d: -f1)
[ -n "$build_ln" ] && [ -n "$swap_ln" ] && [ "$build_ln" -lt "$swap_ln" ] \
  && _ok "build precedes the swap" || _bad "build precedes the swap" "build=$build_ln swap=$swap_ln"
[ "$(state r-ok .reindex.pre_self)/$(state r-ok .reindex.pre_true)/$(state r-ok .reindex.pre_verdict)" = "170/100/FAIL" ] \
  && _ok "state.json records the before recall" || _bad "before recall recorded" "$(cat "$T/state-r-ok/state.json")"
[ "$(state r-ok .reindex.post_self)/$(state r-ok .reindex.post_true)/$(state r-ok .reindex.post_verdict)" = "189/115/PASS" ] \
  && _ok "state.json records the after recall" || _bad "after recall recorded"
[ "$(state r-ok .reindex.phase)" = done ] && [ -n "$(state r-ok .reindex.build_seconds)" ] \
  && _ok "state.json: reindex.phase=done with build_seconds" || _bad "reindex.phase=done"
[ "$(state r-ok .phase)/$(state r-ok .previous_ref)" = "done/img:1" ] \
  && _ok "update/rollback keys in state.json are untouched" || _bad "update keys untouched" "$(cat "$T/state-r-ok/state.json")"

STUB_RECALL_SEQ="170:100:FAIL,172:110:FAIL" run r-floor reindex --yes
[ "$(rc r-floor)" != 0 ] && _has "$T/r-floor.out" "RECALL BELOW THE ENFORCED FLOOR" \
  && _ok "post-rebuild recall below the floor fails loudly" || _bad "below-floor failure" "$(tail -4 "$T/r-floor.out")"
[ "$(state r-floor .reindex.phase)" = post-recall-fail ] && _ok "state.json: post-recall-fail" || _bad "post-recall-fail recorded"

STUB_RECALL_SEQ="ERR" run r-noharness reindex --yes
[ "$(rc r-noharness)" != 0 ] && ! grep -q 'CREATE\\ INDEX' "$T/r-noharness.log" \
  && _ok "harness error before the rebuild refuses with no DDL" || _bad "no baseline refuses"

STUB_INDEXDEF="CREATE INDEX idx_memory_embedding_hnsw ON public.memory_entries USING hnsw (embedding ruvector_l2_ops) WITH (m='16', ef_construction='128')" \
  STUB_RECALL_SEQ="170:100:FAIL,189:115:PASS" run r-opclass reindex --yes
[ "$(rc r-opclass)" != 0 ] && [ "$(recall_calls)" = 0 ] && ! grep -q 'CREATE\\ INDEX' "$T/r-opclass.log" \
  && _ok "foreign operator class is refused before any work" || _bad "opclass refusal" "$(tail -3 "$T/r-opclass.out")"

STUB_BUILD_FAIL=1 STUB_RECALL_SEQ="170:100:FAIL,189:115:PASS" run r-buildfail reindex --yes
[ "$(rc r-buildfail)" != 0 ] && ! grep -q 'RENAME' "$T/r-buildfail.log" && grep -q 'DROP\\ INDEX\\ IF\\ EXISTS\\ public.idx_memory_embedding_hnsw_rebuild' "$T/r-buildfail.log" \
  && [ "$(state r-buildfail .reindex.phase)" = build-failed ] \
  && _ok "failed build drops the partial index and never swaps" || _bad "build failure handling"

STUB_PROBE="20:19" STUB_RECALL_SEQ="170:100:FAIL,189:115:PASS" run r-dup reindex --yes
[ "$(rc r-dup)" != 0 ] && _has "$T/r-dup.out" "double insertion" \
  && _ok "duplicate ids in the post-swap probe fail" || _bad "duplicate-id probe" "$(tail -3 "$T/r-dup.out")"

STUB_LEFTOVER="INVALID" STUB_RECALL_SEQ="170:100:FAIL,189:115:PASS" run r-left reindex --yes
l_drop=$(grep -n 'DROP\\ INDEX\\ IF\\ EXISTS\\ public.idx_memory_embedding_hnsw_rebuild' "$T/r-left.log" | head -1 | cut -d: -f1)
l_build=$(grep -n 'CREATE\\ INDEX' "$T/r-left.log" | head -1 | cut -d: -f1)
[ "$(rc r-left)" = 0 ] && [ -n "$l_drop" ] && [ "$l_drop" -lt "$l_build" ] \
  && _ok "a leftover rebuild index is dropped before the build" || _bad "leftover handling"

# ═════ reader-role ═════
PW="s3cret-$RANDOM-$RANDOM"
RUVECTOR_READER_PASSWORD="" run rr-dry reader-role --dry-run
[ "$(rc rr-dry)" = 0 ] && _has "$T/rr-dry.out" "RUVECTOR_READER_PASSWORD : unset" \
  && _ok "reader-role --dry-run runs without the password and reports it unset" || _bad "reader-role dry-run" "$(cat "$T/rr-dry.out")"
! grep -qE 'STDIN:' "$T/rr-dry.log" && _ok "dry-run sends no role SQL" || _bad "dry-run sent SQL"
_has "$T/rr-dry.out" "GRANT SELECT ON TABLE public.memory_entries TO ruvector_reader;" \
  && _ok "plan grants SELECT on memory_entries" || _bad "plan grants SELECT"

RUVECTOR_READER_PASSWORD="$PW" run rr-drypw reader-role --dry-run
_has "$T/rr-drypw.out" "RUVECTOR_READER_PASSWORD : set" && ! _has "$T/rr-drypw.out" "$PW" \
  && _ok "dry-run reports the password set without printing it" || _bad "dry-run password report"

RUVECTOR_READER_PASSWORD="" run rr-nopw reader-role --yes
[ "$(rc rr-nopw)" != 0 ] && _has "$T/rr-nopw.out" "RUVECTOR_READER_PASSWORD is unset" && ! grep -q 'STDIN:' "$T/rr-nopw.log" \
  && _ok "--yes refuses with the password unset" || _bad "--yes without password" "$(tail -3 "$T/rr-nopw.out")"

TOMLF="$T/off.toml" RUVECTOR_READER_PASSWORD="$PW" run rr-flag reader-role --yes
[ "$(rc rr-flag)" != 0 ] && _has "$T/rr-flag.out" "reader_role" && ! grep -q 'STDIN:' "$T/rr-flag.log" \
  && _ok "--yes refuses with [integrations.ruvector_external] reader_role off" || _bad "flag gate" "$(tail -3 "$T/rr-flag.out")"

RUVECTOR_READER_PASSWORD="$PW" run rr-apply reader-role --yes
grep -q 'STDIN:' "$T/rr-apply.log" && _ok "--yes sends the role SQL on stdin" || _bad "--yes sent role SQL" "$(tail -5 "$T/rr-apply.out")"
! grep -qF "$PW" "$T/rr-apply.log" && ! grep -qF "$PW" "$T/rr-apply.out" \
  && _ok "the password never reaches docker argv, stdin or stdout" || _bad "password leaked" "$(grep -nF "$PW" "$T/rr-apply.log" "$T/rr-apply.out" | head -2)"
grep -q 'ARGV:.*-e RUVECTOR_READER_PASSWORD' "$T/rr-apply.log" \
  && _ok "the password travels by name-only docker -e" || _bad "docker -e by name"
grep 'STDIN:' -A200 "$T/rr-apply.log" | grep -E '^GRANT SELECT' | grep -vq 'public.memory_entries' \
  && _bad "SELECT granted beyond memory_entries" || _ok "SELECT granted on memory_entries only"
grep -q "ALTER ROLE ruvector_reader SET default_transaction_read_only = on;" "$T/rr-apply.log" \
  && _ok "default_transaction_read_only=on" || _bad "read-only default"

# ═════ hba-harden ═════
run h-dry hba-harden --dry-run
[ "$(rc h-dry)" = 0 ] && _has "$T/h-dry.out" "172.18.0.0" \
  && _ok "hba-harden --dry-run lists the non-loopback trust lines" || _bad "hba-harden dry-run" "$(cat "$T/h-dry.out")"
TOMLF="$T/off.toml" run h-flag hba-harden --yes
[ "$(rc h-flag)" != 0 ] && _has "$T/h-flag.out" "hba_scram" \
  && _ok "hba-harden --yes refuses with hba_scram off" || _bad "hba-harden flag gate" "$(tail -3 "$T/h-flag.out")"

# RFC 7677 §3 test vector (user "user", password "pencil"), in pg_authid form.
RFC7677="SCRAM-SHA-256\$4096:W22ZaJ0SNY7soEsUEjb6gQ==\$WG5d8oPm3OtcPnkdi4Uo7BkeZkBFzpcXkuLmtbsT4qY=:wfPLwcE6nTWhTAmQ7tl2KeoiWGPlZqQxSrmfPwDl2dU="
STUB_VERIFIER="$RFC7677" STUB_OWNER_PW="pencil" run h-vec-ok hba-harden --dry-run
_has "$T/h-vec-ok.out" "container POSTGRES_PASSWORD verifies" && ! _has "$T/h-vec-ok.out" "pencil" \
  && _ok "SCRAM check accepts the RFC 7677 vector password (value not printed)" || _bad "RFC 7677 accept" "$(tail -4 "$T/h-vec-ok.out")"
STUB_VERIFIER="$RFC7677" STUB_OWNER_PW="pencils" run h-vec-bad hba-harden --yes
_has "$T/h-vec-bad.out" "does NOT verify" && [ "$(rc h-vec-bad)" != 0 ] && _has "$T/h-vec-bad.out" "refusing to remove trust" \
  && ! grep -q 'ARGV: exec -u postgres' "$T/h-vec-bad.log" \
  && _ok "a wrong client password is rejected and pg_hba is never touched" || _bad "RFC 7677 reject" "$(tail -4 "$T/h-vec-bad.out")"
STUB_VERIFIER="md5abc" STUB_OWNER_PW="pencil" run h-md5 hba-harden --yes
[ "$(rc h-md5)" != 0 ] && _has "$T/h-md5.out" "no SCRAM verifier" \
  && _ok "a non-SCRAM owner verifier refuses" || _bad "non-SCRAM refusal" "$(tail -3 "$T/h-md5.out")"

# ═════ status / check: the trust audit ═════
run s-trust status
[ "$(rc s-trust)" = 0 ] && _has "$T/s-trust.out" "pg_hba TRUST on a non-loopback address" && _has "$T/s-trust.out" "line 128: host|{all}|{all}|172.18.0.0|trust" \
  && _ok "status warns loudly and names each non-loopback trust rule (exit 0)" || _bad "status trust banner" "$(tail -6 "$T/s-trust.out")"
STUB_HBA_RULES="" run s-clean status
[ "$(rc s-clean)" = 0 ] && _has "$T/s-clean.out" "no trust rule outside loopback" && ! _has "$T/s-clean.out" "!!" \
  && _ok "status is quiet when only loopback trusts remain" || _bad "status clean" "$(tail -3 "$T/s-clean.out")"
grep -q "hba_trust_audit" <(sed -n '/^cmd_check() {/,/^}/p' "$SCRIPT") || grep -q "^    cmd_status$" <(sed -n '/^cmd_check() {/,/^}/p' "$SCRIPT") \
  && _ok "check runs the trust audit (via status)" || _bad "check runs the audit"

_done
