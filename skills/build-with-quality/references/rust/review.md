
# Rust review

Adapted from BeautifulRust's `rust-review` skill (MIT, see [NOTICE.md](./NOTICE.md)).
Review Rust code against the same rules [steering.md](./steering.md) uses for writing
it, and report what to change. The output is a review, not a rewrite: the reader decides
what to fix. Only rewrite code when the user asks for that.

## 1. Decide the scope

- **What to read.** Review exactly what the user pointed at: a file, a module, a crate,
  or a diff. For a diff, review the changed lines and anything they break, not the whole
  file.
- **Library or application.** Check for a `lib.rs`, `pub` items used by other crates, or
  a published `Cargo.toml`. Library code is held to the API-design rules strictly.
  Application code gets the simplicity rules instead: concrete types, `anyhow`-style
  errors, and no speculative generality. Say which you assumed at the top of the report.
- **The edition and MSRV**, from `Cargo.toml`, so you don't recommend features the
  project can't use.
- **Frameworks.** If the crate depends on `bevy` or `bevy_ecs`, fetch the Bevy digest
  first (see the References list at the end of [steering.md](./steering.md)). It lists the Bevy
  conventions to leave alone (by-value system parameters, the prelude, plain-data
  components) and the ECS bugs to look for.

## 2. Run the tools first, if you can

If a Rust toolchain is available, run these from the crate root and fold the results into
the report. They catch the mechanical issues, which leaves you free for design.

```bash
cargo fmt --check
cargo clippy --all-targets -- -W clippy::pedantic   # feature set per steering.md section 0
cargo test
```

Don't paste raw clippy output. Group repeated warnings into one finding, and skip pedantic
lints that don't matter for this code. If the tools aren't available, say so in the report
and review by reading.

## 3. What to look for, in priority order

Work through these in order. The first two categories are where real bugs live.

**Correctness and soundness**

- Undefined behavior: an `unsafe` block without a `// SAFETY:` comment, `transmute` to
  cast enums or extend lifetimes, `unsafe impl Send`/`Sync` used to silence the compiler,
  or a safe function that can cause UB through safe calls (unsound).
- Panics on reachable paths: `unwrap()`, `expect()`, indexing, `as` casts that wrap, or
  integer overflow, wherever input from outside can reach them.
- Trait contracts: a hand-written `Ord` with a derived `PartialEq`, or `Hash` that
  disagrees with `Eq`. These silently corrupt `BTreeMap`, `HashMap`, `sort`, and `dedup`.
- Lock hazards: a `MutexGuard` held across `.await` or returned to a caller, user
  closures called under a lock, or a poisoned lock recovered with `into_inner`.
- ECS bugs in Bevy code: two queries that can reach the same component mutably (a
  B0001 panic on the first frame), systems that read each other's results with no
  order between them, and deferred `Commands` read back before they apply.
- Destructors that panic, block, or can fail.

**Error handling**

- Errors that callers can't use: `()`, `String`, or `Box<dyn Error>` as a library's
  public error type, an error enum without `Display` and `std::error::Error`, or
  `anyhow::Error` in a library's public API.
- Errors that lose information: `map_err(|_| ...)`, no `source()`, or messages without
  the path, line, or value that failed.
- Panics used for expected failures, or `catch_unwind` used as control flow.

**API design** (strict for libraries)

- Parameters: `&String`, `&Vec<T>`, or `&Box<T>` instead of `&str`, `&[T]`, or `&T`; a
  `bool` parameter in a public signature; ownership taken and then cloned, or a borrow
  cloned internally to get ownership; `impl Into<T>` in application code, or on a library
  function too rarely called to justify a copy per argument type.
- Return types: a library function that collects into a `Vec` only to return it, when an
  iterator would do. Owned results are fine when callers need ownership or random access,
  or when building the collection is the function's job.
- Visibility: public fields that should be private, `Rc`, `RefCell`, or `Arc` in public
  signatures, or third-party types leaking into the API.
- Missing standard traits: `Debug` on public types, `Display` on errors, `Default` next to
  a zero-argument `new()`, and `FromStr` instead of an ad-hoc `from_str` method.
- Naming: `get_` prefixes on getters, `as_`/`to_`/`into_` that don't match their cost and
  ownership, and `Manager`/`Service`/`Util` names.
- Evolution: public enums or structs that should be `#[non_exhaustive]`, or traits that
  should be sealed.

**Idiom and clarity**

- Clones that exist only to satisfy the borrow checker.
- Check-then-unwrap (`if x.is_some() { x.unwrap() }`), and `match` where a combinator is
  clearer, or the reverse.
- String building with `+`, hand loops that are clearer as iterators, or iterator chains
  long enough to need a loop.
- `HashMap` iteration order leaking into output or tests.
- `#![deny(warnings)]` in source, `#[allow]` without a reason, and glob imports of
  external crates (a framework's documented prelude, such as `bevy::prelude`, is fine).

**Documentation and tests**

- Public items without docs, and docs that restate the name.
- Missing `# Errors`, `# Panics`, or `# Safety` sections where they apply.
- Doc examples that use `unwrap()` instead of `?`.
- Logic with no tests, or tests that only restate constants.

[steering.md](./steering.md) and its [sources/](./sources/) digests hold the full rules and
their reasoning, including the estate overlay (crypto, publication, feature sets). Read
the relevant one when a finding needs a rule you're unsure of. A hand-rolled crypto
primitive is always **Must fix**.

## 4. Write the report

Use this structure:

~~~markdown
# Rust review: <what was reviewed>

<One paragraph: what the code does, library or application, overall verdict, and the
single most important thing to fix. Say whether clippy and tests were run.>

## Must fix
### 1. <Short title> (`src/file.rs:42`)
**Rule:** <rule name and source, e.g. "Errors implement std::error::Error (C-GOOD-ERR,
Rust API Guidelines)">
**Problem:** <what is wrong and the concrete consequence, one or two sentences>
**Fix:**
```rust
<the smallest code change that fixes it>
```

## Should fix
### 2. ...

## Consider
### 3. ...

## What's already good
- <2 to 4 specific things the code does well>
~~~

How to sort findings:

- **Must fix** means a bug, a soundness hole, a reachable panic, or an API mistake that
  becomes a breaking change once published.
- **Should fix** means it works but violates a rule with a real cost, such as worse error
  messages, harder testing, or a confusing API.
- **Consider** means style, naming, and polish.

Rules for each finding:

- **Cite a location** as `file:line` for every finding (write `whole file` for a finding
  that has no single location, such as missing tests), and cite the rule with its source:
  an API Guidelines code such as `C-GETTER`, an Effective Rust item number, a Microsoft
  guideline code such as `M-PANIC-ON-BUG`, a clippy lint name, or "Google Rust Style
  Guide". A reader should be able to look the rule up.
- **Show the fix as code**, kept to the lines that change. Don't rewrite whole functions.
- **Group repeats.** One finding for "eight `unwrap()` calls on parse results", listing
  the lines, rather than eight findings.
- **Respect intent.** If something looks deliberate, such as a documented quirk or a
  comment explaining it, mention it under Consider with the trade-off. Don't mark it
  Must fix.
- **Keep it proportionate.** For a short file, five to ten findings is plenty. Don't pad
  the list, and don't hide a real bug among style nits.
- **"What's already good" is required.** It tells the author what to keep and makes the
  rest credible.

## 5. Offer the lints

If the project lacks a `[lints]` table, or has an empty one, end the report by suggesting
the vendored lints config ([lints/lints.toml](./lints/lints.toml) and
[lints/clippy.toml](./lints/clippy.toml)). It makes clippy catch most of the
mechanical findings above automatically. Name two or three findings from this review that
it would have caught.

## 6. Hand findings to the build

Inside a build-with-quality run a review is input, not a verdict. Every **Must fix** and
**Should fix** finding goes through the
[review findings intake](../quality-gates-and-workflow.md#review-findings-intake): show it
with a failing test, a clippy line or a citation, then fix it test-first. Close a finding
you cannot show as `rejected`, with the evidence. A clean review is not evidence of
correctness.
