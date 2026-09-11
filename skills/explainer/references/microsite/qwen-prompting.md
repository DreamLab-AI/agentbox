# Qwen evidence and presentation prompts

Use this scaffold for the model calls that draft microsite sections (`scripts/loom-draft.mjs`). It supplies
context discipline to the model; it does not replace repository discovery, runtime
tools or independent review. Keep the enclosing session's model and repair authority
unchanged. Read hp-qwen-direct.md for transport, multimodal qualification and cleanup.

## Assemble context before asking for prose

The host agent reads the actual checkout and existing instructions. Establish the
repository root/revision, dirty files affecting this section, audience, teaching
question and active implementation. Existing documentation proposes where to look;
source and observed execution settle behaviour. Check for duplicate implementations,
generated or vendored code, entrypoint configuration and test-only seams when they
could change the answer. Do not automatically crawl every subsystem.

Start with a compact project orientation shared across sections: problem, actors,
project vocabulary, major boundaries and a few verified entry points. Keep an
internal coverage map of reader questions and accepted evidence. A section model
cannot discover omissions across the whole curriculum from one small packet.
Update orientation when evidence changes; do not let an early architecture guess
become an unquestioned premise in every later prompt.

Then assemble one packet. The following is a fill-in structure, not a requirement
that every repository has every field. Omit irrelevant fields; explicitly identify
missing evidence that matters. Never copy secrets into it.

```json
{
  "question": "What does this action do and when is its result durable?",
  "audience": "Experienced developer, unfamiliar with this product",
  "orientation": "Verified purpose, actors, vocabulary and architecture relevant here",
  "required_outcome": "The behaviour the delivered product must demonstrate",
  "identity": {
    "repository": "repository name",
    "revision": "inspected revision",
    "relevant_dirty_paths": [],
    "runtime": "observed build/image identity, or not established"
  },
  "mode": "Actual configuration; distinguish fixture, bypass, live integration and model use",
  "evidence": [
    {"id":"S1","kind":"source","path":"relative/path","sha256":"digest","lines":"numbered excerpt with its real range"},
    {"id":"R1","kind":"runtime","command":"recorded command","result":"relevant output and exit/status","scope":"what ran and what did not"},
    {"id":"V1","kind":"image","capture":"which surface/action/state","runtime_identity":"receipt ID or not established"}
  ],
  "known_gaps": ["An absent callee, observation or identity match needed for the question"],
  "output": {"reader_words":180,"media":"only the treatments needed for this section"}
}
```

Attach V1 as an actual typed image in the same request. A filename or a textual
caption is not visual evidence. Do not put image bytes into prose. Include a relevant
surrounding caller/handler and the next boundary when the question depends on it;
a whole large file is usually less useful than a coherent trace. For a CLI this
may be argument parsing → operation → exit/output; for a library it may be public
API → implementation → return/error contract. Let the repository decide the shape.

## Supporting distinctions to use selectively

| Claim being explained | Evidence to seek before stating the outcome |
|---|---|
| Local edit becomes durable data | State update, save trigger, persistence implementation, failure handling; reload/read-back or storage observation for actual success |
| An identity may perform an action | Active verifier, membership/action rule and route wiring; signed/denied runtime cases in the relevant mode |
| A component is deployed or isolated | Active entrypoint/configuration, actual process/image identity and relevant enforcement observation; an unused Dockerfile or comment is insufficient |
| A job completes | Enqueue/start versus completion/acknowledgement, failure/retry ownership and observed terminal result |
| A test supports a guarantee | Executed test assertions and setup, relevant paths exercised, fixtures/skips and recorded outcome; suite counts alone do not establish coverage |
| A diagram explains architecture | Source-supported components, arrow meaning and trust/data boundaries; distinguish intended design from observed enforcement |
| A screenshot or video proves a journey | Actual visible state plus interaction/runtime receipt; a still image cannot prove a transition, storage success or an audible property |

These are reasoning aids, not a universal checklist. In particular, do not add a
database, authentication or networking investigation to a repository that does not
have those concerns. Explain deliberate design choices with their actual trade-off;
do not invent motives from familiar architectural patterns.

## Compose requests consistently

Use prompts/qwen-system.txt as the stable instruction prefix. Use
prompts/qwen-section.txt for the section request and prompts/qwen-review.txt for a subsequent review.
Replace template fields with the selected packet, draft and actual review notes.
Never submit unresolved template fields. Supply the same JSON contract in every
phase; the pilot retained an earlier JSON format after a later request for prose.
The host resolves reader_text's [ID] markers against the packet and accepted claim
ledger into evidence/source links. Reject unknown IDs or markers that do not support
their assertion; do not silently remove citations. Then the renderer consumes the
linked reader text. Internal requests and review notes stay outside the teaching
path. Partial text from needs_evidence/blocked can be retained for later work but
cannot be published as an accepted, complete section.

A system message is preferred where supported by the qualified chat template.
Otherwise prepend the exact instruction prefix to the user text. Keep evidence and
images as task data after the stable prefix. Qualify the actual message arrangement;
model metadata does not prove that a template follows the requested format.

Budget for the packet, image tokens and complete JSON output. The old 650-token
trial budget suited a short paragraph, not an expanded claims ledger. Start around
900–1400 output tokens for this contract, then measure and reduce unnecessary fields
or section scope. Do not truncate evidence silently to fit. Keep calls sequential on
a shared small local service; reuse a warm process and stable prefixes. An unfinished
response is not a draft. Preserve the same running request across transport timeouts.

If status is needs_evidence, the host gathers the requested minimal artifact and
checks whether it resolves the claim before calling again. Do not feed the model
its own previous prose as new evidence. If a dependency remains unavailable or the
product fails required behaviour, follow the skill's stop-and-ask policy for that
part of the work. Continue independent sections. Avoid endless rewording attempts
when the missing item is an external fact or an unimplemented behaviour.

## Review before media production

The host independently verifies citations, active configuration and each material
claim. Ask Qwen for a targeted review using the same packet plus newly obtained
evidence; a second model response alone is not independent verification. Preserve
status and schema through revision. A fluent answer, valid JSON or a self-awarded
confidence score cannot pass the section.

After factual acceptance, send only accepted claims, exact labels, audience,
verified asset IDs and presentation constraints to the relevant specialist skills.
Keep identifiers linking narration, captions, diagrams and screenshots to the same
claims. Review the final render: a correct script does not prove readable labels,
correct diagram direction, clean cuts, audible pronunciation or caption timing.
The host must actually invoke those skills as described in specialist-handoffs.md.

## Qualification cases and acceptance

Use one representative real section and a small held-out case in a different
subsystem before expanding a changed prompt workflow. Do not provide the reference
answer or expected defect to the drafting model. Useful cases include:

- A visible success indicator alongside code that schedules an asynchronous write,
  with downstream storage evidence absent. The model should request what is needed
  for a durability claim and can explain the evidenced local transition.
- Two similarly named entrypoints with a runtime receipt identifying only one.
  The model should trace the active one instead of combining their properties.
- A non-web operation that returns a job identifier before completion. The model
  should distinguish submission from completion without imposing UI assumptions.

Evaluate whether it selected the right path, requested missing decisive evidence,
used exact visible facts and citations, preserved required behaviour and produced
useful cold-start prose. Include at least one complete positive packet: a workflow
that always abstains is not a useful explainer. Record first-pass and revised results
separately, along with model identity, input/output hashes, latency and reviewer
judgment. Delete task scratch outputs after retaining the compact qualification
receipt. Preserve failures in that receipt; do not cherry-pick only the best draft.

The original the connected node pilot demonstrates one supervised multimodal section. These new
prompts are safeguards informed by that failure and later custody checks; they are
not evidence of whole-pack parity or an unattended quality guarantee. Record fresh
model trials separately before claiming measured improvement.
