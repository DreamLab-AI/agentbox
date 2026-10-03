#!/usr/bin/env bash
# W9 (custody-isolation 2026-10-03): browsercontainer/scripts/fetch-podkey.sh.
#
# The property under test: the sidecar only ever installs the Podkey CI artefact
# named in browsercontainer/podkey.pin, byte for byte. Anything else is refused
# before it reaches the image's extension directory.
#
# Cases (fixture zips built here; no network, no token):
#   pin    1. a pin naming a fork repository is refused (exit 2)
#          2. a pin with a malformed sha256 is refused (exit 2)
#          3. the committed pin parses and names the upstream repo + podkey-extension
#   verify 4. sha match passes
#          5. sha mismatch is refused (exit 3)
#          6. missing zip is refused (exit 4)
#   install 7. good zip unpacks; manifest.json carries the pinned name/version
#          8. sha mismatch is refused and a previous install is left untouched
#          9. manifest version differing from the pin is refused (exit 5)
#         10. build.json commit differing from the pin is refused (exit 5)
#         11. a zip-slip entry (../) is refused (exit 5) and nothing escapes
#   fetch 12. download via gh: run head_sha + artefact checked, zip verified, cached
#         13. a cached zip that matches is reused without any download
#         14. downloaded bytes that do not match the pin are refused, nothing left behind
#         15. a run whose head_sha is not the pinned commit is refused (exit 5)
#         16. no gh and no token: refused with a clear message (exit 6)
#   live  17. the committed pin against the cached real artefact, when present
#             (browsercontainer/vendor/podkey-extension.zip; skipped otherwise)
#
# Run: bash tests/browsercontainer/fetch-podkey.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SCRIPT="$REPO/browsercontainer/scripts/fetch-podkey.sh"
PIN="$REPO/browsercontainer/podkey.pin"

PASS=0
FAIL=0
SKIP=0
ok()   { PASS=$((PASS + 1)); echo "PASS: $*"; }
bad()  { FAIL=$((FAIL + 1)); echo "FAIL: $*"; }
skip() { SKIP=$((SKIP + 1)); echo "SKIP: $*"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

COMMIT="3752aa2b7f579ba4414ea21745fb7e826e08406e"

# make_zip <out> <name> <version> <commit> [slip]
make_zip() {
  python3 - "$@" <<'PY'
import json, sys, zipfile
out, name, version, commit = sys.argv[1:5]
slip = len(sys.argv) > 5
with zipfile.ZipFile(out, "w") as z:
    z.writestr("manifest.json", json.dumps({"manifest_version": 3, "name": name, "version": version}))
    z.writestr("build.json", json.dumps({"commit": commit, "built": "2026-09-25T12:17Z"}))
    z.writestr("src/background.bundle.js", "// fixture\n")
    if slip:
        z.writestr("../escaped.txt", "should never land\n")
PY
}

sha_of() { sha256sum "$1" | cut -d' ' -f1; }

# write_pin <out> <sha> [repo] [version] [commit]
write_pin() {
  cat >"$1" <<EOF
{
  "repo": "${3:-JavaScriptSolidServer/podkey}",
  "workflow": ".github/workflows/ci.yml",
  "artifact": "podkey-extension",
  "commit": "${5:-$COMMIT}",
  "run_id": "36134082610",
  "artifact_id": "10862859494",
  "sha256": "$2",
  "extension_name": "Podkey",
  "version": "${4:-0.0.11}",
  "artifact_expires": "2026-12-24T12:17:30Z"
}
EOF
}

GOOD="$WORK/good.zip";   make_zip "$GOOD" Podkey 0.0.11 "$COMMIT"
OTHER="$WORK/other.zip"; make_zip "$OTHER" Podkey 0.0.11 "$COMMIT"
printf 'tamper' >>"$OTHER"
GOOD_SHA="$(sha_of "$GOOD")"
GOOD_PIN="$WORK/good.pin"; write_pin "$GOOD_PIN" "$GOOD_SHA"

run() { "$SCRIPT" "$@" >"$WORK/out" 2>&1; echo $?; }

# ── pin ───────────────────────────────────────────────────────────────────────
write_pin "$WORK/fork.pin" "$GOOD_SHA" "jjohare/podkey"
rc=$(run verify --pin "$WORK/fork.pin" --zip "$GOOD")
if [ "$rc" = 2 ] && grep -q "upstream" "$WORK/out"; then ok "1 fork repo refused"; else bad "1 fork repo (rc=$rc): $(cat "$WORK/out")"; fi

write_pin "$WORK/badsha.pin" "nothex"
rc=$(run verify --pin "$WORK/badsha.pin" --zip "$GOOD")
if [ "$rc" = 2 ]; then ok "2 malformed sha refused"; else bad "2 malformed sha (rc=$rc)"; fi

rc=$(run show-pin --pin "$PIN")
if [ "$rc" = 0 ] && grep -q "repo=JavaScriptSolidServer/podkey" "$WORK/out" \
   && grep -q "artifact=podkey-extension" "$WORK/out"; then
  ok "3 committed pin parses (upstream repo, podkey-extension)"
else
  bad "3 committed pin (rc=$rc): $(cat "$WORK/out")"
fi

# ── verify ────────────────────────────────────────────────────────────────────
rc=$(run verify --pin "$GOOD_PIN" --zip "$GOOD")
if [ "$rc" = 0 ]; then ok "4 sha match passes"; else bad "4 sha match (rc=$rc): $(cat "$WORK/out")"; fi

rc=$(run verify --pin "$GOOD_PIN" --zip "$OTHER")
if [ "$rc" = 3 ] && grep -q "REFUSED" "$WORK/out"; then ok "5 sha mismatch refused"; else bad "5 sha mismatch (rc=$rc)"; fi

rc=$(run verify --pin "$GOOD_PIN" --zip "$WORK/absent.zip")
if [ "$rc" = 4 ]; then ok "6 missing zip refused"; else bad "6 missing zip (rc=$rc)"; fi

# ── install ───────────────────────────────────────────────────────────────────
DEST="$WORK/ext/podkey"
rc=$(run install --pin "$GOOD_PIN" --zip "$GOOD" --dest "$DEST")
if [ "$rc" = 0 ] && grep -q '"name": "Podkey"' "$DEST/manifest.json" && grep -q '"version": "0.0.11"' "$DEST/manifest.json"; then
  ok "7 install unpacks pinned name/version"
else
  bad "7 install (rc=$rc): $(cat "$WORK/out")"
fi

before="$(find "$DEST" -type f | sort | xargs sha256sum | sha256sum)"
rc=$(run install --pin "$GOOD_PIN" --zip "$OTHER" --dest "$DEST")
after="$(find "$DEST" -type f | sort | xargs sha256sum | sha256sum)"
if [ "$rc" = 3 ] && [ "$before" = "$after" ]; then ok "8 mismatch refused, previous install untouched"; else bad "8 mismatch install (rc=$rc)"; fi

V2="$WORK/v2.zip"; make_zip "$V2" Podkey 0.0.12 "$COMMIT"
write_pin "$WORK/v2.pin" "$(sha_of "$V2")"
rc=$(run install --pin "$WORK/v2.pin" --zip "$V2" --dest "$WORK/ext2/podkey")
if [ "$rc" = 5 ] && [ ! -e "$WORK/ext2/podkey" ]; then ok "9 version mismatch refused"; else bad "9 version mismatch (rc=$rc)"; fi

C2="$WORK/c2.zip"; make_zip "$C2" Podkey 0.0.11 "0000000000000000000000000000000000000000"
write_pin "$WORK/c2.pin" "$(sha_of "$C2")"
rc=$(run install --pin "$WORK/c2.pin" --zip "$C2" --dest "$WORK/ext3/podkey")
if [ "$rc" = 5 ] && [ ! -e "$WORK/ext3/podkey" ]; then ok "10 build.json commit mismatch refused"; else bad "10 commit mismatch (rc=$rc)"; fi

SLIP="$WORK/slip.zip"; make_zip "$SLIP" Podkey 0.0.11 "$COMMIT" slip
write_pin "$WORK/slip.pin" "$(sha_of "$SLIP")"
mkdir -p "$WORK/ext4"
rc=$(run install --pin "$WORK/slip.pin" --zip "$SLIP" --dest "$WORK/ext4/podkey")
if [ "$rc" = 5 ] && [ ! -e "$WORK/ext4/escaped.txt" ] && [ ! -e "$WORK/escaped.txt" ]; then ok "11 zip-slip refused"; else bad "11 zip-slip (rc=$rc)"; fi

# ── fetch (fake gh on PATH) ───────────────────────────────────────────────────
FAKEBIN="$WORK/bin"; mkdir -p "$FAKEBIN"
cat >"$FAKEBIN/gh" <<'EOF'
#!/usr/bin/env bash
echo "gh $*" >>"$FAKE_GH_LOG"
case "$*" in
  "auth status"*) exit 0 ;;
  *"/actions/runs/36134082610 --jq .head_sha"*) echo "$FAKE_HEAD_SHA" ;;
  *"/actions/artifacts/10862859494 --jq"*) echo "podkey-extension 36134082610 false" ;;
  *"/actions/artifacts/10862859494/zip"*) cat "$FAKE_ZIP" ;;
  *) echo "unexpected gh call: $*" >&2; exit 9 ;;
esac
EOF
chmod +x "$FAKEBIN/gh"
export FAKE_GH_LOG="$WORK/gh.log"

OUT="$WORK/vendor/podkey-extension.zip"
: >"$FAKE_GH_LOG"
rc=$(PATH="$FAKEBIN:$PATH" FAKE_HEAD_SHA="$COMMIT" FAKE_ZIP="$GOOD" run fetch --pin "$GOOD_PIN" --out "$OUT")
if [ "$rc" = 0 ] && [ "$(sha_of "$OUT")" = "$GOOD_SHA" ] && grep -q "head_sha" "$FAKE_GH_LOG" && grep -q "/zip" "$FAKE_GH_LOG"; then
  ok "12 fetch via gh checks run + artefact and verifies"
else
  bad "12 fetch (rc=$rc): $(cat "$WORK/out")"
fi

: >"$FAKE_GH_LOG"
rc=$(PATH="$FAKEBIN:$PATH" FAKE_HEAD_SHA="$COMMIT" FAKE_ZIP="$OTHER" run fetch --pin "$GOOD_PIN" --out "$OUT")
if [ "$rc" = 0 ] && ! grep -q "/zip" "$FAKE_GH_LOG"; then ok "13 cached matching zip reused, no download"; else bad "13 cache (rc=$rc): $(cat "$FAKE_GH_LOG")"; fi

rm -f "$OUT"
rc=$(PATH="$FAKEBIN:$PATH" FAKE_HEAD_SHA="$COMMIT" FAKE_ZIP="$OTHER" run fetch --pin "$GOOD_PIN" --out "$OUT")
leftover="$(find "$WORK/vendor" -type f | wc -l)"
if [ "$rc" = 3 ] && [ "$leftover" = 0 ]; then ok "14 tampered download refused, nothing left"; else bad "14 tampered (rc=$rc, files=$leftover)"; fi

rc=$(PATH="$FAKEBIN:$PATH" FAKE_HEAD_SHA="1111111111111111111111111111111111111111" FAKE_ZIP="$GOOD" run fetch --pin "$GOOD_PIN" --out "$OUT")
if [ "$rc" = 5 ] && [ ! -e "$OUT" ]; then ok "15 run head_sha mismatch refused"; else bad "15 head_sha (rc=$rc)"; fi

NOGH="$WORK/nogh"; mkdir -p "$NOGH"
for t in bash sha256sum cut sed grep mktemp rm mv mkdir dirname cat tr head printf env date python3; do
  p="$(command -v "$t" 2>/dev/null)" && ln -sf "$p" "$NOGH/$t"
done
rc=$(env -u GH_TOKEN -u GITHUB_TOKEN PATH="$NOGH" "$SCRIPT" fetch --pin "$GOOD_PIN" --out "$OUT" >"$WORK/out" 2>&1; echo $?)
if [ "$rc" = 6 ] && grep -q "GH_TOKEN" "$WORK/out"; then ok "16 no gh/no token refused clearly"; else bad "16 no tool (rc=$rc): $(cat "$WORK/out")"; fi

# ── live pin vs cached real artefact ──────────────────────────────────────────
REAL="$REPO/browsercontainer/vendor/podkey-extension.zip"
if [ -f "$REAL" ]; then
  rc=$(run install --pin "$PIN" --zip "$REAL" --dest "$WORK/real/podkey")
  if [ "$rc" = 0 ] && grep -q '"name": "Podkey"' "$WORK/real/podkey/manifest.json"; then
    ok "17 committed pin verifies + installs the cached real artefact"
  else
    bad "17 real artefact (rc=$rc): $(cat "$WORK/out")"
  fi
else
  skip "17 no cached real artefact (run browsercontainer/scripts/fetch-podkey.sh fetch)"
fi

echo "fetch-podkey: $PASS passed, $FAIL failed, $SKIP skipped"
[ "$FAIL" -eq 0 ]
