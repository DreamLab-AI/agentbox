---
name: motion-designer
description: "Builds a finished motion-graphics film in code from a short brief: one time-driven HTML canvas, rendered frame-exact, cut on the beat to music and mastered to MP4. Use for a motion piece, motion reel, kinetic type, animated title or logo sting ('make a 15-second motion piece about X'). Not for a narrated or sourced video (video-production), a repo explainer (codebase-video), teaching a mechanism (manim), editing footage (ffmpeg-processing) or UI micro-interactions."
status: live
compatibility: Needs the browsercontainer sidecar (frames are drawn there over CDP; no browser is installed in the image), plus the baked motion-render binary (or Node 22 for the fallback script), ffmpeg, yt-dlp and Python 3 with numpy from the image. Plain files and shell only, so it runs the same under Claude Code and Codex.
---

# Motion Designer

One brief in, one finished film out. The film is one HTML file: every frame is a pure function of
time, so nothing is keyframed by hand and every fix is one number and a re-render.

Proven on "ONE DOT" (15 s, 900 frames). Its full source is the starting engine:
[example/index.html](example/index.html). Read it before writing a new film.

## Before the first render

Nothing to install. Frames are drawn by the browser sidecar's Chrome, which the `motion-render`
binary drives over CDP in a private window of its own and closes when it finishes. An image
built before the binary was baked does not have it: there, use `node scripts/render.mjs` with the
same arguments. The two take the same options and write the same files. If it reports no CDP
answer, the sidecar is down: ask the operator to run `./agentbox.sh browsercontainer up` from the
host. Connection details belong to the [browser](../browser/SKILL.md) skill.

The page loads its fonts from Google Fonts inside the sidecar, so the sidecar needs outbound
network. Run one render at a time: the script holds a lock and refuses a second.

## Run it in one pass

Do not stop for questions when the brief names a subject and a length. Fill the gaps yourself,
say your calls in one line each, and build. Ask only if the goal itself is unclear.

1. **Brief**: fill every slot in [references/brief.md](references/brief.md). The concept must be
   ONE idea with a hero element that travels through every scene.
2. **Project**: make a project folder under `$WORKSPACE` with `motion/` (copy `example/index.html`
   and `example/motion.js` there), `audio/`, `out/` and `export/`.
3. **Build**: rewrite the scene functions for the new brief. Keep the engine: canvas,
   `renderAt(t)`, the helpers, the shake list, the HUD, the boot block.
4. **Look at it**: stills at every hit, tiled into contact sheets, then fix. Never show an
   unchecked render.
5. **Render**: 60 fps with 3 sub-frames of motion blur. Expect 0.6 to 0.8 s per frame at
   1920x1080, so roughly ten minutes for 900 frames.
6. **Freeze gate**: `scripts/freeze_check.sh` must print `freeze check OK`.
7. **Sound**: a music track cut to picture plus an SFX stem. Follow
   [references/sound.md](references/sound.md). With no licensed track supplied, cut to a holding
   track and say so.
8. **Deliver**: MP4, poster frame, and a short breakdown of what was made and why.

## Commands

```bash
K=<this skill folder>/scripts
R=motion-render; command -v $R >/dev/null || R="node $K/render.mjs"   # older image: the Node fallback
$R <index.html> --out <out> --verify            # must print verify OK
$R <index.html> --out <out> --stills 0.5,2,4.5  # one still per hit
ffmpeg -y -pattern_type glob -i "<out>/stills/*.png" -vf "scale=640:-1,tile=4x3" "<out>/sheet_%d.png"
$R <index.html> --out <out> --sub 3             # full render -> picture.mp4
$R <index.html> --out <out> --sub 3 --from 12 --to 12.5   # re-render one fix
bash $K/freeze_check.sh <out>/picture.mp4 0.4 <end card start seconds>
bash $K/master.sh <out>/picture.mp4 "<export/name_v1.mp4>" --sfx <mix.wav>   # -14 LUFS
```

The renderer serves only the page's own directory to the sidecar. A page that loads files from
elsewhere in the project needs `--root <project folder>`. Other modes (`--draft`, `--probe`,
`--alpha`, `--scale`) are listed by `motion-render --help`.

Version every export (`_v1`, `_v2`), never overwrite.

## Laws

**Structure**
- One hero element in every scene. The accent colour belongs to it alone.
- Every scene hands off through the hero (it slams and floods the frame, the camera dives into it,
  it becomes the period). No unmotivated cuts.
- Pick the BPM first. Every cut and big hit lands on a beat. 120 BPM = a beat every 0.5 s.

**Motion**
- No frozen frames. Something moves in every scene at all times. A beat where nothing moves reads
  as a glitch. Only the end card may hold, and it still gets a slow push plus one last move.
- Impacts cause things: a landing pushes a word up, a slam shakes the frame, a wind-up fires a burst.
- Squash on contact, stretch with speed, overshoot with springs, stagger by 1-2 frames.
- Big words hold still while they are read. The graphic next to them moves.
- Never the same entrance twice in a row. Not everything centred.

**Look**
- Three colours: near-black, bone white, one accent. One heavy display font, one mono for labels,
  one serif italic for a single contrast line.
- Banned: gradients, glows, lens flares, decorative particles, everything fading in at once.
- No em dashes in on-screen text.

**Code**
- Every frame is a pure function of `t`. No timers, no `Math.random`, no CSS transitions.
- Flashing: at most 3 full-frame colour changes per second.

## After the first render, write notes with frame numbers

Look at the contact sheets and name what is weak ("f480 sphere too small", "f765 burst thin").
Fix one or two things per round, re-render only that range. Two rounds is normal.

## Deliver

- The MP4, the poster frame and the audio files, with their paths.
- A short breakdown: the concept, the beat sheet, what was fixed after the first render.
- Credit the music track and artist.
- A holding export is named `*_holding_*`, carries a `.rights.json` beside it, and is for review
  only. State that in the first line of the hand-over, with the source of the stand-in.
- Say what could not be verified: the model cannot hear the mix, so the track choice and any splice
  need a human ear.
