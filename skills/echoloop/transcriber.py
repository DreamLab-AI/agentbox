"""
EchoLoop · Transcriber
──────────────────────
Consumes AudioChunk objects from the capture queue and produces timestamped
text segments.  Two back-ends are supported, selected via config:

  • "local"    → faster-whisper  (offline, GPU or CPU)
  • "deepgram" → Deepgram Nova-2 streaming API (low-latency cloud)

The module exposes a single `Transcriber` class with a `.run()` coroutine
that bridges the threaded audio world into the async domain.
"""

from __future__ import annotations

import asyncio
import io
import logging
import queue
import time
import wave
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from audio_capture import AudioChunk, Speaker
from config import TranscriberConfig

# Max age (seconds) of an audio chunk before it's discarded as stale
_STALE_THRESHOLD = 10.0

log = logging.getLogger(__name__)


# ── Transcript segment ───────────────────────────────────────────────

class Segment:
    __slots__ = ("text", "speaker", "timestamp")

    def __init__(self, text: str, speaker: Speaker, timestamp: float) -> None:
        self.text = text
        self.speaker = speaker
        self.timestamp = timestamp

    def __repr__(self) -> str:
        tag = "ME" if self.speaker is Speaker.ME else "THEM"
        return f"[{tag}] {self.text}"


# ── Abstract backend ─────────────────────────────────────────────────

class _Backend(ABC):
    @abstractmethod
    def transcribe(self, audio: np.ndarray) -> str: ...


# ── faster-whisper backend ───────────────────────────────────────────

class _WhisperBackend(_Backend):
    def __init__(self, cfg: TranscriberConfig) -> None:
        from faster_whisper import WhisperModel  # lazy import – heavy

        log.info(
            "Loading faster-whisper model=%s device=%s compute=%s lang=%s",
            cfg.whisper_model,
            cfg.whisper_device,
            cfg.whisper_compute_type,
            cfg.language or "auto",
        )
        self._model = WhisperModel(
            cfg.whisper_model,
            device=cfg.whisper_device,
            compute_type=cfg.whisper_compute_type,
        )
        self._language = cfg.language

    def transcribe(self, audio: np.ndarray) -> str:
        segments, _ = self._model.transcribe(
            audio,
            beam_size=1,
            language=self._language,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300},
        )
        return " ".join(s.text.strip() for s in segments).strip()


# ── Deepgram REST backend (batch-per-chunk) ──────────────────────────

class _DeepgramBackend(_Backend):
    def __init__(self, cfg: TranscriberConfig) -> None:
        import httpx

        if not cfg.deepgram_api_key:
            raise ValueError("DEEPGRAM_API_KEY is required when backend='deepgram'")
        self._client = httpx.Client(timeout=10)
        self._url = (
            f"https://api.deepgram.com/v1/listen"
            f"?model={cfg.deepgram_model}&language=en&punctuate=true"
        )
        self._headers = {
            "Authorization": f"Token {cfg.deepgram_api_key}",
            "Content-Type": "audio/wav",
        }

    def transcribe(self, audio: np.ndarray) -> str:
        wav_bytes = self._to_wav(audio)
        resp = self._client.post(self._url, headers=self._headers, content=wav_bytes)
        resp.raise_for_status()
        data = resp.json()
        alt = data["results"]["channels"][0]["alternatives"]
        return alt[0]["transcript"] if alt else ""

    @staticmethod
    def _to_wav(audio: np.ndarray) -> bytes:
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes((audio * 32767).astype(np.int16).tobytes())
        return buf.getvalue()


# ── Public Transcriber ───────────────────────────────────────────────

class Transcriber:
    """
    Reads AudioChunks from a queue, transcribes them in a thread pool,
    and pushes Segment objects into an asyncio.Queue for the engine.

    Usage
    ─────
    segment_queue = asyncio.Queue()
    transcriber = Transcriber(cfg, chunk_queue, segment_queue)
    asyncio.create_task(transcriber.run())
    """

    def __init__(
        self,
        cfg: TranscriberConfig,
        chunk_queue: queue.Queue[AudioChunk],
        segment_queue: asyncio.Queue[Segment],
    ) -> None:
        self.cfg = cfg
        self._chunk_q = chunk_queue
        self._segment_q = segment_queue
        self._backend = self._make_backend(cfg)
        self._pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="whisper")
        self._running = False

    @staticmethod
    def _make_backend(cfg: TranscriberConfig) -> _Backend:
        if cfg.backend == "deepgram":
            return _DeepgramBackend(cfg)
        return _WhisperBackend(cfg)

    def _transcribe_chunk(self, chunk: AudioChunk) -> Segment | None:
        """Blocking transcription — runs inside the thread pool."""
        text = self._backend.transcribe(chunk.audio)
        if not text:
            return None
        return Segment(text=text, speaker=chunk.speaker, timestamp=chunk.timestamp)

    async def run(self) -> None:
        """Main loop – bridges threaded audio queue to async segment queue."""
        loop = asyncio.get_running_loop()
        self._running = True
        log.info("Transcriber started (backend=%s)", self.cfg.backend)

        pending: set[asyncio.Future] = set()

        while self._running:
            # Pull a chunk (non-blocking poll so we can be cancelled)
            try:
                chunk: AudioChunk = await loop.run_in_executor(
                    None, lambda: self._chunk_q.get(timeout=0.5)
                )
            except queue.Empty:
                chunk = None

            if chunk is not None:
                # Drop stale chunks that have been waiting too long
                age = time.monotonic() - chunk.timestamp
                if age > _STALE_THRESHOLD:
                    log.debug("Dropping stale %s chunk (%.1fs old)", chunk.speaker.name, age)
                else:
                    # Submit to thread pool for parallel transcription
                    fut = loop.run_in_executor(self._pool, self._transcribe_chunk, chunk)
                    pending.add(fut)

            # Harvest completed futures without blocking
            done = {f for f in pending if f.done()}
            for f in done:
                pending.discard(f)
                try:
                    segment = f.result()
                except Exception:
                    log.exception("Transcription failed")
                    continue
                if segment is not None:
                    await self._segment_q.put(segment)
                    log.debug("Transcribed: %s", segment)

    def stop(self) -> None:
        self._running = False
        self._pool.shutdown(wait=False)
