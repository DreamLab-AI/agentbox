#!/usr/bin/env bash
# fetch-podkey.sh — fetch, verify and install the pinned Podkey CI artefact.
#
# Owner rule (2026-10-03, rule-sidecar-ships-podkey): the browser sidecar
# installs Podkey from the PUBLISHED artefact, the `podkey-extension` artefact
# of JavaScriptSolidServer/podkey's CI workflow, never a hand-made zip, a fork
# build, or a from-source build. The artefact is named exactly by
# browsercontainer/podkey.pin; the pin moves forward only by editing that file
# (rule-estate-pins-move-forward).
#
# Subcommands
#   fetch    [--pin F] [--out ZIP]          download the pinned artefact zip (host side,
#                                           before `docker compose build`); reuses a cached
#                                           zip that already matches the pin
#   verify   [--pin F] --zip ZIP            check ZIP's sha256 against the pin
#   install  [--pin F] --zip ZIP --dest DIR verify, unpack, check manifest/build.json against
#                                           the pin, then atomically replace DIR (image build)
#   show-pin [--pin F]                      print the parsed pin as key=value lines
#
# Download path: the raw artefact zip from the REST endpoint
#   GET /repos/{repo}/actions/artifacts/{artifact_id}/zip
# via `gh api` (preferred) or curl with GH_TOKEN / GITHUB_TOKEN. Not
# `gh run download`: that unpacks the archive, so the bytes GitHub's own
# artefact digest covers would never be seen, and the pin is the sha256 of the zip.
# Before downloading, the run's head_sha must equal the pinned commit and the
# artefact id must belong to the pinned run under the pinned name.
#
# Exit codes: 0 ok · 2 usage / invalid pin · 3 sha256 mismatch (REFUSED)
#             4 file missing · 5 content does not match the pin · 6 cannot download
set -euo pipefail

readonly UPSTREAM_REPO="JavaScriptSolidServer/podkey"
readonly UPSTREAM_ARTIFACT="podkey-extension"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIN="$HERE/../podkey.pin"
OUT="$HERE/../vendor/podkey-extension.zip"
ZIP=""
DEST=""

log() { printf '[fetch-podkey] %s\n' "$*" >&2; }
die() { local rc="$1"; shift; log "$*"; exit "$rc"; }

usage() {
  sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed -e '/^set -euo/d' -e 's/^# \{0,1\}//' >&2
  exit 2
}

[ $# -ge 1 ] || usage
CMD="$1"; shift
while [ $# -gt 0 ]; do
  case "$1" in
    --pin)  PIN="${2:?--pin needs a file}"; shift 2 ;;
    --out)  OUT="${2:?--out needs a path}"; shift 2 ;;
    --zip)  ZIP="${2:?--zip needs a path}"; shift 2 ;;
    --dest) DEST="${2:?--dest needs a directory}"; shift 2 ;;
    -h|--help) usage ;;
    *) die 2 "unknown argument: $1" ;;
  esac
done

# ── pin ───────────────────────────────────────────────────────────────────────
# The pin is flat JSON with string values only, one key per line, so it parses
# without jq (the sidecar image has none) and stays diff-friendly.
pin_get() {
  sed -n "s/^[[:space:]]*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$PIN" | head -n1
}

load_pin() {
  [ -f "$PIN" ] || die 2 "pin file not found: $PIN"
  P_REPO="$(pin_get repo)"
  P_ARTIFACT="$(pin_get artifact)"
  P_COMMIT="$(pin_get commit)"
  P_RUN="$(pin_get run_id)"
  P_ARTIFACT_ID="$(pin_get artifact_id)"
  P_SHA="$(pin_get sha256)"
  P_NAME="$(pin_get extension_name)"
  P_VERSION="$(pin_get version)"
  P_EXPIRES="$(pin_get artifact_expires)"

  [ "$P_REPO" = "$UPSTREAM_REPO" ] \
    || die 2 "pin repo '$P_REPO' is not the upstream $UPSTREAM_REPO; fork artefacts are never installed"
  [ "$P_ARTIFACT" = "$UPSTREAM_ARTIFACT" ] \
    || die 2 "pin artifact '$P_ARTIFACT' is not $UPSTREAM_ARTIFACT"
  [[ "$P_COMMIT" =~ ^[0-9a-f]{40}$ ]]      || die 2 "pin commit is not a 40-hex sha"
  [[ "$P_RUN" =~ ^[0-9]+$ ]]               || die 2 "pin run_id is not numeric"
  [[ "$P_ARTIFACT_ID" =~ ^[0-9]+$ ]]       || die 2 "pin artifact_id is not numeric"
  [[ "$P_SHA" =~ ^[0-9a-f]{64}$ ]]         || die 2 "pin sha256 is not 64 lowercase hex"
  [ -n "$P_NAME" ]                         || die 2 "pin extension_name is empty"
  [[ "$P_VERSION" =~ ^[0-9]+(\.[0-9]+){0,3}$ ]] || die 2 "pin version is not a Chrome version string"
}

sha256_of() { sha256sum "$1" | cut -d' ' -f1; }

verify_zip() { # <zip>
  [ -f "$1" ] || die 4 "artefact zip not found: $1"
  local got
  got="$(sha256_of "$1")"
  if [ "$got" != "$P_SHA" ]; then
    die 3 "REFUSED: $1 sha256 $got does not match the pin $P_SHA"
  fi
}

# ── unpack helpers (unzip, else bsdtar, else python3) ─────────────────────────
zip_list() {
  if command -v unzip >/dev/null 2>&1; then unzip -Z1 "$1"
  elif command -v bsdtar >/dev/null 2>&1; then bsdtar -tf "$1"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import sys,zipfile; print("\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))' "$1"
  else die 5 "no unzip, bsdtar or python3 to read the artefact"; fi
}

zip_extract() { # <zip> <dir>
  if command -v unzip >/dev/null 2>&1; then unzip -q "$1" -d "$2"
  elif command -v bsdtar >/dev/null 2>&1; then bsdtar -xf "$1" -C "$2"
  else python3 -c 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$1" "$2"; fi
}

json_field() { # <file> <key>  — first "key": "value" in a small flat JSON file
  sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$1" | head -n1
}

# ── subcommands ───────────────────────────────────────────────────────────────
cmd_show_pin() {
  load_pin
  printf 'repo=%s\nartifact=%s\ncommit=%s\nrun_id=%s\nartifact_id=%s\nsha256=%s\nextension_name=%s\nversion=%s\nartifact_expires=%s\n' \
    "$P_REPO" "$P_ARTIFACT" "$P_COMMIT" "$P_RUN" "$P_ARTIFACT_ID" "$P_SHA" "$P_NAME" "$P_VERSION" "$P_EXPIRES"
}

cmd_verify() {
  [ -n "$ZIP" ] || die 2 "verify needs --zip"
  load_pin
  verify_zip "$ZIP"
  log "verified $ZIP against pin (podkey $P_VERSION @ ${P_COMMIT:0:7})"
}

cmd_install() {
  [ -n "$ZIP" ] && [ -n "$DEST" ] || die 2 "install needs --zip and --dest"
  load_pin
  [ -f "$ZIP" ] || die 4 "artefact zip not found: $ZIP"

  local parent stage
  parent="$(dirname "$DEST")"
  mkdir -p "$parent"
  stage="$(mktemp -d "$parent/.podkey-stage.XXXXXX")"
  # shellcheck disable=SC2064  # expand now: $stage is fixed for this run
  trap "rm -rf '$stage'" EXIT

  # Verify the copy we will extract, so the bytes checked are the bytes unpacked.
  cp "$ZIP" "$stage/artefact.zip"
  verify_zip "$stage/artefact.zip"

  local entry
  while IFS= read -r entry; do
    case "$entry" in
      /*|..|../*|*/../*|*/..) die 5 "REFUSED: artefact entry escapes the extension dir: $entry" ;;
    esac
  done < <(zip_list "$stage/artefact.zip")

  mkdir "$stage/ext"
  zip_extract "$stage/artefact.zip" "$stage/ext"

  local manifest="$stage/ext/manifest.json" build="$stage/ext/build.json" name version commit
  [ -f "$manifest" ] || die 5 "artefact has no manifest.json"
  name="$(json_field "$manifest" name)"
  version="$(json_field "$manifest" version)"
  [ "$name" = "$P_NAME" ]       || die 5 "manifest name '$name' is not the pinned '$P_NAME'"
  [ "$version" = "$P_VERSION" ] || die 5 "manifest version '$version' is not the pinned '$P_VERSION'"
  [ -f "$build" ] || die 5 "artefact has no build.json (CI stamps the source commit there)"
  commit="$(json_field "$build" commit)"
  [ "$commit" = "$P_COMMIT" ]   || die 5 "build.json commit '$commit' is not the pinned $P_COMMIT"

  chmod -R a+rX "$stage/ext"
  rm -rf "$DEST"
  mv "$stage/ext" "$DEST"
  log "installed podkey $version @ ${commit:0:7} into $DEST"
}

gh_usable() { command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; }

cmd_fetch() {
  load_pin
  mkdir -p "$(dirname "$OUT")"

  if [ -f "$OUT" ] && [ "$(sha256_of "$OUT")" = "$P_SHA" ]; then
    log "cached $OUT already matches the pin; no download"
    return 0
  fi
  [ -f "$OUT" ] && { log "cached $OUT does not match the pin; replacing"; rm -f "$OUT"; }

  if [ -n "$P_EXPIRES" ] && [[ "$P_EXPIRES" < "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ]]; then
    log "WARNING: the pinned artefact expired at $P_EXPIRES; GitHub will 410 it. Move the pin forward."
  fi

  local api="repos/$P_REPO/actions" part head meta
  part="$(mktemp "$(dirname "$OUT")/.podkey-download.XXXXXX")"
  # shellcheck disable=SC2064
  trap "rm -f '$part'" EXIT

  if gh_usable; then
    head="$(gh api "$api/runs/$P_RUN" --jq .head_sha)" || die 6 "cannot read run $P_RUN"
    meta="$(gh api "$api/artifacts/$P_ARTIFACT_ID" --jq '.name+" "+(.workflow_run.id|tostring)+" "+(.expired|tostring)')" \
      || die 6 "cannot read artefact $P_ARTIFACT_ID"
    [ "$head" = "$P_COMMIT" ] || die 5 "run $P_RUN built $head, not the pinned $P_COMMIT"
    [ "$meta" = "$P_ARTIFACT $P_RUN false" ] \
      || die 5 "artefact $P_ARTIFACT_ID is '$meta', expected '$P_ARTIFACT $P_RUN false'"
    gh api "$api/artifacts/$P_ARTIFACT_ID/zip" >"$part" || die 6 "download of artefact $P_ARTIFACT_ID failed"
  else
    local token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
    if [ -z "$token" ] || ! command -v curl >/dev/null 2>&1; then
      die 6 "cannot download: need an authenticated gh, or curl with GH_TOKEN/GITHUB_TOKEN exported (GitHub serves artefacts to authenticated callers only)"
    fi
    local hdr=(-H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")
    head="$(curl -fsS "${hdr[@]}" "https://api.github.com/$api/runs/$P_RUN" | json_field /dev/stdin head_sha)" \
      || die 6 "cannot read run $P_RUN"
    [ "$head" = "$P_COMMIT" ] || die 5 "run $P_RUN built $head, not the pinned $P_COMMIT"
    meta="$(curl -fsS "${hdr[@]}" "https://api.github.com/$api/artifacts/$P_ARTIFACT_ID")" || die 6 "cannot read artefact $P_ARTIFACT_ID"
    [ "$(printf '%s' "$meta" | json_field /dev/stdin name)" = "$P_ARTIFACT" ] \
      || die 5 "artefact $P_ARTIFACT_ID is not named $P_ARTIFACT"
    printf '%s' "$meta" | tr -d ' \n' | grep -q "\"workflow_run\":{\"id\":$P_RUN," \
      || die 5 "artefact $P_ARTIFACT_ID does not belong to run $P_RUN"
    curl -fsSL "${hdr[@]}" "https://api.github.com/$api/artifacts/$P_ARTIFACT_ID/zip" -o "$part" \
      || die 6 "download of artefact $P_ARTIFACT_ID failed"
  fi

  verify_zip "$part"
  mv "$part" "$OUT"
  log "fetched and verified podkey $P_VERSION @ ${P_COMMIT:0:7} -> $OUT"
}

case "$CMD" in
  fetch)    cmd_fetch ;;
  verify)   cmd_verify ;;
  install)  cmd_install ;;
  show-pin) cmd_show_pin ;;
  -h|--help|help) usage ;;
  *) die 2 "unknown subcommand: $CMD (fetch|verify|install|show-pin)" ;;
esac
