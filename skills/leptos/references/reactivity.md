# Reactivity Reference — Signals, Effects, Control Flow, State, Performance

> Anchored to Leptos **0.8.x** (the 0.7 "tachys"/`reactive_graph` rewrite). Verify exact
> signatures against `docs.rs/leptos` for your pinned version. `0.9-alpha` adds function-call
> reads (`count()` for `count.get()`).

---

## 1. Signal primitives

| Primitive | Copy | `Send+Sync` | Storage | Use for |
|---|---|---|---|---|
| `RwSignal<T>` | yes | yes | arena | **default**; combined read/write handle |
| `ReadSignal<T>` + `WriteSignal<T>` | yes | yes | arena | when split read/write matters (from `signal()`) |
| `ArcRwSignal<T>` | no (Clone) | yes | `Arc<RwLock>` | **dynamic collections**, cross-owner lifetime |
| `Memo<T>` | yes | yes | arena | derived/**cached** computation |
| `ArcMemo<T>` | no | yes | Arc | memos outliving their scope |
| `Signal<T>` | yes | yes | type-erased | accept *any* reactive value in a fn/prop API |
| `ArcSignal<T>` | no | yes | Arc | same, Arc lifetime |
| `Trigger` | yes | yes | arena | data-less notify/track (invalidate on external change) |
| `StoredValue<T>` | yes | yes | arena | **non-reactive** stable Copy handle (config/constants) |

`!Send` values (e.g. some `web_sys` types): use `RwSignal::new_local()` / `signal_local()`.

```rust
// ✅ canonical (0.7+)
let (count, set_count) = signal(0i32);   // (ReadSignal, WriteSignal)
let count = RwSignal::new(0i32);          // combined
let (r, w) = count.split();               // split an RwSignal
// ❌ deprecated: create_signal / create_rw_signal / create_memo / create_effect
```

### Read / write methods
```rust
let count = RwSignal::new(0i32);
// READS — reactive (subscribe current observer)
count.get();            // clone T, track
count.read();           // guard deref &T, track
count.with(|v| *v * 2); // &T closure, track — avoids clone (use for big types)
// READS — untracked (no subscription)
count.get_untracked();  count.with_untracked(|v| *v);
// WRITES — notify subscribers
count.set(42);
count.update(|v| *v += 1);  // ✅ prefer over get→set
count.write().push_str(""); // mutable guard, notifies on drop (no clone)
```

### Derived signal vs `Memo` vs `Signal::derive`
```rust
let (count, _) = signal(1i32);
let doubled      = move || count.get() * 2;        // re-runs every read, NO cache
let doubled_memo = Memo::new(move |_| count.get() * 2); // cached, notifies only if output changes
// Accept any reactive in an API without a generic:
fn show(v: Signal<i32>) -> impl IntoView { view! { <p>{v}</p> } }
show(count.into());                 // ReadSignal → Signal
show(Signal::derive(doubled));      // closure → Signal (NOT cached — Memo for expensive)
```

### `Trigger` — invalidate on non-signal change
```rust
let t = Trigger::new();
t.track();   // in a memo/effect: subscribe without a value
t.notify();  // in the producer: re-run all subscribers
```

---

## 2. Closures, `move ||`, cloning, ownership, disposal

**Why signals are `Copy`:** arena signals are integer IDs into a central store — you hold a
handle, not the data. Copying the ID is cheap and safe. `ArcRwSignal` is ref-counted (`Clone`).

```rust
// ✅ signals are Copy — just move them, even into many closures
let count = RwSignal::new(0);
let inc = move |_| count.update(|n| *n += 1);
let dbl = move || count.get() * 2;        // count copied again — fine
view! { <button on:click=inc>{dbl}</button> }
```

**Clone the VALUE vs clone the SIGNAL** — the classic reactivity bug:
```rust
let name = RwSignal::new(String::from("Alice"));
let bad  = format!("Hello, {}", name.get());     // ❌ runs once, static, dead
let good = move || format!("Hello, {}", name.get()); // ✅ closure defers → reactive
```
For non-`Copy` `ArcRwSignal` shared across closures, clone the *signal* (cheap Arc bump):
```rust
let n = ArcRwSignal::new(String::from("Alice"));
let (a, b) = (n.clone(), n.clone());
let edit = move |_| a.update(|s| s.push('!'));
let show = move || b.get();
```

### Owner / scope & disposed-signal panics
Every reactive primitive belongs to the currently-running owner (effect/memo/component). When
an owner re-runs, it **disposes its children first**. An arena signal created inside a branch
and stored outside it is disposed when the branch changes → **panic on next access**.

Fixes:
- **`ArcRwSignal`** for anything in a dynamic collection — lives while any clone exists, independent of the owner tree. (Primary fix for TodoMVC-style lists.)
- **`.try_get()` / `.try_with()`** → `Option<T>` (`None` if disposed) instead of panic.
- **Create in the parent scope**, pass down — parent outlives child.
- **`on_cleanup(move || sig.dispose())`** when removing an item, to avoid arena leaks.

```rust
// ✅ per-item Arc signals in a list — no disposal panic, no leak
let items: RwSignal<Vec<ArcRwSignal<Todo>>> = RwSignal::new(vec![]);
```

---

## 3. Effects

| Deprecated | New (0.7+) |
|---|---|
| `create_effect(f)` | `Effect::new(f)` |
| `create_render_effect(f)` | `RenderEffect::new(f)` |
| `watch(deps, f, imm)` | `Effect::watch(deps, f, imm)` |

```rust
// Runs on next tick, re-runs when tracked signals change; receives previous return value
Effect::new(move |prev: Option<i32>| {
    leptos::logging::log!("a={}, prev={:?}", a.get(), prev);
    a.get()
});
// Server + client:
Effect::new_isomorphic(move |_| { /* ... */ });
// Explicit deps + stoppable handle:
let h = Effect::watch(move || num.get(), move |val, prev, _| { /* untracked */ }, false);
h.stop();
```

**Effects are for the OUTSIDE world only** (DOM, console, WebSocket, localStorage). Syncing one
signal into another via an effect is an anti-pattern — use a derived signal / `Memo`:
```rust
Effect::new(move |_| set_b.set(a.get() * 2)); // ❌ messy dataflow, extra renders
let b = Memo::new(move |_| a.get() * 2);       // ✅ clear, deduped
```
Browser-only work (and anything non-deterministic) goes in an effect so it does **not** run
during SSR — see hydration rules in `fullstack.md`.

---

## 4. Control flow

```rust
// <Show> — memoizes `when`; tears down branch only on true↔false flip
<Show when=move || count.get() > 5 fallback=|| view!{ <Small/> }>
    <BigExpensive/>
</Show>

// Cheap inline conditional (more efficient than <Show> for text)
<p>{move || if is_odd() { "Odd" } else { "Even" }}</p>

// Branches of different element types → type-erase
{move || match s.get() {
    S::A => view!{ <div>"A"</div> }.into_any(),
    S::B => view!{ <span>"B"</span> }.into_any(),
}}
```

### `<For>` — keyed lists
```rust
<For each=move || items.get() key=|i| i.id let(item)>
    <li>{item.name}</li>
</For>
```
- The `key` decides when a row is **destroyed/recreated**. **Never use the index** for reorderable lists.
- If the key stays the same but data changes, the child must read a **signal** to see the update — so give each mutable row its own `RwSignal` fields, or use a keyed `Store`:
```rust
#[derive(Clone)] struct Row { id: u32, value: RwSignal<i32> } // per-field signal
// or
#[derive(Store)] struct AppState { #[store(key: u32 = |r| r.id)] rows: Vec<Row> }
```
- Need the index reactively? Use `<ForEnumerate>` (plain `<For>` + `enumerate()` goes stale on reorder).

### Async boundaries
```rust
// <Suspense>: show fallback while ANY inner resource is pending; re-shows on reload
<Suspense fallback=|| view!{ <p>"Loading…"</p> }>
    {move || data.read().map(|d| view!{ <DataView d/> })}
</Suspense>

// <Transition>: keeps PREVIOUS content visible during reload (no flash on navigation/pagination)
<Transition fallback=|| view!{ <Spinner/> }>
    {move || data.read().map(|d| view!{ <List items=d/> })}
</Transition>

// <Await>: poll a future exactly once, non-reactive
<Await future=fetch_config() let:cfg>
    <p>"Server: " {cfg.url.clone()}</p>
</Await>
```

### `<ErrorBoundary>`
`Result<T, E>` is `IntoView` when `E: std::error::Error`; `Err` renders nothing and bubbles up.
```rust
<ErrorBoundary fallback=|errors| view!{
    <ul>{move || errors.get().into_iter()
        .map(|(_, e)| view!{ <li>{e.to_string()}</li> }).collect_view()}</ul>
}>
    <p>"Value: " {move || value.get()}</p>
</ErrorBoundary>
```
Combine with `<Transition>` to surface async/server-fn errors.

---

## 5. State management

```rust
// Context — provide once, consume at any depth (no prop drilling)
provide_context(count);                                   // in an ancestor
let count = use_context::<ReadSignal<u32>>().expect("…"); // or expect_context::<_>()
```
Fine-grained: a context signal only re-renders **where it is read**, not intermediate components.

### `reactive_stores` — structured reactive state with field-level granularity
```rust
use reactive_stores::Store;

#[derive(Clone, Default, Store)]
struct GlobalState { count: i32, name: String }

provide_context(Store::new(GlobalState::default()));     // root
// consumer reacts to `count` only, not `name`:
let state = expect_context::<Store<GlobalState>>();
let count = state.count();                                 // Field<i32>
view! { <button on:click=move |_| *count.write() += 1>{move || count.get()}</button> }
```
`#[derive(Patch)]` enables `state.patch(new)` — notifies only the fields that changed. Internally
a `Store` is `Arc<RwLock<T>>` + a path-keyed `Trigger` map.

**When to lift state:**

| Scenario | Pattern |
|---|---|
| Two siblings share a value | Lift to parent; pass `ReadSignal` down, write via callback/context |
| Value needed many levels deep | `provide_context` at lowest common ancestor |
| Complex struct, many fields | `Store<T>` via context |
| Truly global (auth/theme/locale) | `Store<T>` or `RwSignal` at app root via context |

---

## 6. Performance idioms (fine-grained reactivity)

- **No VDOM:** `view!` compiles to a typed tree of DOM mutations; a signal change updates only the bound text node / attribute / class. Zero diffing — so the win is **keeping signals granular**.
- **Granular state:** separate signals (or `Store` fields) over one mega-`RwSignal` that re-fires everything.
- **`Memo` to dedupe** propagation to many subscribers / expensive computations / comparator keys. (For a shallow value read once per render, a plain closure is cheaper — `Memo` has a small equality-check cost.)
- **`.with()` over `.get()`** for large types (borrow, don't clone): `items.with(|v| v.len())`.
- **Mutate in place:** `items.write().push(x)` / `items.update(|v| v.push(x))` — never `get → mutate → set` (clones the whole value).
- **`batch(|| { a.set(..); b.set(..); })`** when mutating multiple signals outside a reactive context (within event handlers/effects, updates already batch).
- **`StoredValue`** for non-reactive data you want a cheap Copy handle to.

---

## Deprecated → replacement quick map

| Deprecated | Replacement |
|---|---|
| `create_signal(v)` | `signal(v)` |
| `create_rw_signal(v)` | `RwSignal::new(v)` |
| `create_memo(f)` | `Memo::new(f)` |
| `create_effect(f)` | `Effect::new(f)` |
| `create_render_effect(f)` | `RenderEffect::new(f)` |
| `watch(deps, f, imm)` | `Effect::watch(deps, f, imm)` |
| `use_context::<T>().unwrap()` | `expect_context::<T>()` |
| `use leptos::*` | `use leptos::prelude::*` |

**Sources:** [book.leptos.dev](https://book.leptos.dev/) · [working with signals](https://book.leptos.dev/reactivity/working_with_signals.html) · [control flow](https://book.leptos.dev/view/06_control_flow.html) · [iteration](https://book.leptos.dev/view/04b_iteration.html) · [errors](https://book.leptos.dev/view/07_errors.html) · [global state](https://book.leptos.dev/15_global_state.html) · [lifecycle appendix](https://book.leptos.dev/appendix_life_cycle.html) · [reactive_stores](https://docs.rs/reactive_stores) · [docs.rs/leptos](https://docs.rs/leptos/latest/leptos/)
