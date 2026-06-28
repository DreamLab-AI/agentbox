# Ecosystem & Eye-Candy Reference — Components, Styling, Icons, Motion, Charts

> Verdicts as of mid-2026 (Leptos 0.8.x). **Maintenance is the deciding factor** — with Leptos
> itself in light-maintenance mode, prefer crates with independent active maintainers. Always
> check a crate's `Cargo.toml` for its declared Leptos version before adopting.

---

## 1. Component libraries

| Library | Styling | A11y | Leptos | Maintenance | Pick when |
|---|---|---|---|---|---|
| **Thaw UI** | Fluent CSS vars, runtime `mount_style()` | Minimal | 0.7 (`0.4.x`) / 0.8 (`0.5-beta`) | **Active** | General-purpose, Fluent/MS aesthetic, no Tailwind, SSR |
| **Leptodon** | Flowbite + Tailwind | Moderate | 0.8 (`1.4`) | **Active** (OpenAnalytics, commercial backer) | Flowbite look, long-term support confidence |
| **rust-ui/ui** | Tailwind, copy-paste registry | shadcn-level | 0.8 | Active | shadcn-style composition; you own the code |
| **leptos-shadcn-ui** (cloud-shuttle) | Tailwind + shadcn, crate-dep | Claims WCAG 2.1 AA | 0.8+ | New/unproven | Want shadcn as a dependency, not copy-paste — vet first |
| **leptos-material** | Material Web Components | MWC-level | unclear | Small | Locked to Material Design |
| **Leptix** | Unstyled (BYO) | Radix-inspired | ~0.6/0.7 | **Stalled** (last release Nov 2024) | Right idea (headless a11y primitives); watch for revival before relying |
| **leptonic** | Custom CSS vars | Some | 0.6 only | **Abandoned** | ❌ do not start new work |
| RustForWeb **shadcn-ui** | copy-paste + Tailwind | Good | 0.6/0.7 | **Archived Feb 2026** | ❌ dead (note: *other* rustforweb crates like Lucide/Floating-UI are alive) |

**Thaw** — `thaw-ui/thaw`. 60+ components (Button, Input, Select, DatePicker, Menu, Modal,
Drawer, Toast, Table, Tree, Autocomplete, Skeleton…). Runtime CSS via `mount_style()`; SSR needs
`<SSRMountStyleProvider>`. No Tailwind dependency.
```toml
thaw = { version = "0.5.0-beta", features = ["csr"] } # Leptos 0.8
```
**Leptodon** — `openanalytics/leptodon`, docs `leptodon.dev`. Most actively maintained library
with a commercial backer; Flowbite/Tailwind components.
**rust-ui/ui** — `rust-ui.com`. Not a crate: copy-paste like shadcn/ui, Tailwind, you own and
customise the source. Best "design-system ownership" route (avoids the archived rustforweb dead end).

---

## 2. Styling

```
Production SSR, live-reload CSS, type-checked classes → Stylance
Utility-first, Tailwind ecosystem                      → Tailwind CSS v4 (+ DaisyUI)
Class merging + type-safe variants                     → Tailwind Fuse (with Tailwind)
SCSS features (nesting/mixins) + scoping               → Turf
Compile-time scoped, zero WASM overhead                → Stylers
Dead simple, no toolchain                              → plain CSS via style-file
Dynamic runtime CSS-in-Rust                            → Styled (avoid in SSR-heavy apps)
```

### Tailwind CSS v4 (canonical) — **v4 dropped JS config**; content via `@source` in CSS
```toml
# cargo-leptos (SSR), workspace metadata:
[[workspace.metadata.leptos]]
tailwind-input-file = "./style/tailwind.css"
```
```css
/* style/tailwind.css */
@import "tailwindcss";
@source "./src/**/*.rs";   /* scan .rs for class names; replaces v3 `content` array */
@plugin "daisyui" { themes: light --default, dark --prefersdark; }  /* DaisyUI 5, optional */
```
```toml
# Trunk (CSR) — Trunk.toml
[tools]
tailwindcss = "4.x"
```
```html
<link data-trunk rel="tailwind-css" href="style/tailwind.css"/>
```
Perf: point Tailwind at `src/` (not the workspace root) so it doesn't scan `target/`.

### Stylance — best CSS-modules option (`basro/stylance-rs`, actively maintained)
Hashed scoped classes from `.module.css`, live reload without Rust recompile, **typos are
compile errors**.
```rust
stylance::import_style!(style, "card.module.css");
view! { <div class=style::card>"Content"</div> }
```
Run `stylance --watch` beside `cargo leptos watch`.

### Tailwind Fuse — `tw_merge!` + type-safe variants (CVA-style)
```rust
use tailwind_fuse::*;
let cls = tw_merge!("px-4 py-2", active && "bg-blue-500", "px-6"); // conflict-aware merge
#[derive(TwVariant)] #[tw(default = "md")]
enum Size { #[tw(class="text-sm px-3")] Sm, #[tw(class="text-base px-4")] Md }
```
**Turf** — `turf::style_sheet!("src/c.scss")` → compile-time SCSS + scoped class structs.
**Stylers** — `styler!{ .card { … } }` compile-time scoped, extracted to a file (zero WASM cost).

---

## 3. Icons — recommend `leptos-icons` + `icondata` (breadth) or `phosphor-leptos` (design)

| Crate | Count | Leptos | Notes |
|---|---|---|---|
| `leptos-icons` + `icondata` | 20k+ (FA, Material, Bootstrap, Feather…) | 0.8 | One `<Icon>`, feature-flag each set, tree-shakes |
| `phosphor-leptos` | ~1,400 (6 weights) | 0.7 | Consistent, beautiful design language |
| `lucide-leptos` (rustforweb) | ~1,500 | 0.8 | Lucide port; rustforweb org (≠ archived shadcn-ui) |
| `lepticons` | Lucide-based | — | Stroke draw-in animations + searchable picker |
| `leptos-remix-icon` | Remix set | — | Niche |

```rust
use icondata as i; use leptos_icons::Icon;
view! { <Icon icon=i::FiFeather width="24" height="24"/> }
```
```rust
use phosphor_leptos::{Icon, IconWeight, X};
view! { <Icon icon=X weight=IconWeight::Bold size="24px"/> }
```

---

## 4. Animation & motion

**Idiomatic baseline = CSS transitions toggled by reactive classes** (no crate, works SSR):
```rust
let active = RwSignal::new(false);
view! {
    <div class="transition-all duration-300 ease-out"
         class=("opacity-0 translate-y-4",  move || !active.get())
         class=("opacity-100 translate-y-0", move ||  active.get())>
        "Content"
    </div>
}
```
**`leptos-animate`** (`brofrain/leptos-animate`) — FLIP position transitions + enter/leave for
Leptos 0.8. Early-stage; needs `rustflags = ["--cfg=web_sys_unstable_apis"]`. `<AnimatedFor>`
animates keyed-list reordering. (`brofrain/leptos-animated-for` is the narrower FLIP-only crate.)
**`leptos-motion`** (cloud-shuttle) — Framer-Motion-style API, spring physics; self-rated
production-ready but verify (same org caveat as their shadcn crate).

**View Transitions API** and **JS libs (GSAP/anime/tsParticles/Three.js)** via `wasm-bindgen` —
there's no turnkey crate; bind the JS and call it from an `Effect` after the node mounts:
```rust
#[wasm_bindgen]
extern "C" { #[wasm_bindgen(js_namespace = gsap)] fn to(t: &JsValue, v: &JsValue) -> JsValue; }

let node = NodeRef::<leptos::html::Div>::new();
Effect::new(move |_| {                       // ✅ Effect::new, runs client-side post-mount
    if let Some(el) = node.get() {
        let vars = js_sys::Object::new();
        js_sys::Reflect::set(&vars, &"opacity".into(), &1.0.into()).unwrap();
        js_sys::Reflect::set(&vars, &"duration".into(), &0.5.into()).unwrap();
        to(&el.into(), &vars);
    }
});
view! { <div node_ref=node/> }
```
Load the JS lib via CDN/bundle in `index.html` — don't try to compile GSAP/Three into WASM.
**Bevy/WebGL 3D** can compile to WASM and render to a `<canvas>` alongside the Leptos UI,
sharing state via signals/custom events — non-trivial but demonstrated in the community. For
hardware WebGPU/WebGL eye-candy validation, drive the running app with the `browser`/`playwright`
sidecar skills.

---

## 5. Charts / data viz

| Option | Type | Recommend |
|---|---|---|
| **leptos-chartistry** | Native Rust/SVG, reactive | **Best pure-Rust** — line/bar/stacked, ~22k dl/mo, active |
| Chart.js via JS interop | JS + canvas | Best ecosystem breadth |
| ECharts via JS interop | JS + canvas | Complex/financial dashboards |
| D3 via JS interop | JS + SVG | Max control, max effort |
| `plotters` + canvas | Rust + canvas | Batch/non-interactive rendering |

```rust
use leptos_chartistry::*;
view! {
    <Chart aspect_ratio=AspectRatio::from_outer_height(300.0, 1.5)
        series=Series::new(|d: &MyData| d.x).line(Line::new(|d: &MyData| d.y).with_name("Value"))
        data=data_signal />
}
```

---

## 6. Utility components

- **Tables / data grid:** `leptos-struct-table` (Synphonyte) — derive a table from a struct;
  virtual scroll, async `TableDataProvider`, pagination, sortable. **Production-grade.**
  ```rust
  #[derive(TableRow, Clone)] #[table(sortable)]
  struct User { #[table(key)] id: u64, name: String, email: String }
  view! { <TableContent rows=users scroll_container="window"/> }
  ```
- **Maps:** `leptos-leaflet` (Leaflet, active), `leptos_maplibre` (MapLibre GL, less mature).
- **Toasts:** `leptoaster` (simple, `expect_toaster().success("…")`), `leptos_toaster` (Sonner-style, richer queue).
- **Hotkeys:** `leptos-hotkeys` — `use_hotkeys!(("ctrl+k") => move |_| search.set(true));`
- **Floating UI** (tooltips/popovers): `floating-ui` (rustforweb) — `use_floating(reference, floating, opts)`.
- **Rich text:** `Papelito` (simple WYSIWYG; verify version).
- **Image optimisation:** `leptos_image` (Axum SSR) — WebP conversion, SVG LQIP placeholder, `priority` LCP preload. Static images only.
  ```rust
  view! { <Image src="/img/hero.jpg" width=1200 height=600 quality=85 priority=true/> }
  ```
- **Reactive hooks (use in every project):** `leptos-use` (0.18+ for Leptos 0.8) — 100+ VueUse-style
  utilities: `use_window`, `use_document`, `use_cookie`, `use_local_storage`, `use_debounce_fn`,
  `use_interval`, `use_element_bounding`, `use_intersection_observer`, `use_color_mode`. All SSR-safe.

---

## 7. Showcase — polished Leptos apps to study for visual + architecture inspiration

| App | Repo / URL | Stack | Why notable |
|---|---|---|---|
| **RustyTube** | `opensourcecheemsburgers/RustyTube` | Leptos + Tauri + Tailwind + DaisyUI | Polished YouTube client; one codebase → web + desktop, consistent design |
| **quanticbox** | `quanticbox.app` | Leptos + Axum + Diesel + Tailwind/DaisyUI | Data-dense financial dashboard at production fidelity |
| **Ibis** | `Nutomic/ibis` (`ibis.wiki`) | Leptos + Axum + Diesel + ActivityPub | Complex federated wiki — auth, SSR, multi-tenant |
| **simple-icons-website-rs** | `simple-icons/simple-icons-website-rs` | Leptos CSR + Tailwind | Search/filter at scale with signals; no SSR complexity |
| **chartistry demo** | `feral-dot-io.github.io/leptos-chartistry` | Leptos + chartistry | Full reactive chart gallery |

**Insight:** every polished production Leptos app uses **Tailwind (+ DaisyUI or custom tokens)**
for primary styling — none lean on a Leptos-specific component kit for the whole UI. The current
production pattern is **Tailwind + copy-paste/shadcn-style components**, reaching for Thaw or
Leptodon for widget-level pieces. The "one pure-Leptos component library" story is still maturing.

---

## Opinionated stacks (recap)

- **Fast start:** Leptos 0.8 + Tailwind v4 + DaisyUI 5 + `leptos-icons` + `leptos-chartistry` + `leptos-use`.
- **Components included:** + Thaw (or Leptodon) + Stylance + Tailwind Fuse + `leptos-struct-table` + `leptos_image`.
- **Design-system ownership:** + rust-ui/ui (copy-paste) + Stylance + `phosphor-leptos`.

**Sources:** [Leptos status update 2026 (#4707)](https://github.com/leptos-rs/leptos/issues/4707) · [awesome-leptos](https://github.com/leptos-rs/awesome-leptos) · [Thaw](https://github.com/thaw-ui/thaw) · [Leptodon](https://github.com/openanalytics/leptodon) · [rust-ui/ui](https://github.com/rust-ui/ui) · [Stylance](https://github.com/basro/stylance-rs) · [Tailwind Fuse](https://github.com/gaucho-labs/tailwind-fuse) · [Turf](https://github.com/myFavShrimp/turf) · [leptos-icons](https://github.com/Carlosted/leptos-icons) · [phosphor-leptos](https://github.com/SorenHolstHansen/phosphor-leptos) · [Rust Lucide](https://lucide.rustforweb.org/frameworks/leptos.html) · [leptos-animate](https://github.com/brofrain/leptos-animate) · [leptos-chartistry](https://github.com/feral-dot-io/leptos-chartistry) · [leptos-struct-table](https://github.com/Synphonyte/leptos-struct-table) · [leptos-leaflet](https://github.com/headless-studio/leptos-leaflet) · [leptos-hotkeys](https://github.com/gaucho-labs/leptos-hotkeys) · [Floating UI](https://floating-ui.rustforweb.org/frameworks/leptos.html) · [leptos_image](https://github.com/gaucho-labs/leptos-image) · [leptos-use](https://leptos-use.rs) · [Leptos 0.8 + Tailwind v4 + DaisyUI5 guide](https://8vi.cat/leptos-0-8-tailwind4-daisyui5-for-easy-websites/)
