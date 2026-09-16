# evals/

Trigger-and-behaviour evals for `system-one`, in the estate's format (see
`../../diagrams-as-code/evals/` for the shape). Each case is a realistic user prompt
plus the behaviour a correct run exhibits — not an exact transcript.

Two things are under test and they fail differently:

- **Routing** — does this skill trigger at all? Cases 1, 2 and 5 are phrased the way a
  user actually asks, including the bare "use jev" form, and none of them name the
  skill.
- **Discipline** — given that it triggered, does the run read the live docs rather than
  recalling the API, batch its questions, and stop at the egress boundary instead of
  sending private content? Cases 3 and 4 exist to catch the two failures that matter:
  a fabricated API contract, and a private state posted to a third party.

These are foundation cases covering the skill as written. They will need extending
once any integration point in `../references/estate-integration.md` is built.
