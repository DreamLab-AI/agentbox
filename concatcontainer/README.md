# concatcontainer — headless Concat video engine

**Status: EXPERIMENTAL, gated off, no ADR yet.** This is the minimal build-system
option, not a finished subsystem. It exists so the engine can be evaluated for real
before the ADR scopes the sidecar properly.

```bash
AGENTBOX_ENABLE_CONCAT=1 ./agentbox.sh concat up
AGENTBOX_ENABLE_CONCAT=1 ./agentbox.sh concat api '{"method":"catalogue.list","kind":"transition"}'
AGENTBOX_ENABLE_CONCAT=1 ./agentbox.sh concat down
```

## What this is

[Concat](https://github.com/jub0t/Concat) is a Rust video editor (Slint UI, FFmpeg,
whisper.cpp). It carries a crate, `concat-api`, that its own documentation calls
*"the one dispatcher every way of driving the editor without its window goes
through"* — naming the command line, a socket daemon, an MCP server and a plugin as
intended transports.

This image builds **only `concat-cli`**, the headless driver. Its `api` subcommand
speaks the Concat API as **line-delimited JSON on stdin/stdout**: one request per
line in, events and then the response per line out. The editor window is not built —
the transport is the point, and the window would pull in a GUI toolkit for nothing.

## Why an agent estate should care

Two of the 21 methods do something none of our existing video skills
(`ffmpeg-processing`, `clipcannon`, `open-montage`, `codebase-video`) can:

- **`preview.frame`** composites the true frame at a timeline instant and writes a
  PNG. An agent can *see the edit it just made* — the same verification loop
  `take_screenshot` gives the `browser` skill. Every current path is
  agent-writes-final, unverified.
- **`project.document`** + **`edit.apply`** + **`edit.undo`/`redo`** make the
  project folder a shared surface. The agent authors edits as JSON commands; a human
  opens the *same folder* in the desktop window and adjusts; the agent reads it back.
  That handoff is the actual gap in our estate.

`catalogue.list` returns every effect package *with its parameters*, explicitly so a
machine caller can build a valid chain without reading a manifest — which means MCP
tool schemas can be generated rather than hand-maintained against a v0.2.x beta.

## The licence boundary — read before writing code against this

Concat is **AGPL-3.0-or-later**, with a
[Concat Plugin Exception v1.0](https://github.com/jub0t/Concat/blob/main/LICENSE-EXCEPTIONS.md)
that names MCP integrations explicitly. Two obligations, and they are different:

**1. This image contains Concat, so the AGPL applies to it in full.** Including
section 13's source offer if the sidecar is ever made available over a network. The
corresponding source for the pinned revision is baked in at
`/usr/local/src/concat-src.tar.gz`, with the revision at `/usr/local/src/concat-rev`.
**Do not strip either.** That is the compliance artefact.

**2. Agentbox code stays an Independent Module only while it talks through the
API/IPC surface.** The exception's own wording:

> An **Independent Module** … interfaces with Concat exclusively through the Concat
> API, its plugin entry points, its command/IPC surface, or its documented file and
> project formats.

So:

| Pattern | Status |
|---|---|
| Spawn `concat-cli api` as a subprocess, pipe JSON | Independent Module ✅ |
| An MCP server in front of that subprocess | Independent Module ✅ (named in the exception) |
| Read/write Concat project folders | Independent Module ✅ (documented formats) |
| Add `concat-api` (or any `concat-*` crate) to a `Cargo.toml` | **Derivative work** ❌ |
| Vendor Concat source into an agentbox crate | **Derivative work** ❌ |

The boundary is *linking*, not proximity. This is the same arm's-length shape
`colloquy-backends` already uses to spawn `ruvector-mcp.cjs`.

## Deliberately not built yet

Each of these is a decision the ADR has to make, and building one now would
prejudge it:

- **No MCP server.** The obvious next step — the stdio line-JSON transport is
  already the shape MCP stdio uses — but the concurrency contract has to be designed
  first (below).
- **No socket/network transport, no published port.** Publishing a port is the
  moment AGPL §13 starts to bite; that should be a decision, not a side effect.
- **No manifest gate.** No `agentbox.toml` entry, no `system-manifest.js`
  catalogue row, so no apply class. `AGENTBOX_ENABLE_CONCAT=1` is a stand-in,
  following the `android` sidecar's precedent.
- **No skill.** It would be a fifth video skill; the routing boundary against
  `ffmpeg-processing` and `clipcannon` needs stating before it earns a directory row.
- **No GPU.** `concat-render`'s `gpu` feature (wgpu) is off. The CPU compositor is
  the reference implementation the GPU one must match, so headless export is correct
  either way.
- **No desktop window**, so no human timeline review yet — which is half the value.

## The concurrency constraint any transport must respect

From `concat-api/src/lib.rs`:

> One `Api` holds one session per open project folder. It is **not thread-safe by
> design**: a transport that serves several callers owns the one `Api` and
> serialises through it, the way the window's event loop does, and a long method
> blocks its caller. `Api::exporter` is the one handle that crosses threads, so a
> cancel can reach a running export.

So `export.run` blocks the dispatcher, and `export.cancel` is — in the crate's own
words — *"meaningful only from a transport that can speak while a dispatch blocks"*.
An MCP server must serialise all dispatch and hold `Api::exporter()` on a separate
thread. Get this wrong and a long export deadlocks the tool. This is the single
most important thing for the ADR to pin down.

## Open questions for the ADR

1. **Closure cost.** `concat-cli`'s direct dependencies are clean (no Slint), but
   `concat-api` → `concat-host` pulls in `concat-speech` (whisper.cpp, built from
   source by cmake; sherpa-onnx) and `concat-vision` (ONNX Runtime via `ort`).
   Measure the real build time and image size before deciding whether this belongs
   in its own container or could ever be a supervised program.
2. **Wire-format stability.** `API_VERSION` exists in `concat-api/src/message.rs`,
   which is a good sign, but the compatibility policy is unread and the project is
   v0.2.2 beta. Pin the revision; decide the upgrade discipline.
3. **CPU-only export throughput.** Determines whether the `gpu` feature is optional
   or effectively mandatory, and therefore whether this needs a GPU reservation.
4. **Whether the human timeline pane is in scope** (the `concat` window binary over
   VNC, sharing the project volume) or whether the agent path alone is the product.
5. **Project-volume boundary** — where project folders live so both this sidecar
   and a human's window see identical paths.

## Build

Pinned revision, set in `docker-compose.concat.yml` via `CONCAT_REV`. Build
prerequisites (Rust 1.93, FFmpeg 7+ dev libraries, cmake, a C++ compiler) come from
Concat's own `CONTRIBUTING.md`; the builder stage installs them. First build is slow
— whisper.cpp and ONNX Runtime compile from source.

The healthcheck runs `{"method":"version"}` through the real dispatcher rather than
probing liveness, so a pass means the API answers.
