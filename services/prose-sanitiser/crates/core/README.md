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
- `Config`, plus the process-shaped helpers the binaries share: `CliError`,
  `run_cli`, the JSON emitters, and the size-cap environment reads.

## Capability row

| Class | This crate |
|---|---|
| Detects and strips losslessly | Nothing. It has no rules |
| Detects and reports only | Nothing |
| Never touches | Everything. It performs no I/O |

This crate detects nothing and strips nothing. It defines how a finding is
*described*. Only `ConfidenceTier::CertainMechanical` findings, meaning
invisible Unicode, container metadata and homoglyphs, may ever be auto-fixed.
Sense-dependent spelling, slop phrasing and organisation-adjacent tokens are
report-only by construction, and the type system is where that is enforced.

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

Implementing a rule means implementing `Check`; see the trait's own rustdoc for
a complete worked example.

## Where the rest lives

Detection lives in `prose-sanitiser-unicode`, `prose-sanitiser-uk` and
`prose-sanitiser-slop`. Filesystem and subprocess helpers live in
`prose-sanitiser-media`.

## Publishing checklist

Publication candidate. Before `cargo publish`:

- [x] `LICENSE-MIT` and `LICENSE-APACHE` present and linked into the crate
- [ ] **Licence position settled with the copyright holder.** ADR-016
      (2026-05-16, licence consolidation) records all first-party code as
      AGPL-3.0-only, having "eliminated remaining MIT designations from
      sub-package manifests", and the repository root is AGPL-3.0. Ten
      `services/*` crates declare `MIT OR Apache-2.0` against that ADR. Adding
      the licence texts did not resolve the conflict. A hard publication
      blocker: see the workspace README
- [x] `description`, `repository`, `keywords`, `categories`, `readme` set
- [x] Pure Rust: no C dependencies, no subprocesses, no network
- [x] Crate-level `//!` docs stating the honest capability scope
- [ ] Every public item documented, with examples that compile
- [ ] `cargo doc --no-deps` clean, with no warnings
- [ ] `cargo publish --dry-run` clean
- [ ] Version bumped and `CHANGELOG.md` entry written

## Licence

MIT OR Apache-2.0, at your option.
