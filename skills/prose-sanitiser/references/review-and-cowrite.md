# Review and co-write workflows

Adapted from Addy Osmani's [clarity](https://github.com/addyosmani/clarity) (MIT).
Two modes that sit alongside the audit: **review** critiques a piece without
changing it; **co-write** builds a draft from material the author actually
supplies. Use [editorial-method.md](editorial-method.md) to name patterns precisely in either mode.

## Review (critique without rewriting)

Do not produce a replacement draft or modify files unless asked. Lead with the
largest material issue; line edits come second.

### Piece-level diagnosis

Use these fields when relevant, omitting any that would add ceremony rather than
information:

```txt
Job:          the medium, reader, and intended outcome
Substance:    what the piece specifically contributes, or what is missing
Trust:        factual support, attribution, uncertainty, preservation risk
Development:  how the material progresses; where it becomes list-like or repetitive
Voice:        what reads as the author's; where generic model register takes over
Ending:       whether it stops on the last useful thought
Top fixes:    the two or three changes with the largest expected gain, ranked
```

For reference, procedural, academic, legal, or message-oriented prose, do not
demand an authorial thesis — evaluate whether the text performs its actual job.
If the substance is too thin to support a useful rewrite, say so plainly and
offer the interview (below): surface edits cannot supply missing evidence or
experience.

### Passage-level finding

One block per material issue:

```txt
Passage:      the shortest quote that locates the issue
Verdict:      keep / revise / ask-author / cut
Pattern:      a concise name from the destructive audit or the editorial method
Why:          what the passage does instead of its intended job
Suggestion:   a supported replacement, a precise author question, or the reason to cut
Safety check: whether the suggestion preserves facts, attribution, scope, and voice
```

Verdicts:

- `keep` — a pattern is present but earned, required by the medium, or better
  than the alternatives. State what earns it.
- `revise` — the source already contains enough material for an honest
  improvement.
- `ask-author` — improvement needs a fact, mechanism, example, opinion, or
  experience the source does not supply. Ask exactly for that and offer a cut or
  plain fallback.
- `cut` — the passage adds only repetition, ceremony, unsupported emphasis, or
  closure.

Do not invent the missing material in a suggested rewrite, and check your own
replacement for the same formula, inflated claim, or fabricated detail you
identified in the source.

### Review discipline

- Distinguish errors from likely improvements, and both from taste.
- Quote the previous sentence when context decides whether a contrast,
  adjective, passive, list, or closing beat is earned.
- Prefer a few high-impact findings to an exhaustive word watchlist.
- Report no finding when the prose already performs its job.

## Co-write (perspective interview)

Use when drafting from scratch with an author, or when an authored draft has a
real substance gap. The goal is to collect language and material the author
actually supplies — not to simulate a human voice.

### Start here

Ask for one untidied answer before drafting:

> Talk to me for three to five minutes, or stream-type one take. Do not organise
> it first. Tell me what happened, why you want to write this now, who you want
> to reach, what you believe, and the examples or doubts that make the idea
> yours. Use real names, numbers, and incidents only when you are comfortable
> publishing them. Skip private details instead of blurring them.

Offer these as aids, not a questionnaire to complete:

- What triggered the piece this week: a conversation, bug, meeting, result, or
  annoyance?
- Picture one reader. What do they already know, and what should change for
  them afterwards?
- Who disagrees with you, and what is their strongest real argument?
- What do you say about this in conversation that you have never written down?
- Which example from your own work carries the point? What happened and what
  changed?
- Where are you uncertain, or what have you changed your mind about?

Also ask for prior writing on the topic — posts, notes, talks, definitions —
and treat it as source text with its attribution retained.

### If a draft already exists

Do not interview the author about the whole draft. Ask at most three questions
about the parts that lack support or authorship:

```txt
This paragraph says [claim]. What is your evidence, and how sure are you?
This example could belong to anyone. What is your version of it?
The ending restates the point. What should the reader actually do, notice, or reconsider?
```

One concrete follow-up usually yields more than five general questions. Prefer:
"Tell me about the last time this actually bit you. What broke, and what did
you do?"

### Turn the answer into prose

1. Extract the point, useful phrases, examples, uncertainties, and order of
   discovery.
2. Build the spine from the author's supplied language. Cut true repetition and
   direct address to the interviewer; reorder when it clarifies development.
3. Lightly edit grammar when comprehension requires it. Protect coined language,
   trade slang, genuine asides, mixed feelings, and unusual details. If a
   stronger edit changes the thought or erases a distinctive phrase, keep the
   original or show the author both versions.
4. Add model-written material only for a clear job: sourced research, a
   definition, a factual bridge, or compression. Never write a memory,
   preference, or experience for the author.
5. Leave `[TK: precise question]` where the piece needs material the interview
   did not provide.
6. Outside the publishable draft, report a provenance note in chat:

```txt
Author material:     which sections or kinds of language came from the interview/prior writing
Model contribution:  research, organisation, connective prose, or none
Open items:          TK questions or none
```

The provenance note describes the actual process, which is the claim the
workflow can support.
