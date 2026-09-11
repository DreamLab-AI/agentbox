# Hand off an animation

## Codebase video

Render externally and use the existing `kind: video` asset contract. No new
scene kind, Manim plugin or compositor dependency is required. A scene entry
looks like this **after** speech and source evidence have been produced:

```json
{
  "id": "queue-mechanism",
  "kind": "video",
  "asset": "assets/queue.mp4",
  "title": "How work waits for a worker",
  "duration": 7,
  "narration": "Two jobs arrive. The worker takes the first. One job remains in the queue.",
  "audio": "audio/queue.wav",
  "evidence": ["src/queue.py"]
}
```

This is a schema example, not a runnable fixture. Replace the evidence path and
claim with inspected source. Use the measured narration duration and matching
visual timing. The complete plan follows
[codebase-video's production reference](../../codebase-video/references/production.md).

The current compositor has four material behaviours:

- It overlays a title band over the top 19% of every scene. Place meaningful
  content below that region and above the caption area. It scales to fit the
  whole frame, not to an automatically computed safe content rectangle.
- It replaces input video audio with the scene's narration. Keep speech in the
  separate `audio` asset; do not rely on a Manim voiceover embedded in the clip.
- It holds the last frame if the visual is shorter than the scene duration and
  cuts at the duration if longer. Plan the ending hold explicitly and check that
  no semantic transition is cut. Match fps and dimensions before composition.
- `generation` describes model-generated footage and requires a model, workflow
  and prompt ID. Omit it, and omit `role: hero`, for a deterministic Manim shot.
  Keep the Manim receipt beside its editable source; the current compositor
  hashes the video asset but does not ingest a Manim-specific receipt.

Manim does not change codebase-video's existing local-hero default, caption
review or final MP4 delivery rules. The owning skill handles the full film.

## Knowledge pages and progressive discovery

Use four reader layers as needed:

1. A complete static overview and a short explanation of the mechanism.
2. An explicit Play action for the animation, with native playback controls.
3. Named step links, stills or section clips for inspecting a change.
4. Links to the deeper explanation and relevant source/evidence view.

Use `Scene.next_section()` and `--save_sections` to create section media and an
index. Translate that index into the consumer's own navigation; Manim core does
not build a keyboard-accessible teaching page. Give meaningful section names,
provide captions/transcript for speech, and honour reduced-motion preferences
in the page without hiding the explanation. A diagram-design HTML animation
retains its own static-first and control contracts; embedding an MP4 does not
make the movie satisfy its SVG verifier.

For parameter sliders, live recomputation, hover explanations or arbitrary
branching, use an HTML/SVG/Canvas implementation in the microsite. Prerendered
Manim sections can illustrate known cases but are not a live browser model.

## Presentations and other video owners

Provide MP4 plus poster/static explanation and source to the chosen deck or
[open-montage](../../open-montage/SKILL.md) workflow. Check playback in the actual
presentation application. Core sections are the first integration choice.
Manim Slides and Manim Voiceover are optional ecosystem projects; evaluate and
pin their compatibility separately before adopting them. They are not required
by this skill and have not been validated by its initial smoke test.

## Future automation boundary

If repeated authoring warrants it, add a small declarative beat specification
beside the existing diagram IR: stable object IDs, claim references, explicit
states, transitions, duration and narration segment ID. Keep structural meaning
and temporal pedagogy separate. Do not invent a general Mermaid-to-Manim compiler
before a small set of supported transformations and fidelity tests exists.
