# Authoring guidance from the sealmap evidence

Measured results behind these rules: [sealmap-review evidence](../../sealmap-review/references/evidence.md).

## Keep the mix of diagram kinds

Do not convert flowcharts, class or state diagrams into sequence diagrams to
"simplify" a corpus. A corpus of sequence diagrams alone reviewed worse than the
mixed one, and a sequence-first rewrite invented facts: 14 of 15 invented claims
were an order or concurrency the original never stated, because a sequence
diagram asserts order by drawing it. If the code does not fix an order, draw a
flowchart or a class diagram, or say in the prose that the order is unspecified.
A fidelity gate for such a rewrite must list every ordering or concurrency the
original does not state, and any entry fails.

## Cite narrow, stable code

Prefer a small, stable function over a composition root or a configuration hot
spot: `main()`, large constructors, compose or TOML files, a 4,000-line
`index.ts`. Every commit touches those, so every topic citing them is flagged
stale on every commit and the upkeep cost lands on the whole corpus. When the
fact genuinely lives there, cite the narrowest line that proves it, and cite the
stable callee as well where one exists.

## What the citation checker does not catch

The checker flags a cited line that is blank, a lone brace, or out of range. A
line that is wrong but non-empty passes. `--cite-check` proves the line exists,
not that it supports the claim; only a reader (an inline review, see
`sealmap-review`) catches a plausible wrong line.

## Drafting a skeleton for Rust

For a Rust repository, `sealmap generate` and `sealmap dense` (on PATH in the
image) can draft a starting skeleton for a topic's sequence diagrams from the
real call tree: participants, callees and their order. Treat it as a draft. The
author still owns the meaning, the choice of what to show and every citation,
and re-checks each drawn edge against the code.
