---
name: echoloop
description: >
  Real-time AI meeting copilot. Dual audio capture (system + mic), live transcription
  (faster-whisper local or Deepgram cloud), LLM coaching loop (Claude/GPT every ~35s),
  always-on-top overlay, session logging with markdown export. Use when the user says
  "meeting recap", "meeting copilot", "live transcription", "meeting insights",
  "coaching during meeting", or "record this call".
version: 1.0.0
author: Pete Woodbridge (EchoLoop)
tags:
  - meetings
  - transcription
  - audio
  - coaching
  - real-time
  - whisper
  - deepgram
env_vars:
  - ANTHROPIC_API_KEY
  - OPENAI_API_KEY
  - DEEPGRAM_API_KEY
  - ECHOLOOP_SYSTEM_DEVICE
  - ECHOLOOP_MIC_DEVICE
---

# EchoLoop — Real-Time Meeting Copilot

Live meeting transcription + AI coaching. Captures dual audio (system speakers + microphone), transcribes in real-time, and feeds rolling transcript to Claude or GPT for tactical insights every ~35 seconds.

## When to Use This Skill

- **Live meeting coaching**: Real-time tactical advice during calls
- **Meeting transcription**: Dual-stream (you + them) labelled transcript
- **Meeting recap**: Session logs with markdown export
- **Negotiation support**: Reads the room and suggests responses
- **Multi-user audio**: Works with our VNC desktop + virtual audio cables

## When Not to Use

- For pre-recorded audio/video processing — use `ffmpeg-processing`
- For generating podcasts from text — use `notebooklm` (audio overviews)
- For video production — use `open-montage`
- For browser-based meeting automation — use `playwright`

## Architecture

```
┌───────────────┐     ┌──────────────┐     ┌──────────────┐     ┌────────────┐
│ Audio Capture  │────>│  Transcriber │────>│   EchoLoop   │────>│     UI     │
│ (2 threads)    │     │ (thread pool)│     │   Engine     │     │  (Tkinter) │
│                │     │              │     │  (asyncio)   │     │            │
│ system ──┐     │     │faster-whisper│     │              │     │ Always-on- │
│ mic ─────┤     │     │  or Deepgram │     │ Claude / GPT │     │ top overlay│
│          v     │     │              │     │ every ~35s   │     │            │
│  chunk queue   │     │  seg queue   │     │ + on silence │     │ insight log│
└───────────────┘     └──────────────┘     └──────────────┘     └────────────┘
```

## Quick Start

```bash
# Install dependencies
pip install -r ~/.claude/skills/echoloop/requirements.txt

# Set API key (uses existing container keys)
export ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"  # Already set for devuser

# Configure audio devices (container VNC)
export ECHOLOOP_SYSTEM_DEVICE="pulse"     # PulseAudio virtual cable
export ECHOLOOP_MIC_DEVICE=""             # Default mic

# Launch on VNC Display :1
DISPLAY=:1 python3 -m echoloop
```

## Container Audio Routing

Our container has PulseAudio on VNC Display :1. For meeting capture:

1. **Virtual audio cable**: Route system audio through PulseAudio monitor
2. **Set device**: `ECHOLOOP_SYSTEM_DEVICE=<pulse monitor name>`
3. **Launch**: `DISPLAY=:1 python3 ~/.claude/skills/echoloop/main.py`

For multi-user scenarios, each user can run their own EchoLoop instance with different audio routing.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | (required) | Claude API key (already set in container) |
| `OPENAI_API_KEY` | | GPT API key (for OpenAI provider) |
| `DEEPGRAM_API_KEY` | | Deepgram key (for cloud transcription) |
| `ECHOLOOP_LLM_PROVIDER` | `anthropic` | LLM provider: `anthropic` or `openai` |
| `ECHOLOOP_TRANSCRIBER` | `local` | Transcription: `local` (faster-whisper) or `deepgram` |
| `ECHOLOOP_WHISPER_MODEL` | `base.en` | Whisper model size |
| `ECHOLOOP_WHISPER_DEVICE` | `cpu` | `cpu` or `cuda` for GPU transcription |
| `ECHOLOOP_PUSH_INTERVAL` | `35` | Seconds between LLM coaching calls |
| `ECHOLOOP_SILENCE_TRIGGER` | `4.0` | Seconds of silence before early push |
| `ECHOLOOP_SYSTEM_DEVICE` | | System audio device name substring |
| `ECHOLOOP_MIC_DEVICE` | | Microphone device (None = default) |
| `ECHOLOOP_MEETING_CONTEXT` | | One-line meeting briefing for sharper advice |
| `ECHOLOOP_LOG_DIR` | | Directory for session logs (empty = disabled) |
| `ECHOLOOP_OPACITY` | `0.88` | Overlay window opacity |

## Features

- **Dual audio capture**: System audio + microphone, labelled `[THEM]` and `[ME]`
- **Transcription**: Local faster-whisper (CPU/CUDA) or Deepgram cloud
- **LLM coaching**: Claude or GPT every ~35s with nudge button for instant advice
- **Silence detection**: Skips dead air, saves CPU and API calls
- **Session logging**: Transcript + insights saved to disk, markdown export
- **Auto-reconnect**: Audio streams recover if device disconnects
- **Pause/Resume**: Click or `Ctrl+Shift+E` global hotkey
- **Live stats**: Insight count, session duration, talk-time percentage

## Integration with Other Skills

| Skill | Relationship |
|-------|-------------|
| `notebooklm` | Feed meeting transcripts as sources, generate audio overviews |
| `report-builder` | Generate meeting reports from session logs |
| `perplexity-research` | Research topics mentioned in meetings in real-time |
| `codex-companion` | Delegate technical questions from meetings to Codex |

## Attribution

EchoLoop by Pete Woodbridge. MIT License.
