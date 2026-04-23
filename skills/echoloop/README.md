<p align="center">
  <img src="assets/logo.svg" alt="EchoLoop Logo" width="280" />
</p>

<p align="center">
  <strong>Real-time AI meeting copilot that gives you superpowers.</strong><br/>
  <sub>Listen. Transcribe. Coach. Dominate. — All in real time.</sub>
</p>

<p align="center">
  <a href="#-quickstart"><img src="https://img.shields.io/badge/-Get%20Started-00d4aa?style=for-the-badge&logo=rocket&logoColor=white" alt="Get Started" /></a>
  <a href="https://github.com/petejwoodbridge/EchoLoop/actions/workflows/ci.yml"><img src="https://github.com/petejwoodbridge/EchoLoop/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python 3.11+" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square" alt="Platform" />
</p>

---

EchoLoop sits quietly on top of your Zoom, Teams, or Google Meet window. It captures what everyone's saying, transcribes it in real time, and feeds the live transcript to an LLM that acts as your personal executive coach — delivering sharp, tactical advice every few seconds.

Maybe you're prepping for a high-stakes negotiation. Maybe you're in back-to-back meetings and your brain checked out two calls ago. Or maybe you just don't feel like talking today and need a quiet co-pilot feeding you the right words at the right time. No judgement. We've all been there.

**Work smarter, not harder.**

> *"They sound hesitant on the budget — press now."*
> *"Ask for clarification on the timeline."*
> *"Pivot to the closing pitch."*

That's it. No fluff. Just signal.

## ✨ Features

| | Feature | Details |
|---|---------|---------|
| 🎙️ | **Dual audio capture** | System audio (what *they* say) + microphone (what *you* say), labelled separately |
| ⚡ | **Real-time transcription** | Local via [faster-whisper](https://github.com/SYSTRAN/faster-whisper) or cloud via [Deepgram](https://deepgram.com) — swappable with one env var |
| 🧠 | **LLM coaching loop** | Fires transcript to Claude or GPT every ~35s (or on conversation pauses) for punchy tactical advice |
| ⚡ | **Nudge button** | Force an instant LLM coaching call when you need advice *right now* |
| 🪟 | **Always-on-top overlay** | Semi-transparent, draggable, resizable Tkinter window — zero distraction |
| ⏸️ | **Pause / Resume** | One-click button or `Ctrl+Shift+E` global hotkey — pause during small talk |
| 🔇 | **Silence detection** | Skips dead air automatically — saves CPU and API calls |
| 📊 | **Live stats** | Insight count, session duration, and your talk-time percentage in the footer |
| 📝 | **Session logging** | Transcript + insight log saved to disk, with Markdown export on session end |
| 🔄 | **Parallel pipeline** | Audio, transcription, LLM, and UI never block each other |
| 🔁 | **Auto-reconnect** | Audio streams recover automatically if a device disconnects mid-meeting |
| 🎯 | **Meeting context** | Tell the LLM what the meeting is about for sharper, more relevant advice |

## 🏗️ Architecture

```
┌───────────────┐     ┌──────────────┐     ┌──────────────┐     ┌────────────┐
│ Audio Capture  │────▶│  Transcriber │────▶│  EchoLoop    │────▶│     UI     │
│ (2 threads)    │     │ (thread pool)│     │  Engine      │     │  (Tkinter) │
│                │     │              │     │  (asyncio)   │     │            │
│ system ──┐     │     │ faster-whisper│     │              │     │ Always-on- │
│ mic ─────┤     │     │   or Deepgram│     │ Claude / GPT │     │ top overlay│
│          ▼     │     │              │     │ every ~35s   │     │            │
│  chunk queue   │     │  seg queue   │     │ + on silence │     │ insight log│
└───────────────┘     └──────────────┘     └──────────────┘     └────────────┘
       Thread               Thread              Async                Main
```

**Concurrency model:**

- **Audio capture** — two dedicated threads (one per stream, via `sounddevice`), auto-reconnect on device loss
- **Transcription** — `ThreadPoolExecutor(2)` so both streams transcribe in parallel, stale chunks auto-dropped
- **LLM engine** — `asyncio` event loop with retry-on-failure, nudge support, speaker ratio tracking
- **UI** — main thread (Tkinter requirement), polls a thread-safe queue every 250ms
- **Bridging** — `queue.Queue` (thread↔async) and `asyncio.Queue` (async↔async)

## 🚀 Quickstart

### 1. Audio routing setup

EchoLoop needs to hear what's playing through your speakers. This requires a **virtual audio cable** that routes system audio into a capturable input device.

<details>
<summary><strong>Windows — VB-Cable (free)</strong></summary>

1. Download & install [VB-Cable](https://vb-audio.com/Cable/)
2. **Sound Settings → Output** → set to **CABLE Input**
3. To still hear audio yourself, install [VoiceMeeter Banana](https://vb-audio.com/Voicemeeter/banana.htm) (free) — it can duplicate audio to both the virtual cable and your real speakers
4. When EchoLoop starts, select **CABLE Output** as your system audio device

</details>

<details>
<summary><strong>macOS — BlackHole (free)</strong></summary>

1. `brew install blackhole-2ch`
2. Open **Audio MIDI Setup** → **+** → **Create Multi-Output Device**
3. Check both **BlackHole 2ch** and your real speakers
4. Set this Multi-Output as your system output
5. Select **BlackHole 2ch** as the system device in EchoLoop

</details>

<details>
<summary><strong>Linux — PulseAudio monitor</strong></summary>

```bash
pactl list sources short
# Look for: alsa_output.*.monitor
export ECHOLOOP_SYSTEM_DEVICE="monitor"
```

</details>

### 2. Install

```bash
git clone https://github.com/petejwoodbridge/EchoLoop.git
cd EchoLoop

python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS / Linux:
source .venv/bin/activate

pip install -r requirements.txt
```

**Optional extras:**

```bash
# GPU acceleration for faster-whisper
pip install ctranslate2 --extra-index-url https://download.pytorch.org/whl/cu121

# Global hotkey support (Ctrl+Shift+E to pause/resume)
pip install pynput
```

### 3. Configure

Copy the example env file and fill in your API key:

```bash
cp .env.example .env
# Edit .env with your key, then source it (or use your IDE's env support)
```

Or set directly:

```bash
# Required — pick one LLM provider:
export ANTHROPIC_API_KEY="sk-ant-..."
# or
export OPENAI_API_KEY="sk-..."
export ECHOLOOP_LLM_PROVIDER="openai"

# Optional — give the LLM meeting context for sharper advice:
export ECHOLOOP_MEETING_CONTEXT="Sales call with VP Eng at Acme Corp, negotiating renewal"

# Optional — save transcripts for post-meeting review:
export ECHOLOOP_LOG_DIR="~/.echoloop/logs"
```

### 4. Run

```bash
python main.py
# or
python -m echoloop
```

EchoLoop will list your audio devices, open the overlay, and start coaching.

**CLI flags:**

```bash
# List audio devices without starting
python main.py --list-devices

# Set meeting context from the command line
python main.py --context "Board review with investors"

# Override provider or transcription backend
python main.py --provider openai --backend deepgram
```

> **Tip:** EchoLoop auto-loads a `.env` file from the working directory (no `python-dotenv` needed). Copy `.env.example` to `.env`, fill in your key, and you're set.

## 🖥️ UI Controls

| Control | Action |
|---------|--------|
| **⏸ Pause** button | Pause coaching (LLM calls stop, audio still captured) |
| **⚡ Nudge** button | Force an immediate LLM coaching call |
| **✕ Clear** button | Clear the insight log |
| `Ctrl+Shift+E` | Global hotkey to toggle pause (requires `pynput`) |
| **Drag anywhere** | Move the overlay window |
| **T** button | Toggle between insights view and raw transcript view |
| **Footer bar** | Shows insight count, session time, and your talk-time % |

## ⚙️ Configuration

All settings are controlled via environment variables. See [`.env.example`](.env.example) for a complete template.

| Variable | Default | Description |
|----------|---------|-------------|
| `ECHOLOOP_SYSTEM_DEVICE` | *(interactive)* | Name substring of your virtual cable input |
| `ECHOLOOP_MIC_DEVICE` | *(default mic)* | Name substring of your microphone |
| `ECHOLOOP_TRANSCRIBER` | `local` | `local` (faster-whisper) or `deepgram` |
| `ECHOLOOP_WHISPER_MODEL` | `base.en` | Whisper model size (`tiny.en`, `base.en`, `small.en`, `medium.en`, `large-v3`) |
| `ECHOLOOP_WHISPER_DEVICE` | `cpu` | `cpu` or `cuda` |
| `ECHOLOOP_WHISPER_COMPUTE` | `int8` | `int8`, `float16`, or `float32` |
| `ECHOLOOP_LANGUAGE` | `en` | Language code (`en`, `fr`, `de`, `ja`, etc.) or empty for auto-detect |
| `ECHOLOOP_LLM_PROVIDER` | `anthropic` | `anthropic` or `openai` |
| `ECHOLOOP_ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Anthropic model ID |
| `ECHOLOOP_OPENAI_MODEL` | `gpt-4o` | OpenAI model ID |
| `ECHOLOOP_LLM_TEMPERATURE` | `0.4` | LLM temperature (lower = more deterministic) |
| `ECHOLOOP_PUSH_INTERVAL` | `35` | Seconds between LLM coaching calls |
| `ECHOLOOP_SILENCE_TRIGGER` | `4.0` | Seconds of silence before early LLM trigger |
| `ECHOLOOP_ENERGY_THRESHOLD` | `0.005` | RMS below this = silence (skipped) |
| `ECHOLOOP_MEETING_CONTEXT` | *(empty)* | One-line meeting briefing prepended to transcript |
| `ECHOLOOP_SYSTEM_PROMPT` | *(built-in)* | Override the default coaching system prompt |
| `ECHOLOOP_LOG_DIR` | *(disabled)* | Directory for session transcript + insight logs |
| `ECHOLOOP_OPACITY` | `0.88` | Overlay window opacity (0.0–1.0) |
| `DEEPGRAM_API_KEY` | — | Required only if using Deepgram backend |

## 🧪 Testing

```bash
pip install pytest
python -m pytest tests/ -v
```

## 📂 Project Structure

```
EchoLoop/
├── main.py              # Orchestrator — wires everything, session logger
├── config.py            # All settings (env-var driven)
├── audio_capture.py     # Dual-stream audio capture with auto-reconnect
├── transcriber.py       # faster-whisper / Deepgram with parallel processing
├── engine.py            # LLM coaching loop, speaker stats, nudge support
├── ui.py                # Always-on-top Tkinter overlay with controls
├── __main__.py          # python -m support
├── pyproject.toml       # Packaging and project metadata
├── requirements.txt     # Dependencies
├── .env.example         # Environment variable template
├── SETUP.md             # Detailed audio routing guide
├── CONTRIBUTING.md      # Contribution guidelines
├── LICENSE
├── tests/               # Unit tests (25 passing)
│   ├── test_config.py
│   ├── test_engine.py
│   ├── test_audio_capture.py
│   ├── test_transcriber.py
│   └── test_session_logger.py
└── assets/
    └── logo.svg
```

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

[MIT](LICENSE) — do whatever you want with it.

---

<p align="center">
  <sub>Built for people who refuse to leave a meeting without winning.</sub>
</p>
