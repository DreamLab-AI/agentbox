# Verification: declared revisions, citations, re-stamping

A corpus is a catalogue at a declared revision, not a live view. Its whole claim
to being checkable rests on two things: each topic naming the commit its sources
were read at, and each citation resolving against **that** revision rather than
against whatever is in the tree today.

## The declared revision

`verified_commit` is an author declaration: *I read these files at this sha.*
`--cite-check` takes it literally and fetches each cited file with
`git show <sha>:<path>`, falling back to the working tree only when the sha lookup
fails. So a stamp that is honest gives you real verification; a stamp that is
optimistic gives you verification of the wrong bytes.

Consequences worth internalising:

- **Stamp what you read, not what is current.** If you read a file at `8cbdb7a`,
  the topic says `8cbdb7a`, even if HEAD moved while you were writing.
- A **stale topic is not wrong, it is unverified.** Its citations were true once.
  Re-opening it means re-reading the sources, not trusting the numbers.
- In a multi-repository corpus the stamp is a `{repo: sha}` map, and a repository
  you cite but omit from the map is resolved against the working tree without
  complaint. Check the map covers every repository in `sources:`.

## Reading a dirty tree

Sometimes the thing worth cataloguing is not committed yet. Then:

```yaml
verified_commit: 8cbdb7ae6346e9d7981acac249a47f7341b35bc7
worktree: 2026-09-07
```

which means *this sha plus the uncommitted change set of that date*. The checker
reads working-tree bytes for that topic and ignores the sha. `COVERAGE.md` lists
every topic in this state, so the debt is visible.

`--worktree-citations` does the same thing for the whole corpus, for one run. Use
it while writing — it is the fast inner loop — and never as the CI gate, because
it verifies nothing about the declared revision.

## Re-stamping when a change set lands

The discipline that made the first corpus survive its own repository moving:

1. The change set is committed; note the new sha.
2. For every topic whose `sources:` includes a file the change set touched
   (`git diff --name-only <old> <new>`), re-read the cited symbols at the new sha
   and correct any line that moved.
3. Bump that topic's `verified_commit` to the new sha and drop `worktree:`.
4. Leave every other topic on its old sha. A topic whose sources were untouched
   is still verified; re-stamping it would be a lie about work not done.
5. Run `--check --cite-check` and get to zero warnings on the re-stamped topics.
6. If a developer narrative says a source was "uncommitted" or "in the working
   tree on <date>", that sentence stays true as written; the file it describes is
   now the one at the new sha. Say so once, in the corpus README.

## Deriving a line number

The one rule that prevents most of the errors: **derive every line number from
the symbol, never from an offset or a diff shift.** `grep -n` the name, open the
body, cite a line inside it. A citation moved by arithmetic is a citation nobody
verified, and a moved citation that was wrong stays wrong.

The checker helps: a sequence participant labelled with a function name whose
cited line falls outside that function's body is flagged (`is labelled 'execute'
but that symbol spans :41-96`). That check is TypeScript-shaped — `function name`,
`const name =`, class methods — so treat its silence on other languages as
absence of evidence.

## Warning classes, and what each means

`--cite-check` warns; it does not fail. Each class means something different:

| Warning | Means | Fix |
|---|---|---|
| `cites a file that is not in this topic's sources: (unresolvable, never checked)` | the citation was **not verified at all** | add the file to `sources:` |
| `is ambiguous: matches N sources: entries` | a bare basename matched several source paths | qualify the path |
| `past EOF (file has N lines)` | the line does not exist at that revision | re-derive from the symbol |
| `is blank` | the cited line has no content | cite the first non-blank line of the range |
| `is punctuation only ('})` | the citation lands on a closing brace | cite the statement, not its terminator |
| `bare citation has no path anywhere before it` | a `:NNN` with no context; often a port | qualify it, or write `port 8788` |
| `bare citation on a message whose participant is declared without a path` | the sequence participant has no file bound | bind it: `participant X as fn<br/>file.ts:NN` |
| `is labelled 'fn' but that symbol spans :A-B` | the label and the line disagree | fix whichever is wrong |
| `could not be read` | the file is absent at the declared revision | check the sha, or the repo key in the map |

The unresolvable class is the dangerous one. A corpus can show "0 errors" while a
third of its citations were never checked, because the files were not listed.
Watch `citationsChecked` in the `--report` output against the number of citations
you believe you wrote.

## Strict mode and CI

```bash
node scripts/diagram-index-gen.cjs docs/diagrams --check --cite-check --strict-citations
```

turns every warning into a failure. Adopt it once a corpus is at zero — not
before, or the gate is permanently red and stops being read.

A hosted runner without the sibling repositories checked out cannot resolve
anything, so it runs the structural half instead:

```bash
node scripts/diagram-index-gen.cjs docs/diagrams --check --no-source-paths
```

which skips the `sources:`/`governing:` existence checks and (necessarily) the
citation check. `--strict-citations` with `--no-source-paths` is refused rather
than silently downgraded.

## Rendering is a separate gate

`--check` cannot see Mermaid grammar, so a corpus that checks clean can still be
unreadable. `--render` parses every block through `mmdc` and fails any render
wider than 4500 px. Re-render after every edit, including a one-line note in a
diagram; `--only <substr>` keeps the loop fast while you are working on one
topic, and the full render is the gate before you call the corpus done.

## Verifying someone else's corpus

Before reusing a topic you did not write:

1. Resolve its declared revision and ask whether its own cited sources have moved
   since. If they have, the topic is unverified, not wrong.
2. Run its generator's citation check if it ships one, and record the result with
   the date and the commit.
3. Cite the **source file and line** in whatever you are writing, never the
   corpus topic. A corpus sentence is evidence of what its author read.
4. Do not edit it. A stale or wrong topic is a finding for its owner.
