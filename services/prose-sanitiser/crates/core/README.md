# prose-sanitiser-core

Shared vocabulary for the [prose-sanitiser](https://github.com/DreamLab-AI/agentbox)
workspace. No filesystem access, no network, no subprocesses. This crate is the
dependency floor every other layer builds on, which is what makes it safe to
depend on from a library or an editor's hot path.

## What it provides

- `Finding`, `Span`, `Edit` and `Patch`: a scanner result, and an *applyable*
  description of the repair rather than pre-applied text.
- Three orthogonal axes, kept apart on purpose: `Severity` (how much it
  matters), `ConfidenceTier` (whether the rule is right) and `Fixability`
  (whether a repair exists at all).
- `Check` and `Fix` traits. `check() -> Vec<Finding>` never mutates and
  `fix() -> Patch` returns a diff the caller chooses to apply.
- `Config` and `ConfigFile`: the run configuration, and a parser for the
  committed `.prose-sanitiser.toml`. Parsing only: the CLI reads the file, so
  this crate keeps its no-I/O invariant.
- `Suppressions`: Vale-style HTML-comment directives
  (`<!-- prose-sanitiser-disable RULE -->`, `-enable`, `-disable-line`,
  `-disable-next-line`, plus Vale's `off` / `on` / `:ignore` spellings), inert in
  every Markdown renderer.
- `LanguageFilter`: a `whatlang` pre-filter so English-only rules never fire on
  other languages. Uncertainty means English, so it can never silently disable a
  rule.
- `Report`, `ReportEntry`, `RuleMeta` and `ToolMeta`: SARIF 2.1.0 (the only
  version GitHub code scanning accepts) and JSON Lines, with the rule table in
  `runs[].tool.driver.rules[]` carrying each rule's confidence tier, `since` and
  `reviewed` dates and sources, and `partialFingerprints` on every result so an
  unrelated edit does not re-open closed alerts.
- The process-shaped helpers the binaries share: `CliError`, `run_cli`, the JSON
  emitters, and the size-cap environment reads.

## Why three axes

Severity and confidence were split because conflating them is how a linter ends
up "correcting" *a driving licence*. Fixability was split for the mirror-image
reason.

The case that forced it: a C2PA soft-binding assertion is either in the manifest
or it is not, so the detection is as certain as anything in the workspace, but
**no repair exists**, because the watermark it points at lives in the pixels,
out of reach of container surgery. The only way to stop that being auto-fixed
used to be filing it as a low-confidence judgement call, which made the most
reliable detection in the crate wear its least reliable label. `properties.
confidence` is exactly the field a reader uses to decide how far to trust a
detection, so that was actively misleading.

`Fixability::default_for(tier)` derives the obvious answer, so a rule states one
explicitly only when it differs:

| Tier | Default fixability |
|---|---|
| `CertainMechanical` | `Mechanical`: applied with no opt-in |
| `HighConfidenceStylistic` | `OptIn`: applied only under `--write` |
| `LowConfidenceJudgement` | `ReportOnly`: never applied |

The fourth variant, `NoFixExists`, has no tier that implies it. It says the
repair is impossible rather than unwise, and `Finding::to_edit` refuses it under
every configuration.

`RuleMeta` deliberately does not carry the field. It is built as a `const` array
literal in four separate crates and Rust has no default field values, so adding
one would break every literal, the opposite of an additive change. Declared
overrides ride in a side table instead: `Config::with_fixability_table`.

## Capability row

| Class | This crate |
|---|---|
| Detects and strips losslessly | Nothing. It has no rules |
| Detects and reports only | Nothing |
| Never touches | Everything. It performs no I/O |

This crate detects nothing and strips nothing. It defines how a finding is
*described*, on **three orthogonal axes**, and the type system is where the
separation is enforced.

| Axis | Answers | Values |
|---|---|---|
| `Severity` | How much does it matter? | `High`, `Medium`, `Low` |
| `ConfidenceTier` | Is the pattern right? | `CertainMechanical`, `HighConfidenceStylistic`, `LowConfidenceJudgement` |
| `Fixability` | Can it be repaired at all? | `Mechanical`, `OptIn`, `ReportOnly`, `NoFixExists` |

Fixability derives from the tier by default, so most rules never state it. A
rule declares one only when it differs, and one case forced the axis into
existence: `media-c2pa-soft-binding`. That detection is *certain*, since a
soft-binding assertion is in the manifest or it is not, but **no fix exists**,
because the watermark is in the pixels and out of reach of container surgery.
Filing it as `LowConfidenceJudgement` to stop it being auto-fixed made the
crate's strongest-evidence finding wear its weakest-evidence label, in exactly
the field a reader consults to decide how far to trust a detection. It now reads
as what it is: certain, and unfixable.

### Declaring a fixability that does not follow the tier

A rule whose repairability differs from its tier says so in a side table rather
than by bending its tier, and `Config::with_fixability_table` applies it. Each
crate declares its own, as a `FIXABILITY` constant beside its `RULES`, so a
library consumer that never links the CLI gets the same answer:

```rust
// prose-sanitiser-media: certain detection, no possible repair.
pub const FIXABILITY: &[(&str, Fixability)] =
    &[("media-c2pa-soft-binding", Fixability::NoFixExists)];

// prose-sanitiser-slop: no rule in the crate emits a replacement, so none of
// them may claim a repair exists, whatever their tier implies.
pub const FIXABILITY: &[(&str, Fixability)] = &[
    ("agg", Fixability::ReportOnly),
    // ... and every other high-confidence structural rule
];
```

`sanitise::fixability_table()` concatenates them and `sanitise::configure`
applies the result, so a rule's declaration is honoured wherever it surfaces.
`Report::with_fixability_table` carries the same table into the SARIF driver
rules, because a `properties.fixability` of `opt-in` on a rule beside
`report-only` on every result for it invites a consumer to trust whichever it
read first.

Declaring goes in both directions, and the second direction is the one that
bit. `NoFixExists` stops a certain detection being repaired; `ReportOnly` stops
a confident *pattern* being mistaken for an available *repair*. Measured on
2,000 documents of British human prose, 566 findings were marked opt-in by
rules that can never produce a replacement — nothing was ever rewritten,
because a finding with no replacement yields no edit, but the label was a
promise the tables could not keep. A workspace test now asserts the invariant in
both directions: a rule marked mechanical or opt-in must produce a replacement
on at least one fixture, and a report-only rule must never produce one.

SARIF carries all three axes on each result: `properties.confidence`,
`properties.severity` and `properties.fixability`, plus `properties.autoFixable`.
A finding with no possible repair also gets `properties.noFixExplanation`,
because **"we will not repair this for you" and "this cannot be repaired by
anyone" are different messages**, and only the tier used to be visible.

### Conservatism belongs in the default, never in the tier

The rule that axis protects, and it is a property of this crate, so it governs
the `uk` and `slop` layers as much as `unicode`.

Downgrading a mechanical classification to buy safe behaviour is tempting and
wrong twice over. It makes the tier lie about the evidence. And it strands a
caller who explicitly asked for the mutation, because `fixable_with_opt_in()`
returns false for `LowConfidenceJudgement`: their `to_edit` returns `None`, and
the patch silently stops matching what the cleaner does.

So conservatism lives in the *default*, expressed as a policy flag the caller
can turn on. Exotic whitespace and homoglyph folding are both `CertainMechanical`
and both withheld by default, which is coherent precisely because the two
questions are answered separately.

## Example

```rust
use prose_sanitiser_core::{ConfidenceTier, Severity};

// Confidence is the auto-fix gate, and it is deliberately conservative.
assert!(ConfidenceTier::CertainMechanical.auto_fixable());
assert!(!ConfidenceTier::HighConfidenceStylistic.auto_fixable());
assert!(ConfidenceTier::HighConfidenceStylistic.fixable_with_opt_in());

// A judgement-tier finding can never be applied, opt-in included.
assert!(!ConfidenceTier::LowConfidenceJudgement.fixable_with_opt_in());

// Severity is a separate axis: it rates impact, not correctness.
assert_eq!(Severity::High.weight(), 3);
```

Fixability is the third axis, and defaults to whatever the tier implies:

```rust
use prose_sanitiser_core::{ConfidenceTier, Fixability};

assert_eq!(
    Fixability::default_for(ConfidenceTier::CertainMechanical),
    Fixability::Mechanical
);

// Certain detection, no possible repair: never applied, under any setting.
assert!(!Fixability::NoFixExists.fixable_with_opt_in());
```

A suppression directive is read out of the document itself, not configured:

```rust
use prose_sanitiser_core::Suppressions;

let document = "<!-- prose-sanitiser-disable tier1-vocab -->\nWe delve, deliberately.\n";
let suppressions = Suppressions::parse(document);
assert!(suppressions.is_suppressed("tier1-vocab", document.len() - 2));
assert!(!suppressions.is_suppressed("hedge-words", document.len() - 2));
```

Implementing a rule means implementing `Check`; see the trait's own rustdoc for
a complete worked example.

## Where the rest lives

Detection lives in `prose-sanitiser-unicode`, `prose-sanitiser-uk` and
`prose-sanitiser-slop`. Filesystem and subprocess helpers live in
`prose-sanitiser-media`.

## Publishing checklist

Publication candidate. Before `cargo publish`:

- [x] **Licence position settled.** `MIT OR Apache-2.0` per ADR-2030
      (2026-09-03, accepted): `services/` crates are permissive per crate, the
      containing repository stays AGPL-3.0-only, and the grant travels with the
      crate. `LICENSE-MIT` and `LICENSE-APACHE` present and linked
- [x] `description`, `repository`, `keywords`, `categories`, `readme` set
- [x] Pure Rust: no C dependencies, no subprocesses, no network
- [x] Crate-level `//!` docs stating the honest capability scope
- [x] Every public item documented, with examples that compile
- [x] `cargo doc --no-deps` clean, with no warnings
- [ ] `cargo publish --dry-run` clean
- [ ] Version bumped and `CHANGELOG.md` entry written

## Licence

**MIT OR Apache-2.0**, at your option.

Per [ADR-2030](../../../../docs/adr/ADR-2030-permissive-licensing-for-publishable-service-crates.md), crates under `services/` are
permissive per crate while the containing repository stays AGPL-3.0-only.
That is not a contradiction: the AGPL governs the aggregate hosted service,
not the licence of each part, and this grant travels with the crate.
