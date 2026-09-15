# Evals: is the corpus checkable, or just present?

`evals.json` holds the prompts, in the shape `skill-creator`'s benchmark loop
reads (`skill_name` plus an `evals` array of `{id, prompt, expected_output,
files}`). Four cases, one per thing this skill is asked to do: **create** a
corpus (1), **verify** an existing one against HEAD (2), **extend one and hand
off** to a client-facing deliverable (3), and **gate** one in CI (4).

Run them the way `skill-creator` runs a with/without-skill A/B — two subagent
runs per case against the same target repository, then grade. The point of the
A/B here is narrow and worth stating: an agent without this skill will produce
diagrams. It will not produce *citations that resolve at a declared revision*, a
register that falls out of the writing, or a re-stamp that leaves untouched
topics alone. Those are what the grades should turn on.

## Measure before you judge

Almost everything that matters is mechanically checkable, and the checker is the
skill's own generator. For each run, against the corpus it produced or touched:

```bash
G=skills/diagrams-as-code/scripts/diagram-index-gen.cjs
node $G <corpus> --check                                   # structure: must exit 0
node $G <corpus> --check --cite-check                      # warning count and classes
node $G <corpus> --check --render                          # grammar + 4500px ceiling
node $G <corpus> --report <run-dir>/diagrams.json          # the numbers to grade on
```

From the report, the figures that separate a real corpus from a plausible one:

| Figure | Reading |
|---|---|
| `totals.citationsChecked` | citations actually resolved. Low against the diagram count means most claims were never verified |
| `citations.warnings[].message` containing `unresolvable` | citations whose file is absent from `sources:` — verified by nothing |
| `totals.register` | a corpus with diagrams but a near-empty register found nothing, which is itself a finding |
| `topics[].verified_commit` | present, and a sha the repository actually has. A missing or invented stamp fails the case outright |
| `topics[].worktree` | set on a topic read from a clean tree is dishonest; unset on one read dirty is worse |
| `diagrams[].svg` | null across the board means the corpus was never rendered |

For case 2, the grade is whether the run **re-stamped only the topics whose own
sources moved**: diff each topic's `sources:` between the old and new sha and
compare against which `verified_commit` values changed. A run that re-stamped
everything claimed verification it did not do, and should score below a run that
re-stamped three topics and said so.

For case 3, add the ringfence check: grep the client-facing output for topic ids
(`\b[A-Z]{2,4}-\d{2}\b`), for the marker words (`Tension`, `Debt`, `Drift`),
and for marker numbering (`T-0`, `D-0`, `I-0`). Any hit is a ringfence breach
regardless of how good the prose is.

## What a grader agent still has to judge

Only what no script can settle: whether a diagram describes the system, whether
the developer narrative teaches, whether the business narrative would survive
being read by the person it names, and whether a register marker is a finding or
an opinion. Give the grader the measurements above and the transcript, and let it
rule on those four things alone.

## Target repositories

Use a real corpus, not a fixture — the failure modes only appear at scale. Two
exist in the estate, and both are read-only for eval purposes:

- a single-repository corpus (six areas, ~57 topics, bare and `{repo: sha}`
  stamps, a populated register)
- a multi-repository estate corpus (one area per repository, `{repo: sha}` maps
  throughout, no dual narratives — useful for case 2 and 4, not for case 1)

For case 1, point the run at a repository with **no** corpus and seed nothing.
For case 2, copy a corpus to a scratch directory, roll the target repository
forward some commits, and run against the copy — never against the live tree,
which another agent may be editing. Archive each run's corpus afterwards and
leave the target as it was found.
