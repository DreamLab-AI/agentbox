"""
EchoLoop · AudioCapture
───────────────────────
Captures two audio streams in parallel:
  1. System audio  – routed through a virtual cable (VB-Cable / BlackHole).
  2. Microphone     – default input device or user-specified.

Each stream writes fixed-duration chunks (numpy arrays) into a thread-safe
queue consumed by the Transcriber.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
from dataclasses import dataclass
from enum import Enum, auto

import numpy as np
import sounddevice as sd

from config import AudioConfig

log = logging.getLogger(__name__)


class Speaker(Enum):
    """Identifies the audio source for downstream labelling."""
    THEM = auto()
    ME = auto()


@dataclass
class AudioChunk:
    """A time-stamped block of PCM audio."""
    audio: np.ndarray  # shape (samples,), float32, mono 16 kHz
    speaker: Speaker
    timestamp: float  # time.monotonic()


class AudioCapture:
    """
    Manages two concurrent sounddevice.InputStream instances.

    Public interface
    ────────────────
    .start()          → begins capturing on background threads
    .stop()           → gracefully stops streams
    .chunk_queue      → queue.Queue[AudioChunk] consumed by Transcriber
    """

    def __init__(self, cfg: AudioConfig) -> None:
        self.cfg = cfg
        self.chunk_queue: queue.Queue[AudioChunk] = queue.Queue(maxsize=200)
        self._stop_event = threading.Event()
        self._threads: list[threading.Thread] = []

        self._system_device = self._resolve_device(cfg.system_device, kind="input", label="system/loopback")
        self._mic_device = self._resolve_device(cfg.mic_device, kind="input", label="microphone")

    # ── Device resolution ────────────────────────────────────────────

    @staticmethod
    def list_input_devices() -> list[dict]:
        """Return all available input devices."""
        devices = sd.query_devices()
        return [
            {"index": i, "name": d["name"], "channels": d["max_input_channels"]}
            for i, d in enumerate(devices)
            if d["max_input_channels"] > 0
        ]

    @staticmethod
    def _resolve_device(hint: str | None, *, kind: str, label: str) -> int | None:
        """Match a device name substring to a sounddevice index."""
        if hint is None:
            return None  # will use default
        devices = sd.query_devices()
        for i, d in enumerate(devices):
            if hint.lower() in d["name"].lower() and d[f"max_{kind}_channels"] > 0:
                log.info("Resolved %s device: [%d] %s", label, i, d["name"])
                return i
        log.warning("Could not find %s device matching '%s' – falling back to default", label, hint)
        return None

    # ── Stream workers ───────────────────────────────────────────────

    def _stream_worker(self, device: int | None, speaker: Speaker) -> None:
        """Run a blocking InputStream in its own thread."""
        samples_per_chunk = int(self.cfg.sample_rate * self.cfg.chunk_duration)
        energy_threshold = self.cfg.energy_threshold
        buffer = np.zeros(samples_per_chunk, dtype=np.float32)
        buf_pos = 0

        def _callback(indata: np.ndarray, frames: int, time_info, status) -> None:
            nonlocal buffer, buf_pos
            if status:
                log.debug("audio status (%s): %s", speaker.name, status)
            mono = indata[:, 0] if indata.ndim > 1 else indata.ravel()
            remaining = samples_per_chunk - buf_pos
            take = min(len(mono), remaining)
            buffer[buf_pos : buf_pos + take] = mono[:take]
            buf_pos += take
            if buf_pos >= samples_per_chunk:
                # Skip silent chunks — saves whisper CPU
                rms = np.sqrt(np.mean(buffer ** 2))
                if rms < energy_threshold:
                    buffer[:] = 0.0
                    buf_pos = 0
                    return
                try:
                    self.chunk_queue.put_nowait(
                        AudioChunk(audio=buffer.copy(), speaker=speaker, timestamp=time.monotonic())
                    )
                except queue.Full:
                    log.warning("Chunk queue full – dropping %s chunk", speaker.name)
                buffer = np.zeros(samples_per_chunk, dtype=np.float32)
                buf_pos = 0
                # Handle leftover samples
                leftover = len(mono) - take
                if leftover > 0:
                    buffer[:leftover] = mono[take:]
                    buf_pos = leftover

        max_retries = 5
        retry_delay = 2.0

        for attempt in range(max_retries):
            try:
                with sd.InputStream(
                    device=device,
                    samplerate=self.cfg.sample_rate,
                    channels=self.cfg.channels,
                    dtype=self.cfg.dtype,
                    blocksize=1024,
                    callback=_callback,
                ):
                    if attempt > 0:
                        log.info("Reconnected %s stream (attempt %d)", speaker.name, attempt + 1)
                    else:
                        log.info("Started %s stream (device=%s)", speaker.name, device)
                    while not self._stop_event.is_set():
                        self._stop_event.wait(timeout=0.25)
                    return  # clean exit
            except sd.PortAudioError as e:
                if self._stop_event.is_set():
                    return
                log.warning(
                    "%s stream lost (attempt %d/%d): %s — retrying in %.0fs",
                    speaker.name, attempt + 1, max_retries, e, retry_delay,
                )
                self._stop_event.wait(timeout=retry_delay)
                retry_delay = min(retry_delay * 1.5, 15.0)
                # Reset buffer state
                buffer[:] = 0.0
                buf_pos = 0
            except Exception:
                log.exception("Fatal error in %s audio stream", speaker.name)
                return

        log.error("%s stream failed after %d retries — giving up", speaker.name, max_retries)

    # ── Public API ───────────────────────────────────────────────────

    def start(self) -> None:
        """Launch capture threads for system audio and microphone."""
        self._stop_event.clear()
        for device, speaker in [
            (self._system_device, Speaker.THEM),
            (self._mic_device, Speaker.ME),
        ]:
            t = threading.Thread(
                target=self._stream_worker,
                args=(device, speaker),
                daemon=True,
                name=f"audio-{speaker.name.lower()}",
            )
            t.start()
            self._threads.append(t)

    def stop(self) -> None:
        """Signal all streams to stop and wait for threads to exit."""
        self._stop_event.set()
        for t in self._threads:
            t.join(timeout=3)
        self._threads.clear()
        log.info("AudioCapture stopped")
