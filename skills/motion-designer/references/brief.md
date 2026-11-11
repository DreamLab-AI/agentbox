# The brief

Fill every slot before writing code. Anything the user did not say, decide and state in one line.
This is also the one-shot prompt: pasted as-is into a fresh session, it produces the film.

```text
Create a bold, high-energy [LENGTH]-second motion graphics piece about [SUBJECT]. [ASPECT].

CONCEPT
- One idea carries the whole film: [HERO ELEMENT] travels through every scene and is the hero
  of each one.
- [N] chapters, each proving one thing: [CHAPTER LIST].
- Every scene hands off to the next through the hero. No unmotivated cuts.
- End card: [WORDMARK], with the hero built into it, plus the line "[ONE LINE]".

FORMAT
- [WIDTH]x[HEIGHT], 60 fps, exactly [FRAMES] frames, MP4 with sound.
- [BPM] BPM. Every cut and every big hit lands on a beat.

LOOK
- Three colors only: [DARK], [LIGHT], one accent [ACCENT]. The accent is reserved for the hero.
- One heavy condensed display font, one mono font for small labels, one serif italic for a single
  contrast line.
- A small technical HUD in the corners: frame counter, timecode, chapter name.

HOW TO BUILD IT
- Write it as code: one HTML file drawing on a canvas, where every frame is a pure function of
  time. No keyframes by hand, no generated footage, no stock.
- Animate with rules: squash and stretch, springs, easing curves, staggers, real motion blur
  from sub-frames.
- Before the full render, render stills at every hit, look at them on a contact sheet, and fix
  what is weak. Do not show me an unchecked render.

MUSIC AND SOUND
- Music: [TRACK: a licensed file I supply, or "holding"]. Mood [MOOD], instrumental, [BPM] BPM so it
  matches the cuts. A holding track is a stand-in for timing and the export is marked as one.
- Cut the track to picture: its drop lands on the first big hit, and it ends on a downbeat under
  the end card, not on a fade in the middle of a phrase.
- Add synthesized impacts and whooshes on top, each landing one frame after its visual hit.
  Master to -14 LUFS.

CONSTRAINTS
- No frozen frames. Something must be moving in every scene at all times.
- No gradients, glows, lens flares or decorative particles.
- Not everything centered, and never the same entrance twice in a row.
- Big words hold still while they are read. The graphics move, not the text.
- No em dashes in any on-screen text.

DELIVER
- The final MP4, a poster frame, and a short breakdown of what you made and why.
```

## Defaults when the user does not say

| Slot | Default |
|---|---|
| Length / frames | 15 s / 900 |
| Aspect | 16:9, 1920x1080. Reels 9:16 = 1080x1920, feed = 1080x1350 |
| BPM | 120 (a beat every 0.5 s, a bar every 2 s) |
| Colors | `#0a0a0a`, `#f1ede4`, accent `#ff4416` |
| Fonts | Anton, JetBrains Mono 500, Instrument Serif italic (Google Fonts, `display=block`) |
| Hero | a dot. Other heroes that work: a line, a square, a cursor, a single letter |
| Music mood | uplifting, inspirational, electronic |
| Track | holding (see [sound.md](sound.md)); a deliverable needs a licensed track |
| Wordmark | the subject's name |

## Beat sheet that worked (15 s at 120 BPM)

| Time | Chapter | What the hero does | Handoff |
|---|---|---|---|
| 0.0 - 2.0 | Timing | drops, bounces on 3 beats, each landing pushes a word out of the ground | slams, floods the frame |
| 2.0 - 4.5 | Type | 3 words, 3 different entrances, hero becomes the period | camera dives into the period |
| 4.5 - 7.0 | System | grid: dots, squares, random tiles, order, one line | the line is a ring seen edge-on |
| 7.0 - 10.0 | Depth | ring, sphere, terrain, tunnel flight | light at the end fills the frame |
| 10.0 - 12.5 | Principles | one principle per beat, word holds, hero proves it. Last beat is a wind-up | cut releases the wind-up |
| 12.5 - 15.0 | Sign-off | burst, wordmark slams, hero lands inside it, one last hop | end |

Scale it: 10 s = drop one chapter, 30 s = two beats per idea instead of one. Keep the first big
hit at the end of bar 1 and the last downbeat 1 s before the end.
