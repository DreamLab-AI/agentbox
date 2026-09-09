# Delivery: video

Video is a video, not a page. This reference hands off to the standalone
`codebase-video` skill rather than reimplementing video production here.

## When to hand off here

The user wants a narrated video explainer, an onboarding film or a product
walkthrough of the current codebase. For a video with no codebase grounding
(a trailer, an avatar spokesperson, a podcast repurpose) route to
`open-montage` instead — that boundary lives in `open-montage`'s own "When Not
to Use" section, not here.

## The handoff

1. Do the hub's shared orientation and grounding first: read the repository's
   instructions, entrypoints, README and relevant implementation, run its own
   gates where that matters to the story, and record the revision.
2. Invoke `codebase-video` by reading its current `SKILL.md` and following its
   workflow — do not just mention it in a plan; actually run it.
3. Pass it what the orientation pass already gathered: the audience, and any
   claims ledger (`claim → file:line`) or evidence packets (source, runtime,
   visual) already assembled. `codebase-video` independently re-verifies
   runtime behaviour itself — it does not accept a claim on the ledger's say-so
   — but reusing your file citations means it does not re-derive them from
   zero.
4. `codebase-video` owns scene production end to end: screenshots, diagrams,
   ComfyUI hero clips, Blender where geometry clarifies the topic, narration,
   captions, composition, and its own scene-by-scene editorial review. None of
   that is duplicated here, and this skill does not call FFmpeg, ComfyUI or a
   TTS service directly.
5. After delivery, record the video's location and its review status in
   `project-state` via `memory_store`, the same as the docs and microsite
   deliveries.

## What this reference does not do

It does not compose scenes, generate hero clips, run FFmpeg or write
narration. If `codebase-video` is not installed or reachable, say so rather
than approximating a video with the docs bundle or the microsite.
