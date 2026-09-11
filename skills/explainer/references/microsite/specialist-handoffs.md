# Specialist handoffs

Resolve the actual skill in the current Agentbox/Codex catalogue, then read its
entrypoint and selected references. When the harness offers no such tools at all, read
[../local-harness.md](../local-harness.md) before doing anything else: the order is skill,
then a documented service from the engagement's manifest, then a hand-up — never a
hand-rolled protocol client. Names below describe the installed estate
used by the pilot; equivalent available skills can fill a capability. If one is
missing, discover it before choosing a fallback. Do not fabricate outputs or
claim a skill ran when only a plan was written.

Pass the entrypoint's model policy to specialists that draft or inspect content:
the HP model through the Loom façade with the scaffold declined per request
(`scripts/loom-draft.mjs`), vision only as the qualified exception. Rendering,
speech synthesis and generated visual assets still use their dedicated tools; no
specialist silently switches to a cloud LLM or re-enables the scaffold.

| Work | Skill to invoke | Input handoff | Required result |
|---|---|---|---|
| Microsite visual system | open-design | Audience, concern entry points, density, offline/brand constraints | Local design tokens, functioning reading layout and browser critique |
| Architecture, flows, state and custody | mermaid-diagrams, routing to diagram-design for presented HTML/SVG | Inspected source, exact relationships, focus question, approved design tokens, **and the frame it will be seen in** | Diagram source, accessible render, checked edges/labels; a flow laid along the frame's long axis or split across scenes, with labels legible at delivery size; motion only where it explains behaviour |
| Real UI journeys and evidence | browser or browser-automation; chrome-cdp for low-level needs | Documented start command, fixtures, declared data/engine/auth mode, isolated tab | Screenshots, actions, resulting state and capture receipts; no invented UI |
| Complete explainer clips | codebase-video (or installed codebase-explainer equivalent) | Audience, review question, claim/source ledger, verified screenshots/diagrams, final media destination | Actual narrated video, editable plan/project, captions/transcript, render receipt and editorial review |
| Local generated visual material | comfyui, when requested or part of the selected video workflow | Visual prompt without private source, model choice, intended illustrative role | Workflow, model/seed/job identity, runtime receipt, reviewed output; label metaphor separately from evidence |
| Explanatory 3D | blender, only when geometry clarifies the topic | Mechanism to explain, coordinates/scale if relevant, render requirements | Editable scene and inspected frames/clip |
| Delivery encoding | ffmpeg-processing | Reviewed master, target browser/size/readability constraints, captions | Compressed MP4, ffprobe/size/hash receipt, playback and visual/audio review |
| Prose and explanatory text | prose-sanitiser | Audience, claim ledger and draft | Concrete comprehensible text that retains the evidence and limitations |
| Reproduced product issue | build-with-quality, plus relevant language/framework skill | Trigger, expected/actual result and evidence | Default: diagnosis and concrete proposed correction, then stop and ask before changing product code; implementation requires an explicit session override |
| Requested security analysis | security-testing | Authorised environment and scope, threat boundary, synthetic identities | Verified findings/refusals with limitations; do not imply a full audit from a narrow check |

Keep the orchestration in the site production record: chosen specialist, exact
skill location/version when available, input files, output artifacts and validation
status. A specialist's successful return is an input to the final review, not an
automatic declaration of complete delivery.

Do not run a new generation job merely because observation timed out. Resume the
submitted handle, or establish it is terminal/missing before replacing it. A specialist
that is absent from the catalogue, or a job that ends in error after one resume, is a
hand-up with `reason=specialist` (`references/handup.md`), not a reason to improvise. Share
GPU capacity conservatively with other work and preserve completed outputs.

Ask the page before you photograph it. A browser session can read the document it is showing,
so check for the failure before saving the frame rather than discovering it three steps
later: look for the product's own error text, an unresolved loading state, or an empty
region where content belongs, and fix the environment before capturing. This costs one
evaluation and saves the whole downstream chain, because once a bad frame is saved it gets
named, linked, narrated over and encoded before anyone looks at it.

A frame showing the product failing is not a frame showing the product. An error panel, a
perpetual spinner, an empty table or a status code where content belongs means the
environment is wrong, not that the feature looks like that; saving it under a filename that
names the feature is how a broken run becomes a published claim. Choose the mode that shows
the product working, which is usually the one it ships with rather than a live mode pointed
at a backend that is not running, and check the frame for those tells before it is linked.

Capture the product in a state it ships. A product that boots a deliberate first-run or
demo world, and labels it as one, is showing you its real first surface; photograph that and
say what it is. Manufacturing data to photograph is the opposite: seeding a database or
inventing an identifier so a page looks richer produces a picture of something the customer
would never see, and it eats hours. Two measured runs lost four hours between them that way,
both while the product's own shipped surface sat one click behind a modal. If the subject
cannot be reached in a state the product ships, that is a prerequisite hand-up.

Media made for another deliverable is not media made for this one. Reusing an existing
clip, capture or diagram is legitimate only when it answers this chapter's review question,
and it is then re-reviewed and labelled as carried over, with its origin in the production
record. Copying a neighbouring pack's files into this one and counting them as delivered is
the failure this rule exists to stop: a run did exactly that on 2026-09-10, importing four
clips from a developer pack into an executive one where none of them answered the chapter.

Narration precedes final scene timing. Diagram and source text should be rendered
deterministically even when a generated clip supplies atmosphere. Review every
scene at delivery resolution and listen through narration and cuts; encoded
streams alone do not establish intelligibility. Keep compression receipts separate
from editorial review, which states what was actually inspected.

Before setting up narration dependencies, inspect the host project's speech-client
configuration and existing service estate. A missing Docker hostname does not
prove that a host-installed service is absent. If the user identifies an existing
host terminal, inspect that authorised session and the actual checkout. Reuse a
working HTTP service when available. Record its implementation/revision, request
parameters and a measured speech smoke test. Keep host-specific addresses in the
production receipt, not as universal defaults in this skill.
