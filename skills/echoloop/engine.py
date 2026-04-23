"""
EchoLoop · Engine
─────────────────
The "Loop" — accumulates transcript segments and periodically fires them
at an LLM to produce live coaching insights.

Triggers:
  • Time-based  — every `push_interval` seconds (default 35s).
  • Silence-based — if no new segments arrive for `silence_trigger` seconds
    AND there is fresh (un-sent) transcript text.

The engine writes Insight objects to a thread-safe queue consumed by the UI.
"""

from __future__ import annotations

import asyncio
import logging
import queue
import threading
import time
from collections import deque
from dataclasses import dataclass

from config import LLMConfig
from transcriber import Segment, Speaker

log = logging.getLogger(__name__)


@dataclass
class Insight:
    """A single coaching output from the LLM."""
    text: str
    timestamp: float


# ── LLM Client wrapper ──────────────────────────────────────────────

class _LLMClient:
    """Thin async wrapper around Anthropic / OpenAI."""

    def __init__(self, cfg: LLMConfig) -> None:
        self.cfg = cfg
        self._client = self._build_client(cfg)

    @staticmethod
    def _build_client(cfg: LLMConfig):
        if cfg.provider == "anthropic":
            import anthropic
            if not cfg.anthropic_api_key:
                raise ValueError("ANTHROPIC_API_KEY is required")
            return anthropic.AsyncAnthropic(api_key=cfg.anthropic_api_key)
        else:
            import openai
            if not cfg.openai_api_key:
                raise ValueError("OPENAI_API_KEY is required")
            return openai.AsyncOpenAI(api_key=cfg.openai_api_key)

    @property
    def _system_prompt(self) -> str:
        return self.cfg.system_prompt_override or self.cfg.system_prompt

    async def get_advice(self, transcript: str) -> str:
        """Send the rolling transcript and get back punchy bullet points."""
        if self.cfg.provider == "anthropic":
            resp = await self._client.messages.create(
                model=self.cfg.anthropic_model,
                max_tokens=200,
                temperature=self.cfg.temperature,
                system=self._system_prompt,
                messages=[{"role": "user", "content": transcript}],
            )
            return resp.content[0].text
        else:
            resp = await self._client.chat.completions.create(
                model=self.cfg.openai_model,
                max_tokens=200,
                temperature=self.cfg.temperature,
                messages=[
                    {"role": "system", "content": self._system_prompt},
                    {"role": "user", "content": transcript},
                ],
            )
            return resp.choices[0].message.content or ""


# ── Engine ───────────────────────────────────────────────────────────

class EchoLoopEngine:
    """
    Async core that:
      1. Drains the segment queue to build a rolling transcript.
      2. Fires the transcript at an LLM on a timer / silence trigger.
      3. Pushes Insight objects to the UI queue.

    Usage
    ─────
    engine = EchoLoopEngine(cfg, segment_queue, insight_queue)
    asyncio.create_task(engine.run())
    """

    def __init__(
        self,
        cfg: LLMConfig,
        segment_queue: asyncio.Queue[Segment],
        insight_queue: queue.Queue[Insight],
        *,
        pause_event: threading.Event | None = None,
        nudge_event: threading.Event | None = None,
        stats: dict | None = None,
    ) -> None:
        self.cfg = cfg
        self._seg_q = segment_queue
        self._insight_q = insight_queue
        self._llm = _LLMClient(cfg)
        # Shared stats dict, read by the UI
        self._stats = stats if stats is not None else {}
        # When clear → paused, when set → running.  Default: running.
        self._pause_event = pause_event or threading.Event()
        if not self._pause_event.is_set():
            self._pause_event.set()
        # Set by the UI "Nudge" button to force an immediate LLM call
        self._nudge_event = nudge_event or threading.Event()

        self._transcript: deque[str] = deque()
        self._transcript_chars: int = 0
        self._last_push_time: float = time.monotonic()
        self._last_segment_time: float = time.monotonic()
        self._unsent_text = False
        self._running = False

        # Speaker stats (word counts)
        self.words_me: int = 0
        self.words_them: int = 0

    # ── Transcript management (O(1) append / trim) ──────────────────

    def _append(self, seg: Segment) -> None:
        tag = "[ME]" if seg.speaker is Speaker.ME else "[THEM]"
        line = f"{tag} {seg.text}"
        self._transcript.append(line)
        self._transcript_chars += len(line) + 1  # +1 for newline
        self._unsent_text = True
        self._last_segment_time = time.monotonic()

        # Track speaker word counts
        wc = len(seg.text.split())
        if seg.speaker is Speaker.ME:
            self.words_me += wc
        else:
            self.words_them += wc
        self._stats["words_me"] = self.words_me
        self._stats["words_them"] = self.words_them

        # Trim from the front to stay within the rolling window
        while self._transcript_chars > self.cfg.max_transcript_chars and self._transcript:
            removed = self._transcript.popleft()
            self._transcript_chars -= len(removed) + 1

    def _get_transcript(self) -> str:
        lines = "\n".join(self._transcript)
        header_parts: list[str] = []

        ctx = self.cfg.meeting_context
        if ctx:
            header_parts.append(f"CONTEXT: {ctx}")

        # Speaker balance hint
        total = self.words_me + self.words_them
        if total > 20:
            pct = int(100 * self.words_me / total)
            header_parts.append(f"TALK RATIO: user {pct}% / others {100 - pct}%")

        if header_parts:
            return "\n".join(header_parts) + "\n---\n" + lines
        return lines

    # ── Trigger logic ────────────────────────────────────────────────

    def _should_push(self) -> bool:
        if not self._unsent_text:
            return False
        # Respect pause
        if not self._pause_event.is_set():
            return False

        now = time.monotonic()
        elapsed = now - self._last_push_time
        silence = now - self._last_segment_time

        # Time-based trigger
        if elapsed >= self.cfg.push_interval:
            return True
        # Silence trigger (conversation pause)
        if silence >= self.cfg.silence_trigger and elapsed >= 10:
            return True
        return False

    # ── Main loop ────────────────────────────────────────────────────

    async def run(self) -> None:
        self._running = True
        self._last_push_time = time.monotonic()
        self._last_segment_time = time.monotonic()
        log.info("EchoLoopEngine started (provider=%s)", self.cfg.provider)

        while self._running:
            # Block briefly for the first segment
            drained = False
            try:
                seg = await asyncio.wait_for(self._seg_q.get(), timeout=1.0)
                self._append(seg)
                drained = True
            except asyncio.TimeoutError:
                pass

            # Drain all remaining segments without blocking
            while drained:
                try:
                    seg = self._seg_q.get_nowait()
                    self._append(seg)
                except asyncio.QueueEmpty:
                    break

            # Check for manual nudge
            if self._nudge_event.is_set():
                self._nudge_event.clear()
                await self._fire()
            elif self._should_push():
                await self._fire()

    async def _fire(self) -> None:
        transcript = self._get_transcript()
        if not transcript.strip():
            return

        self._last_push_time = time.monotonic()
        self._unsent_text = False

        log.info("Firing transcript to LLM (%d chars)", len(transcript))

        # Retry once on transient failure
        for attempt in range(2):
            try:
                advice = await self._llm.get_advice(transcript)
                if advice.strip():
                    insight = Insight(text=advice.strip(), timestamp=time.monotonic())
                    self._insight_q.put_nowait(insight)
                    log.info("Insight: %s", advice.strip()[:120])
                return
            except Exception:
                if attempt == 0:
                    log.warning("LLM call failed, retrying in 2s…")
                    await asyncio.sleep(2)
                else:
                    log.exception("LLM call failed after retry")

    def stop(self) -> None:
        self._running = False
