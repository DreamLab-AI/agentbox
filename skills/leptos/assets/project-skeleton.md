# Project Skeleton — Copy-Paste Scaffold (Leptos 0.8, Axum SSR + hydrate)

Single-crate `start-axum`-style layout. Adjust versions to the current `docs.rs/leptos` release.
For a production bin/lib split, use `cargo leptos new --git leptos-rs/start-axum-workspace` and
move `[package.metadata.leptos]` → `[[workspace.metadata.leptos]]`.

---

## `Cargo.toml`

```toml
[package]
name    = "myapp"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
leptos        = { version = "0.8", default-features = false }
leptos_router = { version = "0.8", default-features = false }
leptos_meta   = { version = "0.8", default-features = false }
leptos-use    = { version = "0.18", default-features = false }
serde         = { version = "1", features = ["derive"] }

# --- server-only (optional, gated by `ssr`) ---
leptos_axum   = { version = "0.8", optional = true }
axum          = { version = "0.8", optional = true }
tokio         = { version = "1", features = ["rt-multi-thread", "macros"], optional = true }
tower         = { version = "0.5", optional = true }
tower-http    = { version = "0.6", features = ["fs"], optional = true }
tracing       = { version = "0.1", optional = true }
tracing-subscriber = { version = "0.3", optional = true }

# --- client-only (optional, gated by `hydrate`) ---
console_error_panic_hook = { version = "0.1", optional = true }
tracing-subscriber-wasm  = { version = "0.1", optional = true }
wasm-bindgen             = { version = "0.2", optional = true }

[dev-dependencies]
wasm-bindgen-test = "0.3"

[features]
default = []
hydrate = [
  "leptos/hydrate",
  "leptos_router/hydrate",
  "leptos-use/hydrate",
  "dep:console_error_panic_hook",
  "dep:tracing-subscriber-wasm",
  "dep:wasm-bindgen",
]
ssr = [
  "leptos/ssr",
  "leptos_router/ssr",
  "leptos_meta/ssr",
  "leptos-use/ssr",
  "dep:leptos_axum",
  "dep:axum",
  "dep:tokio",
  "dep:tower",
  "dep:tower-http",
  "dep:tracing",
  "dep:tracing-subscriber",
]

# Size-optimised profile for the WASM lib
[profile.wasm-release]
inherits      = "release"
opt-level     = "z"
lto           = true
codegen-units = 1
panic         = "abort"

[package.metadata.leptos]
output-name          = "myapp"
site-root            = "target/site"
site-pkg-dir         = "pkg"
hash-files           = true
assets-dir           = "public"
site-addr            = "127.0.0.1:3000"
reload-port          = 3001
bin-features         = ["ssr"]
bin-default-features = false
lib-features         = ["hydrate"]
lib-default-features = false
lib-profile-release  = "wasm-release"
tailwind-input-file  = "style/tailwind.css"
end2end-cmd          = "npx playwright test"
end2end-dir          = "end2end"

[package.metadata.cargo-all-features]
skip_feature_sets = [["ssr", "hydrate"]]
```

---

## `src/lib.rs` (hydrate entry + app root)

```rust
pub mod app;

#[cfg(feature = "hydrate")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn hydrate() {
    console_error_panic_hook::set_once();
    tracing_subscriber_wasm::MakeConsoleWriter::default()
        .install_with_filter(tracing_subscriber::EnvFilter::new("info"))
        .ok();
    leptos::mount::hydrate_body(crate::app::App);
}
```

## `src/app.rs`

```rust
use leptos::prelude::*;
use leptos_meta::{provide_meta_context, MetaTags, Stylesheet, Title};
use leptos_router::{components::{Router, Routes, Route}, path, StaticSegment};

pub fn shell(options: LeptosOptions) -> impl IntoView {
    view! {
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="utf-8"/>
                <meta name="viewport" content="width=device-width, initial-scale=1"/>
                <AutoReload options=options.clone()/>
                <HydrationScripts options/>
                <MetaTags/>
            </head>
            <body><App/></body>
        </html>
    }
}

#[component]
pub fn App() -> impl IntoView {
    provide_meta_context();
    view! {
        <Stylesheet id="leptos" href="/pkg/myapp.css"/>
        <Title text="MyApp"/>
        <Router>
            <main>
                <Routes fallback=|| view! { <h1>"404"</h1> }>
                    <Route path=StaticSegment("") view=Home/>
                </Routes>
            </main>
        </Router>
    }
}

#[component]
fn Home() -> impl IntoView {
    let count = RwSignal::new(0);
    view! {
        <h1>"Welcome to Leptos"</h1>
        <button on:click=move |_| count.update(|n| *n += 1)>
            "Count: " {move || count.get()}
        </button>
    }
}
```

## `src/main.rs` (server bin)

```rust
#[cfg(feature = "ssr")]
#[tokio::main]
async fn main() {
    use axum::Router;
    use leptos::prelude::*;
    use leptos_axum::{generate_route_list, LeptosRoutes};
    use myapp::app::{shell, App};

    tracing_subscriber::fmt::init();

    let conf = get_configuration(None).unwrap();
    let leptos_options = conf.leptos_options;
    let addr = leptos_options.site_addr;
    let routes = generate_route_list(App);

    let app = Router::new()
        .leptos_routes(&leptos_options, routes, {
            let opts = leptos_options.clone();
            move || shell(opts.clone())
        })
        .fallback(leptos_axum::file_and_error_handler(shell))
        .with_state(leptos_options);

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app.into_make_service()).await.unwrap();
}

#[cfg(not(feature = "ssr"))]
fn main() {} // the lib's hydrate() is the WASM entry point
```

---

## `.cargo/config.toml` (optional — DWARF source maps in dev)

```toml
[target.wasm32-unknown-unknown]
rustflags = ["-C", "debuginfo=2"]
```

## `rustfmt.toml` (required for leptosfmt IDE integration)

```toml
edition = "2021"
```

## `leptosfmt.toml`

```toml
max_width = 100
attr_value_brace_style = "WhenRequired"
macro_names = ["leptos::view", "view"]
[attr_values]
class = "Tailwind"
```

## `.vscode/settings.json`

```json
{
  "rust-analyzer.cargo.features": ["ssr"],
  "rust-analyzer.procMacro.ignored": { "leptos_macro": ["server"] },
  "rust-analyzer.rustfmt.overrideCommand": ["leptosfmt", "--stdin", "--rustfmt"],
  "rust-analyzer.check.command": "clippy",
  "[rust]": {
    "editor.formatOnSave": true,
    "editor.defaultFormatter": "rust-lang.rust-analyzer"
  }
}
```

## `style/tailwind.css` (Tailwind v4 + optional DaisyUI)

```css
@import "tailwindcss";
@source "./src/**/*.rs";
@plugin "daisyui" { themes: light --default, dark --prefersdark; }
```

---

## Run

```bash
cargo leptos watch                 # dev server @ http://127.0.0.1:3000 (hot reload)
cargo leptos build --release       # production build → target/site + target/release/myapp
cargo leptos test                  # native + wasm-bindgen-test
cargo leptos end-to-end            # build, serve, run Playwright
```
