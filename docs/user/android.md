# Android (redroid) sidecar — playbook

> **Status: EXPERIMENTAL, gated off.** This sidecar runs a *privileged* Android
> container that holds a live, signed-in Google account. It is disabled by two
> independent guards and must be enabled deliberately. Read this whole page
> before enabling it.

## What it is and why it exists

A genuine, Play-Protect-**certifiable** Android 13 (x86_64) running natively on
the host kernel via `binderfs` — no KVM, no emulation, because the host is
x86_64. It boots a real Android userspace (zygote, `system_server`, GMS) with
the real Google Play Store.

Its purpose is to be a **real Play client**. Some things Google Play only does
for genuine, attested, Play-Protect-certified devices — most notably issuing a
**download token for a PAID app**. Synthetic clients (`apkeep`, `gpapi` with a
fabricated device profile) can read a purchase as "owned" on the web storefront
but get `DF-DFERH-01` (empty `buyResponse`, no delivery token) from the paid
*acquire* endpoint, while free apps deliver fine. A certified redroid client
crosses that boundary — same account, same purchase, now trusted — so you can
download and extract an app the account legitimately owns.

**Legitimate use only.** This is for extracting apps *the signed-in account has
purchased*, e.g. pulling the x86_64 Minecraft Bedrock build for
[mcpelauncher](https://minecraft-linux.github.io/) on Linux. It is not a way to
obtain apps you do not own.

## Prerequisites

1. **Host kernel exposes binder** (redroid needs it, no KVM required):
   ```bash
   grep binder /proc/filesystems      # expect: nodev  binder
   # if absent, on the host:
   sudo modprobe binder_linux devices="binder,hwbinder,vndbinder"
   ```
2. **A GApps image**, built once with
   [redroid-script](https://github.com/ayasa520/redroid-script). Stock redroid
   ships **without** Google Play; you inject MindTheGapps:
   ```bash
   git clone https://github.com/ayasa520/redroid-script && cd redroid-script
   pip install -r requirements.txt
   python redroid.py -a 13.0.0 -mtg           # stages MindTheGapps, builds image
   docker build -t redroid/redroid:13-mtg -f - . <<'DF'
   FROM redroid/redroid:13.0.0-latest
   COPY mindthegapps /
   DF
   ```
   Override the tag the sidecar uses with `ANDROID_IMAGE=...`.
   - redroid-script writes to `/tmp` and `~/.cache` — if either is a small
     tmpfs / read-only, set `XDG_CACHE_HOME` to a roomy dir and redirect the
     hardcoded `/tmp/...` `extract_to` paths, or the 198 MB GApps download
     `ENOSPC`s.

## Enable and boot

Both guards must be lifted: the compose `android` profile (baked into the
sidecar's compose args) **and** the env flag.

```bash
AGENTBOX_ENABLE_ANDROID=1 ./agentbox.sh android up
```

This starts `agentbox-android` (privileged, binder, adb on `127.0.0.1:5555`)
and waits for `sys.boot_completed`. The **full ABI triple** is passed as init
args — omitting `ro.product.cpu.abilist32` makes the 32-bit zygote SIGABRT-loop
(`Unable to determine ABI list from property ro.product.cpu.abilist32`) and
`system_server` never starts.

## Driving it headlessly

redroid has no display. Control it entirely through `docker exec` — a full
see-and-tap loop, like the browser sidecar's snapshot+click:

```bash
docker exec agentbox-android screencap -p > f.png     # SEE (720x1280 PNG)
docker exec agentbox-android input tap  <x> <y>       # TAP
docker exec agentbox-android input text 'hello'       # TYPE (single argv;
                                                      #  survives special chars)
docker exec agentbox-android logcat -d | tail          # inspect
docker exec agentbox-android dumpsys window | grep mCurrentFocus  # focused activity
```

> **adb-over-TCP note.** Containers on the default bridge are isolated from
> this one, so `adb connect 127.0.0.1:5555` may time out. `docker exec` needs
> no adb networking and is the reliable control channel.

## Certify the device (one-time, required for sign-in)

An uncertified device is refused at Google sign-in. Register its **GSF device
id** (not the SSAID):

```bash
AGENTBOX_ENABLE_ANDROID=1 ./agentbox.sh android id     # prints the GSF android_id
```

Register it at <https://www.google.com/android/uncertified> while signed into
the target Google account (the browser sidecar works for this). Then force GMS
to pick up certification and wait ~10-30 min for propagation:

```bash
docker exec agentbox-android pm clear com.google.android.gms
docker exec agentbox-android am broadcast -a android.server.checkin.CHECKIN
```

> `sqlite3` inside the image can crash; `android id` copies the db out and
> parses it on the host to avoid that.

## Sign in + install + extract

1. **Disable the AOSP SetupWizard first** — redroid has no WiFi HAL, so
   SetupWizard SIGABRTs on `WifiManager.getCurrentNetwork()` right after
   password submit and kills the sign-in. Take it out of the account-add path
   (GMS registers the account itself without it):
   ```bash
   docker exec agentbox-android pm disable-user --user 0 com.google.android.setupwizard
   ```
2. Open Play (`monkey -p com.android.vending 1` or tap the icon), tap **Sign
   in**, then drive the Google flow with `screencap` + `input`: email → NEXT →
   password → NEXT → **I agree**. Verify:
   ```bash
   docker exec agentbox-android dumpsys account | grep 'name='   # expect the account
   ```
3. Open the app listing and install (a certified, owning account shows
   **Install**, not a price):
   ```bash
   docker exec agentbox-android am start -a android.intent.action.VIEW \
     -d 'market://details?id=<package>'
   # tap Install; watch Finsky download in logcat
   ```
4. Pull and package the installed splits from `/data/app`:
   ```bash
   dir=$(docker exec agentbox-android sh -c 'dirname $(pm path <package> | head -1 | sed s/package://)')
   for f in base.apk split_config.x86_64.apk split_config.en.apk split_config.xhdpi.apk split_install_pack.apk; do
     docker cp "agentbox-android:$dir/$f" ./"$f"
   done
   ```
   For mcpelauncher you want `split_config.x86_64.apk` (native
   `lib/x86_64/libminecraftpe.so`) plus `base.apk` and the resource/`install_pack`
   splits. Feed the split set to `mcpelauncher-extract`, or merge them
   (`unzip -n` each into one tree) to get `lib/x86_64/*.so` + `assets/`.

## Teardown

```bash
AGENTBOX_ENABLE_ANDROID=1 ./agentbox.sh android down    # keeps the /data volume
docker volume rm agentbox_android-data                  # wipe the signed-in device
```

## Security notes

- The container is **privileged** and holds a **live Google session**. adb is
  bound to loopback only; never publish `5555` on `0.0.0.0`.
- Treat the `/data` volume as a secret (it contains account tokens). Wipe it
  when done, and rotate the Google account password after use.
- Keep the sidecar gated off in normal operation. Enable per-invocation with
  `AGENTBOX_ENABLE_ANDROID=1`, not by exporting it globally.
