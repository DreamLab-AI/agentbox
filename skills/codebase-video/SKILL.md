---
name: codebase-video
description: "Create a complete audience-targeted video explainer of the current codebase, combining verified screenshots, diagrams, animation, locally generated ComfyUI hero clips, narration and captions. Use for repository explainer videos, technical onboarding films and product walkthroughs; use the ComfyUI skill directly for a standalone generated clip."
---

# Codebase Video

Produce an actual playable video and its editable production project from the
repository in the current working directory. Tailor the story to the nominated
audience. A storyboard, silent montage or unreviewed render is an intermediate
artifact, not the completed request.

Asking for **codebase video** invokes the complete process below by default.
The user supplies the audience, relevant context and the final MP4 destination
for that request, plus any explicit constraints. Source grounding, visual asset
production, local generation, narration, captions, verification and the editable
project are the skill's responsibility; they need no additional prompt wording.

## Ground the story

Read the repository's instructions, entrypoints, README, relevant implementation
and tests. Verify the running behaviour when describing a user flow. Record the
repository revision and map each factual narration claim to a source file and,
where useful, line ranges in `research.md`. Do not send private source files to
external generation services. Prompts for local hero scenes should contain visual
descriptions rather than repository contents.

Use the user's audience, purpose and brand constraints. Let the material and the
audience's needs determine the video's length, then derive scene timings from
the narration. Honour an explicit duration constraint when supplied; otherwise
there is no fixed runtime target. If the audience is absent, inspect context and
ask one short question while gathering evidence. Explain user outcomes to buyers, concrete interactions
to users, and interfaces/data flow/tradeoffs to engineers. Do not narrate a
README's claims as tested behaviour.

Create a project folder outside the source tree by default, or use the user's
chosen output location. Keep `research.md`, `plan.json`, assets, narration,
ComfyUI workflow JSON and runtime receipts together. Read
[the manifest and production reference](references/production.md) before planning
or composing. Read [seed design decisions](references/seed-design.md) only when
extending the implementation or evaluating alternative renderers.

Use the final MP4 destination specified for the current request. If it is missing,
ask while progressing with research and production. After validation, copy the
finished MP4 there and verify that its hash matches the project export.

## Produce the scenes

Draft narration around one concrete problem, a demonstrated solution, an
understandable mechanism and a useful next action. Plan a varied visual sequence:

- Capture actual UI screenshots or interactions through the **browser** skill.
  Start the app using its documented command; use deterministic fixture data.
  For a library or CLI, capture a real invocation and output instead of inventing
  a web interface. Record the command or URL and the resulting asset.
- Draw architecture/data-flow diagrams from source evidence. The bundled
  compositor provides a sequential diagram reveal; use **mermaid-diagrams** or
  code-native browser visuals for richer diagrams and frame-exact animations.
  Keep graph labels, code, captions, logos and exact UI text deterministic.
- Generate cinematic metaphor/hero sequences locally with **comfyui**. Read its
  current video workflow reference, probe the sidecar and installed models, and
  follow the model download and smoke-test path before committing to a model.
  Save the API workflow, model identity, seed, prompt ID, history and downloaded
  output. Use the installed H3 profile by default after checking service/model
  compatibility; follow an explicitly requested model choice. Include at least
  one actual local model-generated hero by default unless the user opts out;
  a colour card or stock clip does not satisfy that requirement. Check current
  official model sources before calling a model state of the art.
- Use **blender** when explanatory 3D geometry, camera moves or spatial mechanisms
  clarify the topic. Render a short deterministic clip or guide frames for
  ComfyUI; follow its video handoff reference. Coordinate GPU use: finish and
  unload the heavy model before a Blender render if VRAM is tight.
  Stage and unload models between phases as needed; use a second available GPU
  when necessary, following the ComfyUI device-selection reference. Preserve
  receipts and resume the same submitted job after an observation timeout.

Generate narration **before locking durations**, using an available local TTS
service or user recordings. The `scripts/narrate.py` helper calls the shared
CPU Pocket service at `POCKET_TTS_URL` (default `http://pocket-tts:8000`), using
background priority so interactive speech gets preference between segments.
See the local narration recipe in the production reference. Measure every
audio asset with `ffprobe`. Select an
intelligible voice, listen for names/acronyms and correct pronunciation. Set each
scene duration to cover its measured narration plus a short breathing interval.
Do not substitute a tone or silent file for narration. Exact word highlighting
requires real alignment timestamps; bundled captions use scene-level pacing.

## Compose and verify

The deterministic helper needs Python 3, FFmpeg with libx264/drawtext and ffprobe.
It uses the standard library and invokes subprocesses without a shell. Run it
from the skill directory, using absolute paths for the production project:

```bash
python3 scripts/video_project.py validate /absolute/project/plan.json
python3 scripts/video_project.py compose /absolute/project/plan.json \
  --output /absolute/project/delivery-v1
```

Use `--preview` only for explicitly labelled drafts without narration. A delivery
folder must be new; iteration creates `delivery-v2` rather than overwriting the
previous review. Import richer Remotion/Videowright/Blender exports as video scenes
rather than stretching the bundled simple compositor beyond its purpose.

Open the final MP4, inspect representative frames from **every scene**, play the
narration and all cuts, and correct clipping, unreadable text, bad pronunciation,
unsupported claims or visual artifacts. Verify total runtime, video dimensions,
audio and caption streams. Review the MP4's embedded selectable subtitles and
sidecar SRT; burn them into an additional export if the destination needs that.
Generated clips must have stable subjects, intentional movement and no stray
text. Screenshots must remain readable at the delivery size. Record this human
or agent editorial inspection in `review.md`; the automated receipt deliberately
says `rendered-needs-editorial-review` and cannot prove these qualities.

Deliver `explainer.mp4`, `poster.jpg`, `captions.srt`, `transcript.md`, `plan.json`,
`receipt.json` and the production project with source assets/workflows. Explain
any unresolved limitation accurately. Completion requires the audience's central
question to be answered by the rendered and reviewed video, not merely green
manifest validation. Publishing is a separate action and needs user authority.

## Related skills

- `explainer` — the family hub for codebase explainers. When its video delivery
  hands off here, it passes the audience and a claims ledger (`claim →
  file:line`) already gathered from its own orientation pass; this skill still
  independently re-verifies runtime behaviour rather than accepting a claim on
  trust.
- `open-montage` — use it instead for video with no codebase grounding: a
  trailer, an avatar spokesperson, a podcast repurpose, or any request not
  targeting the current repository.
