# Loom narrative authoring

Use for report chapters, explanations, captions or diagram text drafted through
the Loom. This is a shared authoring reference, not an ontology-query workflow.
Keep the user's chosen model posture and the delivery skill's output contract.

## Observed failure and scope

On 4 November 2026, a supervised whitepaper run using `hemmingway-1.5-q8_0`
supplied a broad fact sheet with many words joined together. Drafts confused
dates and maturity and misstated a
private-residual export boundary. Six short feature responses ended with `stop`
and contained 202–513 whitespace-delimited words; completion did not establish
factual correctness. A 650-word method request produced 2,290 repetitive words
and `finish_reason: length`, so it was rejected. A retry using the original method
source and a narrower brief ended with `stop` at 837 words, still exceeding its
550-word maximum. Temperature also changed from 0.4 to 0.6: this is one confounded
recovery case, not a controlled improvement result. The run retained its raw
request/response pairs as `paper/authoring/r3/{a-method,a-method-retry}.*.json` in
the authoring repository; those private artefacts are not distributed with this skill.

The following checks address those failures. Their general effect on response
quality still needs evaluation across different sections and models.

## Prepare one bounded section

- Supply a short, stable orientation and only the verified facts needed for this
  reader question. Use normal sentences and spaces; compression must not remove
  negations, dates, units, owners or evidence boundaries. Prefer a coherent source
  excerpt to a dense summary of the whole estate.
- Give each material fact an anchor: source ID, revision/path/lines or dated
  observation. Explicitly separate implemented source, observed runtime and
  proposed work. State decisive non-claims beside the relevant fact, such as
  “local residuals stay private” or “this test has not run”.
- Name the audience, desired outcome, headings if needed, output format and a
  measurable word range or maximum. Preserve an existing JSON schema when the
  caller needs it. For mathematical prose, supply the authoritative definitions
  and equations; request one explanation at a time rather than asking the model
  to reconstruct a method from unrelated product notes.
- Resolve contradictory sources before drafting. A model may flag a missing fact;
  it must not fill it with a guessed date, deployment, citation or result.

## Call the configured door and retain evidence

Use the configured Loom façade (`LOOM_BASE_URL`), never a guessed model rail or a
silent hosted fallback. For narrative requests set `loom_options.scaffold=false`
and verify the passthrough response according to the client's contract. The
existing `explainer-loom-draft` handles that check; see
[delivery-microsite.md](delivery-microsite.md#draft-on-the-connected-node-model-through-the-loom-façade-scaffold-off).

Request final output only. Where the served model/template supports it, explicit
`chat_template_kwargs: {"enable_thinking": false}` can reserve the completion
budget for the draft. A parameter being accepted is not proof it was honoured;
inspect the returned reasoning and final fields. Do not assume this switch works
for every model. With reasoning enabled, use at least 1,536 completion tokens and
budget separately for the requested final text; that floor is not sufficient for
every section. Word limits are not token limits. Reduce section scope before
discarding needed evidence to fit the context.

Retain each attempt's exact request and raw response in the authorised authoring
record, including failed attempts. Record requested and returned model IDs,
endpoint role, generation settings, thinking option, source-packet identity,
finish reason, usage, final word count and editorial disposition. Record manual
edits separately from model output. Keep private packets and credentials out of
public deliverables; a concise provenance note can name the model contribution
and subsequent checking without exposing the packet.

## Gate, diagnose, retry

Before accepting prose, check all of the following:

1. A non-empty final answer exists; reasoning-only output is not a draft.
2. The finish reason permits a complete answer. Reject `length`/truncation;
   `stop` is necessary on the ordinary text path but does not prove quality.
3. The output matches the requested schema and word range, without repeated
   paragraphs, cycling conclusions or an unfinished sentence. Count final reader
   text consistently; do not accept the model's own count.
4. Independently check claims, dates, numbers, equations, citations and explicit
   boundaries against the supplied sources. Reject invented IDs and status
   upgrades. A second model's approval is not source verification.

Classify the failure before spending another call. For reasoning-only output,
qualify the thinking switch or increase the budget. For looping or excessive
length, narrow the section and replace the overcompressed packet with relevant
source text. For an incorrect claim, give the exact offending sentence, its
verified correction and anchor. For missing evidence, gather it before retrying.
Do not treat an identical rewording loop as progress or feed previous prose back
as authoritative evidence.

Use the delivery's existing retry cap; if it has none, allow at most two revised
calls after the initial call for a section. Preserve each attempt and say what
changed. At the cap, retain the failure, continue independent work and use the
agreed hand-up path. Do not change the model posture or deploy a different model
to conceal failure. Local editing by an authorised reviewer is possible, but its
contribution must remain distinct and the same acceptance checks still apply.

## Improve from subsequent runs

Record the error class, corrective change and before/after gate results in the
authoring record. Promote a lesson into the skill only when it changes a future
decision. To claim improved prompting, compare the old and revised briefs on a
representative section and a held-out section, retaining model/settings and the
same independent rubric. Count factual errors and reviewer corrections as well
as completion, repetition and length compliance. Report failures and confounders;
this observed recovery does not establish general uplift or unattended quality.
