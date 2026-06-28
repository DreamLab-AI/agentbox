# Tooling Reference — cargo-leptos, Features, Testing, Debugging, Build Size, Migration

> Anchored to Leptos **0.8.x** (0.9.0-alpha in development). MSRV ~1.76 (nightly only for the
> `build-std` size trick). Verify against the cargo-leptos README and book for your pin.

---

## 1. Setup

```bash
rustup target add wasm32-unknown-unknown
cargo install --locked cargo-leptos     # build orchestrator (SSR/full-stack)
cargo install leptosfmt                  # formats the view! macro
cargo install wasm-pack                  # for wasm-bindgen-test
cargo install trunk                      # CSR-only alternative
# wasm-opt/binaryen: cargo-leptos auto-downloads; manual: brew/pacman install binaryen
```

### New project
```bash
cargo leptos new --git leptos-rs/start-axum            # full-stack, single crate
cargo leptos new --git leptos-rs/start-axum-workspace  # bin/lib split (production)
cargo leptos new --git leptos-rs/start-actix           # Actix backend
# Trunk CSR SPA: clone leptos-rs/start-trunk
```
Templates ship `rust-toolchain.toml`, Tailwind/SCSS, `end2end/` (Playwright), `.vscode/settings.json`,
and a correctly-wired feature triad.

### cargo-leptos commands
| Command | Does |
|---|---|
| `cargo leptos watch` | Dev server `:3000`, hot-reload, builds server + WASM in parallel |
| `cargo leptos build [--release]` | One-shot build (`--release` → uses `wasm-release` profile if set) |
| `cargo leptos serve` | Run the already-built server binary |
| `cargo leptos test` | `cargo test` on both lib + bin targets |
| `cargo leptos end-to-end` | Build, start server, run `end2end-cmd` (Playwright) |
| `cargo leptos build --release --split` | Code-split WASM (lazy loading, 0.8) |

### `[package.metadata.leptos]` (key fields)
```toml
[package.metadata.leptos]
output-name   = "myapp"            # names .wasm/.js/.css
site-root     = "target/site"      # LEPTOS_SITE_ROOT
site-pkg-dir  = "pkg"
hash-files    = true               # content-hash assets (cache-busting)
bin-features  = ["ssr"]
bin-default-features = false
lib-features  = ["hydrate"]
lib-default-features = false
lib-profile-release  = "wasm-release"   # custom size profile (see §5)
style-file           = "style/main.scss"
tailwind-input-file  = "style/tailwind.css"
assets-dir    = "assets"
site-addr     = "127.0.0.1:3000"   # LEPTOS_SITE_ADDR
reload-port   = 3001               # LEPTOS_RELOAD_PORT
server-fn-prefix       = "/api"
disable-server-fn-hash = false
end2end-cmd   = "npx playwright test"
end2end-dir   = "end2end"
js-minify     = true               # minify wasm-bindgen glue (release)
```

### Workspace split (`start-axum-workspace`)
```
my-app/
├── Cargo.toml      ← [[workspace.metadata.leptos]] lives here; resolver = "2"
├── app/            ← shared lib: components + server fns; features ssr/hydrate (optional, no default)
├── frontend/       ← WASM entry; default-features=false, features=["hydrate"]
└── server/         ← Axum bin entry; default-features=false, features=["ssr"]
```

### Trunk (CSR only)
```html
<!-- index.html -->
<link data-trunk rel="rust" data-wasm-opt="z"/>
<link data-trunk rel="scss" href="style/main.scss"/>
```
`trunk serve` / `trunk build --release`. Builds only the `csr` target.

---

## 2. Feature-flag discipline

| Feature | Target | Activates |
|---|---|---|
| `ssr` | native server bin | server code, Axum handlers, DB |
| `hydrate` | `wasm32-unknown-unknown` | client hydration + reactive DOM binding |
| `csr` | `wasm32-unknown-unknown` | client-only SPA (no SSR) |

**Rule: `default = []` always.** The three are mutually exclusive; cargo-leptos selects per
target. `app/Cargo.toml`:
```toml
[features]
default = []
hydrate = ["leptos/hydrate"]
ssr     = ["leptos/ssr", "dep:leptos_axum", "dep:tokio", "dep:sqlx"]

[dependencies]
leptos        = { version = "0.8", default-features = false }
leptos_router = { version = "0.8", default-features = false }
leptos_axum   = { version = "0.8", optional = true }
tokio         = { version = "1",   optional = true, features = ["full"] }
sqlx          = { version = "0.8", optional = true, features = ["sqlite","runtime-tokio"] }
```

| Mistake | Symptom | Fix |
|---|---|---|
| `default = ["ssr"]` | WASM build: missing symbols | remove from default |
| `use leptos_axum` un-gated | WASM compile error | `#[cfg(feature = "ssr")]` on every server-only import |
| `use leptos::*` (0.7+) | `signal`/`create_signal` not found | `use leptos::prelude::*` |
| both `ssr`+`hydrate` in lib | conflicting cfg | only `hydrate` for lib, only `ssr` for bin |
| no `resolver = "2"` in workspace | feature unification breaks deps | set it |

CI (skip impossible combos): `[package.metadata.cargo-all-features] skip_feature_sets = [["csr","ssr"],["csr","hydrate"],["ssr","hydrate"]]`.

---

## 3. Testing

**Unit-test business logic by extracting it from components** into plain structs → `cargo test`.

**In-browser component tests** (`wasm-bindgen-test`):
```rust
use leptos::prelude::*;
use wasm_bindgen_test::*;
wasm_bindgen_test_configure!(run_in_browser);

#[wasm_bindgen_test]
async fn counter_increments() {
    let doc = document();
    let wrap = doc.create_element("section").unwrap();
    doc.body().unwrap().append_child(&wrap).unwrap();
    let _g = mount_to(wrap.clone().unchecked_into(), || view!{ <Counter initial=0 step=1/> });
    let btn = wrap.query_selector("button").unwrap().unwrap().unchecked_into::<web_sys::HtmlElement>();
    btn.click();
    tick().await;                                  // ⚠️ effects are async — flush before asserting
    assert_eq!(wrap.query_selector("span").unwrap().unwrap().text_content().unwrap(), "1");
}
```
```bash
wasm-pack test --headless --firefox     # or: cargo leptos test (native + wasm)
```

**E2E (Playwright, in `end2end/`):** templates pre-wire it. `cargo leptos end-to-end` builds,
starts the server, runs `npx playwright test`.
```ts
import { test, expect } from "@playwright/test";
test("increments", async ({ page }) => {
  await page.goto("http://localhost:3000/counter");
  await page.locator("button").first().click();
  await expect(page.locator("[data-testid=count]")).toHaveText("1");
});
```

**Server fns:** under `ssr` they're plain async fns. Split logic into `_inner(deps)` taking
injected deps; test with `#[tokio::test]` against a test DB. The `#[server]` wrapper just extracts
deps from Axum state and calls `_inner`.

---

## 4. Debugging

**Add the panic hook first** (without it, panics show as "unreachable executed", no trace):
```toml
console_error_panic_hook = { version = "0.1", optional = true }
[features] hydrate = ["leptos/hydrate", "dep:console_error_panic_hook"]
```
```rust
pub fn main() { console_error_panic_hook::set_once(); leptos::mount::hydrate_body(App); }
```

**Tracing** — same `tracing::info!()` calls route to the right sink per target:
```rust
#[cfg(feature = "ssr")]    tracing_subscriber::fmt().with_env_filter(EnvFilter::from_default_env()).init();
#[cfg(feature = "hydrate")] tracing_subscriber_wasm::MakeConsoleWriter::default()
    .install_with_filter(EnvFilter::new("info")).unwrap();
```

**WASM source maps (Chrome DWARF):** `rustflags = ["-C","debuginfo=2"]` for the wasm target +
DevTools → Experiments → "WebAssembly Debugging: DWARF". Steps into Rust.

**Decoding the giant `view!` trait-bound errors:**

| Error | Cause | Fix |
|---|---|---|
| `T: IntoView not satisfied` | bare `String`/`i32` returned from a branch | `view!{ {val} }` or `.into_view()` |
| `cannot move out of … not Copy` | non-`Copy` (`Rc`/value) moved into closures | clone before, or `StoredValue`/`ArcRwSignal`; `*_local` for `!Send` |
| `missing Clone` on props | component prop struct lacks derive | `#[derive(Clone)]` or `#[prop(into)]` |
| `if`/`match` branches differ | element types differ | `Either::Left/Right` or `.into_any()` |
| borrow error in closure | non-`Copy` captured by 2 closures | `let v = v.clone(); move || …` |

**Compile speed:** cargo-leptos auto-enables `--cfg=erase_components` in dev (v0.2.40+), cutting
incremental WASM rebuild time for large apps. Disable via `disable-erase-components = true` if it
misbehaves.

---

## 5. Build & bundle-size optimisation

```toml
# Cargo.toml — size profile for the WASM lib only
[profile.wasm-release]
inherits      = "release"
opt-level     = "z"        # "s" = slightly bigger but faster
lto           = true
codegen-units = 1
panic         = "abort"    # drops unwinding (~5–10% smaller)

[package.metadata.leptos]
lib-profile-release = "wasm-release"
bin-profile-release = "release"        # server stays speed-optimised
wasm-opt-features   = ["-Oz", "--enable-bulk-memory", "--strip-debug"]
```
- **wasm-opt** auto-runs in release (~15–20% extra shrink); `--converge` for more.
- **Islands** = biggest win for content sites (~80% less WASM) — see `fullstack.md §3`.
- **Code split:** `cargo leptos build --release --split` + `#[lazy_route]` / `#[lazy]` async fns.
- **Allocator:** `wee_alloc` is unmaintained — use `lol_alloc` (`#[global_allocator]`) for ~1 kB savings.
- **Avoid `regex` in WASM** (~500 kB) — use `js_sys::RegExp` or `regex-lite`.
- **Serialization weight:** swap server-fn payload codec to `postcard` (smallest) / `rkyv` (fastest) / `bitcode`.
- **Measure:** `du -sh target/site/pkg/*.wasm`; gzip it (that's the real download); Lighthouse via the `browser` sidecar.
- **Smallest possible (nightly):** `[unstable] build-std = ["std","panic_abort","core","alloc"]`, `build-std-features = ["panic_immediate_abort"]`.

---

## 6. Migration

### 0.6 → 0.7 (the big one — tachys rewrite)
| Before | After |
|---|---|
| `use leptos::*;` | `use leptos::prelude::*;` |
| `create_signal(v)` | `signal(v)` |
| `create_rw_signal/memo/effect` | `RwSignal::new` / `Memo::new` / `Effect::new` |
| `Rc`-based primitives | signals require `Send+Sync`; `*_local` for `!Send` |
| `View` enum branching | statically typed → `Either::Left/Right` or `.into_any()` |
| `use leptos_router::*` | `use leptos_router::components::*; use leptos_router::hooks::*;` |
| `path="/foo/:id"` | `path!("/foo/:id")` (macro) or segment tuples |
| `<Routes>` no fallback | `<Routes fallback=…>` **required** |
| `get_configuration(..).await` | now **sync** |
| `mount_to_body(App)` | `leptos::mount::hydrate_body(App)` |
| `experimental-islands` | renamed `islands` |
| `Signal<T>` from `Fn` | `Signal::derive(|| …)` explicit |

### 0.7 → 0.8
- Requires **axum 0.8**.
- Custom server-fn errors → implement `FromServerFnError` (old `ServerFnError<E>` wrappers break).
- `LeptosOptions: Default` removed — construct explicitly / from config.
- `LocalResource` `.as_deref()` removed (returns `T` from `.with()`).
- `islands-router` feature → CSR-style nav in islands mode.
- `--cfg=erase_components` auto-enabled in dev; external `wasm-split` crate replaces vendored.

### 0.8 → 0.9-alpha (canary)
- Function-call signal reads (`count()` for `count.get()`) on stable Rust.
- `lazy` becomes a separate gate; some event types newly typed (e.g. `on:toggle` → `ToggleEvent`).

Read release notes: `github.com/leptos-rs/leptos/releases`. leptos-use alignment: 0.18.x → Leptos 0.8 (`leptos-use.rs/changelog.html`).

---

## 7. Formatter & editor

**leptosfmt** (`leptosfmt.toml`):
```toml
max_width = 100
attr_value_brace_style = "WhenRequired"
macro_names = ["leptos::view", "view"]
[attr_values] class = "Tailwind"   # experimental Tailwind class sorting
```
`leptosfmt ./**/*.rs` (or `--check` in CI). Needs a `rustfmt.toml` (`edition = "2021"`) present.

**rust-analyzer** (`.vscode/settings.json`):
```json
{
  "rust-analyzer.cargo.features": ["ssr"],
  "rust-analyzer.procMacro.ignored": { "leptos_macro": ["server"] },
  "rust-analyzer.rustfmt.overrideCommand": ["leptosfmt", "--stdin", "--rustfmt"],
  "rust-analyzer.check.command": "clippy",
  "[rust]": { "editor.formatOnSave": true, "editor.defaultFormatter": "rust-lang.rust-analyzer" }
}
```
Ignoring the `server` proc macro stops false errors (RA can't expand `#[server]`). Use
`"rust-analyzer.cargo.features": "all"` in the `app` crate where all features are optional.

---

## 8. Learning & exemplary repos

**Official:** [the Leptos Book](https://book.leptos.dev) · [docs.rs/leptos](https://docs.rs/leptos/latest/leptos/) · [leptos-use docs](https://leptos-use.rs) · Discord `discord.gg/YdRAhS7eQB` · [examples dir](https://github.com/leptos-rs/leptos/tree/main/examples).

**Most instructive official examples:** `counter` (signals), `todo_app_sqlite_axum` (full CRUD
SSR+hydrate), `hackernews_axum` (`<Suspense>`/`Resource`/nested routes/`<Transition>`),
`hackernews_islands_axum` (islands), `ssr_modes` (streaming modes), `server_fns_axum` (encodings/
streaming), `lazy_routes` (code splitting), `error_boundary`, `stores` (`Store<T>`).

**Real OSS apps to read:**
| Repo | Teaches |
|---|---|
| `Nutomic/ibis` | Full-stack + Diesel + ActivityPub federation; complex SSR/auth |
| `opensourcecheemsburgers/RustyTube` | One codebase → web + Tauri desktop; Tailwind/DaisyUI architecture |
| `simple-icons/simple-icons-website-rs` | Large CSR app; client-side search/filter/routing |
| `rust-dd/tryrust.org` | WebSocket server fns, code-exec, async resource management |
| `ccfddl/ccf-deadlines` | Large CSR app using a third-party UI kit (thaw) |
| `khuedoan/blog` | Minimal Leptos+Axum SSR+Tailwind — clean deployment reference |

**Sources:** [cargo-leptos](https://github.com/leptos-rs/cargo-leptos) · [book: cargo-leptos](https://book.leptos.dev/ssr/21_cargo_leptos.html) · [book: testing](https://book.leptos.dev/testing.html) · [book: binary size](https://book.leptos.dev/deployment/binary_size.html) · [v0.7 release](https://github.com/leptos-rs/leptos/releases/tag/v0.7.0) · [v0.8 release](https://github.com/leptos-rs/leptos/releases/tag/v0.8.0) · [leptosfmt](https://github.com/bram209/leptosfmt) · [start-axum-workspace](https://github.com/leptos-rs/start-axum-workspace)
