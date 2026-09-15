---
id: XX-01
title: Replace with a sentence-case title, no id, no full stop
area: replace-with-the-directory-name
governing: [docs/explanation/replace-me.md]
adrs: [ADR-000]
sources:
  - src/replace/me.ts
  - src/replace/also-me.ts
verified_commit: 0000000000000000000000000000000000000000
# worktree: 2026-09-15   # uncomment ONLY if a source was read from a dirty tree
# For a corpus spanning repositories, use a map instead of a bare sha:
# verified_commit: {thisrepo: 0000000, siblingrepo: 1111111}
---
## For developers

Why this topic exists, and what the reader should be able to do once they have
read it. How the pieces relate to each other and to the rest of the system. Any
length. Cite the records and commits that own each decision.

Keep this section honest about what you did not read. A sentence naming the part
of the subsystem this topic does not cover is worth more than silence.

## For the business

The same ground in the product's own vocabulary. What this means for a named
user, for the live site, for cost, for risk. Any length. No code names unless
they are the product's own names — no file paths, no class names, no `snake_case`.

This section is not a summary of the one above; it is the same subject addressed
to somebody who will never open the code.

## XX-01.1 First diagram: what it is called in the reader's words

```mermaid
flowchart TB
    A["the thing that starts it<br/>src/replace/me.ts:41"]
    B["the thing that decides<br/>src/replace/me.ts:88"]
    C["the thing that records it<br/>src/replace/also-me.ts:17"]
    A --> B --> C
```

**What it shows.** One to three sentences. The mechanism, not the picture.

**Why it is this way.** The decision, who took it, when, and the record that owns
it (`ADR-000`). If nobody decided it, say that — and consider an `**Open:**`.

**Invariant:** the property this design depends on, with the line that enforces
it (`src/replace/me.ts:92`).

## XX-01.2 Second diagram: a request's life, if the topic has one

```mermaid
sequenceDiagram
    autonumber
    participant CL as caller
    participant HD as handleRequest<br/>src/replace/me.ts:120
    participant VF as validate<br/>src/replace/also-me.ts:44
    CL->>HD: the call, in words
    HD->>VF: what is checked (:52)
    VF-->>HD: the verdict (src/replace/also-me.ts:61)
    Note over HD: INVARIANT: a failed verdict never reaches<br/>the store, src/replace/me.ts:134
```

**What it shows.** One to three sentences.

**Why it is this way.** The decision and its record.

**Debt:** something the code carries that its own authors flagged
(`src/replace/me.ts:140`).

**Drift:** the doc says X (`docs/explanation/replace-me.md:22`), the code does Y
(`src/replace/me.ts:145`).

**Open:** the question the record leaves — phrased as a question, with the line
that raises it (`src/replace/also-me.ts:70`).

<!--
Checklist before you commit this topic:
  * every participant bound to a file, so bare :NNN references resolve
  * every cited file listed in sources:  (unlisted = never checked)
  * every line number derived from the symbol, never from an offset
  * ports written as "port 8788", never ":8788"
  * no ";" or HTML entities in sequence messages or Notes
  * ids sequential: XX-01.1, XX-01.2, ...
  * node scripts/diagram-index-gen.cjs docs/diagrams --check --cite-check --only XX-01
  * node scripts/diagram-index-gen.cjs docs/diagrams --check --render --only XX-01
Then delete this comment.
-->
