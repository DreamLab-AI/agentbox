# Pitfalls Cheat Sheet — Open This When Debugging

One-stop lookup for the traps. Grouped by symptom. Deep explanations live in the other
references; this is the fast path.

---

## A. "My UI doesn't update" (reactivity lost)

| Symptom | Cause | Fix |
|---|---|---|
| Value renders once, never changes | `.get()` / `if` / `match` placed directly in `view!` body | wrap in a closure: `{move \|\| …}` |
| Child component never re-renders | passed `signal.get()` as a prop instead of the signal | pass `signal` (a `Signal<T>`); read it inside the child |
| Computed string is frozen | `format!("…", sig.get())` evaluated eagerly | `move \|\| format!("…", sig.get())` |
| Derived value recomputes constantly / janky | `Signal::derive(expensive)` read by many | `Memo::new(move \|_\| …)` (caches, dedupes) |
| Warning: "signal accessed outside reactive context" | read outside any closure/effect | move the read into `move \|\|` or `Effect::new` |
| Two signals won't stay in sync cleanly | `Effect` writing one signal from another | replace with a derived signal / `Memo` |

## B. Panics

| Panic | Cause | Fix |
|---|---|---|
| "signal already disposed" / disposed-signal panic | arena signal created in a branch/collection, owner re-ran and disposed it | use `ArcRwSignal` for collection items; or `.try_get()`/`.try_with()`; or create in parent scope |
| `BorrowError` at runtime | nested `.with()` / `.write()` on the **same** signal (re-entrant `RwLock`) | restructure; use `.get()` (clone) for the inner read; never nest borrows of one signal |
| "unreachable executed" with no trace | missing panic hook | add `console_error_panic_hook::set_once()` in the hydrate entry |
| Panic on server: "wasm-bindgen on non-wasm target" / `window` is None | browser API (`web_sys::window()`, `localStorage`, `gloo`) reached during SSR render | wrap in `Effect::new` (client-only) or use `leptos-use` `use_window()`/`use_document()` |

## C. Hydration mismatch (panic or silent corruption after SSR)

The server DOM and client render must be **byte-identical** on first paint.

| Cause | Fix |
|---|---|
| `cfg!(target_arch="wasm32")` / non-deterministic branching during render | remove from render; client-only work → `Effect::new`; use compile-time `#[cfg(...)]` to drop a branch |
| Invalid HTML nesting: `<div>` in `<p>`, `<button>` in `<button>` | emit valid markup |
| `<table><tr>` without `<tbody>` (browser auto-inserts `<tbody>`) | write `<tbody>` explicitly |
| Browser APIs during render | move to `Effect::new` |
| `Resource` read outside a `<Suspense>` (e.g. in an effect before it resolves) | wrap reads in `<Suspense>`; or `LocalResource` for client-only data |
| `<Suspense>` placed above `<Routes>` | keep all `<Suspense>` boundaries inside route views |
| Random/time-based content (`uuid`, timestamps) in initial render | generate on the server and pass down, or render after mount in an effect |

## D. Lists (`<For>`)

| Symptom | Cause | Fix |
|---|---|---|
| Rows duplicate / mis-order on reorder | index used as `key`, or `enumerate()` index in memos | use a **stable unique id** as `key`; `<ForEnumerate>` if you truly need the index |
| Row data changes but UI doesn't | child reads a plain field, not a signal, while key stays constant | give each row per-field `RwSignal`s, or a keyed `Store` (`#[store(key: … = …)]`) |
| Memory grows with a long-lived list | arena signals per item never disposed | store `ArcRwSignal` per item; `on_cleanup(\|\| sig.dispose())` on removal |

## E. Build / feature flags

| Symptom | Cause | Fix |
|---|---|---|
| WASM build: undefined/missing symbols | `ssr` leaking into the WASM target (e.g. `default = ["ssr"]`) | `default = []`; cargo-leptos selects per target |
| WASM compile error on a server crate | server-only `use` not gated | `#[cfg(feature = "ssr")]` on the import + usage |
| `signal`/macros "not found" | `use leptos::*` | `use leptos::prelude::*` |
| Conflicting cfg / weird double-build | both `ssr` and `hydrate` active | lib = `hydrate` only, bin = `ssr` only; they're mutually exclusive |
| Deps resolve features wrong in workspace | missing `resolver = "2"` | add it to `[workspace]` |
| rust-analyzer red-squiggles server-fn bodies | RA can't expand `#[server]` | `"rust-analyzer.procMacro.ignored": { "leptos_macro": ["server"] }` |

## F. Server functions

| Symptom | Cause | Fix |
|---|---|---|
| Silent deserialisation failure of numbers | `usize`/`isize` across 32-bit WASM ↔ 64-bit server | use `i32`/`i64`/`u32`/`u64` |
| Secret/PII appears in client | returned from a `#[server]` fn (a public POST endpoint) | authenticate **inside** the body; never return secrets |
| Custom error type won't compile (0.8) | not implementing the new error trait | `impl FromServerFnError` with an `Encoder` |
| Big payload slow | default JSON | `#[server(input = Cbor, output = Cbor)]` / `postcard` / `rkyv` |
| Form breaks without JS | not using `<ActionForm>` / non-default encoding | `<ActionForm>` + default `PostUrl`; input `name`s must match arg names |

---

## The Leptos Smell Test (run before declaring done)

1. Every reactive read in `view!` is inside a `move ||` closure — no bare `.get()`/`if`/`match` in the body.
2. Props receive **signals**, not `signal.get()`.
3. No `Effect::new` exists solely to copy one signal into another (→ `Memo`/derived).
4. Every `<For>` has a **stable id** key; mutable rows carry their own signals or a keyed `Store`.
5. No `window`/`document`/`localStorage`/`gloo` reached during render — only inside `Effect::new`.
6. HTML nesting is valid (`<tbody>` present, no block-in-`<p>`).
7. `default = []`; no server-only import is un-`cfg`-gated; `ssr` and `hydrate` never co-active.
8. No `#[server]` fn returns a secret/token/raw PII without an in-body auth check.
9. Expensive derived values use `Memo`, not re-running closures.
10. Collection-item signals are `ArcRwSignal` (or disposed on removal) — no arena leak/disposal panic.

Any failing item = the change isn't done. Persist a one-line summary of any *new* trap you hit to
RuVector (`project-state`) so the next session reuses the fix.
