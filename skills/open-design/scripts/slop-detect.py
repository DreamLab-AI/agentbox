#!/usr/bin/env python3
"""
slop-detect — deterministic, no-LLM design anti-pattern scanner.

Adapted from pbakaus/impeccable's `detect` CLI (Apache-2.0) into the agentbox
skills idiom: zero dependencies, regex/heuristic rules, inline disable comments,
text or JSON output. Implements the CLI-detectable layer of the slop catalogue
(see ../references/slop-rules-catalog.md). The browser- and LLM-only layers are
documented there for the agent to apply by judgment; this script covers what can
be decided from source statically.

Philosophy difference from impeccable: impeccable is invoked by an explicit
`/impeccable detect` slash command. Here the agent runs this as a quality GATE
(open-design Phase 6, design-audit Step 1) under inferred intent, and persists
findings to RuVector memory rather than to flat PRODUCT.md/DESIGN.md files.

Usage:
    python3 slop-detect.py PATH [PATH ...] [--json] [--rule R] [--ignore R]
                                [--min-severity warn] [--quiet]

    PATH may be a file or directory (recursed). Scans .css .scss .sass .less
    .html .htm .jsx .tsx .vue .svelte .astro by default.

Inline suppression (per-line or block, like impeccable):
    /* slop-disable overused-font */
    <!-- slop-disable nested-cards gradient-text -->
    /* slop-disable-next-line tiny-text */

Exit code: number of findings at or above --min-severity (capped at 250),
0 when clean — so it can fail CI.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

SCAN_EXT = {
    ".css", ".scss", ".sass", ".less",
    ".html", ".htm", ".jsx", ".tsx", ".vue", ".svelte", ".astro",
}

# Ubiquitous typefaces that signal "AI default" when used as the only/display face.
OVERUSED_FONTS = {
    "inter", "roboto", "open sans", "lato", "montserrat",
    "poppins", "nunito", "space grotesk", "source sans pro",
}

SEVERITY_ORDER = {"info": 0, "warn": 1, "error": 2}


class Finding:
    __slots__ = ("rule", "severity", "line", "file", "snippet", "message")

    def __init__(self, rule, severity, line, file, snippet, message):
        self.rule = rule
        self.severity = severity
        self.line = line
        self.file = file
        self.snippet = snippet.strip()[:120]
        self.message = message

    def as_dict(self):
        return {
            "rule": self.rule,
            "severity": self.severity,
            "file": self.file,
            "line": self.line,
            "snippet": self.snippet,
            "message": self.message,
        }


# ---------------------------------------------------------------------------
# Rule helpers
# ---------------------------------------------------------------------------

HEX = re.compile(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b")


def _hue_of(hexstr: str):
    """Return (r,g,b) 0-255 from a #rgb or #rrggbb string."""
    h = hexstr.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _is_bluish(rgb):
    r, g, b = rgb
    return b > 150 and b > r + 30 and b >= g


def _is_purpleish(rgb):
    r, g, b = rgb
    return b > 120 and r > 90 and r < b and g < r - 20 and g < b - 20


def _is_pure_bw(hexstr):
    h = hexstr.lstrip("#").lower()
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return h in ("000000", "ffffff")


def _is_grayish(rgb):
    r, g, b = rgb
    return max(r, g, b) - min(r, g, b) <= 12  # near-neutral


# ---------------------------------------------------------------------------
# Per-line / per-file rules
# Each line rule: fn(line_text) -> (severity, message) | None
# ---------------------------------------------------------------------------

def rule_gradient_text(line):
    low = line.lower()
    if ("background-clip" in low or "-webkit-background-clip" in low) and "text" in low:
        return ("warn", "Gradient clipped to text — kills scannability and contrast control.")
    if "text-fill-color" in low and "transparent" in low:
        return ("warn", "Transparent text fill (gradient text) — reduces legibility.")
    return None


def rule_bounce_easing(line):
    low = line.lower()
    if re.search(r"(cubic-bezier\([^)]*-0?\.[0-9])", low):  # negative control point = overshoot
        return ("warn", "Overshoot/elastic cubic-bezier — reads as dated bounce.")
    if re.search(r"\b(bounce|elastic|back(in|out|inout)?)\b", low) and (
        "transition" in low or "animation" in low or "ease" in low or "timing" in low
    ):
        return ("warn", "Bounce/elastic easing — dated motion. Prefer 150–300ms ease-out.")
    return None


def rule_layout_transition(line):
    low = line.lower()
    if re.search(r"transition\s*:\s*[^;{}]*\b(width|height|top|left|right|bottom|margin)\b", low):
        return ("warn", "Animating layout properties (width/height/top/left/margin) — causes reflow jank. Animate transform/opacity.")
    if re.search(r"@keyframes", low):
        return None
    return None


def rule_tiny_text(line):
    low = line.lower()
    m = re.search(r"font-size\s*:\s*(\d+(?:\.\d+)?)px", low)
    if m and float(m.group(1)) < 11:
        return ("warn", f"font-size {m.group(1)}px is below the 11px legibility floor.")
    return None


def rule_tight_leading(line):
    low = line.lower()
    m = re.search(r"line-height\s*:\s*(\d?\.\d+|\d)\s*;", low)
    if m:
        try:
            v = float(m.group(1))
        except ValueError:
            return None
        if 0 < v < 1.3:
            return ("info", f"line-height {v} is tight for body copy (aim 1.5–1.75).")
    return None


def rule_wide_tracking(line):
    low = line.lower()
    m = re.search(r"letter-spacing\s*:\s*(\d*\.?\d+)em", low)
    if m and float(m.group(1)) > 0.15:
        return ("info", f"letter-spacing {m.group(1)}em exceeds 0.15em — only for short display, never body.")
    return None


def rule_justified_text(line):
    if re.search(r"text-align\s*:\s*justify", line.lower()):
        return ("info", "Justified text on screen creates whitespace rivers — use left-align.")
    return None


def rule_allcaps_body(line):
    low = line.lower()
    if re.search(r"text-transform\s*:\s*uppercase", low):
        return ("info", "Uppercase — fine for short labels, never for body passages (review context).")
    return None


def rule_pill_button(line):
    low = line.lower()
    if re.search(r"border-radius\s*:\s*(9999px|999px|50rem|100vmax)", low):
        return ("info", "Fully-rounded pill radius — only if the brand thesis calls for it.")
    return None


def rule_dark_glow(line):
    low = line.lower()
    m = re.search(r"text-shadow\s*:\s*[^;{}]*?(\d+)px\s+\d*\.?\d*px\s+(\d+)px", low)
    if m and int(m.group(2)) >= 8:
        return ("info", "Large text-shadow blur (neon glow) — dated unless the thesis is synthwave/Y2K.")
    return None


def rule_generic_drop_shadow(line):
    low = line.lower()
    if re.search(r"box-shadow\s*:\s*0\s+1px\s+3px\s+rgba\(0\s*,\s*0\s*,\s*0", low):
        return ("info", "Default `0 1px 3px rgba(0,0,0,…)` shadow — generic. Tint the shadow to the surface.")
    return None


def rule_side_tab(line):
    low = line.lower()
    if re.search(r"border-(left|right|top)\s*:\s*(\d+)px", low):
        m = re.search(r"border-(left|right|top)\s*:\s*(\d+)px", low)
        if m and int(m.group(2)) >= 3:
            return ("info", "Thick one-sided border (side-tab stripe) — a tell when paired with rounded cards.")
    return None


# Per-file rules: fn(text, lines) -> list[(rule, severity, line_no, snippet, message)]

def file_rule_overused_font(text, lines):
    out = []
    seen_named = set()
    for m in re.finditer(r"font-family\s*:\s*([^;{}]+)", text, re.I):
        raw = m.group(1)
        names = [n.strip().strip("'\"").lower() for n in raw.split(",")]
        for n in names:
            if n and n not in ("sans-serif", "serif", "monospace", "system-ui", "ui-sans-serif", "-apple-system"):
                seen_named.add(n)
        first = names[0] if names else ""
        if first in OVERUSED_FONTS:
            ln = text.count("\n", 0, m.start()) + 1
            out.append(("overused-font", "warn", ln, raw.strip()[:80],
                        f"'{first}' as primary face — the #1 AI tell. Pair with a distinctive display face."))
    # single-font: only one non-generic family across the whole file
    if len(seen_named) == 1:
        out.append(("single-font", "info", 0, sorted(seen_named)[0],
                    "Only one typeface family — no heading/body contrast. Add a display face."))
    return out


def file_rule_pure_bw(text, lines):
    out = []
    for m in HEX.finditer(text):
        if _is_pure_bw(m.group(0)):
            ln = text.count("\n", 0, m.start()) + 1
            out.append(("pure-black-white", "info", ln, m.group(0),
                        "Pure #000/#fff — tint slightly toward the accent for a designed feel."))
            if len(out) >= 6:
                break
    return out


def file_rule_purple_blue_gradient(text, lines):
    out = []
    for m in re.finditer(r"linear-gradient\(([^)]*)\)", text, re.I):
        body = m.group(0)
        hexes = [h.group(0) for h in HEX.finditer(body)]
        rgbs = [_hue_of(h) for h in hexes]
        if any(_is_bluish(c) for c in rgbs) and any(_is_purpleish(c) for c in rgbs):
            ln = text.count("\n", 0, m.start()) + 1
            out.append(("purple-blue-gradient", "warn", ln, body[:80],
                        "Blue→purple gradient — the canonical AI SaaS hero. Use a flat brand color."))
    return out


def file_rule_gray_on_color(text, lines):
    """Heuristic: a rule block sets both a colored background and a gray text color."""
    out = []
    for m in re.finditer(r"\{[^{}]*\}", text):
        block = m.group(0)
        bg = re.search(r"background(?:-color)?\s*:\s*([^;]+)", block, re.I)
        fg = re.search(r"(?<!-)color\s*:\s*([^;]+)", block, re.I)
        if not (bg and fg):
            continue
        bg_hex = HEX.search(bg.group(1))
        fg_hex = HEX.search(fg.group(1))
        if bg_hex and fg_hex:
            if not _is_grayish(_hue_of(bg_hex.group(0))) and _is_grayish(_hue_of(fg_hex.group(0))):
                bgr = _hue_of(bg_hex.group(0))
                if not _is_pure_bw(bg_hex.group(0)) and max(bgr) > 40:
                    ln = text.count("\n", 0, m.start()) + 1
                    out.append(("gray-on-color", "warn", ln, block[:80].replace("\n", " "),
                                "Gray text on a colored background — muddy contrast. Use a tinted fg from the same hue."))
    return out


def file_rule_nested_cards(text, lines):
    """HTML/JSX heuristic: a `card` class/element nested inside another `card`."""
    out = []
    # crude: find class="...card..." occurrences and check bracket depth proximity
    card_lines = [i + 1 for i, l in enumerate(lines)
                  if re.search(r'class(Name)?\s*=\s*["\'][^"\']*\bcard\b', l)]
    if len(card_lines) >= 2:
        # if two card decls appear within 6 lines and indentation increases -> likely nested
        for a, b in zip(card_lines, card_lines[1:]):
            if 0 < b - a <= 6:
                ind_a = len(lines[a - 1]) - len(lines[a - 1].lstrip())
                ind_b = len(lines[b - 1]) - len(lines[b - 1].lstrip())
                if ind_b > ind_a:
                    out.append(("nested-cards", "info", b, lines[b - 1].strip()[:80],
                                "Card nested inside a card — collapse one level; borders-in-borders is clutter."))
    return out


def file_rule_skipped_heading(text, lines):
    out = []
    seq = [(int(m.group(1)), text.count("\n", 0, m.start()) + 1)
           for m in re.finditer(r"<h([1-6])\b", text, re.I)]
    prev = 0
    for level, ln in seq:
        if prev and level > prev + 1:
            out.append(("skipped-heading", "warn", ln, f"<h{level}>",
                        f"Heading jumps h{prev}→h{level} — breaks document outline / a11y."))
        prev = level
    return out


def file_rule_everything_centered(text, lines):
    n = len(re.findall(r"text-align\s*:\s*center", text, re.I))
    n += len(re.findall(r'\btext-center\b', text))  # tailwind
    if n >= 5:
        return [("everything-centered", "info", 0, f"{n} center declarations",
                 f"{n} center-aligned blocks — default-centering flattens hierarchy. Left-align body, center sparingly.")]
    return []


LINE_RULES = [
    ("gradient-text", rule_gradient_text),
    ("bounce-easing", rule_bounce_easing),
    ("layout-transition", rule_layout_transition),
    ("tiny-text", rule_tiny_text),
    ("tight-leading", rule_tight_leading),
    ("wide-tracking", rule_wide_tracking),
    ("justified-text", rule_justified_text),
    ("all-caps-body", rule_allcaps_body),
    ("pill-button", rule_pill_button),
    ("dark-glow", rule_dark_glow),
    ("generic-drop-shadow", rule_generic_drop_shadow),
    ("side-tab", rule_side_tab),
]

FILE_RULES = [
    file_rule_overused_font,
    file_rule_pure_bw,
    file_rule_purple_blue_gradient,
    file_rule_gray_on_color,
    file_rule_nested_cards,
    file_rule_skipped_heading,
    file_rule_everything_centered,
]


def _line_of(lines, needle):
    for i, l in enumerate(lines):
        if needle in l:
            return i + 1
    return None


# ---------------------------------------------------------------------------
# Disable-comment handling
# ---------------------------------------------------------------------------

DISABLE_RE = re.compile(r"slop-disable(?:-next-line)?\s+([a-z0-9 ,\-]+)", re.I)
DISABLE_NEXT_RE = re.compile(r"slop-disable-next-line\s+([a-z0-9 ,\-]+)", re.I)


def disabled_map(lines):
    """Return {line_no: set(rules)} of suppressions; '*' means all."""
    same = {}
    nextline = {}
    for i, l in enumerate(lines):
        m = DISABLE_NEXT_RE.search(l)
        if m:
            rules = {r.strip() for r in re.split(r"[ ,]+", m.group(1)) if r.strip()}
            nextline[i + 2] = rules or {"*"}
            continue
        m = DISABLE_RE.search(l)
        if m:
            rules = {r.strip() for r in re.split(r"[ ,]+", m.group(1)) if r.strip()}
            same[i + 1] = rules or {"*"}
    merged = dict(same)
    for ln, rules in nextline.items():
        merged.setdefault(ln, set()).update(rules)
    return merged


def is_disabled(dmap, line_no, rule):
    rules = dmap.get(line_no)
    if not rules:
        return False
    return "*" in rules or rule in rules


# ---------------------------------------------------------------------------
# Scanning
# ---------------------------------------------------------------------------

def scan_file(path, only_rule=None, ignore=frozenset()):
    try:
        text = open(path, "r", encoding="utf-8", errors="replace").read()
    except OSError:
        return []
    lines = text.split("\n")
    dmap = disabled_map(lines)
    findings = []

    def keep(rule):
        if rule in ignore:
            return False
        if only_rule and rule != only_rule:
            return False
        return True

    for i, line in enumerate(lines, 1):
        if "slop-disable" in line:
            continue
        for rule, fn in LINE_RULES:
            if not keep(rule):
                continue
            res = fn(line)
            if res and not is_disabled(dmap, i, rule):
                sev, msg = res
                findings.append(Finding(rule, sev, i, path, line, msg))

    for fn in FILE_RULES:
        for rule, sev, ln, snippet, msg in fn(text, lines):
            if not keep(rule):
                continue
            if is_disabled(dmap, ln, rule):
                continue
            findings.append(Finding(rule, sev, ln, path, snippet, msg))

    return findings


def walk(paths):
    for p in paths:
        if os.path.isfile(p):
            yield p
        elif os.path.isdir(p):
            for root, dirs, files in os.walk(p):
                dirs[:] = [d for d in dirs if d not in (
                    "node_modules", ".git", "dist", "build", ".next", "vendor", "__pycache__")]
                for f in files:
                    if os.path.splitext(f)[1].lower() in SCAN_EXT:
                        yield os.path.join(root, f)


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

COLOR = {"error": "\033[31m", "warn": "\033[33m", "info": "\033[36m"}
RESET = "\033[0m"


def main(argv=None):
    ap = argparse.ArgumentParser(description="Deterministic design anti-pattern (slop) detector.")
    ap.add_argument("paths", nargs="+", help="files or directories to scan")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--rule", help="run only this rule")
    ap.add_argument("--ignore", action="append", default=[], help="rule id to skip (repeatable)")
    ap.add_argument("--min-severity", choices=("info", "warn", "error"), default="info")
    ap.add_argument("--quiet", action="store_true", help="summary only")
    args = ap.parse_args(argv)

    ignore = set(args.ignore)
    floor = SEVERITY_ORDER[args.min_severity]
    all_findings = []
    for f in walk(args.paths):
        all_findings.extend(scan_file(f, only_rule=args.rule, ignore=ignore))

    shown = [f for f in all_findings if SEVERITY_ORDER[f.severity] >= floor]

    if args.json:
        by_rule = {}
        for f in shown:
            by_rule[f.rule] = by_rule.get(f.rule, 0) + 1
        print(json.dumps({
            "findings": [f.as_dict() for f in shown],
            "count": len(shown),
            "by_rule": by_rule,
        }, indent=2))
        return min(len(shown), 250)

    use_color = sys.stdout.isatty()
    if not shown:
        print("clean — no deterministic slop signals at or above '%s'." % args.min_severity)
        return 0

    if not args.quiet:
        cur = None
        for f in sorted(shown, key=lambda x: (x.file, x.line)):
            if f.file != cur:
                cur = f.file
                print("\n%s" % f.file)
            sev = f.severity.upper()
            if use_color:
                sev = COLOR[f.severity] + sev + RESET
            loc = f":{f.line}" if f.line else ""
            print(f"  {loc:<6} [{f.rule}] {sev}  {f.message}")
            if f.snippet:
                print(f"          ↳ {f.snippet}")

    by_rule = {}
    for f in shown:
        by_rule[f.rule] = by_rule.get(f.rule, 0) + 1
    print("\n%d finding(s) across %d rule(s):" % (len(shown), len(by_rule)))
    for rule, n in sorted(by_rule.items(), key=lambda kv: -kv[1]):
        print(f"  {n:>3}  {rule}")
    print("\nThese are deterministic CLI-layer signals only. Apply the browser- and")
    print("LLM-only layers from references/slop-rules-catalog.md by judgment.")
    return min(len(shown), 250)


if __name__ == "__main__":
    sys.exit(main())
