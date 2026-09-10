# Delivery: instructional microsite

The deliverable is a working, locally-served instructional site with source,
runtime evidence and reviewed media, for the nominated reader — not a
documentation index or a production plan. Use the existing documentation as
research material; implementation and observed runtime behaviour decide what
the site may claim. Do the hub's shared orientation, claims-ledger grounding,
stop-before-fixing-product-code rule and gates before and during this workflow
— they are not repeated here.

## Establish the teaching contract

Infer what the user has already specified: audience, prior knowledge, concerns,
requested media, output location, packaging and authority to fix discovered
problems. Ask only for material gaps while continuing independent research.
Keep distinct audience tracks separate. An experienced developer can still have
zero context about this product: teach the problem, actors and vocabulary before
implementation detail.

Offer both a sequential cold-start route and independent concern-based entries.
Explain why major boundaries exist before tracing their functions. For each
journey, connect the user's intent to the visible surface, API or command,
permission decision, state/data change, verification and failure/recovery path.
Scale the curriculum to the product; do not force a fixed chapter count.

When the user prioritises simplification, apply it to both implementation and
teaching. Prefer an existing path and a bounded proposed fix for a demonstrated
problem. Add an abstraction, dependency, configuration option or production
helper only when its concrete benefit justifies the maintenance cost. Preserve
useful features and requested evidence. Extend the investigation when it
resolves a reader's question, tests an important claim or diagnoses an observed
failure; separate optional investigations from requirements that must work at
delivery.

## Teach the delivered platform

Read [microsite/reader-voice.md](microsite/reader-voice.md) before writing a word: it
separates the internal ledger register from the reader register with the pilot's own failed
sentences, fixes the chapter shape, and names the four-part gate (`voice-lint.sh`, the build,
an independent range check, `anatomy-coverage.mjs`). Chapters are Markdown sources rendered
by a dependency-free build into the reading shell; section the site by the system's anatomy
(directories, services, lanes, consoles), never by the evidence you happened to gather.

The walkthrough teaches the product's final behaviour, not the history of
building or repairing it. Do not include remediation stories, finding IDs,
before/after fix comparisons, abandoned implementations or links into the
investigation diary. Keep that history in internal working records outside the
reader's teaching path. Explain intent, implementation, observable behaviour and
operation in the present tense. Failure demonstrations should exercise the
delivered error and recovery behaviour. Audit existing chapters and all media,
captions, transcripts, diagrams, screenshots and linked evidence when this
contract changes; prose edits alone do not update an embedded recording.

When the brief calls for a fully realised platform, missing required behaviour,
broken journeys and insufficient proof of delivery claims are blockers. Do not
launder them into "limits", "out of scope", future work or a narrower
demonstration. For a product-code blocker, follow the hub's stop-and-ask rule.
If a blocker cannot be resolved with available access, inputs or resources, stop
dependent delivery and report the exact blocker, its evidence and what is needed
to proceed. Do not present the platform or pack as complete while it remains.
Honest technical boundaries and evidence scope still matter: they must not
disguise unfinished requirements or justify unsupported claims. Keep the
internal completion audit separate from the finished teaching narrative.

## Draft on the HP model through the Loom façade, scaffold off

The estate's model door is the Ontology Loom façade, `http://192.168.2.132:8084/v1`; the
model behind it swaps with no consumer change. A codebase is not an ontology subject, and on
2026-09-09 the façade's verbatim mode answered a packet about `pnpm verify` with the
blockchain "Node" class in 40 ms without calling the model. The Loom now honours a
per-request opt-out (ADR-139, 2026-09-10): `{"loom_options": {"scaffold": false}}` makes the
façade a plain proxy for that request (no retrieval, no injection, no verbatim, no thinking
control) and the response carries `loom.served_mode: passthrough`.

`scripts/loom-draft.mjs` sends that option on every call and refuses a response that was not
passed through, so it fails loudly against a façade without the ADR-139 build. Run it as a
sequential, resumable background batch; the session model only orients, checks ranges and
decides. The direct rail port `http://10.10.10.1:8085/v1` works from hosts that can reach it
(`EXPLAINER_MODEL_BASE`) but is an implementation detail behind the door, not the path to
document. Vision remains the manually qualified exception in
[microsite/hp-qwen-direct.md](microsite/hp-qwen-direct.md). The controlling agent gathers
evidence, runs tools and independently checks every draft; a model response is not runtime
evidence or permission to edit product code.

Read [microsite/qwen-prompting.md](microsite/qwen-prompting.md) when preparing
the first section packet, whichever backend is in use: shared orientation,
evidence distinctions and reusable section/review prompts. It defines the
packet's evidence classes (`source`, `runtime`, `image`) and the output
contract's `status` values (`needs_evidence`, `draft`, `blocked`) that the hub's
"Ground every claim" section generalises across all three deliveries.
Independently verify the claims before media production regardless of source.

## Compose the specialist skills

This is an orchestration skill. **Invoke the relevant specialist by reading its
current SKILL.md and using its tools/workflow**, not merely mentioning its name
in a plan. Discover it from the current session catalogue or Agentbox's
installed skills; do not assume a remembered installation path. On filesystem
installations, reading the file is the invocation when no dedicated skill tool
is available.

Read [microsite/specialist-handoffs.md](microsite/specialist-handoffs.md) when
producing visuals, runtime evidence or media. It maps tasks to available skills
and defines what to pass in and what evidence to collect back. Use only the
skills needed for the requested deliverable. Preserve user choices over
specialist defaults; do not silently add a visual style, model-generated
material or external service that changes their brief. Orchestration does not
itself authorise subagents, publishing or production mutations. For a
requested video, hand off to
[delivery-video.md](delivery-video.md) rather than driving `codebase-video`
from here directly.

## Ground the claims and maintain custody

Locate the authoritative repository, including nested repos, vendored code and
local instructions. Record the revision and hashes of cited files. A HEAD value
alone does not describe a dirty worktree. Coordinate with concurrent agents;
read their output as moving input and revalidate affected claims when it
changes.

For each important claim, record what supports it: source, a fresh test run, a
named runtime observation, or an explicitly unverified design intention.
Separate the explanation of intent from assertions of enforcement. Test logs
need commands, environment/mode, exit status, scope, exclusions and durable
output. Freeze evidence in the pack; test runners may delete their normal
output directories on later runs.

Capture only relevant application surfaces in an isolated browser context or a
known owned tab. Label mock data, scripted engines, bypass identities and real
integrations independently. A live HTTP connection does not imply real data; a
scripted worker does not prove model behaviour. If deployed code identity is
not established from a build/image/runtime receipt, call it checkout code.

Use [microsite/evidence-and-lessons.md](microsite/evidence-and-lessons.md) for
the evidence model, end-to-end analysis loop and reusable lessons from the
pilot.

## Build an inspectable reading surface

Keep explanation and media on the left and a swappable source pane on the right
when the reader benefits from comparing them. A reference should open the
entire file at its cited lines without losing the narrative position. Preserve
ordinary file links as a fallback. Support file switching, readable line
numbers, wrapping, keyboard navigation, deep links and a usable narrow-screen
layout.

Load source from the bundled checkout over the site's local HTTP server, or use
explicitly labelled immutable snapshots when packaging requires them. Render
source as inert text, including HTML and script files. Restrict file selection
to an indexed set of repository-relative references. Show missing/changed
source honestly; do not silently replace it with stale code. Add hashing or
equivalent revision checks where available, and distinguish "not checked" from
"matched".

Keep serving simple: no build-time dependency should be needed merely to read a
finished local clone unless the user chose that model. Avoid CDN-only diagrams,
fonts or video players in an offline deliverable. Do not conceal implementation
context from the developer audience, but keep site controls about reading
rather than production tooling.

## Produce and review the media

Use the specialist handoffs to turn verified journeys into actual screenshots,
diagrams, animation and narrated videos. Keep each clip focused on a review
question and let measured narration determine its length. Static code and
labels must remain exact and readable. Provide transcripts and
browser-compatible captions alongside audio/video, with source evidence for
factual narration.

Follow the user's current packaging decision. If media is part of a normal
clone, track the compressed delivery files; ignore only intermediates and model
caches. Use the FFmpeg skill for browser-compatible compression and inspect the
final encode for readable code, natural speech and correct cuts. Report
measured media size; do not assume a CRF value guarantees quality or a Git
hosting limit.

## Close against the full contract

Use [microsite/completion-audit.md](microsite/completion-audit.md) before
claiming the pack finished, in addition to the hub's gates A–E. This audit
covers teaching completeness, source and runtime grounding, media review, code
fixes and clean-copy delivery. A validator, chapter count or passing test suite
cannot establish the whole requirement.

Improve this reference as the work exposes reusable failures and successful
methods. Keep project facts and unfinished work in the project's
evidence/production record. Promote a lesson into the skill only when it
changes a future decision; label untested recommendations rather than
presenting them as proven recipes.
