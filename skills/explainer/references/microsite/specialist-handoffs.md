# Specialist handoffs

Resolve the actual skill in the current Agentbox/Codex catalogue, then read its
entrypoint and selected references. Names below describe the installed estate
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
| Architecture, flows, state and custody | mermaid-diagrams, routing to diagram-design for presented HTML/SVG | Inspected source, exact relationships, focus question, approved design tokens | Diagram source, accessible render, checked edges/labels; motion only where it explains behaviour |
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
submitted handle, or establish it is terminal/missing before replacing it. Share
GPU capacity conservatively with other work and preserve completed outputs.

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
