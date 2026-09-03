# prose-sanitiser-core

Shared vocabulary for the [prose-sanitiser](https://github.com/DreamLab-AI/agentbox)
workspace. No filesystem access, no network, no subprocesses. This crate is the
dependency floor every other layer builds on, which is what makes it safe to
depend on from a library or an editor's hot path.

## What it provides

- `Finding`, `Span`, `Edit` and `Patch`: a scanner result, and an *applyable*
  description of the repair rather than pre-applied text.
- `Severity` (how strongly a tell signals AI authorship) and `ConfidenceTier`
  (whether the rule is right), kept orthogonal on purpose.
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

- [x] `LICENSE-MIT` and `LICENSE-APACHE` present and linked into the crate
- [ ] **Licence position resolved by the operator.** The manifest declares
      `MIT OR Apache-2.0`; ADR-016 (2026-05-16) records first-party code as
      AGPL-3.0-only and the repository root is AGPL-3.0. Unresolved and not
      settled in these docs; the adversarial review of 2026-09-03 records it as
      release-blocking (finding 9). See the workspace README
- [x] `description`, `repository`, `keywords`, `categories`, `readme` set
- [x] Pure Rust: no C dependencies, no subprocesses, no network
- [x] Crate-level `//!` docs stating the honest capability scope
- [x] Every public item documented, with examples that compile
- [x] `cargo doc --no-deps` clean, with no warnings
- [ ] `cargo publish --dry-run` clean
- [ ] Version bumped and `CHANGELOG.md` entry written

## Licence

MIT OR Apache-2.0, at your option.
