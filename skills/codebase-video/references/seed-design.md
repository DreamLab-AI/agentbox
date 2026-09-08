# Seed research and implementation choices

Inspected upstream READMEs on 8 September 2026. These are design inspirations;
this skill does not vendor their code or silently install their dependencies.

| Source | Useful pattern adopted | Adaptation for Agentbox |
| --- | --- | --- |
| [video_explainer](https://github.com/prajwal-y/video_explainer) | Narration precedes storyboard timing; source fact checking and staged visual refinement | Measure local narration and preserve a source evidence ledger |
| [Videowright](https://github.com/scosman/videowright) | Self-contained visual beats, deterministic exports and timing separate from visuals | Typed scene kinds; import its rendered components when richer motion is useful |
| [Claude Code Video Toolkit](https://github.com/digitalsamba/claude-code-video-toolkit) | Combine recorded demos, generated video, voice and scene review in one production project | Reuse Agentbox browser, Blender and ComfyUI sidecars; keep production local |
| [repo-explainer](https://github.com/johnpsasser/repo-explainer) | Repository inspection feeds a concise script and generated cinematic sections | Target audience explicitly; use grounded UI and diagrams alongside local hero generation rather than prescribing five clips |
| [ComfyUI-Agent-Kit](https://github.com/SlavaSexton/ComfyUI-Agent-Kit) | Potential agent harness integration | See the ComfyUI video reference for the inspected integration decision and runtime contract |

The compositor is deliberately a small standard-library orchestration layer over
FFmpeg. It consumes finished assets and enforces delivery invariants, while the
agent owns codebase reasoning, visual design and model workflow selection. This
keeps arbitrary repository execution and model downloads out of a render step.
A renderer success is not a factual, audience or aesthetic success: review is a
separate production gate.
