# Rune: a Rust-native UI for desktop and browser

Independently written VisionCraft guidance (MIT OR Apache-2.0). Read it with
[browser-wasm.md](browser-wasm.md) when a user interface itself, not only the
logic beneath it, may be written in Rust. Rune is
[anomalyco/rune](https://github.com/anomalyco/rune) (MIT): a GPU-rendered UI
framework on `wgpu` and `winit` with its own layout, text, springs and
renderer, targeting macOS, Windows, Linux and, experimentally, the browser.
Facts below were checked against Rune revision
`781e2b6d87cd5f32d6f4365956fad4baaf24ee50` (2026-11-06). Rune is pre-release;
re-read its `README.md`, `WEB.md` and `CHANGELOG.md` at the revision you pin.

## 1. When Rune is the right shell

[browser-wasm.md](browser-wasm.md) moves logic into Rust and keeps the
project's existing UI framework. Rune is the option when the view layer
should be Rust as well and no JavaScript shell needs to be kept.

| Choose Rune when | Choose a JS host or a DOM-based Rust framework when |
|---|---|
| The surface is an app-like tool, panel, editor, dashboard or visualisation | The surface is documents or content: articles, forms-heavy flows, anything needing browser find, text selection across the page, SEO or links that behave like links |
| One Rust crate should ship a desktop app and a web build from the same views | An existing React, Vue, Leptos, Yew or Dioxus shell already owns the product (§1 of browser-wasm.md: it stays) |
| Motion, GPU effects or 120 Hz interaction quality matter | Screen-reader support on the web is a requirement (see §4) |
| Agents should verify UI changes headlessly through PNGs, element trees and scripted input | Users may lack WebGPU and the opt-in WebGL2 fallback has not been proven for the app |

Rune can also be mounted into one canvas of an existing page (§3), so a
JavaScript application can host a Rune panel without porting the rest. Record
the reason for the choice in the same way browser-wasm.md §5 requires.

## 2. Dependency and naming traps

- **Not on crates.io.** The registry's `rune` crate is an unrelated embeddable
  scripting language. Depend on Rune by git with an exact `rev` from its `dev`
  branch, which upstream keeps fast-forward-only so a pinned revision remains
  fetchable. Never write `rune = "0.x"`; that resolves to the wrong project.
- **Bump deliberately.** Treat a `rev` change as a dependency upgrade: read the
  changelog between the two revisions, rerun every gate in §5 and record the
  old and new revisions.
- **Same name, other tools.** A host may ship an unrelated `rune` executable on
  `PATH`. Rune the framework has no installed CLI; its tooling flags belong to
  your app's own binary (§5).
- **Literal-constructed types.** Rune apps build some types such as `AppSpec`
  and `Env` as struct literals with `..AppSpec::new(..)`, so a Rune upgrade can
  add a field and break the build. Fix it at the upgrade, not by forking.

## 3. Crate shape for desktop and web

Use the scaffold in [`assets/rune-web/`](../../assets/rune-web/) as the
starting point. It is a working crate whose files carry a `.tmpl` suffix so that
they are never picked up as a nested Cargo package. Copy `Cargo.toml.tmpl` to
`Cargo.toml`, `lib.rs.tmpl` to `src/lib.rs` and `main.rs.tmpl` to `src/main.rs`,
then rename the package. It applies browser-wasm.md §2 to Rune:

- `crate-type = ["cdylib", "rlib"]`: the browser bundle uses the cdylib; native
  tests and the desktop/headless binary share the rlib.
- A `core` module with no Rune types holds state and transitions. Plain
  `cargo test` covers it, and the view only renders it.
- One `spec()` function builds the `AppSpec`, including named `scenes` for
  headless captures. `start()` calls `rune::run(spec())` and carries
  `#[wasm_bindgen(start)]` on `wasm32` only; `main.rs` calls the same `start()`.
- `wasm-bindgen` is a `wasm32`-only dependency pinned with `=` to the installed
  `wasm-bindgen` CLI version.
- Keep Rune's `dev`, `hot` and `native-file-dialog` features off for wasm, and
  put native filesystem, process and thread dependencies behind
  `cfg(not(target_arch = "wasm32"))`. Use `rune::time::Instant` for deadlines.
- Give interactive elements a stable `key`, a `role`, a `label` and, where it
  applies, `checked` or `focusable`. Keys are how tests, scripts and element
  trees address the UI; roles and labels feed native accessibility.

**Mounting in a page.** By default Rune creates a full-viewport canvas. To host
it in an existing page or single-page-app route, use `App::canvas_id("id")`
with either `fit_content_height()` (inline, page keeps scrolling) or
`full_viewport()`, keep its `AppHandle` (`app.handle()`), and call `quit()` when the
route unmounts. One Rune app runs per page at a time.

**Building.** Rune's `scripts/web-build.sh PACKAGE --out DIR` produces a static
folder (`index.html`, `app.js`, `app_bg.wasm`, `snippets/`). Use it from a
checkout of the same Rune revision. It calls `rustup which cargo`; on a host
without rustup, set `CARGO=$(command -v cargo)`. `--dev --watch` gives fast
rebuilds with page reload; never ship a `--dev` build. Serve the whole folder
with `.wasm` as `application/wasm`; WebGPU needs HTTPS except on `localhost`.

## 4. Web-target limits to state up front

At the checked revision the web target renders one canvas through WebGPU.
Rune's `webgl` feature (off by default) falls back to WebGL2 when no WebGPU
adapter is found; `WEB.md`'s scope paragraph still describes WebGL as later
work, so prove the fallback in a browser before relying on it. The web target
has no DOM accessibility mirror, so assistive technology does not see the
element tree on the web even though native builds expose it through AccessKit.
It also has no extra windows, overlays, native menus, networking layer, native
audio/video or hot patching. Fonts are bundled, not discovered: emoji and CJK
need font bytes in `AppSpec::fonts`. Expect a multi-megabyte `.wasm`: the
scaffold measured about 10.9 MB raw and 2.8 MB gzip at the checked revision
before `wasm-opt`. Set a budget and check it (browser-wasm.md §4).

## 5. Evidence

Rune's headless tooling lets an agent check UI work without a display. Extend
browser-wasm.md §4 with:

1. **Native core tests**: `cargo test` on `core`.
2. **View tests through `rune::Runtime`**: construct
   `Runtime::new(state, view, size, Env { .. })`, call `frame`, locate elements
   with `find("key")`, drive `pointer_down`/`pointer_up`, then assert on
   `rt.state` and on what is mounted. This exercises the real view and hit
   testing without a GPU.
3. **Headless renders** from the app binary, on a host with a working GPU
   adapter: `--snap out.png --scene NAME`, `--tree tree.json` (keys, roles,
   labels, rects, colours) and `--script smoke.json` with `tap`, `type`, `key`
   and `mark` events. Read the PNG and the tree; a successful exit alone is not
   visual evidence. Motion changes can use `rune::motion_gate` in a test.
4. **wasm gates**: `cargo clippy --target wasm32-unknown-unknown -- -D warnings`
   and the `web-build.sh` release build, with the printed raw and gzip sizes.
5. **A real browser journey** through the built folder: load it, confirm a GPU
   adapter and no console errors, tap a keyed control and observe the change.
   Use the host's browser tooling. Rune's `scripts/web-smoke.mjs` is a fuller
   proof where Playwright is permitted.

If the environment has no usable GPU adapter, steps 3 and 5 are visible
non-passes, not skipped rows. Steps 1, 2 and 4 still show the logic, view
wiring and bundle; they do not show pixels or a loaded page.
