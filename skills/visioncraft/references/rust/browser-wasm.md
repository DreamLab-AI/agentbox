# Browser targets: Rust compiled to WebAssembly

Independently written VisionCraft guidance (MIT OR Apache-2.0). Read it with
[steering.md](steering.md) whenever new or changed code will run in a browser.

## 1. Default: logic in Rust, a thin JavaScript host

When code targets a browser, write its logic in Rust compiled to
`wasm32-unknown-unknown` and keep JavaScript or TypeScript to the host shim the
platform requires. Logic means anything with behaviour worth testing: domain
models and state transitions, parsing and validation, serialisation and wire
formats, geometry, layout and simulation, search and filtering, persistence
schemas and migrations, and cryptography through maintained crates.

The host shim is what only JavaScript can do or do cheaply:

- loading and instantiating the module, and the bundler or framework entrypoint;
- DOM, event wiring and the existing UI framework's components;
- browser APIs not yet worth binding through `web-sys` for this change, such as
  a single `fetch` call or a framework-owned router;
- handing typed arrays and handles across the boundary.

The shim calls into Rust and renders what Rust returns. If a shim function
starts to branch on domain state, that logic belongs in the crate.

This is a priority, not a licence to rewrite. The [port guide](port.md#0-establish-the-benefit-and-boundary)
still applies: port existing browser code when a change already touches its
logic or a maintenance, correctness or performance need justifies it, and
record the reason. Leave thin wrappers over a JavaScript-only library (a
charting package, an editor component, a vendor SDK) in JavaScript. An existing
project's UI framework stays; the default moves the logic beneath it.

## 2. Shape of the crate

- One crate per coherent browser capability, `crate-type = ["cdylib", "rlib"]`.
  The `rlib` lets native `cargo test` exercise the same logic without a browser.
- Keep the core pure: no clock, randomness, storage or network in the domain
  types. Pass time, seeds and fetched bytes in; return values or commands out.
  The same core then builds for `wasm32` and native, and tests run natively.
- Put `wasm-bindgen` exports in a thin `wasm` module behind
  `#[cfg(target_arch = "wasm32")]` or a feature. Export a small, coarse API:
  a few calls that each do meaningful work, not a getter per field.
- Cross the boundary with owned, simple data: numbers, strings, typed arrays,
  or `serde` structures through `serde-wasm-bindgen`. Return `Result<T, JsError>`
  so failures arrive as JavaScript exceptions with a message, never as a panic.
  Install `console_error_panic_hook` in debug builds only.
- Enable only the `web-sys` features you call. Each one adds bindings and size.
- Release profile: `opt-level = "z"` or `"s"`, `lto = true`,
  `codegen-units = 1`, and `wasm-opt` from the bundler or `wasm-pack` pipeline.
  Set a size budget for the `.wasm` and check it.
- Hot paths that touch many elements (particles, graph layouts, meshes) should
  share a `Float32Array` view over wasm memory rather than copy per frame.
  Re-create the view after any call that can grow memory.

## 3. Toolchain

Use what the project already ships. Common pairings:

| Host | Build | Notes |
|---|---|---|
| Vite/React or another JS framework | `wasm-pack build --target web` or `wasm-bindgen` CLI, then `vite-plugin-wasm` | A small typed bridge module owns `init()` and re-exports the API |
| Rust-only front end | `trunk` with Leptos, Yew, Dioxus or plain `web-sys` | Suitable when there is no existing JS shell to keep |
| Worker or WebGPU compute | `wasm-bindgen` with `--target web`, or `wgpu` | Keep GPU resource ownership on one side of the boundary |

Pin `wasm-bindgen` to the same version as the CLI that generates the bindings;
a mismatch fails at load time, not compile time. Add `wasm32-unknown-unknown`
to the toolchain file or CI matrix so the target builds on every change.

## 4. Evidence

Treat the wasm target as a supported configuration with its own gates:

1. `cargo test` on the native core for logic and edge cases.
2. `cargo build --target wasm32-unknown-unknown --release` (or the project's
   wasm build) on every change to the crate, plus `cargo clippy` for that target.
3. `wasm-bindgen-test` for behaviour that depends on browser APIs, run headless.
4. At least one real browser journey through the actual bundle: load, call the
   exported API, observe the rendered result. Use the host's browser tooling.
5. The `.wasm` size against its budget, and a load-time observation where
   start-up matters.

Report a missing wasm build or browser run as a visible non-pass. Native tests
alone do not show that the module loads, that bindings match, or that the
shim calls it correctly.

## 5. When JavaScript stays the right answer

Record the reason when you choose JavaScript or TypeScript for browser logic.
Acceptable reasons include: the code is only glue around a JavaScript-only
library; the logic is a few lines whose wasm start-up and boundary cost would
exceed its work; the project or its users cannot accept a wasm build step; or a
deadline-bound fix should not carry a port. Familiarity alone is not a reason.
