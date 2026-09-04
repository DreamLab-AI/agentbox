# Fork prompt templates

Fill the `<…>` slots. Spawn all three in one turn as `subagent_type: fork` so they share
the orientation you did in step 0. Each returns a word count, the files read, and a claims
ledger; write the ledger to `gates/ledgers/<audience>.md` yourself.

Common preamble (prepend to each):

```
You are the fork writing ONE file: <repo>/docs/explainer/<file>.md. Do not write or edit
any other file; do not commit. Ground every claim in a file you open; never guess a
function name, route, flag, status string or user-facing message. Where something is
fail-closed, designed-but-not-built, or blocked on a person, say so plainly in this
reader's terms. Style: UK English, plain, sentences around 20 words, one idea each, no
em-dashes, no AI-tell vocabulary (delve, seamless, robust, leverage, "worth noting"), no
superlatives. Begin with a one-line comment stating audience and date; end with "Where
this comes from" listing the files read. When done, reply with the word count, the list
of source files read, and a claims ledger of the <N> most load-bearing claims as
`claim → file:line`.
```

## for-users.md

```
Audience: <the day-to-day user, e.g. "the marketing user the README calls Ali">.
Structure, in order: (1) what this is, one screen; (2) the places you work and what each
is for; (3) what happens when you ask for something — each kind of request and exactly
what you are told and when; (4) going live — what the deliberate step is, why production
is never a surprise, what a refusal means today; (5) two worked examples end to end as the
sequence the user actually sees; (6) <the one feature with real limits, e.g. image paste>:
what is accepted (read the limits from <file>), what happens to it; (7) what you cannot
do and why, plus a short FAQ and a plain-words glossary.
Must read: <tutorials>, <how-to for going live>, <the glossary>, <the chat/command
handler source>, <the asset/limit source>, and grep the user-visible strings.
Target 1,800–2,600 words. Ledger: 10 claims.
```

## for-developers.md

```
Audience: an onward developer who inherits this repo cold and must be productive in a day.
Structure (numbered headings): (1) what you are looking at — the trees, the golden rules
(push targets, never-push remotes, secrets, which tree is not yours); (2) runtime topology
— services, volumes, ingress, where state lives; (3) one request traced through code with
file paths and function names per hop, plus a mermaid state diagram of the core state
machine naming the transition functions; (4) the gates and where each lives, with the test
that pins it; (5) the engine / adapter seam and how to run with no external keys; (6)
tenancy / isolation and the accepted trust boundary; (7) the admin UI structure and its
hard gates; (8) running and verifying locally — exact commands, the traps, today's measured
gate numbers stated as measured on <date>; (9) three change recipes with file pointers;
(10) known debt and open items, each with the file where the work lands; (11) reading order
for the design record and the rule that records are amended by dated addenda only.
Open every file you cite. Target 3,500–5,000 words. Ledger: 15 claims.
```

## for-executives.md

```
Audience: a less technical CEO or CTO deciding whether to adopt, fund or extend this.
They will read a page and a half and ask: what does it do, what could go wrong, what will
it cost, what do you need from me.
Structure: (1) the problem in two paragraphs and the one-sentence answer; (2) what it is
and who the people are; (3) how it earns trust — five plain-language properties, one
paragraph each, technical name in brackets once; (4) one end-to-end example; (5) built and
proven vs blocked on the client vs deliberately deferred — exact, from <README status
section> and <the engagement tracker>; (6) what it costs to run — only what documents
support, quote the source, invent nothing; (7) three or four other places the machinery
applies, one sentence each; (8) decisions we need from you, as a checklist; (9) where to
go deeper.
Board-memo register. Mostly prose; one table and one checklist. Target 1,400–2,000 words.
Ledger: 10 claims.
```
