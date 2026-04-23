# EchoLoop – Setup Guide

## 1. Audio Routing (Critical)

EchoLoop needs to capture **two separate audio streams**:

| Stream | What it captures | How |
|--------|-----------------|-----|
| **System audio** | What others say in the meeting | Virtual audio cable |
| **Microphone** | What you say | Your normal mic |

### Windows – VB-Cable (free)

1. Download & install **VB-Cable** from https://vb-audio.com/Cable/
2. After install you'll have two new devices:
   - **CABLE Input** (virtual microphone – apps "speak" into this)
   - **CABLE Output** (virtual speaker – EchoLoop reads from this)
3. Open **Sound Settings → Output** and set your output device to **CABLE Input**.
   This routes all system audio through the virtual cable.
4. To still hear the meeting yourself, use **VB-Cable's** built-in monitoring,
   or install **VoiceMeeter Banana** (free) which can duplicate the audio to
   both the virtual cable AND your real speakers/headphones.
5. When EchoLoop starts it will list all input devices. Select the index for
   **CABLE Output** as your system audio device.

**Shortcut**: set the env var so you skip the prompt every time:
```
set ECHOLOOP_SYSTEM_DEVICE=CABLE Output
```

### macOS – BlackHole (free)

1. Install BlackHole (2ch): `brew install blackhole-2ch`
2. Open **Audio MIDI Setup** → click **+** → **Create Multi-Output Device**
3. Check both **BlackHole 2ch** and your real speakers/headphones.
4. Set this Multi-Output as your system output in System Settings → Sound.
5. When EchoLoop starts, select **BlackHole 2ch** as the system audio device.

### Linux – PulseAudio monitor

PulseAudio exposes a "monitor" source for every output sink. Run:
```
pactl list sources short
```
Look for something like `alsa_output.pci-0000_00_1f.3.analog-stereo.monitor`.
Set it via env var:
```
export ECHOLOOP_SYSTEM_DEVICE="monitor"
```

---

## 2. Python Environment

```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
```

**GPU acceleration** (optional, for faster-whisper):
```bash
pip install ctranslate2 --extra-index-url https://download.pytorch.org/whl/cu121
```
Then set:
```
set ECHOLOOP_WHISPER_DEVICE=cuda
set ECHOLOOP_WHISPER_COMPUTE=float16
set ECHOLOOP_WHISPER_MODEL=medium.en
```

## 3. API Keys

Set one of these depending on your LLM provider:

```bash
# Anthropic (default)
set ANTHROPIC_API_KEY=sk-ant-...

# OpenAI (alternative)
set OPENAI_API_KEY=sk-...
set ECHOLOOP_LLM_PROVIDER=openai
```

For Deepgram transcription (instead of local whisper):
```bash
set ECHOLOOP_TRANSCRIBER=deepgram
set DEEPGRAM_API_KEY=...
```

## 4. Run

```bash
python main.py
```

The app will:
1. List available audio devices and let you pick the virtual cable.
2. Open a small, always-on-top overlay window.
3. Start listening, transcribing, and coaching.

Close the overlay window to stop.

## 5. Environment Variable Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `ECHOLOOP_SYSTEM_DEVICE` | *(interactive)* | Name substring of loopback device |
| `ECHOLOOP_MIC_DEVICE` | *(default mic)* | Name substring of microphone |
| `ECHOLOOP_TRANSCRIBER` | `local` | `local` or `deepgram` |
| `ECHOLOOP_WHISPER_MODEL` | `base.en` | faster-whisper model size |
| `ECHOLOOP_WHISPER_DEVICE` | `cpu` | `cpu` or `cuda` |
| `ECHOLOOP_LLM_PROVIDER` | `anthropic` | `anthropic` or `openai` |
| `ECHOLOOP_PUSH_INTERVAL` | `35` | Seconds between LLM calls |
| `ECHOLOOP_SILENCE_TRIGGER` | `4.0` | Silence seconds before early push |
| `ECHOLOOP_LLM_TEMPERATURE` | `0.4` | LLM temperature (lower = more deterministic) |
| `ECHOLOOP_SYSTEM_PROMPT` | *(built-in)* | Override the default coaching system prompt |
| `ECHOLOOP_OPACITY` | `0.88` | Overlay window opacity (0.0–1.0) |
| `ECHOLOOP_ENERGY_THRESHOLD` | `0.005` | RMS below this is treated as silence |
| `ECHOLOOP_MEETING_CONTEXT` | *(empty)* | One-line meeting briefing for the LLM |
| `ECHOLOOP_LOG_DIR` | *(disabled)* | Directory for session transcript logs |
