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
- **Leave the title to the scene.** A compositor puts the scene's name at the top of the
  frame, so a diagram that carries its own heading gets two, overlapping. Draw the diagram
  without a title band and let the clip name it; on the page, the chapter's own heading does
  the same job. This recurs because fixing one video's assets does not change the drawing
  rule that produced them.
- **Never upscale a portrait graph into a landscape frame** and call the result 1080p. If
  the drawing is genuinely portrait, keep it portrait on the page and draw a different one
  for the video.

The same applies to a screenshot: trim the viewport to the content rather than leaving half
the frame blank, and dismiss a first-run modal that covers what the scene is about.

## Visual work is made, seen, then revised

Prose in this method gets four steps: research, write, an independent check, revision. The
chapters produced that way came out accurate and lint-clean first time. Media on the same
run got two steps, make and ship, and produced a video showing a broken product behind an
unreadable drawing. The difference was the loop, not the subject.

So anything visual takes the same four:

1. **Make** the asset, and write down what it is meant to show.
2. **Gate** it mechanically: `scripts/asset-gate.mjs` below.
3. **See** it. A session cannot look at a picture it wrote, so this is a separate session
   with the frames attached as input (`evals/run-chaptered.sh` takes an `attach` list). Ask
   it what is actually there, whether the product is working in it, whether the file name is
   honest, and what is unreadable.
4. **Revise** from that review, then gate and see again. Two passes is usually enough; a
   third means the asset is wrong in kind rather than in detail.

The seeing step is not optional politeness. On a measured run it caught a header crop that
proved nothing, two frames misnamed for states they did not show, and two mangled labels in
a diagram that every other check had passed.

## Compose with the compositor, not with invention

`codebase-video` ships a deterministic compositor with a validate step and a compose step,
and a plan format that carries scenes, their assets and their measured narration. Use it.

A measured run ignored it and assembled the video with hand-written FFmpeg filter graphs
instead. The result was 1920 by 1080, correctly timed to the narration, with captions that
matched the transcript line for line, and unusable: the diagram sat in a sixty-pixel column
down one edge and two fifths of every frame was blank. Composition is where a video is made
or lost, and it is the part least suited to invention under time pressure, because the
failure is invisible to every check except looking.

Hand-rolled FFmpeg is for a transformation the compositor does not offer, recorded as such
in the production record, never for laying out a scene.

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

## What a delivered pack looks like, and what it costs

A deliverable holds what a reader needs and nothing else. Everything that made it lives in
the engagement record, except one file: the notes for rebuilding it.

```
walkthroughs/<audience>/
  chapters/<id>.md
  assets/
    diagrams/<id>.svg  <id>.png  <id>.mmd     source beside render
    screenshots/<id>.png
    videos/<chapter-id>/
      explainer.mp4        the delivered encode, not the master
      captions.vtt         and .srt where the destination wants it
      transcript.md
      poster.jpg
      construction.md      how to rebuild this clip without the master
```

`construction.md` is what lets the master be deleted. It names the scene plan and its
timings, the assets each scene used with their hashes, the narration script and the voice
and speed that produced it, the encode settings, and the one command that recomposes. A
clip whose master is gone and whose construction notes are complete can be remade; a clip
with a 200 MB master in the repository and no notes cannot be remade cheaply and costs
every clone.

**The budget, from measurement rather than habit.** A diagram-led scene is a still with
overlays and compresses to almost nothing: a measured 96-second chapter clip at 1600x900
came to 2.2 MB, 185 kbps, with every sublabel legible. Generated motion costs roughly eight
times that per second. So:

| Budget | Figure | Why |
|---|---|---|
| Diagram and capture-led video | 2 MB per delivered minute | measured at 1.4 with labels still readable |
| Generated-motion video | 4 MB per delivered minute | motion needs the bitrate; a five-second shot does not need 11 |
| Any single file | 25 MB | far below a repository's hard ceiling; above this, something other than the video is wrong |
| All media in one pack | 25 MB | a seven-chapter pack with a clip each lands near 17 MB, leaving room |

Treat these as the default for a repository-hosted pack and restate them when the
destination differs. A page with a first-paint budget is stricter; an offline bundle on a
memory stick is not. Whatever the number, say it before encoding and measure after.

## Encode for where it will live, and ship one delivery

A composed master is not a deliverable. It is sized for the compositor's convenience, and it
arrives beside every earlier attempt, because iterating correctly means writing a new
delivery folder rather than overwriting a reviewed one. Both of those have to be resolved
before the work leaves the workspace.

**Encode for the destination.** Hand the accepted master to `ffmpeg-processing` with the
constraint that actually applies: a repository has a per-file ceiling and a whole-clone
cost, a page has a first-paint budget, an email has neither. State the budget before
encoding, then measure the result and write the measurement down. A CRF value is a setting,
not an outcome; only the file on disk tells you the size, and only watching it tells you
whether the text survived. Check the encode at delivery resolution for readable labels and
intact narration before the master is put away.

**Ship one delivery, and delete the master.** The accepted encode goes to the target in the
layout above, with its construction notes. Superseded delivery folders, masters, scene
stills and intermediate renders are production material: they belong in the engagement
record, and once the construction notes are complete the master can go entirely. A run that
leaves `delivery-v1` beside `delivery-v2`, or a 4 MB master beside a 2 MB delivery, has not
finished tidying, whatever its review said.

**Say what it cost.** The production record carries the measured size of what shipped, the
encode settings, and the size before and after, so the next engagement can budget from a
number rather than a guess.

## What this reference does not do

It does not compose scenes, generate hero clips, run FFmpeg or write
narration. If `codebase-video` is not installed or reachable, say so rather
than approximating a video with the docs bundle or the microsite.

## Smoke-test the chain before fifteen items depend on it

Fifteen clip items, each narrating and composing one chapter, is fifteen budgets riding on a
path nobody has run in this engagement yet. Run it once, on a one-scene plan, before they start:
synthesise a line of speech, retime the scene from the measured audio, compose the clip. It takes
two minutes and it answers the questions the items cannot.

Doing that here found the one that would have cost the most. `video_project.py` refuses any scene
without `evidence` — a non-empty list of repository-relative paths that exist — and says only
"source evidence is required". A clip item that has written its narration, called the speech
service and assembled its scenes discovers this at the last step, and a plan is not obviously
missing a field nobody told it to write. Fifteen items would have failed the same way.

The requirement is right: it is the compositor refusing to make a film about a claim with nothing
behind it. So the item is told about it, and told where the paths already are — the chapter's own
grounding section lists the file and lines behind every claim it makes, which is exactly the
evidence list with the line numbers dropped.
