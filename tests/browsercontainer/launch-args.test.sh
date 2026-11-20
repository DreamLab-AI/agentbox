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
same() { [ "$(sha256sum <"$1")" = "$(sha256sum <"$2")" ]; }

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

# --- ADR-2207 D1: one display, locked 16:9 ------------------------------------
# launch_sized <label> <size-or-empty> [profile-dir]
launch_sized() {
  local run="$WORK/run-$1" prof="${3:-$WORK/prof-$1}"
  mkdir -p "$run" "$prof"
  rm -f "$WORK/args-$1"
  if [ -n "$2" ]; then
    BROWSER_DISPLAY_SIZE="$2" STUB_VERSION="Google Chrome 151.0.7922.47 beta" STUB_ARGS="$WORK/args-$1" \
      CHROME_BIN="$WORK/chrome-stub" PODKEY_EXT_DIR="$EXT" BROWSERCONTAINER_RUN_DIR="$run" \
      CHROME_PROFILE_DIR="$prof" bash "$LAUNCH" >"$WORK/log-$1" 2>&1
  else
    env -u BROWSER_DISPLAY_SIZE STUB_VERSION="Google Chrome 151.0.7922.47 beta" STUB_ARGS="$WORK/args-$1" \
      CHROME_BIN="$WORK/chrome-stub" PODKEY_EXT_DIR="$EXT" BROWSERCONTAINER_RUN_DIR="$run" \
      CHROME_PROFILE_DIR="$prof" bash "$LAUNCH" >"$WORK/log-$1" 2>&1
  fi
}

launch_sized d1default ""
if has d1default "--window-position=0,0" && has d1default "--window-size=1920,1080" \
   && has d1default "--start-maximized" && has d1default "--force-device-scale-factor=1"; then
  ok "9 default display 1920x1080: position, size, maximised, scale 1"
else
  bad "9 default display flags: $(tr '\n' ' ' <"$WORK/args-d1default" 2>/dev/null) log=$(cat "$WORK/log-d1default")"
fi

launch_sized d1custom "2560x1440"
if has d1custom "--window-size=2560,1440" && has d1custom "--window-position=0,0" \
   && ! hasp d1custom "--window-size=1920"; then
  ok "10 custom BROWSER_DISPLAY_SIZE=2560x1440 drives the window size"
else
  bad "10 custom size: $(tr '\n' ' ' <"$WORK/args-d1custom" 2>/dev/null) log=$(cat "$WORK/log-d1custom")"
fi

bad_sizes=("1920x1200" "1024x576" "4096x2304" "abc" "1920x" "x1080" "01920x01080" "1920X1080" "-1920x-1080" "1920x1080x24" " 1920x1080" "1280x720.5")
c11=0
for s in "${bad_sizes[@]}"; do
  launch_sized d1bad "$s"; rc=$?
  if [ "$rc" -ne 0 ] && [ ! -e "$WORK/args-d1bad" ] && grep -q 'BROWSER_DISPLAY_SIZE' "$WORK/log-d1bad"; then
    c11=$((c11 + 1))
  else
    bad "11 invalid size '$s' was not refused before Chrome (rc=$rc)"
  fi
done
[ "$c11" -eq "${#bad_sizes[@]}" ] && ok "11 ${#bad_sizes[@]} invalid / non-16:9 sizes refused before Chrome starts"

# 12: saved view state is reset; every other key survives (Podkey lives elsewhere,
# but nothing else in Preferences is ours to touch).
P12="$WORK/prof-zoom"; mkdir -p "$P12/Default"
cat >"$P12/Default/Preferences" <<'EOF'
{"browser":{"window_placement":{"left":710,"top":265,"right":1210,"bottom":849,"maximized":false},"has_seen_welcome_page":true},
 "partition":{"per_host_zoom_levels":{"x":{"about:blank":{"zoom_level":1.2239}}},"default_zoom_level":{"x":1.2239},"keep_me":{"a":1}},
 "extensions":{"settings":{"cakgjkgiodcdhecnnfhmcfphjkknfjkd":{"state":1}}},"profile":{"name":"Person 1"}}
EOF
launch_sized d1zoom "" "$P12"
if node -e '
  const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const want = {browser:{has_seen_welcome_page:true},partition:{keep_me:{a:1}},
    extensions:{settings:{cakgjkgiodcdhecnnfhmcfphjkknfjkd:{state:1}}},profile:{name:"Person 1"}};
  require("assert").deepStrictEqual(p, want);' "$P12/Default/Preferences" 2>"$WORK/err12" \
   && [ -s "$WORK/args-d1zoom" ] && [ -z "$(find "$P12/Default" -name '*.tmp*' -o -name '.Preferences*')" ]; then
  ok "12 zoom levels and window placement removed, every other key kept, no temp file left"
else
  bad "12 view-state reset: $(cat "$WORK/err12") $(cat "$P12/Default/Preferences")"
fi

# 13: not JSON -> untouched, Chrome still starts (fail-open)
P13="$WORK/prof-badjson"; mkdir -p "$P13/Default"
printf '{"partition": {"per_host_zoom_levels": ' >"$P13/Default/Preferences"
cp "$P13/Default/Preferences" "$WORK/pref13.orig"
launch_sized d1badjson "" "$P13"
if same "$P13/Default/Preferences" "$WORK/pref13.orig" && [ -s "$WORK/args-d1badjson" ]; then
  ok "13 invalid Preferences left byte-identical, Chrome still starts"
else
  bad "13 invalid Preferences handling"
fi

# 14: nothing to reset -> file not rewritten (pretty-printed bytes survive);
# absent file -> nothing created
P14="$WORK/prof-clean"; mkdir -p "$P14/Default"
printf '{\n  "profile": {\n    "name": "Person 1"\n  }\n}\n' >"$P14/Default/Preferences"
cp "$P14/Default/Preferences" "$WORK/pref14.orig"
launch_sized d1clean "" "$P14"
P14b="$WORK/prof-fresh"; mkdir -p "$P14b"
launch_sized d1fresh "" "$P14b"
if same "$P14/Default/Preferences" "$WORK/pref14.orig" && [ ! -e "$P14b/Default/Preferences" ] \
   && [ -s "$WORK/args-d1clean" ] && [ -s "$WORK/args-d1fresh" ]; then
  ok "14 Preferences without view state not rewritten; absent Preferences not created"
else
  bad "14 clean/absent Preferences"
fi

# 15: Xvfb is started through the display helper
XVFB="$BC/start-xvfb.sh"
cat >"$WORK/xvfb-stub" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$STUB_ARGS"
EOF
chmod +x "$WORK/xvfb-stub"
x_ok=1
if [ -f "$XVFB" ]; then
  env -u BROWSER_DISPLAY_SIZE XVFB_BIN="$WORK/xvfb-stub" STUB_ARGS="$WORK/xargs-def" bash "$XVFB" >/dev/null 2>&1
  BROWSER_DISPLAY_SIZE=3840x2160 XVFB_BIN="$WORK/xvfb-stub" STUB_ARGS="$WORK/xargs-4k" bash "$XVFB" >/dev/null 2>&1
  BROWSER_DISPLAY_SIZE=1920x1200 XVFB_BIN="$WORK/xvfb-stub" STUB_ARGS="$WORK/xargs-bad" bash "$XVFB" >/dev/null 2>&1; xrc=$?
  [ "$(sed -n 1p "$WORK/xargs-def" 2>/dev/null)" = ":2" ] || x_ok=0
  tr '\n' ' ' <"$WORK/xargs-def" 2>/dev/null | grep -q -- "-screen 0 1920x1080x24 " || x_ok=0
  tr '\n' ' ' <"$WORK/xargs-4k" 2>/dev/null | grep -q -- "-screen 0 3840x2160x24 " || x_ok=0
  { [ "$xrc" -ne 0 ] && [ ! -e "$WORK/xargs-bad" ]; } || x_ok=0
  grep -q '^exec ' "$XVFB" || x_ok=0
else
  x_ok=0
fi
if [ "$x_ok" -eq 1 ]; then
  ok "15 start-xvfb.sh: :2 at the helper's size, invalid size refused, execs Xvfb"
else
  bad "15 start-xvfb.sh"
fi

echo "launch-args: $PASS passed, $FAIL failed, $SKIP skipped"
[ "$FAIL" -eq 0 ]
