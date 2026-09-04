# The seven-question comprehension arc, per audience

The arc is the acceptance bar: after the human half, a newcomer answers all seven
unaided. Each audience needs a different answer to the same question.

| # | Question | User (day-to-day) | Developer (inherits the code) | Executive (signs it off) |
|---|---|---|---|---|
| 1 | What is this? | one screen, second person, what it does for *you* | the trees, what each is, which are not yours to edit | one paragraph, no jargon, the two people and why they are apart |
| 2 | What can you do with it? | the things you ask for and what happens to each | the request traced through code with file and function names | capabilities as outcomes, not features |
| 3 | Why was it built? | the problem you had before | the design record's reframe (which ADR, why) | the bottleneck and the unsafe-agent problem |
| 4 | What problems does it solve? | what you no longer wait for; what cannot go wrong | the gates and where each lives, with the test that pins it | how it earns trust: five properties in plain words |
| 5 | One end-to-end example | two worked journeys as the screens you see | one request from route to state machine to report | the same journey a CEO would recognise |
| 6 | Other application areas | (skip, or one line) | how to change it: three recipes with pointers | three or four adjacent uses, one sentence each |
| 7 | How exactly do I run it? | how to go live; what a refusal means | the verification commands, the traps, the debt with file refs | what is built vs blocked vs deferred; cost; decisions needed |

Rules that hold for every column:

- Say what is **not** built, fail-closed, or blocked on someone, in that reader's terms.
- Never quote user-facing wording unless it exists in code.
- Length: user 1,800–2,600 words; developer 3,500–5,000; executive 1,400–2,000.
- Each document ends with "Where this comes from": the files read.
