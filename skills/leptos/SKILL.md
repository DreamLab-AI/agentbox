---
name: Leptos
description: >
  Opinionated playbook and current reference for building full-stack web apps in Leptos
  (the Rust fine-grained-reactive framework). Use whenever the task involves Leptos: writing
  or editing components and the view! macro, signals/memos/effects, server functions (#[server]),
  SSR / hydration / islands, leptos_router, Resources/Actions/Suspense, or scaffolding with
  cargo-leptos / Trunk. Trigger on "Leptos", "view! macro", "RwSignal", "server function",
  "hydration mismatch", "signal disposed panic", "cargo leptos", "Thaw / leptos-use / Tailwind
  in Rust", choosing a Leptos component / styling / chart / icon library, reactive-state design,
  feature-flag (ssr/hydrate/csr) build breaks, WASM bundle-size tuning, or 0.6→0.7→0.8 migration.
  Covers tips, best practice, the ecosystem "eye candy", and the common traps. Pairs with
  open-design / design-audit (which own the visual layer; this skill owns the Rust + reactive layer).
---

# Leptos — Rust Reactive Web Playbook

The opinionated build playbook and current-API reference for Leptos full-stack apps. Leptos is
**fine-grained reactive** (signals drive surgical DOM updates — no VDOM, no diffing), and almost
every beginner trap comes from forgetting that one fact. This skill encodes the idioms, the
ecosystem map (including the eye candy), and the gotchas so you write code that compiles the
first time and updates only what changed.

This skill owns the **Rust + reactivity + full-stack** layer. For the **visual** layer (premium
UI polish, design tokens, anti-slop critique), compose with `open-design` and `design-audit` —
they emit the design system; this skill implements it in Leptos.

---

## Routing Trigger

Route here when the user is building, editing, debugging, or scaffolding a Leptos app, or
choosing anything in the Leptos ecosystem. Single-agent reference + implementation skill (no
swarm). If the task is *also* "make it look premium", run `design-audit`/`open-design` for the
visual plan and return here to implement it.

---

## Version Anchor & Framework Health (read first — honest open-source insight)

- **Current: 0.8.x stable; 0.9.0-alpha in development.** The **0.7 "tachys" rewrite** replaced
  the old `leptos_reactive` crate with `reactive_graph` (arena-allocated ownership), made the
  renderer statically typed, deprecated all `create_*` constructors, and reworked the router.
  **Most Leptos code older than 0.7 is wrong on the current API** — don't pattern-match on
  pre-0.7 blog posts.
- **0.9-alpha** adds function-call signal reads (`count()` instead of `count.get()`) on stable Rust.
- **Maintenance reality:** in 2026 the creator (Greg Johnston) announced Leptos is
  **feature-complete and moving to light maintenance** (burnout). The framework is stable and
  production-proven — *not* rotting — but this **drives library selection**: prefer crates with
  independent, active maintainers (Synphonyte, basro/stylance, OpenAnalytics/Leptodon) over
  single-contributor projects that may stall. See `references/ecosystem.md` for the live/dead map.
  **Is Leptos still the right choice?** That's a real question, not a given — `references/alternatives.md`
  is the verified mid-2026 feature analysis of every Rust web-UI option (the only serious "off-Leptos"
  candidate is **Dioxus**, for cross-platform reach + funding; for server-rendered CRUD, Axum + Maud/Askama
  + htmx is the lowest-risk answer). Don't rewrite working Leptos apps; do widen the menu for new projects.
- **Always verify the exact API against `docs.rs/leptos` and `book.leptos.dev` for the version
  pinned in `Cargo.toml`.** The `view!` macro and server-fn surface shift between minors; this
  skill gives idioms, the docs give the signature for *your* pin.

---

## The Reference Map (progressive disclosure)

Read the SKILL body for the decision; open the matching reference for the code.

| File | Read when |
|------|-----------|
| `references/reactivity.md` | Signals (`signal()`/`RwSignal`/`Memo`), effects, `<Show>`/`<For>`/`<Suspense>`/`<ErrorBoundary>`, context + `reactive_stores`, ownership/disposal, perf idioms |
| `references/fullstack.md` | `#[server]` functions + encodings + errors, SSR modes, **islands**, `Resource`/`Action`/`<ActionForm>`, `leptos_router` 0.7 API, auth/sessions, hydration-bug fixes, deployment (Docker/Axum/edge) |
| `references/ecosystem.md` | **Eye candy & libraries**: component kits (Thaw, Leptodon, rust-ui, shadcn ports), styling (Tailwind v4, Stylance, Turf), icons, animation/motion, charts, tables/maps/toasts/hotkeys, showcase apps — each with a maintenance verdict |
| `references/tooling.md` | `cargo-leptos` + `[package.metadata.leptos]`, feature-flag discipline, testing (wasm-bindgen-test + Playwright), debugging, WASM bundle-size tuning, 0.6→0.7→0.8 migration tables, learning repos |
| `references/pitfalls.md` | **The cheat sheet** — every gotcha table + the "Leptos smell test" in one place. Open this when debugging a panic, a non-updating signal, or a feature-flag build break |
| `references/alternatives.md` | **When NOT to use Leptos** — verified mid-2026 feature analysis of the whole Rust web-UI landscape (Dioxus, Yew, Sycamore, egui, Slint, Maud/Askama+htmx), grouped into 4 categories, with a per-use-case pick table. Read before choosing a stack for a *new* project, or when asked "should we be on Leptos at all?" |
| `assets/project-skeleton.md` | Copy-paste scaffold: workspace `Cargo.toml`, feature triad, `wasm-release` profile, `.cargo/config.toml`, `.vscode/settings.json`, `leptosfmt.toml`, Tailwind v4 wiring |

---

## Non-Negotiables (the distilled best practice — violate these and it breaks)

1. **`use leptos::prelude::*;`** — not `use leptos::*` (0.7+). Half of "function not found" errors are this.
2. **`signal()` / `RwSignal::new()` / `Memo::new()` / `Effect::new()`** — the `create_*` forms are deprecated.
3. **Reactivity lives in closures.** `{move || count.get()}`, not `{count.get()}`. A bare `.get()` / `if` / `match` in the view body runs **once** and never updates.
4. **Pass the signal, not its value.** Props take `count` (a `Signal`), never `count.get()`.
5. **Signals are `Copy`** (arena IDs) — just `move` them into closures. Clone the *signal* (`ArcRwSignal`) for dynamic collections, never clone the *value* to "fix" reactivity.
6. **Prefer derived signals / `Memo` over `Effect` for syncing state.** Effects are for the *outside* world only (DOM, console, storage, network). An effect that writes a signal is almost always a `Memo` in disguise.
7. **`<For>` needs a stable `key`** (never the index for reorderable lists), and mutable rows need per-row signals or a keyed `Store`.
8. **Feature triad: `default = []`.** `ssr`, `hydrate`, `csr` are mutually exclusive; cargo-leptos selects per target. `["ssr","hydrate"]` together = broken build.
9. **Gate server-only code with `#[cfg(feature = "ssr")]`** and remember `#[server]` fns are **public HTTP endpoints** — never return secrets/un-redacted PII without auth *inside* the body.
10. **Render deterministically across server and client.** No `web_sys::window()`, `localStorage`, or `cfg!(target_arch=...)` branching during the initial render — wrap browser-only work in `Effect::new`. This is the #1 hydration-mismatch cause.

---

## Build Workflow (the path)

### 1 — Scaffold
Pick a template (full detail + commands in `references/tooling.md`):

| Need | Template |
|------|----------|
| Full-stack, simplest | `cargo leptos new --git leptos-rs/start-axum` |
| Full-stack, production (bin/lib split) | `leptos-rs/start-axum-workspace` |
| Actix backend | `leptos-rs/start-actix` |
| Pure SPA, no SSR | `leptos-rs/start-trunk` (Trunk, `csr`) |
| Serverless / edge | `start-spin` (WASI), `start-aws` (Lambda) |

Then drop in the scaffold from `assets/project-skeleton.md` (feature flags, `wasm-release` profile, editor + formatter config). This avoids ~80% of first-day build breaks.

### 2 — Choose the rendering mode
| Scenario | Mode |
|----------|------|
| Admin tool, no SEO | **CSR** (Trunk) |
| Default full-stack, fast TTFB | **SSR + OutOfOrder streaming** (default) |
| Critical data in `<head>` (OG/meta) | **`SsrMode::Async`** |
| Content-heavy, minimal JS | **Islands** (`#[island]` for the interactive bits only — up to ~80% smaller WASM) |
| Build-time static page | **`SsrMode::Static`** |

### 3 — Compose the UI (eye candy → pick a stack)
Three battle-tested starting stacks (full comparison in `references/ecosystem.md`):

- **Fast start:** Leptos 0.8 + **Tailwind v4 + DaisyUI 5** + `leptos-icons` + `leptos-chartistry`.
- **Components included:** + **Thaw UI** (Fluent, no Tailwind needed) or **Leptodon** (Flowbite, commercially backed) + **Stylance** for scoped overrides + **Tailwind Fuse** for class merging + `leptos-struct-table` + `leptos_image`.
- **Design-system ownership:** + **rust-ui/ui** (shadcn-style copy-paste, you own the code) + **Stylance** + **phosphor-leptos**.

Reach for `leptos-use` (100+ reactive hooks, SSR-safe `use_window`/`use_cookie`/`use_debounce_fn`) in **every** project.

### 4 — Reactivity discipline
Design state granular (separate signals or a `Store<T>`, not one mega-struct). Derive with `Memo`. Lift shared state to the lowest common ancestor or `provide_context`. See `references/reactivity.md`.

### 5 — Data & server boundary
`Resource::new(source, fetcher)` inside `<Suspense>` / `<Transition>`; `ServerAction` + `<ActionForm>` for mutations (progressive enhancement — forms work without JS). `references/fullstack.md`.

### 6 — Test & perf gate
`cargo leptos test` (native + wasm-bindgen-test), Playwright `end2end/` for flows. Before release: `wasm-release` profile, `wasm-opt`, measure `target/site/pkg/*.wasm` gzip size, consider islands / `#[lazy_route]`. `references/tooling.md`.

### 7 — Persist what you learned (RuVector)
Store reusable Leptos patterns and hard-won fixes so the next session reuses them.

---

## Quality Gate — the "Leptos Smell Test"

Before calling a Leptos change done, scan for these. Any hit = not done (full list in `references/pitfalls.md`):

- A `.get()` / `if` / `match` sitting in the `view!` body **outside** a `move ||` closure → it's static, won't update.
- A prop receiving `signal.get()` instead of the signal → child never re-renders.
- An `Effect::new` whose only job is `set_b.set(f(a.get()))` → replace with a derived signal / `Memo`.
- `<For>` keyed by index, or rows whose fields aren't individually reactive → stale/duplicated rows on reorder.
- `web_sys::window()` / `document()` / `localStorage` reached during render (not inside an `Effect`) → hydration panic on SSR.
- Invalid HTML nesting (`<div>` in `<p>`, `<tr>` without `<tbody>`) → hydration mismatch.
- `ssr`/`hydrate` both active, or server-only imports without `#[cfg(feature="ssr")]` → build break.
- A `#[server]` fn returning a secret/token/raw PII without an auth check in the body → data leak.
- `Signal::derive(expensive_fn)` where the value is read often → no caching; use `Memo::new`.
- Arena signals created per-item in a growing `Vec` without `ArcRwSignal`/`.dispose()` → leak / disposed-signal panic.

---

## Memory (RuVector)

Per workspace policy, use RuVector MCP tools — never file-based memory.

- **Before** designing non-trivial reactive state or picking a library, search prior decisions:
  `mcp__claude-flow__memory_search({query: "leptos <topic>", namespace: "project-state", limit: 5})`.
- **After** solving a real trap or settling a stack choice, store a plain-text summary
  (`mcp__claude-flow__memory_store`, namespace `project-state`, `upsert: true`) — e.g.
  "Leptos hydration mismatch from `<table>` without `<tbody>` — always emit explicit `<tbody>`".
  This compounds across the team's Leptos work.

---

## Composition With Sibling Skills

| Skill | Boundary |
|-------|----------|
| `open-design` / `design-audit` | Own the **visual** spec (tokens, hierarchy, anti-slop). They produce the design; this skill builds it in Leptos. Implement their tokens as Tailwind/Stylance, their components as `#[component]`s. |
| `skill-builder` / `skill-creator` | If extending *this* skill (new reference, new pattern), follow their progressive-disclosure spec. |
| `browser` / `playwright` | Drive the running Leptos dev server (`localhost:3000`) for visual/interaction verification and WebGPU/WebGL eye-candy checks. |
| `verification-quality` | Gate generated Leptos code through truth scoring before claiming done. |
