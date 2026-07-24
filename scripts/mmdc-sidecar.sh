#!/bin/sh
# mmdc-sidecar.sh — drop-in replacement for `mmdc` that delegates Mermaid
# rendering to the browsercontainer sidecar's /render-mermaid endpoint.
#
# Rendering moved out of the agentbox Nix image (no puppeteer/Chrome there)
# into the browsercontainer, which already runs headless Chrome. This wrapper
# POSTs the diagram source to the sidecar, which renders and writes the output
# onto the shared gui-tools-exchange volume; we then copy it to the requested
# path and remove the exchange scratch file.
#
# Volume topology: the same Docker volume `gui-tools-exchange` is mounted at
#   agentbox:         /home/devuser/gui-tools   (this script's view)
#   browsercontainer: /home/devuser/exchange    (the sidecar's view)
#
# POSIX sh. Depends on: curl, jq.
set -eu

SIDECAR_URL="${MERMAID_SIDECAR_URL:-http://browsercontainer:8931/render-mermaid}"
EXCHANGE_DIR="${MERMAID_EXCHANGE_DIR:-/home/devuser/gui-tools}"

PROG="$(basename "$0")"

usage() {
    cat <<EOF
Usage: $PROG -i <input.mmd> -o <output> [-e <format>] [-t <theme>]

Drop-in replacement for mmdc that renders via the browsercontainer sidecar.

Options:
  -i <input>    Input Mermaid definition file (.mmd). Required.
  -o <output>   Output file path. Required. Format is inferred from the
                extension unless -e is given.
  -e <format>   Output format: svg | png | pdf. Default: inferred from -o,
                else svg.
  -t <theme>    Mermaid theme: default | dark | forest | neutral.
                Default: default.
  -h, --help    Show this help and exit.

Environment:
  MERMAID_SIDECAR_URL   Sidecar endpoint (default: $SIDECAR_URL)
  MERMAID_EXCHANGE_DIR  Agentbox-side view of the shared exchange volume
                        (default: $EXCHANGE_DIR)

Exit codes:
  0  success
  1  usage / argument error
  2  missing dependency (curl or jq)
  3  input file unreadable
  4  sidecar request failed or returned an error
  5  rendered file missing on the exchange volume / copy failed
EOF
}

die() {
    # die <exit-code> <message>
    _code="$1"
    shift
    printf '%s: %s\n' "$PROG" "$*" >&2
    exit "$_code"
}

INPUT=""
OUTPUT=""
FORMAT=""
THEME="default"

while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        -i)
            [ $# -ge 2 ] || die 1 "option -i requires an argument"
            INPUT="$2"
            shift 2
            ;;
        -o)
            [ $# -ge 2 ] || die 1 "option -o requires an argument"
            OUTPUT="$2"
            shift 2
            ;;
        -e)
            [ $# -ge 2 ] || die 1 "option -e requires an argument"
            FORMAT="$2"
            shift 2
            ;;
        -t)
            [ $# -ge 2 ] || die 1 "option -t requires an argument"
            THEME="$2"
            shift 2
            ;;
        --)
            shift
            break
            ;;
        -*)
            die 1 "unknown option: $1 (try --help)"
            ;;
        *)
            die 1 "unexpected argument: $1 (try --help)"
            ;;
    esac
done

[ -n "$INPUT" ]  || die 1 "missing required -i <input> (try --help)"
[ -n "$OUTPUT" ] || die 1 "missing required -o <output> (try --help)"

command -v curl >/dev/null 2>&1 || die 2 "curl not found on PATH"
command -v jq   >/dev/null 2>&1 || die 2 "jq not found on PATH"

[ -f "$INPUT" ] && [ -r "$INPUT" ] || die 3 "input file not readable: $INPUT"

# Infer format from the output extension when -e was not supplied.
if [ -z "$FORMAT" ]; then
    case "$OUTPUT" in
        *.svg) FORMAT="svg" ;;
        *.png) FORMAT="png" ;;
        *.pdf) FORMAT="pdf" ;;
        *)     FORMAT="svg" ;;
    esac
fi

# Build the request body without shell-interpolating the diagram source:
# jq --rawfile reads the file verbatim and emits correctly escaped JSON.
REQ_BODY="$(jq -n \
    --rawfile definition "$INPUT" \
    --arg format "$FORMAT" \
    --arg theme "$THEME" \
    '{definition: $definition, format: $format, theme: $theme}')" \
    || die 4 "failed to build request body from $INPUT"

RESP="$(curl -fsS \
    --max-time 120 \
    -H 'Content-Type: application/json' \
    -X POST \
    --data-binary "$REQ_BODY" \
    "$SIDECAR_URL")" \
    || die 4 "sidecar request failed: $SIDECAR_URL"

# The endpoint returns {"ok": true, "filename": "..."} on success, or
# {"ok": false, "error": "..."} on failure.
if [ "$(printf '%s' "$RESP" | jq -r '.ok // false')" != "true" ]; then
    ERR="$(printf '%s' "$RESP" | jq -r '.error // "unknown error"')"
    die 4 "sidecar reported failure: $ERR"
fi

FILENAME="$(printf '%s' "$RESP" | jq -r '.filename // empty')"
[ -n "$FILENAME" ] || die 4 "sidecar response missing filename"

# Guard against path traversal in the returned filename — we only ever expect
# a bare basename living directly in the exchange dir.
case "$FILENAME" in
    */*|..|.) die 5 "unexpected filename from sidecar: $FILENAME" ;;
esac

EXCHANGE_FILE="$EXCHANGE_DIR/$FILENAME"

# The sidecar writes asynchronously across a shared volume; allow a brief
# window for the file to appear before giving up.
_tries=0
while [ ! -f "$EXCHANGE_FILE" ] && [ "$_tries" -lt 50 ]; do
    _tries=$((_tries + 1))
    sleep 0.1
done
[ -f "$EXCHANGE_FILE" ] || die 5 "rendered file not found on exchange volume: $EXCHANGE_FILE"

cleanup() {
    rm -f "$EXCHANGE_FILE" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

OUT_DIR="$(dirname "$OUTPUT")"
[ -d "$OUT_DIR" ] || mkdir -p "$OUT_DIR" || die 5 "cannot create output dir: $OUT_DIR"

cp "$EXCHANGE_FILE" "$OUTPUT" || die 5 "failed to copy $EXCHANGE_FILE -> $OUTPUT"

printf '%s: rendered %s -> %s (%s, theme=%s)\n' "$PROG" "$INPUT" "$OUTPUT" "$FORMAT" "$THEME"
