# scripts/ — not built yet

Placeholder for the tooling this skill will need. Named here so the shape is agreed
before anything is written; an empty promise in a reference file is worse than an
explicit "not built".

Planned, in the order they earn their place:

1. **`probe.mjs`** — one-shot: send a state + question set, print the full answers with
   distributions. The thing you reach for while designing a judgment set, so the
   feedback loop is a second rather than a code change. Reads `TYPESAFE_API_KEY` from
   the environment; refuses to run without it rather than failing at the transport.
2. **`evalset.mjs`** — run a fixture file (state, questions, expected application
   behaviour) and report per-case outcome, the threshold sweep, and calibration
   buckets. This is what `../references/evaluation.md` assumes exists.
3. **`redact.mjs`** — only if the middle-ground data classes in
   `../references/data-boundary.md` are actually approved. Mechanical, tested,
   assertable; a redaction that cannot be asserted is not one.

Estate conventions when these get written: zero-dependency Node >= 18 where possible
(the `diagram-index-gen.cjs` precedent), or a Rust client crate if the call site turns
out to belong in a service rather than an agent session — see
`../references/estate-integration.md` §Cross-cutting open questions 1.
