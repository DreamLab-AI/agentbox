#!/usr/bin/env bash
# ADR-2207 D4: browsercontainer/record.sh records the one display into the exchange.
#
# record.sh runs against a stub ffmpeg (node, so it can trap SIGINT the way ffmpeg
# does when started in the background) that records its argv and writes the output
# file only when it is interrupted, i.e. "finalised".
#
# Cases:
#   1. start: x11grab of :2 at the display helper's size, 30 fps, libx264 ultrafast
#      crf 20 yuv420p, -t RECORD_MAX_SECONDS (default 3600), Matroska output at
#      <exchange>/recordings/<name>-<UTC timestamp>.mkv; JSON status on stdout
#   2. custom display size and max duration reach ffmpeg
#   3. name sanitised to [A-Za-z0-9._-] (no path separators, no traversal)
#   4. a second start while recording is refused (exit 3) and starts no ffmpeg
#   5. stop sends SIGINT, waits until ffmpeg has exited, the file is finalised;
#      stop with nothing recording exits 4
#   6. a recording that ended on its own (-t expiry) leaves a stale pidfile that
#      does not block the next start
#   7. encoder overridable by env; invalid display or max duration refused before ffmpeg
#   8. recordings/ is created lazily; nothing else in the exchange is touched
# Run: bash tests/browsercontainer/record.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
REC="$REPO/browsercontainer/record.sh"

PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); echo "PASS: $*"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $*"; }

WORK="$(mktemp -d)"
cleanup() {
  for f in "$WORK"/state*/record.pid; do [ -f "$f" ] && kill -9 "$(cat "$f")" 2>/dev/null; done
  rm -rf "$WORK"
}
trap cleanup EXIT

cat >"$WORK/ffmpeg-stub" <<'EOF'
#!/usr/bin/env node
// Records argv; writes the output (last arg) only on SIGINT, like ffmpeg finalising.
const fs = require('fs');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.STUB_ARGS, args.join('\n') + '\n');
const out = args[args.length - 1];
const life = Number(process.env.STUB_LIFETIME_MS || 60000);
process.on('SIGINT', () => { setTimeout(() => { fs.writeFileSync(out, 'MKV'); process.exit(0); }, 300); });
setTimeout(() => process.exit(0), life);
EOF
chmod +x "$WORK/ffmpeg-stub"

# rec <label> <args...>   (env: per-label exchange and state dirs)
rec() {
  local label="$1"; shift
  mkdir -p "$WORK/ex-$label"
  FFMPEG_BIN="$WORK/ffmpeg-stub" STUB_ARGS="$WORK/args-$label" \
    BROWSER_EXCHANGE_DIR="$WORK/ex-$label" RECORD_STATE_DIR="$WORK/state-$label" \
    bash "$REC" "$@"
}
argline() { tr '\n' ' ' <"$WORK/args-$1" 2>/dev/null; }
waitfor() { for _ in $(seq 1 50); do [ -s "$1" ] && return 0; sleep 0.1; done; return 1; }

[ -f "$REC" ] || { bad "0 record.sh missing"; echo "record: $PASS passed, $FAIL failed"; exit 1; }

# 1
mkdir -p "$WORK/ex-a"; echo keep >"$WORK/ex-a/keep.txt"
out="$(env -u BROWSER_DISPLAY_SIZE -u RECORD_MAX_SECONDS -u RECORD_ENCODER_ARGS \
  FFMPEG_BIN="$WORK/ffmpeg-stub" STUB_ARGS="$WORK/args-a" BROWSER_EXCHANGE_DIR="$WORK/ex-a" \
  RECORD_STATE_DIR="$WORK/state-a" bash "$REC" start demo)"; rc=$?
waitfor "$WORK/args-a"
a="$(argline a)"
path="$(printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).path||"")}catch{}})')"
if [ "$rc" -eq 0 ] \
   && printf '%s' "$a" | grep -q -- "-f x11grab -video_size 1920x1080 -framerate 30 -i :2" \
   && printf '%s' "$a" | grep -q -- "-t 3600 " \
   && printf '%s' "$a" | grep -q -- "-c:v libx264 -preset ultrafast -crf 20 -pix_fmt yuv420p " \
   && printf '%s' "$a" | grep -q -- "-nostdin" \
   && [[ "$path" =~ ^$WORK/ex-a/recordings/demo-[0-9]{8}T[0-9]{6}Z\.mkv$ ]] \
   && [ "$(tail -n1 "$WORK/args-a")" = "$path" ]; then
  ok "1 start: x11grab :2 1920x1080 30fps libx264, -t 3600, mkv under exchange/recordings"
else
  bad "1 start rc=$rc out=$out args=$a"
fi

# 4 (while a is recording)
rm -f "$WORK/args-a2"
FFMPEG_BIN="$WORK/ffmpeg-stub" STUB_ARGS="$WORK/args-a2" BROWSER_EXCHANGE_DIR="$WORK/ex-a" \
  RECORD_STATE_DIR="$WORK/state-a" bash "$REC" start again >"$WORK/out-a2" 2>&1; rc=$?
sleep 0.3
if [ "$rc" -eq 3 ] && [ ! -e "$WORK/args-a2" ] && grep -q '"error"' "$WORK/out-a2"; then
  ok "4 second start while recording refused (exit 3), no second ffmpeg"
else
  bad "4 double start rc=$rc $(cat "$WORK/out-a2")"
fi

st="$(rec a status)"
if printf '%s' "$st" | grep -q '"recording":true'; then :; else bad "status while recording: $st"; fi

# 5
out="$(rec a stop)"; rc=$?
pid_alive=0; [ -f "$WORK/state-a/record.pid" ] && kill -0 "$(cat "$WORK/state-a/record.pid")" 2>/dev/null && pid_alive=1
if [ "$rc" -eq 0 ] && [ "$(cat "$path" 2>/dev/null)" = "MKV" ] && [ "$pid_alive" -eq 0 ] \
   && printf '%s' "$out" | grep -q '"recording":false' && printf '%s' "$out" | grep -qF "$path"; then
  rec a stop >/dev/null 2>&1; rc2=$?
  if [ "$rc2" -eq 4 ]; then
    ok "5 stop: SIGINT, waits, file finalised; stop when idle exits 4"
  else
    bad "5 idle stop rc=$rc2"
  fi
else
  bad "5 stop rc=$rc out=$out file=$(cat "$path" 2>/dev/null)"
fi

# 8
if [ -d "$WORK/ex-a/recordings" ] && [ "$(cat "$WORK/ex-a/keep.txt")" = keep ] \
   && [ "$(find "$WORK/ex-a" -mindepth 1 -maxdepth 1 | wc -l)" -eq 2 ]; then
  ok "8 recordings/ created lazily, the rest of the exchange untouched"
else
  bad "8 exchange contents: $(ls -A "$WORK/ex-a")"
fi

# 2
BROWSER_DISPLAY_SIZE=2560x1440 RECORD_MAX_SECONDS=90 rec b start >/dev/null; rc=$?
waitfor "$WORK/args-b"; b="$(argline b)"
if [ "$rc" -eq 0 ] && printf '%s' "$b" | grep -q -- "-video_size 2560x1440 " && printf '%s' "$b" | grep -q -- "-t 90 " \
   && printf '%s' "$b" | grep -Eq "/recordings/recording-[0-9]{8}T[0-9]{6}Z\.mkv"; then
  ok "2 display size and max duration from env; default name 'recording'"
else
  bad "2 custom size rc=$rc args=$b"
fi
rec b stop >/dev/null

# 3
out="$(rec c start '../../etc/pass wd;$(id)')"; rc=$?
waitfor "$WORK/args-c"; c_out="$(tail -n1 "$WORK/args-c")"
base="$(basename "$c_out")"
if [ "$rc" -eq 0 ] && [ "$(dirname "$c_out")" = "$WORK/ex-c/recordings" ] \
   && [[ "$base" =~ ^[A-Za-z0-9._-]+$ ]] && [[ "$base" != .* ]] && [[ "$base" == *etc*pass*wd* ]]; then
  ok "3 name sanitised to [A-Za-z0-9._-], stays in recordings/ ($base)"
else
  bad "3 sanitise rc=$rc out=$c_out"
fi
rec c stop >/dev/null

# 6
STUB_LIFETIME_MS=1200 rec d start first >/dev/null; rc=$?
sleep 1.8
rm -f "$WORK/args-d"
rec d start second >/dev/null; rc2=$?
waitfor "$WORK/args-d"
if [ "$rc" -eq 0 ] && [ "$rc2" -eq 0 ] && grep -q "second-" "$WORK/args-d"; then
  ok "6 stale pidfile after -t expiry does not block the next start"
else
  bad "6 stale pidfile rc=$rc rc2=$rc2"
fi
rec d stop >/dev/null

# 7
RECORD_ENCODER_ARGS="-c:v h264_nvenc -preset p1 -pix_fmt yuv420p" rec e start >/dev/null; rc=$?
waitfor "$WORK/args-e"; e="$(argline e)"
rec e stop >/dev/null
BROWSER_DISPLAY_SIZE=1920x1200 rec f start >/dev/null 2>&1; rf=$?
RECORD_MAX_SECONDS=0 rec g start >/dev/null 2>&1; rg=$?
RECORD_MAX_SECONDS=abc rec h start >/dev/null 2>&1; rh=$?
sleep 0.3
if [ "$rc" -eq 0 ] && printf '%s' "$e" | grep -q -- "-c:v h264_nvenc -preset p1 -pix_fmt yuv420p " \
   && ! printf '%s' "$e" | grep -q libx264 \
   && [ "$rf" -ne 0 ] && [ "$rg" -ne 0 ] && [ "$rh" -ne 0 ] \
   && [ ! -e "$WORK/args-f" ] && [ ! -e "$WORK/args-g" ] && [ ! -e "$WORK/args-h" ]; then
  ok "7 encoder from RECORD_ENCODER_ARGS; invalid size / max duration refused before ffmpeg"
else
  bad "7 encoder/validation rc=$rc rf=$rf rg=$rg rh=$rh args=$e"
fi

# 9
DF="$REPO/browsercontainer/Dockerfile"
if grep -Eq '^[[:space:]]+ffmpeg \\$' "$DF" \
   && grep -q 'COPY --chown=devuser:devuser record.sh /opt/browsercontainer/record.sh' "$DF" \
   && grep -q 'chmod +x[^#]*/opt/browsercontainer/record.sh' "$DF"; then
  ok "9 image installs ffmpeg and ships record.sh executable"
else
  bad "9 Dockerfile wiring for record.sh"
fi

echo "record: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
