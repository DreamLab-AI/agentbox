# prose-sanitiser-slop

Deterministic AI writing-tell scanners for
[prose-sanitiser](https://github.com/DreamLab-AI/agentbox). No model, no
network, no rendering.

- `prose` — AI writing tells in prose and Markdown (behind the `slop-scan`
  binary), scored by Tier-1/Tier-2 weighting.
- `design` — design anti-patterns in source (behind the `slop-detect` binary).
- `rules` — the rule tables themselves, with severity attached to each entry.

## Honest scope

Everything here **detects and reports; none of it strips**.

These are population-level signals, not forensic ones. Lexical markers are well
quantified across large corpora, but no single marker identifies a document. A
clean scan is not evidence of human authorship, and a dirty one is not evidence
of a model. Treat a finding as a prompt to look, never as a verdict.

Lexical markers also decay as models update, so the tables are a snapshot rather
than a constant.

The UK-English rule in the prose table is owned by `prose-sanitiser-uk`; this
crate references its constants so the two cannot drift.

## Licence

MIT OR Apache-2.0.
