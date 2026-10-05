# Inline review: the local fidelity loop

The external review never sees code. The inline review exists to check the
code: does each topic still tell the truth about it? It runs while a topic is
written, re-stamped or touched by a code change, as a back-and-forth with
whoever owns the topic.

## Which topics

- **A topic just written or edited:** that topic.
- **After a code change:** the topics whose `sources:` include a changed file.
  For example:

  `git diff --name-only <topic's verified_commit>..HEAD -- <sources>`

  For each topic, list the files changed since its declared revision.
- **Before an external review of a corpus you have not touched in a while:**
  the topics with the oldest `verified_commit`, oldest first.

## Model

Use Sonnet by default. Use Opus for topics about security, custody, identity,
money, or anything a Tension already marks as contested. Prefer a different
family from the author's: if a GLM or Gemini model wrote the topic, review it
with Claude, and the reverse. A reviewer from the author's family shares the
author's blind spots.

## Subagent brief (copy and fill)

```
You are reviewing one diagrams-as-code topic for fidelity to the code it cites.
Read-only: do not edit any file.

Topic: <path to the topic .md>
Repository root(s): <path, or one per repo for a multi-repo corpus>
Declared revision: <verified_commit>. Read the code at that revision
(git show <sha>:<path>) unless told the topic is being re-stamped against HEAD.

For every diagram and every prose claim that carries a path:line citation,
read the cited lines and the enclosing function, and judge the claim. Report
only faults, each as:

### F-01 — one-line title
- Topics: <topic id and diagram id>
- Evidence: <the claim as written> vs <what the code at path:line does>
- Failure: <what a reader of the topic would wrongly believe>
- Confidence: high, medium or low
- Class: wrong-callee | missing-call | invented-edge | stale-claim |
  adr-contradiction | unsupported-claim | code-defect

Use class code-defect when the topic is accurate and the code itself is wrong.
End with one line: "checked N citations, M faults".
```

## Fault classes

| Class | Meaning | Fix lands in |
|---|---|---|
| wrong-callee | an edge names a function the code does not call there | topic |
| missing-call | a call the topic's own scope includes is not drawn | topic |
| invented-edge | a participant or edge with no basis in the code | topic |
| stale-claim | true at an earlier revision, false now | topic, and re-stamp it |
| adr-contradiction | the topic or code contradicts a governing ADR | a register marker, or the ADR |
| unsupported-claim | a narrative sentence no citation backs | topic |
| code-defect | the topic is accurate and the code is wrong | code, test first (build-with-quality) |

## The loop

1. The reviewer reports faults.
2. The author fixes the topic faults.
3. Run `diagram-index-gen.cjs --check --cite-check` and `--render` again.
4. Repeat until the reviewer reports none.

`code-defect` and `adr-contradiction` findings leave the loop and go to
build-with-quality triage, like external findings.

A Gemini run with the code included is a heavier alternative for a whole area
at once. Packing the diagrams plus line-numbered cited source found 3 of 3
seeded diagram faults and 2 real resolver bugs, with no false positives, in
one 179k-token call. It takes about 3 minutes and around 60k thinking tokens.
Keep it local: it sends code to an external model.
