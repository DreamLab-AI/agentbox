"""
EchoLoop Configuration
─────────────────────
Central configuration for all modules. Override via environment variables.
"""

import os
from dataclasses import dataclass, field


@dataclass
class AudioConfig:
    sample_rate: int = 16000
    channels: int = 1
    dtype: str = "float32"
    # Chunk duration in seconds sent to the transcriber
    chunk_duration: float = 3.0
    # RMS energy below this threshold is treated as silence and skipped
    energy_threshold: float = float(os.getenv("ECHOLOOP_ENERGY_THRESHOLD", "0.005"))
    # Name substring to match your virtual cable / loopback device.
    # Set ECHOLOOP_SYSTEM_DEVICE env var, or leave None to be prompted at startup.
    system_device: str | None = os.getenv("ECHOLOOP_SYSTEM_DEVICE")
    # Microphone device (None = default mic)
    mic_device: str | None = os.getenv("ECHOLOOP_MIC_DEVICE")


@dataclass
class TranscriberConfig:
    # "local" (faster-whisper) or "deepgram"
    backend: str = os.getenv("ECHOLOOP_TRANSCRIBER", "local")
    # faster-whisper settings
    whisper_model: str = os.getenv("ECHOLOOP_WHISPER_MODEL", "base.en")
    whisper_device: str = os.getenv("ECHOLOOP_WHISPER_DEVICE", "cpu")  # "cpu" or "cuda"
    whisper_compute_type: str = os.getenv("ECHOLOOP_WHISPER_COMPUTE", "int8")
    # Language code (e.g. "en", "fr", "de", "ja") — None = auto-detect
    language: str | None = os.getenv("ECHOLOOP_LANGUAGE", "en") or None
    # Deepgram settings
    deepgram_api_key: str = os.getenv("DEEPGRAM_API_KEY", "")
    deepgram_model: str = "nova-2"


@dataclass
class LLMConfig:
    # "anthropic" or "openai"
    provider: str = os.getenv("ECHOLOOP_LLM_PROVIDER", "anthropic")
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    anthropic_model: str = os.getenv("ECHOLOOP_ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
    openai_model: str = os.getenv("ECHOLOOP_OPENAI_MODEL", "gpt-4o")
    # How often (seconds) to push transcript to the LLM
    push_interval: float = float(os.getenv("ECHOLOOP_PUSH_INTERVAL", "35"))
    # Silence duration (seconds) that triggers an early push
    silence_trigger: float = float(os.getenv("ECHOLOOP_SILENCE_TRIGGER", "4.0"))
    # LLM temperature (lower = more deterministic)
    temperature: float = float(os.getenv("ECHOLOOP_LLM_TEMPERATURE", "0.4"))
    # Max transcript tokens to keep in the rolling window
    max_transcript_chars: int = 6000
    # Optional one-line meeting briefing for targeted advice
    meeting_context: str = os.getenv("ECHOLOOP_MEETING_CONTEXT", "")
    # Override system prompt via env var (empty = use default)
    system_prompt_override: str = os.getenv("ECHOLOOP_SYSTEM_PROMPT", "")
    system_prompt: str = (
        "You are a ruthless, highly perceptive executive coach embedded in a live meeting. "
        "You receive a rolling transcript labelled [ME] (the user) and [THEM] (others). "
        "Your job: give the user real-time tactical advice so they win the conversation.\n\n"
        "RULES:\n"
        "- Output STRICTLY 1-2 short, punchy bullet points. Nothing else.\n"
        "- Each bullet is either an actionable directive or a sharp read on the room.\n"
        "- If [ME] is talking too much, say so. If [THEM] is dodging, call it out.\n"
        "- Match your advice to the conversation stage: opening, negotiation, objection-handling, or closing.\n"
        "- No filler, no greetings, no meta-commentary, no disclaimers. Pure signal.\n\n"
        "EXAMPLES OF GOOD OUTPUT:\n"
        "- They just deflected on pricing twice — pin them down: \"What number works for you?\"\n"
        "- You're over-explaining. Stop talking and let the silence do the work.\n"
        "- They mentioned Q3 deadline unprompted — that's leverage. Circle back to it.\n"
        "- You've been on mute for 4 minutes. Re-engage now or you'll lose the room.\n"
        "- Strong close opportunity. Summarise the three agreed points and ask for next steps."
    )


@dataclass
class UIConfig:
    width: int = 420
    height: int = 340
    opacity: float = float(os.getenv("ECHOLOOP_OPACITY", "0.88"))
    bg_color: str = "#1a1a2e"
    text_color: str = "#e0e0e0"
    accent_color: str = "#00d4aa"
    font_family: str = "Consolas"
    font_size: int = 11
    max_lines: int = 200


@dataclass
class AppConfig:
    audio: AudioConfig = field(default_factory=AudioConfig)
    transcriber: TranscriberConfig = field(default_factory=TranscriberConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    ui: UIConfig = field(default_factory=UIConfig)
    # Directory for session transcript logs (empty string = disabled)
    log_dir: str = os.getenv("ECHOLOOP_LOG_DIR", "")

    def validate(self) -> list[str]:
        """Return a list of configuration warnings/errors."""
        issues: list[str] = []

        # LLM key check
        if self.llm.provider == "anthropic" and not self.llm.anthropic_api_key:
            issues.append("ANTHROPIC_API_KEY is not set (required for Anthropic provider)")
        if self.llm.provider == "openai" and not self.llm.openai_api_key:
            issues.append("OPENAI_API_KEY is not set (required for OpenAI provider)")

        # Deepgram key check
        if self.transcriber.backend == "deepgram" and not self.transcriber.deepgram_api_key:
            issues.append("DEEPGRAM_API_KEY is not set (required for Deepgram backend)")

        # Range checks
        if not 0.0 <= self.ui.opacity <= 1.0:
            issues.append(f"ECHOLOOP_OPACITY={self.ui.opacity} is out of range [0.0, 1.0]")
        if self.llm.push_interval < 5:
            issues.append(f"ECHOLOOP_PUSH_INTERVAL={self.llm.push_interval} is too low (min 5s)")
        if self.audio.energy_threshold < 0:
            issues.append(f"ECHOLOOP_ENERGY_THRESHOLD={self.audio.energy_threshold} must be >= 0")
        if not 0.0 <= self.llm.temperature <= 2.0:
            issues.append(f"ECHOLOOP_LLM_TEMPERATURE={self.llm.temperature} is out of range [0.0, 2.0]")

        # Provider/backend validity
        if self.llm.provider not in ("anthropic", "openai"):
            issues.append(f"ECHOLOOP_LLM_PROVIDER='{self.llm.provider}' must be 'anthropic' or 'openai'")
        if self.transcriber.backend not in ("local", "deepgram"):
            issues.append(f"ECHOLOOP_TRANSCRIBER='{self.transcriber.backend}' must be 'local' or 'deepgram'")

        return issues
