# prose-sanitiser-core

Shared vocabulary for the [prose-sanitiser](https://github.com/DreamLab-AI/agentbox)
workspace. No filesystem access, no network, no subprocesses — this crate is the
dependency floor every other layer builds on.

## What it provides

- `Finding`, `Span`, `Edit` and `Patch` — a scanner result and an *applyable*
  description of the repair, never pre-applied text.
- `Severity` (how strongly a tell signals AI authorship) and `ConfidenceTier`
  (whether the pattern is right), kept orthogonal on purpose.
- `Check` and `Fix` traits: `check() -> Vec<Finding>` never mutates, and
  `fix() -> Patch` returns a diff the caller chooses to apply.
- `Config`, plus the process-shaped helpers the binaries share (`CliError`,
  `run_cli`, the JSON emitters, size-cap environment reads).

## Honest scope

This crate detects nothing and strips nothing. It defines how a finding is
*described*. Only `ConfidenceTier::CertainMechanical` findings — invisible
Unicode, container metadata, homoglyphs — may ever be auto-fixed; sense-dependent
spelling, slop phrasing and organisation-adjacent tokens are report-only by
construction.

Detection lives in `prose-sanitiser-unicode`, `prose-sanitiser-uk` and
`prose-sanitiser-slop`; filesystem and subprocess helpers live in
`prose-sanitiser-media`.

## Licence

MIT OR Apache-2.0.
