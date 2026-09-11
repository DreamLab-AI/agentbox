# Manim integration assessment

Inspected 2026-09-11. Target: this repository's `./skills` seed. Baseline Agentbox
revision: `9289212bca6e9ec8e9cfeb49f75c08691f3294d0`. No installed runtime skill
files are integration targets.

## Recommendation

Add Manim as a lazily discovered animation specialist. Route to it when the
reader needs to understand **how a mechanism changes**, then return its assets
to the existing page, presentation or film owner. Keep the upstream engine
external and version-pinned. A CLI plus editable Python scenes is sufficient
for the first integration; a permanent service or MCP wrapper adds no necessary
capability to the tested workflow.

This recommendation follows the seed's existing division of responsibilities:

| Existing owner | Inspected responsibility | Manim relationship |
|---|---|---|
| `mermaid-diagrams` | Routes editorial diagrams to diagram-design; owns code-first Mermaid rendering | Route mechanism animation to Manim; retain `.mmd` for static structure |
| `diagram-design` | Branded layouts, semantic patterns, Mermaid/draw.io import, accessible SVG | Share meaning and design tokens; retain browser-native reveal/step interactions |
| `explainer` | Audience, seven-question comprehension arc, evidence ledger, docs/microsite/video delivery | Select a short animation only after the underlying explanation is accepted |
| `codebase-video` | Measured narration, generated hero footage, clip assembly, captions and editorial review | Consume the rendered MP4 as an existing video scene |
| `blender` | Spatial geometry, camera work and 3D production | Retain cinematic/spatial work; use Manim for precise symbolic and quantitative motion |
| `open-montage` | Video production beyond a codebase brief | Consume completed Manim shots through its asset workflow |

Seed evidence: [diagram router](../../mermaid-diagrams/SKILL.md),
[motion contract](../../diagram-design/references/animation.md),
[diagram import](../../diagram-design/references/import-mermaid.md),
[explainer hub](../../explainer/SKILL.md),
[video production](../../codebase-video/references/production.md),
[compositor implementation](../../codebase-video/scripts/video_project.py),
[Blender handoff](../../blender/references/explainer-video.md), and
[open-montage](../../open-montage/SKILL.md).

## What the upstream inspection establishes

The requested repository was shallow-cloned to
`/tmp/agentbox-manim-study/manim` at
`b949b73e5bd49bc0ef250eba4a9a757554a6f2b0`. The following links pin that inspected
source rather than following future `main` changes:

| Capability | Source evidence | Integration consequence |
|---|---|---|
| Python package, version 0.21.0, Python >=3.11, MIT declaration, Cairo/Pango/PyAV dependencies | [pyproject.toml](https://github.com/ManimCommunity/manim/blob/b949b73e5bd49bc0ef250eba4a9a757554a6f2b0/pyproject.toml) | Pin Python and native runtime; ordinary labels need no TeX |
| Explicit animation and section boundaries | [scene.py](https://github.com/ManimCommunity/manim/blob/b949b73e5bd49bc0ef250eba4a9a757554a6f2b0/manim/scene/scene.py) | Author semantic beats; render selected levels of explanation |
| Section video concatenation and JSON index | [scene_file_writer.py](https://github.com/ManimCommunity/manim/blob/b949b73e5bd49bc0ef250eba4a9a757554a6f2b0/manim/scene/scene_file_writer.py) | A microsite can build navigation around named clips |
| Graph/DiGraph, NetworkX import and layout support | [graph.py](https://github.com/ManimCommunity/manim/blob/b949b73e5bd49bc0ef250eba4a9a757554a6f2b0/manim/mobject/graph.py) | Useful for traversal and graph changes; review layout stability and direction |
| Animated scalar state | [value_tracker.py](https://github.com/ManimCommunity/manim/blob/b949b73e5bd49bc0ef250eba4a9a757554a6f2b0/manim/mobject/value_tracker.py) | Drive changing quantities and dependent visuals from explicit data |
| Cairo/Pango, fonts, TeX and headless GL libraries in official image; PyAV encoding libraries | [Dockerfile](https://github.com/ManimCommunity/manim/blob/b949b73e5bd49bc0ef250eba4a9a757554a6f2b0/docker/Dockerfile) | Container offers an isolated baseline; existing Agentbox FFmpeg still handles assembly/probing |

The release container is a separate versioned artefact from the inspected
`main` commit; the smoke test does not assert they contain identical source.
Core APIs and exports were checked against both source and the actual render.

## Two kinds of progressive discovery

**For the agent:** the directory/router description selects `manim`; its short
entry point selects a rendering, handoff or integration reference. Runtime setup
is loaded only when a render is needed. The always-loaded registration manifests
remain unchanged.

**For the reader:** begin with a complete overview, optionally play a mechanism,
inspect a named step, and open the related explanation or source. Existing
explainer evidence links supply depth. Manim supplies media, not the knowledge
model or the navigation UI. This avoids forcing every reader through a long film.

Useful first applications include an algorithm's visited frontier, queue
accumulation and service, a cache hit/miss branch, a state transition with guards,
or an equation whose transformation preserves matching terms. Use a measured
trace when claiming observed behaviour; label synthetic teaching data clearly.

## Integration decisions and limits

1. **Start with a clip boundary.** The compositor already accepts MP4. Its
   `scene_filter` overlays the top 19%; `compose` replaces audio, holds short
   footage and trims to duration. These behaviours require authored safe areas
   and narration-derived timing, documented in [handoffs](handoffs.md).
2. **Keep diagram IR structural.** Existing Mermaid extraction supports flowchart,
   sequence, state and ER grammars. It carries topology and semantics, not a
   temporal teaching plan. First author a small explicit scene from that data;
   defer a general conversion engine and preserve the fidelity ledger.
3. **Use Cairo first.** The initial 2D render needs no GPU, leaving GPU capacity
   available to other work. OpenGL, TeX, Typst and complicated 3D are separate
   validation cases; they are not established by the queue test.
4. **Keep narration with the owner.** Reuse codebase-video's Pocket workflow.
   Manim Voiceover may help specialised timing later, but introducing another
   speech stack now would duplicate responsibility and its embedded audio would
   be replaced by the current compositor.
5. **Use core sections before presentation plugins.** Manim Slides is a possible
   later presentation adapter. Neither it nor Voiceover was installed or tested.
   Consult the [official plugin catalogue](https://plugins.manim.community/)
   and verify the selected project's current compatibility before adopting it.
6. **Preserve a non-video explanation.** Media has no semantic SVG accessibility
   tree or live parameter controls. Provide static/text alternatives and captions;
   use browser-native graphics for interactive computation.

## Initial validation

The pinned official 0.21.0 image rendered the bundled illustrative FIFO queue
with Cairo, no network during rendering, no GPU, and no TeX scene objects.
The output is seven seconds, 854 × 480 at 24 fps, H.264/yuv420p. Three section
clips cover overview (1s), arrivals (3s) and departure (3s).

The first frame inspection found overlapping travelling tokens and an unavailable
font. The fixture was corrected to use separate travel lanes and the image's
Noto Sans font. Render logs, section index, probes, contact sheets and compositor
preview are retained in `/tmp/agentbox-manim-study/`; the corrected composed
preview is `delivery-v2/explainer.mp4`. The [smoke-test receipt](smoke-test.json)
preserves image identity, source/output hashes, frame counts and review limits.
The composed MP4 decoded fully and its sampled frames retained clear labels
below the title overlay. This is a silent integration
smoke test, not a completed narrated explainer or an audience-comprehension test.

## Follow-on adoption gates

The seed addition establishes discovery, guidance and a renderable fixture.
Before expanding it into a baked renderer or automated scene compiler:

- Run one repository-grounded narrated mechanism through final editorial review.
- Check a keyboard-operated knowledge-page embed with reduced motion and static
  alternatives, and a presentation export in its actual player.
- Benchmark representative graph and equation scenes at delivery resolution;
  record render time, memory, dependency footprint and reproducibility.
- Only then decide whether recurring installation cost warrants a Nix derivation
  or an optional image build. Keep it out of the base closure until measured.

No upstream fork, additional MCP registration, base-image rebuild or live-skill
installation is part of this integration.
