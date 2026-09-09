---
name: open-montage
description: >
  Agentic video production system. Describe a video idea in natural language;
  the agent orchestrates research, scripting, asset generation, editing, and
  rendering across 11 pipelines and 49 tools. Supports zero-key mode (Piper TTS +
  Pexels stock + Remotion + FFmpeg) and premium APIs (ElevenLabs, Runway, Kling,
  Veo 3, Suno). Use when the user says "make a video", "create an explainer
  video", "produce a trailer", "video production", "animate", or "podcast to
  video".
  From calesthio/OpenMontage.
version: 1.0.0
author: calesthio (OpenMontage)
tags:
  - video
  - production
  - animation
  - tts
  - avatar
  - remotion
  - explainer
  - cinematic
env_vars:
  - FAL_KEY
  - ELEVENLABS_API_KEY
  - OPENAI_API_KEY
  - SUNO_API_KEY
  - HEYGEN_API_KEY
  - RUNWAY_API_KEY
  - PEXELS_API_KEY
  - PIXABAY_API_KEY
---

# Open Montage — Agentic Video Production

Describe your video idea. The agent orchestrates the entire production pipeline: research, scripting, asset generation, editing, and final render.

## When to Use This Skill

- "Make a 60-second explainer about quantum computing"
- "Create a cinematic trailer for our product launch"
- "Produce an animated video in Ghibli style"
- "Turn this podcast episode into video highlights"
- "Create an avatar spokesperson video"
- "Make a screen demo of our app"
- Any video production from natural language description

## When Not to Use

- For an audience-targeted explainer of the current codebase with local GPU footage — use `codebase-video`.
- For a written docs bundle or an instructional microsite (no standalone video requested) — use `explainer`.
- For simple image generation — use `art` (Nano Banana 2) or `comfyui`
- For video transcoding/editing only — use `ffmpeg-processing`
- For academic diagrams — use `paperbanana`
- For 3D modelling/rendering — use `blender`
- For 3D Gaussian Splatting — use `lichtfeld-studio`

## Architecture

```
User: "Make a 45-second explainer about black holes"
  │
  ▼
┌─────────────────────────────────┐
│  Open Montage Dispatcher        │
│  (this skill — reads manifests) │
└──────────────┬──────────────────┘
               │ Selects pipeline
               ▼
┌─────────────────────────────────┐
│  Pipeline Manifest (YAML)       │
│  e.g. animated-explainer.yaml   │
│  Defines: stages, tools, order  │
└──────────────┬──────────────────┘
               │ Agent executes stages
               ▼
┌─────────────────────────────────┐
│  49 Python Tools                │  ← Cloned on first use
│  video/ audio/ graphics/        │     to ~/.open-montage/
│  enhancement/ analysis/ avatar/ │
└──────────────┬──────────────────┘
               │ Renders
               ▼
┌─────────────────────────────────┐
│  Remotion Composer (React)      │
│  + FFmpeg post-production       │
└─────────────────────────────────┘
```

## 11 Production Pipelines

| Pipeline | Description | Key Tools |
|----------|-------------|-----------|
| `animated-explainer` | Research-driven explainer with narration | Perplexity → Script → FLUX/Veo → ElevenLabs → Remotion |
| `animation` | Kinetic typography and motion graphics | Remotion → FFmpeg |
| `avatar-spokesperson` | Talking head presentations | HeyGen/SadTalker → TTS → Composite |
| `cinematic` | Trailers and mood-driven edits | Runway/Kling → Music (Suno) → Color grade |
| `clip-factory` | Batch short-form extraction from long video | WhisperX → Scene detect → Auto-trim |
| `hybrid` | Source footage + AI support visuals | Input video → AI B-roll → Stitch |
| `localization-dub` | Multilingual distribution | WhisperX → Translate → TTS (target lang) → Lip sync |
| `podcast-repurpose` | Highlight extraction from podcasts | WhisperX → Highlight detect → Visual overlay |
| `screen-demo` | Software walkthroughs | Screen capture → Annotation → TTS narration |
| `talking-head` | Speaker-focused footage editing | Face enhance → Background → Audio cleanup |

## On First Use — Clone Full Repository

The pipeline defs are baked into this skill, but the 49 Python tools and 767 skill
files live in the full repository. On first invocation, clone and check out a
**pinned** revision rather than floating on the default branch — an unpinned
`git pull --rebase` on every invocation silently rebases onto upstream's current
head, and none of the 49 tools or 767 skill files it fetches are reviewed in
this repo. Upstream ships no tagged releases (`git ls-remote --tags
https://github.com/calesthio/OpenMontage.git` returned nothing as of
2026-09-09), so `OPEN_MONTAGE_REF` pins a specific commit reviewed at that date
instead of a version tag; re-run that `ls-remote` periodically and the operator
should update the pin (and re-review) when it is time to move forward. If the
network is unavailable when first setting this up, use `OPEN_MONTAGE_REF=main`
and treat that as a known supply-chain gap until it is pinned.

```bash
# Clone or update OpenMontage at a pinned revision.
OPEN_MONTAGE_REF="${OPEN_MONTAGE_REF:-08e2151fa02de28a5d6a312b3d575692bf147ad7}"
if [ ! -d ~/.open-montage ]; then
  git clone https://github.com/calesthio/OpenMontage.git ~/.open-montage
  git -C ~/.open-montage checkout "$OPEN_MONTAGE_REF"
  cd ~/.open-montage && pip install -r requirements.txt --break-system-packages
  cd remotion-composer && npm install
else
  git -C ~/.open-montage fetch origin "$OPEN_MONTAGE_REF"
  git -C ~/.open-montage checkout "$OPEN_MONTAGE_REF"
fi
```

After cloning, tools are available at `~/.open-montage/tools/` and skills at
`~/.open-montage/skills/`.

## Zero-Key Mode (No API Keys Required)

These capabilities work without any API keys:
- **Piper TTS**: Offline text-to-speech narration
- **Pexels/Pixabay**: Free stock footage and images
- **Remotion**: React-based video composition and animation
- **FFmpeg**: Post-production, trimming, mixing, encoding
- **ManimCE**: Mathematical animations
- **Auto-captioning**: WhisperX transcription → subtitle burn-in

```bash
# Run zero-key demo
cd ~/.open-montage && make demo
```

## Premium API Capabilities

| Provider | Capability | Key |
|----------|-----------|-----|
| FAL.ai | FLUX images, Kling video, Veo 3 video, MiniMax, Recraft | `FAL_KEY` |
| ElevenLabs | Premium TTS (29 languages), Music, SFX | `ELEVENLABS_API_KEY` |
| OpenAI | DALL-E 3, OpenAI TTS | `OPENAI_API_KEY` |
| Suno | AI music generation (full songs) | `SUNO_API_KEY` |
| HeyGen | Avatar generation | `HEYGEN_API_KEY` |
| Runway | Gen-4 video generation | `RUNWAY_API_KEY` |
| Pexels | Higher-quality stock footage | `PEXELS_API_KEY` |

## Execution Flow

1. **Route**: Select pipeline from the table above based on user's request
2. **Research**: Use `perplexity-research` skill or OpenMontage's built-in web research
3. **Script**: Agent writes script following pipeline's skill guide
4. **Assets**: Generate images/video/audio using pipeline's tool chain
5. **Review**: Agent self-reviews by extracting frames and transcribing
6. **Compose**: Remotion renders or FFmpeg stitches final video
7. **Output**: MP4 with subtitles, mixed audio, platform-optimised resolution

## Checkpoint Protocol

Each stage saves state as JSON. If interrupted, resume from last checkpoint:

```bash
# State files at ~/.open-montage/checkpoints/
ls ~/.open-montage/checkpoints/
```

## Cost Governance

Built-in cost estimation runs before each API call. Configure spend caps in
`~/.open-montage/config.yaml`:

```yaml
cost_governance:
  max_per_action: 2.00      # USD per API call
  max_per_pipeline: 25.00   # USD per full production
  require_approval_above: 5.00
```

## Integration with Existing Skills

| Phase | Our Skill | How It Integrates |
|-------|-----------|-------------------|
| Research | `perplexity-research` | Substitute for OpenMontage's built-in web search |
| Image gen | `comfyui` | Alternative for local Stable Diffusion when available |
| Image gen | `art` | Nano Banana 2 for stylised thumbnails and editorial art |
| Codebase explainer | `codebase-video` | Route here instead when the request is grounded in the current repository — claims tied to source, not a general topic |
| 3D | `blender` | Explanatory 3D geometry or camera moves as a source clip or guide frames, when neither pipeline's generators are photoreal 3D |
| Diagrams | `mermaid-diagrams` | Source-accurate diagrams and flowcharts feeding a scene, instead of an AI-generated infographic |
| Post-production | `ffmpeg-processing` | Direct overlap — can use either |
| Narration review | `notebooklm` | Generate audio overview of script for review |
| Script quality | `codex-companion` | Cross-model review of script via GPT-6 Astra |

## Troubleshooting

**Remotion build fails:**
```bash
cd ~/.open-montage/remotion-composer && npm install && npx remotion --help
```

**Piper TTS not found:**
```bash
pip install piper-tts --break-system-packages
```

**GPU tools (local video gen):**
```bash
cd ~/.open-montage && make install-gpu
```

## Attribution

OpenMontage by calesthio. MIT License. 11 pipelines, 49 tools, 400+ agent skills.
