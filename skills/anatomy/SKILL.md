---
name: anatomy
description: >-
  Builds detailed isometric SVG figures that explain a technical idea as a
  working physical object, with solid parts, truthful readouts and optional
  interaction, WebGL or 3D. Use for mechanical technical illustrations,
  algorithm explainers, interactive instruments and crafted figures for docs,
  articles or web pages. Not for architecture topology (fossflow), Mermaid
  corpora (diagrams-as-code), general editorial diagrams (diagram-design),
  or explaining a whole repository (explainer).
license: MIT
compatibility: "Claude Code and Codex; Node builds the bundled geometry kit without npm dependencies. Browser checks need a reachable browser or local Chromium."
---

# Anatomy

The object is the explanation: invent a recognisable machine whose mechanism
maps onto the idea. Its visual state, readout and caption share one truthful
model. Keep text around the drawing, solids shaded and depth-sorted, and the
subject clearly distinguished.

## Progressive discovery

Jev / skill-router selects this skill from its descriptor. Read these resources
only for the current phase; paths in the upstream guide are relative to this
skill's root, not its references directory.

1. Before creating geometry, read [upstream workflow](references/upstream-skill.md)
   for sizing, concept, parts list and build order. Honour the user's scope and
   budget. Default to static SVG; add interaction, WebGL or 3D when requested.
2. Read [craft](references/craft.md) and [kit API](references/kit.md) when
   implementing solids, camera projection and painter's order.
3. Choose [React integration](references/react.md) for React/Next.js or the
   framework-free `examples/dial-indicator/build.mjs` as the smallest Node
   example. Copy the kit/example into the output project before building:
   the baked `/opt/agentbox/skills/anatomy` master copy is read-only.
4. Load [motion](references/motion.md) for interaction,
   [WebGL](references/webgl.md) for shaders, and [3D](references/3d.md) only for
   turning parts. Preserve keyboard access, reduced motion and SVG fallback.
5. Use [verification](references/verify.md) for screenshots, close-up inspection,
   line ends and depth-order checks. Browser scripts default to local Chromium;
   use the estate browser skill / CDP sidecar when local Chromium is unavailable.
   Both harnesses can run the Node builders directly.

## Included resources

- `kit/`: SVG/TypeScript geometry, drawing, motion, shader and audit primitives.
- `examples/`: seven complete framework-free and React examples, including
  dial indicator, desk computer, test rig, spot plate, ripple tank, rocket
  engine and turning dial. Start with the closest mechanism.
- `scripts/`: capture, interaction replay, line checks and 3D fidelity/bench tools.
- [Walkthrough](references/walkthrough.md): a complete worked build.
- [Source provenance](references/provenance.md): upstream archive and local adaptation.

For a smoke build, copy this directory to a writable scratch directory and run
`node examples/dial-indicator/build.mjs` and again with `--light`. No package
installation is required for the standalone builder.
