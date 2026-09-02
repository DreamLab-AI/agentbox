#!/usr/bin/env python3
"""
Podcast Knowledge Ingest — weekly cron job.

Downloads new podcast episodes, extracts evidence-backed assertions via the
Ontology Loom (Qwen 3.8), verifies them via Perplexity, navigates the ontology
to find placement, and integrates knowledge into existing pages.

Usage:
    python ingest.py --config podcasts.yaml
    python ingest.py --config podcasts.yaml --dry-run
    python ingest.py --config podcasts.yaml --file specific-episode.md
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import unquote

import yaml

try:
    import requests
except ImportError:
    requests = None

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_LOOM_URL = "http://192.168.2.132:8084/v1"
DEFAULT_LOOM_MODEL = "qwen3.8-27b"
DEFAULT_MAX_ASSERTIONS = 15
DEFAULT_MIN_CONFIDENCE = 0.4
DEFAULT_MAX_EPISODES = 15
DEFAULT_BACKLOG_BATCH = 50

INGEST_PREFIX = "ingest-status::"

EXTRACTION_PROMPT = """You are an ontology knowledge extractor. Analyse this podcast transcript
and extract knowledge worth adding to a technology knowledge base.

Extract three tiers of knowledge — aim for 5-15 items per transcript:

TIER 1 — Hard facts (confidence 0.85-1.0):
  Backed by a named study, report, official disclosure, or quantitative data.
  Attributed to a specific source. Contains concrete facts (numbers, dates, named entities).

TIER 2 — Expert analysis and industry insight (confidence 0.6-0.84):
  Informed positions, strategic assessments, or trend analysis from credible voices.
  Product announcements, partnerships, policy shifts, competitive moves.
  Technical evaluations or comparisons with reasoned justification.
  The host's experienced interpretation of developments, where grounded in specifics.

TIER 3 — Notable predictions and emerging signals (confidence 0.4-0.59):
  Forward-looking claims about technology direction, market shifts, or policy.
  Early signals or patterns the host identifies before mainstream coverage.
  Contrarian positions backed by reasoning (not mere speculation).

For each item, return a JSON object with:
- "claim": a clear statement (one sentence). It MUST state the SAME number, metric,
  attributed role, and named entity that its evidence supports — never round, convert,
  paraphrase a figure, or re-attribute to a different person/company. If the evidence is
  itself garbled or ambiguous, keep the claim faithful and add "[sic]" rather than inventing
  a corrected value. (PC-5)
- "tier": 1, 2, or 3
- "source": who reported/said this — the host counts for analysis and predictions
- "source_authority": one of primary | secondary | single-source | rumour | hedged —
  how well-attributed the claim is. A single unconfirmed report or a hedged/speculative
  aside is NOT primary, however confident it sounds. Confidence must not exceed what the
  authority supports. (PC-3)
- "volatility": one of durable | snapshot | speculative. durable = a structural trend or
  insight that outlives the episode; snapshot = a dated figure (price, rank, MAU, launch %,
  funding round, benchmark score) that is stale within weeks; speculative = unshipped,
  future, or opinion. This is independent of confidence — a claim can be well-sourced AND
  fast-decaying. (PC-4)
- "evidence": supporting data points, quotes, reasoning, or context
- "context": 1-2 sentences of surrounding context from the transcript
- "confidence": your confidence this is accurately captured (0.0-1.0)
- "ontology_terms": 2-4 key concepts that would help locate this in an AI/tech ontology.
  Give SPECIFIC named entities or multi-word concepts, never bare generic words or short
  acronyms (not "Model", "Base", "API", "GAN", "State"): a wrong-sense link is worse than
  no link. Prefer fewer, precise terms over more, loose ones. (PC-1)

Transcription and phrasing hygiene (PC-2):
- Transcripts are auto-captioned. Normalise obvious speech-to-text garbles of KNOWN names and
  version numbers in the claim, source, and ontology_terms — e.g. "Opus 48" -> "Opus 4.8",
  "GPT 55" -> "GPT-5.5", "Ilia Sutskaver" -> "Ilya Sutskever", "Ethan Malik" -> "Ethan Mollick".
  Keep the raw garbled form ONLY inside the verbatim evidence quote, never in structured fields.
- Keep claims neutral and checkable: move promotional or hype phrasing ("a marvel", "fabled
  intelligence at half the price") into the evidence quote and state the claim plainly.
- If a named concept is clearly the subject of a durable claim, include it as an ontology_term
  so it can anchor a link — but only if it is specific (PC-1), never to force a generic link.
- The show's regular host is the most-mentioned speaker; normalise host and recurring-guest
  names to their correct spelling rather than an ASR variant. (PC-9)
- State only relationships the evidence supports. Do NOT infer ownership, agency, or partnership
  edges between correctly-named entities that the transcript does not assert (e.g. do not say one
  company owns another's asset merely because their founders are linked). (PC-10)

Return a JSON array. Prefer breadth — capture the full range of useful knowledge
in the episode. If genuinely nothing is extractable, return [].

TRANSCRIPT:
{transcript}"""


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def slugify(title: str, max_len: int = 80) -> str:
    s = title.lower().strip()
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s_]+', '-', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s[:max_len]


def get_ingest_status(content: str) -> str | None:
    if content.startswith(INGEST_PREFIX):
        return content.split('\n', 1)[0].replace(INGEST_PREFIX, '').strip()
    return None


def set_ingest_status(path: Path, status: str):
    content = path.read_text()
    if content.startswith(INGEST_PREFIX):
        content = content.split('\n', 1)[1]
    path.write_text(f"{INGEST_PREFIX} {status}\n{content}")


def assertion_fingerprint(source: str, claim: str) -> str:
    normalised = re.sub(r'\s+', ' ', f"{source}|{claim}".lower().strip())
    return hashlib.sha256(normalised.encode()).hexdigest()[:16]


def load_state(state_path: Path) -> dict:
    if state_path.exists():
        return json.loads(state_path.read_text())
    return {"videos": {}, "assertions": {}}


def save_state(state_path: Path, state: dict):
    state_path.write_text(json.dumps(state, indent=2))


# ---------------------------------------------------------------------------
# Phase 1: Delta detection + download
# ---------------------------------------------------------------------------

def get_video_ids(channel_url: str) -> list[tuple[str, str]]:
    cmd = [sys.executable, "-m", "yt_dlp", "--flat-playlist",
           "--print", "%(id)s\t%(title)s", channel_url]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    videos = []
    for line in result.stdout.strip().split('\n'):
        if '\t' in line:
            vid_id, title = line.split('\t', 1)
            videos.append((vid_id, title))
    return videos


def download_episode(vid_id: str, title: str, out_dir: Path) -> Path | None:
    slug = slugify(title)
    md_path = out_dir / f"{slug}.md"
    if md_path.exists() and md_path.stat().st_size > 500:
        return md_path

    url = f"https://www.youtube.com/watch?v={vid_id}"
    meta_cmd = [sys.executable, "-m", "yt_dlp", "--skip-download", "--dump-json", url]
    meta_result = subprocess.run(meta_cmd, capture_output=True, text=True, timeout=90)
    if meta_result.returncode != 0:
        return None

    try:
        info = json.loads(meta_result.stdout)
    except json.JSONDecodeError:
        return None

    upload_date = info.get("upload_date", "unknown")
    formatted_date = (f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}"
                      if len(upload_date) == 8 else upload_date)
    duration = info.get("duration_string", "unknown")
    description = info.get("description", "")
    links = re.findall(r'https?://[^\s<>"\']+', description)

    # Download subtitles
    sub_dir = out_dir / ".subs_tmp"
    sub_dir.mkdir(exist_ok=True)
    sub_cmd = [sys.executable, "-m", "yt_dlp", "--skip-download",
               "--write-auto-sub", "--sub-lang", "en", "--sub-format", "vtt",
               "--convert-subs", "srt", "-o", str(sub_dir / vid_id), url]
    subprocess.run(sub_cmd, capture_output=True, text=True, timeout=120)

    transcript_text = ""
    for ext in [".en.srt", ".en.vtt"]:
        sub_file = sub_dir / (vid_id + ext)
        if sub_file.exists():
            raw = sub_file.read_text()
            lines = []
            for line in raw.split('\n'):
                line = line.strip()
                if not line or re.match(r'^\d+$', line) or re.match(r'\d{2}:\d{2}:\d{2}', line):
                    continue
                if line.startswith(('WEBVTT', 'Kind:', 'Language:')):
                    continue
                line = re.sub(r'<[^>]+>', '', line)
                if line and line not in lines[-1:]:
                    lines.append(line)
            transcript_text = ' '.join(lines)
            sub_file.unlink()
            break

    md = f"{INGEST_PREFIX} downloaded\n"
    md += f"# {title}\n\n"
    md += f"- **Date**: {formatted_date}\n"
    md += f"- **Duration**: {duration}\n"
    md += f"- **YouTube**: https://www.youtube.com/watch?v={vid_id}\n\n"
    md += f"## Show Notes\n\n{description}\n\n## Links\n\n"
    for link in links:
        if 'redirect' in link and 'q=' in link:
            match = re.search(r'q=(https?[^&]+)', link)
            if match:
                link = unquote(match.group(1))
        md += f"- {link}\n"
    if not links:
        md += "_No links found in show notes._\n"
    md += f"\n## Transcript\n\n"
    if transcript_text:
        words = transcript_text.split()
        para = []
        for i, w in enumerate(words):
            para.append(w)
            if (i + 1) % 500 == 0:
                md += ' '.join(para) + '\n\n'
                para = []
        if para:
            md += ' '.join(para) + '\n'
    else:
        md += "_Transcript not available for this episode._\n"

    md_path.write_text(md)
    return md_path


def phase_download(podcast: dict, state: dict, max_episodes: int) -> list[Path]:
    channel = podcast["channel"]
    out_dir = Path(podcast["output_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)

    channel_url = channel
    if channel_url.startswith('@'):
        channel_url = f"https://www.youtube.com/{channel_url}/videos"
    elif '/videos' not in channel_url and 'playlist' not in channel_url:
        channel_url = channel_url.rstrip('/') + '/videos'

    known_ids = set(state.get("videos", {}).keys())
    for f in out_dir.glob("*.md"):
        text = f.read_text()[:600]
        m = re.search(r'watch\?v=([A-Za-z0-9_-]+)', text)
        if m:
            known_ids.add(m.group(1))

    print(f"[{podcast['name']}] Fetching video list...", flush=True)
    all_videos = get_video_ids(channel_url)
    new_videos = [(vid, title) for vid, title in all_videos if vid not in known_ids]

    if not new_videos:
        print(f"[{podcast['name']}] No new episodes.", flush=True)
        return []

    print(f"[{podcast['name']}] {len(new_videos)} new episodes to download.", flush=True)
    downloaded = []
    for i, (vid_id, title) in enumerate(new_videos[:max_episodes], 1):
        print(f"  [{i}/{min(len(new_videos), max_episodes)}] {title}", flush=True)
        path = download_episode(vid_id, title, out_dir)
        if path:
            downloaded.append(path)
            state.setdefault("videos", {})[vid_id] = {
                "status": "downloaded", "file": path.name,
                "date": datetime.now().isoformat()
            }

    print(f"[{podcast['name']}] Downloaded {len(downloaded)} episodes.", flush=True)
    return downloaded


# ---------------------------------------------------------------------------
# Phase 2: Assertion extraction via Loom
# ---------------------------------------------------------------------------

_RESOLVED_LOOM_URL: str | None = None


def resolve_loom_url(settings: dict) -> str:
    """Pick the first reachable Loom façade, once per run.

    The LAN address (via machinelearn's hp-nat DNAT) is canonical; the 25G
    rail address reaches HP directly when the DNAT is down. Both serve the
    same façade on :8084.
    """
    global _RESOLVED_LOOM_URL
    if _RESOLVED_LOOM_URL:
        return _RESOLVED_LOOM_URL
    candidates = [settings.get("loom_url", DEFAULT_LOOM_URL)]
    candidates += settings.get("loom_fallback_urls", ["http://10.10.10.1:8084/v1"])
    for url in candidates:
        if requests is None:
            break
        try:
            base = url.rsplit("/v1", 1)[0]
            r = requests.get(f"{base}/health", timeout=5)
            if r.ok and r.json().get("ok"):
                if url != candidates[0]:
                    print(f"  Loom primary unreachable, using fallback: {url}", flush=True)
                _RESOLVED_LOOM_URL = url
                return url
        except Exception:
            continue
    _RESOLVED_LOOM_URL = candidates[0]
    return _RESOLVED_LOOM_URL


def call_loom(prompt: str, loom_url: str, model: str) -> str | None:
    if requests is None:
        print("  WARNING: requests not available, skipping Loom call", flush=True)
        return None

    try:
        resp = requests.post(
            f"{loom_url}/chat/completions",
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": "You are a knowledge extraction assistant. Return ONLY valid JSON. No markdown fencing, no thinking tags."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
                # Qwen3.8's reasoning tokens count against max_tokens; 4096
                # truncated real extractions mid-array (finish_reason=length).
                "max_tokens": 12288,
                # Scaffold injection ON (default budget): grounded extraction
                # resolves ~60% of ontology_terms to existing KG pages vs ~22%
                # raw (3-episode A/B, 2026-08-22). verbatim:false blocks the
                # Loom's retrieval short-circuit, which otherwise answers
                # transcript prompts from the scaffold without calling the
                # model at all (the failure ontology_budget:0 was masking).
                "loom_options": {"verbatim": False},
            },
            # Qwen3.8-27B reasoning over a full episode transcript regularly
            # exceeds 3 minutes; 180s was producing spurious read timeouts.
            timeout=600,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"  Loom error: {e}", flush=True)
        return None


def extract_assertions(md_path: Path, settings: dict) -> list[dict]:
    content = md_path.read_text()
    transcript_match = re.search(r'## Transcript\n\n(.+)', content, re.DOTALL)
    if not transcript_match:
        return []
    transcript = transcript_match.group(1)
    if transcript.startswith("_Transcript not available"):
        return []

    prompt = EXTRACTION_PROMPT.format(transcript=transcript)
    response = call_loom(
        prompt,
        resolve_loom_url(settings),
        settings.get("loom_model", DEFAULT_LOOM_MODEL),
    )
    if not response:
        return []

    # Strip thinking tags (Qwen reasoning models)
    response = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL).strip()

    # Parse JSON from response (Loom may wrap in markdown code fences)
    json_match = re.search(r'```(?:json)?\s*(\[.*?\])\s*```', response, re.DOTALL)
    if json_match:
        response = json_match.group(1)
    else:
        arr_match = re.search(r'\[.*\]', response, re.DOTALL)
        if arr_match:
            response = arr_match.group(0)

    # Fix common LLM JSON issues
    response = re.sub(r',\s*]', ']', response)
    response = re.sub(r',\s*}', '}', response)

    try:
        assertions = json.loads(response)
        if not isinstance(assertions, list):
            return []
    except json.JSONDecodeError:
        # Truncated array (finish_reason=length): salvage the complete
        # top-level objects and drop the cut-off tail.
        objs, depth, start = [], 0, None
        for i, ch in enumerate(response):
            if ch == '{':
                if depth == 0:
                    start = i
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0 and start is not None:
                    try:
                        objs.append(json.loads(response[start:i + 1]))
                    except json.JSONDecodeError:
                        pass
                    start = None
        if objs:
            print(f"  Loom response truncated; salvaged {len(objs)} complete assertions", flush=True)
            assertions = objs
        else:
            print(f"  Failed to parse Loom response as JSON", flush=True)
            return []

    # Filter by confidence
    min_conf = settings.get("min_confidence", DEFAULT_MIN_CONFIDENCE)
    max_n = settings.get("max_assertions_per_episode", DEFAULT_MAX_ASSERTIONS)
    filtered = [a for a in assertions if a.get("confidence", 0) >= min_conf]
    filtered.sort(key=lambda a: -a.get("confidence", 0))
    return filtered[:max_n]


def phase_extract(files: list[Path], settings: dict, state: dict) -> dict[str, list[dict]]:
    results = {}
    for md_path in files:
        status = get_ingest_status(md_path.read_text())
        if status and status.startswith("processed"):
            continue

        print(f"  Extracting: {md_path.name}", flush=True)
        assertions = extract_assertions(md_path, settings)
        if assertions:
            # Deduplicate against known assertions
            known = state.get("assertions", {})
            novel = []
            for a in assertions:
                fp = assertion_fingerprint(a.get("source", ""), a.get("claim", ""))
                if fp not in known:
                    a["fingerprint"] = fp
                    novel.append(a)
                    known[fp] = {
                        "claim": a.get("claim", ""),
                        "source": a.get("source", ""),
                        "file": md_path.name,
                        "date": datetime.now().isoformat(),
                    }

            if novel:
                results[md_path.name] = novel
                print(f"    {len(novel)} novel assertions (of {len(assertions)} extracted)", flush=True)
            else:
                print(f"    All {len(assertions)} assertions already known", flush=True)
        else:
            print(f"    No assertions met threshold", flush=True)

        set_ingest_status(md_path, "pending")

    return results


# ---------------------------------------------------------------------------
# Phase 3: Verification via Perplexity (stub — requires MCP context)
# ---------------------------------------------------------------------------

def phase_verify(assertions_by_file: dict[str, list[dict]], settings: dict) -> dict[str, list[dict]]:
    """Verify assertions. In cron mode this uses requests to Perplexity API.
    In agent mode the caller should use perplexity_search MCP tool instead."""
    # Tier-aware pass-through: hard facts need 0.7, analysis 0.5, predictions 0.4
    # The agent-mode caller overrides this with actual Perplexity verification
    TIER_THRESHOLDS = {1: 0.7, 2: 0.5, 3: 0.4}
    verified = {}
    for filename, assertions in assertions_by_file.items():
        kept = [a for a in assertions
                if a.get("confidence", 0) >= TIER_THRESHOLDS.get(a.get("tier", 1), 0.7)]
        if kept:
            verified[filename] = kept
    return verified


# ---------------------------------------------------------------------------
# Phase 4: Ontology placement + integration (stub — requires MCP context)
# ---------------------------------------------------------------------------

TIER_LABELS = {1: "", 2: "Industry analysis", 3: "Emerging signal"}


def build_evidence_paragraph(assertion: dict, url: str = "") -> str:
    """Build a self-contained evidence paragraph from an assertion."""
    claim = assertion.get("claim", "")
    evidence = assertion.get("evidence", "")
    tier = assertion.get("tier", 1)

    tier_prefix = f"**[{TIER_LABELS[tier]}]** " if tier in TIER_LABELS and TIER_LABELS[tier] else ""
    para = f"{tier_prefix}{claim}"
    if evidence and evidence != claim:
        para += f" {evidence}"
    if url:
        para += f" ([source]({url}))"

    return para


def _build_page_index(ontology_dir: Path) -> dict[str, tuple[Path, float]]:
    """slug -> (path, quality) for every non-ledger page, quality parsed once.

    Built once per run and reused across episodes — the previous per-episode
    rebuild re-read every substring-matching page per term per assertion,
    which is near-quadratic IO on a large graph.
    """
    index: dict[str, tuple[Path, float]] = {}
    for p in ontology_dir.glob("*.md"):
        if p.stem.startswith("podcast-evidence"):
            continue
        content = p.read_text(errors="replace")
        q_match = re.search(r'"quality":\s*([\d.]+)', content)
        quality = float(q_match.group(1)) if q_match else 0.5
        index[p.stem.lower().replace(" ", "-")] = (p, quality)
    return index


# Generic single-word tokens and bare acronyms that resolve to a real page but
# almost always mean something else in context — linking them injects false
# graph edges (RUNBOOK PC-1). Only ever matched by EXACT slug, never substring.
_LINK_STOPWORDS = {
    "model", "base", "value", "logic", "curve", "safe", "rest", "api", "uri",
    "url", "gan", "uma", "raft", "core", "state", "scale", "chain", "node",
    "agent", "token", "graph", "data", "cloud", "edge", "stack", "layer",
    "loop", "flow", "field", "space", "vector", "signal", "policy", "target",
}


def _resolve_ontology_term(term: str, page_index: dict[str, tuple[Path, float]]) -> Path | None:
    """Resolve a single ontology_term to the best-matching existing page.

    Exact slug match first. Substring matching is then gated for specificity
    (RUNBOOK PC-1): a wrong-sense link is worse than no link, because it mints
    a false graph edge. We therefore (a) refuse substring matches for terms
    that are a single generic noun / bare acronym, and (b) require the term to
    be a substring of the page slug (not the reverse — 'gan' must not match
    'organisation'), preferring the HIGHEST-quality candidate.
    """
    slug = term.lower().replace(" ", "-")
    tokens = [t for t in slug.split("-") if t]

    # A single generic noun or bare acronym is refused outright, even when an
    # exact page of that slug exists: those pages ([[GAN]], [[Model]], [[API]])
    # are near-always wrong-sense in a podcast claim and mint false edges (PC-1).
    if len(tokens) < 2 and (slug in _LINK_STOPWORDS or len(slug) <= 4):
        return None

    if slug in page_index:
        return page_index[slug][0]

    best_match = None
    best_quality = -1.0
    for page_slug, (page_path, quality) in page_index.items():
        # directional: the term must appear within the page slug, and cover a
        # substantial fraction of it, so a short term cannot claim a long page.
        if slug in page_slug and len(slug) >= 0.5 * len(page_slug):
            if quality > best_quality:
                best_match = page_path
                best_quality = quality
    return best_match


def _extract_episode_meta(md_path: Path) -> dict:
    """Pull title / date / YouTube URL out of a downloaded transcript file."""
    content = md_path.read_text()
    title_match = re.search(r'^#\s+(.+)$', content, re.MULTILINE)
    url_match = re.search(r'\*\*YouTube\*\*:\s*(\S+)', content)
    date_match = re.search(r'\*\*Date\*\*:\s*(\S+)', content)
    return {
        "title": title_match.group(1).strip() if title_match else md_path.stem,
        "url": url_match.group(1).strip() if url_match else "",
        "episode_date": date_match.group(1).strip() if date_match else "",
    }


LEDGER_FP_MARKER = "<!-- assertion-fp: {fp} -->"
LEDGER_FP_RE = re.compile(r'<!-- assertion-fp:\s*([0-9a-f]+)\s*-->')


def _ledger_page_path(ontology_dir: Path, episode_slug: str) -> Path:
    return ontology_dir / f"podcast-evidence___{episode_slug}.md"


def _yaml_scalar(value: str) -> str:
    """Quote a frontmatter scalar when a bare one would change its YAML type.

    VAULT-corpus-format V2: wikilinks are quoted strings, dates and
    boolean-looking words must not be re-typed by the YAML reader.
    """
    v = str(value)
    if v == "" or v[0] in "|>&*!%@`[{" or v.strip() != v:
        return f'"{v}"'
    if re.match(r"^(true|false|null|yes|no|on|off|~)$", v, re.I):
        return f'"{v}"'
    if re.match(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$", v):
        return f'"{v}"'
    if re.match(r"^\d{4}-\d{2}-\d{2}", v):
        return f'"{v}"'
    if re.search(r'[:#\[\]{},"\']', v):
        return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return v


def _build_ledger_header(episode_slug: str, meta: dict, today: str) -> str:
    """Ledger page head — V2 YAML frontmatter (VAULT-corpus-format §V2/§V5).

    ADR-2028 D4: writers emit frontmatter, never `key:: value` lines. `public`
    is a real YAML boolean; every other property that used to be a Logseq
    property line is now a frontmatter key.
    """
    props: list[tuple[str, str]] = [
        ("public", "true"),
        ("title", _yaml_scalar(f"AI Daily Brief — {meta['title']}")),
        ("source", _yaml_scalar("AI Daily Brief")),
    ]
    if meta.get("url"):
        props.append(("episode-url", _yaml_scalar(meta["url"])))
    if meta.get("episode_date"):
        props.append(("episode-date", _yaml_scalar(meta["episode_date"])))
    props.append(("ingest-date", _yaml_scalar(today)))

    lines = ["---"]
    lines += [f"{k}: {v}" for k, v in props]
    lines += ["---", ""]
    lines.append(f"# AI Daily Brief — {meta['title']}")
    lines.append("")
    return "\n".join(lines) + "\n"


def _build_ledger_bullet(assertion: dict, page_index: dict[str, tuple[Path, float]], today: str,
                         episode_date: str = "") -> tuple[str, list[str]]:
    """Build one ledger bullet block for an assertion.

    Returns (bullet_text, resolved_topic_titles) — resolved_topic_titles is
    used by the caller to decide whether an assertion counted as "matched"
    for the unmatched/new-page-proposal path.
    """
    claim = assertion.get("claim", "")
    tier = assertion.get("tier", 1)
    tier_label = TIER_LABELS.get(tier, "")
    confidence = assertion.get("confidence", "")
    source = assertion.get("source", "unknown")
    fp = assertion.get("fingerprint", "")

    resolved_titles = []
    for term in assertion.get("ontology_terms", []):
        page = _resolve_ontology_term(term, page_index)
        if page:
            resolved_titles.append(page.stem)

    wikilinks = " ".join(f"[[{t}]]" for t in resolved_titles)
    tier_prefix = f"**[{tier_label}]** " if tier_label else ""
    bullet_first_line = f"- {tier_prefix}{claim}"
    if wikilinks:
        bullet_first_line += f" {wikilinks}"

    sub_lines = [
        f"  tier:: {tier}",
        f"  confidence:: {confidence}",
        f"  source:: {source}",
    ]
    authority = assertion.get("source_authority", "")
    if authority:
        sub_lines.append(f"  source-authority:: {authority}")
    volatility = assertion.get("volatility", "")
    if volatility:
        sub_lines.append(f"  volatility:: {volatility}")
    sub_lines += [
        # the date the claim was made (episode air date), not the ingest date —
        # the page header's ingest-date:: carries the run date.
        f"  claim-date:: {episode_date or today}",
    ]
    evidence = assertion.get("evidence", "")
    if evidence and evidence != claim:
        sub_lines.append(f"  evidence:: {evidence}")
    sub_lines.append(f"  {LEDGER_FP_MARKER.format(fp=fp)}")

    bullet = bullet_first_line + "\n" + "\n".join(sub_lines) + "\n"
    return bullet, resolved_titles


def write_assertion_ledger(episode_filename: str, verified_assertions: list[dict],
                           ontology_dir: Path, state: dict, today: str,
                           page_index: dict[str, tuple[Path, float]] | None = None) -> tuple[int, list[dict]]:
    """Write/append verified assertions for one episode as a ledger page.

    Returns (n_bullets_written, unmatched_assertions) — unmatched assertions
    (zero resolved ontology_terms) are still written to the ledger, but are
    also handed back so the caller can still run the new-page-proposal path
    for them, unchanged from the old inline-editing behaviour.
    """
    episode_slug = Path(episode_filename).stem
    # episode transcript files live in the podcast output_dir, not ontology_dir;
    # the caller passes the resolved Path in via verified_assertions[i]['_episode_path']
    meta_path = next((a.get("_episode_path") for a in verified_assertions if a.get("_episode_path")), None)
    meta = _extract_episode_meta(Path(meta_path)) if meta_path else {"title": episode_slug, "url": "", "episode_date": ""}

    ledger_path = _ledger_page_path(ontology_dir, episode_slug)

    existing_content = ledger_path.read_text() if ledger_path.exists() else ""
    existing_fps = set(LEDGER_FP_RE.findall(existing_content))

    if page_index is None:
        page_index = _build_page_index(ontology_dir)

    unmatched: list[dict] = []
    new_bullets = []
    for assertion in verified_assertions:
        fp = assertion.get("fingerprint", "")
        if not fp:
            # An assertion without a fingerprint would be re-appended on every
            # run (dedup keys on fp) yet invisible to promote.py's candidacy
            # scan — synthesise the canonical fingerprint instead.
            fp = assertion_fingerprint(assertion.get("source", ""), assertion.get("claim", ""))
            assertion["fingerprint"] = fp
        if fp in existing_fps:
            continue  # already in the ledger from a prior run — idempotent
        bullet, resolved_titles = _build_ledger_bullet(assertion, page_index, today,
                                                       episode_date=meta.get("episode_date", ""))
        new_bullets.append(bullet)
        if not resolved_titles:
            unmatched.append({**assertion, "_source_file": episode_filename})
        if fp:
            state.setdefault("assertions", {})[fp] = {
                "claim": assertion.get("claim", ""),
                "integrated_into": ledger_path.name,
                "date": today,
            }

    if not new_bullets:
        return 0, unmatched

    if existing_content:
        # Append after existing content — never touch prior bullets.
        content = existing_content.rstrip("\n") + "\n" + "\n".join(new_bullets)
    else:
        content = _build_ledger_header(episode_slug, meta, today) + "\n".join(new_bullets)

    ledger_path.write_text(content.rstrip("\n") + "\n")
    return len(new_bullets), unmatched


def phase_integrate(verified: dict[str, list[dict]], ontology_dir: Path | None,
                    settings: dict, state: dict, dry_run: bool = False,
                    episode_paths: dict[str, Path] | None = None):
    """Land verified assertions into the graph as a per-episode assertion
    ledger page (option 4), instead of editing curated ontology pages.

    Curated pages are never modified. Each episode with verified assertions
    gets one `podcast-evidence___<episode-slug>.md` ledger page containing
    one bullet per assertion, [[wikilinked]] to whichever ontology_terms
    resolve to an existing page. Unresolved-topic assertions still land in
    the ledger, and are additionally handed to _propose_new_pages exactly as
    before so genuinely new concepts can still get a proposed ontology page.
    """
    if not ontology_dir or not ontology_dir.exists():
        print("  No ontology directory configured, skipping integration.", flush=True)
        return

    today = datetime.now().strftime("%Y-%m-%d")
    episode_paths = episode_paths or {}
    total_integrated = 0
    all_unmatched: list[dict] = []
    page_index = _build_page_index(ontology_dir) if not dry_run else None

    for filename, assertions in verified.items():
        if dry_run:
            print(f"    [DRY RUN] Would write ledger for {filename}: {len(assertions)} assertions", flush=True)
            for a in assertions:
                print(f"      Claim: {a.get('claim', '')[:100]}", flush=True)
            continue

        # Tag each assertion with its source transcript path so the ledger
        # writer can pull episode title/date/URL out of it.
        ep_path = episode_paths.get(filename)
        tagged = [{**a, "_episode_path": str(ep_path) if ep_path else None} for a in assertions]

        n_written, unmatched = write_assertion_ledger(filename, tagged, ontology_dir, state, today, page_index)
        total_integrated += n_written
        all_unmatched.extend(unmatched)
        if n_written:
            print(f"    Ledger updated for {filename}: {n_written} new assertions ({_ledger_page_path(ontology_dir, Path(filename).stem).name})", flush=True)
        else:
            print(f"    Ledger for {filename}: nothing new (idempotent re-run)", flush=True)

    print(f"  Total assertions landed in ledger: {total_integrated}", flush=True)

    # Phase 4b: Propose new pages for assertions whose ontology_terms didn't
    # resolve to any existing page — unchanged from the old behaviour.
    unmatched = all_unmatched
    if unmatched and not dry_run:
        _propose_new_pages(unmatched, ontology_dir, settings, state, today)
    elif unmatched and dry_run:
        print(f"\n  [DRY RUN] {len(unmatched)} assertions had no placement — would propose new pages:", flush=True)
        seen_topics = set()
        for a in unmatched:
            topic = a.get("ontology_terms", ["unknown"])[0]
            if topic not in seen_topics:
                seen_topics.add(topic)
                print(f"    → {topic}: {a.get('claim', '')[:80]}", flush=True)


def _phase_integrate_inline_legacy(verified: dict[str, list[dict]], ontology_dir: Path | None,
                    settings: dict, state: dict, dry_run: bool = False):
    """DEPRECATED — the old judged-harmful inline-page-editing integration.

    Kept only for reference/rollback; unreachable from run(). A blind
    LLM-judged before/after showed every inline insertion mechanic degrades
    curated pages, hence the graph-native assertion ledger in
    phase_integrate() above. Do not call this."""
    if not ontology_dir or not ontology_dir.exists():
        print("  No ontology directory configured, skipping integration.", flush=True)
        return

    today = datetime.now().strftime("%Y-%m-%d")
    total_integrated = 0

    # Build a slug→path index for fuzzy matching
    page_index: dict[str, Path] = {}
    for p in ontology_dir.glob("*.md"):
        page_index[p.stem.lower().replace(" ", "-")] = p

    unmatched: list[dict] = []

    for filename, assertions in verified.items():
        for assertion in assertions:
            terms = assertion.get("ontology_terms", [])
            if not terms:
                continue

            best_match = None
            best_quality = 1.0
            for term in terms:
                slug = term.lower().replace(" ", "-")
                # Exact slug match
                if slug in page_index:
                    candidate = page_index[slug]
                    content = candidate.read_text()
                    q_match = re.search(r'"quality":\s*([\d.]+)', content)
                    quality = float(q_match.group(1)) if q_match else 0.5
                    if quality < best_quality:
                        best_match = candidate
                        best_quality = quality
                    continue
                # Substring match: find pages containing the slug
                for page_slug, page_path in page_index.items():
                    if slug in page_slug or page_slug in slug:
                        content = page_path.read_text()
                        q_match = re.search(r'"quality":\s*([\d.]+)', content)
                        quality = float(q_match.group(1)) if q_match else 0.5
                        if quality < best_quality:
                            best_match = page_path
                            best_quality = quality

            if not best_match:
                unmatched.append({**assertion, "_source_file": filename})
                print(f"    No ontology page found for: {terms}", flush=True)
                continue

            if dry_run:
                print(f"    [DRY RUN] Would integrate into: {best_match.name}", flush=True)
                print(f"      Claim: {assertion.get('claim', '')[:100]}", flush=True)
                continue

            # Build and insert paragraph
            para = build_evidence_paragraph(assertion)
            content = best_match.read_text()

            # Find insertion point — after Overview or Mechanisms, before Applications
            insert_markers = ["### Applications", "### Relationships", "### Provenance"]
            inserted = False
            for marker in insert_markers:
                if f"- {marker}" in content:
                    content = content.replace(
                        f"- {marker}",
                        f"  - {para} *(Source: {assertion.get('source', 'unknown')}, via AI Daily Brief, {today})*\n- {marker}",
                    )
                    inserted = True
                    break

            if inserted:
                best_match.write_text(content)
                total_integrated += 1
                state.setdefault("assertions", {})[assertion.get("fingerprint", "")] = {
                    "claim": assertion.get("claim", ""),
                    "integrated_into": best_match.name,
                    "date": today,
                }
                print(f"    Integrated into: {best_match.name}", flush=True)

    print(f"  Total assertions integrated: {total_integrated}", flush=True)

    if unmatched and not dry_run:
        _propose_new_pages(unmatched, ontology_dir, settings, state, today)


# VAULT-corpus-format §V2/§V5 (ADR-2028 D4): new pages open with YAML
# frontmatter, not a Logseq `public:: true` property block. `public` is a real
# boolean; the JSON-LD fences below are format-neutral and carry over unchanged.
NEW_PAGE_TEMPLATE = '''---
public: true
---

# {title}
```json-ld
{{
  "@context": "https://narrativegoldmine.com/context/v1.jsonld",
  "@id": "urn:visionflow:page:{slug}",
  "@type": "Page",
  "vc:slug": "{slug}",
  "title": "{title}",
  "vc:public": true,
  "vc:outboundWikilinks": {wikilinks_json},
  "vc:schemaVersion": 2
}}
```

```json-ld
{{
  "@context": "https://narrativegoldmine.com/ns/v2.jsonld",
  "@id": "urn:ngm:class:{slug}",
  "@type": "Class",
  "label": "{title}",
  "definition": "{definition}",
  "domain": "{domain}",
  "maturity": "draft",
  "quality": 0.35,
  "subClassOf": [{{"@id": "urn:ngm:class:{parent_slug}", "label": "{parent_label}"}}],
  "relations": {{
    "relatedTo": {related_json}
  }},
  "provenance": {{
    "source": "podcast-knowledge-ingest",
    "created": "{date}",
    "episode": "{episode_source}"
  }}
}}
```

- ### Overview
{evidence_block}
- ### Relationships
- ### Provenance
'''

PAGE_WORTHINESS_PROMPT = """Given these unmatched assertions from a podcast, group them by
topic and for each proposed new ontology page return:
{{"title": "...", "slug": "...", "definition": "one-sentence definition",
  "domain": "governance|artificial-intelligence|infrastructure|economics|security",
  "parent_label": "nearest existing ontology parent concept",
  "parent_slug": "slug of parent",
  "related_terms": ["existing ontology pages this relates to"],
  "worth_adding": true/false,
  "reason": "why this topic deserves a page (or why not)"}}

Only set worth_adding=true if the topic is:
- A distinct concept (not just a news event)
- Likely to recur and accumulate more knowledge over time
- Not already covered by a broader existing page

Return a JSON array. Unmatched assertions:
{assertions_json}"""


def _propose_new_pages(unmatched: list[dict], ontology_dir: Path,
                       settings: dict, state: dict, today: str):
    """Use the Loom to assess which unmatched topics deserve new ontology pages."""
    print(f"\n  Assessing {len(unmatched)} unmatched assertions for new page proposals...", flush=True)

    prompt = PAGE_WORTHINESS_PROMPT.format(
        assertions_json=json.dumps([{
            "claim": a["claim"], "tier": a.get("tier", 1),
            "source": a.get("source", ""), "ontology_terms": a.get("ontology_terms", []),
        } for a in unmatched], indent=2)
    )

    response = call_loom(
        prompt,
        resolve_loom_url(settings),
        settings.get("loom_model", DEFAULT_LOOM_MODEL),
    )
    if not response:
        print("  Loom unavailable for page proposals, skipping.", flush=True)
        return

    response = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL).strip()
    arr_match = re.search(r'\[.*\]', response, re.DOTALL)
    if not arr_match:
        print("  Could not parse page proposals from Loom response.", flush=True)
        return

    raw = arr_match.group()
    raw = re.sub(r',\s*]', ']', raw)
    raw = re.sub(r',\s*}', '}', raw)
    try:
        proposals = json.loads(raw)
    except json.JSONDecodeError:
        print("  JSON parse error in page proposals.", flush=True)
        return

    created = 0
    for prop in proposals:
        if not prop.get("worth_adding"):
            print(f"    SKIP: {prop.get('title', '?')} — {prop.get('reason', 'not worth adding')}", flush=True)
            continue

        title = prop["title"]
        slug = prop.get("slug", slugify(title))
        page_path = ontology_dir / f"{title}.md"

        if page_path.exists():
            print(f"    EXISTS: {title}", flush=True)
            continue

        # Gather assertions for this page
        page_assertions = [a for a in unmatched
                           if any(t.lower() in title.lower() or title.lower() in t.lower()
                                  for t in a.get("ontology_terms", []))]
        if not page_assertions:
            page_assertions = unmatched[:1]

        # Build evidence block
        evidence_lines = []
        wikilinks = set()
        for a in page_assertions:
            tier_label = TIER_LABELS.get(a.get("tier", 1), "")
            prefix = f"**[{tier_label}]** " if tier_label else ""
            evidence_lines.append(
                f"  - {prefix}{a['claim']} "
                f"*(Source: {a.get('source', 'unknown')}, via AI Daily Brief, {today})*"
            )
            for term in a.get("ontology_terms", []):
                if term.lower() != title.lower():
                    wikilinks.add(term)

        related = [{"@id": f"urn:ngm:class:{slugify(t)}", "label": t}
                    for t in prop.get("related_terms", [])[:5]]
        wikilinks_list = sorted(wikilinks)[:8]

        page_content = NEW_PAGE_TEMPLATE.format(
            title=title,
            slug=slug,
            definition=prop.get("definition", f"{title} as discussed in AI industry analysis."),
            domain=prop.get("domain", "artificial-intelligence"),
            parent_slug=prop.get("parent_slug", "artificial-intelligence"),
            parent_label=prop.get("parent_label", "Artificial Intelligence"),
            related_json=json.dumps(related),
            wikilinks_json=json.dumps(wikilinks_list),
            date=today,
            episode_source=page_assertions[0].get("_source_file", "unknown"),
            evidence_block="\n".join(evidence_lines),
        )

        page_path.write_text(page_content)
        created += 1
        state.setdefault("created_pages", []).append({
            "page": title, "slug": slug, "date": today,
            "assertions": len(page_assertions),
        })
        print(f"    CREATED: {page_path.name} ({len(page_assertions)} assertions)", flush=True)

    print(f"  New pages created: {created}", flush=True)


# ---------------------------------------------------------------------------
# Phase 5: Mark complete
# ---------------------------------------------------------------------------

def phase_mark_complete(files: list[Path], assertions_by_file: dict[str, list[dict]]):
    today = datetime.now().strftime("%Y-%m-%d")
    for md_path in files:
        count = len(assertions_by_file.get(md_path.name, []))
        if count > 0:
            set_ingest_status(md_path, f"processed:{today}:{count}-assertions")
        else:
            set_ingest_status(md_path, "skipped")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _expand_paths(config: dict) -> dict:
    """Expand ${VAULT_TRANSCRIPTS} / ${VAULT_PAGES} / ${VAULT_WORKING_PAGES} in configured directories.

    ADR-2028: podcasts.yaml carries vault-relative placeholders rather than
    absolute corpus paths, so relocating the vault in agentbox.toml relocates
    this skill's output with no edit here. An unset variable expands to nothing,
    leaving an obviously-broken relative path that the caller reports rather
    than silently writing into the wrong tree.
    """
    for podcast in config.get("podcasts", []) or []:
        for key in ("output_dir", "ontology_dir", "working_graph_dir"):
            if podcast.get(key):
                podcast[key] = os.path.expandvars(str(podcast[key]))
    return config


def load_config(config_path: Path) -> dict:
    if config_path.exists():
        return _expand_paths(yaml.safe_load(config_path.read_text()))
    # Default config for AI Daily Brief
    return {
        "podcasts": [{
            "channel": "@TheAIDailyBrief",
            "name": "AI Daily Brief",
            "focus": "AI industry news, policy, models, companies",
            "output_dir": str(config_path.parent),
            # ADR-2028: the corpus lives under the vault path authority, never a
            # hard-coded graph directory. Empty when no vault is configured, in
            # which case phase_integrate skips the ontology write entirely.
            "ontology_dir": os.environ.get("VAULT_PAGES", ""),
        }],
        "settings": {
            "loom_url": DEFAULT_LOOM_URL,
            "loom_model": DEFAULT_LOOM_MODEL,
            "max_assertions_per_episode": DEFAULT_MAX_ASSERTIONS,
            "min_confidence": DEFAULT_MIN_CONFIDENCE,
            "max_episodes_per_run": DEFAULT_MAX_EPISODES,
            "backlog_batch_size": DEFAULT_BACKLOG_BATCH,
        }
    }


def run(config: dict, dry_run: bool = False, target_file: str | None = None,
        reprocess: bool = False):
    settings = config.get("settings", {})
    max_episodes = settings.get("max_episodes_per_run", DEFAULT_MAX_EPISODES)

    for podcast in config.get("podcasts", []):
        out_dir = Path(podcast["output_dir"])
        state_path = out_dir / ".ingest-state.json"
        state = load_state(state_path)

        print(f"\n{'='*60}", flush=True)
        print(f"Processing: {podcast['name']}", flush=True)
        print(f"{'='*60}", flush=True)

        # Phase 1: Download new episodes
        if target_file:
            target = out_dir / target_file
            if not target.exists():
                print(f"File not found: {target}", flush=True)
                continue
            new_files = [target]
        else:
            new_files = phase_download(podcast, state, max_episodes)

        # Also find existing downloaded-but-unprocessed files (backlog)
        backlog_batch = settings.get("backlog_batch_size", DEFAULT_BACKLOG_BATCH)
        unprocessed = []
        for f in sorted(out_dir.glob("*.md")):
            if target_file and f.name != target_file:
                continue
            content = f.read_text()
            status = get_ingest_status(content)
            if status == "downloaded" or (reprocess and status and status.startswith("processed")):
                if f not in new_files:
                    unprocessed.append(f)

        if len(unprocessed) > backlog_batch:
            print(f"  Backlog: {len(unprocessed)} files, processing {backlog_batch} this run.", flush=True)
            unprocessed = unprocessed[:backlog_batch]

        all_files = new_files + unprocessed
        if not all_files:
            print("No files to process.", flush=True)
            save_state(state_path, state)
            continue

        print(f"\n{len(all_files)} files to process ({len(new_files)} new, {len(unprocessed)} backlog).", flush=True)

        # Phase 2: Extract assertions
        print(f"\n--- Phase 2: Assertion extraction (Loom) ---", flush=True)
        assertions_by_file = phase_extract(all_files, settings, state)

        if not assertions_by_file:
            print("No assertions extracted.", flush=True)
            phase_mark_complete(all_files, assertions_by_file)
            save_state(state_path, state)
            continue

        total_assertions = sum(len(a) for a in assertions_by_file.values())
        print(f"\nTotal assertions: {total_assertions} from {len(assertions_by_file)} files.", flush=True)

        # Phase 3: Verify
        print(f"\n--- Phase 3: Verification (Perplexity) ---", flush=True)
        verified = phase_verify(assertions_by_file, settings)
        total_verified = sum(len(a) for a in verified.values())
        print(f"Verified: {total_verified} of {total_assertions}.", flush=True)

        # Phase 4: Integrate
        ontology_dir = Path(podcast.get("ontology_dir", "")) if podcast.get("ontology_dir") else None
        episode_paths = {f.name: f for f in all_files}
        print(f"\n--- Phase 4: Ontology integration ---", flush=True)
        phase_integrate(verified, ontology_dir, settings, state, dry_run, episode_paths=episode_paths)

        # Phase 5: Mark complete
        phase_mark_complete(all_files, verified)
        save_state(state_path, state)

        print(f"\n[{podcast['name']}] Done.", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Podcast Knowledge Ingest")
    parser.add_argument("--config", type=Path, default=Path("podcasts.yaml"))
    parser.add_argument("--dry-run", action="store_true", help="Extract and verify but don't write to ontology")
    parser.add_argument("--file", type=str, help="Process a specific episode file")
    parser.add_argument("--reprocess", action="store_true", help="Reprocess already-processed files")
    args = parser.parse_args()

    config = load_config(args.config)
    run(config, dry_run=args.dry_run, target_file=args.file, reprocess=args.reprocess)


if __name__ == "__main__":
    main()
