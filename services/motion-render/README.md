# motion-render

Frame-exact renderer for the agentbox `motion-designer` skill (ADR-2194).

A motion design film is one HTML page whose every frame is a pure function of time,
`window.renderAt(t)`. `motion-render` freezes that page at exact times in the browser
sidecar's Chrome and captures each frame, then hands the frames to ffmpeg.

No browser runs in the agentbox container. The binary drives the sidecar over raw CDP on
one WebSocket, in a private browser context and a window of its own that are removed when
it exits. The sidecar cannot read this container's files, so the page's directory is served
to it for the life of the run: bound to this container's address on the shared network,
under a random path token, `GET` and `HEAD` only.

```bash
motion-render motion/index.html --out out --verify            # determinism: must print verify OK
motion-render motion/index.html --out out --stills 0.5,2,4.5  # PNG stills
motion-render motion/index.html --out out --sub 3             # full render with motion blur -> picture.mp4
motion-render motion/index.html --out out --sub 3 --from 12 --to 12.5   # re-render one range
motion-render --help
```

Environment: `BROWSER_CDP_HOST` (default `browsercontainer`), `BROWSER_CDP_PORT` (default
`9223`). `ffmpeg` must be on `PATH`.

## Page contract

| Name | Required | Meaning |
|---|---|---|
| `window.renderAt(t)` | yes, unless the page uses only CSS/WAAPI animations | draw the frame at `t` seconds |
| `window.__ready` | no | set `true` when fonts and assets are in; if defined, the render waits for it |
| `window.W`, `H`, `FPS`, `DUR` | no | defaults for size, frame rate and duration |
| `window.probe(t)` | for `--probe` | an object of numbers to chart per frame |

## Differences from the Node script it replaces

- Numeric options are parsed strictly: `--fps abc` is an error, not a silent default.
- `--verify` decodes and compares the two captures locally. The script did this in a
  browser page.
- The lock treats a holder as alive when `/proc/<pid>` exists, whoever owns the process.
- There is no signal handler. On interruption the socket closes, and the browser disposes
  the run's context because it was created with `disposeOnDetach`; the next run clears the
  stale lock.

## Tests

`cargo test` needs no browser and no network beyond `127.0.0.1`. Equivalence with the Node
script against a live sidecar is recorded in ADR-2194.

## Licence

MIT OR Apache-2.0. Not published to crates.io (`publish = false`).
