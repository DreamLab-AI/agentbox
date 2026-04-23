"""
EchoLoop · UI
─────────────
Lightweight, always-on-top, semi-transparent Tkinter overlay that displays
a running log of AI coaching insights.

Runs on the **main thread** (Tkinter requirement on macOS/Windows).
Polls a thread-safe queue for new Insight objects every 250 ms.
"""

from __future__ import annotations

import queue
import threading
import time
import tkinter as tk
from tkinter import font as tkfont

from config import UIConfig
from engine import Insight


class EchoLoopUI:
    """
    Always-on-top overlay window.

    Usage
    ─────
    ui = EchoLoopUI(cfg, insight_queue, pause_event=evt, nudge_event=nudge,
                     on_close=shutdown_callback)
    ui.run()   # blocks – must be called from the main thread
    """

    def __init__(
        self,
        cfg: UIConfig,
        insight_queue: queue.Queue[Insight],
        *,
        pause_event: threading.Event | None = None,
        nudge_event: threading.Event | None = None,
        stats: dict | None = None,
        transcript_ref: object | None = None,
        on_close: callable = None,
    ) -> None:
        self.cfg = cfg
        self._insight_q = insight_queue
        self._on_close = on_close
        self._pause_event = pause_event or threading.Event()
        self._nudge_event = nudge_event or threading.Event()
        self._stats = stats or {}
        # Reference to engine._transcript (a deque) for the transcript viewer
        self._transcript_ref = transcript_ref
        if not self._pause_event.is_set():
            self._pause_event.set()

        self._insight_count = 0
        self._start_time = time.monotonic()
        self._showing_transcript = False

        self._root = tk.Tk()
        self._build_window()
        self._build_widgets()

    # ── Window setup ─────────────────────────────────────────────────

    def _build_window(self) -> None:
        r = self._root
        r.title("EchoLoop")
        r.geometry(f"{self.cfg.width}x{self.cfg.height}")
        r.minsize(320, 200)
        r.attributes("-topmost", True)
        r.attributes("-alpha", self.cfg.opacity)
        r.configure(bg=self.cfg.bg_color)
        r.protocol("WM_DELETE_WINDOW", self._handle_close)

        r.bind("<Button-1>", self._start_drag)
        r.bind("<B1-Motion>", self._do_drag)

        self._drag_x = 0
        self._drag_y = 0

    def _build_widgets(self) -> None:
        c = self.cfg

        # ── Header ───────────────────────────────────────────────────
        header = tk.Frame(self._root, bg=c.bg_color)
        header.pack(fill=tk.X, padx=12, pady=(10, 2))

        title_font = tkfont.Font(family=c.font_family, size=c.font_size + 2, weight="bold")
        tk.Label(
            header, text="◉ EchoLoop", font=title_font,
            fg=c.accent_color, bg=c.bg_color,
        ).pack(side=tk.LEFT)

        btn_font = tkfont.Font(family=c.font_family, size=c.font_size - 1)
        btn_kw = dict(
            font=btn_font, fg=c.text_color, bg="#2a2a4a",
            activebackground="#3a3a5a", activeforeground=c.text_color,
            bd=0, padx=8, pady=2, cursor="hand2",
        )

        # Pause button
        self._pause_btn = tk.Button(header, text="⏸ Pause", command=self._toggle_pause, **btn_kw)
        self._pause_btn.pack(side=tk.RIGHT, padx=(4, 0))

        # Nudge button — force an immediate LLM call
        self._nudge_btn = tk.Button(header, text="⚡ Nudge", command=self._nudge, **btn_kw)
        self._nudge_btn.pack(side=tk.RIGHT, padx=(4, 0))

        # Clear button
        self._clear_btn = tk.Button(header, text="x Clear", command=self._clear_log, **btn_kw)
        self._clear_btn.pack(side=tk.RIGHT, padx=(4, 0))

        # Transcript toggle button
        if self._transcript_ref is not None:
            self._transcript_btn = tk.Button(
                header, text="T", command=self._toggle_transcript, **btn_kw,
            )
            self._transcript_btn.pack(side=tk.RIGHT, padx=(4, 0))

        # Status
        self._status_label = tk.Label(
            header, text="listening…",
            font=tkfont.Font(family=c.font_family, size=c.font_size - 1),
            fg="#888", bg=c.bg_color,
        )
        self._status_label.pack(side=tk.RIGHT, padx=(0, 8))

        # ── Separator ────────────────────────────────────────────────
        tk.Frame(self._root, bg=c.accent_color, height=1).pack(fill=tk.X, padx=12, pady=4)

        # ── Scrollable insight log ───────────────────────────────────
        text_font = tkfont.Font(family=c.font_family, size=c.font_size)
        self._text = tk.Text(
            self._root, wrap=tk.WORD, font=text_font,
            fg=c.text_color, bg=c.bg_color, bd=0, highlightthickness=0,
            padx=14, pady=6, cursor="arrow", state=tk.DISABLED, spacing3=6,
        )
        self._text.pack(fill=tk.BOTH, expand=True)

        self._text.tag_configure("bullet", foreground=c.accent_color)
        self._text.tag_configure("body", foreground=c.text_color)
        self._text.tag_configure(
            "dim", foreground="#555",
            font=tkfont.Font(family=c.font_family, size=c.font_size - 2),
        )

        # ── Footer — stats bar ───────────────────────────────────────
        footer = tk.Frame(self._root, bg="#111122")
        footer.pack(fill=tk.X, side=tk.BOTTOM)

        footer_font = tkfont.Font(family=c.font_family, size=c.font_size - 2)
        self._stats_label = tk.Label(
            footer, text="0 insights · 0m", font=footer_font,
            fg="#555", bg="#111122", padx=12, pady=4,
        )
        self._stats_label.pack(side=tk.LEFT)

        self._mode_label = tk.Label(
            footer, text="", font=footer_font,
            fg=c.accent_color, bg="#111122", padx=12, pady=4,
        )
        self._mode_label.pack(side=tk.RIGHT)

        # Welcome message
        self._append_insight("Waiting for meeting audio…")

    # ── Actions ──────────────────────────────────────────────────────

    def _toggle_pause(self) -> None:
        if self._pause_event.is_set():
            self._pause_event.clear()
            self._pause_btn.configure(text="▶ Resume")
            self._status_label.configure(text="paused")
            self._mode_label.configure(text="PAUSED", fg="#ff6b6b")
        else:
            self._pause_event.set()
            self._pause_btn.configure(text="⏸ Pause")
            self._status_label.configure(text="listening…")
            self._mode_label.configure(text="", fg=self.cfg.accent_color)

    def _nudge(self) -> None:
        """Signal the engine to fire an LLM call immediately."""
        self._nudge_event.set()
        self._status_label.configure(text="nudging…")

    def _clear_log(self) -> None:
        self._text.configure(state=tk.NORMAL)
        self._text.delete("1.0", tk.END)
        self._text.configure(state=tk.DISABLED)

    def _toggle_transcript(self) -> None:
        """Switch between insights view and raw transcript view."""
        self._showing_transcript = not self._showing_transcript
        self._text.configure(state=tk.NORMAL)
        self._text.delete("1.0", tk.END)

        if self._showing_transcript and self._transcript_ref is not None:
            self._text.tag_configure("me", foreground=self.cfg.accent_color)
            self._text.tag_configure("them", foreground="#aaa")
            for line in self._transcript_ref:
                if line.startswith("[ME]"):
                    self._text.insert(tk.END, line + "\n", "me")
                else:
                    self._text.insert(tk.END, line + "\n", "them")
            self._transcript_btn.configure(text="I")  # switch back to Insights
            self._mode_label.configure(text="TRANSCRIPT", fg="#6699cc")
        else:
            self._showing_transcript = False
            if hasattr(self, "_transcript_btn"):
                self._transcript_btn.configure(text="T")
            self._mode_label.configure(text="", fg=self.cfg.accent_color)

        self._text.configure(state=tk.DISABLED)
        self._text.see(tk.END)

    # ── Drag-to-move ─────────────────────────────────────────────────

    def _start_drag(self, event: tk.Event) -> None:
        self._drag_x = event.x
        self._drag_y = event.y

    def _do_drag(self, event: tk.Event) -> None:
        x = self._root.winfo_x() + event.x - self._drag_x
        y = self._root.winfo_y() + event.y - self._drag_y
        self._root.geometry(f"+{x}+{y}")

    # ── Insight rendering ────────────────────────────────────────────

    def _append_insight(self, text: str) -> None:
        self._text.configure(state=tk.NORMAL)

        lines = text.strip().split("\n")
        for line in lines:
            line = line.strip()
            if not line:
                continue
            if line.startswith(("•", "-", "*", "→")):
                line = line[1:].strip()
            self._text.insert(tk.END, "  → ", "bullet")
            self._text.insert(tk.END, line + "\n", "body")

        self._text.insert(tk.END, "\n")

        # Trim old entries
        line_count = int(self._text.index("end-1c").split(".")[0])
        if line_count > self.cfg.max_lines:
            self._text.delete("1.0", f"{line_count - self.cfg.max_lines}.0")

        self._text.configure(state=tk.DISABLED)
        self._text.see(tk.END)

    def _update_stats(self) -> None:
        elapsed = time.monotonic() - self._start_time
        mins = int(elapsed // 60)

        parts = [f"{self._insight_count} insight{'s' if self._insight_count != 1 else ''}", f"{mins}m"]

        # Speaker ratio from shared stats
        wm = self._stats.get("words_me", 0)
        wt = self._stats.get("words_them", 0)
        total = wm + wt
        if total > 0:
            pct_me = int(100 * wm / total)
            parts.append(f"you {pct_me}%")

        self._stats_label.configure(text=" · ".join(parts))

    # ── Queue polling ────────────────────────────────────────────────

    def _poll_queue(self) -> None:
        batch: list[str] = []
        try:
            while True:
                insight: Insight = self._insight_q.get_nowait()
                batch.append(insight.text)
        except queue.Empty:
            pass

        if batch:
            for text in batch:
                self._append_insight(text)
                self._insight_count += 1
            if self._pause_event.is_set():
                self._status_label.configure(text="coaching ▸")
        elif self._pause_event.is_set():
            self._status_label.configure(text="listening…")

        self._update_stats()
        self._root.after(250, self._poll_queue)

    # ── Lifecycle ────────────────────────────────────────────────────

    def _handle_close(self) -> None:
        if self._on_close:
            self._on_close()
        self._root.destroy()

    def run(self) -> None:
        """Start the Tkinter main loop (blocks the calling thread)."""
        self._root.after(250, self._poll_queue)
        self._root.mainloop()
