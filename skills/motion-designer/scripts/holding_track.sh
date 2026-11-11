#!/usr/bin/env bash
# holding_track.sh - find and fetch a HOLDING track: a low-quality stand-in so the film can be cut
# to real music before a licensed track exists. It is never a deliverable.
#   bash holding_track.sh search "<mood words> instrumental 120 bpm" [count=10]
#       -> one line per candidate: seconds <TAB> title <TAB> uploader <TAB> url
#   bash holding_track.sh get <url> <audio dir>
#       -> <audio dir>/HOLDING_<id>.wav and HOLDING_<id>.wav.rights.json (status: holding)
# The fetch takes the lowest-bitrate stream and low-passes it at 7 kHz on purpose: enough to map beats and judge the
# cut, poor enough that nobody mistakes it for the master. music_cut.py carries the rights record
# onto the mix and master.sh refuses to write an export that does not say "holding" in its name.
set -euo pipefail
command -v yt-dlp >/dev/null || { echo "yt-dlp is not on PATH (it is baked with the image's Python runtime)"; exit 2; }
MODE="${1:-}"; shift || true
case "$MODE" in
  search)
    Q="${1:?search needs a query}"; N="${2:-10}"
    yt-dlp --no-warnings --flat-playlist --match-filter "duration > 60 & duration < 900" \
      --print "%(duration)s	%(title)s	%(uploader)s	%(webpage_url)s" "ytsearch${N}:${Q}"
    ;;
  get)
    URL="${1:?get needs a url}"; DIR="${2:?get needs the project audio directory}"
    case "$URL" in https://*) ;; *) echo "refusing a non-https url: $URL"; exit 2;; esac
    mkdir -p "$DIR"
    META=$(yt-dlp --no-warnings --no-playlist --dump-json -- "$URL")
    ID=$(printf '%s' "$META" | jq -r '.id' | tr -cd 'A-Za-z0-9_-')
    OUT="$DIR/HOLDING_${ID}.wav"
    TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
    yt-dlp --no-warnings --no-playlist --max-filesize 40M -f "worstaudio/worst" -o "$TMP/src.%(ext)s" -- "$URL" >/dev/null
    SRC=$(find "$TMP" -maxdepth 1 -type f -name 'src.*' | head -n 1)
    [ -n "$SRC" ] || { echo "download produced no file"; exit 1; }
    # the record is written before the audio, so an interrupted fetch never leaves a track without one
    printf '%s' "$META" | jq --arg url "$URL" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{
      status: "holding", licensed: false,
      note: "Stand-in for timing only. Not cleared for any use outside this project folder. Replace with a licensed track before delivery.",
      source_url: $url, title: .title, uploader: .uploader, duration_s: .duration,
      source_abr_kbps: (.abr // null), degraded: "low-pass 7 kHz", fetched_at: $at }' > "$OUT.rights.json"
    ffmpeg -y -loglevel error -i "$SRC" -vn -af lowpass=f=7000 -ac 2 -ar 48000 -c:a pcm_s16le "$OUT"
    echo "$OUT"; echo "$OUT.rights.json"
    ;;
  *) echo "usage: holding_track.sh search \"<query>\" [count] | get <url> <audio dir>"; exit 2;;
esac
