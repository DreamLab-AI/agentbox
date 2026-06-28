# Full-Stack Reference — Server Functions, SSR, Islands, Routing, Auth, Deploy

> Anchored to Leptos **0.7/0.8**. Verify signatures against `docs.rs/leptos_axum`,
> `docs.rs/server_fn`, and `book.leptos.dev` for your pin.

---

## 1. Server functions (`#[server]`)

`#[server]` compiles to **two** paths: under `ssr` the body is a real async fn registered as an
HTTP **POST endpoint**; under `hydrate`/`csr` the body is replaced with a request stub that
(de)serialises args/return. The call site is identical — a normal `async fn` you `.await`.

```rust
use leptos::prelude::*;

#[server]
pub async fn save_post(title: String, body: String) -> Result<i64, ServerFnError> {
    // SERVER-ONLY body. Context is provided by the integration (see §below).
    let pool = expect_context::<sqlx::PgPool>();
    let id = sqlx::query_scalar!("INSERT INTO posts(title,body) VALUES($1,$2) RETURNING id", title, body)
        .fetch_one(&pool).await
        .map_err(|e| ServerFnError::ServerError(e.to_string()))?;
    Ok(id)
}
```

Rules:
- Args + return must be `serde::Serialize + DeserializeOwned`.
- **Use `i32`/`i64`, not `usize`/`isize`** — 32-bit WASM vs 64-bit server mismatch silently breaks deserialisation.
- `#[server]` fns are **public HTTP endpoints**. The macro only strips the *body* in WASM builds — the signature + URL remain public. **Authenticate inside the body; never return secrets/raw PII.**

### Macro params + encodings
```rust
use server_fn::codec::{Cbor, GetUrl, StreamingText};

#[server(name = SavePostArgs, prefix = "/api", endpoint = "posts/save", input = PostUrl, output = Json)]
pub async fn save_post(title: String) -> Result<(), ServerFnError> { Ok(()) }

#[server(input = Cbor, output = Cbor)]               // binary, efficient for big payloads
pub async fn bulk(ids: Vec<i64>) -> Result<Vec<Record>, ServerFnError> { todo!() }

#[server(input = GetUrl, output = Json)]             // GET — cacheable, bookmarkable
pub async fn search(q: String, page: u32) -> Result<Hits, ServerFnError> { todo!() }
```
Codecs: POST `Json`/`Cbor`/`Rkyv`/`Bitcode`/`MsgPack`/`Postcard`/`SerdeLite`; GET `GetUrl`;
plus `MultipartFormData`, `Streaming`, `StreamingText`. Without `endpoint`, cargo-leptos appends
a path hash (disable with `disable-server-fn-hash = true` + `server-fn-mod-path = true`).

### Custom error types (0.8+)
0.8 replaces the old `ServerFnError<E>` constraint with the `FromServerFnError` trait:
```rust
use server_fn::error::FromServerFnError;
use server_fn::codec::JsonEncoding;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum AppError { NotFound, Unauthorized, Db(String) }

impl FromServerFnError for AppError {
    type Encoder = JsonEncoding;
    fn from_server_fn_error(e: server_fn::error::ServerFnErrorErr) -> Self { AppError::Db(e.to_string()) }
}
#[server]
pub async fn get_user(id: i64) -> Result<User, AppError> { /* ... */ }
```
Note `leptos_axum::extract()` still yields `ServerFnError` in 0.8 — `.map_err(AppError::from_server_fn_error)` at the boundary.

### Feature-gating server-only code
```rust
#[cfg(feature = "ssr")]
use my_crate::db::Pool;     // server-only imports MUST be cfg-gated or WASM build fails

#[component]
fn Admin() -> impl IntoView {
    #[cfg(feature = "ssr")]
    { /* compiled away in WASM — but the URL/signature of any #[server] fn stays public */ }
    view!{}
}
```

---

## 2. Cargo / cargo-leptos config & feature triad

`ssr`, `hydrate`, `csr` are **mutually exclusive**; `default = []`. cargo-leptos builds the lib
with `hydrate` and the bin with `ssr` in **separate** invocations — activating two at once breaks.

```toml
# workspace Cargo.toml
[[workspace.metadata.leptos]]
name = "myapp"
bin-package = "server"            # crate with fn main()  (features = ["ssr"])
lib-package = "frontend"          # WASM crate           (features = ["hydrate"])
site-addr   = "127.0.0.1:3000"
reload-port = 3001
style-file  = "style/main.scss"
# tailwind-input-file = "style/tailwind.css"  # if using Tailwind
```
```toml
# app/Cargo.toml
[features]
default = []
hydrate = ["leptos/hydrate", "leptos_router/hydrate", "leptos-use/hydrate"]
ssr     = ["leptos/ssr", "leptos_router/ssr", "leptos-use/ssr", "dep:leptos_axum", "dep:sqlx"]
```
Full reference + workspace layout in `tooling.md`.

---

## 3. Rendering modes

| Scenario | Mode | `SsrMode` |
|---|---|---|
| Admin tool, no SEO | CSR (Trunk) | — |
| Default full-stack, best TTFB+TTI | Out-of-order streaming | `OutOfOrder` (default) |
| Critical data in `<head>` (OG/meta) | All resources resolved before first byte | `Async` |
| Stream but keep source order | Pause stream at each `<Suspense>` | `InOrder` |
| One critical section in initial HTML, rest streams | Blocking + out-of-order mix | `PartiallyBlocked` (+ `Resource::new_blocking`) |
| Build-time static | Render once at build | `Static(StaticRoute::new())` |
| Content-heavy, minimal JS | **Islands** | `islands` feature |

```rust
use leptos_router::SsrMode;
<Routes fallback=|| "404">
    <Route path=path!("/")         view=Home />                          // OutOfOrder
    <Route path=path!("/blog/:id") view=BlogPost ssr=SsrMode::PartiallyBlocked />
    <Route path=path!("/about")    view=About    ssr=SsrMode::Static(StaticRoute::new()) />
    <Route path=path!("/admin")    view=Admin    ssr=SsrMode::Async />
</Routes>
```

### Islands architecture (biggest WASM-size win)
Enable `leptos/islands`; replace `hydrate_body(App)` with `hydrate_islands()`; add
`islands=true` to `<HydrationScripts/>`. Components are server-rendered (zero client JS) unless
marked `#[island]`.
```rust
#[component]                       // server-only: direct DB access, no #[server] needed
fn PostList() -> impl IntoView {
    let pool = expect_context::<PgPool>();
    /* render server-side */ view!{ <ul/> }
}
#[island]                         // compiled to WASM — the only interactive part
fn LikeButton(post_id: i64, initial: i32) -> impl IntoView {
    let (likes, set) = signal(initial);
    let like = ServerAction::<LikePost>::new();
    view! { <button on:click=move |_| { like.dispatch(LikePost{post_id}); set.update(|n| *n+=1); }>
        "Like (" {likes} ")"</button> }
}
```
`#[island]` props must be `Serialize + DeserializeOwned` (serialised into HTML attributes). Pass
server-rendered markup via a `children: Children` prop to keep render logic out of WASM.
Documented sizes: static 24 kB → +1 island 166 kB vs equivalent full-hydration app 274–400 kB.

---

## 4. Data loading

```rust
// Re-fetches when the source signal changes
let data = Resource::new(move || id.get(), |id| async move { fetch(id).await });
// Blocks SSR stream until resolved (pair with SsrMode::PartiallyBlocked)
let critical = Resource::new_blocking(move || id.get(), |id| async move { load(id).await });
// Fire-once, no reactive source
let cfg = OnceResource::new(async move { load_config().await });
// Client-only (!Send APIs, browser storage)
let local = LocalResource::new(move || async move { read_local_storage() });
```
`Resource` serialises its resolved value into the SSR stream, so the client **deserialises**
rather than re-fetching on hydration. Read with `move || data.read()` / `move || data.get()` →
`Option<T>` (`None` = pending), inside a `<Suspense>`/`<Transition>` (see `reactivity.md`).

### Actions & forms (mutations + progressive enhancement)
```rust
let save = ServerAction::<SavePost>::new();
save.dispatch(SavePost { title: "Hi".into(), body: "…".into() });
save.pending();  // ReadSignal<bool>   save.value(); // RwSignal<Option<Result<…>>>
```
```rust
// <ActionForm> works WITHOUT JS (full page POST + redirect) and WITH JS (intercepted, reactive).
#[server]
pub async fn create_todo(title: String) -> Result<(), ServerFnError> {
    db_insert(&title).await?;
    leptos_axum::redirect("/todos");   // post-redirect-get
    Ok(())
}
#[component]
fn TodoForm() -> impl IntoView {
    let action = ServerAction::<CreateTodo>::new();
    view! {
        <ActionForm action>
            <input type="text" name="title"/>   // name MUST match the server-fn arg
            <button type="submit">"Add"</button>
        </ActionForm>
        <Show when=move || action.pending().get()><p>"Saving…"</p></Show>
    }
}
```
`<ActionForm>` requires the default `PostUrl` encoding (it degrades to a native HTML form).
Optimistic UI: render `action.input().get()` immediately while a `Resource` keyed on
`action.version()` refetches.

---

## 5. Routing (leptos_router 0.7+ API)

```rust
use leptos_router::components::{Router, Routes, Route, ParentRoute, A, Outlet};
use leptos_router::path;

view! {
    <Router>
        <nav><A href="/contacts">"Contacts"</A></nav>
        <Routes fallback=|| view!{ <h1>"404"</h1> }>
            <Route path=path!("/")      view=Home />
            <ParentRoute path=path!("/contacts") view=ContactsLayout>
                <Route path=path!("")    view=|| view!{ <p>"Select one"</p> } />
                <Route path=path!(":id") view=ContactDetail />     // nested → renders in <Outlet/>
            </ParentRoute>
            <Route path=path!("/*any") view=NotFound />
        </Routes>
    </Router>
}
#[component] fn ContactsLayout() -> impl IntoView { view!{ <div><ContactList/><Outlet/></div> } }
```
0.7 changes: `path!()` macro replaces bare strings; `<ParentRoute>` + explicit `<Outlet>`
replace nested `<Route>`; `<Routes fallback=…>` is required; `ssr=` is a prop.

### Params & queries
```rust
use leptos::Params;
use leptos_router::hooks::{use_params, use_query, use_navigate};

#[derive(Params, PartialEq, Clone)] struct P { id: Option<i64> }
let params = use_params::<P>();   // Memo<Result<P,_>>
let id = move || params.read().as_ref().ok().and_then(|p| p.id).unwrap_or(0);
// Untyped: use_params_map() / use_query_map() → Memo<ParamsMap>
let nav = use_navigate();  nav("/login", Default::default());
```

### Protected routes (no built-in guard)
```rust
#[component]
fn AuthGuard(children: ChildrenFn) -> impl IntoView {
    let auth = OnceResource::new(async move { check_auth().await });
    let nav = use_navigate();
    view! { <Suspense fallback=|| ()>{move || auth.read().map(|ok| {
        if ok { children().into_any() }
        else { nav("/login", Default::default()); ().into_any() }
    })}</Suspense> }
}
```

---

## 6. Auth & sessions

```rust
// main.rs (ssr) — axum-session + axum-session-auth layered under the leptos routes
let app = Router::new()
    .route("/api/*fn_name", post(handle_server_fns_with_context(move || provide_context(pool.clone()))))
    .leptos_routes_with_context(&opts, routes, move || provide_context(pool.clone()), || view!{ <App/> })
    .layer(AuthSessionLayer::<User, i64, SessionSqlitePool, SqlitePool>::new(Some(pool.clone())))
    .layer(SessionLayer::new(session_store))
    .fallback(file_and_error_handler)
    .with_state(opts);
```
```rust
// Inside a server fn — pull request-scoped extractors
use leptos_axum::extract;
#[server]
pub async fn current_user() -> Result<Option<User>, ServerFnError> {
    let auth: AuthSession<User, i64, SessionSqlitePool, SqlitePool> =
        extract().await.map_err(|e| ServerFnError::ServerError(e.to_string()))?;
    Ok(auth.current_user)
}
// Needs State<T>? → extract_with_state(&leptos_options).await
```
Prefer leptos-use SSR-safe helpers over raw `web_sys`: `use_cookie::<T, JsonSerdeCodec>("k")`,
`use_window()`, `use_document()` (all return `Option<_>` and are SSR-safe).

---

## 7. Hydration bugs (deterministic-render discipline)

Hydration walks server DOM and client vDOM in lockstep — any structural difference panics or
corrupts silently. Root causes → fixes:

1. **Environment-divergent render** — `cfg!(target_arch="wasm32")` branching during render. Remove it; put client-only work in `Effect::new`. (`cfg!` is a *runtime bool* — both branches compile and must render identically. Use compile-time `#[cfg(...)]` to drop a branch.)
2. **Invalid HTML nesting** — `<div>` inside `<p>`, or `<tr>` without `<tbody>` (browser auto-inserts `<tbody>`). Emit valid, explicit markup.
3. **Browser APIs during SSR** — `web_sys::window()`/`document()`/`localStorage` panic on the server. Wrap in `Effect::new`, or use `use_window()`/`use_document()`.
4. **Resource read in an effect before `<Suspense>` resolves** — wrap reads in `<Suspense>`, or use `LocalResource` for client-only data.
5. **`<Suspense>` above `<Routes>`** — keep all `<Suspense>` boundaries *inside* route views.

Debug: in devtools, the mismatch is usually one element *above* the panic site — compare actual vs expected subtree.

---

## 8. Deployment

```dockerfile
# multi-stage
FROM rust:slim AS builder
RUN rustup target add wasm32-unknown-unknown && cargo install --locked cargo-leptos
WORKDIR /app
COPY . .
RUN cargo leptos build --release
FROM debian:stable-slim AS runtime
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/myapp ./myapp
COPY --from=builder /app/target/site          ./site
ENV LEPTOS_SITE_ADDR=0.0.0.0:8080 LEPTOS_SITE_ROOT=site
EXPOSE 8080
CMD ["./myapp"]
```
```rust
// main.rs (ssr)
#[tokio::main] async fn main() {
    let conf = get_configuration(None).unwrap();   // sync in 0.7+
    let opts = conf.leptos_options.clone();
    let routes = generate_route_list(App);
    let app = Router::new()
        .route("/api/*fn_name", post(handle_server_fns))
        .leptos_routes(&opts, routes, || view!{ <App/> })
        .fallback(file_and_error_handler)   // tower_http ServeDir over LEPTOS_SITE_ROOT
        .with_state(opts.clone());
    let l = tokio::net::TcpListener::bind(opts.site_addr).await.unwrap();
    axum::serve(l, app).await.unwrap();
}
```

| Target | How |
|---|---|
| Fly.io / Railway / VPS | Dockerfile above |
| AWS Lambda | `cargo-lambda` + `leptos-rs/start-aws`; stateless only |
| Cloudflare Workers | `wasm32-unknown-unknown`; all deps WASM-compatible |
| Spin (WASI) | `wasm32-wasip1`; `spin.toml` for routing |

Env: `LEPTOS_SITE_ADDR` (`127.0.0.1:3000`), `LEPTOS_SITE_ROOT` (`site`), `LEPTOS_SITE_PKG_DIR`
(`pkg`), `LEPTOS_OUTPUT_NAME`, `LEPTOS_RELOAD_PORT` (`3001`).

**Sources:** [server functions](https://book.leptos.dev/server/25_server_functions.html) · [#[server] macro](https://docs.rs/leptos/latest/leptos/attr.server.html) · [server_fn::codec](https://docs.rs/server_fn/latest/server_fn/codec/index.html) · [islands](https://book.leptos.dev/islands.html) · [SSR modes](https://book.leptos.dev/ssr/23_ssr_modes.html) · [hydration bugs](https://book.leptos.dev/ssr/24_hydration_bugs.html) · [resources](https://book.leptos.dev/async/10_resources.html) · [ActionForm](https://book.leptos.dev/progressive_enhancement/action_form.html) · [routes](https://book.leptos.dev/router/16_routes.html) · [params](https://book.leptos.dev/router/18_params_and_queries.html) · [leptos_axum](https://docs.rs/leptos_axum/latest/leptos_axum/) · [deployment](https://book.leptos.dev/deployment/ssr.html)
