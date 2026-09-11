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

## Gate the assets before they reach the cut

`scripts/asset-gate.mjs --assets <dir> --frame 1920x1080` refuses a picture on the three
grounds a machine can settle, and each of them sank a measured run:

- **FAILING** — it reads the text off the frame and looks for a status code, a failed fetch,
  a loading placeholder or an empty state. A capture of the product failing is not a capture
  of the product, and a filename saying otherwise turns a broken environment into a claim.
- **EMPTY** — it trims the uniform border and reports what is left. A drawing centred in a
  frame it was not composed for occupies a sixth of the picture while its dimensions still
  read 1920 by 1080.
- **SHRUNK** — for a vector it reads the declared font sizes, scales them to the frame, and
  says how tall the smallest label will actually be. Six pixels is not a small label; it is
  no label.

Run it before composing, not after rendering: the cheapest moment to reject a frame is
before narration is timed to it. An engagement whose product legitimately uses one of the
failure words passes it with `--allow-text`.

The gate settles only what a machine can see. Whether the capture shows what its name
claims, whether the diagram is true, and whether the whole thing teaches anyone still need
a session that can look at the frames, which is a different session from the one that made
them.

## What this reference does not do

It does not compose scenes, generate hero clips, run FFmpeg or write
narration. If `codebase-video` is not installed or reachable, say so rather
than approximating a video with the docs bundle or the microsite.
