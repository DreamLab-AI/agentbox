# Designing the judgment set

Distilled design rules. The current field names, limits and response shapes come from
the live API page (`live-docs.md`); what follows is the part that decides whether a
judgment set works, and it changes far more slowly than the API does.

## Request shape

One request = one `state` + many `questions`. Every question sees the same state, is
evaluated independently and in parallel, and returns a typed answer under the ID you
chose. Types mix freely in one call.

```json
{
  "state": { "...": "the content and supporting facts" },
  "model": "jev-latest",
  "questions": {
    "<your_id>": { "type": "choice|score|noul", "instructions": "...", "criteria": "..." }
  }
}
```

## State

State is the material you would put in front of an expert panel before asking them to
judge. It may be a string, an object or an array.

- **String** — one message, article or passage, and nothing else matters.
- **Object** — the default once the state has parts. Named fields keep the
  relationships legible: `{"ticket": {...}, "order": {...}, "refund_policy": "..."}`.
- **Array** — a sequence of messages or records.

Related information that must be *compared* belongs in one state, not split across
requests. A conversation, the order it refers to and the policy that governs it are
one state even though they are three things.

Keep content in the state and judgments in the questions. The policy text goes in the
state; "does this policy support the request" is a question.

## Question anatomy

- **ID** — yours, for your code. **Not sent to the model.** Write the complete meaning
  in `instructions` even when the ID looks self-explanatory.
- **`instructions`** — the question or the statement to judge. This is where the
  evaluation logic lives.
- **`criteria`** — the answer space. A map of options for Choice, an ordered list of
  levels for Score, an optional clarification of yes/no for Noul.

Reference a part of a structured state by backticked path inside `instructions`:
`` Does `ticket.messages[0].text` request a refund? `` Explicit paths are how the
model knows which part of a composite state a judgment is about.

Strings suffice for simple questions. Use structured objects or arrays when
definitions, contrasts, exclusions or examples are what make the question answerable.

## Answer-space shapes

The minimum needed to design offline; confirmed against `https://docs.typesafe.ai/api.md`
on 2026-09-16, and to be re-checked at fetch rather than trusted here.

| | `criteria` | Notes |
|---|---|---|
| **Noul** | optional object with **`true`** / **`false`** keys | Each a description of what that verdict means |
| **Choice** | required `map<option, string \| null>` | `null` where an option needs no rubric |
| **Score** | required ordered **array** of level descriptions | **At least two levels** |

`instructions` accepts a string, object or array — the structured forms are how
definitions, contrasts and exclusions get in without cramming them into one sentence.

Answers come back under your own question ids. Noul returns `noul` alone. Choice
returns `choice` (highest-probability option), `probabilities` over every option, and
`confidence`. Score returns `score` (probability-weighted, lands between levels),
`legend` mapping each level index back to its description, `probabilities` keyed by
level index **as a string**, and `confidence`. Every response carries `usage` with
`input_tokens` and `output_tokens` — that is the per-call cost signal to log.

## Choosing the primitive

Pick by what the answer *means*, then by which shape your code can act on directly.

**Choice** — one of a known set, no order between options. Routing to a department,
classifying a document type, selecting a handler. Give the full option list. Add an
`other` / `none of the above` option whenever the list might not cover an input; a
Choice cannot answer "none of these" unless you provided it. Its `probabilities`
distribution is a comparison *between your options*, so it is only meaningful if the
options are genuinely competing.

**Noul** — a clean yes/no where the probability is the signal. Does this report a bug;
does the resume state work use of a language. **0.5 means yes and no are equally
likely, not medium intensity** — the single most common misreading. When several
labels may apply at once, ask one Noul per label rather than forcing a Choice.

**Score** — a position along levels you describe. Severity, frustration, relevance,
skill. The returned score can fall *between* levels. Each level must describe a
concrete situation and stand on its own; a ladder of bare adjectives ("low, medium,
high") gives the model nothing to place an input against. For graded ranking across
items, use the same Score definition per item so the values are comparable.

If a judgment sounds like a Noul but needs a definition of the adjective ("is this
candidate strong in Python?"), it is a Score. If you need a yes/no, define the
condition until it is observable ("does the resume state that the candidate used
Python at work?").

## The rules that decide whether it works

1. **One narrow, coherent judgment per question.** The target is a determination a
   knowledgeable person makes in a second given the right context. "Analyse this and
   decide what to do" is not a question; it is a signal to decompose.
2. **Atomic is not literal.** A bounded action selection or a contextual
   interpretation is a legitimate single judgment. Splitting is for *independent*
   factors — do not split a relationship into halves that no longer mean anything.
3. **Split what you want to weight.** Instead of "rate this pitch", ask market size,
   technical feasibility and differentiation separately and weight them in code. Then
   a change of priorities is a coefficient edit, not a prompt rewrite.
4. **Keep the needed answers reachable.** Include a no-match outcome where nothing may
   fit. Where the judgment selects a value from a source, verify candidate coverage
   first: the model cannot choose a value you failed to extract.
5. **Presence and interpretation are different questions.** If "is it there at all"
   is independently useful, ask it separately rather than overloading a no-match
   option.
