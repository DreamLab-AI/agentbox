---
name: repo-education
description: Build a repository-bundled instructional microsite using direct HP Qwen language and vision, with design rationale, evidence-linked source panes, verified runtime journeys, diagrams and narrated videos. Use for developer onboarding, client due diligence and closing a code comprehension gap; not for a single README or standalone video.
---

# Repository Education

Turn the repository into a guided, inspectable explanation for the nominated
reader. The deliverable is a working instructional site with source, runtime
evidence and reviewed media, not a documentation index or a production plan.
Use the existing documentation as research material; implementation and observed
runtime behaviour decide what the site may claim.

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
teaching. Prefer an existing path and a bounded proposed fix for a demonstrated problem.
Add an abstraction, dependency, configuration option or production helper only
when its concrete benefit justifies the maintenance cost. Preserve useful
features and requested evidence. Extend the investigation when it resolves a
reader's question, tests an important claim or diagnoses an observed failure;
separate optional investigations from requirements that must work at delivery.

## Stop before fixing product code

By default, this skill diagnoses product problems; it does not repair product
code. Reproduce the issue, retain the evidence and stop the affected walkthrough
work. Tell the user what failed, why it blocks the delivered journey and the
concrete proposed correction, then ask how they want to proceed. Do not implement
the fix merely because Git makes it reversible or because the task includes
analysis. Work on independent teaching material can continue. This rule does not
prevent edits to the explainer itself. An explicit user override for the current
session takes precedence; do not carry that exception into future skill runs.

## Teach the delivered platform

The walkthrough teaches the product's final behaviour, not the history of building
or repairing it. Do not include remediation stories, finding IDs, before/after fix
comparisons, abandoned implementations or links into the investigation diary.
Keep that history in internal working records outside the reader's teaching path.
Explain intent, implementation, observable behaviour and operation in the present
tense. Failure demonstrations should exercise the delivered error and recovery
behaviour. Audit existing chapters and all media, captions, transcripts, diagrams,
screenshots and linked evidence when this contract changes; prose edits alone do
not update an embedded recording.

When the brief calls for a fully realised platform, missing required behaviour,
broken journeys and insufficient proof of delivery claims are blockers. Do not
launder them into “limits”, “out of scope”, future work or a narrower demonstration.
For a product-code blocker, follow the stop-and-ask rule above. If a blocker cannot
be resolved with available access, inputs or resources, stop dependent delivery and report
the exact blocker, its evidence and what is needed to proceed. Do not present the
platform or pack as complete while it remains. Honest technical boundaries and
evidence scope still matter: they must not disguise unfinished requirements or
justify unsupported claims. Keep the internal completion audit separate from the
finished teaching narrative.

## Use HP Qwen for language and vision

Use the HP-hosted local Qwen model for evidence synthesis, section drafting and
visual inspection in the same multimodal workflow. Call its direct llama.cpp
interface without the Loom facade, ontology scaffold or automatic cloud fallback.
The controlling agent gathers evidence, runs tools and independently checks the
result; a model response is not runtime evidence or permission to edit product code.

Read [qwen-prompting.md](references/qwen-prompting.md) when preparing the first
section packet. Use its shared orientation, evidence distinctions and reusable
section/review prompts; independently verify the claims before media production.

Read [hp-qwen.md](references/hp-qwen.md) before the first model call. Discover the
actual model and vision capability; a familiar model name or a text-only response
does not establish combined mode. Use bounded source excerpts and real captures
for one reader question at a time, retain exact source locations, and qualify a
representative section before batching the pack. Keep this model policy scoped to
skill runs; do not change the enclosing session's model or other services.

## Compose the specialist skills

This is an orchestration skill. **Invoke the relevant specialist by reading its
current SKILL.md and using its tools/workflow**, not merely mentioning its name
in a plan. Discover it from the current session catalogue or Agentbox's installed
skills; do not assume a remembered installation path. On filesystem installations,
reading the file is the invocation when no dedicated skill tool is available.

Read [specialist-handoffs.md](references/specialist-handoffs.md) when producing
visuals, runtime evidence or media. It maps tasks to available skills and defines
what to pass in and what evidence to collect back. Use only the skills needed for
the requested deliverable. Preserve user choices over specialist defaults; do not
silently add a visual style, model-generated material or external service that
changes their brief. Orchestration does not itself authorise subagents, publishing
or production mutations.

## Ground the claims and maintain custody

Locate the authoritative repository, including nested repos, vendored code and
local instructions. Record the revision and hashes of cited files. A HEAD value
alone does not describe a dirty worktree. Coordinate with concurrent agents;
read their output as moving input and revalidate affected claims when it changes.

For each important claim, record what supports it: source, a fresh test run,
a named runtime observation, or an explicitly unverified design intention.
Separate the explanation of intent from assertions of enforcement. Test logs
need commands, environment/mode, exit status, scope, exclusions and durable
output. Freeze evidence in the pack; test runners may delete their normal output
directories on later runs.

Capture only relevant application surfaces in an isolated browser context or a
known owned tab. Label mock data, scripted engines, bypass identities and real
integrations independently. A live HTTP connection does not imply real data;
a scripted worker does not prove model behaviour. If deployed code identity is
not established from a build/image/runtime receipt, call it checkout code.

Use [evidence-and-lessons.md](references/evidence-and-lessons.md) for the evidence
model, end-to-end analysis loop and how to extract reusable lessons from the pilot.

## Build an inspectable reading surface

Keep explanation and media on the left and a swappable source pane on the right
when the reader benefits from comparing them. A reference should open the entire
file at its cited lines without losing the narrative position. Preserve ordinary
file links as a fallback. Support file switching, readable line numbers, wrapping,
keyboard navigation, deep links and a usable narrow-screen layout.

Load source from the bundled checkout over the site's local HTTP server, or use
explicitly labelled immutable snapshots when packaging requires them. Render
source as inert text, including HTML and script files. Restrict file selection to
an indexed set of repository-relative references. Show missing/changed source
honestly; do not silently replace it with stale code. Add hashing or equivalent
revision checks where available, and distinguish “not checked” from “matched”.

Keep serving simple: no build-time dependency should be needed merely to read a
finished local clone unless the user chose that model. Avoid CDN-only diagrams,
fonts or video players in an offline deliverable. Do not conceal implementation
context from the developer audience, but keep site controls about reading rather
than production tooling.

## Produce and review the media

Use the specialist handoffs to turn verified journeys into actual screenshots,
diagrams, animation and narrated videos. Keep each clip focused on a review
question and let measured narration determine its length. Static code and labels
must remain exact and readable. Provide transcripts and browser-compatible
captions alongside audio/video, with source evidence for factual narration.

Follow the user's current packaging decision. If media is part of a normal clone,
track the compressed delivery files; ignore only intermediates and model caches.
Use the FFmpeg skill for browser-compatible compression and inspect the final
encode for readable code, natural speech and correct cuts. Report measured media
size; do not assume a CRF value guarantees quality or a Git hosting limit.

## Close against the full contract

Use [completion-audit.md](references/completion-audit.md) before claiming the pack
finished. This audit covers teaching completeness, source and runtime grounding,
media review, code fixes and clean-copy delivery. A validator, chapter count or
passing test suite cannot establish the whole requirement.

Improve this skill as the work exposes reusable failures and successful methods.
Keep project facts and unfinished work in the project's evidence/production
record. Promote a lesson into the skill only when it changes a future decision;
label untested recommendations rather than presenting them as proven recipes.
