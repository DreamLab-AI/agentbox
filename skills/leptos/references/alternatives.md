# Alternatives & When NOT to Use Leptos — Rust Web UI Landscape

> Verified mid-2026 (versions/dates checked against GitHub releases + crates.io). This file
> exists so the skill is honest about its own boundaries: Leptos is excellent, but it is one
> choice in a landscape, and for some jobs it is the wrong one. Read this when picking a stack
> for a *new* project, or when someone asks "should we be on Leptos at all?".

---

## The framing that prevents bad comparisons

Rust web UI options are **four different categories**. Comparing across categories is a category
error (asking "does egui support SSR?" is like asking how fast a submarine drives). Compare
*within* a category.

1. **DOM reactive frameworks** — emit semantic HTML → get SEO, accessibility, text selection, CSS for free. *(Leptos, Dioxus, Yew, Sycamore.)* This is what "Rust web UI" usually means.
2. **Canvas / immediate-mode** — paint pixels to `<canvas>`; **no DOM at all**. Great for tools, disqualifying for content/SEO. *(egui, Slint.)*
3. **Server-rendered HTML + htmx** — Rust generates HTML strings; interactivity via htmx/Datastar. Zero WASM, perfect SEO, lowest risk. *(Maud/Askama + Axum.)*
4. **Dormant / niche** — know what to ignore. *(MoonZoon, Percy, Seed, Sauron, Kobold, Mogwai, Dominator; native-first iced/Floem/Xilem.)*

---

## Category 1 — DOM reactive frameworks (the real apples-to-apples)

| Feature | **Leptos** | **Dioxus** | **Yew** | **Sycamore** |
|---|---|---|---|---|
| Latest (mid-2026) | 0.8.19 (0.9-alpha) | 0.7.9 (0.8-alpha) | 0.23.0 (Mar 2026) | 0.9.2 (Sep 2025) |
| Rendering model | Fine-grained reactive, **no VDOM** | Hybrid **signals + VDOM**, template diffing | **Pure VDOM** (React-like) | Fine-grained reactive, no VDOM |
| Re-render granularity | Surgical (per DOM node) | Targeted (dirty scopes; static subtrees skipped) | Whole affected subtree diffed | Surgical (per DOM node) |
| Baseline WASM | **Smallest** (tens of KB) | Small (<50 KB stripped) | **Largest** (~110–130 KB w/ hydration) | Small |
| SSR + hydration | ✅ mature | ✅ mature (`dioxus_fullstack`) | ✅ supported, manual wiring | ✅ + streaming |
| Islands | ✅ first-class | ◑ via fullstack routing (unnamed) | ✗ | ✗ |
| **Server fns / full-stack** | ✅ `#[server]`, best-in-class | ✅ rebuilt on Axum in 0.7, very strong | ✗ none (wire backend manually) | ✗ (Perseus meta-framework) |
| Targets | Web only | **Web + desktop + mobile + server** | Web only | Web only |
| Native renderer | — | Blitz/WGPU (experimental, *not* prod) | — | — |
| Syntax | `view!` macro | `rsx!` macro + React-style hooks | `html!` macro | `view!` macro |
| Hot reload | template hot-reload | **Best in class** — sub-second RSX + experimental Rust hot-patching (`subsecond`) | Trunk recompile only | Trunk recompile only |
| CLI/tooling | `cargo-leptos` | dedicated `dx` (mature) | Trunk (generic) | Trunk |
| Tailwind | manual (v4) | **auto-detected/watched by `dx`** | manual (Trunk hook) | manual |
| Component libs | Thaw, Leptodon, rust-ui/ui… | Dioxus Primitives (Radix-style, first-party) | TailYew, Material Yew, yew-bootstrap | thin |
| Ecosystem size | Large (2nd biggest) | Large, fastest-growing | **Largest community, 4M+ downloads** | Small |
| **Maintenance / funding** | ⚠️ **light maintenance** (feature-complete; solo) | ✅ **YC S23 company, full-time team** | community-only, no funding, slower pace | community, ~1 release/yr |
| API stability | stable surface, pre-1.0 | pre-1.0, **breaks across minors** | pre-1.0, stable surface, historic long gaps | pre-1.0 |
| Production users | Ibis, RustyTube, many | Airbus/ESA, Huawei, Satellite.im | long tail | few |

### Notes that the table can't carry

- **The real decision is Leptos vs Dioxus.** Yew and Sycamore are niche picks; these two are the production-grade choices and they trade off cleanly:
  - **Leptos** — best raw fine-grained performance, smallest bundles, first-class islands, cleanest `#[server]` full-stack story *for web*. Costs: web-only, and the maintenance momentum question (see below).
  - **Dioxus** — funded velocity, **one codebase → web + desktop + mobile**, the best hot-reload in any Rust UI, React-familiar. Costs: slightly larger bundles, pre-1.0 API churn across minors, native renderer (Blitz) not production-ready, **telemetry on by default (opt out)**.
  - Capability-for-capability on *pure web*, they're close; Leptos is arguably the better-architected web tool, Dioxus the better-resourced cross-platform bet.
- **Yew** is the "biggest community / most learning resources / most React-like" choice — but **web-only, largest bundles, no server functions, slowest velocity** of the three active ones. Pick it when team familiarity and ecosystem size outweigh full-stack ergonomics and bundle size.
- **Sycamore** is architecturally Leptos's twin (fine-grained → DOM) with a smaller ecosystem, ~yearly cadence, and no native server-functions story. In 2026 there's little reason to choose it *over* Leptos — Leptos absorbed its niche. If you're already on Sycamore and it works, fine; don't start new work on it expecting the ecosystem to catch up.
- **VDOM vs fine-grained, in practice:** Yew's full-VDOM diffing re-renders the affected subtree on every change; under high-frequency updates that overhead is measurable. Leptos/Sycamore update only the exact bound node. Dioxus sits between — signals mark dirty scopes, and template-based diffing skips static subtrees, so it avoids Yew's blanket cost without going fully fine-grained.

---

## Category 2 — Canvas / immediate-mode (NOT semantic web)

Renders the whole UI as pixels to a `<canvas>` (WebGL/WebGPU). **No DOM, no HTML, no SEO, no
browser text search, no/broken screen-reader support on web.** This is an architectural fact,
not a missing feature — don't expect it to be fixed.

| Feature | **egui** (eframe) | **Slint** |
|---|---|---|
| Latest | 0.35.0 (Jun 2026) | 1.17.0 (Jun 2026) |
| Model | Immediate-mode (UI redrawn every frame) | Declarative retained-mode, `.slint` DSL |
| Web output | Canvas/WebGL — **no DOM** ("purely canvas, no DOM") | Canvas/WebGL — **no DOM/CSS** |
| SSR / SEO | ✗ categorically impossible | ✗ docs call web "demos/examples" |
| Web a11y | ✗ AccessKit web adapter incomplete; experimental screen reader only | ✗ docs: "not available" on web |
| Real targets | desktop + web + Android; game-engine UIs (bevy_egui) | **embedded/MCU** + desktop + mobile + web(secondary) |
| Styling | Rust `Style`/`Visuals` structs (no CSS); new "Classes" system early | `.slint` properties (no CSS); Material 3 lib |
| Maintenance | Active; sponsored by **Rerun** | Active; **SixtyFPS GmbH** (commercial) |
| Licensing | MIT/Apache | **GPLv3 / royalty-free-with-badge / paid for embedded** |
| Best fit | dev tools, dashboards, debug overlays, scientific viz, game editors, internal tooling | embedded product UIs, cross-platform desktop, designer/dev `.slint` split |

**When these are right:** the "web app" is really a **tool or visualiser** and SEO/accessibility/
semantic-HTML are non-requirements (internal dashboards, data explorers, debug UIs, game tooling).
**Disqualifying when:** users need Ctrl+F, copy-paste from the page, screen readers, or the page
needs to be crawlable. Slint's web target especially is an afterthought to its embedded/desktop
core — and its **per-device commercial licence for embedded** is a real cost to factor (the free
royalty-free tier requires a "Powered by Slint" badge and excludes embedded).

---

## Category 3 — Server-rendered HTML + htmx (the no-WASM, lowest-risk option)

Often the **most production-stable** choice and the one people forget. Rust emits HTML strings
server-side; interactivity comes from htmx / Datastar / Alpine. Zero WASM, perfect SEO, smallest
possible client, and it rides on **Axum** (rock-solid) plus tiny stable template crates rather
than any niche framework.

| Piece | State (mid-2026) | Notes |
|---|---|---|
| **Maud** | 0.27, compile-time HTML macro | Zero-cost, Axum-native (`impl IntoResponse`), Rust-first ergonomics |
| **Askama** | 0.16, Jinja-like type-checked file templates | **The `rinja` fork merged back into `askama`** under the `askama-rs` org — `askama` is the active project again. `askama_axum` / `askama_actix` integrations |
| **Hypertext** | 0.12, type-checked macro | Lighter alternative to Maud, `#![no_std]`-friendly |
| **Tera** | 1.21 (2.0 coming) | Runtime Jinja2 — templates editable without recompile; weaker type-safety |
| `axum-htmx` | 0.8 | Typed extractors/responders for `HX-*` headers |
| **Datastar** | Rust SDK (1.0-RC) | SSE-first hypermedia (signals + fragment swaps); canonical 2026 stack = Axum + Maud + SQLx + Datastar. Pin frontend/backend versions together during RC |

**Best fit:** admin panels, SaaS dashboards, forms, content sites, REST-with-HTML-views, and any
team that doesn't want to build/ship/maintain a Rust WASM frontend. **Weakness:** no shared
reactive logic with a rich client; highly interactive UIs get awkward and push you toward more
htmx/Datastar surface area. If the honest question is "what is the *maximally maintained* Rust web
option," this category is the answer — because its load-bearing parts (Axum, Maud, Askama) are
either funded-adjacent or so small they're effectively done.

---

## Category 4 — Dormant / niche (don't start new web work here)

- **Effectively inactive / never production-ready:** MoonZoon (no stable release; curiosity), Percy, Seed, Kobold, Mogwai, Dominator, Sauron (status uncertain — verify before any use).
- **Native-first, web is secondary/experimental:** iced (Elm-arch, desktop-first), Floem (Leptos-inspired reactivity, desktop-first), **Xilem / `xilem_web`** (Linebender) — the long-term Rust-native UI bet worth *watching*, but its web backend is early research, not production.
- **Substrate, not frameworks:** `wasm-bindgen`/`web-sys` (everything depends on these), Vello (GPU vector renderer used inside Xilem/Floem/Blitz).

`arewewebyet.org` is stale but its verdict still holds: there is no Rails/Django-equivalent
batteries-included Rust web framework. Backend leaders are **Axum** and **Actix-Web**; emerging
batteries-included contenders are `loco.rs`, `cot.rs`, `Roadster` (backend, not UI).

---

## Recommendation by use-case

| You're building… | Pick |
|---|---|
| SEO/content web app, smallest+fastest, web-only, already a Leptos shop | **Leptos** (stay) |
| Web **+ desktop + mobile** from one codebase; want funding + best DX | **Dioxus** |
| React-team SPA, ecosystem size > everything, no full-stack needs | **Yew** |
| Admin/dashboard/forms/content, lowest risk, no WASM | **Maud/Askama + Axum + htmx/Datastar** |
| Dev tool, data visualiser, game/editor UI (SEO irrelevant) | **egui** |
| Embedded / industrial / cross-platform device UI | **Slint** |
| Greenfield where maintenance velocity is the deciding factor | **Dioxus** |

### For us specifically (a Leptos shop)
The only framework that should tempt us *off* Leptos is **Dioxus**, and the tipping factors are
**cross-platform reach** and **maintenance velocity** — not raw features (Leptos is at least as
capable for pure web). For anything web-only and SEO-driven, Leptos remains the better-architected
tool; Dioxus's funding *mitigates* the Leptos light-maintenance concern, it doesn't make Leptos
wrong. And for the meaningful slice of "web apps" that are really server-rendered CRUD, the
lowest-risk answer is **not a WASM framework at all** — it's Axum + Maud/Askama + htmx. Don't
rewrite working Leptos apps; do widen the default menu for *new* projects along these lines.

See the maintenance-risk reasoning and review-triggers in the SKILL.md "Version Anchor & Framework
Health" section — the decision to stay on Leptos is conditional on the `leptos_0.9` line continuing
to track `axum`/`wasm-bindgen`/compiler changes and on a working security-response path.

---

**Sources:** [Dioxus releases](https://github.com/dioxuslabs/dioxus/releases) · [Dioxus 0.7 blog](https://dioxuslabs.com/blog/release-070/) · [Dioxus YC](https://www.ycombinator.com/companies/dioxus-labs) · [Blitz](https://github.com/DioxusLabs/blitz) · [Yew 0.22 notes](https://github.com/yewstack/yew/blob/master/website/blog/2025-11-29-release-0-22.md) · [Yew SSR](https://yew.rs/docs/next/advanced-topics/server-side-rendering) · [Sycamore releases](https://github.com/sycamore-rs/sycamore/releases) · [egui](https://github.com/emilk/egui) · [Slint web docs](https://docs.slint.dev/latest/docs/slint/guide/platforms/web/) · [Slint pricing](https://slint.dev/pricing) · [Maud](https://lib.rs/crates/maud) · [Askama (askama-rs)](https://github.com/askama-rs/askama) · [axum-htmx](https://docs.rs/axum-htmx/) · [Datastar+Rust tutorial](https://hamy.xyz/blog/2026-03_datastar-rust-todo) · [flosse rust-web-framework-comparison](https://github.com/flosse/rust-web-framework-comparison) · [JetBrains: Rust web 2026](https://blog.jetbrains.com/rust/2026/06/25/rust-web-development-2026/) · [Reintech Leptos/Yew/Dioxus 2026](https://reintech.io/blog/leptos-vs-yew-vs-dioxus-rust-frontend-framework-comparison-2026)
