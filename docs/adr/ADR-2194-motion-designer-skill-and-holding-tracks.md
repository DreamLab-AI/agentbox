---
id: ADR-2194
title: Motion design films render in the browser sidecar, and a stand-in music track is marked as one
date: 2026-11-11
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: ca5b4152a7ea5d721ffa652a617970db64b4d303
verified_paths: []
owner: jjohare
review_trigger: the upstream author or licence of the imported skill becoming known; a licensed-music connector being registered in the image; a second consumer needing frame-exact page capture (extract the renderer then, not before); any holding export found outside a project folder
repo: agentbox
domain: GOVERNANCE-capabilities
relates: [ADR-2083, ADR-2150, ADR-2192, ADR-2193]
evidence_class: test+runtime
acceptance_boundary: The renderer, the audio scripts and the holding-track chain were run end to end in this container against the live browser sidecar on the bundled example (determinism check, seven stills, a 3 s motion-blurred render, freeze gate, cut, master, refusal). One full 900-frame film was rendered and mastered; nobody listened to the audio, the Rust renderer's derivation is unbuilt, and neither skill nor binary is in the baked tree until a rebuild.
---

# ADR-2194: Motion design films render in the browser sidecar, and a stand-in music track is marked as one

## Context

The operator supplied a skill archive: a skill that builds a motion graphics film as one HTML canvas file whose every frame is a pure function of time, with a determinism check, a freeze gate, beat-grid music cutting and loudness mastering. Nothing in the tree had those parts. As shipped it could not run here: it installs a local Playwright Chromium (forbidden; the image has no browser), launches with a macOS-only `--use-angle=metal` flag, and finds music through an Artlist connector this image does not have. The archive carries no licence file; the operator confirmed on 2026-11-11 that it is openly and permissively licensed. It was imported as `fable-motion-design` and renamed `motion-designer`.

## Decision

1. The skill is baked as `skills/motion-designer`, unregistered. ADR-2192 routing reaches it. Depth sits in `references/`.
2. `scripts/render.mjs` draws frames in the browsercontainer sidecar over raw CDP with Node's built-in WebSocket and no npm dependency. Each run uses a private incognito context and its own window, both disposed on exit. The page directory is served to the sidecar read-only over HTTP for the life of the run, bound to this container's address on the shared network, under a random path token, GET and HEAD only, and a request that resolves outside the served directory is answered 404 (by construction; no test exercises the refusal). A local lock allows one render at a time.
3. Music is, in order: a licensed track from the user; a licensed-music connector if one is connected; otherwise a **holding track** fetched with the baked `yt-dlp`. A holding track is a timing stand-in. It is low-passed at 7 kHz, saved as `HOLDING_<id>.wav` with a `.rights.json` record, and that record follows the audio: `music_cut.py` copies it to the mix, and `master.sh` refuses an export whose name lacks `holding`, tags the MP4 and WAV, and writes the record beside the export.
4. Fetching third-party audio as a stand-in is the operator's standing decision, recorded here (2026-11-11). It licenses nothing. A holding export is reviewed inside the project and is not published or sent to a client.
5. Provenance: imported from the operator's archive on 2026-11-11 under an open, permissive licence (operator's statement; no licence text travelled with the archive). Every script was read before use.
6. The renderer is ported to Rust as `services/motion-render` (its own crate and derivation, `lib/motion-render.nix`, MIT OR Apache-2.0, `publish = false`), synchronous, with no async runtime and no TLS. `scripts/render.mjs` stays as the fallback until the image carrying the binary is live, and is deleted after that.

## Consequences

- Until the fallback script is deleted there are three raw-CDP clients: `motion-render`, `render.mjs` and `skills/chrome-cdp/scripts/cdp.mjs` (a per-tab daemon CLI with no importable client).
- Rendering is slower than a local headless browser: 0.6 to 0.8 s per 1920x1080 frame with three sub-frames, roughly ten minutes for 900 frames. Sub-frame averaging runs in one ffmpeg pass per range, where upstream ran one per frame; the two were not compared pixel for pixel.
- The file server is reachable by any container on the shared network that learns the 128-bit token during a render.
- The sidecar must reach Google Fonts for the example's typefaces.
- The lock is local. It cannot see another container, or an agent driving the same Chrome through the `browser-gpu` MCP; the private context keeps those apart.
- `master.sh` treats audio as holding when it is named `HOLDING_*`, when its rights record says so, or when that record cannot be read. Renaming the WAV and deleting the record still defeats it. The MP4 comment tag survives a rename; neither is DRM.

## Verification

Verified on an uncommitted working tree on top of `ca5b4152a7ea5d721ffa652a617970db64b4d303`; `verified_commit` names that base and `verified_paths` is empty until the change is committed and the record re-stamped at its own commit.

- `node scripts/render.mjs <example> --verify`: `verify OK`. `--stills` at seven hits: 1920x1080 frames with the three web fonts, inspected on a contact sheet. `--dur 2 --sub 3`: 120 frames in 71 s, `picture.mp4` 2.000 s, a blurred frame differs from the unblurred one; `--from 0.5 --to 1` re-rendered 30 frames and reproduced frame 45 byte for byte. A first version of the range pass was missing and was caught in review.
- `freeze_check.sh`: `freeze check OK`. `holding_track.sh search` and `get`, `track_map.py`, `sfx.py`, `music_cut.py`: ran; mix inherits the rights record.
- `master.sh` to `demo_v1.mp4`: refused, exit 3. To `demo_holding_v1.mp4`: -14.0 LUFS, true peak -2.2 dBFS, comment tag present, `.rights.json` written. A corrupt rights record, a `HOLDING_*` file with no record, and a mix cut from one are each refused under a plain name (exit 3).
- Full film, 2026-11-11: "VisionClaw: from one note to a reviewed change", 15 s, 900 frames at 1920x1080 with three sub-frames, rendered by `render.mjs` in 564 s. `verify OK`, `freeze check OK`, contact sheets inspected and five fixes made before the full render. Mastered twice: SFX only at -14 LUFS, and with the holding track (-14.1 LUFS, true peak -2.7 dBFS, rights record written). Nobody has listened to either.
- `motion-render` against the live sidecar on that film: `verify OK`; a 30-frame motion-blurred range is byte-identical to the Node render; of five stills, three are byte-identical and two differ from the Node script's in 34 and 97 pixels by at most 2/255, cause not found (each tool reproduces its own output exactly). A 1 s render encoded to a 1.000 s `picture.mp4`; no window or lock left behind. `cargo test`: 19 passed. `cargo clippy --all-targets`: clean. The Nix derivation has not been built.
- Found by the live test, not the unit tests: endpoint discovery read to end-of-stream, and the sidecar's proxy keeps the connection open, so every run failed after 8 s. It now reads by `Content-Length`, with a test.
- `bash skills/lint-skills.sh`: clean, 134 skills. `node skills/gen-routing-table.mjs --check`: current.
- Routing: both motion-design test prompts picked `motion-designer` at scope `"all"`; the narrated-explainer prompt picked `open-montage` and the mechanism prompt `manim`.
