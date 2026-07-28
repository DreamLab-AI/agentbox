# ClipCannon — Full Reference (tools, models, embeddings, billing)

Complete catalog moved out of `SKILL.md` for progressive disclosure. Read this when
you need the exact tool name, a model's VRAM budget, an embedding space dimension, or
the credit cost of an operation.

## Architecture

```
                    +-----------------+
                    |  AI Assistant   |  (Claude, etc.)
                    |  (MCP Client)   |
                    +--------+--------+
                             | MCP Protocol (stdio)
                    +--------v--------+
                    |  ClipCannon     |
                    |  MCP Server     |  51 tools / 12 categories
                    +--------+--------+
                             |
          +------------------+------------------+
          |                  |                  |
  +-------v------+  +-------v------+  +-------v-------+
  | Analysis     |  | Editing      |  | Voice/Avatar  |
  | Pipeline     |  | + Rendering  |  | Engine        |
  | (22 stages)  |  | (FFmpeg +    |  | (Qwen3-TTS +  |
  |              |  |  NVENC)      |  |  LatentSync)  |
  | 5 embedding  |  | 7 profiles   |  | ECAPA-TDNN    |
  | spaces       |  | ASS captions |  | verification  |
  | sqlite-vec   |  | Smart crop   |  | Resemble      |
  |              |  | Canvas comp  |  | Enhance       |
  +--------------+  +--------------+  +---------------+
                             |
                    +--------v--------+
                    | SQLite + vec    |  Per-project DB
                    | (analysis.db)   |  4 vector tables
                    +-----------------+  31 core tables

  Separate processes:
  +------------------+  +------------------+  +------------------+
  | License Server   |  | Dashboard        |  | Voice Agent      |
  | (port 3100)      |  | (port 3200)      |  | ("Jarvis")       |
  | HMAC billing     |  | Web UI           |  | Wake word + ASR  |
  | Stripe webhooks  |  | Projects/Credits |  | + LLM + TTS      |
  +------------------+  +------------------+  +------------------+
```

## MCP Tools (51 across 12 categories)

### Project (5)
| Tool | Description |
|------|-------------|
| `clipcannon_project_create` | Create a new project |
| `clipcannon_project_open` | Open an existing project |
| `clipcannon_project_list` | List all projects |
| `clipcannon_project_status` | Get project analysis status |
| `clipcannon_project_delete` | Delete a project |

### Understanding (4)
| Tool | Description |
|------|-------------|
| `clipcannon_ingest` | Ingest video, run 22-stage analysis pipeline |
| `clipcannon_get_transcript` | Get full transcript with timestamps |
| `clipcannon_get_frame` | Extract specific frame as image |
| `clipcannon_search_content` | Semantic search across all 5 embedding spaces |

### Discovery (4)
| Tool | Description |
|------|-------------|
| `clipcannon_find_best_moments` | AI-ranked highlight moments |
| `clipcannon_find_cut_points` | Optimal cut points for editing |
| `clipcannon_get_narrative_flow` | Narrative structure and flow analysis |
| `clipcannon_find_safe_cuts` | Find edit-safe cut points |

### Editing (11)
| Tool | Description |
|------|-------------|
| `clipcannon_create_edit` | Create declarative EDL edit |
| `clipcannon_modify_edit` | Modify existing edit |
| `clipcannon_auto_trim` | Auto-trim dead space |
| `clipcannon_color_adjust` | Colour correction |
| `clipcannon_add_motion` | Motion effects (ken burns, zoom, pan) |
| `clipcannon_add_overlay` | Add overlay/watermark |
| `clipcannon_apply_feedback` | Apply review feedback to edit |
| `clipcannon_branch_edit` | Branch edit for A/B versions |
| `clipcannon_edit_history` | View edit revision history |
| `clipcannon_revert_edit` | Revert to previous edit version |
| (adaptive captions, face-tracking crop, split-screen, PIP, canvas compositing) | |

### Rendering (8)
| Tool | Description |
|------|-------------|
| `clipcannon_render` | Render final output (7 platform profiles) |
| `clipcannon_preview_clip` | Preview at 540p (free, no credits) |
| `clipcannon_preview_layout` | Preview layout/composition |
| `clipcannon_inspect_render` | Inspect render output quality |
| `clipcannon_get_scene_map` | Get scene map with timestamps |
| `clipcannon_get_editing_context` | Get editing context for a segment |
| `clipcannon_analyze_frame` | Analyse specific frame |
| (NVENC GPU acceleration, 7 profiles: TikTok, Reels, Shorts, YouTube, YouTube 4K, Facebook, LinkedIn) | |

### Audio (4)
| Tool | Description |
|------|-------------|
| `clipcannon_generate_music` | ACE-Step diffusion music generation |
| `clipcannon_compose_midi` | 6 MIDI presets with FluidSynth |
| `clipcannon_generate_sfx` | 9 DSP sound effects |
| `clipcannon_audio_cleanup` | Noise reduction, normalisation, speech-aware ducking |

### Voice (4)
| Tool | Description |
|------|-------------|
| `clipcannon_prepare_voice_data` | Prepare voice data for cloning |
| `clipcannon_voice_profiles` | List/manage voice profiles |
| `clipcannon_speak` | Generate speech with cloned voice (Qwen3-TTS 1.7B) |
| `clipcannon_speak_optimized` | Best-of-N optimised speech with verification |

### Avatar (1)
| Tool | Description |
|------|-------------|
| `clipcannon_lip_sync` | LatentSync 1.6 (ByteDance) diffusion lip-sync avatar |

### Video Gen (1)
| Tool | Description |
|------|-------------|
| `clipcannon_generate_video` | End-to-end text to voice to lip-sync video |

### Billing (4)
| Tool | Description |
|------|-------------|
| `clipcannon_credits_balance` | Check credit balance |
| `clipcannon_credits_history` | Transaction history |
| `clipcannon_credits_estimate` | Estimate cost for operation |
| `clipcannon_spending_limit` | Set/view spending limits |

### Disk (2)
| Tool | Description |
|------|-------------|
| `clipcannon_disk_status` | Disk usage per project |
| `clipcannon_disk_cleanup` | Clean up old renders/cache |

### Config (3)
| Tool | Description |
|------|-------------|
| `clipcannon_config_get` | Get config value |
| `clipcannon_config_set` | Set config value |
| `clipcannon_config_list` | List all config settings |

## Voice Agent ("Jarvis")

Real-time conversational AI with wake-word activation. All local, zero cloud.

```bash
# Recommended: Pipecat + Ollama (all local)
python -m voiceagent talk --voice boris

# WebSocket server for remote clients
python -m voiceagent serve --port 8765
```

**Lifecycle**: DORMANT (CPU only, wake word listening) -> LOADING (~10-20s) -> ACTIVE (full conversation, ~30 GB VRAM) -> DORMANT

**Components**: Whisper Large v3 ASR, Qwen3-14B FP8 local LLM (~120 tok/s), faster-qwen3-tts 0.6B (~500ms TTFB), Silero VAD, "Hey Jarvis" wake word.

Pauses other GPU workers on activation and resumes them on deactivation to share VRAM on a single GPU.

## 14 ML Models

| Model | Provider | Purpose | VRAM |
|-------|----------|---------|------|
| SigLIP-SO400M | Google | Visual embeddings + shot classification | ~2 GB |
| Nomic Embed v1.5 | Nomic AI | Semantic text embeddings | ~1 GB |
| Wav2Vec2-large | Meta | Emotion embeddings | ~2 GB |
| WavLM-base-plus-sv | Microsoft | Speaker diarisation | ~1 GB |
| WhisperX Large v3 | OpenAI | Speech-to-text | ~3 GB |
| HTDemucs v4 | Meta | Audio source separation | ~2 GB |
| Qwen3-8B | Qwen | Narrative analysis | ~8 GB |
| Qwen3-TTS 1.7B | Qwen | Voice cloning (video) | ~4 GB |
| faster-qwen3-tts 0.6B | Qwen | Voice Agent (real-time) | ~4 GB |
| LatentSync 1.6 | ByteDance | Lip-sync avatars | ~4 GB |
| ACE-Step v1.5 | ACE | AI music generation | ~4 GB |
| SenseVoice Small | FunASR | Reaction detection | ~1 GB |
| Silero VAD | Silero | Voice activity detection | CPU |
| PaddleOCR v5 | PaddlePaddle | On-screen text detection | ~1 GB |

Models loaded on-demand with LRU eviction. GPUs with >16 GB run models concurrently; smaller GPUs load sequentially. Auto-detects GPU precision: Blackwell (nvfp4), Ada Lovelace (int8), Ampere (int8), Turing (fp16), CPU (fp32).

## 5 Embedding Spaces

| Space | Model | Dimensions | Use |
|-------|-------|------------|-----|
| Visual | SigLIP-SO400M | 1152 | Scene similarity, visual search |
| Semantic | Nomic Embed v1.5 | 768 | Transcript/meaning search |
| Emotion | Wav2Vec2-large | 1024 | Emotional moment detection |
| Speaker | WavLM-base-plus-sv | 512 | Speaker diarisation |
| Voice ID | ECAPA-TDNN | 2048 | Voice cloning verification |

All stored in sqlite-vec for local KNN search. Per-project SQLite database with 31 core tables + 4 vector tables.

## Credit System

| Operation | Credits |
|-----------|---------|
| Analyze (ingest) | 10 |
| Render | 2 |
| Preview | 0 |
| Metadata | 1 |

Dev mode starts with 100 credits. Production billing via Stripe webhooks. HMAC-signed balance with spending limits and transaction history.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLIPCANNON_DATA_DIR` | `~/.clipcannon` | Data/model storage directory |
| `CLIPCANNON_GPU_DEVICE` | `cuda:0` | GPU device for inference |
| `CLIPCANNON_NVENC` | `true` | Use NVENC GPU encoding for renders |

## Integration with Other Skills

| Skill | Relationship |
|-------|-------------|
| `open-montage` | OpenMontage produces from scratch; ClipCannon edits existing footage |
| `ffmpeg-processing` | ClipCannon uses FFmpeg internally; the skill is for standalone conversions |
| `echoloop` | EchoLoop captures meeting audio; ClipCannon edits the resulting video |
| `notebooklm` | Feed video transcripts as NotebookLM sources for study materials |
| `art` | Generate thumbnails/overlays via Nano Banana 2 |
| `comfyui` | Generate AI video segments to splice into edits |

## Provenance

SHA-256 hash chain links every pipeline operation. Every output is traceable to its source. Tamper-evident provenance chain stored in per-project SQLite database.
