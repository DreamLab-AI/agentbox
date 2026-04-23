"""
EchoLoop · Main
───────────────
Orchestrator that wires AudioCapture → Transcriber → Engine → UI
and manages the async event loop alongside the Tkinter main loop.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import logging
import os
import queue
import signal
import sys
import threading
from datetime import datetime
from pathlib import Path

# ── Logging ──────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(name)-22s  %(levelname)-5s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("echoloop")

# ── CLI banner ───────────────────────────────────────────────────────

BANNER = """
    +===============================================+
    |                                               |
    |    EchoLoop                                   |
    |    ---------                                  |
    |    Real-time AI meeting copilot               |
    |    Meeting superpowers. Every call.            |
    |                                               |
    +===============================================+
"""

# ── Dependency checks ────────────────────────────────────────────────

_REQUIRED = {
    "sounddevice": "Audio capture        → pip install sounddevice",
    "numpy":       "Audio processing     → pip install numpy",
}

_OPTIONAL = {
    "faster_whisper": ("Local transcription  → pip install faster-whisper", "local transcription"),
    "anthropic":      ("Anthropic LLM        → pip install anthropic",     "Anthropic provider"),
    "openai":         ("OpenAI LLM           → pip install openai",        "OpenAI provider"),
    "httpx":          ("Deepgram backend     → pip install httpx",         "Deepgram transcription"),
    "pynput":         ("Global hotkeys       → pip install pynput",        "global hotkey support"),
}


def _check_dependencies() -> None:
    """Validate required deps are installed; warn about optional ones."""
    missing = []
    for mod, hint in _REQUIRED.items():
        try:
            importlib.import_module(mod)
        except ImportError:
            missing.append(hint)

    if missing:
        print("\n  Missing required dependencies:\n")
        for m in missing:
            print(f"    ✗  {m}")
        print("\n  Run:  pip install -r requirements.txt\n")
        sys.exit(1)

    for mod, (hint, label) in _OPTIONAL.items():
        try:
            importlib.import_module(mod)
        except ImportError:
            log.debug("Optional: %s not installed (%s unavailable)", mod, label)


# ── Lazy imports (after dep check) ───────────────────────────────────

def _import_app_modules():
    global AudioCapture, AppConfig, EchoLoopEngine, Insight, Segment, Transcriber, EchoLoopUI
    from audio_capture import AudioCapture
    from config import AppConfig
    from engine import EchoLoopEngine, Insight
    from transcriber import Segment, Transcriber
    from ui import EchoLoopUI


# ── Session file logger ──────────────────────────────────────────────

class SessionLogger:
    """
    Appends timestamped transcript lines and insights to a log file.
    Optionally exports a Markdown summary on close.
    Disabled when log_dir is empty.
    """

    def __init__(self, log_dir: str) -> None:
        self._file = None
        self._path = None
        self._segments: list[str] = []
        self._insights: list[str] = []
        if not log_dir:
            return
        path = Path(log_dir).expanduser()
        path.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        self._path = path / f"echoloop_{stamp}.log"
        self._md_path = path / f"echoloop_{stamp}.md"
        self._file = open(self._path, "a", encoding="utf-8", buffering=1)
        self._start_time = datetime.now()
        log.info("Session log: %s", self._path)

    def log_segment(self, text: str, speaker: str) -> None:
        if not self._file:
            return
        ts = datetime.now().strftime("%H:%M:%S")
        line = f"{ts}  [{speaker}] {text}"
        self._file.write(line + "\n")
        self._segments.append(line)

    def log_insight(self, insight) -> None:
        if not self._file:
            return
        ts = datetime.now().strftime("%H:%M:%S")
        line = f"{ts}  [INSIGHT] {insight.text}"
        self._file.write(line + "\n")
        self._insights.append(insight.text)

    def close(self) -> None:
        if self._file:
            self._file.close()
            self._file = None
            self._export_markdown()

    def _export_markdown(self) -> None:
        """Write a Markdown summary of the session."""
        if not self._path or (not self._segments and not self._insights):
            return
        try:
            duration = datetime.now() - self._start_time
            mins = int(duration.total_seconds() // 60)
            secs = int(duration.total_seconds() % 60)

            with open(self._md_path, "w", encoding="utf-8") as f:
                f.write(f"# EchoLoop Session — {self._start_time.strftime('%Y-%m-%d %H:%M')}\n\n")
                f.write(f"**Duration:** {mins}m {secs}s  \n")
                f.write(f"**Segments:** {len(self._segments)}  \n")
                f.write(f"**Insights:** {len(self._insights)}\n\n")

                if self._insights:
                    f.write("## Key Insights\n\n")
                    for ins in self._insights:
                        for line in ins.strip().split("\n"):
                            line = line.strip()
                            if line:
                                if line.startswith(("•", "-", "*", "→")):
                                    line = line[1:].strip()
                                f.write(f"- {line}\n")
                    f.write("\n")

                if self._segments:
                    f.write("## Full Transcript\n\n")
                    f.write("```\n")
                    for seg in self._segments:
                        f.write(seg + "\n")
                    f.write("```\n")

            log.info("Markdown export: %s", self._md_path)
        except Exception:
            log.exception("Failed to export markdown summary")


# ── Device picker (interactive) ──────────────────────────────────────

def pick_device_interactive() -> str | None:
    """If no system device is configured, let the user pick one."""
    devices = AudioCapture.list_input_devices()
    if not devices:
        log.error("No input audio devices found!")
        sys.exit(1)

    print("\n  Available input devices:")
    print("  " + "-" * 52)
    for d in devices:
        print(f"    [{d['index']:>2}]  {d['name']:<44} ch={d['channels']}")
    print("  " + "-" * 52)
    print()
    print("  Enter the INDEX of your virtual cable / loopback device")
    print("  (this captures what others say in the meeting).")
    print("  Press Enter to skip (will use default input).\n")

    choice = input("  System audio device index: ").strip()
    if not choice:
        return None

    try:
        idx = int(choice)
        match = next((d for d in devices if d["index"] == idx), None)
        if match:
            return match["name"]
    except ValueError:
        pass

    print("  > Invalid choice, using default device.")
    return None


# ── Async engine runner ──────────────────────────────────────────────

def _run_async_loop(
    transcriber,
    engine,
    stop_event: threading.Event,
) -> None:
    """Runs in a daemon thread – hosts the asyncio event loop."""

    async def _main() -> None:
        t_task = asyncio.create_task(transcriber.run())
        e_task = asyncio.create_task(engine.run())

        while not stop_event.is_set():
            await asyncio.sleep(0.25)

        transcriber.stop()
        engine.stop()
        t_task.cancel()
        e_task.cancel()
        try:
            await asyncio.gather(t_task, e_task, return_exceptions=True)
        except Exception:
            pass

    asyncio.run(_main())


# ── Global hotkey (optional) ─────────────────────────────────────────

def _start_hotkey_listener(pause_event: threading.Event) -> None:
    """Register Ctrl+Shift+E to toggle pause. Silently skipped if pynput missing."""
    try:
        from pynput import keyboard
    except ImportError:
        return

    COMBO = {keyboard.Key.ctrl_l, keyboard.Key.shift_l}
    TRIGGER = keyboard.KeyCode.from_char("e")
    current = set()

    def on_press(key):
        if key in COMBO:
            current.add(key)
        if key == TRIGGER and COMBO.issubset(current):
            if pause_event.is_set():
                pause_event.clear()
                log.info("Paused (hotkey)")
            else:
                pause_event.set()
                log.info("Resumed (hotkey)")

    def on_release(key):
        current.discard(key)

    listener = keyboard.Listener(on_press=on_press, on_release=on_release, daemon=True)
    listener.start()
    log.info("Global hotkey registered: Ctrl+Shift+E (pause/resume)")


# ── .env loading ─────────────────────────────────────────────────────

def _load_dotenv() -> None:
    """Load .env file if it exists. No dependency on python-dotenv."""
    env_path = Path(".env")
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("\"'")
        if key and key not in os.environ:  # don't override existing env
            os.environ[key] = value
    log.debug("Loaded .env file")


# ── CLI argument parsing ─────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="echoloop",
        description="EchoLoop -- real-time AI meeting copilot",
    )
    parser.add_argument(
        "--version", action="version", version="echoloop 0.1.0",
    )
    parser.add_argument(
        "--list-devices", action="store_true",
        help="List available audio input devices and exit",
    )
    parser.add_argument(
        "--context", type=str, default=None,
        help="Meeting context (overrides ECHOLOOP_MEETING_CONTEXT)",
    )
    parser.add_argument(
        "--provider", type=str, choices=["anthropic", "openai"], default=None,
        help="LLM provider (overrides ECHOLOOP_LLM_PROVIDER)",
    )
    parser.add_argument(
        "--backend", type=str, choices=["local", "deepgram"], default=None,
        help="Transcription backend (overrides ECHOLOOP_TRANSCRIBER)",
    )
    parser.add_argument(
        "--debug", action="store_true",
        help="Enable debug logging (verbose audio/transcription output)",
    )
    return parser.parse_args()


# ── Entry point ──────────────────────────────────────────────────────

def main() -> None:
    _load_dotenv()
    args = _parse_args()

    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)

    print(BANNER)
    _check_dependencies()
    _import_app_modules()

    # --list-devices: print and exit
    if args.list_devices:
        devices = AudioCapture.list_input_devices()
        print("Available input devices:\n")
        for d in devices:
            print(f"  [{d['index']:>2}]  {d['name']}  (channels={d['channels']})")
        print()
        sys.exit(0)

    cfg = AppConfig()

    # CLI overrides
    if args.context is not None:
        cfg.llm.meeting_context = args.context
    if args.provider is not None:
        cfg.llm.provider = args.provider
    if args.backend is not None:
        cfg.transcriber.backend = args.backend

    # Validate configuration
    issues = cfg.validate()
    for issue in issues:
        log.warning("Config: %s", issue)
    # Fatal issues (missing API keys) — exit early
    fatal = [i for i in issues if "is not set" in i]
    if fatal:
        print("\n  Fix the above config issues and try again.\n")
        sys.exit(1)

    # Interactive device selection if not set via env
    if cfg.audio.system_device is None:
        chosen = pick_device_interactive()
        if chosen:
            cfg.audio.system_device = chosen

    # Session logger
    session_logger = SessionLogger(cfg.log_dir)

    # Shared events
    pause_event = threading.Event()
    pause_event.set()  # set = running, clear = paused
    nudge_event = threading.Event()  # set = fire now

    # Optional global hotkey
    _start_hotkey_listener(pause_event)

    # Components — use AudioCapture's own chunk_queue
    audio = AudioCapture(cfg.audio)
    chunk_queue = audio.chunk_queue

    segment_queue: asyncio.Queue = asyncio.Queue(maxsize=500)
    insight_queue: queue.Queue = queue.Queue(maxsize=100)

    # Logging proxy for insight queue
    class _LoggingInsightQueue:
        """Proxy that logs insights as they flow through."""

        def __init__(self, real_q, logger: SessionLogger):
            self._q = real_q
            self._logger = logger

        def put_nowait(self, item) -> None:
            self._logger.log_insight(item)
            self._q.put_nowait(item)

        def get_nowait(self):
            return self._q.get_nowait()

        def __getattr__(self, name):
            return getattr(self._q, name)

    logging_insight_q = _LoggingInsightQueue(insight_queue, session_logger)

    # Shared stats dict (engine writes, UI reads)
    shared_stats: dict = {}

    transcriber = Transcriber(cfg.transcriber, chunk_queue, segment_queue)
    engine = EchoLoopEngine(
        cfg.llm, segment_queue, logging_insight_q,
        pause_event=pause_event, nudge_event=nudge_event, stats=shared_stats,
    )

    stop_event = threading.Event()

    def shutdown() -> None:
        log.info("Shutting down…")
        stop_event.set()
        audio.stop()
        session_logger.close()

    # Handle Ctrl+C gracefully
    def _sigint_handler(sig, frame):
        print("\n  Interrupted — shutting down…")
        shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, _sigint_handler)

    # Start audio capture threads
    audio.start()

    # Start async loop (transcriber + engine) in a background thread
    async_thread = threading.Thread(
        target=_run_async_loop,
        args=(transcriber, engine, stop_event),
        daemon=True,
        name="async-loop",
    )
    async_thread.start()

    # Run UI on the main thread (blocks until window is closed)
    log.info("EchoLoop is live. Close the overlay window to exit.")
    print("  Press Ctrl+Shift+E to pause/resume (if pynput installed).")
    print("  Close the overlay window to stop.\n")
    ui = EchoLoopUI(
        cfg.ui, insight_queue,
        pause_event=pause_event, nudge_event=nudge_event,
        stats=shared_stats, transcript_ref=engine._transcript,
        on_close=shutdown,
    )
    ui.run()

    # Cleanup
    stop_event.set()
    audio.stop()
    session_logger.close()
    async_thread.join(timeout=3)
    log.info("EchoLoop stopped.")


if __name__ == "__main__":
    main()
