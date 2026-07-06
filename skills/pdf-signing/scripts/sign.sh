#!/usr/bin/env bash
# One-shot: ensure the interpreter, ensure an identity, sign a PDF.
#   ./sign.sh INPUT.pdf [OUTPUT.pdf] [--tsa URL] [--invisible] [--reason ...] ...
#
# Key store defaults to $PDF_SIGNING_KEYS_DIR, else ~/.local/share/pdf-signing.
# The private key never lives in the image or a repo — it stays in that dir.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PDF_SIGNING_KEYS_DIR="${PDF_SIGNING_KEYS_DIR:-$HOME/.local/share/pdf-signing}"

[[ $# -ge 1 ]] || { echo "usage: $0 INPUT.pdf [OUTPUT.pdf] [sign_pdf.py args…]" >&2; exit 2; }

PY="$("$here/setup.sh")"

if [[ ! -f "$PDF_SIGNING_KEYS_DIR/dreamlab-signing.p12" ]]; then
  echo "no signing identity in $PDF_SIGNING_KEYS_DIR — generating a self-signed one…" >&2
  mkdir -p "$PDF_SIGNING_KEYS_DIR"
  "$PY" "$here/make_signing_cert.py"
fi

in="$1"; shift
out_args=()
if [[ $# -ge 1 && "$1" != -* ]]; then out_args=(-o "$1"); shift; fi
exec "$PY" "$here/sign_pdf.py" "$in" "${out_args[@]}" "$@"
