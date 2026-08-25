#!/usr/bin/env python3
"""
promote.py — candidacy detector + dossier assembly for the podcast-evidence
ledger promotion lifecycle.

Implements the dashed-box stage of the promotion lifecycle described in
"From instrument to pipeline" (main.tex, Figure 8 / \\label{fig:lifecycle}):
ledger pages (built and running, written by ingest.py::write_assertion_ledger)
accumulate evidence; a topic whose ledger evidence crosses a threshold becomes
a *candidate*; candidates are assembled into a *dossier* (a draft integrated
page revision plus full assertion provenance) and passed through the paper's
two-instrument pre-filter — the blind before/after page-judge and the
copy-ceiling-derived answer-completeness gate — before landing as a scored
proposal in `proposals/` for a later thin adapter to submit via
ontology_propose. Rejects are recorded, never silently dropped.

Status per the paper's own register: the ledger stage this script reads is
*built and running*; the two-instrument pre-filter and dossier assembly this
script implements are *designed, with both instruments individually
validated* — this script is the first wiring of the two into one pipeline
stage, run here against sandboxed fixtures rather than the live graph.

Usage:
    python3 promote.py --pages-dir DIR --proposals-dir DIR [options]
    python3 promote.py --pages-dir .sandbox/pages --proposals-dir .sandbox/proposals --dry-run
    python3 promote.py --pages-dir .sandbox/pages --proposals-dir .sandbox/proposals --limit 3

See PROMOTE.md for the full ledger-format assumptions, dossier JSON/MD shape,
the ontology_propose adapter contract, and threshold rationale.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import sys
import textwrap
import urllib.error
import urllib.request
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants — mirrors ingest.py / common.py / judge.py conventions exactly so
# this stage reads the real ledger format and reuses the validated splice and
# judge protocols rather than reinventing them.
# ---------------------------------------------------------------------------

LEDGER_GLOB = "podcast-evidence___*.md"
LEDGER_FP_RE = re.compile(r'<!--\s*assertion-fp:\s*([0-9a-f]+)\s*-->')
WIKILINK_RE = re.compile(r'\[\[([^\]]+)\]\]')
BULLET_RE = re.compile(
    r'^- (?:\*\*\[[^\]]+\]\*\*\s*)?(?P<claim_and_links>.+?)\n'
    r'((?:  [a-zA-Z0-9_-]+:: .*\n?)+)'
    r'(?:  <!-- assertion-fp:\s*(?P<fp>[0-9a-f]+)\s*-->\n?)?',
    re.MULTILINE,
)
PROP_LINE_RE = re.compile(r'^  ([a-zA-Z0-9_-]+):: (.*)$', re.MULTILINE)

DEFAULT_LOOM_URL = "http://192.168.2.132:8084/v1"
DEFAULT_LOOM_MODEL = "qwen3.8-27b"
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
GEMINI_MODEL = "gemini-3.1-pro-preview"

HEADING_RE = re.compile(r'^-\s+#{1,6}\s+.+$', re.MULTILINE)
STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "into", "have",
    "has", "been", "were", "are", "was", "will", "would", "could", "should",
    "their", "they", "them", "which", "when", "what", "than", "then", "also",
    "such", "these", "those", "over", "more", "some", "even", "just", "like",
}


# ---------------------------------------------------------------------------
# 1. Ledger parsing
# ---------------------------------------------------------------------------

@dataclass
class Assertion:
    claim: str
    topics: list[str]
    tier: str
    confidence: str
    source: str
    fp: str
    episode_slug: str
    ledger_file: str
    claim_date: str = ""
    evidence: str = ""


def episode_slug_from_ledger(path: Path) -> str:
    """Episode identity per ingest.py::_ledger_page_path: the filename stem
    after the `podcast-evidence___` prefix IS the episode slug."""
    stem = path.stem
    prefix = "podcast-evidence___"
    return stem[len(prefix):] if stem.startswith(prefix) else stem


def parse_ledger_page(path: Path) -> list[Assertion]:
    """Parse one podcast-evidence___<episode-slug>.md ledger page into
    Assertion records, following ingest.py::_build_ledger_bullet's exact
    bullet shape:

        - [**[Tier label]** ]<claim text> [[Topic]] [[Topic2]]
          tier:: N
          confidence:: F
          source:: S
          claim-date:: D
          [evidence:: E]
          <!-- assertion-fp: HEX -->
    """
    text = path.read_text(errors="replace")
    episode_slug = episode_slug_from_ledger(path)
    out: list[Assertion] = []

    # Split on top-level bullet starts (lines beginning with "- ") so each
    # chunk is one bullet block, including its indented `  key:: value` and
    # fingerprint-comment sub-lines.
    lines = text.split("\n")
    blocks: list[list[str]] = []
    for line in lines:
        if line.startswith("- "):
            blocks.append([line])
        elif blocks and (line.startswith("  ") or line.strip() == ""):
            blocks[-1].append(line)

    for block in blocks:
        first = block[0]
        rest = "\n".join(block[1:])

        fp_match = LEDGER_FP_RE.search(rest)
        if not fp_match:
            continue  # not an assertion bullet (e.g. a stray page-level bullet)
        fp = fp_match.group(1)

        topics = WIKILINK_RE.findall(first)
        claim = WIKILINK_RE.sub("", first[2:]).strip()
        claim = re.sub(r'\*\*\[[^\]]+\]\*\*\s*', '', claim).strip()

        props: dict[str, str] = {}
        for pm in PROP_LINE_RE.finditer(rest):
            key, val = pm.group(1), pm.group(2).strip()
            props[key] = val

        if not topics:
            continue  # unmatched-topic assertions carry no wikilink; not
            # candidate-eligible for this topic-grouped stage

        out.append(Assertion(
            claim=claim,
            topics=topics,
            tier=props.get("tier", ""),
            confidence=props.get("confidence", ""),
            source=props.get("source", ""),
            fp=fp,
            episode_slug=episode_slug,
            ledger_file=path.name,
            claim_date=props.get("claim-date", ""),
            evidence=props.get("evidence", ""),
        ))
    return out


def load_all_assertions(pages_dir: Path) -> list[Assertion]:
    out: list[Assertion] = []
    for p in sorted(pages_dir.glob(LEDGER_GLOB)):
        out.extend(parse_ledger_page(p))
    return out


def group_by_topic(assertions: list[Assertion]) -> dict[str, list[Assertion]]:
    by_topic: dict[str, list[Assertion]] = defaultdict(list)
    for a in assertions:
        for t in a.topics:
            by_topic[t].append(a)
    return by_topic


# ---------------------------------------------------------------------------
# 2. Candidacy detection
# ---------------------------------------------------------------------------

@dataclass
class Candidate:
    topic: str
    assertions: list[Assertion]

    @property
    def episodes(self) -> set[str]:
        return {a.episode_slug for a in self.assertions}

    @property
    def fingerprints(self) -> frozenset[str]:
        return frozenset(a.fp for a in self.assertions)

    def slug(self) -> str:
        s = self.topic.lower().replace(" ", "-")
        cleaned = re.sub(r"[^\w-]", "", s)
        if cleaned == s and len(cleaned) <= 80:
            return cleaned
        # Lossy sanitisation (stripped chars or truncation) can collide two
        # distinct topics onto one dossier filename — disambiguate with a
        # stable topic digest.
        digest = hashlib.sha256(self.topic.encode()).hexdigest()[:8]
        return (cleaned[:80] + "-" + digest) if cleaned else digest


def target_page_name(topic: str) -> str:
    """Topic pages are named `<Topic>.md` verbatim, but a path separator in a
    topic (e.g. `AI/ML`) must not escape pages-dir into a subpath."""
    return re.sub(r"[/\\]", "_", topic) + ".md"


def find_candidates(pages_dir: Path, min_assertions: int, min_episodes: int) -> list[Candidate]:
    assertions = load_all_assertions(pages_dir)
    by_topic = group_by_topic(assertions)
    candidates = []
    for topic, items in by_topic.items():
        episodes = {a.episode_slug for a in items}
        if len(items) >= min_assertions and len(episodes) >= min_episodes:
            candidates.append(Candidate(topic=topic, assertions=items))
    candidates.sort(key=lambda c: (-len(c.assertions), c.topic))
    return candidates


# ---------------------------------------------------------------------------
# 3. Dossier assembly — one Loom call producing a JSON splice edit
# ---------------------------------------------------------------------------

def extract_splice_json(text: str) -> dict | None:
    """Adapted from page-judge/common.py::extract_splice_json (validated
    fail-closed JSON extraction for the {mode, anchor, content} splice
    contract). Reimplemented locally — the skill must be self-contained and
    not depend on an ephemeral scratchpad path."""
    text = text.strip()
    fence = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if fence:
        text = fence.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find('{')
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                candidate = text[start:i + 1]
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    fixed = re.sub(r',\s*([}\]])', r'\1', candidate)
                    try:
                        return json.loads(fixed)
                    except json.JSONDecodeError:
                        return None
    return None


class SpliceError(Exception):
    pass


def apply_splice(original: str, edit: dict) -> str:
    """Fail-closed splice application — adapted verbatim from
    page-judge/common.py::apply_splice. Raises SpliceError (never silently
    corrupts the page) if the anchor is missing/ambiguous or the edit cannot
    be verified to preserve the rest of the page byte-for-byte."""
    mode = edit.get("mode")
    anchor = edit.get("anchor")
    content = edit.get("content")
    if mode not in ("insert_after", "replace_section"):
        raise SpliceError(f"unknown mode: {mode!r}")
    if not anchor or not isinstance(anchor, str):
        raise SpliceError("missing/empty anchor")
    if content is None or not isinstance(content, str):
        raise SpliceError("missing/empty content")

    count = original.count(anchor)
    if count == 0:
        raise SpliceError(f"anchor not found verbatim: {anchor!r}")
    if count > 1:
        raise SpliceError(f"anchor is ambiguous ({count} occurrences): {anchor!r}")

    anchor_start = original.index(anchor)
    anchor_end = anchor_start + len(anchor)

    if mode == "insert_after":
        line_end = original.find("\n", anchor_end)
        insert_at = line_end + 1 if line_end != -1 else len(original)
        new_text = original[:insert_at] + content.rstrip("\n") + "\n" + original[insert_at:]
        if not (new_text.startswith(original[:insert_at]) and new_text.endswith(original[insert_at:])):
            raise SpliceError("insert_after failed preservation check")
        return new_text

    line_start = original.rfind("\n", 0, anchor_start) + 1
    next_heading = HEADING_RE.search(original, anchor_end)
    section_end = next_heading.start() if next_heading else len(original)
    before = original[:line_start]
    after = original[section_end:]
    new_content = content if content.endswith("\n") else content + "\n"
    new_text = before + new_content + after
    if not (new_text.startswith(before) and new_text.endswith(after)):
        raise SpliceError("replace_section failed preservation check")
    return new_text


def clean_loom_response(text: str) -> str:
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()
    fence = re.match(r'^```(?:json)?\n(.*)\n```$', text, re.DOTALL)
    if fence:
        text = fence.group(1)
    return text


DOSSIER_SYSTEM_PROMPT = (
    "You are a knowledge-base editing assistant integrating verified podcast "
    "evidence into an existing wiki page. Return ONLY a strict JSON object "
    "of the shape {\"mode\": \"insert_after\"|\"replace_section\", "
    "\"anchor\": <verbatim substring of the CURRENT PAGE to anchor on>, "
    "\"content\": <the new/replacement markdown text>}. The anchor must "
    "appear EXACTLY ONCE, character-for-character, in the current page. "
    "Do not rewrite or reformat any text outside your inserted/replaced "
    "content. No markdown fencing, no commentary — JSON only."
)


def build_dossier_prompt(topic: str, page_text: str, assertions: list[Assertion]) -> str:
    facts = []
    for a in assertions:
        line = f"- {a.claim}"
        if a.evidence and a.evidence != a.claim:
            line += f" ({a.evidence})"
        line += f" [source: {a.source}, confidence {a.confidence}, tier {a.tier}]"
        facts.append(line)
    facts_block = "\n".join(facts)

    return f"""Page topic: {topic}

=== CURRENT PAGE ===
{page_text}
=== END CURRENT PAGE ===

New verified evidence to integrate, drawn from podcast-evidence ledger pages
(each already fingerprinted and source-attributed):
{facts_block}

Produce a JSON splice edit that integrates this evidence into the page as a
new or extended section (e.g. "### Recent Developments" or an existing
comparable heading). Preserve everything else on the page unchanged. Pick an
anchor that is unambiguous (appears exactly once) in CURRENT PAGE.
"""


def call_loom(prompt: str, loom_url: str, model: str, timeout: int = 300,
               max_tokens: int = 4096) -> str | None:
    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": DOSSIER_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": max_tokens,
        "loom_options": {"verbatim": False},
    }).encode()
    req = urllib.request.Request(
        f"{loom_url.rstrip('/')}/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read())
            return body["choices"][0]["message"]["content"]
    except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError, IndexError) as e:
        print(f"    [loom] error: {e}", file=sys.stderr)
        return None


def check_loom_reachable(loom_url: str, timeout: int = 5) -> bool:
    health_url = loom_url.rstrip("/")
    if health_url.endswith("/v1"):
        health_url = health_url[: -len("/v1")]
    health_url += "/health"
    try:
        with urllib.request.urlopen(health_url, timeout=timeout) as resp:
            body = json.loads(resp.read())
            return bool(body.get("ok", True))
    except Exception as e:
        print(f"  [loom] health check failed at {health_url}: {e}", file=sys.stderr)
        return False


@dataclass
class DraftResult:
    ok: bool
    spliced_text: str | None = None
    edit: dict | None = None
    error: str | None = None


def assemble_draft(topic: str, page_text: str, assertions: list[Assertion],
                    loom_url: str, loom_model: str) -> DraftResult:
    prompt = build_dossier_prompt(topic, page_text, assertions)
    raw = call_loom(prompt, loom_url, loom_model)
    if raw is None:
        return DraftResult(ok=False, error="loom_unreachable_or_error")

    cleaned = clean_loom_response(raw)
    edit = extract_splice_json(cleaned)
    if edit is None:
        return DraftResult(ok=False, error=f"malformed_splice_json: {cleaned[:300]!r}")

    try:
        spliced = apply_splice(page_text, edit)
    except SpliceError as e:
        return DraftResult(ok=False, error=f"splice_validation_failed: {e}")

    return DraftResult(ok=True, spliced_text=spliced, edit=edit)


# ---------------------------------------------------------------------------
# 4a. Blind before/after judge — page-judge protocol, primary (Gemini) only,
#     rubric-A and rubric-B, adapted from page-judge/judge.py.
# ---------------------------------------------------------------------------

RUBRIC_A_PROMPT = """You are evaluating two versions of a knowledge-base wiki page on a
technology/AI topic. You do not know how these versions were produced or what
process created them — just read them as a reader would and judge quality.

Page topic: {topic}

=== VERSION A ===
{version_a}
=== END VERSION A ===

=== VERSION B ===
{version_b}
=== END VERSION B ===

Score VERSION B RELATIVE TO VERSION A on this rubric. For each numeric field,
score VERSION B's absolute quality (0-5, 5 best); "improvement" should reflect
whether B is better or worse than A specifically.

Return STRICT JSON only, no markdown fencing, no commentary, matching exactly
this shape:
{{
  "factual_grounding": <0-5 integer, VERSION B's factual grounding/specificity>,
  "relevance": <0-5 integer, VERSION B's relevance/focus on the page topic>,
  "coherence": <0-5 integer, VERSION B's internal coherence and readability>,
  "better_version": "A" | "B" | "tie",
  "improvement": <integer -2..2, how much better (positive) or worse (negative)
                  VERSION B is compared to VERSION A overall>
}}

Return ONLY the JSON object."""

RUBRIC_B_PROMPT = """You are evaluating two versions of a knowledge-base wiki page on a
technology/AI topic. You do not know how these versions were produced or what
process created them — just read them as a reader would.

Page topic: {topic}

=== VERSION A ===
{version_a}
=== END VERSION A ===

=== VERSION B ===
{version_b}
=== END VERSION B ===

A reader consults this page to get current, accurate knowledge of the
topic. Which version better serves that reader? Weigh informativeness and
currency of content alongside prose quality — a page that omits significant
recent developments serves the reader worse, and new content is valuable
when accurate and relevant, though it must still be well-integrated.

Score VERSION B RELATIVE TO VERSION A on this rubric. For each numeric field,
score VERSION B's absolute quality (0-5, 5 best); "improvement" should reflect
whether B is better or worse than A specifically for that reader.

Return STRICT JSON only, no markdown fencing, no commentary, matching exactly
this shape:
{{
  "factual_grounding": <0-5 integer, VERSION B's factual grounding/specificity>,
  "relevance": <0-5 integer, VERSION B's relevance/focus on the page topic,
                 including whether it covers what a reader would currently
                 want to know>,
  "coherence": <0-5 integer, VERSION B's internal coherence and readability>,
  "better_version": "A" | "B" | "tie",
  "improvement": <integer -2..2, how much better (positive) or worse (negative)
                  VERSION B serves a reader seeking current, accurate
                  knowledge, compared to VERSION A>
}}

Return ONLY the JSON object."""

MAX_JUDGE_CHARS = 6000


def _judge_windows(before: str, after: str, max_chars: int = MAX_JUDGE_CHARS) -> tuple[str, str]:
    """Comparable excerpts of before/after that always contain the edit.

    Naive head-truncation auto-rejected every page longer than max_chars: the
    splice sat beyond the cut, so the judge saw before == after, improvement
    0, and the strict rubric-B `> 0` gate failed. Instead, locate the first
    divergence point and window both versions from the same (shared-prefix)
    start offset, so the change is visible and the two excerpts stay
    positionally comparable.
    """
    if len(before) <= max_chars and len(after) <= max_chars:
        return before, after
    limit = min(len(before), len(after))
    p = 0
    while p < limit and before[p] == after[p]:
        p += 1
    start = max(0, p - max_chars // 3)
    # Snap back to a line start (still inside the common prefix) so neither
    # excerpt opens mid-word.
    start = before.rfind("\n", 0, start) + 1
    return before[start:start + max_chars], after[start:start + max_chars]


def _item_seed(seed: int, topic: str, rubric: str) -> int:
    h = hashlib.sha256(f"{seed}|{topic}|{rubric}".encode()).hexdigest()
    return int(h[:8], 16)


def extract_judge_json(text: str) -> dict | None:
    obj = extract_splice_json(text)  # identical fail-closed brace-matching logic
    # Gemini occasionally wraps the verdict object in a one-element JSON array
    # (observed live 2026-08-25, topic nvidia-h200) — unwrap that shape only;
    # any other non-dict result stays a fail-closed None.
    if isinstance(obj, list) and len(obj) == 1 and isinstance(obj[0], dict):
        return obj[0]
    return obj if isinstance(obj, dict) else None


def run_gemini_judge(prompt: str, api_key: str, timeout: int = 120) -> str | None:
    payload = json.dumps({
        "model": GEMINI_MODEL,
        "messages": [
            {"role": "system", "content": "You are a strict JSON-only evaluation assistant."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.0,
        # 1024 truncated rubric-B JSON mid-object on large before/after pages
        # (first live run, topic 'anthropic') — the estate-wide lesson is
        # max_tokens >= 1536 for judge/reasoning calls.
        "max_tokens": 2048,
        "response_format": {"type": "json_object"},
    }).encode()
    req = urllib.request.Request(
        f"{GEMINI_BASE_URL}/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = json.loads(resp.read())
                return body["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            err_body = e.read().decode(errors="replace")
            print(f"    [judge] gemini HTTP {e.code} (attempt {attempt + 1}/3): {err_body[:300]}", file=sys.stderr)
            if e.code == 429 or e.code >= 500:
                continue
            return None
        except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError) as e:
            print(f"    [judge] gemini error (attempt {attempt + 1}/3): {e}", file=sys.stderr)
    return None


@dataclass
class JudgeResult:
    ok: bool
    rubric_a_improvement: float | None = None
    rubric_b_improvement: float | None = None
    raw_a: dict | None = None
    raw_b: dict | None = None
    error: str | None = None


def judge_before_after(topic: str, before: str, after: str, seed: int) -> JudgeResult:
    """Blind A/B judge, primary (Gemini 3.1 Pro, temperature 0) only, both
    rubrics. Position of before/after is randomised per-topic/per-rubric
    (seeded, reproducible) so the judge cannot infer draft-vs-original from
    ordering; sign is un-blinded after scoring so "improvement" always means
    'after relative to before' regardless of which slot the judge saw it in."""
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return JudgeResult(ok=False, error="GOOGLE_API_KEY not set — judge skipped (fail-closed)")

    before_w, after_w = _judge_windows(before, after)
    results: dict[str, float] = {}
    raws: dict[str, dict] = {}
    for rubric_name, rubric_template in (("a", RUBRIC_A_PROMPT), ("b", RUBRIC_B_PROMPT)):
        rng = random.Random(_item_seed(seed, topic, rubric_name))
        swap = rng.random() < 0.5
        if swap:
            version_a, version_a_label = after_w, "after"
            version_b, version_b_label = before_w, "before"
        else:
            version_a, version_a_label = before_w, "before"
            version_b, version_b_label = after_w, "after"

        prompt = rubric_template.format(topic=topic, version_a=version_a, version_b=version_b)
        raw = run_gemini_judge(prompt, api_key)
        if raw is None:
            return JudgeResult(ok=False, error=f"gemini_call_failed(rubric_{rubric_name})")

        parsed = extract_judge_json(raw)
        if not isinstance(parsed, dict):
            return JudgeResult(ok=False, error=f"malformed_judge_json(rubric_{rubric_name}): {raw[:300]!r}")

        raws[rubric_name] = parsed
        improvement = parsed.get("improvement")
        if not isinstance(improvement, (int, float)):
            return JudgeResult(ok=False, error=f"missing_improvement_field(rubric_{rubric_name})")
        # un-blind: improvement is "version_b minus version_a"; we want
        # "after minus before" always.
        if version_b_label == "after":
            results[rubric_name] = float(improvement)
        else:
            results[rubric_name] = -float(improvement)

    return JudgeResult(ok=True, rubric_a_improvement=results["a"], rubric_b_improvement=results["b"],
                        raw_a=raws["a"], raw_b=raws["b"])


# ---------------------------------------------------------------------------
# 4b. Answer-completeness gate — simplified single-topic lexical matcher,
#     adapted from the copy-ceiling matcher in main.tex \S\ref{sec:ceiling}
#     and the T-REL/T-TAX templating in loom/tools/paper/ontology_scaffold_v1.py.
#
#     SIMPLIFICATION vs the paper's full method (documented in PROMOTE.md):
#     the paper templates formal questions from ontology relation/taxonomy
#     edges (T-REL/T-TAX/T-COMMON) against a graph schema and scores whether
#     the *shown scaffold text* names the gold {slug,title} answer. This
#     stage has no formal relation edges to template from — its "gold" is
#     the set of ledger assertion claims for the candidate topic, and its
#     "shown context" is the drafted splice `content` alone (not the whole
#     page). Completeness = fraction of assertions whose normalised claim,
#     or >=80% of its length->=4 long words, appears verbatim in the
#     drafted section — i.e. the same matcher rule, applied to assertion
#     claims as gold targets instead of formal-relation answer strings.
# ---------------------------------------------------------------------------

def _normalize(text: str) -> str:
    return re.sub(r'\s+', ' ', re.sub(r'[^\w\s]', ' ', text.lower())).strip()


def _long_words(text: str) -> list[str]:
    return [w for w in _normalize(text).split() if len(w) >= 4 and w not in STOPWORDS]


def matches_gold(gold_claim: str, shown_text: str) -> bool:
    """Deterministic surface matcher — mirrors main.tex \\S\\ref{sec:ceiling}:
    normalised gold claim appears in shown text, OR >=80% of its length>=4
    words appear as whole tokens in shown text. Whole-token membership (not
    substring: `cost` must not hit `costly`) keeps the score honest as a
    COVERAGE instrument — it is bag-of-words, negation/order-blind, and must
    never be read as a correctness check."""
    norm_shown = _normalize(shown_text)
    norm_gold = _normalize(gold_claim)
    if norm_gold and norm_gold in norm_shown:
        return True
    words = _long_words(gold_claim)
    if not words:
        return False
    shown_words = set(norm_shown.split())
    hits = sum(1 for w in words if w in shown_words)
    return (hits / len(words)) >= 0.80


def completeness_score(assertions: list[Assertion], spliced_content: str) -> tuple[float, list[dict]]:
    detail = []
    hit = 0
    for a in assertions:
        matched = matches_gold(a.claim, spliced_content)
        if matched:
            hit += 1
        detail.append({"fp": a.fp, "claim": a.claim[:120], "matched": matched})
    score = hit / len(assertions) if assertions else 0.0
    return score, detail


# ---------------------------------------------------------------------------
# 5. Dossier IO — proposals/ and rejects/, idempotency via fingerprint sets
# ---------------------------------------------------------------------------

def load_processed_fingerprint_sets(proposals_dir: Path, rejects_dir: Path) -> dict[str, frozenset[str]]:
    """Map topic-slug -> the fingerprint set it was last dossiered/rejected
    with, so re-runs can detect 'nothing new' vs 'refresh needed'.

    `candidate_deferred` dossiers (instrument/infra unavailable, target page
    missing) are deliberately excluded: recording their fingerprints would
    make a transient judge/Loom outage permanently bury the candidate as
    "unchanged". Deferred topics stay retry-eligible on every run."""
    out: dict[str, frozenset[str]] = {}
    for d in (proposals_dir, rejects_dir):
        if not d.exists():
            continue
        for f in d.glob("*.json"):
            try:
                data = json.loads(f.read_text())
            except json.JSONDecodeError:
                continue
            if data.get("status") == "candidate_deferred":
                continue
            slug = data.get("topic_slug")
            fps = data.get("assertion_fingerprints")
            if slug and isinstance(fps, list):
                out[slug] = frozenset(fps)
    return out


def clear_slug_outputs(slug: str, *dirs: Path) -> None:
    """Remove any prior dossier files for this slug before writing the new
    one — a candidate moving proposals<->rejects must not leave a stale twin
    whose fingerprint set could later trigger a false 'unchanged' skip."""
    for d in dirs:
        for ext in (".json", ".md"):
            f = d / f"{slug}{ext}"
            if f.exists():
                f.unlink()


def write_dossier_json(path: Path, candidate: Candidate, draft: DraftResult,
                        judge: JudgeResult | None, completeness: float,
                        completeness_detail: list[dict], status: str,
                        reasons: list[str], target_page_rel: str) -> dict:
    data = {
        "topic": candidate.topic,
        "topic_slug": candidate.slug(),
        "status": status,  # "candidate_survivor" | "candidate_rejected" | "candidate_deferred"
        "reasons": reasons,
        "n_assertions": len(candidate.assertions),
        "episodes": sorted(candidate.episodes),
        "assertion_fingerprints": sorted(candidate.fingerprints),
        "target_page": target_page_rel,
        "assertions": [
            {
                "claim": a.claim, "tier": a.tier, "confidence": a.confidence,
                "source": a.source, "episode": a.episode_slug,
                "claim_date": a.claim_date, "evidence": a.evidence, "fp": a.fp,
            }
            for a in candidate.assertions
        ],
        "draft": {
            "ok": draft.ok,
            "error": draft.error,
            "edit": draft.edit,
        },
        "judge": None,
        "completeness": {
            "score": completeness,
            "detail": completeness_detail,
        },
        # Shaped for the thin ontology_propose adapter — see PROMOTE.md
        # "Intended ontology_propose adapter contract".
        "ontology_propose_payload": None,
    }
    if judge is not None:
        data["judge"] = {
            "ok": judge.ok,
            "error": judge.error,
            "rubric_a_improvement": judge.rubric_a_improvement,
            "rubric_b_improvement": judge.rubric_b_improvement,
            "raw_a": judge.raw_a,
            "raw_b": judge.raw_b,
        }
    if status == "candidate_survivor" and draft.ok:
        data["ontology_propose_payload"] = {
            "target_page": target_page_rel,
            "edit": draft.edit,
            "provenance": {
                "assertion_fingerprints": sorted(candidate.fingerprints),
                "source_episodes": sorted(candidate.episodes),
            },
            "scores": {
                "rubric_a_improvement": judge.rubric_a_improvement if judge else None,
                "rubric_b_improvement": judge.rubric_b_improvement if judge else None,
                "completeness": completeness,
            },
        }
    path.write_text(json.dumps(data, indent=2))
    return data


def write_dossier_md(path: Path, data: dict) -> None:
    lines = [f"# Dossier: {data['topic']}", ""]
    lines.append(f"- status: `{data['status']}`")
    lines.append(f"- target page: `{data['target_page']}`")
    lines.append(f"- assertions: {data['n_assertions']} across episodes: {', '.join(data['episodes'])}")
    if data["reasons"]:
        lines.append(f"- reasons: {'; '.join(data['reasons'])}")
    lines.append("")
    lines.append("## Scores")
    j = data.get("judge") or {}
    lines.append(f"- judge ok: {j.get('ok')}  error: {j.get('error')}")
    lines.append(f"- rubric-A improvement (after vs before): {j.get('rubric_a_improvement')}")
    lines.append(f"- rubric-B improvement (after vs before): {j.get('rubric_b_improvement')}")
    lines.append(f"- answer-completeness: {data['completeness']['score']:.2f}")
    lines.append("")
    lines.append("## Assertions")
    for a in data["assertions"]:
        lines.append(f"- **{a['claim']}**")
        lines.append(f"  - tier {a['tier']}, confidence {a['confidence']}, source {a['source']}, "
                      f"episode `{a['episode']}`, fp `{a['fp']}`")
    lines.append("")
    if data["draft"]["ok"]:
        lines.append("## Draft splice edit")
        lines.append("```json")
        lines.append(json.dumps(data["draft"]["edit"], indent=2))
        lines.append("```")
    else:
        lines.append(f"## Draft failed: {data['draft']['error']}")
    path.write_text("\n".join(lines) + "\n")


# ---------------------------------------------------------------------------
# 6. Main pipeline
# ---------------------------------------------------------------------------

def run(args: argparse.Namespace) -> int:
    pages_dir = Path(args.pages_dir).resolve()
    proposals_dir = Path(args.proposals_dir).resolve()
    rejects_dir = proposals_dir.parent / "rejects" if args.rejects_dir is None else Path(args.rejects_dir).resolve()

    if not pages_dir.exists():
        print(f"pages-dir does not exist: {pages_dir}", file=sys.stderr)
        return 2

    candidates = find_candidates(pages_dir, args.min_assertions, args.min_episodes)
    print(f"Scanned {pages_dir} — {len(candidates)} candidate topic(s) found "
          f"(>= {args.min_assertions} assertions, >= {args.min_episodes} episodes).")
    for c in candidates:
        print(f"  - {c.topic!r}: {len(c.assertions)} assertions across {len(c.episodes)} episode(s) "
              f"({', '.join(sorted(c.episodes))})")

    if args.dry_run:
        print("\n[DRY RUN] stopping before dossier assembly / Loom calls / judge calls.")
        return 0

    if not candidates:
        return 0

    proposals_dir.mkdir(parents=True, exist_ok=True)
    rejects_dir.mkdir(parents=True, exist_ok=True)
    processed = load_processed_fingerprint_sets(proposals_dir, rejects_dir)

    loom_reachable = check_loom_reachable(args.loom_url)
    print(f"\nLoom reachability ({args.loom_url}): {'OK' if loom_reachable else 'UNREACHABLE'}")
    if not os.environ.get("GOOGLE_API_KEY"):
        print("GOOGLE_API_KEY not set — judge step will fail-closed per candidate (logged, not crashed).")

    n_processed = 0
    for candidate in candidates:
        if args.limit is not None and n_processed >= args.limit:
            break

        slug = candidate.slug()
        prior_fps = processed.get(slug)
        if prior_fps is not None and prior_fps == candidate.fingerprints:
            print(f"\n[{slug}] unchanged since last run (same fingerprint set) — skipping.")
            continue
        elif prior_fps is not None:
            print(f"\n[{slug}] fingerprint set changed since last run "
                  f"({len(prior_fps)} -> {len(candidate.fingerprints)}) — refreshing.")

        n_processed += 1
        print(f"\n[{slug}] assembling dossier: {len(candidate.assertions)} assertions, "
              f"{len(candidate.episodes)} episodes")

        # Cap the material handed to draft + completeness. Splicing a hundred+
        # assertions into one section is unintegrable by construction — the
        # first live run (2026-08-25) showed the three largest topics drafting
        # at completeness 0.02–0.28 and judging at -2.0. Select the strongest
        # evidence (confidence desc, then recency); the candidate's FULL
        # fingerprint set still drives idempotency, so new evidence anywhere
        # in the topic reopens it.
        def _conf_float(v):
            try:
                return float(v)
            except (TypeError, ValueError):
                return 0.0

        dossier_assertions = candidate.assertions
        if args.max_dossier_assertions and len(dossier_assertions) > args.max_dossier_assertions:
            dossier_assertions = sorted(
                dossier_assertions,
                key=lambda a: (-_conf_float(a.confidence), a.claim_date or "", a.fp),
            )[: args.max_dossier_assertions]
            print(f"  capped to {len(dossier_assertions)} strongest assertions for the dossier "
                  f"(--max-dossier-assertions {args.max_dossier_assertions})")

        target_page = pages_dir / target_page_name(candidate.topic)
        reasons: list[str] = []

        # Instrument/infra failures below are recorded as `candidate_deferred`
        # (never silently dropped) but do NOT bank the fingerprint set — a
        # transient outage must not permanently bury a candidate. Only
        # measured quality-threshold failures become terminal rejects.
        if not target_page.exists():
            reasons.append(f"no_target_page: {target_page.name} does not exist in pages-dir")
            clear_slug_outputs(slug, proposals_dir, rejects_dir)
            data = write_dossier_json(
                rejects_dir / f"{slug}.json", candidate, DraftResult(ok=False, error="no_target_page"),
                None, 0.0, [], "candidate_deferred", reasons, str(target_page.name),
            )
            write_dossier_md(rejects_dir / f"{slug}.md", data)
            print(f"  DEFER [{slug}]: no target page — recorded in rejects/, retry-eligible")
            continue

        page_text = target_page.read_text(errors="replace")

        if not loom_reachable:
            reasons.append("loom_unreachable")
            clear_slug_outputs(slug, proposals_dir, rejects_dir)
            data = write_dossier_json(
                rejects_dir / f"{slug}.json", candidate, DraftResult(ok=False, error="loom_unreachable"),
                None, 0.0, [], "candidate_deferred", reasons, str(target_page.relative_to(pages_dir)),
            )
            write_dossier_md(rejects_dir / f"{slug}.md", data)
            print(f"  DEFER [{slug}]: Loom unreachable — recorded in rejects/, retry-eligible")
            continue

        draft = assemble_draft(candidate.topic, page_text, dossier_assertions, args.loom_url, args.loom_model)
        if not draft.ok:
            reasons.append(f"draft_failed: {draft.error}")
            clear_slug_outputs(slug, proposals_dir, rejects_dir)
            data = write_dossier_json(
                rejects_dir / f"{slug}.json", candidate, draft, None, 0.0, [],
                "candidate_deferred", reasons, str(target_page.relative_to(pages_dir)),
            )
            write_dossier_md(rejects_dir / f"{slug}.md", data)
            print(f"  DEFER [{slug}]: draft assembly failed — {draft.error} (retry-eligible)")
            continue

        print(f"  draft OK ({draft.edit['mode']}, anchor {draft.edit['anchor'][:60]!r}...)")

        completeness, completeness_detail = completeness_score(dossier_assertions, draft.edit["content"])
        print(f"  completeness: {completeness:.2f}")

        judge = judge_before_after(candidate.topic, page_text, draft.spliced_text, args.judge_seed)
        if judge.ok:
            print(f"  judge: rubric-A improvement={judge.rubric_a_improvement}  "
                  f"rubric-B improvement={judge.rubric_b_improvement}")
        else:
            print(f"  judge: FAILED/SKIPPED — {judge.error}")

        if not judge.ok:
            # Judge infra unavailable — a distinct, retryable outcome, not a
            # quality verdict on the candidate.
            reasons.append(f"judge_unavailable: {judge.error}")
            clear_slug_outputs(slug, proposals_dir, rejects_dir)
            data = write_dossier_json(
                rejects_dir / f"{slug}.json", candidate, draft, judge, completeness,
                completeness_detail, "candidate_deferred", reasons,
                str(target_page.relative_to(pages_dir)),
            )
            write_dossier_md(rejects_dir / f"{slug}.md", data)
            print(f"  DEFER [{slug}]: judge unavailable — {judge.error} (retry-eligible)")
            continue

        survive = True
        if not (judge.rubric_b_improvement is not None and judge.rubric_b_improvement > args.judge_b_min):
            survive = False
            reasons.append(f"rubric_b_improvement {judge.rubric_b_improvement} <= {args.judge_b_min}")
        if not (judge.rubric_a_improvement is not None and judge.rubric_a_improvement >= args.judge_a_min):
            survive = False
            reasons.append(f"rubric_a_improvement {judge.rubric_a_improvement} < {args.judge_a_min}")
        if completeness < args.completeness_min:
            survive = False
            reasons.append(f"completeness {completeness:.2f} < {args.completeness_min}")

        status = "candidate_survivor" if survive else "candidate_rejected"
        out_dir = proposals_dir if survive else rejects_dir
        clear_slug_outputs(slug, proposals_dir, rejects_dir)
        data = write_dossier_json(
            out_dir / f"{slug}.json", candidate, draft, judge, completeness, completeness_detail,
            status, reasons, str(target_page.relative_to(pages_dir)),
        )
        write_dossier_md(out_dir / f"{slug}.md", data)

        if survive:
            print(f"  SURVIVOR [{slug}] -> {out_dir / (slug + '.json')}")
        else:
            print(f"  REJECT [{slug}] ({'; '.join(reasons)}) -> {out_dir / (slug + '.json')}")
            if args.working_graph_dir:
                wg_path = write_working_page(Path(args.working_graph_dir), data)
                print(f"  news page -> {wg_path}")

    return 0


def write_working_page(working_dir: Path, data: dict) -> Path:
    """Rejected-from-ontology != worthless: land the processed news as a
    Logseq page in the working graph. Overwritten on each refresh of the
    topic's dossier (same idempotency cycle as the dossier itself); the
    curated main graph is never touched by this path."""
    working_dir.mkdir(parents=True, exist_ok=True)
    topic = data["topic"]
    draft_content = ""
    if data.get("draft", {}).get("ok") and data["draft"].get("edit"):
        draft_content = textwrap.dedent(data["draft"]["edit"].get("content", "")).strip()
    lines = [
        "public:: false",
        "type:: podcast-news",
        f"topic:: {topic}",
        "source:: AI Daily Brief (podcast-knowledge-ingest promotion stage)",
        f"promotion-status:: {data['status']}",
        f"episodes:: {len(data.get('episodes', []))}",
        f"assertions:: {data.get('n_assertions', 0)}",
        "",
        f"# {topic} — processed news",
        "",
    ]
    if draft_content:
        lines += [draft_content, ""]
    lines.append("## Evidence")
    for a in data.get("assertions", []):
        lines.append(f"- {a['claim']}")
        lines.append(f"  source:: {a.get('source', '')}")
        lines.append(f"  episode:: {a.get('episode', '')}")
        lines.append(f"  confidence:: {a.get('confidence', '')}")
        if a.get("claim_date"):
            lines.append(f"  claim-date:: {a['claim_date']}")
    safe_name = topic.replace("/", "___")
    path = working_dir / f"{safe_name}.md"
    path.write_text("\n".join(lines) + "\n")
    return path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pages-dir", required=True, help="dir containing podcast-evidence___*.md ledger pages and target topic pages")
    ap.add_argument("--proposals-dir", required=True, help="output dir for survivor dossiers")
    ap.add_argument("--rejects-dir", default=None, help="output dir for rejected dossiers (default: <proposals-dir>/../rejects)")
    ap.add_argument("--min-assertions", type=int, default=5, help="min assertions for a topic to become a candidate (default 5)")
    ap.add_argument("--min-episodes", type=int, default=2, help="min distinct episodes for a topic to become a candidate (default 2)")
    ap.add_argument("--judge-a-min", type=float, default=-0.5, help="min rubric-A improvement to survive (default -0.5)")
    ap.add_argument("--judge-b-min", type=float, default=0.0, help="rubric-B improvement must be strictly > this to survive (default 0.0)")
    ap.add_argument("--completeness-min", type=float, default=0.6, help="min answer-completeness score to survive (default 0.6)")
    ap.add_argument("--judge-seed", type=int, default=42, help="seed for blind A/B ordering (default 42)")
    ap.add_argument("--loom-url", default=DEFAULT_LOOM_URL)
    ap.add_argument("--loom-model", default=DEFAULT_LOOM_MODEL)
    ap.add_argument("--dry-run", action="store_true", help="only run candidacy detection, no Loom/judge calls, no writes")
    ap.add_argument("--limit", type=int, default=None, help="process at most N candidates this run")
    ap.add_argument("--working-graph-dir", default=None,
                    help="if set, rejected candidates also land their processed news as a "
                         "Logseq page here (e.g. ~/workspace/logseq/workingGraph/pages)")
    ap.add_argument("--max-dossier-assertions", type=int, default=12,
                    help="cap assertions handed to draft/completeness, strongest first "
                         "(confidence desc, then recency); 0 = uncapped (default 12)")
    args = ap.parse_args()
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
