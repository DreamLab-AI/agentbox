---
name: clipcannon
description: >
  Local-GPU video understanding and editing via MCP — analyse footage, find the best
  moments, cut highlight reels, add captions, render platform-ready clips (TikTok/Reels/
  Shorts/YouTube), clone voices, lip-sync avatars, generate music, and run a real-time
  voice agent. Use when the user says "edit this video", "find the best moments", "create
  a highlight reel", "add captions", "clone voice", "lip sync", "render for TikTok", or
  "talk to Jarvis". Not for plain format conversion (ffmpeg-processing), image generation
  (comfyui), or meeting capture (echoloop).
version: 0.1.0
author: ChrisRoyse
repo: https://github.com/JLMA-Agentic-Ai/jlma-clipcannon
mcp_server: true
protocol: stdio
entry_point: clipcannon serve
tags:
  - video
  - editing
  - voice-cloning
  - lip-sync
  - transcription
  - voice-agent
  - ai-music
  - text-to-video
  - mcp
  - gpu
env_vars:
  - CLIPCANNON_DATA_DIR
  - CLIPCANNON_GPU_DEVICE
  - CLIPCANNON_NVENC
---

# ClipCannon -- AI Video Editor via MCP

Turns Claude into a professional video editor. Ingest video, run a 22-stage AI analysis
DAG, then use 51 MCP tools across 12 categories to find moments, create edits, render
platform-ready clips, generate music, clone voices, produce lip-synced talking-head
videos, and converse via a real-time voice agent. Everything runs locally on GPU with a
tamper-evident SHA-256 provenance chain.

**Full catalog** (51 tools, 14 ML models, 5 embedding spaces, credit costs, architecture
diagram, Voice Agent lifecycle, integrations) lives in
[`references/tools-and-models.md`](references/tools-and-models.md). Read it when you need
an exact tool name, a model's VRAM budget, or the credit cost of an operation.

## When to Use This Skill

- **Video editing**: "edit this video", "cut the boring parts", "create a highlight reel"
- **Content discovery**: "find the most emotional moments", "find where they talk about X"
- **Platform rendering**: "render for TikTok", "create Instagram Reels version"
- **Voice**: "clone this speaker's voice", "generate narration", "lip sync"
- **Audio**: "add background music", "generate sound effects", "compose a score"
- **Analysis**: "transcribe this video", "who are the speakers?", "scene breakdown"
- **Text-to-video**: "generate a video from this script" (end-to-end voice + lip-sync)
- **Voice Agent**: "talk to Jarvis", real-time conversational AI with wake-word activation

## When Not to Use

- For simple video format conversion -- use `ffmpeg-processing`
- For AI image generation -- use `comfyui` or `art`
- For agentic video production from scratch -- use `open-montage`
- For meeting transcription -- use `echoloop`
- For audio-only processing -- use `ffmpeg-processing`

## Quick Path

```bash
# Install (requires Python 3.12+, CUDA GPU, 8+ GB VRAM min, 24+ GB recommended)
pip install clipcannon
clipcannon serve                       # start the MCP server

# Docker (Dashboard :3200, License server :3100)
cd config && docker compose up -d
```

Typical MCP flow once the server is up:

1. `clipcannon_project_create` -> `clipcannon_ingest` (runs the 22-stage pipeline; ~10 credits)
2. `clipcannon_find_best_moments` / `clipcannon_search_content` to locate material
3. `clipcannon_create_edit` (declarative EDL) -> `clipcannon_preview_clip` (free, 540p)
4. `clipcannon_render` with a platform profile (TikTok, Reels, Shorts, YouTube, YouTube 4K,
   Facebook, LinkedIn)

Voice / avatar extras: `clipcannon_speak` (cloned voice), `clipcannon_lip_sync`,
`clipcannon_generate_music`, `clipcannon_generate_video` (text -> voice -> lip-sync).

## Voice Agent ("Jarvis")

Real-time, all-local conversational AI with "Hey Jarvis" wake word. It pauses other GPU
workers on activation and resumes them on deactivation to share a single GPU's VRAM.

```bash
python -m voiceagent talk --voice boris        # Pipecat + Ollama, all local
python -m voiceagent serve --port 8765         # WebSocket server for remote clients
```

Lifecycle and component models are in
[`references/tools-and-models.md`](references/tools-and-models.md#voice-agent-jarvis).

## From Source

```bash
cd /tmp && git clone https://github.com/JLMA-Agentic-Ai/jlma-clipcannon.git
cd jlma-clipcannon && pip install -e ".[ml]" ".[phase2]"
```

Set-up options and defaults for `CLIPCANNON_DATA_DIR`, `CLIPCANNON_GPU_DEVICE`, and
`CLIPCANNON_NVENC` are documented in the reference file.

## Attribution

ClipCannon by Chris Royse. BSL 1.1 License.
Repo: https://github.com/JLMA-Agentic-Ai/jlma-clipcannon
