# prose-sanitiser-uk

UK-English spelling enforcement for
[prose-sanitiser](https://github.com/DreamLab-AI/agentbox).

## Current state

One rule, `us-spelling`: a single flat alternation over the common Americanisms.
It is the single source of truth for that pattern — `prose-sanitiser-slop`
embeds these constants rather than keeping a second copy.

```rust
let findings = prose_sanitiser_uk::check("We optimize the color scheme.");
assert_eq!(findings.len(), 2);
```

## Honest scope

Findings are **report-only**. None carries a `replacement`, so nothing here can
auto-fix under any configuration.

That is deliberate, because the current pattern has no sense disambiguation, no
proper-noun protection and no code-span exclusion. It matches:

- `meter` in *gas meter* (British English keeps *meter* for the instrument and
  uses *metre* only for the SI unit).
- `license` as the British verb (*to license a doctor*), which is correct.
- `catalog`, `fulfill`, `dialog` and organisation names such as *World Health
  Organization*, which is `-ize` by charter.

Every one of those is classified `ConfidenceTier::LowConfidenceJudgement` and
surfaced for a human to weigh.

## Licence

MIT OR Apache-2.0.
