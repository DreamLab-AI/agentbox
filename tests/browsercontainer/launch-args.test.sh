#!/usr/bin/env bash
# W9 (custody-isolation 2026-10-03): browsercontainer/launch-chromium.sh loads Podkey.
#
# launch-chromium.sh runs against a stub Chrome that records its argv, so the exact
# flags are checked without starting a browser.
#
# Cases:
#   1. Chromium: --load-extension and --disable-extensions-except both name the
#      extension dir; mode file says "flag"
#   2. Google Chrome (branded): no --load-extension / --disable-extensions-except
#      (ignored, and the latter disables a CDP-loaded Podkey on Chrome 151);
#      --enable-unsafe-extension-debugging instead; mode file says "cdp"
#   3. no extension dir: Chrome still starts, no extension flags, mode "none"
#      (the sidecar must come up without Podkey and without a key)
#   4. --user-data-dir is the profile volume's mount, never /tmp/chrome-profile
#   5. stale Singleton{Lock,Socket,Cookie} left by a previous container are removed
#   6. one extension path everywhere: launch default == Dockerfile install --dest ==
#      podkey-ctl DEFAULT_EXT_DIR, and it lives inside the image (/opt/browsercontainer)
#   7. the Dockerfile installs the managed policy for both Chrome and Chromium and
#      runs fetch-podkey.sh install against the pin (no network in the build)
#   8. the real pinned artefact installed through fetch-podkey.sh yields manifest.json
#      with the pinned name/version, and launch points --load-extension at it
#      (skipped without the cached artefact)
# Run: bash tests/browsercontainer/launch-args.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
BC="$REPO/browsercontainer"
LAUNCH="$BC/launch-chromium.sh"

PASS=0; FAIL=0; SKIP=0
ok()   { PASS=$((PASS + 1)); echo "PASS: $*"; }
bad()  { FAIL=$((FAIL + 1)); echo "FAIL: $*"; }
skip() { SKIP=$((SKIP + 1)); echo "SKIP: $*"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cat >"$WORK/chrome-stub" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then echo "$STUB_VERSION"; exit 0; fi
printf '%s\n' "$@" >"$STUB_ARGS"
EOF
chmod +x "$WORK/chrome-stub"

EXT="$WORK/ext/podkey"
mkdir -p "$EXT"
echo '{"manifest_version":3,"name":"Podkey","version":"0.0.11"}' >"$EXT/manifest.json"

# launch <version-string> <ext-dir> <label>
launch() {
  local run="$WORK/run-$3" prof="$WORK/prof-$3"
  mkdir -p "$run" "$prof"
  STUB_VERSION="$1" STUB_ARGS="$WORK/args-$3" CHROME_BIN="$WORK/chrome-stub" \
    PODKEY_EXT_DIR="$2" BROWSERCONTAINER_RUN_DIR="$run" CHROME_PROFILE_DIR="$prof" \
    bash "$LAUNCH" >"$WORK/log-$3" 2>&1
}
has()  { grep -qxF -- "$2" "$WORK/args-$1"; }
hasp() { grep -q -- "$2" "$WORK/args-$1"; }
mode() { cat "$WORK/run-$1/podkey-mode" 2>/dev/null; }

launch "Chromium 150.0.7871.181 Arch Linux" "$EXT" chromium
if has chromium "--load-extension=$EXT" && has chromium "--disable-extensions-except=$EXT" \
   && [ "$(mode chromium)" = flag ]; then
  ok "1 Chromium loads Podkey by flag, all others disabled"
else
  bad "1 Chromium: $(tr '\n' ' ' <"$WORK/args-chromium" 2>/dev/null) mode=$(mode chromium)"
fi

launch "Google Chrome 151.0.7922.47 beta" "$EXT" branded
if ! hasp branded "--load-extension" && ! hasp branded "--disable-extensions-except" \
   && has branded "--enable-unsafe-extension-debugging" && [ "$(mode branded)" = cdp ]; then
  ok "2 branded Chrome: CDP load path, no ignored/blocking flags"
else
  bad "2 branded: $(tr '\n' ' ' <"$WORK/args-branded" 2>/dev/null) mode=$(mode branded)"
fi

launch "Google Chrome 151.0.7922.47 beta" "$WORK/nope" none
if [ -s "$WORK/args-none" ] && ! hasp none "extension" && [ "$(mode none)" = none ]; then
  ok "3 no extension dir: Chrome still starts without extension flags"
else
  bad "3 no ext: $(cat "$WORK/log-none")"
fi

if has branded "--user-data-dir=$WORK/prof-branded" \
   && grep -q 'CHROME_PROFILE_DIR:-/home/devuser/chrome-profile' "$LAUNCH" \
   && ! grep -rq '/tmp/chrome-profile' "$BC/launch-chromium.sh" "$BC/Dockerfile" "$BC/supervisord.conf"; then
  ok "4 user-data-dir is the volume mount; /tmp/chrome-profile gone"
else
  bad "4 user-data-dir"
fi

P5="$WORK/prof-singleton"; mkdir -p "$P5"
touch "$P5/SingletonCookie"; ln -s "browsercontainer-4242" "$P5/SingletonLock"; ln -s "/tmp/x/SingletonSocket" "$P5/SingletonSocket"
echo keep >"$P5/Preferences"
STUB_VERSION="Chromium 150" STUB_ARGS="$WORK/args-s" CHROME_BIN="$WORK/chrome-stub" PODKEY_EXT_DIR="$EXT" \
  BROWSERCONTAINER_RUN_DIR="$WORK/run-s" CHROME_PROFILE_DIR="$P5" bash "$LAUNCH" >/dev/null 2>&1
if [ ! -e "$P5/SingletonLock" ] && [ ! -L "$P5/SingletonLock" ] && [ ! -L "$P5/SingletonSocket" ] \
   && [ ! -e "$P5/SingletonCookie" ] && [ -f "$P5/Preferences" ]; then
  ok "5 stale Singleton files removed, profile kept"
else
  bad "5 singleton cleanup"
fi

DEF="/opt/browsercontainer/extensions/podkey"
if grep -q "PODKEY_EXT_DIR:-$DEF}" "$LAUNCH" \
   && grep -q -- "--dest $DEF" "$BC/Dockerfile" \
   && node -e "process.exit(require('$BC/podkey-ctl.js').DEFAULT_EXT_DIR === '$DEF' ? 0 : 1)"; then
  ok "6 one in-image extension path: launch == Dockerfile == podkey-ctl"
else
  bad "6 extension path drift"
fi

if grep -q 'policies/podkey-only.json /etc/opt/chrome/policies/managed/' "$BC/Dockerfile" \
   && grep -q '/etc/chromium/policies/managed/podkey-only.json' "$BC/Dockerfile" \
   && grep -q 'fetch-podkey.sh install --pin' "$BC/Dockerfile" \
   && ! grep -v '^[[:space:]]*#' "$BC/Dockerfile" | grep -Eq 'fetch-podkey.sh fetch|gh run download|npm (run )?build|GH_TOKEN|GITHUB_TOKEN'; then
  ok "7 Dockerfile: policy for both browsers, offline verify+install only"
else
  bad "7 Dockerfile wiring"
fi

REAL="$BC/vendor/podkey-extension.zip"
if [ -f "$REAL" ]; then
  DEST="$WORK/image/opt/browsercontainer/extensions/podkey"
  PIN_VERSION="$(bash "$BC/scripts/fetch-podkey.sh" show-pin | sed -n 's/^version=//p')"
  if bash "$BC/scripts/fetch-podkey.sh" install --zip "$REAL" --dest "$DEST" >/dev/null 2>&1 \
     && grep -q '"name": "Podkey"' "$DEST/manifest.json" \
     && grep -q "\"version\": \"$PIN_VERSION\"" "$DEST/manifest.json"; then
    launch "Chromium 150" "$DEST" real
    if has real "--load-extension=$DEST"; then
      ok "8 real artefact: manifest Podkey $PIN_VERSION, launch points at it"
    else
      bad "8 launch did not point at the installed artefact"
    fi
  else
    bad "8 real artefact install/manifest"
  fi
else
  skip "8 no cached real artefact (browsercontainer/scripts/fetch-podkey.sh fetch)"
fi

echo "launch-args: $PASS passed, $FAIL failed, $SKIP skipped"
[ "$FAIL" -eq 0 ]
