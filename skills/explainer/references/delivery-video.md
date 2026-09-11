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

## A diagram bound for a frame is composed for that frame

A diagram drawn for a page and a diagram drawn for a video are different drawings, and the
difference is not resolution. A top-to-bottom flowchart is right on a page, where the reader
scrolls and the text sits at reading size. Rendered into a landscape frame it becomes a
narrow column down the middle with empty thirds either side, and its labels shrink below
legibility while the file's pixel dimensions still say 1920 by 1080. One measured render was
natively 330 by 545 and was scaled into a 1080p still: correct content, unreadable video
(2026-09-11).

So before rendering, decide from the frame, not from the habit:

- **Lay the flow along the long axis.** Landscape frame, left-to-right flow. Most
  diagram-as-code tools take the direction as one token, so this costs nothing.
- **Or split it into scenes**, one phase per frame, which usually suits narration better
  anyway: the viewer sees the step being described rather than hunting for it in a
  wall-sized graph.
- **Judge the label, not the canvas.** A caption under roughly 20 pixels tall at delivery
  resolution cannot be read on a laptop, whatever the frame's dimensions are. Measure the
  rendered text, or look at the frame and say honestly whether you can read it.
- **Never upscale a portrait graph into a landscape frame** and call the result 1080p. If
  the drawing is genuinely portrait, keep it portrait on the page and draw a different one
  for the video.

The same applies to a screenshot: trim the viewport to the content rather than leaving half
the frame blank, and dismiss a first-run modal that covers what the scene is about.

## What this reference does not do

It does not compose scenes, generate hero clips, run FFmpeg or write
narration. If `codebase-video` is not installed or reachable, say so rather
than approximating a video with the docs bundle or the microsite.
