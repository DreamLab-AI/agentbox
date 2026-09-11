# Render an explanatory shot

## Runtime selection

The inspected baseline is Manim Community 0.21.0, Python >=3.11. Its dependencies
include Cairo/Pango for drawing/text and PyAV for encoding. TeX plus `dvisvgm`
is needed for `Tex`/`MathTex`; ordinary `Text` uses Pango. Optional Typst support
is a separate dependency. Start with text and geometry for the smoke test.
Check [upstream installation](https://docs.manim.community/en/stable/installation.html)
when changing the baseline.

Use a pinned environment outside the target source tree. Where Cairo/Pango
development dependencies already exist:

```bash
uv venv /absolute/shot/.venv --python 3.12
uv pip install --python /absolute/shot/.venv/bin/python 'manim==0.21.0'
uv pip freeze --python /absolute/shot/.venv/bin/python > /absolute/shot/requirements.freeze.txt
```

The freeze records a trial environment. For repeated production, resolve and
commit a `uv.lock` with the shot's project dependencies and use frozen sync.
Native libraries and fonts need pinning too; a Python lock alone is incomplete.
If native headers are missing, use the official container instead of repairing
the running Agentbox environment. The inspection machine had no Manim executable
and `pkg-config` could not resolve Cairo/Pango.

The smoke-tested image is:

```text
manimcommunity/manim@sha256:89ab433ce59134a4dcf351deb2511e067ab354393c0bb7d1859f3e8f0b2406a3
```

It was resolved from `manimcommunity/manim:v0.21.0` on 2026-09-11. Record the
platform as well as the digest when reproducing a render. It is an optional
download; the seed does not add it to the Agentbox base image.

## Local render commands

Copy `assets/queue_demo.py` from this skill into a new shot directory. Run the
following there, using the selected environment's `manim` executable:

```bash
manim --renderer cairo -ql --fps 24 --save_sections \
  --media_dir ./preview queue_demo.py QueueDemo
manim --renderer cairo -r 1920,1080 --fps 24 \
  --media_dir ./final queue_demo.py QueueDemo
manim --renderer cairo -s -r 1920,1080 \
  --media_dir ./still queue_demo.py QueueDemo
```

Omit `-p` in a headless environment. Use fresh output directories for review
iterations. Read the resulting paths from the render log and section index;
do not guess paths from the quality label when fps/resolution are overridden.
`-s` exports the final state. For an intermediate still, end a separate scene at
the intended semantic state or extract its documented frame from the clip.

## Container execution with a remote Docker daemon

Bind mounts resolve on the Docker daemon's host. Use `docker cp` when the
Agentbox filesystem and Docker host do not share paths. Choose a unique container
name, create it with the pinned image and this command:

```text
manim --renderer cairo -ql --fps 24 --save_sections --media_dir /tmp/media /tmp/queue_demo.py QueueDemo
```

Create with `--network none`; copy the scene to `/tmp/queue_demo.py`, start with
`docker start -a`, save its log, inspect `.State.ExitCode`, and copy `/tmp/media`
back to the shot directory. Preserve the receipt before removing that specific
container. No GPU or running sidecar is needed for this Cairo example.

## Verification and receipts

Probe each exported clip:

```bash
ffprobe -v error -show_streams -show_format -of json /absolute/shot/clip.mp4
```

Check dimensions, fps, pixel format, duration and decodability. For section
exports, inspect the JSON index and verify each referenced video exists. Empty
sections can be omitted upstream; do not assume a one-to-one mapping with calls.
Play all transitions and inspect the overview, each changed count/state and
the final frame. Check the composed delivery as well as the standalone clip.

Record scene/config/input/font hashes, Manim/Python versions, image digest or
lockfile, renderer, random seed if used, command, exit code, render duration,
output probe and asset hashes in `render-receipt.json`. Record editorial findings
separately. Stable source/timing is the aim; do not promise byte-identical MP4s
across platforms, fonts or encoder versions.
